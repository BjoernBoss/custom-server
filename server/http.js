/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
import * as libConfig from "./config.js";
import * as libTemplates from "./templates.js";
import * as libLog from "./log.js";
import * as libPath from "path";
import * as libBuffer from "buffer";
import * as libFs from "fs";
import * as libStream from "stream";
import * as libURL from "url";
import * as libWs from "ws";

const WebSocketServer = new libWs.WebSocketServer({ noServer: true });

export const StatusCode = {
	Ok: 200,
	PartialContent: 206,
	PermanentlyMoved: 301,
	TemporaryRedirect: 307,
	BadRequest: 400,
	NotFound: 404,
	MethodNotAllowed: 405,
	RangeIssue: 416,
	InternalError: 500
};

export class HttpMessage {
	constructor(request, response, secureInternal) {
		this.request = request;
		this.response = response;
		this.secureInternal = secureInternal;
		this.url = new libURL.URL(request.url, `http://${request.headers.host}`);
		this.relative = this.url.pathname;
		this._headersDone = false;
		this._headers = {};
	}

	static _ParseRangeNoRange = 0;
	static _ParseRangeValid = 1;
	static _ParseRangeIssue = 2;
	static _ParseRangeMalformed = 3;
	static _ParseRangeHeader(range, size) {
		if (range == undefined)
			return [0, size, HttpMessage._ParseRangeNoRange];

		/* check if it requests bytes */
		if (!range.startsWith('bytes='))
			return [0, size, HttpMessage._ParseRangeIssue];
		range = range.substr(6);

		/* extract the first number */
		let firstSize = 0;
		while (firstSize < range.length && (range[firstSize] >= '0' && range[firstSize] <= '9'))
			++firstSize;

		/* check if the separator exists */
		if (firstSize >= range.length || range[firstSize] != '-')
			return [0, 0, HttpMessage._ParseRangeMalformed];

		/* extract the second number */
		let secondSize = firstSize + 1;
		while (secondSize < range.length && (range[secondSize] >= '0' && range[secondSize] <= '9'))
			++secondSize;

		/* check if a valid end has been found or another range (only the first
		*	range will be respected) and that at least one number has been given */
		if (secondSize < range.length && range[secondSize] != ',')
			return [0, 0, HttpMessage._ParseRangeMalformed];
		secondSize -= firstSize + 1;
		if (firstSize == 0 && secondSize == 0)
			return [0, 0, HttpMessage._ParseRangeMalformed];

		/* parse the two numbers */
		const begin = (firstSize == 0 ? undefined : parseInt(range.substr(0, firstSize)));
		const end = (secondSize == 0 ? undefined : parseInt(range.substr(firstSize + 1, secondSize)));

		/* check if only an offset has been requested */
		if (end == undefined) {
			if (begin >= size)
				return [0, 0, HttpMessage._ParseRangeIssue];
			return [begin, size - begin, HttpMessage._ParseRangeValid];
		}

		/* check if only a suffix has been requested */
		if (begin == undefined) {
			if (end >= size)
				return [0, 0, HttpMessage._ParseRangeIssue];
			return [size - end, end, HttpMessage._ParseRangeValid];
		}

		/* check that the range is well defined */
		if (end < begin || begin >= size || end >= size)
			return [0, 0, HttpMessage._ParseRangeIssue];

		/* setup the corrected range */
		return [begin, end - begin + 1, HttpMessage._ParseRangeValid];
	}
	static _contentTypeMap = {
		'.html': 'text/html; charset=utf-8',
		'.css': 'text/css; charset=utf-8',
		'.js': 'text/javascript; charset=utf-8',
		'.txt': 'text/plain; charset=utf-8',
		'.json': 'application/json; charset=utf-8',
		'.mp4': 'video/mp4',
		'.png': 'image/png',
		'.gif': 'image/gif',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.svg': 'image/svg+xml'
	};
	static _ContentType(filePath) {
		const fileExtension = libPath.extname(filePath).toLowerCase();
		if (fileExtension in HttpMessage._contentTypeMap)
			return HttpMessage._contentTypeMap[fileExtension];
		return 'application/octet-stream';
	}
	_closeHeader(statusCode, path, length = undefined) {
		this.response.statusCode = statusCode;
		for (const key in this._headers)
			this.response.setHeader(key, this._headers[key]);

		this.response.setHeader('Server', libConfig.GetServerName());
		this.response.setHeader('Content-Type', HttpMessage._ContentType(path));
		this.response.setHeader('Date', new Date().toUTCString());

		if (!('Accept-Ranges' in this._headers))
			this.response.setHeader('Accept-Ranges', 'none');
		if (length != undefined)
			this.response.setHeader('Content-Length', length);
		this._headersDone = true;
	}
	_responseString(code, path, string) {
		const buffer = libBuffer.Buffer.from(string, 'utf-8');
		this._closeHeader(code, path, buffer.length);
		this.response.end(buffer);
	}

