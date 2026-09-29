import { expect, it } from "vitest";

// R-6: server-only is aliased to a no-op in Vitest, so server modules are testable.
it("imports a server-only module under Vitest", async () => {
  await expect(import("./index")).resolves.toBeDefined();
});
