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

  // ---------- Constants ----------
  const N_ALLOWED = [10, 20, 30, 60, 100];
  const K = 10;
  const PRICE_PER_BET = 10;

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
  const statsCache = new Map(); // n -> {topSet, bottomSet, top10, bottom10, freq}
  async function getStats(n) {
    if (statsCache.has(n)) return statsCache.get(n);

    statStatus.textContent = "載入中…";
    const resp = await fetch(`/api/stats?n=${n}`, { cache: "no-store" });
    const data = await resp.json();

    // Backward compatible: stats.js returns { picker: {...} } in our modified version.
    // If picker exists, use it. Otherwise fallback to old/unknown.
    const p = data && data.picker ? data.picker : data;

    if (!p || !p.ok) throw new Error((p && p.error) ? p.error : "Failed to load stats");

    const top10 = p.top10 || [];
    const bottom10 = p.bottom10 || [];

    const topSet = new Set(top10.map((x) => x.n));
    const bottomSet = new Set(bottom10.map((x) => x.n));

    const pack = {
      n: p.n || n,
      top10,
      bottom10,
      topSet,
      bottomSet,
      freq: p.freq || [],
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

  function setOptions(select, values, keepIfPossible = true) {
    const cur = select.value;
    select.innerHTML = "";
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = String(v);
      select.appendChild(opt);
    }
    if (keepIfPossible && values.map(String).includes(cur)) select.value = cur;
    else select.value = String(values[0] ?? "");
  }

  function isAdvancedBuyMode(mode) {
    return mode === "full9" || mode === "full17" || mode === "full5dan";
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

  // Level rules: 0 / 1 / 2 / 3 => max sets 10 / 10 / 5 / 1
  function computeLevel() {
    if (isAdvancedBuyMode(buyMode.value)) return 3; // advanced presets: force 1 set
    if (!anyAdvancedSelected()) return 0;

    let level = 1;
    let level2Count = 0;

    if (maxConsec.value) {
      const v = Number(maxConsec.value);
      if (v <= 2) { level = Math.max(level, 2); level2Count++; }
      else level = Math.max(level, 1);
    }

    if (maxTail.value) {
      const v = Number(maxTail.value);
      if (v <= 2) { level = Math.max(level, 2); level2Count++; }
      else level = Math.max(level, 1);
    }

    if (maxTensGroup.value) {
      const v = Number(maxTensGroup.value);
      if (v === 2) { level = Math.max(level, 2); level2Count++; }
      else level = Math.max(level, 1);
    }

    if (maxColor.value) {
      const v = Number(maxColor.value);
      if (v <= 3) { level = Math.max(level, 2); level2Count++; }
      else level = Math.max(level, 1);
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
      else level = Math.max(level, 1);
    }

    if (level2Count >= 3) level = Math.max(level, 3);

    return level;
  }

  function maxSetsAllowedByLevel(level) {
    if (level === 3) return 1;
    if (level === 2) return 5;
    return 10;
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

    if (isAdvancedBuyMode(buyMode.value)) {
      setCount.disabled = true;
      setOptions(setCount, [1]);
      setCountHint.textContent = "進階買法：每次只生成 1 套注單。";
      limitHint.textContent = "進階買法：固定只可生成 1 套。";
    } else {
      setCount.disabled = false;
      const opts = [];
      for (let i = 1; i <= Math.min(10, maxAllowed); i++) opts.push(i);
      setOptions(setCount, opts);

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

  function updateBuyModeUI() {
    const mode = buyMode.value;
    multiBox.classList.toggle("hidden", mode !== "multi");
    danBox.classList.toggle("hidden", mode !== "danTuo");
    tuoBox.classList.toggle("hidden", mode !== "danTuo");

    if (mode === "single") {
      buyModeHint.textContent = `每組 1 注（$${PRICE_PER_BET}）`;
    } else if (mode === "multi") {
      const n = Number(multiN.value);
      const bets = nCk(n, 6);
      buyModeHint.textContent = `${n} 碼複式：共 ${bets} 注`;
      multiCostHint.textContent = `金額：$${bets * PRICE_PER_BET}`;
    } else if (mode === "danTuo") {
      const d = Number(danN.value);
      const t = Number(tuoN.value);
      const need = 6 - d;
      const bets = t >= need ? nCk(t, need) : 0;
      buyModeHint.textContent = `${d} 膽 + ${t} 拖：共 ${bets} 注`;
      danTuoCostHint.textContent = bets > 0 ? `金額：$${bets * PRICE_PER_BET}` : "拖數不足，無法組合成 6 粒。";
    } else if (mode === "full9") {
      buyModeHint.textContent = "9注全餐：1 套 9 注（$90）";
    } else if (mode === "full17") {
      buyModeHint.textContent = "17注全餐：1 套 17 注（$170）";
    } else if (mode === "full5dan") {
      buyModeHint.textContent = "5 膽全餐：5 膽 + 44 拖（44 注，$440）";
    }
  }

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

  // ---------- Generator ----------
  function sample6() {
    const pool = Array.from({ length: 49 }, (_, i) => i + 1);
    shuffle(pool);
    return pool.slice(0, 6).sort((a, b) => a - b);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function overlapCount(a, b) {
    const s = new Set(a);
    let c = 0;
    for (const x of b) if (s.has(x)) c++;
    return c;
  }

  function maxConsecutiveRun(nums) {
    let best = 1, cur = 1;
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === nums[i - 1] + 1) {
        cur++;
        best = Math.max(best, cur);
      } else {
        cur = 1;
      }
    }
    return best;
  }

  function countsBy(items) {
    const m = new Map();
    for (const x of items) m.set(x, (m.get(x) || 0) + 1);
    return m;
  }

  function checkAdvancedConstraints(nums, statsPack) {
    if (maxConsec.value) {
      const lim = Number(maxConsec.value);
      if (maxConsecutiveRun(nums) > lim) return false;
    }

    if (avoidAllOddEven.checked) {
      const odd = nums.filter((x) => x % 2 === 1).length;
      if (odd === 0 || odd === 6) return false;
    }

    if (maxTail.value) {
      const lim = Number(maxTail.value);
      const tails = nums.map((x) => x % 10);
      const m = countsBy(tails);
      for (const v of m.values()) if (v > lim) return false;
    }

    if (maxTensGroup.value) {
      const lim = Number(maxTensGroup.value);
      const groups = nums.map(tensGroupOf);
      const m = countsBy(groups);
      for (const v of m.values()) if (v > lim) return false;
    }

    const cols = nums.map(colorOf);
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

    const sum = nums.reduce((a, b) => a + b, 0);
    if (sumHigh.checked && !(sum > 147)) return false;
    if (sumLow.checked && !(sum < 147)) return false;

    if (hotMin.value || hotMax.value || coldMin.value || coldMax.value) {
      if (!statsPack) return false;

      const topSet = statsPack.topSet;
      const bottomSet = statsPack.bottomSet;

      const hotHit = nums.filter((x) => topSet.has(x)).length;
      const coldHit = nums.filter((x) => bottomSet.has(x)).length;

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

  function buildTags(nums, statsPack) {
    const tags = [];

    if (maxConsec.value) tags.push(`連號≤${maxConsec.value}（實際${maxConsecutiveRun(nums)}）`);

    if (avoidAllOddEven.checked) {
      const odd = nums.filter((x) => x % 2 === 1).length;
      tags.push(`奇偶：${odd}單${6 - odd}雙（避免全單/全雙）`);
    }

    if (maxTail.value) {
      const tails = nums.map((x) => x % 10);
      const m = countsBy(tails);
      const maxV = Math.max(...m.values());
      tags.push(`同尾≤${maxTail.value}（實際最大${maxV}）`);
    }

    const groups = nums.map(tensGroupOf);
    const gm = countsBy(groups);
    if (maxTensGroup.value) {
      const most = Math.max(...gm.values());
      tags.push(`十位段≤${maxTensGroup.value}（最集中${most}）`);
    }

    const cols = nums.map(colorOf);
    const cm = countsBy(cols);
    const red = cm.get("red") || 0;
    const blue = cm.get("blue") || 0;
    const green = cm.get("green") || 0;
    if (maxColor.value || eachColorAtLeast1.checked || avoidColor.value) {
      tags.push(`顏色：紅×${red} 藍×${blue} 綠×${green}`);
    }
    if (eachColorAtLeast1.checked) tags.push("每色≥1 ✅");
    if (maxColor.value) tags.push(`同色≤${maxColor.value} ✅`);
    if (avoidColor.value) tags.push(`避開${avoidColor.value === "red" ? "紅" : avoidColor.value === "blue" ? "藍" : "綠"}色 ✅`);

    const sum = nums.reduce((a, b) => a + b, 0);
    if (sumHigh.checked) tags.push(`總和>${147} ✅（${sum}）`);
    if (sumLow.checked) tags.push(`總和<${147} ✅（${sum}）`);

    if (statsPack && (hotMin.value || hotMax.value || coldMin.value || coldMax.value)) {
      const hotHit = nums.filter((x) => statsPack.topSet.has(x)).length;
      const coldHit = nums.filter((x) => statsPack.bottomSet.has(x)).length;
      tags.push(`近${statsPack.n}期：Top10命中${hotHit}，Bottom10命中${coldHit}`);
    }

    return tags;
  }

  async function generateNormalSets(desiredSets) {
    const strict = anyAdvancedSelected();
    const issues = hardConflicts();
    if (issues.length) throw new Error(issues.join(" / "));

    const level = computeLevel();
    const maxAllowed = maxSetsAllowedByLevel(level);
    const target = Math.min(desiredSets, maxAllowed);

    let statsPack = null;
    if (strict && (hotMin.value || hotMax.value || coldMin.value || coldMax.value)) {
      const n = Number(statN.value);
      statsPack = await getStats(n);
    }

    const overlapK = overlapMax.value === "" ? null : Number(overlapMax.value);

    const sets = [];
    const ATTEMPT_LIMIT = 80000;
    let attempts = 0;

    while (sets.length < target && attempts < ATTEMPT_LIMIT) {
      attempts++;
      const nums = sample6();

      if (strict) {
        if (!checkAdvancedConstraints(nums, statsPack)) continue;

        if (overlapK !== null) {
          let ok = true;
          for (const prev of sets) {
            if (overlapCount(prev, nums) > overlapK) { ok = false; break; }
          }
          if (!ok) continue;
        }
      }

      sets.push(nums);
    }

    if (sets.length < target) {
      throw new Error(
        `條件較嚴格，嘗試 ${attempts} 次後仍未能生成足夠組合（已生成 ${sets.length}/${target}）。` +
        ` 建議：降低組數、放寬多樣性、或取消部分限制。`
      );
    }

    return { sets, strict, statsPack, level, maxAllowed, attempts };
  }

  // Full-meal presets
  async function generateFullMeal(mode) {
    const strict = anyAdvancedSelected();
    const issues = hardConflicts();
    if (issues.length) throw new Error(issues.join(" / "));

    let statsPack = null;
    if (strict && (hotMin.value || hotMax.value || coldMin.value || coldMax.value)) {
      statsPack = await getStats(Number(statN.value));
    }

    const PACK_ATTEMPT_LIMIT = 4000;

    for (let t = 0; t < PACK_ATTEMPT_LIMIT; t++) {
      let bets = [];

      if (mode === "full9") {
        bets = buildPack9();     // ✅ fixed rule
      } else if (mode === "full17") {
        bets = buildPack17();    // ✅ fixed rule
      } else if (mode === "full5dan") {
        bets = buildPack5dan();
      }

      if (!strict) return { bets, strict, statsPack, attempts: t + 1 };

      let ok = true;
      for (const b of bets) {
        const nums = [...b].sort((a, c) => a - c);
        if (!checkAdvancedConstraints(nums, statsPack)) { ok = false; break; }
      }
      if (ok) return { bets, strict, statsPack, attempts: t + 1 };
    }

    throw new Error("全餐套用嚴格條件後仍未能生成。建議取消部分條件，或先用「基本買法」。");
  }

  // ---------- 9注/17注全餐：正確規則 + 驗證 ----------
  function buildPack9() {
    // Rule:
    // 1) Bets 1-8: 48 numbers no-repeat across these 8 bets
    // 2) Bet 9: the remaining 1 number + 5 numbers chosen from the 48 (duplicates)
    // Result distribution: 44 numbers appear once, 5 numbers appear twice.
    const pool = Array.from({ length: 49 }, (_, i) => i + 1);
    shuffle(pool);

    const A48 = pool.slice(0, 48);
    const x = pool[48];

    const bets = [];
    for (let i = 0; i < 8; i++) {
      bets.push(A48.slice(i * 6, i * 6 + 6).sort((a, b) => a - b));
    }

    const tmp = [...A48];
    shuffle(tmp);
    const R5 = tmp.slice(0, 5);

    bets.push([x, ...R5].sort((a, b) => a - b));

    // Validate (safety)
    if (!validatePack9(bets)) {
      // extremely unlikely unless bug; regenerate recursively
      return buildPack9();
    }
    return bets;
  }

  function buildPack17() {
    // Confirmed rule (your final spec):
    // - First 8 bets: 48 numbers no-repeat
    // - Bet 9: remaining x + 5 numbers (R5) chosen from first 48 (duplicates)
    // - Bets 10-16: choose 42 numbers from the 44 "appear-once" numbers (i.e. exclude R5),
    //              distribute into 7 bets of 6 (no repeats), leaving L2 (2 numbers) still once.
    // - Bet 17: L2 + 4 numbers randomly selected from the other 47 numbers (exclude L2).
    // Result distribution: 45 numbers appear twice, 4 numbers appear three times.
    const MAX_TRY = 200; // local retries for safety
    for (let attempt = 0; attempt < MAX_TRY; attempt++) {
      const pool = Array.from({ length: 49 }, (_, i) => i + 1);
      shuffle(pool);

      const A48 = pool.slice(0, 48);
      const x = pool[48];

      // Bets 1-8
      const bets = [];
      for (let i = 0; i < 8; i++) {
        bets.push(A48.slice(i * 6, i * 6 + 6).sort((a, b) => a - b));
      }

      // Choose R5 from A48
      const tmp = [...A48];
      shuffle(tmp);
      const R5 = tmp.slice(0, 5);
      const R5set = new Set(R5);

      // Bet 9 = x + R5
      bets.push([x, ...R5].sort((a, b) => a - b));

      // The 44 "appear-once after 9 bets" numbers are U \ R5
      const U49 = Array.from({ length: 49 }, (_, i) => i + 1);
      const S44 = U49.filter((n) => !R5set.has(n)); // size 44

      // Pick T42 from S44 for bets 10-16
      const sTmp = [...S44];
      shuffle(sTmp);
      const T42 = sTmp.slice(0, 42);
      const L2 = sTmp.slice(42); // exactly 2

      // Bets 10-16: chunk T42 into 7 bets
      for (let i = 0; i < 7; i++) {
        bets.push(T42.slice(i * 6, i * 6 + 6).sort((a, b) => a - b));
      }

      // Bet 17: L2 + 4 from other 47 numbers (exclude L2)
      const L2set = new Set(L2);
      const rest47 = U49.filter((n) => !L2set.has(n)); // size 47
      shuffle(rest47);
      const pick4 = rest47.slice(0, 4);

      bets.push([...L2, ...pick4].sort((a, b) => a - b));

      // Validate distribution AND the key constraint:
      // bets 10-16 must NOT include any R5 number.
      if (!validatePack17(bets, R5set)) continue;

      return bets;
    }

    // If somehow failed all tries, fall back to a deterministic safe rebuild
    return buildPack17Fallback();
  }

  function buildPack17Fallback() {
    // Deterministic-style safe fallback (still random but more constrained):
    // Force selection paths that always satisfy the rule.
    while (true) {
      const pool = Array.from({ length: 49 }, (_, i) => i + 1);
      shuffle(pool);

      const A48 = pool.slice(0, 48);
      const x = pool[48];

      const bets = [];
      for (let i = 0; i < 8; i++) {
        bets.push(A48.slice(i * 6, i * 6 + 6).sort((a, b) => a - b));
      }

      const tmp = [...A48];
      shuffle(tmp);
      const R5 = tmp.slice(0, 5);
      const R5set = new Set(R5);

      bets.push([x, ...R5].sort((a, b) => a - b));

      const U49 = Array.from({ length: 49 }, (_, i) => i + 1);
      const S44 = U49.filter((n) => !R5set.has(n));
      shuffle(S44);

      const T42 = S44.slice(0, 42);
      const L2 = S44.slice(42); // 2 numbers

      for (let i = 0; i < 7; i++) {
        bets.push(T42.slice(i * 6, i * 6 + 6).sort((a, b) => a - b));
      }

      const L2set = new Set(L2);
      const rest47 = U49.filter((n) => !L2set.has(n));
      shuffle(rest47);
      const pick4 = rest47.slice(0, 4);

      bets.push([...L2, ...pick4].sort((a, b) => a - b));

      if (validatePack17(bets, R5set)) return bets;
    }
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
    // Expect: 44 numbers appear once, 5 numbers appear twice
    return ones === 44 && twos === 5 && other === 0;
  }

  function validatePack17(bets, R5set) {
    if (!Array.isArray(bets) || bets.length !== 17) return false;
    const cnt = Array(50).fill(0);

    // Basic shape validation
    for (const b of bets) {
      if (!Array.isArray(b) || b.length !== 6) return false;
      const s = new Set(b);
      if (s.size !== 6) return false;
      for (const n of b) {
        if (!Number.isInteger(n) || n < 1 || n > 49) return false;
        cnt[n] += 1;
      }
    }

    // Key rule: bets 10-16 must not include R5 numbers
    // index: 0..16 => bets10-16 are indices 9..15
    if (R5set && typeof R5set.has === "function") {
      for (let i = 9; i <= 15; i++) {
        for (const n of bets[i]) {
          if (R5set.has(n))
