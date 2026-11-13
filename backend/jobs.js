/**
 * GIULIA BEAUTY STUDIO — Unified WhatsApp Dispatcher & Automated Job Engine
 */
const { getRomeNowParts, formatRomeNow } = require('./helpers');
const { computeStudioInsights } = require('./analytics');
const {
  normalizeWhatsAppPhone,
  renderTemplateText,
  getOrderedTemplateParams,
  buildWaMeFallbackUrl,
  resolveWhatsAppConfig,
  sendWhatsAppCloudMessage,
} = require('./whatsapp');

let activeSuitePromise = null;
let schedulerTimer = null;

function addDaysIso(isoStr, deltaDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoStr || ''))) return isoStr;
  const [y, m, d] = isoStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(deltaDays || 0)));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatShortItDate(isoStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoStr || ''))) return String(isoStr || '');
  const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  const [, m, d] = isoStr.split('-').map(Number);
  return `${d} ${months[m - 1] || m}`;
}

async function loadWhatsAppRuntimeConfig(store) {
  const stored = (await store.getStudioSetting('whatsapp_automation')) || {};
  return resolveWhatsAppConfig(stored);
}

async function dispatchWhatsAppMessage({
  store,
  toPhone,
  recipientName = '',
  clientId = null,
  appointmentId = null,
  templateCode = null,
  vars = {},
  customText = '',
  adminId = null,
  triggerSource = 'manual',
  allowFallback = true,
  configOverride = null,
}) {
  const [config, templates] = await Promise.all([
    configOverride ? Promise.resolve(configOverride) : loadWhatsAppRuntimeConfig(store),
    store.listMessageTemplates(),
  ]);

  const tplRecord = templateCode
    ? templates.find((t) => t.code === templateCode) || null
    : null;

  const messageText = String(customText || '').trim()
    ? String(customText).trim()
    : renderTemplateText(tplRecord?.body_template || '', vars);

  if (!messageText) {
    return {
      ok: false,
      sent: false,
      sent_via: 'empty_message',
      error: 'Testo del messaggio vuoto o template non trovato.',
      log: null,
      fallback_url: null,
    };
  }

  const normalized = normalizeWhatsAppPhone(toPhone);
  const displayPhone = normalized.e164 || String(toPhone || '').trim();

  if (config.isActive) {
    const orderedParams = getOrderedTemplateParams(templateCode, vars);
    const cloudRes = await sendWhatsAppCloudMessage({
      config,
      toPhone: displayPhone,
      messageText,
      metaTemplateName: tplRecord?.meta_template_name || '',
      metaTemplateLang: tplRecord?.meta_template_lang || 'it',
      orderedParams,
    });

    const log = await store.createMessageLog({
      clientId,
      appointmentId,
      recipientPhone: displayPhone,
      recipientName: recipientName || null,
      channel: 'whatsapp',
      templateCode: templateCode || null,
      messageText,
      adminId,
      status: cloudRes.sent ? 'sent' : 'failed',
      externalMessageId: cloudRes.externalMessageId,
      errorMessage: cloudRes.error,
      triggerSource,
      metaPayloadType: cloudRes.payloadType,
    });

    if (cloudRes.sent && appointmentId && templateCode === 'reminder_tomorrow') {
      await store.markAppointmentReminder(appointmentId, false);
    }

    const canOfferFallback = Boolean(!cloudRes.sent && allowFallback && config.fallback_to_wa_me);
    return {
      ok: cloudRes.sent,
      sent: cloudRes.sent,
      sent_via: cloudRes.sent ? 'cloud_api' : 'cloud_api_failed',
      external_message_id: cloudRes.externalMessageId,
      error: cloudRes.error,
      log,
      fallback_url: canOfferFallback ? buildWaMeFallbackUrl(displayPhone, messageText) : null,
      warning: cloudRes.sent
        ? null
        : canOfferFallback
          ? `Invio Cloud API non riuscito (${cloudRes.error}). Usa il fallback wa.me.`
          : cloudRes.error,
    };
  }

  if (allowFallback && config.fallback_to_wa_me) {
    const fallbackUrl = buildWaMeFallbackUrl(displayPhone, messageText);
    const log = await store.createMessageLog({
      clientId,
      appointmentId,
      recipientPhone: displayPhone,
      recipientName: recipientName || null,
      channel: 'whatsapp',
      templateCode: templateCode || null,
      messageText,
      adminId,
      status: 'fallback_wa_me',
      externalMessageId: null,
      errorMessage: null,
      triggerSource,
      metaPayloadType: 'wa_me',
    });

    if (appointmentId && templateCode === 'reminder_tomorrow') {
      await store.markAppointmentReminder(appointmentId, false);
    }

    return {
      ok: true,
      sent: false,
      sent_via: 'fallback_wa_me',
      external_message_id: null,
      error: null,
      log,
      fallback_url: fallbackUrl,
      warning: config.isConfigured
        ? 'WhatsApp Business Cloud API disattivata nelle impostazioni: aperto link wa.me manuale.'
        : 'Credenziali Meta WhatsApp Business non ancora configurate: aperto link wa.me manuale.',
    };
  }

  return {
    ok: false,
    sent: false,
    sent_via: 'skipped_unconfigured',
    external_message_id: null,
    error: config.isConfigured
      ? 'WhatsApp Business Cloud API disattivata nelle impostazioni.'
      : 'Credenziali Meta WhatsApp Business API non ancora configurate.',
    log: null,
    fallback_url: null,
  };
}

