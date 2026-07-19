import { createClient } from "@supabase/supabase-js";
import "./style.css";

const AUTH_KEY = "transportfunds.auth";
const LOCKOUT_KEY = "transportfunds.lockout";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

// Login lockout: after MAX_ATTEMPTS failed tries, block for LOCK_MINUTES.
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 30;

let currentRole = "viewer"; // "viewer" (default, can only view) or "admin" (can edit)

const demoTrips = [
  { id: "d1", date: "2026-07-15", amount: 16.98, riders: ["黄", "张", "吴"] },
  { id: "d2", date: "2026-07-15", amount: 17.09, riders: ["黄", "张", "吴"] },
  { id: "d3", date: "2026-07-16", amount: 18.01, riders: ["黄", "张", "吴", "陈"] },
  { id: "d4", date: "2026-07-16", amount: 18.56, riders: ["黄", "张", "陈"] },
  { id: "d5", date: "2026-07-16", amount: 21.73, riders: ["黄", "张", "陈"] },
  { id: "d6", date: "2026-07-16", amount: 19.66, riders: ["黄", "张", "吴"] },
  { id: "d7", date: "2026-07-17", amount: 21.77, riders: ["黄", "张", "吴", "陈"] },
  { id: "d8", date: "2026-07-17", amount: 18.69, riders: ["黄", "张", "吴"] },
];

const state = {
  people: ["黄", "张", "吴", "陈"],
  trips: [],
  history: [],
  lastAutoSettle: "", // YYYY-MM of the last automatic monthly settlement
};

// History snapshots: keep at most MAX_HISTORY_ENTRIES; when exceeded, drop the oldest half.
// Also guard total payload size so we stay well within Supabase free-tier limits.
const MAX_HISTORY_ENTRIES = 30;
const MAX_PAYLOAD_BYTES = 200 * 1024; // 200KB safety ceiling for the whole row

let supabase = null;
let saveTimer = null;
let saving = false;
let ignoreRemoteUntil = 0;

const els = {
  loginScreen: document.getElementById("loginScreen"),
  appScreen: document.getElementById("appScreen"),
  passwordInput: document.getElementById("passwordInput"),
  loginBtn: document.getElementById("loginBtn"),
  cancelLoginBtn: document.getElementById("cancelLoginBtn"),
  loginPromptBtn: document.getElementById("loginPromptBtn"),
  loginError: document.getElementById("loginError"),
  logoutBtn: document.getElementById("logoutBtn"),
  syncBadge: document.getElementById("syncBadge"),
  peopleList: document.getElementById("peopleList"),
  rideChecks: document.getElementById("rideChecks"),
  tripsList: document.getElementById("tripsList"),
  summary: document.getElementById("summary"),
  newPerson: document.getElementById("newPerson"),
  addPersonBtn: document.getElementById("addPersonBtn"),
  tripDate: document.getElementById("tripDate"),
  tripTime: document.getElementById("tripTime"),
  tripAmount: document.getElementById("tripAmount"),
  tripNote: document.getElementById("tripNote"),
  addTripBtn: document.getElementById("addTripBtn"),
  loadDemoBtn: document.getElementById("loadDemoBtn"),
  clearBtn: document.getElementById("clearBtn"),
  historyList: document.getElementById("historyList"),
};

function money(n) {
  return Number(n || 0).toFixed(2);
}

