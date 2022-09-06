const fs = require('fs');
const stream = require("stream");
const fetch = require("node-fetch");

const {formatBytes, checkEnvVars} = require("backblaze-frameio-common/utils");
const {getB2Conn} = require("backblaze-frameio-common/b2");
const {getFioAssets} = require("backblaze-frameio-common/frameio");

const ENV_VARS = [
    "QUEUE_SIZE",
    "PART_SIZE",
    "BUCKET_NAME",
    'BUCKET_ENDPOINT',
    "ACCESS_KEY",
    "SECRET_KEY",
    "FRAMEIO_TOKEN",
    "UPLOAD_PATH"
];

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

async function createExportList(path, fileTree = '', depth = "asset") {
    // response may be one or more assets, depending on the path
    const fioResponse = await getFioAssets(path);

    console.log(`processExportList for ${path}, ${fileTree}, ${fioResponse.length}`);

    // If 'project' is selected, initiate a top level project recursion
    if (depth === 'project') {
        const asset = fioResponse;
        return createExportList(asset.project['root_asset_id'] + '/children', asset.project.name + '/');
    }

    const assetList = fioResponse.length ? fioResponse : [fioResponse];
    const exportList = []
    for (const asset of assetList) {
        if (asset.type === 'version_stack' || asset.type === 'folder') {
            // handle nested folders and version stacks etc
            exportList.push(...await createExportList(asset.id + '/children', fileTree + asset.name + '/'));
        } else if (asset.type === 'file') {
            exportList.push({
                url: asset['original'],
                name: fileTree + asset.name,
                filesize: asset.filesize
            });
        } else {
            console.log(assetList.type, 'unknown type'); // recursive 'if' above should prevent getting here
            throw('error: unknown type' + fileTree + '/' + assetList.name);
        }
    }
    console.log('list done');

    return exportList;
}


(async() => {
    checkEnvVars(ENV_VARS);

    let rawdata = fs.readFileSync('./request.json');
    console.log(`Request: ${rawdata}`);
    let request = JSON.parse(rawdata);

    const exportList = await createExportList(request['resource']['id'], '', request['data']['depth']);

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
