import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { SavedFile, Storage } from "../Storage";
import { env } from "../../env";

/** Local-disk provider: files live under UPLOAD_DIR, keyed by a random prefix + safe filename. */
export class LocalDiskStorage implements Storage {
  private root = path.resolve(env.UPLOAD_DIR);

  private resolveKey(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("invalid storage key");
    return full;
  }

  async save({ buffer, filename }: { buffer: Buffer; filename: string; mimetype: string }): Promise<SavedFile> {
    const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "file";
    const key = `${Date.now()}-${randomBytes(6).toString("hex")}-${safe}`;
    await mkdir(this.root, { recursive: true });
    await writeFile(this.resolveKey(key), buffer);
    return { key };
  }

  async openRead(key: string) {
    const full = this.resolveKey(key);
    const info = await stat(full);
    return { stream: createReadStream(full), size: info.size };
  }

  async remove(key: string): Promise<void> {
    await unlink(this.resolveKey(key)).catch(() => {});
  }
}
