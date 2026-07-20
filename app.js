"use strict";

const STORAGE_KEY = "tecmopia_point_coupon_v1";
const CHECKIN_PARAM = "checkin";
const CHECKIN_TOKEN = "TECMOPIA100";
const DAILY_POINTS = 100;

const COUPON_MASTER = [
  { id: "crane_plus1", name: "クレーンゲーム1回増量クーポン", cost: 50, icon: "📷", type: "crane" },
  { id: "medal_10", name: "ゲームメダル10枚引換クーポン", cost: 50, icon: "🪙", type: "medal" },
  { id: "crane_500_7", name: "クレーンゲーム500円7PLAYクーポン", cost: 100, icon: "🎮", type: "crane" },
  { id: "medal_20", name: "ゲームメダル20枚引換クーポン", cost: 100, icon: "🪙", type: "medal" },
  { id: "crane_free1", name: "クレーンゲーム1回無料クーポン", cost: 100, icon: "🏆", type: "crane" }
];

const DEFAULT_STATE = {
  points: 0,
  lastCheckinDate: "",
  coupons: []
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let appState = loadState();
let pendingCouponId = null;
let pendingUseInstanceId = null;
let couponFilter = "active";
let lastFocusedElement = null;

const pointsEl = $("#points");
const pointChangeEl = $("#pointChange");
const toastEl = $("#toast");
const checkinBtn = $("#checkinBtn");

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return structuredCloneSafe(DEFAULT_STATE);
    return {
      points: Number.isFinite(Number(saved.points)) ? Math.max(0, Number(saved.points)) : 0,
      lastCheckinDate: typeof saved.lastCheckinDate === "string" ? saved.lastCheckinDate : "",
      coupons: Array.isArray(saved.coupons) ? saved.coupons.filter(Boolean) : []
    };
  } catch (error) {
    console.error("保存データの読み込みに失敗しました。", error);
    return structuredCloneSafe(DEFAULT_STATE);
  }
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (error) {
    console.error("保存に失敗しました。", error);
    showToast("データを保存できませんでした", "error");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function formatToday() {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()}`;
}

function animatePoints(from, to, changeLabel) {
  const duration = 720;
  const start = performance.now();
  pointChangeEl.textContent = changeLabel;
  pointChangeEl.classList.remove("show");
  void pointChangeEl.offsetWidth;
  pointChangeEl.classList.add("show");

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    pointsEl.textContent = Math.round(from + (to - from) * eased).toLocaleString("ja-JP");
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function showToast(message, type = "") {
  toastEl.textContent = message;
  toastEl.className = `toast show ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toastEl.className = "toast"; }, 3200);
}

function showMessage(title, message, icon = "🎉") {
  $("#messageModalTitle").textContent = title;
  $("#messageModalText").textContent = message;
  $("#messageModalIcon").textContent = icon;
  openModal("messageModal");
}

function openModal(id) {
  const backdrop = document.getElementById(id);
  if (!backdrop) return;
  lastFocusedElement = document.activeElement;
  backdrop.classList.add("open");
  backdrop.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => backdrop.querySelector(".modal")?.focus());
}

function closeModal(id) {
  const backdrop = document.getElementById(id);
  if (!backdrop) return;
  backdrop.classList.remove("open");
  backdrop.setAttribute("aria-hidden", "true");
  if (!$(".modal-backdrop.open")) document.body.classList.remove("modal-open");
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus({ preventScroll: true });
}

function getCouponMaster(couponId) {
  return COUPON_MASTER.find((coupon) => coupon.id === couponId) || null;
}

function isCheckedInToday() {
  return appState.lastCheckinDate === getTodayKey();
}

