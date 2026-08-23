# `@hypermemetic-ai/qq-ui`

Ordinary server-rendered Cordis plugin for the qq operator console. It injects
the `qq` logic service plus DSH's public `webServer` carrier and owns HTTP,
forms, SSE, HTML, CSS, and PWA assets.

It does not own DSH credentials, model adapters, the Agent registry, persistence,
transcript storage, session-id minting, a project registry, or filesystem
containment. Dependency is one-way: `qq-ui → qq`. Child chairs
(`origin: subagent` / a parent session) never surface Allow/Reject; the
answerer rejects those asks immediately. Only root operator chairs the
operator is talking to may ask.

On phone, a deliberate rightward pull across the ordinary app surface directly
moves the compact one-level project drawer, which settles from release distance
and velocity. An open drawer closes by dragging left; tapping the empty dimmer
does nothing. Native vertical scrolling, horizontal file panning, and controls
keep their own touch gestures. The drawer is labelled projects at the top and
taps through to the projects session; project rows jump to that project's
session. Folders keep the square mark and no trailing slash. Each project has
its own sessions list; session ids stay universal. Folder navigation stays
URL-addressed. Readable files use
one full-viewport, pitch-black document viewer. Markdown-It
15.0.0 renders Markdown with raw HTML disabled and allowlisted links, while
highlight.js 11.12.0 deterministically highlights recognized code languages.
PDFs and other admitted binaries use qq's bounded same-origin open response.

The qq host recipe composes this plugin through `core/host.patch.yml`; `bin/qq`
binds it when present. Later extraction to a standalone repository is a package
move of this directory.
