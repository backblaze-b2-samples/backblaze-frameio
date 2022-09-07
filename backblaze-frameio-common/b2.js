const {Endpoint, S3} = require("aws-sdk");
const stream = require("stream");
const fetch = require("node-fetch");

const {formatBytes} = require("./utils");

function getB2Conn() {
    const endpoint = new Endpoint('https://' + process.env.BUCKET_ENDPOINT);

    //AWS.config.logger = console;
    return new S3({
        endpoint: endpoint,
        region: process.env.BUCKET_ENDPOINT.replaceAll(/s3\.(.*?)\.backblazeb2\.com/g, '$1'),
        signatureVersion: 'v4',
        customUserAgent: 'b2-node-docker-0.2',
        secretAccessKey: process.env.SECRET_KEY,
        accessKeyId: process.env.ACCESS_KEY
    });
}

async function createB2SignedUrls(b2, key) {
    const signedUrlExpiration = 60 * 15; // 60 seconds * minutes
    return b2.getSignedUrl('getObject', {
        Bucket: process.env.BUCKET_NAME,
        Key: key,
        Expires: signedUrlExpiration
    });
}

async function getB2ObjectSize(b2, key) {
    return new Promise((resolve, reject) =>
        b2.headObject({
            Bucket: process.env.BUCKET_NAME,
            Key: key
        }, (err, response) => {
            if (err) {
                reject(err);
            } else {
                resolve(response['ContentLength']);
            }
        })
    );
}

async function streamToB2(b2, url, name, filesize) {
    console.log(`streamToB2: ${url}, ${name}, ${filesize}`);

    const writeStream = new stream.PassThrough();

    const promise = b2.upload({
        Bucket: process.env.BUCKET_NAME,
        Key: process.env.UPLOAD_PATH + name,
        Body: writeStream,
        ChecksumAlgorithm: 'SHA1',
        Metadata: {
            frameio_name: name,
            b2_keyid: process.env.ACCESS_KEY
        }
    }, {
        // the defaults are queueSize 4 and partSize 5mb (vs 100mb)
        // these can be adjusted up for larger machines or
        // down for small ones (or instances with lots of concurrent users)
        queueSize: process.env.QUEUE_SIZE,
        partSize: process.env.PART_SIZE
    }).on('httpUploadProgress', function(evt) {
        console.log(name, formatBytes(evt.loaded), '/', formatBytes(filesize));
    }).promise();

    fetch(url)
        .then((response) => {
            response.body.pipe(writeStream);
        });

    await promise;

    console.log('upload complete: ', name)

    return name;
}


module.exports = {
    getB2Conn,
    createB2SignedUrls,
    getB2ObjectSize,
    streamToB2
};
