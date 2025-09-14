/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2025 Bjoern Boss Henrichsen */
import * as libLog from "../../server/log.js";
import * as libPath from "path";
import * as libFs from "fs";
import * as libCrypto from "crypto";
import { StringDecoder } from "string_decoder";

function fileRelative(path) {
	/* workaround! (7 => file://) */
	const dirName = import.meta.dirname ?? libPath.dirname(import.meta.url.slice(7));
	if (path.startsWith('/'))
		return libPath.join(dirName, '.' + path);
	if (!path.startsWith('./'))
		return libPath.join(dirName, './' + path);
	return libPath.join(dirName, path);
}

let gameState = {};

class ActiveGame {
	constructor(name, filePath) {
		this.ws = {};
		this.grid = null;
		this.name = name;
		this.filePath = filePath;
		this.queued = null;
		this.writebackFailed = false;
		this.nextId = 0;

		/* fetch the initial data */
		try {
			const file = libFs.readFileSync(this.filePath, { encoding: 'utf-8', flag: 'r' });
			this.grid = JSON.parse(file);
		}
		catch (e) {
			libLog.Error(`Failed to read the current game state: ${e.message}`);
		}
	}

	_notifyAll() {
		let out = {
			failed: this.writebackFailed,
			grid: this.grid,
			names: [],
			online: []
		};

		/* collect the online names */
		let online = {}, names = {};
		for (const id in this.ws) {
			const name = this.ws[id].name;
			if (name == '') continue;

			/* add the name to the list of objects */
			if (!(name in online)) {
				online[name] = 1;
				out.online.push(name);
			}
			if (!(name in names)) {
				names[name] = 1;
				out.names.push(name);
			}
		}

		/* collect all already used names in the grid */
		if (this.grid != null) {
			for (let i = 0; i < this.grid.length; ++i) {
				if (this.grid[i].author in names) continue;
				names[this.grid[i].author] = true;
				out.names.push(this.grid[i].author);
			}
		}

		/* send the data to all clients */
		const json = JSON.stringify(out);
		for (const id in this.ws)
			this.ws[id].ws.send(json);
	}
	_queueWriteBack() {
		if (this.grid == null) return;

		/* kill the last queue */
		if (this.queued != null)
			clearTimeout(this.queued);
		this.queued = setTimeout(() => this._writeBack(false), 10_000);
	}
	_writeBack(final) {
		/* check if the data are dirty */
		if (this.queued == null) return;
		clearTimeout(this.queued);
		this.queued = null;

		const tempPath = libPath.join(libPath.dirname(this.filePath), libCrypto.randomUUID());
		let written = false;
		try {
			/* try to write the data back to a temporary file */
			libLog.Log(`Creating temporary file [${tempPath}] for [${this.filePath}]`);
			libFs.writeFileSync(tempPath, JSON.stringify(this.grid), { encoding: 'utf-8', flag: 'wx' });
			written = true;

			/* replace the existing file */
			libLog.Log(`Replacing file [${this.filePath}]`);
			libFs.renameSync(tempPath, this.filePath);
			this.writebackFailed = false;
			return;
		}
		catch (e) {
			if (written)
				libLog.Error(`Failed to replace original file [${this.filePath}]: ${e.message}`);
			else
				libLog.Error(`Failed to write to temporary file [${tempPath}]: ${e.message}`);
		}

		/* remove the temporary file */
		try {
			libFs.unlinkSync(tempPath);
		}
		catch (e) {
			libLog.Error(`Failed to remove temporary file [${tempPath}]: ${e.message}`);
		}

		/* check if the changes should be discarded */
		if (final)
			libLog.Warning(`Discarding write-back as state is lost`);
		else
			this._queueWriteBack();

		/* notify about the failed write-back */
		if (!this.writebackFailed)
			this._notifyAll();
		this.writebackFailed = true;
	}
	updateGrid(grid) {
		let valid = (this.grid != null && this.grid.length == grid.length);

		/* validate the grid structure */
		if (valid) {
			for (let i = 0; i < this.grid.length; ++i) {
				if (this.grid[i].solid == grid[i].solid && typeof grid[i].char == 'string' && typeof grid[i].certain == 'boolean' && typeof grid[i].author == 'string')
					continue;
				valid = false;
				break;
			}
		}

		/* check if the grid data are valid and otherwise silently discard the changes */
		if (!valid) {
			libLog.Log(`Silently discarding grid changes of [${this.filePath}]`);
			return;
		}

		/* update the grid and notify the listeners about the change */
		this.grid = grid;
		this._notifyAll();
		this._queueWriteBack();
	}
	updateName(id, name) {
		if (this.ws[id].name == name) return;

		/* update the name and notify the other sockets */
		this.ws[id].name = name;
		this._notifyAll();
	}
	drop(id) {
		/* remove the web-socket from the open connections */
		let name = this.ws[id].name;
		delete this.ws[id];

		/* check if this was the last listener and the object can be unloaded */
		if (Object.keys(this.ws) == 0) {
			this._writeBack(true);
			delete gameState[this.name];
			return;
		}

		/* check if other listeners should be notified */
		if (name.length > 0)
			this._notifyAll();
	}
	register(ws) {
		this.ws[++this.nextId] = { ws: ws, name: '' };
		return this.nextId;
	}
}

