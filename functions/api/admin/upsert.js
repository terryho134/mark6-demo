// upsert.js
function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizeNumbers(input) {
  if (Array.isArray(input)) return input.map((x) => parseInt(x, 10));
  if (typeof input === "string") {
    return input
      .split(/[\s,，]+/)
      .filter(Boolean)
      .map((x) => parseInt(x, 10));
  }
  return [];
}

function validate(nums, special) {
  if (!Array.isArray(nums) || nums.length !== 6) return "numbers must have 6 items";
  const set = new Set(nums);
  if (set.size !== 6) return "numbers must be unique";
  for (const n of nums) {
    if (!Number.isFinite(n) || n < 1 || n > 49) return "numbers must be 1-49";
  }
  if (!Number.isFinite(special) || special < 1 || special > 49) return "special must be 1-49";
  if (set.has(special)) return "special must not duplicate main numbers";
  return null;
}

function isYMD(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function upsertMeta(env, key, value, now) {
  return env.DB
    .prepare(
      `INSERT INTO meta (key, value, updatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
    )
    .bind(key, value, now)
    .run();
}

// ✅ Phase 2：成功寫入後 purge /api/latest 的 edge cache
async function purgeLatestCache(request) {
  try {
    const cache = caches.default;
    const origin = new URL(request.url).origin;

    // 必須同 Step 1 cacheKey 一致：GET + 無 query
    const key = new Request(origin + "/api/latest", { method: "GET" });
    await cache.delete(key);
    return true;
  } catch {
    // 唔好因為 purge 失敗而令 upsert 失敗
    return false;
  }
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const key = request.headers.get("X-Admin-Key") || "";
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json(401, { ok: false, error: "Unauthorized" });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const drawNo = String(body.drawNo || "").trim();
  const drawDate = String(body.drawDate || "").trim(); // YYYY-MM-DD
  const nums = normalizeNumbers(body.numbers).map((n) => Number(n)).sort((a, b) => a - b);
  const special = Number(parseInt(body.special, 10));

  // 下期資料（舊邏輯仍保留；你而家主力已經用 site_meta.nextDraw）
  const nextDrawDate = body.nextDrawDate ? String(body.nextDrawDate).trim() : null; // YYYY-MM-DD
  const nextDrawNo = body.nextDrawNo ? String(body.nextDrawNo).trim() : null;       // 例如 25/018
  const nextJackpotM =
    body.nextJackpotM !== null && body.nextJackpotM !== undefined
      ? Number(parseInt(body.nextJackpotM, 10))
      : null; // 百萬位

  if (!drawNo) return json(400, { ok: false, error: "drawNo required" });

  if (!/^\d{2}\/\d{3}$/.test(drawNo)) {
    return json(400, { ok: false, error: "drawNo must be like 25/018" });
  }

  if (!isYMD(drawDate)) return json(400, { ok: false, error: "drawDate must be YYYY-MM-DD" });

  const err = validate(nums, special);
  if (err) return json(400, { ok: false, error: err });

  if (nextDrawDate && !isYMD(nextDrawDate)) return json(400, { ok: false, error: "nextDrawDate must be YYYY-MM-DD" });

  if (nextDrawNo && !/^\d{2}\/\d{3}$/.test(nextDrawNo)) {
    return json(400, { ok: false, error: "nextDrawNo must be like 25/018" });
  }

  if (nextJackpotM !== null && (!Number.isFinite(nextJackpotM) || nextJackpotM < 0)) {
    return json(400, { ok: false, error: "nextJackpotM must be a non-negative integer (millions)" });
  }

  const year = parseInt(drawDate.slice(0, 4), 10);
  const now = new Date().toISOString();

  await env.DB
    .prepare(
      `
      INSERT INTO draws (drawNo, drawDate, numbers, special, year, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drawNo) DO UPDATE SET
        drawDate = excluded.drawDate,
        numbers = excluded.numbers,
        special = excluded.special,
        year = excluded.year,
        updatedAt = excluded.updatedAt
    `
    )
    .bind(drawNo, drawDate, JSON.stringify(nums), special, year, now, now)
    .run();

  // 寫入 meta（保留）
  if (nextDrawDate) await upsertMeta(env, "nextDrawDate", nextDrawDate, now);
  if (nextDrawNo) await upsertMeta(env, "nextDrawNo", nextDrawNo, now);
  if (nextJackpotM !== null) await upsertMeta(env, "nextJackpotM", String(nextJackpotM), now);

  // ✅ Phase 2：purge /api/latest edge cache
  const purged = await purgeLatestCache(request);

  return json(200, {
    ok: true,
    drawNo,
    drawDate,
    numbers: nums,
    special,
    nextDrawDate: nextDrawDate || null,
    nextDrawNo: nextDrawNo || null,
    nextJackpotM: nextJackpotM,
    updatedAt: now,
    cachePurged: purged,
  });
}