function formatDateLabel(iso) {
  if (!iso) return "未填日期";
  const [, m, d] = iso.split("-");
  return `${Number(m)}-${Number(d)}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function setSync(status, text) {
  els.syncBadge.className = `sync-badge ${status}`;
  els.syncBadge.textContent = text;
}

function configReady() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && ADMIN_PASSWORD);
}

function isAuthed() {
  return sessionStorage.getItem(AUTH_KEY) === "1";
}

function applyRole() {
  els.appScreen.dataset.role = currentRole;
  if (currentRole === "admin") {
    els.loginPromptBtn.classList.add("hidden");
    els.logoutBtn.classList.remove("hidden");
  } else {
    els.loginPromptBtn.classList.remove("hidden");
    els.logoutBtn.classList.add("hidden");
  }
}

function showApp() {
  els.loginScreen.classList.add("hidden");
  els.appScreen.classList.remove("hidden");
  applyRole();
}

function showLogin(msg = "") {
  els.appScreen.classList.remove("hidden");
  els.loginScreen.classList.remove("hidden");
  els.loginError.textContent = msg;
  els.passwordInput.value = "";
  els.passwordInput.focus();
}

function hideLogin() {
  els.loginScreen.classList.add("hidden");
  els.passwordInput.value = "";
  els.loginError.textContent = "";
}

// --- Login lockout (client-side, simulates IP ban) ---
function getLockout() {
  try {
    return JSON.parse(localStorage.getItem(LOCKOUT_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLockout(obj) {
  localStorage.setItem(LOCKOUT_KEY, JSON.stringify(obj));
}

function remainingLockMs() {
  const lock = getLockout();
  if (!lock.lockedUntil) return 0;
  return Math.max(0, lock.lockedUntil - Date.now());
}

function clearLockout() {
  localStorage.removeItem(LOCKOUT_KEY);
}

// Collect all unique rider names from trips (including people no longer in the list)
function allKnownNames() {
  const set = new Set(state.people);
  for (const t of state.trips) {
    for (const r of t.riders || []) set.add(r);
  }
  return [...set];
}

function calcTotals() {
  const names = allKnownNames();
  const totals = Object.fromEntries(names.map((p) => [p, 0]));
  const counts = Object.fromEntries(names.map((p) => [p, 0]));

  for (const trip of state.trips) {
    const riders = (trip.riders || []).filter((p) => totals.hasOwnProperty(p));
    if (!riders.length || !(trip.amount > 0)) continue;
    const share = trip.amount / riders.length;
    for (const p of riders) {
      totals[p] += share;
      counts[p] += 1;
    }
  }
  return { totals, counts };
}

function renderPeople() {
  const isAdmin = currentRole === "admin";
  els.peopleList.innerHTML = state.people
    .map(
      (p) => `
      <span class="chip">
        ${p}
        ${isAdmin ? `<button type="button" data-remove-person="${p}" title="移除">×</button>` : ""}
      </span>`
    )
    .join("");

  // Ride checks for the "add trip" form — only current members
  els.rideChecks.innerHTML = state.people
    .map(
      (p) => `
      <label class="check">
        <input type="checkbox" name="rider" value="${p}" />
        ${p}
      </label>`
    )
    .join("");
}

function renderTrips() {
  if (!state.trips.length) {
    els.tripsList.innerHTML = `<div class="empty">还没有行程。${currentRole === "admin" ? "可点击「重置为初始数据」，或手动添加。" : "请等待管理员添加。"}</div>`;
    return;
  }

  const sorted = [...state.trips].sort((a, b) => {
    const d = (a.date || "").localeCompare(b.date || "");
    if (d !== 0) return d;
    return (a.time || "").localeCompare(b.time || "");
  });

  const isAdmin = currentRole === "admin";
  els.tripsList.innerHTML = sorted
    .map((trip) => {
      const riders = trip.riders || [];
      const share = riders.length ? trip.amount / riders.length : 0;
      const timeStr = trip.time ? ` ${trip.time}` : "";
      const noteStr = trip.note ? ` · ${trip.note}` : "";
      const delBtn = isAdmin
        ? `<button class="btn btn-danger" type="button" data-remove-trip="${trip.id}">删除</button>`
        : "";
      return `
        <article class="trip" data-id="${trip.id}">
          <div class="trip-top">
            <div class="trip-meta">
              <span class="trip-date">${formatDateLabel(trip.date)}${timeStr}</span>
              <span class="trip-amount">¥${money(trip.amount)}</span>
              <span class="trip-share">人均 ¥${money(share)} · ${riders.join("") || "无人"}${noteStr}</span>
            </div>
            ${delBtn}
          </div>
        </article>`;
    })
    .join("");
}

function renderSummary() {
  const { totals, counts } = calcTotals();
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  const names = allKnownNames();

  if (!names.length) {
    els.summary.innerHTML = `<div class="empty">请先添加成员。</div>`;
    return;
  }

  // Show current members first, then former members (in trips but not in people)
  const current = state.people.filter((p) => totals.hasOwnProperty(p));
  const former = names.filter((p) => !state.people.includes(p));

  const renderRow = (p) => `
    <div class="person-row${state.people.includes(p) ? "" : " former"}">
      <div class="person-info">
        <div class="person-name">${p}${state.people.includes(p) ? "" : '<span class="former-tag">已移除</span>'}</div>
        <div class="person-detail">参与 ${counts[p]} 次</div>
      </div>
      <div class="person-money">¥${money(totals[p])}</div>
    </div>`;

  els.summary.innerHTML =
    `<div class="summary-grid">` +
    current.map(renderRow).join("") +
    former.map(renderRow).join("") +
    `</div>` +
    `<div class="total-bar"><span>合计核对</span><span>¥${money(grand)}</span></div>`;
}

function render() {
  renderPeople();
  renderTrips();
  renderSummary();
  renderHistory();
}

// Build a compact snapshot of the current settlement state for the history archive.
function buildSnapshot() {
  const { totals, counts } = calcTotals();
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  const names = allKnownNames();
  const dates = state.trips.map((t) => t.date).filter(Boolean).sort();
  return {
    clearedAt: new Date().toISOString(),
    people: [...state.people],
    tripCount: state.trips.length,
    grandTotal: Number(grand.toFixed(2)),
    dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    totals: Object.fromEntries(names.map((p) => [p, Number((totals[p] || 0).toFixed(2))])),
    counts: Object.fromEntries(names.map((p) => [p, counts[p] || 0])),
  };
}

// Keep history within size limits: cap entry count and total payload bytes.
function trimHistory() {
  if (state.history.length > MAX_HISTORY_ENTRIES) {
    state.history = state.history.slice(Math.floor(state.history.length / 2));
  }
  // Also enforce a byte ceiling — drop oldest half until we fit.
  let guard = 0;
  while (state.history.length > 1 && JSON.stringify(state).length > MAX_PAYLOAD_BYTES && guard < 20) {
    state.history = state.history.slice(Math.floor(state.history.length / 2));
    guard++;
  }
}

function formatSnapshotDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day} ${hh}:${mm}`;
}

