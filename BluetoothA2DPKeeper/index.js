"use strict";
var plugin = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // vendetta-globals:@vendetta/patcher
  var require_patcher = __commonJS({
    "vendetta-globals:@vendetta/patcher"(exports, module) {
      module.exports = vendetta.patcher;
    }
  });

  // vendetta-globals:@vendetta/metro/common
  var require_common = __commonJS({
    "vendetta-globals:@vendetta/metro/common"(exports, module) {
      module.exports = vendetta.metro.common;
    }
  });

  // plugins/BluetoothA2DPKeeper/src/index.ts
  var src_exports = {};
  __export(src_exports, {
    onLoad: () => onLoad,
    onUnload: () => onUnload
  });
  var import_patcher = __toESM(require_patcher(), 1);
  var import_common = __toESM(require_common(), 1);
  var { NativeModules } = import_common.ReactNative;
  var TurboModuleRegistry = import_common.ReactNative.TurboModuleRegistry;
  var patches = [];
  var patched = /* @__PURE__ */ new Set();
  var METHODS = ["setCommunicationModeOn", "setActiveAudioDevice", "startBluetoothSco", "stopBluetoothSco", "setBluetoothScoOn"];
  function patchMod(mod, label) {
    if (!mod || typeof mod !== "object")
      return;
    for (const method of METHODS) {
      const key = `${label}.${method}`;
      if (patched.has(key) || typeof mod[method] !== "function")
        continue;
      try {
        const unpatch = (0, import_patcher.instead)(method, mod, () => {
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
    try {
      const m = TurboModuleRegistry?.get?.("NativeAudioManagerModule") ?? TurboModuleRegistry?.get?.("RTNAudioManager");
      if (m)
        patchMod(m, "TurboMod");
    } catch (e) {
      console.log("[A2DPKeeper] TurboRegistry error:", e);
    }
    for (const key of ["NativeAudioManagerModule", "RTNAudioManager", "InCallManager", "AudioManager", "DCDAudioManager"]) {
      const m = NativeModules?.[key];
      if (m)
        patchMod(m, key);
    }
    console.log(`[A2DPKeeper] total patches: ${patches.length}`);
  }
  function onLoad() {
    applyPatches();
  }
  function onUnload() {
    for (const u of patches) {
      try {
        u();
      } catch (e) {
      }
    }
    patches.length = 0;
    patched.clear();
  }
  return __toCommonJS(src_exports);
})();
module.exports = plugin;
