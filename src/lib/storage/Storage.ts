import type { Readable } from "node:stream";

/**
 * The file-storage abstraction (mirrors the mail one): callers depend only on
 * this interface; the provider (local disk now, S3-compatible later) is chosen
 * in src/lib/storage/index.ts.
 */
export type SavedFile = { key: string };

export interface Storage {
  /** Persist a file, returns the key used to read/delete it later. */
  save(input: { buffer: Buffer; filename: string; mimetype: string }): Promise<SavedFile>;
  /** Open a stored file for streaming; throws if the key doesn't exist. */
  openRead(key: string): Promise<{ stream: Readable; size: number }>;
  /** Remove a stored file; missing keys are a no-op. */
  remove(key: string): Promise<void>;
}
