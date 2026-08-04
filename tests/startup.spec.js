import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * What the tool says before it is of any use.
 *
 * Both of these are first-run mishaps rather than bugs, and both used to be
 * met with something obscure: a runtime too old failed somewhere inside a file
 * read, complaining about a function that does not exist rather than about the
 * version; a folder it may not write to came up looking healthy and failed at
 * the first coding.
 */

/** Runs the server briefly and returns whatever it said. */
function start(environment, { die = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, ...environment },
    });
    let output = "";
    const collect = (chunk) => {
      output += chunk;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("exit", (code) => resolve({ output, code }));
    if (!die) setTimeout(() => child.kill(), 1500);
  });
}

test("a runtime that is too old is named as the reason", async () => {
  // `NODE_OPTIONS` cannot fake a version, so the check is exercised directly.
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `Object.defineProperty(process.versions, "node", { value: "16.20.2" });
       process.exit = (code) => { console.log("exit " + code); process.reallyExit(0); };
       await import(${JSON.stringify(join(ROOT, "server.js"))});`,
    ],
    { cwd: ROOT },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  await new Promise((resolve) => child.on("exit", resolve));

  expect(output).toContain("needs Node 18 or newer");
  // It says which one it found, so the reader knows what to change.
  expect(output).toContain("16.20.2");
  expect(output).toContain("exit 1");
});

test("the declared minimum is the one the code checks for", async () => {
  const { readFileSync } = await import("node:fs");
  const declared = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).engines.node;
  const checked = readFileSync(join(ROOT, "server.js"), "utf8").match(/NEEDS_NODE = (\d+)/)[1];
  // Two places saying different things would be worse than one saying nothing.
  expect(declared).toBe(`>=${checked}`);
});

test("a folder that cannot be written to is said so at startup", async () => {
  test.skip(process.getuid?.() === 0, "root ignores the permission bits");

  const root = mkdtempSync(join(tmpdir(), "fundstelle-startup-"));
  const locked = join(root, "locked");
  mkdirSync(locked);
  chmodSync(locked, 0o500);
  try {
    const { output } = await start({
      PORT: "4171",
      TRANSCRIPTS: join(locked, "transcripts"),
      CATEGORIES: join(locked, "categories.json"),
    });
    expect(output).toContain("is not writable");
    // And it says where to look rather than only that something is wrong.
    expect(output).toContain(locked);
  } finally {
    chmodSync(locked, 0o700);
  }
});

test("a folder it can write to starts without complaint", async () => {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-startup-"));
  const { output } = await start({
    PORT: "4172",
    TRANSCRIPTS: join(root, "transcripts"),
    CATEGORIES: join(root, "categories.json"),
  });
  expect(output).toContain("Fundstelle on http://");
  expect(output).not.toContain("is not writable");
});
