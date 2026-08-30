/// <reference lib="dom" />
import { HttpCaseEventSource, mergeCaseEvents } from "./case-events.js";
import { CaseIndexPager, HttpCaseIndexSource } from "./case-index.js";
import { buildCaseViewModel } from "./case-model.js";
import { renderCaseHtml, renderEmptyWorkspaceHtml, renderFeedErrorHtml, renderLoadingHtml } from "./render-shell.js";
import { classifyTerminalState, retryDelayMs } from "./runtime-state.js";
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_QUEUE_POLL_INTERVAL_MS = 30_000;
function resolveCaseId(root) {
    const queryCaseId = new URL(window.location.href).searchParams.get("case");
    return queryCaseId?.trim() || root.dataset.caseId?.trim() || undefined;
}
function currentPageHref() {
    return typeof window === "undefined" ? undefined : window.location.href;
}
function isOnline() {
    return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}
function describeDelay(ms) {
    const seconds = ms / 1_000;
    return Number.isInteger(seconds) ? `${seconds} seconds` : `${seconds.toFixed(1)} seconds`;
}
function setConnectionState(target, state, message) {
    target.className = `connection-status connection-status--${state}`;
    target.textContent = message;
}
function terminalMessage(state, detail, delayMs, provenance) {
    if (state === "connected") {
        if (detail.trim() !== "")
            return detail;
        return provenance === "fixture"
            ? "Reference fixture connected. This browser is not showing live evidence."
            : `Read-only case feed connected. Next poll scheduled in ${describeDelay(delayMs ?? DEFAULT_POLL_INTERVAL_MS)}.`;
    }
    if (state === "loading") {
        return "Connecting to the ordered read-only case feed.";
    }
    if (state === "offline") {
        return `The browser is offline or the local feed is unreachable. Retrying in ${describeDelay(delayMs ?? DEFAULT_POLL_INTERVAL_MS)}. ${detail}`;
    }
    if (state === "unauthorized") {
        return `The feed rejected this browser session. Retrying in ${describeDelay(delayMs ?? DEFAULT_POLL_INTERVAL_MS)}. ${detail}`;
    }
    return `The case feed is unavailable from this shell. Retrying in ${describeDelay(delayMs ?? DEFAULT_POLL_INTERVAL_MS)}. ${detail}`;
}
function parseQueueEntries(feed) {
    return feed.cases.map((entry) => ({ ...entry }));
}
export async function loadCaseFeedForPolling(source, caseId, currentRunId, after, signal) {
    const feed = await source.loadCase(caseId, after, signal);
    if (currentRunId === undefined || feed.runId === currentRunId)
        return feed;
    const refreshed = await source.loadCase(caseId, undefined, signal);
    const completeHistory = refreshed.events.length === refreshed.lastSequence &&
        refreshed.events.every((event, index) => event.sequence === index + 1);
    if (!completeHistory) {
        throw new Error("The replacement run did not return a complete event history from cursor zero.");
    }
    return refreshed;
}
export function captureRootInteractionState(root) {
    const activeElement = root.ownerDocument.activeElement;
    const focusKey = activeElement && root.contains(activeElement)
        ? activeElement.dataset.uiKey
        : undefined;
    const activityDetails = {};
    for (const detail of root.querySelectorAll("details[data-event-id]")) {
        const eventId = detail.dataset.eventId;
        if (eventId)
            activityDetails[eventId] = detail.open;
    }
    return { focusKey, activityDetails };
}
export function restoreRootInteractionState(root, state) {
    for (const detail of root.querySelectorAll("details[data-event-id]")) {
        const eventId = detail.dataset.eventId;
        if (eventId && Object.hasOwn(state.activityDetails, eventId)) {
            detail.open = state.activityDetails[eventId] === true;
        }
    }
    if (!state.focusKey)
        return;
    const target = [...root.querySelectorAll("[data-ui-key]")].find((candidate) => candidate.dataset.uiKey === state.focusKey);
    target?.focus({ preventScroll: true });
}
function renderIntoRoot(root, html) {
    const interactionState = captureRootInteractionState(root);
    root.innerHTML = html;
    restoreRootInteractionState(root, interactionState);
}
export function createCaseFileApp({ root, connectionTarget, source = new HttpCaseEventSource(), queueSource = new HttpCaseIndexSource(), caseId = resolveCaseId(root), pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, queuePollIntervalMs = DEFAULT_QUEUE_POLL_INTERVAL_MS, trueForgeExpectedOrigin, }) {
    if (!(root instanceof HTMLElement)) {
        throw new Error("TruthLease requires a valid app root.");
    }
    if (!(connectionTarget instanceof HTMLElement)) {
        throw new Error("TruthLease requires a valid connection status target.");
    }
    const queuePager = new CaseIndexPager(queueSource);
    let activeCaseId = caseId;
    let runId;
    let events = [];
    let lastSequence;
    let pollTimer;
    let queueTimer;
    let controller;
    let queueController;
    let stopped = false;
    let firstLoad = true;
    let currentModel = undefined;
    let consecutiveFailures = 0;
    let currentTerminalState = "loading";
    let currentTerminalDetail = "Connecting to the ordered read-only case feed.";
    let currentDelayMs = pollIntervalMs;
    let queueState = "loading";
    let queueCases = [];
    let queueHasMore = false;
    let queueLoadingMore = false;
    let queueContinuationError;
    let lastAttemptAt;
    let lastSuccessAt;
    let nextRetryAt;
    let emptyWorkspaceRendered = false;
    function renderCurrent(state, detail, delayMs) {
        currentTerminalState = state;
        currentTerminalDetail = detail;
        currentDelayMs = delayMs ?? currentDelayMs;
        const provenance = currentModel?.provenance ?? "unavailable";
        const runtime = {
            feedProvenance: provenance,
            terminalState: state,
            connectionMessage: terminalMessage(state, detail, currentDelayMs, provenance),
            nextRetryAt,
            lastAttemptAt,
            lastSuccessAt,
            pageHref: currentPageHref(),
            trueForgeExpectedOrigin,
            queueCases,
            queueState,
            queueHasMore,
            queueLoadingMore,
            queueContinuationError,
        };
        if (currentModel) {
            emptyWorkspaceRendered = false;
            renderIntoRoot(root, renderCaseHtml(currentModel, runtime));
        }
        else if (!activeCaseId && (queueState === "ready" || queueCases.length > 0)) {
            if (!emptyWorkspaceRendered)
                renderIntoRoot(root, renderEmptyWorkspaceHtml(runtime));
            emptyWorkspaceRendered = true;
        }
        else if (state === "loading") {
            emptyWorkspaceRendered = false;
            renderIntoRoot(root, renderLoadingHtml(activeCaseId, runtime));
        }
        else {
            emptyWorkspaceRendered = false;
            renderIntoRoot(root, renderFeedErrorHtml(activeCaseId ?? "No selected case", detail, runtime));
        }
        setConnectionState(connectionTarget, state, runtime.connectionMessage);
    }
    function applyQueueFeed(feed) {
        const nextCases = parseQueueEntries(feed);
        const changed = queueHasMore !== (feed.nextCursor !== undefined) ||
            JSON.stringify(queueCases) !== JSON.stringify(nextCases);
        queueCases = nextCases;
        queueHasMore = feed.nextCursor !== undefined;
        return changed;
    }
    function scheduleQueueRefresh(delayMs) {
        queueTimer = window.setTimeout(() => void refreshQueue(false), delayMs);
    }
    async function refreshQueue(resetContinuation = false) {
        if (stopped)
            return;
        if (queueTimer !== undefined) {
            window.clearTimeout(queueTimer);
            queueTimer = undefined;
        }
        queueController?.abort();
        queueController = new AbortController();
        const queueSignal = queueController.signal;
        const queueDelayMs = Math.max(queuePollIntervalMs, 10_000);
        try {
            const feed = await queuePager.refreshFirstPage({ resetContinuation }, queueSignal);
            if (queueSignal.aborted || stopped)
                return;
            const changed = applyQueueFeed(feed);
            queueState = "ready";
            queueLoadingMore = false;
            queueContinuationError = undefined;
            lastAttemptAt = new Date().toISOString();
            lastSuccessAt = lastAttemptAt;
            if (changed || resetContinuation)
                emptyWorkspaceRendered = false;
            if (!activeCaseId) {
                nextRetryAt = new Date(Date.now() + queueDelayMs).toISOString();
                renderCurrent("connected", queueCases.length === 0
                    ? "Append-only ledger connected. No case records have been recorded yet."
                    : `Append-only ledger connected. ${queueCases.length} recorded cases loaded.`, queueDelayMs);
                scheduleQueueRefresh(queueDelayMs);
                return;
            }
            renderCurrent(currentTerminalState, currentTerminalDetail, currentDelayMs);
            scheduleQueueRefresh(queueDelayMs);
        }
        catch (error) {
            if (queueSignal.aborted || stopped)
                return;
            queueState = "unavailable";
            queueLoadingMore = false;
            const detail = error instanceof Error ? error.message : "Unknown case index error.";
            emptyWorkspaceRendered = false;
            if (!activeCaseId) {
                nextRetryAt = new Date(Date.now() + queueDelayMs).toISOString();
                renderCurrent(classifyTerminalState(detail, { online: isOnline() }), detail, queueDelayMs);
                scheduleQueueRefresh(queueDelayMs);
            }
            else {
                renderCurrent(currentTerminalState, currentTerminalDetail, currentDelayMs);
                scheduleQueueRefresh(queueDelayMs);
            }
        }
        finally {
            queueController = undefined;
        }
    }
    async function loadMoreQueue() {
        if (stopped || queueLoadingMore || !queueHasMore)
            return;
        if (queueTimer !== undefined) {
            window.clearTimeout(queueTimer);
            queueTimer = undefined;
        }
        queueController?.abort();
        queueController = new AbortController();
        const queueSignal = queueController.signal;
        const queueDelayMs = Math.max(queuePollIntervalMs, 10_000);
        queueLoadingMore = true;
        queueContinuationError = undefined;
        emptyWorkspaceRendered = false;
        renderCurrent(currentTerminalState, currentTerminalDetail, currentDelayMs);
        try {
            const feed = await queuePager.loadNextPage(queueSignal);
            if (queueSignal.aborted || stopped)
                return;
            applyQueueFeed(feed);
            queueState = "ready";
            queueLoadingMore = false;
            lastAttemptAt = new Date().toISOString();
            lastSuccessAt = lastAttemptAt;
        }
        catch (error) {
            if (queueSignal.aborted || stopped)
                return;
            queueLoadingMore = false;
            queueContinuationError = error instanceof Error ? error.message : "Unknown pagination error.";
        }
        finally {
            queueController = undefined;
            if (!stopped) {
                emptyWorkspaceRendered = false;
                renderCurrent(currentTerminalState, currentTerminalDetail, currentDelayMs);
                scheduleQueueRefresh(queueDelayMs);
            }
        }
    }
    function applyCaseFilters() {
        const search = (root.querySelector("[data-case-search]")?.value ?? "").trim().toLowerCase();
        const selectedType = root.querySelector("[data-case-type-filter]")?.value ?? "";
        const rows = [...root.querySelectorAll("[data-case-row]")];
        let visible = 0;
        for (const row of rows) {
            const searchValue = (row.dataset.caseSearchValue ?? row.textContent ?? "").toLowerCase();
            const caseType = row.dataset.caseType ?? "";
            const matches = (!search || searchValue.includes(search)) && (!selectedType || caseType === selectedType);
            row.hidden = !matches;
            if (matches)
                visible += 1;
        }
        const noMatches = root.querySelector("[data-case-no-matches]");
        if (noMatches)
            noMatches.hidden = rows.length === 0 || visible > 0;
        const resultCount = root.querySelector("[data-case-result-count]");
        if (resultCount && rows.length > 0) {
            resultCount.textContent = visible === rows.length ? `${rows.length} loaded cases` : `${visible} of ${rows.length} loaded cases`;
        }
    }
    function handleCaseFilter(event) {
        if (!(event.target instanceof Element))
            return;
        if (event.target.matches("[data-case-search], [data-case-type-filter]"))
            applyCaseFilters();
    }
    function handleConsoleClick(event) {
        if (!(event.target instanceof Element))
            return;
        const refresh = event.target.closest("[data-case-refresh]");
        if (refresh) {
            refresh.disabled = true;
            setConnectionState(connectionTarget, "loading", "Refreshing the recorded case index.");
            void refreshQueue(true);
            return;
        }
        const loadMore = event.target.closest("[data-case-load-more]");
        if (loadMore)
            void loadMoreQueue();
    }
    async function poll() {
        if (stopped || !activeCaseId)
            return;
        const attemptStartedAt = new Date();
        lastAttemptAt = attemptStartedAt.toISOString();
        controller = new AbortController();
        let delayMs = pollIntervalMs;
        try {
            const previousRunId = runId;
            const previousLastSequence = lastSequence;
            const previousEventCount = events.length;
            const previousStatus = currentModel?.feedStatus;
            const feed = await loadCaseFeedForPolling(source, activeCaseId, runId, runId ? lastSequence : undefined, controller.signal);
            if (controller.signal.aborted || stopped)
                return;
            if (runId && feed.runId !== runId) {
                events = [];
                lastSequence = undefined;
            }
            runId = feed.runId;
            events = mergeCaseEvents(events, feed.events);
            lastSequence = feed.lastSequence;
            currentModel = buildCaseViewModel({ ...feed, events });
            consecutiveFailures = 0;
            delayMs = pollIntervalMs;
            lastSuccessAt = new Date().toISOString();
            nextRetryAt = new Date(Date.now() + delayMs).toISOString();
            const feedChanged = previousRunId !== feed.runId ||
                previousLastSequence !== feed.lastSequence ||
                previousEventCount !== events.length ||
                previousStatus !== feed.status;
            if (feedChanged) {
                renderCurrent("connected", "", delayMs);
            }
            else {
                currentTerminalState = "connected";
                currentTerminalDetail = "";
                currentDelayMs = delayMs;
                setConnectionState(connectionTarget, "connected", terminalMessage("connected", "", delayMs, currentModel.provenance));
            }
            firstLoad = false;
        }
        catch (error) {
            if (controller.signal.aborted || stopped)
                return;
            consecutiveFailures += 1;
            const detail = error instanceof Error ? error.message : "Unknown case feed error.";
            const state = classifyTerminalState(detail, { online: isOnline() });
            delayMs = retryDelayMs(consecutiveFailures, state, pollIntervalMs);
            nextRetryAt = new Date(Date.now() + delayMs).toISOString();
            renderCurrent(state, detail, delayMs);
        }
        finally {
            controller = undefined;
            if (!stopped) {
                pollTimer = window.setTimeout(poll, delayMs);
            }
        }
    }
    function stop() {
        stopped = true;
        if (pollTimer !== undefined)
            window.clearTimeout(pollTimer);
        if (queueTimer !== undefined)
            window.clearTimeout(queueTimer);
        controller?.abort();
        queueController?.abort();
    }
    root.addEventListener("input", handleCaseFilter);
    root.addEventListener("change", handleCaseFilter);
    root.addEventListener("click", handleConsoleClick);
    renderCurrent("loading", "Connecting to the append-only operational ledger.", pollIntervalMs);
    void refreshQueue(true);
    if (activeCaseId)
        void poll();
    return { stop, pollNow: poll, refreshQueueNow: () => refreshQueue(true), loadMoreQueueNow: loadMoreQueue };
}
export function autoStartCaseFileApp() {
    if (typeof window === "undefined" || typeof document === "undefined")
        return;
    const root = document.querySelector("#app");
    const connectionTarget = document.querySelector("#connection-status");
    if (!(root instanceof HTMLElement) || !(connectionTarget instanceof HTMLElement))
        return;
    const app = createCaseFileApp({ root, connectionTarget });
    window.addEventListener("pagehide", () => app.stop(), { once: true });
}
