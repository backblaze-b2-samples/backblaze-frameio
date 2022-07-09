# Backblaze / Frame.io connector

This is a Docker version of the 'Archive to Backblaze' connector for Frame.io

We specifically tested the container using [Rising Cloud](https://risingcloud.com/) as a web service, but it should run on any container platform. 

If using Rising Cloud, please override the default autoscaling and set a minimum of '1' worker to be ready to serve requests. You will also want to set the 'Expose Port' to 8675. 

We leverage the container platform to handle TLS termination. If you want to expose the container directly we **strongly** recommend you implement TLS within the app code directly. 

***

You need to set the following environment variables in the container environment:

- FRAMEIO_TOKEN = The Frame.io developer /token/ you obtain from https://developer.frame.io/app/tokens
- FRAMEIO_SECRET = the Frame.io Custom Action /secret/ you obtain from https://developer.frame.io/app/custom-actions
- BUCKET_ENDPOINT = Your Backblaze B2 S3-compatible endpoint, in the form s3.REGION.backblazeb2.com
- BUCKET_NAME = Your Backblaze B2 bucket name
- ACCESS_KEY = Your Backblaze B2 access key - it is strongly recommended this is unique for this app
- SECRET_KEY = Your Backblaze B2 secret key - it is strongly recommended this is unique for this app

