/** Bündelt den Hintergrunddienst in eine einzelne Datei (apps/web/worker.cjs) für das Docker-Image. */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
await build({
  entryPoints: [path.join(root, "packages/game/src/worker/main.ts")],
  outfile: path.join(root, "apps/web/worker.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  // Optionale native Bindung von pg wird nie genutzt
  external: ["pg-native"],
  logLevel: "info",
});
