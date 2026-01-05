// functions/api/draws.js
import { edgeCacheJsonResponse, getLatestDrawMeta } from "../_lib/edgeCache.js";

function ymd(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseNums(str) {
  if (!str) return [];
  return String(str)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((x) => Number(x));
}

export async function onRequestGet({ request, env, ctx }) {
  const db = env.DB;
  const url = new URL(request.url);

  // Fast meta for cache-bust (new draw => new cache key immediately)
  const meta = await getLatestDrawMeta(db);

  return edgeCacheJsonResponse({
    request,
    ctx,
    cacheKeyNamespace: "api_draws",
    version: meta.latestDrawNo || "v0",
    ttl: 30, // fresh 30s
    swr: 300, // allow stale 5m while background refresh
    cacheControlMaxAge: 0, // browser always revalidate
    cacheControlSMaxAge: 30,
    computeJson: async () => {
      const days = Number(url.searchParams.get("days") || "0");
      const issues = Number(url.searchParams.get("issues") || "0");
      const from = url.searchParams.get("from");
      const count = Number(url.searchParams.get("count") || "0");
      const dir = (url.searchParams.get("dir") || "desc").toLowerCase() === "asc" ? "asc" : "desc";

      let rows = [];

      if (from && count > 0) {
        // From drawNo, take N draws (for multi-check)
        const sql = `
          SELECT drawNo, drawDate, numbers, special, year, updatedAt
          FROM draws
          WHERE CAST(drawNo AS INTEGER) ${dir === "asc" ? ">=" : "<="} CAST(? AS INTEGER)
          ORDER BY CAST(drawNo AS INTEGER) ${dir.toUpperCase()}
          LIMIT ?
        `;
        const res = await db.prepare(sql).bind(from, count).all();
        rows = res.results || [];
      } else if (issues > 0) {
        const res = await db
          .prepare(
            `SELECT drawNo, drawDate, numbers, special, year, updatedAt
             FROM draws
             WHERE drawDate >= ?
             ORDER BY drawDate DESC, CAST(drawNo AS INTEGER) DESC`
          )
          .bind(startStr)
          .all();
        rows = res.results || [];
      } else {
        // Default days=60 if nothing specified
        const d = days > 0 ? days : 60;
        const start = new Date(Date.now() - d * 86400000);
        const startStr = ymd(start);

        const res = await db
          .prepare(
            `SELECT drawNo, drawDate, numbers, special, year, updatedAt
             FROM draws
             WHERE drawDate >= ?
             ORDER BY CAST(drawNo AS INTEGER) DESC`
          )
          .bind(startStr)
          .all();
        rows = res.results || [];
      }

      return {
        meta: {
          latestDrawNo: meta.latestDrawNo,
          latestUpdatedAt: meta.latestUpdatedAt,
          returned: rows.length,
        },
        draws: rows.map((r) => ({
          ...r,
          numbersArr: parseNums(r.numbers),
          specialNo: Number(r.special),
        })),
      };
    },
  });
}
