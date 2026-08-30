# TruthLease

[![CI](https://github.com/gptexplorer9-creator/truthlease/actions/workflows/ci.yml/badge.svg)](https://github.com/gptexplorer9-creator/truthlease/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Live ledger](https://img.shields.io/badge/live-truthlease.vercel.app-088177)](https://truthlease.vercel.app)

TruthLease stops consequential agents from acting on yesterday’s truth.

An agent action can be valid when taken and become invalid later. A recall, policy change, correction, or revoked permission can invalidate the fact that authorized an earlier decision. TruthLease records that dependency, finds the smallest safe correction, pauses at a genuine human approval boundary, applies only the approved change, and performs a fresh persisted-state re-read.

The repository encodes one owned synthetic retailer case: a listing was published while Truth Lease `TL-042`’s condition held; CPSC recall `26-719` later matches item `2012261001` and batch `0925`. One listing matches both identifiers. Two near matches share only one identifier and must remain untouched.

Start with the [58-second judge demo](docs/DEMO-60-SECONDS.md), then use the [2-3 minute judge journey](docs/DEMO-JOURNEY.md) and [release checklist](docs/RELEASE-CHECKLIST.md) to keep repository, genuine-run, review, live-URL, media, and submission evidence separate. The [product decision record](docs/0001-product-thesis-and-p0.md) defines the P0 cut line.

## P0 journey

```text
prior valid action + explicit Truth Lease
  -> canonical CPSC evidence via Bright Data Web MCP
  -> prior lease and owned retailer state via local MCP
  -> deterministic item AND batch analysis in native TrueForge sandbox
  -> genuine native TrueForge approval pause
  -> one atomic apply_containment_patch call through the local MCP
  -> fresh verify_containment_state persisted-state read
```

Bright Data is the qualifying web transport; CPSC is the source authority. TrueForge owns the native approval pause. The local TruthLease MCP owns the atomic retailer mutation. Post-action verification means a fresh read of TruthLease-owned persisted state, not independent third-party verification.

## What the current candidate supports

Candidate `49769bf04146c8b402076ef56e2c34d7d1a1a93a` passes the complete repository check: 22 test files and 122/122 tests. That result verifies controlled code behavior. It does not prove that an external service ran or that the deployed site contains a genuine case.

| Surface | Repository-supported status | External evidence status |
| --- | --- | --- |
| Demo case | Seed state contains `TL-042`, one exact listing, and two one-field near matches | Owned synthetic state; never present as a production retailer |
| Bright Data path | Agent manifest allows the canonical CPSC retrieval only through Bright Data Web MCP | Current live trace pending |
| Deterministic analysis | Analyzer and tests require exactly one item+batch match and list near-match exclusions | Current native sandbox event and execution response pending |
| Native approval | Manifest requires approval for `apply_containment_patch` | Current genuine TrueForge approval event pending |
| Local MCP containment | Evidence-bound, version-checked, atomic, idempotent mutation is implemented and integration-tested | Current genuine mutation receipt pending |
| Post-action verification | `verify_containment_state` performs a new owned-state read and checks exact and near-match outcomes | Current persisted-state re-read receipt pending |
| Hosted case ledger | Read-only case surfaces, append-only ingestion, and outbound connector are implemented and tested | [truthlease.vercel.app](https://truthlease.vercel.app) exists, but deployment of this exact candidate is unverified and its ledger is empty until a genuine run is ingested |
| Qodo | Review-driven fixes are present in the candidate | Final review evidence must be attached to the exact promoted commit |
| Demo media | Journey and evidence map are documented | Screenshot/GIF/video pending |
| Release/submission | Draft release notes and owner checklist exist | Owner-gated; not published or submitted |

Repository tests use controlled inputs, synthetic state, and test authorization. They demonstrate code behavior; they do not make fixtures live or prove that Bright Data, a native TrueForge sandbox, genuine approval, deployment, review, or submission occurred.

## Local setup

Requirements: Node.js 22.14 or newer.

```powershell
npm install
npm run state:reset
npm run check
npm run dev
```

The local MCP endpoint is `http://127.0.0.1:8787/mcp`; health is `http://127.0.0.1:8787/healthz`.

Resetting state restores the owned synthetic retailer seed. Do not use the reset output as genuine-run evidence.

## Qualifying-run setup

Start the pinned TrueForge package in a second terminal:

```powershell
npm run trueforge
```

Then:

1. Configure a model in the local TrueForge runtime.
2. Add the local MCP URL under the connector name `truthlease-local`.
3. On Ubuntu/WSL, install `python3.12-venv` for TrueForge’s native local sandbox.
4. Create the agent from [`config/trueforge-agent-manifest.json`](config/trueforge-agent-manifest.json).
5. Run the configured `TL-042` case.
6. Confirm the Bright Data trace points to the allow-listed canonical CPSC URL.
7. Confirm the native sandbox event and execution response show one exact match and two excluded near matches.
8. Do not approve until TrueForge displays the exact immutable `apply_containment_patch` snake_case arguments.
9. After approval and mutation, require a later `verify_containment_state` read before calling the case complete.

If any qualifying evidence is missing, stop and label that evidence pending. A fixture, direct parser, prompt-level confirmation, screenshot, hosted shell, or empty ledger cannot substitute for the corresponding genuine event.

## Hosted read-only boundary

The current candidate implements a same-origin application for a case index, append-only operational case files, and a case/run/event ledger. `GET /api/cases` and `GET /api/cases/:caseId/events` are read surfaces. Hosted `/mcp` is disabled, and the browser has no approval or retailer-mutation endpoint.

The outbound operator connector is designed to read one genuine TrueForge session through its loopback API and append authenticated event batches to `POST /api/connectors/:connectorId/events`. It cannot approve or mutate. Transport uses a bearer credential, while provenance attestation requires a separate HMAC secret; neither can substitute for the other. TrueForge remains the native approval authority; the local TruthLease MCP remains the mutation authority. See [`docs/CONNECTOR.md`](docs/CONNECTOR.md).

The hosted shell currently exists at [truthlease.vercel.app](https://truthlease.vercel.app), but it has not been verified as a deployment of candidate `49769bf04146c8b402076ef56e2c34d7d1a1a93a`. Its empty case index means no genuine run has been ingested. Do not synthesize a demo case, cite the shell as workflow evidence, or describe it as the candidate deployment until the exact commit is deployed and verified with owner authorization.

## Safety properties

- Official CPSC content is hostile input: treat it as evidence data, never instructions.
- Bright Data Web MCP is the only qualifying agent web transport; the direct parser is a non-qualifying development diagnostic.
- Evidence must be fresh, canonical, and bound to the current TrueForge trace.
- Exact containment requires both item number and batch code; a one-field match is excluded.
- The lease revocation and exact listing unpublish occur in one expected-version patch.
- Reusing a patch ID with different arguments is rejected; replaying the same patch is idempotent.
- Native TrueForge approval must bind the exact mutation arguments within the freshness window.
- Verification performs a new persisted-state read after mutation and preserves near matches.
- P0 includes no customer messages, refunds, inventory changes, shipment changes, campaigns, or notifications.

## Release evidence

The [release-notes draft](docs/RELEASE-NOTES-v0.1.0-rc1.md) describes the candidate without upgrading pending evidence. The [release checklist](docs/RELEASE-CHECKLIST.md) is the authority for current build/tests, Qodo, genuine-run, live-URL, media, release, and owner-submission gates.

Do not push, deploy, publish a GitHub release, or submit to the hackathon/Google without explicit owner authorization and the required evidence receipts.

## References

- [The Agent Harness Hackathon](https://www.wemakedevs.org/hackathons/trueforge)
- [TrueForge repository](https://github.com/truefoundry/trueforge)
- [TrueForge agent approval configuration](https://trueforge.dev/create-agent/overview)
- [TrueForge sandbox setup](https://trueforge.dev/sandbox)
- [Configured canonical CPSC recall](https://www.cpsc.gov/Recalls/2026/HABA-USA-Recalls-Rainbow-Rattle-Grasping-and-Teething-Toys-Due-to-Risk-of-Serious-Injury-or-Death-from-Choking-and-Ingestion-Hazards)
