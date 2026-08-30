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

export interface CaseIndexSource {
  loadPage(cursor?: string, signal?: AbortSignal): Promise<CaseIndexFeed>;
}

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

export class HttpCaseIndexSource implements CaseIndexSource {
  readonly #basePath: string;
  readonly #fetch: FetchCaseIndex;

  constructor(options: { basePath?: string; fetch?: FetchCaseIndex } = {}) {
    this.#basePath = options.basePath ?? "/api/cases";
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async loadPage(cursor?: string, signal?: AbortSignal): Promise<CaseIndexFeed> {
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

    return parseCaseIndexFeed(await response.json());
  }
}

export class CaseIndexPager {
  readonly #source: CaseIndexSource;
  #cases: CaseIndexEntry[] = [];
  #nextCursor: string | undefined;
  #requestedCursors = new Set<string>();
  #hasAdvanced = false;

  constructor(source: CaseIndexSource) {
    this.#source = source;
  }

  get snapshot(): CaseIndexFeed {
    return {
      cases: this.#cases.map((entry) => ({ ...entry })),
      ...(this.#nextCursor === undefined ? {} : { nextCursor: this.#nextCursor }),
    };
  }

  async refreshFirstPage(
    options: { resetContinuation?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<CaseIndexFeed> {
    const page = await this.#source.loadPage(undefined, signal);
    this.#cases = deduplicateCases([...page.cases, ...this.#cases]);
    if (options.resetContinuation === true || !this.#hasAdvanced) {
      this.#nextCursor = page.nextCursor;
      this.#requestedCursors.clear();
      this.#hasAdvanced = false;
    }
    return this.snapshot;
  }

  async loadNextPage(signal?: AbortSignal): Promise<CaseIndexFeed> {
    const cursor = this.#nextCursor;
    if (cursor === undefined) return this.snapshot;
    if (this.#requestedCursors.has(cursor)) {
      throw new Error("Case index pagination returned a cursor cycle.");
    }

    const page = await this.#source.loadPage(cursor, signal);
    this.#requestedCursors.add(cursor);
    if (page.nextCursor !== undefined && this.#requestedCursors.has(page.nextCursor)) {
      throw new Error("Case index pagination returned a cursor cycle.");
    }

    this.#cases = deduplicateCases([...this.#cases, ...page.cases]);
    this.#nextCursor = page.nextCursor;
    this.#hasAdvanced = true;
    return this.snapshot;
  }
}

function deduplicateCases(entries: readonly CaseIndexEntry[]): CaseIndexEntry[] {
  const caseIds = new Set<string>();
  const cases: CaseIndexEntry[] = [];
  for (const entry of entries) {
    if (caseIds.has(entry.caseId)) continue;
    caseIds.add(entry.caseId);
    cases.push({ ...entry });
  }
  return cases;
}
