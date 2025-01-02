/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
import * as libLog from "../../server/log.js";
import * as libPath from "path";
import * as libFs from "fs";
import * as libCrypto from "crypto";

export const SubPath = '/quiz-game';
const ActualPath = libPath.resolve('./www/quiz-game');

let JsonQuestions = JSON.parse(libFs.readFileSync('./handler/quiz-game/categorized-questions.json', 'utf8'));
let Sessions = {};

class GameState {
	constructor() {
		this.phase = 'start'; //start,category,answer,resolved,done
		this.question = null;
		this.remaining = [];
		this.players = {};
		this.round = null;

		for (let i = 0; i < JsonQuestions.length; ++i)
			this.remaining.push(i);
	}
	resetPlayerReady() {
		for (const key in this.players)
			this.players[key].ready = false;
	}
	resetPlayersForPhase() {
		/* reset the player states for the next phase */
		for (const key in this.players) {
			let player = this.players[key];
			player.ready = false;
			player.actual = player.score;
			player.confidence = 1;
			player.choice = -1;
			player.correct = false;
			player.effect = {
				doubleOrNothing: false,
				exposed: false,
				skipping: null,
				forcing: null,
				inverting: null,
			};
		}
	}
	advanceStage() {
		/* check if all players are valid */
		for (const key in this.players) {
			if (!this.players[key].ready)
				return;
		}
		if (this.players.length < 2)
			return;

		/* check if the next stage needs to be picked */
		if (this.phase == 'start' || this.phase == 'resolved') {
			if (this.remaining.length == 0) {
				this.phase = 'done';
				this.question = null;
				this.resetPlayersForPhase();
				return;
			}

			/* advance the round and select the next question */
			if (this.phase == 'start')
				this.round = 0;
			else
				this.round += 1;
			let index = Math.floor(Math.random() * this.remaining.length);
			this.question = JsonQuestions[this.remaining[index]];
			this.remaining.splice(index, 1);
			this.phase = 'category';
			this.resetPlayersForPhase();
			return;
		}

		/* check if the answer-round can be started */
		if (this.phase == 'category') {
			this.phase = 'answer';
			this.resetPlayerReady();
			return;
		}

		/* initialize the actual confidences to be used */
		let confidence = {};
		for (const key in this.players)
			confidence[key] = this.players[key].confidence;

		/* apply the skip-steps */
		for (const key in this.players) {
			let skip = this.players[key].effect.skipping;
			if (skip != null && (skip in this.players))
				confidence[skip] = 0;
		}

		/* apply the force-steps */
		for (const key in this.players) {
			let force = this.players[key].effect.forcing;
			if (force != null && (force in this.players))
				confidence[force] = 4;
		}

		/* apply the invert-steps */
		for (const key in this.players) {
			let invert = this.players[key].effect.inverting;
			if (invert != null && (invert in this.players))
				confidence[invert] = 3 - confidence[invert];
		}

		/* apply the points and the double-or-nothing and reset the remaining player states and advance the phase */
		for (const key in this.players) {
			let player = this.players[key];
			let diff = (player.correct ? confidence[key] : -confidence[key]);
			player.actual = Math.max(0, player.score + diff);

			if (player.effect.doubleOrNothing)
				player.actual = (player.correct ? player.actual * 2 : 0);

			player.delta = (player.actual - player.score);
			player.score = player.actual;
		}
		this.resetPlayerReady();
		this.phase = 'resolved';
	}
	makeState() {
		return {
			cmd: 'state',
			phase: this.phase,
			question: this.question,
			totalQuestions: JsonQuestions.length,
			players: this.players,
			round: this.round
		};
	}
	updatePlayer(name, state) {
		if (state == undefined || state == null)
			delete this.players[name];
		else
			this.players[name] = state;
		this.advanceStage();
	}
};
class Session {
	constructor() {
		this.state = new GameState();
		this.ws = [];
		this.dead = 0;
		this.nextId = 0;
		this.timeout = null;
	}

