"use strict";

const APP_BUILD = "2026.07.24-GAS-ADMIN-05";

const STORAGE_KEY = "tecmopia_point_coupon_v1";


const DEVICE_ID_KEY = "tecmopia_device_id_v1";
const RESET_VERSION_KEY = "tecmopia_reset_version_v1";
const PAGE_VIEW_DATE_KEY = "tecmopia_page_view_date_v1";
const GAS_WEB_APP_URL = String(window.TECMOPIA_GAS_URL || "").trim();
const GAS_PLACEHOLDER = "PASTE_GAS_WEB_APP_URL_HERE";
const GAS_ENABLED = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(GAS_WEB_APP_URL)
  && !GAS_WEB_APP_URL.includes(GAS_PLACEHOLDER);
const GAS_JSONP_TIMEOUT_MS = 10000;
const gasRequestKeepAlive = new Set();

function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `tp_${Date.now().toString(36)}_${window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 14)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch (error) {
    return `tp_session_${Math.random().toString(36).slice(2, 14)}`;
  }
}

function makeEventId(prefix = "event") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function logDailyPageView() {
  if (!GAS_ENABLED) return;

  const today = getTodayKey();

  try {
    if (localStorage.getItem(PAGE_VIEW_DATE_KEY) === today) return;
  } catch (error) {
    console.warn("起動記録の確認に失敗しました。", error);
  }

  const sent = sendGasEvent("page_view", {
    itemId: "APP_OPEN",
    itemName: "ポイントカードを開く",
    points: 0,
    balance: state.points
  });

  if (sent) {
    try {
      localStorage.setItem(PAGE_VIEW_DATE_KEY, today);
    } catch (error) {
      console.warn("起動記録の保存に失敗しました。", error);
    }
  }
}

function appendQuery(url, params) {
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    target.searchParams.set(key, String(value));
  });
  target.searchParams.set("_", String(Date.now()));
  return target.toString();
}

function sendGasEvent(eventType, payload = {}) {
  if (!GAS_ENABLED) return false;
  const eventId = payload.eventId || makeEventId(eventType);
  const params = {
    action: "log",
    eventId,
    deviceId: getDeviceId(),
    eventType,
    itemId: payload.itemId,
    itemName: payload.itemName,
    points: payload.points,
    balance: payload.balance,
    couponInstanceId: payload.couponInstanceId,
    distance: payload.distance,
    accuracy: payload.accuracy,
    locationMode: payload.locationMode,
    clientAt: new Date().toISOString(),
    appBuild: APP_BUILD,
    pageUrl: `${location.origin}${location.pathname}`,
    userAgent: navigator.userAgent.slice(0, 240)
  };
  const image = new Image();
  gasRequestKeepAlive.add(image);
  const release = () => {
    gasRequestKeepAlive.delete(image);
    image.onload = null;
    image.onerror = null;
  };
  image.onload = release;
  image.onerror = release;
  image.src = appendQuery(GAS_WEB_APP_URL, params);
  setTimeout(release, 15000);
  return true;
}

function gasJsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!GAS_ENABLED) {
      reject(new Error("GAS_URL_NOT_CONFIGURED"));
      return;
    }
    const callbackName = `__tecmopiaGas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const script = document.createElement("script");
    let settled = false;
    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("GAS_TIMEOUT"));
    }, GAS_JSONP_TIMEOUT_MS);
    window[callbackName] = (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("GAS_NETWORK_ERROR"));
    };
    script.src = appendQuery(GAS_WEB_APP_URL, { action, callback: callbackName, ...params });
    document.head.appendChild(script);
  });
}

async function checkRemoteReset({ showNotice = false } = {}) {
  if (!GAS_ENABLED) return;
  try {
    const config = await gasJsonp("config");
    if (!config?.ok) return;
    const remoteVersion = Number(config.resetVersion || 0);
    const localVersion = Number(localStorage.getItem(RESET_VERSION_KEY) || 0);
    if (!localVersion) {
      localStorage.setItem(RESET_VERSION_KEY, String(remoteVersion));
      return;
    }
    if (remoteVersion <= localVersion) return;

    const deviceId = getDeviceId();
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(QR_SESSION_KEY);
    sessionStorage.removeItem(QR_INVALID_KEY);
    localStorage.setItem(RESET_VERSION_KEY, String(remoteVersion));
    state = clone(DEFAULT_STATE);
    pendingEarnAction = null;
    pendingEarnExpiresAt = 0;
    renderAll();
    sendGasEvent("client_reset_applied", {
      eventId: makeEventId("client_reset"),
      itemId: String(remoteVersion),
      itemName: "管理者リセットを端末へ反映",
      balance: 0
    });
    if (showNotice) {
      showMessage("ポイントカードをリセットしました", "管理者によるリセットをこの端末へ反映しました。", "🔄");
    } else {
      showToast("管理者リセットを反映しました", "success");
    }
    return deviceId;
  } catch (error) {
    console.warn("GAS設定の確認に失敗しました。", error);
  }
}

const STORE = Object.freeze({
  name: "テクモピア ロックダム公津の杜店",
  address: "千葉県成田市公津の杜4丁目5-3 成田ユアエルム3F",
  latitude: 35.7597375,
  longitude: 140.297015625
});

