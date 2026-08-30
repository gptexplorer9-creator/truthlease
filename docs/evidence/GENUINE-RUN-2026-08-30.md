# Genuine run receipt - 2026-08-30

This receipt summarizes one completed local TruthLease P0 run. It contains no provider credentials, private runtime paths, or customer data. The retailer state is the repository's controlled synthetic demo state; the CPSC evidence retrieval, TrueForge sandbox execution, native approval, mutation, and verification were genuine.

## Identity

- TrueForge session: `01m18mskn7dvwx7e28ywxm6h8g`
- Case: `TL-042`
- Recall: CPSC `26-719`
- Evidence mode: canonical Bright Data scrape followed by the manifest's exact empty-scrape fallback search
- Evidence receipt: `EV-ED1DED0D701904D7`
- Analysis SHA-256: `75692723ae661055f674a48db0dec0643821ace90cbb431ba8371ba4f01ec1e2`
- Patch: `PATCH-TL-042-26-719`
- Durable mutation receipt: `AR-912d18b1-43b0-4c39-9641-489be954b2b3`

## Verified sequence

1. Bright Data retrieved the allow-listed CPSC source through the qualifying MCP path.
2. TruthLease persisted a server-hashed evidence receipt.
3. TrueForge created and successfully executed its native local Bubblewrap sandbox.
4. Deterministic analysis selected only `LISTING-1001`, requiring item `2012261001` and batch `0925` together.
5. TrueForge paused for native approval on the exact immutable patch arguments.
6. The owner approved that one tool call in TrueForge.
7. TruthLease atomically changed state version `7 -> 8`: lease `TL-042` became `revoked` and `LISTING-1001` became unpublished.
8. A later `verify_containment_state` read returned `passed: true` and verdict `VERIFIED`; the two one-field near matches remained unchanged.

The repository verifier command completed with every check passing:

```powershell
npm run evidence:verify -- 01m18mskn7dvwx7e28ywxm6h8g
```

## Boundary

The run used an owner-approved local compatibility patch to TrueForge 0.1.4 so each private sandbox venv received five exact pinned binary Python packages before a sandboxed import check. It changed no root/system package, credential, allowlist, approval rule, mutation rule, or Bubblewrap policy. That local third-party runtime edit is not committed to this repository; the public setup remains fail-closed if the upstream sandbox bootstrap cannot reach PyPI.
