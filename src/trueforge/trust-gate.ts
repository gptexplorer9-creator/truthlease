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
  authorizeEvidence(input: RecordRecallEvidenceInput): Promise<void>;
  authorizeMutation(input: ApplyContainmentPatchArguments): Promise<void>;
}

export class RejectingTrustGate implements TruthLeaseMcpTrustGate {
  public async authorizeEvidence(_input: RecordRecallEvidenceInput): Promise<void> {
    throw new Error(
      "Evidence recording is disabled until this MCP server is bound to a live TrueForge session.",
    );
  }

  public async authorizeMutation(_input: ApplyContainmentPatchArguments): Promise<void> {
    throw new Error(
      "Containment mutation is disabled until this MCP server is bound to a live TrueForge session.",
    );
  }
}

export class TrueForgeSessionTrustGate implements TruthLeaseMcpTrustGate {
  private readonly usedEvidenceCallIds = new Set<string>();
  private readonly usedMutationCallIds = new Set<string>();

  public constructor(
    private readonly baseUrl: string,
    private readonly sessionId: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly authorizationMaxAgeMs = DEFAULT_AUTHORIZATION_MAX_AGE_MS,
  ) {}

  public async authorizeEvidence(input: RecordRecallEvidenceInput): Promise<void> {
    const entries = await fetchTrueForgeEvents(this.baseUrl, this.sessionId, this.fetchImpl);
    const proof = verifyTrueForgeEvidenceAuthorization(entries, input, this.usedEvidenceCallIds);
    this.consumeFreshProof(
      proof,
      this.usedEvidenceCallIds,
      "No fresh, unused Bright Data evidence trace is bound to this exact record request.",
    );
  }

  public async authorizeMutation(input: ApplyContainmentPatchArguments): Promise<void> {
    const entries = await fetchTrueForgeEvents(this.baseUrl, this.sessionId, this.fetchImpl);
    const proof = verifyTrueForgeMutationAuthorization(entries, input, this.usedMutationCallIds);
    this.consumeFreshProof(
      proof,
      this.usedMutationCallIds,
      "No fresh, unused native TrueForge approval is bound to this exact mutation request.",
    );
  }

  private consumeFreshProof(
    proof: TrueForgeAuthorizationProof | undefined,
    consumed: Set<string>,
    missingMessage: string,
  ): void {
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
      throw new Error("The bound TrueForge authorization has already been consumed.");
    }
    consumed.add(proof.callId);
  }
}
