/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ignoredDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const ignoredFiles = new Set([".env.local", ".env.example"]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const patterns = [
  {
    name: "Supabase secret key",
    expression: new RegExp(["sb", "secret"].join("_") + "_[A-Za-z0-9_-]{20,}", "g"),
  },
  {
    name: "Resend API key",
    expression: new RegExp(["\\bre", "[A-Za-z0-9_-]{20,}"].join("_"), "g"),
  },
  {
    name: "webhook signing secret",
    expression: new RegExp(["whsec", "[A-Za-z0-9_-]{20,}"].join("_"), "g"),
  },
  {
    name: "OpenAI-style API key",
    expression: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "Postgres URL with embedded password",
    expression: /postgres(?:ql)?:\/\/[^:\s"']+:[^@\s"']+@/g,
  },
  {
    name: "GLM-style API credential",
    expression: /\b[a-f0-9]{32}\.[A-Za-z0-9_-]{12,}\b/g,
  },
];

function repositoryFiles() {
  try {
    return execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      },
    )
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
}

function discoveredFiles(directory = ".") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name))
        files.push(...discoveredFiles(path.join(directory, entry.name)));
      continue;
    }
    if (entry.isFile()) files.push(path.join(directory, entry.name));
  }
  return files;
}

function shouldScan(file) {
  const base = path.basename(file);
  if (ignoredFiles.has(base)) return false;
  return (
    base.startsWith(".env") ||
    textExtensions.has(path.extname(file).toLowerCase()) ||
    base === ".npmrc" ||
    base === "Dockerfile"
  );
}

const repositorySource = repositoryFiles();
const files = (
  repositorySource?.length ? repositorySource : discoveredFiles()
).filter(shouldScan);
const findings = [];

for (const file of files) {
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;
  for (const { name, expression } of patterns) {
    expression.lastIndex = 0;
    for (const match of content.matchAll(expression)) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      findings.push({ file: path.normalize(file), line, name });
    }
  }
}

if (findings.length) {
  for (const finding of findings)
    console.error(
      `Potential ${finding.name} in ${finding.file}:${finding.line}.`,
    );
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({ scannedFiles: files.length, potentialSecrets: 0 }),
  );
}
