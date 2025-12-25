export async function onRequest({ params, env }) {
  const year = parseInt(params.year, 10);
  if (!Number.isFinite(year) || year < 2002 || year > 2100) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid year" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const now = new Date().toISOString();
  const rows = await env.DB
    .prepare("SELECT drawNo, drawDate, numbers, special FROM draws WHERE year = ? ORDER BY drawDate DESC")
    .bind(year)
    .all();

  const draws = (rows.results || []).map((r) => ({
    drawNo: r.drawNo,
    drawDate: r.drawDate,
    numbers: JSON.parse(r.numbers),
    special: Number(r.special),
  }));

  return new Response(JSON.stringify({ source: "d1", year, updatedAt: now, draws }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
