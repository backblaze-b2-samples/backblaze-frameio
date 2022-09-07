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

const fs = require('fs');

const {checkEnvVars} = require("backblaze-frameio-common/utils");
const {exportFiles, importFiles} = require("backblaze-frameio-common/customaction")

const ENV_VARS = [
    "BUCKET_NAME",
    "BUCKET_ENDPOINT",
    "ACCESS_KEY",
    "SECRET_KEY",
    "QUEUE_SIZE",
    "PART_SIZE",
    "FRAMEIO_TOKEN",
    "DOWNLOAD_PATH",
    "UPLOAD_PATH"
];


(async() => {
    checkEnvVars(ENV_VARS);

    let rawdata = fs.readFileSync('./request.json');
    console.log(`Request: ${rawdata}`);
    let request = JSON.parse(rawdata);

    const output = (request['data']['depth']) ? await exportFiles(request) : await importFiles(request);

    let response = {"exportList": output};
    const data = JSON.stringify(response, null, 2);
    console.log(`Response: ${data}`);
    fs.writeFileSync('./response.json', data);

    console.log("Task complete.")
})();
