// functions/api/stats.js
import {
  edgeCacheJsonResponse,
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

function parseNums(str) {
  if (!str) return [];
  return String(str)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => n >= 1 && n <= 49);
}

// Picker helpers (hot/cold use MAIN numbers only; special is excluded)
function buildPickerStats(draws, n, k = 10) {
  const counts = Array(50).fill(0); // 1..49
  const sample = draws.slice(0, n);

  for (const d of sample) {
    const nums = parseNums(d.numbers); // main 6 numbers
    for (const x of nums) counts[x] += 1;
  }

  const freq = [];
  for (let i = 1; i <= 49; i++) freq.push({ n: i, c: counts[i] });

  const top10 = [...freq]
    .sort((a, b) => (b.c - a.c) || (a.n - b.n))
    .slice(0, k);

  const bottom10 = [...freq]
    .sort((a, b) => (a.c - b.c) || (a.n - b.n))
    .slice(0, k);

  const last = draws[0] || null;
  const lastDraw = last
    ? {
        drawNo: last.drawNo,
        drawDate: last.drawDate,
        numbers: parseNums(last.numbers),
        special: Number(last.special),
      }
    : null;

  return {
    ok: true,
    n,
    k,
    freq,
    top10,
    bottom10,
    lastDraw,
    sampleSize: sample.length,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const ctx = context;

  // --- Picker N param (for /api/stats?n=10|20|30|60|100) ---
  const url = new URL(request.url);
  const nRaw = url.searchParams.get("n");
  const allowedN = new Set(["10", "20", "30", "60", "100"]);

  // default to 30 if not provided
  const pickerN = nRaw == null || nRaw === "" ? 30 : Number(nRaw);

  if (nRaw != null && nRaw !== "" && !allowedN.has(nRaw)) {
    return jsonError("Invalid n. Allowed: 10, 20, 30, 60, 100", 400);
  }

  try {
    const db = getDb(env);
    if (!db)
      return jsonError(
        "D1 binding not found. Please check env binding name.",
        500
      );

    const metaLatest = await getLatestDrawMeta(db);

    const deployVer = env.CF_PAGES_COMMIT_SHA || "dev";
    const version = `${metaLatest.latestDrawNo || "v0"}_${deployVer}`;

    return edgeCacheJsonResponse({
      request,
      ctx,
      cacheKeyNamespace: "api_stats",
      version,
      ttl: 300,
      swr: 3600,
      cacheControlMaxAge: 0,
      cacheControlSMaxAge: 300,
      computeJson: async () => {
        const res = await db
          .prepare(
            `SELECT drawNo, drawDate, numbers, special
             FROM draws
             ORDER BY CAST(drawNo AS INTEGER) DESC`
          )
          .all();

        const draws = res.results || [];
        const totalDraws = draws.length;

        const windows = [100, 50, 30, 20, 10];
        const totalCount = Array(50).fill(0);
        const windowCount = Object.fromEntries(
          windows.map((w) => [w, Array(50).fill(0)])
        );

        const lastSeenIdx = Array(50).fill(null);

        draws.forEach((d, idx) => {
          const nums = parseNums(d.numbers);
          const sp = Number(d.special);

          // gap based on main only
          for (const n of nums) if (lastSeenIdx[n] === null) lastSeenIdx[n] = idx;

          // total includes main+special (existing behavior kept for old UI)
          for (const n of nums) totalCount[n] += 1;
          if (sp >= 1 && sp <= 49) totalCount[sp] += 1;

          for (const w of windows) {
            if (idx < w) {
              for (const n of nums) windowCount[w][n] += 1;
              if (sp >= 1 && sp <= 49) windowCount[w][sp] += 1;
            }
          }
        });

        const rows = [];
        for (let n = 1; n <= 49; n++) {
          const gap = lastSeenIdx[n] === null ? totalDraws : lastSeenIdx[n];
          const total = totalCount[n];

          const last100 = windowCount[100][n];
          const last50 = windowCount[50][n];
          const last30 = windowCount[30][n];
          const last20 = windowCount[20][n];
          const last10 = windowCount[10][n];

          rows.push({
            // primary keys
            no: n,
            gap,
            total,
            last100,
            last50,
            last30,
            last20,
            last10,

            // ✅ aliases to stop undefined in old UI
            number: n,
            ball: n,
            num: n,

            totalCount: total,
            count: total,
            times: total,
            freq: total,

            recent100: last100,
            recent50: last50,
            recent30: last30,
            recent20: last20,
            recent10: last10,

            near100: last100,
            near50: last50,
            near30: last30,
            near20: last20,
            near10: last10,
          });
        }

        // ✅ NEW: picker stats (MAIN numbers only, special excluded)
        const picker = buildPickerStats(draws, Math.min(pickerN, totalDraws), 10);

        const payload = {
          ok: true,
          totalDraws, // top-level

          meta: {
            latestDrawNo: metaLatest.latestDrawNo,
            latestUpdatedAt: metaLatest.latestUpdatedAt,
            totalDraws,
            total: totalDraws,
            deployVer,
          },

          // primary + aliases (existing, for old UI)
          rows,
          stats: rows,
          items: rows,
          data: rows,
          list: rows,

          // ✅ new block for 智能揀號 v2
          picker,
        };

        return payload;
      },
    });
  } catch (err) {
    return jsonError(err, 500);
  }
}
