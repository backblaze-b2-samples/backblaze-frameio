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

import createError from "http-errors" ;
import crypto from 'crypto' ;
import {FrameIO} from "./frameio.js" ;
import {getB2Connection, uploadUrlToB2, createB2SignedUrl} from "./b2.js" ;
import path from "path";
import {paginateListObjectsV2} from "@aws-sdk/client-s3";

export const IMPORT = 'Import';
export const EXPORT = 'Export';

export const ENV_VARS = [
    { varName: 'FRAMEIO_TOKEN', optional: false, display: false },
    { varName: 'FRAMEIO_SECRET', optional: false, display: false },
    { varName: 'AWS_ENDPOINT_URL', optional: true, display: true },
    { varName: 'AWS_ACCESS_KEY_ID', optional: true, display: true },
    { varName: 'AWS_SECRET_ACCESS_KEY', optional: true, display: false },
    { varName: 'AWS_REGION', optional: true, display: true },
    { varName: 'AWS_MAX_ATTEMPTS', optional: true, display: true },
    { varName: 'AWS_PROFILE', optional: true, display: true },
    { varName: 'BUCKET_NAME', optional: false, display: true },
    { varName: 'UPLOAD_PATH', optional: false, display: true },
    { varName: 'DOWNLOAD_PATH', optional: false, display: true },
    { varName: 'QUEUE_SIZE', optional: true, display: true },
    { varName: 'PART_SIZE', optional: true, display: true }
];

export function verifyTimestampAndSignature(req, res, buf) {
    // X-Frameio-Request-Timestamp header from incoming request
    const timestamp = req.header('X-Frameio-Request-Timestamp');
    // Epoch time in seconds
    const now = Date.now() / 1000;
    const FIVE_MINUTES = 5 * 60;

    if (!timestamp) {
        console.log('Missing timestamp')
        throw createError(403);
    }

    // Frame.io suggests verifying that the timestamp is within five minutes of local time
    if (timestamp < (now - FIVE_MINUTES) || timestamp > (now + FIVE_MINUTES)) {
        console.log(`Timestamp out of bounds. Timestamp: ${timestamp}; now: ${now}`);
        throw createError(403);
    }

    // Frame.io signature format is 'v0=' + HMAC-256(secret, 'v0:' + timestamp + body)
    const body = buf.toString();
    const stringToSign = 'v0:' + timestamp + ':' + body;
    const hmac = crypto.createHmac('sha256', process.env.FRAMEIO_SECRET);
    const expectedSignature = 'v0=' + hmac.update(stringToSign).digest('hex');

    if (expectedSignature !== req.header('X-Frameio-Signature')) {
        console.log(`Mismatched HMAC. Expecting '${expectedSignature}', received '${req.header('X-Frameio-Signature')}'`);
        throw createError(403);
    }
}

export async function formProcessor(req, res, next) {
    // frame.io callback form logic
    let formResponse;

    try {
        let data = req.body.data;

        if (!data || data['copytype']) {
            console.log(`Form processor request: ${JSON.stringify(req.body, null, 2)}`);
        }

        if (!data && req.body.type === "import-export") { // send user first question
            formResponse = {
                "title": "Import or Export?",
                "description": "Import from Backblaze B2, or export to Backblaze B2?",
                "fields": [{
                    "type": "select",
                    "label": "Import or Export",
                    "name": "copytype",
                    "options": [{
                        "name": "Export to Backblaze B2", "value": "export"
                    }, {
                        "name": "Import from Backblaze B2", "value": "import"
                    }]
                }]
            };
        } else  if ((!data && req.body.type === "export") || (data && data['copytype'] === "export")) {
            formResponse = {
                "title": "Specific Asset(s) or Whole Project?",
                "description": "Export the specific asset(s) selected or the entire project?",
                "fields": [{
                    "type": "select",
                    "label": "Specific Asset(s) or Entire Project",
                    "name": "depth",
                    "options": [{
                        "name": "Specific Asset(s)", "value": "asset"
                    }, {
                        "name": "Entire Project", "value": "project"
                    }]
                }]
            };
        } else if ((!data && req.body.type === "import") || (data && data['copytype'] === "import")) {
            // todo : possibly limit importing the export location
            formResponse = {
                "title": "Enter the location",
                "description": `Please enter the object path to import from Backblaze. As a reminder, your bucket name is ${process.env.BUCKET_NAME}.`,
                "fields": [{
                    "type": "text",
                    "label": "B2 Path",
                    "name": "b2path"
                }]
            };
        }

        if (formResponse) {
            console.log(`Form processor response: ${JSON.stringify(formResponse, null, 2)}`);
            return res.json(formResponse);
        }

        next();
    } catch (err) {
        console.log('Caught error in formProcessor: ', err);
        throw new Error('Caught error in formProcessor', { cause: err });
    }
}

