// functions/api/cron-status.js

function json(status, data) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function toHK(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(d);
}

function parseDrawNo(drawNo) {
  const m = String(drawNo || "").match(/^(\d{2})\/(\d{3})$/);
  if (!m) return null;
  return { yy: Number(m[1]), seq: Number(m[2]) };
}

function isInt(n) {
  return Number.isInteger(n) && Number.isFinite(n);
}

function checkOneDraw(row) {
  const issues = [];
  const drawNo = row.drawNo;
  const drawDate = row.drawDate;

  // drawNo format
  if (!/^\d{2}\/\d{3}$/.test(String(drawNo || ""))) {
    issues.push({ code: "DRAWNO_FORMAT", detail: `drawNo 格式錯：${drawNo}` });
  }

  // drawDate parse
  const d = new Date(String(drawDate || ""));
  if (!drawDate || Number.isNaN(d.getTime())) {
    issues.push({ code: "DRAWDATE_PARSE", detail: `drawDate 無法解析：${drawDate}` });
  }

  // numbers JSON parse
  let nums = [];
  try {
    nums = JSON.parse(row.numbers || "[]");
  } catch (e) {
    issues.push({ code: "NUMBERS_JSON", detail: `numbers JSON 解析失敗` });
    nums = [];
  }

  // numbers validity
  if (!Array.isArray(nums) || nums.length !== 6) {
    issues.push({ code: "NUMBERS_LEN", detail: `正選數量唔係 6：${Array.isArray(nums) ? nums.length : "not-array"}` });
  }

  const seen = new Set();
  for (const x of (Array.isArray(nums) ? nums : [])) {
    const n = Number(x);
    if (!isInt(n)) {
      issues.push({ code: "NUM_NOT_INT", detail: `正選有非整數：${x}` });
      continue;
    }
    if (n < 1 || n > 49) issues.push({ code: "NUM_OUT_RANGE", detail: `正選超出 1-49：${n}` });
    if (seen.has(n)) issues.push({ code: "NUM_DUP", detail: `正選重覆：${n}` });
    seen.add(n);
  }

  // special validity
  const sp = Number(row.special);
  if (!isInt(sp)) issues.push({ code: "SP_NOT_INT", detail: `特別號非整數：${row.special}` });
  else {
    if (sp < 1 || sp > 49) issues.push({ code: "SP_OUT_RANGE", detail: `特別號超出 1-49：${sp}` });
    if (seen.has(sp)) issues.push({ code: "SP_OVERLAP", detail: `特別號與正選重覆：${sp}` });
  }

  return { issues, numbers: nums, special: sp };
}

function isNewerOrEqualDate(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return true; // parsing already flagged elsewhere
  return da.getTime() >= db.getTime();
}

