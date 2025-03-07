/*
MIT License

Copyright (c) 2022 Backblaze

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */

import {checkContentType, checkEnvVars, formatBytes} from "./utils.js";
import {getB2Connection, getB2ObjectSize} from "./b2.js";
import {
    formProcessor,
    verifyTimestampAndSignature,
    IMPORT,
    EXPORT,
    ENV_VARS
} from "./customaction.js"

import compression from "compression";
import express from "express";
import {fork} from "child_process";
import {fileURLToPath} from 'url';
import path from 'path';

// See https://stackoverflow.com/a/72462507/33905
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file - useful for testing
import 'dotenv/config';

checkEnvVars(ENV_VARS);

const DEFAULT_MAX_ATTEMPTS = 10;
if (!('AWS_MAX_ATTEMPTS' in process.env)) {
    console.log(`Setting AWS_MAX_ATTEMPTS to ${DEFAULT_MAX_ATTEMPTS}`)
    process.env['AWS_MAX_ATTEMPTS'] = DEFAULT_MAX_ATTEMPTS;
}

const b2 = getB2Connection();

const app = express();
// Verify the timestamp and signature before JSON parsing, so we have access to the raw body
app.use(express.json({verify: verifyTimestampAndSignature}));
app.use(compression());

app.post('/', [checkContentType, formProcessor], async(req, res) => {
    // formProcessor runs the Frame.io custom action dialog, so, by the time we get here, the request should contain
    //
    let data = req.body.data;
    let response;

    console.log(`Server request: ${JSON.stringify(req.body, null, 2)}`);

    try {
        const task = data['b2path'] ? IMPORT : EXPORT;

        if (task === IMPORT) {
            // Check file exists in B2, and get its size
            console.log(`Looking for ${data['b2path']} in ${process.env.BUCKET_NAME}`);
            req.body.filesize = await getB2ObjectSize(b2, process.env.BUCKET_NAME, data['b2path']);
        }

        // fork a process for the import/export, so we don't hang the web server
        const childProcess = fork(path.join(__dirname, 'task.js'));
        childProcess.send(req.body);

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

    console.log(`Server response: ${JSON.stringify(response, null, 2)}`);

    if (response) {
        res.status(202).json(response);
    } else {
        res.status(500).json({"title": "Error", "description": 'Unknown stage.'});
    }
});

const PORT = process.env.PORT || 8888;

app.listen(PORT, () => {
    console.log(`Server ready and listening on port ${PORT}`);
});
