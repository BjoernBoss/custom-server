/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2025 Bjoern Boss Henrichsen */
import * as libClient from './client.js';

export interface AppInterface {
	request(client: libClient.HttpRequest): void;
	upgrade(client: libClient.HttpUpgrade): void;
}

/*
*	Validate the port is allowed and the host passed in via the http-parameter.
*	Host string will be empty for no host-parameter.
*	Host strings optional port will have been verified.
*	null: allow any connection
*/
export type CheckConnection = ((host: string, port: number) => boolean) | null;

/*
*	Validate the host passed in via the http-parameter.
*	Host string will be empty for no host-parameter.
*	Host strings optional port will have been verified.
*	null: allow any host
*/
export type CheckHost = ((host: string) => boolean) | null;

export interface ServerInterface {
	register(path: string, handler: AppInterface, check: CheckConnection): void;
	listenHttp(port: number, internal: boolean, check: CheckHost): void;
	listenHttps(port: number, key: string, cert: string, internal: boolean, check: CheckHost): void;
}
