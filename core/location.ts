/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2025 Bjoern Boss Henrichsen */
import * as libUrl from 'url';
import * as libPath from "path";

/* sanitize path and remove relative path components */
export function Sanitize(path: string): string {
	let out = '/';

	/* iterate over the characters and write them to the output
	*	(i == path.length is a final implicit slash to catch '/..') */
	for (let i = 0; i <= path.length; ++i) {
		/* check if the character can just be written out */
		if (i < path.length && path[i] != '/' && path[i] != '\\') {
			out += path[i];
			continue;
		}

		/* check if the slash can be ignored as the string ends in a slash */
		if (out.endsWith('/'))
			continue;

		/* check if its a relative path step and remove it */
		if (out.endsWith('/.'))
			out = out.substring(0, out.length - 1);
		else if (!out.endsWith('/..')) {
			if (i + 1 >= path.length)
				return out;
			out += '/';
		}
		else if (out == '/..')
			out = '/';
		else
			out = out.substring(0, out.lastIndexOf('/', out.length - 4) + 1);
	}

	/* remove any trailing slashes */
	if (out.endsWith('/') && out != '/')
		out = out.substring(0, out.length - 1);
	return out;
}

/* join two sanitized paths */
export function Join(a: string, b: string): string {
	if (a.length == 0 || b.length == 0)
		return (a.length == 0 ? b : a);
	const aSlash = a.endsWith('/'), bSlash = b.startsWith('/');
	if (aSlash)
		return (bSlash ? a + b.substring(1) : a + b);
	return (bSlash ? a + b : `${a}/${b}`);
}

/* create path-creator, which returns sanitized paths relative to [path] */
export function MakeLocation(path: string): (path: string) => string {
	return function (p) {
		return libPath.join(path, Sanitize(p));
	};
}

/* create path-creator, which returns paths within the app base path and optionally the nested path [path] */
export function MakeAppPath(urlFilePath: string, path: string | null = null): (path: string) => string {
	let dirName = libPath.dirname(libUrl.fileURLToPath(urlFilePath));
	if (path != null)
		dirName = libPath.join(dirName, Sanitize(path));
	return MakeLocation(dirName);
}
