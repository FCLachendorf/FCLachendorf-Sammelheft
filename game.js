"use strict";

/* =========================
   Konfiguration
   ========================= */
const LS_KEY = "fcl_lootgame_v1";
const PLAYER_COUNT = 25; // p01..p25

// ✅ Rabatt: 3%-Schritte bis max. 35%
const DISCOUNT_STEP = 0.03; // 3%
const DISCOUNT_MAX  = 0.35; // 35%
const MAX_DISCOUNT_LV = Math.ceil(DISCOUNT_MAX / DISCOUNT_STEP); // 12 (letzter Schritt wird auf 35% gecappt)

// ✅ Scout: bis max. 25% Verbesserung = Level 20
const SCOUT_MAX_LV = 20;
const SCOUT_MAX_BONUS = 0.25; // 25%

// ✅ Passiv: 25 Upgrades bis max. 1000/s (exponentiell, integer)
const IDLE_MAX_LV = 25;
const IDLE_MAX_PER_SEC = 1000;

// 0=locked, 1..25 => Werte (exponentiell, auf integer gerundet, strikt steigend, endet bei 1000)
const IDLE_VALUES = [
  0,
  1,   2,   4,   6,   8,
  11,  14,  19,  25,  32,
  40,  51,  65,  82,  104,
  131, 165, 207, 259, 325,
  407, 510, 639, 799, 1000
];

// Album: 3 Seiten, feste Reihenfolge
const ALBUM_PAGES = [
  ["p25", "p23", "p24",
   "p13", "p14", "p19",
   "p22", "p20", "p16"],

  ["p09", "p04", "p11",
   "p08", "p07", "p15",
   "p18", "p12", "p21"],

  ["p02", "p01", "p17",
   "p03", "p10", "p06",
   "p05", null, null],
];

const CHESTS = {
  common: {
    key: "common",
    title: "Sportbeutel",
    cards: 2,
    basePrice: 250,
    shinyBase: 0.015,
    shinyBoostIfNormal: 0.10,
    imgClosed: "assets/chests/chest_common_closed.png",
    imgOpen: "assets/chests/chest_common_open.png",
    bgOpen: "assets/bg/bg_common_1080x1920.png",
  },
  rare: {
    key: "rare",
    title: "Sporttasche",
    cards: 3,
    basePrice: 1000,
    shinyBase: 0.02,
    shinyBoostIfNormal: 0.13,
    imgClosed: "assets/chests/chest_rare_closed.png",
    imgOpen: "assets/chests/chest_rare_open.png",
    bgOpen: "assets/bg/bg_rare_1080x1920.png",
  },
  epic: {
    key: "epic",
    title: "Koffer",
    cards: 5,
    basePrice: 5000,
    shinyBase: 0.028,
    shinyBoostIfNormal: 0.16,
    imgClosed: "assets/chests/chest_epic_closed.png",
    imgOpen: "assets/chests/chest_epic_open.png",
    bgOpen: "assets/bg/bg_epic_1080x1920.png",
  },
};

const ASSETS = {
  bgMain: "assets/bg/bg_main_1080x1920.png",
  bgShop: "assets/bg/bg_shop_1080x1920.png",
  bgAlbum: "assets/bg/bg_album_1080x1920.png",

  dotEmpty: "assets/album/dot_empty.png",
  dotFilled: "assets/album/dot_filled.png",

  badgeNew: "assets/ui/badge_new.png",
  badgeShiny: "assets/ui/badge_shiny.png",
};

/* =========================
   Click FX Assets
   ========================= */
const CLICK_FX_SOURCES = [
  "assets/icons/icon_coin.png",
  "assets/fx/sparkle_1.png",
  "assets/fx/sparkle_2.png",
  "assets/fx/shiny_star.png",
];

/* =========================
   Helpers
   ========================= */
function pid(i) { return `p${String(i).padStart(2, "0")}`; }

