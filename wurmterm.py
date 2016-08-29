#!/usr/bin/env python3
# -*- coding: utf8 -*-

# wurmterm.py - VTE terminal with service auto-discovery and visualizations
# This file is derived from gedit plugin 'terminal'
#
# Copyright (C) 2005-2006 - Paolo Borelli
# Copyright (C) 2016 - Lars Windolf
#
# gedit is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.
#
# gedit is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with gedit; if not, write to the Free Software
# Foundation, Inc., 51 Franklin St, Fifth Floor,
# Boston, MA  02110-1301  USA

import gettext
import gi
import http.server
import json
import os
import re
import socket
import subprocess
import sys
import threading
import uuid
from pprint import pprint
from time import time

gi.require_version('Pango', '1.0')
gi.require_version('Gdk', '3.0')
gi.require_version('Gtk', '3.0')
gi.require_version('Vte', '2.91')
gi.require_version('WebKit', '3.0')
from gi.repository import GObject, GLib, Gio, Pango, Gdk, Gtk, Vte, WebKit

MSGLEN=2048*10
instance=str(uuid.uuid1())

#from gpdefs import *

try:
    gettext.bindtextdomain(GETTEXT_PACKAGE, GP_LOCALEDIR)
    _ = lambda s: gettext.dgettext(GETTEXT_PACKAGE, s);
except:
    _ = lambda s: s

class GeditTerminal(Vte.Terminal):

    defaults = {
        'audible_bell'          : False,
    }

    TARGET_URI_LIST = 200

    def __init__(self):
        Vte.Terminal.__init__(self)

        self.set_size(self.get_column_count(), 5)
        self.set_size_request(200, 50)

        tl = Gtk.TargetList.new([])
        tl.add_uri_targets(self.TARGET_URI_LIST)

        self.drag_dest_set(Gtk.DestDefaults.HIGHLIGHT | Gtk.DestDefaults.DROP,
                           [], Gdk.DragAction.DEFAULT | Gdk.DragAction.COPY)
        self.drag_dest_set_target_list(tl)

        self.profile_settings = self.get_profile_settings()
        self.profile_settings.connect("changed", self.on_profile_settings_changed)
        self.system_settings = Gio.Settings.new("org.gnome.desktop.interface")
        self.system_settings.connect("changed::monospace-font-name", self.font_changed)

        self.reconfigure_vte()

        #self.spawn_sync(Vte.PtyFlags.DEFAULT, None, [Vte.get_user_shell()], None, GLib.SpawnFlags.SEARCH_PATH, None, None, None)
        # FIXME: path to rcfile
        self.spawn_sync(Vte.PtyFlags.DEFAULT, None, ["/bin/bash", "--rcfile", "wurmterm.rc"], ["WT_INSTANCE="+instance], GLib.SpawnFlags.SEARCH_PATH, None, None, None)

    def do_drag_data_received(self, drag_context, x, y, data, info, time):
        if info == self.TARGET_URI_LIST:
            self.feed_child(' '.join(["'" + Gio.file_new_for_uri(item).get_path() + "'" for item in Gedit.utils_drop_get_uris(data)]), -1)
            Gtk.drag_finish(drag_context, True, False, time);
        else:
            Vte.Terminal.do_drag_data_received(self, drag_context, x, y, data, info, time)

    def settings_try_new(self, schema):
        schemas = Gio.Settings.list_schemas()
        if not schemas:
            return None

        for s in schemas:
            if s == schema:
                return Gio.Settings.new(schema)

        return None

    def get_profile_settings(self):
        profiles = self.settings_try_new("org.gnome.Terminal.ProfilesList")

        if profiles:
            default_path = "/org/gnome/terminal/legacy/profiles:/:" + profiles.get_string("default") + "/"
            settings = Gio.Settings.new_with_path("org.gnome.Terminal.Legacy.Profile",
                                                  default_path)
        else:
            settings = Gio.Settings.new("org.gnome.gedit.plugins.terminal")

        return settings

    def get_font(self):
        if self.profile_settings.get_boolean("use-system-font"):
            font = self.system_settings.get_string("monospace-font-name")
        else:
            font = self.profile_settings.get_string("font")

        return font

    def font_changed(self, settings=None, key=None):
        font = self.get_font()
        font_desc = Pango.font_description_from_string(font)

        self.set_font(font_desc)

    def reconfigure_vte(self):
        # Fonts
        self.font_changed()

        # colors
        context = self.get_style_context()
        fg = context.get_color(Gtk.StateFlags.NORMAL)
        bg = context.get_background_color(Gtk.StateFlags.NORMAL)
        palette = []

        if not self.profile_settings.get_boolean("use-theme-colors"):
            fg_color = self.profile_settings.get_string("foreground-color")
            if fg_color != "":
                fg = Gdk.RGBA()
                parsed = fg.parse(fg_color)
            bg_color = self.profile_settings.get_string("background-color")
            if bg_color != "":
                bg = Gdk.RGBA()
                parsed = bg.parse(bg_color)
        str_colors = self.profile_settings.get_strv("palette")
        if str_colors:
            for str_color in str_colors:
                try:
                    rgba = Gdk.RGBA()
                    rgba.parse(str_color)
                    palette.append(rgba)
                except:
                    palette = []
                    break

        self.set_colors(fg, bg, palette)
        self.set_cursor_blink_mode(self.profile_settings.get_enum("cursor-blink-mode"))
        self.set_cursor_shape(self.profile_settings.get_enum("cursor-shape"))
        self.set_audible_bell(self.profile_settings.get_boolean("audible-bell"))
        self.set_allow_bold(self.profile_settings.get_boolean("allow-bold"))
        self.set_scroll_on_keystroke(self.profile_settings.get_boolean("scroll-on-keystroke"))
        self.set_scroll_on_output(self.profile_settings.get_boolean("scroll-on-output"))
        self.set_audible_bell(self.defaults['audible_bell'])

        if self.profile_settings.get_boolean("scrollback-unlimited"):
            lines = -1
        else:
            lines = self.profile_settings.get_int("scrollback-lines")
        self.set_scrollback_lines(lines)

    def on_profile_settings_changed(self, settings, key):
        self.reconfigure_vte()

