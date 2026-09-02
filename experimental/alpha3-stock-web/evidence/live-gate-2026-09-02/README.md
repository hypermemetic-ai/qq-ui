# Live alpha.3 gate evidence — 2026-09-02

This is a new execution attempt after an architect-side probe reported npm DNS,
HTTPS, and `npm ping` success. That report was treated as a lead, not copied as
execution proof. In this implementation command sandbox, `ip -brief link`
reported only loopback, the route table was empty, fixed-IP HTTPS returned
`Network is unreachable`, and the safety-isolated npm install failed with
`ENOTFOUND` while fetching `@deepseek-ai/cordis`. No lock or `node_modules` was
created. Therefore the exact compiler, CLI, host, and product browser stages
could not run; their statuses remain blocked rather than passed.

## Files

- `source-provenance.txt`: fresh exact commit/tag verification, handoff hash, and
  confirmation that both research evidence manifests are empty.
- `launcher-source.txt`: fresh authoritative source excerpts with original line
  numbers for profile, patch layering, and Web app flags.
- `preflight.json`, `environment-policy.json`, `prepare.log`: successful
  safety-isolated preparation in a canonical real `/tmp` directory with 253
  exact source-derived overrides.
- `execution-environment.txt`: Node/npm/kernel, loopback-only interface and route
  facts, libc lookup result, fixed-IP HTTPS failure, and the four-file local
  alpha.3 tarball inventory.
- `install-attempt.log`, `npm-ping-debug.log`, `npm-install-debug.log`: bounded
  isolated npm ping/install evidence. The install fails at public package
  `@deepseek-ai/cordis`; no package lock is generated.
- `generated-host-package.json`: inspectable generated host manifest containing
  `@deepseek-ai/dsh@0.1.2-alpha.3` and 253 exact alpha.3 DSH overrides. This is
  not a host lock or installation proof.
- `repository-gates.log`: strict public check exit 2 followed by passing build,
  lifecycle, bundle, gate-fixture, blank-session sequencing, canonical-root
  symlink rejection, drift rejection, and syntax proofs.
- `root-npm-test.log`: complete root suite pass through a temporary read-only
  dependency symlink, removed immediately after the run.
- `browser-tooling-preflight.json`, `browser-tooling-only.png`: real Playwright
  and Chromium launch against a `data:` page. This proves tooling availability
  only. It is deliberately not stock-Web, QQ rendering, viewport, or HMR proof.
- `status.json`: bounded pass/block matrix.
- `manifest.sha256`: hashes for this evidence set (excluding itself).

There is no host log, config dump, boot manifest, browser network/console trace,
or live product screenshot because no alpha.3 CLI could be installed. No static
page or repository mock is substituted for those live claims. No provider
credential was inspected, inherited, or required: execution stopped at the
public package prerequisite before reaching the credential stage.

The exact environmental prerequisite is an implementation execution context
with working non-loopback egress and DNS/HTTPS access to `registry.npmjs.org`
(or a complete, independently verifiable exact public package cache made
available to the isolated root). The existing four tarballs are insufficient.
After all noncredential stages pass, a real model-turn assertion separately
requires a credential intentionally entered into this isolated profile; it may
never be copied from legacy state.
