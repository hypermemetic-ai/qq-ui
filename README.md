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
