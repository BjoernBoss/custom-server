import * as libServer from "./server/server.js";
import * as libLog from "./server/log.js";
import * as libStatic from "./server/handler/static.js";
import * as libCatchAll from "./server/handler/catch-all.js";
import * as libConfig from "./server/config.js";

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
	server.addHandler(libCatchAll.CatchAllSubPath, false, libCatchAll.HandleCatchAll);

	/* add the static content handler */
	server.addHandler(libStatic.StaticSubPath, false, libStatic.HandleStatic);
}

/* try to load the local configuration and otherwise perform the default-setup */
import("./local/local.js")
	.then(localModule => Setup(localModule))
	.catch(() => Setup(null));
