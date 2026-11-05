import * as esbuild from "esbuild";
import { embeddedWorkerPlugin } from "./build/embedded-worker.mjs";
const watch = process.argv.includes("--watch");
const main = { entryPoints: ["src/main.ts"], bundle: true, external: ["obsidian", "electron"], platform: "browser", format: "cjs", target: "es2020", outfile: "main.js", sourcemap: watch ? "inline" : false, plugins: [embeddedWorkerPlugin()] };
if (watch) {
  const context = await esbuild.context(main);
  await context.watch();
} else await esbuild.build(main);
