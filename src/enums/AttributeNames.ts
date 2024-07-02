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
export enum AttributeNames {
  TYPE = 'hyper-express.type',
  NAME = 'hyper-express.name',
  METHOD = 'hyper-express.method',
  VERSION = 'hyper-express.version',
}

export enum SpanTags {
  COMPONENT = 'component',
  RESOURCE = 'resource.name',
  KIND = 'span.kind',
}

export enum SpanName {
  REQUEST = 'hyper-express.request',
  MIDDLEWARE = 'hyper-express.middleware'
}

export enum SpanKind {
  SERVER = 'server',
  CLIENT = 'client',
  PRODUCER = 'producer',
  CONSUMER = 'consumer',
  INTERNAL = 'internal',
}

export const LIBRARY_NAME = 'hyper-express';