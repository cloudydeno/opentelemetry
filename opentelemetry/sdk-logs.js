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
/// <reference types="./sdk-logs.d.ts" />

import * as api from './api.js';
import { context, trace, isSpanContextValid, TraceFlags, diag } from './api.js';
import { SeverityNumber, NOOP_LOGGER } from './api-logs.js';
import { defaultResource } from './resources.js';
import { timeInputToHrTime, getNumberFromEnv, callWithTimeout, merge, BindOnceFuture, hrTimeToMicroseconds, ExportResultCode, internal, globalErrorHandler } from './core.js';

function isLogAttributeValue(val) {
	return isLogAttributeValueInternal(val, new WeakSet());
}
function isLogAttributeValueInternal(val, visited) {
	if (val == null) {
		return true;
	}
	if (typeof val === 'string' ||
		typeof val === 'number' ||
		typeof val === 'boolean') {
		return true;
	}
	if (val instanceof Uint8Array) {
		return true;
	}
	if (typeof val === 'object') {
		if (visited.has(val)) {
			return false;
		}
		visited.add(val);
		if (Array.isArray(val)) {
			return val.every(item => isLogAttributeValueInternal(item, visited));
		}
		const obj = val;
		if (obj.constructor !== Object && obj.constructor !== undefined) {
			return false;
		}
		return Object.values(obj).every(item => isLogAttributeValueInternal(item, visited));
	}
	return false;
}

class LogRecordImpl {
	hrTime;
	hrTimeObserved;
	spanContext;
	resource;
	instrumentationScope;
	attributes = {};
	_severityText;
	_severityNumber;
	_body;
	_eventName;
	totalAttributesCount = 0;
	_isReadonly = false;
	_logRecordLimits;
	set severityText(severityText) {
		if (this._isLogRecordReadonly()) {
			return;
		}
		this._severityText = severityText;
	}
	get severityText() {
		return this._severityText;
	}
	set severityNumber(severityNumber) {
		if (this._isLogRecordReadonly()) {
			return;
		}
		this._severityNumber = severityNumber;
	}
	get severityNumber() {
		return this._severityNumber;
	}
	set body(body) {
		if (this._isLogRecordReadonly()) {
			return;
		}
		this._body = body;
	}
	get body() {
		return this._body;
	}
	get eventName() {
		return this._eventName;
	}
	set eventName(eventName) {
		if (this._isLogRecordReadonly()) {
			return;
		}
		this._eventName = eventName;
	}
	get droppedAttributesCount() {
		return this.totalAttributesCount - Object.keys(this.attributes).length;
	}
	constructor(_sharedState, instrumentationScope, logRecord) {
		const { timestamp, observedTimestamp, eventName, severityNumber, severityText, body, attributes = {}, context, } = logRecord;
		const now = Date.now();
		this.hrTime = timeInputToHrTime(timestamp ?? now);
		this.hrTimeObserved = timeInputToHrTime(observedTimestamp ?? now);
		if (context) {
			const spanContext = api.trace.getSpanContext(context);
			if (spanContext && api.isSpanContextValid(spanContext)) {
				this.spanContext = spanContext;
			}
		}
		this.severityNumber = severityNumber;
		this.severityText = severityText;
		this.body = body;
		this.resource = _sharedState.resource;
		this.instrumentationScope = instrumentationScope;
		this._logRecordLimits = _sharedState.logRecordLimits;
		this._eventName = eventName;
		this.setAttributes(attributes);
	}
	setAttribute(key, value) {
		if (this._isLogRecordReadonly()) {
			return this;
		}
		if (key.length === 0) {
			api.diag.warn(`Invalid attribute key: ${key}`);
			return this;
		}
		if (!isLogAttributeValue(value)) {
			api.diag.warn(`Invalid attribute value set for key: ${key}`);
			return this;
		}
		this.totalAttributesCount += 1;
		if (Object.keys(this.attributes).length >=
			this._logRecordLimits.attributeCountLimit &&
			!Object.prototype.hasOwnProperty.call(this.attributes, key)) {
			if (this.droppedAttributesCount === 1) {
				api.diag.warn('Dropping extra attributes.');
			}
			return this;
		}
		this.attributes[key] = this._truncateToSize(value);
		return this;
	}
	setAttributes(attributes) {
		for (const [k, v] of Object.entries(attributes)) {
			this.setAttribute(k, v);
		}
		return this;
	}
	setBody(body) {
		this.body = body;
		return this;
	}
	setEventName(eventName) {
		this.eventName = eventName;
		return this;
	}
	setSeverityNumber(severityNumber) {
		this.severityNumber = severityNumber;
		return this;
	}
	setSeverityText(severityText) {
		this.severityText = severityText;
		return this;
	}
	_makeReadonly() {
		this._isReadonly = true;
	}
	_truncateToSize(value) {
		const limit = this._logRecordLimits.attributeValueLengthLimit;
		if (limit <= 0) {
			api.diag.warn(`Attribute value limit must be positive, got ${limit}`);
			return value;
		}
		if (value == null) {
			return value;
		}
		if (typeof value === 'string') {
			return this._truncateToLimitUtil(value, limit);
		}
		if (value instanceof Uint8Array) {
			return value;
		}
		if (Array.isArray(value)) {
			return value.map(val => this._truncateToSize(val));
		}
		if (typeof value === 'object') {
			const truncatedObj = {};
			for (const [k, v] of Object.entries(value)) {
				truncatedObj[k] = this._truncateToSize(v);
			}
			return truncatedObj;
		}
		return value;
	}
	_truncateToLimitUtil(value, limit) {
		if (value.length <= limit) {
			return value;
		}
		return value.substring(0, limit);
	}
	_isLogRecordReadonly() {
		if (this._isReadonly) {
			api.diag.warn('Can not execute the operation on emitted log record');
		}
		return this._isReadonly;
	}
}

