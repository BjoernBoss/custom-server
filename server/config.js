/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
import * as libPath from "path";

export const TemplatePath = libPath.resolve('./www/templates');

export const PortInternalHttp = 10024;

export const MaxFileLoggingLength = 10_000_000;

let _serverName = 'custom server';
export function SetServerName(name) {
	_serverName = name;
}
export function GetServerName() {
	return _serverName;
}
