# @hypermemetic-ai/qq-ui

Server-rendered Cordis plugin for the qq operator console. This is a private ESM package; its package entry point is [`src/plugin.mjs`](src/plugin.mjs).

## Setup and checks

The package declares `@hypermemetic-ai/qq-core` through the local path `file:../qq-core`, so that sibling path must be available when dependencies are installed. No start script is defined in [`package.json`](package.json).

Run the established test suite with:

```sh
npm test
```

This checks [`src/plugin.mjs`](src/plugin.mjs) and [`assets/browser-v9.js`](assets/browser-v9.js) syntax, then runs the proof scripts configured in `package.json`. To run the one separately exposed focused proof:

```sh
npm run prove:sessions-rendered
```

## Repository map

- [`src/plugin.mjs`](src/plugin.mjs) — package root export and primary entry point.
- [`src/http-app.mjs`](src/http-app.mjs), [`src/render.mjs`](src/render.mjs), and [`src/markdown.mjs`](src/markdown.mjs) — public `./http`, `./render`, and `./markdown` export boundaries. `render.mjs` has the highest relative-module fan-in, so changes there deserve broad test coverage.
- [`assets/`](assets/console.css) — packaged browser and console assets. The test command specifically checks `browser-v9.js`; `console.css` and `browser-v9.js` are the most actively changed asset files.
- [`scripts/`](scripts/prove-sessions-rendered.mjs) — executable proof checks. The canonical suite and ordering live in [`package.json`](package.json).
- [`vendor/`](vendor/htmx-2.0.10.min.js) and [`vendor-pins.json`](vendor-pins.json) — tracked vendored files, licenses, and pin metadata.

## Routing changes

| Change area | Start here | Relevant established checks |
| --- | --- | --- |
| Package integration or exports | [`src/plugin.mjs`](src/plugin.mjs), then [`package.json`](package.json) | `npm test` |
| HTTP boundary | [`src/http-app.mjs`](src/http-app.mjs) | `npm test` |
| Server rendering | [`src/render.mjs`](src/render.mjs) | [`scripts/prove-sessions-rendered.mjs`](scripts/prove-sessions-rendered.mjs) and the full suite |
| Markdown export | [`src/markdown.mjs`](src/markdown.mjs) | `npm test` |
| Browser behavior and console styling | [`assets/browser-v9.js`](assets/browser-v9.js), [`assets/console.css`](assets/console.css) | Match the change to the proof scripts listed in [`package.json`](package.json), then run `npm test` |

For additional repository documentation, see the [documentation index](wiki/index.md) and [operator-console notes](wiki/operator-console.md).

## Visual-latency study

qq-ui includes a local browser study for comparing interaction-to-visual-ready
latency while working on the UI. Collection starts automatically during
ordinary qq-ui use unless the current tab has explicitly opted out. This is
local operational instrumentation, not external telemetry: the browser sends
bounded deltas only to the qq page's same-origin server, and the server writes
only a bounded local state log.

### Passive collection and privacy

Each page gets a random run ID and monotonic sequence numbers for interaction,
stage, and visual records. New records share a 12-second upload timer rather
than causing per-frame requests. A matching server acknowledgement advances the
per-kind cursors. Network failures, 5xx, 408, and 429 retain the byte-identical
batch for retry. Other deterministic 4xx responses quarantine exactly that
batch, advance past its entries, and increment visible dropped/quarantined
counters so later records cannot be pinned. `pagehide` queues a best-effort
`sendBeacon` (or keepalive fetch) repacked below a separate 60 KiB unload budget.
`qqLatency.stop()` stops both measurement and
new uploads, while `qqLatency.start()` resumes both.

The browser endpoint is passed explicitly as `data-latency-endpoint` and must
resolve to the current origin. The server endpoint is `POST
<basePath>/ui-latency` (normally `/qq/ui-latency`). It rejects cross-origin,
wrong-method, encoded, non-JSON, oversized, and malformed batches. Its request
body cap is 256 KiB, and every array, string, ID, sequence, and numeric field is
independently bounded and copied through a fixed schema. Prompt/input values,
mutation text, query strings, request/response bodies, and cookies are not
stored. Recognized route and UI labels are retained, with UUID/session-shaped
route identifiers redacted to `:id` where practical. There is no external
network telemetry.

Browser memory remains bounded to the newest 500 interaction origins, 1,000
request/stage records, and 2,000 visual records. Upload candidate arrays are
independently bounded to 128 origins, 128 stages, and 128 visuals; each visual
accepts the same 22 recognized collector sources and up to 12 targets. The
browser serializes and UTF-8 measures each candidate, then binary-searches safe
entry prefixes below a 220 KiB normal wire budget. The HTTP endpoint retains
its strict 256 KiB aggregate cap. Unload transport is independently repacked
below 60 KiB so it does not reuse a normal or retry body that exceeds browser
`sendBeacon`/keepalive quotas. Entries are never split and empty/oversized
batches are not sent.

The first upload retains a 12-second debounce. After an acknowledgement or
deterministic client-error quarantine, remaining backlog drains immediately in
sequential non-overlapping batches. Network, 5xx, 408, and 429 failures retain
the byte-identical batch and retry on the normal debounce. `pagehide` attempts
one best-effort batch under its separate 60 KiB budget. `snapshot().dropped`
reports overwritten browser records; `snapshot().upload` exposes the run ID,
normal and unload wire budgets, pending and
advanced cursors, scheduling/retry state, attempts, successes, failures,
quarantined batches, best-effort beacons, cumulative unsent drops, and the last
upload error/times. Rendering, HTMX requests, stream painting, and unload never
wait for an upload.

