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

On desktop, the heading project menu and session tokens switch live chairs;
up/down and left/right arrows still move between projects and sessions. On
phone, a leftward pull opens the right files drawer, which settles from
release distance and velocity. An open panel closes by dragging back; tapping
the empty dimmer does nothing. The composer `nav` control toggles navigation
mode: a translucent overlay covers the live session (tools included) and
shows two pressable lists — projects on the left, sessions on the right.
Tap a row to select it; `chat` leaves the overlay. Native vertical scrolling,
horizontal file panning, and controls keep their own touch gestures in
session mode. The heading is read-only
project and session id, with status after the session and workflow on the
right. Folders list above a thin line, files below it, with no folder square.
Each project has its own sessions; session ids stay universal. Folder
navigation stays URL-addressed. Readable files use
one full-viewport, pitch-black document viewer. Markdown-It
15.0.0 renders Markdown with raw HTML disabled and allowlisted links, while
highlight.js 11.12.0 deterministically highlights recognized code languages.
PDFs and other admitted binaries use qq's bounded same-origin open response.

The qq host recipe composes this plugin through `core/host.patch.yml`; `bin/qq`
binds it when present. Later extraction to a standalone repository is a package
move of this directory.
