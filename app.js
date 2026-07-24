"use strict";

const STORAGE_KEY = "tecmopia_point_coupon_v1";

const STORE = Object.freeze({
  name: "テクモピア ロックダム公津の杜店",
  address: "千葉県成田市公津の杜4丁目5-3 成田ユアエルム3F",
  latitude: 35.7596755,
  longitude: 140.2965801
});

const GEOLOCATION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0
});

const MAX_ACCURACY_METERS = 200;

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
    radiusMeters: 150
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
    radiusMeters: 100
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
    radiusMeters: 100
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
    radiusMeters: 100
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
    radiusMeters: 100
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
    radiusMeters: 100
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
let pendingRewardId = null;
let pendingUseId = null;
let couponFilter = "active";
let lastFocused = null;

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
  panel.classList.remove("ready", "completed");
  $("#locationProof").hidden = true;

  if (!pendingEarnAction) {
    $("#claimIcon").textContent = "▣";
    $("#claimBadge").textContent = "QRコード待機中";
    $("#claimTitle").textContent = "対象のQRコードを読み取ってください";
    $("#claimDescription").textContent = "来店チェックイン、クレーンゲーム、メダル貸出の専用QRからポイントを受け取れます。";
    claimButton.querySelector(".button-label").textContent = "QRコードからアクセスしてください";
    claimButton.disabled = true;
    $("#homeActionBanner").hidden = true;
    return;
  }

  const alreadyClaimed = pendingEarnAction.oncePerDay && state[pendingEarnAction.dateField] === getTodayKey();
  if (alreadyClaimed) {
    panel.classList.add("completed");
    $("#claimIcon").textContent = "✅";
    $("#claimBadge").textContent = "本日取得済み";
    $("#claimTitle").textContent = "来店チェックインは完了しています";
    $("#claimDescription").textContent = "来店ポイントは1日1回までです。また明日ご利用ください。";
    claimButton.querySelector(".button-label").textContent = "本日は取得済みです";
    claimButton.disabled = true;
    $("#homeActionBanner").hidden = true;
    return;
  }

  panel.classList.add("ready");
  $("#claimIcon").textContent = pendingEarnAction.icon;
  $("#claimBadge").textContent = pendingEarnAction.oncePerDay ? "来店QR" : "スタッフ確認QR";
  $("#claimTitle").textContent = `${pendingEarnAction.points}ポイント受け取れます`;
  $("#claimDescription").textContent = pendingEarnAction.name;
  $("#locationProof").hidden = false;
  $("#locationProofText").textContent = `${STORE.name}から${pendingEarnAction.radiusMeters}m以内で加算`;
  claimButton.querySelector(".button-label").textContent = `現在地を確認して${pendingEarnAction.points}pt受け取る`;
  claimButton.disabled = false;

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
  state.coupons.push({
    instanceId: `${reward.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
  pendingUseId = null;
}

function detectEarnAction() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("earn")
    || url.searchParams.get("checkin")
    || url.searchParams.get("bonus");
  if (!token) return null;
  return EARN_ACTIONS[token] || "invalid";
}

function processQrAccess() {
  const detected = detectEarnAction();
  if (detected === "invalid") {
    pendingEarnAction = null;
    renderAll();
    showMessage("対象外のQRコードです", "このQRコードからはポイントを獲得できません。", "⚠️");
    cleanUrl();
    return;
  }
  pendingEarnAction = detected;
  renderAll();
  if (pendingEarnAction) {
    switchScreen("earnScreen");
    if (pendingEarnAction.oncePerDay && state[pendingEarnAction.dateField] === getTodayKey()) {
      showMessage("本日は取得済みです", "来店チェックインは1日1回までです。", "✅");
      cleanUrl();
    }
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error("このブラウザは位置情報に対応していません。"), { code: "UNSUPPORTED" }));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, GEOLOCATION_OPTIONS);
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
  if (!action) return;
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
    const position = await getCurrentPosition();
    const latitude = Number(position.coords.latitude);
    const longitude = Number(position.coords.longitude);
    const accuracy = Number(position.coords.accuracy);
    if (![latitude, longitude, accuracy].every(Number.isFinite)) throw new Error("位置情報を確認できませんでした。");
    if (accuracy > MAX_ACCURACY_METERS) {
      showMessage("位置情報の精度が不足しています", `現在の精度は約${Math.round(accuracy)}mです。入口付近などで再度お試しください。`, "📡");
      return;
    }
    const distance = distanceMeters(STORE.latitude, STORE.longitude, latitude, longitude);
    if (distance > action.radiusMeters) {
      showMessage("店舗周辺を確認できません", `店舗基準地点から約${Math.round(distance)}mと判定されました。${action.radiusMeters}m以内で再度お試しください。`, "📍");
      return;
    }

    state = loadState();
    if (action.oncePerDay && state[action.dateField] === getTodayKey()) {
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
    showMessage("ポイントGET！", `${action.name}で${action.points}ポイント獲得しました。`, "🌊");
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
  $("#claimButton").addEventListener("click", claimPoints);
  $("#confirmExchangeButton").addEventListener("click", confirmExchange);
  $("#confirmUseButton").addEventListener("click", confirmUse);

  $$('[data-close-modal]').forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
  $$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeModal(backdrop.id);
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
      if (open) closeModal(open.id);
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
