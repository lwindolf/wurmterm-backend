# %% [markdown]
## Running Commands with Wurmterm

This is a WurmTerm interactive notebook (similar to Jupyter notebooks). Try to trigger a shell 
command using the following cell, by clicking the play button on the left.

# %% [shell]
echo "Enter a command here!"

# %% [markdown]
## Examples

Running processes

# %% [shell]
ps -xawf | head -20

# %% [markdown]
Failed systemd units

# %% [shell]
systemctl --failed