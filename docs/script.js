/*
 * Haushaltsplaner Developer Beta 0.98
 *
 * Diese Version synchronisiert schuldbezogene Zahlungen zwischen
 * Gemeinsame Kosten / Persönliche Ausgaben und dem Schulden-Tab.
 * Optional kann ein Posten direkt mit einer Schuld verknüpft werden,
 * sodass die Bezahl-Markierung beide Bereiche gleichzeitig aktualisiert.
 */

(() => {
  // Entferne bestehende Service‑Worker und Caches. Dadurch wird
  // sichergestellt, dass keine veralteten Dateien geladen werden.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    });
  }
  if (window.caches) {
    caches.keys().then((keys) => {
      keys.forEach((key) => caches.delete(key));
    });
  }
  // ----- Datums-Hilfsfunktionen -----
  function monthKeyToDate(key) {
    const [year, month] = key.split('-').map(Number);
    return new Date(year, month - 1, 1);
  }
  function dateToMonthKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  function monthDiff(a, b) {
    // Differenz in Monaten zwischen zwei Month-Keys
    const da = monthKeyToDate(a);
    const db = monthKeyToDate(b);
    return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
  }
  function nextMonth(key) {
    const d = monthKeyToDate(key);
    d.setMonth(d.getMonth() + 1);
    return dateToMonthKey(d);
  }
  function addMonths(key, count) {
    const d = monthKeyToDate(key);
    d.setMonth(d.getMonth() + count);
    return dateToMonthKey(d);
  }
  function getNext12Months(startKey) {
    const start = monthKeyToDate(startKey);
    const list = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const key = dateToMonthKey(d);
      const label = d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
      list.push({ key, label });
    }
    return list;
  }
  function normalizeTextKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getLinkedDebtForPost(post) {
    if (!post || !Array.isArray(state.debts)) return null;
    if (post.linkedDebtId) {
      const linked = state.debts.find((d) => d.id === post.linkedDebtId);
      if (linked) return linked;
    }
    const nameKey = normalizeTextKey(post.name);
    if (!nameKey) return null;
    return state.debts.find((d) => normalizeTextKey(d.name) === nameKey) || null;
  }

  function getLinkedDebtName(post) {
    const linked = getLinkedDebtForPost(post);
    return linked ? linked.name : '';
  }

  function findDebtByExactName(name) {
    const nameKey = normalizeTextKey(name);
    if (!nameKey || !Array.isArray(state.debts)) return null;
    return state.debts.find((d) => normalizeTextKey(d.name) === nameKey) || null;
  }

  function getDebtLinkedPosts(debt) {
    if (!debt || !debt.id) return [];
    const lists = [state.commonCosts || [], state.personalCosts || []];
    const debtKey = normalizeTextKey(debt.name);
    const posts = [];
    lists.forEach((list) => {
      list.forEach((post) => {
        ensureLinkedDebtField(post);
        const linkedById = post.linkedDebtId && post.linkedDebtId === debt.id;
        const linkedByName = !post.linkedDebtId && debtKey && normalizeTextKey(post.name) === debtKey;
        if (linkedById || linkedByName) posts.push(post);
      });
    });
    return posts;
  }

  function isMultiMonthPost(post) {
    if (!post) return false;
    if (post.oneTime === true) return false;
    const interval = Number(post.interval || 1);
    if (interval > 1) return true;
    if (!isMonthKey(post.startMonth)) return true;
    if (!isMonthKey(post.endMonth)) return true;
    return monthDiff(post.startMonth, post.endMonth) >= 1;
  }

  function inferDebtPaymentType(debt) {
    const currentType = debt && debt.paymentType;
    if (['installment', 'one_time', 'open_plan'].includes(currentType)) return currentType;
    const open = Number(debt && debt.amountOpen || 0);
    const rate = Number(debt && debt.monthlyRate || 0);
    if (!(open > 0)) return rate > 0 ? 'installment' : 'one_time';
    if (!(rate > 0)) return 'open_plan';
    const linkedPosts = getDebtLinkedPosts(debt);
    if (linkedPosts.some(isMultiMonthPost)) return 'installment';
    const hasMonthlyHistory = (debt.paymentHistory || []).some((entry) => entry && entry.markedAsMonthly === true);
    if (hasMonthlyHistory && open > 0.005) return 'installment';
    return open > rate + 0.005 ? 'installment' : 'one_time';
  }

  function getDebtPaymentTypeLabel(type) {
    if (type === 'installment') return 'Ratenzahlung';
    if (type === 'one_time') return 'Einmalzahlung';
    if (type === 'open_plan') return 'Ratenplan offen';
    return 'Ratenzahlung';
  }



  function normalizeDebtRateTimeline(debt) {
    if (!debt || typeof debt !== 'object') return [];
    if (!Array.isArray(debt.rateTimeline)) debt.rateTimeline = [];
    debt.rateTimeline = debt.rateTimeline
      .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)))
      .map((entry) => ({ month: entry.month, amount: Math.max(0, Number(entry.amount || 0)) }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const cleaned = [];
    debt.rateTimeline.forEach((entry) => {
      const existing = cleaned.find((item) => item.month === entry.month);
      if (existing) existing.amount = entry.amount;
      else cleaned.push(entry);
    });
    debt.rateTimeline = cleaned;
    return debt.rateTimeline;
  }

  function getDebtRateForMonth(debt, monthKey = currentMonth) {
    if (!debt) return 0;
    normalizeDebtRateTimeline(debt);
    let rate = Number(debt.monthlyRate || 0);
    debt.rateTimeline.forEach((entry) => {
      if (monthDiff(entry.month, monthKey) >= 0) rate = Number(entry.amount || 0);
    });
    return Math.max(0, Number.isFinite(rate) ? rate : 0);
  }

  function setDebtRateFromMonth(debt, month, amount) {
    if (!debt || !isMonthKey(month)) return false;
    const rate = Math.max(0, Number(amount || 0));
    normalizeDebtRateTimeline(debt);
    const existing = debt.rateTimeline.find((entry) => entry.month === month);
    if (existing) existing.amount = rate;
    else debt.rateTimeline.push({ month, amount: rate });
    debt.rateTimeline.sort((a, b) => a.month.localeCompare(b.month));
    return true;
  }

  function getDebtRateTimelineText(debt) {
    normalizeDebtRateTimeline(debt);
    if (!debt.rateTimeline.length) return '';
    return debt.rateTimeline.map((entry) => `ab ${formatMonthLabel(entry.month)}: ${Number(entry.amount || 0).toFixed(2)} €`).join(' · ');
  }

  function isInstallmentDebtForSnowball(debt) {
    ensureDebtConfig(debt);
    const open = Number(debt.amountOpen || 0);
    const rate = getDebtRateForMonth(debt, currentMonth);
    return debt.paymentType === 'installment' && open > 0 && rate > 0;
  }

  function getSnowballExcludeReason(debt) {
    ensureDebtConfig(debt);
    if (!(Number(debt.amountOpen || 0) > 0)) return '';
    if (debt.paymentType === 'one_time') return 'Einmalzahlung';
    if (debt.paymentType === 'open_plan') return 'Ratenplan offen';
    if (!(getDebtRateForMonth(debt, currentMonth) > 0)) return 'kein Ratenplan hinterlegt';
    if (!isInstallmentDebtForSnowball(debt)) return 'keine laufende Ratenzahlung';
    return '';
  }

  function autoLinkMatchingDebtPosts() {
    if (!state || !Array.isArray(state.debts)) return 0;
    let linked = 0;
    const lists = [state.commonCosts || [], state.personalCosts || []];
    lists.forEach((list) => {
      list.forEach((post) => {
        ensureLinkedDebtField(post);
        if (post.linkedDebtId && state.debts.some((d) => d.id === post.linkedDebtId)) return;
        const match = findDebtByExactName(post.name);
        if (match) {
          post.linkedDebtId = match.id;
          linked += 1;
        }
      });
    });
    return linked;
  }

  function ensureDebtConfig(debt) {
    if (!debt || typeof debt !== 'object') return;
    if (!Array.isArray(debt.paidMonths)) debt.paidMonths = [];
    debt.paidMonths = debt.paidMonths.filter((m, index, arr) => isMonthKey(m) && arr.indexOf(m) === index);
    const open = Number(debt.amountOpen);
    debt.amountOpen = Number.isFinite(open) && open >= 0 ? open : 0;
    const rate = Number(debt.monthlyRate);
    debt.monthlyRate = Number.isFinite(rate) && rate >= 0 ? rate : 0;
    if (!['installment', 'one_time', 'open_plan'].includes(debt.paymentType)) {
      debt.paymentType = inferDebtPaymentType(debt);
    }
    if (debt.paymentType === 'open_plan') debt.monthlyRate = 0;
    normalizeDebtRateTimeline(debt);
    if (!Array.isArray(debt.paymentHistory)) debt.paymentHistory = [];
    debt.paymentHistory = debt.paymentHistory
      .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)))
      .map((entry) => ({
        id: entry.id || generateId(),
        month: entry.month,
        amount: Math.max(0, Number(entry.amount || 0)),
        source: entry.source || 'manuell',
        note: entry.note || '',
        createdAt: entry.createdAt || '',
        previousNextDueMonth: isMonthKey(entry.previousNextDueMonth) ? entry.previousNextDueMonth : '',
        markedAsMonthly: entry.markedAsMonthly === true
      }));
    if (isMonthKey(debt.completedMonth)) {
      // Bereits abgeschlossen: Abschlussmonat beibehalten.
    } else if (Number(debt.amountOpen || 0) <= 0) {
      const historyMonths = debt.paymentHistory.map((entry) => entry.month).filter(isMonthKey);
      const paidMonths = debt.paidMonths.filter(isMonthKey);
      const allMonths = historyMonths.concat(paidMonths).sort();
      debt.completedMonth = allMonths.length ? allMonths[allMonths.length - 1] : '';
    } else {
      delete debt.completedMonth;
    }
  }

  function getDebtCompletedMonth(debt) {
    ensureDebtConfig(debt);
    if (Number(debt.amountOpen || 0) > 0) return '';
    if (isMonthKey(debt.completedMonth)) return debt.completedMonth;
    const historyMonths = (debt.paymentHistory || []).map((entry) => entry.month).filter(isMonthKey);
    const paidMonths = (debt.paidMonths || []).filter(isMonthKey);
    const allMonths = historyMonths.concat(paidMonths).sort();
    return allMonths.length ? allMonths[allMonths.length - 1] : '';
  }

  function shouldShowDebtInMonth(debt, monthKey) {
    ensureDebtConfig(debt);
    if (Number(debt.amountOpen || 0) > 0) return true;
    const completedMonth = getDebtCompletedMonth(debt);
    if (!completedMonth) return false;
    return monthDiff(completedMonth, monthKey) <= 0;
  }

  function syncDebtPaymentFromPost(post, monthKey) {
    const debt = getLinkedDebtForPost(post);
    if (!debt) return false;
    ensureDebtConfig(debt);
    if (debt.nextDueMonth !== monthKey) return false;
    return addDebtPayment(debt, {
      month: monthKey,
      amount: Number(getDebtRateForMonth(debt, monthKey) || getEffectiveAmountForMonth(post, monthKey) || 0),
      source: `Verknüpfter Posten: ${post.name || 'Posten'}`,
      markAsMonthly: true
    });
  }
  // ----- Datenmodell und Persistenz -----
  const defaultState = {
    persons: [
      {
        id: 'p1',
        name: 'Benny',
        net: 2300,
        netOverrides: {},
        shift: 0
      },
      {
        id: 'p2',
        name: 'Madeleine',
        net: 2700,
        netOverrides: {},
        shift: 0
      }
    ],
    commonCosts: [],
    personalCosts: [],
    bufferExpenses: [],
    monthlyClosings: {},
    changeLog: [],
    debts: [],
    pots: [],
    // Liste der Monate, in denen die Rücklagen/Spar‑Beträge bereits
    // zurückgelegt wurden. Wird zum Markieren in der Tabelle
    // „Rücklagen & Sparen“ verwendet.
    reservesSavedMonths: [],
    reserveItemSaved: {},
    tankCalc: {
      apiKey: '',
      radiusKm: 5,
      lastRequestAt: '',
      lastApiStatus: '',
      lastApiError: '',
      benny: { kmPerMonth: 0, consumption: 5.5, fuelType: 'diesel', avgPrice: '', autoPrice: '', stationName: '', lastFetch: '' },
      madeleine: { kmPerMonth: 0, consumption: 7.0, fuelType: 'e5', avgPrice: '', autoPrice: '', stationName: '', lastFetch: '' }
    },
    appMeta: { selectedMonth: '', lastAutoMonthCheck: '', includeApiKeyInBackup: true }
  };
  let state;
  try {
  let saved = localStorage.getItem('budgetStateV098');
    if (!saved) {
      // Fallback-Migration aus älteren Versionen
      const fallback = [
        'budgetStateStable','budgetStateAutoBackup','budgetStateV097','budgetStateV096','budgetStateV095','budgetStateV094','budgetStateV093','budgetStateV092','budgetStateV091','budgetStateV090','budgetStateV089','budgetStateV088','budgetStateV086','budgetStateV085','budgetStateV084','budgetStateV083','budgetStateV082','budgetStateV081','budgetStateV080','budgetStateV079','budgetStateV078','budgetStateV077','budgetStateV076','budgetStateV075','budgetStateV074','budgetStateV073','budgetStateV072','budgetStateV071','budgetStateV070','budgetStateV069','budgetStateV068','budgetStateV067','budgetStateV066','budgetStateV065','budgetStateV064','budgetStateV063','budgetStateV062','budgetStateV061','budgetStateV060','budgetStateV059','budgetStateV058','budgetStateV057','budgetStateV056','budgetStateV055','budgetStateV054','budgetStateV053','budgetStateV052','budgetStateV051','budgetStateV050','budgetStateV049','budgetStateV048','budgetStateV047','budgetStateV046','budgetStateV045','budgetStateV044','budgetStateV043','budgetStateV042','budgetStateV041','budgetStateV040','budgetStateV039','budgetStateV038','budgetStateV037','budgetStateV036','budgetStateV035','budgetStateV034','budgetStateV033','budgetStateV032','budgetStateV031','budgetStateV030','budgetStateV029','budgetStateV028','budgetStateV027','budgetStateV026','budgetStateV025','budgetStateV024','budgetStateV023','budgetStateV022','budgetStateV021','budgetStateV020','budgetStateV019','budgetStateV018','budgetStateV017','budgetStateV016','budgetStateV015'
      ];
      for (const k of fallback) {
        const data = localStorage.getItem(k);
        if (data) {
          saved = data;
          // Bei erfolgreicher Migration unter neuem Key speichern
          localStorage.setItem('budgetStateV098', data);
          break;
        }
      }
    }
    state = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(defaultState));
    // Falls das neue Flag für Rücklagen‑Bestätigungen fehlt, initialisiere es
    if (!state.reservesSavedMonths) state.reservesSavedMonths = [];
    if (!state.tankCalc) {
      state.tankCalc = JSON.parse(JSON.stringify(defaultState.tankCalc));
    } else {
      if (typeof state.tankCalc.apiKey !== 'string') state.tankCalc.apiKey = '';
      state.tankCalc.apiKey = extractTankApiKey(state.tankCalc.apiKey);
      if (!state.tankCalc.radiusKm) state.tankCalc.radiusKm = 5;
      if (typeof state.tankCalc.lastRequestAt !== 'string') state.tankCalc.lastRequestAt = '';
      if (typeof state.tankCalc.lastApiStatus !== 'string') state.tankCalc.lastApiStatus = '';
      if (typeof state.tankCalc.lastApiError !== 'string') state.tankCalc.lastApiError = '';
      if (!state.tankCalc.benny) state.tankCalc.benny = JSON.parse(JSON.stringify(defaultState.tankCalc.benny));
      if (!state.tankCalc.madeleine) state.tankCalc.madeleine = JSON.parse(JSON.stringify(defaultState.tankCalc.madeleine));
    }
    if (!Array.isArray(state.bufferExpenses)) state.bufferExpenses = [];
    if (!state.monthlyClosings || typeof state.monthlyClosings !== 'object') state.monthlyClosings = {};
    if (!Array.isArray(state.changeLog)) state.changeLog = [];
    if (!state.appMeta || typeof state.appMeta !== 'object') state.appMeta = JSON.parse(JSON.stringify(defaultState.appMeta));
    migrateKreiskasseToBennyPersonal();
    if (!state.reserveItemSaved) state.reserveItemSaved = {};
    syncAllReserveSelectionsToPots();
    normalizeAllPersonConfigs();
    normalizeAllPostConfigs();
    normalizeAllDebtConfigs();
    autoLinkMatchingDebtPosts();
    normalizeAppMeta();
    saveState();
  } catch (err) {
    state = JSON.parse(JSON.stringify(defaultState));
  }

  function saveState() {
    try {
      const payload = JSON.stringify(state);
      localStorage.setItem('budgetStateV098', payload);
      localStorage.setItem('budgetStateStable', payload);
      localStorage.setItem('budgetStateAutoBackup', payload);
      const savedAt = new Date().toISOString();
      localStorage.setItem('budgetStateLastSavedAt', savedAt);
      updateSaveStatus(savedAt);
      return true;
    } catch (err) {
      console.error('Speichern fehlgeschlagen', err);
      alert('Die App konnte deine Daten im Browser nicht speichern. Bitte exportiere sofort ein Backup unter „Sichern“.');
      return false;
    }
  }

  function updateSaveStatus(savedAt) {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    const iso = savedAt || localStorage.getItem('budgetStateLastSavedAt') || '';
    if (!iso) {
      el.textContent = 'Noch kein Speicherzeitpunkt';
      return;
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      el.textContent = 'Speicherstatus unklar';
      return;
    }
    el.textContent = 'Gespeichert: ' + d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function normalizeAppMeta() {
    if (!state.appMeta || typeof state.appMeta !== 'object') state.appMeta = { selectedMonth: '', lastAutoMonthCheck: '', includeApiKeyInBackup: true };
    if (!isMonthKey(state.appMeta.selectedMonth)) state.appMeta.selectedMonth = '';
    if (!isMonthKey(state.appMeta.lastAutoMonthCheck)) state.appMeta.lastAutoMonthCheck = '';
    if (typeof state.appMeta.includeApiKeyInBackup !== 'boolean') state.appMeta.includeApiKeyInBackup = true;
  }

  function normalizeAllPostConfigs() {
    if (Array.isArray(state.commonCosts)) state.commonCosts.forEach(ensurePostConfig);
    if (Array.isArray(state.personalCosts)) state.personalCosts.forEach(ensurePostConfig);
    if (Array.isArray(state.bufferExpenses)) state.bufferExpenses.forEach(ensurePostConfig);
  }

  function normalizeAllDebtConfigs() {
    if (Array.isArray(state.debts)) state.debts.forEach(ensureDebtConfig);
  }

  function ensureLinkedDebtField(post) {
    if (!post || typeof post !== 'object') return;
    if (typeof post.linkedDebtId !== 'string') post.linkedDebtId = '';
  }

  function migrateKreiskasseToBennyPersonal() {
    if (!state || !Array.isArray(state.commonCosts) || !Array.isArray(state.personalCosts)) return;
    const kreisMatches = state.commonCosts.filter((item) => {
      const name = (item && item.name ? String(item.name) : '').toLowerCase();
      return name.includes('kreiskasse');
    });
    if (kreisMatches.length === 0) return;

    const existingPersonal = state.personalCosts.find((item) => {
      const name = (item && item.name ? String(item.name) : '').toLowerCase();
      const personId = String(item && item.personId ? item.personId : '').toLowerCase();
      return personId === 'benny' && name.includes('kreiskasse');
    });

    const source = kreisMatches[0];
    if (existingPersonal) {
      existingPersonal.amount = Number(source.amount || existingPersonal.amount || 150);
      existingPersonal.interval = Number(source.interval || existingPersonal.interval || 1);
      existingPersonal.startMonth = source.startMonth || existingPersonal.startMonth || '2026-05';
      if (!Array.isArray(existingPersonal.paidMonths)) existingPersonal.paidMonths = [];
    } else {
      state.personalCosts.push({
        id: 'benny_kreiskasse_opr',
        personId: 'benny',
        name: source.name || 'Kreiskasse OPR',
        amount: Number(source.amount || 150),
        interval: Number(source.interval || 1),
        startMonth: source.startMonth || '2026-05',
        paidMonths: Array.isArray(source.paidMonths) ? [...source.paidMonths] : []
      });
    }

    state.commonCosts = state.commonCosts.filter((item) => {
      const name = (item && item.name ? String(item.name) : '').toLowerCase();
      return !name.includes('kreiskasse');
    });
  }

  // ----- Konfiguration für die Rücklagen‑Aufteilung -----
  // Der verfügbare Betrag wird am Monatsende im
  // Verhältnis von reservesRatio (Rücklagen) und savingsRatio (Sparen)
  // verteilt. Die Rücklagen verteilen sich entsprechend der
  // reservePotShares auf verschiedene Töpfe.
  const savingsConfig = {
    // Kein Puffer-Abzug: verteilt wird der tatsächlich verfügbare Monatsrest.
    minFree: 0,
    // Anteil des verteilbaren Betrags, der in die Rücklagen fließt.
    reservesRatio: 0.7,
    // Anteil des verteilbaren Betrags, der in das Sparen fließt.
    savingsRatio: 0.3,
    // Monat, ab dem die automatische Verteilung gestartet wird (JJJJ-MM).
    startMonth: '2026-05',
    // Aufteilung der Rücklagen auf einzelne Töpfe.
    reservePotShares: {
      'Auto': 0.35,
      'Urlaub': 0.15,
      'Anschaffungen (inkl. Wohnen)': 0.25,
      'Kleidung': 0.15,
      'Freizeit': 0.10
    }
  };

  /**
   * Berechnet den automatischen Rücklagenbeitrag für einen bestimmten
   * Topf in einem gegebenen Monat. Vor dem Start der Verteilung
   * (savingsConfig.startMonth) wird 0 zurückgegeben. Die Berechnung
   * basiert auf dem freien Betrag, der Verteilung auf Rücklagen
   * (reservesRatio) und dem Anteil des jeweiligen Topfs.
   *
   * @param {string} potName Name des Rücklagen-Topfs
   * @param {string} monthKey Monat im Format JJJJ-MM
   * @returns {number} Automatischer Beitrag für den Topf in diesem Monat
   */
  function getReserveContributionForPot(potName, monthKey) {
    // Prüfen, ob der Monat vor dem Start der Verteilung liegt. monthDiff(a,b) gibt die Differenz b - a.
    // Ist monthKey < savingsConfig.startMonth, also monthDiff(monthKey, startMonth) negativ, wird 0 zurückgegeben.
    if (monthDiff(savingsConfig.startMonth, monthKey) < 0) {
      return 0;
    }
    const free = computeFreeSumForMonth(monthKey);
    const verteilbar = Math.max(free, 0);
    const ruecklagen = verteilbar * savingsConfig.reservesRatio;
    const share = savingsConfig.reservePotShares[potName] || 0;
    return ruecklagen * share;
  }

  /**
   * Berechnet den automatischen Sparbetrag (30 % des verteilbaren
   * Betrags) für einen gegebenen Monat. Vor dem Start der Verteilung
   * wird 0 zurückgegeben.
   *
   * @param {string} monthKey Monat im Format JJJJ-MM
   * @returns {number} Sparbeitrag in diesem Monat
   */
  function getSavingsContribution(monthKey) {
    if (monthDiff(savingsConfig.startMonth, monthKey) < 0) {
      return 0;
    }
    const free = computeFreeSumForMonth(monthKey);
    const verteilbar = Math.max(free, 0);
    return verteilbar * savingsConfig.savingsRatio;
  }

  function formatMonthLabel(monthKey) {
    return monthKeyToDate(monthKey).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  }

  function estimateDebtPaidOffMonth(debt) {
    let open = Number(debt.amountOpen || 0);
    if (open <= 0 || !debt.nextDueMonth) return '';
    let month = debt.nextDueMonth;
    for (let i = 0; i < 240; i += 1) {
      const rate = getDebtRateForMonth(debt, month);
      if (!(rate > 0)) return '';
      open = Math.max(0, open - rate);
      if (open <= 0.005) return month;
      month = nextMonth(month);
    }
    return '';
  }

  function estimateDebtEndMonth(debt) {
    return estimateDebtPaidOffMonth(debt);
  }

  function getDebtMonthAmount(debt, monthKey) {
    const rate = getDebtRateForMonth(debt, monthKey);
    const open = Number(debt.amountOpen || 0);
    if (open <= 0 || rate <= 0) return 0;
    if (!debt.nextDueMonth) return rate;
    return monthDiff(debt.nextDueMonth, monthKey) >= 0 ? Math.min(open, rate) : 0;
  }

  function getDebtPlanForMonth(monthKey) {
    let planned = 0;
    let paid = 0;
    let open = 0;
    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      const paidAmount = getDebtPaymentAmountForMonth(debt, monthKey);
      const plannedBase = getDebtMonthAmount(debt, monthKey);
      if (paidAmount > 0 || plannedBase > 0) {
        planned += Math.max(plannedBase, paidAmount);
        paid += paidAmount;
        open += Math.max(plannedBase - paidAmount, 0);
      }
    });
    return { planned, paid, open };
  }

  function buildSnowballPlan(startMonth = currentMonth, maxMonths = 72) {
    const sourceDebts = (state.debts || []).map((debt) => {
      ensureDebtConfig(debt);
      return {
        id: debt.id,
        name: debt.name || 'Schuld',
        open: Math.max(0, Number(debt.amountOpen || 0)),
        rate: Math.max(0, getDebtRateForMonth(debt, startMonth)),
        baseRate: Math.max(0, Number(debt.monthlyRate || 0)),
        rateTimeline: Array.isArray(debt.rateTimeline) ? debt.rateTimeline.map((entry) => ({ month: entry.month, amount: Number(entry.amount || 0) })) : [],
        nextDueMonth: isMonthKey(debt.nextDueMonth) ? debt.nextDueMonth : startMonth,
        snowballEligible: isInstallmentDebtForSnowball(debt),
        excludeReason: getSnowballExcludeReason(debt)
      };
    }).filter((debt) => debt.open > 0);
    const noRate = sourceDebts.filter((debt) => debt.excludeReason);
    const active = sourceDebts.filter((debt) => debt.snowballEligible);
    const rows = [];
    const events = [];
    let rollover = 0;
    let month = startMonth;
    let debtFreeMonth = '';

    for (let i = 0; i < maxMonths && active.some((debt) => debt.open > 0); i += 1) {
      let base = 0;
      let extra = 0;
      let newlyFreed = 0;
      const notes = [];
      active.forEach((debt) => { debt.rate = getDebtRateForMonth(debt, month); });
      const dueDebts = active
        .filter((debt) => debt.open > 0 && monthDiff(debt.nextDueMonth, month) >= 0)
        .sort((a, b) => a.open - b.open || a.name.localeCompare(b.name));

      dueDebts.forEach((debt) => {
        const pay = Math.min(debt.open, debt.rate);
        debt.open = Math.max(0, debt.open - pay);
        base += pay;
        if (pay > 0) notes.push(`${debt.name}: ${pay.toFixed(2)} €`);
        if (debt.open <= 0.005) {
          debt.open = 0;
          newlyFreed += debt.rate;
          events.push({ month, text: `${debt.name} abbezahlt – ab ${formatMonthLabel(nextMonth(month))} gehen ${debt.rate.toFixed(2)} € auf die kleinste offene Schuld.` });
        }
      });

      if (rollover > 0) {
        let extraBudget = rollover;
        while (extraBudget > 0.005) {
          const target = active
            .filter((debt) => debt.open > 0 && monthDiff(debt.nextDueMonth, month) >= 0)
            .sort((a, b) => a.open - b.open || a.name.localeCompare(b.name))[0];
          if (!target) break;
          const pay = Math.min(target.open, extraBudget);
          target.open = Math.max(0, target.open - pay);
          extra += pay;
          extraBudget -= pay;
          notes.push(`${target.name} +${pay.toFixed(2)} € Schneeball`);
          if (target.open <= 0.005) {
            target.open = 0;
            newlyFreed += target.rate;
            events.push({ month, text: `${target.name} durch Schneeball abbezahlt – ab ${formatMonthLabel(nextMonth(month))} kommen ${target.rate.toFixed(2)} € zusätzlich dazu.` });
          }
        }
      }

      const remaining = active.reduce((sum, debt) => sum + Math.max(0, debt.open), 0);
      const nextTarget = active.filter((debt) => debt.open > 0 && monthDiff(debt.nextDueMonth, nextMonth(month)) >= 0).sort((a, b) => a.open - b.open || a.name.localeCompare(b.name))[0];
      rows.push({ month, base, extra, total: base + extra, rolloverNext: rollover + newlyFreed, remaining, targetNext: nextTarget ? nextTarget.name : '', notes: notes.slice(0, 4).join(' · ') });
      if (remaining <= 0.005) {
        debtFreeMonth = month;
        break;
      }
      rollover += newlyFreed;
      month = nextMonth(month);
    }
    return { rows, events, noRate, debtFreeMonth };
  }

  function findCriticalMonths(startMonth = currentMonth) {
    return getNext12Months(startMonth)
      .map(({ key, label }) => ({ key, label, free: computeMonthDetails(key).free }))
      .filter((item) => item.free < 0)
      .slice(0, 3);
  }

  function getFinanceStatus(free) {
    if (free < 0) return { label: 'Kritisch', kind: 'danger', text: `Der Monat ist mit ${Math.abs(free).toFixed(2)} € im Minus.` };
    if (free < 100) return { label: 'Sehr eng', kind: 'danger', text: 'Der freie Rest liegt unter 100 €.' };
    if (free < 300) return { label: 'Eng', kind: 'warning', text: 'Der freie Rest liegt unter 300 €.' };
    return { label: 'Stabil', kind: 'success', text: 'Der Monat hat genug Luft.' };
  }

  // Hilfsfunktion: berechnet den freien Betrag für ein gegebenes
  // Monats‑Key für den ausgewählten Monat. Dabei werden die
  // Nettoeinkommen, die gerundeten Anteile der gemeinsamen Kosten
  // und die persönlichen Ausgaben berücksichtigt. bezahlte sonstige Ausgaben werden abgezogen.
  function getBufferExpensePlannedSumForMonth(monthKey) {
    if (!Array.isArray(state.bufferExpenses)) return 0;
    return state.bufferExpenses.reduce((sum, post) => {
      if (isDue(post, monthKey)) return sum + getEffectiveAmountForMonth(post, monthKey);
      return sum;
    }, 0);
  }

  function getBufferExpenseSumForMonth(monthKey) {
    if (!Array.isArray(state.bufferExpenses)) return 0;
    return state.bufferExpenses.reduce((sum, post) => {
      if (isDue(post, monthKey) && isPostPaidForMonth(post, monthKey)) {
        return sum + getEffectiveAmountForMonth(post, monthKey);
      }
      return sum;
    }, 0);
  }

  function getBufferExpenseOpenSumForMonth(monthKey) {
    return Math.max(getBufferExpensePlannedSumForMonth(monthKey) - getBufferExpenseSumForMonth(monthKey), 0);
  }

  function getRemainingMinBufferForMonth(monthKey) {
    return Math.max(savingsConfig.minFree - getBufferExpenseSumForMonth(monthKey), 0);
  }

  function computeFreeSumForMonth(monthKey) {
    const personsData = state.persons.map((p) => ({
      person: p,
      income: getPersonNet(p, monthKey),
      personalDue: 0
    }));
    let totalCommonRaw = 0;
    state.commonCosts.forEach((c) => {
      if (isPostActiveInMonth(c, monthKey)) totalCommonRaw += getCommonMonthlyShare(c, monthKey);
    });
    const shareMap = computeRoundedCommonShares(
      totalCommonRaw,
      state.persons.map((p) => ({ person: p, income: getPersonNet(p, monthKey) }))
    );
    state.personalCosts.forEach((pc) => {
      if (pc.personId && isDue(pc, monthKey)) {
        const pd = personsData.find((x) => x.person.id === pc.personId);
        if (pd) pd.personalDue += getEffectiveAmountForMonth(pc, monthKey);
      }
    });
    let free = 0;
    personsData.forEach((pd) => {
      const share = shareMap[pd.person.id] || 0;
      free += (pd.income - share - pd.personalDue);
    });
    // Sonstige Ausgaben reduzieren den wirklich verfügbaren Monatsrest erst,
    // wenn sie im jeweiligen Monat als bezahlt markiert wurden.
    free -= getBufferExpenseSumForMonth(monthKey);
    return free;
  }

  function computeMonthDetails(monthKey) {
    const personsData = state.persons.map((p) => ({ person: p, income: getPersonNet(p, monthKey), commonShare: 0, personalDue: 0 }));
    let totalCommonRaw = 0;
    state.commonCosts.forEach((c) => {
      if (isPostActiveInMonth(c, monthKey)) totalCommonRaw += getCommonMonthlyShare(c, monthKey);
    });
    const shareMap = computeRoundedCommonShares(totalCommonRaw, state.persons.map((p) => ({ person: p, income: getPersonNet(p, monthKey) })));
    personsData.forEach((pd) => { pd.commonShare = shareMap[pd.person.id] || 0; });
    state.personalCosts.forEach((pc) => {
      if (pc.personId && isDue(pc, monthKey)) {
        const pd = personsData.find((x) => x.person.id === pc.personId);
        if (pd) pd.personalDue += getEffectiveAmountForMonth(pc, monthKey);
      }
    });
    const totalIncome = personsData.reduce((sum, pd) => sum + pd.income, 0);
    const totalCommonRounded = Object.values(shareMap).reduce((sum, val) => sum + val, 0);
    const totalPersonal = personsData.reduce((sum, pd) => sum + pd.personalDue, 0);
    const miscPaid = getBufferExpenseSumForMonth(monthKey);
    const miscOpen = getBufferExpenseOpenSumForMonth(monthKey);
    const freeBeforeMisc = personsData.reduce((sum, pd) => sum + (pd.income - pd.commonShare - pd.personalDue), 0);
    const free = freeBeforeMisc - miscPaid;
    const distributable = Math.max(free, 0);
    const reserves = distributable * savingsConfig.reservesRatio;
    const savings = distributable * savingsConfig.savingsRatio;
    return { personsData, totalIncome, totalCommonRounded, totalPersonal, miscPaid, miscOpen, freeBeforeMisc, free, distributable, reserves, savings };
  }



  function computeMonthDetailsWithScenario(monthKey) {
    const simulatedPersons = state.persons.map((p) => {
      const raw = scenarioNet[p.id];
      const income = (raw !== '' && raw != null && Number.isFinite(Number(raw))) ? Number(raw) : getPersonNet(p, monthKey);
      return { person: p, income, commonShare: 0, personalDue: 0 };
    });
    let totalCommonRaw = 0;
    state.commonCosts.forEach((c) => {
      if (isPostActiveInMonth(c, monthKey)) totalCommonRaw += getCommonMonthlyShare(c, monthKey);
    });
    const shareMap = computeRoundedCommonShares(totalCommonRaw, simulatedPersons.map((pd) => ({ person: pd.person, income: pd.income })));
    simulatedPersons.forEach((pd) => { pd.commonShare = shareMap[pd.person.id] || 0; });
    state.personalCosts.forEach((pc) => {
      if (pc.personId && isDue(pc, monthKey)) {
        const pd = simulatedPersons.find((x) => x.person.id === pc.personId);
        if (pd) pd.personalDue += getEffectiveAmountForMonth(pc, monthKey);
      }
    });
    const totalIncome = simulatedPersons.reduce((sum, pd) => sum + pd.income, 0);
    const totalCommonRounded = Object.values(shareMap).reduce((sum, val) => sum + val, 0);
    const totalPersonal = simulatedPersons.reduce((sum, pd) => sum + pd.personalDue, 0);
    const miscPaid = getBufferExpenseSumForMonth(monthKey);
    const miscOpen = getBufferExpenseOpenSumForMonth(monthKey);
    const freeBeforeMisc = simulatedPersons.reduce((sum, pd) => sum + (pd.income - pd.commonShare - pd.personalDue), 0);
    const free = freeBeforeMisc - miscPaid;
    const distributable = Math.max(free, 0);
    const reserves = distributable * savingsConfig.reservesRatio;
    const savings = distributable * savingsConfig.savingsRatio;
    return { personsData: simulatedPersons, totalIncome, totalCommonRounded, totalPersonal, miscPaid, miscOpen, freeBeforeMisc, free, distributable, reserves, savings };
  }

  function addChangeLog(type, text, monthKey = currentMonth) {
    if (!Array.isArray(state.changeLog)) state.changeLog = [];
    state.changeLog.unshift({ id: generateId(), type: type || 'Änderung', text: text || '', month: monthKey, createdAt: new Date().toISOString() });
    state.changeLog = state.changeLog.slice(0, 80);
  }

  function getMonthWarnings(monthKey) {
    const warnings = [];
    const unpaidCommon = state.commonCosts.filter((item) => isDue(item, monthKey) && !isPostPaidForMonth(item, monthKey)).length;
    const unpaidPersonal = state.personalCosts.filter((item) => isDue(item, monthKey) && !isPostPaidForMonth(item, monthKey)).length;
    const unpaidDebts = state.debts.filter((d) => Number(d.amountOpen || 0) > 0 && d.nextDueMonth === monthKey && !d.paidMonths.includes(monthKey)).length;
    const miscOpen = getBufferExpenseOpenSumForMonth(monthKey);
    const free = computeFreeSumForMonth(monthKey);
    if (unpaidCommon > 0) warnings.push({ kind: 'warning', text: `${unpaidCommon} gemeinsame Zahlung(en) noch offen` });
    if (unpaidPersonal > 0) warnings.push({ kind: 'warning', text: `${unpaidPersonal} persönliche Zahlung(en) noch offen` });
    if (unpaidDebts > 0) warnings.push({ kind: 'danger', text: `${unpaidDebts} Schuld(en) diesen Monat noch offen` });
    if (miscOpen > 0) warnings.push({ kind: 'warning', text: `Sonstige Ausgaben offen geplant: ${miscOpen.toFixed(2)} €` });
    if (free < 0) warnings.push({ kind: 'danger', text: `Monat rechnerisch im Minus: ${free.toFixed(2)} €` });
    if (!state.monthlyClosings || !state.monthlyClosings[monthKey]) warnings.push({ kind: 'info', text: 'Monatsabschluss noch offen' });
    return warnings;
  }

  function isMonthClosed(monthKey) {
    return !!(state.monthlyClosings && state.monthlyClosings[monthKey]);
  }
  // ----- Zeitliche Auswahl -----
  const today = new Date();
  const startMonthKey = dateToMonthKey(today);
  let monthList = getNext12Months(startMonthKey);
  let currentMonth = state.appMeta.selectedMonth || startMonthKey;
  if (!monthList.find((m) => m.key === currentMonth)) monthList = getNext12Months(currentMonth);
  if (state.appMeta.lastAutoMonthCheck !== startMonthKey) {
    currentMonth = startMonthKey;
    state.appMeta.lastAutoMonthCheck = startMonthKey;
    state.appMeta.selectedMonth = startMonthKey;
    saveState();
  }
  // ----- DOM-Referenzen -----
  const overviewSection = document.getElementById('overview');
  const commonSection = document.getElementById('common');
  const personalSection = document.getElementById('personal');
  const bufferSection = document.getElementById('buffer');
  const tankCalcSection = document.getElementById('tankcalc');
  const debtsSection = document.getElementById('debts');
  const settingsSection = document.getElementById('settings');
  const savingsSection = document.getElementById('savings');
  const potsSection = document.getElementById('pots');
  const monthCloseSection = document.getElementById('monthclose');
  const dataCheckSection = document.getElementById('datacheck');
  const forecastSection = document.getElementById('forecast');
  const saveSection = document.getElementById('save');
  const sectionSelect = document.getElementById('sectionSelect');
  const reloadButton = document.getElementById('reloadButton');
  const sectionButtons = Array.from(document.querySelectorAll('[data-section]'));
  let currentSection = 'overview';

  // ID des aktuell ausgewählten Topfs für die Detailansicht in
  // renderPots. Ein leerer String bedeutet, dass keine Detailansicht
  // angezeigt wird.
  let selectedPotId = '';
  let debtFilter = 'active';
  let commonSearch = '';
  let commonFilter = 'all';
  let personalSearch = '';
  let personalFilter = 'all';
  let bufferSearch = '';
  let bufferFilter = 'all';
  let debtSearch = '';
  let changeLogFilter = 'all';
  let scenarioNet = {};
  // Navigation: Bereiche wechseln
  function switchSection(section) {
    currentSection = section || 'overview';
    document.querySelectorAll('.tab-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === currentSection);
    });
    if (sectionSelect && sectionSelect.value !== currentSection) sectionSelect.value = currentSection;
    sectionButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === currentSection);
    });
    render();
  }
  if (sectionSelect) {
    sectionSelect.addEventListener('change', (e) => switchSection(e.target.value));
  }
  sectionButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });
  // Reload-Knopf: Seite komplett neu laden (Daten bleiben erhalten)
  reloadButton.addEventListener('click', async () => {
    if (!confirm('Seite komplett neu laden und Updates holen? Ungespeicherte Änderungen gehen verloren.')) {
      return;
    }
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (err) {
      console.warn('Cache/ServiceWorker konnten nicht vollständig gelöscht werden:', err);
    }
    const url = new URL(window.location.href);
    url.searchParams.set('refresh', Date.now().toString());
    // Neu navigieren statt normal reloaden, damit auch aktualisierte index/style/script-Dateien geladen werden.
    window.location.replace(url.toString());
  });
  // ----- Hilfsfunktionen -----
  function getPersonById(id) {
    return state.persons.find((p) => p.id === id);
  }
  function normalizeAllPersonConfigs() {
    if (Array.isArray(state.persons)) state.persons.forEach(ensurePersonIncomeConfig);
  }
  function ensurePersonIncomeConfig(person) {
    if (!person || typeof person !== 'object') return;
    const numericNet = Number(person.net);
    person.net = Number.isFinite(numericNet) && numericNet >= 0 ? numericNet : 0;
    if (!person.netOverrides || typeof person.netOverrides !== 'object' || Array.isArray(person.netOverrides)) {
      person.netOverrides = {};
    }
    Object.keys(person.netOverrides).forEach((month) => {
      const value = Number(person.netOverrides[month]);
      if (!isMonthKey(month) || !Number.isFinite(value) || value < 0) delete person.netOverrides[month];
      else person.netOverrides[month] = value;
    });
    if (!Array.isArray(person.netTimeline)) person.netTimeline = [];
    person.netTimeline = person.netTimeline
      .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)) && Number(entry.amount) >= 0)
      .map((entry) => ({ month: entry.month, amount: Number(entry.amount) }))
      .sort((a, b) => monthDiff(a.month, b.month))
      .filter((entry, index, arr) => arr.findIndex((other) => other.month === entry.month) === index);
  }
  function getPersonBaseNetForMonth(person, month) {
    ensurePersonIncomeConfig(person);
    let amount = Number(person.net || 0);
    const timeline = person.netTimeline
      .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)) && monthDiff(entry.month, month) >= 0)
      .sort((a, b) => monthDiff(a.month, b.month));
    timeline.forEach((entry) => {
      amount = Number(entry.amount);
    });
    return amount;
  }
  function getPersonNet(person, month) {
    ensurePersonIncomeConfig(person);
    if (person.netOverrides && person.netOverrides[month] != null) {
      return Number(person.netOverrides[month]);
    }
    return getPersonBaseNetForMonth(person, month);
  }
  function setPersonNetForMonth(person, month, amount, mode) {
    ensurePersonIncomeConfig(person);
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) return false;
    if (mode === 'once') {
      const baseAmount = getPersonBaseNetForMonth(person, month);
      if (Math.abs(baseAmount - numericAmount) < 0.000001) delete person.netOverrides[month];
      else person.netOverrides[month] = numericAmount;
      return true;
    }
    if (mode === 'future') {
      delete person.netOverrides[month];
      const existing = person.netTimeline.find((entry) => entry && entry.month === month);
      if (existing) existing.amount = numericAmount;
      else person.netTimeline.push({ month, amount: numericAmount });
      person.netTimeline = person.netTimeline
        .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)) && Number(entry.amount) >= 0)
        .sort((a, b) => monthDiff(a.month, b.month))
        .filter((entry, index, arr) => arr.findIndex((other) => other.month === entry.month) === index);
      return true;
    }
    return false;
  }
  function clearPersonNetForMonth(person, month, mode = 'all') {
    ensurePersonIncomeConfig(person);
    if (mode === 'once' || mode === 'all') delete person.netOverrides[month];
    if (mode === 'future' || mode === 'all') {
      person.netTimeline = person.netTimeline.filter((entry) => !(entry && entry.month === month));
    }
  }
  function getPersonNetSourceLabel(person, month) {
    ensurePersonIncomeConfig(person);
    if (person.netOverrides && person.netOverrides[month] != null) return 'nur dieser Monat';
    if (Array.isArray(person.netTimeline) && person.netTimeline.some((entry) => entry && entry.month === month)) {
      return 'dauerhaft ab diesem Monat';
    }
    return 'Standardwert';
  }
  function ensurePostConfig(post) {
    ensurePostScheduleConfig(post);
    ensurePostAmountConfig(post);
    ensurePostPaymentConfig(post);
    ensureLinkedDebtField(post);
  }
  function ensurePostPaymentConfig(post) {
    if (!post || typeof post !== 'object') return;
    if (!Array.isArray(post.paidMonths)) post.paidMonths = [];
    post.paidMonths = post.paidMonths.filter((m, index, arr) => isMonthKey(m) && arr.indexOf(m) === index);
  }
  function isPostPaidForMonth(post, month) {
    ensurePostConfig(post);
    return post.paidMonths.includes(month);
  }
  function setPostPaidForMonth(post, month, paid) {
    ensurePostConfig(post);
    if (!isMonthKey(month)) return false;
    if (paid) {
      if (!post.paidMonths.includes(month)) post.paidMonths.push(month);
    } else {
      post.paidMonths = post.paidMonths.filter((m) => m !== month);
    }
    return true;
  }
  function ensurePostScheduleConfig(post) {
    if (!post || typeof post !== 'object') return;
    post.oneTime = post.oneTime === true;
    const numericInterval = parseInt(post.interval, 10);
    post.interval = Number.isFinite(numericInterval) && numericInterval > 0 ? numericInterval : 1;
    if (post.oneTime && isMonthKey(post.startMonth)) {
      post.interval = 1;
      post.endMonth = post.startMonth;
    } else if (!post.oneTime && !post.endMonth) {
      post.endMonth = '';
    }
  }
  function isOneTimePost(post) {
    ensurePostScheduleConfig(post);
    return post.oneTime === true;
  }
  function getDisplayInterval(post) {
    return isOneTimePost(post) ? 'Einmalig' : String(post.interval);
  }
  function getDisplayEndMonth(post) {
    return isOneTimePost(post) ? post.startMonth : (post.endMonth || '-');
  }
  function getDueBadgeHtml(dueNow) {
    return `<span class="due-badge ${dueNow ? 'due-yes' : 'due-no'}">${dueNow ? 'Ja' : 'Nein'}</span>`;
  }
  function promptForPostType(existingPost) {
    const selection = prompt(
      `Zahlungsart wählen:
1 = einmalige Zahlung
2 = laufender Posten`,
      existingPost && isOneTimePost(existingPost) ? '1' : '2'
    );
    if (selection == null) return null;
    const normalized = String(selection).trim().toLowerCase();
    if (normalized === '1' || normalized === 'einmalig' || normalized === 'einmalige zahlung') return 'once';
    if (normalized === '2' || normalized === 'laufend' || normalized === 'regelmäßig' || normalized === 'wiederkehrend') return 'recurring';
    alert('Bitte 1 für „einmalige Zahlung“ oder 2 für „laufender Posten“ eingeben.');
    return null;
  }
  function promptForPostLimit(existingPost) {
    const selection = prompt(
      `Soll der Posten befristet sein?
1 = ja, bis zu einem Endmonat
2 = nein, unbegrenzt`,
      existingPost && !isOneTimePost(existingPost) && existingPost.endMonth ? '1' : '2'
    );
    if (selection == null) return null;
    const normalized = String(selection).trim().toLowerCase();
    if (normalized === '1' || normalized === 'ja' || normalized === 'befristet') return true;
    if (normalized === '2' || normalized === 'nein' || normalized === 'unbegrenzt') return false;
    alert('Bitte 1 für „ja, befristet“ oder 2 für „nein, unbegrenzt“ eingeben.');
    return null;
  }
  function validateScheduleSettings(schedule) {
    if (!schedule || !isMonthKey(schedule.startMonth)) {
      return { ok: false, message: 'Startmonat muss im Format JJJJ-MM vorliegen.' };
    }
    if (schedule.oneTime) {
      return { ok: true, value: { oneTime: true, interval: 1, endMonth: schedule.startMonth } };
    }
    const interval = parseInt(schedule.interval, 10);
    if (!Number.isFinite(interval) || interval < 1) {
      return { ok: false, message: 'Intervall muss mindestens 1 betragen.' };
    }
    const endMonth = schedule.endMonth ? String(schedule.endMonth).trim() : '';
    if (endMonth && !isMonthKey(endMonth)) {
      return { ok: false, message: 'Endmonat muss im Format JJJJ-MM vorliegen.' };
    }
    if (endMonth && monthDiff(schedule.startMonth, endMonth) < 0) {
      return { ok: false, message: 'Endmonat darf nicht vor dem Startmonat liegen.' };
    }
    return { ok: true, value: { oneTime: false, interval, endMonth } };
  }
  function applyScheduleSettings(post, schedule) {
    ensurePostScheduleConfig(post);
    post.oneTime = schedule.oneTime === true;
    post.interval = schedule.oneTime ? 1 : schedule.interval;
    post.endMonth = schedule.oneTime ? post.startMonth : (schedule.endMonth || '');
  }
  function togglePostEditScheduleInputs(typeSelect, intervalInput, limitSelect, endInput, startInput) {
    const isOnce = typeSelect.value === 'once';
    intervalInput.disabled = isOnce;
    if (isOnce) {
      intervalInput.value = '1';
      limitSelect.value = 'none';
      limitSelect.disabled = true;
      endInput.value = startInput.value || '';
      endInput.disabled = true;
      return;
    }
    limitSelect.disabled = false;
    const limited = limitSelect.value === 'until';
    endInput.disabled = !limited;
    if (!limited) endInput.value = '';
  }
  function ensurePostAmountConfig(post) {
    if (!post || typeof post !== 'object') return;
    if (!post.amountTimeline || !Array.isArray(post.amountTimeline)) post.amountTimeline = [];
    if (!post.amountOverrides || typeof post.amountOverrides !== 'object' || Array.isArray(post.amountOverrides)) {
      post.amountOverrides = {};
    }
  }
  function getEffectiveBaseAmountForMonth(post, month) {
    ensurePostConfig(post);
    let amount = Number(post.amount || 0);
    const timeline = post.amountTimeline
      .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)) && monthDiff(entry.month, month) >= 0)
      .sort((a, b) => monthDiff(a.month, b.month));
    timeline.forEach((entry) => {
      amount = Number(entry.amount);
    });
    return amount;
  }
  function getEffectiveAmountForMonth(post, month) {
    ensurePostConfig(post);
    const overrideAmount = post.amountOverrides[month];
    if (overrideAmount != null && Number.isFinite(Number(overrideAmount))) {
      return Number(overrideAmount);
    }
    return getEffectiveBaseAmountForMonth(post, month);
  }
  function setPostAmountForMonth(post, month, amount, mode) {
    ensurePostConfig(post);
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) return false;
    if (mode === 'once') {
      const baseAmount = getEffectiveBaseAmountForMonth(post, month);
      if (Math.abs(baseAmount - numericAmount) < 0.000001) delete post.amountOverrides[month];
      else post.amountOverrides[month] = numericAmount;
      return true;
    }
    if (mode === 'future') {
      delete post.amountOverrides[month];
      const existing = post.amountTimeline.find((entry) => entry && entry.month === month);
      if (existing) existing.amount = numericAmount;
      else post.amountTimeline.push({ month, amount: numericAmount });
      post.amountTimeline = post.amountTimeline
        .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)))
        .sort((a, b) => monthDiff(a.month, b.month))
        .filter((entry, index, arr) => arr.findIndex((other) => other.month === entry.month) === index);
      return true;
    }
    return false;
  }
  function askAmountChangeMode(month) {
    const selection = prompt(
      `Betrag für ${formatMonthLabel(month)} ändern:
1 = nur dieser Monat
2 = ab diesem Monat dauerhaft`,
      '1'
    );
    if (selection == null) return null;
    const normalized = String(selection).trim().toLowerCase();
    if (normalized === '1' || normalized === 'einmalig' || normalized === 'monat') return 'once';
    if (normalized === '2' || normalized === 'dauerhaft' || normalized === 'ab jetzt') return 'future';
    alert('Bitte 1 für „nur dieser Monat“ oder 2 für „ab diesem Monat dauerhaft“ eingeben.');
    return null;
  }
  function isMonthKey(value) {
    return /^\d{4}-\d{2}$/.test(String(value || ''));
  }
  function isPostActiveInMonth(post, month) {
    if (!post || !isMonthKey(post.startMonth) || !isMonthKey(month)) return false;
    if (monthDiff(post.startMonth, month) < 0) return false;
    if (post.endMonth && isMonthKey(post.endMonth) && monthDiff(month, post.endMonth) < 0) return false;
    return true;
  }
  function isDue(post, month) {
    if (!isPostActiveInMonth(post, month)) return false;
    const diff = monthDiff(post.startMonth, month);
    return diff >= 0 && diff % post.interval === 0;
  }
  function getCommonMonthlyShare(cost, month = currentMonth) {
    return getEffectiveAmountForMonth(cost, month) / cost.interval;
  }
  /**
   * Berechnet die gerundeten Anteile der gemeinsamen Kosten pro Person.
   * Jeder Anteil wird unabhängig auf das nächsthöhere 5‑€‑Intervall
   * aufgerundet. Es erfolgt keine Anpassung der Summe. Die Summe der
   * resultierenden Anteile kann daher größer sein als die
   * tatsächlichen Gesamtkosten.
   *
   * @param {number} totalMonthly Gesamtsumme aller monatlichen Anteile
   * @param {Array<{person: Object, income: number}>} persons Personen mit ihren Einkommen
   */
  function computeRoundedCommonShares(totalMonthly, persons) {
    const result = {};
    if (!persons || persons.length === 0) return result;
    let totalIncome = 0;
    persons.forEach(({ income }) => (totalIncome += income));
    const roundingStep = 5;
    persons.forEach(({ person, income }) => {
      const ratio = totalIncome ? income / totalIncome : 0;
      const base = ratio * totalMonthly + (person.shift || 0);
      result[person.id] = Math.ceil(base / roundingStep) * roundingStep;
    });
    return result;
  }

  function roundUpToNextTen(value) {
    const num = Number(value || 0);
    if (num <= 0) return 0;
    return Math.ceil(num / 10) * 10;
  }

  function calculateTankBudget(cfg) {
    const priceUsed = Number(cfg && (cfg.avgPrice || cfg.autoPrice) || 0);
    const km = Number(cfg && cfg.kmPerMonth || 0);
    const consumption = Number(cfg && cfg.consumption || 0);
    const raw = (km / 100) * consumption * priceUsed;
    return {
      priceUsed,
      raw,
      rounded: roundUpToNextTen(raw)
    };
  }

  function getTankCalcPersonKey(personIdOrName) {
    const s = String(personIdOrName || '').toLowerCase();
    if (s.includes('madeleine')) return 'madeleine';
    return 'benny';
  }

  function getTankCalcData(personKey) {
    if (!state.tankCalc) state.tankCalc = JSON.parse(JSON.stringify(defaultState.tankCalc));
    if (!state.tankCalc[personKey]) state.tankCalc[personKey] = JSON.parse(JSON.stringify(defaultState.tankCalc[personKey]));
    return state.tankCalc[personKey];
  }

  function getTankApiStatusInfo() {
    if (!state.tankCalc) state.tankCalc = JSON.parse(JSON.stringify(defaultState.tankCalc));
    const lastStatus = state.tankCalc.lastApiStatus || '';
    const lastError = state.tankCalc.lastApiError || '';
    const lastRequest = state.tankCalc.lastRequestAt ? new Date(state.tankCalc.lastRequestAt) : null;
    const lastRequestLabel = lastRequest && !Number.isNaN(lastRequest.getTime())
      ? lastRequest.toLocaleString('de-DE')
      : 'noch kein Abruf';
    return { lastStatus, lastError, lastRequestLabel };
  }

  function setTankApiStatus(status, message) {
    if (!state.tankCalc) state.tankCalc = JSON.parse(JSON.stringify(defaultState.tankCalc));
    state.tankCalc.lastApiStatus = status || '';
    state.tankCalc.lastApiError = message || '';
    state.tankCalc.lastRequestAt = new Date().toISOString();
    saveState();
  }

  function buildTankApiErrorMessage(response, data, fallback) {
    const status = response && response.status ? `HTTP ${response.status}` : '';
    const apiMessage = data && (data.message || data.error || data.status || data.description) ? String(data.message || data.error || data.status || data.description) : '';
    if (response && response.status === 403) return `${status}: API-Key ungültig oder Zugriff verweigert.`;
    if (response && response.status === 429) return `${status}: Zu viele Anfragen. Bitte mindestens 1 Minute warten.`;
    if (response && response.status >= 500) return `${status}: Tankerkönig ist gerade nicht erreichbar.`;
    if (apiMessage) return `${status ? status + ': ' : ''}${apiMessage}`;
    return `${status ? status + ': ' : ''}${fallback || 'Unbekannter Fehler beim Preisabruf.'}`;
  }

  async function getCurrentPositionForTankApi() {
    if (!navigator.geolocation) throw new Error('Standort wird auf diesem Gerät nicht unterstützt.');
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
    });
  }

  function cleanTankApiKey(raw) {
    return String(raw || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[„“”]/g, '"')
      .trim();
  }

  function extractTankApiKey(raw) {
    const cleaned = cleanTankApiKey(raw);
    const uuidMatch = cleaned.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    return uuidMatch ? uuidMatch[0].toLowerCase() : cleaned;
  }

  function isTankApiKeyFormatValid(raw) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanTankApiKey(raw));
  }

  function normalizeTankApiKeyInState() {
    if (!state || !state.tankCalc) return '';
    const extracted = extractTankApiKey(state.tankCalc.apiKey);
    if (state.tankCalc.apiKey !== extracted) {
      state.tankCalc.apiKey = extracted;
    }
    return extracted;
  }

  function shouldThrottleTankRequest() {
    const last = state.tankCalc && state.tankCalc.lastRequestAt ? new Date(state.tankCalc.lastRequestAt) : null;
    if (!last || Number.isNaN(last.getTime())) return false;
    const diffSeconds = (Date.now() - last.getTime()) / 1000;
    return diffSeconds >= 0 && diffSeconds < 60;
  }

  async function requestTankApi(personKey, diagnosticOnly = false) {
    const cfg = getTankCalcData(personKey);
    const apiKey = normalizeTankApiKeyInState();
    if (!apiKey) {
      setTankApiStatus('Fehler', 'API-Key fehlt.');
      throw new Error('API-Key fehlt.');
    }
    if (!isTankApiKeyFormatValid(apiKey)) {
      const msg = 'API-Key hat kein gültiges UUID-Format. Bitte den reinen Schlüssel im Format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx einfügen, ohne Leerzeichen, Anführungszeichen oder Link.';
      setTankApiStatus('Fehler', msg);
      throw new Error(msg);
    }
    if (shouldThrottleTankRequest()) {
      const msg = 'Bitte mindestens 1 Minute zwischen Tankerkönig-Abfragen warten.';
      setTankApiStatus('Limit', msg);
      throw new Error(msg);
    }

    let position;
    try {
      position = await getCurrentPositionForTankApi();
    } catch (err) {
      const msg = err && err.message ? err.message : 'Standort konnte nicht geladen werden.';
      setTankApiStatus('Fehler', msg);
      throw new Error(msg);
    }

    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const rad = Math.min(Math.max(Number(state.tankCalc.radiusKm || 5), 1), 25);
    const fuelType = cfg.fuelType || 'diesel';

    const url = new URL('https://creativecommons.tankerkoenig.de/json/list.php');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lng', String(lng));
    url.searchParams.set('rad', String(rad));
    url.searchParams.set('sort', 'price');
    url.searchParams.set('type', fuelType);
    url.searchParams.set('apikey', apiKey);

    let response;
    let data;
    try {
      response = await fetch(url.toString(), { cache: 'no-store' });
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch (err) {
        data = { message: text || 'Keine JSON-Antwort erhalten.' };
      }
    } catch (err) {
      const msg = 'Netzwerk-/CORS-Fehler oder Tankerkönig nicht erreichbar.';
      setTankApiStatus('Fehler', msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.ok) {
      const msg = buildTankApiErrorMessage(response, data, 'Preisabruf wurde von Tankerkönig abgelehnt.');
      setTankApiStatus('Fehler', msg);
      throw new Error(msg);
    }

    if (!Array.isArray(data.stations) || data.stations.length === 0) {
      const msg = `Keine offene Tankstelle im Radius ${rad} km gefunden.`;
      setTankApiStatus('Keine Daten', msg);
      throw new Error(msg);
    }

    const station = data.stations[0];
    const price = Number(station.price ?? station[fuelType]);
    if (!price || Number.isNaN(price)) {
      const msg = 'Antwort erhalten, aber kein gültiger Preis in der Datenquelle gefunden.';
      setTankApiStatus('Keine Daten', msg);
      throw new Error(msg);
    }

    setTankApiStatus('OK', `${diagnosticOnly ? 'Test erfolgreich' : 'Preis geladen'}: ${station.name || station.brand || 'Tankstelle'} · ${price.toFixed(3)} €/l`);
    return { station, price };
  }

  async function testTankApiKey() {
    try {
      await requestTankApi('benny', true);
      alert('API-Test erfolgreich. Tankerkönig liefert Preise.');
      render();
    } catch (err) {
      alert(`API-Test fehlgeschlagen: ${err.message || err}`);
      render();
    }
  }

  async function fetchAutomaticFuelPrice(personKey) {
    const cfg = getTankCalcData(personKey);
    try {
      const { station, price } = await requestTankApi(personKey, false);
      cfg.autoPrice = price.toFixed(3);
      if (!cfg.avgPrice) cfg.avgPrice = price.toFixed(3);
      cfg.stationName = station.name || station.brand || '';
      cfg.lastFetch = new Date().toLocaleString('de-DE');
      saveState();
      render();
    } catch (err) {
      alert(`Preisabruf fehlgeschlagen: ${err.message || err}`);
      render();
    }
  }

  function upsertTankgeldAsPersonalExpense(personKey) {
    const cfg = getTankCalcData(personKey);
    const avgPrice = Number(cfg.avgPrice || cfg.autoPrice || 0);
    const km = Number(cfg.kmPerMonth || 0);
    const consumption = Number(cfg.consumption || 0);

    if (!avgPrice || !km || !consumption) {
      alert('Bitte zuerst Kilometer, Verbrauch und Preis ausfüllen.');
      return;
    }

    const calculated = roundUpToNextTen((km / 100) * consumption * avgPrice);
    const person = state.persons.find((p) => getTankCalcPersonKey(p.id || p.name) === personKey);
    const personId = person ? person.id : personKey;

    const existing = state.personalCosts.find((item) => {
      const samePerson = String(item.personId || '').toLowerCase() === String(personId).toLowerCase();
      const name = String(item.name || '').toLowerCase();
      return samePerson && name.includes('tankgeld');
    });

    if (existing) {
      existing.amount = calculated;
      existing.interval = 1;
      if (!existing.startMonth) existing.startMonth = currentMonth;
    } else {
      const label = personKey === 'madeleine' ? 'Tankgeld Seat (Arbeitsweg)' : 'Tankgeld Smart (Arbeitsweg)';
      state.personalCosts.push({
        id: 'tankgeld_' + personKey,
        personId: personId,
        name: label,
        amount: calculated,
        interval: 1,
        startMonth: currentMonth,
        paidMonths: []
      });
    }

    saveState();
    render();
    alert('Tankgeld wurde bei den persönlichen Ausgaben übernommen.');
  }


  function getReserveItemKey(monthKey, itemName) {
    return `${monthKey}__${itemName}`;
  }

  function getReserveItemAmount(monthKey, itemName) {
    if (itemName === 'Sparen') return getSavingsContribution(monthKey);
    return getReserveContributionForPot(itemName, monthKey);
  }

  function ensurePotByName(potName) {
    if (!state.pots) state.pots = [];
    let pot = state.pots.find((p) => p.name === potName);
    if (!pot) {
      pot = { id: generateId(), name: potName, balance: 0, transactions: [] };
      state.pots.push(pot);
    }
    if (!pot.transactions) pot.transactions = [];
    if (typeof pot.balance !== 'number') pot.balance = Number(pot.balance || 0);
    return pot;
  }

  function syncReserveItemWithPot(monthKey, itemName, shouldApply) {
    const amount = getReserveItemAmount(monthKey, itemName);
    if (!(amount > 0)) return;
    const pot = ensurePotByName(itemName);
    const itemKey = getReserveItemKey(monthKey, itemName);
    const existingIndex = pot.transactions.findIndex((t) => t && t.source === 'reserve_auto' && t.itemKey === itemKey);

    if (shouldApply) {
      if (existingIndex === -1) {
        pot.transactions.push({
          date: monthKey,
          type: 'deposit',
          amount: amount,
          description: `Automatisch zurückgelegt (${monthKey})`,
          source: 'reserve_auto',
          itemKey: itemKey
        });
        pot.balance += amount;
      }
    } else if (existingIndex >= 0) {
      const existing = pot.transactions[existingIndex];
      pot.balance -= Number(existing.amount || 0);
      pot.transactions.splice(existingIndex, 1);
    }
  }

  function syncAllReserveSelectionsToPots() {
    if (!state.reserveItemSaved) state.reserveItemSaved = {};
    Object.entries(state.reserveItemSaved).forEach(([monthKey, items]) => {
      if (!items || typeof items !== 'object') return;
      Object.entries(items).forEach(([itemName, isSaved]) => {
        if (isSaved) syncReserveItemWithPot(monthKey, itemName, true);
      });
    });
  }

  // ----- Rendering -----
  function showSectionError(sectionEl, label, error) {
    if (!sectionEl) return;
    console.error('Renderfehler in ' + label, error);
    sectionEl.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card error-card';
    card.innerHTML = `<h2>${label}</h2><p>Dieser Bereich konnte gerade nicht geladen werden. Deine gespeicherten Daten wurden nicht verändert.</p><p class="hint">Bitte einmal neu laden oder einen Backup-Export sichern.</p>`;
    sectionEl.appendChild(card);
  }

  function runRenderStep(label, sectionEl, fn) {
    try {
      fn();
    } catch (error) {
      showSectionError(sectionEl, label, error);
    }
  }

  function render() {
    try { syncCurrentMonthToActualDate(); } catch (error) { console.error('Monatsprüfung fehlgeschlagen', error); }

    runRenderStep('Übersicht', overviewSection, renderOverview);
    runRenderStep('Gemeinsame Kosten', commonSection, renderCommon);
    runRenderStep('Persönliche Ausgaben', personalSection, renderPersonal);
    runRenderStep('Sonstige Ausgaben', bufferSection, renderBufferExpenses);
    runRenderStep('Tankgeldberechnung', tankCalcSection, renderTankCalc);
    runRenderStep('Schulden', debtsSection, renderDebts);
    runRenderStep('Regeln & Personen', settingsSection, renderSettings);
    runRenderStep('Rücklagen & Sparen', savingsSection, renderSavings);
    runRenderStep('Töpfe', potsSection, renderPots);
    runRenderStep('Monatsabschluss', monthCloseSection, renderMonthClose);
    runRenderStep('Datencheck', dataCheckSection, renderDataCheck);
    runRenderStep('Vorschau & Simulation', forecastSection, renderForecast);
    runRenderStep('Sichern', saveSection, renderSave);

    if (sectionSelect && sectionSelect.value !== currentSection) {
      sectionSelect.value = currentSection;
    }
    sectionButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === currentSection);
    });
    document.querySelectorAll('.tab-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === currentSection);
    });
    try { enableTableSorting(); } catch (error) { console.error('Tabellensortierung fehlgeschlagen', error); }
  }

  function getAllCostPosts() {
    const list = [];
    (state.commonCosts || []).forEach((post) => list.push({ area: 'Gemeinsame Kosten', post }));
    (state.personalCosts || []).forEach((post) => {
      const person = getPersonById(post.personId);
      list.push({ area: person ? `Persönlich · ${person.name}` : 'Persönliche Ausgaben', post });
    });
    return list;
  }

  function getLinkedPostsForDebt(debt) {
    const debtName = normalizeTextKey(debt.name);
    return getAllCostPosts().filter(({ post }) => {
      if (post.linkedDebtId && post.linkedDebtId === debt.id) return true;
      return normalizeTextKey(post.name) === debtName;
    });
  }

  function getDataCheckItems() {
    const items = [];
    const autoLinkedNow = autoLinkMatchingDebtPosts();
    if (autoLinkedNow > 0) saveState();

    const allPosts = getAllCostPosts();
    allPosts.forEach(({ area, post }) => {
      const exactDebt = findDebtByExactName(post.name);
      if (exactDebt && post.linkedDebtId !== exactDebt.id) {
        items.push({
          kind: 'warning',
          area,
          title: `Schuld-Verknüpfung prüfen: ${post.name}`,
          detail: `Es gibt eine gleichnamige Schuld, aber der Posten ist noch nicht eindeutig verknüpft.`
        });
      }
      const linked = getLinkedDebtForPost(post);
      if (linked && isDue(post, currentMonth)) {
        const postAmount = getEffectiveAmountForMonth(post, currentMonth);
        const debtRate = getDebtRateForMonth(linked, currentMonth);
        if (debtRate > 0 && Math.abs(postAmount - debtRate) > 0.01) {
          items.push({
            kind: 'warning',
            area,
            title: `Rate weicht ab: ${post.name}`,
            detail: `Posten ${postAmount.toFixed(2)} € · Schuld ${debtRate.toFixed(2)} €. Das kann gewollt sein, sollte aber sichtbar geprüft werden.`
          });
        }
        if (linked.nextDueMonth !== currentMonth && !linked.paidMonths.includes(currentMonth)) {
          items.push({
            kind: 'warning',
            area,
            title: `Fälligkeit weicht ab: ${post.name}`,
            detail: `Posten ist in ${formatMonthLabel(currentMonth)} fällig, die Schuld steht aber auf ${linked.nextDueMonth || 'keinen Monat'}.`
          });
        }
      }
    });



    (state.bufferExpenses || []).forEach((misc) => {
      if (!isDue(misc, currentMonth)) return;
      const matchingCommon = (state.commonCosts || []).find((cost) => normalizeTextKey(cost.name) === normalizeTextKey(misc.name) && isPostActiveInMonth(cost, currentMonth));
      if (matchingCommon) {
        items.push({
          kind: 'info',
          area: 'Sonstige Ausgaben',
          title: `Echte Zahlung zusätzlich zur Planung: ${misc.name}`,
          detail: `Dieser Name existiert auch bei den gemeinsamen Kosten. Das ist okay, wenn die gemeinsamen Kosten den Monatsanteil planen und diese Ausgabe die echte Zahlung im Monat darstellt.`
        });
      }
    });

    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      const linkedPosts = getLinkedPostsForDebt(debt);
      if (Number(debt.amountOpen || 0) > 0 && debt.paymentType === 'open_plan') {
        items.push({
          kind: 'warning',
          area: 'Schulden',
          title: `Ratenplan offen: ${debt.name}`,
          detail: `Es ist noch ${Number(debt.amountOpen || 0).toFixed(2)} € offen, aber keine Monatsrate hinterlegt.`
        });
      }
      if (debt.nextDueMonth === currentMonth && getDebtRateForMonth(debt, currentMonth) > 0) {
        const matchingDuePost = linkedPosts.some(({ post }) => isDue(post, currentMonth));
        if (!matchingDuePost) {
          items.push({
            kind: 'warning',
            area: 'Schulden',
            title: `Schuld ohne fälligen Kostenposten: ${debt.name}`,
            detail: `Die Schuld ist diesen Monat fällig, aber in Gemeinsame/Persönliche Ausgaben ist kein verknüpfter fälliger Posten aktiv.`
          });
        }
      }
    });

    if (!state.tankCalc || !state.tankCalc.apiKey) {
      items.push({
        kind: 'warning',
        area: 'Tankgeld',
        title: 'API-Key fehlt',
        detail: 'Die automatische Preisabfrage funktioniert erst nach Eingabe eines API-Keys.'
      });
    }

    const actualMonth = dateToMonthKey(new Date());
    if (currentMonth !== actualMonth) {
      items.push({
        kind: 'info',
        area: 'Monat',
        title: `Ausgewählter Monat: ${formatMonthLabel(currentMonth)}`,
        detail: `Der echte aktuelle Monat ist ${formatMonthLabel(actualMonth)}. Das ist okay, wenn du bewusst einen anderen Monat prüfst.`
      });
    }

    const reserveCheckMonth = addMonths(savingsConfig.startMonth, 1);
    const reserveCheckValue = getSavingsContribution(reserveCheckMonth) + Object.keys(savingsConfig.reservePotShares).reduce((sum, key) => sum + getReserveContributionForPot(key, reserveCheckMonth), 0);
    if (monthDiff(savingsConfig.startMonth, reserveCheckMonth) >= 0 && Number.isFinite(reserveCheckValue)) {
      items.push({
        kind: 'success',
        area: 'Rücklagen',
        title: 'Datumslogik geprüft',
        detail: `Rücklagen/Sparen werden auch nach dem Startmonat weiter berechnet.`
      });
    }

    if (items.filter((item) => item.kind === 'warning' || item.kind === 'danger').length === 0) {
      items.unshift({
        kind: 'success',
        area: 'System',
        title: 'Keine kritischen Datenfehler gefunden',
        detail: 'Die wichtigsten Verknüpfungen, Fälligkeiten und Speicherdaten sehen aktuell sauber aus.'
      });
    }

    return items;
  }

  function renderDataCheckCard() {
    const items = getDataCheckItems();
    const card = document.createElement('div');
    card.className = 'card';
    const title = document.createElement('h2');
    title.textContent = 'Datencheck';
    card.appendChild(title);

    const warnings = items.filter((item) => item.kind === 'warning' || item.kind === 'danger').length;
    const success = items.filter((item) => item.kind === 'success').length;
    const info = items.filter((item) => item.kind === 'info').length;
    card.appendChild(createSummaryMetrics([
      { label: 'Warnungen', value: String(warnings), kind: warnings > 0 ? 'warning' : 'success' },
      { label: 'OK-Meldungen', value: String(success), kind: success > 0 ? 'success' : '' },
      { label: 'Hinweise', value: String(info) },
      { label: 'Geprüfter Monat', value: formatMonthLabel(currentMonth) }
    ]));

    const table = document.createElement('table');
    table.className = 'list-table';
    table.innerHTML = '<thead><tr><th>Status</th><th>Bereich</th><th>Prüfung</th><th>Details</th></tr></thead>';
    const tbody = document.createElement('tbody');
    items.forEach((item) => {
      const tr = document.createElement('tr');
      const label = item.kind === 'success' ? 'OK' : (item.kind === 'warning' ? 'Prüfen' : (item.kind === 'danger' ? 'Fehler' : 'Info'));
      const cls = item.kind === 'success' ? 'success' : (item.kind === 'warning' ? 'warning' : (item.kind === 'danger' ? 'danger' : ''));
      tr.innerHTML = `<td><span class="pill ${cls}">${label}</span></td><td>${item.area}</td><td>${item.title}</td><td>${item.detail}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    return card;
  }

  // Rendert die Übersicht
  function renderOverview() {
    overviewSection.innerHTML = '';

    let totalIncome = 0;
    const personsData = state.persons.map((p) => {
      const income = getPersonNet(p, currentMonth);
      totalIncome += income;
      return { person: p, income, commonShare: 0, personalDue: 0 };
    });

    let totalCommonRaw = 0;
    state.commonCosts.forEach((c) => {
      if (isPostActiveInMonth(c, currentMonth)) totalCommonRaw += getCommonMonthlyShare(c, currentMonth);
    });
    const shareMap = computeRoundedCommonShares(
      totalCommonRaw,
      state.persons.map((p) => ({ person: p, income: getPersonNet(p, currentMonth) }))
    );
    personsData.forEach((pd) => {
      pd.commonShare = shareMap[pd.person.id] || 0;
    });

    state.personalCosts.forEach((pc) => {
      if (isDue(pc, currentMonth)) {
        const pd = personsData.find((x) => x.person.id === pc.personId);
        if (pd) pd.personalDue += getEffectiveAmountForMonth(pc, currentMonth);
      }
    });

    const totalCommonRounded = Object.values(shareMap).reduce((sum, val) => sum + val, 0);
    const totalPersonal = personsData.reduce((sum, pd) => sum + pd.personalDue, 0);
    const totalAvailBeforeBuffer = personsData.reduce((sum, pd) => sum + (pd.income - pd.commonShare - pd.personalDue), 0);
    const miscPaid = getBufferExpenseSumForMonth(currentMonth);
    const miscOpen = getBufferExpenseOpenSumForMonth(currentMonth);
    const totalAvail = totalAvailBeforeBuffer - miscPaid;

    function euro(value) {
      return `${Number(value || 0).toFixed(2)} €`;
    }
    function percent(value, base) {
      if (!base) return '0,0 %';
      return `${((Number(value || 0) / Number(base || 1)) * 100).toFixed(1).replace('.', ',')} %`;
    }
    function div(cls, text) {
      const el = document.createElement('div');
      if (cls) el.className = cls;
      if (text !== undefined && text !== null) el.textContent = text;
      return el;
    }
    function makeIcon(symbol, cls = '') {
      const el = div(`modern-icon ${cls}`.trim());
      el.setAttribute('aria-hidden', 'true');
      el.textContent = symbol;
      return el;
    }
    function createKpi({ label, value, hint, icon, accent, hero, chip }) {
      const card = div(`dash-kpi${hero ? ' dash-kpi-hero' : ''}${accent ? ` ${accent}` : ''}`);
      const top = div('dash-kpi-top');
      top.appendChild(makeIcon(icon || '•'));
      const labelEl = div('dash-kpi-label', label);
      top.appendChild(labelEl);
      card.appendChild(top);
      const valueEl = div('dash-kpi-value', value);
      card.appendChild(valueEl);
      if (hint) card.appendChild(div('dash-kpi-hint', hint));
      if (chip) card.appendChild(div('dash-kpi-chip', chip));
      return card;
    }
    function createBufferItem(icon, label, value) {
      const item = div('buffer-strip-item');
      item.appendChild(makeIcon(icon, 'quiet'));
      const txt = div('buffer-strip-text');
      txt.appendChild(div('buffer-strip-label', label));
      txt.appendChild(div('buffer-strip-value', value));
      item.appendChild(txt);
      return item;
    }

    const page = div('dashboard-page');

    const header = div('dashboard-header');
    const titleWrap = div('dashboard-title-wrap');
    const title = document.createElement('h2');
    title.textContent = 'Haushaltsplaner';
    const subtitle = document.createElement('p');
    subtitle.textContent = `Übersicht für ${formatMonthLabel(currentMonth)}`;
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);
    header.appendChild(titleWrap);

    const tools = div('dashboard-tools');
    const monthSelect = createMonthSelect();
    monthSelect.className = 'dashboard-month-select';
    monthSelect.addEventListener('change', (e) => {
      setCurrentMonth(e.target.value);
      render();
    });
    tools.appendChild(monthSelect);
    const bell = document.createElement('button');
    bell.type = 'button';
    bell.className = 'round-tool';
    bell.textContent = '●';
    bell.title = 'Status';
    tools.appendChild(bell);
    const profile = document.createElement('button');
    profile.type = 'button';
    profile.className = 'round-tool';
    profile.textContent = '👤';
    profile.title = 'Profil';
    tools.appendChild(profile);
    header.appendChild(tools);
    page.appendChild(header);

    const kpiGrid = div('dash-kpi-grid');
    kpiGrid.appendChild(createKpi({
      label: 'Aktuell verfügbar',
      value: euro(totalAvail),
      hint: miscPaid > 0 ? `vor sonstigen Ausgaben: ${euro(totalAvailBeforeBuffer)}` : 'Monatsrest für Töpfe',
      icon: '▣',
      hero: true,
      chip: totalAvail >= 0 ? 'Verfügbar' : 'Achtung'
    }));
    kpiGrid.appendChild(createKpi({
      label: 'Netto gesamt',
      value: euro(totalIncome),
      hint: 'Gesamte Nettoeinnahmen',
      icon: '€',
      accent: 'mint'
    }));
    kpiGrid.appendChild(createKpi({
      label: 'Gemeinsame Kosten',
      value: euro(totalCommonRounded),
      hint: `${percent(totalCommonRounded, totalIncome)} des Nettoeinkommens`,
      icon: '👥',
      accent: 'blue'
    }));
    kpiGrid.appendChild(createKpi({
      label: 'Persönliche Ausgaben',
      value: euro(totalPersonal),
      hint: `${percent(totalPersonal, totalIncome)} des Nettoeinkommens`,
      icon: '◷',
      accent: 'violet'
    }));
    page.appendChild(kpiGrid);

    if (miscPaid > 0 || miscOpen > 0) {
      const miscStrip = div('buffer-strip misc-expense-strip');
      miscStrip.appendChild(createBufferItem('▤', 'Sonstige Ausgaben bezahlt', euro(miscPaid)));
      miscStrip.appendChild(createBufferItem('◌', 'Sonstige Ausgaben offen geplant', euro(miscOpen)));
      const miscChip = div(`buffer-status-chip ${miscOpen > 0 ? 'warning' : 'success'}`, miscOpen > 0 ? 'Offene Ausgaben prüfen' : 'Alles bezahlt');
      miscStrip.appendChild(miscChip);
      page.appendChild(miscStrip);
    }

    const financeStatus = getFinanceStatus(totalAvail);
    const criticalMonths = findCriticalMonths(currentMonth);
    const financeCard = div('card compact-card finance-guard-card');
    const financeTitle = document.createElement('h3');
    financeTitle.textContent = 'Finanz-Ampel';
    financeCard.appendChild(financeTitle);
    const financeChips = div('status-chip-list');
    const mainChip = document.createElement('span');
    mainChip.className = `pill ${financeStatus.kind}`;
    mainChip.textContent = `${formatMonthLabel(currentMonth)}: ${financeStatus.label}`;
    financeChips.appendChild(mainChip);
    const mainHint = document.createElement('span');
    mainHint.className = 'pill';
    mainHint.textContent = financeStatus.text;
    financeChips.appendChild(mainHint);
    if (criticalMonths.length > 0) {
      criticalMonths.forEach((item) => {
        const chip = document.createElement('span');
        chip.className = 'pill danger';
        chip.textContent = `${item.label}: ${item.free.toFixed(2)} €`;
        financeChips.appendChild(chip);
      });
    } else {
      const chip = document.createElement('span');
      chip.className = 'pill success';
      chip.textContent = 'Keine negativen Monate in der 12-Monats-Vorschau';
      financeChips.appendChild(chip);
    }
    financeCard.appendChild(financeChips);
    page.appendChild(financeCard);

    const lower = div('dashboard-lower-grid');
    const peopleGrid = div('person-modern-grid');
    personsData.forEach((pd) => {
      const available = pd.income - pd.commonShare - pd.personalDue;
      const personCard = div('person-modern-card');
      const top = div('person-modern-top');
      const left = div('person-modern-title');
      const avatar = div('person-avatar', (pd.person.name || '?').trim().charAt(0).toUpperCase());
      left.appendChild(avatar);
      const name = document.createElement('h3');
      name.textContent = pd.person.name;
      left.appendChild(name);
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Bearbeiten';
      editBtn.className = 'secondary compact edit-pill';
      editBtn.addEventListener('click', () => showPersonIncomeEditor(pd.person));
      top.appendChild(left);
      top.appendChild(editBtn);
      personCard.appendChild(top);

      const rows = div('person-modern-rows');
      [
        ['▣', 'Netto', euro(pd.income), ''],
        ['♟', 'Anteil gemeinsame Kosten', euro(pd.commonShare), percent(pd.commonShare, pd.income)],
        ['◷', 'Persönliche Ausgaben', euro(pd.personalDue), percent(pd.personalDue, pd.income)]
      ].forEach(([icon, label, value, sub]) => {
        const row = div('person-modern-row');
        row.appendChild(makeIcon(icon, 'tiny'));
        row.appendChild(div('person-modern-label', label));
        const valueWrap = div('person-modern-value-wrap');
        valueWrap.appendChild(div('person-modern-value', value));
        if (sub) valueWrap.appendChild(div('person-modern-sub', sub));
        row.appendChild(valueWrap);
        rows.appendChild(row);
      });
      personCard.appendChild(rows);
      const availableBox = div('person-available-box');
      availableBox.appendChild(makeIcon('▣', 'tiny'));
      availableBox.appendChild(div('person-modern-label', 'Verfügbar'));
      availableBox.appendChild(div('person-modern-value', euro(available)));
      personCard.appendChild(availableBox);
      peopleGrid.appendChild(personCard);
    });
    lower.appendChild(peopleGrid);

    page.appendChild(lower);

    const insight = div('dashboard-insight');
    insight.appendChild(makeIcon('▥', 'insight'));
    const insightText = div('dashboard-insight-text');
    const insightTitle = document.createElement('strong');
    insightTitle.textContent = totalAvail >= 0 ? 'Gut geplant!' : 'Achtung, prüfen!';
    const insightSub = document.createElement('span');
    insightSub.textContent = totalAvail >= 0 ? 'Dein Haushalt ist im Gleichgewicht. Weiter so!' : 'Der aktuelle Monat ist rechnerisch im Minus.';
    insightText.appendChild(insightTitle);
    insightText.appendChild(insightSub);
    insight.appendChild(insightText);
    const insightBtn = document.createElement('button');
    insightBtn.type = 'button';
    insightBtn.className = 'secondary compact';
    insightBtn.textContent = 'Details ansehen';
    insightBtn.addEventListener('click', () => {
      currentSection = 'savings';
      render();
    });
    insight.appendChild(insightBtn);
    page.appendChild(insight);

    overviewSection.appendChild(page);
    const dataCheck = renderDataCheckCard();
    if (dataCheck) dataCheck.classList.add('dashboard-data-check');
    overviewSection.appendChild(dataCheck);

    const warnCard = renderWarningsCard(currentMonth);
    if (warnCard) overviewSection.insertBefore(warnCard, dataCheck);
    const logCard = renderChangeLogCard(5);
    if (logCard) overviewSection.appendChild(logCard);
  }

  function matchesSearchText(value, search) {
    const q = String(search || '').trim().toLowerCase();
    if (!q) return true;
    return String(value || '').toLowerCase().includes(q);
  }

  function matchesPostStatus(post, monthKey, filter) {
    const f = filter || 'all';
    const due = isDue(post, monthKey);
    const paid = isPostPaidForMonth(post, monthKey);
    if (f === 'due') return due;
    if (f === 'open') return due && !paid;
    if (f === 'paid') return paid;
    if (f === 'linked') return !!getLinkedDebtForPost(post);
    return true;
  }

  function makeSearchFilterBar(searchValue, filterValue, onSearch, onFilter, options) {
    const wrap = document.createElement('div');
    wrap.className = 'filter-bar';
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Suchen …';
    input.value = searchValue || '';
    input.addEventListener('input', (e) => { onSearch(e.target.value); render(); });
    const select = document.createElement('select');
    (options || [
      ['all', 'Alle'], ['due', 'Fällig'], ['open', 'Offen'], ['paid', 'Bezahlt']
    ]).forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (filterValue === value) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', (e) => { onFilter(e.target.value); render(); });
    wrap.appendChild(input);
    wrap.appendChild(select);
    return wrap;
  }

  function renderWarningsCard(monthKey) {
    const warnings = getMonthWarnings(monthKey);
    const card = document.createElement('div');
    card.className = 'card compact-card dashboard-warnings';
    const h = document.createElement('h3');
    h.textContent = 'Heute wichtig';
    card.appendChild(h);
    if (warnings.length === 0) {
      const p = document.createElement('p');
      p.className = 'small muted';
      p.textContent = 'Keine wichtigen Hinweise.';
      card.appendChild(p);
      return card;
    }
    const list = document.createElement('div');
    list.className = 'status-chip-list';
    warnings.slice(0, 6).forEach((w) => {
      const chip = document.createElement('span');
      chip.className = `pill ${w.kind || ''}`.trim();
      chip.textContent = w.text;
      list.appendChild(chip);
    });
    card.appendChild(list);
    return card;
  }

  function renderChangeLogCard(limit = 10) {
    if (!Array.isArray(state.changeLog) || state.changeLog.length === 0) return null;
    const card = document.createElement('div');
    card.className = 'card compact-card change-log-card';
    const h = document.createElement('h3');
    h.textContent = 'Letzte Änderungen';
    card.appendChild(h);
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-bar compact';
    const select = document.createElement('select');
    [['all','Alle'],['Schulden','Schulden'],['Sonstige Ausgaben','Sonstige Ausgaben'],['Monatsabschluss','Monatsabschluss'],['Einkommen','Einkommen']].forEach(([value,label]) => { const opt = document.createElement('option'); opt.value = value; opt.textContent = label; if (changeLogFilter === value) opt.selected = true; select.appendChild(opt); });
    select.addEventListener('change', (e) => { changeLogFilter = e.target.value; render(); });
    filterRow.appendChild(select);
    card.appendChild(filterRow);
    const list = document.createElement('div');
    list.className = 'change-log-list';
    state.changeLog.filter((entry) => changeLogFilter === 'all' || entry.type === changeLogFilter).slice(0, limit).forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'change-log-row';
      const date = entry.createdAt ? new Date(entry.createdAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      row.innerHTML = `<strong>${entry.type || 'Änderung'}</strong><span>${entry.text || ''}</span><small>${date}${entry.month ? ' · ' + formatMonthLabel(entry.month) : ''}</small>`;
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  function renderDataCheck() {
    if (!dataCheckSection) return;
    dataCheckSection.innerHTML = '';
    const card = renderDataCheckCard();
    if (card) dataCheckSection.appendChild(card);
  }

  function renderForecast() {
    if (!forecastSection) return;
    forecastSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h2');
    h.textContent = '12-Monats-Vorschau & Was-wäre-wenn';
    card.appendChild(h);
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = 'Die Vorschau zeigt den verfügbaren Monatsrest nach deinen aktuellen Daten. Die Simulation verändert nichts an den echten Daten.';
    card.appendChild(p);

    const row = document.createElement('div');
    row.className = 'row';
    state.persons.forEach((person) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.01';
      input.placeholder = `Simulation Netto ${person.name}`;
      input.value = scenarioNet[person.id] || '';
      input.addEventListener('input', (e) => { scenarioNet[person.id] = e.target.value; render(); });
      row.appendChild(createLabelInput(`Was wäre wenn: ${person.name}`, input));
    });
    const clearBtn = document.createElement('button');
    clearBtn.className = 'secondary';
    clearBtn.textContent = 'Simulation löschen';
    clearBtn.addEventListener('click', () => { scenarioNet = {}; render(); });
    row.appendChild(clearBtn);
    card.appendChild(row);

    const months = getNext12Months(currentMonth);
    const table = document.createElement('table');
    table.className = 'list-table';
    table.innerHTML = '<thead><tr><th>Monat</th><th>Netto gesamt</th><th>Gemeinsame Kosten</th><th>Persönliche Ausgaben</th><th>Sonstige bezahlt</th><th>Verfügbar</th><th>Rücklagen 70 %</th><th>Sparen 30 %</th></tr></thead>';
    const tbody = document.createElement('tbody');
    months.forEach(({ key, label }) => {
      const hasScenario = state.persons.some((person) => {
        const raw = scenarioNet[person.id];
        return raw !== '' && raw != null && Number.isFinite(Number(raw));
      });
      const details = hasScenario ? computeMonthDetailsWithScenario(key) : computeMonthDetails(key);
      const free = details.free;
      const distributable = details.distributable;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${label}</td><td>${details.totalIncome.toFixed(2)} €</td><td>${details.totalCommonRounded.toFixed(2)} €</td><td>${details.totalPersonal.toFixed(2)} €</td><td>${details.miscPaid.toFixed(2)} €</td><td><span class="pill ${free < 0 ? 'danger' : 'success'}">${free.toFixed(2)} €</span></td><td>${details.reserves.toFixed(2)} €</td><td>${details.savings.toFixed(2)} €</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    forecastSection.appendChild(card);
  }

  function closeMonth(monthKey) {
    const details = computeMonthDetails(monthKey);
    if (!state.monthlyClosings || typeof state.monthlyClosings !== 'object') state.monthlyClosings = {};
    state.monthlyClosings[monthKey] = {
      closedAt: new Date().toISOString(),
      free: details.free,
      distributable: details.distributable,
      reserves: details.reserves,
      savings: details.savings,
      miscPaid: details.miscPaid,
      miscOpen: details.miscOpen
    };
    if (!state.reserveItemSaved) state.reserveItemSaved = {};
    if (!state.reserveItemSaved[monthKey]) state.reserveItemSaved[monthKey] = {};
    Object.entries(savingsConfig.reservePotShares).forEach(([potName]) => {
      state.reserveItemSaved[monthKey][potName] = true;
      syncReserveItemWithPot(monthKey, potName, true);
    });
    state.reserveItemSaved[monthKey]['Sparen'] = true;
    addChangeLog('Monatsabschluss', `Monat abgeschlossen: ${details.distributable.toFixed(2)} € verteilt`, monthKey);
    saveState();
  }

  function reopenMonth(monthKey) {
    if (state.monthlyClosings) delete state.monthlyClosings[monthKey];
    if (state.reserveItemSaved && state.reserveItemSaved[monthKey]) {
      Object.keys(state.reserveItemSaved[monthKey]).forEach((key) => {
        if (key !== 'Sparen') syncReserveItemWithPot(monthKey, key, false);
      });
      delete state.reserveItemSaved[monthKey];
    }
    addChangeLog('Monatsabschluss', 'Monatsabschluss zurückgesetzt', monthKey);
    saveState();
  }

  function renderMonthClose() {
    if (!monthCloseSection) return;
    monthCloseSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const header = document.createElement('div');
    header.className = 'row';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => { setCurrentMonth(e.target.value); render(); });
    const title = document.createElement('h2');
    title.textContent = 'Monatsabschluss';
    title.style.flex = '1 1 auto';
    header.appendChild(title);
    header.appendChild(monthSelect);
    card.appendChild(header);

    const details = computeMonthDetails(currentMonth);
    const closed = isMonthClosed(currentMonth);
    card.appendChild(createSummaryMetrics([
      { label: 'Verfügbar am Monatsende', value: `${details.free.toFixed(2)} €`, kind: details.free >= 0 ? 'success' : 'danger' },
      { label: 'In Töpfe verteilbar', value: `${details.distributable.toFixed(2)} €`, kind: details.distributable > 0 ? 'success' : '' },
      { label: 'Rücklagen 70 %', value: `${details.reserves.toFixed(2)} €` },
      { label: 'Sparen 30 %', value: `${details.savings.toFixed(2)} €` },
      { label: 'Sonstige bezahlt', value: `${details.miscPaid.toFixed(2)} €` },
      { label: 'Status', value: closed ? '<span class="pill success">Abgeschlossen</span>' : '<span class="pill warning">Offen</span>' }
    ]));
    const wizard = document.createElement('div');
    wizard.className = 'month-wizard';
    wizard.innerHTML = `<div><strong>1. Prüfen</strong><span>Offene Zahlungen und Hinweise kontrollieren</span></div><div><strong>2. Verteilen</strong><span>${details.reserves.toFixed(2)} € Rücklagen · ${details.savings.toFixed(2)} € Sparen</span></div><div><strong>3. Abschließen</strong><span>${closed ? 'Monat ist abgeschlossen' : 'Buchung bestätigen'}</span></div>`;
    card.appendChild(wizard);

    const warnings = getMonthWarnings(currentMonth).filter((w) => !w.text.includes('Monatsabschluss'));
    if (warnings.length > 0) {
      const warn = document.createElement('div');
      warn.className = 'month-close-warning';
      warn.innerHTML = '<strong>Vor dem Abschluss prüfen:</strong>';
      const chips = document.createElement('div');
      chips.className = 'status-chip-list';
      warnings.forEach((w) => {
        const chip = document.createElement('span');
        chip.className = `pill ${w.kind || ''}`.trim();
        chip.textContent = w.text;
        chips.appendChild(chip);
      });
      warn.appendChild(chips);
      card.appendChild(warn);
    }

    const table = document.createElement('table');
    table.className = 'list-table';
    table.innerHTML = '<thead><tr><th>Topf</th><th>Anteil</th><th>Betrag</th></tr></thead>';
    const tbody = document.createElement('tbody');
    Object.entries(savingsConfig.reservePotShares).forEach(([name, share]) => {
      const amount = details.reserves * share;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${name}</td><td>${(share * 100).toFixed(0)} %</td><td>${amount.toFixed(2)} €</td>`;
      tbody.appendChild(tr);
    });
    const saveRow = document.createElement('tr');
    saveRow.innerHTML = `<td>Sparen</td><td>30 % vom Rest</td><td>${details.savings.toFixed(2)} €</td>`;
    tbody.appendChild(saveRow);
    table.appendChild(tbody);
    card.appendChild(table);

    const actions = document.createElement('div');
    actions.className = 'row';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'success';
    closeBtn.textContent = closed ? 'Monat erneut abschließen' : 'Monat abschließen und in Töpfe buchen';
    closeBtn.disabled = details.distributable <= 0;
    closeBtn.addEventListener('click', () => {
      if (closed && !confirm('Monatsabschluss überschreiben?')) return;
      closeMonth(currentMonth);
      render();
    });
    const reopenBtn = document.createElement('button');
    reopenBtn.className = 'secondary';
    reopenBtn.textContent = 'Abschluss zurücksetzen';
    reopenBtn.disabled = !closed;
    reopenBtn.addEventListener('click', () => {
      if (confirm('Monatsabschluss zurücksetzen und automatische Topf-Buchungen entfernen?')) {
        reopenMonth(currentMonth);
        render();
      }
    });
    actions.appendChild(closeBtn);
    actions.appendChild(reopenBtn);
    card.appendChild(actions);

    const note = document.createElement('p');
    note.className = 'small muted';
    note.textContent = 'Der Monatsabschluss bucht die geplanten Rücklagen automatisch in die Töpfe. Du kannst ihn zurücksetzen, solange du den Monat noch korrigierst.';
    card.appendChild(note);
    monthCloseSection.appendChild(card);
  }

  // Rendert den Bereich „Sonstige Ausgaben“
  function renderBufferExpenses() {
    if (!bufferSection) return;
    bufferSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const header = document.createElement('div');
    header.className = 'row';
    const title = document.createElement('h2');
    title.textContent = 'Sonstige Ausgaben';
    title.style.flex = '1 1 auto';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => setCurrentMonth(e.target.value));
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Ausgabe';
    addBtn.className = 'primary';
    addBtn.addEventListener('click', () => showBufferExpenseEditor());
    header.appendChild(title);
    header.appendChild(monthSelect);
    header.appendChild(addBtn);
    card.appendChild(header);

    const planned = getBufferExpensePlannedSumForMonth(currentMonth);
    const paid = getBufferExpenseSumForMonth(currentMonth);
    const open = getBufferExpenseOpenSumForMonth(currentMonth);
    card.appendChild(createSummaryMetrics([
      { label: `Geplant fällig ${formatMonthLabel(currentMonth)}`, value: `${planned.toFixed(2)} €`, kind: planned > 0 ? 'warning' : '' },
      { label: 'Bereits bezahlt', value: `${paid.toFixed(2)} €`, kind: paid > 0 ? 'warning' : 'success' },
      { label: 'Noch offen', value: `${open.toFixed(2)} €`, kind: open > 0 ? 'warning' : 'success' },
      { label: 'Reduziert verfügbar um', value: `${paid.toFixed(2)} €`, kind: paid > 0 ? 'warning' : 'success' }
    ]));

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = 'Hier trägst du sonstige Ausgaben ein, die nicht zu Fixkosten oder Schulden gehören. Erst wenn du sie als bezahlt markierst, reduzieren sie den verfügbaren Monatsbetrag und damit das, was am Monatsende in Töpfe verteilt werden kann.';
    card.appendChild(hint);

    card.appendChild(makeSearchFilterBar(bufferSearch, bufferFilter, (v) => { bufferSearch = v; }, (v) => { bufferFilter = v; }, [['all','Alle'],['due','Fällig'],['open','Offen'],['paid','Bezahlt']]));

    const posts = (state.bufferExpenses || []);
    if (posts.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Noch keine sonstigen Ausgaben eingetragen.';
      card.appendChild(empty);
    } else {
      const table = document.createElement('table');
      table.className = 'list-table';
      table.innerHTML = `<thead><tr><th>Name</th><th>Betrag</th><th>Intervall</th><th>Start</th><th>Bis</th><th>Fällig</th><th>Status</th><th>Aktion</th></tr></thead>`;
      const tbody = document.createElement('tbody');

      posts.forEach((post) => {
        ensurePostConfig(post);
        if (!matchesSearchText(post.name, bufferSearch) || !matchesPostStatus(post, currentMonth, bufferFilter)) return;
        const amount = getEffectiveAmountForMonth(post, currentMonth);
        const dueNow = isDue(post, currentMonth);
        const paidNow = isPostPaidForMonth(post, currentMonth);
        const statusHtml = paidNow
          ? '<span class="pill success">Bezahlt</span>'
          : (dueNow ? '<span class="pill warning">Offen</span>' : '<span class="pill">Nicht fällig</span>');
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${post.name}</td>
          <td>${amount.toFixed(2)} €</td>
          <td>${getDisplayInterval(post)}</td>
          <td>${post.startMonth}</td>
          <td>${getDisplayEndMonth(post)}</td>
          <td>${getDueBadgeHtml(dueNow)}</td>
          <td>${statusHtml}</td>
          <td></td>`;
        const actionCell = tr.children[7];

        const paidBtn = document.createElement('button');
        paidBtn.textContent = 'Als bezahlt';
        paidBtn.className = 'primary';
        paidBtn.disabled = !dueNow || paidNow;
        paidBtn.addEventListener('click', () => {
          setPostPaidForMonth(post, currentMonth, true);
          saveState();
          render();
        });

        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Zurücksetzen';
        resetBtn.className = 'secondary';
        resetBtn.disabled = !paidNow;
        resetBtn.addEventListener('click', () => {
          setPostPaidForMonth(post, currentMonth, false);
          saveState();
          render();
        });

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Bearbeiten';
        editBtn.className = 'primary';
        editBtn.addEventListener('click', () => showBufferExpenseEditor(post));

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Löschen';
        delBtn.className = 'danger';
        delBtn.addEventListener('click', () => {
          if (confirm(`"${post.name}" löschen?`)) {
            state.bufferExpenses = state.bufferExpenses.filter((x) => x.id !== post.id);
            saveState();
            render();
          }
        });

        actionCell.appendChild(paidBtn);
        actionCell.appendChild(resetBtn);
        actionCell.appendChild(editBtn);
        actionCell.appendChild(delBtn);
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      card.appendChild(table);
    }

    bufferSection.appendChild(card);
  }

  // Rendert den Bereich „Gemeinsame Kosten“

function renderCommon() {
    commonSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const header = document.createElement('div');
    header.className = 'row';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      setCurrentMonth(e.target.value);
      render();
    });
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Neuer Posten';
    addBtn.className = 'primary';
    addBtn.style.flex = '0 0 auto';
    addBtn.addEventListener('click', () => showCommonEditor());
    header.appendChild(monthSelect);
    header.appendChild(addBtn);
    card.appendChild(header);

    let totalMonthly = 0;
    let dueSum = 0;
    let paidSum = 0;
    state.commonCosts.forEach((c) => {
      if (isPostActiveInMonth(c, currentMonth)) totalMonthly += getCommonMonthlyShare(c, currentMonth);
      if (isDue(c, currentMonth)) {
        dueSum += getEffectiveAmountForMonth(c, currentMonth);
        if (c.paidMonths && c.paidMonths.includes(currentMonth)) paidSum += getEffectiveAmountForMonth(c, currentMonth);
      }
    });
    const shareMapping = computeRoundedCommonShares(
      totalMonthly,
      state.persons.map((p) => ({ person: p, income: getPersonNet(p, currentMonth) }))
    );
    const roundedSum = Object.values(shareMapping).reduce((sum, val) => sum + val, 0);

    card.appendChild(createSummaryMetrics([
      { label: 'Monatliche Gesamtsumme', value: `${roundedSum.toFixed(2)} €` },
      { label: 'Diesen Monat fällig', value: `${dueSum.toFixed(2)} €`, kind: dueSum > 0 ? 'warning' : '' },
      { label: 'Bereits markiert', value: `${paidSum.toFixed(2)} €`, kind: paidSum > 0 ? 'success' : '' },
      { label: 'Noch offen', value: `${(dueSum - paidSum).toFixed(2)} €`, kind: dueSum - paidSum > 0 ? 'danger' : 'success' }
    ]));
    card.appendChild(makeSearchFilterBar(commonSearch, commonFilter, (v) => { commonSearch = v; }, (v) => { commonFilter = v; }, [['all','Alle'],['due','Fällig'],['open','Offen'],['paid','Bezahlt'],['linked','Mit Schuld verknüpft']]));

    if (state.commonCosts.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Keine gemeinsamen Kosten eingetragen.';
      card.appendChild(p);
    } else {
      const table = document.createElement('table');
      table.className = 'list-table';
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr>
        <th>Name</th>
        <th>Betrag</th>
        <th>Intervall</th>
        <th>Start</th>
        <th>Bis</th>
        <th>Monatsanteil</th>
        <th>Fällig</th>
        <th>Verknüpfte Schuld</th>
        <th>Bezahlt?</th>
        <th>Aktion</th>
      </tr>`;
      table.appendChild(thead);
      const tbody = document.createElement('tbody');

      state.commonCosts.forEach((c) => {
        if (!c.paidMonths) c.paidMonths = [];
        if (!matchesSearchText(c.name, commonSearch) || !matchesPostStatus(c, currentMonth, commonFilter)) return;
        const tr = document.createElement('tr');
        const dueNow = isDue(c, currentMonth);
        const currentAmount = getEffectiveAmountForMonth(c, currentMonth);
        const monthlyShare = getCommonMonthlyShare(c, currentMonth);
        const paidNow = c.paidMonths.includes(currentMonth);
        const linkedDebtName = getLinkedDebtName(c);
        tr.innerHTML = `<td>${c.name}</td>
          <td>${currentAmount.toFixed(2)} €</td>
          <td>${getDisplayInterval(c)}</td>
          <td>${c.startMonth}</td>
          <td>${getDisplayEndMonth(c)}</td>
          <td>${monthlyShare.toFixed(2)} €</td>
          <td>${getDueBadgeHtml(dueNow)}</td>
          <td>${linkedDebtName || '-'}</td>
          <td></td>
          <td></td>`;

        const paidCell = tr.children[8];
        if (dueNow) {
          if (!paidNow) {
            const btn = document.createElement('button');
            btn.textContent = 'Markieren';
            btn.className = 'success';
            btn.addEventListener('click', () => {
              if (!c.paidMonths.includes(currentMonth)) c.paidMonths.push(currentMonth);
              syncDebtPaymentFromPost(c, currentMonth);
              saveState();
              render();
            });
            paidCell.appendChild(btn);
          } else {
            const doneBtn = document.createElement('button');
            doneBtn.textContent = 'Bezahlt';
            doneBtn.disabled = true;
            doneBtn.className = 'secondary';
            paidCell.appendChild(doneBtn);
          }
        } else {
          paidCell.textContent = '-';
        }

        const actionCell = tr.children[10];
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Bearbeiten';
        editBtn.className = 'primary';
        editBtn.addEventListener('click', () => {
          showCommonEditor(c);
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Löschen';
        delBtn.className = 'danger';
        delBtn.addEventListener('click', () => {
          if (confirm(`"${c.name}" löschen?`)) {
            state.commonCosts = state.commonCosts.filter((x) => x.id !== c.id);
            saveState();
            render();
          }
        });
        actionCell.appendChild(editBtn);
        actionCell.appendChild(delBtn);
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      card.appendChild(table);

      const distTable = document.createElement('table');
      distTable.className = 'list-table';
      const distHead = document.createElement('thead');
      distHead.innerHTML = '<tr><th>Person</th><th>Beitrag</th></tr>';
      distTable.appendChild(distHead);
      const distBody = document.createElement('tbody');
      state.persons.forEach((p) => {
        const row = document.createElement('tr');
        const val = shareMapping[p.id] || 0;
        row.innerHTML = `<td>${p.name}</td><td>${val.toFixed(2)} €</td>`;
        distBody.appendChild(row);
      });
      distTable.appendChild(distBody);
      card.appendChild(distTable);
    }

    commonSection.appendChild(card);
  }
  // Editor für gemeinsamen Kostenposten (Prompt-basierter Editor bleibt bestehen)
    
function showCommonEditor(editCost) {
    const refs = {};
    const content = document.createElement('div');
    content.className = 'modal-form';
    const info = document.createElement('p');
    info.className = 'small muted';
    info.textContent = `Monat für die Bearbeitung: ${formatMonthLabel(currentMonth)}`;
    content.appendChild(info);

    const row1 = document.createElement('div');
    row1.className = 'row';
    refs.nameInput = document.createElement('input');
    refs.nameInput.type = 'text';
    refs.nameInput.value = editCost ? editCost.name : '';
    refs.amountInput = document.createElement('input');
    refs.amountInput.type = 'number';
    refs.amountInput.step = '0.01';
    refs.amountInput.value = editCost ? getEffectiveAmountForMonth(editCost, currentMonth) : '';
    row1.appendChild(createLabelInput('Name', refs.nameInput));
    row1.appendChild(createLabelInput('Betrag', refs.amountInput));
    content.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'row';
    refs.typeSelect = document.createElement('select');
    refs.typeSelect.innerHTML = '<option value="once">Einmalig</option><option value="recurring">Laufend</option>';
    refs.typeSelect.value = editCost && isOneTimePost(editCost) ? 'once' : 'recurring';
    refs.intervalInput = document.createElement('input');
    refs.intervalInput.type = 'number';
    refs.intervalInput.min = '1';
    refs.intervalInput.step = '1';
    refs.intervalInput.value = editCost ? editCost.interval : 1;
    refs.startInput = document.createElement('input');
    refs.startInput.type = 'month';
    refs.startInput.value = editCost ? editCost.startMonth : currentMonth;
    row2.appendChild(createLabelInput('Zahlungsart', refs.typeSelect));
    row2.appendChild(createLabelInput('Intervall in Monaten', refs.intervalInput));
    row2.appendChild(createLabelInput('Startmonat', refs.startInput));
    content.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'row';
    refs.limitSelect = document.createElement('select');
    refs.limitSelect.innerHTML = '<option value="none">Unbegrenzt</option><option value="until">Befristet bis</option>';
    refs.limitSelect.value = editCost && !isOneTimePost(editCost) && editCost.endMonth ? 'until' : 'none';
    refs.endInput = document.createElement('input');
    refs.endInput.type = 'month';
    refs.endInput.value = editCost && !isOneTimePost(editCost) && editCost.endMonth ? editCost.endMonth : '';
    row3.appendChild(createLabelInput('Laufzeit', refs.limitSelect));
    row3.appendChild(createLabelInput('Bis Monat', refs.endInput));
    content.appendChild(row3);

    const row4 = document.createElement('div');
    row4.className = 'row';
    refs.debtSelect = document.createElement('select');
    refs.debtSelect.innerHTML = '<option value="">Keine verknüpfte Schuld</option>';
    state.debts.forEach((debt) => {
      const option = document.createElement('option');
      option.value = debt.id;
      option.textContent = debt.name;
      refs.debtSelect.appendChild(option);
    });
    refs.debtSelect.value = editCost && editCost.linkedDebtId ? editCost.linkedDebtId : '';
    row4.appendChild(createLabelInput('Schuld verknüpfen', refs.debtSelect));
    content.appendChild(row4);

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = editCost
      ? 'Wenn sich der Betrag ändert, fragt die App wie bisher, ob die Änderung nur für diesen Monat oder ab jetzt dauerhaft gilt.'
      : 'Neue Posten werden direkt mit ihren Laufzeitregeln gespeichert. Optional kannst du hier auch eine Schuld verknüpfen.';
    content.appendChild(hint);

    const syncScheduleInputs = () => togglePostEditScheduleInputs(
      refs.typeSelect,
      refs.intervalInput,
      refs.limitSelect,
      refs.endInput,
      refs.startInput
    );
    refs.typeSelect.addEventListener('change', syncScheduleInputs);
    refs.limitSelect.addEventListener('change', syncScheduleInputs);
    refs.startInput.addEventListener('change', syncScheduleInputs);
    syncScheduleInputs();

    showModal(editCost ? 'Gemeinsamen Posten bearbeiten' : 'Neuen gemeinsamen Posten anlegen', content, [
      {
        label: 'Abbrechen',
        className: 'secondary',
        onClick: (close) => close()
      },
      {
        label: editCost ? 'Speichern' : 'Anlegen',
        className: 'primary',
        onClick: (close) => {
          const name = refs.nameInput.value.trim();
          const amount = parseFloat(refs.amountInput.value);
          const startMonth = refs.startInput.value;
          if (!name) return alert('Name darf nicht leer sein.');
          if (Number.isNaN(amount) || amount < 0) return alert('Bitte einen gültigen Betrag eingeben.');
          const scheduleValidation = validateScheduleSettings({
            oneTime: refs.typeSelect.value === 'once',
            interval: refs.intervalInput.value,
            startMonth,
            endMonth: refs.limitSelect.value === 'until' ? refs.endInput.value : ''
          });
          if (!scheduleValidation.ok) return alert(scheduleValidation.message);

          if (editCost) {
            const previousAmount = getEffectiveAmountForMonth(editCost, currentMonth);
            let mode = null;
            if (Math.abs(previousAmount - amount) > 0.000001) {
              mode = isOneTimePost(editCost) || scheduleValidation.value.oneTime ? 'future' : askAmountChangeMode(currentMonth);
              if (!mode) return;
            }
            editCost.name = name;
            editCost.startMonth = startMonth;
            editCost.linkedDebtId = refs.debtSelect.value || '';
            applyScheduleSettings(editCost, scheduleValidation.value);
            if (mode) setPostAmountForMonth(editCost, currentMonth, amount, mode);
          } else {
            state.commonCosts.push({
              id: generateId(),
              name,
              amount,
              interval: scheduleValidation.value.interval,
              startMonth,
              endMonth: scheduleValidation.value.endMonth,
              oneTime: scheduleValidation.value.oneTime,
              paidMonths: [],
              linkedDebtId: refs.debtSelect.value || ''
            });
          }
          saveState();
          render();
          close();
        }
      }
    ]);
  }
  // Rendert die persönlichen Ausgaben pro Person
  
function renderPersonal() {
    personalSection.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'row';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      setCurrentMonth(e.target.value);
      render();
    });
    header.appendChild(monthSelect);
    personalSection.appendChild(header);

    let overallMonthly = 0;
    let overallDue = 0;
    let overallPaid = 0;
    state.persons.forEach((person) => {
      const posts = state.personalCosts.filter((pc) => pc.personId === person.id);
      posts.forEach((pc) => {
        if (isPostActiveInMonth(pc, currentMonth)) overallMonthly += getEffectiveAmountForMonth(pc, currentMonth) / Number(pc.interval || 1);
        if (isDue(pc, currentMonth)) {
          overallDue += getEffectiveAmountForMonth(pc, currentMonth);
          if (pc.paidMonths && pc.paidMonths.includes(currentMonth)) overallPaid += getEffectiveAmountForMonth(pc, currentMonth);
        }
      });
    });

    const summaryCard = document.createElement('div');
    summaryCard.className = 'card';
    const summaryTitle = document.createElement('h2');
    summaryTitle.textContent = 'Persönliche Ausgaben gesamt';
    summaryCard.appendChild(summaryTitle);
    summaryCard.appendChild(createSummaryMetrics([
      { label: 'Monatlich geplant', value: `${overallMonthly.toFixed(2)} €` },
      { label: 'Diesen Monat fällig', value: `${overallDue.toFixed(2)} €`, kind: overallDue > 0 ? 'warning' : '' },
      { label: 'Bereits markiert', value: `${overallPaid.toFixed(2)} €`, kind: overallPaid > 0 ? 'success' : '' },
      { label: 'Noch offen', value: `${(overallDue - overallPaid).toFixed(2)} €`, kind: overallDue - overallPaid > 0 ? 'danger' : 'success' }
    ]));
    personalSection.appendChild(summaryCard);
    const personalFilterCard = document.createElement('div');
    personalFilterCard.className = 'card compact-card';
    personalFilterCard.appendChild(makeSearchFilterBar(personalSearch, personalFilter, (v) => { personalSearch = v; }, (v) => { personalFilter = v; }, [['all','Alle'],['due','Fällig'],['open','Offen'],['paid','Bezahlt'],['linked','Mit Schuld verknüpft']]));
    personalSection.appendChild(personalFilterCard);

    state.persons.forEach((person) => {
      const card = document.createElement('div');
      card.className = 'card';
      const hRow = document.createElement('div');
      hRow.className = 'row';
      const title = document.createElement('h2');
      title.textContent = person.name;
      title.style.flex = '1 1 auto';
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Neuer Posten';
      addBtn.className = 'primary';
      addBtn.addEventListener('click', () => showPersonalEditor(person.id));
      hRow.appendChild(title);
      hRow.appendChild(addBtn);
      card.appendChild(hRow);

      const posts = state.personalCosts.filter((pc) => pc.personId === person.id).filter((pc) => matchesSearchText(pc.name, personalSearch) && matchesPostStatus(pc, currentMonth, personalFilter));
      let monthlySum = 0;
      let dueSum = 0;
      let paidSum = 0;
      posts.forEach((pc) => {
        if (isPostActiveInMonth(pc, currentMonth)) monthlySum += getEffectiveAmountForMonth(pc, currentMonth) / Number(pc.interval || 1);
        if (isDue(pc, currentMonth)) {
          dueSum += getEffectiveAmountForMonth(pc, currentMonth);
          if (pc.paidMonths && pc.paidMonths.includes(currentMonth)) paidSum += getEffectiveAmountForMonth(pc, currentMonth);
        }
      });

      card.appendChild(createSummaryMetrics([
        { label: 'Monatlich geplant', value: `${monthlySum.toFixed(2)} €` },
        { label: 'Diesen Monat fällig', value: `${dueSum.toFixed(2)} €`, kind: dueSum > 0 ? 'warning' : '' },
        { label: 'Bereits markiert', value: `${paidSum.toFixed(2)} €`, kind: paidSum > 0 ? 'success' : '' },
        { label: 'Noch offen', value: `${(dueSum - paidSum).toFixed(2)} €`, kind: dueSum - paidSum > 0 ? 'danger' : 'success' }
      ]));

      if (posts.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'Keine persönlichen Ausgaben eingetragen.';
        card.appendChild(p);
      } else {
        const table = document.createElement('table');
        table.className = 'list-table';
        const thead = document.createElement('thead');
        thead.innerHTML = `<tr><th>Name</th><th>Betrag</th><th>Intervall</th><th>Start</th><th>Bis</th><th>Fällig</th><th>Verknüpfte Schuld</th><th>Bezahlt?</th><th>Aktion</th></tr>`;
        table.appendChild(thead);
        const tbody = document.createElement('tbody');

        posts.forEach((pc) => {
          if (!pc.paidMonths) pc.paidMonths = [];
          const tr = document.createElement('tr');
          const dueNow = isDue(pc, currentMonth);
          const paidNow = pc.paidMonths.includes(currentMonth);
          const currentAmount = getEffectiveAmountForMonth(pc, currentMonth);
          const linkedDebtName = getLinkedDebtName(pc);
          tr.innerHTML = `<td>${pc.name}</td>
            <td>${currentAmount.toFixed(2)} €</td>
            <td>${getDisplayInterval(pc)}</td>
            <td>${pc.startMonth}</td>
            <td>${getDisplayEndMonth(pc)}</td>
            <td>${getDueBadgeHtml(dueNow)}</td>
            <td>${linkedDebtName || '-'}</td>
            <td></td><td></td>`;

          const paidCell = tr.children[7];
          if (dueNow) {
            if (!paidNow) {
              const btn = document.createElement('button');
              btn.textContent = 'Markieren';
              btn.className = 'success';
              btn.addEventListener('click', () => {
                if (!pc.paidMonths.includes(currentMonth)) pc.paidMonths.push(currentMonth);
                syncDebtPaymentFromPost(pc, currentMonth);
                saveState();
                render();
              });
              paidCell.appendChild(btn);
            } else {
              const doneBtn = document.createElement('button');
              doneBtn.textContent = 'Bezahlt';
              doneBtn.disabled = true;
              doneBtn.className = 'secondary';
              paidCell.appendChild(doneBtn);
            }
          } else {
            paidCell.textContent = '-';
          }

          const actionCell = tr.children[8];
          const editBtn = document.createElement('button');
          editBtn.textContent = 'Bearbeiten';
          editBtn.className = 'primary';
          editBtn.addEventListener('click', () => {
            showPersonalEditor(person.id, pc);
          });

          const delBtn = document.createElement('button');
          delBtn.textContent = 'Löschen';
          delBtn.className = 'danger';
          delBtn.addEventListener('click', () => {
            if (confirm(`"${pc.name}" löschen?`)) {
              state.personalCosts = state.personalCosts.filter((x) => x.id !== pc.id);
              saveState();
              render();
            }
          });
          actionCell.appendChild(editBtn);
          actionCell.appendChild(delBtn);
          tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        card.appendChild(table);
      }
      personalSection.appendChild(card);
    });
  }
  // Editor für persönliche Ausgaben (Prompt-basierend)
    
function showPersonalEditor(personId, editPost) {
    const person = getPersonById(personId);
    const refs = {};
    const content = document.createElement('div');
    content.className = 'modal-form';

    const info = document.createElement('p');
    info.className = 'small muted';
    info.textContent = `${person.name} · Monat für die Bearbeitung: ${formatMonthLabel(currentMonth)}`;
    content.appendChild(info);

    const row1 = document.createElement('div');
    row1.className = 'row';
    refs.nameInput = document.createElement('input');
    refs.nameInput.type = 'text';
    refs.nameInput.value = editPost ? editPost.name : '';
    refs.amountInput = document.createElement('input');
    refs.amountInput.type = 'number';
    refs.amountInput.step = '0.01';
    refs.amountInput.value = editPost ? getEffectiveAmountForMonth(editPost, currentMonth) : '';
    row1.appendChild(createLabelInput('Name', refs.nameInput));
    row1.appendChild(createLabelInput('Betrag', refs.amountInput));
    content.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'row';
    refs.typeSelect = document.createElement('select');
    refs.typeSelect.innerHTML = '<option value="once">Einmalig</option><option value="recurring">Laufend</option>';
    refs.typeSelect.value = editPost && isOneTimePost(editPost) ? 'once' : 'recurring';
    refs.intervalInput = document.createElement('input');
    refs.intervalInput.type = 'number';
    refs.intervalInput.min = '1';
    refs.intervalInput.step = '1';
    refs.intervalInput.value = editPost ? editPost.interval : 1;
    refs.startInput = document.createElement('input');
    refs.startInput.type = 'month';
    refs.startInput.value = editPost ? editPost.startMonth : currentMonth;
    row2.appendChild(createLabelInput('Zahlungsart', refs.typeSelect));
    row2.appendChild(createLabelInput('Intervall in Monaten', refs.intervalInput));
    row2.appendChild(createLabelInput('Startmonat', refs.startInput));
    content.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'row';
    refs.limitSelect = document.createElement('select');
    refs.limitSelect.innerHTML = '<option value="none">Unbegrenzt</option><option value="until">Befristet bis</option>';
    refs.limitSelect.value = editPost && !isOneTimePost(editPost) && editPost.endMonth ? 'until' : 'none';
    refs.endInput = document.createElement('input');
    refs.endInput.type = 'month';
    refs.endInput.value = editPost && !isOneTimePost(editPost) && editPost.endMonth ? editPost.endMonth : '';
    row3.appendChild(createLabelInput('Laufzeit', refs.limitSelect));
    row3.appendChild(createLabelInput('Bis Monat', refs.endInput));
    content.appendChild(row3);

    const row4 = document.createElement('div');
    row4.className = 'row';
    refs.debtSelect = document.createElement('select');
    refs.debtSelect.innerHTML = '<option value="">Keine verknüpfte Schuld</option>';
    state.debts.forEach((debt) => {
      const option = document.createElement('option');
      option.value = debt.id;
      option.textContent = debt.name;
      refs.debtSelect.appendChild(option);
    });
    refs.debtSelect.value = editPost && editPost.linkedDebtId ? editPost.linkedDebtId : '';
    row4.appendChild(createLabelInput('Schuld verknüpfen', refs.debtSelect));
    content.appendChild(row4);

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = editPost
      ? 'Wenn sich der Betrag ändert, fragt die App wie bisher nach „nur dieser Monat“ oder „ab jetzt dauerhaft“.'
      : 'Neue persönliche Posten kannst du hier kompakt anlegen. Optional kannst du hier auch eine Schuld verknüpfen.';
    content.appendChild(hint);

    const syncScheduleInputs = () => togglePostEditScheduleInputs(
      refs.typeSelect,
      refs.intervalInput,
      refs.limitSelect,
      refs.endInput,
      refs.startInput
    );
    refs.typeSelect.addEventListener('change', syncScheduleInputs);
    refs.limitSelect.addEventListener('change', syncScheduleInputs);
    refs.startInput.addEventListener('change', syncScheduleInputs);
    syncScheduleInputs();

    showModal(editPost ? `${person.name}: Posten bearbeiten` : `${person.name}: Neuen Posten anlegen`, content, [
      {
        label: 'Abbrechen',
        className: 'secondary',
        onClick: (close) => close()
      },
      {
        label: editPost ? 'Speichern' : 'Anlegen',
        className: 'primary',
        onClick: (close) => {
          const name = refs.nameInput.value.trim();
          const amount = parseFloat(refs.amountInput.value);
          const startMonth = refs.startInput.value;
          if (!name) return alert('Name darf nicht leer sein.');
          if (Number.isNaN(amount) || amount < 0) return alert('Bitte einen gültigen Betrag eingeben.');
          const scheduleValidation = validateScheduleSettings({
            oneTime: refs.typeSelect.value === 'once',
            interval: refs.intervalInput.value,
            startMonth,
            endMonth: refs.limitSelect.value === 'until' ? refs.endInput.value : ''
          });
          if (!scheduleValidation.ok) return alert(scheduleValidation.message);

          if (editPost) {
            const previousAmount = getEffectiveAmountForMonth(editPost, currentMonth);
            let mode = null;
            if (Math.abs(previousAmount - amount) > 0.000001) {
              mode = isOneTimePost(editPost) || scheduleValidation.value.oneTime ? 'future' : askAmountChangeMode(currentMonth);
              if (!mode) return;
            }
            editPost.name = name;
            editPost.startMonth = startMonth;
            editPost.linkedDebtId = refs.debtSelect.value || '';
            applyScheduleSettings(editPost, scheduleValidation.value);
            if (mode) setPostAmountForMonth(editPost, currentMonth, amount, mode);
          } else {
            state.personalCosts.push({
              id: generateId(),
              personId,
              name,
              amount,
              interval: scheduleValidation.value.interval,
              startMonth,
              endMonth: scheduleValidation.value.endMonth,
              oneTime: scheduleValidation.value.oneTime,
              paidMonths: [],
              linkedDebtId: refs.debtSelect.value || ''
            });
          }
          saveState();
          render();
          close();
        }
      }
    ]);
  }

  // Rendert den Bereich „Schulden“



  function showBufferExpenseEditor(editPost) {
    const refs = {};
    const content = document.createElement('div');
    content.className = 'modal-form';

    const info = document.createElement('p');
    info.className = 'small muted';
    info.textContent = `Diese Ausgaben werden vorgemerkt. Erst wenn du sie als bezahlt markierst, reduzieren sie den verfügbaren Betrag für ${formatMonthLabel(currentMonth)}. Rücklagen & Sparen orientieren sich dann am tatsächlichen Rest.`;
    content.appendChild(info);

    const row1 = document.createElement('div');
    row1.className = 'row';
    refs.nameInput = document.createElement('input');
    refs.nameInput.type = 'text';
    refs.nameInput.value = editPost ? editPost.name : '';
    refs.amountInput = document.createElement('input');
    refs.amountInput.type = 'number';
    refs.amountInput.step = '0.01';
    refs.amountInput.value = editPost ? getEffectiveAmountForMonth(editPost, currentMonth) : '';
    row1.appendChild(createLabelInput('Name', refs.nameInput));
    row1.appendChild(createLabelInput('Betrag', refs.amountInput));
    content.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'row';
    refs.typeSelect = document.createElement('select');
    refs.typeSelect.innerHTML = '<option value="once">Einmalig</option><option value="recurring">Laufend</option>';
    refs.typeSelect.value = editPost && isOneTimePost(editPost) ? 'once' : 'recurring';
    refs.intervalInput = document.createElement('input');
    refs.intervalInput.type = 'number';
    refs.intervalInput.min = '1';
    refs.intervalInput.step = '1';
    refs.intervalInput.value = editPost ? editPost.interval : 1;
    refs.startInput = document.createElement('input');
    refs.startInput.type = 'month';
    refs.startInput.value = editPost ? editPost.startMonth : currentMonth;
    row2.appendChild(createLabelInput('Zahlungsart', refs.typeSelect));
    row2.appendChild(createLabelInput('Intervall in Monaten', refs.intervalInput));
    row2.appendChild(createLabelInput('Startmonat', refs.startInput));
    content.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'row';
    refs.limitSelect = document.createElement('select');
    refs.limitSelect.innerHTML = '<option value="none">Unbegrenzt</option><option value="until">Befristet bis</option>';
    refs.limitSelect.value = editPost && !isOneTimePost(editPost) && editPost.endMonth ? 'until' : 'none';
    refs.endInput = document.createElement('input');
    refs.endInput.type = 'month';
    refs.endInput.value = editPost && !isOneTimePost(editPost) && editPost.endMonth ? editPost.endMonth : '';
    row3.appendChild(createLabelInput('Laufzeit', refs.limitSelect));
    row3.appendChild(createLabelInput('Bis Monat', refs.endInput));
    content.appendChild(row3);

    const syncScheduleInputs = () => togglePostEditScheduleInputs(
      refs.typeSelect,
      refs.intervalInput,
      refs.limitSelect,
      refs.endInput,
      refs.startInput
    );
    refs.typeSelect.addEventListener('change', syncScheduleInputs);
    refs.limitSelect.addEventListener('change', syncScheduleInputs);
    refs.startInput.addEventListener('change', syncScheduleInputs);
    syncScheduleInputs();

    showModal(editPost ? 'Sonstige Ausgabe bearbeiten' : 'Neue sonstige Ausgabe', content, [
      {
        label: 'Abbrechen',
        className: 'secondary',
        onClick: (close) => close()
      },
      {
        label: editPost ? 'Speichern' : 'Anlegen',
        className: 'primary',
        onClick: (close) => {
          const name = refs.nameInput.value.trim();
          const amount = parseFloat(refs.amountInput.value);
          const startMonth = refs.startInput.value;
          if (!name) return alert('Name darf nicht leer sein.');
          if (Number.isNaN(amount) || amount < 0) return alert('Bitte einen gültigen Betrag eingeben.');
          const scheduleValidation = validateScheduleSettings({
            oneTime: refs.typeSelect.value === 'once',
            interval: refs.intervalInput.value,
            startMonth,
            endMonth: refs.limitSelect.value === 'until' ? refs.endInput.value : ''
          });
          if (!scheduleValidation.ok) return alert(scheduleValidation.message);

          if (editPost) {
            const previousAmount = getEffectiveAmountForMonth(editPost, currentMonth);
            let mode = null;
            if (Math.abs(previousAmount - amount) > 0.000001) {
              mode = isOneTimePost(editPost) || scheduleValidation.value.oneTime ? 'future' : askAmountChangeMode(currentMonth);
              if (!mode) return;
            }
            editPost.name = name;
            editPost.startMonth = startMonth;
            applyScheduleSettings(editPost, scheduleValidation.value);
            if (mode) setPostAmountForMonth(editPost, currentMonth, amount, mode);
          } else {
            state.bufferExpenses.push({
              id: generateId(),
              name,
              amount,
              interval: scheduleValidation.value.interval,
              startMonth,
              endMonth: scheduleValidation.value.endMonth,
              oneTime: scheduleValidation.value.oneTime,
              paidMonths: []
            });
          }
          saveState();
          render();
          close();
        }
      }
    ]);
  }

  function renderTankCalc() {
    tankCalcSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('h2');
    title.textContent = 'Tankgeldberechnung';
    card.appendChild(title);

    const note = document.createElement('p');
    note.textContent = 'Die automatische Preisabfrage lädt einen aktuellen Preisvorschlag aus der Datenquelle. Den 30-Tage-Durchschnitt kannst du bei Bedarf im Feld darunter anpassen. Das Ergebnis wird auf die nächsten 10 € aufgerundet.';
    card.appendChild(note);

    const settingsRow = document.createElement('div');
    settingsRow.className = 'row';

    const keyWrap = document.createElement('div');
    const keyLabel = document.createElement('label');
    keyLabel.textContent = 'Tankerkönig-API-Key';
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.placeholder = 'API-Key eingeben';
    keyInput.value = state.tankCalc.apiKey || '';
    const persistApiKey = () => {
      state.tankCalc.apiKey = extractTankApiKey(keyInput.value);
      keyInput.value = state.tankCalc.apiKey;
      saveState();
    };
    keyInput.addEventListener('input', persistApiKey);
    keyInput.addEventListener('change', persistApiKey);
    const keyButtonRow = document.createElement('div');
    keyButtonRow.className = 'row';
    const showKeyBtn = document.createElement('button');
    showKeyBtn.type = 'button';
    showKeyBtn.className = 'secondary';
    showKeyBtn.textContent = 'anzeigen';
    showKeyBtn.addEventListener('click', () => {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      showKeyBtn.textContent = keyInput.type === 'password' ? 'anzeigen' : 'verbergen';
    });
    const clearKeyBtn = document.createElement('button');
    clearKeyBtn.type = 'button';
    clearKeyBtn.className = 'danger';
    clearKeyBtn.textContent = 'löschen';
    clearKeyBtn.addEventListener('click', () => {
      if (confirm('API-Key wirklich löschen?')) {
        state.tankCalc.apiKey = '';
        keyInput.value = '';
        saveState();
        render();
      }
    });
    keyButtonRow.appendChild(showKeyBtn);
    const testKeyBtn = document.createElement('button');
    testKeyBtn.type = 'button';
    testKeyBtn.className = 'secondary';
    testKeyBtn.textContent = 'API-Key testen';
    testKeyBtn.addEventListener('click', async () => {
      persistApiKey();
      await testTankApiKey();
    });
    keyButtonRow.appendChild(testKeyBtn);
    keyButtonRow.appendChild(clearKeyBtn);
    const keyHint = document.createElement('div');
    keyHint.className = 'small muted';
    keyHint.textContent = 'Der API-Key wird automatisch bereinigt: Leerzeichen, unsichtbare Zeichen, Anführungszeichen oder ein mitkopierter Link werden entfernt. Im Backup kannst du entscheiden, ob er enthalten sein soll.';
    keyWrap.appendChild(keyLabel);
    keyWrap.appendChild(keyInput);
    keyWrap.appendChild(keyButtonRow);
    keyWrap.appendChild(keyHint);

    const radWrap = document.createElement('div');
    const radLabel = document.createElement('label');
    radLabel.textContent = 'Suchradius in km';
    const radInput = document.createElement('input');
    radInput.type = 'number';
    radInput.step = '1';
    radInput.min = '1';
    radInput.value = state.tankCalc.radiusKm || 5;
    radInput.addEventListener('change', () => {
      state.tankCalc.radiusKm = Number(radInput.value || 5);
      saveState();
    });
    radWrap.appendChild(radLabel);
    radWrap.appendChild(radInput);

    settingsRow.appendChild(keyWrap);
    settingsRow.appendChild(radWrap);
    card.appendChild(settingsRow);

    const apiStatus = getTankApiStatusInfo();
    const apiStatusBox = document.createElement('div');
    apiStatusBox.className = 'info-box';
    const keyFormatLabel = state.tankCalc.apiKey ? (isTankApiKeyFormatValid(state.tankCalc.apiKey) ? 'Format OK' : 'Format prüfen') : 'kein Key';
    apiStatusBox.innerHTML = `<strong>Tankerkönig-Status:</strong> ${state.tankCalc.apiKey ? 'API-Key vorhanden' : 'API-Key fehlt'} · ${keyFormatLabel} · Letzter Abruf: ${apiStatus.lastRequestLabel}<br><span class="muted">${apiStatus.lastStatus ? apiStatus.lastStatus + ': ' : ''}${apiStatus.lastError || 'Noch keine Diagnose durchgeführt.'}</span>`;
    card.appendChild(apiStatusBox);

    const bennyBudget = calculateTankBudget(getTankCalcData('benny')).rounded;
    const madeleineBudget = calculateTankBudget(getTankCalcData('madeleine')).rounded;
    card.appendChild(createSummaryMetrics([
      { label: 'Monatsbudget gesamt', value: `${(bennyBudget + madeleineBudget).toFixed(2)} €` },
      { label: 'Benny', value: `${bennyBudget.toFixed(2)} €` },
      { label: 'Madeleine', value: `${madeleineBudget.toFixed(2)} €` },
      { label: 'API-Key', value: state.tankCalc.apiKey ? 'Gespeichert' : 'Fehlt', kind: state.tankCalc.apiKey ? 'success' : 'warning' }
    ]));

    const personConfigs = [
      ['benny', 'Benny'],
      ['madeleine', 'Madeleine']
    ];

    personConfigs.forEach(([personKey, labelText]) => {
      const cfg = getTankCalcData(personKey);
      const sub = document.createElement('div');
      sub.className = 'card';

      const subTitle = document.createElement('h3');
      subTitle.textContent = labelText;
      sub.appendChild(subTitle);

      const row1 = document.createElement('div');
      row1.className = 'row';

      const kmWrap = document.createElement('div');
      const kmLabel = document.createElement('label');
      kmLabel.textContent = 'Kilometer pro Monat';
      const kmInput = document.createElement('input');
      kmInput.type = 'number';
      kmInput.step = '1';
      kmInput.value = cfg.kmPerMonth || '';
      kmInput.addEventListener('change', () => {
        cfg.kmPerMonth = Number(kmInput.value || 0);
        saveState();
        render();
      });
      kmWrap.appendChild(kmLabel);
      kmWrap.appendChild(kmInput);

      const consWrap = document.createElement('div');
      const consLabel = document.createElement('label');
      consLabel.textContent = 'Verbrauch (l/100 km)';
      const consInput = document.createElement('input');
      consInput.type = 'number';
      consInput.step = '0.1';
      consInput.value = cfg.consumption || '';
      consInput.addEventListener('change', () => {
        cfg.consumption = Number(consInput.value || 0);
        saveState();
        render();
      });
      consWrap.appendChild(consLabel);
      consWrap.appendChild(consInput);

      const fuelWrap = document.createElement('div');
      const fuelLabel = document.createElement('label');
      fuelLabel.textContent = 'Kraftstoff';
      const fuelSelect = document.createElement('select');
      [['diesel','Diesel'], ['e5','Super E5'], ['e10','Super E10']].forEach(([val, txt]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = txt;
        if ((cfg.fuelType || 'diesel') === val) opt.selected = true;
        fuelSelect.appendChild(opt);
      });
      fuelSelect.addEventListener('change', () => {
        cfg.fuelType = fuelSelect.value;
        saveState();
        render();
      });
      fuelWrap.appendChild(fuelLabel);
      fuelWrap.appendChild(fuelSelect);

      row1.appendChild(kmWrap);
      row1.appendChild(consWrap);
      row1.appendChild(fuelWrap);
      sub.appendChild(row1);

      const row2 = document.createElement('div');
      row2.className = 'row';

      const avgWrap = document.createElement('div');
      const avgLabel = document.createElement('label');
      avgLabel.textContent = 'Ø Preis 30 Tage (€/l)';
      const avgInput = document.createElement('input');
      avgInput.type = 'number';
      avgInput.step = '0.001';
      avgInput.placeholder = 'z. B. 1.689';
      avgInput.value = cfg.avgPrice || '';
      avgInput.addEventListener('change', () => {
        cfg.avgPrice = avgInput.value;
        saveState();
        render();
      });
      avgWrap.appendChild(avgLabel);
      avgWrap.appendChild(avgInput);

      const autoWrap = document.createElement('div');
      const autoLabel = document.createElement('label');
      autoLabel.textContent = 'Automatisch geladener Preis';
      const autoInput = document.createElement('input');
      autoInput.type = 'text';
      autoInput.disabled = true;
      autoInput.value = cfg.autoPrice ? `${cfg.autoPrice} €/l` : '';
      autoWrap.appendChild(autoLabel);
      autoWrap.appendChild(autoInput);

      const stationWrap = document.createElement('div');
      const stationLabel = document.createElement('label');
      stationLabel.textContent = 'Preisquelle';
      const stationInput = document.createElement('input');
      stationInput.type = 'text';
      stationInput.disabled = true;
      stationInput.value = cfg.stationName ? `${cfg.stationName}${cfg.lastFetch ? ' · ' + cfg.lastFetch : ''}` : '';
      stationWrap.appendChild(stationLabel);
      stationWrap.appendChild(stationInput);

      row2.appendChild(avgWrap);
      row2.appendChild(autoWrap);
      row2.appendChild(stationWrap);
      sub.appendChild(row2);

      const tankBudget = calculateTankBudget(cfg);
      sub.appendChild(createSummaryMetrics([
        { label: 'Kilometer / Monat', value: `${Number(cfg.kmPerMonth || 0).toFixed(0)} km` },
        { label: 'Preis genutzt', value: tankBudget.priceUsed ? `${tankBudget.priceUsed.toFixed(3)} €/l` : '—', kind: tankBudget.priceUsed ? 'success' : 'warning' },
        { label: 'Ergebnis', value: `${tankBudget.rounded.toFixed(2)} €`, kind: tankBudget.rounded > 0 ? 'success' : 'warning' }
      ]));

      const buttonRow = document.createElement('div');
      buttonRow.className = 'row';

      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'Preis automatisch laden';
      loadBtn.className = 'primary';
      loadBtn.addEventListener('click', async () => {
        await fetchAutomaticFuelPrice(personKey);
      });

      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Als persönlichen Ausgabenposten übernehmen';
      applyBtn.className = 'success';
      applyBtn.addEventListener('click', () => {
        upsertTankgeldAsPersonalExpense(personKey);
      });

      buttonRow.appendChild(loadBtn);
      buttonRow.appendChild(applyBtn);
      sub.appendChild(buttonRow);

      card.appendChild(sub);
    });

    tankCalcSection.appendChild(card);
  }

  function getDebtPaymentAmountForMonth(debt, monthKey) {
    ensureDebtConfig(debt);
    const historyAmount = debt.paymentHistory
      .filter((entry) => entry.month === monthKey)
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    if (historyAmount > 0) return historyAmount;
    return debt.paidMonths.includes(monthKey) ? Number(getDebtRateForMonth(debt, monthKey) || 0) : 0;
  }

  function getDebtPaidAmountForMonth(monthKey) {
    let paid = 0;
    state.debts.forEach((d) => {
      paid += getDebtPaymentAmountForMonth(d, monthKey);
    });
    return paid;
  }

  function addDebtPayment(debt, options = {}) {
    ensureDebtConfig(debt);
    const month = isMonthKey(options.month) ? options.month : (isMonthKey(debt.nextDueMonth) ? debt.nextDueMonth : currentMonth);
    const amountRaw = Number(options.amount);
    const amount = Number.isFinite(amountRaw) ? Math.max(0, amountRaw) : Number(getDebtRateForMonth(debt, month || currentMonth) || 0);
    if (!(amount > 0)) return false;
    const markAsMonthly = options.markAsMonthly === true;
    const previousNextDueMonth = debt.nextDueMonth || '';
    const paymentAmount = Math.min(amount, Number(debt.amountOpen || 0));
    if (!(paymentAmount > 0)) return false;

    debt.paymentHistory.push({
      id: generateId(),
      month,
      amount: paymentAmount,
      source: options.source || 'Manuelle Zahlung',
      note: options.note || '',
      createdAt: new Date().toISOString(),
      previousNextDueMonth,
      markedAsMonthly: markAsMonthly
    });

    debt.amountOpen = Math.max(0, Number(debt.amountOpen || 0) - paymentAmount);
    if (Number(debt.amountOpen || 0) <= 0) {
      debt.completedMonth = month;
    }

    if (markAsMonthly && !debt.paidMonths.includes(month)) {
      debt.paidMonths.push(month);
    }
    if (markAsMonthly && debt.nextDueMonth === month) {
      debt.nextDueMonth = nextMonth(month);
    }
    addChangeLog('Schulden', `${debt.name || 'Schuld'}: ${paymentAmount.toFixed(2)} € bezahlt`, month);
    return true;
  }

  function resetDebtPaymentForMonth(debt, monthKey) {
    ensureDebtConfig(debt);
    const entries = debt.paymentHistory.filter((entry) => entry.month === monthKey);
    let restoreAmount = 0;
    if (entries.length > 0) {
      restoreAmount = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      debt.paymentHistory = debt.paymentHistory.filter((entry) => entry.month !== monthKey);
    } else if (debt.paidMonths.includes(monthKey)) {
      restoreAmount = Number(getDebtRateForMonth(debt, monthKey) || 0);
    }
    debt.paidMonths = debt.paidMonths.filter((m) => m !== monthKey);
    if (restoreAmount > 0) {
      debt.amountOpen = Number(debt.amountOpen || 0) + restoreAmount;
    }
    if (Number(debt.amountOpen || 0) > 0) {
      delete debt.completedMonth;
    }
    if (!debt.nextDueMonth || monthDiff(monthKey, debt.nextDueMonth) > 0) {
      debt.nextDueMonth = monthKey;
    }
    if (restoreAmount > 0) addChangeLog('Schulden', `${debt.name || 'Schuld'}: Zahlung ${restoreAmount.toFixed(2)} € zurückgesetzt`, monthKey);
    return restoreAmount > 0;
  }

  function renderDebts() {
    debtsSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const header = document.createElement('div');
    header.className = 'row';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      setCurrentMonth(e.target.value);
      render();
    });
    const filterSelect = document.createElement('select');
    [['active','Aktive'],['due','Nur fällig'],['paid','Diesen Monat bezahlt'],['done','Erledigt'],['all','Alle']].forEach(([value,label]) => { const opt = document.createElement('option'); opt.value = value; opt.textContent = label; if (debtFilter === value) opt.selected = true; filterSelect.appendChild(opt); });
    filterSelect.addEventListener('change', (e) => { debtFilter = e.target.value; render(); });
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Neue Schuld';
    addBtn.className = 'primary';
    addBtn.addEventListener('click', () => {
      showDebtEditor();
    });
    header.appendChild(monthSelect);
    header.appendChild(addBtn);
    card.appendChild(header);

    let dueSum = 0;
    let openThisMonth = 0;
    let totalDebtSum = 0;
    let activeDebts = 0;
    state.debts.forEach((d) => {
      ensureDebtConfig(d);
      const openAmount = Number(d.amountOpen || 0);
      const monthlyRate = Number(getDebtRateForMonth(d, currentMonth) || 0);
      const paidAmount = getDebtPaymentAmountForMonth(d, currentMonth);
      totalDebtSum += openAmount;
      if (openAmount > 0) activeDebts += 1;

      // Monatsplan = bereits in diesem Monat bezahlte Schulden + weiterhin fällige Schulden.
      // Wichtig: Nach einer Zahlung springt nextDueMonth auf den Folgemonat. Trotzdem darf die
      // bezahlte Mai-Rate nicht aus dem Mai-Plan verschwinden, sonst wird „Noch offen“ zu klein.
      if (d.nextDueMonth === currentMonth && monthlyRate > 0) {
        dueSum += Math.max(monthlyRate, paidAmount);
        openThisMonth += Math.max(monthlyRate - paidAmount, 0);
      } else if (paidAmount > 0) {
        dueSum += paidAmount;
      }
    });
    const paidSum = getDebtPaidAmountForMonth(currentMonth);
    const zeroRateDebts = state.debts.filter((d) => Number(d.amountOpen || 0) > 0 && d.paymentType === 'open_plan').length;
    const estimatedDebtFree = state.debts
      .filter((d) => Number(d.amountOpen || 0) > 0 && d.paymentType === 'installment' && getDebtRateForMonth(d, currentMonth) > 0)
      .map((d) => estimateDebtEndMonth(d))
      .filter(Boolean)
      .sort()
      .pop() || '-';
    card.appendChild(createSummaryMetrics([
      { label: 'Restschuld gesamt', value: `${totalDebtSum.toFixed(2)} €`, kind: totalDebtSum > 0 ? 'danger' : 'success' },
      { label: 'Plan diesen Monat', value: `${dueSum.toFixed(2)} €`, kind: dueSum > 0 ? 'warning' : '' },
      { label: 'Bereits bezahlt', value: `${paidSum.toFixed(2)} €`, kind: paidSum > 0 ? 'success' : '' },
      { label: 'Noch offen', value: `${openThisMonth.toFixed(2)} €`, kind: openThisMonth > 0 ? 'danger' : 'success' },
      { label: 'Aktive Schulden', value: String(activeDebts) },
      { label: 'Schuldenfrei grob', value: estimatedDebtFree === '-' ? '-' : formatMonthLabel(estimatedDebtFree) }
    ]));
    const snowball = buildSnowballPlan(currentMonth, 72);
    if (snowball.rows.length > 0) {
      card.appendChild(createSummaryMetrics([
        { label: 'Schneeball frei ab', value: snowball.events[0] ? formatMonthLabel(nextMonth(snowball.events[0].month)) : '-' },
        { label: 'Umlage-Regel', value: 'kleinste offene Schuld' },
        { label: 'Zusatzrate im Plan', value: `${Number(snowball.rows[snowball.rows.length - 1].rolloverNext || 0).toFixed(2)} €` },
        { label: 'Schuldenfrei mit Schneeball', value: snowball.debtFreeMonth ? formatMonthLabel(snowball.debtFreeMonth) : 'offen' }
      ]));
    }
    card.appendChild(makeSearchFilterBar(debtSearch, debtFilter, (v) => { debtSearch = v; }, (v) => { debtFilter = v; }, [['active','Aktive'],['due','Nur fällig'],['paid','Diesen Monat bezahlt'],['done','Erledigt'],['all','Alle']]));

    let visibleDebts = state.debts.filter((d) => shouldShowDebtInMonth(d, currentMonth));
    visibleDebts = visibleDebts.filter((d) => {
      ensureDebtConfig(d);
      if (!matchesSearchText(d.name, debtSearch)) return false;
      const paidAmount = getDebtPaymentAmountForMonth(d, currentMonth);
      if (debtFilter === 'all') return true;
      if (debtFilter === 'due') return Number(d.amountOpen || 0) > 0 && d.nextDueMonth === currentMonth && paidAmount <= 0;
      if (debtFilter === 'paid') return paidAmount > 0 || d.paidMonths.includes(currentMonth);
      if (debtFilter === 'done') return Number(d.amountOpen || 0) <= 0;
      return Number(d.amountOpen || 0) > 0 || paidAmount > 0;
    });

    if (visibleDebts.length === 0) {
      const p = document.createElement('p');
      p.textContent = state.debts.length === 0
        ? 'Keine Schulden eingetragen.'
        : 'Keine aktiven oder in diesem Monat abgeschlossenen Schulden sichtbar.';
      card.appendChild(p);
    } else {
      const table = document.createElement('table');
      table.className = 'list-table';
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr><th>Name</th><th>Zahlungsart</th><th>Offen</th><th>Rate aktuell</th><th>Ratenverlauf</th><th>Nächste Fälligkeit</th><th>Vorauss. Ende</th><th>Fortschritt</th><th>Status</th><th>Bezahlt?</th><th>Aktion</th></tr>`;
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      visibleDebts.forEach((d) => {
        ensureDebtConfig(d);
        const tr = document.createElement('tr');
        const dueNow = d.nextDueMonth === currentMonth;
        const paidNow = d.paidMonths.includes(currentMonth);
        const paidAmount = getDebtPaymentAmountForMonth(d, currentMonth);
        const estimatedEnd = estimateDebtEndMonth(d);
        const paidTotal = (d.paymentHistory || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
        const progressBase = Number(d.amountOpen || 0) + paidTotal;
        const progress = progressBase > 0 ? Math.min(100, Math.round((paidTotal / progressBase) * 100)) : 100;
        const progressHtml = `<div class="debt-progress"><div style="width:${progress}%"></div></div><div class="small muted">${progress} %</div>`;
        let statusHtml = '<span class="pill">Plan</span>';
        if (Number(d.amountOpen || 0) <= 0) statusHtml = '<span class="pill success">Erledigt</span>';
        else if (d.paymentType === 'open_plan') statusHtml = '<span class="pill warning">Ratenplan offen</span>';
        else if (d.paymentType === 'one_time' && dueNow) statusHtml = '<span class="pill danger">Einmalzahlung fällig</span>';
        else if (d.paymentType === 'one_time') statusHtml = '<span class="pill">Einmalzahlung</span>';
        else if (paidNow) statusHtml = '<span class="pill success">Monat bezahlt</span>';
        else if (dueNow) statusHtml = '<span class="pill danger">Fällig</span>';
        else if (monthDiff(currentMonth, d.nextDueMonth) > 0) statusHtml = '<span class="pill">Später</span>';

        const typeClass = d.paymentType === 'installment' ? 'success' : (d.paymentType === 'one_time' ? '' : 'warning');
        const typeHtml = `<span class="pill ${typeClass}">${getDebtPaymentTypeLabel(d.paymentType)}</span>`;
        tr.innerHTML = `<td>${d.name}</td><td>${typeHtml}</td><td>${Number(d.amountOpen || 0).toFixed(2)} €</td><td>${Number(getDebtRateForMonth(d, currentMonth) || 0).toFixed(2)} €</td><td>${getDebtRateTimelineText(d) || '-'}</td><td>${d.nextDueMonth || '-'}</td><td>${estimatedEnd || '-'}</td><td>${progressHtml}</td><td>${statusHtml}</td><td></td><td></td>`;

        const payCell = tr.children[9];
        if (Number(d.amountOpen || 0) <= 0) {
          const done = document.createElement('div');
          const completedMonth = getDebtCompletedMonth(d);
          done.innerHTML = `<span class="pill success">Erledigt</span><div class="small muted">${completedMonth ? formatMonthLabel(completedMonth) : ''}</div>`;
          payCell.appendChild(done);
        } else if (paidNow) {
          const done = document.createElement('div');
          done.innerHTML = `<span class="pill success">Bezahlt</span><div class="small muted">${paidAmount.toFixed(2)} €</div>`;
          payCell.appendChild(done);
        } else if (dueNow && getDebtRateForMonth(d, currentMonth) > 0) {
          const btn = document.createElement('button');
          btn.textContent = 'Markieren';
          btn.className = 'success';
          btn.addEventListener('click', () => {
            markDebtPaid(d);
          });
          payCell.appendChild(btn);
        } else {
          payCell.textContent = '-';
        }

        const actionCell = tr.children[10];
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Bearbeiten';
        editBtn.className = 'primary';
        editBtn.addEventListener('click', () => {
          showDebtEditor(d);
        });

        const payBtn = document.createElement('button');
        payBtn.textContent = 'Zahlung eintragen';
        payBtn.className = 'success';
        payBtn.addEventListener('click', () => {
          showDebtPaymentEditor(d);
        });

        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Zahlung zurücksetzen';
        resetBtn.className = 'secondary';
        resetBtn.disabled = !paidNow && getDebtPaymentAmountForMonth(d, currentMonth) <= 0;
        resetBtn.addEventListener('click', () => {
          if (confirm(`Zahlung für ${formatMonthLabel(currentMonth)} bei "${d.name}" zurücksetzen?`)) {
            resetDebtPaymentForMonth(d, currentMonth);
            saveState();
            render();
          }
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Löschen';
        delBtn.className = 'danger';
        delBtn.addEventListener('click', () => {
          if (confirm(`Schuld "${d.name}" löschen?`)) {
            state.debts = state.debts.filter((x) => x.id !== d.id);
            saveState();
            render();
          }
        });

        actionCell.appendChild(editBtn);
        actionCell.appendChild(payBtn);
        actionCell.appendChild(resetBtn);
        actionCell.appendChild(delBtn);
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      card.appendChild(table);

      const info = document.createElement('p');
      info.className = 'small muted';
      info.innerHTML = `<strong>Monatsplan:</strong> ${dueSum.toFixed(2)} € · <strong>Bereits bezahlt:</strong> ${paidSum.toFixed(2)} € · <strong>Noch zu bezahlen:</strong> ${openThisMonth.toFixed(2)} €`;
      card.appendChild(info);
    }

    const snowballCard = renderSnowballPlanCard(currentMonth);
    if (snowballCard) card.appendChild(snowballCard);
    debtsSection.appendChild(card);
  }

  function renderSnowballPlanCard(monthKey) {
    const plan = buildSnowballPlan(monthKey, 72);
    const card = document.createElement('div');
    card.className = 'sub-card snowball-card';
    const h = document.createElement('h3');
    h.textContent = 'Schulden-Schneeball';
    card.appendChild(h);
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = 'Berücksichtigt werden nur echte laufende Ratenzahlungen. Einmalzahlungen wie Riverty AZ2 oder einmalige Restzahlungen werden nicht als Schneeball-Ziel genutzt. Wenn eine Schuld z. B. im Juni abbezahlt ist, wird ihre normale Rate erst ab Juli auf die dann kleinste offene Ratenschuld umgelegt. In der Spalte „Geht ab Folgemonat auf“ siehst du direkt, wohin die frei werdende Rate geplant wird.';
    card.appendChild(p);
    if (plan.noRate.length > 0) {
      const warn = document.createElement('div');
      warn.className = 'notice warning';
      warn.textContent = `Nicht im Schneeball enthalten: ${plan.noRate.map((d) => `${d.name} (${d.excludeReason})`).join(', ')}`;
      card.appendChild(warn);
    }
    if (plan.rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'small muted';
      empty.textContent = 'Kein Schneeball-Plan möglich, weil keine aktive Schuld mit Monatsrate offen ist.';
      card.appendChild(empty);
      return card;
    }
    const chips = document.createElement('div');
    chips.className = 'status-chip-list';
    plan.events.slice(0, 5).forEach((event) => {
      const chip = document.createElement('span');
      chip.className = 'pill success';
      chip.textContent = event.text;
      chips.appendChild(chip);
    });
    if (plan.events.length === 0) {
      const chip = document.createElement('span');
      chip.className = 'pill';
      chip.textContent = 'Noch keine frei werdende Rate im sichtbaren Plan.';
      chips.appendChild(chip);
    }
    card.appendChild(chips);
    const table = document.createElement('table');
    table.className = 'list-table';
    table.innerHTML = '<thead><tr><th>Monat</th><th>Normale Raten</th><th>Schneeball extra</th><th>Gesamtzahlung</th><th>Zusatzrate ab Folgemonat</th><th>Geht ab Folgemonat auf</th><th>Rest nach Monat</th><th>Hinweis</th></tr></thead>';
    const tbody = document.createElement('tbody');
    plan.rows.slice(0, 18).forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${formatMonthLabel(row.month)}</td><td>${row.base.toFixed(2)} €</td><td>${row.extra.toFixed(2)} €</td><td>${row.total.toFixed(2)} €</td><td>${row.rolloverNext.toFixed(2)} €</td><td>${row.targetNext || '-'}</td><td>${row.remaining.toFixed(2)} €</td><td>${row.notes || '-'}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    return card;
  }

  function markDebtPaid(debt) {
    ensureDebtConfig(debt);
    if (!(getDebtRateForMonth(debt, debt.nextDueMonth || currentMonth) > 0)) {
      alert('Für diese Schuld ist noch keine Monatsrate hinterlegt.');
      return;
    }
    const paidMonth = debt.nextDueMonth;
    if (!isMonthKey(paidMonth)) {
      alert('Bitte zuerst eine gültige nächste Fälligkeit setzen.');
      return;
    }
    if (addDebtPayment(debt, {
      month: paidMonth,
      amount: Number(getDebtRateForMonth(debt, paidMonth) || 0),
      source: 'Schuldenbereich',
      markAsMonthly: true
    })) {
      saveState();
      render();
    }
  }

  function showDebtPaymentEditor(debt) {
    ensureDebtConfig(debt);
    const refs = {};
    const content = document.createElement('div');
    content.className = 'modal-form';

    const info = document.createElement('p');
    info.className = 'small muted';
    info.innerHTML = `<strong>${debt.name}</strong> · Offen: ${Number(debt.amountOpen || 0).toFixed(2)} € · Rate: ${Number(getDebtRateForMonth(debt, currentMonth) || 0).toFixed(2)} €`;
    content.appendChild(info);

    const row1 = document.createElement('div');
    row1.className = 'row';
    refs.monthInput = document.createElement('input');
    refs.monthInput.type = 'month';
    refs.monthInput.value = isMonthKey(debt.nextDueMonth) ? debt.nextDueMonth : currentMonth;
    refs.amountInput = document.createElement('input');
    refs.amountInput.type = 'number';
    refs.amountInput.step = '0.01';
    refs.amountInput.value = Number(getDebtRateForMonth(debt, currentMonth) || 0) > 0 ? Number(getDebtRateForMonth(debt, currentMonth) || 0).toFixed(2) : '';
    row1.appendChild(createLabelInput('Zahlungsmonat', refs.monthInput));
    row1.appendChild(createLabelInput('Betrag', refs.amountInput));
    content.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'row';
    refs.typeSelect = document.createElement('select');
    refs.typeSelect.innerHTML = `
      <option value="regular">Regelrate als bezahlt markieren</option>
      <option value="partial">Teilzahlung ohne Monatsabschluss</option>
      <option value="extra">Sonderzahlung ohne Monatsabschluss</option>
    `;
    refs.noteInput = document.createElement('input');
    refs.noteInput.type = 'text';
    refs.noteInput.placeholder = 'Notiz optional';
    row2.appendChild(createLabelInput('Zahlungsart', refs.typeSelect));
    row2.appendChild(createLabelInput('Notiz', refs.noteInput));
    content.appendChild(row2);

    const rowRatePlan = document.createElement('div');
    rowRatePlan.className = 'row';
    refs.rateChangeMonthInput = document.createElement('input');
    refs.rateChangeMonthInput.type = 'month';
    refs.rateChangeMonthInput.value = currentMonth;
    refs.rateChangeAmountInput = document.createElement('input');
    refs.rateChangeAmountInput.type = 'number';
    refs.rateChangeAmountInput.step = '0.01';
    refs.rateChangeAmountInput.placeholder = 'z. B. 185,00';
    rowRatePlan.appendChild(createLabelInput('Ratenänderung ab Monat', refs.rateChangeMonthInput));
    rowRatePlan.appendChild(createLabelInput('Neue Rate ab diesem Monat', refs.rateChangeAmountInput));
    content.appendChild(rowRatePlan);

    if (editDebt && getDebtRateTimelineText(editDebt)) {
      const timelineInfo = document.createElement('p');
      timelineInfo.className = 'small muted';
      timelineInfo.innerHTML = `<strong>Aktueller Ratenverlauf:</strong> ${getDebtRateTimelineText(editDebt)}`;
      content.appendChild(timelineInfo);
    }

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = 'Teil- und Sonderzahlungen senken nur die Restschuld. Nur die Regelrate setzt den Monat auf bezahlt und schiebt die nächste Fälligkeit weiter.';
    content.appendChild(hint);

    showModal('Zahlung eintragen', content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      {
        label: 'Speichern',
        className: 'primary',
        onClick: (close) => {
          const month = refs.monthInput.value;
          const amount = parseFloat(refs.amountInput.value);
          if (!isMonthKey(month)) return alert('Bitte einen gültigen Monat wählen.');
          if (Number.isNaN(amount) || amount <= 0) return alert('Bitte einen gültigen Betrag eingeben.');
          const mode = refs.typeSelect.value;
          const markAsMonthly = mode === 'regular';
          if (markAsMonthly && !(getDebtRateForMonth(debt, currentMonth) > 0)) return alert('Für eine Regelrate muss zuerst eine Monatsrate hinterlegt sein.');
          if (addDebtPayment(debt, {
            month,
            amount,
            source: mode === 'regular' ? 'Regelrate' : (mode === 'partial' ? 'Teilzahlung' : 'Sonderzahlung'),
            note: refs.noteInput.value.trim(),
            markAsMonthly
          })) {
            saveState();
            render();
            close();
          } else {
            alert('Die Zahlung konnte nicht eingetragen werden.');
          }
        }
      }
    ]);
  }

  function showDebtEditor(editDebt) {
    const refs = {};
    const content = document.createElement('div');
    content.className = 'modal-form';

    const row1 = document.createElement('div');
    row1.className = 'row';
    refs.nameInput = document.createElement('input');
    refs.nameInput.type = 'text';
    if (editDebt) ensureDebtConfig(editDebt);
    refs.nameInput.value = editDebt ? editDebt.name : '';
    refs.openInput = document.createElement('input');
    refs.openInput.type = 'number';
    refs.openInput.step = '0.01';
    refs.openInput.value = editDebt ? editDebt.amountOpen : '';
    row1.appendChild(createLabelInput('Name der Schuld', refs.nameInput));
    row1.appendChild(createLabelInput('Offener Betrag', refs.openInput));
    content.appendChild(row1);

    const typeRow = document.createElement('div');
    typeRow.className = 'row';
    refs.paymentTypeSelect = document.createElement('select');
    refs.paymentTypeSelect.innerHTML = `
      <option value="installment">Ratenzahlung</option>
      <option value="one_time">Einmalzahlung</option>
      <option value="open_plan">Ratenplan offen</option>
    `;
    refs.paymentTypeSelect.value = editDebt ? (editDebt.paymentType || inferDebtPaymentType(editDebt)) : 'installment';
    typeRow.appendChild(createLabelInput('Zahlungsart', refs.paymentTypeSelect));
    content.appendChild(typeRow);

    const row2 = document.createElement('div');
    row2.className = 'row';
    refs.rateInput = document.createElement('input');
    refs.rateInput.type = 'number';
    refs.rateInput.step = '0.01';
    refs.rateInput.value = editDebt ? editDebt.monthlyRate : '';
    refs.dueInput = document.createElement('input');
    refs.dueInput.type = 'month';
    refs.dueInput.value = editDebt ? editDebt.nextDueMonth : currentMonth;
    row2.appendChild(createLabelInput('Monatsrate', refs.rateInput));
    row2.appendChild(createLabelInput('Nächste Fälligkeit', refs.dueInput));
    content.appendChild(row2);

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = 'Zahlungsart steuert den Schneeball: Nur Ratenzahlungen zählen mit. Über „Ratenänderung ab Monat“ kannst du z. B. Kreiskasse ab Dezember auf 185 € setzen, ohne frühere Monate zu verändern.';
    content.appendChild(hint);

    showModal(editDebt ? 'Schuld bearbeiten' : 'Neue Schuld anlegen', content, [
      {
        label: 'Abbrechen',
        className: 'secondary',
        onClick: (close) => close()
      },
      {
        label: editDebt ? 'Speichern' : 'Anlegen',
        className: 'primary',
        onClick: (close) => {
          const name = refs.nameInput.value.trim();
          const open = parseFloat(refs.openInput.value);
          let rate = parseFloat(refs.rateInput.value);
          const due = refs.dueInput.value;
          const paymentType = refs.paymentTypeSelect.value;
          if (!name) return alert('Name darf nicht leer sein.');
          if (Number.isNaN(open) || open < 0) return alert('Bitte einen gültigen offenen Betrag eingeben.');
          if (Number.isNaN(rate)) rate = 0;
          if (rate < 0) return alert('Bitte eine gültige Monatsrate eingeben.');
          if (paymentType === 'installment' && open > 0 && !(rate > 0)) return alert('Bei Ratenzahlung muss eine Monatsrate größer 0 € hinterlegt sein.');
          if (paymentType === 'open_plan') rate = 0;
          if (!due || !/^\d{4}-\d{2}$/.test(due)) return alert('Bitte eine gültige Fälligkeit wählen.');

          if (editDebt) {
            const wasOpen = Number(editDebt.amountOpen || 0) > 0;
            editDebt.name = name;
            editDebt.amountOpen = open;
            editDebt.monthlyRate = rate;
            editDebt.paymentType = paymentType;
            editDebt.nextDueMonth = due;
            const rateChangeMonth = refs.rateChangeMonthInput.value;
            const rateChangeAmountRaw = parseFloat(refs.rateChangeAmountInput.value);
            if (rateChangeMonth && !Number.isNaN(rateChangeAmountRaw)) setDebtRateFromMonth(editDebt, rateChangeMonth, rateChangeAmountRaw);
            if (open <= 0 && wasOpen) editDebt.completedMonth = currentMonth;
            if (open > 0) delete editDebt.completedMonth;
          } else {
            const newDebt = { id: generateId(), name, amountOpen: open, monthlyRate: rate, paymentType, nextDueMonth: due, paidMonths: [], rateTimeline: [] };
            const rateChangeMonth = refs.rateChangeMonthInput.value;
            const rateChangeAmountRaw = parseFloat(refs.rateChangeAmountInput.value);
            if (rateChangeMonth && !Number.isNaN(rateChangeAmountRaw)) setDebtRateFromMonth(newDebt, rateChangeMonth, rateChangeAmountRaw);
            if (open <= 0) newDebt.completedMonth = currentMonth;
            state.debts.push(newDebt);
          }
          saveState();
          render();
          close();
        }
      }
    ]);
  }
  // Rendert die Einstellungen
  function renderSettings() {
    settingsSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const monthRow = document.createElement('div');
    monthRow.className = 'row';
    const monthLabel = document.createElement('label');
    monthLabel.textContent = 'Monat:';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      setCurrentMonth(e.target.value);
      render();
    });
    monthRow.appendChild(monthLabel);
    monthRow.appendChild(monthSelect);
    card.appendChild(monthRow);

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = 'Bearbeiten öffnet jetzt eine kompakte Maske. So bleibt der Bereich schlanker, und Monatsanpassungen sind trotzdem schnell erreichbar.';
    card.appendChild(hint);

    const totalBaseIncome = state.persons.reduce((sum, p) => sum + Number(p.net || 0), 0);
    const totalActiveIncome = state.persons.reduce((sum, p) => sum + getPersonNet(p, currentMonth), 0);
    const adjustedPersons = state.persons.filter((p) => getPersonNetSourceLabel(p, currentMonth) !== 'Basiswert').length;
    card.appendChild(createSummaryMetrics([
      { label: 'Basis-Netto gesamt', value: `${totalBaseIncome.toFixed(2)} €` },
      { label: `Aktiv in ${formatMonthLabel(currentMonth)}`, value: `${totalActiveIncome.toFixed(2)} €`, kind: totalActiveIncome >= totalBaseIncome ? 'success' : 'warning' },
      { label: 'Angepasste Personen', value: String(adjustedPersons), kind: adjustedPersons > 0 ? 'warning' : 'success' },
      { label: 'Personen gesamt', value: String(state.persons.length) }
    ]));

    state.persons.forEach((p) => {
      ensurePersonIncomeConfig(p);
      const personCard = document.createElement('div');
      personCard.className = 'card';

      const headRow = document.createElement('div');
      headRow.className = 'row';
      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = p.name;
      titleWrap.appendChild(title);

      const sourceLabel = getPersonNetSourceLabel(p, currentMonth);
      const sourceKind = sourceLabel === 'Basiswert' ? 'success' : 'warning';

      const shiftInfo = document.createElement('p');
      shiftInfo.className = 'small muted';
      shiftInfo.textContent = 'Wichtige Werte sind direkt als Kacheln sichtbar. Details und Änderungen öffnest du weiter über „Bearbeiten“. ';
      titleWrap.appendChild(shiftInfo);

      const btnWrap = document.createElement('div');
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Bearbeiten';
      editBtn.className = 'primary';
      editBtn.addEventListener('click', () => showPersonIncomeEditor(p));
      btnWrap.appendChild(editBtn);

      headRow.appendChild(titleWrap);
      headRow.appendChild(btnWrap);
      personCard.appendChild(headRow);

      personCard.appendChild(createSummaryMetrics([
        { label: 'Basis-Netto', value: `${Number(p.net || 0).toFixed(2)} €` },
        { label: `Aktiv in ${formatMonthLabel(currentMonth)}`, value: `${getPersonNet(p, currentMonth).toFixed(2)} €`, kind: sourceKind },
        { label: 'Verschiebung', value: `${Number(p.shift || 0).toFixed(2)} €` },
        { label: 'Quelle', value: sourceLabel, kind: sourceKind }
      ]));

      const nextTimeline = Array.isArray(p.netTimeline)
        ? p.netTimeline
            .filter((entry) => entry && monthDiff(currentMonth, entry.month) >= 0)
            .sort((a, b) => monthDiff(currentMonth, a.month) - monthDiff(currentMonth, b.month))[0]
        : null;

      const timelineHint = document.createElement('p');
      timelineHint.className = 'small muted';
      if (nextTimeline && nextTimeline.month !== currentMonth) {
        timelineHint.textContent = `Nächste dauerhafte Änderung: ${nextTimeline.amount.toFixed(2)} € ab ${formatMonthLabel(nextTimeline.month)}.`;
      } else if (getPersonNetSourceLabel(p, currentMonth) === 'dauerhaft ab diesem Monat') {
        timelineHint.textContent = `Für ${formatMonthLabel(currentMonth)} ist bereits eine dauerhafte Änderung gespeichert.`;
      } else {
        timelineHint.textContent = 'Keine weitere dauerhafte Einkommensänderung gespeichert.';
      }
      personCard.appendChild(timelineHint);

      card.appendChild(personCard);
    });
    settingsSection.appendChild(card);
  }
  // Rendert den Bereich „Rücklagen & Sparen“ – nur Verteilung und Transaktionen
  
function renderSavings() {
    savingsSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';

    const monthRow = document.createElement('div');
    monthRow.className = 'row';
    const monthLbl = document.createElement('label');
    monthLbl.textContent = 'Monat:';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      setCurrentMonth(e.target.value);
      render();
    });
    monthRow.appendChild(monthLbl);
    monthRow.appendChild(monthSelect);
    card.appendChild(monthRow);

    const heading = document.createElement('h2');
    heading.textContent = 'Rücklagen & Sparen';
    card.appendChild(heading);

    const selectedLabel = document.createElement('p');
    selectedLabel.innerHTML = `<strong>Ausgewählter Monat:</strong> ${formatMonthLabel(currentMonth)}`;
    card.appendChild(selectedLabel);

    const beforeStart = monthDiff(savingsConfig.startMonth, currentMonth) < 0;
    const free = computeFreeSumForMonth(currentMonth);
    const verteilbar = beforeStart ? 0 : Math.max(free, 0);
    const ruecklagen = beforeStart ? 0 : verteilbar * savingsConfig.reservesRatio;
    const sparen = beforeStart ? 0 : verteilbar * savingsConfig.savingsRatio;

    card.appendChild(createSummaryMetrics([
      { label: 'Verfügbar am Monatsende', value: `${free.toFixed(2)} €`, kind: free > 0 ? 'success' : 'warning' },
      { label: 'Verteilbar in Töpfe', value: `${verteilbar.toFixed(2)} €`, kind: verteilbar > 0 ? 'success' : 'warning' },
      { label: 'Rücklagen-Anteil', value: `${ruecklagen.toFixed(2)} €`, kind: ruecklagen > 0 ? 'success' : '' },
      { label: 'Sparen-Anteil', value: `${sparen.toFixed(2)} €`, kind: sparen > 0 ? 'success' : '' }
    ]));

    const info = document.createElement('p');
    info.className = 'small muted';
    if (beforeStart) {
      info.innerHTML = `Die Verteilung startet erst ab <strong>${formatMonthLabel(savingsConfig.startMonth)}</strong>.`;
    } else {
      info.innerHTML = `Am Monatsende verteilst du den tatsächlich verfügbaren Restbetrag in Rücklagen und Sparen. Bezahlte sonstige Ausgaben werden dabei berücksichtigt; ein fester Mindestpuffer wird nicht mehr abgezogen.`;
    }
    card.appendChild(info);

    const table = document.createElement('table');
    table.className = 'list-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Topf</th><th>Betrag</th><th>Status</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');

    const items = [
      { key: 'Auto', label: 'Auto', amount: ruecklagen * savingsConfig.reservePotShares['Auto'], doneLabel: 'Zurückgelegt' },
      { key: 'Urlaub', label: 'Urlaub', amount: ruecklagen * savingsConfig.reservePotShares['Urlaub'], doneLabel: 'Zurückgelegt' },
      { key: 'Anschaffungen (inkl. Wohnen)', label: 'Anschaffungen (inkl. Wohnen)', amount: ruecklagen * savingsConfig.reservePotShares['Anschaffungen (inkl. Wohnen)'], doneLabel: 'Zurückgelegt' },
      { key: 'Kleidung', label: 'Kleidung', amount: ruecklagen * savingsConfig.reservePotShares['Kleidung'], doneLabel: 'Zurückgelegt' },
      { key: 'Freizeit', label: 'Freizeit', amount: ruecklagen * savingsConfig.reservePotShares['Freizeit'], doneLabel: 'Zurückgelegt' },
      { key: 'Sparen', label: 'Sparen', amount: sparen, doneLabel: 'Gespart' }
    ];

    if (!state.reserveItemSaved) state.reserveItemSaved = {};
    if (!state.reserveItemSaved[currentMonth]) state.reserveItemSaved[currentMonth] = {};

    items.forEach((item) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${item.label}</td><td>${item.amount.toFixed(2)} €</td><td></td>`;
      const statusCell = row.children[2];

      if (!beforeStart && item.amount > 0) {
        const done = !!state.reserveItemSaved[currentMonth][item.key];
        const btn = document.createElement('button');
        btn.className = done ? 'secondary' : 'success';
        btn.textContent = done
          ? `${item.doneLabel} – Rückgängig`
          : (item.key === 'Sparen' ? 'Als gespart markieren' : 'Als zurückgelegt markieren');
        btn.addEventListener('click', () => {
          const nextValue = !state.reserveItemSaved[currentMonth][item.key];
          state.reserveItemSaved[currentMonth][item.key] = nextValue;
          syncReserveItemWithPot(currentMonth, item.key, nextValue);
          saveState();
          render();
        });
        statusCell.appendChild(btn);
      } else {
        statusCell.textContent = '-';
      }

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    card.appendChild(table);

    const note = document.createElement('p');
    note.textContent = 'Du kannst einzelne Beträge hier markieren oder den ganzen Monat gesammelt über „Monatsabschluss“ buchen.';
    card.appendChild(note);
    savingsSection.appendChild(card);
  }

  // Rendert den neuen Bereich „Töpfe“ mit allen Rücklagen-Töpfen und Summen
  
function renderPots() {
    potsSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'row';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      setCurrentMonth(e.target.value);
      render();
    });

    const potSelect = document.createElement('select');
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'Alle Töpfe';
    potSelect.appendChild(allOpt);
    if (!state.pots) state.pots = [];
    state.pots.forEach((pot) => {
      const opt = document.createElement('option');
      opt.value = pot.id;
      opt.textContent = pot.name;
      if (pot.id === selectedPotId) opt.selected = true;
      potSelect.appendChild(opt);
    });
    potSelect.addEventListener('change', (e) => {
      selectedPotId = e.target.value || '';
      render();
    });

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Neuer Topf';
    addBtn.className = 'primary';
    addBtn.addEventListener('click', () => {
      const name = prompt('Name des Topfs:');
      if (name == null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const initialStr = prompt('Startbetrag (in €):', '0');
      let initial = parseFloat(initialStr);
      if (isNaN(initial)) initial = 0;
      state.pots.push({ id: generateId(), name: trimmed, balance: initial, transactions: [] });
      saveState();
      render();
    });

    header.appendChild(monthSelect);
    header.appendChild(potSelect);
    header.appendChild(addBtn);
    card.appendChild(header);

    let totalManual = 0;
    let totalReservePlan = 0;
    let monthDeposits = 0;
    let monthWithdrawals = 0;
    state.pots.forEach((p) => {
      totalManual += Number(p.balance || 0);
      monthList.forEach((m) => {
        totalReservePlan += p.name === 'Sparen' ? getSavingsContribution(m.key) : getReserveContributionForPot(p.name, m.key);
      });
      (p.transactions || []).forEach((t) => {
        if (t.date === currentMonth) {
          if (Number(t.amount || 0) >= 0) monthDeposits += Number(t.amount || 0);
          if (Number(t.amount || 0) < 0) monthWithdrawals += Math.abs(Number(t.amount || 0));
        }
      });
    });
    card.appendChild(createSummaryMetrics([
      { label: 'Gesamt in Töpfen', value: `${totalManual.toFixed(2)} €`, kind: totalManual > 0 ? 'success' : '' },
      { label: 'Plan 12 Monate', value: `${totalReservePlan.toFixed(2)} €` },
      { label: `Einzahlungen ${formatMonthLabel(currentMonth)}`, value: `${monthDeposits.toFixed(2)} €`, kind: monthDeposits > 0 ? 'success' : '' },
      { label: `Ausgaben ${formatMonthLabel(currentMonth)}`, value: `${monthWithdrawals.toFixed(2)} €`, kind: monthWithdrawals > 0 ? 'warning' : '' },
      { label: 'Anzahl Töpfe', value: String(state.pots.length) }
    ]));

    const table = document.createElement('table');
    table.className = 'list-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Name</th><th>Saldo</th><th>Plan (12 Monate)</th><th>Aktion</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');

    state.pots.forEach((pot) => {
      if (!pot.transactions) pot.transactions = [];
      if (typeof pot.balance !== 'number') pot.balance = Number(pot.balance || 0);
      const tr = document.createElement('tr');
      let autoSum = 0;
      monthList.forEach((m) => {
        autoSum += pot.name === 'Sparen' ? getSavingsContribution(m.key) : getReserveContributionForPot(pot.name, m.key);
      });

      tr.innerHTML = `<td>${pot.name}</td><td>${pot.balance.toFixed(2)} €</td><td>${autoSum.toFixed(2)} €</td><td></td>`;
      const act = tr.children[3];

      const dep = document.createElement('button');
      dep.textContent = 'Einzahlen';
      dep.className = 'success';
      dep.addEventListener('click', () => {
        const amountStr = prompt(`Betrag zum Einzahlen in "${pot.name}":`, '0');
        if (amountStr == null) return;
        let amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) return alert('Bitte einen positiven Betrag eingeben.');
        const desc = prompt('Beschreibung (optional):', 'Einzahlung');
        pot.balance += amount;
        pot.transactions.push({ date: currentMonth, type: 'deposit', amount: amount, description: desc || '' });
        saveState();
        render();
      });

      const wit = document.createElement('button');
      wit.textContent = 'Ausgeben';
      wit.className = 'danger';
      wit.addEventListener('click', () => {
        const amountStr = prompt(`Betrag zum Ausgeben aus "${pot.name}":`, '0');
        if (amountStr == null) return;
        let amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) return alert('Bitte einen positiven Betrag eingeben.');
        if (amount > pot.balance) {
          if (!confirm('Der Betrag ist größer als der Saldo. Trotzdem fortfahren?')) return;
        }
        const desc = prompt('Beschreibung (optional):', 'Ausgabe');
        pot.balance -= amount;
        pot.transactions.push({ date: currentMonth, type: 'withdraw', amount: -amount, description: desc || '' });
        saveState();
        render();
      });

      act.appendChild(dep);
      act.appendChild(wit);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    card.appendChild(table);

    if (selectedPotId) {
      const pot = state.pots.find((p) => p.id === selectedPotId);
      if (pot) {
        const detailCard = document.createElement('div');
        detailCard.className = 'card';
        const detailTitle = document.createElement('h3');
        detailTitle.textContent = `Details für ${pot.name}`;
        detailCard.appendChild(detailTitle);

        const detTable = document.createElement('table');
        detTable.className = 'list-table';
        const dHead = document.createElement('thead');
        dHead.innerHTML = '<tr><th>Monat</th><th>Plan</th><th>Einzahlungen</th><th>Auszahlungen</th></tr>';
        detTable.appendChild(dHead);
        const dBody = document.createElement('tbody');

        monthList.forEach((m) => {
          const autoVal = pot.name === 'Sparen' ? getSavingsContribution(m.key) : getReserveContributionForPot(pot.name, m.key);
          let dep = 0;
          let wit = 0;
          (pot.transactions || []).forEach((t) => {
            if (t.date === m.key) {
              if (Number(t.amount) >= 0) dep += Number(t.amount || 0);
              if (Number(t.amount) < 0) wit += Math.abs(Number(t.amount || 0));
            }
          });
          const dRow = document.createElement('tr');
          dRow.innerHTML = `<td>${m.label}</td><td>${autoVal.toFixed(2)} €</td><td>${dep.toFixed(2)} €</td><td>${wit.toFixed(2)} €</td>`;
          dBody.appendChild(dRow);
        });

        detTable.appendChild(dBody);
        detailCard.appendChild(detTable);

        let sumAuto = 0;
        monthList.forEach((m) => {
          sumAuto += pot.name === 'Sparen' ? getSavingsContribution(m.key) : getReserveContributionForPot(pot.name, m.key);
        });
        const summaryDetail = document.createElement('p');
        summaryDetail.innerHTML = `<strong>Plan-Gesamt für 12 Monate:</strong> ${sumAuto.toFixed(2)} €`;
        detailCard.appendChild(summaryDetail);
        card.appendChild(detailCard);
      }
    }

    potsSection.appendChild(card);
  }
  // Rendert den Sicherungsbereich

  function createBackupFilename() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    return `haushaltsplaner-backup-${yyyy}-${mm}-${dd}-${hh}${mi}.json`;
  }

  function createBackupFile() {
    normalizeAppMeta();
    const backupState = JSON.parse(JSON.stringify(state));
    if (!state.appMeta.includeApiKeyInBackup && backupState.tankCalc) {
      backupState.tankCalc.apiKey = '';
    }
    const dataStr = JSON.stringify(backupState, null, 2);
    const filename = createBackupFilename();
    const blob = new Blob([dataStr], { type: 'application/json' });
    const file = new File([blob], filename, { type: 'application/json' });
    return { blob, file, filename };
  }

  async function saveBackupViaShareSheet() {
    const { blob, file, filename } = createBackupFile();
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Haushaltsplaner Backup',
          text: 'Backup für iCloud Drive oder Dateien sichern'
        });
        return true;
      } catch (err) {
        if (String(err && err.name) === 'AbortError') return false;
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  }




  function renderSave() {
    saveSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';

    const h2 = document.createElement('h2');
    h2.textContent = 'Backup';
    card.appendChild(h2);

    const intro = document.createElement('p');
    intro.textContent = 'Hier kannst du ein Backup für iCloud Drive oder Dateien erstellen und eine vorhandene Backup-Datei wiederherstellen.';
    card.appendChild(intro);

    normalizeAppMeta();
    const apiBackupRow = document.createElement('label');
    apiBackupRow.className = 'checkbox-row';
    const apiBackupCheck = document.createElement('input');
    apiBackupCheck.type = 'checkbox';
    apiBackupCheck.checked = state.appMeta.includeApiKeyInBackup !== false;
    apiBackupCheck.addEventListener('change', () => {
      state.appMeta.includeApiKeyInBackup = apiBackupCheck.checked;
      saveState();
      render();
    });
    const apiBackupText = document.createElement('span');
    apiBackupText.textContent = 'Tank-API-Key im Backup mitsichern';
    apiBackupRow.appendChild(apiBackupCheck);
    apiBackupRow.appendChild(apiBackupText);
    card.appendChild(apiBackupRow);

    const totalPosts = (state.commonCosts?.length || 0) + (state.personalCosts?.length || 0) + (state.bufferExpenses?.length || 0);
    card.appendChild(createSummaryMetrics([
      { label: 'Personen', value: String(state.persons.length) },
      { label: 'Posten gesamt', value: String(totalPosts) },
      { label: 'Schulden', value: String(state.debts.length) },
      { label: 'Töpfe', value: String(state.pots.length) },
      { label: 'Aktiver Monat', value: formatMonthLabel(currentMonth) },
      { label: 'Zuletzt gespeichert', value: localStorage.getItem('budgetStateLastSavedAt') ? new Date(localStorage.getItem('budgetStateLastSavedAt')).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-' }
    ]));

    const actionRow = document.createElement('div');
    actionRow.className = 'row';

    const cloudBtn = document.createElement('button');
    cloudBtn.textContent = 'iCloud-Backup erstellen';
    cloudBtn.className = 'primary';
    cloudBtn.addEventListener('click', async () => {
      try {
        const success = await saveBackupViaShareSheet();
        if (success) {
          alert('Backup erstellt. Wähle jetzt in der Teilen-Ansicht am besten „In Dateien sichern“ und danach iCloud Drive.');
        }
      } catch (err) {
        alert('Fehler beim Backup: ' + err.message);
      }
    });

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Backup herunterladen';
    exportBtn.className = 'secondary';
    exportBtn.addEventListener('click', () => {
      try {
        const { blob, filename } = createBackupFile();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (err) {
        alert('Fehler beim Export: ' + err.message);
      }
    });

    actionRow.appendChild(cloudBtn);
    actionRow.appendChild(exportBtn);
    card.appendChild(actionRow);

    const restoreCard = document.createElement('div');
    restoreCard.className = 'card';
    const restoreTitle = document.createElement('h3');
    restoreTitle.textContent = 'Backup wiederherstellen';
    restoreCard.appendChild(restoreTitle);

    const restoreInfo = document.createElement('p');
    restoreInfo.textContent = 'Wähle eine JSON-Backup-Datei aus und starte danach den Import. Auf dem Laptop ist das zuverlässiger als ein Sofort-Import direkt nach der Dateiauswahl.';
    restoreCard.appendChild(restoreInfo);

    const fileRow = document.createElement('div');
    fileRow.className = 'row';

    const fileWrap = document.createElement('div');
    const restoreLabel = document.createElement('label');
    restoreLabel.textContent = 'Backup-Datei auswählen';
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json,application/json';
    fileWrap.appendChild(restoreLabel);
    fileWrap.appendChild(importInput);
    fileRow.appendChild(fileWrap);
    restoreCard.appendChild(fileRow);

    const selectedInfo = document.createElement('p');
    selectedInfo.textContent = 'Noch keine Datei ausgewählt.';
    restoreCard.appendChild(selectedInfo);

    const statusBox = document.createElement('div');
    statusBox.className = 'inline-status';
    statusBox.hidden = true;
    restoreCard.appendChild(statusBox);

    let statusTimeout = null;
    const setInlineStatus = (message, kind = 'success') => {
      if (statusTimeout) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
      }
      statusBox.hidden = false;
      statusBox.className = `inline-status ${kind}`;
      statusBox.textContent = message;
      if (kind === 'success') {
        statusTimeout = setTimeout(() => {
          statusBox.hidden = true;
          statusBox.textContent = '';
        }, 4000);
      }
    };

    const importBtn = document.createElement('button');
    importBtn.textContent = 'Backup jetzt importieren';
    importBtn.className = 'primary';
    importBtn.disabled = true;
    restoreCard.appendChild(importBtn);

    let selectedFile = null;

    importInput.addEventListener('change', (e) => {
      selectedFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
      statusBox.hidden = true;
      if (selectedFile) {
        selectedInfo.textContent = `Ausgewählt: ${selectedFile.name}`;
        importBtn.disabled = false;
      } else {
        selectedInfo.textContent = 'Noch keine Datei ausgewählt.';
        importBtn.disabled = true;
      }
    });

    importBtn.addEventListener('click', () => {
      if (!selectedFile) {
        setInlineStatus('Bitte zuerst eine Backup-Datei auswählen.', 'error');
        return;
      }
      importBtn.disabled = true;
      importBtn.textContent = 'Import läuft ...';
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.persons && data.commonCosts && data.personalCosts && data.debts) {
            state = data;
            if (!state.reservesSavedMonths) state.reservesSavedMonths = [];
            if (!state.reserveItemSaved) state.reserveItemSaved = {};
            if (!state.tankCalc) state.tankCalc = JSON.parse(JSON.stringify(defaultState.tankCalc));
            if (!Array.isArray(state.bufferExpenses)) state.bufferExpenses = [];
    if (!state.monthlyClosings || typeof state.monthlyClosings !== 'object') state.monthlyClosings = {};
    if (!Array.isArray(state.changeLog)) state.changeLog = [];
            if (!state.appMeta || typeof state.appMeta !== 'object') state.appMeta = JSON.parse(JSON.stringify(defaultState.appMeta));
            normalizeAppMeta();
            migrateKreiskasseToBennyPersonal();
            syncAllReserveSelectionsToPots();
            normalizeAllPersonConfigs();
            normalizeAllPostConfigs();
            normalizeAllDebtConfigs();
            autoLinkMatchingDebtPosts();
            setCurrentMonth(state.appMeta.selectedMonth || dateToMonthKey(new Date()));
            saveState();
            importInput.value = '';
            selectedFile = null;
            setInlineStatus('Import erfolgreich. Das Backup wurde wiederhergestellt.', 'success');
            render();
            return;
          } else {
            setInlineStatus('Ungültiges Datenformat.', 'error');
          }
        } catch (err) {
          setInlineStatus('Fehler beim Import: ' + err.message, 'error');
        }
        importBtn.disabled = false;
        importBtn.textContent = 'Backup jetzt importieren';
      };
      reader.onerror = () => {
        setInlineStatus('Die Datei konnte nicht gelesen werden.', 'error');
        importBtn.disabled = false;
        importBtn.textContent = 'Backup jetzt importieren';
      };
      reader.readAsText(selectedFile);
    });

    card.appendChild(restoreCard);
    saveSection.appendChild(card);
  }

  // Hilfsfunktionen zum Erstellen von Monatsauswahl und Label-Input-Paaren

  function parseSortableValue(raw) {
    const text = (raw || '').replace(/ /g, ' ').trim();
    if (!text || text === '-') return { type: 'text', value: '' };
    if (/^\d{4}-\d{2}$/.test(text)) return { type: 'date', value: text };
    const normalized = text
      .replace(/€/g, '')
      .replace(/\s/g, '')
      .replace(/\./g, '')
      .replace(/,/g, '.');
    if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
      return { type: 'number', value: parseFloat(normalized) };
    }
    return { type: 'text', value: text.toLowerCase() };
  }

  function compareSortableValues(a, b, direction) {
    const dir = direction === 'desc' ? -1 : 1;
    if (a.type === 'number' && b.type === 'number') {
      return (a.value - b.value) * dir;
    }
    if (a.type === 'date' && b.type === 'date') {
      return a.value.localeCompare(b.value) * dir;
    }
    return String(a.value).localeCompare(String(b.value), 'de') * dir;
  }

  function enableTableSorting() {
    document.querySelectorAll('.list-table').forEach((table) => {
      const thead = table.querySelector('thead');
      const tbody = table.querySelector('tbody');
      if (!thead || !tbody) return;
      const headers = Array.from(thead.querySelectorAll('th'));
      headers.forEach((th, index) => {
        const label = (th.textContent || '').trim().toLowerCase();
        if (['aktion', 'bezahlt?', 'status'].includes(label)) {
          th.style.cursor = 'default';
          return;
        }
        th.style.cursor = 'pointer';
        th.title = 'Zum Sortieren antippen';
        th.onclick = () => {
          const currentIndex = Number(table.dataset.sortIndex || -1);
          const currentDir = table.dataset.sortDir || 'asc';
          const nextDir = currentIndex === index && currentDir === 'asc' ? 'desc' : 'asc';
          const rows = Array.from(tbody.querySelectorAll('tr'));
          rows.sort((rowA, rowB) => {
            const aText = rowA.children[index] ? rowA.children[index].innerText : '';
            const bText = rowB.children[index] ? rowB.children[index].innerText : '';
            return compareSortableValues(parseSortableValue(aText), parseSortableValue(bText), nextDir);
          });
          rows.forEach((row) => tbody.appendChild(row));
          table.dataset.sortIndex = String(index);
          table.dataset.sortDir = nextDir;
          headers.forEach((header, i) => {
            const base = (header.dataset.baseLabel || header.textContent || '').replace(/\s[↑↓]$/, '');
            header.dataset.baseLabel = base;
            if (i === index) {
              header.textContent = `${base} ${nextDir === 'asc' ? '↑' : '↓'}`;
            } else {
              header.textContent = base;
            }
          });
        };
      });
    });
  }

  function createMonthSelect() {
    const select = document.createElement('select');
    monthList.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.key;
      opt.textContent = m.label;
      if (m.key === currentMonth) opt.selected = true;
      select.appendChild(opt);
    });
    return select;
  }
  function updateMonthListIfNeeded() {
    if (!monthList.find((m) => m.key === currentMonth)) {
      monthList = getNext12Months(currentMonth);
    }
  }

  function setCurrentMonth(monthKey, persist = true) {
    if (!isMonthKey(monthKey)) return;
    currentMonth = monthKey;
    updateMonthListIfNeeded();
    if (persist) {
      normalizeAppMeta();
      state.appMeta.selectedMonth = monthKey;
      saveState();
    }
  }

  function syncCurrentMonthToActualDate() {
    const actualMonth = dateToMonthKey(new Date());
    normalizeAppMeta();
    if (state.appMeta.lastAutoMonthCheck !== actualMonth) {
      currentMonth = actualMonth;
      updateMonthListIfNeeded();
      state.appMeta.lastAutoMonthCheck = actualMonth;
      state.appMeta.selectedMonth = actualMonth;
      saveState();
      return true;
    }
    return false;
  }

  function createSummaryMetrics(items) {
    const wrap = document.createElement('div');
    wrap.className = 'summary-metrics';
    items.forEach((item) => {
      const box = document.createElement('div');
      box.className = `summary-metric ${item.kind || ''}`.trim();
      const label = document.createElement('div');
      label.className = 'summary-metric-label';
      label.textContent = item.label;
      const value = document.createElement('div');
      value.className = 'summary-metric-value';
      value.innerHTML = item.value;
      box.appendChild(label);
      box.appendChild(value);
      if (item.hint) {
        const hint = document.createElement('div');
        hint.className = 'summary-metric-hint';
        hint.textContent = item.hint;
        box.appendChild(hint);
      }
      wrap.appendChild(box);
    });
    return wrap;
  }

  function createLabelInput(labelText, inputEl) {
    const wrapper = document.createElement('div');
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    wrapper.appendChild(lbl);
    wrapper.appendChild(inputEl);
    return wrapper;
  }

  function showModal(title, contentEl, buttons = []) {
    const overlay = document.createElement('div');
    overlay.className = 'app-modal-overlay';
    const panel = document.createElement('div');
    panel.className = 'app-modal';
    const header = document.createElement('div');
    header.className = 'app-modal-header';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'secondary app-modal-close';
    closeBtn.textContent = '×';
    header.appendChild(heading);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'app-modal-body';
    if (contentEl) body.appendChild(contentEl);

    const footer = document.createElement('div');
    footer.className = 'app-modal-footer';

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);

    const close = () => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    buttons.forEach((config) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = config.label;
      btn.className = config.className || 'secondary';
      btn.addEventListener('click', () => {
        if (typeof config.onClick === 'function') config.onClick(close);
        else close();
      });
      footer.appendChild(btn);
    });

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown);

    const firstField = panel.querySelector('input, select, textarea');
    if (firstField) setTimeout(() => firstField.focus(), 0);
    return { overlay, panel, body, footer, close };
  }

  function showPersonIncomeEditor(person) {
    ensurePersonIncomeConfig(person);
    const refs = {};
    const content = document.createElement('div');
    content.className = 'modal-form';

    const currentInfo = document.createElement('p');
    currentInfo.className = 'small';
    currentInfo.innerHTML = `<strong>Aktiv in ${formatMonthLabel(currentMonth)}:</strong> ${getPersonNet(person, currentMonth).toFixed(2)} € <span class="muted">(${getPersonNetSourceLabel(person, currentMonth)})</span>`;
    content.appendChild(currentInfo);

    const baseRow = document.createElement('div');
    baseRow.className = 'row';
    refs.nameInput = document.createElement('input');
    refs.nameInput.type = 'text';
    refs.nameInput.value = person.name;
    refs.baseNetInput = document.createElement('input');
    refs.baseNetInput.type = 'number';
    refs.baseNetInput.step = '0.01';
    refs.baseNetInput.value = Number(person.net || 0);
    refs.shiftInput = document.createElement('input');
    refs.shiftInput.type = 'number';
    refs.shiftInput.step = '0.01';
    refs.shiftInput.value = Number(person.shift || 0);
    baseRow.appendChild(createLabelInput('Name', refs.nameInput));
    baseRow.appendChild(createLabelInput('Netto (Basis)', refs.baseNetInput));
    baseRow.appendChild(createLabelInput('Verschiebung', refs.shiftInput));
    content.appendChild(baseRow);

    const adjustRow = document.createElement('div');
    adjustRow.className = 'row';
    refs.monthNetInput = document.createElement('input');
    refs.monthNetInput.type = 'number';
    refs.monthNetInput.step = '0.01';
    refs.monthNetInput.placeholder = getPersonNet(person, currentMonth).toFixed(2);
    refs.modeSelect = document.createElement('select');
    refs.modeSelect.innerHTML = `
      <option value="once">Nur dieser Monat</option>
      <option value="future">Ab diesem Monat dauerhaft</option>
    `;
    adjustRow.appendChild(createLabelInput(`Netto für ${formatMonthLabel(currentMonth)} (optional)`, refs.monthNetInput));
    adjustRow.appendChild(createLabelInput('Änderung gilt', refs.modeSelect));
    content.appendChild(adjustRow);

    const helper = document.createElement('p');
    helper.className = 'small muted';
    helper.textContent = 'Lass das Monatsfeld leer, wenn du nur Name, Basis-Netto oder Verschiebung ändern willst.';
    content.appendChild(helper);

    showModal(`${person.name} bearbeiten`, content, [
      {
        label: 'Nur Monatswert löschen',
        className: 'secondary',
        onClick: (close) => {
          clearPersonNetForMonth(person, currentMonth, 'once');
          saveState();
          render();
          close();
        }
      },
      {
        label: 'Dauerwert ab Monat löschen',
        className: 'secondary',
        onClick: (close) => {
          clearPersonNetForMonth(person, currentMonth, 'future');
          saveState();
          render();
          close();
        }
      },
      {
        label: 'Abbrechen',
        className: 'secondary',
        onClick: (close) => close()
      },
      {
        label: 'Speichern',
        className: 'primary',
        onClick: (close) => {
          const newName = refs.nameInput.value.trim();
          const baseNet = parseFloat(refs.baseNetInput.value);
          const shift = parseFloat(refs.shiftInput.value);
          if (!newName) return alert('Name darf nicht leer sein.');
          if (Number.isNaN(baseNet) || baseNet < 0) return alert('Bitte ein gültiges Basis-Netto eingeben.');
          if (Number.isNaN(shift)) return alert('Bitte eine gültige Verschiebung eingeben.');

          person.name = newName;
          person.net = baseNet;
          person.shift = shift;

          const rawMonthValue = refs.monthNetInput.value.trim();
          if (rawMonthValue !== '') {
            const monthNet = parseFloat(rawMonthValue);
            if (Number.isNaN(monthNet) || monthNet < 0) return alert('Bitte ein gültiges Monats-Netto eingeben.');
            if (!setPersonNetForMonth(person, currentMonth, monthNet, refs.modeSelect.value)) return;
          }

          saveState();
          render();
          close();
        }
      }
    ]);
  }

  function generateId() {
    return Math.random().toString(36).substring(2, 10);
  }
  
  // Kleine Versionsanzeige oben aktualisieren. Wenn per Neu-Laden ein Refresh-Parameter gesetzt wurde,
  // wird kurz "Update geladen" gezeigt.
  const versionChip = document.getElementById('versionChip');
  if (versionChip) {
    const params = new URLSearchParams(window.location.search);
    if (params.has('refresh')) {
      versionChip.textContent = 'Update 0.98 geladen';
      setTimeout(() => {
        versionChip.textContent = 'Version 0.98 geladen';
      }, 2500);
    } else {
      versionChip.textContent = 'Version 0.98 geladen';
    }
  }


  // Zusätzlicher Schutz auf Mac/Safari/iPhone: Wenn der Browser Tabs einfriert,
  // die App minimiert oder die Seite neu lädt, wird der aktuelle Zustand vorher
  // noch einmal in mehreren lokalen Speicher-Schlüsseln gesichert.
  window.addEventListener('beforeunload', () => saveState());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveState();
  });
  window.addEventListener('pagehide', () => saveState());

  updateSaveStatus();
  // Starte das Rendering
  render();
})();