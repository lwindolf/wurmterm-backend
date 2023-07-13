// vim: set ts=4 sw=4:
/*jshint esversion: 8 */

/* -------------------------------------------------------------------------
   Persistent settings using IndexedDB
   ------------------------------------------------------------------------- */

var _settingsDb;
var settings = {};

function _settingsDBOpen() {
        return new Promise((resolve, reject) => {
                if (_settingsDb)
                        resolve();

                var req = indexedDB.open("settings", 1);
                req.onsuccess = function (evt) {
                        _settingsDb = this.result;
                        resolve();
                };

                req.onerror = function (evt) {
                        reject(`Error opening IndexedDB: ${evt.target.errorCode}`);
                };
        
                req.onupgradeneeded = function (evt) {
                        _settingsDb = evt.currentTarget.result;
                        console.log("IndexedDB onupgradeneeded");
                        var store = _settingsDb.createObjectStore("settings", { keyPath: 'id', autoIncrement: true });
                };
        });
}

function settingsGet(name, defaultValue = 'null') {
        return _settingsDBOpen().then(() => new Promise((resolve, reject) => {
                var store = _settingsDb.transaction("settings", "readonly").objectStore("settings");
                var req = store.get(name);
                req.onsuccess = function(evt) {
                        var value;
                        if (!evt.target.result || !evt.target.result.value)
                                value = defaultValue;
                        else   
                                value = evt.target.result.value;
                        settings[name] = value;
                        resolve();
                };
                req.onerror = function(evt) {
                        reject(`Error getting setting ${evt.target.errorCode}`);
                };
        }));
}

function settingsSet(name, value) {
        settings[name] = value;

        return _settingsDBOpen().then(() => new Promise((resolve, reject) => {
                var store = _settingsDb.transaction("settings", "readwrite").objectStore("settings");
                var req;
                try {
                        req = store.put({id: name, "value": value});
                        resolve();
                } catch (e) {
                        reject(`Error saving setting ${name}: ${e}`);
                }
        }));
}

/* Load all known settings */
function settingsLoad() {
        return new Promise((resolve, reject) => {
                _settingsDBOpen().then(function() {
                        return settingsGet('backendEndpoint', `ws://${host}:${port}/`);
                }).then(function() {
                        return settingsGet('refreshInterval', '5');
                }).then(function() {
                        return settingsGet('probeBlacklist', []);
                }).then(function() {
                        settingsDialog();       // fill values in GUI
                        resolve();
                }).catch(function() {
                        reject(`Error loading settings: ${e}`);
                });
        })
}

function settingsInputChanged(ev) {
        var i = ev.target;
        var id = $(i).attr('id');

        settingSet(id, $(i).val());

        if(id === 'backendEndpoint')
                pAPI.connect();
}

function settingsProbeToggle(ev) {
        var p = ev.target;
        var newParentId = '#'+(($(p).parent().attr('id') === 'probesDisabled')?'probesEnabled':'probesDisabled');
        $(newParentId).append($(p));

        var blacklist = [];
        $('#probesDisabled .probe').each((i,e) => blacklist.push($(e).attr('data-name')));
        settingsSet('probeBlacklist', blacklist);
}

function settingsDialog() {
        ['refreshInterval', 'backendEndpoint'].forEach(s => {
                try {
                        document.getElementById(s).value = settings[s];
                } catch(e) {
                        console.error(`Failed loading setting ${s}: ${e}`);
                }
        });

        if(pAPI && pAPI.probes) {
                $.each(pAPI.probes, function(name, p) {
                        document.getElementById(
                                (settings.probeBlacklist.includes(name)?'probesDisabled':'probesEnabled')
                        ).innerHTML += `<div class='probe' data-name='${name}'>${name}</div>`;
                });
        }

        $('#settings input').change(ev => {
                console.log(`${$(ev.target).attr('id')} changed: ${$(ev.target).val()}`);
                settingsSet($(ev.target).attr('id'), $(ev.target).val());
        });
        $('#settings .probe').click(settingsProbeToggle);
}