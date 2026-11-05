/*
 * Attack Shark X68 Pro HE - SignalRGB Plugin (community reverse-engineered)
 *
 * Reverse-engineered from USB captures of the official "ATTACK SHARK WEB"
 * driver and the official desktop app's source code. Not an official
 * Attack Shark or SignalRGB plugin - use at your own risk.
 *
 * Protocol (confirmed working for whole-keyboard sync):
 *  - VID 0x3151, HID interface 2 (usage_page 0xffff), Report ID 0.
 *  - Writes are HID *Feature* reports via device.send_report() - device.write()
 *    is confirmed WRONG for this endpoint (throws "Incorrect Function").
 *  - SignalRGB requires a leading 0x00 "Zero Padding" byte before the real
 *    command data, with the length argument to send_report() including it.
 *  - Real commands include a checksum: 255 - sum(header bytes) mod 256.
 *  - Whole-board solid color: 07 01 04 04 07 R G B [checksum] - CONFIRMED
 *    WORKING, verified live on real hardware. This is the default and only
 *    recommended mode.
 *
 * EXPERIMENTAL 7-Zone / Per-Key modes - READ BEFORE USING:
 *  - Both use the same underlying 0x0c chunked per-key table command -
 *    there is no lighter "zone" command in this protocol, the firmware
 *    only understands "whole board" or "full per-key table". Zone mode
 *    just paints the same color across every key in a zone; Per-Key mode
 *    fills each of the 66 key slots individually. Same command, same
 *    packet size, same risk either way.
 *  - Sending this repeatedly at render-loop frequency (an earlier version
 *    of this plugin did this) caused a real crash: the keyboard froze and
 *    had to be power-cycled, and SignalRGB itself crashed. Both modes
 *    hard-limit sends to at most once every ~2 seconds, plus a ~8s
 *    periodic keep-alive (a real capture of the official software showed
 *    it re-sends the full table on a similar cadence, even when idle -
 *    the custom display may need periodic re-assertion to stay visible).
 *  - The device has 7 selectable storage "layers" (confirmed via the
 *    official app's UI - a "Write to Custom Layer [N]" spinner). The
 *    `group` byte in the chunk protocol corresponds to which layer is
 *    targeted. Earlier versions incremented this on every send, scattering
 *    writes across different layers instead of consistently targeting the
 *    one actually being displayed. This version pins all writes to a
 *    single fixed layer (TARGET_LAYER) instead.
 *  - Still experimental, and Per-Key more so than Zone - it's unverified
 *    against real hardware and inherits every risk noted above, plus it
 *    changes 66 independent values instead of 7, so a fast Canvas effect
 *    (typing reactive, ripple, etc.) will hit the same-color check less
 *    often and could push toward the send-rate floor more frequently.
 *    Use Forced/static colors first, not fast animations, and watch the
 *    keyboard closely. Confirm Zone mode is stable on your PID before
 *    trying Per-Key.
 */

export function Name() { return "Attack Shark X68 Pro HE"; }
export function VendorId() { return 0x3151; }
export function ProductId() {
  // SignalRGB supports an array of Product IDs here. Only PIDs verified
  // to use this exact command protocol are included:
  //   0x5026 - Attack Shark X68 Pro HE (confirmed working live)
  //   0x502d - seen using the identical command format in a separate
  //            capture (likely a sibling model, not personally verified)
  //   0x5030 - added for testing (wired/USB connection), NOT YET VERIFIED.
  //            Test Whole Keyboard mode first and confirm it's stable
  //            before trying 7-Zone - a different PID can mean different
  //            firmware, and 7-Zone is the mode that previously caused a
  //            real freeze requiring a power-cycle on a verified device.
  // Other Attack Shark models may use a different protocol entirely and
  // are NOT included. Add your PID here only after testing carefully,
  // starting with Whole Keyboard mode.
  return [0x5026, 0x502d, 0x5030];
}
export function Publisher() { return "Community (reverse-engineered)"; }
export function Documentation(){ return "troubleshooting/brand-specific/whirlwind-fx"; }

// Fixed at a size large enough for both modes, so switching Sync Mode
// live (without a full SignalRGB restart) can't leave the device's
// actual canvas dimensions stale/mismatched - this was the direct cause
// of the "device.color() Out of bounds" errors.
export function Size() { return [30, 10]; }
export function DefaultPosition(){ return [240, 120]; }
export function DefaultScale(){ return 8.0; }

