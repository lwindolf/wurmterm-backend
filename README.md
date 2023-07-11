# WurmTerm 🐛

Linux Terminal companion app discovering services and issues on your servers.

![Screenshot WurmTerm](https://user-images.githubusercontent.com/3315368/118046621-dde32e00-b379-11eb-8400-7942eb401e86.png)

WurmTerm
- watches over the state of servers you are connected to via SSH sessions
- alerts you of issues detected
- provides you with an overview of detected services (web servers, databases, RAID ...)
- allows you to create CPU flame graphs

By using the same password-less SSH connect commands you use WurmTerm can be open
as a browser tab alongside you multiple terminal (tabs) and it will visually notify 
you about issues on hosts you "travel" to faster and more comprehensive than you
could debug issues yourself. It will often uncover problem you do not notice at all.

Probing does not happen via brute-force, but depending on services detected via
a `netstat`/`ss` listing.

## Usage

To interactively start use

    cd backend
    ./wurm

which will both start the backend if needed and launch the PWA.
Note that you can install the web GUI as a local app (PWA) when using
Google Chrome.

To start the frontend locally

    cd frontend
    python3 -m http.server


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

