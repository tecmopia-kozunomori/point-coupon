"use strict";

const APP_BUILD = "2026.08.12-SERVER-15.2-DIRECT-QR-ONBOARDING";

const STORAGE_KEY = "tecmopia_point_coupon_v1";


const DEVICE_ID_KEY = "tecmopia_device_id_v1";
const DEVICE_SECRET_KEY = "tecmopia_device_secret_v1";
const RESET_VERSION_KEY = "tecmopia_reset_version_v1";
const PAGE_VIEW_DATE_KEY = "tecmopia_page_view_date_v1";
const CHECKIN_REMINDER_MUTE_DATE_KEY = "tecmopia_checkin_reminder_mute_date_v1";
const TUTORIAL_DONE_KEY = "tecmopia_tutorial_done_v1";
const LOCATION_NOTICE_SESSION_KEY = "tecmopia_location_notice_confirmed_v1";
const DIRECT_QR_NOTICE_KEY = "tecmopia_direct_qr_notice_v1";
const GAS_WEB_APP_URL = String(window.TECMOPIA_GAS_URL || "").trim();
const GAS_PLACEHOLDER = "PASTE_GAS_WEB_APP_URL_HERE";
const GAS_ENABLED = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(GAS_WEB_APP_URL)
  && !GAS_WEB_APP_URL.includes(GAS_PLACEHOLDER);
const GAS_JSONP_TIMEOUT_MS = 20000;
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

function getDeviceSecret() {
  try {
    let secret = localStorage.getItem(DEVICE_SECRET_KEY);
    if (!secret) {
      const random = window.crypto?.randomUUID?.().replaceAll("-", "")
        || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      secret = `sec_${random}${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_SECRET_KEY, secret);
    }
    return secret;
  } catch (error) {
    return `sec_session_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
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

function serverJsonp(action, params = {}) {
  return gasJsonp(action, {
    deviceId: getDeviceId(),
    deviceSecret: getDeviceSecret(),
    ...params
  });
}

function normalizeServerState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    points: Number.isFinite(Number(source.points)) ? Math.max(0, Number(source.points)) : 0,
    lastCheckinDate: typeof source.lastCheckinDate === "string" ? source.lastCheckinDate : "",
    coupons: Array.isArray(source.coupons) ? source.coupons.filter(Boolean) : [],
    exchangeLocks: source.exchangeLocks && typeof source.exchangeLocks === "object" ? source.exchangeLocks : {},
    checkinBoostEligible: Boolean(source.checkinBoostEligible),
    transactions: Array.isArray(source.transactions) ? source.transactions.filter(Boolean).slice(-100) : []
  };
}

function applyServerState(nextState, { render = true } = {}) {
  state = normalizeServerState(nextState);
  saveState(); // localStorageは表示用キャッシュ。加算・交換の正本ではありません。
  serverReady = true;
  setServerStatus("connected", "サーバー同期済み", `アプリ ${APP_BUILD}`);
  if (render) renderAll();
}

function serverErrorText(result, fallback = "処理を完了できませんでした。") {
  if (result?.message) return result.message;
  return fallback;
}

async function syncServerState({ showNotice = false } = {}) {
  if (serverSyncing) return false;
  if (!GAS_ENABLED) {
    serverReady = false;
    setServerStatus("error", "GAS設定を読み込めません", "タップして再確認してください");
    renderAll();
    if (showNotice) {
      showMessage(
        "サーバー設定を確認できませんでした",
        "GASの接続先を読み込めませんでした。ページを再読み込みしてください。改善しない場合は、GitHubにgas-config.jsがアップロードされているか確認してください。",
        "⚙️"
      );
    }
    return false;
  }
  serverSyncing = true;
  setServerStatus("checking", "サーバー確認中", "ポイント残高を確認しています");
  try {
    const result = await serverJsonp("bootstrap");
    if (!result?.ok || !result.state) throw new Error(serverErrorText(result, "ポイント情報を取得できませんでした。"));
    applyServerState(result.state);
    if (showNotice && result.created) showToast("新しいポイントカードを登録しました", "success");
    return true;
  } catch (error) {
    console.error("サーバー同期に失敗しました。", error);
    serverReady = false;
    setServerStatus("error", "サーバー未接続", "通信状況とGASのデプロイを確認してください");
    renderAll();
    if (showNotice) {
      showMessage(
        "ポイント情報を確認できませんでした",
        "通信状況を確認してページを再読み込みしてください。画面には前回取得した情報を表示していますが、ポイント加算・交換・クーポン使用はできません。",
        "📡"
      );
    }
    return false;
  } finally {
    serverSyncing = false;
  }
}

async function checkRemoteReset({ showNotice = false } = {}) {
  return syncServerState({ showNotice });
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
    description: "店内のポイント用QRコードを読み取り、店舗周辺で現在地を確認します。",
    oncePerDay: true,
    dateField: "lastCheckinDate",
    radiusMeters: 250
  }),
  CRANE500: Object.freeze({
    id: "crane500",
    token: "CRANE500",
    name: "クレーンゲーム500円投入",
    shortName: "500円投入",
    points: 5,
    icon: "🕹️",
    description: "クレーンゲームに500円投入後、スタッフ提示QRを読み取ります。",
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
  { id: "crane_plus1", name: "クレーンゲーム1回増量券", cost: 3, icon: "🕹️", type: "crane", tint: "#e4f7ff", banner: "./images/coupons/coupon_crane_bonus_1play.webp", notice: "対象台に限ります。", noticeDetail: "筐体ガラス面に設置されている案内をご確認ください。" },
  { id: "medal_10", name: "ゲームメダル10枚引換券", cost: 3, icon: "🪙", type: "medal", tint: "#fff6d8", banner: "./images/coupons/coupon_medal_10.webp" },
  { id: "crane_free1", name: "クレーンゲーム1回無料券", cost: 6, icon: "🎮", type: "crane", tint: "#e4f7ff", banner: "./images/coupons/coupon_crane_free_1play.webp", notice: "対象台に限ります。", noticeDetail: "筐体ガラス面に設置されている案内をご確認ください。" },
  { id: "medal_30", name: "ゲームメダル30枚引換券", cost: 6, icon: "🪙", type: "medal", tint: "#fff6d8", banner: "./images/coupons/coupon_medal_30.webp" },
  { id: "crane_500_7", name: "クレーンゲーム500円で7PLAY券", cost: 6, icon: "7️⃣", type: "crane", tint: "#e9f6ff", banner: "./images/coupons/coupon_crane_500yen_7play.webp", notice: "対象台に限ります。", noticeDetail: "筐体ガラス面に設置されている案内をご確認ください。" },
  { id: "crane_free3", name: "クレーンゲーム3回無料券", cost: 15, icon: "🏆", type: "crane", tint: "#e5f8ff", banner: "./images/coupons/coupon_crane_free_3play.webp", notice: "対象台に限ります。", noticeDetail: "筐体ガラス面に設置されている案内をご確認ください。" },
  { id: "medal_99", name: "ゲームメダル99枚引換券", cost: 15, icon: "✨", type: "medal", tint: "#fff4ce", banner: "./images/coupons/coupon_medal_99.webp" },
  { id: "prize_choice", name: "お好きな景品と交換券", cost: 50, icon: "🎁", type: "prize", tint: "#f2eaff", banner: "./images/coupons/coupon_special_prize.webp", premium: true, oneTime: true, notice: "お一人様1回限り。店内在庫があるものに限ります。", noticeDetail: "一度交換すると、使用後も再交換できません。" },
  { id: "medal_3333", name: "ゲームメダル3,333枚引換券", cost: 50, icon: "👑", type: "medal", tint: "#fff1c2", banner: "./images/coupons/coupon_medal_3333.webp", premium: true }
]);

