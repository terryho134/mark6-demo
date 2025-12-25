function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const FIXED_PRIZE = {
  div4: 9600,
  div5: 640,
  div6: 320,
  div7: 40,
};

function toInt(n) {
  const x = parseInt(String(n), 10);
  return Number.isFinite(x) ? x : NaN;
}

function uniqSorted(arr) {
  const s = new Set();
  for (const x of arr) {
    const n = toInt(x);
    if (Number.isFinite(n)) s.add(n);
  }
  return Array.from(s).sort((a, b) => a - b);
}

function isYYXXX(s) {
  return typeof s === "string" && /^\d{2}\/\d{3}$/.test(s.trim());
}

function isYMD(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

// nCk as Number (safe for our range)
function choose(n, k) {
  n = Number(n); k = Number(k);
  if (!Number.isFinite(n) || !Number.isFinite(k)) return 0;
  if (k < 0 || n < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) {
    r = (r * (n - (k - i))) / i;
  }
  // should be integer
  return Math.round(r);
}

function intersectionCount(aSet, arr) {
  let c = 0;
  for (const n of arr) if (aSet.has(n)) c++;
  return c;
}

function contains(aSet, n) {
  return aSet.has(n);
}

function calcSingleUnits(pickSet, winSet, extra) {
  const m = intersectionCount(winSet, Array.from(pickSet));
  const e = contains(pickSet, extra) ? 1 : 0;

  const units = { div1: 0, div2: 0, div3: 0, div4: 0, div5: 0, div6: 0, div7: 0 };
  if (m === 6) units.div1 = 1;
  else if (m === 5 && e === 1) units.div2 = 1;
  else if (m === 5) units.div3 = 1;
  else if (m === 4 && e === 1) units.div4 = 1;
  else if (m === 4) units.div5 = 1;
  else if (m === 3 && e === 1) units.div6 = 1;
  else if (m === 3) units.div7 = 1;

  return { units, chances: 1 };
}

function calcMultipleUnits(picksArr, winArr, extra) {
  const pickSet = new Set(picksArr);
  const winSet = new Set(winArr);

  const x = intersectionCount(winSet, picksArr);          // picked winning numbers
  const y = pickSet.has(extra) ? 1 : 0;                   // picked extra?
  const z = picksArr.length - x - y;                      // other numbers

  // units per division (combinatorial)
  const div1 = choose(x, 6);
  const div2 = y * choose(x, 5);
  const div3 = choose(x, 5) * choose(z, 1);
  const div4 = y * choose(x, 4) * choose(z, 1);
  const div5 = choose(x, 4) * choose(z, 2);
  const div6 = y * choose(x, 3) * choose(z, 2);
  const div7 = choose(x, 3) * choose(z, 3);

  const chances = choose(picksArr.length, 6);

  return {
    units: { div1, div2, div3, div4, div5, div6, div7 },
    chances,
  };
}

function calcBankerUnits(bankersArr, legsArr, winArr, extra) {
  const bankers = new Set(bankersArr);
  const legs = new Set(legsArr);
  const winSet = new Set(winArr);

  const b = bankers.size;
  const L = legs.size;
  const t = 6 - b; // number selected from legs in each chance

  // counts in bankers
  const bw = intersectionCount(winSet, Array.from(bankers)); // bankers that are winning numbers
  const be = bankers.has(extra) ? 1 : 0;

  // counts in legs
  const lw = intersectionCount(winSet, Array.from(legs));
  const le = legs.has(extra) ? 1 : 0;
  const lo = L - lw - le;

  const chances = choose(L, t);

  const units = { div1: 0, div2: 0, div3: 0, div4: 0, div5: 0, div6: 0, div7: 0 };

  // sum over selecting k winning legs, u extra leg (0/1), r other legs
  // constraint: k + u + r = t
  for (let k = 0; k <= Math.min(lw, t); k++) {
    for (let u = 0; u <= Math.min(le, t - k); u++) {
      const r = t - k - u;
      if (r < 0 || r > lo) continue;

      const m = bw + k;                 // total winning matches in the 6-number chance
      const e = be ? 1 : u;             // extra included?

      const ways = choose(lw, k) * choose(le, u) * choose(lo, r);

      if (m === 6) units.div1 += ways;                 // extra must be 0 automatically (otherwise m can't be 6)
      else if (m === 5 && e === 1) units.div2 += ways;
      else if (m === 5 && e === 0) units.div3 += ways;
      else if (m === 4 && e === 1) units.div4 += ways;
      else if (m === 4 && e === 0) units.div5 += ways;
      else if (m === 3 && e === 1) units.div6 += ways;
      else if (m === 3 && e === 0) units.div7 += ways;
    }
  }

  return { units, chances };
}

function calcFixedAmount(units, stakeRatio) {
  const mult = stakeRatio; // 1 or 0.5
  const div4 = units.div4 * FIXED_PRIZE.div4 * mult;
  const div5 = units.div5 * FIXED_PRIZE.div5 * mult;
  const div6 = units.div6 * FIXED_PRIZE.div6 * mult;
  const div7 = units.div7 * FIXED_PRIZE.div7 * mult;
  return {
    div4,
    div5,
    div6,
    div7,
    totalFixed: div4 + div5 + div6 + div7,
  };
}

function summarizeUnits(units) {
  const out = [];
  const map = [
    ["div1", "頭獎"],
    ["div2", "二獎"],
    ["div3", "三獎"],
    ["div4", "四獎"],
    ["div5", "五獎"],
    ["div6", "六獎"],
    ["div7", "七獎"],
  ];
  for (const [k, name] of map) {
    const v = units[k] || 0;
    if (v > 0) out.push({ division: k, name, units: v });
  }
  return out;
}

async function getDrawByNo(env, drawNo) {
  return env.DB.prepare("SELECT drawNo, drawDate, numbers, special FROM draws WHERE drawNo = ? LIMIT 1")
    .bind(drawNo)
    .first();
}

async function getDrawByDate(env, drawDate) {
  return env.DB.prepare("SELECT drawNo, drawDate, numbers, special FROM draws WHERE drawDate = ? LIMIT 1")
    .bind(drawDate)
    .first();
}

async function getLatestDraw(env) {
  return env.DB.prepare("SELECT drawNo, drawDate, numbers, special FROM draws ORDER BY drawDate DESC LIMIT 1").first();
}

async function getDrawsSince(env, fromDate) {
  return env.DB.prepare(
    "SELECT drawNo, drawDate, numbers, special FROM draws WHERE drawDate >= ? ORDER BY drawDate DESC"
  ).bind(fromDate).all();
}

function normalizeTicket(body) {
  const type = String(body.type || "").trim(); // single|multiple|banker
  const half = !!body.half; // half stake?
  const stakeRatio = half ? 0.5 : 1;
  const unitStake = half ? 5 : 10;

  if (!["single", "multiple", "banker"].includes(type)) {
    return { error: "type must be single|multiple|banker" };
  }

  if (type === "banker") {
    const bankers = uniqSorted(body.bankers || []);
    const legs = uniqSorted(body.legs || []);
    // disallow overlap
    for (const b of bankers) if (legs.includes(b)) return { error: "bankers and legs must not overlap" };
    if (bankers.length < 1 || bankers.length > 5) return { error: "bankers count must be 1-5" };
    if (bankers.length + legs.length < 7) return { error: "banker total numbers must be >= 7" };
    if (legs.length < (6 - bankers.length)) return { error: "legs not enough to form a 6-number chance" };
    // range check
    for (const n of [...bankers, ...legs]) if (n < 1 || n > 49) return { error: "numbers must be 1-49" };

    return { type, half, stakeRatio, unitStake, bankers, legs };
  } else {
    const picks = uniqSorted(body.picks || []);
    for (const n of picks) if (n < 1 || n > 49) return { error: "numbers must be 1-49" };
    if (type === "single" && picks.length !== 6) return { error: "single must have exactly 6 numbers" };
    if (type === "multiple" && picks.length < 7) return { error: "multiple must have at least 7 numbers" };
    return { type, half, stakeRatio, unitStake, picks };
  }
}

function computeForDraw(ticket, drawRow) {
  const winArr = JSON.parse(drawRow.numbers);
  const extra = Number(drawRow.special);

  let calc;
  if (ticket.type === "single") {
    calc = calcSingleUnits(new Set(ticket.picks), new Set(winArr), extra);
  } else if (ticket.type === "multiple") {
    calc = calcMultipleUnits(ticket.picks, winArr, extra);
  } else {
    calc = calcBankerUnits(ticket.bankers, ticket.legs, winArr, extra);
  }

  const fixed = calcFixedAmount(calc.units, ticket.stakeRatio);

  // total stake
  const totalStake = calc.chances * ticket.unitStake;

  const summary = summarizeUnits(calc.units);

  // If div1-3 hit, we only show text (no amounts)
  const hasTop = (calc.units.div1 + calc.units.div2 + calc.units.div3) > 0;

  return {
    draw: {
      drawNo: drawRow.drawNo,
      drawDate: drawRow.drawDate,
      numbers: winArr,
      extra,
    },
    ticket: {
      type: ticket.type,
      half: ticket.half,
      chances: calc.chances,
      unitStake: ticket.unitStake,
      totalStake,
    },
    result: {
      units: calc.units,
      summary,              // non-zero divisions
      fixedAmount: fixed,   // div4-7 + totalFixed
      topPrizeNote: hasTop ? "頭/二/三獎派彩屬浮動（以官方該期 Unit Prize 為準）" : null,
    }
  };
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { ok: false, error: "Invalid JSON body" }); }

  const ticket = normalizeTicket(body);
  if (ticket.error) return json(400, { ok: false, error: ticket.error });

  const drawNo = body.drawNo ? String(body.drawNo).trim() : null;
  const drawDate = body.drawDate ? String(body.drawDate).trim() : null;

  if (drawNo && !isYYXXX(drawNo)) return json(400, { ok: false, error: "drawNo must be YY/XXX e.g. 25/018" });
  if (drawDate && !isYMD(drawDate)) return json(400, { ok: false, error: "drawDate must be YYYY-MM-DD" });

  // decide which draw to check
  let targetDraw = null;

  if (drawNo) targetDraw = await getDrawByNo(env, drawNo);
  else if (drawDate) targetDraw = await getDrawByDate(env, drawDate);
  else targetDraw = await getLatestDraw(env);

  if (!targetDraw) return json(404, { ok: false, error: "draw not found" });

  const main = computeForDraw(ticket, targetDraw);

  // If user did NOT specify drawNo/drawDate, also check last 60 days and return only winning draws
  let recentWins = [];
  if (!drawNo && !drawDate) {
    const now = new Date();
    const from = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const fromYMD = from.toISOString().slice(0, 10);

    const rows = await getDrawsSince(env, fromYMD);
    const list = rows?.results || [];

    for (const row of list) {
      // skip the latest draw already shown? (optional) — keep it simple: include if it wins and is not the main draw
      if (row.drawNo === main.draw.drawNo) continue;

      const r = computeForDraw(ticket, row);
      const hasAny =
        (r.result.units.div1 + r.result.units.div2 + r.result.units.div3 +
         r.result.units.div4 + r.result.units.div5 + r.result.units.div6 + r.result.units.div7) > 0;

      if (hasAny) {
        // keep a lighter payload for recent list
        recentWins.push({
          drawNo: r.draw.drawNo,
          drawDate: r.draw.drawDate,
          summary: r.result.summary,
          fixedTotal: r.result.fixedAmount.totalFixed,
          topPrizeNote: r.result.topPrizeNote,
        });
      }
    }
  }

  return json(200, {
    ok: true,
    query: { drawNo: drawNo || null, drawDate: drawDate || null },
    main,
    recentWins,
    disclaimer: "本工具僅供參考；派彩與結果以官方公佈為準。",
  });
}
