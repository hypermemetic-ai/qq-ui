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

## Passive startup and admission telemetry

`npm run latency:report` reads the user-private rolling NDJSON log and reports startup/session-open, live-switch, prompt-admission, immediate composer feedback, collector health, and diagnostic SSE timing separately. Startup rows retain the original `page.startedAt` meaning (navigation to collector execution), so old records remain useful even without Navigation Timing. New records add only fixed allowlisted `PerformanceNavigationTiming`, FP/FCP, byte-size, navigation-intent, SSE-channel, and conversation-sequence fields. They never include URLs, query strings, headers, prompt/message content, arbitrary DOM text, Server-Timing descriptions, or SSE payloads. Initial session HTML exposes only fixed numeric `qq-view` and `qq-render` Server-Timing phases.

A cross-document intent is a one-shot same-origin `sessionStorage` handoff with a safe normalized path/action and target. Session and project route identities are replaced by fixed `:id`, `:project`, and `:folder` labels. The handoff expires after 60 seconds (long enough to preserve the observed pre-script delays); after click propagation, a prevented/intercepted activation is removed immediately while an unprevented native navigation retains its handoff during a slow response. Reload, back/forward, and cold/PWA opens remain measurable through Navigation Timing without an intent.

Exact local prompt admission is the `prompt-admitted` stage emitted when a genuinely new `.message-user[data-seq]` node appears after a successful local composer request. Existing/re-rendered sequences are ignored and candidates are bounded. The operational assumption is FIFO: the next new user conversation node is matched to the oldest successfully completed local prompt request. An external concurrent submitter cannot be cryptographically distinguished without backend-provided identity. The report therefore shows admitted, still-unmatched, failed, and external-unmatched-node counts. Generic first transcript SSE timing is diagnostic only; the immediate request-correlated visual is explicitly labeled composer/pending feedback and is not message admission.
