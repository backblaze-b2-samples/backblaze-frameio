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
 - Deny imports from the exports folder
 - correct folder pathing on imports
 - import folders 
 - return before tree walk will be faster but won't show size
 - status page? with file list, upload progress, and initiated user
 - upload manager percent stats somewhere? (exist currently per chunk to console)
 - external logging (too much infra)
 - store all metadata somewhere from the fio API calls (b2 metadata?)
 - clean up exit points in processExportList

*/
const compression = require('compression')
const fetch = require('node-fetch');
const express = require('express');
const stream = require('stream');
const AWS = require('aws-sdk');
const crypto = require('crypto'); // verify frame.io signature values

const ENV_VARS = ['FRAMEIO_TOKEN', 'FRAMEIO_SECRET', 'BUCKET_ENDPOINT', 'BUCKET_NAME', 'ACCESS_KEY', 'SECRET_KEY'];
const UPLOAD_PATH = 'fio_exports/';
const TOKEN = process.env.FRAMEIO_TOKEN;


const app = express();
app.use(express.json());
app.use(compression());

const b2 = getB2Conn();

app.post('/', [checkSig, formProcessor], async(req, res) => {

    // send the data on for processing.
    let { name, filesize } = await processExportList(req);

    name = name.replaceAll('\/', '');

    try {
       if ( name.startsWith('error')) {
           res.status(200).json({
               'title': 'Job rejected.',
               'description': `${name} not supported.`
           });
       }

       res.status(202).json({
           'title': 'Job received!',
           'description': `Job for '${name}' has been triggered. Total size ${formatBytes(filesize)}`
       });
       
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


function checkEnvVars() {
    // make sure the environment variables are set
    try {
        ENV_VARS.forEach(element => {
            console.log('checking: ', element);
            if (!process.env[element]) {
                throw(`Environment variable not set: ${element}`);
            }
        })
    } catch(err) {
        console.log('ERROR checkEnvVars: ', err);
        throw({'error': 'internal configuration'});
    }
}

function checkSig(req, res, next) {
    // check signature for Frame.io
    try {
        // Frame.io signature format is 'v0:timestamp:body'
        let sigString = 'v0:' + req.header('X-Frameio-Request-Timestamp') + ':' + JSON.stringify(req.body);

        //check to make sure the signature matches
        const expectedSignature = 'v0=' + calcHMAC(sigString);
        if (expectedSignature !== req.header('X-Frameio-Signature')) {
            console.log(`Mismatched HMAC. Expecting '${expectedSignature}', received '${req.header('X-Frameio-Signature')}'`)
            return res.status(403).json();
        }
        return next();
    } catch(err) {
        console.log('ERROR checkSig: ', err.message);
        throw err;
    }
}

function calcHMAC(stringToHash) {
    //calculate SHA256 HMAC of string.
    try {
        const hmac = crypto.createHmac('sha256', process.env.FRAMEIO_SECRET);
        const data = hmac.update(stringToHash);
        return data.digest('hex');
    } catch(err) {
        console.log('ERROR calcHMAC: ', err);
        throw err;
    }
}

async function formProcessor(req, res, next) {
    // frame.io callback form logic
    let formResponse;
    let filesize;

    try {
        let data = req.body.data;
        console.log(req.body);

        if (!data) { // send user first question
            formResponse = {
                "title": "Import or Export?",
                "description": "Import from Backblaze B2, or export to Backblaze B2?",
                "fields": [{
                    "type": "select",
                    "label": "Import or Export",
                    "name": "copytype",
                    "options": [{
                        "name": "Export to Backblaze B2", "value": "export"
                    }, {
                        "name": "Import from Backblaze B2", "value": "import"
                    }]
                }]
            };
            return res.status(202).json(formResponse);
        }

        if (data['copytype'] === "export") {
            formResponse = {
                "title": "Specific Asset(s) or Whole Project?",
                "description": "Export the specific asset(s) selected or the entire project?",
                "fields": [{
                    "type": "select",
                    "label": "Specific Asset(s) or Entire Project",
                    "name": "depth",
                    "options": [{
                        "name": "Specific Asset(s)", "value": "asset"
                    }, {
                        "name": "Entire Project", "value": "project"
                    }]
                }]
            };
            return res.status(202).json(formResponse);
        } else  if (data['copytype'] === "import") {
            // todo : possibly limit importing the export location
            formResponse = {
                "title": "Enter the location",
                "description": `Please enter the object path to import from Backblaze. As a reminder, your bucket name is ${process.env.BUCKET_NAME}. Only single files are currently supported.`,
                "fields": [{
                    "type": "text",
                    "label": "B2 Path",
                    "name": "b2path"
                }]
            };
            return res.status(202).json(formResponse);
        }

        if (data.depth) { // user chose export
            return next();
        }

        if (data['b2path']) { // user chose import
            try {
                filesize = await processImport(req);
                formResponse = {
                    "title": "Submitted",
                    "description": `Submitted ${formatBytes(filesize)} for import`
                };
            } catch (err) {
                formResponse = {
                    "title": "Error",
                    "description": err['code'] === 'NotFound'
                        ? `${req.body.data['b2path']} not found`
                        : err['code']
                };
            }
        }

        // finish formProcessor
        if (formResponse) {
            return res.status(202).json(formResponse);
        } else {
            return res.status(500).json({"title": "Error", "description": 'Unknown stage.'});
        }

    } catch (err) {
        console.log('ERROR formProcessor: ', err, err.stack);
        throw new Error('ERROR formProcessor', err);
    }
}

async function processExportList(idReq, fileTree= '') {
    // get asset info based on the id from Frame.io
    // params: a request object with the id of the item
    //         and a fileTree to track location in 
    //         nested paths during recursion

    let resource = idReq.body.resource;
    let data = idReq.body.data;

    try {
        const r = await getFioAssetInfo(resource.id);
        let filesize = 0;

        console.log(`processExportList for ${resource.id}, ${fileTree}, ${r.length}`);

        // if 'project' selected, run this once to initiate a top level project recursion
        if (data.depth === 'project' && ! data.initiated) {
            resource.id = r.project['root_asset_id'] + '/children';
            fileTree = r.project.name;
            data.initiated = true;
            let l = await processExportList(idReq, fileTree + '/');
            return { name: r.project.name, filesize: l.filesize };
        }

        if (r.length) { // more than one item in the response
            for (const i of Object.keys(r)) {
                if (r[i].type === 'version_stack' || r[i].type === 'folder') {
                    // handle nested folders and version stacks etc
                    resource.id = r[i].id + '/children';
                    let l = await processExportList(idReq, fileTree + r[i].name + '/');
                    filesize += l.filesize;
                } else if (r[i].type === 'file') {
                    streamToB2(r[i]['original'], fileTree + r[i].name, r[i].filesize);
                    filesize += r[i].filesize;
                } else {
                    console.log(r.type, 'unknown type'); // recursive 'if' above should prevent getting here
                    return { name: 'error: unknown type' + fileTree + '/' + r.name }
                }
            }
            console.log('list done');
            return { name: fileTree, filesize: filesize };
        } else { // a single item in the response
            if (r.type === 'file') {
                streamToB2(r['original'], fileTree + r.name, r.filesize);
                return { name: r.name, filesize: r.filesize };
            } else if (r.type === 'version_stack') {
                resource.id = r.id + '/children';
                return processExportList(idReq, fileTree + r.name + '/');
            } else {
                console.log('file type: ', r.name, r.type);
                console.log('type not supported, or not found');
                //console.log(`printout full :` + JSON.stringify(r, null, 2));
                return { name: 'error: it seems like an unknown type' + fileTree + '/' + r.name }
            }
        }
    } catch(err) {
        console.log('error received: ', err);
        return { name: err };
    }
}

async function getFioAssetInfo(id) {
    let path = `https://api.frame.io/v2/assets/${id}`;
    let requestOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      }
    };

    const response = await fetch(path, requestOptions);

    return response.json();
}

async function processImport(req) {
    // make sure not importing from UPLOAD_PATH ?
    const b2path =  req.body.data['b2path'];
    let objectSize = await getB2ObjectSize(b2path);
    let signedUrl = await createB2SignedUrls(b2path);
    let parent = await createFioFolder(req);
    createFioAsset(b2path, parent, signedUrl, objectSize);
    console.log('import submitted', b2path);
    return objectSize;
}

function getB2Conn() {
    const endpoint = new AWS.Endpoint('https://' + process.env.BUCKET_ENDPOINT);
    //AWS.config.logger = console;
    return new AWS.S3({
        endpoint: endpoint, 
        region: process.env.BUCKET_ENDPOINT.replaceAll(/s3\.(.*?)\.backblazeb2\.com/g, '$1'),
        signatureVersion: 'v4',
        customUserAgent: 'b2-node-docker-0.2',
        secretAccessKey: process.env.SECRET_KEY, 
        accessKeyId: process.env.ACCESS_KEY  
    });
}

function createB2WriteStream(name, filesize) {
    const pass = new stream.PassThrough();

    // the defaults are queueSize 4 and partSize 5mb (vs 100mb)
    // these can be adjusted up for larger machines or
    // down for small ones (or instances with lots of concurrent users)
    const opts = {queueSize: 16, partSize: 1024 * 1024 * 100};
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
                    b2_keyid: process.env.ACCESS_KEY 
                }
            }, opts).on('httpUploadProgress', function(evt) {
                console.log(name, formatBytes(evt.loaded), '/', formatBytes(filesize)); 
            }).promise()
        };
    } catch(err) {
        console.log('createB2WriteStream failed : ', err)
        throw new Error('createB2WriteStream failed', err);
    }
}

