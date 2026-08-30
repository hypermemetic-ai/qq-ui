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
    // Exactly one visual contributes for a request. Later progressive paints
    // are stream updates, not additional request-latency samples.
    const firstPresentation = request.visuals[0]?.entry ?? null;
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
  // which can be present at afterSwap, but reject a genuinely different SSE or
  // OOB target when both stable labels are available.
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
        // SSE extension swaps have no XHR request identity. Ignore prompt swaps
        // and OOB/different-target swaps while waiting for compatible evidence.
        const requestFree = entry.requestId === null || entry.requestId === undefined;
        if (pending.swapMs === null && requestFree && compatibleStageTarget(pending, entry)) {
          pending.swapMs = at - pending.at;
        }
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
  const sequencesByRun = new Map();
  const latestHealth = new Map();

  for (const record of records) {
    if (!record || typeof record !== "object" || typeof record.runId !== "string") continue;
    runs.add(record.runId);
    if (typeof record.batchId === "string") batches.add(JSON.stringify([record.runId, record.batchId]));
    const health = cumulativeHealth(record.health);
    if (health) latestHealth.set(record.runId, health);
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
        if (kind === "visuals") samples.visuals.push({ runId: record.runId, entry });
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
    sampleCounts,
    sequenceGaps,
    retention,
    runHealth,
    rows: requestReport.rows,
    requestRows: requestReport.rows,
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
  console.log(`runs=${report.runs} batches=${report.batches} origins=${report.entries.origins} stages=${report.entries.stages} visuals=${report.entries.visuals} first_presentations=${report.latencySamples} duplicates=${report.duplicates} malformed_lines=${report.malformedLines}`);
  console.log(`sequence_gaps origins=${report.sequenceGaps.origins} stages=${report.sequenceGaps.stages} visuals=${report.sequenceGaps.visuals}; retention origins=${report.retention.origins.percent ?? "n/a"}% stages=${report.retention.stages.percent ?? "n/a"}% visuals=${report.retention.visuals.percent ?? "n/a"}%`);
  console.log(`samples interaction_to_dispatch=${report.sampleCounts.interactionToDispatch} dispatch_to_initial_response=${report.sampleCounts.dispatchToInitialResponse} dispatch_to_swap=${report.sampleCounts.dispatchToSwap} dispatch_to_settle=${report.sampleCounts.dispatchToSettle} dispatch_to_first_presentation=${report.sampleCounts.dispatchToFirstPresentation} sse_handler=${report.sampleCounts.sseHandlers} sse_swap=${report.sampleCounts.sseSwaps}`);
  console.log("Collector health (O/S/V = origins/stages/visuals; latest cumulative metadata per run; n/a means an old log line):");
  // Keep this label above the table rather than encoding arbitrary labels in persisted health.
  if (report.runHealth.length) console.table(report.runHealth.map(compactHealth));
  else console.log("No collector runs retained.");
  console.log("Request timing (one first correlated presentation per request; stream age excluded):");
  if (report.requestRows.length) console.table(report.requestRows);
  else console.log("No request-correlated first-presentation samples retained.");
  console.log("SSE message handler/swap timing (event-local, not request latency):");
  if (report.sseRows.length) console.table(report.sseRows);
  else console.log("No complete SSE message timing samples retained.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
