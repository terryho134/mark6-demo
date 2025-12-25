function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const limit = clamp(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1, 500);

  const now = new Date().toISOString();
  const rows = await env.DB
    .prepare("SELECT drawNo, drawDate, numbers, special FROM draws ORDER BY drawDate DESC LIMIT ?")
    .bind(limit)
    .all();

  const draws = (rows.results || []).map((r) => ({
    drawNo: r.drawNo,
    drawDate: r.drawDate,
    numbers: JSON.parse(r.numbers),
    special: Number(r.special),
  }));

  return new Response(JSON.stringify({ source: "d1", updatedAt: now, draws }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
