# wurmterm
Linux Terminal with Service Auto-Discovery + Rendering Capabilities

## Usage

   ./wurmterm.py

## Installation

To install dependencies on Debian/Ubuntu:

   apt install gir1.2-webkit2-4.0

## Host Wurm Tunneling

To join you when SSHing to other hosts wurmterm injects a SSH alias
into your bash. Please note that this might break existing aliases
you have. Using this alias it starts a Perl5 agent on the remote host
that runs probes as needed. The decision for Perl5 is due to the wide
support for this type of scripting.

How it works in detail

* SSH alias catching interactive simple connections (ala "ssh &lt;host>")
* Alias command adds local port to remote socket forwarding 
  
      ssh -L 127.0.0.1:2046:/tmp/wt.socket <host>

* Alias command starts remote command listener in inlined bash

      ssh -t <host> "(<some code>); bash -l"

* Unix socket server in something like Perl which is base OS

      use strict;
      use IO::Socket::UNIX qw( SOCK_STREAM SOMAXCONN );
      my $socket_path = '/tmp/wt.socket';
      unlink($socket_path);
      my $listener = IO::Socket::UNIX->new(
         Type   => SOCK_STREAM,
         Local  => $socket_path,
         Listen => SOMAXCONN,
      );
      my $socket = $listener->accept();
      chomp( my $line = <$socket> );
      print qq{Request "$line"\n};
      print $socket "Response\n";

## Assumptions

* Debian/Ubuntu as target system
* We rely on socket forwarding allowed
* We rely on OpenSSH 6.7 for socket forwarding
* Having temporary Unix sockets in /tmp is safe enough for us
 
