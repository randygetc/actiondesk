// DELIBERATE VIOLATION (step 1.4, #1): Anthropic SDK imported in a component. Do not merge.
import Anthropic from "@anthropic-ai/sdk";

export function GuardrailProof() {
  return <pre>{String(Anthropic)}</pre>;
}
