# `@hypermemetic-ai/qq-ui`

Server-rendered Cordis plugin for the qq operator console. This is a private ES-module package; its main entry point is [`src/plugin.mjs`](src/plugin.mjs), and it depends on the sibling `@hypermemetic-ai/qq-core` package through `file:../qq-core`.

## Commands

No `start` script is defined. The established package tasks are:

```sh
npm test
npm run prove:sessions-rendered
npm run latency:report
```

`npm test` syntax-checks the plugin and current browser asset, then runs the visual, latency, interaction, dashboard, metadata, and rendered-session proof scripts declared in [`package.json`](package.json).

## Where to start

The package's exported boundaries are the most useful routing points:

- [`src/plugin.mjs`](src/plugin.mjs) — package root and declared main entry point.
- [`src/http-app.mjs`](src/http-app.mjs) — `./http` export.
- [`src/render.mjs`](src/render.mjs) — `./render` export and a high-change, high-fan-in area.
- [`src/markdown.mjs`](src/markdown.mjs) — `./markdown` export.

Browser-facing files live under [`assets/`](assets/console.css): [`assets/console.css`](assets/console.css) and [`assets/browser-v9.js`](assets/browser-v9.js) are the most frequently changed assets, and `browser-v9.js` is the browser file checked by `npm test`. Vendored files and their recorded versions are under [`vendor/`](vendor/htmx-2.0.10.min.js) and [`vendor-pins.json`](vendor-pins.json).

## Change routing

| Change | Begin with | Verification established by the package |
| --- | --- | --- |
| Plugin/package entry | [`src/plugin.mjs`](src/plugin.mjs) | `npm test` |
| HTTP boundary | [`src/http-app.mjs`](src/http-app.mjs) | `npm test` |
| Rendering or console presentation | [`src/render.mjs`](src/render.mjs), [`assets/console.css`](assets/console.css), [`assets/browser-v9.js`](assets/browser-v9.js) | `npm test` |
| Markdown export | [`src/markdown.mjs`](src/markdown.mjs) | `npm test` |
| Rendered sessions | [`scripts/prove-sessions-rendered.mjs`](scripts/prove-sessions-rendered.mjs) | `npm run prove:sessions-rendered` |
| UI latency reporting | [`scripts/report-ui-latency.mjs`](scripts/report-ui-latency.mjs) | `npm run latency:report` |

The full proof suite is the default check for cross-boundary changes; there are additional narrowly named proof scripts under [`scripts/`](scripts/prove-visual-latency.mjs), but only the two focused commands above have dedicated package scripts.

For existing repository documentation, see the [`wiki` index](wiki/index.md) and [operator-console notes](wiki/operator-console.md).
