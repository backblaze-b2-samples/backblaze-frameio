import assert from "node:assert/strict";
import test from "node:test";

import {getB2Connection, getB2MaxAttempts} from "../src/b2.js";
import {ENV_VARS} from "../src/customaction.js";
import {checkEnvVars} from "../src/utils.js";

const ENV_KEYS = [
    "FRAMEIO_TOKEN",
    "FRAMEIO_SECRET",
    "B2_APPLICATION_KEY_ID",
    "B2_APPLICATION_KEY",
    "B2_BUCKET_NAME",
    "B2_REGION",
    "B2_ENDPOINT",
    "B2_MAX_ATTEMPTS",
    "B2_ALLOWED_IMPORT_PREFIX",
    "UPLOAD_PATH",
    "DOWNLOAD_PATH",
    "QUEUE_SIZE",
    "PART_SIZE"
];

const LEGACY_PREFIX = "AWS";
const LEGACY_BUCKET_KEY = ["BUCKET", "NAME"].join("_");
const LEGACY_ENV_KEYS = [
    `${LEGACY_PREFIX}_ACCESS_KEY_ID`,
    `${LEGACY_PREFIX}_SECRET_ACCESS_KEY`,
    `${LEGACY_PREFIX}_REGION`,
    `${LEGACY_PREFIX}_ENDPOINT_URL`,
    LEGACY_BUCKET_KEY,
    `${LEGACY_PREFIX}_MAX_ATTEMPTS`
];

ENV_KEYS.push(...LEGACY_ENV_KEYS);

async function withEnv(values, fn) {
    const previous = new Map();
    for (const key of ENV_KEYS) {
        previous.set(key, process.env[key]);
        delete process.env[key];
    }
    Object.assign(process.env, values);
    try {
        return await fn();
    } finally {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

const REQUIRED_NON_B2_ENV = {
    FRAMEIO_TOKEN: "frameio-token",
    FRAMEIO_SECRET: "frameio-secret",
    UPLOAD_PATH: "fio_exports",
    DOWNLOAD_PATH: "b2_imports",
    QUEUE_SIZE: "16",
    PART_SIZE: "1073741824"
};

const B2_ENV = {
    B2_APPLICATION_KEY_ID: "b2-key-id",
    B2_APPLICATION_KEY: "b2-key",
    B2_BUCKET_NAME: "bucket",
    B2_REGION: ["us-west", "004"].join("-")
};

const LEGACY_ENV = {
    [`${LEGACY_PREFIX}_ACCESS_KEY_ID`]: "legacy-id",
    [`${LEGACY_PREFIX}_SECRET_ACCESS_KEY`]: "legacy-key",
    [`${LEGACY_PREFIX}_REGION`]: "legacy-region",
    [`${LEGACY_PREFIX}_ENDPOINT_URL`]: "https://legacy.example",
    [LEGACY_BUCKET_KEY]: "legacy-bucket"
};

test("B2 env contract accepts new-only and both-env startup", async () => {
    await withEnv({...REQUIRED_NON_B2_ENV, ...B2_ENV}, () => {
        assert.doesNotThrow(() => checkEnvVars(ENV_VARS));
    });

    await withEnv({
        ...REQUIRED_NON_B2_ENV,
        ...B2_ENV,
        ...LEGACY_ENV
    }, () => {
        assert.doesNotThrow(() => checkEnvVars(ENV_VARS));
    });
});

test("B2 env contract rejects old-only startup", async () => {
    await withEnv({
        ...REQUIRED_NON_B2_ENV,
        ...LEGACY_ENV,
        [`${LEGACY_PREFIX}_REGION`]: B2_ENV.B2_REGION,
        [`${LEGACY_PREFIX}_ENDPOINT_URL`]: `https://s3.${B2_ENV.B2_REGION}.backblazeb2.com`
    }, () => {
        assert.throws(
            () => checkEnvVars(ENV_VARS),
            err => err.error === "internal configuration"
        );
    });
});

test("B2_MAX_ATTEMPTS rejects invalid values", () => {
    for (const value of ["0", 0, "-1", "abc", "1x", " "]) {
        assert.throws(() => getB2MaxAttempts(value), /positive integer/);
    }
    assert.equal(getB2MaxAttempts("3"), 3);
});

test("S3 client uses B2 endpoint override and package user agent", async () => {
    await withEnv({
        ...REQUIRED_NON_B2_ENV,
        ...B2_ENV,
        B2_ENDPOINT: "http://localhost:9000"
    }, async () => {
        const client = getB2Connection();
        const endpoint = await client.config.endpoint();
        assert.equal(`${endpoint.protocol}//${endpoint.hostname}:${endpoint.port}`, "http://localhost:9000");
        assert.deepEqual(client.config.customUserAgent.flat(), ["b2-frameio-node-docker/0.0.1 (backblaze-b2-samples)"]);
    });
});