### Durable log, report, rotation, and clear

Accepted sanitized batches are NDJSON at:

```text
${XDG_STATE_HOME}/qq/ui-latency.ndjson
```

If `XDG_STATE_HOME` is unset or not absolute, the exact default is
`~/.local/state/qq/ui-latency.ndjson`. The qq state directory is mode `0700` and
the files are mode `0600`. The current file and
`ui-latency.ndjson.1` are retained across browser and server reloads. By
default each file is at most 8 MiB, so the two-file rolling set is hard-bounded
to 16 MiB total. Rotation replaces the older `.1`; it does not grow a sequence
of archives.

From this checkout, report the default log with:

```sh
npm run latency:report
```

Pass a configured path after `--`, or request machine-readable output:

```sh
npm run latency:report -- /path/to/ui-latency.ndjson
npm run latency:report -- --json /path/to/ui-latency.ndjson
```

The dependency-free reporter reads `.1` before the current file, deduplicates
retries by run ID plus entry kind/sequence, and prominently prints sample counts,
per-kind sequence gaps and retention, and the latest cumulative collector health
for each run (generated sequences, accepted cursors, ring/upload drops, and
quarantines). Old lines without health metadata remain readable.

Request rows use only the first correlated visual per request. They report
interaction-to-dispatch separately from dispatch-to-initial-response,
dispatch-to-swap/settle, and dispatch-to-first-presentation. Progressive stream
age is excluded. A separate table reports event-local SSE handler and swap
timing. Percentiles use linear interpolation.

To clear durable history, preferably stop the qq process first so it cannot
append concurrently, then run:

```sh
npm run latency:report -- --clear
# configured path:
npm run latency:report -- --clear /path/to/ui-latency.ndjson
```

This removes both the current and `.1` file; the user-only directory and files
are recreated on the next accepted batch.

### Inspect, clear, stop, and resume in the browser

`window.qqLatency` provides `start()`, `stop()`, `clear()`, `snapshot()`,
`summary()`, and `report()`. `qqLatency.report()` displays the current page's
per-request table. `qqLatency.snapshot()` returns JSON-safe raw in-memory
records and upload status. For a local manual copy where browser developer
tools provide `copy`, run:

```js
copy(JSON.stringify(qqLatency.snapshot(), null, 2))
```

`qqLatency.clear()` discards current-page records and any unsent deltas but does
**not** erase already acknowledged durable history; use the clear command above
for that. `qqLatency.stop()` retains current browser records for inspection,
cancels passive upload scheduling, and stores a tab-scoped opt-out in
`sessionStorage`. Loading with `?qq-latency=0` does the same. Run
`qqLatency.start()` or load with `?qq-latency=1` to re-enable collection and
upload. An explicit query value overrides the stored preference.

Raw browser measurements reset on full reload, while acknowledged data remains
in the rolling log. There is no HUD or self-observing UI. Instrumentation adds
event hooks, one `MutationObserver`, and coalesced per-presentation work; this
limited observer effect can still perturb the smallest measurements. Stopped
mode has no study observer, animation-frame work, upload timer, or study event
listeners.

### Persistence configuration

`createConsoleHandler` options and qq-ui plugin config accept the same keys:

- `latencyPersistence: false` disables the endpoint and passive upload/storage
  without disabling in-browser measurement. It defaults to `true`.
- `latencyLogPath` overrides the XDG/default NDJSON path.
- `latencyLogMaxBytes` sets the hard total byte budget shared equally by the
  current and `.1` files; it defaults to 16 MiB.

To opt out of measurement as well, use `qqLatency.stop()` or
`?qq-latency=0` in that tab.

### What the numbers mean

The canonical zero point is the earliest capture-phase receipt of a trusted
pointer, keyboard, form, or control interaction. A pointerdown/click/submit
chain is one origin. HTMX `beforeSend` is retained as a **network dispatch**
stage; it is not described as exact server receipt. Latest-interaction and
request correlations remain separate. Request context is captured when an
initial DOM/swap signal occurs (and survives its pending rAF), then the global
active request is cleared by that request's `htmx:afterRequest`. Later
progressive or unrelated SSE visuals retain their event/target measurement but
do not inherit the completed prompt ID without request-local evidence.

A visual record represents one coalesced browser presentation opportunity, not
one DOM mutation. DOM child, text, and attribute mutations and native input,
toggle, focus, scroll, window, and visual-viewport signals normally settle at
the next `requestAnimationFrame`. The rAF-smoothed token painter has a direct
hook so its current stream frame does not acquire an additional observer frame.
These are **visual-ready/presentation-opportunity timings**, normally accurate
to about plus or minus one frame; they are not exact compositor pixel timings.

The snapshot is JSON-safe and includes monotonic start/capture times,
`performance.timeOrigin`, UI generation/revision when available, viewport,
user agent, sanitized origins/stages, visual correlations, limits, and dropped
counts. Persisted batches also include bounded numeric cumulative collector
health. Prompt/input values, mutation text, and request query strings are never
captured.

### Limits

The study can only time browser changes with a central observable signal. It
cannot directly observe CSS/compositor-only animations and transitions,
hover-only styles or pseudo-elements, pixels drawn inside canvas, media frames,
or native browser/OS UI. Some control, focus, and scroll presentations are
signaled without proof that pixels changed. Background-tab timer and animation
frame throttling can greatly distort results. DOM work after a frame boundary,
refresh-rate variation, and browser scheduling account for the normal
plus-or-minus-one-frame uncertainty.
