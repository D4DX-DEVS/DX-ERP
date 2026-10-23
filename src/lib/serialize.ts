/**
 * Converts query rows into plain JSON-safe values for Client Components (Date → ISO string,
 * `null` columns kept as null). Use on query results before passing them as props.
 */
export type Plain<T> = T extends Date
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