function renderHistory() {
  if (!els.historyList) return;
  if (!state.history.length) {
    els.historyList.innerHTML = `<div class="empty">暂无历史结算记录。管理员清空数据时会自动保存一份结算快照。</div>`;
    return;
  }
  const sorted = [...state.history].sort((a, b) => (b.clearedAt || "").localeCompare(a.clearedAt || ""));
  els.historyList.innerHTML = sorted
    .map((snap) => {
      const names = Object.keys(snap.totals || {});
      const rows = names
        .map(
          (p) =>
            `<span class="hist-person"><b>${p}</b> ¥${money(snap.totals[p])}<i>${snap.counts[p] || 0}次</i></span>`
        )
        .join("");
      const range = snap.dateRange
        ? `${formatDateLabel(snap.dateRange.from)} ~ ${formatDateLabel(snap.dateRange.to)}`
        : "无日期";
      return `
        <article class="hist-item">
          <div class="hist-top">
            <span class="hist-date">${formatSnapshotDate(snap.clearedAt)}</span>
            <span class="hist-range">${range} · ${snap.tripCount || 0} 条行程</span>
          </div>
          <div class="hist-people">${rows}</div>
          <div class="hist-total">合计 ¥${money(snap.grandTotal)}</div>
        </article>`;
    })
    .join("");
}

function applyRemote(data) {
  state.people = Array.isArray(data.people) ? data.people : [];
  state.trips = Array.isArray(data.trips) ? data.trips : [];
  // Only overwrite history when the remote row actually carries it.
  // Older databases (pre-migration) have no `history` column, so we keep
  // the in-memory snapshot visible for the rest of the session.
  if (Array.isArray(data.history)) {
    state.history = data.history;
  }
  if (typeof data.last_auto_settle === "string") {
    state.lastAutoSettle = data.last_auto_settle;
  }
  render();
}

async function loadFromCloud() {
  setSync("busy", "同步中…");
  // Select all columns so we still work before the `history` migration is applied.
  const { data, error } = await supabase
    .from("app_state")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    setSync("err", "加载失败");
    throw error;
  }

  if (!data) {
    state.people = ["黄", "张", "吴", "陈"];
    state.trips = demoTrips.map((t) => ({ ...t, riders: [...t.riders] }));
    state.history = [];
    await persistNow();
  } else {
    applyRemote(data);
    setSync("ok", "已同步");
  }
}

