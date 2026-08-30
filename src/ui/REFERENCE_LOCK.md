# TruthLease UI reference lock

## Design brief

Designing one append-only operational case file for retailer operations, trust, and reliability teams on the web.

- Goal: understand and safely follow one evidence-to-verification containment run in under three minutes, including when no case has been recorded yet.
- Tone: quiet, exact, operational, and human-controlled.
- Main risk: a polished interface could accidentally imply fabricated evidence, simulated approval, or verified containment before the fresh read exists.
- Must remember: completed stages remain visible; the approval stage is an interruption in the causal record, not a conversational prompt.
- Constraints: deterministic rendering, keyboard access, reduced motion, no direct retailer mutation from the browser, no generic dashboard, no metrics or unrelated product surface.
- Product shell: a complete, calm workspace must exist before the first case. An empty ledger is a ready operational state, never a fabricated case or transport error.

## Reference lock

- Primary reference: Refero Tailscale style `5d884659-1d6b-4b82-8ccd-dbb0434667a8`.
- Preserve: light neutral canvas, compact Inter/system typography, dark high-contrast controls, quiet borders, restrained elevation, comfortable operational density, and red reserved for failed operational states.
- Borrow only:
  - Refero Operate style `a0f473eb-0310-4df5-b5f6-5bc124ad5954`: ruled-ledger grid and thin inset separators.
  - Refero Fingerprint style `74adbdf2-822b-4df3-80d1-3c5a1b263a90`: sans-plus-monospace evidence treatment and a contained dark console for sandbox output.
- Product patterns:
  - n8n screen `1974172f-cafa-4873-96f9-8c50321e8d72`: compact execution metadata and visibly labelled error rows.
  - Fingerprint flow `11171`: focused decision with explicit consequences and a visible no-op path. The browser adapts this into a display-only inline airlock because the actual decision remains in native TrueForge.
  - Vercel screen `73675061-8485-4c1d-854d-d3061ce2e334`: expandable, timestamped run output.
- Role rules:
  - Impact red is failure-only. It is never decorative and never marks untrusted evidence merely because the evidence is adverse.
  - Green is product-semantic and appears only after a fresh persisted-state re-read passes every check.
  - Monospace is limited to identifiers, hashes, arguments, timestamps when aligned, and sandbox output.
  - The dark surface is limited to sandbox output. The application remains light.
- Media strategy: code-native evidence tables, ordered stages, diff rows, and run output. No photography, illustration, fake charts, or generated evidence imagery.
- Reject: dark mission-control theme, all-monospace body copy, warm regulatory-document mimicry, KPI cards, charts, generic AI chat, typed-name confirmation, toast-only success, gradients, decorative status stripes, and animated AI-thinking effects.

## Token commitments

| Token | Value | Role |
| --- | --- | --- |
| canvas | `#eeebea` | Page background only |
| surface | `#ffffff` | Case-file paper and interactive surfaces |
| surface-subtle | `#f7f5f4` | Hover and secondary rows |
| ink | `#181717` | Primary text and strong borders |
| carbon | `#2e2d2d` | Secondary text and sandbox surface |
| muted | `#575555` | Tertiary labels with verified contrast |
| rule | `#d7d3d1` | Ledger rules and quiet borders |
| failure | `#b83d37` | Failed evidence retrieval, analysis, mutation, or verification only |
| warning | `#7a5200` | Pending, denied, stale, and conflicts with text/icon labels |
| verified | `#17663a` | Fresh verification success only |
| focus | `#0b5fcc` | Keyboard focus ring only |
| button radius | `8px` | Interactive controls |
| panel radius | `16px` | Interactive/expandable modules only |
| element gap | `12px` | Closely related controls and metadata |
| stage gap | `24px` | Operational stage rhythm |

System UI is the production Inter substitute. `ui-monospace`, SFMono-Regular, Consolas, and Liberation Mono form the evidence stack. No external font request is required.

## Decision ledger

| Decision | Source | Source role preserved | Why |
| --- | --- | --- | --- |
| One vertical append-only case file | Owner contract plus Operate | Ledger structure | Keeps cause, decision, action, and proof in one readable sequence. |
| Five visible stages | Owner contract | Product requirement | Evidence, Proof, Approval, Patch, and Verified remain auditable after completion. |
| Light technical canvas | Tailscale | Primary canvas and density | Prevents theatrical command-center framing and supports dense evidence. |
| Neutral native-approval link | Tailscale plus owner transport contract | Dark high-contrast control | The browser can open a real TrueForge target but cannot approve, deny, or mutate; red would imply authority the link does not possess. |
| Dark sandbox console | Fingerprint and Vercel | Code/output only | Separates deterministic program output from model narration and product chrome. |
| Inline approval airlock without typed confirmation | Fingerprint flow plus owner contract | Focus and explicit consequences, not a browser decision control | The genuine TrueForge event and immutable arguments are the safety boundary; typing or a browser modal would add theater. |
| Persistent verification result | Owner contract; Fingerprint toast explicitly rejected | None | A toast cannot prove a fresh persisted-state re-read and is inaccessible when it disappears. |
| Semantic icons plus text | Refero craft guidance and WCAG | Status meaning | No stage depends on color alone. |
| Deterministic event fold | Owner architecture | Product authority boundary | Generative UI may format explanatory text but cannot fabricate approval, patch, or verification state. |

## Build target and drift guard

- Build target: this reference lock and the owner-approved event contract.
- Must not drift: light technical canvas, single causal record, five persistent stages, destructive-red role, green-only-after-verification rule, mono evidence roles, honest failure states, and genuine approval boundary.
- A component that does not help prove evidence, exact matching, approval, patch, or fresh verification is outside the build.
