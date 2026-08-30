# Run TruthLease with your own integrations

Anyone can inspect the public TruthLease demo. To run a new, real evidence loop, use a local copy of TruthLease and connect your own model provider and Bright Data account to a local TrueForge instance.

This is intentionally bring-your-own-credentials. The public Vercel deployment does not receive, store, proxy, or spend your credentials, and it has no approval or retailer-mutation authority.

## What you need

- Windows 11 with WSL 2 and Ubuntu for the currently verified setup path.
- Node.js and npm on Windows for TruthLease.
- An OpenAI API credential. OpenAI is the tested/default model provider for the supplied agent manifest.
- A Bright Data account connected through the Bright Data MCP. Bright Data is the required evidence transport for a qualifying live run.

TrueForge supports other model providers. They are compatibility candidates, not verified TruthLease configurations. Using one may require changing the `model` value in the repository's current TrueForge agent manifest and revalidating the complete loop.

## 1. Install the local companion

Clone the repository, open PowerShell in the repository root, and install dependencies:

```powershell
npm install
npm run trueforge:wsl:setup
```

`trueforge:wsl:setup` verifies the required Linux sandbox commands and installs the pinned, user-local Node and TrueForge runtimes inside WSL. It does not install missing Ubuntu packages and does not ask for or configure provider credentials. If it reports a missing dependency, install that named Ubuntu package through your normal administrator-approved process, then run the setup check again.

## 2. Start the local services

Keep each command running in its own PowerShell window from the repository root:

```powershell
npm run trueforge:wsl
```

Before starting TruthLease, open the repository's current agent manifest in `config/` and copy its top-level `name` value. Then run:

```powershell
$env:TRUTHLEASE_RUN_NOW_ENABLED = "true"
$env:TRUTHLEASE_RUN_NOW_AGENT = "<paste the manifest name here>"
npm run dev
```

In the relay window, derive the Windows host address that WSL can reach, validate that it was found, and start the narrow MCP relay:

```powershell
$env:TRUTHLEASE_WSL_RELAY_HOST = (wsl.exe sh -lc "ip route | sed -n 's/^default via \([^ ]*\).*/\1/p'").Trim()
if (-not $env:TRUTHLEASE_WSL_RELAY_HOST) { throw "Could not determine the Windows host address visible to WSL." }
npm run mcp:relay:wsl
```

The default local services are:

| Service | Address | Purpose |
| --- | --- | --- |
| TrueForge | `http://127.0.0.1:8790` | Local agent runtime, integrations, sandbox, and native approval UI |
| TruthLease | `http://127.0.0.1:8787` | Local application, case ledger, and TruthLease MCP server |
| WSL MCP relay | `http://<windows-host-visible-to-wsl>:18787/mcp` | Narrow relay from WSL TrueForge to the local TruthLease MCP |

Use the WSL MCP relay URL printed by `npm run mcp:relay:wsl`. The host address is machine-specific; do not copy an address from someone else's computer. The relay accepts only MCP traffic for the fixed local TruthLease upstream.

## 3. Put credentials in local TrueForge Settings

