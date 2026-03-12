import { instead } from "@vendetta/patcher";
import { ReactNative } from "@vendetta/metro/common";

const { NativeModules } = ReactNative;
const TurboModuleRegistry = ReactNative.TurboModuleRegistry;

const patches: (() => void)[] = [];
const patched = new Set<string>();

const METHODS = ["setCommunicationModeOn", "setActiveAudioDevice", "startBluetoothSco", "stopBluetoothSco", "setBluetoothScoOn"];

function patchMod(mod: any, label: string) {
  if (!mod || typeof mod !== "object") return;
  for (const method of METHODS) {
    const key = `${label}.${method}`;
    if (patched.has(key) || typeof mod[method] !== "function") continue;
    try {
      const unpatch = instead(method, mod, () => {
        console.log(`[A2DPKeeper] BLOCKED ${key}`);
      });
      patches.push(unpatch);
      patched.add(key);
      console.log(`[A2DPKeeper] patched ${key}`);
    } catch (e) {
      console.log(`[A2DPKeeper] failed to patch ${key}:`, e);
    }
  }
}

function applyPatches() {
  // TurboModuleRegistry (modern Discord — confirmed working)
  try {
    const m = TurboModuleRegistry?.get?.("NativeAudioManagerModule") ?? TurboModuleRegistry?.get?.("RTNAudioManager");
    if (m) patchMod(m, "TurboMod");
  } catch (e) {
    console.log("[A2DPKeeper] TurboRegistry error:", e);
  }

  // NativeModules fallback
  for (const key of ["NativeAudioManagerModule", "RTNAudioManager", "InCallManager", "AudioManager", "DCDAudioManager"]) {
    const m = (NativeModules as any)?.[key];
    if (m) patchMod(m, key);
  }

  console.log(`[A2DPKeeper] total patches: ${patches.length}`);
}

export function onLoad() {
  applyPatches();
}

export function onUnload() {
  for (const u of patches) { try { u(); } catch (e) {} }
  patches.length = 0;
  patched.clear();
}