function cardPath(id, suffix) {
  // suffix: "n" | "s" (klein jpg) | "l" (placeholder png)
  const ext = (suffix === "l") ? "png" : "jpg";
  return `assets/cards/${id}_${suffix}.${ext}`;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function now() { return performance.now(); }

function fmtPct(x) {
  const p = x * 100;
  const s = (Math.round(p * 10) / 10).toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function getDiscountFrac() {
  // ✅ 3%-Schritte, gecappt auf 35%
  return Math.min(DISCOUNT_MAX, state.discountLv * DISCOUNT_STEP);
}

function isDiscountMaxed() {
  return getDiscountFrac() >= (DISCOUNT_MAX - 1e-9);
}

function getScoutBonusFrac() {
  const lv = clamp(Number(state.scoutLv || 0), 0, SCOUT_MAX_LV);
  return SCOUT_MAX_BONUS * (lv / SCOUT_MAX_LV); // 0..0.25
}

function isScoutMaxed() {
  return (state.scoutLv ?? 0) >= SCOUT_MAX_LV;
}

function idleLevelFromPerSec(perSec) {
  if (!perSec || perSec <= 0) return 0;

  // exaktes Matching bevorzugen
  const exact = IDLE_VALUES.indexOf(perSec);
  if (exact >= 0) return clamp(exact, 0, IDLE_MAX_LV);

  // sonst: nächstliegendes Level
  let bestIdx = 1;
  let bestDiff = Infinity;
  for (let i = 1; i <= IDLE_MAX_LV; i++) {
    const d = Math.abs(IDLE_VALUES[i] - perSec);
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function isIdleMaxed() {
  return state.idlePerSec >= IDLE_MAX_PER_SEC || idleLevelFromPerSec(state.idlePerSec) >= IDLE_MAX_LV;
}

/* =========================================================
   State
   ========================================================= */
const DEFAULT_STATE = {
  coins: 80,
  clickPower: 1,
  idlePerSec: 0,
  discountLv: 0,
  scoutLv: 0,
  owned: {},      // owned[id] = { n,s, cn,cs }
  lastNew: [],
  seenNew: {},    // key "p01_n" => true (noch nicht angesehen)
};

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);

    const parsed = JSON.parse(raw);
    const st = { ...structuredClone(DEFAULT_STATE), ...parsed };

    st.owned ??= {};
    st.lastNew ??= [];
    st.seenNew ??= {};

    // ✅ Rabatt-Level clamp
    st.discountLv = clamp(Number(st.discountLv || 0), 0, MAX_DISCOUNT_LV);

    // ✅ Scout clamp (max 20)
    st.scoutLv = clamp(Number(st.scoutLv || 0), 0, SCOUT_MAX_LV);

    // ✅ ClickPower sanity
    if (typeof st.clickPower !== "number" || !Number.isFinite(st.clickPower)) st.clickPower = 1;
    st.clickPower = Math.max(1, Math.floor(st.clickPower));

    // ✅ Passive: Migration + clamp + Mapping auf neue 25er-Kurve
    if (typeof st.idlePerSec !== "number" || !Number.isFinite(st.idlePerSec)) st.idlePerSec = 0;
    st.idlePerSec = Math.max(0, Math.floor(st.idlePerSec));

    // Falls durch altes System viel zu hoch: hart cap
    if (st.idlePerSec > IDLE_MAX_PER_SEC) st.idlePerSec = IDLE_MAX_PER_SEC;

    // Mappe auf nächstliegenden erlaubten Wert (damit Save stabil bleibt)
    if (st.idlePerSec > 0 && IDLE_VALUES.indexOf(st.idlePerSec) === -1) {
      const lvl = idleLevelFromPerSec(st.idlePerSec);
      st.idlePerSec = IDLE_VALUES[clamp(lvl, 0, IDLE_MAX_LV)];
    }

    return st;
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {}
}

let state = loadState();

/* =========================================================
   DOM Refs (passt zu deinem HTML)
   ========================================================= */
const stage = document.getElementById("stage");
const bg = document.getElementById("bg");
const fxLayer = document.getElementById("fxLayer");

const coinsText = document.getElementById("coinsText");

const viewMain = document.getElementById("viewMain");
const viewShop = document.getElementById("viewShop");
const viewAlbum = document.getElementById("viewAlbum");
const viewOpen = document.getElementById("viewOpen");

// HUD
const btnLeft = document.getElementById("btnLeft");
const btnRight = document.getElementById("btnRight");
const btnLeftIcon = document.getElementById("btnLeftIcon");
const btnRightIcon = document.getElementById("btnRightIcon");

// Main
const logoBtn = document.getElementById("logoBtn");
const logoImg = logoBtn ? logoBtn.querySelector(".logoBig") : null;

// Main Upgrades (nur Klick + Passiv)
const buyClick = document.getElementById("buyClick");
const buyIdle = document.getElementById("buyIdle");

const buyClickBg = document.getElementById("buyClickBg");
const buyIdleBg = document.getElementById("buyIdleBg");

const uClickVal = document.getElementById("uClickVal");
const uIdleVal = document.getElementById("uIdleVal");
const uClickCost = document.getElementById("uClickCost");
const uIdleCost = document.getElementById("uIdleCost");

// Shop
const shopGrid = document.getElementById("shopGrid");
const shopUpgrades = document.getElementById("shopUpgrades");

// Album
const albumGrid = document.getElementById("albumGrid");
const albumProgress = document.getElementById("albumProgress");
const albumPager = document.getElementById("albumPager");
const albumPageWrap = document.getElementById("albumPageWrap");

// Open screen
const openChestBtn = document.getElementById("openChestBtn");
const openChestImg = document.getElementById("openChestImg");
const openCardFrame = document.getElementById("openCardFrame");
const openCardBig = document.getElementById("openCardBig");
const openBadgeNew = document.getElementById("openBadgeNew");
const openBadgeShiny = document.getElementById("openBadgeShiny");
const openThumbs = document.getElementById("openThumbs");

// Card viewer
const modalCard = document.getElementById("modalCard");
const closeCard = document.getElementById("closeCard");
const cardBig = document.getElementById("cardBig");
const btnFlip = document.getElementById("btnFlip");
const badgeNew = document.getElementById("badgeNew");
const badgeShiny = document.getElementById("badgeShiny");
const dotsRow = document.getElementById("dotsRow");

// Toast
const toastEl = document.getElementById("toast");

/* =========================================================
   Robuster Tap-Handler
   ========================================================= */
function bindTap(el, onTap, opts = {}) {
  if (!el) return;
  const maxMove = opts.maxMove ?? 18;

  let active = false;
  let pidLocal = null;
  let sx = 0, sy = 0;

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    active = true;
    pidLocal = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
    opts.onDown?.(e);
  }, { passive: true });

  el.addEventListener("pointerup", (e) => {
    if (!active || pidLocal !== e.pointerId) return;
    active = false;

    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    const moved = Math.hypot(dx, dy);

    opts.onEnd?.(e);
    if (moved <= maxMove) onTap(e);
  }, { passive: true });

  el.addEventListener("pointercancel", (e) => {
    if (pidLocal !== e.pointerId) return;
    active = false;
    opts.onEnd?.(e);
  }, { passive: true });
}

/* =========================================================
   Main Text-Style: 1:1 Shop-Upgrade Werte
   ========================================================= */
