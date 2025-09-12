/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
import * as libServer from "./server/server.js";
import * as libLog from "./server/log.js";
import * as libConfig from "./server/config.js";

import * as libShared from "./handler/shared.js";
import * as libCatchAll from "./handler/catch-all.js";
import * as libQuizGame from "./quiz-game/app.js";
import * as libWeddingGame from "./wedding-game/app.js";

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
	server.addHandler(libCatchAll.SubPath, false, libCatchAll.Handle);

	/* add the shared content handler */
	server.addHandler(libShared.SubPath, false, libShared.Handle);

	/* add the quiz-game content handler */
	server.addHandler(libQuizGame.SubPath, false, libQuizGame.Handle);

	/* add the wedding-game content handler */
	server.addHandler(libWeddingGame.SubPath, false, libWeddingGame.Handle);
}

/* try to load the local configuration and otherwise perform the default-setup */
import("./local/local.js")
	.then(localModule => Setup(localModule))
	.catch(() => Setup(null));
