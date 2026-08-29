# TruthLease

TruthLease is a validity-and-compensation layer for consequential agent actions.

Agents often act correctly on evidence that later becomes stale, corrected, revoked, unsafe, or unlawful. TruthLease records what made an action valid, identifies the downstream consequences when that supporting truth changes, compiles the minimum-safe compensating transaction, pauses for human approval, executes only the approved mutation, and verifies the resulting state.

The hackathon wedge is consumer-product recall containment. The live source is the official U.S. CPSC recall for the HABA Rainbow Rattle, item `2012261001`, batch `0925`. The operational system is an owned, synthetic retailer with one exact listing and two near matches.

## P0 vertical slice

```text
official CPSC page via Bright Data Web MCP (live, read-only)
  -> prior Truth Lease + retailer state via MCP
  -> exact item-and-batch match in the TrueForge local Bubblewrap sandbox
  -> TrueForge tool.approval_required pause
  -> approved apply_containment_patch MCP mutation
  -> fresh verify_containment_state MCP read
```

The atomic write revokes the invalidated lease and unpublishes its exact dependent listing. It is annotated destructive and idempotent, and the TrueForge manifest names `apply_containment_patch` explicitly in `require_approval_for_tools`.

## Current evidence status

| Surface | Status |
| --- | --- |
| Official event requirements | Verified on the live event page on 2026-08-29 |
| Official CPSC source and exact identifiers | Verified live on 2026-08-29 |
| Owned MCP server and persistent retailer mutation | Implemented; locally testable |
| TrueForge package | Pinned to official npm package `0.1.4` |
| TrueForge model connection | Verified live with OpenAI through TrueForge |
| Bright Data Web MCP | Authenticated and verified live through TrueForge |
| TrueForge local Bubblewrap sandbox | Runtime available; final qualifying run pending `python3.12-venv` |
| Genuine TrueForge approval event | Pending the clean qualifying run |
| GitHub public repo | Connected |
| Qodo PR review | Required and pending the proven P0 commit |

## Local setup

Requirements: Node.js 22.14 or newer.

```powershell
npm install
npm run state:reset
npm run check
npm run dev
```

The MCP endpoint is `http://127.0.0.1:8787/mcp`; health is `http://127.0.0.1:8787/healthz`.

## Hosted preview boundary

The Vercel deployment is a read-only presentation surface. It serves the case-file UI and a health endpoint, but it deliberately disables `/mcp` and returns a fail-closed response for the event feed. TrueForge, Bright Data, the approval pause, retailer mutation, and persisted-state verification remain in the local operational run where the genuine TrueForge session and durable owned state exist.

Do not cite the hosted preview as evidence of a qualifying approval, mutation, or verification run.

Start the pinned TrueForge local runtime in a second terminal:

```powershell
npm run trueforge
```

Open `http://127.0.0.1:8790`, then:

1. Configure a model under Settings -> Models.
2. Add the local MCP server URL under Settings -> Connectors with the name `truthlease-local`.
3. On Ubuntu/WSL, install `python3.12-venv` for TrueForge's native local sandbox.
4. Create the agent using [`config/trueforge-agent-manifest.json`](config/trueforge-agent-manifest.json) through the TrueForge API.
5. Ask it to run the configured TL-042 case.
6. Do not approve until TrueForge shows the exact `apply_containment_patch` snake_case arguments.
7. Bind the resulting session to the read-only UI with `TRUTHLEASE_TRUEFORGE_SESSION_ID`.

Reset the owned retailer between demos with `npm run state:reset`.

## Safety properties

- Bright Data is the only qualifying web path and the evidence recorder accepts only fresh `https://www.cpsc.gov/Recalls/...` content.
- Containment requires an exact item-number and batch-code match.
- Near matches remain published and appear in verification output.
- The lease revocation and exact listing unpublish occur atomically under an expected state version and stable patch ID.
- Reusing a patch ID with different arguments is rejected.
- Retrying the same approved patch is a no-op with an idempotent receipt.
- Verification performs a new state read after mutation.
- No customer messages, refunds, inventory changes, or shipment changes exist in P0.

## Event fit

The live event rules require TrueForge to visibly reach a real tool, run code in the sandbox, and stop for a human before an irreversible action. Submissions also need a public repo, about a three-minute demo, and substantive pull requests reviewed by Qodo. See [`docs/0001-product-thesis-and-p0.md`](docs/0001-product-thesis-and-p0.md) for the decision record and cut line.

## Qodo Code Review Evidence

Pending. A representative merged pull request and the response to Qodo findings must be linked here before submission. This placeholder is not review evidence.

## Sources

- [The Agent Harness Hackathon](https://www.wemakedevs.org/hackathons/trueforge)
- [TrueForge repository](https://github.com/truefoundry/trueforge)
- [TrueForge agent approval configuration](https://trueforge.dev/create-agent/overview)
- [TrueForge sandbox setup](https://trueforge.dev/sandbox)
- [Official CPSC recall](https://www.cpsc.gov/Recalls/2026/HABA-USA-Recalls-Rainbow-Rattle-Grasping-and-Teething-Toys-Due-to-Risk-of-Serious-Injury-or-Death-from-Choking-and-Ingestion-Hazards)