function applyShopTextStyleToMainButtons() {
  const root = getComputedStyle(document.documentElement);
  const top = (root.getPropertyValue("--upgrade-value-top") || "54px").trim();
  const bottom = (root.getPropertyValue("--upgrade-cost-bottom") || "12px").trim();

  const valueSize = "50px";
  const costSize = "24px";

  if (uClickVal) {
    uClickVal.style.top = top;
    uClickVal.style.fontSize = valueSize;
  }
  if (uIdleVal) {
    uIdleVal.style.top = top;
    uIdleVal.style.fontSize = valueSize;
  }
  if (uClickCost) {
    uClickCost.style.bottom = bottom;
    uClickCost.style.fontSize = costSize;
  }
  if (uIdleCost) {
    uIdleCost.style.bottom = bottom;
    uIdleCost.style.fontSize = costSize;
  }
}

/* =========================================================
   Coins + Render
   ========================================================= */
let _coinsShown = state.coins;
let _coinsAnimToken = 0;

function renderCoins() {
  if (!coinsText) return;

  const target = state.coins;

  if (Math.abs(target - _coinsShown) > 5000) {
    _coinsShown = target;
    coinsText.textContent = String(target);
    return;
  }

  const from = _coinsShown;
  const to = target;
  const token = ++_coinsAnimToken;
  const t0 = now();
  const dur = 320;

  const step = (t) => {
    if (token !== _coinsAnimToken) return;

    const p = clamp((t - t0) / dur, 0, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    _coinsShown = from + (to - from) * eased;

    coinsText.textContent = String(Math.round(_coinsShown));
    if (p < 1) requestAnimationFrame(step);
    else {
      _coinsShown = to;
      coinsText.textContent = String(to);
    }
  };

  requestAnimationFrame(step);
}

function scheduleSave() {
  clearTimeout(scheduleSave._t);
  scheduleSave._t = setTimeout(saveState, 250);
}

function canAfford(cost) { return state.coins >= cost; }

function onCoinsChanged() {
  renderCoins();
  if (currentView === "main") renderMainUpgrades();
  if (currentView === "shop") renderShop();
}

function gainCoins(n) {
  state.coins += n;
  scheduleSave();
  onCoinsChanged();
}

function spendCoins(n) {
  state.coins = Math.max(0, state.coins - n);
  scheduleSave();
  onCoinsChanged();
}

function toast(msg, ms = 1300) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.add("hidden"), ms);
}

/* =========================================================
   Views / HUD
   ========================================================= */
let currentView = "main";
let albumPageIndex = 0;

function setBg(path) {
  if (!bg) return;
  bg.style.backgroundImage = `url("${path}")`;
}

function setHudForView(which) {
  if (which === "album") {
    btnLeftIcon.src = "assets/icons/icon_shop.png";
    btnLeft.title = "Shop";
    btnLeftIcon.alt = "Shop";
  } else {
    btnLeftIcon.src = "assets/icons/icon_album.png";
    btnLeft.title = "Album";
    btnLeftIcon.alt = "Album";
  }

  if (which === "main") {
    btnRightIcon.src = "assets/icons/icon_shop.png";
    btnRight.title = "Shop";
    btnRightIcon.alt = "Shop";
  } else {
    btnRightIcon.src = "assets/icons/icon_close.png";
    btnRight.title = "Schließen";
    btnRightIcon.alt = "Schließen";
  }
}

function openView(which) {
  currentView = which;

  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  stage?.classList.remove("isOpening");

  if (which === "shop") {
    viewShop?.classList.add("active");
    setBg(ASSETS.bgShop);
    setHudForView("shop");
    renderShop();
  } else if (which === "album") {
    viewAlbum?.classList.add("active");
    setBg(ASSETS.bgAlbum);
    setHudForView("album");
    setAlbumPage(albumPageIndex);
  } else if (which === "open") {
    viewOpen?.classList.add("active");
    stage?.classList.add("isOpening");
    setHudForView("open");
    if (openSession?.chest?.bgOpen) setBg(openSession.chest.bgOpen);
  } else {
    viewMain?.classList.add("active");
    setBg(ASSETS.bgMain);
    setHudForView("main");
    renderMainUpgrades();
  }

  renderCoins();
}

btnLeft?.addEventListener("click", () => {
  if (currentView === "main") openView("album");
  else if (currentView === "album") openView("shop");
  else if (currentView === "shop") openView("album");
});

btnRight?.addEventListener("click", () => {
  if (currentView === "main") openView("shop");
  else openView("main");
});

/* =========================================================
   Click FX (Ring + Partikel am Klickpunkt)
   ========================================================= */
function _toStageXY(clientX, clientY) {
  const r = stage.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

function spawnClickRingFx(clientX, clientY) {
  if (!fxLayer || !stage) return;

  const { x, y } = _toStageXY(clientX, clientY);

  const ring = document.createElement("img");
  ring.className = "fxRing";
  ring.src = "assets/ui/logo_click_ring.png";
  ring.alt = "";
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  fxLayer.appendChild(ring);

  const anim = ring.animate([
    { opacity: 0.0, transform: "translate(-50%, -50%) scale(0.90)" },
    { opacity: 0.9, transform: "translate(-50%, -50%) scale(0.98)", offset: 0.30 },
    { opacity: 0.0, transform: "translate(-50%, -50%) scale(1.06)" }
  ], {
    duration: 220,
    easing: "ease-out",
    fill: "forwards"
  });

  anim.onfinish = () => ring.remove();
}

function spawnClickFx(clientX, clientY, text) {
  if (!fxLayer || !stage) return;

  const { x, y } = _toStageXY(clientX, clientY);

  spawnFxText(x, y - 8, text);

  const count = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const src = CLICK_FX_SOURCES[Math.floor(Math.random() * CLICK_FX_SOURCES.length)];
    spawnFxParticle(x, y, src, i * 18);
  }
}

