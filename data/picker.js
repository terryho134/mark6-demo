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
  const PRICE_PER_BET = 10;
  const AVG = 24.5;

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

  // ---------- Basic: dynamic options ----------
  function initBasicSelectOptions() {
    setOptions2(multiN, Array.from({ length: 9 }, (_, i) => 7 + i)); // 7–15
    setOptions2(danN, [1, 2, 3, 4, 5]);
    updateTuoOptions();
  }

  function updateTuoOptions() {
    const d = Number(danN.value || 1);
    const minTuo = (d === 5) ? 2 : (6 - d);
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

    if (isAdvancedBuyMode(buyMode.value)) {
      setCount.disabled = true;
      setOptions2(setCount, [1]);
      setCountHint.textContent = "進階買法：每次只生成 1 套注單。";
      limitHint.textContent = "進階買法：固定只可生成 1 套。";
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
      const bets = danTuoBets(d, t);
      buyModeHint.textContent = `${d} 膽 + ${t} 拖：共 ${bets} 注`;
      danTuoCostHint.textContent = bets > 0 ? `金額：$${bets * PRICE_PER_BET}` : "拖數不足，無法組合成 6 粒。";
    } else if (mode === "full9") {
      buyModeHint.textContent = "9注全餐：1 套 9 注（$90）";
    } else if (mode === "full17") {
      buyModeHint.textContent = "17注全餐：1 套 17 注（$170）";
    } else if (mode === "full5dan") {
      buyModeHint.textContent = "5 膽全餐：5 膽 + 44 腳（44 注，$440）";
    }
  }

  // ---------- Random helpers ----------
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function sampleDistinct(k, excludeSet = null) {
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

  function countsBy(items) {
    const m = new Map();
    for (const x of items) m.set(x, (m.get(x) || 0) + 1);
    return m;
  }

  // ---------- Constraints ----------
  function checkAdvancedConstraints(numsSorted, statsPack) {
    // numsSorted can be 6 / 7–15 / dan+tuo length, etc.
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

  function buildTags(numsSorted, statsPack) {
    const tags = [];

    if (maxConsec.value) tags.push(`連號≤${maxConsec.value}（實際${maxConsecutiveRun(numsSorted)}）`);

    if (avoidAllOddEven.checked) {
      const odd = numsSorted.filter((x) => x % 2 === 1).length;
      tags.push(`奇偶：${odd}單${numsSorted.length - odd}雙（避免全單/全雙）`);
    }

    if (maxTail.value) {
      const tails = numsSorted.map((x) => x % 10);
      const m = countsBy(tails);
      const maxV = Math.max(...m.values());
      tags.push(`同尾≤${maxTail.value}（實際最大${maxV}）`);
    }

    if (maxTensGroup.value) {
      const groups = numsSorted.map(tensGroupOf);
      const gm = countsBy(groups);
      const most = Math.max(...gm.values());
      tags.push(`十位段≤${maxTensGroup.value}（最集中${most}）`);
    }

    const cols = numsSorted.map(colorOf);
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

    const sum = numsSorted.reduce((a, b) => a + b, 0);
    const pivot = AVG * numsSorted.length;
    if (sumHigh.checked) tags.push(`平均>${AVG} ✅（總和${sum}）`);
    if (sumLow.checked) tags.push(`平均<${AVG} ✅（總和${sum}）`);

    if (statsPack && (hotMin.value || hotMax.value || coldMin.value || coldMax.value)) {
      const hotHit = numsSorted.filter((x) => statsPack.topSet.has(x)).length;
      const coldHit = numsSorted.filter((x) => statsPack.bottomSet.has(x)).length;
      tags.push(`近${statsPack.n}期：Top10命中${hotHit}，Bottom10命中${coldHit}`);
    }

    return tags;
  }

  // ---------- Ticket generators ----------
  function buildTicketByMode(mode) {
    if (mode === "single") {
      const nums = sampleDistinct(6);
      return { kind: "single", nums, keyNums: nums };
    }

    if (mode === "multi") {
      const n = Number(multiN.value);
      const nums = sampleDistinct(n);
      return { kind: "multi", nums, keyNums: nums };
    }

    if (mode === "danTuo") {
      const d = Number(danN.value);
      const t = Number(tuoN.value);
      const dan = sampleDistinct(d);
      const danSet = new Set(dan);
      const tuo = sampleDistinct(t, danSet);
      const all = [...dan, ...tuo].sort((a, b) => a - b);
      return { kind: "danTuo", dan, tuo, all, keyNums: all };
    }

    // should not hit here for full meals
    const nums = sampleDistinct(6);
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
    if (strict && (hotMin.value || hotMax.value || coldMin.value || coldMax.value)) {
      statsPack = await getStats(Number(statN.value));
    }

    const overlapK = overlapMax.value === "" ? null : Number(overlapMax.value);

    const tickets = [];
    const ATTEMPT_LIMIT = 120000;
    let attempts = 0;

    while (tickets.length < target && attempts < ATTEMPT_LIMIT) {
      attempts++;

      const t = buildTicketByMode(buyMode.value);
      const numsSorted = (t.keyNums || []).slice().sort((a, b) => a - b);

      if (strict) {
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

  // ---------- Full meal generators ----------
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
      if (mode === "full5dan") {
        const dan = sampleDistinct(5);
        const danSet = new Set(dan);
        const legs = [];
        for (let i = 1; i <= 49; i++) if (!danSet.has(i)) legs.push(i);
        const all = [...dan, ...legs].sort((a, b) => a - b);

        if (!strict) return { kind: "full5dan", dan, legs, all, strict, statsPack, attempts: t + 1 };

        // strict: apply constraints to the whole selected set (dan+legs)
        if (checkAdvancedConstraints(all, statsPack)) {
          return { kind: "full5dan", dan, legs, all, strict, statsPack, attempts: t + 1 };
        }
        continue;
      }

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

  // ---------- 9/17 packs (already validated correct) ----------
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
      const S44 = U49.filter((n) => !R5set.has(n)); // exclude R5

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
    return buildPack17(); // retry hard if extremely unlucky
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

    // bets 10-16 indices 9..15 must not include R5
    for (let i = 9; i <= 15; i++) for (const n of bets[i]) if (R5set.has(n)) return false;

    let twos = 0, threes = 0, other = 0;
    for (let i = 1; i <= 49; i++) {
      if (cnt[i] === 2) twos++;
      else if (cnt[i] === 3) threes++;
      else other++;
    }
    return twos === 45 && threes === 4 && other === 0;
  }

  // ---------- Render helpers ----------
  function clearResult() { result.innerHTML = ""; }

  function renderBallsRow(nums, labelText = "") {
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
      row.appendChild(b);
    });
    wrap.appendChild(row);
    return wrap;
  }

  function renderTags(tags) {
    if (!tags || !tags.length) return null;
    const tagsRow = document.createElement("div");
    tagsRow.className = "tags";
    for (const t of tags) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = t;
      tagsRow.appendChild(tag);
    }
    return tagsRow;
  }

  // ---------- Render normal tickets (single/multi/danTuo) ----------
  function renderNormalTickets(out) {
    clearResult();

    const head = document.createElement("div");
    head.className = "muted";
    head.innerHTML = out.strict
      ? `生成方式：<b>嚴格條件生成</b>（Level ${out.level}，最多 ${out.maxAllowed} 組）｜已生成 ${out.tickets.length} 組｜嘗試 ${out.attempts} 次`
      : `生成方式：<b>純隨機</b>｜已生成 ${out.tickets.length} 組`;
    result.appendChild(head);

    out.tickets.forEach((t, idx) => {
      const box = document.createElement("div");
      box.className = "resultSet";

      // Header line
      const title = document.createElement("div");
      title.innerHTML = `<b>第 ${idx + 1} 組</b>`;
      box.appendChild(title);

      if (t.kind === "single") {
        box.appendChild(renderBallsRow(t.nums));
        const tags = buildTags(t.nums, out.statsPack);
        const tagsNode = renderTags(tags);
        if (tagsNode) box.appendChild(tagsNode);
      }

      if (t.kind === "multi") {
        box.appendChild(renderBallsRow(t.nums, `複式：${t.nums.length} 碼`));
        const bets = nCk(t.nums.length, 6);
        const cost = bets * PRICE_PER_BET;
        const info = document.createElement("div");
        info.className = "muted";
        info.style.marginTop = "6px";
        info.textContent = `共 ${bets} 注｜金額 $${cost}`;
        box.appendChild(info);

        const tags = buildTags(t.nums, out.statsPack);
        const tagsNode = renderTags(tags);
        if (tagsNode) box.appendChild(tagsNode);
      }

      if (t.kind === "danTuo") {
        box.appendChild(renderBallsRow(t.dan, `膽（${t.dan.length}）`));
        box.appendChild(renderBallsRow(t.tuo, `腳／拖（${t.tuo.length}）`));

        const bets = danTuoBets(t.dan.length, t.tuo.length);
        const cost = bets * PRICE_PER_BET;
        const info = document.createElement("div");
        info.className = "muted";
        info.style.marginTop = "6px";
        info.textContent = `共 ${bets} 注｜金額 $${cost}`;
        box.appendChild(info);

        // tags based on all selected numbers
        const tags = buildTags(t.all, out.statsPack);
        const tagsNode = renderTags(tags);
        if (tagsNode) box.appendChild(tagsNode);
      }

      result.appendChild(box);
    });
  }

  // ---------- Render full meals ----------
  function renderFullMeal(out) {
    clearResult();

    // Head
    const head = document.createElement("div");
    head.className = "muted";

    const title =
      out.kind === "full9" ? "9注全餐（1 套）" :
      out.kind === "full17" ? "17注全餐（1 套）" :
      "5 膽全餐（1 套）";

    head.innerHTML = out.strict
      ? `生成方式：<b>${title}</b> + 嚴格條件（已套用）｜嘗試 ${out.attempts} 次`
      : `生成方式：<b>${title}</b>（純隨機）`;
    result.appendChild(head);

    // ✅ 5膽全餐：只顯示膽＋腳（不列 44 注）
    if (out.kind === "full5dan") {
      const box = document.createElement("div");
      box.className = "resultSet";
      box.innerHTML = `<div><b>5 膽全餐</b></div>`;

      box.appendChild(renderBallsRow(out.dan, `膽（5）`));
      box.appendChild(renderBallsRow(out.legs, `腳（44）`));

      const info = document.createElement("div");
      info.className = "muted";
      info.style.marginTop = "6px";
      info.textContent = `共 44 注｜金額 $${44 * PRICE_PER_BET}`;
      box.appendChild(info);

      // tags based on all selected numbers (49)
      const tags = buildTags(out.all, out.statsPack);
      const tagsNode = renderTags(tags);
      if (tagsNode) box.appendChild(tagsNode);

      result.appendChild(box);
      return;
    }

    // 9/17 全餐：仍然列出每一注（9 或 17 注可接受）
    const bets = out.bets || [];
    bets.forEach((nums, idx) => {
      const box = document.createElement("div");
      box.className = "resultSet";
      box.innerHTML = `<div><b>第 ${idx + 1} 注</b></div>`;
      box.appendChild(renderBallsRow(nums));
      const tags = buildTags(nums, out.statsPack);
      const tagsNode = renderTags(tags);
      if (tagsNode) box.appendChild(tagsNode);
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

      const mode = buyMode.value;

      if (isAdvancedBuyMode(mode)) {
        const out = await generateFullMeal(mode);
        renderFullMeal(out);
        showToast("已生成 1 套注單");
        return;
      }

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
  inputs.forEach((x) => x.addEventListener("change", updateSetCountOptions));

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
