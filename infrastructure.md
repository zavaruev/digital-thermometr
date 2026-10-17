# Infrastructure

How this project is built and deployed. All addresses are placeholders —
supply your own through the environment variables described below.

## Device

| Property | Value |
|---|---|
| Board | ESP8266 NodeMCU v2 |
| Role | Digital thermometer, SSD1306 OLED readout, ESPHome web UI |
| Connectivity | WiFi |
| Address | `<device-ip>` (DHCP lease; pin it in your router for a stable URL) |

## Build host

ESPHome does not run on the workstation that edits this repository. It runs
inside a Docker container on a separate build host, because the toolchain and
the PlatformIO caches live there.

| Property | Value |
|---|---|
| Build host | `<user>@<build-host>` |
| Container | `esphome/esphome:stable` |
| Access | SSH, key-based |
| Container mount | `<remote-config>` on the host, seen as `/config` inside |

The container mount is the important detail: `deploy.sh` copies the YAML and
the UI assets into the host-side directory, and the compile step reads
`/config/<file>` from inside the container. Both sides must be the same
directory — if they diverge, the build compiles a stale copy and your edits
never reach the device.

Check what the running container actually has mounted:

```bash
docker inspect esphome --format '{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}'
```

## Deployment workflow

1. Edit the firmware config and/or the web UI assets locally.
2. `./deploy.sh` copies `digital-thermometr-1.yaml`, `thermometr_ui.js` and
   `thermometr_ui.css` to the build host.
3. The same script compiles on the build host and pushes the result over OTA.
4. The device reboots for roughly 15 seconds and picks up the new firmware.

Configuration is passed through the environment:

```bash
ESPHOME_HOST=you@build-host \
REMOTE_CONFIG=/path/to/esphome/config \
DEVICE_IP=192.168.1.50 \
./deploy.sh
```

Use `./deploy.sh --compile` to build without touching the device.
