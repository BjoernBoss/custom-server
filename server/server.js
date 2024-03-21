import * as libLog from "./log.js";
import * as libHttp from "./http.js";
import * as libNodeHttps from "https";
import * as libNodeHttp from "http";
import * as libFs from "fs";

export class Server {
	constructor() {
		libLog.Info(`Server object created`);
		this._handler = {};
		this._exact = {};
	}

	_requestHandler(request, response, secureInternal) {
		var msg = null;
		try {
			libLog.Info(`New ${secureInternal ? "internal-secure" : "external"} request: ([${request.socket.remoteAddress}]:${request.socket.remotePort}) [${request.url}] using user-agent [${request.headers['user-agent']}]`);
			msg = new libHttp.HttpMessage(request, response, secureInternal);

			/* check if an exact handler exists */
			if (msg.url.pathname in this._exact) {
				this._exact[msg.url.pathname](msg);
				return;
			}

			/* lookup the best matching handler */
			var bestKey = undefined;
			for (const key in this._handler) {
				/* ensure that the key is the leading path of the url and either a direct match or
				*	immediately followed by a '/' (i.e. its not a partial name of a path-component) */
				if (!msg.url.pathname.startsWith(key))
					continue;
				if (msg.url.pathname.length > key.length && msg.url.pathname[key.length] != '/' && (key.length == 0 || msg.url.pathname[key.length - 1] != '/'))
					continue;

				/* check if this is the better match by being the first match or more precise */
				if (bestKey == undefined || key.length > bestKey.length)
					bestKey = key;
			}

			/* check if a handler has been found */
			if (bestKey != undefined) {
				this._handler[bestKey](msg);
				return;
			}

			/* add the default 404 (not-found) response */
			libLog.Error(`No handler registered for [${msg.url.pathname}]`)
			msg.respondNotFound(`No handler registered for [${msg.url.pathname}]`);
		} catch (err) {
			/* log the unknown caught exception (internal-server-error) */
			libLog.Error(`Uncaught exception encountered: ${err}`)
			if (msg != null)
				msg.tryRespondInternalError('Unknown internal error encountered');
			request.destroy();
		}
	}

	addHandler(path, exactPath, callback) {
		if (path in (exactPath ? this._exact : this._handler))
			libLog.Error(`${exactPath ? "path" : "Sub-path"} [${path}] is already being handled`);
		else {
			libLog.Info(`Registered ${exactPath ? "path" : "sub-path"} handler for [${path}]`);
			(exactPath ? this._exact : this._handler)[path] = callback;
		}
	}
	listenHttp(port, secureInternal) {
		try {
			/* start the actual server */
			const server = libNodeHttp.createServer((req, resp) =>
				this._requestHandler(req, resp, secureInternal)
			).listen(port);
			server.on('error', (err) => {
				libLog.Error(`While listening to port ${port} using http: ${err}`);
			});
			if (!server.listening)
				return;

			const address = server.address();
			libLog.Info(`Http-server${secureInternal ? " flagged as secure-internal " : " "}started successfully on [${address.address}]:${address.port} [family: ${address.family}]`);
		} catch (err) {
			libLog.Error(`While listening to port ${port} using http: ${err}`);
		}
	}
	listenHttps(port, key, cert, secureInternal) {
		try {
			/* load the key and certificate */
			const config = {
				key: libFs.readFileSync(key),
				cert: libFs.readFileSync(cert)
			};

			/* start the actual server */
			const server = libNodeHttps.createServer(config, (req, resp) =>
				this._requestHandler(req, resp, secureInternal)
			).listen(port);
			server.on('error', (err) => {
				libLog.Error(`While listening to port ${port} using https: ${err}`);
			});
			if (!server.listening)
				return;

			const address = server.address();
			libLog.Info(`Https-server${secureInternal ? " flagged as secure-internal " : " "}started successfully on [${address.address}]:${address.port} [family: ${address.family}]`);
		} catch (err) {
			libLog.Error(`While listening to port ${port} using https: ${err}`);
		}
	}
};
