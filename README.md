# WurmTerm Backend 🐛

WurmTerm is an addon for the progressive web app lzone.de. It allows observing
connected systems as well as exectuting runbooks against those. This repo contains
only the backend part.

## Installation

    npm install wurmterm-backend

or

    sudo npm install -g wurmterm-backend

## Backend Usage

    npx wurm start
    npx wurm stop

    npx wurm configure    # to change settings / password

## Assumptions

WurmTerm backend assumes 

- that you use bash
- that it can connect to all those hosts via SSH without credentials
- that is allowed to discover connected kubernetes contexts
- that you use `ssh <node|ip>` only and handle all private key switching in your SSH config
- that it is always allowed to sudo (but won't complain if it does not succeed)

