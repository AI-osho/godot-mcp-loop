#!/usr/bin/env node
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runCli, USAGE } from "./cli.js";
import { GodotConnection } from "./connection.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

function parseArgs(argv: string[]): { project: string } {
  let project = process.env.GODOT_PROJECT_PATH ?? process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project" && argv[i + 1]) {
      project = argv[++i] as string;
    } else if (a?.startsWith("--project=")) {
      project = a.slice("--project=".length);
    } else if (a === "--version") {
      process.stdout.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);
      process.exit(0);
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(`${USAGE}\nThe server's project defaults to $GODOT_PROJECT_PATH or the current directory.\n`);
      process.exit(0);
    }
  }
  return { project: resolve(project) };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "install-addon") process.exit(runCli(argv));
  const { project } = parseArgs(argv);
  const conn = new GodotConnection({ projectPath: project });
  const server = createServer(conn);
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; diagnostics go to stderr.
  process.stderr.write(`[${SERVER_NAME}] ready (project: ${project})\n`);
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
