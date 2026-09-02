#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EXPECTED_COMMIT = "dd6322d604e00eec1ba5e0c8541159906a21094a";
const EXPECTED_VERSION = "0.1.2-alpha.3";
const [sourceArg, manifestArg] = process.argv.slice(2);
if (sourceArg === undefined) {
  console.error("usage: node scripts/sync-alpha3-overrides.mjs <authoritative-alpha3-source> [package.json]");
  process.exit(2);
}
const source = resolve(sourceArg);
const manifestPath = resolve(manifestArg ?? new URL("../package.json", import.meta.url).pathname);
const gitHead = readFileSync(join(source, ".git", "HEAD"), "utf8").trim();
const commit = gitHead.startsWith("ref: ")
  ? readFileSync(join(source, ".git", gitHead.slice(5)), "utf8").trim()
  : gitHead;
assert.equal(commit, EXPECTED_COMMIT, `authoritative source must be ${EXPECTED_COMMIT}`);

const overrides = {};
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const item = join(directory, entry.name);
    if (entry.isDirectory()) walk(item);
    else if (entry.name === "package.json") {
      const row = JSON.parse(readFileSync(item, "utf8"));
      if (!row.name?.startsWith("@deepseek-ai/dsh")) continue;
      assert.equal(row.version, EXPECTED_VERSION, `${row.name} is not alpha.3 in authoritative source`);
      overrides[row.name] = row.version;
    }
  }
}
walk(source);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.overrides = Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`synchronized ${Object.keys(overrides).length} DSH overrides from ${EXPECTED_COMMIT}`);