const DEFAULT_STATE = Object.freeze({
  points: 0,
  lastCheckinDate: "",
  coupons: [],
  exchangeLocks: {},
  checkinBoostEligible: false,
  transactions: []
});

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let state = loadState();
let pendingEarnAction = null;
let pendingEarnExpiresAt = 0;
let pendingScanTicket = "";
let pendingRewardId = null;
let pendingUseId = null;
let couponFilter = "active";
let lastFocused = null;
let qrScanner = null;
let qrScannerActive = false;
let qrExpiryTimer = null;
let scannerResultLocked = false;
let serverReady = false;
let serverSyncing = false;

function setServerStatus(mode, text, detail = "") {
  const status = document.getElementById("serverStatus");
  if (!status) return;
  status.className = `server-status ${mode || ""}`.trim();
  status.textContent = text;
  status.title = detail || text;
}

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
      exchangeLocks: saved.exchangeLocks && typeof saved.exchangeLocks === "object" ? saved.exchangeLocks : {},
      checkinBoostEligible: Boolean(saved.checkinBoostEligible),
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

const BUSINESS_HOURS = Object.freeze({ startHour: 10, endHour: 20 });
const CAMPAIGN_DATES = Object.freeze({
  checkinBoostStart: "2026-08-12",
  checkinBoostEnd: "2026-08-31",
  earnEnd: "2026-08-31",
  exchangeUseEnd: "2026-09-30"
});

function getJapanTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

function isBusinessHours(date = new Date()) {
  const { hour } = getJapanTimeParts(date);
  const currentHour = Number(hour);
  return currentHour >= BUSINESS_HOURS.startHour && currentHour < BUSINESS_HOURS.endHour;
}

function businessHoursText() {
  return `${BUSINESS_HOURS.startHour}:00〜${BUSINESS_HOURS.endHour}:00`;
}

function getJapanDateKey(date = new Date()) {
  const { year, month, day } = getJapanDateParts(date);
  return `${year}-${month}-${day}`;
}

function isEarnPeriod(date = new Date()) {
  return getJapanDateKey(date) <= CAMPAIGN_DATES.earnEnd;
}

function isExchangeUsePeriod(date = new Date()) {
  return getJapanDateKey(date) <= CAMPAIGN_DATES.exchangeUseEnd;
}

function isCheckinBoostPeriod() {
  const today = getTodayKey();
  return today >= CAMPAIGN_DATES.checkinBoostStart && today <= CAMPAIGN_DATES.checkinBoostEnd;
}

function currentCheckinPoints() {
  return isCheckinBoostPeriod() && state.checkinBoostEligible ? 3 : 1;
}

function pendingEarnDisplayPoints(action) {
  if (!action) return 0;
  if (action.id !== "visit" || !isCheckinBoostPeriod() || !state.checkinBoostEligible) return action.points;
  if (state.lastCheckinDate === getTodayKey()) return Math.max(0, 3 - action.points);
  return 3;
}

