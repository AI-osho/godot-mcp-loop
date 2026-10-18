#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { runCli, USAGE } from "./cli.js";
import { GodotConnection } from "./connection.js";
import { parseServerArgs } from "./projects.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "install-addon") process.exit(runCli(argv));
  const args = parseServerArgs(argv);
  if (args.version) {
    process.stdout.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);
    process.exit(0);
  }
  if (args.help) {
    process.stdout.write(
      `${USAGE}\nThe server's project defaults to $GODOT_PROJECT_PATH or the current directory; --projects-root (or ` +
        "$GODOT_PROJECTS_ROOT) defaults to none.\n",
    );
    process.exit(0);
  }
  for (const r of args.projectsRoots) {
    if (!existsSync(r)) process.stderr.write(`[${SERVER_NAME}] warning: projects root ${r} does not exist\n`);
  }
  const conn = new GodotConnection({ projectPath: args.project, projectsRoots: args.projectsRoots });
  const server = createServer(conn);
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; diagnostics go to stderr.
  const roots = args.projectsRoots.length > 0 ? `, projects roots: ${args.projectsRoots.join(", ")}` : "";
  process.stderr.write(`[${SERVER_NAME}] ready (project: ${args.project}${roots})\n`);
  const shutdown = () => {
    conn.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e: unknown) => {
  process.stderr.write(`[${SERVER_NAME}] fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
