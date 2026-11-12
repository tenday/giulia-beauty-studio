/**
 * GIULIA BEAUTY STUDIO — Analytics Engine & AI Studio Assistant
 * Generates grounded studio reports, inactive-client win-back segments,
 * treatment rankings, and conversational answers (local NLP + optional Gemini API).
 */

function parseIsoDateUtc(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function diffDaysUtc(laterIso, earlierIso) {
  const t1 = parseIsoDateUtc(laterIso);
  const t2 = parseIsoDateUtc(earlierIso);
  if (t1 === null || t2 === null) return null;
  return Math.round((t1 - t2) / (1000 * 60 * 60 * 24));
}

function addDaysIso(iso, delta) {
  const t = parseIsoDateUtc(iso);
  if (t === null) return iso;
  const dt = new Date(t + delta * 86400000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysUntilNextBirthday(birthDateIso, todayIso) {
  if (!birthDateIso || !/^\d{4}-\d{2}-\d{2}$/.test(String(birthDateIso))) return null;
  const [ty, tm, td] = todayIso.split('-').map(Number);
  const [, bm, bd] = String(birthDateIso).split('-').map(Number);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  let targetUtc = Date.UTC(ty, bm - 1, bd);
  if (targetUtc < todayUtc) {
    targetUtc = Date.UTC(ty + 1, bm - 1, bd);
  }
  return Math.round((targetUtc - todayUtc) / 86400000);
}

function getPrevYearMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function computeStudioInsights(clients, appointments, todayIso, inactiveThresholdDays = 30) {
  const tomorrowIso = addDaysIso(todayIso, 1);
  const currentMonth = todayIso.slice(0, 7);
  const prevMonth = getPrevYearMonth(currentMonth);
  const last30Cutoff = addDaysIso(todayIso, -30);

  const activeAppts = appointments.filter((a) => a.status !== 'cancelled');
  const cancelledCount = appointments.filter((a) => a.status === 'cancelled').length;
  const pendingCount = appointments.filter((a) => a.status === 'pending').length;
  const completedCount = appointments.filter((a) => a.status === 'completed').length;

  const monthAppts = activeAppts.filter((a) => String(a.appointment_date || '').startsWith(currentMonth));
  const prevMonthAppts = activeAppts.filter((a) => String(a.appointment_date || '').startsWith(prevMonth));
  const last30Appts = activeAppts.filter(
    (a) => a.appointment_date >= last30Cutoff && a.appointment_date <= todayIso
  );

  const monthRevenue = monthAppts.reduce((s, a) => s + Number(a.total_price || 0), 0);
  const prevMonthRevenue = prevMonthAppts.reduce((s, a) => s + Number(a.total_price || 0), 0);
  const last30Revenue = last30Appts.reduce((s, a) => s + Number(a.total_price || 0), 0);
  const totalRevenue = activeAppts.reduce((s, a) => s + Number(a.total_price || 0), 0);
  const avgTicket = activeAppts.length > 0 ? totalRevenue / activeAppts.length : 0;

  let revenueDeltaPct = null;
  if (prevMonthRevenue > 0) {
    revenueDeltaPct = Math.round(((monthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100);
  }

  // Services breakdown
  const serviceStatsMap = new Map();
  for (const appt of activeAppts) {
    let parsed = [];
    if (appt.services_json) {
      try {
        const arr = JSON.parse(appt.services_json);
        if (Array.isArray(arr)) parsed = arr;
      } catch {
        parsed = [];
      }
    }
    if (parsed.length > 0) {
      for (const svc of parsed) {
        const name = String(svc?.name || '').trim();
        if (!name) continue;
        const price = Number(svc?.price || 0);
        const cur = serviceStatsMap.get(name) || { name, count: 0, revenue: 0 };
        cur.count += 1;
        cur.revenue += price;
        serviceStatsMap.set(name, cur);
      }
    } else if (appt.services_summary) {
      const parts = String(appt.services_summary)
        .split('+')
        .map((s) => s.trim())
        .filter(Boolean);
      const splitPrice = parts.length > 0 ? Number(appt.total_price || 0) / parts.length : 0;
      for (const name of parts) {
        const cur = serviceStatsMap.get(name) || { name, count: 0, revenue: 0 };
        cur.count += 1;
        cur.revenue += splitPrice;
        serviceStatsMap.set(name, cur);
      }
    }
  }
  const topServices = Array.from(serviceStatsMap.values())
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
    .slice(0, 12)
    .map((s) => ({ ...s, revenue: Math.round(s.revenue * 100) / 100 }));

  // Per-client visit tracking & inactivity
  const apptsByClient = new Map();
  for (const a of activeAppts) {
    const cid = Number(a.client_id);
    if (!apptsByClient.has(cid)) apptsByClient.set(cid, []);
    apptsByClient.get(cid).push(a);
  }

  const inactiveAll = [];
  const neverVisited = [];
  const clientStats = [];
  let privacyAcceptedCount = 0;

  for (const c of clients) {
    if (Number(c.privacy_accepted) === 1) privacyAcceptedCount += 1;
    const cAppts = (apptsByClient.get(Number(c.id)) || []).slice().sort((a, b) =>
      a.appointment_date > b.appointment_date ? -1 : a.appointment_date < b.appointment_date ? 1 : 0
    );

    const pastOrTodayAppts = cAppts.filter((a) => a.appointment_date <= todayIso);
    const futureAppts = cAppts.filter((a) => a.appointment_date > todayIso);
    const lastPast = pastOrTodayAppts[0] || null;
    const spent = cAppts.reduce((s, a) => s + Number(a.total_price || 0), 0);

    clientStats.push({
      id: Number(c.id),
      full_name: c.full_name,
      phone: c.phone,
      visits_count: cAppts.length,
      total_spent: Math.round(spent * 100) / 100,
      last_visit: lastPast ? lastPast.appointment_date : c.last_visit || null,
    });

    if (pastOrTodayAppts.length === 0 && futureAppts.length === 0) {
      neverVisited.push({
        id: Number(c.id),
        full_name: c.full_name,
        phone: c.phone,
        created_at: c.created_at,
        preferences_notes: c.preferences_notes || '',
      });
    } else if (lastPast && futureAppts.length === 0) {
      const daysSince = diffDaysUtc(todayIso, lastPast.appointment_date);
      if (daysSince !== null && daysSince >= 30) {
        const bucket = daysSince >= 90 ? '90+' : daysSince >= 60 ? '60-89' : '30-59';
        inactiveAll.push({
          id: Number(c.id),
          full_name: c.full_name,
          phone: c.phone,
          last_visit: lastPast.appointment_date,
          days_since: daysSince,
          bucket,
          visits_count: cAppts.length,
          total_spent: Math.round(spent * 100) / 100,
          last_services: lastPast.services_summary || '',
          preferences_notes: c.preferences_notes || '',
          allergies_notes: c.allergies_notes || '',
        });
      }
    }
  }

  inactiveAll.sort((a, b) => b.days_since - a.days_since);

  const inactive30Plus = inactiveAll.length;
  const inactive60Plus = inactiveAll.filter((c) => c.days_since >= 60).length;
  const inactive90Plus = inactiveAll.filter((c) => c.days_since >= 90).length;
  const customThresholdClients = inactiveAll.filter((c) => c.days_since >= inactiveThresholdDays);

  const vipClients = clientStats
    .filter((c) => c.visits_count > 0)
    .sort((a, b) => b.total_spent - a.total_spent || b.visits_count - a.visits_count)
    .slice(0, 8);

  const upcomingBirthdays = clients
    .map((c) => ({
      id: Number(c.id),
      full_name: c.full_name,
      phone: c.phone,
      birth_date: c.birth_date,
      days_until: daysUntilNextBirthday(c.birth_date, todayIso),
    }))
    .filter((b) => b.days_until !== null && b.days_until <= 14)
    .sort((a, b) => a.days_until - b.days_until);

  const tomorrowAppts = activeAppts.filter((a) => a.appointment_date === tomorrowIso);
  const tomorrowUnsentCount = tomorrowAppts.filter((a) => !a.reminder_sent_at).length;

  // Smart recommendations
  const recommendations = [];
  if (tomorrowUnsentCount > 0) {
    recommendations.push({
      priority: 'alta',
      icon: '📲',
      text: `Hai ${tomorrowUnsentCount} promemoria WhatsApp da inviare per gli appuntamenti di domani.`,
    });
  }
  if (inactive60Plus > 0) {
    recommendations.push({
      priority: 'alta',
      icon: '💌',
      text: `${inactive60Plus} clienti non prenotano da oltre 60 giorni: inviagli un messaggio di ricontatto su WhatsApp.`,
    });
  } else if (inactive30Plus > 0) {
    recommendations.push({
      priority: 'media',
      icon: '💅',
      text: `${inactive30Plus} clienti non tornano da 30+ giorni (ritocco/laminazione consigliati).`,
    });
  }
  if (upcomingBirthdays.length > 0) {
    const todayBdays = upcomingBirthdays.filter((b) => b.days_until === 0);
    if (todayBdays.length > 0) {
      recommendations.push({
        priority: 'alta',
        icon: '🎂',
        text: `Oggi è il compleanno di ${todayBdays.map((b) => b.full_name).join(', ')}! Manda gli auguri su WhatsApp.`,
      });
    } else {
      recommendations.push({
        priority: 'info',
        icon: '🎂',
        text: `Ci sono ${upcomingBirthdays.length} compleanni nei prossimi 14 giorni.`,
      });
    }
  }
  if (pendingCount > 0) {
    recommendations.push({
      priority: 'media',
      icon: '⏳',
      text: `Hai ${pendingCount} prenotazioni in stato "In attesa di conferma".`,
    });
  }
  if (clients.length - privacyAcceptedCount > 0) {
    recommendations.push({
      priority: 'info',
      icon: '🛡️',
      text: `${clients.length - privacyAcceptedCount} clienti in anagrafica non hanno ancora la spunta consenso GDPR registrata.`,
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'ok',
      icon: '✨',
      text: 'Tutto sotto controllo: nessuna urgenza o cliente dormiente rilevata oggi.',
    });
  }

  return {
    generated_at: todayIso,
    current_month: currentMonth,
    prev_month: prevMonth,
    summary: {
      total_clients: clients.length,
      privacy_accepted_clients: privacyAcceptedCount,
      total_active_appointments: activeAppts.length,
      completed_appointments: completedCount,
      pending_appointments: pendingCount,
      cancelled_appointments: cancelledCount,
      month_appointments_count: monthAppts.length,
      month_revenue: Math.round(monthRevenue * 100) / 100,
      prev_month_revenue: Math.round(prevMonthRevenue * 100) / 100,
      revenue_delta_pct: revenueDeltaPct,
      last_30_revenue: Math.round(last30Revenue * 100) / 100,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      avg_ticket: Math.round(avgTicket * 100) / 100,
      inactive_30_plus: inactive30Plus,
      inactive_60_plus: inactive60Plus,
      inactive_90_plus: inactive90Plus,
      never_visited_count: neverVisited.length,
      tomorrow_appointments_count: tomorrowAppts.length,
      tomorrow_unsent_reminders: tomorrowUnsentCount,
      upcoming_birthdays_count: upcomingBirthdays.length,
    },
    inactive_threshold_days: inactiveThresholdDays,
    inactive_clients: customThresholdClients,
    inactive_all_30_plus: inactiveAll,
    never_visited_clients: neverVisited,
    vip_clients: vipClients,
    top_services: topServices,
    upcoming_birthdays: upcomingBirthdays,
    recommendations,
  };
}

function extractDaysFromItalianQuestion(qLower) {
  const daysMatch = qLower.match(/(\d+)\s*giorn/);
  if (daysMatch) return Math.max(7, Number.parseInt(daysMatch[1], 10));
  const monthsMatch = qLower.match(/(\d+)\s*mes[ei]/);
  if (monthsMatch) return Math.max(15, Number.parseInt(monthsMatch[1], 10) * 30);
  return 30;
}

function buildLocalAiReply(question, clients, appointments, todayIso) {
  const qLower = String(question || '').toLowerCase();
  const daysThreshold = extractDaysFromItalianQuestion(qLower);
  const insights = computeStudioInsights(clients, appointments, todayIso, daysThreshold);
  const s = insights.summary;

  const isInactiveQ =
    /non vengon|non tornan|sparit|inattiv|dormient|da un po|da quanto|ricontatt|richiam|assent/.test(qLower);
  const isReportQ =
    /report|riepilog|fatturat|incass|andamento|statistich|mese|guadagn|bilancio/.test(qLower);
  const isServicesQ = /trattament|serviz|più richiest|piu richiest|vanno di pi|popolar/.test(qLower);
  const isVipQ = /miglior|vip|fedel|spendon/.test(qLower);
  const isBirthdayQ = /compleann|augur/.test(qLower);
  const isTomorrowQ = /domani|promemoria|whatsapp/.test(qLower);

  const lines = [];

  if (isInactiveQ) {
    const matched = insights.inactive_clients;
    lines.push(`📊 **Analisi Clienti Inattive (soglia: ${daysThreshold}+ giorni senza visita):**`);
    lines.push(
      `• Oltre **30 giorni:** ${s.inactive_30_plus} clienti | Oltre **60 giorni:** ${s.inactive_60_plus} | Oltre **90 giorni:** ${s.inactive_90_plus} | Mai venute dopo registrazione: ${s.never_visited_count}.`
    );
    if (matched.length === 0) {
      lines.push(`\nNessuna cliente risulta inattiva da ${daysThreshold}+ giorni al momento! 🎉`);
    } else {
      lines.push(`\nEcco le clienti da ricontattare (${matched.length}):`);
      matched.slice(0, 12).forEach((c) => {
        lines.push(
          `• **${c.full_name}** (${c.phone}) — ultima visita **${c.last_visit}** (**${c.days_since} giorni fa**) • ultimo: *${c.last_services || 'n/d'}*`
        );
      });
      lines.push(
        `\n💡 *Suggerimento WhatsApp:* Usa il pulsante **"Richiama su WhatsApp"** nella tabella qui sotto per inviare un messaggio personalizzato in 1 clic.`
      );
    }
  } else if (isServicesQ) {
    lines.push('💅 **Classifica Trattamenti più richiesti:**');
    if (insights.top_services.length === 0) {
      lines.push('Non ci sono ancora abbastanza appuntamenti registrati per stilare una classifica.');
    } else {
      insights.top_services.slice(0, 8).forEach((svc, idx) => {
        lines.push(`${idx + 1}. **${svc.name}** — ${svc.count} volte (${svc.revenue.toFixed(0)} € generati)`);
      });
    }
  } else if (isVipQ) {
    lines.push('👑 **Migliori Clienti (VIP per spesa e frequenza):**');
    if (insights.vip_clients.length === 0) {
      lines.push('Nessuna cliente con appuntamenti registrati al momento.');
    } else {
      insights.vip_clients.forEach((c, idx) => {
        lines.push(`${idx + 1}. **${c.full_name}** — ${c.visits_count} visite • **${c.total_spent.toFixed(0)} €** totali`);
      });
    }
  } else if (isBirthdayQ) {
    lines.push('🎂 **Compleanni nei prossimi 14 giorni:**');
    if (insights.upcoming_birthdays.length === 0) {
      lines.push('Nessun compleanno registrato nei prossimi 14 giorni.');
    } else {
      insights.upcoming_birthdays.forEach((b) => {
        const when = b.days_until === 0 ? 'OGGI!' : b.days_until === 1 ? 'Domani' : `tra ${b.days_until} giorni`;
        lines.push(`• **${b.full_name}** (${b.birth_date}) — **${when}**`);
      });
    }
  } else if (isTomorrowQ && !isReportQ) {
    lines.push(
      `📲 **Situazione Domani:** ${s.tomorrow_appointments_count} appuntamenti in agenda (${s.tomorrow_unsent_reminders} promemoria WhatsApp ancora da inviare).`
    );
    lines.push(
      `\nEsempio testo pronto da copiare per richiamare le clienti assenti:\n*"Ciao [Nome] ♡ È un po' che non ci vediamo da Giulia Beauty Studio! Quando vuoi ritagliarti un momento per un ritocco o una coccola mani/ciglia, scrivimi pure qui. Ti aspetto!"*`
    );
  } else {
    // Full executive report
    const deltaLabel =
      s.revenue_delta_pct === null
        ? ''
        : ` (${s.revenue_delta_pct >= 0 ? '+' : ''}${s.revenue_delta_pct}% rispetto al mese scorso)`;
    lines.push(`✨ **Report Generale Studio (${insights.current_month}):**`);
    lines.push(`• **Clienti totali in database:** ${s.total_clients} (${s.privacy_accepted_clients} con consenso GDPR)`);
    lines.push(
      `• **Fatturato mese corrente:** ${s.month_revenue.toFixed(0)} € su ${s.month_appointments_count} appuntamenti${deltaLabel}`
    );
    lines.push(`• **Ticket medio:** ${s.avg_ticket.toFixed(0)} € | **Appuntamenti da confermare:** ${s.pending_appointments}`);
    lines.push(
      `• **Clienti che non tornano da 30+ giorni:** ${s.inactive_30_plus} (di cui ${s.inactive_60_plus} da oltre 60 giorni)`
    );
    lines.push(
      `• **Domani:** ${s.tomorrow_appointments_count} appuntamenti (${s.tomorrow_unsent_reminders} promemoria da inviare) • **Compleanni 14gg:** ${s.upcoming_birthdays_count}`
    );
    if (insights.top_services.length > 0) {
      lines.push(
        `\n🏆 **Top 3 Trattamenti:** ${insights.top_services
          .slice(0, 3)
          .map((t) => `${t.name} (${t.count})`)
          .join(', ')}`
      );
    }
  }

  return {
    engine: 'local-analytics-ai',
    answer: lines.join('\n'),
    insights,
  };
}

async function answerStudioQuestion(question, clients, appointments, todayIso) {
  const localResult = buildLocalAiReply(question, clients, appointments, todayIso);
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return localResult;
  }

  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const compactData = {
      summary: localResult.insights.summary,
      inactive_clients: localResult.insights.inactive_clients.slice(0, 20),
      never_visited_clients: localResult.insights.never_visited_clients.slice(0, 10),
      top_services: localResult.insights.top_services.slice(0, 10),
      vip_clients: localResult.insights.vip_clients,
      upcoming_birthdays: localResult.insights.upcoming_birthdays,
      recommendations: localResult.insights.recommendations,
    };

    const prompt = [
      "Sei l'Assistente AI manageriale di Giulia Beauty Studio (centro estetico Nails, Laminazione, Epilazione, Make Up a Verdellino BG).",
      'Rispondi in italiano chiaro, pratico e caloroso usando ESCLUSIVAMENTE i dati reali JSON forniti qui sotto (non inventare mai nomi, numeri o date).',
      'Se la titolare chiede un report, usa elenchi puntati leggibili con numeri chiave e suggerimenti pratici.',
      '',
      `DATI REALI STUDIO (${todayIso}):`,
      JSON.stringify(compactData),
      '',
      `DOMANDA DI GIULIA: ${question}`,
    ].join('\n');

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 900 },
        }),
      }
    );

    if (!res.ok) {
      return localResult;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return localResult;

    return {
      engine: `gemini (${model})`,
      answer: text.trim(),
      insights: localResult.insights,
    };
  } catch {
    return localResult;
  }
}

module.exports = {
  computeStudioInsights,
  answerStudioQuestion,
};
