// data/xuanxue.js
(() => {
  console.log("[XX] xuanxue.js start");
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
  
    const goal = xuanxue.goal || "hit"; // hit / boom / steady
  
    // 只用上限的一部份（唔填爆）
    let targetSpend = Math.round((baseCap * ratio) / 10) * 10;
    targetSpend = clamp(targetSpend, 60, 280);
  
    // 用戶輸入「聚焦程度」：DOB / lucky / inspiration 越多越聚
    const hasAnyDob =
      (xuanxue.dobPrecA && xuanxue.dobPrecA !== "NONE" && String(xuanxue.dobA || "").trim()) ||
      (xuanxue.enableB && xuanxue.dobPrecB && xuanxue.dobPrecB !== "NONE" && String(xuanxue.dobB || "").trim());
  
    const luckyCnt = parseNumList(xuanxue.lucky, 6).length;
    const inspCnt = parseNumList(xuanxue.inspiration, 6).length;
    const focusScore = (hasAnyDob ? 2 : 0) + luckyCnt * 2 + inspCnt; // 0..?
  
    // ---------- RNG（每次 Generate 都會變）----------
    // 用輸入 + 當刻時間做 seed，保證每次按都可出不同買法
    const seed = (toIntSeed(JSON.stringify({
      maxBudget: xuanxue.maxBudget,
      riskLevel: xuanxue.riskLevel,
      goal,
      dobA: xuanxue.dobA, dobPrecA: xuanxue.dobPrecA, genderA: xuanxue.genderA,
      enableB: xuanxue.enableB, dobB: xuanxue.dobB, dobPrecB: xuanxue.dobPrecB, genderB: xuanxue.genderB,
      lucky: xuanxue.lucky, inspiration: xuanxue.inspiration, forbidden: xuanxue.forbidden,
      excludeTail4: xuanxue.excludeTail4
    })) ^ (Date.now() & 0xffffffff)) >>> 0;
  
    const rng = mulberry32(seed);
  
    function rand() { return rng(); }
    function randInt(a, b) {
      a = Math.floor(a); b = Math.floor(b);
      if (b < a) [a, b] = [b, a];
      return a + Math.floor(rand() * (b - a + 1));
    }
    function clampInt(x, a, b) {
      x = Math.floor(x);
      return Math.max(a, Math.min(b, x));
    }
    
    function weightedPickInt(items) {
      // items: [{ v: number, w: number }]
      let sum = 0;
      for (const it of items) sum += it.w;
      if (sum <= 0) return items[0]?.v ?? 1;
    
      let r = rand() * sum;
      for (const it of items) {
        r -= it.w;
        if (r <= 0) return it.v;
      }
      return items[items.length - 1].v;
    }
  
    // ---------- 你指定的「出現機會排序」 ----------
    // 只要數值由高到低就得；我用 35/22/14/11/8/6/4（比例明顯、又唔會太極端）
    const ranked = [
      { plan: { mode: "single" },                 w: 35, reason: "分散落注（單式）" },
      { plan: { mode: "multi", n: 7 },            w: 22, reason: "聚氣入局（7 碼複式）" },
      { plan: { mode: "multi", n: 8 },            w: 14, reason: "放大火力（8 碼複式）" },
      { plan: { mode: "danTuo", d: 5, t: 2 },     w: 11, reason: "鎖膽帶腳（5 膽）" },
      { plan: { mode: "danTuo", d: 4, t: 3 },     w:  8, reason: "鎖膽帶腳（4 膽）" },
      { plan: { mode: "danTuo", d: 3, t: 4 },     w:  6, reason: "鎖膽帶腳（3 膽）" },
      { plan: { mode: "danTuo", d: 2, t: 5 },     w:  4, reason: "鎖膽帶腳（2 膽）" },
    ];
  
    // ---------- 將 ranked 變成「可行候選」 ----------
    const feasible = [];
  
    for (const item of ranked) {
      const c = { ...item.plan };
  
      // 先估每組成本 & 預算內最多可幾組
      // m = 組數（setCount）
      // 注意：maxAllowedSets 係你 Level cap（10/5/1）
      const capM = clamp(Number(maxAllowedSets || 10), 1, 10);
  
      let m = 1;
  
      if (c.mode === "single") {
        const maxM = Math.floor((targetSpend + 10) / 10);  // 預算上最多可買幾注
        const hi = clampInt(Math.min(maxM, capM), 1, capM); // ✅ 上限先受 capM 影響
      
        // 如果 hi 只有 1，就無得揀
        if (hi <= 1) {
          c.m = 1;
        } else {
          // ✅ 你想要嘅分佈：2–4最多、5–8其次、1/9/10最少
          // 做法：對每個 m 設權重（越大越常出）
          const options = [];
          for (let m = 1; m <= hi; m++) {
            let w = 1; // default（少見）
      
            if (m >= 2 && m <= 4) w = 20;      // 最常見
            else if (m >= 5 && m <= 8) w = 4;  // 其次
            else if (m === 1) w = 1;           // 少見（保持低）
            else if (m === 9 || m === 10) w = 1; // 少見（保持低）
      
            options.push({ v: m, w });
          }
      
          c.m = weightedPickInt(options);
        }
      }

  
      if (c.mode === "multi") {
        const per = comb(c.n, 6) * 10; // 7->70, 8->280
        const maxM = Math.floor((targetSpend + 10) / per);
        if (maxM <= 0) continue;
        // 7 碼複式最多建議 2 組；8 碼通常 1 組
        const hi = c.n === 7 ? Math.min(2, maxM) : 1;
        m = clamp(randInt(1, hi), 1, capM);
        c.m = m;
      }
  
      if (c.mode === "danTuo") {
        const per = comb(c.t, 6 - c.d) * 10;
        const maxM = Math.floor((targetSpend + 10) / per);
        if (maxM <= 0) continue;
        // 膽拖一般 1–2 組就夠（太多會過份）
        const hi = Math.min(2, maxM);
        m = clamp(randInt(1, hi), 1, capM);
        c.m = m;
      }
  
      // 成本 check（唔好超 targetSpend 太多）
      const cost = costOfPlan(c);
      if (cost <= 0) continue;
      if (cost > targetSpend + 10) continue;
  
      // ---------- 輕微「目的」修正（唔會鎖死） ----------
      let w = item.w;
  
      if (goal === "hit") {
        // 求中率：單式稍偏高、8 碼稍偏低
        if (c.mode === "single") w *= 1.15;
        if (c.mode === "multi" && c.n === 8) w *= 0.85;
        if (c.mode === "danTuo") w *= 1.05;
      } else if (goal === "boom") {
        // 求爆：複式稍偏高
        if (c.mode === "multi") w *= 1.20;
        if (c.mode === "single") w *= 0.90;
      } else if (goal === "steady") {
        // 求穩：膽拖稍偏高
        if (c.mode === "danTuo") w *= 1.20;
        if (c.mode === "multi" && c.n === 8) w *= 0.90;
      }
  
      // ---------- 輕微「聚焦」修正 ----------
      // 有命盤/幸運/靈感越多 → 越傾向聚（複式/膽拖）
      if (focusScore >= 4) {
        if (c.mode === "single") w *= 0.92;
        if (c.mode === "multi")  w *= 1.08;
        if (c.mode === "danTuo") w *= 1.10;
      } else if (focusScore <= 1) {
        if (c.mode === "single") w *= 1.05;
        if (c.mode === "danTuo") w *= 0.95;
      }
  
      feasible.push({
        ...c,
        cost,
        targetSpend,
        _w: w,
        _reason: item.reason
      });
    }
  
    // fallback：萬一全部都唔可行（基本上唔會）
    if (!feasible.length) {
      const m = clamp(Math.floor(targetSpend / 10), 3, maxAllowedSets || 10);
      return {
        mode: "single",
        m,
        cost: m * 10,
        targetSpend,
        reason: "保守分散：單式（fallback）"
      };
    }
  
    // ---------- 按權重抽一個（唔再揀最高分） ----------
    let sumW = 0;
    for (const f of feasible) sumW += f._w;
  
    let r = rand() * sumW;
    let picked = feasible[0];
    for (const f of feasible) {
      r -= f._w;
      if (r <= 0) { picked = f; break; }
    }
  
    const goalText =
      goal === "hit" ? "求中率（散）" :
      goal === "boom" ? "求爆（聚）" :
      "求穩（守）";
  
    return {
      mode: picked.mode,
      m: picked.m,
      n: picked.n,
      d: picked.d,
      t: picked.t,
      cost: picked.cost,
      targetSpend: picked.targetSpend,
      reason: `${picked._reason}｜目的：${goalText}`
    };
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

  function openingReading(pack) {
    if (!pack || !pack.ctx) return "";
  
    const ctx = pack.ctx || {};
    const pA = ctx.pA || null;
    const pB = ctx.pB || null;
    const daySeed = ctx.daySeed || 0;
    const eng = ctx.engines || { wuxing:true, gua:true, star9:true, zodiac:true };
  
    // 用 A 為主
    const profile = pA || pB || { dob:null, gender:"unspecified" };
    const info = hasMeaningfulProfile(profile);
  
    // 今日運勢（九宮 target）
    const wantedStars = calcStarTargets(profile, daySeed);
  
    // 五行 / 卦（有資料先講偏向）
    const wantedWux = info.hasAny ? calcWantedWuxing(profile) : null;
    const wantedGua = info.hasAny ? calcGuaIdx(profile) : null;
  
    const parts = [];
  
    // 1) 今日運勢
    if (eng.star9) {
      parts.push(`今日運勢：九宮主星落「${wantedStars[0]} / ${wantedStars[1]}」`);
    } else {
      parts.push(`今日運勢：九宮不取，只留作平衡參考`);
    }
  
    // 2) 主象（有資料先講）
    const main = [];
    if (eng.wuxing && wantedWux) main.push(`五行偏「${wuxingName(wantedWux)}」`);
    if (eng.gua && wantedGua !== null) main.push(`卦象偏「${trigramName(wantedGua)}」`);
  
    if (main.length) {
      parts.push(`主象：${main.join("，")}`);
    } else {
      // 冇輸入資料：唔講你偏向任何五行/卦
      parts.push(`主象：命盤未起，先循「今日運勢」定調，再以「號碼對照」取象`);
    }
  
    // 3) A/B 提示（可選）
    if (pB) parts.push(`此批為 A/B 綜合取象`);
  
    return parts.join("。") + "。";
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
    
    const FALLBACK_VARIANTS = [
      "隨緣位（藏象）｜此號未落入你而家設定嘅主象，但可作暗線，拉平整體氣勢",
      "隨緣位（藏象）｜唔係主象落點，反而係「留白」位，幫你守住個局",
      "隨緣位（藏象）｜此號唔搶鏡，專做「托底」，令成套數唔會偏得太盡",
      "隨緣位（藏象）｜明面唔中象，暗裡補氣；用嚟平衡起伏最啱",
      "隨緣位（藏象）｜呢粒係「暗線」：唔屬主象，但可拉返條氣入中宮",
      "隨緣位（藏象）｜唔係你嘅主象，反而係「旁助」位，令整體更順",
      "隨緣位（藏象）｜此號唔係主力，但係守勢位，幫你穩住盤面",
      "隨緣位（藏象）｜主象未落，藏象先行；用呢粒做緩衝，局勢更圓",
    ];

    const FALLBACK_TAILS = [
      "（托底）",
      "（暗線）",
      "（留白）",
      "（守勢）",
      "（補氣）",
      "（緩衝）",
    ];

    const baseSeed =
      ((pack && pack.seed) ? pack.seed : 0) ^
      ((ctx && ctx.daySeed) ? ctx.daySeed : 0);
    
    // ✅ 同一張飛固定一句「主句式」
    const ticketFallbackIdx = (baseSeed >>> 0) % FALLBACK_VARIANTS.length;
    const ticketFallbackLine = FALLBACK_VARIANTS[ticketFallbackIdx];

    function pickFallbackTail(n) {
      // 用 baseSeed + 號碼，令同一張飛每粒尾詞可以唔同，但仍 deterministic
      const idx = ((baseSeed + n * 97) >>> 0) % FALLBACK_TAILS.length;
      return FALLBACK_TAILS[idx];
    }

    for (const n of numsSorted) {
      const nTxt = String(n).padStart(2, "0"); // ✅ 提前放呢度
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
  
      if (!hits.length) {
        lines.push(`${nTxt}：${ticketFallbackLine}${pickFallbackTail(n)}`);
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
    openingReading,
    explainTicket,

    PRICE_PER_BET,
  };
  console.log("[XX] xuanxue.js end, window.Xuanxue?", !!window.Xuanxue);
})();
