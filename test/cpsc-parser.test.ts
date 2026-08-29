import { describe, expect, it } from "vitest";

import { parseCpscRecallHtml } from "../src/infra/cpsc.js";

const fixture = `
  <html><body>
    <h1>HABA USA Recalls Rainbow Rattle Grasping and Teething Toys Due to Risk of Serious Injury or Death from Choking and Ingestion Hazards</h1>
    <div>Name of Product: HABA Rainbow Rattle Grasping and Teething Toy</div>
    <div>Hazard: The knot can become untied. Remedy: Refund</div>
    <div>Recall Date: August 27, 2026</div>
    <div>Description: This recall involves HABA Rainbow Rattle Grasping and Teething Toy item number 2012261001 and batch code 0925. Remedy: Consumers should stop using it.</div>
    <div>Recall number: 26-719</div>
  </body></html>
`;

describe("parseCpscRecallHtml", () => {
  it("extracts the two identifiers required for an exact match", () => {
    const evidence = parseCpscRecallHtml(
      fixture,
      "https://www.cpsc.gov/Recalls/example",
      "2026-08-29T12:00:00.000Z",
    );

    expect(evidence.recallNumber).toBe("26-719");
    expect(evidence.identifiers).toEqual({ itemNumber: "2012261001", batchCode: "0925" });
    expect(evidence.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed when a required exact identifier is absent", () => {
    expect(() => parseCpscRecallHtml(fixture.replace("batch code 0925", "batch unavailable"))).toThrow(
      /batch code/i,
    );
  });
});
