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

import {importFiles, exportFiles} from "./customaction.js";
import {formatBytes, parseHrtimeToSeconds} from "./utils.js";

process.on('message', async (request) => {
    // Don't need to check environment variables, since the task inherits them from the web service

    const startTime = process.hrtime();
    let maxMemoryUsageRss = 0;
    const interval = setInterval(() => {
        maxMemoryUsageRss = Math.max(maxMemoryUsageRss, process.memoryUsage.rss());
    }, 1000);

    console.log(`Request: ${JSON.stringify(request, null, 2)}`);
    const response = (request['data']['depth']) ? await exportFiles(request) : await importFiles(request);
    console.log(`Response: ${JSON.stringify(response, null, 2)}`);

    const bytes = response.map(item => item.filesize).reduce((prev, next) => prev + next);
    const elapsedSeconds = parseHrtimeToSeconds(process.hrtime(startTime));
    const rate = (bytes / (elapsedSeconds * 1000000)).toFixed(0);
    console.log(`${response.length} files, ${bytes} bytes transferred in ${elapsedSeconds} seconds = ${rate} MB/s; exiting.`);

    clearInterval(interval);
    console.log(`Peak memory usage = ${formatBytes(maxMemoryUsageRss)}`);

    process.exit(0);
});

