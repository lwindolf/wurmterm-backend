// vim: set ts=4 sw=4:
/*jshint esversion: 6 */
/*
  Copyright (C) 2015-2025  Lars Windolf <lars.windolf@gmx.de>

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

const http = require('http'),
	express = require('express'),
	cors = require('cors'),
	os = require('os'),
	fs = require('fs'),
	app = express(),
	StatefulProcessCommandProxy = require("stateful-process-command-proxy"),
	WebSocket = require('ws');

const { exec } = require("child_process");

var config = require(os.homedir() + '/.config/wurmterm/config.json');
var probes = require('./probes/default.json');
var proxies = {};
var filters = {};

process.title = 'WurmTermBackend';
process.on('uncaughtException', function (err) {
	// dirty catch of broken SSH pipes
	console.log(err.stack);
});

// Hostname matching based on https://stackoverflow.com/questions/106179/regular-expression-to-match-dns-hostname-or-ip-address
const validIpAddressRegex = /^([a-zA-Z0-9]+@){0,1}(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
const validHostnameRegex = /^([a-zA-Z0-9]+@){0,1}(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;

function get_status(socket) {
	socket.send(JSON.stringify({
		cmd: 'status',
		result: Object.entries(proxies).map(([k,v]) => {
			return { name: k, status: v.getStatus() }
		})
	}));
}

// get history of kubectl contexts
function get_kubectxt(socket) {
	try {
		const cmd = 'kubectl config view -o jsonpath="{.contexts}"';
		exec(cmd, (error, stdout, stderr) => {
			if (error)
				throw (error);

			socket.send(JSON.stringify({
				cmd: 'kubectxt',
				result: JSON.parse(stdout)
			}));
		});
	} catch (e) {
		return { cmd: 'kubectxt', error: e };
	}
}

// get history of SSH commands
function get_history(socket) {
	try {
		const cmd = `cat ~/.bash_history | awk '{if (\$1 == \"ssh\" && \$2 ~ /^[a-z0-9]/) {print \$2}}' | tail -50 | sort -u`;
		exec(cmd, (error, stdout, stderr) => {
			if (error)
				throw (error);

			socket.send(JSON.stringify({
				cmd: 'history',
				result: stdout
					.split(/\n/)
					.filter(h => h.match(validHostnameRegex) || h.match(validIpAddressRegex))
					.filter(s => s.length > 1)
			}));
		});
	} catch (e) {
		return { cmd: 'history', error: e };
	}
}

// get all hosts currently SSH connected
function get_hosts(socket) {
	try {
		const cmd = 'pgrep -fla "^ssh " || true';
		exec(cmd, (error, stdout, stderr) => {
			if (error)
				throw (error);

			let hosts = stdout.split(/\n/)
				.map(s => s.replace(/^[0-9]+ +ssh +/, ''))
				.filter(h => h.match(validHostnameRegex) || h.match(validIpAddressRegex))
				.filter(s => s.length > 1);
			hosts.push('localhost');
			socket.send(JSON.stringify({
				cmd: 'hosts',
				result: hosts
			}));
		});
	} catch (e) {
		return { cmd: 'hosts', error: e };
	}
}

// Return all probes including initial flag so a frontend knows where to start
function get_probes(socket) {
	let output = {};
	Object.keys(probes).forEach(function (probe) {
		let p = probes[probe];
		output[probe] = {
			name: p.name,
			command: p.command,
			initial: p.initial,
			refresh: p.refresh,
			local: p.local,
			localOnly: p.localOnly,
			localFilter: p.localFilter,
			runbook: p.runbook
		};
	});
	socket.send(JSON.stringify({
		cmd: 'probes',
		result: output
	}));
}

function runFilter(socket, msg) {
	// Use only a single file here as we allow only one filter run at a time below
	let tmpfile = '/tmp/wurmterm_localhost_filter';
	fs.writeFile(tmpfile, msg.stdout, function (err) {
		if (err) {
			console.log(err);
			msg.stdout = "";
			msg.stderr = "Local filter execution failed, writing temporary file failed!";
			socket.send(JSON.stringify(msg));
		}
	});

	if (undefined === proxies[':localhost_filter']) {
		proxies[':localhost_filter'] = new StatefulProcessCommandProxy({
			name: ':localhost_filter',
			max: 1,
			min: 1,
			idleTimeoutMS: 60000,
			logFunction: function (severity, origin, msg) {
				//console.log(severity.toUpperCase() + " " +origin+" "+ msg);
			},
			processCommand: "/bin/bash",
			processArgs: [],
			processRetainMaxCmdHistory: 0,
			processInvalidateOnRegex: {
				//'stderr':[{regex:'.*error.*',flags:'ig'}]
			},
			processCwd: './',
			processUid: null,
			processGid: null,
			initCommands: ['LANG=C;echo'],	// to catch banners and pseudo-terminal warnings
			validateFunction: function (processProxy) {
				return processProxy.isValid();
			},
		});
	}
	proxies[':localhost_filter'].executeCommands([
		`cat ${tmpfile} | ${probes[msg.probe].localFilter}`,
		`rm ${tmpfile}`
	]).then(function (res) {
		msg.stdout = res[0].stdout;
		msg.stderr = res[0].stderr;
		socket.send(JSON.stringify(msg));
	});
}

function getProxy(host) {
	if (undefined === proxies[host]) {
		proxies[host] = new StatefulProcessCommandProxy({
			name: "proxy_" + host,
			max: 1,
			min: 1,
			idleTimeoutMS: 15000,
			logFunction: function (severity, origin, msg) {
				//console.log(severity.toUpperCase() + " " +origin+" "+ msg);
			},
			processCommand: 'scripts/generic.sh',
			processArgs: [host],
			processRetainMaxCmdHistory: 0,
			processInvalidateOnRegex: {
				'stderr': [{ regex: '.*error.*', flags: 'ig' }]
			},
			processCwd: './',
			processUid: null,
			processGid: null,
			initCommands: ['LANG=C;echo'],	// to catch banners and pseudo-terminal warnings
			validateFunction: function (processProxy) {
				return processProxy.isValid();
			},
		});
	}
	return proxies[host];
}

// discover local network services via mDNS and SSDP
function get_localnet(socket) {
	if (undefined === proxies[':localnet_discover']) {
		proxies[':localnet_discover'] = new StatefulProcessCommandProxy({
			name: ':localnet_discover',
			max: 1,
			min: 1,
			idleTimeoutMS: 60000,
			logFunction: function (severity, origin, msg) {
				//console.log(severity.toUpperCase() + " " +origin+" "+ msg);
			},
			processCommand: "/bin/bash",
			processArgs: [],
			processRetainMaxCmdHistory: 0,
			processInvalidateOnRegex: {
				//'stderr':[{regex:'.*error.*',flags:'ig'}]
			},
			processCwd: './',
			processUid: null,
			processGid: null,
			initCommands: ['LANG=C;echo'],	// to catch banners and pseudo-terminal warnings
			validateFunction: function (processProxy) {
				return processProxy.isValid();
			},
		});
	}

	getProxy(':localnet_discover').executeCommands([
		'node scripts/local-network-discover.mjs'
	]).then(function (res) {
		socket.send(JSON.stringify({
			cmd: 'localnet',
			result: JSON.parse(res[0].stdout)
		}));
	}).catch(function (e) {
		return { cmd: 'localnet', error: e };
	});
}

function probeWS(socket, host, probe) {
	try {
		if (!(probe in probes))
			return { host, probe, error: 'No such probe' };

		getProxy(host).executeCommands([probes[probe].command]).then(function (res) {
			let msg = {
				cmd: 'probe',
				host: host,
				probe: probe,
				stdout: res[0].stdout,
				stderr: res[0].stderr,
				next: []
			};

			if ('name'   in probes[probe]) msg.name   = probes[probe].name;
			if ('render' in probes[probe]) msg.render = probes[probe].render;
			if ('type'   in probes[probe]) msg.type   = probes[probe].type;
			// Suggest followup probes
			for (let p in probes) {
				if (probes[p]['if'] === probe && -1 !== res[0].stdout.indexOf(probes[p].matches))
					msg.next.push(p);
			}

			if (undefined !== probes[probe].localFilter) {
				runFilter(socket, msg);
			} else {
				socket.send(JSON.stringify(msg));
			}
			return;
		}).catch(function (e) {
			return { cmd: 'probe', host: host, probe: probe, error: e };
		});
	} catch (e) {
		return { cmd: 'probe', host: host, probe: probe, error: e };
	}
}

function run(socket, host, id, cmd) {
	try {
		getProxy(host).executeCommands([cmd]).then(function (res) {
			let msg = {
				cmd: 'run',
				shell: cmd,
				host: host,
				id: id,
				stdout: res[0].stdout,
				stderr: res[0].stderr
			};

			socket.send(JSON.stringify(msg));
			return;
		}).catch(function (e) {
			return { cmd: 'run', host: host, id: id, error: e };
		});
	} catch (e) {
		return { cmd: 'run', host: host, id: id, error: e };
	}
}

// Setup CORS '*' to support PWAs
var corsOptions = {
	origin: "*",
	optionsSuccessStatus: 200,
	methods: "GET, PUT"
};

app.use(cors(corsOptions));

const server = http.createServer(app).listen(config.server.port);
const wsServer = new WebSocket.Server({
	server: server,
	path: "/wurmterm"
});

var clientAuth = [];
var credential = Buffer.from(config.client.auth, 'base64').toString();

wsServer.on('connection', (ws, req, client) => {
	clientAuth[ws] = false;

	ws.on('error', console.error);

	// Send a version so frontend can check for compatibility
	ws.send(JSON.stringify({
		cmd: 'version',
		value: '0.9.12'
	}));

	ws.on('message', function (message) {
		// Auth message handling
		let m = ('' + message).match(/^auth (\w+)$/);
		if (m && m[1] && (m[1] === credential)) {
			clientAuth[ws] = true;
			ws.send(JSON.stringify({
				cmd: 'auth',
				result: 0
			}));
			return;
		}

		// Bail out if not authorized
		if (!clientAuth[ws]) {
			ws.send(JSON.stringify({
				cmd: 'auth',
				result: 1
			}));
			return;
		}

		// General syntax is "<command>[ <parameters>]"
		m = ('' + message).match(/^(\w+)( (.+))?$/m);
		if (m) {
			let cmd = m[1];
			let params = m[3];

			if (cmd === 'hosts')
				return get_hosts(ws);
			if (cmd === 'probes')
				return get_probes(ws);
			if (cmd === 'history')
				return get_history(ws);
			if (cmd === 'kubectxt')
				return get_kubectxt(ws);
			if (cmd === 'localnet')
				return get_localnet(ws);
			if (cmd === 'status')
				return get_status(ws);

			if (cmd === 'run') {
				// we expect message in format "run <host>:::<id>:::<cmd>"
				let tmp = params.split(/:::/);
				return run(ws, tmp[0], tmp[1], tmp[2]);
			}

			if (cmd === 'probe') {
				// we expect message in format "probe <host>:::<probe>"
				let tmp = params.split(/:::/);
				return probeWS(ws, tmp[0], tmp[1]);
			}
		}
		ws.send(JSON.stringify({
			cmd: m[1],
			error: 'Unsupported command'
		}));
	});
	ws.on('close', function (reasonCode, description) {
	});
});

console.log(`Server running at ws://${config.server.host}:${config.server.port}/`);
