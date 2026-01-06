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
    .map((x) => Number(x));
}

export async function onRequestGet({ request, env, ctx }) {
  try {
    const db = getDb(env);
    if (!db) return jsonError("D1 binding not found. Please check env binding name.", 500);

    const meta = await getLatestDrawMeta(db);

    return edgeCacheJsonResponse({
      request,
      ctx,
      cacheKeyNamespace: "api_stats",
      version: meta.latestDrawNo || "v0",
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

          for (const n of nums) {
            if (lastSeenIdx[n] === null) lastSeenIdx[n] = idx;
          }

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
            gap: idx === null ? totalDraws : idx,
            total: totalCount[n],
            last100: windowCount[100][n],
            last50: windowCount[50][n],
            last30: windowCount[30][n],
            last20: windowCount[20][n],
            last10: windowCount[10][n],
          });
        }

        return {
          ok: true,
          meta: {
            latestDrawNo: meta.latestDrawNo,
            latestUpdatedAt: meta.latestUpdatedAt,
            totalDraws,
          },
          rows,
        };
      },
    });
  } catch (err) {
    return jsonError(err, 500);
  }
}
