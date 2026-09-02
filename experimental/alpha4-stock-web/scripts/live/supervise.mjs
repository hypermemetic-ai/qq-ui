#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { disposableRunRoot } from "./run-root.mjs";

function usage(message) {
  if (message) console.error(message);
  console.error("usage: node scripts/live/supervise.mjs --run-root /tmp/qq-alpha4-live-<id> --playwright <module-dir> --executable <chromium>");
  process.exit(2);
}
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) usage("options require name/value pairs");
  options[key.slice(2)] = value;
}
for (const required of ["run-root", "playwright", "executable"]) if (!options[required]) usage(`missing --${required}`);
const runRoot = disposableRunRoot(options["run-root"]);
for (const [key, expected] of Object.entries({ HOME: join(runRoot, "os-home"), DSH_HOME: join(runRoot, "dsh-home"), QQ_DSH_HOME: join(runRoot, "qq-dsh-home") })) {
  assert.equal(process.env[key], expected, `${key} is not isolated; launch this supervisor through isolated-exec.mjs`);
}
const artifacts = join(runRoot, "artifacts");
const harness = join(runRoot, "harness");
const workspace = join(runRoot, "workspace");
const profileRoot = join(runRoot, "dsh-home", "profiles", "web");
const installedUi = realpathSync(join(profileRoot, "node_modules", "@hypermemetic-ai", "qq-ui-alpha4-spike"));
const dsh = join(runRoot, "host", "node_modules", ".bin", "dsh");
for (const path of [dsh, installedUi, resolve(options.playwright), resolve(options.executable)]) assert.ok(existsSync(path), `live prerequisite does not exist: ${path}`);
const authFactsPath = join(artifacts, "auth-facts.json");
assert.ok(existsSync(authFactsPath), "fresh Grok readiness facts are missing; do not launch before isolated device approval");
const authFacts = JSON.parse(readFileSync(authFactsPath, "utf8"));
assert.equal(authFacts.status, "READY", "fresh isolated Grok connector is not ready");
assert.equal(authFacts.connectors?.grok?.provider, "xai-auth");
assert.equal(authFacts.connectors?.grok?.ready, true);

function sanitize(text) {
  return String(text)
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/[^\s]*/giu, "[REDACTED_LOOPBACK_LAUNCH_URL]")
    .replace(/([?&]token=)[^&\s]+/giu, "$1[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\b(access_token|refresh_token|authorization|cookie)\b\s*[:=]\s*[^,;\s]+/giu, "$1:[REDACTED]")
    .replace(/\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){1,3}\b/gu, "[REDACTED_DEVICE_CODE]");
}
function groupExists(pgid) {
  try { process.kill(-pgid, 0); return true; } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}
function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }

let host;
let browser;
let hostExit;
let stopping;
let hostRaw = "";
let browserLog = "";
let launchUrl;
let spawnedPort;
const cleanup = {
  status: "PENDING", hostPid: undefined, processGroup: undefined, signalScope: "OWNED_NEGATIVE_PGID_ONLY",
  termSent: false, killSent: false, childExitObserved: false, groupGone: false, spawnedPortWasNotProtected3082: false,
};
async function stopOwnedHost(reason) {
  if (stopping) return stopping;
  stopping = (async () => {
    cleanup.reason = reason;
    if (!host) { cleanup.status = "NOT_STARTED"; cleanup.groupGone = true; return; }
    const pgid = host.pid;
    if (groupExists(pgid)) {
      process.kill(-pgid, "SIGTERM");
      cleanup.termSent = true;
    }
    let exited = await Promise.race([hostExit.then(() => true), delay(10_000).then(() => false)]);
    if (!exited && groupExists(pgid)) {
      process.kill(-pgid, "SIGKILL");
      cleanup.killSent = true;
      exited = await Promise.race([hostExit.then(() => true), delay(5_000).then(() => false)]);
    }
    cleanup.childExitObserved = exited;
    for (let attempt = 0; attempt < 50 && groupExists(pgid); attempt += 1) await delay(100);
    cleanup.groupGone = !groupExists(pgid);
    cleanup.status = exited && cleanup.groupGone ? "PASS_REAPED_NO_ORPHAN" : "FAIL_ORPHAN_OR_UNREAPED";
    assert.equal(cleanup.status, "PASS_REAPED_NO_ORPHAN", "owned host process group did not terminate cleanly");
  })();
  return stopping;
}
let externalSignal;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    externalSignal = signal;
    browser?.kill("SIGTERM");
    void stopOwnedHost(`supervisor received ${signal}`).finally(() => { process.exitCode = signal === "SIGINT" ? 130 : 143; });
  });
}

