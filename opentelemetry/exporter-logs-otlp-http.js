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
/// <reference types="./exporter-logs-otlp-http.d.ts" />

import { OTLPExporterBase } from './otlp-exporter-base.js';
import { JsonLogsSerializer } from './otlp-transformer.js';
import { createOtlpHttpExportDelegate, convertLegacyHttpOptions } from './otlp-exporter-base.js';

const VERSION = "0.200.0";

class OTLPLogExporter extends OTLPExporterBase {
	constructor(config = {}) {
		super(createOtlpHttpExportDelegate(convertLegacyHttpOptions(config, 'LOGS', 'v1/logs', {
			'User-Agent': `Deno/${Deno.version.deno} OTel-OTLP-Exporter-JavaScript/${VERSION}`,
			'Content-Type': 'application/json',
		}), JsonLogsSerializer));
	}
}

export { OTLPLogExporter };
