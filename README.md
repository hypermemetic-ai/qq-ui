# `@hypermemetic-ai/qq-ui`

Private ESM package providing the server-rendered Cordis plugin for the qq operator console. The package entry point is [`src/plugin.mjs`](src/plugin.mjs); it also exposes explicit HTTP, rendering, and Markdown module boundaries.

## Setup and checks

The package declares `@hypermemetic-ai/qq-core` as `file:../qq-core`, so that sibling dependency must be available when dependencies are installed. No standalone `start` or `dev` script is declared.

Run the complete established check suite with:

```sh
npm test
```

This syntax-checks [`src/plugin.mjs`](src/plugin.mjs) and [`assets/browser-v9.js`](assets/browser-v9.js), runs the repository proof scripts, and finishes with the experimental stock-web build and proofs. Useful narrower package scripts are:

```sh
npm run prove:sessions-rendered
npm run prove:prompt-echo
npm run prove:prompt-correlation
npm run prove:prompt-geometry
npm run prove:alpha3-stock-web
npm run latency:report
```

See [`package.json`](package.json) for the exact commands and dependency declarations.

## Repository map

- **Package integration:** [`src/plugin.mjs`](src/plugin.mjs) is both `main` and the root export.
- **Server boundary:** [`src/http-app.mjs`](src/http-app.mjs) is exported as `./http` and has the highest relative-module fan-in in the repository.
- **Output boundaries:** [`src/render.mjs`](src/render.mjs) and [`src/markdown.mjs`](src/markdown.mjs) are exported as `./render` and `./markdown`. `render.mjs` is also a high-change, high-fan-in file, so rendering edits merit the full test suite.
- **Browser presentation:** [`assets/browser-v9.js`](assets/browser-v9.js) and [`assets/console.css`](assets/console.css) are the most actively changed tracked browser/CSS files; `npm test` directly syntax-checks `browser-v9.js`.
- **Executable proofs:** [`scripts/`](scripts/prove-sessions-rendered.mjs) contains the proof programs composed by `npm test`. Use the named package scripts above where one matches the change, then run the complete suite.
- **Experimental stock web:** [`experimental/alpha3-stock-web/README.md`](experimental/alpha3-stock-web/README.md) is the entry point for that subtree; its build and proofs are wired into `npm test` through `prove:alpha3-stock-web`.

The package boundary is intentionally explicit: it is private, uses ESM, and publishes only `.`, `./http`, `./render`, and `./markdown`. Treat [`package.json`](package.json) and those four target modules as the canonical starting points for public-surface changes.

## Further orientation

- [`DESIGN.md`](DESIGN.md) — repository design notes
- [`wiki/operator-console.md`](wiki/operator-console.md) — operator-console documentation
- [`wiki/latency-roadmap.md`](wiki/latency-roadmap.md) — latency roadmap
- [`experimental/alpha3-stock-web/SPIKE_REPORT.md`](experimental/alpha3-stock-web/SPIKE_REPORT.md) — experimental spike report
