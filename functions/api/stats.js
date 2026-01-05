// functions/api/stats.js
import { edgeCacheJsonResponse, getLatestDrawMeta } from "../_lib/edgeCache.js";

function parseNums(str) {
  if (!str) return [];
  return String(str)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((x) => Number(x));
}

export async function onRequestGet({ request, env, ctx }) {
  const db = env.DB;
  const meta = await getLatestDrawMeta(db);

  return edgeCacheJsonResponse({
    request,
    ctx,
    cacheKeyNamespace: "api_stats",
    version: meta.latestDrawNo || "v0",
    ttl: 300, // fresh 5m
    swr: 3600, // stale up to 1h while background refresh
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

      // total counts include numbers + special
      const totalCount = Array(50).fill(0);
      const windowCount = Object.fromEntries(windows.map((w) => [w, Array(50).fill(0)]));

      // gap based on "numbers" only
      const lastSeenIdx = Array(50).fill(null);

      draws.forEach((d, idx) => {
        const nums = parseNums(d.numbers);
        const sp = Number(d.special);

        // gap tracking (numbers only)
        for (const n of nums) {
          if (lastSeenIdx[n] === null) lastSeenIdx[n] = idx;
        }

        // total counts (numbers + special)
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
        const idx = lastSeenIdx[n];
        rows.push({
          no: n,
          gap: idx === null ? totalDraws : idx, // 0 means appeared in latest draw
          total: totalCount[n],
          last100: windowCount[100][n],
          last50: windowCount[50][n],
          last30: windowCount[30][n],
          last20: windowCount[20][n],
          last10: windowCount[10][n],
        });
      }

      return {
        meta: {
          latestDrawNo: meta.latestDrawNo,
          latestUpdatedAt: meta.latestUpdatedAt,
          totalDraws,
        },
        rows,
      };
    },
  });
}
