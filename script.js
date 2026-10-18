/* =====================================================================
   AutoStudio — Учет заказов и расписание автостудии
   ===================================================================== */

/* ---------- Константы ---------- */
const LS_ORDERS   = 'autostudio_orders_v1';
const LS_SETTINGS = 'autostudio_settings_v1';

const DEFAULT_SETTINGS = {
  studio: 30, master: 30, owner: 30, reserve: 10,
  theme: 'dark',
};

const MONTHS_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const MONTHS_FULL  = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DAY_NAMES    = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const DAY_FULL     = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];

/* ---------- State ---------- */
let orders = [];
let settings = { ...DEFAULT_SETTINGS };
let editingId = null;
let completingId = null;
let editingMaterials = [];
let archiveSearch = '';
let analyticsPeriod = 'week';
let adminSearch = '';
let adminStatusFilter = 'all';
let weekOffset = 0; // 0 = текущая неделя, -1 = прошлая, +1 = следующая

/* =====================================================================
   Утилиты
   ===================================================================== */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const pad  = n => String(n).padStart(2, '0');
const toISODate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO  = () => toISODate(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* ---------- Валюта (индивидуально на заказ) ---------- */
function money(n, currency) {
  const cur = currency || 'UZS';
  const val = Math.round(Number(n) || 0);
  if (cur === 'USD') return '$' + val.toLocaleString('en-US');
  return val.toLocaleString('ru-RU') + ' сум';
}
function curOf(order) { return order?.currency || 'UZS'; }

/* ---------- Даты ---------- */
function formatDateHuman(iso) {
  if (!iso) return '—';
  const d = parseISO(iso);
  return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`;
}
function formatWeekRange(monday, sunday) {
  const m1 = MONTHS_FULL[monday.getMonth()];
  const m2 = MONTHS_FULL[sunday.getMonth()];
  if (monday.getMonth() === sunday.getMonth() && monday.getFullYear() === sunday.getFullYear()) {
    return `${monday.getDate()} — ${sunday.getDate()} ${m1} ${sunday.getFullYear()}`;
  }
  if (monday.getFullYear() === sunday.getFullYear()) {
    return `${monday.getDate()} ${m1} — ${sunday.getDate()} ${m2} ${sunday.getFullYear()}`;
  }
  return `${monday.getDate()} ${m1} ${monday.getFullYear()} — ${sunday.getDate()} ${m2} ${sunday.getFullYear()}`;
}
function weekDayLabel(iso) {
  const d = parseISO(iso);
  const dayIdx = (d.getDay() + 6) % 7;
  const dayName = DAY_FULL[dayIdx];
  const t = todayISO();
  const tom = toISODate(addDays(new Date(), 1));
  const yes = toISODate(addDays(new Date(), -1));
  if (iso === t)   return `Сегодня, ${dayName}, ${formatDateHuman(iso)}`;
  if (iso === tom) return `Завтра, ${dayName}, ${formatDateHuman(iso)}`;
  if (iso === yes) return `Вчера, ${dayName}, ${formatDateHuman(iso)}`;
  return `${dayName}, ${formatDateHuman(iso)}`;
}
function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- Storage ---------- */
function loadState() {
  try {
    const raw = localStorage.getItem(LS_ORDERS);
    orders = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(orders)) orders = [];
    orders.forEach(o => { if (!o.currency) o.currency = 'UZS'; });
  } catch (e) { orders = []; }

  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    delete settings.currency;
  } catch (e) { settings = { ...DEFAULT_SETTINGS }; }
}
function saveOrders()   { localStorage.setItem(LS_ORDERS, JSON.stringify(orders)); }
function saveSettingsLS() { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }

/* =====================================================================
   Тема
   ===================================================================== */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', settings.theme || 'dark');
  const btn = $('#themeToggle');
  if (btn) {
    btn.textContent = settings.theme === 'light' ? '☀️' : '🌙';
    btn.title = settings.theme === 'light'
      ? 'Сейчас светлая тема — нажмите для тёмной'
      : 'Сейчас тёмная тема — нажмите для светлой';
  }
}
function toggleTheme() {
  settings.theme = (settings.theme === 'light') ? 'dark' : 'light';
  saveSettingsLS();
  applyTheme();
  renderSettings();
}

/* =====================================================================
   Расчёты
   ===================================================================== */
function materialsTotal(order) {
  return (order.materials || []).reduce((a, m) => a + (Number(m.amount) || 0), 0);
}

function calcDistribution(order, s = settings) {
  const mat    = materialsTotal(order);
  const profit = (Number(order.agreedAmount) || 0) - mat;
  return {
    materialsTotal: mat,
    profit,
    studio:  profit * (s.studio  / 100),
    master:  profit * (s.master  / 100),
    owner:   profit * (s.owner   / 100),
    reserve: profit * (s.reserve / 100),
  };
}

function buildReport(order) {
  const cur = curOf(order);
  const d = order.final || calcDistribution(order, order.distribution || settings);
  const balance = (Number(order.agreedAmount) || 0) - (Number(order.prepayment) || 0);
  const lines = [
    `🚗 *АВТОСТУДИЯ — ЗАКАЗ*`,
    `━━━━━━━━━━━━━━━━━━`,
    `🚘 ${order.brand} ${order.model || ''}${order.plate ? ' · ' + order.plate : ''}`.trim(),
    `👤 ${order.clientName || '—'}`,
    `📞 ${order.clientPhone || '—'}`,
    order.workType ? `🔧 ${order.workType}` : null,
    ``,
    `💰 Стоимость: ${money(order.agreedAmount, cur)}`,
    `💸 Предоплата: ${money(order.prepayment, cur)}`,
    `🧾 Материалы: ${money(d.materialsTotal, cur)}`,
    `✅ Остаток к оплате: ${money(balance, cur)}`,
    ``,
    `📊 *Чистая прибыль: ${money(d.profit, cur)}*`,
    `🏢 Студия: ${money(d.studio, cur)}`,
    `👨‍🔧 Мастер: ${money(d.master, cur)}`,
    `👑 Владелец: ${money(d.owner, cur)}`,
    `🛡 Резерв: ${money(d.reserve, cur)}`,
    ``,
    `🕒 ${order.date ? formatDateHuman(order.date) + ' ' + (order.time || '') : ''}`.trim(),
  ].filter(l => l !== null);
  return lines.join('\n');
}

/* =====================================================================
   Toast / Copy
   ===================================================================== */
let toastTimer = null;
function toast(msg) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('📋 Скопировано — вставьте в мессенджер');
  } catch (e) {
    toast('⚠️ Не удалось скопировать');
  }
}

/* =====================================================================
   Рендер: статистика
   ===================================================================== */
function renderStats() {
  const inWork  = orders.filter(o => o.status === 'inwork').length;
  const today   = todayISO();
  const todayCnt = orders.filter(o => o.status !== 'closed' && o.date === today).length;
  const waiting = orders.filter(o => o.status === 'scheduled').length;

  $('#statInWork').textContent  = inWork;
  $('#statToday').textContent   = todayCnt;
  $('#statWaiting').textContent = waiting;
}

/* =====================================================================
   Рендер: расписание недели (с навигацией)
   ===================================================================== */
function renderSchedule() {
  const baseMonday = startOfWeek(new Date());
  const monday = addDays(baseMonday, weekOffset * 7);
  const sunday = addDays(monday, 6);
  const todayStr = todayISO();
  const mondayISO = toISODate(monday);
  const sundayISO = toISODate(sunday);

  /* --- заголовок с диапазоном --- */
  const rangeEl = $('#weekRange');
  if (rangeEl) {
    const prefix =
      weekOffset === 0  ? 'Текущая · ' :
      weekOffset === 1  ? 'Следующая · ' :
      weekOffset === -1 ? 'Прошлая · ' :
      weekOffset < 0    ? `${Math.abs(weekOffset)} нед. назад · ` :
                          `+${weekOffset} нед. · `;
    rangeEl.textContent = prefix + formatWeekRange(monday, sunday);
  }

  /* --- кнопка "Сегодня" видна только при смещении --- */
  const todayBtn = $('#todayWeekBtn');
  if (todayBtn) todayBtn.style.display = weekOffset === 0 ? 'none' : '';

  /* --- лента дней --- */
  const weekHtml = Array.from({ length: 7 }, (_, i) => {
    const d   = addDays(monday, i);
    const iso = toISODate(d);
    const cnt = orders.filter(o => o.date === iso && o.status !== 'closed').length;
    const isToday = iso === todayStr;
    return `
      <div class="day-card ${isToday ? 'today' : ''}">
        <div class="day-name">${DAY_NAMES[i]}</div>
        <div class="day-num">${d.getDate()}</div>
        <div class="day-month">${MONTHS_SHORT[d.getMonth()]}</div>
        <div class="day-count ${cnt ? 'has' : ''}">${cnt ? cnt + ' 🚗' : '—'}</div>
      </div>`;
  }).join('');
  $('#weekStrip').innerHTML = weekHtml;

  /* --- все заказы выбранной недели --- */
  const weekOrders = orders
    .filter(o => o.date >= mondayISO && o.date <= sundayISO)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

  const countEl = $('#weekOrdersCount');
  if (countEl) {
    countEl.textContent = weekOrders.length
      ? `${weekOrders.length} ${plural(weekOrders.length, 'заказ', 'заказа', 'заказов')}`
      : '';
  }

  const list = $('#upcomingList');
  if (!weekOrders.length) {
    list.innerHTML = `
      <div class="empty-state">
        📭 На этой неделе заказов нет.<br>
        Нажмите «+ Записать клиента», чтобы добавить первый.
      </div>`;
    return;
  }

  const groups = {};
  weekOrders.forEach(o => { (groups[o.date] ||= []).push(o); });

  list.innerHTML = Object.keys(groups).sort().map(date => `
    <div class="date-group-label">${weekDayLabel(date)}</div>
    ${groups[date].map(o => renderOrderCard(o)).join('')}
  `).join('');
}

function renderOrderCard(o) {
  const cur = curOf(o);
  let badge = '';
  if (o.status === 'inwork') badge = '<span class="status-badge inwork">В работе</span>';
  else if (o.status === 'closed') badge = '<span class="status-badge closed">Закрыт</span>';

  const showStart = o.status === 'scheduled';

  return `
    <div class="order-card">
      <div class="oc-time">${esc(o.time || '--:--')}</div>
      <div class="oc-body">
        <div class="oc-title">
          ${esc(o.brand)} ${esc(o.model || '')}
          ${o.plate ? `<span class="plate">${esc(o.plate)}</span>` : ''}
          ${badge}
        </div>
        <div class="oc-sub">👤 ${esc(o.clientName)} · 📞 ${esc(o.clientPhone)}</div>
        ${o.workType ? `<div class="oc-work">🔧 ${esc(o.workType)}</div>` : ''}
      </div>
      <div class="oc-right">
        <div class="oc-price">${money(o.agreedAmount, cur)}</div>
        <div class="oc-actions">
          <button class="icon-btn mini" data-action="edit" data-id="${o.id}" title="Редактировать">✏️</button>
          <button class="icon-btn mini" data-action="delete" data-id="${o.id}" title="Удалить">🗑</button>
          ${showStart ? `<button class="btn sm primary" data-action="start-work" data-id="${o.id}">В работу →</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

/* =====================================================================
   Рендер: заказы в работе
   ===================================================================== */
function renderWork() {
  const list = $('#workList');
  const inWork = orders.filter(o => o.status === 'inwork');

  if (!inWork.length) {
    list.innerHTML = `
      <div class="empty-state">
        🛠️ Сейчас нет машин в работе.<br>
        Переведите заказ из «Расписания» кнопкой «В работу →».
      </div>`;
    return;
  }

  list.innerHTML = inWork.map(o => {
    const cur   = curOf(o);
    const mat   = materialsTotal(o);
    const bal   = (Number(o.agreedAmount) || 0) - (Number(o.prepayment) || 0);
    const matsHtml = (o.materials || []).map((m, i) => `
      <div class="mat-item">
        <span>${esc(m.name)}</span>
        <b>${money(m.amount, cur)}</b>
        <button data-action="remove-material" data-id="${o.id}" data-idx="${i}" title="Удалить">✕</button>
      </div>`).join('') || `<div class="muted small">Чеков пока нет</div>`;

    return `
      <div class="work-card">
        <div class="wc-head">
          <div>
            <div class="wc-title">
              ${esc(o.brand)} ${esc(o.model || '')}
              ${o.plate ? `<span class="plate">${esc(o.plate)}</span>` : ''}
            </div>
            <div class="wc-client">👤 ${esc(o.clientName)} · 📞 ${esc(o.clientPhone)}</div>
            ${o.workType ? `<div class="wc-work">🔧 ${esc(o.workType)}</div>` : ''}
          </div>
          <span class="status-badge inwork">В работе · ${cur}</span>
        </div>

        <div class="wc-money">
          <div><span>Сумма</span><b>${money(o.agreedAmount, cur)}</b></div>
          <div><span>Предоплата</span><b>${money(o.prepayment, cur)}</b></div>
          <div><span>Остаток</span><b class="accent">${money(bal, cur)}</b></div>
        </div>

        <div class="materials">
          <div class="mat-head">
            <span>🧾 Затраты на материалы</span>
            <b>${money(mat, cur)}</b>
          </div>
          <div class="mat-list">${matsHtml}</div>
          <div class="mat-add">
            <input class="mat-name" placeholder="Название материала" data-mat-id="${o.id}">
            <input class="mat-amount" type="number" min="0" step="1" placeholder="${cur}" data-mat-id="${o.id}">
            <button data-action="add-material" data-id="${o.id}" title="Добавить">＋</button>
          </div>
        </div>

        <div class="wc-actions">
          <button class="btn ghost" data-action="copy" data-id="${o.id}">📋 Отчет в мессенджер</button>
          <button class="btn ghost" data-action="edit" data-id="${o.id}">✏️ Изменить</button>
          <button class="btn primary" data-action="complete" data-id="${o.id}">✅ Завершить и рассчитать</button>
        </div>
      </div>`;
  }).join('');
}

/* =====================================================================
   Рендер: аналитика
   ===================================================================== */
function getPeriodRange(period) {
  const now = new Date();
  if (period === 'week') {
    const start = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -6);
    return [toISODate(start), toISODate(now)];
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return [toISODate(start), toISODate(now)];
  }
  return [null, null];
}

function renderAnalytics() {
  $$('#periodFilter .pill').forEach(p =>
    p.classList.toggle('active', p.dataset.period === analyticsPeriod)
  );

  const [from, to] = getPeriodRange(analyticsPeriod);
  const closed = orders.filter(o => o.status === 'closed').filter(o => {
    if (!from && !to) return true;
    const cd = (o.closedAt || '').slice(0, 10);
    return cd >= from && cd <= to;
  });

  if (!closed.length) {
    $('#analyticsContent').innerHTML =
      '<div class="empty-state">📊 Нет закрытых заказов за выбранный период</div>';
    return;
  }

  const byCur = { UZS: [], USD: [] };
  closed.forEach(o => { byCur[curOf(o)].push(o); });

  let html = '';
  ['UZS', 'USD'].forEach(cur => {
    if (byCur[cur].length) html += renderCurrencyBlock(cur, byCur[cur]);
  });

  $('#analyticsContent').innerHTML = html;
}

function renderCurrencyBlock(cur, list) {
  let turnover = 0, materials = 0, profit = 0;
  let dStudio = 0, dMaster = 0, dOwner = 0, dReserve = 0;

  list.forEach(o => {
    const f = o.final || calcDistribution(o, o.distribution || settings);
    turnover  += Number(o.agreedAmount) || 0;
    materials += f.materialsTotal;
    profit    += f.profit;
    dStudio   += f.studio;
    dMaster   += f.master;
    dOwner    += f.owner;
    dReserve  += f.reserve;
  });

  const avgCheck = list.length ? turnover / list.length : 0;
  const label = cur === 'USD' ? '💵 В долларах (USD)' : '💰 В сумах (UZS)';

  return `
    <div class="currency-section">
      <div class="currency-head">${label} · ${list.length} зак.</div>
      <div class="kpi-grid">
        <div class="kpi k-turnover">
          <div class="kpi-label">Общий оборот</div>
          <div class="kpi-value">${money(turnover, cur)}</div>
          <div class="kpi-sub">${list.length} закрытых заказов</div>
        </div>
        <div class="kpi k-mat">
          <div class="kpi-label">Затраты на материалы</div>
          <div class="kpi-value">${money(materials, cur)}</div>
          <div class="kpi-sub">Средний чек: ${money(avgCheck, cur)}</div>
        </div>
        <div class="kpi k-profit">
          <div class="kpi-label">Чистая прибыль</div>
          <div class="kpi-value">${money(profit, cur)}</div>
          <div class="kpi-sub">После вычета материалов</div>
        </div>
      </div>

      <div class="dist-title">Распределение прибыли</div>
      <div class="dist-grid">
        <div class="dist-item d-studio">
          <span>🏢 Студия</span><b>${money(dStudio, cur)}</b><i>${settings.studio}%</i>
        </div>
        <div class="dist-item d-master">
          <span>👨‍🔧 Мастер</span><b>${money(dMaster, cur)}</b><i>${settings.master}%</i>
        </div>
        <div class="dist-item d-owner">
          <span>👑 Владелец</span><b>${money(dOwner, cur)}</b><i>${settings.owner}%</i>
        </div>
        <div class="dist-item d-reserve">
          <span>🛡 Резерв</span><b>${money(dReserve, cur)}</b><i>${settings.reserve}%</i>
        </div>
      </div>
    </div>
  `;
}

/* =====================================================================
   Рендер: архив
   ===================================================================== */
function renderArchive() {
  const closed = orders
    .filter(o => o.status === 'closed')
    .sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));

  const q = archiveSearch.trim().toLowerCase();
  const filtered = !q ? closed : closed.filter(o =>
    [o.brand, o.model, o.plate, o.clientPhone, o.clientName, o.workType]
      .some(v => (v || '').toLowerCase().includes(q))
  );

  $('#archiveCount').textContent = `${filtered.length} из ${closed.length}`;
  const list = $('#archiveList');

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">${closed.length ? '🔍 Ничего не найдено' : '🗂️ Архив пуст'}</div>`;
    return;
  }

  list.innerHTML = filtered.map(o => {
    const cur = curOf(o);
    const f = o.final || calcDistribution(o, o.distribution || settings);
    return `
      <div class="archive-card">
        <div class="ac-main">
          <div class="ac-title">
            ${esc(o.brand)} ${esc(o.model || '')}
            ${o.plate ? `<span class="plate">${esc(o.plate)}</span>` : ''}
            <span class="status-badge closed">Закрыт</span>
          </div>
          <div class="ac-sub">👤 ${esc(o.clientName)} · 📞 ${esc(o.clientPhone)}</div>
          <div class="ac-date">📅 Закрыт: ${formatDateTime(o.closedAt)}</div>
        </div>
        <div class="ac-money">
          <b>${money(f.profit, cur)}</b>
          <span>чистая прибыль</span>
        </div>
        <button class="icon-btn" data-action="copy" data-id="${o.id}" title="Скопировать отчёт">📋</button>
      </div>`;
  }).join('');
}

/* =====================================================================
   Рендер: админ-панель
   ===================================================================== */
const STATUS_LABELS = {
  scheduled: 'Запланирован',
  inwork: 'В работе',
  closed: 'Закрыт',
};

function renderAdmin() {
  let list = orders.slice();

  if (adminStatusFilter !== 'all') {
    list = list.filter(o => o.status === adminStatusFilter);
  }

  const q = adminSearch.trim().toLowerCase();
  if (q) {
    list = list.filter(o =>
      [o.brand, o.model, o.plate, o.clientName, o.clientPhone, o.workType]
        .some(v => (v || '').toLowerCase().includes(q))
    );
  }

  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  $('#adminCount').textContent = `${list.length} из ${orders.length}`;
  const container = $('#adminList');

  if (!list.length) {
    container.innerHTML = '<div class="empty-state">Нет заказов по заданным фильтрам</div>';
    return;
  }

  container.innerHTML = list.map(o => {
    const cur = curOf(o);
    return `
      <div class="admin-card">
        <div class="ac-main">
          <div class="ac-title">
            ${esc(o.brand)} ${esc(o.model || '')}
            ${o.plate ? `<span class="plate">${esc(o.plate)}</span>` : ''}
            <span class="status-badge ${o.status}">${STATUS_LABELS[o.status] || o.status}</span>
          </div>
          <div class="ac-sub">👤 ${esc(o.clientName)} · 📞 ${esc(o.clientPhone)}</div>
          ${o.workType ? `<div class="ac-sub">🔧 ${esc(o.workType)}</div>` : ''}
          <div class="ac-date">
            📅 ${o.date ? formatDateHuman(o.date) : '—'} ${o.time || ''}
            ${o.materials && o.materials.length ? ` · 🧾 ${o.materials.length} чек(ов)` : ''}
          </div>
        </div>
        <div class="ac-money">
          <b>${money(o.agreedAmount, cur)}</b>
          <span>${cur}</span>
        </div>
        <div class="ac-actions">
          <button class="icon-btn" data-action="admin-edit" data-id="${o.id}" title="Редактировать">✏️</button>
          <button class="icon-btn" data-action="admin-delete" data-id="${o.id}" title="Удалить">🗑</button>
        </div>
      </div>
    `;
  }).join('');
}

/* =====================================================================
   Рендер: настройки
   ===================================================================== */
function renderSettings() {
  $('#sStudio').value  = settings.studio;
  $('#sMaster').value  = settings.master;
  $('#sOwner').value   = settings.owner;
  $('#sReserve').value = settings.reserve;
  updateSumIndicator();

  $$('#themeSelect button').forEach(b =>
    b.classList.toggle('active', b.dataset.themeVal === (settings.theme || 'dark'))
  );

  applyTheme();
}

function updateSumIndicator() {
  const sum =
    (Number($('#sStudio').value)  || 0) +
    (Number($('#sMaster').value)  || 0) +
    (Number($('#sOwner').value)   || 0) +
    (Number($('#sReserve').value) || 0);
  const el = $('#sumIndicator');
  el.textContent = `Сумма: ${sum}%`;
  el.classList.toggle('ok',  sum === 100);
  el.classList.toggle('bad', sum !== 100);
}

/* =====================================================================
   Общий рендер
   ===================================================================== */
function renderAll() {
  renderStats();
  renderSchedule();
  renderWork();
  renderAnalytics();
  renderArchive();
  renderAdmin();
}

/* =====================================================================
   Modal — новый/редактировать заказ
   ===================================================================== */
function openOrderModal(id = null) {
  editingId = id;
  const overlay = $('#modalOverlay');
  const form = $('#orderForm');
  form.reset();
  editingMaterials = [];

  if (id) {
    const o = orders.find(x => x.id === id);
    if (!o) return;
    $('#modalTitle').textContent = 'Редактировать заказ';
    form.clientName.value   = o.clientName || '';
    form.clientPhone.value  = o.clientPhone || '';
    form.brand.value        = o.brand || '';
    form.model.value        = o.model || '';
    form.plate.value        = o.plate || '';
    form.currency.value     = o.currency || 'UZS';
    form.agreedAmount.value = o.agreedAmount || 0;
    form.prepayment.value   = o.prepayment || 0;
    form.date.value         = o.date || todayISO();
    form.time.value         = o.time || '10:00';
    form.workType.value     = o.workType || '';
    form.status.value       = o.status || 'scheduled';
    editingMaterials = JSON.parse(JSON.stringify(o.materials || []));
    $('#adminFields').hidden = false;
  } else {
    $('#modalTitle').textContent = 'Новый заказ';
    const now = new Date();
    form.date.value = todayISO();
    form.time.value = `${pad(now.getHours())}:${pad(Math.round(now.getMinutes() / 5) * 5 % 60)}`;
    form.currency.value = (orders[orders.length - 1]?.currency) || 'UZS';
    $('#adminFields').hidden = true;
  }

  renderModalMaterials();
  overlay.classList.add('open');
  setTimeout(() => form.clientName.focus(), 60);
}
function closeOrderModal() {
  $('#modalOverlay').classList.remove('open');
  editingId = null;
  editingMaterials = [];
}

/* ---------- материалы внутри модалки ---------- */
function renderModalMaterials() {
  const form = $('#orderForm');
  const cur = form.currency?.value || 'UZS';
  const total = editingMaterials.reduce((a, m) => a + (Number(m.amount) || 0), 0);
  const totalEl = $('#mmTotal');
  if (totalEl) totalEl.textContent = money(total, cur);

  const listEl = $('#mmList');
  if (!listEl) return;

  if (!editingMaterials.length) {
    listEl.innerHTML = '<div class="muted small">Материалов нет</div>';
    return;
  }

  listEl.innerHTML = editingMaterials.map((m, i) => `
    <div class="mat-item">
      <span>${esc(m.name)}</span>
      <b>${money(m.amount, cur)}</b>
      <button type="button" data-action="remove-modal-material" data-idx="${i}">✕</button>
    </div>
  `).join('');
}

function addModalMaterial() {
  const nameEl = $('.mat-name-modal');
  const amountEl = $('.mat-amount-modal');
  const name = nameEl.value.trim();
  const amount = Number(amountEl.value) || 0;
  if (!name || !(amount > 0)) { toast('⚠️ Укажите название и сумму'); return; }
  editingMaterials.push({ name, amount });
  nameEl.value = '';
  amountEl.value = '';
  renderModalMaterials();
  nameEl.focus();
}

function removeModalMaterial(idx) {
  editingMaterials.splice(idx, 1);
  renderModalMaterials();
}

/* =====================================================================
   Modal — завершение заказа
   ===================================================================== */
function openCompleteModal(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  completingId = id;

  const cur = curOf(o);
  const d = calcDistribution(o, settings);
  const balance = (Number(o.agreedAmount) || 0) - (Number(o.prepayment) || 0);

  $('#completeBody').innerHTML = `
    <div class="complete-summary">
      <div class="cs-title">${esc(o.brand)} ${esc(o.model || '')} · ${esc(o.plate || '—')}</div>
      <div class="cs-row"><span>Стоимость заказа</span><b>${money(o.agreedAmount, cur)}</b></div>
      <div class="cs-row"><span>Предоплата</span><b>${money(o.prepayment, cur)}</b></div>
      <div class="cs-row"><span>Остаток к оплате</span><b class="accent">${money(balance, cur)}</b></div>
      <div class="cs-row"><span>Затраты на материалы</span><b class="mat-cost">−${money(d.materialsTotal, cur)}</b></div>
      <div class="cs-row total"><span>Чистая прибыль</span><b>${money(d.profit, cur)}</b></div>
    </div>

    <div class="dist-title">Распределение (${cur})</div>
    <div class="dist-grid">
      <div class="dist-item d-studio"><span>🏢 Студия</span><b>${money(d.studio, cur)}</b><i>${settings.studio}%</i></div>
      <div class="dist-item d-master"><span>👨‍🔧 Мастер</span><b>${money(d.master, cur)}</b><i>${settings.master}%</i></div>
      <div class="dist-item d-owner"><span>👑 Владелец</span><b>${money(d.owner, cur)}</b><i>${settings.owner}%</i></div>
      <div class="dist-item d-reserve"><span>🛡 Резерв</span><b>${money(d.reserve, cur)}</b><i>${settings.reserve}%</i></div>
    </div>

    <div class="modal-actions">
      <button class="btn ghost" data-action="close-complete">Отмена</button>
      <button class="btn primary" data-action="confirm-complete" data-id="${o.id}">✅ Подтвердить и в архив</button>
    </div>
  `;
  $('#completeOverlay').classList.add('open');
}
function closeCompleteModal() {
  $('#completeOverlay').classList.remove('open');
  completingId = null;
}

/* =====================================================================
   Действия
   ===================================================================== */
function addMaterial(id, name, amount) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  if (!name || !(amount > 0)) { toast('⚠️ Укажите название и сумму'); return; }
  o.materials = o.materials || [];
  o.materials.push({ name, amount: Number(amount) });
  saveOrders();
  renderWork();
  renderStats();
}

