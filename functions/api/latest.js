export async function onRequest({ env }) {
  const now = new Date().toISOString();

  const latestRow = await env.DB
    .prepare("SELECT drawNo, drawDate, numbers, special, updatedAt FROM draws ORDER BY drawDate DESC LIMIT 1")
    .first();

  const nextRow = await env.DB
    .prepare("SELECT value FROM meta WHERE key = 'nextDrawDate' LIMIT 1")
    .first();

  const draw = latestRow
    ? {
        drawNo: latestRow.drawNo,
        drawDate: latestRow.drawDate,
        numbers: JSON.parse(latestRow.numbers),
        special: Number(latestRow.special),
      }
    : null;

  const payload = {
    source: "d1",
    updatedAt: now,
    draw,
    nextDraw: {
      drawDate: nextRow?.value || null,
      note: "下期資料以官方公佈為準",
    },
    disclaimer: "本頁資料僅供參考，以官方公佈為準。",
  };

  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
