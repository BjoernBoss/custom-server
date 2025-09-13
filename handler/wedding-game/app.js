/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
import * as libLog from "../../server/log.js";
import * as libPath from "path";

function fileRelative(path) {
	/* workaround! (7 => file://) */
	const dirName = import.meta.dirname ?? libPath.dirname(import.meta.url.slice(7));
	if (path.startsWith('/'))
		return libPath.join(dirName, '.' + path);
	if (!path.startsWith('./'))
		return libPath.join(dirName, './' + path);
	return libPath.join(dirName, path);
}

let GameGlobal = {};

class GameSync {
	constructor() {
		this.nextId = 0;
		this.players = {};
		this.scores = {};
		this.admin = null;
	}

	accept(ws, type) {
		let obj = {
			name: '',
			ws: ws,
			uniqueId: ++this.nextId
		};

		/* setup the logging function */
		if (type == 'admin') {
			obj.log = function (msg) { libLog.Log(`WS-admin[${obj.uniqueId}]: ${msg}`); };
			obj.err = function (msg) { libLog.Error(`WS-admin[${obj.uniqueId}]: ${msg}`); };
		}
		else if (type == 'client') {
			obj.log = function (msg) { libLog.Log(`WS-client[${obj.uniqueId}: ${obj.name}]: ${msg}`); };
			obj.err = function (msg) { libLog.Error(`WS-client[${obj.uniqueId}: ${obj.name}]: ${msg}`); };
		}
		else {
			obj.log = function (msg) { libLog.Log(`WS-score[${obj.uniqueId}: ${obj.name}]: ${msg}`); };
			obj.err = function (msg) { libLog.Error(`WS-score[${obj.uniqueId}: ${obj.name}]: ${msg}`); };
		}

		/* immediately register the scores */
		if (type == 'score')
			this.scores[obj.uniqueId] = obj;
		return obj;
	}
	close(obj, type) {
		switch (type) {
			case 'admin':
				if (this.admin == obj) {
					this.admin.log('logged admin off');
					this.admin = null;
				}
				break;
			case 'client':
				if ((obj.name in this.players) && this.players[obj.name] == obj) {
					this.players[obj.name].log('logged client off');
					this.players[obj.name] = null;
					obj.name += '$offline';
				}
				break;
			case 'score':
				if (obj.uniqueId in this.scores)
					this.scores[obj.uniqueId] = null;
				break;
		}
	}

	addPlayer(obj, name, takeOwnership, reset) {
		obj.name = '';

		/* check if the current owner should be logged off */
		if (name in this.players) {
			if (!takeOwnership)
				return { code: (this.players[name] != null ? 'inUse' : 'alreadyExists') };
			if (this.players[name] != null) {
				this.players[name].ws.send(JSON.stringify({ code: 'loggedOff' }));
				this.players[name].log('force-logged client off');
				this.players[name].name += '$offline';
			}
		}

		/* configure the new active client and setup the playerstate */
		obj.name = name;
		this.players[name] = obj;
		GameGlobal.state.createPlayer(obj, reset);
		this.players[name].log('logged client on');
		return { code: 'ok' };
	}
	addAdmin(obj) {
		/* log the current admin off */
		if (this.admin != null) {
			this.admin.ws.send(JSON.stringify({ code: 'loggedOff' }));
			this.admin.log('force-logged admin off');
		}
		this.admin = obj;
		this.admin.log(`logged admin on`);
		return { code: 'ok' };
	}
	isPlayer(obj) {
		if (obj.name == '')
			return false;
		return ((obj.name in this.players) && this.players[obj.name] == obj);
	}
	isAdmin(obj) {
		return (this.admin == obj);
	}

	stateChanged(obj) {
		/* notify the player */
		if (obj != null)
			this.players[obj.name].ws.send(JSON.stringify({ code: 'dirty' }));
	}
	allStatesChanged() {
		/* notify all active players */
		for (const key in this.players) {
			if (this.players[key] != null)
				this.players[key].ws.send(JSON.stringify({ code: 'dirty' }));
		}

		/* notify the active admin */
		if (this.admin != null)
			this.admin.ws.send(JSON.stringify({ code: 'dirty' }));
	}
	disconnectAll() {
		for (const key in this.players) {
			if (this.players[key] != null) {
				this.players[key].ws.send(JSON.stringify({ code: 'loggedOff' }));
				this.players[key].log('force-logged client off');
			}
		}
		this.players = {};
	}
	scoreChanged() {
		for (const id in this.scores) {
			if (this.scores[id] != null)
				this.scores[id].ws.send(JSON.stringify({ code: 'dirty' }));
		}
	}
};
class GameState {
	constructor() {
		this.state = 'start'; //start, prepared, open, closed, resolved
		this.correct = [-1, -1, -1, -1];
		this.options = ['', '', '', ''];
		this.description = '';
		this.players = {};
	}

