import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";



// ─── Локальный storage (только для онбординга) ────────────────────────────────
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ─── Finance helpers ──────────────────────────────────────────────────────────
const fmt = (n, currency = "RUB") =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

function calcBalances(members, expenses) {
  const bal = {};
  members.forEach(m => (bal[m.id] = 0));
  expenses.forEach(exp => {
    if (!exp.splitWith?.length) return;
    const perHead = exp.amount / exp.splitWith.length;
    exp.splitWith.forEach(mid => { if (mid !== exp.paidBy) bal[mid] = (bal[mid] || 0) - perHead; });
    const payerShare = exp.splitWith.includes(exp.paidBy) ? perHead : 0;
    bal[exp.paidBy] = (bal[exp.paidBy] || 0) + exp.amount - payerShare;
  });
  return bal;
}

function calcDebts(members, expenses) {
  const bal = calcBalances(members, expenses);
  const debts = [];
  const debtors = Object.entries(bal).filter(([, v]) => v < -0.01).map(([id, v]) => [id, -v]).sort((a, b) => b[1] - a[1]);
  const creditors = Object.entries(bal).filter(([, v]) => v > 0.01).map(([id, v]) => [id, v]).sort((a, b) => b[1] - a[1]);
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const t = Math.min(debtors[di][1], creditors[ci][1]);
    if (t > 0.5) debts.push({ from: debtors[di][0], to: creditors[ci][0], amount: Math.round(t) });
    debtors[di][1] -= t; creditors[ci][1] -= t;
    if (debtors[di][1] < 0.01) di++;
    if (creditors[ci][1] < 0.01) ci++;
  }
  return debts;
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const paths = {
  back: "M19 12H5M12 5l-7 7 7 7",
  plus: "M12 5v14M5 12h14",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  check: "M20 6L9 17l-5-5",
  close: "M18 6L6 18M6 6l12 12",
  home: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  users: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  profile: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  bell: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0",
  receipt: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h4",
  arrow: "M7 17L17 7M7 7h10v10",
  split: "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  chevron: "M9 18l6-6-6-6",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
};
const Ico = ({ n, s = 20, c = "currentColor" }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[n]} />
  </svg>
);

// ─── Avatar ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  ["#1a1a2e", "#e94560"], ["#0f3460", "#16213e"], ["#1b262c", "#0f3460"],
  ["#2d132c", "#ee4540"], ["#1a1a2e", "#533483"],
];
function Avatar({ name, size = 36, index = 0 }) {
  const [, fg] = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.3,
      background: `linear-gradient(135deg, ${fg}44, ${fg}22)`,
      border: `1px solid ${fg}44`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: fg, fontFamily: "'Syne', sans-serif", fontWeight: 700,
      fontSize: size * 0.38, flexShrink: 0, letterSpacing: "-0.02em",
    }}>
      {name?.[0]?.toUpperCase() || "?"}
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Geist+Mono:wght@300;400&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #080810;
  --bg2: #0e0e1a;
  --surface: #111120;
  --surface2: #181828;
  --surface3: #1f1f32;
  --border: rgba(255,255,255,0.07);
  --border2: rgba(255,255,255,0.12);
  --white: #f0f0f8;
  --muted: rgba(240,240,248,0.35);
  --muted2: rgba(240,240,248,0.55);
  --blue: #4f6ef7;
  --blue2: #6b87ff;
  --green: #00d4aa;
  --red: #ff4d6a;
  --yellow: #f5c842;
  --r: 14px;
  --r2: 20px;
}
html, body, #root { height: 100%; background: var(--bg); }
body { font-family: 'Syne', sans-serif; color: var(--white); -webkit-font-smoothing: antialiased; overscroll-behavior: none; }
button { font-family: 'Syne', sans-serif; cursor: pointer; }
input, select, textarea { font-family: 'Syne', sans-serif; }

.app { max-width: 430px; margin: 0 auto; min-height: 100dvh; display: flex; flex-direction: column; position: relative; overflow: hidden; background: var(--bg); }

/* noise overlay */
.app::after { content: ''; position: fixed; inset: 0; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E"); pointer-events: none; z-index: 0; max-width: 430px; }

.page { flex: 1; overflow-y: auto; padding: 0 16px 96px; position: relative; z-index: 1; }
.page::-webkit-scrollbar { display: none; }

/* ── Typography ── */
.display { font-size: 32px; font-weight: 800; letter-spacing: -0.04em; line-height: 1.05; }
.title { font-size: 18px; font-weight: 700; letter-spacing: -0.03em; }
.label { font-size: 11px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.mono { font-family: 'Geist Mono', monospace; }

/* ── Header ── */
.header { padding: 16px 16px 8px; display: flex; align-items: center; gap: 12px; position: relative; z-index: 2; }
.btn-icon { width: 38px; height: 38px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--white); display: flex; align-items: center; justify-content: center; transition: all 0.15s; flex-shrink: 0; }
.btn-icon:hover { background: var(--surface2); border-color: var(--border2); }

/* ── Bottom Nav ── */
.nav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 430px; background: rgba(8,8,16,0.92); backdrop-filter: blur(24px); border-top: 1px solid var(--border); display: flex; padding: 10px 0 24px; z-index: 50; }
.nav-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px; background: none; border: none; color: var(--muted); font-size: 10px; font-weight: 500; letter-spacing: 0.04em; transition: color 0.15s; }
.nav-btn.on { color: var(--blue2); }
.nav-pip { width: 4px; height: 4px; border-radius: 2px; background: var(--blue); margin-top: 1px; }

