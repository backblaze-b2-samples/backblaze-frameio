const fetch = require('node-fetch');
const express = require('express');
const stream = require('stream');
const AWS = require('aws-sdk');
var crypto = require('crypto');

const envVars = ['FRAMEIO_TOKEN', 'FRAMEIO_SECRET', 'BUCKET_ENDPOINT', 'BUCKET_NAME', 'ACCESS_KEY', 'SECRET_KEY'];


async function fetchAssetInfo (id) {
    // get asset info based on the id from Frame.io
    const token = process.env.FRAMEIO_TOKEN;

    console.log('asset id: ', id)

    let path = `https://api.frame.io/v2/assets/${id}`;
    let requestOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };

    console.log('asset path: ', path)

    try {
        let response = await fetch(path, requestOptions);
        let result = await response.json();

        console.log('number of items: ', result.length);

        if (result.type != 'file' && result.type != undefined) {
            console.log(result.type, ' with id: ', result.id);
            // recursively call to iterate over children
            return {url, name} = await fetchAssetInfo(result.id + '/children');
        }

        if (result.length) { // more than one result means it's a folder or version_stack and we need to iterate
            for (const item of Object.keys(result)) {
                    console.log(result[item].type, ' child name : ', result[item].name);
                    if (result[item].type == 'file') {
                        streamUpload(result[item].original, result[item].name);
                    } else {
                        console.log(result.type, ' child type is unknown'); // we shouldn't hit this due to the recursive if above
                        //console.log(result.type, ' child contains : ', JSON.stringify(item, null, 2));
                        throw 'archiveType: ', result[item], ' child unknown or project_id : ', result[item].project_id, 'not found';
                    }
            }
            console.log('completed processing multi-item stack');
            //return { url: '', name: result[0].name }; // using empty url value for logic in main


        } else { // only a single result
            console.log('begin typing: ', result.type);
            if (result.type == 'file') {
                console.log('item is file type: ', result.name);
                return { url: result.original, name: result.name };
            } else {
                console.log('type not supported, or not found');
                //console.log(`printout full :` + JSON.stringify(result, null, 2));
                throw `archiveType: ${result.type} unknown or project_id : ${result.project_id} not found `;
            }
        }
    } catch(err) {
        console.log('error received: ', err);
        if ( err.startsWith("archiveType: ") ) {
            return { url: err };
        }
        return (`error: ${err}`);
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

        promise.on('httpUploadProgress', (progress) => {
            console.log(name, 'progress', progress)
            // { loaded: 6472, total: 345486, part: 3, key: 'large-file.dat' }
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
                ChecksumAlgorithm: "SHA1",
                Metadata: {
                    frameio_name: name,
                    frameio_origurl: url,
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

function checkEnvVars (req, res, next) {
    // make sure the environment variables are set
    try {
        envVars.forEach(element => {
            console.log('checking: ', element);
            if (!process.env[element] || process.env[element] == '') {
                throw('Environment variable: ', element);
            };
        });
        next();
    } catch(err) {
        console.log('ERROR checkEnvVars: ', err);
        throw res.status(500).json({'error': 'internal configuration'});
    };
};

function frameSignatureCheck (req, res, next) {
    // check signature for Frame.io
    try {
        // Frame.io signature format is 'v0:timestamp:body'
        let sigString = 'v0:' + req.header("X-Frameio-Request-Timestamp") + ':' + JSON.stringify(req.body);

        //console.log(calcHMAC(sigString));
        //console.log("v0=" + req.header("X-Frameio-Signature"));

        //check to make sure the signature matches, or finish
        if (("v0=" + calcHMAC(sigString)) != (req.header("X-Frameio-Signature"))) {
            return res.status(403).json({'error': 'mismatched hmac'});
        };
        next();
    } catch(err) {
        console.log('ERROR frameSignatureCheck: ', err.message);
        throw new Error(err);
    };
};

const app = express();
app.use(express.json()); 

app.post('/', [frameSignatureCheck, checkEnvVars], async (req, res) => {

    //console.log('body: ' + JSON.stringify(req.body));
    //console.log('headers: ' + JSON.stringify(req.headers));

    let id = req.body.resource.id;
    let { url, name} = await fetchAssetInfo(id);

    console.log('url: ', url);
    console.log('name: ', name);

    try {
        if ( typeof url !== 'undefined' && url ) {
            streamUpload(url, name);
        }

        // send a 200 on rejection so Frame.io will display the msg
        if ( url.startsWith("archiveType:")) {
            res.status(200).json({
                'title': 'Job rejected.',
                'description': `${url} not supported.`
            });
        } else {
            res.status(202).json({
                'title': 'Job received!',
                'description': `Archive job for '${name}' has been triggered.`
            });
        };

    } catch(err) {
        console.log('ERROR / POST: ', err.message);
        res.status(500).json({'error': 'error processing input'});
        throw err;
    }
});

app.listen(8675, () => console.log('Server ready and listening'));
