import type { Storage } from "./Storage";
import { LocalDiskStorage } from "./providers/local";
import { VercelBlobStorage } from "./providers/blob";
import { env } from "../env";

let instance: Storage | null = null;

/**
 * The active storage provider, chosen by STORAGE_PROVIDER (local | blob).
 * Unset, it defaults to blob whenever BLOB_READ_WRITE_TOKEN is present —
 * so production (Vercel injects the token) and local dev both pick the
 * durable store without extra config, and `STORAGE_PROVIDER=local` can
 * still force disk for offline work.
 */
export function getStorage(): Storage {
  if (!instance) {
    const provider = env.STORAGE_PROVIDER ?? (env.BLOB_READ_WRITE_TOKEN ? "blob" : "local");
    instance = provider === "blob" ? new VercelBlobStorage() : new LocalDiskStorage();
  }
  return instance;
}

export type { Storage, SavedFile } from "./Storage";