class GeditTerminalPanel(Gtk.Box):
    """VTE terminal which follows gnome-terminal default profile options"""

    __gsignals__ = {
        "populate-popup": (
            GObject.SignalFlags.RUN_LAST,
            None,
            (GObject.TYPE_OBJECT,)
        )
    }

    def __init__(self):
        Gtk.Box.__init__(self)

        self._accel_base = '<gedit>/plugins/terminal'
        self._accels = {
            'copy-clipboard': [Gdk.KEY_C, Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.SHIFT_MASK, self.copy_clipboard],
            'paste-clipboard': [Gdk.KEY_V, Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.SHIFT_MASK, self.paste_clipboard]
        }

        for name in self._accels:
            path = self._accel_base + '/' + name
            accel = Gtk.AccelMap.lookup_entry(path)

            if not accel[0]:
                 Gtk.AccelMap.add_entry(path, self._accels[name][0], self._accels[name][1])

        self.add_terminal()

    def add_terminal(self):
        self._vte = GeditTerminal()
        self._vte.show()
        self.pack_start(self._vte, True, True, 0)

        self._vte.connect("child-exited", self.on_vte_child_exited)
        self._vte.connect("key-press-event", self.on_vte_key_press)
        self._vte.connect("button-press-event", self.on_vte_button_press)
        self._vte.connect("popup-menu", self.on_vte_popup_menu)


        scrollbar = Gtk.Scrollbar.new(Gtk.Orientation.VERTICAL, self._vte.get_vadjustment())
        scrollbar.show()
        self.pack_start(scrollbar, False, False, 0)

    def get_vte(self):
        return self._vte

    def on_vte_child_exited(self, term, status):
        for child in self.get_children():
            child.destroy()

        Gtk.main_quit()
        exit()
        # FIXME: Shutdown

    def do_grab_focus(self):
        self._vte.grab_focus()

    def on_vte_key_press(self, term, event):
        modifiers = event.state & Gtk.accelerator_get_default_mod_mask()
        if event.keyval in (Gdk.KEY_Tab, Gdk.KEY_KP_Tab, Gdk.KEY_ISO_Left_Tab):
            if modifiers == Gdk.ModifierType.CONTROL_MASK:
                self.get_toplevel().child_focus(Gtk.DirectionType.TAB_FORWARD)
                return True
            elif modifiers == Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.SHIFT_MASK:
                self.get_toplevel().child_focus(Gtk.DirectionType.TAB_BACKWARD)
                return True

        for name in self._accels:
            path = self._accel_base + '/' + name
            entry = Gtk.AccelMap.lookup_entry(path)

            if entry and entry[0] and entry[1].accel_key == event.keyval and entry[1].accel_mods == modifiers:
                self._accels[name][2]()
                return True

        keyval_name = Gdk.keyval_name(Gdk.keyval_to_upper(event.keyval))

        # Special case some Vte.Terminal shortcuts
        # so the global shortcuts do not override them
        if modifiers == Gdk.ModifierType.CONTROL_MASK and keyval_name in 'ACDEHKLRTUWZ':
            return False

        if modifiers == Gdk.ModifierType.MOD1_MASK and keyval_name in 'BF':
            return False

        return Gtk.accel_groups_activate(self.get_toplevel(),
                                         event.keyval, modifiers)

    def on_vte_button_press(self, term, event):
        if event.button == 3:
            self._vte.grab_focus()
            self.make_popup(event)
            return True

        return False

    def on_vte_popup_menu(self, term):
        self.make_popup()

    def create_popup_menu(self):
        menu = Gtk.Menu()

        item = Gtk.ImageMenuItem.new_from_stock(Gtk.STOCK_COPY, None)
        item.connect("activate", lambda menu_item: self.copy_clipboard())
        item.set_accel_path(self._accel_base + '/copy-clipboard')
        item.set_sensitive(self._vte.get_has_selection())
        menu.append(item)

        item = Gtk.ImageMenuItem.new_from_stock(Gtk.STOCK_PASTE, None)
        item.connect("activate", lambda menu_item: self.paste_clipboard())
        item.set_accel_path(self._accel_base + '/paste-clipboard')
        menu.append(item)

        self.emit("populate-popup", menu)
        menu.show_all()
        return menu

    def make_popup(self, event = None):
        menu = self.create_popup_menu()
        menu.attach_to_widget(self, None)

        if event is not None:
            menu.popup(None, None, None, None, event.button, event.time)
        else:
            menu.popup(None, None,
                       lambda m: Gedit.utils_menu_position_under_widget(m, self),
                       None,
                       0, Gtk.get_current_event_time())
            menu.select_first(False)

    def copy_clipboard(self):
        self._vte.copy_clipboard()
        self._vte.grab_focus()

    def paste_clipboard(self):
        self._vte.paste_clipboard()
        self._vte.grab_focus()

    def change_directory(self, path):
        path = path.replace('\\', '\\\\').replace('"', '\\"')
        self._vte.feed_child('cd "%s"\n' % path, -1)
        self._vte.grab_focus()
        
