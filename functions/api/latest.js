async function getMeta(env, key) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ? LIMIT 1").bind(key).first();
  return row?.value ?? null;
}

export async function onRequest({ env }) {
  const now = new Date().toISOString();

  const latestRow = await env.DB
    .prepare("SELECT drawNo, drawDate, numbers, special, updatedAt FROM draws ORDER BY drawDate DESC LIMIT 1")
    .first();

  const nextDrawDate = await getMeta(env, "nextDrawDate");
  const nextDrawNo = await getMeta(env, "nextDrawNo");
  const nextJackpotM = await getMeta(env, "nextJackpotM"); // 百萬位（文字）

  const draw = latestRow
    ? {
        drawNo: latestRow.drawNo,
        drawDate: latestRow.drawDate,
        numbers: JSON.parse(latestRow.numbers),
        special: Number(latestRow.special),
      }
    : null;

  const jackpotM = nextJackpotM !== null ? parseInt(nextJackpotM, 10) : null;
  const jackpotAmount = Number.isFinite(jackpotM) ? jackpotM * 1_000_000 : null;

  const payload = {
    source: "d1",
    updatedAt: now,
    draw,
    nextDraw: {
      drawNo: nextDrawNo,
      drawDate: nextDrawDate,
      jackpotMillion: Number.isFinite(jackpotM) ? jackpotM : null,
      jackpotAmount: jackpotAmount,
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
