import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { BridgeError } from "./errors.js";

export const FILE_READ_LIMITS = {
  metadata: 64 * 1024,
  text: 1024 * 1024,
  evidence: 8 * 1024 * 1024,
  png: 32 * 1024 * 1024,
  log: 16 * 1024,
} as const;

function openRegular(path: string, maxBytes: number): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid internal read budget.");
  if (!lstatSync(path).isFile()) throw new BridgeError("INVALID_PARAMS", "Expected a non-symbolic regular input file.");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  if (!fstatSync(fd).isFile()) {
    closeSync(fd);
    throw new BridgeError("INVALID_PARAMS", "Expected a regular input file.");
  }
  return fd;
}

/** Read one stable regular-file generation, never allocate the full size of an unbounded local input. */
export function readFileBounded(path: string, maxBytes: number): Buffer {
  const fd = openRegular(path, maxBytes);
  try {
    const size = fstatSync(fd).size;
    if (size > maxBytes) throw new BridgeError("INVALID_PARAMS", `Local input exceeds its ${maxBytes}-byte read limit.`);
    const data = Buffer.allocUnsafe(size + 1);
    let length = 0;
    while (length < data.length) {
      const read = readSync(fd, data, length, data.length - length, length);
      if (read === 0) break;
      length += read;
    }
    // A growing input must not bypass the pre-read check or become a silently truncated JSON/INI document.
    if (length !== size || fstatSync(fd).size !== size) {
      throw new BridgeError("INVALID_PARAMS", "The local input changed while it was being read; retry after its writer finishes.");
    }
    return data.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

export function readTextFileBounded(path: string, maxBytes: number): string {
  return readFileBounded(path, maxBytes).toString("utf8");
}

/** Logs may be large: seek to a bounded tail instead of materializing the discarded prefix. */
export function readTextFileTail(path: string, maxBytes: number): string {
  const fd = openRegular(path, maxBytes);
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const data = Buffer.allocUnsafe(Math.min(size, maxBytes));
    let length = 0;
    while (length < data.length) {
      const read = readSync(fd, data, length, data.length - length, start + length);
      if (read === 0) break;
      length += read;
    }
    return data.subarray(0, length).toString("utf8");
  } finally {
    closeSync(fd);
  }
}
