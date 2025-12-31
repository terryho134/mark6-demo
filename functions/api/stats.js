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
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
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

export async function onRequestGet({ env, request, ctx }) {
  // ✅ Cache 設定：stats 建議 60 秒（admin 更新後最多延遲 60 秒反映）
  const url = new URL(request.url);
  const keyUrl = `${url.origin}/__cache/stats?${url.searchParams.toString() || "v=1"}`;

  return withEdgeCache(ctx, keyUrl, 60, async () => {
    try {
      // ✅ 請跟你現有 check.js 用同一個 binding 名
      // 例如你 check.js 係用 env.DB，就保持 env.DB
      const db = env.DB; // <- 如果你不是 DB，改成你的 D1 binding 名

      if (!db) {
        return {
          status: 500,
          body: { ok: false, error: "Missing D1 binding (env.DB). Please match your check.js binding name." },
        };
      }

      // 1) 總期數
      const cntRow = await db.prepare(`SELECT COUNT(*) AS cnt FROM draws`).first();
      const totalDraws = Number(cntRow?.cnt || 0);

      // 2) 取所有攪珠（由新到舊）
      const all = await db.prepare(`
        SELECT drawNo, drawDate, numbers, special
        FROM draws
        ORDER BY drawDate DESC, drawNo DESC
      `).all();

      const list = all?.results || [];

      // 統計容器
      const totals = Array(50).fill(0);      // index 1..49
      const lastSeen = Array(50).fill(null); // gap index（0=最新一期有出）

      const w100 = Array(50).fill(0);
      const w50  = Array(50).fill(0);
      const w30  = Array(50).fill(0);
      const w20  = Array(50).fill(0);
      const w10  = Array(50).fill(0);

      function addHit(n, idx) {
        n = Number(n);
        if (!Number.isFinite(n) || n < 1 || n > 49) return;

        totals[n] += 1;

        // gap：第一次見到（由新到舊掃）就記錄 index
        if (lastSeen[n] === null) lastSeen[n] = idx;

        // 近N期（idx 由 0 開始）
        if (idx < 100) w100[n] += 1;
        if (idx < 50)  w50[n]  += 1;
        if (idx < 30)  w30[n]  += 1;
        if (idx < 20)  w20[n]  += 1;
        if (idx < 10)  w10[n]  += 1;
      }

      for (let idx = 0; idx < list.length; idx++) {
        const row = list[idx];

        let nums = [];
        try {
          nums = (JSON.parse(row.numbers) || []).map(Number);
        } catch {
          nums = [];
        }
        const extra = Number(row.special);

        // 包括正選 + 特別號
        for (const n of nums) addHit(n, idx);
        addHit(extra, idx);
      }

      // gap：0=上一期有出，1=上一期無出但前期有出...
      const gap = Array(50).fill(null);
      for (let n = 1; n <= 49; n++) {
        gap[n] = lastSeen[n];
      }

      // Top10 / Bottom10（按總次數）
      const arr = [];
      for (let n = 1; n <= 49; n++) arr.push({ n, total: totals[n] });
      arr.sort((a, b) => b.total - a.total || a.n - b.n);

      const top10 = arr.slice(0, 10).map(x => x.n);
      const bottom10 = arr
        .slice(-10)
        .sort((a, b) => a.total - b.total || a.n - b.n)
        .map(x => x.n);

      // items
      const items = [];
      for (let n = 1; n <= 49; n++) {
        items.push({
          n,
          gap: gap[n],
          total: totals[n],
          r100: w100[n],
          r50:  w50[n],
          r30:  w30[n],
          r20:  w20[n],
          r10:  w10[n],
        });
      }

      return {
        status: 200,
        body: {
          ok: true,
          totalDraws,
          top10,
          bottom10,
          items,
        },
      };
    } catch (e) {
      return {
        status: 500,
        body: { ok: false, error: "stats failed: " + (e?.message || String(e)) },
      };
    }
  });
}
