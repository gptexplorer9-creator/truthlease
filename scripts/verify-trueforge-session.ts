import { fetchTrueForgeEvents, verifyP0SessionEvents } from "../src/trueforge/case-feed.js";

const sessionId = process.argv[2]?.trim();
if (sessionId === undefined || sessionId.length === 0) {
  throw new Error("Usage: npm run evidence:verify -- <trueforge-session-id>");
}

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://127.0.0.1:8790";
const result = verifyP0SessionEvents(sessionId, await fetchTrueForgeEvents(baseUrl, sessionId));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;
