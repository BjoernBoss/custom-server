
function makeActualLog(level, msg) {
	console.log(`[${new Date().toUTCString()}] ${level}: ${msg}`);
};

export function Error(msg) {
	makeActualLog('Error', msg);
};
export function Info(msg) {
	makeActualLog('Info', msg);
};
export function Warning(msg) {
	makeActualLog('Warning', msg);
};
export function Log(msg) {
	makeActualLog('Log', msg);
};
