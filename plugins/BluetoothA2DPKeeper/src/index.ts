import { instead } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";
import { ReactNative, FluxDispatcher } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";

const { NativeModules, Platform } = ReactNative;

const patches: (() => void)[] = [];
const fluxUnsubs: (() => void)[] = [];
let inVoiceChannel = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function noopPatch(modName: string, mod: any, method: string): (() => void) | null {
  if (typeof mod?.[method] !== "function") return null;
  console.log(`[A2DPKeeper] Patching ${modName}.${method} → no-op`);
  return instead(method, mod, (args) => {
    console.log(`[A2DPKeeper] BLOCKED ${modName}.${method}(${args.join(", ")})`);
  });
}

function setModePatch(modName: string, mod: any): (() => void) | null {
  if (typeof mod?.setMode !== "function") return null;
  console.log(`[A2DPKeeper] Patching ${modName}.setMode → force MODE_NORMAL`);
  return instead("setMode", mod, ([mode, ...rest], orig) => {
    // MODE_IN_CALL=2, MODE_IN_COMMUNICATION=3 → downgrade to MODE_NORMAL=0
    if (mode === 2 || mode === 3) {
      console.log(`[A2DPKeeper] setMode(${mode}) → forcing 0 (MODE_NORMAL)`);
      return orig.call(mod, 0, ...rest);
    }
    return orig.call(mod, mode, ...rest);
  });
}

function commDevicePatch(modName: string, mod: any): (() => void) | null {
  if (typeof mod?.setCommunicationDevice !== "function") return null;
  console.log(`[A2DPKeeper] Patching ${modName}.setCommunicationDevice → block SCO type`);
  return instead("setCommunicationDevice", mod, ([device, ...rest], orig) => {
    // TYPE_BLUETOOTH_SCO = 7
    const type = device?.getType?.() ?? device?.type ?? null;
    if (type === 7) {
      console.log(`[A2DPKeeper] BLOCKED setCommunicationDevice for BT SCO (type=7)`);
      return false;
    }
    console.log(`[A2DPKeeper] setCommunicationDevice allowed (type=${type})`);
    return orig.call(mod, device, ...rest);
  });
}

// ─── Module discovery ─────────────────────────────────────────────────────────

function discoverModules(): Record<string, any> {
  const found: Record<string, any> = {};

  // Named modules Discord is known to use
  const candidates = [
    "InCallManager",
    "InCallManagerModule",
    "AudioManager",
    "RTCManager",
    "VoiceEngine",
    "MediaEngine",
    "AudioModule",
    "DCDAudioManager",
  ];

  for (const name of candidates) {
    if (NativeModules?.[name]) found[name] = NativeModules[name];
  }

  // Metro searches for modules with these methods exposed on the JS side
  const metroSearches: [string, string][] = [
    ["startBluetoothSco",    "_metro_sco"],
    ["setBluetoothScoOn",    "_metro_scoon"],
    ["setMode",              "_metro_mode"],
    ["setCommunicationDevice", "_metro_commdev"],
  ];
  for (const [prop, key] of metroSearches) {
    try {
      const m = findByProps(prop);
      if (m) found[key] = m;
    } catch {}
  }

  // Brute-force scan every NativeModule for SCO methods
  for (const [key, mod] of Object.entries(NativeModules ?? {})) {
    if (mod && typeof mod === "object") {
      if (
        typeof (mod as any).startBluetoothSco === "function" ||
        typeof (mod as any).setBluetoothScoOn === "function"
      ) {
        found[`_scan_${key}`] = mod;
      }
    }
  }

  return found;
}

// ─── Apply all patches ────────────────────────────────────────────────────────

function applyPatches() {
  if (Platform.OS !== "android") {
    console.log("[A2DPKeeper] Not Android — skipping");
    return;
  }

  const modules = discoverModules();
  console.log(`[A2DPKeeper] Discovered modules: ${Object.keys(modules).join(", ")}`);

  const patched = new Set<string>();

  for (const [name, mod] of Object.entries(modules)) {
    for (const method of ["startBluetoothSco", "stopBluetoothSco", "setBluetoothScoOn"] as const) {
      if (!patched.has(method) && typeof mod[method] === "function") {
        const u = noopPatch(name, mod, method);
        if (u) { patches.push(u); patched.add(method); }
      }
    }

    if (!patched.has("setMode")) {
      const u = setModePatch(name, mod);
      if (u) { patches.push(u); patched.add("setMode"); }
    }

    if (!patched.has("setCommunicationDevice")) {
      const u = commDevicePatch(name, mod);
      if (u) { patches.push(u); patched.add("setCommunicationDevice"); }
    }
  }

  // Fallback: direct property replacement on NativeModules if metro/spitroast
  // patches didn't fire (e.g. module not yet loaded at plugin init time)
  if (!patched.has("startBluetoothSco")) {
    console.log("[A2DPKeeper] Fallback scan for unpatched SCO methods...");
    for (const [key, mod] of Object.entries(NativeModules ?? {})) {
      const m = mod as any;
      if (!m || typeof m !== "object") continue;

      for (const method of ["startBluetoothSco", "stopBluetoothSco", "setBluetoothScoOn"]) {
        if (typeof m[method] === "function") {
          const orig = m[method];
          m[method] = (...args: any[]) =>
            console.log(`[A2DPKeeper] BLOCKED fallback ${key}.${method}`);
          patches.push(() => { m[method] = orig; });
          console.log(`[A2DPKeeper] Fallback patched ${key}.${method}`);
        }
      }

      if (typeof m.setMode === "function") {
        const orig = m.setMode;
        m.setMode = (mode: number, ...rest: any[]) => {
          if (mode === 2 || mode === 3) {
            console.log(`[A2DPKeeper] BLOCKED fallback ${key}.setMode(${mode})`);
            return orig.call(m, 0, ...rest);
          }
          return orig.call(m, mode, ...rest);
        };
        patches.push(() => { m.setMode = orig; });
      }
    }
  }

  console.log(`[A2DPKeeper] Total patches applied: ${patches.length} | Methods: ${[...patched].join(", ")}`);
}

// ─── Flux listeners ───────────────────────────────────────────────────────────

function onVoiceChannelSelect(event: any) {
  const joining = event.channelId != null;
  if (joining && !inVoiceChannel) {
    console.log(`[A2DPKeeper] Joined voice channel ${event.channelId}`);
    showToast("A2DP Keeper active — BT stays in media mode 🎧", getAssetIDByName("ic_audio"));
  } else if (!joining && inVoiceChannel) {
    console.log("[A2DPKeeper] Left voice channel");
  }
  inVoiceChannel = joining;
}

// ─── Plugin lifecycle ─────────────────────────────────────────────────────────

export default {
  onLoad() {
    if (Platform.OS !== "android") {
      showToast("A2DP Keeper: Android only");
      return;
    }

    console.log("[A2DPKeeper] Loading...");
    applyPatches();

    FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect);
    fluxUnsubs.push(() => FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onVoiceChannelSelect));

    showToast("A2DP Keeper loaded — BT SCO blocked 🎧", getAssetIDByName("ic_audio"));
    console.log("[A2DPKeeper] Ready");
  },

  onUnload() {
    console.log("[A2DPKeeper] Unloading...");
    for (const u of patches) { try { u(); } catch (e) { console.error("[A2DPKeeper]", e); } }
    patches.length = 0;
    for (const u of fluxUnsubs) { try { u(); } catch (e) { console.error("[A2DPKeeper]", e); } }
    fluxUnsubs.length = 0;
    inVoiceChannel = false;
    console.log("[A2DPKeeper] Unloaded");
  },
};
