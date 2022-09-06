const fs = require('fs');

const {checkEnvVars} = require("backblaze-frameio-common/utils");
const {createFioAsset, createFioFolder, getFioAssets} = require("backblaze-frameio-common/frameio");
const {getB2Conn, createB2SignedUrls} = require("backblaze-frameio-common/b2");

const ENV_VARS = [
    'BUCKET_ENDPOINT',
    'BUCKET_NAME',
    "ACCESS_KEY",
    "SECRET_KEY",
    "DOWNLOAD_PATH",
    "UPLOAD_PATH",
    "FRAMEIO_TOKEN"
];


(async() => {
    checkEnvVars(ENV_VARS);

    let rawdata = fs.readFileSync('./request.json');
    console.log(`Request: ${rawdata}`);
    const req = JSON.parse(rawdata);

    const b2 = getB2Conn();

    // We can create the signed URL at the same time as the download folder
    const promises = [];
    promises.push(createB2SignedUrls(b2, req.data['b2path']));
    promises.push(getFioAssets(req.resource.id).then((asset) => {
        const rootId = asset['project']['root_asset_id'];
        console.log('root:', rootId);
        return createFioFolder(rootId, process.env.DOWNLOAD_PATH);
    }));

    // remove exports folder name when re-importing
    const name = req.data['b2path'].replace(process.env.UPLOAD_PATH, '');
    const output = await Promise.all(promises).then(async (values) => {
        const signedUrl = values[0];
        const parent = values[1];

        return createFioAsset(name, parent, signedUrl, req.filesize);
    });

    const response = {
        b2path: req.data['b2path'],
        id: req.resource.id,
        filesize: req.filesize,
        ...output
    };

    const data = JSON.stringify(response, null, 2);
    console.log(`Response: ${data}`);
    fs.writeFileSync('./response.json', data);
})();