class WurmTermHTTPRequestHandler(http.server.BaseHTTPRequestHandler):
    def do_HEAD(s):
         s.send_response(200)
         s.send_header("Content-type", "text/html")
         s.end_headers()

    def _fetch_file(s, path, mime = 'text/html'):
         with open(path, 'r') as f:
             data = f.read()
         s.send_response(200)
         s.send_header("Content-type", mime)
         s.end_headers()
         s.wfile.write(data.encode('utf-8'))
         # FIXME: Error handling

    def do_GET(s):
         # FIXME: Base path
         if s.path == '/jquery.js':
             s._fetch_file("html/jquery.js", 'application/javascript')
             return
         if s.path == '/styles.css':
             s._fetch_file("html/styles.css", 'text/css')
             return


         # FIXME: JSON endpoint
         if s.path == '/data/current':
             s.send_response(200)
             s.send_header("Content-type", "application/json")
             s.end_headers()
             s.wfile.write(json.dumps(wt.get_data()).encode('utf-8'))
             return

         # Default: return index HTML
         s._fetch_file("html/index.html")


class WurmTermRemoteSocket:
    def __init__(self):
        self.connected = False
        self.sock = None
            
    def is_connected(self):
        return self.connected

    def open(self, name):
        # FIXME: assert self.connected == False
        if not os.path.exists(name):
            print("Fatal: Socket file", name, "does not exist")
            return

        try:
           self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
           self.sock.connect(name)
           self.connected = True
           print("Connected to", name)
        except Exception as msg:
           self.connected = False
           print("Failed to connect to", name, msg)

    def close(self):
        if self.connected:
            self.connected = False
            try:
               self.sock.close()
            except:
               print("Failed to close old socket", name)

    def send(self, msg):
        totalsent = 0
        while totalsent < MSGLEN:
            sent = self.sock.send(msg[totalsent:])
            if sent == 0:
                return
            totalsent = totalsent + sent

    def receive(self):
        chunks = []
        bytes_recd = 0
        while bytes_recd < MSGLEN:
            chunk = self.sock.recv(min(MSGLEN - bytes_recd, 2048))
            if chunk == b'':
                raise RuntimeError("socket connection broken")
            chunks.append(chunk)
            bytes_recd = bytes_recd + len(chunk)
            if chunk.endswith(b"\nEND\n"):
                break
        return b''.join(chunks).replace(b'\nEND\n', b'')


