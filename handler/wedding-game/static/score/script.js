/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
let _game = {};

window.onload = function () {
	/* fetch all relevant components */
	_game.htmlScores = document.getElementById('scores');
	_game.state = {};

	/* setup the web-socket */
	let url = new URL(document.URL);
	let protocol = (url.protocol.startsWith('https') ? 'wss' : 'ws');
	_game.sock = {
		ws: null,
		url: `${protocol}://${url.host}/wedding-game/ws-score`,
		handling: false,
		state: 'creating',
		connectionFailedDelay: 256
	};
	_game.setupConnection();
};

_game.connectionFailed = function () {
	if (_game.sock.connectionFailedDelay > 8192) {
		console.log('Not trying a new connection');
		_game.sock.state = 'failed';
	}
	else {
		_game.sock.state = 'error';
		setTimeout(() => _game.restartConnection(), _game.sock.connectionFailedDelay);
		_game.sock.connectionFailedDelay *= 2;
	}
};
_game.setupConnection = function () {
	console.log('Setting up connection');
	_game.sock.state = 'creating';
	try {
		_game.sock.ws = new WebSocket(_game.sock.url);
	} catch (e) {
		console.log(`Error while setting up connection: ${e}`);
		_game.connectionFailed();
	}

	_game.sock.ws.onmessage = function (m) {
		try {
			/* parse the message and handle it accordingly */
			let msg = JSON.parse(m.data);
			switch (msg.code) {
				case 'dirty':
					_game.queryState();
					break;
				case 'ok':
					_game.sock.handling = false;
					_game.state = msg.scores;
					_game.applyState();
					break;
				default:
					console.log(`Unsolicited message from server: [${msg.code}]`);
					break;
			}
		} catch (e) {
			console.log(`Error while handling message: ${e}`);
			_game.restartConnection();
		}
	};
	_game.sock.ws.onclose = function () {
		console.log('Connection to remote side lost');
		_game.restartConnection();
	};
	_game.sock.ws.onopen = function () {
		console.log('Connection established');
		_game.sock.state = 'ready';
		_game.sock.connectionFailedDelay = 256;
		_game.queryState();
	};
	_game.sock.ws.onerror = function () {
		console.log('Failed to establish a connection to the server');
		_game.sock.ws.onclose = function () { };
		_game.connectionFailed();
	};
};
_game.restartConnection = function () {
	if (_game.sock.state == 'creating' || _game.sock.state == 'restart')
		return;
	_game.sock.ws.close();
	_game.sock.ws = null;
	_game.sock.state = 'restart';
	setTimeout(() => _game.setupConnection(), 150);
};
_game.queryState = function () {
	/* check if the request is already being sent or the connection is not ready */
	if (_game.sock.handling)
		return;
	if (_game.sock.state != 'ready')
		return;
	_game.sock.handling = true;

	/* queue the task to fetch the score */
	let cmd = { cmd: 'state' };
	console.log(`Sending task: ${cmd.cmd}`)
	_game.sock.ws.send(JSON.stringify(cmd));
};
_game.applyState = function () {
	console.log('Applying received state');

	/* sort the player by score */
	let list = [];
	for (let key in _game.state)
		list.push([key, _game.state[key]]);
	list.sort((v) => v[1]);

	/* remove all content */
	while (_game.htmlScores.children.length > 0)
		_game.htmlScores.children[_game.htmlScores.children.length - 1].remove();

	/* add all names and scores */
	for (let i = 0; i < list.length; ++i) {
		/* create the actual elements */
		let r = document.createElement("div");
		r.classList.add("row");
		let n = document.createElement("div");
		n.classList.add("name");
		r.appendChild(n);
		let s = document.createElement("div");
		s.classList.add("score");
		r.appendChild(s);
		let np = document.createElement("p");
		np.innerText = list[i][0];
		n.appendChild(np);
		let sp = document.createElement("p");
		sp.innerText = String(list[i][1]);
		s.appendChild(sp);
		_game.htmlScores.appendChild(r);

		/* add the trailing separator */
		let sep = document.createElement("div");
		sep.classList.add("core-separator");
		_game.htmlScores.appendChild(sep);
	}
};
