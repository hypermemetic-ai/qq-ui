# qq-ui architect orientation
Refreshed: 2026-08-29T12:09:06.129Z

This repository is one delivery boundary: the server-rendered operator console over presentation-neutral qq sessions. Route through the page below rather than treating source, assets, and proof scripts as separate subsystems.

- [Operator console delivery](operator-console.md) — Read before changing Cordis wiring, HTTP routes, snapshot projection, transcript rendering, HTMX/SSE updates, browser navigation, responsive chrome, files, approvals, Markdown, or PWA assets.
- [Operator-console latency roadmap](latency-roadmap.md) — Phases A–E, measured switch evidence, current targets, timing definitions, gates, and deferred options.
- Sibling route: `../qq-core` owns session identity, snapshots, transcript order, turn state, interruption, project/file access, and the launcher that optionally binds this plugin.
- Optional joints: `qq-workflows`, `qq-models`, `image-finder`, `media-box`, and `approval` contribute sheets or decisions; `/qq/dictate/client.js` and `/qq/cast/client.js` contribute browser capabilities.
