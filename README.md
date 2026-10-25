# Server Calculator

Track tips, hours, and notes per day on a calendar. Everything is saved on your
own server, so a shift logged on your phone shows up on the laptop and the
other way around.

```
  phone  ─┐                      ┌─ app files
          ├──>  Caddy (HTTPS) ──>│
  laptop ─┘                      └─ server.py ──> /var/lib/server-calculator/tips.json
```

It's a Progressive Web App (plain HTML/CSS/JS) with a small sync server,
`server.py`, that uses only Python's standard library, so there is nothing to
install. Once it's hosted you can add it to your home screen, and it keeps
working offline: changes wait on the device and upload when the server is
reachable again.

Single user, no login. Open the page and it's there.

---

## Set it up on your server

These steps assume a Debian/Ubuntu container (e.g. Proxmox LXC) with Caddy, and
the app in `/srv/server-calculator`. Run them as root.

1. Get the code and make sure Python 3 is there:

   ```sh
   apt install -y git python3
   git clone https://github.com/JohnKeeg8/server-calculator.git /srv/server-calculator
   ```

2. Start the sync server as a service, so it starts on boot and restarts if it
   ever stops:

   ```sh
   cp /srv/server-calculator/server-calculator.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now server-calculator
   ```

   It listens on `127.0.0.1:8080` (only reachable from inside the container) and
   keeps its data in `/var/lib/server-calculator`.

3. Point Caddy at it. Replace any old `file_server` block for this app in
   `/etc/caddy/Caddyfile` with:

   ```
   calc.example.com {
       reverse_proxy 127.0.0.1:8080
   }
   ```

   then `systemctl reload caddy`. `server.py` serves the app files itself (with
   `Cache-Control: no-cache`, so phones pick up updates) and never serves the
   data folder. Use **HTTPS** (Caddy does it automatically): phones only allow
   offline mode and a proper home-screen install on HTTPS pages.

4. Open the address on your phone:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**.

   Launch it from the home-screen icon. It opens full-screen like a normal app,
   which is how it is meant to be used — the layout is built phone-first.

### Check it's running

```sh
systemctl status server-calculator --no-pager    # should say active (running)
curl -s http://127.0.0.1:8080/api/status         # {"ok": true, ..., "days": N}
curl -sI https://calc.example.com/ | head -1     # HTTP/2 200
journalctl -u server-calculator -n 30            # its log, if something is wrong
```

### Bringing over older data

- **Days logged in the device-only version** (the last few days) upload on
  their own the first time you open the new version on that phone. Nothing to
  do.
- **The original PC version** kept everything in `data/tips.json` in the folder
  it ran from. Either open the app and use **⋮ → Import backup** with that file,
  or copy it straight onto the server:

  ```sh
  systemctl stop server-calculator
  cp tips.json /var/lib/server-calculator/tips.json
  systemctl start server-calculator
  ```

## Run locally

```sh
python3 server.py
# then open http://localhost:8080
```

Data goes in `./data` next to `server.py` when run this way. `PORT`, `HOST`, and
`DATA_DIR` environment variables change the defaults.

## Using it

The main screen is just three things: the running total, the calendar, and the
earnings report. The entry form stays out of the way until you ask for it.

| Action | How |
| --- | --- |
| Log a shift | Tap a day, then press the **+** button (bottom right) |
| Enter hours | Either way — see *Hours vs start/end* below |
| Edit a logged day | Tap it twice, or select it and press **+** (reads *Edit*) |
| See a day total | It is printed right on the calendar square |
| Running total | The blue banner at the top: month tips, hours, $/hr, shifts, this week |
| Weekly hours | The **Weeks in <month>** list at the bottom of the earnings report |
| Erase a day | Open it and press **Delete** |
| Jump to today | **Today** button, or press `T` |
| Change month | `‹` / `›`, or `←` / `→` |
| Check for changes from other devices | Tap the status pill (it also happens on its own) |
| Export / import | The **⋮** menu, top right |

### Hours vs start/end

The hours field has a small toggle:

- **Hours** — type the number you worked (`6.5`), with 4/5/6/8 shortcuts.
- **Start–end** — pick a clock-in and clock-out time; the hours are worked out
  for you and shown as `6h 30m · 6.5h`.

A shift that ends earlier than it starts is treated as running past midnight, so
`7:00 PM -> 2:15 AM` gives 7h 15m and is tagged **Overnight**. Identical start and
end times are rejected rather than read as 24 hours.

Whichever way you enter it, one hours number is stored and every total and $/hr
uses it. Days logged by clock time remember those times and reopen in start/end
mode; days logged as plain hours reopen in Hours mode. Otherwise a new day opens
in whichever mode you used last. Switching from start/end back to Hours carries
the computed number across so nothing is lost.

Day squares show whole dollars (`$163`) so the number fits a phone screen, and
abbreviate past a thousand (`$1.2k`). Exact cents appear in the entry form and in
every total.

Dots in the corner of a day square: **blue** = it has a note,
**amber** = still saving to the server. The selected day's note is shown in the
earnings report, so you do not have to open anything to read it.

## How syncing behaves

- Everything saves by itself: a moment after you stop typing, and again when the
  form is closed. **Done** just closes the form. Each change is kept on the device
  instantly, then uploads a moment later.
- With the server unreachable you can still open the app on a device that has
  loaded it before, keep logging shifts, and everything uploads when the server
  comes back. The status pill shows how many days are waiting.
- If the *same day* is edited on two devices, the **most recent edit wins** and
  the other device is updated to match. Different days never conflict.
- The status pill reads `Saved`, `Saving…`, `Offline` (kept on the phone, saves
  when the server is back), or `Not saved` (the server answered with an error).

## Your data

| What | Where |
| --- | --- |
| Live data | `/var/lib/server-calculator/tips.json` |
| Backups | `/var/lib/server-calculator/backups/tips-YYYY-MM-DD.json` — one per day, last 30 kept |

Today's backup is rewritten on every save, so the newest file is always current.
To **restore**, `systemctl stop server-calculator`, copy a backup over
`tips.json`, then `systemctl start server-calculator`. Back up the whole
container (Proxmox **Backup**) or that folder to keep copies off the server.

`Export backup` in the app downloads a plain JSON file; `Import backup` merges
one back in and uploads it.

If `tips.json` is ever unreadable, the server renames it to
`tips.json.unreadable-<timestamp>`, starts empty, and logs a message pointing at
the backups. It will not silently overwrite a damaged file.

## Worth knowing

- **There is no password.** Anything that can reach the address can read and
  edit your tips. Keep it on your home network or Tailscale, and don't forward
  it to the open internet.

## Updating the app

```sh
git -C /srv/server-calculator pull
systemctl restart server-calculator
```

When you change `index.html`, also bump `CACHE` in `sw.js` (e.g.
`server-calc-v3`) so installed copies pick up the new version.

## Files

```
index.html                 the whole app (calendar, editor, summaries, sync)
server.py                  sync server and app file host, Python standard library only
server-calculator.service  systemd service that keeps server.py running
sw.js                      service worker: offline support and updates
manifest.webmanifest       home-screen app name, colors, icons
icons/                     app icons
```
