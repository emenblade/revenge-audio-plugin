# Claude Code Handoff — Bluetooth A2DP Keeper (Revenge Plugin)

Hey Claude Code — Alex is bringing this project over from a Claude.ai chat.
Here's everything you need to know to pick up right where we left off.

---

## The Goal

Discord on Android forces Bluetooth headphones into HFP/SCO (telephony mode,
mono 64kbps garbage) whenever a voice call is joined. Alex wants to stay in
A2DP (high-quality stereo media mode) for output and use a USB-C microphone
for input instead. This plugin intercepts the Android AudioManager bridge
calls that cause the switch — before they reach the native layer.

---

## What Lives in This Repo

```
bt-a2dp-keeper/
├── plugins/
│   └── BluetoothA2DPKeeper/
│       ├── src/
│       │   └── index.ts          ← all plugin logic
│       └── manifest.json         ← plugin metadata
├── build.mjs                     ← esbuild build script
├── package.json
├── tsconfig.json
├── README.md
└── .github/
    └── workflows/
        └── build.yml             ← auto-builds + deploys to gh-pages on push
```

After build, output goes to `dist/BluetoothA2DPKeeper/{index.js, manifest.json}`.
The GitHub Action deploys `dist/` to the `gh-pages` branch automatically.

Install URL format for Revenge:
`https://USERNAME.github.io/bt-a2dp-keeper/BluetoothA2DPKeeper`

---

## How Revenge Plugins Work

Revenge is a Discord Android mod. It injects JavaScript into Discord's React
Native runtime via an Xposed module. Plugins are loaded from URLs and consist
of `manifest.json` + a compiled `index.js`.

**Plugin entry point** exports:
```ts
export default {
  onLoad() { /* set up patches */ },
  onUnload() { /* clean up ALL patches */ }
}
```

**Patching API** (`@vendetta/patcher`):
- `instead(method, object, (args, orig) => ...)` — replaces a function entirely
- `before(method, object, (args) => ...)` — runs before, can modify args
- `after(method, object, ([retval], orig) => ...)` — runs after, can modify return
- All three return an unpatch function — MUST be called in onUnload()

**Module discovery** (`@vendetta/metro`):
- `findByProps("propName")` — finds a module by exposed property name
- `findByName("ModuleName")` — by name
- `ReactNative.NativeModules` — direct access to Android bridge modules

**Events** (`@vendetta/metro/common` → `FluxDispatcher`):
- `FluxDispatcher.subscribe("EVENT_NAME", handler)`
- `FluxDispatcher.unsubscribe("EVENT_NAME", handler)` in onUnload
- `VOICE_CHANNEL_SELECT` fires when joining/leaving voice. Payload: `{ channelId, guildId }`
  - `channelId !== null` = joining
  - `channelId === null` = leaving

**UI** (`@vendetta/ui/toasts`, `@vendetta/ui/assets`):
- `showToast("message", iconAssetId)`
- `getAssetIDByName("ic_audio")`

All `@vendetta/*` imports are EXTERNAL — esbuild does NOT bundle them.
They're provided at runtime by the Revenge loader. See `build.mjs` external list.

---

## The Core Problem: Android Audio Routing

When Discord joins a voice channel, it calls through the React Native bridge:

1. `AudioManager.setMode(3)` → MODE_IN_COMMUNICATION (primes SCO routing)
2. `AudioManager.startBluetoothSco()` → opens SCO connection (BT switches A2DP→HFP)
3. `AudioManager.setBluetoothScoOn(true)` → routes audio through SCO
4. Android 12+: `AudioManager.setCommunicationDevice(device)` where device type=7 (BT_SCO)

The moment startBluetoothSco() succeeds, Bluetooth drops from stereo to mono 64kbps.