function spawnFxText(x, y, txt) {
  const el = document.createElement("div");
  el.className = "fxText";
  el.textContent = txt;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  fxLayer.appendChild(el);

  const driftX = (Math.random() * 2 - 1) * 10;
  const driftY = -42 - Math.random() * 18;
  const dur = 650 + Math.random() * 120;

  const anim = el.animate([
    { transform: "translate(-50%, -50%) translate(0px, 0px)", opacity: 0.0 },
    { transform: "translate(-50%, -50%) translate(0px, -4px)", opacity: 1.0, offset: 0.12 },
    { transform: `translate(-50%, -50%) translate(${driftX}px, ${driftY}px)`, opacity: 0.0 }
  ], {
    duration: dur,
    easing: "cubic-bezier(.2,.9,.2,1)",
    fill: "forwards"
  });

  anim.onfinish = () => el.remove();
}

function spawnFxParticle(x, y, src, delayMs) {
  const img = document.createElement("img");
  img.className = "fxParticle";
  img.src = src;
  img.alt = "";
  img.decoding = "async";

  const size = 16 + Math.random() * 10;
  img.style.width = `${size}px`;
  img.style.height = `${size}px`;

  img.style.left = `${x}px`;
  img.style.top = `${y}px`;

  fxLayer.appendChild(img);

  const driftX = (Math.random() * 2 - 1) * 28;
  const driftY = -(32 + Math.random() * 42);
  const rot = (Math.random() * 2 - 1) * 28;
  const dur = 520 + Math.random() * 240;

  const anim = img.animate([
    { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 0.0 },
    { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 1.0, offset: 0.12 },
    { transform: `translate(-50%, -50%) translate(${driftX}px, ${driftY}px) scale(0.75) rotate(${rot}deg)`, opacity: 0.0 }
  ], {
    duration: dur,
    delay: delayMs,
    easing: "cubic-bezier(.2,.9,.2,1)",
    fill: "forwards"
  });

  anim.onfinish = () => img.remove();
}

/* =========================================================
   Main: Logo Click
   ========================================================= */
let press = { active: false, pointerId: null, downX: 0, downY: 0 };

if (logoBtn) {
  logoBtn.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    press.active = true;
    press.pointerId = e.pointerId;
    press.downX = e.clientX;
    press.downY = e.clientY;
    logoBtn.classList.add("isDown");
  }, { passive: false });

  logoBtn.addEventListener("pointerup", (e) => {
    if (!press.active || press.pointerId !== e.pointerId) return;

    press.active = false;
    logoBtn.classList.remove("isDown");

    const moved = Math.hypot(e.clientX - press.downX, e.clientY - press.downY);
    if (moved > 18) return;

    gainCoins(state.clickPower);

    if (logoImg) {
      logoImg.classList.remove("bounce");
      void logoImg.offsetWidth;
      logoImg.classList.add("bounce");
    }

    spawnClickRingFx(e.clientX, e.clientY);
    spawnClickFx(e.clientX, e.clientY, `+${state.clickPower}`);
  }, { passive: true });

  logoBtn.addEventListener("pointercancel", (e) => {
    if (press.pointerId !== e.pointerId) return;
    press.active = false;
    logoBtn.classList.remove("isDown");
  }, { passive: true });
}

/* =========================================================
   Passive Income
   ========================================================= */
const IDLE_TICK_MS = 700;
let idleCarry = 0;

setInterval(() => {
  if (state.idlePerSec <= 0) return;
  idleCarry += state.idlePerSec * (IDLE_TICK_MS / 1000);
  const add = Math.floor(idleCarry);
  if (add > 0) {
    idleCarry -= add;
    gainCoins(add);
  }
}, IDLE_TICK_MS);

/* =========================================================
   Upgrade Costs + Main Buttons
   ========================================================= */
function costClick() {
  return Math.floor(60 * Math.pow(1.45, state.clickPower - 1));
}

// ✅ Passiv: 25 Schritte bis 1000/s, exponentiell (nicht *2)
// Kosten: spürbar teurer als Klick und skaliert mit dem nächsten Zielwert
function costIdle() {
  const lvl = idleLevelFromPerSec(state.idlePerSec);
  if (lvl >= IDLE_MAX_LV) return Infinity;

  const nextPerSec = IDLE_VALUES[lvl + 1]; // Ziel nach dem Kauf
  const base = 150 * Math.pow(nextPerSec, 1.30); // wächst stark genug Richtung Endgame
  const minVsClick = costClick() * 1.6;          // bleibt merklich teurer als Klick
  return Math.floor(Math.max(base, minVsClick));
}

function costDisc()  { return Math.floor(220 * Math.pow(1.7, state.discountLv)); }
function costScout() { return Math.floor(260 * Math.pow(1.65, state.scoutLv)); }

function setMainUpgradePressed(which, pressed) {
  if (which === "click") {
    if (buyClickBg) buyClickBg.src = pressed ? "assets/ui/klick_button_p.png" : "assets/ui/klick_button_n.png";
    buyClick?.classList.toggle("isDown", !!pressed);
  }
  if (which === "idle") {
    if (buyIdleBg) buyIdleBg.src = pressed ? "assets/ui/passiv_button_p.png" : "assets/ui/passiv_button_n.png";
    buyIdle?.classList.toggle("isDown", !!pressed);
  }
}

function renderMainUpgrades() {
  const cClick = costClick();

  if (uClickVal) uClickVal.textContent = `+${state.clickPower}`;
  if (uIdleVal) uIdleVal.textContent = `${Math.floor(state.idlePerSec)}/s`;

  if (uClickCost) uClickCost.textContent = String(cClick);

  // ✅ Idle Max-Handling
  if (isIdleMaxed()) {
    if (uIdleCost) uIdleCost.textContent = "Max.";
    if (buyIdle) buyIdle.disabled = true;
  } else {
    const cIdle = costIdle();
    if (uIdleCost) uIdleCost.textContent = String(cIdle);
    if (buyIdle) buyIdle.disabled = !canAfford(cIdle);
  }

  if (buyClick) buyClick.disabled = !canAfford(cClick);
}