	sync() {
		this.dead = 0;
		let msg = JSON.stringify(this.state.makeState());
		for (let i = 0; i < this.ws.length; ++i)
			this.ws[i].send(msg);
	}

	handle(msg) {
		if (typeof (msg.cmd) != 'string' || msg.cmd == '')
			return { cmd: 'malformed' };

		/* handle the command */
		switch (msg.cmd) {
			case 'state':
				return this.state.makeState();
			case 'update':
				if (typeof (msg.name) != 'string')
					return { cmd: 'malformed' };
				this.state.updatePlayer(msg.name, msg.value);
				this.sync();
				return { cmd: 'ok' };
			default:
				return { cmd: 'malformed' };
		}
	}
};

function SetupSession() {
	let id = libCrypto.randomUUID();
	libLog.Log(`Session created: ${id}`);
	let session = (Sessions[id] = new Session());

	/* setup the session-timeout checker (20 minutes)
	*	(only considered alive when the state changes) */
	session.timeout = setInterval(function () {
		if (session.dead++ < 21)
			return;
		for (let i = 0; i < session.ws.length; ++i)
			session.ws[i].close();
		delete Sessions[id];
		clearInterval(session.timeout);
		libLog.Log(`Session deleted: ${id}`);
	}, 1000 * 60);
	return id;
}
function AcceptWebSocket(ws, id) {
	/* check if the session exists */
	if (!(id in Sessions)) {
		libLog.Log(`WebSocket connection for unknown session: ${id}`);
		ws.send(JSON.stringify({ cmd: 'unknown-session' }));
		ws.close();
		return;
	}
	let session = Sessions[id];

	/* register the listener */
	session.ws.push(ws);

	/* setup the socket */
	let uniqueId = ++session.nextId;
	ws.log = function (msg) { libLog.Log(`WS[${id}|${uniqueId}]: ${msg}`); };
	ws.err = function (msg) { libLog.Error(`WS[${id}|${uniqueId}]: ${msg}`); };
	ws.log(`websocket connected`);

	/* register the callbacks */
	ws.on('message', function (msg) {
		try {
			let parsed = JSON.parse(msg);
			ws.log(`received: ${parsed.cmd}`);

			/* handle the message accordingly */
			let response = session.handle(parsed);
			ws.log(`response: ${response.cmd}`);
			ws.send(JSON.stringify(response));
		} catch (err) {
			ws.err(`exception while message: [${err}]`);
			ws.close();
		}
	});
	ws.on('close', function () {
		session.ws = session.ws.filter((s) => (s != ws));
		ws.log(`websocket disconnected`);
		ws.close();
	});
}

export function Handle(msg) {
	libLog.Log(`Game handler for [${msg.relative}]`);

	/* check if its a root-request and forward it accordingly */
	if (msg.relative == '/') {
		msg.respondFile(libPath.join(ActualPath, './base/startup.html'), false);
		return;
	}

	/* check if a new session has been requested and create it */
	if (msg.relative == '/new') {
		let id = SetupSession();
		msg.respondRedirect(libPath.join(SubPath, `./session`) + `?id=${id}`);
		return;
	}

	/* check if a session-dependent page has been requested */
	if (msg.relative == '/session') {
		msg.respondFile(libPath.join(ActualPath, './base/session.html'), false);
		return
	}
	if (msg.relative == '/client') {
		msg.respondFile(libPath.join(ActualPath, './client/main.html'), false);
		return;
	}
	if (msg.relative == '/score') {
		msg.respondFile(libPath.join(ActualPath, './score/main.html'), false);
		return;
	}

	/* check if the websocket has been requested */
	if (msg.relative.startsWith('/ws/')) {
		let id = msg.relative.substring(4);
		if (msg.tryAcceptWebSocket((ws) => AcceptWebSocket(ws, id)))
			return;
		libLog.Log(`Invalid request for web-socket point for session: [${id}]`);
		msg.respondNotFound();
		return;
	}

	/* respond to the request by trying to server the file */
	msg.tryRespondFile(libPath.join(ActualPath, '.' + msg.relative), false);
}
