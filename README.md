# `@hypermemetic-ai/qq-ui`

Private ES-module package providing the server-rendered Cordis plugin for the qq operator console. The package root exports [`src/plugin.mjs`](src/plugin.mjs); additional public entry points expose the [HTTP app](src/http-app.mjs), [renderer](src/render.mjs), and [Markdown support](src/markdown.mjs).

## Setup and commands

The package declares `@hypermemetic-ai/qq-core` as `file:../qq-core`, so dependency setup expects that sibling package at the stated relative path. No start script is defined in `package.json`; runtime integration begins at the plugin or one of the exported entry points above.

```sh
npm test
```

`npm test` performs syntax checks and runs the repository's established proof scripts. Focused package scripts are also available:

```sh
npm run prove:sessions-rendered
npm run prove:prompt-echo
npm run prove:prompt-correlation
npm run prove:prompt-geometry
npm run latency:report
```

## Repository map

- [`src/plugin.mjs`](src/plugin.mjs) — package root and Cordis plugin entry point.
- [`src/http-app.mjs`](src/http-app.mjs) — exported HTTP boundary and the most-imported internal module.
- [`src/render.mjs`](src/render.mjs) — exported rendering boundary and a frequent change surface.
- [`src/markdown.mjs`](src/markdown.mjs) — exported Markdown boundary.
- [`assets/browser-v9.js`](assets/browser-v9.js) and [`assets/console.css`](assets/console.css) — current high-change browser and styling surfaces. Versioned browser, service-worker, and offline assets are retained alongside them; do not assume similarly named older files are disposable without further evidence.
- [`scripts/`](scripts/prove-sessions-rendered.mjs) — executable proofs and latency reporting. The full suite and exact order are defined by the `test` script in [`package.json`](package.json).
- [`vendor/`](vendor/htmx-2.0.10.min.js) and [`vendor-pins.json`](vendor-pins.json) — tracked vendored files, licenses, and pin data.

For a change to an exported boundary, start with its mapped `src` entry point and run `npm test`. For session rendering, prompt echo/correlation/geometry, or latency work, use the matching focused command above while iterating, then run the full suite.

## Further orientation

- [Operator console notes](wiki/operator-console.md)
- [Latency roadmap](wiki/latency-roadmap.md)
- [Wiki index](wiki/index.md)
