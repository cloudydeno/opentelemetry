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

Deno OTel support is therefore simpler to configure, as it works just like every other programs's
built-in opentelemetry support. HTTP fetches and inbound requests are automatically traced,
while `console.log()` calls get sent as OTel log lines and even correlate with traces.

Deno's OTel SDK is also partially available for custom instrumentation in your program using `opentelemetry-js`.
And if you'd rather have a leaner, Deno-first build of `opentelemetry-js`, this is the repository for you!

### `console.log()`

Deno OTel uploads your program's console output as OTel log signals by default
([docs here](https://docs.deno.com/runtime/fundamentals/open_telemetry/#logs)).
This is an excellent way to correlate logs with traces,
much more complete than trying to inject trace correlation into JSON logs.

The downside is that you may experience double-logging
as Deno also writes your logs to stdout/stderr.
Here are several options to resolve double logging:

1. If you set `OTEL_DENO_CONSOLE=replace`, the traditional logging will stop,
    and you will only have OTel versions of the program logs.

1. If you'd like to keep traditional logging, you could configure your host to
    not gather logs from the programs that use Deno OTel.
    How you do this will depend on your deployment software.

    For example, with Kubernetes + Datadog, adding the pod annotation
    `ad.datadoghq.com/logs_exclude: 'true'` will resolve double-logging
    for your Deno program without disabling `kubectl logs`.

1. If log correlation isn't important to you, adding `OTEL_DENO_CONSOLE=ignore`
    will disable Deno's OTel logs signal.

## example library usage

### Set up the SDK
If you are not using `OTEL_DENO=true` as described above,
then you can register the opentelemetry-js SDK instead.

This SDK will upload your program's signals to OTLP endpoints as JSON.
It also instruments `fetch()` and several Deno-specific APIs.

```ts
import 'jsr:@cloudydeno/opentelemetry/register';
```

### Instrument a function manually
You can import a subset of opentelemetry-js packages from the `pkg/` directory.

```ts
// Imports a Deno build of npm package @opentelemetry/api
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

This repo includes several additional helpers for wrapping functions.
With `asyncSpan`, the wrapper will attach any rejection to the span as an Exception,
and will end the span when the Promise settles.

The second parameter allows customizing the span's options, if desired.

```ts
import { asyncSpan } from 'jsr:@cloudydeno/opentelemetry/instrumentation/async.ts';

const doTheThing = asyncSpan('DoTheThing', {}, async () => {
  const resp = await fetch(...);
  /* ... */
});

await doTheThing();
```

The wrapped function will be passed the created `Span`, if any.
This allows for easily updating the span based on how things are going:

```ts
const doTheThing = asyncSpan('DoTheThing', {}, async (span) => {
  const resp = await fetch(...);
  span?.setAttribute('http.ok', resp.ok);
  /* ... */
});
```

### Instrument Deno APIs

There are other helpers and wrappers in `instrumentation/` as well.
For example, there's a wrapper for `Deno.Kv` operations,
which is not yet instrumentated by Deno's OTel support:

```ts
import { DenoKvInstrumentation } from "jsr:@cloudydeno/opentelemetry/instrumentation/deno-kv.ts";

if ('Kv' in Deno) {
  new DenoKvInstrumentation().enable();
}
```

There's also a `Deno.Command` instrumentation to create spans for child processes:

```ts
import { DenoCommandInstrumentation } from "jsr:@cloudydeno/opentelemetry/instrumentation/deno-command.ts";

new DenoCommandInstrumentation().enable();
```
