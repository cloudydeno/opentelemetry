import {
  type Span,
  type SpanOptions,
  type Tracer,
  SpanKind,
  SpanStatusCode,
  context,
  trace,
} from "../opentelemetry/api.js";

export class LogicTracer {
  tracer: Tracer;
  requireParent: boolean;
  constructor(options: {
    name: string;
    version?: string;
    requireParent?: boolean;
  }) {
    this.tracer = trace.getTracer(options.name, options.version);
    this.requireParent = options.requireParent ?? false;

    this.InternalSpan = this.InternalSpan.bind(this);
  }

  InternalSpan<
    Tthis,
    Targs extends unknown[],
    Tret extends unknown,
  >(
    originalMethod: (...args: Targs) => Promise<Tret>,
    context: ClassMethodDecoratorContext<Tthis, (this: Tthis, ...args: Targs) => Promise<Tret>>,
  ): (...args: Targs) => Promise<Tret> {
    const asyncSpan = this.asyncSpan.bind(this);
    return function (this: Tthis, ...args: Targs): Promise<Tret> {
      return asyncSpan(context.name.toString(), {
        kind: SpanKind.INTERNAL,
      }, () => originalMethod.apply(this, args));
    };
  }

  /** Runs an async function within a new span, and then ends the span upon completion */
  async asyncSpan<Tret>(
    spanName: string,
    options: SpanOptions,
    func: (span: Span | null) => Promise<Tret> | Tret,
  ): Promise<Tret> {
    // if (!trace.getActiveSpan()) {
    //   const err = new Error('no parent span for '+spanName);
    //   if (!err.stack?.includes('new Computation')) console.warn('WARN:', err.stack);
    // }
    if (this.requireParent && !trace.getActiveSpan()) {
      return await func(null);
    }

    const span = this.tracer.startSpan(spanName, {
      kind: SpanKind.INTERNAL,
      ...options,
    });

    try {
      const spanContext = trace.setSpan(context.active(), span);
      return await context.with(spanContext, () => func(span));
    } catch (thrown: unknown) {
      const err = thrown as Error;
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message,
      });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  }

  /** Runs an sync function within a new span, and then ends the span upon return */
  syncSpan<Tret>(
    spanName: string,
    options: SpanOptions,
    func: (span: Span | null) => Tret,
  ): Tret {
    // if (!trace.getActiveSpan()
    //     && !spanName.startsWith('ShellSession task:')
    //     && !spanName.startsWith('MessageHost rpc:')) {
    //   const err = new Error('no parent span for '+spanName);
    //   if (!err.stack?.includes('new Computation')) console.warn('WARN:', err.stack);
    // }
    if (this.requireParent && !trace.getActiveSpan()) {
      return func(null);
    }

    const span = this.tracer.startSpan(spanName, {
      kind: SpanKind.INTERNAL,
      ...options,
    });

    try {
      const spanContext = trace.setSpan(context.active(), span);
      return context.with(spanContext, () => func(span));
    } catch (thrown: unknown) {
      const err = thrown as Error;
      span.setStatus({
        code: opentelemetry.SpanStatusCode.ERROR,
        message: err.message,
      })
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  }

  /** Wraps an async function and returns a new function which creates a span around the promise */
  wrapAsyncWithSpan<
    Targs extends unknown[],
    Tret,
  >(
    spanName: string,
    options: SpanOptions,
    func: (...args: Targs) => Promise<Tret>,
    thisArg?: unknown,
  ): (...args: Targs) => Promise<Tret> {
    return (...args: Targs) =>
      this.asyncSpan(spanName, options, () =>
        func.apply(thisArg, args));
  }

  /** Wraps a sync function and returns a new function which creates a span around the promise */
  wrapSyncWithSpan<
    Targs extends unknown[],
    Tret,
  >(
    spanName: string,
    options: SpanOptions,
    func: (...args: Targs) => Tret,
  ): (...args: Targs) => Tret {
    return (...args: Targs) =>
      this.syncSpan(spanName, options, () =>
        func.apply(null, args));
  }

  tracedInterval<T>(func: () => Promise<T>, delayMs: number): number {
    const funcName = func.name || `${func.toString().slice(0, 50)}...` || '(anonymous)';
    return setInterval(this.wrapAsyncWithSpan(funcName, {
      attributes: {
        'timer.interval_ms': delayMs,
      }
    }, func), delayMs);
  }

  tracedTimeout<T>(func: () => Promise<T>, delayMs: number): number {
    const funcName = func.name || `${func.toString().slice(0, 50)}...` || '(anonymous)';
    return setTimeout(() => this.asyncSpan(funcName, {
      attributes: {
        'timer.timeout_ms': delayMs,
      }
    }, func), delayMs);
  }
}

const defaultTracer = new LogicTracer({
  name: 'async_func',
});
export const asyncSpan: LogicTracer['asyncSpan'] = defaultTracer.asyncSpan.bind(defaultTracer);
export const syncSpan: LogicTracer['syncSpan'] = defaultTracer.syncSpan.bind(defaultTracer);
export const wrapAsyncWithSpan: LogicTracer['wrapAsyncWithSpan'] = defaultTracer.wrapAsyncWithSpan.bind(defaultTracer);
export const tracedInterval: LogicTracer['tracedInterval'] = defaultTracer.tracedInterval.bind(defaultTracer);
export const tracedTimeout: LogicTracer['tracedTimeout'] = defaultTracer.tracedTimeout.bind(defaultTracer);

/** @deprecated Switch to asyncSpan() or possibly wrapAsyncWithSpan() */
export async function traceAsyncFunc<Tret>(
  spanName: string,
  func: (span: Span | null) => Promise<Tret> | Tret,
): Promise<Tret> {
  return await asyncSpan(spanName, {}, func);
}

type AsyncMethodDecorator<
  Tthis,
  Targs extends unknown[],
  Tret extends unknown,
> = (
  originalMethod: (...args: Targs) => Promise<Tret>,
  context: ClassMethodDecoratorContext<Tthis, (this: Tthis, ...args: Targs) => Promise<Tret>>,
) => (...args: Targs) => Promise<Tret>;

type WrapSpanOptions = SpanOptions & { name?: string };

/**
 * Decorator, wraps an asyncronuous method with an OpenTelemetry span.
 * Optionally accepts SpanOptions e.g. name or attributes to be attached to every created span.
 */
export function WrapWithSpan<
  Tthis,
  Targs extends unknown[],
  Tret extends unknown,
>(
  opts: WrapSpanOptions = {},
): AsyncMethodDecorator<Tthis, Targs, Tret> {
  return (originalMethod, context) => {
    return function (this: Tthis, ...args: Targs): Promise<Tret> {
      return asyncSpan(
        opts.name ?? context.name.toString(),
        opts,
        () => originalMethod.apply(this, args));
    };
  }
}
