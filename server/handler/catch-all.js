import * as libLog from "../log.js";

export const CatchAllSubPath = '';

export function HandleCatchAll(msg) {
	libLog.Log(`Catch-all not-found handler for [${msg.url.pathname}]`);
	msg.respondNotFound();
}
