This runbook is about discovering processes in a container without ps utils.

## Using systemd

    systemd-cgls

## Using proc

    for prc in /proc/*/cmdline; { (printf "$prc "; cat -A "$prc") | sed 's/\^@/ /g;s|/proc/||;s|/cmdline||'; echo; }
