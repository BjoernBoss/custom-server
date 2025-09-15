/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2025 Bjoern Boss Henrichsen */
import * as libUrl from 'url';
import * as libPath from "path";
import * as libConfig from "./config.js";

export function sanitize(path) {
	let out = '/';

	/* iterate over the characters and write them to the output */
	for (let i = 0; i < path.length; ++i) {
		/* check if the character can just be written out */
		if (path[i] != '/' && path[i] != '\\') {
			out += path[i];
			continue;
		}

		/* check if the slash can be ignored as the string ends in a slash */
		if (out.endsWith('/'))
			continue;

		/* check if its a relative path step and remove it */
		if (out.endsWith('/.'))
			out = out.slice(0, out.length - 1);
		else if (!out.endsWith('/..'))
			out += '/';
		else if (out == '/..')
			out = '/';
		else
			out = out.slice(0, out.lastIndexOf('/', out.length - 4) + 1);
	}

	/* remove any trailing slashes */
	if (out.endsWith('/') && out != '/')
		out = out.slice(0, out.length);
	return out;
}

export function makeAppPath(urlFilePath, path) {
	let dirName = libPath.dirname(libUrl.fileURLToPath(urlFilePath));
	if (path != undefined)
		dirName = libPath.join(dirName, path);
	return function (path) {
		return dirName + sanitize(path);
	};
}

export function makeStoragePath(name) {
	/* path must be built new everytime, as the storage path might change throughout */
	return function (path) {
		const dirName = libPath.join(libConfig.getStoragePath(), name);
		return dirName + sanitize(path);
	};
}