const GEOLOCATION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 20000,
  maximumAge: 0
});

// 屋内ではGPSが大きく揺れるため、複数回測位して最も精度の良い値を採用します。
const LOCATION_SAMPLE_MS = 16000;
const LOCATION_EARLY_SUCCESS_METERS = 80;
const MAX_ACCURACY_METERS = 3000;
const FINE_ACCURACY_METERS = 500;
const QR_SESSION_KEY = "tecmopia_pending_earn_v2";
const QR_INVALID_KEY = "tecmopia_invalid_earn_v2";
const QR_AUTH_VALID_MS = 5 * 60 * 1000;

const EARN_ACTIONS = Object.freeze({
  VISIT1: Object.freeze({
    id: "visit",
    token: "VISIT1",
    name: "来店チェックイン",
    shortName: "来店チェックイン",
    points: 1,
    icon: "📍",
    description: "店頭QRを読み取り、店舗周辺で現在地を確認します。",
    oncePerDay: true,
    dateField: "lastCheckinDate",
    radiusMeters: 250
  }),
  CRANE500: Object.freeze({
    id: "crane500",
    token: "CRANE500",
    name: "クレーンゲーム500円・6プレイ",
    shortName: "500円6プレイ",
    points: 5,
    icon: "🕹️",
    description: "500円6プレイ利用後、スタッフ提示QRを読み取ります。",
    oncePerDay: false,
    radiusMeters: 180
  }),
  MEDAL1200: Object.freeze({
    id: "medal1200",
    token: "MEDAL1200",
    name: "ゲームメダル1,200円貸出",
    shortName: "メダル1,200円",
    points: 5,
    icon: "🪙",
    description: "1,200円貸出後、スタッフ提示QRを読み取ります。",
    oncePerDay: false,
    radiusMeters: 180
  }),
  MEDAL2000: Object.freeze({
    id: "medal2000",
    token: "MEDAL2000",
    name: "ゲームメダル2,000円貸出",
    shortName: "メダル2,000円",
    points: 7,
    icon: "🪙",
    description: "2,000円貸出後、スタッフ提示QRを読み取ります。",
    oncePerDay: false,
    radiusMeters: 180
  }),
  MEDAL3000: Object.freeze({
    id: "medal3000",
    token: "MEDAL3000",
    name: "ゲームメダル3,000円貸出",
    shortName: "メダル3,000円",
    points: 10,
    icon: "💰",
    description: "3,000円貸出後、スタッフ提示QRを読み取ります。",
    oncePerDay: false,
    radiusMeters: 180
  }),
  MEDAL5000: Object.freeze({
    id: "medal5000",
    token: "MEDAL5000",
    name: "ゲームメダル5,000円貸出",
    shortName: "メダル5,000円",
    points: 15,
    icon: "🏅",
    description: "5,000円貸出後、スタッフ提示QRを読み取ります。",
    oncePerDay: false,
    radiusMeters: 180
  })
});

const REWARDS = Object.freeze([
  { id: "crane_plus1", name: "クレーンゲーム1回増量券", cost: 3, icon: "🕹️", type: "crane", tint: "#e4f7ff" },
  { id: "medal_10", name: "ゲームメダル10枚引換券", cost: 3, icon: "🪙", type: "medal", tint: "#fff6d8" },
  { id: "crane_free1", name: "クレーンゲーム1回無料券", cost: 6, icon: "🎮", type: "crane", tint: "#e4f7ff" },
  { id: "medal_30", name: "ゲームメダル30枚引換券", cost: 6, icon: "🪙", type: "medal", tint: "#fff6d8" },
  { id: "crane_500_7", name: "クレーンゲーム500円で7PLAY券", cost: 6, icon: "7️⃣", type: "crane", tint: "#e9f6ff" },
  { id: "crane_free3", name: "クレーンゲーム3回無料券", cost: 15, icon: "🏆", type: "crane", tint: "#e5f8ff" },
  { id: "medal_99", name: "ゲームメダル99枚引換券", cost: 15, icon: "✨", type: "medal", tint: "#fff4ce" },
  { id: "prize_choice", name: "お好きな景品と交換券", cost: 50, icon: "🎁", type: "prize", tint: "#f2eaff" },
  { id: "medal_3333", name: "ゲームメダル3,333枚引換券", cost: 50, icon: "👑", type: "medal", tint: "#fff1c2" }
]);

const DEFAULT_STATE = Object.freeze({
  points: 0,
  lastCheckinDate: "",
  coupons: [],
  transactions: []
});

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let state = loadState();
let pendingEarnAction = null;
let pendingEarnExpiresAt = 0;
let pendingRewardId = null;
let pendingUseId = null;
let couponFilter = "active";
let lastFocused = null;
let qrScanner = null;
let qrScannerActive = false;
let qrExpiryTimer = null;
let scannerResultLocked = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return clone(DEFAULT_STATE);
    return {
      points: Number.isFinite(Number(saved.points)) ? Math.max(0, Number(saved.points)) : 0,
      lastCheckinDate: typeof saved.lastCheckinDate === "string" ? saved.lastCheckinDate : "",
      coupons: Array.isArray(saved.coupons) ? saved.coupons.filter(Boolean) : [],
      transactions: Array.isArray(saved.transactions) ? saved.transactions.filter(Boolean).slice(-100) : []
    };
  } catch (error) {
    console.error("保存データの読み込みに失敗しました。", error);
    return clone(DEFAULT_STATE);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function getJapanDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

function getTodayKey() {
  const { year, month, day } = getJapanDateParts();
  return `${year}-${month}-${day}`;
}

function formatToday() {
  const { month, day } = getJapanDateParts();
  return `${Number(month)}/${Number(day)}`;
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function showToast(message, type = "") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = "toast"; }, 3000);
}

