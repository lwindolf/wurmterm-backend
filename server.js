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
	WebSocket = require('ws'),
	exec = require("child_process"),
	promisify = require('util').promisify,
	execPromise = promisify(exec.exec);

const config = require(os.homedir() + '/.config/wurmterm/config.json');
const probes = require('./probes/default.json');
var proxies = {};

process.title = 'WurmTermBackend';
process.on('uncaughtException', function (err) {
	// dirty catch of broken SSH pipes
	console.log(err.stack);
});

// Hostname matching based on https://stackoverflow.com/questions/106179/regular-expression-to-match-dns-hostname-or-ip-address
const validIpAddressRegex = /^([a-zA-Z0-9]+@){0,1}(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
const validHostnameRegex = /^([a-zA-Z0-9]+@){0,1}(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;

function get_status() {
	return {
		result: Object.entries(proxies).map(([k,v]) => {
			return { name: k, status: v.getStatus() };
		})
	};
}

async function get_kubectxt() {
	return {
		result: {
			contexts: await execPromise(`kubectl config view -o jsonpath='{.contexts}'`).then(({ stdout, stderr }) => {
				if (stderr) {
					console.error(stderr);
					throw(`Error fetching kubectl contexts!`);
				}
				return JSON.parse(stdout);
			}),
			"current-context": await execPromise(`kubectl config current-context`).then(({ stdout, stderr }) => {
				if (stderr) {
					console.error(stderr);
					throw(`Error fetching current kubectl context!`);
				}
				return stdout.trim();
			})
		}
	};
}

// get history of SSH commands
async function get_history() {
	const cmd = `cat ~/.bash_history | awk '{if (\$1 == \"ssh\" && \$2 ~ /^[a-z0-9]/) {print \$2}}' | tail -50 | sort -u`;
	return execPromise(cmd).then(({ stdout, stderr }) => {
		return {
			result: stdout
				.split(/\n/)
				.filter(h => h.match(validHostnameRegex) || h.match(validIpAddressRegex))
				.filter(s => s.length > 1)
		};
	});
}

// get all hosts currently SSH connected
async function get_hosts() {
	const cmd = 'pgrep -fla "^ssh " || true';
	return execPromise(cmd).then(({ stdout, stderr }) => {
		let hosts = stdout.split(/\n/)
			.map(s => s.replace(/^[0-9]+ +ssh +/, ''))
			.filter(h => h.match(validHostnameRegex) || h.match(validIpAddressRegex))
			.filter(s => s.length > 1);
		hosts.push('localhost');
		return {
			result: hosts
		};
	});
}

// Return all probes including initial flag so a frontend knows where to start
function get_probes() {
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
	return {
		cmd: 'probes',
		result: output
	};
}

async function runFilter(msg) {
	// Use only a single file here as we allow only one filter run at a time below
	let tmpfile = '/tmp/wurmterm_localhost_filter';
	fs.writeFile(tmpfile, msg.stdout, function (err) {
		if (err) {
			console.log(err);
			msg.stdout = "";
			msg.stderr = "Local filter execution failed, writing temporary file failed!";
			return msg;
		}
	});

	const res = await getProxy(':localhost_filter', timeout = 60000).executeCommands([
		`cat ${tmpfile} | ${probes[msg.probe].localFilter}`,
		`rm ${tmpfile}`
	]);
	msg.stdout = res[0].stdout;
	msg.stderr = res[0].stderr;
	return msg;
}

function getProxy(name, processCommand = "/bin/bash", processArgs = []) {
	if (undefined === proxies[name]) {
		proxies[name] = new StatefulProcessCommandProxy({
			name,
			max: 1,
			min: 1,
			idleTimeoutMS: 15000,
			processCommand,
			processArgs,
			processRetainMaxCmdHistory: 0,
			processInvalidateOnRegex: {
				'stderr': [{ regex: '.*error.*', flags: 'ig' }]
			},
			processCwd: './',
			initCommands: ['LANG=C;echo'],	// to catch banners and pseudo-terminal warnings
			validateFunction: function (processProxy) {
				return processProxy.isValid();
			},
		});
	}
	return proxies[name];
}

const commands = {
	hosts		: get_hosts,
	probes		: get_probes,
	history		: get_history,
	kubectxt	: get_kubectxt,
	status		: get_status,

	localnet: async () =>
		getProxy(':localnet_discover')
		.executeCommands(['node scripts/local-network-discover.mjs'])
		.then((res) => { return { result: JSON.parse(res[0].stdout) }}),

	probe_kubectxt: async (id) =>
		getProxy(':probe_kubectxt')
		.executeCommands([`node scripts/kubernetes.mjs ${id}`])
		.then((res) => { return { result: JSON.parse(res[0].stdout) }}),

	run: async (host, cmd) =>
		getProxy(host, 'scripts/generic.sh', [host])
		.executeCommands([cmd])
		.then((res) => {
			return {
				shell: cmd,
				host,
				id,
				stdout: res[0].stdout,
				stderr: res[0].stderr
			};
		}),

    probe: async (host, probe) => {
		if (!(probe in probes))
			return { host, probe, error: 'No such probe' };

		return await getProxy(host, 'scripts/generic.sh', [host])
		.executeCommands([probes[probe].command])
		.then(async (res) => {
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
				return await runFilter(socket, msg);
			} else {
				return msg;
			}
		})
	}
}

async function command(socket, name, params = []) {
	try {
		let msg = await commands[name](...params);
		msg.cmd = name;
		socket.send(JSON.stringify(msg));
	} catch (e) {
		console.error(e);
		socket.send(JSON.stringify({ cmd: name, ...params, error: e }));
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

var clientAuth = {};
var credential = Buffer.from(config.client.auth, 'base64').toString();

wsServer.on('connection', (ws) => {
	clientAuth[ws] = false;

	ws.on('error', console.error);

	// Send a version so frontend can check for compatibility
	ws.send(JSON.stringify({ cmd: 'version', value: '0.9.13' }));

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
			if (['hosts', 'probes', 'history', 'kubectxt', 'localnet', 'status'].includes(m[1]))
				return command(ws, m[1]);

			if (m[0].match(/^run (\w+):::(\w+):::(.+)$/))
				return command(ws, m[1], [RegExp.$1, RegExp.$2, RegExp.$3]);

			if (m[0].match(/^probe_kubectxt (\S+)$/))
				return command(ws, m[1], [RegExp.$1]);

			if (m[0].match(/^probe (\S+):::(\w+)$/))
				return command(ws, m[1], [RegExp.$1, RegExp.$2]);
		}
		ws.send(JSON.stringify({ cmd: m[1], error: 'Unsupported command' }));
	});
	ws.on('close', () => {});
});

console.log(`Server running at ws://${config.server.host}:${config.server.port}/`);
