/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
let _game = {};

window.onload = function () {
	/* fetch all relevant components */
	_game.htmlSelectOverlay = document.getElementById('select');
	_game.htmlOptions = [
		document.getElementById('option0'),
		document.getElementById('option1'),
		document.getElementById('option2'),
		document.getElementById('option3')
	];
	_game.htmlTexts = [
		document.getElementById('text0'),
		document.getElementById('text1'),
		document.getElementById('text2'),
		document.getElementById('text3')
	];
	_game.htmlInteract = [
		document.getElementById('interact0'),
		document.getElementById('interact1'),
		document.getElementById('interact2'),
		document.getElementById('interact3')
	];
	_game.htmlScore = document.getElementById('score');
	_game.htmlHeader = document.getElementById('header');
	_game.htmlInitial = document.getElementById('initial');
	_game.htmlName = document.getElementById('name');
	_game.htmlWarning = document.getElementById('warning');
	_game.htmlWarningText = document.getElementById('warningText');
	_game.htmlLoginBasic = document.getElementById('loginBasic');
	_game.htmlLoginTakeOwnership = document.getElementById('loginTakeOwnership');

	/* setup the overall state */
	_game.flagToIndex = { dk: 0, de: 1, kh: 2, hu: 3 };
	_game.indexToFlag = ['dk', 'de', 'kh', 'hu'];
	_game.state = {};
	_game.name = '';

	/* setup the web-socket */
	let url = new URL(document.URL);
	let protocol = (url.protocol.startsWith('https') ? 'wss' : 'ws');
	_game.sock = {
		ws: null,
		url: `${protocol}://${url.host}/wedding-game/ws-client`,
		queue: [],
		handling: false,
		state: 'creating',
		connectionFailedDelay: 256
	};
	_game.setupConnection();
};
window.onbeforeunload = function() { return "Your work will be lost."; };

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
				case 'loggedOff':
					_game.handleLogOff();
					_game.restartConnection();
					break;
				case 'dirty':
					_game.handleChange();
					break;
				default:
					if (_game.sock.queue.length == 0) {
						console.log(`Unsolicited message from server: [${msg.code}]`);
						return;
					}
					let next = _game.sock.queue.shift();
					next[1](msg);
					_game.sock.handling = false;

					/* queue the next task to be handled */
					_game.handleTask();
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
		if (_game.name != '')
			_game.login(true, false);
	};
	_game.sock.ws.onerror = function () {
		console.log('Failed to establish a connection to the server');
		_game.sock.ws.onclose = function() {};
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
_game.handleLogOff = function () {
	/* setup the warning screen */
	_game.htmlInitial.classList.remove('hidden');
	_game.htmlWarning.classList.remove('hidden');
	_game.htmlWarningText.innerText = 'Ein anderer Spieler hat sich mit Ihrem Namen angemeldet, und Sie abgemeldet!';
	_game.htmlLoginBasic.classList.remove('hidden');
	_game.htmlLoginTakeOwnership.classList.add('hidden');
	_game.name = '';
};
_game.handleChange = function () {
	/* queue the task to fetch the score */
	_game.pushTask({ cmd: 'state' }, (resp) => {
		if (resp.code != 'ok') {
			console.log(`Failed to fetch the current state: ${resp.code}`);
			setTimeout(() => _game.handleChange(), 1500);
			return;
		}
		_game.state = resp;
		_game.applyState();
	});
};
_game.applyState = function () {
	console.log('Applying received state');

	/* update the choices */
	for (let i = 0; i < 4; ++i) {
		_game.htmlOptions[i].classList.remove('dk');
		_game.htmlOptions[i].classList.remove('de');
		_game.htmlOptions[i].classList.remove('kh');
		_game.htmlOptions[i].classList.remove('hu');
		_game.htmlOptions[i].classList.remove('correct');
		_game.htmlOptions[i].classList.remove('invalid');
		if (_game.state.choices[i] != -1)
			_game.htmlOptions[i].classList.add(_game.indexToFlag[_game.state.choices[i]]);
		if (_game.state.correct[i] != -1)
			_game.htmlOptions[i].classList.add((_game.state.choices[i] == _game.state.correct[i]) ? 'correct' : 'invalid');
		if (_game.state.options[i] == '')
			_game.htmlTexts[i].innerText = `${i + 1}. Option`;
		else
			_game.htmlTexts[i].innerText = _game.state.options[i];

		/* update the enabled state */
		if (_game.state.open)
			_game.htmlInteract[i].classList.remove('disabled');
		else
			_game.htmlInteract[i].classList.add('disabled');
	}

	/* update the overall option and score */
	if (_game.state.description == '')
		_game.htmlHeader.innerText = 'Fragestellung';
	else
		_game.htmlHeader.innerText = _game.state.description;
	_game.htmlScore.innerText = `Punkte: ${_game.state.score}`;
};
_game.handleTask = function () {
	if (_game.sock.queue.length == 0 || _game.sock.handling)
		return;
	if (_game.sock.state != 'ready')
		return;
	console.log(`Sending task: ${_game.sock.queue[0][0].cmd}`)
	_game.sock.handling = true;
	_game.sock.ws.send(JSON.stringify(_game.sock.queue[0][0]));
}
_game.pushTask = function (cmd, callback) {
	_game.sock.queue.push([cmd, callback]);
	_game.handleTask();
}
_game.nameChanged = function () {
	_game.htmlWarning.classList.add('hidden');
	_game.htmlLoginBasic.classList.remove('hidden');
	_game.htmlLoginTakeOwnership.classList.add('hidden');
};
_game.login = function (takeOwnership, reset) {
	console.log('logging in...');

	/* check if an existing connection is being restarted */
	let name = '';
	if (_game.name != '') {
		/* check if the first command is already a login command */
		if (_game.sock.queue.length > 0 && _game.sock.queue[0][0].cmd == 'login')
			return;
		name = _game.name;
	}

	/* validate the name */
	else if (_game.htmlName.value == '') {
		_game.htmlWarning.classList.remove('hidden');
		_game.htmlWarningText.innerText = 'Bitte gib einen Namen ein';
		return;
	}
	else
		name = _game.htmlName.value;

	/* check if the state is ready */
	if (_game.sock.state != 'ready') {
		_game.htmlInitial.classList.remove('hidden');
		_game.htmlWarning.classList.remove('hidden');
		if (_game.sock.state == 'failed') {
			_game.htmlLoginBasic.classList.add('hidden');
			_game.htmlLoginTakeOwnership.classList.add('hidden');
			_game.htmlWarningText.innerText = 'Es konnte keine Verbindung zum Server aufgebaut werden!';
		}
		else {
			_game.htmlLoginBasic.classList.remove('hidden');
			_game.htmlLoginTakeOwnership.classList.add('hidden');
			_game.htmlWarningText.innerText = 'Verbindung zum Server wird aufgebaut...';
			setTimeout(() => _game.login(takeOwnership, reset), 150);
		}
		return;
	}

	/* queue the login-task */
	_game.pushTask({ cmd: 'login', name: name, takeOwnership: takeOwnership, resetState: reset }, (resp) => {
		if (resp.code == 'ok') {
			console.log('Logged in successfully');

			/* toggle to the main screen */
			_game.htmlInitial.classList.add('hidden');
			_game.name = name;
			_game.handleChange();
			return;
		}
		console.log(`Login failed: ${resp.code}`);

		/* setup the warning screen */
		_game.htmlInitial.classList.remove('hidden');
		_game.htmlWarning.classList.remove('hidden');

		/* kill the last login */
		if (_game.name != '') {
			_game.htmlWarningText.innerText = 'Aufgrund von einem Fehler bei der Verbindung wurden Sie abgemeldet!';
			_game.htmlLoginBasic.classList.remove('hidden');
			_game.htmlLoginTakeOwnership.classList.add('hidden');
			_game.name = '';
		}
		else if (resp.code != 'inUse' && resp.code != 'alreadyExists') {
			console.log(`Unknown response code: ${resp.code} received`);
			_game.htmlWarningText.innerText = 'Ein unbekannter Fehler ist aufgetreten!';
			_game.htmlLoginBasic.classList.add('hidden');
			_game.htmlLoginTakeOwnership.classList.add('hidden');
		}
		else {
			if (resp.code == 'inUse')
				_game.htmlWarningText.innerText = 'Es ist bereits ein Spieler mit diesem Namen angemeldet. Soll er abgemeldet werden?';
			else
				_game.htmlWarningText.innerText = 'Ein Spieler mit diesem Namen hat bereits einmal existiert!';
			_game.htmlLoginBasic.classList.add('hidden');
			_game.htmlLoginTakeOwnership.classList.remove('hidden');
		}
	});
};
_game.select = function (index) {
	/* check if a selection can be performed */
	if (!_game.state.open)
		return;

	/* mark the current object as being selected and show the select-overlay */
	_game.current = index;
	_game.htmlSelectOverlay.classList.remove('hidden');
};
_game.selected = function (name) {
	/* hide the select-overlay */
	_game.htmlSelectOverlay.classList.add('hidden');
	if (_game.current == -1 || name == '')
		return;

	/* send the change */
	console.log(`Selected: [${name}] for [${_game.current}]`);
	_game.pushTask({ cmd: 'choice', index: _game.current, value: _game.flagToIndex[name] }, () => {
		_game.applyState();
	});
	_game.current = -1;
};
