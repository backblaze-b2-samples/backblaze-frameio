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
and sending the upload status to console.

It also requires the documented environment variables
are set or it will not start the express app. 

TODO: 
 - Import logic
 - return before tree walk at risk of processing error being invisible; no size?
 - status page? with file list, upload progress, and initiated user
 - break asset/stack uploads into different functions?
 - deny imports from the exports folder
 - do some amount of size check if possible (done for exports)
 - uploadmanager percent stats (exist per chunk to console)
 - external logging
 - store all metadata somewhere from the fio API calls
 - initiated out of res object
 - fix all the returns in getIdInfo

*/
const compression = require('compression')
const fetch = require('node-fetch');
const express = require('express');
const stream = require('stream');
const AWS = require('aws-sdk');
var crypto = require('crypto'); // verify frame.io signature values

const ENV_VARS = ['FRAMEIO_TOKEN', 'FRAMEIO_SECRET', 'BUCKET_ENDPOINT', 'BUCKET_NAME', 'ACCESS_KEY', 'SECRET_KEY'];
const UPLOAD_PATH = 'fio_exports/';
const TOKEN = process.env.FRAMEIO_TOKEN;
async function checkEnvVars () {
    // make sure the environment variables are set
    try {
        ENV_VARS.forEach(element => {
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

function checkSig (req, res, next) {
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
        console.log('ERROR checkSig: ', err.message);
        throw new Error(err);
    };
};

function calcHMAC (stringToHash) {
    //calculate SHA256 HMAC of string.
    try {
        const hmac = crypto.createHmac('sha256', process.env.FRAMEIO_SECRET);
        console.log(stringToHash);
        const data = hmac.update(stringToHash);
        const gen_hmac = data.digest('hex');
        console.log('hmac: ', gen_hmac);
        return(gen_hmac);
    } catch(err) {
        console.log('ERROR calcHMAC: ', err.message);
        throw err;
    }
};

async function formProcessor (req, res, next) {
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
                    "description": `Please enter the object path to import from Backblaze. As a reminder, your bucket name is ${process.env.BUCKET_NAME}. Only single files are currently supported.`,
                    "fields": [{
                        "type": "text",
                        "label": "B2 Path",
                        "name": "b2path"}]}));
            } else {
                console.log('unknown copytype received');
                return next();
            };
        } else if ( data.b2path ) { // user chose import
            console.log('sending to import processor.')
            importProcess(req);
            
        } else if ( data.depth ) { // user chose export
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
};

async function getIdInfo (idReq, fileTree='') {
    // get asset info based on the id from Frame.io
    // params: a request object with the id of the item
    //         and a fileTree to track location in 
    //         nested paths during recursion

    let resource = idReq.body.resource;
    let data = idReq.body.data;

    let path = `https://api.frame.io/v2/assets/${resource.id}`;
    let requestOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      }
    };
    if (data.b2path) {
        return {name: data.b2path};
    }

    try {
        let request = await fetch(path, requestOptions);
        let r = await request.json();

        console.log('quantity ', r.length);

        // if 'project' selected, run this once to initiate a top level project recursion
        if (data.depth == 'project' && ! data.initiated) {
            resource.id = r.project.root_asset_id + '/children';
            fileTree = r.project.name;
            data.initiated = 1;
            return { name } = await getIdInfo(idReq, fileTree + '/');
        };
        if (r.length) { // more than one item in the response
            for (const i of Object.keys(r)) {
                if (r[i].type == 'version_stack' || r[i].type == 'folder') {
                    // handle nested folders and version stacks etc
                    resource.id = r[i].id + '/children';
                    await getIdInfo(idReq, fileTree + r[i].name + '/');
                } else if (r[i].type == 'file') {
                    filesize += r[i].filesize;
                    streamToB2(r[i].original, fileTree + r[i].name, r[i].filesize);
                } else {
                    console.log(r.type, 'unknown type'); // recursive 'if' above should prevent getting here
                    return { name: 'error: unknown type' + fileTree + '/' + r.name }
                };
            }
            console.log('multistack done');
            return { name: fileTree };
        } else { // a single item in the response
            if (r.type == 'file') {
                console.log('file type: ', r.name);
                filesize += r.filesize;
                streamToB2(r.original, fileTree + r.name, r.filesize);
                return { name: r.name };
            } else if (r.type == 'version_stack') {
                resource.id = r.id + '/children';
                return { name } = await getIdInfo(idReq, fileTree + r.name + '/');
            } else {
                console.log('type not supported, or not found');
                //console.log(`printout full :` + JSON.stringify(r, null, 2));
                return { name: 'error: it seems like an unknown type' + fileTree + '/' + r.name }
            }
        }
    } catch(err) {
        console.log('error received: ', err);
        return { name: err };
        //return (`error: ${err}`);
    }
};

