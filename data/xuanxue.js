// data/xuanxue.js
(() => {
  const PRICE_PER_BET = 10;

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function toIntSeed(s) {
    // simple string hash -> uint32
    let h = 2166136261;
    const str = String(s || "");
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parseNumList(input, maxLen) {
    if (!input) return [];
    const parts = String(input).split(/[\s,，;]+/).filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 1 || n > 49) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      if (out.length >= maxLen) break;
    }
    return out;
  }

  function buildForbiddenSet({ forbidden = [], excludeTail4 = false }) {
    const s = new Set(forbidden);
    if (excludeTail4) [4, 14, 24, 34, 44].forEach(n => s.add(n));
    return s;
  }

  function parseDob(dobPrec, dobStr) {
    // returns { year?, month, day } or null
    if (!dobPrec || dobPrec === "NONE") return null;
    const s = String(dobStr || "").trim();
    if (!s) return null;

    if (dobPrec === "MD") {
      // MM-DD
      const m = s.match(/^(\d{1,2})\D+(\d{1,2})$/);
      if (!m) return null;
      const mm = Number(m[1]), dd = Number(m[2]);
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
      return { month: mm, day: dd, year: null };
    }

    if (dobPrec === "YMD") {
      const m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})$/);
      if (!m) return null;
      const yy = Number(m[1]), mm = Number(m[2]), dd = Number(m[3]);
      if (yy < 1900 || yy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
      return { year: yy, month: mm, day: dd };
    }

    return null;
  }

  function normalize(arr) {
    // arr[1..49] -> 0..1
    let min = Infinity, max = -Infinity;
    for (let i = 1; i <= 49; i++) {
      const v = arr[i];
      if (!isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const out = Array(50).fill(0);
    const span = (max - min) || 1;
    for (let i = 1; i <= 49; i++) {
      const v = arr[i];
      if (!isFinite(v)) { out[i] = 0; continue; }
      out[i] = (v - min) / span;
    }
    return out;
  }

  // --- Four engines (lightweight heuristics, non-claim, explainable) ---
  function scoreWuxing(profile, n) {
    // element by n%5: 0水 1木 2火 3土 4金
    const map = ["water", "wood", "fire", "earth", "metal"];
    const elem = map[n % 5];

    const g = profile?.gender || "unspecified";
    const gCode = g === "male" ? 1 : g === "female" ? 2 : 0;

    const mm = profile?.dob?.month || 0;
    const dd = profile?.dob?.day || 0;
    const wanted = map[(mm + dd + gCode) % 5];

    return elem === wanted ? 1 : 0.25;
  }

  function scoreGua(profile, n) {
    // trigram-ish index 0..7
    const mm = profile?.dob?.month || 0;
    const dd = profile?.dob?.day || 0;
    const yy = profile?.dob?.year ? (profile.dob.year % 8) : 0;
    const idx = (dd + mm * 2 + yy) % 8;
    return (n % 8) === idx ? 1 : 0.2;
  }

  function scoreStar9(profile, n, daySeed) {
    // Lo Shu 1..9
    const star = (n % 9) + 1;
    const mm = profile?.dob?.month || 0;
    const dd = profile?.dob?.day || 0;
    const s1 = ((mm + dd + (daySeed % 9)) % 9) + 1;
    const s2 = ((dd + (daySeed % 7)) % 9) + 1;
    if (star === s1 || star === s2) return 1;
    return 0.25;
  }

  function scoreZodiac(profile, n) {
    // 民俗：用年份推生肖 index（非馬會當年生肖碼表）
    const yy = profile?.dob?.year;
    if (!yy) return 0.35;
    const idx = (yy - 4) % 12; // 2008鼠，簡化
    const r = n % 12;
    return r === idx ? 1 : 0.25;
  }

  function buildWeights(xuanxue, statsPack) {
    const strength = xuanxue.strength || "medium";
    const tempMap = { light: 1.35, medium: 1.0, strong: 0.8 };
    const temp = tempMap[strength] || 1.0;

    const lucky = parseNumList(xuanxue.lucky, 6);
    const inspiration = parseNumList(xuanxue.inspiration, 6);
    const forbidden = parseNumList(xuanxue.forbidden, 10);
    const forbiddenSet = buildForbiddenSet({ forbidden, excludeTail4: !!xuanxue.excludeTail4 });

    // profiles A/B
    const pA = {
      dob: parseDob(xuanxue.dobPrecA, xuanxue.dobA),
      gender: xuanxue.genderA || "unspecified",
    };
    const pBEnabled = !!xuanxue.enableB;
    const pB = pBEnabled ? {
      dob: parseDob(xuanxue.dobPrecB, xuanxue.dobB),
      gender: xuanxue.genderB || "unspecified",
    } : null;

    const blend = clamp(Number(xuanxue.blend || 0.5), 0, 1);

    // seed: stable per inputs + today (so每日氣口有少少變化，但可解釋)
    const dayKey = new Date();
    const daySeed = toIntSeed(`${dayKey.getFullYear()}-${dayKey.getMonth()+1}-${dayKey.getDate()}`);
    const baseSeed = toIntSeed(JSON.stringify({
      pA, pB, blend, lucky, inspiration, forbidden: Array.from(forbiddenSet),
      engines: xuanxue.engines,
      strength
    })) ^ daySeed;

    const meta = Array(50).fill(null).map(() => ({
      tags: [],
      breakdown: { wuxing:0, gua:0, star9:0, zodiac:0, luckyBonus:0, inspirationBonus:0, statsHint:0 }
    }));

    const raw = Array(50).fill(0);

    const eng = xuanxue.engines || { wuxing:true, gua:true, star9:true, zodiac:true };

    function scoreProfile(profile, n) {
      let s = 0;
      if (eng.wuxing) { const v = scoreWuxing(profile, n); s += v; meta[n].breakdown.wuxing += v; }
      if (eng.gua)    { const v = scoreGua(profile, n);    s += v; meta[n].breakdown.gua    += v; }
      if (eng.star9)  { const v = scoreStar9(profile, n, daySeed); s += v; meta[n].breakdown.star9 += v; }
      if (eng.zodiac) { const v = scoreZodiac(profile, n); s += v; meta[n].breakdown.zodiac += v; }
      return s;
    }

    for (let n = 1; n <= 49; n++) {
      if (forbiddenSet.has(n)) {
        raw[n] = -Infinity;
        meta[n].tags.push("forbidden");
        continue;
      }

      const sA = scoreProfile(pA, n);
      const sB = pB ? scoreProfile(pB, n) : sA;
      const fused = pB ? (sA * blend + sB * (1 - blend)) : sA;

      raw[n] += fused;

      // Optional: gentle stats hint (not a constraint)
      if (statsPack && statsPack.freqMap) {
        const c = statsPack.freqMap.get(n) || 0;
        const hint = c > 0 ? Math.log(1 + c) * 0.05 : 0;
        raw[n] += hint;
        meta[n].breakdown.statsHint += hint;
      }
    }

    lucky.forEach(n => {
      if (!forbiddenSet.has(n)) {
        raw[n] += 1.6;
        meta[n].breakdown.luckyBonus += 1.6;
        meta[n].tags.push("lucky");
      }
    });

    inspiration.forEach(n => {
      if (!forbiddenSet.has(n)) {
        raw[n] += 0.9;
        meta[n].breakdown.inspirationBonus += 0.9;
        meta[n].tags.push("inspiration");
      }
    });

    // normalize + softmax-ish
    const norm = normalize(raw);
    const w = Array(50).fill(0);
    let sum = 0;
    for (let n = 1; n <= 49; n++) {
      if (!isFinite(raw[n])) { w[n] = 0; continue; }
      const v = Math.exp(norm[n] / temp);
      w[n] = v; sum += v;
    }
    if (sum > 0) for (let n = 1; n <= 49; n++) w[n] /= sum;

    // mix a bit uniform so唔會「死押」幾粒
    const mixMap = { light: 0.15, medium: 0.10, strong: 0.06 };
    const mix = mixMap[strength] ?? 0.10;
    const available = 49 - forbiddenSet.size;
    if (available > 0) {
      const uni = 1 / available;
      for (let n = 1; n <= 49; n++) {
        if (forbiddenSet.has(n)) continue;
        w[n] = (1 - mix) * w[n] + mix * uni;
      }
    }

    return {
      ok: true,
      seed: baseSeed >>> 0,
      rng: mulberry32(baseSeed >>> 0),
      weights: w,
      meta,
      forbiddenSet,
      lucky,
      inspiration,
      notes: {
        zodiacIsFolklore: true
      }
    };
  }

  function weightedSampleWithoutReplacement(k, pack) {
    const { rng, weights, forbiddenSet } = pack;
    const picked = [];
    const used = new Set();

    // build cumulative on the fly each draw (49 is small, OK)
    while (picked.length < k) {
      let r = rng();
      let acc = 0;
      let chosen = null;
      for (let n = 1; n <= 49; n++) {
        if (forbiddenSet && forbiddenSet.has(n)) continue;
        if (used.has(n)) continue;
        const w = weights[n] || 0;
        acc += w;
        if (r <= acc) { chosen = n; break; }
      }
      if (chosen == null) {
        // fallback: first available
        for (let n = 1; n <= 49; n++) {
          if (forbiddenSet && forbiddenSet.has(n)) continue;
          if (!used.has(n)) { chosen = n; break; }
        }
      }
      if (chosen == null) break;
      used.add(chosen);
      picked.push(chosen);
    }
    picked.sort((a,b)=>a-b);
    return picked;
  }

  function costOfPlan(plan) {
    if (!plan) return 0;
    if (plan.mode === "single") return plan.m * 10;

    if (plan.mode === "multi") {
      const n = plan.n;
      const bets = n >= 6 ? comb(n, 6) : 0;
      return plan.m * bets * 10;
    }

    if (plan.mode === "danTuo") {
      const need = 6 - plan.d;
      const bets = (plan.t >= need) ? comb(plan.t, need) : 0;
      return plan.m * bets * 10;
    }

    if (plan.mode === "full5dan") return plan.m * 44 * 10;

    return 0;
  }

  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let num = 1, den = 1;
    for (let i = 1; i <= k; i++) {
      num *= (n - (k - i));
      den *= i;
    }
    return Math.round(num / den);
  }

  function recommendPlan(xuanxue, maxAllowedSets) {
    const maxBudget = Number(xuanxue.maxBudget || 500);
    const baseCap = Math.min(maxBudget, 500);

    const ratioMap = { low: 0.25, medium: 0.35, high: 0.45 };
    const ratio = ratioMap[xuanxue.riskLevel || "medium"] ?? 0.35;

    // 只用上限的一部份（唔填爆）
    let targetSpend = Math.round((baseCap * ratio) / 10) * 10;
    targetSpend = clamp(targetSpend, 60, 280);

    const hasAnyDob =
      (xuanxue.dobPrecA && xuanxue.dobPrecA !== "NONE" && String(xuanxue.dobA||"").trim()) ||
      (xuanxue.enableB && xuanxue.dobPrecB && xuanxue.dobPrecB !== "NONE" && String(xuanxue.dobB||"").trim());

    const luckyCnt = parseNumList(xuanxue.lucky, 6).length;
    const inspCnt = parseNumList(xuanxue.inspiration, 6).length;
    const focusScore = (hasAnyDob ? 2 : 0) + luckyCnt * 2 + inspCnt;

    // 候選 plans（都偏保守金額）
    const candidates = [];

    // A) 多注單式（分散）
    candidates.push({ mode:"single", m: clamp(Math.floor(targetSpend / 10), 3, 10), reason:"分散氣口：以多注單式為主" });

    // B) 7碼複式（聚焦、成本可控）
    candidates.push({ mode:"multi", n:7, m: clamp(Math.floor(targetSpend / 70) || 1, 1, 2), reason:"聚氣：以7碼複式集中主題" });

    // C) 8碼複式（只在預算較高 & 進取先考慮）
    if ((xuanxue.riskLevel === "high") && targetSpend >= 280) {
      candidates.push({ mode:"multi", n:8, m:1, reason:"進取聚焦：8碼複式（成本較高）" });
    }

    // D) 小膽拖（成本好壓、易解釋）
    candidates.push({ mode:"danTuo", d:2, t:6, m:1, reason:"以小膽拖聚氣：2膽6拖（成本適中）" });
    candidates.push({ mode:"danTuo", d:3, t:5, m:1, reason:"以小膽拖聚氣：3膽5拖（成本適中）" });

    // E) 5膽全餐（$440）— 只在用戶真係想「大包圍」先會推
    if (baseCap >= 440 && xuanxue.riskLevel === "high") {
      candidates.push({ mode:"full5dan", m:1, reason:"大包圍：5膽全餐（但仍低於$500）" });
    }

    // 選一個「符合 focus」又最貼 targetSpend 的
    let best = null;
    let bestScore = -Infinity;

    for (const c of candidates) {
      c.m = clamp(c.m || 1, 1, 10);
      const cost = costOfPlan(c);

      // 不可超 targetSpend 太多（最多+10作容差）
      if (cost > targetSpend + 10) continue;

      // cap sets by strict level (maxAllowedSets)
      c.m = clamp(c.m, 1, maxAllowedSets || 10);

      const cost2 = costOfPlan(c);
      if (cost2 <= 0) continue;

      // focus preference
      let pref = 0;
      if (focusScore >= 4) {
        if (c.mode === "multi") pref += 2.0;
        if (c.mode === "danTuo") pref += 1.0;
      } else if (focusScore >= 2) {
        if (c.mode === "danTuo") pref += 1.5;
        if (c.mode === "multi") pref += 1.0;
      } else {
        if (c.mode === "single") pref += 1.2;
      }

      // closeness to target
      const closeness = -Math.abs(targetSpend - cost2) / 40;

      const score = pref + closeness;
      if (score > bestScore) { bestScore = score; best = { ...c, cost: cost2, targetSpend }; }
    }

    // fallback
    if (!best) best = { mode:"single", m: clamp(Math.floor(targetSpend/10), 3, maxAllowedSets||10), cost: clamp(Math.floor(targetSpend/10),3,10)*10, targetSpend, reason:"保守分散：多注單式" };

    return best;
  }

  function recommendLuckContext(seed) {
    const dirs = ["東", "東南", "南", "西南", "西", "西北", "北", "東北"];
    const dir = dirs[seed % dirs.length];

    // 兩個 30分鐘 window（以 seed 推）
    const a = (seed % 9) + 9;    // 09:00 - 17:00 range
    const b = ((seed >> 4) % 9) + 11;
    const t1 = `${String(a).padStart(2,"0")}:00–${String(a).padStart(2,"0")}:30`;
    const t2 = `${String(b).padStart(2,"0")}:30–${String(b+1).padStart(2,"0")}:00`;

    return {
      time: [t1, t2],
      direction: dir,
      // 考慮手機下注：以「渠道」為主；實體投注站只給「類型」而非亂點名
      channel: "手機／網上投注（較順氣：坐定、面向建議方位即可）",
      shopHint: `如要去實體投注站：建議揀「向${dir}方向行過去」第一間、且人流較少的投注站（以免心浮氣亂）。`
    };
  }

  function explainXuanxueHit(numsSorted, pack) {
    if (!pack || !pack.meta) return null;
    let luckyHit = 0, inspirationHit = 0, forbiddenHit = 0;
    let wux=0, gua=0, star=0, zod=0;

    for (const n of numsSorted) {
      const m = pack.meta[n];
      if (!m) continue;
      if (m.tags.includes("forbidden")) forbiddenHit++;
      if (m.tags.includes("lucky")) luckyHit++;
      if (m.tags.includes("inspiration")) inspirationHit++;

      // breakdown（大於0.8 視為「命中」）
      if ((m.breakdown.wuxing || 0) >= 0.8) wux++;
      if ((m.breakdown.gua || 0) >= 0.8) gua++;
      if ((m.breakdown.star9 || 0) >= 0.8) star++;
      if ((m.breakdown.zodiac || 0) >= 0.8) zod++;
    }

    return { luckyHit, inspirationHit, forbiddenHit, wux, gua, star, zod };
  }

  window.Xuanxue = {
    parseNumList,
    parseDob,
    buildWeights,
    weightedSampleWithoutReplacement,
    recommendPlan,
    recommendLuckContext,
    explainXuanxueHit,
    PRICE_PER_BET,
  };
})();