**The Fix:**
- `startBluetoothSco` → no-op (never call original)
- `stopBluetoothSco` → no-op (calling this actively disconnects BT audio on some devices)
- `setBluetoothScoOn` → no-op
- `setMode(2 or 3)` → call original with 0 (MODE_NORMAL) instead
- `setCommunicationDevice(device)` → block if device type === 7 (TYPE_BLUETOOTH_SCO), allow others

**Critical:** Do NOT call stopBluetoothSco() actively. The reference plugin Alex
found (NarwhalKid/revenge-plugin/audiofix) broke Bluetooth output entirely —
likely because it called stopBluetoothSco or blocked setMode entirely, which
caused Android to stop routing audio to Bluetooth altogether. Just never
*starting* SCO is sufficient; leave the A2DP connection completely alone.

---

## Module Discovery Strategy

Discord's native bridge module names are not stable. The plugin uses a 3-layer
approach to find audio methods:

**Layer 1:** Named module lookup in NativeModules:
`InCallManager`, `AudioManager`, `RTCManager`, `VoiceEngine`, `MediaEngine`, etc.

**Layer 2:** Metro findByProps searches:
`findByProps("startBluetoothSco")`, `findByProps("setMode", "getMode")`, etc.

**Layer 3:** Brute-force scan of ALL NativeModules looking for objects that have
`startBluetoothSco` or `setBluetoothScoOn` as functions.

Patches are de-duplicated by method name (Set<string>) so the same method
doesn't get double-patched if found in multiple layers.

**Fallback:** If spitroast (the patcher library) can't hook a method, direct
property replacement on the module object is used as a last resort.

---

## Build & Deploy

```bash
npm install          # installs esbuild + typescript
npm run build        # runs build.mjs → outputs to dist/
```

Build output: `dist/BluetoothA2DPKeeper/index.js` + `manifest.json`

GitHub Actions (`.github/workflows/build.yml`) auto-runs on push to main.
Uses `peaceiris/actions-gh-pages@v4` to deploy `dist/` → `gh-pages` branch.
Repo needs Settings → Pages → source set to `gh-pages` branch.

---

## Debugging

In Revenge's dev tools / Metro console, filter for `[A2DPKeeper]`.

Key log lines to check:
- `Discovered modules: ...` — lists every module found
- `Patching ModuleName.methodName → no-op` — confirms patch applied
- `Total patches applied: N | Methods: ...` — N=0 means nothing found, need to update discovery
- `BLOCKED ModuleName.startBluetoothSco(...)` — confirms interception is firing during a call
- Toast "BT SCO blocked 🎧" on call join = plugin is active

If N=0 patches: Discord updated their native module. Use React DevTools or
Revenge's module explorer to find what module now exposes audio methods,
then add the new name to the `candidates` array in `discoverModules()`.

---

## Known Limitations

- **JS bridge only:** Patches only intercept calls going through React Native's
  JS→native bridge. If Discord's WebRTC C++ core calls AudioManager directly
  via JNI (bypassing the bridge), these patches won't fire. In that case the
  fix would need to be an Xposed module hooking `android.media.AudioManager`
  at the Java framework level instead.
  
- **Volume buttons:** In MODE_NORMAL, volume keys control STREAM_MUSIC not
  STREAM_VOICE_CALL. Alex considers this fine.

- **No echo cancellation:** setMode downgrade disables Android's hardware AEC.
  With a physically separate USB-C mic this is a non-issue. Alex confirmed
  he doesn't care about this.

- **Device variability:** Samsung/Pixel/OnePlus may behave differently. Some
  devices auto-switch BT to SCO when any communication audio stream opens,
  even without an explicit startBluetoothSco call. If that happens, investigate
  AudioFocusRequest interception as an additional layer.

---

## Alex's Context

- GitHub username: alexanderdomatas (personal) / emenblade (streaming alias)
- This plugin is for personal use, repo name: `bt-a2dp-keeper`
- Alias for the plugin is "emenblade" in manifest authors
- Comfortable with Docker, GitHub, Node — no hand-holding needed
- Preference: direct, minimal fluff, no corporate language
