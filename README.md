![CI](https://github.com/cloudydeno/opentelemetry/actions/workflows/deno-ci.yml/badge.svg?branch=main)

# `@cloudydeno/opentelemetry` on JSR

A Deno-oriented build of [opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js),
with extra Deno-specific integrations.

* [Published on JSR](https://jsr.io/@cloudydeno/opentelemetry) since `v0.10.0`.
* Previous versions were [published to `/x/`](https://deno.land/x/observability).

## example usage

```ts
// set up the SDK:
import 'jsr:@cloudydeno/opentelemetry/register';
// Can also use `deno --unstable-otel` instead of the /register import.
// See more setup in the deno documentation on OTel (short for opentelemetry)

// Wrap an async function in a span:
import { traceAsyncFunc } from 'jsr:@cloudydeno/opentelemetry/instrumentation/async.ts';
const doTheThing = traceAsyncFunction('DoTheThing', async () => {
  const resp = await fetch(...);
  /* ... */
});
await doTheThing();
```
