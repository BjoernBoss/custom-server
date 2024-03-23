import * as libFs from "fs";

var logIntoConsole = true;
var logFile = {
	configured: false,
	logFilePath: null,
	oldFilePath: null,
	logFileSize: 0,
	bufMaximumLines: 1500,
	logMaximumSize: 10_000_000,
	fs: null,
	buffer: [],
	flushId: null,
	flushDelay: 1500
};

function FlushToFile() {
	console.log('flushing into file');

	/* write the buffer to the file */
	if (logFile.buffer.length > 0 && logFile.fs != null) {
		const content = Buffer.from(logFile.buffer.join(""), 'utf-8');
		try { libFs.writeFileSync(logFile.fs, content); } catch (err) { }
		logFile.logFileSize += content.length;
	}
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
	if (!logFile.configured)
		return;

	/* write the log to the buffer and check if the data need to be flushed inplace, or if the flushing can be delayed */
	logFile.buffer.push(`${log}\n`);
	if (logFile.buffer.length >= logFile.bufMaximumLines)
		FlushToFile();
	else {
		if (logFile.flushId != null)
			clearTimeout(logFile.flushId);
		logFile.flushId = setTimeout(FlushToFile, logFile.flushDelay);
	}

	/* check if the log-files need to be swapped */
	if (logFile.logFileSize < logFile.logMaximumSize)
		return;

	/* flush the buffered entries */
	FlushToFile();

	/* close the current file */
	if (logFile.fs != null) {
		try { libFs.closeSync(logFile.fs); } catch (err) { }
		logFile.fs = null;
	}

	/* move it to the old-slot and open the new file */
	try { libFs.renameSync(logFile.logFilePath, logFile.oldFilePath); } catch (err) { }
	try { logFile.fs = libFs.openSync(logFile.logFilePath, 'w'); } catch (err) { }
	logFile.logFileSize = 0;
};

export function SetLogConsole(logConsole) {
	logIntoConsole = logConsole;
}
export function SetFileLogging(filePath) {
	/* check if a logging-file already exists */
	if (logFile.configured)
		return false;
	logFile.configured = true;

	/* setup the two paths */
	logFile.logFilePath = `${filePath}.log`;
	logFile.oldFilePath = `${filePath}.old.log`;

	/* setup the logging state */
	try { logFile.fs = libFs.openSync(logFile.logFilePath, 'a'); } catch (err) { }
	try { logFile.logFileSize = libFs.fstatSync(logFile.fs).size; } catch (err) { }
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
