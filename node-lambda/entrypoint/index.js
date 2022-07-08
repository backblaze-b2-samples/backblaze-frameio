const AWS = require('aws-sdk');
const fetch = require('node-fetch');
var crypto = require('crypto');

async function fetchAssetInfo (id) {

    const token = process.env.FRAMEIO_TOKEN;

    let path = `https://api.frame.io/v2/assets/${id}`;
    let requestOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };
    try {
        let response = await fetch(path, requestOptions);
        let result = await response.json();
        console.log(`undefined = 1 object, otherwise multiple: ${result.length}`);
        //console.log('result: ' + JSON.stringify(result, null, 2));
        //console.log(`length: ${Object.keys(result).length}`);

        if (result._type == 'version_stack') {
            console.log(`version_stack detected: ${result.id})`);
            let {url, name} = await fetchAssetInfo(result.id + '/children');
            //console.log('in stack ' + JSON.stringify(versionStack));
            console.log("version_stack processing finished");
            return { url: '', name: "Version Stack named: " + result.name };
        }

        if ( result.length ) { // more than one result means it's a folder or version_stack and we need to iterate
            for (const item of Object.keys(result)) {
                    console.log(`version_stack child item type: ${result[item]._type}`);
                    if (result[item]._type == 'file') {
                        console.log(`version_stack child upload : ${result[item].name} `);
                        await invokeUploader(result[item].original, result[item].name);
                    } else {
                        console.log("version_stack child type not supported, or not found");
                        //console.log(`version_stack child full :` + JSON.stringify(item, null, 2));
                        throw `archiveType: ${result[item]} version_stack child unknown or project_id : ${result[item].project_id} not found `;
                    }
            }
            return{};

        } else {
            console.log(`begin typing: ${result._type}`);
            if (result._type == 'file') {
                console.log(`item is file type: ${result.name}`);
                return { url: result.original, name: result.name };
            } else {
                console.log("type not supported, or not found");
                //console.log(`printout full :` + JSON.stringify(result, null, 2));
                throw `archiveType: ${result._type} unknown or project_id : ${result.project_id} not found `;
            }
        }
    } catch(err) {
        console.log(`error received: ${err}`);
        if ( err.startsWith("archiveType: ") ) {
            return { url: err };
        }
        return (`error: ${err}`);
    }
}

function invokeUploader (url, name) { 

    const lambda = new AWS.Lambda();

    let req = {
        FunctionName: 'upload-to-b2',
        InvocationType: 'Event', // returns statusCode 202 on success. See invoke() SDK for info
        Payload: JSON.stringify({
            url: url, 
            name: name })
    };

    return lambda.invoke(req).promise();
}

function matchingHMAC (stringToHash) {
    var hmac = crypto.createHmac('sha256', process.env.FRAMEIO_SECRET);
    console.log(stringToHash);
    data = hmac.update(stringToHash);
    gen_hmac = data.digest('hex');
    console.log("hmac:" + gen_hmac);
    return(gen_hmac);
};

exports.handler = async function (event, context) {
    //const caller = context.functionName;
    console.log(JSON.stringify(event));
    
    let sigString = 'v0:' + event.headers['X-Frameio-Request-Timestamp'] + ':' + JSON.stringify(event.body);

    console.log(matchingHMAC(sigString));
    console.log("v0=" + event.headers['X-Frameio-Request-Timestamp']);
    if (("v0=" + matchingHMAC(sigString)) != (event.headers['X-Frameio-Request-Timestamp'])) {
        return('error prohibited. mismatched hmac');
    };

    let id = JSON.parse(event.body).resource.id;
    let { url, name} = await fetchAssetInfo(id);

    try {
        if ( typeof url !== 'undefined' && url ) {
            await invokeUploader(url, name);
        }

        if ( url.startsWith("archiveType: ")) {
            let returnPayload = {
                statusCode: 202, 
                body: JSON.stringify({
                    'title': `Job rejected.`,
                    'description': `Only "file" archive is currently implemented, not ${url}. Coming soon!`
                })
            };
            return returnPayload;
        }

        let returnPayload = {
            statusCode: 202, 
            body: JSON.stringify({
                'title': `Job received!`,
                'description': `Your archive job for '${name}' has been triggered.`
            })
        };
        return returnPayload;

    } catch(err) {
        console.log(`ERROR Hit a problem: ${err.message}`);
        return err;
    }
};