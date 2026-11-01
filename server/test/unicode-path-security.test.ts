import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFilePath } from "../src/project-path.js";
import { resolveEvidenceFolder } from "../src/scenario/evidence.js";
import { matchScreenshot } from "../src/scenario/screenshot-match.js";
import { encodePng } from "../src/media/png.js";

describe("physical filesystem aliases of protected folders", () => {
  let project: string;
  beforeEach(() => {
    project = realpathSync(mkdtempSync(join(tmpdir(), "gml-unicode-alias-")));
    mkdirSync(join(project, "addons", "mcp_loop"), { recursive: true });
  });
  afterEach(() => rmSync(project, { recursive: true, force: true }));
  it.for(["resolver", "baseline", "evidence"])("%s refuses a Unicode alias that the host resolves to the protected addon", (kind, ctx) => {
    const alias = join(project, "addonſ", "mcp_loop");
    if (!existsSync(alias)) { ctx.skip(); return; }
    const a = statSync(alias), b = statSync(join(project, "addons", "mcp_loop"));
    expect([a.dev, a.ino]).toEqual([b.dev, b.ino]);
    const path = "res://addonſ/mcp_loop/probe.png";
    const act = kind === "resolver" ? () => projectFilePath(project, path, { write: true })
      : kind === "baseline" ? () => matchScreenshot(project, encodePng({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) }), { baseline: path })
      : () => resolveEvidenceFolder(project, "res://addonſ/mcp_loop/evidence", false);
    expect(act).toThrowError(expect.objectContaining({ code: "PATH_FORBIDDEN" }));
  });
  it("keeps ordinary non-ASCII project folders writable", () => {
    mkdirSync(join(project, "素材"));
    expect(projectFilePath(project, "res://素材/new.png", { write: true }).res).toBe("res://素材/new.png");
  });
});
