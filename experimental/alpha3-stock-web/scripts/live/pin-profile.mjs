#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EXPECTED_VERSION = "0.1.2-alpha.3";
const [profileArg, sourceArg] = process.argv.slice(2);
if (profileArg === undefined || sourceArg === undefined) {
  console.error("usage: node scripts/live/pin-profile.mjs <isolated-profile-package.json> <authoritative-alpha3-source>");
  process.exit(2);
}
const profilePath = resolve(profileArg);
const source = resolve(sourceArg);
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
assert.deepEqual(profile.dsh?.profile?.bundles, ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], "refusing to modify a non-stock Web profile roster");
const overrides = {};
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const item = join(directory, entry.name);
    if (entry.isDirectory()) walk(item);
    else if (entry.name === "package.json") {
      const row = JSON.parse(readFileSync(item, "utf8"));
      if (!row.name?.startsWith("@deepseek-ai/dsh")) continue;
      assert.equal(row.version, EXPECTED_VERSION, `${row.name} source version mismatch`);
      overrides[row.name] = row.version;
    }
  }
}
walk(source);
profile.pnpm = {
  ...(profile.pnpm ?? {}),
  overrides: Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b))),
};
writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
console.log(`pinned ${Object.keys(overrides).length} DSH packages without changing the stock Web bundle roster`);
