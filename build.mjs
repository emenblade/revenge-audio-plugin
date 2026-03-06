import esbuild from "esbuild";
import { readdir, copyFile, mkdir } from "fs/promises";
import { join, resolve } from "path";

const pluginsDir = resolve("plugins");
const distDir = resolve("dist");

// All @vendetta/* imports are provided at runtime by the Revenge loader
const vendettaExternals = [
  "@vendetta",
  "@vendetta/patcher",
  "@vendetta/metro",
  "@vendetta/metro/common",
  "@vendetta/ui",
  "@vendetta/ui/toasts",
  "@vendetta/ui/assets",
  "@vendetta/ui/components",
  "@vendetta/plugin",
  "@vendetta/storage",
  "@vendetta/utils",
  "@vendetta/handlers",
];

const plugins = await readdir(pluginsDir);

for (const plugin of plugins) {
  const srcDir = join(pluginsDir, plugin, "src");
  const outDir = join(distDir, plugin);

  await mkdir(outDir, { recursive: true });

  // Build index.ts → index.js
  await esbuild.build({
    entryPoints: [join(srcDir, "index.ts")],
    bundle: true,
    format: "iife",
    globalName: "plugin",
    outfile: join(outDir, "index.js"),
    external: vendettaExternals,
    footer: {
      js: "module.exports = plugin;",
    },
    treeShaking: true,
    minify: false, // keep readable for debugging
  });

  // Copy manifest.json next to index.js
  await copyFile(
    join(pluginsDir, plugin, "manifest.json"),
    join(outDir, "manifest.json")
  );

  console.log(`Built: ${plugin}`);
}

console.log("Done.");
