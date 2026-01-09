import { getDb } from "../../_lib/edgeCache.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function unauthorized() {
  return json({ ok: false, error: "Unauthorized" }, 401);
}

/**
 * ✅ Accept BOTH:
 * 1) Authorization: Bearer <token>
 * 2) X-Admin-Key: <token>
 *
 * Token source priority:
 * - env.ADMIN_TOKEN (new)
 * - env.ADMIN_KEY   (legacy, same as /api/admin/upsert)
 */
function requireAuth(request, env) {
  const token = (env.ADMIN_TOKEN || env.ADMIN_KEY || "").trim();
  if (!token) return false;

  const auth = (request.headers.get("authorization") || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1] === token) return true;

  const xKey = (request.headers.get("x-admin-key") || "").trim();
  if (xKey && xKey === token) return true;

  return false;
}

async function readNext(db) {
  const row = await db
    .prepare(`SELECT value, updatedAt FROM site_meta WHERE key='nextDraw' LIMIT 1`)
    .first();

  if (!row) return { next: null, updatedAt: null };

  let next = null;
  try { next = JSON.parse(row.value); } catch {}
  return { next, updatedAt: row.updatedAt };
}

/**
 * ✅ Normalize shape so /api/latest can always display consistently:
 * Accept:
 * - jackpotM (million)
 * - jackpotMillion
 * Compute:
 * - jackpotAmount
 */
function normalizeNext(next) {
  if (!next || typeof next !== "object") return null;

  const drawNo = String(next.drawNo || "").trim();
  const drawDate = String(next.drawDate || "").trim();

  // support both jackpotM and jackpotMillion
  const jm =
    Number.isFinite(Number(next.jackpotMillion)) ? Number(next.jackpotMillion) :
    Number.isFinite(Number(next.jackpotM)) ? Number(next.jackpotM) :
    0;

  const jackpotMillion = Math.max(0, Math.floor(jm));
  const jackpotAmount = jackpotMillion * 1_000_000;

  const note = typeof next.note === "string" && next.note.trim()
    ? next.note.trim()
    : "下期資料以官方公佈為準";

  // If essential fields missing, still store but caller may validate
  return {
    drawNo: drawNo || null,
    drawDate: drawDate || null,
    jackpotMillion,
    jackpotAmount,
    note,
  };
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

  // 管理員 API：GET/PUT 都要 token
  if (!requireAuth(request, env)) return unauthorized();

  if (request.method === "GET") {
    const { next, updatedAt } = await readNext(db);
    return json({ ok: true, next, updatedAt });
  }

  if (request.method === "PUT") {
    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }

    // allow {next:{...}} or direct {...}
    const rawNext = body?.next ?? body;
    const next = normalizeNext(rawNext);

    // validate minimal required fields (so you won't silently store garbage)
    if (!next?.drawNo || !next?.drawDate) {
      return json({ ok: false, error: "Missing next.drawNo / next.drawDate" }, 400);
    }

    const { updatedAt } = await upsertNext(db, next);
    return json({ ok: true, next, updatedAt });
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}
