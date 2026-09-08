# Site video-event relay: no device watcher exists — 8 September 2026

The dashboard banner "Song plays, device connects" will always end in
`none acked yet`. The relay is a half-circuit: the site writes the event, the
dashboard reads it, and nothing in between ever acknowledges it. No device
watcher has ever existed in any repository on this account.

This investigation made no configuration, Firestore, or device changes, and read
no credentials. It reports code and git history only.

## The question

The Live device status banner rendered:

> **Song plays, device connects** — last video event `site_video_play_1788814804619`
> (*closing-clip*) from IN at 8 Sept, 02:30:04
> Device watchers that picked it up: …

## Answer

**Zero device watchers picked it up.** That much is established from code, not
inferred: no watcher exists to have done so, in any of the four repositories
involved (below). The banner's ack list can therefore not be reporting a device.

What follows the label is then the literal fallback `none acked yet`
(`Dashboard/Current/frontend/index.html:1180-1181`), shown whenever `seenBy` has
no keys. Two qualifiers on that second half, since the live document was **not**
read (see Verification limits):

- The producer's `updateMask` omitting `seenBy` means its PATCH leaves the field
  *untouched*, not that it clears one. A pre-existing `seenBy` would survive
  every event write.
- The renderer would draw pills for any `seenBy` map that had keys — including
  one written by hand, or by the dashboard's own service account, which holds
  full `datastore` scope.

So "the banner shows the fallback" is an inference from no writer existing
anywhere, and it is the field's contents that are unverified — not the answer to
the question asked, which stands on the absence of watcher code.

The ack list is `Object.keys(ve.seenBy || {})`. For a pill to appear, something
must write a `seenBy` map onto Firestore `settings/siteVideoEvents`. Nothing
does — not in this repository, not in the site that produces the event, and not
in either device-agent repository.

## The relay as actually built

```
jaytibirthday.in                     Firestore eka-agent              jayti-dashboard
index.html:2372                      settings/siteVideoEvents         jp-devices.js:128
  fetch('/api/video-event')  ──────▶   lastEventId                 ──────▶  GET
  videoEvent:'closing-clip'            lastEventAt                          index.html:1167
        │                              lastVideoEvent                       renders banner
        ▼                              lastEventSource
  api/video-event.js:167               lastVisitorCountry/City
  PATCH ?updateMask=<7 fields>         relayVersion
                                       ─────────────────
                                       seenBy  ◀── never written by anyone
                                                   ▲
                                       (S24 termux daemon, VivoBook agent
                                        daemon, controller video-event-watcher)
                                        — designed, never built
```

## Evidence

| Claim | Evidence |
| --- | --- |
| The producer is real and external | `jaytipargal/jaytibirthday-site`, `api/video-event.js`. Cloned and read in full. |
| The event id matches exactly | `api/video-event.js:159` — ``const eventId = `site_video_play_${now}`;`` |
| The banner's time is the same instant as the id | `:142-143` take one `Date.now()` and derive `nowIso` from it; `:170-171` write both as `lastEventId` and `lastEventAt`. 1788814804619 = 2026-09-07T21:00:04.619Z = 02:30:04 IST on 8 Sept. |
| The producer never writes `seenBy` | Explicit `updateMask` at `api/video-event.js:179-180`: `lastEventId, lastEventAt, lastVideoEvent, lastEventSource, lastVisitorCountry, lastVisitorCity, relayVersion`. `grep -rn seenBy` in that repo → no match. The field is structurally absent, not empty. |
| The three watchers were named but never written | `api/video-event.js:6-7`: `// Device watchers (S24 termux daemon, VivoBook agent daemon, controller video-event-watcher) read settings/siteVideoEvents.lastEventAt and react.` |
| No watcher in the device-agent repos | `eka-runner` (8 files) and `eka-runner-private` (7 files) cloned and grepped: zero hits for `seenBy`, `siteVideoEvents`, `lastEventAt`, `site_video_play`, or any video vocabulary. |
| The S24 daemon that *does* exist handles only push commands | `eka-runner-private/termux/fcm_listener.py:78-104` — reads `command` from an FCM payload, implements `run_sync`, logs everything else as `Unknown command`. No Firestore read. |
| Nothing in jpbir writes it either | `seenBy`, `siteVideoEvents`, `lastVideoEvent`, `lastEventId` appear only in `Dashboard/Current/api/jp-devices.js` and `Dashboard/Current/frontend/index.html`. `git log --all -S` for each returns exactly one commit, `cb3f1d8`; `site_video_play` returns none. |
| It never worked before | A regression would require the ack path to have worked once. `cb3f1d8` shipped only the reader and the banner (2 files, +47 lines), direct to `main`, no PR, no test, no doc. |

## Why no device could ack even if the code existed

The gap is at four independent layers, so adding a watcher alone would not close it.

