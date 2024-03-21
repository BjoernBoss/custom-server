import * as libConfig from "./config.js";
import * as libTemplates from "./templates.js";
import * as libLog from "./log.js";
import * as libPath from "path";
import * as libBuffer from "buffer";
import * as libFs from "fs";
import * as libStream from "stream";

export const StatusCode = {
	Ok: 200,
	PartialContent: 206,
	BadRequest: 400,
	NotFound: 404,
	MethodNotAllowed: 405,
	RangeIssue: 416,
	InternalError: 500
};

export function RespondStream(response, code, path, length = undefined) {
	response.statusCode = code;
	response.setHeader('Server', libConfig.ServerName);
	response.setHeader('Content-Type', MapContentType(path));
	response.setHeader('Date', new Date().toUTCString());
	if (!response.hasHeader('Accept-Ranges'))
		response.setHeader('Accept-Ranges', 'none');
	if (length != undefined)
		response.setHeader('Content-Length', length);
};
export function RespondString(response, code, path, string) {
	const buffer = libBuffer.Buffer.from(string, 'utf-8');
	RespondStream(response, code, path, buffer.length);
	response.end(buffer);
}
export function RespondHtml(response, code, content) {
	RespondString(response, code, 'f.html', content);
};
export function RespondText(response, code, content) {
	RespondString(response, code, 'f.txt', content);
};
export function RespondTemplate(response, code, name, args) {
	const content = libTemplates.LoadExpanded(name, args);
	RespondHtml(response, code, content);
};
export function RespondFile(range, response, path, filePath) {
	const fileSize = libFs.statSync(filePath).size;

	/* mark byte-ranges to be supported in principle */
	response.setHeader('Accept-Ranges', 'bytes');

	/* parse the range and check if it is invalid */
	const [offset, size, rangeResult] = ParseRangeHeader(range, fileSize);
	if (rangeResult == ParseRangeMalformed) {
		libLog.Log(`Malformed range-request encountered [${range}]`);
		RespondTemplate(response, StatusCode.BadRequest, libTemplates.ErrorBadRequest,
			{ path, reason: `Issues while parsing http-header range: [${range}]` });
		return;
	}
	else if (rangeResult == ParseRangeIssue) {
		libLog.Log(`Unsatisfiable range-request encountered [${range}] with file-size [${fileSize}]`);
		response.setHeader('Content-Range', `bytes */${fileSize}`);
		RespondTemplate(response, StatusCode.RangeIssue, libTemplates.ErrorRangeIssue,
			{ path, range: range, size: String(fileSize) });
		return;
	}

	/* check if the file is empty (can only happen for unused ranges) */
	if (size == 0) {
		libLog.Log('Sending empty content');
		RespondString(response, StatusCode.Ok, path, '');
		return;
	}

	/* setup the filestream object */
	let stream = libFs.createReadStream(filePath, {
		start: offset, end: offset + size - 1
	});

	/* setup the response */
	RespondStream(response, (rangeResult == ParseRangeNoRange ? StatusCode.Ok : StatusCode.PartialContent), path, size);
	if (rangeResult == ParseRangeValid)
		response.setHeader('Content-Range', `bytes ${offset}-${offset + size - 1}/${fileSize}`);

	/* write the content to the stream */
	libLog.Log(`Sending content [${offset} - ${offset + size - 1}/${fileSize}]`);
	libStream.pipeline(stream, response, (err) => {
		if (err != undefined)
			libLog.Error(`While sending content: [${err}]`);
		else
			libLog.Log('Content has been sent');
	});
}


function MapContentType(filePath) {
	const fileExtension = libPath.extname(filePath).toLowerCase();

	if (fileExtension == '.html')
		return 'text/html; charset=utf-8';
	if (fileExtension == '.txt')
		return 'text/plain; charset=utf-8';
	if (fileExtension == '.mp4')
		return 'video/mp4';

	return 'application/octet-stream';
}

/* parses a valid byte-range and only respects the first encountered range */
export const ParseRangeNoRange = 0;
export const ParseRangeValid = 1;
export const ParseRangeIssue = 2;
export const ParseRangeMalformed = 3;
function ParseRangeHeader(range, size) {
	if (range == undefined)
		return [0, size, ParseRangeNoRange];

	/* check if it requests bytes */
	if (!range.startsWith('bytes='))
		return [0, size, ParseRangeIssue];
	range = range.substr(6);

	/* extract the first number */
	let firstSize = 0;
	while (firstSize < range.length && (range[firstSize] >= '0' && range[firstSize] <= '9'))
		++firstSize;

	/* check if the separator exists */
	if (firstSize >= range.length || range[firstSize] != '-')
		return [0, 0, ParseRangeMalformed];

	/* extract the second number */
	let secondSize = firstSize + 1;
	while (secondSize < range.length && (range[secondSize] >= '0' && range[secondSize] <= '9'))
		++secondSize;

	/* check if a valid end has been found or another range (only the first
	*	range will be respected) and that at least one number has been given */
	if (secondSize < range.length && range[secondSize] != ',')
		return [0, 0, ParseRangeMalformed];
	secondSize -= firstSize + 1;
	if (firstSize == 0 && secondSize == 0)
		return [0, 0, ParseRangeMalformed];

	/* parse the two numbers */
	const begin = (firstSize == 0 ? undefined : parseInt(range.substr(0, firstSize)));
	const end = (secondSize == 0 ? undefined : parseInt(range.substr(firstSize + 1, secondSize)));

	/* check if only an offset has been requested */
	if (end == undefined) {
		if (begin >= size)
			return [0, 0, ParseRangeIssue];
		return [begin, size - begin, ParseRangeValid];
	}

	/* check if only a suffix has been requested */
	if (begin == undefined) {
		if (end >= size)
			return [0, 0, ParseRangeIssue];
		return [size - end, end, ParseRangeValid];
	}

	/* check that the range is well defined */
	if (end < begin || begin >= size || end >= size)
		return [0, 0, ParseRangeIssue];

	/* setup the corrected range */
	return [begin, end - begin + 1, ParseRangeValid];
}