async function createExportList(path, fileTree = '', depth = "asset") {
    const fio = new FrameIO();
    const assetIterator = await fio.getAssets(path);

    console.log(`createExportList for ${path}, ${fileTree ? fileTree : "[no filetree]"}, ${depth}`);

    // If 'project' is selected, initiate a top level project recursion
    if (depth === 'project') {
        const asset = (await assetIterator.next()).value;
        console.log(asset);
        return createExportList(asset['project']['root_asset_id'] + '/children', asset['project']['name'] + '/');
    }

    const exportList = []
    for await (const asset of assetIterator) {
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
            console.log('Asset? ', asset); // recursive 'if' above should prevent getting here
            return Promise.reject(new Error('error: unknown type ' + fileTree + '/' + asset.name));
        }
    }

    return exportList;
}

export async function exportFiles(request) {
    const exportList = await createExportList(request['resource']['id'], '', request['data']['depth']);

    const b2 = getB2Connection();

    const queueSize = parseInt(process.env.QUEUE_SIZE, 10);
    const partSize = parseInt(process.env.PART_SIZE, 10);
    const output = []
    for (const entry of exportList) {
        const key = path.posix.join(process.env.UPLOAD_PATH, entry.name);

        await uploadUrlToB2({
            client: b2,
            url: entry.url,
            bucket: process.env.BUCKET_NAME,
            key,
            name: entry.name,
            totalBytes: entry.filesize,
            queueSize,
            partSize,
            metadata: {
                frameio_name: entry.name,
                b2_keyid: process.env.ACCESS_KEY
            },
        });
        output.push(entry)
    }
    return output;
}

export async function importFiles(req) {
    const client = getB2Connection();
    const fio = new FrameIO();

    const download_folder_id = await fio.getAsset(req.resource.id).then(async (asset) => {
        const rootId = asset['project']['root_asset_id'];
        return await fio.getFolder(rootId, process.env.DOWNLOAD_PATH)
            || fio.createFolder(rootId, process.env.DOWNLOAD_PATH);
    });

    let search_prefix = req.data['b2path'];
    if (req.data['isPrefix']) {
        search_prefix += '/';
    }

    const bucket = process.env.BUCKET_NAME;
    const folderCache = new Map();

    async function getNameAndFolderId(download_folder_id, key) {
        let parentId = download_folder_id;
        let path = '';
        const segments = key.split('/');
        // remove exports folder name when re-importing
        if (segments[0] === process.env.UPLOAD_PATH) {
            segments.shift()
        }
        for (const segment of segments.slice(0, -1)) {
            const folderPath = path + '/' + segment;
            let folderId = folderCache.get(folderPath);
            if (!folderId) {
                folderId = await fio.getFolder(parentId, segment) || await fio.createFolder(parentId, segment);
                folderCache.set(path + '/' + segment, folderId);
            }
            path = folderPath;
            parentId = folderId;
        }
        return [segments[segments.length - 1], parentId];
    }

    const paginator = paginateListObjectsV2(
        {client},
        {Bucket: bucket, Prefix: search_prefix}
    );
    const assetPromises = [];
    for await (const { Contents } of paginator) {
        for (const obj of Contents) {
            const signedUrl = await createB2SignedUrl(client, bucket, obj.Key);
            const [name, folderId] = await getNameAndFolderId(download_folder_id, obj.Key);
            assetPromises.push(fio.createAsset(name, folderId, signedUrl, obj.Size));
        }
    }

    return (await Promise.allSettled(assetPromises)).map(({ value }) => value);
}