/* ── Cards ── */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r2); padding: 16px; margin-bottom: 8px; transition: all 0.15s; position: relative; overflow: hidden; }
.card-tap { cursor: pointer; }
.card-tap:hover { background: var(--surface2); border-color: var(--border2); transform: translateY(-1px); }
.card-tap:active { transform: scale(0.99); }
.card::before { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(79,110,247,0.04) 0%, transparent 60%); pointer-events: none; }

/* ── Buttons ── */
.btn { width: 100%; padding: 15px; border-radius: var(--r); border: none; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.15s; }
.btn-primary { background: var(--blue); color: #fff; }
.btn-primary:hover { background: var(--blue2); box-shadow: 0 8px 32px rgba(79,110,247,0.35); transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.35; transform: none; box-shadow: none; cursor: not-allowed; }
.btn-ghost { background: var(--surface2); color: var(--white); border: 1px solid var(--border); }
.btn-ghost:hover { border-color: var(--border2); background: var(--surface3); }
.btn-danger { background: rgba(255,77,106,0.12); color: var(--red); border: 1px solid rgba(255,77,106,0.2); }

/* ── Inputs ── */
.input-wrap { margin-bottom: 12px; }
.input-label { font-size: 11px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; display: block; }
.input { width: 100%; padding: 13px 14px; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--r); color: var(--white); font-size: 15px; font-weight: 500; outline: none; transition: border-color 0.15s; }
.input:focus { border-color: var(--blue); }
.input::placeholder { color: var(--muted); }
select.input { appearance: none; cursor: pointer; }
.input-amount { font-family: 'Geist Mono', monospace; font-size: 24px; font-weight: 400; text-align: center; padding: 16px; }

/* ── Chips ── */
.chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 100px; font-size: 11px; font-weight: 500; letter-spacing: 0.02em; border: 1px solid; }
.chip-blue { background: rgba(79,110,247,0.12); border-color: rgba(79,110,247,0.25); color: var(--blue2); }
.chip-green { background: rgba(0,212,170,0.1); border-color: rgba(0,212,170,0.25); color: var(--green); }
.chip-red { background: rgba(255,77,106,0.1); border-color: rgba(255,77,106,0.25); color: var(--red); }
.chip-muted { background: var(--surface2); border-color: var(--border); color: var(--muted2); }

/* ── Member chip toggle ── */
.m-chip { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface2); cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.12s; }
.m-chip.sel { background: rgba(79,110,247,0.15); border-color: rgba(79,110,247,0.4); color: var(--blue2); }

/* ── Divider ── */
.divider { height: 1px; background: var(--border); margin: 16px 0; }

/* ── Section label ── */
.section { font-size: 11px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 20px 0 10px; }

/* ── Empty state ── */
.empty { text-align: center; padding: 56px 24px; }
.empty-ico { font-size: 44px; margin-bottom: 16px; opacity: 0.6; }
.empty-title { font-size: 17px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 8px; }
.empty-sub { font-size: 14px; color: var(--muted2); line-height: 1.5; }

