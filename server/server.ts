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
	private handler: Record<string, { handler: libCommon.AppInterface, check: libCommon.CheckConnection }>;
	private stopList: (() => void)[];

	constructor() {
		libLog.Info(`Server object created`);
		this.handler = {};
		this.stopList = [];
	}

	private lookupHandler(pathname: string, host: string, port: number): string | null {
		/* lookup the best matching handler */
		let bestKey = null;
		for (const key in this.handler) {
			/* ensure that the key is the leading path of the url and either a direct match or
			*	immediately followed by a '/' (i.e. its not a partial name of a path-component) */
			if (!pathname.startsWith(key))
				continue;
			if (pathname.length > key.length && pathname[key.length] != '/' && (key.length == 0 || pathname[key.length - 1] != '/'))
				continue;

			/* check if this handler applies */
			if (this.handler[key].check != null && !this.handler[key].check(host, port))
				continue;

			/* check if this is the better match by being the first match or more precise */
			if (bestKey == null || key.length > bestKey.length)
				bestKey = key;
		}
		return bestKey;
	}
	private respondNotFound(request: libHttp.IncomingMessage, client: libClient.HttpRequest | libClient.HttpUpgrade): void {
		client.respondNotFound(`No resource found at [${request.headers.host ?? ''}]:[${client.rawpath}]`);
		client.finalize();
	}
	private handleWrapper(wasRequest: boolean, request: libHttp.IncomingMessage, check: libCommon.CheckHost, port: number, establish: () => libClient.HttpRequest | libClient.HttpUpgrade): void {
		let client = null;
		try {
			client = establish();

			/* extract the host to be used and validate its port */
			let hostName = (request.headers.host ?? '');
			let lastColon = hostName.lastIndexOf(':');
			if (lastColon != -1) {
				for (const c of hostName.substring(lastColon + 1)) {
					if (c >= '0' && c <= '9') continue;
					lastColon = -1;
					break;
				}

				/* check if the port of the host-name does not match */
				if (lastColon != -1) {
					if (parseInt(hostName.substring(lastColon + 1), 10) != port) {
						client.error(`Host [${hostName}] port does not match [${port}]`);
						return this.respondNotFound(request, client);
					}
					hostName = hostName.substring(0, lastColon);
				}
			}

			/* validate the host name */
			if (check != null && !check(hostName)) {
				client.error(`Host [${hostName}] now allowed for this endpoint [${port}]`);
				return this.respondNotFound(request, client);
			}

			/* find the handler to use */
			let key = this.lookupHandler(client.path, hostName, port);
			if (key == null) {
				client.error(`No handler registered for [${client.path}]`)
				return this.respondNotFound(request, client);
			}

			/* handle the actual client request */
			client.translate(key);
			if (wasRequest)
				this.handler[key].handler.request(client as libClient.HttpRequest);
			else
				this.handler[key].handler.upgrade(client as libClient.HttpUpgrade);
			client.finalize();
		} catch (err) {
			/* log the unknown caught exception (internal-server-error) */
			libLog.Error(`Uncaught exception encountered for client [${client != null ? client.id : null}]: ${err}`)
			if (client != null)
				client.respondInternalError('Unknown internal error encountered');
			request.destroy();
		}
	}
	private handleRequest(request: libHttp.IncomingMessage, response: libHttp.ServerResponse, check: libCommon.CheckHost, port: number): void {
		this.handleWrapper(true, request, check, port, function (): libClient.HttpRequest {
			const client = new libClient.HttpRequest(request, response);
			client.log(`Request:${port} from [${request.socket.remoteAddress}]:${request.socket.remotePort} to [${request.headers.host}]:[${request.url}] (user-agent: [${request.headers['user-agent']}])`);
			return client;
		});
	}
	private handleUpgrade(request: libHttp.IncomingMessage, socket: libStream.Duplex, head: Buffer, check: libCommon.CheckHost, port: number): void {
		this.handleWrapper(false, request, check, port, function (): libClient.HttpUpgrade {
			let client = new libClient.HttpUpgrade(request, socket, head);
			client.log(`Upgrade:${port} from [${request.socket.remoteAddress}]:${request.socket.remotePort} to [${request.headers.host}]:[${request.url}] (user-agent: [${request.headers['user-agent']}])`);
			return client;
		});
	}

	public register(path: string, handler: libCommon.AppInterface, check: libCommon.CheckConnection): void {
		path = libLocation.Sanitize(path);
		if (path in this.handler)
			libLog.Error(`Path [${path}] is already being handled`);
		else {
			libLog.Info(`Registered path handler for [${path}]`);
			this.handler[path] = { handler, check };
		}
	}
	public listenHttp(port: number, check: libCommon.CheckHost): void {
		try {
			/* initialize the server config */
			const config = {
				requireHostHeader: true
			};

			/* start the actual server */
			const server = libHttp.createServer(config, (req, resp) => this.handleRequest(req, resp, check, port)).listen(port);
			server.on('error', (err) => libLog.Error(`While listening to port ${port} using http: ${err}`));
			server.on('upgrade', (req, sock, head) => this.handleUpgrade(req, sock, head, check, port));
			if (!server.listening)
				return;

			/* register the stop-function */
			this.stopList.push(() => server.close());

			/* log the established listener */
			const address = server.address() as AddressInfo;
			libLog.Info(`Http-server started successfully on [${address.address}]:${address.port} [family: ${address.family}]`);
		} catch (err) {
			libLog.Error(`While listening to port ${port} using http: ${err}`);
		}
	}
	public listenHttps(port: number, key: string, cert: string, check: libCommon.CheckHost): void {
		try {
			/* initialize the server config and load the key and certificate */
			const config = {
				requireHostHeader: true,
				key: libFs.readFileSync(key),
				cert: libFs.readFileSync(cert)
			};

			/* start the actual server */
			const server = libHttps.createServer(config, (req, resp) => this.handleRequest(req, resp, check, port)).listen(port);
			server.on('error', (err) => libLog.Error(`While listening to port ${port} using https: ${err}`));
			server.on('upgrade', (req, sock, head) => this.handleUpgrade(req, sock, head, check, port));
			if (!server.listening)
				return;

			/* register the stop-function */
			this.stopList.push(() => server.close());

			/* log the established listener */
			const address = server.address() as AddressInfo;
			libLog.Info(`Https-server started successfully on [${address.address}]:${address.port} [family: ${address.family}]`);
		} catch (err) {
			libLog.Error(`While listening to port ${port} using https: ${err}`);
		}
	}
	public stop(): void {
		for (const cb of this.stopList)
			cb();
	}
};