1. **No notification.** `Sandbox/S24/runtime_contract.json:23` sets
   `"inboundListener": false` (`:18` fixes the method as
   `signed-outbound-https`). The only pull channel is
   `/api/device-commands-poll`, whose response is built solely from
   `devices/<id>.commandQueue` (`device-commands-poll.js:80-92`). Devices are
   never told an event happened.
2. **No credential.** All three production kits set `"transport": "broker"`.
   No kit ships `firestore_client.py`, and `runtime_contract.json:31-32` lists
   `service-account-key-on-device` under `forbiddenRuntimeFeatures`. A device
   holds only a non-exportable hardware signing key.
3. **No endpoint.** The five device-callable routes are enroll, heartbeat,
   commands-poll, command-claim, command-complete. Heartbeat copies only the
   eleven keys in `TELEMETRY_WHITELIST` (`device-heartbeat.js:21-32`); an extra
   field returns 200 and is dropped. The broker writes only to `deviceKeys/`,
   `devices/`, `enrollmentCodes/`, and `auditLog` — never `settings/`.
4. **No handler.** `Sandbox/*/device_agent.py:157-166` implements exactly
   `status-only`, `ping`, and `echo`, returning `unknown action` for anything
   else.

Firestore rules are not the cause: no `firestore.rules` exists in the tree, and
service-account REST calls bypass rules regardless.

## Secondary findings

- **The empty ack list is diagnostically ambiguous.** `jp-devices.js:140`
  (`seenBy: f.seenBy || {}`) collapses every *falsy* decode — absent, `null`
  (including the `nullValue`, `bytesValue`, `referenceValue` and `geoPointValue`
  types `dec()` cannot handle), `false`, `0`, and `''` — into `{}` before
  serialization, so neither the banner nor the raw API response can distinguish
  them. An empty array is the exception: `dec()` returns `[]`, which is truthy,
  so the API serializes `seenBy: []` and only the banner flattens it to the same
  "none acked yet" via `Object.keys`. In this case the field is genuinely absent,
  but the endpoint could not tell you that.
- **Read failures are invisible.** `jp-devices.js:143` (`catch { videoEvent = null; }`)
  swallows 403, network errors, and token failures alike; a 404 leaves
  `videoEvent` null. The banner then simply does not render. Conversely, the fact
  that it *did* render proves the document exists and is readable — the empty ack
  list is a true empty, not a read failure.
- **`lastEventSource` is fetched and then discarded.** `jp-devices.js:137`
  projects it; the banner never renders it. The producer sets it to
  `jaytibirthday.in` — the one field that self-identifies the writer.
- **The banner is not auto-refreshed.** The page does run a 10s poll
  (`REFRESH_MS = 10000`, `startAutoRefresh` at `:938-943`), but that timer calls
  `load()` (`:914`), which fetches `/api/jp-stats` and calls `render()` — it
  never calls `loadLiveDevices()` (`:1118`), the only function that draws the
  banner, and `/api/jp-stats` does not return `videoEvent` at all. The banner is
  redrawn on exactly two events: navigating to the device page (`:1113`) and the
  Refresh button. A late ack would not appear on its own.
- **Drift.** `Dashboard/S24/frontend/index.html:242` and
  `Dashboard/Vivobook/frontend/index.html:213` call the same endpoint and discard
  `videoEvent` entirely.
- **Timestamp caveat.** `fmtTime` (`index.html:454-458`) passes `undefined` for
  locale and pins no timezone, and omits the year. "8 Sept, 02:30:04" narrows the
  viewer only to UTC+05:30, and the banner cannot distinguish a same-day event
  from a year-old one.

## To close the loop

Minimum viable ack path, in dependency order:

1. Add `seenBy.<deviceId>` to the producer's `updateMask`, or have the acking
   party write it with its own masked PATCH.
2. Give devices a way to learn of the event — surface `lastEventAt` in the
   commands-poll response, or have the dashboard enqueue a command on change.
3. Add an ack route, or a `video-event-ack` action in `allowed_commands` plus a
   handler in `device_agent.py`. Note that completing a command is *not* itself
   an ack the banner can see: `broker-command-complete.js:124-138` patches
   `/devices/<id>` (`commandQueue.<id>.result`, `lastCommandAckAt`/`AckId`/
   `AckStatus`), while the banner reads only `settings/siteVideoEvents.seenBy`.
   Something must still patch `seenBy` explicitly — either the device, or the
   dashboard translating a completion into that write.
4. Render `lastEventSource`, and distinguish "no acks" from "unknown" in the
   banner.

## Verification limits

This session held no Firebase credential, so the live `seenBy` field was not read
directly; the conclusion rests on the producer's `updateMask` and the absence of
any writer in all four repositories. An operator can confirm in one call:
`GET /api/jp-devices?key=$STATS_KEY` and read `.videoEvent.seenBy` and
`.videoEvent.lastEventSource`.
