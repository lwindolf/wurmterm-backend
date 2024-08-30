This runbook is about bluetooth connection debugging on laptops.

## Check for running daemon

    systemctl status bluetooth.service

## Check for interface status

    hciconfig hci

If interface is `DOWN` try to bring it

    hciconfig hci0 up

Resetting the interface can also help

    hciconfig hci0 reset

## Check for missing firmware

You might be missing firmware if you get a `file does not exist` on `hciconfig hci0 up`.
To check for a missing firmware error:

    journalctl | grep -i firmware

If this is the case download the firmware from your Linux distro / the vendor and put it in
`/lib/firmware`.
