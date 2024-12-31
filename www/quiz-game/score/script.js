/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
let _game = {};

window.onload = function () {
	/* caption/body components */
	_game.htmlCategory = document.getElementById('category');
	_game.htmlQuestion = document.getElementById('question');
	_game.htmlCorrect = document.getElementById('correct');
	_game.htmlRound = document.getElementById('round');
	_game.htmlScoreContent = document.getElementById('score-content');
	_game.htmlPhase = document.getElementById('phase');

	/* setup the overall state */
	_game.state = {};
	_game.sessionId = location.pathname.substring('/quiz-game/s/score/'.length);

	/* setup the web-socket */
	let url = new URL(document.URL);
	let protocol = (url.protocol.startsWith('https') ? 'wss' : 'ws');
	_game.sock = {
		ws: null,
		url: `${protocol}://${url.host}/quiz-game/s/ws/${_game.sessionId}`,
		queue: [],
		dirty: false,
		state: 'creating', //creating, ready, busy, failed, error, restart
		connectionFailedDelay: 256
	};
	_game.setupConnection();
};

_game.connectionFailed = function () {
	if (_game.sock.connectionFailedDelay > 2048) {
		console.log('Not trying a new connection');
		_game.sock.state = 'failed';
		alert('Unable to establish connection to server...');
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
		_game.handleMessage(m);
	};
	_game.sock.ws.onclose = function () {
		console.log('Connection to remote side lost');
		_game.restartConnection();
	};
	_game.sock.ws.onopen = function () {
		console.log('Connection established');
		_game.sock.state = 'ready';
		_game.sock.connectionFailedDelay = 256;
		_game.fetchState();
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
_game.handleMessage = function (m) {
	_game.sock.state = 'ready';

	try {
		/* parse the message and handle it accordingly */
		let msg = JSON.parse(m.data);
		switch (msg.cmd) {
			case 'ok':
				break;
			case 'unknown-session':
				alert('Unknown session!');
				return;
			case 'state':
				_game.state = msg;
				_game.applyState();
				break;
			default:
				console.log(`Unexpected message: ${msg.cmd}`);
				break;
		}
	} catch (e) {
		console.log(`Error while handling message: ${e}`);
		_game.restartConnection();
	}
};
_game.fetchState = function () {
	/* check if the socket is ready to send data */
	if (_game.sock.state != 'ready')
		return;
	_game.sock.state = 'busy';
	console.log('fetching state...');
	_game.sock.ws.send(JSON.stringify({ cmd: 'state' }));
};
_game.applyState = function () {
	console.log('Applying received state');

	/* update the current score and category */
	if (_game.state.round == null)
		_game.htmlRound.innerText = `Round: None / ${_game.state.totalQuestions}`;
	else
		_game.htmlRound.innerText = `Round: ${_game.state.round + 1} / ${_game.state.totalQuestions}`;
	_game.htmlPhase.innerText = `Phase: ${_game.state.phase}`;
	if (_game.state.question == null) {
		_game.htmlCategory.classList.add('hidden');
		_game.htmlQuestion.classList.add('hidden');
		_game.htmlCorrect.classList.add('hidden');
	}
	else {
		_game.htmlCategory.classList.remove('hidden');
		_game.htmlCategory.innerText = `Category: ${_game.state.question.category}`;

		if (_game.state.phase != 'category') {
			_game.htmlQuestion.classList.remove('hidden');
			_game.htmlQuestion.innerText = `Question: ${_game.state.question.text}`;
		}
		else
			_game.htmlQuestion.classList.add('hidden');

		if (_game.state.phase == 'resolved') {
			_game.htmlCorrect.classList.remove('hidden');
			_game.htmlCorrect.innerText = `Correct: ${_game.state.question.options[_game.state.question.correct]}`;
		}
		else
			_game.htmlCorrect.classList.add('hidden');
	}

	/* collect the list of all players and sort them by their score */
	let list = [];
	for (const key in _game.state.players)
		list.push([key, _game.state.players[key].score]);
	list.sort((a, b) => ((a[1] < b[1] || (a[1] == b[1] && a[0] > b[0])) ? 1 : -1));

	/* add the list of players */
	for (let i = 0; i < list.length; ++i) {
		/* check if the element already exists or needs to be created */
		if (i >= _game.htmlScoreContent.children.length) {
			let node = document.createElement('div');
			_game.htmlScoreContent.appendChild(node);
			node.classList.add('score');
		}
		let node = _game.htmlScoreContent.children[i];
		let player = _game.state.players[list[i][0]];
		let count = 0;
		let makeNext = function () {
			if (count >= node.children.length) {
				let temp = document.createElement('p');
				node.appendChild(temp);
				temp.classList.add(count == 0 ? 'name' : 'detail');
			}
			return node.children[count++];
		};

		/* add the name and score and ready-flag (first has always name-style) */
		makeNext().innerText = `Name: ${list[i][0]}`;
		makeNext().innerText = `Score: ${player.score}`;
		makeNext().innerText = `Ready: ${player.ready ? 'True' : 'False'}`;

		/* add the result */
		if (_game.state.phase == 'resolved') {
			let next = makeNext();
			if (_game.choice == -1)
				next.innerText = `Result: None`;
			else
				next.innerText = `Result: ${_game.state.question.options[player.choice]} (${player.correct ? 'Correct' : 'Incorrect'})`;
		}

		/* add the confidence */
		if (_game.state.phase == 'resolved')
			makeNext().innerText = `Confidence: ${player.confidence}`;

		/* add the delta */
		if (_game.state.phase == 'resolved')
			makeNext().innerText = `Delta: ${player.delta < 0 ? '' : '+'}${player.delta}`;

		/* add the double-or-nothing */
		if (_game.state.phase == 'resolved' && player.effect.doubleOrNothing)
			makeNext().innerText = `Double or Nothing: True`;

		/* add the exposed */
		if (_game.state.phase == 'resolved' && player.effect.exposed)
			makeNext().innerText = 'Exposed: True';

		/* add the skipping */
		if (_game.state.phase == 'resolved' && player.effect.skipping != null)
			makeNext().innerText = `Skipping: ${player.effect.skipping}`;

		/* add the forcing */
		if (_game.state.phase == 'resolved' && player.effect.forcing != null)
			makeNext().innerText = `Forcing Confidence: ${player.effect.forcing}`;

		/* add the inverting */
		if (_game.state.phase == 'resolved' && player.effect.inverting != null)
			makeNext().innerText = `Inverting Confidence: ${player.effect.inverting}`;

		/* remove any remaining children */
		while (node.children.length > count)
			node.lastChild.remove();
	}

	/* remove the remaining children */
	while (_game.htmlScoreContent.children.length > list.length)
		_game.htmlScoreContent.lastChild.remove();
};