export async function onRequestGet({ env, request }) {
  try {
    const url = new URL(request.url);

    // ✅ 可選：token 保護
    const provided = url.searchParams.get("token");
    if (env.STATUS_TOKEN) {
      if (!provided || provided !== env.STATUS_TOKEN) {
        return json(403, { ok: false, error: "Forbidden" });
      }
    }

    const limit = Math.max(10, Math.min(200, parseInt(url.searchParams.get("limit") || "60", 10)));

    // ✅ D1 binding（你之前用邊個就跟返）
    const DB = env.DB || env.MARK6_DB;
    if (!DB) return json(500, { ok: false, error: "Missing D1 binding (env.DB or env.MARK6_DB)" });

    // meta
    const metaRows = await DB.prepare(
      "SELECT key, value, updatedAt FROM meta WHERE key IN ('last_auto_fetch_at','last_auto_fetch_status')"
    ).all();
    const meta = {};
    for (const r of (metaRows.results || [])) meta[r.key] = { value: r.value, updatedAt: r.updatedAt };

    // latest draw
    const latest = await DB.prepare(
      "SELECT drawNo, drawDate, numbers, special FROM draws ORDER BY drawDate DESC, drawNo DESC LIMIT 1"
    ).first();

    let latestOut = null;
    if (latest) {
      let nums = [];
      try { nums = JSON.parse(latest.numbers || "[]"); } catch {}
      latestOut = {
        drawNo: latest.drawNo,
        drawDate: latest.drawDate,
        numbers: nums,
        special: Number(latest.special),
      };
    }

    // total draws
    const cntRow = await DB.prepare("SELECT COUNT(*) AS cnt FROM draws").first();

    // duplicates by drawNo (hard red flag)
    const dup = await DB.prepare(
      "SELECT drawNo, COUNT(*) AS cnt FROM draws GROUP BY drawNo HAVING cnt > 1 ORDER BY cnt DESC LIMIT 50"
    ).all();

    // health check recent draws
    const recent = await DB.prepare(
      "SELECT drawNo, drawDate, numbers, special FROM draws ORDER BY drawDate DESC, drawNo DESC LIMIT ?1"
    ).bind(limit).all();

    const list = recent.results || [];
    const issues = [];

    // per-draw checks
    const parsed = []; // keep parsed info for continuity checks
    for (const row of list) {
      const one = checkOneDraw(row);
      if (one.issues.length) {
        for (const it of one.issues) {
          issues.push({
            drawNo: row.drawNo,
            drawDate: row.drawDate,
            type: it.code,
            detail: it.detail,
          });
        }
      }
      parsed.push({
        drawNo: row.drawNo,
        drawDate: row.drawDate,
        dn: parseDrawNo(row.drawNo),
      });
    }

    // continuity checks (drawNo sequence + date order)
    // list is DESC, so i = newer, i+1 = older
    for (let i = 0; i < parsed.length - 1; i++) {
      const cur = parsed[i];
      const nxt = parsed[i + 1];

      // date order sanity
      if (!isNewerOrEqualDate(cur.drawDate, nxt.drawDate)) {
        issues.push({
          drawNo: cur.drawNo,
          drawDate: cur.drawDate,
          type: "DATE_ORDER",
          detail: `drawDate 次序可能亂：${cur.drawDate} < ${nxt.drawDate}`,
        });
      }

      // drawNo continuity
      if (cur.dn && nxt.dn) {
        if (cur.dn.yy === nxt.dn.yy) {
          // same year: should decrement by 1
          const expected = cur.dn.seq - 1;
          if (nxt.dn.seq !== expected) {
            issues.push({
              drawNo: cur.drawNo,
              drawDate: cur.drawDate,
              type: "DRAWNO_GAP",
              detail: `同一年期數跳號：下一期（較舊）應為 ${String(cur.dn.yy).padStart(2,"0")}/${String(expected).padStart(3,"0")}，但見到 ${nxt.drawNo}`,
            });
          }
        } else {
          // year changed: boundary should happen at YY/001
          if (cur.dn.seq !== 1) {
            issues.push({
              drawNo: cur.drawNo,
              drawDate: cur.drawDate,
              type: "YEAR_BOUNDARY",
              detail: `跨年度出現，但新年度嗰期唔係 YY/001（見到 ${cur.drawNo}）`,
            });
          }
        }
      }
    }

    const health = {
      checked: list.length,
      limit,
      ok: (issues.length === 0) && ((dup.results || []).length === 0),
      issuesCount: issues.length,
      duplicateDrawNo: (dup.results || []).map(x => ({ drawNo: x.drawNo, cnt: x.cnt })),
      issues: issues.slice(0, 200), // avoid huge payload
      notes: [
        "檢查項目：drawNo 格式、drawDate 可解析、正選 6 個/不重覆/1-49、特別號 1-49 且不與正選重覆、drawNo 同年連號、跨年只應由 YY/001 接上前一年。",
        "如明報改版導致解析異常，通常會先出現：NUMBERS_LEN / NUMBERS_JSON / DRAWDATE_PARSE。",
      ],
    };

    return json(200, {
      ok: true,
      serverTimeUTC: new Date().toISOString(),
      serverTimeHK: toHK(new Date().toISOString()),
      meta: {
        last_auto_fetch_at: meta.last_auto_fetch_at
          ? { ...meta.last_auto_fetch_at, hk: toHK(meta.last_auto_fetch_at.value) }
          : null,
        last_auto_fetch_status: meta.last_auto_fetch_status || null,
      },
      latest: latestOut,
      totalDraws: cntRow?.cnt ?? null,
      health,
    });
  } catch (e) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
}
