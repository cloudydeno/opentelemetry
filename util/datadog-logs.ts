import { SpanStatusCode, trace } from "../opentelemetry/api.js";

/** Writes a JSON log to stdout, with Datadog APM correlation */
export function logJson(message: Record<string,unknown>): void {

  const ctx = trace.getActiveSpan()?.spanContext();
  if (ctx) {
    message['dd'] = {
      'trace_id': ctx.traceId,
      'span_id': ctx.spanId,
    };
  }

  // no-dd-sa:typescript-best-practices/no-console
  console.log(JSON.stringify(message));
}

/**
 * Logs an Error to stdout for Datadog to parse out.
 * The given message is prefixed to the error's message for context.
 * Any fields passed as the third argument are added to the JSON log.
 * If a span is active, its status is set to Error and a standard exception event is attached.
 * @example
 * try {
 *   await updateUserProfile(userId, newProfile);
 * } catch (thrown: unknown) {
 *   const err = thrown as Error;
 *   logError('Failed to update user profile', err, { userId });
 * }
 */
export function logError(
  messagePrefix: string,
  error: Error,
  extras: Record<string,unknown> = {},
): void {

  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: messagePrefix,
    });
  }

  const summary = typeof error.stack == 'string'
    ? error.stack.split('\n')[0]
    : `Exception: ${error.message}`;

  logJson({
    ...extras,
    status: 'error',
    msg: `${messagePrefix}: ${summary}`,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
  });
}

/**
 * Small wrapper for logError() intended for unhandledrejection events.
 * @example
 * globalThis.addEventListener('unhandledrejection', logUnhandledRejection);
 */
export function logUnhandledRejection(e: PromiseRejectionEvent): void {
  const err = e.reason instanceof Error
    ? e.reason
    : new Error(`Thrown ${JSON.stringify(e.reason)}`);
  logError('Unhandled rejection in promise', err);
  e.preventDefault();
}