async function runTrackedJob(store, { jobName, todayIso, triggerMode, workFn }) {
  const startedAt = formatRomeNow();
  const counters = { processed: 0, sent: 0, failed: 0, skipped: 0, details: [] };
  let status = 'completed';
  let summaryText = '';

  try {
    await workFn(counters);
    summaryText = `Elaborati ${counters.processed}: ${counters.sent} inviati, ${counters.failed} errori, ${counters.skipped} saltati.`;
  } catch (err) {
    status = 'failed';
    summaryText = String(err?.message || 'Errore esecuzione job').slice(0, 480);
  }

  const runRecord = await store.recordAutomationRun({
    jobName,
    runDate: todayIso,
    triggerMode,
    status,
    processedCount: counters.processed,
    sentCount: counters.sent,
    failedCount: counters.failed,
    skippedCount: counters.skipped,
    summaryText,
    startedAt,
    finishedAt: formatRomeNow(),
  });

  return {
    job_name: jobName,
    status,
    ...counters,
    summary_text: summaryText,
    run: runRecord,
  };
}

async function runReminderTomorrowJob({ store, config, todayIso, triggerMode }) {
  const tomorrowIso = addDaysIso(todayIso, 1);
  return runTrackedJob(store, {
    jobName: 'reminder_tomorrow',
    todayIso,
    triggerMode,
    workFn: async (counters) => {
      const appts = await store.listAppointments({
        startDate: tomorrowIso,
        endDate: tomorrowIso,
        status: '',
        clientId: 0,
      });

      const candidates = appts.filter((a) => a.status !== 'cancelled' && !a.reminder_sent_at);
      for (const appt of candidates) {
        counters.processed += 1;
        const phoneInfo = normalizeWhatsAppPhone(appt.client_phone);
        if (!phoneInfo.waId) {
          counters.skipped += 1;
          counters.details.push({ id: appt.id, name: appt.client_name, outcome: 'skipped_invalid_phone' });
          continue;
        }

        const alreadyLogged = await store.hasRecentMessageLog({
          appointmentId: appt.id,
          templateCode: 'reminder_tomorrow',
          withinDays: 2,
          statuses: ['sent'],
        });
        if (alreadyLogged) {
          counters.skipped += 1;
          counters.details.push({ id: appt.id, name: appt.client_name, outcome: 'skipped_duplicate' });
          continue;
        }

        const res = await dispatchWhatsAppMessage({
          store,
          configOverride: config,
          toPhone: appt.client_phone,
          recipientName: appt.client_name,
          clientId: appt.client_id || null,
          appointmentId: appt.id,
          templateCode: 'reminder_tomorrow',
          vars: {
            nome: appt.client_name,
            data: formatShortItDate(appt.appointment_date),
            ora: appt.start_time,
            trattamenti: appt.services_summary,
            servizi: appt.services_summary,
            operatore: appt.operator_name || 'Giulia',
          },
          triggerSource: 'job_reminder',
          allowFallback: false,
        });

        if (res.sent) {
          counters.sent += 1;
          counters.details.push({ id: appt.id, name: appt.client_name, outcome: 'sent' });
        } else {
          counters.failed += 1;
          counters.details.push({ id: appt.id, name: appt.client_name, outcome: 'failed', error: res.error });
        }
      }
    },
  });
}

