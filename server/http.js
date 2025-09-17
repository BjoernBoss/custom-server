/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
import * as libConfig from "./config.js";
import * as libTemplates from "./templates.js";
import * as libLog from "./log.js";
import * as libLocation from "./location.js";
import * as libPath from "path";
import * as libBuffer from "buffer";
import * as libFs from "fs";
import * as libStream from "stream";
import * as libURL from "url";
import * as libWs from "ws";

export const StatusCode = {
	Ok: 200,
	PartialContent: 206,
	PermanentlyMoved: 301,
	TemporaryRedirect: 307,
	BadRequest: 400,
	NotFound: 404,
	MethodNotAllowed: 405,
	Conflict: 409,
	ContentTooLarge: 413,
	UnsupportedMediaType: 415,
	RangeIssue: 416,
	InternalError: 500
};

export class HttpRequest {
	constructor(request, response, internal) {
		this.internal = internal;
		this._request = request;
		this._response = response;
		this._headersDone = false;
		this._headers = {};

		const url = new libURL.URL(request.url, `http://${request.headers.host}`);
		this.relative = libLocation.sanitize(decodeURIComponent(url.pathname));
		this.fullpath = this.relative;
		this.rawpath = url.pathname;
	}

	static _ParseRangeNoRange = 0;
	static _ParseRangeValid = 1;
	static _ParseRangeIssue = 2;
	static _ParseRangeMalformed = 3;
	static _ParseRangeHeader(range, size) {
		if (range == undefined)
			return [0, size, HttpRequest._ParseRangeNoRange];

		/* check if it requests bytes */
		if (!range.startsWith('bytes='))
			return [0, size, HttpRequest._ParseRangeIssue];
		range = range.substr(6);

		/* extract the first number */
		let firstSize = 0;
		while (firstSize < range.length && (range[firstSize] >= '0' && range[firstSize] <= '9'))
			++firstSize;

		/* check if the separator exists */
		if (firstSize >= range.length || range[firstSize] != '-')
			return [0, 0, HttpRequest._ParseRangeMalformed];

		/* extract the second number */
		let secondSize = firstSize + 1;
		while (secondSize < range.length && (range[secondSize] >= '0' && range[secondSize] <= '9'))
			++secondSize;

		/* check if a valid end has been found or another range (only the first
		*	range will be respected) and that at least one number has been given */
		if (secondSize < range.length && range[secondSize] != ',')
			return [0, 0, HttpRequest._ParseRangeMalformed];
		secondSize -= firstSize + 1;
		if (firstSize == 0 && secondSize == 0)
			return [0, 0, HttpRequest._ParseRangeMalformed];

		/* parse the two numbers */
		const begin = (firstSize == 0 ? undefined : parseInt(range.substr(0, firstSize)));
		const end = (secondSize == 0 ? undefined : parseInt(range.substr(firstSize + 1, secondSize)));

		/* check if only an offset has been requested */
		if (end == undefined) {
			if (begin >= size)
				return [0, 0, HttpRequest._ParseRangeIssue];
			return [begin, size - begin, HttpRequest._ParseRangeValid];
		}

		/* check if only a suffix has been requested */
		if (begin == undefined) {
			if (end >= size)
				return [0, 0, HttpRequest._ParseRangeIssue];
			return [size - end, end, HttpRequest._ParseRangeValid];
		}

		/* check that the range is well defined */
		if (end < begin || begin >= size || end >= size)
			return [0, 0, HttpRequest._ParseRangeIssue];

		/* setup the corrected range */
		return [begin, end - begin + 1, HttpRequest._ParseRangeValid];
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
		if (fileExtension in HttpRequest._contentTypeMap)
			return HttpRequest._contentTypeMap[fileExtension];
		return 'application/octet-stream';
	}
	_closeHeader(statusCode, path, length = undefined) {
		this._response.statusCode = statusCode;
		for (const key in this._headers)
			this._response.setHeader(key, this._headers[key]);

		this._response.setHeader('Server', libConfig.getServerName());
		this._response.setHeader('Content-Type', HttpRequest._ContentType(path));
		this._response.setHeader('Date', new Date().toUTCString());

		if (!('Accept-Ranges' in this._headers))
			this._response.setHeader('Accept-Ranges', 'none');
		if (length != undefined)
			this._response.setHeader('Content-Length', length);
		this._headersDone = true;
	}
	_responseString(code, path, string) {
		const buffer = libBuffer.Buffer.from(string, 'utf-8');
		this._closeHeader(code, path, buffer.length);
		this._response.end(buffer);
	}

