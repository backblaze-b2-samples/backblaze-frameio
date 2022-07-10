/*
This code reads a Custom Action POST from frame.io.
It uses form-based callbacks within frame.io and
supports single asset, asset stacks, and entire project
exports to Backblaze B2.

It uses a stream buffer and multipart upload functionality
to deliver very large files with very low disk and 
memory requirements. Network IO is generally the deciding
factor of how fast it will operate.

Current functionality includes verifying the frame.io 
SHA256 HMAC signature with the Custom Action 'secret', 

It also requires the documented environment variables
are set or it will not start the express app. 

TODO: 
 - Import logic
 - deny imports from the exports folder
 - do some amount of size verification if possible
 - uploadmanager percent stats
 - external logging
 - store all metadata somewhere from the fio API calls

*/

const fetch = require('node-fetch');
const express = require('express');
const stream = require('stream');
const AWS = require('aws-sdk');
var crypto = require('crypto');

const envVars = ['FRAMEIO_TOKEN', 'FRAMEIO_SECRET', 'BUCKET_ENDPOINT', 'BUCKET_NAME', 'ACCESS_KEY', 'SECRET_KEY'];


async function getIdInfo (origReq, fileTree='') {
    // get asset info based on the id from Frame.io
    const token = process.env.FRAMEIO_TOKEN;

    let resource = origReq.body.resource;
    let data = origReq.body.data;
    //console.log('asset id: ', resource.id);

    let path = `https://api.frame.io/v2/assets/${resource.id}`;
    let requestOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };

    // console.log('asset path: ', path)

    try {
        let r = await fetch(path, requestOptions);
        let result = await r.json();

        console.log('quantity ', result.length);

        // if 'project' selected, run this once to initiate a top level project recursion
        if (data.depth == 'project' && ! data.initiated) {
            resource.id = result.project.root_asset_id + '/children';
            fileTree = result.project.name;
            data.initiated = 1;
            return { name } = await getIdInfo(origReq, fileTree + '/');
        };

        // handle folders and version stacks etc
        if (result.type == 'version_stack' || result.type == 'folder') {
            resource.id = result.id + '/children';
            fileTree +=  result.name;
            await getIdInfo(origReq, fileTree + '/');
        }

        // more than one result means it's a folder or version_stack and we need to iterate
        if (result.length) { 
            for (const i of Object.keys(result)) {
                    console.log(result[i].type, 'named :', result[i].name);
                    if (result[i].type == 'file') {
                        streamUpload(result[i].original, fileTree + result[i].name);
                    } else if (result[i].type == 'version_stack' || result[i].type == 'folder') {
                        resource.id = result[i].id + '/children';
                        await getIdInfo(origReq, fileTree  + result[i].name + '/');            
                    } else {
                        console.log(result.type, 'type is unknown'); // we shouldn't hit this due to the recursive if above
                        return { name: 'error: it seems like an unknown type' + fileTree + '/' + result.name }
                    };
            }
            console.log('completed processing multi-item stack');
            return { name: fileTree };

        // this will only trigger if the POST is only a single asset, no folders or stacks
        } else { 
            if (result.type == 'file') {
                console.log('file type: ', result.name);
                streamUpload(result.original, fileTree + result.name);
                return { name: result.name };
            } else {
                console.log('type not supported, or not found');
                //console.log(`printout full :` + JSON.stringify(result, null, 2));
                return { name: 'error: it seems like an unknown type' + fileTree + '/' + result.name }
            }
        }
    } catch(err) {
        console.log('error received: ', err);
        return { name: err };
        //return (`error: ${err}`);
    }
};

async function streamUpload (url, name) { 

    console.log('upload begin: ', name);
    try {
        const { writeStream, promise } = createWriteStream(url, name);

        fetch(url)
            .then(response => {
                response.body.pipe(writeStream);
        });

        try {
            await promise;
            console.log('upload completed successfully');
        } catch (error) {
            console.log('upload failed.', error.message);
        }

    } catch(err) {
        throw (`upload failed error: ${err}`);
    }
    
    return (console.log('Done uploading: ', name));
};

const createWriteStream = (url, name) => {

    var endpoint = new AWS.Endpoint('https://' + process.env.BUCKET_ENDPOINT);

    const s3 = new AWS.S3({
        endpoint: endpoint, 
        region: 'backblaze',
        customUserAgent: 'b2-node-docker-0.2',
        secretAccessKey: process.env.SECRET_KEY, 
        accessKeyId: process.env.ACCESS_KEY
    });

    const pass = new stream.PassThrough();

    try {
        return { 
            writeStream: pass, 
            promise: s3.upload({ 
                Bucket: process.env.BUCKET_NAME, 
                Key: name, 
                Body: pass,
                ChecksumAlgorithm: 'SHA1',
                Metadata: {
                    frameio_name: name,
                    b2_keyid: process.env.SECRET_KEY 
                },
            }).promise()
        };
    } catch(err) {
        console.log('createWriteStream failed : ', err)
        throw ('createWriteStream failed : ', err);
    }
};

