import { describe, expect, it, vi } from "vitest";

import { fetchTrueForgeEvents } from "../src/trueforge/case-feed.js";

function jsonResponse(
  status = 200,
  finalUrl?: string,
): Response {
  const response = new Response(JSON.stringify({ data: [] }), {
    status,
    headers: { "content-type": "application/json" },
  });
  if (finalUrl !== undefined) {
    Object.defineProperty(response, "url", { value: finalUrl });
  }
  return response;
}

describe("TrueForge loopback event transport", () => {
  it("requests only the configured HTTP loopback origin with redirects disabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(
      200,
      "http://127.0.0.1:8790/api/v1/sessions/session-p0/events?limit=100",
    ));

    await expect(fetchTrueForgeEvents(
      "http://127.0.0.1:8790",
      "session/p0",
      fetchImpl,
    )).resolves.toEqual([]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchImpl.mock.calls[0]!;
    expect(String(requestUrl)).toBe(
      "http://127.0.0.1:8790/api/v1/sessions/session%2Fp0/events?limit=100",
    );
    expect(init).toMatchObject({
      headers: { accept: "application/json" },
      redirect: "manual",
    });
  });

  it.each([
    "https://127.0.0.1:8790",
    "http://example.com:8790",
    "http://user:password@127.0.0.1:8790",
    "http://127.0.0.1:8790/unexpected-path",
    "http://127.0.0.1:8790/?target=other",
  ])("rejects a non-exact or credentialed source before fetch: %s", async (baseUrl) => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(fetchTrueForgeEvents(baseUrl, "session-p0", fetchImpl)).rejects.toThrow(
      "exact credential-free HTTP loopback origin",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirect responses without following them", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(302));

    await expect(fetchTrueForgeEvents(
      "http://localhost:8790",
      "session-p0",
      fetchImpl,
    )).rejects.toThrow("rejected redirect HTTP 302");
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("rejects a successful response whose final origin differs from the configured origin", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(
      200,
      "http://127.0.0.1:8791/api/v1/sessions/session-p0/events?limit=100",
    ));

    await expect(fetchTrueForgeEvents(
      "http://127.0.0.1:8790",
      "session-p0",
      fetchImpl,
    )).rejects.toThrow("response origin did not match");
  });
});
