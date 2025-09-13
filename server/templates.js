/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
import * as libLog from "./log.js";
import * as libFs from "fs";
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

/*	Defines:
*		{path}: requested path
*		{operation}: operation
*/
export const SuccessOk = fileRelative('templates/200.html');

/*	Defines:
*		{path}: requested path
*		{new}: new destination
*/
export const PermanentlyMoved = fileRelative('templates/301.html');

/*	Defines:
*		{path}: requested path
*		{new}: new destination
*/
export const TemporaryRedirect = fileRelative('templates/307.html');

/*	Defines:
*		{path}: requested path
*		{reason}: description of issue
*/
export const ErrorBadRequest = fileRelative('templates/400.html');

/*	Defines:
*		{path}: requested path
*/
export const ErrorNotFound = fileRelative('templates/404.html');

/*	Defines:
*		{method}: requested method
*		{allowed}: allowed methods
*		{path}: requested path
*/
export const ErrorInvalidMethod = fileRelative('templates/405.html');

/*	Defines:
*		{conflict}: conflict description
*		{path}: requested path
*/
export const ErrorConflict = fileRelative('templates/409.html');

/*	Defines:
*		{length}: used content length
*		{allowed}: allowed maximum
*		{path}: requested path
*/
export const ErrorContentTooLarge = fileRelative('templates/413.html');

/*	Defines:
*		{used}: used content/media type
*		{allowed}: allowed types
*		{path}: requested path
*/
export const ErrorUnsupportedMediaType = fileRelative('templates/415.html');

/*	Defines:
*		{range}: range
*		{path}: requested path
*		{size}: file-size
*/
export const ErrorRangeIssue = fileRelative('templates/416.html');

/*	Base defines:
*		{path}: path of directory
*		{entries}: appended list of children
*	Entry defines:
*		{path}: path to entry
*		{name}: name of entry
*	Empty defines:
		%none%
*/
export const ListDir = {
	base: fileRelative('templates/list-dir/page.html'),
	entry: fileRelative('templates/list-dir/entry.txt'),
	empty: fileRelative('templates/list-dir/empty.txt')
};

function ExpandPlaceholders(content, map) {
	var out = '', name = '';

	/* construct the new output content */
	var inName = false;
	for (var i = 0; i < content.length; ++i) {
		/* check if this is the start/end of a placeholder */
		if (content[i] != '{' && content[i] != '}') {
			if (inName)
				name += content[i];
			else
				out += content[i];
			continue;
		}

		/* check if the curly bracket is escaped */
		if (i + 1 < content.length && content[i] == content[i + 1]) {
			if (inName)
				name += content[i];
			else
				out += content[i];
			++i;
			continue;
		}

		/* check if a name is being started */
		if (content[i] == '{') {
			if (!inName)
				name = '';
			else
				libLog.Warning('Unescaped opening curly bracket encountered');
			inName = true;
			continue;
		}

		/* check if a name has been completed */
		if (!inName)
			libLog.Warning('Unescaped closing curly bracket encountered');
		else if (!(name in map))
			libLog.Warning(`Undefined placeholder [${name}] encountered`);
		else {
			var value = map[name];
			if (typeof (value) != 'string')
				libLog.Warning(`Placeholder [${name}] is not a string`);
			else
				out += value;
		}
		inName = false;
	}

	/* check if a last name was not closed properly */
	if (inName)
		libLog.Warning('Content ends with an incomplete placeholder');
	return out;
};

export function Expand(content, args) {
	return ExpandPlaceholders(content, args);
};
export function Load(name) {
	return libFs.readFileSync(name, 'utf-8');
};
export function LoadExpanded(name, args) {
	return ExpandPlaceholders(libFs.readFileSync(name, 'utf-8'), args);
};
