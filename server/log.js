import * as libFs from "fs";

var logIntoConsole = true;
var logFile = {
	path: null,
	logEntries: 0,
	bufMaximum: 1500,
	logMaximum: 10_000,
	fs: null,
	buffer: [],
	flushId: null,
	flushDelay: 1500
};

function FlushToFile() {
	/* write the buffer to the file */
	if (logFile.buffer.length > 0 && logFile.fs != null)
		try { libFs.writeFileSync(logFile.fs, logFile.buffer.join(""), 'utf-8'); } catch (err) { }
	logFile.buffer = [];

	/* clear any currently queued flushes */
	if (logFile.flushId != null) {
		clearTimeout(logFile.flushId);
		logFile.flushId = null;
	}
}
function MakeActualLog(level, msg) {
	const log = `[${new Date().toUTCString()}] ${level}: ${msg}`;

	/* check if the log should be written to the console */
	if (logIntoConsole)
		console.log(log);

	/* check if the log should be written to a file */
	if (logFile.path == null)
		return;

	/* write the log to the buffer and check if the data need to be flushed inplace, or if the flushing can be delayed */
	logFile.buffer.push(`${log}\n`);
	if (logFile.buffer.length >= logFile.bufMaximum)
		FlushToFile();
	else {
		if (logFile.flushId != null)
			clearTimeout(logFile.flushId);
		logFile.flushId = setTimeout(FlushToFile, logFile.flushDelay);
	}

	/* check if the log-files need to be swapped */
	if (++logFile.logEntries < logFile.logMaximum)
		return;
	logFile.logEntries = 0;

	/* flush the buffered entries */
	FlushToFile();

	/* close the current file */
	if (logFile.fs != null) {
		try { libFs.closeSync(logFile.fs); } catch (err) { }
		logFile.fs = null;
	}

	/* move it to the old-slot and open the new file */
	try { libFs.renameSync(logFile.path, `${logFile.path}.old`); } catch (err) { }
	try { logFile.fs = libFs.openSync(logFile.path, 'w'); } catch (err) { }
};

export function SetLogConsole(logConsole) {
	logIntoConsole = logConsole;
}
export function SetFileLogging(filePath) {
	/* check if a logging-file already exists */
	if (logFile.path != null)
		return false;

	/* setup the logging state */
	logFile.path = filePath;
	try { logFile.fs = libFs.openSync(logFile.path, 'w'); } catch (err) { }
}
export function Error(msg) {
	MakeActualLog('Error', msg);
};
export function Info(msg) {
	MakeActualLog('Info', msg);
};
export function Warning(msg) {
	MakeActualLog('Warning', msg);
};
export function Log(msg) {
	MakeActualLog('Log', msg);
};
