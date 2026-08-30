# TruthLease v0.1.0-rc1

Status: release candidate for the Agent Harness Hackathon. This is not a production retailer integration.

## What this release proves

TruthLease demonstrates one complete consequential-agent loop:

1. Retrieve the canonical U.S. CPSC recall through Bright Data Web MCP.
2. Bind the exact source response and identifiers to the TrueForge session.
3. Read the prior Truth Lease and retailer state.
4. Run the exact item-and-batch analysis in the TrueForge sandbox.
5. Stop at a genuine native TrueForge approval.
6. Apply one version-checked atomic patch through the local TruthLease MCP.
7. Read persisted state again and show the exact listing changed while both near matches remained published.

The browser is a display surface. It has no approval or retailer-mutation endpoint.

## Demo case

- Lease: `TL-042`
- Recall: CPSC `26-719`
- Exact identifiers: item `2012261001`, batch `0925`
- Changed listing: `LISTING-1001`
- Protected near matches: `LISTING-1002` and `LISTING-1003`
- State transition: version `7` to `8`

Use [`DEMO-JOURNEY.md`](DEMO-JOURNEY.md) for the three-minute talk track and presenter recovery paths.

## Safety and review changes

Qodo review drove the following changes:

- Evidence must come from the canonical CPSC path through the qualifying Bright Data trace.
- The sandbox execution must be bound to the same TrueForge turn as the sandbox creation event.
- Successful lease and retailer-state reads must occur before analysis.
- A TrueForge authorization is reserved during work, committed only after durable success, and released after failure.
- A later valid evidence retry can authorize the run without weakening URL, query, order, or payload checks.
- Even an idempotent replay must remain inside the authorization freshness window.
- Presenter documentation is scanned for invalid control bytes.

The reviewed pull request is [#1](https://github.com/gptexplorer9-creator/truthlease/pull/1). The latest remediation commit is `005d3bf`.

## Validation

- Exact detached commit `1fa933a`: build passed and 43 tests passed.
- Follow-up security fix `005d3bf`: focused TrueForge and MCP tests passed, 12 of 12.
- Follow-up security fix `005d3bf`: TypeScript and UI build passed.
- Demo journey scan: no C0 control bytes.

A complete release check must run again after any hosted connector, ledger, or UI candidate files are committed.

## Known boundaries

- Retailer state is owned synthetic demo state.
- The release proves one recall-containment workflow, not general recall coverage.
- It does not message customers, issue refunds, change shipments, or update inventory.
- The local TrueForge runtime was reset after the qualifying run, so the historical session is not currently re-verifiable live.
- Hosted connector and ledger work in the current working tree is not part of this reviewed release until it is committed, tested, and reviewed.
- The pull request remains open and unmerged.

## Publish checklist

- Merge the reviewed pull request.
- Decide whether the hosted connector and ledger belong in this release or a later release.
- If included, run the complete build and test suite after committing those files.
- Rerun the qualifying TrueForge session if live evidence is required at submission time.
- Create the GitHub release from the merged commit and paste these notes without upgrading any evidence label.
