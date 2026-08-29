# `@hypermemetic-ai/qq-ui`

Server-rendered Cordis operator console. This repository owns HTML, routes,
CSS, htmx, browser behavior, and PWA assets; presentation-neutral session
semantics remain in `@hypermemetic-ai/qq-core` from sibling `qq-core`.

The local dependency is `file:../qq-core`. The core launcher binds this plugin
only when `../qq-ui` is present, and its HMR root is this repository root.
Creating a session for this project uses the cwd `/home/qqp/projects/qq-ui`,
not a containing checkout.

Project Markdown and code are rendered through markdown-it 15.0.0 and
highlight.js 11.12.0. Admitted binary files use core's bounded same-origin open
response. Current assets are served `no-store`; plugin reload and a page reload
are enough during development.

## Opt-in visual-latency study

qq-ui includes a local browser study for comparing interaction-to-visual-ready
latency while working on the UI. It is off by default and is not production
telemetry. No study data is sent anywhere.

### Enable, run, report, export, and clear

1. Add `?qq-latency=1` to a qq-ui page URL and load it. For example,
   `/qq/session/<id>?qq-latency=1`. This opts in the current tab through
   `sessionStorage`; navigation and reloads in that tab remain opted in.
2. Open browser developer tools, run `qqLatency.clear()`, and perform the prompt,
   HTMX, SSE, drawer, dialog, input, focus, scroll, navigation, or streaming
   interaction being studied. `qqLatency.start()` can explicitly resume a
   stopped study.
3. Run `qqLatency.report()` for a per-request console table. Each row contains
   the retained visual sample count and first, p50, p95, and last latency from
   the trusted interaction that originated that request. Percentiles use linear
   interpolation.
4. Inspect all raw timelines with `qqLatency.snapshot()`. To export a JSON copy
   from browsers whose developer tools provide `copy`, run:

   ```js
   copy(JSON.stringify(qqLatency.snapshot(), null, 2))
   ```

   Otherwise evaluate `JSON.stringify(qqLatency.snapshot(), null, 2)` and save
   the returned string manually. Keep exports local: labels intentionally omit
   input values and text, but include UI tag/id/class, route action, viewport,
   and user-agent metadata.
5. Run `qqLatency.clear()` to discard captured records without disabling the
   active study. Run `qqLatency.stop()` to stop and opt this tab out while
   retaining its current records for inspection. To disable on page load (and
   persist that choice for the tab), load any qq-ui URL with `?qq-latency=0`.

`window.qqLatency` provides `start()`, `stop()`, `clear()`, `snapshot()`,
`summary()`, and `report()`. Disabled mode does not install the study's
MutationObserver, animation-frame work, or event listeners.

### What the numbers mean

The canonical zero point is the earliest capture-phase receipt of a trusted
pointer, keyboard, form, or control interaction. A pointerdown/click/submit
chain is one origin. HTMX `beforeSend` is retained as a **network dispatch**
stage; it is not described as exact server receipt. Latest-interaction and
active-request correlations are separate, so a local drawer click does not
replace a still-active prompt-to-stream request timeline. A request remains the
active correlation until a newer HTMX request supersedes it.

A visual record represents one coalesced browser presentation opportunity, not
one DOM mutation. DOM child, text, and attribute mutations and native input,
toggle, focus, scroll, window, and visual-viewport signals normally settle at
the next `requestAnimationFrame`. The rAF-smoothed token painter has a direct
hook so its current stream frame does not acquire an additional observer frame.
These are **visual-ready/presentation-opportunity timings**, normally accurate
to about plus or minus one frame; they are not exact compositor pixel timings.

Storage is bounded to the newest 500 interaction origins, 1,000 request/stage
records, and 2,000 visual records. `snapshot().dropped` reports overwritten
records. The snapshot is JSON-safe and includes monotonic start/capture times,
`performance.timeOrigin`, UI generation/revision when available, viewport,
user agent, sanitized origins/stages, visual correlations, limits, and dropped
counts. Prompt/input values, mutation text, and request query strings are never
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
