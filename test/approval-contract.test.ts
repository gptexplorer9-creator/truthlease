import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("TrueForge P0 harness contract", () => {
  it("uses Bright Data, gates only the atomic patch, enables sandbox, and disables generative UI", async () => {
    const config = JSON.parse(
      await readFile(join(process.cwd(), "config", "trueforge-agent-manifest.json"), "utf8"),
    ) as {
      manifest: {
        instructions: string;
        mcp_servers: Array<{
          name: string;
          enable_tools: string[];
          require_approval_for_tools: string[];
        }>;
        config: {
          sandbox: { enabled: boolean };
          generative_ui: { enabled: boolean };
          dynamic_sub_agents: { enabled: boolean };
        };
      };
    };

    const brightData = config.manifest.mcp_servers.find((server) => server.name === "bright-data");
    const truthLease = config.manifest.mcp_servers.find((server) => server.name === "truthlease-local");
    expect(brightData?.enable_tools).toContain("scrape_as_markdown");
    expect(truthLease?.enable_tools).not.toContain("fetch_official_recall");
    expect(truthLease?.require_approval_for_tools).toEqual(["apply_containment_patch"]);
    expect(config.manifest.instructions).toContain("exact snake_case wire keys");
    expect(config.manifest.config.sandbox.enabled).toBe(true);
    expect(config.manifest.config.generative_ui.enabled).toBe(false);
    expect(config.manifest.config.dynamic_sub_agents.enabled).toBe(false);
  });
});
