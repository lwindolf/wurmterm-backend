// vim: set ts=4 sw=4:
/* jshint esversion: 6 */
/* Probe API singleton, allowing one host being probed at a time.
   Manages auto-updates and probe dependency tree  */

function ProbeAPI() {
	if(arguments.callee._singletonInstance) {
		return arguments.callee._singletonInstance;
	}

	arguments.callee._singletonInstance = this;

	var a = this;
	$.ajax({
		dataType: "json",
		async: false,
		url: "/api/probes",
		success: function(data) {
			a.probes = data;
			console.log(a.probes);
		}
	    // FIXME: error handling
	});
	a.hosts = {};

	// Perform a given probe and call callback cb for result processing
	this.probe = function(host, name, cb, errorCb) {
		var a = this;

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

		getAPI('probe/'+name+'/'+host, function(res) {
		        // FIXME: check actual response code here!
			var p = a.hosts[host].probes[name];
			p.updating = false;
			p.timestamp = Date.now();

			// Always trigger follow probes, serialization is done in backend
			for(var n in res.next) {
				a.probe(host, res.next[n], cb);
			}

			if(undefined !== cb)
				cb(name, host, res);
		}, function(e) {
			// FIXME: use a promise instead
			p.updating = false;
			p.timestamp = Date.now();
			errorCb(e, name, host);
		});
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
		this.updateTimer = setTimeout(this.update.bind(this), 5000);
		$.each(this.probes, function(name, p) {
			// On localhost run all local commands
			if(this.host === 'localhost' && p.local !== 'True')
			    return;

			if(p.updating === false && p.refresh*1000 < now - p.timestamp)
			    a.probe(name);
		});
	};
}
