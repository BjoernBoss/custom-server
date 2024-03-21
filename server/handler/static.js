import * as libLog from "../log.js";
import * as libTemplates from "../templates.js";
import * as libConfig from "../config.js";
import * as libHttp from "../http.js"
import * as libPath from "path";
import * as libFs from "fs";

export const StaticSubPath = '/static';

function ListDirectory(msg, filePath) {
	var content = libFs.readdirSync(filePath);

	/* cleanup the path to end in a slash */
	var dirPath = msg.url.pathname;
	if (!dirPath.endsWith('/'))
		dirPath = dirPath + '/';

	/* check if the parent directory should be added */
	if (dirPath != StaticSubPath + '/')
		content = ['..'].concat(content);

	/* check if entries have been found */
	var entries = '';
	if (content.length > 0) {
		/* extract the entry-template to be used */
		const teEntry = libTemplates.Load(libTemplates.ListDir.entry);

		/* expand all entries */
		for (var i = 0; i < content.length; ++i) {
			var childPath = dirPath + content[i];

			/* check if this is the parent-entry and make the path cleaner (skip the last slash) */
			if (content[i] == '..')
				childPath = dirPath.substr(0, dirPath.lastIndexOf('/', dirPath.length - 2));

			entries += libTemplates.Expand(teEntry, {
				path: childPath,
				name: content[i]
			});
		}
	}
	else
		entries = libTemplates.LoadExpanded(libTemplates.ListDir.empty, {});

	/* update the path to not contain the trailing slash */
	if (dirPath != '/')
		dirPath = dirPath.substr(0, dirPath.length - 1);

	/* construct the final template and return it */
	const out = libTemplates.LoadExpanded(libTemplates.ListDir.base, { path: dirPath, entries });
	msg.respondHtml(out);
}

export function HandleStatic(msg) {
	libLog.Log(`Static handler for [${msg.url.pathname}]`);

	/* expand the path */
	const relativePath = (msg.url.pathname == StaticSubPath ? '/' : msg.url.pathname.substr(StaticSubPath.length));
	const filePath = libPath.join(libConfig.StaticPath, '.' + relativePath);

	/* ensure the request is using the Get-method */
	if (!msg.ensureMethod(['GET']))
		return;

	/* check if the path exists in the filesystem */
	if (libFs.existsSync(filePath)) {
		const what = libFs.lstatSync(filePath);

		/* check if the path is a file */
		if (what.isFile()) {
			msg.respondFile(filePath);
			return;
		}

		/* check if the path is a directory */
		else if (what.isDirectory()) {
			ListDirectory(msg, filePath);
			return;
		}
	}

	/* add the not found error */
	libLog.Log(`Request to unknown resource`);
	msg.respondNotFound();
}
