import { fetchOfficialRecall } from "../src/infra/cpsc.js";

const evidence = await fetchOfficialRecall();
process.stdout.write(
  `${JSON.stringify(
    {
      qualification: "NON_QUALIFYING_DIRECT_DEV_CHECK",
      warning: "The agent must use Bright Data. This direct fetch is only a parser/development diagnostic.",
      recallNumber: evidence.recallNumber,
      identifiers: evidence.identifiers,
      sourceUrl: evidence.sourceUrl,
      retrievedAt: evidence.retrievedAt,
      contentSha256: evidence.contentSha256,
    },
    null,
    2,
  )}\n`,
);
