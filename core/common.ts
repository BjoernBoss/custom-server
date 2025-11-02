/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2025 Bjoern Boss Henrichsen */
import * as libHttp from './http.js';

export interface AppInterface {
	request(basePath: string, msg: libHttp.HttpRequest): void;
	upgrade(basePath: string, msg: libHttp.HttpUpgrade): void;
}
export interface ServerInterface {
	registerPath(path: string, handler: AppInterface): void;
	listenHttp(port: number, internal: boolean): void;
	listenHttps(port: number, key: string, cert: string, internal: boolean): void;
}
