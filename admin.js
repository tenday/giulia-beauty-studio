/**
 * GIULIA BEAUTY STUDIO — ADMIN AGENDA & CRM LOGIC
 */

const API_BASE = 'api';

const STATE = {
  admin: null,
  activeView: 'agenda',
  calMode: 'week', // 'week' | 'day' | 'list'
  anchorDate: new Date(),
  statusFilter: '',
  operatorFilter: 0,
  appointments: [],
  tomorrowAppointments: [],
  clients: [],
  operators: [],
  absences: [],
  suppliers: [],
  products: [],
  movements: [],
  messageTemplates: [],
  messageLogs: [],
  adminUsers: [],
  privacyVersion: 'v2.0-2026-11',
  insights: null,
  geminiEnabled: false,
  inactiveDaysFilter: 30,
  clientPickerMode: 'existing', // 'existing' | 'new'
  selectedCatalogIds: new Set(),
  currentDossierClient: null,
  morphoManager: null,
};

const DAYS_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const MONTHS_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

const STATUS_LABELS = {
  pending: 'In Attesa',
  confirmed: 'Confermato',
  completed: 'Completato',
  cancelled: 'Annullato',
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toIsoDate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toIsoDate(d);
}

function formatShortItDate(isoStr) {
  if (!isoStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return isoStr || '';
  const [, m, d] = isoStr.split('-').map(Number);
  return `${d} ${MONTHS_IT[m - 1].slice(0, 3)}`;
}

function getDaysUntilBirthday(birthDateIso) {
  if (!birthDateIso || !/^\d{4}-\d{2}-\d{2}$/.test(String(birthDateIso))) return null;
  const [, bm, bd] = String(birthDateIso).split('-').map(Number);
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let nextBday = new Date(now.getFullYear(), bm - 1, bd);
  if (nextBday < todayMidnight) {
    nextBday = new Date(now.getFullYear() + 1, bm - 1, bd);
  }
  return Math.round((nextBday - todayMidnight) / (1000 * 60 * 60 * 24));
}

function formatWaNumber(phone) {
  const clean = String(phone || '').replace(/[^\d]/g, '');
  if (!clean) return '';
  return clean.startsWith('39') ? clean : `39${clean}`;
}

function renderMessageTemplate(code, vars = {}) {
  const found = (STATE.messageTemplates || []).find((t) => t.code === code);
  const fallbacks = {
    reminder_tomorrow:
      'Ciao {nome} ♡ Ti ricordiamo il tuo appuntamento da *Giulia Beauty Studio* (Via Principe Amedeo 17, Verdellino) per domani *{data}* alle *{ora}* con {operatore} ({trattamenti}). A domani!',
    birthday_wishes:
      'Tanti Auguri di Buon Compleanno {nome} ♡🎂 Da *Giulia Beauty Studio* ti auguriamo una giornata splendida! Ti aspettiamo presto in studio!',
    winback_inactive:
      'Ciao {nome} ♡ È da un po\' ({giorni_assenza} giorni) che non ci vediamo da *Giulia Beauty Studio*! Quando hai voglia di concederti una coccola o un ritocco, scrivimi pure qui.',
    privacy_sign:
      'Ciao {nome} ♡ Completa la firma Privacy GDPR dal telefono qui: {link}\nCodice OTP: *{otp}*',
  };
  let text = found?.body_template || fallbacks[code] || '';
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
  }
  return text;
}

function buildTomorrowReminderUrl(appt) {
  const waNum = formatWaNumber(appt.client_phone);
  const dateLabel = formatShortItDate(appt.appointment_date);
  const msg = renderMessageTemplate('reminder_tomorrow', {
    nome: appt.client_name,
    data: dateLabel,
    ora: appt.start_time,
    trattamenti: appt.services_summary,
    operatore: appt.operator_name || 'Giulia',
  });
  return `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
}

function buildBirthdayWishUrl(client) {
  const waNum = formatWaNumber(client.phone);
  const msg = renderMessageTemplate('birthday_wishes', { nome: client.full_name });
  return `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
}

function parseIsoDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getMondayOfWeek(dt) {
  const copy = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

async function apiFetch(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}/${endpoint}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await res.json().catch(() => ({ ok: false, error: 'Risposta non valida dal server.' }));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `Errore HTTP ${res.status}`);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ==========================================================================
   AUTHENTICATION & INITIALIZATION
   ========================================================================== */
async function checkAuth() {
  const loginForm = document.getElementById('loginForm');
  const workspace = document.getElementById('adminWorkspace');
  const checkingGate = document.getElementById('authCheckingOverlay');

  let authData;
  try {
    authData = await apiFetch('auth/me', { method: 'GET' });
  } catch (err) {
    if (workspace) {
      window.location.replace('admin.html');
      return;
    }
    const alertEl = document.getElementById('loginAlert');
    if (alertEl) {
      alertEl.hidden = false;
      alertEl.textContent = err.message;
    }
    return;
  }

  if (!authData.authenticated) {
    if (workspace) {
      window.location.replace('admin.html');
    }
    return;
  }

  if (loginForm && !workspace) {
    window.location.replace('agenda.html');
    return;
  }

  STATE.admin = authData.admin;
  const welcomeEl = document.getElementById('adminWelcomeLabel');
  if (welcomeEl) {
    welcomeEl.textContent = `Ciao ${authData.admin.display_name || 'Giulia'} • Agenda & Database Clienti`;
  }
  if (checkingGate) checkingGate.hidden = true;
  if (workspace) workspace.hidden = false;

  try {
    await refreshAllData();
  } catch (err) {
    console.error('[Giulia Beauty Studio] Errore caricamento dati gestionale:', err);
    if (err.status === 401 && workspace) {
      window.location.replace('admin.html');
    }
  }
}

async function refreshAllData() {
  await Promise.all([
    loadClients(),
    loadOperators(),
    loadAppointments(),
    loadTomorrowReminders(),
    loadInventoryData(),
    loadMessagesData(),
    loadAdminUsers(),
    loadInsights(),
  ]);
  updateKpis();
  renderSmartAssistBar();
  renderCalendar();
  renderClientsTable();
  renderInventoryView();
  renderMessagesView();
  renderInsightsView();
  renderSettingsView();
}

async function loadOperators() {
  const data = await apiFetch('admin/operators', { method: 'GET' });
  STATE.operators = data.operators || [];
  STATE.absences = data.absences || [];
  populateOperatorDropdowns();
}

function populateOperatorDropdowns() {
  const calSel = document.getElementById('calOperatorFilter');
  const apptSel = document.getElementById('apptOperatorSelect');
  const absSel = document.getElementById('absOperatorSelect');
  if (calSel) {
    calSel.innerHTML = `<option value="0">Tutti gli operatori</option>${STATE.operators
      .map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`)
      .join('')}`;
    calSel.value = String(STATE.operatorFilter || 0);
  }
  const activeOps = STATE.operators.filter((o) => Number(o.active) !== 0);
  const opsList = activeOps.length > 0 ? activeOps : STATE.operators;
  if (apptSel) {
    apptSel.innerHTML = opsList
      .map((o) => `<option value="${o.id}">${escapeHtml(o.name)} (${escapeHtml(o.role || 'Staff')})</option>`)
      .join('');
  }
  if (absSel) {
    absSel.innerHTML = STATE.operators
      .map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`)
      .join('');
  }
}

async function loadInventoryData() {
  const data = await apiFetch('admin/inventory', { method: 'GET' });
  STATE.suppliers = data.suppliers || [];
  STATE.products = data.products || [];
  STATE.movements = data.movements || [];
}

async function loadMessagesData() {
  const data = await apiFetch('admin/messages', { method: 'GET' });
  STATE.messageTemplates = data.templates || [];
  STATE.messageLogs = data.logs || [];
}

async function loadAdminUsers() {
  const data = await apiFetch('admin/users', { method: 'GET' });
  STATE.adminUsers = data.users || [];
}

async function loadInsights() {
  const days = Number(STATE.inactiveDaysFilter || 30);
  const data = await apiFetch(`admin/insights?days=${days}`, { method: 'GET' });
  STATE.insights = data.insights || null;
  STATE.geminiEnabled = Boolean(data.gemini_enabled);
  if (data.privacy_version) STATE.privacyVersion = data.privacy_version;
}

async function loadTomorrowReminders() {
  const tomorrow = getTomorrowIso();
  const data = await apiFetch(`admin/appointments?start_date=${tomorrow}&end_date=${tomorrow}`, { method: 'GET' });
  STATE.tomorrowAppointments = (data.appointments || []).filter((a) => a.status !== 'cancelled');
}

async function loadClients(query = '') {
  const qParam = query ? `?q=${encodeURIComponent(query)}` : '';
  const data = await apiFetch(`admin/clients${qParam}`, { method: 'GET' });
  STATE.clients = data.clients || [];
  populateClientSelect();
}

async function loadAppointments() {
  const params = new URLSearchParams();
  if (STATE.calMode === 'week') {
    const mon = getMondayOfWeek(STATE.anchorDate);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    params.set('start_date', toIsoDate(mon));
    params.set('end_date', toIsoDate(sun));
  } else if (STATE.calMode === 'day') {
    const iso = toIsoDate(STATE.anchorDate);
    params.set('start_date', iso);
    params.set('end_date', iso);
  }
  if (STATE.statusFilter) {
    params.set('status', STATE.statusFilter);
  }
  if (STATE.operatorFilter > 0) {
    params.set('operator_id', String(STATE.operatorFilter));
  }

  const data = await apiFetch(`admin/appointments?${params.toString()}`, { method: 'GET' });
  STATE.appointments = data.appointments || [];
}

function updateKpis() {
  const todayStr = toIsoDate(new Date());
  const todayCount = STATE.appointments.filter(
    (a) => a.appointment_date === todayStr && a.status !== 'cancelled'
  ).length;
  const weekActive = STATE.appointments.filter((a) => a.status !== 'cancelled').length;
  const pendingCount = STATE.appointments.filter((a) => a.status === 'pending').length;

  document.getElementById('kpiTodayCount').textContent = todayCount;
  document.getElementById('kpiWeekCount').textContent = weekActive;
  document.getElementById('kpiPendingCount').textContent = pendingCount;
  document.getElementById('kpiClientsCount').textContent = STATE.clients.length;

  const unsentCount = STATE.tomorrowAppointments.filter((a) => !a.reminder_sent_at).length;
  const badgeEl = document.getElementById('tomorrowRemindersBadge');
  if (badgeEl) {
    badgeEl.textContent = unsentCount > 0 ? `${unsentCount}` : `${STATE.tomorrowAppointments.length}`;
  }
}

function renderSmartAssistBar() {
  const bar = document.getElementById('smartAssistBar');
  if (!bar) return;

  const cards = [];

  if (STATE.tomorrowAppointments.length > 0) {
    const unsent = STATE.tomorrowAppointments.filter((a) => !a.reminder_sent_at).length;
    const summaryText = unsent > 0
      ? `${STATE.tomorrowAppointments.length} appuntamenti domani • ${unsent} promemoria da inviare`
      : `Tutti i ${STATE.tomorrowAppointments.length} promemoria di domani già inviati ✓`;
    cards.push(`
      <div class="assist-card">
        <div>
          <span class="assist-card-title">📲 Promemoria per Domani (${escapeHtml(formatShortItDate(getTomorrowIso()))})</span>
          <span class="assist-card-sub">${escapeHtml(summaryText)}</span>
        </div>
        <div class="assist-actions">
          <button type="button" class="btn-outline-sm" id="assistOpenRemindersBtn">Invia WhatsApp</button>
        </div>
      </div>
    `);
  }

  const upcomingBirthdays = STATE.clients
    .map((c) => ({ client: c, days: getDaysUntilBirthday(c.birth_date) }))
    .filter((item) => item.days !== null && item.days <= 14)
    .sort((a, b) => a.days - b.days);

  if (upcomingBirthdays.length > 0) {
    const first = upcomingBirthdays[0];
    const whenLabel = first.days === 0 ? 'Oggi!' : first.days === 1 ? 'Domani' : `tra ${first.days} gg (${formatShortItDate(first.client.birth_date)})`;
    const extraCount = upcomingBirthdays.length > 1 ? ` (+${upcomingBirthdays.length - 1})` : '';
    cards.push(`
      <div class="assist-card assist-card-birthday">
        <div>
          <span class="assist-card-title">🎂 Compleanni in Arrivo${extraCount}</span>
          <span class="assist-card-sub"><strong>${escapeHtml(first.client.full_name)}</strong> — ${escapeHtml(whenLabel)}</span>
        </div>
        <div class="assist-actions">
          <a href="${buildBirthdayWishUrl(first.client)}" target="_blank" rel="noopener" class="btn-outline-sm">🎂 Auguri WhatsApp</a>
        </div>
      </div>
    `);
  }

  if (cards.length === 0) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }

  bar.innerHTML = cards.join('');
  bar.hidden = false;

  const btn = document.getElementById('assistOpenRemindersBtn');
  if (btn) {
    btn.addEventListener('click', openRemindersModal);
  }
}

