/*
MIT License

Copyright (c) 2022 Backblaze

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */

import createError from "http-errors";
import crypto from "crypto";

export const DEFAULT_PENDING_IMPORT_TTL_MS = 5 * 60 * 1000;
const APPROVAL_VALUE_PATTERN = /^(yes|no):(.+)$/;

export function encodeImportApprovalValue(proceed, nonce) {
    return `${proceed}:${nonce}`;
}

export function parseImportApprovalValue(value) {
    if (typeof value !== 'string') {
        throw createError.BadRequest('Invalid import approval response');
    }

    const match = value.match(APPROVAL_VALUE_PATTERN);
    if (!match) {
        throw createError.BadRequest('Invalid import approval response');
    }

    return {
        proceed: match[1],
        nonce: match[2]
    };
}

function cloneData(data) {
    return JSON.parse(JSON.stringify(data));
}

function getFrameIoIdentity(body) {
    return {
        userId: body?.user?.id || body?.user_id || body?.actor?.id || body?.member?.id || null,
        teamId: body?.team?.id || body?.team_id || body?.account?.id || body?.resource?.team_id || null,
        resourceId: body?.resource?.id || null
    };
}

function identitiesMatch(left, right) {
    return left.userId === right.userId
        && left.teamId === right.teamId
        && left.resourceId === right.resourceId;
}

export class PendingImportStore {
    constructor({ttlMs = DEFAULT_PENDING_IMPORT_TTL_MS, now = () => Date.now(), nonce = () => crypto.randomUUID()} = {}) {
        this.ttlMs = ttlMs;
        this.now = now;
        this.nonce = nonce;
        this.pending = new Map();
    }

    create(interactionId, body, data) {
        if (!interactionId) {
            throw createError.BadRequest('Missing interaction_id');
        }

        const identity = getFrameIoIdentity(body);
        if (!identity.userId || !identity.teamId || !identity.resourceId) {
            throw createError.BadRequest('Missing Frame.io identity for bulk import approval');
        }

        const state = {
            nonce: this.nonce(),
            identity,
            data: cloneData(data),
            expiresAt: this.now() + this.ttlMs
        };
        this.pending.set(interactionId, state);
        return state;
    }

    consume(body) {
        const interactionId = body?.interaction_id;
        const state = this.pending.get(interactionId);
        if (!state) {
            throw createError.Forbidden('Unknown import approval');
        }

        if (this.now() > state.expiresAt) {
            this.pending.delete(interactionId);
            throw createError.Forbidden('Expired import approval');
        }

        const receivedNonce = body?.data?.pending_nonce;
        if (!receivedNonce || receivedNonce !== state.nonce) {
            throw createError.Forbidden('Invalid import approval');
        }

        const identity = getFrameIoIdentity(body);
        if (!identitiesMatch(identity, state.identity)) {
            throw createError.Forbidden('Import approval identity mismatch');
        }

        this.pending.delete(interactionId);
        return cloneData(state.data);
    }
}
