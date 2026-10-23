import type { Types } from "mongoose";

/**
 * Converts Mongo documents into plain JSON-safe values for Client Components:
 * ObjectId → string, Date → ISO string. Use on lean() results before passing as props.
 */
export type Plain<T> = T extends Types.ObjectId
  ? string
  : T extends Date
    ? string
    : T extends (infer U)[]
      ? Plain<U>[]
      : T extends object
        ? { [K in keyof T]: Plain<T[K]> }
        : T;

export function plain<T>(value: T): Plain<T> {
  return JSON.parse(JSON.stringify(value ?? null)) as Plain<T>;
}

export function idOf(value: { toString(): string } | null | undefined): string | undefined {
  return value ? value.toString() : undefined;
}
