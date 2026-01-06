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
    .map((x) => Number(x))
    .filter((n) => n >= 1 && n <= 49);
}

function isBig(n) {
  // Mark Six common split: 1-24 small, 25-49 big
  return n >= 25;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const ctx = context;

  try {
    const db = getDb(env);
    if (!db) return jsonError("D1 binding not found. Please check env binding name.", 500);

    const url = new URL(request.url);
    const meta = await getLatestDrawMeta(db);

    // ✅ bust cache on every deploy
    const deployVer = env.CF_PAGES_COMMIT_SHA || "dev";
    const version = `${meta.latestDrawNo || "v0"}_${deployVer}`;

    return edgeCacheJsonResponse({
      request,
      ctx,
      cacheKeyNamespace: "api_draws",
      version,
      ttl: 30,
      swr: 300,
      cacheControlMaxAge: 0,
      cacheControlSMaxAge: 30,
      computeJson: async () => {
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

        const draws = rows.map((r) => {
          const numbersArr = parseNums(r.numbers);
          const specialNo = Number(r.special);

          return {
            drawNo: r.drawNo,
            drawDate: r.drawDate,
            year: r.year,
            updatedAt: r.updatedAt,

            // old UI
            numbers: numbersArr,
            special: specialNo,

            // aliases
            numbersArr,
            specialNo,

            // raw
            numbersStr: r.numbers,
            specialStr: r.special,
          };
        });

        // ✅ add summary to stop NaN bottom line (if your UI reads it)
        let totalBalls = 0; // include special
        let totalBig = 0;
        let totalSmall = 0;

        for (const d of draws) {
          const all7 = [...(d.numbers || []), Number(d.special || 0)].filter((n) => n >= 1 && n <= 49);
          totalBalls += all7.length;
          for (const n of all7) {
            if (isBig(n)) totalBig++;
            else totalSmall++;
          }
        }

        const drawCount = draws.length || 0;

        const summary = {
          drawCount,
          totalBalls,
          avgBalls: drawCount ? totalBalls / drawCount : 0,
          totalBig,
          totalSmall,
          avgBig: drawCount ? totalBig / drawCount : 0,
          avgSmall: drawCount ? totalSmall / drawCount : 0,
          // keep a boolean too, some UIs show "大/小"
          avgBigVsSmall: totalBig > totalSmall ? "大" : "小",
        };

        return {
          ok: true,
          meta: {
            latestDrawNo: meta.latestDrawNo,
            latestUpdatedAt: meta.latestUpdatedAt,
            returned: draws.length,
            deployVer,
          },
          summary,
          draws,
        };
      },
    });
  } catch (err) {
    return jsonError(err, 500);
  }
}
