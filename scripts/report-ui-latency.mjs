#!/usr/bin/env node
import { readFile, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { defaultLatencyLogPath } from "../src/latency-store.mjs";

const ENTRY_KINDS = ["origins", "stages", "visuals"];
const REQUEST_METRICS = [
  "interactionToDispatch",
  "dispatchToInitialResponse",
  "dispatchToSwap",
  "dispatchToSettle",
  "interactionToFirstPresentation",
  "dispatchToFirstPresentation",
];

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function percentile(sorted, portion) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * portion;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const value = lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  return rounded(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metric(values) {
  const sorted = values.filter((value) => finite(value) !== null).sort((left, right) => left - right);
  return {
    samples: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
  };
}

function addMetricColumns(row, name, values) {
  const summary = metric(values);
  row[`${name}Samples`] = summary.samples;
  row[`${name}P50Ms`] = summary.p50Ms;
  row[`${name}P95Ms`] = summary.p95Ms;
}

function counterObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const kind of ENTRY_KINDS) {
    if (!Number.isSafeInteger(value[kind]) || value[kind] < 0) return null;
    result[kind] = value[kind];
  }
  return result;
}

function cumulativeHealth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const generated = counterObject(value.generated);
  const acknowledged = counterObject(value.acknowledged);
  const ringBufferDrops = counterObject(value.ringBufferDrops);
  const uploadDrops = counterObject(value.uploadDrops);
  if (!generated || !acknowledged || !ringBufferDrops || !uploadDrops
    || !Number.isSafeInteger(value.quarantineCount) || value.quarantineCount < 0) return null;
  return { generated, acknowledged, ringBufferDrops, uploadDrops, quarantineCount: value.quarantineCount };
}

function ordered(left, right) {
  const leftAt = finite(left.entry.at);
  const rightAt = finite(right.entry.at);
  if (leftAt !== null && rightAt !== null && leftAt !== rightAt) return leftAt - rightAt;
  if (leftAt !== null && rightAt === null) return -1;
  if (leftAt === null && rightAt !== null) return 1;
  return left.entry.sequence - right.entry.sequence;
}

function requestTimingRows(stages, visuals) {
  const requests = new Map();
  const ensure = (runId, requestId) => {
    const key = JSON.stringify([runId, requestId]);
    let request = requests.get(key);
    if (!request) {
      request = { runId, requestId, action: "(unknown request)", stages: [], visuals: [] };
      requests.set(key, request);
    }
    return request;
  };

  for (const sample of stages) {
    if (typeof sample.entry.requestId !== "string" || !sample.entry.requestId) continue;
    const request = ensure(sample.runId, sample.entry.requestId);
    if (typeof sample.entry.action === "string" && sample.entry.action) request.action = sample.entry.action;
    request.stages.push(sample);
  }
  for (const sample of visuals) {
    if (typeof sample.entry.activeRequestId !== "string" || !sample.entry.activeRequestId) continue;
    ensure(sample.runId, sample.entry.activeRequestId).visuals.push(sample);
  }

  const groups = new Map();
  let firstPresentationSamples = 0;
  for (const request of requests.values()) {
    request.stages.sort(ordered);
    request.visuals.sort(ordered);
    const firstStage = (kind) => request.stages.find(({ entry }) => entry.kind === kind)?.entry;
    const dispatch = firstStage("network-dispatch");
    const initialResponse = firstStage("response-before-swap");
    const swap = firstStage("response-after-swap");
    const settle = firstStage("response-after-settle");
    // Exactly one pre-admission visual contributes for request feedback.
    // prompt-admitted explicitly primes a later request-correlated visual, but
    // that sample belongs exclusively to the admission report below.
    const admissionAt = finite(firstStage("prompt-admitted")?.at);
    const firstPresentation = request.visuals.find(({ entry }) => {
      const at = finite(entry.at);
      return admissionAt === null || (at !== null && at < admissionAt);
    })?.entry ?? null;
    if (firstPresentation) firstPresentationSamples += 1;

    let group = groups.get(request.action);
    if (!group) {
      group = {
        action: request.action,
        requests: 0,
        firstPresentationSamples: 0,
        values: Object.fromEntries(REQUEST_METRICS.map((name) => [name, []])),
      };
      groups.set(request.action, group);
    }
    group.requests += 1;
    if (firstPresentation) group.firstPresentationSamples += 1;
    const candidates = {
      interactionToDispatch: finite(dispatch?.originLatencyMs),
      dispatchToInitialResponse: finite(initialResponse?.dispatchLatencyMs),
      dispatchToSwap: finite(swap?.dispatchLatencyMs),
      dispatchToSettle: finite(settle?.dispatchLatencyMs),
      interactionToFirstPresentation: finite(firstPresentation?.activeRequestLatencyMs),
      dispatchToFirstPresentation: finite(firstPresentation?.networkDispatchLatencyMs),
    };
    for (const name of REQUEST_METRICS) {
      if (candidates[name] !== null) group.values[name].push(candidates[name]);
    }
  }

  const rows = [...groups.values()].map((group) => {
    const row = {
      action: group.action,
      requests: group.requests,
      firstPresentationSamples: group.firstPresentationSamples,
    };
    for (const name of REQUEST_METRICS) addMetricColumns(row, name, group.values[name]);
    return row;
  }).sort((left, right) => left.action.localeCompare(right.action));
  return { rows, firstPresentationSamples };
}

