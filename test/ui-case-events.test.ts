import { describe, expect, it, vi } from "vitest";

import {
  FixtureCaseEventSource,
  HttpCaseEventSource,
  mergeCaseEvents,
  parseCaseEventFeed,
} from "../src/ui/case-events.js";
import { completeEvents, completeFeed, fixtureEvent } from "./ui-fixtures.js";

describe("case event transport", () => {
  it("accepts one strictly ordered, single-run feed", () => {
    const parsed = parseCaseEventFeed(completeFeed());
    expect(parsed.events).toHaveLength(7);
    expect(parsed.events.at(-1)?.type).toBe("verification.completed");
  });

  it("rejects unknown event names, cross-run events, and non-increasing sequences", () => {
    expect(() =>
      parseCaseEventFeed({
        ...completeFeed(),
        events: [{ ...completeEvents[0], type: "approval.fabricated" }],
      }),
    ).toThrow(/Unsupported TruthLease event type/);

    expect(() =>
      parseCaseEventFeed({
        ...completeFeed(),
        events: [{ ...completeEvents[0], runId: "another-run" }],
      }),
    ).toThrow(/different run/);

    expect(() =>
      parseCaseEventFeed({
        ...completeFeed(),
        events: [completeEvents[1], completeEvents[0]],
      }),
    ).toThrow(/strictly ordered/);

    expect(() =>
      parseCaseEventFeed({
        ...completeFeed(),
        events: [completeEvents[0], { ...completeEvents[1]!, id: completeEvents[0]!.id }],
      }),
    ).toThrow(/appears more than once/);
  });

  it("uses only GET on the same-origin case feed and supports an after cursor", async () => {
    const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(completeFeed([completeEvents[6]!])), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const source = new HttpCaseEventSource({ fetch });

    await source.loadCase("TL-042", 6);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/cases/TL-042/events?after=6");
    expect(init).toMatchObject({ method: "GET", headers: { accept: "application/json" } });
    expect(JSON.stringify(init)).not.toContain("apply_containment_patch");
  });

  it("filters deterministic fixture events without mutating the fixture", async () => {
    const source = new FixtureCaseEventSource(completeFeed());
    const delta = await source.loadCase("TL-042", 4);
    const full = await source.loadCase("TL-042");

    expect(delta.events.map((event) => event.sequence)).toEqual([5, 6, 7]);
    expect(full.events).toHaveLength(7);
  });

  it("merges only newer event IDs and rejects semantic ID reuse", () => {
    expect(mergeCaseEvents(completeEvents.slice(0, 2), completeEvents.slice(2))).toHaveLength(7);
    expect(
      mergeCaseEvents(completeEvents.slice(0, 2), [completeEvents[1]!, ...completeEvents.slice(2)]),
    ).toHaveLength(7);

    expect(() =>
      mergeCaseEvents(completeEvents.slice(0, 2), [
        { ...fixtureEvent(3, "analysis.completed", {}), id: completeEvents[1]!.id },
      ]),
    ).toThrow(/reused with different semantics/);

    expect(() =>
      mergeCaseEvents(completeEvents.slice(0, 2), [
        { ...completeEvents[1]!, payload: { changed: true } },
      ]),
    ).toThrow(/reused with different semantics/);
  });
});
