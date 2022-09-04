import {createFioAsset, createFioFolder, getFioRoot} from "./frameio.js";
import {createB2SignedUrls, getB2Conn} from "./b2.js";


process.on('message', async ({b2path, id, objectSize: filesize}) => {
    // make sure not importing from UPLOAD_PATH ?
    const b2 = getB2Conn();

    // We can create the signed URL at the same time as the download folder
    const promises = [];
    promises.push(createB2SignedUrls(b2, b2path));
    promises.push(getFioRoot(id).then((root) => {
        return createFioFolder(root, process.env.DOWNLOAD_PATH);
    }));

    // remove exports folder name when re-importing
    const name = b2path.replace(process.env.UPLOAD_PATH, '');
    await Promise.all(promises).then(async (values) => {
        const signedUrl = values[0];
        const parent = values[1];

        return createFioAsset(name, parent, signedUrl, filesize);
    });

    console.log('Submitted import: ', b2path);
    process.exit(0);
});