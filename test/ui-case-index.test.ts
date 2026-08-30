import { describe, expect, it, vi } from "vitest";

import { CaseIndexPager, HttpCaseIndexSource, parseCaseIndexFeed } from "../src/ui/case-index.js";

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

    await source.loadPage();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/cases");
    expect(init).toMatchObject({ method: "GET", headers: { accept: "application/json" } });
  });

  it("loads explicit continuation pages and deduplicates repeated case IDs", async () => {
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
    const pager = new CaseIndexPager(new HttpCaseIndexSource({ fetch }));

    await pager.refreshFirstPage({ resetContinuation: true });
    await pager.loadNextPage();
    const feed = await pager.loadNextPage();

    expect(feed.cases.map((entry) => entry.caseId)).toEqual(["TL-001", "TL-002", "TL-003", "TL-004"]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/cases",
      "/api/cases?cursor=cursor-002",
      "/api/cases?cursor=cursor-003",
    ]);
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("rejects repeated pagination cursors instead of looping", async () => {
    const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify({
      cases: [{ caseId: "TL-001" }],
      nextCursor: "cursor-cycle",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const pager = new CaseIndexPager(new HttpCaseIndexSource({ fetch }));

    await pager.refreshFirstPage({ resetContinuation: true });
    await expect(pager.loadNextPage()).rejects.toThrow(/cursor cycle/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("discovers more than one thousand cases through explicit bounded page requests", async () => {
    let page = 0;
    const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
      page += 1;
      const first = (page - 1) * 100 + 1;
      return new Response(JSON.stringify({
        cases: Array.from({ length: 100 }, (_, index) => ({
          caseId: `TL-${String(first + index).padStart(4, "0")}`,
        })),
        ...(page <= 10 ? { nextCursor: `cursor-${page}` } : {}),
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const pager = new CaseIndexPager(new HttpCaseIndexSource({ fetch }));

    let feed = await pager.refreshFirstPage({ resetContinuation: true });
    while (feed.nextCursor !== undefined) feed = await pager.loadNextPage();

    expect(feed.cases).toHaveLength(1_100);
    expect(feed.cases.at(-1)?.caseId).toBe("TL-1100");
    expect(fetch).toHaveBeenCalledTimes(11);
    expect(fetch.mock.calls.at(-1)?.[0]).toBe("/api/cases?cursor=cursor-10");
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("keeps repeated periodic refreshes bounded to page one", async () => {
    const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify({
      cases: [{ caseId: "TL-NEWEST" }],
      nextCursor: "cursor-next",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const pager = new CaseIndexPager(new HttpCaseIndexSource({ fetch }));

    await pager.refreshFirstPage({ resetContinuation: true });
    await pager.refreshFirstPage();
    const feed = await pager.refreshFirstPage();

    expect(feed.cases).toEqual([{ caseId: "TL-NEWEST" }]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/cases", "/api/cases", "/api/cases"]);
  });
});
