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

- Primary reference: Refero N26 "The online bank" style `59911817-9d14-445a-9f1b-617418001061`.
- Preserve: white institutional canvas, compact system typography, evidence-led hierarchy, flat one-pixel borders, 4-6px radii, almost no shadow, comfortable operational density, and success withheld until a fresh persisted-state re-read.
- Borrow only:
  - Refero shadcn UI style `c14c0a94-1037-449e-bf5b-4cb972656ac7`: compact density, visible focus, and bounded monospace metadata.
  - Refero Operate style `a0f473eb-0310-4df5-b5f6-5bc124ad5954`: ruled-ledger grid and chronology gutter.
  - Refero Trigger.dev style `45a07d72-4895-4893-b403-1e7c24449c3f`: rectangular immutable-argument blocks only.
- Product patterns:
  - Fibery activity log `2cec7602-2f2f-4abe-afc4-cdb4a03b094f`: ordered chronology and readable event grouping.
  - Mercury table and detail drawer `f562ada5-564b-4c9c-a86d-598dd41a57f1`: compact case index plus focused detail.
  - Gemini sources sheet `208a6b41-0587-4abb-852c-fa9a163a5301`: authority and retrieval provenance separation.
  - Rox permission interruption `3106d715-5410-4080-9761-fa4db061dccb` and Asana approval chronology `8679a9ab-b76b-4b47-88ee-40772651af45`: memorable permission pause inside a continuing record.
  - GitHub side-by-side diff `4b64c360-ee73-4c4e-91e2-1c7a9b923f8b`: explicit before/after mutation proof.
  - Resend verification table `68c8c0cf-5f11-427d-9efa-ccffaef3d9d1`: row-level post-action assertions.
  - Mercury loading/empty `e697f79b-21fc-431c-bf64-b522a011c2c0` and Wynde failure/retry `6f4d3d78-c20c-49d8-bd44-c1bf775d5c8a`: honest non-happy states.
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
| canvas | `#ffffff` | Page background only |
| surface | `#ffffff` | Case-file paper and interactive surfaces |
| surface-subtle | `#faf8f5` | Differentiated rows, chronology, and secondary evidence surfaces |
| ink | `#1b1b1b` | Primary text and strong borders |
| carbon | `#303030` | Secondary text and sandbox surface |
| muted | `#6d6d6d` | Tertiary labels with verified contrast |
| rule | `#e9e9e9` | Ledger rules and quiet borders |
| failure | `#b83d37` | Failed evidence retrieval, analysis, mutation, or verification only |
| warning | `#7a5200` | Pending, denied, stale, and conflicts with text/icon labels |
| verified | `#088177` | Primary action, active state, and fresh verification only |
| focus | `#0b5fcc` | Keyboard focus ring only |
| button radius | `4px` | Interactive controls |
| panel radius | `6px` | Interactive/expandable modules only |
| element gap | `12px` | Closely related controls and metadata |
| stage gap | `24px` | Operational stage rhythm |

System UI is the production Inter substitute. `ui-monospace`, SFMono-Regular, Consolas, and Liberation Mono form the evidence stack. No external font request is required.

## Decision ledger

| Decision | Source | Source role preserved | Why |
| --- | --- | --- | --- |
| One vertical append-only case file | Owner contract plus Operate | Ledger structure | Keeps cause, decision, action, and proof in one readable sequence. |
| Five visible stages | Owner contract | Product requirement | Evidence, Proof, Approval, Patch, and Verified remain auditable after completion. |
| Light technical canvas | N26 | Primary canvas and density | Creates an institutional verified-ledger feel without theatrical command-center framing. |
| Neutral native-approval link | N26 plus owner transport contract | Restrained primary action | The browser can open a real TrueForge target but cannot approve, deny, or mutate; red would imply authority the link does not possess. |
| Dark sandbox console | shadcn and Trigger.dev | Code/output only | Separates deterministic program output from model narration and product chrome. |
| Inline approval airlock without typed confirmation | Rox, Asana, and owner contract | Focus and explicit consequences, not a browser decision control | The genuine TrueForge event and immutable arguments are the safety boundary; typing or a browser modal would add theater. |
| Persistent verification result | Owner contract; Fingerprint toast explicitly rejected | None | A toast cannot prove a fresh persisted-state re-read and is inaccessible when it disappears. |
| Semantic icons plus text | Refero craft guidance and WCAG | Status meaning | No stage depends on color alone. |
| Deterministic event fold | Owner architecture | Product authority boundary | Generative UI may format explanatory text but cannot fabricate approval, patch, or verification state. |

## Build target and drift guard

- Build target: this reference lock and the owner-approved event contract.
- Must not drift: white institutional console, single causal record, five persistent stages, destructive-red role, teal only for action/active/fresh verification, mono evidence roles, honest failure states, and genuine approval boundary.
- A component that does not help prove evidence, exact matching, approval, patch, or fresh verification is outside the build.