Open [local TrueForge Settings](http://127.0.0.1:8790/settings). This local page is the only intended place to enter or authorize integration credentials.

1. In the model-provider section, connect OpenAI and enter or authorize your OpenAI credential. OpenAI is the provider used to test the supplied TruthLease agent.
2. In the MCP/integrations section, connect Bright Data and complete its credential or sign-in flow. Keep the MCP connection name `bright-data`.
3. Add the credential-free local TruthLease MCP connection using the relay URL printed in the previous step. Keep its connection name `truthlease-local`.
4. Confirm TrueForge discovers these five TruthLease tools from `truthlease-local`: `record_recall_evidence`, `get_truth_lease`, `get_retailer_state`, `apply_containment_patch`, and `verify_containment_state`.
5. Create or import the repository's current TruthLease agent manifest from `config/`. If you use a model provider other than OpenAI, update the manifest's model identifier to a model available in your local TrueForge, then re-test the whole approval-gated flow.

The value of `TRUTHLEASE_RUN_NOW_AGENT` must exactly equal the imported manifest's top-level `name`. If you imported a different manifest than the one used when starting `npm run dev`, stop that process, set the correct name, and start it again.

Do not put provider credentials in:

- the public `truthlease.vercel.app` site;
- the TruthLease UI or TruthLease MCP configuration;
- a repository file, committed `.env` file, issue, pull request, screenshot, or chat message;
- the `truthlease-local` MCP connection; it is intentionally credential-free.

The local TrueForge Settings page is opened in a browser, but it talks to your local TrueForge process. Check that the address is exactly `http://127.0.0.1:8790/settings` before entering a credential. Never enter a credential into a look-alike hosted TruthLease page.

## 4. Run the real loop

1. Open the local TruthLease URL printed by `npm run dev` (port `8787` by default).
2. Select **Run now**.
3. TruthLease asks the local TrueForge agent to fetch current evidence through the connected `bright-data` MCP, analyze it in the sandbox, and prepare a narrowly scoped patch.
4. When TrueForge pauses, inspect the evidence, exact proposed arguments, and affected records in the native TrueForge approval UI.
5. Approve or deny there. The TruthLease browser cannot approve on your behalf and cannot call the retailer mutation tool directly.
6. After an approval, TruthLease applies the authorized patch and performs a fresh read to verify the resulting lease and listing state. The case ledger records the evidence, analysis, approval, mutation, and verification events.

Every consequential run must retain the sequence:

`live evidence -> sandbox analysis -> native approval pause -> state mutation -> post-action verification`

## Security model

- Provider secrets remain under the operator's local TrueForge instance. They are never required by the hosted TruthLease deployment.
- The public Vercel deployment is a read-only demonstration and setup entry point. It is not a shared credential broker or an anonymous mutation service.
- Bright Data supplies the external evidence transport; it does not authorize state changes.
- The model can propose a patch but cannot approve it.
- `apply_containment_patch` requires a genuine, session-bound TrueForge approval.
- The browser displays the run and directs the operator to TrueForge; it never receives direct mutation authority.
- The local relay exposes only the MCP path and fixed local upstream. Do not publish ports `8787`, `8790`, or `18787` to the public internet.

## Optional scheduling

After the local setup works, an operator can use a local scheduler to start the same evidence-and-analysis loop daily or weekly. TruthLease does not currently provide hosted cron execution for visitor-owned integrations. Scheduling must not bypass the native approval pause: a scheduled run may prepare a proposed repair, but a human still approves or denies the consequential mutation in TrueForge.

## Troubleshooting

### TrueForge Settings does not open

Confirm `npm run trueforge:wsl` is still running and reports `http://127.0.0.1:8790`. Run `npm run trueforge:wsl:setup` again only if the pinned local runtime or required WSL packages are missing.

### `truthlease-local` discovers no tools

Confirm `npm run dev` and `npm run mcp:relay:wsl` are both running. Use the relay URL printed on your machine, including `/mcp`, and keep the MCP connection name exactly `truthlease-local`.

### The run is not ready

In local TrueForge Settings, confirm that:

- the selected model provider is connected;
- the `bright-data` MCP is connected and authenticated;
- the `truthlease-local` MCP discovers all five expected tools; and
- the current TruthLease agent manifest exists and references the available model and both MCP connections;
- `TRUTHLEASE_RUN_NOW_ENABLED` is `true`; and
- `TRUTHLEASE_RUN_NOW_AGENT` exactly matches the imported manifest's top-level `name`.

### The evidence step fails

Do not replace Bright Data results with pasted or synthetic evidence. Confirm the Bright Data MCP is authenticated, retry the live fetch, and preserve the evidence trace that TrueForge binds to the record request.

### The native sandbox cannot install `pydantic`

Stop the run. Do not disable the sandbox, weaken its network policy, or manually reinterpret the failed analysis as valid. TrueForge 0.1.4 creates an isolated Python environment for each sandbox and installs its required `pydantic` dependency through the sandbox-runtime allowlisted proxy. If that proxy cannot reach PyPI in your WSL environment, use a supported environment where the TrueForge sandbox bootstrap succeeds or wait for an upstream fix. A failed bootstrap must produce no approval request or mutation.

### The run waits at approval

That is expected. Open the session in local TrueForge, inspect the proposed action, and approve or deny it there. There is deliberately no approval button in the TruthLease browser.
