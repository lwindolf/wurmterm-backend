// Discover local network with mdns and ssdp

import { execSync } from 'child_process';
import { parseStringPromise } from 'xml2js';

let results = {
        tools : {
                // get version / path so we know they are installed
                mdns: cmd('avahi-browse --version'),
                ssdp: cmd('which gssdp-discover')
        },
        hosts: {},
};

function cmd(command) {
        try {
                return execSync(command).toString().trim();
        } catch (error) {
                console.error(`Error executing command "${command}": ${error.message}`);
                return '';
        }
}

function addResult(address, port, protocol, data) {
        if (!address || !port)
                return;

        if (!results.hosts[address])
                results.hosts[address] = { services: {} };
        
        if (!results.hosts[address].services[port])
                results.hosts[address].services[port] = {};
        
        results.hosts[address].services[port][protocol] = data;

        // Ensure to have a name if possible, only SSDP provides useful names
        // for mdns only ports we use the port as name fallback
        if (protocol === 'ssdp' && data.name) {
                results.hosts[address].services[port].name = data.name;
        } else if (results.hosts[address].services[port].name === undefined) {
                results.hosts[address].services[port].name = ":"+port;
        }

        // Ensure to have a URL if possible
        if (protocol === 'ssdp' && data.url) {
                results.hosts[address].services[port].url = data.url;
        } else if (protocol === 'mdns' && data.adminurl) {
                results.hosts[address].services[port].url = data.adminurl;
        }
}

// Function to discover SSDP devices
async function discoverSSDP() {
        try {
                // we rely on gsssdp-utils being installed and grep the XML locations fron gssdp-discover
                const stdout = cmd('ls /sys/class/net/ | grep -v lo0 | xargs -n1 gssdp-discover -n 5 -i | grep Location: | sort -u');
                for (const line of stdout.split('\n')) {
                        const result = line.match(/Location:\s*(http:\/\/([\d.]+):(\d+)\/.*)/);
                        if (result && result.length === 4) {
                                const address = result[2];
                                const port = result[3];
                                try {
                                        const response = await fetch(result[1]);
                                        if (response.ok) {
                                                const xml = await response.text();
                                                const parsedData = await parseStringPromise(xml);
                                                const data = {};
                                
                                                // Extract useful fields from parsed XML
                                                const device = parsedData.root.device[0];
                                                data.xml = result[1];
                                                data.name = device.friendlyName ? device.friendlyName[0] : 'no name';
                                                if (device.presentationURL)
                                                        data.url = device.presentationURL[0];
                                                if (data.url && !data.url.startsWith('http'))
                                                        data.url = `http://${address}:${port}${data.url}`;
                                                
                                                addResult(address, port, 'ssdp', data);
                                        }
                                } catch (error) {
                                        console.error(`Error fetching SSDP location URL`, error);
                                }
                        }
                };
        } catch (error) {
                console.error(`Error executing gssdp-discover: ${error.message}`);
        }
}

// Function to discover mDNS services with avahi-browse
async function discoverMDNS() {
        try {
                const stdout = cmd('avahi-browse -a -r -l -c -t');

                // Entries look like:
                //
                // + wlp164s0 IPv4 HP Color LaserJet M254dw (DA4A82)               PDL Printer          local
                // = wlp164s0 IPv4 HP Color LaserJet M254dw (DA4A82)             PDL Printer          local
                //    hostname = [NPIDA4A82.local]
                //    address = [192.168.178.42]
                //    port = [9100]
                //    txt = ["TBCP=T" "Binary=T" "Transparent=T" "note=" "adminurl=http://NPIDA4A82.local." "priority=40" "product=(HP ColorLaserJet M253-M254)" "ty=HP ColorLaserJet M253-M254" "qtotal=1" "txtvers=1" "UUID=564e4333-3630-3731-3830-ace2d3da4a82"]
                //
                // We ignore the + and parse only = lines and following indented ones

                // Parse and store mDNS results
                let record;
                let name;
                stdout.split('\n').forEach(line => {
                        if (line.startsWith('= ')) {
                                // Save previously parsed host
                                if(name && record) {
                                        let data = {};
                                        record.txt.split(" ").forEach(item => {
                                                let result = item.match(/"([^"=]+)=?([^"]*)"/);
                                                if(result && result.length == 3) {
                                                        const key = result[1];
                                                        const value = result[2];
                                                        data[key] = value;
                                                }
                                        });

                                        addResult(record.address, record.port, 'mdns', data);
                                }

                                name = line.split(' ').slice(3, 40).join(' ').slice(0,40).trim();
                                record = {};
                        }

                        if(!name) return;

                        line = line.trimStart();
                        if(line.match(/^(\w+) = \[(.*)\]$/)) {
                                const [, key, value] = line.match(/^(\w+) = \[(.*)\]$/);
                                record[key] = value;
                        }
                });
        } catch (error) {
                console.error(`Error executing avahi-browse: ${error.message}`);
        }
}

async function run() {
        await discoverMDNS();
        await discoverSSDP();
        console.log(JSON.stringify(results, null, 2));
}

run();