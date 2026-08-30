# Contributing to TruthLease

Thank you for helping improve TruthLease.

## Before opening a pull request

1. Open an issue for material product or authority-boundary changes.
2. Keep official-source content untrusted and Bright Data as the qualifying web transport.
3. Keep approval native to TrueForge. The browser may start an investigation and display its ledger, but it must never approve or call the retailer mutation tool.
4. Preserve exact item-and-batch matching, idempotent mutation, and fresh persisted verification.
5. Never commit credentials, local runtime state, customer data, or TrueForge databases.

## Development

- Use Node.js 22.14 or newer.
- Install locked dependencies with npm ci.
- Run npm run check before every pull request.
- Add negative tests for security, provenance, approval, and replay changes.
- Keep generated public/ui artifacts aligned with src/ui by running npm run build.

Submit focused commits and explain which claims are code-verified, externally verified, or still pending.

Security vulnerabilities should not be filed as public issues. Follow [SECURITY.md](SECURITY.md).
