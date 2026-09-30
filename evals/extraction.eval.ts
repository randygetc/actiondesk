// Extraction eval (plan §3.7): npm run eval
// Recorded mode is the default and needs no key. Live mode (EVAL_LIVE=1)
// arrives with extraction at step 2.3.
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { loadCases } from "./lib/cases";
import { formatReport, runEval, type Extractor } from "./lib/run";

const root = fileURLToPath(new URL("./extraction", import.meta.url));

// Until 2.3 there is no extractor, so every case reports "no recording".
const extractor: Extractor = async () => null;

it("extraction", async () => {
  if (process.env.EVAL_LIVE)
    throw new Error("EVAL_LIVE needs the extractor from step 2.3.");

  const result = await runEval(loadCases(root), extractor);
  console.log(`\n${formatReport(result)}\n`);

  expect(result.cases.filter((c) => c.status === "error")).toEqual([]);
});
