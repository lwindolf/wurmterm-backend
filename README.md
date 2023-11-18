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

## Installation

Backend

    npm i wurmterm-backend

From source

    cd backend && npm install
    cd frontend && npm install

## Usage

Start the backend in your work environment:

    npx wurm

To always start the backend consider adding above line to your `~/.profile`.

To start the frontend locally

    cd frontend
    npx serve -S

Alternatively host the frontend code on a website of your choice by
providing proper CORS, COEP, COOP headers in your webserver config to allow 
the PWA to access the local backend and to allow iframe same origin embedding
for the notebook code.

## Remote Host Monitoring via SSH

The WurmTerm backend uses Node.js and StatefulCommandProxy to issue
SSH commands. It will check which SSH connections you have open at any time 
and will start run probes to the same nodes. 

## Assumptions

WurmTerm assumes 

- that you use bash
- that it can connect to all those hosts via SSH without credentials
- that you use `ssh <node|ip>` only and handle all private key switching in your SSH config
- that it is always allowed to sudo (but won't complain if it does not succeed)

