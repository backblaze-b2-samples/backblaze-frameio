function formatBytes(bytes, decimals= 1) {
    if (bytes === 0) return '0 Bytes';

    const k = 1000;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function checkEnvVars(env_vars) {
    // make sure the environment variables are set
    try {
        env_vars.forEach(element => {
            console.log('checking: ', element);
            if (!process.env[element]) {
                throw(`Environment variable not set: ${element}`);
            }
        })
    } catch(err) {
        console.log('ERROR checkEnvVars: ', err);
        throw({'error': 'internal configuration'});
    }
}

module.exports = {
    formatBytes,
    checkEnvVars
};