# Backblaze Custom Action for Frame.io - Rising Cloud Implementation

This is a version of the Backblaze Custom Action for Frame.io implemented to run on [Rising Cloud](https://risingcloud.com/). The custom action is structured as a web service and a task. The web service responds to HTTP requests from Frame.io and starts a task to handle each request asynchronously. The task exports assets from Frame.io to files in Backblaze B2, or imports files from Backblaze B2 to assets in Frame.io depending on the incoming request.

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
- URL: *set this to a dummy value, such as `https://example.com`, for now*
- TEAM: Select your team
- ACCESS: Enable if you wish collaborators to have access to the custom action.

## Create a Token in Frame.io

Still in the Frame.io Developer Site, create a token (Developer Tools > Tokens > Create a Token). Provide a suitable token description, enable the **Create** and **Read** scopes under **Assets**, and click **Submit**. 

## Deploying the Custom Action to Rising Cloud

First, clone this repository to your local drive:

```bash
git clone https://github.com/backblaze-b2-samples/backblaze-frameio.git
```

In order to run the Rising Cloud commands in this section, you will need to [install](https://risingcloud.com/docs/install) the Rising Cloud Command Line Interface. This program provides you with the utilities to setup the Rising Cloud Task and Web Service, uploadUrlToB2 the applications to Rising Cloud, setup authentication, and more.

Login with the email address and password you configured for Rising Cloud:

```bash
risingcloud login
```

### Deploy the Custom Action Task to Rising Cloud

In the root directory of the repository, create a new Rising Cloud task, replacing $TASK with your unique task name:

```bash
risingcloud init -c task.yaml -s $TASK
```

Edit `task.yaml`:

- Set `from:` to `ubuntu:22.04`
- Replace `deps: []` with the following:
  ```yaml
  deps:
  - curl -sL https://deb.nodesource.com/setup_18.x -o nodesource_setup.sh
  - bash nodesource_setup.sh
  - apt-get install -y nodejs
  - bash -c "(cd node-risingcloud/task; npm install)"
  ```
  The Rising Cloud build process will run these commands in the container, downloading and installing Node.js and running `npm install` to install the apps' dependencies.
- Set `run:` to `node node-risingcloud/task/app.js`
- Replace `env: []` with the following, substituting your values in the environment variables. 
  ```yaml
  env:
    BUCKET_NAME: <your bucket in B2>
    BUCKET_ENDPOINT: <your bucket endpoint>
    ACCESS_KEY: <your B2 key id>
    SECRET_KEY: <your B2 application key>
    FRAMEIO_TOKEN: <your Frame.io API token>
    QUEUE_SIZE: <optional, defaults to 4 - queue size for exporting files to B2>
    PART_SIZE: <optional, defaults ot 5242880 - part size, in bytes, for exporting files to B2>
    UPLOAD_PATH: <optional, defaults to fio_exports - path in B2 for exported files> 
    DOWNLOAD_PATH: <optional, defaults to b2_imports - folder in Frame.io for imported files>
  ```
- Set `minWorkers:` to `1` if you wish to keep a worker running to more quickly process requests.

Run the following command to push the updated configuration to Rising Cloud, build, and deploy the task:

```bash
risingcloud build -r -d -c task.yaml
```

Check that the task builds and starts successfully in the Rising Cloud web console.

Go to the task's Security configuration, enable **Require app users use an API key to send jobs to this task.**, add an API key, and make a note of the value. You'll need this in the next step.

### Deploy the Rising Cloud Web Service

In the root directory of the repository, create a new Rising Cloud web service, replacing $WEB_SERVICE with your unique web service name:

```bash
risingcloud init -c webservice.yaml -w $WEB_SERVICE
```

Edit `webservice.yaml`:

- Replace `env: []` with the following, substituting your values in the environment variables.
  ```yaml
  env:
    BUCKET_NAME: <your bucket in B2>
    BUCKET_ENDPOINT: <your bucket endpoint>
    ACCESS_KEY: <your B2 key id>
    SECRET_KEY: <your B2 application key>
    FRAMEIO_SECRET: <your Frame.io custom action secret>
    TASK: <Your task URL, in the form https://$TASK.risingcloud.app >
    TASK_KEY: <Your task API key from the previous step>
  ```
- Set `minWorkers:` to `1` if you wish to keep a worker running to more quickly process requests.

Run the following command to push the updated configuration to Rising Cloud, build, and deploy the task:

```bash
risingcloud build -r -d -c webservice.yaml
```

Check that the web service builds and starts successfully in the Rising Cloud web console.

## Update the Custom Action Configuration in Frame.io

Return to the custom action in the Frame.io Developer Site, click the pen icon to edit your custom action, and enter your web service URL in place of the dummy value. The URL has the form:

```
https://$WEB_SERVICE.risingcloud.app
```

## Test the Web Service with the Test Client

Follow the instructions in the [test-client](../test-client) directory.
