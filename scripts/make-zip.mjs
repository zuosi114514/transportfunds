import JSZip from "jszip";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { fileURLToPath } from "url";

const distPath = fileURLToPath(new URL("../dist/", import.meta.url));
const outPath = fileURLToPath(new URL("../deploy-dist.zip", import.meta.url));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const zip = new JSZip();
for (const file of walk(distPath)) {
  const rel = relative(distPath, file).split(sep).join("/"); // force forward slashes
  zip.file(rel, readFileSync(file));
}

const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
import { writeFileSync } from "fs";
writeFileSync(outPath, buf);
console.log("zip created:", buf.length, "bytes");
console.log("entries:", Object.keys(zip.files).join(", "));
