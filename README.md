# Server Calculator

Track tips, hours, and notes per day on a calendar. Runs on your own PC and syncs
to every device on your Wi-Fi, so a shift logged on your phone shows up on the
laptop and the other way around.

```
  phone  ─┐
          ├──>  http://<your-pc>:8080  ──>  data/tips.json
  laptop ─┘
```

Single user, no login. Open the page and it's there.

---

## Start it

Double-click **`start-server.cmd`**. It starts the server and opens the app in
your browser. Or from a terminal in this folder:

```
npm run dev      # restarts itself when you edit server.js
npm start        # plain run
node server.js   # same thing, no npm involved
```

There is nothing to install first — no dependencies, no build step. `npm install`
is not needed and will do nothing useful.

Leave that window open — it *is* the server. `Ctrl+C` stops it. On startup it
prints the two addresses you need:

```
  On this PC      http://localhost:8080
  On your phone   http://192.168.8.125:8080   (same Wi-Fi)
```

## Put it on your phone

1. Make sure the phone is on the same Wi-Fi as the PC.
2. Open the `192.168.x.x` address from the startup output.
3. Browser menu → **Add to Home Screen**. It then opens full-screen like a normal
   app, which is how it is meant to be used — the layout is built phone-first.

If the phone can't load the page, Windows Firewall is almost certainly blocking
it. In an **Administrator** PowerShell, run this once:

```powershell
netsh advfirewall firewall add rule name="Server Calculator 8080" dir=in action=allow protocol=TCP localport=8080
```

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
| Force a sync | Tap the status pill |
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
**amber** = not synced yet. The selected day's note is shown in the earnings
report, so you do not have to open anything to read it.

## How syncing behaves

- Every change saves to the device instantly, then uploads a moment later.
- **No internet needed** — only the PC and the device being on the same network.
  With the server off you can still open the app on a device that has loaded it
  before, keep logging shifts, and everything uploads when the server comes
  back. The status pill shows how many days are waiting.
- If the *same day* is edited on two devices, the **most recent edit wins** and
  the other device is updated to match. Different days never conflict.
- The status pill reads `Synced`, `Syncing…`, `N unsynced`, or `Offline`.

## Your data

| What | Where |
| --- | --- |
| Live data | `data/tips.json` |
| Backups | `data/backups/tips-YYYY-MM-DD.json` — one per day, last 30 kept |

Today's backup is rewritten on every save, so the newest file is always current.
To **restore**, stop the server and copy a backup over `data/tips.json`.

`Export` in the app downloads a plain JSON file; `Import` merges one back in and
uploads it. `npm run where` prints the data file path.

If `data/tips.json` is ever unreadable, the server renames it to
`tips.json.unreadable-<timestamp>`, starts empty, and tells you to check
`data/backups`. It will not silently overwrite a damaged file.

## Troubleshooting

**Double-clicking `start-server.cmd` does nothing / the window flashes and
closes** — make sure Node.js 18+ is installed (`node --version` in a terminal),
then try running `node server.js` from a terminal in this folder to see the
error. If you downloaded an old copy, re-download it: earlier versions of the
launcher had Unix line endings that Windows can misread.

**"Port 8080 is already in use"** — the tracker is probably already running in
another window. To use a different port:

```
set PORT=8090 && npm start
```

**Server not responding on the phone** — the PC is asleep, the server window was
closed, the phone is on cellular or a guest network, or the firewall rule above
hasn't been added. The PC's `192.168.x.x` address can also change after a
router reboot; the startup output always shows the current one.

**Phone shows old numbers** — pull to refresh, or tap the status pill. The app
also syncs whenever you switch back to it.

## Worth knowing

- **There is no password.** Anything that can reach the port can read and edit
  your tips. That's fine on your own home Wi-Fi. Don't run it on café, hotel, or
  airport Wi-Fi, and never forward this port through your router to the open
  internet.
- Sync only works while the PC is awake and the server window is open. Consider
  turning off sleep on the PC if you want to log tips from your phone at work.
- You already have Tailscale on this machine. If you want the tracker to work
  from *anywhere*, not just home Wi-Fi, install Tailscale on your phone and use
  the PC's Tailscale address (`100.x.y.z:8080`) instead. That connection is
  encrypted and reaches only your own devices, so it stays private without
  needing a password.

## Files

```
index.html        the whole app (calendar, editor, summaries, sync)
server.js         sync server and static host, no dependencies
package.json      npm script shortcuts only - there are no dependencies
start-server.cmd  double-click launcher
data/             created on first run: live data + daily backups
```

Requires Node.js 18 or newer (tested on 20.17). No `npm install`, no build step.