function showMessage(title, message, icon = "🎉") {
  $("#messageTitle").textContent = title;
  $("#messageText").textContent = message;
  $("#messageIcon").textContent = icon;
  openModal("messageModal");
}

function openModal(id) {
  const backdrop = document.getElementById(id);
  if (!backdrop) return;
  lastFocused = document.activeElement;
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
  if (lastFocused instanceof HTMLElement) lastFocused.focus({ preventScroll: true });
}

function switchScreen(screenId) {
  $$(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === screenId));
  $$(".nav-button").forEach((button) => {
    const active = button.dataset.screen === screenId;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelector(".app-shell")?.scrollTo({ top: 0, behavior: "smooth" });
}

function animatePoints(from, to, label) {
  const pointElement = $("#points");
  const changeElement = $("#pointChange");
  const duration = 680;
  const start = performance.now();
  changeElement.textContent = label;
  changeElement.classList.remove("show");
  void changeElement.offsetWidth;
  changeElement.classList.add("show");

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    pointElement.textContent = Math.round(from + (to - from) * eased).toLocaleString("ja-JP");
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function addTransaction({ kind, name, points, icon }) {
  state.transactions.push({
    id: `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind,
    name,
    points,
    icon,
    at: new Date().toISOString()
  });
  state.transactions = state.transactions.slice(-100);
}

function renderProgress() {
  const costs = [...new Set(REWARDS.map((reward) => reward.cost))].sort((a, b) => a - b);
  const nextCost = costs.find((cost) => cost > state.points);
  const previous = costs.filter((cost) => cost <= state.points).pop() || 0;
  const progress = nextCost ? ((state.points - previous) / Math.max(1, nextCost - previous)) * 100 : 100;
  $("#nextRewardBar").style.width = `${Math.max(0, Math.min(100, progress))}%`;
  if (nextCost) {
    $("#nextRewardText").textContent = "次の交換まで";
    $("#nextRewardHint").textContent = `あと${nextCost - state.points}pt`;
  } else {
    $("#nextRewardText").textContent = "プレミアム特典と交換可能";
    $("#nextRewardHint").textContent = "50pt特典を選べます";
  }
}

function rewardMiniCard(reward) {
  return `
    <article class="reward-mini" style="--tint:${escapeHtml(reward.tint)}">
      <span class="reward-mini-icon">${escapeHtml(reward.icon)}</span>
      <b>${escapeHtml(reward.name)}</b>
      <div class="reward-mini-cost">${reward.cost}<small>pt</small></div>
    </article>`;
}

function renderHomeRewards() {
  const ids = ["crane_plus1", "crane_free1", "crane_free3", "prize_choice"];
  $("#homeRewardPreview").innerHTML = ids.map((id) => REWARDS.find((reward) => reward.id === id)).filter(Boolean).map(rewardMiniCard).join("");
}

function renderHistory() {
  const list = $("#recentHistory");
  const items = state.transactions.slice().reverse().slice(0, 5);
  if (!items.length) {
    list.innerHTML = '<div class="empty-inline">ポイントを獲得・交換すると、ここに履歴が表示されます。</div>';
    return;
  }
  list.innerHTML = items.map((item) => `
    <article class="history-item">
      <span class="history-icon">${escapeHtml(item.icon || (item.points >= 0 ? "＋" : "🎁"))}</span>
      <div><b>${escapeHtml(item.name)}</b><small>${formatDate(item.at)}</small></div>
      <span class="history-points ${item.points < 0 ? "minus" : ""}">${item.points > 0 ? "+" : ""}${item.points}pt</span>
    </article>`).join("");
}

function renderEarnRules() {
  $("#earnRuleList").innerHTML = Object.values(EARN_ACTIONS).map((action) => `
    <article class="earn-rule">
      <span class="earn-rule-icon">${escapeHtml(action.icon)}</span>
      <div>
        <b>${escapeHtml(action.name)}</b>
        <p>${escapeHtml(action.description)}</p>
        <span class="rule-badge">${action.oncePerDay ? (state.lastCheckinDate === getTodayKey() ? "本日取得済み" : "1日1回") : "同日何度でも"}</span>
      </div>
      <span class="earn-rule-points">${action.points}<small>pt</small></span>
    </article>`).join("");
}

function renderClaimPanel() {
  const panel = $("#claimPanel");
  const claimButton = $("#claimButton");
  const expiryBox = $("#claimExpiry");
  const rescanButton = $("#rescanButton");
  panel.classList.remove("ready", "completed");
  $("#locationProof").hidden = true;
  expiryBox.hidden = true;
  rescanButton.hidden = true;

  if (pendingEarnAction && (!pendingEarnExpiresAt || pendingEarnExpiresAt <= Date.now())) {
    clearPendingEarn();
  }

  if (!pendingEarnAction) {
    $("#claimIcon").textContent = "▣";
    $("#claimBadge").textContent = "アプリ内カメラ対応";
    $("#claimTitle").textContent = "ポイントQRを読み取ってください";
    $("#claimDescription").textContent = "下のボタンからカメラを起動し、来店・ゲーム利用・メダル貸出の専用QRを読み取れます。";
    claimButton.querySelector(".button-label").textContent = "カメラでQRコードを読み取る";
    $("#claimButtonNote").textContent = "カメラの使用許可はこのボタンを押した時に確認します。位置情報はQR認証後、ポイント受取ボタンを押した時に確認します。";
    claimButton.classList.add("scan-button");
    claimButton.disabled = false;
    $("#homeActionBanner").hidden = true;
    stopExpiryTimer();
    return;
  }

  const alreadyClaimed = pendingEarnAction.oncePerDay && state[pendingEarnAction.dateField] === getTodayKey();
  if (alreadyClaimed) {
    panel.classList.add("completed");
    $("#claimIcon").textContent = "✅";
    $("#claimBadge").textContent = "本日取得済み";
    $("#claimTitle").textContent = "来店チェックインは完了しています";
    $("#claimDescription").textContent = "来店ポイントは1日1回までです。また明日ご利用ください。";
    claimButton.querySelector(".button-label").textContent = "別のQRコードを読み取る";
    $("#claimButtonNote").textContent = "ゲーム利用・メダル貸出のQRは同じ日でも繰り返し利用できます。";
    claimButton.classList.add("scan-button");
    claimButton.disabled = false;
    $("#homeActionBanner").hidden = true;
    clearPendingEarn();
    return;
  }

  panel.classList.add("ready");
  $("#claimIcon").textContent = pendingEarnAction.icon;
  $("#claimBadge").textContent = pendingEarnAction.oncePerDay ? "来店QR認証済み" : "スタッフQR認証済み";
  $("#claimTitle").textContent = `${pendingEarnAction.points}ポイント受け取れます`;
  $("#claimDescription").textContent = pendingEarnAction.name;
  $("#locationProof").hidden = false;
  $("#locationProofText").textContent = `${STORE.name}周辺で測位誤差を考慮して判定`;
  claimButton.querySelector(".button-label").textContent = `現在地を確認して${pendingEarnAction.points}pt受け取る`;
  $("#claimButtonNote").textContent = "このボタンを押した時に位置情報の使用許可を確認します。QR認証は5分間有効です。測位に失敗しても時間内は再試行できます。";
  claimButton.classList.remove("scan-button");
  claimButton.disabled = false;
  expiryBox.hidden = false;
  rescanButton.hidden = false;
  startExpiryTimer();

  $("#homeActionBanner").hidden = false;
  $("#homeActionIcon").textContent = pendingEarnAction.icon;
  $("#homeActionTitle").textContent = `${pendingEarnAction.points}ポイント受け取れます`;
  $("#homeActionText").textContent = pendingEarnAction.name;
}

function groupRewards() {
  return [3, 6, 15, 50].map((cost) => ({ cost, rewards: REWARDS.filter((reward) => reward.cost === cost) }));
}

function renderExchange() {
  $("#exchangeBalance").textContent = state.points.toLocaleString("ja-JP");
  $("#exchangeGroups").innerHTML = groupRewards().map((group) => `
    <section class="exchange-group">
      <div class="exchange-group-title">
        <span>${group.cost}</span>
        <div><b>${group.cost}ptで交換</b><small>${group.rewards.length}種類から選べます</small></div>
      </div>
      <div class="exchange-card-list">
        ${group.rewards.map((reward) => {
          const affordable = state.points >= reward.cost;
          return `
            <article class="exchange-card" style="--tint:${escapeHtml(reward.tint)}">
              <span class="exchange-icon">${escapeHtml(reward.icon)}</span>
              <div><div class="exchange-name">${escapeHtml(reward.name)}</div><div class="exchange-cost">${reward.cost}<small>pt</small></div></div>
              <button class="exchange-button" type="button" data-reward-id="${escapeHtml(reward.id)}" ${affordable ? "" : "disabled"}>${affordable ? "交換する" : `あと${reward.cost - state.points}pt`}</button>
            </article>`;
        }).join("")}
      </div>
    </section>`).join("");

  $$('[data-reward-id]').forEach((button) => {
    button.addEventListener("click", () => openExchangeConfirm(button.dataset.rewardId));
  });
}

function getReward(id) {
  return REWARDS.find((reward) => reward.id === id) || null;
}

function openExchangeConfirm(rewardId) {
  const reward = getReward(rewardId);
  if (!reward || state.points < reward.cost) return;
  pendingRewardId = rewardId;
  $("#exchangePreview").innerHTML = `<div class="big-icon">${escapeHtml(reward.icon)}</div><b>${escapeHtml(reward.name)}</b><div class="preview-cost">${reward.cost}<small>pt</small></div>`;
  openModal("exchangeModal");
}

function confirmExchange() {
  const reward = getReward(pendingRewardId);
  if (!reward) return;
  state = loadState();
  if (state.points < reward.cost) {
    closeModal("exchangeModal");
    showToast("ポイントが不足しています", "error");
    renderAll();
    return;
  }
  const before = state.points;
  state.points -= reward.cost;
  const couponInstanceId = `${reward.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  state.coupons.push({
    instanceId: couponInstanceId,
    couponId: reward.id,
    name: reward.name,
    cost: reward.cost,
    icon: reward.icon,
    type: reward.type,
    tint: reward.tint,
    exchangedAt: new Date().toISOString(),
    used: false,
    usedAt: null
  });
  addTransaction({ kind: "exchange", name: reward.name, points: -reward.cost, icon: reward.icon });
  saveState();
  closeModal("exchangeModal");
  renderAll(false);
  animatePoints(before, state.points, `-${reward.cost}`);
  showToast("クーポンタブに収納しました", "success");
  sendGasEvent("exchange", {
    itemId: reward.id,
    itemName: reward.name,
    points: -reward.cost,
    balance: state.points,
    couponInstanceId
  });
  pendingRewardId = null;
}

function filteredCoupons() {
  if (couponFilter === "active") return state.coupons.filter((coupon) => !coupon.used);
  if (couponFilter === "used") return state.coupons.filter((coupon) => coupon.used);
  return state.coupons;
}

function renderCoupons() {
  const activeCount = state.coupons.filter((coupon) => !coupon.used).length;
  $("#couponCountText").textContent = `${activeCount}枚使用可能`;
  $("#couponBadge").hidden = activeCount === 0;
  $("#couponBadge").textContent = activeCount > 99 ? "99+" : String(activeCount);

  const items = filteredCoupons();
  const list = $("#couponList");
  if (!items.length) {
    const text = state.coupons.length ? "この条件のクーポンはありません。" : "ポイントを交換すると、ここにクーポンが収納されます。";
    list.innerHTML = `<div class="empty-state"><span>🎫</span><b>クーポンはありません</b><p>${text}</p></div>`;
    return;
  }

  list.innerHTML = items.slice().reverse().map((coupon) => `
    <article class="owned-coupon ${coupon.used ? "used" : ""}" style="--tint:${escapeHtml(coupon.tint || "#e8f8ff")}">
      <span class="coupon-state">${coupon.used ? "使用済み" : "使用可能"}</span>
      <div class="owned-top">
        <span class="owned-icon">${escapeHtml(coupon.icon || "🎫")}</span>
        <div>
          <div class="owned-name">${escapeHtml(coupon.name || "クーポン")}</div>
          <div class="owned-date">交換：${formatDate(coupon.exchangedAt)}</div>
          ${coupon.used ? `<div class="owned-date">使用：${formatDate(coupon.usedAt)}</div>` : ""}
        </div>
      </div>
      <div class="owned-actions">
        ${coupon.used ? '<button class="secondary-button" type="button" disabled>使用済み</button>' : `<button class="danger-button" type="button" data-use-id="${escapeHtml(coupon.instanceId)}">このクーポンを使用する</button>`}
      </div>
    </article>`).join("");

  $$('[data-use-id]').forEach((button) => {
    button.addEventListener("click", () => openUseConfirm(button.dataset.useId));
  });
}

function openUseConfirm(instanceId) {
  const coupon = state.coupons.find((item) => item.instanceId === instanceId);
  if (!coupon || coupon.used) return;
  pendingUseId = instanceId;
  $("#usePreview").innerHTML = `<div class="big-icon">${escapeHtml(coupon.icon || "🎫")}</div><b>${escapeHtml(coupon.name || "クーポン")}</b>`;
  openModal("useModal");
}

function confirmUse() {
  const coupon = state.coupons.find((item) => item.instanceId === pendingUseId);
  if (!coupon || coupon.used) return;
  coupon.used = true;
  coupon.usedAt = new Date().toISOString();
  saveState();
  closeModal("useModal");
  renderCoupons();
  showToast("クーポンを使用済みにしました", "success");
  sendGasEvent("use", {
    itemId: coupon.couponId,
    itemName: coupon.name,
    points: 0,
    balance: state.points,
    couponInstanceId: coupon.instanceId
  });
  pendingUseId = null;
}

function normalizePathname(pathname) {
  let decoded = decodeURIComponent(pathname || "/");
  decoded = decoded.replace(/\/index\.html$/i, "/");
  return decoded.endsWith("/") ? decoded : `${decoded}/`;
}

function actionFromToken(token) {
  return typeof token === "string" ? (EARN_ACTIONS[token.toUpperCase()] || null) : null;
}

function parseEarnActionFromUrl(urlLike) {
  try {
    const url = new URL(urlLike, window.location.href);
    const sameOrigin = url.origin === window.location.origin;
    const samePath = normalizePathname(url.pathname) === normalizePathname(window.location.pathname);
    if (!sameOrigin || !samePath) return null;
    const token = url.searchParams.get("earn")
      || url.searchParams.get("checkin")
      || url.searchParams.get("bonus");
    return actionFromToken(token);
  } catch (error) {
    return null;
  }
}

function detectEarnAction() {
  const url = new URL(window.location.href);
  const hasEarnParameter = ["earn", "checkin", "bonus"].some((key) => url.searchParams.has(key));
  if (!hasEarnParameter) return null;
  return parseEarnActionFromUrl(url.href) || "invalid";
}

function savePendingEarn(action, expiresAt = Date.now() + QR_AUTH_VALID_MS) {
  pendingEarnAction = action;
  pendingEarnExpiresAt = expiresAt;
  try {
    sessionStorage.setItem(QR_SESSION_KEY, JSON.stringify({ token: action.token, expiresAt }));
  } catch (error) {
    console.warn("QR認証情報を一時保存できませんでした。", error);
  }
}

function restorePendingEarn() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(QR_SESSION_KEY));
    const action = actionFromToken(saved?.token);
    const expiresAt = Number(saved?.expiresAt);
    if (!action || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      sessionStorage.removeItem(QR_SESSION_KEY);
      return false;
    }
    pendingEarnAction = action;
    pendingEarnExpiresAt = expiresAt;
    return true;
  } catch (error) {
    try { sessionStorage.removeItem(QR_SESSION_KEY); } catch (_) {}
    return false;
  }
}

function clearPendingEarn() {
  pendingEarnAction = null;
  pendingEarnExpiresAt = 0;
  try { sessionStorage.removeItem(QR_SESSION_KEY); } catch (error) {}
  stopExpiryTimer();
}

function stopExpiryTimer() {
  if (qrExpiryTimer) clearInterval(qrExpiryTimer);
  qrExpiryTimer = null;
}

function updateExpiryDisplay() {
  const box = $("#claimExpiry");
  const label = $("#claimExpiryText");
  if (!box || !label || !pendingEarnAction) return;
  const remaining = Math.max(0, pendingEarnExpiresAt - Date.now());
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  label.textContent = `${minutes}:${seconds}`;
  box.classList.toggle("urgent", remaining <= 30000);
  if (remaining <= 0) {
    clearPendingEarn();
    renderAll();
    showMessage("QR認証の有効時間が切れました", "ポイントQRをもう一度読み取ってください。", "⌛");
  }
}

function startExpiryTimer() {
  stopExpiryTimer();
  updateExpiryDisplay();
  qrExpiryTimer = setInterval(updateExpiryDisplay, 1000);
}

function processQrAccess() {
  try {
    if (sessionStorage.getItem(QR_INVALID_KEY) === "1") {
      sessionStorage.removeItem(QR_INVALID_KEY);
      clearPendingEarn();
      renderAll();
      showMessage("対象外のQRコードです", "このページ用の正しいポイントQRを読み取ってください。", "⚠️");
      return;
    }
  } catch (error) {}
  const detected = detectEarnAction();
  if (detected === "invalid") {
    clearPendingEarn();
    cleanUrl();
    renderAll();
    showMessage("対象外のQRコードです", "このページ用の正しいポイントQRを読み取ってください。", "⚠️");
    return;
  }
  if (detected) {
    savePendingEarn(detected);
    cleanUrl();
    renderAll();
    switchScreen("earnScreen");
    if (detected.oncePerDay && state[detected.dateField] === getTodayKey()) {
      showMessage("本日は取得済みです", "来店チェックインは1日1回までです。別のポイントQRは読み取れます。", "✅");
    } else {
      showToast("QRコードを確認しました", "success");
    }
    return;
  }
  restorePendingEarn();
  renderAll();
  if (pendingEarnAction) switchScreen("earnScreen");
}

function setScannerStatus(message, type = "") {
  const status = $("#scannerStatus");
  if (!status) return;
  status.className = `scanner-status ${type}`.trim();
  const label = status.querySelector("b");
  if (label) label.textContent = message;
}

function describeCameraError(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || String(error).includes("Permission")) return "カメラの使用が許可されていません。ブラウザのサイト設定からカメラを許可してください。";
  if (name === "NotFoundError") return "利用できるカメラが見つかりませんでした。";
  if (name === "NotReadableError") return "カメラを使用できません。他のアプリでカメラを使用していないか確認してください。";
  if (!window.isSecureContext && location.hostname !== "localhost") return "カメラを使うにはGitHub PagesのHTTPS URLから開いてください。";
  return "カメラを起動できませんでした。画像からの読み取りも利用できます。";
}

async function stopQrScanner() {
  if (!qrScanner) return;
  try {
    if (qrScannerActive) await qrScanner.stop();
  } catch (error) {
    console.warn("QRカメラの停止時に警告がありました。", error);
  }
  try { await qrScanner.clear(); } catch (error) {}
  qrScanner = null;
  qrScannerActive = false;
}

async function closeQrScanner() {
  await stopQrScanner();
  scannerResultLocked = false;
  closeModal("qrScannerModal");
  const input = $("#qrImageInput");
  if (input) input.value = "";
}

function handleDecodedQr(decodedText) {
  if (scannerResultLocked) return false;
  const action = parseEarnActionFromUrl(decodedText);
  if (!action) {
    setScannerStatus("このポイントカード用のQRコードではありません", "error");
    if (navigator.vibrate) navigator.vibrate(120);
    return false;
  }
  scannerResultLocked = true;
  if (qrScannerActive && typeof qrScanner?.pause === "function") {
    try { qrScanner.pause(true); } catch (error) {}
  }
  savePendingEarn(action);
  cleanUrl();
  setScannerStatus(`${action.name}を確認しました`, "success");
  if (navigator.vibrate) navigator.vibrate([80, 40, 120]);
  setTimeout(async () => {
    await closeQrScanner();
    state = loadState();
    renderAll();
    switchScreen("earnScreen");
    if (action.oncePerDay && state[action.dateField] === getTodayKey()) {
      showMessage("本日は取得済みです", "来店チェックインは1日1回までです。別のポイントQRは読み取れます。", "✅");
    } else {
      showToast("QR認証完了。現在地を確認してください", "success");
    }
  }, 420);
  return true;
}

async function openQrScanner() {
  if (!window.isSecureContext && location.hostname !== "localhost") {
    showMessage("安全な接続が必要です", "カメラを使用するため、GitHub PagesのHTTPS URLから開いてください。", "🔒");
    return;
  }
  if (typeof window.Html5Qrcode !== "function") {
    showMessage("QR読み取り機能を読み込めませんでした", "通信状況を確認してページを再読み込みしてください。", "⚠️");
    return;
  }
  scannerResultLocked = false;
  openModal("qrScannerModal");
  setScannerStatus("カメラの使用許可を確認しています");
  await stopQrScanner();
  qrScanner = new Html5Qrcode("qrReader", { verbose: false });
  try {
    await qrScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: (width, height) => {
        const size = Math.floor(Math.min(width, height) * 0.72);
        return { width: size, height: size };
      }, aspectRatio: 1.0 },
      (decodedText) => { handleDecodedQr(decodedText); },
      () => {}
    );
    qrScannerActive = true;
    setScannerStatus("QRコードを枠内に映してください");
  } catch (error) {
    console.error("カメラの起動に失敗しました。", error);
    setScannerStatus(describeCameraError(error), "error");
  }
}

