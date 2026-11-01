import { expect, it, vi } from "vitest";

// Model Windows path and directory semantics on the current host; native Windows remains a separate qualification.
vi.mock("node:path", async (original) => {
  const path = await original<typeof import("node:path")>();
  return { ...path, dirname: path.win32.dirname, join: path.win32.join };
});
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    readdirSync: (dir: string) => {
      if (dir !== "C:\\project\\build\\web") throw new Error("ENOENT: wrong directory");
      return ["index.html", "index.wasm"];
    },
    statSync: (file: string) => {
      if (!/^C:\\project\\build\\web\\index\.(html|wasm)$/.test(file)) throw new Error("ENOENT");
      return { isFile: () => true, size: 3 };
    },
  };
});

import { exportedFiles } from "../src/export.js";

it("uses the host-native parent directory for a Windows Web output", () => {
  const files = exportedFiles("C:\\project\\build\\web\\index.html");
  expect(files.map((f) => f.path)).toEqual([
    "C:\\project\\build\\web\\index.html",
    "C:\\project\\build\\web\\index.wasm",
  ]);
});
