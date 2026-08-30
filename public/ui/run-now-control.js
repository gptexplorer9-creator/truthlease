/// <reference lib="dom" />
async function responseJson(response) {
    const raw = await response.text();
    let value;
    try {
        value = raw === "" ? {} : JSON.parse(raw);
    }
    catch {
        throw new Error("Run Now returned invalid JSON.");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Run Now returned an invalid response.");
    }
    const record = value;
    if (!response.ok) {
        throw new Error(typeof record.error === "string" ? record.error : "Run Now failed (HTTP " + response.status + ").");
    }
    return record;
}
export async function loadRunNowStatus(fetchImpl = fetch) {
    const response = await fetchImpl("/api/run-now/status", {
        headers: { accept: "application/json" },
        credentials: "same-origin",
    });
    if (response.status === 404)
        return { enabled: false };
    const value = await responseJson(response);
    return {
        enabled: value.enabled === true,
        ...(typeof value.ready === "boolean" ? { ready: value.ready } : {}),
        ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
        ...(typeof value.agentName === "string" ? { agentName: value.agentName } : {}),
        ...(typeof value.activeSessionId === "string" ? { activeSessionId: value.activeSessionId } : {}),
        ...(typeof value.approvalUrl === "string" ? { approvalUrl: value.approvalUrl } : {}),
        ...(typeof value.cooldownRemainingMs === "number" ? { cooldownRemainingMs: value.cooldownRemainingMs } : {}),
    };
}
export async function startRunNow(caseId, fetchImpl = fetch) {
    const response = await fetchImpl("/api/run-now", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ caseId }),
    });
    const value = await responseJson(response);
    for (const field of ["caseId", "sessionId", "turnId", "turnStatus", "approvalUrl", "startedAt"]) {
        if (typeof value[field] !== "string" || value[field].trim() === "") {
            throw new Error("Run Now response omitted " + field + ".");
        }
    }
    return value;
}
function trustedApprovalTarget(value) {
    if (!value)
        return undefined;
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        return url.protocol === "http:" &&
            ["127.0.0.1", "localhost", "::1"].includes(host) &&
            url.port === "8790" &&
            url.username === "" &&
            url.password === ""
            ? url.toString()
            : undefined;
    }
    catch {
        return undefined;
    }
}
export function setupRunNowControl() {
    if (typeof document === "undefined")
        return;
    const panel = document.querySelector("#run-now-control");
    const button = document.querySelector("#run-now-button");
    const statusTarget = document.querySelector("#run-now-status");
    const approvalLink = document.querySelector("#run-now-approval");
    if (!panel || !button || !statusTarget || !approvalLink)
        return;
    const render = (status) => {
        panel.hidden = !status.enabled;
        if (!status.enabled)
            return;
        button.disabled = status.ready !== true;
        button.textContent = status.ready === true ? "Run Now" : "Run Unavailable";
        statusTarget.textContent = status.ready === true
            ? "Ready to start a genuine evidence investigation. Approval remains in TrueForge."
            : status.reason ?? "Run Now is not ready.";
        const target = trustedApprovalTarget(status.approvalUrl);
        approvalLink.hidden = target === undefined;
        if (target)
            approvalLink.href = target;
    };
    const refresh = async () => {
        try {
            render(await loadRunNowStatus());
        }
        catch (error) {
            panel.hidden = false;
            button.disabled = true;
            button.textContent = "Run Unavailable";
            statusTarget.textContent = error instanceof Error ? error.message : "Run Now readiness failed.";
        }
    };
    button.addEventListener("click", () => {
        button.disabled = true;
        button.textContent = "Starting...";
        statusTarget.textContent = "Creating a genuine TrueForge session. No retailer write has occurred.";
        void startRunNow("TL-042")
            .then((result) => {
            statusTarget.textContent = "Genuine investigation started. It must pause in TrueForge before any mutation.";
            const target = trustedApprovalTarget(result.approvalUrl);
            approvalLink.hidden = target === undefined;
            if (target)
                approvalLink.href = target;
            window.setTimeout(() => window.location.assign("/?case=TL-042"), 800);
        })
            .catch((error) => {
            statusTarget.textContent = error instanceof Error ? error.message : "Run Now failed closed.";
            void refresh();
        });
    });
    void refresh();
    window.setInterval(() => void refresh(), 15_000);
}
