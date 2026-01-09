// functions/api/admin/next.js
import { getDb } from "../_lib/edgeCache.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function unauthorized() {
  return json({ ok: false, error: "Unauthorized" }, 401);
}

function requireAuth(request, env) {
  const token = env.ADMIN_TOKEN || "";
  if (!token) return false;

  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return !!m && m[1] === token;
}

async function readNext(db) {
  const row = await db.prepare(
    `SELECT value, updatedAt FROM site_meta WHERE key = 'nextDraw' LIMIT 1`
  ).first();

  if (!row) return { next: null, updatedAt: null };

  let next = null;
  try { next = JSON.parse(row.value); } catch {}
  return { next, updatedAt: row.updatedAt };
}

async function upsertNext(db, nextObj) {
  const now = new Date().toISOString();
  const value = JSON.stringify(nextObj ?? null);

  await db.prepare(
    `INSERT INTO site_meta (key, value, updatedAt)
     VALUES ('nextDraw', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt`
  ).bind(value, now).run();

  return { updatedAt: now };
}

export async function onRequest({ request, env }) {
  const db = getDb(env);
  if (!db) return json({ ok: false, error: "D1 binding not found" }, 500);

  // ✅ Admin endpoint：GET/PUT 都要 token
  if (!requireAuth(request, env)) return unauthorized();

  if (request.method === "GET") {
    const { next, updatedAt } = await readNext(db);
    return json({ ok: true, next, updatedAt });
  }

  if (request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    // 你可以自行定義 next 內容（保持彈性）
    // 建議至少：drawNo / drawDate / closeTime / jackpot / note
    const next = body?.next ?? body;

    const { updatedAt } = await upsertNext(db, next);
    return json({ ok: true, next, updatedAt });
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}
