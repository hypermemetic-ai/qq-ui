#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
const UI = "@hypermemetic-ai/qq-ui-alpha4-spike";
const MODELS = "@hypermemetic-ai/qq-models";
const EXPECTED_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", MODELS];
const [profileArg, stockDumpArg, additiveDumpArg, patchedDumpArg] = process.argv.slice(2);
if ([profileArg, stockDumpArg, additiveDumpArg, patchedDumpArg].some((value) => value === undefined)) {
  console.error("usage: node scripts/live/verify-composition.mjs <profile-package.json> <stock-dump.yml> <additive-dump.yml> <patched-dump.yml>");
  process.exit(2);
}
const profilePath = resolve(profileArg);
const profileRoot = realpathSync(dirname(profilePath));
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
assert.deepEqual(profile.dsh?.profile?.bundles, EXPECTED_BUNDLES, "Web profile Bundle roster must be stock base, stock Web, then qq-models");
assert.deepEqual(Object.keys(profile.dependencies ?? {}).filter((name) => name.startsWith("@hypermemetic-ai/")).sort(), [MODELS, UI].sort(), "profile must declare exactly the two packed QQ dependencies");
for (const name of [MODELS, UI]) {
  const specifier = profile.dependencies[name];
  assert.match(specifier, /\.tgz$/u, `${name} profile dependency must be a retained tarball`);
  assert.doesNotMatch(specifier, /^(?:link:|workspace:)|(?:^|\/)projects\//u, `${name} must not link a mutable checkout`);
}
const installed = {};
for (const name of [MODELS, UI]) {
  const path = join(profileRoot, "node_modules", ...name.split("/"));
  assert.ok(existsSync(path), `${name} is not installed in the isolated profile`);
  const real = realpathSync(path);
  assert.ok(real === profileRoot || real.startsWith(`${profileRoot}${sep}`), `${name} resolves outside the isolated profile`);
  installed[name] = JSON.parse(readFileSync(join(real, "package.json"), "utf8"));
}
assert.equal(installed[MODELS].dsh?.bundle?.patch, "./cordis.patch.yml", "qq-models must be the one additive external Bundle");
assert.equal(installed[UI].dsh?.bundle, undefined, "QQ UI must remain a plain dependency");
assert.equal(installed[UI].dsh?.client?.platform, "web", "QQ UI Web client contribution missing");
const lockPath = join(profileRoot, "pnpm-lock.yaml");
const lock = readFileSync(lockPath, "utf8");
for (const [name, specifier] of Object.entries(profile.dependencies)) {
  if (![MODELS, UI].includes(name)) continue;
  assert.ok(lock.includes(basename(specifier)), `${name} tarball is absent from profile lock`);
}
for (const line of lock.split("\n").filter((line) => /@hypermemetic-ai|qq-models|qq-ui-alpha4/u.test(line))) {
  assert.doesNotMatch(line, /(?:link:|type:\s*directory|\/projects\/)/u, "QQ profile lock contains a mutable directory resolution");
}
const stock = readFileSync(resolve(stockDumpArg), "utf8");
const additive = readFileSync(resolve(additiveDumpArg), "utf8");
const patched = readFileSync(resolve(patchedDumpArg), "utf8");
const count = (text, expression) => (text.match(expression) ?? []).length;
for (const name of [MODELS, UI]) assert.equal(stock.includes(name), false, `stock config unexpectedly contains ${name}`);
assert.equal(count(additive, /id: qq-models\b/gu), 1, "additive config must contain one qq-models id");
assert.equal(count(additive, /name: '@hypermemetic-ai\/qq-models'/gu), 1, "additive config must contain one qq-models package row");
assert.equal(additive.includes(UI), false, "plain QQ UI dependency must not enter config without its launch patch");
assert.equal(count(patched, /id: qq-models\b/gu), 1, "patched config must retain one qq-models id");
assert.equal(count(patched, /id: qq-ui-alpha4-spike\b/gu), 1, "patched config must contain one QQ UI id");
assert.equal(count(patched, /name: '@hypermemetic-ai\/qq-ui-alpha4-spike'/gu), 1, "patched config must contain one QQ UI package row");
assert.ok(patched.lastIndexOf("id: qq-models") < patched.lastIndexOf("id: qq-ui-alpha4-spike"), "UI launch row must follow the additive qq-models row");
assert.equal(count(patched, /^\s*provider:\s*xai-auth\s*$/gmu), 1, "patched config must select xai-auth once");
assert.equal(count(patched, /^\s*model:\s*grok-4\.6\s*$/gmu), 1, "patched config must select grok-4.6 once");
assert.match(patched, /id: session-persistence-jsonl[\s\S]*?compression:\s*none[\s\S]*?packChunks:\s*false/u, "evidence run must expose canonical stock Session events without compression/chunk packing");
const report = {
  status: "PASS", bundles: profile.dsh.profile.bundles, qqDependencies: [MODELS, UI],
  rows: { stockQQ: 0, additiveModels: 1, additiveUi: 0, patchedModels: 1, patchedUi: 1 },
  modelDefault: "xai-auth/grok-4.6", persistence: "stock-jsonl-uncompressed-for-evidence",
};
writeFileSync(join(dirname(resolve(patchedDumpArg)), "composition.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log("alpha4 composition verification passed: stock bundles + one external qq-models Bundle + one plain packed UI dependency/launch row");
