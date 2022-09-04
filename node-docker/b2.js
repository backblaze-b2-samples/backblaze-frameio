import pkg from 'aws-sdk';
const {Endpoint, S3} = pkg;

export function getB2Conn() {
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

export async function createB2SignedUrls(b2, key) {
    const signedUrlExpiration = 60 * 15; // 60 seconds * minutes
    return b2.getSignedUrl('getObject', {
        Bucket: process.env.BUCKET_NAME,
        Key: key,
        Expires: signedUrlExpiration
    });
}

export async function getB2ObjectSize(b2, key) {
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
