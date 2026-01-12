import { getDb } from "../_lib/edgeCache.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readSiteMetaJson(db, key) {
  const row = await db
    .prepare(`SELECT value, updatedAt FROM site_meta WHERE key=? LIMIT 1`)
    .bind(key)
    .first();

  if (!row) return { key, value: null, updatedAt: null };

  let value = null;
  try {
    value = JSON.parse(row.value);
  } catch {
    value = row.value; // 萬一唔係 JSON，就原樣回傳
  }
  return { key, value, updatedAt: row.updatedAt ?? null };
}

async function readMetaText(db, key) {
  const row = await db
    .prepare(`SELECT value, updatedAt FROM meta WHERE key=? LIMIT 1`)
    .bind(key)
    .first();

  return {
    key,
    value: row?.value ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function onRequest({ env }) {
  const db = getDb(env);
  if (!db) return json({ ok: false, error: "D1 binding not found" }, 500);

  const now = new Date().toISOString();

  // 1) 最新攪珠（draws）
  const latestRow = await db
    .prepare(
      `SELECT drawNo, drawDate, numbers, special, updatedAt
       FROM draws
       ORDER BY drawDate DESC
       LIMIT 1`
    )
    .first();

  const latestDraw = latestRow
    ? {
        drawNo: latestRow.drawNo,
        drawDate: latestRow.drawDate,
        numbers: (() => {
          try { return JSON.parse(latestRow.numbers); } catch { return null; }
        })(),
        special: Number(latestRow.special),
        updatedAt: latestRow.updatedAt ?? null,
      }
    : null;

  // 2) 下期資料（site_meta.nextDraw）
  const nextDraw = await readSiteMetaJson(db, "nextDraw");

  // 3) on.cc cron 狀態（site_meta）
  const nextOk = await readSiteMetaJson(db, "nextDrawCronLastOk");
  const nextErr = await readSiteMetaJson(db, "nextDrawCronLastError");

  // 4) 明報 cron 狀態（meta）
  const mpStatus = await readMetaText(db, "last_auto_fetch_status");
  const mpAt = await readMetaText(db, "last_auto_fetch_at");
  const mpDebug = await readMetaText(db, "last_auto_fetch_debug");

  // 5) D1 現在時間（可選，用嚟對時）
  const dbNowRow = await db.prepare(`SELECT datetime('now') AS nowUtc`).first();
  const dbNowUtc = dbNowRow?.nowUtc ?? null;

  return json({
    ok: true,
    at: now,
    dbNowUtc,
    latestDraw,
    nextDraw,
    cron: {
      mingpao: {
        last_auto_fetch_status: mpStatus,
        last_auto_fetch_at: mpAt,
        last_auto_fetch_debug: mpDebug,
      },
      nextDraw: {
        nextDrawCronLastOk: nextOk,
        nextDrawCronLastError: nextErr,
      },
    },
  });
}
