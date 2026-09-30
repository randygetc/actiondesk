/**
 * A chainable stand-in for the Supabase client: every query resolves to
 * `rows` (single-row reads find nothing), and any write method is recorded
 * so tests can prove none happen. For unit tests and evals only.
 */
export function fakeSupabase(rows: unknown[] = []) {
  const writes: string[] = [];
  const query: unknown = new Proxy(() => {}, {
    get(_, prop) {
      if (prop === "then")
        return (resolve: (v: unknown) => void) =>
          resolve({ data: rows, error: null });
      if (prop === "maybeSingle" || prop === "single")
        return async () => ({ data: null, error: null });
      if (
        ["insert", "update", "upsert", "delete", "rpc"].includes(String(prop))
      )
        writes.push(String(prop));
      return () => query;
    },
  });
  return { client: { from: () => query, rpc: () => query } as never, writes };
}
