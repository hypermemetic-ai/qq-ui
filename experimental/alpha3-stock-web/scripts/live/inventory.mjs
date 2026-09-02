#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EXPECTED = "0.1.2-alpha.3";
const [outputArg, ...rootArgs] = process.argv.slice(2);
if (outputArg === undefined || rootArgs.length === 0) {
  console.error("usage: node scripts/live/inventory.mjs <output.json> <project-root> [...project-roots]");
  process.exit(2);
}
const rows = new Map();
const seenModules = new Set();
function inspectPackage(directory) {
  const manifest = join(directory, "package.json");
  if (!existsSync(manifest)) return;
  const real = realpathSync(directory);
  const row = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof row.name === "string" && typeof row.version === "string") {
    rows.set(`${row.name}\0${real}`, { name: row.name, version: row.version, path: real });
  }
  scanModules(join(directory, "node_modules"));
}
function scanModules(directory) {
  if (!existsSync(directory)) return;
  const real = realpathSync(directory);
  if (seenModules.has(real)) return;
  seenModules.add(real);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const item = join(directory, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const child of readdirSync(item, { withFileTypes: true })) {
        if (child.isDirectory() || child.isSymbolicLink()) inspectPackage(join(item, child.name));
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) inspectPackage(item);
  }
}
for (const root of rootArgs.map((root) => resolve(root))) scanModules(join(root, "node_modules"));
const inventory = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
const dsh = inventory.filter((row) => row.name.startsWith("@deepseek-ai/dsh"));
const drift = dsh.filter((row) => row.version !== EXPECTED);
const report = { generatedAt: new Date().toISOString(), roots: rootArgs.map((root) => resolve(root)), expectedDshVersion: EXPECTED, packageLocations: inventory.length, dshPackageLocations: dsh.length, drift, packages: inventory };
writeFileSync(resolve(outputArg), `${JSON.stringify(report, null, 2)}\n`);
assert.ok(dsh.length > 0, "inventory contains no installed DSH package");
assert.deepEqual(drift, [], `installed DSH version drift:\n${drift.map((row) => `${row.name}@${row.version} ${row.path}`).join("\n")}`);
console.log(`alpha3 installed inventory passed: ${dsh.length} DSH package locations are exactly ${EXPECTED}`);
