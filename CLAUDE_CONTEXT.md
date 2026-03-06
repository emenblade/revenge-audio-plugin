# Claude Code Context — Bluetooth A2DP Keeper (Revenge Plugin)

Hey future me. Here's everything you need to pick this up cold.

---

## What this project is

A plugin for **Revenge**, a Discord client mod for Android. The plugin's job is:

> When a Discord voice call is joined, **prevent Discord from switching
> Bluetooth headphones from A2DP (high-quality stereo) into HFP/SCO
> (garbage mono telephony mode)**. Alex wants to listen through BT
> headphones at full quality while using a **USB-C microphone** for input.

---

## Why this problem exists

Android Bluetooth can only do ONE profile at a time per device:

- **A2DP** — high quality stereo output, NO mic. Up to 990kbps (LDAC).
- **HFP/SCO** — bidirectional but mono, 8-16kHz, 64kbps max. Sounds awful.

When Discord joins a voice channel, its WebRTC engine calls:
1. `AudioManager.setMode(MODE_IN_COMMUNICATION)` — primes VoIP routing
2. `AudioManager.startBluetoothSco()` — forces the BT switch A2DP → HFP
3. `AudioManager.setBluetoothScoOn(true)` — routes audio through SCO
4. On Android 12+: `AudioManager.setCommunicationDevice(SCO_device)`

We block all of those. Since Alex has a USB-C mic, we don't need BT mic
at all — so there's zero reason to let the SCO switch happen.

---

## What the previous broken plugin did wrong

There's a reference plugin at:
`https://github.com/NarwhalKid/revenge-plugin/tree/master/audiofix`

It broke BT output entirely. Most likely cause: it called `stopBluetoothSco()`
or `setBluetoothScoOn(false)` **actively**, or blocked `setMode` in a way
that told Android "no audio session happening" — which caused Android to
deprioritize BT audio entirely. The fix is to **never initiate SCO**,
not to tear it down after the fact.

---

## How Revenge plugins work

Revenge is a JS injection mod. It runs inside Discord's React Native runtime
via an Xposed module (`revenge-xposed`). Plugins are served from URLs
(typically GitHub Pages) and consist of two files:

### File structure
```
plugins/
  MyPlugin/
    manifest.json   ← metadata
    src/
      index.ts      ← source (compiled to index.js by esbuild)
```

After build, `dist/MyPlugin/index.js` + `dist/MyPlugin/manifest.json`
are what Revenge actually loads.

### manifest.json
```json
{
  "name": "Plugin Name",
  "description": "...",
  "authors": [{ "name": "...", "id": "discord_snowflake" }],
  "main": "index.js",
  "vendetta": { "icon": "ic_audio" }
}
```

### Plugin lifecycle (index.ts)
```ts
export default {
  onLoad()   { /* set up patches here */ },
  onUnload() { /* MUST clean up ALL patches */ },
  settings:    SomeReactComponent  // optional
};
```

### Patching API (`@vendetta/patcher`)
```ts
import { before, after, instead } from "@vendetta/patcher";

// instead() replaces the function entirely
const unpatch = instead("methodName", targetObject, (args, originalFn) => {
  // args = array of arguments
  // call originalFn.apply(targetObject, args) to invoke original
  return someValue;
});

// ALWAYS call unpatch() in onUnload()
```

### Finding Discord's internal modules
```ts
import { findByProps } from "@vendetta/metro";
import { ReactNative, FluxDispatcher } from "@vendetta/metro/common";

const { NativeModules, Platform } = ReactNative;

// Find a module by what properties it exposes
const mod = findByProps("startBluetoothSco");

// Subscribe to Discord Flux events
FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", handler);
// handler receives: { channelId: string|null, guildId: string|null }
// channelId === null means the user LEFT voice
```

### Key Flux events for voice
- `VOICE_CHANNEL_SELECT` — join/leave voice channel (main one we use)
- `CALL_CREATE` / `CALL_DELETE` — DM calls
- `RTC_CONNECTION_STATE` — WebRTC state changes

### All `@vendetta/*` imports are EXTERNAL at build time
esbuild must mark them as external — they're injected at runtime by Revenge.

---

## How this plugin works (the strategy)

### Layer 1 — Named module search
Check NativeModules for known Discord/RN audio module names:
`InCallManager`, `AudioManager`, `RTCManager`, `VoiceEngine`, etc.

