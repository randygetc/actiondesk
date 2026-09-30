import { describe, expect, it } from "vitest";

import { ASK_TOOLS } from "./tasks";

type Schema = {
  type?: unknown;
  enum?: unknown;
  properties?: Record<string, Schema>;
  anyOf?: Schema[];
};

function walk(s: Schema, path: string, out: string[]) {
  // The API's strict mode rejects an enum whose type is an array like ["string", "null"].
  if (s.enum && Array.isArray(s.type)) out.push(path);
  for (const [k, v] of Object.entries(s.properties ?? {}))
    walk(v, `${path}.${k}`, out);
  s.anyOf?.forEach((v, i) => walk(v, `${path}.anyOf[${i}]`, out));
}

describe("Ask tool definitions", () => {
  it.each(ASK_TOOLS.map((t) => [t.definition.name, t]))(
    "%s is strict and API-valid",
    (_, tool) => {
      const def = tool.definition;
      expect(def.strict).toBe(true);
      const schema = def.input_schema as Schema & {
        additionalProperties?: boolean;
        required?: string[];
      };
      expect(schema.additionalProperties).toBe(false);
      // Strict mode needs every property listed as required.
      expect([...(schema.required ?? [])].sort()).toEqual(
        Object.keys(schema.properties ?? {}).sort(),
      );
      const bad: string[] = [];
      walk(schema, def.name, bad);
      expect(bad).toEqual([]);
    },
  );
});