bindTap(buyClick, () => {
  const c = costClick();
  if (!canAfford(c)) return;
  spendCoins(c);
  state.clickPower += 1;
  scheduleSave();
  renderMainUpgrades();
}, {
  onDown: () => setMainUpgradePressed("click", true),
  onEnd:  () => setMainUpgradePressed("click", false),
});

bindTap(buyIdle, () => {
  if (isIdleMaxed()) return;

  const c = costIdle();
  if (!canAfford(c)) return;
  spendCoins(c);

  const lvl = idleLevelFromPerSec(state.idlePerSec);
  const nextLvl = clamp(lvl + 1, 0, IDLE_MAX_LV);
  state.idlePerSec = IDLE_VALUES[nextLvl]; // ✅ nächster definierter Schritt (ohne Komma)

  scheduleSave();
  renderMainUpgrades();
}, {
  onDown: () => setMainUpgradePressed("idle", true),
  onEnd:  () => setMainUpgradePressed("idle", false),
});

/* =========================================================
   Shop: Preise + Upgrades (Rabatt/Scout)
   ========================================================= */
function chestPrice(ch) {
  const disc = getDiscountFrac(); // 0..0.35
  return Math.max(10, Math.floor(ch.basePrice * (1 - disc)));
}

function renderShop() {
  if (!shopGrid) return;
  shopGrid.innerHTML = "";

  const keys = ["common", "rare", "epic"];
  for (const key of keys) {
    const ch = CHESTS[key];
    const price = chestPrice(ch);

    const art =
      key === "common" ? "assets/ui/common_n.png" :
      key === "rare"   ? "assets/ui/rare_n.png" :
                         "assets/ui/epic_n.png";

    const shiny = ch.shinyBase;
    const normal = 1 - shiny;

    const card = document.createElement("div");
    card.className = "tmChestCard";

    const imgBtn = document.createElement("button");
    imgBtn.type = "button";
    imgBtn.className = "tmChestImgBtn";
    imgBtn.innerHTML = `<img src="${art}" alt="${ch.title}">`;
    bindTap(imgBtn, () => buyAndOpenChest(ch));

    const info = document.createElement("div");
    info.className = "tmChestInfo";
    info.innerHTML = `
      <div class="tmLine1">${ch.cards} Karten</div>
      <div class="tmLine2">Normal: ${fmtPct(normal)}%</div>
      <div class="tmLine2">Shiny: ${fmtPct(shiny)}%</div>
    `;

    const priceBtn = document.createElement("button");
    priceBtn.type = "button";
    priceBtn.className = "tmPriceBtn";
    priceBtn.innerHTML = `
      <img class="tmPriceBg" src="assets/ui/cost_button_n.png" alt="">
      <span class="tmPriceText">${price}</span>
    `;

    if (!canAfford(price)) priceBtn.classList.add("isDisabled");
    bindTap(priceBtn, () => buyAndOpenChest(ch));

    card.appendChild(imgBtn);
    card.appendChild(info);
    card.appendChild(priceBtn);

    shopGrid.appendChild(card);
  }

  renderShopUpgrades();
}

function renderShopUpgrades() {
  if (!shopUpgrades) return;
  shopUpgrades.innerHTML = "";

  // Rabatt Anzeige
  const discPct = Math.round(getDiscountFrac() * 100); // 0..35
  const discMaxed = isDiscountMaxed();
  const discCost = costDisc();

  // Scout Anzeige
  const scoutMaxed = isScoutMaxed();
  const scoutCost = costScout();

  // "Lvl" zeigt das Ziel des nächsten Kaufs – aber bei Max bleibt's bei 20
  const scoutValueText = scoutMaxed ? `Lvl. ${SCOUT_MAX_LV}` : `Lvl. ${state.scoutLv + 1}`;

  const items = [
    {
      imgN: "assets/ui/rabatt_button_n.png",
      value: `${discPct}%`,
      costText: discMaxed ? "Max." : String(discCost),
      desc: "Günstigere Truhen",
      isDisabled: discMaxed || !canAfford(discCost),
      onBuy: () => {
        if (discMaxed) return;
        if (!canAfford(discCost)) return;

        spendCoins(discCost);
        state.discountLv = clamp(state.discountLv + 1, 0, MAX_DISCOUNT_LV);

        scheduleSave();
        renderShop();
      }
    },
    {
      imgN: "assets/ui/scout_button_n.png",
      value: scoutValueText,
      costText: scoutMaxed ? "Max." : String(scoutCost),
      desc: "Neue Karten Wahrscheinlicher",
      isDisabled: scoutMaxed || !canAfford(scoutCost),
      onBuy: () => {
        if (scoutMaxed) return;
        if (!canAfford(scoutCost)) return;

        spendCoins(scoutCost);
        state.scoutLv = clamp(state.scoutLv + 1, 0, SCOUT_MAX_LV);

        scheduleSave();
        renderShop();
      }
    }
  ];

  for (const it of items) {
    const card = document.createElement("div");
    card.className = "tmUpgradeCard";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tmUpgradeBtn";
    btn.innerHTML = `
      <img class="tmUpBg" src="${it.imgN}" alt="">
      <div class="tmUpValue">${it.value}</div>
      <div class="tmUpCost">${it.costText}</div>
    `;

    if (it.isDisabled) {
      btn.style.opacity = ".45";
      if (it.costText === "Max.") btn.style.pointerEvents = "none";
    }

    bindTap(btn, it.onBuy);

    const desc = document.createElement("div");
    desc.className = "tmUpDesc";
    desc.textContent = it.desc;

    card.appendChild(btn);
    card.appendChild(desc);
    shopUpgrades.appendChild(card);
  }
}

