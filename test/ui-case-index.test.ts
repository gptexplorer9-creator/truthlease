import { describe, expect, it, vi } from "vitest";

import { HttpCaseIndexSource, parseCaseIndexFeed } from "../src/ui/case-index.js";

describe("case index transport", () => {
  it("parses queue entries and nextCursor", () => {
    expect(
      parseCaseIndexFeed({
        cases: [
          {
            caseId: "TL-042",
            caseType: "recall_containment",
            subject: "HABA Rainbow Rattle",
            createdAt: "2026-08-29T20:00:00.000Z",
          },
        ],
        nextCursor: "cursor-002",
      }),
    ).toEqual({
      cases: [
        {
          caseId: "TL-042",
          caseType: "recall_containment",
          subject: "HABA Rainbow Rattle",
          createdAt: "2026-08-29T20:00:00.000Z",
        },
      ],
      nextCursor: "cursor-002",
    });
  });

  it("derives a bounded queue label from allow-listed ledger subject fields", () => {
    const parsed = parseCaseIndexFeed({
      cases: [
        {
          caseId: "TL-108",
          caseType: "recall_containment",
          subject: {
            title: "Rainbow Rattle",
            item_number: "3856",
            listing_id: "LISTING-1001",
            evidence: "must not leak into the queue",
          },
          createdAt: "2026-08-29T20:00:00.000Z",
        },
      ],
    });

    expect(parsed.cases[0]?.subject).toBe("Rainbow Rattle / 3856 / LISTING-1001");
    expect(parsed.cases[0]?.subject).not.toContain("must not leak");
  });

  it("rejects malformed queue payloads", () => {
    expect(() => parseCaseIndexFeed({ cases: {} })).toThrow(/cases must be an array/);
    expect(() =>
      parseCaseIndexFeed({
        cases: [{ caseId: "TL-042", createdAt: "not-a-date" }],
      }),
    ).toThrow(/invalid createdAt/);
  });

  it("uses only GET on the same-origin case index", async () => {
    const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ cases: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const source = new HttpCaseIndexSource({ fetch });

    await source.loadCases();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/cases");
    expect(init).toMatchObject({ method: "GET", headers: { accept: "application/json" } });
  });

  it("loads every case-index page and deduplicates repeated case IDs", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        cases: [{ caseId: "TL-001" }, { caseId: "TL-002" }],
        nextCursor: "cursor-002",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        cases: [{ caseId: "TL-002" }, { caseId: "TL-003" }],
        nextCursor: "cursor-003",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        cases: [{ caseId: "TL-004" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const source = new HttpCaseIndexSource({ fetch });

    const feed = await source.loadCases();

    expect(feed.cases.map((entry) => entry.caseId)).toEqual(["TL-001", "TL-002", "TL-003", "TL-004"]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/cases",
      "/api/cases?cursor=cursor-002",
      "/api/cases?cursor=cursor-003",
    ]);
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("rejects repeated pagination cursors instead of looping", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      cases: [{ caseId: "TL-001" }],
      nextCursor: "cursor-cycle",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const source = new HttpCaseIndexSource({ fetch });

    await expect(source.loadCases()).rejects.toThrow(/cursor cycle/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("continues beyond twenty pages until the server ends pagination", async () => {
    let page = 0;
    const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
      page += 1;
      return new Response(JSON.stringify({
        cases: [{ caseId: `TL-${String(page).padStart(3, "0")}` }],
        ...(page <= 20 ? { nextCursor: `cursor-${page}` } : {}),
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const source = new HttpCaseIndexSource({ fetch });

    const feed = await source.loadCases();

    expect(feed.cases).toHaveLength(21);
    expect(feed.cases.at(-1)?.caseId).toBe("TL-021");
    expect(fetch).toHaveBeenCalledTimes(21);
    expect(fetch.mock.calls.at(-1)?.[0]).toBe("/api/cases?cursor=cursor-20");
  });
});
