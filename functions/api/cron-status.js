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
  // Hong Kong / Taipei 都係 UTC+8
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(d);
}

export async function onRequestGet({ env, request }) {
  try {
    // ✅ 如你想「只俾自己睇」，可以啟用呢個 token 保護（可選）
    // 1) 先喺 Cloudflare Pages > Settings > Environment variables 加 STATUS_TOKEN
    // 2) 之後用 /cron-status.html?token=xxx
    const url = new URL(request.url);
    const provided = url.searchParams.get("token");
    if (env.STATUS_TOKEN) {
      if (!provided || provided !== env.STATUS_TOKEN) {
        return json(403, { ok: false, error: "Forbidden" });
      }
    }

    // ✅ D1 binding 名稱：
    // 你現有 api 檔案用緊邊個就跟返邊個。
    // 常見係 env.DB；如果你用 env.MARK6_DB 就改下面兩行。
    const DB = env.DB || env.MARK6_DB;
    if (!DB) return json(500, { ok: false, error: "Missing D1 binding (env.DB)" });

    // 讀 meta
    const metaRows = await DB.prepare(
      "SELECT key, value, updatedAt FROM meta WHERE key IN ('last_auto_fetch_at','last_auto_fetch_status')"
    ).all();

    const meta = {};
    for (const r of (metaRows.results || [])) {
      meta[r.key] = { value: r.value, updatedAt: r.updatedAt };
    }

    // 最新一期（按 drawDate / drawNo 排）
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

    // 總期數（可顯示 DB 有幾多期）
    const cntRow = await DB.prepare("SELECT COUNT(*) AS cnt FROM draws").first();

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
    });
  } catch (e) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
}
