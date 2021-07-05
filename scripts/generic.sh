#!/bin/bash


# Helper script that handles the following use cases
#
# 1.) pure non-interactive SSH to remote host
# 2.) pure bash on localhost

REMOTE=$1; shift
CMD="/usr/bin/ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o PreferredAuthentications=publickey $REMOTE"

if [ "$REMOTE" = 'localhost' ]; then
	CMD="/bin/bash"
fi

$CMD
