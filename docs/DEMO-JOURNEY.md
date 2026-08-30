# TruthLease judge demo: the action was right, then the truth changed

Target length: 2 minutes 40 seconds. This is the presenter journey for a qualifying run, not evidence that a current run has occurred.

## The story in one sentence

An agent validly published a listing under the facts available at the time; after the official facts changed, TruthLease used canonical evidence, deterministic analysis, native human approval, one bounded local mutation, and a fresh persisted-state re-read to contain only the newly invalid action.

The judge should leave with three beats: the original action was reasonable, the changed fact invalidated one dependency, and the repair stayed narrow and accountable.

## Evidence rule before presenting

Use the assertive talk track below only while the corresponding evidence is visible from the same current run. A fixture, screenshot, or code path can explain the product, but it must be labelled as such and cannot establish live Bright Data retrieval, a genuine TrueForge sandbox event, native approval, mutation, or verification. If the genuine run is unavailable, present this as the intended journey and stop before claiming completion.

## Architecture and sequence

```mermaid
sequenceDiagram
    participant A as TrueForge agent
    participant B as Bright Data Web MCP
    participant C as Canonical CPSC source
    participant S as TrueForge sandbox
    participant H as Human approver
    participant M as Local TruthLease MCP
    participant R as Owned retailer state

    A->>B: Retrieve allow-listed recall
    B->>C: Read canonical CPSC evidence
    B-->>A: Source response and trace
    A->>M: Record evidence; read lease and state
    A->>S: Analyze item AND batch
    S-->>A: 1 exact match; 2 near matches excluded
    A->>H: Native apply_containment_patch approval pause
    H-->>A: Approve exact immutable call
    A->>M: Apply one version-checked atomic patch
    M->>R: Revoke lease and unpublish exact listing
    A->>M: verify_containment_state
    M->>R: Fresh persisted-state read
    R-->>A: Exact changed; near matches unchanged
```

Bright Data is the qualifying web transport; CPSC is the source authority. TrueForge owns the native approval pause. The local TruthLease MCP owns the retailer mutation. The final verification is a fresh re-read of TruthLease-owned persisted state, not independent third-party verification.

## 2:40 talk track

### 0:00-0:25 — The action was valid when taken

**Show:** Truth Lease `TL-042` and the initial retailer state.

**Say:** “This agent action was valid when it happened. `LISTING-1001` was published under an explicit condition: it could remain live while no official recall matched both item `2012261001` and batch `0925`. TruthLease recorded the decision, its supporting fact, and the downstream listing that depended on it.”

**Point at:** lease status `active`, listing status `published`, and state version `7`.

### 0:25-0:55 — The official facts changed

**Show:** the current Bright Data tool trace and the canonical CPSC evidence receipt.

**Say only with a current trace:** “The official facts later changed. Bright Data Web MCP retrieved the allow-listed CPSC source, and TruthLease bound the canonical URL, recall `26-719`, exact identifiers, retrieval time, and content hash to this TrueForge run.”

**Point at:** `provider: bright-data`, the `cpsc.gov/Recalls/...` URL, item, batch, timestamp, and SHA-256 receipt.

**If the trace is not current:** say “The configured qualifying path retrieves this source through Bright Data,” and label the live retrieval evidence pending.

### 0:55-1:25 — Deterministic analysis limits the blast radius

**Show:** the native TrueForge sandbox event, execution response, and analysis output.

**Say only with those native events:** “TrueForge ran deterministic analysis in its sandbox. The rule is item **and** batch, not a title guess. It found exactly one match: `LISTING-1001`. `LISTING-1002` matches only the item, and `LISTING-1003` only the batch, so both are explicitly excluded.”

**Point at:** one exact ID, the two excluded IDs, state version `7`, and `analysis_sha256`.

### 1:25-1:55 — Genuine approval pauses execution

**Show:** the native TrueForge `tool.approval_required` state.

**Say:** “The investigation is complete, but nothing has changed yet. TrueForge pauses the actual `apply_containment_patch` tool call for a person to inspect. This is the genuine native approval boundary—not a prompt asking the model to confirm itself.”

**Pause before approval. Point at:** `listing_id`, `lease_id`, `patch_id`, `expected_version`, evidence receipt, analysis hash, and reason.

### 1:55-2:20 — One local atomic containment patch

**Show:** the approved local MCP call and patch receipt.

**Say:** “After approval, the local TruthLease MCP applies one atomic, version-checked patch. It revokes `TL-042` and unpublishes only `LISTING-1001`. Changed arguments, a stale version, or reuse of the patch ID with different inputs fail closed.”

**Point at:** state transition `7 -> 8`, lease `active -> revoked`, and exact listing `published -> unpublished`.

### 2:20-2:40 — Read persisted state again

**Show:** the later `verify_containment_state` result.

**Say:** “A tool receipt is not the ending. TruthLease performs a fresh persisted-state re-read. It observes the exact listing unpublished, the lease revoked, both near matches still published, and the durable state version aligned with the patch receipt.”

**Finish:** “TruthLease gives actions an expiration condition: when the truth changes, it finds the smallest invalidated dependency, stops for accountable approval, applies one bounded correction, and re-reads the result.”

## Judge proof map

| Judge question | Evidence to show | Boundary |
| --- | --- | --- |
| Was the earlier action reasonable? | `TL-042`, supporting claim, active initial state | Owned synthetic retailer state |
| Did official evidence change? | Current Bright Data trace plus canonical CPSC receipt | Never substitute a fixture for live retrieval |
| Why only one listing? | Native sandbox execution: one exact item+batch match and two one-field exclusions | Deterministic code, not model prose |
| Who authorized the consequence? | Native TrueForge approval pause and resolution for the exact tool arguments | Browser UI is display-only |
| What changed? | One atomic local MCP patch receipt | No customer, inventory, shipment, refund, or notification action |
| Did it persist? | Fresh post-action `verify_containment_state` read | Owned-state re-read, not third-party verification |

## Recovery paths

- If Bright Data or the canonical CPSC retrieval fails, fail closed. Do not silently substitute cached or fixture evidence.
- If the TrueForge sandbox event or execution response is absent, do not claim sandbox verification.
- If the genuine approval pause is unavailable, stop the qualifying demo; prompt-level confirmation is not equivalent.
- If the expected version is stale, show the conflict and start a new evidence-analysis-approval run. Do not alter approved arguments automatically.
- If approval is denied, finish on the denial and show that no patch was authorized.
- If the hosted feed is empty or reconnecting, describe connection state only. Do not invent a case or infer operation success.

## Claim boundaries

- The retailer is owned synthetic demo state, not a production retailer account.
- Fixtures support tests and labelled walkthroughs; fixtures are never live evidence.
- A genuine run requires current recorded Bright Data, native sandbox, native approval, local MCP mutation, and fresh-read events from one traceable journey.
- The case browser displays evidence; it does not approve or mutate retailer state.
- A successful run demonstrates this narrow containment workflow, not production readiness, continuous monitoring, marketplace coverage, retention, or autonomous authority.
- [truthlease.vercel.app](https://truthlease.vercel.app) exists, but its deployment predates candidate `5a08272` and its ledger is empty until a genuine run is ingested. Current-candidate deployment, genuine-run evidence, and demo video evidence remain separate gates in the release checklist.
