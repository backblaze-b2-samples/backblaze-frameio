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

import fs from 'fs';
import {checkEnvVars, formatBytes, parseHrtimeToSeconds} from "backblaze-frameio-common/utils";
import {exportFiles, importFiles, ENV_VARS} from "backblaze-frameio-common/customaction";

(async() => {
    checkEnvVars(ENV_VARS);

    const startTime = process.hrtime();
    let maxMemoryUsageRss = 0;
    const interval = setInterval(() => {
        maxMemoryUsageRss = Math.max(maxMemoryUsageRss, process.memoryUsage.rss());
    }, 1000);

    let rawdata = fs.readFileSync('./request.json');
    console.log(`Request: ${rawdata}`);
    let request = JSON.parse(rawdata.toString());

    const output = (request['data']['depth']) ? await exportFiles(request) : await importFiles(request);

    let response = {"exportList": output};
    const data = JSON.stringify(response, null, 2);
    console.log(`Response: ${data}`);
    fs.writeFileSync('./response.json', data);

    const bytes = response.map(item => item.filesize).reduce((prev, next) => prev + next);
    const elapsedSeconds = parseHrtimeToSeconds(process.hrtime(startTime));
    const rate = (bytes / (elapsedSeconds * 1000000)).toFixed(0);
    console.log(`${response.length} files, ${bytes} bytes transferred in ${elapsedSeconds} seconds = ${rate} MB/s; exiting.`);

    clearInterval(interval);
    console.log(`Peak memory usage = ${formatBytes(maxMemoryUsageRss)}`);

    console.log("Task complete.")
})();
