import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { del, list, put } from "@vercel/blob";
import type { SavedFile, Storage } from "../Storage";

/**
 * Vercel Blob provider: durable object storage for serverless deploys, where
 * local disk is ephemeral. Reads BLOB_READ_WRITE_TOKEN from the environment
 * (the SDK picks it up itself). Blobs are "public" but their URLs are never
 * exposed — everything is served through our routes, so CV access stays
 * login-gated exactly like the local-disk provider.
 */
export class VercelBlobStorage implements Storage {
  /** Keys are single path segments; anything else would escape /files/:key. */
  private assertKey(key: string): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key)) throw new Error("invalid storage key");
  }

  private async find(key: string) {
    this.assertKey(key);
    const { blobs } = await list({ prefix: key, limit: 1 });
    return blobs.find((b) => b.pathname === key) ?? null;
  }

  async save({ buffer, filename, mimetype }: { buffer: Buffer; filename: string; mimetype: string }): Promise<SavedFile> {
    const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "file";
    const key = `${Date.now()}-${randomBytes(6).toString("hex")}-${safe}`;
    await put(key, buffer, {
      access: "public",
      contentType: mimetype,
      addRandomSuffix: false, // the key is already unique + unguessable
    });
    return { key };
  }

  async openRead(key: string) {
    const blob = await this.find(key);
    if (!blob) throw new Error(`no such blob: ${key}`);
    const res = await fetch(blob.url);
    if (!res.ok || !res.body) throw new Error(`blob fetch failed (${res.status}): ${key}`);
    return { stream: Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), size: blob.size };
  }

  async remove(key: string): Promise<void> {
    const blob = await this.find(key).catch(() => null);
    if (blob) await del(blob.url).catch(() => {});
  }
}
