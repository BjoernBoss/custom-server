let _game = {};

window.onload = function () {
	/* login-screen html components */
	_game.htmlLogin = document.getElementById('login');
	_game.htmlName = document.getElementById('name');
	_game.htmlTeam = document.getElementById('team');
	_game.htmlWarning = document.getElementById('warning');
	_game.htmlWarningText = document.getElementById('warning-text');

	/* caption/footer components */
	_game.htmlMain = document.getElementById('main');
	_game.htmlSelfName = document.getElementById('self-name');
	_game.htmlSelfTeam = document.getElementById('self-team');
	_game.htmlCategory = document.getElementById('category');
	_game.htmlQuestion = document.getElementById('question');
	_game.htmlScore = document.getElementById('score');
	_game.htmlTeamScore = document.getElementById('team-score');
	_game.htmlTeamDetails = document.getElementById('team-details');
	_game.htmlRound = document.getElementById('round');
	_game.htmlReady = document.getElementById('ready');
	_game.htmlConfidence = document.getElementById('confidence');
	_game.htmlDelta = document.getElementById('delta');

	/* splash-screen components */
	_game.htmlSplashScreen = document.getElementById('splash-screen');
	_game.htmlSplashMessage = document.getElementById('splash-message');

	/* gameplay components */
	_game.htmlGameScreen = document.getElementById('game-screen');
	_game.htmlGameLock = document.getElementById('game-lock');
	_game.htmlGameContent = document.getElementById('game-content');

	/* select components */
	_game.htmlSelectScreen = document.getElementById('select-screen');
	_game.htmlSelectText = document.getElementById('select-text');
	_game.htmlSelectContent = document.getElementById('select-content');

	/* setup components */
	_game.htmlSetupScreen = document.getElementById('setup-screen');
	_game.htmlSetupLock = document.getElementById('setup-lock');
	_game.htmlConfidenceSelect = document.getElementById('confidence-select');
	_game.htmlConfidenceValue = document.getElementById('confidence-value');
	_game.htmlConfidenceSlider = document.getElementById('confidence-slider');
	_game.htmlDoubleOrNothing = document.getElementById('double-or-nothing');
	_game.htmlExposeRound = document.getElementById('expose-round');
	_game.htmlExposeBuy = document.getElementById('expose-buy');
	_game.htmlSkipRound = document.getElementById('skip-round');
	_game.htmlSkipBuy = document.getElementById('skip-buy');
	_game.htmlForceRound = document.getElementById('force-round');
	_game.htmlForceBuy = document.getElementById('force-buy');
	_game.htmlInvertRound = document.getElementById('invert-round');
	_game.htmlInvertBuy = document.getElementById('invert-buy');

	/* score components */
	_game.htmlScoreScreen = document.getElementById('score-screen');
	_game.htmlScoreContent = document.getElementById('score-content');
	_game.htmlToggleBoard = document.getElementById('toggle-board');

	/* setup the overall state */
	_game.state = {};
	_game.name = '';
	_game.team = '';
	_game.playing = false;
	_game.questions = [];
	_game.selectDescription = '';
	_game.selectCallback = null;
	_game.viewScore = false;
	_game.totalPlayerCount = 0;
	_game.cost = {
		doubleOrNothing: {
			cost: 5,
			rounds: 5
		},
		exposed: {
			cost: 3,
			rounds: 2
		},
		skipping: {
			cost: 2,
			rounds: 4,
		},
		forcing: {
			cost: 2,
			rounds: 4,
		},
		inverting: {
			cost: 2,
			rounds: 4,
		}
	};

	/* download the questions */
	fetch('/quiz-game/categorized-questions.json')
		.then((resp) => resp.json())
		.then(function (resp) {
			_game.questions = resp;
			_game.applyState();
		});

	/* setup the web-socket */
	let url = new URL(document.URL);
	let protocol = (url.protocol.startsWith('https') ? 'wss' : 'ws');
	_game.sock = {
		ws: null,
		url: `${protocol}://${url.host}/quiz-game/ws-client`,
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
		_game.failed('Unable to establish a connection to the server!');
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
		_game.syncState(false, true);
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

		switch (msg.code) {
			case 'ok':
				break;
			case 'state':
				_game.state = msg;
				_game.applyState();
				break;
			default:
				console.log(`Unexpected message: ${msg.code}`);
				_game.failed('An unknown error occurred!');
				break;
		}

		/* check if the next message should be sent */
		_game.syncState(true, false);
	} catch (e) {
		console.log(`Error while handling message: ${e}`);
		_game.restartConnection();
	}
};
_game.selfChanged = function () {
	_game.applyState();
	_game.syncState(false, false);
}
_game.syncState = function (checking, fetchOnly) {
	if (!checking)
		_game.sock.dirty = true;
	else if (!_game.sock.dirty)
		return;

	/* check if the socket is ready to send data */
	if (_game.sock.state != 'ready')
		return;
	_game.sock.state = 'busy';
	_game.sock.dirty = false;

	/* check if the data only need to be fetched */
	if (!_game.playing || fetchOnly) {
		console.log('fetching state...');
		_game.sock.ws.send(JSON.stringify({ cmd: 'state' }));
	}

	/* upload the current player-state */
	else {
		console.log('synchronizing state...');
		_game.sock.ws.send(JSON.stringify({
			cmd: 'update',
			name: _game.name,
			value: _game.state.players[_game.name]
		}));
	}
};
_game.applyState = function () {
	if (_game.name == '')
		return;
	console.log('Applying received state');

	/* fetch the total playercount and team-score */
	_game.totalPlayerCount = 0;
	let teamScores = {};
	for (const key in _game.state.players) {
		++_game.totalPlayerCount;
		let team = _game.state.players[key].team;
		if (team.length == 0)
			continue;
		if (!(team in teamScores))
			teamScores[team] = 0;
		teamScores[team] += _game.state.players[key].score;
	}

	/* check if the player has been reset */
	if (_game.playing && !(_game.name in _game.state.players)) {
		_game.failed('Player has been reset');
		return;
	}

	/* check if the player has started to play */
	if (!_game.playing) {
		_game.playing = true;
		if (!(_game.name in _game.state.players)) {
			_game.state.players[_game.name] = {
				team: _game.team,
				score: 0,
				actual: 0,
				ready: false,
				confidence: 1,
				choice: -1,
				correct: false,
				delta: 0,
				effect: {
					doubleOrNothing: false,
					exposed: false,
					skipping: null,
					forcing: null,
					inverting: null,
				},
				last: {
					doubleOrNothing: null,
					expose: null,
					skipping: null,
					forcing: null,
					inverting: null,
				},
			};
			_game.syncState(false, false);
		}
	}

	/* check if the team needs to be updated */
	if (_game.team != _game.state.players[_game.name].team) {
		_game.state.players[_game.name].team = _game.team;
		_game.syncState(false, false);
	}

	/* fetch the current game-state */
	let self = _game.state.players[_game.name];
	let current = ['start', 'done'].includes(_game.state.phase) ? null : _game.questions[_game.state.question];

	/* construct the header and footer */
	_game.applyHeaderAndFooter(self, current, teamScores);

	/* check if the scoreboard is currently being viewed */
	if (_game.viewScore) {
		_game.applyScore(current, teamScores);
		return;
	}
	_game.htmlToggleBoard.innerText = 'Board';
	_game.htmlReady.classList.remove('hidden');

	/* check if a player is to be selected for an operation */
	if (self.ready || _game.state.phase != 'category')
		_game.selectDescription = '';
	else if (_game.selectDescription.length > 0) {
		_game.applySelection();
		return;
	}

	/* check if the splash-screen needs to be shown */
	if (current == null)
		_game.applySplashScreen();

	/* check if the question-screen needs to be constructed */
	else if (_game.state.phase == 'answer' || _game.state.phase == 'resolved')
		_game.applyQuestion(self, current);

	/* setup the category/effect setup screen */
	else
		_game.applySetup(self);
};
_game.doEffect = function (name, buy, value) {
	let self = _game.state.players[_game.name];
	if (self.ready || _game.state.phase != 'category')
		return false;
	if (self.effect[name] !== false && self.effect[name] !== null)
		return false;
	if (!buy && self.last[name] != null && (_game.state.round - self.last[name]) < _game.cost[name].rounds)
		return false;
	if (buy && self.actual < _game.cost[name].cost)
		return false;

	if (value != null) {
		self.last[name] = _game.state.round;
		if (buy)
			self.actual -= _game.cost[name].cost;
		self.effect[name] = value;
	}
	return true;
};