const STARTUP_METRICS = [
  "navigationToCollector", "navigationDuration", "redirectDuration", "workerStartup", "dns", "connect",
  "secureConnect", "fetchToRequest", "navigationToFirstPaint", "navigationToFirstContentfulPaint",
  "navigationToFirstVisual", "requestToResponseStart", "responseDownload", "responseEndToCollector",
  "collectorToFirstVisual", "navigationToSseOpen", "collectorToSseOpen", "navigationToSwitchMeta",
  "navigationToInitialTranscript", "navigationToInitialLive", "navigationToSwitchReady",
  "collectorToSwitchReady", "intentToNavigation", "intentToCollector", "intentToFirstPaint",
  "intentToFirstContentfulPaint", "intentToFirstVisual", "intentToSwitchReady",
];
const NAVIGATION_TYPES = new Set(["navigate", "reload", "back_forward", "prerender"]);
const NAVIGATION_FIELDS = [
  "startTime", "redirectStart", "redirectEnd", "workerStart", "fetchStart", "domainLookupStart",
  "domainLookupEnd", "connectStart", "secureConnectionStart", "connectEnd", "requestStart", "responseStart",
  "responseEnd", "domInteractive", "domContentLoadedEventStart", "domContentLoadedEventEnd", "domComplete",
  "loadEventStart", "loadEventEnd", "duration", "serverViewDuration", "serverRenderDuration",
];
const ZERO_IS_INCOMPLETE_NAVIGATION_FIELDS = new Set(NAVIGATION_FIELDS.filter((field) =>
  !["startTime", "fetchStart", "serverViewDuration", "serverRenderDuration"].includes(field)));

function nonnegative(value) {
  const result = finite(value);
  return result !== null && result >= 0 ? result : null;
}

function elapsed(end, start) {
  const safeEnd = nonnegative(end);
  const safeStart = nonnegative(start);
  return safeEnd !== null && safeStart !== null && safeEnd >= safeStart ? rounded(safeEnd - safeStart) : null;
}

function detailedMetric(values) {
  const result = metric(values);
  const safe = values.map(nonnegative).filter((value) => value !== null);
  return { ...result, maxMs: safe.length ? rounded(Math.max(...safe)) : null };
}

function mergeEarliest(current, value) {
  const safe = nonnegative(value);
  return safe === null ? current : current === null ? safe : Math.min(current, safe);
}

function mergePageMetadata(pages, runId, candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
  let page = pages.get(runId);
  if (!page) {
    page = {
      startedAt: null,
      firstPaint: null,
      firstContentfulPaint: null,
      navigation: null,
      navigationIntent: null,
    };
    pages.set(runId, page);
  }
  page.startedAt = mergeEarliest(page.startedAt, candidate.startedAt);
  page.firstPaint = mergeEarliest(page.firstPaint, candidate.firstPaint);
  page.firstContentfulPaint = mergeEarliest(page.firstContentfulPaint, candidate.firstContentfulPaint);
  const navigation = candidate.navigation;
  if (navigation && typeof navigation === "object" && NAVIGATION_TYPES.has(navigation.type)) {
    if (!page.navigation) page.navigation = { type: navigation.type };
    if (page.navigation.type === navigation.type) {
      for (const field of NAVIGATION_FIELDS) {
        const value = ZERO_IS_INCOMPLETE_NAVIGATION_FIELDS.has(field) && navigation[field] === 0
          ? null : navigation[field];
        page.navigation[field] = mergeEarliest(page.navigation[field] ?? null, value);
      }
      for (const field of ["transferSize", "encodedBodySize", "decodedBodySize"]) {
        const value = nonnegative(navigation[field]);
        if (value !== null && Number.isSafeInteger(value)) {
          page.navigation[field] = Math.max(page.navigation[field] ?? 0, value);
        }
      }
    }
  }
  const intent = candidate.navigationIntent;
  if (intent && typeof intent === "object" && typeof intent.id === "string"
    && typeof intent.sourceRunId === "string" && typeof intent.action === "string") {
    const at = nonnegative(intent.at);
    const toNavigation = nonnegative(intent.intentToNavigationMs);
    const toCollector = nonnegative(intent.intentToCollectorMs);
    if (at !== null && toNavigation !== null && toCollector !== null && toCollector >= toNavigation
      && (!page.navigationIntent || at < page.navigationIntent.at)) {
      page.navigationIntent = { ...intent, at, intentToNavigationMs: toNavigation, intentToCollectorMs: toCollector };
    }
  }
}

