#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const packageRoot = new URL("../", import.meta.url);
const scratch = await mkdtemp(join(tmpdir(), "qq-alpha4-live-tools-"));
const scriptPath = (relative) => new URL(relative, packageRoot).pathname;
function run(script, args = [], options = {}) {
  return spawnSync(process.execPath, [scriptPath(script), ...args], { encoding: "utf8", ...options });
}
async function makePack(id, manifest, files = {}) {
  const root = join(scratch, `pack-${id}`);
  const packageDirectory = join(root, "stage", "package");
  const inbound = join(root, "inbound");
  await mkdir(packageDirectory, { recursive: true });
  await mkdir(inbound, { recursive: true });
  await writeFile(join(packageDirectory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(packageDirectory, relative);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents);
  }
  const tarball = join(inbound, `${id}.tgz`);
  const packed = spawnSync("tar", ["-czf", tarball, "-C", join(root, "stage"), "package"], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const sha256 = createHash("sha256").update(await readFile(tarball)).digest("hex");
  const provenance = `${tarball}.provenance.json`;
  await writeFile(provenance, `${JSON.stringify({
    schema: 1, status: "CLEAN_COMMITTED_PACK", package: manifest.name, version: manifest.version,
    commit: id.padEnd(40, id.at(-1) ?? "a").slice(0, 40).replace(/[^0-9a-f]/gu, "a"), treeClean: true,
    tarball: basename(tarball), sha256, npmIntegrity: "fixture", entryCount: Object.keys(files).length + 1,
  }, null, 2)}\n`);
  return { tarball, provenance };
}

try {
  // HMR probe is reversible byte-for-byte on the disposable installed artifact shape.
  const client = join(scratch, "client.js");
  const backup = join(scratch, "client.backup.js");
  await cp(new URL("../lib/client.js", import.meta.url), client);
  const original = await readFile(client);
  let command = run("scripts/live/mutate-client.mjs", ["disable", client, backup]);
  assert.equal(command.status, 0, command.stderr);
  assert.match(await readFile(client, "utf8"), /Live-gate disposal probe/u);
  command = run("scripts/live/mutate-client.mjs", ["restore", client, backup]);
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(await readFile(client), original);

  // The executor starts from an explicit allowlist and gives model auth its own root.
  const isolatedRoot = `/tmp/qq-alpha4-live-env-proof-${process.pid}-${Date.now()}`;
  await mkdir(isolatedRoot, { mode: 0o700 });
  const envProbe = run("scripts/live/isolated-exec.mjs", [isolatedRoot, process.execPath, "-e", "process.stdout.write(JSON.stringify(process.env))"], {
    env: { ...process.env, QQ_AMBIENT_SECRET_PROBE: "must-not-cross", OPENAI_API_KEY: "must-not-cross", HTTPS_PROXY: "must-not-cross" },
  });
  assert.equal(envProbe.status, 0, envProbe.stderr);
  const isolated = JSON.parse(envProbe.stdout);
  assert.equal(isolated.QQ_AMBIENT_SECRET_PROBE, undefined);
  assert.equal(isolated.OPENAI_API_KEY, undefined);
  assert.equal(isolated.HTTPS_PROXY, undefined);
  assert.equal(isolated.HOME, `${isolatedRoot}/os-home`);
  assert.equal(isolated.DSH_HOME, `${isolatedRoot}/dsh-home`);
  assert.equal(isolated.QQ_DSH_HOME, `${isolatedRoot}/qq-dsh-home`);
  assert.equal(isolated.XDG_DATA_HOME, `${isolatedRoot}/os-home/.local/share`);
  await rm(isolatedRoot, { recursive: true, force: true });

  // Browser accepts the tokenized URL only on stdin and rejects remote/protected origins first.
  const browserArgs = [
    "--launch-stdin", "true", "--harness", "/tmp/qq-alpha4-live-guard/harness",
    "--package", "/tmp/qq-alpha4-live-guard/package", "--workspace", "/tmp/qq-alpha4-live-guard/workspace",
    "--artifacts", "/tmp/qq-alpha4-live-guard/artifacts", "--browser-profile", "/tmp/qq-alpha4-live-guard/browser-profile",
  ];
  let guarded = run("scripts/live/browser.mjs", browserArgs, { input: "http://127.0.0.1:3082/?token=[REDACTED]\n" });
  assert.equal(guarded.status, 2);
  assert.match(guarded.stderr, /refusing protected legacy port 3082/u);
  guarded = run("scripts/live/browser.mjs", browserArgs, { input: "https://example.invalid/?token=[REDACTED]\n" });
  assert.equal(guarded.status, 2);
  assert.match(guarded.stderr, /refusing a non-loopback HTTP live target/u);

  const redirected = join(scratch, "redirected-run-root");
  const linkedRoot = `/tmp/qq-alpha4-live-symlink-proof-${process.pid}-${Date.now()}`;
  await mkdir(redirected, { recursive: true });
  await symlink(redirected, linkedRoot, "dir");
  try {
    const linkedPrepare = run("scripts/live/prepare.mjs", [
      "--run-root", linkedRoot, "--source", scratch,
      "--ui-pack", "missing", "--ui-provenance", "missing", "--qq-models-pack", "missing", "--qq-models-provenance", "missing",
    ]);
    assert.equal(linkedPrepare.status, 2);
    assert.match(linkedPrepare.stderr, /refusing symlinked or non-canonical/u);
  } finally {
    await rm(linkedRoot, { force: true });
  }

  // Packed prerequisites: one plain UI client package and one alpha.4-compatible model Bundle.
  const uiManifest = {
    name: "@hypermemetic-ai/qq-ui-alpha4-spike", version: "0.0.0-alpha.4-spike",
    dsh: { client: { platform: "web" } },
  };
  const adapterDefaults = `export function createAdapter(){ return {\n  imageRequestPricing() { return undefined; },\n  async prepareCall(provider, model, signal) { return { model: await this.resolveModel(provider, model, signal), stream: (options) => this.stream(options) }; },\n};}\n`;
  const modelsManifest = {
    name: "@hypermemetic-ai/qq-models", version: "0.0.0", type: "module",
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
    devDependencies: { "@deepseek-ai/dsh-llm": "0.1.2-alpha.4", "@deepseek-ai/cordis": "4.0.2" },
    scripts: { test: "node tests/dsh-alpha4-integration.mjs" },
  };
  const uiPack = await makePack("a1", uiManifest, { "host/cordis.patch.yml": "- insert:\n    - id: qq-ui-alpha4-spike\n      name: '@hypermemetic-ai/qq-ui-alpha4-spike'\n" });
  const modelsPack = await makePack("b2", modelsManifest, {
    "cordis.patch.yml": "- insert:\n    - id: qq-models\n      name: '@hypermemetic-ai/qq-models'\n",
    "src/grok.mjs": adapterDefaults, "src/codex.mjs": adapterDefaults,
  });
  const accepted = join(scratch, "accepted-packs");
  await mkdir(accepted);
  command = run("scripts/live/verify-packed-prerequisites.mjs", [uiPack.tarball, uiPack.provenance, modelsPack.tarball, modelsPack.provenance, accepted]);
  assert.equal(command.status, 0, command.stderr);
  assert.match(command.stdout, /qq-ui-alpha4-spike/u);
  assert.match(command.stdout, /qq-models/u);

  const badModels = await makePack("c3", modelsManifest, {
    "cordis.patch.yml": "- insert:\n    - id: qq-models\n      name: '@hypermemetic-ai/qq-models'\n",
    "src/grok.mjs": "export const incompatible = {};\n", "src/codex.mjs": adapterDefaults,
  });
  const rejected = join(scratch, "rejected-packs");
  await mkdir(rejected);
  command = run("scripts/live/verify-packed-prerequisites.mjs", [uiPack.tarball, uiPack.provenance, badModels.tarball, badModels.provenance, rejected]);
  assert.notEqual(command.status, 0, "qq-models without public alpha.4 defaults must be blocked");
  assert.match(command.stderr, /pricing default/u);

  // pack-committed proves cleanliness and emits digest-bound provenance; dirty reruns fail.
  const gitPackage = join(scratch, "clean-git-package");
  const packOut = join(scratch, "clean-pack-output");
  const packCache = join(scratch, "clean-pack-cache");
  await mkdir(gitPackage);
  await mkdir(packOut);
  await writeFile(join(gitPackage, "package.json"), `${JSON.stringify({ name: "clean-fixture", version: "1.0.0", files: ["README.md"] })}\n`);
  await writeFile(join(gitPackage, "README.md"), "clean\n");
  const gitEnv = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete gitEnv[key];
  for (const args of [["init", "-q"], ["config", "user.email", "fixture@example.invalid"], ["config", "user.name", "Fixture"], ["add", "."], ["commit", "-qm", "fixture"]]) {
    const row = spawnSync("git", args, { cwd: gitPackage, encoding: "utf8", env: gitEnv });
    assert.equal(row.status, 0, row.stderr);
  }
  command = run("scripts/live/pack-committed.mjs", [gitPackage, packOut], { env: { ...gitEnv, npm_config_cache: packCache } });
  assert.equal(command.status, 0, command.stderr);
  const packedResult = JSON.parse(command.stdout);
  const cleanProvenance = JSON.parse(await readFile(packedResult.provenance, "utf8"));
  assert.equal(cleanProvenance.status, "CLEAN_COMMITTED_PACK");
  assert.equal(cleanProvenance.treeClean, true);
  await writeFile(join(gitPackage, "README.md"), "dirty\n");
  command = run("scripts/live/pack-committed.mjs", [gitPackage, packOut], { env: { ...gitEnv, npm_config_cache: packCache } });
  assert.notEqual(command.status, 0);
  assert.match(command.stderr, /dirty or untracked/u);

  // Composition proof distinguishes stock, additive model Bundle, and UI launch overlay.
  const profileRoot = join(scratch, "profile");
  const modelsInstalled = join(profileRoot, "node_modules", "@hypermemetic-ai", "qq-models");
  const uiInstalled = join(profileRoot, "node_modules", "@hypermemetic-ai", "qq-ui-alpha4-spike");
  await mkdir(modelsInstalled, { recursive: true });
  await mkdir(uiInstalled, { recursive: true });
  const profilePath = join(profileRoot, "package.json");
  await writeFile(profilePath, `${JSON.stringify({
    dependencies: {
      "@hypermemetic-ai/qq-models": "file:/tmp/packs/models.tgz",
      "@hypermemetic-ai/qq-ui-alpha4-spike": "file:/tmp/packs/ui.tgz",
    },
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@hypermemetic-ai/qq-models"], patchReload: "live" } },
  })}\n`);
  await writeFile(join(modelsInstalled, "package.json"), `${JSON.stringify(modelsManifest)}\n`);
  await writeFile(join(uiInstalled, "package.json"), `${JSON.stringify(uiManifest)}\n`);
  await writeFile(join(profileRoot, "pnpm-lock.yaml"), "qq-models: models.tgz\nqq-ui-alpha4: ui.tgz\n");
  const stock = join(scratch, "stock.yml");
  const additive = join(scratch, "additive.yml");
  const patched = join(scratch, "patched.yml");
  await writeFile(stock, "- id: stock\n  name: '@deepseek-ai/dsh-web-app'\n");
  await writeFile(additive, "- id: stock\n  name: '@deepseek-ai/dsh-web-app'\n- id: qq-models\n  name: '@hypermemetic-ai/qq-models'\n");
  await writeFile(patched, "- id: stock\n  name: '@deepseek-ai/dsh-web-app'\n- id: qq-models\n  name: '@hypermemetic-ai/qq-models'\n- id: agent-default-model\n  config:\n    provider: xai-auth\n    model: grok-4.6\n- id: session-persistence-jsonl\n  config:\n    compression: none\n    packChunks: false\n- id: qq-ui-alpha4-spike\n  name: '@hypermemetic-ai/qq-ui-alpha4-spike'\n");
  command = run("scripts/live/verify-composition.mjs", [profilePath, stock, additive, patched]);
  assert.equal(command.status, 0, command.stderr);
  assert.equal(JSON.parse(await readFile(join(scratch, "composition.json"), "utf8")).status, "PASS");

  // Persisted-turn extractor passes only exact route + chunks + nonce + completed + zero tools.
  const turnRoot = `/tmp/qq-alpha4-live-turn-proof-${process.pid}-${Date.now()}`;
  const sessionDirectory = join(turnRoot, "dsh-home", "sessions", "workspace", "session-fixture");
  await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  await mkdir(join(turnRoot, "artifacts"), { recursive: true, mode: 0o700 });
  const nonce = "QQ_ALPHA4_0123456789ABCDEF01234567";
  const events = [
    { type: "session", version: 0, id: "fixture", createdAt: 1, delegationDepth: 0 },
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    { type: "user/message", seq: 1, time: 2, data: { id: "user-1", source: { kind: "user" }, role: "user", content: [{ type: "text", text: `Reply ${nonce}` }] } },
    { type: "request/header", seq: 2, time: 3, data: { header: { config: { provider: "xai-auth", model: "grok-4.6" } }, reason: "initial" } },
    { type: "assistant/chunk", seq: 3, time: 4, data: { turn: 1, step: 1, chunk: { type: "text-delta", text: nonce } } },
    { type: "assistant/message", seq: 4, time: 5, data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: nonce }] } } },
    { type: "turn/end", seq: 5, time: 6, data: { turn: 1, reason: { kind: "completed" } } },
  ];
  const logPath = join(sessionDirectory, "session.jsonl");
  await writeFile(logPath, `${events.map(JSON.stringify).join("\n")}\n`);
  command = run("scripts/live/extract-turn-facts.mjs", [turnRoot, nonce]);
  assert.equal(command.status, 0, command.stderr);
  const facts = JSON.parse(await readFile(join(turnRoot, "artifacts", "turn-facts.json"), "utf8"));
  assert.equal(facts.status, "PASS");
  assert.equal(facts.toolCallCount, 0);
  events.splice(-1, 0, { type: "tool/call", seq: 5, time: 6, data: { turn: 1, step: 1, callId: "c", name: "web_fetch", arguments: "{}" } });
  events.at(-1).seq = 6;
  await writeFile(logPath, `${events.map(JSON.stringify).join("\n")}\n`);
  command = run("scripts/live/extract-turn-facts.mjs", [turnRoot, nonce]);
  assert.notEqual(command.status, 0, "a tool call must fail the no-tools gate");
  assert.match(command.stderr, /produced a tool call/u);
  await rm(turnRoot, { recursive: true, force: true });

  // Installed closure inventory rejects any alpha.3 location.
  const project = join(scratch, "project");
  const installed = join(project, "node_modules", "@deepseek-ai", "dsh-fixture");
  await mkdir(installed, { recursive: true });
  await writeFile(join(installed, "package.json"), `${JSON.stringify({ name: "@deepseek-ai/dsh-fixture", version: "0.1.2-alpha.4" })}\n`);
  const inventoryPath = join(scratch, "inventory.json");
  command = run("scripts/live/inventory.mjs", [inventoryPath, project]);
  assert.equal(command.status, 0, command.stderr);
  await writeFile(join(installed, "package.json"), `${JSON.stringify({ name: "@deepseek-ai/dsh-fixture", version: "0.1.2-alpha.3" })}\n`);
  command = run("scripts/live/inventory.mjs", [inventoryPath, project]);
  assert.notEqual(command.status, 0);
  assert.match(command.stderr, /0\.1\.2-alpha\.3/u);

  // Static path/order assertions protect the unexecuted credential/live boundary.
  const browserSource = await readFile(new URL("../scripts/live/browser.mjs", import.meta.url), "utf8");
  assert.match(browserSource, /readFileSync\(0, "utf8"\)/u, "launch URL must arrive only on stdin");
  assert.doesNotMatch(browserSource, /options\.url/u);
  assert.match(browserSource, /join\(installedPackage, "lib", "client\.js"\)/u, "HMR must mutate the disposable installed tarball artifact");
  assert.doesNotMatch(browserSource, /startWatcher|join\(harness, "src"/u);
  assert.ok(browserSource.indexOf("assertBlankChromeHidden()") < browserSource.indexOf("transitionSessionThroughComposer()"), "blank assertions must precede rendered Send");
  assert.ok(browserSource.indexOf("await assessModelTurn(transition)") < browserSource.indexOf('await runMutation("disable")'), "model stream must finish before HMR mutation");
  assert.match(browserSource, /Do not call or use any tool/u);
  assert.match(browserSource, /PASS_RENDERED_STREAM_PENDING_PERSISTED_EVENTS/u);
  assert.match(browserSource, /assertStockReconnect/u);
  const supervisor = await readFile(new URL("../scripts/live/supervise.mjs", import.meta.url), "utf8");
  assert.match(supervisor, /detached: true/u);
  assert.match(supervisor, /process\.kill\(-pgid, "SIGTERM"\)/u);
  assert.match(supervisor, /process\.kill\(-pgid, "SIGKILL"\)/u);
  assert.match(supervisor, /PASS_REAPED_NO_ORPHAN/u);
  assert.match(supervisor, /browser\.stdin\.end/u);
  assert.match(supervisor, /REDACTED_LOOPBACK_LAUNCH_URL/u);
  const prepare = await readFile(new URL("../scripts/live/prepare.mjs", import.meta.url), "utf8");
  assert.match(prepare, /verifyPackedPrerequisites/u);
  assert.match(prepare, /QQ_DSH_HOME/u);
  assert.match(prepare, /qq-models-login grok/u);
  assert.doesNotMatch(prepare, /plugin --profile web add \$\{runRoot\}\/harness/u);

  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.dsh.bundle, undefined);
  assert.equal(Object.keys(manifest.overrides).length, 252);
  assert.equal(manifest.overrides["@deepseek-ai/dsh-experimental-code-runtime-python"], "0.1.2-alpha.4");
  assert.equal(manifest.overrides["@deepseek-ai/dsh-code-runtime-python"], undefined);
  assert.equal(manifest.overrides["@deepseek-ai/dsh-tool-subagent-report"], undefined);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
console.log("alpha4 live-harness proof passed: packed-clean prerequisites, isolated auth roots, stock/additive/patched composition, stdin launch token, persisted route/stream/terminal/no-tool gate, installed-artifact HMR, process-group cleanup contract");
