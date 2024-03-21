import * as libLog from "../log.js";
import * as libHttp from "../http.js"
import * as libTemplates from "../templates.js";

export const CatchAllSubPath = '';

export function HandleCatchAll(request, response, secureInternal, url) {
	libLog.Log(`Catch-all not-found handler for [${url.pathname}]`);
	libHttp.RespondTemplate(response, libHttp.StatusCode.NotFound, libTemplates.ErrorNotFound, { path: url.pathname });
}
