#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { createConsoleHandler } from "../src/http-app.mjs";

const rootId = "session-e1000000-0000-4000-8000-000000000001";
const childId = "session-e1000000-0000-4000-8000-000000000002";
const parentId = "session-e1000000-0000-4000-8000-000000000003";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function snapshot(id = rootId, { child = false } = {}) {
  return {
    id,
    project: "alpha",
    alias: child ? "runner" : "destination",
    ...(child ? { origin: "subagent", parent: parentId, parentAlias: "architect" } : {}),
    events: [],
    agentStatus: "idle",
    children: child ? [] : [{ id: childId, alias: "runner", status: "running" }],
    conversation: { nodes: [], pending: [] },
  };
}

function dashboardFor(id = rootId) {
  const observedAt = 1_788_000_000_000;
  return {
    schema: "qq.dashboard/v1",
    generatedAt: observedAt,
    projects: [{
      key: "p:alpha:", name: "alpha", label: "Alpha", folder: "", folderLabel: "",
      sessions: [{
        sessionId: id,
        alias: id === childId ? "runner" : "destination",
        label: id === childId ? "implementation" : "architect",
        parentSessionId: "",
        depth: 0,
        activity: "idle",
        idleForMs: 1_000,
        workflow: null,
        phase: "none",
        phaseStartedAt: null,
      }],
    }],
    usage: {
      generatedAt: observedAt,
      providers: [{
        id: "phase-e", label: "Phase E quota", state: "ready", observedAt,
        meters: [{ id: "warm", label: "warm", usedRatio: 0.25, resetAt: null, detail: "critical path excluded" }],
      }],
    },
  };
}

function parseSse(chunk) {
  return String(chunk).replaceAll("\r", "").split("\n\n").flatMap((block) => {
    const lines = block.split("\n");
    const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
    if (!event) return [];
    return [{
      event,
      data: lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n"),
    }];
  });
}

class FakeResponse extends EventEmitter {
  constructor(actions) {
    super();
    this.actions = actions;
    this.log = [];
    this.destroyed = false;
    this.writableEnded = false;
    this.socket = { setNoDelay: () => this.actions.push("socket:nodelay") };
  }
  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
    this.log.push({ type: "headers" });
    this.actions.push("headers");
  }
  flushHeaders() {
    this.log.push({ type: "flush-headers" });
    this.actions.push("flush:headers");
  }
  write(chunk) {
    const frames = parseSse(chunk);
    for (const frame of frames) {
      this.log.push({ type: "event", ...frame });
      this.actions.push(`frame:${frame.event}`);
    }
    return true;
  }
  flush() {
    this.log.push({ type: "flush" });
    this.actions.push("flush:events");
  }
  end() { this.writableEnded = true; }
}

function backendFor(rawSnapshot, actions) {
  const rows = [
    { id: rawSnapshot.id, project: "alpha", alias: rawSnapshot.alias, origin: rawSnapshot.origin },
    { id: rootId, project: "alpha", alias: "destination" },
  ];
  return {
    read: async (id) => {
      actions.push(`read:${id}`);
      return structuredClone(rawSnapshot);
    },
    list: async (...args) => {
      actions.push(args.length === 0 ? "list:active" : "list:sessions");
      return structuredClone(rows);
    },
    observe(id, listener) {
      actions.push(`observe:${id}`);
      listener(null, structuredClone(rawSnapshot));
      return () => actions.push(`unobserve:${id}`);
    },
    create: async () => structuredClone(rawSnapshot),
    prompt: async () => structuredClone(rawSnapshot),
    interrupt: async () => structuredClone(rawSnapshot),
    close: async () => ({ id: null }),
  };
}

function startSwitch(rawSnapshot, options = {}) {
  const { actions = [], ...handlerOptions } = options;
  const handler = createConsoleHandler(backendFor(rawSnapshot, actions), {
    ssePollMs: 60_000,
    latencyPersistence: false,
    ...handlerOptions,
  });
  const req = new EventEmitter();
  Object.assign(req, {
    method: "GET",
    url: `/qq/session/${rawSnapshot.id}/events?bootstrap=session&switch=41`,
    headers: {},
  });
  const res = new FakeResponse(actions);
  const handling = handler(req, res);
  return { actions, handler, handling, req, res };
}

