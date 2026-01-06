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
  for (let i = 1; i <= k; i++) res = (res * (n - k + i)) / i;
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
  const selSet = new Set(selected);
  const a = winMainArr.reduce((acc, n) => acc + (selSet.has(n) ? 1 : 0), 0);
  const b = selSet.has(specialNo) ? 1 : 0;
  const n = selected.length;
  const nonWinNonSpecial = n - a - b;

  const lines = nCr(n, 6);
  const wins = { "1st": 0, "2nd": 0, "3rd": 0, "4th": 0, "5th": 0, "6th": 0, "7th": 0 };

  wins["1st"] = nCr(a, 6);
  wins["2nd"] = b ? nCr(a, 5) : 0;
  wins["3rd"] = nCr(a, 5) * nCr(nonWinNonSpecial, 1);
  wins["4th"] = b ? nCr(a, 4) * nCr(nonWinNonSpecial, 1) : 0;
  wins["5th"] = nCr(a, 4) * nCr(nonWinNonSpecial, 2);
  wins["6th"] = b ? nCr(a, 3) * nCr(nonWinNonSpecial, 2) : 0;
  wins["7th"] = nCr(a, 3) * nCr(nonWinNonSpecial, 3);

  return { lines, wins, hasWin: Object.values(wins).some((x) => x > 0) };
}

function countHitsBanker(bankers, others, winMainArr, specialNo) {
  const B = bankers.length;
  const need = 6 - B;
  const O = others.length;
  const winSet = new Set(winMainArr);

  const wins = { "1st": 0, "2nd": 0, "3rd": 0, "4th": 0, "5th": 0, "6th": 0, "7th": 0 };
  if (need < 0 || need > O) return { lines: 0, wins, hasWin: false };

  const aB = bankers.reduce((acc, n) => acc + (winSet.has(n) ? 1 : 0), 0);
  const bB = bankers.includes(specialNo) ? 1 : 0;

  const aO = others.reduce((acc, n) => acc + (winSet.has(n) ? 1 : 0), 0);
  const bO = others.includes(specialNo) ? 1 : 0;

  const nonWinOther = O - aO - bO;
  const lines = nCr(O, need);

  for (let x = 0; x <= Math.min(aO, need); x++) {
    const yMax = bB ? 0 : Math.min(bO, need - x);
    for (let y = 0; y <= yMax; y++) {
      const r = need - x - y;
      if (r < 0 || r > nonWinOther) continue;

      const matchMain = aB + x;
      const matchSpecial = Boolean(bB || y === 1);
      const tier = tierName(matchMain, matchSpecial);
      if (!tier) continue;

      const ways = nCr(aO, x) * nCr(bO, y) * nCr(nonWinOther, r);
      wins[tier] += ways;
    }
  }

  return { lines, wins, hasWin: Object.values(wins).some((x) => x > 0) };
}

function extractNumbersFromAllParams(url) {
  // Accept repeated params (e.g. n=1&n=2...)
  const candidateKeys = ["numbers", "nums", "selected", "sel", "pick", "picks", "n", "num", "number", "no"];
  let nums = [];

  for (const k of candidateKeys) {
    const all = url.searchParams.getAll(k);
    if (all && all.length) {
      for (const v of all) nums.push(...parseNumsStr(v));
    }
  }

  // If still empty, scan every param value for number-list patterns
  if (nums.length === 0) {
    for (const [, v] of url.searchParams.entries()) {
      const arr = parseNumsStr(v);
      if (arr.length >= 6) {
        nums.push(...arr);
        break;
      }
    }
  }

  return uniq(nums);
}

