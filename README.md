# OpenTelemetry Hyper-Express Instrumentation for Node.js

[![NPM Published Version][npm-img]][npm-url]
[![Apache License][license-image]][license-image]

This module provides automatic instrumentation for the [`hyper-express`](https://github.com/kartikk221/hyper-express) module, which may be loaded using the [`@opentelemetry/sdk-trace-node`](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-trace-node) package and is included in the [`@opentelemetry/auto-instrumentations-node`](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node) bundle. It allows the user to automatically collect trace data and export them to their backend of choice.

If total installation size is not constrained, it is recommended to use the [`@opentelemetry/auto-instrumentations-node`](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node) bundle with [@opentelemetry/sdk-node](`https://www.npmjs.com/package/@opentelemetry/sdk-node`) for the most seamless instrumentation experience.

Compatible with OpenTelemetry JS API and SDK `1.0+`.

## Installation

```bash
npm install --save @pw-tech/opentelemetry-instrumentation-hyper-express
```

### Supported Versions

- `>=6.0.0`

## Usage

### With opentelemetry

```js
const { HyperExpressInstrumentation } = require('@pw-tech/opentelemetry-instrumentation-hyper-express');
const { ConsoleSpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');

const provider = new NodeTracerProvider();

provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
provider.register();

registerInstrumentations({
  instrumentations: [
    new HyperExpressInstrumentation()
  ],
});

```

### With Datadog (dd-trace)
```js
let service = "your-service";

const tracer = require('dd-trace').init({
  service,
})
const { TracerProvider } = tracer;
const provider = new TracerProvider();
provider.register();

import HyperExpressInstrumentation from "@pw-tech/instrumentation-hyper-express";
const {
  getNodeAutoInstrumentations
} = require('@opentelemetry/auto-instrumentations-node');

new HyperExpressInstrumentation();


```

## Semantic Conventions

This package uses `@opentelemetry/semantic-conventions` version `1.22+`, which implements Semantic Convention [Version 1.7.0](https://github.com/open-telemetry/opentelemetry-specification/blob/v1.7.0/semantic_conventions/README.md)

Attributes collected:

| Attribute    | Short Description                  |
| ------------ | ---------------------------------- |
| `http.route` | The matched route (path template). |

## Useful links

- For more information on OpenTelemetry, visit: <https://opentelemetry.io/>
- For more about OpenTelemetry JavaScript: <https://github.com/open-telemetry/opentelemetry-js>
- For help or feedback on this project, join us in [GitHub Discussions][discussions-url]

## License

Apache 2.0 - See [LICENSE][license-url] for more information.
