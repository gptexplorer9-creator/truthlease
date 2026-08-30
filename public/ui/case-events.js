export const RUN_EVENT_TYPES = [
    "state.snapshot",
    "evidence.fetched",
    "evidence.failed",
    "analysis.completed",
    "analysis.failed",
    "approval.required",
    "approval.resolved",
    "patch.applied",
    "patch.failed",
    "verification.completed",
    "verification.failed",
];
const EVENT_TYPE_SET = new Set(RUN_EVENT_TYPES);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireString(record, field) {
    const value = record[field];
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Case event feed field ${field} must be a non-empty string.`);
    }
    return value;
}
function requireSequence(record, field) {
    const value = record[field];
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        throw new Error(`Case event feed field ${field} must be a non-negative safe integer.`);
    }
    return Number(value);
}
function parseRunEvent(value, feedRunId) {
    if (!isRecord(value)) {
        throw new Error("Every case event must be an object.");
    }
    const type = requireString(value, "type");
    if (!EVENT_TYPE_SET.has(type)) {
        throw new Error(`Unsupported TruthLease event type: ${type}.`);
    }
    const runId = requireString(value, "runId");
    if (runId !== feedRunId) {
        throw new Error(`Event ${String(value.id ?? "(unknown)")} belongs to a different run.`);
    }
    const payload = value.payload;
    if (!isRecord(payload)) {
        throw new Error(`Event ${String(value.id ?? "(unknown)")} payload must be an object.`);
    }
    const timestamp = requireString(value, "timestamp");
    if (Number.isNaN(Date.parse(timestamp))) {
        throw new Error(`Event ${String(value.id ?? "(unknown)")} has an invalid timestamp.`);
    }
    return {
        type: type,
        id: requireString(value, "id"),
        timestamp,
        runId,
        sequence: requireSequence(value, "sequence"),
        payload: payload,
    };
}
export function parseCaseEventFeed(value) {
    if (!isRecord(value)) {
        throw new Error("Case event feed response must be an object.");
    }
    const runId = requireString(value, "runId");
    const rawEvents = value.events;
    if (!Array.isArray(rawEvents)) {
        throw new Error("Case event feed events must be an array.");
    }
    const events = rawEvents.map((event) => parseRunEvent(event, runId));
    const eventIds = new Set();
    for (let index = 1; index < events.length; index += 1) {
        const previous = events[index - 1];
        const current = events[index];
        if (!previous || !current || current.sequence <= previous.sequence) {
            throw new Error("Case events must be strictly ordered by sequence.");
        }
    }
    for (const event of events) {
        if (eventIds.has(event.id)) {
            throw new Error(`Case event ID ${event.id} appears more than once in the feed.`);
        }
        eventIds.add(event.id);
    }
    const lastSequence = requireSequence(value, "lastSequence");
    const finalEvent = events.at(-1);
    if (finalEvent && lastSequence < finalEvent.sequence) {
        throw new Error("Case event feed lastSequence is behind the final event.");
    }
    return {
        caseId: requireString(value, "caseId"),
        runId,
        status: requireString(value, "status"),
        lastSequence,
        events,
    };
}
export class HttpCaseEventSource {
    #basePath;
    #fetch;
    constructor(options = {}) {
        this.#basePath = (options.basePath ?? "/api/cases").replace(/\/$/, "");
        this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    }
    async loadCase(leaseId, after, signal) {
        if (leaseId.trim() === "") {
            throw new Error("A lease ID is required to load a TruthLease case.");
        }
        if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) {
            throw new Error("The after cursor must be a non-negative safe integer.");
        }
        const path = `${this.#basePath}/${encodeURIComponent(leaseId)}/events`;
        const url = after === undefined ? path : `${path}?after=${encodeURIComponent(String(after))}`;
        const response = await this.#fetch(url, {
            method: "GET",
            headers: { accept: "application/json" },
            signal,
        });
        if (!response.ok) {
            let detail;
            try {
                const body = (await response.json());
                if (isRecord(body) && typeof body.error === "string" && body.error.trim() !== "") {
                    detail = body.error;
                }
            }
            catch {
                // Non-JSON error responses still retain their authoritative HTTP status.
            }
            throw new Error(detail === undefined
                ? `Case event feed failed with HTTP ${response.status}.`
                : `Case event feed failed with HTTP ${response.status}: ${detail}`);
        }
        return parseCaseEventFeed(await response.json());
    }
}
export class FixtureCaseEventSource {
    #feed;
    constructor(feed) {
        this.#feed = parseCaseEventFeed(feed);
    }
    async loadCase(leaseId, after) {
        if (leaseId !== this.#feed.caseId) {
            throw new Error(`Fixture does not contain case ${leaseId}.`);
        }
        const events = after === undefined
            ? [...this.#feed.events]
            : this.#feed.events.filter((event) => event.sequence > after);
        return { ...this.#feed, events };
    }
}
export function mergeCaseEvents(current, incoming) {
    if (incoming.length === 0) {
        return [...current];
    }
    const merged = [...current];
    const seen = new Map(current.map((event) => [event.id, event]));
    let lastSequence = current.at(-1)?.sequence ?? -1;
    for (const event of incoming) {
        const duplicate = seen.get(event.id);
        if (duplicate) {
            if (eventFingerprint(duplicate) !== eventFingerprint(event)) {
                throw new Error(`Event ID ${event.id} was reused with different semantics.`);
            }
            continue;
        }
        if (event.sequence <= lastSequence) {
            throw new Error("Incoming case events are not strictly newer than rendered events.");
        }
        merged.push(event);
        seen.set(event.id, event);
        lastSequence = event.sequence;
    }
    return merged;
}
function stableJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
    }
    if (typeof value === "object" && value !== null) {
        const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
function eventFingerprint(event) {
    return `${event.type}|${event.sequence}|${event.timestamp}|${event.runId}|${stableJson(event.payload)}`;
}
