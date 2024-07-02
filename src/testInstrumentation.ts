import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
// import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import {
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { HyperExpressInstrumentation } from './instrumentation';
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
// import * as ot from '@opentelemetry/api';
// const { RestifyInstrumentation } = require('@opentelemetry/instrumentation-restify');

const Exporter = ((exporterParam: string) => {
  if (typeof exporterParam === 'string') {
    const exporterString = exporterParam.toLowerCase();
    if (exporterString.startsWith('z')) {
      return ZipkinExporter;
    }
    if (exporterString.startsWith('j')) {
      return JaegerExporter;
    }
  }
  return ConsoleSpanExporter;
})('console');

// const otelTracer = ot.trace.getTracer(
//   'my-service'
// )

const sdk = new NodeSDK({
  serviceName: "my-service",
  traceExporter: new Exporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new ConsoleMetricExporter(),
  }),
  instrumentations: [new HyperExpressInstrumentation()],
});

sdk.start();