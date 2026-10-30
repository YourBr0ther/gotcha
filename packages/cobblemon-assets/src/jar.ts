// Random-access reader for a zip/jar. Reads the central directory once, then
// inflates entries on demand with fflate. The jar is never unpacked to disk.
//
// fflate's sequential `Unzip` was tried first and rejected: Cobblemon's jar
// stores every entry with a data descriptor (sizes after the data), which
// makes the sequential parser scan byte by byte for the next header signature.
// That is slow over 140 MB and a signature inside deflate data would be read
// as a header. The central directory carries exact offsets and sizes, so each
// entry is read with one positioned read and inflated in memory.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { inflateSync } from "fflate";

export interface JarEntry {
  name: string;
  compressedSize: number;
  size: number;
  method: number;
  localHeaderOffset: number;
  crc32: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

export class JarReader {
  private readonly fd: number;
  readonly entries: ReadonlyMap<string, JarEntry>;
  readonly path: string;

  private constructor(path: string, fd: number, entries: Map<string, JarEntry>) {
    this.path = path;
    this.fd = fd;
    this.entries = entries;
  }

  static open(path: string): JarReader {
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      const entries = readCentralDirectory(fd, size);
      return new JarReader(path, fd, entries);
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }

  close(): void {
    closeSync(this.fd);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Entry names in central-directory order, optionally filtered by prefix. */
  names(prefix = ""): string[] {
    const out: string[] = [];
    for (const name of this.entries.keys()) {
      if (name.startsWith(prefix)) out.push(name);
    }
    return out;
  }

  read(name: string): Uint8Array {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`jar entry not found: ${name}`);
    // Local header: 30 fixed bytes + name + extra. The extra field length can
    // differ from the central copy, so read the local header to find the data.
    const header = Buffer.alloc(30);
    readFully(this.fd, header, entry.localHeaderOffset);
    if (header.readUInt32LE(0) !== SIG_LOCAL) {
      throw new Error(`bad local header for ${name} at ${entry.localHeaderOffset}`);
    }
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
    const compressed = Buffer.alloc(entry.compressedSize);
    readFully(this.fd, compressed, dataOffset);
    if (entry.method === 0) return new Uint8Array(compressed);
    if (entry.method === 8) return inflateSync(new Uint8Array(compressed), { out: new Uint8Array(entry.size) });
    throw new Error(`unsupported compression method ${entry.method} for ${name}`);
  }

  readText(name: string): string {
    return Buffer.from(this.read(name)).toString("utf8");
  }

  readJson<T = unknown>(name: string): T {
    const text = this.readText(name);
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(`invalid JSON in ${name}: ${(error as Error).message}`);
    }
  }
}

function readFully(fd: number, buffer: Buffer, position: number): void {
  let done = 0;
  while (done < buffer.length) {
    const n = readSync(fd, buffer, done, buffer.length - done, position + done);
    if (n === 0) throw new Error(`unexpected end of file at ${position + done}`);
    done += n;
  }
}

function readCentralDirectory(fd: number, fileSize: number): Map<string, JarEntry> {
  const tailLength = Math.min(fileSize, EOCD_MIN + MAX_COMMENT);
  const tail = Buffer.alloc(tailLength);
  readFully(fd, tail, fileSize - tailLength);
  let eocd = -1;
  for (let i = tailLength - EOCD_MIN; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file: end of central directory record not found");
  if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR) {
    throw new Error("zip64 archives are not supported");
  }
  const entryCount = tail.readUInt16LE(eocd + 10);
  const directorySize = tail.readUInt32LE(eocd + 12);
  const directoryOffset = tail.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error("zip64 archives are not supported");
  }

  const directory = Buffer.alloc(directorySize);
  readFully(fd, directory, directoryOffset);
  const entries = new Map<string, JarEntry>();
  let offset = 0;
  for (let i = 0; i < entryCount; i++) {
    if (directory.readUInt32LE(offset) !== SIG_CENTRAL) {
      throw new Error(`bad central directory entry at ${directoryOffset + offset}`);
    }
    const method = directory.readUInt16LE(offset + 10);
    const crc32 = directory.readUInt32LE(offset + 16);
    const compressedSize = directory.readUInt32LE(offset + 20);
    const size = directory.readUInt32LE(offset + 24);
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const localHeaderOffset = directory.readUInt32LE(offset + 42);
    const name = directory.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, { name, compressedSize, size, method, localHeaderOffset, crc32 });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
