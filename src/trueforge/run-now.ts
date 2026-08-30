const REQUIRED_CASE_ID = "TL-042";
const REQUIRED_AGENT_NAME = "truthlease-recall-monitor";
const REQUIRED_MCP_SERVERS = ["bright-data", "truthlease-local"] as const;
const DEFAULT_COOLDOWN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const TURN_REQUEST_TIMEOUT_MS = 120_000;

type UnknownRecord = Record<string, unknown>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: UnknownRecord | undefined, key: string): string {
  const value = record?.[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new RunNowError("invalid_response", `TrueForge response omitted ${key}.`, 502);
  }
  return value;
}

function responseData(response: UnknownRecord): UnknownRecord {
  return isRecord(response.data) ? response.data : response;
}

function exactLoopbackOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new RunNowError("invalid_trueforge_url", "TrueForge must use an exact HTTP loopback origin.", 503, cause);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(host) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new RunNowError("invalid_trueforge_url", "TrueForge must use an exact credential-free HTTP loopback origin.", 503);
  }
  return url;
}

async function readJson(response: Response): Promise<UnknownRecord> {
  const raw = await response.text();
  let value: unknown;
  try {
    value = raw === "" ? {} : JSON.parse(raw);
  } catch (cause) {
    throw new RunNowError("invalid_response", "TrueForge returned invalid JSON.", 502, cause);
  }
  if (!isRecord(value)) {
    throw new RunNowError("invalid_response", "TrueForge returned an invalid response object.", 502);
  }
  if (!response.ok) {
    const message = typeof value.message === "string"
      ? value.message
      : typeof value.error === "string"
        ? value.error
        : `TrueForge rejected the request (${response.status}).`;
    throw new RunNowError("trueforge_rejected", message, response.status >= 500 ? 502 : 503);
  }
  return value;
}

export class RunNowError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

export interface RunNowReadiness {
  enabled: true;
  ready: boolean;
  reason?: string;
  agentName: string;
  activeSessionId?: string;
  approvalUrl?: string;
  cooldownRemainingMs: number;
}

export interface RunNowResult {
  caseId: string;
  sessionId: string;
  turnId: string;
  turnStatus: string;
  approvalUrl: string;
  startedAt: string;
}

export interface RunNowService {
  status(): Promise<RunNowReadiness>;
  start(caseId: string): Promise<RunNowResult>;
  currentSessionId(): string | undefined;
}

export interface TrueForgeRunNowOptions {
  baseUrl: string;
  agentName?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  cooldownMs?: number;
}

export class TrueForgeRunNowService implements RunNowService {
  private readonly baseUrl: URL;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly cooldownMs: number;
  private readonly agentName: string;
  private activeSession: string | undefined;
  private lastStartedAt: number | undefined;
  private starting = false;

