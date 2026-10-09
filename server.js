'use strict';
/**
 * Server Calculator - sync server
 *
 * Zero dependencies. Run with:  node server.js
 *
 * Serves index.html and a small sync API backed by a JSON file in ./data.
 * Every device talks to this server, so tips logged on a phone show up on
 * the laptop and vice versa.
 *
 * Single user, no login. Anything that can reach this port can read and edit
 * the data, so keep it on a network you trust.
 *
 * CLI:
 *   node server.js                start on port 8080 (or $PORT)
 *   node server.js --show-data    print where the data file lives
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const ROOT = __dirname;
const INDEX_FILE = path.join(ROOT, 'index.html');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'tips.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_BACKUPS = 30;

const MAX_BODY = 2 * 1024 * 1024;   // 2 MB
const MAX_CHANGES = 2000;           // per sync request
const MAX_NOTE = 4000;              // characters
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;   // "HH:MM", 24 hour

// ---------------------------------------------------------------- data file

let db = null;

function defaultDb(){
  return { version: 3, rev: 0, days: {} };
}

function dateStamp(d){
  d = d || new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function loadDb(){
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  if(!fs.existsSync(DB_FILE)){
    db = defaultDb();
    writeDb();
    return;
  }
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if(!db || typeof db !== 'object') throw new Error('not an object');
  } catch(err){
    const quarantine = DB_FILE + '.unreadable-' + Date.now();
    try { fs.renameSync(DB_FILE, quarantine); } catch(e){ /* best effort */ }
    console.error('\n  !! data file could not be read (' + err.message + ')');
    console.error('     moved it to ' + quarantine);
    console.error('     starting empty - check ./data/backups to restore\n');
    db = defaultDb();
    writeDb();
    return;
  }

  // normalise anything missing or malformed
  const hadLogin = !!(db.auth || db.sessions);
  db.version = 3;
  db.rev = Number(db.rev) || 0;
  db.days = (db.days && typeof db.days === 'object') ? db.days : {};
  delete db.auth;       // left over from when there was a passphrase
  delete db.sessions;
  if(hadLogin){
    writeDb();
    console.log('  cleaned the old passphrase and device logins out of the data file');
  }
}

function writeDb(){
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);   // atomic replace on Windows and POSIX
}

function saveDb(){
  writeDb();
  dailyBackup();
}

/**
 * One file per day, and today's file is refreshed on every save. That way the
 * newest backup is always the latest good state, while each earlier file holds
 * that day's final state. Trimmed to the last KEEP_BACKUPS days.
 */
function dailyBackup(){
  try {
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, 'tips-' + dateStamp() + '.json'));

    const old = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^tips-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    while(old.length > KEEP_BACKUPS){
      fs.unlinkSync(path.join(BACKUP_DIR, old.shift()));
    }
  } catch(e){ /* backups are best effort, never fatal */ }
}

// ------------------------------------------------------------------- sync

function clampNum(v){
  const n = Number(v);
  if(!isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

// optional clock-in / clock-out, only kept when both ends are valid
function timeOrNull(v){
  return (typeof v === 'string' && TIME_RE.test(v)) ? v : null;
}

/**
 * Last-write-wins per day, decided by the client's updatedAt stamp.
 * Equal stamps let the incoming change through, which keeps retries idempotent.
 */
function applyChange(c){
  if(!c || !DATE_RE.test(String(c.date || ''))) return null;
  const date = c.date;
  const at = Number(c.updatedAt) || Date.now();
  const cur = db.days[date];

  if(cur && Number(cur.updatedAt || 0) > at){
    return { date, accepted: false };   // server copy is newer, client must take ours
  }

  db.rev++;
  if(c.deleted){
    db.days[date] = { deleted: true, updatedAt: at, rev: db.rev };
    return { date, accepted: true };
  }

  const row = {
    tips: clampNum(c.tips),
    hours: clampNum(c.hours),
    note: typeof c.note === 'string' ? c.note.slice(0, MAX_NOTE) : '',
    updatedAt: at,
    rev: db.rev
  };
  const start = timeOrNull(c.start), end = timeOrNull(c.end);
  if(start && end){ row.start = start; row.end = end; }

  db.days[date] = row;
  return { date, accepted: true };
}

function changedSince(since){
  const out = [];
  for(const date of Object.keys(db.days)){
    const r = db.days[date];
    if(Number(r.rev || 0) > since) out.push(Object.assign({ date }, r));
  }
  return out;
}

function handleSync(body){
  const since = Number(body.since) || 0;
  const changes = Array.isArray(body.changes) ? body.changes.slice(0, MAX_CHANGES) : [];

  const accepted = [], rejected = [];
  let mutated = false;
  for(const c of changes){
    const res = applyChange(c);
    if(!res) continue;
    mutated = mutated || res.accepted;
    (res.accepted ? accepted : rejected).push(res.date);
  }
  if(mutated) saveDb();

  return { rev: db.rev, days: changedSince(since), accepted, rejected };
}

// ------------------------------------------------------------------ server

function send(res, status, payload, headers){
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  }, headers || {}));
  res.end(body);
}

function readBody(req){
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if(size > MAX_BODY){ reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if(!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) || {}); }
      catch(e){ reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveIndex(res){
  let html;
  try { html = fs.readFileSync(INDEX_FILE); }
  catch(e){
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('index.html is missing from ' + ROOT);
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': html.length,
    'Cache-Control': 'no-cache'
  });
  res.end(html);
}

