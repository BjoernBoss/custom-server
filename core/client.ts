/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
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
import { IncomingMessage, ServerResponse } from "http";

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

enum RangeParseState {
	noRange,
	valid,
	issue,
	malformed
};
function ParseRangeHeader(range: string | undefined, size: number): [number, number, RangeParseState] {
	if (range == undefined)
		return [0, size, RangeParseState.noRange];

	/* check if it requests bytes */
	if (!range.startsWith('bytes='))
		return [0, size, RangeParseState.issue];
	range = range.substring(6);

	/* extract the first number */
	let firstSize = 0;
	while (firstSize < range.length && (range[firstSize] >= '0' && range[firstSize] <= '9'))
		++firstSize;

	/* check if the separator exists */
	if (firstSize >= range.length || range[firstSize] != '-')
		return [0, 0, RangeParseState.malformed];

	/* extract the second number */
	let secondSize = firstSize + 1;
	while (secondSize < range.length && (range[secondSize] >= '0' && range[secondSize] <= '9'))
		++secondSize;

	/* check if a valid end has been found or another range (only the first
	*	range will be respected) and that at least one number has been given */
	if (secondSize < range.length && range[secondSize] != ',')
		return [0, 0, RangeParseState.malformed];
	secondSize -= firstSize + 1;
	if (firstSize == 0 && secondSize == 0)
		return [0, 0, RangeParseState.malformed];

	/* parse the two numbers */
	const begin = (firstSize == 0 ? undefined : parseInt(range.substring(0, firstSize)));
	const end = (secondSize == 0 ? undefined : parseInt(range.substring(firstSize + 1, secondSize)));

	/* check if only an offset has been requested */
	if (end == undefined) {
		if (begin! >= size)
			return [0, 0, RangeParseState.issue];
		return [begin!, size - begin!, RangeParseState.valid];
	}

	/* check if only a suffix has been requested */
	if (begin == undefined) {
		if (end >= size)
			return [0, 0, RangeParseState.issue];
		return [size - end, end, RangeParseState.valid];
	}

	/* check that the range is well defined */
	if (end < begin || begin >= size || end >= size)
		return [0, 0, RangeParseState.issue];

	/* setup the corrected range */
	return [begin, end - begin + 1, RangeParseState.valid];
}

