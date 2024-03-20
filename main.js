import * as libServer from "./server/server.js";
import * as libTemplates from "./server/templates.js";
import * as libLog from "./server/log.js";
import * as libStatic from "./server/handler/static.js";
import * as libConfig from "./server/config.js";
import * as libHttp from "./server/http.js";

const server = new libServer.Server();

/* internally reachable */
server.listenHttp(libConfig.PortInternalHttp, true);

/* public facing */

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
