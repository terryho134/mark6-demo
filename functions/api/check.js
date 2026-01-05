// functions/api/check.js
import { edgeCacheJsonData, getLatestDrawMeta } from "../_lib/edgeCache.js";

function parseNums(str) {
  if (!str) return [];
  return String(str)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((x) => Number(x));
}

function combos(arr, k) {
  // simple combination generator (n is small in Mark6)
  const res = [];
  const n = arr.length;
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
  // Mark Six basic tiers
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
  // bet.type: "single" | "multiple" | "banker"
  if (bet.type === "single") {
    return [bet.numbers];
  }
  if (bet.type === "multiple") {
    return combos(bet.numbers, 6);
  }
  if (bet.type === "banker") {
    const b = bet.bankers || [];
    const o = bet.others || [];
    const need = 6 - b.length;
    if (need <= 0) return []; // invalid
    return combos(o, need).map((c) => b.concat(c));
  }
  return [];
}

async function loadDrawsForScope({ db, ctx, latestDrawNo, scope }) {
  // scope:
  // { type:"days", days:60 }
  // { type:"issues", issues:30 }
  // { type:"from", from:"2025001", count:20, dir:"asc|desc" }

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
        // default: days
        const days = Number(scope?.days || 60);
        const start = new Date(Date.now() - days * 86400000);
        const startStr = start.toISOString().slice(0, 10);

        const res = await db
          .prepare(
            `SELECT drawNo, drawDate, numbers, special
             FROM draws
             WHERE drawDate >= ?
             ORDER BY CAST(drawNo AS INTEGER) DESC`
          )
          .bind(startStr)
          .all();
        rows = res.results || [];
      }

      return {
        returned: rows.length,
        draws: rows.map((r) => ({
          drawNo: r.drawNo,
          drawDate: r.drawDate,
          numbersArr: parseNums(r.numbers),
          specialNo: Number(r.special),
        })),
      };
    },
  });
}

export async function onRequestPost({ request, env, ctx }) {
  const db = env.DB;
  const latest = await getLatestDrawMeta(db);

  const body = await request.json().catch(() => ({}));

  // Expected body shape:
  // {
  //   "bets":[{type:"single",numbers:[...]}, {type:"multiple",numbers:[...]}, {type:"banker",bankers:[...],others:[...]}],
  //   "half": false,
  //   "scope": {type:"days",days:60} | {type:"issues",issues:30} | {type:"from",from:"2025001",count:20,dir:"asc"}
  // }
  const bets = Array.isArray(body.bets) ? body.bets : [];
  const half = Boolean(body.half);
  const scope = body.scope || { type: "days", days: 60 };

  // Load draws with cache
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
      let hitLines = 0;

      for (const line of lines) {
        const r = checkOneLine(line, draw);
        if (r.tier) {
          breakdown[r.tier] += 1;
          hitLines += 1;
        }
      }

      const unitStake = half ? 0.5 : 1;
      return {
        type: bet.type,
        lines: lines.length,
        stake: lines.length * unitStake,
        hitLines,
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

  // IMPORTANT: do not cache check results
  return new Response(
    JSON.stringify({
      meta: {
        latestDrawNo: latest.latestDrawNo,
        latestUpdatedAt: latest.latestUpdatedAt,
        scope,
        drawCount: draws.length,
        half,
      },
      results,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}
