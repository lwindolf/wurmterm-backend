This runbook is about analyzing mdstat issues.

## Get details

    cat /proc/mdstat

or

    mdadm --detail /dev/md0

or check a problematic physical device

    mdadm --examine /dev/sdb1

## Fix

Add new disk with `mdadm /dev/md0 --add <device>` and remove broken one
with `mdadm /dev/md0 --remove <device>`.

## Force Restart

When a device is not recovering

    mdadm --stop <md device>

and restart with

    mdadm --assemble --scan -v
