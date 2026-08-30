export interface CaseIndexEntry {
  caseId: string;
  caseType?: string;
  subject?: string;
  createdAt?: string;
}

export interface CaseIndexFeed {
  cases: CaseIndexEntry[];
  nextCursor?: string;
}

export type FetchCaseIndex = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

const MAX_CASE_INDEX_PAGES = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Case index field ${field} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
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
] as const;

export function summarizeCaseSubject(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value.trim().slice(0, 160);
  if (!isRecord(value)) return undefined;
  const parts: string[] = [];
  for (const field of SUBJECT_FIELDS) {
    const candidate = value[field];
    if (typeof candidate !== "string" && typeof candidate !== "number") continue;
    const normalized = String(candidate).trim();
    if (normalized !== "" && !parts.includes(normalized)) parts.push(normalized);
  }
  const summary = parts.join(" / ");
  return summary === "" ? undefined : summary.slice(0, 160);
}

function parseCaseIndexEntry(value: unknown): CaseIndexEntry {
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

export function parseCaseIndexFeed(value: unknown): CaseIndexFeed {
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
  readonly #basePath: string;
  readonly #fetch: FetchCaseIndex;

  constructor(options: { basePath?: string; fetch?: FetchCaseIndex } = {}) {
    this.#basePath = options.basePath ?? "/api/cases";
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async loadCases(signal?: AbortSignal): Promise<CaseIndexFeed> {
    const cases: CaseIndexEntry[] = [];
    const caseIds = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;

    for (let pageNumber = 0; pageNumber < MAX_CASE_INDEX_PAGES; pageNumber += 1) {
      const separator = this.#basePath.includes("?") ? "&" : "?";
      const url = cursor === undefined
        ? this.#basePath
        : `${this.#basePath}${separator}cursor=${encodeURIComponent(cursor)}`;
      const response = await this.#fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal,
      });

      if (!response.ok) {
        let detail: string | undefined;
        try {
          const body = (await response.json()) as unknown;
          if (isRecord(body) && typeof body.error === "string" && body.error.trim() !== "") {
            detail = body.error;
          }
        } catch {
          // Non-JSON error responses still retain their authoritative HTTP status.
        }
        throw new Error(
          detail === undefined
            ? `Case index failed with HTTP ${response.status}.`
            : `Case index failed with HTTP ${response.status}: ${detail}`,
        );
      }

      const page = parseCaseIndexFeed(await response.json());
      for (const entry of page.cases) {
        if (caseIds.has(entry.caseId)) continue;
        caseIds.add(entry.caseId);
        cases.push(entry);
      }

      if (page.nextCursor === undefined) return { cases };
      if (cursors.has(page.nextCursor)) {
        throw new Error("Case index pagination returned a cursor cycle.");
      }
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    throw new Error(`Case index pagination exceeded the ${MAX_CASE_INDEX_PAGES}-page safety limit.`);
  }
}
