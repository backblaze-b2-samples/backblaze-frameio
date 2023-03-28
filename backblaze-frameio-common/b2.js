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

import {GetObjectCommand, S3} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import stream from "stream";
import fetch from "node-fetch";

import {formatBytes} from "./utils.js";

class Uploader {
    // Defaults same as AWS SDK
    static defaultQueueSize = 4;
    static minPartSize = 1024 * 1024 * 5;
    // From S3/B2 specification
    static maxTotalParts = 10000;

    client;
    url;
    bucket;
    key;
    metadata;
    queueSize = Uploader.defaultQueueSize;
    partSize = Uploader.minPartSize;
    totalUploadedBytes = 0;
    totalBytes;

    constructor(options) {
        Object.assign(this, options)
        this.validatePartSize();
        this.adjustPartSize();
    }

    adjustPartSize() {
        const newPartSize = Math.ceil(this.totalBytes / Uploader.maxTotalParts);
        if (newPartSize > this.partSize) {
            this.partSize = newPartSize;
        }
        this.totalParts = Math.ceil(this.totalBytes / this.partSize);
    }

    validatePartSize() {
        if (this.partSize < Uploader.minPartSize) {
            throw new Error('partSize must be greater than ' + Uploader.minPartSize);
        }
    }

    async send() {
        console.log(`Creating multipart upload for ${this.bucket}/${this.key}`);
        console.log(`Reading ${this.totalBytes} bytes from ${this.url}`);
        const multipart = await this.client.createMultipartUpload({
            Bucket: this.bucket,
            Key: this.key,
            Metadata: this.metadata,
        });

        const lastPartSize = this.totalBytes % this.partSize;
        console.log(`Uploading ${this.totalParts - 1} parts of ${this.partSize} bytes plus 1 part of ${lastPartSize} bytes`)

        const promises = new Map();
        const completedParts = [];
        for (let partCount = 0; partCount < this.totalParts; partCount++) {
            const contentLength = (partCount < (this.totalParts - 1))
                ? this.partSize
                : lastPartSize;
            const partNumber = partCount + 1;

            const writeStream = new stream.PassThrough();
            const promise = this.client.uploadPart({
                Bucket: this.bucket,
                Key: this.key,
                Body: writeStream,
                PartNumber: partNumber,
                ContentLength: contentLength,
                UploadId: multipart['UploadId']
            }).then(response => {
                return {
                    ...response,
                    partNumber,
                    contentLength,
                };
            }, reason => {
                console.log("Uploader.send() - uploadPart() failed: ", reason)
                throw reason;
            });
            promises.set(partNumber, promise);

            const start = partCount * this.partSize;
            const end = (start + contentLength) - 1;
            fetch(this.url,{
                headers: {
                    'range': `bytes=${start}-${end}`
                }
            }).then(response => {
                if (response.status !== 206) {
                    const message = `Server for URL ${this.url} does not support range requests`;
                    console.log("Uploader.send() - " + message);
                    throw new Error(message)
                }
                response.body.pipe(writeStream);
            }, reason => {
                console.log("Uploader.send() - fetch() failed: ", reason)
                throw reason;
            });

            if (promises.size >= this.queueSize) {
                // Promise.race() returns the first *settled* promise, so if it is rejected,
                // the error is thrown from here by await. If we used Promise.any(), the error
                // would only be thrown if *all* the promises were rejected
                const part = await Promise.race(Array.from(promises.values()));
                this.completePart(completedParts, part);
                promises.delete(part.partNumber);
            }
        }

        // Wait for remaining parts to complete uploading
        const remainingParts = await Promise.all(Array.from(promises.values()));
        for (const part of remainingParts) {
            this.completePart(completedParts, part);
        }

        if (this.totalUploadedBytes !== this.totalBytes) {
            throw new Error(`Data missing - uploaded ${this.totalUploadedBytes} of ${this.totalBytes} bytes`);
        }

        console.log(`Completing multipart upload for ${this.bucket}/${this.key}`);
        return this.client.completeMultipartUpload({
            Bucket: this.bucket,
            Key: this.key,
            UploadId: multipart['UploadId'],
            MultipartUpload : {
                Parts: completedParts
            }
        }).then(_ => {
            console.log(`Completed multipart upload of ${this.totalUploadedBytes} bytes to ${this.bucket}/${this.key}`);
        }, reason => {
            console.log("Uploader.send() - completeMultipartUpload() failed: ", reason)
            throw reason;
        });
    }

    completePart(completedParts, part) {
        this.totalUploadedBytes += part.contentLength;
        console.log(`${this.key}: uploaded part ${part.partNumber}/${this.totalParts} ${formatBytes(this.totalUploadedBytes)}/${formatBytes(this.totalBytes)}`);
        completedParts[part.partNumber - 1] = {
            PartNumber: part.partNumber,
            ETag: part.ETag
        };
    }
}

export function uploadUrlToB2(options) {
    const uploader = new Uploader(options);
    return uploader.send();
}

export function getB2Connection(options) {
    return new S3({
        customUserAgent: 'b2-node-docker-0.2',
        region: options.endpoint.replaceAll(/https:\/\/s3\.(.*?)\.backblazeb2\.com/g, '$1'),
        ...options,
    });
}

export async function createB2SignedUrl(client, bucket, key, expiresIn) {
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
    });
    return await getSignedUrl(client, command, { expiresIn });
}

export async function getB2ObjectSize(client, bucket, key) {
    return new Promise((resolve, reject) =>
        client.headObject({
            Bucket: bucket,
            Key: key
        }, (err, response) => {
            if (err) {
                reject(err);
            } else {
                resolve(response['ContentLength']);
            }
        })
    );
}
