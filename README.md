# Bluetooth A2DP Keeper — Revenge Plugin

Prevents Discord from switching your Bluetooth headphones into low-quality
HFP/SCO telephony mode when joining a voice call. Keeps Bluetooth locked in
A2DP (high-quality media mode) and lets you use a USB-C mic for input.

## Install URL

After pushing to GitHub and letting the Action run, paste this into Revenge → Plugins → Add:

```
https://emenblade.github.io/revenge-audio-plugin/BluetoothA2DPKeeper
```

## What it does

- Blocks `startBluetoothSco()` — prevents the Bluetooth profile switch from A2DP → HFP
- Blocks `setBluetoothScoOn()` — redundant SCO enable call, also blocked
- Intercepts `setMode(MODE_IN_COMMUNICATION)` and downgrades to `MODE_NORMAL`
- Blocks `setCommunicationDevice()` for BT SCO device types (Android 12+)
- Scans all NativeModules as a fallback in case Discord's bridge module has an unexpected name
- Toasts you when you join a voice channel to confirm it's active

## What it does NOT do

- Does not disable Bluetooth audio output
- Does not touch A2DP at all
- Does not affect non-Android platforms (no-op on iOS)

## Build locally

```bash
npm install
npm run build
# output is in dist/BluetoothA2DPKeeper/
```

## Debugging

Check Discord's Metro console (via revenge dev tools) for `[A2DPKeeper]` log lines.
On join it will log which modules it found and which methods it patched.
If patches count is 0, Discord changed their native module names — open an issue.
