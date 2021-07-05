// vim: set ts=4 sw=4:
/*jshint esversion: 6 */
/*
  Copyright (C) 2015-2021  Lars Windolf <lars.windolf@gmx.de>

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

const http = require("http"),
      express = require("express"),
      path = require("path"),
      app = express(),
      StatefulProcessCommandProxy = require("stateful-process-command-proxy"),
      WebSocketServer = require('websocket').server;

const { exec } = require("child_process");

var probes = require('./probes/default.json');
var proxies = {};

process.on('uncaughtException', function(err) {
  // dirty catch of broken SSH pipes
  console.log(err.stack);
});

// Hostname matching based on https://stackoverflow.com/questions/106179/regular-expression-to-match-dns-hostname-or-ip-address
const validIpAddressRegex = /^([a-zA-Z0-9]+@){0,1}(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
const validHostnameRegex = /^([a-zA-Z0-9]+@){0,1}(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;

// Remote server probe API

function get_history(request, response) {
    try {
	const cmd = `cat ~/.bash_history | awk '{if (\$1 == \"ssh\" && \$2 ~ /^[a-z0-9]/) {print \$2}}' | tail -50 | sort -u`;
	exec(cmd, (error, stdout, stderr) => {
	    if (error) {
		response.writeHead(500, {'Content-Type': 'text/plain'});
		response.end(`Error: failed to fetch SSH history`);
	    } else {

		var results = stdout.split(/\n/).filter(h => h.match(validHostnameRegex) || h.match(validIpAddressRegex));
                response.writeHead(200, {'Content-Type': 'application/json'});
	        response.end(JSON.stringify(results
		    .filter(s => s.length > 1)
		));
	        return;
	    }
	});
    } catch(e) {
	response.writeHead(501, {'Content-Type': 'text/plain'});
	console.log(e);
	response.end("Exception: "+JSON.stringify(e));
    }
}

function get_hosts(request, response) {

    try {
	const cmd = `pgrep -fla "^ssh " || true`;
	exec(cmd, (error, stdout, stderr) => {
	    if (error) {
		response.writeHead(500, {'Content-Type': 'text/plain'});
		response.end(`Error: error: ${error.message} stderr: ${stderr}`);
	    } else {
		var results = stdout.split(/\n/).filter(h => h.match(validHostnameRegex) || h.match(validIpAddressRegex));
		results.push('localhost');
                response.writeHead(200, {'Content-Type': 'application/json'});
	        response.end(JSON.stringify(results
		    .map(s => s.replace(/^[0-9]+ +ssh +/, ''))
		    .filter(s => s.length > 1)
		));
	        return;
	    }
	});
    } catch(e) {
	response.writeHead(501, {'Content-Type': 'text/plain'});
	console.log(e);
	response.end("Exception: "+JSON.stringify(e));
    }
}

function get_probes(request, response) {
   response.writeHead(200, {'Content-Type': 'application/json'});

   // Return all probes and initial flag so a frontend knows
   // where to start
   var output = {};
   Object.keys(probes).forEach(function(probe) {
       var p = probes[probe];
       output[probe] = {
           name      : p.name,
           initial   : p.initial,
           refresh   : p.refresh,
           local     : p.local,
           localOnly : p.localOnly
       };
   });
   response.end(JSON.stringify(output));
}

function probeWS(connection, host, probe) {
    try {
	if(!(probe in probes)) {
		return {host: host, probe: probe, error:'No such probe'};
	}
	var cmd = probes[probe].command;
	if(undefined === proxies[host]) {
	    proxies[host] = new StatefulProcessCommandProxy({
		name: "proxy_"+host,
		max: 1,
		min: 1,
		idleTimeoutMS: 15000,
		logFunction: function(severity,origin,msg) {
		//console.log(severity.toUpperCase() + " " +origin+" "+ msg);
		},
		processCommand: ((host === 'localhost')?'/bin/bash':'/usr/bin/ssh'),
		processArgs:  ((host === 'localhost')?[]:['-o', 'UserKnownHostsFile=/dev/null', '-o', 'StrictHostKeyChecking=no', '-o', 'PreferredAuthentications=publickey', host]),
		processRetainMaxCmdHistory : 0,
		processInvalidateOnRegex : {
		    'stderr':[{regex:'.*error.*',flags:'ig'}]
		},
		processCwd : './',
		processUid : null,
		processGid : null,
		initCommands : ['LANG=C;echo'],	// to catch banners and pseudo-terminal warnings
		validateFunction: function(processProxy) {
		    return processProxy.isValid();
		},
	    });
	}
	proxies[host].executeCommands([cmd]).then(function(res) {
	    var msg = {
	        host   : host,
		probe  : probe,
		stdout : res[0].stdout,
		stderr : res[0].stderr,
		next   : []
	    };

	    if('name'    in probes[probe]) msg.name    = probes[probe].name;
	    if('render'  in probes[probe]) msg.render  = probes[probe].render;
	    if('type'    in probes[probe]) msg.type    = probes[probe].type;
	    // Suggest followup probes
	    for(var p in probes) {
		if(probes[p]['if'] === probe && -1 !== res[0].stdout.indexOf(probes[p].matches))
		    msg.next.push(p);
	    }
	    connection.sendUTF(JSON.stringify(msg));
	    return;
	}).catch(function(error) {
	    done(e);
	    return {host: host, probe: probe, error:e};
	});
    } catch(e) {
	done(e);
        return {host: host, probe: probe, error:e};
    }
}

// Routing

app.get('/api/history', function(req, res) {
   get_history(req, res);
});

app.get('/api/hosts', function(req, res) {
   get_hosts(req, res);
});

app.get('/api/probes', function(req, res) {
   get_probes(req, res);
});

app.use(express.static(path.join(__dirname, 'assets')));
['jquery', 'd3', 'dagre-d3'].forEach(function(name) {
    app.use(`/lib/${name}`, [ express.static(path.join(__dirname, 'node_modules', name, 'dist')) ]);
});

app.all('*', function(req, res) {
   res.sendfile('index.html', { root: 'assets' });
});

const server = http.createServer(app).listen(8181);
process.title = 'WTBackend';

const wsServer = new WebSocketServer({
    httpServer: server
});

// Websocket endpoint
wsServer.on('request', function(request) {
    const connection = request.accept(null, request.origin);
    connection.on('message', function(message) {
	// we expect message in format <host>:::<probe>
	var tmp = message.utf8Data.split(/:::/);
	probeWS(connection, tmp[0], tmp[1]);
    });
    connection.on('close', function(reasonCode, description) {
    });
});


console.log('Server running at http://127.0.0.1:8181/');
