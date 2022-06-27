const fetch = require('node-fetch');
const AWS = require('aws-sdk');
const stream = require('stream');

const b2Uploader = ({ name, url }) => {

    var endpoint = new AWS.Endpoint('https://' + process.env.BUCKET_ENDPOINT);
    console.log("name is " + name);
    const s3 = new AWS.S3({
        endpoint: endpoint, 
        secretAccessKey: process.env.SECRET_KEY, 
        accessKeyId: process.env.ACCESS_KEY
    });
    
    const pass = new stream.PassThrough();

    return { 
        writeStream: pass, 
        promise: s3.upload({ 
            Bucket: process.env.BUCKET_NAME, 
            Key: name, 
            Body: pass,
            Metadata: {
                frameio_origname: name,
                frameio_origurl: url,
                b2_keyid: process.env.ACCESS_KEY,
                b2_frameio: 'lambda' 
            },
        }).promise(),
    };
};

exports.handler = async (event) => {
    let { url, name } = event;

    console.log(`Begin uploading ${name}...`);

    console.log('event ' + JSON.stringify(event, null, 4));
    try {
        const { writeStream, promise } = b2Uploader({ name, url });

        fetch(url)
            .then(response => {
                response.body.pipe(writeStream);
        });

        console.log('print3 ' + url);

        try {
            await promise;
            console.log('upload completed successfully');
        } catch (error) {
            console.log('upload failed.', error.message);
        }

         pipeline.on('close', () => {
           console.log('upload successful');
         });
         pipeline.on('error', (err) => {
           console.log('upload failed', err.message);
         });

        console.log('upload completed successfully2');

    } catch(err) {
        return (`upload failed error: ${err}`);
    }
    
    return (console.log(`Done uploading ${name}!`));
  };