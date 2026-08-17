# `@hypermemetic-ai/qq-ui`

Ordinary server-rendered Cordis plugin for the qq operator console. It injects
the `qq` logic service plus DSH's public `webServer` carrier and owns HTTP,
forms, SSE, HTML, CSS, and PWA assets.

It does not own DSH credentials, model adapters, the Agent registry, persistence,
transcript storage, session-id minting, or a domain database. Dependency is
one-way: `qq-ui → qq`.

The same-host workbench composes this plugin through [`../dsh-console`](../dsh-console).
Later extraction to a standalone repository is a package move of this directory.
