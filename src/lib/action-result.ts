/** Shape every server action returns (shared by server and client). */
export type ActionResult<T = unknown> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Error whose message is safe to show to the user. */
export class ActionError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ActionError";
    this.fieldErrors = fieldErrors;
  }
}
