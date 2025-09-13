import * as libLog from "../../server/log.js";
import * as libPath from "path";
import * as libFs from "fs";

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

function ModifyGame(msg) {
	/* validate the method */
	if (!msg.ensureMethod(['POST', 'DELETE']))
		return;

	/* extract the name */
	let name = msg.relative.slice(6);
	if (!name.match(nameRegex) || name.length > nameMaxLength) {
		msg.respondNotFound();
		return;
	}
	libLog.Log(`Handling Game: [${name}] as [${msg.request.method}]`);
	const filePath = fileRelative(`games/${name}.json`);

	/* check if the game is being removed */
	if (msg.request.method == 'DELETE') {
		if (!libFs.existsSync(filePath))
			msg.respondNotFound();
		else try {
			libFs.unlinkSync(filePath);
			libLog.Log(`Game file: [${filePath}] deleted successfully`);
			msg.respondOk('delete');
		} catch (e) {
			libLog.Error(`Error while removing file [${filePath}]: ${e.message}`);
			msg.tryRespondInternalError();
		}
		return;
	}

	/* a game must be uploaded */
	if (libFs.existsSync(filePath)) {
		msg.respondConflict('already exists');
		return;
	}

	/* validate the post content */

	msg.respondOk('upload');
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
	if (!msg.ensureMethod(['GET']))
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
