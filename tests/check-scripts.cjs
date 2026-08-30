"use strict";
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const html = fs.readFileSync("index.html", "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
let failed = false;
scripts.forEach((source, index) => {
  const result = spawnSync(process.execPath, ["--check"], { input:source, encoding:"utf8" });
  if (result.status !== 0) { failed = true; console.error(`Inline script ${index + 1} failed syntax check:\n${result.stderr}`); }
});
if (failed) process.exit(1);
console.log(`Checked ${scripts.length} inline scripts.`);
