import { describe, expect, it } from "vitest";

import {
  BATCH_SIZE,
  cleanupAttachments,
  cutoffFor,
  MAX_BATCHES,
  type CleanupStore,
  type ExpiredAttachment,
} from "./attachment-cleanup.ts";

const NOW = new Date("2026-10-02T12:00:00Z");

/** An in-memory store: rows with a created_at, and the set of stored files. */
function memoryStore(
  rows: (ExpiredAttachment & { created_at: string })[],
  fail: { storage?: boolean; rows?: boolean } = {},
) {
  const files = new Set(rows.map((r) => r.storage_path));
  const calls = { expired: 0 };
  const store: CleanupStore = {
    async expired(cutoff, limit) {
      calls.expired++;
      return rows
        .filter((r) => r.created_at < cutoff)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, limit);
    },
    async removeObjects(paths) {
      if (fail.storage) return { ok: false };
      for (const p of paths) files.delete(p);
      return { ok: true };
    },
    async deleteRows(ids) {
      if (fail.rows) return { ok: false };
      for (const id of ids)
        rows.splice(
          rows.findIndex((r) => r.id === id),
          1,
        );
      return { ok: true };
    },
  };
  return { store, rows, files, calls };
}

const row = (n: number, hoursAgo: number) => ({
  id: `id-${n}`,
  storage_path: `user/id-${n}.pdf`,
  created_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
});

describe("cleanupAttachments", () => {
  it("removes files and rows older than 24 hours, and keeps newer ones", async () => {
    const m = memoryStore([row(1, 30), row(2, 24.5), row(3, 23), row(4, 1)]);
    const result = await cleanupAttachments(m.store, NOW);
    expect(result).toEqual({ deleted: 2, failedAt: null, more: false });
    expect(m.rows.map((r) => r.id)).toEqual(["id-3", "id-4"]);
    expect([...m.files]).toEqual(["user/id-3.pdf", "user/id-4.pdf"]);
  });

  it("the cutoff is exactly 24 hours before now", () => {
    expect(cutoffFor(NOW)).toBe("2026-10-01T12:00:00.000Z");
  });

  it("keeps rows when the files can't be removed, and stops", async () => {
    const m = memoryStore([row(1, 30), row(2, 40)], { storage: true });
    const result = await cleanupAttachments(m.store, NOW);
    expect(result).toEqual({ deleted: 0, failedAt: "storage", more: true });
    expect(m.rows).toHaveLength(2);
    expect(m.calls.expired).toBe(1);
  });

  it("reports a row failure after the files are gone (the next run retries)", async () => {
    const m = memoryStore([row(1, 30)], { rows: true });
    const result = await cleanupAttachments(m.store, NOW);
    expect(result).toEqual({ deleted: 0, failedAt: "rows", more: true });
    expect(m.files.size).toBe(0);
    expect(m.rows).toHaveLength(1);
  });

  it("works through a backlog in batches, up to the per-run limit", async () => {
    const total = BATCH_SIZE * MAX_BATCHES + 5;
    const m = memoryStore(
      Array.from({ length: total }, (_, i) => row(i, 25 + i / 1000)),
    );
    const first = await cleanupAttachments(m.store, NOW);
    expect(first).toEqual({
      deleted: BATCH_SIZE * MAX_BATCHES,
      failedAt: null,
      more: true,
    });
    const second = await cleanupAttachments(m.store, NOW);
    expect(second).toEqual({ deleted: 5, failedAt: null, more: false });
    expect(m.rows).toHaveLength(0);
  });

  it("does nothing when nothing is old", async () => {
    const m = memoryStore([row(1, 2)]);
    expect(await cleanupAttachments(m.store, NOW)).toEqual({
      deleted: 0,
      failedAt: null,
      more: false,
    });
  });
});
