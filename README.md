# `@hypermemetic-ai/qq-ui`

Server-rendered Cordis operator console. This repository owns HTML, routes,
CSS, htmx, browser behavior, and PWA assets; presentation-neutral session
semantics remain in `@hypermemetic-ai/qq-core` from sibling `qq-core`.

The local dependency is `file:../qq-core`. The core launcher binds this plugin
only when `../qq-ui` is present, and its HMR root is this repository root.
Creating a session for this project uses the cwd `/home/qqp/projects/qq-ui`,
not a containing checkout.

Project Markdown and code are rendered through markdown-it 15.0.0 and
highlight.js 11.12.0. Admitted binary files use core's bounded same-origin open
response. Current assets are served `no-store`; plugin reload and a page reload
are enough during development.
