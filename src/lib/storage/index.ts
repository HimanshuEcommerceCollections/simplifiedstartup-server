import type { Storage } from "./Storage";
import { LocalDiskStorage } from "./providers/local";

let instance: Storage | null = null;

/** The active storage provider (local disk for now; S3-compatible later). */
export function getStorage(): Storage {
  if (!instance) instance = new LocalDiskStorage();
  return instance;
}

export type { Storage, SavedFile } from "./Storage";
