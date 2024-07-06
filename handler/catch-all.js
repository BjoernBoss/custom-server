import * as libLog from "../server/log.js";

export const SubPath = '';

export function Handle(msg) {
	libLog.Log(`Catch-all not-found handler for [${msg.relative}]`);
	msg.respondNotFound();
}
