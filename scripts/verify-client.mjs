import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.env.FLUX_RECROOM_CLIENT_DIR || "client");

function firstExisting(names) {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const exe = firstExisting(["RecRoom.exe", "Recroom_Release.exe"]);
const gameAssembly = firstExisting(["GameAssembly.dll"]);
const dataDir = firstExisting(["RecRoom_Data", "Recroom_Release_Data"]);
const metadata = dataDir ? path.join(dataDir, "il2cpp_data", "Metadata", "global-metadata.dat") : null;

const checks = [
  ["client directory", fs.existsSync(root), root],
  ["Rec Room executable", Boolean(exe), exe || "RecRoom.exe / Recroom_Release.exe"],
  ["IL2CPP GameAssembly.dll", Boolean(gameAssembly), gameAssembly || "GameAssembly.dll"],
  ["Unity data directory", Boolean(dataDir), dataDir || "RecRoom_Data"],
  ["IL2CPP metadata", Boolean(metadata && fs.existsSync(metadata)), metadata || "global-metadata.dat"],
];

console.log("Flux Rec Room 2022 client verification");
console.log("Target: 2022-05-19 | build 8751857 | manifest 6337851004861751095\n");
for (const [label, ok, detail] of checks) console.log(`${ok ? "OK " : "FAIL"} ${label}: ${detail}`);

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(`\nClient layout is incomplete (${failed.length} checks failed).`);
  process.exit(1);
}

const exeSize = fs.statSync(exe).size;
const assemblySize = fs.statSync(gameAssembly).size;
console.log(`\nExecutable bytes: ${exeSize.toLocaleString()}`);
console.log(`GameAssembly bytes: ${assemblySize.toLocaleString()}`);
console.log("Layout is suitable for URL/protocol discovery. This does not by itself prove the exact Steam build identity.");