### Layer 2 — Metro search
Use `findByProps("startBluetoothSco")` etc. to find modules by what
methods they expose on the JS side.

### Layer 3 — Brute force fallback
Iterate ALL `NativeModules` entries looking for anything with
`startBluetoothSco` or `setBluetoothScoOn` as a function.
Direct property replacement (save orig, swap, push restore to patches[]).

### What gets patched
| Method | Action |
|---|---|
| `startBluetoothSco()` | No-op — never called |
| `stopBluetoothSco()` | No-op — prevents accidental teardown |
| `setBluetoothScoOn(bool)` | No-op |
| `setMode(2 or 3)` | Downgrade to `setMode(0)` (MODE_NORMAL) |
| `setCommunicationDevice(dev)` | Block if `dev.type === 7` (TYPE_BLUETOOTH_SCO), allow others |

**Do NOT block setMode entirely** — it gets called for unrelated things.
**Do NOT call stopBluetoothSco** — that tears down BT audio.
**Do NOT touch A2DP at all** — let it do its thing.

---

## Build system

```bash
npm install        # installs esbuild + typescript
npm run build      # runs build.mjs → outputs to dist/
```

`build.mjs` uses esbuild to bundle each plugin's `src/index.ts` into
`dist/PLUGINNAME/index.js`, then copies `manifest.json` alongside it.

All `@vendetta/*` imports are in the `external` list.

Output format is `iife` with `globalName: "plugin"` and a footer of
`module.exports = plugin;` — this is how Revenge expects plugins.

---

## Deployment

GitHub Actions (`.github/workflows/build.yml`) triggers on push to `main`:
1. `npm install`
2. `npm run build`
3. Deploys `dist/` to the `gh-pages` branch via `peaceiris/actions-gh-pages`

After first deploy, enable GitHub Pages in repo settings pointing to `gh-pages`.

**Install URL for Revenge:**
```
https://YOUR_USERNAME.github.io/bt-a2dp-keeper/BluetoothA2DPKeeper
```

---

## Debugging

In Revenge's dev tools Metro console, filter for `[A2DPKeeper]`.

Key log lines to look for:
- `Discovered modules: ...` — what it found
- `Patching X.startBluetoothSco → no-op` — patch confirmed
- `BLOCKED X.startBluetoothSco(...)` — firing during a call ✅
- `Total patches applied: N` — if N is 0, Discord renamed their module

If N is 0: Discord changed their native module names. Need to add a
console.log dump of ALL NativeModules keys to find the new name.

---

## Known limitations / next steps

1. **WebRTC C++ layer bypass**: If Discord's native WebRTC calls
   `AudioManager` directly from C++ over JNI (not through the RN bridge),
   these JS patches won't catch it. Solution: separate Xposed module hooking
   `android.media.AudioManager.startBluetoothSco()` at the Java level.

2. **Device variability**: Samsung/Pixel/OnePlus handle BT profile switching
   differently. Some devices auto-switch to SCO when a communication audio
   stream opens, regardless of whether `startBluetoothSco` was called.

3. **Volume control**: In MODE_NORMAL, volume buttons control STREAM_MUSIC
   not STREAM_VOICE_CALL. Fine for this use case.

4. **AEC**: Echo cancellation is weaker in MODE_NORMAL. Alex doesn't care
   since USB-C mic is physically separated from BT speakers.

---

## Repo structure (complete)

```
bt-a2dp-keeper/
├── .github/
│   └── workflows/
│       └── build.yml              ← CI: build + deploy to gh-pages
├── plugins/
│   └── BluetoothA2DPKeeper/
│       ├── manifest.json
│       └── src/
│           └── index.ts           ← all plugin logic lives here
├── build.mjs                      ← esbuild build script
├── package.json
├── tsconfig.json
├── README.md
└── CLAUDE_CONTEXT.md              ← this file
```

---

## Alex's preferences (important)

- **No overcomplicated solutions.** Push back if something is getting hairy.
- **Android only.** iOS is irrelevant.
- **No root required** for the JS plugin layer. Xposed is a fallback only.
- Writing/logging style: casual, dry, direct. No corporate fluff.
- He doesn't care about echo cancellation at all.
- Goal device setup: BT headphones (A2DP output) + USB-C mic (input).
