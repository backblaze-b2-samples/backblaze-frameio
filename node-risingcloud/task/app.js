const fs = require('fs');

const {checkEnvVars} = require("backblaze-frameio-common/utils");
const {exportFiles, importFiles} = require("backblaze-frameio-common/customaction")

const ENV_VARS = [
    "BUCKET_NAME",
    "BUCKET_ENDPOINT",
    "ACCESS_KEY",
    "SECRET_KEY",
    "QUEUE_SIZE",
    "PART_SIZE",
    "FRAMEIO_TOKEN",
    "DOWNLOAD_PATH",
    "UPLOAD_PATH"
];


(async() => {
    checkEnvVars(ENV_VARS);

    let rawdata = fs.readFileSync('./request.json');
    console.log(`Request: ${rawdata}`);
    let request = JSON.parse(rawdata);

    const output = (request['data']['depth']) ? await exportFiles(request) : await importFiles(request);

    let response = {"exportList": output};
    const data = JSON.stringify(response, null, 2);
    console.log(`Response: ${data}`);
    fs.writeFileSync('./response.json', data);

    console.log("Task complete.")
})();
