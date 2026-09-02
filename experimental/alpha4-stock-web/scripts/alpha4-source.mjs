import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

export const EXPECTED_DSH_COMMIT = "4e84901e6471b79ec0338099867ebb4606d12bb5";
export const EXPECTED_DSH_TAG = "dsh-v0.1.2-alpha.4";
export const EXPECTED_DSH_VERSION = "0.1.2-alpha.4";
export const EXPECTED_DSH_PACKAGE_COUNT = 252;
export const EXPECTED_DSH_SET_SHA256 = "fe20e208a3359dbd3a39f83c22afa81e184374cbf386b4f33c3598de57439ce5";

function git(source, ...args) {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete env[key];
  return execFileSync("git", ["-C", source, ...args], { encoding: "utf8", env }).trim();
}

export function readAlpha4Source(sourceArg) {
  const source = realpathSync(sourceArg);
  assert.equal(git(source, "rev-parse", "HEAD"), EXPECTED_DSH_COMMIT, "authoritative alpha.4 source commit mismatch");
  assert.equal(git(source, "describe", "--tags", "--exact-match", "HEAD"), EXPECTED_DSH_TAG, "authoritative alpha.4 source tag mismatch");

  const packages = new Map();
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const item = join(directory, entry.name);
      if (entry.isDirectory()) walk(item);
      else if (entry.name === "package.json") {
        const row = JSON.parse(readFileSync(item, "utf8"));
        if (!row.name?.startsWith("@deepseek-ai/dsh")) continue;
        assert.equal(row.version, EXPECTED_DSH_VERSION, `${row.name} source version mismatch`);
        assert.equal(packages.has(row.name), false, `duplicate DSH source package name: ${row.name}`);
        packages.set(row.name, row.version);
      }
    }
  }
  walk(source);
  const overrides = Object.fromEntries([...packages].sort(([a], [b]) => a.localeCompare(b)));
  assert.equal(Object.keys(overrides).length, EXPECTED_DSH_PACKAGE_COUNT, "authoritative alpha.4 DSH package count mismatch");
  const digestInput = `${Object.entries(overrides).map(([name, version]) => `${name}@${version}`).join("\n")}\n`;
  const digest = createHash("sha256").update(digestInput).digest("hex");
  assert.equal(digest, EXPECTED_DSH_SET_SHA256, "authoritative alpha.4 DSH package set digest mismatch");
  return Object.freeze({ source, commit: EXPECTED_DSH_COMMIT, tag: EXPECTED_DSH_TAG, version: EXPECTED_DSH_VERSION, overrides, digest });
}