/* =========================================================
   Album: Paging + Render
   ========================================================= */
const albumPagerBtns = albumPager ? Array.from(albumPager.querySelectorAll(".pageNum")) : [];

function setAlbumPage(i) {
  albumPageIndex = clamp(i, 0, ALBUM_PAGES.length - 1);
  albumPagerBtns.forEach(b => {
    const p = Number(b.dataset.page);
    b.classList.toggle("isActive", p === albumPageIndex);
  });
  renderAlbum();
}

albumPagerBtns.forEach(btn => {
  bindTap(btn, () => setAlbumPage(Number(btn.dataset.page) || 0));
});

// Swipe im Album
(function bindAlbumSwipe() {
  const area = albumPageWrap || viewAlbum;
  if (!area) return;

  let active = false;
  let sx = 0, sy = 0;

  area.addEventListener("pointerdown", (e) => {
    if (currentView !== "album") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    active = true;
    sx = e.clientX;
    sy = e.clientY;
  }, { passive: true });

  area.addEventListener("pointerup", (e) => {
    if (!active) return;
    active = false;

    const dx = e.clientX - sx;
    const dy = e.clientY - sy;

    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (adx < 52) return;
    if (adx < ady * 1.25) return;

    if (dx < 0) setAlbumPage(albumPageIndex + 1);
    else setAlbumPage(albumPageIndex - 1);
  }, { passive: true });

  area.addEventListener("pointercancel", () => { active = false; }, { passive: true });
})();

function renderAlbum() {
  if (!albumGrid) return;

  let ownedNormal = 0;
  let ownedShiny = 0;

  for (let i = 1; i <= PLAYER_COUNT; i++) {
    const id = pid(i);
    const o = state.owned[id];
    if (o?.n) ownedNormal++;
    if (o?.s) ownedShiny++;
  }

  const total = PLAYER_COUNT;
  const totalAll = total * 2;

  const normalDone = ownedNormal >= total;
  const shinyDone = ownedShiny >= total;
  const allDone = (ownedNormal + ownedShiny) >= totalAll;

  if (albumProgress) {
    albumProgress.innerHTML =
      `<span class="${normalDone ? "complete" : ""}">Normale Karten: ${ownedNormal}/${total}</span>` +
      `<span class="sep"> • </span>` +
      `<span class="${shinyDone ? "complete" : ""}">Shiny Karten: ${ownedShiny}/${total}</span>` +
      `<span class="sep"> • </span>` +
      `<span class="${allDone ? "complete" : ""}">Gesamt: ${(ownedNormal + ownedShiny)}/${totalAll}</span>`;
  }

  const page = ALBUM_PAGES[albumPageIndex] ?? ALBUM_PAGES[0];
  albumGrid.innerHTML = "";

  for (const id of page) {
    if (!id) {
      const empty = document.createElement("button");
      empty.className = "slot slotEmpty";
      empty.type = "button";
      empty.disabled = true;
      albumGrid.appendChild(empty);
      continue;
    }

    const o = state.owned[id];
    const hasN = !!o?.n;
    const hasS = !!o?.s;

    const imgSrc = hasS ? cardPath(id, "s") : hasN ? cardPath(id, "n") : cardPath(id, "l");

    const slot = document.createElement("button");
    slot.className = "slot";
    slot.type = "button";

    const img = document.createElement("img");
    img.src = imgSrc;
    img.alt = id;
    slot.appendChild(img);

    const dots = document.createElement("div");
    dots.className = "dots";
    dots.style.opacity = (hasN || hasS) ? ".85" : "0";

    const d1 = document.createElement("img");
    d1.className = "dot";
    d1.src = hasN ? ASSETS.dotFilled : ASSETS.dotEmpty;

    const d2 = document.createElement("img");
    d2.className = "dot";
    d2.src = hasS ? ASSETS.dotFilled : ASSETS.dotEmpty;

    dots.appendChild(d1);
    dots.appendChild(d2);
    slot.appendChild(dots);

    bindTap(slot, () => openCardViewer(id));
    albumGrid.appendChild(slot);
  }
}

/* =========================================================
   Card Viewer Modal + Flip
   ========================================================= */
let cardViewer = { id: null, show: "l" };

function updateCardViewerBadges(id, show) {
  const key = `${id}_${show}`;
  const isNew = !!state.seenNew?.[key];
  badgeNew?.classList.toggle("hidden", !isNew);
  badgeShiny?.classList.toggle("hidden", show !== "s");
}

function animateFlipTo(id, next) {
  if (!cardBig) return;

  cardBig.classList.remove("flipAnim");
  void cardBig.offsetWidth;
  cardBig.classList.add("flipAnim");

  setTimeout(() => {
    cardViewer.show = next;
    cardBig.src = cardPath(id, next);
    updateCardViewerBadges(id, next);

    const key = `${id}_${next}`;
    if (state.seenNew?.[key]) {
      delete state.seenNew[key];
      saveState();
    }
  }, 190);

  setTimeout(() => cardBig.classList.remove("flipAnim"), 420);
}