function calcHMAC (stringToHash) {
    //calculate SHA256 HMAC of string.
    try {
        var hmac = crypto.createHmac('sha256', process.env.FRAMEIO_SECRET);
        console.log(stringToHash);
        data = hmac.update(stringToHash);
        gen_hmac = data.digest('hex');
        console.log('hmac: ', gen_hmac);
        return(gen_hmac);
    } catch(err) {
        console.log('ERROR calcHMAC: ', err.message);
        throw err;
    }
};

function checkFrameSig (req, res, next) {
    // check signature for Frame.io
    try {
        // Frame.io signature format is 'v0:timestamp:body'
        let sigString = 'v0:' + req.header('X-Frameio-Request-Timestamp') + ':' + JSON.stringify(req.body);

        //check to make sure the signature matches, or finish
        if (('v0=' + calcHMAC(sigString)) != (req.header('X-Frameio-Signature'))) {
            return res.status(403).json({'error': 'mismatched hmac'});
        };
        return next();
    } catch(err) {
        console.log('ERROR checkFrameSig: ', err.message);
        throw new Error(err);
    };
};

function checkEnvVars () {
    // make sure the environment variables are set
    try {
        envVars.forEach(element => {
            console.log('checking: ', element);
            if (!process.env[element] || process.env[element] == '') {
                throw('Environment variable: ', element);
            };
        });
    } catch(err) {
        console.log('ERROR checkEnvVars: ', err);
        throw({'error': 'internal configuration'});
    };
};

function formProcessor (req, res, next) {
    // frame.io callback form logic
    try {
        let data = req.body.data;
        console.log(req.body);
        if ( !data ) { // send user first question
            console.log('FormProcessor: Question 1');
            return (res.status(200).json({
                "title": "Import or Export?",
                "description": "Export from Frame.io -> Backblaze B2 🔥 ?\n\nor\n\nImport from 🔥 Backblaze B2 -> Frame.io ?",
                "fields": [{
                    "type": "select",
                    "label": "Import or Export",
                    "name": "copytype",
                    "options": [{   
                        "name": "Export from Frame.io","value": "export" },{ 
                        "name": "Import from Backblaze B2", "value": "import" }]}]}));
        };

        if ( data.copytype ) { // send user next question
            console.log('FormProcessor: Question 2');
            if ( data.copytype  == "export") {
                return (res.status(200).json({
                    "title": "Specific Asset(s) or Whole Project?",
                    "description": "Export the specific asset(s) selected or the entire project?",
                    "fields": [{
                        "type": "select",
                        "label": "Specific Asset(s) or Entire Project",
                        "name": "depth",
                        "options": [{   
                            "name": "Specific Asset(s)","value": "asset" },{ 
                            "name": "Entire Project", "value": "project" }]}]}));
            } else if (data.copytype  == "import") {
                // todo : possibly limit importing the export location
                return (res.status(200).json({
                    "title": "Enter the location",
                    "description": "Please enter the object or prefix to import from Backblaze. If the location is a single object we will import it. If it is a prefix we will recursively copy everything underneath it.",
                    "fields": [{
                        "type": "text",
                        "label": "B2 Path",
                        "name": "b2path"}]}));
            } else {
                console.log('unknown copytype received');
                return next();
            };
        } else if ( data.b2path ) { // user chose import
            // check and begin, do something with import from b2
            console.log('do something with import')
        } else if ( data.depth ) { // user chose export
            // export single asset or whole project
            if (data.depth == 'asset') {
                return next();
            } else if  (data.depth == 'project'){
                return next();
            };
        } else {
            // data not set, that shouldn't really happen at the end of this function.
            console.log('received a message without data after sending forms')
            return next();
        };
    } catch(err) {
        console.log('ERROR formProcessor: ', err.message);
        throw new Error(err);
    };
}

const app = express();
app.use(express.json()); 

app.post('/', [checkFrameSig, formProcessor], async (req, res) => {

    // send the data on for processing.
    let { name } = await getIdInfo(req);

    name = name.replaceAll('\/', '');
    console.log('name: ', name);

    try {
        if ( typeof name !== 'undefined' && name ) {
            // send a 200 on rejection so Frame.io will display the msg
            if ( name.startsWith('error')) {
                res.status(200).json({
                    'title': 'Job rejected.',
                    'description': `${name} not supported.`
                });
            } else {
                res.status(202).json({
                    'title': 'Job received!',
                    'description': `Archive job for '${name}' has been triggered.`
                });
            };
        }

    } catch(err) {
        console.log('ERROR / POST: ', err.message);
        res.status(500).json({'error': 'error processing input'});
        throw err;
    }
});

app.listen(8675, () => {
    checkEnvVars();
    console.log('Server ready and listening');
});
