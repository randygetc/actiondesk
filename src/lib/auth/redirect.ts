/**
 * Returns `next` if it is a same-origin path, otherwise `fallback`.
 * Guards /auth/callback and /login against open redirects.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/tasks",
): string {
  if (!next) return fallback;
  // Must be a single-slash absolute path: rejects "//evil.com", "/\evil.com",
  // "https://evil.com", "javascript:…" and relative paths.
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\"))
    return fallback;
  // Control characters and backslashes can be normalized into a host by browsers.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://placeholder.invalid");
    if (url.origin !== "http://placeholder.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
