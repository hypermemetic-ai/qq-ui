#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const sourceRoot = new URL("../", import.meta.url);
const sourcePackage = JSON.parse(await readFile(new URL("package.json", sourceRoot), "utf8"));
const scratch = await mkdtemp(join(tmpdir(), "qq-alpha3-type-gate-"));

async function createFixture(name, { missing, mismatch } = {}) {
  const root = join(scratch, name);
  await mkdir(join(root, "scripts"), { recursive: true });
  await cp(new URL("../scripts/check-public-types.mjs", import.meta.url), join(root, "scripts/check-public-types.mjs"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    type: "module",
    devDependencies: sourcePackage.devDependencies,
  }, null, 2)}\n`);
  for (const [dependency, expected] of Object.entries(sourcePackage.devDependencies)) {
    if (dependency === missing) continue;
    const directory = join(root, "node_modules", dependency);
    await mkdir(directory, { recursive: true });
    const version = dependency === mismatch?.name ? mismatch.version : expected;
    await writeFile(join(directory, "package.json"), `${JSON.stringify({ name: dependency, version })}\n`);
  }
  const tsc = join(root, "node_modules/typescript/bin/tsc");
  if (missing !== "typescript") {
    await mkdir(dirname(tsc), { recursive: true });
    await writeFile(tsc, "process.exit(0);\n");
  }
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [join(root, "scripts/check-public-types.mjs")], { encoding: "utf8" });
}

try {
  const missingName = "@deepseek-ai/dsh-session";
  const missing = run(await createFixture("missing", { missing: missingName }));
  assert.equal(missing.status, 2, missing.stderr);
  assert.match(missing.stderr, /BLOCKED public alpha\.3 type check/u);
  assert.ok(missing.stderr.includes(`${missingName} (missing; expected 0.1.2-alpha.3)`));

  const mismatchName = "@deepseek-ai/cordis";
  const mismatch = run(await createFixture("mismatch", {
    mismatch: { name: mismatchName, version: "4.0.1" },
  }));
  assert.equal(mismatch.status, 2, mismatch.stderr);
  assert.ok(mismatch.stderr.includes(`${mismatchName} (4.0.1; expected 4.0.2)`));

  const exact = run(await createFixture("exact"));
  assert.equal(exact.status, 0, exact.stderr);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

console.log("alpha3 public-type dependency gate proof passed: missing/mismatch block, exact set invokes tsc");
