/* eslint-disable @typescript-eslint/no-require-imports */

const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const configPath = resolve(process.cwd(), "supabase", "config.toml");
const config = readFileSync(configPath, "utf8");
const projectId = config.match(/^project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*$/m)?.[1];

if (!projectId) {
  throw new Error(`Could not read a safe project_id from ${configPath}.`);
}

const gatewayContainer = `supabase_kong_${projectId}`;
const inspect = spawnSync(
  "docker",
  ["inspect", gatewayContainer, "--format", "{{.State.Status}}"],
  { encoding: "utf8" },
);

if (inspect.status !== 0 || inspect.stdout.trim() !== "running") {
  const detail = inspect.stderr.trim() || inspect.stdout.trim() || "not running";
  throw new Error(`Local Supabase gateway ${gatewayContainer} is unavailable: ${detail}`);
}

const restart = spawnSync("docker", ["restart", gatewayContainer], {
  stdio: "inherit",
});

if (restart.status !== 0) {
  throw new Error(`Failed to refresh local Supabase gateway ${gatewayContainer}.`);
}

console.log(
  `Refreshed ${gatewayContainer}; Docker DNS will be resolved again on the next request.`,
);