probes = {
   'load': {
        'command': 'cat /proc/loadavg\n'
   },
   'netstat': {
        'command': '(sudo netstat -tlpn 2>/dev/null || netstat -tln) | grep -v "Active Internet"\n',
        'local'  : True,
        'render' : {
             'type' : 'table',
             'split': '\s+'
        }
   },
   'apache': {
        'command': 'sudo /usr/sbin/apache2ctl -t -D DUMP_VHOSTS 2>/dev/null || /usr/sbin/apache2ctl -t -D DUMP_VHOSTS\n',
        'if'     : 'netstat',
        'matches': 'apache'
   },
   'redis': {
        'command': 'redis-cli info keyspace;redis-cli info replication\n',
        'if'     : 'netstat',
        'matches': 'redis'
   },
   'systemd': {
        'command': 'systemctl list-units | /bin/egrep "( loaded (maintenance|failed)| masked )"\n',
        'refresh': 30,
        'local'  : True,
        'render' : {
            'type'    : 'lines',
            'severity': {
                'warning' : 'warn|masked|maintenance',
                'critical': 'failed'             
            }
         }
   },
   'System Problems': {
        'command': '/bin/journalctl -k -p 0..3 -S "12 hours ago" -n 10 | /bin/egrep -v "(Logs begin at|No entries)"\n',
        'local'  : True,
        'refresh': 60,
        'render' : {
            'type'    : 'lines',
            'severity': {
                'critical' : 'error|fatal|critical',
                'warning'  : '\w+'             
            }
         }

   },
   'rabbitmq vhosts': {
        'command': 'sudo rabbitmqctl list_vhosts\n',
        'if'     : 'netstat',
        'matches': 'rabbit'
   },
   'VIPs': {
        'command': '/sbin/ip a |/bin/grep secondary\n',
        'render' : {
             'type' : 'table',
             'split': '\s+'
        }
   },
   'Eureka Services': {
        'command': "curl -s http://localhost:8761/ | grep '<a href=.http' | sed 's/.*a href=.\([^>]*\).>.*/\\1/'\n",
        'if'     : 'netstat',
        'matches': ':8761'
   },
   'df': {
        'command': 'df -hl -x tmpfs\n',
        'local'  : True,
        # FIXME: output filter only interesting stuff,
        # but keep all data for dependencies like mdstat
        'render' : {
             'type' : 'table',
             'split': '\s+',
             'severity': {
                'critical' : '^(?:100|9[0-9])%',
                'warning'  : '^(?:8[0-9])%'
            }
        }
   },
   'mdstat': {
        'command': 'cat /proc/mdstat\n',
        'if'     : 'df',
        'matches': '/dev/md'
   },
   'MySQL Databases': {
        'command': 'echo show databases\; |sudo mysql --defaults-file=/etc/mysql/debian.cnf | egrep -v "^(Database|.*_schema|mysql|sys)\$"\n',
        'if'     : 'netstat',
        'matches': 'mysqld'
   },
   'MySQL Status': {
        'command': 'echo status |sudo mysql --defaults-file=/etc/mysql/debian.cnf |grep Threads\n',
        'if'     : 'netstat',
        'matches': 'mysqld'
   },
#   'iptables': {
#        'command': 'sudo iptables -L -n --line-numbers |egrep "^(Chain|[0-9])"|grep -v "policy ACCEPT"\n',
#        'if'     : 'IPs',
#        'matches': 'scope global'
#   },
   'IPs': {
        'command': '/sbin/ip a |/bin/grep "scope global"\n',
        'local'  : True,
        'render' : {
             'type' : 'table',
             'split': '\s+'
        }
   },
   'Tomcat': {
        'command': "/usr/bin/pgrep -a java | /bin/sed 's/.*-Dcatalina.base=\([^ ]*\) .*/\\1/' | while read d; do echo $d; (cd $d; find webapps -type d -maxdepth 1;find webapps/ -name '*.war' -maxdepth 1); done\n",
        'if'     : 'netstat',
        'matches': 'java',
        'local'  : True
   },
   'ping 8.8.8.8': {
        'command': "/bin/ping -c5 -i 0.2 -w5 8.8.8.8 | /bin/egrep '(^PING 8.8.8.8|^connect|packet loss|^rtt)'\n",
        'local'  : True,
        'refresh': 30,
        'render' : {
             'type' : 'lines',
             'severity': {
                'critical' : '(?:[2-9][0-9][0-9][0-9]\.[0-9][0-9][0-9]|[3-9][0-9]% packet loss|unreachable|failed)',
                'warning'  : '(?:[1-9][0-9][0-9][0-9]\.[0-9][0-9][0-9]|[1-2][0-9]% packet loss)'
            }
        }
   }
}

