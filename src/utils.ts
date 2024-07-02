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

import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { Server } from "hyper-express";

// util.types.isPromise is supported from 10.0.0
export const isPromise = (value?: any): value is Promise<unknown> => {
  return !!(
    value &&
    typeof value.then === 'function' &&
    typeof value.catch === 'function' &&
    value.toString() === '[object Promise]'
  );
};

// util.types.isAsyncFunction is supported from 10.0.0
export const isAsyncFunction = (value?: unknown) => {
  return !!(
    value &&
    typeof value === 'function' &&
    value.constructor?.name === 'AsyncFunction'
  );
};

export const parseResponseStatus = (
  kind: SpanKind,
  statusCode?: number
): SpanStatusCode => {
  const upperBound = kind === SpanKind.CLIENT ? 400 : 500;
  // 1xx, 2xx, 3xx are OK on client and server
  // 4xx is OK on server
  if (statusCode && statusCode >= 100 && statusCode < upperBound) {
    return SpanStatusCode.UNSET;
  }

  // All other codes are error
  return SpanStatusCode.ERROR;
};

export const getScheme = (app: Server) => {
  //@ts-ignore
  return app._options.is_ssl ? 'https://' : 'http://';
}
