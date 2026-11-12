/**
 * GIULIA BEAUTY STUDIO — Analytics Engine & AI Studio Assistant
 * Generates grounded studio reports: inactive client win-back, operator performance,
 * client LTV, cross-selling, inventory reorder forecasts & conversational AI (Local NLP + Gemini).
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

function computeStudioInsights(clients, appointments, todayIso, inactiveThresholdDays = 30, extra = {}) {
  const operators = Array.isArray(extra.operators) ? extra.operators : [];
  const products = Array.isArray(extra.products) ? extra.products : [];
  const movements = Array.isArray(extra.movements) ? extra.movements : [];
  const cards = Array.isArray(extra.cards) ? extra.cards : [];
  const currentPrivacyVersion = extra.privacyVersion || process.env.PRIVACY_VERSION || 'v2.0-2026-11';

  const tomorrowIso = addDaysIso(todayIso, 1);
  const currentMonth = todayIso.slice(0, 7);
  const prevMonth = getPrevYearMonth(currentMonth);
  const last30Cutoff = addDaysIso(todayIso, -30);
  const last60Cutoff = addDaysIso(todayIso, -60);

  const activeAppts = appointments.filter((a) => a.status !== 'cancelled');
  const cancelledCount = appointments.filter((a) => a.status === 'cancelled').length;
  const pendingCount = appointments.filter((a) => a.status === 'pending').length;
  const completedCount = appointments.filter((a) => a.status === 'completed').length;

  const monthAppts = activeAppts.filter((a) => String(a.appointment_date || '').startsWith(currentMonth));
  const prevMonthAppts = activeAppts.filter((a) => String(a.appointment_date || '').startsWith(prevMonth));
  const last30Appts = activeAppts.filter(
    (a) => a.appointment_date >= last30Cutoff && a.appointment_date <= todayIso
  );

  const serviceMonthRevenue = monthAppts.reduce((s, a) => s + Number(a.total_price || 0), 0);
  const servicePrevMonthRevenue = prevMonthAppts.reduce((s, a) => s + Number(a.total_price || 0), 0);
  const last30Revenue = last30Appts.reduce((s, a) => s + Number(a.total_price || 0), 0);
  const totalServiceRevenue = activeAppts.reduce((s, a) => s + Number(a.total_price || 0), 0);

  // Retail product sales revenue
  const retailSales = movements.filter((m) => m.movement_type === 'sale');
  const retailMonthRevenue = retailSales
    .filter((m) => String(m.created_at || '').slice(0, 7) === currentMonth)
    .reduce((s, m) => s + Number(m.total_amount || 0), 0);
  const retailPrevMonthRevenue = retailSales
    .filter((m) => String(m.created_at || '').slice(0, 7) === prevMonth)
    .reduce((s, m) => s + Number(m.total_amount || 0), 0);
  const totalRetailRevenue = retailSales.reduce((s, m) => s + Number(m.total_amount || 0), 0);

  const monthRevenue = serviceMonthRevenue + retailMonthRevenue;
  const prevMonthRevenue = servicePrevMonthRevenue + retailPrevMonthRevenue;
  const totalRevenue = totalServiceRevenue + totalRetailRevenue;
  const avgTicket = activeAppts.length > 0 ? totalServiceRevenue / activeAppts.length : 0;

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

  // Operator performance breakdown
  const primaryOp = operators[0] || { id: 1, name: 'Giulia', color: '#d47491' };
  const opStatsMap = new Map();
  for (const op of operators) {
    opStatsMap.set(Number(op.id), {
      operator_id: Number(op.id),
      name: op.name,
      color: op.color || '#d47491',
      active: Number(op.active) !== 0,
      appointments_count: 0,
      month_appointments_count: 0,
      total_minutes: 0,
      revenue: 0,
      month_revenue: 0,
    });
  }
  for (const a of activeAppts) {
    const opId = Number(a.operator_id || primaryOp.id || 1);
    if (!opStatsMap.has(opId)) {
      opStatsMap.set(opId, {
        operator_id: opId,
        name: a.operator_name || primaryOp.name || 'Operatore',
        color: a.operator_color || '#d47491',
        active: true,
        appointments_count: 0,
        month_appointments_count: 0,
        total_minutes: 0,
        revenue: 0,
        month_revenue: 0,
      });
    }
    const stat = opStatsMap.get(opId);
    const price = Number(a.total_price || 0);
    stat.appointments_count += 1;
    stat.total_minutes += Number(a.duration_minutes || 60);
    stat.revenue += price;
    if (String(a.appointment_date || '').startsWith(currentMonth)) {
      stat.month_appointments_count += 1;
      stat.month_revenue += price;
    }
  }
  const operatorStats = Array.from(opStatsMap.values())
    .map((o) => ({
      ...o,
      hours: Math.round((o.total_minutes / 60) * 10) / 10,
      revenue: Math.round(o.revenue * 100) / 100,
      month_revenue: Math.round(o.month_revenue * 100) / 100,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.appointments_count - a.appointments_count);

  // Per-client visit tracking, LTV & inactivity
  const apptsByClient = new Map();
  for (const a of activeAppts) {
    const cid = Number(a.client_id);
    if (!apptsByClient.has(cid)) apptsByClient.set(cid, []);
    apptsByClient.get(cid).push(a);
  }
  const retailByClient = new Map();
  for (const m of retailSales) {
    const cid = Number(m.client_id || 0);
    if (cid > 0) {
      retailByClient.set(cid, (retailByClient.get(cid) || 0) + Number(m.total_amount || 0));
    }
  }

  const inactiveAll = [];
  const neverVisited = [];
  const clientStats = [];
  let privacyAcceptedCount = 0;
  let privacyNeedsRefreshCount = 0;

  for (const c of clients) {
    const accepted = Number(c.privacy_accepted) === 1;
    if (accepted) {
      privacyAcceptedCount += 1;
      if (c.privacy_version && c.privacy_version !== currentPrivacyVersion) {
        privacyNeedsRefreshCount += 1;
      }
    }
    const cAppts = (apptsByClient.get(Number(c.id)) || []).slice().sort((a, b) =>
      a.appointment_date > b.appointment_date ? -1 : a.appointment_date < b.appointment_date ? 1 : 0
    );

    const pastOrTodayAppts = cAppts.filter((a) => a.appointment_date <= todayIso);
    const futureAppts = cAppts.filter((a) => a.appointment_date > todayIso);
    const lastPast = pastOrTodayAppts[0] || null;
    const serviceSpent = cAppts.reduce((s, a) => s + Number(a.total_price || 0), 0);
    const productSpent = retailByClient.get(Number(c.id)) || 0;
    const ltv = serviceSpent + productSpent;

    clientStats.push({
      id: Number(c.id),
      full_name: c.full_name,
      phone: c.phone,
      visits_count: cAppts.length,
      service_spent: Math.round(serviceSpent * 100) / 100,
      product_spent: Math.round(productSpent * 100) / 100,
      total_spent: Math.round(ltv * 100) / 100,
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
          total_spent: Math.round(ltv * 100) / 100,
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
    .filter((c) => c.visits_count > 0 || c.product_spent > 0)
    .sort((a, b) => b.total_spent - a.total_spent || b.visits_count - a.visits_count)
    .slice(0, 8);

  const avgClientLtv =
    clientStats.length > 0
      ? Math.round((clientStats.reduce((s, c) => s + c.total_spent, 0) / clientStats.length) * 100) / 100
      : 0;

  // Cross-selling & inventory reorder forecasts
  const crossClients = new Set(retailSales.map((m) => Number(m.client_id || 0)).filter((id) => id > 0));
  const clientsWithCrossSell = Array.from(crossClients).filter((cid) => (apptsByClient.get(cid) || []).length > 0);
  const crossSellPct =
    clients.length > 0 ? Math.round((clientsWithCrossSell.length / clients.length) * 100) : 0;

  const prodConsumed60Map = new Map();
  const prodSoldTotalMap = new Map();
  const pairingMap = new Map();

  for (const m of movements) {
    const pid = Number(m.product_id);
    const qtyAbs = Math.abs(Number(m.quantity || 0));
    const datePart = String(m.created_at || '').slice(0, 10);
    if ((m.movement_type === 'sale' || m.movement_type === 'cabin_use') && datePart >= last60Cutoff) {
      prodConsumed60Map.set(pid, (prodConsumed60Map.get(pid) || 0) + qtyAbs);
    }
    if (m.movement_type === 'sale') {
      const cur = prodSoldTotalMap.get(pid) || { qty: 0, revenue: 0 };
      cur.qty += qtyAbs;
      cur.revenue += Number(m.total_amount || 0);
      prodSoldTotalMap.set(pid, cur);

      if (m.client_id && m.product_name) {
        const cAppts = apptsByClient.get(Number(m.client_id)) || [];
        const latestSvc = cAppts[0]?.services_summary;
        if (latestSvc) {
          const key = `${latestSvc} ➔ ${m.product_name}`;
          pairingMap.set(key, (pairingMap.get(key) || 0) + 1);
        }
      }
    }
  }

  const lowStockProducts = products
    .filter((p) => Number(p.active) !== 0 && Number(p.stock_qty) <= Number(p.min_stock_qty || 0))
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      stock_qty: Number(p.stock_qty),
      min_stock_qty: Number(p.min_stock_qty || 0),
      supplier_name: p.supplier_name || 'Nessun fornitore',
    }));

  const reorderForecasts = products
    .filter((p) => Number(p.active) !== 0)
    .map((p) => {
      const stock = Number(p.stock_qty || 0);
      const minStock = Number(p.min_stock_qty || 2);
      const consumed60 = prodConsumed60Map.get(Number(p.id)) || 0;
      const dailyRate = consumed60 / 60;
      const daysLeft = dailyRate > 0 ? Math.round(stock / dailyRate) : stock <= minStock ? 0 : null;
      const needsReorder = stock <= minStock || (daysLeft !== null && daysLeft <= 21);
      const suggestedOrderQty = Math.max(
        minStock * 2 - stock,
        Math.ceil(dailyRate * 45) - stock,
        stock <= minStock ? 3 : 0
      );
      return {
        id: p.id,
        name: p.name,
        supplier_name: p.supplier_name || 'Da assegnare',
        stock_qty: stock,
        min_stock_qty: minStock,
        consumed_60d: consumed60,
        days_left: daysLeft,
        needs_reorder: needsReorder,
        suggested_order_qty: needsReorder ? Math.max(1, suggestedOrderQty) : 0,
      };
    })
    .filter((r) => r.needs_reorder || r.consumed_60d > 0)
    .sort((a, b) => Number(b.needs_reorder) - Number(a.needs_reorder) || (a.days_left ?? 999) - (b.days_left ?? 999))
    .slice(0, 12);

  const topProducts = products
    .map((p) => {
      const sold = prodSoldTotalMap.get(Number(p.id)) || { qty: 0, revenue: 0 };
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        sold_qty: sold.qty,
        revenue: Math.round(sold.revenue * 100) / 100,
        stock_qty: Number(p.stock_qty || 0),
      };
    })
    .filter((p) => p.sold_qty > 0)
    .sort((a, b) => b.sold_qty - a.sold_qty || b.revenue - a.revenue)
    .slice(0, 8);

  const topPairings = Array.from(pairingMap.entries())
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

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

  const inventoryValue = products.reduce(
    (s, p) => s + Number(p.cost_price || 0) * Math.max(0, Number(p.stock_qty || 0)),
    0
  );
  const activeCardsCount = cards.filter((c) => c.status === 'active').length;

  // Smart recommendations
  const recommendations = [];
  if (tomorrowUnsentCount > 0) {
    recommendations.push({
      priority: 'alta',
      icon: '📲',
      text: `Hai ${tomorrowUnsentCount} promemoria WhatsApp da inviare per gli appuntamenti di domani.`,
    });
  }
  if (lowStockProducts.length > 0) {
    recommendations.push({
      priority: 'alta',
      icon: '📦',
      text: `${lowStockProducts.length} prodotti in magazzino sono sottoscorta (${lowStockProducts
        .slice(0, 3)
        .map((p) => p.name)
        .join(', ')}): controlla le previsioni di riordino.`,
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
  if (clients.length - privacyAcceptedCount > 0 || privacyNeedsRefreshCount > 0) {
    recommendations.push({
      priority: 'info',
      icon: '🛡️',
      text: `${clients.length - privacyAcceptedCount} clienti senza firma GDPR e ${privacyNeedsRefreshCount} da aggiornare alla versione ${currentPrivacyVersion}.`,
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'ok',
      icon: '✨',
      text: 'Tutto sotto controllo: nessuna urgenza, scorta critica o cliente dormiente rilevata oggi.',
    });
  }

  return {
    generated_at: todayIso,
    current_month: currentMonth,
    prev_month: prevMonth,
    summary: {
      total_clients: clients.length,
      privacy_accepted_clients: privacyAcceptedCount,
      privacy_needs_refresh_clients: privacyNeedsRefreshCount,
      total_active_appointments: activeAppts.length,
      completed_appointments: completedCount,
      pending_appointments: pendingCount,
      cancelled_appointments: cancelledCount,
      month_appointments_count: monthAppts.length,
      month_revenue: Math.round(monthRevenue * 100) / 100,
      service_month_revenue: Math.round(serviceMonthRevenue * 100) / 100,
      retail_month_revenue: Math.round(retailMonthRevenue * 100) / 100,
      prev_month_revenue: Math.round(prevMonthRevenue * 100) / 100,
      revenue_delta_pct: revenueDeltaPct,
      last_30_revenue: Math.round(last30Revenue * 100) / 100,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      avg_ticket: Math.round(avgTicket * 100) / 100,
      avg_client_ltv: avgClientLtv,
      cross_sell_pct: crossSellPct,
      inactive_30_plus: inactive30Plus,
      inactive_60_plus: inactive60Plus,
      inactive_90_plus: inactive90Plus,
      never_visited_count: neverVisited.length,
      tomorrow_appointments_count: tomorrowAppts.length,
      tomorrow_unsent_reminders: tomorrowUnsentCount,
      upcoming_birthdays_count: upcomingBirthdays.length,
      active_operators_count: operators.filter((o) => Number(o.active) !== 0).length || 1,
      products_count: products.length,
      low_stock_count: lowStockProducts.length,
      inventory_value: Math.round(inventoryValue * 100) / 100,
      active_cards_count: activeCardsCount,
    },
    inactive_threshold_days: inactiveThresholdDays,
    inactive_clients: customThresholdClients,
    inactive_all_30_plus: inactiveAll,
    never_visited_clients: neverVisited,
    vip_clients: vipClients,
    top_services: topServices,
    operator_stats: operatorStats,
    top_products: topProducts,
    low_stock_products: lowStockProducts,
    reorder_forecasts: reorderForecasts,
    cross_sell: {
      clients_buying_products_pct: crossSellPct,
      top_pairings: topPairings,
      retail_revenue_month: Math.round(retailMonthRevenue * 100) / 100,
      retail_revenue_total: Math.round(totalRetailRevenue * 100) / 100,
    },
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

function buildLocalAiReply(question, clients, appointments, todayIso, extra = {}) {
  const qLower = String(question || '').toLowerCase();
  const daysThreshold = extractDaysFromItalianQuestion(qLower);
  const insights = computeStudioInsights(clients, appointments, todayIso, daysThreshold, extra);
  const s = insights.summary;

  const isInactiveQ =
    /non vengon|non tornan|sparit|inattiv|dormient|da un po|da quanto|ricontatt|richiam|assent/.test(qLower);
  const isInventoryQ = /magazzin|prodott|scort|riordin|fornitor|vendite incrociat|cross/.test(qLower);
  const isOperatorsQ = /operator|staff|dipendent|collaborator/.test(qLower);
  const isServicesQ = /trattament|serviz|più richiest|piu richiest|vanno di pi|popolar/.test(qLower);
  const isVipQ = /miglior|vip|fedel|spendon|valore nel tempo|ltv/.test(qLower);
  const isBirthdayQ = /compleann|augur/.test(qLower);
  const isTomorrowQ = /domani|promemoria|whatsapp/.test(qLower);
  const isReportQ = /report|riepilog|fatturat|incass|andamento|statistich|mese|guadagn|bilancio/.test(qLower);

  const lines = [];

  if (isInactiveQ) {
    const matched = insights.inactive_clients;
    lines.push(`📊 **Analisi Clienti Inattive (soglia: ${daysThreshold}+ giorni senza visita):**`);
    lines.push(
      `• Oltre **30 giorni:** ${s.inactive_30_plus} | **60 giorni:** ${s.inactive_60_plus} | **90 giorni:** ${s.inactive_90_plus} | Mai venute: ${s.never_visited_count}.`
    );
    if (matched.length === 0) {
      lines.push(`\nNessuna cliente risulta inattiva da ${daysThreshold}+ giorni al momento! 🎉`);
    } else {
      lines.push(`\nEcco le clienti da ricontattare (${matched.length}):`);
      matched.slice(0, 12).forEach((c) => {
        lines.push(
          `• **${c.full_name}** (${c.phone}) — ultima visita **${c.last_visit}** (**${c.days_since} gg fa**) • *${c.last_services || 'n/d'}*`
        );
      });
    }
  } else if (isInventoryQ) {
    lines.push(`📦 **Analisi Magazzino, Riordini & Vendite Incrociate:**`);
    lines.push(
      `• Prodotti a catalogo: **${s.products_count}** | Valore scorte (costo): **${s.inventory_value.toFixed(2)} €** | Sottoscorta: **${s.low_stock_count}**`
    );
    lines.push(
      `• Ricavo prodotti mese: **${s.retail_month_revenue.toFixed(2)} €** | Clienti con acquisti incrociati: **${s.cross_sell_pct}%**`
    );
    const urgent = insights.reorder_forecasts.filter((r) => r.needs_reorder);
    if (urgent.length > 0) {
      lines.push(`\n🚨 **Previsioni di Riordino Consigliate (${urgent.length}):**`);
      urgent.slice(0, 8).forEach((r) => {
        const leftTxt = r.days_left !== null ? `autonomia ~${r.days_left} gg` : 'sotto scorta min.';
        lines.push(
          `• **${r.name}** (Giacenza: ${r.stock_qty}/${r.min_stock_qty} • ${leftTxt}) ➔ Ordina **+${r.suggested_order_qty} pz** da *${r.supplier_name}*`
        );
      });
    } else {
      lines.push('\n✅ Nessun prodotto richiede riordino urgente in questo momento.');
    }
  } else if (isOperatorsQ) {
    lines.push('👩‍🎨 **Rendimento Operatori Studio:**');
    insights.operator_stats.forEach((op, i) => {
      lines.push(
        `${i + 1}. **${op.name}** — ${op.appointments_count} appuntamenti (${op.hours}h) • **${op.revenue.toFixed(0)} €** totali (mese: ${op.month_revenue.toFixed(0)} €)`
      );
    });
  } else if (isServicesQ) {
    lines.push('💅 **Classifica Trattamenti più richiesti:**');
    if (insights.top_services.length === 0) {
      lines.push('Non ci sono ancora abbastanza appuntamenti registrati per stilare una classifica.');
    } else {
      insights.top_services.slice(0, 8).forEach((svc, idx) => {
        lines.push(`${idx + 1}. **${svc.name}** — ${svc.count} volte (${svc.revenue.toFixed(0)} €)`);
      });
    }
  } else if (isVipQ) {
    lines.push(`👑 **Valore nel Tempo Clienti (LTV medio: ${s.avg_client_ltv.toFixed(0)} €):**`);
    if (insights.vip_clients.length === 0) {
      lines.push('Nessuna cliente con acquisti o sedute registrate al momento.');
    } else {
      insights.vip_clients.forEach((c, idx) => {
        lines.push(
          `${idx + 1}. **${c.full_name}** — ${c.visits_count} visite • **LTV ${c.total_spent.toFixed(0)} €** (servizi ${c.service_spent.toFixed(0)} € + prodotti ${c.product_spent.toFixed(0)} €)`
        );
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
  } else {
    const deltaLabel =
      s.revenue_delta_pct === null
        ? ''
        : ` (${s.revenue_delta_pct >= 0 ? '+' : ''}${s.revenue_delta_pct}% vs mese scorso)`;
    lines.push(`✨ **Report Generale Studio (${insights.current_month}):**`);
    lines.push(`• **Clienti:** ${s.total_clients} (LTV medio: ${s.avg_client_ltv.toFixed(0)} € | Privacy firmata: ${s.privacy_accepted_clients})`);
    lines.push(
      `• **Incassi mese:** ${s.month_revenue.toFixed(0)} € (Servizi ${s.service_month_revenue.toFixed(0)} € + Prodotti ${s.retail_month_revenue.toFixed(0)} €)${deltaLabel}`
    );
    lines.push(`• **Operatori attivi:** ${s.active_operators_count} | **Prodotti sottoscorta:** ${s.low_stock_count}`);
    lines.push(
      `• **Clienti che non tornano (30+ gg):** ${s.inactive_30_plus} | **Domani:** ${s.tomorrow_appointments_count} app. (${s.tomorrow_unsent_reminders} da avvisare)`
    );
  }

  return {
    engine: 'local-analytics-ai',
    answer: lines.join('\n'),
    insights,
  };
}

async function answerStudioQuestion(question, clients, appointments, todayIso, extra = {}) {
  const localResult = buildLocalAiReply(question, clients, appointments, todayIso, extra);
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return localResult;
  }

  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const compactData = {
      summary: localResult.insights.summary,
      operator_stats: localResult.insights.operator_stats,
      inactive_clients: localResult.insights.inactive_clients.slice(0, 15),
      top_services: localResult.insights.top_services.slice(0, 10),
      vip_clients: localResult.insights.vip_clients,
      reorder_forecasts: localResult.insights.reorder_forecasts,
      cross_sell: localResult.insights.cross_sell,
      upcoming_birthdays: localResult.insights.upcoming_birthdays,
      recommendations: localResult.insights.recommendations,
    };

    const prompt = [
      "Sei l'Assistente AI manageriale di Giulia Beauty Studio (centro estetico).",
      'Rispondi in italiano chiaro, pratico e caloroso usando ESCLUSIVAMENTE i dati reali JSON forniti qui sotto (non inventare mai nomi, numeri o date).',
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

    if (!res.ok) return localResult;
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
