# `@hypermemetic-ai/qq-ui`

Server-rendered Cordis plugin for the qq operator console. This is a private ES module package; its root entry point is [`src/plugin.mjs`](src/plugin.mjs), and it depends on the sibling package `@hypermemetic-ai/qq-core` through `file:../qq-core`.

## Run the established checks

The package defines no standalone start, build, or development script. Ensure the sibling `../qq-core` dependency is available before installing dependencies with your chosen Node package manager.

Run the complete syntax-and-proof suite:

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

See [`package.json`](package.json) for the exact commands and the full proof sequence.

## System map

- [`src/plugin.mjs`](src/plugin.mjs) — package main and root export; start here for Cordis plugin integration.
- [`src/http-app.mjs`](src/http-app.mjs) — `./http` export and the most widely imported module in the repository; start here for HTTP and route work.
- [`src/render.mjs`](src/render.mjs) — `./render` export and a central, frequently changed module for rendered output.
- [`src/markdown.mjs`](src/markdown.mjs) — `./markdown` export.
- [`assets/browser-v9.js`](assets/browser-v9.js) and [`assets/console.css`](assets/console.css) — the browser file checked by the test script and the frequently changed console stylesheet.
- [`scripts/`](scripts/prove-sessions-rendered.mjs) — executable proof scripts. Their focused names are the best available routing guide for validation.

## Route common changes

| Change | Start with | Relevant proof or report |
| --- | --- | --- |
| Plugin or package surface | [`package.json`](package.json), [`src/plugin.mjs`](src/plugin.mjs) | Full `npm test` |
| HTTP or root/workflow routing | [`src/http-app.mjs`](src/http-app.mjs) | [`prove-root-routing.mjs`](scripts/prove-root-routing.mjs), [`prove-workflow-selection-route.mjs`](scripts/prove-workflow-selection-route.mjs) |
| Server-rendered sessions or transcript projection | [`src/render.mjs`](src/render.mjs) | [`prove-sessions-rendered.mjs`](scripts/prove-sessions-rendered.mjs), [`prove-transcript-projection.mjs`](scripts/prove-transcript-projection.mjs) |
| Browser prompt behavior or geometry | [`assets/browser-v9.js`](assets/browser-v9.js), [`assets/console.css`](assets/console.css) | [`prove-prompt-echo.mjs`](scripts/prove-prompt-echo.mjs), [`prove-prompt-correlation-browser.mjs`](scripts/prove-prompt-correlation-browser.mjs), [`prove-prompt-geometry-browser.mjs`](scripts/prove-prompt-geometry-browser.mjs) |
| UI latency | [`src/latency-store.mjs`](src/latency-store.mjs), [`scripts/report-ui-latency.mjs`](scripts/report-ui-latency.mjs) | `npm run latency:report`, [`prove-visual-latency.mjs`](scripts/prove-visual-latency.mjs), [`prove-passive-latency.mjs`](scripts/prove-passive-latency.mjs) |

Run the full suite after a focused proof: `npm test` is the repository's only aggregate test command.

## Further orientation

- [`wiki/operator-console.md`](wiki/operator-console.md) — operator-console detail.
- [`wiki/latency-roadmap.md`](wiki/latency-roadmap.md) — latency-focused detail.
- [`wiki/index.md`](wiki/index.md) — documentation index.
- [`vendor-pins.json`](vendor-pins.json) — tracked vendor pin data; corresponding licenses live under [`vendor/`](vendor/HTMX-LICENSE).
