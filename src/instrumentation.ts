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

import type * as types from './internal-types';
import type { Response, MiddlewareNext, MiddlewareHandler } from 'hyper-express';

import * as api from '@opentelemetry/api';
import type { Server } from 'hyper-express';
import { LayerType } from './types';
import { SpanName } from './enums/AttributeNames';
// import { VERSION } from './version';
import * as constants from './constants';
import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
  InstrumentationNodeModuleFile,
  isWrapped,
  safeExecuteInTheMiddle,
} from '@opentelemetry/instrumentation';
import { SEMATTRS_HTTP_HOST, SEMATTRS_HTTP_METHOD, SEMATTRS_HTTP_ROUTE, SEMATTRS_HTTP_STATUS_CODE, SEMATTRS_HTTP_TARGET, SEMATTRS_HTTP_URL, SEMATTRS_HTTP_USER_AGENT } from '@opentelemetry/semantic-conventions';
import { isPromise, isAsyncFunction, parseResponseStatus, getScheme } from './utils';
// import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import type { HyperExpressInstrumentationConfig } from './types';
import { SpanKind } from '@opentelemetry/api';

const APM_TYPE = process.env.APM_TYPE;

export class HyperExpressInstrumentation extends InstrumentationBase {
  constructor(config: HyperExpressInstrumentationConfig = {}) {
    super(
      `@opentelemetry/instrumentation-${constants.MODULE_NAME}`,
      "0.38.0",
      config
    );
  }

  //@ts-ignore
  private _moduleVersion?: string;
  private _isDisabled = false;

  override setConfig(config: HyperExpressInstrumentationConfig = {}) {
    this._config = Object.assign({}, config);
  }

  override getConfig(): HyperExpressInstrumentationConfig {
    return this._config as HyperExpressInstrumentationConfig;
  }

  init() {
    const module = new InstrumentationNodeModuleDefinition(
      constants.MODULE_NAME,
      constants.SUPPORTED_VERSIONS,
      (moduleExports, moduleVersion) => {
        this._moduleVersion = moduleVersion;
        return moduleExports;
      }
    );

    module.files.push(
      new InstrumentationNodeModuleFile(
        'hyper-express/src/components/Server.js',
        constants.SUPPORTED_VERSIONS,
        moduleExports => {
          this._isDisabled = false;
          const Server: any = moduleExports;
          for (const name of constants.HYPER_EXPRESS_METHODS) {
            // console.log("name", name);
            if (isWrapped(Server.prototype[name])) {
              this._unwrap(Server.prototype, name);
            }
            this._wrap(
              Server.prototype,
              name as keyof Server,
              this._methodPatcher.bind(this)
            );
          }
          for (const name of constants.HYPER_EXPRESS_MW_METHODS) {
            if (isWrapped(Server.prototype[name])) {
              this._unwrap(Server.prototype, name);
            }
            this._wrap(
              Server.prototype,
              name as keyof Server,
              this._middlewarePatcher.bind(this)
            );
          }
          return moduleExports;
        },
        moduleExports => {
          this._isDisabled = true;
          if (moduleExports) {
            const Server: any = moduleExports;
            for (const name of constants.HYPER_EXPRESS_METHODS) {
              this._unwrap(Server.prototype, name as keyof Server);
            }
            for (const name of constants.HYPER_EXPRESS_MW_METHODS) {
              this._unwrap(Server.prototype, name as keyof Server);
            }
          }
        }
      )
    );

    return module;
  }

  private _middlewarePatcher(original: Function, methodName?: string) {
    const instrumentation = this;
    return function (this: Server, ...handler: types.NestedRequestHandlers) {
      return original.call(
        this,
        instrumentation._handlerPatcher(
          { type: LayerType.MIDDLEWARE, methodName },
          handler
        )
      );
    };
  }

  private _methodPatcher(original: Function, methodName?: string) {
    const instrumentation = this;
    return function (
      this: Server,
      path: any,
      ...handler: types.NestedRequestHandlers
    ) {
      return original.call(
        this,
        path,
        ...instrumentation._handlerPatcher(
          { type: LayerType.REQUEST, path, methodName },
          handler
        )
      );
    };
  }

