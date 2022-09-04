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
 - clean up exit points in createExportList

*/
import {getFioAssets} from "./frameio.js";
import { formatBytes } from "./formatbytes.js";
import {getB2Conn, getB2ObjectSize} from "./b2.js";

import compression from "compression";
import express from "express";
import {fork} from "child_process";

const ENV_VARS = [
    'FRAMEIO_TOKEN',
    'FRAMEIO_SECRET',
    'BUCKET_ENDPOINT',
    'BUCKET_NAME',
    'ACCESS_KEY',
    'SECRET_KEY',
    'UPLOAD_PATH',
    'DOWNLOAD_PATH'
];

const b2 = getB2Conn();

const app = express();
// Verify the timestamp and signature before JSON parsing, so we have access to the raw body
app.use(express.json({verify: verifyTimestampAndSignature}));
app.use(compression());

app.post('/', [checkContentType, formProcessor], async(req, res) => {
    let data = req.body.data;
    let response;

    if (data['depth']) { // user chose export
        try {
            const exportList = [];
            let { name, filesize } = await createExportList(req, exportList);

            // fork a process for the export, so we don't hang the web server
            const exporter = fork('exporter.js');
            exporter.send(exportList);

            response = {
                'title': 'Job received!',
                'description': `Job for '${name.replaceAll('\/', '')}' has been triggered. Total size ${formatBytes(filesize)}`
            };
        } catch(err) {
            console.log('Caught export error in app.post: ', err);
            response = {
                'title': 'Error',
                'description': `${err}`
            };
        }
    } else if (data['b2path']) { // user chose import
        try {
            const b2path = req.body.data['b2path'];
            const filesize = await getB2ObjectSize(b2, b2path);

            const importer = fork('importer.js');
            importer.send({
                b2path: b2path,
                id: req.body.resource.id,
                filesize: filesize
            });

            response = {
                "title": "Submitted",
                "description": `Submitted ${formatBytes(filesize)} for import`
            };
        } catch (err) {
            console.log('Caught import error in app.post: ', err);
            response = {
                "title": "Error",
                "description": err['code'] === 'NotFound'
                    ? `${req.body.data['b2path']} not found`
                    : err['code']
            };
        }
    }

    if (response) {
        res.status(202).json(response);
    } else {
        res.status(500).json({"title": "Error", "description": 'Unknown stage.'});
    }
});

app.listen(8675, () => {
    checkEnvVars();
    console.log(`NODE_ENV: ${process.env['NODE_ENV']}`)
    console.log('Server ready and listening');
});


function checkContentType(req, res, next) {
    if (!req.is('application/json')) {
        console.log(`Bad content type: ${req.get('Content-Type')}`)
        res.sendStatus(400);
    } else {
        next();
    }
}

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

function verifyTimestampAndSignature(req, res, buf, encoding) {
    // // X-Frameio-Request-Timestamp header from incoming request
    // const timestamp = req.header('X-Frameio-Request-Timestamp');
    // // Epoch time in seconds
    // const now = Date.now() / 1000;
    // const FIVE_MINUTES = 5 * 60;
    //
    // if (!timestamp) {
    //     console.log('Missing timestamp')
    //     throw createError(403);
    // }
    //
    // // Frame.io suggests verifying that the timestamp is within five minutes of local time
    // if (timestamp < (now - FIVE_MINUTES) || timestamp > (now + FIVE_MINUTES)) {
    //     console.log(`Timestamp out of bounds. Timestamp: ${timestamp}; now: ${now}`);
    //     throw createError(403);
    // }
    //
    // // Frame.io signature format is 'v0=' + HMAC-256(secret, 'v0:' + timestamp + body)
    // const body = buf.toString(encoding);
    // const stringToSign = 'v0:' + timestamp + ':' + body;
    // const hmac = crypto.createHmac('sha256', process.env.FRAMEIO_SECRET);
    // const expectedSignature = 'v0=' + hmac.update(stringToSign).digest('hex');
    //
    // if (expectedSignature !== req.header('X-Frameio-Signature')) {
    //     console.log(`Mismatched HMAC. Expecting '${expectedSignature}', received '${req.header('X-Frameio-Signature')}'`);
    //     throw createError(403);
    // }
}

async function formProcessor(req, res, next) {
    // frame.io callback form logic
    let formResponse;

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
            return res.json(formResponse);
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
            return res.json(formResponse);
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
            return res.json(formResponse);
        }

        next();
    } catch (err) {
        console.log('ERROR formProcessor: ', err, err.stack);
        throw new Error('ERROR formProcessor', err);
    }
}

async function createExportList(req, exportList, fileTree= '') {
    let resource = req.body.resource;
    let data = req.body.data;

    const fioResponse = await getFioAssets(resource.id);
    let response;

    console.log(`processExportList for ${resource.id}, ${fileTree}, ${fioResponse.length}`);

    // if 'project' selected, run this once to initiate a top level project recursion
    if (data.depth === 'project' && ! data.initiated) {
        const asset = fioResponse;
        resource.id = asset.project['root_asset_id'] + '/children';
        fileTree = asset.project.name;
        data.initiated = true;
        let l = await createExportList(req, exportList, fileTree + '/');
        response = { name: asset.project.name, filesize: l.filesize };
    } else if (fioResponse.length) { // more than one item in the response
        response = { name: fileTree, filesize: 0 };
        const assetList = fioResponse;
        for (const asset of assetList) {
            if (asset.type === 'version_stack' || asset.type === 'folder') {
                // handle nested folders and version stacks etc
                resource.id = asset.id + '/children';
                let l = await createExportList(req, exportList, fileTree + asset.name + '/');
                response.filesize += l.filesize;
            } else if (asset.type === 'file') {
                exportList.push({
                    url: asset['original'],
                    name: fileTree + asset.name,
                    filesize: asset.filesize
                });
                response.filesize += asset.filesize;
            } else {
                console.log(assetList.type, 'unknown type'); // recursive 'if' above should prevent getting here
                throw('error: unknown type' + fileTree + '/' + assetList.name);
            }
        }
        console.log('list done');
    } else { // a single item in the response
        const asset = fioResponse;
        if (asset.type === 'file') {
            exportList.push({
                url: asset['original'],
                name: fileTree + asset.name,
                filesize: asset.filesize
            });
            response = { name: asset.name, filesize: asset.filesize };
        } else if (asset.type === 'version_stack') {
            resource.id = asset.id + '/children';
            response = createExportList(req,  fileTree + asset.name + '/');
        } else {
            console.log('file type: ', asset.name, asset.type);
            console.log('type not supported, or not found');
            throw('error: unknown type' + fileTree + '/' + asset.name);
        }
    }

    return response;
}
