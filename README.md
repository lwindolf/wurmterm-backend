# WurmTerm 🐛

Linux Terminal helper with Service Auto-Discovery + Rendering Capabilities.

## Usage

To interactively start

    ./wurm

## Installation

    sudo apt-get install npm
    npm install
    
To automatically start WurmTerm with your first terminal opening add a line
like the following to your `~/.bashrc`

    (cd <install path> && source ./wurm & )


## Host Wurm Tunneling

Wurmterm starts a Node.js backend that uses StatefulCommandProxy to issue
SSH commands. It will check which SSH connections you have open at any time 
and will start run probes to the same nodes. 

## Assumptions

Wurmterm assumes 

- that you use bash
- that it can connect to all those nodes without credentials
- that you use `ssh <node|ip>` only and handle all private key switching in your SSH config
- that it is always allowed to sudo (but won't complain if it does not succeed)