	translate(path) {
		if (this.url.pathname == path)
			this.relative = '/';
		else
			this.relative = this.url.pathname.substring(path.length);
	}
	addHeader(key, value) {
		this._headers[key] = value;
	}
	ensureMethod(methods) {
		if (methods.indexOf(this.request.method) >= 0)
			return true;
		libLog.Log(`Request used unsupported method [${this.request.method}]`);

		const content = libTemplates.LoadExpanded(libTemplates.ErrorInvalidMethod,
			{ path: this.url.pathname, method: this.request.method, allowed: methods.join(",") });
		this._responseString(StatusCode.MethodNotAllowed, 'f.html', content);
		return false;
	}
	tryRespondInternalError(msg) {
		if (this._headersDone)
			return;
		this._headers = {};

		libLog.Log(`Responded with Internal error [${msg}]`);
		this._responseString(StatusCode.InternalError, 'f.txt', msg);
	}
	respondNotFound(msg = undefined) {
		libLog.Log(`Responded with Not-Found`);
		const content = (msg != undefined ? msg : libTemplates.LoadExpanded(libTemplates.ErrorNotFound, { path: this.url.pathname }));
		this._responseString(StatusCode.NotFound, 'f.html', content);
	}
	respondMoved(target, msg = undefined) {
		libLog.Log(`Responded with Permanently-Moved to [${target}]`);
		const content = (msg != undefined ? msg : libTemplates.LoadExpanded(libTemplates.PermanentlyMoved, { path: this.url.pathname, new: target }));
		this.response.setHeader('Location', target);
		this._responseString(StatusCode.PermanentlyMoved, 'f.html', content);
	}
	respondRedirect(target, msg = undefined) {
		libLog.Log(`Responded with Redirect to [${target}]`);
		const content = (msg != undefined ? msg : libTemplates.LoadExpanded(libTemplates.TemporaryRedirect, { path: this.url.pathname, new: target }));
		this.response.setHeader('Location', target);
		this._responseString(StatusCode.TemporaryRedirect, 'f.html', content);
	}
	respondHtml(content) {
		this._responseString(StatusCode.Ok, 'f.html', content);
	}
	respondJson(content) {
		this._responseString(StatusCode.Ok, 'f.json', content);
	}
	respondFile(filePath, useURLPathForType) {
		const fileSize = libFs.statSync(filePath).size;

		/* mark byte-ranges to be supported in principle */
		this._headers['Accept-Ranges'] = 'bytes';

		/* parse the range and check if it is invalid */
		const [offset, size, rangeResult] = HttpMessage._ParseRangeHeader(this.request.headers.range, fileSize);
		if (rangeResult == HttpMessage._ParseRangeMalformed) {
			libLog.Log(`Malformed range-request encountered [${this.request.headers.range}]`);
			const content = libTemplates.LoadExpanded(libTemplates.ErrorBadRequest,
				{ path: this.url.pathname, reason: `Issues while parsing http-header range: [${this.request.headers.range}]` });
			this._responseString(StatusCode.BadRequest, 'f.html', content);
			return;
		}
		else if (rangeResult == HttpMessage._ParseRangeIssue) {
			libLog.Log(`Unsatisfiable range-request encountered [${range}] with file-size [${fileSize}]`);
			this._headers['Content-Range'] = `bytes */${fileSize}`;
			const content = libTemplates.LoadExpanded(libTemplates.ErrorRangeIssue,
				{ path: this.url.pathname, range: this.request.headers.range, size: String(fileSize) });
			this._responseString(StatusCode.RangeIssue, 'f.html', content);
			return;
		}

		/* check if the file is empty (can only happen for unused ranges) */
		if (size == 0) {
			libLog.Log('Sending empty content');
			this._responseString(StatusCode.Ok, this.url.pathname, '');
			return;
		}

		/* setup the filestream object */
		let stream = libFs.createReadStream(filePath, {
			start: offset, end: offset + size - 1
		});

		/* setup the response */
		if (rangeResult == HttpMessage._ParseRangeValid)
			this._headers['Content-Range'] = `bytes ${offset}-${offset + size - 1}/${fileSize}`;
		this._closeHeader((rangeResult == HttpMessage._ParseRangeNoRange ? StatusCode.Ok : StatusCode.PartialContent), useURLPathForType ? this.url.pathname : filePath, size);

		/* write the content to the stream */
		libLog.Log(`Sending content [${offset} - ${offset + size - 1}/${fileSize}]`);
		libStream.pipeline(stream, this.response, (err) => {
			if (err == undefined)
				err = 'Content has been sent';
			libLog.Log(`While sending content: [${err}]`);
		});
	}
	tryRespondFile(filePath, useURLPathForType) {
		/* check if the file exists */
		if (!libFs.existsSync(filePath) || !libFs.lstatSync(filePath).isFile()) {
			libLog.Log(`Request to unknown resource`);
			this.respondNotFound();
		}
		else
			this.respondFile(filePath, useURLPathForType);
	}
	tryAcceptWebSocket(callback) {
		let connection = this.request.headers.connection.toLowerCase().split(',').map((v) => v.trim());
		if (connection.indexOf('upgrade') == -1 || this.request.headers.upgrade.toLowerCase() != 'websocket')
			return false;
		WebSocketServer.handleUpgrade(this.request, this.request.socket, Buffer.alloc(0), (ws, _) => callback(ws));
		return true;
	}
};
