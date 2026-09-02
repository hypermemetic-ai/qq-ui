#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_DSH_PACKAGE_COUNT, EXPECTED_DSH_VERSION } from "./alpha4-source.mjs";

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lockPath = join(root, "package-lock.json");
assert.ok(existsSync(lockPath), "package-lock.json is required; run npm install and retain the exact closure");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
assert.ok(Number(lock.lockfileVersion) >= 3, "npm lockfileVersion 3 or newer is required");
assert.equal(lock.name, manifest.name, "lock root name drifted");
assert.equal(lock.version, manifest.version, "lock root version drifted");
assert.deepEqual(lock.packages?.[""]?.devDependencies, manifest.devDependencies, "lock root devDependencies drifted");
assert.deepEqual(lock.packages?.[""]?.peerDependencies, manifest.peerDependencies, "lock root peerDependencies drifted");

const overrides = Object.entries(manifest.overrides ?? {}).filter(([name]) => name.startsWith("@deepseek-ai/dsh"));
assert.equal(overrides.length, EXPECTED_DSH_PACKAGE_COUNT, `manifest must contain all ${EXPECTED_DSH_PACKAGE_COUNT} source-derived DSH overrides`);
for (const [name, version] of overrides) assert.equal(version, EXPECTED_DSH_VERSION, `${name} override drifted`);
for (const group of ["dependencies", "devDependencies", "peerDependencies"]) {
  for (const [name, version] of Object.entries(manifest[group] ?? {})) {
    assert.equal(/^[~^*]|[<>=| ]/u.test(version), false, `${name} ${group} must use one exact version`);
    if (name.startsWith("@deepseek-ai/dsh")) assert.equal(version, EXPECTED_DSH_VERSION, `${name} ${group} drifted`);
  }
}

const publicContractFiles = ["src/client.d.ts", "proofs/public-contract.ts"];
for (const relative of publicContractFiles) {
  const path = join(root, relative);
  if (!existsSync(path)) continue;
  const source = readFileSync(path, "utf8");
  assert.doesNotMatch(source, /@deepseek-ai\/[^"']+\/(?:invariant|src)(?:[\/"'])/u, `${relative} uses a private/removed invariant companion import`);
}

const failures = [];
const lockVersions = new Map();
for (const [location, row] of Object.entries(lock.packages ?? {})) {
  if (location === "") continue;
  const name = row.name ?? location.match(/(?:^|node_modules\/)(@deepseek-ai\/[^/]+)$/u)?.[1];
  if (typeof name !== "string" || !name.startsWith("@deepseek-ai/dsh")) continue;
  lockVersions.set(`${name}@${location}`, row.version);
  if (row.version !== EXPECTED_DSH_VERSION) failures.push(`lock ${name}@${row.version} (${location})`);
  if (!row.resolved || !row.integrity) failures.push(`lock ${name} lacks registry resolution/integrity (${location})`);
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
    } else if (entry.isDirectory() || entry.isSymbolicLink()) inspectPackage(join(directory, entry.name));
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
assert.deepEqual(failures, [], `alpha.4 closure drift:\n${failures.join("\n")}`);
console.log(`alpha4 closure audit passed: ${overrides.length} source pins, ${lockVersions.size} locked and ${installed.size} installed DSH package locations are exactly ${EXPECTED_DSH_VERSION}`);
