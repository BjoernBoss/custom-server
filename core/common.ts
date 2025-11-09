/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2025 Bjoern Boss Henrichsen */
import * as libClient from './client.js';

export interface ModuleInterface {
	name: string;
	request(client: libClient.HttpRequest): void;
	upgrade(client: libClient.HttpUpgrade): void;
}

/*
*	Validate the host passed in via the http-parameter.
*	Host string will be empty for no host-parameter.
*	Host strings optional port will have been verified and dropped.
*		=> Will only contain the lower-case host name.
*/
export type CheckHost = (host: string) => boolean;

export interface ServerInterface {
	listenHttp(port: number, handler: ModuleInterface, checkHost: CheckHost): void;
	listenHttps(port: number, key: string, cert: string, handler: ModuleInterface, checkHost: CheckHost): void;
}
