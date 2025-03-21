# Backblaze Custom Action for Frame.io

The Backblaze Custom Action for Frame.io allows you to quickly move data between [Backblaze B2](https://www.backblaze.com/b2/cloud-storage.html) and [Frame.io](https://frame.io/). Media professionals can use the action to export selected assets or whole projects from Frame.io to B2 Cloud Storage, and then later import exported assets and projects from B2 Cloud Storage back to Frame.io.

![Frame.io screenshot showing custom action on context menu](images/FrameioCustomAction.png)

The container should run on any container platform. We leverage the container platform to handle TLS termination. If you want to expose the container directly we **strongly** recommend you implement TLS within the app code directly.

## Create a Bucket in Backblaze B2

- [Sign up](https://www.backblaze.com/b2/sign-up.html?referrer=nopref) for a Backblaze account if you do not already have one.
- Sign in to the web console.
- Click **Buckets** under **B2 Cloud Storage** in the navigation menu on the left, then click **Create a Bucket**.
- Enter a bucket name; leave the rest of the settings with their defaults. Note that bucket names must be globally unique. It may take a couple of tries to find an unused bucket name.
- Click **Create a Bucket**.

## Create an Application Key in Backblaze B2

- Still in the Backblaze web console, click **App Keys** under **Account** in the left nav menu, then click **Add a New Application Key**.
- Supply a key name (key names need not be globally unique).
- Click the dropdown by **Allow access to Bucket(s):** and select the bucket you created in the previous step. Leave the rest of the settings with their defaults.
- Click **Create New Key**.
- **IMPORTANT**: make a note of the key ID and application key before leaving this page. You will not be able to go back and retrieve the application key later!

## Create a Custom Action in Frame.io

Login to the [Frame.io Developer Site](https://developer.frame.io/) and create a custom action (Developer Tools > Custom Actions > Create a Custom Action):

- NAME: Backblaze B2
- DESCRIPTION: Import or export assets and projects to Backblaze B2
- EVENT: import-export
- URL: *Set this to your container's endpoint*
- TEAM: Select your team
- ACCESS: Enable if you wish collaborators to have access to the custom action.

## Create a Token in Frame.io

Still in the Frame.io Developer Site, create a token (Developer Tools > Tokens > Create a Token). Provide a suitable token description, enable the **Create** and **Read** scopes under **Assets**, and click **Submit**.

## Configure the Container Environment

You need to set the following environment variables in the container environment. The easiest way to do this is to create a `.env` file.

- `FRAMEIO_TOKEN` = The Frame.io developer **token** you obtain from https://developer.frame.io/app/tokens
- `FRAMEIO_SECRET` = the Frame.io Custom Action **secret** you obtain from https://developer.frame.io/app/custom-actions
- `AWS_ACCESS_KEY_ID` = Your Backblaze B2 application key ID - it is strongly recommended this is unique for this app
- `AWS_SECRET_ACCESS_KEY` = Your Backblaze B2 application key - it is strongly recommended this is unique for this app
- `AWS_ENDPOINT_URL` = Your Backblaze B2 S3-compatible endpoint, in the form `https://s3.REGION.backblazeb2.com`
- `AWS_REGION` = The region from your Backblaze B2 S3-compatible endpoint, e.g. `us-west-004`
- `BUCKET_NAME` = Your Backblaze B2 bucket name
- `UPLOAD_PATH` = Path in Backblaze B2 for exports, for example `fio_exports`
- `DOWNLOAD_PATH` = Folder in Frame.io for imports, for example `b2_imports`

## Build and Start the Container

To build the Docker image:

```bash
docker build . -t backblaze-frameio
```

Docker responds with an image id. Start a container in daemon mode, listening on port 8888, with the `.env` file you created and the image ID:
```bash
docker run -d -p 8888:8888 --env-file .env backblaze-frameio
```

## Test the Web Service with the Test Client

Follow the instructions in the [test-client](test-client/) directory.