	translate(path) {
		if (this.relative == path)
			this.relative = '/';
		else
			this.relative = this.relative.substring(path.length);
	}
	addHeader(key, value) {
		this._headers[key] = value;
	}
	ensureMethod(methods) {
		if (methods.indexOf(this._request.method) >= 0)
			return this._request.method;
		libLog.Log(`Request used unsupported method [${this._request.method}]`);

		const content = libTemplates.LoadExpanded(libTemplates.ErrorInvalidMethod,
			{ path: this.rawpath, method: this._request.method, allowed: methods.join(",") });
		this._responseString(StatusCode.MethodNotAllowed, 'f.html', content);
		return null;
	}
	ensureMediaType(types) {
		const type = this._request.headers['content-type'];
		if (type === undefined)
			return types[0];
		for (let i = 0; i < types.length; ++i) {
			if (type === types[i] || type.startsWith(`${types[i]};`))
				return types[i];
		}
		libLog.Log(`Responded with Unsupported Media Type for [${type}]`);

		const content = libTemplates.LoadExpanded(libTemplates.ErrorUnsupportedMediaType,
			{ path: this.rawpath, used: type, allowed: types.join(",") });
		this._responseString(StatusCode.UnsupportedMediaType, 'f.html', content);
		return null;
	}
	getMediaTypeCharset(defEncoding) {
		const type = this._request.headers['content-type'];
		if (type === undefined)
			return defEncoding;

		let index = type.indexOf('charset=');
		if (index == -1)
			return defEncoding;
		index += 8;

		let end = index;
		while (end < type.length && type[end] != ';')
			++end;

		if (index == end)
			return defEncoding;
		return type.substring(index, end);
	}
	ensureContentLength(maxLength) {
		let length = 0;
		if (this._request.headers['content-length'] != undefined)
			length = parseInt(this._request.headers['content-length']);
		if (isFinite(length) && length >= 0 && length <= maxLength)
			return true;
		libLog.Log(`Request is too large or has no size [${length}]`);

		const content = libTemplates.LoadExpanded(libTemplates.ErrorContentTooLarge,
			{ path: this.rawpath, length: `${length}`, allowed: `${maxLength}` });
		this._responseString(StatusCode.ContentTooLarge, 'f.html', content);
		return false;
	}
	respondInternalError(msg) {
		if (this._headersDone)
			return;
		this._headers = {};

		libLog.Log(`Responded with Internal error [${msg}]`);
		this._responseString(StatusCode.InternalError, 'f.txt', msg);
	}
	respondOk(operation, msg = undefined) {
		libLog.Log(`Responded with Ok`);

		if (msg != undefined)
			this._responseString(StatusCode.Ok, 'f.txt', msg);
		else {
			const content = libTemplates.LoadExpanded(libTemplates.SuccessOk, { path: this.rawpath, operation: operation });
			this._responseString(StatusCode.Ok, 'f.html', content);
		}
	}
	respondNotFound(msg = undefined) {
		libLog.Log(`Responded with Not-Found`);

		if (msg != undefined)
			this._responseString(StatusCode.NotFound, 'f.txt', msg);
		else {
			const content = libTemplates.LoadExpanded(libTemplates.ErrorNotFound, { path: this.rawpath });
			this._responseString(StatusCode.NotFound, 'f.html', content);
		}
	}
	respondConflict(conflict, msg = undefined) {
		libLog.Log(`Responded with Conflict of [${conflict}]`);

		if (msg != undefined)
			this._responseString(StatusCode.Conflict, 'f.txt', msg);
		else {
			const content = libTemplates.LoadExpanded(libTemplates.ErrorConflict, { path: this.rawpath, conflict: conflict });
			this._responseString(StatusCode.Conflict, 'f.html', content);
		}
	}
	respondMoved(target, msg = undefined) {
		libLog.Log(`Responded with Permanently-Moved to [${target}]`);
		this._response.setHeader('Location', target);

		if (msg != undefined)
			this._responseString(StatusCode.PermanentlyMoved, 'f.txt', msg);
		else {
			const content = libTemplates.LoadExpanded(libTemplates.PermanentlyMoved, { path: this.rawpath, new: target });
			this._responseString(StatusCode.PermanentlyMoved, 'f.html', content);
		}
	}
	respondRedirect(target, msg = undefined) {
		libLog.Log(`Responded with Redirect to [${target}]`);
		this._response.setHeader('Location', target);

		if (msg != undefined)
			this._responseString(StatusCode.TemporaryRedirect, 'f.txt', msg);
		else {
			const content = libTemplates.LoadExpanded(libTemplates.TemporaryRedirect, { path: this.rawpath, new: target });
			this._responseString(StatusCode.TemporaryRedirect, 'f.html', content);
		}
	}
	respondBadRequest(reason, msg = undefined) {
		libLog.Log(`Responded with Bad-Request`);

		if (msg != undefined)
			this._responseString(StatusCode.BadRequest, 'f.txt', msg);
		else {
			const content = libTemplates.LoadExpanded(libTemplates.ErrorBadRequest, { path: this.rawpath, reason: reason });
			this._responseString(StatusCode.BadRequest, 'f.html', content);
		}
	}
	respondHtml(content) {
		this._responseString(StatusCode.Ok, 'f.html', content);
	}
	respondJson(content) {
		this._responseString(StatusCode.Ok, 'f.json', content);
	}
	tryRespondFile(filePath) {
		/* check if the file exists */
		if (!libFs.existsSync(filePath) || !libFs.lstatSync(filePath).isFile()) {
			libLog.Log(`Request to unknown resource`);
			this.respondNotFound();
			return;
		}
		const fileSize = libFs.statSync(filePath).size;

		/* mark byte-ranges to be supported in principle */
		this._headers['Accept-Ranges'] = 'bytes';

		/* parse the range and check if it is invalid */
		const [offset, size, rangeResult] = HttpRequest._ParseRangeHeader(this._request.headers.range, fileSize);
		if (rangeResult == HttpRequest._ParseRangeMalformed) {
			libLog.Log(`Malformed range-request encountered [${this._request.headers.range}]`);
			const content = libTemplates.LoadExpanded(libTemplates.ErrorBadRequest,
				{ path: this.rawpath, reason: `Issues while parsing http-header range: [${this._request.headers.range}]` });
			this._responseString(StatusCode.BadRequest, 'f.html', content);
			return;
		}
		else if (rangeResult == HttpRequest._ParseRangeIssue) {
			libLog.Log(`Unsatisfiable range-request encountered [${range}] with file-size [${fileSize}]`);
			this._headers['Content-Range'] = `bytes */${fileSize}`;
			const content = libTemplates.LoadExpanded(libTemplates.ErrorRangeIssue,
				{ path: this.rawpath, range: this._request.headers.range, size: String(fileSize) });
			this._responseString(StatusCode.RangeIssue, 'f.html', content);
			return;
		}

		/* check if the file is empty (can only happen for unused ranges) */
		if (size == 0) {
			libLog.Log('Sending empty content');
			this._responseString(StatusCode.Ok, this.rawpath, '');
			return;
		}

		/* setup the filestream object */
		let stream = libFs.createReadStream(filePath, {
			flags: 'r', start: offset, end: offset + size - 1
		});

		/* setup the response */
		if (rangeResult == HttpRequest._ParseRangeValid)
			this._headers['Content-Range'] = `bytes ${offset}-${offset + size - 1}/${fileSize}`;
		this._closeHeader((rangeResult == HttpRequest._ParseRangeNoRange ? StatusCode.Ok : StatusCode.PartialContent), filePath, size);

		/* write the content to the stream */
		libLog.Log(`Sending content [${offset} - ${offset + size - 1}/${fileSize}]`);
		libStream.pipeline(stream, this._response, (err) => {
			if (err == undefined)
				err = 'Content has been sent';
			libLog.Log(`While sending content: [${err}]`);
		});
	}
	receiveChunks(cb) {
		let _failed = false, that = this;
		this._request.on('data', function (data) {
			if (_failed)
				that._request.socket.destroy();
			else
				_failed = cb(data, null);

		});
		this._request.on('error', function (e) {
			if (!_failed)
				cb(null, e);
		});
		this._request.on('end', function () {
			if (!_failed)
				cb(null, null);
		});
	}
	receiveAllBuffer(cb) {
		const body = [];
		this._request.on('data', (data) => body.push(data));
		this._request.on('error', (e) => cb(null, e));
		this._request.on('end', () => cb(libBuffer.Buffer.concat(body), null));
	}
	receiveAllText(encoding, cb) {
		const body = [];
		this._request.on('data', (data) => body.push(data));
		this._request.on('error', (e) => cb(null, e));
		this._request.on('end', function () {
			const total = libBuffer.Buffer.concat(body);
			let str = null;
			try {
				str = total.toString(encoding);
			} catch (e) {
				cb(null, e);
				return;
			}
			cb(str, null);
		});
	}
	receiveToFile(file, cb) {
		libLog.Log(`Collecting data from [${this.rawpath}] to: [${file}]`);

		let queue = [], busy = true, fd = null, closed = false;
		const failure = function (e) {
			/* mark the object as permanently busy */
			busy = true;

			/* check if the file has not yet been opened */
			if (fd == null) {
				cb(e);
				return;
			}

			/* close the file and try to delete it */
			libFs.close(fd, function () {
				try {
					libFs.unlinkSync(file);
				} catch (e2) {
					libLog.Warning(`Failed to remove file [${file}] after writing uploaded data to it failed: ${e2.message}`);
				}
				cb(e);
			});
		};
		const flushData = function (done) {
			closed = (closed || done);
			if (busy)
				return;

			/* check if further data exist to be written out */
			if (queue.length == 0) {
				if (closed) libFs.close(fd, () => cb(null));
				return;
			}

			/* write the next data out */
			busy = true;
			libFs.write(fd, queue[0], function (e, written) {
				busy = false;
				if (e) {
					failure(e);
					return;
				}

				/* consume the given data and flush the remaining data */
				if (written >= queue[0].length)
					queue = queue.splice(1);
				else
					queue[0] = queue[0].subarray(written);
				flushData(false);
			});
		};

		this._request.on('data', function (data) { queue.push(data); flushData(false); });
		this._request.on('error', (e) => failure(e));
		this._request.on('end', () => flushData(true));

		/* open the actual file for writing */
		libFs.open(file, 'wx', function (e, f) {
			busy = false;
			if (e)
				failure(e);
			else {
				fd = f;
				flushData(false);
			}
		});
	}
};

