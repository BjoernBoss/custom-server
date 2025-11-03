/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
import * as libLog from "core/log.js";
import * as libClient from "core/client.js";
import * as libCommon from "core/common.js";
import * as libLocation from "core/location.js";
import * as libHttps from "https";
import * as libHttp from "http";
import * as libFs from "fs";
import * as libStream from "stream";
import { AddressInfo } from "net";

export class Server implements libCommon.ServerInterface {
	private handler: Record<string, libCommon.AppInterface>;
	private stopList: (() => void)[];

	constructor() {
		libLog.Info(`Server object created`);
		this.handler = {};
		this.stopList = [];
	}

	private lookupHandler(pathname: string): string | null {
		/* lookup the best matching handler */
		let bestKey = null;
		for (const key in this.handler) {
			/* ensure that the key is the leading path of the url and either a direct match or
			*	immediately followed by a '/' (i.e. its not a partial name of a path-component) */
			if (!pathname.startsWith(key))
				continue;
			if (pathname.length > key.length && pathname[key.length] != '/' && (key.length == 0 || pathname[key.length - 1] != '/'))
				continue;

			/* check if this is the better match by being the first match or more precise */
			if (bestKey == null || key.length > bestKey.length)
				bestKey = key;
		}
		return bestKey;
	}
	private handleWrapper(wasRequest: boolean, request: libHttp.IncomingMessage, establish: () => libClient.HttpRequest | libClient.HttpUpgrade): void {
		let client = null;
		try {
			client = establish();

			/* find the handler to use */
			let key = this.lookupHandler(client.path);

			/* check if a handler has been found */
			if (key != null) {
				client.translate(key);
				if (wasRequest)
					this.handler[key].request(client as libClient.HttpRequest);
				else
					this.handler[key].upgrade(client as libClient.HttpUpgrade);
			}

			/* add the default [not-found] response */
			else {
				libLog.Error(`No handler registered for [${client.path}]`)
				client.respondNotFound(`No handler registered for [${client.rawpath}]`);
			}

			client.finalize();
		} catch (err) {
			/* log the unknown caught exception (internal-server-error) */
			libLog.Error(`Uncaught exception encountered: ${err}`)
			if (client != null)
				client.internalError('Unknown internal error encountered');
			request.destroy();
		}
	}
	private handleRequest(request: libHttp.IncomingMessage, response: libHttp.ServerResponse, internal: boolean): void {
		this.handleWrapper(true, request, function (): libClient.HttpRequest {
			libLog.Info(`New ${internal ? "internal" : "external"} request: ([${request.socket.remoteAddress}]:${request.socket.remotePort}) [${request.url}] using user-agent [${request.headers['user-agent']}]`);
			return new libClient.HttpRequest(request, response, internal);
		});
	}
	private handleUpgrade(request: libHttp.IncomingMessage, socket: libStream.Duplex, head: Buffer, internal: boolean): void {
		this.handleWrapper(false, request, function (): libClient.HttpUpgrade {
			libLog.Info(`New ${internal ? "internal" : "external"} upgrade: ([${request.socket.remoteAddress}]:${request.socket.remotePort}) [${request.url}] using user-agent [${request.headers['user-agent']}]`);
			return new libClient.HttpUpgrade(request, socket, head, internal);
		});
	}

	public registerPath(path: string, handler: libCommon.AppInterface): void {
		path = libLocation.Sanitize(path);
		if (path in this.handler)
			libLog.Error(`Path [${path}] is already being handled`);
		else {
			libLog.Info(`Registered path handler for [${path}]`);
			this.handler[path] = handler;
		}
	}
	public listenHttp(port: number, internal: boolean): void {
		try {
			/* start the actual server */
			const server = libHttp.createServer((req, resp) => this.handleRequest(req, resp, internal)).listen(port);
			server.on('error', (err) => libLog.Error(`While listening to port ${port} using http: ${err}`));
			server.on('upgrade', (req, sock, head) => this.handleUpgrade(req, sock, head, internal));
			if (!server.listening)
				return;

			/* register the stop-function */
			this.stopList.push(() => server.close());

			/* log the established listener */
			const address = server.address() as AddressInfo;
			libLog.Info(`Http-server${internal ? " flagged as internal " : " "}started successfully on [${address.address}]:${address.port} [family: ${address.family}]`);
		} catch (err) {
			libLog.Error(`While listening to port ${port} using http: ${err}`);
		}
	}
	public listenHttps(port: number, key: string, cert: string, internal: boolean): void {
		try {
			/* load the key and certificate */
			const config = {
				key: libFs.readFileSync(key),
				cert: libFs.readFileSync(cert)
			};

			/* start the actual server */
			const server = libHttps.createServer(config, (req, resp) => this.handleRequest(req, resp, internal)).listen(port);
			server.on('error', (err) => libLog.Error(`While listening to port ${port} using https: ${err}`));
			server.on('upgrade', (req, sock, head) => this.handleUpgrade(req, sock, head, internal));
			if (!server.listening)
				return;

			/* register the stop-function */
			this.stopList.push(() => server.close());

			/* log the established listener */
			const address = server.address() as AddressInfo;
			libLog.Info(`Https-server${internal ? " flagged as internal " : " "}started successfully on [${address.address}]:${address.port} [family: ${address.family}]`);
		} catch (err) {
			libLog.Error(`While listening to port ${port} using https: ${err}`);
		}
	}
	public stop(): void {
		for (const cb of this.stopList)
			cb();
	}
};
