This runbook is about analyzing out of inodes disk usage issues.

## Preparation

Determine mount point that is full from

    df -i

Watch out for the `IUse%` column being above 90%.

## Find directories with the most files

Solutions from [shellhacks.com](https://www.shellhacks.com/how-to-check-inode-usage-in-linux/):

    { find / -xdev -printf '%h\n' | sort | uniq -c | sort -rn; } 2>/dev/null | head
