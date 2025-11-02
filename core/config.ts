/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
import * as libPath from "path";
import * as libLog from "./log.js";

let _serverName = '';
export function setServerName(name: string): void {
	_serverName = name;
	libLog.Info(`Server name configured as: [${_serverName}]`);
}
export function getServerName(): string {
	return _serverName;
}

let _storagePath = '';
export function setStoragePath(path: string) {
	_storagePath = path;
	libLog.Info(`Storage path configured as: [${_storagePath}]`);
}
export function getStoragePath(): string {
	return _storagePath;
}

/* initialize the default configuration */
export function initialize(): void {
	setServerName('ma-web-server');
	setStoragePath(libPath.join(process.cwd(), './data'));
}
