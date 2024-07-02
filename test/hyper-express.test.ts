/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { context, trace, Span } from '@opentelemetry/api';
import { SEMATTRS_HTTP_METHOD } from '@opentelemetry/semantic-conventions';
import { RPCMetadata, RPCType, setRPCMetadata } from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import { HyperExpressInstrumentation } from '../src';
import * as types from '../src/internal-types';
import { HyperExpressRequestInfo } from '../src/types';
const plugin = new HyperExpressInstrumentation();

import * as semver from 'semver';
import * as assert from 'assert';
import * as http from 'http';
import { AddressInfo } from 'net';
import { Server } from "hyper-express";

const LIB_VERSION = require('hyper-express/package.json').version;


const assertIsVersion = (str: any) => {
  assert.strictEqual(typeof str, 'string');
  assert(/^[0-9]+\.[0-9]+\.[0-9]+$/.test(str));
};

const httpRequest = {
  get: (options: http.ClientRequestArgs | string) => {
    return new Promise((resolve, reject) => {
      return http.get(options, resp => {
        let data = '';
        resp.on('data', chunk => {
          data += chunk;
        });
        resp.on('end', () => {
          resolve(data);
        });
        resp.on('error', err => {
          reject(err);
        });
      });
    });
  },
};
const noop = (value: unknown) => { };
const defer = (): {
  promise: Promise<unknown>;
  resolve: Function;
  reject: Function;
} => {
  let resolve = noop;
  let reject = noop;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

class AppError extends Error {
  toJSON() {
    return { message: this.message };
  }
}

const useHandler = (req, res, next) => {
  // only run if route was found
  next();
};
const getHandler = (req, res, next) => {
  res.send({ route: req?.params?.param });
};
const throwError = (req, res, next) => {
  throw new AppError('NOK');
};
const returnError = (req, res, next) => {
  next(new AppError('NOK'));
};

const createServer = async (setupRoutes?: Function) => {
  const server = new Server();

  if (typeof setupRoutes === 'function') {
    setupRoutes(server);
  } else {
    // to force an anonymous fn for testing
    // server.pre((res: any, req: any, next: any) => {
    //   // run before routing
    //   next();
    // });

    server.use(useHandler);
    server.get('/route/:param', getHandler);
    server.get('/throwing', throwError);
    server.get('/erroring', returnError);
  }

  await server.listen(0);
  return server;
};

describe('Hyper-Express Instrumentation', () => {
  const provider = new NodeTracerProvider();
  const memoryExporter = new InMemorySpanExporter();
  const spanProcessor = new SimpleSpanProcessor(memoryExporter);
  provider.addSpanProcessor(spanProcessor);
  plugin.setTracerProvider(provider);
  const tracer = provider.getTracer('default');
  let contextManager: AsyncHooksContextManager;
  let server: Server;
  let port: number;

  before(() => {
    plugin.enable();
  });

  after(() => {
    plugin.disable();
  });

  beforeEach(async () => {
    contextManager = new AsyncHooksContextManager();
    context.setGlobalContextManager(contextManager.enable());

    server = await createServer();
    port = server.port;
    assert.strictEqual(memoryExporter.getFinishedSpans().length, 0);
  });

  afterEach(() => {
    memoryExporter.reset();
    context.disable();
    server.close();
  });

  describe('Instrumenting core middleware calls', () => {
    it('should create a span for each handler', async () => {
      const rootSpan = tracer.startSpan('clientSpan');

      await context.with(
        trace.setSpan(context.active(), rootSpan),
        async () => {
          await httpRequest.get(`http://localhost:${port}/route/foo`);
          rootSpan.end();
          assert.strictEqual(memoryExporter.getFinishedSpans().length, 4);

          {
            // span from pre
            const span = memoryExporter.getFinishedSpans()[0];
            assert.notStrictEqual(span, undefined);
            assert.strictEqual(span.attributes['http.route'], undefined);
            assert.strictEqual(span.attributes['hyper-express.method'], 'pre');
            assert.strictEqual(span.attributes['hyper-express.type'], 'middleware');
            assert.strictEqual(span.attributes['hyper-express.name'], undefined);
            assertIsVersion(span.attributes['hyper-express.version']);
          }
          {
            // span from use
            const span = memoryExporter.getFinishedSpans()[1];
            assert.notStrictEqual(span, undefined);
            assert.strictEqual(span.attributes['http.route'], '/route/:param');
            assert.strictEqual(span.attributes['hyper-express.method'], 'use');
            assert.strictEqual(span.attributes['hyper-express.type'], 'middleware');
            assert.strictEqual(span.attributes['hyper-express.name'], 'useHandler');
            assertIsVersion(span.attributes['hyper-express.version']);
          }
          {
            // span from get
            const span = memoryExporter.getFinishedSpans()[2];
            assert.notStrictEqual(span, undefined);
            assert.strictEqual(span.attributes['http.route'], '/route/:param');
            assert.strictEqual(span.attributes['hyper-express.method'], 'get');
            assert.strictEqual(
              span.attributes['hyper-express.type'],
              'request_handler'
            );
            assert.strictEqual(span.attributes['hyper-express.name'], 'getHandler');
            assertIsVersion(span.attributes['hyper-express.version']);
          }
        }
      );
    });

    it('should lack `http.route` but still have `hyper-express.version` if route was 404', async () => {
      const rootSpan = tracer.startSpan('rootSpan');

      await context.with(
        trace.setSpan(context.active(), rootSpan),
        async () => {
          const res = await httpRequest.get(
            `http://localhost:${port}/not-found`
          );
          rootSpan.end();
          assert.strictEqual(memoryExporter.getFinishedSpans().length, 2);

          {
            // span from pre
            const span = memoryExporter.getFinishedSpans()[0];
            assert.notStrictEqual(span, undefined);
            assert.strictEqual(span.attributes['http.route'], undefined);
            assert.strictEqual(span.attributes['hyper-express.method'], 'pre');
            assert.strictEqual(span.attributes['hyper-express.type'], 'middleware');
            assert.strictEqual(span.attributes['hyper-express.name'], undefined);
            assertIsVersion(span.attributes['hyper-express.version']);
          }
          assert.strictEqual(
            res,
            '{"code":"ResourceNotFound","message":"/not-found does not exist"}'
          );
        }
      );
    });

    it('should create a span for an endpoint that called done(error)', async () => {
      const rootSpan = tracer.startSpan('clientSpan');

      await context.with(
        trace.setSpan(context.active(), rootSpan),
        async () => {
          const result = await httpRequest.get(
            `http://localhost:${port}/erroring`
          );
          rootSpan.end();
          assert.strictEqual(memoryExporter.getFinishedSpans().length, 4);

          if (semver.satisfies(LIB_VERSION, '>=8')) {
            assert.deepEqual(
              result,
              '{"code":"Internal","message":"Error: NOK"}'
            );
          } else if (semver.satisfies(LIB_VERSION, '>=7 <8')) {
            assert.deepEqual(
              result,
              '{"code":"Internal","message":"caused by Error: NOK"}'
            );
          } else {
            assert.deepEqual(result, '{"message":"NOK"}');
          }

          {
            // span from pre
            const span = memoryExporter.getFinishedSpans()[0];
            assert.notStrictEqual(span, undefined);
            assert.strictEqual(span.attributes['http.route'], undefined);
            assert.strictEqual(span.attributes['hyper-express.method'], 'pre');
            assert.strictEqual(span.attributes['hyper-express.type'], 'middleware');
            assert.strictEqual(span.attributes['hyper-express.name'], undefined);
            assertIsVersion(span.attributes['hyper-express.version']);
          }
          {
            // span from use
            const span = memoryExporter.getFinishedSpans()[1];
            assert.notStrictEqual(span, undefined);
            assert.strictEqual(span.attributes['http.route'], '/erroring');
            assert.strictEqual(span.attributes['hyper-express.method'], 'use');
            assert.strictEqual(span.attributes['hyper-express.type'], 'middleware');
            assert.strictEqual(span.attributes['hyper-express.name'], 'useHandler');
            assertIsVersion(span.attributes['hyper-express.version']);
          }
          {
            // span from get
            const span = memoryExporter.getFinishedSpans()[2];
            assert.notStrictEqual(span, undefined);
            assert.strictEqual(span.attributes['http.route'], '/erroring');
            assert.strictEqual(span.attributes['hyper-express.method'], 'get');
            assert.strictEqual(
              span.attributes['hyper-express.type'],
              'request_handler'
            );
            assert.strictEqual(span.attributes['hyper-express.name'], 'returnError');
            assertIsVersion(span.attributes['hyper-express.version']);
          }
        }
      );
    });

    it('should update rpcMetadata.route', async () => {
      const httpSpan: types.InstrumentationSpan = tracer.startSpan('HTTP GET');
      const rpcMetadata: RPCMetadata = {
        type: RPCType.HTTP,
        span: httpSpan,
      };

      const testLocalServer = await createServer((server: Server) => {
        // server.pre((req, res, next) => {
        //   // to simulate HTTP instrumentation
        //   context.with(
        //     setRPCMetadata(
        //       trace.setSpan(context.active(), httpSpan),
        //       rpcMetadata
        //     ),
        //     next
        //   );
        // });
        server.get('/route/:param', getHandler);
      });
      const testLocalPort = testLocalServer.port;

      try {
        const res = await httpRequest.get(
          `http://localhost:${testLocalPort}/route/hello`
        );
        httpSpan.end();
        assert.strictEqual(memoryExporter.getFinishedSpans().length, 3);
        assert.strictEqual(rpcMetadata.route, '/route/:param');
        assert.strictEqual(res, '{"route":"hello"}');
      } finally {
        testLocalServer.close();
      }
    });

    it('should work with verbose API', async () => {
      const testLocalServer = await createServer((server: Server) => {
        server.get('/route/:param',getHandler);
      });
      const testLocalPort = testLocalServer.port;

      try {
        const res = await httpRequest.get(
          `http://localhost:${testLocalPort}/route/hello`
        );
        assert.strictEqual(memoryExporter.getFinishedSpans().length, 1);
        {
          // span from get
          const span = memoryExporter.getFinishedSpans()[0];
          assert.notStrictEqual(span, undefined);
          assert.strictEqual(span.attributes['http.route'], '/route/:param');
          assert.strictEqual(span.attributes['hyper-express.method'], 'get');
          assert.strictEqual(
            span.attributes['hyper-express.type'],
            'request_handler'
          );
          assert.strictEqual(span.attributes['hyper-express.name'], 'getHandler');
          assertIsVersion(span.attributes['hyper-express.version']);
        }
        assert.strictEqual(res, '{"route":"hello"}');
      } finally {
        testLocalServer.close();
      }
    });

    it('should work with async handlers', async () => {
      const { promise: work, resolve: resolveWork } = defer();
      const { promise: started, resolve: resolveStarted } = defer();
      // status to assert the correctness of the test
      let status = 'uninit';
      const asyncHandler = async (req, res, next) => {
        status = 'started';
        resolveStarted();
        await work;
        status = 'done';
        return getHandler(req, res, next);
      };
      const testLocalServer = await createServer((server: Server) => {
        server.get('/route/:param', asyncHandler);
      });
      const testLocalPort = testLocalServer.port;

      try {
        const requestPromise = httpRequest
          .get(`http://localhost:${testLocalPort}/route/hello`)
          .then(res => {
            // assert request results
            assert.strictEqual(res, '{"route":"hello"}');
          });

        // assert pre request state
        assert.strictEqual(status, 'uninit');
        await started;

        // assert started state
        assert.strictEqual(status, 'started');
        assert.strictEqual(memoryExporter.getFinishedSpans().length, 0);

        resolveWork();
        await requestPromise;

        // assert done state
        assert.strictEqual(status, 'done');
        assert.strictEqual(memoryExporter.getFinishedSpans().length, 1);
        {
          // span from get
          const span = memoryExporter.getFinishedSpans()[0];
          assert.notStrictEqual(span, undefined);
          assert.strictEqual(span.attributes['http.route'], '/route/:param');
          assert.strictEqual(span.attributes['hyper-express.method'], 'get');
          assert.strictEqual(
            span.attributes['hyper-express.type'],
            'request_handler'
          );
          assert.strictEqual(span.attributes['hyper-express.name'], 'asyncHandler');
          assertIsVersion(span.attributes['hyper-express.version']);
        }
      } finally {
        testLocalServer.close();
      }
    });

    it('should work with promise-returning handlers', async () => {
      const { promise: work, resolve: resolveWork } = defer();
      const { promise: started, resolve: resolveStarted } = defer();
      // status to assert the correctness of the test
      let status = 'uninit';
      const promiseReturningHandler = (
        req,
        res,
        next
      ) => {
        status = 'started';
        resolveStarted();
        return work.then(() => {
          status = 'done';
          return getHandler(req, res, next);
        });
      };
      const testLocalServer = await createServer((server: Server) => {
        server.get('/route/:param', promiseReturningHandler);
      });
      const testLocalPort = testLocalServer.port;

      try {
        const requestPromise = httpRequest
          .get(`http://localhost:${testLocalPort}/route/hello`)
          .then(res => {
            // assert request results
            assert.strictEqual(res, '{"route":"hello"}');
          });

        // assert pre request state
        assert.strictEqual(status, 'uninit');
        await started;

        // assert started state
        assert.strictEqual(status, 'started');
        assert.strictEqual(memoryExporter.getFinishedSpans().length, 0);

        resolveWork();
        await requestPromise;

        // assert done state
        assert.strictEqual(status, 'done');
        assert.strictEqual(memoryExporter.getFinishedSpans().length, 1);
        {
          // span from get
          const span = memoryExporter.getFinishedSpans()[0];
          assert.notStrictEqual(span, undefined);
          assert.strictEqual(span.attributes['http.route'], '/route/:param');
          assert.strictEqual(span.attributes['hyper-express.method'], 'get');
          assert.strictEqual(
            span.attributes['hyper-express.type'],
            'request_handler'
          );
          assert.strictEqual(
            span.attributes['hyper-express.name'],
            'promiseReturningHandler'
          );
          assertIsVersion(span.attributes['hyper-express.version']);
        }
      } finally {
        testLocalServer.close();
      }
    });

    it('should create spans even if there is no parent', async () => {
      const res = await httpRequest.get(`http://localhost:${port}/route/bar`);
      assert.strictEqual(memoryExporter.getFinishedSpans().length, 3);
      assert.strictEqual(res, '{"route":"bar"}');
    });

    describe('using requestHook in config', () => {
      it('calls requestHook provided function when set in config', async () => {
        const requestHook = (span: Span, info) => {
          span.setAttribute(SEMATTRS_HTTP_METHOD, info.request.method);
          span.setAttribute('hyper-express.layer', info.layerType);
        };

        plugin.setConfig({
          ...plugin.getConfig(),
          requestHook,
        });

        const rootSpan = tracer.startSpan('clientSpan');

        await context.with(
          trace.setSpan(context.active(), rootSpan),
          async () => {
            await httpRequest.get(`http://localhost:${port}/route/foo`);
            rootSpan.end();
            assert.strictEqual(memoryExporter.getFinishedSpans().length, 4);

            {
              // span from get
              const span = memoryExporter.getFinishedSpans()[2];
              assert.notStrictEqual(span, undefined);
              assert.strictEqual(span.attributes[SEMATTRS_HTTP_METHOD], 'GET');
              assert.strictEqual(
                span.attributes['hyper-express.layer'],
                'request_handler'
              );
            }
          }
        );
      });

      it('does not propagate an error from a requestHook that throws exception', async () => {
        const requestHook = (span: Span, info) => {
          span.setAttribute(SEMATTRS_HTTP_METHOD, info.request.method);

          throw Error('error thrown in requestHook');
        };

        plugin.setConfig({
          ...plugin.getConfig(),
          requestHook,
        });

        const rootSpan = tracer.startSpan('clientSpan');

        await context.with(
          trace.setSpan(context.active(), rootSpan),
          async () => {
            await httpRequest.get(`http://localhost:${port}/route/foo`);
            rootSpan.end();
            assert.strictEqual(memoryExporter.getFinishedSpans().length, 4);

            {
              // span from get
              const span = memoryExporter.getFinishedSpans()[2];
              assert.notStrictEqual(span, undefined);
              assert.strictEqual(span.attributes[SEMATTRS_HTTP_METHOD], 'GET');
            }
          }
        );
      });
    });
  });

  describe('Disabling hyper-express instrumentation', () => {
    it('should not create new spans', async () => {
      plugin.disable();
      const rootSpan = tracer.startSpan('rootSpan');

      await context.with(
        trace.setSpan(context.active(), rootSpan),
        async () => {
          assert.strictEqual(
            await httpRequest.get(`http://localhost:${port}/route/foo`),
            '{"route":"foo"}'
          );
          rootSpan.end();
          assert.strictEqual(memoryExporter.getFinishedSpans().length, 1);
          assert.notStrictEqual(
            memoryExporter.getFinishedSpans()[0],
            undefined
          );
        }
      );
    });
  });
});