	createPlayer(obj, reset) {
		if (reset || !(obj.name in this.players))
			this.players[obj.name] = { score: 0, choices: [-1, -1, -1, -1] };

		/* notify the listener about the changed state */
		GameGlobal.sync.stateChanged(null);
		GameGlobal.sync.scoreChanged();
	}

	/* called by client/admin */
	makeChoice(obj, index, value) {
		/* check if the choice can be made and is valid */
		if (this.state != 'open')
			return { code: 'noChoicePossible' };
		if (index < 0 || index >= this.options.length || value < 0 || value >= 4)
			return { code: 'outOfRange' };
		if (value == this.players[obj.name].choices[index])
			return { code: 'ok' };
		obj.log(`made choice [${value}] for [${index}]`);

		/* update the choice of the player and notify the listener */
		this.players[obj.name].choices[index] = value;
		GameGlobal.sync.stateChanged(obj);
		return { code: 'ok' };
	}
	getClient(obj) {
		return {
			code: 'ok',
			description: this.description,
			options: this.options,
			open: (this.state == 'open'),
			score: this.players[obj.name].score,
			choices: this.players[obj.name].choices,
			correct: this.correct
		};
	}
	getAdmin() {
		return {
			code: 'ok',
			current: this.description,
			state: this.state
		};
	}
	getScore() {
		let resp = {
			code: 'ok',
			scores: {}
		};
		for (const name in this.players)
			resp.scores[name] = this.players[name].score;
		return resp;
	}

	/* called by admin */
	resetAll(obj, resetPlayers) {
		if (this.state == 'start')
			return { code: 'ok' };
		this.state = 'start';
		obj.log(resetPlayers ? 'reset game and players' : 'reset game');

		/* reset all players */
		if (resetPlayers) {
			this.players = {};
			GameGlobal.sync.disconnectAll();
		}
		else for (const name in this.players)
			this.players[name].choices = [-1, -1, -1, -1];
		this.correct = [-1, -1, -1, -1];

		/* reset the current round */
		this.description = '';
		this.options = ['', '', '', ''];

		/* notify the listener */
		GameGlobal.sync.allStatesChanged();
		GameGlobal.sync.scoreChanged();
		return { code: 'ok' };
	}
	setupNext(obj, desc, opt) {
		if (this.state != 'start' && this.state != 'resolved')
			return { code: 'seqError' };
		this.state = 'prepared';
		obj.log('setup next game');

		/* reset the choices */
		for (const name in this.players)
			this.players[name].choices = [-1, -1, -1, -1];
		this.correct = [-1, -1, -1, -1];

		/* setup the next game */
		this.description = desc;
		this.options = opt;

		/* notify the listener */
		GameGlobal.sync.allStatesChanged();
		return { code: 'ok' };
	}
	startRound(obj) {
		if (this.state != 'prepared')
			return { code: 'seqError' };
		obj.log('started next game');

		/* update the state and notify the listener */
		this.state = 'open';
		GameGlobal.sync.allStatesChanged();
		return { code: 'ok' };
	}
	closeRound(obj) {
		if (this.state != 'open')
			return { code: 'seqError' };
		obj.log('closed game');

		/* update the state and notify the listener */
		this.state = 'closed';
		GameGlobal.sync.allStatesChanged();
		return { code: 'ok' };
	}
	resolveRound(obj, result) {
		if (this.state != 'closed')
			return { code: 'seqError' };
		if (result.length != 4)
			return { code: 'malformed' };
		this.state = 'resolved';
		obj.log('resolved game');

		/* update the player scores */
		this.correct = result;
		for (const name in this.players) {
			for (let i = 0; i < 4; ++i) {
				if (this.players[name].choices[i] == this.correct[i])
					this.players[name].score += 1;
			}
		}

		/* notify the listener */
		GameGlobal.sync.allStatesChanged();
		GameGlobal.sync.scoreChanged();
		return { code: 'ok' };
	}
};

GameGlobal.sync = new GameSync();
GameGlobal.state = new GameState();

