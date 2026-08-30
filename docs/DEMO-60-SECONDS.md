# TruthLease in 60 seconds

Target runtime: 58 seconds. This script is for one qualifying, traceable run. Show a claim only while its evidence from that same run is visible. The retailer state is an owned synthetic demo, not a production retailer.

## Screen and voiceover

| Time | Screen / presenter action | Voiceover |
| --- | --- | --- |
| 0:00-0:08 | Open case `TL-042`. Hold on **Valid when recorded** and the initial `active` lease / `published` listing. | "This listing was safe when the agent published it. TruthLease recorded the fact that justified the action - and what would invalidate it later." |
| 0:08-0:18 | Move to **Official fact changed**. Show the current Bright Data trace and canonical `cpsc.gov` receipt, including retrieval time and content hash. | "Then the facts changed. Bright Data Web MCP retrieved the official CPSC recall, and TruthLease bound that evidence to this run." |
| 0:18-0:29 | Reveal the native TrueForge sandbox result. Point to **1 Exact match** and the two **Excluded near match** rows. | "TrueForge's sandbox checks item and batch together. One listing matches both. Two look similar, but each misses a required identifier, so they stay out." |
| 0:29-0:40 | Stop on **Human control point / 0 writes**. Show the immutable patch arguments; do not approve until this beat lands. Then approve inside TrueForge's native UI. | "Investigation is not authority. Execution pauses with zero writes until a person approves this exact patch inside TrueForge." |
| 0:40-0:50 | Show the patch receipt and before / after state: lease `active -> revoked`, exact listing `published -> unpublished`, version `7 -> 8`. | "Approval releases one atomic, version-checked correction: revoke this lease and unpublish only the exact listing." |
| 0:50-0:58 | Finish on **Fresh persisted-state re-read**. Point to the exact listing changed and both excluded listings unchanged. | "TruthLease reads stored state again to prove the correction persisted and the near matches were untouched. When truth changes, the smallest accountable repair follows." |

## Recording rules

- Use a current Bright Data retrieval, native TrueForge sandbox event, native approval, local MCP patch receipt, and later persisted-state re-read from one traceable run.
- Keep the browser case view read-only. Approval happens only in TrueForge; mutation happens only through the local TruthLease MCP.
- Do not call a fixture, code path, empty hosted ledger, or UI walkthrough a live completed run.
- Keep the CPSC URL, exact item and batch, approval arguments, state transition, and excluded listings legible long enough to verify.

## If live approval stalls

Stay on **Human control point / 0 writes** and say: "The approval has not resolved, so TruthLease has made no change." Do not jump to a success screen or claim mutation or verification.

For a recorded submission, you may cut only to a clearly labeled recording of a previously completed **qualifying run** whose Bright Data trace, TrueForge events, approval arguments, mutation receipt, and verification receipt are preserved and traceable together. If that evidence is unavailable, end at the hold state; the fail-closed pause is the truthful result.