  public constructor(options: TrueForgeRunNowOptions) {
    this.baseUrl = exactLoopbackOrigin(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.cooldownMs = Math.max(1_000, options.cooldownMs ?? DEFAULT_COOLDOWN_MS);
    this.agentName = options.agentName?.trim() || REQUIRED_AGENT_NAME;
  }

  public currentSessionId(): string | undefined {
    return this.activeSession;
  }

  public async status(): Promise<RunNowReadiness> {
    return this.readinessStatus(true);
  }

  private async readinessStatus(checkStarting: boolean): Promise<RunNowReadiness> {
    const cooldownRemainingMs = this.cooldownRemainingMs();
    try {
      const [health, models, mcpServers, agents] = await Promise.all([
        this.health(),
        this.get("/api/v1/settings/model-providers"),
        this.get("/api/v1/settings/mcp-servers"),
        this.get("/api/v1/agents"),
      ]);
      if (!health) return this.readiness(false, "TrueForge health check did not pass.", cooldownRemainingMs);
      const modelData = Array.isArray(models.data) ? models.data : [];
      if (modelData.length === 0) return this.readiness(false, "Connect an OpenAI model provider in TrueForge.", cooldownRemainingMs);
      const configuredMcp = new Set(
        (Array.isArray(mcpServers.data) ? mcpServers.data : [])
          .map((entry) => isRecord(entry) && typeof entry.name === "string" ? entry.name : undefined)
          .filter((name): name is string => name !== undefined),
      );
      const missingMcp = REQUIRED_MCP_SERVERS.filter((name) => !configuredMcp.has(name));
      if (missingMcp.length > 0) {
        return this.readiness(false, `Connect required TrueForge MCP server(s): ${missingMcp.join(", ")}.`, cooldownRemainingMs);
      }
      const configuredAgents = new Set(
        (Array.isArray(agents.data) ? agents.data : [])
          .map((entry) => isRecord(entry) && typeof entry.name === "string" ? entry.name : undefined)
          .filter((name): name is string => name !== undefined),
      );
      if (!configuredAgents.has(this.agentName)) {
        return this.readiness(false, `Create the configured TrueForge agent ${this.agentName}.`, cooldownRemainingMs);
      }
      if (checkStarting && this.starting) {
        return this.readiness(false, "A genuine run is already starting.", cooldownRemainingMs);
      }
      if (cooldownRemainingMs > 0) return this.readiness(false, "Run Now is cooling down before another external investigation.", cooldownRemainingMs);
      return this.readiness(true, undefined, 0);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "TrueForge readiness check failed.";
      return this.readiness(false, reason, cooldownRemainingMs);
    }
  }

  public async start(caseId: string): Promise<RunNowResult> {
    if (caseId !== REQUIRED_CASE_ID) {
      throw new RunNowError("unsupported_case", `Run Now is restricted to ${REQUIRED_CASE_ID}.`, 400);
    }
    if (this.starting) throw new RunNowError("run_in_progress", "A genuine run is already starting.", 409);
    this.starting = true;
    let boundSessionId: string | undefined;
    try {
      const readiness = await this.readinessStatus(false);
      if (!readiness.ready) throw new RunNowError("run_not_ready", readiness.reason ?? "Run Now is not ready.", 503);
      const sessionResponse = await this.post("/api/v1/sessions", { agent: { name: this.agentName } });
      const sessionData = responseData(sessionResponse);
      const sessionId = requiredString(sessionData, "id");
      boundSessionId = sessionId;
      this.activeSession = sessionId;
      this.lastStartedAt = this.now().getTime();
      const turnResponse = await this.post(`/api/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
        input: [{ type: "user.message", content: runPrompt(caseId) }],
        previous_turn_id: "none",
        stream: false,
      }, TURN_REQUEST_TIMEOUT_MS);
      const turnData = responseData(turnResponse);
      const turnId = requiredString(turnData, "id");
      const state = isRecord(turnData?.state) ? turnData.state : undefined;
      const turnStatus = requiredString(state, "status");
      if (!new Set(["running", "done"]).has(turnStatus)) {
        throw new RunNowError("invalid_turn_state", `TrueForge returned unexpected turn state ${turnStatus}.`, 502);
      }
      const startedAt = this.now().toISOString();
      return {
        caseId,
        sessionId,
        turnId,
        turnStatus,
        approvalUrl: new URL(`/session/${encodeURIComponent(sessionId)}`, this.baseUrl).toString(),
        startedAt,
      };
    } catch (error) {
      if (boundSessionId !== undefined && this.activeSession === boundSessionId) {
        this.activeSession = undefined;
      }
      throw error;
    } finally {
      this.starting = false;
    }
  }

  private readiness(ready: boolean, reason: string | undefined, cooldownRemainingMs: number): RunNowReadiness {
    return {
      enabled: true,
      ready,
      ...(reason === undefined ? {} : { reason }),
      agentName: this.agentName,
      ...(this.activeSession === undefined ? {} : { activeSessionId: this.activeSession }),
      ...(this.activeSession === undefined
        ? {}
        : { approvalUrl: new URL(`/session/${encodeURIComponent(this.activeSession)}`, this.baseUrl).toString() }),
      cooldownRemainingMs,
    };
  }

  private cooldownRemainingMs(): number {
    if (this.lastStartedAt === undefined) return 0;
    return Math.max(0, this.cooldownMs - (this.now().getTime() - this.lastStartedAt));
  }

  private async get(path: string): Promise<UnknownRecord> {
    return this.request(path, { method: "GET" });
  }

  private async post(path: string, body: UnknownRecord, timeoutMs = REQUEST_TIMEOUT_MS): Promise<UnknownRecord> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, timeoutMs);
  }

  private async health(): Promise<boolean> {
    const response = await this.fetchResponse("/healthz", { method: "GET" }, REQUEST_TIMEOUT_MS);
    if (!response.ok) return false;
    const body = (await response.text()).trim();
    if (body === "OK!") return true;
    try {
      const parsed: unknown = JSON.parse(body);
      return isRecord(parsed) && parsed.status === "ok";
    } catch {
      return false;
    }
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<UnknownRecord> {
    return readJson(await this.fetchResponse(path, init, timeoutMs));
  }

  private async fetchResponse(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const requestUrl = new URL(path, this.baseUrl);
    const response = await this.fetchImpl(requestUrl, {
      ...init,
      headers: { accept: "application/json", ...init.headers },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      throw new RunNowError("redirect_rejected", `TrueForge request rejected redirect HTTP ${response.status}.`, 502);
    }
    if (response.url !== "" && new URL(response.url).origin !== this.baseUrl.origin) {
      throw new RunNowError("origin_mismatch", "TrueForge response origin did not match the configured loopback origin.", 502);
    }
    return response;
  }
}

export function runPrompt(caseId: string): string {
  return [
    `Run the TruthLease recall-containment loop for ${caseId}.`,
    "Use only the configured bright-data MCP for current official CPSC evidence; never use a direct web tool.",
    "If Bright Data scrape_as_markdown is empty and search_engine is used, record the organic result title and description exactly as returned; do not expand, rewrite, or repair truncated text.",
    "Use truthlease-local to record the evidence, read the lease and retailer state, then use the native TrueForge sandbox to analyze an exact item-and-batch match and excluded near matches.",
    "Propose exactly one apply_containment_patch call with the required snake_case arguments and stop at TrueForge native approval with zero writes.",
    "Only after a human approves that exact call may you apply it and run verify_containment_state as a fresh persisted-state re-read.",
    "Fail closed if evidence, sandboxing, approval, mutation, or verification is unavailable.",
  ].join(" ");
}