/* applying-state functions */
_game.applyHeaderAndFooter = function (self, current, teamScores) {
	/* update the current score and category */
	_game.htmlSelfName.innerText = `Name: ${_game.name}`;
	_game.htmlScore.innerText = `Score: ${self.actual}`;
	if (_game.team.length > 0) {
		_game.htmlSelfTeam.innerText = `Team: ${_game.team}`;
		_game.htmlTeamScore.innerText = `Team-Score: ${teamScores[_game.team]}`;
		_game.htmlTeamDetails.classList.remove('hidden');
	}
	else
		_game.htmlTeamDetails.classList.add('hidden');
	_game.htmlRound.innerText = `Round: ${_game.state.round + 1}`;
	_game.htmlConfidence.innerText = `Confidence: ${self.confidence}`;
	if (current == null) {
		_game.htmlCategory.classList.add('hidden');
		_game.htmlQuestion.classList.add('hidden');
	}
	else {
		_game.htmlCategory.classList.remove('hidden');
		_game.htmlCategory.innerText = `Category: ${current.category}`;

		if (_game.state.phase != 'category' || self.effect.exposed) {
			_game.htmlQuestion.classList.remove('hidden');
			_game.htmlQuestion.innerText = current.desc;
		}
		else
			_game.htmlQuestion.classList.add('hidden');
	}

	/* update the points-delta */
	if (_game.state.phase == 'resolved') {
		_game.htmlDelta.classList.remove('hidden');
		if (self.delta < 0)
			_game.htmlDelta.innerText = `Points: ${self.delta}`;
		else
			_game.htmlDelta.innerText = `Points: +${self.delta}`;
	}
	else
		_game.htmlDelta.classList.add('hidden');

	/* update the ready-state of the ready-button */
	if (self.ready || _game.state.phase == 'done' || _game.totalPlayerCount < 2)
		_game.htmlReady.classList.add('disabled');
	else
		_game.htmlReady.classList.remove('disabled');

	/* count the number of ready players */
	let readyCount = 0;
	for (const key in _game.state.players) {
		if (_game.state.players[key].ready)
			++readyCount;
	}
	_game.htmlReady.children[0].children[0].innerText = `Ready (${readyCount} / ${_game.totalPlayerCount})`;
};
_game.applyScore = function (current, teamScores) {
	_game.screen('score');
	_game.htmlToggleBoard.innerText = 'Return to Game';
	_game.htmlReady.classList.add('hidden');

	/* collect the list of all players and sort them by their score */
	let list = [];
	for (const key in _game.state.players)
		list.push([key, _game.state.players[key].score]);
	list.sort((a, b) => (a[1] < b[1] ? 1 : -1));

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
		makeNext().innerText = `Name: ${list[i][0]}` + (player.team.length == 0 ? '' : ` (Team: ${player.team})`);
		makeNext().innerText = `Score: ${player.score}` + (player.team.length == 0 ? '' : ` (Team-Score: ${teamScores[player.team]})`);
		makeNext().innerText = `Ready: ${player.ready ? 'True' : 'False'}`;

		/* add the result */
		if (_game.state.phase == 'resolved') {
			let next = makeNext();
			if (_game.choice == -1)
				next.innerText = `Result: None`;
			else
				next.innerText = `Result: ${current.text[player.choice]} (${player.correct ? 'Correct' : 'Incorrect'})`;
		}

		/* add the delta */
		if (_game.state.phase == 'resolved')
			makeNext().innerText = `Delta: ${player.delta < 0 ? '' : '+'}${player.delta}`;

		/* add the confidence */
		if (_game.state.phase == 'resolved')
			makeNext().innerText = `Confidence: ${player.confidence}`;

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
_game.applySelection = function () {
	_game.screen('select');
	_game.htmlSelectText.innerText = _game.selectDescription;

	/* collect the list of all players and sort them by their score */
	let list = [];
	for (const key in _game.state.players) {
		if (key != _game.name && (_game.team.length == 0 || _game.state.players[key].team != _game.team))
			list.push([key, _game.state.players[key].score]);
	}
	list.sort((a, b) => (a[1] < b[1] ? 1 : -1));

	/* add the list of players */
	for (let i = 0; i < list.length; ++i) {
		/* check if the element already exists or needs to be created ([0/1] is text/cancel) */
		if (2 + i >= _game.htmlSelectContent.children.length) {
			let node = document.createElement('div');
			_game.htmlSelectContent.appendChild(node);
			node.classList.add('button');
			let inner = document.createElement('div');
			node.appendChild(inner);
			inner.classList.add('clickable');
			inner.appendChild(document.createElement('p'));
			let sub = document.createElement('p');
			inner.appendChild(sub);
			sub.classList.add('sub');
		}
		let node = _game.htmlSelectContent.children[i + 2];

		/* add the name and score and callback */
		let player = _game.state.players[list[i][0]];
		node.children[0].children[0].innerText = list[i][0] + (player.team.length == 0 ? '' : ` (Team: ${player.team})`);
		node.children[0].children[1].innerText = `Score: ${list[i][1]}`;
		node.children[0].onclick = () => _game.pick(list[i][0]);
	}

	/* remove the remaining children */
	while (_game.htmlSelectContent.children.length > 2 + list.length)
		_game.htmlSelectContent.lastChild.remove();
};
_game.applySplashScreen = function () {
	_game.screen('splash');
	if (_game.state.phase == 'start')
		_game.htmlSplashMessage.innerText = 'Ready up to start playing!';
	else
		_game.htmlSplashMessage.innerText = 'Game Over!';
};
_game.applyQuestion = function (self, current) {
	_game.screen('game');

	/* update the ready-visibility */
	if (self.ready)
		_game.htmlGameLock.classList.remove('hidden');
	else
		_game.htmlGameLock.classList.add('hidden');

	/* add the options based on the selection and result */
	for (let i = 0; i < current.text.length; ++i) {
		/* check if the element already exists or needs to be created ([0] is lock-overlay) */
		if (1 + i >= _game.htmlGameContent.children.length) {
			let node = document.createElement('div');
			_game.htmlGameContent.appendChild(node);
			node.classList.add('button');
			let inner = document.createElement('div');
			node.appendChild(inner);
			inner.classList.add('clickable');
			inner.onclick = () => _game.choose(i);
			inner.appendChild(document.createElement('p'));
		}
		let node = _game.htmlGameContent.children[i + 1];

		/* setup the selection-index */
		if (self.choice == i)
			node.classList.add('selected');
		else
			node.classList.remove('selected');

		/* setup the disabled-index */
		if (_game.state.phase == 'resolved')
			node.classList.add('disabled');
		else
			node.classList.remove('disabled');

		/* setup the result colors */
		if (_game.state.phase == 'answer') {
			node.classList.remove('invalid');
			node.classList.remove('correct');
		}
		else if (current.correct == i) {
			node.classList.remove('invalid');
			node.classList.add('correct');
		}
		else {
			node.classList.remove('correct');
			node.classList.add('invalid');
		}

		/* add the actual text content */
		node.children[0].children[0].innerText = current.text[i];
	}

	/* remove the remaining children */
	while (_game.htmlGameContent.children.length > 1 + current.text.length)
		_game.htmlGameContent.lastChild.remove();
};
_game.applySetup = function (self) {
	_game.screen('setup');

	/* update the setup ready-screen */
	if (self.ready)
		_game.htmlSetupLock.classList.remove('hidden');
	else
		_game.htmlSetupLock.classList.add('hidden');

	/* update the confidence slider */
	_game.htmlConfidenceValue.innerText = `Confidence: ${self.confidence}`;
	for (let i = 0; i < 5; ++i)
		_game.htmlConfidenceSelect.classList.remove(`value${i}`);
	_game.htmlConfidenceSelect.classList.add(`value${self.confidence}`);
	_game.htmlConfidenceSlider.value = self.confidence;

	/* update the exposed button */
	_game._applyEffect('doubleOrNothing', false, _game.htmlDoubleOrNothing);
	_game._applyEffect('exposed', false, _game.htmlExposeRound);
	_game._applyEffect('exposed', true, _game.htmlExposeBuy);
	_game._applyEffect('skipping', false, _game.htmlSkipRound);
	_game._applyEffect('skipping', true, _game.htmlSkipBuy);
	_game._applyEffect('forcing', false, _game.htmlForceRound);
	_game._applyEffect('forcing', true, _game.htmlForceBuy);
	_game._applyEffect('inverting', false, _game.htmlInvertRound);
	_game._applyEffect('inverting', true, _game.htmlInvertBuy);
};
_game._applyEffect = function (name, buy, html) {
	let can = _game.doEffect(name, buy, null);

	if (can)
		html.classList.remove('disabled');
	else
		html.classList.add('disabled');

	let self = _game.state.players[_game.name];
	if (typeof (self.effect[name]) == 'string')
		html.children[0].children[1].innerText = `Selected: ${self.effect[name]}`;
	else if (buy)
		html.children[0].children[1].innerText = `Costs ${_game.cost[name].cost} Points`;
	else if (can)
		html.children[0].children[1].innerText = `Every ${_game.cost[name].rounds} Rounds`;
	else
		html.children[0].children[1].innerText = `Again in ${self.last[name] + _game.cost[name].rounds - _game.state.round} Rounds`;
};

/* called from/for html */
_game.screen = function (name) {
	_game.htmlLogin.classList.add('hidden');
	_game.htmlMain.classList.add('hidden');
	_game.htmlSplashScreen.classList.add('hidden');
	_game.htmlSetupScreen.classList.add('hidden');
	_game.htmlGameScreen.classList.add('hidden');
	_game.htmlSelectScreen.classList.add('hidden');
	_game.htmlScoreScreen.classList.add('hidden');

	if (name == 'login')
		_game.htmlLogin.classList.remove('hidden');
	else {
		_game.htmlMain.classList.remove('hidden');
		if (name == 'splash')
			_game.htmlSplashScreen.classList.remove('hidden');
		else if (name == 'setup')
			_game.htmlSetupScreen.classList.remove('hidden');
		else if (name == 'game')
			_game.htmlGameScreen.classList.remove('hidden');
		else if (name == 'select')
			_game.htmlSelectScreen.classList.remove('hidden');
		else if (name == 'score')
			_game.htmlScoreScreen.classList.remove('hidden');
	}
}
_game.failed = function (msg) {
	_game.screen('login');
	_game.htmlWarning.classList.remove('hidden');
	_game.htmlWarningText.innerText = msg;
	_game.playing = false;
	_game.selectDescription = '';
	_game.viewScore = false;
	_game.name = '';
	_game.team = '';
};
_game.login = function () {
	/* validate the name and the team */
	if (_game.htmlName.value == '') {
		_game.failed('Please Enter a Name');
		return;
	}

	/* check if the server connection exists */
	if (_game.sock.state != 'ready' && _game.sock.state != 'busy') {
		if (_game.sock.state == 'failed') {
			_game.failed('Retrying to connect to server. Try again later...');
			_game.sock.connectionFailedDelay = 256;
			_game.setupConnection();
		}
		else
			_game.failed('Connecting to server. Try again later...');
		return;
	}

	/* extract the parameter and sync the game up */
	_game.name = _game.htmlName.value.trim();
	_game.team = _game.htmlTeam.value.trim();
	_game.syncState(false, true);
};
_game.ready = function () {
	let self = _game.state.players[_game.name];
	if (self.ready || _game.state.phase == 'done' || _game.totalPlayerCount < 2)
		return;

	self.ready = true;
	_game.selfChanged();
};
_game.toggleScore = function () {
	if (_game.name == '')
		return;
	_game.viewScore = !_game.viewScore;
	_game.applyState();
};
_game.confidence = function (v) {
	let self = _game.state.players[_game.name];
	if (self.ready || _game.state.phase != 'category')
		return;

	self.confidence = Number(v);
	_game.selfChanged();
};
_game.choose = function (v) {
	let self = _game.state.players[_game.name];
	if (self.ready || _game.state.phase != 'answer')
		return;

	self.choice = v;
	self.correct = (self.choice == _game.questions[_game.state.question].correct);
	_game.selfChanged();
};
_game.effect = function (name, buy) {
	let value = null;
	if (name == 'exposed' || name == 'doubleOrNothing')
		value = true;

	if (!_game.doEffect(name, buy, value))
		return;
	if (value != null) {
		_game.selfChanged();
		return;
	}

	if (name == 'skipping')
		_game.selectDescription = 'Select Enemy to be Skipped';
	else if (name == 'forcing')
		_game.selectDescription = 'Select Enemy to be Forced to Full Confidence';
	else if (name == 'inverting')
		_game.selectDescription = 'Select Enemy to Invert the Confidence Of';

	_game.selectCallback = function (v) {
		_game.doEffect(name, buy, v);
		_game.selfChanged();
	};
	_game.applyState();
};
_game.pick = function (v) {
	/* select-callback will automatically apply state */
	_game.selectDescription = '';
	_game.selectCallback(v);
};
_game.remove = function () {
	if (_game.sock.state != 'ready' && _game.sock.state != 'busy') {
		_game.failed('Network issue while removing player');
	}
	else {
		_game.sock.ws.send(JSON.stringify({ cmd: 'update', name: _game.name }));
		_game.state.players[_game.name] = undefined;
		_game.failed('Player has been removed');
	}
};