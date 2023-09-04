# %% [markdown]
## ARP Debugging

### Kernel Settings

Check wether ARP ignoring is active. If you want ARP resolving the `arp_ignore` value should be 1
# %% [shell]
sysctl net.ipv4.conf.all.arp_ignore
# %% [markdown]
Check ARP garbage collection settings:
# %% [shell]
sysctl -a 2>/dev/null | grep net.ipv4.neigh.default.gc
# %% [markdown]
A typical problem on routers or large k8s cluster node is that the nodes ARP cache runs full because `gc_thres3` is to small. Note also that when `gc_thres1` is larger than the set of entries you usually cache no eviction will ever happen. 

\
Check ARP cache timeout settings:
# %% [shell]
sysctl -a 2>/dev/null | grep net.ipv4.neigh.default.base_reachable
# %% [markdown]
While you can query settings per network interface via `sysctl` too it’s easier to use `ip ntable show` to get an overview of effective settings per network interface:
# %% [shell]
ip ntable show 
# %% [markdown]
### Clear Cache

To clear the complete cache run
# %% [shell]
ip -s -s neigh flush all
# %% [markdown]
You can also run `arp -d `. To delete individual items run:
# %% [shell]
arp -d <ip>
# %% [markdown]

### Show Cache

Print ARP cache with `ip neigh`
# %% [shell]
ip neigh
# %% [markdown]
Note how valid entries are marked as `REACHABLE` outdated entries are marked as `STALE`

\
Or if ARP tools are installed print ARP cache with `arp -a` or `arp -n` for table format.
# %% [shell]
arp -a
# %% [markdown]
### Further Reading

* <https://www.baeldung.com/linux/arp-settings>
* <https://manpages.debian.org/bullseye/manpages/arp.7.en.html>