async function getFioRoot(req) {

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
        console.log('root:', r.project['root_asset_id']);
        return r.project['root_asset_id'];
    } catch(err) {
        console.log('error received: ', err);
        return { name: err };
    }
}

async function createFioFolder(req, name="b2_imports") {
    // create folder in frameio
    let root = await getFioRoot(req);

    // check if folder already exists
    let r = await getFioAssetInfo(root + '/children');
    for (const i of Object.keys(r)) {
        if (r[i].name === name) {
            return (r[i].id);
        }
    }

    let path = `https://api.frame.io/v2/assets/${root}/children`;
    const body = JSON.stringify({
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
    return data.id;
}

async function createFioAsset(name, parent, signedUrl, filesize) {
    // create new single asset

    let path = `https://api.frame.io/v2/assets/${parent}/children`;
    const body = JSON.stringify({
        'filesize': filesize,
        'name': name.replace(UPLOAD_PATH,''),     //remove exports folder name when re-importing
        'type': 'file',
        'source': {'url': signedUrl}
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
    return resp.json();
}

async function createB2SignedUrls(key) {
    const signedUrlExpiration = 60 * 15; // 60 seconds * minutes
    return b2.getSignedUrl('getObject', {
                Bucket: process.env.BUCKET_NAME,
                Key: key,
                Expires: signedUrlExpiration
                });
}

async function getB2ObjectSize(key) {
    console.log("!!!", key);
    return new Promise((resolve, reject) =>
        b2.headObject({
            Bucket: process.env.BUCKET_NAME,
            Key: key
        }, (err, response) => {
            if (err) {
                reject(err);
            } else {
                resolve(response['ContentLength']);
            }
        })
    );
}

async function streamToB2(url, name, filesize) {
    console.log(`streamToB2: ${url}, ${name}, ${filesize}`);
    try {
        const { writeStream, promise } = createB2WriteStream(name, filesize);

        fetch(url)
            .then((response) => {
                response.body.pipe(writeStream);
        });

        try {            
            await promise;
            console.log('upload complete: ', name)
        } catch (error) {
            console.log('streamToB2 error: ', error);
        }

    } catch(err) {
        throw new Error('streamToB2: ', err);
    }
    return name;
}

function formatBytes(bytes, decimals= 1) {
    if (bytes === 0) return '0 Bytes';

    const k = 1000;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
