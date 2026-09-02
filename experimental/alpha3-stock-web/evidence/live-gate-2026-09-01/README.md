# Live alpha.3 gate evidence — 2026-09-01

This directory contains bounded evidence produced by the implementation run. It
does **not** copy PASS labels from research handoff `research-9cd44791`; that
handoff's evidence manifest was empty. No live stock host was booted because the
exact public package closure could not be installed in this execution
environment.

## Files

- `source-provenance.txt`: independently verified immutable checkout/tag and
  the empty research manifests.
- `launcher-source.txt`: authoritative source excerpts with original line
  numbers for profile, patch, and Web flag semantics.
- `environment.txt`: runtime/browser availability and isolation facts.
- `registry-probe.log`: bounded DNS/HTTPS probe (`curl` exit 6).
- `npm-ping.log`: npm 11 verbose retry ending in `ENOTFOUND` (the outer timeout
  stopped the long configured retry delay).
- `install-and-gates.txt`: exact install attempt and gate outcomes.
- `browser-tooling-preflight.txt`: real Chromium launch followed by intentional
  connection refusal at an unused loopback port; tooling proof only.
- `targeted-proofs.txt`: repository proof output after the integration edits.
- `root-npm-test.log`: initial full-suite attempt blocked on absent root dependencies.
- `recovery-verification.txt`: subsequent blank-session fix verification, including
  package proofs, expected public-type exit 2, fresh DNS block, disposable
  preparation, and a full root-suite pass via a temporary read-only dependency
  link that was removed afterward. This is repository evidence, not a live-host
  upgrade.
- `status.json`: machine-readable pass/block matrix for the original live attempt;
  live statuses remain unchanged by the recovery repository rerun.
- `manifest.sha256`: hashes for this evidence set (excluding itself).

There are no host logs or screenshots because claiming them without a booted
stock host would be false. The repeatable scripts write those artifacts into a
disposable run root once the registry prerequisite is restored.
