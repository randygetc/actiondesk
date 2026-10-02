// Attachment cleanup (R-20, D-21): files are kept only while their review is
// open. A tab closed mid-review leaves one behind; this removes anything older
// than the retention window. Shared by the Edge Function (Deno) and unit tests
// (Vitest), so it has no imports: the store is passed in.

export const RETENTION_HOURS = 24;
/** Rows per round trip. Storage removes up to 1,000 paths per call. */
export const BATCH_SIZE = 200;
/** Upper bound per run; the next hourly run continues. */
export const MAX_BATCHES = 10;

export type ExpiredAttachment = { id: string; storage_path: string };

export interface CleanupStore {
  /** The oldest attachments created before `cutoff`, at most `limit`. */
  expired(cutoff: string, limit: number): Promise<ExpiredAttachment[]>;
  /** Deletes the stored files. A missing file counts as deleted. */
  removeObjects(paths: string[]): Promise<{ ok: boolean }>;
  deleteRows(ids: string[]): Promise<{ ok: boolean }>;
}

export type CleanupResult = {
  deleted: number;
  /** "storage" or "rows" when a batch failed and the run stopped. */
  failedAt: "storage" | "rows" | null;
  /** True when MAX_BATCHES ran out before the backlog did. */
  more: boolean;
};

export function cutoffFor(now: Date): string {
  return new Date(now.getTime() - RETENTION_HOURS * 3_600_000).toISOString();
}

/**
 * Files first, then rows: a row whose file is gone is harmless and is removed
 * on the next run, but a file whose row is gone could never be found again.
 * Stops at the first failure, so a broken store can't loop.
 */
export async function cleanupAttachments(
  store: CleanupStore,
  now: Date,
): Promise<CleanupResult> {
  const cutoff = cutoffFor(now);
  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await store.expired(cutoff, BATCH_SIZE);
    if (rows.length === 0) return { deleted, failedAt: null, more: false };

    const files = await store.removeObjects(rows.map((r) => r.storage_path));
    if (!files.ok) return { deleted, failedAt: "storage", more: true };

    const removed = await store.deleteRows(rows.map((r) => r.id));
    if (!removed.ok) return { deleted, failedAt: "rows", more: true };

    deleted += rows.length;
    if (rows.length < BATCH_SIZE)
      return { deleted, failedAt: null, more: false };
  }
  return { deleted, failedAt: null, more: true };
}
