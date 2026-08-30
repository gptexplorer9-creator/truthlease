# TruthLease demo-release checklist

Candidate source: working tree on `feat/run-now-loop`; final release commit pending. Replace this line with the exact promoted commit after review.

This checklist separates repository verification from external evidence. A checked repository item does not upgrade a pending live, review, media, release, or submission claim.

## 1. Repository candidate

- [x] `npm run check` passes: 24 test files, 136/136 tests (2026-08-29).
- [x] Documentation checks pass: local Markdown links resolve, the Mermaid sequence is present, and no invalid control bytes are present (2026-08-29).
- [x] Working diff includes the reviewed Run Now, trust-gate, WSL relay/setup, UI, test, and documentation changes; no credential, private runtime state, or TrueForge database is included.
- [x] Release-notes draft exists at [`RELEASE-NOTES-v0.1.0-rc1.md`](RELEASE-NOTES-v0.1.0-rc1.md).
- [x] Judge journey exists at [`DEMO-JOURNEY.md`](DEMO-JOURNEY.md) and targets 2–3 minutes.

## 2. External review and genuine-run evidence

- [ ] **Qodo review:** attach the final review result to the exact promoted commit. Review-driven fixes are in the candidate, but earlier review evidence does not automatically cover a later docs or release commit.
- [x] **Bright Data:** session `01m18mskn7dvwx7e28ywxm6h8g` used the allow-listed canonical CPSC path and exact empty-scrape fallback.
- [x] **Native TrueForge sandbox:** the same session retained a successful native local Bubblewrap sandbox event and execution response.
- [x] **Deterministic proof:** the same session showed one exact item+batch match and both one-field near matches excluded.
- [x] **Native TrueForge approval:** the same session retained `tool.approval_required` plus the owner's resolution for the unchanged `apply_containment_patch` arguments.
- [x] **Local MCP mutation:** durable receipt `AR-912d18b1-43b0-4c39-9641-489be954b2b3` records version `7 -> 8`, lease revocation, and only `LISTING-1001` unpublished.
- [x] **Persisted-state re-read:** the later `verify_containment_state` result returned `VERIFIED` and both near matches remained published.

Genuine-run status: **passed**. See [`evidence/GENUINE-RUN-2026-08-30.md`](evidence/GENUINE-RUN-2026-08-30.md). The controlled retailer is synthetic, but the external evidence, sandbox, approval, mutation, and verification sequence was genuine.

## 3. Live surface and media

- [ ] **Candidate deployment:** [truthlease.vercel.app](https://truthlease.vercel.app) exists, but deployment of the final release commit has not been verified. Deploy only with owner authorization, then record the exact commit, timestamp, and read-only hosted-boundary check.
- [x] **Current hosted data boundary:** the deployed case ledger is empty until a genuine run is ingested; hosted `/mcp` is disabled. An empty shell is not demo evidence.
- [ ] **Screenshot set:** capture the prior lease, canonical evidence, deterministic proof, native approval pause, patch receipt, and persisted-state re-read from one traceable run.
- [ ] **GIF:** optional; if used, preserve evidence labels and do not skip the genuine approval pause.
- [ ] **2–3 minute video:** record the journey in [`DEMO-JOURNEY.md`](DEMO-JOURNEY.md), show the evidence boundaries, and avoid presenting fixtures or historical captures as live.
- [ ] Record media filenames/URLs and capture timestamps in the owner’s submission record.

Screenshot/GIF/video status: **pending capture**.

## 4. Release notes and owner gate

- [x] Release-notes draft describes behavior supported by the working candidate and labels pending release gates.
- [x] Record current validation results: complete check passed with 24 test files and 136/136 tests; the genuine run verifier passed every check.
- [ ] Add the final candidate commit and external evidence links only after they exist.
- [ ] Owner reviews the exact repository, live URL, genuine-run receipt, Qodo evidence, media, and release notes as one candidate set.
- [ ] Owner explicitly authorizes any push, deployment, GitHub release, or hackathon/Google submission.
- [ ] Owner performs or separately delegates the submission and records its receipt.

Submission status: **owner-gated; not authorized or performed by this documentation task**.

## Go/no-go rule

The repository can be documentation-ready while the submission remains **no-go**. Do not publish or submit until every required external-evidence item is checked against the same final candidate and the owner explicitly authorizes the action.
