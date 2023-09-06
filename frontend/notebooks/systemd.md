# %% [markdown]
## Debugging Systemd Problems

# %% [markdown]
Status for a specific unit
# %% [shell]
systemctl status dbus
# %% [markdown]
Failed systemd units

# %% [shell]
systemctl --failed
# %% [markdown]
Reset a failed unit. This is useful if the restart of a unit runs into a rate limit and you cannot restart it anymore.
# %% [shell]
systemctl reset-failed <unit>
# %% [markdown]
### Modifying Units
# %% [shell]
systemctl edit <unit>
systemctl daemon-reload
# %% [markdown]
### Performance Debugging
# %% [shell]
systemd-analyze blame
# %% [markdown]
### Logging Disk Space

Show used disk space
# %% [shell]
journalctl --disk-usage
# %% [markdown]
Force a log rotation
# %% [shell]
journalctl --rotate
# %% [markdown]
Drop all logs older 2 days
# %% [shell]
journalctl --vacuum-time=2d
# %% [markdown]
Free everything until only 100MB used
# %% [shell]
journalctl --vacuum-size=100M