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
import {checkContentType, checkEnvVars, formatBytes} from "../backblaze-frameio-common/utils.js";
import {getB2Conn, getB2ObjectSize} from "../backblaze-frameio-common/b2.js";
import {
    formProcessor,
    verifyTimestampAndSignature,
    IMPORT,
    EXPORT
} from "../backblaze-frameio-common/customaction.js"

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

    console.log(`Request: ${JSON.stringify(req.body, null, 2)}`);

    const task = data['b2path'] ? IMPORT : EXPORT;

    try {
        if (task === IMPORT) {
            // Check file exists in B2, and get its size
            req.body.filesize = await getB2ObjectSize(b2, req.body.data['b2path']);
        }

        // fork a process for the import/export, so we don't hang the web server
        const process = fork('task.js');
        process.send(req.body);

        response = (task === IMPORT) ? {
            "title": "Job submitted!",
            "description": `Import job submitted for ${data['b2path']} (${formatBytes(req.body.filesize)})`
        } : {
            'title': 'Job submitted!',
            'description': `${task} job submitted for ${data['depth']}.`
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

    console.log(`Response: ${JSON.stringify(response, null, 2)}`);

    if (response) {
        res.status(202).json(response);
    } else {
        res.status(500).json({"title": "Error", "description": 'Unknown stage.'});
    }
});

const PORT = process.env.PORT || 8888;

app.listen(PORT, () => {
    checkEnvVars(ENV_VARS);
    console.log(`Server ready and listening on port ${PORT}`);
});
