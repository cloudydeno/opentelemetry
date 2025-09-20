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
/// <reference types="./resources.d.ts" />

import { diag } from './api.js';
import { SDK_INFO, getStringFromEnv } from './core.js';
import { ATTR_TELEMETRY_SDK_VERSION, ATTR_TELEMETRY_SDK_NAME, ATTR_TELEMETRY_SDK_LANGUAGE, ATTR_SERVICE_NAME } from './semantic-conventions.js';





function defaultServiceName() {
	return `unknown_service:deno`;
}

const isPromiseLike = (val) => {
	return (val !== null &&
		typeof val === 'object' &&
		typeof val.then === 'function');
};

class ResourceImpl {
	_rawAttributes;
	_asyncAttributesPending = false;
	_memoizedAttributes;
	static FromAttributeList(attributes) {
		const res = new ResourceImpl({});
		res._rawAttributes = guardedRawAttributes(attributes);
		res._asyncAttributesPending =
			attributes.filter(([_, val]) => isPromiseLike(val)).length > 0;
		return res;
	}
	constructor(
	resource) {
		const attributes = resource.attributes ?? {};
		this._rawAttributes = Object.entries(attributes).map(([k, v]) => {
			if (isPromiseLike(v)) {
				this._asyncAttributesPending = true;
			}
			return [k, v];
		});
		this._rawAttributes = guardedRawAttributes(this._rawAttributes);
	}
	get asyncAttributesPending() {
		return this._asyncAttributesPending;
	}
	async waitForAsyncAttributes() {
		if (!this.asyncAttributesPending) {
			return;
		}
		for (let i = 0; i < this._rawAttributes.length; i++) {
			const [k, v] = this._rawAttributes[i];
			this._rawAttributes[i] = [k, isPromiseLike(v) ? await v : v];
		}
		this._asyncAttributesPending = false;
	}
	get attributes() {
		if (this.asyncAttributesPending) {
			diag.error('Accessing resource attributes before async attributes settled');
		}
		if (this._memoizedAttributes) {
			return this._memoizedAttributes;
		}
		const attrs = {};
		for (const [k, v] of this._rawAttributes) {
			if (isPromiseLike(v)) {
				diag.debug(`Unsettled resource attribute ${k} skipped`);
				continue;
			}
			if (v != null) {
				attrs[k] ??= v;
			}
		}
		if (!this._asyncAttributesPending) {
			this._memoizedAttributes = attrs;
		}
		return attrs;
	}
	getRawAttributes() {
		return this._rawAttributes;
	}
	merge(resource) {
		if (resource == null)
			return this;
		return ResourceImpl.FromAttributeList([
			...resource.getRawAttributes(),
			...this.getRawAttributes(),
		]);
	}
}
function resourceFromAttributes(attributes) {
	return ResourceImpl.FromAttributeList(Object.entries(attributes));
}
function resourceFromDetectedResource(detectedResource) {
	return new ResourceImpl(detectedResource);
}
function emptyResource() {
	return resourceFromAttributes({});
}
function defaultResource() {
	return resourceFromAttributes({
		[ATTR_SERVICE_NAME]: defaultServiceName(),
		[ATTR_TELEMETRY_SDK_LANGUAGE]: SDK_INFO[ATTR_TELEMETRY_SDK_LANGUAGE],
		[ATTR_TELEMETRY_SDK_NAME]: SDK_INFO[ATTR_TELEMETRY_SDK_NAME],
		[ATTR_TELEMETRY_SDK_VERSION]: SDK_INFO[ATTR_TELEMETRY_SDK_VERSION],
	});
}
function guardedRawAttributes(attributes) {
	return attributes.map(([k, v]) => {
		if (isPromiseLike(v)) {
			return [
				k,
				v.catch(err => {
					diag.debug('promise rejection for resource attribute: %s - %s', k, err);
					return undefined;
				}),
			];
		}
		return [k, v];
	});
}

const detectResources = (config = {}) => {
	const resources = (config.detectors || []).map(d => {
		try {
			const resource = resourceFromDetectedResource(d.detect(config));
			diag.debug(`${d.constructor.name} found resource.`, resource);
			return resource;
		}
		catch (e) {
			diag.debug(`${d.constructor.name} failed: ${e.message}`);
			return emptyResource();
		}
	});
	return resources.reduce((acc, resource) => acc.merge(resource), emptyResource());
};

