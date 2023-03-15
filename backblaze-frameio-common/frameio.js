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
        const json = await response.json();
        if (!response.ok) {
            return Promise.reject(new Error(json));
        }
        if (json.length) {
            assets.push(...json);
        } else {
            assets.push(json);
        }

        if (response.headers["Page-Number"] === response.headers["Total-Pages"]) {
            break;
        }
        page++;
    }

    return assets;
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