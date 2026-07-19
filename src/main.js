import { createClient } from "@supabase/supabase-js";
import "./style.css";

const AUTH_KEY = "transportfunds.auth";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD;

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
};

let supabase = null;
let saveTimer = null;
let saving = false;
let ignoreRemoteUntil = 0;

const els = {
  loginScreen: document.getElementById("loginScreen"),
  appScreen: document.getElementById("appScreen"),
  passwordInput: document.getElementById("passwordInput"),
  loginBtn: document.getElementById("loginBtn"),
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
  tripAmount: document.getElementById("tripAmount"),
  addTripBtn: document.getElementById("addTripBtn"),
  loadDemoBtn: document.getElementById("loadDemoBtn"),
  clearBtn: document.getElementById("clearBtn"),
};

function money(n) {
  return Number(n || 0).toFixed(2);
}

function formatDateLabel(iso) {
  if (!iso) return "未填日期";
  const [, m, d] = iso.split("-");
  return `${Number(m)}${d}`;
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
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && APP_PASSWORD);
}

function isAuthed() {
  return sessionStorage.getItem(AUTH_KEY) === "1";
}

function showApp() {
  els.loginScreen.classList.add("hidden");
  els.appScreen.classList.remove("hidden");
}

function showLogin(msg = "") {
  els.appScreen.classList.add("hidden");
  els.loginScreen.classList.remove("hidden");
  els.loginError.textContent = msg;
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
  els.peopleList.innerHTML = state.people
    .map(
      (p) => `
      <span class="chip">
        ${p}
        <button type="button" data-remove-person="${p}" title="移除">×</button>
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
    els.tripsList.innerHTML = `<div class="empty">还没有行程。可点击「载入示例」，或手动添加。</div>`;
    return;
  }

  const sorted = [...state.trips].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  els.tripsList.innerHTML = sorted
    .map((trip) => {
      const riders = trip.riders || [];
      const share = riders.length ? trip.amount / riders.length : 0;
      return `
        <article class="trip" data-id="${trip.id}">
          <div class="trip-top">
            <div class="trip-meta">
              <span class="trip-date">${formatDateLabel(trip.date)}</span>
              <span class="trip-amount">¥${money(trip.amount)}</span>
              <span class="trip-share">人均 ¥${money(share)} · ${riders.join("") || "无人"}</span>
            </div>
            <button class="btn btn-danger" type="button" data-remove-trip="${trip.id}">删除</button>
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
      <div class="person-name">${p}${state.people.includes(p) ? "" : '<span class="former-tag">已移除</span>'}</div>
      <div class="person-detail">参与 ${counts[p]} 次</div>
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
}

function applyRemote(data) {
  state.people = Array.isArray(data.people) ? data.people : [];
  state.trips = Array.isArray(data.trips) ? data.trips : [];
  render();
}

async function loadFromCloud() {
  setSync("busy", "同步中…");
  const { data, error } = await supabase
    .from("app_state")
    .select("people, trips")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    setSync("err", "加载失败");
    throw error;
  }

  if (!data) {
    state.people = ["黄", "张", "吴", "陈"];
    state.trips = demoTrips.map((t) => ({ ...t, riders: [...t.riders] }));
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
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("app_state").upsert(payload);
  saving = false;

  if (error) {
    setSync("err", "保存失败");
    console.error(error);
    return;
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

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    await loadFromCloud();
    subscribeRealtime();
  } catch (err) {
    console.error(err);
    els.summary.innerHTML = `<div class="empty">无法连接 Supabase，请检查环境变量与 schema.sql 是否已执行。</div>`;
  }
}

function tryLogin() {
  if (!configReady()) {
    els.loginError.textContent =
      "未配置环境变量。请设置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_APP_PASSWORD";
    return;
  }

  const input = els.passwordInput.value.trim();
  if (input !== APP_PASSWORD) {
    els.loginError.textContent = "口令不正确";
    return;
  }

  sessionStorage.setItem(AUTH_KEY, "1");
  els.loginError.textContent = "";
  bootApp();
}

function logout() {
  sessionStorage.removeItem(AUTH_KEY);
  location.reload();
}

function addPerson() {
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
  const date = els.tripDate.value;
  const amount = Number(els.tripAmount.value);
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

  state.trips.push({ id: uid(), date, amount, riders });
  els.tripAmount.value = "";
  // Uncheck all ride checkboxes after adding
  document.querySelectorAll('input[name="rider"]').forEach((el) => (el.checked = false));
  scheduleSave();
}

function loadDemo() {
  if (!confirm("用示例数据覆盖当前云端数据？")) return;
  state.people = ["黄", "张", "吴", "陈"];
  state.trips = demoTrips.map((t) => ({ ...t, id: uid(), riders: [...t.riders] }));
  scheduleSave();
}

els.loginBtn.addEventListener("click", tryLogin);
els.passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryLogin();
});
els.logoutBtn.addEventListener("click", logout);
els.addPersonBtn.addEventListener("click", addPerson);
els.newPerson.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPerson();
});
els.addTripBtn.addEventListener("click", addTrip);
els.loadDemoBtn.addEventListener("click", loadDemo);
els.clearBtn.addEventListener("click", () => {
  if (confirm("确定清空全部行程与成员？此操作会同步到所有人。")) {
    state.people = [];
    state.trips = [];
    scheduleSave();
  }
});

// Remove person: only removes from the people list, does NOT touch existing trips
els.peopleList.addEventListener("click", (e) => {
  const name = e.target.getAttribute("data-remove-person");
  if (!name) return;
  state.people = state.people.filter((p) => p !== name);
  scheduleSave();
});

els.tripsList.addEventListener("click", (e) => {
  const id = e.target.getAttribute("data-remove-trip");
  if (!id) return;
  state.trips = state.trips.filter((t) => t.id !== id);
  scheduleSave();
});

if (!configReady()) {
  showLogin("未配置环境变量。请先按 DEPLOY.md 完成 Supabase 配置。");
} else if (isAuthed()) {
  bootApp();
} else {
  showLogin();
}