function formatCampaignDate(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function earnDeadlineText() {
  return `${formatCampaignDate(CAMPAIGN_DATES.earnEnd)}まで`;
}

function exchangeUseDeadlineText() {
  return `${formatCampaignDate(CAMPAIGN_DATES.exchangeUseEnd)}まで`;
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

function isCheckinReminderMutedToday() {
  try {
    return localStorage.getItem(CHECKIN_REMINDER_MUTE_DATE_KEY) === getTodayKey();
  } catch (error) {
    return false;
  }
}

function muteCheckinReminderToday() {
  try {
    localStorage.setItem(CHECKIN_REMINDER_MUTE_DATE_KEY, getTodayKey());
  } catch (error) {
    console.warn("チェックイン通知の非表示設定を保存できませんでした。", error);
  }
  closeModal("checkinReminderModal");
}

function shouldShowCheckinReminder() {
  if (!serverReady) return false;
  if (!isEarnPeriod()) return false;
  if (!isBusinessHours()) return false;
  if (state.lastCheckinDate === getTodayKey()) return false;
  if (isCheckinReminderMutedToday()) return false;
  if (pendingEarnAction) return false;
  if (directQrOnboardingPending) return false;
  if ($(".modal-backdrop.open") || tutorialActive) return false;
  return true;
}

function maybeShowCheckinReminder() {
  if (!shouldShowCheckinReminder()) return;
  openModal("checkinReminderModal");
}

function startCheckinFromReminder() {
  closeModal("checkinReminderModal");
  switchScreen("earnScreen");
  openQrScanner();
}

let tutorialStep = 0;
let tutorialActive = false;
let directQrOnboardingPending = false;

const TUTORIAL_STEPS = Object.freeze([
  {
    screen: "homeScreen",
    target: '.nav-button[data-screen="earnScreen"]',
    icon: "📷",
    title: "まずは「貯める」から",
    text: "ここからカメラを許可して店内のポイント用QRコードを読み取ります。QR認証後、ポイントを受け取る時に位置情報を許可してください。",
    next: "貯め方を見る"
  },
  {
    screen: "earnScreen",
    target: ".guide-details",
    icon: "💡",
    title: "貯め方はここで確認",
    text: "チェックイン・クレーンゲーム・メダル貸出など、ポイントの受け取り方をここからいつでも確認できます。",
    next: "交換先を見る",
    openGuide: true
  },
  {
    screen: "exchangeScreen",
    target: '.nav-button[data-screen="exchangeScreen"]',
    icon: "🎁",
    title: "ポイントの交換先はこちら",
    text: "貯めたポイントはここから特典に交換できます。交換するとクーポンタブへ自動で入ります。",
    next: "クーポンを見る"
  },
  {
    screen: "couponScreen",
    target: '.nav-button[data-screen="couponScreen"]',
    icon: "🎫",
    title: "使う時は「クーポン」",
    text: "交換したクーポンはここにあります。使用する時はスタッフに画面を見せてから使用ボタンを押してください。",
    next: "はじめる"
  }
]);

function hasCompletedTutorial() {
  try {
    return localStorage.getItem(TUTORIAL_DONE_KEY) === "1";
  } catch (error) {
    return false;
  }
}

function markTutorialDone() {
  try {
    localStorage.setItem(TUTORIAL_DONE_KEY, "1");
  } catch (error) {
    console.warn("チュートリアル状態を保存できませんでした。", error);
  }
}

function clearTutorialFocus() {
  $$(".tutorial-focus").forEach((element) => element.classList.remove("tutorial-focus"));
}

function renderTutorialStep() {
  const step = TUTORIAL_STEPS[tutorialStep];
  if (!step) return;
  clearTutorialFocus();
  switchScreen(step.screen);
  if (step.openGuide) {
    const guide = $(".guide-details");
    if (guide) guide.open = true;
  }
  $("#tutorialStepLabel").textContent = `STEP ${tutorialStep + 1} / ${TUTORIAL_STEPS.length}`;
  $("#tutorialIcon").textContent = step.icon;
  $("#tutorialTitle").textContent = step.title;
  $("#tutorialText").textContent = step.text;
  $("#tutorialNextButton").textContent = step.next;
  $("#tutorialBackButton").hidden = tutorialStep === 0;
  $$(".tutorial-dots span").forEach((dot, index) => dot.classList.toggle("active", index === tutorialStep));

  requestAnimationFrame(() => {
    const target = $(step.target);
    if (!target) return;
    target.classList.add("tutorial-focus");
    if (!target.closest(".bottom-nav")) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

function openTutorial({ manual = false } = {}) {
  if (tutorialActive) return;
  if (!manual && (hasCompletedTutorial() || state.points !== 0 || pendingEarnAction || $(".modal-backdrop.open"))) return;
  tutorialActive = true;
  tutorialStep = 0;
  const backdrop = $("#tutorialBackdrop");
  if (!backdrop) return;
  backdrop.classList.add("open");
  backdrop.setAttribute("aria-hidden", "false");
  document.body.classList.add("tutorial-open");
  renderTutorialStep();
  requestAnimationFrame(() => backdrop.querySelector(".tutorial-panel")?.focus());
}

function closeTutorial({ completed = true } = {}) {
  if (completed) markTutorialDone();
  tutorialActive = false;
  clearTutorialFocus();
  const backdrop = $("#tutorialBackdrop");
  if (backdrop) {
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("tutorial-open");
  switchScreen("homeScreen");
  window.setTimeout(maybeShowCheckinReminder, 650);
}

function nextTutorialStep() {
  if (tutorialStep >= TUTORIAL_STEPS.length - 1) {
    closeTutorial({ completed: true });
    return;
  }
  tutorialStep += 1;
  renderTutorialStep();
}

function previousTutorialStep() {
  if (tutorialStep <= 0) return;
  tutorialStep -= 1;
  renderTutorialStep();
}

function maybeShowTutorial() {
  if (!serverReady) return;
  if (state.points !== 0) return;
  if (hasCompletedTutorial()) return;
  if (pendingEarnAction || $(".modal-backdrop.open")) return;
  openTutorial();
}

function continueAfterDirectCheckinNotice() {
  if (!directQrOnboardingPending) return;
  if (!serverReady) {
    directQrOnboardingPending = false;
    return;
  }
  if ($(".modal-backdrop.open") || tutorialActive) {
    window.setTimeout(continueAfterDirectCheckinNotice, 180);
    return;
  }

  directQrOnboardingPending = false;

  // 初めて使う人は、まず操作方法を案内します。
  // チュートリアルを完了またはスキップすると、closeTutorial() から
  // 初回3pt／通常1ptのチェックイン案内へ続きます。
  if (state.points === 0 && !hasCompletedTutorial()) {
    openTutorial();
    return;
  }

  // 既にチュートリアル済みの人には、従来どおりチェックイン案内だけを表示します。
  maybeShowCheckinReminder();
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
  const iconElement = $("#messageIcon");
  iconElement.classList.remove("has-image");
  iconElement.replaceChildren();

  if (icon && typeof icon === "object" && icon.image) {
    const image = document.createElement("img");
    image.src = icon.image;
    image.alt = icon.alt || title;
    image.width = 1024;
    image.height = 1024;
    iconElement.classList.add("has-image");
    iconElement.appendChild(image);
  } else {
    iconElement.textContent = typeof icon === "string" ? icon : "🎉";
  }

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

  if (id === "messageModal" && directQrOnboardingPending) {
    window.setTimeout(continueAfterDirectCheckinNotice, 220);
  }
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

let pointAnimationFrame = 0;
let pointAnimationSequence = 0;

function animatePoints(from, to) {
  const pointElement = $("#points");
  const balanceElement = $("#pointBalance");
  const exchangeBalanceElement = $("#exchangeBalance");
  const startValue = Number(from) || 0;
  const endValue = Number(to) || 0;
  const difference = endValue - startValue;
  const sequence = ++pointAnimationSequence;

  cancelAnimationFrame(pointAnimationFrame);
  balanceElement.classList.remove("counting-up", "counting-down", "counting-done");
  void balanceElement.offsetWidth;
  balanceElement.classList.add(difference >= 0 ? "counting-up" : "counting-down");

  // 1ptでも変化がしっかり見え、15pt以上でも長すぎない速度。
  const duration = Math.min(2600, Math.max(1500, 1350 + Math.abs(difference) * 75));
  const startedAt = performance.now();

  return new Promise((resolve) => {
    function tick(now) {
      if (sequence !== pointAnimationSequence) {
        resolve();
        return;
      }

      const progress = Math.min((now - startedAt) / duration, 1);
      // 最初はゆっくり動き出し、途中は回転するように進み、最後はゆっくり停止。
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const current = Math.round(startValue + difference * eased);
      const formatted = current.toLocaleString("ja-JP");
      pointElement.textContent = formatted;
      exchangeBalanceElement.textContent = formatted;

      if (progress < 1) {
        pointAnimationFrame = requestAnimationFrame(tick);
        return;
      }

      const finalText = endValue.toLocaleString("ja-JP");
      pointElement.textContent = finalText;
      exchangeBalanceElement.textContent = finalText;
      balanceElement.classList.remove("counting-up", "counting-down");
      balanceElement.classList.add("counting-done");
      setTimeout(() => balanceElement.classList.remove("counting-done"), 520);
      resolve();
    }

    pointAnimationFrame = requestAnimationFrame(tick);
  });
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
      ${reward.banner ? `<div class="reward-mini-banner"><img src="${escapeHtml(reward.banner)}" alt="${escapeHtml(reward.name)}" loading="lazy" decoding="async" width="750" height="250"></div>` : ""}
      <div class="reward-mini-body">
        <span class="reward-mini-icon">${escapeHtml(reward.icon)}</span>
        <b>${escapeHtml(reward.name)}</b>
        <div class="reward-mini-cost">${reward.cost}<small>pt</small></div>
      </div>
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
  $("#earnRuleList").innerHTML = Object.values(EARN_ACTIONS).map((action) => {
    const isVisit = action.id === "visit";
    const sameDayBoostTopUp = isVisit && isCheckinBoostPeriod() && state.checkinBoostEligible && state.lastCheckinDate === getTodayKey();
    const displayPoints = sameDayBoostTopUp ? 2 : (isVisit ? currentCheckinPoints() : action.points);
    const description = isVisit && isCheckinBoostPeriod()
      ? (sameDayBoostTopUp
          ? "本日すでに通常1ptを受け取っているため、再読取で初回3ptブーストの差額2ptを受け取れます。"
          : (state.checkinBoostEligible
              ? "8/12〜8/31の最初のチェックインだけ3pt。受け取り後は通常の1ptに戻ります。"
              : "初回3ptブースト受け取り済み。以降のチェックインは1日1回1ptです。"))
      : action.description;
    const badge = action.oncePerDay
      ? (sameDayBoostTopUp ? "差額2pt対象" : (state.lastCheckinDate === getTodayKey() ? "本日取得済み" : (isVisit && state.checkinBoostEligible && isCheckinBoostPeriod() ? "初回3pt対象" : "1日1回")))
      : "同日何度でも";
    return `
    <article class="earn-rule ${isVisit && state.checkinBoostEligible && isCheckinBoostPeriod() ? "boost-rule" : ""}">
      <span class="earn-rule-icon">${escapeHtml(action.icon)}</span>
      <div>
        <b>${escapeHtml(action.name)}</b>
        <p>${escapeHtml(description)}</p>
        <span class="rule-badge">${escapeHtml(badge)}</span>
      </div>
      <span class="earn-rule-points">${displayPoints}<small>pt</small></span>
    </article>`;
  }).join("");
}

function renderCheckinBoost() {
  const banner = $("#checkinBoostBanner");
  if (!banner) return;
  if (!serverReady) {
    banner.hidden = true;
    return;
  }
  const active = isCheckinBoostPeriod();
  const eligible = active && state.checkinBoostEligible;
  banner.hidden = !active;
  if (active) {
    banner.classList.toggle("claimed", !eligible);
    $("#checkinBoostTitle").textContent = eligible ? "初回チェックインは3pt！" : "初回3ptブースト受け取り済み";
    $("#checkinBoostText").textContent = eligible
      ? "8/12〜8/31の最初の無料チェックインだけ3pt。過去にチェックイン済みの方も対象です。"
      : "次回以降の無料チェックインは通常どおり1日1回1ptです。";
    $("#checkinBoostStatus").textContent = eligible ? "対象" : "受取済";
  }

  const reminderKicker = $("#checkinReminderKicker");
  const reminderTitle = $("#checkinReminderTitle");
  const reminderText = $("#checkinReminderText");
  const reminderBoostNote = $("#checkinReminderBoostNote");
  const homeCheckinRate = $("#homeCheckinRate");

  if (homeCheckinRate) homeCheckinRate.textContent = eligible ? "初回チェックイン3pt" : "来店で1pt";

  if (eligible) {
    if (reminderKicker) reminderKicker.textContent = "FIRST CHECK-IN BONUS";
    if (reminderTitle) reminderTitle.innerHTML = "初回限定！無料チェックインで<br>3ptプレゼント！";
    if (reminderText) reminderText.innerHTML = '店内のチェックイン用QRコードから、<strong id="checkinReminderPoints">3pt</strong>を受け取れます。';
    if (reminderBoostNote) {
      reminderBoostNote.textContent = "🎁 3ptですぐにクーポンと引き換えられます！";
      reminderBoostNote.hidden = false;
    }
  } else {
    if (reminderKicker) reminderKicker.textContent = "DAILY CHECK-IN";
    if (reminderTitle) reminderTitle.innerHTML = "今日のチェックインは<br>お済みですか？";
    if (reminderText) reminderText.innerHTML = '店内のチェックイン用QRコードから、<strong id="checkinReminderPoints">1pt</strong>を受け取れます。';
    if (reminderBoostNote) reminderBoostNote.hidden = true;
  }
}


function renderClaimPanel() {
  const panel = $("#claimPanel");
  const claimButton = $("#claimButton");
  const expiryBox = $("#claimExpiry");
  const rescanButton = $("#rescanButton");
  panel.classList.remove("ready", "completed", "closed", "period-ended");
  claimButton.classList.remove("scan-button", "earn-button");
  $("#locationProof").hidden = true;
  $("#locationPrivacy").hidden = true;
  expiryBox.hidden = true;
  rescanButton.hidden = true;

  if (pendingEarnAction && (!pendingScanTicket || !pendingEarnExpiresAt || pendingEarnExpiresAt <= Date.now())) {
    clearPendingEarn();
  }

  if (!GAS_ENABLED || !serverReady) {
    panel.classList.add("closed");
    $("#claimIcon").textContent = "📡";
    $("#claimBadge").textContent = GAS_ENABLED ? "データ確認中" : "サーバー未設定";
    $("#claimTitle").textContent = GAS_ENABLED ? "ポイント情報を確認しています" : "ポイント管理サーバーに接続できません";
    $("#claimDescription").textContent = GAS_ENABLED
      ? "通信が完了するとポイント加算ボタンを利用できます。"
      : "gas-config.js のウェブアプリURLをご確認ください。";
    claimButton.querySelector(".button-label").textContent = "現在は操作できません";
    $("#claimButtonNote").textContent = "画面の閲覧はできますが、ポイント加算にはサーバー接続が必要です。";
    claimButton.disabled = true;
    $("#homeActionBanner").hidden = true;
    stopExpiryTimer();
    return;
  }

  if (!isEarnPeriod()) {
    clearPendingEarn();
    panel.classList.add("closed", "period-ended");
    $("#claimIcon").textContent = "📅";
    $("#claimBadge").textContent = "ポイント受付終了";
    $("#claimTitle").textContent = "ポイント受け取り期間は終了しました";
    $("#claimDescription").textContent = `ポイントの受け取りは${earnDeadlineText()}でした。保有ポイントの確認は引き続き行えます。`;
    $("#locationProof").hidden = false;
    $("#locationProofText").textContent = `ポイント交換・クーポン利用は${exchangeUseDeadlineText()}`;
    claimButton.querySelector(".button-label").textContent = "ポイント受付は終了しました";
    $("#claimButtonNote").textContent = "ポイント交換とクーポンの利用期限をご確認ください。";
    claimButton.disabled = true;
    $("#homeActionBanner").hidden = true;
    stopExpiryTimer();
    return;
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

  const boostTopUpAvailable = pendingEarnAction.id === "visit"
    && isCheckinBoostPeriod()
    && state.checkinBoostEligible
    && state.lastCheckinDate === getTodayKey();
  const alreadyClaimed = pendingEarnAction.oncePerDay && state[pendingEarnAction.dateField] === getTodayKey() && !boostTopUpAvailable;
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

  if (!isBusinessHours()) {
    panel.classList.add("closed");
    $("#claimIcon").textContent = "🕙";
    $("#claimBadge").textContent = "営業時間外";
    $("#claimTitle").textContent = "現在はポイントを受け取れません";
    $("#claimDescription").textContent = `ポイント加算は営業時間内（${businessHoursText()}）のみ利用できます。ページの閲覧や特典の確認はそのまま行えます。`;
    $("#locationProof").hidden = false;
    $("#locationProofText").textContent = `ポイント加算受付時間 ${businessHoursText()}`;
    claimButton.querySelector(".button-label").textContent = `営業時間外（${businessHoursText()}）`;
    $("#claimButtonNote").textContent = "QR認証が残っている場合も、営業時間内にもう一度操作してください。";
    claimButton.disabled = true;
    expiryBox.hidden = false;
    rescanButton.hidden = false;
    startExpiryTimer();
    $("#homeActionBanner").hidden = true;
    return;
  }

  panel.classList.add("ready");
  const pendingPoints = pendingEarnDisplayPoints(pendingEarnAction);
  $("#claimIcon").textContent = pendingEarnAction.icon;
  $("#claimBadge").textContent = boostTopUpAvailable ? "初回3ptブースト差額" : (pendingEarnAction.oncePerDay ? "来店QR認証済み" : "スタッフQR認証済み");
  $("#claimTitle").textContent = `${pendingPoints}ポイント受け取れます`;
  $("#claimDescription").textContent = boostTopUpAvailable ? "本日受取済み1ptに、差額2ptを追加します" : pendingEarnAction.name;
  $("#locationProof").hidden = false;
  $("#locationProofText").textContent = `${STORE.name}周辺にいる場合のみ加算`;
  $("#locationPrivacy").hidden = false;
  claimButton.querySelector(".button-label").textContent = `現在地を確認して${pendingPoints}pt受け取る`;
  $("#claimButtonNote").textContent = "ボタンを押すと、位置情報についてのご案内を表示します。QR認証は5分間有効で、測位に失敗しても時間内は再試行できます。";
  claimButton.classList.add("earn-button");
  claimButton.disabled = false;
  expiryBox.hidden = false;
  rescanButton.hidden = false;
  startExpiryTimer();

  $("#homeActionBanner").hidden = false;
  $("#homeActionIcon").textContent = pendingEarnAction.icon;
  $("#homeActionTitle").textContent = `${pendingPoints}ポイント受け取れます`;
  $("#homeActionText").textContent = boostTopUpAvailable ? "初回3ptブーストの差額2pt" : pendingEarnAction.name;
}

function groupRewards() {
  return [3, 6, 15, 50].map((cost) => ({ cost, rewards: REWARDS.filter((reward) => reward.cost === cost) }));
}

function hasExchangedReward(rewardId) {
  return Boolean(state.exchangeLocks?.[rewardId]) || state.coupons.some((coupon) => coupon && coupon.couponId === rewardId);
}

function isRewardLocked(reward) {
  return Boolean(reward?.oneTime && hasExchangedReward(reward.id));
}

function premiumBadgeHtml(extraClass = "") {
  return `<span class="premium-badge ${escapeHtml(extraClass)}"><span>✦</span> PREMIUM <span>✦</span></span>`;
}

function renderExchange() {
  const exchangeAvailable = isExchangeUsePeriod();
  $("#exchangeBalance").textContent = state.points.toLocaleString("ja-JP");

  const deadlineNotice = $("#exchangeDeadlineNotice");
  if (deadlineNotice) {
    deadlineNotice.classList.toggle("ended", !exchangeAvailable);
    deadlineNotice.querySelector("b").textContent = exchangeAvailable
      ? `ポイント交換期限：${exchangeUseDeadlineText()}`
      : "ポイント交換期間は終了しました";
    deadlineNotice.querySelector("p").textContent = exchangeAvailable
      ? "期限内に交換したクーポンも、同じ日までにご利用ください。"
      : `ポイント交換・クーポン利用は${exchangeUseDeadlineText()}でした。`;
  }

  $("#exchangeGroups").innerHTML = groupRewards().map((group) => {
    const premiumGroup = group.cost === 50;
    return `
    <section class="exchange-group ${premiumGroup ? "premium-group" : ""}">
      <div class="exchange-group-title">
        <span class="exchange-cost-badge">${group.cost}</span>
        <div class="exchange-group-copy"><b>${group.cost}ptで交換</b><small>${premiumGroup ? "最高ランクのプレミアム特典" : `${group.rewards.length}種類から選べます`}</small></div>
        ${premiumGroup ? premiumBadgeHtml("group-premium-badge") : ""}
      </div>
      <div class="exchange-card-list">
        ${group.rewards.map((reward) => {
          const affordable = state.points >= reward.cost;
          const locked = isRewardLocked(reward);
          const enabled = serverReady && exchangeAvailable && affordable && !locked;
          const label = !serverReady
            ? "確認中"
            : (!exchangeAvailable
              ? "受付終了"
              : (locked
                ? "交換済み"
                : (affordable ? "交換する" : `あと${reward.cost - state.points}pt`)));
          return `
            <article class="exchange-card ${reward.premium ? "premium-card" : ""} ${reward.oneTime ? "one-time-card" : ""} ${locked ? "one-time-locked" : ""} ${!exchangeAvailable ? "period-ended" : ""}" style="--tint:${escapeHtml(reward.tint)}">
              ${reward.premium ? '<span class="premium-sheen" aria-hidden="true"></span>' : ""}
              ${reward.premium ? premiumBadgeHtml("card-premium-badge") : ""}
              ${locked ? '<span class="one-time-lock-badge">✓ 交換済み・再交換不可</span>' : (reward.oneTime ? '<span class="one-time-limit-badge">1回限り</span>' : "")}
              ${reward.banner ? `<div class="exchange-banner-wrap"><img class="exchange-banner-image" src="${escapeHtml(reward.banner)}" alt="${escapeHtml(reward.name)}" loading="lazy" decoding="async" width="750" height="250"></div>` : ""}
              <div class="exchange-card-body">
                <span class="exchange-icon">${escapeHtml(reward.icon)}</span>
                <div>
                  <div class="exchange-name">${escapeHtml(reward.name)}</div>
                  <div class="exchange-cost">${reward.cost}<small>pt</small></div>
                  ${couponNoticeHtml(reward, "exchange-condition")}
                </div>
                <button class="exchange-button" type="button" data-reward-id="${escapeHtml(reward.id)}" ${enabled ? "" : "disabled"}>${label}</button>
              </div>
            </article>`;
        }).join("")}
      </div>
    </section>`;
  }).join("");

  $$('[data-reward-id]').forEach((button) => {
    button.addEventListener("click", () => openExchangeConfirm(button.dataset.rewardId));
  });
}

function getReward(id) {
  return REWARDS.find((reward) => reward.id === id) || null;
}

function getCouponBanner(coupon) {
  if (!coupon) return "";
  if (typeof coupon.banner === "string" && coupon.banner) return coupon.banner;
  return getReward(coupon.couponId)?.banner || "";
}

function getCouponNotice(item) {
  if (!item) return { title: "", detail: "" };
  const reward = item.id ? item : getReward(item.couponId);
  return {
    title: String(item.notice || reward?.notice || ""),
    detail: String(item.noticeDetail || reward?.noticeDetail || "")
  };
}

function couponNoticeHtml(item, extraClass = "") {
  const notice = getCouponNotice(item);
  if (!notice.title) return "";
  return `
    <div class="coupon-condition ${escapeHtml(extraClass)}">
      <strong>※ ${escapeHtml(notice.title)}</strong>
      ${notice.detail ? `<small>${escapeHtml(notice.detail)}</small>` : ""}
    </div>`;
}

function openExchangeConfirm(rewardId) {
  if (!serverReady) {
    showMessage("ポイント情報を確認できません", "通信状況を確認してページを再読み込みしてください。", "📡");
    return;
  }
  if (!isExchangeUsePeriod()) {
    showMessage("ポイント交換期間は終了しました", `ポイント交換は${exchangeUseDeadlineText()}です。`, "📅");
    return;
  }
  const reward = getReward(rewardId);
  if (!reward) return;
  if (isRewardLocked(reward)) {
    showMessage("交換は1回限りです", "「お好きな景品と交換券」はすでに交換済みです。使用後も再交換はできません。", "🔒");
    return;
  }
  if (state.points < reward.cost) return;
  pendingRewardId = rewardId;
  const preview = $("#exchangePreview");
  preview.classList.toggle("premium-preview", Boolean(reward.premium));
  preview.innerHTML = `${reward.premium ? premiumBadgeHtml("modal-premium-badge") : ""}${reward.banner ? `<div class="modal-coupon-banner-wrap"><img class="modal-coupon-banner" src="${escapeHtml(reward.banner)}" alt="${escapeHtml(reward.name)}" loading="eager" decoding="async" width="750" height="250"></div>` : `<div class="big-icon">${escapeHtml(reward.icon)}</div>`}<b>${escapeHtml(reward.name)}</b><div class="preview-cost">${reward.cost}<small>pt</small></div>${reward.oneTime ? '<div class="modal-one-time-alert"><b>交換はお一人様1回限り</b><span>一度交換すると、使用後も再交換できません。</span></div>' : ""}${couponNoticeHtml(reward, "modal-condition")}`;
  openModal("exchangeModal");
}

async function confirmExchange() {
  const reward = getReward(pendingRewardId);
  if (!reward) return;
  if (isRewardLocked(reward)) {
    closeModal("exchangeModal");
    pendingRewardId = null;
    renderExchange();
    showMessage("交換は1回限りです", "「お好きな景品と交換券」はすでに交換済みです。使用後も再交換はできません。", "🔒");
    return;
  }
  if (!serverReady) {
    closeModal("exchangeModal");
    showMessage("ポイント情報を確認できません", "通信状況を確認してページを再読み込みしてください。", "📡");
    return;
  }
  if (!isExchangeUsePeriod()) {
    closeModal("exchangeModal");
    pendingRewardId = null;
    renderExchange();
    showMessage("ポイント交換期間は終了しました", `ポイント交換は${exchangeUseDeadlineText()}です。`, "📅");
    return;
  }

  const button = $("#confirmExchangeButton");
  const before = state.points;
  button.disabled = true;
  button.classList.add("btn-loading");
  try {
    const result = await serverJsonp("exchange", {
      rewardId: reward.id,
      requestId: makeEventId("exchange")
    });
    if (result?.state) applyServerState(result.state, { render: false });
    if (!result?.ok) {
      throw new Error(serverErrorText(result, "ポイント交換を完了できませんでした。"));
    }
    closeModal("exchangeModal");
    renderAll(false);
    switchScreen("homeScreen");
    await animatePoints(before, state.points);
    showToast("クーポンタブに収納しました", "success");
    pendingRewardId = null;
  } catch (error) {
    console.error("ポイント交換に失敗しました。", error);
    closeModal("exchangeModal");
    renderAll();
    showMessage("ポイント交換できませんでした", error.message || "通信状況を確認して再度お試しください。", "⚠️");
  } finally {
    button.classList.remove("btn-loading");
    button.disabled = false;
  }
}

function isCouponExpired(coupon, date = new Date()) {
  return Boolean(coupon && !coupon.used && !isExchangeUsePeriod(date));
}

function filteredCoupons() {
  if (couponFilter === "active") return state.coupons.filter((coupon) => !coupon.used && !isCouponExpired(coupon));
  if (couponFilter === "used") return state.coupons.filter((coupon) => coupon.used);
  return state.coupons;
}

function renderCoupons() {
  const useAvailable = isExchangeUsePeriod();
  const activeCount = state.coupons.filter((coupon) => !coupon.used && !isCouponExpired(coupon)).length;
  $("#couponCountText").textContent = `${activeCount}枚使用可能`;
  $("#couponBadge").hidden = activeCount === 0;
  $("#couponBadge").textContent = activeCount > 99 ? "99+" : String(activeCount);

  const deadlineNotice = $("#couponDeadlineNotice");
  if (deadlineNotice) {
    deadlineNotice.classList.toggle("ended", !useAvailable);
    deadlineNotice.querySelector("b").textContent = useAvailable
      ? `クーポン使用期限：${exchangeUseDeadlineText()}`
      : "クーポン使用期間は終了しました";
    deadlineNotice.querySelector("p").textContent = useAvailable
      ? "期限を過ぎたクーポンはご利用いただけません。"
      : `クーポンの使用期限は${exchangeUseDeadlineText()}でした。`;
  }

  const items = filteredCoupons();
  const list = $("#couponList");
  if (!items.length) {
    const text = state.coupons.length
      ? (couponFilter === "active" && !useAvailable ? "未使用のクーポンは使用期限を過ぎています。" : "この条件のクーポンはありません。")
      : "ポイントを交換すると、ここにクーポンが収納されます。";
    list.innerHTML = `<div class="empty-state"><span>🎫</span><b>クーポンはありません</b><p>${text}</p></div>`;
    return;
  }

  list.innerHTML = items.slice().reverse().map((coupon) => {
    const expired = isCouponExpired(coupon);
    const banner = getCouponBanner(coupon);
    const stateLabel = coupon.used ? "使用済み" : (expired ? "期限切れ" : "使用可能");
    const actionButton = coupon.used
      ? '<button class="secondary-button" type="button" disabled>使用済み</button>'
      : (expired
        ? '<button class="secondary-button" type="button" disabled>使用期限終了</button>'
        : `<button class="danger-button" type="button" data-use-id="${escapeHtml(coupon.instanceId)}">このクーポンを使用する</button>`);
    return `
    <article class="owned-coupon ${Number(coupon.cost) === 50 ? "premium-card" : ""} ${coupon.couponId === "prize_choice" ? "one-time-card" : ""} ${coupon.used ? "used" : ""} ${expired ? "expired" : ""}" style="--tint:${escapeHtml(coupon.tint || "#e8f8ff")}">
      ${Number(coupon.cost) === 50 ? '<span class="premium-sheen" aria-hidden="true"></span>' : ""}
      ${Number(coupon.cost) === 50 ? premiumBadgeHtml("coupon-premium-badge") : ""}
      ${coupon.couponId === "prize_choice" ? '<span class="one-time-coupon-badge">お一人様1回限り</span>' : ""}
      ${banner ? `<div class="coupon-banner-wrap"><img class="coupon-banner-image" src="${escapeHtml(banner)}" alt="${escapeHtml(coupon.name || "クーポン")}" loading="lazy" decoding="async" width="750" height="250"></div>` : ""}
      <span class="coupon-state">${stateLabel}</span>
      <div class="owned-coupon-body">
        <div class="owned-top">
          <span class="owned-icon">${escapeHtml(coupon.icon || "🎫")}</span>
          <div>
            <div class="owned-name">${escapeHtml(coupon.name || "クーポン")}</div>
            <div class="owned-date">交換：${formatDate(coupon.exchangedAt)}</div>
            <div class="owned-date coupon-expiry">使用期限：${formatCampaignDate(CAMPAIGN_DATES.exchangeUseEnd)}</div>
            ${couponNoticeHtml(coupon, "owned-condition")}
            ${coupon.used ? `<div class="owned-date">使用：${formatDate(coupon.usedAt)}</div>` : ""}
          </div>
        </div>
        <div class="owned-actions">${actionButton}</div>
      </div>
    </article>`;
  }).join("");

  $$('[data-use-id]').forEach((button) => {
    button.addEventListener("click", () => openUseConfirm(button.dataset.useId));
  });
}

function openUseConfirm(instanceId) {
  if (!serverReady) {
    showMessage("クーポン情報を確認できません", "通信状況を確認してページを再読み込みしてください。", "📡");
    return;
  }
  if (!isExchangeUsePeriod()) {
    showMessage("クーポン使用期間は終了しました", `クーポンの使用期限は${exchangeUseDeadlineText()}です。`, "📅");
    return;
  }
  const coupon = state.coupons.find((item) => item.instanceId === instanceId);
  if (!coupon || coupon.used) return;
  pendingUseId = instanceId;
  const banner = getCouponBanner(coupon);
  $("#usePreview").innerHTML = `${banner ? `<div class="modal-coupon-banner-wrap"><img class="modal-coupon-banner" src="${escapeHtml(banner)}" alt="${escapeHtml(coupon.name || "クーポン")}" loading="eager" decoding="async" width="750" height="250"></div>` : `<div class="big-icon">${escapeHtml(coupon.icon || "🎫")}</div>`}<b>${escapeHtml(coupon.name || "クーポン")}</b>${couponNoticeHtml(coupon, "modal-condition")}`;
  openModal("useModal");
}

async function confirmUse() {
  if (!serverReady) {
    closeModal("useModal");
    showMessage("クーポン情報を確認できません", "通信状況を確認してページを再読み込みしてください。", "📡");
    return;
  }
  if (!isExchangeUsePeriod()) {
    closeModal("useModal");
    pendingUseId = null;
    renderCoupons();
    showMessage("クーポン使用期間は終了しました", `クーポンの使用期限は${exchangeUseDeadlineText()}です。`, "📅");
    return;
  }
  const coupon = state.coupons.find((item) => item.instanceId === pendingUseId);
  if (!coupon || coupon.used) return;

  const button = $("#confirmUseButton");
  button.disabled = true;
  try {
    const result = await serverJsonp("useCoupon", {
      couponInstanceId: coupon.instanceId,
      requestId: makeEventId("use")
    });
    if (result?.state) applyServerState(result.state, { render: false });
    if (!result?.ok) throw new Error(serverErrorText(result, "クーポンを使用済みにできませんでした。"));
    const serverCoupon = state.coupons.find((item) => item.instanceId === coupon.instanceId);
    if (!serverCoupon?.used) {
      throw new Error("サーバー側で使用済み状態を確認できませんでした。ページを再読み込みして、もう一度確認してください。");
    }
    sendGasEvent("server_coupon_use_success", {
      itemId: coupon.couponId,
      itemName: coupon.name,
      points: 0,
      balance: state.points,
      couponInstanceId: coupon.instanceId
    });
    closeModal("useModal");
    renderAll();
    showToast("サーバーに使用済みとして記録しました", "success");
    pendingUseId = null;
  } catch (error) {
    console.error("クーポン使用処理に失敗しました。", error);
    closeModal("useModal");
    renderAll();
    showMessage("クーポンを使用できませんでした", error.message || "通信状況を確認して再度お試しください。", "⚠️");
  } finally {
    button.disabled = false;
  }
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

function savePendingEarn(action, scanTicket, expiresAt = Date.now() + QR_AUTH_VALID_MS) {
  pendingEarnAction = action;
  pendingEarnExpiresAt = expiresAt;
  pendingScanTicket = String(scanTicket || "");
  try {
    sessionStorage.setItem(QR_SESSION_KEY, JSON.stringify({
      token: action.token,
      scanTicket: pendingScanTicket,
      source: "in_app_camera",
      expiresAt
    }));
  } catch (error) {
    console.warn("QR認証情報を一時保存できませんでした。", error);
  }
}

function restorePendingEarn() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(QR_SESSION_KEY));
    const action = actionFromToken(saved?.token);
    const expiresAt = Number(saved?.expiresAt);
    const scanTicket = String(saved?.scanTicket || "");
    const fromInAppCamera = saved?.source === "in_app_camera";
    if (!action || !fromInAppCamera || !scanTicket || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      sessionStorage.removeItem(QR_SESSION_KEY);
      return false;
    }
    pendingEarnAction = action;
    pendingEarnExpiresAt = expiresAt;
    pendingScanTicket = scanTicket;
    return true;
  } catch (error) {
    try { sessionStorage.removeItem(QR_SESSION_KEY); } catch (_) {}
    return false;
  }
}

function clearPendingEarn() {
  pendingEarnAction = null;
  pendingEarnExpiresAt = 0;
  pendingScanTicket = "";
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
  let directToken = "";
  try {
    const directNotice = JSON.parse(sessionStorage.getItem(DIRECT_QR_NOTICE_KEY));
    directToken = String(directNotice?.token || "");
    sessionStorage.removeItem(DIRECT_QR_NOTICE_KEY);

    // 旧版ページで作られた直接アクセス由来の認証情報も破棄します。
    if (sessionStorage.getItem(QR_INVALID_KEY) === "1") {
      sessionStorage.removeItem(QR_INVALID_KEY);
      directToken = "INVALID";
    }
  } catch (error) {
    try { sessionStorage.removeItem(DIRECT_QR_NOTICE_KEY); } catch (_) {}
  }

  // index.htmlとのキャッシュ不一致時にも、URL直開きは必ず案内だけにします。
  const detected = detectEarnAction();
  if (detected) directToken = detected === "invalid" ? "INVALID" : detected.token;

  if (directToken) {
    clearPendingEarn();
    cleanUrl();
    renderAll();
    switchScreen("earnScreen");
    const action = actionFromToken(directToken);
    if (!action) {
      showMessage("対象外のQRコードです", "ポイントカード内のカメラから、正しいポイントQRを読み取ってください。", "⚠️");
      return;
    }
    sendGasEvent("direct_qr_blocked", {
      itemId: action.id,
      itemName: action.name,
      points: 0,
      balance: state.points
    });

    // 標準カメラから来店チェックインQRを開いた場合は、
    // この案内を閉じたあとに初回導線へつなげます。
    directQrOnboardingPending = action.id === "visit";

    showMessage(
      "サイト内カメラから読み取ってください",
      "このQRコードをスマートフォンの標準カメラから直接開いた場合、ポイントは加算できません。画面の「カメラでQRコードを読み取る」を押して、同じQRコードをもう一度読み取ってください。",
      "📷"
    );
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
  return "カメラを起動できませんでした。ブラウザのカメラ許可と、他のアプリでカメラを使用していないか確認してください。";
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
}

async function handleDecodedQr(decodedText) {
  if (scannerResultLocked) return false;
  const action = parseEarnActionFromUrl(decodedText);
  if (!action) {
    setScannerStatus("このポイントカード用のQRコードではありません", "error");
    if (navigator.vibrate) navigator.vibrate(120);
    return false;
  }
  if (!serverReady) {
    setScannerStatus("サーバー接続を確認できません。ページを再読み込みしてください", "error");
    return false;
  }

  scannerResultLocked = true;
  if (qrScannerActive && typeof qrScanner?.pause === "function") {
    try { qrScanner.pause(true); } catch (error) {}
  }
  setScannerStatus("サイト内カメラでの読み取りを確認しています");

  try {
    const result = await serverJsonp("beginScan", {
      token: action.token,
      requestId: makeEventId("scan")
    });
    if (!result?.ok || !result.scanTicket) {
      throw new Error(serverErrorText(result, "QRコードを認証できませんでした。"));
    }

    const expiresAt = Number(result.expiresAt) || (Date.now() + QR_AUTH_VALID_MS);
    savePendingEarn(action, result.scanTicket, expiresAt);
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
        showToast("サイト内カメラ認証完了。現在地を確認してください", "success");
      }
    }, 420);
    return true;
  } catch (error) {
    console.error("QR認証に失敗しました。", error);
    setScannerStatus(error.message || "QRコードを認証できませんでした", "error");
    scannerResultLocked = false;
    if (qrScannerActive && typeof qrScanner?.resume === "function") {
      try { qrScanner.resume(); } catch (resumeError) {}
    }
    if (navigator.vibrate) navigator.vibrate(120);
    return false;
  }
}

async function openQrScanner() {
  if (!serverReady) {
    showMessage("ポイント情報を確認できません", "通信状況を確認してページを再読み込みしてください。", "📡");
    return;
  }
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

function hasConfirmedLocationNotice() {
  try {
    return sessionStorage.getItem(LOCATION_NOTICE_SESSION_KEY) === "1";
  } catch (error) {
    return false;
  }
}

function confirmLocationNotice() {
  try {
    sessionStorage.setItem(LOCATION_NOTICE_SESSION_KEY, "1");
  } catch (error) {
    console.warn("位置情報案内の確認状態を保存できませんでした。", error);
  }
  closeModal("locationNoticeModal");
  claimPoints();
}

function handleClaimButton() {
  if (!serverReady) {
    showMessage("ポイント情報を確認できません", "通信状況を確認してページを再読み込みしてください。", "📡");
    return;
  }
  if (!isEarnPeriod()) {
    showMessage("ポイント受け取り期間は終了しました", `ポイントの受け取りは${earnDeadlineText()}です。`, "📅");
    return;
  }
  if (pendingEarnAction) {
    if (!hasConfirmedLocationNotice()) {
      openModal("locationNoticeModal");
      return;
    }
    claimPoints();
  } else {
    openQrScanner();
  }
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
  if (!serverReady) {
    showMessage("ポイント情報を確認できません", "通信状況を確認してページを再読み込みしてください。", "📡");
    return;
  }
  if (!isEarnPeriod()) {
    clearPendingEarn();
    renderAll();
    showMessage("ポイント受け取り期間は終了しました", `ポイントの受け取りは${earnDeadlineText()}です。`, "📅");
    return;
  }
  if (!action) {
    openQrScanner();
    return;
  }
  if (!pendingScanTicket) {
    clearPendingEarn();
    renderAll();
    showMessage("QR認証を確認できません", "ポイントカード内のカメラからQRコードをもう一度読み取ってください。", "📷");
    return;
  }
  if (!isBusinessHours()) {
    renderAll();
    showMessage(
      "営業時間外です",
      `ポイント加算は${businessHoursText()}の間のみ利用できます。ページや保有ポイント、クーポンはそのまま確認できます。`,
      "🕙"
    );
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
    showToast("ポイント加算のため、現在地を数秒間確認します");

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

    if (!isEarnPeriod()) {
      clearPendingEarn();
      renderAll();
      showMessage(
        "ポイント受け取り期間が終了しました",
        `ポイントの受け取りは${earnDeadlineText()}です。今回は加算されていません。`,
        "📅"
      );
      cleanUrl();
      return;
    }

    if (!isBusinessHours()) {
      renderAll();
      showMessage(
        "営業時間外になりました",
        `ポイント加算は${businessHoursText()}の間のみ利用できます。今回は加算されていません。`,
        "🕙"
      );
      return;
    }

    const before = state.points;
    const result = await serverJsonp("claim", {
      token: action.token,
      scanTicket: pendingScanTicket,
      latitude,
      longitude,
      accuracy,
      requestId: makeEventId("claim")
    });

    if (result?.state) applyServerState(result.state, { render: false });
    if (!result?.ok) {
      if (result?.code === "ALREADY_CLAIMED") {
        clearPendingEarn();
        renderAll();
        showMessage("本日は取得済みです", result.message || "来店チェックインは1日1回までです。", "✅");
        cleanUrl();
        return;
      }
      throw new Error(serverErrorText(result, "ポイントを加算できませんでした。"));
    }

    renderAll(false);
    clearPendingEarn();
    switchScreen("homeScreen");
    await animatePoints(before, state.points);
    const locationMode = result.locationMode || (accuracy <= FINE_ACCURACY_METERS ? "高精度測位" : "館内測位");
    const earnedLabel = result.checkinBoostTopUp ? "初回3ptブーストの差額" : action.name;
    showMessage(
      "ポイントGET！",
      `${earnedLabel}で${Number(result.added || action.points)}ポイント獲得しました。\n${locationMode}：店舗から約${Number(result.distance ?? Math.round(distance))}m・測位精度約${Number(result.accuracy ?? Math.round(accuracy))}mで確認しました。`,
      { image: "./images/effects/GET.png?v=20260727-effect08", alt: "ポイントGET！" }
    );
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
  renderCheckinBoost();
  renderClaimPanel();
  renderExchange();
  renderCoupons();
}

function initEvents() {
  $$(".nav-button").forEach((button) => button.addEventListener("click", () => switchScreen(button.dataset.screen)));
  $$('[data-target-screen]').forEach((button) => button.addEventListener("click", () => switchScreen(button.dataset.targetScreen)));
  $("#homeActionButton").addEventListener("click", () => switchScreen("earnScreen"));
  $("#claimButton").addEventListener("click", handleClaimButton);
  $("#confirmLocationButton").addEventListener("click", confirmLocationNotice);
  $("#rescanButton").addEventListener("click", rescanQr);
  $("#closeScannerButton").addEventListener("click", closeQrScanner);
  $("#confirmExchangeButton").addEventListener("click", confirmExchange);
  $("#confirmUseButton").addEventListener("click", confirmUse);
  $("#checkinReminderScanButton").addEventListener("click", startCheckinFromReminder);
  $("#checkinReminderMuteButton").addEventListener("click", muteCheckinReminderToday);
  $("#openTutorialButton")?.addEventListener("click", () => openTutorial({ manual: true }));
  $("#tutorialNextButton")?.addEventListener("click", nextTutorialStep);
  $("#tutorialBackButton")?.addEventListener("click", previousTutorialStep);
  $("#tutorialSkipButton")?.addEventListener("click", () => closeTutorial({ completed: true }));

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
      if (tutorialActive) {
        closeTutorial({ completed: true });
        return;
      }
      const open = $(".modal-backdrop.open");
      if (open?.id === "qrScannerModal") closeQrScanner();
      else if (open) closeModal(open.id);
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = loadState();
    renderAll();
    syncServerState();
  });

  const serverStatus = document.getElementById("serverStatus");
  if (serverStatus) {
    serverStatus.setAttribute("role", "button");
    serverStatus.setAttribute("tabindex", "0");
    serverStatus.title = "タップしてサーバー接続を再確認";
    const retryServer = () => syncServerState({ showNotice: true });
    serverStatus.addEventListener("click", retryServer);
    serverStatus.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        retryServer();
      }
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      state = loadState();
      if (!pendingEarnAction) restorePendingEarn();
      renderAll();
      syncServerState();
    } else if (qrScannerActive) {
      stopQrScanner();
    }
  });
}

async function init() {
  initEvents();
  renderAll();
  const synced = await syncServerState({ showNotice: true });
  processQrAccess();
  if (synced) {
    logDailyPageView();
    window.setTimeout(maybeShowTutorial, 320);
    window.setTimeout(maybeShowCheckinReminder, 900);
  }
  setInterval(() => syncServerState(), 2 * 60 * 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
