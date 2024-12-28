let _game = {};

window.onload = function () {
	/* fetch all relevant components */
	_game.htmlOptions = document.getElementById('options');
	_game.htmlScore = document.getElementById('score');
	_game.htmlHeader = document.getElementById('header');
	_game.htmlInitial = document.getElementById('initial');
	_game.htmlName = document.getElementById('name');
	_game.htmlWarning = document.getElementById('warning');
	_game.htmlWarningText = document.getElementById('warningText');
	_game.htmlLoginBasic = document.getElementById('loginBasic');
	_game.htmlLoginTakeOwnership = document.getElementById('loginTakeOwnership');

	/* setup the overall state */
	_game.state = {};
	_game.name = '';

	/* setup the web-socket */
	let url = new URL(document.URL);
	let protocol = (url.protocol.startsWith('https') ? 'wss' : 'ws');
	_game.sock = {
		ws: null,
		url: `${protocol}://${url.host}/quiz-game/ws-client`,
		queue: [],
		handling: false,
		state: 'creating',
		connectionFailedDelay: 256
	};
	_game.setupConnection();
};
window.onbeforeunload = function () { return "Your work will be lost."; };

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
_game.handleLogOff = function () {
	/* setup the warning screen */
	_game.htmlInitial.classList.remove('hidden');
	_game.htmlWarning.classList.remove('hidden');
	_game.htmlWarningText.innerText = 'Another player is using your name, you have been logged off!';
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
	for (let i = 0; i < _game.state.options.length; ++i) {
		/* check if the element already exists or needs to be created */
		if (i * 2 >= _game.htmlOptions.children.length) {
			if (i > 0) {
				let temp = document.createElement('div');
				temp.classList.add('separator');
				_game.htmlOptions.appendChild(temp);
			}

			let node = document.createElement('div');
			_game.htmlOptions.appendChild(node);
			node.classList.add('option');

			let inner = document.createElement('div');
			node.appendChild(inner);
			inner.classList.add('interact');
			inner.onclick = () => _game.selected(i);

			inner.appendChild(document.createElement('p'));
		}
		let node = _game.htmlOptions.children[2 * i];

		if (_game.state.choice == i)
			node.classList.add('selected');
		else
			node.classList.remove('selected');

		if (_game.state.correct == -1) {
			node.classList.remove('invalid');
			node.classList.remove('correct');
		}
		else if (_game.state.correct == i) {
			node.classList.remove('invalid');
			node.classList.add('correct');
		}
		else {
			node.classList.remove('correct');
			node.classList.add('invalid');
		}

		node.children[0].children[0].innerText = _game.state.options[i];

		/* update the enabled state */
		if (_game.state.open)
			node.children[0].classList.remove('disabled');
		else
			node.children[0].classList.add('disabled');
	}

	/* remove the remaining children */
	let count = 2 * _game.state.options.length - (_game.state.options.length == 0 ? 0 : 1);
	while (_game.htmlOptions.children.length > count) {
		_game.htmlOptions.lastChild.remove();
		if (count > 0)
			_game.htmlOptions.lastChild.remove();
	}

	/* update the overall option and score */
	if (_game.state.description == '')
		_game.htmlHeader.innerText = 'Question';
	else
		_game.htmlHeader.innerText = _game.state.description;
	_game.htmlScore.innerText = `Score: ${_game.state.score}`;
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
		_game.htmlWarningText.innerText = 'Please enter a name';
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
			_game.htmlWarningText.innerText = 'Unable to establish a connection to the server!';
		}
		else {
			_game.htmlLoginBasic.classList.remove('hidden');
			_game.htmlLoginTakeOwnership.classList.add('hidden');
			_game.htmlWarningText.innerText = 'Connection to server is being established...';
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
			_game.htmlWarningText.innerText = 'You have been logged off due to an error with the connection!';
			_game.htmlLoginBasic.classList.remove('hidden');
			_game.htmlLoginTakeOwnership.classList.add('hidden');
			_game.name = '';
		}
		else if (resp.code != 'inUse' && resp.code != 'alreadyExists') {
			console.log(`Unknown response code: ${resp.code} received`);
			_game.htmlWarningText.innerText = 'An unknown error occurred!';
			_game.htmlLoginBasic.classList.add('hidden');
			_game.htmlLoginTakeOwnership.classList.add('hidden');
		}
		else {
			if (resp.code == 'inUse')
				_game.htmlWarningText.innerText = 'There already exists a player with the same name. Do you want to log him off?';
			else
				_game.htmlWarningText.innerText = 'There has already existed a player with this name!';
			_game.htmlLoginBasic.classList.add('hidden');
			_game.htmlLoginTakeOwnership.classList.remove('hidden');
		}
	});
};
_game.selected = function (index) {
	if (!_game.state.open)
		return;

	/* send the change */
	console.log(`Selected: [${index}]`);
	_game.pushTask({ cmd: 'choice', index: index }, () => {
		_game.applyState();
	});
};
