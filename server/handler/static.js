import * as libLog from "../log.js";
import * as libTemplates from "../templates.js";
import * as libConfig from "../config.js";
import * as libHttp from "../http.js"
import * as libPath from "path";
import * as libFs from "fs";
import * as libStream from "stream";

export const StaticSubPath = '/static';

function ListDirectory(response, actualPath, path) {
	var content = libFs.readdirSync(actualPath);

	/* cleanup the path to end in a slash */
	if (!path.endsWith('/'))
		path = path + '/';

	/* check if the parent directory should be added */
	if (path != StaticSubPath + '/')
		content = ['..'].concat(content);

	/* check if entries have been found */
	var entries = '';
	if (content.length > 0) {
		/* extract the entry-template to be used */
		const teEntry = libTemplates.Load(libTemplates.ListDir.entry);

		/* expand all entries */
		for (var i = 0; i < content.length; ++i) {
			var childPath = path + content[i];

			/* check if this is the parent-entry and make the path cleaner (skip the last slash) */
			if (content[i] == '..')
				childPath = path.substr(0, path.lastIndexOf('/', path.length - 2));

			entries += libTemplates.Expand(teEntry, {
				path: childPath,
				name: content[i]
			});
		}
	}
	else
		entries = libTemplates.LoadExpanded(libTemplates.ListDir.empty, {});

	/* update the path to not contain the leading /static and the trailing slash */
	path = path.substr(StaticSubPath.length, path.length - StaticSubPath.length - 1);
	if (path.length == 0)
		path = '/';

	/* construct the final template and return it */
	libHttp.HtmlResponse(response, libHttp.Ok, libTemplates.LoadExpanded(
		libTemplates.ListDir.base, { path, entries }
	));
}
function SendFile(request, response, actualPath, path) {
	const fileSize = libFs.statSync(actualPath).size;

	/* mark byte-ranges to be supported in principle */
	response.setHeader('Accept-Ranges', 'bytes');

	/* parse the range and check if it is invalid */
	const [offset, size, rangeResult] = libHttp.ParseRange(request.headers.range, fileSize);
	if (rangeResult == libHttp.ParseRangeMalformed) {
		libLog.Info(`Malformed range-request encountered [${request.headers.range}]`);
		libHttp.HtmlResponse(response, libHttp.BadRequest,
			libTemplates.LoadExpanded(libTemplates.ErrorBadRequest, {
				path, reason: `Issues while parsing http-header range: [${request.headers.range}]`
			})
		);
		return;
	}
	else if (rangeResult == libHttp.ParseRangeIssue) {
		libLog.Info(`Unsatisfiable range-request encountered [${request.headers.range}] with file-size [${fileSize}]`);
		response.setHeader('Content-Range', `bytes */${fileSize}`);
		libHttp.HtmlResponse(response, libHttp.RangeIssue,
			libTemplates.LoadExpanded(libTemplates.ErrorRangeIssue, {
				path, range: request.headers.range, size: String(fileSize)
			})
		);
		return;
	}

	/* check if the file is empty (can only happen for unused ranges) */
	if (size == 0) {
		libLog.Info('Sending empty content');
		libHttp.PrepareResponse(response, libHttp.Ok, actualPath, 0);
		response.end();
		return;
	}

	/* setup the filestream object */
	let stream = libFs.createReadStream(actualPath, {
		start: offset, end: offset + size - 1
	});

	/* setup the response */
	libHttp.PrepareResponse(response, (rangeResult == libHttp.ParseRangeNoRange ? libHttp.Ok : libHttp.PartialContent), actualPath, size);
	if (rangeResult == libHttp.ParseRangeValid)
		response.setHeader('Content-Range', `bytes ${offset}-${offset + size - 1}/${size}`);

	/* write the content to the stream */
	libLog.Info(`Sending content [${offset} - ${offset + size - 1}] of file with size [${fileSize}]`);
	libStream.pipeline(stream, response, (err) => {
		if (err != undefined)
			libLog.Error(`While sending content: [${err}]`);
		else
			libLog.Info('Content has been sent');
	});
}

export function HandleStatic(request, response, secureInternal, url) {
	libLog.Info(`Static handler for [${url.pathname}]`);

	/* ensure the request is using the Get-method */
	if (request.method != 'GET') {
		libLog.Info(`Request used invalid method [${request.method}]`);
		libHttp.HtmlResponse(response, libHttp.MethodNotAllowed,
			libTemplates.LoadExpanded(libTemplates.ErrorInvalidMethod, {
				path: url.pathname,
				method: request.method,
				allowed: 'GET'
			})
		);
		return;
	}

	/* expand the path */
	const path = url.pathname;
	const actualPath = libPath.join(libConfig.StaticPath, '.' + path.substr(StaticSubPath.length));

	/* check if the path is a file */
	if (libFs.existsSync(actualPath)) {
		if (libFs.lstatSync(actualPath).isFile()) {
			SendFile(request, response, actualPath, path);
			return;
		}

		/* check if the path is a directory */
		else if (libFs.lstatSync(actualPath).isDirectory()) {
			ListDirectory(response, actualPath, path);
			return;
		}
	}

	/* add the not found error */
	libLog.Info(`Request to unknown resource`);
	libHttp.HtmlResponse(response, libHttp.NotFound,
		libTemplates.LoadExpanded(libTemplates.ErrorNotFound, {
			path: url.pathname
		})
	);
};
