const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const hostedSetupControl = document.querySelector("#hosted-setup-control");

if (hostedSetupControl instanceof HTMLElement && !loopbackHosts.has(window.location.hostname)) {
  hostedSetupControl.hidden = false;
}

for (const button of document.querySelectorAll("[data-copy]")) {
  if (!(button instanceof HTMLButtonElement)) continue;
  button.addEventListener("click", async () => {
    const targetId = button.dataset.copy;
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;

    try {
      await navigator.clipboard.writeText(target.textContent ?? "");
      const priorLabel = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = priorLabel;
      }, 1600);
    } catch {
      button.textContent = "Select text";
    }
  });
}
