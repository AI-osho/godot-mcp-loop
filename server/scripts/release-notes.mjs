// Release notes for version X.Y.Z: the CHANGELOG section, install commands with the version pinned, and the
// checksums. Usage: node server/scripts/release-notes.mjs X.Y.Z SHA256SUMS.txt [--changelog CHANGELOG.md]
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const at = args.indexOf("--changelog");
const changelogPath = at >= 0 ? args.splice(at, 2)[1] : resolve(repo, "CHANGELOG.md");
const [version, sumsPath] = args;
if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !sumsPath) {
  process.stderr.write("Usage: node server/scripts/release-notes.mjs X.Y.Z SHA256SUMS.txt [--changelog CHANGELOG.md]\n");
  process.exit(2);
}

const text = readFileSync(changelogPath, "utf8");
const lines = text.split("\n");
const start = lines.findIndex((l) => l.startsWith(`## [${version}] - `));
if (start < 0) {
  process.stderr.write(`No '## [${version}] - <date>' section in ${changelogPath}\n`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
if (end < 0) end = lines.length;
// Link references at the end of the file ([0.6.0]: https://...) are not part of the section.
const section = lines
  .slice(start + 1, end)
  .filter((l) => !/^\[[^\]]+\]: /.test(l))
  .join("\n")
  .trim();

const sums = readFileSync(sumsPath, "utf8").trim();
const out = `${section}

### Install
\`\`\`bash
npx -y godot-mcp-loop@${version} install-addon /path/to/my-game --skill     # addon of the same version, enabled
claude mcp add godot-loop -- npx -y godot-mcp-loop@${version} --project /path/to/my-game
\`\`\`
Other clients: command \`npx\`, arguments \`-y godot-mcp-loop@${version} --project /path/to/my-game\` ([docs/clients.md](https://github.com/AI-osho/godot-mcp-loop/blob/v${version}/docs/clients.md)).

Manual install: unzip \`godot-mcp-loop-addon-${version}.zip\` into your project (\`addons/mcp_loop\`) and enable *MCP Loop* in
Project Settings › Plugins; \`npm install -g ./godot-mcp-loop-${version}.tgz\` for the server.

### SHA-256
\`\`\`
${sums}
\`\`\`

Full changelog: [CHANGELOG.md](https://github.com/AI-osho/godot-mcp-loop/blob/v${version}/CHANGELOG.md)
`;
process.stdout.write(out);
