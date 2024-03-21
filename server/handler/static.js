import * as libLog from "../log.js";
import * as libTemplates from "../templates.js";
import * as libConfig from "../config.js";
import * as libHttp from "../http.js"
import * as libPath from "path";
import * as libFs from "fs";

export const StaticSubPath = '/static';

function ListDirectory(response, actualPath, relativePath) {
	var content = libFs.readdirSync(actualPath);

	/* cleanup the path to end in a slash */
	if (!relativePath.endsWith('/'))
		relativePath = relativePath + '/';

	/* check if the parent directory should be added */
	if (relativePath != '/')
		content = ['..'].concat(content);

	/* check if entries have been found */
	var entries = '';
	if (content.length > 0) {
		/* extract the entry-template to be used */
		const teEntry = libTemplates.Load(libTemplates.ListDir.entry);

		/* expand all entries */
		for (var i = 0; i < content.length; ++i) {
			var childPath = relativePath + content[i];

			/* check if this is the parent-entry and make the path cleaner (skip the last slash) */
			if (content[i] == '..')
				childPath = relativePath.substr(0, relativePath.lastIndexOf('/', relativePath.length - 2));

			entries += libTemplates.Expand(teEntry, {
				path: StaticSubPath + childPath,
				name: content[i]
			});
		}
	}
	else
		entries = libTemplates.LoadExpanded(libTemplates.ListDir.empty, {});

	/* update the path to not contain the trailing slash */
	if (relativePath != '/')
		relativePath = relativePath.substr(0, relativePath.length - 1);

	/* construct the final template and return it */
	libHttp.RespondTemplate(response, libHttp.StatusCode.Ok,
		libTemplates.ListDir.base, { path: relativePath, entries });
}

export function HandleStatic(request, response, secureInternal, url) {
	libLog.Log(`Static handler for [${url.pathname}]`);

	/* expand the path */
	const relativePath = (url.pathname == StaticSubPath ? '/' : url.pathname.substr(StaticSubPath.length));
	const actualPath = libPath.join(libConfig.StaticPath, '.' + relativePath);

	/* ensure the request is using the Get-method */
	if (request.method != 'GET') {
		libLog.Log(`Request used invalid method [${request.method}]`);
		libHttp.RespondTemplate(response, libHttp.StatusCode.MethodNotAllowed, libTemplates.ErrorInvalidMethod,
			{ path: relativePath, method: request.method, allowed: 'GET' });
		return;
	}

	/* check if the path is a file */
	if (libFs.existsSync(actualPath)) {
		if (libFs.lstatSync(actualPath).isFile()) {
			libHttp.RespondFile(request.headers.range, response, relativePath, actualPath);
			return;
		}

		/* check if the path is a directory */
		else if (libFs.lstatSync(actualPath).isDirectory()) {
			ListDirectory(response, actualPath, relativePath);
			return;
		}
	}

	/* add the not found error */
	libLog.Log(`Request to unknown resource`);
	libHttp.RespondTemplate(response, libHttp.StatusCode.NotFound, libTemplates.ErrorNotFound, { path: relativePath });
}