/* global
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
SyncMode:readonly
equalizerColor:readonly
*/
export function ControllableParameters(){
  return [
    {"property":"shutdownColor", "label":"Shutdown Color", "min":"0", "max":"360", "type":"color", "default":"000000"},
    {"property":"LightingMode", "label":"Lighting Mode", "type":"combobox", "values":["Canvas", "Forced", "Equalizer (colorize Canvas)"], "default":"Canvas"},
    {"property":"forcedColor", "label":"Forced Color", "min":"0", "max":"360", "type":"color", "default":"009bde"},
    {"property":"equalizerColor", "label":"Equalizer Color", "min":"0", "max":"360", "type":"color", "default":"ff0000"},
    {"property":"SyncMode", "label":"Sync Mode", "type":"combobox", "values":["Whole Keyboard (stable)", "7-Zone (experimental, rate-limited)", "Per-Key (experimental, rate-limited)", "REPAIR: Reset Table Once"], "default":"Whole Keyboard (stable)"},
  ];
}

// ---- 7-Zone layout (experimental) --------------------------------------
// Full 66-key slot map (slot = row + 6*column), reused so we can fill the
// mandatory full-table command even though the user only picks 7 colors.
let vAllKeyPositions = [
  [0,0],[2,0],[4,0],[6,0],[8,0],[10,0],[12,0],[14,0],[16,0],[18,0],[20,0],[22,0],[24,0],[26,0],[28,0],
  [0,2],[2,2],[4,2],[6,2],[8,2],[10,2],[12,2],[14,2],[16,2],[18,2],[20,2],[22,2],[24,2],[26,2],[28,2],
  [0,4],[2,4],[4,4],[6,4],[8,4],[10,4],[12,4],[14,4],[16,4],[18,4],[20,4],[22,4],[26,4],[28,4],
  [0,6],[4,6],[6,6],[8,6],[10,6],[12,6],[14,6],[16,6],[18,6],[20,6],[22,6],[24,6],[26,6],
  [0,8],[4,8],[6,8],[12,8],[18,8],[20,8],[24,8],[26,8],[28,8]
];
let vAllKeySlots = [1,7,13,19,25,31,37,43,49,55,61,67,73,79,85, 2,8,14,20,26,32,38,44,50,56,62,68,74,80,86, 3,9,15,21,27,33,39,45,51,57,63,69,81,87, 4,16,22,28,34,40,46,52,58,64,70,76,82, 5,17,23,41,59,65,77,83,89];

// 7 zones, split by column position (x-coordinate 0-28 in 2-unit steps = 15 columns).
const ZONE_COUNT = 7;
function zoneForX(x) {
  let col = x / 2;
  return Math.min(ZONE_COUNT - 1, Math.floor((col / 15) * ZONE_COUNT));
}

let vZoneNames = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5", "Zone 6", "Zone 7"];
let vZonePositions = [[2,4],[6,4],[10,4],[14,4],[18,4],[22,4],[26,4]];

let vLedNamesWhole = ["Lighting"];
let vLedPositionsWhole = [[0, 0]];

// Per-key mode: one controllable LED per physical key slot, using the
// exact same 66-key position map that already feeds the zone table.
let vLedNamesPerKey = vAllKeyPositions.map((_, i) => "Key " + (i + 1));
let vLedPositionsPerKey = vAllKeyPositions;

const TOTAL_SLOTS = 130;
const CHUNK_COUNT = 7;
const CHUNK_BODY_LEN = 56;
const TOTAL_TABLE_LEN = CHUNK_COUNT * CHUNK_BODY_LEN;

// Minimum time between actual hardware writes in Zone/Per-Key mode, in
// Render() ticks. Render() pauses ~50ms per tick. Both modes share these
// limits since both write the same full 66-key table over the same
// chunked command - see header notes on the crash this prevents.
const ZONE_MIN_TICKS_BETWEEN_SENDS = 40;   // ~2s floor for change-triggered sends
const ZONE_KEEPALIVE_TICKS = 160;          // ~8s periodic resend, matching the
                                            // official software's own refresh
                                            // cadence observed in a real capture.

