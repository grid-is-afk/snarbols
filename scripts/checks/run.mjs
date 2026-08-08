/**
 * Sanity checks for the pure logic behind Meeting Intelligence.
 *
 * The app has no test runner, and pulling one in was out of scope for this
 * feature — but the transcript ordering rules and the analysis-response parser
 * are the two places where a silent mistake produces a wrong meeting rather
 * than a visible crash, so they get checked. Both modules are pure and take
 * `now` as a parameter, which is what makes this possible without a DOM, a
 * clock, or a live provider.
 *
 * Run with: npm run check:meeting
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const bundleDir = resolve(here, ".bundle");

const MODULES = [
  { entry: "src/lib/meeting/transcript.ts", out: "transcript.mjs" },
  { entry: "src/lib/meeting/analysis.ts", out: "analysis.mjs" },
];

const CHECKS = ["transcript.check.mjs", "analysis.check.mjs"];

function run(file) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolve(here, file)], {
      stdio: "inherit",
    });
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

async function main() {
  await rm(bundleDir, { recursive: true, force: true });

  for (const { entry, out } of MODULES) {
    await build({
      entryPoints: [resolve(projectRoot, entry)],
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "error",
      alias: { "@": resolve(projectRoot, "src") },
      outfile: resolve(bundleDir, out),
    });
  }

  let failed = 0;
  for (const check of CHECKS) {
    console.log(`\n── ${check} ──`);
    failed += (await run(check)) === 0 ? 0 : 1;
  }

  await rm(bundleDir, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