class WurmTerm(Gtk.Window):
   def __init__(self):
      super(WurmTerm, self).__init__()

      self.current_sock = None
      self.current_remote = None
      self.remote_data = {}
      
      # Spawn internal Webserver
      t = threading.Thread(target = self.run_webserver, args = (self))
      t.setDaemon(True)
      t.start()
      
      # Spawn Requester
      t = threading.Thread(target = self.run_requester, args = (self))
      t.setDaemon(True)
      t.start()
      
      # Setup HTML widget and window
      self.set_size_request(800,640)
      self.connect("destroy", Gtk.main_quit)
      hbox = Gtk.HBox()
      self.webview = WebKit.WebView()
      sw = Gtk.ScrolledWindow()
      sw.add(self.webview)
      sw.set_size_request(300,640)
      panel = GeditTerminalPanel()

      hbox.add(sw)
      hbox.add(panel)
      self.add(hbox)
      self.show_all()
      self.webview.open("http://localhost:2048/")

      # Connect VTE host switch events
      panel.get_vte().connect("window-title-changed", self.on_window_title_changed)

      self.current_socket = WurmTermRemoteSocket()

   def get_data(self):
      return {"name": self.current_remote, "data": self.remote_data}

   def on_window_title_changed(self, t):
      title = t.get_window_title()
      tmp = re.search("@([^\:\s]+)", title)
      self.set_title(title)
      if tmp.groups:
         new_name = tmp.groups()[0]
         if new_name != self.current_remote:
             self.current_remote = new_name
             self.current_socket.close()
             self.remote_data = {}
             print("New Server name:", tmp.groups()[0])
      else:
         # FIXME: Refactor duplication
         self.current_remote = None
         self.current_socket.close()
         self.remote_data = {}

   # Runs a command via socket or on localhost
   def run_command(self, scope):
      d = dict(probes[scope])

      # Apply condition if there is one
      if 'if' in d and 'matches' in d:
          if not d['if'] in self.remote_data:
              #print("Not running",scope,"as precondition",d['if'],"has no data yet")
              return

          matches = [m.group(0) for l in self.remote_data[d['if']]['d'].splitlines() for m in [re.search(d['matches'], l)] if m]
          if len(matches) == 0:
              #print("Not running",scope,"as condition",d['if'],"matching",d['matches'],"not given")
              return

      try:
          self.remote_data[scope] = dict({ 'd': 'Probing...', 's':0, 'ts': time() })
          if self.current_remote:
              self.current_socket.send(bytes(d['command'], 'utf-8'))
              result = self.current_socket.receive()
              self.remote_data[scope] = json.loads(result.decode("utf-8"))
          else:
              if not 'local' in d:
                  return
              proc = subprocess.Popen([d['command']], stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
              (out, err) = proc.communicate()
              self.remote_data[scope] = dict({ 'd': out.decode("utf-8")+err.decode("utf-8"), 's':0, 'ts': time() })
      except Exception as msg:
          self.remote_data[scope] = dict({ 'd': msg, 's':1, 'ts': time() })

      # Finally copy optional rendering hints to result
      if 'render' in d:
          self.remote_data[scope]['render'] = d['render']


   # FIXME: Method name indicates an actor
   def requester(self, user_data):
      if self.current_remote != None and not self.current_socket.is_connected():
         self.current_socket.open(os.path.expanduser("~/.wurmterm/hosts/" + instance + ".sock"))
         if not self.current_socket.is_connected():
            return True

      # For now only an initial basic update on connect
      if not 'netstat' in self.remote_data:
         print("Initial fetch", self.current_remote)
         # Fetch essential stuff first (load to avoid doing further
         # actions on excessive load) and yes: load is a bad indicator...
         # If all seems fine run netstat/ss for service discovery
         try:
            self.run_command('load')
            self.run_command('netstat')
         except Exception as msg:
            print("Initial fetch failed!",msg)
            self.remote_data = {}
      else:
         try:
            for p in probes:
               # Determine if initial fetch or update is required
               refresh_needed = False
               if not p in self.remote_data:
                  refresh_needed = True
               elif 'refresh' in probes[p]:
                  if (self.remote_data[p]['ts'] + probes[p]['refresh']) < time():
                     refresh_needed = True
                     print("Updating", p, self.remote_data[p]['ts'], probes[p]['refresh'], time())

               if refresh_needed:
                  self.run_command(p)
         except Exception as msg:
            print("Fetch failed!",msg)

      return True

   def run_requester(self):
      print("Started requester")
      GLib.timeout_add_seconds(2, self.requester, None)

   def run_webserver(self):
      print("Started webserver")
      server_class = http.server.HTTPServer
      httpd = server_class(('localhost', 2048), WurmTermHTTPRequestHandler)
      try:
         httpd.serve_forever()
      except KeyboardInterrupt:
         pass
      httpd.server_close()

wt = WurmTerm()
Gtk.main()

# Let's conform to PEP8
# ex:ts=4:et:
