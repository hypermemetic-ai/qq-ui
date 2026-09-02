#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const [outputArg, projectArg] = process.argv.slice(2);
if (outputArg === undefined || projectArg === undefined) {
  console.error("usage: node scripts/live/install-script-inventory.mjs <output.json> <installed-project>");
  process.exit(2);
}
const project = resolve(projectArg);
const lock = JSON.parse(readFileSync(join(project, "package-lock.json"), "utf8"));
const rows = [];
for (const [location, row] of Object.entries(lock.packages ?? {})) {
  if (!location || !row.hasInstallScript) continue;
  const manifestPath = join(project, location, "package.json");
  assert.ok(existsSync(manifestPath), `install-script package is not installed: ${location}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const scripts = Object.fromEntries(Object.entries(manifest.scripts ?? {}).filter(([name]) => ["preinstall", "install", "postinstall"].includes(name)));
  rows.push({ name: manifest.name, version: manifest.version, location, scripts });
}
rows.sort((a, b) => a.name.localeCompare(b.name));
assert.deepEqual(rows.map((row) => row.name), [
  "@deepseek-ai/dsh-subprocess-local", "@google/genai", "koffi", "node-pty", "protobufjs",
], "alpha.4 host install-hook roster changed; review before running any hooks");
const report = { status: "REVIEW_REQUIRED_THEN_NAMED_REBUILD", packageCount: rows.length, packages: rows };
writeFileSync(resolve(outputArg), `${JSON.stringify(report, null, 2)}\n`);
console.log(`install-script inventory retained: ${rows.length} exact named packages; no blanket install hooks authorized`);
