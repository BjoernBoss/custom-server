/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
import * as libServer from "core/server.js";
import * as libLog from "core/log.js";
import * as libConfig from "core/config.js";
import * as libFs from "fs";

/*
	update templates.ts to use proper types for each template
	move server.js out of core
	move list-dir template to share
	add app-config object, which local-module can interact with, which allows to re-map apps to different targets? or use 'app-name'?
*/

function Setup(localModule: any) {
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

	/* load all of the apps */
	for (const name of libFs.readdirSync("./apps")) {
		import(`./apps/${name}/app.js`)
			.then(m => server.addHandler(new m.Application()))
			.catch((e) => libLog.Error(`Failed to load app [${name}]: ${e.message}`));
	}
}

/* initialize the default configuration (before loading the local module!) */
libConfig.initialize();

/* try to load the local configuration and otherwise perform the default-setup */
import("./local-config.js")
	.then(localModule => Setup(localModule))
	.catch(() => Setup(null));