async function scanQrImage(file) {
  if (!file) return;
  if (typeof window.Html5Qrcode !== "function") {
    setScannerStatus("QR読み取り機能を読み込めませんでした", "error");
    return;
  }
  setScannerStatus("画像を確認しています");
  await stopQrScanner();
  qrScanner = new Html5Qrcode("qrReader", { verbose: false });
  try {
    const decodedText = await qrScanner.scanFile(file, true);
    handleDecodedQr(decodedText);
  } catch (error) {
    console.error("画像QRの読み取りに失敗しました。", error);
    setScannerStatus("画像からQRコードを読み取れませんでした", "error");
  }
}

function handleClaimButton() {
  if (pendingEarnAction) claimPoints();
  else openQrScanner();
}

function rescanQr() {
  clearPendingEarn();
  renderAll();
  openQrScanner();
}

function getBestCurrentPosition(onProgress) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error("このブラウザは位置情報に対応していません。"), { code: "UNSUPPORTED" }));
      return;
    }

    let bestPosition = null;
    let lastError = null;
    let watchId = null;
    let settled = false;

    const finish = (position, error) => {
      if (settled) return;
      settled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timeoutId);
      if (position) resolve(position);
      else reject(error || lastError || new Error("現在地を取得できませんでした。"));
    };

    const timeoutId = setTimeout(() => {
      finish(bestPosition, lastError);
    }, LOCATION_SAMPLE_MS);

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = Number(position.coords?.accuracy);
        if (!Number.isFinite(accuracy)) return;
        if (!bestPosition || accuracy < Number(bestPosition.coords.accuracy)) {
          bestPosition = position;
          if (typeof onProgress === "function") onProgress(accuracy);
        }
        if (accuracy <= LOCATION_EARLY_SUCCESS_METERS) finish(position, null);
      },
      (error) => {
        lastError = error;
        if (bestPosition) finish(bestPosition, null);
        else finish(null, error);
      },
      GEOLOCATION_OPTIONS
    );
  });
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const radius = 6371000;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function describeGeolocationError(error) {
  if (error?.code === 1) return "位置情報が許可されていません。ブラウザ設定から位置情報を許可してください。";
  if (error?.code === 2) return "現在地を取得できませんでした。入口付近など、電波を受信しやすい場所で再度お試しください。";
  if (error?.code === 3) return "位置情報の取得に時間がかかりました。通信状況を確認して再度お試しください。";
  return error?.message || "位置情報を取得できませんでした。";
}

