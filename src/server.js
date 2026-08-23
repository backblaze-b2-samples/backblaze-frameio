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
    assertAllowedB2ImportPath,
    formProcessor,
    verifyTimestampAndSignature,
    IMPORT,
    EXPORT,
    ENV_VARS
} from "./customaction.js"
import {encodeImportApprovalValue, parseImportApprovalValue, PendingImportStore} from "./pending_imports.js";

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

const b2 = getB2Connection();

const app = express();
// Verify the timestamp and signature before JSON parsing, so we have access to the raw body
app.use(express.json({verify: verifyTimestampAndSignature}));
app.use(compression());

const pendingImports = new PendingImportStore();

app.post('/', [checkContentType, formProcessor], async(req, res) => {
    const interaction_id = req.body['interaction_id'];
    let response;

    console.log(`Server request: ${JSON.stringify(req.body, null, 2)}`);

    try {
        const bucket = process.env.B2_BUCKET_NAME;
        if ('proceed' in req.body['data']) {
            const {proceed, nonce} = parseImportApprovalValue(req.body['data']['proceed']);
            req.body['data']['pending_nonce'] = nonce;
            req.body['data'] = pendingImports.consume(req.body);
            if (proceed === 'yes') {
                console.log(`User proceeding with import of ${req.body['data']['b2path']}`)
            } else {
                console.log(`User canceling import of ${req.body['data']['b2path']}`)
                res.status(204);
                return
            }
        } else if ('b2path' in req.body['data']) {
            req.body['data']['b2path'] = assertAllowedB2ImportPath(req.body['data']['b2path']);
            // Check file exists in B2, and get its size
            console.log(`Looking for ${req.body['data']['b2path']} in ${bucket}`);
            const [count, totalSize, isPrefix] = await getB2ObjectSize(b2, bucket, req.body['data']['b2path']);

            req.body['data']['isPrefix'] = isPrefix;
            req.body['data']['totalSize'] = totalSize;
            if (count > 1) {
                const pendingImport = pendingImports.create(interaction_id, req.body, req.body['data']);
                // Ask the user if they want to go ahead
                res.json({
                    "title": "Bulk Import",
                    "description": `${bucket}/${req.body['data']['b2path']} contains ${count} files with total size ${formatBytes(totalSize)}.`,
                    "fields": [{
                        "type": "select",
                        "label": "Proceed with the import?",
                        "name": "proceed",
                        "options": [{
                            "name": "Yes", "value": encodeImportApprovalValue("yes", pendingImport.nonce)
                        }, {
                            "name": "No", "value": encodeImportApprovalValue("no", pendingImport.nonce)
                        }]
                    }]
                });
                return;
            }
        }

        const task = ('b2path' in req.body['data']) ? IMPORT : EXPORT;

        // fork a process for the import/export, so we don't hang the web server
        const childProcess = fork(path.join(__dirname, 'task.js'));
        childProcess.send(req.body);

        response = (task === IMPORT) ? {
            "title": "Job submitted!",
            "description": `Import job submitted for ${bucket}/${req.body['data']['b2path']} (${formatBytes(req.body['data']['totalSize'])})`
        } : {
            'title': 'Job submitted!',
            'description': `Export job submitted for ${req.body['data']['depth']}.`
        };
    } catch (err) {
        console.log('Caught error in app.post: ', err);
        const statusCode = err.statusCode || err.status || (err['name'] === 'NotFound' ? 404 : 500);
        response = {
            "title": "Error",
            "description": err['name'] === 'NotFound'
                ? `${req.body['data']['b2path']} not found`
                : err['name']
        };
        res.status(statusCode).json(response);
        return;
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
