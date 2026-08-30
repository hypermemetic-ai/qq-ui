#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { createConsoleHandler } from "../src/http-app.mjs";

const ids = Object.freeze({
  project: "session-a1000000-0000-4000-8000-000000000001",
  folder: "session-a1000000-0000-4000-8000-000000000002",
  home: "session-a1000000-0000-4000-8000-000000000003",
  projects: "session-a1000000-0000-4000-8000-000000000004",
  child: "session-a1000000-0000-4000-8000-000000000005",
  stale: "session-a1000000-0000-4000-8000-000000000006",
});

const rows = Object.freeze({
  project: Object.freeze({ id: ids.project, project: "alpha", cwd: "/srv/projects/alpha", live: true }),
  folder: Object.freeze({ id: ids.folder, project: "studio", folder: "east", cwd: "/srv/projects/studio-east", live: true }),
  home: Object.freeze({ id: ids.home, scope: "home", cwd: "/srv/scratch/home", live: true }),
  projects: Object.freeze({ id: ids.projects, scope: "projects", cwd: "/srv/projects", live: true }),
  child: Object.freeze({
    id: ids.child,
    project: "alpha",
    cwd: "/srv/projects/alpha",
    origin: "subagent",
    parent: ids.project,
    live: true,
  }),
});

function currentAgentRow(row) {
  // qq-core inspectAgent() currently exposes live agent identity, cwd, origin,
  // and parent, but leaves project/folder classification to inspect().
  return {
    id: row.id,
    cwd: row.cwd,
    origin: row.origin ?? "",
    parent: row.parent ?? "",
    live: row.live,
  };
}

function fixture({
  liveRows = [rows.project],
  inspected = liveRows,
  inspectAgent = true,
  richInspectAgent = false,
  homeFallback = true,
} = {}) {
  const byId = new Map(inspected.map((row) => [row.id, row]));
  const calls = { inspectAgent: 0, inspect: 0, list: 0, read: 0 };
  const backend = {
    defaultProject: "alpha",
    listProjects: () => [
      { name: "alpha", label: "alpha", cwd: "/srv/projects/alpha" },
      {
        name: "studio",
        label: "studio",
        cwd: "/srv/projects/studio-east",
        grouped: true,
        folders: [{ name: "east", label: "east", cwd: "/srv/projects/studio-east" }],
      },
    ],
    async list() {
      calls.list += 1;
      return structuredClone(liveRows);
    },
    async inspect(id) {
      calls.inspect += 1;
      const row = byId.get(id);
      if (!row) {
        const error = new Error("not found");
        error.status = 404;
        throw error;
      }
      return structuredClone(row);
    },
    read() {
      calls.read += 1;
      return new Promise(() => {});
    },
    observe() { return () => {}; },
    async create() { return structuredClone(rows.project); },
    async prompt() { return structuredClone(rows.project); },
    async interrupt() { return structuredClone(rows.project); },
    async close() { return { id: "", project: "alpha" }; },
  };
  if (inspectAgent) {
    backend.inspectAgent = (id) => {
      calls.inspectAgent += 1;
      const row = byId.get(id);
      if (!row) {
        const error = new Error("not found");
        error.status = 404;
        throw error;
      }
      return structuredClone(richInspectAgent ? row : currentAgentRow(row));
    };
  }
  if (homeFallback) backend.latestHome = async () => null;
  return { backend, calls };
}

async function withFixture(options, run) {
  const state = fixture(options);
  const handler = createConsoleHandler(state.backend);
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base, state.calls);
  } finally {
    handler.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function fetchBefore(url, options = {}, maximumMs = 250) {
  const controller = new AbortController();
  const started = performance.now();
  let timer;
  try {
    const response = await Promise.race([
      fetch(url, { ...options, signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`root routing exceeded ${maximumMs}ms`)), maximumMs);
      }),
    ]);
    return { response, duration: performance.now() - started };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function cookie(id) {
  return { cookie: `qq-last-session=${id}` };
}

