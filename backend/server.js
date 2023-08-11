// vim: set ts=4 sw=4:
/*jshint esversion: 6 */
/*
  Copyright (C) 2015-2023  Lars Windolf <lars.windolf@gmx.de>

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
      cors = require('cors'),
      path = require("path"),
      fs = require('fs'),
      app = express(),
      StatefulProcessCommandProxy = require("stateful-process-command-proxy"),
      WebSocketServer = require('websocket').server;

const { exec } = require("child_process");

eval(fs.readFileSync('config.js')+'');
var probes = require('./probes/default.json');
var proxies = {};
var filters = {};

process.title = 'WurmTermBackend';
process.on('uncaughtException', function(err) {
  // dirty catch of broken SSH pipes
  console.log(err.stack);
});

// Hostname matching based on https://stackoverflow.com/questions/106179/regular-expression-to-match-dns-hostname-or-ip-address
const validIpAddressRegex = /^([a-zA-Z0-9]+@){0,1}(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
const validHostnameRegex = /^([a-zA-Z0-9]+@){0,1}(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;

// get history of SSH commands
function get_history(connection) {
    try {
	const cmd = `cat ~/.bash_history | awk '{if (\$1 == \"ssh\" && \$2 ~ /^[a-z0-9]/) {print \$2}}' | tail -50 | sort -u`;
	exec(cmd, (error, stdout, stderr) => {
		if (error)
			throw(error);

		connection.sendUTF(JSON.stringify({
			cmd: 'history',
			result: stdout
				.split(/\n/)
				.filter(h => h.match(validHostnameRegex) || h.match(validIpAddressRegex))
				.filter(s => s.length > 1)
		}));
	});
    } catch(e) {
	done(e);
	return {cmd: 'history', error:e};
    }
}

// get all hosts currently SSH connected
function get_hosts(connection) {
	try {
		const cmd = `pgrep -fla "^ssh " || true`;
		exec(cmd, (error, stdout, stderr) => {
			if (error)
				throw(error);

			var hosts = stdout.split(/\n/)
					.filter(h => h.match(validHostnameRegex) || h.match(validIpAddressRegex))
					.map(s => s.replace(/^[0-9]+ +ssh +/, ''))
					.filter(s => s.length > 1);
			hosts.push('localhost');
			connection.sendUTF(JSON.stringify({
				cmd: 'hosts',
				result: hosts				
			}));
		});
	} catch(e) {
		done(e);
		return {cmd: 'hosts', error:e};
	}
}

function get_probes(connection) {
   // Return all probes and initial flag so a frontend knows
   // where to start
   var output = {};
   Object.keys(probes).forEach(function(probe) {
       var p = probes[probe];
       output[probe] = {
           name        : p.name,
           initial     : p.initial,
           refresh     : p.refresh,
           local       : p.local,
           localOnly   : p.localOnly,
           localFilter : p.localFilter
       };
   });
   connection.sendUTF(JSON.stringify({
	cmd: 'probes',
	result: output
   }));
}

function runFilter(connection, msg) {
    // Use only a single file here as we allow only one filter run at a time below
    var tmpfile = '/tmp/wurmterm_localhost_filter';
    fs.writeFile(tmpfile, msg.stdout, function (err) {
        if (err) {
	    console.log(err);
	    msg.stdout = "";
	    msg.stderr = "Local filter execution failed, writing temporary file failed!";
            connection.sendUTF(JSON.stringify(msg));
        }
    });

    if(undefined === proxies[':localhost_filter']) {
        proxies[':localhost_filter'] = new StatefulProcessCommandProxy({
	    name: ':localhost_filter',
	    max: 1,
	    min: 1,
	    idleTimeoutMS: 60000,
	    logFunction: function(severity,origin,msg) {
		//console.log(severity.toUpperCase() + " " +origin+" "+ msg);
	    },
	    processCommand: "/bin/bash",
	    processArgs: [],
	    processRetainMaxCmdHistory : 0,
	    processInvalidateOnRegex : {
	    //'stderr':[{regex:'.*error.*',flags:'ig'}]
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
    proxies[':localhost_filter'].executeCommands([
	`cat ${tmpfile} | ${probes[msg.probe].localFilter}`,
	`rm ${tmpfile}`
    ]).then(function(res) {
	msg.stdout = res[0].stdout;
	msg.stderr = res[0].stderr;
        connection.sendUTF(JSON.stringify(msg));
    });
}

function probeWS(connection, host, probe) {
    try {
	if(!(probe in probes)) {
		return {host: host, probe: probe, error:'No such probe'};
	}

	if(undefined === proxies[host]) {
	    proxies[host] = new StatefulProcessCommandProxy({
		name: "proxy_"+host,
		max: 1,
		min: 1,
		idleTimeoutMS: 15000,
		logFunction: function(severity,origin,msg) {
		    //console.log(severity.toUpperCase() + " " +origin+" "+ msg);
		},
		processCommand: 'scripts/generic.sh',
		processArgs: [host],
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
	proxies[host].executeCommands([probes[probe].command]).then(function(res) {
	    var msg = {
		cmd    : 'probe',
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

    	    if(undefined !== probes[probe].localFilter) {
		runFilter(connection, msg);
    	    } else {
    		connection.sendUTF(JSON.stringify(msg));
    	    }
	    return;
	}).catch(function(error) {
	    done(e);
	    return {cmd: 'probe', host: host, probe: probe, error:e};
	});
    } catch(e) {
	done(e);
        return {cmd: 'probe', host: host, probe: probe, error:e};
    }
}

// Setup CORS '*' to support a PWA on mobile or some webserver
var corsOptions = {
	origin: "*",
	optionsSuccessStatus: 200,
	methods: "GET, PUT"
};
    
app.use(cors(corsOptions));

const server = http.createServer(app).listen(port);
const wsServer = new WebSocketServer({
    httpServer: server
});

// Websocket endpoint
wsServer.on('request', function(request) {
    const connection = request.accept(null, request.origin);
    connection.on('message', function(message) {
	// General syntax is "<command>[ <parameters>]"
	var cmd    = message.utf8Data.split(/ /)[0];
	var params = message.utf8Data.split(/ /)[1];

	if(cmd === 'hosts')
		return get_hosts(connection);
	if(cmd === 'probes')
		return get_probes(connection);
	if(cmd === 'history')
		return get_history(connection);

	if(cmd === 'probe') {
		// we expect message in format "probe <host>:::<probe>"
		var tmp = params.split(/:::/);
		return probeWS(connection, tmp[0], tmp[1]);
	}

	connection.sendUTF(JSON.stringify({
		cmd: cmd,
		error: 'Unsupported command'
	}));
    });
    connection.on('close', function(reasonCode, description) {
    });
});

console.log(`Server running at ws://127.0.0.1:${port}/`);
