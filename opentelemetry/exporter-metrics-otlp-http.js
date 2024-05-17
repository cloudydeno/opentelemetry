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
/// <reference types="./exporter-metrics-otlp-http.d.ts" />

import { getEnv } from './core.js';
import { AggregationTemporality, InstrumentType, Aggregation } from './sdk-metrics.js';
import { diag } from './api.js';

var AggregationTemporalityPreference;
(function (AggregationTemporalityPreference) {
	AggregationTemporalityPreference[AggregationTemporalityPreference["DELTA"] = 0] = "DELTA";
	AggregationTemporalityPreference[AggregationTemporalityPreference["CUMULATIVE"] = 1] = "CUMULATIVE";
	AggregationTemporalityPreference[AggregationTemporalityPreference["LOWMEMORY"] = 2] = "LOWMEMORY";
})(AggregationTemporalityPreference || (AggregationTemporalityPreference = {}));

const CumulativeTemporalitySelector = () => AggregationTemporality.CUMULATIVE;
const DeltaTemporalitySelector = (instrumentType) => {
	switch (instrumentType) {
		case InstrumentType.COUNTER:
		case InstrumentType.OBSERVABLE_COUNTER:
		case InstrumentType.GAUGE:
		case InstrumentType.HISTOGRAM:
		case InstrumentType.OBSERVABLE_GAUGE:
			return AggregationTemporality.DELTA;
		case InstrumentType.UP_DOWN_COUNTER:
		case InstrumentType.OBSERVABLE_UP_DOWN_COUNTER:
			return AggregationTemporality.CUMULATIVE;
	}
};
const LowMemoryTemporalitySelector = (instrumentType) => {
	switch (instrumentType) {
		case InstrumentType.COUNTER:
		case InstrumentType.HISTOGRAM:
			return AggregationTemporality.DELTA;
		case InstrumentType.GAUGE:
		case InstrumentType.UP_DOWN_COUNTER:
		case InstrumentType.OBSERVABLE_UP_DOWN_COUNTER:
		case InstrumentType.OBSERVABLE_COUNTER:
		case InstrumentType.OBSERVABLE_GAUGE:
			return AggregationTemporality.CUMULATIVE;
	}
};
function chooseTemporalitySelectorFromEnvironment() {
	const env = getEnv();
	const configuredTemporality = env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE.trim().toLowerCase();
	if (configuredTemporality === 'cumulative') {
		return CumulativeTemporalitySelector;
	}
	if (configuredTemporality === 'delta') {
		return DeltaTemporalitySelector;
	}
	if (configuredTemporality === 'lowmemory') {
		return LowMemoryTemporalitySelector;
	}
	diag.warn(`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE is set to '${env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE}', but only 'cumulative' and 'delta' are allowed. Using default ('cumulative') instead.`);
	return CumulativeTemporalitySelector;
}
function chooseTemporalitySelector(temporalityPreference) {
	if (temporalityPreference != null) {
		if (temporalityPreference === AggregationTemporalityPreference.DELTA) {
			return DeltaTemporalitySelector;
		}
		else if (temporalityPreference === AggregationTemporalityPreference.LOWMEMORY) {
			return LowMemoryTemporalitySelector;
		}
		return CumulativeTemporalitySelector;
	}
	return chooseTemporalitySelectorFromEnvironment();
}
function chooseAggregationSelector(config) {
	if (config?.aggregationPreference) {
		return config.aggregationPreference;
	}
	else {
		return (_instrumentType) => Aggregation.Default();
	}
}
class OTLPMetricExporterBase {
	constructor(exporter, config) {
		this._otlpExporter = exporter;
		this._aggregationSelector = chooseAggregationSelector(config);
		this._aggregationTemporalitySelector = chooseTemporalitySelector(config?.temporalityPreference);
	}
	export(metrics, resultCallback) {
		this._otlpExporter.export([metrics], resultCallback);
	}
	async shutdown() {
		await this._otlpExporter.shutdown();
	}
	forceFlush() {
		return Promise.resolve();
	}
	selectAggregation(instrumentType) {
		return this._aggregationSelector(instrumentType);
	}
	selectAggregationTemporality(instrumentType) {
		return this._aggregationTemporalitySelector(instrumentType);
	}
}

export { AggregationTemporalityPreference, CumulativeTemporalitySelector, DeltaTemporalitySelector, LowMemoryTemporalitySelector, OTLPMetricExporterBase };
