import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
    assertAllowedB2ImportPath,
    getB2ObjectMetadata,
    verifyTimestampAndSignature
} from "../src/customaction.js";

function requestWithSignature(signature, timestamp) {
    return {
        method: "POST",
        url: "/",
        header(name) {
            return {
                "X-Frameio-Request-Timestamp": String(timestamp),
                "X-Frameio-Signature": signature
            }[name];
        }
    };
}

function captureLogs(fn) {
    const logs = [];
    const original = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
        fn();
    } finally {
        console.log = original;
    }
    return logs;
}

function frameioSignature(secret, timestamp, body) {
    return "v0=" + crypto
        .createHmac("sha256", secret)
        .update(`v0:${timestamp}:${body}`)
        .digest("hex");
}

function restoreEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

test("invalid Frame.io signatures do not leak signature material", () => {
    const previousSecret = process.env.FRAMEIO_SECRET;
    process.env.FRAMEIO_SECRET = "frameio-secret";
    const timestamp = Math.round(Date.now() / 1000);
    const body = "{\"type\":\"import-export\"}";
    const expected = frameioSignature(process.env.FRAMEIO_SECRET, timestamp, body);
    const received = "v0=" + "0".repeat(64);

    const logs = captureLogs(() => {
        assert.throws(() => verifyTimestampAndSignature(
            requestWithSignature(received, timestamp),
            null,
            Buffer.from(body)
        ), {status: 403});
    });

    assert.equal(logs.some(line => line.includes(expected)), false);
    assert.equal(logs.some(line => line.includes(received)), false);
    restoreEnv("FRAMEIO_SECRET", previousSecret);
});

test("valid Frame.io signatures are accepted", () => {
    const previousSecret = process.env.FRAMEIO_SECRET;
    process.env.FRAMEIO_SECRET = "frameio-secret";
    const timestamp = Math.round(Date.now() / 1000);
    const body = "{\"type\":\"import-export\"}";
    const signature = frameioSignature(process.env.FRAMEIO_SECRET, timestamp, body);

    assert.doesNotThrow(() => verifyTimestampAndSignature(
        requestWithSignature(signature, timestamp),
        null,
        Buffer.from(body)
    ));
    restoreEnv("FRAMEIO_SECRET", previousSecret);
});

test("B2 import path must stay under allowed prefix", () => {
    assert.equal(
        assertAllowedB2ImportPath("fio_exports/project/clip.mov", "fio_exports"),
        "fio_exports/project/clip.mov"
    );
    assert.equal(
        assertAllowedB2ImportPath("/fio_exports/project/", "fio_exports/"),
        "fio_exports/project"
    );
    assert.throws(() => assertAllowedB2ImportPath("", "fio_exports"), {status: 400});
    assert.throws(() => assertAllowedB2ImportPath("../fio_exports/clip.mov", "fio_exports"), {status: 400});
    assert.throws(() => assertAllowedB2ImportPath("fio_exports/../finance/payroll.csv", "fio_exports"), {status: 400});
    assert.throws(() => assertAllowedB2ImportPath("finance/payroll.csv", "fio_exports"), {status: 403});
    assert.throws(() => assertAllowedB2ImportPath("fio_exports_evil/clip.mov", "fio_exports"), {status: 403});
});

test("export object metadata contains no credential-derived fields", () => {
    const previousKeyId = process.env.B2_APPLICATION_KEY_ID;
    process.env.B2_APPLICATION_KEY_ID = "application-key-id";
    const metadata = getB2ObjectMetadata("clip.mov");
    assert.deepEqual(metadata, {frameio_name: "clip.mov"});
    assert.equal(Object.keys(metadata).some(key => /key|credential|secret/i.test(key)), false);
    assert.equal(Object.values(metadata).includes(process.env.B2_APPLICATION_KEY_ID), false);
    restoreEnv("B2_APPLICATION_KEY_ID", previousKeyId);
});
