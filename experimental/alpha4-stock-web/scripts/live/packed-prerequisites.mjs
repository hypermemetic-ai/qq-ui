import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const UI_NAME = "@hypermemetic-ai/qq-ui-alpha4-spike";
const UI_VERSION = "0.0.0-alpha.4-spike";
const MODELS_NAME = "@hypermemetic-ai/qq-models";

function member(tarball, path) {
  return execFileSync("tar", ["-xOf", tarball, `package/${path}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
function verifyOne(tarArg, provenanceArg, expectedName, expectedVersion) {
  const tarball = resolve(tarArg);
  assert.match(tarball, /\.tgz$/u, `${expectedName} input must be an npm .tgz, not a directory/link`);
  const provenance = JSON.parse(readFileSync(resolve(provenanceArg), "utf8"));
  const sha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  assert.equal(provenance.schema, 1);
  assert.equal(provenance.status, "CLEAN_COMMITTED_PACK");
  assert.equal(provenance.treeClean, true);
  assert.equal(provenance.package, expectedName);
  if (expectedVersion !== undefined) assert.equal(provenance.version, expectedVersion);
  assert.match(provenance.commit, /^[0-9a-f]{40}$/u);
  assert.equal(provenance.sha256, sha256, `${expectedName} tarball digest differs from clean-commit provenance`);
  assert.equal(provenance.tarball, basename(tarball));
  const members = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
  assert.ok(members.length > 0);
  assert.equal(members.every((path) => path === "package" || path.startsWith("package/")), true, `${expectedName} tarball escapes package root`);
  assert.equal(members.some((path) => path.includes("../") || path.startsWith("/")), false, `${expectedName} tarball contains unsafe paths`);
  const manifest = JSON.parse(member(tarball, "package.json"));
  assert.equal(manifest.name, expectedName);
  assert.equal(manifest.version, provenance.version);
  return { tarball, provenance, manifest, members, sha256 };
}

export function verifyPackedPrerequisites(options, packsDirectory) {
  const ui = verifyOne(options["ui-pack"], options["ui-provenance"], UI_NAME, UI_VERSION);
  assert.equal(ui.manifest.dsh?.client?.platform, "web", "QQ UI pack must be a Web client contribution");
  assert.equal(ui.manifest.dsh?.bundle, undefined, "QQ UI pack must remain a plain profile dependency, not a Bundle");
  const uiPatch = member(ui.tarball, "host/cordis.patch.yml");
  assert.equal((uiPatch.match(/id: qq-ui-alpha4-spike/gu) ?? []).length, 1, "QQ UI pack must contain one launch patch row");

  const models = verifyOne(options["qq-models-pack"], options["qq-models-provenance"], MODELS_NAME);
  assert.equal(models.manifest.dsh?.bundle?.patch, "./cordis.patch.yml", "qq-models pack must remain an external profile Bundle");
  assert.equal(models.manifest.devDependencies?.["@deepseek-ai/dsh-llm"], "0.1.2-alpha.4", "qq-models prerequisite lacks exact alpha.4 DSH integration dependency");
  assert.equal(models.manifest.devDependencies?.["@deepseek-ai/cordis"], "4.0.2", "qq-models prerequisite lacks exact Cordis integration dependency");
  const testCommand = Object.values(models.manifest.scripts ?? {}).join(" ");
  assert.match(testCommand, /integration|alpha4|dsh/iu, "qq-models prerequisite does not run its DSH integration coverage");
  for (const adapterPath of ["src/grok.mjs", "src/codex.mjs"]) {
    const source = member(models.tarball, adapterPath);
    assert.match(source, /imageRequestPricing\s*\([^)]*\)\s*\{\s*return undefined;?\s*\}/u, `${adapterPath} lacks the alpha.4 pricing default`);
    assert.match(source, /async\s+prepareCall\s*\(\s*provider\s*,\s*model\s*,\s*signal\s*\)/u, `${adapterPath} lacks the alpha.4 prepareCall default`);
    assert.match(source, /model:\s*await this\.resolveModel\(provider, model, signal\)/u, `${adapterPath} prepareCall does not resolve through its adapter`);
    assert.match(source, /stream:\s*\(options\)\s*=>\s*this\.stream\(options\)/u, `${adapterPath} prepareCall does not preserve stream dispatch`);
  }

  const uiDestination = join(packsDirectory, basename(ui.tarball));
  const modelsDestination = join(packsDirectory, basename(models.tarball));
  copyFileSync(ui.tarball, uiDestination);
  copyFileSync(models.tarball, modelsDestination);
  return Object.freeze({
    ui: { package: UI_NAME, version: ui.manifest.version, commit: ui.provenance.commit, sha256: ui.sha256, tarball: uiDestination },
    models: { package: MODELS_NAME, version: models.manifest.version, commit: models.provenance.commit, sha256: models.sha256, tarball: modelsDestination },
  });
}