const webSocketServer = new libWs.WebSocketServer({ noServer: true });

export class HttpUpgrade {
	constructor(request, socket, head, internal) {
		this.internal = internal;
		this._request = request;
		this._socket = socket;
		this._head = head;

		const url = new libURL.URL(request.url, `http://${request.headers.host}`);
		this.relative = libLocation.sanitize(decodeURIComponent(url.pathname));
		this.fullpath = this.relative;
		this.rawpath = url.pathname;
	}

	_responseString(status, type, string) {
		const buffer = libBuffer.Buffer.from(string, 'utf-8');

		let header = `HTTP/1.1 ${status}\r\n`;
		header += `Date: ${new Date().toUTCString()}\r\n`;
		header += `Server: ${libConfig.getServerName()}\r\n`;
		header += `Content-Type: ${type}\r\n`;
		header += `Content-Length: ${buffer.length}\r\n`;
		header += `Accept-Ranges: none\r\n`;
		header += 'Connection: keep-alive\r\n';
		header += 'Keep-Alive: timeout=5\r\n';
		header += '\r\n';

		this._socket.write(header, 'utf-8');
		this._socket.write(buffer);
		this._socket.destroy();
	}

	translate(path) {
		if (this.relative == path)
			this.relative = '/';
		else
			this.relative = this.relative.substring(path.length);
	}
	respondNotFound(msg = undefined) {
		libLog.Log(`Responded with Not-Found`);

		if (msg != undefined)
			this._responseString(`${StatusCode.NotFound} Not Found`, 'text/plain; charset=utf-8', msg);
		else {
			const content = libTemplates.LoadExpanded(libTemplates.ErrorNotFound, { path: this.rawpath });
			this._responseString(`${StatusCode.NotFound} Not Found`, 'text/html; charset=utf-8', content);
		}
	}
	respondInternalError(msg) {
		libLog.Log(`Responded with Internal error [${msg}]`);
		this._responseString(`${StatusCode.InternalError} Internal Server Error`, 'text/plain; charset=utf-8', msg);
	}
	tryAcceptWebSocket(callback) {
		let connection = this._request.headers.connection.toLowerCase().split(',').map((v) => v.trim());
		if (connection.indexOf('upgrade') == -1 || this._request.headers.upgrade.toLowerCase() != 'websocket' || this._request.method != 'GET')
			return false;

		webSocketServer.handleUpgrade(this._request, this._socket, this._head, function (ws, request) {
			webSocketServer.emit('connection', ws, request);
			callback(ws);
		});
		return true;
	}
};
