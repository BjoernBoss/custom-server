/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
import * as libLog from "../../server/log.js";
import * as libPath from "path";
import jsonQuestions from "./categorized-questions.json" with { type: "json" };

export const SubPath = '/quiz-game';
const ActualPath = libPath.resolve('./www/quiz-game');

let Sync = null;
let State = null;

class GameSync {
	constructor() {
		this.nextId = 0;
		this.listener = {};
	}

	accept(ws) {
		let obj = {
			ws: ws,
			uniqueId: ++this.nextId
		};

		/* setup the logging function */
		obj.log = function (msg) { libLog.Log(`WS[${obj.uniqueId}]: ${msg}`); };
		obj.err = function (msg) { libLog.Error(`WS[${obj.uniqueId}]: ${msg}`); };

		/* register the listener */
		this.listener[obj.uniqueId] = obj;
		return obj;
	}
	close(obj) {
		if (this.listener[obj.uniqueId] == obj) {
			obj.log('logged off');
			this.listener[obj.uniqueId] = null;
		}
	}
	syncGameState(state) {
		let msg = JSON.stringify(state);

		/* notify all listeners */
		for (const key in this.listener) {
			if (this.listener[key] != null)
				this.listener[key].ws.send(msg);
		}
	}
};
class GameState {
	resetGame() {
		this.phase = 'start'; //start,category,answer,resolved,done
		this.question = null;
		this.remaining = [];
		this.players = {};
		this.round = null;

		for (let i = 0; i < jsonQuestions.length; ++i)
			this.remaining.push(i);
		Sync.syncGameState(this.makeState());
	}
	resetPlayersForPhase(partial) {
		/* reset the player states for the next phase */
		for (const key in this.players) {
			let player = this.players[key];
			player.ready = false;

			if (partial)
				continue;
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
				this.resetPlayersForPhase(false);
				return;
			}

			/* advance the round and select the next question */
			if (this.phase == 'start')
				this.round = 0;
			else
				this.round += 1;
			let index = Math.floor(Math.random() * this.remaining.length);
			this.question = jsonQuestions[this.remaining[index]];
			this.remaining.splice(index, 1);
			this.phase = 'category';
			this.resetPlayersForPhase(false);
			return;
		}

		/* check if the answer-round can be started */
		if (this.phase == 'category') {
			this.phase = 'answer';
			this.resetPlayersForPhase(true);
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
		this.resetPlayersForPhase(true);
		this.phase = 'resolved';
	}
	makeState() {
		return {
			cmd: 'state',
			phase: this.phase,
			question: this.question,
			totalQuestions: jsonQuestions.length,
			players: this.players,
			round: this.round
		};
	}
	updatePlayer(name, state) {
		if (state == undefined || state == null) {
			delete this.players[name];
			if (Object.keys(this.players).length == 0)
				this.resetGame();
		}
		else
			this.players[name] = state;

		this.advanceStage();
		Sync.syncGameState(this.makeState());
	}
};

Sync = new GameSync();
State = new GameState();
State.resetGame();

function AcceptWebSocket(ws) {
	/* setup the obj-state */
	let obj = Sync.accept(ws);
	obj.log('websocket accepted');

	/* register the callbacks */
	ws.on('message', function (msg) {
		try {
			let parsed = JSON.parse(msg);

			/* handle the message accordingly */
			let response = HandleMessage(parsed, obj);
			if (typeof (parsed.cmd) == 'string')
				obj.log(`handling command [${parsed.cmd}]: ${response.cmd}`);
			else
				obj.log(`response: ${response.cmd}`);
			ws.send(JSON.stringify(response));
		} catch (err) {
			obj.err(`exception while message: [${err}]`);
			ws.close();
		}
	});
	ws.on('close', function () {
		Sync.close(obj);
		obj.log(`websocket closed`);
		ws.close();
	});
}
function HandleMessage(msg) {
	if (typeof (msg.cmd) != 'string' || msg.cmd == '')
		return { cmd: 'malformed' };

	/* handle the command */
	switch (msg.cmd) {
		case 'state':
			return State.makeState();
		case 'reset':
			State.resetGame();
			return State.makeState();
		case 'update':
			if (typeof (msg.name) != 'string')
				return { cmd: 'malformed' };
			State.updatePlayer(msg.name, msg.value);
			return { cmd: 'ok' };
		default:
			return { cmd: 'malformed' };
	}
}

export function Handle(msg) {
	libLog.Log(`Game handler for [${msg.relative}]`);

	/* check if its a root-request and forward it accordingly */
	if (msg.relative == '/') {
		msg.tryRespondFile(libPath.join(ActualPath, './client/main.html'), false);
		return;
	}
	if (msg.relative == '/score') {
		msg.tryRespondFile(libPath.join(ActualPath, './score/main.html'), false);
		return;
	}

	/* check if its a web-socket request */
	if (msg.relative == '/ws-client') {
		if (msg.tryAcceptWebSocket((ws) => AcceptWebSocket(ws)))
			return;
		libLog.Log(`Invalid request for client web-socket point`);
		this.respondNotFound();
		return;
	}
	if (msg.relative == '/ws-score') {
		if (msg.tryAcceptWebSocket((ws) => AcceptWebSocket(ws)))
			return;
		libLog.Log(`Invalid request for score web-socket point`);
		this.respondNotFound();
		return;
	}

	/* respond to the request by trying to server the file */
	msg.tryRespondFile(libPath.join(ActualPath, '.' + msg.relative), false);
}
