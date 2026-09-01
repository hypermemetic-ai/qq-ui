# `@hypermemetic-ai/qq-ui`

Private ESM package providing the server-rendered Cordis plugin for the qq operator console. Its package entry is [`src/plugin.mjs`](src/plugin.mjs), with additional exports for HTTP, rendering, and Markdown concerns.

## Run and verify

The package metadata does not define install or start scripts. It declares `@hypermemetic-ai/qq-core` as the local dependency `file:../qq-core`, so that sibling layout is part of dependency setup.

```sh
npm test
```

The full test script syntax-checks the plugin and current browser bundle, then runs the repository's proof scripts. Focused package scripts are also available:

| Command | Scope |
| --- | --- |
| `npm run prove:sessions-rendered` | Rendered sessions |
| `npm run prove:prompt-echo` | Prompt echo |
| `npm run prove:prompt-correlation` | Browser prompt correlation |
| `npm run prove:prompt-geometry` | Browser prompt geometry |
| `npm run latency:report` | UI latency report |

## System map

| Boundary | Start here |
| --- | --- |
| Plugin/package entry | [`src/plugin.mjs`](src/plugin.mjs) is both `main` and the `.` export. |
| HTTP application | [`src/http-app.mjs`](src/http-app.mjs) is the `./http` export and the most widely imported relative module. |
| Server rendering | [`src/render.mjs`](src/render.mjs) is the `./render` export, a high-fan-in module, and the most frequently changed source file. |
| Markdown | [`src/markdown.mjs`](src/markdown.mjs) is the `./markdown` export. |
| Browser presentation | [`assets/browser-v9.js`](assets/browser-v9.js) and [`assets/console.css`](assets/console.css) are the most frequently changed browser-side paths; the full test script explicitly syntax-checks `browser-v9.js`. |

The package publishes `assets/`, `src/`, [`scripts/report-ui-latency.mjs`](scripts/report-ui-latency.mjs), `vendor/`, and [`vendor-pins.json`](vendor-pins.json) in addition to this README. Runtime behavior beyond the declared exports and scripts is not established by package metadata; follow the focused sources and proofs below rather than assuming an undocumented start flow.

## Route a change

| Change area | Canonical starting point | Focused verification |
| --- | --- | --- |
| HTTP and root/workflow routing | [`src/http-app.mjs`](src/http-app.mjs) | [`scripts/prove-root-routing.mjs`](scripts/prove-root-routing.mjs), [`scripts/prove-workflow-selection-route.mjs`](scripts/prove-workflow-selection-route.mjs) |
| Rendering and session projection | [`src/render.mjs`](src/render.mjs) | [`scripts/prove-sessions-rendered.mjs`](scripts/prove-sessions-rendered.mjs), [`scripts/prove-transcript-projection.mjs`](scripts/prove-transcript-projection.mjs), [`scripts/prove-selective-render-cache.mjs`](scripts/prove-selective-render-cache.mjs) |
| Browser prompt interaction or geometry | [`assets/browser-v9.js`](assets/browser-v9.js), [`assets/console.css`](assets/console.css) | [`scripts/prove-prompt-correlation-browser.mjs`](scripts/prove-prompt-correlation-browser.mjs), [`scripts/prove-prompt-geometry-browser.mjs`](scripts/prove-prompt-geometry-browser.mjs) |
| UI latency | [`src/latency-store.mjs`](src/latency-store.mjs), [`scripts/report-ui-latency.mjs`](scripts/report-ui-latency.mjs) | [`scripts/prove-visual-latency.mjs`](scripts/prove-visual-latency.mjs), [`scripts/prove-passive-latency.mjs`](scripts/prove-passive-latency.mjs) |

Run `npm test` after focused verification because it is the package's aggregate check.

## Further detail

- [`wiki/operator-console.md`](wiki/operator-console.md) — operator-console documentation
- [`wiki/latency-roadmap.md`](wiki/latency-roadmap.md) — latency roadmap
- [`wiki/index.md`](wiki/index.md) — repository documentation index
- [`package.json`](package.json) — exports, dependencies, shipped files, and exact script definitions
