// IPv4 only netmap renderer

renderers.netmap = function netmapRenderer() {
	this.netMapData = {};
	this.previousNode;
};

// parse netstat output
renderers.netmap.prototype.parse = function(results) {
	var listen_port_to_program = {};

	var results = results.split(/\n/)
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
		}
	});

	return { 'results': results };
}

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
	})
}

// FIXME
var viewBoxX =0;
var viewBoxY = 0;

renderers.netmap.prototype.updateGraph = function() {
	var width = $('#netmap').parent().width();
	var height = $('#netmap').parent().height();

    	var svg = d3.select("#netmap")
	  .attr("width", width)
          .attr("height", height);

	// Allow panning as suggested in by dersinces (CC BY-SA 3.0) in
	// http://stackoverflow.com/questions/20099299/implement-panning-while-keeping-nodes-draggable-in-d3-force-layout
	var drag = d3.drag();
	drag.on('drag', function(event) {
	    viewBoxX -= event.dx;
	    viewBoxY -= event.dy;
	    svg.select('g.node-area').attr('transform', 'translate(' + (-viewBoxX) + ',' + (-viewBoxY) + ')');
	});
	svg.append('rect')
	  .classed('bg', true)
	  .attr('stroke', 'transparent')
	  .attr('fill', 'transparent')
	  .attr('x', 0)
	  .attr('y', 0)
	  .attr('width', width)
	  .attr('height', height)
	  .call(drag);

	var nodeArea = svg.append('g').classed('node-area', true);

	var g = new dagreD3.graphlib.Graph()
				.setGraph({ "rankdir": "LR", "ranksep": 75, "nodesep": 12, "marginx": 20, "marginy": 20, "align": "DL" })
				.setDefaultEdgeLabel(function() { return {}; });

	$.each(this.netMapData.nodes, function(i, n) {
		var props = { "label": n.label, "labelType": "html", "class": n.class };
		if(n.class === 'local')
			props.width = 100;
		g.setNode(i, props);
	});

	$.each(this.netMapData.links, function(i, l) {
		if(l.source === undefined || l.target === undefined)
			return;
		var props = { lineInterpolate: 'basis' };
 		if(l.source === 0)
			props.style = "display:none";
 		if(l.dPort && l.dPort !== "high") {
			props.label = (l.dPort.match(/^[0-9]/)?":":"")+l.dPort;
			props.labelpos = 'r';
			props.labeloffset = 5;
		}
		g.setEdge(l.source, l.target, props);
	});

	try {
	var render = new dagreD3.render();
	render(nodeArea, g);
	} catch(e) {
	console.error(e);
	}

	var xCenterOffset = (svg.attr("width") - g.graph().width) / 2;
}

renderers.netmap.prototype.addGraphNode = function(service, direction) {
	var view = this;
	var d = this.netMapData;

	if(service[direction].length > 0) {
		var remote = service[direction].join(",") + direction;
		var nId = d.nodes.length;
		var tmp = "";
		$.each(service[direction], function(i, name) {
			if (i < 6) {
				if (name.match(/^(10\.|172\.(1[6-9]|2.|3[0-1])|192\.168)/))
					tmp += name+"<br/> ";
				else if (name.match(/^[0-9]/))
					tmp += '<a class="resolve" href="javascript:renderers.netmap.prototype.lookupIp(\''+name+'\')" title="Click to resolve IP">'+name+"</a><br/> ";
				else {
					tmp += name+"<br/> ";
				}
			}
			if (i == 6)
				tmp += "<span style='color:#444; font-size:small'>("+(service[direction].length - 6)+" more ...)</span>";
		});

		d.nodes.push({
			"label": tmp
		});
		if(direction === 'in')
			d.links.push({source: d.nodeToId[service.service], target: nId, dPort: service.outPorts[0], weigth: service[direction].length});
		else
			d.links.push({target: d.nodeToId[service.service], source: nId, dPort: service.port, weigth: service[direction].length});
	} else {
		if(direction !== 'in')
			d.links.push({source: 0, target: d.nodeToId[service.service], class: "null", weigth: 0});
	}
}

renderers.netmap.prototype.addHost = function(data) {
	var view = this;
	var host = this.currentNode;
	var found = false;
	var d = this.netMapData = {
		nodeToId: [],
		nodes: [],
		links: []
	};

	// get connections for this host
	{
		var connByService = new Array();
		$.each(data.results, function(i, item) {
			// Reduce connections to per service connections with ids like
			//   high:::java:::high
			//   high:::apache2:::80
			//   ...
			id = item.ltn+":::"+item.scope+":::"+item.rtn;
			var s;
			if(item.scope !== "-")
				s = item.scope;
			else
				return; 	// displaying unknown procs is just useless

			if(!(id in connByService))
				connByService[id] = { service: s, "port": item.ltn, in: [], out: [], outPorts: [] };

			var resolvedRemote = item.rn;
			if(item.dir === 'in') {
				connByService[id].out.push(resolvedRemote);
			} else {
				connByService[id].in.push(resolvedRemote);
				connByService[id].outPorts.push(item.rtn);
			}

			var remoteName;
			if(resolvedRemote.match(/^(10\.|172\.(1[6-9]|2.|3[0-1])|192\.168)/))
				remoteName = resolvedRemote;
			else if(resolvedRemote.match(/^[0-9]/))
				remoteName = '<a class="resolve" href="javascript:lookupIp(\''+resolvedRemote+'\')" title="Click to resolve IP">'+resolvedRemote+'</a>';
			else
				remoteName = resolvedRemote;

			$('#netMapTable tbody').append('<tr>'+
				'<td>'+item.scope+'</td>' +
				'<td>'+item.ln+'</td>' +
				'<td>'+item.ltn+'</td>' +
				'<td>'+remoteName+'</td>' +
				'<td>'+item.rtn+'</td>' +
				'<td>'+item.dir+'</td>' +
				'<td>'+item.cnt+'</td>' +
			'</tr>');
		});

		// We need a fake node to connect as input for programs without
		// incoming connections to force the program nodes to the 2nd rank
		// we will hide this node and its links using CSS
		//
		// Node id is 0
		d.nodes.push({"label": "", class: 'null'});

		for(var id in connByService) {
			var program = connByService[id].service;

			if(!(program in d.nodeToId)) {
				var nId = d.nodes.length;
				d.nodeToId[program] = nId;
				d.nodes.push({"label": program, class: 'local'});
			}
			view.addGraphNode(connByService[id], "in");
			view.addGraphNode(connByService[id], "out");
		}

		view.updateGraph();
	}
}

renderers.netmap.prototype.render = function(id, input) {
	var data = this.parse(input);

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

	$(id).html('<svg id="netmap"/>');
	this.addHost(data);
};
