# TruthLease demo journey

## The use case

A marketplace has already published a HABA Rainbow Rattle listing. That decision is represented by Truth Lease `TL-042`: the listing may remain active only while no official recall matches both item `2012261001` and batch `0925`.

CPSC recall `26-719` changes that fact.

The product-safety operator's job is not to ask an agent to "handle the recall." The job is narrower and harder:

1. establish that the new evidence is official and fresh;
2. prove that exactly one listing matches both identifiers;
3. keep two near matches out of the action;
4. review the exact proposed mutation;
5. approve or deny it in TrueForge;
6. confirm the persisted outcome after the action.

**Sticky line:** The agent may investigate. It cannot act until a person approves the exact call.

## Five beats

| Beat | Operator question | What the product shows | Proof to point at |
| --- | --- | --- | --- |
| 1. A prior decision is now at risk | Why is this listing live? | Lease `TL-042`, active listing `LISTING-1001`, item and batch identifiers | The decision existed before the incident and has an explicit validity condition |
| 2. An external fact changes | Is the recall real and current? | Official CPSC authority, Bright Data transport, retrieval time, canonical URL, content hash | Evidence is trace-bound before TruthLease records a Bright Data receipt |
| 3. The agent narrows the blast radius | Which records should change? | One exact item-and-batch match and two excluded one-field near matches; TrueForge sandbox output | `AND` matching prevents a broad title or SKU recall from touching adjacent inventory |
| 4. A person owns the consequential decision | What exactly will happen if I approve? | Native TrueForge pause and immutable `apply_containment_patch` arguments | The browser has no mutation control; the server requires the exact approved TrueForge call |
| 5. The system proves the outcome | Did the intended state actually persist? | Lease revoked, exact listing unpublished, near matches still published, state version `7 -> 8` | A fresh persisted-state read, not a tool-success message, closes the case |

**Closing line:** The demo does not end when a tool says "success." It ends when a fresh read proves what changed - and what did not.

## Three-minute talk track

### 0:00-0:25  -  Start with the consequence

**Show:** the case header and prior state.

**Say:** "This toy listing is already live. Its publishing decision is leased to one condition: no official recall may match item 2012261001 and batch 0925. A new CPSC recall now challenges that condition."

**Do not say:** that TruthLease continuously monitors every retailer or recall. This demo begins with one live evidence-driven case.

### 0:25-0:55  -  Establish the new fact

**Show:** Official evidence.

**Say:** "The agent retrieves the canonical CPSC result through Bright Data. TruthLease binds the exact response, URL, identifiers, and retrieval time to the TrueForge session before it will label the receipt as Bright Data evidence."

**Point at:** authority, transport, source URL, retrieval time, and hash.

### 0:55-1:25  -  Prove the exact target

**Show:** Deterministic proof.

**Say:** "A title match is not enough. The sandbox applies an AND rule across item and batch. One listing matches both. Two nearby records match only one field, so they are explicitly excluded."

**Point at:** `LISTING-1001` as exact; `LISTING-1002` and `LISTING-1003` as exclusions.

### 1:25-2:00  -  Stop at the human boundary

**Show:** Native approval.

**Say:** "This is the product's control point. The agent has done the investigation, but no retailer state has changed. The operator sees one immutable, version-checked patch and chooses inside TrueForge - not in this browser."

**Pause:** let the genuine approval state remain visible before approving.

**Point at:** listing ID, lease ID, expected version, evidence receipt, analysis hash, and reason.

### 2:00-2:30  -  Apply one bounded mutation

**Show:** Atomic patch.

**Say:** "The approved backend action revokes the invalidated lease and unpublishes only its exact dependent listing in one atomic write. Changed arguments, stale versions, and duplicate non-identical patch IDs fail closed."

### 2:30-3:00  -  Verify, then finish

**Show:** Fresh persisted-state re-read.

**Say:** "A receipt alone is not the result. TruthLease reads the owned state again. The lease is revoked, the recalled listing is unpublished, both near matches remain published, and the state version matches the durable receipt."

**Finish with:** "That is TruthLease: when a fact changes, an agent can trace which prior decision is no longer valid, propose the smallest action, pause for accountable approval, and prove the resulting state."

## Presenter recovery paths

- If the live feed is reconnecting, say that connection state is not operation state. Do not imply the case failed.
- If TrueForge is unavailable, stop the qualifying demo. A reference fixture may explain the UI, but it must remain visibly labeled and cannot prove live evidence, native approval, or mutation.
- If the version changed before approval, show the conflict and start a new evidence-analysis-approval run. Do not edit or auto-retry the approved arguments.
- If approval is denied, finish on the denied state and emphasize that no patch is authorized.

## Truth boundaries

- The retailer state is owned synthetic demo state, not a production retailer account.
- The qualifying evidence path uses Bright Data and the official CPSC result.
- The sandbox and approval are native TrueForge events.
- The case-file browser is display-only.
- The demonstrated mutation is local and version-checked.
- One successful run proves the P0 workflow, not retention, production readiness, marketplace coverage, or autonomous authority.

## Refero decision ledger

| Decision | Source | Role | Why |
| --- | --- | --- | --- |
| Tell the story as five operator questions | Refero journey fallback + current five-stage rail | Journey structure | Each screen answers a decision the operator must make |
| Lead with the already-live listing | Refero copy rule: write in scenes, not claims | Context | Consequence is understandable before architecture |
| Keep headings operational | Refero product-copy rule | Orientation | The product UI reports status; the presenter supplies narrative |
| Use hashes, versions, exact IDs as proof | Existing case-ledger reference lock | Trust evidence | Concrete records replace adjectives and demo hype |
| End on a fresh read | Product requirement and real run | Outcome | Tool completion is not confused with persisted success |
| Preserve a visible approval pause | User brief + TrueForge native boundary | Human authority | The most important product moment is a deliberate stop |
