# `@hypermemetic-ai/qq-ui`

Server-rendered Cordis plugin for the qq operator console. This is a private ESM package; its primary entry point is [`src/plugin.mjs`](src/plugin.mjs).

## Run the established checks

The package declares no `start` script. Its complete check suite is:

```sh
npm test
```

Focused package scripts are also available:

```sh
npm run prove:sessions-rendered
npm run prove:prompt-echo
npm run prove:prompt-correlation
npm run prove:prompt-geometry
npm run latency:report
```

The dependency on `@hypermemetic-ai/qq-core` is declared as `file:../qq-core`, so dependency installation requires that sibling path. No package-manager-specific install command is declared.

## Repository map

- [`src/plugin.mjs`](src/plugin.mjs) — package main export and Cordis plugin entry point.
- [`src/http-app.mjs`](src/http-app.mjs) — public `./http` export and the most imported relative module; start here for HTTP-facing work.
- [`src/render.mjs`](src/render.mjs) — public `./render` export and another central, frequently changed module; start here for server-rendered output.
- [`src/markdown.mjs`](src/markdown.mjs) — public `./markdown` export.
- [`assets/browser-v9.js`](assets/browser-v9.js) and [`assets/console.css`](assets/console.css) — prominent browser and styling change points. The test script syntax-checks `browser-v9.js`; older versioned assets remain tracked, so do not assume every similarly named asset is current.
- [`scripts/`](scripts/prove-sessions-rendered.mjs) — executable proof scripts. `npm test` runs the declared suite; individual script names are the best routing index for focused checks.
- [`vendor-pins.json`](vendor-pins.json) and [`vendor/`](vendor/htmx-2.0.10.min.js) — tracked vendor pins, artifacts, and licenses.

The package exposes only `.`, `./http`, `./render`, and `./markdown`; treat those declared exports as its public module boundary.

## Route common changes

| Change area | Start with | Nearby focused evidence |
| --- | --- | --- |
| HTTP and root/workflow routing | [`src/http-app.mjs`](src/http-app.mjs) | [`prove-root-routing.mjs`](scripts/prove-root-routing.mjs), [`prove-workflow-selection-route.mjs`](scripts/prove-workflow-selection-route.mjs) |
| Rendered sessions and dashboard UI | [`src/render.mjs`](src/render.mjs) | [`prove-sessions-rendered.mjs`](scripts/prove-sessions-rendered.mjs), [`prove-dashboard-usage.mjs`](scripts/prove-dashboard-usage.mjs), [`prove-dashboard-live-tracker.mjs`](scripts/prove-dashboard-live-tracker.mjs) |
| Browser interaction and presentation | [`assets/browser-v9.js`](assets/browser-v9.js), [`assets/console.css`](assets/console.css) | [`prove-prompt-correlation-browser.mjs`](scripts/prove-prompt-correlation-browser.mjs), [`prove-prompt-geometry-browser.mjs`](scripts/prove-prompt-geometry-browser.mjs), [`prove-visual-latency.mjs`](scripts/prove-visual-latency.mjs) |
| Plugin and console-menu integration | [`src/plugin.mjs`](src/plugin.mjs), [`src/console-menu.mjs`](src/console-menu.mjs) | [`prove-console-menu-contributions.mjs`](scripts/prove-console-menu-contributions.mjs), [`prove-plugin-context-cards.mjs`](scripts/prove-plugin-context-cards.mjs) |
| Latency storage and reporting | [`src/latency-store.mjs`](src/latency-store.mjs), [`scripts/report-ui-latency.mjs`](scripts/report-ui-latency.mjs) | [`wiki/latency-roadmap.md`](wiki/latency-roadmap.md), [`prove-passive-latency.mjs`](scripts/prove-passive-latency.mjs) |

For broader repository detail, continue with the [`wiki` index](wiki/index.md) and the [operator-console notes](wiki/operator-console.md).