async function runBirthdayWishesJob({ store, config, todayIso, triggerMode }) {
  const todayMmDd = todayIso.slice(5, 10);
  const yearStart = `${todayIso.slice(0, 4)}-01-01`;

  return runTrackedJob(store, {
    jobName: 'birthday_wishes',
    todayIso,
    triggerMode,
    workFn: async (counters) => {
      const clients = await store.listClients('');
      const birthdayClients = clients.filter(
        (c) => /^\d{4}-\d{2}-\d{2}$/.test(String(c.birth_date || '')) && String(c.birth_date).slice(5, 10) === todayMmDd
      );

      for (const client of birthdayClients) {
        counters.processed += 1;
        const phoneInfo = normalizeWhatsAppPhone(client.phone);
        if (!phoneInfo.waId) {
          counters.skipped += 1;
          counters.details.push({ id: client.id, name: client.full_name, outcome: 'skipped_invalid_phone' });
          continue;
        }

        const alreadySentThisYear = await store.hasRecentMessageLog({
          clientId: client.id,
          templateCode: 'birthday_wishes',
          sinceDate: yearStart,
          statuses: ['sent'],
        });
        if (alreadySentThisYear) {
          counters.skipped += 1;
          counters.details.push({ id: client.id, name: client.full_name, outcome: 'skipped_already_sent' });
          continue;
        }

        const res = await dispatchWhatsAppMessage({
          store,
          configOverride: config,
          toPhone: client.phone,
          recipientName: client.full_name,
          clientId: client.id,
          templateCode: 'birthday_wishes',
          vars: { nome: client.full_name },
          triggerSource: 'job_birthday',
          allowFallback: false,
        });

        if (res.sent) {
          counters.sent += 1;
          counters.details.push({ id: client.id, name: client.full_name, outcome: 'sent' });
        } else {
          counters.failed += 1;
          counters.details.push({ id: client.id, name: client.full_name, outcome: 'failed', error: res.error });
        }
      }
    },
  });
}

async function runWinbackInactiveJob({ store, config, todayIso, triggerMode }) {
  return runTrackedJob(store, {
    jobName: 'winback_inactive',
    todayIso,
    triggerMode,
    workFn: async (counters) => {
      const [clients, appointments] = await Promise.all([
        store.listClients(''),
        store.listAppointments({ startDate: '', endDate: '', status: '', clientId: 0 }),
      ]);

      const insights = computeStudioInsights(
        clients,
        appointments,
        todayIso,
        config.winback_inactive_days
      );
      const candidates = (insights.inactive_clients || []).slice(0, config.winback_max_per_run);

      for (const client of candidates) {
        counters.processed += 1;
        const phoneInfo = normalizeWhatsAppPhone(client.phone);
        if (!phoneInfo.waId) {
          counters.skipped += 1;
          counters.details.push({ id: client.id, name: client.full_name, outcome: 'skipped_invalid_phone' });
          continue;
        }

        const recentlyContacted = await store.hasRecentMessageLog({
          clientId: client.id,
          templateCode: 'winback_inactive',
          withinDays: config.winback_cooldown_days,
          statuses: ['sent'],
        });
        if (recentlyContacted) {
          counters.skipped += 1;
          counters.details.push({ id: client.id, name: client.full_name, outcome: 'skipped_cooldown' });
          continue;
        }

        const res = await dispatchWhatsAppMessage({
          store,
          configOverride: config,
          toPhone: client.phone,
          recipientName: client.full_name,
          clientId: client.id,
          templateCode: 'winback_inactive',
          vars: {
            nome: client.full_name,
            giorni_assenza: client.days_since,
          },
          triggerSource: 'job_winback',
          allowFallback: false,
        });

        if (res.sent) {
          counters.sent += 1;
          counters.details.push({ id: client.id, name: client.full_name, outcome: 'sent' });
        } else {
          counters.failed += 1;
          counters.details.push({ id: client.id, name: client.full_name, outcome: 'failed', error: res.error });
        }
      }
    },
  });
}