// Minimum ticks between whole-keyboard sends (Render() pauses ~50ms/tick).
// 4 ticks =~ 200ms - fast enough to feel live for static colors and slow
// transitions/breathing effects, but stops an animated Canvas effect from
// firing a new hardware command every single frame, which the keyboard
// can't visually keep up with - that mismatch is what caused the flicker.
const WHOLE_MIN_TICKS_BETWEEN_SENDS = 4;

// Minimum combined RGB change (sum of |delta| across R,G,B, 0-765 range)
// required before a color is considered "changed enough" to write.
// The 200ms tick floor alone still lets a smooth Canvas fade trigger a
// real hardware write ~5x/sec, and each write causes a small visible
// flash as the controller re-latches the new static-color command. This
// threshold skips writes for near-identical shades so a fade only
// updates the hardware in visibly distinct steps instead of every tick.
const WHOLE_MIN_COLOR_DELTA = 12;

// Which of the keyboard's 7 storage layers to target - see header notes.
// Pinned to a single fixed value instead of rotating through all 7.
const TARGET_LAYER = 0;

function currentMode() {
  if (typeof SyncMode === "undefined") return "whole";
  if (SyncMode === "7-Zone (experimental, rate-limited)") return "zones";
  if (SyncMode === "Per-Key (experimental, rate-limited)") return "perkey";
  if (SyncMode === "REPAIR: Reset Table Once") return "repair";
  return "whole";
}

export function LedNames() {
  let mode = currentMode();
  if (mode === "zones") return vZoneNames;
  if (mode === "perkey") return vLedNamesPerKey;
  return vLedNamesWhole;
}

export function LedPositions() {
  let mode = currentMode();
  if (mode === "zones") return vZonePositions;
  if (mode === "perkey") return vLedPositionsPerKey;
  return vLedPositionsWhole;
}

export function onSyncModeChanged() {
  device.setControllableLeds(LedNames(), LedPositions());
  device.log("Sync mode changed to: " + SyncMode);
}

let frameCounter = 0;
let lastColor = [-1, -1, -1];
let ticksSinceWholeSend = WHOLE_MIN_TICKS_BETWEEN_SENDS;
let lastZoneColors = [[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1]];
let ticksSinceZoneSend = ZONE_MIN_TICKS_BETWEEN_SENDS; // allow immediate first send
let lastKeyColors = vAllKeyPositions.map(() => [-1, -1, -1]);
let ticksSincePerKeySend = ZONE_MIN_TICKS_BETWEEN_SENDS; // allow immediate first send

export function Initialize() {
  frameCounter = 0;
  lastColor = [-1, -1, -1];
  ticksSinceWholeSend = WHOLE_MIN_TICKS_BETWEEN_SENDS;
  lastZoneColors = [[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1],[-1,-1,-1]];
  ticksSinceZoneSend = ZONE_MIN_TICKS_BETWEEN_SENDS;
  lastKeyColors = vAllKeyPositions.map(() => [-1, -1, -1]);
  ticksSincePerKeySend = ZONE_MIN_TICKS_BETWEEN_SENDS;
  device.setControllableLeds(LedNames(), LedPositions());

  if (currentMode() === "zones" || currentMode() === "perkey") {
    sendModeHandshake();
  }

  if (currentMode() === "repair") {
    // ONE complete, clean write of the full 66-key table, every key set
    // to off (0,0,0). No loop, no repeat, no keep-alive - this is a
    // single deliberate attempt to overwrite a possibly-corrupted
    // persistent table with one known-good, fully-valid write.
    // After this runs, switch Sync Mode back to Whole Keyboard and
    // power-cycle the keyboard (unplug ~10s, replug) so the firmware
    // reloads from the freshly-written table on a clean boot.
    device.log("REPAIR: sending one full-table reset (all keys off)...");
    let offColors = vAllKeyPositions.map(() => [0, 0, 0]);
    sendKeyTable(offColors);
    device.log("REPAIR: done. Switch Sync Mode back to Whole Keyboard now, then unplug/replug the keyboard.");
  }
}

