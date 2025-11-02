/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
import * as libServer from "./server.js";
import * as libLog from "core/log.js";
import * as libConfig from "core/config.js";

function Setup(localModule: any) {
	if (localModule == null || localModule.Run === undefined) {
		libLog.Warning('Unable to load local module [apps/setup.js:Run]');
		return;
	}
	libLog.Info('Local module loaded');

	/* load the server and configure it */
	const server = new libServer.Server();
	localModule.Run(server);
}

/* initialize the default configuration (before loading the local module!) */
libConfig.initialize();

/* try to load the local configuration and otherwise perform the default-setup */
import("../apps/setup.js")
	.then(localModule => Setup(localModule))
	.catch(() => Setup(null));
