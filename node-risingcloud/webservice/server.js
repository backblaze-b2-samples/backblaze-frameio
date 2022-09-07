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

const fetch = require("node-fetch");
const compression = require("compression");
const express = require("express");

const {getB2Conn, getB2ObjectSize} = require("backblaze-frameio-common/b2");
const {formatBytes, checkEnvVars, checkContentType} = require("backblaze-frameio-common/utils");
const {
    formProcessor,
    verifyTimestampAndSignature,
    IMPORT,
    EXPORT
} = require("backblaze-frameio-common/customaction");

const ENV_VARS = [
    'FRAMEIO_SECRET',
    'BUCKET_ENDPOINT',
    'BUCKET_NAME',
    "ACCESS_KEY",
    "SECRET_KEY",
    'TASK',
    'TASK_KEY'
];

const b2 = getB2Conn();

const app = express();
// Verify the timestamp and signature before JSON parsing, so we have access to the raw body
app.use(express.json({verify: verifyTimestampAndSignature}));
app.use(compression());

app.post('/', [checkContentType, formProcessor], async(req, res) => {
    let data = req.body.data;
    let response;

    const task = data['b2path'] ? IMPORT : EXPORT;

    try {
        if (task === IMPORT) {
            // Check file exists in B2, and get its size
            req.body.filesize = await getB2ObjectSize(b2, req.body.data['b2path']);
        }

        // Use a Rising Cloud task, so we don't hang the web server
        const path = new URL("/risingcloud/jobs", process.env.TASK);
        const opts = {
            method: 'POST',
            body: JSON.stringify(req.body),
            headers: {
                "X-RisingCloud-Auth": process.env.TASK_KEY
            }
        };

        console.log(`${task} request: `, JSON.stringify(req.body, null, 2));
        const job = await fetch(path,opts).then((response) => response.json());
        console.log(`${task} job: `, JSON.stringify(job, null, 2));

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
