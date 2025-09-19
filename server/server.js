/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
import * as libLog from "./log.js";
import * as libHttp from "./http.js";
import * as libNodeHttps from "https";
import * as libNodeHttp from "http";
import * as libFs from "fs";

export class Server {
	constructor() {
		libLog.Info(`Server object created`);
		this._handler = {};
	}

	_lookupHandler(pathname) {
		/* lookup the best matching handler */
		let bestKey = null;
		for (const key in this._handler) {
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
	_handleWrapper(wasRequest, request, establish) {
		let msg = null;
		try {
			msg = establish();

			/* find the handler to use */
			let key = this._lookupHandler(msg.relative);

			/* check if a handler has been found */
			if (key != null) {
				msg.translate(key);
				if (wasRequest)
					this._handler[key].request(msg);
				else
					this._handler[key].upgrade(msg);
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
	_handleRequest(request, response, internal) {
		this._handleWrapper(true, request, function () {
			libLog.Info(`New ${internal ? "internal" : "external"} request: ([${request.socket.remoteAddress}]:${request.socket.remotePort}) [${request.url}] using user-agent [${request.headers['user-agent']}]`);
			return new libHttp.HttpRequest(request, response, internal);
		});
	}
	_handleUpgrade(request, socket, head, internal) {
		this._handleWrapper(false, request, function () {
			libLog.Info(`New ${internal ? "internal" : "external"} upgrade: ([${request.socket.remoteAddress}]:${request.socket.remotePort}) [${request.url}] using user-agent [${request.headers['user-agent']}]`);
			return new libHttp.HttpUpgrade(request, socket, head, internal);
		});
	}

	addHandler(handler) {
		if (handler.path in this._handler)
			libLog.Error(`Path [${handler.path}] is already being handled`);
		else {
			libLog.Info(`Registered path handler for [${handler.path}]`);
			this._handler[handler.path] = handler;
		}
	}
	listenHttp(port, internal) {
		try {
			/* start the actual server */
			const server = libNodeHttp.createServer((req, resp) => this._handleRequest(req, resp, internal)).listen(port);
			server.on('error', (err) => libLog.Error(`While listening to port ${port} using http: ${err}`));
			server.on('upgrade', (req, sock, head) => this._handleUpgrade(req, sock, head, internal));
			if (!server.listening)
				return;

			const address = server.address();
			libLog.Info(`Http-server${internal ? " flagged as internal " : " "}started successfully on [${address.address}]:${address.port} [family: ${address.family}]`);
		} catch (err) {
			libLog.Error(`While listening to port ${port} using http: ${err}`);
		}
	}
	listenHttps(port, key, cert, internal) {
		try {
			/* load the key and certificate */
			const config = {
				key: libFs.readFileSync(key),
				cert: libFs.readFileSync(cert)
			};

			/* start the actual server */
			const server = libNodeHttps.createServer(config, (req, resp) => this._handleRequest(req, resp, internal)).listen(port);
			server.on('error', (err) => libLog.Error(`While listening to port ${port} using https: ${err}`));
			server.on('upgrade', (req, sock, head) => this._handleUpgrade(req, sock, head, internal));
			if (!server.listening)
				return;

			const address = server.address();
			libLog.Info(`Https-server${internal ? " flagged as internal " : " "}started successfully on [${address.address}]:${address.port} [family: ${address.family}]`);
		} catch (err) {
			libLog.Error(`While listening to port ${port} using https: ${err}`);
		}
	}
};
