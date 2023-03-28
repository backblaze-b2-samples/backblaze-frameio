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

import fetch from "node-fetch";

const TOKEN = process.env.FRAMEIO_TOKEN;
const TOO_MANY_REQUESTS = 429;
const PAUSE_MAX = 64000;

class FioError extends Error {
    constructor(response, body) {
        super(`Call to ${response.url} failed with status code ${response.status}\n${body}`);

        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, FioError);
        }

        this.name = "FioError";
    }
}

function pause(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// It's easy to provoke a 429 response, for example, when paging through a long list
// of assets, so we wrap the default fetch() to handle 429's in a single location
async function fetchWithBackoff(resource, options) {
    let response;
    let interval = 1000;

    let authOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
        }
    };

    options = {...authOptions, ...options};
    const method = options.method || "GET";

    while (interval <= PAUSE_MAX) {
        console.log(`fetchWithBackoff ${method}: ${resource.url || resource}`);
        if (["POST", "PUT", "PATCH"].includes(method)) {
            console.log('Body: ', options.body);
        }

        response = await fetch(resource, options);

        if (response.status !== TOO_MANY_REQUESTS) {
            break;
        }

        console.log(`API returned 429, pausing for ${interval} ms`);
        await pause(interval);

        interval *= 2;
    }

    return response;

}

export async function getFioFolder(parent_id, name) {
    const me = await fetchJson('https://api.frame.io/v2/me');
    const url = new URL(`https://api.frame.io/v2/search/library`);
    // Can't filter on name, so we have to search and check the name
    const body = JSON.stringify({
        account_id: me.account_id,
        q: name,
        filter: {
            "parent_id" : {
                "op": "eq",
                "value": parent_id
            },
        },
    });
    const response = fetchWithPaging(url.href, {
        method: 'POST',
        body: body
    });
    for await (const asset of response) {
        if (asset['name'] === name) {
            return asset['id'];
        }
    }
    return null;
}

export async function getFioAsset(id) {
    return fetchJson(`https://api.frame.io/v2/assets/${id}`);
}

export async function getFioAssets(id) {
    return fetchWithPaging(`https://api.frame.io/v2/assets/${id}`);
}

async function* fetchWithPaging(url, options) {
    let totalPages = 0; // 0 means 'unset', so just a single page
    let page = 1;

    while (true) {
        let path = url;
        if (page > 1) {
            const sep = url.includes('?') ? '&' : '?';
            path += `${sep}page=${page}`;
        }

        const response = await fetchWithBackoff(path, options);
        if (!response.ok) {
            throw new FioError(response, await response.text());
        }

        // Response can be an array or a single object depending on the endpoint
        const json = await response.json();
        if (json instanceof Array) {
            console.log(`${json.length} asset(s) returned`);
            for (const asset of json) {
                yield await Promise.resolve(asset);
            }
        } else {
            console.log("1 asset returned");
            yield await Promise.resolve(json);
        }

        // Endpoints that return a single object do not set the total-pages header
        if (totalPages === 0 && response.headers.has("total-pages")) {
            totalPages = parseInt(response.headers.get("total-pages"), 10);
        }

        if (!totalPages || page === totalPages) {
            break;
        }
        page++;
    }
}

// create folder in frameio
export async function createFioFolder(parent_id, name) {
    const body = JSON.stringify({
        'filesize': 0,
        'name': name,
        'type': 'folder'
    });
    const folder = await fetchJson(`https://api.frame.io/v2/assets/${parent_id}/children`, {
        method: 'POST',
        body: body
    });
    return folder.id;
}

async function fetchJson(path, opts) {
    const response = await fetchWithBackoff(path, opts);
    if (!response.ok) {
        throw new FioError(response, await response.text());
    }
    return response.json();
}

export async function createFioAsset(name, parent_id, signedUrl, filesize) {
    // create new single asset
    let path = `https://api.frame.io/v2/assets/${parent_id}/children`;
    const body = JSON.stringify({
        'filesize': filesize,
        'name': name,
        'type': 'file',
        'source': {'url': signedUrl}
    });
    return fetchJson(path, {
        method: 'POST',
        body: body
    });
}