const nameRegex = '[a-zA-Z0-9]([-_.]?[a-zA-Z0-9])*';
const nameMaxLength = 255;

function ParseAndValidateGame(data) {
	/* parse the json content */
	let obj = null;
	try {
		obj = JSON.parse(data);
	}
	catch (e) {
		throw new Error('Malformed JSON encountered');
	}

	/* validate the overall structure */
	if (typeof obj != 'object')
		throw new Error('Malformed object');
	if (typeof obj.width != 'number' || typeof obj.height != 'number'
		|| !isFinite(obj.width) || obj.width <= 0 || obj.width > 64
		|| !isFinite(obj.height) || obj.height <= 0 || obj.height > 64)
		throw new Error('Malformed Dimensions');

	/* validate the grid */
	try {
		if (obj.grid.length !== obj.width * obj.height)
			throw 'err';
		for (let i = 0; i < obj.width * obj.height; ++i) {
			if (typeof obj.grid[i] != 'boolean')
				throw 'err';
		}
	} catch (e) {
		throw new Error('Malformed Grid');
	}

	/* patch the object to contain all necessary meta data */
	for (let i = 0; i < obj.grid.length; ++i) {
		obj.grid[i] = {
			solid: obj.grid[i],
			char: '',
			certain: false,
			author: ''
		};
	}
	return obj;
}
function ModifyGame(msg) {
	/* validate the method */
	const method = msg.ensureMethod(['POST', 'DELETE']);
	if (method == null)
		return;

	/* extract the name */
	let name = msg.relative.slice(6);
	if (!name.match(nameRegex) || name.length > nameMaxLength) {
		msg.respondNotFound();
		return;
	}
	libLog.Log(`Handling Game: [${name}] as [${method}]`);
	const filePath = fileRelative(`games/${name}.json`);

	/* check if the game is being removed */
	if (method == 'DELETE') {
		if (!libFs.existsSync(filePath))
			msg.respondNotFound();
		else try {
			libFs.unlinkSync(filePath);
			libLog.Log(`Game file: [${filePath}] deleted successfully`);
			msg.respondOk('delete');
		} catch (e) {
			libLog.Error(`Error while removing file [${filePath}]: ${e.message}`);
			msg.tryRespondInternalError('File-System error removing the game');
		}
		return;
	}

	/* a game must be uploaded */
	if (libFs.existsSync(filePath)) {
		msg.respondConflict('already exists');
		return;
	}

	/* validate the content type */
	if (msg.ensureMediaType(['application/json']) == null)
		return;

	/* validate the content length */
	if (!msg.ensureContentLength(1_000_000))
		return;

	/* collect all of the data */
	const decoder = new StringDecoder('utf-8');
	let body = '';
	msg.request.on('data', (data) => {
		body += decoder.write(data);
	});
	msg.request.on('end', () => {
		body += decoder.end();

		/* parse the data */
		let parsed = null;
		try {
			parsed = ParseAndValidateGame(body);
		} catch (e) {
			libLog.Error(`Error while parsing the game: ${e.message}`);
			msg.respondBadRequest(e.message);
			return;
		}

		/* serialize the data to the file and write it out */
		try {
			libFs.writeFileSync(filePath, JSON.stringify(parsed), { encoding: 'utf-8', flag: 'wx' });
		}
		catch (e) {
			libLog.Error(`Error while writing the game out: ${e.message}`);
			msg.tryRespondInternalError('File-System error storing the game');
			return;
		}

		/* validate the post content */
		msg.respondOk('upload');
	});
	msg.request.on('error', (err) => {
		libLog.Error(`Error occurred while posting to [${filePath}]: ${err.message}`);
		msg.tryRespondInternalError('Network issue regarding the post payload');
	});
}
function QueryGames(msg) {
	let content = [];
	try {
		content = libFs.readdirSync(fileRelative('games'));
	}
	catch (e) {
		libLog.Error(`Error while reading directory content: ${e.message}`);
	}
	let out = [];

	/* collect them all out */
	libLog.Log(`Querying list of all registered games: [${content}]`);
	for (const name of content) {
		if (!name.endsWith('.json'))
			continue;
		let actual = name.slice(0, name.length - 5);
		if (!actual.match(nameRegex) || actual.length > nameMaxLength)
			continue;
		out.push(name.slice(0, name.length - 5));
	}

	/* return them to the request */
	msg.respondJson(JSON.stringify(out));
}
function AcceptWebSocket(msg) {
	/* extract the name and validate it */
	let name = msg.relative.slice(4);
	if (!name.match(nameRegex) || name.length > nameMaxLength) {
		msg.respondNotFound();
		return;
	}
	libLog.Log(`Handling WebSocket to: [${name}]`);
	const filePath = fileRelative(`games/${name}.json`);

	/* check if the game exists */
	if (!libFs.existsSync(filePath)) {
		msg.respondNotFound();
		return;
	}

	/* try to establish the web-socket connection */
	const acceptable = msg.tryAcceptWebSocket(function (ws) {
		/* check if the game-state for the given name has already been set-up */
		if (!(name in gameState))
			gameState[name] = new ActiveGame(name, filePath);
		const id = gameState[name].register(ws);
		libLog.Log(`Registered websocket to: [${name}] as [${id}]`);

		/* define the alive callback */
		let isAlive = true, aliveInterval = null, queueAliveCheck = null;
		queueAliveCheck = function (alive) {
			/* update the alive-flag and kill the old timer */
			isAlive = alive;
			clearTimeout(aliveInterval);

			/* queue the check callback */
			aliveInterval = setTimeout(function () {
				if (!isAlive) {
					ws.close();
					aliveInterval = null;
				}
				else {
					queueAliveCheck(false);
					ws.ping();
				}
			}, 30_000);
		};

		/* initiate the alive-check */
		queueAliveCheck(true);

		/* register the web-socket callbacks */
		ws.on('pong', () => queueAliveCheck(true));
		ws.on('close', function () {
			gameState[name].drop(id);
			clearTimeout(aliveInterval);
			libLog.Log(`Socket [${id}] disconnected`);
		});
		ws.on('message', function (msg) {
			queueAliveCheck(true);

			/* parse the data */
			try {
				let parsed = JSON.parse(msg);
				libLog.Log(`Received for socket [${id}]: ${parsed.cmd}`);

				/* handle the command */
				if (parsed.cmd == 'name' && typeof parsed.name == 'string')
					gameState[name].updateName(id, parsed.name);
				else if (parsed.cmd == 'update')
					gameState[name].updateGrid(parsed.data);
			} catch (e) {
				libLog.Error(`Failed to parse web-socket response: ${e.message}`);
				ws.close();
			}
		});
	});
	if (!acceptable) {
		libLog.Warning(`Invalid request for web-socket point for game [${name}]`);
		msg.respondNotFound();
	}
}

export const SubPath = '/crossword';

export function Handle(msg) {
	libLog.Log(`Game handler for [${msg.relative}]`);

	/* check if a game is being manipulated */
	if (msg.relative.startsWith('/game/')) {
		ModifyGame(msg);
		return;
	}

	/* all other endpoints only support 'getting' */
	if (msg.ensureMethod(['GET']) == null)
		return;

	/* check if its a redirection and forward it accordingly */
	if (msg.relative == '/' || msg.relative == '/main') {
		msg.tryRespondFile(fileRelative('static/main.html'));
		return;
	}
	if (msg.relative == '/editor') {
		msg.tryRespondFile(fileRelative('static/editor.html'));
		return;
	}
	if (msg.relative == '/play') {
		msg.tryRespondFile(fileRelative('static/play.html'));
		return;
	}

	/* check if the games are queried */
	if (msg.relative == '/games') {
		QueryGames(msg);
		return;
	}

	/* check if a web-socket is connecting */
	if (msg.relative.startsWith('/ws/')) {
		AcceptWebSocket(msg);
		return;
	}

	/* respond to the request by trying to server the file */
	msg.tryRespondFile(fileRelative('static' + msg.relative));
}
