# `@hypermemetic-ai/qq-ui`

Ordinary server-rendered Cordis plugin for the qq operator console. It injects
the `qq` logic service plus DSH's public `webServer` carrier and owns HTTP,
forms, SSE, HTML, CSS, and PWA assets.

It does not own DSH credentials, model adapters, the Agent registry, persistence,
transcript storage, session-id minting, a project registry, or filesystem
containment. Dependency is one-way: `qq-ui → qq`.

On phone, a deliberate rightward pull across the ordinary app surface directly
moves the compact one-level project drawer, which settles from release distance
and velocity. Native vertical scrolling, horizontal file panning, and controls
keep their own touch gestures. Folder and `~/projects`
navigation stay URL-addressed; project choices only navigate. Readable files use
a dedicated read-only view. Markdown-It
15.0.0 renders Markdown with raw HTML disabled and allowlisted links, while
highlight.js 11.12.0 deterministically highlights recognized code languages.
PDFs and other admitted binaries use qq's bounded same-origin open response.

The qq host recipe composes this plugin through `qq/host.patch.yml`; `bin/qq`
binds it when present. Later extraction to a standalone repository is a package
move of this directory.
