// vim: set ts=4 sw=4:
/* jshint esversion: 6 */

/* IPv4 only netmap renderer

   A view showing per-service connections for a single host in a
   directed graph with inbound and outbound connections for the host
   allowing to traverse the connections */

renderers.netmap = function netmapRenderer() {
	mermaid.initialize({ startOnLoad: false });
};

// parse netstat output
renderers.netmap.prototype.parse = function(results) {
	var listen_port_to_program = {};

	results = results.split(/\n/)
	.map(function(line) {
		return line.split(/\s+/);
	})
	.filter(function(line) {
		if(line.length < 6)
			return false;
		if(line[3].indexOf('127') === 0 &&
		   line[4].indexOf('127') === 0)
			return false;
		if(line[5] === 'LISTEN') {
			if(undefined !== line[6])
				listen_port_to_program[line[3].split(/:+/)[1]] = line[6].split(/\//)[1];
			return false;
		}
		return line[0].indexOf('tcp') === 0;
	})
	.map(function(line) {
		var direction = 'out';
		var ltn = line[3].split(/:/)[1];
		var rtn = line[4].split(/:/)[1];

		// fuzzy: collapse client ports
		if(ltn > 1024 && undefined === listen_port_to_program[ltn])
			ltn = 'high';
		else
			direction = 'in';

		if(rtn > 1024)
			rtn = 'high';
		return {
			scope: (line[6] !== undefined && line[6] !== '-'?line[6].split(/\//)[1]:listen_port_to_program[ltn]),
			cnt  : 1,
			host : line[3].split(/:/)[0],
			ln   : line[3].split(/:/)[0],
			"ltn": ltn,
			rn   : line[4].split(/:/)[0],
			"rtn": rtn,
			dir  : direction
		};
	});

	return { 'results': results };
};

// IP lookup popup helper
renderers.netmap.prototype.lookupIp = function(ip) {
	$.getJSON('http://ipinfo.io/'+ip, function(data){
		alert("IP: "+data.ip+
		      "\nName: "+data.hostname+
		      "\nCity: "+data.city+
		      "\nRegion: "+data.region+
		      "\nCountry: "+data.country+
		      "\nOrg: "+data.org+
		      "\nPostal: "+data.postal
		);
	});
};

renderers.netmap.prototype.render = function(pAPI, id, host) {
	var r = this;

	$(id).html('<i>Loading connections...</i>');

	pAPI.probe(host, 'netstat-a', function(probe, h, input) {
		var data = r.parse(input.stdout);
		if(0 === data.results.length) {
			$(id).html(`<h3>There are currently no connections on this host!</h3><p>Connection data:</p><pre>${
				input.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;")
				.replace(/'/g, "&#039;")
			}</pre>`);
			return;
		}

		var connByService = {};
		$.each(data.results, function(i, item) {
			// Reduce connections to per service connections with ids like
			//   high:::java:::high
			//   high:::apache2:::80
			//   ...
			var id = item.ltn+":::"+item.scope+":::"+item.rtn;
			var s;
			if(item.scope !== "-")
				s = item.scope;
			else
				return; 	// displaying unknown procs is just useless

			if(!(id in connByService))
				connByService[id] = { service: s, "port": item.ltn, in: [], out: [], outPorts: [] };

			var resolvedRemote = item.rn;
			if(item.dir === 'in') {
				connByService[id].in.push(resolvedRemote);
			} else {
				connByService[id].out.push(resolvedRemote);
				connByService[id].outPorts.push(item.rtn);
			}
		});

		// Generate mermaid diagram markup
		var t = 'flowchart LR';
		var counter = 0;
		console.log(connByService);
		$.each(connByService, (id, conn) => {
			var portInfo;
			if(conn.in.length > 0) {
				portInfo = '';
				if(conn.port && conn.port !== 'high')
					portInfo = `|:${conn.port}|`;
				t += `\n   N${counter}[${conn.in.join('\\n')}] --> ${portInfo} N${counter+1}[${conn.service}]`;
			}
			if(conn.out.length > 0) {
				portInfo = '';
				if(conn.outPorts.length > 0 && conn.outPorts[0] !== 'high')
					portInfo = `|:${conn.outPorts[0]}|`;
				t += `\n   N${counter+1}[${conn.service}] --> ${portInfo} N${counter+2}[${conn.out.join('\\n')}]`;
			}
			counter += 3;
		});
		try {
			console.log(t);
			$(id).html(`<pre class="mermaid">${t}</pre>`);
			mermaid.run({ querySelector: `${id} pre.mermaid` });
		} catch(e) {
			console.error(`Failed mermaid rendering: ${e}`);
		}
	}, function(e, probe, h) {
		$(id).html('ERROR: Fetching connection data failed!');
		console.error(`probe Error: host=${h} probe=${probe} ${e}`);
	});
};
