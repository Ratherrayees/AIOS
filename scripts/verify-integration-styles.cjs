/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");

const files = ["app/settings/integrations/integrations.css"];
const failures = [];

for (const relativePath of files) {
  const absolutePath = path.join(process.cwd(), relativePath);
  const css = fs.readFileSync(absolutePath, "utf8");
  if (/\bfont\s*:/i.test(css)) {
    failures.push(`${relativePath}: do not use font shorthand; declare family, size and weight explicitly.`);
  }
  if (/font-size\s*:\s*(?:[0-9]|10)px\b/i.test(css)) {
    failures.push(`${relativePath}: essential integration text must be at least 11px.`);
  }
  const openingBraces = (css.match(/{/g) || []).length;
  const closingBraces = (css.match(/}/g) || []).length;
  if (openingBraces !== closingBraces) {
    failures.push(`${relativePath}: CSS block braces are unbalanced.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({ checkedFiles: files.length, failures: 0 }));
