// vim: set ts=4 sw=4:
/*jshint esversion: 6 */

var settings;
var hosts = {};
var extraHosts = [];    // list of hosts manually added
var pAPI;

function multiMatch(text, severities) {
        var matchResult;
        $.each(['critical','warning'], function(i, name) {
                if(severities[name] === undefined)
                        return;

                var re = new RegExp(severities[name]);
                var matches = re.exec(text);
                if(matches !== null) {
                        matchResult = name;
                        return;
                }
        });
        return matchResult;
}

// Note: mutates d.probeSeverity
function markSeverity(s, d) {
                if(d.render === undefined || d.render.severity === undefined)
                        return s;

                switch(multiMatch(s, d.render.severity)) {
                        case 'critical':
                                d.probeSeverity = 'critical';
                                return "<span class='severity_critical'>"+s+"</span>";
                        case 'warning':
                                if(d.probeSeverity === undefined)
                                        d.probeSeverity = 'warning';
                                return "<span class='severity_warning'>"+s+"</span>";
                        default:
                                return s;
                }
}

function renderString(d) {
        var res = [];
        $.each(JSON.stringify(d.stdout).split(/\\n/), function(i, line) {
                res.push(markSeverity(line.replace(/\"/g, ""), d));
        });
        return res.join('<br/>');
}

function renderTable(d) {
        var res = "<table>";
        var re = new RegExp(d.render.split);
        $.each(d.stdout.split(/\n/), function(i, line) {
                res += "<tr>";
                $.each(line.split(re), function(j, column) {
                        res += "<td>"+markSeverity(column, d)+"</td>";
                });
                res += "</tr>";
        });
        return res + "</table>";
}

function triggerProbe(host, name) {
        pAPI.probe(host, name, probeResultCb, probeErrorCb);
}

function probeErrorCb(e, probe, h) {
        var hId = strToId(h);
        var id = "box_"+hId+"_"+probe.replace(/[. ]/g, "_");
        addProbe(h, id, probe, probe);
        $(`${id} .error`).html(e);
        console.error(`probe Error: host=${h} probe=${probe} ${e}`);
}

function strToId(h) {
        return h.replace(/[^a-zA-Z0-9]/g, '');
}

function resortBoxes(list) {
        var result = [...list.children]
                .sort(function (a,b) {
                        var ac = 0, bc = 0;
                        if ($(a).attr('collapsed') !== "1")
                                ac += 40;
                        if ($(b).attr('collapsed') !== "1")
                                bc += 40;
                        if ($(a).hasClass('severity_critical'))
                                ac += 20;
                        if ($(a).hasClass('severity_warning'))
                                ac += 10;
                        if ($(b).hasClass('severity_critical'))
                                bc += 20;
                        if ($(b).hasClass('severity_warning'))
                                bc += 10;

                        if (a.innerText<b.innerText)
                                ac += 1;
                        else
                                bc += 1;

                        return (ac<bc?1:-1);
                })
                .map(node=>list.appendChild(node));
}

function visualizeHost(host, renderer) {
        $('#visualContainer').show();
        $('#visualizedHost').html(host);
        $('#renderer').val(renderer);
        $('#visual').empty().height(600);
        try {
                var r = new renderers[renderer]();
                r.render(pAPI, '#visual', host);
        } catch(e) {
                $('#visual').html('ERROR: Rendering failed!');
                console.error(`render Error: host=${host} ${e}`);
        }
}

function addHost(h) {
        pAPI.start(h, probeResultCb, probeErrorCb);

        var hId = strToId(h);
        if(!$(`#${hId}`).length) {
                $('#nodes').append(`<div id="${hId}" class='node' data-host='${h}'>
                                <div class='name'></div>
                                <div class='boxes'></div>
                </div>`);
        }
        $(`#${hId}.node .name`).html(h);
        $(`#${hId}.node`).removeClass('disconnected');

        $('.node .name').on('click', function() {
                visualizeHost($(this).parent().data('host'), 'netmap');
        });
}

function addProbe(h, id, probe, title) {
        var hId = strToId(h);
        if(!$(`#${id}`).length) {
                $(`#${hId} .boxes`).append(`
                        <div class='box collapsed' collapsed='1' autocollapse='1' forcecollapse='0' id='${id}'>
                                <div class='head clearfix'>
                                        <div class='title'><span class='emoji'></span>${title}</div>
                                        <div class='reload' title='Reload probe'>
                                                <a href='javascript:triggerProbe("${h}","${probe}")'>&#10227;</a>
                                        </div>
                                </div>
                                <div class='error'></div>
                                <div class='content'/>
                        </div>`);
        }

}

function probeResultCb(probe, h, d) {
        var hId = strToId(h);
        var id = "box_"+hId+"_"+strToId(d.probe);
        var tmp = "";
        addProbe(h, id, probe, d.probe);
        if('render' in d) {
                if(d.render.type === 'table') {
                        tmp += renderTable(d);
                } else if(d.render.type === 'lines') {
                        tmp += renderString(d);
                } else {
                        tmp += "<div class='error'>Fatal: unknown renderer type "+probe.render.type+"</div>";
                        probe.probeSeverity = 'invalid';
                }
        } else {
                tmp = renderString(d);
        }

        if(d.probeSeverity === undefined)
                $('.box#'+id)
                        .removeClass('severity_warning')
                        .removeClass('severity_critical')
                        .addClass('ok')
                        .addClass('collapsed')
                        .removeClass('uncollapsed')
                        .attr('collapsed', $('.box#'+id).attr('autocollapse'));
        else
                $('.box#'+id)
                        .removeClass('ok')
                        .addClass('severity_'+ d.probeSeverity)
                        .addClass('uncollapsed')
                        .removeClass('collapsed')
                        .attr('collapsed', $('.box#'+id).attr('forcecollapse'));

        if(d.stdout === "") {
                $(`.box#${id}`).addClass('empty');
                $(`.box#${id} .content`).html('Probe result empty!');
        } else {
                $(`.box#${id}`).removeClass('empty');
                $(`.box#${id} .content`).html(tmp);
        }

        // Auto-collapse rendering
        $(`.box#${id}[collapsed=1] .content`).hide();
        $(`.box#${id}[collapsed=0] .content`).show();


        $('.box .head .title').off().click(function() {
                var box = $(this).parent().parent();

                if(1 == box.attr('collapsed'))
                        box
                                .attr('collapsed', 0)
                                .attr('autocollapse', 0)
                                .attr('forcecollapse', 0)
                                .addClass('uncollapsed')
                                .removeClass('collapsed')
                                .find('.content').show();
                else
                        box
                                .attr('collapsed', 1)
                                .attr('autocollapse', 1)
                                .attr('forcecollapse', 1)
                                .addClass('collapsed')
                                .removeClass('uncollapsed')
                                .find('.content').hide();

                resortBoxes($(box).parent()[0]);
        });
        resortBoxes($(`#${hId} .boxes`)[0]);
}

function updateHosts(d) {
        // Stop disconnected hosts
        $('.node:not(.disconnected)').each(function(i, n) {
                var h = $(n).data('host');
                if(!d.includes(h) && !extraHosts.includes(h) && (h !== 'localhost')) {
                        console.log('stopping '+h);
                        pAPI.stop(h);
                        $(n).addClass('disconnected');
                }
        });
        // Start newly connected hosts
        $.each(d, function(i, h) {
                var hId = strToId(h);
                if(!$(`.node#${hId}`).length) {
                        addHost(h);
                }
        });
}

function addHistory(d) {
        $('#history').empty();
        $.each(d, function(i, h) {
                $('#history').append(`<li>${h}</li>`);
        });
        $('ul#history').on('click', 'li', function() {
                var h = $(this).text();
                console.log(`manually started ${h}`);
                extraHosts.push(h);
                addHost(h);
        });

        $('#hostForm').submit(function(event) {
                var h = $('#hostEntry').val();
                if(h === "")
                        return;

                console.log(`manually started ${h}`);
                extraHosts.push(h);
                addHost(h);
                event.preventDefault();
                return true;
        });
}

function view(id) {
        $('.main').hide();
        $(`#${id}`).show();
}

(function() {
        'use strict';

        if('serviceWorker' in navigator)
                navigator.serviceWorker.register('./worker.js');

        settingsLoad().then((value) => {
                settings = value;
                pAPI = new ProbeAPI(updateHosts, addHistory);
                view('main');

                $('#renderer').on('change', function() {
                        visualizeHost($('#visualizedHost').text(), $(this).val());
                });
        }).catch((info) => {
                console.error(info);
                setInfo(info);
        });
})();