async function openRemindersModal() {
  const modal = document.getElementById('remindersModal');
  const container = document.getElementById('remindersListContainer');
  const subtitle = document.getElementById('remindersDateSubtitle');
  const tomorrow = getTomorrowIso();

  subtitle.textContent = `Appuntamenti di domani (${formatShortItDate(tomorrow)}): invia il promemoria WhatsApp personalizzato con un clic.`;
  container.innerHTML = '<p class="muted-text">Caricamento appuntamenti di domani...</p>';
  modal.classList.add('open');

  await loadTomorrowReminders();
  updateKpis();
  renderSmartAssistBar();

  if (STATE.tomorrowAppointments.length === 0) {
    container.innerHTML = `<div style="padding:28px;text-align:center;color:var(--ink-soft);">Nessun appuntamento attivo in agenda per domani (${escapeHtml(formatShortItDate(tomorrow))}).</div>`;
    return;
  }

  container.innerHTML = STATE.tomorrowAppointments
    .map((appt) => {
      const sent = Boolean(appt.reminder_sent_at);
      const sentLabel = sent ? `✓ Inviato (${escapeHtml(String(appt.reminder_sent_at).slice(0, 16))})` : 'Da inviare';
      return `
        <div class="reminder-item-card ${sent ? 'is-sent' : ''}" data-reminder-appt-id="${appt.id}">
          <div style="flex:1;min-width:220px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <strong>${escapeHtml(appt.start_time)} — ${escapeHtml(appt.client_name)}</strong>
              <span class="status-badge ${sent ? 'badge-privacy-ok' : 'badge-pending'}">${sentLabel}</span>
            </div>
            <div style="font-size:0.8rem;color:var(--ink-soft);margin-top:3px;">
              ${escapeHtml(appt.services_summary)} • ${escapeHtml(appt.client_phone)}
            </div>
            ${appt.notes ? `<div class="reminder-msg-preview">📝 Nota: ${escapeHtml(appt.notes)}</div>` : ''}
          </div>
          <div class="assist-actions">
            <a href="${buildTomorrowReminderUrl(appt)}" target="_blank" rel="noopener"
               class="btn-primary-admin js-send-wa-reminder" data-id="${appt.id}">
              💬 Invia WhatsApp
            </a>
            ${sent
              ? `<button type="button" class="btn-outline-sm js-toggle-reminder" data-id="${appt.id}" data-reset="1">Segna da inviare</button>`
              : `<button type="button" class="btn-outline-sm js-toggle-reminder" data-id="${appt.id}" data-reset="0">✓ Segna inviato</button>`}
          </div>
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('.js-send-wa-reminder').forEach((link) => {
    link.addEventListener('click', async () => {
      const id = Number(link.dataset.id);
      await apiFetch('admin/appointments', {
        method: 'POST',
        body: JSON.stringify({ action: 'mark_reminder', id }),
      });
      await openRemindersModal();
    });
  });

  container.querySelectorAll('.js-toggle-reminder').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const reset = btn.dataset.reset === '1';
      await apiFetch('admin/appointments', {
        method: 'POST',
        body: JSON.stringify({ action: 'mark_reminder', id, reset }),
      });
      await openRemindersModal();
    });
  });
}

/* ==========================================================================
   GOOGLE CALENDAR-STYLE AGENDA RENDERER
   ========================================================================== */
function renderCalendar() {
  const container = document.getElementById('calendarContainer');
  const titleEl = document.getElementById('calRangeTitle');

  if (STATE.calMode === 'list') {
    titleEl.textContent = 'Elenco Appuntamenti';
    renderListCalendar(container);
    return;
  }

  const days = [];
  if (STATE.calMode === 'week') {
    const mon = getMondayOfWeek(STATE.anchorDate);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    titleEl.textContent = `${mon.getDate()} ${MONTHS_IT[mon.getMonth()]} – ${sun.getDate()} ${MONTHS_IT[sun.getMonth()]} ${sun.getFullYear()}`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      days.push(d);
    }
  } else {
    const d = STATE.anchorDate;
    titleEl.textContent = `${DAYS_IT[d.getDay()]} ${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}`;
    days.push(d);
  }

  const hours = [];
  for (let h = 8; h <= 20; h++) {
    hours.push(h);
  }

  const todayIso = toIsoDate(new Date());
  const gridClass = STATE.calMode === 'week' ? 'week-grid' : 'day-grid';

  let html = `<div class="${gridClass}">`;
  html += `<div class="cal-corner-cell"><span class="cal-day-name">Ora</span></div>`;

  days.forEach((d) => {
    const iso = toIsoDate(d);
    const dow = d.getDay();
    const isClosed = dow === 0 || dow === 2;
    const isToday = iso === todayIso;
    const dayAbsences = (STATE.absences || []).filter((abs) => iso >= abs.start_date && iso <= abs.end_date);
    const absHtml = dayAbsences
      .map((abs) => `<div class="cal-absence-pill">🏖️ ${escapeHtml(abs.operator_name)} (${escapeHtml(abs.type)})</div>`)
      .join('');
    html += `
      <div class="cal-day-header ${isToday ? 'is-today' : ''} ${isClosed ? 'is-closed' : ''}">
        <span class="cal-day-name">${DAYS_IT[dow]}</span>
        <span class="cal-day-num">${d.getDate()}</span>
        ${isClosed ? '<span class="cal-closed-tag">Chiuso</span>' : ''}
        ${absHtml}
      </div>
    `;
  });

  // Time column
  html += `<div class="cal-time-col">`;
  hours.forEach((h) => {
    html += `<div class="cal-time-label">${String(h).padStart(2, '0')}:00</div>`;
  });
  html += `</div>`;

  // Day columns
  days.forEach((d) => {
    const iso = toIsoDate(d);
    const dow = d.getDay();
    const isClosed = dow === 0 || dow === 2;
    const dayAppts = STATE.appointments.filter((a) => a.appointment_date === iso);

    html += `<div class="cal-day-col ${isClosed ? 'is-closed' : ''}">`;
    hours.forEach((h) => {
      const slotTime = `${String(h).padStart(2, '0')}:00`;
      html += `<div class="cal-hour-slot" data-date="${iso}" data-time="${slotTime}" title="Clicca per aggiungere appuntamento alle ${slotTime}"></div>`;
    });

    dayAppts.forEach((appt) => {
      const [ah, am] = String(appt.start_time || '09:00').split(':').map(Number);
      const minutesFromStart = (ah - 8) * 60 + (am || 0);
      const topPx = Math.max(2, (minutesFromStart / 60) * 58);
      const heightPx = Math.max(38, ((Number(appt.duration_minutes) || 60) / 60) * 58 - 3);

      const hasAnyNote = Boolean(appt.notes || appt.allergies_notes);
      const opColor = appt.operator_color || '#d47491';
      const opName = appt.operator_name || 'Giulia';
      html += `
        <div class="cal-event-card status-${escapeHtml(appt.status)}"
             data-appt-id="${appt.id}"
             style="top:${topPx}px; height:${heightPx}px; border-left: 4px solid ${escapeHtml(opColor)};">
          <div class="cal-event-time">${escapeHtml(appt.start_time)} • ${Number(appt.total_price).toFixed(0)}€ <span style="opacity:0.85;">• ${escapeHtml(opName)}</span> ${appt.reminder_sent_at ? '📲' : ''}</div>
          <div class="cal-event-client">${escapeHtml(appt.client_name)}</div>
          <div class="cal-event-service">${escapeHtml(appt.services_summary)}</div>
          ${hasAnyNote ? `<div class="cal-event-note-flag">📝 ${escapeHtml(appt.notes || appt.allergies_notes)}</div>` : ''}
        </div>
      `;
    });

    html += `</div>`;
  });

  html += `</div>`;
  container.innerHTML = html;

  container.querySelectorAll('.cal-hour-slot').forEach((slotEl) => {
    slotEl.addEventListener('click', () => {
      openAppointmentModal(null, slotEl.dataset.date, slotEl.dataset.time);
    });
  });

  container.querySelectorAll('.cal-event-card').forEach((cardEl) => {
    cardEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(cardEl.dataset.apptId);
      const appt = STATE.appointments.find((a) => Number(a.id) === id);
      if (appt) openAppointmentModal(appt);
    });
  });
}

function renderListCalendar(container) {
  if (STATE.appointments.length === 0) {
    container.innerHTML = `<div style="padding: 36px; text-align: center; color: var(--ink-soft);">Nessun appuntamento trovato per i filtri selezionati.</div>`;
    return;
  }

  let rows = '';
  STATE.appointments.forEach((a) => {
    rows += `
      <tr data-appt-id="${a.id}" style="cursor: pointer;">
        <td><strong>${escapeHtml(a.appointment_date)}</strong><br /><span style="font-size:0.75rem;color:var(--ink-muted);">${escapeHtml(a.start_time)} (${a.duration_minutes} min)</span></td>
        <td><strong>${escapeHtml(a.client_name)}</strong><br /><span style="font-size:0.75rem;color:var(--ink-soft);">${escapeHtml(a.client_phone)}</span></td>
        <td>
          ${escapeHtml(a.services_summary)}
          ${a.notes ? `<br /><span style="font-size:0.74rem;color:var(--ink-muted);">📝 ${escapeHtml(a.notes)}</span>` : ''}
        </td>
        <td><strong>${Number(a.total_price).toFixed(0)} €</strong></td>
        <td>
          <span class="status-badge badge-${escapeHtml(a.status)}">${escapeHtml(STATUS_LABELS[a.status] || a.status)}</span>
          ${a.reminder_sent_at ? '<br /><span style="font-size:0.68rem;color:#2e6b4a;">📲 Promemoria inviato</span>' : ''}
        </td>
        <td><button type="button" class="btn-outline-sm">Apri</button></td>
      </tr>
    `;
  });

  container.innerHTML = `
    <div class="list-appts-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Data &amp; Ora</th>
            <th>Cliente</th>
            <th>Trattamenti</th>
            <th>Importo</th>
            <th>Stato</th>
            <th>Azioni</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('tr[data-appt-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const id = Number(tr.dataset.apptId);
      const appt = STATE.appointments.find((a) => Number(a.id) === id);
      if (appt) openAppointmentModal(appt);
    });
  });
}

/* ==========================================================================
   APPOINTMENT MODAL (CREATE / EDIT / WHATSAPP REMINDER)
   ========================================================================== */
function populateClientSelect() {
  const select = document.getElementById('apptClientSelect');
  if (!select) return;
  let opts = '<option value="">— Seleziona una cliente —</option>';
  STATE.clients.forEach((c) => {
    opts += `<option value="${c.id}">${escapeHtml(c.full_name)} (${escapeHtml(c.phone)})</option>`;
  });
  select.innerHTML = opts;
}

