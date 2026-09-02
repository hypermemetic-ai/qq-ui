# `@hypermemetic-ai/qq-ui`

Private ESM package providing the server-rendered Cordis plugin for the qq operator console. The package entry point is [`src/plugin.mjs`](src/plugin.mjs); its declared public module surface is:

| Import | Source |
| --- | --- |
| `@hypermemetic-ai/qq-ui` | [`src/plugin.mjs`](src/plugin.mjs) |
| `@hypermemetic-ai/qq-ui/http` | [`src/http-app.mjs`](src/http-app.mjs) |
| `@hypermemetic-ai/qq-ui/render` | [`src/render.mjs`](src/render.mjs) |
| `@hypermemetic-ai/qq-ui/markdown` | [`src/markdown.mjs`](src/markdown.mjs) |

## Setup and checks

[`package.json`](package.json) does not declare an install or start script, or a package-manager version. It resolves `@hypermemetic-ai/qq-core` from `file:../qq-core`, so dependency installation must preserve that sibling layout. No repository-local command for starting a Cordis host is established here.

Run the primary verification gate with:

```sh
npm test
```

That gate syntax-checks the plugin and [`assets/browser-v9.js`](assets/browser-v9.js), runs the root UI proof scripts, and finishes with the preserved alpha3 plus current alpha4 stock-Web proof gates. Package-level focused commands are also available:

```sh
npm run prove:sessions-rendered
npm run prove:prompt-echo
npm run prove:prompt-correlation
npm run prove:prompt-geometry
npm run latency:report
npm run prove:alpha3-stock-web
npm run prove:alpha4-stock-web
```

## System map

- **Plugin and package boundary:** [`src/plugin.mjs`](src/plugin.mjs) is both the main entry and root export; [`package.json`](package.json) is canonical for exports, dependencies, packaged files, and commands.
- **HTTP and rendering boundary:** [`src/http-app.mjs`](src/http-app.mjs) and [`src/render.mjs`](src/render.mjs) are public exports and the two highest-fan-in relative modules. They are also frequent change points, so changes there deserve the full gate and careful dependent review.
- **Packaged browser presentation:** [`assets/browser-v9.js`](assets/browser-v9.js) and [`assets/console.css`](assets/console.css) are the most frequently changed asset paths. Of the versioned browser files, `browser-v9.js` is the one explicitly checked by `npm test`.
- **Supporting server modules:** focused modules under [`src/`](src/plugin.mjs) cover approval, console menus, identifiers, latency storage, Markdown, and project ordering. Start with the public boundary above, then follow imports rather than treating every file as an independent subsystem.
- **Verification:** executable proofs live under [`scripts/`](scripts/prove-sessions-rendered.mjs). The separate [`experimental/alpha3-stock-web/`](experimental/alpha3-stock-web/README.md) historical area and [`experimental/alpha4-stock-web/`](experimental/alpha4-stock-web/README.md) current architecture-A preparation each have isolated build/proof sequences, exposed as `prove:alpha3-stock-web` and `prove:alpha4-stock-web`.

## Route a change

| Change | Start here | Focused proof/report candidates |
| --- | --- | --- |
| Package exports or Cordis integration | [`package.json`](package.json), [`src/plugin.mjs`](src/plugin.mjs) | Full `npm test` |
| HTTP or root routing | [`src/http-app.mjs`](src/http-app.mjs) | [`prove-root-routing.mjs`](scripts/prove-root-routing.mjs), [`prove-workflow-selection-route.mjs`](scripts/prove-workflow-selection-route.mjs) |
| Rendered sessions or transcripts | [`src/render.mjs`](src/render.mjs) | [`prove-sessions-rendered.mjs`](scripts/prove-sessions-rendered.mjs), [`prove-transcript-projection.mjs`](scripts/prove-transcript-projection.mjs), [`prove-selective-render-cache.mjs`](scripts/prove-selective-render-cache.mjs) |
| Browser prompt behavior or geometry | [`assets/browser-v9.js`](assets/browser-v9.js) | [`prove-prompt-echo.mjs`](scripts/prove-prompt-echo.mjs), [`prove-prompt-correlation-browser.mjs`](scripts/prove-prompt-correlation-browser.mjs), [`prove-prompt-geometry-browser.mjs`](scripts/prove-prompt-geometry-browser.mjs) |
| Latency instrumentation or reporting | [`src/latency-store.mjs`](src/latency-store.mjs), [`scripts/report-ui-latency.mjs`](scripts/report-ui-latency.mjs) | `npm run latency:report`, then full `npm test` |

Proof filenames are useful routing cues, not a substitute for the full gate.

## Further detail

- [`DESIGN.md`](DESIGN.md) — design notes
- [`wiki/operator-console.md`](wiki/operator-console.md) — operator-console documentation
- [`wiki/latency-roadmap.md`](wiki/latency-roadmap.md) — latency roadmap
- [`experimental/alpha3-stock-web/README.md`](experimental/alpha3-stock-web/README.md) and [`SPIKE_REPORT.md`](experimental/alpha3-stock-web/SPIKE_REPORT.md) — historical alpha3 experiment
- [`experimental/alpha4-stock-web/README.md`](experimental/alpha4-stock-web/README.md) and [`SPIKE_REPORT.md`](experimental/alpha4-stock-web/SPIKE_REPORT.md) — exact alpha4 stock-Web preparation and honest live-gate status
- [`vendor-pins.json`](vendor-pins.json) — vendored dependency pins