export function Render() {
  if (currentMode() === "repair") {
    // Nothing to do here - the one-time write already happened in
    // Initialize(). Deliberately not sending anything on every frame.
    device.pause(50);
    return;
  }
  if (currentMode() === "perkey") {
    ticksSincePerKeySend++;

    let keyColors = [];
    for (let i = 0; i < vAllKeyPositions.length; i++) {
      let x = vAllKeyPositions[i][0];
      let y = vAllKeyPositions[i][1];
      let color = sampleColor(x, y);
      keyColors.push(color);
    }

    let changed = false;
    for (let i = 0; i < keyColors.length; i++) {
      if (keyColors[i][0] !== lastKeyColors[i][0] || keyColors[i][1] !== lastKeyColors[i][1] || keyColors[i][2] !== lastKeyColors[i][2]) {
        changed = true;
        break;
      }
    }

    // Same send policy as Zone mode: change-triggered but rate-floored,
    // plus a periodic keep-alive. See header notes on why this floor
    // exists - it's not just a nicety, it's what stops the freeze.
    if ((changed && ticksSincePerKeySend >= ZONE_MIN_TICKS_BETWEEN_SENDS) ||
        ticksSincePerKeySend >= ZONE_KEEPALIVE_TICKS) {
      sendKeyTable(keyColors);
      lastKeyColors = keyColors;
      ticksSincePerKeySend = 0;
    }

    device.pause(50);
  } else if (currentMode() === "zones") {
    ticksSinceZoneSend++;

    let zoneColors = [];
    for (let z = 0; z < ZONE_COUNT; z++) {
      let x = vZonePositions[z][0];
      let y = vZonePositions[z][1];
      let color = sampleColor(x, y);
      zoneColors.push(color);
    }

    let changed = false;
    for (let z = 0; z < ZONE_COUNT; z++) {
      if (zoneColors[z][0] !== lastZoneColors[z][0] || zoneColors[z][1] !== lastZoneColors[z][1] || zoneColors[z][2] !== lastZoneColors[z][2]) {
        changed = true;
        break;
      }
    }

    // Send if: (a) something changed and the minimum gap has passed, or
    // (b) nothing changed but it's been a while - a periodic keep-alive.
    if ((changed && ticksSinceZoneSend >= ZONE_MIN_TICKS_BETWEEN_SENDS) ||
        ticksSinceZoneSend >= ZONE_KEEPALIVE_TICKS) {
      sendZoneColors(zoneColors);
      lastZoneColors = zoneColors;
      ticksSinceZoneSend = 0;
    }

    device.pause(50);
  } else {
    ticksSinceWholeSend++;
    let color = sampleColor(0, 0);
    let delta = Math.abs(color[0] - lastColor[0]) + Math.abs(color[1] - lastColor[1]) + Math.abs(color[2] - lastColor[2]);
    if (delta >= WHOLE_MIN_COLOR_DELTA &&
        ticksSinceWholeSend >= WHOLE_MIN_TICKS_BETWEEN_SENDS) {
      sendWholeColor(color);
      lastColor = color;
      ticksSinceWholeSend = 0;
    }
    device.pause(50);
  }
}

export function Shutdown(SystemSuspending) {
  let color = SystemSuspending ? hexToRgb("#000000") : hexToRgb(shutdownColor);
  // Always shut down via the whole-keyboard command, even in Zone mode -
  // it's the confirmed-safe, confirmed-live command.
  sendWholeColor(color);
}

function sumBytes(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s & 0xff;
}

// ---- Whole-keyboard command (CONFIRMED WORKING, default mode) ---------
function sendWholeColor(color) {
  let packet = new Array(65).fill(0);
  packet[0] = 0x00; // Zero Padding (SignalRGB convention)
  packet[1] = 0x07; // command: set color
  packet[2] = 0x01; // mode: static/custom
  packet[3] = 0x04;
  packet[4] = 0x04;
  packet[5] = 0x07;
  packet[6] = color[0]; // R
  packet[7] = color[1]; // G
  packet[8] = color[2]; // B
  packet[9] = (255 - sumBytes(packet.slice(1, 9))) & 0xff; // checksum

  let result = device.send_report(packet, 65);
  if (frameCounter % 120 === 0) {
    device.log("sendWholeColor [" + color + "] result: " + result);
  }
  frameCounter++;
}

