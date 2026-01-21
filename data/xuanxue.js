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

  // ✅ NEW：按「時間段」派生 seed
  // mode: "minute" | "shichen"
  function deriveSeed(baseSeed, mode = "minute") {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const hh = now.getHours();
    const mm = now.getMinutes();

    if (mode === "shichen") {
      // 時辰：每2小時一段（子丑寅...）
      const idx = Math.floor((hh + 1) / 2) % 12;
      const key = `${y}-${m}-${d} shichen:${idx}`;
      return (baseSeed ^ toIntSeed(key)) >>> 0;
    }

    // minute：每分鐘一段
    const key = `${y}-${m}-${d} ${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
    return (baseSeed ^ toIntSeed(key)) >>> 0;
  }

  // ✅ NEW：reseed pack（唔改 weights/meta，只換 rng）
  function reseedPack(pack, seed) {
    if (!pack) return pack;
    const s = (seed >>> 0);
    return { ...pack, seed: s, rng: mulberry32(s) };
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

    // seed: stable per inputs + today（每日氣口）
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
      seed: (baseSeed >>> 0),
      rng: mulberry32(baseSeed >>> 0),
      weights: w,
      meta,
      forbiddenSet,
      lucky,
      inspiration,
      notes: {
        zodiacIsFolklore: true
      },
      ctx: {                // ✅ NEW: for human explanation
        pA, pB, blend,
        daySeed,
        engines: eng,
        strength
      }
    };
  }

  function weightedSampleWithoutReplacement(k, pack) {
    const { rng, weights, forbiddenSet } = pack;
    const picked = [];
    const used = new Set();

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

    const candidates = [];
    candidates.push({ mode:"single", m: clamp(Math.floor(targetSpend / 10), 3, 10), reason:"分散氣口：以多注單式為主" });
    candidates.push({ mode:"multi", n:7, m: clamp(Math.floor(targetSpend / 70) || 1, 1, 2), reason:"聚氣：以7碼複式集中主題" });

    if ((xuanxue.riskLevel === "high") && targetSpend >= 280) {
      candidates.push({ mode:"multi", n:8, m:1, reason:"進取聚焦：8碼複式（成本較高）" });
    }

    candidates.push({ mode:"danTuo", d:2, t:6, m:1, reason:"以小膽拖聚氣：2膽6拖（成本適中）" });
    candidates.push({ mode:"danTuo", d:3, t:5, m:1, reason:"以小膽拖聚氣：3膽5拖（成本適中）" });

    if (baseCap >= 440 && xuanxue.riskLevel === "high") {
      candidates.push({ mode:"full5dan", m:1, reason:"大包圍：5膽全餐（但仍低於$500）" });
    }

    let best = null;
    let bestScore = -Infinity;

    for (const c of candidates) {
      c.m = clamp(c.m || 1, 1, 10);
      const cost = costOfPlan(c);
      if (cost > targetSpend + 10) continue;

      c.m = clamp(c.m, 1, maxAllowedSets || 10);
      const cost2 = costOfPlan(c);
      if (cost2 <= 0) continue;

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

      const closeness = -Math.abs(targetSpend - cost2) / 40;
      const score = pref + closeness;

      if (score > bestScore) { bestScore = score; best = { ...c, cost: cost2, targetSpend }; }
    }

    if (!best) best = {
      mode:"single",
      m: clamp(Math.floor(targetSpend/10), 3, maxAllowedSets||10),
      cost: clamp(Math.floor(targetSpend/10),3,10)*10,
      targetSpend,
      reason:"保守分散：多注單式"
    };

    return best;
  }

  function recommendLuckContext(seed) {
    const dirs = ["東", "東南", "南", "西南", "西", "西北", "北", "東北"];
    const dir = dirs[seed % dirs.length];

    const a = (seed % 9) + 9;
    const b = ((seed >> 4) % 9) + 11;
    const t1 = `${String(a).padStart(2,"0")}:00–${String(a).padStart(2,"0")}:30`;
    const t2 = `${String(b).padStart(2,"0")}:30–${String(b+1).padStart(2,"0")}:00`;

    return {
      time: [t1, t2],
      direction: dir,
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

      if ((m.breakdown.wuxing || 0) >= 0.8) wux++;
      if ((m.breakdown.gua || 0) >= 0.8) gua++;
      if ((m.breakdown.star9 || 0) >= 0.8) star++;
      if ((m.breakdown.zodiac || 0) >= 0.8) zod++;
    }

    return { luckyHit, inspirationHit, forbiddenHit, wux, gua, star, zod };
  }

  function wuxingName(en) {
    return en === "water" ? "水" :
           en === "wood"  ? "木" :
           en === "fire"  ? "火" :
           en === "earth" ? "土" : "金";
  }
  
  function trigramName(idx) {
    // 8卦：0..7（純命名用，唔宣稱傳統對應）
    const arr = ["乾", "兌", "離", "震", "巽", "坎", "艮", "坤"];
    return arr[((idx % 8) + 8) % 8];
  }
  
  function zodiacName(idx) {
    // 以你現有 (yy-4)%12 算法：0 對應「鼠」係常見寫法
    const arr = ["鼠","牛","虎","兔","龍","蛇","馬","羊","猴","雞","狗","豬"];
    return arr[((idx % 12) + 12) % 12];
  }
  
  function calcWantedWuxing(profile) {
    const map = ["water","wood","fire","earth","metal"];
    const g = profile?.gender || "unspecified";
    const gCode = g === "male" ? 1 : g === "female" ? 2 : 0;
    const mm = profile?.dob?.month || 0;
    const dd = profile?.dob?.day || 0;
    return map[(mm + dd + gCode) % 5];
  }
  
  function calcGuaIdx(profile) {
    const mm = profile?.dob?.month || 0;
    const dd = profile?.dob?.day || 0;
    const yy = profile?.dob?.year ? (profile.dob.year % 8) : 0;
    return (dd + mm * 2 + yy) % 8;
  }
  
  function calcStarTargets(profile, daySeed) {
    const mm = profile?.dob?.month || 0;
    const dd = profile?.dob?.day || 0;
    const s1 = ((mm + dd + (daySeed % 9)) % 9) + 1;
    const s2 = ((dd + (daySeed % 7)) % 9) + 1;
    return [s1, s2];
  }
  
  function hasMeaningfulProfile(profile) {
    const dob = profile?.dob || null;
    const hasMD = !!(dob && Number(dob.month) > 0 && Number(dob.day) > 0);
    const hasY  = !!(dob && Number(dob.year) > 0);
    const hasGender = !!(profile && profile.gender && profile.gender !== "unspecified");
    return { hasMD, hasY, hasGender, hasAny: (hasMD || hasY || hasGender) };
  }
  
  function wuxingName(en) {
    return en === "water" ? "水" :
           en === "wood"  ? "木" :
           en === "fire"  ? "火" :
           en === "earth" ? "土" : "金";
  }
  function trigramName(idx) {
    const arr = ["乾", "兌", "離", "震", "巽", "坎", "艮", "坤"];
    return arr[((idx % 8) + 8) % 8];
  }
  function zodiacName(idx) {
    const arr = ["鼠","牛","虎","兔","龍","蛇","馬","羊","猴","雞","狗","豬"];
    return arr[((idx % 12) + 12) % 12];
  }
  
  // 下面 3 個計算保持你原本規則，只係用嚟「講得清楚」
  function calcWantedWuxing(profile) {
    const map = ["water","wood","fire","earth","metal"];
    const g = profile?.gender || "unspecified";
    const gCode = g === "male" ? 1 : g === "female" ? 2 : 0;
    const mm = profile?.dob?.month || 0;
    const dd = profile?.dob?.day || 0;
    return map[(mm + dd + gCode) % 5];
  }
  function calcGuaIdx(profile) {
    const mm = profile?.dob?.month || 0;
    const dd = profile?.dob?.day || 0;
    const yy = profile?.dob?.year ? (profile.dob.year % 8) : 0;
    return (dd + mm * 2 + yy) % 8;
  }
  function calcStarTargets(profile, daySeed) {
    const mm = profile?.dob?.month || 0;
    const dd = profile?.dob?.day || 0;
    const s1 = ((mm + dd + (daySeed % 9)) % 9) + 1;
    const s2 = ((dd + (daySeed % 7)) % 9) + 1;
    return [s1, s2];
  }
  
  function explainTicket(numsSorted, pack, explainLevel = "standard") {
    if (!pack || !pack.meta) return null;
  
    const ctx = pack.ctx || {};
    const pA = ctx.pA || null;
    const pB = ctx.pB || null;
    const daySeed = ctx.daySeed || 0;
    const eng = ctx.engines || { wuxing:true, gua:true, star9:true, zodiac:true };
  
    // 以 A 為主；有 B 就加一句「綜合A/B」
    const profile = pA || pB || { dob:null, gender:"unspecified" };
    const hasB = !!pB;
  
    // ✅ 自己判斷有冇真‧資料（避免冇輸入都講「你偏向xx」）
    const dob = profile?.dob || null;
    const hasGender = !!(profile?.gender && profile.gender !== "unspecified");
    const hasY = !!(dob && Number.isInteger(dob.year));
    const hasMD = !!(dob && Number.isInteger(dob.month) && Number.isInteger(dob.day));
    const hasAny = hasGender || hasY || hasMD;
    
    const info = { hasAny, hasMD, hasY };

    const wantedWux = calcWantedWuxing(profile);
    const wantedGua = calcGuaIdx(profile);
    const wantedStars = calcStarTargets(profile, daySeed);
  
    const lines = [];

    const FALLBACK_LINE =
      "隨緣位（藏象）｜此號未落入你而家設定嘅主象，但可作暗線，拉平整體氣勢";
  
    for (const n of numsSorted) {
      const m = pack.meta[n];
      if (!m) continue;
  
      const tags = m.tags || [];
      const bd = m.breakdown || {};
  
      const hitWux  = eng.wuxing && (bd.wuxing  || 0) >= 0.8;
      const hitGua  = eng.gua    && (bd.gua     || 0) >= 0.8;
      const hitStar = eng.star9  && (bd.star9   || 0) >= 0.8;
      const hitZod  = eng.zodiac && (bd.zodiac  || 0) >= 0.8;
  
      const hits = [];
      const reasons = [];
  
      // 幸運/靈感（最人話，先講）
      if (tags.includes("lucky")) {
        hits.push("幸運號碼");
        reasons.push("因為呢個號碼係你自己輸入嘅「幸運號碼」");
      }
      if (tags.includes("inspiration")) {
        hits.push("靈感號碼");
        reasons.push("因為呢個號碼係你自己輸入嘅「靈感號碼」");
      }
  
      // 五行：改成「有資料先講偏向；冇資料就講對照」
      if (hitWux) {
        const map = ["water","wood","fire","earth","metal"];
        const elem = map[n % 5];
        hits.push("五行");
  
        if (info.hasAny) {
          reasons.push(`按你提供嘅資料推演，主氣落在「${wuxingName(wantedWux)}」，而 ${nTxt} 對照屬「${wuxingName(elem)}」`);
        } else {
          reasons.push(`你未輸入生日/性別，所以五行只作「號碼對照」：${String(n).padStart(2,"0")} 屬「${wuxingName(elem)}」`);
        }
      }
  
      // 易卦：同樣處理（有資料先講你偏向邊卦）
      if (hitGua) {
        const idx = n % 8;
        hits.push("易卦");
  
        if (info.hasAny) {
          reasons.push(`按你提供嘅資料推演，卦象主調為「${trigramName(wantedGua)}」，而 ${nTxt} 對照落在「${trigramName(idx)}」`);
        } else {
          reasons.push(`你未輸入生日資料，所以易卦只作「號碼對照」：${String(n).padStart(2,"0")} 對照為「${trigramName(idx)}」`);
        }
      }
  
      // 九宮：就算冇生日，仍可以用「今日運勢」講（更合理）
      if (hitStar) {
        const star = (n % 9) + 1;
        hits.push("九宮");
  
        if (info.hasMD) {
          reasons.push(`按你生日（日/月）加上「今日運勢」推算，今日有利星位包括「${wantedStars[0]} / ${wantedStars[1]}」，而 ${String(n).padStart(2,"0")} 對應星位「${star}」`);
        } else {
          reasons.push(`你未輸入生日（日/月），九宮改用「今日運勢」推算：今日有利星位「${wantedStars[0]} / ${wantedStars[1]}」，而 ${String(n).padStart(2,"0")} 對應星位「${star}」`);
        }
      }
  
      // 生肖：需要年份，冇就唔講命中（你原本其實都唔會命中）
      if (eng.zodiac) {
        const yy = profile?.dob?.year;
        if (yy && hitZod) {
          const idx = (yy - 4) % 12;
          const r = n % 12;
          hits.push("生肖");
          reasons.push(`按你輸入出生年（民俗算法）推算生肖為「${zodiacName(idx)}」，而 ${String(n).padStart(2,"0")} 對照亦落在「${zodiacName(r)}」`);
        } else if (!yy && explainLevel === "detailed") {
          // detailed 才提一次，唔好煩
          reasons.push("生肖需要出生年份；你未提供年份，所以呢項唔作命中判斷");
        }
      }
  
      const nTxt = String(n).padStart(2, "0");
  
      if (!hits.length) {
        lines.push(`${nTxt}：${FALLBACK_LINE}`);
        continue;
      }
  
      const hitTxt = `對應象：${hits.join("、")}${hasB ? "（綜合A/B）" : ""}`;
  
      if (explainLevel === "compact") {
        lines.push(`${nTxt}：${hitTxt}`);
      } else {
        // 更人話：原因最多 1–2 句（detailed 先多一句）
        const maxWhy = explainLevel === "detailed" ? 3 : 2;
        const why = reasons.slice(0, maxWhy).join("；");
        lines.push(`${nTxt}：${hitTxt}｜解讀：${why}`);
      }
    }
  
    return { lines };
  }

  window.Xuanxue = {
    parseNumList,
    parseDob,
    buildWeights,
    weightedSampleWithoutReplacement,
    recommendPlan,
    recommendLuckContext,
    explainXuanxueHit,

    // ✅ new exports
    deriveSeed,
    reseedPack,
    explainTicket,

    PRICE_PER_BET,
  };
})();