async function rootRequest(base, id, search = "") {
  const headers = id ? cookie(id) : {};
  const { response, duration } = await fetchBefore(`${base}/qq/${search}`, {
    headers,
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  return { location: response.headers.get("location"), duration };
}

const cases = [
  ["project", rows.project, `/qq/project/alpha/session/${ids.project}`],
  ["grouped project folder", rows.folder, `/qq/project/studio/east/session/${ids.folder}`],
  ["home", rows.home, `/qq/session/${ids.home}`],
  ["projects chair", rows.projects, `/qq/session/${ids.projects}`],
  ["child", rows.child, `/qq/project/alpha/session/${ids.child}`],
];
for (const [label, row, eventual] of cases) {
  await withFixture({ liveRows: [rows.project], inspected: [row] }, async (base, calls) => {
    const root = await rootRequest(base, row.id, "?proof=root");
    const immediate = `/qq/session/${row.id}?proof=root`;
    assert.equal(root.location, immediate, `${label} uses the synchronous live-agent result`);
    assert.equal(calls.inspectAgent, 1, `${label} checks current in-memory liveness once`);
    assert.equal(calls.list, 0, `${label} does not need list fallback`);
    assert.equal(calls.read, 0, `${label} root routing never reads a transcript`);

    if (eventual !== `/qq/session/${row.id}`) {
      const { response } = await fetchBefore(`${base}${root.location}`, { redirect: "manual" });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), `${eventual}?proof=root`,
        `${label} reaches the same project-aware destination with root search intact`);
      assert.equal(calls.inspect, 1);
      assert.equal(calls.read, 0, `${label} canonicalization also avoids transcript reads`);
    } else {
      assert.equal(root.location, `${eventual}?proof=root`, `${label} is already canonical`);
    }
  });
}

await withFixture({
  liveRows: [rows.folder],
  inspected: [rows.folder],
  richInspectAgent: true,
}, async (base, calls) => {
  const result = await rootRequest(base, ids.folder, "?proof=rich");
  assert.equal(result.location, `/qq/project/studio/east/session/${ids.folder}?proof=rich`,
    "an inspectAgent row with canonical metadata redirects directly and preserves search");
  assert.equal(calls.inspectAgent, 1);
  assert.equal(calls.inspect, 0);
  assert.equal(calls.list, 0);
  assert.equal(calls.read, 0);
});

await withFixture({ liveRows: [rows.folder, rows.project], inspected: [rows.folder, rows.project] }, async (base, calls) => {
  const result = await rootRequest(base, ids.stale);
  assert.equal(result.location, `/qq/project/studio/east/session/${ids.folder}`,
    "a stale cookie reaches the same first live destination as no remembered session");
  assert.equal(calls.inspectAgent, 1);
  assert.equal(calls.list, 1, "stale inspection falls back to live-only list metadata once");
  assert.equal(calls.read, 0, "a stale cookie never triggers full backend.read()");
});

await withFixture({ liveRows: [rows.folder, rows.project] }, async (base, calls) => {
  const result = await rootRequest(base, null);
  assert.equal(result.location, `/qq/project/studio/east/session/${ids.folder}`,
    "without a cookie the first live metadata row remains the destination");
  assert.equal(calls.inspectAgent, 0);
  assert.equal(calls.list, 1);
  assert.equal(calls.read, 0);

  const malformed = await fetchBefore(`${base}/qq/`, {
    headers: { cookie: "qq-last-session=not-a-session" },
    redirect: "manual",
  });
  assert.equal(malformed.response.headers.get("location"), `/qq/project/studio/east/session/${ids.folder}`);
  assert.equal(calls.inspectAgent, 0, "invalid cookie values are not inspected");
  assert.equal(calls.list, 2);
  assert.equal(calls.read, 0);
});

await withFixture({
  liveRows: [rows.child, rows.folder],
  inspected: [rows.child, rows.folder],
  inspectAgent: false,
}, async (base, calls) => {
  const result = await rootRequest(base, ids.child);
  assert.equal(result.location, `/qq/project/alpha/session/${ids.child}`,
    "older fixtures without inspectAgent resolve remembered IDs from live list rows");
  assert.equal(calls.list, 1);
  assert.equal(calls.read, 0, "the compatibility path does not fall back to persistence");
});

await withFixture({ liveRows: [] }, async (base, calls) => {
  const result = await rootRequest(base, ids.stale);
  assert.equal(result.location, "/qq/home", "no live project row preserves the home fallback");
  assert.equal(calls.list, 1);
  assert.equal(calls.read, 0);
});

await withFixture({ liveRows: [], homeFallback: false }, async (base, calls) => {
  const { response } = await fetchBefore(`${base}/qq/`, { redirect: "manual" });
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(calls.list, 1);
  assert.equal(calls.read, 0);
});

await withFixture({ liveRows: [rows.folder], inspected: [rows.folder] }, async (base, calls) => {
  const durations = [];
  for (let index = 0; index < 20; index += 1) {
    durations.push((await rootRequest(base, ids.stale, `?sample=${index}`)).duration);
  }
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
  assert.ok(p95 < 250, `stale root p95 must be under 250ms locally (observed ${p95.toFixed(1)}ms)`);
  assert.equal(calls.read, 0, "the latency sample cannot complete by reading the stale transcript");
  console.log(`prove-root-routing: stale root p95 ${p95.toFixed(1)}ms`);
});

console.log("prove-root-routing: pass");
