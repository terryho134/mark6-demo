export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit") || "10";
    let limit = parseInt(limitRaw, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 10;
    limit = Math.min(limit, 120); // 避免一次過太大!

    const q = `
      SELECT drawNo, drawDate, numbers, special
      FROM draws
      ORDER BY drawDate DESC
      LIMIT ?1
    `;

    const r = await env.DB.prepare(q).bind(limit).all();
    const rows = r?.results || [];

    const draws = rows.map(row => ({
      drawNo: row.drawNo,
      drawDate: row.drawDate,                 // YYYY-MM-DD
      numbers: JSON.parse(row.numbers || "[]"),
      extra: Number(row.special),
    }));

    return json(200, { ok: true, draws });
  } catch (e) {
    return json(500, { ok: false, error: e.message || String(e) });
  }
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
