[![JSR](https://jsr.io/badges/@cloudydeno/opentelemetry)](https://jsr.io/@cloudydeno/opentelemetry)
[![CI](https://github.com/cloudydeno/opentelemetry/actions/workflows/deno-ci.yml/badge.svg)](https://github.com/cloudydeno/opentelemetry/actions/workflows/deno-ci.yml)


# `@cloudydeno/opentelemetry` on JSR

A Deno-oriented build of [opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js),
with extra Deno-specific integrations.

* [Published on JSR](https://jsr.io/@cloudydeno/opentelemetry) since `v0.10.0`.
* Previous versions were [published to `/x/`](https://deno.land/x/observability).

## Interaction with Deno's OTel support
Deno now has parts of a opentelemetry sdk available by setting `DENO_OTEL=true` when starting Deno.
This support was recently marked as stable and is backed by a Rust opentelemetry library,
outside of the running typescript sandbox.

Deno OTel support is therefor simpler to configure, as it works just like every other programs's
built-in opentelemetry support. HTTP fetches and inbound requests are automatically traced,
while `console.log()` calls get sent as OTel log lines and even correlate with traces.

Deno's OTel SDK is also partially available for custom instrumentation in your program using `opentelemetry-js`.
And if you'd rather have a leaner, Deno-first build of `opentelemetry-js`, this is the repository for you!

## example usage

### Set up the SDK
This is optional nowadays. You can instead set `OTEL_DENO=true` as described above.

```ts
import 'jsr:@cloudydeno/opentelemetry/register';
```

### Instrument a function manually
You can import some opentelemetry-js packages from the `pkg/` directory.

```ts
import { trace } from 'jsr:@cloudydeno/opentelemetry/pkg/api';
const tracer = trace.getTracer('demo-scope');

export function rollTheDice(rolls: number, min: number, max: number) {
  return tracer.startActiveSpan('rollTheDice', (span: Span) => {
    const result: number[] = [];
    for (let i = 0; i < rolls; i++) {
      result.push(rollOnce(min, max));
    }
    span.end(); // Be sure to end the span!
    return result;
  });
}

rollTheDice();
```

### Wrap an async function in a span

Uses a bespoke helper from this repo.
It handles ending the span and attaching any thrown/rejected errors.

```ts
import { asyncSpan } from 'jsr:@cloudydeno/opentelemetry/instrumentation/async.ts';

const doTheThing = asyncSpan('DoTheThing', {}, async () => {
  const resp = await fetch(...);
  /* ... */
});

await doTheThing();
```

### Instrument Deno KV

There are other helpers and wrappers in `instrumentation/` as well.
For example, there's a wrapper for `Deno.Kv` operations,
which is not yet instrumentated by Deno's OTel support:

```ts
import { DenoKvInstrumentation } from "jsr:@cloudydeno/opentelemetry/instrumentation/deno-kv.ts";

if ('Kv' in Deno) {
  new DenoKvInstrumentation().enable();
}
```
