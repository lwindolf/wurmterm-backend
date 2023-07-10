// vim: set ts=4 sw=4:
/* perf based flamegraphs
   A view allowing you to start a remote perf tool run and process
   the result into a SVG to be displayed by the renderer. */

renderers.perfFlameGraph = function perfFlameGraphRenderer() {
};

renderers.perfFlameGraph.prototype.render = function(pAPI, id, host) {
    var r = this;

    $(id).html(`
        <div class='rendererForm'>
            Duration <input readonly type='text' id='perfFlameGraphDuration' value='15' size='3'/> seconds
            <input type='button' id='perfFlameGraphSubmit' value='Start Sampling'/>
        </div>
        <div class='perfFlameGraph' style='overflow:auto'>
        </div>
    `);

    $('#perfFlameGraphSubmit').on('click', function() {
        $(id + " .perfFlameGraph").html(`Sampling ${host}...`);

        pAPI.probe(host, 'perf', function(probe, h, input) {
            $(id + " .perfFlameGraph")
                .height($(id).height() - $(id + " .rendererForm").outerHeight())
                .html(input.stdout)
                .scrollTop($(id + ' .perfFlameGraph')[0].scrollHeight);
     	}, function(e, probe, h) {
            $(id+ " .perfFlameGraph").html('ERROR: Fetching perf data failed!');
            console.error(`probe Error: host=${h} probe=${probe} ${e}`);
        });
    });
}