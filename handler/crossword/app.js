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

export const SubPath = '/crossword';

export function Handle(msg) {
	libLog.Log(`Game handler for [${msg.relative}]`);

	/* respond to the request by trying to server the file */
	msg.tryRespondFile(fileRelative('static' + msg.relative), false);
}
