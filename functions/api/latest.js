// /functions/api/latest.js  (或你實際 latest.js 路徑)
// Phase 2: Edge cache for /api/latest using caches.default

async function getSiteMeta(env, key) {
  const row = await env.DB
    .prepare("SELECT value FROM site_meta WHERE key = ? LIMIT 1")
    .bind(key)
    .first();
  return row?.value ?? null;
}

function jsonResponse(payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // 重要：Cache API 會跟呢個 max-age 去做 expiry
      "cache-control": "public, max-age=120",
      ...extraHeaders,
    },
  });
}

export async function onRequest({ request, env, waitUntil }) {
  const cache = caches.default;

  // ✅ 統一 cache key：忽略 ?v=xxx / ?__ts=xxx
  const url = new URL(request.url);
  url.search = "";
  const cacheKey = new Request(url.toString(), { method: "GET" });

  // 1) 先試 cache
  const cached = await cache.match(cacheKey);
  if (cached) {
    const res = new Response(cached.body, cached);
    res.headers.set("x-edge-cache", "HIT");
    return res;
  }

  // 2) cache miss → 讀 D1
  const now = new Date().toISOString();

  const latestRow = await env.DB
    .prepare(
      "SELECT drawNo, drawDate, numbers, special, updatedAt FROM draws ORDER BY drawDate DESC LIMIT 1"
    )
    .first();

  const nextDrawRow = await env.DB
    .prepare("SELECT value, updatedAt FROM site_meta WHERE key='nextDraw' LIMIT 1")
    .first();

  // 最新一期
  const draw = latestRow
    ? {
        drawNo: latestRow.drawNo,
        drawDate: latestRow.drawDate,
        numbers: JSON.parse(latestRow.numbers),
        special: Number(latestRow.special),
      }
    : null;

  // 下期（由 next-cron / admin/next 寫入 site_meta.nextDraw）
  let nextDraw = null;
  if (nextDrawRow?.value) {
    try {
      const nd = JSON.parse(nextDrawRow.value);
      // 你前台用既格式：jackpotMillion / jackpotAmount / note
      const jackpotM = nd?.jackpotM ?? null;
      nextDraw = {
        drawNo: nd?.drawNo ?? null,
        drawDate: nd?.drawDate ?? null,
        jackpotMillion: Number.isFinite(Number(jackpotM)) ? Number(jackpotM) : null,
        jackpotAmount:
          Number.isFinite(Number(jackpotM)) ? Number(jackpotM) * 1_000_000 : null,
        note: "下期資料以官方公佈為準",
        // 可選：保留 stopSellingTime / source 俾 debug
        stopSellingTime: nd?.stopSellingTime ?? null,
        source: nd?.source ?? null,
      };
    } catch {
      // ignore parse error
    }
  }

  const payload = {
    source: "d1",
    // ✅ 建議：updatedAt 用「生成時間」ok；如你想更準，可改成 max(latestRow.updatedAt, nextDrawRow.updatedAt)
    updatedAt: now,
    draw,
    nextDraw: nextDraw || {
      drawNo: null,
      drawDate: null,
      jackpotMillion: null,
      jackpotAmount: null,
      note: "下期資料以官方公佈為準",
    },
    disclaimer: "本頁資料僅供參考，以官方公佈為準。",
  };

  const res = jsonResponse(payload, {
    "x-edge-cache": "MISS",
  });

  // 3) 寫入 edge cache（非阻塞）
  const putPromise = cache.put(cacheKey, res.clone());
  if (typeof waitUntil === "function") waitUntil(putPromise);
  else await putPromise;

  return res;
}
