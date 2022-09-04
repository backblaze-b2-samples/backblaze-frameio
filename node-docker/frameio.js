import fetch from "node-fetch";

const TOKEN = process.env.FRAMEIO_TOKEN;

export async function getFioAssetsForProject(projectId) {
    let page = 1;
    const assets = [];
    while (true) {
        let path = `https://api.frame.io/v2/search/assets?project_id=${projectId}&page=${page}`;
        let requestOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`
            },
        };

        const response = await fetch(path, requestOptions);
        assets.push(...response.json());

        if (response.get("Page-Number") == response.get("Total-Pages")) {
            break;
        }
        page++;
    }

    return assets;
}

export async function getFioAssets(id) {
    let path = `https://api.frame.io/v2/assets/${id}`;
    let requestOptions = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
        }
    };

    const response = await fetch(path, requestOptions);

    return response.json();
}

export async function getFioRoot(id) {
    let path = `https://api.frame.io/v2/assets/${id}`;
    let requestOptions = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
        }
    };
    try {
        let request = await fetch(path, requestOptions);
        let r = await request.json();
        console.log('root:', r.project['root_asset_id']);
        return r.project['root_asset_id'];
    } catch(err) {
        console.log('error received: ', err);
        return { name: err };
    }
}

export async function createFioFolder(parent, name) {
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

export async function createFioAsset(name, parent, signedUrl, filesize) {
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
