/**
 * Thin layer over fflate so pack and unpack share one idea of the archive.
 * Entry order is the insertion order of the object handed to zipSync, and
 * fflate reports central-directory entries to the unzip filter in file order,
 * which is how the reader learns the order and method of each entry.
 */
import { unzipSync, zipSync, type Zippable } from "fflate";
import { CpkmnError } from "./errors";

export const METHOD_STORED = 0;
export const METHOD_DEFLATE = 8;

export interface ZipEntryInfo {
  name: string;
  /** PKZIP method: 0 stored, 8 deflate. */
  compression: number;
  size: number;
  originalSize: number;
}

export interface ZipWriteEntry {
  name: string;
  data: Uint8Array;
  stored: boolean;
}

export function writeZip(entries: readonly ZipWriteEntry[], mtime: Date): Uint8Array {
  const zippable: Zippable = {};
  for (const entry of entries) {
    if (entry.name in zippable) throw new CpkmnError("bad_input", `duplicate entry ${entry.name}`, entry.name);
    zippable[entry.name] = [entry.data, { level: entry.stored ? 0 : 6, mtime }];
  }
  return zipSync(zippable);
}

export interface ReadZipResult {
  /** Every file entry in central-directory order. Directory entries are skipped. */
  entries: ZipEntryInfo[];
  files: Record<string, Uint8Array>;
}

export function readZip(bytes: Uint8Array): ReadZipResult {
  const entries: ZipEntryInfo[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (info) => {
        if (info.name.endsWith("/")) return false;
        entries.push({
          name: info.name,
          compression: info.compression,
          size: info.size,
          originalSize: info.originalSize,
        });
        return true;
      },
    });
  } catch (error) {
    if (error instanceof CpkmnError) throw error;
    throw new CpkmnError("bad_zip", `not a readable zip archive: ${(error as Error).message}`);
  }
  return { entries, files };
}
