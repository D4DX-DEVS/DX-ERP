/**
 * Small RFC 4180 CSV parser (client-safe): quoted fields, escaped quotes (""), embedded commas and
 * newlines, CRLF / LF / CR line endings, UTF-8 BOM, and comma / semicolon / tab delimiters.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, "").split(/\r\n|\n|\r/, 1)[0] ?? "";
  let best = ",";
  let bestCount = -1;
  for (const d of [",", ";", "\t"]) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawContent = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    sawContent = false;
  };

  const start = input.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      sawContent = true;
    } else if (ch === delimiter) {
      endField();
      sawContent = true;
    } else if (ch === "\r") {
      if (input[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
      sawContent = true;
    }
  }
  if (sawContent || field !== "" || row.length > 0) endRow();

  // Drop completely blank lines.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const ALIASES: Record<string, string> = {
  name: "name",
  fullname: "name",
  email: "email",
  workemail: "email",
  persontype: "personType",
  type: "personType",
  role: "role",
  department: "department",
  designation: "designation",
  employmenttype: "employmentType",
  joiningdate: "joiningDate",
  joined: "joiningDate",
  dateofjoining: "joiningDate",
  phone: "phone",
  mobile: "phone",
  reportingmanageremail: "reportingManagerEmail",
  manageremail: "reportingManagerEmail",
  reportsto: "reportingManagerEmail",
};

export interface ParsedImport {
  rows: Record<string, string>[];
  unknownColumns: string[];
  error?: string;
}

/** Maps CSV header names (case / spacing insensitive) to import fields. */
export function rowsFromCsv(grid: string[][]): ParsedImport {
  if (grid.length === 0) return { rows: [], unknownColumns: [], error: "The file is empty." };
  const header = grid[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const keys = header.map((h) => ALIASES[h]);
  const unknownColumns = grid[0].filter((_, i) => !keys[i] && grid[0][i].trim() !== "");
  if (!keys.includes("name") || !keys.includes("email")) {
    return { rows: [], unknownColumns, error: "The first row must be a header containing at least the name and email columns." };
  }
  const rows = grid.slice(1).map((cells) => {
    const out: Record<string, string> = {};
    keys.forEach((key, i) => {
      if (key) out[key] = (cells[i] ?? "").trim();
    });
    return out;
  });
  return { rows, unknownColumns };
}
