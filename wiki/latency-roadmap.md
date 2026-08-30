# Operator-console latency roadmap

## Objective and operating boundary

The live session switch must present fresh destination truth quickly without weakening popup safety, child-session observe-only behavior, or the single-EventSource rule. A 1–2 second switch is an **interim milestone, not the final target**. For a warm local console, the target is:

- interaction to presentation p50: **300–500 ms**;
- interaction to presentation p95: **under 1 second preferred, under 1.5 seconds hard**;
- Phase E critical `serverSheetsMs`: typically **under 50–100 ms**, with no multi-second secondary provider values on the critical path.

This roadmap does not authorize overlapping SSE connections, service restarts, deferral of safety-critical popups, or general app-shell/stale-cache work.

## Phase status

| Phase | Status / landed reference | Metric addressed | Result and gate |
| --- | --- | --- | --- |
| A — root routing | Landed `b8e7924`; merge/reference `32669db`; QA passed | Root navigation time, especially stale remembered-session routing | Root selection uses live metadata instead of loading a stale transcript. Gate passed. |
| B — selective live rendering/cache | Landed `af22d39`; merge/reference `a347e9b`; QA passed | Repeated render work during live updates | Stable settled output is reused and only changed regions render. Gate passed. |
| C1 — snapshot handoff and critical-first frames | Landed `9832ae7`; merge/reference `f99ed12`; QA passed | Duplicate initial view work and ready-to-presentation ordering | Exact one-shot page handoff plus ordered critical bootstrap; secondary rendered regions follow the ready flush. Gate passed. |
| C2 — server timing | Landed `6545428`; merge/reference `992926c`; QA passed | Attribution of switch delay across read, listing, sheets, and render phases | Fixed privacy-safe switch timing envelope is emitted and reportable. Gate passed. |
| D — prompt echo | Landed on main `55a7325` (PR #26); merge/reference `5d4c7fc46b464f95f1c015f06f979a9a8daa54cc`; QA passed | Prompt interaction feedback | Immediate honest pending echo, exact backend message-ID reconciliation, and deterministic failure/switch cleanup. Gate passed. |
| E — critical sheet policy | Landed on main `14d044f` (PR #27); merge/reference `459c84964dd013a4150e3775ea54a473f75338ae`; QA passed | Multi-second sheet acquisition inside destination `view` and interaction-to-presentation | Live-switch bootstrap loads navigation metadata and safety/composer sheets only. Case, dashboard/usage, and progress reconcile after ready. Implementation and QA gate passed; fresh server-timed warm-switch measurement remains. |
| F — stable prompt replacement | Implemented in this change; host commit/merge and QA pending | Prompt geometry and duplicate optimistic/authoritative representations | Optimistic markup has authoritative user geometry and out-of-flow status. Exact safe user or queue identity removes one owned echo in swap/mutation order, including truth-before-response. Gate: focused prompt/session proofs, full tests, and QA. |

## Evidence before Phase E

The server-timed run `bf6f53dd` contains 15 switches after phases A–D:

- interaction to presentation ranged from about **589.7 ms to 5.315 s**;
- many switches were **650–900 ms**, with several at **1.29–1.77 s**;
- ready to presentation was only **3.1–14.9 ms**, so browser presentation after ready was not the dominant delay;
- server `view`: p50 **328.545 ms**, p95 about **1.714 s**, maximum **3.418 s**;
- core `read`: p50 **16.107 ms**, maximum **110 ms**;
- session listing: p50 **45.427 ms**, maximum **48.891 ms**;
- sheets: p50 **263.937 ms**, p95 about **1.611 s**, maximum **3.360 s**;
- critical render: p50 **100.486 ms**, maximum **117.498 ms**;
- transcript render: p50 **8.06 ms**, maximum **43.547 ms**.

The 5.315-second outlier had **3.418 s** of server view time, including **3.360 s** of sheets, while critical rendering was about **102 ms** and final presentation about **3 ms**. This made secondary sheet acquisition the next evidenced critical-path target rather than an app-shell or browser-paint project.

## Phase E policy and metric definition

For `?bootstrap=session`, destination enrichment is explicit:

- **Critical before ready:** the active live project/session navigation list; offer; approval; login; overlay; and session mode, workflow list, and active find-work state. These preserve navigation/chrome and safe composer behavior. Independent optional facades are failure-isolated and merged in stable order; the core live list remains a controlled read outside that fan-out.
- **Secondary after ready:** case file/document, dashboard and usage, download/progress, and future nonessential sheets. The destination watcher starts full-sheet reconciliation only after `switch-ready` has been emitted and flushed. Results then pass through the existing destination stream, fingerprints, and browser generation/source checks.
- **Children:** child sessions remain observe-only and do not acquire root offer/approval/login/overlay/case sheets. Their progress remains supported as a post-ready secondary update.
- **Other requests:** full pages, mutations, and ordinary SSE retain full enrichment behavior. This is a live-switch-only tradeoff.

On a `session-switch-ready` payload, **`serverSheetsMs` now means only live-switch critical enrichment time**. It includes active navigation metadata and critical optional sheets; it excludes case, dashboard/usage, and progress acquisition performed by post-ready watcher reconciliation. This is a semantic correction, not metric gaming: the secondary work still runs and updates the active destination, but it no longer prevents readiness.

Case acquisition uses one API per enrichment pass. `caseFileFor` is preferred at handler construction; legacy `caseFor` is used only when the modern option is absent. The plugin exposes the workflows service only through `caseFileFor`.

## Current evidence and next gate

Deterministic repository proof covers a controlled unresolved case promise, ready emission and flush before case acquisition, all four safety popup classes before ready, late case/dashboard/progress updates, destination and generation correlation, modern and legacy call counts, secondary rejection isolation, child progress/observe-only behavior, and critical-only server sheet timing. Existing snapshot/order/timing/prompt proofs remain part of `npm test`.

There is not yet a post-E operator field run; the current evidence is deterministic path, ordering, timing-boundary, and call-count proof rather than a claimed production percentile improvement. The fresh warm-switch run below is therefore the next measurement gate.

After the Phase E landing and QA, run the same warm 15-switch server-timed workflow. Accept Phase E when critical `serverSheetsMs` is normally below 50–100 ms, no secondary multi-second values appear in that field, and warm interaction-to-presentation trends toward the 300–500 ms p50 and sub-1-second preferred/sub-1.5-second hard p95 targets. If `switchToSseOpen - serverView` is still material after that measurement, investigate that gap next; do not infer it from the pre-E run.

## Decisions and banked options

- **Dropped:** overlapping old/new SSE during switching. It complicates authority and ordering and is prohibited; the console keeps one stream.
- **Banked, not active:** a general app shell, general stale-data/cache rendering, and transport/session multiplexing. These remain possible later investigations only if fresh measurements justify their complexity.
- **Current narrow choice:** defer proven noncritical provider acquisition while preserving fresh core destination truth and safety-critical sheets. No app-shell or general stale-cache work is included in Phase E.