async function importProcess (req) {
    // make sure not importing from UPLOAD_PATH ?
    signedUrl = createB2SignedUrls(req.body.data.b2path);
    let parent = await createFioFolder(req);
    createFioAsset(req.body.data.b2path, parent, signedUrl);
    return (console.log('import submitted', req.body.data.b2path));
};

const getB2Conn = () => {
    const endpoint = new AWS.Endpoint('https://' + process.env.BUCKET_ENDPOINT);
    //AWS.config.logger = console;
    const b2 = new AWS.S3({
        endpoint: endpoint, 
        region: 'backblaze',
        customUserAgent: 'b2-node-docker-0.2',
        secretAccessKey: process.env.SECRET_KEY, 
        accessKeyId: process.env.ACCESS_KEY  
        });
    return b2;
};

const createB2WriteStream = (name, filesize) => {
    const pass = new stream.PassThrough();

    const b2 = getB2Conn();
    // the defaults are queueSize 4 and partsize 5mb (vs 50mb)
    // these can be adjusted up for larger machines or
    // down for small ones (or instances with lots of concurrent users)
    const opts = {queueSize: 16, partSize: 1024 * 1024 * 50};
    try {
        return { 
            writeStream: pass, 
            promise: b2.upload({
                Bucket: process.env.BUCKET_NAME, 
                Key: UPLOAD_PATH + name, 
                Body: pass,
                ChecksumAlgorithm: 'SHA1',
                Metadata: {
                    frameio_name: name,
                    b2_keyid: process.env.SECRET_KEY 
                }
            }, opts).on('httpUploadProgress', function(evt) {
                console.log(name, formatBytes(evt.loaded), '/', formatBytes(filesize)); 
            }).promise()
        };
    } catch(err) {
        console.log('createB2WriteStream failed : ', err)
        throw ('createB2WriteStream failed : ', err);
    }
};

async function getFioRoot (req) {

    let path = `https://api.frame.io/v2/assets/${req.body.resource.id}`;
    let requestOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      }
    };
    try {
        let request = await fetch(path, requestOptions);
        let r = await request.json();
        console.log('root:', r.project.root_asset_id);
        return(r.project.root_asset_id);
    } catch(err) {
        console.log('error received: ', err);
        return { name: err };
        //return (`error: ${err}`);
    };
};

async function createFioFolder(req, name="b2_imports") {
    // create folder in frameio
    let root = await getFioRoot(req);

    let path = `https://api.frame.io/v2/assets/${root}/children`;
    var body = JSON.stringify({
        'filesize': 0,
        'name': name,
        'type': 'folder'
      });

    let requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: body
    };

    const resp = await fetch(path, requestOptions);
    const data = await resp.json();
    return(data.id);
};

async function createFioAsset(name, parent, signedUrl) {
    // create new single asset

    const resp = await fetch(
    `https://api.frame.io/v2/assets/${parent}/children`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({
        'filesize': 0,
        'name': name,
        'type': 'file',
        'source': {'url': signedUrl}
      })
    }
  );

  const data = await resp.json();

};

async function createB2SignedUrls (prefix) {
    const b2 = getB2Conn();
    const signedUrlExpiration = 60 * 15; // 60 seconds * minutes

    return (b2.getSignedUrl('getObject', {
        Bucket: process.env.BUCKET_NAME,
        Key: prefix,
        Expires: signedUrlExpiration
    }));
};

async function streamToB2 (url, name, filesize) { 

    //console.log('streamToB2: ', name);
    try {
        const { writeStream, promise } = createB2WriteStream(name, filesize);
        
        fetch(url)
            .then(response => {
                response.body.pipe(writeStream);
        });

        try {            
            await promise;
            //console.log(`streamToB2 ${name} took ${(endTime - startTime)/1000} seconds`);
        } catch (error) {
            console.log('streamToB2 error: ', error.message);
        }

    } catch(err) {
        throw ('streamToB2: ', err);
    }
    return (name);
};

function formatBytes (bytes, decimals=1) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};


const app = express();
app.use(express.json());
app.use(compression());

app.post('/', [checkSig, formProcessor], async (req, res) => {

    filesize = 0;
    // send the data on for processing.
    let { name } = await getIdInfo(req);

    name = name.replaceAll('\/', '');
    // console.log('name: ', name);

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
                    'description': `Job for '${name}' has been triggered. Total size ${formatBytes(filesize)}`
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
