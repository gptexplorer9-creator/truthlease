import { HttpCaseEventSource, mergeCaseEvents } from "/ui/case-events.js";
import { buildCaseViewModel } from "/ui/case-model.js";
import { renderCaseHtml, renderFeedErrorHtml, renderLoadingHtml } from "/ui/render-case.js";

const DEFAULT_POLL_INTERVAL_MS = 1_500;

function resolveCaseId(root) {
  const queryCaseId = new URL(window.location.href).searchParams.get("case");
  return queryCaseId?.trim() || root.dataset.caseId?.trim() || "TL-042";
}

function setConnectionState(target, state, message) {
  target.className = `connection-status connection-status--${state}`;
  target.textContent = message;
}

export function createCaseFileApp({
  root,
  connectionTarget,
  source = new HttpCaseEventSource(),
  caseId = resolveCaseId(root),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
} = {}) {
  if (!(root instanceof HTMLElement)) {
    throw new Error("TruthLease requires a valid app root.");
  }
  if (!(connectionTarget instanceof HTMLElement)) {
    throw new Error("TruthLease requires a valid connection status target.");
  }

  let runId;
  let events = [];
  let lastSequence;
  let timer;
  let controller;
  let stopped = false;
  let firstLoad = true;
  let renderedSignature;

  root.innerHTML = renderLoadingHtml(caseId);
  setConnectionState(connectionTarget, "loading", "Connecting to the read-only case feed...");

  async function poll() {
    if (stopped) return;
    controller = new AbortController();
    try {
      const feed = await source.loadCase(caseId, runId ? lastSequence : undefined, controller.signal);
      if (runId && feed.runId !== runId) {
        events = [];
        lastSequence = undefined;
      }
      runId = feed.runId;
      events = mergeCaseEvents(events, feed.events);
      lastSequence = feed.lastSequence;
      const nextSignature = `${feed.runId}:${feed.status}:${feed.lastSequence}:${events.length}`;
      if (nextSignature !== renderedSignature) {
        const model = buildCaseViewModel({ ...feed, events });
        root.innerHTML = renderCaseHtml(model);
        renderedSignature = nextSignature;
      }
      setConnectionState(connectionTarget, "connected", `Live feed connected. Last sequence ${feed.lastSequence}.`);
      firstLoad = false;
    } catch (error) {
      if (controller.signal.aborted || stopped) return;
      const message = error instanceof Error ? error.message : "Unknown case feed error.";
      if (firstLoad) {
        root.innerHTML = renderFeedErrorHtml(caseId, message);
      }
      setConnectionState(connectionTarget, "error", `Feed connection issue: ${message}`);
    } finally {
      controller = undefined;
      if (!stopped) timer = window.setTimeout(poll, pollIntervalMs);
    }
  }

  function stop() {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
    controller?.abort();
  }

  void poll();
  return { stop, pollNow: poll };
}

const root = document.querySelector("#app");
const connectionTarget = document.querySelector("#connection-status");
const app = createCaseFileApp({ root, connectionTarget });
window.addEventListener("pagehide", () => app.stop(), { once: true });
