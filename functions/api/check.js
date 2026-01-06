// functions/api/check.js
import {
  edgeCacheJsonResponse,
  edgeCacheJsonData,
  getLatestDrawMeta,
  getDb,
} from "../_lib/edgeCache.js";

function jsonError(err, status = 500) {
  const msg =
    err instanceof Error ? `${err.message}\n${err.stack || ""}` : String(err);
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function parseNumsStr(s) {
  if (!s) return [];
  return String(s)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((x) => Number(x));
}

function combos(arr, k) {
  const res = [];
  const n = arr.length;
  if (k < 0 || k > n) return res;
  const idx = Array.from({ length: k }, (_, i) => i);

  while (true) {
    res.push(idx.map((i) => arr[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return res;
}

function prizeTier(matchMain, matchSpecial) {
  if (matchMain === 6) return "1st";
  if (matchMain === 5 && matchSpecial) return "2nd";
  if (matchMain === 5) return "3rd";
  if (matchMain === 4 && matchSpecial) return "4th";
  if (matchMain === 4) return "5th";
  if (matchMain === 3 && matchSpecial) return "6th";
  if (matchMain === 3) return "7th";
  return null;
}

function checkOneLine(line6, draw) {
  const winMain = new Set(draw.numbersArr);
  const sp = draw.specialNo;

  let matchMain = 0;
  for (const n of line6) if (winMain.has(n)) matchMain++;
  const matchSpecial = line6.includes(sp);
  const tier = prizeTier(matchMain, matchSpecial);
  return { matchMain, matchSpecial, tier };
}

function expandBetToLines(bet) {
  // bet:
  // {type:"single",numbers:[6]}
  // {type:"multiple",numbers:[7..]}
  // {type:"banker",bankers:[...],others:[...]}
  if (bet.type === "single") return [bet.numbers];

  if (bet.type === "multiple") return combos(bet.numbers, 6);

  if (bet.type === "banker") {
    const b = bet.bankers || [];
    const o = bet.others || [];
    const need = 6 - b.length;
    if (need <= 0) return [];
    return combos(o, need).map((c) => b.concat(c));
  }
  return [];
}

/** Try to parse payload from GET query OR POST JSON */
async function parsePayload(request) {
  const url = new URL(request.url);

  // 1) GET payload=json (urlencoded JSON)
  const payload = url.searchParams.get("payload");
  if (payload) {
    return JSON.parse(payload);
  }

  // 2) GET payloadB64=base64(JSON)
  const payloadB64 = url.searchParams.get("payloadB64");
  if (payloadB64) {
    const json = atob(payloadB64);
    return JSON.parse(json);
  }

  // 3) "classic" GET params fallback (best-effort)
  // type=single|multiple|banker
  // numbers=1,2,3,4,5,6
  // bankers=...&others=...
  // half=1
  const type = (url.searchParams.get("type") || "single").toLowerCase();
  const half = url.searchParams.get("half") === "1";

  const scopeType =
    (url.searchParams.get("scopeType") ||
      url.searchParams.get("scope") ||
      "days").toLowerCase();

  const scope =
    scopeType === "issues"
      ? { type: "issues", issues: Number(url.searchParams.get("issues") || 30) }
      : scopeType === "from"
      ? {
          type: "from",
          from: url.searchParams.get("from"),
          count: Number(url.searchParams.get("count") || 10),
          dir: url.searchParams.get("dir") || "asc",
        }
      : { type: "days", days: Number(url.searchParams.get("days") || 60) };

  let bets = [];
  if (type === "banker") {
    bets = [
      {
        type: "banker",
        bankers: parseNumsStr(url.searchParams.get("bankers")),
        others: parseNumsStr(url.searchParams.get("others") || url.searchParams.get("drag")),
      },
    ];
  } else {
    bets = [
      {
        type: type === "multiple" ? "multiple" : "single",
        numbers: parseNumsStr(url.searchParams.get("numbers")),
      },
    ];
  }

  // 4) POST JSON body (if any)
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const b = await request.json().catch(() => null);
      if (b) return b;
    }
  }

  return { bets, half, scope };
}

async function loadDrawsForScope({ db, ctx, latestDrawNo, scope }) {
  const keyObject = scope;

  return edgeCacheJsonData({
    ctx,
    cacheKeyNamespace: "check_draws_list",
    version: latestDrawNo || "v0",
    ttl: 30,
    swr: 300,
    keyObject,
    computeJson: async () => {
      let rows = [];

      if (scope?.type === "from") {
        const dir = (scope.dir || "asc").toLowerCase() === "desc" ? "desc" : "asc";
        const sql = `
          SELECT drawNo, drawDate, numbers, special
          FROM draws
          WHERE CAST(drawNo AS INTEGER) ${dir === "asc" ? ">=" : "<="} CAST(? AS INTEGER)
          ORDER BY CAST(drawNo AS INTEGER) ${dir.toUpperCase()}
          LIMIT ?
        `;
        const res = await db.prepare(sql).bind(scope.from, Number(scope.count || 10)).all();
        rows = res.results || [];
      } else if (scope?.type === "issues") {
        const res = await db
          .prepare(
            `SELECT drawNo, drawDate, numbers, special
             FROM draws
             ORDER BY CAST(drawNo AS INTEGER) DESC
             LIMIT ?`
          )
          .bind(Number(scope.issues || 30))
          .all();
        rows = res.results || [];
      } else {
        // days (use composite index friendly ORDER BY)
        const days = Number(scope?.days || 60);
        const start = new Date(Date.now() - days * 86400000);
        const startStr = start.toISOString().slice(0, 10);

        const res = await db
          .prepare(
            `SELECT drawNo, drawDate, numbers, special
             FROM draws
             WHERE drawDate >= ?
             ORDER BY drawDate DESC, CAST(drawNo AS INTEGER) DESC`
          )
          .bind(startStr)
          .all();
        rows = res.results || [];
      }

      return {
        draws: rows.map((r) => ({
          drawNo: r.drawNo,
          drawDate: r.drawDate,
          numbersArr: parseNumsStr(r.numbers),
          specialNo: Number(r.special),
        })),
      };
    },
  });
}

async function computeCheckResult({ request, env, ctx }) {
  const db = getDb(env);
  if (!db) throw new Error("D1 binding not found. Please check env binding name.");

  const latest = await getLatestDrawMeta(db);
  const payload = await parsePayload(request);

  const bets = Array.isArray(payload.bets) ? payload.bets : [];
  const half = Boolean(payload.half);
  const scope = payload.scope || { type: "days", days: 60 };

  const pack = await loadDrawsForScope({
    db,
    ctx,
    latestDrawNo: latest.latestDrawNo,
    scope,
  });

  const draws = pack.draws || [];

  const results = draws.map((draw) => {
    const betResults = bets.map((bet) => {
      const lines = expandBetToLines(bet);
      const breakdown = { "1st": 0, "2nd": 0, "3rd": 0, "4th": 0, "5th": 0, "6th": 0, "7th": 0 };

      for (const line of lines) {
        const r = checkOneLine(line, draw);
        if (r.tier) breakdown[r.tier] += 1;
      }

      const unitStake = half ? 0.5 : 1;
      return {
        type: bet.type,
        lines: lines.length,
        stake: lines.length * unitStake,
        breakdown,
      };
    });

    return {
      drawNo: draw.drawNo,
      drawDate: draw.drawDate,
      winning: { numbers: draw.numbersArr, special: draw.specialNo },
      betResults,
    };
  });

  return {
    ok: true,
    meta: {
      latestDrawNo: latest.latestDrawNo,
      latestUpdatedAt: latest.latestUpdatedAt,
      scope,
      drawCount: draws.length,
      half,
    },
    results,
  };
}

/**
 * IMPORTANT:
 * - Keep GET working (your existing /checker likely uses GET + cache)
 * - POST also works, but we do NOT cache POST by default
 */
export async function onRequest({ request, env, ctx }) {
  try {
    if (request.method === "GET") {
      // Cache GET responses by querystring + latestDrawNo version
      const db = getDb(env);
      if (!db) return jsonError("D1 binding not found. Please check env binding name.", 500);

      const latest = await getLatestDrawMeta(db);

      return edgeCacheJsonResponse({
        request,
        ctx,
        cacheKeyNamespace: "api_check",
        version: latest.latestDrawNo || "v0",
        ttl: 10,
        swr: 60,
        cacheControlMaxAge: 0,
        cacheControlSMaxAge: 10,
        computeJson: async () => {
          return await computeCheckResult({ request, env, ctx });
        },
      });
    }

    if (request.method === "POST") {
      const data = await computeCheckResult({ request, env, ctx });
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return jsonError(err, 500);
  }
}
