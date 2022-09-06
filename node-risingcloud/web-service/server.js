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
const createError = require("http-errors");
const fetch = require("node-fetch");
const compression = require("compression");
const express = require("express");
const crypto = require('crypto');

const {getB2Conn, getB2ObjectSize} = require("backblaze-frameio-common/b2");
const {formatBytes, checkEnvVars} = require("backblaze-frameio-common/utils");

const ENV_VARS = [
    'FRAMEIO_SECRET',
    'BUCKET_ENDPOINT',
    'BUCKET_NAME',
    'IMPORTER',
    'IMPORTER_KEY',
    'EXPORTER',
    'EXPORTER_KEY'
];

const b2 = getB2Conn();

function checkContentType(req, res, next) {
    if (!req.is('application/json')) {
        console.log(`Bad content type: ${req.get('Content-Type')}`)
        res.sendStatus(400);
    } else {
        next();
    }
}

function verifyTimestampAndSignature(req, res, buf, encoding) {
    // X-Frameio-Request-Timestamp header from incoming request
    const timestamp = req.header('X-Frameio-Request-Timestamp');
    // Epoch time in seconds
    const now = Date.now() / 1000;
    const FIVE_MINUTES = 5 * 60;

    if (!timestamp) {
        console.log('Missing timestamp')
        throw createError(403);
    }

    // Frame.io suggests verifying that the timestamp is within five minutes of local time
    if (timestamp < (now - FIVE_MINUTES) || timestamp > (now + FIVE_MINUTES)) {
        console.log(`Timestamp out of bounds. Timestamp: ${timestamp}; now: ${now}`);
        throw createError(403);
    }

    // Frame.io signature format is 'v0=' + HMAC-256(secret, 'v0:' + timestamp + body)
    const body = buf.toString(encoding);
    const stringToSign = 'v0:' + timestamp + ':' + body;
    const hmac = crypto.createHmac('sha256', process.env.FRAMEIO_SECRET);
    const expectedSignature = 'v0=' + hmac.update(stringToSign).digest('hex');

    if (expectedSignature !== req.header('X-Frameio-Signature')) {
        console.log(`Mismatched HMAC. Expecting '${expectedSignature}', received '${req.header('X-Frameio-Signature')}'`);
        throw createError(403);
    }
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


const app = express();
// Verify the timestamp and signature before JSON parsing, so we have access to the raw body
app.use(express.json({verify: verifyTimestampAndSignature}));
app.use(compression());

app.post('/', [checkContentType, formProcessor], async(req, res) => {
    let data = req.body.data;
    let response;

    if (data['depth']) { // user chose export
        // Use a Rising Cloud task for the export, so we don't hang the web server
        const path = new URL("/risingcloud/jobs", process.env.EXPORTER);
        console.log('Export request: ', JSON.stringify(req.body, null, 2));
        const job = await fetch(path,{
            method: 'POST',
            body: JSON.stringify(req.body),
            headers: {
                "X-RisingCloud-Auth": process.env.EXPORTER_KEY
            }
        }).then((response) => response.json());
        console.log('Export job: ', JSON.stringify(job, null, 2));

        response = {
            'title': 'Job submitted!',
            'description': `Export job submitted for ${data['depth']}.`
        };
    } else if (data['b2path']) { // user chose import
        try {
            // Send filesize to the importer
            req.body.filesize = await getB2ObjectSize(b2, req.body.data['b2path']);

            // Use a Rising Cloud task for the import, so we don't hang the web server
            const path = new URL("/risingcloud/jobs", process.env.IMPORTER);
            console.log('Import request: ', JSON.stringify(req.body, null, 2));
            const job = await fetch(path,{
                method: 'POST',
                body: JSON.stringify(req.body),
                headers: {
                    "X-RisingCloud-Auth": process.env.IMPORTER_KEY
                }
            }).then((response) => response.json());
            console.log('Import job: ', JSON.stringify(job, null, 2));

            response = {
                "title": "Job submitted!",
                "description": `Import job submitted for ${data['b2path']} (${formatBytes(req.body.filesize)})`
            };
        } catch (err) {
            console.log('Caught error in app.post: ', err);
            response = {
                "title": "Error",
                "description": err['code'] === 'NotFound'
                    ? `${data['b2path']} not found`
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

app.listen(8888, () => {
    checkEnvVars(ENV_VARS);
    console.log('Server ready and listening');
});
