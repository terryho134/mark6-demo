function json(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
}

/**
 * 在 Pages Functions/Workers 用 caches.default 做「手動 key cache」
 * - keyUrl: 用嚟當 cache key 的 URL（GET）
 * - ttlSec: max-age 秒數
 * - computeFn: 真正做 DB/計算嘅 function，return {status, body}
 */
async function withEdgeCache(ctx, keyUrl, ttlSec, computeFn) {
  const cache = caches.default;
  const cacheReq = new Request(keyUrl, { method: "GET" });

  const hit = await cache.match(cacheReq);
  if (hit) return hit;

  const { status = 200, body } = await computeFn();
  const res = json(status, body, {
    "cache-control": `public, max-age=${ttlSec}`,
  });

  // 只 cache 正常成功回應（你亦可改為 status===200）
  if (status >= 200 && status < 300) {
    ctx.waitUntil(cache.put(cacheReq, res.clone()));
  }
  return res;
}


export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit") || "10";
    let limit = parseInt(limitRaw, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 10;
    limit = Math.min(limit, 120); // 避免一次過太大!

    const q = `
      SELECT drawNo, drawDate, numbers, special
      FROM draws
      ORDER BY drawDate DESC
      LIMIT ?1
    `;

    const r = await env.DB.prepare(q).bind(limit).all();
    const rows = r?.results || [];

    const draws = rows.map(row => ({
      drawNo: row.drawNo,
      drawDate: row.drawDate,                 // YYYY-MM-DD
      numbers: JSON.parse(row.numbers || "[]"),
      extra: Number(row.special),
    }));

    return json(200, { ok: true, draws });
  } catch (e) {
    return json(500, { ok: false, error: e.message || String(e) });
  }
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
