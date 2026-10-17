# Digital Thermometer

An ESP8266 digital thermometer with an SSD1306 OLED readout and a custom web
interface. Firmware is [ESPHome](https://esphome.io/); the web interface is
served by the device itself, so there is no dashboard, no cloud and no
external dependency at runtime.

The device answers on port 80 and pushes state over Server-Sent Events, so
the reading updates in place without polling.

![web interface, dark](docs/ui-dark.png)

## Status

Current release: **v1.0.2** — see [releases](https://github.com/zavaruev/digital-thermometr/releases).

The software side is complete and deployed. One hardware problem is still open
and documented under [Known issues](#known-issues): the DS18B20 reading drifts
away from room temperature the longer the device runs, which points at the
supply or at the sensor's mounting. It cannot be diagnosed from software. The
spontaneous reboots that used to happen every few hours were traced to a
blocking DNS lookup on the time path and are fixed — see
[Resolved](#resolved-the-sontaneous-reboots).

## Hardware

| Part | Detail |
|---|---|
| Board | ESP8266 NodeMCU v2 |
| Sensor | DS18B20, 1-Wire, ROM `0xb9f5cd691f64ff28` |
| Display | SSD1306 OLED, 128×64, I²C address `0x3C` |
| Power | USB or VIN |

### Wiring

| Signal | Pin |
|---|---|
| 1-Wire data | GPIO2 |
| I²C SDA | GPIO4 |
| I²C SCL | GPIO5 |

Pin numbers are declared once as `substitutions` at the top of
`digital-thermometr-1.yaml`; the UI assets do not hardcode them.

## What it does

**On the OLED** — local time (SNTP, with Home Assistant as a second source),
a large temperature with a trend glyph, a heartbeat dot and the device IP.

**On the web interface**

- the reading is the interface: one large number, nothing competing with it;
- a trend word (`Rising` / `Falling` / `Steady`) derived on the client using
  the same 0.1 °C threshold the firmware lambda uses;
- live connection state with a liveness dot that pulses on every incoming
  sensor reading, so a device that stops publishing stops blinking;
- signal strength;
- everything diagnostic — RSSI, uptime, board, ROM code, pinout, and the
  reset reason of the current boot — sits in a **Diagnostics** disclosure
  that is closed on first load, together with a last-resort **Restart**
  button that reboots the device;
- light and dark appearance, defaulting to the system preference with a
  manual override that persists;
- a device mark — a thermometer in the brand colours — used both as the
  favicon and in the top bar, so the browser tab and the interface carry the
  same identity;
- exactly two controls: that Restart button and the theme toggle. There is no
  refresh button: the reading arrives over SSE, so reloading the page by hand
  would buy nothing;
- no CDN, no web fonts, no analytics. The page is three small files served
  from the device's own flash.

![web interface, light](docs/ui-light.png)

## Repository layout

| File | Purpose |
|---|---|
| `digital-thermometr-1.yaml` | Firmware config: sensors, display, WiFi, web server |
| `thermometr_ui.css` | Interface styling, driven entirely by design tokens |
| `thermometr_ui.js` | Interface behaviour: DOM, SSE stream, theme, trend |
| `deploy.sh` | Sync, compile and OTA-upload via the build host |
| `infrastructure.md` | Build host topology and deployment workflow |
| `DESIGN.md` | The design language the interface implements |
| `secrets.example.yaml` | Template for the credentials you must supply |

`DESIGN.md` is a token-level design system (Apple-style: one accent colour,
no shadows, a fixed type ladder, defined breakpoints). Every colour, radius
and spacing step in `thermometr_ui.css` is a token declared once in `:root`;
there are no inline hex values in component rules, and the dark theme is a
token inversion rather than a second set of rules.

## Getting started

### 1. Credentials

```bash
cp secrets.example.yaml secrets.yaml
```

Fill in `wifi_ssid`, `wifi_password`, `api_key` and `ap_password`.
`secrets.yaml` is git-ignored. Generate an API key with:

```bash
esphome config --show-secrets dummy.yaml
```

The build fails without `api_key` — the firmware references it as
`!secret api_key`. `ap_password` backs the fallback access point that the
captive portal needs in order to be reachable at all.

### 2. Point the deploy script at your host

The script expects ESPHome to run in a Docker container on a build host. See
[infrastructure.md](infrastructure.md) for the details and for how to check
which host directory the container actually mounts.

```bash
ESPHOME_HOST=you@build-host \
REMOTE_CONFIG=/path/to/esphome/config \
DEVICE_IP=192.168.1.50 \
./deploy.sh
```

### 3. Build and flash

```bash
./deploy.sh              # compile + OTA upload
./deploy.sh --compile    # compile only
```

The first build fetches the three Google Fonts (`Roboto`, `Bebas Neue`,
`Open Sans`) that the OLED rendering uses, so the build host needs internet
access. The web interface itself does not.

Compilation is the only automated validation in this project — there is no
test suite. A successful build reports the flash and RAM budget, which is
worth watching on the ESP8266:

```
RAM:   53.7% (used 44004 bytes from 81920 bytes)
Flash: 48.9% (used 511045 bytes from 1044464 bytes)
```

The NTP servers are configured **by IP address**, not by name. Resolving a name
goes through lwIP's blocking DNS resolver, which stalled the main loop past the
hardware watchdog and rebooted the device; by address that path does not exist.
This matters if you edit `time:` — do not reintroduce hostnames there.

**Recovery paths.** The device is reachable three ways, in order of preference:
the native API for Home Assistant, OTA over the encrypted channel, and — if
the encryption key is ever lost — plain HTTP upload at
`http://<device-ip>/update`. That last one is why `web_server`'s OTA platform
is deliberately left enabled even though ESPHome warns that it does not
benefit from OTA encryption. If the device cannot join your network at all, the
fallback access point (`wifi: ap:`) comes up and the captive portal can serve
the WiFi credentials.

## Troubleshooting

**"connection dropped immediately after encrypted hello" on the native API.**
This reads like a key mismatch and is not. Check the device's own log first —
with `web_server: log: true` the stream at `/events` shows
`[W][api:271]: Max connections (N), rejecting <ip>`. The API server has a
fixed number of slots (4 by default on the ESP8266, each costing 500–1000
bytes) and every long-lived client holds one: the dashboard, the editor
integration, Home Assistant, `esphome logs`. This repo raises the limit to 8
with `api: max_connections`. If it still happens, a client is reconnecting in a
loop — restart the dashboard or editor integration rather than touching the
key.

## How the web interface stays in sync with the firmware

Two details are worth knowing before you edit `thermometr_ui.js`.

**Entity identifiers are normalised.** ESPHome 2026.9 changed the shape of
the identifiers published by the web server — `sensor/temperature` replaced
`sensor-temperature`, and entity names are no longer sanitised
(`sensor/WiFi Signal`). The UI runs `entityKey()` over every incoming id so
it works against both the current and the previous scheme, and against
sub-device prefixes.

**Action URLs use the entity name verbatim.** The same release changed how the
web server matches a URL segment: `match_entity()` compares against
`entity->get_name()`, not a sanitised object id. The Restart control therefore
posts to `/button/Restart/press` — capital R — and a lower-case path returns
404. Worse for a UI, a 404 resolves a `fetch` promise exactly like a 200, so
the failure handler never runs and the control looks alive while doing
nothing; the interface checks `res.ok` explicitly for that reason.

**The firmware must actually be recompiled.** `esphome upload` invokes
PlatformIO with `-t upload -t nobuild` and ships whatever `firmware.bin` is
already in the build directory. Editing `thermometr_ui.js` or the CSS and
then uploading alone changes nothing on the device. `deploy.sh` therefore
runs `esphome compile` as an explicit step.

## Known issues

- **The sensor reading drifts away from room temperature the longer the device
  runs.** Freshly booted the DS18B20 reads a plausible 23–26 °C. Left
  running for hours it climbs to 59–92 °C and stays there. Measured on this
  hardware:

  | Condition | Result |
  |---|---|
  | Baseline, 5 s read interval, 8 min | 26.25 → 26.00 °C (−1.9 °C/hour) |
  | Experiment, 1 s read interval (5×), 7 min | 25.62 → 25.50 °C, flat |

  Raising the read rate five times changed nothing, so this is **not** the
  sensor drawing current on the 1-Wire bus for its own conversions. The effect
  is time-dependent rather than rate-dependent, which points at the 3.3 V rail
  sagging under load — the ESP8266 draws hundreds of milliamps while
  transmitting and the sensor sits on the same rail — or heat soak from the
  regulator into a sensor mounted close to the board. A DS18B20 run below its
  ~1.1 V floor also reports garbage-high values. This one needs hardware:
  measure supply voltage under load, check the 1-Wire pull-up (4.7 kΩ to
  3.3 V), confirm the sensor's VDD is connected, then move the sensor away
  from the board.
- **One reboot right after an OTA upload**, logged as `Exception`, observed
  once in several deploys. It happens in the first seconds after the reboot
  that an OTA triggers and the device then runs normally, so it may be an
  artefact of writing new firmware rather than a runtime fault. Watch it: if it
  ever appears without a deploy in flight, treat it as a second, separate
  problem.

## Resolved: the spontaneous reboots

The device used to reboot by itself every few hours with
`Reset Reason: Hardware Watchdog` — the ESP8266 stopped feeding its watchdog and
was reset by the hardware after the main loop stalled. The cause was
**the blocking DNS resolver on the time path**: `sntp` with
`0.pool.ntp.org` resolves that name through lwIP's resolver, which retries
inside the main loop and can run past the 4-second watchdog window.

It was pinned down by fault injection rather than guesswork. Shortening the
SNTP interval to 30 seconds made it reproducible in under two minutes — the
device rebooted every ~15 seconds, with the uptime counter visibly going
backwards:

```
t+ 40s uptime=7     ← rebooted (was 12)
t+ 60s uptime=12    ← rebooted
t+110s uptime=11    ← rebooted
t+170s uptime=77    ← stabilised once a lookup finally succeeded
```

Addressing the NTP servers by IP removes name resolution from that path
entirely:

```yaml
servers:
  - 216.239.35.0   # time.google.com
  - 162.159.200.1  # Cloudflare NTP
```

The same 30-second cadence that used to kill the device in 15 seconds now ran
for 468 seconds without a reset, so it is the resolution and not the frequency
that was at fault. Suspects eliminated along the way: 1-Wire traffic (10× the
normal read rate made no difference) and a client that stops reading from the
SSE stream (200 seconds of an idle socket changed nothing).

`Reset Reason` under Diagnostics, and the `debug` component in the firmware,
are what made this visible — the reset reason exists only during the boot that
caused it and cannot be recovered afterwards.

**Checking firmware freshness.** The `compiled on <date>` line in the device
log is not a reliable check: ESPHome derives it from a hash of the YAML alone,
so it stays frozen across rebuilds that only change `thermometr_ui.js` or the
CSS. Compare bytes instead — fetch `/0.js` from the device and hash it against
the repository file.

## Credits

The OLED fonts are Google Fonts — *Roboto*, *Bebas Neue* and *Open Sans* —
used under the SIL Open Font License. ESPHome fetches and rasterises them at
compile time.