const final = { startedAt: new Date().toISOString(), status: "FAIL", phases: {}, model: "xai-auth/grok-4.6" };
try {
  host = spawn(dsh, [
    "web",
    "--patch", join(runRoot, "patches", "grok-default.patch.yml"),
    "--patch", join(harness, "host", "cordis.patch.yml"),
    "--host", "127.0.0.1", "--port", "0", "--no-open",
  ], { cwd: workspace, env: process.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  cleanup.hostPid = host.pid;
  cleanup.processGroup = host.pid;
  hostExit = new Promise((resolveExit) => host.once("exit", (code, signal) => {
    cleanup.hostExit = { code, signal };
    cleanup.childExitObserved = true;
    resolveExit({ code, signal });
  }));
  const appendHost = (chunk) => {
    hostRaw += chunk.toString();
    if (hostRaw.length > 8 * 1024 * 1024) throw new Error("host log exceeded safety cap");
    if (launchUrl !== undefined) return;
    const match = hostRaw.match(/dsh web:\s+(https?:\/\/[^\s]+)/u);
    if (!match) return;
    const candidate = new URL(match[1]);
    assert.equal(candidate.protocol, "http:");
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(candidate.hostname));
    assert.notEqual(candidate.port, "3082", "host selected protected legacy port 3082");
    assert.ok(candidate.searchParams.has("token"), "stock launch URL lacks one-time browser token");
    spawnedPort = Number(candidate.port);
    cleanup.spawnedPortWasNotProtected3082 = spawnedPort !== 3082;
    launchUrl = candidate.href;
  };
  host.stdout.on("data", appendHost);
  host.stderr.on("data", appendHost);
  const launchDeadline = Date.now() + 60_000;
  while (launchUrl === undefined && Date.now() < launchDeadline) {
    const early = await Promise.race([hostExit.then((row) => ({ exit: row })), delay(50).then(() => undefined)]);
    if (early?.exit) throw new Error(`stock host exited before printing a launch URL: ${JSON.stringify(early.exit)}`);
  }
  assert.ok(launchUrl, "stock host did not print a launch URL within 60 seconds");
  final.phases.hostBoot = "PASS_LOOPBACK_OS_ASSIGNED_PORT";
  writeFileSync(join(artifacts, "host.log"), sanitize(hostRaw), { mode: 0o600 });

  browser = spawn(process.execPath, [
    join(harness, "scripts", "live", "browser.mjs"),
    "--launch-stdin", "true",
    "--harness", harness,
    "--package", installedUi,
    "--workspace", workspace,
    "--artifacts", artifacts,
    "--browser-profile", join(runRoot, "browser-profile"),
    "--playwright", resolve(options.playwright),
    "--executable", resolve(options.executable),
  ], { cwd: workspace, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  browser.stdout.on("data", (chunk) => { browserLog += sanitize(chunk); });
  browser.stderr.on("data", (chunk) => { browserLog += sanitize(chunk); });
  browser.stdin.end(`${launchUrl}\n`);
  launchUrl = undefined;
  const browserExit = await new Promise((resolveExit) => browser.once("exit", (code, signal) => resolveExit({ code, signal })));
  writeFileSync(join(artifacts, "browser-runner.log"), browserLog, { mode: 0o600 });
  final.phases.browserExit = browserExit;
  await stopOwnedHost("browser phase completed");
  writeFileSync(join(artifacts, "host.log"), sanitize(hostRaw), { mode: 0o600 });
  writeFileSync(join(artifacts, "host-cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`, { mode: 0o600 });

  const browserResult = JSON.parse(readFileSync(join(artifacts, "browser-result.json"), "utf8"));
  final.phases.browser = browserResult.status;
  if (browserExit.code === 2) {
    final.status = "BLOCKED_BROWSER_OR_MODEL_GATE";
    process.exitCode = 2;
  } else {
    assert.deepEqual(browserExit, { code: 0, signal: null }, "browser assertion phase failed");
    assert.equal(browserResult.status, "PASS_BROWSER_PENDING_PERSISTED_TURN_PROOF");
    const nonce = browserResult.modelTurn?.marker;
    assert.match(nonce, /^QQ_ALPHA4_[0-9A-F]{24}$/u);
    const extractor = spawn(process.execPath, [join(harness, "scripts", "live", "extract-turn-facts.mjs"), runRoot, nonce], {
      cwd: workspace, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    let extractLog = "";
    extractor.stdout.on("data", (chunk) => { extractLog += sanitize(chunk); });
    extractor.stderr.on("data", (chunk) => { extractLog += sanitize(chunk); });
    const extractExit = await new Promise((resolveExit) => extractor.once("exit", (code, signal) => resolveExit({ code, signal })));
    writeFileSync(join(artifacts, "turn-extractor.log"), extractLog, { mode: 0o600 });
    assert.deepEqual(extractExit, { code: 0, signal: null }, "persisted model-turn proof failed");
    const turnFacts = JSON.parse(readFileSync(join(artifacts, "turn-facts.json"), "utf8"));
    assert.equal(turnFacts.status, "PASS");
    final.phases.persistedTurn = "PASS_ROUTE_STREAM_NONCE_COMPLETED_NO_TOOLS";
    final.phases.cleanup = cleanup.status;
    final.status = "PASS";
  }
} catch (error) {
  final.status = "FAIL";
  final.error = error instanceof Error ? { message: sanitize(error.message), stack: sanitize(error.stack) } : { message: sanitize(error) };
  process.exitCode = 1;
} finally {
  browser?.kill("SIGTERM");
  try { await stopOwnedHost(externalSignal ? `external ${externalSignal}` : "supervisor finalizer"); } catch (error) {
    final.status = "FAIL";
    final.cleanupError = sanitize(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  writeFileSync(join(artifacts, "host.log"), sanitize(hostRaw), { mode: 0o600 });
  writeFileSync(join(artifacts, "host-cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`, { mode: 0o600 });
  final.finishedAt = new Date().toISOString();
  final.cleanup = cleanup.status;
  final.spawnedPort = spawnedPort;
  writeFileSync(join(artifacts, "status.json"), `${JSON.stringify(final, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: final.status, cleanup: cleanup.status, artifacts }, null, 2));
}