async function claimPoints() {
  const action = pendingEarnAction;
  if (!action) {
    openQrScanner();
    return;
  }
  if (!pendingEarnExpiresAt || pendingEarnExpiresAt <= Date.now()) {
    clearPendingEarn();
    renderAll();
    showMessage("QR認証の有効時間が切れました", "ポイントQRをもう一度読み取ってください。", "⌛");
    return;
  }
  if (action.oncePerDay && state[action.dateField] === getTodayKey()) {
    renderAll();
    return;
  }
  if (!window.isSecureContext && location.hostname !== "localhost") {
    showMessage("安全な接続が必要です", "位置情報を使用するため、GitHub PagesのHTTPS URLから開いてください。", "🔒");
    return;
  }

  const button = $("#claimButton");
  button.disabled = true;
  button.classList.add("btn-loading");

  try {
    const buttonLabel = button.querySelector(".button-label");
    if (buttonLabel) buttonLabel.textContent = "現在地を測定しています…";
    showToast("館内のため、現在地を数秒間測定します");

    const position = await getBestCurrentPosition((accuracy) => {
      if (buttonLabel) buttonLabel.textContent = `現在地を測定中… 精度 約${Math.round(accuracy)}m`;
    });
    const latitude = Number(position.coords.latitude);
    const longitude = Number(position.coords.longitude);
    const accuracy = Number(position.coords.accuracy);
    if (![latitude, longitude, accuracy].every(Number.isFinite)) throw new Error("位置情報を確認できませんでした。");

    const distance = distanceMeters(STORE.latitude, STORE.longitude, latitude, longitude);
    const effectiveDistance = Math.max(0, distance - Math.max(accuracy, 0));
    const storeInsideAccuracyCircle = effectiveDistance <= action.radiusMeters;

    if (accuracy > MAX_ACCURACY_METERS) {
      showMessage(
        "現在地の範囲が広すぎます",
        `測位精度は約${Math.round(accuracy)}mでした。3,000mを超える場合は判定できません。端末のWi-Fiと位置情報をONにし、少し待ってから再度お試しください。QR認証は残っています。`,
        "📡"
      );
      return;
    }

    if (!storeInsideAccuracyCircle) {
      showMessage(
        "店舗周辺を確認できませんでした",
        `測定位置は店舗基準地点から約${Math.round(distance)}m、測位精度は約${Math.round(accuracy)}mでした。端末の誤差範囲に店舗が含まれていないため、今回は加算できません。QR認証は残っているので再試行できます。`,
        "📍"
      );
      return;
    }

    state = loadState();
    if (action.oncePerDay && state[action.dateField] === getTodayKey()) {
      clearPendingEarn();
      renderAll();
      showMessage("本日は取得済みです", "来店チェックインは1日1回までです。", "✅");
      cleanUrl();
      return;
    }

    const before = state.points;
    state.points += action.points;
    if (action.oncePerDay) state[action.dateField] = getTodayKey();
    addTransaction({ kind: "earn", name: action.name, points: action.points, icon: action.icon });
    saveState();
    renderAll(false);
    animatePoints(before, state.points, `+${action.points}`);
    clearPendingEarn();
    const locationMode = accuracy <= FINE_ACCURACY_METERS ? "高精度測位" : "館内測位";
    sendGasEvent("earn", {
      itemId: action.token,
      itemName: action.name,
      points: action.points,
      balance: state.points,
      distance: Math.round(distance),
      accuracy: Math.round(accuracy),
      locationMode
    });
    showMessage("ポイントGET！", `${action.name}で${action.points}ポイント獲得しました。\n${locationMode}：店舗から約${Math.round(distance)}m・測位精度約${Math.round(accuracy)}mで確認しました。`, "🌊");
    cleanUrl();
  } catch (error) {
    console.error("位置情報確認に失敗しました。", error);
    showMessage("現在地を確認できませんでした", describeGeolocationError(error), "⚠️");
  } finally {
    button.classList.remove("btn-loading");
    renderClaimPanel();
  }
}

