export { trace, metrics, context, type Context } from './opentelemetry/api.js';
export { logs } from './opentelemetry/api-logs.js';
export { type Resource } from "./opentelemetry/resources.js";

export { httpTracer } from './instrumentation/http-server.ts';
export { FetchInstrumentation } from './instrumentation/fetch.ts';
export { DenoRuntimeInstrumentation } from './instrumentation/deno-runtime.ts';
export { getDenoAutoInstrumentations } from './instrumentation/auto.ts';

export {
  DenoTelemetrySdk,
} from "./sdk.ts";
