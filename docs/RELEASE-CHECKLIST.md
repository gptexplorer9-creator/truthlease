# TruthLease demo-release checklist

Candidate source: `5a08272` on `feat/p0-vertical-slice`. Use this hash only for the checks recorded below; replace it with the exact promoted commit if the candidate advances.

This checklist separates repository verification from external evidence. A checked repository item does not upgrade a pending live, review, media, release, or submission claim.

## 1. Repository candidate

- [x] `npm run check` passes for candidate `5a08272`: 22 test files, 107 tests (2026-08-29).
- [x] Documentation checks pass: local Markdown links resolve, the Mermaid sequence is present, and no invalid control bytes are present (2026-08-29).
- [x] Final diff contains documentation only; no product source, UI, backend, configuration, test, fixture, credential, or runtime-state changes.
- [x] Release-notes draft exists at [`RELEASE-NOTES-v0.1.0-rc1.md`](RELEASE-NOTES-v0.1.0-rc1.md).
- [x] Judge journey exists at [`DEMO-JOURNEY.md`](DEMO-JOURNEY.md) and targets 2–3 minutes.

## 2. External review and genuine-run evidence

- [ ] **Qodo review:** attach the final review result to the exact promoted commit. Review-driven fixes are in the candidate, but earlier review evidence does not automatically cover a later docs or release commit.
- [ ] **Bright Data:** record the current Web MCP trace retrieving the allow-listed canonical CPSC evidence.
- [ ] **Native TrueForge sandbox:** retain the successful native local Bubblewrap sandbox event and its execution response for the same run.
- [ ] **Deterministic proof:** show one exact item+batch match and both one-field near matches excluded.
- [ ] **Native TrueForge approval:** retain `tool.approval_required` plus the human resolution for the exact unchanged `apply_containment_patch` arguments.
- [ ] **Local MCP mutation:** retain the atomic patch receipt showing version `7 -> 8`, lease revocation, and only `LISTING-1001` unpublished.
- [ ] **Persisted-state re-read:** retain the later `verify_containment_state` result showing both near matches still published. Label this an owned persisted-state re-read, not independent verification.

Genuine-run status: **pending current recorded run**. Fixtures and controlled tests do not satisfy these seven items.

## 3. Live surface and media

- [ ] **Candidate deployment:** [truthlease.vercel.app](https://truthlease.vercel.app) exists, but the current deployment predates `5a08272`. Deploy only with owner authorization, then record the exact commit, timestamp, and read-only hosted-boundary check.
- [x] **Current hosted data boundary:** the deployed case ledger is empty until a genuine run is ingested; hosted `/mcp` is disabled. An empty shell is not demo evidence.
- [ ] **Screenshot set:** capture the prior lease, canonical evidence, deterministic proof, native approval pause, patch receipt, and persisted-state re-read from one traceable run.
- [ ] **GIF:** optional; if used, preserve evidence labels and do not skip the genuine approval pause.
- [ ] **2–3 minute video:** record the journey in [`DEMO-JOURNEY.md`](DEMO-JOURNEY.md), show the evidence boundaries, and avoid presenting fixtures or historical captures as live.
- [ ] Record media filenames/URLs and capture timestamps in the owner’s submission record.

Screenshot/GIF/video status: **pending capture**.

## 4. Release notes and owner gate

- [x] Release-notes draft describes only behavior supported by candidate `5a08272`.
- [x] Record current validation results without upgrading pending external evidence: complete check passed with 22 test files and 107 tests.
- [ ] Add the final candidate commit and external evidence links only after they exist.
- [ ] Owner reviews the exact repository, live URL, genuine-run receipt, Qodo evidence, media, and release notes as one candidate set.
- [ ] Owner explicitly authorizes any push, deployment, GitHub release, or hackathon/Google submission.
- [ ] Owner performs or separately delegates the submission and records its receipt.

Submission status: **owner-gated; not authorized or performed by this documentation task**.

## Go/no-go rule

The repository can be documentation-ready while the submission remains **no-go**. Do not publish or submit until every required external-evidence item is checked against the same final candidate and the owner explicitly authorizes the action.
