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
    .map((x) => Number(x))
    .filter((n) => n >= 1 && n <= 49);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function nCr(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let res = 1;
  for (let i = 1; i <= k; i++) {
    res = (res * (n - k + i)) / i;
  }
  return Math.round(res);
}

function tierName(matchMain, matchSpecial) {
  if (matchMain === 6) return "1st";
  if (matchMain === 5 && matchSpecial) return "2nd";
  if (matchMain === 5) return "3rd";
  if (matchMain === 4 && matchSpecial) return "4th";
  if (matchMain === 4) return "5th";
  if (matchMain === 3 && matchSpecial) return "6th";
  if (matchMain === 3) return "7th";
  return null;
}

function countHitsMultiple(selected, winMainArr, specialNo) {
  // selected: array of numbers
  const selSet = new Set(selected);
  const a = winMainArr.reduce((acc, n) => acc + (selSet.has(n) ? 1 : 0), 0); // 0..6
  const b = selSet.has(specialNo) ? 1 : 0; // 0/1
  const n = selected.length;
  const nonWinNonSpecial = n - a - b;

  // total lines
  const lines = nCr(n, 6);

  const wins = {
    "1st": 0,
    "2nd": 0,
    "3rd": 0,
    "4th": 0,
    "5th": 0,
    "6th": 0,
    "7th": 0,
  };

  // Using combinatorics (fast even for 49 numbers)
  // 1st: 6 main
  wins["1st"] = nCr(a, 6);

  // 2nd: 5 main + special
  wins["2nd"] = b ? nCr(a, 5) * 1 : 0;

  // 3rd: 5 main + 1 other (not special)
  wins["3rd"] = nCr(a, 5) * nCr(nonWinNonSpecial, 1);

  // 4th: 4 main + special + 1 other
  wins["4th"] = b ? nCr(a, 4) * nCr(nonWinNonSpecial, 1) : 0;

  // 5th: 4 main + 2 other
  wins["5th"] = nCr(a, 4) * nCr(nonWinNonSpecial, 2);

  // 6th: 3 main + special + 2 other
  wins["6th"] = b ? nCr(a, 3) * nCr(nonWinNonSpecial, 2) : 0;

  // 7th: 3 main + 3 other
  wins["7th"] = nCr(a, 3) * nCr(nonWinNonSpecial, 3);

  const hasWin = Object.values(wins).some((x) => x > 0);

  return { lines, wins, hasWin, a, b };
}

function countHitsBanker(bankers, others, winMainArr, specialNo) {
  // bankers always included; choose (6-B) from others
  const B = bankers.length;
  const need = 6 - B;
  const O = others.length;
  const winSet = new Set(winMainArr);

  if (need < 0 || need > O) {
    return {
      lines: 0,
      wins: { "1st": 0, "2nd": 0, "3rd": 0, "4th": 0, "5th": 0, "6th": 0, "7th": 0 },
      hasWin: false,
    };
  }

  const aB = bankers.reduce((acc, n) => acc + (winSet.has(n) ? 1 : 0), 0);
  const bB = bankers.includes(specialNo) ? 1 : 0;

  const aO = others.reduce((acc, n) => acc + (winSet.has(n) ? 1 : 0), 0);
  const bO = others.includes(specialNo) ? 1 : 0;

  const nonWinOther = O - aO - bO;

  const wins = { "1st": 0, "2nd": 0, "3rd": 0, "4th": 0, "5th": 0, "6th": 0, "7th": 0 };
  const lines = nCr(O, need);

  for (let x = 0; x <= Math.min(aO, need); x++) {
    // y: choose special from others? only if special not already in bankers
    const yMax = bB ? 0 : Math.min(bO, need - x);
    for (let y = 0; y <= yMax; y++) {
      const r = need - x - y; // remaining slots from non-winning (not special)
      if (r < 0 || r > nonWinOther) continue;

      const matchMain = aB + x;
      const matchSpecial = Boolean(bB || y === 1);
      const tier = tierName(matchMain, matchSpecial);
      if (!tier) continue;

      const ways =
        nCr(aO, x) * nCr(bO, y) * nCr(nonWinOther, r);

      wins[tier] += ways;
    }
  }

  const hasWin = Object.values(wins).some((x) => x > 0);
  return { lines, wins, hasWin };
}