function renderProgress() {
  const costs = [...new Set(COUPON_MASTER.map((coupon) => coupon.cost))].sort((a, b) => a - b);
  const nextCost = costs.find((cost) => cost > appState.points);
  const previousCosts = costs.filter((cost) => cost <= appState.points);
  const previous = previousCosts.length ? previousCosts[previousCosts.length - 1] : 0;
  const progress = nextCost
    ? ((appState.points - previous) / Math.max(1, nextCost - previous)) * 100
    : 100;

  if (nextCost) {
    $("#nextRewardText").textContent = "次のクーポンまで";
    $("#nextRewardHint").textContent = `あと ${nextCost - appState.points}pt`;
  } else {
    $("#nextRewardText").textContent = "交換できます";
    $("#nextRewardHint").textContent = "好きなクーポンを選べます";
  }
  $("#nextRewardBar").style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function couponCard(coupon) {
  return `
    <article class="coupon-card ${escapeHtml(coupon.type)}">
      <div class="coupon-icon" aria-hidden="true">${escapeHtml(coupon.icon)}</div>
      <div class="coupon-name">${escapeHtml(coupon.name)}</div>
      <div class="coupon-meta"><div class="cost">${coupon.cost}<small>pt</small></div></div>
    </article>`;
}

function exchangeCard(coupon) {
  const affordable = appState.points >= coupon.cost;
  return `
    <article class="exchange-card ${escapeHtml(coupon.type)}">
      <div class="coupon-icon" aria-hidden="true">${escapeHtml(coupon.icon)}</div>
      <div>
        <div class="exchange-card-name">${escapeHtml(coupon.name)}</div>
        <div class="exchange-card-cost">${coupon.cost}<small>pt</small></div>
      </div>
      <button class="exchange-button" type="button" data-exchange="${escapeHtml(coupon.id)}" ${affordable ? "" : "disabled"}>
        ${affordable ? "交換する" : `あと${coupon.cost - appState.points}pt`}
      </button>
    </article>`;
}

function renderCouponMenus() {
  $("#homeCouponPreview").innerHTML = COUPON_MASTER.slice(0, 4).map(couponCard).join("");
  $("#exchangeList").innerHTML = COUPON_MASTER.map(exchangeCard).join("");
  $("#modalPoints").textContent = appState.points.toLocaleString("ja-JP");

  $$('[data-exchange]').forEach((button) => {
    button.addEventListener("click", () => openExchangeConfirm(button.dataset.exchange));
  });
}

function filteredCoupons() {
  if (couponFilter === "active") return appState.coupons.filter((item) => !item.used);
  if (couponFilter === "used") return appState.coupons.filter((item) => item.used);
  return appState.coupons;
}

function emptyMessage() {
  if (!appState.coupons.length) return ["🎫", "クーポンはまだありません", "ポイントを使って交換すると、ここに収納されます。"];
  if (couponFilter === "active") return ["✨", "使用できるクーポンはありません", "ポイントを貯めて新しいクーポンと交換しましょう。"];
  if (couponFilter === "used") return ["🧾", "使用済みのクーポンはありません", "使用したクーポンはここに履歴として残ります。"];
  return ["🎫", "クーポンはありません", "ポイントを貯めて交換してみましょう。"];
}

function renderCouponBox() {
  const box = $("#couponBox");
  const activeCount = appState.coupons.filter((item) => !item.used).length;
  $("#boxCountText").textContent = `${activeCount}枚使用可能`;
  $("#couponBadge").hidden = activeCount === 0;
  $("#couponBadge").textContent = activeCount > 99 ? "99+" : String(activeCount);

  const items = filteredCoupons();
  if (!items.length) {
    const [icon, title, copy] = emptyMessage();
    box.innerHTML = `<div class="empty-state"><span>${icon}</span><b>${title}</b><p>${copy}</p></div>`;
    return;
  }

  box.innerHTML = items.slice().reverse().map((item) => `
    <article class="owned-card ${escapeHtml(item.type)} ${item.used ? "used" : ""}">
      <span class="owned-state">${item.used ? "使用済み" : "使用可能"}</span>
      <div class="owned-top">
        <div class="owned-icon" aria-hidden="true">${escapeHtml(item.icon)}</div>
        <div>
          <div class="owned-name">${escapeHtml(item.name)}</div>
          <div class="owned-date">交換：${formatDate(item.exchangedAt)}</div>
          ${item.used ? `<div class="owned-date">使用：${formatDate(item.usedAt)}</div>` : ""}
        </div>
      </div>
      <div class="owned-actions">
        ${item.used
          ? `<button class="button button-ghost button-full" type="button" disabled>使用済み</button>`
          : `<button class="button button-danger button-full" type="button" data-use="${escapeHtml(item.instanceId)}">このクーポンを使用する</button>`}
      </div>
    </article>`).join("");

  $$('[data-use]').forEach((button) => {
    button.addEventListener("click", () => openUseConfirm(button.dataset.use));
  });
}

function renderCheckinPanel() {
  const panel = $("#checkinPanel");
  const title = $("#checkinTitle");
  const description = $("#checkinDescription");
  const icon = $("#checkinIcon");
  const badge = $("#checkinStatusBadge");
  const buttonLabel = checkinBtn.querySelector(".button-label");

  panel.classList.remove("ready", "completed");

  if (isCheckedInToday()) {
    panel.classList.add("completed");
    icon.textContent = "✅";
    badge.textContent = "本日完了";
    title.textContent = "100ポイント獲得済みです";
    description.textContent = "次回は明日、店頭のQRコードからアクセスしてください。";
    buttonLabel.textContent = "本日は取得済みです";
    checkinBtn.disabled = true;
    return;
  }

  icon.textContent = "📷";
  badge.textContent = "店頭限定";
  title.textContent = "店頭のQRコードを読み取ってください";
  description.textContent = "このページを直接開いただけではポイントは加算されません。";
  buttonLabel.textContent = "QRコードからアクセスしてください";
  checkinBtn.disabled = true;
}

function renderAll(setPointText = true) {
  if (setPointText) pointsEl.textContent = appState.points.toLocaleString("ja-JP");
  $("#storeName").textContent = "ロックダム公津の杜店";
  $("#todayLabel").textContent = formatToday();
  renderProgress();
  renderCheckinPanel();
  renderCouponMenus();
  renderCouponBox();
}

function openExchangeConfirm(couponId) {
  const coupon = getCouponMaster(couponId);
  if (!coupon || appState.points < coupon.cost) return;
  pendingCouponId = coupon.id;
  $("#exchangePreview").innerHTML = `
    <div class="big-icon">${escapeHtml(coupon.icon)}</div>
    <b>${escapeHtml(coupon.name)}</b>
    <div class="cost preview-cost">${coupon.cost}<small>pt</small></div>`;
  closeModal("exchangeModal");
  openModal("confirmExchangeModal");
}

function confirmExchange() {
  const coupon = getCouponMaster(pendingCouponId);
  if (!coupon) return;
  if (appState.points < coupon.cost) {
    closeModal("confirmExchangeModal");
    showToast("ポイントが不足しています", "error");
    return;
  }

  const before = appState.points;
  appState.points -= coupon.cost;
  appState.coupons.push({
    instanceId: `${coupon.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    couponId: coupon.id,
    name: coupon.name,
    cost: coupon.cost,
    icon: coupon.icon,
    type: coupon.type,
    exchangedAt: new Date().toISOString(),
    used: false,
    usedAt: null
  });
  saveState();
  closeModal("confirmExchangeModal");
  animatePoints(before, appState.points, `-${coupon.cost}`);
  renderAll(false);
  showToast("クーポンBOXに収納しました", "success");
  pendingCouponId = null;
}

function openUseConfirm(instanceId) {
  const item = appState.coupons.find((coupon) => coupon.instanceId === instanceId);
  if (!item || item.used) return;
  pendingUseInstanceId = instanceId;
  $("#useCouponPreview").innerHTML = `
    <div class="big-icon">${escapeHtml(item.icon)}</div>
    <b>${escapeHtml(item.name)}</b>`;
  openModal("useModal");
}

function confirmUse() {
  const item = appState.coupons.find((coupon) => coupon.instanceId === pendingUseInstanceId);
  if (!item || item.used) return;
  item.used = true;
  item.usedAt = new Date().toISOString();
  saveState();
  closeModal("useModal");
  renderCouponBox();
  showToast("クーポンを使用済みにしました", "success");
  pendingUseInstanceId = null;
}

function switchScreen(screenId) {
  $$(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === screenId));
  $$(".nav-button").forEach((button) => {
    const active = button.dataset.screen === screenId;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function processQrAccess() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get(CHECKIN_PARAM) || url.searchParams.get("token");
  if (!token) return;

  if (token !== CHECKIN_TOKEN) {
    showMessage("対象外のQRコードです", "このQRコードからはポイントを獲得できません。", "⚠️");
    cleanUrl();
    return;
  }

  if (isCheckedInToday()) {
    renderAll();
    showMessage("本日は取得済みです", "ポイントの獲得は1日1回までです。また明日ご利用ください。", "✅");
    cleanUrl();
    return;
  }

  const before = appState.points;
  appState.points += DAILY_POINTS;
  appState.lastCheckinDate = getTodayKey();
  saveState();
  renderAll(false);
  animatePoints(before, appState.points, `+${DAILY_POINTS}`);
  showMessage("ポイントGET！", `${DAILY_POINTS}ポイント獲得しました。`, "🎉");
  cleanUrl();
}

function cleanUrl() {
  try {
    const clean = `${window.location.pathname}${window.location.hash || ""}`;
    window.history.replaceState(null, "", clean);
  } catch (error) {
    console.warn("URLの整理に失敗しました。", error);
  }
}

function initEvents() {
  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchScreen(button.dataset.screen));
  });

  const openExchange = () => {
    renderCouponMenus();
    openModal("exchangeModal");
  };
  $("#openExchangeBtn").addEventListener("click", openExchange);
  $("#openExchangeTextBtn").addEventListener("click", openExchange);

  $$("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.close));
  });

  $$(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
  });

  $("#confirmExchangeBtn").addEventListener("click", confirmExchange);
  $("#confirmUseBtn").addEventListener("click", confirmUse);

  $$(".coupon-tab").forEach((button) => {
    button.addEventListener("click", () => {
      couponFilter = button.dataset.couponFilter;
      $$(".coupon-tab").forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      renderCouponBox();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const openBackdrop = $(".modal-backdrop.open");
      if (openBackdrop) closeModal(openBackdrop.id);
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    appState = loadState();
    renderAll();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      appState = loadState();
      renderAll();
    }
  });
}

function init() {
  initEvents();
  renderAll();
  processQrAccess();
}

document.addEventListener("DOMContentLoaded", init);
