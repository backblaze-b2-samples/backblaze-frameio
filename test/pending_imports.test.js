import assert from "node:assert/strict";
import test from "node:test";

import {
    encodeImportApprovalValue,
    parseImportApprovalValue,
    PendingImportStore
} from "../src/pending_imports.js";

function body(overrides = {}) {
    return {
        interaction_id: "interaction-1",
        user: {id: "user-1"},
        team: {id: "team-1"},
        resource: {id: "resource-1"},
        data: {b2path: "fio_exports/project"},
        ...overrides
    };
}

test("pending import approval requires matching nonce and identity", () => {
    const store = new PendingImportStore({now: () => 1000, nonce: () => "nonce-1"});
    const state = store.create("interaction-1", body(), {b2path: "fio_exports/project"});
    assert.equal(state.nonce, "nonce-1");

    assert.throws(() => store.consume(body({
        data: {proceed: "yes", pending_nonce: "wrong"}
    })), {status: 403});

    assert.throws(() => store.consume(body({
        user: {id: "user-2"},
        data: {proceed: "yes", pending_nonce: "nonce-1"}
    })), {status: 403});

    assert.deepEqual(store.consume(body({
        data: {proceed: "yes", pending_nonce: "nonce-1"}
    })), {b2path: "fio_exports/project"});
});

test("pending import approvals expire", () => {
    let now = 1000;
    const store = new PendingImportStore({ttlMs: 10, now: () => now, nonce: () => "nonce-1"});
    store.create("interaction-1", body(), {b2path: "fio_exports/project"});
    now = 1011;

    assert.throws(() => store.consume(body({
        data: {proceed: "yes", pending_nonce: "nonce-1"}
    })), {status: 403});
});

test("pending import creation requires Frame.io actor, team, and resource", () => {
    const store = new PendingImportStore({now: () => 1000, nonce: () => "nonce-1"});
    assert.throws(() => store.create("interaction-1", body({user: undefined}), {}), {status: 400});
    assert.throws(() => store.create("interaction-1", body({team: undefined}), {}), {status: 400});
    assert.throws(() => store.create("interaction-1", body({resource: undefined}), {}), {status: 400});
});

test("approval values carry the server nonce", () => {
    const encoded = encodeImportApprovalValue("yes", "nonce-1");
    assert.equal(encoded, "yes:nonce-1");
    assert.deepEqual(parseImportApprovalValue(encoded), {
        proceed: "yes",
        nonce: "nonce-1"
    });
    assert.throws(() => parseImportApprovalValue("yes"), {status: 400});
    assert.throws(() => parseImportApprovalValue("maybe:nonce-1"), {status: 400});
});
