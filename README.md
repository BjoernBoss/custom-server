# [MAWS] Multi-App-WebServer to Host various Applications and Server Files and Small Games
![C++](https://img.shields.io/badge/language-Javascript-blue?style=flat-square)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-brightgreen?style=flat-square)](LICENSE.txt)

Small custom webserver written in typescript/javascript, capable to host mutliple separate apps with support for simple http requests and websockets.

To write an application for the service, simply implement the `AppInterface` defined in `core/common.js`. 

## Using the Server
To setup this server simply clone the project:

    $ git clone https://github.com/BjoernBoss/maws-host.git

Afterwards implement the `apps/setup.js` file with its `Run` method.
This method should setup any listeners, as well as register the applications themselves.

Finally install the dependencies, and transpile and start the server:

    $ cd maws-host
    $ npm install
    $ tsc
    $ node server/main.js
