/**
 * Object storage (S3-compatible bucket) helpers. Server-only.
 *
 * The client is created lazily so importing this module never throws (builds work
 * without secrets). Errors thrown from here are for server logs only; route handlers
 * must never forward their messages to clients (they can contain vendor endpoints).
 */
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";

interface StorageConfig {
  client: S3Client;
  bucket: string;
}

let config: StorageConfig | null = null;

/** Origin of the storage endpoint (used for presigned PUT and CSP connect-src). */
export function storageEndpoint(): string | null {
  if (process.env.R2_ENDPOINT) return process.env.R2_ENDPOINT.replace(/\/+$/, "");
  const accountId = process.env.R2_ACCOUNT_ID;
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null;
}

export function isStorageConfigured(): boolean {
  return !!(storageEndpoint() && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
}

function storage(): StorageConfig {
  if (config) return config;
  const endpoint = storageEndpoint();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "Object storage is not configured: set R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME."
    );
  }
  config = {
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint,
      // Path-style URLs keep presigned PUTs on the endpoint origin (one CSP connect-src entry).
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      // Presigned URLs and checksums: R2 does not need the newer default CRC headers,
      // and requiring them would break browser PUTs that cannot compute them.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
  return config;
}

export async function putObject(key: string, body: Buffer | Uint8Array | string, contentType: string): Promise<void> {
  const { client, bucket } = storage();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Deletes many objects (chunks of 1000). Returns keys that could not be deleted;
 * never throws, so callers can log orphans after the DB has already been updated.
 */
export async function deleteObjects(keys: string[]): Promise<string[]> {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (unique.length === 0) return [];
  const failed: string[] = [];
  let cfg: StorageConfig;
  try {
    cfg = storage();
  } catch (err) {
    console.error("[storage] deleteObjects: not configured", err);
    return unique;
  }
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    try {
      const res = await cfg.client.send(
        new DeleteObjectsCommand({
          Bucket: cfg.bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        })
      );
      for (const e of res.Errors ?? []) if (e.Key) failed.push(e.Key);
    } catch (err) {
      console.error("[storage] deleteObjects chunk failed:", err);
      failed.push(...chunk);
    }
  }
  if (failed.length) console.error(`[storage] ${failed.length} object(s) could not be deleted (orphaned):`, failed);
  return failed;
}

/** Best-effort single delete that only logs on failure (rollback paths). */
export async function deleteObjectQuietly(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch (err) {
    console.error(`[storage] failed to delete object ${key} (orphaned):`, err);
  }
}

export interface HeadResult {
  size: number;
  contentType: string | null;
}

/** HEAD an object; returns null when it does not exist. */
export async function headObject(key: string): Promise<HeadResult | null> {
  const { client, bucket } = storage();
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: Number(res.ContentLength ?? 0), contentType: res.ContentType ?? null };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const name = (err as { name?: string }).name;
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return null;
    throw err;
  }
}

export async function copyObject(sourceKey: string, destKey: string): Promise<void> {
  const { client, bucket } = storage();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: destKey,
      CopySource: `${bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`,
    })
  );
}

export async function getObject(key: string): Promise<GetObjectCommandOutput> {
  const { client, bucket } = storage();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`Object ${key} has no body`);
  return res;
}

export interface ObjectStream {
  stream: ReadableStream<Uint8Array>;
  contentLength: number | null;
}

/** Web ReadableStream for piping straight into a Response (no buffering). */
export async function getObjectWebStream(key: string): Promise<ObjectStream> {
  const res = await getObject(key);
  const body = res.Body as unknown as { transformToWebStream: () => ReadableStream<Uint8Array> };
  return {
    stream: body.transformToWebStream(),
    contentLength: res.ContentLength === undefined ? null : Number(res.ContentLength),
  };
}

/** Node Readable (used by the zip builder, which consumes Node streams). */
export async function getObjectNodeStream(key: string): Promise<Readable> {
  const res = await getObject(key);
  return res.Body as unknown as Readable;
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await getObject(key);
  const body = res.Body as unknown as { transformToByteArray: () => Promise<Uint8Array> };
  return Buffer.from(await body.transformToByteArray());
}

export async function getObjectText(key: string): Promise<string> {
  const res = await getObject(key);
  const body = res.Body as unknown as { transformToString: (enc?: string) => Promise<string> };
  return body.transformToString("utf-8");
}

/**
 * Presigned PUT URL. The client must send exactly the returned Content-Type.
 * Size is not part of the signature; the "complete" step HEADs the object and
 * enforces the real size against limits and quota.
 */
/**
 * Presigned PUT bound to an exact byte count: `content-length` is a signed header, so
 * the storage service rejects a body of any other size (no oversized orphan uploads).
 */
export async function presignPut(key: string, contentType: string, contentLength: number, expiresInSeconds = 900): Promise<string> {
  const { client, bucket } = storage();
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}
