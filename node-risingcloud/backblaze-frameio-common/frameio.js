const fetch = require("node-fetch");

const TOKEN = process.env.FRAMEIO_TOKEN;

async function getFioAssets(id) {
    let page = 1;
    let assets = [];
    while (true) {
        let path = `https://api.frame.io/v2/assets/${id}?page=${page}`;
        let requestOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`
            }
        };

        const response = await fetch(path, requestOptions);
        if (response.length) {
            assets.push(...response.json());
        } else {
            assets.push(response.json());
        }

        if (response.headers["Page-Number"] === response.headers["Total-Pages"]) {
            break;
        }
        page++;
    }

    return assets.length > 1 ? assets : assets[0];
}

async function createFioFolder(parent, name) {
    // create folder in frameio

    // check if folder already exists
    let children = await getFioAssets(parent + '/children');
    for (const child of children) {
        if (child['name'] === name) {
            return child['id'];
        }
    }

    let path = `https://api.frame.io/v2/assets/${parent}/children`;
    const body = JSON.stringify({
        'filesize': 0,
        'name': name,
        'type': 'folder'
    });

    let requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
        },
        body: body
    };

    const resp = await fetch(path, requestOptions);
    const data = await resp.json();
    return data.id;
}

async function createFioAsset(name, parent, signedUrl, filesize) {
    // create new single asset
    let path = `https://api.frame.io/v2/assets/${parent}/children`;
    const body = JSON.stringify({
        'filesize': filesize,
        'name': name,
        'type': 'file',
        'source': {'url': signedUrl}
    });

    let requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
        },
        body: body
    };

    const resp = await fetch(path, requestOptions);
    return resp.json();
}

module.exports = {
    createFioAsset,
    createFioFolder,
    getFioAssets
};