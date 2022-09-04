import {formatBytes} from "./formatbytes.js";
import {getB2Conn} from "./b2.js";

import fetch from "node-fetch";

import stream from "stream";

async function streamToB2(b2, url, name, filesize) {
    console.log(`streamToB2: ${url}, ${name}, ${filesize}`);
    try {
        const { writeStream, promise } = createB2WriteStream(b2, name, filesize);

        fetch(url)
            .then((response) => {
                response.body.pipe(writeStream);
            });

        try {
            await promise;
            console.log('upload complete: ', name)
        } catch (error) {
            console.log('streamToB2 error: ', error);
        }
    } catch(err) {
        console.log('ERROR streamToB2: ', err, err.stack);
        throw new Error('streamToB2: ', err);
    }
    return name;
}

function createB2WriteStream(b2, name, filesize) {
    const pass = new stream.PassThrough();

    // the defaults are queueSize 4 and partSize 5mb (vs 100mb)
    // these can be adjusted up for larger machines or
    // down for small ones (or instances with lots of concurrent users)
    const opts = {queueSize: 16, partSize: 1024 * 1024 * 100};
    try {
        return {
            writeStream: pass,
            promise: b2.upload({
                Bucket: process.env.BUCKET_NAME,
                Key: process.env.UPLOAD_PATH + name,
                Body: pass,
                ChecksumAlgorithm: 'SHA1',
                Metadata: {
                    frameio_name: name,
                    b2_keyid: process.env.ACCESS_KEY
                }
            }, opts).on('httpUploadProgress', function(evt) {
                console.log(name, formatBytes(evt.loaded), '/', formatBytes(filesize));
            }).promise()
        };
    } catch(err) {
        console.log('createB2WriteStream failed : ', err)
        throw new Error('createB2WriteStream failed', err);
    }
}


process.on('message', async (exportList) => {
    console.log(`exporter received ${exportList.length} entries`);
    const promises = []
    const b2 = getB2Conn();

    for (const entry of exportList) {
        promises.push(streamToB2(b2, entry.url, entry.name, entry.filesize));
    }

    await Promise.allSettled(promises);
    process.exit(0);
});

