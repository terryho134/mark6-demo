import { getDb } from "../../_lib/edgeCache.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function unauthorized() {
  return json({ ok: false, error: "Unauthorized" }, 401);
}

function badRequest(msg) {
  return json({ ok: false, error: msg }, 400);
}

// Accept BOTH auth styles (to match other admin endpoints / your admin.html):
// - Authorization: Bearer <token>
// - X-Admin-Key: <token>
function requireAuth(request, env) {
  const token =
    (env.ADMIN_TOKEN || "").trim() ||
    (env.ADMIN_KEY || "").trim() ||
    (env.ADMIN_SECRET || "").trim();

  if (!token) return false;

  const auth = (request.headers.get("authorization") || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const bearer = (m?.[1] || "").trim();

  const xKey = (request.headers.get("x-admin-key") || "").trim();

  // If both provided but mismatch, reject.
  if (bearer && xKey && bearer !== xKey) return false;

  const provided = bearer || xKey;
  return !!provided && provided === token;
}

async function readNext(db) {
  const row = await db
    .prepare(`SELECT value, updatedAt FROM site_meta WHERE key='nextDraw' LIMIT 1`)
    .first();

  if (!row) return { next: null, updatedAt: null };

  let next = null;
  try {
    next = JSON.parse(row.value);
  } catch {
    next = null;
  }
  return { next, updatedAt: row.updatedAt || null };
}

async function upsertNext(db, nextObj) {
  const now = new Date().toISOString();
  const value = JSON.stringify(nextObj ?? null);

  await db
    .prepare(
      `INSERT INTO site_meta (key, value, updatedAt)
       VALUES ('nextDraw', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt`
    )
    .bind(value, now)
    .run();

  return { updatedAt: now };
}

// -------------------------
// Normalization / Validation
// -------------------------
function isYMD(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeDrawNo(s) {
  if (s == null) return null;
  const raw = String(s).trim();
  if (!raw) return null;

  // preferred: YY/XXX
  let m = raw.match(/^(\d{2})\s*\/\s*(\d{1,3})$/);
  if (m) {
    const yy = String(parseInt(m[1], 10)).padStart(2, "0");
    const seq = String(parseInt(m[2], 10)).padStart(3, "0");
    if (seq === "NaN" || yy === "NaN") return null;
    return `${yy}/${seq}`;
  }

  // legacy: XXX/YYYY -> convert to YY/XXX
  m = raw.match(/^(\d{1,3})\s*\/\s*(\d{4})$/);
  if (m) {
    const seq = String(parseInt(m[1], 10)).padStart(3, "0");
    const year = parseInt(m[2], 10);
    if (!Number.isFinite(year)) return null;
    const yy = String(year % 100).padStart(2, "0");
    return `${yy}/${seq}`;
  }

  return null;
}

function normalizeJackpotM(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function normalizeNextFromBody(body) {
  // Accept:
  // 1) { next: { drawDate, drawNo, jackpotM } }
  // 2) { drawDate, drawNo, jackpotM }
  // 3) flat from admin.html: { nextDrawDate, nextDrawNo, nextJackpotM }
  const obj = body?.next ?? body ?? {};

  const drawDate =
    obj.drawDate ??
    obj.date ??
    obj.nextDrawDate ??
    null;

  const drawNo =
    obj.drawNo ??
    obj.nextDrawNo ??
    null;

  const jackpotM =
    obj.jackpotM ??
    obj.jackpotMillion ??
    obj.nextJackpotM ??
    obj.nextJackpotMillion ??
    null;

  const nd = drawDate == null ? null : String(drawDate).trim();
  const dn = drawNo == null ? null : normalizeDrawNo(drawNo);
  const jm = normalizeJackpotM(jackpotM);

  // allow clearing (all null) if user wants
  const allEmpty = !nd && !dn && (jm == null);

  if (allEmpty) return null;

  // Validate minimally
  if (!nd || !isYMD(nd)) return { __error: "Invalid next drawDate (expect YYYY-MM-DD)" };
  if (!dn) return { __error: "Invalid next drawNo (expect YY/XXX or XXX/YYYY)" };

  return {
    drawDate: nd,
    drawNo: dn,
    jackpotM: jm == null ? null : jm,
  };
}

export async function onRequest({ request, env }) {
  const db = getDb(env);
  if (!db) return json({ ok: false, error: "D1 binding not found" }, 500);

  // Admin API: require token
  if (!requireAuth(request, env)) return unauthorized();

  // Allow GET / POST / PUT
  if (request.method === "GET") {
    const { next, updatedAt } = await readNext(db);

    // Ensure response shape is consistent
    const normalized =
      next && typeof next === "object"
        ? {
            drawDate: next.drawDate ?? null,
            drawNo: next.drawNo ?? null,
            jackpotM: next.jackpotM ?? null,
          }
        : null;

    return json({ ok: true, next: normalized, updatedAt });
  }

  if (request.method === "POST" || request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const next = normalizeNextFromBody(body);

    if (next && next.__error) {
      return badRequest(next.__error);
    }

    const { updatedAt } = await upsertNext(db, next);

    return json({ ok: true, next, updatedAt });
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}
