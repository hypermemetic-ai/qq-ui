#!/usr/bin/env node
import { readFile, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { defaultLatencyLogPath } from "../src/latency-store.mjs";

function percentile(sorted, portion) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * portion;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const value = lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  return Math.round(value * 1000) / 1000;
}

export function analyzeLatencyRecords(records) {
  const runs = new Set();
  const batches = new Set();
  const entries = { origins: 0, stages: 0, visuals: 0 };
  const duplicateEntries = { origins: 0, stages: 0, visuals: 0 };
  const seen = new Set();
  const requestActions = new Map();
  const visuals = [];

  for (const record of records) {
    if (!record || typeof record !== "object" || typeof record.runId !== "string") continue;
    runs.add(record.runId);
    if (typeof record.batchId === "string") batches.add(JSON.stringify([record.runId, record.batchId]));
    for (const kind of ["origins", "stages", "visuals"]) {
      if (!Array.isArray(record[kind])) continue;
      for (const entry of record[kind]) {
        if (!Number.isSafeInteger(entry?.sequence) || entry.sequence < 1) continue;
        const key = JSON.stringify([record.runId, kind, entry.sequence]);
        if (seen.has(key)) {
          duplicateEntries[kind] += 1;
          continue;
        }
        seen.add(key);
        entries[kind] += 1;
        if (kind === "stages" && typeof entry.requestId === "string" && typeof entry.action === "string" && entry.action) {
          requestActions.set(JSON.stringify([record.runId, entry.requestId]), entry.action);
        } else if (kind === "visuals") {
          visuals.push({ runId: record.runId, entry });
        }
      }
    }
  }

  const groups = new Map();
  let latencySamples = 0;
  for (const { runId, entry } of visuals) {
    if (typeof entry.activeRequestLatencyMs !== "number" || !Number.isFinite(entry.activeRequestLatencyMs)) continue;
    latencySamples += 1;
    const action = typeof entry.activeRequestId === "string"
      ? requestActions.get(JSON.stringify([runId, entry.activeRequestId])) ?? "(unknown request)"
      : "(no request)";
    const source = Array.isArray(entry.sources) && entry.sources.length
      ? [...entry.sources].sort().join(",")
      : "(unknown source)";
    const key = `${action}\u0000${source}`;
    let group = groups.get(key);
    if (!group) {
      group = { action, source, values: [] };
      groups.set(key, group);
    }
    group.values.push(entry.activeRequestLatencyMs);
  }

  const rows = [...groups.values()].map(({ action, source, values }) => {
    const sorted = [...values].sort((left, right) => left - right);
    return {
      action,
      source,
      count: values.length,
      firstLatencyMs: Math.round(values[0] * 1000) / 1000,
      p50LatencyMs: percentile(sorted, 0.5),
      p95LatencyMs: percentile(sorted, 0.95),
      lastLatencyMs: Math.round(values.at(-1) * 1000) / 1000,
    };
  }).sort((left, right) => left.action.localeCompare(right.action) || left.source.localeCompare(right.source));

  return {
    runs: runs.size,
    batches: batches.size,
    entries,
    duplicateEntries,
    duplicates: duplicateEntries.origins + duplicateEntries.stages + duplicateEntries.visuals,
    latencySamples,
    rows,
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
  console.log(`runs=${report.runs} batches=${report.batches} origins=${report.entries.origins} stages=${report.entries.stages} visuals=${report.entries.visuals} latency_samples=${report.latencySamples} duplicates=${report.duplicates} malformed_lines=${report.malformedLines}`);
  if (report.rows.length) console.table(report.rows);
  else console.log("No request-correlated visual latency samples retained.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
