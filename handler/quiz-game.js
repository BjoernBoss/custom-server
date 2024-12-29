import * as libLog from "../server/log.js";
import * as libPath from "path";

export const SubPath = '/quiz-game';
const ActualPath = libPath.resolve('./www/quiz-game');

let GameGlobal = {};

class GameSync {
	constructor() {
		this.nextId = 0;
		this.listener = {};
	}

	accept(ws, type) {
		let obj = {
			ws: ws,
			uniqueId: ++this.nextId
		};

		/* setup the logging function */
		if (type == 'admin') {
			obj.log = function (msg) { libLog.Log(`WS-admin[${obj.uniqueId}]: ${msg}`); };
			obj.err = function (msg) { libLog.Error(`WS-admin[${obj.uniqueId}]: ${msg}`); };
		}
		else if (type == 'client') {
			obj.log = function (msg) { libLog.Log(`WS-client[${obj.uniqueId}]: ${msg}`); };
			obj.err = function (msg) { libLog.Error(`WS-client[${obj.uniqueId}]: ${msg}`); };
		}
		else {
			obj.log = function (msg) { libLog.Log(`WS-score[${obj.uniqueId}]: ${msg}`); };
			obj.err = function (msg) { libLog.Error(`WS-score[${obj.uniqueId}]: ${msg}`); };
		}

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
		this.question = 0;
		this.remaining = [];
		this.players = {};
		this.round = 0;

		for (let i = 0; i < 191; ++i)
			this.remaining.push(i);
		GameGlobal.sync.syncGameState(this.makeState());
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
			player.exposed = false;
			player.skipping = null;
			player.forcing = null;
			player.correct = false;
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
				this.resetPlayersForPhase(false);
				return;
			}

			/* advance the round and select the next question */
			if (this.phase != 'start')
				this.round += 1;
			let index = Math.floor(Math.random() * this.remaining.length);
			this.question = this.remaining[index];
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

		for (const key in this.players) {
			let player = this.players[key];

			libLog.Info(`Player: ${key}: ${JSON.stringify(player)}`);
		}

		/* apply the force-steps */
		for (const key in this.players) {
			let force = this.players[key].forcing;
			if (force != null && (force in this.players))
				this.players[force].confidence = 4;
		}

		/* apply the skip-steps */
		for (const key in this.players) {
			let skip = this.players[key].skipping;
			if (skip != null && (skip in this.players))
				this.players[skip].confidence = 0;
		}

		/* apply the points and reset the remaining player states and advance the phase */
		for (const key in this.players) {
			let player = this.players[key];
			if (player.correct)
				player.delta = player.confidence;
			else
				player.delta = Math.max(-player.actual, -player.confidence);
			player.actual = player.score + player.delta;
			player.score = player.actual;
		}
		this.resetPlayersForPhase(true);
		this.phase = 'resolved';
	}

	makeState() {
		return {
			code: 'state',
			phase: this.phase,
			question: this.question,
			players: this.players,
			round: this.round
		};
	}
	updatePlayer(name, state) {
		if (state == undefined || state == null)
			delete this.players[name];
		else
			this.players[name] = state;

		libLog.Info(`Player: ${name}: ${JSON.stringify(state)}`);

		this.advanceStage();
		GameGlobal.sync.syncGameState(this.makeState());
	}
};

GameGlobal.sync = new GameSync();
GameGlobal.state = new GameState();
GameGlobal.state.resetGame();

function AcceptWebSocket(ws, type) {
	/* setup the obj-state */
	let obj = GameGlobal.sync.accept(ws, type);
	obj.log('websocket accepted');

	/* register the callbacks */
	ws.on('message', function (msg) {
		try {
			let parsed = JSON.parse(msg);
			let response = HandleMessage(parsed, obj);
			if (typeof (parsed.cmd) == 'string')
				obj.log(`handling command [${parsed.cmd}]: ${response.code}`);
			else
				obj.log(`response: ${response.code}`);
			ws.send(JSON.stringify(response));
		} catch (err) {
			obj.err(`exception while handling ${type}: [${err}]`);
			ws.close();
		}
	});
	ws.on('close', function () {
		GameGlobal.sync.close(obj);
		obj.log(`websocket closed`);
		ws.close();
	});
}
function HandleMessage(msg) {
	if (typeof (msg.cmd) != 'string' || msg.cmd == '')
		return { code: 'malformed' };

	/* handle the command */
	switch (msg.cmd) {
		case 'state':
			return GameGlobal.state.makeState();
		case 'reset':
			GameGlobal.state.resetGame();
			return GameGlobal.state.makeState();
		case 'update':
			if (typeof (msg.name) != 'string')
				return { code: 'malformed' };
			GameGlobal.state.updatePlayer(msg.name, msg.value);
			return { code: 'ok' };
		default:
			return { code: 'malformed' };
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
		if (msg.tryAcceptWebSocket((ws) => AcceptWebSocket(ws, 'client')))
			return;
		libLog.Log(`Invalid request for client web-socket point`);
		this.respondNotFound();
		return;
	}
	if (msg.relative == '/ws-admin') {
		if (msg.tryAcceptWebSocket((ws) => AcceptWebSocket(ws, 'admin')))
			return;
		libLog.Log(`Invalid request for admin web-socket point`);
		this.respondNotFound();
		return;
	}
	if (msg.relative == '/ws-score') {
		if (msg.tryAcceptWebSocket((ws) => AcceptWebSocket(ws, 'score')))
			return;
		libLog.Log(`Invalid request for score web-socket point`);
		this.respondNotFound();
		return;
	}

	/* respond to the request by trying to server the file */
	msg.tryRespondFile(libPath.join(ActualPath, '.' + msg.relative), false);
}
