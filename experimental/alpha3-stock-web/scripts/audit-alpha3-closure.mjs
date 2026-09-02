#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_DSH_VERSION = "0.1.2-alpha.3";
const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lockPath = join(root, "package-lock.json");
assert.ok(existsSync(lockPath), "package-lock.json is required; run npm install and retain the exact closure");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
assert.ok(Number(lock.lockfileVersion) >= 3, "npm lockfileVersion 3 or newer is required");

const failures = [];
const lockVersions = new Map();
for (const [location, row] of Object.entries(lock.packages ?? {})) {
  if (location === "") continue;
  const name = row.name ?? location.match(/(?:^|node_modules\/)(@deepseek-ai\/[^/]+)$/u)?.[1];
  if (typeof name !== "string" || !name.startsWith("@deepseek-ai/dsh")) continue;
  lockVersions.set(`${name}@${location}`, row.version);
  if (row.version !== EXPECTED_DSH_VERSION) failures.push(`lock ${name}@${row.version} (${location})`);
}
assert.ok(lockVersions.size > 0, "lock contains no installed @deepseek-ai/dsh packages");

const seenDirectories = new Set();
const installed = new Map();
function scanModules(directory) {
  if (!existsSync(directory)) return;
  const real = realpathSync(directory);
  if (seenDirectories.has(real)) return;
  seenDirectories.add(real);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const scoped of readdirSync(join(directory, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory() || scoped.isSymbolicLink()) inspectPackage(join(directory, entry.name, scoped.name));
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      inspectPackage(join(directory, entry.name));
    }
  }
}
function inspectPackage(directory) {
  const packageFile = join(directory, "package.json");
  if (!existsSync(packageFile)) return;
  const row = JSON.parse(readFileSync(packageFile, "utf8"));
  if (typeof row.name === "string" && row.name.startsWith("@deepseek-ai/dsh")) {
    const key = `${row.name}@${realpathSync(directory)}`;
    installed.set(key, row.version);
    if (row.version !== EXPECTED_DSH_VERSION) failures.push(`installed ${row.name}@${row.version} (${directory})`);
  }
  scanModules(join(directory, "node_modules"));
}
scanModules(join(root, "node_modules"));
assert.ok(installed.size > 0, "node_modules contains no @deepseek-ai/dsh packages; run npm ci");

for (const [name, expected] of Object.entries(manifest.devDependencies ?? {})) {
  assert.equal(expected.startsWith("^") || expected.startsWith("~"), false, `${name} devDependency must be exact`);
}
for (const [name, expected] of Object.entries(manifest.peerDependencies ?? {})) {
  assert.equal(expected.startsWith("^") || expected.startsWith("~"), false, `${name} peerDependency must be exact`);
}
for (const [name, expected] of Object.entries(manifest.overrides ?? {})) {
  if (name.startsWith("@deepseek-ai/dsh")) assert.equal(expected, EXPECTED_DSH_VERSION, `${name} override drifted`);
}
assert.deepEqual(failures, [], `alpha.3 closure drift:\n${failures.join("\n")}`);
console.log(`alpha3 closure audit passed: ${lockVersions.size} locked and ${installed.size} installed DSH package locations are exactly ${EXPECTED_DSH_VERSION}`);
