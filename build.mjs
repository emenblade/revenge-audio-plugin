import esbuild from "esbuild";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";
import { createHash } from "crypto";
import { readFileSync } from "fs";

const pluginsDir = resolve("plugins");
const distDir = resolve("dist");

// Maps @vendetta/* imports to vendetta.* globals at runtime
const vendettaPlugin = {
  name: "vendetta-globals",
  setup(build) {
    build.onResolve({ filter: /^@vendetta/ }, (args) => ({
      path: args.path,
      namespace: "vendetta-globals",
    }));
    build.onLoad({ filter: /.*/, namespace: "vendetta-globals" }, (args) => {
      // @vendetta/metro/common → vendetta.metro.common
      const globalPath = args.path.replace("@vendetta", "vendetta").replace(/\//g, ".");
      return { contents: `module.exports = ${globalPath};`, loader: "js" };
    });
  },
};

const plugins = await readdir(pluginsDir);

for (const plugin of plugins) {
  const srcDir = join(pluginsDir, plugin, "src");
  const outDir = join(distDir, plugin);

  await mkdir(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [join(srcDir, "index.ts")],
    bundle: true,
    format: "iife",
    globalName: "plugin",
    outfile: join(outDir, "index.js"),
    plugins: [vendettaPlugin],
    footer: { js: "module.exports = plugin;" },
    treeShaking: true,
    minify: false,
  });

  // Compute SHA256 hash of built JS and inject into manifest
  const js = await readFile(join(outDir, "index.js"));
  const hash = createHash("sha256").update(js).digest("hex");
  const manifest = JSON.parse(await readFile(join(pluginsDir, plugin, "manifest.json"), "utf8"));
  manifest.hash = hash;
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest));

  console.log(`Built: ${plugin}`);
}

console.log("Done.");
