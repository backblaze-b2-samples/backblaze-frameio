# Backblaze Custom Action for Frame.io - Rising Cloud Implementation

This is a version of the Backblaze Custom Action for Frame.io implemented to run on [Rising Cloud](https://risingcloud.com/). The custom action is structured as a web service and a task. The web service responds to HTTP requests from Frame.io and starts the tasks to handle each request asynchronously. The task exports assets from Frame.io to files in Backblaze B2, or imports files from Backblaze B2 to assets in Frame.io depending on the incoming request.

In **Auto Scaling Config** for the web service and the task, set a minimum of 1 worker to be ready to serve requests.

***

You need to set the following environment variables in Rising Cloud:

- FRAMEIO_TOKEN = The Frame.io developer *token* you obtain from https://developer.frame.io/app/tokens
- FRAMEIO_SECRET = the Frame.io Custom Action *secret* you obtain from https://developer.frame.io/app/custom-actions
- BUCKET_ENDPOINT = Your Backblaze B2 S3-compatible endpoint, in the form `s3.REGION.backblazeb2.com`
- BUCKET_NAME = Your Backblaze B2 bucket name
- ACCESS_KEY = Your Backblaze B2 access key - it is strongly recommended this is unique for this app
- SECRET_KEY = Your Backblaze B2 secret key - it is strongly recommended this is unique for this app
- UPLOAD_PATH = The path in Backblaze B2 to which files will be uploaded from Frame.io. For example, `fio_exports/`
- DOWNLOAD_PATH = The folder in Frame.io to which files will be downloaded from Backblaze B2. For example, `b2_imports`
- QUEUE_SIZE = The size of the concurrent queue manager to upload file parts in parallel to Backblaze B2. The uploader will buffer at most queueSize * partSize bytes into memory at any given time. For example, `4`
  PART_SIZE = The size in bytes for each individual part to be uploaded. For example, `5242880`
- TASK = The URL for the exporter task. For example, `https://my-task.risingcloud.app/`
- TASK_KEY = API key for the exporter
