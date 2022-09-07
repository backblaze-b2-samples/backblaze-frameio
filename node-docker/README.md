# Backblaze Custom Action for Frame.io - Generic Node.js Implementation

This is a generic Node.js implementation of the Backblaze Custom Action for Frame.io.

We specifically tested the container as a [Rising Cloud](https://risingcloud.com/) web service, but it should run on any container platform. This implementation forks child processes as workers; a [separate Rising Cloud-specific implementation](../node-risingcloud) uses Rising Cloud tasks. 

We leverage the container platform to handle TLS termination. If you want to expose the container directly we **strongly** recommend you implement TLS within the app code directly. 

***

You need to set the following environment variables in the container environment:

- FRAMEIO_TOKEN = The Frame.io developer /token/ you obtain from https://developer.frame.io/app/tokens
- FRAMEIO_SECRET = the Frame.io Custom Action /secret/ you obtain from https://developer.frame.io/app/custom-actions
- BUCKET_ENDPOINT = Your Backblaze B2 S3-compatible endpoint, in the form s3.REGION.backblazeb2.com
- BUCKET_NAME = Your Backblaze B2 bucket name
- ACCESS_KEY = Your Backblaze B2 access key - it is strongly recommended this is unique for this app
- SECRET_KEY = Your Backblaze B2 secret key - it is strongly recommended this is unique for this app
- UPLOAD_PATH = Path in Backblaze B2 for exports
- DOWNLOAD_PATH = Folder in Frame.io for imports
