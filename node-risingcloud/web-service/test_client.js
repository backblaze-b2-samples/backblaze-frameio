const fetch = require("node-fetch");
const fs = require("fs");
const crypto = require('crypto');

const args = process.argv.slice(2);
const url = args[0];

// Epoch time in seconds
const timestamp = args.length > 1 ? parseInt(args[1]) : Math.round(Date.now() / 1000);

const body = fs.readFileSync('./request.json');
console.log(`Request: ${body}`);

// Frame.io signature format is 'v0=' + HMAC-256(secret, 'v0:' + timestamp + body)
const stringToSign = 'v0:' + timestamp + ':' + body;
const hmac = crypto.createHmac('sha256', process.env.FRAMEIO_SECRET);
const signature = 'v0=' + hmac.update(stringToSign).digest('hex');

console.log(`Signature: ${signature}`);

fetch(url, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Frameio-Request-Timestamp': timestamp,
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
