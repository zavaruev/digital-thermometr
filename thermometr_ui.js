/*
 * Digital Thermometer — web UI behaviour
 *
 * Replaces the stock ESPHome web_server frontend. Loaded by the firmware as
 * <script type=module src=/0.js> (web_server v3, `js_include:`).
 * Served straight from the device: no CDN, no external font, no network
 * dependency beyond the device's own /events stream.
 *
 * Hierarchy: one number, large. Everything diagnostic sits in a disclosure
 * that is closed on first load (remembered afterwards via localStorage).
 *
 * Entity ids are normalised before use (see entityKey): ESPHome 2026.9+
 * publishes "sensor/temperature", older builds published
 * "sensor-temperature". Both must keep working, since the flashed firmware
 * and this interface are versioned independently.
 *
 * Layout, colour and type live in thermometr_ui.css and follow DESIGN.md.
 */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Labels — single place to switch language.
   * ------------------------------------------------------------------ */
  var L = {
    brand: "ESP8266",
    connected: "Connected",
    offline: "Offline",
    temperature: "Temperature",
    refresh: "Refresh",
    theme: { dark: "Dark appearance", light: "Light appearance" },
    updated: "Updated",
    diagnostics: "Diagnostics",
    rising: "Rising",
    falling: "Falling",
    steady: "Steady",
    waiting: "Waiting for the first reading",
    interval: "Sample interval",
    signal: "WiFi signal",
    uptime: "Uptime",
    host: "Host",
    quality: { excellent: "Excellent", good: "Good", fair: "Fair", weak: "Weak" },
    spec: {
      board: "Board",
      sensor: "Sensor",
      rom: "ROM code",
      bus: "Bus",
      display: "Display",
    },
    legal:
      "Firmware digital-thermometr-1 · served by the ESPHome web_server " +
      "component · interface follows DESIGN.md (Apple-design-analysis)"
  };

  var TREND_ARROW = { up: "↑", down: "↓", steady: "→" };
  var TREND_LABEL = { up: L.rising, down: L.falling, steady: L.steady };

  /* Mirrors the firmware lambda in digital-thermometr-1.yaml: a reading is
   * "rising" / "falling" when it moves more than 0.1 °C between samples. */
  var TREND_THRESHOLD = 0.1;
  var SAMPLE_INTERVAL = "5 s";

  var state = {
    temperature: null,
    lastTemperature: null,
    trend: null,
    rssi: null,
    uptime: null,
    title: null
  };

  /* ------------------------------------------------------------------ *
   * Fault reporting — neutral ink panel, so a failure never introduces a
   * second accent colour (DESIGN.md: single accent is non-negotiable).
   * ------------------------------------------------------------------ */
  function showFault(message) {
    var panel = document.getElementById("fault");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "fault";
      panel.className = "fault";
      document.body.appendChild(panel);
    }
    panel.textContent = message;
  }

  window.onerror = function (msg, url, line, col) {
    showFault("Interface error: " + msg + " (line " + line + ")");
    return false;
  };

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function text(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  /* Collapses every id shape the firmware has shipped into a bare key:
   *   "sensor/temperature"   (ESPHome 2026.9+, and {device}/sensor/…)
   *   "sensor-temperature"    (older builds)
   *   "sensor-wifi_signal"   (older builds, name sanitised)
   * -> "temperature" / "wifisignal" */
  function entityKey(id) {
    var raw = String(id == null ? "" : id);
    var segments = raw.split("/");
    var key = segments[segments.length - 1];
    return key
      .replace(/^sensor[-_]?/i, "")
      .replace(/[-_\s]/g, "")
      .toLowerCase();
  }

  function number(value) {
    return typeof value === "number" && isFinite(value) ? value : null;
  }

  function temperatureFrom(event) {
    var value = number(event.value);
    if (value !== null) return value;
    var match = /(-?\d+(?:\.\d+)?)/.exec(event.state || "");
    return match ? parseFloat(match[1]) : null;
  }

  function rssiFrom(event) {
    var value = number(event.value);
    if (value !== null) return value;
    var match = /(-?\d+)/.exec(event.state || "");
    return match ? parseInt(match[1], 10) : null;
  }

  function formatTemperature(value) {
    return value === null ? "--.-" : value.toFixed(1);
  }

  function formatClock(date) {
    try {
      return date.toLocaleTimeString(undefined, {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch (err) {
      return date.toTimeString().slice(0, 8);
    }
  }

  function formatUptime(seconds) {
    if (seconds === null || !isFinite(seconds)) return "--";
    var total = Math.max(0, Math.floor(seconds));
    var days = Math.floor(total / 86400);
    var hours = Math.floor((total % 86400) / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;
    if (days > 0) return days + "d " + hours + "h";
    if (hours > 0) return hours + "h " + minutes + "m";
    if (minutes > 0) return minutes + "m " + secs + "s";
    return secs + "s";
  }

  function signalQuality(dbm) {
    if (dbm === null) return "--";
    if (dbm >= -50) return L.quality.excellent;
    if (dbm >= -60) return L.quality.good;
    if (dbm >= -70) return L.quality.fair;
    return L.quality.weak;
  }

  /* ------------------------------------------------------------------ *
   * Markup
   * ------------------------------------------------------------------ */
  function build() {
    if (document.getElementById("ui-root")) return;

    var host = location.hostname || "--";

    document.title = "Digital Thermometer";

    /* The stock ESPHome index.html ships no viewport meta tag, so phones lay
     * the page out at ~980px and scale it down — the media queries below never
     * match and the desktop grid renders on a 390px screen. Without this the
     * layout breaks on mobile. Zoom stays enabled on purpose (no
     * user-scalable=no): 44px touch targets are useless if you cannot zoom. */
    if (!document.querySelector('meta[name="viewport"]')) {
      var meta = document.createElement("meta");
      meta.name = "viewport";
      meta.content = "width=device-width, initial-scale=1.0, viewport-fit=cover";
      document.head.appendChild(meta);
    }

    var favicon =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="32" fill="#000"/>' +
      '<circle cx="32" cy="32" r="9" fill="#fff"/>' +
      '<rect x="30" y="10" width="4" height="22" rx="2" fill="#fff"/>' +
      "</svg>";
    var link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = "data:image/svg+xml;utf8," + encodeURIComponent(favicon);
    document.head.appendChild(link);

    applyTheme();

    var root = document.createElement("div");
    root.id = "ui-root";
    root.innerHTML = [
      '<header class="app-nav">',
      '  <nav class="global-nav">',
      '    <span class="global-nav__brand">' + L.brand + '</span>',
      '    <span class="global-nav__meta">',
      '      <span class="t-nav-link muted-on-dark" id="nav-rssi"></span>',
      '      <span class="status" id="status"><span class="status__dot"></span><span id="status-label">…</span></span>',
      '      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="' + L.theme.dark + '">',
      '        <span class="theme-toggle__chip" aria-hidden="true">',
      '          <svg class="theme-toggle__icon theme-toggle__icon--moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
      '          <svg class="theme-toggle__icon theme-toggle__icon--sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
      '        </span>',
      '      </button>',
      '    </span>',
      '  </nav>',
      '  <nav class="sub-nav-frosted">',
      '    <span class="t-tagline">' + L.temperature + '</span>',
      '    <button class="btn btn-primary" id="btn-refresh" type="button">' + L.refresh + '</button>',
      '  </nav>',
      '</header>',

      '<main>',
      '  <section class="hero">',
      '    <p class="hero-reading">',
      '      <span id="hero-value">--.-</span>',
      '      <span class="hero-reading__unit">&deg;C</span>',
      '      <span class="hero-reading__arrow" id="hero-arrow"></span>',
      '    </p>',
      '    <p class="hero__trend" id="hero-trend">' + L.waiting + '</p>',
      '    <p class="hero__stamp" id="hero-stamp"></p>',
      '  </section>',

      '  <section class="tile-dark">',
      '    <details class="diagnostics" id="diagnostics">',
      '      <summary class="diagnostics__summary">',
      '        <span class="diagnostics__chevron" aria-hidden="true">›</span>',
      '        <span>' + L.diagnostics + '</span>',
      '      </summary>',
      '      <div class="diagnostics__body">',
      '        <div class="diagnostics__grid">',
      '          <div class="stat"><span class="stat__label">' + L.signal + '</span>',
      '            <span class="stat__value" id="diag-signal">--</span></div>',
      '          <div class="stat"><span class="stat__label">' + L.uptime + '</span>',
      '            <span class="stat__value" id="diag-uptime">--</span></div>',
      '          <div class="stat"><span class="stat__label">' + L.updated + '</span>',
      '            <span class="stat__value" id="diag-updated">--</span></div>',
      '          <div class="stat"><span class="stat__label">' + L.interval + '</span>',
      '            <span class="stat__value">' + SAMPLE_INTERVAL + '</span></div>',
      '        </div>',
      '        <ul class="diagnostics__spec">',
      '          <li>' + L.spec.board + ': <b>ESP8266 NodeMCU v2</b></li>',
      '          <li>' + L.spec.sensor + ': <b>DS18B20</b> · 1-Wire GPIO2</li>',
      '          <li>' + L.spec.rom + ': <b>0xb9f5cd691f64ff28</b></li>',
      '          <li>' + L.spec.bus + ': <b>I&sup2;C</b> SDA GPIO4 / SCL GPIO5</li>',
      '          <li>' + L.spec.display + ': <b>SSD1306 128&times;64</b> · 0x3C</li>',
      '          <li>' + L.host + ': <b>' + host + '</b></li>',
      '        </ul>',
      '      </div>',
      '    </details>',
      '  </section>',
      '</main>',

      '<footer class="footer">' + L.legal + '</footer>'
    ].join("\n");

    document.body.appendChild(root);

    var refresh = document.getElementById("btn-refresh");
    if (refresh) {
      refresh.addEventListener("click", function () {
        location.reload();
      });
    }

    var toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        setTheme(isDark() ? "light" : "dark");
      });
      syncToggle();
    }

    restoreDisclosure();
  }

  /* ------------------------------------------------------------------ *
   * Theme — stored choice wins, otherwise follow the system. Writing
   * data-theme explicitly is what freezes the choice: the CSS media
   * query only applies while the attribute is absent.
   * ------------------------------------------------------------------ */
  function isDark() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr) return attr === "dark";
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("thermometr.theme", theme);
    } catch (err) {
      /* storage unavailable: the choice applies to this page view only */
    }
    syncToggle();
  }

  function syncToggle() {
    var toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    var dark = isDark();
    toggle.setAttribute("aria-label", dark ? L.theme.light : L.theme.dark);
    toggle.setAttribute("aria-pressed", dark ? "true" : "false");
  }

  function applyTheme() {
    var stored = null;
    try {
      stored = window.localStorage.getItem("thermometr.theme");
    } catch (err) {
      stored = null;
    }
    if (stored === "dark" || stored === "light") {
      document.documentElement.setAttribute("data-theme", stored);
    } else if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }

  /* Closed on first visit, then the visitor's choice sticks. Any failure
   * (storage disabled) just leaves it closed. */
  function restoreDisclosure() {
    var box = document.getElementById("diagnostics");
    if (!box) return;
    try {
      box.open = window.localStorage.getItem("thermometr.diag") === "open";
    } catch (err) {
      box.open = false;
    }
    box.addEventListener("toggle", function () {
      try {
        window.localStorage.setItem(
          "thermometr.diag",
          box.open ? "open" : "closed"
        );
      } catch (err) {
        /* storage unavailable: preference simply is not remembered */
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Renderers
   * ------------------------------------------------------------------ */
  function renderTemperature() {
    var value = state.temperature;
    var arrow = state.trend ? TREND_ARROW[state.trend] : "";
    var stamp =
      value === null ? "" : L.updated + " " + formatClock(new Date());

    text("hero-value", formatTemperature(value));
    text("hero-arrow", arrow);
    text("hero-trend", state.trend ? TREND_LABEL[state.trend] : L.waiting);
    text("hero-stamp", stamp);
    text("diag-updated", value === null ? "--" : formatClock(new Date()));
  }

  function renderNetwork() {
    var dbm = state.rssi;
    var value = dbm === null ? "--" : dbm + " dBm";

    text("nav-rssi", dbm === null ? "" : value);
    text("diag-signal", dbm === null ? "--" : value + " · " + signalQuality(dbm));
  }

  function renderUptime() {
    text("diag-uptime", formatUptime(state.uptime));
  }

  function setConnected(online) {
    var el = document.getElementById("status");
    if (!el) return;
    el.classList.toggle("status--online", online);
    text("status-label", online ? L.connected : L.offline);
  }

  /* ------------------------------------------------------------------ *
   * Event stream
   * ------------------------------------------------------------------ */
  function applyTemperature(payload) {
    var value = temperatureFrom(payload);
    if (value === null) return;

    if (state.lastTemperature !== null) {
      var diff = value - state.lastTemperature;
      if (diff > TREND_THRESHOLD) {
        state.trend = "up";
      } else if (diff < -TREND_THRESHOLD) {
        state.trend = "down";
      } else {
        state.trend = "steady";
      }
    }
    state.lastTemperature = value;
    state.temperature = value;
    renderTemperature();
  }

  function applyRssi(payload) {
    var value = rssiFrom(payload);
    if (value === null) return;
    state.rssi = value;
    renderNetwork();
  }

  function handleEvent(name, raw) {
    var payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      return;
    }

    if (name === "ping") {
      if (payload.uptime !== undefined) state.uptime = payload.uptime;
      if (payload.title) {
        state.title = payload.title;
        document.title = payload.title + " · " + L.temperature;
      }
      renderUptime();
      return;
    }

    if (name !== "state") return;

    switch (entityKey(payload.id)) {
      case "temperature":
        applyTemperature(payload);
        break;
      case "wifisignal":
        applyRssi(payload);
        break;
      default:
        break;
    }
  }

  function connect() {
    if (typeof EventSource === "undefined") {
      showFault("This browser has no EventSource support.");
      return;
    }

    var source = new EventSource("/events");
    var watchdog = null;

    function touch() {
      setConnected(true);
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(function () {
        setConnected(false);
      }, 45000);
    }

    source.addEventListener("open", touch);
    source.addEventListener("ping", function (event) {
      touch();
      handleEvent("ping", event.data);
    });
    source.addEventListener("state", function (event) {
      touch();
      handleEvent("state", event.data);
    });
    source.addEventListener("log", function () {
      /* firmware log lines are not surfaced by this interface */
    });
    source.onerror = function () {
      setConnected(false);
    };
  }

  function init() {
    build();
    renderTemperature();
    renderNetwork();
    renderUptime();
    setConnected(false);
    connect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
