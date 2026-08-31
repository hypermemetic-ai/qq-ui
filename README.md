# @hypermemetic-ai/qq-ui

Private, server-rendered Cordis plugin for the qq operator console. The package is ESM; its main entry point and root export are [`src/plugin.mjs`](src/plugin.mjs).

## Setup and commands

[`package.json`](package.json) does not prescribe a package manager or declare a `start` script. It depends on `@hypermemetic-ai/qq-core` through `file:../qq-core`, so installation requires that sibling layout.

```sh
npm test
```

The test script syntax-checks [`src/plugin.mjs`](src/plugin.mjs) and [`assets/browser-v9.js`](assets/browser-v9.js), then runs the repository's proof scripts. Useful declared subsets and reports are:

```sh
npm run prove:sessions-rendered
npm run prove:prompt-echo
npm run prove:prompt-correlation
npm run prove:prompt-geometry
npm run latency:report
```

Run `npm test` before handing off a change; the targeted commands are narrower feedback loops, not replacements for the full suite.

## System map

| Boundary | Start here |
| --- | --- |
| Cordis package integration | [`src/plugin.mjs`](src/plugin.mjs), the package main and root export |
| HTTP application | [`src/http-app.mjs`](src/http-app.mjs), also exported as `./http` |
| Server rendering | [`src/render.mjs`](src/render.mjs), also exported as `./render` |
| Markdown | [`src/markdown.mjs`](src/markdown.mjs), also exported as `./markdown` |
| Browser behavior and presentation | [`assets/browser-v9.js`](assets/browser-v9.js) and [`assets/console.css`](assets/console.css) |

`src/http-app.mjs` and `src/render.mjs` have the highest relative-module fan-in, and both are frequent change points. Treat them as central boundaries: check their callers and run the full suite when changing them.

## Route a change

- **Package entry points or integration:** begin with [`src/plugin.mjs`](src/plugin.mjs) and the exports in [`package.json`](package.json).
- **HTTP or rendered output:** begin with [`src/http-app.mjs`](src/http-app.mjs) and [`src/render.mjs`](src/render.mjs); related proof coverage includes [`scripts/prove-root-routing.mjs`](scripts/prove-root-routing.mjs), [`scripts/prove-selective-render-cache.mjs`](scripts/prove-selective-render-cache.mjs), and [`scripts/prove-sessions-rendered.mjs`](scripts/prove-sessions-rendered.mjs).
- **Browser interaction or geometry:** begin with [`assets/browser-v9.js`](assets/browser-v9.js) and [`assets/console.css`](assets/console.css); use the declared prompt correlation and geometry commands above for focused checks.
- **Latency instrumentation or reporting:** begin with [`src/latency-store.mjs`](src/latency-store.mjs) and [`scripts/report-ui-latency.mjs`](scripts/report-ui-latency.mjs); see [`wiki/latency-roadmap.md`](wiki/latency-roadmap.md).

For repository-maintained context, continue with the [`wiki` index](wiki/index.md) and the [operator-console notes](wiki/operator-console.md).