/** Parse payload from GET query OR POST JSON; try many param names for compatibility */
async function parsePayload(request) {
  const url = new URL(request.url);

  // JSON packed
  const payload = url.searchParams.get("payload") || url.searchParams.get("data");
  if (payload) return JSON.parse(payload);

  const payloadB64 = url.searchParams.get("payloadB64");
  if (payloadB64) return JSON.parse(atob(payloadB64));

  // Try common param names
  const typeRaw =
    url.searchParams.get("type") ||
    url.searchParams.get("betType") ||
    url.searchParams.get("mode") ||
    "single";
  const type = String(typeRaw).toLowerCase();

  const half =
    url.searchParams.get("half") === "1" ||
    url.searchParams.get("halfBet") === "1";

  // numbers could be "numbers", "nums", "picks", "selected"
  const numbers =
    parseNumsStr(url.searchParams.get("numbers")) ||
    [];
  const numbers2 = parseNumsStr(url.searchParams.get("nums"));
  const numbers3 = parseNumsStr(url.searchParams.get("picks"));
  const numbers4 = parseNumsStr(url.searchParams.get("selected"));
  const mainNumbers = uniq(
    (numbers.length ? numbers : [])
      .concat(numbers2 || [])
      .concat(numbers3 || [])
      .concat(numbers4 || [])
  );

  const bankers = uniq(
    parseNumsStr(url.searchParams.get("bankers")) ||
      parseNumsStr(url.searchParams.get("banker")) ||
      parseNumsStr(url.searchParams.get("dan")) ||
      []
  );

  const others = uniq(
    parseNumsStr(url.searchParams.get("others")) ||
      parseNumsStr(url.searchParams.get("drag")) ||
      parseNumsStr(url.searchParams.get("tuo")) ||
      []
  );

  // Scope
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

  // Build bets
  let bets = [];
  if (type.includes("bank") || type.includes("dan") || type.includes("膽")) {
    bets = [{ type: "banker", bankers, others }];
  } else if (type.includes("multi") || type.includes("複")) {
    bets = [{ type: "multiple", numbers: mainNumbers }];
  } else {
    bets = [{ type: "single", numbers: mainNumbers }];
  }

  // POST JSON overrides
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
  return edgeCacheJsonData({
    ctx,
    cacheKeyNamespace: "check_draws_list",
    version: latestDrawNo || "v0",
    ttl: 30,
    swr: 300,
    keyObject: scope,
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
        draws: (rows || []).map((r) => ({
          drawNo: r.drawNo,
          drawDate: r.drawDate,
          numbers: parseNumsStr(r.numbers), // ✅ array
          special: Number(r.special),       // ✅ number
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
  const unitStake = half ? 0.5 : 1;

  const results = draws.map((d) => {
    const winMainArr = d.numbers;
    const specialNo = d.special;

    // each bet result
    const betResults = bets.map((bet) => {
      if (bet.type === "banker") {
        const bankers = uniq(bet.bankers || []);
        const others = uniq((bet.others || []).filter((n) => !bankers.includes(n)));
        const { lines, wins, hasWin } = countHitsBanker(bankers, others, winMainArr, specialNo);
        return {
          type: "banker",
          lines,
          stake: lines * unitStake,
          wins,
          hasWin,
          bankers,
          others,
        };
      }

      if (bet.type === "multiple") {
        const selected = uniq(bet.numbers || []);
        const { lines, wins, hasWin } = countHitsMultiple(selected, winMainArr, specialNo);
        return {
          type: "multiple",
          lines,
          stake: lines * unitStake,
          wins,
          hasWin,
          numbers: selected,
        };
      }

      // single (treat as one line; still use formula for correctness)
      const selected = uniq(bet.numbers || []);
      const { lines, wins, hasWin } = countHitsMultiple(selected, winMainArr, specialNo);
      // For single, lines should be 1 only when exactly 6 numbers; otherwise keep computed but most UIs assume 1
      const singleLines = selected.length === 6 ? 1 : lines;
      return {
        type: "single",
        lines: singleLines,
        stake: singleLines * unitStake,
        wins,
        hasWin,
        numbers: selected,
      };
    });

    const hasWin = betResults.some((b) => b.hasWin);

    // ✅ Backward-compatible per-draw shape:
    return {
      drawNo: d.drawNo,
      drawDate: d.drawDate,

      // old UI expects:
      numbers: winMainArr,
      special: specialNo,

      // new keys:
      hasWin,
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

    // many frontends expect results / draws
    results,
    draws: results, // alias for compatibility
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const ctx = context;

  try {
    if (request.method === "GET") {
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