function buildCatalogPicker() {
  const box = document.getElementById('apptCatalogPicker');
  if (!box || !window.STUDIO_CATALOG) return;
  let html = '';
  window.STUDIO_CATALOG.forEach((cat) => {
    cat.subgroups.forEach((sg) => {
      sg.items.forEach((item) => {
        html += `
          <label class="catalog-pick-item">
            <input type="checkbox" value="${escapeHtml(item.id)}" data-name="${escapeHtml(item.name)}" data-price="${item.price}" data-duration="${item.duration}" />
            <span>${escapeHtml(item.name)} (${item.price}€)</span>
          </label>
        `;
      });
    });
  });
  box.innerHTML = html;

  box.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const checked = Array.from(box.querySelectorAll('input:checked'));
      if (checked.length > 0) {
        const names = checked.map((c) => c.dataset.name);
        const totalP = checked.reduce((s, c) => s + Number(c.dataset.price), 0);
        const totalD = checked.reduce((s, c) => s + Number(c.dataset.duration), 0);
        document.getElementById('apptServicesSummaryInput').value = names.join(' + ');
        document.getElementById('apptPriceInput').value = totalP;
        document.getElementById('apptDurationInput').value = totalD;
      }
    });
  });
}

function renderSelectedClientNotePreview(clientId) {
  const preview = document.getElementById('apptSelectedClientInfo');
  if (!preview) return;
  const c = STATE.clients.find((item) => Number(item.id) === Number(clientId));
  if (!c) {
    preview.hidden = true;
    preview.innerHTML = '';
    return;
  }

  const lines = [];
  if (c.birth_date) {
    const days = getDaysUntilBirthday(c.birth_date);
    const bLabel = days === 0 ? '🎂 Compleanno Oggi!' : `🎂 ${formatShortItDate(c.birth_date)}`;
    lines.push(`<strong>${escapeHtml(bLabel)}</strong>`);
  }
  if (c.allergies_notes) {
    lines.push(`<strong>⚠ Allergie:</strong> ${escapeHtml(c.allergies_notes)}`);
  }
  if (c.preferences_notes) {
    lines.push(`<strong>📝 Note Cliente:</strong> ${escapeHtml(c.preferences_notes)}`);
  }
  if (lines.length === 0) {
    lines.push('Nessuna nota tecnica o compleanno salvato per questa cliente.');
  }

  preview.innerHTML = `
    <div>${lines.join('<br />')}</div>
    <div style="margin-top:6px;">
      <button type="button" class="btn-outline-sm" id="editPickedClientDossierBtn">Apri / Modifica Scheda &amp; Note</button>
    </div>
  `;
  preview.hidden = false;
  document.getElementById('editPickedClientDossierBtn').addEventListener('click', () => {
    openClientModal(Number(c.id));
  });
}

function setClientPickerMode(mode) {
  STATE.clientPickerMode = mode;
  document.getElementById('pickExistingClientTab').classList.toggle('active', mode === 'existing');
  document.getElementById('createInlineClientTab').classList.toggle('active', mode === 'new');
  document.getElementById('existingClientPickGroup').hidden = mode !== 'existing';
  document.getElementById('inlineClientFields').hidden = mode !== 'new';
}

function openAppointmentModal(appt = null, presetDate = null, presetTime = null) {
  const modal = document.getElementById('apptModal');
  const alertEl = document.getElementById('apptModalAlert');
  alertEl.hidden = true;

  // Reset checkboxes
  document.querySelectorAll('#apptCatalogPicker input[type="checkbox"]').forEach((c) => {
    c.checked = false;
  });

  const deleteBtn = document.getElementById('deleteApptBtn');
  const waBtn = document.getElementById('apptWhatsappReminderBtn');
  const clientSection = document.getElementById('apptClientSection');

  if (appt) {
    document.getElementById('apptModalTitle').textContent = `Appuntamento • ${appt.client_name}`;
    document.getElementById('apptIdInput').value = appt.id;
    clientSection.hidden = true;
    document.getElementById('apptDateInput').value = appt.appointment_date;
    document.getElementById('apptTimeInput').value = appt.start_time;
    document.getElementById('apptDurationInput').value = appt.duration_minutes;
    const opSel = document.getElementById('apptOperatorSelect');
    if (opSel && appt.operator_id) opSel.value = String(appt.operator_id);
    document.getElementById('apptServicesSummaryInput').value = appt.services_summary;
    document.getElementById('apptPriceInput').value = appt.total_price;
    document.getElementById('apptStatusSelect').value = appt.status;
    document.getElementById('apptNotesInput').value = appt.notes || '';

    deleteBtn.hidden = false;
    waBtn.hidden = false;
    const cleanPhone = String(appt.client_phone || '').replace(/[^\d]/g, '');
    const reminderMsg = encodeURIComponent(
      `Ciao ${appt.client_name} ♡ Ti ricordiamo il tuo appuntamento da *Giulia Beauty Studio* (Via Principe Amedeo 17, Verdellino) il giorno *${appt.appointment_date}* alle *${appt.start_time}* per: ${appt.services_summary}. A presto!`
    );
    waBtn.href = `https://wa.me/${cleanPhone.startsWith('39') ? cleanPhone : '39' + cleanPhone}?text=${reminderMsg}`;
  } else {
    document.getElementById('apptModalTitle').textContent = 'Nuovo Appuntamento';
    document.getElementById('apptIdInput').value = '';
    clientSection.hidden = false;
    setClientPickerMode(STATE.clients.length > 0 ? 'existing' : 'new');
    document.getElementById('apptClientSelect').value = '';
    renderSelectedClientNotePreview(0);
    document.getElementById('apptNewClientName').value = '';
    document.getElementById('apptNewClientPhone').value = '';
    document.getElementById('apptNewClientEmail').value = '';
    document.getElementById('apptNewClientBirthDate').value = '';
    document.getElementById('apptNewClientPrefNotes').value = '';
    document.getElementById('apptNewClientPrivacy').checked = true;
    document.getElementById('apptDateInput').value = presetDate || toIsoDate(STATE.anchorDate);
    document.getElementById('apptTimeInput').value = presetTime || '10:00';
    document.getElementById('apptDurationInput').value = 60;
    document.getElementById('apptServicesSummaryInput').value = '';
    document.getElementById('apptPriceInput').value = 0;
    document.getElementById('apptStatusSelect').value = 'confirmed';
    document.getElementById('apptNotesInput').value = '';
    deleteBtn.hidden = true;
    waBtn.hidden = true;
  }

  modal.classList.add('open');
}

/* ==========================================================================
   CLIENTS CRM TABLE & DOSSIER MODAL (GDPR)
   ========================================================================== */
function renderClientsTable() {
  const container = document.getElementById('clientsListContainer');
  if (STATE.clients.length === 0) {
    container.innerHTML = `<div style="padding: 36px; text-align: center; color: var(--ink-soft);">Nessuna cliente presente nel database.</div>`;
    return;
  }

  let rows = '';
  STATE.clients.forEach((c) => {
    const privacyOk = Number(c.privacy_accepted) === 1;
    const needsReSign = privacyOk && c.privacy_version && c.privacy_version !== STATE.privacyVersion;
    const privacyDate = c.privacy_accepted_at ? String(c.privacy_accepted_at).slice(0, 10) : '';
    const hasAllergy = c.allergies_notes && c.allergies_notes.trim() !== '';
    const hasNotes = c.preferences_notes && c.preferences_notes.trim() !== '';
    const activeCards = Number(c.active_cards_count || 0);
    const morphoCount = Number(c.morpho_count || 0);
    const daysBday = getDaysUntilBirthday(c.birth_date);
    let bdayHtml = '—';
    if (c.birth_date) {
      const dateTxt = formatShortItDate(c.birth_date);
      if (daysBday === 0) {
        bdayHtml = `<span class="status-badge badge-birthday">🎂 Oggi (${escapeHtml(dateTxt)})</span>`;
      } else if (daysBday !== null && daysBday <= 14) {
        bdayHtml = `<span class="status-badge badge-birthday">🎂 Tra ${daysBday}gg (${escapeHtml(dateTxt)})</span>`;
      } else {
        bdayHtml = `🎂 ${escapeHtml(dateTxt)}`;
      }
    }

    const privBadge = !privacyOk
      ? '<span class="status-badge badge-privacy-no">Da firmare</span>'
      : needsReSign
        ? `<span class="status-badge badge-pending">⚠ Rifirmare (${escapeHtml(c.privacy_version)})</span>`
        : `<span class="status-badge badge-privacy-ok">✓ Firmata ${escapeHtml(privacyDate)}</span>`;

    rows += `
      <tr data-client-id="${c.id}" style="cursor: pointer;">
        <td>
          <strong>${escapeHtml(c.full_name)}</strong>
          ${hasAllergy ? '<span class="status-badge badge-allergy">⚠ Allergie</span>' : ''}
          ${activeCards > 0 ? `<span class="status-badge badge-confirmed" style="margin-left:4px;">🎟️ ${activeCards}</span>` : ''}
          ${morphoCount > 0 ? `<span class="status-badge" style="background:#eef6fb;color:#1f5878;margin-left:4px;">📏 ${morphoCount}</span>` : ''}
          ${hasNotes ? '<span class="status-badge" style="background:#f7eceb;color:var(--ink-soft);">📝 Note</span>' : ''}
          ${c.email ? `<br /><span style="font-size:0.74rem;color:var(--ink-muted);">${escapeHtml(c.email)}</span>` : ''}
          ${hasNotes ? `<br /><span style="font-size:0.73rem;color:var(--ink-muted);">${escapeHtml(c.preferences_notes.slice(0, 58))}${c.preferences_notes.length > 58 ? '…' : ''}</span>` : ''}
        </td>
        <td>${escapeHtml(c.phone)}</td>
        <td>${bdayHtml}</td>
        <td>${Number(c.appointments_count || 0)}</td>
        <td><strong>${Number(c.total_spent || 0).toFixed(0)} €</strong></td>
        <td>${c.last_visit ? escapeHtml(c.last_visit) : '—'}</td>
        <td>${privBadge}</td>
        <td><button type="button" class="btn-outline-sm">Scheda</button></td>
      </tr>
    `;
  });

  container.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Cliente &amp; Note</th>
          <th>Telefono / WA</th>
          <th>Compleanno 🎂</th>
          <th>Visite</th>
          <th>Spesa Tot.</th>
          <th>Ultima Visita</th>
          <th>Privacy GDPR</th>
          <th>Azione</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  container.querySelectorAll('tr[data-client-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      openClientModal(Number(tr.dataset.clientId));
    });
  });
}

function renderClientCardsList(cards = []) {
  const listEl = document.getElementById('clientCardsList');
  if (!listEl) return;
  if (cards.length === 0) {
    listEl.innerHTML = '<p class="muted-text" style="font-size:0.78rem;">Nessuna carta o pacchetto attivo per questa cliente.</p>';
    return;
  }
  listEl.innerHTML = cards
    .map((card) => {
      const remSessions = Math.max(0, Number(card.total_sessions || 0) - Number(card.used_sessions || 0));
      const detail =
        Number(card.total_sessions || 0) > 0
          ? `Sedute: <strong>${remSessions}/${card.total_sessions} rimaste</strong>`
          : `Credito residuo: <strong>${Number(card.remaining_credit || 0).toFixed(2)} €</strong>`;
      return `
        <div class="client-card-item">
          <div>
            <strong>${escapeHtml(card.title)}</strong>
            <span class="status-badge ${card.status === 'active' ? 'badge-confirmed' : 'badge-completed'}" style="margin-left:6px;">${escapeHtml(card.status)}</span>
            <div style="font-size:0.74rem;color:var(--ink-soft);margin-top:2px;">${detail}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${Number(card.total_sessions || 0) > 0 && card.status === 'active'
              ? `<button type="button" class="btn-outline-sm js-use-card" data-card-id="${card.id}" data-sessions="1" data-credit="0">-1 Seduta</button>`
              : ''}
            ${Number(card.remaining_credit || 0) > 0 && card.status === 'active'
              ? `<button type="button" class="btn-outline-sm js-use-card" data-card-id="${card.id}" data-sessions="0" data-credit="10">Scala €</button>`
              : ''}
            <button type="button" class="btn-danger-outline js-del-card" data-card-id="${card.id}" style="padding:4px 8px;font-size:0.7rem;">✕</button>
          </div>
        </div>`;
    })
    .join('');

  listEl.querySelectorAll('.js-use-card').forEach((btn) => {
    btn.addEventListener('click', async () => {
      let creditDelta = Number(btn.dataset.credit || 0);
      if (creditDelta > 0) {
        const val = window.prompt('Importo in € da scalare dalla prepagata:', '10');
        if (val === null) return;
        creditDelta = Number(val) || 0;
      }
      await apiFetch(`admin/cards/${btn.dataset.cardId}/use`, {
        method: 'POST',
        body: JSON.stringify({
          sessions_delta: Number(btn.dataset.sessions || 0),
          credit_delta: creditDelta,
        }),
      });
      if (STATE.currentDossierClient) {
        await openClientModal(STATE.currentDossierClient.id);
      }
    });
  });

  listEl.querySelectorAll('.js-del-card').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Eliminare questa carta/pacchetto?')) return;
      await apiFetch(`admin/cards/${btn.dataset.cardId}/use`, {
        method: 'POST',
        body: JSON.stringify({ action: 'delete' }),
      });
      if (STATE.currentDossierClient) {
        await openClientModal(STATE.currentDossierClient.id);
      }
    });
  });
}

