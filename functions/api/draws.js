function json(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
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

  // 只 cache 成功回應
  if (status >= 200 && status < 300) {
    ctx.waitUntil(cache.put(cacheReq, res.clone()));
  }
  return res;
}

export async function onRequestGet({ request, env, ctx }) {
  const url = new URL(request.url);

  // limit
  const limitRaw = url.searchParams.get("limit") || "10";
  let limit = parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 10;
  limit = Math.min(limit, 120); // 避免一次過太大

  // cache key（包含 limit）
  const keyUrl = `${url.origin}/__cache/draws?limit=${limit}`;

  return withEdgeCache(ctx, keyUrl, 60, async () => {
    try {
      if (!env.DB) {
        return {
          status: 500,
          body: { ok: false, error: "Missing D1 binding (env.DB)" },
        };
      }

      const q = `
        SELECT drawNo, drawDate, numbers, special
        FROM draws
        ORDER BY drawDate DESC, drawNo DESC
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

      return { status: 200, body: { ok: true, limit, draws } };
    } catch (e) {
      return {
        status: 500,
        body: { ok: false, error: e?.message || String(e) },
      };
    }
  });
}