function removeMaterial(id, idx) {
  const o = orders.find(x => x.id === id);
  if (!o || !o.materials) return;
  o.materials.splice(idx, 1);
  saveOrders();
  renderWork();
}

function startWork(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  o.status = 'inwork';
  saveOrders();
  renderAll();
  switchTab('work');
  toast('🚗 Заказ переведён в работу');
}

function confirmComplete(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const d = calcDistribution(o, settings);
  o.status = 'closed';
  o.closedAt = new Date().toISOString();
  o.distribution = { ...settings };
  o.final = d;
  saveOrders();
  closeCompleteModal();
  renderAll();
  toast('✅ Заказ завершён и добавлен в архив');
}

function deleteOrder(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  if (!confirm(`Удалить заказ ${o.brand} ${o.model || ''}?`)) return;
  orders = orders.filter(x => x.id !== id);
  saveOrders();
  renderAll();
  toast('🗑 Заказ удалён');
}

function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  if (name === 'analytics') renderAnalytics();
  if (name === 'archive')   renderArchive();
  if (name === 'admin')     renderAdmin();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =====================================================================
   Экспорт / Импорт / Очистка
   ===================================================================== */
function exportData() {
  const payload = { orders, settings, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `autostudio-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('⬇️ Резервная копия сохранена');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || !Array.isArray(data.orders)) throw new Error('bad format');
      if (!confirm(`Импортировать ${data.orders.length} заказов? Текущие данные будут заменены.`)) return;
      orders = data.orders;
      orders.forEach(o => { if (!o.currency) o.currency = 'UZS'; });
      if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
      saveOrders();
      saveSettingsLS();
      applyTheme();
      renderAll();
      renderSettings();
      toast('⬆️ Данные успешно импортированы');
    } catch (err) {
      toast('⚠️ Файл повреждён или неверного формата');
    }
  };
  reader.readAsText(file);
}

function clearDatabase() {
  if (!orders.length) { toast('База уже пуста'); return; }
  if (!confirm('Удалить ВСЕ заказы (включая архив)?\nНастройки сохранятся.')) return;
  if (!confirm('Точно удалить? Отменить это действие будет невозможно.')) return;
  orders = [];
  saveOrders();
  renderAll();
  toast('🗑 База заказов очищена');
}

/* =====================================================================
   События
   ===================================================================== */
function bindEvents() {

  /* --- Табы --- */
  $('#tabs').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) switchTab(tab.dataset.tab);
  });

  /* --- Кнопка темы --- */
  $('#themeToggle').addEventListener('click', toggleTheme);

  /* --- Сегментированный переключатель темы --- */
  $('#themeSelect').addEventListener('click', e => {
    const b = e.target.closest('button[data-theme-val]');
    if (!b) return;
    if (settings.theme === b.dataset.themeVal) return;
    settings.theme = b.dataset.themeVal;
    saveSettingsLS();
    applyTheme();
    renderSettings();
  });

  /* --- Делегирование кликов --- */
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, idx } = btn.dataset;

    switch (action) {
      case 'new-order':          openOrderModal(); break;
      case 'edit':               openOrderModal(id); break;
      case 'admin-edit':         openOrderModal(id); break;
      case 'delete':             deleteOrder(id); break;
      case 'admin-delete':       deleteOrder(id); break;
      case 'start-work':         startWork(id); break;
      case 'prev-week':          weekOffset--; renderSchedule(); break;
      case 'next-week':          weekOffset++; renderSchedule(); break;
      case 'today-week':         weekOffset = 0; renderSchedule(); break;
      case 'add-material': {
        const card = btn.closest('.work-card');
        const name = card.querySelector('.mat-name').value.trim();
        const amount = Number(card.querySelector('.mat-amount').value) || 0;
        addMaterial(id, name, amount);
        break;
      }
      case 'remove-material':    removeMaterial(id, Number(idx)); break;
      case 'add-modal-material': addModalMaterial(); break;
      case 'remove-modal-material': removeModalMaterial(Number(idx)); break;
      case 'complete':           openCompleteModal(id); break;
      case 'confirm-complete':   confirmComplete(id); break;
      case 'close-complete':     closeCompleteModal(); break;
      case 'copy': {
        const o = orders.find(x => x.id === id);
        if (o) copyText(buildReport(o));
        break;
      }
      case 'close-modal':        closeOrderModal(); break;
      case 'save-settings':      saveSettingsFromForm(); break;
      case 'export':             exportData(); break;
      case 'import':             $('#importFile').click(); break;
      case 'clear-db':           clearDatabase(); break;
    }
  });

  /* --- Переключение периода в аналитике --- */
  $('#periodFilter').addEventListener('click', e => {
    const p = e.target.closest('.pill');
    if (!p) return;
    analyticsPeriod = p.dataset.period;
    renderAnalytics();
  });

  /* --- Изменение валюты в модалке → обновить материалы --- */
  $('#orderForm').currency.addEventListener('change', renderModalMaterials);

  /* --- Сохранение заказа из формы --- */
  $('#orderForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const data = {
      clientName:   f.clientName.value.trim(),
      clientPhone:  f.clientPhone.value.trim(),
      brand:        f.brand.value.trim(),
      model:        f.model.value.trim(),
      plate:        f.plate.value.trim().toUpperCase(),
      currency:     f.currency.value || 'UZS',
      agreedAmount: Number(f.agreedAmount.value) || 0,
      prepayment:   Number(f.prepayment.value) || 0,
      date:         f.date.value,
      time:         f.time.value,
      workType:     f.workType.value.trim(),
    };

    if (editingId) {
      const o = orders.find(x => x.id === editingId);
      if (o) {
        Object.assign(o, data);
        o.materials = [...editingMaterials];
        const prevStatus = o.status;
        o.status = f.status.value || 'scheduled';

        if (o.status === 'closed') {
          o.closedAt = o.closedAt || new Date().toISOString();
          if (!o.distribution) o.distribution = { ...settings };
          o.final = calcDistribution(o, o.distribution);
        } else {
          o.closedAt = null;
          delete o.final;
        }
        if (prevStatus === 'closed' && o.status === 'closed') {
          o.final = calcDistribution(o, o.distribution || settings);
        }
      }
    } else {
      orders.push({
        id: uid(),
        ...data,
        status: 'scheduled',
        materials: [],
        createdAt: new Date().toISOString(),
        closedAt: null,
      });
    }

    /* Переходим на неделю сохранённого заказа, чтобы он был виден */
    if (data.date) {
      const baseMonday = startOfWeek(new Date());
      const orderMonday = startOfWeek(parseISO(data.date));
      const weeksDiff = Math.round((orderMonday - baseMonday) / (7 * 24 * 60 * 60 * 1000));
      weekOffset = weeksDiff;
    }

    saveOrders();
    closeOrderModal();
    renderAll();
    toast('✅ Заказ сохранён');
  });

  /* --- Клик по оверлеям — закрыть --- */
  $('#modalOverlay').addEventListener('click', e => {
    if (e.target.id === 'modalOverlay') closeOrderModal();
  });
  $('#completeOverlay').addEventListener('click', e => {
    if (e.target.id === 'completeOverlay') closeCompleteModal();
  });

  /* --- Enter в поле материала (в карточке "в работе") --- */
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.mat-name, .mat-amount')) {
      e.preventDefault();
      const card = e.target.closest('.work-card');
      if (!card) return;
      const btn = card.querySelector('[data-action="add-material"]');
      if (btn) btn.click();
    }
    if (e.key === 'Enter' && e.target.matches('.mat-name-modal, .mat-amount-modal')) {
      e.preventDefault();
      addModalMaterial();
    }
    if (e.key === 'Escape') {
      closeOrderModal();
      closeCompleteModal();
    }
  });

  /* --- Поиск в архиве --- */
  $('#archiveSearch').addEventListener('input', e => {
    archiveSearch = e.target.value;
    renderArchive();
  });

  /* --- Админ: поиск и фильтр --- */
  $('#adminSearch').addEventListener('input', e => {
    adminSearch = e.target.value;
    renderAdmin();
  });
  $('#adminStatusFilter').addEventListener('change', e => {
    adminStatusFilter = e.target.value;
    renderAdmin();
  });

  /* --- Настройки: живой подсчёт суммы --- */
  ['sStudio', 'sMaster', 'sOwner', 'sReserve'].forEach(id => {
    $('#' + id).addEventListener('input', updateSumIndicator);
  });

  /* --- Импорт файла --- */
  $('#importFile').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });
}

function saveSettingsFromForm() {
  const s = {
    ...settings,
    studio:  Number($('#sStudio').value)  || 0,
    master:  Number($('#sMaster').value)  || 0,
    owner:   Number($('#sOwner').value)   || 0,
    reserve: Number($('#sReserve').value) || 0,
  };
  const sum = s.studio + s.master + s.owner + s.reserve;
  if (sum !== 100) {
    toast('⚠️ Сумма процентов должна быть ровно 100%');
    return;
  }
  settings = s;
  saveSettingsLS();
  renderAll();
  toast('💾 Проценты сохранены');
}

/* =====================================================================
   Init
   ===================================================================== */
function init() {
  loadState();
  applyTheme();
  bindEvents();
  renderAll();
  renderSettings();
}

document.addEventListener('DOMContentLoaded', init);