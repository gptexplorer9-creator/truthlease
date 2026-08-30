export function classifyFeedProvenance(status) {
    if (!status || status.trim() === "") {
        return "unavailable";
    }
    return /fixture/i.test(status) ? "fixture" : "live";
}
export function classifyTerminalState(message, options = {}) {
    if (options.online === false) {
        return "offline";
    }
    const normalized = message.toLowerCase();
    if (normalized.includes("http 401") ||
        normalized.includes("http 403") ||
        normalized.includes("unauthorized") ||
        normalized.includes("forbidden") ||
        normalized.includes("credential")) {
        return "unauthorized";
    }
    return "unavailable";
}
export function retryDelayMs(attempt, state, basePollIntervalMs) {
    const normalizedAttempt = Math.max(1, attempt);
    const base = state === "offline"
        ? 2_000
        : state === "unauthorized"
            ? 6_000
            : 3_000;
    const ceiling = state === "unauthorized"
        ? 60_000
        : state === "offline"
            ? 30_000
            : 45_000;
    const exponential = base * 2 ** (normalizedAttempt - 1);
    return Math.max(basePollIntervalMs, Math.min(ceiling, exponential));
}
