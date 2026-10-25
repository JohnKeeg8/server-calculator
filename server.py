#!/usr/bin/env python3
"""
Server Calculator - sync server

Python 3 standard library only, nothing to install. Run with:  python3 server.py

Stores every device's tips in one JSON file in ./data, so a shift logged on a
phone shows up on the laptop and the other way around. Your web server (Caddy)
serves the app files and passes /api/* through to this. Run on its own, it
serves the app files too, which is handy for testing.

Single user, no login. Anything that can reach the app can read and edit the
data, so keep it on a network you trust (home network, Tailscale).

Settings (environment variables):
  PORT      default 8080
  HOST      default 127.0.0.1 (only Caddy on this machine can reach it);
            use 0.0.0.0 to open it to the network directly
  DATA_DIR  default ./data next to this file

CLI:
  python3 server.py               start the server
  python3 server.py --show-data   print where the data file lives
"""

import json
import os
import re
import shutil
import sys
import threading
import time
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PORT = int(os.environ.get('PORT') or 8080)
HOST = os.environ.get('HOST') or '127.0.0.1'

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('DATA_DIR') or os.path.join(ROOT, 'data')
DB_FILE = os.path.join(DATA_DIR, 'tips.json')
BACKUP_DIR = os.path.join(DATA_DIR, 'backups')
KEEP_BACKUPS = 30

MAX_BODY = 2 * 1024 * 1024   # 2 MB
MAX_CHANGES = 2000           # per sync request
MAX_NOTE = 4000              # characters
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
TIME_RE = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')   # "HH:MM", 24 hour
BACKUP_RE = re.compile(r'^tips-\d{4}-\d{2}-\d{2}\.json$')

# The app files this serves when run without Caddy. Nothing else, so ./data
# can never be downloaded.
STATIC = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/index.html': ('index.html', 'text/html; charset=utf-8'),
    '/sw.js': ('sw.js', 'text/javascript; charset=utf-8'),
    '/manifest.webmanifest': ('manifest.webmanifest', 'application/manifest+json'),
    '/favicon.ico': ('icons/icon.svg', 'image/svg+xml'),
    '/icons/icon.svg': ('icons/icon.svg', 'image/svg+xml'),
    '/icons/icon-192.png': ('icons/icon-192.png', 'image/png'),
    '/icons/icon-512.png': ('icons/icon-512.png', 'image/png'),
    '/icons/icon-maskable-512.png': ('icons/icon-maskable-512.png', 'image/png'),
    '/icons/apple-touch-icon.png': ('icons/apple-touch-icon.png', 'image/png'),
}

# ---------------------------------------------------------------- data file

db = None
lock = threading.Lock()   # one sync at a time, so revs and writes never interleave


def default_db():
    return {'version': 3, 'rev': 0, 'days': {}}


def load_db():
    global db
    os.makedirs(BACKUP_DIR, exist_ok=True)

    if not os.path.exists(DB_FILE):
        db = default_db()
        write_db()
        return
    try:
        with open(DB_FILE, encoding='utf-8') as f:
            db = json.load(f)
        if not isinstance(db, dict):
            raise ValueError('not an object')
    except Exception as err:
        quarantine = DB_FILE + '.unreadable-' + str(int(time.time() * 1000))
        try:
            os.replace(DB_FILE, quarantine)
        except OSError:
            pass   # best effort
        print('\n  !! data file could not be read (%s)' % err, file=sys.stderr)
        print('     moved it to ' + quarantine, file=sys.stderr)
        print('     starting empty - check %s to restore\n' % BACKUP_DIR, file=sys.stderr)
        db = default_db()
        write_db()
        return

    # normalise anything missing or malformed
    had_login = 'auth' in db or 'sessions' in db
    db['version'] = 3
    db['rev'] = num(db.get('rev'))
    if not isinstance(db.get('days'), dict):
        db['days'] = {}
    db.pop('auth', None)       # left over from when there was a passphrase
    db.pop('sessions', None)
    if had_login:
        write_db()


def write_db():
    tmp = DB_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(db, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, DB_FILE)   # atomic replace


def save_db():
    write_db()
    daily_backup()


def daily_backup():
    """
    One file per day, and today's file is refreshed on every save. That way the
    newest backup is always the latest good state, while each earlier file holds
    that day's final state. Trimmed to the last KEEP_BACKUPS days.
    """
    try:
        shutil.copyfile(DB_FILE, os.path.join(BACKUP_DIR, 'tips-%s.json' % date.today().isoformat()))
        old = sorted(f for f in os.listdir(BACKUP_DIR) if BACKUP_RE.match(f))
        for f in old[:-KEEP_BACKUPS]:
            os.remove(os.path.join(BACKUP_DIR, f))
    except OSError:
        pass   # backups are best effort, never fatal

# ------------------------------------------------------------------- sync


