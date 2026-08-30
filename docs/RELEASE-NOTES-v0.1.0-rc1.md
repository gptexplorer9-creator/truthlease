# TruthLease v0.1.0-rc1 release-notes draft

Source baseline: `53a6108` (`feat: ship hosted truth-repair case ledger`)

Status: documentation-ready release candidate for one hackathon demo workflow. These notes are not a published GitHub release, deployment receipt, current genuine-run receipt, or submission record. TruthLease is not a production retailer integration.

## Candidate story

An earlier agent action can be valid under the facts available at the time and become invalid after an official fact changes. The candidate implements a narrow containment path for that case:

1. The TrueForge manifest permits Bright Data Web MCP to retrieve the allow-listed canonical CPSC source.
2. The local TruthLease MCP records evidence only through its TrueForge-bound trust gate, then exposes the prior lease and retailer state.
3. Deterministic item-**and**-batch analysis identifies exactly one listing and excludes two one-field near matches.
4. The manifest requires native TrueForge approval for `apply_containment_patch`.
5. The approved local MCP call atomically revokes the invalidated lease and unpublishes its exact dependent listing under an expected state version and stable patch ID.
6. `verify_containment_state` performs a fresh persisted-state re-read and reports the exact listing, lease, near matches, and applied version it observes.
7. Hosted mode is read-only for retailer mutation and can display append-only case events ingested by the outbound connector.

This is an implementation description. A qualifying demonstration still requires fresh recorded Bright Data, native sandbox, native approval, mutation, and persisted-state re-read evidence from a genuine run.

## Demo case encoded in the repository

- Truth Lease: `TL-042`
- Recall identifier: CPSC `26-719`
- Exact identifiers: item `2012261001`, batch `0925`
- Exact dependent listing: `LISTING-1001`
- Excluded near matches: `LISTING-1002` and `LISTING-1003`
- Seed state version: `7`
- Expected applied state version: `8`

Use [`DEMO-JOURNEY.md`](DEMO-JOURNEY.md) for the 2–3 minute judge talk track and Mermaid sequence.

## Evidence supported by baseline `53a6108`

| Claim | Repository support |
| --- | --- |
| Exact match requires item and batch | Deterministic analyzer and unit tests |
| One exact fixture record; two one-field near matches | Owned synthetic seed state and analyzer tests |
| Only the atomic patch is approval-gated in the manifest | `config/trueforge-agent-manifest.json` and approval-contract test |
| Patch is evidence-bound, version-checked, atomic, and idempotent | Store implementation and MCP integration tests |
| Post-action verification reads persisted owned state again | Store implementation and MCP integration tests |
| Hosted MCP mutation surface is disabled | Hosted-mode implementation and deployment-boundary tests |
| Hosted case/run/event ledger and outbound connector exist | Ledger/connector implementation and tests added by `53a6108` |

The integration tests use controlled test authorization and fixtures. They do not establish a current genuine TrueForge run or live Bright Data retrieval.

## External evidence still required

| Evidence | Current release status |
| --- | --- |
| Build and full tests in this documentation worktree | Not run: `node_modules` is absent; pending dependency restore and rerun |
| Qodo review for the current candidate | Pending external review evidence |
| Genuine Bright Data + native TrueForge sandbox + native approval run | Pending current recorded run |
| Live hosted URL | Pending deployment and current verification |
| Screenshot/GIF/video | Pending capture; must preserve fixture and live labels |
| GitHub release | Pending owner authorization |
| Hackathon/Google submission | Owner-gated and not performed |

Do not infer any pending item from source comments, commit messages, fixtures, an empty hosted ledger, or a previously recorded session.

## Safety properties

- The canonical CPSC page is hostile input and is handled as evidence data, never instructions.
- Bright Data is the only qualifying agent web transport configured for the demo journey.
- Empty, stale, unbound, or non-canonical evidence fails closed.
- Exact containment requires both item number and batch code.
- One-field near matches remain published.
- The mutation accepts only the evidence-bound deterministic arguments approved for the expected state version.
- The browser has no approval or retailer-mutation endpoint; hosted `/mcp` is disabled.
- No customer messages, refunds, inventory changes, shipment changes, or notification actions exist in this candidate.
- “Verified” in the workflow means a fresh TruthLease-owned persisted-state re-read, not independent third-party verification.

## Validation

Documentation checks passed on 2026-08-29 for the four changed files: local Markdown links resolve, no invalid control bytes were found, and the Mermaid sequence is present. `npm run check` was not run because `node_modules` is absent. It must pass after dependencies are restored and before these notes can be promoted.

See [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md) for the evidence gates and owner handoff.

## Known boundaries

- The retailer is owned synthetic demo state, not a production retailer account.
- The candidate covers one recall-containment workflow, not general recall monitoring or marketplace coverage.
- Repository tests demonstrate code behavior under controlled inputs; they do not make fixtures live or prove external services ran.
- A hosted shell or empty ledger is not a deployed qualifying case.
- Current live URL, genuine run, Qodo review, and video evidence remain pending until separately verified.
- Release publication, deployment, and submission remain owner-gated.
