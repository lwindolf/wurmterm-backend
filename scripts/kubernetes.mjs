// Discover kubernetes namespace by name

import { execSync } from 'child_process';

function cmd(command) {
        try {
                return execSync(command).toString().trim();
        } catch (error) {
                console.error(`Error executing command "${command}": ${error.message}`);
                return '';
        }
}

async function discoverNS(id) {
        try {
                const [context, namespace] = id.split('/');
                const data = JSON.parse(cmd(`kubectl get deploy,sts,job,cronjob --context "${context}" -n "${namespace}" -o json`));
                const result = {
                        id,
                        name: namespace,
                        children: { }
                }
                data.items.forEach(item => {
                        const kind = item.kind.toLowerCase();
                        const name = item.metadata.name;
                        let severity = 'ok';
                        if (item.status && item.status.conditions) {
                                if(item.status.conditions.find(condition => condition.status !== 'True'))
                                        severity = 'warning';
                        }
                        if (result.children[kind] === undefined)
                                result.children[kind] = { children: {} };
                        result.children[kind].children[name] = {
                                severity
                        };
                });
                return result;
        } catch (error) {
                console.error(`Error executing kubectl: ${error.message}`);
                return {};
        }
}

const id = process.argv[2];
if (!id) {
        console.error('ERROR: Syntax: $0 "<kubectl context>/<namespace>"');
        process.exit(1);
}

if (id === '--tools') {
        console.log(JSON.stringify({
                tools : {
                        // get version / path so we know they are installed
                        helm: await cmd('helm version'),
                        kubectl: await cmd('which kubectl'),
                        // FIXME: what about Openshift?
                },
        }, null, 2));
} else {
        console.log(JSON.stringify(await discoverNS(id), null, 2));
}
