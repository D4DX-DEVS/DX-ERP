/**
 * Post-login redirect targets arrive from the query string. Accept only same-origin absolute paths: a single leading
 * "/" that is not followed by another "/" or a backslash (browsers treat `/\evil.com` and `//evil.com` as
 * cross-origin), with no backslashes, whitespace or control characters anywhere (browsers strip tabs / newlines
 * inside URLs, so `/\t/evil.com` also resolves to `//evil.com`).
 */
const SAFE_PATH = /^\/(?![/\\])[^\s\\\p{Cc}]*$/u;

export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  return typeof next === "string" && SAFE_PATH.test(next) ? next : fallback;
}
