# @hypermemetic-ai/qq-ui

Server-rendered Cordis plugin for the qq operator console. This package is private, uses ES modules, and depends on the sibling `../qq-core` package through `@hypermemetic-ai/qq-core`.

## Established commands

```sh
npm test
npm run prove:sessions-rendered
npm run prove:prompt-echo
npm run prove:prompt-correlation
npm run latency:report
```

`npm test` is the full declared check: it syntax-checks [`src/plugin.mjs`](src/plugin.mjs) and [`assets/browser-v9.js`](assets/browser-v9.js), then runs the repository's UI proof scripts. `prove:sessions-rendered` runs the focused sessions-rendered proof; `prove:prompt-echo` runs the immediate provisional/correlation/header/reconciliation/privacy proof; `prove:prompt-correlation` runs the real-Chromium, real-HTMX slow-response paint/transport proof; `latency:report` runs [`scripts/report-ui-latency.mjs`](scripts/report-ui-latency.mjs).

No install or start command is declared in `package.json`. In particular, dependency installation must account for the local `../qq-core` dependency.

## Code map

The package exposes four module entry points:

| Export | Source |
| --- | --- |
| package root | [`src/plugin.mjs`](src/plugin.mjs) |
| `./http` | [`src/http-app.mjs`](src/http-app.mjs) |
| `./render` | [`src/render.mjs`](src/render.mjs) |
| `./markdown` | [`src/markdown.mjs`](src/markdown.mjs) |

For a first change, route by boundary rather than surveying every file:

- **HTTP or rendering work:** start with [`src/http-app.mjs`](src/http-app.mjs) and [`src/render.mjs`](src/render.mjs). They have the highest relative-module fan-in and are among the most frequently changed source files.
- **Browser presentation:** start with [`assets/browser-v9.js`](assets/browser-v9.js) and [`assets/console.css`](assets/console.css). The former is explicitly checked by `npm test`; both are active change surfaces.
- **Verification:** [`scripts/`](scripts/prove-root-routing.mjs) contains focused proof scripts. Use the proof whose filename matches the affected area, then run `npm test` for the full declared check.
- **Vendored browser dependencies:** start at [`vendor-pins.json`](vendor-pins.json) and the tracked distributions and licenses under [`vendor/`](vendor/htmx-2.0.10.min.js).

## Further orientation

- [`wiki/index.md`](wiki/index.md) — repository documentation index
- [`wiki/operator-console.md`](wiki/operator-console.md) — operator-console detail
