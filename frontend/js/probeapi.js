// vim: set ts=4 sw=4:
/* jshint esversion: 6 */

/* Probe API singleton, allowing one host being probed at a time.
   Manages auto-updates, host discovery and probe dependency tree  */

function ProbeAPI(updateHostsCb, updateHistoryCb) {
	if(arguments.callee._singletonInstance) {
		return arguments.callee._singletonInstance;
	}

	arguments.callee._singletonInstance = this;

	var a = this;
	a.probes = {};
	a.hosts = {};

	a.connect = function() {
		a.ws = undefined;
		setInfo('Connecting backend ...')
		try {
			var ws = new WebSocket(settings.backendEndpoint);
			ws.onerror = function(e) {
				setInfo(`⛔ Backend websocket error!`);
				setTimeout(function() {a.connect()}, 5000);
			};
			ws.onclose = function(e) {
				setInfo(`⛔ Backend websocket suddenly closed!`);
				setTimeout(function() {a.connect()}, 5000);
			}
			ws.onmessage = function(e) {
				try {
					var d = JSON.parse(e.data);
					if(d.cmd === 'history')
						a._updateHistoryCb(d.result);
					if(d.cmd === 'hosts')
						a._updateHostsCb(d.result);
					if(d.cmd === 'probes') {
						a.probes = d.result;
						settingsDialog();
					}

					if(d.cmd === 'probe') {
						var p = a.hosts[d.host].probes[d.probe];

						if(undefined === p) {
							console.error(`Message ${d} misses probe info or does not match known probe!`);
						} else {
							p.updating = false;
							p.timestamp = Date.now();
							if(undefined === d.error) {
								// Always trigger follow probes, serialization is done in backend
								for(var n in d.next) {
									ws.send(`${d.host}:::${d.next[n]}`);
								}
								p.cb(d.probe, d.host, d);

								// Always trigger follow probes, serialization is done in backend
								for(n in d.next) {
									a.probe(d.host, d.next[n], p.cb, p.errorCb);
								}
							} else {
								p.errorCb(d.e, d.probe, d.host);
							}
						}
					}
				} catch(ex) {
					console.error(`Exception: ${ex}\nMessage: ${JSON.stringify(ex)}`);
				}
			};
			ws.onopen = function(e) {
				a._updateHosts();
				ws.send("probes");
				ws.send("history");
			}
			a.ws = ws;
		} catch(e) {
			setInfo(`⛔ Backend websocket setup failed (${e})!`);
			setTimeout(function() {a.connect()}, 5000);
		}
	};

	a.getProbeByName = function(name) {
	    return a.probes[name];
	};

	// History CB is a one-shot only
	a._updateHistoryCb = updateHistoryCb;

	// Setup periodic host update fetch and callback
	a._updateHostsCb = updateHostsCb;
	a._updateHosts = function() {
		try {
			a.ws.send(`hosts`);
		} catch(e) { }

		if(a._updateHostsTimeout)
                	clearTimeout(a._updateHostsTimeout);
        
		a._updateHostsTimeout = setTimeout(function () {
			a._updateHosts();
		}, settings.refreshInterval * 1000);
	};

	// Perform a given probe and call callback cb for result processing
	a.probe = function(host, name, cb, errorCb) {
		// Never run disabled probes
		if(settings.probeBlacklist.includes(name))
			return;

		// Never run exclusively local commands elsewhere automatically
		if(host !== 'localhost' && a.probes[name].localOnly === 'True')
			return;

		if(undefined === a.hosts[host].probes[name])
			a.hosts[host].probes[name] = {};

		var p = a.hosts[host].probes[name];
		p.updating = true;
		p.timestamp = Date.now();

		// on updates we need to use the previously stored callback
		if(undefined === cb) {
			cb      = p.cb;
			errorCb = p.errorCb;
		} else {
			p.cb      = cb;
			p.errorCb = errorCb;
		}

		a.ws.send(`probe ${host}:::${name}`);
	};

	// Triggers the initial probes, all others will be handled in the
	// update method
	this.startProbes = function(host, cb, errorCb) {
		var a = this;
		Object.keys(a.probes).forEach(function(p) {
			if(a.probes[p].initial)
				a.probe(host, p, cb, errorCb);
		});
	};

	// Start probing a given host, handles initial probe list fetch
	// Ensures to stop previous host probes.
	this.start = function(host, cb, errorCb) {
		if(a.hosts[host] === undefined) {
			a.hosts[host] = { probes: {} };
		}
		this.stop(host);
		this.startProbes(host, cb, errorCb);
		this.update(host);
	};

	// Stop all probing
	this.stop = function(host) {
		clearTimeout(this.updateTimer);
	};

	this.update = function(host) {
		var a = this;
		var now = Date.now();
		this.updateTimer = setTimeout(this.update.bind(this), settings.refreshInterval * 1000);
		$.each(this.probes, function(name, p) {
			// On localhost run all local commands
			if(this.host === 'localhost' && p.local !== 'True')
			    return;

			if(p.updating === false && p.refresh*1000 < now - p.timestamp)
			    a.probe(name);
		});
	};
}
