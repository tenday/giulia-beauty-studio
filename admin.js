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
  appointments: [],
  tomorrowAppointments: [],
  clients: [],
  clientPickerMode: 'existing', // 'existing' | 'new'
  selectedCatalogIds: new Set(),
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

function buildTomorrowReminderUrl(appt) {
  const waNum = formatWaNumber(appt.client_phone);
  const dateLabel = formatShortItDate(appt.appointment_date);
  const msg = `Ciao ${appt.client_name} ♡ Ti ricordiamo il tuo appuntamento da *Giulia Beauty Studio* (Via Principe Amedeo 17, Verdellino) per domani *${dateLabel}* alle ore *${appt.start_time}* (${appt.services_summary}). Per qualsiasi variazione scrivici pure qui su WhatsApp. A domani!`;
  return `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
}

function buildBirthdayWishUrl(client) {
  const waNum = formatWaNumber(client.phone);
  const msg = `Tanti Auguri di Buon Compleanno ${client.full_name} ♡🎂 Da *Giulia Beauty Studio* ti auguriamo una giornata splendida! Ti aspettiamo presto in studio per coccolarti un po'!`;
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

  try {
    const data = await apiFetch('auth/me', { method: 'GET' });
    if (data.authenticated) {
      if (loginForm && !workspace) {
        window.location.replace('agenda.html');
        return;
      }
      STATE.admin = data.admin;
      document.getElementById('adminWelcomeLabel').textContent =
        `Ciao ${data.admin.display_name || 'Giulia'} • Agenda & Database Clienti`;
      if (checkingGate) checkingGate.hidden = true;
      if (workspace) workspace.hidden = false;
      await refreshAllData();
    } else if (workspace) {
      window.location.replace('admin.html');
    }
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
  }
}

async function refreshAllData() {
  await Promise.all([loadClients(), loadAppointments(), loadTomorrowReminders()]);
  updateKpis();
  renderSmartAssistBar();
  renderCalendar();
  renderClientsTable();
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
    html += `
      <div class="cal-day-header ${isToday ? 'is-today' : ''} ${isClosed ? 'is-closed' : ''}">
        <span class="cal-day-name">${DAYS_IT[dow]}</span>
        <span class="cal-day-num">${d.getDate()}</span>
        ${isClosed ? '<span class="cal-closed-tag">Chiuso</span>' : ''}
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
      html += `
        <div class="cal-event-card status-${escapeHtml(appt.status)}"
             data-appt-id="${appt.id}"
             style="top:${topPx}px; height:${heightPx}px;">
          <div class="cal-event-time">${escapeHtml(appt.start_time)} • ${Number(appt.total_price).toFixed(0)}€ ${appt.reminder_sent_at ? '📲' : ''}</div>
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
    const privacyDate = c.privacy_accepted_at ? String(c.privacy_accepted_at).slice(0, 10) : '';
    const hasAllergy = c.allergies_notes && c.allergies_notes.trim() !== '';
    const hasNotes = c.preferences_notes && c.preferences_notes.trim() !== '';
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

    rows += `
      <tr data-client-id="${c.id}" style="cursor: pointer;">
        <td>
          <strong>${escapeHtml(c.full_name)}</strong>
          ${hasAllergy ? '<span class="status-badge badge-allergy">⚠ Allergie</span>' : ''}
          ${hasNotes ? '<span class="status-badge" style="background:#f7eceb;color:var(--ink-soft);">📝 Note</span>' : ''}
          ${c.email ? `<br /><span style="font-size:0.74rem;color:var(--ink-muted);">${escapeHtml(c.email)}</span>` : ''}
          ${hasNotes ? `<br /><span style="font-size:0.73rem;color:var(--ink-muted);">${escapeHtml(c.preferences_notes.slice(0, 58))}${c.preferences_notes.length > 58 ? '…' : ''}</span>` : ''}
        </td>
        <td>${escapeHtml(c.phone)}</td>
        <td>${bdayHtml}</td>
        <td>${Number(c.appointments_count || 0)}</td>
        <td><strong>${Number(c.total_spent || 0).toFixed(0)} €</strong></td>
        <td>${c.last_visit ? escapeHtml(c.last_visit) : '—'}</td>
        <td>
          <span class="status-badge ${privacyOk ? 'badge-privacy-ok' : 'badge-privacy-no'}">
            ${privacyOk ? `✓ Accettata ${escapeHtml(privacyDate)}` : 'Da raccogliere'}
          </span>
        </td>
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

async function openClientModal(clientId = null) {
  const modal = document.getElementById('clientModal');
  const alertEl = document.getElementById('clientModalAlert');
  const historyGrid = document.getElementById('clientDossierHistory');
  const delBtn = document.getElementById('deleteClientGdprBtn');
  const exportBtn = document.getElementById('exportClientJsonBtn');
  const waBtn = document.getElementById('clientWhatsappBtn');

  alertEl.hidden = true;

  if (!clientId) {
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

    const apptsHtml = (data.appointments || []).length
      ? data.appointments
          .map(
            (a) => `<div class="history-row">
              <strong>${escapeHtml(a.appointment_date)} (${escapeHtml(a.start_time)})</strong> — ${Number(a.total_price).toFixed(0)} €
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

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await apiFetch('auth/logout', { method: 'POST' });
    window.location.href = 'admin.html';
  });

  // Main View Tabs
  document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.activeView = btn.dataset.view;
      document.getElementById('viewAgenda').hidden = STATE.activeView !== 'agenda';
      document.getElementById('viewClients').hidden = STATE.activeView !== 'clients';
      document.getElementById('viewSettings').hidden = STATE.activeView !== 'settings';
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
    const payload = {
      action: id ? 'update' : 'create',
      id: id ? Number(id) : undefined,
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
});
