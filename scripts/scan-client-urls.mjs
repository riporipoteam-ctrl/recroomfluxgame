import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.env.FLUX_RECROOM_CLIENT_DIR || "client");
const targets = [
  "RecRoom.exe",
  "Recroom_Release.exe",
  "GameAssembly.dll",
  path.join("RecRoom_Data", "il2cpp_data", "Metadata", "global-metadata.dat"),
  path.join("Recroom_Release_Data", "il2cpp_data", "Metadata", "global-metadata.dat"),
];

const needles = [
  /https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{4,}/g,
  /[A-Za-z0-9.-]+\.rec\.net[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*/g,
  /[A-Za-z0-9.-]+\.recroom\.com[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*/g,
];

const found = new Set();
for (const relative of targets) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  const buffer = fs.readFileSync(file);
  // Most URL constants and metadata strings are ASCII/UTF-8; latin1 preserves
  // byte positions well enough for discovery without modifying the client.
  const text = buffer.toString("latin1");
  for (const regex of needles) {
    for (const match of text.matchAll(regex)) {
      const value = match[0].replace(/[\x00-\x20\x7f-\xff].*$/, "");
      if (value.length >= 6 && value.length <= 512) found.add(value);
    }
  }
}

const results = [...found].filter((value) => /rec\.net|recroom\.com|https?:\/\//i.test(value)).sort();
console.log(JSON.stringify({ root, count: results.length, endpoints: results }, null, 2));

if (!results.length) {
  console.error("No obvious ASCII endpoints found. The build may store them in UTF-16, metadata tables, encrypted config, or construct them at runtime.");
  process.exitCode = 2;
}
