# QQ Core / DSH alpha.3 stock-Web composition spike

This is a separate, presentation-only Cordis package for the bounded
`dsh-v0.1.2-alpha.3` experiment. It does not replace the legacy
`@hypermemetic-ai/qq-ui` plugin, mount `/qq`, or run a presentation server.

## Build and proofs

From this directory:

```sh
npm install --ignore-scripts
npm run build
npm run check
npm run prove
```

`npm run check` consumes only the public package roots and `./client`/`./types`
exports pinned in `package.json`. `npm run build` creates the closure-factory
artifact consumed by alpha.3's stock client-module host. `npm run prove`
checks deterministic stock-module registration, the exact-dependency type gate,
and activation → disposal → reapplication with no stale slot, theme,
slash-command, or QQ-command entries.

For edit feedback while a stock alpha.3 Web host is running:

```sh
npm run watch
```

The watcher only rebuilds `lib/client.js`. Stock
`@deepseek-ai/dsh-client-hmr` owns artifact polling, browser notification, and
Cordis fiber disposal/reapplication. There is no QQ reload channel or browser
plugin loader.

## Experimental host composition

Install this directory as a local package in a DSH alpha.3 host checkout, then
apply [`host/cordis.patch.yml`](host/cordis.patch.yml) after the stock
`dsh-web-app` patch. Run that profile on a port/origin distinct from legacy
QQ. This is the complete host change: the host half is empty and adds no HTTP,
authentication, transport, cache, or runtime service.

The exact command-line syntax for applying an external patch depends on the
host repository's profile launcher and is intentionally not guessed here. The
host must retain the stock `dsh-web-app` roster; this package adds one Loader
row.

See [`SPIKE_REPORT.md`](SPIKE_REPORT.md) for evidence, gaps, and the ownership
recommendation. No live browser behavior is claimed by the repository-only
proofs.
