#!/bin/bash
# Build and deploy the Digital Thermometer firmware.
#
#   ./deploy.sh              # compile + upload
#   ./deploy.sh --compile    # compile only, do not touch the device
#
# ESPHome itself runs in a Docker container on the build host: the container
# mounts its config directory as /config, and that mounted directory is the
# one the paths below point at. Nothing is compiled locally.
#
# Configuration (environment variables, all optional):
#   ESPHOME_HOST   build host as user@host            (default: you@build-host)
#   REMOTE_CONFIG  config dir on the build host        (default: ~/esphome/config)
#   DEVICE_IP      target device, OTA upload           (default: <device-ip>)
set -euo pipefail

YAML_FILE="${YAML_FILE:-digital-thermometr-1.yaml}"
ESPHOME_HOST="${ESPHOME_HOST:-you@build-host}"
REMOTE_CONFIG="${REMOTE_CONFIG:-$HOME/esphome/config}"
DEVICE_IP="${DEVICE_IP:-<device-ip>}"
CONTAINER="${CONTAINER:-esphome}"

# Web UI assets baked into the firmware by the web_server js_include /
# css_include options. These must sit next to the YAML both locally and on the
# build host, otherwise the compile fails to find them.
UI_FILES=("thermometr_ui.js" "thermometr_ui.css")

COMPILE_ONLY=0
if [ "${1:-}" = "--compile" ]; then
  COMPILE_ONLY=1
fi

echo "=== Digital Thermometer Deploy ==="
echo "    config:   $YAML_FILE"
echo "    host:     $ESPHOME_HOST:$REMOTE_CONFIG"
echo "    device:   $DEVICE_IP"

# --- Step 1: sync the firmware config and the web UI assets --------------
echo "[1/3] Copying config and UI assets to $ESPHOME_HOST..."
scp "$YAML_FILE" "${UI_FILES[@]}" "$ESPHOME_HOST:$REMOTE_CONFIG/"

# --- Step 2: compile ------------------------------------------------------
# `esphome upload` runs platformio with "-t upload -t nobuild": on its own it
# ships whatever firmware.bin already sits in the build directory, so editing
# the YAML or the UI assets would silently have no effect. Compile explicitly.
# (`esphome run` would compile too, but it also attaches to the live log
# stream, which does not belong in a script.)
echo "[2/3] Compiling on $ESPHOME_HOST..."
ssh "$ESPHOME_HOST" "docker exec $CONTAINER esphome compile /config/$YAML_FILE"

if [ "$COMPILE_ONLY" -eq 1 ]; then
  echo "=== Compile Only: done, device untouched ==="
  exit 0
fi

# --- Step 3: OTA upload ---------------------------------------------------
echo "[3/3] Uploading to device at $DEVICE_IP..."
ssh "$ESPHOME_HOST" "docker exec $CONTAINER esphome upload /config/$YAML_FILE --device $DEVICE_IP"

echo "=== Deploy Complete ==="
echo "Web interface: http://$DEVICE_IP"
