import { readFileSync } from "node:fs";

/** Read from package.json (works from both src/ and dist/), the single source of truth. */
export const SERVER_VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;