class Logger {
	instrumentationScope;
	_sharedState;
	_loggerConfig;
	constructor(instrumentationScope, sharedState) {
		this.instrumentationScope = instrumentationScope;
		this._sharedState = sharedState;
		this._loggerConfig = this._sharedState.getLoggerConfig(this.instrumentationScope);
	}
	emit(logRecord) {
		const loggerConfig = this._loggerConfig;
		const currentContext = logRecord.context || context.active();
		const recordSeverity = logRecord.severityNumber ?? SeverityNumber.UNSPECIFIED;
		if (recordSeverity !== SeverityNumber.UNSPECIFIED &&
			recordSeverity < loggerConfig.minimumSeverity) {
			return;
		}
		if (loggerConfig.traceBased) {
			const spanContext = trace.getSpanContext(currentContext);
			if (spanContext && isSpanContextValid(spanContext)) {
				const isSampled = (spanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED;
				if (!isSampled) {
					return;
				}
			}
		}
		const logRecordInstance = new LogRecordImpl(this._sharedState, this.instrumentationScope, {
			context: currentContext,
			...logRecord,
		});
		this._sharedState.activeProcessor.onEmit(logRecordInstance, currentContext);
		logRecordInstance._makeReadonly();
	}
}

function loadDefaultConfig() {
	return {
		forceFlushTimeoutMillis: 30000,
		logRecordLimits: {
			attributeValueLengthLimit: getNumberFromEnv('OTEL_LOGRECORD_ATTRIBUTE_VALUE_LENGTH_LIMIT') ??
				Infinity,
			attributeCountLimit: getNumberFromEnv('OTEL_LOGRECORD_ATTRIBUTE_COUNT_LIMIT') ?? 128,
		},
		includeTraceContext: true,
	};
}
function reconfigureLimits(logRecordLimits) {
	return {
		attributeCountLimit: logRecordLimits.attributeCountLimit ??
			getNumberFromEnv('OTEL_LOGRECORD_ATTRIBUTE_COUNT_LIMIT') ??
			getNumberFromEnv('OTEL_ATTRIBUTE_COUNT_LIMIT') ??
			128,
		attributeValueLengthLimit: logRecordLimits.attributeValueLengthLimit ??
			getNumberFromEnv('OTEL_LOGRECORD_ATTRIBUTE_VALUE_LENGTH_LIMIT') ??
			getNumberFromEnv('OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT') ??
			Infinity,
	};
}

class NoopLogRecordProcessor {
	forceFlush() {
		return Promise.resolve();
	}
	onEmit(_logRecord, _context) { }
	shutdown() {
		return Promise.resolve();
	}
}

class MultiLogRecordProcessor {
	processors;
	forceFlushTimeoutMillis;
	constructor(processors, forceFlushTimeoutMillis) {
		this.processors = processors;
		this.forceFlushTimeoutMillis = forceFlushTimeoutMillis;
	}
	async forceFlush() {
		const timeout = this.forceFlushTimeoutMillis;
		await Promise.all(this.processors.map(processor => callWithTimeout(processor.forceFlush(), timeout)));
	}
	onEmit(logRecord, context) {
		this.processors.forEach(processors => processors.onEmit(logRecord, context));
	}
	async shutdown() {
		await Promise.all(this.processors.map(processor => processor.shutdown()));
	}
}

function getInstrumentationScopeKey(scope) {
	return `${scope.name}@${scope.version || ''}:${scope.schemaUrl || ''}`;
}

const DEFAULT_LOGGER_CONFIG$1 = {
	disabled: false,
	minimumSeverity: SeverityNumber.UNSPECIFIED,
	traceBased: false,
};
const DEFAULT_LOGGER_CONFIGURATOR = () => ({
	...DEFAULT_LOGGER_CONFIG$1,
});
class LoggerProviderSharedState {
	loggers = new Map();
	activeProcessor;
	registeredLogRecordProcessors = [];
	resource;
	forceFlushTimeoutMillis;
	logRecordLimits;
	processors;
	_loggerConfigurator;
	_loggerConfigs = new Map();
	constructor(resource, forceFlushTimeoutMillis, logRecordLimits, processors, loggerConfigurator) {
		this.resource = resource;
		this.forceFlushTimeoutMillis = forceFlushTimeoutMillis;
		this.logRecordLimits = logRecordLimits;
		this.processors = processors;
		if (processors.length > 0) {
			this.registeredLogRecordProcessors = processors;
			this.activeProcessor = new MultiLogRecordProcessor(this.registeredLogRecordProcessors, this.forceFlushTimeoutMillis);
		}
		else {
			this.activeProcessor = new NoopLogRecordProcessor();
		}
		this._loggerConfigurator =
			loggerConfigurator ?? DEFAULT_LOGGER_CONFIGURATOR;
	}
	getLoggerConfig(instrumentationScope) {
		const key = getInstrumentationScopeKey(instrumentationScope);
		let config = this._loggerConfigs.get(key);
		if (config) {
			return config;
		}
		config = this._loggerConfigurator(instrumentationScope);
		this._loggerConfigs.set(key, config);
		return config;
	}
}

const DEFAULT_LOGGER_NAME = 'unknown';
class LoggerProvider {
	_shutdownOnce;
	_sharedState;
	constructor(config = {}) {
		const mergedConfig = merge({}, loadDefaultConfig(), config);
		const resource = config.resource ?? defaultResource();
		this._sharedState = new LoggerProviderSharedState(resource, mergedConfig.forceFlushTimeoutMillis, reconfigureLimits(mergedConfig.logRecordLimits), config?.processors ?? [], config?.loggerConfigurator);
		this._shutdownOnce = new BindOnceFuture(this._shutdown, this);
	}
	getLogger(name, version, options) {
		if (this._shutdownOnce.isCalled) {
			diag.warn('A shutdown LoggerProvider cannot provide a Logger');
			return NOOP_LOGGER;
		}
		if (!name) {
			diag.warn('Logger requested without instrumentation scope name.');
		}
		const loggerName = name || DEFAULT_LOGGER_NAME;
		const key = `${loggerName}@${version || ''}:${options?.schemaUrl || ''}`;
		if (!this._sharedState.loggers.has(key)) {
			this._sharedState.loggers.set(key, new Logger({ name: loggerName, version, schemaUrl: options?.schemaUrl }, this._sharedState));
		}
		return this._sharedState.loggers.get(key);
	}
	forceFlush() {
		if (this._shutdownOnce.isCalled) {
			diag.warn('invalid attempt to force flush after LoggerProvider shutdown');
			return this._shutdownOnce.promise;
		}
		return this._sharedState.activeProcessor.forceFlush();
	}
	shutdown() {
		if (this._shutdownOnce.isCalled) {
			diag.warn('shutdown may only be called once per LoggerProvider');
			return this._shutdownOnce.promise;
		}
		return this._shutdownOnce.call();
	}
	_shutdown() {
		return this._sharedState.activeProcessor.shutdown();
	}
}

class ConsoleLogRecordExporter {
	export(logs, resultCallback) {
		this._sendLogRecords(logs, resultCallback);
	}
	shutdown() {
		return Promise.resolve();
	}
	_exportInfo(logRecord) {
		return {
			resource: {
				attributes: logRecord.resource.attributes,
			},
			instrumentationScope: logRecord.instrumentationScope,
			timestamp: hrTimeToMicroseconds(logRecord.hrTime),
			traceId: logRecord.spanContext?.traceId,
			spanId: logRecord.spanContext?.spanId,
			traceFlags: logRecord.spanContext?.traceFlags,
			severityText: logRecord.severityText,
			severityNumber: logRecord.severityNumber,
			eventName: logRecord.eventName,
			body: logRecord.body,
			attributes: logRecord.attributes,
		};
	}
	_sendLogRecords(logRecords, done) {
		for (const logRecord of logRecords) {
			console.dir(this._exportInfo(logRecord), { depth: 3 });
		}
		done?.({ code: ExportResultCode.SUCCESS });
	}
}

class SimpleLogRecordProcessor {
	_exporter;
	_shutdownOnce;
	_unresolvedExports;
	constructor(exporter) {
		this._exporter = exporter;
		this._shutdownOnce = new BindOnceFuture(this._shutdown, this);
		this._unresolvedExports = new Set();
	}
	onEmit(logRecord) {
		if (this._shutdownOnce.isCalled) {
			return;
		}
		const doExport = () => internal
			._export(this._exporter, [logRecord])
			.then((result) => {
			if (result.code !== ExportResultCode.SUCCESS) {
				globalErrorHandler(result.error ??
					new Error(`SimpleLogRecordProcessor: log record export failed (status ${result})`));
			}
		})
			.catch(globalErrorHandler);
		if (logRecord.resource.asyncAttributesPending) {
			const exportPromise = logRecord.resource
				.waitForAsyncAttributes?.()
				.then(() => {
				this._unresolvedExports.delete(exportPromise);
				return doExport();
			}, globalErrorHandler);
			if (exportPromise != null) {
				this._unresolvedExports.add(exportPromise);
			}
		}
		else {
			void doExport();
		}
	}
	async forceFlush() {
		await Promise.all(Array.from(this._unresolvedExports));
	}
	shutdown() {
		return this._shutdownOnce.call();
	}
	_shutdown() {
		return this._exporter.shutdown();
	}
}

class InMemoryLogRecordExporter {
	_finishedLogRecords = [];
	_stopped = false;
	export(logs, resultCallback) {
		if (this._stopped) {
			return resultCallback({
				code: ExportResultCode.FAILED,
				error: new Error('Exporter has been stopped'),
			});
		}
		this._finishedLogRecords.push(...logs);
		resultCallback({ code: ExportResultCode.SUCCESS });
	}
	shutdown() {
		this._stopped = true;
		this.reset();
		return Promise.resolve();
	}
	getFinishedLogRecords() {
		return this._finishedLogRecords;
	}
	reset() {
		this._finishedLogRecords = [];
	}
}

class BatchLogRecordProcessorBase {
	_maxExportBatchSize;
	_maxQueueSize;
	_scheduledDelayMillis;
	_exportTimeoutMillis;
	_exporter;
	_isExporting = false;
	_finishedLogRecords = [];
	_timer;
	_shutdownOnce;
	constructor(exporter, config) {
		this._exporter = exporter;
		this._maxExportBatchSize =
			config?.maxExportBatchSize ??
				getNumberFromEnv('OTEL_BLRP_MAX_EXPORT_BATCH_SIZE') ??
				512;
		this._maxQueueSize =
			config?.maxQueueSize ??
				getNumberFromEnv('OTEL_BLRP_MAX_QUEUE_SIZE') ??
				2048;
		this._scheduledDelayMillis =
			config?.scheduledDelayMillis ??
				getNumberFromEnv('OTEL_BLRP_SCHEDULE_DELAY') ??
				5000;
		this._exportTimeoutMillis =
			config?.exportTimeoutMillis ??
				getNumberFromEnv('OTEL_BLRP_EXPORT_TIMEOUT') ??
				30000;
		this._shutdownOnce = new BindOnceFuture(this._shutdown, this);
		if (this._maxExportBatchSize > this._maxQueueSize) {
			diag.warn('BatchLogRecordProcessor: maxExportBatchSize must be smaller or equal to maxQueueSize, setting maxExportBatchSize to match maxQueueSize');
			this._maxExportBatchSize = this._maxQueueSize;
		}
	}
	onEmit(logRecord) {
		if (this._shutdownOnce.isCalled) {
			return;
		}
		this._addToBuffer(logRecord);
	}
	forceFlush() {
		if (this._shutdownOnce.isCalled) {
			return this._shutdownOnce.promise;
		}
		return this._flushAll();
	}
	shutdown() {
		return this._shutdownOnce.call();
	}
	async _shutdown() {
		this.onShutdown();
		await this._flushAll();
		await this._exporter.shutdown();
	}
	_addToBuffer(logRecord) {
		if (this._finishedLogRecords.length >= this._maxQueueSize) {
			return;
		}
		this._finishedLogRecords.push(logRecord);
		this._maybeStartTimer();
	}
	_flushAll() {
		return new Promise((resolve, reject) => {
			const promises = [];
			const batchCount = Math.ceil(this._finishedLogRecords.length / this._maxExportBatchSize);
			for (let i = 0; i < batchCount; i++) {
				promises.push(this._flushOneBatch());
			}
			Promise.all(promises)
				.then(() => {
				resolve();
			})
				.catch(reject);
		});
	}
	_flushOneBatch() {
		this._clearTimer();
		if (this._finishedLogRecords.length === 0) {
			return Promise.resolve();
		}
		return callWithTimeout(this._export(this._finishedLogRecords.splice(0, this._maxExportBatchSize)), this._exportTimeoutMillis);
	}
	_maybeStartTimer() {
		if (this._isExporting)
			return;
		const flush = () => {
			this._isExporting = true;
			this._flushOneBatch()
				.then(() => {
				this._isExporting = false;
				if (this._finishedLogRecords.length > 0) {
					this._clearTimer();
					this._maybeStartTimer();
				}
			})
				.catch(e => {
				this._isExporting = false;
				globalErrorHandler(e);
			});
		};
		if (this._finishedLogRecords.length >= this._maxExportBatchSize) {
			return flush();
		}
		if (this._timer !== undefined)
			return;
		this._timer = setTimeout(() => flush(), this._scheduledDelayMillis);
		Deno.unrefTimer(this._timer);
	}
	_clearTimer() {
		if (this._timer !== undefined) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}
	}
	_export(logRecords) {
		const doExport = () => internal
			._export(this._exporter, logRecords)
			.then((result) => {
			if (result.code !== ExportResultCode.SUCCESS) {
				globalErrorHandler(result.error ??
					new Error(`BatchLogRecordProcessor: log record export failed (status ${result})`));
			}
		})
			.catch(globalErrorHandler);
		const pendingResources = [];
		for (let i = 0; i < logRecords.length; i++) {
			const resource = logRecords[i].resource;
			if (resource.asyncAttributesPending &&
				typeof resource.waitForAsyncAttributes === 'function') {
				pendingResources.push(resource.waitForAsyncAttributes());
			}
		}
		if (pendingResources.length === 0) {
			return doExport();
		}
		else {
			return Promise.all(pendingResources).then(doExport, globalErrorHandler);
		}
	}
}

