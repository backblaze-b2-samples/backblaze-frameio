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
import fetch from "node-fetch";
import fs from "fs";
import crypto from 'crypto';
import {parseArgs} from 'node:util';

const {
    values: { timestamp, requestFilename },
    positionals: [ url ],
} = parseArgs({
    options: {
        timestamp: {
            type: "string",
            short: "t",
        },
        requestFilename: {
            type: "string",
            short: "f",
            default: "request.json",
        },
    },
    allowPositionals: true,
});


// Epoch time in seconds
const time = timestamp ? parseInt(timestamp) : Math.round(Date.now() / 1000);

const body = fs.readFileSync(requestFilename);
console.log(`Request: ${body}`);

// Frame.io signature format is 'v0=' + HMAC-256(secret, 'v0:' + timestamp + body)
const stringToSign = 'v0:' + time + ':' + body;
const hmac = crypto.createHmac('sha256', process.env.FRAMEIO_SECRET);
const signature = 'v0=' + hmac.update(stringToSign).digest('hex');

console.log(`Signature: ${signature}`);

fetch(url, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Frameio-Request-Timestamp': time,
        'X-Frameio-Signature': signature
    },
    body: body
})
.then(async response => {
    const body = await response.text();
    console.log(response.status, response.statusText);
    response.headers.forEach((value, key) => {
        console.log(`${key}: ${value}`);
    });
    console.log(`\n${body}`);
});
