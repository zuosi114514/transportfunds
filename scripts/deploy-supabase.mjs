import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, relative, extname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const bucket = "site";
const distPath = fileURLToPath(new URL("../dist/", import.meta.url));
const publicBase = `${url}/storage/v1/object/public/${bucket}`;

if (!url || !key) {
  console.error("缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

const mime = {
  ".html": "text/html;charset=UTF-8",
  ".js": "text/javascript;charset=UTF-8",
  ".css": "text/css;charset=UTF-8",
  ".svg": "image/svg+xml;charset=UTF-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".map": "application/json",
};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

async function listAll(prefix = "") {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;
  const files = [];
  for (const item of data || []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) files.push(...(await listAll(path)));
    else files.push(path);
  }
  return files;
}

async function clearBucket() {
  try {
    const files = await listAll();
    if (files.length) {
      const { error } = await supabase.storage.from(bucket).remove(files);
      if (error) console.warn("clear:", error.message);
      else console.log("cleared", files.length, "files");
    }
  } catch (err) {
    console.warn("clear skip:", err.message);
  }
}

async function uploadViaRest(path, body, contentType) {
  const endpoint = `${url}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": contentType,
      "x-upsert": "true",
      "cache-control": "max-age=60",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`上传失败 ${path}: ${res.status} ${text}`);
  }
}

function buildEntrySvg() {
  let html = readFileSync(join(distPath, "index.html"), "utf8");

  // Rewrite asset paths to absolute public URLs (blob page cannot use relative paths)
  html = html.replace(/(?:\.\/)?assets\//g, `${publicBase}/assets/`);
  html = html.replace(/\r\n/g, "\n");

  const payload = JSON.stringify(html);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">
  <script type="text/javascript"><![CDATA[
    const html = ${payload};
    const blob = new Blob([html], { type: "text/html;charset=UTF-8" });
    location.replace(URL.createObjectURL(blob));
  ]]></script>
  <text x="0" y="12" font-size="12">Loading...</text>
</svg>
`;
  writeFileSync(join(distPath, "app.svg"), svg, "utf8");
}

async function uploadAll() {
  const files = walk(distPath).filter((f) => !f.endsWith("index.html"));
  if (!files.length) throw new Error("dist 为空，请先 npm run build");

  for (const file of files) {
    const rel = relative(distPath, file).replace(/\\/g, "/");
    const body = readFileSync(file);
    const contentType = mime[extname(file).toLowerCase()] || "application/octet-stream";
    // Skip uploading HTML — Supabase forces text/plain for HTML
    if (extname(file).toLowerCase() === ".html") continue;
    await uploadViaRest(rel, body, contentType);
    console.log("uploaded", rel, contentType);
  }
}

await clearBucket();
buildEntrySvg();
await uploadAll();

const entry = `${publicBase}/app.svg`;
const check = await fetch(entry);
console.log("\nEntry Content-Type:", check.headers.get("content-type"));
console.log("部署成功！请使用这个网址（不要用 index.html）：");
console.log(entry);
