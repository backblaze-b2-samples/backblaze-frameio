const fs = require('fs');
const stream = require("stream");
const fetch = require("node-fetch");

const {formatBytes} = require("backblaze-frameio-common/formatbytes");
const {getB2Conn} = require("backblaze-frameio-common/b2");


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
    const opts = {queueSize: process.env.QUEUE_SIZE, partSize: process.env.PART_SIZE};
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


(async() => {
    let rawdata = fs.readFileSync('./request.json');
    console.log(`Request: ${rawdata}`);
    let request = JSON.parse(rawdata);

    const exportList = request['exportList'];
    const promises = []
    const b2 = getB2Conn();

    for (const entry of exportList) {
        promises.push(streamToB2(b2, entry.url, entry.name, entry.filesize));
    }

    const results = await Promise.allSettled(promises);

    const output = []
    for (let i = 0; i < exportList.length; i++) {
        output.push({...exportList[i], ...results[i]})
    }

    let response = {"exportList": output};
    const data = JSON.stringify(response, null, 2);
    console.log(`Response: ${data}`);
    fs.writeFileSync('./response.json', data);
})();
