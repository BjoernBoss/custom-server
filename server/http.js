import * as libConfig from "./config.js";
import * as libPath from "path";
import * as libBuffer from "buffer";

export const Ok = 200;
export const PartialContent = 206;
export const BadRequest = 400;
export const NotFound = 404;
export const MethodNotAllowed = 405;
export const RangeIssue = 416;
export const InternalError = 500;

export function PrepareResponse(response, code, contentPath, size) {
	response.statusCode = code;
	response.setHeader('Server', libConfig.ServerName);
	response.setHeader('Content-Type', MapContentType(contentPath));
	if (!response.hasHeader('Accept-Ranges'))
		response.setHeader('Accept-Ranges', 'none');
	if (size != undefined)
		response.setHeader('Content-Length', size);
};

export function HtmlResponse(response, code, content) {
	const buffer = libBuffer.Buffer.from(content, 'utf-8');
	PrepareResponse(response, code, 'f.html', buffer.byteLength);
	response.end(buffer);
};
export function TextResponse(response, code, content) {
	const buffer = libBuffer.Buffer.from(content, 'utf-8');
	PrepareResponse(response, code, 'f.txt', buffer.byteLength);
	response.end(buffer);
};


export function MapContentType(filePath) {
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
export function ParseRange(range, size) {
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
		return [begin, size - begin];
	}

	/* check if only a suffix has been requested */
	if (begin == undefined) {
		if (end >= size)
			return [0, 0, ParseRangeIssue];
		return [size - end, end];
	}

	/* check that the range is well defined */
	if (end < begin || begin >= size || end >= size)
		return [0, 0, ParseRangeIssue];

	/* setup the corrected range */
	return [begin, end - begin + 1, ParseRangeValid];
}
