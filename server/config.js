/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
import * as libPath from "path";
import * as libLog from "./log.js";

export const PortInternalHttp = 10024;

export const MaxFileLoggingLength = 10_000_000;

let _serverName = '';
export function setServerName(name) {
	_serverName = name;
	libLog.Log(`Server name configured as: [${_serverName}]`);
}
export function getServerName() {
	return _serverName;
}

let _storagePath = '';
export function setStoragePath(path) {
	_storagePath = path;
	libLog.Log(`Storage path configured as: [${_storagePath}]`);
}
export function getStoragePath() {
	return _storagePath;
}

/* initialize the default configuration */
export function initialize() {
	setServerName('custom server');
	setStoragePath(libPath.join(process.cwd(), './data'));
}