const MANIFEST = {
  name: 'Server Calculator',
  short_name: 'Server Calc',
  start_url: '/',
  display: 'standalone',
  background_color: '#eef7fd',
  theme_color: '#2b8cc4',
  icons: [{
    src: 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="14" fill="#2b8cc4"/>' +
      '<text x="32" y="45" font-size="34" text-anchor="middle" fill="#fff" ' +
      'font-family="Segoe UI,Arial,sans-serif" font-weight="bold">$</text></svg>'),
    sizes: 'any',
    type: 'image/svg+xml'
  }]
};

const server = http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;

  try {
    if(req.method === 'GET' && (route === '/' || route === '/index.html')){
      return serveIndex(res);
    }
    if(req.method === 'GET' && route === '/manifest.webmanifest'){
      return send(res, 200, MANIFEST, { 'Content-Type': 'application/manifest+json' });
    }
    if(req.method === 'GET' && route === '/favicon.ico'){
      res.writeHead(204).end();
      return;
    }

    if(route === '/api/status' && req.method === 'GET'){
      const days = Object.keys(db.days).filter(k => !db.days[k].deleted).length;
      return send(res, 200, { ok: true, version: 3, rev: db.rev, days });
    }
    if(route === '/api/sync' && req.method === 'POST'){
      return send(res, 200, handleSync(await readBody(req)));
    }
    if(route === '/api/all' && req.method === 'GET'){
      return send(res, 200, { rev: db.rev, days: changedSince(0) });
    }
    if(route.startsWith('/api/')){
      return send(res, 404, { error: 'Unknown endpoint' });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');

  } catch(err){
    const known = err && (err.message === 'invalid JSON' || err.message === 'body too large');
    if(!known) console.error('  error on ' + route + ':', err);
    if(!res.headersSent){
      send(res, known ? 400 : 500, { error: known ? 'Bad request' : 'Server error' });
    }
  }
});

// ------------------------------------------------------------------- start

function lanAddresses(){
  const out = [];
  const nets = os.networkInterfaces();
  for(const name of Object.keys(nets)){
    for(const n of nets[name] || []){
      if(n.family !== 'IPv4' || n.internal) continue;
      out.push({ name, address: n.address, score: /^192\.168\./.test(n.address) ? 0
        : /^10\./.test(n.address) ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(n.address) ? 2 : 3 });
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

// open the app in the default browser, used by the double-click launcher
function openBrowser(url){
  const { spawn } = require('child_process');
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsHide: true })
      .on('error', () => {})
      .unref();
  } catch(e){ /* no browser is fine, the address is printed */ }
}

function cli(){
  const flag = process.argv[2];
  if(!flag || flag === '--open') return false;

  if(flag === '--show-data'){
    console.log(DB_FILE);
    console.log('backups: ' + BACKUP_DIR);
    return true;
  }
  console.error('Unknown option: ' + flag);
  console.error('Try: node server.js  |  node server.js --open  |  node server.js --show-data');
  process.exitCode = 1;
  return true;
}

const OPEN = process.argv[2] === '--open';

loadDb();
if(!cli()){
  server.listen(PORT, HOST, () => {
    if(OPEN) openBrowser('http://localhost:' + PORT);
    const days = Object.keys(db.days).filter(k => !db.days[k].deleted).length;
    const lan = lanAddresses();
    console.log('');
    console.log('  Server Calculator is running');
    console.log('  ' + '-'.repeat(46));
    console.log('  On this PC      http://localhost:' + PORT);
    if(lan.length){
      console.log('  On your phone   http://' + lan[0].address + ':' + PORT + '   (same Wi-Fi)');
      lan.slice(1).forEach(n => {
        console.log('                  http://' + n.address + ':' + PORT + '   (' + n.name + ')');
      });
    } else {
      console.log('  On your phone   no network connection detected');
    }
    console.log('');
    console.log('  Data file       ' + DB_FILE);
    console.log('  Days stored     ' + days);
    console.log('  Backups         ' + BACKUP_DIR + '  (daily, last ' + KEEP_BACKUPS + ')');
    console.log('');
    console.log('  No login - anything on this network can open it.');
    console.log('  Leave this window open. Ctrl+C to stop.');
    console.log('');
    if(!lan.length) return;
    console.log('  If your phone cannot load the page, Windows Firewall is likely');
    console.log('  blocking it. In an Administrator PowerShell, run once:');
    console.log('    netsh advfirewall firewall add rule name="Server Calculator ' + PORT + '" ' +
                'dir=in action=allow protocol=TCP localport=' + PORT);
    console.log('');
  });

  server.on('error', err => {
    if(err.code === 'EADDRINUSE'){
      if(OPEN){
        // most likely the tracker is already running in another window
        openBrowser('http://localhost:' + PORT);
        console.error('\n  Port ' + PORT + ' is already in use - opened the browser in case');
        console.error('  the tracker is already running in another window.');
        console.error('  If the page does not load, something else owns the port. Pick another:');
        console.error('    set PORT=8090 && npm start\n');
        process.exit(1);
      }
      console.error('\n  Port ' + PORT + ' is already in use.');
      console.error('  Either the tracker is already running, or pick another port:');
      console.error('    set PORT=8090 && npm start\n');
      process.exit(1);
    }
    throw err;
  });
}

process.on('SIGINT', () => {
  console.log('\n  Saving and shutting down.');
  try { saveDb(); } catch(e){ /* nothing more we can do */ }
  process.exit(0);
});