def num(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0
    if n != n or n in (float('inf'), float('-inf')):
        return 0
    return int(n) if n == int(n) else n


def clamp_num(v):
    n = num(v)
    return 0 if n < 0 else num(round(n * 100) / 100)


def time_or_none(v):
    """Optional clock-in / clock-out, only kept when both ends are valid."""
    return v if isinstance(v, str) and TIME_RE.match(v) else None


def apply_change(c):
    """
    Last-write-wins per day, decided by the client's updatedAt stamp.
    Equal stamps let the incoming change through, which keeps retries idempotent.
    """
    if not isinstance(c, dict) or not DATE_RE.match(str(c.get('date') or '')):
        return None
    day = c['date']
    at = num(c.get('updatedAt')) or int(time.time() * 1000)
    cur = db['days'].get(day)

    if cur and num(cur.get('updatedAt')) > at:
        return day, False   # server copy is newer, client must take ours

    db['rev'] += 1
    if c.get('deleted'):
        db['days'][day] = {'deleted': True, 'updatedAt': at, 'rev': db['rev']}
        return day, True

    note = c.get('note')
    row = {
        'tips': clamp_num(c.get('tips')),
        'hours': clamp_num(c.get('hours')),
        'note': note[:MAX_NOTE] if isinstance(note, str) else '',
        'updatedAt': at,
        'rev': db['rev'],
    }
    start, end = time_or_none(c.get('start')), time_or_none(c.get('end'))
    if start and end:
        row['start'] = start
        row['end'] = end

    db['days'][day] = row
    return day, True


def changed_since(since):
    return [dict(r, date=d) for d, r in db['days'].items() if num(r.get('rev')) > since]


def handle_sync(body):
    since = num(body.get('since'))
    changes = body.get('changes')
    changes = changes[:MAX_CHANGES] if isinstance(changes, list) else []

    accepted, rejected = [], []
    for c in changes:
        res = apply_change(c)
        if not res:
            continue
        (accepted if res[1] else rejected).append(res[0])
    if accepted:
        save_db()

    return {'rev': db['rev'], 'days': changed_since(since), 'accepted': accepted, 'rejected': rejected}


def live_days():
    return sum(1 for r in db['days'].values() if not r.get('deleted'))

# ------------------------------------------------------------------ server


class BadRequest(Exception):
    pass


class Handler(BaseHTTPRequestHandler):
    server_version = 'ServerCalculator'

    def log_message(self, fmt, *args):
        pass   # quiet; errors are still printed

    def send_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_BODY:
            raise BadRequest('body too large')
        raw = self.rfile.read(length) if length else b''
        if not raw:
            return {}
        try:
            body = json.loads(raw.decode('utf-8'))
        except ValueError:
            raise BadRequest('invalid JSON')
        if not isinstance(body, dict):
            raise BadRequest('invalid JSON')
        return body

    def route(self):
        # works whether Caddy passes /api/sync or /some/subfolder/api/sync
        path = urlsplit(self.path).path
        i = path.find('/api/')
        return path[i:] if i >= 0 else path

    def serve_static(self, route):
        name, ctype = STATIC[route]
        try:
            with open(os.path.join(ROOT, name), 'rb') as f:
                body = f.read()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_GET(self):
        route = self.route()
        if route == '/api/status':
            with lock:
                return self.send_json(200, {'ok': True, 'version': 3, 'rev': db['rev'], 'days': live_days()})
        if route == '/api/all':
            with lock:
                return self.send_json(200, {'rev': db['rev'], 'days': changed_since(0)})
        if route.startswith('/api/'):
            return self.send_json(404, {'error': 'Unknown endpoint'})
        if route in STATIC:
            return self.serve_static(route)
        self.send_error(404)

    def do_HEAD(self):
        self.do_GET()   # same headers, the body is left off

    def do_POST(self):
        route = self.route()
        if route != '/api/sync':
            return self.send_json(404, {'error': 'Unknown endpoint'})
        try:
            body = self.read_body()
            with lock:
                out = handle_sync(body)
        except BadRequest:
            return self.send_json(400, {'error': 'Bad request'})
        except Exception as err:
            print('  error on %s: %r' % (route, err), file=sys.stderr)
            return self.send_json(500, {'error': 'Server error'})
        self.send_json(200, out)

# ------------------------------------------------------------------- start


def main():
    flag = sys.argv[1] if len(sys.argv) > 1 else None
    if flag == '--show-data':
        print(DB_FILE)
        print('backups: ' + BACKUP_DIR)
        return
    if flag:
        print('Unknown option: ' + flag, file=sys.stderr)
        print('Try: python3 server.py  |  python3 server.py --show-data', file=sys.stderr)
        sys.exit(1)

    load_db()
    try:
        httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as err:
        print('\n  Could not listen on %s:%d (%s)' % (HOST, PORT, err.strerror), file=sys.stderr)
        print('  Is it already running? Pick another port with PORT=8090\n', file=sys.stderr)
        sys.exit(1)

    print('Server Calculator listening on http://%s:%d' % (HOST, PORT))
    print('Data file %s (%d days)' % (DB_FILE, live_days()))
    print('Backups   %s (daily, last %d)' % (BACKUP_DIR, KEEP_BACKUPS), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()
