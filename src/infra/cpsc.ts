import { createHash } from "node:crypto";

import type { RecallEvidence } from "../domain/types.js";

export const CPSC_RECALL_URL =
  "https://www.cpsc.gov/Recalls/2026/HABA-USA-Recalls-Rainbow-Rattle-Grasping-and-Teething-Toys-Due-to-Risk-of-Serious-Injury-or-Death-from-Choking-and-Ingestion-Hazards";

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function htmlToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function requiredMatch(text: string, pattern: RegExp, field: string): string {
  const match = pattern.exec(text);
  const value = match?.[1]?.trim();
  if (!value) {
    throw new Error(`The official CPSC page did not contain ${field}.`);
  }
  return value;
}

export function parseCpscRecallHtml(
  html: string,
  sourceUrl = CPSC_RECALL_URL,
  retrievedAt = new Date().toISOString(),
): RecallEvidence {
  const text = htmlToText(html);
  const title = requiredMatch(
    text,
    /(HABA USA Recalls Rainbow Rattle Grasping and Teething Toys Due to Risk of Serious Injury or Death from Choking and Ingestion Hazards)/i,
    "the recall title",
  );

  return {
    recallNumber: requiredMatch(text, /Recall number:\s*([0-9]{2}-[0-9]{3})/i, "a recall number"),
    title,
    productName: requiredMatch(text, /Name of Product:\s*(.*?)\s*Hazard:/i, "a product name"),
    recallDate: requiredMatch(
      text,
      /Recall Date:\s*([A-Z][a-z]+\s+[0-9]{1,2},\s+[0-9]{4})/,
      "a recall date",
    ),
    hazard: requiredMatch(text, /Hazard:\s*(.*?)\s*Remedy:/i, "a hazard"),
    description: requiredMatch(
      text,
      /Description:\s*(This recall involves.*?)\s*Remedy:/i,
      "a recall description",
    ),
    identifiers: {
      itemNumber: requiredMatch(text, /item number\s+([A-Z0-9-]+)/i, "an item number"),
      batchCode: requiredMatch(text, /batch code\s+([A-Z0-9-]+)/i, "a batch code"),
    },
    sourceUrl,
    retrievedAt,
    contentSha256: createHash("sha256").update(html).digest("hex"),
  };
}

export async function fetchOfficialRecall(fetchImpl: typeof fetch = fetch): Promise<RecallEvidence> {
  const response = await fetchImpl(CPSC_RECALL_URL, {
    method: "GET",
    redirect: "follow",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "TruthLease-Hackathon/0.1 (read-only CPSC evidence fetch)",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Official CPSC request failed with HTTP ${response.status}.`);
  }

  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "www.cpsc.gov") {
    throw new Error(`CPSC request redirected to a non-allow-listed origin: ${finalUrl.origin}`);
  }

  const html = await response.text();
  return parseCpscRecallHtml(html, response.url, new Date().toISOString());
}