function cleanUrl() {
  try {
    const clean = `${window.location.pathname}${window.location.hash || ""}`;
    window.history.replaceState(null, "", clean);
  } catch (error) {
    console.warn("URLを整理できませんでした。", error);
  }
}

function renderAll(updatePointText = true) {
  if (updatePointText) $("#points").textContent = state.points.toLocaleString("ja-JP");
  $("#todayLabel").textContent = formatToday();
  renderProgress();
  renderHomeRewards();
  renderHistory();
  renderEarnRules();
  renderClaimPanel();
  renderExchange();
  renderCoupons();
}

function initEvents() {
  $$(".nav-button").forEach((button) => button.addEventListener("click", () => switchScreen(button.dataset.screen)));
  $$('[data-target-screen]').forEach((button) => button.addEventListener("click", () => switchScreen(button.dataset.targetScreen)));
  $("#homeActionButton").addEventListener("click", () => switchScreen("earnScreen"));
  $("#claimButton").addEventListener("click", handleClaimButton);
  $("#rescanButton").addEventListener("click", rescanQr);
  $("#closeScannerButton").addEventListener("click", closeQrScanner);
  $("#qrImageInput").addEventListener("change", (event) => scanQrImage(event.target.files?.[0]));
  $("#confirmExchangeButton").addEventListener("click", confirmExchange);
  $("#confirmUseButton").addEventListener("click", confirmUse);

  $$('[data-close-modal]').forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
  $$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => {
    if (event.target !== backdrop) return;
    if (backdrop.id === "qrScannerModal") closeQrScanner();
    else closeModal(backdrop.id);
  }));

  $$(".coupon-tab").forEach((button) => button.addEventListener("click", () => {
    couponFilter = button.dataset.couponFilter;
    $$(".coupon-tab").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    renderCoupons();
  }));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const open = $(".modal-backdrop.open");
      if (open?.id === "qrScannerModal") closeQrScanner();
      else if (open) closeModal(open.id);
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = loadState();
    renderAll();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      state = loadState();
      if (!pendingEarnAction) restorePendingEarn();
      renderAll();
      checkRemoteReset();
    } else if (qrScannerActive) {
      stopQrScanner();
    }
  });
}

function init() {
  initEvents();
  renderAll();
  processQrAccess();
  logDailyPageView();
  checkRemoteReset({ showNotice: true });
  setInterval(() => checkRemoteReset(), 5 * 60 * 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
