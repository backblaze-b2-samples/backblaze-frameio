import {importFiles, exportFiles} from "../backblaze-frameio-common/customaction.js";


process.on('message', async (request) => {
    // Don't need to check environment variables, since the task inherits them from the web service

    console.log(`Request: ${JSON.stringify(request, null, 2)}`);
    const response = (request['data']['depth']) ? await exportFiles(request) : await importFiles(request);
    console.log(`Response: ${JSON.stringify(response, null, 2)}`);
    console.log("Task complete; exiting.")

    process.exit(0);
});