async function runAutomationSuite({
  store,
  reason = 'scheduler',
  onlyJob = '',
  force = false,
  nowPartsOverride = null,
}) {
  if (activeSuitePromise) {
    return activeSuitePromise;
  }

  activeSuitePromise = (async () => {
    const config = await loadWhatsAppRuntimeConfig(store);
    const nowParts = nowPartsOverride || getRomeNowParts(0);
    const todayIso = nowParts.date;
    const romeHour = Number(String(nowParts.datetime || '').slice(11, 13)) || 0;

    if (!config.isActive) {
      return {
        ok: true,
        active: false,
        configured: config.isConfigured,
        today: todayIso,
        rome_hour: romeHour,
        skipped_reason: config.isConfigured ? 'whatsapp_disabled' : 'whatsapp_unconfigured',
        message: config.isConfigured
          ? 'WhatsApp Business Cloud API disattivata nelle impostazioni.'
          : 'Inserisci Phone Number ID e Access Token Meta nelle impostazioni per attivare i job automatici.',
        results: [],
      };
    }

    const jobs = [
      {
        name: 'reminder_tomorrow',
        enabled: config.auto_reminder_tomorrow,
        hour: config.reminder_send_hour,
        fn: runReminderTomorrowJob,
      },
      {
        name: 'birthday_wishes',
        enabled: config.auto_birthday_wishes,
        hour: config.birthday_send_hour,
        fn: runBirthdayWishesJob,
      },
      {
        name: 'winback_inactive',
        enabled: config.auto_winback_inactive,
        hour: config.winback_send_hour,
        fn: runWinbackInactiveJob,
      },
    ];

    const selectedJobs = onlyJob
      ? jobs.filter((j) => j.name === onlyJob)
      : jobs;

    const results = [];
    for (const job of selectedJobs) {
      const isManual = reason === 'manual';
      if (!job.enabled && !isManual && !force) {
        results.push({ job_name: job.name, status: 'skipped_disabled', sent: 0, failed: 0, processed: 0 });
        continue;
      }

      if (!isManual && !force) {
        if (romeHour < job.hour) {
          results.push({
            job_name: job.name,
            status: 'waiting_hour_window',
            scheduled_hour: job.hour,
            sent: 0,
            failed: 0,
            processed: 0,
          });
          continue;
        }
        const alreadyRanToday = await store.hasAutomationRunForDate(job.name, todayIso);
        if (alreadyRanToday) {
          results.push({ job_name: job.name, status: 'already_ran_today', sent: 0, failed: 0, processed: 0 });
          continue;
        }
      }

      const res = await job.fn({ store, config, todayIso, triggerMode: reason });
      results.push(res);
    }

    return {
      ok: true,
      active: true,
      configured: true,
      today: todayIso,
      rome_hour: romeHour,
      results,
    };
  })();

  try {
    return await activeSuitePromise;
  } finally {
    activeSuitePromise = null;
  }
}

function startAutomationScheduler({ getStore, intervalMs = 15 * 60 * 1000 }) {
  if (schedulerTimer) return schedulerTimer;

  const tick = async () => {
    try {
      const store = getStore();
      if (!store) return;
      await runAutomationSuite({ store, reason: 'scheduler', force: false });
    } catch (err) {
      console.error('[Giulia Beauty Studio] Scheduler WhatsApp error:', err?.message || err);
    }
  };

  const bootDelay = setTimeout(() => {
    tick();
  }, 25000);
  if (typeof bootDelay.unref === 'function') bootDelay.unref();

  schedulerTimer = setInterval(tick, intervalMs);
  if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref();
  return schedulerTimer;
}

module.exports = {
  addDaysIso,
  formatShortItDate,
  loadWhatsAppRuntimeConfig,
  dispatchWhatsAppMessage,
  runAutomationSuite,
  startAutomationScheduler,
};
