import * as esbuild from "esbuild";
const watch = process.argv.includes("--watch");
const main = { entryPoints: ["src/main.ts"], bundle: true, external: ["obsidian", "electron"], platform: "browser", format: "cjs", target: "es2020", outfile: "main.js", sourcemap: watch ? "inline" : false };
const worker = { entryPoints: ["src/processing-worker.ts"], bundle: true, platform: "browser", format: "iife", target: "es2020", outfile: "processing-worker.js" };
if (watch) {
  const contexts = await Promise.all([esbuild.context(main), esbuild.context(worker)]);
  await Promise.all(contexts.map(c => c.watch()));
} else await Promise.all([esbuild.build(main), esbuild.build(worker)]);
