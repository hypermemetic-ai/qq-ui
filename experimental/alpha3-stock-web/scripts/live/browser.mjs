#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const QQ_ID = "@hypermemetic-ai/qq-ui-alpha3-spike";
const QQ_COMMAND = "qq.session.copy-numbered-identity";
const QQ_CATALOG_DESCRIPTION = "QQ session actions";
const QQ_OPTION_LABEL = "Copy numbered session identity";
const THEME = {
  "--dsw-alias-bg-base": { light: "#ffffff", dark: "#050505" },
  "--dsw-alias-bg-layer-1": { light: "#f7f7f7", dark: "#0b0b0b" },
  "--dsw-alias-border-l1": { light: "#111111", dark: "#eeeeee" },
  "--dsw-alias-brand-primary": { light: "#000000", dark: "#ffffff" },
  "--dsw-alias-label-primary": { light: "#000000", dark: "#ffffff" },
};
function usage(message) {
  if (message) console.error(message);
  console.error("usage: node scripts/live/browser.mjs --url <printed dsh launch URL> --spike </tmp/.../spike> --workspace </tmp/.../workspace> --artifacts </tmp/.../artifacts> [--playwright <module-dir>]");
  process.exit(2);
}
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--") || value === undefined) usage("options require name/value pairs");
  options[key.slice(2)] = value;
}
for (const required of ["url", "spike", "workspace", "artifacts"]) if (!options[required]) usage(`missing --${required}`);
const launchUrl = new URL(options.url);
if (launchUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(launchUrl.hostname)) {
  usage("refusing a non-loopback HTTP live target");
}
if (launchUrl.port === "3082") usage("refusing protected legacy port 3082");
const spike = resolve(options.spike);
const workspaceRoot = resolve(options.workspace);
const artifacts = resolve(options.artifacts);
for (const [label, path] of [["spike", spike], ["workspace", workspaceRoot], ["artifacts", artifacts]]) {
  if (!path.startsWith("/tmp/qq-alpha3-live-")) usage(`refusing ${label} outside /tmp/qq-alpha3-live-*: ${path}`);
}
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
mkdirSync(join(workspaceRoot, "workspace"), { recursive: true, mode: 0o700 });
const require = createRequire(import.meta.url);
const playwrightRoot = options.playwright ? resolve(options.playwright) : "playwright";
let chromium;
try {
  ({ chromium } = require(playwrightRoot));
} catch (error) {
  console.error(`BLOCKED: cannot load Playwright from ${playwrightRoot}: ${error.message}`);
  process.exit(2);
}
const browserVersion = require(join(playwrightRoot, "package.json")).version;
const executablePath = options.executable ? resolve(options.executable) : undefined;
if (executablePath !== undefined && !existsSync(executablePath)) usage(`Chromium executable does not exist: ${executablePath}`);
const consoleRows = [];
const networkRows = [];
const pageErrors = [];
let watcher;
let browser;
let context;
let page;
let originalSource;
let backup;
const result = {
  startedAt: new Date().toISOString(),
  origin: launchUrl.origin,
  playwright: browserVersion,
  viewportAssertions: [],
  hmr: {},
};
function recordConsole(message) {
  consoleRows.push({ type: message.type(), text: message.text() });
}
async function dismissOnboarding() {
  // Every live run uses a fresh isolated profile. The welcome/settings reads
  // complete after the boot spinner leaves, so count() here would race the
  // first stable interactive surface instead of waiting for it.
  const continueButton = page.getByRole("button", { name: "Continue", exact: true });
  await continueButton.waitFor({ timeout: 60_000 });
  await continueButton.click();
  const later = page.getByRole("button", { name: "Configure later", exact: true });
  await later.waitFor({ timeout: 30_000 });
  await later.click();
  await later.waitFor({ state: "detached", timeout: 15_000 });
}
async function connectWorkspace() {
  await page.getByRole("textbox", { name: "Choose workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Select Workspace Directory" });
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Edit path" }).click();
  const input = dialog.getByRole("textbox", { name: "Edit path" });
  await input.fill(join(workspaceRoot, "workspace"));
  await input.press("Enter");
  await dialog.getByRole("button", { name: "Open", exact: true }).click();
  // A fresh Session always has a resident composer, but alpha.3 may keep its
  // editor non-editable or Send disabled until a model/provider is configured. Do not turn that
  // legitimate credential prerequisite into a workspace timeout.
  await page.locator("[data-composer-input]").waitFor({ timeout: 20_000 });
}
async function currentTheme() {
  return await page.evaluate((keys) => {
    // The alpha.3 ThemePresenter projects active theme tokens as inline body
    // declarations. Computed-style custom-property serialization reflects the
    // stylesheet cascade after disposal; it is not the boundary that proves
    // whether the presenter removed QQ's override.
    const style = document.body.style;
    return {
      mode: document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light",
      values: Object.fromEntries(keys.map((key) => [key, style.getPropertyValue(key).trim()])),
    };
  }, Object.keys(THEME));
}
async function assertTheme(expectedQQ) {
  const theme = await currentTheme();
  for (const [key, modes] of Object.entries(THEME)) {
    const expected = expectedQQ ? modes[theme.mode] : "";
    assert.equal(theme.values[key].toLowerCase(), expected,
      `${key} ${expectedQQ ? `QQ ${theme.mode} inline token` : "QQ inline override removed"}`);
  }
  return theme;
}
async function waitForTheme(expectedQQ, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try {
      return await assertTheme(expectedQQ);
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(100);
    }
  } while (Date.now() < deadline);
  throw lastError;
}
async function assertBlankChromeHidden() {
  assert.equal(await page.locator(`[data-qq-command="${QQ_COMMAND}"]`).count(), 0,
    "blank Session does not render the QQ header action");
  assert.equal(await page.getByRole("tab", { name: "QQ", exact: true }).count(), 0,
    "blank Session does not render the QQ view tablist");
  assert.equal(await page.locator('[data-qq-plugin-root]').count(), 0,
    "blank Session does not render the selected view area");
}
async function openQQView() {
  const qqTab = page.getByRole("tab", { name: "QQ", exact: true });
  await qqTab.waitFor({ timeout: 20_000 });
  await qqTab.click();
  await page.locator('[data-qq-plugin-root="session-page"]').waitFor({ timeout: 15_000 });
}
async function assertActiveQQChromePresent() {
  const header = page.locator(`[data-qq-command="${QQ_COMMAND}"]`);
  await header.waitFor({ timeout: 20_000 });
  assert.equal(await header.count(), 1, "exactly one QQ header contribution");
  assert.match((await header.textContent()) ?? "", /^QQ (?:\d+|\?)$/u);
  const qqTab = page.getByRole("tab", { name: "QQ", exact: true });
  await qqTab.waitFor({ timeout: 20_000 });
  assert.equal(await qqTab.count(), 1, "exactly one stock QQ view tab");
  await openQQView();
  assert.equal(await page.locator('[data-qq-plugin-root="session-page"]').count(), 1, "exactly one QQ view");
  await page.getByText("QQ CORE / ALPHA.3", { exact: true }).waitFor({ timeout: 10_000 });
  await assertTheme(true);
}
async function openQQSlashCatalog() {
  await page.keyboard.press("Escape");
  const commands = page.getByRole("button", { name: "Commands", exact: true });
  await commands.waitFor({ timeout: 15_000 });
  await commands.click();
  const catalogRow = page.getByText(QQ_CATALOG_DESCRIPTION, { exact: true });
  await catalogRow.waitFor({ timeout: 15_000 });
  return catalogRow;
}
async function assertSlashPresent() {
  // Use the rendered stock command launcher. Unlike typing `/qq`, this remains
  // a supported visible action when provider configuration blocks editor input.
  const catalogRow = await openQQSlashCatalog();
  assert.equal(await catalogRow.count(), 1, "exactly one /qq catalog row");
  await catalogRow.click();
  const option = page.getByText(QQ_OPTION_LABEL, { exact: true });
  await option.waitFor({ timeout: 15_000 });
  assert.equal(await option.count(), 1, "exactly one /qq popup option");
  await option.click();
}
async function assertSlashAbsent() {
  await page.keyboard.press("Escape");
  const commands = page.getByRole("button", { name: "Commands", exact: true });
  await commands.waitFor({ timeout: 15_000 });
  await commands.click();
  const catalogRow = page.getByText(QQ_CATALOG_DESCRIPTION, { exact: true });
  const deadline = Date.now() + 1_500;
  do {
    assert.equal(await catalogRow.count(), 0, "/qq catalog row removed on disposal");
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  await page.keyboard.press("Escape");
}
async function assertBlankResponsive(name, width, height) {
  await page.setViewportSize({ width, height });
  await assertBlankChromeHidden();
  const composer = page.locator("[data-composer-input]");
  const geometry = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  geometry.composer = await composer.boundingBox();
  assert.ok(geometry.composer, `${name}: stock blank composer is rendered`);
  assert.ok(geometry.documentWidth <= geometry.innerWidth + 1, `${name}: no document horizontal overflow`);
  assert.ok(geometry.bodyWidth <= geometry.innerWidth + 1, `${name}: no body horizontal overflow`);
  await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true });
  result.viewportAssertions.push({ phase: "blank", name, width, height, geometry });
}
async function assertActiveResponsive(name, width, height) {
  await page.setViewportSize({ width, height });
  await openQQView();
  const qq = page.locator('[data-qq-plugin-root="session-page"]');
  const geometry = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  geometry.qq = await qq.boundingBox();
  assert.ok(geometry.qq, `${name}: QQ view is rendered`);
  assert.ok(geometry.documentWidth <= geometry.innerWidth + 1, `${name}: no document horizontal overflow`);
  assert.ok(geometry.bodyWidth <= geometry.innerWidth + 1, `${name}: no body horizontal overflow`);
  await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true });
  result.viewportAssertions.push({ phase: "active", name, width, height, geometry });
}
async function transitionSessionThroughComposer() {
  const composer = page.locator("[data-composer-input]");
  await composer.waitFor({ timeout: 15_000 });
  const editorDeadline = Date.now() + 5_000;
  let contentEditable;
  do {
    contentEditable = await composer.getAttribute("contenteditable");
    if (contentEditable === "true") break;
    await page.waitForTimeout(100);
  } while (Date.now() < editorDeadline);
  const precondition = {
    contentEditable,
    ariaDisabled: await composer.getAttribute("aria-disabled"),
    placeholder: await composer.getAttribute("data-placeholder"),
  };
  if (precondition.contentEditable !== "true") {
    return {
      status: "BLOCKED_PROVIDER_CONFIGURATION",
      reason: "stock composer is rendered but not editable; configure a model/provider in the isolated profile",
      precondition,
    };
  }

  const marker = `QQ_ALPHA3_LIVE_MODEL_TURN_${Date.now()}`;
  const prompt = `Reply with exactly ${marker} and nothing else.`;
  await composer.fill(prompt);
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await send.waitFor({ timeout: 15_000 });
  const sendDeadline = Date.now() + 5_000;
  do {
    precondition.sendDisabled = await send.isDisabled();
    if (!precondition.sendDisabled) break;
    await page.waitForTimeout(100);
  } while (Date.now() < sendDeadline);
  if (precondition.sendDisabled) {
    return {
      status: "BLOCKED_PROVIDER_CONFIGURATION",
      reason: "stock composer accepts a draft but its rendered Send action is disabled; configure a model/provider in the isolated profile",
      precondition,
    };
  }
  await send.click({ timeout: 15_000 });

  // alpha.3 beginSubmission synchronously moves blank -> engaging before the
  // provider call. Observe that public rendered transition; never set Session
  // state or call a controller from the harness.
  const header = page.locator(`[data-qq-command="${QQ_COMMAND}"]`);
  try {
    await header.waitFor({ timeout: 15_000 });
  } catch (error) {
    const renderedAlerts = await page.getByRole("alert").allTextContents();
    throw new Error(`supported Send did not expose alpha.3 engaging chrome; rendered alerts: ${JSON.stringify(renderedAlerts)}; ${error.message}`);
  }
  return { status: "PASS", marker, prompt, precondition };
}
async function assessModelTurn(transition) {
  if (transition.status !== "PASS") {
    return {
      status: "BLOCKED_PROVIDER_CONFIGURATION",
      reason: "no prompt was submitted because the isolated stock editor/Send path was provider-blocked",
    };
  }
  const stockChat = page.getByRole("tab", { name: "Chat", exact: true });
  await stockChat.waitFor({ timeout: 15_000 });
  await stockChat.click();
  const assistantMarker = page.getByText(transition.marker, { exact: true });
  try {
    await assistantMarker.waitFor({ timeout: 60_000 });
    assert.equal(await assistantMarker.count(), 1, "exactly one rendered assistant marker");
    return { status: "PASS", marker: transition.marker };
  } catch {
    const renderedAlerts = (await page.getByRole("alert").allTextContents()).map(text => text.trim()).filter(Boolean);
    const renderedStatuses = (await page.getByRole("status").allTextContents()).map(text => text.trim()).filter(Boolean);
    return {
      status: renderedAlerts.length > 0 || renderedStatuses.length > 0
        ? "BLOCKED_PROVIDER_OR_CREDENTIAL"
        : "BLOCKED_NO_ASSISTANT_RESPONSE",
      marker: transition.marker,
      renderedAlerts,
      renderedStatuses,
    };
  }
}
async function startWatcher() {
  watcher = spawn(process.execPath, [join(spike, "scripts", "watch.mjs")], { cwd: spike, stdio: ["ignore", "pipe", "pipe"] });
  const watcherLog = [];
  watcher.stdout.on("data", (chunk) => watcherLog.push(chunk.toString()));
  watcher.stderr.on("data", (chunk) => watcherLog.push(chunk.toString()));
  result.watcherLog = watcherLog;
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`watcher did not start: ${watcherLog.join("")}`)), 15_000);
    const inspect = () => {
      if (!watcherLog.join("").includes("alpha3 spike watcher:")) return;
      clearTimeout(timer);
      resolveReady();
    };
    watcher.stdout.on("data", inspect);
    watcher.stderr.on("data", inspect);
    watcher.once("exit", (code) => { clearTimeout(timer); reject(new Error(`watcher exited ${code}: ${watcherLog.join("")}`)); });
  });
}
async function runMutation(mode) {
  const args = [join(spike, "scripts", "live", "mutate-client.mjs"), mode, join(spike, "src", "client.cjs"), backup];
  await new Promise((resolveDone, reject) => {
    const child = spawn(process.execPath, args, { cwd: spike, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", (code) => code === 0 ? resolveDone() : reject(new Error(`mutation ${mode} failed ${code}: ${output}`)));
  });
}
async function waitForDisposal(activeChrome) {
  if (activeChrome) {
    await page.locator(`[data-qq-command="${QQ_COMMAND}"]`).waitFor({ state: "detached", timeout: 30_000 });
    assert.equal(await page.getByRole("tab", { name: "QQ", exact: true }).count(), 0, "QQ tab removed on disposal");
    assert.equal(await page.locator('[data-qq-plugin-root]').count(), 0, "QQ view marker removed on disposal");
  } else {
    await assertBlankChromeHidden();
  }
  await waitForTheme(false);
  await assertSlashAbsent();
  assert.ok(await page.locator("#root").count(), "stock shell survives QQ disposal");
}
try {
  browser = await chromium.launch({ headless: true, ...(executablePath === undefined ? {} : { executablePath }) });
  result.chromium = browser.version();
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US", permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage();
  page.on("console", recordConsole);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => networkRows.push({ kind: "failed", url: request.url(), error: request.failure()?.errorText }));
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("client.js") || url.includes("plugins/events")) networkRows.push({ kind: "response", url: new URL(url).pathname, status: response.status() });
  });
  await page.goto(launchUrl.href, { waitUntil: "load", timeout: 60_000 });
  await page.locator("#root").waitFor({ timeout: 30_000 });
  await page.locator("[data-dsh-boot]").waitFor({ state: "detached", timeout: 60_000 });
  assert.equal(await page.getByText("Failed to load plugins", { exact: false }).count(), 0, "client boot has no plugin failure shell");
  const boot = await page.evaluate(() => window.__DSH_BOOT__);
  assert.ok(boot && Array.isArray(boot.entries), "stock window.__DSH_BOOT__ manifest exists");
  const ids = boot.entries.map((entry) => entry.id);
  assert.equal(ids.filter((id) => id === QQ_ID).length, 1, "boot graph has exactly one QQ client row");
  for (const stock of ["@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-chat"]) {
    assert.equal(ids.filter((id) => id === stock).length, 1, `stock roster retains ${stock}`);
  }
  result.boot = { rev: boot.rev, entryCount: ids.length, ids };
  await dismissOnboarding();
  await connectWorkspace();

  // Fresh alpha.3 Sessions are intentionally blank: the header actions,
  // tablist, and view area are not rendered yet. Prove only contributions that
  // the blank stock shell actually exposes.
  await assertBlankChromeHidden();
  result.blankContributions = { theme: await waitForTheme(true) };
  await assertSlashPresent();
  result.blankContributions.slash = "PASS_EXACTLY_ONCE";
  await assertBlankResponsive("blank-desktop-1280x800", 1280, 800);
  await assertBlankResponsive("blank-mobile-390x844", 390, 844);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Drive the real stock composer. A supported Send flips alpha.3 to engaging
  // synchronously; a provider-blocked editor/Send path is retained as an
  // honest block and never fabricated into active Session state.
  const transition = await transitionSessionThroughComposer();
  result.sessionTransition = transition;
  const activeChrome = transition.status === "PASS";
  if (activeChrome) {
    await assertActiveQQChromePresent();
    result.activeChrome = "PASS_AFTER_RENDERED_SEND";
    await assertActiveResponsive("active-desktop-1280x800", 1280, 800);
    await assertActiveResponsive("active-mobile-390x844", 390, 844);
    await page.setViewportSize({ width: 1280, height: 800 });
    const stockChat = page.getByRole("tab", { name: "Chat", exact: true });
    await stockChat.click();
  } else {
    await assertBlankChromeHidden();
    result.activeChrome = "BLOCKED_PROVIDER_CONFIGURATION_SESSION_REMAINED_BLANK";
  }

  const beforeNavigation = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  backup = join(artifacts, `client.cjs.original-${Date.now()}`);
  originalSource = readFileSync(join(spike, "src", "client.cjs"));
  await startWatcher();
  await runMutation("disable");
  await waitForDisposal(activeChrome);
  result.hmr.disposed = {
    blankVisibleContributions: "PASS_THEME_AND_SLASH_REMOVED",
    chrome: activeChrome ? "PASS_HEADER_TAB_VIEW_REMOVED" : "BLOCKED_SESSION_REMAINED_BLANK",
  };
  await runMutation("restore");
  await waitForTheme(true);
  await assertSlashPresent();
  if (activeChrome) await assertActiveQQChromePresent();
  else await assertBlankChromeHidden();
  result.hmr.reappliedExactlyOnce = {
    blankVisibleContributions: "PASS_THEME_AND_SLASH_EXACTLY_ONCE",
    chrome: activeChrome ? "PASS_HEADER_TAB_VIEW_EXACTLY_ONCE" : "BLOCKED_SESSION_REMAINED_BLANK",
  };
  result.hmr.navigationCount = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  assert.equal(result.hmr.navigationCount, beforeNavigation, "HMR does not reload the page");
  await page.screenshot({ path: join(artifacts, "hmr-reapplied.png"), fullPage: true });

  result.modelTurn = await assessModelTurn(transition);
  const badConsole = consoleRows.filter((row) => ["error"].includes(row.type));
  assert.deepEqual(pageErrors, [], "no page errors");
  assert.deepEqual(badConsole, [], "no browser console errors");
  if (!activeChrome) {
    result.status = "BLOCKED_PROVIDER_CONFIGURATION";
    process.exitCode = 2;
  } else if (result.modelTurn.status !== "PASS") {
    result.status = "BLOCKED_MODEL_TURN";
    process.exitCode = 2;
  } else {
    result.status = "PASS";
  }
} catch (error) {
  result.status = "FAIL";
  result.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  if (page) await page.screenshot({ path: join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (originalSource) writeFileSync(join(spike, "src", "client.cjs"), originalSource);
  if (watcher && watcher.exitCode === null) watcher.kill("SIGTERM");
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  result.finishedAt = new Date().toISOString();
  result.console = consoleRows;
  result.network = networkRows;
  result.pageErrors = pageErrors;
  if (Array.isArray(result.watcherLog)) result.watcherLog = result.watcherLog.join("");
  writeFileSync(join(artifacts, "browser-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: result.status, artifacts, error: result.error?.message }, null, 2));
}
