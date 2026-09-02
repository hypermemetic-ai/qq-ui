# Alpha.4 stock-Web architecture A spike report

## Decision under test

Use stock DSH Web as the application root and add bounded QQ presentation
contributions. `qq-models` supplies external model routes as a separate Bundle.
The QQ UI package remains a plain dependency plus one launch-time patch row.
Architecture B remains unavailable because alpha.4 does not publish a supported
stock conversation/layout island. Architecture C still assigns too much
interaction and presentation ownership to QQ.

This recommendation is provisional. Root `DESIGN.md` is intentionally unchanged
until the complete credentialed live matrix passes and the operator accepts the
recommendation. No production cutover is authorized.

## Evidence classification

### Source facts — PASS

The immutable research answer has SHA-256
`58b053ac0cc884cb6e5643cfb6bfae315e09d03ca42d9c5829782d6a5abb4a87`.
The exact DSH tag/commit is
`dsh-v0.1.2-alpha.4` / `4e84901e6471b79ec0338099867ebb4606d12bb5`.
A source walk yields 252 DSH package names at exact alpha.4 and the set digest
recorded in README.

Alpha.4 retains the public contribution surfaces used here and improves keyed
slot/chat sources plus stock Web rendering. It does **not** add a supported
conversation/layout island. The Web base composition enables `web_fetch`, so
the live gate uses an explicit no-tools prompt and rejects any `tool/call`.

Research config evidence proves the stock Bundle roster plus additive rows; it
does not, by itself, prove every stock runtime behavior. Selected retained npm
manifests prove their own export maps; this report does not generalize that fact
to every registry manifest. Qwen reports a missing host key; it is not described
as an adapter registered by `qq-models` or as literally “logged out.”

### Repository proof — PASS

- New sibling package created; alpha.3 source and evidence are untouched.
- Package/plugin/visible labels target alpha.4.
- 252 overrides are generated and digest-checked from the exact tag.
- Direct/peer DSH versions are exact `0.1.2-alpha.4`.
- Removed source-set packages are absent; the new experimental Python runtime
  package is present.
- Lockfile v3 is retained. Lock SHA-256 at preparation time:
  `c7365ec5a9b2fbbc887ad97b4fb8fc88399d7380dffe720494046233ae2cf23d`.
- `npm ci --ignore-scripts` installed 96 package locations.
- Closure audit found 61 lock and 61 installed DSH locations, all alpha.4.
- Build and strict TypeScript (`skipLibCheck: false`) pass.
- Lifecycle activation → disposal → reapplication has no stale registrations.
- Bundle proof confirms one client factory and no QQ-owned server/transport.
- Public import path guard rejects private `/src` and removed `/invariant`
  companion imports.
- Harness proofs cover environment/path/port guards, clean-pack provenance,
  incompatible-model rejection, composition, HMR restoration, event extraction,
  no-tools rejection, and process-group cleanup semantics.

These tests include synthetic fixtures only where they are explicitly testing
harness rejection/acceptance logic. They are not presented as live stock-Web
screenshots or model evidence.

### Tooling preflight — PASS

Public npm metadata for exact alpha.4 is reachable from a fresh allowlisted
HOME/cache. A compatible Playwright installation and Chromium executable were
located, but were not used against a product host in this blocked preparation
phase. The exact host lock retained by research identifies five install-hook
packages; the generated runbook installs with scripts disabled, emits their
manifests, and permits only a named rebuild after review.

### External prerequisite — BLOCKED

The inspected clean `@hypermemetic-ai/qq-models` tree is commit
`6dc6fb1a6d76aa0c83edfc8326481760e0b1aac2`. Its Grok and Codex adapters are
plain objects without public alpha.4 defaults:

- `imageRequestPricing(provider, model)`;
- `prepareCall(provider, model, signal)`.

Its manifest also lacks exact dev-only DSH/Cordis integration coverage. The new
harness rejects such a tarball and carries no shim. The fix belongs in the
`qq-models` repository and is being handled separately.

### Live execution — NOT RUN / BLOCKED

No DSH host was started by this implementation phase, no authorization was
attempted, and no browser product screenshot or Session event is claimed.
Because no task host was started, host cleanup is not applicable to this phase;
the supervisor’s cleanup behavior is repository-tested and remains a required
live assertion.

## Gate matrix

| Gate | Status | Basis / blocker |
|---|---|---|
| Exact alpha.4 tag/commit | PASS | immutable source provenance |
| 252 generated overrides | PASS | count + name/version digest |
| Exact package lock | PASS | lockfile v3; exact install/audit |
| Strict public type check | PASS | real TypeScript, `skipLibCheck: false` |
| Public path guard | PASS | ordinary roots + documented `./client`/`./types` |
| Lifecycle/bundle | PASS | executable repository proofs |
| Clean packed input contract | PASS | clean/dirty fixtures + digest provenance |
| Reject pre-fix qq-models | PASS | pack verifier negative proof |
| Isolated environment/path/3082 guards | PASS | executable harness proofs |
| Stock/additive/patched config verifier | PASS (tooling) | fixture exercises exact roster/row rules |
| Exact alpha.4 stock host install | BLOCKED live | wait for landed clean qq-models pack |
| Real CLI/profile/config dump | BLOCKED live | same prerequisite |
| Fresh Grok device login | BLOCKED | begins only after noncredential live gates |
| Live boot/client route rows | BLOCKED | no product host run |
| Blank Session UI | BLOCKED | no product browser run |
| Successful streamed model turn | BLOCKED | no fixed models pack/credentialed run |
| Persisted route/terminal/no-tools facts | BLOCKED | no real Session; extractor logic only tested |
| Active Session QQ/stock UI | BLOCKED | no rendered Send |
| Strong live HMR | BLOCKED | no product browser run |
| Desktop/mobile screenshots/a11y | BLOCKED | no product browser run |
| Stock Settings/history/reconnect | BLOCKED | no product browser run |
| Owned host child/group cleanup | BLOCKED live | supervisor contract tested; no host started |
| Legacy `/qq` not interacted with | PASS (no connection/change) | boolean known-PID/listener existence was observed in preflight and disclosed; no metadata/payload read or signal |
| Root `DESIGN.md` unchanged | PASS | intentionally not modified |

## Live evidence contract after prerequisite landing

The generated run uses fresh task-owned auth and browser state. It installs the
stock profile, packed `qq-models`, and packed UI package; records stock,
additive, and final config separately; selects the nonsecret
`xai-auth/grok-4.6` default; and then stops for operator device-code approval.
No raw key is requested.

The browser must create a real blank Session through stock controls, prove the
blank visibility rules, submit a cryptographic no-tools nonce through the stock
composer, and wait for rendered streamed text before HMR. The final PASS comes
from canonical task-owned Session persistence—not from DOM alone—and requires
exact route, stream, nonce, terminal, and zero-tool facts.

The host supervisor owns one new process group only. It never inspects, signals,
or reconfigures legacy `/qq`. It rejects port 3082, passes the tokenized launch
URL only over stdin, redacts it before logs reach disk, sends signals only to
the negative PGID it created, awaits the actual child, and requires the group to
be absent afterward.

## Recommendation checkpoint

Do not revise root `DESIGN.md` yet. Land and independently QA the two-method
`qq-models` compatibility fix first, then run this package’s complete isolated
matrix. Present the retained PASS evidence to the operator only after the real
turn and cleanup pass; ask separately whether the architecture recommendation
should become root design.
