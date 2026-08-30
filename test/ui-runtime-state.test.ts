import { describe, expect, it, vi } from "vitest";

import {
  classifyFeedProvenance,
  classifyTerminalState,
  retryDelayMs,
} from "../src/ui/runtime-state.js";
import {
  captureRootInteractionState,
  restoreRootInteractionState,
} from "../src/ui/browser-app.js";

describe("ui runtime state", () => {
  it("classifies feed provenance explicitly", () => {
    expect(classifyFeedProvenance("verified")).toBe("live");
    expect(classifyFeedProvenance("reference_fixture_not_live")).toBe("fixture");
    expect(classifyFeedProvenance("")).toBe("unavailable");
    expect(classifyFeedProvenance(undefined)).toBe("unavailable");
  });

  it("maps connection issues into offline, unauthorized, and unavailable", () => {
    expect(classifyTerminalState("Case event feed failed with HTTP 403.", { online: true })).toBe(
      "unauthorized",
    );
    expect(classifyTerminalState("credentials expired", { online: true })).toBe("unauthorized");
    expect(classifyTerminalState("network bridge lost", { online: false })).toBe("offline");
    expect(classifyTerminalState("Case event feed failed with HTTP 503.", { online: true })).toBe(
      "unavailable",
    );
  });

  it("backs off more aggressively for authorization failures than normal polls", () => {
    expect(retryDelayMs(1, "offline", 1_500)).toBe(2_000);
    expect(retryDelayMs(2, "offline", 1_500)).toBe(4_000);
    expect(retryDelayMs(2, "unauthorized", 1_500)).toBe(12_000);
    expect(retryDelayMs(10, "unavailable", 1_500)).toBe(45_000);
  });
  it("preserves focused controls and existing activity disclosure state across rerenders", () => {
    const active = { dataset: { uiKey: "case-TL-042" } };
    const originalDetails = [
      { dataset: { eventId: "evt-01" }, open: true },
      { dataset: { eventId: "evt-02" }, open: false },
    ];
    const captureRoot = {
      ownerDocument: { activeElement: active },
      contains: (candidate: unknown) => candidate === active,
      querySelectorAll: () => originalDetails,
    } as unknown as HTMLElement;
    const state = captureRootInteractionState(captureRoot);

    const focus = vi.fn();
    const restoredDetails = [
      { dataset: { eventId: "evt-01" }, open: false },
      { dataset: { eventId: "evt-02" }, open: true },
      { dataset: { eventId: "evt-03" }, open: true },
    ];
    const restoredFocus = { dataset: { uiKey: "case-TL-042" }, focus };
    const restoreRoot = {
      querySelectorAll: (selector: string) =>
        selector === "details[data-event-id]" ? restoredDetails : [restoredFocus],
    } as unknown as HTMLElement;
    restoreRootInteractionState(restoreRoot, state);

    expect(restoredDetails.map((detail) => detail.open)).toEqual([true, false, true]);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
