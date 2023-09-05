// vim: set ts=4 sw=4:
/* jshint esversion: 11 */

import { ProbeAPI } from './probeapi.js';

// Starboard-Notebook has no native shell type, so we register one
// see CoffeeScript example: https://starboard.gg/gz/coffeescript-custom-cell-type-n1VJRGC
function registerStarboardShellCellType() {
        const StarboardTextEditor = runtime.exports.elements.StarboardTextEditor;
        const ConsoleOutputElement = runtime.exports.elements.ConsoleOutputElement;
        const cellControlsTemplate = runtime.exports.templates.cellControls;

        const SHELL_CELL_TYPE_DEFINITION = {
                name: "Shell",
                cellType: ["shell"],
                createHandler: (cell, runtime) => new ShellCellHandler(cell, runtime),
        };

        class ShellCellHandler {
                constructor(cell, runtime) {
                        this.cell = cell;
                        this.runtime = runtime;
                }

                getControls() {
                        const runButton = {
                        icon: "bi bi-play-circle",
                        tooltip: "Run",
                        callback: () => this.runtime.controls.emit({id: this.cell.id, type: "RUN_CELL"}),
                        };
                        return cellControlsTemplate({ buttons: [runButton] });
                }

                attach(params) {
                        this.elements = params.elements;
                        const topElement = this.elements.topElement;
                        lit.render(this.getControls(), this.elements.topControlsElement);

                        this.editor = new StarboardTextEditor(this.cell, this.runtime, {language: "shell"});
                        topElement.appendChild(this.editor);
                }

                async run() {
                        var cmd = this.cell.textContent;
                        this.outputElement = new ConsoleOutputElement();

                        // For now support only single line commands
                        cmd = cmd.replace(/\n.*/, '');
                        
                        lit.render(html`${this.outputElement}`, this.elements.bottomElement);

                        ProbeAPI.run($('#notebook-host').val(), 5, cmd).then((d) => {
                                const val = d.stdout+"\n"+d.stderr;
                                window.$_ = val;
                                this.outputElement.addEntry({
                                        method: "result",
                                        data: [val]
                                });
                                return val;
                        }).catch((d) => {
                                this.outputElement.addEntry({
                                        method: "error",
                                        data: [d.error]
                                });
                        });

                        return undefined;
                }

                focusEditor() {
                        this.editor.focus();
                }

                async dispose() {
                        this.editor.remove();
                }  
        }

        runtime.definitions.cellTypes.map.delete('esm');
        runtime.definitions.cellTypes.map.delete('js');
        runtime.definitions.cellTypes.map.delete('javascript');
        runtime.definitions.cellTypes.map.delete('css');
        runtime.definitions.cellTypes.map.delete('html');
        runtime.definitions.cellTypes.map.delete('python');
        runtime.definitions.cellTypes.map.delete('python3');
        runtime.definitions.cellTypes.map.delete('ipython3');
        runtime.definitions.cellTypes.map.delete('py');
        runtime.definitions.cellTypes.map.delete('pypy');
        runtime.definitions.cellTypes.map.delete('latex');

        runtime.definitions.cellTypes.register("shell", SHELL_CELL_TYPE_DEFINITION);
}

function reloadNotebook() {
        var n = $('#notebook-name').find("option:selected").val();
        var h = $('#notebook-host').val();

        window.location.href = `/?view=notebook&notebook=${n}&host=${h}`;
}

async function setupNotebook(host, name) {
        if (!host)
                host = 'localhost';
        if (!name)
                name = 'default';
        
        $('#notebook-name').val(name);
        $('#notebook-host').val(host);

        let response = await fetch(`/notebooks/${name}.md`);
        window.initialNotebookContent = await response.text();			

        /* Async module load to ensure we have loaded the initial notebook markdown above */
        await import('../node_modules/starboard-notebook/dist/starboard-notebook.js');
        registerStarboardShellCellType();

        $('#notebook-name').on('change', reloadNotebook);
        $('#notebook-host').on('change', reloadNotebook);
}

export { setupNotebook };