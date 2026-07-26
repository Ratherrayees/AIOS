/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "node_modules", "supabase", "dist", "supabase.js");
const result = spawnSync(
  process.execPath,
  [cli, "gen", "types", "--local", "--schema", "public"],
  {
    cwd: root,
    encoding: "utf8",
  },
);

if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);

const output = `${result.stdout.trimEnd()}\n`;
fs.writeFileSync(path.join(root, "types", "database.ts"), output, "utf8");
