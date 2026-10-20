/**
 * Make a thrown value loggable.
 *
 * `logger.error('it broke', { cause })` looks like it records the error and
 * does not: JSON.stringify of an Error is `{}`, because message and stack are
 * non-enumerable. Every catch block that did this logged the word "failed" and
 * threw the reason away.
 *
 * That is not hypothetical. Entry confirmation emails stopped going out when
 * SendGrid's trial allowance lapsed, and the provider had put exactly the
 * right diagnostic -- `SendGrid 401: Maximum credits exceeded` -- into the
 * error message. The log said `{"cause":{}}`, so finding it meant probing the
 * API by hand instead of reading one line.
 *
 * Returned as `error` rather than `message` because the logger already uses
 * `message` for the label passed alongside it, and the two would collide.
 */
export function describeError(cause: unknown): { error: string; stack?: string } {
  if (cause instanceof Error) {
    return { error: cause.message, stack: cause.stack }
  }
  return { error: String(cause) }
}