async function persistNow() {
  if (!supabase) return;
  saving = true;
  setSync("busy", "保存中…");
  ignoreRemoteUntil = Date.now() + 1200;

  const payload = {
    id: 1,
    people: state.people,
    trips: state.trips,
    history: state.history,
    last_auto_settle: state.lastAutoSettle,
    updated_at: new Date().toISOString(),
  };

  let { error } = await supabase.from("app_state").upsert(payload);
  saving = false;

  if (error) {
    // Fallback: older databases may not have the `history` / `last_auto_settle` columns yet.
    const fallback = {
      id: 1,
      people: state.people,
      trips: state.trips,
      updated_at: new Date().toISOString(),
    };
    const retry = await supabase.from("app_state").upsert(fallback);
    if (retry.error) {
      setSync("err", "保存失败");
      console.error(retry.error);
      return;
    }
  }

  setSync("ok", "已同步");
}

function scheduleSave() {
  render();
  if (saveTimer) clearTimeout(saveTimer);
  setSync("busy", "待同步…");
  saveTimer = setTimeout(() => {
    persistNow();
  }, 400);
}

function subscribeRealtime() {
  supabase
    .channel("app_state_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "app_state", filter: "id=eq.1" },
      (payload) => {
        if (saving || Date.now() < ignoreRemoteUntil) return;
        const next = payload.new;
        if (!next) return;
        applyRemote(next);
        setSync("ok", "已同步");
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setSync("ok", "已同步");
      if (status === "CHANNEL_ERROR") setSync("err", "实时断开");
    });
}

async function bootApp() {
  showApp();
  els.tripDate.value = todayISO();
  els.tripNote.value = "取经";

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    await loadFromCloud();
    subscribeRealtime();
    await maybeAutoSettle();
  } catch (err) {
    console.error(err);
    els.summary.innerHTML = `<div class="empty">无法连接 Supabase，请检查环境变量与 schema.sql 是否已执行。</div>`;
  }
}

// Monthly auto-settle: on or after the 31st of a 31-day month, if we haven't
// settled yet this month, save a snapshot and clear trips (keep members).
// Runs client-side on page load; idempotent so multiple users triggering it is fine.
async function maybeAutoSettle() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();
  const daysInMonth = new Date(year, month, 0).getDate();

  // Only settle on months that have a 31st, and only on/after the 31st.
  if (daysInMonth < 31 || day < 31) return;

  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  if (state.lastAutoSettle === monthKey) return; // already settled this month

  if (state.trips.length === 0) {
    // Nothing to settle, but mark as done so we don't keep checking.
    state.lastAutoSettle = monthKey;
    await persistNow();
    return;
  }

  settleAndClearTrips();
  state.lastAutoSettle = monthKey;
  await persistNow();
  render();
}

function tryLogin() {
  if (!configReady()) {
    els.loginError.textContent =
      "未配置环境变量。请设置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_ADMIN_PASSWORD";
    return;
  }

  // Check lockout first
  const remain = remainingLockMs();
  if (remain > 0) {
    const mins = Math.ceil(remain / 60000);
    els.loginError.textContent = `尝试次数过多，已锁定。请 ${mins} 分钟后再试。`;
    return;
  }

  const input = els.passwordInput.value.trim();
  if (!ADMIN_PASSWORD || input !== ADMIN_PASSWORD) {
    // Record failed attempt
    const lock = getLockout();
    lock.attempts = (lock.attempts || 0) + 1;
    if (lock.attempts >= MAX_ATTEMPTS) {
      lock.lockedUntil = Date.now() + LOCK_MINUTES * 60 * 1000;
      lock.attempts = 0;
      els.loginError.textContent = `口令错误次数过多，已锁定 ${LOCK_MINUTES} 分钟。`;
    } else {
      const left = MAX_ATTEMPTS - lock.attempts;
      els.loginError.textContent = `口令不正确。剩余尝试次数：${left}`;
    }
    saveLockout(lock);
    return;
  }

  // Success: clear lockout, switch to admin, hide login screen
  clearLockout();
  sessionStorage.setItem(AUTH_KEY, "1");
  currentRole = "admin";
  els.loginError.textContent = "";
  els.passwordInput.value = "";
  hideLogin();
  applyRole();
  render();
}