function openCardViewer(id) {
  cardViewer.id = id;

  const o = state.owned[id] ?? { n: false, s: false, cn: 0, cs: 0 };
  const hasN = !!o.n;
  const hasS = !!o.s;

  let show = "l";
  if (hasS) show = "s";
  else if (hasN) show = "n";

  cardViewer.show = show;

  modalCard?.classList.remove("hidden");
  updateCardViewerBadges(id, show);
  if (cardBig) cardBig.src = cardPath(id, show);

  if (show === "n" || show === "s") {
    const key = `${id}_${show}`;
    if (state.seenNew?.[key]) {
      delete state.seenNew[key];
      saveState();
    }
  }

  if (dotsRow) {
    dotsRow.innerHTML = "";
    const d1 = document.createElement("img");
    d1.className = "dot";
    d1.src = hasN ? ASSETS.dotFilled : ASSETS.dotEmpty;
    const d2 = document.createElement("img");
    d2.className = "dot";
    d2.src = hasS ? ASSETS.dotFilled : ASSETS.dotEmpty;
    dotsRow.appendChild(d1);
    dotsRow.appendChild(d2);
  }

  if (btnFlip) {
    btnFlip.disabled = !(hasN && hasS);
    btnFlip.textContent = (hasN && hasS) ? "Flip" : "Keine zweite Version";
    btnFlip.onclick = () => {
      if (!(hasN && hasS)) return;
      const next = (cardViewer.show === "s") ? "n" : "s";
      animateFlipTo(id, next);
    };
  }
}

bindTap(closeCard, () => modalCard?.classList.add("hidden"));
modalCard?.addEventListener("click", (e) => {
  if (e.target === modalCard) modalCard.classList.add("hidden");
});

/* =========================================================
   CHEST OPEN FLOW
   ========================================================= */
let openSession = null;

function buyAndOpenChest(ch) {
  const price = chestPrice(ch);
  if (!canAfford(price)) return;

  spendCoins(price);

  openSession = {
    chest: ch,
    pulls: generatePulls(ch, price),
    index: 0,
    opened: false,
    animating: false,
    done: false,
    returnView: currentView,
  };

  startChestOpening();
}

function startChestOpening() {
  if (!openSession) return;
  const ch = openSession.chest;

  openView("open");
  setBg(ch.bgOpen);

  if (openChestImg) openChestImg.src = ch.imgClosed;

  openCardFrame?.classList.remove("hasCard");
  if (openCardBig) openCardBig.src = "";

  openBadgeNew?.classList.add("hidden");
  openBadgeShiny?.classList.add("hidden");

  if (openThumbs) openThumbs.innerHTML = "";
}

function bounceChest() {
  if (!openChestImg) return;
  openChestImg.animate([
    { transform: "translateY(6px) scale(1)" },
    { transform: "translateY(2px) scale(1.03)", offset: 0.35 },
    { transform: "translateY(8px) scale(0.99)", offset: 0.70 },
    { transform: "translateY(6px) scale(1)" }
  ], {
    duration: 280,
    easing: "cubic-bezier(.2,.9,.2,1)",
    fill: "forwards"
  });
}

function flyCardToMain(src) {
  if (!stage || !openChestImg || !openCardFrame) return;

  const stageRect = stage.getBoundingClientRect();
  const chestRect = openChestImg.getBoundingClientRect();
  const targetRect = openCardFrame.getBoundingClientRect();

  const fromX = (chestRect.left + chestRect.width / 2) - stageRect.left;
  const fromY = (chestRect.top + chestRect.height * 0.28) - stageRect.top;

  const toX = (targetRect.left + targetRect.width / 2) - stageRect.left;
  const toY = (targetRect.top + targetRect.height / 2) - stageRect.top;

  const dx = toX - fromX;
  const dy = toY - fromY;

  const img = document.createElement("img");
  img.className = "flyCard";
  img.src = src;
  img.alt = "";
  img.style.left = `${fromX}px`;
  img.style.top = `${fromY}px`;
  stage.appendChild(img);

  const rot1 = (Math.random() * 2 - 1) * 2.0;
  const rot2 = -rot1 * 0.45;

  const anim = img.animate([
    { transform: `translate(-50%, -50%) scale(0.78) rotate(${rot1}deg)`, opacity: 0.0 },
    { transform: `translate(-50%, -50%) scale(0.92) rotate(${rot1}deg)`, opacity: 1.0, offset: 0.10 },
    { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(1.00) rotate(${rot2}deg)`, opacity: 1.0, offset: 0.78 },
    { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(1.00) rotate(0deg)`, opacity: 0.0 }
  ], {
    duration: 560,
    easing: "cubic-bezier(.2,.9,.15,1)",
    fill: "forwards"
  });

  anim.onfinish = () => img.remove();
}

function updateOpenBadges(pull) {
  openBadgeShiny?.classList.toggle("hidden", !pull.isShiny);
  openBadgeNew?.classList.toggle("hidden", !pull.isNew);
}

function addThumb(pull) {
  if (!openThumbs) return;

  const el = document.createElement("div");
  el.className = "openThumb";

  const img = document.createElement("img");
  img.src = pull.imgSmall;
  img.alt = pull.id;
  el.appendChild(img);

  if (pull.isShiny) {
    const b = document.createElement("img");
    b.className = "tBadge left";
    b.src = ASSETS.badgeShiny;
    b.alt = "SHINY";
    el.appendChild(b);
  }
  if (pull.isNew) {
    const b = document.createElement("img");
    b.className = "tBadge right";
    b.src = ASSETS.badgeNew;
    b.alt = "NEU";
    el.appendChild(b);
  }

  if (pull.refund > 0) {
    el.classList.add("dup");
    const t = document.createElement("div");
    t.className = "dupRefund";
    t.textContent = `+${pull.refund}`;
    el.appendChild(t);
  }

  bindTap(el, () => openCardViewer(pull.id));
  openThumbs.appendChild(el);

  layoutThumbs();
}

function layoutThumbs() {
  if (!openThumbs) return;
  const kids = Array.from(openThumbs.children);
  const n = kids.length;
  if (n === 0) return;

  const spread = 72;
  const mid = (n - 1) / 2;

  kids.forEach((k, i) => {
    const x = (i - mid) * spread;
    const r = (i - mid) * -1.2;
    k.style.transform = `translateX(calc(-50% + ${x}px)) rotate(${r}deg)`;
    k.style.zIndex = String(10 + i);
  });
}