/* ── Modal ── */
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); display: flex; align-items: flex-end; z-index: 100; animation: oIn 0.15s ease; }
.sheet { background: var(--surface); border: 1px solid var(--border); border-radius: 28px 28px 0 0; padding: 20px 16px 40px; width: 100%; max-width: 430px; margin: 0 auto; animation: sUp 0.22s cubic-bezier(0.34,1.56,0.64,1); max-height: 88dvh; overflow-y: auto; }
.sheet::-webkit-scrollbar { display: none; }
.sheet-handle { width: 36px; height: 4px; border-radius: 2px; background: var(--border2); margin: 0 auto 20px; }
.sheet-title { font-size: 18px; font-weight: 700; letter-spacing: -0.03em; margin-bottom: 20px; }
@keyframes oIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes sUp { from { transform: translateY(40px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }

/* ── Onboarding ── */
.onboard { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 24px; text-align: center; position: relative; }
.onboard-glow { position: absolute; top: 20%; left: 50%; transform: translateX(-50%); width: 280px; height: 280px; background: radial-gradient(ellipse, rgba(79,110,247,0.15), transparent 70%); pointer-events: none; }
.onboard-logo { width: 72px; height: 72px; border-radius: 22px; background: linear-gradient(135deg, var(--blue), #8b5cf6); display: flex; align-items: center; justify-content: center; margin: 0 auto 32px; font-size: 32px; box-shadow: 0 16px 48px rgba(79,110,247,0.4); }

/* ── Hero card ── */
.hero-card { background: linear-gradient(135deg, #151528 0%, #0e0e1e 100%); border: 1px solid rgba(79,110,247,0.15); border-radius: 24px; padding: 24px; margin-bottom: 8px; position: relative; overflow: hidden; }
.hero-card::before { content: ''; position: absolute; top: -40%; right: -20%; width: 200px; height: 200px; background: radial-gradient(ellipse, rgba(79,110,247,0.12), transparent 70%); pointer-events: none; }
.hero-card::after { content: ''; position: absolute; bottom: -30%; left: -10%; width: 150px; height: 150px; background: radial-gradient(ellipse, rgba(0,212,170,0.06), transparent 70%); pointer-events: none; }

/* ── Debt row ── */
.debt-row { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px 16px; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; }

/* ── Expense row ── */
.exp-row { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px 16px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; cursor: default; transition: all 0.12s; }
.exp-row:hover { background: var(--surface2); }

/* ── Tabs ── */
.tabs { display: flex; gap: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 4px; margin-bottom: 16px; }
.tab { flex: 1; padding: 8px; border-radius: 10px; border: none; background: transparent; color: var(--muted2); font-size: 13px; font-weight: 600; transition: all 0.15s; letter-spacing: -0.01em; }
.tab.on { background: var(--surface3); color: var(--white); }

/* ── Stats grid ── */
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px; }
.stat-val { font-size: 18px; font-weight: 700; letter-spacing: -0.03em; font-family: 'Geist Mono', monospace; margin-top: 4px; }

/* ── Category emoji picker ── */
.cat-grid { display: flex; gap: 6px; flex-wrap: wrap; }
.cat-btn { width: 40px; height: 40px; border-radius: 11px; border: 1px solid var(--border); background: var(--surface2); font-size: 20px; cursor: pointer; transition: all 0.12s; display: flex; align-items: center; justify-content: center; }
.cat-btn.sel { border-color: var(--blue); background: rgba(79,110,247,0.15); }

/* ── Profile ── */
.profile-header { padding: 24px 16px 16px; text-align: center; }
.profile-avatar { width: 80px; height: 80px; border-radius: 24px; background: linear-gradient(135deg, var(--blue), #8b5cf6); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; font-size: 32px; font-weight: 800; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--border); }
.toggle { width: 44px; height: 24px; border-radius: 12px; border: none; cursor: pointer; position: relative; transition: background 0.2s; }
.toggle.on { background: var(--blue); }
.toggle.off { background: var(--surface3); }
.toggle-dot { position: absolute; top: 2px; width: 20px; height: 20px; border-radius: 10px; background: #fff; transition: left 0.2s; }
.toggle.on .toggle-dot { left: 22px; }
.toggle.off .toggle-dot { left: 2px; }

/* ── Success Modal ── */
.success-modal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 200; animation: oIn 0.15s ease; }
.success-modal-box { background: var(--surface2); border: 1px solid var(--border2); border-radius: 20px; padding: 32px 40px; text-align: center; animation: scaleIn 0.2s cubic-bezier(0.34,1.56,0.64,1); }
.success-check { width: 56px; height: 56px; border-radius: 18px; background: rgba(0,212,170,0.15); border: 1px solid rgba(0,212,170,0.3); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; font-size: 26px; }
@keyframes scaleIn { from { transform: scale(0.85); opacity: 0 } to { transform: scale(1); opacity: 1 } }

/* ── Animations ── */
@keyframes fadeUp { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
.fade-up { animation: fadeUp 0.25s ease forwards; }
`;

const CATS = ["💳","🍕","✈️","🏠","🎉","🛒","🚗","🎮","☕","💊","🍺","🎵"];

// ─── Supabase helpers ─────────────────────────────────────────────────────────
async function dbLoadGroups(userId) {
  const { data: memberships } = await supabase
    .from("group_members").select("group_id").eq("user_id", userId);
  if (!memberships?.length) return [];
  const groupIds = memberships.map(m => m.group_id);
  const { data: groups } = await supabase
    .from("groups").select("*").in("id", groupIds).order("created_at", { ascending: false });
  if (!groups?.length) return [];
  const result = await Promise.all(groups.map(async g => {
    const { data: members } = await supabase
      .from("group_members").select("user_id, users(id, name, tg_id)")
      .eq("group_id", g.id);
    const { data: expenses } = await supabase
      .from("expenses").select("*").eq("group_id", g.id).order("created_at", { ascending: false });
    return {
      ...g,
      members: (members || []).map(m => ({ id: m.users.id, name: m.users.name, tgId: m.users.tg_id })),
      expenses: (expenses || []).map(e => ({
        ...e, paidBy: e.paid_by, splitWith: e.split_with, amount: Number(e.amount)
      })),
    };
  }));
  return result;
}

async function dbGetOrCreateUser(tgUser) {
  const { data: existing } = await supabase
    .from("users").select("*").eq("tg_id", tgUser.id).single();
  if (existing) return existing;
  const { data: created } = await supabase.from("users").insert({
    tg_id: tgUser.id, name: tgUser.first_name + (tgUser.last_name ? " " + tgUser.last_name : ""),
    username: tgUser.username || null,
  }).select().single();
  return created;
}

// ─── App Shell ────────────────────────────────────────────────────────────────
export default function App() {
  const [onboarded, setOnboarded] = useState(() => lsGet("sr_onboarded", false));
  const [groups, setGroups] = useState([]);
  const [tab, setTab] = useState("home");
  const [activeGroup, setActiveGroup] = useState(null);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [joinSuccess, setJoinSuccess] = useState(false);

  // Инициализация — получаем пользователя из Telegram или создаём тестового
  useEffect(() => {
    const init = async () => {
      let tgUser;
      if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
        tgUser = window.Telegram.WebApp.initDataUnsafe.user;
        window.Telegram.WebApp.expand();
      } else {
        tgUser = { id: 999999999, first_name: "Тест", last_name: "Пользователь", username: "testuser" };
      }
      const dbUser = await dbGetOrCreateUser(tgUser);
      setUser(dbUser);

      // Проверяем invite-ссылку — ?startapp=invite_XXXXXXXX
      const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param
        || new URLSearchParams(window.location.search).get("startapp");
      if (startParam?.startsWith("invite_")) {
        const inviteCode = startParam.replace("invite_", "");
        const { data: group } = await supabase
          .from("groups").select("id").eq("invite_code", inviteCode).single();
        if (group) {
          // Проверяем лимит 20 участников
          const { count } = await supabase.from("group_members")
            .select("id", { count: "exact" }).eq("group_id", group.id);
          if (count >= 20) {
            // группа заполнена — просто показываем её
          } else {
            const { data: already } = await supabase.from("group_members")
              .select("id").eq("group_id", group.id).eq("user_id", dbUser.id).single();
            if (!already) {
              await supabase.from("group_members")
                .insert({ group_id: group.id, user_id: dbUser.id });
              // Показываем подтверждение — устанавливаем флаг
              window.__joinedGroupId = group.id;
            }
          }
        }
      }

      const loaded = await dbLoadGroups(dbUser.id);
      setGroups(loaded);
      setLoading(false);
      if (window.__joinedGroupId) {
        setJoinSuccess(true);
        delete window.__joinedGroupId;
      }
    };
    init();
  }, []);

  const reloadGroups = useCallback(async () => {
    if (!user) return;
    const loaded = await dbLoadGroups(user.id);
    setGroups(loaded);
  }, [user]);

  const createGroup = async (data) => {
    const { data: g } = await supabase.from("groups")
      .insert({ name: data.name, emoji: data.emoji, created_by: user.id }).select().single();
    await supabase.from("group_members").insert({ group_id: g.id, user_id: user.id });
    await reloadGroups();
    setModal(null);
  };

  const addMember = async (gid, name, tgId = null) => {
    let dbUser;
    // Если есть tgId — ищем существующего пользователя
    if (tgId) {
      const { data: existing } = await supabase
        .from("users").select("*").eq("tg_id", tgId).single();
      if (existing) {
        dbUser = existing;
      }
    }
    // Если не нашли — создаём нового
    if (!dbUser) {
      const { data: created } = await supabase.from("users")
        .insert({ tg_id: tgId || Date.now(), name }).select().single();
      dbUser = created;
    }
    // Проверяем не добавлен ли уже в группу
    const { data: existing } = await supabase.from("group_members")
      .select("id").eq("group_id", gid).eq("user_id", dbUser.id).single();
    if (!existing) {
      await supabase.from("group_members").insert({ group_id: gid, user_id: dbUser.id });
    }
    await reloadGroups();
    setModal(null);
  };

  const addExpense = async (gid, exp) => {
    await supabase.from("expenses").insert({
      group_id: gid, title: exp.title, amount: exp.amount,
      category: exp.category, paid_by: exp.paidBy, split_with: exp.splitWith,
    });
    await reloadGroups();
    setModal(null);
  };

  const delExpense = async (gid, eid) => {
    await supabase.from("expenses").delete().eq("id", eid);
    await reloadGroups();
  };

  const delGroup = async (gid) => {
    await supabase.from("groups").delete().eq("id", gid);
    setActiveGroup(null);
    await reloadGroups();
  };

  if (!onboarded) return (
    <><style>{CSS}</style>
      <Onboard onDone={() => { lsSet("sr_onboarded", true); setOnboarded(true); }} />
    </>
  );

  if (loading) return (
    <div className="app" style={{ alignItems: "center", justifyContent: "center" }}>
      <style>{CSS}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>💸</div>
        <div style={{ color: "var(--muted2)", fontSize: 14 }}>Загрузка...</div>
      </div>
    </div>
  );

  const group = groups.find(g => g.id === activeGroup);
  if (activeGroup && group) {
    return (
      <div className="app">
        <style>{CSS}</style>
        <GroupScreen group={group} onBack={() => { setActiveGroup(null); reloadGroups(); }}
          onAddMember={(n, tgId) => addMember(group.id, n, tgId)}
          onAddExpense={e => addExpense(group.id, e)}
          onDelExpense={id => delExpense(group.id, id)}
          onDelGroup={() => delGroup(group.id)}
          currentUserId={user?.id} />
      </div>
    );
  }

  const allDebts = groups.flatMap(g => calcDebts(g.members, g.expenses).map(d => ({ ...d, group: g })));
  const totalSpent = groups.reduce((s, g) => s + g.expenses.reduce((ss, e) => ss + e.amount, 0), 0);

  return (
    <div className="app">
      <style>{CSS}</style>

      {tab === "home" && (
        <>
          <div className="header">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 2 }}>Добро пожаловать</div>
              <div className="title">{user?.name || "..."}</div>
            </div>
            <button className="btn-icon" onClick={() => setTab("profile")}><Ico n="settings" s={18} /></button>
          </div>
          <div className="page">
            <div className="hero-card fade-up">
              <div className="label" style={{ marginBottom: 8 }}>Общие расходы</div>
              <div className="display mono">{fmt(totalSpent)}</div>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <span className="chip chip-blue">{groups.length} групп</span>
                {allDebts.length > 0 && <span className="chip chip-red">{allDebts.length} долгов</span>}
                {allDebts.length === 0 && groups.length > 0 && <span className="chip chip-green">Все чисто ✓</span>}
              </div>
            </div>

            {allDebts.length > 0 && (
              <>
                <div className="section">Долги</div>
                {allDebts.slice(0, 3).map((d, i) => {
                  const fm = d.group.members.find(m => m.id === d.from);
                  const tm = d.group.members.find(m => m.id === d.to);
                  return (
                    <div key={i} className="debt-row fade-up" style={{ animationDelay: `${i * 0.05}s` }}>
                      <Avatar name={fm?.name} size={36} index={i} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>{fm?.name} → {tm?.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 1 }}>{d.group.name}</div>
                      </div>
                      <div style={{ fontFamily: "'Geist Mono'", fontSize: 15, fontWeight: 400, color: "var(--red)" }}>{fmt(d.amount)}</div>
                    </div>
                  );
                })}
              </>
            )}

            <div className="section">Группы</div>
            {groups.length === 0 && (
              <div className="empty">
                <div className="empty-ico">🫂</div>
                <div className="empty-title">Нет групп</div>
                <div className="empty-sub">Создай группу, добавь участников и начни делить расходы</div>
              </div>
            )}
            {groups.map((g, i) => {
              const debts = calcDebts(g.members, g.expenses);
              const spent = g.expenses.reduce((s, e) => s + e.amount, 0);
              return (
                <div key={g.id} className="card card-tap fade-up" style={{ animationDelay: `${i * 0.06}s` }} onClick={() => setActiveGroup(g.id)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ fontSize: 32, lineHeight: 1 }}>{g.emoji}</div>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>{g.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 2 }}>{g.members.length} участников · {g.expenses.length} трат</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "'Geist Mono'", fontSize: 16, fontWeight: 400, letterSpacing: "-0.02em" }}>{fmt(spent)}</div>
                      {debts.length > 0
                        ? <span className="chip chip-red" style={{ marginTop: 4 }}>{debts.length} долг</span>
                        : spent > 0 ? <span className="chip chip-green" style={{ marginTop: 4 }}>Чисто</span> : null}
                    </div>
                  </div>
                </div>
              );
            })}

            <div style={{ height: 8 }} />
            <button className="btn btn-primary" onClick={() => setModal("newGroup")}>
              <Ico n="plus" s={18} /> Новая группа
            </button>
          </div>
        </>
      )}

      {tab === "profile" && (
        <ProfileScreen user={user} onBack={() => setTab("home")} />
      )}

      <nav className="nav">
        {[{ id: "home", icon: "home", label: "Главная" }, { id: "profile", icon: "profile", label: "Профиль" }].map(n => (
          <button key={n.id} className={`nav-btn ${tab === n.id ? "on" : ""}`} onClick={() => setTab(n.id)}>
            <Ico n={n.icon} s={22} />
            <span>{n.label}</span>
            {tab === n.id && <div className="nav-pip" />}
          </button>
        ))}
      </nav>

      {modal === "newGroup" && <NewGroupModal onClose={() => setModal(null)} onCreate={createGroup} />}
      {joinSuccess && <SuccessModal text="Вы добавлены в группу!" onClose={() => setJoinSuccess(false)} />}
    </div>
  );
}
// ─── Onboarding ───────────────────────────────────────────────────────────────
function Onboard({ onDone }) {
  const [step, setStep] = useState(0);
  const steps = [
    { ico: "💸", title: "Делите расходы честно", sub: "Поездки, ужины, аренда — всё в одном месте" },
    { ico: "⚡", title: "Мгновенный подсчёт долгов", sub: "Автоматически считаем кто кому и сколько должен" },
    { ico: "🔔", title: "Уведомления в Telegram", sub: "Напомним о долгах прямо в чате" },
  ];
  const s = steps[step];
  return (
    <div className="app">
      <div className="onboard">
        <div className="onboard-glow" />
        <div className="onboard-logo">{s.ico}</div>
        <div className="display" style={{ marginBottom: 16, maxWidth: 280 }}>{s.title}</div>
        <div style={{ fontSize: 16, color: "var(--muted2)", lineHeight: 1.6, maxWidth: 260, marginBottom: 48 }}>{s.sub}</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 32 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ height: 4, borderRadius: 2, background: i === step ? "var(--blue)" : "var(--surface3)", width: i === step ? 24 : 12, transition: "all 0.2s" }} />
          ))}
        </div>
        <button className="btn btn-primary" style={{ maxWidth: 300 }} onClick={() => step < steps.length - 1 ? setStep(step + 1) : onDone()}>
          {step < steps.length - 1 ? "Далее" : "Начать"}
        </button>
      </div>
    </div>
  );
}

// ─── Group Screen ─────────────────────────────────────────────────────────────
function GroupScreen({ group, onBack, onAddMember, onAddExpense, onDelExpense, onDelGroup, currentUserId }) {
  const [tab, setTab] = useState("expenses");
  const [modal, setModal] = useState(null);
  const debts = calcDebts(group.members, group.expenses);
  const bal = calcBalances(group.members, group.expenses);
  const spent = group.expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <>
      <div className="header">
        <button className="btn-icon" onClick={onBack}><Ico n="back" /></button>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>{group.emoji}</span>
            <div className="title">{group.name}</div>
          </div>
        </div>
        <button className="btn-icon" onClick={() => setModal("addMember")}><Ico n="users" s={17} /></button>
      </div>

      <div className="page">
        {/* Stats */}
        <div className="stats">
          <div className="stat-card">
            <div className="label">Потрачено</div>
            <div className="stat-val" style={{ color: "var(--yellow)" }}>{fmt(spent)}</div>
          </div>
          <div className="stat-card">
            <div className="label">Долги</div>
            <div className="stat-val" style={{ color: debts.length ? "var(--red)" : "var(--green)" }}>
              {debts.length ? `${debts.length} шт` : "Чисто ✓"}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs">
          {["expenses", "debts", "members"].map(t => (
            <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
              {{ expenses: "Траты", debts: "Долги", members: "Участники" }[t]}
            </button>
          ))}
        </div>

        {/* ── Expenses ── */}
        {tab === "expenses" && (
          <>
            {group.expenses.length === 0 && (
              <div className="empty"><div className="empty-ico">🧾</div><div className="empty-title">Нет трат</div><div className="empty-sub">Добавь первую трату группы</div></div>
            )}
            {group.expenses.map((exp, i) => {
              const payer = group.members.find(m => m.id === exp.paidBy);
              return (
                <div key={exp.id} className="exp-row fade-up" style={{ animationDelay: `${i * 0.04}s` }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--surface3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                    {exp.category || "💳"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{exp.title}</div>
                    <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 2 }}>
                      {payer?.name} · {exp.splitWith?.length} чел
                    </div>
                  </div>
                  <div style={{ textAlign: "right", marginRight: 8 }}>
                    <div style={{ fontFamily: "'Geist Mono'", fontSize: 15, fontWeight: 400 }}>{fmt(exp.amount)}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>по {fmt(exp.amount / (exp.splitWith?.length || 1))}</div>
                  </div>
                  {currentUserId === exp.paidBy && (
                    <button style={{ background: "none", border: "none", color: "var(--muted)", padding: 4, borderRadius: 8, transition: "color 0.12s" }}
                      onMouseEnter={e => e.target.style.color = "var(--red)"}
                      onMouseLeave={e => e.target.style.color = "var(--muted)"}
                      onClick={() => onDelExpense(exp.id)}>
                      <Ico n="trash" s={16} />
                    </button>
                  )}
                </div>
              );
            })}
            <div style={{ height: 8 }} />
            <button className="btn btn-primary" disabled={group.members.length < 2} onClick={() => setModal("addExpense")}>
              <Ico n="plus" s={18} /> Добавить трату
            </button>
            {group.members.length < 2 && (
              <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", marginTop: 10 }}>Сначала добавь минимум 2 участников</div>
            )}
          </>
        )}

        {/* ── Debts ── */}
        {tab === "debts" && (
          <>
            {debts.length === 0 ? (
              <div className="empty"><div className="empty-ico">🎉</div><div className="empty-title">Все рассчитались!</div><div className="empty-sub">Долгов нет</div></div>
            ) : (
              debts.map((d, i) => {
                const fm = group.members.find(m => m.id === d.from);
                const tm = group.members.find(m => m.id === d.to);
                return (
                  <div key={i} className="debt-row fade-up" style={{ animationDelay: `${i * 0.05}s` }}>
                    <Avatar name={fm?.name} size={38} index={i} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>{fm?.name}</div>
                      <div style={{ fontSize: 12, color: "var(--muted2)" }}>должен</div>
                    </div>
                    <div style={{ textAlign: "center", padding: "0 8px" }}>
                      <div style={{ fontFamily: "'Geist Mono'", fontSize: 16, fontWeight: 400, color: "var(--red)" }}>{fmt(d.amount)}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>→</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>{tm?.name}</div>
                      <div style={{ fontSize: 12, color: "var(--green)" }}>получает</div>
                    </div>
                    <Avatar name={tm?.name} size={38} index={i + 3} />
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ── Members ── */}
        {tab === "members" && (
          <>
            {group.members.length === 0 && (
              <div className="empty"><div className="empty-ico">👥</div><div className="empty-title">Нет участников</div><div className="empty-sub">Добавь людей в группу</div></div>
            )}
            {group.members.map((m, i) => {
              const b = bal[m.id] || 0;
              const paid = group.expenses.filter(e => e.paidBy === m.id).reduce((s, e) => s + e.amount, 0);
              return (
                <div key={m.id} className="card fade-up" style={{ cursor: "default", animationDelay: `${i * 0.05}s` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Avatar name={m.name} size={44} index={i} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 2 }}>Заплатил: {fmt(paid)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "'Geist Mono'", fontSize: 16, fontWeight: 400, color: b >= 0 ? "var(--green)" : "var(--red)" }}>
                        {b >= 0 ? "+" : ""}{fmt(b)}
                      </div>
                      <span className={`chip ${b >= 0 ? "chip-green" : "chip-red"}`} style={{ fontSize: 10, marginTop: 4 }}>
                        {b >= 0 ? "в плюсе" : "в минусе"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            <div style={{ height: 8 }} />
            <button className="btn btn-ghost" onClick={() => setModal("addMember")}>
              <Ico n="plus" s={18} /> Добавить участника
            </button>
            <div style={{ height: 12 }} />
            <button className="btn btn-danger" onClick={() => { if (window.confirm("Удалить группу?")) onDelGroup(); }}>
              <Ico n="trash" s={18} /> Удалить группу
            </button>
          </>
        )}
      </div>

      {modal === "addMember" && <AddMemberModal onClose={() => setModal(null)} onAdd={onAddMember} inviteLink={`https://t.me/SplitReciept_bot/sharereciept_personal_use?startapp=invite_${group.invite_code}`} memberCount={group.members.length} />}
      {modal === "addExpense" && <AddExpenseModal group={group} onClose={() => setModal(null)} onAdd={onAddExpense} />}
    </>
  );
}

// ─── Profile Screen ───────────────────────────────────────────────────────────
function ProfileScreen({ user, onBack }) {
  const [notifs, setNotifs] = useState(true);
  return (
    <>
      <div className="header">
        <button className="btn-icon" onClick={onBack}><Ico n="back" /></button>
        <div className="title" style={{ flex: 1 }}>Профиль</div>
      </div>
      <div className="page">
        <div style={{ textAlign: "center", padding: "24px 0 32px" }}>
          <div className="profile-avatar">
            {user?.name?.[0] || "В"}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em" }}>{user?.name}</div>
          <div style={{ fontSize: 14, color: "var(--muted2)", marginTop: 4 }}>Telegram аккаунт</div>
        </div>

        <div className="section">Настройки</div>
        <div className="card" style={{ cursor: "default" }}>
          <div className="setting-row">
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Уведомления о долгах</div>
              <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 2 }}>Telegram-сообщения</div>
            </div>
            <button className={`toggle ${notifs ? "on" : "off"}`} onClick={() => setNotifs(!notifs)}>
              <div className="toggle-dot" />
            </button>
          </div>
          <div className="setting-row" style={{ borderBottom: "none" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Валюта</div>
              <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 2 }}>Российский рубль</div>
            </div>
            <span className="chip chip-muted">₽ RUB</span>
          </div>
        </div>

        <div className="section">О приложении</div>
        <div className="card" style={{ cursor: "default" }}>
          {[["Версия", "1.0.0"], ["Разработчик", "ShareReciept Team"], ["Поддержка", "@sharereciept_support"]].map(([k, v]) => (
            <div key={k} className="setting-row" style={{ borderBottom: k === "Поддержка" ? "none" : undefined }}>
              <span style={{ fontSize: 15, fontWeight: 500, color: "var(--muted2)" }}>{k}</span>
              <span style={{ fontSize: 14, fontFamily: "'Geist Mono'" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────
const EMOJIS = ["💰", "✈️", "🏠", "🎉", "🛒", "🚗", "🎮", "🏖️", "🍕", "💊"];

function NewGroupModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("💰");
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">Новая группа</div>
        <div className="input-wrap">
          <label className="input-label">Название</label>
          <input className="input" placeholder="Например: Поездка в Сочи" value={name} onChange={e => setName(e.target.value)} autoFocus />
        </div>
        <div className="input-wrap">
          <label className="input-label">Иконка</label>
          <div className="cat-grid">
            {EMOJIS.map(e => <button key={e} className={`cat-btn ${emoji === e ? "sel" : ""}`} onClick={() => setEmoji(e)}>{e}</button>)}
          </div>
        </div>
        <div style={{ height: 12 }} />
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => name.trim() && onCreate({ name: name.trim(), emoji })}>
          <Ico n="check" s={18} /> Создать группу
        </button>
      </div>
    </div>
  );
}

function SuccessModal({ text, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 2000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="success-modal" onClick={onClose}>
      <div className="success-modal-box">
        <div className="success-check">✓</div>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>{text}</div>
      </div>
    </div>
  );
}

function AddMemberModal({ onClose, onAdd, inviteLink, memberCount }) {
  const [name, setName] = useState("");
  const [success, setSuccess] = useState(false);
  const MAX_MEMBERS = 20;
  const isFull = memberCount >= MAX_MEMBERS;

  const handleAdd = () => {
    if (!name.trim() || isFull) return;
    onAdd(name.trim(), null);
    setName("");
    setSuccess(true);
  };

  const handleShare = () => {
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent("Присоединяйся к нашей группе расходов в ShareReciept!")}`
      );
    } else {
      navigator.clipboard.writeText(inviteLink);
      alert("Ссылка скопирована!");
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">Добавить участника</div>

        {/* Поделиться ссылкой */}
        <button
          className="btn"
          onClick={handleShare}
          style={{
            background: "linear-gradient(135deg, #229ED9, #1a8bbf)",
            color: "#fff", marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 18 }}>🔗</span> Поделиться группой
        </button>
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", marginBottom: 16 }}>
          Друг перейдёт по ссылке и автоматически войдёт в группу
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 10, margin: "4px 0 16px",
          color: "var(--muted)", fontSize: 12,
        }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          или добавь вручную
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        {/* Лимит участников */}
        {isFull && (
          <div style={{ background: "rgba(255,77,106,0.1)", border: "1px solid rgba(255,77,106,0.25)", borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "var(--red)", textAlign: "center" }}>
            Максимум 20 участников в группе
          </div>
        )}

        {/* Ручной ввод */}
        <div className="input-wrap">
          <label className="input-label">Имя участника</label>
          <input
            className="input"
            placeholder="Алексей"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            disabled={isFull}
          />
        </div>
        <div style={{ height: 8 }} />
        <button
          className="btn btn-primary"
          disabled={!name.trim() || isFull}
          onClick={handleAdd}
        >
          <Ico n="check" s={18} /> Добавить
        </button>

        {success && <SuccessModal text="Участник добавлен" onClose={() => { setSuccess(false); onClose(); }} />}
      </div>
    </div>
  );
}

function AddExpenseModal({ group, onClose, onAdd }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(group.members[0]?.id || "");
  const [splitWith, setSplitWith] = useState(group.members.map(m => m.id));
  const [cat, setCat] = useState("💳");
  const [success, setSuccess] = useState(false);

  const toggle = id => setSplitWith(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const perHead = splitWith.length > 0 && amount ? fmt(parseFloat(amount) / splitWith.length) : null;

  const handleAdd = () => {
    if (!title.trim() || !amount || splitWith.length === 0) return;
    onAdd({ title: title.trim(), amount: parseFloat(amount), paidBy, splitWith, category: cat });
    setSuccess(true);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">Новая трата</div>

        {/* Amount big input */}
        <div className="input-wrap">
          <label className="input-label">Сумма (₽)</label>
          <input className="input input-amount" type="number" inputMode="decimal" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>

        <div className="input-wrap">
          <label className="input-label">Описание</label>
          <input className="input" placeholder="Ужин в ресторане..." value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        <div className="input-wrap">
          <label className="input-label">Категория</label>
          <div className="cat-grid">{CATS.map(c => <button key={c} className={`cat-btn ${cat === c ? "sel" : ""}`} onClick={() => setCat(c)}>{c}</button>)}</div>
        </div>

        <div className="input-wrap">
          <label className="input-label">Кто заплатил</label>
          <select className="input" value={paidBy} onChange={e => setPaidBy(e.target.value)}>
            {group.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div className="input-wrap">
          <label className="input-label">Делим между</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            {group.members.map(m => (
              <div key={m.id} className={`m-chip ${splitWith.includes(m.id) ? "sel" : ""}`} onClick={() => toggle(m.id)}>
                <Avatar name={m.name} size={24} />
                {m.name}
              </div>
            ))}
          </div>
        </div>

        {perHead && (
          <div style={{ background: "var(--surface3)", borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "var(--muted2)", display: "flex", justifyContent: "space-between" }}>
            <span>С каждого</span>
            <span style={{ fontFamily: "'Geist Mono'", color: "var(--white)" }}>{perHead}</span>
          </div>
        )}

        <div style={{ height: 8 }} />
        <button className="btn btn-primary"
          disabled={!title.trim() || !amount || splitWith.length === 0}
          onClick={handleAdd}>
          <Ico n="check" s={18} /> Добавить трату
        </button>
        {success && <SuccessModal text="Трата добавлена!" onClose={() => { setSuccess(false); onClose(); }} />}
      </div>
    </div>
  );
}
