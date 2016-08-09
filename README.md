# wurmterm
Linux Terminal with Service Auto-Discovery + Rendering Capabilities

Connection idea:

* SSH alias catching interactive simple connections (ala "ssh <host>)
* Alias command adds local port to remote socket forwarding 
  
     ssh -L 127.0.0.1:2046:/tmp/wt.socket <host>

* Alias command starts remote command listener in inlined bash

     ssh -t <host> "(<some code>); bash -l"

* Unix socket server in something like Perl which is base OS

     use strict;
     use IO::Socket::UNIX qw( SOCK_STREAM SOMAXCONN );
     my $socket_path = '/tmp/wt.socket';
     unlink($socket_path);
     my $listner = IO::Socket::UNIX->new(
        Type   => SOCK_STREAM,
        Local  => $socket_path,
        Listen => SOMAXCONN,
     )
     my $socket = $listner->accept()
     chomp( my $line = <$socket> );
     print qq{Request "$line"\n};
     print $socket "Response\n";

Assumptions

* We rely on socket forwarding allowed
* We rely on OpenSSH 6.7 for socket forwarding
* Having temporary Unix sockets in /tmp is safe enough for us
 