async function openClientModal(clientId = null) {
  const modal = document.getElementById('clientModal');
  const alertEl = document.getElementById('clientModalAlert');
  const historyGrid = document.getElementById('clientDossierHistory');
  const quickTools = document.getElementById('clientQuickToolsBar');
  const otpBox = document.getElementById('privacyOtpResultBox');
  const delBtn = document.getElementById('deleteClientGdprBtn');
  const exportBtn = document.getElementById('exportClientJsonBtn');
  const waBtn = document.getElementById('clientWhatsappBtn');

  alertEl.hidden = true;
  if (otpBox) otpBox.hidden = true;

  if (!clientId) {
    STATE.currentDossierClient = null;
    if (quickTools) quickTools.hidden = true;
    document.getElementById('clientModalTitle').textContent = 'Nuova Cliente nel Database';
    document.getElementById('clientIdInput').value = '';
    document.getElementById('clientFullNameInput').value = '';
    document.getElementById('clientPhoneCrmInput').value = '';
    document.getElementById('clientEmailCrmInput').value = '';
    document.getElementById('clientBirthDateInput').value = '';
    document.getElementById('clientAllergiesInput').value = '';
    document.getElementById('clientPreferencesInput').value = '';
    document.getElementById('clientPrivacyCrmCheck').checked = true;
    document.getElementById('clientMarketingCrmCheck').checked = false;
    historyGrid.hidden = true;
    delBtn.hidden = true;
    exportBtn.hidden = true;
    waBtn.hidden = true;
    modal.classList.add('open');
    return;
  }

  try {
    const data = await apiFetch(`admin/clients?id=${clientId}`, { method: 'GET' });
    const c = data.client;
    STATE.currentDossierClient = c;
    if (quickTools) quickTools.hidden = false;

    document.getElementById('clientModalTitle').textContent = `Scheda Cliente • ${c.full_name}`;
    document.getElementById('clientIdInput').value = c.id;
    document.getElementById('clientFullNameInput').value = c.full_name || '';
    document.getElementById('clientPhoneCrmInput').value = c.phone || '';
    document.getElementById('clientEmailCrmInput').value = c.email || '';
    document.getElementById('clientBirthDateInput').value = c.birth_date ? String(c.birth_date).slice(0, 10) : '';
    document.getElementById('clientAllergiesInput').value = c.allergies_notes || '';
    document.getElementById('clientPreferencesInput').value = c.preferences_notes || '';
    document.getElementById('clientPrivacyCrmCheck').checked = Number(c.privacy_accepted) === 1;
    document.getElementById('clientMarketingCrmCheck').checked = Number(c.marketing_consent) === 1;

    renderClientCardsList(data.cards || []);

    const apptsHtml = (data.appointments || []).length
      ? data.appointments
          .map(
            (a) => `<div class="history-row">
              <strong>${escapeHtml(a.appointment_date)} (${escapeHtml(a.start_time)})</strong> • ${escapeHtml(a.operator_name || 'Giulia')} — ${Number(a.total_price).toFixed(0)} €
              <span class="status-badge badge-${escapeHtml(a.status)}" style="float:right;">${escapeHtml(STATUS_LABELS[a.status] || a.status)}</span><br />
              <span>${escapeHtml(a.services_summary)}</span>
            </div>`
          )
          .join('')
      : '<p class="muted-text">Nessun appuntamento registrato.</p>';

    const logsHtml = (data.privacy_logs || []).length
      ? data.privacy_logs
          .map(
            (l) => `<div class="history-row">
              <strong>✓ ${escapeHtml(l.consent_type)}</strong> (${escapeHtml(l.consent_version)})<br />
              <span style="color:var(--ink-muted);">Accettato il: ${escapeHtml(l.accepted_at)}</span>
            </div>`
          )
          .join('')
      : '<p class="muted-text">Nessun log consenso registrato.</p>';

    document.getElementById('clientApptsHistoryList').innerHTML = apptsHtml;
    document.getElementById('clientPrivacyLogsList').innerHTML = logsHtml;

    historyGrid.hidden = false;
    delBtn.hidden = false;
    exportBtn.hidden = false;
    waBtn.hidden = false;

    const cleanPhone = String(c.phone || '').replace(/[^\d]/g, '');
    waBtn.href = `https://wa.me/${cleanPhone.startsWith('39') ? cleanPhone : '39' + cleanPhone}`;

    exportBtn.onclick = () => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scheda-gdpr-${c.full_name.toLowerCase().replace(/\s+/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };

    modal.classList.add('open');
  } catch (err) {
    alert(err.message);
  }
}

function exportClientsToCsv() {
  if (STATE.clients.length === 0) {
    alert('Nessuna cliente da esportare.');
    return;
  }
  const headers = ['ID', 'Nome Completo', 'Telefono', 'Email', 'Compleanno', 'Allergie', 'Note Tecniche', 'Privacy Accettata', 'Data Consenso Privacy', 'Versione Privacy', 'Visite', 'Totale Speso EUR'];
  const lines = [headers.join(';')];
  STATE.clients.forEach((c) => {
    const vals = [
      c.id,
      c.full_name,
      c.phone,
      c.email || '',
      c.birth_date ? String(c.birth_date).slice(0, 10) : '',
      (c.allergies_notes || '').replace(/[\r\n;]+/g, ' '),
      (c.preferences_notes || '').replace(/[\r\n;]+/g, ' '),
      Number(c.privacy_accepted) === 1 ? 'SI' : 'NO',
      c.privacy_accepted_at || '',
      c.privacy_version || '',
      c.appointments_count || 0,
      c.total_spent || 0,
    ];
    lines.push(vals.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'));
  });

  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `clienti-giulia-beauty-${toIsoDate(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ==========================================================================
   EVENT BINDINGS
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const alertEl = document.getElementById('loginAlert');
      alertEl.hidden = true;
      try {
        await apiFetch('auth/login', {
          method: 'POST',
          body: JSON.stringify({
            username: document.getElementById('loginUsername').value.trim(),
            password: document.getElementById('loginPassword').value,
          }),
        });
        window.location.href = 'agenda.html';
      } catch (err) {
        alertEl.hidden = false;
        alertEl.textContent = err.message;
      }
    });
  }

  const workspace = document.getElementById('adminWorkspace');
  if (!workspace) {
    return;
  }

  buildCatalogPicker();
  STATE.morphoManager = window.MorphoManager
    ? window.MorphoManager.init(apiFetch, () => toIsoDate(new Date()), escapeHtml)
    : null;

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await apiFetch('auth/logout', { method: 'POST' });
    window.location.href = 'admin.html';
  });

  // Main View Tabs
  const allViews = ['agenda', 'clients', 'inventory', 'messages', 'insights', 'settings'];
  document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.activeView = btn.dataset.view;
      allViews.forEach((v) => {
        const el = document.getElementById(`view${v.charAt(0).toUpperCase()}${v.slice(1)}`);
        if (el) el.hidden = STATE.activeView !== v;
      });
      if (STATE.activeView === 'inventory') renderInventoryView();
      if (STATE.activeView === 'messages') renderMessagesView();
      if (STATE.activeView === 'insights') renderInsightsView();
      if (STATE.activeView === 'settings') renderSettingsView();
    });
  });

  // Calendar Navigation & Modes
  document.getElementById('calPrevBtn').addEventListener('click', async () => {
    const step = STATE.calMode === 'day' ? -1 : -7;
    STATE.anchorDate.setDate(STATE.anchorDate.getDate() + step);
    await loadAppointments();
    updateKpis();
    renderCalendar();
  });

  document.getElementById('calNextBtn').addEventListener('click', async () => {
    const step = STATE.calMode === 'day' ? 1 : 7;
    STATE.anchorDate.setDate(STATE.anchorDate.getDate() + step);
    await loadAppointments();
    updateKpis();
    renderCalendar();
  });

  document.getElementById('calTodayBtn').addEventListener('click', async () => {
    STATE.anchorDate = new Date();
    await loadAppointments();
    updateKpis();
    renderCalendar();
  });

  document.getElementById('calStatusFilter').addEventListener('change', async (e) => {
    STATE.statusFilter = e.target.value;
    await loadAppointments();
    renderCalendar();
  });

  const opFilterEl = document.getElementById('calOperatorFilter');
  if (opFilterEl) {
    opFilterEl.addEventListener('change', async (e) => {
      STATE.operatorFilter = Number(e.target.value) || 0;
      await loadAppointments();
      renderCalendar();
    });
  }

  document.querySelectorAll('.mode-pill').forEach((pill) => {
    pill.addEventListener('click', async () => {
      document.querySelectorAll('.mode-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      STATE.calMode = pill.dataset.calmode;
      await loadAppointments();
      renderCalendar();
    });
  });

  // New Appointment Quick Button, Reminders Modal & Tabs
  document.getElementById('openRemindersModalBtn').addEventListener('click', openRemindersModal);
  document.getElementById('closeRemindersModalBtn').addEventListener('click', () => {
    document.getElementById('remindersModal').classList.remove('open');
  });
  document.getElementById('apptClientSelect').addEventListener('change', (e) => {
    renderSelectedClientNotePreview(e.target.value);
  });
  document.getElementById('newApptQuickBtn').addEventListener('click', () => openAppointmentModal());
  document.getElementById('pickExistingClientTab').addEventListener('click', () => setClientPickerMode('existing'));
  document.getElementById('createInlineClientTab').addEventListener('click', () => setClientPickerMode('new'));
  document.getElementById('closeApptModalBtn').addEventListener('click', () => {
    document.getElementById('apptModal').classList.remove('open');
  });

  // Save Appointment Form
  document.getElementById('apptForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById('apptModalAlert');
    alertEl.hidden = true;

    const id = document.getElementById('apptIdInput').value;
    const opSelect = document.getElementById('apptOperatorSelect');
    const payload = {
      action: id ? 'update' : 'create',
      id: id ? Number(id) : undefined,
      operator_id: opSelect && opSelect.value ? Number(opSelect.value) : undefined,
      appointment_date: document.getElementById('apptDateInput').value,
      start_time: document.getElementById('apptTimeInput').value,
      duration_minutes: Number(document.getElementById('apptDurationInput').value) || 60,
      services_summary: document.getElementById('apptServicesSummaryInput').value.trim(),
      total_price: Number(document.getElementById('apptPriceInput').value) || 0,
      status: document.getElementById('apptStatusSelect').value,
      notes: document.getElementById('apptNotesInput').value.trim(),
    };

    if (!id) {
      if (STATE.clientPickerMode === 'existing') {
        payload.client_id = Number(document.getElementById('apptClientSelect').value);
      } else {
        payload.client_name = document.getElementById('apptNewClientName').value.trim();
        payload.client_phone = document.getElementById('apptNewClientPhone').value.trim();
        payload.client_email = document.getElementById('apptNewClientEmail').value.trim();
        payload.client_birth_date = document.getElementById('apptNewClientBirthDate').value;
        payload.client_notes = document.getElementById('apptNewClientPrefNotes').value.trim();
        payload.privacy_accepted = document.getElementById('apptNewClientPrivacy').checked;
      }
    }

    try {
      await apiFetch('admin/appointments', { method: 'POST', body: JSON.stringify(payload) });
      document.getElementById('apptModal').classList.remove('open');
      await refreshAllData();
    } catch (err) {
      alertEl.hidden = false;
      alertEl.textContent = err.message;
    }
  });

  // Delete Appointment
  document.getElementById('deleteApptBtn').addEventListener('click', async () => {
    const id = Number(document.getElementById('apptIdInput').value);
    if (!id || !confirm('Eliminare definitivamente questo appuntamento dall\'agenda?')) return;
    await apiFetch('admin/appointments', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', id }),
    });
    document.getElementById('apptModal').classList.remove('open');
    await refreshAllData();
  });

  // Client Search & CRM Modals
  let searchTimer = null;
  document.getElementById('clientSearchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      await loadClients(e.target.value.trim());
      renderClientsTable();
    }, 220);
  });

  document.getElementById('newClientBtn').addEventListener('click', () => openClientModal(null));
  document.getElementById('closeClientModalBtn').addEventListener('click', () => {
    document.getElementById('clientModal').classList.remove('open');
  });

  document.getElementById('clientForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById('clientModalAlert');
    alertEl.hidden = true;
    const id = document.getElementById('clientIdInput').value;

    const payload = {
      action: 'save',
      id: id ? Number(id) : 0,
      full_name: document.getElementById('clientFullNameInput').value.trim(),
      phone: document.getElementById('clientPhoneCrmInput').value.trim(),
      email: document.getElementById('clientEmailCrmInput').value.trim(),
      birth_date: document.getElementById('clientBirthDateInput').value,
      allergies_notes: document.getElementById('clientAllergiesInput').value.trim(),
      preferences_notes: document.getElementById('clientPreferencesInput').value.trim(),
      privacy_accepted: document.getElementById('clientPrivacyCrmCheck').checked,
      marketing_consent: document.getElementById('clientMarketingCrmCheck').checked,
    };

    try {
      await apiFetch('admin/clients', { method: 'POST', body: JSON.stringify(payload) });
      document.getElementById('clientModal').classList.remove('open');
      await refreshAllData();
    } catch (err) {
      alertEl.hidden = false;
      alertEl.textContent = err.message;
    }
  });

  document.getElementById('deleteClientGdprBtn').addEventListener('click', async () => {
    const id = Number(document.getElementById('clientIdInput').value);
    if (!id || !confirm('Attenzione: verranno eliminati definitivamente tutti i dati anagrafici, gli appuntamenti e i log della cliente (Diritto all\'Oblio GDPR). Procedere?')) return;
    await apiFetch('admin/clients', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', id }),
    });
    document.getElementById('clientModal').classList.remove('open');
    await refreshAllData();
  });

  document.getElementById('exportClientsCsvBtn').addEventListener('click', exportClientsToCsv);
  document.getElementById('exportCsvSettingsBtn').addEventListener('click', exportClientsToCsv);

  // Change Password
  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('passwordChangeMsg');
    msgEl.hidden = true;
    try {
      const res = await apiFetch('auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: document.getElementById('currentPasswordInput').value,
          new_password: document.getElementById('newPasswordInput').value,
        }),
      });
      msgEl.className = 'admin-alert admin-alert-ok';
      msgEl.textContent = res.message || 'Password aggiornata.';
      msgEl.hidden = false;
      e.target.reset();
    } catch (err) {
      msgEl.className = 'admin-alert admin-alert-error';
      msgEl.textContent = err.message;
      msgEl.hidden = false;
    }
  });

  // AI Insights & Studio Reports Controls
  const inactiveFilterEl = document.getElementById('inactiveDaysFilter');
  if (inactiveFilterEl) {
    inactiveFilterEl.addEventListener('change', async (e) => {
      STATE.inactiveDaysFilter = Number(e.target.value) || 30;
      await loadInsights();
      renderInsightsView();
    });
  }

  document.querySelectorAll('.ai-prompt-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      sendAiQuestion(chip.dataset.question);
    });
  });

  const aiForm = document.getElementById('aiChatForm');
  if (aiForm) {
    aiForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('aiQuestionInput');
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      sendAiQuestion(q);
    });
  }

  const printReportBtn = document.getElementById('printStudioReportBtn');
  if (printReportBtn) {
    printReportBtn.addEventListener('click', printStudioReport);
  }

  const jsonReportBtn = document.getElementById('downloadReportJsonBtn');
  if (jsonReportBtn) {
    jsonReportBtn.addEventListener('click', downloadReportJson);
  }

  // Client Dossier: Morpho, Privacy Link+OTP, Client Cards
  const openMorphoBtn = document.getElementById('openMorphoModalBtn');
  if (openMorphoBtn) {
    openMorphoBtn.addEventListener('click', async () => {
      const clientId = Number(document.getElementById('clientIdInput').value);
      const client = STATE.clients.find((c) => Number(c.id) === clientId);
      if (client && STATE.morphoManager) {
        await STATE.morphoManager.openForClient(client);
      }
    });
  }

  const sendPrivacyOtpBtn = document.getElementById('sendPrivacyOtpBtn');
  if (sendPrivacyOtpBtn) {
    sendPrivacyOtpBtn.addEventListener('click', async () => {
      const clientId = Number(document.getElementById('clientIdInput').value);
      const box = document.getElementById('privacyOtpResultBox');
      if (!clientId || !box) return;
      sendPrivacyOtpBtn.disabled = true;
      try {
        const res = await apiFetch(`admin/clients/${clientId}/privacy-request`, { method: 'POST', body: JSON.stringify({}) });
        const req = res.request;
        const signUrl = `${window.location.origin}/privacy-sign.html?token=${encodeURIComponent(req.token)}`;
        const waNum = formatWaNumber(req.client.phone);
        const msg = renderMessageTemplate('privacy_sign', {
          nome: req.client.full_name,
          link: signUrl,
          otp: req.otp_code,
        });
        const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
        box.hidden = false;
        box.innerHTML = `
          <div><strong>Link firma generato</strong> • Codice OTP SMS/WA: <strong style="font-size:1.05rem;letter-spacing:2px;">${escapeHtml(req.otp_code)}</strong></div>
          <div style="margin-top:6px;word-break:break-all;font-size:0.78rem;"><a href="${escapeHtml(signUrl)}" target="_blank" rel="noopener">${escapeHtml(signUrl)}</a></div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
            <a href="${waUrl}" target="_blank" rel="noopener" class="btn-outline-sm" style="background:#fff;">📲 Invia Modulo + OTP su WhatsApp</a>
          </div>
        `;
      } catch (err) {
        box.hidden = false;
        box.textContent = `Errore generazione link privacy: ${err.message}`;
      } finally {
        sendPrivacyOtpBtn.disabled = false;
      }
    });
  }

  const newCardForm = document.getElementById('newClientCardForm');
  if (newCardForm) {
    newCardForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const clientId = Number(document.getElementById('clientIdInput').value);
      if (!clientId) return;
      await apiFetch(`admin/clients/${clientId}/cards`, {
        method: 'POST',
        body: JSON.stringify({
          title: document.getElementById('cardTitleInput').value.trim(),
          card_type: document.getElementById('cardTypeSelect').value,
          total_sessions: Number(document.getElementById('cardSessionsInput').value) || 0,
          remaining_credit: Number(document.getElementById('cardCreditInput').value) || 0,
        }),
      });
      newCardForm.reset();
      await loadClients();
      renderClientsTable();
      const updated = STATE.clients.find((c) => Number(c.id) === clientId);
      if (updated) renderClientCardsList(updated);
    });
  }

  // Inventory Controls & Modals
  const invSearch = document.getElementById('invSearchInput');
  if (invSearch) invSearch.addEventListener('input', () => renderInventoryView());
  const newSupBtn = document.getElementById('newSupplierBtn');
  if (newSupBtn) newSupBtn.addEventListener('click', () => openSupplierModal(null));
  const newProdBtn = document.getElementById('newProductBtn');
  if (newProdBtn) newProdBtn.addEventListener('click', () => openProductModal(null));

  const closeProdBtn = document.getElementById('closeProductModalBtn');
  if (closeProdBtn) closeProdBtn.addEventListener('click', () => document.getElementById('productModal').classList.remove('open'));
  const closeSupBtn = document.getElementById('closeSupplierModalBtn');
  if (closeSupBtn) closeSupBtn.addEventListener('click', () => document.getElementById('supplierModal').classList.remove('open'));
  const closeMovBtn = document.getElementById('closeMovementModalBtn');
  if (closeMovBtn) closeMovBtn.addEventListener('click', () => document.getElementById('movementModal').classList.remove('open'));

  const prodForm = document.getElementById('productForm');
  if (prodForm) {
    prodForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await apiFetch('admin/inventory/products', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save',
          id: Number(document.getElementById('prodIdInput').value) || 0,
          name: document.getElementById('prodNameInput').value.trim(),
          sku: document.getElementById('prodSkuInput').value.trim(),
          category: document.getElementById('prodCategorySelect').value,
          supplier_id: Number(document.getElementById('prodSupplierSelect').value) || null,
          unit: document.getElementById('prodUnitInput').value.trim() || 'pz',
          cost_price: Number(document.getElementById('prodCostInput').value) || 0,
          sell_price: Number(document.getElementById('prodSellInput').value) || 0,
          stock_qty: Number(document.getElementById('prodStockInput').value) || 0,
          min_stock_qty: Number(document.getElementById('prodMinStockInput').value) || 2,
        }),
      });
      document.getElementById('productModal').classList.remove('open');
      await refreshAllData();
      renderInventoryView();
    });
  }

  const delProdBtn = document.getElementById('deleteProductBtn');
  if (delProdBtn) {
    delProdBtn.addEventListener('click', async () => {
      const id = Number(document.getElementById('prodIdInput').value);
      if (!id || !confirm('Eliminare questo prodotto dal magazzino?')) return;
      await apiFetch('admin/inventory/products', { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
      document.getElementById('productModal').classList.remove('open');
      await refreshAllData();
      renderInventoryView();
    });
  }

  const supForm = document.getElementById('supplierForm');
  if (supForm) {
    supForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await apiFetch('admin/inventory/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save',
          id: Number(document.getElementById('supIdInput').value) || 0,
          name: document.getElementById('supNameInput').value.trim(),
          contact_name: document.getElementById('supContactInput').value.trim(),
          phone: document.getElementById('supPhoneInput').value.trim(),
          email: document.getElementById('supEmailInput').value.trim(),
          notes: document.getElementById('supNotesInput').value.trim(),
        }),
      });
      document.getElementById('supplierModal').classList.remove('open');
      await loadInventoryData();
      renderInventoryView();
    });
  }

  const delSupBtn = document.getElementById('deleteSupplierBtn');
  if (delSupBtn) {
    delSupBtn.addEventListener('click', async () => {
      const id = Number(document.getElementById('supIdInput').value);
      if (!id || !confirm('Eliminare questo fornitore?')) return;
      await apiFetch('admin/inventory/suppliers', { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
      document.getElementById('supplierModal').classList.remove('open');
      await loadInventoryData();
      renderInventoryView();
    });
  }

  const movForm = document.getElementById('movementForm');
  if (movForm) {
    movForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await apiFetch('admin/inventory/movements', {
        method: 'POST',
        body: JSON.stringify({
          product_id: Number(document.getElementById('movProductIdInput').value),
          movement_type: document.getElementById('movTypeSelect').value,
          quantity: Number(document.getElementById('movQtyInput').value) || 1,
          unit_price: Number(document.getElementById('movUnitPriceInput').value) || 0,
          client_id: Number(document.getElementById('movClientSelect').value) || null,
          notes: document.getElementById('movNotesInput').value.trim(),
        }),
      });
      document.getElementById('movementModal').classList.remove('open');
      await refreshAllData();
      renderInventoryView();
    });
  }

  // Message Center
  const msgClientSel = document.getElementById('msgClientSelect');
  const msgTplSel = document.getElementById('msgTemplateSelect');
  if (msgClientSel) msgClientSel.addEventListener('change', syncQuickMessagePreview);
  if (msgTplSel) msgTplSel.addEventListener('change', syncQuickMessagePreview);

  const quickMsgForm = document.getElementById('quickMessageForm');
  if (quickMsgForm) {
    quickMsgForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const clientId = Number(document.getElementById('msgClientSelect').value);
      const client = STATE.clients.find((c) => Number(c.id) === clientId);
      const text = document.getElementById('msgPreviewText').value.trim();
      if (!client || !text) return;
      await apiFetch('admin/messages/logs', {
        method: 'POST',
        body: JSON.stringify({
          client_id: client.id,
          recipient_phone: client.phone,
          recipient_name: client.full_name,
          channel: 'whatsapp',
          template_code: document.getElementById('msgTemplateSelect').value,
          message_text: text,
        }),
      });
      const waNum = formatWaNumber(client.phone);
      window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      await loadMessagesData();
      renderMessagesView();
    });
  }

  // Operators, Absences & Admin Users
  const newOpBtn = document.getElementById('newOperatorBtn');
  if (newOpBtn) newOpBtn.addEventListener('click', () => openOperatorModal(null));
  const closeOpBtn = document.getElementById('closeOperatorModalBtn');
  if (closeOpBtn) closeOpBtn.addEventListener('click', () => document.getElementById('operatorModal').classList.remove('open'));

  const opForm = document.getElementById('operatorForm');
  if (opForm) {
    opForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const schedule = {};
      document.querySelectorAll('.op-sched-row').forEach((row) => {
        const day = row.dataset.day;
        schedule[day] = {
          enabled: row.querySelector('.op-sched-enabled').checked,
          start: row.querySelector('.op-sched-start').value,
          end: row.querySelector('.op-sched-end').value,
          break_start: row.querySelector('.op-sched-bstart').value,
          break_end: row.querySelector('.op-sched-bend').value,
        };
      });
      await apiFetch('admin/operators', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save',
          id: Number(document.getElementById('opIdInput').value) || 0,
          name: document.getElementById('opNameInput').value.trim(),
          role: document.getElementById('opRoleInput').value.trim(),
          color: document.getElementById('opColorInput').value,
          active: document.getElementById('opActiveCheck').checked,
          weekly_schedule: schedule,
        }),
      });
      document.getElementById('operatorModal').classList.remove('open');
      await refreshAllData();
      renderSettingsView();
    });
  }

  const delOpBtn = document.getElementById('deleteOperatorBtn');
  if (delOpBtn) {
    delOpBtn.addEventListener('click', async () => {
      const id = Number(document.getElementById('opIdInput').value);
      if (!id || !confirm('Eliminare questo operatore dallo studio?')) return;
      await apiFetch('admin/operators', { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
      document.getElementById('operatorModal').classList.remove('open');
      await refreshAllData();
      renderSettingsView();
    });
  }

  const absForm = document.getElementById('absenceForm');
  if (absForm) {
    absForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await apiFetch('admin/absences', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          operator_id: Number(document.getElementById('absOperatorSelect').value),
          type: document.getElementById('absTypeSelect').value,
          start_date: document.getElementById('absStartDateInput').value,
          end_date: document.getElementById('absEndDateInput').value || document.getElementById('absStartDateInput').value,
          start_time: document.getElementById('absStartTimeInput').value.trim(),
          end_time: document.getElementById('absEndTimeInput').value.trim(),
          notes: document.getElementById('absNotesInput').value.trim(),
        }),
      });
      absForm.reset();
      await refreshAllData();
      renderSettingsView();
    });
  }

  const newUserForm = document.getElementById('newAdminUserForm');
  if (newUserForm) {
    newUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await apiFetch('admin/users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          username: document.getElementById('newAdminUsername').value.trim(),
          display_name: document.getElementById('newAdminDisplayName').value.trim(),
          password: document.getElementById('newAdminPassword').value,
          role: document.getElementById('newAdminRole').value,
        }),
      });
      newUserForm.reset();
      await loadAdminUsers();
      renderSettingsView();
    });
  }
});

/* ==========================================================================
   AI INSIGHTS, INACTIVE CLIENTS & REPORTS RENDERER
   ========================================================================== */
function formatAiTextToSafeHtml(rawText) {
  let safe = escapeHtml(rawText || '');
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return safe;
}

function buildWinBackWhatsAppUrl(client) {
  const waNum = formatWaNumber(client.phone);
  const msg = renderMessageTemplate('winback_inactive', {
    nome: client.full_name,
    giorni_assenza: client.days_since,
  });
  return `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
}

function renderInsightsView() {
  const ins = STATE.insights;
  const kpiGrid = document.getElementById('aiKpiHighlights');
  const recBox = document.getElementById('aiRecommendationsBox');
  const inactiveBox = document.getElementById('inactiveClientsContainer');
  const svcBox = document.getElementById('topServicesReportList');
  const vipBox = document.getElementById('vipClientsReportList');
  const badge = document.getElementById('aiEngineBadge');

  if (!ins || !kpiGrid) return;

  if (badge) {
    badge.textContent = STATE.geminiEnabled
      ? '✨ AI Potenziata da Gemini + Dati Reali'
      : '✨ Assistente AI Studio • Dati Reali';
  }

  const s = ins.summary;
  const deltaText =
    s.revenue_delta_pct === null
      ? `Mese prec.: ${s.prev_month_revenue.toFixed(0)} €`
      : `${s.revenue_delta_pct >= 0 ? '+' : ''}${s.revenue_delta_pct}% vs mese scorso`;

  kpiGrid.innerHTML = `
    <div class="kpi-card">
      <span class="kpi-label">Fatturato Mese (${escapeHtml(ins.current_month)})</span>
      <strong class="kpi-value">${s.month_revenue.toFixed(0)} €</strong>
      <span style="font-size:0.74rem;color:var(--ink-muted);margin-top:4px;display:block;">${escapeHtml(deltaText)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Ticket Medio Studio</span>
      <strong class="kpi-value">${s.avg_ticket.toFixed(0)} €</strong>
      <span style="font-size:0.74rem;color:var(--ink-muted);margin-top:4px;display:block;">Su ${s.total_active_appointments} appuntamenti</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Assenti 30+ / 60+ Giorni</span>
      <strong class="kpi-value">${s.inactive_30_plus} / ${s.inactive_60_plus}</strong>
      <span style="font-size:0.74rem;color:var(--ink-muted);margin-top:4px;display:block;">90+ gg: ${s.inactive_90_plus} • Mai tornate: ${s.never_visited_count}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Conformità Privacy GDPR</span>
      <strong class="kpi-value">${s.privacy_accepted_clients}/${s.total_clients}</strong>
      <span style="font-size:0.74rem;color:var(--ink-muted);margin-top:4px;display:block;">Clienti con consenso salvato</span>
    </div>
  `;

  recBox.innerHTML = `
    <h3 style="margin-bottom:10px;">Analisi &amp; Consigli AI di Oggi</h3>
    ${(ins.recommendations || [])
      .map((r) => `<div class="rec-item"><strong>${escapeHtml(r.icon)}</strong> ${escapeHtml(r.text)}</div>`)
      .join('')}
  `;

  const inactiveList = ins.inactive_clients || [];
  if (inactiveList.length === 0) {
    inactiveBox.innerHTML = `<div style="padding:26px;text-align:center;color:var(--ink-soft);">Nessuna cliente assente da oltre ${ins.inactive_threshold_days} giorni. Ottimo lavoro!</div>`;
  } else {
    inactiveBox.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Ultima Visita</th>
            <th>Giorni di Assenza</th>
            <th>Ultimo Trattamento</th>
            <th>Spesa Totale</th>
            <th>Richiamo</th>
          </tr>
        </thead>
        <tbody>
          ${inactiveList
            .map(
              (c) => `<tr>
                <td><strong>${escapeHtml(c.full_name)}</strong><br /><span style="font-size:0.74rem;color:var(--ink-muted);">${escapeHtml(c.phone)}</span></td>
                <td>${escapeHtml(c.last_visit)}</td>
                <td><span class="status-badge badge-birthday">${c.days_since} giorni fa</span></td>
                <td>${escapeHtml(c.last_services || '—')}</td>
                <td><strong>${Number(c.total_spent || 0).toFixed(0)} €</strong> (${c.visits_count} visite)</td>
                <td><a href="${buildWinBackWhatsAppUrl(c)}" target="_blank" rel="noopener" class="btn-outline-sm">💬 Richiama WhatsApp</a></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  const topServices = ins.top_services || [];
  if (topServices.length === 0) {
    svcBox.innerHTML = '<p class="muted-text">Nessun trattamento registrato negli appuntamenti.</p>';
  } else {
    const maxCount = Math.max(1, topServices[0].count);
    svcBox.innerHTML = topServices
      .map((t) => {
        const pct = Math.round((t.count / maxCount) * 100);
        return `
          <div class="report-bar-row">
            <div class="report-bar-label">
              <span><strong>${escapeHtml(t.name)}</strong></span>
              <span>${t.count}× • ${Number(t.revenue).toFixed(0)} €</span>
            </div>
            <div class="report-bar-track"><div class="report-bar-fill" style="width:${pct}%;"></div></div>
          </div>
        `;
      })
      .join('');
  }

  const vipClients = ins.vip_clients || [];
  if (vipClients.length === 0) {
    vipBox.innerHTML = '<p class="muted-text">Nessuna cliente con visite attive ancora registrate.</p>';
  } else {
    const maxSpent = Math.max(1, vipClients[0].total_spent);
    vipBox.innerHTML = vipClients
      .map((c) => {
        const pct = Math.round((c.total_spent / maxSpent) * 100);
        return `
          <div class="report-bar-row">
            <div class="report-bar-label">
              <span><strong>${escapeHtml(c.full_name)}</strong></span>
              <span>${c.visits_count} visite • ${Number(c.total_spent).toFixed(0)} € LTV</span>
            </div>
            <div class="report-bar-track"><div class="report-bar-fill" style="width:${pct}%;"></div></div>
          </div>
        `;
      })
      .join('');
  }

  const opBox = document.getElementById('operatorStatsReportList');
  if (opBox) {
    const ops = ins.operator_stats || [];
    if (ops.length === 0) {
      opBox.innerHTML = '<p class="muted-text">Nessun dato operatore disponibile.</p>';
    } else {
      const maxOpRev = Math.max(1, ...ops.map((o) => Number(o.revenue || 0)));
      opBox.innerHTML = ops
        .map((o) => {
          const pct = Math.round((Number(o.revenue || 0) / maxOpRev) * 100);
          return `
            <div class="report-bar-row">
              <div class="report-bar-label">
                <span><span class="op-dot" style="background:${escapeHtml(o.color || '#b85675')}"></span><strong>${escapeHtml(o.operator_name)}</strong> (${o.appointments_count} app.)</span>
                <span>${Number(o.revenue || 0).toFixed(0)} € • media ${Number(o.avg_ticket || 0).toFixed(0)} €</span>
              </div>
              <div class="report-bar-track"><div class="report-bar-fill" style="width:${pct}%;background:${escapeHtml(o.color || 'var(--rose-gold)')};"></div></div>
            </div>
          `;
        })
        .join('');
    }
  }

  const invBox = document.getElementById('inventoryReorderReportList');
  if (invBox) {
    const forecasts = ins.reorder_forecasts || [];
    const crossSell = ins.cross_sell || [];
    let html = '';
    if (forecasts.length === 0) {
      html += '<p class="muted-text">Scorte magazzino regolari: nessun prodotto sotto soglia.</p>';
    } else {
      html += forecasts
        .map(
          (f) => `<div class="rec-item" style="margin-bottom:8px;">
            <strong>${f.needs_reorder ? '⚠️ Riordino consigliato' : '📦 Monitoraggio'}: ${escapeHtml(f.name)}</strong><br />
            <span class="muted-text">Scorta: ${f.stock_qty} (min ${f.min_stock_qty}) • Consumo 60gg: ${f.used_last_60d} • Autonomia: ${f.days_left === null ? 'n.d.' : `${f.days_left} gg`}${f.supplier_name ? ` • Fornitore: ${escapeHtml(f.supplier_name)}` : ''}</span>
          </div>`
        )
        .join('');
    }
    if (crossSell.length > 0) {
      html += `<div style="margin-top:12px;"><strong>Vendite incrociate più frequenti (Servizio + Prodotto):</strong></div>`;
      html += crossSell
        .map((c) => `<div style="font-size:0.84rem;padding:4px 0;">• ${escapeHtml(c.pair)} <strong>(${c.count}×)</strong></div>`)
        .join('');
    }
    invBox.innerHTML = html;
  }
}

async function sendAiQuestion(question) {
  const messagesBox = document.getElementById('aiChatMessages');
  const sendBtn = document.getElementById('aiSendBtn');
  if (!messagesBox) return;

  const userDiv = document.createElement('div');
  userDiv.className = 'ai-msg ai-msg-user';
  userDiv.textContent = question;
  messagesBox.appendChild(userDiv);

  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'ai-msg ai-msg-bot';
  loadingDiv.textContent = 'Sto analizzando i dati aggiornati dello studio...';
  messagesBox.appendChild(loadingDiv);
  messagesBox.scrollTop = messagesBox.scrollHeight;

  if (sendBtn) sendBtn.disabled = true;
  try {
    const res = await apiFetch('admin/ai-chat', {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
    loadingDiv.innerHTML = formatAiTextToSafeHtml(res.answer);
    if (res.insights) {
      STATE.insights = res.insights;
      renderInsightsView();
    }
  } catch (err) {
    loadingDiv.textContent = `Errore durante l'analisi: ${err.message}`;
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }
}

function downloadReportJson() {
  if (!STATE.insights) return;
  const blob = new Blob([JSON.stringify(STATE.insights, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report-giulia-beauty-${toIsoDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function printStudioReport() {
  const ins = STATE.insights;
  if (!ins) return;
  const s = ins.summary;
  const win = window.open('', '_blank', 'width=900,height=720');
  if (!win) {
    alert('Consenti i popup per aprire il report stampabile.');
    return;
  }

  const inactiveRows = (ins.inactive_all_30_plus || [])
    .map(
      (c) => `<tr><td>${escapeHtml(c.full_name)}</td><td>${escapeHtml(c.phone)}</td><td>${escapeHtml(c.last_visit)}</td><td>${c.days_since} gg</td><td>${escapeHtml(c.last_services)}</td></tr>`
    )
    .join('');

  const servicesRows = (ins.top_services || [])
    .map((t) => `<tr><td>${escapeHtml(t.name)}</td><td>${t.count}</td><td>${Number(t.revenue).toFixed(2)} €</td></tr>`)
    .join('');

  win.document.write(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <title>Report Gestionale — Giulia Beauty Studio (${escapeHtml(ins.generated_at)})</title>
  <style>
    body { font-family: Georgia, serif; color: #3d1218; padding: 32px; max-width: 820px; margin: 0 auto; }
    h1 { margin: 0 0 4px; font-size: 26px; }
    .sub { color: #6e3b42; font-family: Arial, sans-serif; font-size: 13px; margin-bottom: 24px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; font-family: Arial, sans-serif; }
    .kpi { border: 1px solid #d9b6b9; border-radius: 10px; padding: 12px; }
    .kpi span { display: block; font-size: 11px; text-transform: uppercase; color: #6e3b42; }
    .kpi strong { font-size: 20px; }
    h2 { font-size: 18px; border-bottom: 1px solid #d9b6b9; padding-bottom: 6px; margin-top: 26px; }
    table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 13px; margin-top: 10px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #f0dede; }
    th { background: #fdf6f5; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()" style="float:right;padding:8px 16px;cursor:pointer;">Stampa / Salva PDF</button>
  <h1>Giulia Beauty Studio — Report Gestionale AI</h1>
  <div class="sub">Via Principe Amedeo, 17 - Verdellino (BG) • Generato il ${escapeHtml(ins.generated_at)}</div>
  <div class="kpis">
    <div class="kpi"><span>Clienti Totali</span><strong>${s.total_clients}</strong></div>
    <div class="kpi"><span>Fatturato Mese</span><strong>${s.month_revenue.toFixed(0)} €</strong></div>
    <div class="kpi"><span>Ticket Medio</span><strong>${s.avg_ticket.toFixed(0)} €</strong></div>
    <div class="kpi"><span>Assenti 30+ gg</span><strong>${s.inactive_30_plus}</strong></div>
  </div>
  <h2>Clienti che non vengono da 30+ giorni</h2>
  ${inactiveRows ? `<table><thead><tr><th>Cliente</th><th>Telefono</th><th>Ultima Visita</th><th>Assenza</th><th>Ultimo Trattamento</th></tr></thead><tbody>${inactiveRows}</tbody></table>` : '<p style="font-family:Arial,sans-serif;font-size:13px;">Nessuna cliente assente da oltre 30 giorni.</p>'}
  <h2>Classifica Trattamenti</h2>
  ${servicesRows ? `<table><thead><tr><th>Trattamento</th><th>Prenotazioni</th><th>Ricavo</th></tr></thead><tbody>${servicesRows}</tbody></table>` : '<p style="font-family:Arial,sans-serif;font-size:13px;">Nessun trattamento registrato.</p>'}
</body>
</html>`);
  win.document.close();
}

/* ==========================================================================
   INVENTORY (MAGAZZINO, PRODOTTI, FORNITORI & MOVIMENTI)
   ========================================================================== */
function renderInventoryView() {
  const kpiStrip = document.getElementById('invKpiStrip');
  const prodBox = document.getElementById('productsListContainer');
  const supBox = document.getElementById('suppliersListContainer');
  const movBox = document.getElementById('movementsListContainer');
  if (!kpiStrip || !prodBox || !supBox || !movBox) return;

  const query = (document.getElementById('invSearchInput')?.value || '').trim().toLowerCase();
  const products = STATE.products || [];
  const suppliers = STATE.suppliers || [];
  const movements = STATE.movements || [];

  const lowCount = products.filter((p) => Number(p.stock_qty) <= Number(p.min_stock_qty)).length;
  const stockValue = products.reduce((acc, p) => acc + Number(p.stock_qty || 0) * Number(p.cost_price || 0), 0);

  kpiStrip.innerHTML = `
    <div class="kpi-card"><span class="kpi-label">Prodotti a Catalogo</span><strong class="kpi-value">${products.length}</strong></div>
    <div class="kpi-card"><span class="kpi-label">Sotto Scorta Minima</span><strong class="kpi-value" style="color:${lowCount > 0 ? '#a12a2e' : 'var(--ink)'};">${lowCount}</strong></div>
    <div class="kpi-card"><span class="kpi-label">Valore Magazzino (Costo)</span><strong class="kpi-value">${stockValue.toFixed(0)} €</strong></div>
    <div class="kpi-card"><span class="kpi-label">Fornitori Attivi</span><strong class="kpi-value">${suppliers.length}</strong></div>
  `;

  const filtered = query
    ? products.filter(
        (p) =>
          (p.name || '').toLowerCase().includes(query) ||
          (p.sku || '').toLowerCase().includes(query) ||
          (p.category || '').toLowerCase().includes(query)
      )
    : products;

  if (filtered.length === 0) {
    prodBox.innerHTML = '<div style="padding:26px;text-align:center;color:var(--ink-soft);">Nessun prodotto registrato. Clicca <strong>+ Nuovo Prodotto</strong> per iniziare.</div>';
  } else {
    prodBox.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr><th>Prodotto</th><th>Categoria</th><th>Giacenza</th><th>Prezzi (Acq / Vend)</th><th>Fornitore</th><th>Azioni</th></tr>
        </thead>
        <tbody>
          ${filtered
            .map((p) => {
              const low = Number(p.stock_qty) <= Number(p.min_stock_qty);
              const badgeClass = low ? 'stock-low' : 'stock-ok';
              return `<tr>
                <td><strong>${escapeHtml(p.name)}</strong>${p.sku ? `<br /><span class="muted-text">SKU: ${escapeHtml(p.sku)}</span>` : ''}</td>
                <td>${escapeHtml(p.category === 'cabin' ? 'Cabina' : 'Rivendita')}</td>
                <td><span class="stock-badge ${badgeClass}">${Number(p.stock_qty)} ${escapeHtml(p.unit || 'pz')}</span><div class="muted-text" style="font-size:0.72rem;">Min: ${Number(p.min_stock_qty)}</div></td>
                <td>${Number(p.cost_price || 0).toFixed(2)} € / <strong>${Number(p.sell_price || 0).toFixed(2)} €</strong></td>
                <td>${escapeHtml(p.supplier_name || '—')}</td>
                <td>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button type="button" class="btn-outline-sm inv-mov-btn" data-id="${p.id}" data-type="sale">🛍️ Vendi</button>
                    <button type="button" class="btn-outline-sm inv-mov-btn" data-id="${p.id}" data-type="restock">📥 Carica</button>
                    <button type="button" class="btn-outline-sm inv-edit-prod-btn" data-id="${p.id}">Modifica</button>
                  </div>
                </td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    `;
    prodBox.querySelectorAll('.inv-mov-btn').forEach((btn) => {
      btn.addEventListener('click', () => openMovementModal(Number(btn.dataset.id), btn.dataset.type));
    });
    prodBox.querySelectorAll('.inv-edit-prod-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prod = products.find((p) => Number(p.id) === Number(btn.dataset.id));
        if (prod) openProductModal(prod);
      });
    });
  }

  supBox.innerHTML =
    suppliers.length === 0
      ? '<p class="muted-text">Nessun fornitore ancora salvato.</p>'
      : suppliers
          .map(
            (s) => `<div class="rec-item" style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;">
              <div><strong>${escapeHtml(s.name)}</strong><div class="muted-text">${escapeHtml(s.contact_name || '')} ${s.phone ? `• ${escapeHtml(s.phone)}` : ''} ${s.email ? `• ${escapeHtml(s.email)}` : ''}</div></div>
              <button type="button" class="btn-outline-sm inv-edit-sup-btn" data-id="${s.id}">Modifica</button>
            </div>`
          )
          .join('');
  supBox.querySelectorAll('.inv-edit-sup-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sup = suppliers.find((s) => Number(s.id) === Number(btn.dataset.id));
      if (sup) openSupplierModal(sup);
    });
  });

  const typeLabel = { sale: '🛍️ Vendita', restock: '📥 Carico', cabin_use: '🧴 Uso Cabina', adjustment: '⚖️ Rettifica' };
  movBox.innerHTML =
    movements.length === 0
      ? '<p class="muted-text">Nessun movimento registrato.</p>'
      : movements
          .slice(0, 20)
          .map(
            (m) => `<div class="rec-item" style="margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;">
                <strong>${typeLabel[m.movement_type] || escapeHtml(m.movement_type)} • ${escapeHtml(m.product_name || '')}</strong>
                <span>${m.quantity} pz${Number(m.total_amount) > 0 ? ` • ${Number(m.total_amount).toFixed(2)} €` : ''}</span>
              </div>
              <div class="muted-text" style="font-size:0.75rem;">${escapeHtml((m.created_at || '').slice(0, 16).replace('T', ' '))}${m.client_name ? ` • Cliente: ${escapeHtml(m.client_name)}` : ''}${m.notes ? ` • ${escapeHtml(m.notes)}` : ''}</div>
            </div>`
          )
          .join('');
}

function openProductModal(prod) {
  const modal = document.getElementById('productModal');
  const supSel = document.getElementById('prodSupplierSelect');
  if (supSel) {
    supSel.innerHTML = '<option value="">— Nessun fornitore —</option>';
    (STATE.suppliers || []).forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      supSel.appendChild(opt);
    });
  }
  document.getElementById('productModalTitle').textContent = prod ? 'Modifica Prodotto' : 'Nuovo Prodotto';
  document.getElementById('prodIdInput').value = prod ? prod.id : '';
  document.getElementById('prodNameInput').value = prod ? prod.name : '';
  document.getElementById('prodSkuInput').value = prod ? prod.sku || '' : '';
  document.getElementById('prodCategorySelect').value = prod ? prod.category || 'retail' : 'retail';
  if (supSel) supSel.value = prod && prod.supplier_id ? String(prod.supplier_id) : '';
  document.getElementById('prodUnitInput').value = prod ? prod.unit || 'pz' : 'pz';
  document.getElementById('prodCostInput').value = prod ? Number(prod.cost_price || 0) : 0;
  document.getElementById('prodSellInput').value = prod ? Number(prod.sell_price || 0) : 0;
  document.getElementById('prodStockInput').value = prod ? Number(prod.stock_qty || 0) : 0;
  document.getElementById('prodMinStockInput').value = prod ? Number(prod.min_stock_qty || 2) : 2;
  document.getElementById('deleteProductBtn').hidden = !prod;
  modal.classList.add('open');
}

function openSupplierModal(sup) {
  const modal = document.getElementById('supplierModal');
  document.getElementById('supplierModalTitle').textContent = sup ? 'Modifica Fornitore' : 'Nuovo Fornitore';
  document.getElementById('supIdInput').value = sup ? sup.id : '';
  document.getElementById('supNameInput').value = sup ? sup.name : '';
  document.getElementById('supContactInput').value = sup ? sup.contact_name || '' : '';
  document.getElementById('supPhoneInput').value = sup ? sup.phone || '' : '';
  document.getElementById('supEmailInput').value = sup ? sup.email || '' : '';
  document.getElementById('supNotesInput').value = sup ? sup.notes || '' : '';
  document.getElementById('deleteSupplierBtn').hidden = !sup;
  modal.classList.add('open');
}

function openMovementModal(productId, defaultType = 'sale') {
  const prod = (STATE.products || []).find((p) => Number(p.id) === Number(productId));
  if (!prod) return;
  const cliSel = document.getElementById('movClientSelect');
  if (cliSel) {
    cliSel.innerHTML = '<option value="">— Nessuna cliente (movimento interno) —</option>';
    (STATE.clients || []).forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.full_name} (${c.phone})`;
      cliSel.appendChild(opt);
    });
  }
  document.getElementById('movementModalTitle').textContent = `Movimento: ${prod.name} (giacenza ${prod.stock_qty})`;
  document.getElementById('movProductIdInput').value = prod.id;
  document.getElementById('movTypeSelect').value = defaultType;
  document.getElementById('movQtyInput').value = 1;
  document.getElementById('movUnitPriceInput').value = defaultType === 'restock' ? Number(prod.cost_price || 0) : Number(prod.sell_price || 0);
  document.getElementById('movNotesInput').value = '';
  document.getElementById('movementModal').classList.add('open');
}

/* ==========================================================================
   MESSAGE CENTER (TEMPLATE PERSONALIZZABILI & STORICO INVII)
   ========================================================================== */
function syncQuickMessagePreview() {
  const cliSel = document.getElementById('msgClientSelect');
  const tplSel = document.getElementById('msgTemplateSelect');
  const preview = document.getElementById('msgPreviewText');
  if (!cliSel || !tplSel || !preview) return;
  const client = STATE.clients.find((c) => Number(c.id) === Number(cliSel.value));
  preview.value = renderMessageTemplate(tplSel.value, {
    nome: client ? client.full_name : 'Cliente',
    data: toIsoDate(new Date()),
    ora: '10:00',
    servizi: 'Trattamento Beauty',
    giorni_assenza: '45',
    link: `${window.location.origin}/privacy-sign.html`,
    otp: '123456',
  });
}

function renderMessagesView() {
  const cliSel = document.getElementById('msgClientSelect');
  const tplSel = document.getElementById('msgTemplateSelect');
  const edList = document.getElementById('msgTemplatesEditorList');
  const logsBox = document.getElementById('messageLogsContainer');
  if (!cliSel || !tplSel || !edList || !logsBox) return;

  const prevCli = cliSel.value;
  cliSel.innerHTML = '';
  (STATE.clients || []).forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.full_name} (${c.phone})`;
    cliSel.appendChild(opt);
  });
  if (prevCli) cliSel.value = prevCli;

  const prevTpl = tplSel.value;
  tplSel.innerHTML = '';
  (STATE.messageTemplates || []).forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.code;
    opt.textContent = t.title;
    tplSel.appendChild(opt);
  });
  if (prevTpl) tplSel.value = prevTpl;
  syncQuickMessagePreview();

  edList.innerHTML = (STATE.messageTemplates || [])
    .map(
      (t) => `<form class="msg-tpl-editor-form rec-item" data-code="${escapeHtml(t.code)}" style="margin-bottom:10px;">
        <div class="admin-field" style="margin-bottom:6px;">
          <label>Titolo Template (${escapeHtml(t.code)})</label>
          <input type="text" class="tpl-title-input" value="${escapeHtml(t.title)}" required />
        </div>
        <div class="admin-field" style="margin-bottom:8px;">
          <label>Testo Messaggio (variabili: {nome}, {data}, {ora}, {servizi}, {giorni_assenza}, {link}, {otp})</label>
          <textarea rows="2" class="tpl-body-input" required>${escapeHtml(t.body_template)}</textarea>
        </div>
        <button type="submit" class="btn-outline-sm">💾 Salva Template</button>
      </form>`
    )
    .join('');

  edList.querySelectorAll('.msg-tpl-editor-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await apiFetch('admin/messages/templates', {
        method: 'POST',
        body: JSON.stringify({
          code: form.dataset.code,
          title: form.querySelector('.tpl-title-input').value.trim(),
          body_template: form.querySelector('.tpl-body-input').value.trim(),
        }),
      });
      await loadMessagesData();
      renderMessagesView();
    });
  });

  const logs = STATE.messageLogs || [];
  logsBox.innerHTML =
    logs.length === 0
      ? '<p class="muted-text">Nessun messaggio registrato nello storico invii.</p>'
      : logs
          .map(
            (l) => `<div class="rec-item" style="margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;font-size:0.84rem;">
                <strong>📲 ${escapeHtml(l.recipient_name || l.recipient_phone)}</strong>
                <span class="muted-text">${escapeHtml((l.sent_at || '').slice(0, 16).replace('T', ' '))}</span>
              </div>
              <div class="muted-text" style="margin-top:4px;font-size:0.82rem;">${escapeHtml(l.message_text)}</div>
            </div>`
          )
          .join('');
}

/* ==========================================================================
   SETTINGS: OPERATORI, ORARI SETTIMANALI, ASSENZE & UTENTI ADMIN
   ========================================================================== */
const DAY_NAMES_IT = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

function renderScheduleGrid(scheduleObj) {
  const grid = document.getElementById('opScheduleGrid');
  if (!grid) return;
  const order = ['1', '2', '3', '4', '5', '6', '0'];
  grid.innerHTML = order
    .map((day) => {
      const cfg = (scheduleObj && (scheduleObj[day] || scheduleObj[Number(day)])) || {
        enabled: day !== '0',
        start: '09:00',
        end: '19:30',
        break_start: '',
        break_end: '',
      };
      return `
        <div class="op-sched-row" data-day="${day}">
          <label class="op-sched-day"><input type="checkbox" class="op-sched-enabled" ${cfg.enabled ? 'checked' : ''} /> ${DAY_NAMES_IT[Number(day)]}</label>
          <input type="text" class="op-sched-start" value="${escapeHtml(cfg.start || '09:00')}" placeholder="09:00" />
          <input type="text" class="op-sched-end" value="${escapeHtml(cfg.end || '19:30')}" placeholder="19:30" />
          <input type="text" class="op-sched-bstart" value="${escapeHtml(cfg.break_start || '')}" placeholder="Pausa inizio" />
          <input type="text" class="op-sched-bend" value="${escapeHtml(cfg.break_end || '')}" placeholder="Pausa fine" />
        </div>
      `;
    })
    .join('');
}

function openOperatorModal(op) {
  const modal = document.getElementById('operatorModal');
  document.getElementById('operatorModalTitle').textContent = op ? `Operatore: ${op.name}` : 'Nuovo Operatore';
  document.getElementById('opIdInput').value = op ? op.id : '';
  document.getElementById('opNameInput').value = op ? op.name : '';
  document.getElementById('opRoleInput').value = op ? op.role || '' : 'Estetista / Beauty Specialist';
  document.getElementById('opColorInput').value = op ? op.color || '#b85675' : '#b85675';
  document.getElementById('opActiveCheck').checked = op ? Boolean(op.active) : true;
  document.getElementById('deleteOperatorBtn').hidden = !op;
  renderScheduleGrid(op ? op.weekly_schedule : null);
  modal.classList.add('open');
}

function renderSettingsView() {
  const opsBox = document.getElementById('operatorsListContainer');
  const absBox = document.getElementById('absencesListContainer');
  const usersBox = document.getElementById('adminUsersListContainer');

  if (opsBox) {
    opsBox.innerHTML =
      STATE.operators.length === 0
        ? '<p class="muted-text">Nessun operatore configurato.</p>'
        : STATE.operators
            .map(
              (op) => `<div class="rec-item" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div>
                  <span class="op-dot" style="background:${escapeHtml(op.color || '#b85675')}"></span>
                  <strong>${escapeHtml(op.name)}</strong> ${!op.active ? '<span class="muted-text">(Disattivo)</span>' : ''}
                  <div class="muted-text" style="font-size:0.78rem;">${escapeHtml(op.role || '')}</div>
                </div>
                <button type="button" class="btn-outline-sm edit-op-btn" data-id="${op.id}">Orari &amp; Modifica</button>
              </div>`
            )
            .join('');
    opsBox.querySelectorAll('.edit-op-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const op = STATE.operators.find((o) => Number(o.id) === Number(btn.dataset.id));
        if (op) openOperatorModal(op);
      });
    });
  }

  if (absBox) {
    absBox.innerHTML =
      STATE.absences.length === 0
        ? '<p class="muted-text">Nessuna assenza/ferie pianificata.</p>'
        : STATE.absences
            .map(
              (a) => `<div class="rec-item" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div>
                  <strong>${escapeHtml(a.operator_name || 'Operatore')}</strong> • <span style="text-transform:capitalize;">${escapeHtml(a.type)}</span>
                  <div class="muted-text" style="font-size:0.78rem;">${escapeHtml(a.start_date)} → ${escapeHtml(a.end_date)}${a.start_time ? ` (${escapeHtml(a.start_time)}-${escapeHtml(a.end_time)})` : ' (Tutto il giorno)'}${a.notes ? ` • ${escapeHtml(a.notes)}` : ''}</div>
                </div>
                <button type="button" class="btn-outline-sm del-abs-btn" data-id="${a.id}" style="color:#a12a2e;border-color:#e0b5b5;">Rimuovi</button>
              </div>`
            )
            .join('');
    absBox.querySelectorAll('.del-abs-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await apiFetch('admin/absences', { method: 'POST', body: JSON.stringify({ action: 'delete', id: Number(btn.dataset.id) }) });
        await refreshAllData();
        renderSettingsView();
      });
    });
  }

  if (usersBox) {
    usersBox.innerHTML = (STATE.adminUsers || [])
      .map(
        (u) => `<div class="rec-item" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <strong>${escapeHtml(u.display_name)}</strong> <span class="muted-text">(${escapeHtml(u.username)} • ${escapeHtml(u.role)})</span>
          </div>
          ${
            STATE.admin && Number(u.id) !== Number(STATE.admin.id)
              ? `<button type="button" class="btn-outline-sm del-user-btn" data-id="${u.id}" style="color:#a12a2e;border-color:#e0b5b5;">Elimina</button>`
              : '<span class="muted-text" style="font-size:0.76rem;">Sessione attiva</span>'
          }
        </div>`
      )
      .join('');
    usersBox.querySelectorAll('.del-user-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Eliminare questa utenza gestionale?')) return;
        await apiFetch('admin/users', { method: 'POST', body: JSON.stringify({ action: 'delete', id: Number(btn.dataset.id) }) });
        await loadAdminUsers();
        renderSettingsView();
      });
    });
  }
}
