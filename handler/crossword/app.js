/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2025 Bjoern Boss Henrichsen */
import * as libLog from "../../server/log.js";
import * as libPath from "path";
import * as libFs from "fs";
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

	/* write the grid to the file */
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
		msg.respondFile(fileRelative('static/main.html'), false);
		return;
	}
	if (msg.relative == '/editor') {
		msg.respondFile(fileRelative('static/editor.html'), false);
		return;
	}

	/* check if the games are queried */
	if (msg.relative == '/games') {
		QueryGames(msg);
		return;
	}

	/* respond to the request by trying to server the file */
	msg.tryRespondFile(fileRelative('static' + msg.relative), false);
}
