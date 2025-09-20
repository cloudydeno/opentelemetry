[![CI](https://github.com/cloudydeno/opentelemetry/actions/workflows/deno-ci.yml/badge.svg)](https://github.com/cloudydeno/opentelemetry/actions/workflows/deno-ci.yml)
[![JSR](https://jsr.io/badges/@cloudydeno/opentelemetry)](https://jsr.io/@cloudydeno/opentelemetry)
[![JSR Score](https://jsr.io/badges/@cloudydeno/opentelemetry/score)](https://jsr.io/@cloudydeno/opentelemetry)


# `@cloudydeno/opentelemetry` on JSR

A Deno-oriented build of [opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js),
with extra Deno-specific integrations.

* [Published on JSR](https://jsr.io/@cloudydeno/opentelemetry) since `v0.10.0`.
* Previous versions were [published to `/x/`](https://deno.land/x/observability).

## example usage

```ts
// set up the SDK:
import 'jsr:@cloudydeno/opentelemetry/register';
// Can also use `OTEL_DENO=true deno` instead of the /register import.
// See more setup in the deno documentation on OTel (short for opentelemetry)

// Wrap an async function in a span:
import { traceAsyncFunc } from 'jsr:@cloudydeno/opentelemetry/instrumentation/async.ts';
const doTheThing = traceAsyncFunction('DoTheThing', async () => {
  const resp = await fetch(...);
  /* ... */
});
await doTheThing();
```
