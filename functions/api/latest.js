import { getDb } from "../_lib/edgeCache.js";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // IMPORTANT: make sure /api/latest always reflects newest nextDraw immediately
      "cache-control": "no-store, max-age=0",
      ...extraHeaders,
    },
  });
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function toNum(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function parseNumsAny(x) {
  if (Array.isArray(x)) return x.map(v => toNum(v)).filter(n => n >= 1 && n <= 49);
  if (typeof x === "string") {
    return x
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map(v => toNum(v))
      .filter(n => n >= 1 && n <= 49);
  }
  return [];
}

/**
 * Draw numbers field could be:
 * 1) JSON string: {"numbers":[..],"special":13} or {"nums":[..],"specialNo":13}
 * 2) JSON string array: [15,21,24,40,45,46]
 * 3) plain string: "15 21 24 40 45 46" or "15,21,24,40,45,46"
 */
function normalizeDrawRow(row) {
  if (!row) return null;

  const drawNo = row.drawNo ?? row.draw_no ?? null;
  const drawDate = row.drawDate ?? row.draw_date ?? null;

  let numbers = [];
  let special = 0;

  const rawNumbers = row.numbers ?? row.numbersStr ?? row.numbers_str ?? "";

  // try JSON parse first
  const j = typeof rawNumbers === "string" ? safeJsonParse(rawNumbers) : rawNumbers;

  if (j && typeof j === "object") {
    if (Array.isArray(j)) {
      numbers = parseNumsAny(j);
    } else {
      numbers =
        parseNumsAny(j.numbers).length ? parseNumsAny(j.numbers) :
        parseNumsAny(j.nums).length ? parseNumsAny(j.nums) :
        parseNumsAny(j.numbersArr).length ? parseNumsAny(j.numbersArr) :
        parseNumsAny(j.numbersStr);

      special =
        Number.isFinite(Number(j.special)) ? Number(j.special) :
        Number.isFinite(Number(j.specialNo)) ? Number(j.specialNo) :
        Number.isFinite(Number(j.extra)) ? Number(j.extra) :
        0;
    }
  } else {
    numbers = parseNumsAny(rawNumbers);
  }

  // fallback: if DB has separate special column
  if (!special) {
    special =
      Number.isFinite(Number(row.special)) ? Number(row.special) :
      Number.isFinite(Number(row.specialNo)) ? Number(row.specialNo) :
      Number.isFinite(Number(row.extra)) ? Number(row.extra) :
      0;
  }

  return {
    drawNo,
    drawDate,
    numbers,
    special,
  };
}

/**
 * site_meta.nextDraw value might be:
 * - { drawNo, drawDate, jackpotM }   (new admin/next)
 * - { drawNo, drawDate, jackpotMillion } (old)
 * - other variants
 */
function normalizeNextDraw(obj) {
  if (!obj || typeof obj !== "object") return null;

  const drawNo = (obj.drawNo || obj.nextDrawNo || obj.no || "").toString().trim();
  const drawDate = (obj.drawDate || obj.nextDrawDate || obj.date || "").toString().trim();

  // accept jackpotM (new) OR jackpotMillion (old)
  const jackpotMillion =
    Number.isFinite(Number(obj.jackpotMillion)) ? Number(obj.jackpotMillion) :
    Number.isFinite(Number(obj.jackpotM)) ? Number(obj.jackpotM) :
    Number.isFinite(Number(obj.jackpot)) ? Number(obj.jackpot) :
    null;

  // If no minimal fields, treat as null
  if (!drawNo && !drawDate && jackpotMillion == null) return null;

  const jm = jackpotMillion == null ? null : Math.max(0, Math.floor(jackpotMillion));

  return {
    drawNo: drawNo || null,
    drawDate: drawDate || null,
    jackpotMillion: jm,
    jackpotAmount: jm == null ? null : jm * 1000000,
    note: "下期資料以官方公佈為準",
  };
}

async function readNextDrawFromMeta(db) {
  const row = await db
    .prepare(`SELECT value, updatedAt FROM site_meta WHERE key='nextDraw' LIMIT 1`)
    .first();

  if (!row) return { nextDraw: null, updatedAt: null };

  const parsed = safeJsonParse(row.value);
  const nextDraw = normalizeNextDraw(parsed);

  return { nextDraw, updatedAt: row.updatedAt || null };
}

async function readLatestDraw(db) {
  // Try common columns; safest is numbers TEXT + maybe special exists
  // If your table truly only has (drawNo, drawDate, numbers), this still works.
  const row = await db.prepare(`
    SELECT drawNo, drawDate, numbers, special, specialNo, extra
    FROM draw
    ORDER BY drawDate DESC, drawNo DESC
    LIMIT 1
  `).first().catch(async () => {
    // fallback if some columns don't exist
    return await db.prepare(`
      SELECT drawNo, drawDate, numbers
      FROM draw
      ORDER BY drawDate DESC, drawNo DESC
      LIMIT 1
    `).first();
  });

  return normalizeDrawRow(row);
}

export async function onRequest({ request, env }) {
  const db = getDb(env);
  if (!db) return json({ ok: false, error: "D1 binding not found" }, 500);

  try {
    // Read latest draw + nextDraw (site_meta)
    const [draw, nextMeta] = await Promise.all([
      readLatestDraw(db),
      readNextDrawFromMeta(db),
    ]);

    // Fallback nextDraw (only if site_meta missing)
    const fallbackNext = {
      drawNo: null,
      drawDate: null,
      jackpotMillion: null,
      jackpotAmount: null,
      note: "下期資料以官方公佈為準",
    };

    const nextDraw = nextMeta.nextDraw || fallbackNext;

    // updatedAt: prefer meta.updatedAt (because you update next independently)
    // If you later add draw-updatedAt, you can take max() here.
    const updatedAt = nextMeta.updatedAt || new Date().toISOString();

    return json({
      source: "d1",
      updatedAt,
      draw,
      nextDraw,
      disclaimer: "本頁資料僅供參考，以官方公佈為準。",
    });
  } catch (e) {
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
}