async function parsePayload(request) {
  const url = new URL(request.url);

  // 1) Try JSON-ish params (payload/data/q/state/bets)
  const jsonKeys = ["payload", "data", "q", "state", "bets", "bet"];
  for (const k of jsonKeys) {
    const v = url.searchParams.get(k);
    if (v && (v.trim().startsWith("{") || v.trim().startsWith("["))) {
      try {
        const obj = JSON.parse(v);
        if (obj && typeof obj === "object") return obj;
      } catch {}
    }
  }

  // 2) POST JSON
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const b = await request.json().catch(() => null);
      if (b) return b;
    }
  }

  // 3) Fallback classic GET
  const typeRaw = url.searchParams.get("type") || url.searchParams.get("mode") || url.searchParams.get("betType") || "single";
  const type = String(typeRaw).toLowerCase();

  const half = url.searchParams.get("half") === "1" || url.searchParams.get("halfBet") === "1";

  const bankers = uniq(
    parseNumsStr(url.searchParams.get("bankers")) ||
      parseNumsStr(url.searchParams.get("banker")) ||
      parseNumsStr(url.searchParams.get("dan")) ||
      parseNumsStr(url.searchParams.get("膽"))
  );

  const others = uniq(
    parseNumsStr(url.searchParams.get("others")) ||
      parseNumsStr(url.searchParams.get("drag")) ||
      parseNumsStr(url.searchParams.get("tuo")) ||
      parseNumsStr(url.searchParams.get("拖"))
  );

  const numbers = extractNumbersFromAllParams(url);

  const scopeType = (url.searchParams.get("scopeType") || url.searchParams.get("scope") || "days").toLowerCase();
  const scope =
    scopeType === "issues"
      ? { type: "issues", issues: Number(url.searchParams.get("issues") || 30) }
      : scopeType === "from"
      ? { type: "from", from: url.searchParams.get("from"), count: Number(url.searchParams.get("count") || 10), dir: url.searchParams.get("dir") || "asc" }
      : { type: "days", days: Number(url.searchParams.get("days") || 60) };

  let bets = [];
  if (type.includes("bank") || type.includes("dan") || type.includes("膽")) {
    bets = [{ type: "banker", bankers, others }];
  } else if (type.includes("multi") || type.includes("複")) {
    bets = [{ type: "multiple", numbers }];
  } else {
    bets = [{ type: "single", numbers }];
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
          numbers: parseNumsStr(r.numbers),
          numbersArr: parseNumsStr(r.numbers),
          special: Number(r.special),
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
  const unitStake = half ? 0.5 : 1;

  const pack = await loadDrawsForScope({ db, ctx, latestDrawNo: latest.latestDrawNo, scope });
  const draws = pack.draws || [];

  let anyWin = false;

  const results = draws.map((d) => {
    const winMain = d.numbers;
    const sp = d.special;

    const betResults = bets.map((bet) => {
      if (bet.type === "banker") {
        const bankers = uniq(bet.bankers || []);
        const others = uniq((bet.others || []).filter((n) => !bankers.includes(n)));
        const { lines, wins, hasWin } = countHitsBanker(bankers, others, winMain, sp);
        return { type: "banker", lines, stake: lines * unitStake, wins, hasWin, bankers, others };
      }
      if (bet.type === "multiple") {
        const selected = uniq(bet.numbers || []);
        const { lines, wins, hasWin } = countHitsMultiple(selected, winMain, sp);
        return { type: "multiple", lines, stake: lines * unitStake, wins, hasWin, numbers: selected };
      }
      const selected = uniq(bet.numbers || []);
      const { lines, wins, hasWin } = countHitsMultiple(selected, winMain, sp);
      const singleLines = selected.length === 6 ? 1 : lines;
      return { type: "single", lines: singleLines, stake: singleLines * unitStake, wins, hasWin, numbers: selected };
    });

    const hasWin = betResults.some((b) => b.hasWin);
    if (hasWin) anyWin = true;

    // ✅ give old UI commonly-used keys
    return {
      drawNo: d.drawNo,
      drawDate: d.drawDate,

      numbers: winMain,
      numbersArr: winMain,
      special: sp,
      specialNo: sp,

      hasWin,
      betResults,
    };
  });

  return {
    ok: true,
    anyWin,
    hasWin: anyWin, // alias

    meta: {
      latestDrawNo: latest.latestDrawNo,
      latestUpdatedAt: latest.latestUpdatedAt,
      scope,
      drawCount: draws.length,
      half,
    },

    results,
    draws: results, // alias for older pages
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
        computeJson: async () => computeCheckResult({ request, env, ctx }),
      });
    }

    if (request.method === "POST") {
      const data = await computeCheckResult({ request, env, ctx });
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
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
