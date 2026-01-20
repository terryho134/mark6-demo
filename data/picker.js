// data/picker.js
(() => {
  // ---------- DOM ----------
  const el = (id) => document.getElementById(id);

  const buyMode = el("buyMode");
  const setCount = el("setCount");

  const multiBox = el("multiBox");
  const danBox = el("danBox");
  const tuoBox = el("tuoBox");
  const multiN = el("multiN");
  const danN = el("danN");
  const tuoN = el("tuoN");

  const buyModeHint = el("buyModeHint");
  const setCountHint = el("setCountHint");
  const multiCostHint = el("multiCostHint");
  const danTuoCostHint = el("danTuoCostHint");

  const btnGenerate = el("btnGenerate");
  const btnClear = el("btnClear");
  const result = el("result");
  const toast = el("toast");
  const modeLabel = el("modeLabel");

  // Advanced 1
  const maxConsec = el("maxConsec");
  const avoidAllOddEven = el("avoidAllOddEven");
  const maxTail = el("maxTail");
  const maxTensGroup = el("maxTensGroup");
  const maxColor = el("maxColor");
  const eachColorAtLeast1 = el("eachColorAtLeast1");
  const avoidColor = el("avoidColor");
  const sumHigh = el("sumHigh");
  const sumLow = el("sumLow");
  const colorConflictHint = el("colorConflictHint");
  const sumConflictHint = el("sumConflictHint");

  // Advanced 2
  const statN = el("statN");
  const statStatus = el("statStatus");
  const hotMin = el("hotMin");
  const hotMax = el("hotMax");
  const coldMin = el("coldMin");
  const coldMax = el("coldMax");
  const hotConflictHint = el("hotConflictHint");
  const coldConflictHint = el("coldConflictHint");
  const hotListHint = el("hotListHint");
  const coldListHint = el("coldListHint");

  // Advanced diversity
  const overlapMax = el("overlapMax");
  const overlapHint = el("overlapHint");
  const limitHint = el("limitHint");

  // ---------- Xuanxue (optional UI) ----------
  const xxAutoPlan = el("xxAutoPlan");
  const xxAutoPlanHint = el("xxAutoPlanHint");
  const xxWeightedPick = el("xxWeightedPick");
  const xxWeightedHint = el("xxWeightedHint");
  const xxMaxBudget = el("xxMaxBudget");
  const xxRiskLevel = el("xxRiskLevel");

  const xxDobPrecA = el("xxDobPrecA");
  const xxDobA = el("xxDobA");
  const xxGenderA = el("xxGenderA");
  const xxDobHintA = el("xxDobHintA");

  const xxEnableB = el("xxEnableB");
  const xxBBox = el("xxBBox");
  const xxDobPrecB = el("xxDobPrecB");
  const xxDobB = el("xxDobB");
  const xxGenderB = el("xxGenderB");
  const xxBlend = el("xxBlend");

  const xxLucky = el("xxLucky");
  const xxLuckyHint = el("xxLuckyHint");
  const xxForbidden = el("xxForbidden");
  const xxExcludeTail4 = el("xxExcludeTail4");
  const xxForbiddenHint = el("xxForbiddenHint");
  const xxInspiration = el("xxInspiration");
  const xxInspirationHint = el("xxInspirationHint");

  const xxEngineWuxing = el("xxEngineWuxing");
  const xxEngineGua = el("xxEngineGua");
  const xxEngineStar9 = el("xxEngineStar9");
  const xxEngineZodiac = el("xxEngineZodiac");

  const xxStrength = el("xxStrength");
  const xxExplainLevel = el("xxExplainLevel");

  const xxApplyPlan = el("xxApplyPlan");
  const xxPlanPreview = el("xxPlanPreview");

  // ✅ Seed mode selector（可選 UI：click / time_minute / time_shichen）
  const xxSeedMode = el("xxSeedMode");

  // ---------- Constants ----------
  const N_ALLOWED = [10, 20, 30, 60, 100];
  const PRICE_PER_BET = 10;
  const AVG = 24.5;

  // ---------- Runtime Xuanxue (per-generate) ----------
  const runtimeXX = {
    enabled: false,
    autoPlan: false,
    weightedPick: false,
    excludeSet: null,
    pack: null,         // weights pack
    plan: null,         // recommended plan
    luck: null,         // time/direction/channel suggestion
    explainLevel: "standard",

    // ✅ for (2)(3) reseed behavior
    _clickSeq: 0,
    seedMode: "click",
    seedFinal: null,
  };

  // Mark Six color mapping (HKJC standard)
  const COLOR = {
    red: new Set([1,2,7,8,12,13,18,19,23,24,29,30,34,35,40,45,46]),
    blue: new Set([3,4,9,10,14,15,20,25,26,31,36,37,41,42,47,48]),
    green: new Set([5,6,11,16,17,21,22,27,28,32,33,38,39,43,44,49]),
  };

  function colorOf(n) {
    if (COLOR.red.has(n)) return "red";
    if (COLOR.blue.has(n)) return "blue";
    return "green";
  }

  function tensGroupOf(n) {
    // B: 1–9, 10–19, 20–29, 30–39, 40–49
    if (n >= 1 && n <= 9) return "1–9";
    if (n <= 19) return "10–19";
    if (n <= 29) return "20–29";
    if (n <= 39) return "30–39";
    return "40–49";
  }

  // ---------- Stats cache ----------
  const statsCache = new Map();

  async function getStats(n) {
    if (statsCache.has(n)) return statsCache.get(n);

    statStatus.textContent = "載入中…";
    const resp = await fetch(`/api/stats?n=${n}`, { cache: "no-store" });
    const data = await resp.json();

    const p = data && data.picker ? data.picker : data;
    if (!p || !p.ok) throw new Error((p && p.error) ? p.error : "Failed to load stats");

    const top10 = p.top10 || [];
    const bottom10 = p.bottom10 || [];

    const topSet = new Set(top10.map((x) => x.n));
    const bottomSet = new Set(bottom10.map((x) => x.n));

    // freq: [{n,c}] -> map for fast lookup
    const freqMap = new Map();
    (p.freq || []).forEach((x) => {
      if (x && Number.isInteger(x.n)) freqMap.set(x.n, Number(x.c) || 0);
    });

    const pack = {
      n: p.n || n,
      top10,
      bottom10,
      topSet,
      bottomSet,
      freq: p.freq || [],
      freqMap,
      lastDraw: p.lastDraw || null,
    };

    statsCache.set(n, pack);
    statStatus.textContent = `已載入：近 ${pack.n} 期`;
    hotListHint.textContent = `Top10：${pack.top10.map(x => `${x.n}(${x.c})`).join(", ")}`;
    coldListHint.textContent = `Bottom10：${pack.bottom10.map(x => `${x.n}(${x.c})`).join(", ")}`;
    return pack;
  }

  // ---------- UI helpers ----------
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove("hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.add("hidden"), 2200);
  }

  function setOptions2(select, items, keepIfPossible = true) {
    const cur = select.value;
    select.innerHTML = "";
    for (const it of items) {
      const value = (typeof it === "object") ? String(it.value) : String(it);
      const label = (typeof it === "object") ? String(it.label) : String(it);
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    }
    const values = items.map(x => String(typeof x === "object" ? x.value : x));
    if (keepIfPossible && values.includes(cur)) select.value = cur;
    else {
      const firstVal = (items[0] && typeof items[0] === "object") ? String(items[0].value) : String(items[0] ?? "");
      select.value = firstVal;
    }
  }

  function withOff(values, offLabel = "Off") {
    return [{ value: "", label: offLabel }, ...values.map(v => ({ value: v, label: String(v) }))];
  }

  // ✅ 只有 9/17 全餐屬「進階買法」固定 1 套
  function isAdvancedBuyMode(mode) {
    return mode === "full9" || mode === "full17";
  }

  function isAutoPlanMode(mode) {
    return mode === "autoPlan";
  }

  function anyAdvancedSelected() {
    return Boolean(
      maxConsec.value ||
      avoidAllOddEven.checked ||
      maxTail.value ||
      maxTensGroup.value ||
      maxColor.value ||
      eachColorAtLeast1.checked ||
      avoidColor.value ||
      sumHigh.checked ||
      sumLow.checked ||
      (statN.value && (hotMin.value || hotMax.value || coldMin.value || coldMax.value)) ||
      overlapMax.value
    );
  }

  function hardConflicts() {
    const issues = [];

    if (eachColorAtLeast1.checked && avoidColor.value) {
      issues.push("已選「每色至少 1 粒」，不能同時「避免某色」。");
    }
    if (sumHigh.checked && sumLow.checked) {
      issues.push("不能同時要求「總和偏大」及「總和偏小」。");
    }

    const hMin = hotMin.value === "" ? null : Number(hotMin.value);
    const hMax = hotMax.value === "" ? null : Number(hotMax.value);
    if (hMin !== null && hMax !== null && hMin > hMax) {
      issues.push("熱號：『至少』不能大於『最多』。");
    }

    const cMin = coldMin.value === "" ? null : Number(coldMin.value);
    const cMax = coldMax.value === "" ? null : Number(coldMax.value);
    if (cMin !== null && cMax !== null && cMin > cMax) {
      issues.push("冷號：『至少』不能大於『最多』。");
    }

    return issues;
  }

  function computeLevel() {
    if (isAdvancedBuyMode(buyMode.value)) return 3;
    if (!anyAdvancedSelected()) return 0;

    let level = 1;
    let level2Count = 0;

    if (maxConsec.value) {
      const v = Number(maxConsec.value);
      if (v <= 2) { level = Math.max(level, 2); level2Count++; }
    }
    if (maxTail.value) {
      const v = Number(maxTail.value);
      if (v <= 2) { level = Math.max(level, 2); level2Count++; }
    }
    if (maxTensGroup.value) {
      const v = Number(maxTensGroup.value);
      if (v === 2) { level = Math.max(level, 2); level2Count++; }
    }
    if (maxColor.value) {
      const v = Number(maxColor.value);
      if (v <= 3) { level = Math.max(level, 2); level2Count++; }
    }

    if (eachColorAtLeast1.checked) { level = Math.max(level, 2); level2Count++; }
    if (avoidColor.value) { level = Math.max(level, 2); level2Count++; }

    if (avoidAllOddEven.checked) level = Math.max(level, 1);
    if (sumHigh.checked || sumLow.checked) level = Math.max(level, 1);

    if (hotMin.value || hotMax.value || coldMin.value || coldMax.value) {
      level = Math.max(level, 2);
      level2Count++;
    }

    if (overlapMax.value !== "") {
      const k = Number(overlapMax.value);
      if (k <= 1) level = Math.max(level, 3);
      else if (k <= 3) { level = Math.max(level, 2); level2Count++; }
    }

    if (level2Count >= 3) level = Math.max(level, 3);
    return level;
  }

  function maxSetsAllowedByLevel(level) {
    if (level === 3) return 1;
    if (level === 2) return 5;
    return 10;
  }

  function hasXuanxueUI() {
    return typeof window !== "undefined" && !!window.Xuanxue && !!xxAutoPlan;
  }

  function getXuanxueState() {
    if (!hasXuanxueUI()) return { enabled:false };

    const st = {
      enabled: true,
      autoPlan: !!xxAutoPlan.checked,
      weightedPick: !!xxWeightedPick.checked,
      maxBudget: Number(xxMaxBudget.value || 500),
      riskLevel: xxRiskLevel.value || "medium",

      dobPrecA: xxDobPrecA.value || "NONE",
      dobA: (xxDobA.value || "").trim(),
      genderA: xxGenderA.value || "unspecified",

      enableB: !!xxEnableB.checked,
      dobPrecB: xxDobPrecB.value || "NONE",
      dobB: (xxDobB.value || "").trim(),
      genderB: xxGenderB.value || "unspecified",
      blend: Number((xxBlend && xxBlend.value) || 0.5),

      lucky: (xxLucky.value || "").trim(),
      forbidden: (xxForbidden.value || "").trim(),
      excludeTail4: !!xxExcludeTail4.checked,
      inspiration: (xxInspiration.value || "").trim(),

      engines: {
        wuxing: !!xxEngineWuxing.checked,
        gua: !!xxEngineGua.checked,
        star9: !!xxEngineStar9.checked,
        zodiac: !!xxEngineZodiac.checked,
      },

      strength: (xxStrength && xxStrength.value) || "medium",
      explainLevel: (xxExplainLevel && xxExplainLevel.value) || "standard",
    };

    return st;
  }

  // ---------- Basic: dynamic options ----------
  function initBasicSelectOptions() {
    setOptions2(multiN, Array.from({ length: 9 }, (_, i) => 7 + i)); // 7–15
    setOptions2(danN, [1, 2, 3, 4, 5]);
    updateTuoOptions();
  }

  // ✅ 拖（腳）最少 = 7 - 膽
  function updateTuoOptions() {
    const d = Number(danN.value || 1);

    const minTuo = 7 - d;
    const maxTuo = 49 - d;

    const opts = [];
    const startEnd = Math.min(minTuo + 12, maxTuo);
    for (let t = minTuo; t <= startEnd; t++) opts.push({ value: t, label: String(t) });

    const jumps = [15, 20, 25, 30, 35, 40];
    for (const j of jumps) {
      if (j >= minTuo && j <= maxTuo && !opts.some(o => o.value === j)) {
        opts.push({ value: j, label: String(j) });
      }
    }

    if (!opts.some(o => o.value === maxTuo)) {
      opts.push({ value: maxTuo, label: `${maxTuo}（全餐）` });
    } else {
      const idx = opts.findIndex(o => o.value === maxTuo);
      opts[idx] = { value: maxTuo, label: `${maxTuo}（全餐）` };
    }

    setOptions2(tuoN, opts, true);

    const cur = Number(tuoN.value || minTuo);
    if (cur < minTuo) tuoN.value = String(minTuo);
    if (cur > maxTuo) tuoN.value = String(maxTuo);
  }

  function updateSetCountOptions() {
    const issues = hardConflicts();

    colorConflictHint.textContent =
      eachColorAtLeast1.checked && avoidColor.value
        ? "衝突：已要求每色至少 1 粒，不能同時避免某色。"
        : "";

    sumConflictHint.textContent =
      sumHigh.checked && sumLow.checked
        ? "衝突：不能同時選「總和偏大」及「總和偏小」。"
        : "";

    const hMin = hotMin.value === "" ? null : Number(hotMin.value);
    const hMax = hotMax.value === "" ? null : Number(hotMax.value);
    hotConflictHint.textContent =
      hMin !== null && hMax !== null && hMin > hMax
        ? "衝突：『至少』不能大於『最多』。"
        : "";

    const cMin = coldMin.value === "" ? null : Number(coldMin.value);
    const cMax = coldMax.value === "" ? null : Number(coldMax.value);
    coldConflictHint.textContent =
      cMin !== null && cMax !== null && cMin > cMax
        ? "衝突：『至少』不能大於『最多』。"
        : "";

    const level = computeLevel();
    const maxAllowed = maxSetsAllowedByLevel(level);

    // autoPlan：setCount 由建議回填（先 disable）
    if (isAutoPlanMode(buyMode.value)) {
      setCount.disabled = true;
      setOptions2(setCount, [1]);
      setCountHint.textContent = "交俾你建議：生成時會自動回填買法與組數。";
      limitHint.textContent = anyAdvancedSelected()
        ? `已啟用條件（嚴格）：生成時仍會受 Level cap 影響（Level ${computeLevel()}）。`
        : "未啟用條件：純隨機（如再開玄學加權，會變成偏向取號）。";
      btnGenerate.disabled = hardConflicts().length > 0;
      updateBuyModeUI();
      return;
    }

    if (isAdvancedBuyMode(buyMode.value)) {
      setCount.disabled = true;
      setOptions2(setCount, [1]);
      setCountHint.textContent = "進階全餐：每次只生成 1 套注單。";
      limitHint.textContent = "進階全餐：固定只可生成 1 套。";
    } else {
      setCount.disabled = false;
      const opts = [];
      for (let i = 1; i <= Math.min(10, maxAllowed); i++) opts.push(i);
      setOptions2(setCount, opts);

      if (!anyAdvancedSelected()) {
        setCountHint.textContent = "未啟用條件：純隨機，可生成 1–10 組。";
        limitHint.textContent = "未啟用條件：最多 10 組（純隨機）";
      } else {
        setCountHint.textContent = `已啟用條件（嚴格）：最多可生成 ${maxAllowed} 組。`;
        limitHint.textContent = `已啟用條件（嚴格）：最多 ${maxAllowed} 組（Level ${level}）。`;
      }
    }

    btnGenerate.disabled = issues.length > 0;
    if (issues.length > 0) {
      modeLabel.innerHTML = `<span class="bad">請先解決衝突：</span><br>${issues.map(x => `• ${x}`).join("<br>")}`;
    } else {
      modeLabel.textContent = "";
    }

    if (overlapMax.value === "") {
      overlapHint.textContent = "Off：不限制組與組之間重複。";
    } else {
      overlapHint.textContent = `任意兩組最多重複 ${overlapMax.value} 粒。K=0 代表完全不重複（很嚴格）。`;
    }

    updateBuyModeUI();
  }

  // ---------- Pricing helpers ----------
  function nCk(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let num = 1, den = 1;
    for (let i = 1; i <= k; i++) {
      num *= (n - (k - i));
      den *= i;
    }
    return Math.round(num / den);
  }

  function danTuoBets(d, t) {
    const need = 6 - d;
    return t >= need ? nCk(t, need) : 0;
  }

  // ✅ 修正：updateBuyModeUI 分支結構（避免 mode=danTuo/full9/full17/full5dan 無法正常更新）
  function updateBuyModeUI() {
    const mode = buyMode.value;

    // autoPlan：唔顯示 multi/danTuo 設定（由玄學回填）
    const auto = isAutoPlanMode(mode);

    multiBox.classList.toggle("hidden", auto || mode !== "multi");
    danBox.classList.toggle("hidden", auto || mode !== "danTuo");
    tuoBox.classList.toggle("hidden", auto || mode !== "danTuo");

    const sets = Number(setCount.value || 1);

    if (auto) {
      buyModeHint.textContent = "交俾你建議：由玄學建議買法＋組數（不會用盡上限）";
      multiCostHint.textContent = "";
      danTuoCostHint.textContent = "";
      return;
    }

    // clear cost hints by default
    multiCostHint.textContent = "";
    danTuoCostHint.textContent = "";

    if (mode === "single") {
      buyModeHint.textContent = `每組 1 注（$${PRICE_PER_BET}）`;
      return;
    }

    if (mode === "multi") {
      const n = Number(multiN.value);
      const bets = nCk(n, 6);
      buyModeHint.textContent = `${n} 碼複式：共 ${bets} 注`;
      multiCostHint.textContent =
        `每組金額：$${bets * PRICE_PER_BET}${setCount.disabled ? "" : `｜${sets}組總額：$${bets * PRICE_PER_BET * sets}`}`;
      return;
    }

    if (mode === "danTuo") {
      const d = Number(danN.value);
      const t = Number(tuoN.value);
      const bets = danTuoBets(d, t);
      buyModeHint.textContent = `${d} 膽 + ${t} 拖：共 ${bets} 注`;
      danTuoCostHint.textContent =
        bets > 0
          ? `每組金額：$${bets * PRICE_PER_BET}${setCount.disabled ? "" : `｜${sets}組總額：$${bets * PRICE_PER_BET * sets}`}`
          : "拖數不足，無法組合成 6 粒。";
      return;
    }

    if (mode === "full9") {
      buyModeHint.textContent = "9注全餐：1 套 9 注（$90）";
      return;
    }

    if (mode === "full17") {
      buyModeHint.textContent = "17注全餐：1 套 17 注（$170）";
      return;
    }

    if (mode === "full5dan") {
      const per = 44 * PRICE_PER_BET; // 44注
      buyModeHint.textContent = `5 膽全餐：每組 44 注（$${per}）`;
      danTuoCostHint.textContent = setCount.disabled ? "" : `${sets}組總額：$${per * sets}`;
      return;
    }

    // fallback
    buyModeHint.textContent = "";
  }

  // ---------- Random helpers ----------
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ---------- RNG seed (kept; may still be useful elsewhere) ----------
  function genSeed() {
    // Prefer crypto-quality randomness
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const u = new Uint32Array(2);
      crypto.getRandomValues(u);
      // combine to a safe integer-ish range
      return (u[0] * 4294967296 + u[1]) % 2147483647;
    }
    // fallback
    return Math.floor((Date.now() ^ (Math.random() * 1e9)) % 2147483647);
  }

  function sampleDistinct(k, excludeSet = null) {
    // 玄學加權抽號（如已啟用）
    if (runtimeXX.enabled && runtimeXX.weightedPick && runtimeXX.pack && window.Xuanxue) {
      // pack 內含 forbiddenSet，呢度再合併額外 excludeSet
      const merged = new Set(runtimeXX.pack.forbiddenSet ? Array.from(runtimeXX.pack.forbiddenSet) : []);
      if (excludeSet) for (const x of excludeSet) merged.add(x);

      // 做一個 shallow pack，替換 forbiddenSet
      const pack2 = { ...runtimeXX.pack, forbiddenSet: merged };
      return window.Xuanxue.weightedSampleWithoutReplacement(k, pack2);
    }

    // --- 原本純隨機 ---
    const pool = [];
    for (let i = 1; i <= 49; i++) {
      if (excludeSet && excludeSet.has(i)) continue;
      pool.push(i);
    }
    shuffle(pool);
    return pool.slice(0, k).sort((a, b) => a - b);
  }

  function overlapCount(a, b) {
    const s = new Set(a);
    let c = 0;
    for (const x of b) if (s.has(x)) c++;
    return c;
  }

  function maxConsecutiveRun(sortedNums) {
    let best = 1, cur = 1;
    for (let i = 1; i < sortedNums.length; i++) {
      if (sortedNums[i] === sortedNums[i - 1] + 1) {
        cur++;
        best = Math.max(best, cur);
      } else {
        cur = 1;
      }
    }
    return best;
  }

  function consecutiveSegments(sortedNums) {
    // count of consecutive runs with length >= 2
    if (!sortedNums || sortedNums.length < 2) return 0;
    let seg = 0;
    let run = 1;
    for (let i = 1; i < sortedNums.length; i++) {
      if (sortedNums[i] === sortedNums[i - 1] + 1) run++;
      else {
        if (run >= 2) seg++;
        run = 1;
      }
    }
    if (run >= 2) seg++;
    return seg;
  }

  function countsBy(items) {
    const m = new Map();
    for (const x of items) m.set(x, (m.get(x) || 0) + 1);
    return m;
  }

  function isPrime(n) {
    if (n <= 1) return false;
    if (n === 2) return true;
    if (n % 2 === 0) return false;
    for (let i = 3; i * i <= n; i += 2) {
      if (n % i === 0) return false;
    }
    return true;
  }

  function fmt1(x) {
    return (Math.round(x * 10) / 10).toFixed(1);
  }

  // ---------- Explain (v2.1) ----------
  function explainNums(numsSorted, statsPack = null) {
    const len = numsSorted.length;
    const sum = numsSorted.reduce((a, b) => a + b, 0);
    const avg = sum / len;

    const odd = numsSorted.filter((x) => x % 2 === 1).length;
    const even = len - odd;

    const big = numsSorted.filter((x) => x >= 25).length;
    const small = len - big;

    const cols = numsSorted.map(colorOf);
    const cm = countsBy(cols);
    const red = cm.get("red") || 0;
    const blue = cm.get("blue") || 0;
    const green = cm.get("green") || 0;

    const runMax = maxConsecutiveRun(numsSorted);
    const segs = consecutiveSegments(numsSorted);

    const tails = numsSorted.map((x) => x % 10);
    const tm = countsBy(tails);
    let tailMax = 0;
    let tailRep = null;
    for (const [k, v] of tm.entries()) {
      if (v > tailMax) { tailMax = v; tailRep = k; }
    }

    const groups = numsSorted.map(tensGroupOf);
    const gm = countsBy(groups);
    let groupMax = 0;
    let groupRep = null;
    for (const [k, v] of gm.entries()) {
      if (v > groupMax) { groupMax = v; groupRep = k; }
    }

    const span = numsSorted[len - 1] - numsSorted[0];
    const primes = numsSorted.filter(isPrime).length;

    // optional: near N stats (only if we have statsPack)
    let statLine = null;
    if (statsPack && statsPack.freqMap) {
      let score = 0;
      for (const n of numsSorted) score += (statsPack.freqMap.get(n) || 0);
      const scoreAvg = score / len;

      const hotHit = numsSorted.filter((x) => statsPack.topSet && statsPack.topSet.has(x)).length;
      const coldHit = numsSorted.filter((x) => statsPack.bottomSet && statsPack.bottomSet.has(x)).length;

      statLine = `近${statsPack.n}期：出現次數總和 ${score}｜平均 ${fmt1(scoreAvg)}｜Top10命中${hotHit}｜Bottom10命中${coldHit}`;
    }

    const summary =
      `奇偶 ${odd}/${even}｜大小 ${big}大${small}細｜顏色 紅${red}藍${blue}綠${green}` +
      `｜連號 最長${runMax}（段數${segs}）｜同尾 最大${tailMax}` +
      `｜十位段 最大${groupMax}｜平均 ${fmt1(avg)}（總和${sum}）`;

    const chips = [
      `連號：最長${runMax}｜段數${segs}`,
      `尾：最大${tailMax}${tailRep !== null && tailMax >= 2 ? `（尾${tailRep}×${tailMax}）` : ""}`,
      `段：最大${groupMax}${groupRep ? `（${groupRep}×${groupMax}）` : ""}`,
      `色：紅${red} 藍${blue} 綠${green}`,
      `和值：${sum}｜均值：${fmt1(avg)}`,
      `跨度：${numsSorted[len - 1]}−${numsSorted[0]}=${span}`,
      `質數：${primes}粒`,
    ];

    if (statLine) chips.push(statLine);

    return { summary, chips };
  }

  // ---------- Constraints ----------
  function checkAdvancedConstraints(numsSorted, statsPack) {
    if (maxConsec.value) {
      const lim = Number(maxConsec.value);
      if (maxConsecutiveRun(numsSorted) > lim) return false;
    }

    if (avoidAllOddEven.checked) {
      const odd = numsSorted.filter((x) => x % 2 === 1).length;
      if (odd === 0 || odd === numsSorted.length) return false;
    }

    if (maxTail.value) {
      const lim = Number(maxTail.value);
      const tails = numsSorted.map((x) => x % 10);
      const m = countsBy(tails);
      for (const v of m.values()) if (v > lim) return false;
    }

    if (maxTensGroup.value) {
      const lim = Number(maxTensGroup.value);
      const groups = numsSorted.map(tensGroupOf);
      const m = countsBy(groups);
      for (const v of m.values()) if (v > lim) return false;
    }

    const cols = numsSorted.map(colorOf);
    const colMap = countsBy(cols);

    if (maxColor.value) {
      const lim = Number(maxColor.value);
      for (const v of colMap.values()) if (v > lim) return false;
    }

    if (eachColorAtLeast1.checked) {
      if (!colMap.get("red") || !colMap.get("blue") || !colMap.get("green")) return false;
    }

    if (avoidColor.value) {
      if (cols.includes(avoidColor.value)) return false;
    }

    const sum = numsSorted.reduce((a, b) => a + b, 0);
    const pivot = AVG * numsSorted.length;
    if (sumHigh.checked && !(sum > pivot)) return false;
    if (sumLow.checked && !(sum < pivot)) return false;

    if (hotMin.value || hotMax.value || coldMin.value || coldMax.value) {
      if (!statsPack) return false;

      const topSet = statsPack.topSet;
      const bottomSet = statsPack.bottomSet;

      const hotHit = numsSorted.filter((x) => topSet.has(x)).length;
      const coldHit = numsSorted.filter((x) => bottomSet.has(x)).length;

      const hMin = hotMin.value === "" ? null : Number(hotMin.value);
      const hMax = hotMax.value === "" ? null : Number(hotMax.value);
      const cMin = coldMin.value === "" ? null : Number(coldMin.value);
      const cMax = coldMax.value === "" ? null : Number(coldMax.value);

      if (hMin !== null && hotHit < hMin) return false;
      if (hMax !== null && hotHit > hMax) return false;
      if (cMin !== null && coldHit < cMin) return false;
      if (cMax !== null && coldHit > cMax) return false;
    }

    return true;
  }

  // ---------- Ticket generators ----------
  function buildTicketByMode(mode) {
    // 玄學/禁忌排除集合（可為 null）
    const ex = runtimeXX && runtimeXX.excludeSet ? runtimeXX.excludeSet : null;

    if (mode === "single") {
      const nums = sampleDistinct(6, ex);
      return { kind: "single", nums, keyNums: nums };
    }

    if (mode === "multi") {
      const n = Number(multiN.value);
      const nums = sampleDistinct(n, ex);
      return { kind: "multi", nums, keyNums: nums };
    }

    if (mode === "danTuo") {
      const d = Number(danN.value);
      const t = Number(tuoN.value);

      // 先抽膽（避禁忌）
      const dan = sampleDistinct(d, ex);
      const danSet = new Set(dan);

      // 拖要同時避：禁忌 + 已選膽
      const merged = new Set();
      if (ex) for (const x of ex) merged.add(x);
      for (const x of danSet) merged.add(x);

      const maxTuo = 49 - d;
      const isFullTuo = (t === maxTuo);
      
      // 腳全餐：腳 = 除咗膽 +（禁忌/排除）之外的所有號碼
      let tuo;
      if (isFullTuo) {
        tuo = [];
        for (let i = 1; i <= 49; i++) {
          if (merged.has(i)) continue; // merged = 禁忌 + 膽
          tuo.push(i);
        }
        // full set 本身已經係排序
      } else {
        tuo = sampleDistinct(t, merged);
      }
      
      const all = [...dan, ...tuo].sort((a, b) => a - b);
      return { kind: "danTuo", dan, tuo, all, keyNums: all, isFullTuo };
    }

    // ✅ 5膽全餐：基本買法 -> 生成「膽 + 腳」，組與組多樣性以「膽」衡量
    if (mode === "full5dan") {
      // 膽要避禁忌
      const dan = sampleDistinct(5, ex);
      const danSet = new Set(dan);

      // 腳 = 除咗膽以外所有數（⚠️ 若你想「腳都要避禁忌」可以再改）
      const legs = [];
      for (let i = 1; i <= 49; i++) {
        if (!danSet.has(i)) legs.push(i);
      }

      const all = [...dan, ...legs].sort((a, b) => a - b);
      return { kind: "full5dan", dan, legs, all, keyNums: dan };
    }

    // fallback
    const nums = sampleDistinct(6, ex);
    return { kind: "single", nums, keyNums: nums };
  }

  async function generateNormalTickets(desiredSets) {
    const strict = anyAdvancedSelected();
    const issues = hardConflicts();
    if (issues.length) throw new Error(issues.join(" / "));

    const level = computeLevel();
    const maxAllowed = maxSetsAllowedByLevel(level);
    const target = Math.min(desiredSets, maxAllowed);

    let statsPack = null;
    // if any Advanced 2 is used, fetch stats for explanation + constraints
    if (strict && (hotMin.value || hotMax.value || coldMin.value || coldMax.value)) {
      statsPack = await getStats(Number(statN.value));
    } else if (statN && statN.value && N_ALLOWED.includes(Number(statN.value))) {
      // Optional: if stats already loaded previously, keep it for explanation (non-blocking)
      const n = Number(statN.value);
      if (statsCache.has(n)) statsPack = statsCache.get(n);
    }

    const overlapK = overlapMax.value === "" ? null : Number(overlapMax.value);

    const tickets = [];
    const ATTEMPT_LIMIT = 160000;
    let attempts = 0;

    while (tickets.length < target && attempts < ATTEMPT_LIMIT) {
      attempts++;

      const t = buildTicketByMode(buyMode.value);
      const numsSorted = (t.keyNums || []).slice().sort((a, b) => a - b);

      if (strict) {
        // ✅ full5dan：條件判斷以「膽」(keyNums)
        if (!checkAdvancedConstraints(numsSorted, statsPack)) continue;

        if (overlapK !== null) {
          let ok = true;
          for (const prev of tickets) {
            if (overlapCount(prev.keyNums, numsSorted) > overlapK) { ok = false; break; }
          }
          if (!ok) continue;
        }
      }

      tickets.push(t);
    }

    if (tickets.length < target) {
      throw new Error(
        `條件較嚴格，嘗試 ${attempts} 次後仍未能生成足夠組合（已生成 ${tickets.length}/${target}）。` +
        ` 建議：降低組數、放寬多樣性、或取消部分限制。`
      );
    }

    return { tickets, strict, statsPack, level, maxAllowed, attempts };
  }

  // ---------- Full meal generators (9/17 only) ----------
  async function generateFullMeal(mode) {
    const strict = anyAdvancedSelected();
    const issues = hardConflicts();
    if (issues.length) throw new Error(issues.join(" / "));

    let statsPack = null;
    if (strict && (hotMin.value || hotMax.value || coldMin.value || coldMax.value)) {
      statsPack = await getStats(Number(statN.value));
    } else if (statN && statN.value && N_ALLOWED.includes(Number(statN.value))) {
      const n = Number(statN.value);
      if (statsCache.has(n)) statsPack = statsCache.get(n);
    }

    const PACK_ATTEMPT_LIMIT = 4000;

    for (let t = 0; t < PACK_ATTEMPT_LIMIT; t++) {
      let bets = [];
      if (mode === "full9") bets = buildPack9();
      if (mode === "full17") bets = buildPack17();

      if (!strict) return { kind: mode, bets, strict, statsPack, attempts: t + 1 };

      let ok = true;
      for (const b of bets) {
        const nums = [...b].sort((a, c) => a - c);
        if (!checkAdvancedConstraints(nums, statsPack)) { ok = false; break; }
      }
      if (ok) return { kind: mode, bets, strict, statsPack, attempts: t + 1 };
    }

    throw new Error("全餐套用嚴格條件後仍未能生成。建議取消部分條件，或先用「基本買法」。");
  }

  // ---------- 9/17 packs (validated correct) ----------
  function buildPack9() {
    const pool = Array.from({ length: 49 }, (_, i) => i + 1);
    shuffle(pool);

    const A48 = pool.slice(0, 48);
    const x = pool[48];

    const bets = [];
    for (let i = 0; i < 8; i++) bets.push(A48.slice(i * 6, i * 6 + 6).sort((a, b) => a - b));

    const tmp = [...A48];
    shuffle(tmp);
    const R5 = tmp.slice(0, 5);

    bets.push([x, ...R5].sort((a, b) => a - b));
    if (!validatePack9(bets)) return buildPack9();
    return bets;
  }

  function buildPack17() {
    const MAX_TRY = 200;
    for (let attempt = 0; attempt < MAX_TRY; attempt++) {
      const pool = Array.from({ length: 49 }, (_, i) => i + 1);
      shuffle(pool);

      const A48 = pool.slice(0, 48);
      const x = pool[48];

      const bets = [];
      for (let i = 0; i < 8; i++) bets.push(A48.slice(i * 6, i * 6 + 6).sort((a, b) => a - b));

      const tmp = [...A48];
      shuffle(tmp);
      const R5 = tmp.slice(0, 5);
      const R5set = new Set(R5);

      bets.push([x, ...R5].sort((a, b) => a - b));

      const U49 = Array.from({ length: 49 }, (_, i) => i + 1);
      const S44 = U49.filter((n) => !R5set.has(n));

      const sTmp = [...S44];
      shuffle(sTmp);
      const T42 = sTmp.slice(0, 42);
      const L2 = sTmp.slice(42);

      for (let i = 0; i < 7; i++) bets.push(T42.slice(i * 6, i * 6 + 6).sort((a, b) => a - b));

      const L2set = new Set(L2);
      const rest47 = U49.filter((n) => !L2set.has(n));
      shuffle(rest47);
      const pick4 = rest47.slice(0, 4);

      bets.push([...L2, ...pick4].sort((a, b) => a - b));
      if (validatePack17(bets, R5set)) return bets;
    }
    return buildPack17();
  }

  function validatePack9(bets) {
    if (!Array.isArray(bets) || bets.length !== 9) return false;
    const cnt = Array(50).fill(0);
    for (const b of bets) {
      if (!Array.isArray(b) || b.length !== 6) return false;
      const s = new Set(b);
      if (s.size !== 6) return false;
      for (const n of b) {
        if (!Number.isInteger(n) || n < 1 || n > 49) return false;
        cnt[n] += 1;
      }
    }
    let ones = 0, twos = 0, other = 0;
    for (let i = 1; i <= 49; i++) {
      if (cnt[i] === 1) ones++;
      else if (cnt[i] === 2) twos++;
      else other++;
    }
    return ones === 44 && twos === 5 && other === 0;
  }

  function validatePack17(bets, R5set) {
    if (!Array.isArray(bets) || bets.length !== 17) return false;
    const cnt = Array(50).fill(0);

    for (const b of bets) {
      if (!Array.isArray(b) || b.length !== 6) return false;
      const s = new Set(b);
      if (s.size !== 6) return false;
      for (const n of b) {
        if (!Number.isInteger(n) || n < 1 || n > 49) return false;
        cnt[n] += 1;
      }
    }

    for (let i = 9; i <= 15; i++) for (const n of bets[i]) if (R5set.has(n)) return false;

    let twos = 0, threes = 0, other = 0;
    for (let i = 1; i <= 49; i++) {
      if (cnt[i] === 2) twos++;
      else if (cnt[i] === 3) threes++;
      else other++;
    }
    return twos === 45 && threes === 4 && other === 0;
  }

  // ---------- Render ----------
  function clearResult() { result.innerHTML = ""; }

  // ✅ 顯示顏色：用 ring（唔破壞 ball 風格）
  function renderBallsRow(nums, labelText = "") {
    const COLOR_HEX = {
      red: "#ef4444",
      blue: "#3b82f6",
      green: "#22c55e",
    };

    const wrap = document.createElement("div");
    wrap.className = "numsRow";

    if (labelText) {
      const label = document.createElement("div");
      label.className = "muted";
      label.style.margin = "6px 0 4px";
      label.innerHTML = `<b>${labelText}</b>`;
      wrap.appendChild(label);
    }

    const row = document.createElement("div");
    row.className = "nums";

    nums.forEach((n) => {
      const b = document.createElement("div");
      b.className = "ball";
      b.textContent = String(n).padStart(2, "0");

      const c = colorOf(n);
      b.setAttribute("data-color", c);
      b.title = c === "red" ? "紅" : c === "blue" ? "藍" : "綠";
      b.style.boxShadow = `0 0 0 2px ${COLOR_HEX[c]} inset`;

      row.appendChild(b);
    });

    wrap.appendChild(row);
    return wrap;
  }

  function renderSummaryLine(text) {
    const d = document.createElement("div");
    d.className = "muted";
    d.style.marginTop = "6px";
    d.style.lineHeight = "1.35";
    d.textContent = text;
    return d;
  }

  function renderChips(chips) {
    if (!chips || !chips.length) return null;
    const tagsRow = document.createElement("div");
    tagsRow.className = "tags";
    for (const t of chips) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = t;
      tagsRow.appendChild(tag);
    }
    return tagsRow;
  }

  // ✅ NEW：玄學逐粒解釋 render
  function renderXuanxueExplain(lines) {
    if (!lines || !lines.length) return null;

    const wrap = document.createElement("div");
    wrap.className = "muted";
    wrap.style.marginTop = "8px";
    wrap.style.lineHeight = "1.45";

    const title = document.createElement("div");
    title.innerHTML = "<b>玄學解釋</b>";
    wrap.appendChild(title);

    for (const l of lines) {
      const row = document.createElement("div");
      row.textContent = l;
      wrap.appendChild(row);
    }

    return wrap;
  }

  function seedModeLabel(mode) {
    if (mode === "time_shichen") return "時辰氣口（每2小時變）";
    if (mode === "time_minute") return "每分鐘氣口（每分鐘變）";
    return "按鍵即時（每次按都變）";
  }

  function renderNormalTickets(out) {
    clearResult();

    const head = document.createElement("div");
    head.className = "muted";
    head.innerHTML = out.strict
      ? `生成方式：<b>嚴格條件生成</b>（Level ${out.level}，最多 ${out.maxAllowed} 組）｜已生成 ${out.tickets.length} 組｜嘗試 ${out.attempts} 次`
      : `生成方式：<b>純隨機</b>｜已生成 ${out.tickets.length} 組`;
    result.appendChild(head);

    // ---- Xuanxue header ----
    if (runtimeXX.enabled) {
      const xxHead = document.createElement("div");
      xxHead.className = "muted";
      xxHead.style.marginTop = "6px";
      xxHead.style.lineHeight = "1.4";

      const plan = runtimeXX.plan;
      const luck = runtimeXX.luck;

      const planText = plan
        ? `玄學建議買法：${
            plan.mode === "single" ? `單式 ${setCount.value} 注` :
            plan.mode === "multi" ? `${multiN.value} 碼複式 × ${setCount.value} 組` :
            plan.mode === "danTuo" ? `${danN.value} 膽 + ${tuoN.value} 拖 × ${setCount.value} 組` :
            `5膽全餐 × ${setCount.value} 組`
          }（原因：${plan.reason || ""}）`
        : "玄學：未啟用 Auto Plan（只作加權/禁忌排除）";

      const luckText = (luck && luck.time)
        ? `幸運下注時間：${luck.time.join(" 或 ")}｜幸運方位：${luck.direction}｜建議：${luck.channel}｜${luck.shopHint}`
        : "";

      const seedText = runtimeXX.weightedPick
        ? `取號種子：${seedModeLabel(runtimeXX.seedMode)}`
        : "";

      xxHead.innerHTML =
        `<b>玄學提示</b><br>` +
        `${planText}<br>` +
        `${runtimeXX.weightedPick ? "取號：已啟用四源加權（五行/易卦/九宮/生肖）" : "取號：未啟用四源加權（保持隨機）"}<br>` +
        `${seedText ? (seedText + "<br>") : ""}` +
        `${luckText}`;

      result.appendChild(xxHead);
    }

    out.tickets.forEach((t, idx) => {
      const box = document.createElement("div");
      box.className = "resultSet";

      const title = document.createElement("div");
      title.innerHTML = `<b>第 ${idx + 1} 組</b>`;
      box.appendChild(title);

      // ✅ 每組都建立 numsSortedLocal，避免 numsSorted 未宣告
      const numsSortedLocal = (t.keyNums || t.nums || t.all || t.dan || []).slice().sort((a,b)=>a-b);

      if (t.kind === "single") {
        box.appendChild(renderBallsRow(t.nums));
        const exp = explainNums(t.nums.slice().sort((a,b)=>a-b), out.statsPack);

        if (runtimeXX.enabled && runtimeXX.weightedPick && runtimeXX.pack && window.Xuanxue) {
          const hit = window.Xuanxue.explainXuanxueHit(numsSortedLocal, runtimeXX.pack);
          if (hit) {
            if (runtimeXX.explainLevel !== "compact") {
              exp.chips.unshift(`玄學：幸運命中${hit.luckyHit}｜靈感命中${hit.inspirationHit}`);
            }
            if (runtimeXX.explainLevel === "detailed") {
              exp.chips.unshift(`四源命中：五行${hit.wux}｜易卦${hit.gua}｜九宮${hit.star}｜生肖${hit.zod}`);
            }
          }
        }

        box.appendChild(renderSummaryLine(exp.summary));
        const chips = renderChips(exp.chips);
        if (chips) box.appendChild(chips);

        // ✅ 逐粒玄學解釋
        if (runtimeXX.enabled && runtimeXX.weightedPick && runtimeXX.pack && window.Xuanxue && window.Xuanxue.explainTicket) {
          const xxExp = window.Xuanxue.explainTicket(numsSortedLocal, runtimeXX.pack, runtimeXX.explainLevel);
          const xxBox = renderXuanxueExplain(xxExp && xxExp.lines);
          if (xxBox) box.appendChild(xxBox);
        }
      }

      if (t.kind === "multi") {
        box.appendChild(renderBallsRow(t.nums, `複式：${t.nums.length} 碼`));
        const exp = explainNums(t.nums.slice().sort((a,b)=>a-b), out.statsPack);

        if (runtimeXX.enabled && runtimeXX.weightedPick && runtimeXX.pack && window.Xuanxue) {
          const hit = window.Xuanxue.explainXuanxueHit(numsSortedLocal, runtimeXX.pack);
          if (hit) {
            if (runtimeXX.explainLevel !== "compact") {
              exp.chips.unshift(`玄學：幸運命中${hit.luckyHit}｜靈感命中${hit.inspirationHit}`);
            }
            if (runtimeXX.explainLevel === "detailed") {
              exp.chips.unshift(`四源命中：五行${hit.wux}｜易卦${hit.gua}｜九宮${hit.star}｜生肖${hit.zod}`);
            }
          }
        }

        box.appendChild(renderSummaryLine(exp.summary));

        const bets = nCk(t.nums.length, 6);
        const info = document.createElement("div");
        info.className = "muted";
        info.style.marginTop = "6px";
        info.textContent = `共 ${bets} 注｜金額 $${bets * PRICE_PER_BET}`;
        box.appendChild(info);

        const chips = renderChips(exp.chips);
        if (chips) box.appendChild(chips);

        // ✅ 逐粒玄學解釋
        if (runtimeXX.enabled && runtimeXX.weightedPick && runtimeXX.pack && window.Xuanxue && window.Xuanxue.explainTicket) {
          const xxExp = window.Xuanxue.explainTicket(numsSortedLocal, runtimeXX.pack, runtimeXX.explainLevel);
          const xxBox = renderXuanxueExplain(xxExp && xxExp.lines);
          if (xxBox) box.appendChild(xxBox);
        }
      }

      if (t.kind === "danTuo") {
        box.appendChild(renderBallsRow(t.dan, `膽（${t.dan.length}）`));
        box.appendChild(renderBallsRow(t.tuo, `腳／拖（${t.tuo.length}${t.isFullTuo ? "｜全餐" : ""}）`));
      
        // v2.1: split summaries + overall
        const danExp = explainNums(t.dan.slice().sort((a,b)=>a-b), out.statsPack);
        const tuoExp = explainNums(t.tuo.slice().sort((a,b)=>a-b), out.statsPack);
        const allExp = explainNums(t.all.slice().sort((a,b)=>a-b), out.statsPack);
      
        // ✅ 玄學命中：如果腳全餐，只加落「膽」；否則照舊用全組
        if (runtimeXX.enabled && runtimeXX.weightedPick && runtimeXX.pack && window.Xuanxue) {
          const targetNums = (t.isFullTuo ? t.dan : t.all).slice().sort((a,b)=>a-b);
          const hit = window.Xuanxue.explainXuanxueHit(targetNums, runtimeXX.pack);
          if (hit) {
            const prefix = t.isFullTuo ? "（膽）" : "";
            if (runtimeXX.explainLevel !== "compact") {
              (t.isFullTuo ? danExp : allExp).chips.unshift(`玄學${prefix}：幸運命中${hit.luckyHit}｜靈感命中${hit.inspirationHit}`);
            }
            if (runtimeXX.explainLevel === "detailed") {
              (t.isFullTuo ? danExp : allExp).chips.unshift(`四源命中${prefix}：五行${hit.wux}｜易卦${hit.gua}｜九宮${hit.star}｜生肖${hit.zod}`);
            }
          }
        }
      
        const s1 = document.createElement("div");
        s1.className = "muted";
        s1.style.marginTop = "6px";
        s1.textContent = `膽：${danExp.summary}`;
        box.appendChild(s1);
      
        const s2 = document.createElement("div");
        s2.className = "muted";
        s2.style.marginTop = "4px";
        s2.textContent = `腳：${tuoExp.summary}`;
        box.appendChild(s2);
      
        const s3 = document.createElement("div");
        s3.className = "muted";
        s3.style.marginTop = "4px";
        s3.textContent = `全組（膽+腳）：${allExp.summary}`;
        box.appendChild(s3);
      
        const bets = danTuoBets(t.dan.length, t.tuo.length);
        const info = document.createElement("div");
        info.className = "muted";
        info.style.marginTop = "6px";
        info.textContent = `共 ${bets} 注｜金額 $${bets * PRICE_PER_BET}`;
        box.appendChild(info);
      
        // ✅ chips：腳全餐 -> 用 danExp.chips；否則用 allExp.chips
        const chips = renderChips(t.isFullTuo ? danExp.chips : allExp.chips);
        if (chips) box.appendChild(chips);
      
        // ✅ 逐粒玄學解釋：腳全餐 -> 只解釋膽；否則解釋全組
        if (runtimeXX.enabled && runtimeXX.weightedPick && runtimeXX.pack && window.Xuanxue && window.Xuanxue.explainTicket) {
          const xxNums = (t.isFullTuo ? t.dan : t.all).slice().sort((a,b)=>a-b);
          const xxExp = window.Xuanxue.explainTicket(xxNums, runtimeXX.pack, runtimeXX.explainLevel);
          const xxBox = renderXuanxueExplain(xxExp && xxExp.lines);
          if (xxBox) box.appendChild(xxBox);
        }
      }

      // ✅ 5膽全餐（基本買法，多組）：顯示 膽 + 腳（不列 44 注）
      if (t.kind === "full5dan") {
        box.appendChild(renderBallsRow(t.dan, `膽（5）`));
        box.appendChild(renderBallsRow(t.legs, `腳（44）`));
      
        const danExp = explainNums(t.dan.slice().sort((a,b)=>a-b), out.statsPack);
        const legsExp = explainNums(t.legs.slice().sort((a,b)=>a-b), out.statsPack);
        const allExp = explainNums(t.all.slice().sort((a,b)=>a-b), out.statsPack);
      
        // ✅ 玄學命中：只加落「膽」
        if (runtimeXX.enabled && runtimeXX.weightedPick && runtimeXX.pack && window.Xuanxue) {
          const hit = window.Xuanxue.explainXuanxueHit(t.dan.slice().sort((a,b)=>a-b), runtimeXX.pack);
          if (hit) {
            const prefix = "（膽）";
            if (runtimeXX.explainLevel !== "compact") {
              danExp.chips.unshift(`玄學${prefix}：幸運命中${hit.luckyHit}｜靈感命中${hit.inspirationHit}`);
            }
            if (runtimeXX.explainLevel === "detailed") {
              danExp.chips.unshift(`四源命中${prefix}：五行${hit.wux}｜易卦${hit.gua}｜九宮${hit.star}｜生肖${hit.zod}`);
            }
          }
        }
      
        const s1 = document.createElement("div");
        s1.className = "muted";
        s1.style.marginTop = "6px";
        s1.textContent = `膽：${danExp.summary}`;
        box.appendChild(s1);
      
        const s2 = document.createElement("div");
        s2.className = "muted";
        s2.style.marginTop = "4px";
        s2.textContent = `腳：${legsExp.summary}`;
        box.appendChild(s2);
      
        const s3 = document.createElement("div");
        s3.className = "muted";
        s3.style.marginTop = "4px";
        s3.textContent = `全組（膽+腳）：${allExp.summary}`;
        box.appendChild(s3);
      
        const info = document.createElement("div");
        info.className = "muted";
        info.style.marginTop = "6px";
        info.textContent = `共 44 注｜金額 $${44 * PRICE_PER_BET}`;
        box.appendChild(info);
      
        // ✅ chips：只顯示「膽」的 chips
        const chips = renderChips(danExp.chips);
        if (chips) box.appendChild(chips);
      
        // ✅ 逐粒玄學解釋：只解釋膽
        if (runtimeXX.enabled && runtimeXX.weightedPick && runtimeXX.pack && window.Xuanxue && window.Xuanxue.explainTicket) {
          const xxNums = t.dan.slice().sort((a,b)=>a-b);
          const xxExp = window.Xuanxue.explainTicket(xxNums, runtimeXX.pack, runtimeXX.explainLevel);
          const xxBox = renderXuanxueExplain(xxExp && xxExp.lines);
          if (xxBox) box.appendChild(xxBox);
        }
      }


      result.appendChild(box);
    });
  }

  function renderFullMeal(out) {
    clearResult();

    const head = document.createElement("div");
    head.className = "muted";

    const title =
      out.kind === "full9" ? "9注全餐（1 套）" :
      "17注全餐（1 套）";

    head.innerHTML = out.strict
      ? `生成方式：<b>${title}</b> + 嚴格條件（已套用）｜嘗試 ${out.attempts} 次`
      : `生成方式：<b>${title}</b>（純隨機）`;
    result.appendChild(head);

    // ---- Xuanxue header (for full meal too) ----
    if (runtimeXX.enabled) {
      const xxHead = document.createElement("div");
      xxHead.className = "muted";
      xxHead.style.marginTop = "6px";
      xxHead.style.lineHeight = "1.4";

      const luck = runtimeXX.luck;
      const luckText = (luck && luck.time)
        ? `幸運下注時間：${luck.time.join(" 或 ")}｜幸運方位：${luck.direction}｜建議：${luck.channel}｜${luck.shopHint}`
        : "";

      const seedText = runtimeXX.weightedPick
        ? `取號種子：${seedModeLabel(runtimeXX.seedMode)}`
        : "";

      xxHead.innerHTML =
        `<b>玄學提示</b><br>` +
        `${runtimeXX.weightedPick ? "取號：已啟用四源加權（五行/易卦/九宮/生肖）" : "取號：未啟用四源加權（保持隨機）"}<br>` +
        `${seedText ? (seedText + "<br>") : ""}` +
        `${luckText}`;

      result.appendChild(xxHead);
    }

    const bets = out.bets || [];
    bets.forEach((nums, idx) => {
      const box = document.createElement("div");
      box.className = "resultSet";
      box.innerHTML = `<div><b>第 ${idx + 1} 注</b></div>`;
      box.appendChild(renderBallsRow(nums));

      const numsSortedLocal = nums.slice().sort((a,b)=>a-b);
      const exp = explainNums(numsSortedLocal, out.statsPack);

      if (runtimeXX.enabled && runtimeXX.weightedPick && runtimeXX.pack && window.Xuanxue) {
        const hit = window.Xuanxue.explainXuanxueHit(numsSortedLocal, runtimeXX.pack);
        if (hit) {
          if (runtimeXX.explainLevel !== "compact") {
            exp.chips.unshift(`玄學：幸運命中${hit.luckyHit}｜靈感命中${hit.inspirationHit}`);
          }
          if (runtimeXX.explainLevel === "detailed") {
            exp.chips.unshift(`四源命中：五行${hit.wux}｜易卦${hit.gua}｜九宮${hit.star}｜生肖${hit.zod}`);
          }
        }
      }

      box.appendChild(renderSummaryLine(exp.summary));
      const chips = renderChips(exp.chips);
      if (chips) box.appendChild(chips);

      // ✅ 逐粒玄學解釋
      if (runtimeXX.enabled && runtimeXX.weightedPick && runtimeXX.pack && window.Xuanxue && window.Xuanxue.explainTicket) {
        const xxExp = window.Xuanxue.explainTicket(numsSortedLocal, runtimeXX.pack, runtimeXX.explainLevel);
        const xxBox = renderXuanxueExplain(xxExp && xxExp.lines);
        if (xxBox) box.appendChild(xxBox);
      }

      result.appendChild(box);
    });
  }

  // ---------- Actions ----------
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
    }[c]));
  }

  async function onGenerate() {
    try {
      btnGenerate.disabled = true;

      if (hotMin.value || hotMax.value || coldMin.value || coldMax.value) {
        const n = Number(statN.value);
        if (!N_ALLOWED.includes(n)) throw new Error("Invalid N");
        await getStats(n);
      }

      // ---------- Xuanxue runtime setup ----------
      runtimeXX.enabled = false;
      runtimeXX.autoPlan = false;
      runtimeXX.weightedPick = false;
      runtimeXX.excludeSet = null;
      runtimeXX.pack = null;
      runtimeXX.plan = null;
      runtimeXX.luck = null;
      runtimeXX.explainLevel = "standard";
      runtimeXX.seedMode = "click";
      runtimeXX.seedFinal = null;

      const xx = getXuanxueState();
      if (xx && xx.enabled) {
        runtimeXX.enabled = true;
        runtimeXX.autoPlan = !!xx.autoPlan;
        runtimeXX.weightedPick = !!xx.weightedPick;
        runtimeXX.explainLevel = xx.explainLevel || "standard";

        // build exclude set (禁忌 + 排除4尾)
        if (window.Xuanxue) {
          const forbidden = window.Xuanxue.parseNumList(xx.forbidden, 10);
          const ex = new Set(forbidden);
          if (xx.excludeTail4) [4,14,24,34,44].forEach(n => ex.add(n));
          runtimeXX.excludeSet = ex;
        }
      }

      // ---------- Auto Plan behavior ----------
      // 規則：buyMode=autoPlan 時，強制開啟 xxAutoPlan（即使 user 未 tick）
      const chosenMode = buyMode.value;
      const wantAutoPlan = (chosenMode === "autoPlan") || (runtimeXX.enabled && runtimeXX.autoPlan);

      if (wantAutoPlan && window.Xuanxue) {
        const level = computeLevel();
        const maxAllowed = maxSetsAllowedByLevel(level);

        // 用玄學 state xx 作 plan 參數
        const plan = window.Xuanxue.recommendPlan(xx, maxAllowed);
        runtimeXX.plan = plan;

        // 回填到你現有 UI state
        // plan.mode: single/multi/danTuo/full5dan
        buyMode.value = plan.mode;

        // setCount：回填 m（注意：若嚴格 level cap 會縮）
        setCount.disabled = false; // 先解 lock，等 updateSetCountOptions 正確重建 options
        updateSetCountOptions();

        // setCount options 已重建後再 set
        const maxNow = Number(setCount.options[setCount.options.length - 1]?.value || 1);
        const mFinal = Math.max(1, Math.min(plan.m || 1, maxNow));
        setCount.value = String(mFinal);

        // 回填 multi/danTuo 參數
        if (plan.mode === "multi") {
          multiN.value = String(plan.n || 7);
        }
        if (plan.mode === "danTuo") {
          danN.value = String(plan.d || 2);
          updateTuoOptions();
          tuoN.value = String(plan.t || 6);
        }

        // UI preview
        if (xxPlanPreview) {
          xxPlanPreview.textContent =
            `建議買法：${plan.mode === "single" ? `單式 ${mFinal} 注` :
              plan.mode === "multi" ? `${plan.n} 碼複式 × ${mFinal} 組` :
              plan.mode === "danTuo" ? `${plan.d} 膽 + ${plan.t} 拖 × ${mFinal} 組` :
              `5膽全餐 × ${mFinal} 組`
            }（約 $${plan.cost || ""}）｜原因：${plan.reason || ""}`;
        }
      }

      // ---------- Xuanxue weighted pack (for weighted picking) ----------
      let cachedStatsPack = null;
      const nForStats = Number(statN.value || 30);
      if (statsCache.has(nForStats)) cachedStatsPack = statsCache.get(nForStats);

      if (runtimeXX.enabled && runtimeXX.weightedPick && window.Xuanxue) {
        // 1) build base weights pack（seed 係「每日 + 輸入」）
        runtimeXX.pack = window.Xuanxue.buildWeights(xx, cachedStatsPack);

        // 2) ✅ (2)(3) reseed：click / time_minute / time_shichen
        //    - 若冇 UI，就預設 click
        const seedMode = (xxSeedMode && xxSeedMode.value) ? xxSeedMode.value : "click";
        runtimeXX.seedMode = seedMode;

        let seed2 = (runtimeXX.pack && runtimeXX.pack.seed) ? (runtimeXX.pack.seed >>> 0) : 1234567;

        if (seedMode === "time_minute") {
          if (window.Xuanxue.deriveSeed) seed2 = window.Xuanxue.deriveSeed(seed2, "minute");
        } else if (seedMode === "time_shichen") {
          if (window.Xuanxue.deriveSeed) seed2 = window.Xuanxue.deriveSeed(seed2, "shichen");
        } else {
          // click：每次按都唔同（Date.now + counter）
          runtimeXX._clickSeq = (runtimeXX._clickSeq || 0) + 1;
          seed2 = (seed2 ^ (Date.now() & 0xffffffff) ^ (runtimeXX._clickSeq * 2654435761)) >>> 0;
        }

        runtimeXX.seedFinal = seed2;

        if (window.Xuanxue.reseedPack) {
          runtimeXX.pack = window.Xuanxue.reseedPack(runtimeXX.pack, seed2);
        }
      }

      // ---------- Luck context (time/direction/channel/shop) ----------
      if (runtimeXX.enabled && window.Xuanxue) {
        const seed = (runtimeXX.pack && Number.isFinite(runtimeXX.pack.seed)) ? runtimeXX.pack.seed : 1234567;
        runtimeXX.luck = window.Xuanxue.recommendLuckContext(seed);
      }

      const mode = buyMode.value;

      // ✅ 只有 9/17 全餐用 generateFullMeal（固定1套）
      if (isAdvancedBuyMode(mode)) {
        const out = await generateFullMeal(mode);
        renderFullMeal(out);
        showToast("已生成 1 套注單");
        return;
      }

      // ✅ 基本買法（包括 full5dan）：可 1–10 組（受 Level cap 影響）
      const desired = Number(setCount.value || 1);
      const out = await generateNormalTickets(desired);
      renderNormalTickets(out);
      showToast(out.strict ? "已按條件生成" : "已純隨機生成");
    } catch (e) {
      clearResult();
      const msg = (e && e.message) ? e.message : String(e);
      const box = document.createElement("div");
      box.className = "resultSet";
      box.innerHTML = `<div class="bad"><b>未能生成</b></div><div class="muted" style="margin-top:6px">${escapeHtml(msg)}</div>`;
      result.appendChild(box);
      showToast("生成失敗（請放寬條件）");
    } finally {
      btnGenerate.disabled = false;
    }
  }

  function onClear() {
    clearResult();
    showToast("已清空");
  }

  // ---------- Events ----------
  const inputs = [
    buyMode, setCount, multiN, danN, tuoN,
    maxConsec, avoidAllOddEven, maxTail, maxTensGroup, maxColor,
    eachColorAtLeast1, avoidColor, sumHigh, sumLow,
    statN, hotMin, hotMax, coldMin, coldMax,
    overlapMax
  ];

  // ✅ 4.12：將玄學 inputs 加入監聽（存在先加，避免 null）
  const xuanxueInputs = [
    xxAutoPlan, xxWeightedPick, xxMaxBudget, xxRiskLevel,
    xxDobPrecA, xxDobA, xxGenderA,
    xxEnableB, xxDobPrecB, xxDobB, xxGenderB, xxBlend,
    xxLucky, xxForbidden, xxExcludeTail4, xxInspiration,
    xxEngineWuxing, xxEngineGua, xxEngineStar9, xxEngineZodiac,
    xxStrength, xxExplainLevel,
    xxApplyPlan,
    xxSeedMode, // ✅ seed mode selector
  ].filter(Boolean);

  inputs.concat(xuanxueInputs).forEach((x) => x.addEventListener("change", updateSetCountOptions));

  danN.addEventListener("change", () => {
    updateTuoOptions();
    updateSetCountOptions();
  });

  buyMode.addEventListener("change", () => {
    if (buyMode.value === "danTuo") updateTuoOptions();
    updateSetCountOptions();
  });

  btnGenerate.addEventListener("click", onGenerate);
  btnClear.addEventListener("click", onClear);

  // ---------- init ----------
  // Advanced: remove "最多1" => only Off / 2 / 3
  setOptions2(maxConsec, withOff([2, 3], "Off"), true);
  setOptions2(maxTail, withOff([2, 3], "Off"), true);

  initBasicSelectOptions();
  setOptions2(setCount, Array.from({ length: 10 }, (_, i) => i + 1), true);

  updateSetCountOptions();
})();
