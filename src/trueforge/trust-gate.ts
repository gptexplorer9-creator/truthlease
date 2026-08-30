import type {
  ApplyContainmentPatchArguments,
  RecordRecallEvidenceInput,
} from "../domain/types.js";
import {
  fetchTrueForgeEvents,
  verifyTrueForgeEvidenceAuthorization,
  verifyTrueForgeMutationAuthorization,
  type TrueForgeAuthorizationProof,
} from "./case-feed.js";

const DEFAULT_AUTHORIZATION_MAX_AGE_MS = 10 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 30_000;

export interface TruthLeaseMcpTrustGate {
  authorizeEvidence(input: RecordRecallEvidenceInput): Promise<TruthLeaseAuthorization>;
  authorizeMutation(input: ApplyContainmentPatchArguments): Promise<TruthLeaseAuthorization>;
}

export interface TruthLeaseAuthorization {
  commit(): void;
  release(): void;
}

export class RejectingTrustGate implements TruthLeaseMcpTrustGate {
  public async authorizeEvidence(_input: RecordRecallEvidenceInput): Promise<TruthLeaseAuthorization> {
    throw new Error(
      "Evidence recording is disabled until this MCP server is bound to a live TrueForge session.",
    );
  }

  public async authorizeMutation(_input: ApplyContainmentPatchArguments): Promise<TruthLeaseAuthorization> {
    throw new Error(
      "Containment mutation is disabled until this MCP server is bound to a live TrueForge session.",
    );
  }
}

export class TrueForgeSessionTrustGate implements TruthLeaseMcpTrustGate {
  private readonly usedEvidenceCallIds = new Set<string>();
  private readonly usedMutationCallIds = new Set<string>();
  private readonly reservedEvidenceCallIds = new Set<string>();
  private readonly reservedMutationCallIds = new Set<string>();

  public constructor(
    private readonly baseUrl: string,
    private readonly sessionId: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly authorizationMaxAgeMs = DEFAULT_AUTHORIZATION_MAX_AGE_MS,
  ) {}

  public async authorizeEvidence(input: RecordRecallEvidenceInput): Promise<TruthLeaseAuthorization> {
    const entries = await fetchTrueForgeEvents(this.baseUrl, this.sessionId, this.fetchImpl);
    const proof = verifyTrueForgeEvidenceAuthorization(entries, input);
    return this.reserveFreshProof(
      proof,
      this.reservedEvidenceCallIds,
      this.usedEvidenceCallIds,
      "No fresh, unused Bright Data evidence trace is bound to this exact record request.",
    );
  }

  public async authorizeMutation(input: ApplyContainmentPatchArguments): Promise<TruthLeaseAuthorization> {
    const entries = await fetchTrueForgeEvents(this.baseUrl, this.sessionId, this.fetchImpl);
    const proof = verifyTrueForgeMutationAuthorization(entries, input);
    return this.reserveFreshProof(
      proof,
      this.reservedMutationCallIds,
      this.usedMutationCallIds,
      "No fresh, unused native TrueForge approval is bound to this exact mutation request.",
    );
  }

  private reserveFreshProof(
    proof: TrueForgeAuthorizationProof | undefined,
    reserved: Set<string>,
    consumed: Set<string>,
    missingMessage: string,
  ): TruthLeaseAuthorization {
    if (proof === undefined) throw new Error(missingMessage);
    const authorizedAt = Date.parse(proof.authorizedAt);
    const age = this.now().getTime() - authorizedAt;
    if (
      !Number.isFinite(authorizedAt) ||
      age > this.authorizationMaxAgeMs ||
      age < -MAX_FUTURE_CLOCK_SKEW_MS
    ) {
      throw new Error("The bound TrueForge authorization is outside the permitted freshness window.");
    }
    if (consumed.has(proof.callId)) {
      return { commit() {}, release() {} };
    }
    if (reserved.has(proof.callId)) {
      throw new Error("The bound TrueForge authorization is already reserved by an active request.");
    }
    reserved.add(proof.callId);
    let settled = false;
    return {
      commit: () => {
        if (settled) return;
        reserved.delete(proof.callId);
        consumed.add(proof.callId);
        settled = true;
      },
      release: () => {
        if (settled) return;
        reserved.delete(proof.callId);
        settled = true;
      },
    };
  }
}

/** Resolve the active session at authorization time so a new Run Now session is bound before any write. */
export class CurrentTrueForgeSessionTrustGate implements TruthLeaseMcpTrustGate {
  private readonly gates = new Map<string, TrueForgeSessionTrustGate>();

  public constructor(
    private readonly baseUrl: string,
    private readonly currentSessionId: () => string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public authorizeEvidence(input: RecordRecallEvidenceInput): Promise<TruthLeaseAuthorization> {
    return this.currentGate().authorizeEvidence(input);
  }

  public authorizeMutation(input: ApplyContainmentPatchArguments): Promise<TruthLeaseAuthorization> {
    return this.currentGate().authorizeMutation(input);
  }

  private currentGate(): TrueForgeSessionTrustGate {
    const sessionId = this.currentSessionId()?.trim();
    if (!sessionId) {
      throw new Error("Evidence and mutation are disabled until Run Now creates a genuine TrueForge session.");
    }
    let gate = this.gates.get(sessionId);
    if (!gate) {
      gate = new TrueForgeSessionTrustGate(this.baseUrl, sessionId, this.fetchImpl);
      this.gates.set(sessionId, gate);
    }
    return gate;
  }
}
