import { z } from "zod";

/**
 * Zod building blocks for form input. Forms post plain objects built from FormData, so values
 * arrive as strings; these helpers trim, coerce and turn empty strings into `undefined`.
 */
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : v);

export const zs = {
  /** Required non-empty string. */
  text: (label = "This field", max = 500) =>
    z.preprocess(trimmed, z.string({ error: `${label} is required` }).min(1, `${label} is required`).max(max, `${label} is too long`)),

  /** Optional string; "" → undefined. */
  optText: (max = 5000) => z.preprocess((v) => emptyToUndefined(trimmed(v)), z.string().max(max, "Too long").optional()),

  email: (label = "Email") =>
    z.preprocess(
      (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
      z.email({ error: `Enter a valid ${label.toLowerCase()}` }),
    ),

  optEmail: () =>
    z.preprocess(
      (v) => emptyToUndefined(typeof v === "string" ? v.trim().toLowerCase() : v),
      z.email({ error: "Enter a valid email" }).optional(),
    ),

  /** Required finite number (accepts numeric strings). */
  num: (label = "Value", opts: { min?: number; max?: number } = {}) => {
    let schema = z.number({ error: `${label} must be a number` }).finite();
    if (opts.min !== undefined) schema = schema.min(opts.min, `${label} must be at least ${opts.min}`);
    if (opts.max !== undefined) schema = schema.max(opts.max, `${label} must be at most ${opts.max}`);
    return z.preprocess((v) => {
      const e = emptyToUndefined(trimmed(v));
      return e === undefined ? undefined : Number(e);
    }, schema);
  },

  optNum: (opts: { min?: number; max?: number } = {}) => {
    let schema = z.number({ error: "Must be a number" }).finite();
    if (opts.min !== undefined) schema = schema.min(opts.min, `Must be at least ${opts.min}`);
    if (opts.max !== undefined) schema = schema.max(opts.max, `Must be at most ${opts.max}`);
    return z.preprocess((v) => {
      const e = emptyToUndefined(trimmed(v));
      return e === undefined ? undefined : Number(e);
    }, schema.optional());
  },

  /** Checkbox / switch: "on", "true", "1", true → true. */
  bool: () => z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean()),

  id: (label = "Selection") => z.preprocess(trimmed, z.string({ error: `${label} is required` }).regex(/^[a-f0-9]{24}$/i, `${label} is required`)),

  optId: () => z.preprocess((v) => emptyToUndefined(trimmed(v)), z.string().regex(/^[a-f0-9]{24}$/i, "Invalid selection").optional()),

  /** Array of ids from multi-selects; accepts an array or a comma-separated string. */
  ids: () =>
    z.preprocess((v) => {
      if (v == null || v === "") return [];
      const arr = Array.isArray(v) ? v : String(v).split(",");
      return arr.map((x) => String(x).trim()).filter(Boolean);
    }, z.array(z.string().regex(/^[a-f0-9]{24}$/i, "Invalid selection"))),

  /** Array of strings; accepts array, comma string or newline-separated text. */
  list: () =>
    z.preprocess((v) => {
      if (v == null || v === "") return [];
      const arr = Array.isArray(v) ? v : String(v).split(/\r?\n|,/);
      return arr.map((x) => String(x).trim()).filter(Boolean);
    }, z.array(z.string().max(500))),

  /** "yyyy-MM-dd" */
  date: (label = "Date") => z.preprocess(trimmed, z.string({ error: `${label} is required` }).regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is required`)),

  optDate: () => z.preprocess((v) => emptyToUndefined(trimmed(v)), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date").optional()),

  /** "HH:mm" */
  time: (label = "Time") => z.preprocess(trimmed, z.string({ error: `${label} is required` }).regex(/^\d{2}:\d{2}$/, `${label} is required`)),

  optTime: () => z.preprocess((v) => emptyToUndefined(trimmed(v)), z.string().regex(/^\d{2}:\d{2}$/, "Invalid time").optional()),

  /** <input type="datetime-local"> value "yyyy-MM-ddTHH:mm" (company time zone). */
  dateTime: (label = "Date and time") =>
    z.preprocess(trimmed, z.string({ error: `${label} is required` }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, `${label} is required`)),

  optDateTime: () => z.preprocess((v) => emptyToUndefined(trimmed(v)), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Invalid date and time").optional()),

  /** "yyyy-MM" */
  month: (label = "Month") => z.preprocess(trimmed, z.string({ error: `${label} is required` }).regex(/^\d{4}-\d{2}$/, `${label} is required`)),
};

export const objectIdPattern = /^[a-f0-9]{24}$/i;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && objectIdPattern.test(value);
}