async function waitFor(predicate, message, turns = 80) {
  for (let attempt = 0; attempt < turns; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function eventFrames(res, name) {
  return res.log.filter((entry) => entry.type === "event" && entry.event === name);
}

function closeSwitch(fixture) {
  fixture.req.emit("close");
  fixture.handler.dispose();
}

// A controlled, multi-second-equivalent modern case provider must not be on the
// live-switch critical path. Its legacy sibling is deliberately distinct: the
// handler must still choose exactly one API for this enrichment pass.
{
  const actions = [];
  const caseGate = deferred();
  let clock = 0;
  let modernCaseCalls = 0;
  let legacyCaseCalls = 0;
  const criticalCost = (name, value) => {
    actions.push(`provider:${name}`);
    clock += 1;
    return value;
  };
  const fixture = startSwitch(snapshot(), {
    actions,
    performanceNow: () => clock,
    offerFor: (id) => criticalCost(`offer:${id}`, { id: "offer-e", brief: "safe offer" }),
    approvalFor: (id) => criticalCost(`approval:${id}`, { id: "approval-e", toolName: "bash", reason: "safe approval" }),
    loginSheetFor: (id) => criticalCost(`login:${id}`, {
      action: "connect", connectors: [{ id: "model-e", label: "Phase E model", host: "loopback" }],
    }),
    overlayFor: (id) => criticalCost(`overlay:${id}`, { id: "overlay-e", title: "safe overlay", media: { src: "/phase-e.png" } }),
    sessionModeFor: (id) => criticalCost(`mode:${id}`, "find"),
    workflowsFor: (id) => criticalCost(`workflows:${id}`, ["find", "architect"]),
    dashboardFor: () => {
      actions.push("provider:dashboard");
      return dashboardFor(rootId);
    },
    progressFor: (id) => {
      actions.push(`provider:progress:${id}`);
      return { title: "Phase E download", current: "1", total: "2" };
    },
    caseFileFor: (id) => {
      modernCaseCalls += 1;
      actions.push(`provider:modern-case:${id}`);
      // This cost is intentionally much larger than every critical provider.
      clock += 5_000;
      return caseGate.promise;
    },
    caseFor: (id) => {
      legacyCaseCalls += 1;
      actions.push(`provider:legacy-case:${id}`);
      return { title: "wrong legacy case", text: "must not render" };
    },
  });

  await waitFor(() => eventFrames(fixture.res, "switch-ready").length > 0,
    "a pending secondary case provider blocked live-switch readiness");
  const readyAt = actions.indexOf("frame:switch-ready");
  const readyFlushAt = actions.findIndex((entry, index) => index > readyAt && entry === "flush:events");
  assert.ok(readyAt >= 0 && readyFlushAt > readyAt, "switch-ready is emitted and flushed");
  assert.ok(actions.indexOf("list:active") >= 0 && actions.indexOf("list:active") < readyAt,
    "live navigation metadata is acquired on the critical path");
  assert.equal(actions.slice(0, readyFlushAt + 1).some((entry) => entry.startsWith("provider:modern-case:")), false,
    "secondary case acquisition starts only after the ready flush");

  const criticalNames = fixture.res.log.filter((entry) => entry.type === "event")
    .slice(0, 8).map((entry) => entry.event);
  assert.deepEqual(criticalNames, [
    "switch-meta", "chrome", "transcript-reset", "live", "queue", "popups", "composer-shell", "switch-ready",
  ]);
  const criticalPopups = eventFrames(fixture.res, "popups")[0]?.data ?? "";
  assert.match(criticalPopups, /data-offer-id="offer-e"/);
  assert.match(criticalPopups, /data-approval-id="approval-e"/);
  assert.match(criticalPopups, /data-login-action="login"/);
  assert.match(criticalPopups, /data-overlay-id="overlay-e"/);
  assert.match(eventFrames(fixture.res, "chrome")[0]?.data ?? "", /destination/,
    "critical navigation metadata does not blank the destination chrome");
  assert.match(eventFrames(fixture.res, "chrome")[0]?.data ?? "", /workflows-choice/,
    "workflow mode/list state is available in critical chrome");
  assert.match(eventFrames(fixture.res, "composer-shell")[0]?.data ?? "", /id="composer"/,
    "critical composer state is usable before ready");

  const ready = JSON.parse(eventFrames(fixture.res, "switch-ready")[0].data);
  assert.equal(ready.id, rootId);
  assert.equal(ready.generation, 41);
  assert.equal(ready.timings.serverSheetsMs, 6,
    "serverSheetsMs measures active navigation plus critical optional sheets only");
  assert.ok(ready.timings.serverSheetsMs < 5_000,
    "the artificial secondary case cost is absent from critical server timing");

  await waitFor(() => actions.some((entry) => entry.startsWith("provider:modern-case:")),
    "full sheet reconciliation did not start after ready");
  assert.ok(actions.findIndex((entry) => entry.startsWith("provider:modern-case:")) > readyFlushAt,
    "secondary provider execution is ordered after the ready flush");
  assert.equal(modernCaseCalls, 1);
  assert.equal(legacyCaseCalls, 0, "modern case API prevents a redundant legacy call");

  caseGate.resolve({ title: "Phase E case", text: "late destination case document" });
  await waitFor(() => eventFrames(fixture.res, "case").some((frame) => frame.data.includes("late destination case document")),
    "late case data was not reconciled into the active destination");
  await waitFor(() => eventFrames(fixture.res, "usage").some((frame) => frame.data.includes("Phase E quota")),
    "late dashboard/usage did not arrive");
  await waitFor(() => eventFrames(fixture.res, "popups").some((frame) => frame.data.includes("Phase E download")),
    "late progress did not arrive");
  for (const [name, needle] of [["case", "late destination"], ["usage", "Phase E quota"], ["popups", "Phase E download"]]) {
    const at = fixture.res.log.findIndex((entry) => entry.event === name && entry.data.includes(needle));
    const readyLogAt = fixture.res.log.findIndex((entry) => entry.event === "switch-ready");
    assert.ok(at > readyLogAt, `${name} secondary truth arrives after ready`);
  }
  assert.equal(fixture.res.writableEnded, false);
  closeSwitch(fixture);
}

// A rejected modern secondary provider cannot retract ready or suppress other
// independently successful secondary regions.
{
  let modernCalls = 0;
  let legacyCalls = 0;
  const fixture = startSwitch(snapshot(), {
    offerFor: async () => { throw new Error("offer unavailable"); },
    approvalFor: () => ({ id: "isolated-approval", toolName: "bash", reason: "still safe" }),
    caseFileFor: async () => { modernCalls += 1; throw new Error("case unavailable"); },
    caseFor: async () => { legacyCalls += 1; return { title: "legacy", text: "wrong fallback" }; },
    dashboardFor: () => dashboardFor(rootId),
    progressFor: () => ({ title: "rejection-safe progress" }),
  });
  await fixture.handling;
  await waitFor(() => eventFrames(fixture.res, "switch-ready").length > 0, "rejection fixture did not become ready");
  assert.match(eventFrames(fixture.res, "popups")[0]?.data ?? "", /data-approval-id="isolated-approval"/,
    "one rejected critical facade does not suppress independent safety sheets");
  await waitFor(() => eventFrames(fixture.res, "usage").some((frame) => frame.data.includes("Phase E quota")),
    "case rejection suppressed dashboard reconciliation");
  await waitFor(() => eventFrames(fixture.res, "popups").some((frame) => frame.data.includes("rejection-safe progress")),
    "case rejection suppressed progress reconciliation");
  assert.equal(modernCalls, 1);
  assert.equal(legacyCalls, 0, "provider rejection does not invoke a second case API in the same pass");
  assert.equal(fixture.res.writableEnded, false, "secondary rejection never reverts ready state");
  closeSwitch(fixture);
}

// Legacy-only integrations remain supported with one deterministic acquisition.
{
  let legacyCalls = 0;
  const fixture = startSwitch(snapshot(), {
    caseFor: async (id) => {
      legacyCalls += 1;
      assert.equal(id, rootId);
      return { title: "legacy-only", text: "legacy case remains compatible" };
    },
  });
  await fixture.handling;
  await waitFor(() => eventFrames(fixture.res, "case").some((frame) => frame.data.includes("legacy case remains compatible")),
    "legacy-only case provider was not reconciled");
  assert.equal(legacyCalls, 1);
  closeSwitch(fixture);
}

// Transient find-work state is also critical. Hold a real overlay save mutation
// open, then prove a concurrent bootstrap carries its safe cancel/stop state.
{
  const actions = [];
  const raw = snapshot();
  const saveGate = deferred();
  const handler = createConsoleHandler(backendFor(raw, actions), {
    ssePollMs: 60_000,
    latencyPersistence: false,
    overlayFor: () => ({ id: "saving-overlay", title: "Saving image", media: { src: "/saving.png" } }),
    chooseOverlay: async (id) => {
      assert.equal(id, rootId);
      actions.push("choose-overlay:pending");
      return saveGate.promise;
    },
  });
  const mutationReq = Readable.from([Buffer.from("choice=keep")]);
  Object.assign(mutationReq, {
    method: "POST",
    url: `/qq/session/${rootId}/overlay`,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "sec-fetch-site": "same-origin",
      origin: "http://qq.local",
      host: "qq.local",
    },
  });
  const mutationRes = new FakeResponse(actions);
  const mutationHandling = handler(mutationReq, mutationRes);
  await waitFor(() => actions.includes("choose-overlay:pending"), "overlay save did not enter pending work");

  const req = new EventEmitter();
  Object.assign(req, {
    method: "GET",
    url: `/qq/session/${rootId}/events?bootstrap=session&switch=42`,
    headers: {},
  });
  const res = new FakeResponse(actions);
  const handling = handler(req, res);
  const fixture = { actions, handler, handling, req, res };
  await handling;
  await waitFor(() => eventFrames(res, "switch-ready").length > 0, "find-work switch did not become ready");
  assert.match(eventFrames(res, "composer-shell")[0]?.data ?? "", /Saving…/,
    "critical composer reflects pending find work before ready");
  assert.match(eventFrames(res, "popups")[0]?.data ?? "", /class="overlay-saving"/,
    "critical overlay preserves its safe pending/cancel state before ready");
  closeSwitch(fixture);
  saveGate.resolve({ status: "accepted" });
  await mutationHandling;
}

// Child sessions remain observe-only. Their optional progress is secondary and
// arrives through the same post-ready sheet reconciliation without case reads.
{
  let childCaseCalls = 0;
  const progressIds = [];
  const fixture = startSwitch(snapshot(childId, { child: true }), {
    offerFor: () => assert.fail("child must not acquire root offer sheets"),
    approvalFor: () => assert.fail("child must not acquire root approval sheets"),
    loginSheetFor: () => assert.fail("child must not acquire root login sheets"),
    overlayFor: () => assert.fail("child must not acquire root overlay sheets"),
    caseFileFor: () => { childCaseCalls += 1; return null; },
    progressFor: (id) => {
      progressIds.push(id);
      return { title: "child observe-only progress" };
    },
  });
  await fixture.handling;
  await waitFor(() => eventFrames(fixture.res, "switch-ready").length > 0, "child switch did not become ready");
  const readyLogAt = fixture.res.log.findIndex((entry) => entry.event === "switch-ready");
  assert.match(eventFrames(fixture.res, "chrome")[0]?.data ?? "", /Child transcript/);
  assert.equal(eventFrames(fixture.res, "composer-shell")[0]?.data, "",
    "child bootstrap has no mutating composer");
  await waitFor(() => eventFrames(fixture.res, "popups").some((frame) => frame.data.includes("child observe-only progress")),
    "child progress disappeared instead of arriving after ready");
  const progressAt = fixture.res.log.findIndex((entry) => entry.event === "popups" && entry.data.includes("child observe-only progress"));
  assert.ok(progressAt > readyLogAt);
  assert.deepEqual(progressIds, [childId]);
  assert.equal(childCaseCalls, 0, "child enrichment never acquires a case document");
  closeSwitch(fixture);
}

const pluginSource = readFileSync(new URL("../src/plugin.mjs", import.meta.url), "utf8");
assert.equal((pluginSource.match(/\bcaseFileFor\s*:/g) ?? []).length, 1,
  "plugin exposes the workflows case-file service through the modern option once");
assert.equal((pluginSource.match(/\bcaseFor\s*:/g) ?? []).length, 0,
  "plugin no longer aliases the same workflows service through the legacy option");

console.log("prove-live-switch-enrichment: pass");
