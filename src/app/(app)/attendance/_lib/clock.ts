/**
 * Current instant for server components. Kept in a plain helper so page / component bodies do not
 * call `new Date()` directly (react-hooks/purity) — every request renders against the real clock.
 */
export function currentTime(): Date {
  return new Date();
}
