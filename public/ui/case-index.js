function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireString(record, field) {
    const value = record[field];
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Case index field ${field} must be a non-empty string.`);
    }
    return value;
}
function optionalString(record, field) {
    const value = record[field];
    if (value === undefined)
        return undefined;
    if (typeof value !== "string") {
        throw new Error(`Case index field ${field} must be a string when supplied.`);
    }
    return value.trim() === "" ? undefined : value;
}
const SUBJECT_FIELDS = [
    "title",
    "name",
    "product",
    "productName",
    "itemNumber",
    "item_number",
    "listingId",
    "listing_id",
];
export function summarizeCaseSubject(value) {
    if (typeof value === "string")
        return value.trim() === "" ? undefined : value.trim().slice(0, 160);
    if (!isRecord(value))
        return undefined;
    const parts = [];
    for (const field of SUBJECT_FIELDS) {
        const candidate = value[field];
        if (typeof candidate !== "string" && typeof candidate !== "number")
            continue;
        const normalized = String(candidate).trim();
        if (normalized !== "" && !parts.includes(normalized))
            parts.push(normalized);
    }
    const summary = parts.join(" / ");
    return summary === "" ? undefined : summary.slice(0, 160);
}
function parseCaseIndexEntry(value) {
    if (!isRecord(value)) {
        throw new Error("Every case index entry must be an object.");
    }
    const createdAt = optionalString(value, "createdAt");
    if (createdAt !== undefined && Number.isNaN(Date.parse(createdAt))) {
        throw new Error(`Case index entry ${String(value.caseId ?? "(unknown)")} has an invalid createdAt timestamp.`);
    }
    return {
        caseId: requireString(value, "caseId"),
        caseType: optionalString(value, "caseType"),
        subject: summarizeCaseSubject(value.subject),
        createdAt,
    };
}
export function parseCaseIndexFeed(value) {
    if (!isRecord(value)) {
        throw new Error("Case index response must be an object.");
    }
    const rawCases = value.cases;
    if (!Array.isArray(rawCases)) {
        throw new Error("Case index response cases must be an array.");
    }
    const cases = rawCases.map((entry) => parseCaseIndexEntry(entry));
    const nextCursor = optionalString(value, "nextCursor");
    return { cases, nextCursor };
}
export class HttpCaseIndexSource {
    #basePath;
    #fetch;
    constructor(options = {}) {
        this.#basePath = options.basePath ?? "/api/cases";
        this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    }
    async loadCases(signal) {
        const response = await this.#fetch(this.#basePath, {
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
                ? `Case index failed with HTTP ${response.status}.`
                : `Case index failed with HTTP ${response.status}: ${detail}`);
        }
        return parseCaseIndexFeed(await response.json());
    }
}
