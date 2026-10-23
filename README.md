# Server Calculator

Track tips, hours, and notes per day on a calendar.

It's a Progressive Web App (plain HTML/CSS/JS, no server and nothing to install),
hosted the same way as the study app: on **GitHub Pages**. Once it's hosted you
can add it to your home screen, and it works offline.

All data is stored on the device in your browser and isn't synced between
devices. Use **Export backup** now and then to keep a copy.

---

## Put it on your phone

1. Host it with **GitHub Pages**: in the repo on GitHub go to **Settings → Pages**,
   set *Source* to "Deploy from a branch", and pick your branch and `/ (root)`.
   After a minute it will be live at `https://<your-username>.github.io/server-calculator/`.
2. Open that URL on your phone:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**.
3. Launch it from the home-screen icon. It opens full-screen like a normal app,
   which is how it is meant to be used — the layout is built phone-first.

Use it from the home-screen icon rather than a browser tab: iPhones can clear
data for websites that haven't been opened in a while, but not for apps added to
the home screen.

## Bringing over data from the old PC version

The old version kept everything in `data/tips.json` (with daily copies in
`data/backups/`) in the folder you ran it from on your PC. Copy that file to your
phone (or open the app on the PC), then **⋮ → Import backup** and pick it.
Days, notes, and clock-in/out times all come across.

## Run locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000
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

A **blue** dot in the corner of a day square means it has a note. The selected day's note is shown in the earnings
report, so you do not have to open anything to read it.

## Your data

Everything lives in the browser's storage for this site, on this device only.
Different phones, or different browsers on the same phone, each have their own
separate copy.

`Export backup` in the **⋮** menu downloads a plain JSON file; `Import backup`
merges one back in (imported days replace the same dates). Importing is also
how you move your data to another device.

Clearing your browser's site data, or deleting the home-screen app, erases the
data, so keep a recent export.

## Updating the app

After changing `index.html`, bump `CACHE` in `sw.js` (e.g. `server-calc-v2`) so
installed copies pick up the new version.

## Files

```
index.html            the whole app (calendar, editor, summaries, storage)
sw.js                 service worker: offline support and updates
manifest.webmanifest  home-screen app name, colors, icons
icons/                app icons
```
