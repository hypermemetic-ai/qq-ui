#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

const [packageArg, destinationArg] = process.argv.slice(2);
if (packageArg === undefined || destinationArg === undefined) {
  console.error("usage: node scripts/live/pack-committed.mjs <clean-package-directory> <pack-destination>");
  process.exit(2);
}
const packageRoot = realpathSync(packageArg);
const destination = resolve(destinationArg);
mkdirSync(destination, { recursive: true, mode: 0o700 });
const env = { ...process.env };
for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete env[key];
const git = (...args) => execFileSync("git", ["-C", packageRoot, ...args], { encoding: "utf8", env }).trim();
const repository = realpathSync(git("rev-parse", "--show-toplevel"));
assert.ok(packageRoot === repository || packageRoot.startsWith(`${repository}${sep}`), "package is outside its Git repository");
const relativePackage = relative(repository, packageRoot) || ".";
assert.equal(git("status", "--porcelain=v1", "--untracked-files=all", "--", relativePackage), "", "refusing to pack a dirty or untracked package tree");
const commit = git("rev-parse", "HEAD");
assert.match(commit, /^[0-9a-f]{40}$/u, "Git commit must be a full SHA-1");
git("ls-files", "--error-unmatch", "--", relative(repository, resolve(packageRoot, "package.json")));

const packed = JSON.parse(execFileSync("npm", ["pack", packageRoot, "--pack-destination", destination, "--json"], { encoding: "utf8", env }));
assert.equal(packed.length, 1, "npm pack must emit exactly one tarball");
const row = packed[0];
const tarball = resolve(destination, row.filename);
const bytes = readFileSync(tarball);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
assert.equal(row.name, manifest.name);
assert.equal(row.version, manifest.version);
const provenance = {
  schema: 1,
  status: "CLEAN_COMMITTED_PACK",
  package: manifest.name,
  version: manifest.version,
  commit,
  treeClean: true,
  tarball: basename(tarball),
  sha256,
  npmIntegrity: row.integrity,
  entryCount: row.entryCount,
};
const provenancePath = `${tarball}.provenance.json`;
writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ tarball, provenance: provenancePath, package: manifest.name, version: manifest.version, commit, sha256 }, null, 2));
