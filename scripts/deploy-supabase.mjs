import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

config({ path: new URL("../.env", import.meta.url) });

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const bucket = "site";
const distPath = fileURLToPath(new URL("../dist/", import.meta.url));

if (!url || !key) {
  console.error("缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
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

async function ensureBucket() {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.warn("listBuckets:", listError.message);
  }
  if (!buckets?.some((b) => b.id === bucket || b.name === bucket)) {
    const { error } = await supabase.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
    });
    if (error && !/already exists|duplicate/i.test(error.message || "")) {
      console.warn("createBucket:", error.message);
      console.warn("请先在 SQL Editor 执行 supabase/storage.sql 后重试");
    }
  }
}

async function uploadAll() {
  const files = walk(distPath);
  if (!files.length) {
    throw new Error("dist 为空，请先 npm run build");
  }
  for (const file of files) {
    const rel = relative(distPath, file).replace(/\\/g, "/");
    const body = readFileSync(file);
    const contentType = mime[extname(file).toLowerCase()] || "application/octet-stream";
    const { error } = await supabase.storage.from(bucket).upload(rel, body, {
      upsert: true,
      contentType,
      cacheControl: "60",
    });
    if (error) throw new Error(`上传失败 ${rel}: ${error.message}`);
    console.log("uploaded", rel);
  }
}

await ensureBucket();
await uploadAll();

const publicUrl = `${url}/storage/v1/object/public/${bucket}/index.html`;
console.log("\n部署成功！打开：");
console.log(publicUrl);