function fixedStageChannel(entry) {
  if (typeof entry.channel === "string" && entry.channel) return entry.channel;
  const target = typeof entry.target === "string" ? entry.target : "";
  if (/(?:^|#)switch-meta(?:\.|$)/.test(target)) return "switch-meta";
  if (/(?:^|#)switch-ready(?:\.|$)/.test(target)) return "switch-ready";
  if (/(?:^|#)transcript-live-nodes(?:\.|$)/.test(target)) return "live";
  if (/(?:^|#)(?:transcript-settled|transcript-anchor)(?:\.|$)/.test(target)) return "transcript";
  return null;
}

function firstStageAt(stages, predicate) {
  let result = null;
  for (const sample of stages) {
    if (!predicate(sample.entry)) continue;
    result = mergeEarliest(result, sample.entry.at);
  }
  return result;
}

function startupTimingRows(runIds, pages, stages, firstVisualByRun) {
  const byRun = new Map();
  for (const sample of stages) {
    const list = byRun.get(sample.runId) ?? [];
    list.push(sample);
    byRun.set(sample.runId, list);
  }
  const values = Object.fromEntries(STARTUP_METRICS.map((name) => [name, []]));
  const actionGroups = new Map();
  const rows = [];
  for (const runId of runIds) {
    const page = pages.get(runId) ?? {
      startedAt: null, firstPaint: null, firstContentfulPaint: null, navigation: null, navigationIntent: null,
    };
    const runStages = byRun.get(runId) ?? [];
    const withoutSwitch = runStages.filter(({ entry }) => !entry.sessionSwitchId && entry.kind !== "session-switch-start");
    const firstVisual = firstVisualByRun.get(runId) ?? null;
    const navigation = page.navigation;
    const requestStart = nonnegative(navigation?.requestStart);
    const responseStart = nonnegative(navigation?.responseStart);
    const responseEnd = nonnegative(navigation?.responseEnd);
    const sseOpen = firstStageAt(withoutSwitch, (entry) => entry.kind === "sse-open");
    const switchMeta = firstStageAt(withoutSwitch, (entry) => fixedStageChannel(entry) === "switch-meta");
    const initialTranscript = firstStageAt(withoutSwitch,
      (entry) => fixedStageChannel(entry) === "transcript" || fixedStageChannel(entry) === "transcript-reset");
    const initialLive = firstStageAt(withoutSwitch, (entry) => fixedStageChannel(entry) === "live");
    const switchReady = firstStageAt(withoutSwitch, (entry) => fixedStageChannel(entry) === "switch-ready");
    const intentToNavigation = page.navigationIntent?.intentToNavigationMs ?? null;
    const candidates = {
      navigationToCollector: page.startedAt,
      navigationDuration: nonnegative(navigation?.duration),
      redirectDuration: elapsed(navigation?.redirectEnd, navigation?.redirectStart),
      workerStartup: elapsed(navigation?.fetchStart, navigation?.workerStart),
      dns: elapsed(navigation?.domainLookupEnd, navigation?.domainLookupStart),
      connect: elapsed(navigation?.connectEnd, navigation?.connectStart),
      secureConnect: elapsed(navigation?.connectEnd, navigation?.secureConnectionStart),
      fetchToRequest: elapsed(navigation?.requestStart, navigation?.fetchStart),
      navigationToFirstPaint: page.firstPaint,
      navigationToFirstContentfulPaint: page.firstContentfulPaint,
      navigationToFirstVisual: firstVisual,
      requestToResponseStart: elapsed(responseStart, requestStart),
      responseDownload: elapsed(responseEnd, responseStart),
      responseEndToCollector: elapsed(page.startedAt, responseEnd),
      collectorToFirstVisual: elapsed(firstVisual, page.startedAt),
      navigationToSseOpen: sseOpen,
      collectorToSseOpen: elapsed(sseOpen, page.startedAt),
      navigationToSwitchMeta: switchMeta,
      navigationToInitialTranscript: initialTranscript,
      navigationToInitialLive: initialLive,
      navigationToSwitchReady: switchReady,
      collectorToSwitchReady: elapsed(switchReady, page.startedAt),
      intentToNavigation,
      intentToCollector: page.navigationIntent?.intentToCollectorMs ?? null,
      intentToFirstPaint: intentToNavigation === null || page.firstPaint === null
        ? null : rounded(intentToNavigation + page.firstPaint),
      intentToFirstContentfulPaint: intentToNavigation === null || page.firstContentfulPaint === null
        ? null : rounded(intentToNavigation + page.firstContentfulPaint),
      intentToFirstVisual: intentToNavigation === null || firstVisual === null
        ? null : rounded(intentToNavigation + firstVisual),
      intentToSwitchReady: intentToNavigation === null || switchReady === null
        ? null : rounded(intentToNavigation + switchReady),
    };
    const action = page.navigationIntent?.action
      ?? (navigation ? "(unattributed navigation)" : "(old/unattributed startup)");
    const slow = Object.values(candidates).some((value) => value !== null && value >= 2_000);
    const row = {
      runId,
      action,
      start: slow ? "SLOW" : "ok",
      navigationType: navigation?.type ?? "(old/no navigation timing)",
      ...Object.fromEntries(Object.entries(candidates).map(([name, value]) => [`${name}Ms`, value])),
      domInteractiveMs: nonnegative(navigation?.domInteractive),
      domContentLoadedMs: nonnegative(navigation?.domContentLoadedEventEnd),
      domCompleteMs: nonnegative(navigation?.domComplete),
      loadEventEndMs: nonnegative(navigation?.loadEventEnd),
      serverViewMs: nonnegative(navigation?.serverViewDuration),
      serverRenderMs: nonnegative(navigation?.serverRenderDuration),
      transferBytes: nonnegative(navigation?.transferSize),
    };
    let actionGroup = actionGroups.get(action);
    if (!actionGroup) {
      actionGroup = {
        action, runs: 0, slowRuns: 0,
        values: Object.fromEntries(STARTUP_METRICS.map((name) => [name, []])),
      };
      actionGroups.set(action, actionGroup);
    }
    actionGroup.runs += 1;
    if (slow) actionGroup.slowRuns += 1;
    for (const name of STARTUP_METRICS) {
      const value = candidates[name];
      if (value === null) continue;
      values[name].push(value);
      actionGroup.values[name].push(value);
    }
    rows.push(row);
  }
  rows.sort((left, right) => (right.navigationToCollectorMs ?? -1) - (left.navigationToCollectorMs ?? -1)
    || left.runId.localeCompare(right.runId));
  return {
    rows,
    summary: Object.fromEntries(STARTUP_METRICS.map((name) => [name, detailedMetric(values[name])])),
    byAction: [...actionGroups.values()].map((group) => ({
      action: group.action,
      runs: group.runs,
      slowRuns: group.slowRuns,
      metrics: Object.fromEntries(STARTUP_METRICS.map((name) => [name, detailedMetric(group.values[name])])),
    })).sort((left, right) => left.action.localeCompare(right.action)),
  };
}

const ADMISSION_METRICS = [
  "interactionToAdmission", "dispatchToAdmission", "responseToAdmission", "completeToAdmission",
  "interactionToAdmissionPresentation", "dispatchToAdmissionPresentation",
  "responseToAdmissionPresentation", "completeToAdmissionPresentation", "admissionToPresentation",
];

function admissionTimingRows(stages, visuals) {
  const requests = new Map();
  let unmatchedNodes = 0;
  const ensure = (runId, requestId) => {
    const key = JSON.stringify([runId, requestId]);
    let request = requests.get(key);
    if (!request) {
      request = {
        runId, requestId, action: "(unknown prompt)", response: null, complete: null,
        pending: null, admitted: null, failed: null, visuals: [],
      };
      requests.set(key, request);
    }
    return request;
  };
  for (const sample of stages) {
    const { entry } = sample;
    if (entry.kind === "prompt-admission-unmatched" && !entry.requestId) {
      unmatchedNodes += 1;
      continue;
    }
    if (typeof entry.requestId !== "string" || !entry.requestId) continue;
    if (["response-before-swap", "request-complete"].includes(entry.kind)) {
      const request = ensure(sample.runId, entry.requestId);
      if (typeof entry.action === "string" && entry.action) request.action = entry.action;
      const field = entry.kind === "response-before-swap" ? "response" : "complete";
      if (!request[field] || ordered(sample, request[field]) < 0) request[field] = sample;
      continue;
    }
    if (!["prompt-admission-pending", "prompt-admitted", "prompt-admission-failed"].includes(entry.kind)) continue;
    const request = ensure(sample.runId, entry.requestId);
    if (typeof entry.action === "string" && entry.action) request.action = entry.action;
    const field = entry.kind === "prompt-admission-pending" ? "pending"
      : entry.kind === "prompt-admitted" ? "admitted" : "failed";
    if (!request[field] || ordered(sample, request[field]) < 0) request[field] = sample;
  }
  for (const sample of visuals) {
    const requestId = sample.entry.activeRequestId;
    if (typeof requestId !== "string" || !requestId) continue;
    const request = requests.get(JSON.stringify([sample.runId, requestId]));
    if (request) request.visuals.push(sample);
  }
  const groups = new Map();
  const totalValues = Object.fromEntries(ADMISSION_METRICS.map((name) => [name, []]));
  const counts = { admitted: 0, unmatched: 0, failed: 0, presentations: 0, unmatchedNodes };
  for (const request of requests.values()) {
    const successful = Boolean(request.pending || request.admitted);
    const admitted = request.admitted?.entry ?? null;
    const failed = Boolean(request.failed);
    const unmatched = successful && !admitted && !failed;
    if (admitted) counts.admitted += 1;
    else if (failed) counts.failed += 1;
    else if (unmatched) counts.unmatched += 1;
    else continue;
    request.visuals.sort(ordered);
    const admissionAt = nonnegative(admitted?.at);
    const presentation = admissionAt === null ? null
      : request.visuals.find(({ entry }) => nonnegative(entry.at) !== null && entry.at >= admissionAt)?.entry ?? null;
    if (presentation) counts.presentations += 1;
    let group = groups.get(request.action);
    if (!group) {
      group = {
        action: request.action, submitted: 0, admitted: 0, unmatched: 0, failed: 0, presentations: 0,
        values: Object.fromEntries(ADMISSION_METRICS.map((name) => [name, []])),
      };
      groups.set(request.action, group);
    }
    group.submitted += 1;
    if (admitted) group.admitted += 1;
    if (unmatched) group.unmatched += 1;
    if (failed) group.failed += 1;
    if (presentation) group.presentations += 1;
    const responseAt = nonnegative(request.response?.entry.at);
    const completeAt = nonnegative(request.complete?.entry.at) ?? nonnegative(request.pending?.entry.at);
    const candidates = {
      interactionToAdmission: nonnegative(admitted?.originLatencyMs),
      dispatchToAdmission: nonnegative(admitted?.dispatchLatencyMs),
      responseToAdmission: elapsed(admitted?.at, responseAt),
      completeToAdmission: nonnegative(admitted?.requestCompleteLatencyMs) ?? elapsed(admitted?.at, completeAt),
      interactionToAdmissionPresentation: nonnegative(presentation?.activeRequestLatencyMs),
      dispatchToAdmissionPresentation: nonnegative(presentation?.networkDispatchLatencyMs),
      responseToAdmissionPresentation: elapsed(presentation?.at, responseAt),
      completeToAdmissionPresentation: elapsed(presentation?.at, completeAt),
      admissionToPresentation: elapsed(presentation?.at, admitted?.at),
    };
    for (const name of ADMISSION_METRICS) {
      if (candidates[name] === null) continue;
      group.values[name].push(candidates[name]);
      totalValues[name].push(candidates[name]);
    }
  }
  const rows = [...groups.values()].map((group) => {
    const row = {
      action: group.action,
      submitted: group.submitted,
      admitted: group.admitted,
      unmatched: group.unmatched,
      failed: group.failed,
      admissionPresentations: group.presentations,
    };
    for (const name of ADMISSION_METRICS) addMetricColumns(row, name, group.values[name]);
    return row;
  }).sort((left, right) => left.action.localeCompare(right.action));
  return {
    rows,
    counts,
    summary: {
      ...counts,
      metrics: Object.fromEntries(ADMISSION_METRICS.map((name) => [name, detailedMetric(totalValues[name])])),
    },
  };
}

const SWITCH_METRICS = [
  "switchToResponse", "switchToSseOpen", "switchToMeta", "switchToInitialTranscript", "switchToInitialLive", "switchToReady",
  "switchToFirstPresentation", "readyToFirstPresentation", "interactionToReady", "interactionToFirstPresentation",
];

function sessionSwitchTimingRows(stages, visuals) {
  const switches = new Map();
  for (const sample of stages) {
    const id = sample.entry.sessionSwitchId;
    if (typeof id !== "string" || !id) continue;
    const key = JSON.stringify([sample.runId, id]);
    let state = switches.get(key);
    if (!state) {
      state = { runId: sample.runId, switchId: id, stages: [], visuals: [] };
      switches.set(key, state);
    }
    state.stages.push(sample);
  }
  for (const sample of visuals) {
    const id = sample.entry.sessionSwitchId;
    if (typeof id !== "string" || !id) continue;
    const state = switches.get(JSON.stringify([sample.runId, id]));
    if (state) state.visuals.push(sample);
  }
  const values = Object.fromEntries(SWITCH_METRICS.map((name) => [name, []]));
  const rows = [];
  let complete = 0;
  let incomplete = 0;
  let readyWithoutPresentation = 0;
  let unmatchedStarts = 0;
  for (const state of switches.values()) {
    state.stages.sort(ordered);
    const start = state.stages.find(({ entry }) => entry.kind === "session-switch-start")?.entry ?? null;
    if (!start) unmatchedStarts += 1;
    const at = (predicate) => firstStageAt(state.stages, predicate);
    const response = at((entry) => entry.kind === "session-switch-response");
    const sseOpen = at((entry) => entry.kind === "sse-open");
    const meta = at((entry) => fixedStageChannel(entry) === "switch-meta");
    const transcript = at((entry) => ["transcript", "transcript-reset"].includes(fixedStageChannel(entry)));
    const live = at((entry) => fixedStageChannel(entry) === "live");
    const ready = at((entry) => entry.kind === "session-switch-ready" || fixedStageChannel(entry) === "switch-ready");
    state.visuals.sort(ordered);
    const presentation = ready === null ? null
      : state.visuals.find(({ entry }) => nonnegative(entry.at) !== null && entry.at >= ready)?.entry ?? null;
    const presentationAt = nonnegative(presentation?.at);
    const candidates = {
      switchToResponse: elapsed(response, start?.at),
      switchToSseOpen: elapsed(sseOpen, start?.at),
      switchToMeta: elapsed(meta, start?.at),
      switchToInitialTranscript: elapsed(transcript, start?.at),
      switchToInitialLive: elapsed(live, start?.at),
      switchToReady: elapsed(ready, start?.at),
      switchToFirstPresentation: elapsed(presentationAt, start?.at),
      readyToFirstPresentation: elapsed(presentationAt, ready),
      interactionToReady: nonnegative(start?.originLatencyMs) === null || ready === null ? null
        : rounded(start.originLatencyMs + (ready - start.at)),
      interactionToFirstPresentation: nonnegative(start?.originLatencyMs) === null || presentationAt === null ? null
        : rounded(start.originLatencyMs + (presentationAt - start.at)),
    };
    if (!start || ready === null || presentationAt === null) {
      incomplete += 1;
      if (start && ready !== null && presentationAt === null) readyWithoutPresentation += 1;
    } else complete += 1;
    for (const name of SWITCH_METRICS) if (candidates[name] !== null) values[name].push(candidates[name]);
    rows.push({
      runId: state.runId,
      switchId: state.switchId,
      action: typeof start?.action === "string" && start.action
        ? start.action
        : state.stages.find(({ entry }) => typeof entry.action === "string" && entry.action)?.entry.action
          || "(unknown session switch)",
      status: !start ? "UNMATCHED_START"
        : ready === null ? "INCOMPLETE_READY"
          : presentationAt === null ? "INCOMPLETE_PRESENTATION"
          : candidates.switchToFirstPresentation >= 2_000 ? "SLOW" : "complete",
      ...Object.fromEntries(Object.entries(candidates).map(([name, value]) => [`${name}Ms`, value])),
    });
  }
  rows.sort((left, right) => (right.switchToReadyMs ?? -1) - (left.switchToReadyMs ?? -1)
    || left.runId.localeCompare(right.runId) || left.switchId.localeCompare(right.switchId));
  return {
    rows,
    summary: {
      complete,
      incomplete,
      readyWithoutPresentation,
      unmatchedStarts,
      metrics: Object.fromEntries(SWITCH_METRICS.map((name) => [name, detailedMetric(values[name])])),
    },
  };
}

const SSE_CORRELATION_WINDOW_MS = 5_000;

function stageTarget(entry) {
  return typeof entry.target === "string" && entry.target ? entry.target : null;
}

function comparableStageTarget(entry) {
  return stageTarget(entry)?.replace(/\.htmx-(?:added|settling|swapping)(?=\.|$)/g, "") ?? null;
}

function compatibleStageTarget(pending, entry) {
  const target = comparableStageTarget(entry);
  // Missing target labels occur in old logs. Ignore HTMX's transient classes,
  // which can still be present on the closing SSE event, but reject a genuinely
  // different SSE source when both stable labels are available.
  return pending.correlationTarget === null || target === null || target === pending.correlationTarget;
}

function sseTimingRows(stages) {
  const byRun = new Map();
  for (const sample of stages) {
    const entries = byRun.get(sample.runId) ?? [];
    entries.push(sample);
    byRun.set(sample.runId, entries);
  }
  const groups = new Map();
  for (const entries of byRun.values()) {
    entries.sort(ordered);
    let pending = null;
    for (const { entry } of entries) {
      const at = finite(entry.at);
      if (pending) {
        const sequenceGap = entry.sequence - pending.lastSequence !== 1;
        const invalidTime = at === null || pending.at === null || at < pending.at;
        const expired = !invalidTime && at - pending.at > SSE_CORRELATION_WINDOW_MS;
        // Check every later entry before it can consume pending state. A gap
        // could hide a newer before/after event, so old partial logs are not
        // safe to correlate across it even when their timestamps are close.
        if (sequenceGap || invalidTime || expired) pending = null;
      }
      if (entry.kind === "sse-message-before") {
        const target = stageTarget(entry);
        // A newer before always supersedes an older incomplete message.
        pending = {
          at,
          lastSequence: entry.sequence,
          correlationTarget: comparableStageTarget(entry),
          target: target ?? "(unknown target)",
          action: typeof entry.action === "string" && entry.action ? entry.action : "(no request action)",
          swapMs: null,
        };
        continue;
      }
      if (!pending) continue;
      pending.lastSequence = entry.sequence;
      if (entry.kind === "response-after-swap") {
        // SSE extension swaps have no XHR request identity. Their afterSwap
        // target is the replaced response region, while the surrounding SSE
        // events are recorded on the in-flight request source, so those target
        // labels are intentionally not compared. Request identity still keeps
        // an interleaved prompt/XHR swap from becoming SSE evidence.
        const requestFree = entry.requestId === null || entry.requestId === undefined;
        if (pending.swapMs === null && requestFree) pending.swapMs = at - pending.at;
        continue;
      }
      if (entry.kind !== "sse-message-after" || !compatibleStageTarget(pending, entry)) continue;
      const key = JSON.stringify([pending.target, pending.action]);
      let group = groups.get(key);
      if (!group) {
        group = { target: pending.target, action: pending.action, messages: 0, handlers: [], swaps: [] };
        groups.set(key, group);
      }
      group.messages += 1;
      group.handlers.push(at - pending.at);
      if (pending.swapMs !== null) group.swaps.push(pending.swapMs);
      pending = null;
    }
  }
  return [...groups.values()].map((group) => {
    const row = { target: group.target, action: group.action, messages: group.messages };
    addMetricColumns(row, "handler", group.handlers);
    addMetricColumns(row, "swap", group.swaps);
    return row;
  }).sort((left, right) => left.target.localeCompare(right.target) || left.action.localeCompare(right.action));
}

export function analyzeLatencyRecords(records) {
  const runs = new Set();
  const batches = new Set();
  const entries = { origins: 0, stages: 0, visuals: 0 };
  const duplicateEntries = { origins: 0, stages: 0, visuals: 0 };
  const seen = new Set();
  const samples = { stages: [], visuals: [] };
  const pages = new Map();
  const firstVisualByRun = new Map();
  const sequencesByRun = new Map();
  const latestHealth = new Map();

  for (const record of records) {
    if (!record || typeof record !== "object" || typeof record.runId !== "string") continue;
    runs.add(record.runId);
    if (typeof record.batchId === "string") batches.add(JSON.stringify([record.runId, record.batchId]));
    const health = cumulativeHealth(record.health);
    if (health) latestHealth.set(record.runId, health);
    mergePageMetadata(pages, record.runId, record.page);
    let runSequences = sequencesByRun.get(record.runId);
    if (!runSequences) {
      runSequences = Object.fromEntries(ENTRY_KINDS.map((kind) => [kind, new Set()]));
      sequencesByRun.set(record.runId, runSequences);
    }
    for (const kind of ENTRY_KINDS) {
      if (!Array.isArray(record[kind])) continue;
      for (const entry of record[kind]) {
        if (!Number.isSafeInteger(entry?.sequence) || entry.sequence < 1) continue;
        const key = JSON.stringify([record.runId, kind, entry.sequence]);
        if (seen.has(key)) {
          duplicateEntries[kind] += 1;
          continue;
        }
        seen.add(key);
        runSequences[kind].add(entry.sequence);
        entries[kind] += 1;
        if (kind === "stages") samples.stages.push({ runId: record.runId, entry });
        if (kind === "visuals") {
          samples.visuals.push({ runId: record.runId, entry });
          firstVisualByRun.set(record.runId, mergeEarliest(firstVisualByRun.get(record.runId) ?? null, entry.at));
        }
      }
    }
  }

  const sequenceGaps = { origins: 0, stages: 0, visuals: 0 };
  const generated = { origins: 0, stages: 0, visuals: 0 };
  const runHealth = [];
  for (const runId of runs) {
    const health = latestHealth.get(runId) ?? null;
    const retained = {};
    const runGenerated = {};
    const gaps = {};
    const retention = {};
    const runSequences = sequencesByRun.get(runId)
      ?? Object.fromEntries(ENTRY_KINDS.map((kind) => [kind, new Set()]));
    for (const kind of ENTRY_KINDS) {
      retained[kind] = runSequences[kind].size;
      const orderedSequences = [...runSequences[kind]].sort((left, right) => left - right);
      const observedMaximum = orderedSequences.at(-1) ?? 0;
      runGenerated[kind] = Math.max(observedMaximum, health?.generated[kind] ?? 0);
      gaps[kind] = orderedSequences.reduce((total, sequence, index) => index === 0
        ? 0
        : total + Math.max(0, sequence - orderedSequences[index - 1] - 1), 0);
      retention[kind] = runGenerated[kind] === 0 ? null : rounded((retained[kind] / runGenerated[kind]) * 100);
      generated[kind] += runGenerated[kind];
      sequenceGaps[kind] += gaps[kind];
    }
    runHealth.push({ runId, health, retained, generated: runGenerated, sequenceGaps: gaps, retentionPercent: retention });
  }
  runHealth.sort((left, right) => left.runId.localeCompare(right.runId));

  const retention = Object.fromEntries(ENTRY_KINDS.map((kind) => [kind, {
    retained: entries[kind],
    generated: generated[kind],
    percent: generated[kind] === 0 ? null : rounded((entries[kind] / generated[kind]) * 100),
  }]));
  const requestReport = requestTimingRows(samples.stages, samples.visuals);
  const admissionReport = admissionTimingRows(samples.stages, samples.visuals);
  const startupReport = startupTimingRows(runs, pages, samples.stages, firstVisualByRun);
  const switchReport = sessionSwitchTimingRows(samples.stages, samples.visuals);
  const sseRows = sseTimingRows(samples.stages);
  const sampleCounts = {
    firstPresentations: requestReport.firstPresentationSamples,
    ...Object.fromEntries(REQUEST_METRICS.map((name) => [name,
      requestReport.rows.reduce((total, row) => total + row[`${name}Samples`], 0)])),
    sseHandlers: sseRows.reduce((total, row) => total + row.handlerSamples, 0),
    sseSwaps: sseRows.reduce((total, row) => total + row.swapSamples, 0),
  };

  return {
    runs: runs.size,
    batches: batches.size,
    entries,
    duplicateEntries,
    duplicates: duplicateEntries.origins + duplicateEntries.stages + duplicateEntries.visuals,
    // Compatibility name now counts first correlated presentations, not every
    // progressive visual carrying the same old request identifier.
    latencySamples: requestReport.firstPresentationSamples,
    composerFeedbackSamples: requestReport.firstPresentationSamples,
    sampleCounts,
    sequenceGaps,
    retention,
    runHealth,
    rows: requestReport.rows,
    requestRows: requestReport.rows,
    feedbackRows: requestReport.rows,
    startupRows: startupReport.rows,
    startupSummary: startupReport.summary,
    startupByAction: startupReport.byAction,
    sessionSwitchRows: switchReport.rows,
    sessionSwitchSummary: switchReport.summary,
    admissionRows: admissionReport.rows,
    admissionCounts: admissionReport.counts,
    admissionSummary: admissionReport.summary,
    sseRows,
  };
}

export async function readLatencyLogs(path = defaultLatencyLogPath()) {
  const records = [];
  let malformedLines = 0;
  for (const candidate of [`${path}.1`, path]) {
    let body;
    try { body = await readFile(candidate, "utf8"); } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { malformedLines += 1; }
    }
  }
  return { records, malformedLines };
}

export async function reportLatency(path = defaultLatencyLogPath()) {
  const { records, malformedLines } = await readLatencyLogs(path);
  return { path, malformedLines, ...analyzeLatencyRecords(records) };
}

async function removeIfPresent(path) {
  try { await unlink(path); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function threeKinds(value, fallback = "n/a") {
  return ENTRY_KINDS.map((kind) => value?.[kind] ?? fallback).join("/");
}

function compactHealth(row) {
  return {
    run: row.runId,
    retentionPctOSV: threeKinds(row.retentionPercent),
    gapsOSV: threeKinds(row.sequenceGaps, 0),
    generatedOSV: threeKinds(row.generated, 0),
    acknowledgedOSV: threeKinds(row.health?.acknowledged),
    ringDropsOSV: threeKinds(row.health?.ringBufferDrops),
    uploadDropsOSV: threeKinds(row.health?.uploadDrops),
    quarantines: row.health?.quarantineCount ?? "n/a",
  };
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const clear = args.includes("--clear");
  const path = args.find((arg) => !arg.startsWith("--")) ?? defaultLatencyLogPath();
  if (clear) {
    await removeIfPresent(path);
    await removeIfPresent(`${path}.1`);
    console.log(`Cleared ${path} and ${path}.1`);
    return;
  }
  const report = await reportLatency(path);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`qq UI latency: ${report.path}`);
  console.log(`runs=${report.runs} batches=${report.batches} origins=${report.entries.origins} stages=${report.entries.stages} visuals=${report.entries.visuals} composer_feedback_presentations=${report.composerFeedbackSamples} duplicates=${report.duplicates} malformed_lines=${report.malformedLines}`);
  console.log(`sequence_gaps origins=${report.sequenceGaps.origins} stages=${report.sequenceGaps.stages} visuals=${report.sequenceGaps.visuals}; retention origins=${report.retention.origins.percent ?? "n/a"}% stages=${report.retention.stages.percent ?? "n/a"}% visuals=${report.retention.visuals.percent ?? "n/a"}%`);
  console.log(`samples interaction_to_dispatch=${report.sampleCounts.interactionToDispatch} dispatch_to_initial_response=${report.sampleCounts.dispatchToInitialResponse} dispatch_to_swap=${report.sampleCounts.dispatchToSwap} dispatch_to_settle=${report.sampleCounts.dispatchToSettle} composer_feedback_presentations=${report.sampleCounts.dispatchToFirstPresentation} sse_handler=${report.sampleCounts.sseHandlers} sse_swap=${report.sampleCounts.sseSwaps}`);
  console.log("Startup/session-open timing (milliseconds from navigation unless named otherwise; SLOW is >=2s; TTFB is request -> responseStart server/core):");
  if (report.startupRows.length) console.table(report.startupRows);
  else console.log("No collector runs retained.");
  console.log("Startup aggregate timing:");
  console.table(Object.entries(report.startupSummary).map(([phase, value]) => ({ phase, ...value })));
  console.log("Startup/session-open timing grouped by normalized action:");
  console.table(report.startupByAction.flatMap((group) => Object.entries(group.metrics)
    .filter(([, value]) => value.samples > 0)
    .map(([phase, value]) => ({ action: group.action, runs: group.runs, slowRuns: group.slowRuns, phase, ...value }))));
  console.log(`Session live switches: complete=${report.sessionSwitchSummary.complete} incomplete=${report.sessionSwitchSummary.incomplete} ready_without_presentation=${report.sessionSwitchSummary.readyWithoutPresentation} unmatched_starts=${report.sessionSwitchSummary.unmatchedStarts}`);
  if (report.sessionSwitchRows.length) console.table(report.sessionSwitchRows);
  else console.log("No local live-switch starts retained (initial document opens remain in startup timing above).");
  console.log("Session live-switch aggregate timing:");
  console.table(Object.entries(report.sessionSwitchSummary.metrics).map(([phase, value]) => ({ phase, ...value })));
  console.log(`Prompt admission (exact new user-node evidence): admitted=${report.admissionCounts.admitted} unmatched=${report.admissionCounts.unmatched} failed=${report.admissionCounts.failed} presentations=${report.admissionCounts.presentations} external_unmatched_nodes=${report.admissionCounts.unmatchedNodes}`);
  if (report.admissionRows.length) console.table(report.admissionRows);
  else console.log("No prompt-admission evidence retained; old logs remain readable.");
  console.log("Prompt-admission aggregate timing:");
  console.table(Object.entries(report.admissionSummary.metrics).map(([phase, value]) => ({ phase, ...value })));
  console.log("Collector health (O/S/V = origins/stages/visuals; latest cumulative metadata per run; n/a means an old log line):");
  // Keep this label above the table rather than encoding arbitrary labels in persisted health.
  if (report.runHealth.length) console.table(report.runHealth.map(compactHealth));
  else console.log("No collector runs retained.");
  console.log("Composer/pending feedback timing (immediate first request-correlated presentation; NOT message admission):");
  if (report.feedbackRows.length) console.table(report.feedbackRows);
  else console.log("No request-correlated composer/pending feedback samples retained.");
  console.log("SSE message handler/swap timing (event-local diagnostic only, not exact prompt admission):");
  if (report.sseRows.length) console.table(report.sseRows);
  else console.log("No complete SSE message timing samples retained.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