class EnvDetector {
	_MAX_LENGTH = 255;
	_COMMA_SEPARATOR = ',';
	_LABEL_KEY_VALUE_SPLITTER = '=';
	_ERROR_MESSAGE_INVALID_CHARS = 'should be a ASCII string with a length greater than 0 and not exceed ' +
		this._MAX_LENGTH +
		' characters.';
	_ERROR_MESSAGE_INVALID_VALUE = 'should be a ASCII string with a length not exceed ' +
		this._MAX_LENGTH +
		' characters.';
	detect(_config) {
		const attributes = {};
		const rawAttributes = getStringFromEnv('OTEL_RESOURCE_ATTRIBUTES');
		const serviceName = getStringFromEnv('OTEL_SERVICE_NAME');
		if (rawAttributes) {
			try {
				const parsedAttributes = this._parseResourceAttributes(rawAttributes);
				Object.assign(attributes, parsedAttributes);
			}
			catch (e) {
				diag.debug(`EnvDetector failed: ${e.message}`);
			}
		}
		if (serviceName) {
			attributes[ATTR_SERVICE_NAME] = serviceName;
		}
		return { attributes };
	}
	_parseResourceAttributes(rawEnvAttributes) {
		if (!rawEnvAttributes)
			return {};
		const attributes = {};
		const rawAttributes = rawEnvAttributes.split(this._COMMA_SEPARATOR, -1);
		for (const rawAttribute of rawAttributes) {
			const keyValuePair = rawAttribute.split(this._LABEL_KEY_VALUE_SPLITTER, -1);
			if (keyValuePair.length !== 2) {
				continue;
			}
			let [key, value] = keyValuePair;
			key = key.trim();
			value = value.trim().split(/^"|"$/).join('');
			if (!this._isValidAndNotEmpty(key)) {
				throw new Error(`Attribute key ${this._ERROR_MESSAGE_INVALID_CHARS}`);
			}
			if (!this._isValid(value)) {
				throw new Error(`Attribute value ${this._ERROR_MESSAGE_INVALID_VALUE}`);
			}
			attributes[key] = decodeURIComponent(value);
		}
		return attributes;
	}
	_isValid(name) {
		return name.length <= this._MAX_LENGTH && this._isBaggageOctetString(name);
	}
	_isBaggageOctetString(str) {
		for (let i = 0; i < str.length; i++) {
			const ch = str.charCodeAt(i);
			if (ch < 0x21 || ch === 0x2c || ch === 0x3b || ch === 0x5c || ch > 0x7e) {
				return false;
			}
		}
		return true;
	}
	_isValidAndNotEmpty(str) {
		return str.length > 0 && this._isValid(str);
	}
}
const envDetector = new EnvDetector();

const ATTR_HOST_ARCH = 'host.arch';
const ATTR_HOST_ID = 'host.id';
const ATTR_HOST_NAME = 'host.name';
const ATTR_OS_TYPE = 'os.type';
const ATTR_OS_VERSION = 'os.version';
const ATTR_PROCESS_COMMAND = 'process.command';
const ATTR_PROCESS_COMMAND_ARGS = 'process.command_args';
const ATTR_PROCESS_EXECUTABLE_NAME = 'process.executable.name';
const ATTR_PROCESS_EXECUTABLE_PATH = 'process.executable.path';
const ATTR_PROCESS_OWNER = 'process.owner';
const ATTR_PROCESS_PID = 'process.pid';
const ATTR_PROCESS_RUNTIME_DESCRIPTION = 'process.runtime.description';
const ATTR_PROCESS_RUNTIME_NAME = 'process.runtime.name';
const ATTR_PROCESS_RUNTIME_VERSION = 'process.runtime.version';
const ATTR_SERVICE_INSTANCE_ID = 'service.instance.id';

async function getMachineId() {
	const paths = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
	for (const path of paths) {
		try {
			const result = await Deno.readTextFile(path);
			return result.trim();
		}
		catch (e) {
			diag.debug(`error reading machine id: ${e}`);
		}
	}
	return undefined;
}

const normalizeArch = (nodeArchString) => {
	switch (nodeArchString) {
		case 'arm':
			return 'arm32';
		case 'ppc':
			return 'ppc32';
		case 'x64':
			return 'amd64';
		default:
			return nodeArchString;
	}
};
const normalizeType = (nodePlatform) => {
	switch (nodePlatform) {
		case 'sunos':
			return 'solaris';
		case 'win32':
			return 'windows';
		default:
			return nodePlatform;
	}
};

class HostDetector {
	detect(_config) {
		const attributes = {
			[ATTR_HOST_NAME]: Deno.hostname?.(),
			[ATTR_HOST_ARCH]: normalizeArch(Deno.build.arch),
			[ATTR_HOST_ID]: getMachineId(),
		};
		return { attributes };
	}
}
const hostDetector = new HostDetector();

class OSDetector {
	detect(_config) {
		const attributes = {
			[ATTR_OS_TYPE]: Deno.build.os,
			[ATTR_OS_VERSION]: Deno.osRelease?.(),
		};
		return { attributes };
	}
}
const osDetector = new OSDetector();

class ProcessDetector {
	detect(_config) {
		const attributes = {
			[ATTR_PROCESS_PID]: process.pid,
			[ATTR_PROCESS_EXECUTABLE_NAME]: process.title,
			[ATTR_PROCESS_EXECUTABLE_PATH]: process.execPath,
			[ATTR_PROCESS_COMMAND_ARGS]: [
				process.argv[0],
				...process.execArgv,
				...process.argv.slice(1),
			],
			[ATTR_PROCESS_RUNTIME_VERSION]: process.versions.node,
			[ATTR_PROCESS_RUNTIME_NAME]: 'nodejs',
			[ATTR_PROCESS_RUNTIME_DESCRIPTION]: 'Node.js',
		};
		if (process.argv.length > 1) {
			attributes[ATTR_PROCESS_COMMAND] = process.argv[1];
		}
		try {
			const userInfo = os.userInfo();
			attributes[ATTR_PROCESS_OWNER] = userInfo.username;
		}
		catch (e) {
			diag.debug(`error obtaining process owner: ${e}`);
		}
		return { attributes };
	}
}
const processDetector = new ProcessDetector();

class ServiceInstanceIdDetector {
	detect(_config) {
		return {
			attributes: {
				[ATTR_SERVICE_INSTANCE_ID]: crypto.randomUUID(),
			},
		};
	}
}
const serviceInstanceIdDetector = new ServiceInstanceIdDetector();

export { defaultResource, defaultServiceName, detectResources, emptyResource, envDetector, hostDetector, osDetector, processDetector, resourceFromAttributes, serviceInstanceIdDetector };
