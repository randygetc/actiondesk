// Reads a zip's central directory (names and uncompressed sizes) without
// inflating anything, so a .docx zip bomb is refused before mammoth parses it
// (security review #5). Pure; runs in unit tests.

export const ZIP_LIMITS = {
  maxEntries: 1_000,
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
};

export type ZipEntry = { name: string; size: number };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/** Central directory entries, or null if this isn't a zip we can read safely. */
export function zipEntries(b: Uint8Array): ZipEntry[] | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // The end-of-central-directory record is in the last 22 + 65535 bytes.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  // 0xffff / 0xffffffff mean ZIP64, which a Word document never needs.
  if (count === 0xffff || dirOffset === 0xffffffff) return null;
  if (count > ZIP_LIMITS.maxEntries) return null;

  const entries: ZipEntry[] = [];
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || view.getUint32(p, true) !== CENTRAL) return null;
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    if (size === 0xffffffff || p + 46 + nameLen > b.length) return null;
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export type DocxCheck = { ok: true } | { ok: false; error: string };

export function checkDocx(b: Uint8Array): DocxCheck {
  const entries = zipEntries(b);
  if (!entries || !entries.some((e) => e.name === "word/document.xml"))
    return { ok: false, error: "That file isn't a readable Word document." };
  const total = entries.reduce((s, e) => s + e.size, 0);
  if (
    entries.some((e) => e.size > ZIP_LIMITS.maxEntryBytes) ||
    total > ZIP_LIMITS.maxTotalBytes
  )
    return { ok: false, error: "That Word document is too large to read." };
  return { ok: true };
}
