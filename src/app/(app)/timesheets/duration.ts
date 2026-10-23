/**
 * Parses a duration typed as decimal hours ("1.5"), clock style ("1:30") or "1h 30m" / "45m".
 * Returns whole minutes, or null when the text isn't a valid duration (1 minute – 24 hours).
 */
export function parseDuration(input: string | null | undefined): number | null {
  const s = (input ?? "").trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  let minutes: number | null = null;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (clock) {
    minutes = Number(clock[1]) * 60 + Number(clock[2]);
  } else if (/^\d+(\.\d+)?$/.test(s)) {
    minutes = Math.round(Number(s) * 60);
  } else {
    const words = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/.exec(s);
    if (words && (words[1] || words[2])) minutes = Math.round(Number(words[1] ?? 0) * 60) + Number(words[2] ?? 0);
  }
  if (minutes === null || !Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) return null;
  return minutes;
}

/** Minutes → the "1:30" form used to prefill the entry form. */
export function durationInput(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
