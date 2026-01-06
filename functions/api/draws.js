// functions/api/draws.js
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

export async function onRequestGet(context) {
  const { request, env } = context;
  const ctx = context;

  try {
    const db = getDb(env);
    if (!db) return jsonError("D1 binding not found. Please check env binding name.", 500);

    const url = new URL(request.url);
    const meta = await getLatestDrawMeta(db);

    return edgeCacheJsonResponse({
      request,
      ctx,
      cacheKeyNamespace: "api_draws",
      version: meta.latestDrawNo || "v0",
      ttl: 30,
      swr: 300,
      cacheControlMaxAge: 0,
      cacheControlSMaxAge: 30,
      computeJson: async () => {
        // support old/new param names
        const daysParam = url.searchParams.get("days") || url.searchParams.get("day");
        const issuesParam =
          url.searchParams.get("issues") ||
          url.searchParams.get("issue") ||
          url.searchParams.get("n");

        const days = Number(daysParam || "0");
        const issues = Number(issuesParam || "0");
        const from = url.searchParams.get("from");
        const count = Number(url.searchParams.get("count") || "0");
        const dir =
          (url.searchParams.get("dir") || "desc").toLowerCase() === "asc"
            ? "asc"
            : "desc";

        let rows = [];

        if (from && count > 0) {
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
               ORDER BY CAST(drawNo AS INTEGER) DESC
               LIMIT ?`
            )
            .bind(issues)
            .all();
          rows = res.results || [];
        } else {
          const d = days > 0 ? days : 60;
          const start = new Date(Date.now() - d * 86400000);
          const startStr = ymd(start);

          // IMPORTANT: composite-index-friendly order
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
        }

        // ✅ Backward-compatible draw shape:
        // - numbers: array
        // - special: number
        // keep numbersStr/specialStr too
        const draws = rows.map((r) => {
          const numbersArr = parseNums(r.numbers);
          const specialNo = Number(r.special);
          return {
            drawNo: r.drawNo,
            drawDate: r.drawDate,
            year: r.year,
            updatedAt: r.updatedAt,

            // old UI expects these:
            numbers: numbersArr,
            special: specialNo,

            // keep originals for debugging / other pages:
            numbersStr: r.numbers,
            specialStr: r.special,
          };
        });

        return {
          ok: true,
          meta: {
            latestDrawNo: meta.latestDrawNo,
            latestUpdatedAt: meta.latestUpdatedAt,
            returned: draws.length,
          },
          draws,
        };
      },
    });
  } catch (err) {
    return jsonError(err, 500);
  }
}
