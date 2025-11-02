/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
import * as libLog from "core/log.js";
import * as libHttp from "core/http.js";
import * as libCommon from "core/common.js";
import * as libNodeHttps from "https";
import * as libNodeHttp from "http";
import * as libFs from "fs";
import * as libStream from "stream";
import { AddressInfo } from "net";

export class Server implements libCommon.ServerInterface {
	private handler: Record<string, libCommon.AppInterface>;

	constructor() {
		libLog.Info(`Server object created`);
		this.handler = {};
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
	private handleWrapper(wasRequest: boolean, request: libNodeHttp.IncomingMessage, establish: () => libHttp.HttpRequest | libHttp.HttpUpgrade): void {
		let msg = null;
		try {
			msg = establish();

			/* find the handler to use */
			let key = this.lookupHandler(msg.relative);

			/* check if a handler has been found */
			if (key != null) {
				msg.translate(key);
				if (wasRequest)
					this.handler[key].request(key, msg as libHttp.HttpRequest);
				else
					this.handler[key].upgrade(key, msg as libHttp.HttpUpgrade);
				return;
			}

			/* add the default [not-found] response */
			libLog.Error(`No handler registered for [${msg.relative}]`)
			msg.respondNotFound(`No handler registered for [${msg.rawpath}]`);
		} catch (err) {
			/* log the unknown caught exception (internal-server-error) */
			libLog.Error(`Uncaught exception encountered: ${err}`)
			if (msg != null)
				msg.respondInternalError('Unknown internal error encountered');
			request.destroy();
		}
	}
	private handleRequest(request: libNodeHttp.IncomingMessage, response: libNodeHttp.ServerResponse, internal: boolean): void {
		this.handleWrapper(true, request, function () {
			libLog.Info(`New ${internal ? "internal" : "external"} request: ([${request.socket.remoteAddress}]:${request.socket.remotePort}) [${request.url}] using user-agent [${request.headers['user-agent']}]`);
			return new libHttp.HttpRequest(request, response, internal);
		});
	}
	private handleUpgrade(request: libNodeHttp.IncomingMessage, socket: libStream.Duplex, head: Buffer, internal: boolean): void {
		this.handleWrapper(false, request, function (): libHttp.HttpUpgrade {
			libLog.Info(`New ${internal ? "internal" : "external"} upgrade: ([${request.socket.remoteAddress}]:${request.socket.remotePort}) [${request.url}] using user-agent [${request.headers['user-agent']}]`);
			return new libHttp.HttpUpgrade(request, socket, head, internal);
		});
	}

	public registerPath(path: string, handler: libCommon.AppInterface): void {
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
			const server = libNodeHttp.createServer((req, resp) => this.handleRequest(req, resp, internal)).listen(port);
			server.on('error', (err) => libLog.Error(`While listening to port ${port} using http: ${err}`));
			server.on('upgrade', (req, sock, head) => this.handleUpgrade(req, sock, head, internal));
			if (!server.listening)
				return;

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
			const server = libNodeHttps.createServer(config, (req, resp) => this.handleRequest(req, resp, internal)).listen(port);
			server.on('error', (err) => libLog.Error(`While listening to port ${port} using https: ${err}`));
			server.on('upgrade', (req, sock, head) => this.handleUpgrade(req, sock, head, internal));
			if (!server.listening)
				return;

			const address = server.address() as AddressInfo;
			libLog.Info(`Https-server${internal ? " flagged as internal " : " "}started successfully on [${address.address}]:${address.port} [family: ${address.family}]`);
		} catch (err) {
			libLog.Error(`While listening to port ${port} using https: ${err}`);
		}
	}
};