  // will return the same type as `handler`, but all functions recursively patched
  private _handlerPatcher(
    metadata: types.Metadata,
    handler: MiddlewareHandler | types.NestedRequestHandlers
  ): any {
    if (Array.isArray(handler)) {
      return handler.map(handler => this._handlerPatcher(metadata, handler));
    }
    if (typeof handler === 'function') {
      return (
        req: types.Request,
        res: Response,
        next: MiddlewareNext
      ) => {
        const fnName = handler.name || undefined;
        const isAnnoymousMiddleware = !fnName && metadata.type !== LayerType.REQUEST
        if (isAnnoymousMiddleware || this._isDisabled) {
          return handler(req, res, next);
        }
        // const route =
        //   typeof req.getRoute === 'function'
        //     ? req.getRoute()?.path
        //     : req.route?.path;
        //@ts-ignore
        const reqRoute = req.route;
        // console.log("req.route", reqRoute);
        const route = reqRoute.pattern;
        // console.log("yello", req, req.app);
        // replace HTTP instrumentations name with one that contains a route
        // const httpMetadata = getRPCMetadata(api.context.active());
        // if (httpMetadata?.type === RPCType.HTTP) {
        //   httpMetadata.route = route;
        // }

        const resource =
          metadata.type === LayerType.REQUEST
            ? `${reqRoute.method} ${route}`
            : `middleware - ${fnName || 'anonymous'}`;
        let spanName = '';
        switch (APM_TYPE) {
          case 'DD':
            spanName = metadata.type === LayerType.REQUEST ? SpanName.REQUEST : SpanName.MIDDLEWARE;
            break;
          case 'ELASTIC':
            spanName = resource;
            break;
        }
        let attributes: any = {};

        if (metadata.type === LayerType.REQUEST) {
          //@ts-ignore
          Object.assign(attributes, {
            [SEMATTRS_HTTP_ROUTE]: route,
            [SEMATTRS_HTTP_HOST]: req.headers.host,
            [SEMATTRS_HTTP_METHOD]: reqRoute.method,
            [SEMATTRS_HTTP_USER_AGENT]: req.headers['user-agent'],
            [SEMATTRS_HTTP_TARGET]: route,
            [SEMATTRS_HTTP_URL]: `${getScheme(req.app)}${req.headers.host}${req.url}`,
            // [SEMATTRS_HTTP_CLIENT_IP]: req.ip,
          });
        }
        const span = this.tracer.startSpan(
          spanName,
          {
            attributes,
            kind: metadata.type === LayerType.REQUEST ? 1 : 0,
          },
          api.context.active()
        );

        const instrumentation = this;
        const requestHook = instrumentation.getConfig().requestHook;
        if (requestHook) {
          safeExecuteInTheMiddle(
            () => {
              return requestHook!(span, {
                request: req,
                layerType: metadata.type,
              });
            },
            e => {
              if (e) {
                instrumentation._diag.error('request hook failed', e);
              }
            },
            true
          );
        }

        const patchedNext = (err?: any) => {
          span.end();
          next(err);
        };
        // patchedNext.ifError = next.ifError; // todo: fix me

        const wrapPromise = (promise: Promise<unknown>) => {
          return promise
            .then(value => {
              // console.log("wrapPromise", res.statusCode, metadata.type);
              if (metadata.type === LayerType.REQUEST) {
                // console.log("wrapPromise", res.statusCode, metadata.type);
                // span.setAttribute(SEMATTRS_HTTP_STATUS_CODE, res.statusCode);
                span.setAttributes({
                  [SEMATTRS_HTTP_STATUS_CODE]: res.statusCode,
                });
                span.setStatus({
                  code: parseResponseStatus(SpanKind.SERVER, res.statusCode),
                });
              }
              // span.setAttribute(AttributeNames.STATUS_CODE, res.statusCode);
              
              span.end();
              return value;
            })
            .catch(err => {
              span.recordException(err);
              span.end();
              throw err;
            });
        };

        // console.log("lol", api.context.active(), span);
        const newContext = api.trace.setSpan(api.context.active(), span);
        return api.context.with(
          newContext,
          (req: types.Request, res: Response, next: MiddlewareNext) => {
            if (isAsyncFunction(handler)) {
              return wrapPromise(handler(req, res, next));
            }
            try {
              const result = handler(req, res, next);
              if (isPromise(result)) {
                return wrapPromise(result);
              }
              span.end();
              return result;
            } catch (err: any) {
              span.recordException(err);
              span.end();
              throw err;
            }
          },
          this,
          req,
          res,
          patchedNext
        );
      };
    }

    return handler;
  }
}
