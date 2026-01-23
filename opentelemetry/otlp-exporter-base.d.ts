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

import { ExportResult } from './core.d.ts';
import { ISerializer } from './otlp-transformer.d.ts';

interface ExportResponseSuccess {
	status: 'success';
	data?: Uint8Array;
}
interface ExportResponseFailure {
	status: 'failure';
	error: Error;
}
interface ExportResponseRetryable {
	status: 'retryable';
	retryInMillis?: number;
}
type ExportResponse = ExportResponseSuccess | ExportResponseFailure | ExportResponseRetryable;

interface IExporterTransport {
	send(data: Uint8Array, timeoutMillis: number): Promise<ExportResponse>;
	shutdown(): void;
}

/**
 * Internally shared export logic for OTLP.
 */
interface IOtlpExportDelegate<Internal> {
	export(internalRepresentation: Internal, resultCallback: (result: ExportResult) => void): void;
	forceFlush(): Promise<void>;
	shutdown(): Promise<void>;
}

declare class OTLPExporterBase<Internal> {
	private _delegate;
	constructor(_delegate: IOtlpExportDelegate<Internal>);
	/**
	* Export items.
	* @param items
	* @param resultCallback
	*/
	export(items: Internal, resultCallback: (result: ExportResult) => void): void;
	forceFlush(): Promise<void>;
	shutdown(): Promise<void>;
}

/**
 * Interface for handling error
 */
declare class OTLPExporterError extends Error {
	readonly code?: number;
	readonly name: string;
	readonly data?: string;
	constructor(message?: string, code?: number, data?: string);
}

type HeadersFactory = () => Promise<Record<string, string>>;
interface OtlpHttpConfiguration extends OtlpSharedConfiguration {
	url: string;
	headers: HeadersFactory;
}

/**
 * Configuration shared across all OTLP exporters
 *
 * Implementation note: anything added here MUST be
 * - platform-agnostic
 * - signal-agnostic
 * - transport-agnostic
 */
interface OtlpSharedConfiguration {
	timeoutMillis: number;
	concurrencyLimit: number;
	compression: 'gzip' | 'none';
}
/**
 * @param userProvidedConfiguration  Configuration options provided by the user in code.
 * @param fallbackConfiguration Fallback to use when the {@link userProvidedConfiguration} does not specify an option.
 * @param defaultConfiguration The defaults as defined by the exporter specification
 */
declare function mergeOtlpSharedConfigurationWithDefaults(userProvidedConfiguration: Partial<OtlpSharedConfiguration>, fallbackConfiguration: Partial<OtlpSharedConfiguration>, defaultConfiguration: OtlpSharedConfiguration): OtlpSharedConfiguration;
declare function getSharedConfigurationDefaults(): OtlpSharedConfiguration;

interface OTLPExporterConfigBase {
	/**
	* Custom headers that will be attached to the HTTP request that's sent to the endpoint.
	*
	* @remarks
	* Prefer using a plain object over a factory function wherever possible.
	* If using a factory function (`HttpAgentFactory`), **do not import `http` or `https` at the top of the file**
	* Instead, use dynamic `import()` or `require()` to load the module. This ensures that the `http` or `https`
	* module is not loaded before `@opentelemetry/instrumentation-http` can instrument it.
	*
	* Functions passed to the exporter MUST NOT throw errors.
	*
	* @example <caption> Using headers options directly: </caption>
	* headers: {
	*  Authorization: "Api-Token my-secret-token",
	* }
	*
	* @example <caption> Using a custom factory function </caption>
	* headers: async () => {
	*   // ... do whatever you need to obtain the headers, ensuring you `await import('your-library')` to avoid breaking instrumentations ...
	*   return {
	*     Authorization: `Bearer ${token}`,
	*   };
	* };
	*/
	headers?: Record<string, string> | HeadersFactory;
	url?: string;
	concurrencyLimit?: number;
	/** Maximum time the OTLP exporter will wait for each batch export.
	* The default value is 10000ms. */
	timeoutMillis?: number;
}

/**
 * Collector Exporter node base config
 */
interface OTLPExporterNodeConfigBase extends OTLPExporterConfigBase {
	compression?: CompressionAlgorithm;
	/**
	* Custom HTTP agent options or a factory function for creating agents.
	*
	* @remarks
	* Prefer using `http.AgentOptions` or `https.AgentOptions` over a factory function wherever possible.
	* If using a factory function (`HttpAgentFactory`), **do not import `http.Agent` or `https.Agent`
	* statically at the top of the file**.
	* Instead, use dynamic `import()` or `require()` to load the module. This ensures that the `http` or `https`
	* module is not loaded before `@opentelemetry/instrumentation-http` can instrument it.
	*
	* @example <caption> Using agent options directly: </caption>
//    * httpAgentOptions: {
//    *   keepAlive: true,
	*   maxSockets: 10
	* }
	*
	* @example <caption> Using a factory with dynamic import: </caption>
//    * httpAgentOptions: async (protocol) => {
	*   const module = protocol === 'http:' ? await import('http') : await import('https');
//    *   return new module.Agent({ keepAlive: true });
	* }
	*/
	/**
	* User agent header string to be prepended to the exporter's default value.
	* Availablie since v1.49.0 of the spec.
	* Ref: https://opentelemetry.io/docs/specs/otel/protocol/exporter/#user-agent
	*/
	userAgent?: string;
}
declare enum CompressionAlgorithm {
	NONE = "none",
	GZIP = "gzip"
}

declare function createOtlpNetworkExportDelegate<Internal, Response>(options: OtlpSharedConfiguration, serializer: ISerializer<Internal, Response>, transport: IExporterTransport): IOtlpExportDelegate<Internal>;

type HttpAgentFactory = (_protocol?: string) => any;
interface OtlpNodeHttpConfiguration extends OtlpHttpConfiguration {
	agentFactory: HttpAgentFactory;
	userAgent?: string;
}
declare function httpAgentFactoryFromOptions(options: any): HttpAgentFactory;

declare function createOtlpHttpExportDelegate<Internal, Response>(options: OtlpNodeHttpConfiguration, serializer: ISerializer<Internal, Response>): IOtlpExportDelegate<Internal>;

declare function getSharedConfigurationFromEnvironment(signalIdentifier: string): Partial<OtlpSharedConfiguration>;

/**
 * @deprecated this will be removed in 2.0
 * @param config
 * @param signalIdentifier
 * @param signalResourcePath
 * @param requiredHeaders
 */
declare function convertLegacyHttpOptions(config: OTLPExporterNodeConfigBase, signalIdentifier: string, signalResourcePath: string, requiredHeaders: Record<string, string>): OtlpNodeHttpConfiguration;

export { CompressionAlgorithm, ExportResponse, ExportResponseFailure, ExportResponseRetryable, ExportResponseSuccess, IExporterTransport, IOtlpExportDelegate, OTLPExporterBase, OTLPExporterConfigBase, OTLPExporterError, OTLPExporterNodeConfigBase, OtlpSharedConfiguration, convertLegacyHttpOptions, createOtlpHttpExportDelegate, createOtlpNetworkExportDelegate, getSharedConfigurationDefaults, getSharedConfigurationFromEnvironment, httpAgentFactoryFromOptions, mergeOtlpSharedConfigurationWithDefaults };
