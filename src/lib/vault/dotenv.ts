/**
 * Minimal, dependency-free .env parser / serializer shared by the vault's server actions and its
 * client editor. Supports `export KEY=value`, comments, single quotes (literal), double quotes
 * (with \n \" \\ escapes) and multi-line double-quoted values such as PEM keys.
 */

export interface EnvEntry {
  key: string;
  value: string;
}

export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
export const MAX_ENV_ENTRIES = 300;

export interface ParseResult {
  entries: EnvEntry[];
  errors: string[];
}

function unescapeDouble(value: string): string {
  return value.replace(/\\([nrt"\\])/g, (_, c: string) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c));
}

export function parseDotenv(text: string): ParseResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const entries: EnvEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      errors.push(`Line ${i + 1}: expected KEY=value`);
      continue;
    }
    const key = match[1];
    let raw = match[2];
    if (!ENV_KEY_PATTERN.test(key)) {
      errors.push(`Line ${i + 1}: "${key}" is not a valid variable name`);
      continue;
    }
    let value: string;
    if (raw.startsWith('"')) {
      // Collect continuation lines until the closing (unescaped) quote.
      let body = raw.slice(1);
      let closed = /(^|[^\\])(\\\\)*"\s*(#.*)?$/.test(body);
      while (!closed && i + 1 < lines.length) {
        i++;
        body += `\n${lines[i]}`;
        closed = /(^|[^\\])(\\\\)*"\s*(#.*)?$/.test(lines[i]);
      }
      if (!closed) {
        errors.push(`${key}: missing closing quote`);
        continue;
      }
      value = unescapeDouble(body.replace(/"\s*(#.*)?$/, ""));
    } else if (raw.startsWith("'")) {
      const end = raw.lastIndexOf("'");
      value = end > 0 ? raw.slice(1, end) : raw.slice(1);
    } else {
      raw = raw.replace(/\s+#.*$/, "");
      value = raw.trim();
    }
    if (seen.has(key)) {
      errors.push(`${key} is defined more than once`);
      continue;
    }
    seen.add(key);
    entries.push({ key, value });
  }
  if (entries.length > MAX_ENV_ENTRIES) errors.push(`At most ${MAX_ENV_ENTRIES} variables per file`);
  return { entries, errors };
}

function quote(value: string): string {
  if (value === "") return "";
  if (/^[A-Za-z0-9_./:@%+,=-]+$/.test(value) && !value.includes("#")) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

export function serializeDotenv(entries: EnvEntry[]): string {
  return entries.map((e) => `${e.key}=${quote(e.value)}`).join("\n") + (entries.length ? "\n" : "");
}
