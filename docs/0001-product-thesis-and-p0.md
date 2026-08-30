# Decision 0001: product thesis and P0 cut line

Date: 2026-08-29

Status: locked for the hackathon vertical slice unless a verified implementation blocker appears.

## Exceptional product thesis

TruthLease is the validity-and-compensation layer for agents acting in a changing world.

Observability answers what an agent did. A monitor reports that the world changed. TruthLease answers a different operational question: which prior action is no longer valid because its supporting truth changed, what downstream state depends on it, and what minimum-safe transaction must be approved and verified now?

The reusable product object is a truth lease: the decision, supporting claims, source provenance, validity conditions, dependent actions, approval boundary, compensating transaction, and verification requirements recorded together.

## Hackathon wedge

Contain one exact retailer listing after an official consumer-product recall changes the fact that authorized its publication.

The live evidence is the CPSC recall `26-719` for HABA item `2012261001`, batch `0925`. The owned retailer contains:

- One published exact match.
- One same-item/different-batch near match.
- One different-item/same-batch near match.
- One active Truth Lease that authorized the exact listing when no matching recall was known.

## P0 acceptance contract

P0 is complete only when one recorded TrueForge session proves all five transitions:

1. Bright Data `scrape_as_markdown` retrieves the official CPSC page and `record_recall_evidence` persists a server-hashed receipt.
2. TrueForge creates and runs matching code in its native local Bubblewrap sandbox; its output identifies one exact match and two exclusions.
3. The session reaches `tool.approval_required` for `apply_containment_patch`, exposing exact snake_case arguments before execution.
4. Allowing that call atomically revokes the lease and changes only the exact listing from `published: true` to `published: false`.
5. `verify_containment_state` re-reads the state, proves the exact listing is unpublished, and proves both near matches are untouched.

Unit tests, direct MCP calls, screenshots, prompt text, or a simulated confirmation cannot independently satisfy steps 2 or 3.

## Cut line

Do not add inventory quarantine, shipment holds, campaigns, customer notifications, multiple recalls, subagents, custom UI, or earned autonomy until the five-step P0 evidence exists.

## Event-aligned implementation decisions

- Bright Data is the qualifying resilient web retrieval path; CPSC remains the source authority.
- Qodo review is mandatory evidence before submission.
- The verified TrueForge package supports a native local Bubblewrap sandbox, so Daytona is not required.
- The project is built during the event and the qualifying proof must come from one recorded session.

## Failure rule

If live CPSC retrieval is temporarily blocked, fail closed and display the source error. Do not silently substitute cached evidence during the qualifying demo. A separately labelled fixture mode may support tests, but fixture output is never live evidence.
