/*
 * Attack Shark X68 Pro HE - SignalRGB Plugin (community reverse-engineered)
 *
 * Reverse-engineered from USB captures of the official "ATTACK SHARK WEB"
 * driver (qmk.top / rongyuan.tech). Not an official Attack Shark or
 * SignalRGB plugin - use at your own risk.
 *
 * IMPORTANT - WHY THIS IS SINGLE-ZONE, NOT PER-KEY:
 * A SignalRGB GitLab issue investigating a sibling Attack Shark model
 * (K86, same controller family) found that the keyboard's "custom
 * per-key" mode writes to flash storage rather than updating live -
 * it's a "set once, remember forever" profile, not something the
 * firmware renders in real time. The only mode confirmed to update
 * live is a single solid color across the whole board. This plugin
 * targets that live whole-board command instead of the per-key one.
 * This matches what we observed directly: per-key chunk writes
 * succeeded at the OS/HID level every time (no errors, no disconnects)
 * but never visibly changed the keyboard - consistent with data being
 * saved to flash rather than rendered.
 *
 * Protocol (from packet capture, not vendor documentation):
 *  - VID 0x3151 / PID 0x5026, HID interface 2, Report ID 0.
 *  - Writes are HID *Feature* reports (SET_REPORT, wValue high byte
 *    0x03) via Control transfer - hence device.send_report() instead
 *    of device.write().
 *  - Endpoint CONFIRMED via SignalRGB device console:
 *    interface===2, usage_page===0xffff (vendor-specific). Opens
 *    cleanly, stable, no disconnects.
 *  - Whole-board solid color command, captured directly from setting
 *    rgb(0,0,0) -> rgb(255,0,0) -> rgb(255,255,0) -> rgb(255,255,255)
 *    in the official driver, byte-for-byte:
 *      07 01 04 04 07 R G B 00 00 ... (64 bytes, R/G/B at offsets 5/6/7)
 *    This command needs no handshake/init packet - confirmed working
 *    standalone in the original capture.
 *
 * KNOWN UNCERTAINTIES:
 *   1. This plugin has not yet been tested live against the device.
 *      The endpoint is confirmed correct (from device console), but
 *      this specific command's byte-for-byte reproduction is new.
 *   2. Byte alignment: a leading 0x00 Report-ID placeholder byte is
 *      added before the real data (see sendColor()), per SignalRGB's
 *      documented zero-padding convention for Report-ID-less HID
 *      devices. This was confirmed correct for the per-key command
 *      (clean 65/65 byte writes), so kept the same way here.
 *   3. True per-key sync may not be achievable on this firmware at
 *      all, per the GitLab finding above - this plugin treats the
 *      whole keyboard as one zone.
 */

export function Name() { return "Attack Shark X68 Pro HE"; }
export function VendorId() { return 0x3151; }
export function ProductId() { return 0x5026; }
export function Publisher() { return "Community (reverse-engineered)"; }
export function Documentation(){ return "troubleshooting/brand-specific/whirlwind-fx"; }

export function Size() { return [1, 1]; }
export function DefaultPosition(){ return [240, 120]; }
export function DefaultScale(){ return 8.0; }

/* global
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
*/
export function ControllableParameters(){
  return [
    {"property":"shutdownColor", "label":"Shutdown Color", "min":"0", "max":"360", "type":"color", "default":"000000"},
    {"property":"LightingMode", "label":"Lighting Mode", "type":"combobox", "values":["Canvas", "Forced"], "default":"Canvas"},
    {"property":"forcedColor", "label":"Forced Color", "min":"0", "max":"360", "type":"color", "default":"009bde"},
  ];
}

// Single zone - the whole keyboard is one LED as far as the protocol
// is concerned.
let vLedNames = ["Lighting"];
let vLedPositions = [[0, 0]];

export function LedNames() {
  return vLedNames;
}

export function LedPositions() {
  return vLedPositions;
}

let frameCounter = 0;
let lastColor = [-1, -1, -1];

export function Initialize() {
  frameCounter = 0;
  lastColor = [-1, -1, -1];
  // No handshake needed for the whole-board command - confirmed
  // working standalone in the original capture.
}

export function Render() {
  let color;
  if (LightingMode === "Forced") {
    color = hexToRgb(forcedColor);
  } else {
    color = device.color(0, 0);
  }

  if (color[0] !== lastColor[0] || color[1] !== lastColor[1] || color[2] !== lastColor[2]) {
    sendColor(color);
    lastColor = color;
  }

  device.pause(50);
}

export function Shutdown(SystemSuspending) {
  if (SystemSuspending) {
    sendColor(hexToRgb("#000000"));
  } else {
    sendColor(hexToRgb(shutdownColor));
  }
}

function sumBytes(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s & 0xff;
}

function sendColor(color) {
  // Combining two separately-confirmed facts:
  // 1. SignalRGB's own official plugin template labels packet[0] as
  //    "Zero Padding" and sends length = data length + 1 - the report
  //    ID goes in as a leading byte, shifting everything else right by one.
  // 2. The official app's source computes a real checksum: 255 - sum of
  //    the 8 real command/header bytes (07 01 04 04 07 R G B) - which we
  //    verified exactly against 4 captured colors.
  // These were never tried together before - checksum position shifts
  // by 1 to sit after the (now shifted) 8-byte header instead of before it.
  let packet = new Array(65).fill(0);
  packet[0] = 0x00; // Zero Padding / Report ID placeholder
  packet[1] = 0x07; // command: set color
  packet[2] = 0x01; // mode: static/custom
  packet[3] = 0x04; // constant (observed)
  packet[4] = 0x04; // constant (observed)
  packet[5] = 0x07; // constant (observed)
  packet[6] = color[0]; // R
  packet[7] = color[1]; // G
  packet[8] = color[2]; // B
  packet[9] = (255 - sumBytes(packet.slice(1, 9))) & 0xff; // checksum over the 8 real header/color bytes

  let result = device.send_report(packet, 65);

  if (frameCounter % 120 === 0) {
    device.log("sendColor [" + color[0] + "," + color[1] + "," + color[2] + "] send_report result: " + result);
  }
  frameCounter++;
}

function hexToRgb(hex) {
  let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  let colors = [];
  colors[0] = parseInt(result[1], 16);
  colors[1] = parseInt(result[2], 16);
  colors[2] = parseInt(result[3], 16);
  return colors;
}

// CONFIRMED via device console log: this is the only endpoint with
// interface===2, and usage_page 0xffff marks it vendor-specific.
export function Validate(endpoint) {
  return endpoint.interface === 2 && endpoint.usage_page === 0xffff;
}

export function ImageUrl() {
  return "";
}