function logout() {
  sessionStorage.removeItem(AUTH_KEY);
  currentRole = "viewer";
  applyRole();
  render();
}

function assertAdmin() {
  if (currentRole !== "admin") {
    alert("仅管理员可编辑，请点右上角「管理员登录」。");
    return false;
  }
  return true;
}

function addPerson() {
  if (!assertAdmin()) return;
  const name = els.newPerson.value.trim();
  if (!name) return;
  if (state.people.includes(name)) {
    alert("该成员已存在");
    return;
  }
  state.people.push(name);
  els.newPerson.value = "";
  scheduleSave();
}

function addTrip() {
  if (!assertAdmin()) return;
  const date = els.tripDate.value;
  const time = els.tripTime.value;
  const amount = Number(els.tripAmount.value);
  const note = els.tripNote.value.trim() || "取经";
  const riders = [...document.querySelectorAll('input[name="rider"]:checked')].map((el) => el.value);

  if (!date) {
    alert("请选择日期");
    return;
  }
  if (!(amount > 0)) {
    alert("请输入有效车费");
    return;
  }
  if (!riders.length) {
    alert("请至少勾选一位乘车人");
    return;
  }

  state.trips.push({ id: uid(), date, time, amount, note, riders });
  els.tripAmount.value = "";
  els.tripNote.value = "取经";
  // Uncheck all ride checkboxes after adding
  document.querySelectorAll('input[name="rider"]').forEach((el) => (el.checked = false));
  scheduleSave();
}

function loadDemo() {
  if (!assertAdmin()) return;
  if (!confirm("用初始数据覆盖当前云端数据？")) return;
  state.people = ["黄", "张", "吴", "陈"];
  state.trips = demoTrips.map((t) => ({ ...t, id: uid(), riders: [...t.riders] }));
  scheduleSave();
}

els.loginBtn.addEventListener("click", tryLogin);
els.passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryLogin();
});
// Auto-submit shortly after paste so users can paste the password and log in directly.
els.passwordInput.addEventListener("paste", () => {
  setTimeout(tryLogin, 50);
});
els.loginPromptBtn.addEventListener("click", () => {
  showLogin();
});
els.cancelLoginBtn.addEventListener("click", () => {
  hideLogin();
});
els.logoutBtn.addEventListener("click", logout);
els.addPersonBtn.addEventListener("click", addPerson);
els.newPerson.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPerson();
});
els.addTripBtn.addEventListener("click", addTrip);
els.loadDemoBtn.addEventListener("click", loadDemo);
// Settle: save a snapshot to history and clear trips, but keep members.
function settleAndClearTrips() {
  if (state.trips.length > 0) {
    const snap = buildSnapshot();
    state.history.push(snap);
    trimHistory();
  }
  state.trips = [];
}

els.clearBtn.addEventListener("click", () => {
  if (!assertAdmin()) return;
  const hasTrips = state.trips.length > 0;
  const msg = hasTrips
    ? "确定清空全部行程记录？\n本次结算会自动存入历史记录（含日期、每人应付、行程数等），成员名单会保留。此操作会同步到所有人。"
    : "当前没有行程记录可清空。";
  if (!confirm(msg)) return;
  if (!hasTrips) return;
  settleAndClearTrips();
  scheduleSave();
});

// Remove person: only removes from the people list, does NOT touch existing trips
els.peopleList.addEventListener("click", (e) => {
  const name = e.target.getAttribute("data-remove-person");
  if (!name) return;
  if (!assertAdmin()) return;
  state.people = state.people.filter((p) => p !== name);
  scheduleSave();
});

els.tripsList.addEventListener("click", (e) => {
  const id = e.target.getAttribute("data-remove-trip");
  if (!id) return;
  if (!assertAdmin()) return;
  state.trips = state.trips.filter((t) => t.id !== id);
  scheduleSave();
});

if (!configReady()) {
  // Still boot so user can see error, but in viewer mode
  bootApp();
} else {
  if (isAuthed()) {
    currentRole = "admin";
  }
  bootApp();
}
