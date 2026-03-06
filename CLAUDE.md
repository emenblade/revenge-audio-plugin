# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A **Revenge plugin** (Discord Android mod) that prevents Discord from switching Bluetooth headphones from A2DP (high-quality stereo) to HFP/SCO (mono telephony garbage) when joining a voice call. Designed for: BT headphones for output + USB-C mic for input.

## Commands

```bash
npm install      # install esbuild + typescript
npm run build    # compile plugins → dist/
```

Build output: `dist/BluetoothA2DPKeeper/index.js` + `manifest.json`

Pushing to `main` triggers the GitHub Action which builds and deploys `dist/` to the `gh-pages` branch automatically.

## Architecture

All plugin logic is in `plugins/BluetoothA2DPKeeper/src/index.ts`. There is no test suite.

### How Revenge plugins work

Revenge injects JS into Discord's React Native runtime via Xposed. Plugins must export `{ onLoad(), onUnload() }`. All `@vendetta/*` imports are **external** — provided at runtime by the Revenge loader, never bundled.

- `@vendetta/patcher` — `instead(method, obj, (args, orig) => ...)` replaces functions; returns unpatch fn
- `@vendetta/metro` — `findByProps("propName")` finds Discord's internal modules
- `@vendetta/metro/common` — `ReactNative.NativeModules`, `FluxDispatcher`
- `@vendetta/ui/toasts` + `@vendetta/ui/assets` — `showToast`, `getAssetIDByName`

Every patch must be stored and reversed in `onUnload()`.

### What the plugin patches

| Method | Action |
|---|---|
| `startBluetoothSco()` | No-op |
| `stopBluetoothSco()` | No-op (calling this actively breaks BT audio on some devices) |
| `setBluetoothScoOn(bool)` | No-op |
| `setMode(2 or 3)` | Downgrade to `setMode(0)` (MODE_NORMAL), pass other values through |
| `setCommunicationDevice(dev)` | Block if `dev.type === 7` (TYPE_BLUETOOTH_SCO), allow others |

**Do NOT block `setMode` entirely** — it's called for unrelated things. **Do NOT call `stopBluetoothSco` actively.**

### Module discovery (3-layer approach)

Discord's native bridge module names are not stable:

1. **Named lookup** — check `NativeModules` for known names: `InCallManager`, `AudioManager`, `RTCManager`, `VoiceEngine`, `MediaEngine`, `AudioModule`, `DCDAudioManager`
2. **Metro search** — `findByProps("startBluetoothSco")`, etc.
3. **Brute-force scan** — iterate all `NativeModules` looking for objects with SCO methods; fall back to direct property replacement

Patches are de-duplicated by method name using a `Set<string>`.

### Build system

`build.mjs` uses esbuild to bundle each plugin's `src/index.ts` → `dist/PLUGINNAME/index.js`. Output format is `iife` with `globalName: "plugin"` and footer `module.exports = plugin;` — required by Revenge's loader. Manifest is copied alongside.

## Debugging

Filter Revenge's Metro console for `[A2DPKeeper]`. Key lines:
- `Discovered modules: ...` — what was found
- `Total patches applied: N | Methods: ...` — N=0 means Discord renamed their module; add new name to `candidates` array in `discoverModules()`
- `BLOCKED ModuleName.startBluetoothSco(...)` — interception is firing

## Known limitations

- Patches only intercept calls through the React Native JS→native bridge. If Discord's WebRTC C++ core calls `AudioManager` directly via JNI, these patches won't fire. The fix in that case is an Xposed module hooking `android.media.AudioManager` at the Java framework level.
- Some devices (Samsung etc.) auto-switch BT to SCO when any communication audio stream opens, even without an explicit `startBluetoothSco` call. If that happens, investigate `AudioFocusRequest` interception.
