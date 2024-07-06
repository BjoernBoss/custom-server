import * as libLog from "../server/log.js";
import * as libPath from "path";

export const SubPath = '/game';
const ActualPath = libPath.resolve('./www/game');

/* global state */
var GameState = { uniqueId: 0 };

function AcceptWebSocketClient(ws) {
	var uniqueId = ++GameState.uniqueId;
	libLog.Log(`Game WebSocket for [client] accepted with unique-id [${uniqueId}]`);

	/* setup the client-state */
	var client = {
		name: '',
		uniqueId: uniqueId,
		log: function (msg) { libLog.Log(`WS-Client[${uniqueId}]: ${msg}`); }
	};

	/* register the callbacks */
	ws.on('message', function (msg) {
		try {
			HandleClientMessage(ws, JSON.parse(msg), client);
		} catch (err) {
			libLog.Error(`WS-Client[${uniqueId}]: exception while handling client: [${err}]`);
			ws.close();
		}
	});
	ws.on('close', function () {
		client.log(`websocket closed`);
		ws.close();
	});
}

function HandleClientMessage(ws, msg, client) {
	if (typeof (msg.cmd) != 'string' || msg.cmd == '')
		throw new Error('invalid command-structure with missing [cmd] encountered');
	client.log(`handling command: [${msg.cmd}]`);

	/* check if its the init command */
	if (msg.cmd == 'init') {
		if (typeof (msg.name) != 'string' || msg.name == '')
			throw new Error('invalid [init] command received');
		if (client.name != '')
			throw new Error('client has already been initialized');

		/* setup the clients name */
		client.name = msg.name;
		client.log(`name assigned: [${client.name}]`);
		return;
	}

	/* check if the client has been registered properly */
	if (client.name == '')
		throw new Error('client has not yet been initialized');

	/* handle the command */
	switch (msg.cmd) {
		default:
			throw new Error(`unknown command [${msg.cmd}] encountered`);
	}
}

export function Handle(msg) {
	libLog.Log(`Game handler for [${msg.relative}]`);

	/* check if its the root-request and forward it accordingly */
	if (msg.relative == '/') {
		msg.tryRespondFile(libPath.join(ActualPath, './main.html'), false);
		return;
	}

	/* check if its a web-socket request */
	if (msg.relative == '/ws-client') {
		if (msg.tryAcceptWebSocket((ws) => AcceptWebSocketClient(ws)))
			return;
		libLog.Log(`Invalid request for web-socket point`);
		this.respondNotFound();
		return;
	}

	/* respond to the request by trying to server the file */
	msg.tryRespondFile(libPath.join(ActualPath, '.' + msg.relative), false);
}
