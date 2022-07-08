const AWS = require('aws-sdk');
const fetch = require('node-fetch');
const express = require('express');
const stream = require('stream');
var crypto = require('crypto');

const envVars = ['FRAMEIO_TOKEN', 'FRAMEIO_SECRET', 'BUCKET_ENDPOINT', 'BUCKET_NAME', 'ACCESS_KEY', 'SECRET_KEY'];

const app = express();

async function fetchAssetInfo (id) {

    const token = process.env.FRAMEIO_TOKEN;

    console.log("asset id: " + id)

    let path = `https://api.frame.io/v2/assets/${id}`;
    let requestOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };

    console.log("asset path: " + path)

    try {
        let response = await fetch(path, requestOptions);
        let result = await response.json();

        console.log(`if defined, more than one item: ${result.length}`);

        if (result._type == 'version_stack') {
            console.log(`version_stack detected, processing stack: ${result.id}`);
            return {url, name} = await fetchAssetInfo(result.id + '/children');
        }

        if (result.length) { // more than one result means it's a folder or version_stack and we need to iterate
            for (const item of Object.keys(result)) {
                    console.log(`version_stack child item type: ${result[item]._type}`);
                    if (result[item]._type == 'file') {
                        console.log(`version_stack child upload : ${result[item].name} `);
                        invokeUploader(result[item].original, result[item].name);
                    } else {
                        console.log("version_stack child type not supported, or not found");
                        //console.log(`version_stack child full :` + JSON.stringify(item, null, 2));
                        throw `archiveType: ${result[item]} version_stack child unknown or project_id : ${result[item].project_id} not found `;
                    }
            }
            console.log("version_stack processing finished");
            return { url: '', name: "Version Stack" }; // using empty url value for logic in main


        } else {
            console.log(`begin typing: ${result._type}`);
            if (result._type == 'file') {
                console.log(`item is file type: ${result.name}`);
                return { url: result.original, name: result.name };
            } else {
                console.log("type not supported, or not found");
                //console.log(`printout full :` + JSON.stringify(result, null, 2));
                throw `archiveType: ${result._type} unknown or project_id : ${result.project_id} not found `;
            }
        }
    } catch(err) {
        console.log(`error received: ${err}`);
        if ( err.startsWith("archiveType: ") ) {
            return { url: err };
        }
        return (`error: ${err}`);
    }
};

async function invokeUploader (url, name) { 

    // TODO some if AWS then else logic. 
    /*
    const lambda = new AWS.Lambda();

    let req = {
        FunctionName: 'upload-to-b2',
        InvocationType: 'Event', // returns statusCode 202 on success. See invoke() SDK for info
        Payload: JSON.stringify({
            url: url, 
            name: name })
    };

    return lambda.invoke(req).promise();*/

    console.log(`upload triggered: ${name}...`);

    try {
        const { writeStream, promise } = b2Uploader({ name, url });

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
    
    return (console.log(`Done uploading ${name}!`));
};

const b2Uploader = ({ name, url }) => {

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
                Metadata: {
                    frameio_origname: name,
                    frameio_origurl: url,
                    b2_keyid: process.env.SECRET_KEY 
                },
            }).promise()
        };
    } catch(err) {
        console.log(`b2uploader failed : ${err}`)
        throw (`b2uploader failed : ${err}`);
    }
};

function matchingHMAC (stringToHash) {
    var hmac = crypto.createHmac('sha256', process.env.FRAMEIO_SECRET);
    console.log(stringToHash);
    data = hmac.update(stringToHash);
    gen_hmac = data.digest('hex');
    console.log("hmac:" + gen_hmac);
    return(gen_hmac);
};

app.use(express.json()); 

app.post('/', async (req, res) => {

    console.log('print ' + JSON.stringify(req.body));
    console.log('headers ' + JSON.stringify(req.headers));

    let sigString = 'v0:' + req.header("X-Frameio-Request-Timestamp") + ':' + JSON.stringify(req.body);

    console.log(matchingHMAC(sigString));
    console.log("v0=" + req.header("X-Frameio-Signature"));
    if (("v0=" + matchingHMAC(sigString)) != (req.header("X-Frameio-Signature"))) {
        res.status(403);
        res.json({'error': 'prohibited. mismatched hmac'});
        return;
    };

    // make sure the environment variables are set.
    envVars.forEach(element => {
        console.log(`checking ${element} is set`);
        if (!process.env[element]) {
            throw(`ERROR: Environment variable ${element} not properly set`);
        };
    });

    let id = req.body.resource.id;
    let { url, name} = await fetchAssetInfo(id);

    console.log(`url is ${url}`);
    console.log(`name is ${name}`);
    try {
        if ( typeof url !== 'undefined' && url ) {
            invokeUploader(url, name);
        }

        if ( url.startsWith("archiveType:")) {
            res.status(202);
            res.json({
                    'title': 'Job rejected.',
                    'description': `${url} not currently supported.`
            });
        } else {

            res.status(202);
            res.json({
                'title': 'Job received!',
                'description': `Your archive job for '${name}' has been triggered.`
            });
        };

    } catch(err) {
        console.log(`ERROR Hit a problem: ${err.message}`);
        res.status(500);
        res.json(`ERROR: ${err.message}`);
        throw err;
    }
    
});

app.listen(8675, () => console.log('Server ready and listening'));