function MakeContentType(filePath: string): string {
	const typeMap: Record<string, string> = {
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

	const fileExtension = libPath.extname(filePath).toLowerCase();
	if (fileExtension in typeMap)
		return typeMap[fileExtension];
	return 'application/octet-stream';
}


export class HttpRequest {
	private request: IncomingMessage;
	private response: ServerResponse;
	private headersDone: boolean;
	private headers: Record<string, string>;

	public internal: boolean;
	public relative: string;
	public fullpath: string;
	public rawpath: string;

	constructor(request: IncomingMessage, response: ServerResponse, internal: boolean) {
		this.internal = internal;
		this.request = request;
		this.response = response;
		this.headersDone = false;
		this.headers = {};

		const url = new libURL.URL(request.url!, `http://${request.headers.host}`);
		this.relative = libLocation.Sanitize(decodeURIComponent(url.pathname));
		this.fullpath = this.relative;
		this.rawpath = url.pathname;
	}

	private closeHeader(statusCode: number, path: string, length: number | null = null): void {
		this.response.statusCode = statusCode;
		for (const key in this.headers)
			this.response.setHeader(key, this.headers[key]);

		this.response.setHeader('Server', libConfig.getServerName());
		this.response.setHeader('Content-Type', MakeContentType(path));
		this.response.setHeader('Date', new Date().toUTCString());

		if (!('Accept-Ranges' in this.headers))
			this.response.setHeader('Accept-Ranges', 'none');
		if (length != null)
			this.response.setHeader('Content-Length', length);
		this.headersDone = true;
	}
	private responseString(code: number, path: string, string: string): void {
		const buffer = libBuffer.Buffer.from(string, 'utf-8');
		this.closeHeader(code, path, buffer.length);
		this.response.end(buffer);
	}

	public translate(path: string): void {
		if (this.relative == path)
			this.relative = '/';
		else
			this.relative = this.relative.substring(path.length);
	}
	public addHeader(key: string, value: string): void {
		this.headers[key] = value;
	}
	public ensureMethod(methods: string[]): string | null {
		if (methods.indexOf(this.request.method!) >= 0)
			return this.request.method!;
		libLog.Log(`Request used unsupported method [${this.request.method}]`);

		const content = libTemplates.ErrorInvalidMethod({ path: this.rawpath, method: this.request.method!, allowed: methods });
		this.responseString(StatusCode.MethodNotAllowed, 'f.html', content);
		return null;
	}
	public ensureMediaType(types: string[]): string | null {
		const type = this.request.headers['content-type'];
		if (type === undefined)
			return types[0];
		for (let i = 0; i < types.length; ++i) {
			if (type === types[i] || type.startsWith(`${types[i]};`))
				return types[i];
		}
		libLog.Log(`Responded with Unsupported Media Type for [${type}]`);

		const content = libTemplates.ErrorUnsupportedMediaType({ path: this.rawpath, used: type, allowed: types });
		this.responseString(StatusCode.UnsupportedMediaType, 'f.html', content);
		return null;
	}
	public getMediaTypeCharset(defEncoding: string): string {
		const type = this.request.headers['content-type'];
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
	public ensureContentLength(maxLength: number): boolean {
		let length = 0;
		if (this.request.headers['content-length'] != undefined)
			length = parseInt(this.request.headers['content-length']);
		if (isFinite(length) && length >= 0 && length <= maxLength)
			return true;
		libLog.Log(`Request is too large or has no size [${length}]`);

		const content = libTemplates.ErrorContentTooLarge({ path: this.rawpath, allowedLength: maxLength, providedLength: length });
		this.responseString(StatusCode.ContentTooLarge, 'f.html', content);
		return false;
	}
	public respondInternalError(msg: string): void {
		if (this.headersDone)
			return;
		this.headers = {};

		libLog.Log(`Responded with Internal error [${msg}]`);
		this.responseString(StatusCode.InternalError, 'f.txt', msg);
	}
	public respondOk(operation: string, msg: string | null = null): void {
		libLog.Log(`Responded with Ok`);

		if (msg != null)
			this.responseString(StatusCode.Ok, 'f.txt', msg);
		else {
			const content = libTemplates.SuccessOk({ path: this.rawpath, operation: operation });
			this.responseString(StatusCode.Ok, 'f.html', content);
		}
	}
	public respondNotFound(msg: string | null = null): void {
		libLog.Log(`Responded with Not-Found`);

		if (msg != null)
			this.responseString(StatusCode.NotFound, 'f.txt', msg);
		else {
			const content = libTemplates.ErrorNotFound({ path: this.rawpath });
			this.responseString(StatusCode.NotFound, 'f.html', content);
		}
	}
	public respondConflict(conflict: string, msg: string | null = null): void {
		libLog.Log(`Responded with Conflict of [${conflict}]`);

		if (msg != null)
			this.responseString(StatusCode.Conflict, 'f.txt', msg);
		else {
			const content = libTemplates.ErrorConflict({ path: this.rawpath, conflict: conflict });
			this.responseString(StatusCode.Conflict, 'f.html', content);
		}
	}
	public respondMoved(target: string, msg: string | null = null): void {
		libLog.Log(`Responded with Permanently-Moved to [${target}]`);
		this.response.setHeader('Location', target);

		if (msg != null)
			this.responseString(StatusCode.PermanentlyMoved, 'f.txt', msg);
		else {
			const content = libTemplates.PermanentlyMoved({ path: this.rawpath, destination: target });
			this.responseString(StatusCode.PermanentlyMoved, 'f.html', content);
		}
	}
	public respondRedirect(target: string, msg: string | null = null): void {
		libLog.Log(`Responded with Redirect to [${target}]`);
		this.response.setHeader('Location', target);

		if (msg != null)
			this.responseString(StatusCode.TemporaryRedirect, 'f.txt', msg);
		else {
			const content = libTemplates.TemporaryRedirect({ path: this.rawpath, destination: target });
			this.responseString(StatusCode.TemporaryRedirect, 'f.html', content);
		}
	}
	public respondBadRequest(reason: string, msg: string | null = null): void {
		libLog.Log(`Responded with Bad-Request`);

		if (msg != null)
			this.responseString(StatusCode.BadRequest, 'f.txt', msg);
		else {
			const content = libTemplates.ErrorBadRequest({ path: this.rawpath, reason: reason });
			this.responseString(StatusCode.BadRequest, 'f.html', content);
		}
	}
	public respondHtml(content: string): void {
		this.responseString(StatusCode.Ok, 'f.html', content);
	}
	public respondJson(content: string): void {
		this.responseString(StatusCode.Ok, 'f.json', content);
	}
	public tryRespondFile(filePath: string): void {
		/* check if the file exists */
		if (!libFs.existsSync(filePath) || !libFs.lstatSync(filePath).isFile()) {
			libLog.Log(`Request to unknown resource`);
			this.respondNotFound();
			return;
		}
		const fileSize = libFs.statSync(filePath).size;

		/* mark byte-ranges to be supported in principle */
		this.headers['Accept-Ranges'] = 'bytes';

		/* parse the range and check if it is invalid */
		const [offset, size, rangeResult] = ParseRangeHeader(this.request.headers.range, fileSize);
		if (rangeResult == RangeParseState.malformed) {
			libLog.Log(`Malformed range-request encountered [${this.request.headers.range}]`);
			const content = libTemplates.ErrorBadRequest({ path: this.rawpath, reason: `Issues while parsing http-header range: [${this.request.headers.range}]` });
			this.responseString(StatusCode.BadRequest, 'f.html', content);
			return;
		}
		else if (rangeResult == RangeParseState.issue) {
			libLog.Log(`Unsatisfiable range-request encountered [${this.request.headers.range}] with file-size [${fileSize}]`);
			this.headers['Content-Range'] = `bytes */${fileSize}`;
			const content = libTemplates.ErrorRangeIssue({ path: this.rawpath, range: this.request.headers.range!, fileSize: fileSize });
			this.responseString(StatusCode.RangeIssue, 'f.html', content);
			return;
		}

		/* check if the file is empty (can only happen for unused ranges) */
		if (size == 0) {
			libLog.Log('Sending empty content');
			this.responseString(StatusCode.Ok, this.rawpath, '');
			return;
		}

		/* setup the filestream object */
		let stream = libFs.createReadStream(filePath, {
			flags: 'r', start: offset, end: offset + size - 1
		});

		/* setup the response */
		if (rangeResult == RangeParseState.valid)
			this.headers['Content-Range'] = `bytes ${offset}-${offset + size - 1}/${fileSize}`;
		this.closeHeader((rangeResult == RangeParseState.noRange ? StatusCode.Ok : StatusCode.PartialContent), filePath, size);

		/* write the content to the stream */
		libLog.Log(`Sending content [${offset} - ${offset + size - 1}/${fileSize}]`);
		libStream.pipeline(stream, this.response, (err) => {
			libLog.Log(err == undefined ? `All content has been sent` : `Error while sending content: [${err}]`);
		});
	}
	public receiveChunks(cb: (data: Buffer | null, error: Error | null) => boolean): void {
		let _failed = false, that = this;
		this.request.on('data', function (data) {
			if (_failed)
				that.request.socket.destroy();
			else
				_failed = cb(data, null);

		});
		this.request.on('error', function (e) {
			if (!_failed)
				cb(null, e);
		});
		this.request.on('end', function () {
			if (!_failed)
				cb(null, null);
		});
	}
	public receiveAllBuffer(cb: (data: Buffer | null, error: Error | null) => void): void {
		const body: Buffer[] = [];
		this.request.on('data', (data) => body.push(data));
		this.request.on('error', (e) => cb(null, e));
		this.request.on('end', () => cb(libBuffer.Buffer.concat(body), null));
	}
	public receiveAllText(encoding: BufferEncoding, cb: (text: string | null, error: Error | null) => void): void {
		const body: Buffer[] = [];
		this.request.on('data', (data) => body.push(data));
		this.request.on('error', (e) => cb(null, e));
		this.request.on('end', function () {
			const total = libBuffer.Buffer.concat(body);
			let str = null;
			try {
				str = total.toString(encoding);
			} catch (e: any) {
				cb(null, e);
				return;
			}
			cb(str, null);
		});
	}
	public receiveToFile(file: string, cb: (error: Error | null) => void): void {
		libLog.Log(`Collecting data from [${this.rawpath}] to: [${file}]`);

		let queue: Buffer[] = [], fd: number | null = null, busy = true, closed = false;
		const failure = function (e: Error): void {
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
				} catch (e2: any) {
					libLog.Warning(`Failed to remove file [${file}] after writing uploaded data to it failed: ${e2.message}`);
				}
				cb(e);
			});
		};
		const flushData = function (done: boolean): void {
			closed = (closed || done);
			if (busy)
				return;

			/* check if further data exist to be written out */
			if (queue.length == 0) {
				if (closed) libFs.close(fd!, () => cb(null));
				return;
			}

			/* write the next data out */
			busy = true;
			libFs.write(fd!, queue[0], function (e, written) {
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

		this.request.on('data', function (data) { queue.push(data); flushData(false); });
		this.request.on('error', (e) => failure(e));
		this.request.on('end', () => flushData(true));

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

const webSocketServer: libWs.Server = new libWs.WebSocketServer({ noServer: true });

export class HttpUpgrade {
	private request: IncomingMessage;
	private socket: libStream.Duplex;
	private head: Buffer;

	public internal: boolean;
	public relative: string;
	public fullpath: string;
	public rawpath: string;

	constructor(request: IncomingMessage, socket: libStream.Duplex, head: Buffer, internal: boolean) {
		this.internal = internal;
		this.request = request;
		this.socket = socket;
		this.head = head;

		const url = new libURL.URL(request.url!, `http://${request.headers.host}`);
		this.relative = libLocation.Sanitize(decodeURIComponent(url.pathname));
		this.fullpath = this.relative;
		this.rawpath = url.pathname;
	}

	private responseString(status: string, type: string, text: string): void {
		const buffer = libBuffer.Buffer.from(text, 'utf-8');

		let header = `HTTP/1.1 ${status}\r\n`;
		header += `Date: ${new Date().toUTCString()}\r\n`;
		header += `Server: ${libConfig.getServerName()}\r\n`;
		header += `Content-Type: ${type}\r\n`;
		header += `Content-Length: ${buffer.length}\r\n`;
		header += `Accept-Ranges: none\r\n`;
		header += 'Connection: keep-alive\r\n';
		header += 'Keep-Alive: timeout=5\r\n';
		header += '\r\n';

		this.socket.write(header, 'utf-8');
		this.socket.write(buffer);
		this.socket.destroy();
	}

	public translate(path: string): void {
		if (this.relative == path)
			this.relative = '/';
		else
			this.relative = this.relative.substring(path.length);
	}
	public respondNotFound(msg: string | null = null): void {
		libLog.Log(`Responded with Not-Found`);

		if (msg != null)
			this.responseString(`${StatusCode.NotFound} Not Found`, 'text/plain; charset=utf-8', msg);
		else {
			const content = libTemplates.ErrorNotFound({ path: this.rawpath });
			this.responseString(`${StatusCode.NotFound} Not Found`, 'text/html; charset=utf-8', content);
		}
	}
	public respondInternalError(msg: string): void {
		libLog.Log(`Responded with Internal error [${msg}]`);
		this.responseString(`${StatusCode.InternalError} Internal Server Error`, 'text/plain; charset=utf-8', msg);
	}
	public tryAcceptWebSocket(cb: (ws: libWs.WebSocket | null) => void): boolean {
		let connection = this.request.headers?.connection?.toLowerCase().split(',').map((v) => v.trim());
		if (connection == undefined || connection.indexOf('upgrade') == -1)
			return false;
		if (this.request.headers?.upgrade?.toLowerCase() != 'websocket' || this.request.method != 'GET')
			return false;

		webSocketServer.handleUpgrade(this.request, this.socket, this.head, function (ws, request) {
			webSocketServer.emit('connection', ws, request);
			cb(ws);
		});
		return true;
	}
};
