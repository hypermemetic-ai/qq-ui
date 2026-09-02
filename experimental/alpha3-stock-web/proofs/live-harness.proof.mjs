#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("../", import.meta.url);
const scratch = await mkdtemp(join(tmpdir(), "qq-alpha3-live-tools-"));
const run = (script, args) => spawnSync(process.execPath, [new URL(script, packageRoot).pathname, ...args], { encoding: "utf8" });
try {
  const source = join(scratch, "client.cjs");
  const backup = join(scratch, "client.backup.cjs");
  await cp(new URL("../src/client.cjs", import.meta.url), source);
  const original = await readFile(source);
  const disabled = run("scripts/live/mutate-client.mjs", ["disable", source, backup]);
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.match(await readFile(source, "utf8"), /Live-gate disposal probe/u);
  const restored = run("scripts/live/mutate-client.mjs", ["restore", source, backup]);
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(await readFile(source), original, "HMR helper must restore source byte-for-byte");

  const isolatedRoot = join(scratch, "isolated-environment-root");
  const envProbe = spawnSync(process.execPath, [new URL("../scripts/live/isolated-exec.mjs", import.meta.url).pathname, isolatedRoot,
    process.execPath, "-e", "process.stdout.write(JSON.stringify(process.env))"], {
    encoding: "utf8", env: { ...process.env, QQ_AMBIENT_SECRET_PROBE: "must-not-cross" },
  });
  assert.equal(envProbe.status, 0, envProbe.stderr);
  const isolatedEnv = JSON.parse(envProbe.stdout);
  assert.equal(isolatedEnv.QQ_AMBIENT_SECRET_PROBE, undefined, "ambient credentials/variables must not cross isolation boundary");
  assert.equal(isolatedEnv.DSH_HOME, `${isolatedRoot}/dsh-home`);
  assert.equal(isolatedEnv.HOME, `${isolatedRoot}/os-home`);

  const protectedRoot = join(scratch, "browser-guard");
  const guard = run("scripts/live/browser.mjs", [
    "--url", "http://127.0.0.1:3082/protected",
    "--spike", `${protectedRoot}/spike`,
    "--workspace", `${protectedRoot}/workspace`,
    "--artifacts", `${protectedRoot}/artifacts`,
  ]);
  assert.equal(guard.status, 2, guard.stderr);
  assert.match(guard.stderr, /refusing protected legacy port 3082/u);

  const remoteGuard = run("scripts/live/browser.mjs", [
    "--url", "https://example.invalid/not-loopback",
    "--spike", `${protectedRoot}/spike`,
    "--workspace", `${protectedRoot}/workspace`,
    "--artifacts", `${protectedRoot}/artifacts`,
  ]);
  assert.equal(remoteGuard.status, 2, remoteGuard.stderr);
  assert.match(remoteGuard.stderr, /refusing a non-loopback HTTP live target/u);

  const pathGuard = run("scripts/live/browser.mjs", [
    "--url", "http://127.0.0.1:49152/isolated",
    "--spike", "/home/qqp/projects/qq-ui",
    "--workspace", `${protectedRoot}/workspace`,
    "--artifacts", `${protectedRoot}/artifacts`,
  ]);
  assert.equal(pathGuard.status, 2, pathGuard.stderr);
  assert.match(pathGuard.stderr, /refusing spike outside \/tmp\/qq-alpha3-live-/u);

  // This proof does not substitute for a live browser run. It locks the
  // alpha.3 blank -> rendered Send -> engaging/active interaction ordering.
  const browserHarness = await readFile(new URL("../scripts/live/browser.mjs", import.meta.url), "utf8");
  const onboarding = browserHarness.slice(
    browserHarness.indexOf("async function dismissOnboarding"),
    browserHarness.indexOf("async function connectWorkspace"),
  );
  assert.ok(onboarding.includes("await continueButton.waitFor("), "fresh-profile Continue must be awaited");
  assert.ok(onboarding.includes("await later.waitFor("), "fresh-profile Configure later must be awaited");
  assert.ok(!onboarding.includes("continueButton.count(") && !onboarding.includes("later.count("),
    "onboarding must not use an instantaneous presence probe");

  const workspaceConnection = browserHarness.slice(
    browserHarness.indexOf("async function connectWorkspace"),
    browserHarness.indexOf("async function currentTheme"),
  );
  assert.ok(workspaceConnection.includes('locator("[data-composer-input]")'),
    "workspace creation must wait for the resident composer");
  assert.ok(!workspaceConnection.includes("contenteditable"),
    "workspace creation must not require provider-dependent composer editability");

  const blankAssertion = browserHarness.slice(
    browserHarness.indexOf("async function assertBlankChromeHidden"),
    browserHarness.indexOf("async function openQQView"),
  );
  for (const visibleOnlyAfterTransition of ["data-qq-command", 'getByRole("tab", { name: "QQ"', "data-qq-plugin-root"]) {
    assert.ok(blankAssertion.includes(visibleOnlyAfterTransition),
      `blank assertion must grade ${visibleOnlyAfterTransition} as absent`);
  }

  const slashLauncher = browserHarness.slice(
    browserHarness.indexOf("async function openQQSlashCatalog"),
    browserHarness.indexOf("async function assertSlashPresent"),
  );
  assert.ok(slashLauncher.includes('getByRole("button", { name: "Commands"'),
    "blank slash proof must use the rendered stock Commands action");
  assert.ok(!slashLauncher.includes("contenteditable"),
    "blank slash proof must not depend on provider-dependent editor input");
  const slashPresence = browserHarness.slice(
    browserHarness.indexOf("async function assertSlashPresent"),
    browserHarness.indexOf("async function assertSlashAbsent"),
  );
  const catalogPick = slashPresence.indexOf("await catalogRow.click");
  const popupWait = slashPresence.indexOf("await option.waitFor");
  assert.ok(catalogPick >= 0 && catalogPick < popupWait,
    "slash proof must pick the /qq catalog row before waiting for popupSelect");

  const transition = browserHarness.slice(
    browserHarness.indexOf("async function transitionSessionThroughComposer"),
    browserHarness.indexOf("async function assessModelTurn"),
  );
  const blocked = transition.indexOf('status: "BLOCKED_PROVIDER_CONFIGURATION"');
  const fill = transition.indexOf("await composer.fill(prompt)");
  const send = transition.indexOf('getByRole("button", { name: "Send"');
  const sendDisabled = transition.indexOf("await send.isDisabled()");
  const sendBlocked = transition.indexOf('status: "BLOCKED_PROVIDER_CONFIGURATION"', blocked + 1);
  const click = transition.indexOf("await send.click");
  const chromeWait = transition.indexOf("await header.waitFor");
  assert.ok(blocked >= 0 && blocked < fill,
    "non-editable composer must block before any fabricated submission");
  assert.ok(fill >= 0 && fill < send && send < sendDisabled && sendDisabled < sendBlocked && sendBlocked < click,
    "disabled rendered Send must block instead of timing out or fabricating a submission");
  assert.ok(click < chromeWait,
    "transition must click an enabled rendered Send before grading active chrome");
  for (const forbidden of ["page.evaluate", "__DSH", ".dispatch(", ".controller", "getSnapshot(", "promptAttempted"]) {
    assert.ok(!transition.includes(forbidden), `transition must not use private state path ${forbidden}`);
  }

  const liveFlow = browserHarness.slice(
    browserHarness.indexOf("try {\n  browser = await chromium.launch"),
    browserHarness.indexOf("} catch (error)", browserHarness.indexOf("try {\n  browser = await chromium.launch")),
  );
  const connect = liveFlow.indexOf("await connectWorkspace()");
  const blankChrome = liveFlow.indexOf("await assertBlankChromeHidden()", connect);
  const blankSlash = liveFlow.indexOf("await assertSlashPresent()", blankChrome);
  const transitionCall = liveFlow.indexOf("await transitionSessionThroughComposer()", blankSlash);
  const activeBranch = liveFlow.indexOf('if (activeChrome)', transitionCall);
  const activeAssertion = liveFlow.indexOf("await assertActiveQQChromePresent()", activeBranch);
  assert.ok(connect >= 0 && connect < blankChrome && blankChrome < blankSlash
    && blankSlash < transitionCall && transitionCall < activeBranch && activeBranch < activeAssertion,
  "live flow must assert blank-visible contributions, drive Send, then conditionally grade active chrome");
  assert.ok(!liveFlow.slice(connect, transitionCall).includes("assertActiveQQChromePresent"),
    "active QQ chrome must never be asserted while the fresh Session is still blank");
  assert.ok(liveFlow.includes("await waitForDisposal(activeChrome)"),
    "HMR disposal must receive the empirically observed chrome phase");
  assert.ok(liveFlow.includes('chrome: activeChrome ? "PASS_HEADER_TAB_VIEW_REMOVED" : "BLOCKED_SESSION_REMAINED_BLANK"'),
    "HMR report must block rather than pass unrendered header/view cleanup");

  const modelTurn = browserHarness.slice(
    browserHarness.indexOf("async function assessModelTurn"),
    browserHarness.indexOf("async function startWatcher"),
  );
  assert.ok(modelTurn.includes("transition.marker") && modelTurn.includes('status: "PASS"'),
    "model-turn pass must require the exact rendered assistant marker");
  assert.ok(modelTurn.includes('"BLOCKED_PROVIDER_OR_CREDENTIAL"')
    && modelTurn.includes('"BLOCKED_NO_ASSISTANT_RESPONSE"'),
  "provider failure or absent response must remain blocked, not pass");

  const disposal = browserHarness.slice(
    browserHarness.indexOf("async function waitForDisposal"),
    browserHarness.indexOf("try {", browserHarness.indexOf("async function waitForDisposal")),
  );
  assert.ok(disposal.includes("await waitForTheme(false)"),
    "blank-safe disposal must wait for QQ theme removal");
  assert.ok(disposal.includes("await assertSlashAbsent()"),
    "blank-safe disposal must prove top-level /qq cleanup");

  const sourceTree = join(scratch, "source", "packages", "fixture");
  await mkdir(sourceTree, { recursive: true });
  await writeFile(join(sourceTree, "package.json"), `${JSON.stringify({ name: "@deepseek-ai/dsh-fixture", version: "0.1.2-alpha.3" })}\n`);
  const profile = join(scratch, "profile.json");
  await writeFile(profile, `${JSON.stringify({
    private: true,
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], patchReload: "live" } },
  })}\n`);
  const pinned = run("scripts/live/pin-profile.mjs", [profile, join(scratch, "source")]);
  assert.equal(pinned.status, 0, pinned.stderr);
  const pinnedProfile = JSON.parse(await readFile(profile, "utf8"));
  assert.deepEqual(pinnedProfile.dsh.profile.bundles, ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);
  assert.equal(pinnedProfile.pnpm.overrides["@deepseek-ai/dsh-fixture"], "0.1.2-alpha.3");

  const writableSpike = join(scratch, "writable-spike");
  const linkedPackage = join(scratch, "profile", "node_modules", "@hypermemetic-ai", "qq-ui-alpha3-spike");
  await mkdir(writableSpike, { recursive: true });
  await mkdir(join(scratch, "profile", "node_modules", "@hypermemetic-ai"), { recursive: true });
  const linkedProfile = join(scratch, "profile", "package.json");
  await writeFile(linkedProfile, `${JSON.stringify({
    dependencies: { "@hypermemetic-ai/qq-ui-alpha3-spike": `link:${writableSpike}` },
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], patchReload: "live" } },
  })}\n`);
  await symlink(writableSpike, linkedPackage, "dir");
  const stockDump = join(scratch, "stock.yml");
  const patchedDump = join(scratch, "patched.yml");
  await writeFile(stockDump, "- id: stock\n  name: '@deepseek-ai/dsh-web-app'\n");
  await writeFile(patchedDump, "- id: stock\n  name: '@deepseek-ai/dsh-web-app'\n- id: qq-ui-alpha3-spike\n  name: '@hypermemetic-ai/qq-ui-alpha3-spike'\n");
  const composition = run("scripts/live/verify-composition.mjs", [linkedProfile, writableSpike, stockDump, patchedDump]);
  assert.equal(composition.status, 0, composition.stderr);

  const project = join(scratch, "project");
  const installed = join(project, "node_modules", "@deepseek-ai", "dsh-fixture");
  await mkdir(installed, { recursive: true });
  await writeFile(join(installed, "package.json"), `${JSON.stringify({ name: "@deepseek-ai/dsh-fixture", version: "0.1.2-alpha.3" })}\n`);
  const inventoryPath = join(scratch, "inventory.json");
  const inventory = run("scripts/live/inventory.mjs", [inventoryPath, project]);
  assert.equal(inventory.status, 0, inventory.stderr);
  assert.equal(JSON.parse(await readFile(inventoryPath, "utf8")).dshPackageLocations, 1);
  await writeFile(join(installed, "package.json"), `${JSON.stringify({ name: "@deepseek-ai/dsh-fixture", version: "0.1.2-alpha.4" })}\n`);
  const drift = run("scripts/live/inventory.mjs", [inventoryPath, project]);
  assert.notEqual(drift.status, 0, "alpha.4 inventory drift must fail");
  assert.match(drift.stderr, /0\.1\.2-alpha\.4/u);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
console.log("alpha3 live-harness proof passed: blank-before-Send sequencing, conditional chrome/HMR grading, protected origin, reversible probe, stock pins, drift rejection");
