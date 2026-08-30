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
});
