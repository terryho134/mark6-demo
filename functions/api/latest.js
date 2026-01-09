async function getMeta(env, key) {
  const row = await env.DB
    .prepare("SELECT value FROM meta WHERE key = ? LIMIT 1")
    .bind(key)
    .first();
  return row?.value ?? null;
}

// 新：讀 site_meta 的 nextDraw（JSON）
// 如果 site_meta 表未存在 / key 未寫入，會安全 fallback
async function getNextDrawFromSiteMeta(env) {
  try {
    const row = await env.DB
      .prepare("SELECT value, updatedAt FROM site_meta WHERE key = 'nextDraw' LIMIT 1")
      .first();

    if (!row?.value) return { next: null, updatedAt: null };

    let obj = null;
    try {
      obj = JSON.parse(row.value);
    } catch {
      obj = null;
    }
    if (!obj || typeof obj !== "object") return { next: null, updatedAt: row.updatedAt ?? null };

    // 兼容：jackpotM（新）/ jackpotMillion（舊）
    const jackpotM =
      Number.isFinite(Number(obj.jackpotM)) ? parseInt(obj.jackpotM, 10) :
      Number.isFinite(Number(obj.jackpotMillion)) ? parseInt(obj.jackpotMillion, 10) :
      null;

    const next = {
      drawNo: obj.drawNo ?? null,
      drawDate: obj.drawDate ?? null,
      jackpotM: Number.isFinite(jackpotM) ? jackpotM : null,
    };

    // 如果三個都無，就當無資料
    if (!next.drawNo && !next.drawDate && next.jackpotM === null) {
      return { next: null, updatedAt: row.updatedAt ?? null };
    }

    return { next, updatedAt: row.updatedAt ?? null };
  } catch (e) {
    // 最常見：site_meta 表未建立 / 欄位不同
    return { next: null, updatedAt: null };
  }
}

function parseNumbersField(s) {
  // numbers 欄理論上係 JSON array string，例如 "[1,2,3,4,5,6]"
  // 但做個容錯：萬一係 "1 2 3 4 5 6" 都盡量 parse 到
  if (s == null) return [];
  if (Array.isArray(s)) return s.map(Number).filter(n => Number.isFinite(n));

  const str = String(s).trim();
  if (!str) return [];

  try {
    const j = JSON.parse(str);
    if (Array.isArray(j)) return j.map(Number).filter(n => Number.isFinite(n));
  } catch {}

  // fallback: split by non-digit
  return str
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(x => parseInt(x, 10))
    .filter(n => Number.isFinite(n));
}

export async function onRequest({ env }) {
  const now = new Date().toISOString();

  // ✅ 最新一期：draws 表（照舊，但加 drawNo 作 tie-break）
  const latestRow = await env.DB
    .prepare(
      "SELECT drawNo, drawDate, numbers, special, updatedAt FROM draws ORDER BY drawDate DESC, drawNo DESC LIMIT 1"
    )
    .first();

  const draw = latestRow
    ? {
        drawNo: latestRow.drawNo,
        drawDate: latestRow.drawDate,
        numbers: parseNumbersField(latestRow.numbers),
        special: Number(latestRow.special),
      }
    : null;

  // ✅ 下期資料：優先讀 site_meta.nextDraw（新），否則 fallback meta 三 key（舊）
  const { next: nextFromSiteMeta } = await getNextDrawFromSiteMeta(env);

  let nextDrawNo = null;
  let nextDrawDate = null;
  let jackpotM = null;

  if (nextFromSiteMeta) {
    nextDrawNo = nextFromSiteMeta.drawNo ?? null;
    nextDrawDate = nextFromSiteMeta.drawDate ?? null;
    jackpotM = Number.isFinite(nextFromSiteMeta.jackpotM) ? nextFromSiteMeta.jackpotM : null;
  } else {
    // 舊 meta
    nextDrawDate = await getMeta(env, "nextDrawDate");
    nextDrawNo = await getMeta(env, "nextDrawNo");
    const nextJackpotM = await getMeta(env, "nextJackpotM"); // 百萬位（文字）
    jackpotM = nextJackpotM !== null ? parseInt(nextJackpotM, 10) : null;
    jackpotM = Number.isFinite(jackpotM) ? jackpotM : null;
  }

  const jackpotAmount = Number.isFinite(jackpotM) ? jackpotM * 1_000_000 : null;

  const payload = {
    source: "d1",
    // 保持你原本寫法：用 now 作 updatedAt（避免同時要 reconcile 多個 updatedAt）
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