function revealNextFromChest() {
  if (!openSession || openSession.animating) return;

  if (openSession.done) {
    const back = openSession.returnView || "shop";
    openSession = null;
    openView(back === "open" ? "shop" : back);
    return;
  }

  const ch = openSession.chest;
  const pulls = openSession.pulls;

  if (openSession.index >= pulls.length) {
    openSession.done = true;
    return;
  }

  openSession.animating = true;

  if (!openSession.opened) {
    openSession.opened = true;
    if (openChestImg) openChestImg.src = ch.imgOpen;
  }

  bounceChest();

  const pull = pulls[openSession.index];
  openSession.index += 1;

  flyCardToMain(pull.imgSmall);

  setTimeout(() => {
    if (openCardBig) openCardBig.src = pull.imgSmall;
    openCardFrame?.classList.add("hasCard");
    updateOpenBadges(pull);
    addThumb(pull);
  }, 340);

  setTimeout(() => {
    openSession.animating = false;
    if (openSession.index >= pulls.length) openSession.done = true;
  }, 620);
}

bindTap(openChestBtn, () => revealNextFromChest());

/* ----------------- Pull generation ----------------- */
function generatePulls(ch, pricePaid) {
  state.lastNew = [];
  const pulls = [];

  for (let k = 0; k < ch.cards; k++) {
    const id = pickPlayerId();
    const res = rollVariant(id, ch);
    const pull = applyPull(id, res.isShiny, pricePaid);
    pulls.push(pull);
  }

  saveState();
  return pulls;
}

/* =========================================================
   ✅ Scout-Logik: spürbar für neue Karten
   - Bis max 25% (Level 20) wird ein Pull "gezielt" aus fehlenden Karten gezogen,
     sofern es überhaupt noch fehlende gibt.
   - Rest bleibt normal gewichtet (Duplikate werden weiterhin unwahrscheinlicher).
   ========================================================= */
function pickPlayerId() {
  const idsAll = [];
  const weightsAll = [];

  const idsMissing = [];
  const weightsMissing = [];

  // Duplikate leicht dämpfen
  const decay = 1.22;
  const minW = 0.10;

  for (let i = 1; i <= PLAYER_COUNT; i++) {
    const id = pid(i);
    const o = state.owned[id];
    const hasAny = !!(o?.n || o?.s);
    const copies = (o?.cn ?? 0) + (o?.cs ?? 0);

    let w = hasAny ? (1.0 / Math.pow(1 + copies, decay)) : 1.0;
    w = Math.max(minW, w);

    // p25 (Wappen) seltener
    if (id === "p25") w *= 0.28;

    idsAll.push(id);
    weightsAll.push(w);

    if (!hasAny) {
      idsMissing.push(id);
      weightsMissing.push(w);
    }
  }

  const bonus = getScoutBonusFrac(); // 0..0.25
  if (idsMissing.length > 0 && bonus > 0 && Math.random() < bonus) {
    return pickByWeights(idsMissing, weightsMissing);
  }

  return pickByWeights(idsAll, weightsAll);
}

function pickByWeights(items, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function rollVariant(id, ch) {
  const o = state.owned[id];
  const hasN = !!o?.n;
  const hasS = !!o?.s;

  let shinyChance = ch.shinyBase;

  if (hasN && !hasS) shinyChance = ch.shinyBoostIfNormal;
  else if (hasS) shinyChance = ch.shinyBase;

  // ✅ Scout beeinflusst hier NICHT mehr Shiny (Scout ist "neue Karten", nicht "shiny farmen")
  const isShiny = Math.random() < shinyChance;
  return { isShiny };
}

function applyPull(id, isShiny, pricePaid) {
  state.owned[id] ??= { n: false, s: false, cn: 0, cs: 0 };
  const o = state.owned[id];

  const key = `${id}_${isShiny ? "s" : "n"}`;
  const wasOwned = isShiny ? o.s : o.n;

  if (isShiny) {
    o.cs += 1;
    o.s = true;
  } else {
    o.cn += 1;
    o.n = true;
  }

  let refund = 0;
  const isNew = !wasOwned;

  if (!isNew) {
    refund = isShiny ? Math.floor(pricePaid * 0.45) : Math.floor(pricePaid * 0.14);
    gainCoins(refund);
  } else {
    state.lastNew.push(key);
    state.seenNew[key] = true;
  }

  const imgSmall = cardPath(id, isShiny ? "s" : "n");
  return { id, isShiny, isNew, refund, imgSmall };
}

/* =========================================================
   Init + Render
   ========================================================= */
function renderAll() {
  applyShopTextStyleToMainButtons();
  renderCoins();
  renderMainUpgrades();
  if (currentView === "shop") renderShop();
  if (currentView === "album") renderAlbum();
}

openView("main");
renderAll();

/* Anti-Rightclick / Anti-Drag auf Bildern (nur im Spielbereich) */
(function blockImageContextMenu() {
  if (!stage) return;

  stage.addEventListener("contextmenu", (e) => {
    if (e.target && (e.target.tagName === "IMG" || e.target.closest("img"))) {
      e.preventDefault();
    }
  }, { capture: true });

  stage.addEventListener("dragstart", (e) => {
    if (e.target && e.target.tagName === "IMG") {
      e.preventDefault();
    }
  }, { capture: true });
})();

// iOS/Safari: Pinch-Zoom und Double-Tap-Zoom im Spielbereich verhindern
(function preventZoom() {
  const area = document.getElementById("stage") || document.body;

  area.addEventListener("touchstart", (e) => {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  area.addEventListener("touchmove", (e) => {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  let lastTouchEnd = 0;
  area.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
})();
