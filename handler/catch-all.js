/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
import * as libLog from "../server/log.js";

export const SubPath = '';

export function Handle(msg) {
	libLog.Log(`Catch-all not-found handler for [${msg.relative}]`);
	msg.respondNotFound();
}