class BatchLogRecordProcessor extends BatchLogRecordProcessorBase {
	onShutdown() { }
}

const DEFAULT_LOGGER_CONFIG = {
	disabled: false,
	minimumSeverity: SeverityNumber.UNSPECIFIED,
	traceBased: false,
};
function createLoggerConfigurator(patterns) {
	return (loggerScope) => {
		const loggerName = loggerScope.name;
		for (const { pattern, config } of patterns) {
			if (matchesPattern(loggerName, pattern)) {
				return {
					disabled: config.disabled ?? DEFAULT_LOGGER_CONFIG.disabled,
					minimumSeverity: config.minimumSeverity ?? DEFAULT_LOGGER_CONFIG.minimumSeverity,
					traceBased: config.traceBased ?? DEFAULT_LOGGER_CONFIG.traceBased,
				};
			}
		}
		return { ...DEFAULT_LOGGER_CONFIG };
	};
}
function matchesPattern(name, pattern) {
	if (pattern === name) {
		return true;
	}
	if (pattern.includes('*')) {
		const regexPattern = pattern
			.split('*')
			.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			.join('.*');
		const regex = new RegExp(`^${regexPattern}$`);
		return regex.test(name);
	}
	return false;
}

export { BatchLogRecordProcessor, ConsoleLogRecordExporter, InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor, createLoggerConfigurator };
