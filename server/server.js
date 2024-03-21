import * as libLog from "./log.js";
import * as libHttp from "./http.js";
import * as libNodeHttps from "https";
import * as libNodeHttp from "http";
import * as libFs from "fs";
import * as libURL from "url";

export class Server {
	constructor() {
		libLog.Info(`Server object created`);
		this._handler = {};
		this._exact = {};
	}

	_requestHandler(request, response, secureInternal) {
		try {
			libLog.Info(`New ${secureInternal ? "internal-secure" : "external"} request: ([${request.socket.remoteAddress}]:${request.socket.remotePort}) [${request.url}] using user-agent [${request.headers['user-agent']}]`);
			const url = new libURL.URL(request.url, `http://${request.headers.host}`);

			/* check if an exact handler exists */
			if (url.pathname in this._exact) {
				this._exact[url.pathname](request, response, secureInternal, url);
				return;
			}

			/* lookup the best matching handler */
			var bestKey = undefined;
			for (const key in this._handler) {
				/* ensure that the key is the leading path of the url and either a direct match or
				*	immediately followed by a '/' (i.e. its not a partial name of a path-component) */
				if (!url.pathname.startsWith(key))
					continue;
				if (url.pathname.length > key.length && url.pathname[key.length] != '/' && (key.length == 0 || url.pathname[key.length - 1] != '/'))
					continue;

				/* check if this is the better match by being the first match or more precise */
				if (bestKey == undefined || key.length > bestKey.length)
					bestKey = key;
			}

			/* check if a handler has been found */
			if (bestKey != undefined) {
				this._handler[bestKey](request, response, secureInternal, url);
				return;
			}

			/* add the default 404 (not-found) response */
			libLog.Error(`No handler registered for [${url.pathname}]`)
			libHttp.RespondText(response, libHttp.StatusCode.NotFound, `No handler registered for [${url.pathname}]`);
			response.end();
		} catch (err) {
			/* log the unknown caught exception (internal-server-error) */
			libLog.Error(`Uncaught exception encountered: ${err}`)
			if (!response.headersSent) {
				response.removeHeader('Content-Range');
				libHttp.RespondText(response, libHttp.StatusCode.InternalError, 'Unknown internal error encountered');
				response.end();
			}
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