function AcceptWebSocket(ws, type) {
	/* setup the obj-state */
	let obj = GameGlobal.sync.accept(ws, type);
	obj.log('websocket accepted');

	/* register the callbacks */
	ws.on('message', function (msg) {
		try {
			let parsed = JSON.parse(msg);
			let response = {
				admin: HandleAdminMessage,
				client: HandleClientMessage,
				score: HandleScoreMessage
			}[type](parsed, obj);
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
		GameGlobal.sync.close(obj, type);
		obj.log(`websocket closed`);
		ws.close();
	});
}
function HandleClientMessage(msg, client) {
	if (typeof (msg.cmd) != 'string' || msg.cmd == '')
		return { code: 'malformed' };

	/* check if its the login command */
	if (msg.cmd == 'login') {
		if (typeof (msg.name) != 'string' || msg.name == '')
			return { code: 'malformed' };
		return GameGlobal.sync.addPlayer(client, msg.name, msg.takeOwnership === true, msg.resetState === true);
	}

	/* check if the client is valid */
	if (!GameGlobal.sync.isPlayer(client))
		return { code: 'notLoggedIn' };

	/* handle the command */
	switch (msg.cmd) {
		case 'state':
			return GameGlobal.state.getClient(client);
		case 'choice':
			if (typeof (msg.index) != 'number' || typeof (msg.value) != 'number')
				return { code: 'malformed' };
			return GameGlobal.state.makeChoice(client, msg.index, msg.value);
		default:
			return { code: 'malformed' };
	}
}
function HandleAdminMessage(msg, admin) {
	if (typeof (msg.cmd) != 'string' || msg.cmd == '')
		return { code: 'malformed' };

	/* check if the admin requests activation */
	if (msg.cmd == 'login')
		return GameGlobal.sync.addAdmin(admin);

	/* check if the admin is valid */
	if (!GameGlobal.sync.isAdmin(admin))
		return { code: 'notLoggedIn' };

	/* handle the command */
	switch (msg.cmd) {
		case 'state':
			return GameGlobal.state.getAdmin();
		case 'reset':
			return GameGlobal.state.resetAll(admin, msg.total === true);
		case 'next':
			if (typeof (msg.description) != 'string' || msg.description.length == 0 || typeof (msg.options) != 'object' || msg.options.length != 4)
				return { code: 'malformed' };
			for (let i = 0; i < 4; ++i) {
				if (typeof (msg.options[i]) != 'string' || msg.options[i].length == 0)
					return { code: 'malformed' };
			}
			return GameGlobal.state.setupNext(admin, msg.description, msg.options);
		case 'start':
			return GameGlobal.state.startRound(admin);
		case 'close':
			return GameGlobal.state.closeRound(admin);
		case 'resolve':
			if (typeof (msg.values) != 'object')
				return { code: 'malformed' };
			return GameGlobal.state.resolveRound(admin, msg.values);
		default:
			return { code: 'malformed' };
	}
}
function HandleScoreMessage(msg, score) {
	if (typeof (msg.cmd) != 'string' || msg.cmd == '')
		return { code: 'malformed' };

	/* handle the command */
	switch (msg.cmd) {
		case 'state':
			return GameGlobal.state.getScore();
		default:
			return { code: 'malformed' };
	}
}

export const SubPath = '/wedding-game';

export function Handle(msg) {
	libLog.Log(`Game handler for [${msg.relative}]`);
	if (!msg.ensureMethod(['GET']))
		return;

	/* check if its a root-request and forward it accordingly */
	if (msg.relative == '/') {
		msg.tryRespondFile(fileRelative('static/client/main.html'), false);
		return;
	}
	if (msg.relative == '/score') {
		msg.tryRespondFile(fileRelative('static/score/main.html'), false);
		return;
	}

	/* check if its a web-socket request */
	if (msg.relative == '/ws-client') {
		if (msg.tryAcceptWebSocket((ws) => AcceptWebSocket(ws, 'client')))
			return;
		libLog.Log(`Invalid request for client web-socket point`);
		msg.respondNotFound();
		return;
	}
	if (msg.relative == '/ws-admin') {
		if (msg.tryAcceptWebSocket((ws) => AcceptWebSocket(ws, 'admin')))
			return;
		libLog.Log(`Invalid request for admin web-socket point`);
		msg.respondNotFound();
		return;
	}
	if (msg.relative == '/ws-score') {
		if (msg.tryAcceptWebSocket((ws) => AcceptWebSocket(ws, 'score')))
			return;
		libLog.Log(`Invalid request for score web-socket point`);
		msg.respondNotFound();
		return;
	}

	/* respond to the request by trying to server the file */
	msg.tryRespondFile(fileRelative('static' + msg.relative), false);
}
