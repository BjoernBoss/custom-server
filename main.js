/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
import * as libServer from "./server/server.js";
import * as libLog from "./server/log.js";
import * as libConfig from "./server/config.js";

import * as libShared from "./handler/share/app.js";
import * as libQuizGame from "./handler/quiz-game/app.js";
import * as libWeddingGame from "./handler/wedding-game/app.js";
import * as libCrossword from "./handler/crossword/app.js";

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

	/* add the shared content handler */
	server.addHandler(new libShared.Application());

	/* add the quiz-game content handler */
	server.addHandler(new libQuizGame.Application());

	/* add the wedding-game content handler */
	server.addHandler(new libWeddingGame.Application());

	/* add the crossword content handler */
	server.addHandler(new libCrossword.Application());
}

/* initialize the default configuration (before loading the local module!) */
libConfig.initialize();

/* try to load the local configuration and otherwise perform the default-setup */
import("./local-config.js")
	.then(localModule => Setup(localModule))
	.catch(() => Setup(null));
