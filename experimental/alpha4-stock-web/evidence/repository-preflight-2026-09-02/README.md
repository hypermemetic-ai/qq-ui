# Alpha.4 repository preflight — 2026-09-02

This is preparation evidence, not a live stock-Web pass.

- **PASS:** exact source provenance; 252 generated overrides; exact lock/install
  closure; build; strict public type check; lifecycle/bundle; packed-input,
  environment/path/port, HMR-artifact, persisted-event, and supervisor harness
  proofs.
- **BLOCKED:** the clean inspected qq-models commit lacks the required alpha.4
  defaults/integration suite, so no task host, device login, product browser,
  HMR session, or real model turn was executed.
- **Tooling blocked:** the broad root historical suite cannot start because this
  virtual checkout has neither root node_modules nor its file:../qq-core path.
  The isolated alpha.4 package suite passes independently.
- **Safety disclosure:** no legacy service payload, deployment, profile, origin,
  or process metadata was read and nothing was connected, signalled, or changed.
  Early tooling did observe only boolean existence of the already-known legacy
  PID/disposed PID and the 3082 listener; this is retained in `safety-scope.json`
  rather than hidden. No auth material was read/copied; no key/device code/token
  was requested or retained; root DESIGN.md is unchanged.

`status.json` is authoritative for the gate classification. Synthetic fixtures
in repository proofs test harness behavior only and are not product evidence.
