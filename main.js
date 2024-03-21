import * as libServer from "./server/server.js";
import * as libTemplates from "./server/templates.js";
import * as libLog from "./server/log.js";
import * as libStatic from "./server/handler/static.js";
import * as libConfig from "./server/config.js";
import * as libHttp from "./server/http.js";

function Setup(localModule) {
	const server = new libServer.Server();

	/* check if the local-module has been loaded and run it */
	if (localModule != null) {
		libLog.Info('Local module loaded');
		localModule.run(server);
	}
	else
		libLog.Warning('Unable to load local module');

	/* internally reachable */
	server.listenHttp(libConfig.PortInternalHttp, true);

	/* add the catch-all handler */
	server.addHandler('', false, function (req, response, sec, url) {
		libLog.Info(`Catch-all not-found handler for [${url.pathname}]`);

		libHttp.HtmlResponse(response, libHttp.NotFound,
			libTemplates.LoadExpanded(libTemplates.ErrorNotFound, {
				path: url.pathname
			})
		);
	});

	/* add the static content handler */
	server.addHandler(libStatic.StaticSubPath, false, libStatic.HandleStatic);
}

/* try to load the local configuration and otherwise perform the default-setup */
import("./local/local.js")
	.then(localModule => Setup(localModule))
	.catch(() => Setup(null));