// ---- 7-Zone command (EXPERIMENTAL, rate-limited, fixed layer) ---------
function sendModeHandshake() {
  let groupNibble = (TARGET_LAYER << 4) & 0xff;
  let packet = new Array(65).fill(0);
  packet[0] = 0x00;
  packet[1] = 0x07;
  packet[2] = 0x0d;
  packet[3] = 0x04;
  packet[4] = 0x04;
  packet[5] = groupNibble;
  packet[6] = 0x00;
  packet[7] = 0xc8;
  packet[8] = 0xc8;
  packet[9] = (255 - sumBytes(packet.slice(1, 9))) & 0xff;

  let result = device.send_report(packet, 65);
  device.log("Zone mode handshake (layer " + TARGET_LAYER + ") result: " + result);
}

function sendZoneColors(zoneColors) {
  let keyColors = vAllKeyPositions.map((pos) => zoneColors[zoneForX(pos[0])]);
  sendKeyTable(keyColors);
}

// ---- Shared table builder/sender for Zone and Per-Key modes -----------
// Takes one [R,G,B] per entry in vAllKeyPositions (66 keys) and writes
// the full chunked table. Zone mode pre-expands its 7 zone colors to 66
// keys before calling this; Per-Key mode passes 66 independently-sampled
// colors directly. Same command, same rate-limit responsibility sits
// with the caller (see Render()).
function sendKeyTable(keyColors) {
  let table = new Array(TOTAL_TABLE_LEN).fill(0);

  for (let i = 0; i < vAllKeyPositions.length; i++) {
    let color = keyColors[i];
    let slot = vAllKeySlots[i];
    let off = slot * 3;
    table[off] = color[0];
    table[off + 1] = color[1];
    table[off + 2] = color[2];
  }

  let group = TARGET_LAYER;

  for (let chunkIndex = 0; chunkIndex < CHUNK_COUNT; chunkIndex++) {
    let packet = new Array(65).fill(0);
    packet[0] = 0x00;
    packet[1] = 0x0c;
    packet[2] = group;
    packet[3] = 0xff;
    packet[4] = chunkIndex;
    packet[5] = (chunkIndex === CHUNK_COUNT - 1) ? 0x2a : 0x38;
    packet[6] = (chunkIndex === CHUNK_COUNT - 1) ? 0x01 : 0x00;
    packet[7] = 0x00;
    packet[8] = (255 - sumBytes(packet.slice(1, 8))) & 0xff;

    let start = chunkIndex * CHUNK_BODY_LEN;
    for (let b = 0; b < CHUNK_BODY_LEN; b++) {
      packet[9 + b] = table[start + b];
    }

    let result = device.send_report(packet, 65);
    device.log("key-table-send chunk " + chunkIndex + " (layer " + group + ") result: " + result);
    device.pause(15);
  }
}

function hexToRgb(hex) {
  let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
}

// Equalizer mode: takes whatever brightness pattern the assigned Canvas
// effect is drawing (e.g. a SignalRGB audio/VU-meter effect's bars) and
// re-renders it entirely in one chosen color instead of the effect's own
// palette. Brightness = max channel of the sampled color, 0-1, scaled
// onto equalizerColor. A lit bar becomes solid equalizerColor; an unlit
// key stays off, regardless of what hue the source effect was using.
function colorizeForEqualizer(sampledColor) {
  let brightness = Math.max(sampledColor[0], sampledColor[1], sampledColor[2]) / 255;
  let eq = hexToRgb(equalizerColor);
  return [
    Math.round(eq[0] * brightness),
    Math.round(eq[1] * brightness),
    Math.round(eq[2] * brightness)
  ];
}

// Central color-sampling helper used by all three sync modes, so
// LightingMode behavior (Canvas / Forced / Equalizer) stays consistent
// across Whole Keyboard, 7-Zone, and Per-Key.
function sampleColor(x, y) {
  if (LightingMode === "Forced") {
    return hexToRgb(forcedColor);
  }
  if (LightingMode === "Equalizer (colorize Canvas)") {
    return colorizeForEqualizer(device.color(x, y));
  }
  return device.color(x, y);
}

// CONFIRMED via device console log.
export function Validate(endpoint) {
  return endpoint.interface === 2 && endpoint.usage_page === 0xffff;
}

export function ImageUrl() {
  return "";
}