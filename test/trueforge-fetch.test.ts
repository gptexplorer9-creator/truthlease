import { describe, expect, it, vi } from "vitest";

import { fetchTrueForgeEvents } from "../src/trueforge/case-feed.js";

function jsonResponse(
  status = 200,
  finalUrl?: string,
  body: unknown = { data: [] },
): Response {
  const response = new Response(JSON.stringify(body), {
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

  it("follows page_token pagination beyond 100 events and returns tail authorization events", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      turn_id: `turn-${index}`,
      event: { id: `event-${index}`, type: "tool.response" },
    }));
    const tail = [
      { turn_id: "turn-approval", event: { id: "approval", type: "approval.resolved" } },
      { turn_id: "turn-verification", event: { id: "verification", type: "verification.completed" } },
    ];
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const requestUrl = new URL(String(request));
      if (requestUrl.searchParams.get("page_token") === null) {
        return jsonResponse(200, requestUrl.href, { data: firstPage, page_token: "tail/token+1" });
      }
      return jsonResponse(200, requestUrl.href, { data: tail, page_token: null });
    });

    const entries = await fetchTrueForgeEvents(
      "http://127.0.0.1:8790",
      "session-p0",
      fetchImpl,
    );

    expect(entries).toHaveLength(102);
    expect(entries.slice(-2).map(({ event }) => event.type)).toEqual([
      "approval.resolved",
      "verification.completed",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "http://127.0.0.1:8790/api/v1/sessions/session-p0/events?limit=100&page_token=tail%2Ftoken%2B1",
    );
    expect(fetchImpl.mock.calls[1]?.[1]?.redirect).toBe("manual");
  });

  it("rejects a repeated page_token rather than looping", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => jsonResponse(
      200,
      String(request),
      { data: [], page_token: "repeat" },
    ));

    await expect(fetchTrueForgeEvents(
      "http://localhost:8790",
      "session-p0",
      fetchImpl,
    )).rejects.toThrow("page_token cycle");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([42, {}, "   "])("rejects a malformed page_token: %j", async (pageToken) => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => jsonResponse(
      200,
      String(request),
      { data: [], page_token: pageToken },
    ));

    await expect(fetchTrueForgeEvents(
      "http://localhost:8790",
      "session-p0",
      fetchImpl,
    )).rejects.toThrow("malformed page_token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies redirect rejection to every page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const requestUrl = new URL(String(request));
      return requestUrl.searchParams.has("page_token")
        ? jsonResponse(307)
        : jsonResponse(200, requestUrl.href, { data: [], page_token: "next" });
    });

    await expect(fetchTrueForgeEvents(
      "http://localhost:8790",
      "session-p0",
      fetchImpl,
    )).rejects.toThrow("rejected redirect HTTP 307");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("applies final-origin rejection to every page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const requestUrl = new URL(String(request));
      return requestUrl.searchParams.has("page_token")
        ? jsonResponse(200, "http://127.0.0.1:8791/escaped", { data: [] })
        : jsonResponse(200, requestUrl.href, { data: [], page_token: "next" });
    });

    await expect(fetchTrueForgeEvents(
      "http://127.0.0.1:8790",
      "session-p0",
      fetchImpl,
    )).rejects.toThrow("response origin did not match");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed when pagination does not finish within the safe page bound", async () => {
    let page = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (request) => jsonResponse(
      200,
      String(request),
      { data: [], page_token: `page-${page += 1}` },
    ));

    await expect(fetchTrueForgeEvents(
      "http://localhost:8790",
      "session-p0",
      fetchImpl,
    )).rejects.toThrow("safe page bound");
    expect(fetchImpl).toHaveBeenCalledTimes(100);
  });

  it("fails closed when a response exceeds the safe event bound", async () => {
    const oversizedPage = Array.from({ length: 10_001 }, (_, index) => ({
      turn_id: `turn-${index}`,
      event: { id: `event-${index}` },
    }));
    const fetchImpl = vi.fn<typeof fetch>(async (request) => jsonResponse(
      200,
      String(request),
      { data: oversizedPage },
    ));

    await expect(fetchTrueForgeEvents(
      "http://localhost:8790",
      "session-p0",
      fetchImpl,
    )).rejects.toThrow("safe event bound");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
