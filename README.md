# WurmTerm 🐛

Linux Terminal helper with Service Auto-Discovery + Rendering Capabilities.

![Screenshot WurmTerm](https://user-images.githubusercontent.com/3315368/118046621-dde32e00-b379-11eb-8400-7942eb401e86.png)

WurmTerm watches over the state of servers you are connected to via SSH sessions
and alerts you of issues detected and provides you with an overview of detected 
services (web servers, databases, RAID ...)

## Usage

To interactively start

    ./wurm

## Installation

    sudo apt-get install npm
    cd <source> && npm install
    
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
