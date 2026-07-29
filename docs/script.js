/*
 * Haushaltsplaner Developer Beta 2.51
 *
 * Die Monatsanteile der gemeinsamen Kosten können pro Person und Monat
 * manuell eingetragen werden. Deutsche Komma-Beträge werden unterstützt;
 * ohne manuellen Wert bleibt die automatische Aufteilung aktiv.
 */

(() => {
  // Browserdaten werden beim normalen App-Start NICHT mehr angefasst.
  // Service-Worker/Caches werden nur noch über die bewusste Aktion „Neu laden" bereinigt,
  // damit localStorage/Backups beim Versionswechsel zuverlässig erhalten bleiben.
  // ----- Datums-Hilfsfunktionen -----
  const APP_FIRST_DATA_MONTH = '2026-04';
  const APP_FUTURE_YEAR_RANGE = 50;
  const TANK_REAL_DATA_START_MONTH = '2026-06';
  const APP_VERSION = '2.51';
  const HOUSEHOLD_ONLY_MODE = true;
  const ACCOUNTS_ENABLED = !HOUSEHOLD_ONLY_MODE;
  const APP_VERSION_STORAGE_SUFFIX = APP_VERSION.replace(/\D/g, '');
  const VERSION_READY_TEXT = `Version ${APP_VERSION} geladen`;
  const VERSION_UPDATE_TEXT = `Update ${APP_VERSION} geladen`;
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

  function getSelectableMonths(anchorKey) {
    const actualKey = dateToMonthKey(new Date());
    const keys = new Set();
    const addKey = (key) => {
      if (!isMonthKey(key)) return;
      if (key < APP_FIRST_DATA_MONTH) return;
      keys.add(key);
    };
    addKey(APP_FIRST_DATA_MONTH);
    const addFromDate = (value) => {
      if (!value) return;
      const text = String(value);
      const month = text.match(/^(\d{4}-\d{2})/);
      if (month) addKey(month[1]);
    };
    const scanPost = (post) => {
      if (!post || typeof post !== 'object') return;
      addKey(post.startMonth);
      addKey(post.endMonth);
      (post.paidMonths || []).forEach(addKey);
      (post.amountTimeline || []).forEach((entry) => addKey(entry && entry.month));
      Object.keys(post.amountOverrides || {}).forEach(addKey);
    };
    const scanDebt = (debt) => {
      if (!debt || typeof debt !== 'object') return;
      addKey(debt.nextDueMonth);
      addKey(debt.completedMonth);
      (debt.paidMonths || []).forEach(addKey);
      (debt.paymentHistory || []).forEach((entry) => addKey(entry && entry.month));
      (debt.rateTimeline || []).forEach((entry) => addKey(entry && entry.month));
    };

    for (let i = -24; i <= 36; i++) addKey(addMonths(actualKey, i));
    if (isMonthKey(anchorKey)) {
      for (let i = -12; i <= 12; i++) addKey(addMonths(anchorKey, i));
    }
    if (typeof state === 'object' && state) {
      (state.commonCosts || []).forEach(scanPost);
      (state.personalCosts || []).forEach(scanPost);
      (state.bufferExpenses || []).forEach(scanPost);
      (state.debts || []).forEach(scanDebt);
      (state.persons || []).forEach((person) => {
        Object.keys(person.netOverrides || {}).forEach(addKey);
        Object.keys(person.shiftOverrides || {}).forEach(addKey);
        (person.netTimeline || []).forEach((entry) => addKey(entry && entry.month));
      });
      Object.keys(state.monthlyClosings || {}).forEach(addKey);
      Object.keys(state.reserveItemSaved || {}).forEach(addKey);
      (state.reservesSavedMonths || []).forEach(addKey);
      (state.taxRefunds || []).forEach((refund) => {
        addFromDate(refund.receivedDate);
        (refund.purchases || []).forEach((purchase) => addFromDate(purchase.date));
      });
      (state.groceryExpenses || []).forEach((expense) => {
        addKey(expense && expense.month);
        addFromDate(expense && expense.date);
      });
    }

    return Array.from(keys).sort().map((key) => {
      const label = monthKeyToDate(key).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
      return { key, label: key === actualKey ? `${label} · aktuell` : label };
    });
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
    ensureAccountLinkField(debt);
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

  function getDebtCreditorRule(debt) {
    if (!debt || typeof debt !== 'object') return null;
    const nameKey = normalizeTextKey(debt.name || '');
    const stored = debt.creditorRule && typeof debt.creditorRule === 'object' ? debt.creditorRule : null;
    const isMkk = nameKey === 'mkk' || nameKey.includes('mkk') || nameKey.includes('meine krankenkasse');
    const isKreiskasse = nameKey.includes('kreiskasse') || nameKey.includes('opr');
    if (stored && stored.type) return stored;
    if (isMkk) {
      return {
        type: 'mkk_annual_review',
        label: 'MKK: Pflicht-Rate 40 € ab 01.05.2026; Ratenanpassung regulär nur jährlich zum 01.05. ab 2027. Sonderzahlungen, höhere freiwillige Zahlungen und Ablösung sind jederzeit erlaubt.',
        allowExtraPayments: true,
        allowSnowballTarget: true,
        allowDynamicExtra: true
      };
    }
    if (isKreiskasse) {
      return {
        type: 'locked_plan_no_extra',
        label: 'Kreiskasse OPR: festgeschriebener Ratenplan. Keine freiwilligen Sonderzahlungen, keine dynamische Extra-Tilgung und keine zusätzliche Ratenerhöhung; vorhandene geplante Erhöhung bleibt bestehen.',
        allowExtraPayments: false,
        allowSnowballTarget: false,
        allowDynamicExtra: false
      };
    }
    return null;
  }

  function isDebtExtraPaymentAllowed(debt) {
    const rule = getDebtCreditorRule(debt);
    return !(rule && rule.allowExtraPayments === false);
  }

  function isDebtAllowedAsSnowballTarget(debt) {
    const rule = getDebtCreditorRule(debt);
    return !(rule && rule.allowSnowballTarget === false);
  }

  function canModifyDebtRateForCreditor(debt, monthKey) {
    const rule = getDebtCreditorRule(debt);
    if (!rule) return true;
    if (rule.type === 'locked_plan_no_extra') {
      // Der bestehende Ratenplan wird nur gelesen. Neue manuelle oder automatische
      // Änderungen sowie zusätzliche Ratenerhöhungen sind nicht erlaubt.
      return false;
    }
    return true;
  }

  function ensureDebtCreditorRule(debt) {
    if (!debt || typeof debt !== 'object') return null;
    const rule = getDebtCreditorRule(debt);
    if (rule) {
      debt.creditorRule = {
        type: rule.type,
        label: rule.label,
        allowExtraPayments: rule.allowExtraPayments !== false,
        allowSnowballTarget: rule.allowSnowballTarget !== false,
        allowDynamicExtra: rule.allowDynamicExtra !== false
      };
      return debt.creditorRule;
    }
    return null;
  }

  function setDebtRateFromMonth(debt, month, amount) {
    if (!debt || !isMonthKey(month)) return false;
    if (!canModifyDebtRateForCreditor(debt, month)) return false;
    if (!isDebtRateChangeAllowedInMonth(debt, month)) return false;
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
    return debt.rateTimeline.map((entry) => `ab ${formatMonthLabel(entry.month)}: ${euro(Number(entry.amount || 0))}`).join(' · ');
  }

  function getNextDebtRateChangeText(debt, fromMonth = currentMonth) {
    normalizeDebtRateTimeline(debt);
    const next = debt.rateTimeline.find((entry) => monthDiff(fromMonth, entry.month) > 0);
    if (!next) return '';
    return `Nächste Änderung: ab ${formatMonthLabel(next.month)} → ${euro(Number(next.amount || 0))}`;
  }

  function getDebtAnnualRateRule(debt) {
    if (!debt || typeof debt !== 'object') return null;
    const nameKey = normalizeTextKey(debt.name || '');
    const stored = debt.rateChangeRule && typeof debt.rateChangeRule === 'object' ? debt.rateChangeRule : null;
    const isMkk = nameKey === 'mkk' || nameKey.includes('mkk') || nameKey.includes('meine krankenkasse');
    if (stored && stored.type === 'annual_review') {
      const month = Math.max(1, Math.min(12, Number(stored.month || 5)));
      const firstAllowedMonth = isMonthKey(stored.firstAllowedMonth) ? stored.firstAllowedMonth : (isMkk ? '2027-05' : '');
      return {
        type: 'annual_review',
        month,
        firstAllowedMonth,
        label: stored.label || `Anpassung nur jährlich zum 01.${String(month).padStart(2, '0')}.`
      };
    }
    if (isMkk) {
      return {
        type: 'annual_review',
        month: 5,
        firstAllowedMonth: '2027-05',
        label: 'MKK: Pflicht-Rate 40 € ab 01.05.2026; erste Ratenprüfung nach 12 Raten, danach nur jährlich zum 01.05. anpassen. Sonderzahlungen und komplette Ablösung bleiben jederzeit möglich.'
      };
    }
    return null;
  }

  function ensureDebtRateChangeRule(debt) {
    if (!debt || typeof debt !== 'object') return null;
    const rule = getDebtAnnualRateRule(debt);
    if (rule) {
      debt.rateChangeRule = { type: 'annual_review', month: rule.month, label: rule.label };
      if (rule.firstAllowedMonth) debt.rateChangeRule.firstAllowedMonth = rule.firstAllowedMonth;
      return debt.rateChangeRule;
    }
    if (debt.rateChangeRule && debt.rateChangeRule.type !== 'annual_review') delete debt.rateChangeRule;
    return null;
  }

  function isDebtRateChangeAllowedInMonth(debt, monthKey) {
    if (!isMonthKey(monthKey)) return false;
    const rule = getDebtAnnualRateRule(debt);
    if (!rule) return true;
    if (rule.firstAllowedMonth && monthDiff(rule.firstAllowedMonth, monthKey) < 0) return false;
    return Number(monthKey.slice(5, 7)) === Number(rule.month);
  }

  function getNextAllowedDebtRateChangeMonth(debt, fromMonth = currentMonth) {
    const rule = getDebtAnnualRateRule(debt);
    if (!rule) return isMonthKey(fromMonth) ? fromMonth : dateToMonthKey(new Date());
    let base = isMonthKey(fromMonth) ? fromMonth : dateToMonthKey(new Date());
    if (rule.firstAllowedMonth && monthDiff(base, rule.firstAllowedMonth) > 0) base = rule.firstAllowedMonth;
    const year = Number(base.slice(0, 4));
    const month = String(rule.month).padStart(2, '0');
    let candidate = `${year}-${month}`;
    if (monthDiff(base, candidate) < 0) candidate = `${year + 1}-${month}`;
    if (rule.firstAllowedMonth && monthDiff(rule.firstAllowedMonth, candidate) < 0) candidate = rule.firstAllowedMonth;
    return candidate;
  }

  function getDebtRateChangeRuleText(debt) {
    const rule = getDebtAnnualRateRule(debt);
    if (!rule) return '';
    return rule.label || `Rate darf nur jährlich zum 01.${String(rule.month).padStart(2, '0')}. geändert werden.`;
  }

  function setDebtRateOnlyForMonth(debt, month, amount) {
    if (!debt || !isMonthKey(month)) return false;
    const restoreMonth = addMonths(month, 1);
    const restoreRate = getDebtRateForMonth(debt, restoreMonth);
    setDebtRateFromMonth(debt, month, amount);
    setDebtRateFromMonth(debt, restoreMonth, restoreRate);
    normalizeDebtRateTimeline(debt);
    return true;
  }

  function getDebtSyncAmountFromPost(post, monthKey) {
    if (!post || !isMonthKey(monthKey)) return 0;
    ensurePostConfig(post);
    if (!isDue(post, monthKey)) return 0;
    if (Number(post.interval || 1) !== 1) return 0;
    const amount = Number(getEffectiveAmountForMonth(post, monthKey));
    return Number.isFinite(amount) && amount >= 0 ? amount : 0;
  }

  function syncLinkedDebtRateFromPost(post, monthKey = currentMonth, mode = 'future', options = {}) {
    const debt = getLinkedDebtForPost(post);
    if (!debt || !isMonthKey(monthKey)) return false;
    ensureDebtConfig(debt);
    ensurePostConfig(post);
    if (debt.paymentType !== 'installment') return false;
    if (Number(post.interval || 1) !== 1) return false;
    const amount = Number(getEffectiveAmountForMonth(post, monthKey));
    if (!Number.isFinite(amount) || amount < 0) return false;
    const effectiveMonth = mode === 'once' ? monthKey : (isPostPaidForMonth(post, monthKey) ? nextMonth(monthKey) : monthKey);
    const targetAmount = mode === 'once' ? amount : Number(getEffectiveAmountForMonth(post, effectiveMonth));
    if (!Number.isFinite(targetAmount) || targetAmount < 0) return false;
    const previous = getDebtRateForMonth(debt, effectiveMonth);
    if (Math.abs(previous - targetAmount) <= 0.01) return false;
    if (!isDebtRateChangeAllowedInMonth(debt, effectiveMonth)) return false;
    if (mode === 'once') {
      setDebtRateOnlyForMonth(debt, effectiveMonth, targetAmount);
    } else {
      setDebtRateFromMonth(debt, effectiveMonth, targetAmount);
    }
    if (!options.silent) {
      addChangeLog('Schulden', `${debt.name}: Rate automatisch aus ${post.name || 'verknüpftem Posten'} auf ${euro(targetAmount)} ab ${formatMonthLabel(effectiveMonth)} gesetzt`, effectiveMonth);
    }
    return true;
  }

  function syncAllLinkedDebtRatesFromPosts(startMonth, months = 36, options = {}) {
    if (!state || !Array.isArray(state.debts)) return 0;
    const baseMonth = isMonthKey(startMonth) ? startMonth : dateToMonthKey(new Date());
    let changes = 0;
    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      if (debt.paymentType !== 'installment') return;
      const linkedPosts = getDebtLinkedPosts(debt).map((item) => item.post || item).filter(Boolean);
      if (!linkedPosts.length) return;
      for (let i = 0; i < months; i += 1) {
        const month = addMonths(baseMonth, i);
        const duePosts = linkedPosts
          .filter((post) => post && Number(post.interval || 1) === 1 && isDue(post, month))
          .filter((post) => Number.isFinite(Number(getEffectiveAmountForMonth(post, month))));
        if (duePosts.length !== 1) continue;
        const post = duePosts[0];
        const amount = Number(getEffectiveAmountForMonth(post, month));
        if (!(amount >= 0)) continue;
        const currentRate = getDebtRateForMonth(debt, month);
        if (Math.abs(currentRate - amount) > 0.01) {
          if (!isDebtRateChangeAllowedInMonth(debt, month)) continue;
          if (!setDebtRateFromMonth(debt, month, amount)) continue;
          changes += 1;
          if (!options.silent) {
            addChangeLog('Schulden', `${debt.name}: Rate aus verknüpftem Posten ${post.name || ''} auf ${euro(amount)} ab ${formatMonthLabel(month)} synchronisiert`, month);
          }
        }
      }
    });
    return changes;
  }

  function advanceDebtNextDueMonthAfterPayment(debt, paidMonth) {
    if (!debt || !isMonthKey(paidMonth)) return;
    if (!isMonthKey(debt.nextDueMonth) || monthDiff(debt.nextDueMonth, paidMonth) >= 0) {
      let candidate = nextMonth(paidMonth);
      for (let i = 0; i < 36 && debt.paidMonths.includes(candidate); i += 1) {
        candidate = nextMonth(candidate);
      }
      debt.nextDueMonth = candidate;
    }
  }

  function isInstallmentDebtForSnowball(debt, monthKey = currentMonth) {
    ensureDebtConfig(debt);
    const open = Number(debt.amountOpen || 0);
    const rate = getDebtRateForMonth(debt, monthKey);
    return debt.paymentType === 'installment' && open > 0 && rate > 0;
  }

  function getSnowballExcludeReason(debt, monthKey = currentMonth) {
    ensureDebtConfig(debt);
    if (!(Number(debt.amountOpen || 0) > 0)) return '';
    if (debt.paymentType === 'one_time') return 'Einmalzahlung';
    if (debt.paymentType === 'open_plan') return 'Ratenplan offen';
    if (!(getDebtRateForMonth(debt, monthKey) > 0)) return 'kein Ratenplan hinterlegt';
    if (!isInstallmentDebtForSnowball(debt, monthKey)) return 'keine laufende Ratenzahlung';
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
    ensureDebtRateChangeRule(debt);
    ensureDebtCreditorRule(debt);
    if (!Array.isArray(debt.paymentHistory)) debt.paymentHistory = [];
    debt.paymentHistory = debt.paymentHistory
      .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)))
      .map((entry) => ({
        id: entry.id || generateId(),
        month: entry.month,
        amount: Math.max(0, Number(entry.amount || 0)),
        source: entry.source || 'manuell',
        sourcePostId: typeof entry.sourcePostId === 'string' ? entry.sourcePostId : '',
        note: entry.note || '',
        createdAt: entry.createdAt || '',
        previousNextDueMonth: isMonthKey(entry.previousNextDueMonth) ? entry.previousNextDueMonth : '',
        markedAsMonthly: entry.markedAsMonthly === true,
        accountTransactionId: typeof entry.accountTransactionId === 'string' ? entry.accountTransactionId : '',
        reducedOpenBalance: entry.reducedOpenBalance !== false
      }));
    if (!['monthly', 'annual'].includes(debt.balanceCheckMode)) debt.balanceCheckMode = 'annual';
    if (!Array.isArray(debt.balanceChecks)) debt.balanceChecks = [];
    debt.balanceChecks = debt.balanceChecks
      .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)))
      .map((entry) => ({
        id: typeof entry.id === 'string' && entry.id ? entry.id : generateId(),
        month: entry.month,
        amount: Math.max(0, Number(entry.amount || 0)),
        previousAmount: Math.max(0, Number(entry.previousAmount || 0)),
        note: typeof entry.note === 'string' ? entry.note : '',
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
        appliedToOpenBalance: entry.appliedToOpenBalance !== false
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
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

  function getDebtBalanceCheckModeLabel(debt) {
    ensureDebtConfig(debt);
    return debt.balanceCheckMode === 'monthly'
      ? 'Monatlich · Stand einsehbar'
      : 'Jährlich · Stand nicht laufend einsehbar';
  }

  function getLatestDebtBalanceCheck(debt, monthKey = currentMonth) {
    ensureDebtConfig(debt);
    const targetMonth = isMonthKey(monthKey) ? monthKey : currentMonth;
    return (debt.balanceChecks || [])
      .filter((entry) => entry && isMonthKey(entry.month) && entry.month <= targetMonth)
      .sort((a, b) => b.month.localeCompare(a.month))[0] || null;
  }

  function getNextDebtBalanceCheckMonth(debt, monthKey = currentMonth) {
    ensureDebtConfig(debt);
    const targetMonth = isMonthKey(monthKey) ? monthKey : currentMonth;
    const latest = getLatestDebtBalanceCheck(debt, targetMonth);
    if (!latest) return targetMonth;
    return addMonths(latest.month, debt.balanceCheckMode === 'monthly' ? 1 : 12);
  }

  function isDebtBalanceCheckDue(debt, monthKey = currentMonth) {
    ensureDebtConfig(debt);
    if (!(Number(debt.amountOpen || 0) > 0)) return false;
    const targetMonth = isMonthKey(monthKey) ? monthKey : currentMonth;
    const latest = getLatestDebtBalanceCheck(debt, targetMonth);
    if (!latest) return true;
    const interval = debt.balanceCheckMode === 'monthly' ? 1 : 12;
    return monthDiff(latest.month, targetMonth) >= interval;
  }

  function getDueDebtBalanceChecks(monthKey = currentMonth) {
    const targetMonth = isMonthKey(monthKey) ? monthKey : currentMonth;
    return (state.debts || [])
      .filter((debt) => Number(debt && debt.amountOpen || 0) > 0)
      .filter((debt) => isDebtBalanceCheckDue(debt, targetMonth))
      .sort((a, b) => {
        ensureDebtConfig(a);
        ensureDebtConfig(b);
        if (a.balanceCheckMode !== b.balanceCheckMode) return a.balanceCheckMode === 'monthly' ? -1 : 1;
        return String(a.name || '').localeCompare(String(b.name || ''), 'de');
      });
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
    if (!debt || !isMonthKey(monthKey)) return false;
    ensureDebtConfig(debt);
    ensurePostConfig(post);
    const postAmount = getDebtSyncAmountFromPost(post, monthKey) || Number(getEffectiveAmountForMonth(post, monthKey) || 0);
    if (!(postAmount > 0)) return false;
    // Wenn der verknüpfte Kostenposten bezahlt wird, ist genau dieser Monatsbetrag maßgeblich.
    // Die Schuld darf nicht bei einer alten Rate hängen bleiben.
    if (debt.paymentType === 'installment') {
      syncLinkedDebtRateFromPost(post, monthKey, 'once', { silent: true });
    }
    return addDebtPayment(debt, {
      month: monthKey,
      amount: postAmount,
      source: `Verknüpfter Posten: ${post.name || 'Posten'}`,
      sourcePostId: post.id || '',
      markAsMonthly: true,
      skipAccountTransaction: true
    });
  }
  function resetDebtPaymentFromPost(post, monthKey) {
    const debt = getLinkedDebtForPost(post);
    if (!debt || !isMonthKey(monthKey)) return false;
    const reset = resetDebtPaymentForMonth(debt, monthKey, {
      sourcePostId: post.id || '',
      sourceLabel: `Verknüpfter Posten: ${post.name || 'Posten'}`
    });
    if (reset || !debt.paidMonths.includes(monthKey)) return reset;
    const hasOtherMonthlyProof = (debt.paymentHistory || []).some((entry) => entry && entry.month === monthKey && entry.markedAsMonthly)
      || getLinkedPostsForDebt(debt).some(({ post: candidate }) => candidate !== post && isPostPaidForMonth(candidate, monthKey));
    if (hasOtherMonthlyProof) return false;
    debt.paidMonths = debt.paidMonths.filter((month) => month !== monthKey);
    if (!debt.nextDueMonth || monthDiff(monthKey, debt.nextDueMonth) > 0) debt.nextDueMonth = monthKey;
    addChangeLog('Schulden', `${debt.name || 'Schuld'}: Bezahlt-Status ohne Zahlungsnachweis für ${formatMonthLabel(monthKey)} zurückgesetzt; Restschuld unverändert.`, monthKey);
    return true;
  }
  function repairMissingDebtPaymentFromPost(post, monthKey, reduceOpenBalance) {
    const debt = getLinkedDebtForPost(post);
    if (!debt || !isMonthKey(monthKey) || !isPostPaidForMonth(post, monthKey)) return false;
    ensureDebtConfig(debt);
    ensurePostConfig(post);
    const sourceLabel = `Verknüpfter Posten: ${post.name || 'Posten'}`;
    const alreadyRecorded = (debt.paymentHistory || []).some((entry) => entry && entry.month === monthKey
      && ((post.id && entry.sourcePostId === post.id) || (!entry.sourcePostId && entry.source === sourceLabel)));
    if (alreadyRecorded) return false;
    const amount = Number(getEffectiveAmountForMonth(post, monthKey) || 0);
    if (!(amount > 0)) return false;
    return addDebtPayment(debt, {
      month: monthKey,
      amount,
      source: sourceLabel,
      sourcePostId: post.id || '',
      note: reduceOpenBalance === false
        ? 'Nachtrag: Zahlung war im gespeicherten Restschuldstand bereits berücksichtigt.'
        : 'Nachtrag aus bereits bezahltem, verknüpftem Kostenposten.',
      markAsMonthly: true,
      allowExistingMonthlyStatus: true,
      reducedOpenBalance: reduceOpenBalance !== false,
      skipAccountTransaction: true
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
    taxRefunds: [],
    groceryExpenses: [],
    commonAccount: {
      currentBalance: 0,
      manualBound: 0,
      note: '',
      contributionOverrides: {},
      contributionsPaid: {},
      contributionPayments: {},
      interestEntries: []
    },
    accounts: [],
    accountTransfers: [],
    accountTransferTemplates: [],
    monthlyClosings: {},
    changeLog: [],
    debts: [],
    pots: [],
    savingsGoals: [],
    // Liste der Monate, in denen die Rücklagen/Spar‑Beträge bereits
    // zurückgelegt wurden. Wird zum Markieren in der Tabelle
    // „Rücklagen & Sparen“ verwendet.
    reservesSavedMonths: [],
    reserveItemSaved: {},
    tankCalc: {
      apiKey: '',
      radiusKm: 5,
      locationQuery: '',
      locationLat: '',
      locationLng: '',
      locationName: '',
      lastRequestAt: '',
      lastApiStatus: '',
      lastApiError: '',
      receipts: [],
      closedMonths: [],
      benny: { kmPerMonth: 0, consumption: 5.5, fuelType: 'diesel', avgPrice: '', autoPrice: '', stationName: '', lastFetch: '', monthlyEntries: [] },
      madeleine: { kmPerMonth: 0, consumption: 7.0, fuelType: 'e5', avgPrice: '', autoPrice: '', stationName: '', lastFetch: '', monthlyEntries: [] }
    },
    budgetTopUps: {
      fuel: { name: 'Tankgeld', startMonth: '2026-07', balances: {}, notes: {} },
      groceries: { name: 'Einkaufsgeld', startMonth: '2026-07', balances: {}, notes: {}, targetAmount: 550, targetStartMonth: '2026-06' }
    },
    appMeta: {
      selectedMonth: '',
      lastAutoMonthCheck: '',
      lastPreparedMonth: '',
      includeApiKeyInBackup: true,
      lastAutomaticBrowserBackupAt: '',
      externalBackupFolderName: '',
      lastExternalBackupAt: '',
      lastBatchPayment: null
    }
  };
  let state;
  let stateLoadFailed = false;
  let stateLoadError = '';
  let pendingBackupImportNotice = null;
  const STATE_STORAGE_KEY = 'budgetStateStable';
  const CURRENT_VERSION_STORAGE_KEY = `budgetStateV${APP_VERSION_STORAGE_SUFFIX}`;
  const DEFAULT_TRANSACTION_MONTH = dateToMonthKey(new Date());
  const DEFAULT_SHARED_ACCOUNT_ID = 'account_shared_main';
  const AUTOMATIC_BROWSER_BACKUP_DB_NAME = 'haushaltsplanerAutomaticBackups';
  const AUTOMATIC_BROWSER_BACKUP_STORE_NAME = 'snapshots';
  const AUTOMATIC_BROWSER_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const AUTOMATIC_BROWSER_BACKUP_RETENTION = 30;
  let automaticBrowserBackupDbPromise = null;
  let automaticBrowserBackupQueued = false;
  let automaticBrowserBackupInitialized = false;
  const savingsConfig = {
    minFree: 200,
    reservesRatio: 0.7,
    savingsRatio: 0.3,
    startMonth: '2026-05',
    reservePotShares: {
      'Auto': 0.35,
      'Urlaub': 0.15,
      'Anschaffungen (inkl. Wohnen)': 0.25,
      'Kleidung': 0.15,
      'Freizeit': 0.10
    }
  };
  const snowballConfig = {
    shortTermSkipMonths: 6,
    extraInvestTrigger: 400,
    keepFreeBuffer: 300
  };

  function sanitizeStateTextValues(value, seen = new WeakSet()) {
    if (typeof value === 'string') {
      return value
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/</g, '‹')
        .replace(/>/g, '›');
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        value[index] = sanitizeStateTextValues(entry, seen);
      });
      return value;
    }
    Object.keys(value).forEach((key) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        delete value[key];
        return;
      }
      value[key] = sanitizeStateTextValues(value[key], seen);
    });
    return value;
  }

  function getStateStorageFallbackKeys() {
    return [
      'budgetStateAutoBackup', CURRENT_VERSION_STORAGE_KEY, 'budgetStateV225', 'budgetStateV224', 'budgetStateV223', 'budgetStateV222', 'budgetStateV221', 'budgetStateV220', 'budgetStateV219', 'budgetStateV218', 'budgetStateV217', 'budgetStateV216', 'budgetStateV215', 'budgetStateV214', 'budgetStateV213', 'budgetStateV212',
      'budgetStateV211','budgetStateV210','budgetStateV209','budgetStateV208','budgetStateV207','budgetStateV206','budgetStateV205','budgetStateV204','budgetStateV203','budgetStateV202','budgetStateV201','budgetStateV200','budgetStateV199','budgetStateV198','budgetStateV197','budgetStateV196','budgetStateV195','budgetStateV194','budgetStateV193','budgetStateV192','budgetStateV191','budgetStateV190','budgetStateV189','budgetStateV188','budgetStateV187','budgetStateV186','budgetStateV185','budgetStateV184','budgetStateV183','budgetStateV182','budgetStateV181','budgetStateV180','budgetStateV179','budgetStateV178','budgetStateV177','budgetStateV176','budgetStateV175','budgetStateV174','budgetStateV173','budgetStateV172','budgetStateV171','budgetStateV170','budgetStateV169','budgetStateV168','budgetStateV167','budgetStateV166','budgetStateV165','budgetStateV164','budgetStateV163','budgetStateV162','budgetStateV161','budgetStateV160','budgetStateV159','budgetStateV158','budgetStateV156','budgetStateV155','budgetStateV153','budgetStateV152','budgetStateV151','budgetStateV150','budgetStateV149','budgetStateV148','budgetStateV146','budgetStateV145','budgetStateV144','budgetStateV143','budgetStateV142','budgetStateV140','budgetStateV139','budgetStateV136','budgetStateV135'
    ].filter((key, index, list) => key && list.indexOf(key) === index);
  }

  function cleanupLegacyStateStorageKeys() {
    const legacyKeys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && /^budgetStateV\d+$/.test(key) && key !== CURRENT_VERSION_STORAGE_KEY) {
        legacyKeys.push(key);
      }
    }
    legacyKeys.forEach((key) => localStorage.removeItem(key));
    return legacyKeys.length;
  }

  function writeStatePayloadToStorage(payload) {
    cleanupLegacyStateStorageKeys();
    const storageKeys = [STATE_STORAGE_KEY, 'budgetStateAutoBackup', CURRENT_VERSION_STORAGE_KEY];
    const previousValues = {};
    storageKeys.forEach((key) => {
      previousValues[key] = localStorage.getItem(key);
    });
    try {
      storageKeys.forEach((key) => {
        localStorage.setItem(key, payload);
      });
    } catch (err) {
      storageKeys.forEach((key) => {
        try {
          if (previousValues[key] === null) localStorage.removeItem(key);
          else localStorage.setItem(key, previousValues[key]);
        } catch (rollbackErr) {
          console.warn('Speicher-Rücksetzung fehlgeschlagen', key, rollbackErr);
        }
      });
      throw err;
    }
  }

  try {
  // Ab 1.96 ist Stable die verbindliche Quelle. Alte Versions-Keys werden nur
  // einmalig zur Rettung genutzt, wenn noch kein gueltiger Stable-State existiert.
  const fallback = getStateStorageFallbackKeys();
  const scoreStatePayload = (obj) => {
    if (!obj || typeof obj !== 'object') return -1;
    return (Array.isArray(obj.commonCosts) ? obj.commonCosts.length * 5 : 0)
      + (Array.isArray(obj.personalCosts) ? obj.personalCosts.length * 5 : 0)
      + (Array.isArray(obj.debts) ? obj.debts.length * 8 : 0)
      + (Array.isArray(obj.accounts) ? obj.accounts.length * 4 : 0)
      + (Array.isArray(obj.taxRefunds) ? obj.taxRefunds.length * 4 : 0)
      + (Array.isArray(obj.groceryExpenses) ? obj.groceryExpenses.length * 2 : 0)
      + (Array.isArray(obj.changeLog) ? Math.min(obj.changeLog.length, 50) : 0)
      + (obj.appMeta && obj.appMeta.selectedMonth ? 2 : 0);
  };
  const readValidStoredState = (key) => {
    const data = localStorage.getItem(key);
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      return scoreStatePayload(parsed) >= 0 ? { data, parsed } : null;
    } catch (e) {
      console.warn('Ungültiger Speicherstand ignoriert', key, e);
      return null;
    }
  };
  let saved = '';
  const stableState = readValidStoredState(STATE_STORAGE_KEY);
  if (stableState) {
    saved = stableState.data;
  } else {
    let bestScore = -1;
    for (const key of fallback) {
      const candidate = readValidStoredState(key);
      if (!candidate) continue;
      const score = scoreStatePayload(candidate.parsed);
      if (score > bestScore) {
        bestScore = score;
        saved = candidate.data;
      }
    }
  }
  if (saved) {
    writeStatePayloadToStorage(saved);
  }
  state = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(defaultState));
    sanitizeStateTextValues(state);
    // Falls das neue Flag für Rücklagen‑Bestätigungen fehlt, initialisiere es
    if (!state.reservesSavedMonths) state.reservesSavedMonths = [];
    if (!state.tankCalc) {
      state.tankCalc = JSON.parse(JSON.stringify(defaultState.tankCalc));
    } else {
      if (typeof state.tankCalc.apiKey !== 'string') state.tankCalc.apiKey = '';
      state.tankCalc.apiKey = extractTankApiKey(state.tankCalc.apiKey);
      if (!state.tankCalc.radiusKm) state.tankCalc.radiusKm = 5;
      if (typeof state.tankCalc.locationQuery !== 'string') state.tankCalc.locationQuery = '';
      if (typeof state.tankCalc.locationLat !== 'string' && typeof state.tankCalc.locationLat !== 'number') state.tankCalc.locationLat = '';
      if (typeof state.tankCalc.locationLng !== 'string' && typeof state.tankCalc.locationLng !== 'number') state.tankCalc.locationLng = '';
      if (typeof state.tankCalc.locationName !== 'string') state.tankCalc.locationName = '';
      if (typeof state.tankCalc.lastRequestAt !== 'string') state.tankCalc.lastRequestAt = '';
      if (typeof state.tankCalc.lastApiStatus !== 'string') state.tankCalc.lastApiStatus = '';
      if (typeof state.tankCalc.lastApiError !== 'string') state.tankCalc.lastApiError = '';
      if (!Array.isArray(state.tankCalc.receipts)) state.tankCalc.receipts = [];
      if (!Array.isArray(state.tankCalc.closedMonths)) state.tankCalc.closedMonths = [];
      if (!state.tankCalc.benny) state.tankCalc.benny = JSON.parse(JSON.stringify(defaultState.tankCalc.benny));
      if (!state.tankCalc.madeleine) state.tankCalc.madeleine = JSON.parse(JSON.stringify(defaultState.tankCalc.madeleine));
      if (!Array.isArray(state.tankCalc.benny.monthlyEntries)) state.tankCalc.benny.monthlyEntries = [];
      if (!Array.isArray(state.tankCalc.madeleine.monthlyEntries)) state.tankCalc.madeleine.monthlyEntries = [];
    }
    if (!Array.isArray(state.bufferExpenses)) state.bufferExpenses = [];
    if (!Array.isArray(state.taxRefunds)) state.taxRefunds = [];
    if (!Array.isArray(state.groceryExpenses)) state.groceryExpenses = [];
    normalizeAllTaxRefunds();
    normalizeGroceryExpenses();
    normalizeTankClosedMonths();
    normalizeBudgetTopUpsConfig();
    normalizeCommonAccountConfig();
    normalizeAccountsConfig();
    normalizeAccountTransfersConfig();
    normalizeAccountTransferTemplatesConfig();
    if (!state.monthlyClosings || typeof state.monthlyClosings !== 'object') state.monthlyClosings = {};
    if (!Array.isArray(state.changeLog)) state.changeLog = [];
    if (!state.appMeta || typeof state.appMeta !== 'object') state.appMeta = JSON.parse(JSON.stringify(defaultState.appMeta));
    migrateKreiskasseToBennyPersonal();
    migrateKreiskassePayrollPayment();
    if (!state.reserveItemSaved) state.reserveItemSaved = {};
    syncAllReserveSelectionsToPots();
    normalizeAllPersonConfigs();
    normalizeAllPostConfigs();
    ensureGroceryMoneyFromJune2026();
    normalizeAllDebtConfigs();
    autoLinkMatchingDebtPosts();
    migrateConfirmedMayDebtProofsV206();
    migrateCommonContributionPaymentsV221();
    migrateAccountLedgerV213();
    normalizeAppMeta();
    saveState();
  } catch (err) {
    stateLoadFailed = true;
    stateLoadError = err && err.message ? String(err.message) : String(err || 'Unbekannter Ladefehler');
    console.error('Gespeicherter Zustand konnte nicht geladen werden. Der bestehende Browser-Speicher bleibt unangetastet.', err);
    state = JSON.parse(JSON.stringify(defaultState));
  }

  function saveState() {
    try {
      sanitizeStateTextValues(state);
      const payload = JSON.stringify(state);
      writeStatePayloadToStorage(payload);
      const savedAt = new Date().toISOString();
      localStorage.setItem('budgetStateLastSavedAt', savedAt);
      updateSaveStatus(savedAt);
      if (automaticBrowserBackupInitialized) {
        queueAutomaticBrowserBackup();
      }
      if (state.appMeta && state.appMeta.externalBackupFolderName) {
        queueAutomaticExternalBackup();
      }
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
    if (!state.appMeta || typeof state.appMeta !== 'object') {
      state.appMeta = {
        selectedMonth: '',
        lastAutoMonthCheck: '',
        lastPreparedMonth: '',
        includeApiKeyInBackup: true,
        lastAutomaticBrowserBackupAt: '',
        externalBackupFolderName: '',
        lastExternalBackupAt: '',
        lastBatchPayment: null
      };
    }
    if (!isMonthKey(state.appMeta.selectedMonth)) state.appMeta.selectedMonth = '';
    if (!isMonthKey(state.appMeta.lastAutoMonthCheck)) state.appMeta.lastAutoMonthCheck = '';
    if (!isMonthKey(state.appMeta.lastPreparedMonth)) state.appMeta.lastPreparedMonth = '';
    if (typeof state.appMeta.lastAutomaticBrowserBackupAt !== 'string') state.appMeta.lastAutomaticBrowserBackupAt = '';
    if (typeof state.appMeta.externalBackupFolderName !== 'string') state.appMeta.externalBackupFolderName = '';
    if (typeof state.appMeta.lastExternalBackupAt !== 'string') state.appMeta.lastExternalBackupAt = '';
    if (!state.appMeta.lastBatchPayment || typeof state.appMeta.lastBatchPayment !== 'object') {
      state.appMeta.lastBatchPayment = null;
    } else {
      const batch = state.appMeta.lastBatchPayment;
      if (!isMonthKey(batch.month) || !Array.isArray(batch.items)) state.appMeta.lastBatchPayment = null;
    }
    // Ab 1.29 wird nur noch ein Backup erstellt und der Tank-API-Key ist immer enthalten.
    state.appMeta.includeApiKeyInBackup = true;
  }

  function normalizeBudgetTopUpsConfig() {
    if (!state.budgetTopUps || typeof state.budgetTopUps !== 'object') state.budgetTopUps = {};
    const defaults = {
      fuel: { name: 'Tankgeld', startMonth: '2026-07' },
      groceries: { name: 'Einkaufsgeld', startMonth: '2026-07', targetAmount: 550, targetStartMonth: '2026-06' }
    };
    Object.entries(defaults).forEach(([key, cfg]) => {
      const entry = state.budgetTopUps[key] && typeof state.budgetTopUps[key] === 'object' ? state.budgetTopUps[key] : {};
      entry.name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : cfg.name;
      entry.startMonth = isMonthKey(entry.startMonth) ? entry.startMonth : cfg.startMonth;
      if (key === 'groceries') {
        entry.targetAmount = Number.isFinite(Number(entry.targetAmount)) && Number(entry.targetAmount) > 0 ? Number(entry.targetAmount) : Number(cfg.targetAmount || 550);
        entry.targetStartMonth = isMonthKey(entry.targetStartMonth) ? entry.targetStartMonth : (cfg.targetStartMonth || '2026-06');
      }
      if (!entry.balances || typeof entry.balances !== 'object' || Array.isArray(entry.balances)) entry.balances = {};
      if (!entry.notes || typeof entry.notes !== 'object' || Array.isArray(entry.notes)) entry.notes = {};
      Object.keys(entry.balances).forEach((month) => {
        if (!isMonthKey(month)) delete entry.balances[month];
        else entry.balances[month] = Math.max(0, Number(entry.balances[month] || 0));
      });
      Object.keys(entry.notes).forEach((month) => {
        if (!isMonthKey(month)) delete entry.notes[month];
        else entry.notes[month] = String(entry.notes[month] || '');
      });
      state.budgetTopUps[key] = entry;
    });
  }

  function getBudgetTopUpConfig(type) {
    normalizeBudgetTopUpsConfig();
    return state.budgetTopUps[type];
  }

  function getBudgetTopUpBalance(type, monthKey) {
    const cfg = getBudgetTopUpConfig(type);
    return Math.max(0, Number(cfg && cfg.balances && cfg.balances[monthKey] || 0));
  }

  function setBudgetTopUpBalance(type, monthKey, amount, note = '') {
    const cfg = getBudgetTopUpConfig(type);
    if (!isMonthKey(monthKey)) return;
    cfg.balances[monthKey] = Math.max(0, Number(amount || 0));
    cfg.notes[monthKey] = String(note || '');
  }

  function isBudgetTopUpActive(type, monthKey) {
    const cfg = getBudgetTopUpConfig(type);
    return isMonthKey(monthKey) && monthDiff(cfg.startMonth, monthKey) >= 0;
  }


  // ----- Kontenverwaltung -----

  function normalizeAccountType(value) {
    const raw = String(value || '').toLowerCase();
    if (['shared', 'gemeinschaft', 'gemeinschaftskonto', 'common'].includes(raw)) return 'shared';
    if (['checking', 'giro', 'girokonto', 'main'].includes(raw)) return 'checking';
    if (['daily', 'tagesgeld', 'savings'].includes(raw)) return 'daily';
    if (['cash', 'bar'].includes(raw)) return 'cash';
    return 'other';
  }

  function getAccountTypeLabel(type) {
    const normalized = normalizeAccountType(type);
    if (normalized === 'shared') return 'Gemeinschaftskonto';
    if (normalized === 'checking') return 'Girokonto';
    if (normalized === 'daily') return 'Tagesgeld';
    if (normalized === 'cash') return 'Bargeld';
    return 'Sonstiges Konto';
  }

  function normalizeAccountOwner(value) {
    const raw = String(value || '').toLowerCase();
    if (raw.includes('madeleine')) return 'madeleine';
    if (raw.includes('benny')) return 'benny';
    if (raw.includes('gemeinsam') || raw.includes('beide')) return 'shared';
    return raw || 'shared';
  }

  function getAccountOwnerLabel(owner) {
    const normalized = normalizeAccountOwner(owner);
    if (normalized === 'benny') return 'Benny';
    if (normalized === 'madeleine') return 'Madeleine';
    if (normalized === 'shared') return 'Gemeinsam';
    return owner || '—';
  }

  function ensureAccountLinkField(item) {
    if (!item || typeof item !== 'object') return;
    if (typeof item.accountId !== 'string') item.accountId = '';
  }

  function getSharedAccount() {
    normalizeAccountsConfig(false);
    return (state.accounts || []).find((a) => a.id === DEFAULT_SHARED_ACCOUNT_ID)
      || (state.accounts || []).find((a) => normalizeAccountType(a.type) === 'shared')
      || null;
  }

  function syncCommonAccountBalanceToSharedAccount() {
    if (!state || !Array.isArray(state.accounts)) return;
    const shared = (state.accounts || []).find((a) => a.id === DEFAULT_SHARED_ACCOUNT_ID)
      || (state.accounts || []).find((a) => normalizeAccountType(a.type) === 'shared');
    if (!shared) return;
    shared.balance = Number(state.commonAccount && state.commonAccount.currentBalance || 0);
    shared.bound = Number(state.commonAccount && state.commonAccount.manualBound || 0);
    shared.note = state.commonAccount && state.commonAccount.note ? state.commonAccount.note : shared.note || '';
  }

  function normalizeAccountsConfig(forceDefaults = true) {
    if (!state) return;
    if (!Array.isArray(state.accounts)) state.accounts = [];
    if (!ACCOUNTS_ENABLED) {
      normalizeCommonAccountConfig();
      state.accounts = state.accounts.filter((acc) => acc && typeof acc === 'object');
      return;
    }
    normalizeCommonAccountConfig();
    state.accounts = state.accounts
      .filter((acc) => acc && typeof acc === 'object')
      .map((acc) => {
        const id = typeof acc.id === 'string' && acc.id ? acc.id : generateId();
        const type = normalizeAccountType(acc.type);
        return {
          id,
          name: typeof acc.name === 'string' && acc.name.trim() ? acc.name.trim() : (type === 'shared' ? 'Gemeinschaftskonto' : 'Konto'),
          type,
          owner: normalizeAccountOwner(acc.owner || (type === 'shared' ? 'shared' : '')),
          balance: Number.isFinite(Number(acc.balance)) ? Number(acc.balance) : 0,
          bound: Math.max(0, Number.isFinite(Number(acc.bound)) ? Number(acc.bound) : 0),
          purpose: typeof acc.purpose === 'string' ? acc.purpose : '',
          interestEnabled: acc.interestEnabled === true,
          note: typeof acc.note === 'string' ? acc.note : '',
          lastReconciledAt: typeof acc.lastReconciledAt === 'string' ? acc.lastReconciledAt : '',
          lastReconciledBalance: Number.isFinite(Number(acc.lastReconciledBalance)) ? Number(acc.lastReconciledBalance) : null,
          lastReconciledNote: typeof acc.lastReconciledNote === 'string' ? acc.lastReconciledNote : '',
          transactions: Array.isArray(acc.transactions) ? acc.transactions.filter((tx) => tx && typeof tx === 'object').map((tx) => ({
            id: typeof tx.id === 'string' && tx.id ? tx.id : generateId(),
            month: isMonthKey(tx.month) ? tx.month : DEFAULT_TRANSACTION_MONTH,
            date: typeof tx.date === 'string' ? tx.date : '',
            type: typeof tx.type === 'string' ? tx.type : 'manual',
            sourceId: typeof tx.sourceId === 'string' ? tx.sourceId : '',
            label: typeof tx.label === 'string' ? tx.label : 'Buchung',
            amount: Number.isFinite(Number(tx.amount)) ? Number(tx.amount) : 0,
            affectsBalance: tx.affectsBalance === true,
            balanceMode: tx.affectsBalance === true ? 'bank' : (typeof tx.balanceMode === 'string' ? tx.balanceMode : 'proof'),
            transferId: typeof tx.transferId === 'string' ? tx.transferId : '',
            note: typeof tx.note === 'string' ? tx.note : '',
            createdAt: typeof tx.createdAt === 'string' ? tx.createdAt : ''
          })) : []
        };
      });

    let shared = state.accounts.find((acc) => acc.id === DEFAULT_SHARED_ACCOUNT_ID)
      || state.accounts.find((acc) => normalizeAccountType(acc.type) === 'shared')
      || state.accounts.find((acc) => String(acc.name || '').toLowerCase().includes('gemeinschaft'));

    if (!shared && forceDefaults !== false) {
      shared = {
        id: DEFAULT_SHARED_ACCOUNT_ID,
        name: 'Gemeinschaftskonto',
        type: 'shared',
        owner: 'shared',
        balance: Number(state.commonAccount.currentBalance || 0),
        bound: Number(state.commonAccount.manualBound || 0),
        purpose: 'Gemeinsame Kosten und Steuererstattung',
        interestEnabled: true,
        note: state.commonAccount.note || 'Alle gemeinsamen Kosten gehen von diesem Konto ab; die Steuererstattung liegt ebenfalls hier.'
      };
      state.accounts.unshift(shared);
    }

    if (shared) {
      shared.id = DEFAULT_SHARED_ACCOUNT_ID;
      shared.name = shared.name || 'Gemeinschaftskonto';
      shared.type = 'shared';
      shared.owner = 'shared';
      if (!shared.purpose) shared.purpose = 'Gemeinsame Kosten und Steuererstattung';
      state.commonAccount.accountId = shared.id;
      // Der alte Gemeinschaftskonto-Bereich bleibt kompatibel, nutzt aber jetzt das Konto als Quelle.
      state.commonAccount.currentBalance = Number(shared.balance || 0);
      state.commonAccount.manualBound = Number(shared.bound || 0);
      if (shared.note && !state.commonAccount.note) state.commonAccount.note = shared.note;
    }

    const sharedId = shared ? shared.id : '';
    if (sharedId) {
      // Eure Regel: Alle gemeinsamen Kosten laufen über das Gemeinschaftskonto.
      (state.commonCosts || []).forEach((post) => {
        ensureAccountLinkField(post);
        post.accountId = sharedId;
      });
      // Die Steuererstattung liegt ebenfalls auf dem Gemeinschaftskonto und wird dort als gebunden betrachtet.
      (state.taxRefunds || []).forEach((refund) => {
        if (refund && typeof refund === 'object') refund.accountId = sharedId;
      });
    }
  }

  function getAccountById(accountId) {
    normalizeAccountsConfig(false);
    return (state.accounts || []).find((acc) => acc.id === accountId) || null;
  }

  function getAccountName(accountId) {
    if (!ACCOUNTS_ENABLED) return 'nicht verwendet';
    if (!accountId) return 'nicht zugeordnet';
    const acc = getAccountById(accountId);
    return acc ? acc.name : 'unbekanntes Konto';
  }

  function getDefaultAccountIdForContext(context, personId = '') {
    normalizeAccountsConfig(false);
    const accounts = state.accounts || [];
    if (context === 'common' || context === 'taxrefund') {
      const shared = accounts.find((acc) => acc.id === DEFAULT_SHARED_ACCOUNT_ID) || accounts.find((acc) => normalizeAccountType(acc.type) === 'shared');
      return shared ? shared.id : '';
    }
    const person = (state.persons || []).find((item) => item.id === personId);
    const owner = normalizeAccountOwner(person ? person.name : personId);
    const ownedChecking = accounts.find((acc) => normalizeAccountOwner(acc.owner) === owner && normalizeAccountType(acc.type) === 'checking');
    if (ownedChecking) return ownedChecking.id;
    const ownedAny = accounts.find((acc) => normalizeAccountOwner(acc.owner) === owner);
    return ownedAny ? ownedAny.id : '';
  }

  function createAccountSelect(value = '', options = {}) {
    if (!ACCOUNTS_ENABLED) {
      const select = document.createElement('select');
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'Konten deaktiviert';
      select.appendChild(none);
      select.value = '';
      select.disabled = true;
      return select;
    }
    normalizeAccountsConfig(false);
    const select = document.createElement('select');
    if (options.includeNone !== false) {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'nicht zugeordnet';
      select.appendChild(none);
    }
    (state.accounts || []).forEach((acc) => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = `${acc.name} · ${getAccountTypeLabel(acc.type)}`;
      select.appendChild(opt);
    });
    select.value = value || '';
    return select;
  }

  function appendTransferBookingFields(content, refs, editPost) {
    if (!ACCOUNTS_ENABLED) {
      if (refs) {
        refs.bookingTypeSelect = null;
        refs.transferToAccountSelect = null;
      }
      return;
    }
    const row = document.createElement('div');
    row.className = 'row transfer-booking-row';
    refs.bookingTypeSelect = document.createElement('select');
    refs.bookingTypeSelect.innerHTML = '<option value="expense">Normale Zahlung / Ausgabe</option><option value="transfer">Umbuchung zwischen Konten</option>';
    refs.bookingTypeSelect.value = editPost && editPost.bookingType === 'transfer' ? 'transfer' : 'expense';
    refs.transferToAccountSelect = createAccountSelect(editPost && editPost.transferToAccountId ? editPost.transferToAccountId : '', { includeNone: true });
    row.appendChild(createLabelInput('Buchungsart', refs.bookingTypeSelect));
    row.appendChild(createLabelInput('Zielkonto bei Umbuchung', refs.transferToAccountSelect));
    content.appendChild(row);
    const hint = document.createElement('p');
    hint.className = 'small muted transfer-booking-hint';
    hint.textContent = 'Bei „Umbuchung“ wird beim Bezahlt-Markieren keine Ausgabe gebucht, sondern Geld vom Zahlungskonto auf das Zielkonto verschoben.';
    content.appendChild(hint);
    const sync = () => {
      refs.transferToAccountSelect.disabled = refs.bookingTypeSelect.value !== 'transfer';
      hint.style.display = refs.bookingTypeSelect.value === 'transfer' ? '' : 'none';
    };
    refs.bookingTypeSelect.addEventListener('change', sync);
    sync();
  }

  function applyTransferBookingFieldsToPost(post, refs) {
    if (!post) return true;
    if (!ACCOUNTS_ENABLED || !refs || !refs.bookingTypeSelect) {
      post.bookingType = 'expense';
      post.transferToAccountId = '';
      return true;
    }
    post.bookingType = refs.bookingTypeSelect.value === 'transfer' ? 'transfer' : 'expense';
    post.transferToAccountId = refs.transferToAccountSelect ? (refs.transferToAccountSelect.value || '') : '';
    if (post.bookingType === 'transfer') {
      if (!post.accountId) { alert('Für eine Umbuchung muss ein Zahlungskonto/Von-Konto ausgewählt sein.'); return false; }
      if (!post.transferToAccountId) { alert('Für eine Umbuchung muss ein Zielkonto ausgewählt sein.'); return false; }
      if (post.accountId === post.transferToAccountId) { alert('Bei einer Umbuchung müssen Zahlungskonto und Zielkonto unterschiedlich sein.'); return false; }
    }
    return true;
  }

  function getAssignedOpenPaymentsForAccount(accountId, monthKey = currentMonth) {
    const rows = [];
    if (!accountId || !isMonthKey(monthKey)) return rows;
    const addPostRows = (items, group) => {
      (items || []).forEach((post) => {
        ensurePostConfig(post);
        if (post.accountId !== accountId) return;
        const due = isDue(post, monthKey);
        const paid = isPostPaidForMonth(post, monthKey);
        if (!due || paid) return;
        rows.push({ group, name: post.name || 'Posten', amount: Number(getEffectiveAmountForMonth(post, monthKey) || 0) });
      });
    };
    addPostRows(state.commonCosts, 'Gemeinsame Kosten');
    addPostRows(state.personalCosts, 'Persönliche Ausgaben');
    addPostRows(state.bufferExpenses, 'Sonstige Ausgaben');
    const linkedDebtIds = new Set([...(state.commonCosts || []), ...(state.personalCosts || []), ...(state.bufferExpenses || [])].map((p) => p && p.linkedDebtId).filter(Boolean));
    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      if (debt.accountId !== accountId || linkedDebtIds.has(debt.id)) return;
      const open = getDebtOpenAmountForMonth(debt, monthKey);
      if (open > 0.005) rows.push({ group: 'Schulden', name: debt.name || 'Schuld', amount: open });
    });
    return rows;
  }

  function getPaidButUnbookedRowsForAccount(accountId, monthKey = currentMonth) {
    const rows = [];
    if (!accountId || !isMonthKey(monthKey)) return rows;
    const addPaidPosts = (items, group) => {
      (items || []).forEach((post) => {
        ensurePostConfig(post);
        const resolvedAccountId = post.accountId || inferAccountIdForPost(post);
        if (resolvedAccountId !== accountId) return;
        if (!isDue(post, monthKey) || !isPostPaidForMonth(post, monthKey)) return;
        const sourceId = getPostAccountTransactionSource(post, monthKey);
        const isBooked = isPostBookedForMonth(post, monthKey);
        if (isBooked) return;
        const balanceDebited = !!getPostAccountBalanceDebit(post, monthKey);
        rows.push({ group, name: post.name || 'Posten', amount: Number(getEffectiveAmountForMonth(post, monthKey) || 0), sourceId, postId: post.id || '', accountId: resolvedAccountId, balanceDebited });
      });
    };
    addPaidPosts(state.commonCosts, 'Gemeinsame Kosten');
    addPaidPosts(state.personalCosts, 'Persönliche Ausgaben');
    addPaidPosts(state.bufferExpenses, 'Sonstige Ausgaben');
    if (accountId === DEFAULT_SHARED_ACCOUNT_ID) {
      (state.taxRefunds || []).forEach((refund) => {
        const refundAccountId = refund.accountId || DEFAULT_SHARED_ACCOUNT_ID;
        if (refundAccountId !== accountId) return;
        (refund.purchases || []).forEach((purchase) => {
          const sourceId = `taxrefund-purchase:${refund.id}:${purchase.id}`;
          const isBooked = !!findAccountTransactionBySource(sourceId);
          if (isBooked) return;
          rows.push({ group: 'Steuererstattung', name: purchase.name || 'Ausgabe aus Steuererstattung', amount: Number(purchase.amount || 0), sourceId });
        });
      });
    }
    return rows.filter((row) => Number(row.amount || 0) > 0.005);
  }


  function getAccountAvailability(account, monthKey = currentMonth) {
    const openRows = getAssignedOpenPaymentsForAccount(account && account.id, monthKey);
    const paidUnbookedRows = getPaidButUnbookedRowsForAccount(account && account.id, monthKey);
    const balance = Number(account && account.balance || 0);
    const manualBound = Math.max(0, Number(account && account.bound || 0));
    const taxRefundBound = account && account.id === DEFAULT_SHARED_ACCOUNT_ID ? getTaxRefundRemainingTotal() : 0;
    const intervalReserve = account && account.id === DEFAULT_SHARED_ACCOUNT_ID ? getCommonAccountIntervalReserve(monthKey) : { total: 0 };
    const intervalReserveBound = Math.max(0, Number(intervalReserve && intervalReserve.total || 0));
    const savingsGoalBound = getSavingsGoalBoundForAccount(account && account.id);
    const bound = manualBound + taxRefundBound + intervalReserveBound + savingsGoalBound;
    const open = openRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const paidUnbooked = paidUnbookedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    // Bezahlte, aber nicht gebuchte Posten sind ein Hinweis auf fehlende Historie.
    // Der Kontoabzug kann bereits direkt beim Bezahlt-Status ausgefuehrt worden sein.
    const after = balance - bound - open;
    return {
      balance,
      bound,
      manualBound,
      taxRefundBound,
      intervalReserveBound,
      savingsGoalBound,
      open,
      paidUnbooked,
      after,
      available: Math.max(after, 0),
      missing: Math.max(-after, 0),
      rows: openRows,
      paidUnbookedRows
    };
  }

  function renderAccountAvailabilityCard(account) {
    const data = getAccountAvailability(account, currentMonth);
    const reserved = data.bound + data.open;
    const card = document.createElement('div');
    card.className = `account-card account-availability-card ${data.missing > 0.005 ? 'needs-money' : 'ok'}`;
    const top = document.createElement('div');
    top.className = 'account-card-head';
    const titleWrap = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = account.name || 'Konto';
    const meta = document.createElement('div');
    meta.className = 'small muted';
    meta.textContent = `${getAccountTypeLabel(account.type)} · ${getAccountOwnerLabel(account.owner)}`;
    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);
    const status = document.createElement('span');
    status.className = `pill ${data.missing > 0.005 ? 'danger' : 'success'}`;
    status.textContent = data.missing > 0.005 ? `Fehlt ${euro(data.missing)}` : `Verfügbar ${euro(data.available)}`;
    top.appendChild(titleWrap);
    top.appendChild(status);
    card.appendChild(top);
    card.appendChild(createSummaryMetrics([
      { label: 'Bankstand', value: euro(data.balance) },
      { label: 'Reserviert/offen', value: euro(reserved), kind: reserved > 0.005 ? 'warning' : 'success', hint: `Gebunden ${euro(data.bound)} · offen ${euro(data.open)}` },
      { label: data.missing > 0.005 ? 'Fehlt' : 'Verfügbar', value: euro(data.missing > 0.005 ? data.missing : data.available), kind: data.missing > 0.005 ? 'danger' : 'success', hint: 'Nach Reservierungen und offenen Zahlungen.' }
    ]));
    const actions = document.createElement('div');
    actions.className = 'account-card-actions';
    const addAction = (label, className, onClick, disabled = false) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = className;
      btn.textContent = label;
      btn.disabled = disabled;
      btn.addEventListener('click', onClick);
      actions.appendChild(btn);
    };
    addAction('Abgleichen', 'primary small-action', () => showAccountReconcileEditor(account));
    addAction('Buchungen', 'secondary small-action', () => showAccountTransactions(account));
    addAction('Bearbeiten', 'secondary small-action', () => showAccountEditor(account));
    if (data.rows.length) {
      addAction('Offene Posten', 'secondary small-action', () => showAccountOpenItems(account, data.rows));
    }
    card.appendChild(actions);
    if (account.lastReconciledAt) {
      const rec = document.createElement('p');
      rec.className = 'small muted account-reconcile-note';
      const d = new Date(account.lastReconciledAt);
      const when = Number.isNaN(d.getTime()) ? account.lastReconciledAt : d.toLocaleDateString('de-DE');
      rec.textContent = `Zuletzt abgeglichen: ${when}${account.lastReconciledBalance !== null && account.lastReconciledBalance !== undefined ? ' · ' + euro(account.lastReconciledBalance) : ''}`;
      card.appendChild(rec);
    }
    const reserveLines = [];
    if (data.manualBound > 0.005) reserveLines.push({ label: 'Manuell gebunden', amount: data.manualBound });
    if (data.taxRefundBound > 0.005) reserveLines.push({ label: 'Steuererstattung gebunden', amount: data.taxRefundBound });
    if (data.intervalReserveBound > 0.005) reserveLines.push({ label: 'Intervall-Rücklage', amount: data.intervalReserveBound });
    if (data.savingsGoalBound > 0.005) reserveLines.push({ label: 'Rücklagen-Posten', amount: data.savingsGoalBound });
    if (data.open > 0.005) reserveLines.push({ label: `Offene Zahlungen (${data.rows.length})`, amount: data.open });
    if (data.paidUnbooked > 0.005) reserveLines.push({ label: 'Nur Status, ohne Historie', amount: data.paidUnbooked });
    if (reserveLines.length) {
      const reserveDetails = document.createElement('details');
      reserveDetails.className = 'compact-details account-quick-details';
      const reserveSummary = document.createElement('summary');
      reserveSummary.textContent = 'Reservierung aufschlüsseln';
      reserveDetails.appendChild(reserveSummary);
      const reserveList = document.createElement('div');
      reserveList.className = 'mini-list';
      reserveLines.forEach((lineData) => {
        const line = document.createElement('div');
        line.className = 'mini-list-row';
        line.innerHTML = `<span><strong>${lineData.label}</strong></span><b>${euro(lineData.amount)}</b>`;
        reserveList.appendChild(line);
      });
      reserveDetails.appendChild(reserveList);
      card.appendChild(reserveDetails);
    } else {
      const ok = document.createElement('p');
      ok.className = 'small muted account-simple-note';
      ok.textContent = 'Keine offenen oder gebundenen Beträge auf diesem Konto.';
      card.appendChild(ok);
    }
    if (data.rows.length) {
      const details = document.createElement('details');
      details.className = 'compact-details account-open-details';
      const summary = document.createElement('summary');
      summary.textContent = `${data.rows.length} offene Posten anzeigen`;
      details.appendChild(summary);
      const list = document.createElement('div');
      list.className = 'mini-list';
      data.rows.slice(0, 6).forEach((row) => {
        const line = document.createElement('div');
        line.className = 'mini-list-row';
        line.innerHTML = `<span><strong>${row.name}</strong><small>${row.group}</small></span><b>${euro(row.amount)}</b>`;
        list.appendChild(line);
      });
      if (data.rows.length > 6) {
        const more = document.createElement('div');
        more.className = 'small muted';
        more.textContent = `+ ${data.rows.length - 6} weitere Posten`;
        list.appendChild(more);
      }
      details.appendChild(list);
      card.appendChild(details);
    } else {
      const ok = document.createElement('p');
      ok.className = 'small muted';
      ok.textContent = 'Für diesen Monat sind diesem Konto keine offenen Zahlungen zugeordnet.';
      card.appendChild(ok);
    }
    if (data.paidUnbookedRows && data.paidUnbookedRows.length) {
      const warn = document.createElement('details');
      warn.className = 'compact-details account-open-details';
      const summary = document.createElement('summary');
      summary.textContent = `${data.paidUnbookedRows.length} nur als bezahlt markierte Posten anzeigen`;
      warn.appendChild(summary);
      const list = document.createElement('div');
      list.className = 'mini-list';
      data.paidUnbookedRows.forEach((row) => {
        const line = document.createElement('div');
        line.className = 'mini-list-row warning-row';
        const note = row.balanceDebited
          ? 'Kontostand bereits abgezogen, keine Historienbuchung'
          : 'Status gesetzt, keine Historienbuchung gewünscht';
        line.innerHTML = `<span><strong>${row.name}</strong><small>${row.group} · ${note}</small></span><b>${euro(row.amount)}</b>`;
        list.appendChild(line);
      });
      warn.appendChild(list);
      card.appendChild(warn);
    }
    return card;
  }

  function renderAccountsManagementCard() {
    normalizeAccountsConfig();
    const card = document.createElement('div');
    card.className = 'card accounts-card';
    const header = document.createElement('div');
    header.className = 'row';
    const title = document.createElement('h2');
    title.textContent = 'Konten';
    title.style.flex = '1 1 auto';
    const transferBtn = document.createElement('button');
    transferBtn.className = 'secondary';
    transferBtn.textContent = 'Umbuchung';
    transferBtn.addEventListener('click', () => showAccountTransferEditor());
    const addBtn = document.createElement('button');
    addBtn.className = 'primary';
    addBtn.textContent = '+ Konto';
    addBtn.addEventListener('click', () => showAccountEditor());
    header.appendChild(title);
    header.appendChild(transferBtn);
    header.appendChild(addBtn);
    card.appendChild(header);

    const hint = document.createElement('p');
    hint.className = 'small muted account-simple-note';
    hint.textContent = 'Pflege hier nur echte Bankstände. Offene Zahlungen und gebundene Beträge senken nur die Verfügbarkeit, nicht automatisch den Bankstand.';
    card.appendChild(hint);

    normalizeAccountTransfersConfig();
    normalizeAccountTransferTemplatesConfig();
    const transferTools = document.createElement('details');
    transferTools.className = 'compact-details account-advanced-details';
    const transferToolsSummary = document.createElement('summary');
    transferToolsSummary.textContent = 'Umbuchungen und Vorlagen anzeigen';
    transferTools.appendChild(transferToolsSummary);
    const transferToolsContent = document.createElement('div');
    transferToolsContent.className = 'account-advanced-stack';
    const transferHint = document.createElement('p');
    transferHint.className = 'small muted';
    transferHint.textContent = 'Umbuchungen ändern immer beide Konten: beim Quellkonto runter, beim Zielkonto rauf. Hier findest du die gespeicherten Vorlagen und den Verlauf.';
    transferToolsContent.appendChild(transferHint);
    transferTools.appendChild(transferToolsContent);
    let hasTransferTools = false;
    if ((state.accountTransferTemplates || []).length) {
      const tplDetails = document.createElement('details');
      tplDetails.className = 'compact-details';
      const tplSummary = document.createElement('summary');
      tplSummary.textContent = 'Umbuchungsvorlagen anzeigen';
      tplDetails.appendChild(tplSummary);
      const tplTable = document.createElement('table');
      tplTable.className = 'list-table compact-table';
      tplTable.innerHTML = '<thead><tr><th>Vorlage</th><th>Von</th><th>Nach</th><th>Betrag</th><th>Status</th><th></th></tr></thead>';
      const tplBody = document.createElement('tbody');
      (state.accountTransferTemplates || []).forEach((tpl) => {
        const tr = document.createElement('tr');
        const done = wasTemplateTransferredInMonth(tpl.id, currentMonth);
        tr.innerHTML = `<td>${tpl.name}</td><td>${getAccountName(tpl.fromAccountId)}</td><td>${getAccountName(tpl.toAccountId)}</td><td>${euro(tpl.amount)}</td><td>${done ? '<span class="pill success">erledigt</span>' : '<span class="pill warning">offen</span>'}</td><td></td>`;
        const action = document.createElement('div');
        action.className = 'transfer-template-actions';
        const run = document.createElement('button');
        run.className = 'primary small-action';
        run.textContent = 'Ausführen';
        run.disabled = done;
        run.addEventListener('click', () => { if (addAccountTransferFromTemplate(tpl.id, currentMonth)) { saveState(); render(); } });
        const del = document.createElement('button');
        del.className = 'danger small-action';
        del.textContent = 'Löschen';
        del.addEventListener('click', () => { if (confirm('Umbuchungsvorlage löschen?') && deleteAccountTransferTemplate(tpl.id)) { saveState(); render(); } });
        action.appendChild(run);
        action.appendChild(del);
        tr.children[5].appendChild(action);
        tplBody.appendChild(tr);
      });
      tplTable.appendChild(tplBody);
      tplDetails.appendChild(tplTable);
      transferToolsContent.appendChild(tplDetails);
      hasTransferTools = true;
    }

    if ((state.accountTransfers || []).length) {
      const transferDetails = document.createElement('details');
      transferDetails.className = 'compact-details';
      const transferSummary = document.createElement('summary');
      transferSummary.textContent = 'Letzte Umbuchungen anzeigen';
      transferDetails.appendChild(transferSummary);
      const transferTable = document.createElement('table');
      transferTable.className = 'list-table compact-table';
      transferTable.innerHTML = '<thead><tr><th>Monat</th><th>Von</th><th>Nach</th><th>Betrag</th><th>Notiz</th><th></th></tr></thead>';
      const transferBody = document.createElement('tbody');
      (state.accountTransfers || []).slice().sort((a, b) => (b.month || '').localeCompare(a.month || '')).slice(0, 8).forEach((trf) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${formatMonthLabel(trf.month)}</td><td>${getAccountName(trf.fromAccountId)}</td><td>${getAccountName(trf.toAccountId)}</td><td>${euro(trf.amount)}</td><td>${trf.note || '-'}</td><td></td>`;
        const del = document.createElement('button');
        del.className = 'danger small-action';
        del.textContent = 'Rückgängig';
        del.addEventListener('click', () => { if (confirm('Umbuchung rückgängig machen?')) { deleteAccountTransfer(trf.id); saveState(); render(); } });
        tr.children[5].appendChild(del);
        transferBody.appendChild(tr);
      });
      transferTable.appendChild(transferBody);
      transferDetails.appendChild(transferTable);
      transferToolsContent.appendChild(transferDetails);
      hasTransferTools = true;
    }

    const accountStats = (state.accounts || []).map((account) => ({ account, data: getAccountAvailability(account, currentMonth) }));
    const totals = accountStats.reduce((acc, row) => {
      acc.balance += row.data.balance;
      acc.bound += row.data.bound;
      acc.open += row.data.open;
      acc.available += row.data.available;
      acc.missing += row.data.missing;
      return acc;
    }, { balance: 0, bound: 0, open: 0, available: 0, missing: 0 });
    card.appendChild(createSummaryMetrics([
      { label: 'Kontostand gesamt', value: euro(totals.balance) },
      { label: 'Reserviert/offen', value: euro(totals.bound + totals.open), kind: (totals.bound + totals.open) > 0 ? 'warning' : 'success', hint: `Gebunden ${euro(totals.bound)} · offen ${euro(totals.open)}` },
      { label: totals.missing > 0.005 ? 'Fehlt gesamt' : 'Verfügbar gesamt', value: euro(totals.missing > 0.005 ? totals.missing : totals.available), kind: totals.missing > 0.005 ? 'danger' : 'success', hint: totals.missing > 0.005 ? 'Bei mindestens einem Konto reicht der aktuelle Stand nicht.' : 'Nach gebundenen Beträgen und offenen Zahlungen.' }
    ]));

    const accountGrid = document.createElement('div');
    accountGrid.className = 'account-grid account-availability-grid';
    accountStats.forEach(({ account }) => accountGrid.appendChild(renderAccountAvailabilityCard(account)));
    card.appendChild(accountGrid);

    const dailyPlan = getCommonIntervalDailySavingsPlan(currentMonth);
    const dailyWrap = document.createElement('details');
    dailyWrap.className = 'compact-details account-advanced-details daily-savings-wrap';
    dailyWrap.open = dailyPlan.missing > 0.005 || (dailyPlan.target > 0.005 && !dailyPlan.accounts.length);
    const dailyWrapSummary = document.createElement('summary');
    const dailyStatus = dailyPlan.missing > 0.005
      ? `fehlt ${euro(dailyPlan.missing)}`
      : `Soll ${euro(dailyPlan.target)}`;
    dailyWrapSummary.textContent = `Tagesgeld-Soll anzeigen (${dailyStatus})`;
    dailyWrap.appendChild(dailyWrapSummary);
    const dailyBox = document.createElement('div');
    dailyBox.className = `sub-card daily-savings-plan ${dailyPlan.missing > 0.005 ? 'needs-money' : 'ok'}`;
    const dailyTitle = document.createElement('h3');
    dailyTitle.textContent = 'Tagesgeld-Soll für nicht-monatliche gemeinsame Kosten';
    dailyBox.appendChild(dailyTitle);
    const dailyHint = document.createElement('p');
    dailyHint.className = 'small muted';
    dailyHint.textContent = 'Zeigt, welcher Betrag rechnerisch auf dem Tagesgeldkonto liegen sollte. Bei jeder nicht-monatlichen Zahlung zählt der aktuelle Anspar-Zyklus bis einschließlich Fälligkeitsmonat; der letzte Anteil wird also im Fälligkeitsmonat mit dem gemeinsamen Monatsanteil eingeplant.';
    dailyBox.appendChild(dailyHint);
    const accountNames = dailyPlan.accounts.length
      ? dailyPlan.accounts.map((account) => account.name || 'Tagesgeld').join(' · ')
      : 'Kein Tagesgeldkonto angelegt';
    dailyBox.appendChild(createSummaryMetrics([
      { label: 'Soll auf Tagesgeld', value: euro(dailyPlan.target), kind: dailyPlan.target > 0.005 ? 'warning' : 'success', hint: accountNames },
      { label: 'Ist auf Tagesgeld', value: dailyPlan.accounts.length ? euro(dailyPlan.actualBalance) : '—', kind: dailyPlan.accounts.length ? 'success' : 'warning' },
      { label: dailyPlan.missing > 0.005 ? 'Fehlt auf Tagesgeld' : 'Über Soll', value: euro(dailyPlan.missing > 0.005 ? dailyPlan.missing : dailyPlan.surplus), kind: dailyPlan.missing > 0.005 ? 'danger' : 'success' },
      { label: 'Aktueller Monatsanteil', value: euro(dailyPlan.currentMonthShare), hint: 'Dieser Anteil steckt im Monatsanteil der gemeinsamen Kosten.' }
    ]));
    if (dailyPlan.target > 0.005 && !dailyPlan.accounts.length) {
      const dailyWarning = createUiEl('div', 'notice warning daily-plan-warning');
      dailyWarning.innerHTML = '<strong>Tagesgeldkonto fehlt.</strong><br><span class="small muted">Lege in den Konten ein Konto mit Typ „Tagesgeld“ an oder markiere ein vorhandenes Konto so. Dann kann die App den Sollstand direkt mit dem echten Tagesgeld-Kontostand vergleichen.</span>';
      dailyBox.appendChild(dailyWarning);
    }
    if (dailyPlan.rows.length) {
      const dailyDetails = document.createElement('details');
      dailyDetails.className = 'compact-details';
      const dailySummary = document.createElement('summary');
      dailySummary.textContent = 'Berechnung anzeigen';
      dailyDetails.appendChild(dailySummary);
      const dailyTable = document.createElement('table');
      dailyTable.className = 'list-table compact-table';
      dailyTable.innerHTML = '<thead><tr><th>Posten</th><th>Fälligkeit</th><th>Monatsanteil</th><th>Anteile im Soll</th><th>Soll</th><th>Hinweis</th></tr></thead>';
      const dailyBody = document.createElement('tbody');
      dailyPlan.rows.forEach((rowData) => {
        const tr = document.createElement('tr');
        const hintText = rowData.includesDueMonthShare
          ? 'Fälligkeitsmonat zählt als letzter Anteil'
          : 'angesparter Anteil bis zum ausgewählten Monat';
        tr.innerHTML = `<td>${rowData.item.name}</td><td>${formatMonthLabel(rowData.nextDue)}</td><td>${euro(rowData.monthlyPart)}</td><td>${rowData.monthsBuilt} von ${rowData.interval}</td><td>${euro(rowData.reserve)}</td><td>${hintText}</td>`;
        dailyBody.appendChild(tr);
      });
      dailyTable.appendChild(dailyBody);
      dailyDetails.appendChild(dailyTable);
      dailyBox.appendChild(dailyDetails);
    } else {
      const emptyDaily = document.createElement('p');
      emptyDaily.className = 'small muted';
      emptyDaily.textContent = 'Für den ausgewählten Monat gibt es keine aufzubauenden Anteile für nicht-monatliche gemeinsame Kosten.';
      dailyBox.appendChild(emptyDaily);
    }
    dailyWrap.appendChild(dailyBox);
    card.appendChild(dailyWrap);

    if (hasTransferTools) {
      card.appendChild(transferTools);
    }

    const table = document.createElement('table');
    table.className = 'list-table compact-table';
    table.innerHTML = '<thead><tr><th>Konto</th><th>Typ</th><th>Besitzer</th><th>Kontostand</th><th>Gebunden</th><th>Offen</th><th>Verfügbar</th><th>Fehlt</th><th>Aktion</th></tr></thead>';
    const body = document.createElement('tbody');
    accountStats.forEach(({ account, data }) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><strong>${account.name}</strong>${account.purpose ? `<div class="small muted">${account.purpose}</div>` : ''}</td><td>${getAccountTypeLabel(account.type)}</td><td>${getAccountOwnerLabel(account.owner)}</td><td>${euro(data.balance)}</td><td>${euro(data.bound)}</td><td>${euro(data.open)}</td><td class="success-text">${euro(data.available)}</td><td class="${data.missing > 0.005 ? 'danger-text' : 'muted'}">${data.missing > 0.005 ? euro(data.missing) : '—'}</td><td></td>`;
      const actionCell = tr.children[8];
      actionCell.appendChild(createActionMenu([
        { label: 'Bearbeiten', className: 'primary', onClick: () => showAccountEditor(account) },
        { label: 'Buchungen anzeigen', className: 'secondary', onClick: () => showAccountTransactions(account) },
        { label: 'Kontostand abgleichen', className: 'secondary', onClick: () => showAccountReconcileEditor(account) },
        { label: 'Offene Posten anzeigen', className: 'secondary', disabled: data.rows.length === 0, onClick: () => showAccountOpenItems(account, data.rows) },
        { label: 'Löschen', className: 'danger', disabled: account.id === DEFAULT_SHARED_ACCOUNT_ID, onClick: () => deleteAccount(account.id) }
      ]));
      body.appendChild(tr);
    });
    table.appendChild(body);
    const tableDetails = document.createElement('details');
    tableDetails.className = 'compact-details account-advanced-details';
    const tableSummary = document.createElement('summary');
    tableSummary.textContent = 'Erweiterte Kontentabelle anzeigen';
    tableDetails.appendChild(tableSummary);
    tableDetails.appendChild(table);
    card.appendChild(tableDetails);
    return card;
  }


  function showAccountTransferEditor() {
    normalizeAccountsConfig();
    normalizeAccountTransferTemplatesConfig();
    const accounts = state.accounts || [];
    if (accounts.length < 2) {
      alert('Bitte zuerst mindestens zwei Konten anlegen.');
      return;
    }
    const content = document.createElement('div');
    content.className = 'modal-form';

    if ((state.accountTransferTemplates || []).length) {
      const templateRow = document.createElement('div');
      templateRow.className = 'row';
      const templateSelect = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Vorlage auswählen';
      templateSelect.appendChild(blank);
      state.accountTransferTemplates.forEach((tpl) => {
        const opt = document.createElement('option');
        opt.value = tpl.id;
        opt.textContent = `${tpl.name} · ${euro(tpl.amount)}`;
        templateSelect.appendChild(opt);
      });
      templateRow.appendChild(createLabelInput('Vorlage', templateSelect));
      content.appendChild(templateRow);
      templateSelect.addEventListener('change', () => {
        const tpl = state.accountTransferTemplates.find((item) => item.id === templateSelect.value);
        if (!tpl) return;
        fromSelect.value = tpl.fromAccountId;
        toSelect.value = tpl.toAccountId;
        amountInput.value = Number(tpl.amount || 0).toFixed(2);
        noteInput.value = tpl.note || tpl.name || '';
        dayInput.value = String(tpl.dayOfMonth || 1);
        updateTransferWarning();
      });
    }

    const row1 = document.createElement('div');
    row1.className = 'row';
    const fromSelect = createAccountSelect('', { includeNone: false });
    const toSelect = createAccountSelect('', { includeNone: false });
    if (accounts[0]) fromSelect.value = accounts[0].id;
    if (accounts[1]) toSelect.value = accounts[1].id;
    row1.appendChild(createLabelInput('Von Konto', fromSelect));
    row1.appendChild(createLabelInput('Auf Konto', toSelect));
    content.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'row';
    const amountInput = document.createElement('input');
    amountInput.type = 'text';
    amountInput.inputMode = 'decimal';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = new Date().toISOString().slice(0, 10);
    const dayInput = document.createElement('input');
    dayInput.type = 'number';
    dayInput.min = '1';
    dayInput.max = '31';
    dayInput.step = '1';
    dayInput.value = '1';
    row2.appendChild(createLabelInput('Betrag', amountInput));
    row2.appendChild(createLabelInput('Datum', dateInput));
    row2.appendChild(createLabelInput('Vorlagen-Tag', dayInput));
    content.appendChild(row2);

    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = 'Notiz optional, z. B. Anteil Gemeinschaftskonto';
    content.appendChild(createLabelInput('Notiz', noteInput));

    const templateCheckLabel = document.createElement('label');
    templateCheckLabel.className = 'check-line';
    const templateCheck = document.createElement('input');
    templateCheck.type = 'checkbox';
    templateCheckLabel.appendChild(templateCheck);
    templateCheckLabel.appendChild(document.createTextNode(' Als monatliche Umbuchungsvorlage speichern'));
    content.appendChild(templateCheckLabel);

    const warn = document.createElement('div');
    warn.className = 'notice';
    content.appendChild(warn);
    const updateTransferWarning = () => {
      const amount = parseMoneyInput(amountInput.value);
      const text = getTransferAccountWarning(fromSelect.value, amount);
      warn.className = text && text.includes('Minus') ? 'notice warning' : 'notice success';
      warn.textContent = text || 'Wähle Konto und Betrag, um die Auswirkung zu sehen.';
    };
    [fromSelect, toSelect, amountInput].forEach((el) => el.addEventListener('input', updateTransferWarning));
    [fromSelect, toSelect].forEach((el) => el.addEventListener('change', updateTransferWarning));
    updateTransferWarning();

    showModal('Umbuchung zwischen Konten', content, [
      { label: 'Abbrechen', className: 'secondary' },
      { label: 'Umbuchen', className: 'primary', onClick: (close) => {
        const amount = parseMoneyInput(amountInput.value);
        if (!(amount > 0)) return alert('Bitte einen Betrag größer als 0 eintragen.');
        if (!fromSelect.value || !toSelect.value || fromSelect.value === toSelect.value) return alert('Bitte zwei unterschiedliche Konten auswählen.');
        if (templateCheck.checked) {
          addAccountTransferTemplate({
            name: noteInput.value || `${getAccountName(fromSelect.value)} → ${getAccountName(toSelect.value)}`,
            fromAccountId: fromSelect.value,
            toAccountId: toSelect.value,
            amount,
            dayOfMonth: Number(dayInput.value || 1),
            note: noteInput.value || '',
            isMonthly: true
          });
        }
        if (addAccountTransfer(fromSelect.value, toSelect.value, amount, noteInput.value || '', currentMonth, dateInput.value || '')) {
          saveState();
          close();
          render();
        }
      } }
    ]);
  }

  function showAccountOpenItems(account, rows) {
    const content = document.createElement('div');
    content.className = 'modal-form';
    if (!rows || !rows.length) {
      const p = document.createElement('p');
      p.textContent = 'Keine offenen zugeordneten Posten in diesem Monat.';
      content.appendChild(p);
    } else {
      const table = document.createElement('table');
      table.className = 'list-table compact-table';
      table.innerHTML = '<thead><tr><th>Bereich</th><th>Posten</th><th>Betrag</th></tr></thead>';
      const body = document.createElement('tbody');
      rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${row.group}</td><td>${row.name}</td><td>${euro(row.amount)}</td>`;
        body.appendChild(tr);
      });
      table.appendChild(body);
      content.appendChild(table);
    }
    showModal(`Offene Posten · ${account.name}`, content, [{ label: 'Schließen', className: 'secondary' }]);
  }

  function showAccountEditor(account) {
    normalizeAccountsConfig();
    const isNew = !account;
    const item = account || { id: generateId(), name: '', type: 'checking', owner: 'shared', balance: 0, bound: 0, purpose: '', interestEnabled: false, note: '' };
    const content = document.createElement('div');
    content.className = 'modal-form';
    const row1 = document.createElement('div');
    row1.className = 'row';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = item.name || '';
    const typeSelect = document.createElement('select');
    typeSelect.innerHTML = '<option value="checking">Girokonto</option><option value="daily">Tagesgeld</option><option value="shared">Gemeinschaftskonto</option><option value="cash">Bargeld</option><option value="other">Sonstiges</option>';
    typeSelect.value = normalizeAccountType(item.type);
    if (item.id === DEFAULT_SHARED_ACCOUNT_ID) typeSelect.disabled = true;
    row1.appendChild(createLabelInput('Kontoname', nameInput));
    row1.appendChild(createLabelInput('Kontotyp', typeSelect));
    content.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'row';
    const ownerSelect = document.createElement('select');
    ownerSelect.innerHTML = '<option value="shared">Gemeinsam</option><option value="benny">Benny</option><option value="madeleine">Madeleine</option><option value="other">Sonstiges</option>';
    ownerSelect.value = normalizeAccountOwner(item.owner);
    if (item.id === DEFAULT_SHARED_ACCOUNT_ID) ownerSelect.disabled = true;
    const balanceInput = document.createElement('input');
    balanceInput.type = 'text';
    balanceInput.inputMode = 'decimal';
    balanceInput.value = formatNumberInput(item.balance);
    row2.appendChild(createLabelInput('Besitzer', ownerSelect));
    row2.appendChild(createLabelInput('Aktueller Kontostand', balanceInput));
    content.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'row';
    const boundInput = document.createElement('input');
    boundInput.type = 'text';
    boundInput.inputMode = 'decimal';
    boundInput.value = formatNumberInput(item.bound);
    const purposeInput = document.createElement('input');
    purposeInput.type = 'text';
    purposeInput.value = item.purpose || '';
    row3.appendChild(createLabelInput('Gebunden / reserviert', boundInput));
    row3.appendChild(createLabelInput('Zweck', purposeInput));
    content.appendChild(row3);

    const interestLabel = document.createElement('label');
    const interestCheck = document.createElement('input');
    interestCheck.type = 'checkbox';
    interestCheck.checked = item.interestEnabled === true;
    interestLabel.appendChild(interestCheck);
    interestLabel.appendChild(document.createTextNode(' Zinsen auf diesem Konto erfassen'));
    content.appendChild(interestLabel);

    const noteInput = document.createElement('textarea');
    noteInput.rows = 2;
    noteInput.value = item.note || '';
    content.appendChild(createLabelInput('Notiz', noteInput));

    if (item.id === DEFAULT_SHARED_ACCOUNT_ID) {
      const info = document.createElement('div');
      info.className = 'notice success';
      info.textContent = 'Dieses Konto ist fest das Gemeinschaftskonto. Gemeinsame Kosten und Steuererstattung werden automatisch hier zugeordnet.';
      content.appendChild(info);
    }

    showModal(isNew ? 'Konto hinzufügen' : 'Konto bearbeiten', content, [
      { label: 'Abbrechen', className: 'secondary' },
      { label: 'Speichern', className: 'primary', onClick: (close) => {
        const name = nameInput.value.trim();
        if (!name) { alert('Bitte einen Kontonamen eintragen.'); return; }
        item.name = name;
        item.type = item.id === DEFAULT_SHARED_ACCOUNT_ID ? 'shared' : normalizeAccountType(typeSelect.value);
        item.owner = item.id === DEFAULT_SHARED_ACCOUNT_ID ? 'shared' : normalizeAccountOwner(ownerSelect.value);
        const balance = parseMoneyInput(balanceInput.value);
        const bound = parseMoneyInput(boundInput.value);
        if (!Number.isFinite(balance)) { alert('Bitte einen gültigen aktuellen Kontostand eintragen.'); return; }
        if (!Number.isFinite(bound) || bound < 0) { alert('Bitte einen gültigen gebundenen Betrag eintragen.'); return; }
        item.balance = balance;
        item.bound = bound;
        item.purpose = purposeInput.value || '';
        item.interestEnabled = interestCheck.checked;
        item.note = noteInput.value || '';
        if (isNew) state.accounts.push(item);
        if (item.id === DEFAULT_SHARED_ACCOUNT_ID || item.type === 'shared') {
          state.commonAccount.currentBalance = item.balance;
          state.commonAccount.manualBound = item.bound;
          state.commonAccount.note = item.note;
        }
        normalizeAccountsConfig();
        saveState();
        close();
        render();
      } }
    ]);
  }

  function deleteAccount(accountId) {
    if (!accountId || accountId === DEFAULT_SHARED_ACCOUNT_ID) return;
    const used = [];
    const checkList = (items, label) => (items || []).forEach((item) => { if (item.accountId === accountId) used.push(`${label}: ${item.name || 'Posten'}`); });
    checkList(state.commonCosts, 'Gemeinsame Kosten');
    checkList(state.personalCosts, 'Persönliche Ausgaben');
    checkList(state.bufferExpenses, 'Sonstige Ausgaben');
    (state.debts || []).forEach((debt) => { if (debt.accountId === accountId) used.push(`Schuld: ${debt.name || 'Schuld'}`); });
    if (used.length && !confirm(`Dieses Konto ist noch ${used.length} Posten zugeordnet. Konto trotzdem löschen und Zuordnungen entfernen?`)) return;
    [state.personalCosts, state.bufferExpenses, state.debts].forEach((list) => (list || []).forEach((item) => { if (item.accountId === accountId) item.accountId = ''; }));
    state.accounts = (state.accounts || []).filter((acc) => acc.id !== accountId);
    normalizeAccountsConfig();
    saveState();
    render();
  }


  function normalizeCommonAccountConfig() {
    if (!state.commonAccount || typeof state.commonAccount !== 'object' || Array.isArray(state.commonAccount)) {
      state.commonAccount = {};
    }
    const ca = state.commonAccount;
    ca.currentBalance = Number.isFinite(Number(ca.currentBalance)) ? Number(ca.currentBalance) : 0;
    ca.manualBound = Number.isFinite(Number(ca.manualBound)) ? Number(ca.manualBound) : 0;
    if (ca.manualBound < 0) ca.manualBound = 0;
    if (typeof ca.note !== 'string') ca.note = '';
    if (!ca.contributionOverrides || typeof ca.contributionOverrides !== 'object' || Array.isArray(ca.contributionOverrides)) ca.contributionOverrides = {};
    Object.keys(ca.contributionOverrides).forEach((month) => {
      const monthMap = ca.contributionOverrides[month];
      if (!isMonthKey(month) || !monthMap || typeof monthMap !== 'object' || Array.isArray(monthMap)) {
        delete ca.contributionOverrides[month];
        return;
      }
      Object.keys(monthMap).forEach((personId) => {
        const amount = Number(monthMap[personId]);
        if (!Number.isFinite(amount) || amount < 0) delete monthMap[personId];
        else monthMap[personId] = roundMoney(amount);
      });
      if (!Object.keys(monthMap).length) delete ca.contributionOverrides[month];
    });
    if (!ca.contributionsPaid || typeof ca.contributionsPaid !== 'object' || Array.isArray(ca.contributionsPaid)) ca.contributionsPaid = {};
    Object.keys(ca.contributionsPaid).forEach((month) => {
      if (!isMonthKey(month) || !ca.contributionsPaid[month] || typeof ca.contributionsPaid[month] !== 'object') {
        delete ca.contributionsPaid[month];
      }
    });
    if (!ca.contributionPayments || typeof ca.contributionPayments !== 'object' || Array.isArray(ca.contributionPayments)) ca.contributionPayments = {};
    Object.keys(ca.contributionPayments).forEach((month) => {
      const monthMap = ca.contributionPayments[month];
      if (!isMonthKey(month) || !monthMap || typeof monthMap !== 'object' || Array.isArray(monthMap)) {
        delete ca.contributionPayments[month];
        return;
      }
      Object.keys(monthMap).forEach((personId) => {
        const raw = monthMap[personId];
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          delete monthMap[personId];
          return;
        }
        const amount = Number(raw.amount || 0);
        if (!(amount > 0)) {
          delete monthMap[personId];
          return;
        }
        monthMap[personId] = {
          paid: raw.paid !== false,
          amount: roundMoney(amount),
          lockedAt: typeof raw.lockedAt === 'string' ? raw.lockedAt : '',
          source: typeof raw.source === 'string' ? raw.source : 'status',
          transferId: typeof raw.transferId === 'string' ? raw.transferId : ''
        };
      });
      if (!Object.keys(monthMap).length) delete ca.contributionPayments[month];
    });
    if (!Array.isArray(ca.interestEntries)) ca.interestEntries = [];
    ca.interestEntries = ca.interestEntries
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        id: entry.id || generateId(),
        month: isMonthKey(entry.month) ? entry.month : (isMonthKey(entry.receivedMonth) ? entry.receivedMonth : DEFAULT_TRANSACTION_MONTH),
        amount: Number.isFinite(Number(entry.amount)) ? Number(entry.amount) : 0,
        receivedDate: typeof entry.receivedDate === 'string' ? entry.receivedDate : '',
        note: typeof entry.note === 'string' ? entry.note : '',
        transactionId: typeof entry.transactionId === 'string' ? entry.transactionId : ''
      }))
      .filter((entry) => entry.amount !== 0);
  }

  function getTaxRefundRemainingTotal() {
    if (!Array.isArray(state.taxRefunds)) return 0;
    return state.taxRefunds.reduce((sum, refund) => {
      const amount = Number(refund && refund.amount || 0);
      const purchases = Array.isArray(refund && refund.purchases) ? refund.purchases : [];
      const used = purchases.reduce((pSum, p) => pSum + Number(p && p.amount || 0), 0);
      return sum + Math.max(amount - used, 0);
    }, 0);
  }

  function getCommonAccountContributionMap(monthKey) {
    normalizeCommonAccountConfig();
    if (!state.commonAccount.contributionsPaid[monthKey]) state.commonAccount.contributionsPaid[monthKey] = {};
    return state.commonAccount.contributionsPaid[monthKey];
  }

  function getCommonAccountContributionPaymentMap(monthKey) {
    normalizeCommonAccountConfig();
    if (!state.commonAccount.contributionPayments[monthKey]) state.commonAccount.contributionPayments[monthKey] = {};
    return state.commonAccount.contributionPayments[monthKey];
  }

  function getManualCommonContribution(monthKey, personId) {
    if (!isMonthKey(monthKey) || !personId) return null;
    normalizeCommonAccountConfig();
    const monthMap = state.commonAccount.contributionOverrides[monthKey];
    if (!monthMap || !Object.prototype.hasOwnProperty.call(monthMap, personId)) return null;
    const amount = Number(monthMap[personId]);
    return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
  }

  function setManualCommonContribution(monthKey, personId, amount) {
    if (!isMonthKey(monthKey) || !personId) return false;
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) return false;
    normalizeCommonAccountConfig();
    if (!state.commonAccount.contributionOverrides[monthKey]) state.commonAccount.contributionOverrides[monthKey] = {};
    state.commonAccount.contributionOverrides[monthKey][personId] = roundMoney(value);
    return true;
  }

  function clearManualCommonContribution(monthKey, personId) {
    if (!isMonthKey(monthKey) || !personId) return;
    normalizeCommonAccountConfig();
    const monthMap = state.commonAccount.contributionOverrides[monthKey];
    if (!monthMap) return;
    delete monthMap[personId];
    if (!Object.keys(monthMap).length) delete state.commonAccount.contributionOverrides[monthKey];
  }

  function getContributionTransferForPerson(monthKey, personId) {
    if (!isMonthKey(monthKey) || !personId) return null;
    normalizeAccountTransfersConfig();
    const sourceId = `contribution:${personId}:${monthKey}:transfer`;
    return (state.accountTransfers || []).find((tr) => tr && tr.sourceId === sourceId) || null;
  }

  function getCurrentContributionAmountForPerson(monthKey, personId) {
    if (!isMonthKey(monthKey) || !personId) return 0;
    const details = computeMonthDetails(monthKey);
    const row = (details.personsData || []).find((pd) => pd.person && pd.person.id === personId);
    return row ? roundMoney(Number(row.commonShare || 0)) : 0;
  }

  function getCommonAccountContributionPayment(monthKey, personId) {
    if (!isMonthKey(monthKey) || !personId) return null;
    const map = getCommonAccountContributionPaymentMap(monthKey);
    const entry = map[personId];
    if (entry && entry.paid !== false && Number(entry.amount || 0) > 0) {
      return entry;
    }
    const transfer = getContributionTransferForPerson(monthKey, personId);
    if (transfer && Number(transfer.amount || 0) > 0) {
      return {
        paid: true,
        amount: roundMoney(Number(transfer.amount || 0)),
        lockedAt: transfer.date || '',
        source: 'transfer',
        transferId: transfer.id || ''
      };
    }
    return null;
  }

  function lockCommonAccountContributionPayment(monthKey, personId, amount, options = {}) {
    if (!isMonthKey(monthKey) || !personId) return null;
    const transfer = getContributionTransferForPerson(monthKey, personId);
    const existing = getCommonAccountContributionPayment(monthKey, personId);
    const value = roundMoney(Number(amount || 0) || Number(transfer && transfer.amount || 0) || Number(existing && existing.amount || 0) || getCurrentContributionAmountForPerson(monthKey, personId));
    if (!(value > 0)) return null;
    const map = getCommonAccountContributionMap(monthKey);
    const paymentMap = getCommonAccountContributionPaymentMap(monthKey);
    map[personId] = true;
    paymentMap[personId] = {
      paid: true,
      amount: value,
      lockedAt: existing && existing.lockedAt ? existing.lockedAt : (options.lockedAt || new Date().toISOString()),
      source: options.source || (transfer ? 'transfer' : 'status'),
      transferId: transfer ? transfer.id : (existing && existing.transferId ? existing.transferId : '')
    };
    return paymentMap[personId];
  }

  function clearCommonAccountContributionPayment(monthKey, personId) {
    if (!isMonthKey(monthKey) || !personId) return;
    const map = getCommonAccountContributionMap(monthKey);
    map[personId] = false;
    const paymentMap = getCommonAccountContributionPaymentMap(monthKey);
    delete paymentMap[personId];
  }

  function setCommonAccountContributionPaid(monthKey, personId, paid, options = {}) {
    if (!isMonthKey(monthKey) || !personId) return;
    const map = getCommonAccountContributionMap(monthKey);
    const wasPaid = map[personId] === true;
    const nextPaid = paid === true;
    if (nextPaid) {
      lockCommonAccountContributionPayment(monthKey, personId, options.amount, options);
    } else {
      clearCommonAccountContributionPayment(monthKey, personId);
    }
    if (nextPaid && !wasPaid) markSharedLinkedReservePostsPaid(monthKey);
  }

  function markSharedLinkedReservePostsPaid(monthKey) {
    if (!isMonthKey(monthKey)) return 0;
    normalizeSavingsGoalsConfig();
    const sharedId = DEFAULT_SHARED_ACCOUNT_ID;
    let changed = 0;
    (state.commonCosts || []).forEach((post) => {
      if (!post || isPostPaidForMonth(post, monthKey) || !isDue(post, monthKey)) return;
      ensurePostConfig(post);
      const goal = getLinkedSavingsGoal(post);
      if (!goal || goal.accountId !== sharedId) return;
      setPostPaidForMonth(post, monthKey, true);
      changed += 1;
    });
    if (changed > 0) {
      addChangeLog('Rücklagen', `${changed} gemeinsame Rücklage(n) für ${formatMonthLabel(monthKey)} automatisch als zurückgelegt markiert.`, monthKey);
    }
    return changed;
  }

  function isCommonAccountContributionPaid(monthKey, personId) {
    if (!isMonthKey(monthKey) || !personId) return false;
    const map = getCommonAccountContributionMap(monthKey);
    // Ein vorhandener Nachweis belegt ebenfalls einen Eingang, falls in einem
    // aelteren Speicherstand nur die Historie, aber nicht das Statusfeld blieb.
    return map[personId] === true || !!getCommonAccountContributionPayment(monthKey, personId) || isContributionAccountBooked(monthKey, personId);
  }

  function getCommonAccountInterestEntries(monthKey) {
    normalizeCommonAccountConfig();
    return state.commonAccount.interestEntries
      .filter((entry) => !monthKey || entry.month === monthKey)
      .slice()
      .sort((a, b) => (b.month || '').localeCompare(a.month || '') || (b.receivedDate || '').localeCompare(a.receivedDate || ''));
  }

  function getCommonAccountInterestTotal(monthKey) {
    return getCommonAccountInterestEntries(monthKey).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  }

  function getCommonAccountInterestYearTotal(year) {
    normalizeCommonAccountConfig();
    const prefix = String(year || '').slice(0, 4) + '-';
    return state.commonAccount.interestEntries.reduce((sum, entry) => String(entry.month || '').startsWith(prefix) ? sum + Number(entry.amount || 0) : sum, 0);
  }

  function addCommonAccountInterest(entry, options = {}) {
    normalizeCommonAccountConfig();
    const month = isMonthKey(entry.month) ? entry.month : currentMonth;
    const amount = Number(entry.amount || 0);
    if (!(amount > 0)) return false;
    const item = {
      id: generateId(),
      month,
      amount,
      receivedDate: entry.receivedDate || new Date().toISOString().slice(0, 10),
      note: entry.note || ''
    };
    state.commonAccount.interestEntries.push(item);
    const shared = getSharedAccount();
    const txPayload = {
      month,
      type: 'interest',
      sourceId: `interest:${item.id}`,
      label: `Zinsen ${formatMonthLabel(month)}`,
      amount,
      note: options.addToBalance === true ? '' : 'Nachweis: Bankstand bleibt unverändert.'
    };
    const txId = shared
      ? (options.addToBalance === true
        ? applyAccountLedgerTransaction(shared.id, Object.assign({}, txPayload, { affectsBalance: true }))
        : upsertAccountTransaction(shared.id, Object.assign({}, txPayload, { affectsBalance: false, balanceMode: 'proof' })))
      : null;
    item.transactionId = txId || '';
    addChangeLog('Gemeinschaftskonto', `Zinsen für ${formatMonthLabel(month)} eingetragen: ${euro(amount)}.`, month);
    return true;
  }

  function deleteCommonAccountInterest(id) {
    normalizeCommonAccountConfig();
    const entry = state.commonAccount.interestEntries.find((item) => item.id === id);
    const before = state.commonAccount.interestEntries.length;
    if (entry) {
      if (entry.transactionId) removeAccountLedgerTransactionBySource(`interest:${entry.id}`) || removeAccountTransactionBySource(`interest:${entry.id}`) || removeAccountTransaction(getSharedAccount() && getSharedAccount().id, entry.transactionId);
      else removeAccountLedgerTransactionBySource(`interest:${entry.id}`) || removeAccountTransactionBySource(`interest:${entry.id}`);
    }
    state.commonAccount.interestEntries = state.commonAccount.interestEntries.filter((entry) => entry.id !== id);
    return state.commonAccount.interestEntries.length !== before;
  }

  function getNextDueMonthForIntervalPost(post, monthKey) {
    if (!post || !isMonthKey(post.startMonth) || !isMonthKey(monthKey)) return '';
    const interval = Number(post.interval || 1);
    if (!Number.isFinite(interval) || interval <= 1) return '';
    let nextDue = post.startMonth;
    while (monthDiff(nextDue, monthKey) > 0) {
      nextDue = addMonths(nextDue, interval);
    }
    return nextDue;
  }

  function getCommonAccountIntervalReserve(monthKey, options = {}) {
    // Rücklage, die auf dem Gemeinschaftskonto bleiben sollte, weil ihr monatlich
    // Anteile einzahlt, während einige gemeinsame Kosten nur quartalsweise,
    // halbjährlich oder jährlich abgebucht werden.
    if (!isMonthKey(monthKey)) return { total: 0, rows: [] };
    const includeOpenDueMonth = options.includeOpenDueMonth === true;
    const rows = [];
    let total = 0;
    (state.commonCosts || []).forEach((item) => {
      ensurePostConfig(item);
      if (getLinkedSavingsGoal(item)) return;
      const interval = Number(item.interval || 1);
      if (interval <= 1 || item.oneTime) return;
      const nextDue = getNextDueMonthForIntervalPost(item, monthKey);
      if (!nextDue) return;
      if (item.endMonth && isMonthKey(item.endMonth) && monthDiff(nextDue, item.endMonth) < 0) return;
      const monthsUntilDue = monthDiff(monthKey, nextDue);
      if (monthsUntilDue < 0 || monthsUntilDue >= interval) return;
      const dueNow = nextDue === monthKey;
      const paidNow = dueNow && isPostPaidForMonth(item, monthKey);
      const amount = Number(getEffectiveAmountForMonth(item, nextDue) || 0);
      const monthlyPart = amount / interval;
      let reserve = 0;
      let monthsBuilt = 0;

      if (dueNow && !paidNow) {
        if (includeOpenDueMonth) {
          // Tagesgeld-Soll: Der aktuelle Anspar-Zyklus zählt bis einschließlich
          // Fälligkeitsmonat, damit der letzte Anteil im Fälligkeitsmonat dabei ist.
          reserve = amount;
          monthsBuilt = interval;
        } else {
          // Gemeinschaftskonto-Verfügbarkeit: offene Abbuchungen werden separat
          // gezählt und dürfen dort nicht zusätzlich als Rücklage auftauchen.
          reserve = 0;
          monthsBuilt = 0;
        }
      } else {
        // Der Anspar-Zyklus beginnt nach der letzten Fälligkeit und endet mit
        // der nächsten Fälligkeit. Vor dem Zyklus bleibt der Sollbetrag bei 0.
        monthsBuilt = Math.max(0, Math.min(interval, interval - monthsUntilDue));
        if (dueNow && paidNow) monthsBuilt = 0;
        reserve = Math.min(amount, monthlyPart * monthsBuilt);
      }

      if (reserve > 0.005) {
        total += reserve;
        rows.push({
          item,
          amount,
          interval,
          monthlyPart,
          monthsBuilt,
          reserve,
          nextDue,
          dueNow,
          paidNow,
          includesDueMonthShare: includeOpenDueMonth && dueNow && !paidNow
        });
      }
    });
    return { total, rows };
  }

  function getDailySavingsAccountsForCommonCosts() {
    normalizeAccountsConfig(false);
    const dailyAccounts = (state.accounts || []).filter((account) => normalizeAccountType(account.type) === 'daily');
    const sharedDaily = dailyAccounts.filter((account) => normalizeAccountOwner(account.owner) === 'shared');
    return sharedDaily.length ? sharedDaily : dailyAccounts;
  }

  function getCommonIntervalDailySavingsPlan(monthKey) {
    const intervalReserve = getCommonAccountIntervalReserve(monthKey, { includeOpenDueMonth: true });
    const accounts = getDailySavingsAccountsForCommonCosts();
    const actualBalance = accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
    const target = Number(intervalReserve.total || 0);
    const currentMonthShare = (intervalReserve.rows || []).reduce((sum, row) => {
      const months = Math.max(0, Number(row.monthsBuilt || 0));
      return sum + (months > 0 ? Number(row.monthlyPart || 0) : 0);
    }, 0);
    return {
      accounts,
      actualBalance,
      target,
      missing: Math.max(target - actualBalance, 0),
      surplus: Math.max(actualBalance - target, 0),
      currentMonthShare,
      rows: intervalReserve.rows || []
    };
  }

  function computeCommonAccountDetails(monthKey) {
    normalizeCommonAccountConfig();
    const monthDetails = computeMonthDetails(monthKey);
    const persons = (monthDetails.personsData || []).map((pd) => {
      const plannedAmount = roundMoney(Number(pd.commonShare || 0));
      const paid = isCommonAccountContributionPaid(monthKey, pd.person.id);
      const payment = paid ? getCommonAccountContributionPayment(monthKey, pd.person.id) : null;
      const paidAmount = paid ? roundMoney(Number(payment && payment.amount || plannedAmount)) : 0;
      const openAmount = paid ? Math.max(roundMoney(plannedAmount - paidAmount), 0) : plannedAmount;
      return {
        person: pd.person,
        amount: paid ? paidAmount : plannedAmount,
        plannedAmount,
        paidAmount,
        openAmount,
        paid,
        locked: !!payment
      };
    });
    const contributionsTotal = roundMoney(persons.reduce((sum, row) => sum + row.plannedAmount, 0));
    const contributionsPaid = roundMoney(persons.reduce((sum, row) => sum + row.paidAmount, 0));
    const contributionsOpen = roundMoney(persons.reduce((sum, row) => sum + row.openAmount, 0));
    const dueCommon = (state.commonCosts || [])
      .filter((item) => isDue(item, monthKey))
      .map((item) => ({
        item,
        amount: Number(getEffectiveAmountForMonth(item, monthKey) || 0),
        paid: isPostPaidForMonth(item, monthKey)
      }));
    const actualDueTotal = dueCommon.reduce((sum, row) => sum + row.amount, 0);
    const actualPaidTotal = dueCommon.reduce((sum, row) => sum + (row.paid ? row.amount : 0), 0);
    const actualOpenTotal = Math.max(actualDueTotal - actualPaidTotal, 0);
    const taxBound = getTaxRefundRemainingTotal();
    const manualBound = Math.max(Number(state.commonAccount.manualBound || 0), 0);
    const intervalReserve = getCommonAccountIntervalReserve(monthKey);
    const intervalReserveTotal = Number(intervalReserve.total || 0);
    const savingsGoalBound = getSavingsGoalBoundForAccount(DEFAULT_SHARED_ACCOUNT_ID);
    const boundTotal = taxBound + manualBound + intervalReserveTotal + savingsGoalBound;
    const balance = Number(state.commonAccount.currentBalance || 0);
    const availableNow = balance - boundTotal;
    const requiredNow = boundTotal + actualOpenTotal;
    const missingNow = Math.max(requiredNow - balance, 0);
    const surplusNow = Math.max(balance - requiredNow, 0);
    const afterExpectedContributions = balance + contributionsOpen - boundTotal - actualOpenTotal;
    const interestMonth = getCommonAccountInterestTotal(monthKey);
    const interestYear = getCommonAccountInterestYearTotal(monthKey.slice(0, 4));
    return {
      monthDetails,
      persons,
      contributionsTotal,
      contributionsPaid,
      contributionsOpen,
      dueCommon,
      actualDueTotal,
      actualPaidTotal,
      actualOpenTotal,
      taxBound,
      manualBound,
      intervalReserve,
      intervalReserveTotal,
      savingsGoalBound,
      boundTotal,
      balance,
      availableNow,
      requiredNow,
      missingNow,
      surplusNow,
      afterExpectedContributions,
      interestMonth,
      interestYear
    };
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

  function migrateKreiskassePayrollPayment() {
    if (!state || !state.appMeta || state.appMeta.kreiskassePayrollPaymentV205Done === true) return false;
    const post = (state.personalCosts || []).find((item) => item && item.personId === 'benny' && normalizeTextKey(item.name).includes('kreiskasse'));
    if (post && typeof post.paidWithIncome !== 'boolean') post.paidWithIncome = true;
    state.appMeta.kreiskassePayrollPaymentV205Done = true;
    return !!post;
  }

  function migrateConfirmedMayDebtProofsV206() {
    if (!state || !state.appMeta || state.appMeta.confirmedMayDebtProofsV206Done === true) return 0;
    const confirmedPosts = new Set(['riverty az1', 'eos', 'kreiskasse opr']);
    let repaired = 0;
    (state.personalCosts || []).forEach((post) => {
      if (!post || !confirmedPosts.has(normalizeTextKey(post.name))) return;
      if (!isPostPaidForMonth(post, '2026-05')) return;
      if (repairMissingDebtPaymentFromPost(post, '2026-05', false)) repaired += 1;
    });
    state.appMeta.confirmedMayDebtProofsV206Done = true;
    return repaired;
  }

  function migrateCommonContributionPaymentsV221() {
    if (!state || typeof state !== 'object') return 0;
    normalizeCommonAccountConfig();
    normalizeAccountTransfersConfig();
    let repaired = 0;

    Object.entries(state.commonAccount.contributionsPaid || {}).forEach(([month, personMap]) => {
      if (!isMonthKey(month) || !personMap || typeof personMap !== 'object') return;
      Object.keys(personMap).forEach((personId) => {
        if (personMap[personId] !== true) return;
        if (getCommonAccountContributionPayment(month, personId)) return;
        const transfer = getContributionTransferForPerson(month, personId);
        const amount = transfer && Number(transfer.amount || 0) > 0
          ? Number(transfer.amount || 0)
          : getCurrentContributionAmountForPerson(month, personId);
        if (lockCommonAccountContributionPayment(month, personId, amount, { source: transfer ? 'transfer' : 'migration' })) repaired += 1;
      });
    });

    (state.accountTransfers || []).forEach((transfer) => {
      if (!transfer || typeof transfer.sourceId !== 'string') return;
      const match = transfer.sourceId.match(/^contribution:([^:]+):(\d{4}-\d{2}):transfer$/);
      if (!match || !isMonthKey(match[2])) return;
      const personId = match[1];
      const month = match[2];
      const explicit = state.commonAccount.contributionPayments
        && state.commonAccount.contributionPayments[month]
        && state.commonAccount.contributionPayments[month][personId];
      if (explicit && Math.abs(Number(explicit.amount || 0) - Number(transfer.amount || 0)) < 0.005 && explicit.transferId) return;
      if (lockCommonAccountContributionPayment(month, personId, Number(transfer.amount || 0), { source: 'transfer', lockedAt: transfer.date || '' })) repaired += 1;
    });

    if (repaired > 0) {
      if (!state.appMeta || typeof state.appMeta !== 'object') state.appMeta = {};
      state.appMeta.commonContributionPaymentsV221LastMigration = new Date().toISOString();
      addChangeLog('Gemeinschaftskonto', `${repaired} Monatsanteil(e) mit festem Zahlbetrag gespeichert.`, DEFAULT_TRANSACTION_MONTH);
    }
    return repaired;
  }

  function migrateAccountLedgerV213() {
    if (!state || typeof state !== 'object') return 0;
    let repaired = 0;
    normalizeAccountsConfig();
    normalizeAccountTransfersConfig();
    (state.accountTransfers || []).forEach((transfer) => {
      if (markAccountTransferTransactionsAsBalanceAffecting(transfer)) repaired += 1;
    });

    const allPosts = [
      ...(state.commonCosts || []),
      ...(state.personalCosts || []),
      ...(state.bufferExpenses || [])
    ];
    allPosts.forEach((post) => {
      if (!post || typeof post !== 'object') return;
      ensurePostConfig(post);
      const months = new Set([
        ...(post.paidMonths || []),
        ...Object.keys(post.accountBalanceDebits || {}),
        ...(post.sharedBalanceDebitedMonths || [])
      ].filter(isMonthKey));
      months.forEach((month) => {
        const sourceId = getPostAccountTransactionSource(post, month);
        const transferSourceId = sourceId ? `${sourceId}:transfer` : '';
        const legacyDebit = getPostAccountBalanceDebit(post, month);
        if (legacyDebit) {
          if (backfillPostAccountTransactionFromLegacy(post, month, legacyDebit)) repaired += 1;
          return;
        }
        if (!isPostPaidForMonth(post, month)) return;
        const shouldAutoTransfer = post.bookingType === 'transfer'
          && monthDiff('2026-06', month) >= 0
          && !(state.accountTransfers || []).some((tr) => tr && tr.sourceId === transferSourceId);
        if (shouldAutoTransfer && applyPostAccountBalanceDebit(post, month, true)) repaired += 1;
      });
    });

    normalizeCommonAccountConfig();
    Object.entries(state.commonAccount.contributionsPaid || {}).forEach(([month, personMap]) => {
      if (!isMonthKey(month) || monthDiff('2026-06', month) < 0 || !personMap || typeof personMap !== 'object') return;
      Object.keys(personMap).forEach((personId) => {
        if (personMap[personId] !== true) return;
        const transferBooked = (state.accountTransfers || []).some((tr) => tr && tr.sourceId === `contribution:${personId}:${month}:transfer`);
        if (transferBooked) return;
        if (applyContributionAccountBooking(month, personId, true)) repaired += 1;
      });
    });

    (state.persons || []).forEach((person) => {
      ensurePersonIncomeConfig(person);
      Object.entries(person.incomeReceived || {}).forEach(([month, entry]) => {
        if (!isMonthKey(month) || !entry || typeof entry !== 'object') return;
        const sourceId = `income:${person.id}:${month}`;
        const found = findAccountTransactionBySource(sourceId);
        if (entry.balanceApplied === true) {
          if (found) {
            found.tx.affectsBalance = true;
            found.tx.balanceMode = 'bank';
            if (!entry.transactionId) entry.transactionId = found.tx.id;
            if (!entry.balanceAppliedAccountId) entry.balanceAppliedAccountId = found.account.id;
            if (!Number(entry.balanceAppliedAmount || 0)) entry.balanceAppliedAmount = Number(entry.amount || found.tx.amount || 0);
            repaired += 1;
          } else if (entry.accountId && getAccountById(entry.accountId) && Number(entry.amount || 0) > 0) {
            const txId = addAccountTransaction(entry.accountId, {
              month,
              type: 'income',
              sourceId,
              label: `Lohn ${person.name || ''} ${formatMonthLabel(month)}`.trim(),
              amount: Number(entry.amount || 0),
              note: 'Aus altem Speicherstand übernommen; der Bankstand war bereits angepasst.',
              affectsBalance: true
            });
            if (txId) {
              entry.transactionId = txId;
              repaired += 1;
            }
          }
        }
      });
    });

    if (repaired > 0) {
      if (!state.appMeta || typeof state.appMeta !== 'object') state.appMeta = {};
      state.appMeta.accountLedgerV213LastMigration = new Date().toISOString();
      addChangeLog('Konten', `${repaired} alte Konto-/Umbuchungsnachweise auf die zentrale Buchungslogik umgestellt.`, DEFAULT_TRANSACTION_MONTH);
    }
    return repaired;
  }

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
    const verteilbar = getDistributableAmountFromFree(computeFreeSumForMonth(monthKey));
    const ruecklagen = verteilbar * savingsConfig.reservesRatio;
    const share = savingsConfig.reservePotShares[potName] || 0;
    return roundMoney(ruecklagen * share);
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
    const verteilbar = getDistributableAmountFromFree(computeFreeSumForMonth(monthKey));
    return roundMoney(verteilbar * savingsConfig.savingsRatio);
  }

  function formatMonthLabel(monthKey) {
    return monthKeyToDate(monthKey).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  }

  const euroFormatter = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function euro(value) {
    const amount = Number(value || 0);
    return euroFormatter.format(Number.isFinite(amount) ? amount : 0);
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

  function getLinkedDebtPaidPostAmountForMonth(debt, monthKey) {
    if (!debt || !isMonthKey(monthKey)) return 0;
    return getLinkedPostsForDebt(debt).reduce((sum, item) => {
      const post = item && item.post;
      if (!post) return sum;
      ensurePostConfig(post);
      if (!isDue(post, monthKey) || !isPostPaidForMonth(post, monthKey)) return sum;
      return sum + Number(getEffectiveAmountForMonth(post, monthKey) || 0);
    }, 0);
  }

  function getDebtCoveredAmountForMonth(debt, monthKey) {
    const historyAmount = getDebtPaymentAmountForMonth(debt, monthKey);
    const linkedPostAmount = getLinkedDebtPaidPostAmountForMonth(debt, monthKey);
    return Math.max(Number(historyAmount || 0), Number(linkedPostAmount || 0));
  }

  function getDebtPlannedAmountForMonth(debt, monthKey) {
    const plannedBase = getDebtMonthAmount(debt, monthKey);
    const covered = getDebtCoveredAmountForMonth(debt, monthKey);
    return covered > 0 ? Math.max(plannedBase, covered) : plannedBase;
  }

  function getDebtOpenAmountForMonth(debt, monthKey) {
    const planned = getDebtPlannedAmountForMonth(debt, monthKey);
    const covered = getDebtCoveredAmountForMonth(debt, monthKey);
    return Math.max(planned - covered, 0);
  }

  function isDebtOpenForMonth(debt, monthKey) {
    return getDebtOpenAmountForMonth(debt, monthKey) > 0.005;
  }

  function getDebtPlanForMonth(monthKey) {
    let planned = 0;
    let paid = 0;
    let open = 0;
    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      const coveredAmount = getDebtCoveredAmountForMonth(debt, monthKey);
      const plannedBase = getDebtPlannedAmountForMonth(debt, monthKey);
      if (coveredAmount > 0 || plannedBase > 0) {
        planned += plannedBase;
        paid += coveredAmount;
        open += getDebtOpenAmountForMonth(debt, monthKey);
      }
    });
    return { planned, paid, open };
  }


  function getLinkedDebtCostTotalForMonth(monthKey) {
    let total = 0;
    (state.commonCosts || []).forEach((post) => {
      if (post.linkedDebtId && isPostActiveInMonth(post, monthKey)) {
        total += Number(getCommonMonthlyShare(post, monthKey) || 0);
      }
    });
    (state.personalCosts || []).forEach((post) => {
      if (post.linkedDebtId && isDue(post, monthKey)) {
        total += Number(getEffectiveAmountForMonth(post, monthKey) || 0);
      }
    });
    return total;
  }

  function buildDebtForecastProjection(startMonth = currentMonth, horizon = 24, options = {}) {
    const map = {};
    Array.from({ length: horizon }, (_, index) => addMonths(startMonth, index)).forEach((month) => {
      map[month] = { planned: 0, base: 0, snowballExtra: 0, dynamicExtra: 0, notes: [] };
    });

    const snowball = buildSnowballPlan(startMonth, horizon, { monthDetailsFn: options.monthDetailsFn });
    (snowball.rows || []).forEach((row) => {
      if (!map[row.month]) return;
      map[row.month].planned += Number(row.total || 0);
      map[row.month].base += Number(row.base || 0);
      map[row.month].snowballExtra += Number(row.extra || 0);
      map[row.month].dynamicExtra = (Number(map[row.month].dynamicExtra || 0) + Number(row.dynamicExtra || 0));
      if (row.notes) map[row.month].notes.push(row.notes);
    });

    // Einmalzahlungen und offene Pläne gehören nicht in den Schneeball, sollen in der Vorschau
    // aber trotzdem nicht endlos als Fixkosten weiterlaufen. Sie werden im Fälligkeitsmonat einmalig berücksichtigt.
    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      const open = Math.max(0, Number(debt.amountOpen || 0));
      if (!(open > 0)) return;
      if (isInstallmentDebtForSnowball(debt, startMonth)) return;
      if (debt.paymentType === 'one_time' && isMonthKey(debt.nextDueMonth) && map[debt.nextDueMonth]) {
        const amount = Math.min(open, Math.max(0, getDebtRateForMonth(debt, debt.nextDueMonth) || open));
        if (amount > 0) {
          map[debt.nextDueMonth].planned += amount;
          map[debt.nextDueMonth].base += amount;
          map[debt.nextDueMonth].notes.push(`${debt.name || 'Schuld'}: ${euro(amount)} einmalig`);
        }
      }
    });
    return map;
  }

  function applyDebtProjectionToForecastDetails(details, monthKey, projectionMap) {
    const linkedDebtCosts = getLinkedDebtCostTotalForMonth(monthKey);
    const projected = projectionMap && projectionMap[monthKey] ? projectionMap[monthKey] : { planned: 0, base: 0, snowballExtra: 0, dynamicExtra: 0, notes: [] };
    const debtPlanned = Number(projected.planned || 0);
    const debtAdjustment = linkedDebtCosts - debtPlanned;
    const free = roundMoney(Number(details.free || 0) + debtAdjustment);
    const freeCurrent = roundMoney(Number(details.freeCurrent != null ? details.freeCurrent : details.free || 0) + debtAdjustment);
    const freeConservative = free;
    const distributable = getDistributableAmountFromFree(free);
    return {
      ...details,
      linkedDebtCosts,
      debtPlanned,
      debtBase: Number(projected.base || 0),
      debtSnowballExtra: Number(projected.snowballExtra || 0),
      debtDynamicExtra: Number(projected.dynamicExtra || 0),
      debtNotes: projected.notes || [],
      freeCurrent,
      freeConservative,
      free,
      distributable: roundMoney(distributable),
      reserves: roundMoney(distributable * savingsConfig.reservesRatio),
      savings: roundMoney(distributable * savingsConfig.savingsRatio),
      distributionBuffer: roundMoney(Number(savingsConfig.minFree || 0)),
      keptFreeBuffer: roundMoney(Math.max(0, Math.min(free, Number(savingsConfig.minFree || 0))))
    };
  }

  function estimateNormalPayoffMonthsForPlanDebt(debt, fromMonth, limit = snowballConfig.shortTermSkipMonths) {
    if (!debt || !(debt.open > 0) || !isMonthKey(fromMonth)) return Infinity;
    let open = Math.max(0, Number(debt.open || 0));
    let month = fromMonth;
    for (let i = 1; i <= limit; i += 1) {
      const rate = Math.max(0, Number(getDebtRateForMonth(debt, month) || debt.rate || 0));
      if (monthDiff(debt.nextDueMonth || fromMonth, month) >= 0 && rate > 0) {
        open = Math.max(0, open - Math.min(open, rate));
      }
      if (open <= 0.005) return i;
      month = nextMonth(month);
    }
    return Infinity;
  }

  function isShortTermSnowballTarget(debt, fromMonth, limit = snowballConfig.shortTermSkipMonths) {
    const months = estimateNormalPayoffMonthsForPlanDebt(debt, fromMonth, limit);
    return Number.isFinite(months) && months <= limit;
  }

  function chooseSnowballTarget(active, month, extraBudget = 0, options = {}) {
    const allowFullPayoff = options.allowFullPayoff === true;
    const candidates = active
      .filter((debt) => debt.open > 0 && monthDiff(debt.nextDueMonth, month) >= 0 && isDebtAllowedAsSnowballTarget(debt))
      .sort((a, b) => a.open - b.open || a.name.localeCompare(b.name));
    if (!candidates.length) return null;

    // Dynamischer Zusatzbetrag darf nur eingesetzt werden, wenn damit eine Schuld
    // komplett geschlossen werden kann. Normale Schneeball-Umlegungen laufen weiter separat.
    if (allowFullPayoff && extraBudget > 0) {
      const closable = candidates.find((debt) => debt.open <= extraBudget + 0.005);
      if (closable) return closable;
      if (options.fullPayoffOnly) return null;
    }

    // Für die Weitergabe einer ausgelaufenen Standardrate zählt immer die kleinste
    // passende offene Ratenschuld. Eine kurze Restlaufzeit darf den Vorschlag nicht
    // unterdrücken oder hinter eine größere Schuld verschieben.
    if (options.fallbackToShortTerm) return candidates[0];
    const longRunning = candidates.filter((debt) => !isShortTermSnowballTarget(debt, month, snowballConfig.shortTermSkipMonths));
    if (longRunning.length) return longRunning[0];
    return null;
  }

  function getNonSnowballDebtPaymentForMonth(monthKey) {
    let total = 0;
    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      const open = Math.max(0, Number(debt.amountOpen || 0));
      if (!(open > 0)) return;
      if (isInstallmentDebtForSnowball(debt, monthKey)) return;
      if (debt.paymentType === 'one_time' && isMonthKey(debt.nextDueMonth) && debt.nextDueMonth === monthKey) {
        const rate = Math.max(0, Number(getDebtRateForMonth(debt, monthKey) || open));
        total += Math.min(open, rate || open);
      }
    });
    return total;
  }

  function isDebtAllowedAsDynamicExtraTarget(debt) {
    const rule = getDebtCreditorRule(debt);
    return isDebtExtraPaymentAllowed(debt) && !(rule && rule.allowDynamicExtra === false);
  }

  function getFixedDebtPoolForMonth(monthKey) {
    if (!isMonthKey(monthKey)) return 0;
    return roundMoney((state.debts || []).reduce((sum, debt) => {
      ensureDebtConfig(debt);
      if (debt.paymentType !== 'installment') return sum;
      const completedMonth = getDebtCompletedMonth(debt);
      if (completedMonth && completedMonth <= monthKey) {
        return sum + getDebtFreedStandardRate(debt, completedMonth);
      }
      const rate = Math.max(0, Number(getDebtRateForMonth(debt, monthKey) || 0));
      const covered = getDebtCoveredAmountForMonth(debt, monthKey);
      const dueInMonth = !isMonthKey(debt.nextDueMonth) || debt.nextDueMonth <= monthKey;
      if (Number(debt.amountOpen || 0) > 0 && rate > 0 && (covered > 0 || dueInMonth)) {
        return sum + rate;
      }
      return sum;
    }, 0));
  }

  function getDynamicDebtSpecialPaymentSuggestion(monthKey = currentMonth, plan = null) {
    if (!isMonthKey(monthKey) || isMonthClosed(monthKey)) return null;
    const activePlan = plan || buildSnowballPlan(monthKey, 1);
    const currentPlanRow = (activePlan.rows || []).find((row) => row.month === monthKey);
    const alreadyFinishing = new Set(
      (currentPlanRow && Array.isArray(currentPlanRow.payments) ? currentPlanRow.payments : [])
        .filter((payment) => payment.completed)
        .map((payment) => payment.debt)
    );
    const candidates = (state.debts || [])
      .filter((debt) => {
        ensureDebtConfig(debt);
        const dueOneTimePayment = debt.paymentType === 'one_time' && isMonthKey(debt.nextDueMonth) && debt.nextDueMonth <= monthKey;
        return Number(debt.amountOpen || 0) > 0
          && !dueOneTimePayment
          && !alreadyFinishing.has(debt.name)
          && isDebtAllowedAsDynamicExtraTarget(debt);
      })
      .sort((a, b) => Number(a.amountOpen || 0) - Number(b.amountOpen || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'de'));
    if (!candidates.length) return null;

    const details = computeMonthDetails(monthKey);
    const linkedDebtCosts = getLinkedDebtCostTotalForMonth(monthKey);
    const fixedPool = getFixedDebtPoolForMonth(monthKey);
    const nonInstallmentDebtDue = getNonSnowballDebtPaymentForMonth(monthKey);
    const extraAlreadyPaid = getDebtSpecialPaymentAmountForMonth(monthKey);
    const safelyFree = roundMoney(
      Number(details.free || 0)
      + Number(linkedDebtCosts || 0)
      - fixedPool
      - nonInstallmentDebtDue
      - extraAlreadyPaid
    );
    const available = roundMoney(Math.max(0, safelyFree - snowballConfig.keepFreeBuffer));
    const target = candidates[0];
    if (safelyFree + 0.005 < snowballConfig.extraInvestTrigger || !(available > 0)) {
      return {
        month: monthKey,
        safelyFree,
        buffer: snowballConfig.keepFreeBuffer,
        available: 0,
        amount: 0,
        target,
        closesTarget: false,
        fixedPool,
        extraAlreadyPaid,
        neededForSuggestion: roundMoney(Math.max(0, snowballConfig.extraInvestTrigger - safelyFree)),
        reason: 'not_enough_free'
      };
    }

    const amount = roundMoney(Math.min(available, Number(target.amountOpen || 0)));
    if (!(amount > 0)) return null;
    return {
      month: monthKey,
      safelyFree,
      buffer: snowballConfig.keepFreeBuffer,
      available,
      amount,
      target,
      closesTarget: amount + 0.005 >= Number(target.amountOpen || 0),
      fixedPool,
      extraAlreadyPaid
    };
  }

  function getDebtFreedStandardRate(debt, completedMonth) {
    if (!debt || debt.paymentType !== 'installment' || !isMonthKey(completedMonth)) return 0;
    return roundMoney(Math.max(0, Number(getDebtRateForMonth(debt, completedMonth) || debt.monthlyRate || 0)));
  }

  function getHistoricalDebtRollover(startMonth) {
    if (!isMonthKey(startMonth)) return 0;
    return roundMoney((state.debts || []).reduce((sum, debt) => {
      ensureDebtConfig(debt);
      const completedMonth = getDebtCompletedMonth(debt);
      if (!completedMonth || monthDiff(completedMonth, startMonth) <= 0) return sum;
      return sum + getDebtFreedStandardRate(debt, completedMonth);
    }, 0));
  }

  function getDebtStandardRatesCompletedInMonth(monthKey) {
    if (!isMonthKey(monthKey)) return 0;
    return roundMoney((state.debts || []).reduce((sum, debt) => {
      ensureDebtConfig(debt);
      if (getDebtCompletedMonth(debt) !== monthKey) return sum;
      return sum + getDebtFreedStandardRate(debt, monthKey);
    }, 0));
  }

  function buildSnowballPlan(startMonth = currentMonth, maxMonths = 72, options = {}) {
    const sourceDebts = (state.debts || []).map((debt) => {
      ensureDebtConfig(debt);
      return {
        id: debt.id,
        name: debt.name || 'Schuld',
        open: Math.max(0, Number(debt.amountOpen || 0)),
        rate: Math.max(0, getDebtRateForMonth(debt, startMonth)),
        monthlyRate: Math.max(0, Number(debt.monthlyRate || 0)),
        baseRate: Math.max(0, Number(debt.monthlyRate || 0)),
        rateTimeline: Array.isArray(debt.rateTimeline) ? debt.rateTimeline.map((entry) => ({ month: entry.month, amount: Number(entry.amount || 0) })) : [],
        nextDueMonth: isMonthKey(debt.nextDueMonth) ? debt.nextDueMonth : startMonth,
        snowballEligible: isInstallmentDebtForSnowball(debt, startMonth),
        paymentType: debt.paymentType,
        scheduledMonth: isMonthKey(debt.nextDueMonth) ? debt.nextDueMonth : '',
        excludeReason: getSnowballExcludeReason(debt, startMonth)
      };
    }).filter((debt) => debt.open > 0);
    // Nicht eingeplante Schulden sind nur echte offene Pläne/fehlende Raten.
    // Fest terminierte Einmalzahlungen (z. B. Telekom/Riverty AZ2 im Juni)
    // werden als geplante Einmalzahlung behandelt und dürfen die Schuldenfrei-Prognose
    // der Ratenschulden nicht blockieren.
    const noRate = sourceDebts.filter((debt) => debt.excludeReason && debt.paymentType !== 'one_time');
    const scheduledOneTime = sourceDebts.filter((debt) => debt.paymentType === 'one_time' && debt.open > 0 && isMonthKey(debt.scheduledMonth));
    const active = sourceDebts.filter((debt) => debt.snowballEligible);
    const rows = [];
    const events = [];
    const rolloverStart = getHistoricalDebtRollover(startMonth);
    let rollover = rolloverStart;
    let month = startMonth;
    let debtFreeMonth = '';

    for (let i = 0; i < maxMonths && active.some((debt) => debt.open > 0); i += 1) {
      let base = 0;
      let extra = 0;
      let newlyFreed = 0;
      const notes = [];
      const payments = [];
      active.forEach((debt) => { debt.rate = getDebtRateForMonth(debt, month); });
      // Pflicht-/Normalraten müssen auch für feste Ratenpläne gezahlt werden.
      // isDebtAllowedAsSnowballTarget() darf hier NICHT filtern, sonst würden z. B.
      // Kreiskasse-Pläne ohne Extra-Zahlung nie auslaufen und die Prognose bliebe
      // fälschlich bei „noch nicht berechenbar“ hängen. Die Sperre gilt nur für
      // Schneeball-/Extra-Ziele in chooseSnowballTarget().
      const dueDebts = active
        .filter((debt) => debt.open > 0 && monthDiff(debt.nextDueMonth, month) >= 0)
        .sort((a, b) => a.open - b.open || a.name.localeCompare(b.name));
      // Der gesamte Schulden-Pool bleibt erhalten: laufende Standardraten plus bereits
      // in früheren Monaten frei gewordene Standardraten. Eine kleinere Schlussrate
      // reduziert diesen reservierten Monatsbetrag nicht.
      const debtPool = roundMoney(
        rollover
        + dueDebts.reduce((sum, debt) => sum + Math.max(0, Number(debt.rate || 0)), 0)
        + (i === 0 ? getDebtStandardRatesCompletedInMonth(month) : 0)
      );

      dueDebts.forEach((debt) => {
        const pay = Math.min(debt.open, debt.rate);
        debt.open = Math.max(0, debt.open - pay);
        base += pay;
        if (pay > 0) {
          notes.push(`${debt.name}: ${euro(pay)}`);
          payments.push({ type: 'rate', debt: debt.name, amount: pay, originalRate: debt.rate, remainingAfter: Math.max(0, debt.open), completed: debt.open <= 0.005, note: debt.open <= 0.005 ? 'Schlussrate / läuft aus' : 'normale Rate' });
        }
        if (debt.open <= 0.005) {
          debt.open = 0;
          newlyFreed += debt.rate;
        }
      });

      if (rollover > 0) {
        let extraBudget = rollover;
        while (extraBudget > 0.005) {
          const target = chooseSnowballTarget(active, month, extraBudget, { allowFullPayoff: false, fallbackToShortTerm: true });
          if (!target) {
            notes.push(`${euro(extraBudget)} aus abgeschlossenen Standardraten bleibt frei, weil keine passende Ratenschuld offen ist.`);
            break;
          }
          const pay = Math.min(target.open, extraBudget);
          target.open = Math.max(0, target.open - pay);
          extra += pay;
          extraBudget -= pay;
          notes.push(`${target.name} +${euro(pay)} Schneeball`);
          payments.push({ type: 'snowball', debt: target.name, amount: pay, originalRate: target.rate, remainingAfter: Math.max(0, target.open), completed: target.open <= 0.005, note: target.open <= 0.005 ? 'durch Schneeball erledigt' : 'frei gewordene Rate' });
          if (target.open <= 0.005) {
            target.open = 0;
            newlyFreed += target.rate;
          }
        }
      }

      const remaining = active.reduce((sum, debt) => sum + Math.max(0, debt.open), 0);
      const nextTarget = chooseSnowballTarget(active, nextMonth(month), rollover + newlyFreed, { allowFullPayoff: false, fallbackToShortTerm: true });
      const rolloverNext = rollover + newlyFreed;
      const freedThisMonth = active
        .filter((debt) => debt.open === 0 && debt.rate > 0)
        .filter((debt) => notes.some((note) => note.startsWith(`${debt.name}:`) || note.startsWith(`${debt.name} +`)))
        .map((debt) => ({ month, sourceDebt: debt.name, amount: debt.rate, targetDebt: nextTarget ? nextTarget.name : '', transferMonth: nextMonth(month) }));
      freedThisMonth.forEach((entry) => {
        events.push({
          month,
          type: 'transfer',
          sourceDebt: entry.sourceDebt,
          amount: entry.amount,
          targetDebt: entry.targetDebt,
          transferMonth: entry.transferMonth,
          text: `${entry.sourceDebt} ausgelaufen – ${euro(entry.amount)} gehen ab ${formatMonthLabel(entry.transferMonth)} auf ${entry.targetDebt || 'keine weitere Schuld'}.`
        });
      });
      rows.push({ month, base, extra, dynamicExtra: 0, total: base + extra, pool: debtPool, rolloverNext, remaining, targetNext: nextTarget ? nextTarget.name : '', freedTransfers: freedThisMonth, payments: payments.slice(), notes: notes.slice(0, 5).join(' · ') });
      if (remaining <= 0.005) {
        debtFreeMonth = month;
        break;
      }
      rollover += newlyFreed;
      month = nextMonth(month);
    }
    return { rows, events, noRate, scheduledOneTime, debtFreeMonth, rolloverStart };
  }

  function getDebtRolloverSuggestionsForMonth(monthKey, plan = null) {
    if (!isMonthKey(monthKey)) return [];
    const activePlan = plan || buildSnowballPlan(monthKey, 120);
    const row = (activePlan.rows || []).find((entry) => entry.month === monthKey);
    const suggestions = (row && Array.isArray(row.freedTransfers) ? row.freedTransfers : [])
      .map((entry) => ({ ...entry, status: 'planned' }));
    const knownSources = new Set(suggestions.map((entry) => entry.sourceDebt));
    const nextPlan = buildSnowballPlan(nextMonth(monthKey), 1);
    const nextSnowballPayment = ((nextPlan.rows || [])[0]?.payments || [])
      .find((payment) => payment.type === 'snowball');

    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      if (debt.paymentType !== 'installment') return;
      if (getDebtCompletedMonth(debt) !== monthKey) return;
      if (knownSources.has(debt.name)) return;
      const amount = getDebtFreedStandardRate(debt, monthKey);
      if (!(amount > 0)) return;
      suggestions.push({
        month: monthKey,
        sourceDebt: debt.name || 'Schuld',
        amount,
        targetDebt: nextSnowballPayment ? nextSnowballPayment.debt : '',
        transferMonth: nextMonth(monthKey),
        status: 'completed'
      });
    });
    return suggestions;
  }

  function findCriticalMonths(startMonth = currentMonth) {
    return getNext12Months(startMonth)
      .map(({ key, label }) => ({ key, label, free: computeMonthDetails(key).free }))
      .filter((item) => item.free < 0)
      .slice(0, 3);
  }

  function getFinanceStatus(free) {
    if (free < 0) return { label: 'Kritisch', kind: 'danger', text: `Der Monat ist mit ${euro(Math.abs(free))} im Minus.` };
    if (free < 100) return { label: 'Sehr eng', kind: 'danger', text: 'Der freie Rest liegt unter 100 €.' };
    if (free < 300) return { label: 'Eng', kind: 'warning', text: 'Der freie Rest liegt unter 300 €.' };
    return { label: 'Stabil', kind: 'success', text: 'Der Monat hat genug Luft.' };
  }


  function createUiEl(tag, className, text) {
    const el = document.createElement(tag || 'div');
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function createJumpButton(label, section, className = 'secondary compact') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      currentSection = section;
      render();
    });
    return btn;
  }

  function createMoneyField(value = '') {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.placeholder = 'z. B. 30,50';
    const numeric = Number(value);
    input.value = value === '' || value === null || value === undefined
      ? ''
      : (Number.isFinite(numeric) ? formatNumberInput(numeric) : String(value));
    return input;
  }

  function createIntervalSelect(value = 1) {
    const select = document.createElement('select');
    const presets = [
      ['1', 'monatlich'],
      ['2', 'alle 2 Monate'],
      ['3', 'vierteljährlich'],
      ['6', 'halbjährlich'],
      ['12', 'jährlich']
    ];
    const normalized = String(Math.max(1, parseInt(value, 10) || 1));
    if (!presets.some(([preset]) => preset === normalized)) presets.push([normalized, `alle ${normalized} Monate`]);
    select.innerHTML = presets.map(([val, label]) => `<option value="${val}">${label}</option>`).join('');
    select.value = normalized;
    return select;
  }

  function createGuidedFormIntro(title, text) {
    const intro = createUiEl('div', 'guided-form-intro');
    intro.appendChild(createUiEl('strong', '', title));
    intro.appendChild(createUiEl('span', '', text));
    return intro;
  }

  function createGuidedFormSection(title, hint = '') {
    const section = createUiEl('div', 'guided-form-section');
    const head = createUiEl('div', 'guided-form-section-head');
    head.appendChild(createUiEl('h4', '', title));
    if (hint) head.appendChild(createUiEl('p', '', hint));
    section.appendChild(head);
    return section;
  }

  function createDashboardToolButton(label, section) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'round-tool dashboard-tool-text';
    btn.textContent = label;
    btn.addEventListener('click', () => switchSection(section));
    return btn;
  }

  function showPersonalQuickAddModal() {
    const people = (state.persons || []).filter((person) => person && person.id);
    if (people.length === 0) {
      switchSection('personal');
      return;
    }
    if (people.length === 1) {
      showPersonalEditor(people[0].id);
      return;
    }

    const content = createUiEl('div', 'quick-person-picker');
    content.appendChild(createUiEl('p', 'small muted', 'Für wen möchtest du eine persönliche Ausgabe eintragen?'));
    const grid = createUiEl('div', 'quick-person-grid');
    content.appendChild(grid);

    const modal = showModal('Persönliche Ausgabe hinzufügen', content, [
      { label: 'Abbrechen', className: 'secondary' }
    ]);

    people.forEach((person) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'overview-quick-action person-choice';
      btn.appendChild(createUiEl('span', 'quick-action-icon', '•'));
      const text = createUiEl('span', 'quick-action-text');
      text.appendChild(createUiEl('strong', '', person.name || 'Person'));
      text.appendChild(createUiEl('small', '', 'Persönliche Ausgabe anlegen'));
      btn.appendChild(text);
      btn.addEventListener('click', () => {
        modal.close();
        setTimeout(() => showPersonalEditor(person.id), 0);
      });
      grid.appendChild(btn);
    });
  }

  function createQuickActionButton({ title, text, icon, tone, onClick }, close) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `overview-quick-action ${tone || ''}`.trim();
    btn.appendChild(createUiEl('span', 'quick-action-icon', icon || '+'));
    const label = createUiEl('span', 'quick-action-text');
    label.appendChild(createUiEl('strong', '', title));
    label.appendChild(createUiEl('small', '', text));
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      if (typeof close === 'function') close();
      setTimeout(() => {
        if (typeof onClick === 'function') onClick();
      }, 0);
    });
    return btn;
  }

  function getQuickCaptureActions() {
    return [
      {
        title: 'Lohn prüfen',
        text: 'Einkommen eintragen oder als erhalten markieren',
        icon: '€',
        tone: 'primary-action',
        onClick: () => switchSection('income')
      },
      {
        title: 'Gemeinsame Kosten',
        text: 'Fixkosten, Rücklagenposten oder Zahlung anlegen',
        icon: '+',
        onClick: () => showCommonEditor()
      },
      {
        title: 'Persönliche Ausgabe',
        text: 'Benny oder Madeleine auswählen und eintragen',
        icon: '+',
        onClick: () => showPersonalQuickAddModal()
      },
      {
        title: 'Sonstige Ausgabe',
        text: 'Einmalige Ausgabe für den Monat erfassen',
        icon: '+',
        onClick: () => showBufferExpenseEditor()
      },
      {
        title: 'Einkauf eintragen',
        text: 'Ausgabe aus dem Einkaufsgeld erfassen',
        icon: '▤',
        onClick: () => showGroceryExpenseEditor()
      },
      {
        title: 'Tankgeld',
        text: 'Kilometerstände, Bons und Monatswerte prüfen',
        icon: '⌁',
        onClick: () => switchSection('tankcalc')
      },
      {
        title: 'Datencheck',
        text: 'Auffälligkeiten und offene Aufgaben prüfen',
        icon: '✓',
        tone: 'soft-action',
        onClick: () => switchSection('datacheck')
      },
      {
        title: 'Sicherung',
        text: 'Backup erstellen oder Daten importieren',
        icon: '↧',
        tone: 'soft-action',
        onClick: () => switchSection('save')
      }
    ];
  }

  function showQuickCaptureModal() {
    const content = createUiEl('div', 'quick-capture-modal');
    content.appendChild(createGuidedFormIntro(
      'Schnell erfassen',
      `Direkt für ${formatMonthLabel(currentMonth)}. Wähle einfach, was du eintragen oder prüfen möchtest.`
    ));
    const grid = createUiEl('div', 'overview-quickstart-actions quick-capture-grid');
    content.appendChild(grid);

    const modal = showModal('Schnell erfassen', content, [
      { label: 'Schließen', className: 'secondary' }
    ]);
    getQuickCaptureActions().forEach((action) => {
      grid.appendChild(createQuickActionButton(action, modal.close));
    });
  }

  function createOverviewQuickStartCard(details) {
    const card = createUiEl('div', 'card overview-quickstart-card');
    const head = createUiEl('div', 'overview-quickstart-head');
    const copy = createUiEl('div', 'overview-quickstart-copy');
    copy.appendChild(createUiEl('span', 'eyebrow', 'Schnellstart'));
    copy.appendChild(createUiEl('h3', '', 'Was möchtest du eintragen?'));
    const hint = details && Number(details.free || 0) < 0
      ? 'Der Monat ist eng. Trage zuerst Einkommen und offene Zahlungen sauber nach.'
      : 'Die wichtigsten Eingaben erreichst du direkt von hier aus.';
    copy.appendChild(createUiEl('p', '', hint));
    head.appendChild(copy);
    const monthBadge = createUiEl('div', 'overview-quickstart-month', formatMonthLabel(currentMonth));
    head.appendChild(monthBadge);
    card.appendChild(head);

    const actions = createUiEl('div', 'overview-quickstart-actions');
    getQuickCaptureActions().forEach((action) => {
      actions.appendChild(createQuickActionButton(action));
    });

    card.appendChild(actions);
    return card;
  }

  function getMonthStatusText(status, details) {
    if (status.kind === 'danger' && details.free < 0) return 'Sofort prüfen: Der Monat ist rechnerisch im Minus.';
    if (Number(details.miscOpen || 0) > 0) return 'Konservativ gerechnet: offene sonstige Ausgaben sind im freien Betrag schon abgezogen.';
    if (status.kind === 'danger') return 'Sehr wenig Luft. Sonstige Ausgaben und offene Zahlungen prüfen.';
    if (status.kind === 'warning') return 'Planbar, aber eng. Rücklagen erst nach Monatsabschluss buchen.';
    return 'Stabiler Monat. Offene Zahlungen kontrollieren und danach abschließen.';
  }

  function renderMonthStatusPanel(monthKey, details) {
    const status = getFinanceStatus(details.free);
    const debtPlan = getDebtPlanForMonth(monthKey);
    const warnings = getMonthWarnings(monthKey).filter((item) => item.kind === 'danger' || item.kind === 'warning');
    const closed = isMonthClosed(monthKey);
    const panel = createUiEl('div', `month-status-panel ${status.kind}`);

    const main = createUiEl('div', 'month-status-main');
    const icon = createUiEl('div', 'month-status-icon', status.kind === 'success' ? '✓' : '!');
    main.appendChild(icon);
    const text = createUiEl('div', 'month-status-copy');
    const title = document.createElement('h3');
    title.textContent = `${formatMonthLabel(monthKey)} · ${status.label}`;
    const sub = createUiEl('p', '', getMonthStatusText(status, details));
    text.appendChild(title);
    text.appendChild(sub);
    main.appendChild(text);
    panel.appendChild(main);

    const facts = createUiEl('div', 'month-status-facts');
    [
      ['Sicher frei', euro(details.free), details.free >= 0 ? 'success' : 'danger'],
      ['Offen', euro((details.miscOpen || 0) + (debtPlan.open || 0)), ((details.miscOpen || 0) + (debtPlan.open || 0)) > 0 ? 'warning' : 'success'],
      ['Abschluss', closed ? 'erledigt' : 'offen', closed ? 'success' : 'warning']
    ].forEach(([label, value, kind]) => {
      const item = createUiEl('div', `month-status-fact ${kind}`);
      item.appendChild(createUiEl('span', '', label));
      item.appendChild(createUiEl('strong', '', value));
      facts.appendChild(item);
    });
    panel.appendChild(facts);

    const actions = createUiEl('div', 'month-status-actions');
    actions.appendChild(createJumpButton('Sonstige prüfen', 'buffer'));
    actions.appendChild(createJumpButton('Schuldenplan', 'debts'));
    actions.appendChild(createJumpButton(closed ? 'Abschluss ansehen' : 'Monat abschließen', 'monthclose', 'primary compact'));
    panel.appendChild(actions);

    if (warnings.length) {
      const warningLine = createUiEl('div', 'month-status-warningline');
      warningLine.textContent = warnings.slice(0, 2).map((item) => item.text).join(' · ');
      panel.appendChild(warningLine);
    }
    return panel;
  }

  function renderForecastTimelineCard(months, hasScenario, projectionMap) {
    const card = createUiEl('div', 'forecast-timeline-card');
    const head = createUiEl('div', 'forecast-timeline-head');
    const title = document.createElement('h3');
    title.textContent = 'Prognose-Zeitstrahl';
    const sub = createUiEl('p', 'small muted', hasScenario ? 'Mit deinen Was-wäre-wenn-Werten gerechnet.' : 'Auf Basis deiner gespeicherten Daten gerechnet.');
    head.appendChild(title);
    head.appendChild(sub);
    card.appendChild(head);

    const track = createUiEl('div', 'forecast-timeline-track');
    months.forEach(({ key, label }) => {
      const rawDetails = hasScenario ? computeMonthDetailsWithScenario(key) : computeMonthDetails(key);
      const details = applyDebtProjectionToForecastDetails(rawDetails, key, projectionMap);
      const status = getFinanceStatus(details.free);
      const item = createUiEl('div', `forecast-timeline-item ${status.kind}`);
      item.appendChild(createUiEl('strong', '', label.replace(' ', '\n')));
      item.appendChild(createUiEl('span', '', euro(details.free)));
      const bar = createUiEl('div', 'forecast-mini-bar');
      const max = Math.max(details.totalIncome || 1, 1);
      const used = Math.min(100, Math.max(4, ((details.totalCommonRounded + details.totalPersonal + (details.miscPlanned || details.miscPaid || 0)) / max) * 100));
      const fill = createUiEl('i');
      fill.style.width = `${used.toFixed(0)}%`;
      bar.appendChild(fill);
      item.appendChild(bar);
      track.appendChild(item);
    });
    card.appendChild(track);
    return card;
  }

  function createReceiptRow(label, value, kind = '') {
    const row = createUiEl('div', `receipt-row ${kind}`.trim());
    row.appendChild(createUiEl('span', '', label));
    row.appendChild(createUiEl('strong', '', value));
    return row;
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

  function roundMoney(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return 0;
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  function getDistributableAmountFromFree(free) {
    return roundMoney(Math.max(0, Number(free || 0) - Number(savingsConfig.minFree || 0)));
  }

  function computeMonthlyBudgetDetails(monthKey, options = {}) {
    const incomeResolver = typeof options.incomeResolver === 'function'
      ? options.incomeResolver
      : (person) => getPersonNet(person, monthKey);
    const personsData = state.persons.map((p) => ({
      person: p,
      income: roundMoney(incomeResolver(p)),
      commonShare: 0,
      personalDue: 0
    }));
    let totalCommonRaw = 0;
    state.commonCosts.forEach((c) => {
      if (isPostActiveInMonth(c, monthKey)) totalCommonRaw += getCommonMonthlyShare(c, monthKey);
    });
    const shareMap = computeRoundedCommonShares(
      totalCommonRaw,
      personsData.map((pd) => ({ person: pd.person, income: pd.income })),
      monthKey
    );
    personsData.forEach((pd) => { pd.commonShare = shareMap[pd.person.id] || 0; });
    let unassignedPersonalDue = 0;
    state.personalCosts.forEach((pc) => {
      if (!isDue(pc, monthKey)) return;
      const amount = getEffectiveAmountForMonth(pc, monthKey);
      if (pc.personId) {
        const pd = personsData.find((x) => x.person.id === pc.personId);
        if (pd) {
          pd.personalDue += amount;
          return;
        }
      }
      // Sicherheitsnetz: Posten ohne gültige Person werden trotzdem vom freien Betrag abgezogen,
      // damit der Monatsrest nicht zu hoch wirkt.
      unassignedPersonalDue += amount;
    });
    personsData.forEach((pd) => {
      pd.income = roundMoney(pd.income);
      pd.commonShare = roundMoney(pd.commonShare);
      pd.personalDue = roundMoney(pd.personalDue);
    });
    const totalIncome = roundMoney(personsData.reduce((sum, pd) => sum + pd.income, 0));
    const totalCommonRounded = roundMoney(Object.values(shareMap).reduce((sum, val) => sum + val, 0));
    const totalPersonalAssigned = roundMoney(personsData.reduce((sum, pd) => sum + pd.personalDue, 0));
    const totalPersonal = roundMoney(totalPersonalAssigned + unassignedPersonalDue);
    const miscPaid = roundMoney(getBufferExpenseSumForMonth(monthKey));
    const miscPlanned = roundMoney(getBufferExpensePlannedSumForMonth(monthKey));
    const miscOpen = roundMoney(Math.max(miscPlanned - miscPaid, 0));
    const freeBeforeMisc = roundMoney(totalIncome - totalCommonRounded - totalPersonal);
    const freeCurrent = roundMoney(freeBeforeMisc - miscPaid);
    const freeConservative = roundMoney(freeBeforeMisc - miscPlanned);
    const free = freeConservative;
    const distributable = getDistributableAmountFromFree(free);
    const reserves = distributable * savingsConfig.reservesRatio;
    const savings = distributable * savingsConfig.savingsRatio;
    return {
      personsData,
      totalIncome,
      totalCommonRounded,
      totalPersonal,
      totalPersonalAssigned,
      unassignedPersonalDue: roundMoney(unassignedPersonalDue),
      miscPaid,
      miscPlanned,
      miscOpen,
      freeBeforeMisc,
      freeCurrent,
      freeConservative,
      freePendingAdjustment: miscOpen,
      free,
      distributable: roundMoney(distributable),
      reserves: roundMoney(reserves),
      savings: roundMoney(savings),
      distributionBuffer: roundMoney(Number(savingsConfig.minFree || 0)),
      keptFreeBuffer: roundMoney(Math.max(0, Math.min(free, Number(savingsConfig.minFree || 0))))
    };
  }

  function computeFreeSumForMonth(monthKey) {
    return computeMonthDetails(monthKey).free;
  }

  function computeMonthDetails(monthKey) {
    return computeMonthlyBudgetDetails(monthKey);
  }



  function computeMonthDetailsWithScenario(monthKey) {
    return computeMonthlyBudgetDetails(monthKey, { incomeResolver: (p) => {
      const raw = scenarioNet[p.id];
      return (raw !== '' && raw != null && Number.isFinite(Number(raw))) ? Number(raw) : getPersonNet(p, monthKey);
    }});
  }

  function addChangeLog(type, text, monthKey = currentMonth) {
    if (!Array.isArray(state.changeLog)) state.changeLog = [];
    state.changeLog.unshift({ id: generateId(), type: type || 'Änderung', text: text || '', month: monthKey, createdAt: new Date().toISOString() });
    state.changeLog = state.changeLog.slice(0, 80);
  }


  function getMonthKeyFromDateValue(dateValue, fallbackMonth = currentMonth) {
    const match = String(dateValue || '').match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}` : (isMonthKey(fallbackMonth) ? fallbackMonth : dateToMonthKey(new Date()));
  }

  function getTaxRefundOverallSummary() {
    const refunds = Array.isArray(state.taxRefunds) ? state.taxRefunds : [];
    const received = refunds.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const spent = refunds.reduce((sum, item) => sum + (item.purchases || []).reduce((pSum, purchase) => pSum + Number(purchase.amount || 0), 0), 0);
    const entries = refunds.reduce((sum, item) => sum + (item.purchases || []).length, 0);
    const remaining = received - spent;
    const boundRemaining = refunds.reduce((sum, refund) => {
      const refundSpent = (refund.purchases || []).reduce((pSum, purchase) => pSum + Number(purchase.amount || 0), 0);
      return sum + Math.max(Number(refund.amount || 0) - refundSpent, 0);
    }, 0);
    return { received, spent, remaining, boundRemaining, entries, refunds };
  }

  function getTaxRefundSuspiciousEntries(year = '') {
    const refunds = Array.isArray(state.taxRefunds) ? state.taxRefunds : [];
    const allPurchases = [];
    refunds.forEach((refund) => {
      (refund.purchases || []).forEach((purchase) => {
        allPurchases.push({ refund, purchase, amount: Number(purchase.amount || 0) });
      });
    });
    return refunds
      .filter((refund) => !year || String(refund.year) === String(year))
      .map((refund) => {
        const amount = Number(refund.amount || 0);
        if (!(amount > 0) || (refund.purchases || []).length > 0 || amount > 100) return null;
        const match = allPurchases.find((row) => row.refund && row.refund.id !== refund.id && String(row.refund.year) === String(refund.year) && Math.abs(row.amount - amount) < 0.005);
        if (!match) return null;
        return {
          refund,
          amount,
          matchingRefund: match.refund,
          matchingPurchase: match.purchase
        };
      })
      .filter(Boolean);
  }

  function createStandaloneMonthPicker(initialMonth = currentMonth) {
    const selected = isMonthKey(initialMonth) && initialMonth >= APP_FIRST_DATA_MONTH ? initialMonth : currentMonth;
    const [initialYear, initialMonthNo] = String(selected).split('-');
    const wrapper = document.createElement('div');
    wrapper.className = 'month-year-picker standalone-month-picker';
    const monthSelect = document.createElement('select');
    monthSelect.setAttribute('aria-label', 'Monat auswählen');
    const yearSelect = document.createElement('select');
    yearSelect.setAttribute('aria-label', 'Jahr auswählen');
    const actualYear = Number(dateToMonthKey(new Date()).slice(0, 4));
    const maxYear = actualYear + APP_FUTURE_YEAR_RANGE;
    Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      const label = new Date(2000, index, 1).toLocaleDateString('de-DE', { month: 'long' });
      return { month, label: label.charAt(0).toUpperCase() + label.slice(1) };
    }).forEach(({ month, label }) => {
      const opt = document.createElement('option');
      opt.value = month;
      opt.textContent = label;
      if (`${initialYear}-${month}` < APP_FIRST_DATA_MONTH) opt.disabled = true;
      if (month === initialMonthNo) opt.selected = true;
      monthSelect.appendChild(opt);
    });
    for (let y = Number(APP_FIRST_DATA_MONTH.slice(0, 4)); y <= maxYear; y += 1) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      if (String(y) === initialYear) opt.selected = true;
      yearSelect.appendChild(opt);
    }
    Object.defineProperty(wrapper, 'value', {
      configurable: true,
      get() {
        const key = `${yearSelect.value}-${monthSelect.value}`;
        return key < APP_FIRST_DATA_MONTH ? APP_FIRST_DATA_MONTH : key;
      }
    });
    const emit = () => wrapper.dispatchEvent(new Event('change', { bubbles: true }));
    monthSelect.addEventListener('change', emit);
    yearSelect.addEventListener('change', emit);
    wrapper.appendChild(monthSelect);
    wrapper.appendChild(yearSelect);
    return wrapper;
  }

  function confirmClosedMonthChange(monthKey, actionText) {
    if (!isMonthClosed(monthKey)) return true;
    return confirm(`${formatMonthLabel(monthKey)} ist bereits abgeschlossen. ${actionText || 'Änderung'} trotzdem durchführen?`);
  }

  function getPrimaryTaxRefund() {
    normalizeAllTaxRefunds();
    return (state.taxRefunds || [])[0] || null;
  }

  function buildTaxRefundSelect(selectedId = '') {
    normalizeAllTaxRefunds();
    const select = document.createElement('select');
    (state.taxRefunds || []).forEach((refund) => {
      const summarySpent = (refund.purchases || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const remaining = Number(refund.amount || 0) - summarySpent;
      const opt = document.createElement('option');
      opt.value = refund.id;
      opt.textContent = `${refund.year} · Rest ${euro(remaining)}`;
      if (refund.id === selectedId) opt.selected = true;
      select.appendChild(opt);
    });
    return select;
  }

  function removeAllPostAccountBookings(postId) {
    if (!postId) return false;
    const prefix = `post:${postId}:`;
    let removed = false;
    (state.accounts || []).forEach((account) => {
      if (!Array.isArray(account.transactions)) return;
      const before = account.transactions.length;
      account.transactions = account.transactions.filter((tx) => !(tx && typeof tx.sourceId === 'string' && tx.sourceId.startsWith(prefix)));
      if (account.transactions.length !== before) removed = true;
    });
    if (Array.isArray(state.accountTransfers)) {
      const transferred = state.accountTransfers.filter((transfer) => transfer && typeof transfer.sourceId === 'string' && transfer.sourceId.startsWith(prefix));
      transferred.forEach((transfer) => {
        (state.accounts || []).forEach((account) => {
          if (!Array.isArray(account.transactions)) return;
          account.transactions = account.transactions.filter((tx) => tx && tx.id !== transfer.outTransactionId && tx.id !== transfer.inTransactionId);
        });
      });
      if (transferred.length) {
        state.accountTransfers = state.accountTransfers.filter((transfer) => !(transfer && typeof transfer.sourceId === 'string' && transfer.sourceId.startsWith(prefix)));
        removed = true;
      }
    }
    return removed;
  }

  function transferTaxPurchaseToBuffer(refund, purchase, targetMonth, markPaid, noteText = '') {
    if (!refund || !purchase || !isMonthKey(targetMonth)) return false;
    if (!confirmClosedMonthChange(targetMonth, 'Die Ausgabe wird in diesen Monat umgebucht.')) return false;
    const amount = Number(purchase.amount || 0);
    const name = purchase.name || 'Umbuchung Steuererstattung';
    removeTaxRefundPurchaseBooking(refund, purchase);
    refund.purchases = (refund.purchases || []).filter((item) => item.id !== purchase.id);
    if (!Array.isArray(state.bufferExpenses)) state.bufferExpenses = [];
    const post = {
      id: generateId(),
      name,
      amount,
      interval: 1,
      startMonth: targetMonth,
      endMonth: targetMonth,
      oneTime: true,
      paidMonths: markPaid ? [targetMonth] : [],
      amountTimeline: [],
      amountOverrides: {},
      linkedDebtId: '',
      transferMeta: {
        from: 'taxRefund',
        refundId: refund.id,
        originalPurchaseId: purchase.id,
        originalDate: purchase.date || '',
        movedAt: new Date().toISOString()
      }
    };
    if (noteText || purchase.note) post.note = [noteText, purchase.note].filter(Boolean).join(' · ');
    state.bufferExpenses.push(post);
    addChangeLog('Umbuchung', `${name}: ${euro(amount)} von Steuererstattung zu Sonstige Ausgaben ${formatMonthLabel(targetMonth)} verschoben`, targetMonth);
    return true;
  }

  function transferBufferToTaxRefund(post, refund, dateValue = '', noteText = '') {
    if (!post || !refund) return false;
    const targetMonth = getMonthKeyFromDateValue(dateValue, currentMonth);
    if (!confirmClosedMonthChange(targetMonth, 'Die Ausgabe wird in die Steuererstattung umgebucht.')) return false;
    const amount = Number(getEffectiveAmountForMonth(post, targetMonth) || post.amount || 0);
    // Die Ausgabe wechselt den fachlichen Bereich. Ein vorhandener alter
    // Konten-Nachweis darf nicht neben dem Steuererstattungs-Nachweis stehen bleiben.
    removeAllPostAccountBookings(post.id);
    (post.paidMonths || []).forEach((paidMonth) => syncSavingsGoalFromPost(post, paidMonth, false));
    if (!Array.isArray(refund.purchases)) refund.purchases = [];
    refund.purchases.push({
      id: generateId(),
      name: post.name || 'Umbuchung Sonstige Ausgabe',
      amount,
      date: dateValue || `${targetMonth}-01`,
      note: noteText || `Aus Sonstige Ausgaben umgebucht (${formatMonthLabel(currentMonth)})`,
      transferMeta: { from: 'bufferExpense', postId: post.id, movedAt: new Date().toISOString() }
    });
    state.bufferExpenses = (state.bufferExpenses || []).filter((item) => item.id !== post.id);
    normalizeAllTaxRefunds();
    addChangeLog('Umbuchung', `${post.name}: ${euro(amount)} von Sonstige Ausgaben zur Steuererstattung ${refund.year} verschoben`, targetMonth);
    return true;
  }

  function moveBufferExpenseToMonth(post, targetMonth, carryPaid) {
    if (!post || !isMonthKey(targetMonth)) return false;
    if (!confirmClosedMonthChange(targetMonth, 'Die Ausgabe wird in diesen Monat verschoben.')) return false;
    const oldMonth = post.startMonth || currentMonth;
    const bookedInDisplayedMonth = isPostBookedForMonth(post, currentMonth);
    const linkedSavingsPaid = isPostPaidForMonth(post, currentMonth) && !!getLinkedSavingsGoal(post);
    if (bookedInDisplayedMonth) applyPostAccountBooking(post, currentMonth, false);
    if (linkedSavingsPaid) syncSavingsGoalFromPost(post, currentMonth, false);
    ensurePostConfig(post);
    if (post.oneTime === true || post.endMonth) {
      post.startMonth = targetMonth;
      post.endMonth = targetMonth;
      post.interval = 1;
      post.oneTime = true;
    } else {
      post.startMonth = targetMonth;
    }
    if (!carryPaid) post.paidMonths = [];
    else post.paidMonths = (post.paidMonths || []).map(() => targetMonth).filter((m, index, arr) => arr.indexOf(m) === index);
    if (carryPaid && bookedInDisplayedMonth) applyPostAccountBooking(post, targetMonth, true);
    if (carryPaid && linkedSavingsPaid) syncSavingsGoalFromPost(post, targetMonth, true);
    addChangeLog('Sonstige Ausgaben', `${post.name}: von ${formatMonthLabel(oldMonth)} nach ${formatMonthLabel(targetMonth)} verschoben`, targetMonth);
    return true;
  }

  function showTaxPurchaseToBufferModal(refund, purchase) {
    if (!refund || !purchase) return;
    const originalMonth = getMonthKeyFromDateValue(purchase.date, currentMonth);
    const defaultTarget = addMonths(originalMonth, 1);
    const content = document.createElement('div');
    content.innerHTML = `<p class="small muted">Der Kauf wird aus der Steuererstattung entfernt. Dadurch steigt der Rest der Steuererstattung wieder. Gleichzeitig wird eine sonstige Ausgabe im Zielmonat angelegt.</p>`;
    const picker = createStandaloneMonthPicker(defaultTarget);
    content.appendChild(createLabelInput('Zielmonat für Sonstige Ausgaben', picker));
    const paidLabel = document.createElement('label');
    paidLabel.className = 'checkbox-row';
    const paidCheck = document.createElement('input');
    paidCheck.type = 'checkbox';
    paidLabel.appendChild(paidCheck);
    paidLabel.appendChild(document.createTextNode(' Im Zielmonat direkt als bezahlt markieren'));
    content.appendChild(paidLabel);
    const note = document.createElement('textarea');
    note.rows = 3;
    note.placeholder = 'optionale Notiz zur Umbuchung';
    content.appendChild(createLabelInput('Notiz', note));
    showModal('Kauf zu Sonstige Ausgaben verschieben', content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      { label: 'Umbuchen', className: 'primary', onClick: (close) => {
        if (transferTaxPurchaseToBuffer(refund, purchase, picker.value, paidCheck.checked, note.value.trim())) {
          saveState(); render(); close();
        }
      } }
    ]);
  }

  function showBufferMoveMonthModal(post) {
    if (!post) return;
    const content = document.createElement('div');
    content.innerHTML = `<p class="small muted">Verschiebt diese sonstige Ausgabe in einen anderen Monat. Das ist für nachträgliches Hin‑ und Herschieben gedacht.</p>`;
    const picker = createStandaloneMonthPicker(post.startMonth || currentMonth);
    content.appendChild(createLabelInput('Neuer Monat', picker));
    const carry = document.createElement('label');
    carry.className = 'checkbox-row';
    const carryCheck = document.createElement('input');
    carryCheck.type = 'checkbox';
    carryCheck.checked = isPostPaidForMonth(post, currentMonth);
    carry.appendChild(carryCheck);
    carry.appendChild(document.createTextNode(' Bezahlt-Status in den Zielmonat übernehmen'));
    content.appendChild(carry);
    showModal('Sonstige Ausgabe verschieben', content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      { label: 'Verschieben', className: 'primary', onClick: (close) => {
        if (moveBufferExpenseToMonth(post, picker.value, carryCheck.checked)) {
          saveState(); render(); close();
        }
      } }
    ]);
  }

  function showBufferToTaxRefundModal(post) {
    if (!post) return;
    const refund = getPrimaryTaxRefund();
    if (!refund) {
      alert('Bitte zuerst eine Steuererstattung eintragen.');
      return;
    }
    const content = document.createElement('div');
    content.innerHTML = `<p class="small muted">Die Ausgabe wird aus Sonstige Ausgaben entfernt und als Kauf bei einer Steuererstattung dokumentiert.</p>`;
    const select = buildTaxRefundSelect(refund.id);
    content.appendChild(createLabelInput('Steuererstattung', select));
    const date = document.createElement('input');
    date.type = 'date';
    date.value = `${currentMonth}-01`;
    content.appendChild(createLabelInput('Kaufdatum', date));
    const note = document.createElement('textarea');
    note.rows = 3;
    note.placeholder = 'optionale Notiz';
    content.appendChild(createLabelInput('Notiz', note));
    showModal('Sonstige Ausgabe zur Steuererstattung verschieben', content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      { label: 'Umbuchen', className: 'primary', onClick: (close) => {
        const target = (state.taxRefunds || []).find((item) => item.id === select.value) || refund;
        if (transferBufferToTaxRefund(post, target, date.value, note.value.trim())) {
          saveState(); render(); close();
        }
      } }
    ]);
  }

  function getTodoItems(monthKey) {
    const items = [];
    const add = (area, text, section, kind = 'warning') => items.push({ area, text, section, kind });
    const openCommon = (state.commonCosts || []).filter((item) => isDue(item, monthKey) && !isPostPaidForMonth(item, monthKey));
    const openPersonal = (state.personalCosts || []).filter((item) => isDue(item, monthKey) && !isPostPaidForMonth(item, monthKey));
    const openBuffer = (state.bufferExpenses || []).filter((item) => isDue(item, monthKey) && !isPostPaidForMonth(item, monthKey));
    const dueDebts = (state.debts || []).filter((debt) => isDebtOpenForMonth(debt, monthKey));
    if (openCommon.length) add('Gemeinsame Kosten', `${openCommon.length} gemeinsame Zahlung(en) offen`, 'common');
    if (openPersonal.length) add('Persönliche Ausgaben', `${openPersonal.length} persönliche Zahlung(en) offen`, 'personal');
    if (openBuffer.length) add('Sonstige Ausgaben', `${openBuffer.length} sonstige Ausgabe(n) offen`, 'buffer');
    if (dueDebts.length) add('Schulden', `${dueDebts.length} Schuld-Zahlung(en) fällig/offen`, 'debts', 'danger');
    if (!isMonthClosed(monthKey)) add('Monatsabschluss', `${formatMonthLabel(monthKey)} ist noch nicht abgeschlossen`, 'monthclose', 'info');
    const dataWarnings = getDataCheckItems().filter((item) => item.kind === 'warning' || item.kind === 'danger').length;
    if (dataWarnings) add('Datencheck', `${dataWarnings} Datenhinweis(e) prüfen`, 'datacheck', 'warning');
    return items.slice(0, 8);
  }

  function renderTodoCard(monthKey) {
    const items = getTodoItems(monthKey);
    const card = document.createElement('div');
    card.className = 'card compact-card todo-card';
    const h = document.createElement('h3');
    h.textContent = 'Heute / diesen Monat offen';
    card.appendChild(h);
    if (!items.length) {
      const ok = document.createElement('p');
      ok.className = 'small muted';
      ok.textContent = 'Keine offenen Pflichtpunkte für diesen Monat gefunden.';
      card.appendChild(ok);
      return card;
    }
    const list = document.createElement('div');
    list.className = 'todo-list';
    items.forEach((item) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `todo-row ${item.kind || ''}`.trim();
      row.innerHTML = `<span><strong>${item.area}</strong><small>${item.text}</small></span><b>Öffnen</b>`;
      row.addEventListener('click', () => { currentSection = item.section; render(); });
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }


  function renderTaxRefundPotCard() {
    const summary = getTaxRefundOverallSummary();
    const card = document.createElement('div');
    card.className = 'card compact-card tax-pot-card';
    const h = document.createElement('h3');
    h.textContent = 'Steuererstattung als Topf';
    card.appendChild(h);
    card.appendChild(createSummaryMetrics([
      { label: 'Erstattungen gesamt', value: euro(summary.received) },
      { label: 'Bereits zugeordnet', value: euro(summary.spent), kind: summary.spent > 0 ? 'warning' : '' },
      { label: 'Noch frei im Topf', value: euro(summary.remaining), kind: summary.remaining >= 0 ? 'success' : 'danger' },
      { label: 'Gebundener Rest', value: euro(summary.boundRemaining), kind: summary.boundRemaining > 0 ? 'warning' : 'success' },
      { label: 'Käufe / Zuordnungen', value: String(summary.entries) }
    ]));
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = 'Käufe aus der Steuererstattung senken nur den gebundenen Rest und bleiben als Haushaltsnachweis sichtbar.';
    card.appendChild(p);
    return card;
  }


  function renderMonthCompareCard(monthKey) {
    const previousMonth = addMonths(monthKey, -1);
    const card = document.createElement('div');
    card.className = 'card compact-card month-compare-card';
    const h = document.createElement('h3');
    h.textContent = 'Was hat sich geändert?';
    card.appendChild(h);
    if (previousMonth < APP_FIRST_DATA_MONTH) {
      const p = document.createElement('p');
      p.className = 'small muted';
      p.textContent = 'Für den Vormonat gibt es vor dem App-Start keine Vergleichsdaten.';
      card.appendChild(p);
      return card;
    }
    const prev = computeMonthDetails(previousMonth);
    const now = computeMonthDetails(monthKey);
    const rows = [
      ['Sicher verfügbar', now.free - prev.free],
      ['Netto gesamt', now.totalIncome - prev.totalIncome],
      ['Gemeinsame Kosten', now.totalCommonRounded - prev.totalCommonRounded],
      ['Persönliche Ausgaben', now.totalPersonal - prev.totalPersonal],
      ['Sonstige bezahlt', now.miscPaid - prev.miscPaid]
    ];
    const table = document.createElement('table');
    table.className = 'list-table compact-table';
    table.innerHTML = '<thead><tr><th>Bereich</th><th>Änderung zum Vormonat</th></tr></thead>';
    const tbody = document.createElement('tbody');
    rows.forEach(([label, diff]) => {
      const tr = document.createElement('tr');
      const sign = diff > 0 ? '+' : '';
      const goodForFree = label === 'Sicher verfügbar' ? diff >= 0 : diff <= 0;
      tr.innerHTML = `<td>${label}</td><td><span class="pill ${goodForFree ? 'success' : 'warning'}">${sign}${euro(diff)}</span></td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const details = document.createElement('details');
    details.className = 'compact-details data-check-details';
    details.open = false;
    const summary = document.createElement('summary');
    summary.textContent = 'Monatsvergleich anzeigen';
    details.appendChild(summary);
    details.appendChild(table);
    card.appendChild(details);
    return card;
  }

  function getMonthWarnings(monthKey) {
    const warnings = [];
    const unpaidCommon = state.commonCosts.filter((item) => isDue(item, monthKey) && !isPostPaidForMonth(item, monthKey)).length;
    const unpaidPersonal = state.personalCosts.filter((item) => isDue(item, monthKey) && !isPostPaidForMonth(item, monthKey)).length;
    const unpaidDebts = state.debts.filter((d) => isDebtOpenForMonth(d, monthKey)).length;
    const miscOpen = getBufferExpenseOpenSumForMonth(monthKey);
    const free = computeFreeSumForMonth(monthKey);
    if (unpaidCommon > 0) warnings.push({ kind: 'warning', text: `${unpaidCommon} gemeinsame Zahlung(en) noch offen` });
    if (unpaidPersonal > 0) warnings.push({ kind: 'warning', text: `${unpaidPersonal} persönliche Zahlung(en) noch offen` });
    if (unpaidDebts > 0) warnings.push({ kind: 'danger', text: `${unpaidDebts} Schuld(en) diesen Monat noch offen` });
    if (miscOpen > 0) warnings.push({ kind: 'warning', text: `Sonstige Ausgaben offen geplant: ${euro(miscOpen)}` });
    if (free < 0) warnings.push({ kind: 'danger', text: `Monat rechnerisch im Minus: ${euro(free)}` });
    if (!state.monthlyClosings || !state.monthlyClosings[monthKey]) warnings.push({ kind: 'info', text: 'Monatsabschluss noch offen' });
    return warnings;
  }

  function isMonthClosed(monthKey) {
    return !!(state.monthlyClosings && state.monthlyClosings[monthKey]);
  }
  // ----- Zeitliche Auswahl -----
  const today = new Date();
  const actualMonthKey = dateToMonthKey(today);
  normalizeAppMeta();
  // Der Monat aus einem importierten Backup bleibt erhalten. Beim normalen Start
  // wird nicht mehr automatisch auf den echten Kalendermonat umgeschaltet und gespeichert,
  // weil das importierte Sicherungen scheinbar überschrieben wirken lassen konnte.
  const startMonthKey = isMonthKey(state.appMeta.selectedMonth) ? state.appMeta.selectedMonth : actualMonthKey;
  let currentMonth = startMonthKey;
  let monthList = getSelectableMonths(currentMonth);
  normalizeSavingsGoalsConfig();
  if (!isMonthKey(state.appMeta.lastAutoMonthCheck)) {
    state.appMeta.lastAutoMonthCheck = actualMonthKey;
  }
  // Bestehende Installationen werden beim Update nicht rückwirkend verändert.
  // Die automatische Vorbereitung beginnt beim nächsten echten Monatswechsel.
  if (!isMonthKey(state.appMeta.lastPreparedMonth)) {
    state.appMeta.lastPreparedMonth = actualMonthKey;
  }
  const initialDebtRateSyncChanges = syncAllLinkedDebtRatesFromPosts(currentMonth, 36, { silent: true });
  if (initialDebtRateSyncChanges > 0) saveState();
  // ----- DOM-Referenzen -----
  const overviewSection = document.getElementById('overview');
  const monthStartSection = document.getElementById('monthstart');
  const openPaymentsSection = document.getElementById('openpayments');
  const commonSection = document.getElementById('common');
  const sharedAccountSection = document.getElementById('sharedaccount');
  const personalSection = document.getElementById('personal');
  const incomeSection = document.getElementById('income');
  const bufferSection = document.getElementById('buffer');
  const tankCalcSection = document.getElementById('tankcalc');
  const grocerySection = document.getElementById('groceries');
  const debtsSection = document.getElementById('debts');
  const settingsSection = document.getElementById('settings');
  const savingsSection = document.getElementById('savings');
  const potsSection = document.getElementById('pots');
  const monthCloseSection = document.getElementById('monthclose');
  const dataCheckSection = document.getElementById('datacheck');
  const forecastSection = document.getElementById('forecast');
  const saveSection = document.getElementById('save');
  const taxRefundSection = document.getElementById('taxrefund');
  const globalMonthBar = document.getElementById('globalMonthBar');
  const sectionSelect = document.getElementById('sectionSelect');
  const sideMoreSelect = document.getElementById('sideMoreSelect');
  const quickCaptureButton = document.getElementById('quickCaptureButton');
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
  let pendingSearchRenderTimer = null;
  let pendingSearchFocus = null;
  let changeLogFilter = 'all';
  let selectedTaxRefundYear = '';
  let scenarioNet = {};
  let forecastHorizon = 6;
  const runtimeIssues = [];
  let runtimeIssueRenderTimer = null;

  function runtimeErrorMessage(error) {
    if (!error) return 'Unbekannter Fehler';
    if (typeof error === 'string') return error;
    if (error.message) return String(error.message);
    try { return JSON.stringify(error); } catch (err) { return String(error); }
  }

  function scheduleRuntimeIssueRender() {
    if (runtimeIssueRenderTimer) return;
    runtimeIssueRenderTimer = setTimeout(() => {
      runtimeIssueRenderTimer = null;
      try { render(); } catch (error) { console.error('Fehlerwaechter konnte die Ansicht nicht aktualisieren', error); }
    }, 0);
  }

  function recordRuntimeIssue(area, title, error, options = {}) {
    const issue = {
      area: area || 'System',
      title: title || 'Laufzeitfehler',
      message: runtimeErrorMessage(error),
      stack: error && error.stack ? String(error.stack) : '',
      at: new Date().toISOString()
    };
    const key = `${issue.area}|${issue.title}|${issue.message}`;
    const last = runtimeIssues[runtimeIssues.length - 1];
    if (!last || `${last.area}|${last.title}|${last.message}` !== key) {
      runtimeIssues.push(issue);
      if (runtimeIssues.length > 20) runtimeIssues.splice(0, runtimeIssues.length - 20);
    }
    console.error(`${issue.area}: ${issue.title}`, error || issue.message);
    if (options.refresh === true) scheduleRuntimeIssueRender();
    return issue;
  }

  function clearRuntimeIssues() {
    runtimeIssues.splice(0, runtimeIssues.length);
  }

  function renderRuntimeIssueNotice(options = {}) {
    if (!runtimeIssues.length) return null;
    const compact = options.compact === true;
    const latest = runtimeIssues[runtimeIssues.length - 1];
    const card = createUiEl('div', compact ? 'notice danger runtime-issue-card compact' : 'card runtime-issue-card');
    const head = createUiEl('div', 'runtime-issue-head');
    head.appendChild(createUiEl('strong', '', `${runtimeIssues.length} Laufzeitfehler sichtbar`));
    head.appendChild(createUiEl('span', 'pill danger', 'Prüfen'));
    card.appendChild(head);
    card.appendChild(createUiEl('p', 'small muted', `${latest.area}: ${latest.message}`));
    if (!compact) {
      const list = createUiEl('ul', 'runtime-issue-list small');
      runtimeIssues.slice(-5).reverse().forEach((issue) => {
        list.appendChild(createUiEl('li', '', `${issue.area}: ${issue.message}`));
      });
      card.appendChild(list);
    }
    const actions = createUiEl('div', 'button-row compact');
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'primary compact';
    openBtn.textContent = 'Datencheck öffnen';
    openBtn.addEventListener('click', () => switchSection('datacheck'));
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'secondary compact';
    clearBtn.textContent = 'Ausblenden';
    clearBtn.title = 'Blendet nur die aktuellen Laufzeitfehler aus. Neue Fehler erscheinen wieder.';
    clearBtn.addEventListener('click', () => {
      if (!confirm('Aktuelle Laufzeitfehler ausblenden? Neue Fehler werden wieder angezeigt.')) return;
      clearRuntimeIssues();
      render();
    });
    actions.appendChild(openBtn);
    actions.appendChild(clearBtn);
    card.appendChild(actions);
    return card;
  }

  function appendActiveRuntimeIssueNotice(sectionEl) {
    if (!runtimeIssues.length || !sectionEl) return;
    if (currentSection === 'overview' || currentSection === 'datacheck') return;
    const existing = sectionEl.querySelector('.runtime-issue-card');
    if (existing) return;
    const notice = renderRuntimeIssueNotice({ compact: true });
    if (notice) sectionEl.insertBefore(notice, sectionEl.firstChild || null);
  }

  if (stateLoadFailed) {
    recordRuntimeIssue('Speicher', 'Gespeicherter Zustand konnte nicht geladen werden', stateLoadError || 'Die App nutzt vorerst sichere Standarddaten.');
  }

  if (typeof window !== 'undefined') {
    if (window.__budgetRuntimeWatchInstalled !== APP_VERSION) {
      window.__budgetRuntimeWatchInstalled = APP_VERSION;
      window.addEventListener('error', (event) => {
        recordRuntimeIssue('System', 'Browserfehler', event && (event.error || event.message), { refresh: true });
      });
      window.addEventListener('unhandledrejection', (event) => {
        recordRuntimeIssue('System', 'Asynchroner Fehler', event && event.reason, { refresh: true });
      });
    }
    window.budgetRuntimeWatch = {
      report(area, title, message) {
        recordRuntimeIssue(area || 'Diagnose', title || 'Testfehler', message || 'Manuell gemeldeter Fehler');
        try { render(); } catch (error) {}
        return runtimeIssues.length;
      },
      clear() {
        clearRuntimeIssues();
        try { render(); } catch (error) {}
        return 0;
      },
      count() {
        return runtimeIssues.length;
      }
    };
    try {
      const runtimeProbeParams = new URLSearchParams(window.location.search || '');
      if (runtimeProbeParams.has('runtimeProbe')) {
        recordRuntimeIssue('Diagnose', 'Testfehler', 'Fehlerwaechter-Probe aus URL-Parameter');
      }
    } catch (error) {}
  }
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
    if (sideMoreSelect && Array.from(sideMoreSelect.options).some((option) => option.value === currentSection)) {
      sideMoreSelect.value = currentSection;
    } else if (sideMoreSelect) sideMoreSelect.value = '';
    render();
    requestAnimationFrame(() => {
      const main = document.querySelector('.app-content main');
      if (main) main.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  }
  if (sectionSelect) {
    sectionSelect.addEventListener('change', (e) => switchSection(e.target.value));
  }
  if (sideMoreSelect) {
    sideMoreSelect.addEventListener('change', (e) => {
      if (e.target.value) switchSection(e.target.value);
    });
  }
  sectionButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });
  if (quickCaptureButton) {
    quickCaptureButton.addEventListener('click', showQuickCaptureModal);
  }
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

  function getDefaultShiftForPerson(person) {
    const key = String((person && (person.id || person.name)) || '').toLowerCase();
    if (key.includes('madeleine')) return 250;
    if (key.includes('benny')) return -250;
    return 0;
  }

  function normalizePersonShift(person) {
    if (!person || typeof person !== 'object') return;
    const rawShift = Number(person.shift);
    const activeNet = Number(person.net || 0);
    // Schutz gegen den Fehler aus 1.23: Beim Bearbeiten vom Netto wurde das Netto versehentlich als Verschiebung gespeichert.
    // Ein Ausgleich von mehreren tausend Euro ist bei dieser App unplausibel und erzeugt Anteile über 100 %.
    if (!Number.isFinite(rawShift) || Math.abs(rawShift) > 1000 || (activeNet > 1000 && Math.abs(rawShift - activeNet) < 0.05)) {
      person.shift = getDefaultShiftForPerson(person);
    } else {
      person.shift = rawShift;
    }
  }

  function normalizeAllPersonConfigs() {
    if (Array.isArray(state.persons)) state.persons.forEach(ensurePersonIncomeConfig);
  }
  function ensurePersonIncomeConfig(person) {
    if (!person || typeof person !== 'object') return;
    const numericNet = Number(person.net);
    person.net = Number.isFinite(numericNet) && numericNet >= 0 ? numericNet : 0;
    normalizePersonShift(person);
    if (!person.netOverrides || typeof person.netOverrides !== 'object' || Array.isArray(person.netOverrides)) {
      person.netOverrides = {};
    }
    Object.keys(person.netOverrides).forEach((month) => {
      const value = Number(person.netOverrides[month]);
      if (!isMonthKey(month) || !Number.isFinite(value) || value < 0) delete person.netOverrides[month];
      else person.netOverrides[month] = value;
    });
    if (!person.shiftOverrides || typeof person.shiftOverrides !== 'object' || Array.isArray(person.shiftOverrides)) {
      person.shiftOverrides = {};
    }
    Object.keys(person.shiftOverrides).forEach((month) => {
      const value = Number(person.shiftOverrides[month]);
      if (!isMonthKey(month) || !Number.isFinite(value) || Math.abs(value) > 1000) delete person.shiftOverrides[month];
      else person.shiftOverrides[month] = value;
    });
    if (!person.incomeReceived || typeof person.incomeReceived !== 'object' || Array.isArray(person.incomeReceived)) person.incomeReceived = {};
    Object.keys(person.incomeReceived).forEach((month) => {
      const entry = person.incomeReceived[month];
      if (!isMonthKey(month) || !entry || typeof entry !== 'object') {
        delete person.incomeReceived[month];
      } else {
        entry.accountId = typeof entry.accountId === 'string' ? entry.accountId : '';
        entry.amount = Number.isFinite(Number(entry.amount)) ? Number(entry.amount) : Number(person.net || 0);
        entry.receivedAt = typeof entry.receivedAt === 'string' ? entry.receivedAt : '';
        entry.transactionId = typeof entry.transactionId === 'string' ? entry.transactionId : '';
        entry.balanceApplied = entry.balanceApplied === true;
        entry.balanceAppliedAccountId = typeof entry.balanceAppliedAccountId === 'string' ? entry.balanceAppliedAccountId : '';
        entry.balanceAppliedAmount = Number.isFinite(Number(entry.balanceAppliedAmount))
          ? Number(entry.balanceAppliedAmount)
          : 0;
      }
    });
    if (typeof person.incomeAccountId !== 'string') person.incomeAccountId = '';
    if (!Array.isArray(person.netTimeline)) person.netTimeline = [];
    person.netTimeline = person.netTimeline
      .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)) && Number(entry.amount) >= 0)
      .map((entry) => ({ month: entry.month, amount: Number(entry.amount) }))
      .sort((a, b) => monthDiff(b.month, a.month))
      .filter((entry, index, arr) => arr.findIndex((other) => other.month === entry.month) === index);
  }
  function getActiveNetTimelineEntry(person, month) {
    ensurePersonIncomeConfig(person);
    const timeline = (person.netTimeline || [])
      .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)) && monthDiff(entry.month, month) >= 0)
      .sort((a, b) => a.month.localeCompare(b.month));
    return timeline.length ? timeline[timeline.length - 1] : null;
  }

  function getNextNetTimelineEntry(person, month) {
    ensurePersonIncomeConfig(person);
    return (person.netTimeline || [])
      .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)) && monthDiff(month, entry.month) > 0)
      .sort((a, b) => a.month.localeCompare(b.month))[0] || null;
  }

  function getPersonBaseNetForMonth(person, month) {
    ensurePersonIncomeConfig(person);
    const activeTimeline = getActiveNetTimelineEntry(person, month);
    return activeTimeline ? Number(activeTimeline.amount) : Number(person.net || 0);
  }
  function getPersonNet(person, month) {
    ensurePersonIncomeConfig(person);
    if (person.netOverrides && person.netOverrides[month] != null) {
      return Number(person.netOverrides[month]);
    }
    return getPersonBaseNetForMonth(person, month);
  }
  function getPersonShift(person, month) {
    ensurePersonIncomeConfig(person);
    if (isMonthKey(month) && person.shiftOverrides && person.shiftOverrides[month] != null) {
      return Number(person.shiftOverrides[month]);
    }
    return Number(person.shift || 0);
  }
  function setPersonShiftForMonth(person, month, amount) {
    ensurePersonIncomeConfig(person);
    if (!isMonthKey(month)) return false;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) > 1000) return false;
    person.shiftOverrides[month] = numericAmount;
    return true;
  }
  function clearPersonShiftForMonth(person, month) {
    ensurePersonIncomeConfig(person);
    if (isMonthKey(month)) delete person.shiftOverrides[month];
  }
  function parseMoneyInput(value) {
    if (typeof value === 'number') return value;
    const input = String(value ?? '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/€/g, '');
    const commaPos = input.lastIndexOf(',');
    const dotPos = input.lastIndexOf('.');
    let cleaned = input;
    if (commaPos >= 0 && dotPos >= 0) {
      // The last separator is the decimal separator in formatted amounts.
      cleaned = commaPos > dotPos
        ? input.replace(/\./g, '').replace(',', '.')
        : input.replace(/,/g, '');
    } else if (commaPos >= 0) {
      cleaned = input.replace(/\./g, '').replace(',', '.');
    } else if (dotPos >= 0) {
      cleaned = /\.\d{1,2}$/.test(input) ? input : input.replace(/\./g, '');
    }
    return Number(cleaned);
  }
  function formatNumberInput(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0,00';
    return num.toFixed(2).replace('.', ',');
  }
  function setPersonNetForMonth(person, month, amount, mode) {
    ensurePersonIncomeConfig(person);
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) return false;
    if (mode === 'once') {
      // Ein eingegebener Ist-Wert bleibt auch dann nachvollziehbar, wenn er dem Planwert entspricht.
      person.netOverrides[month] = numericAmount;
      return true;
    }
    if (mode === 'future') {
      delete person.netOverrides[month];
      // Ab diesem Monat dauerhaft: zukünftige dauerhafte Einträge ab diesem Monat ersetzen,
      // damit kein älterer oder späterer Eintrag den neuen Wert wieder überdeckt.
      person.netTimeline = person.netTimeline
        .filter((entry) => entry && isMonthKey(entry.month) && monthDiff(month, entry.month) < 0)
        .filter((entry) => Number.isFinite(Number(entry.amount)) && Number(entry.amount) >= 0);
      person.netTimeline.push({ month, amount: numericAmount });
      person.netTimeline = person.netTimeline
        .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)) && Number(entry.amount) >= 0)
        .sort((a, b) => monthDiff(b.month, a.month))
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
    if (person.netOverrides && person.netOverrides[month] != null) return 'tatsächlich ausgezahlt';
    const activeTimeline = getActiveNetTimelineEntry(person, month);
    if (activeTimeline) {
      return activeTimeline.month === month ? 'Planwert ab diesem Monat' : `Planwert seit ${formatMonthLabel(activeTimeline.month)}`;
    }
    return 'Basis-/Planwert';
  }

  function getPersonIncomeReceivedEntry(person, month) {
    ensurePersonIncomeConfig(person);
    if (!isMonthKey(month)) return null;
    const entry = person.incomeReceived && person.incomeReceived[month];
    return entry && typeof entry === 'object' ? entry : null;
  }

  function isPersonIncomeReceived(person, month) {
    return !!getPersonIncomeReceivedEntry(person, month);
  }

  function getPersonIncomeAccountId(person) {
    ensurePersonIncomeConfig(person);
    if (!ACCOUNTS_ENABLED) {
      person.incomeAccountId = '';
      return '';
    }
    if (person.incomeAccountId && getAccountById(person.incomeAccountId)) return person.incomeAccountId;
    const fallback = getDefaultAccountIdForContext('income', person.id);
    person.incomeAccountId = fallback || '';
    return person.incomeAccountId;
  }

  function findAccountTransaction(account, txId) {
    if (!account || !Array.isArray(account.transactions) || !txId) return null;
    return account.transactions.find((tx) => tx && tx.id === txId) || null;
  }

  function addAccountTransaction(accountId, tx) {
    if (!ACCOUNTS_ENABLED) return null;
    const account = getAccountById(accountId);
    if (!account) return null;
    if (!Array.isArray(account.transactions)) account.transactions = [];
    const id = typeof tx.id === 'string' && tx.id ? tx.id : generateId();
    if (findAccountTransaction(account, id)) return id;
    const amount = Number(tx.amount || 0);
    const affectsBalance = tx.affectsBalance === true;
    account.transactions.push({
      id,
      month: isMonthKey(tx.month) ? tx.month : DEFAULT_TRANSACTION_MONTH,
      date: typeof tx.date === 'string' ? tx.date : new Date().toISOString().slice(0, 10),
      type: typeof tx.type === 'string' ? tx.type : 'manual',
      sourceId: typeof tx.sourceId === 'string' ? tx.sourceId : '',
      label: typeof tx.label === 'string' ? tx.label : 'Buchung',
      amount,
      affectsBalance,
      balanceMode: affectsBalance ? 'bank' : (typeof tx.balanceMode === 'string' ? tx.balanceMode : 'proof'),
      transferId: typeof tx.transferId === 'string' ? tx.transferId : '',
      note: typeof tx.note === 'string' ? tx.note : '',
      createdAt: new Date().toISOString()
    });
    return id;
  }

  function applyAccountBalanceChange(accountId, amount) {
    if (!ACCOUNTS_ENABLED) return false;
    const account = getAccountById(accountId);
    const value = Number(amount || 0);
    if (!account || !Number.isFinite(value) || Math.abs(value) < 0.005) return false;
    account.balance = Number(account.balance || 0) + value;
    if (account.id === DEFAULT_SHARED_ACCOUNT_ID) {
      state.commonAccount.currentBalance = Number(account.balance || 0);
    }
    return true;
  }

  function getAccountTransactionBalanceEffect(tx) {
    if (!tx || tx.affectsBalance !== true) return 0;
    const amount = Number(tx.amount || 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  function removeAccountLedgerTransaction(accountId, txId) {
    if (!ACCOUNTS_ENABLED) return false;
    const account = getAccountById(accountId);
    if (!account || !Array.isArray(account.transactions) || !txId) return false;
    const tx = findAccountTransaction(account, txId);
    if (!tx) return false;
    const effect = getAccountTransactionBalanceEffect(tx);
    if (Math.abs(effect) >= 0.005) applyAccountBalanceChange(accountId, -effect);
    return removeAccountTransaction(accountId, txId);
  }

  function removeAccountLedgerTransactionBySource(sourceId) {
    if (!sourceId) return false;
    const found = findAccountTransactionBySource(sourceId);
    if (!found) return false;
    return removeAccountLedgerTransaction(found.account.id, found.tx.id);
  }

  function applyAccountLedgerTransaction(accountId, tx, options = {}) {
    if (!ACCOUNTS_ENABLED) return null;
    if (!accountId || !getAccountById(accountId) || !tx || !tx.sourceId) return null;
    const amount = Number(tx.amount || 0);
    if (!Number.isFinite(amount)) return null;
    const affectsBalance = options.affectsBalance === false || tx.affectsBalance === false ? false : true;
    const balanceMode = affectsBalance ? 'bank' : (typeof tx.balanceMode === 'string' ? tx.balanceMode : 'proof');
    const existing = findAccountTransactionBySource(tx.sourceId);
    if (existing && existing.account.id !== accountId) {
      removeAccountLedgerTransaction(existing.account.id, existing.tx.id);
    } else if (existing) {
      const previousEffect = getAccountTransactionBalanceEffect(existing.tx);
      const nextEffect = affectsBalance ? amount : 0;
      existing.tx.month = isMonthKey(tx.month) ? tx.month : existing.tx.month;
      existing.tx.date = typeof tx.date === 'string' && tx.date ? tx.date : existing.tx.date;
      existing.tx.type = typeof tx.type === 'string' ? tx.type : existing.tx.type;
      existing.tx.label = typeof tx.label === 'string' ? tx.label : existing.tx.label;
      existing.tx.amount = amount;
      existing.tx.affectsBalance = affectsBalance;
      existing.tx.balanceMode = balanceMode;
      existing.tx.transferId = typeof tx.transferId === 'string' ? tx.transferId : (existing.tx.transferId || '');
      if (typeof tx.note === 'string') existing.tx.note = tx.note;
      const delta = nextEffect - previousEffect;
      if (Math.abs(delta) >= 0.005) applyAccountBalanceChange(accountId, delta);
      return existing.tx.id;
    }
    const txId = addAccountTransaction(accountId, Object.assign({}, tx, { affectsBalance, balanceMode }));
    if (!txId) return null;
    if (affectsBalance && Math.abs(amount) >= 0.005 && !applyAccountBalanceChange(accountId, amount)) {
      removeAccountTransaction(accountId, txId);
      return null;
    }
    return txId;
  }

  function removeAccountTransaction(accountId, txId) {
    const account = getAccountById(accountId);
    if (!account || !Array.isArray(account.transactions) || !txId) return false;
    const idx = account.transactions.findIndex((tx) => tx && tx.id === txId);
    if (idx < 0) return false;
    account.transactions.splice(idx, 1);
    return true;
  }


  function findAccountTransactionBySource(sourceId) {
    if (!sourceId) return null;
    normalizeAccountsConfig(false);
    for (const account of (state.accounts || [])) {
      const tx = (account.transactions || []).find((entry) => entry && entry.sourceId === sourceId);
      if (tx) return { account, tx };
    }
    return null;
  }

  function removeAccountTransactionBySource(sourceId) {
    if (!sourceId) return false;
    const found = findAccountTransactionBySource(sourceId);
    if (!found) return false;
    if (found.tx && found.tx.affectsBalance === true) return removeAccountLedgerTransaction(found.account.id, found.tx.id);
    return removeAccountTransaction(found.account.id, found.tx.id);
  }

  function upsertAccountTransaction(accountId, tx) {
    if (!ACCOUNTS_ENABLED) return null;
    if (!accountId || !getAccountById(accountId) || !tx || !tx.sourceId) return null;
    if (tx.affectsBalance === true) return applyAccountLedgerTransaction(accountId, tx, { affectsBalance: true });
    const amount = Number(tx.amount || 0);
    const existing = findAccountTransactionBySource(tx.sourceId);
    if (existing) {
      if (existing.account.id === accountId && Math.abs(Number(existing.tx.amount || 0) - amount) < 0.005) {
        const previousEffect = getAccountTransactionBalanceEffect(existing.tx);
        if (Math.abs(previousEffect) >= 0.005) applyAccountBalanceChange(existing.account.id, -previousEffect);
        existing.tx.label = tx.label || existing.tx.label;
        existing.tx.month = isMonthKey(tx.month) ? tx.month : existing.tx.month;
        existing.tx.date = tx.date || existing.tx.date;
        existing.tx.type = tx.type || existing.tx.type;
        existing.tx.affectsBalance = false;
        existing.tx.balanceMode = typeof tx.balanceMode === 'string' ? tx.balanceMode : 'proof';
        existing.tx.transferId = typeof tx.transferId === 'string' ? tx.transferId : (existing.tx.transferId || '');
        if (typeof tx.note === 'string') existing.tx.note = tx.note;
        return existing.tx.id;
      }
      if (existing.tx.affectsBalance === true) removeAccountLedgerTransaction(existing.account.id, existing.tx.id);
      else removeAccountTransaction(existing.account.id, existing.tx.id);
    }
    return addAccountTransaction(accountId, Object.assign({}, tx, {
      affectsBalance: false,
      balanceMode: typeof tx.balanceMode === 'string' ? tx.balanceMode : 'proof'
    }));
  }

  function inferAccountIdForPost(post) {
    ensureAccountLinkField(post);
    if (post.accountId && getAccountById(post.accountId)) return post.accountId;
    if ((state.commonCosts || []).includes(post)) return getDefaultAccountIdForContext('common');
    if (post.personId) return getDefaultAccountIdForContext('personal', post.personId);
    return post.accountId || '';
  }

  function getPostAccountTransactionSource(post, month) {
    return post && post.id && isMonthKey(month) ? `post:${post.id}:${month}` : '';
  }

  function applyPostAccountBooking(post, month, paid) {
    if (!ACCOUNTS_ENABLED) return null;
    if (!post || !isMonthKey(month)) return null;
    ensurePostBookingConfig(post);
    const sourceId = getPostAccountTransactionSource(post, month);
    if (!sourceId) return null;
    const transferSourceId = `${sourceId}:transfer`;
    if (!paid) {
      applyPostAccountBalanceDebit(post, month, false);
      removeAccountTransactionBySource(sourceId);
      return null;
    }
    const accountId = inferAccountIdForPost(post);
    if (!accountId) return null;
    post.accountId = accountId;
    const amount = Number(getEffectiveAmountForMonth(post, month) || 0);
    if (!(amount > 0)) return null;
    if (post.bookingType === 'transfer') {
      if (!post.transferToAccountId || !getAccountById(post.transferToAccountId)) {
        alert('Für diese Zahlung ist „Umbuchung“ gewählt, aber kein Zielkonto hinterlegt. Bitte Posten bearbeiten und Zielkonto auswählen.');
        return null;
      }
      return addAccountTransfer(accountId, post.transferToAccountId, amount, post.name || 'Umbuchung', month, '', { sourceId: transferSourceId, label: `${post.name || 'Umbuchung'} ${formatMonthLabel(month)}` });
    }
    deleteAccountTransferBySource(transferSourceId);
    const linkedSavingsGoal = getLinkedSavingsGoal(post);
    if (!linkedSavingsGoal) {
      const existing = findAccountTransactionBySource(sourceId);
      if (existing && existing.tx.affectsBalance === true) return existing.tx.id;
      applyPostAccountBalanceDebit(post, month, true);
      const booked = findAccountTransactionBySource(sourceId);
      return booked ? booked.tx.id : null;
    }
    return upsertAccountTransaction(accountId, {
      month,
      type: 'reserve_deposit',
      sourceId,
      label: `Rücklage ${linkedSavingsGoal.name}: ${post.name || 'Einzahlung'} ${formatMonthLabel(month)}`,
      amount: -amount,
      affectsBalance: false,
      balanceMode: 'proof',
      note: 'Nachweis einer Rücklagen-Zuordnung; der eingegebene Bankstand bleibt unverändert.'
    });
  }


  function isPostBookedForMonth(post, month) {
    if (!ACCOUNTS_ENABLED) return false;
    if (!post || !isMonthKey(month)) return false;
    const sourceId = getPostAccountTransactionSource(post, month);
    return !!findAccountTransactionBySource(sourceId)
      || !!findAccountTransactionBySource(`${sourceId}:transfer`)
      || !!(state.accountTransfers || []).some((tr) => tr && tr.sourceId === `${sourceId}:transfer`);
  }

  function bookPostPaymentForMonth(post, month) {
    ensurePostConfig(post);
    if (!isMonthKey(month)) return false;
    if (!ACCOUNTS_ENABLED) {
      if (!isPostPaidForMonth(post, month)) setPostPaidForMonth(post, month, true);
      return true;
    }
    if (!isPostPaidForMonth(post, month)) setPostPaidForMonth(post, month, true);
    else applyPostAccountBalanceDebit(post, month, true);
    const tx = applyPostAccountBooking(post, month, true);
    if (tx) addChangeLog('Konten', `${post.name || 'Posten'} für ${formatMonthLabel(month)} gebucht.`, month);
    return !!tx;
  }

  function unbookPostPaymentForMonth(post, month) {
    if (!post || !isMonthKey(month)) return false;
    if (!ACCOUNTS_ENABLED) return false;
    applyPostAccountBooking(post, month, false);
    addChangeLog('Konten', `${post.name || 'Posten'}: Kontobuchung für ${formatMonthLabel(month)} entfernt.`, month);
    return true;
  }

  function getDebtAccountTransactionSource(debt, month, historyId = '') {
    if (!debt || !debt.id || !isMonthKey(month)) return '';
    return historyId ? `debt:${debt.id}:${month}:${historyId}` : `debt:${debt.id}:${month}`;
  }

  function getContributionAmountForPerson(month, personId) {
    if (!isMonthKey(month) || !personId) return 0;
    const payment = getCommonAccountContributionPayment(month, personId);
    if (payment && Number(payment.amount || 0) > 0) return roundMoney(Number(payment.amount || 0));
    return getCurrentContributionAmountForPerson(month, personId);
  }

  function applyContributionAccountBooking(month, personId, paid) {
    if (!ACCOUNTS_ENABLED) return null;
    if (!isMonthKey(month) || !personId) return null;
    const sourceId = `contribution:${personId}:${month}`;
    const transferSourceId = `${sourceId}:transfer`;
    if (!paid) {
      const removedTransfer = deleteAccountTransferBySource(transferSourceId);
      const removedLegacy = removeAccountLedgerTransactionBySource(sourceId) || removeAccountTransactionBySource(sourceId);
      return removedTransfer || removedLegacy;
    }
    const shared = getSharedAccount();
    if (!shared) return null;
    const person = getPersonById(personId);
    const payment = lockCommonAccountContributionPayment(month, personId);
    const amount = payment ? Number(payment.amount || 0) : getContributionAmountForPerson(month, personId);
    if (!(amount > 0)) return null;
    const fromAccountId = person ? getPersonIncomeAccountId(person) : '';
    if (!fromAccountId || !getAccountById(fromAccountId)) {
      alert('Für diesen Monatsanteil ist kein Lohn-/Quellkonto hinterlegt. Bitte beim Einkommen ein Lohn-Zielkonto auswählen.');
      return null;
    }
    // Alte Nachweise waren nur ein Plus auf dem Gemeinschaftskonto. Vor der echten Umbuchung entfernen.
    removeAccountLedgerTransactionBySource(sourceId) || removeAccountTransactionBySource(sourceId);
    const booked = addAccountTransfer(fromAccountId, shared.id, amount, `Monatsanteil ${person ? person.name : personId}`, month, '', {
      sourceId: transferSourceId,
      label: `Monatsanteil ${person ? person.name : personId} ${formatMonthLabel(month)}`
    });
    if (booked) lockCommonAccountContributionPayment(month, personId, amount, { source: 'transfer' });
    return booked;
  }

  function isContributionAccountBooked(month, personId) {
    if (!ACCOUNTS_ENABLED) return false;
    return !!(state.accountTransfers || []).some((tr) => tr && tr.sourceId === `contribution:${personId}:${month}:transfer`);
  }

  function normalizeAccountTransfersConfig() {
    if (!state) return;
    if (!Array.isArray(state.accountTransfers)) state.accountTransfers = [];
    state.accountTransfers = state.accountTransfers
      .filter((tr) => tr && typeof tr === 'object')
      .map((tr) => ({
        id: typeof tr.id === 'string' && tr.id ? tr.id : generateId(),
        month: isMonthKey(tr.month) ? tr.month : DEFAULT_TRANSACTION_MONTH,
        date: typeof tr.date === 'string' ? tr.date : '',
        fromAccountId: typeof tr.fromAccountId === 'string' ? tr.fromAccountId : '',
        toAccountId: typeof tr.toAccountId === 'string' ? tr.toAccountId : '',
        amount: Number.isFinite(Number(tr.amount)) ? Math.max(0, Number(tr.amount)) : 0,
        note: typeof tr.note === 'string' ? tr.note : '',
        outTransactionId: typeof tr.outTransactionId === 'string' ? tr.outTransactionId : '',
        inTransactionId: typeof tr.inTransactionId === 'string' ? tr.inTransactionId : '',
        templateId: typeof tr.templateId === 'string' ? tr.templateId : '',
        sourceId: typeof tr.sourceId === 'string' ? tr.sourceId : ''
      }))
      .filter((tr) => tr.amount > 0 && tr.fromAccountId && tr.toAccountId && tr.fromAccountId !== tr.toAccountId);
  }

  function normalizeAccountTransferTemplatesConfig() {
    if (!state) return;
    if (!Array.isArray(state.accountTransferTemplates)) state.accountTransferTemplates = [];
    state.accountTransferTemplates = state.accountTransferTemplates
      .filter((tpl) => tpl && typeof tpl === 'object')
      .map((tpl) => ({
        id: typeof tpl.id === 'string' && tpl.id ? tpl.id : generateId(),
        name: typeof tpl.name === 'string' && tpl.name.trim() ? tpl.name.trim() : 'Umbuchungsvorlage',
        fromAccountId: typeof tpl.fromAccountId === 'string' ? tpl.fromAccountId : '',
        toAccountId: typeof tpl.toAccountId === 'string' ? tpl.toAccountId : '',
        amount: Number.isFinite(Number(tpl.amount)) ? Math.max(0, Number(tpl.amount)) : 0,
        dayOfMonth: Math.min(31, Math.max(1, Math.round(Number(tpl.dayOfMonth || 1)))),
        note: typeof tpl.note === 'string' ? tpl.note : '',
        isMonthly: tpl.isMonthly !== false,
        createdAt: typeof tpl.createdAt === 'string' ? tpl.createdAt : ''
      }))
      .filter((tpl) => tpl.amount > 0 && tpl.fromAccountId && tpl.toAccountId && tpl.fromAccountId !== tpl.toAccountId);
  }

  function addAccountTransfer(fromAccountId, toAccountId, amount, note = '', month = currentMonth, date = '', options = {}) {
    if (!ACCOUNTS_ENABLED) return false;
    normalizeAccountTransfersConfig();
    const value = Number(amount || 0);
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId || !(value > 0)) return false;
    const sourceId = typeof options.sourceId === 'string' ? options.sourceId : '';
    if (sourceId && (state.accountTransfers || []).some((tr) => tr.sourceId === sourceId)) return true;
    const id = generateId();
    const safeMonth = isMonthKey(month) ? month : currentMonth;
    const safeDate = date || new Date().toISOString().slice(0, 10);
    const labelBase = options.label || `Umbuchung ${getAccountName(fromAccountId)} → ${getAccountName(toAccountId)}`;
    const outId = applyAccountLedgerTransaction(fromAccountId, {
      month: safeMonth,
      date: safeDate,
      type: 'transfer_out',
      sourceId: `transfer:${id}:out`,
      label: labelBase,
      amount: -value,
      note,
      transferId: id,
      affectsBalance: true
    });
    const inId = applyAccountLedgerTransaction(toAccountId, {
      month: safeMonth,
      date: safeDate,
      type: 'transfer_in',
      sourceId: `transfer:${id}:in`,
      label: labelBase,
      amount: value,
      note,
      transferId: id,
      affectsBalance: true
    });
    if (!outId || !inId) {
      if (outId) removeAccountLedgerTransaction(fromAccountId, outId);
      if (inId) removeAccountLedgerTransaction(toAccountId, inId);
      return false;
    }
    state.accountTransfers.push({ id, month: safeMonth, date: safeDate, fromAccountId, toAccountId, amount: value, note, outTransactionId: outId, inTransactionId: inId, templateId: options.templateId || '', sourceId });
    addChangeLog('Konten', `${labelBase}: ${euro(value)}.`, safeMonth);
    return true;
  }

  function deleteAccountTransferBySource(sourceId) {
    normalizeAccountTransfersConfig();
    const tr = (state.accountTransfers || []).find((item) => item.sourceId === sourceId);
    if (!tr) return false;
    return deleteAccountTransfer(tr.id);
  }

  function deleteAccountTransfer(transferId) {
    normalizeAccountTransfersConfig();
    const tr = state.accountTransfers.find((item) => item.id === transferId);
    if (!tr) return false;
    removeAccountLedgerTransaction(tr.fromAccountId, tr.outTransactionId);
    removeAccountLedgerTransaction(tr.toAccountId, tr.inTransactionId);
    state.accountTransfers = (state.accountTransfers || []).filter((item) => item.id !== transferId);
    addChangeLog('Konten', `Umbuchung ${euro(tr.amount)} gelöscht.`, tr.month);
    return true;
  }

  function addAccountTransferTemplate(data) {
    normalizeAccountTransferTemplatesConfig();
    const tpl = {
      id: generateId(),
      name: data.name || `${getAccountName(data.fromAccountId)} → ${getAccountName(data.toAccountId)}`,
      fromAccountId: data.fromAccountId || '',
      toAccountId: data.toAccountId || '',
      amount: Math.max(0, Number(data.amount || 0)),
      dayOfMonth: Math.min(31, Math.max(1, Math.round(Number(data.dayOfMonth || 1)))),
      note: data.note || '',
      isMonthly: data.isMonthly !== false,
      createdAt: new Date().toISOString()
    };
    if (!tpl.fromAccountId || !tpl.toAccountId || tpl.fromAccountId === tpl.toAccountId || !(tpl.amount > 0)) return false;
    state.accountTransferTemplates.push(tpl);
    addChangeLog('Konten', `Umbuchungsvorlage angelegt: ${tpl.name} · ${euro(tpl.amount)}.`, currentMonth);
    return true;
  }

  function deleteAccountTransferTemplate(templateId) {
    normalizeAccountTransferTemplatesConfig();
    const before = state.accountTransferTemplates.length;
    state.accountTransferTemplates = state.accountTransferTemplates.filter((tpl) => tpl.id !== templateId);
    return state.accountTransferTemplates.length !== before;
  }

  function wasTemplateTransferredInMonth(templateId, monthKey) {
    return (state.accountTransfers || []).some((tr) => tr.templateId === templateId && tr.month === monthKey);
  }

  function addAccountTransferFromTemplate(templateId, monthKey = currentMonth) {
    normalizeAccountTransferTemplatesConfig();
    const tpl = state.accountTransferTemplates.find((item) => item.id === templateId);
    if (!tpl) return false;
    if (wasTemplateTransferredInMonth(templateId, monthKey)) return false;
    const date = `${monthKey}-${String(tpl.dayOfMonth || 1).padStart(2, '0')}`;
    const ok = addAccountTransfer(tpl.fromAccountId, tpl.toAccountId, tpl.amount, tpl.note || tpl.name, monthKey, date);
    if (ok) {
      const transfer = (state.accountTransfers || [])[state.accountTransfers.length - 1];
      if (transfer) transfer.templateId = tpl.id;
      addChangeLog('Konten', `Umbuchungsvorlage ausgeführt: ${tpl.name} · ${euro(tpl.amount)}.`, monthKey);
    }
    return ok;
  }

  function getTransferAccountWarning(fromAccountId, amount) {
    const account = getAccountById(fromAccountId);
    if (!account) return '';
    if (!(Number(amount || 0) > 0)) return '';
    return `Die Umbuchung verändert ${account.name} und das Zielkonto genau einmal und legt dazu passende Verlaufseinträge an.`;
  }

  function showAccountTransactions(account) {
    const content = document.createElement('div');
    content.className = 'modal-form';
    const rows = (account.transactions || []).slice().sort((a, b) => (b.month || '').localeCompare(a.month || '') || (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'small muted';
      empty.textContent = 'Für dieses Konto gibt es noch keine Buchungen.';
      content.appendChild(empty);
    } else {
      const table = document.createElement('table');
      table.className = 'list-table compact-table';
      table.innerHTML = '<thead><tr><th>Monat</th><th>Datum</th><th>Buchung</th><th>Betrag</th></tr></thead>';
      const body = document.createElement('tbody');
      rows.forEach((tx) => {
        const tr = document.createElement('tr');
        const cls = Number(tx.amount || 0) >= 0 ? 'success-text' : 'danger-text';
        const noteHtml = tx.note ? `<div class="small muted">${tx.note}</div>` : '';
        tr.innerHTML = `<td>${formatMonthLabel(tx.month)}</td><td>${tx.date || '-'}</td><td>${tx.label || 'Buchung'}<div class="small muted">${tx.type || ''}</div>${noteHtml}</td><td class="${cls}">${euro(tx.amount)}</td>`;
        body.appendChild(tr);
      });
      table.appendChild(body);
      content.appendChild(table);
    }
    showModal(`Buchungen · ${account.name}`, content, [{ label: 'Schließen', className: 'secondary' }]);
  }


  function showAccountReconcileEditor(account) {
    if (!account || !account.id) return;
    const currentBalance = Number(account.balance || 0);
    const availability = getAccountAvailability(account, currentMonth);
    const content = document.createElement('div');
    content.className = 'modal-form';
    const intro = document.createElement('div');
    intro.className = 'notice success';
    intro.innerHTML = `<strong>Kontenabgleich</strong><br>Trage den echten Bank-Kontostand ein. Die App speichert den echten Bankstand als Kontostand und legt die Differenz nur als Nachweis in der Buchungshistorie ab.`;
    content.appendChild(intro);

    const row = document.createElement('div');
    row.className = 'row';
    const appBalance = document.createElement('div');
    appBalance.className = 'metric-card compact-metric';
    appBalance.innerHTML = `<span>App-Kontostand</span><strong>${euro(currentBalance)}</strong>`;
    const realInput = document.createElement('input');
    realInput.type = 'text';
    realInput.inputMode = 'decimal';
    realInput.value = formatNumberInput(currentBalance);
    row.appendChild(appBalance);
    row.appendChild(createLabelInput('Echter Kontostand laut Bank', realInput));
    content.appendChild(row);

    const explanation = createUiEl('div', 'sub-card account-reconcile-breakdown');
    explanation.appendChild(createUiEl('h3', '', 'Warum der freie Betrag abweichen kann'));
    explanation.appendChild(createSummaryMetrics([
      { label: 'Echter Bankstand', value: euro(availability.balance) },
      { label: 'Gebunden', value: euro(availability.bound), kind: availability.bound > 0.005 ? 'warning' : 'success' },
      { label: 'Offen geplant', value: euro(availability.open), kind: availability.open > 0.005 ? 'warning' : 'success' },
      { label: 'Nur Status', value: euro(availability.paidUnbooked), hint: 'bezahlt markiert, aber kein eindeutiger Kontonachweis' },
      { label: availability.missing > 0.005 ? 'Fehlt' : 'Verfügbar', value: euro(availability.missing > 0.005 ? availability.missing : availability.available), kind: availability.missing > 0.005 ? 'danger' : 'success' }
    ]));
    const parts = [
      availability.manualBound > 0.005 ? `manuell gebunden ${euro(availability.manualBound)}` : '',
      availability.taxRefundBound > 0.005 ? `Steuererstattung ${euro(availability.taxRefundBound)}` : '',
      availability.intervalReserveBound > 0.005 ? `Intervall-Rücklagen ${euro(availability.intervalReserveBound)}` : '',
      availability.savingsGoalBound > 0.005 ? `verknüpfte Rücklagen ${euro(availability.savingsGoalBound)}` : ''
    ].filter(Boolean);
    if (parts.length) {
      explanation.appendChild(createUiEl('p', 'small muted', `Gebunden setzt sich zusammen aus: ${parts.join(', ')}.`));
    }
    if ((availability.rows || []).length || (availability.paidUnbookedRows || []).length) {
      const list = createUiEl('ul', 'small muted');
      (availability.rows || []).slice(0, 6).forEach((rowItem) => {
        list.appendChild(createUiEl('li', '', `offen: ${rowItem.name || 'Posten'} ${euro(rowItem.amount)}${rowItem.accountName ? ` (${rowItem.accountName})` : ''}`));
      });
      (availability.paidUnbookedRows || []).slice(0, 6).forEach((rowItem) => {
        list.appendChild(createUiEl('li', '', `nur Status: ${rowItem.name || 'Posten'} ${euro(rowItem.amount)}`));
      });
      explanation.appendChild(list);
    }
    content.appendChild(explanation);

    const row2 = document.createElement('div');
    row2.className = 'row';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = new Date().toISOString().slice(0, 10);
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = 'z. B. Rundung, vergessene Kartenzahlung, Bankabgleich';
    row2.appendChild(createLabelInput('Datum', dateInput));
    row2.appendChild(createLabelInput('Grund / Notiz', noteInput));
    content.appendChild(row2);

    const diffBox = document.createElement('div');
    diffBox.className = 'notice';
    content.appendChild(diffBox);
    const updateDiff = () => {
      const real = parseMoneyInput(realInput.value);
      if (!Number.isFinite(real)) {
        diffBox.className = 'notice warning';
        diffBox.innerHTML = '<strong>Differenz:</strong> Bitte einen gültigen Kontostand eintragen.';
        return;
      }
      const diff = real - currentBalance;
      const projectedAfter = real - availability.bound - availability.open;
      const projectedText = projectedAfter < -0.005
        ? `Mit diesem Bankstand fehlen nach gebundenen Beträgen und offenen Zahlungen ${euro(Math.abs(projectedAfter))}.`
        : `Mit diesem Bankstand wären nach gebundenen Beträgen und offenen Zahlungen ${euro(projectedAfter)} verfügbar.`;
      diffBox.className = `notice ${Math.abs(diff) < 0.005 ? 'success' : (diff > 0 ? 'success' : 'warning')}`;
      diffBox.innerHTML = `<strong>Differenz:</strong> ${euro(diff)}<br><span class="small muted">${Math.abs(diff) < 0.005 ? 'Keine Ausgleichsbuchung nötig.' : (diff > 0 ? 'Die App bucht eine Gutschrift auf das Konto.' : 'Die App bucht eine Abbuchung vom Konto.')} ${projectedText} Nur-Status-Posten werden dabei nicht ein zweites Mal abgezogen.</span>`;
    };
    realInput.addEventListener('input', updateDiff);
    updateDiff();

    showModal(`Kontostand abgleichen · ${account.name}`, content, [
      { label: 'Abbrechen', className: 'secondary' },
      { label: 'Abgleich speichern', className: 'primary', onClick: (close) => {
        const real = parseMoneyInput(realInput.value);
        if (!Number.isFinite(real)) return alert('Bitte einen gültigen Kontostand eintragen.');
        const currentAccount = getAccountById(account.id);
        if (!currentAccount) return alert('Konto wurde nicht gefunden.');
        const current = Number(currentAccount.balance || 0);
        const diff = real - current;
        const now = new Date().toISOString();
        const note = noteInput.value || '';
        if (Math.abs(diff) >= 0.005) {
          const txId = applyAccountLedgerTransaction(currentAccount.id, {
            month: currentMonth,
            date: dateInput.value || new Date().toISOString().slice(0, 10),
            type: 'reconcile',
            sourceId: `reconcile:${currentAccount.id}:${Date.now()}`,
            label: `Kontenabgleich ${formatMonthLabel(currentMonth)}`,
            amount: diff,
            note,
            affectsBalance: true
          });
          if (!txId) return alert('Der Kontenabgleich konnte nicht gespeichert werden.');
          addChangeLog('Konten', `${currentAccount.name}: Kontenabgleich ${euro(diff)} auf echten Stand ${euro(real)}.`, currentMonth);
        } else {
          addChangeLog('Konten', `${currentAccount.name}: Kontostand geprüft, keine Differenz.`, currentMonth);
        }
        // Das Anlegen der Historienbuchung normalisiert die Kontenliste neu.
        // Deshalb den aktuellen Datensatz danach erneut holen und dort speichern.
        const latest = getAccountById(currentAccount.id);
        if (!latest) return alert('Konto wurde beim Speichern nicht gefunden.');
        latest.balance = real;
        latest.lastReconciledAt = now;
        latest.lastReconciledBalance = real;
        latest.lastReconciledNote = note;
        if (latest.id === DEFAULT_SHARED_ACCOUNT_ID) state.commonAccount.currentBalance = Number(latest.balance || 0);
        saveState();
        close();
        render();
      } }
    ]);
  }

  function setPersonIncomeAccount(person, accountId) {
    ensurePersonIncomeConfig(person);
    person.incomeAccountId = accountId || '';
  }

  function syncPaymentsPaidWithIncome(person, month, received) {
    if (!person || !isMonthKey(month)) return 0;
    let changes = 0;
    (state.personalCosts || []).forEach((post) => {
      if (!post || post.personId !== person.id) return;
      ensurePostConfig(post);
      if (received) {
        if (post.paidWithIncome !== true || !isDue(post, month)) return;
        if (isPostPaidForMonth(post, month)) {
          if (post.incomePaidMonths.includes(month)) applyPostAccountBalanceDebit(post, month, true);
          return;
        }
        setPostPaidForMonth(post, month, true);
        if (!post.incomePaidMonths.includes(month)) post.incomePaidMonths.push(month);
        syncDebtPaymentFromPost(post, month);
        addChangeLog('Persönliche Ausgaben', `${post.name || 'Lohnabzug'}: mit Lohn-Eingang automatisch als bezahlt markiert.`, month);
        changes += 1;
        return;
      }
      if (!post.incomePaidMonths.includes(month)) return;
      setPostPaidForMonth(post, month, false);
      resetDebtPaymentFromPost(post, month);
      addChangeLog('Persönliche Ausgaben', `${post.name || 'Lohnabzug'}: automatische Markierung mit rückgängig gemachtem Lohn-Eingang zurückgesetzt.`, month);
      changes += 1;
    });
    return changes;
  }

  function applyPersonIncomeBalance(person, month, apply) {
    if (!ACCOUNTS_ENABLED) return false;
    const entry = getPersonIncomeReceivedEntry(person, month);
    if (!entry) return false;
    const sourceId = `income:${person.id}:${month}`;
    if (apply) {
      if (entry.balanceApplied === true) return false;
      const accountId = entry.accountId || getPersonIncomeAccountId(person);
      const amount = Number(entry.amount || 0);
      if (!accountId || !(amount > 0)) return false;
      const txId = applyAccountLedgerTransaction(accountId, {
        month,
        type: 'income',
        sourceId,
        label: `Lohn ${person.name || ''} ${formatMonthLabel(month)}`.trim(),
        amount,
        affectsBalance: true
      });
      if (!txId) return false;
      entry.transactionId = txId;
      entry.accountId = accountId;
      entry.balanceApplied = true;
      entry.balanceAppliedAccountId = accountId;
      entry.balanceAppliedAmount = amount;
      return true;
    }
    if (entry.balanceApplied !== true && !entry.transactionId) return false;
    const accountId = entry.balanceAppliedAccountId || entry.accountId;
    const amount = Number(entry.balanceAppliedAmount || entry.amount || 0);
    if (accountId && entry.transactionId) removeAccountLedgerTransaction(accountId, entry.transactionId);
    else if (sourceId) removeAccountLedgerTransactionBySource(sourceId);
    entry.balanceApplied = false;
    entry.balanceAppliedAccountId = '';
    entry.balanceAppliedAmount = 0;
    return true;
  }

  function syncPersonIncomeReceivedAmount(person, month) {
    ensurePersonIncomeConfig(person);
    if (!isMonthKey(month)) return false;
    const existing = getPersonIncomeReceivedEntry(person, month);
    if (!existing) return false;
    if (!ACCOUNTS_ENABLED) {
      const amount = Number(getPersonNet(person, month) || 0);
      if (!Number.isFinite(amount) || amount < 0) return false;
      const changed = Math.abs(Number(existing.amount || 0) - amount) >= 0.005;
      existing.accountId = '';
      existing.amount = amount;
      existing.transactionId = '';
      existing.balanceApplied = false;
      existing.balanceAppliedAccountId = '';
      existing.balanceAppliedAmount = 0;
      if (changed) addChangeLog('Einkommen', `${person.name}: Lohn für ${formatMonthLabel(month)} auf ${euro(amount)} aktualisiert.`, month);
      return true;
    }
    const sourceId = `income:${person.id}:${month}`;
    const storedBySource = findAccountTransactionBySource(sourceId);
    const existingAccount = getAccountById(existing.accountId);
    const referencedTx = findAccountTransaction(existingAccount, existing.transactionId);
    if (referencedTx && referencedTx.sourceId !== sourceId) referencedTx.sourceId = sourceId;
    const preservedTx = referencedTx || (storedBySource && storedBySource.tx);
    const targetAccountId = existingAccount
      ? existingAccount.id
      : (storedBySource ? storedBySource.account.id : getPersonIncomeAccountId(person));
    if (!targetAccountId || !getAccountById(targetAccountId)) return false;
    const amount = Number(getPersonNet(person, month) || 0);
    if (!Number.isFinite(amount) || amount < 0) return false;
    const changed = Math.abs(Number(existing.amount || 0) - amount) >= 0.005
      || (preservedTx && Math.abs(Number(preservedTx.amount || 0) - amount) >= 0.005)
      || existing.accountId !== targetAccountId;
    const txPayload = {
      month,
      date: preservedTx && preservedTx.date,
      type: 'income',
      sourceId,
      label: `Lohn ${person.name || ''} ${formatMonthLabel(month)}`.trim(),
      amount,
      note: preservedTx && preservedTx.note ? preservedTx.note : ''
    };
    const txId = existing.balanceApplied === true
      ? applyAccountLedgerTransaction(targetAccountId, Object.assign({}, txPayload, { affectsBalance: true }))
      : upsertAccountTransaction(targetAccountId, Object.assign({}, txPayload, { affectsBalance: false, balanceMode: 'proof' }));
    if (!txId) return false;
    existing.accountId = targetAccountId;
    existing.amount = amount;
    existing.transactionId = txId;
    if (existing.balanceApplied === true) {
      existing.balanceAppliedAmount = amount;
      existing.balanceAppliedAccountId = targetAccountId;
    }
    if (changed) {
      const bankNote = existing.balanceApplied === true ? 'Kontostand um die Differenz angepasst.' : 'Kontostand nicht automatisch verändert.';
      addChangeLog('Einkommen', `${person.name}: Lohn für ${formatMonthLabel(month)} auf ${euro(amount)} aktualisiert; ${bankNote}`, month);
    }
    return true;
  }

  function setPersonIncomeReceived(person, month, received, accountId) {
    ensurePersonIncomeConfig(person);
    if (!isMonthKey(month)) return false;
    const existing = getPersonIncomeReceivedEntry(person, month);
    if (received) {
      if (existing) return true;
      if (!ACCOUNTS_ENABLED) {
        const amount = Number(getPersonNet(person, month) || 0);
        person.incomeReceived[month] = {
          accountId: '',
          amount,
          receivedAt: new Date().toISOString(),
          transactionId: '',
          balanceApplied: false,
          balanceAppliedAccountId: '',
          balanceAppliedAmount: 0
        };
        addChangeLog('Einkommen', `${person.name}: Lohn ${euro(amount)} für ${formatMonthLabel(month)} erhalten markiert.`, month);
        syncPaymentsPaidWithIncome(person, month, true);
        return true;
      }
      const targetAccountId = accountId || getPersonIncomeAccountId(person);
      if (!targetAccountId || !getAccountById(targetAccountId)) {
        alert('Bitte zuerst ein Zielkonto für den Lohn auswählen.');
        return false;
      }
      const amount = Number(getPersonNet(person, month) || 0);
      person.incomeReceived[month] = {
        accountId: targetAccountId,
        amount,
        receivedAt: new Date().toISOString(),
        transactionId: '',
        balanceApplied: false,
        balanceAppliedAccountId: '',
        balanceAppliedAmount: 0
      };
      if (!applyPersonIncomeBalance(person, month, true)) {
        delete person.incomeReceived[month];
        return false;
      }
      addChangeLog('Einkommen', `${person.name}: Lohn ${euro(amount)} für ${formatMonthLabel(month)} erhalten; ${getAccountName(targetAccountId)} um diesen Eingang erhöht.`, month);
      syncPaymentsPaidWithIncome(person, month, true);
      return true;
    }
    if (existing) {
      if (!ACCOUNTS_ENABLED) {
        syncPaymentsPaidWithIncome(person, month, false);
        addChangeLog('Einkommen', `${person.name}: Lohn-Eingang für ${formatMonthLabel(month)} rückgängig gemacht.`, month);
        delete person.incomeReceived[month];
        return true;
      }
      const balanceWasApplied = existing.balanceApplied === true;
      applyPersonIncomeBalance(person, month, false);
      removeAccountTransaction(existing.accountId, existing.transactionId);
      syncPaymentsPaidWithIncome(person, month, false);
      addChangeLog('Einkommen', `${person.name}: Lohn-Eingang für ${formatMonthLabel(month)} rückgängig gemacht${balanceWasApplied ? ' und vom Kontostand entfernt' : ''}.`, month);
      delete person.incomeReceived[month];
    }
    return true;
  }

  function ensurePostConfig(post) {
    ensurePostScheduleConfig(post);
    ensurePostAmountConfig(post);
    ensurePostPaymentConfig(post);
    ensureLinkedDebtField(post);
    ensureLinkedSavingsGoalField(post);
    ensureAccountLinkField(post);
    ensurePostBookingConfig(post);
  }

  function ensureLinkedSavingsGoalField(post) {
    if (!post || typeof post !== 'object') return;
    if (typeof post.linkedSavingsGoalId !== 'string') post.linkedSavingsGoalId = '';
  }

  function getLinkedSavingsGoal(post) {
    if (!post || !post.linkedSavingsGoalId || !Array.isArray(state.savingsGoals)) return null;
    return state.savingsGoals.find((goal) => goal && goal.id === post.linkedSavingsGoalId) || null;
  }

  function getLinkedSavingsGoalName(post) {
    const goal = getLinkedSavingsGoal(post);
    return goal ? goal.name : '';
  }

  function createSavingsGoalSelect(value = '') {
    normalizeSavingsGoalsConfig();
    const select = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Keine verknüpfte Rücklage';
    select.appendChild(none);
    (state.savingsGoals || []).forEach((goal) => {
      const option = document.createElement('option');
      option.value = goal.id;
      option.textContent = `${goal.name}${goal.isActive ? '' : ' · pausiert'}`;
      select.appendChild(option);
    });
    select.value = value || '';
    return select;
  }

  function appendSavingsGoalLinkField(content, refs, editPost) {
    const row = document.createElement('div');
    row.className = 'row';
    refs.savingsGoalSelect = createSavingsGoalSelect(editPost && editPost.linkedSavingsGoalId ? editPost.linkedSavingsGoalId : '');
    row.appendChild(createLabelInput('Rücklage verknüpfen', refs.savingsGoalSelect));
    content.appendChild(row);
    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = 'Beim Bezahlt-Markieren wird der Betrag genau einmal in die gewählte Rücklage eingezahlt. So bleibt Rücklage getrennt von normalen Ausgaben, ohne dass ein Konto gepflegt werden muss.';
    content.appendChild(hint);
  }

  function getSavingsGoalPostSourceId(post, monthKey) {
    return post && post.id && isMonthKey(monthKey) ? `savings-post:${post.id}:${monthKey}` : '';
  }

  function removeSavingsGoalPostTransaction(sourceId) {
    if (!sourceId || !Array.isArray(state.savingsGoals)) return false;
    let removed = false;
    state.savingsGoals.forEach((goal) => {
      if (!Array.isArray(goal.transactions)) return;
      const matching = goal.transactions.filter((tx) => tx && tx.sourceId === sourceId);
      if (!matching.length) return;
      matching.forEach((tx) => {
        const amount = Number(tx.amount || 0);
        goal.balance = tx.type === 'withdraw'
          ? Number(goal.balance || 0) + amount
          : Math.max(0, Number(goal.balance || 0) - amount);
      });
      goal.transactions = goal.transactions.filter((tx) => !(tx && tx.sourceId === sourceId));
      removed = true;
    });
    return removed;
  }

  function syncSavingsGoalFromPost(post, monthKey, paid) {
    if (!post || !isMonthKey(monthKey)) return false;
    ensureLinkedSavingsGoalField(post);
    const sourceId = getSavingsGoalPostSourceId(post, monthKey);
    if (!sourceId) return false;
    const goal = getLinkedSavingsGoal(post);
    const existingGoal = (state.savingsGoals || []).find((entry) => (entry.transactions || []).some((tx) => tx && tx.sourceId === sourceId));
    if (!paid || !goal) {
      return removeSavingsGoalPostTransaction(sourceId);
    }
    const amount = Number(getEffectiveAmountForMonth(post, monthKey) || 0);
    if (!(amount > 0)) return false;
    const existing = existingGoal && (existingGoal.transactions || []).find((tx) => tx && tx.sourceId === sourceId);
    if (existing && existingGoal.id === goal.id && existing.type === 'deposit' && Math.abs(Number(existing.amount || 0) - amount) < 0.005) {
      return false;
    }
    removeSavingsGoalPostTransaction(sourceId);
    if (!goal.accountId) goal.accountId = post.accountId || inferAccountIdForPost(post) || '';
    goal.balance = Number(goal.balance || 0) + amount;
    goal.transactions.push({
      id: generateId(),
      month: monthKey,
      type: 'deposit',
      amount,
      note: `${post.name || 'Kostenposten'} · automatisch zurückgelegt`,
      sourceId,
      sourcePostId: post.id || '',
      createdAt: new Date().toISOString()
    });
    addChangeLog('Rücklagen', `${goal.name}: ${euro(amount)} aus ${post.name || 'Kostenposten'} zurückgelegt.`, monthKey);
    return true;
  }

  function updatePostSavingsGoalLink(post, goalId, monthKey = currentMonth) {
    ensurePostConfig(post);
    const nextId = typeof goalId === 'string' ? goalId : '';
    const wasPaid = isPostPaidForMonth(post, monthKey);
    if (post.linkedSavingsGoalId === nextId) {
      if (wasPaid && nextId) {
        syncSavingsGoalFromPost(post, monthKey, true);
        if (isPostBookedForMonth(post, monthKey)) applyPostAccountBooking(post, monthKey, true);
      }
      return false;
    }
    if (wasPaid) syncSavingsGoalFromPost(post, monthKey, false);
    post.linkedSavingsGoalId = nextId;
    if (wasPaid) {
      syncAppliedPostAccountBalanceAfterEdit(post, monthKey);
      syncSavingsGoalFromPost(post, monthKey, true);
      if (isPostBookedForMonth(post, monthKey)) applyPostAccountBooking(post, monthKey, true);
    }
    return true;
  }

  function ensurePostBookingConfig(post) {
    if (!post || typeof post !== 'object') return;
    if (!ACCOUNTS_ENABLED) {
      post.bookingType = 'expense';
      post.transferToAccountId = '';
      return;
    }
    if (!['expense', 'transfer'].includes(post.bookingType)) post.bookingType = 'expense';
    if (typeof post.transferToAccountId !== 'string') post.transferToAccountId = '';
    if (post.bookingType === 'transfer' && post.transferToAccountId && !getAccountById(post.transferToAccountId)) post.transferToAccountId = '';
  }
  function ensurePostPaymentConfig(post) {
    if (!post || typeof post !== 'object') return;
    if (!Array.isArray(post.paidMonths)) post.paidMonths = [];
    post.paidMonths = post.paidMonths.filter((m, index, arr) => isMonthKey(m) && arr.indexOf(m) === index);
    if (!Array.isArray(post.sharedBalanceDebitedMonths)) post.sharedBalanceDebitedMonths = [];
    post.sharedBalanceDebitedMonths = post.sharedBalanceDebitedMonths.filter((m, index, arr) => isMonthKey(m) && arr.indexOf(m) === index);
    if (!post.accountBalanceDebits || typeof post.accountBalanceDebits !== 'object' || Array.isArray(post.accountBalanceDebits)) {
      post.accountBalanceDebits = {};
    }
    Object.keys(post.accountBalanceDebits).forEach((month) => {
      const entry = post.accountBalanceDebits[month];
      if (!isMonthKey(month) || !entry || typeof entry !== 'object' || typeof entry.accountId !== 'string' || !(Number(entry.amount) > 0)) {
        delete post.accountBalanceDebits[month];
        return;
      }
      entry.amount = Number(entry.amount);
      entry.transferToAccountId = typeof entry.transferToAccountId === 'string' ? entry.transferToAccountId : '';
    });
    post.paidWithIncome = post.paidWithIncome === true;
    if (!Array.isArray(post.incomePaidMonths)) post.incomePaidMonths = [];
    post.incomePaidMonths = post.incomePaidMonths.filter((m, index, arr) => isMonthKey(m) && arr.indexOf(m) === index);
  }
  function isPostPaidForMonth(post, month) {
    ensurePostConfig(post);
    return post.paidMonths.includes(month);
  }
  function freezePostAmountForMonth(post, month) {
    ensurePostConfig(post);
    if (!isMonthKey(month)) return false;
    const amount = Number(getEffectiveAmountForMonth(post, month));
    if (!Number.isFinite(amount) || amount < 0) return false;
    if (!post.amountOverrides || typeof post.amountOverrides !== 'object' || Array.isArray(post.amountOverrides)) post.amountOverrides = {};
    // Sobald ein Posten als bezahlt markiert ist, bleibt der Betrag für genau diesen Monat fest.
    // Spätere Änderungen laufen dadurch nur über den Raten-/Betragsverlauf für Folgemonate.
    post.amountOverrides[month] = amount;
    return true;
  }
  function getPostAccountBalanceDebit(post, month) {
    if (!post || !isMonthKey(month)) return null;
    ensurePostConfig(post);
    if (post.accountBalanceDebits[month]) return post.accountBalanceDebits[month];
    if ((state.commonCosts || []).includes(post) && post.sharedBalanceDebitedMonths.includes(month)) {
      const shared = getSharedAccount();
      if (!shared) return null;
      return { accountId: shared.id, amount: Number(getEffectiveAmountForMonth(post, month) || 0), legacy: true };
    }
    return null;
  }

  function canPostDebitAccountBalance(post) {
    if (!ACCOUNTS_ENABLED) return false;
    if (!post) return false;
    ensurePostConfig(post);
    if (getLinkedSavingsGoal(post)) return false;
    const accountId = inferAccountIdForPost(post);
    if (!(accountId && getAccountById(accountId))) return false;
    if (post.bookingType !== 'transfer') return true;
    return !!(post.transferToAccountId
      && post.transferToAccountId !== accountId
      && getAccountById(post.transferToAccountId));
  }

  function markAccountTransferTransactionsAsBalanceAffecting(transfer) {
    if (!transfer) return false;
    let changed = false;
    [
      { accountId: transfer.fromAccountId, txId: transfer.outTransactionId },
      { accountId: transfer.toAccountId, txId: transfer.inTransactionId }
    ].forEach((item) => {
      const account = getAccountById(item.accountId);
      const tx = findAccountTransaction(account, item.txId);
      if (!tx) return;
      const before = tx.affectsBalance === true && tx.balanceMode === 'bank' && tx.transferId === (transfer.id || tx.transferId || '');
      tx.affectsBalance = true;
      tx.balanceMode = 'bank';
      tx.transferId = transfer.id || tx.transferId || '';
      if (!before) changed = true;
    });
    return changed;
  }

  function backfillPostAccountTransactionFromLegacy(post, month, existingDebit = null) {
    if (!post || !isMonthKey(month)) return false;
    ensurePostConfig(post);
    const sourceId = getPostAccountTransactionSource(post, month);
    const transferSourceId = sourceId ? `${sourceId}:transfer` : '';
    const amount = Number(existingDebit && existingDebit.amount || getEffectiveAmountForMonth(post, month) || 0);
    const accountId = existingDebit && existingDebit.accountId ? existingDebit.accountId : inferAccountIdForPost(post);
    if (!sourceId || !accountId || !getAccountById(accountId) || !(amount > 0)) return false;
    const transferToAccountId = existingDebit && existingDebit.transferToAccountId
      ? existingDebit.transferToAccountId
      : (post.bookingType === 'transfer' ? post.transferToAccountId : '');
    const date = new Date().toISOString().slice(0, 10);
    const label = `${post.name || (transferToAccountId ? 'Umbuchung' : 'Ausgabe')} ${formatMonthLabel(month)}`;
    const legacyNote = 'Aus altem Speicherstand übernommen; der Bankstand war bereits angepasst.';
    if (transferToAccountId && getAccountById(transferToAccountId)) {
      const existingTransfer = (state.accountTransfers || []).find((tr) => tr && tr.sourceId === transferSourceId);
      if (existingTransfer) return markAccountTransferTransactionsAsBalanceAffecting(existingTransfer);
      const id = generateId();
      const outId = addAccountTransaction(accountId, {
        month,
        date,
        type: 'transfer_out',
        sourceId: `transfer:${id}:out`,
        label,
        amount: -amount,
        note: legacyNote,
        transferId: id,
        affectsBalance: true
      });
      const inId = addAccountTransaction(transferToAccountId, {
        month,
        date,
        type: 'transfer_in',
        sourceId: `transfer:${id}:in`,
        label,
        amount,
        note: legacyNote,
        transferId: id,
        affectsBalance: true
      });
      if (!outId || !inId) {
        if (outId) removeAccountTransaction(accountId, outId);
        if (inId) removeAccountTransaction(transferToAccountId, inId);
        return false;
      }
      normalizeAccountTransfersConfig();
      state.accountTransfers.push({
        id,
        month,
        date,
        fromAccountId: accountId,
        toAccountId: transferToAccountId,
        amount,
        note: post.name || 'Umbuchung',
        outTransactionId: outId,
        inTransactionId: inId,
        templateId: '',
        sourceId: transferSourceId
      });
      return true;
    }
    const existingTx = findAccountTransactionBySource(sourceId);
    if (existingTx) {
      existingTx.tx.amount = -amount;
      existingTx.tx.affectsBalance = true;
      existingTx.tx.balanceMode = 'bank';
      existingTx.tx.label = existingTx.tx.label || label;
      existingTx.tx.type = existingTx.tx.type || 'expense';
      return true;
    }
    return !!addAccountTransaction(accountId, {
      month,
      date,
      type: 'expense',
      sourceId,
      label,
      amount: -amount,
      note: legacyNote,
      affectsBalance: true
    });
  }

  function applyPostAccountBalanceDebit(post, month, paid) {
    if (!ACCOUNTS_ENABLED) return false;
    if (!post || !isMonthKey(month)) return false;
    ensurePostConfig(post);
    const sourceId = getPostAccountTransactionSource(post, month);
    const transferSourceId = sourceId ? `${sourceId}:transfer` : '';
    const existing = getPostAccountBalanceDebit(post, month);
    if (!paid) {
      if (!existing) {
        if (sourceId) {
          removeAccountLedgerTransactionBySource(sourceId);
          removeAccountTransactionBySource(sourceId);
        }
        if (transferSourceId) deleteAccountTransferBySource(transferSourceId);
        return false;
      }
      if (existing.transferToAccountId) {
        if (!deleteAccountTransferBySource(transferSourceId)) {
          const resetSource = `${transferSourceId || sourceId}:legacy-reset`;
          applyAccountLedgerTransaction(existing.accountId, {
            month,
            type: 'legacy_reset',
            sourceId: `${resetSource}:out`,
            label: `${post.name || 'Umbuchung'} zurückgesetzt`,
            amount: Number(existing.amount || 0),
            affectsBalance: true
          });
          applyAccountLedgerTransaction(existing.transferToAccountId, {
            month,
            type: 'legacy_reset',
            sourceId: `${resetSource}:in`,
            label: `${post.name || 'Umbuchung'} zurückgesetzt`,
            amount: -Number(existing.amount || 0),
            affectsBalance: true
          });
        }
      } else {
        const removed = sourceId ? removeAccountLedgerTransactionBySource(sourceId) : false;
        if (!removed) {
          applyAccountLedgerTransaction(existing.accountId, {
            month,
            type: 'legacy_reset',
            sourceId: `${sourceId || `post:${post.id || generateId()}:${month}`}:legacy-reset`,
            label: `${post.name || 'Ausgabe'} zurückgesetzt`,
            amount: Number(existing.amount || 0),
            affectsBalance: true
          });
        }
      }
      delete post.accountBalanceDebits[month];
      post.sharedBalanceDebitedMonths = post.sharedBalanceDebitedMonths.filter((m) => m !== month);
      addChangeLog('Konten', existing.transferToAccountId
        ? `${post.name || 'Umbuchung'}: Umbuchung ${euro(existing.amount)} von ${getAccountName(existing.accountId)} nach ${getAccountName(existing.transferToAccountId)} zurückgesetzt.`
        : `${post.name || 'Ausgabe'}: Kontoabzug ${euro(existing.amount)} zurückgesetzt.`, month);
      return true;
    }
    if (existing) return backfillPostAccountTransactionFromLegacy(post, month, existing);
    if (!canPostDebitAccountBalance(post)) return false;
    const accountId = inferAccountIdForPost(post);
    const amount = Number(getEffectiveAmountForMonth(post, month) || 0);
    if (!(amount > 0)) return false;
    const transferToAccountId = post.bookingType === 'transfer' ? post.transferToAccountId : '';
    post.accountId = accountId;
    if (transferToAccountId) {
      const ok = addAccountTransfer(accountId, transferToAccountId, amount, post.name || 'Umbuchung', month, '', {
        sourceId: transferSourceId,
        label: `${post.name || 'Umbuchung'} ${formatMonthLabel(month)}`
      });
      if (!ok) return false;
      post.accountBalanceDebits[month] = { accountId, amount, transferToAccountId };
    } else {
      const txId = applyAccountLedgerTransaction(accountId, {
        month,
        type: 'expense',
        sourceId,
        label: `${post.name || 'Ausgabe'} ${formatMonthLabel(month)}`,
        amount: -amount,
        affectsBalance: true
      });
      if (!txId) return false;
      post.accountBalanceDebits[month] = { accountId, amount, transferToAccountId: '' };
    }
    if ((state.commonCosts || []).includes(post) && !post.sharedBalanceDebitedMonths.includes(month)) {
      post.sharedBalanceDebitedMonths.push(month);
    }
    addChangeLog('Konten', transferToAccountId
      ? `${post.name || 'Umbuchung'}: ${euro(amount)} bezahlt und von ${getAccountName(accountId)} nach ${getAccountName(transferToAccountId)} umgebucht.`
      : `${post.name || 'Ausgabe'}: ${euro(amount)} bezahlt und von ${getAccountName(accountId)} abgezogen.`, month);
    return true;
  }

  function syncAppliedPostAccountBalanceAfterEdit(post, month, previousAmount) {
    if (!post || !isMonthKey(month)) return false;
    const existing = getPostAccountBalanceDebit(post, month);
    if (!existing) return false;
    if (!canPostDebitAccountBalance(post)) return applyPostAccountBalanceDebit(post, month, false);
    const targetAccountId = inferAccountIdForPost(post);
    const nextTransferToAccountId = post.bookingType === 'transfer' ? post.transferToAccountId : '';
    const nextAmount = Number(getEffectiveAmountForMonth(post, month) || 0);
    if (existing.legacy === true && Number.isFinite(Number(previousAmount))) {
      existing.amount = Number(previousAmount);
    }
    if (targetAccountId !== existing.accountId || nextTransferToAccountId !== (existing.transferToAccountId || '')) {
      applyPostAccountBalanceDebit(post, month, false);
      return applyPostAccountBalanceDebit(post, month, true);
    }
    const delta = Number(existing.amount || 0) - nextAmount;
    if (Math.abs(delta) < 0.005) return false;
    applyPostAccountBalanceDebit(post, month, false);
    const applied = applyPostAccountBalanceDebit(post, month, true);
    addChangeLog('Konten', nextTransferToAccountId
      ? `${post.name || 'Umbuchung'}: bezahlte Umbuchung um ${euro(Math.abs(delta))} ${delta > 0 ? 'verringert' : 'erhöht'}.`
      : `${post.name || 'Ausgabe'}: bezahlten Kontoabzug um ${euro(Math.abs(delta))} ${delta > 0 ? 'verringert' : 'erhöht'}.`, month);
    return applied;
  }
  function setPostPaidForMonth(post, month, paid) {
    ensurePostConfig(post);
    if (!isMonthKey(month)) return false;
    if (paid) {
      freezePostAmountForMonth(post, month);
      if (!post.paidMonths.includes(month)) {
        post.paidMonths.push(month);
        applyPostAccountBalanceDebit(post, month, true);
        syncSavingsGoalFromPost(post, month, true);
      }
    } else {
      applyPostAccountBalanceDebit(post, month, false);
      syncSavingsGoalFromPost(post, month, false);
      post.paidMonths = post.paidMonths.filter((m) => m !== month);
      post.incomePaidMonths = post.incomePaidMonths.filter((m) => m !== month);
      applyPostAccountBooking(post, month, false);
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
      .sort((a, b) => monthDiff(b.month, a.month));
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
      const effectiveMonth = isPostPaidForMonth(post, month) ? nextMonth(month) : month;
      // Bezahlte Monate bleiben eingefroren. Die dauerhafte Änderung beginnt dann automatisch im Folgemonat.
      if (effectiveMonth === month) delete post.amountOverrides[month];
      const existing = post.amountTimeline.find((entry) => entry && entry.month === effectiveMonth);
      if (existing) existing.amount = numericAmount;
      else post.amountTimeline.push({ month: effectiveMonth, amount: numericAmount });
      post.amountTimeline = post.amountTimeline
        .filter((entry) => entry && isMonthKey(entry.month) && Number.isFinite(Number(entry.amount)))
        .sort((a, b) => monthDiff(b.month, a.month))
        .filter((entry, index, arr) => arr.findIndex((other) => other.month === entry.month) === index);
      return true;
    }
    return false;
  }
  function appendAmountChangeModeField(container, refs, existingPost) {
    if (!existingPost || isOneTimePost(existingPost)) {
      refs.amountChangeModeSelect = { value: 'future' };
      return;
    }
    const select = document.createElement('select');
    select.innerHTML = '<option value="once">Nur in diesem Monat</option><option value="future">Ab diesem Monat dauerhaft</option>';
    select.value = 'once';
    refs.amountChangeModeSelect = select;
    container.appendChild(createLabelInput(`Geänderten Betrag für ${formatMonthLabel(currentMonth)} anwenden`, select));
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
  function isPostVisibleInMonth(post, month) {
    return isPostActiveInMonth(post, month)
      || isPostPaidForMonth(post, month)
      || isPostBookedForMonth(post, month);
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
  function computeAutomaticRoundedCommonShares(totalMonthly, persons, monthKey = '') {
    const result = {};
    if (!persons || persons.length === 0) return result;
    let totalIncome = 0;
    persons.forEach(({ income }) => (totalIncome += income));
    const roundingStep = 5;
    persons.forEach(({ person, income }) => {
      const ratio = totalIncome ? income / totalIncome : 0;
      const base = ratio * totalMonthly + getPersonShift(person, monthKey);
      result[person.id] = Math.ceil(base / roundingStep) * roundingStep;
    });
    return result;
  }

  function computeRoundedCommonShares(totalMonthly, persons, monthKey = '') {
    const result = computeAutomaticRoundedCommonShares(totalMonthly, persons, monthKey);
    if (!isMonthKey(monthKey)) return result;
    (persons || []).forEach(({ person }) => {
      if (!person || !person.id) return;
      const manualAmount = getManualCommonContribution(monthKey, person.id);
      if (manualAmount !== null) result[person.id] = manualAmount;
    });
    return result;
  }

  function roundUpToNextTen(value) {
    const num = Number(value || 0);
    if (num <= 0) return 0;
    return Math.ceil(num / 10) * 10;
  }

  function roundUpToNextFive(value) {
    const num = Number(value || 0);
    if (num <= 0) return 0;
    return Math.ceil(num / 5) * 5;
  }

  function roundUpToNextFifty(value) {
    const num = Number(value || 0);
    if (num <= 0) return 0;
    return Math.ceil(num / 50) * 50;
  }

  function floorToFive(value) {
    const num = Number(value || 0);
    if (num <= 0) return 0;
    return Math.floor(num / 5) * 5;
  }

  function getFoodMoneyPosts() {
    return (state.personalCosts || []).filter((post) => String(post && post.name || '').toLowerCase().includes('einkaufsgeld'));
  }

  function normalizeGroceryExpense(expense) {
    if (!expense || typeof expense !== 'object') return null;
    const amount = parseMoneyInput(expense.amount || 0);
    if (!Number.isFinite(amount) || !(amount > 0)) return null;
    const date = typeof expense.date === 'string' ? expense.date : '';
    const month = isMonthKey(expense.month) ? expense.month : getMonthKeyFromDateValue(date, dateToMonthKey(new Date()));
    return {
      id: typeof expense.id === 'string' && expense.id ? expense.id : generateId(),
      month,
      date,
      name: typeof expense.name === 'string' && expense.name.trim() ? expense.name.trim() : 'Einkauf',
      amount,
      note: typeof expense.note === 'string' ? expense.note : ''
    };
  }

  function normalizeGroceryExpenses() {
    if (!Array.isArray(state.groceryExpenses)) state.groceryExpenses = [];
    state.groceryExpenses = state.groceryExpenses
      .map(normalizeGroceryExpense)
      .filter(Boolean)
      .sort((a, b) => String(b.date || b.month).localeCompare(String(a.date || a.month)));
  }

  function getGroceryExpenses() {
    normalizeGroceryExpenses();
    return state.groceryExpenses;
  }

  function upsertGroceryExpense(expense) {
    const normalized = normalizeGroceryExpense(expense);
    if (!normalized) return null;
    state.groceryExpenses = getGroceryExpenses().filter((entry) => entry.id !== normalized.id);
    state.groceryExpenses.push(normalized);
    normalizeGroceryExpenses();
    return normalized;
  }

  function deleteGroceryExpense(expenseId) {
    state.groceryExpenses = getGroceryExpenses().filter((entry) => entry.id !== expenseId);
  }

  function getGroceryMonthlyTotals() {
    const totals = new Map();
    getGroceryExpenses().forEach((expense) => {
      const row = totals.get(expense.month) || { month: expense.month, amount: 0, count: 0 };
      row.amount += Number(expense.amount || 0);
      row.count += 1;
      totals.set(expense.month, row);
    });
    return Array.from(totals.values()).sort((a, b) => b.month.localeCompare(a.month));
  }

  function getGroceryAverageStats(monthKey = currentMonth, maxMonths = 12) {
    const priorMonth = addMonths(monthKey, -1);
    const entries = getGroceryMonthlyTotals()
      .filter((row) => row.month <= priorMonth)
      .slice(0, Math.max(1, Number(maxMonths || 12)));
    const total = entries.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const count = entries.length;
    const average = count ? total / count : 0;
    const roundedAverage = count ? roundUpToNextFifty(average) : 0;
    return { entries, total, count, average, roundedAverage };
  }

  function getFoodMoneyPlannedTarget(monthKey = currentMonth) {
    const cfg = getBudgetTopUpConfig('groceries');
    if (isMonthKey(monthKey) && cfg && isMonthKey(cfg.targetStartMonth) && monthDiff(cfg.targetStartMonth, monthKey) >= 0) {
      const initialTarget = Math.max(0, Number(cfg.targetAmount || 550));
      if (monthKey === cfg.targetStartMonth) return initialTarget;
      const stats = getGroceryAverageStats(monthKey, 12);
      return stats.count > 0 ? stats.roundedAverage : initialTarget;
    }
    const posts = getFoodMoneyPosts().filter((post) => isPostActiveInMonth(post, monthKey));
    return posts.reduce((sum, post) => sum + Number(post.amount || 0), 0);
  }

  function ensureGroceryMoneyFromJune2026() {
    const startMonth = '2026-06';
    const target = Math.max(0, Number(getBudgetTopUpConfig('groceries').targetAmount || 550));
    const posts = getFoodMoneyPosts();
    const activePosts = posts.filter((post) => isPostActiveInMonth(post, startMonth));
    if (!activePosts.length || !(target > 0)) return false;
    const currentSum = activePosts.reduce((sum, post) => sum + Number(getEffectiveBaseAmountForMonth(post, startMonth) || 0), 0);
    if (Math.abs(currentSum - target) < 0.01) return false;
    const adjustable = activePosts.find((post) => Number(getEffectiveBaseAmountForMonth(post, startMonth) || post.amount || 0) > 0) || activePosts[0];
    const current = Number(getEffectiveBaseAmountForMonth(adjustable, startMonth) || 0);
    const nextAmount = Math.max(0, current + (target - currentSum));
    setPostAmountForMonth(adjustable, startMonth, nextAmount, 'future');
    return true;
  }

  function splitRoundedToFive(total, weightedItems) {
    const roundedTotal = roundUpToNextFive(total);
    const items = (weightedItems || []).filter((item) => item && item.id && Number(item.weight || 0) > 0);
    if (!items.length || roundedTotal <= 0) return {};
    const weightTotal = items.reduce((sum, item) => sum + Number(item.weight || 0), 0);
    const rows = items.map((item) => {
      const raw = roundedTotal * (Number(item.weight || 0) / weightTotal);
      const base = floorToFive(raw);
      return { id: item.id, raw, base, remainder: raw - base };
    });
    let assigned = rows.reduce((sum, row) => sum + row.base, 0);
    let left = Math.max(0, roundedTotal - assigned);
    rows.sort((a, b) => b.remainder - a.remainder);
    let i = 0;
    while (left >= 5 && rows.length) {
      rows[i % rows.length].base += 5;
      left -= 5;
      i += 1;
    }
    const out = {};
    rows.forEach((row) => { out[row.id] = row.base; });
    return out;
  }

  function calculateBudgetTopUp(type, monthKey = currentMonth) {
    const active = isBudgetTopUpActive(type, monthKey);
    let target = 0;
    let source = '';
    if (type === 'fuel') {
      const stats = getTankHouseholdAverageStats(monthKey, 12);
      target = Number(stats && stats.roundedBudget || 0);
      source = stats && stats.projectedCount > 0 ? `${stats.realCount} echt + ${stats.projectedCount} Prognose` : '12-Monats-Basis';
    } else if (type === 'groceries') {
      target = getFoodMoneyPlannedTarget(monthKey);
      const stats = getGroceryAverageStats(monthKey, 12);
      source = monthKey === getBudgetTopUpConfig('groceries').targetStartMonth || stats.count === 0
        ? 'Startziel 550 €'
        : `${stats.count} erfasste Monat(e) im Schnitt`;
    }
    const balance = active ? getBudgetTopUpBalance(type, monthKey) : 0;
    const missing = Math.max(0, target - balance);
    const topUp = active ? (type === 'groceries' ? roundUpToNextFifty(missing) : roundUpToNextFive(missing)) : target;
    return { type, month: monthKey, active, target, balance, missing, topUp, source };
  }

  function getFuelTopUpAllocation(monthKey = currentMonth) {
    const calc = calculateBudgetTopUp('fuel', monthKey);
    const shareBenny = getTankForecastShare('benny', monthKey);
    const shareMadeleine = 1 - shareBenny;
    const allocations = splitRoundedToFive(calc.topUp, [
      { id: 'benny', weight: shareBenny },
      { id: 'madeleine', weight: shareMadeleine }
    ]);
    return { ...calc, allocations };
  }

  function getGroceryTopUpAllocation(monthKey = currentMonth) {
    const calc = calculateBudgetTopUp('groceries', monthKey);
    const posts = getFoodMoneyPosts().filter((post) => isPostActiveInMonth(post, monthKey));
    const allocations = splitRoundedToFive(calc.topUp, posts.map((post) => ({ id: post.id, weight: Number(post.amount || 0) || 1 })));
    return { ...calc, allocations };
  }

  function getTankManualForecastValue(cfg, avgCashback = 0) {
    const priceUsed = Number(cfg && (cfg.avgPrice || cfg.autoPrice) || 0);
    const km = Number(cfg && cfg.kmPerMonth || 0);
    const consumption = Number(cfg && cfg.consumption || 0);
    const gross = (km / 100) * consumption * priceUsed;
    return {
      priceUsed,
      km,
      consumption,
      gross,
      cashback: Math.max(0, Number(avgCashback || 0)),
      net: Math.max(0, gross - Math.max(0, Number(avgCashback || 0)))
    };
  }

  function getTankBestSharedPrice() {
    const values = ['madeleine', 'benny'].map((key) => {
      const cfg = getTankCalcData(key);
      return Number((cfg && (cfg.avgPrice || cfg.autoPrice)) || 0);
    }).filter((v) => v > 0);
    return values.length ? values[0] : 0;
  }

  function getTankHouseholdManualForecastValue(avgCashback = 0) {
    const priceUsed = getTankBestSharedPrice();
    let km = 0;
    let liters = 0;
    const perCar = { bennyKm: 0, madeleineKm: 0 };
    ['benny','madeleine'].forEach((key) => {
      const cfg = getTankCalcData(key);
      const personKm = Number(cfg && cfg.kmPerMonth || 0);
      const consumption = Number(cfg && cfg.consumption || 0);
      const personLiters = (personKm / 100) * consumption;
      km += personKm;
      liters += personLiters;
      perCar[`${key}Km`] = personKm;
    });
    const gross = liters * priceUsed;
    const cashback = Math.max(0, Number(avgCashback || 0));
    return { priceUsed, km, liters, gross, cashback, net: Math.max(0, gross - cashback), ...perCar };
  }

  function normalizeTankClosedMonths() {
    if (!state.tankCalc) state.tankCalc = JSON.parse(JSON.stringify(defaultState.tankCalc));
    if (!Array.isArray(state.tankCalc.closedMonths)) state.tankCalc.closedMonths = [];
    state.tankCalc.closedMonths = Array.from(new Set(state.tankCalc.closedMonths
      .filter((month) => isMonthKey(month) && month >= TANK_REAL_DATA_START_MONTH)))
      .sort();
  }

  function isTankMonthClosed(monthKey) {
    normalizeTankClosedMonths();
    return state.tankCalc.closedMonths.includes(monthKey);
  }

  function setTankMonthClosed(monthKey, closed) {
    normalizeTankClosedMonths();
    if (!isMonthKey(monthKey) || monthKey < TANK_REAL_DATA_START_MONTH) return false;
    state.tankCalc.closedMonths = state.tankCalc.closedMonths.filter((month) => month !== monthKey);
    if (closed) state.tankCalc.closedMonths.push(monthKey);
    state.tankCalc.closedMonths.sort();
    return true;
  }

  function reopenTankMonthAfterEdit(monthKey) {
    if (!isTankMonthClosed(monthKey)) return false;
    setTankMonthClosed(monthKey, false);
    syncAllTankgeldExpenses({ silent: true, monthKey: nextMonth(monthKey) });
    addChangeLog('Tankgeld', `${formatMonthLabel(monthKey)} nach Änderung wieder zur Prüfung geöffnet.`, monthKey);
    return true;
  }

  function getTankHouseholdMonthlyRecord(monthKey) {
    const b = getTankMonthlyRecord('benny', monthKey);
    const m = getTankMonthlyRecord('madeleine', monthKey);
    const receiptStats = getTankReceiptHouseholdStatsForMonth(monthKey);
    const hasReceipts = receiptStats.receiptCount > 0;
    return {
      month: monthKey,
      km: Number(b.km || 0) + Number(m.km || 0),
      liters: hasReceipts ? receiptStats.liters : Number(b.liters || 0) + Number(m.liters || 0),
      paid: hasReceipts ? receiptStats.paid : Number(b.paid || 0) + Number(m.paid || 0),
      cashback: hasReceipts ? receiptStats.cashback : Number(b.cashback || 0) + Number(m.cashback || 0),
      netCost: hasReceipts ? receiptStats.netCost : Number(b.netCost || 0) + Number(m.netCost || 0),
      receiptCount: hasReceipts ? receiptStats.receiptCount : Number(b.receiptCount || 0) + Number(m.receiptCount || 0),
      bennyKm: Number(b.km || 0),
      madeleineKm: Number(m.km || 0)
    };
  }

  function getTankHouseholdRealMonthlyRecords(baseMonth = currentMonth) {
    normalizeTankClosedMonths();
    return state.tankCalc.closedMonths
      .filter((month) => month < baseMonth)
      .sort((a, b) => String(b).localeCompare(String(a)))
      .map((month) => getTankHouseholdMonthlyRecord(month))
      .filter((entry) => Number(entry.netCost || 0) > 0 && Number(entry.liters || 0) > 0);
  }

  function getTankHouseholdAverageStats(baseMonth = currentMonth, maxMonths = 12) {
    const targetMonths = Math.max(1, Number(maxMonths || 12));
    const entries = getTankHouseholdRealMonthlyRecords(baseMonth).slice(0, targetMonths);
    const realCount = entries.length;
    const totals = entries.reduce((acc, entry) => {
      acc.km += Number(entry.km || 0);
      acc.liters += Number(entry.liters || 0);
      acc.paid += Number(entry.paid || 0);
      acc.cashback += Number(entry.cashback || 0);
      acc.net += Number(entry.netCost || 0);
      acc.bennyKm += Number(entry.bennyKm || 0);
      acc.madeleineKm += Number(entry.madeleineKm || 0);
      return acc;
    }, { km: 0, liters: 0, paid: 0, cashback: 0, net: 0, bennyKm: 0, madeleineKm: 0 });
    const projectedCount = Math.max(0, targetMonths - realCount);
    const projectedUnit = getTankHouseholdManualForecastValue(0);
    const projectedNetTotal = projectedCount * projectedUnit.net;
    const basisMonths = realCount + projectedCount;
    const combinedNet = totals.net + projectedNetTotal;
    const avgNet = basisMonths ? combinedNet / basisMonths : 0;
    const avgKm = basisMonths ? (totals.km + projectedCount * projectedUnit.km) / basisMonths : 0;
    const avgLiters = basisMonths ? (totals.liters + projectedCount * projectedUnit.liters) / basisMonths : 0;
    const realConsumption = totals.km > 0 ? (totals.liters / totals.km) * 100 : 0;
    return { count: basisMonths, realCount, projectedCount, basisMonths, entries, totals, projectedUnit, projectedNetTotal, avgNet, avgKm, avgLiters, realConsumption, roundedBudget: roundUpToNextFive(avgNet) };
  }

  function getTankForecastShare(personKey, baseMonth = currentMonth) {
    const household = getTankHouseholdAverageStats(baseMonth, 12);
    const projected = household && household.projectedUnit ? household.projectedUnit : getTankHouseholdManualForecastValue(0);
    const totalKm = Number(household && household.totals && household.totals.km || 0) + Number(household && household.projectedCount || 0) * Number(projected.km || 0);
    const keyKm = personKey === 'madeleine'
      ? Number(household && household.totals && household.totals.madeleineKm || 0) + Number(household && household.projectedCount || 0) * Number(projected.madeleineKm || 0)
      : Number(household && household.totals && household.totals.bennyKm || 0) + Number(household && household.projectedCount || 0) * Number(projected.bennyKm || 0);
    if (totalKm > 0) return Math.max(0, Math.min(1, keyKm / totalKm));
    const manual = ['benny','madeleine'].reduce((acc, key) => {
      const cfg = getTankCalcData(key);
      const km = Number(cfg.kmPerMonth || 0);
      acc[key] = km;
      acc.total += km;
      return acc;
    }, { benny: 0, madeleine: 0, total: 0 });
    if (manual.total > 0) return manual[personKey] / manual.total;
    return 0.5;
  }

  function calculateTankBudget(cfg, personKey = '', monthKey = currentMonth) {
    const key = personKey || (cfg === (state.tankCalc && state.tankCalc.madeleine) ? 'madeleine' : 'benny');
    const householdStats = getTankHouseholdAverageStats(monthKey, 12);
    const share = getTankForecastShare(key, monthKey);
    if (householdStats && householdStats.basisMonths === 12) {
      const raw = householdStats.avgNet * share;
      return {
        priceUsed: householdStats.projectedUnit && householdStats.projectedUnit.priceUsed ? householdStats.projectedUnit.priceUsed : 0,
        raw,
        rounded: roundUpToNextFive(raw),
        source: householdStats.projectedCount > 0
          ? `Gesamt-12-Monats-Schnitt nach Kilometeranteil (${householdStats.realCount} echt + ${householdStats.projectedCount} Prognose)`
          : 'Gesamt-12-Monats-Schnitt nach Kilometeranteil (12 echte Monate)',
        avgStats: householdStats,
        householdStats,
        share
      };
    }
    const manual = getTankManualForecastValue(cfg, 0);
    return { priceUsed: manual.priceUsed, raw: manual.net, rounded: roundUpToNextFive(manual.net), source: 'Kilometer × Verbrauch × Preis', avgStats: { count: 0, realCount: 0, projectedCount: 12, basisMonths: 12, avgNet: manual.net }, share };
  }

  function getTankCalcPersonKey(personIdOrName) {
    const s = String(personIdOrName || '').toLowerCase();
    if (s.includes('madeleine')) return 'madeleine';
    return 'benny';
  }

  function getTankCalcData(personKey) {
    if (!state.tankCalc) state.tankCalc = JSON.parse(JSON.stringify(defaultState.tankCalc));
    if (!state.tankCalc[personKey]) state.tankCalc[personKey] = JSON.parse(JSON.stringify(defaultState.tankCalc[personKey]));
    if (!Array.isArray(state.tankCalc[personKey].monthlyEntries)) state.tankCalc[personKey].monthlyEntries = [];
    return state.tankCalc[personKey];
  }


  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function normalizeTankReceipt(receipt) {
    const allocations = receipt && receipt.allocations && typeof receipt.allocations === 'object' ? receipt.allocations : {};
    const liters = Math.max(0, parseMoneyInput(receipt && receipt.liters || 0));
    const paid = Math.max(0, parseMoneyInput(receipt && receipt.paid || 0));
    const cashback = Math.max(0, parseMoneyInput(receipt && receipt.cashback || 0));
    const netCost = Math.max(0, paid - cashback);
    return {
      id: String(receipt && receipt.id || generateId()),
      month: isMonthKey(receipt && receipt.month) ? receipt.month : currentMonth,
      date: String(receipt && receipt.date || ''),
      liters,
      paid,
      cashback,
      netCost,
      isCanister: !!(receipt && receipt.isCanister),
      allocations: {
        benny: Math.max(0, parseMoneyInput(allocations.benny || receipt && receipt.bennyLiters || 0)),
        madeleine: Math.max(0, parseMoneyInput(allocations.madeleine || receipt && receipt.madeleineLiters || 0))
      },
      note: String(receipt && receipt.note || '').trim()
    };
  }

  function getTankReceipts() {
    if (!state.tankCalc) state.tankCalc = JSON.parse(JSON.stringify(defaultState.tankCalc));
    if (!Array.isArray(state.tankCalc.receipts)) state.tankCalc.receipts = [];
    state.tankCalc.receipts = state.tankCalc.receipts.map(normalizeTankReceipt).filter((r) => isMonthKey(r.month));
    state.tankCalc.receipts.sort((a, b) => String(b.date || b.month).localeCompare(String(a.date || a.month)));
    return state.tankCalc.receipts;
  }

  function upsertTankReceipt(receipt) {
    const normalized = normalizeTankReceipt(receipt);
    const receipts = getTankReceipts().filter((r) => r.id !== normalized.id);
    receipts.push(normalized);
    state.tankCalc.receipts = receipts;
    getTankReceipts();
    return normalized;
  }

  function deleteTankReceipt(receiptId) {
    state.tankCalc.receipts = getTankReceipts().filter((r) => r.id !== receiptId);
  }

  function getTankReceiptHouseholdStatsForMonth(monthKey) {
    return getTankReceipts().filter((receipt) => receipt.month === monthKey).reduce((stats, receipt) => {
      stats.liters += Number(receipt.liters || 0);
      stats.paid += Number(receipt.paid || 0);
      stats.cashback += Number(receipt.cashback || 0);
      stats.netCost += Number(receipt.netCost || 0);
      stats.receiptCount += 1;
      return stats;
    }, { liters: 0, paid: 0, cashback: 0, netCost: 0, receiptCount: 0 });
  }

  function getTankMonthlyRecord(personKey, monthKey) {
    const entry = getTankEntryForMonth(personKey, monthKey) || { month: monthKey };
    return {
      month: monthKey,
      startKm: Number(entry.startKm || 0),
      endKm: Number(entry.endKm || 0),
      km: Number(entry.km || 0),
      liters: Number(entry.liters || 0),
      paid: Number(entry.paid || 0),
      cashback: Number(entry.cashback || 0),
      netCost: Number(entry.netCost || 0),
      receiptCount: 0,
      note: entry.note || ''
    };
  }

  function getTankRealMonthlyRecords(personKey, baseMonth = currentMonth) {
    const months = new Set();
    getTankMonthlyEntries(personKey).forEach((entry) => {
      if (entry.month <= baseMonth) months.add(entry.month);
    });
    return Array.from(months)
      .sort((a, b) => String(b).localeCompare(String(a)))
      .map((month) => getTankMonthlyRecord(personKey, month))
      .filter((entry) => Number(entry.netCost || 0) > 0 || Number(entry.km || 0) > 0 || Number(entry.liters || 0) > 0);
  }

  function getPreviousTankEndKm(personKey, monthKey) {
    const previous = getTankEntryForMonth(personKey, addMonths(monthKey, -1));
    const endKm = Number(previous && previous.endKm || 0);
    return endKm > 0 ? endKm : null;
  }

  function getTankKmPlanSuggestion(personKey, monthKey = currentMonth) {
    const entries = getTankRealMonthlyRecords(personKey, monthKey)
      .filter((entry) => entry.month < monthKey && isTankMonthClosed(entry.month) && Number(entry.km || 0) > 0)
      .slice(0, 3);
    if (entries.length < 2) return null;
    const average = entries.reduce((sum, entry) => sum + Number(entry.km || 0), 0) / entries.length;
    const rounded = Math.max(0, Math.round(average / 10) * 10);
    return { km: rounded, count: entries.length, months: entries.map((entry) => entry.month) };
  }

  function normalizeTankMonthlyEntry(entry) {
    const startKm = parseMoneyInput(entry && entry.startKm || 0);
    const endKm = parseMoneyInput(entry && entry.endKm || 0);
    const km = Math.max(0, endKm - startKm);
    const liters = Math.max(0, parseMoneyInput(entry && entry.liters || 0));
    const paid = Math.max(0, parseMoneyInput(entry && entry.paid || 0));
    const cashback = Math.max(0, parseMoneyInput(entry && entry.cashback || 0));
    return {
      month: isMonthKey(entry && entry.month) ? entry.month : currentMonth,
      startKm,
      endKm,
      km,
      liters,
      paid,
      cashback,
      netCost: Math.max(0, paid - cashback),
      note: String(entry && entry.note || '').trim()
    };
  }

  function getTankMonthlyEntries(personKey) {
    const cfg = getTankCalcData(personKey);
    cfg.monthlyEntries = (cfg.monthlyEntries || []).map(normalizeTankMonthlyEntry).filter((entry) => isMonthKey(entry.month));
    cfg.monthlyEntries.sort((a, b) => String(b.month).localeCompare(String(a.month)));
    return cfg.monthlyEntries;
  }

  function getTankEntryForMonth(personKey, monthKey) {
    return getTankMonthlyEntries(personKey).find((entry) => entry.month === monthKey) || null;
  }

  function upsertTankMonthlyEntry(personKey, entry) {
    const cfg = getTankCalcData(personKey);
    const normalized = normalizeTankMonthlyEntry(entry);
    cfg.monthlyEntries = (cfg.monthlyEntries || []).filter((e) => e && e.month !== normalized.month);
    cfg.monthlyEntries.push(normalized);
    cfg.monthlyEntries.sort((a, b) => String(b.month).localeCompare(String(a.month)));
    return normalized;
  }

  function deleteTankMonthlyEntry(personKey, monthKey) {
    const cfg = getTankCalcData(personKey);
    cfg.monthlyEntries = (cfg.monthlyEntries || []).filter((entry) => entry && entry.month !== monthKey);
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

  function getStoredTankLocation() {
    const lat = Number(state.tankCalc && state.tankCalc.locationLat);
    const lng = Number(state.tankCalc && state.tankCalc.locationLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { coords: { latitude: lat, longitude: lng }, label: state.tankCalc.locationName || state.tankCalc.locationQuery || 'gespeicherter Standort' };
    }
    return null;
  }

  async function resolveTankLocationQuery(query) {
    const value = String(query || '').trim();
    if (!value) throw new Error('Bitte einen Standort eingeben, z. B. Nauen oder eine Adresse.');
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'de');
    url.searchParams.set('q', value);
    let response;
    let data;
    try {
      response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      data = await response.json();
    } catch (err) {
      throw new Error('Standortsuche fehlgeschlagen. Bitte später erneut versuchen oder Gerätestandort nutzen.');
    }
    if (!response.ok || !Array.isArray(data) || data.length === 0) {
      throw new Error('Standort wurde nicht gefunden. Bitte genauer eingeben, z. B. Straße + Ort.');
    }
    const first = data[0];
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Standortdaten konnten nicht gelesen werden.');
    state.tankCalc.locationLat = String(lat);
    state.tankCalc.locationLng = String(lng);
    state.tankCalc.locationName = first.display_name || value;
    state.tankCalc.locationQuery = value;
    saveState();
    return { coords: { latitude: lat, longitude: lng }, label: state.tankCalc.locationName };
  }

  async function useDeviceLocationForTankApi() {
    const position = await getCurrentPositionForTankApi();
    state.tankCalc.locationLat = String(position.coords.latitude);
    state.tankCalc.locationLng = String(position.coords.longitude);
    state.tankCalc.locationName = 'Gerätestandort';
    state.tankCalc.locationQuery = 'Gerätestandort';
    saveState();
    return position;
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

    let position = getStoredTankLocation();
    if (!position) {
      try {
        position = await getCurrentPositionForTankApi();
      } catch (err) {
        const msg = err && err.message ? err.message : 'Standort konnte nicht geladen werden. Trage alternativ einen Standort im Tankgeld ein.';
        setTankApiStatus('Fehler', msg);
        throw new Error(msg);
      }
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
      syncTankgeldExpense(personKey, { silent: true });
      saveState();
      render();
    } catch (err) {
      alert(`Preisabruf fehlgeschlagen: ${err.message || err}`);
      render();
    }
  }

  function getTankExpensePost(personKey) {
    const person = state.persons.find((p) => getTankCalcPersonKey(p.id || p.name) === personKey);
    const personId = person ? person.id : personKey;
    return state.personalCosts.find((item) => {
      const samePerson = String(item.personId || '').toLowerCase() === String(personId).toLowerCase();
      const name = String(item.name || '').toLowerCase();
      return samePerson && name.includes('tankgeld');
    });
  }

  function getTankExpenseLabel(personKey) {
    return personKey === 'madeleine' ? 'Tankgeld Seat (Arbeitsweg)' : 'Tankgeld Smart (Arbeitsweg)';
  }

  function getTankCalculatedBudget(personKey, monthKey = currentMonth) {
    const cfg = getTankCalcData(personKey);
    const tankBudget = calculateTankBudget(cfg, personKey, monthKey);
    const fuelPool = getFuelTopUpAllocation(monthKey);
    if (fuelPool.active) {
      return Number(fuelPool.allocations && fuelPool.allocations[personKey] || 0);
    }
    return Number(tankBudget.rounded || 0);
  }

  function syncTankgeldExpense(personKey, options = {}) {
    const monthKey = isMonthKey(options.monthKey) ? options.monthKey : currentMonth;
    const calculated = getTankCalculatedBudget(personKey, monthKey);
    const cfg = getTankCalcData(personKey);
    const tankBudgetSource = calculateTankBudget(cfg, personKey, monthKey);
    const km = Number(cfg.kmPerMonth || 0);
    const consumption = Number(cfg.consumption || 0);
    const priceUsed = Number(tankBudgetSource.priceUsed || 0);
    const hasMonthlyAverage = tankBudgetSource.avgStats && tankBudgetSource.avgStats.count > 0;
    if (!calculated || (!hasMonthlyAverage && (!km || !consumption || !priceUsed))) {
      if (!options.silent) alert('Bitte zuerst Kilometer, Verbrauch und Preis ausfüllen oder echte Tankdaten für mindestens einen Monat speichern.');
      return false;
    }

    const person = state.persons.find((p) => getTankCalcPersonKey(p.id || p.name) === personKey);
    const personId = person ? person.id : personKey;
    let existing = getTankExpensePost(personKey);
    const label = getTankExpenseLabel(personKey);

    if (!existing) {
      existing = {
        id: 'tankgeld_' + personKey,
        personId: personId,
        name: label,
        amount: calculated,
        interval: 1,
        startMonth: monthKey,
        paidMonths: [],
        oneTime: false,
        endMonth: '',
        amountTimeline: [],
        amountOverrides: {},
        linkedDebtId: ''
      };
      state.personalCosts.push(existing);
      if (!options.silent) alert('Tankgeld wurde als persönlicher Ausgabenposten angelegt.');
      return true;
    }

    ensurePostConfig(existing);
    existing.personId = personId;
    if (!existing.name) existing.name = label;
    existing.interval = 1;
    existing.oneTime = false;
    if (!existing.startMonth || !isMonthKey(existing.startMonth)) existing.startMonth = monthKey;

    const currentIsPaid = isPostPaidForMonth(existing, monthKey);
    const targetMonth = currentIsPaid ? nextMonth(monthKey) : monthKey;
    setPostAmountForMonth(existing, targetMonth, calculated, 'future');
    if (currentIsPaid) {
      addChangeLog('Tankgeld', `${existing.name}: aktueller Monat ist bezahlt, neuer Betrag ${euro(calculated)} gilt ab ${formatMonthLabel(targetMonth)}`, targetMonth);
    } else {
      addChangeLog('Tankgeld', `${existing.name}: automatisch auf ${euro(calculated)} aktualisiert`, monthKey);
    }
    return true;
  }

  function syncAllTankgeldExpenses(options = {}) {
    const okBenny = syncTankgeldExpense('benny', { silent: true, monthKey: options.monthKey });
    const okMadeleine = syncTankgeldExpense('madeleine', { silent: true, monthKey: options.monthKey });
    if (!options.silent) {
      alert('Tankgeld wurde mit den persönlichen Ausgaben synchronisiert. Bereits bezahlte Monate bleiben fest; Änderungen gelten dann ab dem Folgemonat.');
    }
    return okBenny || okMadeleine;
  }

  function upsertTankgeldAsPersonalExpense(personKey) {
    const ok = syncTankgeldExpense(personKey, { silent: false });
    if (ok) {
      saveState();
      render();
      alert('Tankgeld wurde mit den persönlichen Ausgaben verknüpft/aktualisiert. Wenn der aktuelle Monat schon bezahlt ist, gilt die Änderung erst ab dem Folgemonat.');
    }
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
    recordRuntimeIssue(label || 'Bereich', 'Renderfehler', error);
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


  function renderGlobalMonthBar() {
    if (!globalMonthBar) return;
    const details = computeMonthDetails(currentMonth);
    globalMonthBar.innerHTML = '';

    const labelWrap = document.createElement('div');
    labelWrap.className = 'global-month-label';
    const eyebrow = document.createElement('span');
    eyebrow.textContent = 'Aktiver Monat';
    const title = document.createElement('strong');
    title.textContent = formatMonthLabel(currentMonth);
    labelWrap.appendChild(eyebrow);
    labelWrap.appendChild(title);

    const controls = document.createElement('div');
    controls.className = 'global-month-controls';
    const monthPicker = createMonthSelect();
    monthPicker.classList.add('global-month-picker');
    monthPicker.addEventListener('change', (e) => {
      setCurrentMonth(e.target.value);
      render();
    });
    controls.appendChild(monthPicker);

    const todayButton = document.createElement('button');
    todayButton.type = 'button';
    todayButton.className = 'ghost-btn compact';
    todayButton.textContent = 'Aktueller Monat';
    todayButton.addEventListener('click', () => {
      setCurrentMonth(dateToMonthKey(new Date()));
      render();
    });
    controls.appendChild(todayButton);

    const meta = document.createElement('div');
    meta.className = 'global-month-meta';
    const free = document.createElement('span');
    free.textContent = `Sicher frei: ${euro(details.free)}`;
    free.className = details.free < 0 ? 'negative' : 'positive';
    const common = document.createElement('span');
    common.textContent = `Gemeinsam: ${euro(details.totalCommonRounded)}`;
    const personal = document.createElement('span');
    personal.textContent = `Persönlich: ${euro(details.totalPersonal)}`;
    meta.appendChild(free);
    meta.appendChild(common);
    meta.appendChild(personal);
    if (runtimeIssues.length) {
      const err = document.createElement('span');
      err.className = 'negative';
      err.textContent = `Fehlerwächter: ${runtimeIssues.length}`;
      meta.appendChild(err);
    }

    globalMonthBar.appendChild(labelWrap);
    globalMonthBar.appendChild(controls);
    globalMonthBar.appendChild(meta);
  }

  function render() {
    try { closeActionMenus(); } catch (error) { recordRuntimeIssue('System', 'Aktionsmenü konnte nicht geschlossen werden', error); }
    try { syncCurrentMonthToActualDate(); } catch (error) { recordRuntimeIssue('System', 'Monatsprüfung fehlgeschlagen', error); }
    try { renderGlobalMonthBar(); } catch (error) { recordRuntimeIssue('System', 'Monatsleiste fehlgeschlagen', error); }
    if (!ACCOUNTS_ENABLED && currentSection === 'sharedaccount') currentSection = 'common';
    if (currentSection === 'taxrefund') currentSection = 'overview';

    if (sectionSelect && sectionSelect.value !== currentSection) {
      sectionSelect.value = currentSection;
    }
    sectionButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === currentSection);
    });
    if (sideMoreSelect && Array.from(sideMoreSelect.options).some((option) => option.value === currentSection)) {
      sideMoreSelect.value = currentSection;
    } else if (sideMoreSelect) sideMoreSelect.value = '';
    document.querySelectorAll('.tab-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === currentSection);
      if (sec.id !== currentSection) sec.setAttribute('aria-hidden', 'true');
      else sec.removeAttribute('aria-hidden');
    });

    const renderMap = {
      overview: ['Übersicht', overviewSection, renderOverview],
      monthstart: ['Monatsstart', monthStartSection, renderMonthStart],
      openpayments: ['Offene Zahlungen', openPaymentsSection, renderOpenPayments],
      income: ['Einkommen', incomeSection, renderIncome],
      common: ['Gemeinsame Kosten', commonSection, renderCommon],
      sharedaccount: ['Gemeinsame Kosten', commonSection, renderCommon],
      personal: ['Persönliche Ausgaben', personalSection, renderPersonal],
      buffer: ['Sonstige Ausgaben', bufferSection, renderBufferExpenses],
      tankcalc: ['Tankgeld', tankCalcSection, renderTankCalc],
      groceries: ['Einkaufsgeld', grocerySection, renderGroceries],
      debts: ['Schulden', debtsSection, renderDebts],
      settings: ['Regeln & Personen', settingsSection, renderSettings],
      savings: ['Rücklagen & Sparen', savingsSection, renderSavings],
      pots: ['Töpfe', potsSection, renderPots],
      monthclose: ['Monatsabschluss', monthCloseSection, renderMonthClose],
      datacheck: ['Datencheck', dataCheckSection, renderDataCheck],
      forecast: ['Vorschau & Simulation', forecastSection, renderForecast],
      save: ['Sichern', saveSection, renderSave]
    };
    const step = renderMap[currentSection] || renderMap.overview;
    runRenderStep(step[0], step[1], step[2]);
    appendActiveRuntimeIssueNotice(step[1]);

    try { enableTableSorting(); } catch (error) { recordRuntimeIssue('System', 'Tabellensortierung fehlgeschlagen', error); }
    try { prepareResponsiveTables(); } catch (error) { recordRuntimeIssue('System', 'Responsive Tabellen fehlgeschlagen', error); }
    try { restorePendingSearchFocus(); } catch (error) { recordRuntimeIssue('System', 'Suchfeld-Fokus konnte nicht wiederhergestellt werden', error); }
    appendActiveRuntimeIssueNotice(step[1]);
  }

  function prepareResponsiveTables() {
    document.querySelectorAll('.list-table').forEach((table) => {
      const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
      table.querySelectorAll('tbody tr').forEach((row) => {
        Array.from(row.children).forEach((cell, index) => {
          if (!cell || cell.tagName !== 'TD') return;
          const label = headers[index] || cell.getAttribute('data-label') || '';
          if (label) cell.setAttribute('data-label', label);
        });
      });
    });
  }


  function createActionButton(label, className, onClick, disabled = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className = className || 'secondary';
    btn.disabled = !!disabled;
    if (typeof onClick === 'function') btn.addEventListener('click', onClick);
    return btn;
  }

  let actionMenuGlobalHandlersReady = false;

  function closeActionMenus(except = null) {
    document.querySelectorAll('.action-menu.open').forEach((menu) => {
      if (except && menu === except) return;
      menu.classList.remove('open');
      const toggle = menu.querySelector('.action-menu-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      const panel = menu._actionMenuPanel;
      if (panel) {
        panel.classList.remove('floating-action-panel');
        panel.style.left = '';
        panel.style.top = '';
        panel.style.right = '';
        panel.style.bottom = '';
        panel.style.transform = '';
        if (panel.parentNode !== menu) menu.appendChild(panel);
      }
    });
  }

  function ensureActionMenuGlobalHandlers() {
    if (actionMenuGlobalHandlersReady) return;
    actionMenuGlobalHandlersReady = true;
    document.addEventListener('click', (event) => {
      const openMenu = event.target && event.target.closest ? event.target.closest('.action-menu') : null;
      if (!openMenu) closeActionMenus();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeActionMenus();
    });
  }

  function positionActionMenuPanel(menu, toggle, panel) {
    if (!menu || !toggle || !panel) return;
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.transform = 'none';

    const margin = 10;
    const rect = toggle.getBoundingClientRect();
    panel.style.left = `${margin}px`;
    panel.style.top = `${margin}px`;

    requestAnimationFrame(() => {
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = Math.min(panelRect.width || 320, window.innerWidth - margin * 2);
      const panelHeight = Math.min(panelRect.height || 260, window.innerHeight - margin * 2);

      let left = rect.right - panelWidth;
      if (left < margin) left = rect.left;
      if (left + panelWidth > window.innerWidth - margin) left = window.innerWidth - panelWidth - margin;
      if (left < margin) left = margin;

      let top = rect.bottom + 8;
      if (top + panelHeight > window.innerHeight - margin) {
        top = rect.top - panelHeight - 8;
      }
      if (top < margin) top = margin;

      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
    });
  }

  function createActionMenu(actions, label = 'Aktionen ⋯', infoHtml = '') {
    ensureActionMenuGlobalHandlers();
    const cleanActions = (actions || []).filter(Boolean);
    const menu = document.createElement('div');
    menu.className = 'action-menu';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'action-menu-toggle';
    toggle.textContent = label;
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = !menu.classList.contains('open');
      if (!willOpen) {
        closeActionMenus();
        return;
      }
      closeActionMenus();
      menu.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      panel.classList.add('floating-action-panel');
      document.body.appendChild(panel);
      positionActionMenuPanel(menu, toggle, panel);
    });
    menu.appendChild(toggle);

    const panel = document.createElement('div');
    panel.className = 'action-menu-panel';
    menu._actionMenuPanel = panel;
    panel.addEventListener('click', (event) => event.stopPropagation());
    if (infoHtml) {
      const info = document.createElement('div');
      info.className = 'action-menu-info';
      info.innerHTML = infoHtml;
      panel.appendChild(info);
    }
    cleanActions.forEach((action) => {
      const btn = createActionButton(action.label, action.className || 'secondary', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeActionMenus();
        if (typeof action.onClick === 'function') action.onClick(event);
      }, action.disabled);
      panel.appendChild(btn);
    });
    menu.appendChild(panel);
    return menu;
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

  function findCostPostById(postId) {
    if (!postId) return null;
    const sources = [
      { area: 'Gemeinsame Kosten', list: state.commonCosts || [] },
      { area: 'Persönliche Ausgaben', list: state.personalCosts || [] },
      { area: 'Sonstige Ausgaben', list: state.bufferExpenses || [] }
    ];
    for (const source of sources) {
      const post = source.list.find((item) => item && item.id === postId);
      if (post) return { area: source.area, post };
    }
    return null;
  }

  function addPostStatusOnlyProof(post, monthKey) {
    if (!ACCOUNTS_ENABLED) return false;
    if (!post || !isMonthKey(monthKey)) return false;
    ensurePostConfig(post);
    const sourceId = getPostAccountTransactionSource(post, monthKey);
    if (!sourceId) return false;
    const accountId = inferAccountIdForPost(post);
    if (!accountId || !getAccountById(accountId)) return false;
    const amount = Number(getEffectiveAmountForMonth(post, monthKey) || 0);
    if (!(amount > 0)) return false;
    const txId = upsertAccountTransaction(accountId, {
      month: monthKey,
      type: 'payment_status_proof',
      sourceId,
      label: `${post.name || 'Posten'} ${formatMonthLabel(monthKey)}`,
      amount: -amount,
      affectsBalance: false,
      balanceMode: 'proof',
      note: 'Nachweis: bezahlt markiert; der echte Bankstand bleibt unverändert.'
    });
    if (txId) addChangeLog('Konten', `${post.name || 'Posten'}: Status-Nachweis ohne Bankstandsänderung ergänzt.`, monthKey);
    return !!txId;
  }

  function runInternalAppAudit(months = [addMonths(currentMonth, -1), currentMonth, addMonths(currentMonth, 1)]) {
    const checks = [];
    const add = (ok, title, detail, kind = '') => checks.push({ ok: !!ok, title, detail: detail || '', kind: ok ? 'success' : (kind || 'warning') });
    months.filter(isMonthKey).forEach((month) => {
      const details = computeMonthDetails(month);
      const close = buildMonthCloseSnapshot(month);
      add(Math.abs(Number(details.free || 0) - Number(close.free || 0)) < 0.01, `Monatsabschluss ${formatMonthLabel(month)}`, `Monatsrest ${euro(details.free)} · Abschluss ${euro(close.free)}.`);
      const common = computeCommonAccountDetails(month);
      const open = collectOpenPaymentsForMonth(month);
      add(Math.abs(Number(common.contributionsOpen || 0) - Number(open.totalIncoming || 0)) < 0.01, `Monatsanteile ${formatMonthLabel(month)}`, `Offen im Gemeinschaftskonto ${euro(common.contributionsOpen)} · offene Zahlungen ${euro(open.totalIncoming)}.`);
      const expiredVisible = [...(state.commonCosts || []), ...(state.personalCosts || []), ...(state.bufferExpenses || [])]
        .filter((post) => post && post.endMonth && post.endMonth < month && isPostVisibleInMonth(post, month));
      add(expiredVisible.length === 0, `Ausgelaufene Posten ${formatMonthLabel(month)}`, expiredVisible.length ? `${expiredVisible.length} ausgelaufene Posten waeren noch sichtbar.` : 'Keine ausgelaufenen Posten sichtbar.');
    });
    const seen = new Map();
    const duplicates = [];
    if (ACCOUNTS_ENABLED) {
      (state.accounts || []).forEach((account) => {
        (account.transactions || []).forEach((tx) => {
          if (!tx || !tx.sourceId) return;
          if (seen.has(tx.sourceId)) duplicates.push(tx.sourceId);
          else seen.set(tx.sourceId, true);
        });
      });
      add(duplicates.length === 0, 'Konten-Historie', duplicates.length ? `${duplicates.length} doppelte Buchungsquelle(n): ${duplicates.slice(0, 3).join(', ')}` : 'Keine doppelten Buchungsquellen gefunden.', 'danger');
    }
    const warningCount = getDataCheckItems().filter((item) => item.kind === 'warning' || item.kind === 'danger').length;
    add(warningCount === 0, 'Datencheck-Hinweise', warningCount ? `${warningCount} Hinweis(e) brauchen eine Entscheidung.` : 'Keine kritischen Hinweise.');
    return checks;
  }

  function showInternalAppAuditModal() {
    const checks = runInternalAppAudit();
    const content = document.createElement('div');
    content.className = 'modal-form';
    content.appendChild(createSummaryMetrics([
      { label: 'Prüfungen', value: String(checks.length) },
      { label: 'OK', value: String(checks.filter((row) => row.ok).length), kind: 'success' },
      { label: 'Prüfen', value: String(checks.filter((row) => !row.ok).length), kind: checks.some((row) => !row.ok) ? 'warning' : 'success' }
    ]));
    const table = document.createElement('table');
    table.className = 'list-table compact-table';
    table.innerHTML = '<thead><tr><th>Status</th><th>Prüfung</th><th>Details</th></tr></thead>';
    const tbody = document.createElement('tbody');
    checks.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><span class="pill ${row.ok ? 'success' : 'warning'}">${row.ok ? 'OK' : 'Prüfen'}</span></td><td>${row.title}</td><td>${row.detail}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    content.appendChild(table);
    showModal('App-Prüfmodus', content, [{ label: 'Schließen', className: 'primary' }]);
  }


  function normalizeDataCheckAreaName(area) {
    const raw = String(area || 'System').trim();
    if (raw === 'Kraftstoffkonto') return 'Tankgeld';
    if (raw === 'Rücklagen') return 'Rücklagen & Sparen';
    if (raw === 'Monat') return 'Monatsauswahl';
    if (raw.startsWith('Persönlich')) return 'Persönliche Ausgaben';
    return raw || 'System';
  }

  function getDataCheckAreaDefinitions() {
    const defs = [
      { key: 'Einkommen', label: 'Einkommen', section: 'income' },
      { key: 'Konten', label: 'Konten', section: 'sharedaccount' },
      { key: 'Gemeinsame Kosten', label: 'Gemeinsame Kosten', section: 'common' },
      { key: 'Persönliche Ausgaben', label: 'Persönliche Ausgaben', section: 'personal' },
      { key: 'Sonstige Ausgaben', label: 'Sonstige Ausgaben', section: 'buffer' },
      { key: 'Schulden', label: 'Schulden', section: 'debts' },
      { key: 'Tankgeld', label: 'Tankgeld', section: 'tankcalc' },
      { key: 'Einkaufsgeld', label: 'Einkaufsgeld', section: 'groceries' },
      { key: 'Rücklagen & Sparen', label: 'Rücklagen & Sparen', section: 'savings' },
      { key: 'Töpfe', label: 'Töpfe', section: 'pots' },
      { key: 'Monatsabschluss', label: 'Monatsabschluss', section: 'monthclose' },
      { key: 'Offene Zahlungen', label: 'Offene Zahlungen', section: 'openpayments' },
      { key: 'Monatsstart', label: 'Monatsstart', section: 'monthstart' },
      { key: 'Monatsauswahl', label: 'Monatsauswahl', section: 'overview' },
      { key: 'System', label: 'System', section: 'save' }
    ];
    return ACCOUNTS_ENABLED ? defs : defs.filter((def) => def.key !== 'Konten');
  }

  function getDataCheckAreaSummaries(items) {
    const defs = getDataCheckAreaDefinitions();
    const byArea = new Map(defs.map((def) => [def.key, { ...def, danger: 0, warning: 0, info: 0, success: 0, items: [] }]));
    (items || []).forEach((item) => {
      const key = normalizeDataCheckAreaName(item && item.area);
      if (!byArea.has(key)) byArea.set(key, { key, label: key, section: 'datacheck', danger: 0, warning: 0, info: 0, success: 0, items: [] });
      const row = byArea.get(key);
      const kind = item && item.kind === 'danger' ? 'danger' : (item && item.kind === 'warning' ? 'warning' : (item && item.kind === 'info' ? 'info' : 'success'));
      row[kind] += 1;
      row.items.push(item);
    });
    return Array.from(byArea.values()).map((row) => {
      let kind = 'success';
      let label = 'OK';
      let detail = 'Keine Hinweise';
      if (row.danger > 0) {
        kind = 'danger';
        label = `${row.danger} Fehler`;
        detail = row.warning > 0 ? `${row.warning} weitere Warnung(en)` : 'Bitte prüfen';
      } else if (row.warning > 0) {
        kind = 'warning';
        label = `${row.warning} Hinweis(e)`;
        detail = row.info > 0 ? `${row.info} Info` : 'Bitte prüfen';
      } else if (row.info > 0) {
        kind = 'info';
        label = `${row.info} Info`;
        detail = 'Nur Hinweis';
      } else if (row.success > 0) {
        kind = 'success';
        label = 'OK';
        detail = `${row.success} Prüfung(en) bestanden`;
      }
      return { ...row, kind, statusLabel: label, detail };
    });
  }

  function renderDataCheckAreaOverview(items, options = {}) {
    const compact = options.compact === true;
    const summaries = getDataCheckAreaSummaries(items);
    const wrap = document.createElement('div');
    wrap.className = compact ? 'area-check-grid compact' : 'area-check-grid';
    summaries.forEach((summary) => {
      const card = document.createElement(compact ? 'button' : 'div');
      if (compact) card.type = 'button';
      card.className = `area-check-card ${summary.kind}${compact ? ' is-clickable' : ''}`;
      if (compact) {
        card.addEventListener('click', () => switchSection(summary.section || 'datacheck'));
      }
      const title = document.createElement('strong');
      title.textContent = summary.label;
      const chip = document.createElement('span');
      chip.className = `pill ${summary.kind === 'danger' ? 'danger' : (summary.kind === 'warning' ? 'warning' : (summary.kind === 'info' ? '' : 'success'))}`;
      chip.textContent = summary.statusLabel;
      const detail = document.createElement('small');
      detail.className = 'muted';
      detail.textContent = summary.detail;
      card.appendChild(title);
      card.appendChild(chip);
      if (!compact) card.appendChild(detail);
      wrap.appendChild(card);
    });
    return wrap;
  }

  function getDataCheckItems() {
    const items = [];
    const autoLinkedNow = autoLinkMatchingDebtPosts();
    if (autoLinkedNow > 0) saveState();

    runtimeIssues.slice(-8).reverse().forEach((issue) => {
      items.push({
        kind: 'danger',
        area: 'System',
        checkType: 'runtime-issue',
        title: `${issue.title}: ${issue.area}`,
        detail: `${issue.message}${issue.at ? ` · ${new Date(issue.at).toLocaleString('de-DE')}` : ''}`
      });
    });

    const allPosts = getAllCostPosts();
    const nextMonthsForChecks = getNext12Months(currentMonth).map((m) => m.key);
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
      if (linked) {
        nextMonthsForChecks.forEach((checkMonth) => {
          if (!isDue(post, checkMonth)) return;
          const postAmount = getEffectiveAmountForMonth(post, checkMonth);
          const debtRate = getDebtRateForMonth(linked, checkMonth);
          if (linked.paymentType === 'installment' && Number(post.interval || 1) === 1 && Math.abs(postAmount - debtRate) > 0.01) {
            items.push({
              kind: 'warning',
              area,
              title: `Rate weicht ab: ${post.name}`,
              detail: `${formatMonthLabel(checkMonth)}: Posten ${euro(postAmount)} · Schuld ${euro(debtRate)}. Über „Daten reparieren“ bzw. Speichern wird die Schuld synchronisiert.`
            });
          }
        });
        if (isDue(post, currentMonth) && linked.nextDueMonth !== currentMonth && isDebtOpenForMonth(linked, currentMonth) && Number(linked.amountOpen || 0) > 0) {
          items.push({
            kind: 'warning',
            area,
            title: `Fälligkeit weicht ab: ${post.name}`,
            detail: `Posten ist in ${formatMonthLabel(currentMonth)} fällig, die Schuld steht aber auf ${linked.nextDueMonth || 'keinen Monat'}. Beim Bezahlen wird die Zahlung trotzdem übernommen und die nächste Fälligkeit sauber weitergezogen.`
          });
        }
      }
    });

    [...(state.commonCosts || []), ...(state.personalCosts || []), ...(state.bufferExpenses || [])].forEach((post) => {
      ensureLinkedSavingsGoalField(post);
      if (post.linkedSavingsGoalId && !getLinkedSavingsGoal(post)) {
        items.push({
          kind: 'warning',
          area: 'Rücklagen & Sparen',
          title: `Rücklage fehlt: ${post.name || 'Kostenposten'}`,
          detail: 'Dieser Kostenposten verweist auf eine nicht mehr vorhandene Rücklage. Bitte neu verknüpfen oder die Verbindung entfernen.'
        });
      }
    });
    if (ACCOUNTS_ENABLED) (state.savingsGoals || []).forEach((goal) => {
      if (Number(goal.balance || 0) > 0.005 && !goal.accountId) {
        items.push({
          kind: 'warning',
          area: 'Rücklagen & Sparen',
          title: `Zielkonto fehlt: ${goal.name}`,
          detail: `Es sind ${euro(Number(goal.balance || 0))} angespart, aber keinem Konto zugeordnet. Wähle ein Zielkonto, damit dieser Betrag dort als gebunden angezeigt wird.`
        });
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

    if (currentMonth >= TANK_REAL_DATA_START_MONTH) {
      const tankRecord = getTankHouseholdMonthlyRecord(currentMonth);
      const hasTankData = !!getTankEntryForMonth('benny', currentMonth)
        || !!getTankEntryForMonth('madeleine', currentMonth)
        || getTankReceipts().some((receipt) => receipt.month === currentMonth);
      if (hasTankData) {
        items.push({
          kind: isTankMonthClosed(currentMonth) ? 'success' : 'info',
          area: 'Tankgeld',
          title: isTankMonthClosed(currentMonth) ? 'Tankmonat bestätigt' : 'Tankmonat noch nicht bestätigt',
          detail: isTankMonthClosed(currentMonth)
            ? `${formatMonthLabel(currentMonth)} ist abgeschlossen; ${euro(tankRecord.netCost)} und ${tankRecord.liters.toFixed(2)} l fließen ab dem Folgemonat in die Planung ein.`
            : `Für ${formatMonthLabel(currentMonth)} sind Tankdaten vorhanden. Wenn alle Kilometerstände und Bons vollständig sind, bestätige den Monat im Tankgeld für die Folgeplanung.`
        });
      }
    }

    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      const linkedPosts = getLinkedPostsForDebt(debt);
      if (Number(debt.amountOpen || 0) > 0 && debt.paymentType === 'open_plan') {
        items.push({
          kind: 'warning',
          area: 'Schulden',
          checkType: 'debt-open-plan',
          debtId: debt.id || '',
          amountOpen: Number(debt.amountOpen || 0),
          title: `Ratenplan offen: ${debt.name}`,
          detail: `Es ist noch ${euro(Number(debt.amountOpen || 0))} offen, aber keine Monatsrate hinterlegt.`
        });
      }
      const annualRule = getDebtAnnualRateRule(debt);
      if (annualRule) {
        const invalidTimelineMonths = (debt.rateTimeline || []).filter((entry) => entry && isMonthKey(entry.month) && !isDebtRateChangeAllowedInMonth(debt, entry.month));
        items.push({
          kind: invalidTimelineMonths.length ? 'warning' : 'info',
          area: 'Schulden',
          title: `Jährliche Ratenprüfung: ${debt.name}`,
          detail: invalidTimelineMonths.length
            ? `Diese Schuld darf nur zum 01.${String(annualRule.month).padStart(2, '0')}. angepasst werden. Prüfe diese abweichenden Monate: ${invalidTimelineMonths.map((entry) => formatMonthLabel(entry.month)).join(', ')}.`
            : `${annualRule.label}. Sonderzahlungen bleiben jederzeit über „Zahlung eintragen“ möglich.`
        });
      }
      const creditorRule = getDebtCreditorRule(debt);
      if (creditorRule && creditorRule.type === 'locked_plan_no_extra') {
        items.push({
          kind: 'info',
          area: 'Schulden',
          title: `Sonderregel: ${debt.name}`,
          detail: creditorRule.label || 'Diese Schuld ist für Sonderzahlungen und dynamische Extra-Tilgung gesperrt.'
        });
      }
      if (debt.id === 'debt_mkk') {
        const baseAmount = 3208.32;
        const paidTotal = (debt.paymentHistory || []).reduce((sum, entry) => sum + Number(entry && entry.amount || 0), 0);
        const expectedOpen = Math.max(0, baseAmount - paidTotal);
        if (Math.abs(Number(debt.amountOpen || 0) - expectedOpen) > 0.01) {
          items.push({
            kind: 'warning',
            area: 'Schulden',
            title: 'MKK-Restschuld prüfen',
            detail: `Laut MKK-Ratenplan startet die Forderung mit 3.208,32 €. Bei bisher gespeicherten Zahlungen von ${euro(paidTotal)} müsste offen ${euro(expectedOpen)} sein; gespeichert sind ${euro(Number(debt.amountOpen || 0))}.`
          });
        }
      }
      linkedPosts.forEach(({ post }) => {
        const paidMonths = Array.isArray(post.paidMonths) ? post.paidMonths : [];
        paidMonths.forEach((paidMonth) => {
          if (!isMonthKey(paidMonth)) return;
          if (!isDue(post, paidMonth)) return;
          const hasHistory = (debt.paymentHistory || []).some((entry) => entry && entry.month === paidMonth && Number(entry.amount || 0) > 0);
          if (!hasHistory) {
            items.push({
              kind: 'warning',
              area: 'Schulden',
              checkType: 'missing-linked-debt-payment',
              debtId: debt.id,
              postId: post.id || '',
              paidMonth,
              paymentAmount: Number(getEffectiveAmountForMonth(post, paidMonth) || 0),
              title: `Bezahlter Posten ohne Schuldzahlung: ${debt.name}`,
              detail: `${post.name} ist in ${formatMonthLabel(paidMonth)} als bezahlt markiert, aber in der Schuld gibt es keine passende Zahlungshistorie. Entscheide unten, ob die Restschuld dabei noch vermindert werden muss.`
            });
          }
        });
      });
      if (Number(debt.amountOpen || 0) > 0 && debt.nextDueMonth === currentMonth && getDebtRateForMonth(debt, currentMonth) > 0 && isDebtOpenForMonth(debt, currentMonth)) {
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

    const monthDetails = computeMonthDetails(currentMonth);
    if (Number(monthDetails.miscOpen || 0) > 0.005) {
      items.push({
        kind: monthDetails.free < 0 ? 'warning' : 'info',
        area: 'Sonstige Ausgaben',
        title: 'Freier Betrag konservativ berechnet',
        detail: `${euro(monthDetails.miscOpen)} offene sonstige Ausgaben sind im sicheren freien Betrag bereits abgezogen. Ohne diese offenen Posten läge der aktuelle freie Betrag bei ${euro(monthDetails.freeCurrent)}.`
      });
    }

    if (ACCOUNTS_ENABLED) {
      (state.accounts || []).forEach((account) => {
        const availability = getAccountAvailability(account, currentMonth);
        (availability.paidUnbookedRows || []).forEach((row) => {
          if (!row.postId || !(Number(row.amount || 0) > 0.005)) return;
          items.push({
            kind: 'warning',
            area: 'Konten',
            checkType: 'paid-unbooked-post',
            accountId: account.id || '',
            postId: row.postId || '',
            paidMonth: currentMonth,
            amount: Number(row.amount || 0),
            balanceDebited: row.balanceDebited === true,
            title: `Bezahlter Posten ohne Historie: ${row.name || 'Posten'}`,
            detail: `${row.name || 'Posten'} ist in ${formatMonthLabel(currentMonth)} bezahlt markiert, aber im Konto ${account.name || 'Konto'} fehlt ein eindeutiger Buchungsnachweis.`
          });
        });
      });

      const dailySavingsPlan = getCommonIntervalDailySavingsPlan(currentMonth);
      if (dailySavingsPlan.target > 0.005 && !dailySavingsPlan.accounts.length) {
        items.push({
          kind: 'warning',
          area: 'Konten',
          checkType: 'missing-daily-savings-account',
          title: 'Tagesgeldkonto für Intervall-Anteile fehlt',
          detail: `Für nicht-monatliche gemeinsame Kosten sollten aktuell ${euro(dailySavingsPlan.target)} auf einem Tagesgeldkonto liegen. Markiere ein Konto als Typ „Tagesgeld“, damit Soll und echter Kontostand verglichen werden können.`
        });
      }
      const invalidDailyRows = (dailySavingsPlan.rows || []).filter((row) => {
        const monthsBuilt = Number(row.monthsBuilt || 0);
        const interval = Number(row.interval || 0);
        const reserve = Number(row.reserve || 0);
        const amount = Number(row.amount || 0);
        return !(interval > 1) || monthsBuilt < 0 || monthsBuilt > interval || reserve < -0.005 || reserve - amount > 0.005 || !isMonthKey(row.nextDue);
      });
      if (invalidDailyRows.length) {
        items.push({
          kind: 'danger',
          area: 'Konten',
          checkType: 'invalid-daily-savings-cycle',
          title: 'Tagesgeld-Sollrechnung prüfen',
          detail: `${invalidDailyRows.length} Intervall-Posten hat unplausible Ansparwerte. Bitte Intervall, Startmonat und Betrag prüfen.`
        });
      } else if ((dailySavingsPlan.rows || []).length) {
        items.push({
          kind: 'success',
          area: 'Konten',
          title: 'Tagesgeld-Sollrechnung geprüft',
          detail: `${dailySavingsPlan.rows.length} nicht-monatliche gemeinsame Kosten werden im Anspar-Zyklus bis zur nächsten Fälligkeit plausibel berücksichtigt.`
        });
      }
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


  function getOpenPaymentSectionForGroup(group) {
    if (group === 'Gemeinsame Kosten') return 'common';
    if (group === 'Persönliche Ausgaben') return 'personal';
    if (group === 'Sonstige Ausgaben') return 'buffer';
    if (group === 'Schulden') return 'debts';
    return 'openpayments';
  }

  function collectOpenPaymentsForMonth(monthKey = currentMonth) {
    normalizeAccountsConfig(false);
    const rows = [];
    const linkedDebtIds = new Set([...(state.commonCosts || []), ...(state.personalCosts || []), ...(state.bufferExpenses || [])]
      .map((post) => post && post.linkedDebtId)
      .filter(Boolean));

    const addPostRows = (items, group) => {
      (items || []).forEach((post) => {
        ensurePostConfig(post);
        if (!isDue(post, monthKey) || isPostPaidForMonth(post, monthKey)) return;
        const amount = Number(getEffectiveAmountForMonth(post, monthKey) || 0);
        if (!(amount > 0.005)) return;
        const accountId = post.accountId || inferAccountIdForPost(post) || '';
        rows.push({
          id: `post:${post.id || generateId()}:${monthKey}`,
          targetType: 'post',
          targetId: post.id || '',
          batchEligible: !isOneTimePost(post) && !getLinkedSavingsGoal(post),
          group,
          name: post.name || 'Posten',
          amount,
          accountId,
          accountName: getAccountName(accountId),
          section: getOpenPaymentSectionForGroup(group),
          note: post.linkedSavingsGoalId
            ? `zurücklegen in ${getLinkedSavingsGoalName(post) || 'Rücklage'}`
            : (post.linkedDebtId ? `verknüpft mit ${getLinkedDebtName(post) || 'Schuld'}` : '')
        });
      });
    };

    addPostRows(state.commonCosts, 'Gemeinsame Kosten');
    addPostRows(state.personalCosts, 'Persönliche Ausgaben');
    addPostRows(state.bufferExpenses, 'Sonstige Ausgaben');

    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      if (linkedDebtIds.has(debt.id)) return;
      const open = getDebtOpenAmountForMonth(debt, monthKey);
      if (!(open > 0.005)) return;
      const accountId = debt.accountId || '';
      rows.push({
        id: `debt:${debt.id || generateId()}:${monthKey}`,
        targetType: 'debt',
        targetId: debt.id || '',
        batchEligible: false,
        group: 'Schulden',
        name: debt.name || 'Schuld',
        amount: open,
        accountId,
        accountName: getAccountName(accountId),
        section: 'debts',
        note: inferDebtPaymentType(debt) === 'one_time' ? 'Einmalzahlung' : ''
      });
    });

    const byAccount = new Map();
    rows.forEach((row) => {
      const key = ACCOUNTS_ENABLED ? (row.accountId || '__unassigned__') : row.group;
      if (!byAccount.has(key)) {
        byAccount.set(key, {
          accountId: ACCOUNTS_ENABLED ? (row.accountId || '') : '',
          account: ACCOUNTS_ENABLED && row.accountId ? getAccountById(row.accountId) : null,
          name: ACCOUNTS_ENABLED ? (row.accountId ? getAccountName(row.accountId) : 'Nicht zugeordnet') : row.group,
          rows: [],
          total: 0
        });
      }
      const bucket = byAccount.get(key);
      bucket.rows.push(row);
      bucket.total += row.amount;
    });

    const commonDetails = computeCommonAccountDetails(monthKey);
    const incoming = (commonDetails.persons || [])
      .filter((row) => Number(row.openAmount || 0) > 0.005)
      .map((row) => ({
        personId: row.person.id,
        name: `${row.person.name} Anteil gemeinsame Kosten`,
        amount: Number(row.openAmount || 0),
      accountId: ACCOUNTS_ENABLED ? DEFAULT_SHARED_ACCOUNT_ID : '',
      accountName: ACCOUNTS_ENABLED ? getAccountName(DEFAULT_SHARED_ACCOUNT_ID) : 'Monatsanteile',
        note: row.paid ? `${euro(row.paidAmount)} fixiert eingegangen, Differenz offen` : 'noch nicht eingegangen'
      }));

    const groups = Array.from(byAccount.values()).sort((a, b) => {
      if (!a.accountId && b.accountId) return 1;
      if (a.accountId && !b.accountId) return -1;
      return a.name.localeCompare(b.name, 'de');
    });

    return {
      rows,
      groups,
      incoming,
      totalOpen: rows.reduce((sum, row) => sum + row.amount, 0),
      totalIncoming: incoming.reduce((sum, row) => sum + row.amount, 0)
    };
  }

  function renderOpenPaymentsOverviewCard(monthKey = currentMonth, options = {}) {
    const data = collectOpenPaymentsForMonth(monthKey);
    const compact = options.compact === true;
    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h2');
    h.textContent = compact ? 'Offene Zahlungen' : 'Offene-Zahlungen-Zentrale';
    card.appendChild(h);
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = compact
      ? 'Die wichtigsten offenen Posten im ausgewählten Monat.'
      : 'Hier siehst du alle offenen Zahlungen im ausgewählten Monat nach Bereich gruppiert. So erkennst du schnell, was noch markiert oder geprüft werden muss.';
    card.appendChild(p);

    const accountsMissing = ACCOUNTS_ENABLED ? data.groups.filter((group) => group.account && getAccountAvailability(group.account, monthKey).missing > 0).length : 0;
    const metrics = [
      { label: 'Offen gesamt', value: euro(data.totalOpen), kind: data.totalOpen > 0 ? 'warning' : 'success' },
      { label: 'Offene Posten', value: String(data.rows.length), hint: data.rows.length === 1 ? '1 Zahlung offen' : `${data.rows.length} Zahlungen offen` },
      { label: 'Offene Monatsanteile', value: euro(data.totalIncoming), kind: data.totalIncoming > 0 ? 'warning' : 'success' }
    ];
    if (ACCOUNTS_ENABLED) metrics.splice(2, 0, { label: 'Konten mit Fehlbetrag', value: String(accountsMissing), kind: accountsMissing > 0 ? 'danger' : 'success' });
    card.appendChild(createSummaryMetrics(metrics));

    if (!compact) {
      const batchCard = renderBatchPaymentCard(monthKey, data);
      if (batchCard) card.appendChild(batchCard);
    }

    if (data.rows.length === 0) {
      const empty = createUiEl('div', 'empty-state', 'Für diesen Monat sind keine offenen Zahlungen gefunden.');
      card.appendChild(empty);
    }

    const shownGroups = compact ? data.groups.slice(0, 3) : data.groups;
    shownGroups.forEach((group) => {
      const sub = document.createElement('div');
      sub.className = 'sub-card';
      const header = document.createElement('div');
      header.className = 'open-payments-account-header';
      const title = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = group.name;
      title.appendChild(strong);
      const small = document.createElement('div');
      small.className = 'small muted';
      small.textContent = `${group.rows.length} offen · ${euro(group.total)}`;
      title.appendChild(small);
      header.appendChild(title);
      if (ACCOUNTS_ENABLED && group.account) {
        const availability = getAccountAvailability(group.account, monthKey);
        const chip = createUiEl('span', `status-chip ${availability.missing > 0 ? 'danger' : 'success'}`, availability.missing > 0 ? `fehlt ${euro(availability.missing)}` : `verfügbar ${euro(availability.available)}`);
        header.appendChild(chip);
      } else if (ACCOUNTS_ENABLED) {
        header.appendChild(createUiEl('span', 'status-chip warning', 'Konto fehlt'));
      }
      sub.appendChild(header);

      const table = document.createElement('table');
      table.className = 'list-table compact-table';
      table.innerHTML = '<thead><tr><th>Bereich</th><th>Posten</th><th>Betrag</th><th>Hinweis</th><th></th></tr></thead>';
      const tbody = document.createElement('tbody');
      group.rows.slice(0, compact ? 4 : 999).forEach((row) => {
        const tr = document.createElement('tr');
        const tdGroup = document.createElement('td'); tdGroup.textContent = row.group;
        const tdName = document.createElement('td'); tdName.textContent = row.name;
        const tdAmount = document.createElement('td'); tdAmount.textContent = euro(row.amount);
        const tdNote = document.createElement('td'); tdNote.textContent = row.note || 'offen';
        const tdAction = document.createElement('td');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'secondary small-action';
        btn.textContent = 'Öffnen';
        btn.addEventListener('click', () => switchSection(row.section || 'overview'));
        tdAction.appendChild(btn);
        tr.appendChild(tdGroup); tr.appendChild(tdName); tr.appendChild(tdAmount); tr.appendChild(tdNote); tr.appendChild(tdAction);
        tbody.appendChild(tr);
      });
      if (compact && group.rows.length > 4) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.className = 'muted small';
        td.textContent = `+ ${group.rows.length - 4} weitere offene Posten`;
        tr.appendChild(td);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      sub.appendChild(table);
      card.appendChild(sub);
    });

    if (!compact && data.incoming.length) {
      const sub = document.createElement('div');
      sub.className = 'sub-card';
      const h3 = document.createElement('h3');
      h3.textContent = 'Offene Monatsanteile';
      sub.appendChild(h3);
      const table = document.createElement('table');
      table.className = 'list-table compact-table';
      table.innerHTML = `<thead><tr><th>Person</th>${ACCOUNTS_ENABLED ? '<th>Zielkonto</th>' : ''}<th>Offener Eingang</th><th>Hinweis</th><th></th></tr></thead>`;
      const tbody = document.createElement('tbody');
      data.incoming.forEach((row) => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td'); tdName.textContent = row.name;
        const tdAccount = document.createElement('td'); tdAccount.textContent = row.accountName;
        const tdAmount = document.createElement('td'); tdAmount.textContent = euro(row.amount);
        const tdNote = document.createElement('td'); tdNote.textContent = row.note || '';
        const tdAction = document.createElement('td');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'secondary small-action';
        btn.textContent = 'Gemeinsame Kosten öffnen';
        btn.addEventListener('click', () => switchSection('common'));
        tdAction.appendChild(btn);
        tr.appendChild(tdName);
        if (ACCOUNTS_ENABLED) tr.appendChild(tdAccount);
        tr.appendChild(tdAmount); tr.appendChild(tdNote); tr.appendChild(tdAction);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      sub.appendChild(table);
      card.appendChild(sub);
    }

    if (compact && (data.groups.length > shownGroups.length || data.incoming.length)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary';
      btn.textContent = 'Alle offenen Zahlungen anzeigen';
      btn.addEventListener('click', () => switchSection('openpayments'));
      card.appendChild(btn);
    }
    return card;
  }

  function undoLastBatchPayment() {
    normalizeAppMeta();
    const batch = state.appMeta.lastBatchPayment;
    if (!batch || !isMonthKey(batch.month) || !Array.isArray(batch.items)) return false;
    let restored = 0;
    batch.items.forEach((item) => {
      if (!item || item.type !== 'post' || !item.postId) return;
      const found = findCostPostById(item.postId);
      const post = found && found.post;
      if (!post || !isPostPaidForMonth(post, batch.month)) return;
      setPostPaidForMonth(post, batch.month, false);
      resetDebtPaymentFromPost(post, batch.month);
      restored += 1;
    });
    state.appMeta.lastBatchPayment = null;
    if (restored > 0) {
      addChangeLog('Zahlungen', `${restored} Sammelzahlung(en) zurückgesetzt.`, batch.month);
    }
    saveState();
    render();
    return restored > 0;
  }

  function renderBatchPaymentCard(monthKey, openData = collectOpenPaymentsForMonth(monthKey)) {
    normalizeAppMeta();
    const eligible = (openData.rows || []).filter((row) => row.batchEligible && row.targetType === 'post' && row.targetId);
    const lastBatch = state.appMeta.lastBatchPayment;
    const canUndo = lastBatch && lastBatch.month === monthKey && Array.isArray(lastBatch.items) && lastBatch.items.length > 0;
    if (!eligible.length && !canUndo) return null;

    const box = createUiEl('div', 'sub-card batch-payment-card');
    const head = createUiEl('div', 'compact-section-head');
    head.appendChild(createUiEl('h3', '', 'Regelmäßige Zahlungen gesammelt abhaken'));
    head.appendChild(createUiEl('span', eligible.length ? 'pill warning' : 'pill success', eligible.length ? `${eligible.length} auswählbar` : 'erledigt'));
    box.appendChild(head);
    box.appendChild(createUiEl(
      'p',
      'small muted',
      'Markiere nur Zahlungen, die wirklich abgegangen sind. Einmalige Ausgaben und eigenständige Schuldenzahlungen bleiben zur Sicherheit einzeln.'
    ));

    if (eligible.length) {
      const list = createUiEl('div', 'batch-payment-list');
      const checkboxes = [];
      const totalLine = createUiEl('strong', 'batch-payment-total');
      const updateTotal = () => {
        const selected = checkboxes.filter((entry) => entry.input.checked);
        const total = selected.reduce((sum, entry) => sum + Number(entry.row.amount || 0), 0);
        totalLine.textContent = `${selected.length} ausgewählt · ${euro(total)}`;
      };
      eligible.forEach((row) => {
        const label = document.createElement('label');
        label.className = 'batch-payment-row';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = true;
        input.addEventListener('change', updateTotal);
        const copy = createUiEl('span');
        copy.appendChild(createUiEl('strong', '', row.name));
        copy.appendChild(createUiEl('small', 'muted', `${row.group} · ${euro(row.amount)}`));
        label.appendChild(input);
        label.appendChild(copy);
        list.appendChild(label);
        checkboxes.push({ input, row });
      });
      const details = document.createElement('details');
      details.className = 'compact-details batch-payment-details';
      const summary = document.createElement('summary');
      summary.textContent = `Auswahl prüfen (${eligible.length} Posten)`;
      details.appendChild(summary);
      details.appendChild(list);
      box.appendChild(details);

      const actions = createUiEl('div', 'row batch-payment-actions');
      updateTotal();
      actions.appendChild(totalLine);
      const markButton = document.createElement('button');
      markButton.type = 'button';
      markButton.className = 'success';
      markButton.textContent = 'Ausgewählte als bezahlt markieren';
      markButton.addEventListener('click', () => {
        const selected = checkboxes.filter((entry) => entry.input.checked);
        if (!selected.length) return alert('Bitte mindestens eine Zahlung auswählen.');
        const total = selected.reduce((sum, entry) => sum + Number(entry.row.amount || 0), 0);
        if (!confirm(`${selected.length} Zahlung(en) über insgesamt ${euro(total)} als bezahlt markieren?`)) return;
        const changedItems = [];
        selected.forEach(({ row }) => {
          const found = findCostPostById(row.targetId);
          const post = found && found.post;
          if (!post || isPostPaidForMonth(post, monthKey)) return;
          setPostPaidForMonth(post, monthKey, true);
          syncDebtPaymentFromPost(post, monthKey);
          changedItems.push({ type: 'post', postId: post.id });
        });
        if (!changedItems.length) return;
        state.appMeta.lastBatchPayment = {
          id: generateId(),
          month: monthKey,
          items: changedItems,
          createdAt: new Date().toISOString()
        };
        addChangeLog('Zahlungen', `${changedItems.length} regelmäßige Zahlung(en) gesammelt als bezahlt markiert.`, monthKey);
        saveState();
        render();
      });
      actions.appendChild(markButton);
      box.appendChild(actions);
    }

    if (canUndo) {
      const undo = createUiEl('div', 'notice success batch-payment-undo');
      const created = lastBatch.createdAt ? new Date(lastBatch.createdAt) : null;
      undo.appendChild(createUiEl(
        'span',
        '',
        `${lastBatch.items.length} Sammelzahlung(en) markiert${created && !Number.isNaN(created.getTime()) ? ' · ' + created.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''}.`
      ));
      const undoButton = document.createElement('button');
      undoButton.type = 'button';
      undoButton.className = 'secondary compact';
      undoButton.textContent = 'Rückgängig';
      undoButton.addEventListener('click', () => {
        if (confirm('Die zuletzt gesammelt markierten Zahlungen wieder öffnen?')) undoLastBatchPayment();
      });
      undo.appendChild(undoButton);
      box.appendChild(undo);
    }
    return box;
  }

  function renderOpenPayments() {
    if (!openPaymentsSection) return;
    openPaymentsSection.innerHTML = '';
    openPaymentsSection.appendChild(renderOpenPaymentsOverviewCard(currentMonth, { compact: false }));
  }


  function monthStartStatusKind(done, danger = false) {
    if (done) return 'success';
    return danger ? 'danger' : 'warning';
  }

  function getMonthStartChecklist(monthKey = currentMonth) {
    const items = [];
    const add = (area, title, done, detail, section, actionLabel = 'Öffnen', danger = false) => {
      items.push({ area, title, done: !!done, detail: detail || '', section: section || 'overview', actionLabel, kind: monthStartStatusKind(done, danger) });
    };

    (state.persons || []).forEach((person) => {
      const net = Number(getPersonNet(person, monthKey) || 0);
      if (net > 0) {
        const received = isPersonIncomeReceived(person, monthKey);
        add('Einkommen', `${person.name} Lohn erhalten`, received, received ? `${euro(net)} wurde gebucht.` : `${euro(net)} noch nicht als erhalten markiert.`, 'income');
      }
    });

    const common = computeCommonAccountDetails(monthKey);
    (common.persons || []).forEach((row) => {
      if (Number(row.plannedAmount || row.amount || 0) > 0) {
        const done = Number(row.openAmount || 0) <= 0.005;
        const detail = done
          ? `${euro(row.paidAmount || row.amount)} eingegangen.`
          : (row.paid
            ? `${euro(row.paidAmount)} fixiert eingegangen, ${euro(row.openAmount)} Differenz offen.`
            : `${euro(row.openAmount || row.amount)} noch offen.`);
        add('Gemeinsame Kosten', `${row.person.name} Monatsanteil`, done, detail, 'common');
      }
    });

    const fuel = calculateBudgetTopUp('fuel', monthKey);
    const fuelCfg = getBudgetTopUpConfig('fuel');
    const fuelRestEntered = !fuel.active || Object.prototype.hasOwnProperty.call(fuelCfg.balances || {}, monthKey);
    add('Tankgeld', 'Rest Tankgeld eintragen', fuelRestEntered, fuel.active ? `Rest ${euro(fuel.balance)} · Aufstockung ${euro(fuel.topUp)}.` : 'Aufstockung startet erst ab Juli 2026.', 'tankcalc');

    const groceries = calculateBudgetTopUp('groceries', monthKey);
    const groceriesCfg = getBudgetTopUpConfig('groceries');
    const groceriesRestEntered = !groceries.active || Object.prototype.hasOwnProperty.call(groceriesCfg.balances || {}, monthKey);
    add('Einkaufsgeld', 'Rest Einkaufsgeld eintragen', groceriesRestEntered, groceries.active ? `Rest ${euro(groceries.balance)} · Aufstockung ${euro(groceries.topUp)}.` : 'Startziel ab Juni 2026; Rest-Aufstockung ab Juli 2026.', 'groceries');

    const activeDebtsForBalanceCheck = (state.debts || []).filter((debt) => Number(debt && debt.amountOpen || 0) > 0);
    if (activeDebtsForBalanceCheck.length) {
      const dueBalanceChecks = getDueDebtBalanceChecks(monthKey);
      const monthlyDue = dueBalanceChecks.filter((debt) => debt.balanceCheckMode === 'monthly').length;
      const annualDue = dueBalanceChecks.length - monthlyDue;
      const detail = dueBalanceChecks.length
        ? `${dueBalanceChecks.length} fällig · ${monthlyDue} monatlich, ${annualDue} jährlich.`
        : 'Alle aktuell fälligen Schuldenstände sind erfasst.';
      add('Schulden', 'Schuldenstände prüfen', dueBalanceChecks.length === 0, detail, 'debts', 'Stände prüfen');
    }

    const openPayments = collectOpenPaymentsForMonth(monthKey);
    add('Offene Zahlungen', 'Offene Zahlungen prüfen', openPayments.rows.length === 0, openPayments.rows.length ? `${openPayments.rows.length} offene Zahlung(en) · ${euro(openPayments.totalOpen)}.` : 'Keine offenen Zahlungen gefunden.', 'openpayments', 'Prüfen', openPayments.rows.length > 0);

    const accounts = ACCOUNTS_ENABLED ? (state.accounts || []) : [];
    if (accounts.length) {
      const reconciledThisMonth = accounts.filter((account) => {
        if (!account.lastReconciledAt) return false;
        const recDate = new Date(account.lastReconciledAt);
        if (Number.isNaN(recDate.getTime())) return false;
        return dateToMonthKey(recDate) === monthKey;
      }).length;
      add('Konten', 'Kontenabgleich prüfen', reconciledThisMonth === accounts.length, `${reconciledThisMonth} von ${accounts.length} Konto/Konten in ${formatMonthLabel(monthKey)} abgeglichen.`, 'sharedaccount', 'Konten öffnen');
    }

    normalizeAppMeta();
    const automaticBackupDate = state.appMeta.lastAutomaticBrowserBackupAt ? new Date(state.appMeta.lastAutomaticBrowserBackupAt) : null;
    const automaticBackupAge = automaticBackupDate && !Number.isNaN(automaticBackupDate.getTime())
      ? Date.now() - automaticBackupDate.getTime()
      : Number.POSITIVE_INFINITY;
    const automaticBackupFresh = automaticBackupAge < 8 * 24 * 60 * 60 * 1000;
    const automaticBackupDetail = automaticBackupFresh
      ? `Automatische Browser-Sicherung: ${automaticBackupDate.toLocaleString('de-DE')}.`
      : 'Die tägliche Browser-Sicherung wird beim Öffnen automatisch angelegt.';
    add('Sichern', 'Automatische Sicherung', automaticBackupFresh, automaticBackupDetail, 'save', 'Sicherung öffnen');

    const dataItems = getDataCheckItems();
    const critical = dataItems.filter((item) => item.kind === 'warning' || item.kind === 'danger').length;
    add('Datencheck', 'Datencheck prüfen', critical === 0, critical ? `${critical} Hinweis(e) oder Fehler vorhanden.` : 'Keine kritischen Hinweise.', 'datacheck', 'Datencheck', critical > 0);

    add('Monatsabschluss', 'Monat noch nicht abschließen?', !isMonthClosed(monthKey), isMonthClosed(monthKey) ? 'Monat ist bereits abgeschlossen.' : 'Monat ist noch offen und kann vorbereitet werden.', 'monthclose', 'Monatsabschluss');
    return items;
  }

  function renderMonthStartChecklist(monthKey = currentMonth, options = {}) {
    const compact = options.compact === true;
    const items = getMonthStartChecklist(monthKey);
    const done = items.filter((item) => item.done).length;
    const open = items.length - done;
    const danger = items.filter((item) => item.kind === 'danger').length;
    const card = document.createElement('div');
    card.className = compact ? 'card compact-card month-start-card' : 'card month-start-card';
    const head = document.createElement('div');
    head.className = 'compact-section-head';
    head.appendChild(createUiEl(compact ? 'h3' : 'h2', '', compact ? 'Monatsstart' : `Monatsstart-Assistent · ${formatMonthLabel(monthKey)}`));
    head.appendChild(createUiEl('span', danger > 0 ? 'pill danger' : (open > 0 ? 'pill warning' : 'pill success'), open > 0 ? `${open} offen` : 'bereit'));
    card.appendChild(head);
    card.appendChild(createSummaryMetrics([
      { label: 'Erledigt', value: `${done}/${items.length}`, kind: open === 0 ? 'success' : 'warning' },
      { label: 'Offen', value: String(open), kind: open > 0 ? 'warning' : 'success' },
      { label: 'Kritisch', value: String(danger), kind: danger > 0 ? 'danger' : 'success' },
      { label: 'Monat', value: formatMonthLabel(monthKey) }
    ]));

    const list = document.createElement('div');
    list.className = compact ? 'month-start-list compact' : 'month-start-list';
    items.slice(0, compact ? 5 : 999).forEach((item) => {
      const row = document.createElement('div');
      row.className = `month-start-row ${item.kind}`;
      const left = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.title;
      const detail = document.createElement('small');
      detail.className = 'muted';
      detail.textContent = item.detail;
      left.appendChild(title);
      left.appendChild(detail);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `month-start-action ${item.done ? 'view' : 'check'}`;
      btn.textContent = item.done ? 'Ansehen' : item.actionLabel;
      btn.addEventListener('click', () => switchSection(item.section || 'overview'));
      row.appendChild(left);
      row.appendChild(btn);
      list.appendChild(row);
    });
    if (compact && items.length > 5) {
      const more = createUiEl('div', 'small muted', `+ ${items.length - 5} weitere Prüfpunkte`);
      list.appendChild(more);
    }
    card.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'row month-start-actions';
    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.className = 'success';
    syncBtn.textContent = 'Aufstockungen übernehmen';
    syncBtn.addEventListener('click', () => {
      syncFuelTopUpExpenses(monthKey);
      syncGroceryTopUpExpense(monthKey);
      saveState();
      render();
    });
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'secondary';
    openBtn.textContent = compact ? 'Assistent öffnen' : 'Offene Zahlungen öffnen';
    openBtn.addEventListener('click', () => switchSection(compact ? 'monthstart' : 'openpayments'));
    actions.appendChild(syncBtn);
    actions.appendChild(openBtn);
    card.appendChild(actions);
    return card;
  }

  function renderMonthStart() {
    if (!monthStartSection) return;
    monthStartSection.innerHTML = '';
    monthStartSection.appendChild(renderMonthStartChecklist(currentMonth, { compact: false }));
  }

  function getDataCheckAssistantItems(items = getDataCheckItems()) {
    return (items || []).filter((item) => item && (item.kind === 'warning' || item.kind === 'danger'));
  }

  function getDataCheckItemSection(item) {
    const area = normalizeDataCheckAreaName(item && item.area || '');
    if (area === 'Schulden') return 'debts';
    if (area === 'Konten') return 'sharedaccount';
    if (area === 'Einkommen') return 'income';
    if (area === 'Gemeinsame Kosten') return 'common';
    if (area === 'Persönliche Ausgaben') return 'personal';
    if (area === 'Sonstige Ausgaben') return 'buffer';
    if (area === 'Rücklagen' || area === 'Rücklagen & Sparen') return 'savings';
    if (area === 'Kraftstoffkonto' || area === 'Tankgeld') return 'tankcalc';
    if (area === 'Monat') return 'overview';
    return 'datacheck';
  }

  function renderDataCheckItemActions(item, options = {}) {
    const actions = document.createElement('div');
    actions.className = options.compact ? 'button-row compact' : 'button-row';
    const addButton = (label, className, onClick, title = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = className || 'secondary';
      btn.textContent = label;
      if (title) btn.title = title;
      btn.addEventListener('click', onClick);
      actions.appendChild(btn);
      return btn;
    };
    const finish = () => {
      if (typeof options.afterAction === 'function') options.afterAction(item);
    };
    const beforeOpenEditor = () => {
      if (typeof options.beforeOpenEditor === 'function') options.beforeOpenEditor(item);
    };
    const beforeNavigate = (section) => {
      if (typeof options.beforeNavigate === 'function') options.beforeNavigate(item, section);
    };

    if (item.checkType === 'missing-linked-debt-payment') {
      const linked = getAllCostPosts().find(({ post }) => post && post.id === item.postId);
      const post = linked && linked.post;
      const amount = Number(item.paymentAmount || 0);
      if (post && amount > 0) {
        addButton(`Zahlung ${euro(amount)} übernehmen`, 'success', () => {
          if (!confirm(`Wurde ${euro(amount)} für "${post.name}" bezahlt und ist dieser Betrag in der gespeicherten Restschuld noch NICHT abgezogen? Die Restschuld wird einmalig vermindert; der Bankstand bleibt unverändert.`)) return;
          if (!repairMissingDebtPaymentFromPost(post, item.paidMonth, true)) return alert('Diese Schuldzahlung ist bereits erfasst oder konnte nicht übernommen werden.');
          saveState();
          render();
          finish();
        }, 'Ergänzt den Schuldzahlungsnachweis und vermindert die gespeicherte Restschuld einmalig.');
        addButton('Nur Nachweis ergänzen', 'secondary', () => {
          if (!confirm(`Ist die Zahlung von ${euro(amount)} für "${post.name}" bereits im angezeigten Restschuldstand enthalten? Dann wird nur der Nachweis ergänzt; Restschuld und Bankstand bleiben unverändert.`)) return;
          if (!repairMissingDebtPaymentFromPost(post, item.paidMonth, false)) return alert('Diese Schuldzahlung ist bereits erfasst oder konnte nicht ergänzt werden.');
          saveState();
          render();
          finish();
        }, 'Vermerkt die Zahlung als bezahlt, ohne die bereits aktuelle Restschuld nochmals zu vermindern.');
        addButton('Nicht bezahlt: Status zurücksetzen', 'secondary', () => {
          if (!confirm(`Wurde "${post.name}" in ${formatMonthLabel(item.paidMonth)} nicht bezahlt? Der Bezahlt-Status wird zurückgesetzt; Restschuld und Bankstand bleiben unverändert.`)) return;
          setPostPaidForMonth(post, item.paidMonth, false);
          resetDebtPaymentFromPost(post, item.paidMonth);
          saveState();
          render();
          finish();
        }, 'Öffnet den Kostenposten wieder; eine fehlende Zahlung wird nicht erfunden.');
      }
    }

    if (item.checkType === 'debt-open-plan') {
      const debt = (state.debts || []).find((entry) => entry && entry.id === item.debtId);
      if (debt) {
        addButton('Rate eintragen', 'primary', () => {
          beforeOpenEditor();
          showDebtRateEditor(debt);
        });
        addButton('Schuld öffnen', 'secondary', () => {
          beforeNavigate('debts');
          switchSection('debts');
        });
      }
    }

    if (item.checkType === 'tax-refund-suspicious') {
      const refund = (state.taxRefunds || []).find((entry) => entry && entry.id === item.refundId);
      if (refund) {
        addButton('Erstattung bearbeiten', 'primary', () => {
          beforeOpenEditor();
          showTaxRefundEditor(refund);
        });
        addButton('Kleine Erstattung löschen', 'danger', () => {
          if (!confirm(`Soll die einzelne Erstattung ${euro(Number(item.amount || 0))} gelöscht werden? Das ist sinnvoll, wenn es kein echter zweiter Eingang war.`)) return;
          removeTaxRefundAccountBooking(refund);
          state.taxRefunds = (state.taxRefunds || []).filter((entry) => entry && entry.id !== refund.id);
          addChangeLog('Steuererstattung', `Auffällige Einzel-Erstattung ${euro(Number(item.amount || 0))} gelöscht.`, currentMonth);
          saveState();
          render();
          finish();
        });
        addButton('Steuererstattung öffnen', 'secondary', () => {
          beforeNavigate('taxrefund');
          switchSection('taxrefund');
        });
      }
    }

    if (ACCOUNTS_ENABLED && item.checkType === 'paid-unbooked-post') {
      const found = findCostPostById(item.postId);
      const post = found && found.post;
      if (post) {
        addButton('Nur Nachweis ergänzen', 'secondary', () => {
          if (!confirm(`Soll "${post.name || 'Posten'}" nur als Nachweis in die Konto-Historie? Der Bankstand bleibt unverändert.`)) return;
          if (!addPostStatusOnlyProof(post, item.paidMonth)) return alert('Der Nachweis konnte nicht ergänzt werden.');
          saveState();
          render();
          finish();
        }, 'Ergänzt eine Historienzeile ohne Bankstandsänderung.');
        if (item.balanceDebited) {
          addButton('Alten Kontoabzug als Historie nachtragen', 'primary', () => {
            if (!confirm(`War "${post.name || 'Posten'}" bereits im Bankstand abgezogen? Dann wird nur die Historie ergänzt; der Bankstand bleibt unverändert.`)) return;
            if (!backfillPostAccountTransactionFromLegacy(post, item.paidMonth, getPostAccountBalanceDebit(post, item.paidMonth))) return alert('Die Historie konnte nicht ergänzt werden.');
            saveState();
            render();
            finish();
          }, 'Ergänzt die fehlende Historie, ohne den Bankstand erneut zu verändern.');
        } else {
          addButton('Kontoabzug + Historie buchen', 'success', () => {
            if (!confirm(`Soll "${post.name || 'Posten'}" jetzt vom verknüpften Konto abgezogen und in die Historie geschrieben werden?`)) return;
            if (!bookPostPaymentForMonth(post, item.paidMonth)) return alert('Die Kontobuchung konnte nicht erstellt werden.');
            saveState();
            render();
            finish();
          }, 'Bucht die Zahlung einmalig vom verknüpften Konto ab.');
        }
      }
    }

    if (item.checkType === 'runtime-issue') {
      addButton('Fehler ausblenden', 'secondary', () => {
        if (!confirm('Aktuelle Laufzeitfehler ausblenden? Neue Fehler werden wieder angezeigt.')) return;
        clearRuntimeIssues();
        render();
        finish();
      });
    }

    const hasSpecificSectionButton = item.checkType === 'debt-open-plan' || item.checkType === 'tax-refund-suspicious';
    if (options.includeOpenSection && !hasSpecificSectionButton) {
      const section = getDataCheckItemSection(item);
      const label = section === 'datacheck' ? 'Datencheck öffnen' : 'Bereich öffnen';
      addButton(label, actions.childElementCount ? 'secondary' : 'primary', () => {
        beforeNavigate(section);
        switchSection(section);
      });
    }
    return actions.childElementCount ? actions : null;
  }

  function showDataCheckAssistantModal(startIndex = 0) {
    const items = getDataCheckAssistantItems(getDataCheckItems());
    let modalApi = null;
    const closeAssistant = () => {
      if (modalApi && typeof modalApi.close === 'function') modalApi.close();
    };
    const reopenAt = (index) => {
      closeAssistant();
      setTimeout(() => showDataCheckAssistantModal(index), 0);
    };
    const content = document.createElement('div');
    content.className = 'modal-form data-check-assistant';
    if (!items.length) {
      content.appendChild(createSummaryMetrics([
        { label: 'Offene Prüfungen', value: '0', kind: 'success' },
        { label: 'Monat', value: formatMonthLabel(currentMonth) }
      ]));
      const ok = createUiEl('div', 'notice success');
      ok.innerHTML = '<strong>Alles sauber.</strong><br>Der Datencheck hat aktuell keine Punkte, die eine Entscheidung brauchen.';
      content.appendChild(ok);
      modalApi = showModal('Datencheck-Assistent', content, [
        { label: 'Schließen', className: 'primary' }
      ]);
      return modalApi;
    }

    const index = Math.max(0, Math.min(Number(startIndex || 0), items.length - 1));
    const item = items[index];
    const label = item.kind === 'danger' ? 'Fehler' : 'Prüfen';
    const cls = item.kind === 'danger' ? 'danger' : 'warning';
    content.appendChild(createSummaryMetrics([
      { label: 'Schritt', value: `${index + 1} von ${items.length}` },
      { label: 'Bereich', value: normalizeDataCheckAreaName(item.area || '-') },
      { label: 'Status', value: label, kind: cls }
    ]));
    const step = createUiEl('div', `notice ${cls}`);
    step.appendChild(createUiEl('strong', '', item.title || 'Prüfung'));
    step.appendChild(createUiEl('p', 'small', item.detail || 'Bitte prüfen.'));
    content.appendChild(step);

    const explanation = createUiEl('div', 'sub-card');
    explanation.appendChild(createUiEl('h3', '', 'Was soll passieren?'));
    const actions = renderDataCheckItemActions(item, {
      includeOpenSection: true,
      afterAction: () => reopenAt(index),
      beforeOpenEditor: closeAssistant,
      beforeNavigate: closeAssistant
    });
    if (actions) explanation.appendChild(actions);
    else explanation.appendChild(createUiEl('p', 'small muted', 'Für diesen Hinweis gibt es keine automatische Reparatur. Öffne den Bereich und entscheide dort fachlich.'));
    content.appendChild(explanation);

    const hint = createUiEl('p', 'small muted', 'Der Assistent verändert nichts heimlich. Jeder Schritt braucht deine Entscheidung, damit keine Doppelzählung entsteht.');
    content.appendChild(hint);

    const buttons = [
      { label: 'Schließen', className: 'secondary' }
    ];
    if (index > 0) {
      buttons.push({ label: 'Zurück', className: 'secondary', onClick: (close) => { close(); showDataCheckAssistantModal(index - 1); } });
    }
    buttons.push({
      label: index < items.length - 1 ? 'Weiter' : 'Fertig',
      className: 'primary',
      onClick: (close) => {
        close();
        if (index < items.length - 1) showDataCheckAssistantModal(index + 1);
      }
    });
    modalApi = showModal('Datencheck-Assistent', content, buttons);
    return modalApi;
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
    const runtimeNotice = renderRuntimeIssueNotice({ compact: true });
    if (runtimeNotice) card.appendChild(runtimeNotice);

    const areaTitle = document.createElement('h3');
    areaTitle.textContent = 'Bereiche im Überblick';
    card.appendChild(areaTitle);
    card.appendChild(renderDataCheckAreaOverview(items));

    const repairRow = document.createElement('div');
    repairRow.className = 'row';
    const repairBtn = document.createElement('button');
    repairBtn.className = 'success';
    repairBtn.textContent = 'Daten jetzt reparieren';
    repairBtn.addEventListener('click', () => {
      const changes = syncAllLinkedDebtRatesFromPosts(currentMonth, 36, { silent: false });
      normalizeAllPersonConfigs();
      normalizeAllPostConfigs();
      normalizeAllDebtConfigs();
      saveState();
      alert(changes > 0 ? `${changes} Schuldenrate(n) wurden aus verknüpften Kostenposten synchronisiert.` : 'Keine automatische Schuldenkorrektur nötig.');
      render();
    });
    const repairHint = document.createElement('p');
    repairHint.className = 'small muted';
    repairHint.textContent = 'Synchronisiert verknüpfte Schuldenraten für die nächsten 36 Monate. Monatliche Ist-Auszahlungen pflegst du bewusst im Bereich Einkommen.';
    const auditBtn = document.createElement('button');
    auditBtn.className = 'secondary';
    auditBtn.type = 'button';
    auditBtn.textContent = 'App prüfen';
    auditBtn.addEventListener('click', showInternalAppAuditModal);
    const assistantBtn = document.createElement('button');
    assistantBtn.className = warnings > 0 ? 'primary' : 'secondary';
    assistantBtn.type = 'button';
    assistantBtn.textContent = warnings > 0 ? 'Assistent starten' : 'Assistent öffnen';
    assistantBtn.addEventListener('click', () => showDataCheckAssistantModal());
    repairRow.appendChild(repairBtn);
    repairRow.appendChild(assistantBtn);
    repairRow.appendChild(auditBtn);
    repairRow.appendChild(repairHint);
    card.appendChild(repairRow);



    const table = document.createElement('table');
    table.className = 'list-table';
    table.innerHTML = '<thead><tr><th>Status</th><th>Bereich</th><th>Prüfung</th><th>Details</th></tr></thead>';
    const tbody = document.createElement('tbody');
    items.forEach((item) => {
      const tr = document.createElement('tr');
      const label = item.kind === 'success' ? 'OK' : (item.kind === 'warning' ? 'Prüfen' : (item.kind === 'danger' ? 'Fehler' : 'Info'));
      const cls = item.kind === 'success' ? 'success' : (item.kind === 'warning' ? 'warning' : (item.kind === 'danger' ? 'danger' : ''));
      tr.innerHTML = `<td><span class="pill ${cls}">${label}</span></td><td>${item.area}</td><td>${item.title}</td><td>${item.detail}</td>`;
      const actions = renderDataCheckItemActions(item);
      if (actions) tr.children[3].appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    return card;
  }

  function renderOverviewDataCheckSummaryCard() {
    const items = getDataCheckItems();
    const warnings = items.filter((item) => item.kind === 'warning' || item.kind === 'danger').length;
    const info = items.filter((item) => item.kind === 'info').length;
    const card = createUiEl('div', 'card compact-card overview-status-card');
    const head = createUiEl('div', 'compact-section-head');
    head.appendChild(createUiEl('h3', '', 'Datencheck'));
    head.appendChild(createUiEl('span', warnings > 0 ? 'pill warning' : 'pill success', warnings > 0 ? `${warnings} Hinweis(e) prüfen` : 'OK'));
    card.appendChild(head);
    card.appendChild(createUiEl('p', 'small muted', info > 0 ? `${info} zusätzliche Info-Hinweise im Datencheck.` : 'Keine kritischen Datenfehler gefunden.'));
    card.appendChild(renderDataCheckAreaOverview(items, { compact: true }));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary compact';
    btn.textContent = 'Datencheck öffnen';
    btn.addEventListener('click', () => { currentSection = 'datacheck'; render(); });
    card.appendChild(btn);
    if (warnings > 0) {
      const assistantBtn = document.createElement('button');
      assistantBtn.type = 'button';
      assistantBtn.className = 'primary compact';
      assistantBtn.textContent = 'Assistent starten';
      assistantBtn.addEventListener('click', () => showDataCheckAssistantModal());
      card.appendChild(assistantBtn);
    }
    return card;
  }

  // Rendert die Übersicht


  function getIncomeBreakdownForMonth(monthKey) {
    const personsData = (state.persons || []).map((person) => ({
      person,
      income: getPersonNet(person, monthKey),
      commonShare: 0,
      personalDue: 0
    }));
    let totalCommonRaw = 0;
    (state.commonCosts || []).forEach((cost) => {
      if (isPostActiveInMonth(cost, monthKey)) totalCommonRaw += getCommonMonthlyShare(cost, monthKey);
    });
    const shareMap = computeRoundedCommonShares(
      totalCommonRaw,
      personsData.map((pd) => ({ person: pd.person, income: pd.income })),
      monthKey
    );
    personsData.forEach((pd) => {
      pd.commonShare = shareMap[pd.person.id] || 0;
    });
    (state.personalCosts || []).forEach((cost) => {
      if (isDue(cost, monthKey)) {
        const target = personsData.find((pd) => pd.person.id === cost.personId);
        if (target) target.personalDue += getEffectiveAmountForMonth(cost, monthKey);
      }
    });
    return personsData;
  }

  function renderIncomeBreakdownCard(personsData, options = {}) {
    const monthLabel = formatMonthLabel(options.monthKey || currentMonth);
    const totalIncome = (personsData || []).reduce((sum, pd) => sum + Number(pd.income || 0), 0);
    const totalCommon = (personsData || []).reduce((sum, pd) => sum + Number(pd.commonShare || 0), 0);
    const totalPersonal = (personsData || []).reduce((sum, pd) => sum + Number(pd.personalDue || 0), 0);
    const totalAvailable = (personsData || []).reduce((sum, pd) => sum + (Number(pd.income || 0) - Number(pd.commonShare || 0) - Number(pd.personalDue || 0)), 0);
    const percentOf = (value, base) => !base ? '0,0 %' : `${((Number(value || 0) / Number(base || 1)) * 100).toFixed(1).replace('.', ',')} %`;
    const div = (cls, text) => {
      const el = document.createElement('div');
      if (cls) el.className = cls;
      if (text !== undefined && text !== null) el.textContent = text;
      return el;
    };
    const makeIcon = (symbol, cls = '') => {
      const el = div(`modern-icon ${cls}`.trim());
      el.setAttribute('aria-hidden', 'true');
      el.textContent = symbol;
      return el;
    };

    const card = div('income-breakdown-card');
    const head = div('income-breakdown-head');
    const titleWrap = div('');
    const title = document.createElement('h3');
    title.textContent = options.title || 'Einkommensübersicht';
    const sub = document.createElement('p');
    sub.className = 'muted';
    sub.textContent = options.subtitle || `Aufteilung für ${monthLabel}`;
    titleWrap.appendChild(title);
    titleWrap.appendChild(sub);
    head.appendChild(titleWrap);
    const total = div('income-breakdown-total');
    total.appendChild(div('small muted', 'Verfügbar gesamt'));
    total.appendChild(div('income-breakdown-total-value', euro(totalAvailable)));
    head.appendChild(total);
    card.appendChild(head);

    const totals = div('income-breakdown-totals');
    [
      ['Netto gesamt', euro(totalIncome)],
      ['Gemeinsame Anteile', euro(totalCommon)],
      ['Persönliche Ausgaben', euro(totalPersonal)]
    ].forEach(([label, value]) => {
      const box = div('income-breakdown-total-box');
      box.appendChild(div('small muted', label));
      box.appendChild(div('income-breakdown-total-box-value', value));
      totals.appendChild(box);
    });
    card.appendChild(totals);

    const peopleGrid = div('person-modern-grid income-breakdown-people');
    (personsData || []).forEach((pd) => {
      const available = Number(pd.income || 0) - Number(pd.commonShare || 0) - Number(pd.personalDue || 0);
      const personCard = div('person-modern-card');
      const top = div('person-modern-top');
      const left = div('person-modern-title');
      const avatar = div('person-avatar', (pd.person.name || '?').trim().charAt(0).toUpperCase());
      left.appendChild(avatar);
      const name = document.createElement('h3');
      name.textContent = pd.person.name;
      left.appendChild(name);
      top.appendChild(left);
      if (options.showEdit !== false) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'Bearbeiten';
        editBtn.className = 'secondary compact edit-pill';
        editBtn.addEventListener('click', () => showPersonIncomeEditor(pd.person));
        top.appendChild(editBtn);
      }
      personCard.appendChild(top);
      const rows = div('person-modern-rows');
      [
        ['▣', 'Netto', euro(pd.income), ''],
        ['♟', 'Anteil gemeinsame Kosten', euro(pd.commonShare), percentOf(pd.commonShare, pd.income)],
        ['◷', 'Persönliche Ausgaben', euro(pd.personalDue), percentOf(pd.personalDue, pd.income)]
      ].forEach(([icon, label, value, detail]) => {
        const row = div('person-modern-row');
        row.appendChild(makeIcon(icon, 'tiny'));
        row.appendChild(div('person-modern-label', label));
        const valueWrap = div('person-modern-value-wrap');
        valueWrap.appendChild(div('person-modern-value', value));
        if (detail) valueWrap.appendChild(div('person-modern-sub', detail));
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
    card.appendChild(peopleGrid);
    return card;
  }

  function renderOverviewLegacy() {
    overviewSection.innerHTML = '';

    const details = computeMonthDetails(currentMonth);
    const commonAccountTarget = getCommonAccountTargetSummary(currentMonth);
    const personsData = details.personsData;
    const totalIncome = details.totalIncome;
    const totalCommonRounded = details.totalCommonRounded;
    const totalPersonal = details.totalPersonal;
    const totalAvailBeforeBuffer = details.freeBeforeMisc;
    const miscPaid = details.miscPaid;
    const miscOpen = details.miscOpen;
    const miscPlanned = details.miscPlanned;
    const totalAvail = details.free;

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
    function appendSafe(parent, builder, label) {
      try {
        const node = typeof builder === 'function' ? builder() : builder;
        if (node) parent.appendChild(node);
        return node;
      } catch (err) {
        recordRuntimeIssue('Übersicht', `${label || 'Block'} konnte nicht geladen werden`, err);
        const fallback = div('card compact-card notice warning');
        fallback.innerHTML = `<strong>${label || 'Block'} konnte nicht geladen werden.</strong><p class="small muted">Die Übersicht bleibt nutzbar. Details findest du im jeweiligen Bereich.</p>`;
        parent.appendChild(fallback);
        return fallback;
      }
    }
    function insertSafeBefore(parent, builder, beforeNode, label) {
      try {
        const node = typeof builder === 'function' ? builder() : builder;
        if (node) parent.insertBefore(node, beforeNode || null);
        return node;
      } catch (err) {
        recordRuntimeIssue('Übersicht', `${label || 'Block'} konnte nicht geladen werden`, err);
        return null;
      }
    }

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
    tools.appendChild(createDashboardToolButton('Prüfen', 'datacheck'));
    tools.appendChild(createDashboardToolButton('Sichern', 'save'));
    header.appendChild(tools);
    page.appendChild(header);

    appendSafe(page, () => renderRuntimeIssueNotice(), 'Fehlerwächter');
    appendSafe(page, () => renderMonthStatusPanel(currentMonth, computeMonthDetails(currentMonth)), 'Monatsstatus');
    appendSafe(page, () => createOverviewQuickStartCard(details), 'Schnellstart');
    appendSafe(page, () => renderMonthStartChecklist(currentMonth, { compact: true }), 'Monatsstart');

    const kpiGrid = div('dash-kpi-grid');
    const freeHint = miscOpen > 0
      ? `konservativ gerechnet: ${euro(miscOpen)} offen geplant schon abgezogen · aktuell nach bezahlten sonstigen Ausgaben: ${euro(details.freeCurrent)}`
      : (miscPaid > 0 ? `vor sonstigen Ausgaben: ${euro(totalAvailBeforeBuffer)}` : 'Monatsrest für Töpfe');
    kpiGrid.appendChild(createKpi({
      label: 'Sicher verfügbar',
      value: euro(totalAvail),
      hint: freeHint,
      icon: totalAvail >= 0 ? '▣' : '!',
      hero: true,
      accent: totalAvail < 0 ? 'danger' : '',
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
      label: 'Diesen Monat gemeinsam einzahlen',
      value: euro(commonAccountTarget.monthlyTarget),
      hint: `Jetzt noch für offene Abbuchungen nötig: ${euro(commonAccountTarget.openTotal)}`,
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
      miscStrip.appendChild(createBufferItem('●', 'Sonstige Ausgaben insgesamt geplant', euro(miscPlanned)));
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
        chip.textContent = `${item.label}: ${euro(item.free)}`;
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

    appendSafe(page, () => renderTodoCard(currentMonth), 'Heute / diesen Monat offen');

    appendSafe(page, () => renderOpenPaymentsOverviewCard(currentMonth, { compact: true }), 'Offene Zahlungen');

    appendSafe(page, () => { const taxPotOverview = renderTaxRefundPotCard(); if (taxPotOverview && taxPotOverview.classList) taxPotOverview.classList.add('overview-tax-pot-card'); return taxPotOverview; }, 'Steuererstattungs-Topf');

    appendSafe(page, () => renderMonthCompareCard(currentMonth), 'Monatsvergleich');

    const incomeLinkCard = div('card compact-card overview-income-link-card');
    const incomeLinkTitle = document.createElement('h3');
    incomeLinkTitle.textContent = 'Einkommen & Aufteilung';
    incomeLinkCard.appendChild(incomeLinkTitle);
    const incomeLinkText = document.createElement('p');
    incomeLinkText.className = 'small muted';
    incomeLinkText.textContent = 'Die detaillierte Aufteilung nach Personen findest du jetzt im Bereich Einkommen. Die Übersicht bleibt dadurch bewusst schlank.';
    incomeLinkCard.appendChild(incomeLinkText);
    const incomeLinkBtn = document.createElement('button');
    incomeLinkBtn.type = 'button';
    incomeLinkBtn.className = 'secondary compact';
    incomeLinkBtn.textContent = 'Zum Einkommen';
    incomeLinkBtn.addEventListener('click', () => {
      currentSection = 'income';
      render();
    });
    incomeLinkCard.appendChild(incomeLinkBtn);
    page.appendChild(incomeLinkCard);

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
    const compactGrid = div('overview-compact-grid');
    appendSafe(compactGrid, () => renderOverviewDataCheckSummaryCard(), 'Datencheck');
    appendSafe(compactGrid, () => renderWarningsCard(currentMonth), 'Warnungen');
    overviewSection.appendChild(compactGrid);

    const logDetails = document.createElement('details');
    logDetails.className = 'compact-details';
    const logSummary = document.createElement('summary');
    logSummary.textContent = 'Änderungsprotokoll anzeigen';
    logDetails.appendChild(logSummary);
    appendSafe(logDetails, () => renderChangeLogCard(5), 'Änderungsprotokoll');
    overviewSection.appendChild(logDetails);
  }

  function renderOverview() {
    overviewSection.innerHTML = '';

    const details = computeMonthDetails(currentMonth);
    const commonAccountTarget = getCommonAccountTargetSummary(currentMonth);
    const openPayments = collectOpenPaymentsForMonth(currentMonth);
    const page = createUiEl('div', 'dashboard-page simplified-dashboard');

    const appendSafe = (parent, builder, label) => {
      try {
        const node = typeof builder === 'function' ? builder() : builder;
        if (node) parent.appendChild(node);
        return node;
      } catch (err) {
        recordRuntimeIssue('Übersicht', `${label || 'Block'} konnte nicht geladen werden`, err);
        const fallback = createUiEl('div', 'card compact-card notice warning');
        fallback.appendChild(createUiEl('strong', '', `${label || 'Block'} konnte nicht geladen werden.`));
        fallback.appendChild(createUiEl('p', 'small muted', 'Die übrige Übersicht bleibt nutzbar.'));
        parent.appendChild(fallback);
        return fallback;
      }
    };

    const header = createUiEl('div', 'dashboard-header simplified-dashboard-header');
    const titleWrap = createUiEl('div', 'dashboard-title-wrap');
    titleWrap.appendChild(createUiEl('h2', '', 'Übersicht'));
    titleWrap.appendChild(createUiEl('p', '', `${formatMonthLabel(currentMonth)} · nur das, was jetzt wichtig ist`));
    header.appendChild(titleWrap);
    page.appendChild(header);

    appendSafe(page, () => renderRuntimeIssueNotice(), 'Fehlerwächter');

    const kpiGrid = createUiEl('div', 'dash-kpi-grid simplified-kpi-grid');
    const addKpi = ({ label, value, hint, icon, kind = '' }) => {
      const card = createUiEl('div', `dash-kpi simplified-kpi ${kind}`.trim());
      const top = createUiEl('div', 'dash-kpi-top');
      top.appendChild(createUiEl('div', 'modern-icon', icon));
      top.appendChild(createUiEl('div', 'dash-kpi-label', label));
      card.appendChild(top);
      card.appendChild(createUiEl('div', 'dash-kpi-value', value));
      card.appendChild(createUiEl('div', 'dash-kpi-hint', hint));
      kpiGrid.appendChild(card);
    };

    addKpi({
      label: 'Jetzt für gemeinsame Kosten nötig',
      value: euro(commonAccountTarget.openTotal),
      hint: `Monatsbedarf ${euro(commonAccountTarget.dueTotal)} · bereits bezahlt ${euro(commonAccountTarget.paidTotal)}`,
      icon: '👥',
      kind: commonAccountTarget.openTotal > 0 ? 'blue' : 'mint'
    });
    addKpi({
      label: 'Sicher frei',
      value: euro(details.free),
      hint: details.miscOpen > 0
        ? `${euro(details.miscOpen)} offene sonstige Ausgaben sind bereits abgezogen`
        : 'Nach allen geplanten Kosten dieses Monats',
      icon: details.free >= 0 ? '✓' : '!',
      kind: details.free >= 0 ? 'mint' : 'danger'
    });
    addKpi({
      label: 'Offene Zahlungen',
      value: String(openPayments.rows.length),
      hint: openPayments.rows.length
        ? `Noch ${euro(openPayments.totalOpen)} zu prüfen oder zu bezahlen`
        : 'Keine offenen Zahlungen gefunden',
      icon: '◷',
      kind: openPayments.rows.length ? 'violet' : 'mint'
    });
    page.appendChild(kpiGrid);

    const tasks = getMonthStartChecklist(currentMonth)
      .filter((item) => !item.done)
      .sort((a, b) => {
        const rank = { danger: 0, warning: 1, info: 2, success: 3 };
        return (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9);
      });
    const focusCard = createUiEl('div', 'card overview-focus-card');
    const focusHead = createUiEl('div', 'compact-section-head');
    focusHead.appendChild(createUiEl('h3', '', 'Jetzt erledigen'));
    focusHead.appendChild(createUiEl(
      'span',
      tasks.length ? 'pill warning' : 'pill success',
      tasks.length ? `${tasks.length} offen` : 'alles vorbereitet'
    ));
    focusCard.appendChild(focusHead);
    focusCard.appendChild(createUiEl(
      'p',
      'small muted',
      'Laufende Kosten, Aufstockungen und verknüpfte Schuldenraten werden beim Monatswechsel automatisch vorbereitet. Hier erscheinen nur Punkte, die noch eine Entscheidung brauchen.'
    ));

    if (!tasks.length) {
      focusCard.appendChild(createUiEl('div', 'empty-state success', 'Für diesen Monat ist nichts Weiteres offen.'));
    } else {
      const taskList = createUiEl('div', 'todo-list overview-focus-list');
      tasks.slice(0, 5).forEach((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `todo-row ${item.kind || ''}`.trim();
        const copy = document.createElement('span');
        copy.appendChild(createUiEl('strong', '', item.title));
        copy.appendChild(createUiEl('small', '', item.detail));
        row.appendChild(copy);
        row.appendChild(createUiEl('b', '', item.actionLabel || 'Öffnen'));
        row.addEventListener('click', () => switchSection(item.section || 'overview'));
        taskList.appendChild(row);
      });
      focusCard.appendChild(taskList);
      if (tasks.length > 5) {
        focusCard.appendChild(createUiEl('p', 'small muted', `+ ${tasks.length - 5} weitere Aufgabe(n) im Monatsstart`));
      }
    }

    const focusActions = createUiEl('div', 'row overview-focus-actions');
    const monthStartButton = document.createElement('button');
    monthStartButton.type = 'button';
    monthStartButton.className = 'secondary compact';
    monthStartButton.textContent = 'Monatsstart öffnen';
    monthStartButton.addEventListener('click', () => switchSection('monthstart'));
    const quickButton = document.createElement('button');
    quickButton.type = 'button';
    quickButton.className = 'primary compact';
    quickButton.textContent = 'Schnell erfassen';
    quickButton.addEventListener('click', showQuickCaptureModal);
    focusActions.appendChild(monthStartButton);
    focusActions.appendChild(quickButton);
    focusCard.appendChild(focusActions);
    page.appendChild(focusCard);

    const more = document.createElement('details');
    more.className = 'compact-details overview-more-details';
    const moreSummary = document.createElement('summary');
    moreSummary.textContent = 'Weitere Auswertungen anzeigen';
    more.appendChild(moreSummary);
    const moreContent = createUiEl('div', 'overview-more-content');

    const financeStatus = getFinanceStatus(details.free);
    const criticalMonths = findCriticalMonths(currentMonth);
    const financeCard = createUiEl('div', 'card compact-card finance-guard-card');
    financeCard.appendChild(createUiEl('h3', '', 'Finanz-Ampel'));
    const financeChips = createUiEl('div', 'status-chip-list');
    financeChips.appendChild(createUiEl('span', `pill ${financeStatus.kind}`, `${formatMonthLabel(currentMonth)}: ${financeStatus.label}`));
    financeChips.appendChild(createUiEl('span', 'pill', financeStatus.text));
    if (criticalMonths.length) {
      criticalMonths.forEach((item) => {
        financeChips.appendChild(createUiEl('span', 'pill danger', `${item.label}: ${euro(item.free)}`));
      });
    } else {
      financeChips.appendChild(createUiEl('span', 'pill success', 'Keine negativen Monate in der 12-Monats-Vorschau'));
    }
    financeCard.appendChild(financeChips);
    moreContent.appendChild(financeCard);

    appendSafe(moreContent, () => renderOpenPaymentsOverviewCard(currentMonth, { compact: true }), 'Offene Zahlungen');
    appendSafe(moreContent, () => renderMonthCompareCard(currentMonth), 'Monatsvergleich');
    const statusGrid = createUiEl('div', 'overview-compact-grid');
    appendSafe(statusGrid, () => renderOverviewDataCheckSummaryCard(), 'Datencheck');
    appendSafe(statusGrid, () => renderWarningsCard(currentMonth), 'Warnungen');
    moreContent.appendChild(statusGrid);

    const logDetails = document.createElement('details');
    logDetails.className = 'compact-details';
    const logSummary = document.createElement('summary');
    logSummary.textContent = 'Änderungsprotokoll anzeigen';
    logDetails.appendChild(logSummary);
    appendSafe(logDetails, () => renderChangeLogCard(5), 'Änderungsprotokoll');
    moreContent.appendChild(logDetails);

    more.appendChild(moreContent);
    page.appendChild(more);

    overviewSection.appendChild(page);
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
    if (f === 'reserve') return !!getLinkedSavingsGoal(post);
    return true;
  }

  function scheduleSearchRender(input) {
    const searchId = input && input.dataset ? input.dataset.searchField : '';
    const selectionStart = input && typeof input.selectionStart === 'number' ? input.selectionStart : null;
    const selectionEnd = input && typeof input.selectionEnd === 'number' ? input.selectionEnd : selectionStart;
    pendingSearchFocus = searchId ? { searchId, selectionStart, selectionEnd } : null;
    if (pendingSearchRenderTimer) clearTimeout(pendingSearchRenderTimer);
    pendingSearchRenderTimer = setTimeout(() => {
      pendingSearchRenderTimer = null;
      render();
    }, 120);
  }

  function restorePendingSearchFocus() {
    if (!pendingSearchFocus || !pendingSearchFocus.searchId) return;
    const focus = pendingSearchFocus;
    pendingSearchFocus = null;
    const input = document.querySelector(`[data-search-field="${focus.searchId}"]`);
    if (!input || typeof input.focus !== 'function') return;
    input.focus();
    if (typeof input.setSelectionRange === 'function' && focus.selectionStart !== null) {
      const start = Math.max(0, Number(focus.selectionStart || 0));
      const end = Math.max(start, Number(focus.selectionEnd || start));
      try { input.setSelectionRange(start, end); } catch (err) {}
    }
  }

  function makeSearchFilterBar(searchValue, filterValue, onSearch, onFilter, options) {
    const wrap = document.createElement('div');
    wrap.className = 'filter-bar';
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Suchen …';
    input.value = searchValue || '';
    input.dataset.searchField = `${currentSection}:search`;
    input.addEventListener('input', (e) => {
      onSearch(e.target.value);
      scheduleSearchRender(e.target);
    });
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


  function renderIncome() {
    if (!incomeSection) return;
    incomeSection.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'card income-page-card';

    const header = document.createElement('div');
    header.className = 'section-header';
    const currentLabel = formatMonthLabel(currentMonth);
    header.innerHTML = `<div><h2>Einkommen</h2><p class="muted">Für zukünftige Monate gilt zunächst der Grundlohn. Für ${currentLabel} kannst du die tatsächliche Auszahlung mit Zuschlägen eintragen.</p></div>`;
    wrapper.appendChild(header);

    normalizeAllPersonConfigs();
    const totalNet = (state.persons || []).reduce((sum, person) => sum + getPersonNet(person, currentMonth), 0);
    const overrideCount = (state.persons || []).filter((person) => person.netOverrides && person.netOverrides[currentMonth] != null).length;
    wrapper.appendChild(createSummaryMetrics([
      { label: 'Netto gesamt', value: euro(totalNet), hint: currentLabel },
      { label: 'Personen', value: String((state.persons || []).length) },
      { label: 'Ist-Auszahlungen erfasst', value: String(overrideCount) }
    ]));

    wrapper.appendChild(renderIncomeBreakdownCard(getIncomeBreakdownForMonth(currentMonth), {
      monthKey: currentMonth,
      title: 'Aufteilung wie bisher in der Übersicht',
      subtitle: `Netto, gemeinsame Kosten, persönliche Ausgaben und verfügbar für ${currentLabel}`
    }));

    const info = document.createElement('div');
    info.className = 'info-box';
    info.innerHTML = '<strong>So funktioniert es:</strong> Der Grundlohn ist der Planwert für Monate, deren Auszahlung noch nicht bekannt ist. Sobald die Abrechnung da ist, trägst du die tatsächlich ausgezahlte Summe nur für diesen Monat ein. Eine bekannte dauerhafte Gehaltsänderung, etwa nach einer Weiterbildung, kannst du ab dem passenden Monat als neuen Planwert speichern.';
    wrapper.appendChild(info);

    const grid = document.createElement('div');
    grid.className = 'person-grid income-person-grid';

    (state.persons || []).forEach((person) => {
      ensurePersonIncomeConfig(person);
      const active = getPersonNet(person, currentMonth);
      const standard = Number(person.net || 0);
      const hasOverride = person.netOverrides && person.netOverrides[currentMonth] != null;
      const activeTimeline = getActiveNetTimelineEntry(person, currentMonth);
      const nextTimeline = getNextNetTimelineEntry(person, currentMonth);
      const sourceLabel = getPersonNetSourceLabel(person, currentMonth);
      const hasActualNet = hasOverride;
      const activeShift = getPersonShift(person, currentMonth);
      const hasShiftOverride = person.shiftOverrides && person.shiftOverrides[currentMonth] != null;

      const card = document.createElement('div');
      card.className = 'person-card income-card';

      const head = document.createElement('div');
      head.className = 'person-card-head';
      const left = document.createElement('div');
      left.innerHTML = `<span class="person-avatar">${(person.name || '?').charAt(0).toUpperCase()}</span><h3>${person.name || 'Person'}</h3>`;
      const badge = document.createElement('span');
      badge.className = `badge ${hasActualNet ? 'badge-ok' : ''}`;
      badge.textContent = hasActualNet ? 'Ist-Auszahlung erfasst' : (activeTimeline ? 'Planwert aktiv' : 'Grundlohn aktiv');
      head.appendChild(left);
      head.appendChild(badge);
      card.appendChild(head);

      const metrics = document.createElement('div');
      metrics.className = 'person-metrics';
      metrics.innerHTML = `
        <div><span>Verwendet in ${currentLabel}</span><strong>${euro(active)}</strong></div>
        <div><span>Grundlohn / Basis</span><strong>${euro(standard)}</strong></div>
        <div><span>Quelle</span><strong>${sourceLabel}</strong></div>
        <div><span>Verschiebung</span><strong>${euro(activeShift)}</strong>${hasShiftOverride ? '<small>nur dieser Monat</small>' : ''}</div>
      `;
      card.appendChild(metrics);

      if (hasOverride) {
        const actualHint = document.createElement('p');
        actualHint.className = 'small muted';
        actualHint.textContent = `Für ${currentLabel} wird die tatsächliche Auszahlung verwendet. Der Grundlohn bleibt für andere Monate unverändert.`;
        card.appendChild(actualHint);
      } else if (activeTimeline) {
        const planHint = document.createElement('p');
        planHint.className = 'small muted';
        planHint.textContent = `Für ${currentLabel} wird vorläufig der Planwert ${euro(activeTimeline.amount)} verwendet. Sobald die Auszahlung feststeht, trage unten den Ist-Betrag für diesen Monat ein.`;
        card.appendChild(planHint);
      } else if (nextTimeline) {
        const hint = document.createElement('p');
        hint.className = 'small muted';
        hint.textContent = `Nächster bekannter Planwert: ${euro(nextTimeline.amount)} ab ${formatMonthLabel(nextTimeline.month)}.`;
        card.appendChild(hint);
      }

      const form = document.createElement('div');
      form.className = 'income-inline-form';

      const standardInput = document.createElement('input');
      standardInput.type = 'text';
      standardInput.inputMode = 'decimal';
      standardInput.value = formatNumberInput(standard);

      const monthInput = document.createElement('input');
      monthInput.type = 'text';
      monthInput.inputMode = 'decimal';
      monthInput.placeholder = 'leer = Grundlohn / Planwert';
      monthInput.value = hasOverride ? formatNumberInput(Number(person.netOverrides[currentMonth])) : '';

      form.appendChild(createLabelInput('Grundlohn / Basis-Netto', standardInput));
      form.appendChild(createLabelInput(`Tatsächlich ausgezahlt in ${currentLabel}`, monthInput));
      const shiftNote = document.createElement('p');
      shiftNote.className = 'small muted';
      shiftNote.textContent = hasShiftOverride
        ? `Ausgleich/Verschiebung: ${euro(activeShift)} nur für ${currentLabel}; normal wären ${euro(Number(person.shift || 0))}.`
        : `Ausgleich/Verschiebung: ${euro(activeShift)}. Dieser Wert wird nicht im Einkommen geändert, damit das Netto nicht versehentlich als Ausgleich gespeichert wird.`;
      form.appendChild(shiftNote);

      const receivedEntry = getPersonIncomeReceivedEntry(person, currentMonth);
      const receivedBalanceApplied = !!(receivedEntry && receivedEntry.balanceApplied === true);
      const incomeAccountRow = document.createElement('div');
      incomeAccountRow.className = 'row income-received-row';
      const receivedBox = document.createElement('div');
      receivedBox.className = receivedEntry ? 'notice success income-received-status' : 'notice income-received-status';
      receivedBox.innerHTML = receivedEntry
        ? `<strong>Erhalten:</strong> ${euro(receivedEntry.amount)} für ${currentLabel} markiert.`
        : `<strong>Noch nicht erhalten:</strong> ${euro(active)} für ${currentLabel} ist noch nicht als Eingang markiert.`;
      incomeAccountRow.appendChild(receivedBox);
      form.appendChild(incomeAccountRow);

      const actions = document.createElement('div');
      actions.className = 'button-row income-actions';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'primary';
      saveBtn.textContent = 'Einkommen speichern';
      saveBtn.addEventListener('click', () => {
        const standardValue = parseMoneyInput(standardInput.value);
        const monthRaw = String(monthInput.value || '').trim();

        if (!Number.isFinite(standardValue) || standardValue < 0) {
          alert('Bitte einen gültigen Grundlohn eingeben.');
          return;
        }

        person.net = standardValue;
        ensurePersonIncomeConfig(person);

        if (monthRaw === '') {
          if (person.netOverrides && person.netOverrides[currentMonth] != null) {
            delete person.netOverrides[currentMonth];
            addChangeLog('Einkommen', `${person.name}: Ist-Auszahlung für ${currentLabel} gelöscht; Planwert wird wieder verwendet.`);
          } else {
            addChangeLog('Einkommen', `${person.name}: Grundlohn / Basis-Netto auf ${euro(standardValue)} gesetzt.`);
          }
        } else {
          const monthValue = parseMoneyInput(monthRaw);
          if (!Number.isFinite(monthValue) || monthValue < 0) {
            alert('Bitte eine gültige tatsächliche Auszahlung eingeben.');
            return;
          }
          person.netOverrides[currentMonth] = monthValue;
          addChangeLog('Einkommen', `${person.name}: tatsächliche Auszahlung für ${currentLabel} auf ${euro(monthValue)} gesetzt.`);
        }

        syncPersonIncomeReceivedAmount(person, currentMonth);
        saveState();
        render();
      });

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'secondary';
      clearBtn.textContent = 'Ist-Auszahlung löschen';
      clearBtn.addEventListener('click', () => {
        ensurePersonIncomeConfig(person);
        delete person.netOverrides[currentMonth];
        addChangeLog('Einkommen', `${person.name}: Ist-Auszahlung für ${currentLabel} gelöscht; Planwert wird wieder verwendet.`);
        syncPersonIncomeReceivedAmount(person, currentMonth);
        saveState();
        render();
      });

      const applyStandardFutureBtn = document.createElement('button');
      applyStandardFutureBtn.type = 'button';
      applyStandardFutureBtn.className = 'success';
      applyStandardFutureBtn.textContent = `Grundlohn ab ${currentLabel} als Planwert setzen`;
      applyStandardFutureBtn.addEventListener('click', () => {
        const standardValue = parseMoneyInput(standardInput.value);
        if (!Number.isFinite(standardValue) || standardValue < 0) return alert('Bitte einen gültigen Grundlohn eingeben.');
        person.net = standardValue;
        setPersonNetForMonth(person, currentMonth, standardValue, 'future');
        addChangeLog('Einkommen', `${person.name}: Grundlohn / Planwert ab ${currentLabel} auf ${euro(standardValue)} gesetzt.`);
        syncPersonIncomeReceivedAmount(person, currentMonth);
        saveState();
        render();
      });

      const incomeReceivedBtn = document.createElement('button');
      incomeReceivedBtn.type = 'button';
      incomeReceivedBtn.className = receivedEntry ? 'secondary' : 'success';
      incomeReceivedBtn.textContent = receivedEntry ? 'Lohn-Eingang rückgängig' : 'Lohn erhalten markieren';
      incomeReceivedBtn.addEventListener('click', () => {
        if (setPersonIncomeReceived(person, currentMonth, !receivedEntry, '')) {
          saveState();
          render();
        }
      });

      actions.appendChild(saveBtn);
      actions.appendChild(clearBtn);
      actions.appendChild(applyStandardFutureBtn);
      if (ACCOUNTS_ENABLED && receivedEntry && !receivedBalanceApplied) {
        const applyIncomeBalanceBtn = document.createElement('button');
        applyIncomeBalanceBtn.type = 'button';
        applyIncomeBalanceBtn.className = 'success';
        applyIncomeBalanceBtn.textContent = 'Eingang einmal zum Kontostand addieren';
        applyIncomeBalanceBtn.addEventListener('click', () => {
          if (!confirm('Nur fortfahren, wenn dieser Lohneingang noch nicht in deinem eingetragenen Kontostand enthalten ist. Jetzt einmal hinzufügen?')) return;
          if (applyPersonIncomeBalance(person, currentMonth, true)) {
            syncPaymentsPaidWithIncome(person, currentMonth, true);
            addChangeLog('Einkommen', `${person.name}: vorhandenen Lohn-Eingang für ${currentLabel} einmalig im Kontostand nachgeholt.`, currentMonth);
            saveState();
            render();
          }
        });
        actions.appendChild(applyIncomeBalanceBtn);
      }
      actions.appendChild(incomeReceivedBtn);
      form.appendChild(actions);
      card.appendChild(form);
      grid.appendChild(card);
    });

    wrapper.appendChild(grid);
    incomeSection.appendChild(wrapper);
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
    h.textContent = 'Prognose & Was-wäre-wenn';
    card.appendChild(h);
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = 'Die Vorschau zeigt den sicheren Monatsrest nach deinen aktuellen Daten. Offene sonstige Ausgaben werden vorsorglich mit abgezogen, ohne Bankstände zu verändern. Die Simulation verändert nichts an den echten Daten.';
    card.appendChild(p);

    const horizonRow = document.createElement('div');
    horizonRow.className = 'row';
    const horizonSelect = document.createElement('select');
    [[6, '6 Monate kompakt'], [12, '12 Monate'], [24, '24 Monate'], [36, '36 Monate'], [60, '5 Jahre']].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = String(value);
      opt.textContent = label;
      if (Number(value) === Number(forecastHorizon)) opt.selected = true;
      horizonSelect.appendChild(opt);
    });
    horizonSelect.addEventListener('change', (e) => { forecastHorizon = Number(e.target.value || 6); render(); });
    horizonRow.appendChild(createLabelInput('Zeitraum', horizonSelect));
    card.appendChild(horizonRow);

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

    const months = Array.from({ length: forecastHorizon }, (_, index) => {
      const key = addMonths(currentMonth, index);
      return { key, label: formatMonthLabel(key) };
    });
    const hasScenario = state.persons.some((person) => {
      const raw = scenarioNet[person.id];
      return raw !== '' && raw != null && Number.isFinite(Number(raw));
    });
    const projectionMap = buildDebtForecastProjection(currentMonth, forecastHorizon, { monthDetailsFn: hasScenario ? computeMonthDetailsWithScenario : computeMonthDetails });
    const debtInfo = document.createElement('div');
    debtInfo.className = 'notice success';
    debtInfo.textContent = 'Die Vorschau hält den heutigen Schulden-Pool fest: Jede Standardrate bleibt bis zur Schlusszahlung bei ihrer Schuld und wechselt erst im Folgemonat auf die kleinste passende offene Ratenschuld. Zusätzliche freie Monatsbeträge werden nicht automatisch eingesetzt.';
    card.appendChild(debtInfo);
    card.appendChild(renderForecastTimelineCard(months, hasScenario, projectionMap));

    const table = document.createElement('table');
    table.className = 'list-table';
    table.innerHTML = '<thead><tr><th>Monat</th><th>Netto gesamt</th><th>Gemeinsame Kosten</th><th>Persönliche Ausgaben</th><th>Schulden geplant</th><th>davon übernommene Raten</th><th>Sonstige bezahlt</th><th>Sonstige offen</th><th>Sicher verfügbar</th><th>Rücklagen ab 200 €</th><th>Sparen ab 200 €</th></tr></thead>';
    const tbody = document.createElement('tbody');
    months.forEach(({ key, label }) => {
      const rawDetails = hasScenario ? computeMonthDetailsWithScenario(key) : computeMonthDetails(key);
      const details = applyDebtProjectionToForecastDetails(rawDetails, key, projectionMap);
      const free = details.free;
      const distributable = details.distributable;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${label}</td><td>${euro(details.totalIncome)}</td><td>${euro(details.totalCommonRounded)}</td><td>${euro(details.totalPersonal)}</td><td title="Bisher in Fixkosten verknüpft: ${euro(details.linkedDebtCosts)}">${euro(details.debtPlanned)}</td><td>${euro(details.debtSnowballExtra)}</td><td>${euro(details.miscPaid)}</td><td>${euro(Number(details.miscOpen || 0))}</td><td><span class="pill ${free < 0 ? 'danger' : 'success'}">${euro(free)}</span></td><td>${euro(details.reserves)}</td><td>${euro(details.savings)}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const details = document.createElement('details');
    details.className = 'compact-details forecast-table-details';
    const summary = document.createElement('summary');
    summary.textContent = `Tabellarische Vorschau anzeigen (${forecastHorizon} Monate)`;
    details.appendChild(summary);
    details.appendChild(table);
    card.appendChild(details);
    forecastSection.appendChild(card);
  }

  function getMonthCloseActualDetails(monthKey) {
    const details = computeMonthDetails(monthKey);
    const debtPlan = getDebtPlanForMonth(monthKey);
    const linkedDebtCosts = getLinkedDebtCostTotalForMonth(monthKey);
    return {
      ...details,
      linkedDebtCosts,
      debtPlanned: Number(debtPlan.planned || 0),
      debtBase: Number(debtPlan.planned || 0),
      debtSnowballExtra: 0,
      debtDynamicExtra: 0,
      debtPaid: Number(debtPlan.paid || 0),
      debtOpen: Number(debtPlan.open || 0),
      debtNotes: ['Monatsabschluss nutzt Ist-Daten; keine Schulden-Zukunftsprognose.']
    };
  }


  function buildMonthCloseSnapshot(monthKey) {
    const details = getMonthCloseActualDetails(monthKey);
    const debtPlan = getDebtPlanForMonth(monthKey);
    const accounts = ACCOUNTS_ENABLED ? (state.accounts || []).map((account) => {
      const availability = getAccountAvailability(account, monthKey);
      return {
        id: account.id,
        name: account.name || 'Konto',
        type: account.type || '',
        owner: account.owner || '',
        balance: Number(account.balance || 0),
        bound: Number(availability.bound || 0),
        open: Number(availability.open || 0),
        available: Number(availability.available || 0),
        missing: Number(availability.missing || 0)
      };
    }) : [];
    return {
      schema: 'monthCloseV180',
      closedAt: new Date().toISOString(),
      totalIncome: Number(details.totalIncome || 0),
      totalCommonRounded: Number(details.totalCommonRounded || 0),
      totalPersonal: Number(details.totalPersonal || 0),
      linkedDebtCosts: Number(details.linkedDebtCosts || 0),
      debtPlanned: Number(details.debtPlanned || debtPlan.planned || 0),
      debtBase: Number(details.debtBase || 0),
      debtSnowballExtra: Number(details.debtSnowballExtra || 0),
      debtDynamicExtra: Number(details.debtDynamicExtra || 0),
      debtPaid: Number(debtPlan.paid || 0),
      debtOpen: Number(debtPlan.open || 0),
      miscPaid: Number(details.miscPaid || 0),
      miscOpen: Number(details.miscOpen || 0),
      freeBeforeMisc: Number(details.freeBeforeMisc || 0),
      free: Number(details.free || 0),
      distributable: Number(details.distributable || 0),
      distributionBuffer: Number(details.distributionBuffer || savingsConfig.minFree || 0),
      keptFreeBuffer: Number(details.keptFreeBuffer || 0),
      reserves: Number(details.reserves || 0),
      savings: Number(details.savings || 0),
      accounts
    };
  }

  function buildMonthCloseDiffs(liveDetails, closedSnapshot) {
    if (!closedSnapshot) return [];
    const checks = [
      ['Netto gesamt', liveDetails.totalIncome, closedSnapshot.totalIncome],
      ['Gemeinsame Kosten', liveDetails.totalCommonRounded, closedSnapshot.totalCommonRounded],
      ['Persönliche Ausgaben', liveDetails.totalPersonal, closedSnapshot.totalPersonal],
      ['Schulden geplant', liveDetails.debtPlanned || 0, closedSnapshot.debtPlanned || 0],
      ['Sonstige bezahlt', liveDetails.miscPaid, closedSnapshot.miscPaid],
      ['Sonstige offen geplant', liveDetails.miscOpen || 0, closedSnapshot.miscOpen || 0],
      ['Sicher verfügbar', liveDetails.free, closedSnapshot.free]
    ];
    return checks
      .map(([label, live, saved]) => ({ label, live: Number(live || 0), saved: Number(saved || 0), diff: Number(live || 0) - Number(saved || 0) }))
      .filter((row) => Math.abs(row.diff) > 0.009);
  }

  function closeMonth(monthKey) {
    const details = buildMonthCloseSnapshot(monthKey);
    if (!state.monthlyClosings || typeof state.monthlyClosings !== 'object') state.monthlyClosings = {};
    state.monthlyClosings[monthKey] = details;
    // Neue Rücklagenlogik ab 1.83: Der Monatsabschluss speichert nur den Beleg.
    // Rücklagen-Posten werden gezielt im Bereich „Rücklagen & Sparen“ eingezahlt.
    addChangeLog('Monatsabschluss', `Monat abgeschlossen: Beleg gespeichert`, monthKey);
    saveState();
  }

  function reopenMonth(monthKey) {
    if (state.monthlyClosings) delete state.monthlyClosings[monthKey];
    if (state.reserveItemSaved && state.reserveItemSaved[monthKey]) {
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

    const liveDetails = getMonthCloseActualDetails(currentMonth);
    const closed = isMonthClosed(currentMonth);
    const closedSnapshot = closed && state.monthlyClosings ? state.monthlyClosings[currentMonth] : null;
    const details = closedSnapshot ? { ...liveDetails, ...closedSnapshot } : liveDetails;
    card.appendChild(createSummaryMetrics([
      { label: 'Sicher verfügbar am Monatsende', value: `${euro(details.free)}`, kind: details.free >= 0 ? 'success' : 'danger', hint: Number(details.miscOpen || 0) > 0 ? `${euro(details.miscOpen)} offene sonstige Ausgaben bereits abgezogen.` : '' },
      { label: 'In Töpfe verteilbar', value: `${euro(details.distributable)}`, kind: details.distributable > 0 ? 'success' : '', hint: details.distributable > 0 ? `${euro(details.keptFreeBuffer || savingsConfig.minFree)} bleibt als Puffer.` : `Unter ${euro(savingsConfig.minFree)} bleibt der Rest als Puffer.` },
      { label: 'Rücklagen 70 % über Puffer', value: `${euro(details.reserves)}` },
      { label: 'Sparen 30 % über Puffer', value: `${euro(details.savings)}` },
      { label: 'Schulden im Monat', value: `${euro(Number(details.debtPlanned || 0))}`, hint: 'Bereits in Gemeinsame/Persönliche Kosten enthalten.' },
      { label: 'Sonstige bezahlt', value: `${euro(details.miscPaid)}` },
      { label: 'Sonstige offen geplant', value: `${euro(Number(details.miscOpen || 0))}`, kind: Number(details.miscOpen || 0) > 0 ? 'warning' : 'success' },
      { label: 'Status', value: closed ? '<span class="pill success">Abgeschlossen</span>' : '<span class="pill warning">Offen</span>' }
    ]));

    const receipt = createUiEl('div', 'month-close-receipt');
    const receiptHead = createUiEl('div', 'receipt-head');
    receiptHead.appendChild(createUiEl('strong', '', `Beleg für ${formatMonthLabel(currentMonth)}`));
    receiptHead.appendChild(createUiEl('span', closed ? 'pill success' : 'pill warning', closed ? 'Abgeschlossen' : 'Noch offen'));
    receipt.appendChild(receiptHead);
    receipt.appendChild(createReceiptRow('Netto gesamt', euro(details.totalIncome)));
    receipt.appendChild(createReceiptRow('Gemeinsame Kosten', `− ${euro(details.totalCommonRounded)}`));
    receipt.appendChild(createReceiptRow('Persönliche Ausgaben', `− ${euro(details.totalPersonal)}`));
    receipt.appendChild(createReceiptRow('Davon Schulden in den Kosten', euro(details.debtPlanned || 0)));
    receipt.appendChild(createReceiptRow('davon übernommene Standardraten', euro(details.debtSnowballExtra || 0)));
    receipt.appendChild(createReceiptRow('Sonstige bezahlt', `− ${euro(details.miscPaid)}`));
    receipt.appendChild(createReceiptRow('Sonstige offen geplant', `− ${euro(details.miscOpen || 0)}`));
    receipt.appendChild(createReceiptRow('Sicher verfügbar', euro(details.free), details.free >= 0 ? 'success' : 'danger'));
    receipt.appendChild(createReceiptRow('Puffer bleibt frei', euro(details.keptFreeBuffer || 0)));
    receipt.appendChild(createReceiptRow('Davon Rücklagen', euro(details.reserves)));
    receipt.appendChild(createReceiptRow('Davon Sparen', euro(details.savings)));
    card.appendChild(receipt);

    if (closedSnapshot) {
      const closedInfo = createUiEl('div', 'notice success month-close-snapshot-note');
      const closedDate = closedSnapshot.closedAt ? new Date(closedSnapshot.closedAt) : null;
      closedInfo.textContent = `Gespeicherter Abschluss${closedDate && !Number.isNaN(closedDate.getTime()) ? ' vom ' + closedDate.toLocaleDateString('de-DE') : ''}: Die angezeigten Belegwerte sind eingefroren.`;
      card.appendChild(closedInfo);
      const diffs = buildMonthCloseDiffs(liveDetails, closedSnapshot);
      if (diffs.length) {
        const diffBox = createUiEl('div', 'notice warning month-close-diff-note');
        diffBox.appendChild(createUiEl('strong', '', 'Live-Daten weichen vom gespeicherten Abschluss ab'));
        const list = createUiEl('ul');
        diffs.slice(0, 6).forEach((row) => {
          const li = createUiEl('li', '', `${row.label}: Abschluss ${euro(row.saved)} · aktuell ${euro(row.live)} · Differenz ${row.diff >= 0 ? '+' : ''}${euro(row.diff)}`);
          list.appendChild(li);
        });
        diffBox.appendChild(list);
        card.appendChild(diffBox);
      }
      if (ACCOUNTS_ENABLED && Array.isArray(closedSnapshot.accounts) && closedSnapshot.accounts.length) {
        const accDetails = createUiEl('details', 'compact-details month-close-account-snapshot');
        const accSummary = createUiEl('summary', '', 'Kontostände beim Abschluss anzeigen');
        accDetails.appendChild(accSummary);
        const accTable = document.createElement('table');
        accTable.className = 'list-table';
        accTable.innerHTML = '<thead><tr><th>Konto</th><th>Stand</th><th>Gebunden</th><th>Offen</th><th>Verfügbar</th><th>Fehlt</th></tr></thead>';
        const accBody = document.createElement('tbody');
        closedSnapshot.accounts.forEach((acc) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${acc.name || 'Konto'}</td><td>${euro(acc.balance)}</td><td>${euro(acc.bound)}</td><td>${euro(acc.open)}</td><td>${euro(acc.available)}</td><td>${Number(acc.missing || 0) > 0.005 ? euro(acc.missing) : '—'}</td>`;
          accBody.appendChild(tr);
        });
        accTable.appendChild(accBody);
        accDetails.appendChild(accTable);
        card.appendChild(accDetails);
      }
    }

    const wizard = document.createElement('div');
    wizard.className = 'month-wizard';
    const distributionText = details.distributable > 0
      ? `${euro(details.reserves)} Rücklagen · ${euro(details.savings)} Sparen`
      : `${euro(Math.max(0, details.free || 0))} bleibt als Puffer · unter ${euro(savingsConfig.minFree)} keine Verteilung`;
    wizard.innerHTML = `<div><strong>1. Prüfen</strong><span>Offene Zahlungen und Hinweise kontrollieren</span></div><div><strong>2. Verteilen</strong><span>${distributionText}</span></div><div><strong>3. Abschließen</strong><span>${closed ? 'Monat ist abgeschlossen' : 'Beleg speichern'}</span></div>`;
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
      tr.innerHTML = `<td>${name}</td><td>${(share * 100).toFixed(0)} %</td><td>${euro(amount)}</td>`;
      tbody.appendChild(tr);
    });
    const saveRow = document.createElement('tr');
    saveRow.innerHTML = `<td>Sparen</td><td>30 % vom Betrag über ${euro(savingsConfig.minFree)}</td><td>${euro(details.savings)}</td>`;
    tbody.appendChild(saveRow);
    table.appendChild(tbody);
    card.appendChild(table);

    const actions = document.createElement('div');
    actions.className = 'row';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'success';
    closeBtn.textContent = closed ? 'Monat erneut abschließen' : 'Monat abschließen und Beleg speichern';
    closeBtn.disabled = false;
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
      if (confirm('Monatsabschluss und gespeicherten Beleg zurücksetzen?')) {
        reopenMonth(currentMonth);
        render();
      }
    });
    actions.appendChild(closeBtn);
    actions.appendChild(reopenBtn);
    card.appendChild(actions);

    const note = document.createElement('p');
    note.className = 'small muted';
    note.textContent = 'Der Monatsabschluss speichert einen Beleg mit Monatszahlen. Einzahlungen in Töpfe erfolgen bewusst im Bereich „Rücklagen & Sparen“. Wenn du danach alte Werte änderst, zeigt die App Abweichungen zum gespeicherten Abschluss an.';
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
      { label: `Geplant fällig ${formatMonthLabel(currentMonth)}`, value: `${euro(planned)}`, kind: planned > 0 ? 'warning' : '' },
      { label: 'Bereits bezahlt', value: `${euro(paid)}`, kind: paid > 0 ? 'warning' : 'success' },
      { label: 'Noch offen', value: `${euro(open)}`, kind: open > 0 ? 'warning' : 'success' },
      { label: 'Reduziert sicher frei um', value: `${euro(planned)}`, kind: planned > 0 ? 'warning' : 'success' }
    ]));

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = 'Hier trägst du sonstige Ausgaben ein, die nicht zu Fixkosten oder Schulden gehören. Für den sicheren freien Betrag werden fällige geplante Ausgaben vorsorglich abgezogen; „bezahlt“ dient danach als Status und Nachweis, ohne den Betrag doppelt zu senken.';
    card.appendChild(hint);

    card.appendChild(makeSearchFilterBar(bufferSearch, bufferFilter, (v) => { bufferSearch = v; }, (v) => { bufferFilter = v; }, [['all','Alle'],['due','Fällig'],['open','Offen'],['paid','Bezahlt'],['reserve','Mit Rücklage']]));

    const posts = (state.bufferExpenses || []);
    if (posts.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Noch keine sonstigen Ausgaben eingetragen.';
      card.appendChild(empty);
    } else {
      const table = document.createElement('table');
      table.className = 'list-table';
        table.innerHTML = `<thead><tr><th>Name</th><th>Betrag</th><th>Intervall</th><th>Start</th><th>Bis</th><th>Fällig</th><th>Rücklage</th><th class="account-only">Konto</th><th>Status</th><th>Aktion</th></tr></thead>`;
      const tbody = document.createElement('tbody');

      let visibleCount = 0;
      posts.forEach((post) => {
        ensurePostConfig(post);
        const dueNow = isDue(post, currentMonth);
        const paidNow = isPostPaidForMonth(post, currentMonth);
        // Sonstige Ausgaben werden monatsrein angezeigt:
        // Einträge aus vergangenen oder zukünftigen Monaten erscheinen nicht mehr in der aktuellen Monatsliste.
        // Relevant ist ein Posten nur, wenn er im ausgewählten Monat fällig oder dort bereits bezahlt ist.
        if (!dueNow && !paidNow) return;
        if (!matchesSearchText(post.name, bufferSearch) || !matchesPostStatus(post, currentMonth, bufferFilter)) return;
        visibleCount += 1;
        const amount = getEffectiveAmountForMonth(post, currentMonth);
        const linkedSavingsGoalName = getLinkedSavingsGoalName(post);
        const deductsBalance = canPostDebitAccountBalance(post);
        const balanceDebitedNow = !!getPostAccountBalanceDebit(post, currentMonth);
        const statusHtml = paidNow
          ? `<span class="pill success">${linkedSavingsGoalName ? 'Zurückgelegt' : 'Bezahlt'}</span>`
          : (dueNow ? '<span class="pill warning">Offen</span>' : '<span class="pill">Nicht fällig</span>');
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${post.name}</td>
          <td>${euro(amount)}</td>
          <td>${getDisplayInterval(post)}</td>
          <td>${post.startMonth}</td>
          <td>${getDisplayEndMonth(post)}</td>
          <td>${getDueBadgeHtml(dueNow)}</td>
          <td>${linkedSavingsGoalName || '-'}</td>
          <td class="account-only">${getAccountName(post.accountId)}</td>
          <td>${statusHtml}</td>
          <td></td>`;
        const actionCell = tr.children[9];

        const paidBtn = document.createElement('button');
        paidBtn.textContent = linkedSavingsGoalName ? 'Zurücklegen' : (deductsBalance ? 'Bezahlt · Konto abziehen' : 'Bezahlt markieren');
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

        const bookedNow = isPostBookedForMonth(post, currentMonth);
        actionCell.appendChild(createActionMenu([
          { label: linkedSavingsGoalName ? 'Zurücklegen' : (deductsBalance ? 'Bezahlt · Konto abziehen' : 'Bezahlt markieren'), className: 'success', disabled: !dueNow || paidNow, onClick: () => { setPostPaidForMonth(post, currentMonth, true); saveState(); render(); } },
          !balanceDebitedNow && paidNow && deductsBalance ? { label: post.bookingType === 'transfer' ? 'Umbuchung nachholen' : 'Kontoabzug nachholen', className: 'success', onClick: () => { applyPostAccountBalanceDebit(post, currentMonth, true); saveState(); render(); } } : null,
          ACCOUNTS_ENABLED ? { label: linkedSavingsGoalName ? 'Zurückgelegt + Nachweis buchen' : 'Bezahlt + buchen', className: 'success', disabled: !dueNow || bookedNow, onClick: () => { bookPostPaymentForMonth(post, currentMonth); saveState(); render(); } } : null,
          ACCOUNTS_ENABLED ? { label: 'Buchung entfernen', className: 'secondary', disabled: !bookedNow, onClick: () => { unbookPostPaymentForMonth(post, currentMonth); saveState(); render(); } } : null,
          { label: 'Zahlung zurücksetzen', className: 'secondary', disabled: !paidNow, onClick: () => { setPostPaidForMonth(post, currentMonth, false); saveState(); render(); } },
          { label: 'In anderen Monat verschieben', className: 'secondary', onClick: () => showBufferMoveMonthModal(post) },
          { label: 'Bearbeiten', className: 'primary', onClick: () => showBufferExpenseEditor(post) },
          { label: 'Löschen', className: 'danger', onClick: () => { if (confirm(`"${post.name}" löschen?`)) { state.bufferExpenses = state.bufferExpenses.filter((x) => x.id !== post.id); saveState(); render(); } } }
        ]));
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      if (visibleCount === 0) {
        const emptyMonth = document.createElement('p');
        emptyMonth.className = 'small muted';
        emptyMonth.textContent = `Für ${formatMonthLabel(currentMonth)} sind keine sonstigen Ausgaben eingetragen.`;
        card.appendChild(emptyMonth);
      } else {
        card.appendChild(table);
      }
    }

    bufferSection.appendChild(card);
  }


  // Rendert den Bereich „Gemeinschaftskonto"
  function renderSharedAccount() {
    if (!sharedAccountSection) return;
    normalizeBudgetTopUpsConfig();
    normalizeCommonAccountConfig();
    normalizeAccountsConfig();
    sharedAccountSection.innerHTML = '';
    sharedAccountSection.appendChild(renderAccountsManagementCard());
    const details = computeCommonAccountDetails(currentMonth);

    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h2');
    h.textContent = 'Gemeinschaftskonto-Planung';
    card.appendChild(h);
    const intro = document.createElement('p');
    intro.className = 'small muted';
    intro.textContent = 'Zusätzlich zur allgemeinen Kontenübersicht siehst du hier, was auf dem gemeinsamen Konto aktuell für gemeinsame Kosten, gebundene Steuererstattung, verknüpfte Rücklagen, Tagesgeld-Soll für Intervallzahlungen und offene Monatsanteile gebraucht wird.';
    card.appendChild(intro);

    card.appendChild(createSummaryMetrics([
      { label: 'Kontostand', value: euro(details.balance) },
      { label: 'Gebunden', value: euro(details.boundTotal), hint: `Steuererstattung ${euro(details.taxBound)} · Verknüpfte Rücklagen ${euro(details.savingsGoalBound)} · Intervall ${euro(details.intervalReserveTotal)} · manuell ${euro(details.manualBound)}` },
      { label: 'Offene Abbuchungen', value: euro(details.actualOpenTotal), kind: details.actualOpenTotal > 0 ? 'warning' : 'success' },
      { label: details.missingNow > 0 ? 'Fehlt aktuell' : 'Überschuss aktuell', value: euro(details.missingNow > 0 ? details.missingNow : details.surplusNow), kind: details.missingNow > 0 ? 'danger' : 'success' }
    ]));
    card.appendChild(createSummaryMetrics([
      { label: 'Zinsen im Monat', value: euro(details.interestMonth), kind: details.interestMonth > 0 ? 'success' : '' },
      { label: 'Zinsen im Jahr', value: euro(details.interestYear), kind: details.interestYear > 0 ? 'success' : '' }
    ]));

    const interest = document.createElement('div');
    interest.className = 'sub-card';
    const interestTitle = document.createElement('h3');
    interestTitle.textContent = 'Zinsen eintragen';
    interest.appendChild(interestTitle);
    const interestHint = document.createElement('p');
    interestHint.className = 'small muted';
    interestHint.textContent = 'Trage hier die ausgezahlten Zinsen ein, z. B. 1,30 € für den vergangenen Monat. Es entsteht ein Nachweis; der echte Bankstand ändert sich nur mit der optionalen Auswahl.';
    interest.appendChild(interestHint);
    const interestRow = document.createElement('div');
    interestRow.className = 'row';
    const interestMonthInput = document.createElement('input');
    interestMonthInput.type = 'month';
    interestMonthInput.value = addMonths(currentMonth, -1);
    const interestAmountInput = document.createElement('input');
    interestAmountInput.type = 'text';
    interestAmountInput.inputMode = 'decimal';
    interestAmountInput.placeholder = '1,30';
    interestRow.appendChild(createLabelInput('Für Monat', interestMonthInput));
    interestRow.appendChild(createLabelInput('Zinsen erhalten', interestAmountInput));
    interest.appendChild(interestRow);
    const interestNoteInput = document.createElement('input');
    interestNoteInput.type = 'text';
    interestNoteInput.placeholder = 'Notiz optional, z. B. Zinsgutschrift';
    interest.appendChild(createLabelInput('Notiz', interestNoteInput));
    const interestCheckLabel = document.createElement('label');
    interestCheckLabel.className = 'check-line';
    const interestAddToBalance = document.createElement('input');
    interestAddToBalance.type = 'checkbox';
    interestAddToBalance.checked = false;
    interestCheckLabel.appendChild(interestAddToBalance);
    interestCheckLabel.appendChild(document.createTextNode(' Bankstand ebenfalls erhöhen (nur falls noch nicht enthalten)'));
    interest.appendChild(interestCheckLabel);
    const interestBtn = document.createElement('button');
    interestBtn.className = 'primary';
    interestBtn.textContent = 'Zinsen speichern';
    interestBtn.addEventListener('click', () => {
      const amount = parseMoneyInput(interestAmountInput.value);
      if (!(amount > 0)) {
        alert('Bitte einen Zinsbetrag größer als 0 eintragen.');
        return;
      }
      if (!isMonthKey(interestMonthInput.value)) {
        alert('Bitte einen gültigen Monat auswählen.');
        return;
      }
      addCommonAccountInterest({ month: interestMonthInput.value, amount, note: interestNoteInput.value || '' }, { addToBalance: interestAddToBalance.checked });
      saveState();
      render();
    });
    interest.appendChild(interestBtn);
    const interestEntries = getCommonAccountInterestEntries().slice(0, 6);
    if (interestEntries.length) {
      const interestDetails = document.createElement('details');
      interestDetails.className = 'compact-details';
      const interestSummary = document.createElement('summary');
      interestSummary.textContent = 'Letzte Zinsgutschriften anzeigen';
      interestDetails.appendChild(interestSummary);
      const interestTable = document.createElement('table');
      interestTable.className = 'list-table compact-table';
      interestTable.innerHTML = '<thead><tr><th>Monat</th><th>Betrag</th><th>Notiz</th><th></th></tr></thead>';
      const interestBody = document.createElement('tbody');
      interestEntries.forEach((entry) => {
        const tr = document.createElement('tr');
        const tdMonth = document.createElement('td');
        tdMonth.textContent = formatMonthLabel(entry.month);
        const tdAmount = document.createElement('td');
        tdAmount.textContent = euro(entry.amount);
        const tdNote = document.createElement('td');
        tdNote.textContent = entry.note || '—';
        const tdAction = document.createElement('td');
        const del = document.createElement('button');
        del.className = 'danger small-action';
        del.textContent = 'Löschen';
        del.title = 'Löscht nur den Zinseinsatz aus der Liste. Der Kontostand wird nicht automatisch zurückgerechnet.';
        del.addEventListener('click', () => {
          if (!confirm('Zinsgutschrift löschen? Der Kontostand wird dadurch nicht automatisch geändert.')) return;
          if (deleteCommonAccountInterest(entry.id)) {
            saveState();
            render();
          }
        });
        tdAction.appendChild(del);
        tr.appendChild(tdMonth);
        tr.appendChild(tdAmount);
        tr.appendChild(tdNote);
        tr.appendChild(tdAction);
        interestBody.appendChild(tr);
      });
      interestTable.appendChild(interestBody);
      interestDetails.appendChild(interestTable);
      interest.appendChild(interestDetails);
    }
    card.appendChild(interest);

    const form = document.createElement('div');
    form.className = 'sub-card';
    const formTitle = document.createElement('h3');
    formTitle.textContent = 'Kontostand & gebundenes Geld';
    form.appendChild(formTitle);
    const row = document.createElement('div');
    row.className = 'row';
    const balanceInput = document.createElement('input');
    balanceInput.type = 'text';
    balanceInput.inputMode = 'decimal';
    balanceInput.value = formatNumberInput(state.commonAccount.currentBalance);
    const manualInput = document.createElement('input');
    manualInput.type = 'text';
    manualInput.inputMode = 'decimal';
    manualInput.value = formatNumberInput(state.commonAccount.manualBound);
    row.appendChild(createLabelInput('Aktueller Kontostand', balanceInput));
    row.appendChild(createLabelInput('Zusätzlich gebunden', manualInput));
    form.appendChild(row);
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = 'Notiz optional';
    noteInput.value = state.commonAccount.note || '';
    form.appendChild(createLabelInput('Notiz', noteInput));
    const saveBtn = document.createElement('button');
    saveBtn.className = 'primary';
    saveBtn.textContent = 'Gemeinschaftskonto speichern';
    saveBtn.addEventListener('click', () => {
      const balance = parseMoneyInput(balanceInput.value);
      const manualBound = parseMoneyInput(manualInput.value);
      if (!Number.isFinite(balance)) return alert('Bitte einen gültigen aktuellen Kontostand eintragen.');
      if (!Number.isFinite(manualBound) || manualBound < 0) return alert('Bitte einen gültigen gebundenen Betrag eintragen.');
      state.commonAccount.currentBalance = balance;
      state.commonAccount.manualBound = manualBound;
      state.commonAccount.note = noteInput.value || '';
      syncCommonAccountBalanceToSharedAccount();
      addChangeLog('Gemeinschaftskonto', `Kontostand Gemeinschaftskonto auf ${euro(state.commonAccount.currentBalance)} gesetzt.`, currentMonth);
      saveState();
      render();
    });
    form.appendChild(saveBtn);
    card.appendChild(form);

    const shares = document.createElement('div');
    shares.className = 'sub-card';
    const sharesTitle = document.createElement('h3');
    sharesTitle.textContent = 'Monatliche Anteile';
    shares.appendChild(sharesTitle);
    shares.appendChild(createSummaryMetrics([
      { label: 'Soll-Eingang', value: euro(details.contributionsTotal) },
      { label: 'Bereits eingegangen', value: euro(details.contributionsPaid), kind: details.contributionsPaid > 0 ? 'success' : '' },
      { label: 'Noch offen', value: euro(details.contributionsOpen), kind: details.contributionsOpen > 0 ? 'warning' : 'success' },
      { label: 'Nach offenen Anteilen', value: euro(details.afterExpectedContributions), kind: details.afterExpectedContributions >= 0 ? 'success' : 'danger' }
    ]));
    const shareTable = document.createElement('table');
    shareTable.className = 'list-table';
    shareTable.innerHTML = '<thead><tr><th>Person</th><th>Anteil</th><th>Eingegangen?</th></tr></thead>';
    const shareBody = document.createElement('tbody');
    details.persons.forEach((rowData) => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = rowData.person.name;
      const tdAmount = document.createElement('td');
      tdAmount.textContent = rowData.paid ? euro(rowData.paidAmount || rowData.amount) : euro(rowData.plannedAmount || rowData.amount);
      const plannedDiff = roundMoney(Number(rowData.plannedAmount || 0) - Number(rowData.paidAmount || 0));
      if (rowData.paid) {
        const fixedHint = document.createElement('div');
        fixedHint.className = 'small muted';
        fixedHint.textContent = Math.abs(plannedDiff) > 0.005
          ? `fixiert · aktueller Soll-Anteil ${euro(rowData.plannedAmount)}`
          : 'fixiert beim Eingang';
        tdAmount.appendChild(fixedHint);
      }
      if (Number(rowData.openAmount || 0) > 0.005) {
        const openHint = document.createElement('div');
        openHint.className = 'small warning-text';
        openHint.textContent = `Differenz offen: ${euro(rowData.openAmount)}`;
        tdAmount.appendChild(openHint);
      }
      const tdPaid = document.createElement('td');
      const booked = isContributionAccountBooked(currentMonth, rowData.person.id);
      const btn = document.createElement('button');
      btn.className = rowData.paid && Number(rowData.openAmount || 0) <= 0.005 ? 'success' : (rowData.paid ? 'warning' : 'secondary');
      btn.textContent = booked ? 'Eingegangen (Umbuchung)' : (rowData.paid ? 'Eingegangen (fixiert)' : 'Eingegangen (nur Status)');
      btn.title = booked
        ? 'Der Eingang ist durch eine Umbuchung belegt. Entferne zuerst die Buchung, wenn du den Eingang zurücksetzen möchtest.'
        : 'Markiert nur den Status und fixiert den jetzt angezeigten Betrag. Es wird keine zusätzliche Kontobuchung erstellt.';
      btn.disabled = booked;
      btn.addEventListener('click', () => {
        setCommonAccountContributionPaid(currentMonth, rowData.person.id, !rowData.paid, { amount: rowData.plannedAmount });
        saveState();
        render();
      });
      tdPaid.appendChild(btn);
      const bookingBtn = document.createElement('button');
      bookingBtn.type = 'button';
      bookingBtn.className = booked ? 'danger small-action' : 'secondary small-action';
      bookingBtn.textContent = booked ? 'Buchung entfernen' : 'Eingegangen + umbuchen';
      bookingBtn.title = booked
        ? 'Entfernt die Umbuchung und rechnet beide Kontostände zurück.'
        : 'Bucht den Anteil als Umbuchung vom Lohnkonto auf das Gemeinschaftskonto.';
      bookingBtn.addEventListener('click', () => {
        if (booked) {
          applyContributionAccountBooking(currentMonth, rowData.person.id, false);
        } else {
          applyContributionAccountBooking(currentMonth, rowData.person.id, true);
          setCommonAccountContributionPaid(currentMonth, rowData.person.id, true, { amount: rowData.paid ? rowData.paidAmount : rowData.plannedAmount, source: 'transfer' });
        }
        saveState();
        render();
      });
      tdPaid.appendChild(bookingBtn);
      const hint = document.createElement('div');
      hint.className = 'small muted';
      hint.textContent = booked
        ? 'Umbuchung vorhanden, beide Konten sind berücksichtigt'
        : (rowData.paid ? `fixierter Eingang: ${euro(rowData.paidAmount || rowData.amount)}` : 'nur Status, keine doppelte Buchung');
      tdPaid.appendChild(hint);
      tr.appendChild(tdName);
      tr.appendChild(tdAmount);
      tr.appendChild(tdPaid);
      shareBody.appendChild(tr);
    });
    shareTable.appendChild(shareBody);
    shares.appendChild(shareTable);
    card.appendChild(shares);

    const reserveBox = document.createElement('div');
    reserveBox.className = 'sub-card';
    const reserveTitle = document.createElement('h3');
    reserveTitle.textContent = 'Tagesgeld-Soll für Intervallzahlungen';
    reserveBox.appendChild(reserveTitle);
    reserveBox.appendChild(createSummaryMetrics([
      { label: 'Soll-Rücklage aktuell', value: euro(details.intervalReserveTotal), kind: details.intervalReserveTotal > 0 ? 'warning' : 'success' },
      { label: 'Gebunden gesamt inkl. Rücklagen', value: euro(details.boundTotal), kind: details.boundTotal > 0 ? 'warning' : 'success' }
    ]));
    const reserveHint = document.createElement('p');
    reserveHint.className = 'small muted';
    reserveHint.textContent = 'Hier werden jährliche, halbjährliche und quartalsweise gemeinsame Kosten berücksichtigt. Die separate Tagesgeldkarte oben zeigt den Sollstand inklusive Fälligkeitsmonat; diese Gemeinschaftskonto-Rechnung vermeidet Doppelzählungen mit offenen Abbuchungen.';
    reserveBox.appendChild(reserveHint);
    if (details.intervalReserve && details.intervalReserve.rows && details.intervalReserve.rows.length) {
      const reserveDetails = document.createElement('details');
      reserveDetails.className = 'compact-details';
      const reserveSummary = document.createElement('summary');
      reserveSummary.textContent = 'Details zur Intervall-Rücklage anzeigen';
      reserveDetails.appendChild(reserveSummary);
      const reserveTable = document.createElement('table');
      reserveTable.className = 'list-table compact-table';
      reserveTable.innerHTML = '<thead><tr><th>Posten</th><th>Monatsanteil</th><th>angespart</th><th>Soll</th><th>nächste Fälligkeit</th></tr></thead>';
      const reserveBody = document.createElement('tbody');
      details.intervalReserve.rows.forEach((rowData) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${rowData.item.name}</td><td>${euro(rowData.monthlyPart)}</td><td>${rowData.monthsBuilt} Monat(e)</td><td>${euro(rowData.reserve)}</td><td>${formatMonthLabel(rowData.nextDue)}</td>`;
        reserveBody.appendChild(tr);
      });
      reserveTable.appendChild(reserveBody);
      reserveDetails.appendChild(reserveTable);
      reserveBox.appendChild(reserveDetails);
    } else {
      const emptyReserve = document.createElement('p');
      emptyReserve.className = 'small muted';
      emptyReserve.textContent = 'Für den ausgewählten Monat ist keine zusätzliche Intervall-Rücklage aufgebaut.';
      reserveBox.appendChild(emptyReserve);
    }
    card.appendChild(reserveBox);

    const due = document.createElement('div');
    due.className = 'sub-card';
    const dueTitle = document.createElement('h3');
    dueTitle.textContent = `Gemeinsame Abbuchungen in ${formatMonthLabel(currentMonth)}`;
    due.appendChild(dueTitle);
    due.appendChild(createSummaryMetrics([
      { label: 'Fällig gesamt', value: euro(details.actualDueTotal) },
      { label: 'Bereits bezahlt', value: euro(details.actualPaidTotal), kind: details.actualPaidTotal > 0 ? 'success' : '' },
      { label: 'Noch offen', value: euro(details.actualOpenTotal), kind: details.actualOpenTotal > 0 ? 'warning' : 'success' }
    ]));
    if (!details.dueCommon.length) {
      const empty = document.createElement('p');
      empty.className = 'small muted';
      empty.textContent = 'In diesem Monat sind keine gemeinsamen Kosten fällig.';
      due.appendChild(empty);
    } else {
      const table = document.createElement('table');
      table.className = 'list-table';
      table.innerHTML = '<thead><tr><th>Posten</th><th>Betrag</th><th>Status</th></tr></thead>';
      const body = document.createElement('tbody');
      details.dueCommon.forEach((rowData) => {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        name.textContent = rowData.item.name;
        const amount = document.createElement('td');
        amount.textContent = euro(rowData.amount);
        const status = document.createElement('td');
        status.innerHTML = rowData.paid ? '<span class="pill success">bezahlt</span>' : '<span class="pill warning">offen</span>';
        tr.appendChild(name);
        tr.appendChild(amount);
        tr.appendChild(status);
        body.appendChild(tr);
      });
      table.appendChild(body);
      due.appendChild(table);
    }
    card.appendChild(due);

    const note = document.createElement('div');
    note.className = details.missingNow > 0 ? 'notice warning' : 'notice success';
    note.textContent = details.missingNow > 0
      ? `Aktuell fehlen ${euro(details.missingNow)}, wenn Steuererstattung, verknüpfte Rücklagen, manuell gebundene Beträge und Intervall-Rücklagen unangetastet bleiben sollen.`
      : `Aktuell ist das Gemeinschaftskonto ausreichend gedeckt. Überschuss nach gebundenen Rücklagen, Intervall-Rücklagen und offenen Abbuchungen: ${euro(details.surplusNow)}.`;
    card.appendChild(note);

    sharedAccountSection.appendChild(card);
  }

  function getCommonAccountTargetSummary(monthKey = currentMonth) {
    let monthlyRaw = 0;
    let dueTotal = 0;
    let paidTotal = 0;

    (state.commonCosts || []).forEach((cost) => {
      if (isPostActiveInMonth(cost, monthKey)) {
        monthlyRaw += Number(getCommonMonthlyShare(cost, monthKey) || 0);
      }
      if (isDue(cost, monthKey)) {
        const amount = Number(getEffectiveAmountForMonth(cost, monthKey) || 0);
        dueTotal += amount;
        if (isPostPaidForMonth(cost, monthKey)) paidTotal += amount;
      }
    });

    const shareMapping = computeRoundedCommonShares(
      monthlyRaw,
      state.persons.map((person) => ({ person, income: getPersonNet(person, monthKey) })),
      monthKey
    );
    const monthlyTarget = roundMoney(Object.values(shareMapping).reduce((sum, value) => sum + Number(value || 0), 0));

    return {
      dueTotal: roundMoney(dueTotal),
      paidTotal: roundMoney(paidTotal),
      openTotal: roundMoney(Math.max(dueTotal - paidTotal, 0)),
      monthlyTarget,
      shareMapping
    };
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

    const target = getCommonAccountTargetSummary(currentMonth);
    const contributionDetails = computeCommonAccountDetails(currentMonth);

    const targetCard = document.createElement('section');
    targetCard.className = 'common-account-target-card';
    targetCard.appendChild(createUiEl('div', 'common-account-target-eyebrow', `Gemeinschaftskonto · ${formatMonthLabel(currentMonth)}`));
    targetCard.appendChild(createUiEl('h2', 'common-account-target-title', 'Diesen Monat einzuzahlen'));
    targetCard.appendChild(createUiEl('div', 'common-account-target-value', euro(target.monthlyTarget)));
    targetCard.appendChild(createUiEl('p', 'common-account-target-copy', 'Diesen Betrag zahlt ihr im ausgewählten Monat auf das Gemeinschaftskonto. Monatsanteile für spätere jährliche oder vierteljährliche Zahlungen sind bereits enthalten.'));
    const currentNeed = document.createElement('div');
    currentNeed.className = `common-current-need ${target.openTotal > 0 ? 'is-open' : 'is-done'}`;
    currentNeed.appendChild(createUiEl('div', 'common-current-need-label', 'Jetzt noch auf dem Konto benötigt'));
    currentNeed.appendChild(createUiEl('strong', 'common-current-need-value', euro(target.openTotal)));
    currentNeed.appendChild(createUiEl(
      'div',
      'small muted',
      target.openTotal > 0
        ? 'Summe der noch offenen gemeinsamen Abbuchungen. Der Wert sinkt automatisch bei „Bezahlt“.'
        : 'Alle in diesem Monat fälligen gemeinsamen Abbuchungen sind als bezahlt markiert.'
    ));
    targetCard.appendChild(currentNeed);
    targetCard.appendChild(createSummaryMetrics([
      {
        label: 'Bereits eingezahlt',
        value: euro(contributionDetails.contributionsPaid),
        kind: contributionDetails.contributionsPaid > 0 ? 'success' : '',
        hint: 'Von euren Monatsanteilen'
      },
      {
        label: 'Noch einzuzahlen',
        value: euro(contributionDetails.contributionsOpen),
        kind: contributionDetails.contributionsOpen > 0 ? 'warning' : 'success',
        hint: contributionDetails.contributionsOpen > 0 ? 'Noch nicht als eingezahlt markiert' : 'Alle Monatsanteile sind erledigt'
      }
    ]));
    card.appendChild(targetCard);
    const distBox = document.createElement('div');
    distBox.className = 'sub-card';
    const distTitle = document.createElement('h3');
    distTitle.textContent = 'Eure Monatsanteile';
    distBox.appendChild(distTitle);
    distBox.appendChild(createUiEl(
      'p',
      'small muted',
      'Die automatische Aufteilung ist vorausgefüllt. Du kannst jeden Anteil für diesen Monat manuell ändern – Komma-Beträge wie 425,50 sind möglich.'
    ));
    const distTable = document.createElement('table');
    distTable.className = 'list-table common-contribution-table';
    const distHead = document.createElement('thead');
    distHead.innerHTML = '<tr><th>Person</th><th>Monatsbeitrag</th><th>Eingezahlt?</th></tr>';
    distTable.appendChild(distHead);
    const distBody = document.createElement('tbody');
    let automaticCommonRaw = 0;
    (state.commonCosts || []).forEach((cost) => {
      if (isPostActiveInMonth(cost, currentMonth)) automaticCommonRaw += getCommonMonthlyShare(cost, currentMonth);
    });
    const automaticShareMap = computeAutomaticRoundedCommonShares(
      automaticCommonRaw,
      state.persons.map((person) => ({ person, income: getPersonNet(person, currentMonth) })),
      currentMonth
    );
    contributionDetails.persons.forEach((rowData) => {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = rowData.person.name;
      const amountCell = document.createElement('td');
      amountCell.className = 'common-contribution-amount-cell';
      const automaticAmount = roundMoney(Number(automaticShareMap[rowData.person.id] || 0));
      const manualAmount = getManualCommonContribution(currentMonth, rowData.person.id);
      const amountControls = document.createElement('div');
      amountControls.className = 'common-contribution-amount-controls';
      const amountInput = document.createElement('input');
      amountInput.type = 'text';
      amountInput.inputMode = 'decimal';
      amountInput.className = 'common-contribution-amount-input';
      amountInput.setAttribute('aria-label', `Monatsanteil für ${rowData.person.name} in Euro`);
      amountInput.value = formatNumberInput(rowData.plannedAmount);
      const saveAmountButton = document.createElement('button');
      saveAmountButton.type = 'button';
      saveAmountButton.className = 'secondary compact';
      saveAmountButton.textContent = 'Speichern';
      saveAmountButton.addEventListener('click', () => {
        if (!amountInput.value.trim()) {
          alert('Bitte einen Anteil eingeben, zum Beispiel 425,50.');
          return;
        }
        const amount = parseMoneyInput(amountInput.value);
        if (!Number.isFinite(amount) || amount < 0) {
          alert('Bitte einen gültigen Anteil eingeben, zum Beispiel 425,50.');
          return;
        }
        if (!setManualCommonContribution(currentMonth, rowData.person.id, amount)) {
          alert('Der Anteil konnte nicht gespeichert werden.');
          return;
        }
        addChangeLog(
          'Gemeinsame Kosten',
          `${rowData.person.name}: Monatsanteil auf ${euro(amount)} manuell gesetzt.`,
          currentMonth
        );
        saveState();
        render();
      });
      amountInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          saveAmountButton.click();
        }
      });
      amountControls.appendChild(amountInput);
      amountControls.appendChild(saveAmountButton);
      if (manualAmount !== null) {
        const autoButton = document.createElement('button');
        autoButton.type = 'button';
        autoButton.className = 'ghost-btn compact';
        autoButton.textContent = 'Automatisch';
        autoButton.title = `Setzt den Anteil wieder auf die automatische Berechnung von ${euro(automaticAmount)}.`;
        autoButton.addEventListener('click', () => {
          clearManualCommonContribution(currentMonth, rowData.person.id);
          addChangeLog(
            'Gemeinsame Kosten',
            `${rowData.person.name}: Monatsanteil wieder automatisch berechnet (${euro(automaticAmount)}).`,
            currentMonth
          );
          saveState();
          render();
        });
        amountControls.appendChild(autoButton);
      }
      amountCell.appendChild(amountControls);
      amountCell.appendChild(createUiEl(
        'div',
        `small ${manualAmount !== null ? 'success-text' : 'muted'}`,
        manualAmount !== null ? `Manuell · automatisch wären es ${euro(automaticAmount)}` : 'Automatisch berechnet'
      ));
      if (rowData.paid && Math.abs(Number(rowData.plannedAmount || 0) - Number(rowData.paidAmount || 0)) > 0.005) {
        amountCell.appendChild(createUiEl('div', 'small muted', `${euro(rowData.paidAmount)} bereits eingezahlt`));
      }
      const statusCell = document.createElement('td');
      statusCell.className = 'common-contribution-status';
      const complete = Number(rowData.openAmount || 0) <= 0.005;
      const statusButton = document.createElement('button');
      statusButton.type = 'button';
      statusButton.className = complete ? 'success' : 'primary';
      statusButton.textContent = complete ? 'Eingezahlt ✓' : (rowData.paid ? 'Rest als eingezahlt' : 'Als eingezahlt markieren');
      statusButton.title = complete
        ? 'Klicken, um die Markierung für diesen Monat zurückzusetzen.'
        : 'Markiert den Monatsbeitrag als eingezahlt. Es wird kein Kontostand verändert.';
      statusButton.addEventListener('click', () => {
        setCommonAccountContributionPaid(currentMonth, rowData.person.id, !complete, { amount: rowData.plannedAmount });
        saveState();
        render();
      });
      statusCell.appendChild(statusButton);
      row.appendChild(nameCell);
      row.appendChild(amountCell);
      row.appendChild(statusCell);
      distBody.appendChild(row);
    });
    distTable.appendChild(distBody);
    distBox.appendChild(distTable);
    card.appendChild(distBox);
    const paymentHint = document.createElement('p');
    paymentHint.className = 'small muted';
    paymentHint.textContent = 'Ein echter Kontostand wird nicht abgefragt. „Jetzt noch benötigt“ wird ausschließlich aus den offenen gemeinsamen Abbuchungen berechnet und passt sich bei „Bezahlt“ automatisch an.';
    card.appendChild(paymentHint);
    card.appendChild(makeSearchFilterBar(commonSearch, commonFilter, (v) => { commonSearch = v; }, (v) => { commonFilter = v; }, [['all','Alle'],['due','Fällig'],['open','Offen'],['paid','Bezahlt'],['linked','Mit Schuld verknüpft'],['reserve','Mit Rücklage']]));

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
        <th>Rücklage</th>
        <th>Verknüpfte Schuld</th>
        <th class="account-only">Konto</th>
        <th>Bezahlt?</th>
        <th>Aktion</th>
      </tr>`;
      table.appendChild(thead);
      const tbody = document.createElement('tbody');

      let visibleCount = 0;
      state.commonCosts.forEach((c) => {
        ensurePostConfig(c);
        if (!isPostVisibleInMonth(c, currentMonth)) return;
        if (!matchesSearchText(c.name, commonSearch) || !matchesPostStatus(c, currentMonth, commonFilter)) return;
        visibleCount += 1;
        const tr = document.createElement('tr');
        const dueNow = isDue(c, currentMonth);
        const currentAmount = getEffectiveAmountForMonth(c, currentMonth);
        const monthlyShare = getCommonMonthlyShare(c, currentMonth);
        const paidNow = c.paidMonths.includes(currentMonth);
        const linkedSavingsGoalName = getLinkedSavingsGoalName(c);
        const deductsBalance = canPostDebitAccountBalance(c);
        const balanceDebitedNow = !!getPostAccountBalanceDebit(c, currentMonth);
        const linkedDebtName = getLinkedDebtName(c);
        tr.innerHTML = `<td>${c.name}</td>
          <td>${euro(currentAmount)}</td>
          <td>${getDisplayInterval(c)}</td>
          <td>${c.startMonth}</td>
          <td>${getDisplayEndMonth(c)}</td>
          <td>${euro(monthlyShare)}</td>
          <td>${getDueBadgeHtml(dueNow)}</td>
          <td>${linkedSavingsGoalName || '-'}</td>
          <td>${linkedDebtName || '-'}</td>
          <td class="account-only">${getAccountName(c.accountId)}</td>
          <td></td>
          <td></td>`;

        const paidCell = tr.children[10];
        if (dueNow) {
          if (!paidNow) {
            const btn = document.createElement('button');
            btn.textContent = linkedSavingsGoalName ? 'Zurücklegen' : 'Bezahlt markieren';
            btn.className = 'success';
            btn.addEventListener('click', () => {
              setPostPaidForMonth(c, currentMonth, true);
              syncDebtPaymentFromPost(c, currentMonth);
              saveState();
              render();
            });
            paidCell.appendChild(btn);
          } else if (ACCOUNTS_ENABLED && !balanceDebitedNow && deductsBalance) {
            const debitBtn = document.createElement('button');
            debitBtn.textContent = c.bookingType === 'transfer' ? 'Umbuchung nachholen' : 'Kontoabzug nachholen';
            debitBtn.className = 'success';
            debitBtn.addEventListener('click', () => {
              applyPostAccountBalanceDebit(c, currentMonth, true);
              saveState();
              render();
            });
            paidCell.appendChild(debitBtn);
          } else {
            const doneBtn = document.createElement('button');
            doneBtn.textContent = linkedSavingsGoalName ? 'Zurückgelegt' : 'Bezahlt';
            doneBtn.disabled = true;
            doneBtn.className = 'secondary';
            paidCell.appendChild(doneBtn);
          }
        } else {
          paidCell.textContent = '-';
        }

        const actionCell = tr.children[11];
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
        const bookedNow = isPostBookedForMonth(c, currentMonth);
        actionCell.appendChild(createActionMenu([
          { label: linkedSavingsGoalName ? 'Zurücklegen' : 'Bezahlt markieren', className: 'success', disabled: !dueNow || paidNow, onClick: () => { setPostPaidForMonth(c, currentMonth, true); syncDebtPaymentFromPost(c, currentMonth); saveState(); render(); } },
          ACCOUNTS_ENABLED && !balanceDebitedNow && paidNow && deductsBalance ? { label: c.bookingType === 'transfer' ? 'Umbuchung nachholen' : 'Kontoabzug nachholen', className: 'success', onClick: () => { applyPostAccountBalanceDebit(c, currentMonth, true); saveState(); render(); } } : null,
          ACCOUNTS_ENABLED ? { label: linkedSavingsGoalName ? 'Zurückgelegt + Nachweis buchen' : (deductsBalance ? 'Bezahlt + Nachweis buchen' : 'Bezahlt + Umbuchung buchen'), className: 'success', disabled: !dueNow || bookedNow, onClick: () => { bookPostPaymentForMonth(c, currentMonth); syncDebtPaymentFromPost(c, currentMonth); saveState(); render(); } } : null,
          ACCOUNTS_ENABLED ? { label: 'Buchung entfernen', className: 'secondary', disabled: !bookedNow, onClick: () => { unbookPostPaymentForMonth(c, currentMonth); saveState(); render(); } } : null,
          { label: 'Zahlung zurücksetzen', className: 'secondary', disabled: !paidNow, onClick: () => { setPostPaidForMonth(c, currentMonth, false); resetDebtPaymentFromPost(c, currentMonth); saveState(); render(); } },
          { label: 'Bearbeiten', className: 'primary', onClick: () => showCommonEditor(c) },
          { label: 'Löschen', className: 'danger', onClick: () => { if (confirm(`"${c.name}" löschen?`)) { state.commonCosts = state.commonCosts.filter((x) => x.id !== c.id); saveState(); render(); } } }
        ]));
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      if (visibleCount === 0) {
        const emptyMonth = document.createElement('p');
        emptyMonth.className = 'small muted';
        emptyMonth.textContent = `Für ${formatMonthLabel(currentMonth)} sind keine passenden gemeinsamen Kosten sichtbar.`;
        card.appendChild(emptyMonth);
      } else {
        card.appendChild(table);
      }

    }

    commonSection.appendChild(card);
  }
  // Editor für gemeinsamen Kostenposten (Prompt-basierter Editor bleibt bestehen)
    
function showCommonEditor(editCost) {
    const refs = {};
    const content = document.createElement('div');
    content.className = 'modal-form guided-post-form';
    content.appendChild(createGuidedFormIntro(
      editCost ? 'Gemeinsamen Posten bearbeiten' : 'Gemeinsamen Posten anlegen',
      `Für ${formatMonthLabel(currentMonth)}. Betrag mit Komma ist okay, zum Beispiel 30,50.`
    ));

    const baseSection = createGuidedFormSection('1. Was ist es?', 'Name und Betrag reichen für den wichtigsten Teil.');
    const row1 = document.createElement('div');
    row1.className = 'row guided-row';
    refs.nameInput = document.createElement('input');
    refs.nameInput.type = 'text';
    refs.nameInput.placeholder = 'z. B. Laptop-Rücklage';
    refs.nameInput.value = editCost ? editCost.name : '';
    refs.amountInput = createMoneyField(editCost ? getEffectiveAmountForMonth(editCost, currentMonth) : '');
    row1.appendChild(createLabelInput('Name', refs.nameInput));
    row1.appendChild(createLabelInput('Betrag in €', refs.amountInput));
    baseSection.appendChild(row1);
    content.appendChild(baseSection);
    appendAmountChangeModeField(content, refs, editCost);

    const scheduleSection = createGuidedFormSection('2. Wann zählt der Posten?', 'Einmalig für genau einen Monat oder laufend mit verständlichem Rhythmus.');
    const row2 = document.createElement('div');
    row2.className = 'row guided-row';
    refs.typeSelect = document.createElement('select');
    refs.typeSelect.innerHTML = '<option value="once">Einmalig</option><option value="recurring">Laufend</option>';
    refs.typeSelect.value = editCost && isOneTimePost(editCost) ? 'once' : 'recurring';
    refs.intervalInput = createIntervalSelect(editCost ? editCost.interval : 1);
    refs.startInput = document.createElement('input');
    refs.startInput.type = 'month';
    refs.startInput.value = editCost ? editCost.startMonth : currentMonth;
    row2.appendChild(createLabelInput('Zahlungsart', refs.typeSelect));
    row2.appendChild(createLabelInput('Rhythmus', refs.intervalInput));
    row2.appendChild(createLabelInput('Startmonat', refs.startInput));
    scheduleSection.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'row guided-row';
    refs.limitSelect = document.createElement('select');
    refs.limitSelect.innerHTML = '<option value="none">Unbegrenzt</option><option value="until">Befristet bis</option>';
    refs.limitSelect.value = editCost && !isOneTimePost(editCost) && editCost.endMonth ? 'until' : 'none';
    refs.endInput = document.createElement('input');
    refs.endInput.type = 'month';
    refs.endInput.value = editCost && !isOneTimePost(editCost) && editCost.endMonth ? editCost.endMonth : '';
    row3.appendChild(createLabelInput('Laufzeit', refs.limitSelect));
    row3.appendChild(createLabelInput('Bis Monat', refs.endInput));
    scheduleSection.appendChild(row3);
    content.appendChild(scheduleSection);

    const linkSection = createGuidedFormSection('3. Optional verknüpfen', 'Nur ausfüllen, wenn der Posten zu einer Schuld oder Rücklage gehört.');
    const row4 = document.createElement('div');
    row4.className = 'row guided-row';
    refs.debtSelect = document.createElement('select');
    refs.debtSelect.innerHTML = '<option value="">Keine verknüpfte Schuld</option>';
    state.debts.forEach((debt) => {
      const option = document.createElement('option');
      option.value = debt.id;
      option.textContent = debt.name;
      refs.debtSelect.appendChild(option);
    });
    refs.debtSelect.value = editCost && editCost.linkedDebtId ? editCost.linkedDebtId : '';
    refs.accountSelect = { value: '' };
    row4.appendChild(createLabelInput('Schuld verknüpfen', refs.debtSelect));
    if (ACCOUNTS_ENABLED) {
      refs.accountSelect = createAccountSelect(editCost ? editCost.accountId : getDefaultAccountIdForContext('common'), { includeNone: true });
      row4.appendChild(createLabelInput('Zahlungskonto', refs.accountSelect));
    }
    linkSection.appendChild(row4);
    content.appendChild(linkSection);
    appendSavingsGoalLinkField(content, refs, editCost);
    appendTransferBookingFields(content, refs, editCost);

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = editCost
      ? 'Wenn sich der Betrag ändert, kannst du oben wählen, ob er nur für diesen Monat oder dauerhaft gilt.'
      : 'Neue Posten werden direkt mit ihren Laufzeitregeln gespeichert. Du kannst entweder eine Schuld oder eine Rücklage verknüpfen.';
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
          const amount = parseMoneyInput(refs.amountInput.value);
          const startMonth = refs.startInput.value;
          if (!name) return alert('Name darf nicht leer sein.');
          if (!Number.isFinite(amount) || amount < 0) return alert('Bitte einen gültigen Betrag eingeben.');
          if (refs.debtSelect.value && refs.savingsGoalSelect.value) return alert('Bitte entweder eine Schuld oder eine Rücklage verknüpfen, nicht beides.');
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
              mode = isOneTimePost(editCost) || scheduleValidation.value.oneTime
                ? 'future'
                : refs.amountChangeModeSelect.value;
            }
            editCost.name = name;
            editCost.startMonth = startMonth;
            editCost.linkedDebtId = refs.debtSelect.value || '';
            editCost.accountId = ACCOUNTS_ENABLED ? (refs.accountSelect.value || '') : '';
            if (!applyTransferBookingFieldsToPost(editCost, refs)) return;
            applyScheduleSettings(editCost, scheduleValidation.value);
            if (mode) {
              setPostAmountForMonth(editCost, currentMonth, amount, mode);
              syncLinkedDebtRateFromPost(editCost, currentMonth, mode);
            } else {
              syncLinkedDebtRateFromPost(editCost, currentMonth, 'future');
            }
            syncAppliedPostAccountBalanceAfterEdit(editCost, currentMonth, previousAmount);
            if (isPostBookedForMonth(editCost, currentMonth)) applyPostAccountBooking(editCost, currentMonth, true);
            updatePostSavingsGoalLink(editCost, refs.savingsGoalSelect.value || '', currentMonth);
          } else {
            const newCost = {
              id: generateId(),
              name,
              amount,
              interval: scheduleValidation.value.interval,
              startMonth,
              endMonth: scheduleValidation.value.endMonth,
              oneTime: scheduleValidation.value.oneTime,
              paidMonths: [],
              sharedBalanceDebitedMonths: [],
              accountBalanceDebits: {},
              amountTimeline: [],
              amountOverrides: {},
              linkedDebtId: refs.debtSelect.value || '',
              linkedSavingsGoalId: refs.savingsGoalSelect.value || '',
              accountId: ACCOUNTS_ENABLED ? (refs.accountSelect.value || '') : '',
              bookingType: refs.bookingTypeSelect && refs.bookingTypeSelect.value === 'transfer' ? 'transfer' : 'expense',
              transferToAccountId: refs.transferToAccountSelect ? (refs.transferToAccountSelect.value || '') : ''
            };
            if (!applyTransferBookingFieldsToPost(newCost, refs)) return;
            state.commonCosts.push(newCost);
            syncLinkedDebtRateFromPost(newCost, startMonth, 'future');
          }
          saveState();
          close();
          render();
        }
      }
    ]);
  }
  function getPersonCommonShareForMonth(personId, monthKey = currentMonth) {
    return getCurrentContributionAmountForPerson(monthKey, personId);
  }

  function getPersonPaidCommonShareForMonth(personId, monthKey = currentMonth) {
    const payment = getCommonAccountContributionPayment(monthKey, personId);
    return payment ? Number(payment.amount || 0) : 0;
  }

  function isCommonSharePaidForMonth(personId, monthKey = currentMonth) {
    return isCommonAccountContributionPaid(monthKey, personId);
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
    let overallCommonShare = 0;
    let overallCommonSharePaid = 0;
    state.persons.forEach((person) => {
      const personCommonShare = getPersonCommonShareForMonth(person.id, currentMonth);
      const personPaidCommonShare = getPersonPaidCommonShareForMonth(person.id, currentMonth);
      overallCommonShare += personCommonShare;
      if (isCommonSharePaidForMonth(person.id, currentMonth)) overallCommonSharePaid += personPaidCommonShare || personCommonShare;
      const posts = state.personalCosts.filter((pc) => pc.personId === person.id);
      posts.forEach((pc) => {
        if (isPostActiveInMonth(pc, currentMonth)) overallMonthly += getEffectiveAmountForMonth(pc, currentMonth) / Number(pc.interval || 1);
        if (isDue(pc, currentMonth)) {
          overallDue += getEffectiveAmountForMonth(pc, currentMonth);
          if (pc.paidMonths && pc.paidMonths.includes(currentMonth)) overallPaid += getEffectiveAmountForMonth(pc, currentMonth);
        }
      });
    });
    const overallDueWithCommon = overallDue + overallCommonShare;
    const overallPaidWithCommon = overallPaid + overallCommonSharePaid;
    const overallOpenWithCommon = Math.max(overallDueWithCommon - overallPaidWithCommon, 0);

    const summaryCard = document.createElement('div');
    summaryCard.className = 'card';
    const summaryTitle = document.createElement('h2');
    summaryTitle.textContent = 'Persönliche Ausgaben gesamt';
    summaryCard.appendChild(summaryTitle);
    summaryCard.appendChild(createSummaryMetrics([
      { label: 'Monatlich geplant', value: `${euro(overallMonthly)}` },
      { label: 'Anteil gemeinsame Kosten', value: `${euro(overallCommonShare)}`, kind: overallCommonShare > 0 ? 'warning' : '' },
      { label: 'Fällig inkl. Anteil', value: `${euro(overallDueWithCommon)}`, kind: overallDueWithCommon > 0 ? 'warning' : '' },
      { label: 'Bereits markiert inkl. Anteil', value: `${euro(overallPaidWithCommon)}`, kind: overallPaidWithCommon > 0 ? 'success' : '' },
      { label: 'Noch offen inkl. Anteil', value: `${euro(overallOpenWithCommon)}`, kind: overallOpenWithCommon > 0 ? 'danger' : 'success' }
    ]));
    personalSection.appendChild(summaryCard);
    const personalFilterCard = document.createElement('div');
    personalFilterCard.className = 'card compact-card';
    personalFilterCard.appendChild(makeSearchFilterBar(personalSearch, personalFilter, (v) => { personalSearch = v; }, (v) => { personalFilter = v; }, [['all','Alle'],['due','Fällig'],['open','Offen'],['paid','Bezahlt'],['linked','Mit Schuld verknüpft'],['reserve','Mit Rücklage']]));
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

      const posts = state.personalCosts
        .filter((pc) => pc.personId === person.id)
        .filter((pc) => isPostVisibleInMonth(pc, currentMonth))
        .filter((pc) => matchesSearchText(pc.name, personalSearch) && matchesPostStatus(pc, currentMonth, personalFilter));
      const commonShare = getPersonCommonShareForMonth(person.id, currentMonth);
      const commonSharePaid = isCommonSharePaidForMonth(person.id, currentMonth);
      const commonSharePaidAmount = commonSharePaid ? (getPersonPaidCommonShareForMonth(person.id, currentMonth) || commonShare) : 0;
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

      const dueWithCommon = dueSum + commonShare;
      const paidWithCommon = paidSum + commonSharePaidAmount;
      const openWithCommon = Math.max(dueWithCommon - paidWithCommon, 0);
      const commonShareDiff = roundMoney(commonShare - commonSharePaidAmount);
      card.appendChild(createSummaryMetrics([
        { label: 'Persönlich geplant', value: `${euro(monthlySum)}` },
        { label: 'Anteil gemeinsame Kosten', value: `${euro((commonSharePaid ? commonSharePaidAmount : commonShare))}`, kind: commonSharePaid && commonShareDiff <= 0.005 ? 'success' : (commonShare > 0 ? 'warning' : '') , hint: commonSharePaid ? (Math.abs(commonShareDiff) > 0.005 ? `Fixiert; aktueller Soll-Anteil ${euro(commonShare)}.` : 'Bereits als bezahlt fixiert.') : 'Noch als Monatsanteil offen.' },
        { label: 'Fällig inkl. Anteil', value: `${euro(dueWithCommon)}`, kind: dueWithCommon > 0 ? 'warning' : '' },
        { label: 'Bereits markiert inkl. Anteil', value: `${euro(paidWithCommon)}`, kind: paidWithCommon > 0 ? 'success' : '' },
        { label: 'Noch offen inkl. Anteil', value: `${euro(openWithCommon)}`, kind: openWithCommon > 0 ? 'danger' : 'success' }
      ]));

      const commonShareInfo = document.createElement('div');
      commonShareInfo.className = commonSharePaid && commonShareDiff <= 0.005 ? 'notice success personal-common-share' : 'notice warning personal-common-share';
      commonShareInfo.innerHTML = commonSharePaid
        ? `<strong>Anteil gemeinsame Kosten:</strong> ${euro(commonSharePaidAmount)} ist als bezahlt fixiert.${Math.abs(commonShareDiff) > 0.005 ? ` Aktueller Soll-Anteil: ${euro(commonShare)}.` : ''}`
        : `<strong>Anteil gemeinsame Kosten:</strong> ${euro(commonShare)} ist noch nicht als bezahlt markiert.`;
      card.appendChild(commonShareInfo);

      if (posts.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'Keine persönlichen Ausgaben eingetragen.';
        card.appendChild(p);
      } else {
        const table = document.createElement('table');
        table.className = 'list-table';
        const thead = document.createElement('thead');
        thead.innerHTML = `<tr><th>Name</th><th>Betrag</th><th>Intervall</th><th>Start</th><th>Bis</th><th>Fällig</th><th>Rücklage</th><th>Verknüpfte Schuld</th><th class="account-only">Konto</th><th>Bezahlt?</th><th>Aktion</th></tr>`;
        table.appendChild(thead);
        const tbody = document.createElement('tbody');

        posts.forEach((pc) => {
          if (!pc.paidMonths) pc.paidMonths = [];
          const tr = document.createElement('tr');
          const dueNow = isDue(pc, currentMonth);
          const paidNow = pc.paidMonths.includes(currentMonth);
          const currentAmount = getEffectiveAmountForMonth(pc, currentMonth);
          const linkedSavingsGoalName = getLinkedSavingsGoalName(pc);
          const linkedDebtName = getLinkedDebtName(pc);
          const deductsBalance = canPostDebitAccountBalance(pc);
          const balanceDebitedNow = !!getPostAccountBalanceDebit(pc, currentMonth);
          const paidWithIncomeHint = pc.paidWithIncome === true ? '<div class="small muted">Lohnabzug · automatisch bei Lohn-Eingang</div>' : '';
          tr.innerHTML = `<td>${pc.name}${paidWithIncomeHint}</td>
            <td>${euro(currentAmount)}</td>
            <td>${getDisplayInterval(pc)}</td>
            <td>${pc.startMonth}</td>
            <td>${getDisplayEndMonth(pc)}</td>
            <td>${getDueBadgeHtml(dueNow)}</td>
            <td>${linkedSavingsGoalName || '-'}</td>
            <td>${linkedDebtName || '-'}</td>
            <td class="account-only">${getAccountName(pc.accountId)}</td>
            <td></td><td></td>`;

          const paidCell = tr.children[9];
          if (dueNow) {
            if (!paidNow) {
              const btn = document.createElement('button');
              btn.textContent = linkedSavingsGoalName ? 'Zurücklegen' : (linkedDebtName ? 'Bezahlt + Schuld aktualisieren' : 'Bezahlt markieren');
              btn.className = 'success';
              btn.addEventListener('click', () => {
                setPostPaidForMonth(pc, currentMonth, true);
                syncDebtPaymentFromPost(pc, currentMonth);
                saveState();
                render();
              });
              paidCell.appendChild(btn);
            } else if (ACCOUNTS_ENABLED && !balanceDebitedNow && deductsBalance) {
              const debitBtn = document.createElement('button');
              debitBtn.textContent = pc.bookingType === 'transfer' ? 'Umbuchung nachholen' : 'Kontoabzug nachholen';
              debitBtn.className = 'success';
              debitBtn.addEventListener('click', () => {
                applyPostAccountBalanceDebit(pc, currentMonth, true);
                saveState();
                render();
              });
              paidCell.appendChild(debitBtn);
            } else {
              const doneBtn = document.createElement('button');
              doneBtn.textContent = linkedSavingsGoalName ? 'Zurückgelegt' : (linkedDebtName ? 'Bezahlt · Schuld geführt' : 'Bezahlt');
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
          const bookedNow = isPostBookedForMonth(pc, currentMonth);
          actionCell.appendChild(createActionMenu([
            ACCOUNTS_ENABLED && !balanceDebitedNow && paidNow && deductsBalance ? { label: pc.bookingType === 'transfer' ? 'Umbuchung nachholen' : 'Kontoabzug nachholen', className: 'success', onClick: () => { applyPostAccountBalanceDebit(pc, currentMonth, true); saveState(); render(); } } : null,
            ACCOUNTS_ENABLED ? { label: linkedSavingsGoalName ? 'Zurückgelegt + Nachweis buchen' : (linkedDebtName ? 'Bezahlt + Schuld + Nachweis buchen' : 'Bezahlt + buchen'), className: 'success', disabled: !dueNow || bookedNow, onClick: () => { bookPostPaymentForMonth(pc, currentMonth); syncDebtPaymentFromPost(pc, currentMonth); saveState(); render(); } } : null,
            ACCOUNTS_ENABLED ? { label: 'Buchung entfernen', className: 'secondary', disabled: !bookedNow, onClick: () => { unbookPostPaymentForMonth(pc, currentMonth); saveState(); render(); } } : null,
            { label: 'Zahlung zurücksetzen', className: 'secondary', disabled: !paidNow, onClick: () => { setPostPaidForMonth(pc, currentMonth, false); resetDebtPaymentFromPost(pc, currentMonth); saveState(); render(); } },
            { label: 'Bearbeiten', className: 'primary', onClick: () => showPersonalEditor(person.id, pc) },
            { label: 'Löschen', className: 'danger', onClick: () => { if (confirm(`"${pc.name}" löschen?`)) { state.personalCosts = state.personalCosts.filter((x) => x.id !== pc.id); saveState(); render(); } } }
          ]));
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
    content.className = 'modal-form guided-post-form';

    content.appendChild(createGuidedFormIntro(
      editPost ? `${person.name}: Posten bearbeiten` : `${person.name}: Posten anlegen`,
      `Für ${formatMonthLabel(currentMonth)}. Betrag mit Komma ist okay, zum Beispiel 30,50.`
    ));

    const baseSection = createGuidedFormSection('1. Was ist es?', 'Name und Betrag zuerst; alles Weitere ist Zusatz.');
    const row1 = document.createElement('div');
    row1.className = 'row guided-row';
    refs.nameInput = document.createElement('input');
    refs.nameInput.type = 'text';
    refs.nameInput.placeholder = 'z. B. Handy, Kreiskasse, Beitrag';
    refs.nameInput.value = editPost ? editPost.name : '';
    refs.amountInput = createMoneyField(editPost ? getEffectiveAmountForMonth(editPost, currentMonth) : '');
    row1.appendChild(createLabelInput('Name', refs.nameInput));
    row1.appendChild(createLabelInput('Betrag in €', refs.amountInput));
    baseSection.appendChild(row1);
    content.appendChild(baseSection);
    appendAmountChangeModeField(content, refs, editPost);

    const scheduleSection = createGuidedFormSection('2. Wann zählt der Posten?', 'Einmalig für den Monat oder laufend für wiederkehrende Ausgaben.');
    const row2 = document.createElement('div');
    row2.className = 'row guided-row';
    refs.typeSelect = document.createElement('select');
    refs.typeSelect.innerHTML = '<option value="once">Einmalig</option><option value="recurring">Laufend</option>';
    refs.typeSelect.value = editPost ? (isOneTimePost(editPost) ? 'once' : 'recurring') : 'once';
    refs.intervalInput = createIntervalSelect(editPost ? editPost.interval : 1);
    refs.startInput = document.createElement('input');
    refs.startInput.type = 'month';
    refs.startInput.value = editPost ? editPost.startMonth : currentMonth;
    row2.appendChild(createLabelInput('Zahlungsart', refs.typeSelect));
    row2.appendChild(createLabelInput('Rhythmus', refs.intervalInput));
    row2.appendChild(createLabelInput('Startmonat', refs.startInput));
    scheduleSection.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'row guided-row';
    refs.limitSelect = document.createElement('select');
    refs.limitSelect.innerHTML = '<option value="none">Unbegrenzt</option><option value="until">Befristet bis</option>';
    refs.limitSelect.value = editPost && !isOneTimePost(editPost) && editPost.endMonth ? 'until' : 'none';
    refs.endInput = document.createElement('input');
    refs.endInput.type = 'month';
    refs.endInput.value = editPost && !isOneTimePost(editPost) && editPost.endMonth ? editPost.endMonth : '';
    row3.appendChild(createLabelInput('Laufzeit', refs.limitSelect));
    row3.appendChild(createLabelInput('Bis Monat', refs.endInput));
    scheduleSection.appendChild(row3);
    content.appendChild(scheduleSection);

    const linkSection = createGuidedFormSection('3. Optional verknüpfen', 'Nur nutzen, wenn die Ausgabe zu einer Schuld, Rücklage oder einem Lohnabzug gehört.');
    const row4 = document.createElement('div');
    row4.className = 'row guided-row';
    refs.debtSelect = document.createElement('select');
    refs.debtSelect.innerHTML = '<option value="">Keine verknüpfte Schuld</option>';
    state.debts.forEach((debt) => {
      const option = document.createElement('option');
      option.value = debt.id;
      option.textContent = debt.name;
      refs.debtSelect.appendChild(option);
    });
    refs.debtSelect.value = editPost && editPost.linkedDebtId ? editPost.linkedDebtId : '';
    refs.accountSelect = { value: '' };
    row4.appendChild(createLabelInput('Schuld verknüpfen', refs.debtSelect));
    if (ACCOUNTS_ENABLED) {
      refs.accountSelect = createAccountSelect(editPost ? editPost.accountId : getDefaultAccountIdForContext('personal', personId), { includeNone: true });
      row4.appendChild(createLabelInput('Zahlungskonto', refs.accountSelect));
    }
    linkSection.appendChild(row4);
    const incomePaymentLabel = document.createElement('label');
    incomePaymentLabel.className = 'check-line';
    refs.paidWithIncomeCheck = document.createElement('input');
    refs.paidWithIncomeCheck.type = 'checkbox';
    refs.paidWithIncomeCheck.checked = !!(editPost && editPost.paidWithIncome === true);
    incomePaymentLabel.appendChild(refs.paidWithIncomeCheck);
    incomePaymentLabel.appendChild(document.createTextNode(' Direkt vom Lohn einbehalten: bei Lohn-Eingang automatisch als bezahlt markieren'));
    linkSection.appendChild(incomePaymentLabel);
    const incomePaymentHint = document.createElement('p');
    incomePaymentHint.className = 'small muted form-section-hint';
    incomePaymentHint.textContent = 'Nutze dies z. B. für Kreiskasse OPR, wenn du den einbehaltenen Betrag zuvor zum eingetragenen Auszahlungslohn hinzurechnest. Die Ausgabe und Schuldzahlung bleiben dadurch korrekt sichtbar.';
    linkSection.appendChild(incomePaymentHint);
    content.appendChild(linkSection);
    appendSavingsGoalLinkField(content, refs, editPost);
    appendTransferBookingFields(content, refs, editPost);

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = editPost
      ? 'Wenn sich der Betrag ändert, kannst du oben „nur dieser Monat“ oder „ab jetzt dauerhaft“ wählen.'
      : 'Neue persönliche Posten kannst du hier kompakt anlegen. Du kannst entweder eine Schuld oder eine Rücklage verknüpfen.';
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
          const amount = parseMoneyInput(refs.amountInput.value);
          const startMonth = refs.startInput.value;
          if (!name) return alert('Name darf nicht leer sein.');
          if (!Number.isFinite(amount) || amount < 0) return alert('Bitte einen gültigen Betrag eingeben.');
          if (refs.debtSelect.value && refs.savingsGoalSelect.value) return alert('Bitte entweder eine Schuld oder eine Rücklage verknüpfen, nicht beides.');
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
              mode = isOneTimePost(editPost) || scheduleValidation.value.oneTime
                ? 'future'
                : refs.amountChangeModeSelect.value;
            }
            editPost.name = name;
            editPost.startMonth = startMonth;
            editPost.linkedDebtId = refs.debtSelect.value || '';
            editPost.accountId = ACCOUNTS_ENABLED ? (refs.accountSelect.value || '') : '';
            editPost.paidWithIncome = refs.paidWithIncomeCheck.checked;
            if (!applyTransferBookingFieldsToPost(editPost, refs)) return;
            applyScheduleSettings(editPost, scheduleValidation.value);
            if (mode) {
              setPostAmountForMonth(editPost, currentMonth, amount, mode);
              syncLinkedDebtRateFromPost(editPost, currentMonth, mode);
            } else {
              syncLinkedDebtRateFromPost(editPost, currentMonth, 'future');
            }
            if (isPostBookedForMonth(editPost, currentMonth)) applyPostAccountBooking(editPost, currentMonth, true);
            updatePostSavingsGoalLink(editPost, refs.savingsGoalSelect.value || '', currentMonth);
            syncAppliedPostAccountBalanceAfterEdit(editPost, currentMonth, previousAmount);
          } else {
            const newPost = {
              id: generateId(),
              personId,
              name,
              amount,
              interval: scheduleValidation.value.interval,
              startMonth,
              endMonth: scheduleValidation.value.endMonth,
              oneTime: scheduleValidation.value.oneTime,
              paidMonths: [],
              accountBalanceDebits: {},
              amountTimeline: [],
              amountOverrides: {},
              linkedDebtId: refs.debtSelect.value || '',
              linkedSavingsGoalId: refs.savingsGoalSelect.value || '',
              accountId: ACCOUNTS_ENABLED ? (refs.accountSelect.value || '') : '',
              paidWithIncome: refs.paidWithIncomeCheck.checked,
              incomePaidMonths: []
            };
            if (!applyTransferBookingFieldsToPost(newPost, refs)) return;
            state.personalCosts.push(newPost);
            syncLinkedDebtRateFromPost(newPost, startMonth, 'future');
          }
          if (refs.paidWithIncomeCheck.checked && isPersonIncomeReceived(person, currentMonth)) {
            syncPaymentsPaidWithIncome(person, currentMonth, true);
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
    content.className = 'modal-form guided-post-form';

    content.appendChild(createGuidedFormIntro(
      editPost ? 'Sonstige Ausgabe bearbeiten' : 'Sonstige Ausgabe anlegen',
      `Für ${formatMonthLabel(currentMonth)}. Wird im sicheren freien Betrag vorsorglich berücksichtigt und beim Bezahlt-Markieren nicht doppelt gesenkt.`
    ));

    const baseSection = createGuidedFormSection('1. Was wurde geplant?', 'Für spontane oder einmalige Ausgaben reicht meist diese erste Zeile.');
    const row1 = document.createElement('div');
    row1.className = 'row guided-row';
    refs.nameInput = document.createElement('input');
    refs.nameInput.type = 'text';
    refs.nameInput.placeholder = 'z. B. Kleidung, Geschenk, Reparatur';
    refs.nameInput.value = editPost ? editPost.name : '';
    refs.amountInput = createMoneyField(editPost ? getEffectiveAmountForMonth(editPost, currentMonth) : '');
    row1.appendChild(createLabelInput('Name', refs.nameInput));
    row1.appendChild(createLabelInput('Betrag in €', refs.amountInput));
    baseSection.appendChild(row1);
    content.appendChild(baseSection);
    appendAmountChangeModeField(content, refs, editPost);

    const scheduleSection = createGuidedFormSection('2. Zeitraum', 'Sonstige Ausgaben sind standardmäßig einmalig. Für wiederkehrende Ausgaben kannst du „laufend“ wählen.');
    const row2 = document.createElement('div');
    row2.className = 'row guided-row';
    refs.typeSelect = document.createElement('select');
    refs.typeSelect.innerHTML = '<option value="once">Einmalig</option><option value="recurring">Laufend</option>';
    refs.typeSelect.value = editPost ? (isOneTimePost(editPost) ? 'once' : 'recurring') : 'once';
    refs.intervalInput = createIntervalSelect(editPost ? editPost.interval : 1);
    refs.startInput = document.createElement('input');
    refs.startInput.type = 'month';
    refs.startInput.value = editPost ? editPost.startMonth : currentMonth;
    row2.appendChild(createLabelInput('Zahlungsart', refs.typeSelect));
    row2.appendChild(createLabelInput('Rhythmus', refs.intervalInput));
    row2.appendChild(createLabelInput('Startmonat', refs.startInput));
    scheduleSection.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'row guided-row';
    refs.limitSelect = document.createElement('select');
    refs.limitSelect.innerHTML = '<option value="none">Unbegrenzt</option><option value="until">Befristet bis</option>';
    refs.limitSelect.value = editPost && !isOneTimePost(editPost) && editPost.endMonth ? 'until' : 'none';
    refs.endInput = document.createElement('input');
    refs.endInput.type = 'month';
    refs.endInput.value = editPost && !isOneTimePost(editPost) && editPost.endMonth ? editPost.endMonth : '';
    row3.appendChild(createLabelInput('Laufzeit', refs.limitSelect));
    row3.appendChild(createLabelInput('Bis Monat', refs.endInput));
    scheduleSection.appendChild(row3);
    content.appendChild(scheduleSection);

    const linkSection = createGuidedFormSection('3. Optional verknüpfen', 'Nur nötig, wenn diese Ausgabe eigentlich eine Rücklage ist.');
    const row4 = document.createElement('div');
    row4.className = 'row guided-row';
    refs.accountSelect = { value: '' };
    if (ACCOUNTS_ENABLED) {
      refs.accountSelect = createAccountSelect(editPost ? editPost.accountId : getDefaultAccountIdForContext('personal', 'benny'), { includeNone: true });
      row4.appendChild(createLabelInput('Zahlungskonto', refs.accountSelect));
      linkSection.appendChild(row4);
    }
    if (ACCOUNTS_ENABLED) content.appendChild(linkSection);
    appendSavingsGoalLinkField(content, refs, editPost);
    appendTransferBookingFields(content, refs, editPost);

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
          const amount = parseMoneyInput(refs.amountInput.value);
          const startMonth = refs.startInput.value;
          if (!name) return alert('Name darf nicht leer sein.');
          if (!Number.isFinite(amount) || amount < 0) return alert('Bitte einen gültigen Betrag eingeben.');
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
              mode = isOneTimePost(editPost) || scheduleValidation.value.oneTime
                ? 'future'
                : refs.amountChangeModeSelect.value;
            }
            editPost.name = name;
            editPost.startMonth = startMonth;
            editPost.accountId = ACCOUNTS_ENABLED ? (refs.accountSelect.value || '') : '';
            if (!applyTransferBookingFieldsToPost(editPost, refs)) return;
            applyScheduleSettings(editPost, scheduleValidation.value);
            if (mode) {
              setPostAmountForMonth(editPost, currentMonth, amount, mode);
              syncLinkedDebtRateFromPost(editPost, currentMonth, mode);
            } else {
              syncLinkedDebtRateFromPost(editPost, currentMonth, 'future');
            }
            if (isPostBookedForMonth(editPost, currentMonth)) applyPostAccountBooking(editPost, currentMonth, true);
            updatePostSavingsGoalLink(editPost, refs.savingsGoalSelect.value || '', currentMonth);
            syncAppliedPostAccountBalanceAfterEdit(editPost, currentMonth, previousAmount);
          } else {
            const newBufferPost = {
              id: generateId(),
              name,
              amount,
              interval: scheduleValidation.value.interval,
              startMonth,
              endMonth: scheduleValidation.value.endMonth,
              oneTime: scheduleValidation.value.oneTime,
              paidMonths: [],
              accountBalanceDebits: {},
              linkedSavingsGoalId: refs.savingsGoalSelect.value || '',
              accountId: ACCOUNTS_ENABLED ? (refs.accountSelect.value || '') : '',
              bookingType: refs.bookingTypeSelect && refs.bookingTypeSelect.value === 'transfer' ? 'transfer' : 'expense',
              transferToAccountId: refs.transferToAccountSelect ? (refs.transferToAccountSelect.value || '') : ''
            };
            if (!applyTransferBookingFieldsToPost(newBufferPost, refs)) return;
            state.bufferExpenses.push(newBufferPost);
          }
          saveState();
          render();
          close();
        }
      }
    ]);
  }


  function renderTankMonthlyTracking(sub, personKey, labelText) {
    const existing = getTankEntryForMonth(personKey, currentMonth) || {};
    const previousEndKm = getPreviousTankEndKm(personKey, currentMonth);
    const automaticStartKm = existing.month ? Number(existing.startKm || 0) : previousEndKm;
    const needsManualStart = automaticStartKm === null;
    const monthlyRecord = getTankMonthlyRecord(personKey, currentMonth);
    const householdRecord = getTankHouseholdMonthlyRecord(currentMonth);
    const currentKmShare = householdRecord.km > 0 ? monthlyRecord.km / householdRecord.km : 0;
    const plannedKmShare = getTankForecastShare(personKey, currentMonth);

    const tracking = document.createElement('div');
    tracking.className = 'sub-card tank-monthly-tracking';
    tracking.appendChild(createUiEl('h4', '', 'Reale Kilometer'));
    tracking.appendChild(createUiEl('p', 'small muted', 'Du trägst nur den aktuellen Kilometerstand ein. Der Endstand des Vormonats wird automatisch als Start übernommen. Nur beim allerersten Eintrag ist zusätzlich ein Startstand nötig.'));

    tracking.appendChild(createSummaryMetrics([
      { label: 'Gefahren im Monat', value: monthlyRecord.km ? `${monthlyRecord.km.toFixed(0)} km` : '—', kind: monthlyRecord.km ? 'success' : 'warning' },
      { label: 'Anteil dieser Monats-km', value: householdRecord.km > 0 ? `${(currentKmShare * 100).toFixed(1)} %` : '—' },
      { label: 'Anteil der Planung', value: `${(plannedKmShare * 100).toFixed(1)} %`, kind: plannedKmShare > 0 ? 'success' : 'warning' }
    ]));

    const form = document.createElement('div');
    form.className = 'row tank-entry-form';
    const monthInfo = createUiEl('div', 'tank-entry-month');
    monthInfo.appendChild(createUiEl('label', '', 'Monat'));
    monthInfo.appendChild(createUiEl('strong', '', formatMonthLabel(currentMonth)));
    form.appendChild(monthInfo);
    if (!needsManualStart) {
      const startInfo = createUiEl('div', 'tank-auto-start');
      startInfo.appendChild(createUiEl('label', '', 'Start automatisch'));
      startInfo.appendChild(createUiEl('strong', '', `${Number(automaticStartKm || 0).toFixed(0)} km`));
      startInfo.appendChild(createUiEl('small', 'muted', existing.month ? 'Bereits für diesen Monat gespeichert' : 'Endstand aus dem Vormonat'));
      form.appendChild(startInfo);
    }
    const fields = needsManualStart
      ? [
        ['startKm', 'Erster Startstand', 'number', existing.startKm || ''],
        ['endKm', 'Aktueller Kilometerstand', 'number', existing.endKm || '']
      ]
      : [
        ['endKm', 'Aktueller Kilometerstand', 'number', existing.endKm || '']
      ];
    const inputs = {};
    fields.forEach(([key, label, type, value]) => {
      const wrap = document.createElement('div');
      const lab = document.createElement('label');
      lab.textContent = label;
      const input = document.createElement('input');
      input.type = type;
      input.step = type === 'number' ? '1' : undefined;
      if (type === 'number') input.min = '0';
      input.value = value;
      inputs[key] = input;
      wrap.appendChild(lab);
      wrap.appendChild(input);
      form.appendChild(wrap);
    });
    const noteWrap = document.createElement('div');
    const noteLab = document.createElement('label');
    noteLab.textContent = 'Notiz Kilometerstand';
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = 'z. B. Monatsende abgelesen';
    noteInput.value = existing.note || '';
    inputs.note = noteInput;
    noteWrap.appendChild(noteLab);
    noteWrap.appendChild(noteInput);
    form.appendChild(noteWrap);
    tracking.appendChild(form);

    const btnRow = document.createElement('div');
    btnRow.className = 'row';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'success';
    saveBtn.textContent = 'Kilometerstand speichern';
    saveBtn.addEventListener('click', () => {
      if (!isMonthKey(currentMonth) || currentMonth < TANK_REAL_DATA_START_MONTH) return alert('Echte Tankdaten werden ab Juni 2026 erfasst.');
      const startKm = needsManualStart ? parseMoneyInput(inputs.startKm.value) : Number(automaticStartKm || 0);
      const endKm = parseMoneyInput(inputs.endKm.value);
      if (!Number.isFinite(startKm) || !Number.isFinite(endKm) || endKm < startKm) return alert('Bitte gültige Kilometerstände eintragen. Der Endstand darf nicht kleiner als der Startstand sein.');
      reopenTankMonthAfterEdit(currentMonth);
      const currentRecord = getTankMonthlyRecord(personKey, currentMonth);
      const entry = upsertTankMonthlyEntry(personKey, {
        month: currentMonth,
        startKm,
        endKm,
        liters: currentRecord.liters,
        paid: currentRecord.paid,
        cashback: currentRecord.cashback,
        note: inputs.note.value
      });
      syncTankgeldExpense(personKey, { silent: true });
      addChangeLog('Tankgeld', `${labelText}: Kilometerstand ${formatMonthLabel(entry.month)} gespeichert · ${entry.km.toFixed(0)} km`, entry.month);
      saveState();
      render();
    });
    btnRow.appendChild(saveBtn);
    if (existing.month) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      delBtn.textContent = 'Kilometerstand löschen';
      delBtn.addEventListener('click', () => {
        if (confirm(`Kilometerstand für ${labelText} in ${formatMonthLabel(currentMonth)} löschen? Tankbons bleiben erhalten.`)) {
          reopenTankMonthAfterEdit(currentMonth);
          deleteTankMonthlyEntry(personKey, currentMonth);
          syncTankgeldExpense(personKey, { silent: true });
          saveState();
          render();
        }
      });
      btnRow.appendChild(delBtn);
    }
    tracking.appendChild(btnRow);

    const kmSuggestion = getTankKmPlanSuggestion(personKey, currentMonth);
    const cfg = getTankCalcData(personKey);
    if (kmSuggestion && Math.abs(Number(cfg.kmPerMonth || 0) - kmSuggestion.km) >= 10) {
      const suggestion = createUiEl('div', 'notice info tank-km-suggestion');
      const copy = createUiEl('span');
      copy.appendChild(createUiEl('strong', '', `Realistische Planung: etwa ${kmSuggestion.km.toFixed(0)} km pro Monat`));
      copy.appendChild(createUiEl('small', 'muted', `Automatisch aus den letzten ${kmSuggestion.count} bestätigten Monaten berechnet. Deine bisherige Planung bleibt unverändert, bis du zustimmst.`));
      const applySuggestion = document.createElement('button');
      applySuggestion.type = 'button';
      applySuggestion.className = 'secondary compact';
      applySuggestion.textContent = 'Als Planung übernehmen';
      applySuggestion.addEventListener('click', () => {
        cfg.kmPerMonth = kmSuggestion.km;
        syncTankgeldExpense(personKey, { silent: true });
        addChangeLog('Tankgeld', `${labelText}: Kilometerplanung auf ${kmSuggestion.km.toFixed(0)} km angepasst.`, currentMonth);
        saveState();
        render();
      });
      suggestion.appendChild(copy);
      suggestion.appendChild(applySuggestion);
      tracking.appendChild(suggestion);
    }

    const combinedMonths = getTankRealMonthlyRecords(personKey, currentMonth)
      .filter((entry) => entry.month >= TANK_REAL_DATA_START_MONTH);
    if (combinedMonths.length) {
      const details = document.createElement('details');
      details.className = 'compact-details';
      const summary = document.createElement('summary');
      summary.textContent = `Monatsauswertung anzeigen (${combinedMonths.length})`;
      details.appendChild(summary);
      const table = document.createElement('table');
      table.className = 'list-table compact-table';
      table.innerHTML = '<thead><tr><th>Monat</th><th>Status</th><th>Gefahren</th><th>Anteil der km</th></tr></thead>';
      const tbody = document.createElement('tbody');
      combinedMonths.slice(0, 12).forEach((entry) => {
        const tr = document.createElement('tr');
        const monthTotal = getTankHouseholdMonthlyRecord(entry.month);
        const kmShare = monthTotal.km > 0 ? (entry.km / monthTotal.km) * 100 : 0;
        tr.innerHTML = `<td>${formatMonthLabel(entry.month)}</td><td>${isTankMonthClosed(entry.month) ? '<span class="pill success">bestätigt</span>' : '<span class="pill warning">offen</span>'}</td><td>${entry.km.toFixed(0)} km</td><td>${monthTotal.km > 0 ? `${kmShare.toFixed(1)} %` : '-'}</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      details.appendChild(table);
      tracking.appendChild(details);
    }

    sub.appendChild(tracking);
  }

  function renderTankReceiptTracking(card) {
    const receipts = getTankReceipts();
    const currentReceipts = receipts.filter((receipt) => receipt.month === currentMonth);
    const box = document.createElement('div');
    box.className = 'card';
    box.appendChild(createUiEl('h3', '', 'Tankbons und Kanister ab Juni erfassen'));
    box.appendChild(createUiEl('p', 'small muted', 'Trage jeden Kauf mit Litern und Betrag ein. Er zählt als tatsächliche Ausgabe des gemeinsamen Kraftstoffvorrats, auch wenn der Sprit erst später aus einem Kanister genutzt wird. Smart und Seat werden nicht über den Bon, sondern über ihre gefahrenen Kilometer aufgeteilt.'));

    const form = document.createElement('div');
    form.className = 'row tank-receipt-form';
    const fields = [
      ['month', 'Monat', 'month', currentMonth],
      ['date', 'Datum', 'date', currentMonth + '-01'],
      ['liters', 'Liter gesamt', 'text', ''],
      ['paid', 'Bezahlt €', 'text', ''],
      ['cashback', 'Cashback/Coupon €', 'text', '']
    ];
    const inputs = {};
    fields.forEach(([key, label, type, value]) => {
      const wrap = document.createElement('div');
      const lab = document.createElement('label');
      lab.textContent = label;
      const input = document.createElement('input');
      input.type = type;
      if (['liters', 'paid', 'cashback'].includes(key)) input.inputMode = 'decimal';
      input.value = value;
      inputs[key] = input;
      wrap.appendChild(lab);
      wrap.appendChild(input);
      form.appendChild(wrap);
    });
    const canWrap = document.createElement('label');
    canWrap.className = 'checkbox-row';
    const canInput = document.createElement('input');
    canInput.type = 'checkbox';
    inputs.isCanister = canInput;
    canWrap.appendChild(canInput);
    canWrap.appendChild(document.createTextNode(' Kanister / mitgebracht'));
    form.appendChild(canWrap);
    const noteWrap = document.createElement('div');
    const noteLab = document.createElement('label');
    noteLab.textContent = 'Notiz';
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = 'z. B. Berlin, Coupon, Aral oder Vorratskanister';
    inputs.note = noteInput;
    noteWrap.appendChild(noteLab);
    noteWrap.appendChild(noteInput);
    form.appendChild(noteWrap);
    box.appendChild(form);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'success';
    saveBtn.textContent = 'Tankbon speichern';
    saveBtn.addEventListener('click', () => {
      const liters = parseMoneyInput(inputs.liters.value || 0);
      const paid = parseMoneyInput(inputs.paid.value || 0);
      const cashback = parseMoneyInput(inputs.cashback.value || 0);
      if (!isMonthKey(inputs.month.value) || inputs.month.value < TANK_REAL_DATA_START_MONTH) return alert('Echte Tankdaten werden ab Juni 2026 erfasst.');
      if (!(liters > 0) || !(paid > 0)) return alert('Bitte Liter und bezahlten Betrag eintragen.');
      reopenTankMonthAfterEdit(inputs.month.value);
      const receipt = upsertTankReceipt({
        month: inputs.month.value,
        date: inputs.date.value,
        liters,
        paid,
        cashback,
        isCanister: inputs.isCanister.checked,
        allocations: {},
        note: inputs.note.value
      });
      syncAllTankgeldExpenses({ silent: true });
      addChangeLog('Tankgeld', `Tankbon ${formatMonthLabel(receipt.month)} gespeichert · ${receipt.liters.toFixed(2)} l · netto ${euro(receipt.netCost)}`, receipt.month);
      saveState();
      render();
    });
    box.appendChild(saveBtn);

    if (currentReceipts.length) {
      const details = document.createElement('details');
      details.className = 'compact-details';
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = `Tankbons ${formatMonthLabel(currentMonth)} (${currentReceipts.length})`;
      details.appendChild(summary);
      const table = document.createElement('table');
      table.className = 'list-table compact-table';
      table.innerHTML = '<thead><tr><th>Datum</th><th>Liter</th><th>bezahlt</th><th>gespart</th><th>€/l netto</th><th>Art / Hinweis</th><th></th></tr></thead>';
      const tbody = document.createElement('tbody');
      currentReceipts.forEach((receipt) => {
        const tr = document.createElement('tr');
        const netPerLiter = receipt.liters > 0 ? receipt.netCost / receipt.liters : 0;
        const note = `${receipt.isCanister ? 'Kanister' : 'Tankstelle'}${receipt.note ? ' · ' + escapeHtml(receipt.note) : ''}`;
        tr.innerHTML = `<td>${receipt.date || '-'}</td><td>${receipt.liters.toFixed(2)} l</td><td>${euro(receipt.paid)}</td><td>${euro(receipt.cashback)}</td><td>${netPerLiter.toFixed(3)} €/l</td><td>${note}</td>`;
        const td = document.createElement('td');
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'danger compact-action';
        del.textContent = 'löschen';
        del.addEventListener('click', () => {
          if (confirm('Tankbon löschen?')) {
            reopenTankMonthAfterEdit(receipt.month);
            deleteTankReceipt(receipt.id);
            syncAllTankgeldExpenses({ silent: true });
            saveState();
            render();
          }
        });
        td.appendChild(del);
        tr.appendChild(td);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      details.appendChild(table);
      box.appendChild(details);
    }
    card.appendChild(box);
  }

  function renderTankMonthCompletion(card) {
    const box = document.createElement('div');
    box.className = 'card';
    box.appendChild(createUiEl('h3', '', 'Tankmonat abschließen'));
    if (currentMonth < TANK_REAL_DATA_START_MONTH) {
      box.appendChild(createUiEl('p', 'small muted', 'Die echte Monatsauswertung beginnt im Juni 2026. Bis dahin bleibt eure derzeit eingestellte Prognose die Grundlage.'));
      card.appendChild(box);
      return;
    }

    const smartEntry = getTankEntryForMonth('benny', currentMonth);
    const seatEntry = getTankEntryForMonth('madeleine', currentMonth);
    const smart = getTankMonthlyRecord('benny', currentMonth);
    const seat = getTankMonthlyRecord('madeleine', currentMonth);
    const total = getTankHouseholdMonthlyRecord(currentMonth);
    const closed = isTankMonthClosed(currentMonth);
    const smartShare = total.km > 0 ? (smart.km / total.km) * 100 : 0;
    const seatShare = total.km > 0 ? (seat.km / total.km) * 100 : 0;

    box.appendChild(createUiEl('p', 'small muted', 'Wenn Kilometerstände und Tankbons für den Monat vollständig sind, bestätigst du den Monat hier. Danach fließen die tatsächlichen Kosten des Kraftstoffvorrats in die nächsten 12 Monate ein; Smart und Seat werden anhand ihrer gefahrenen Kilometer aufgeteilt.'));
    box.appendChild(createSummaryMetrics([
      { label: 'Smart gefahren', value: `${smart.km.toFixed(0)} km`, hint: total.km > 0 ? `${smartShare.toFixed(1)} % der Kilometer` : 'noch keine Kilometer' },
      { label: 'Seat gefahren', value: `${seat.km.toFixed(0)} km`, hint: total.km > 0 ? `${seatShare.toFixed(1)} % der Kilometer` : 'noch keine Kilometer' },
      { label: 'Kraftstoff gekauft', value: `${total.liters.toFixed(2)} l` },
      { label: 'Ausgegeben netto', value: euro(total.netCost), kind: total.netCost > 0 ? 'success' : 'warning' },
      { label: 'Status', value: closed ? '<span class="pill success">Bestätigt</span>' : '<span class="pill warning">Noch offen</span>' }
    ]));

    const actions = document.createElement('div');
    actions.className = 'row';
    if (!closed) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'success';
      closeBtn.textContent = 'Monat bestätigen & Folgeplanung berechnen';
      closeBtn.addEventListener('click', () => {
        if (!smartEntry || !seatEntry) return alert('Bitte zuerst für Smart und Seat die Kilometerstände dieses Monats speichern. Bei einem nicht gefahrenen Auto können Start- und Endstand gleich sein.');
        if (!(total.liters > 0) || !(total.netCost > 0)) return alert('Bitte zuerst mindestens einen vollständigen Tankbon mit Litern und Betrag speichern.');
        setTankMonthClosed(currentMonth, true);
        const nextPlanMonth = nextMonth(currentMonth);
        syncAllTankgeldExpenses({ silent: true, monthKey: nextPlanMonth });
        const nextStats = getTankHouseholdAverageStats(nextPlanMonth, 12);
        addChangeLog('Tankgeld', `${formatMonthLabel(currentMonth)} bestätigt; ab ${formatMonthLabel(nextPlanMonth)} fließen ${euro(total.netCost)} echte Tankausgaben in die Planung ein.`, currentMonth);
        saveState();
        render();
        alert(`Tankmonat bestätigt. Für ${formatMonthLabel(nextPlanMonth)} rechnet die App nun mit ${nextStats.realCount} echtem Monat/Monaten und ${nextStats.projectedCount} Prognosemonat/-monaten.`);
      });
      actions.appendChild(closeBtn);
    } else {
      const reopenBtn = document.createElement('button');
      reopenBtn.type = 'button';
      reopenBtn.className = 'secondary';
      reopenBtn.textContent = 'Monat zur Bearbeitung wieder öffnen';
      reopenBtn.addEventListener('click', () => {
        setTankMonthClosed(currentMonth, false);
        syncAllTankgeldExpenses({ silent: true, monthKey: nextMonth(currentMonth) });
        addChangeLog('Tankgeld', `${formatMonthLabel(currentMonth)} zur Bearbeitung wieder geöffnet.`, currentMonth);
        saveState();
        render();
      });
      actions.appendChild(reopenBtn);
    }
    box.appendChild(actions);
    card.appendChild(box);
  }


  function syncGroceryTopUpExpense(monthKey = currentMonth) {
    const allocation = getGroceryTopUpAllocation(monthKey);
    if (!allocation.active) return false;
    let changed = false;
    getFoodMoneyPosts().forEach((post) => {
      ensurePostConfig(post);
      const amount = Number(allocation.allocations && allocation.allocations[post.id] || 0);
      const targetMonth = isPostPaidForMonth(post, monthKey) ? nextMonth(monthKey) : monthKey;
      setPostAmountForMonth(post, targetMonth, amount, 'future');
      changed = true;
    });
    if (changed) addChangeLog('Einkaufsgeld', `Aufstockung ${formatMonthLabel(monthKey)} auf ${euro(allocation.topUp)} gesetzt.`, monthKey);
    return changed;
  }

  function syncFuelTopUpExpenses(monthKey = currentMonth) {
    const allocation = getFuelTopUpAllocation(monthKey);
    if (!allocation.active) return false;
    let changed = false;
    ['benny','madeleine'].forEach((personKey) => {
      const amount = Number(allocation.allocations && allocation.allocations[personKey] || 0);
      const post = getTankExpensePost(personKey);
      if (post) {
        ensurePostConfig(post);
        const targetMonth = isPostPaidForMonth(post, monthKey) ? nextMonth(monthKey) : monthKey;
        setPostAmountForMonth(post, targetMonth, amount, 'future');
        changed = true;
      } else {
        syncTankgeldExpense(personKey, { silent: true });
        changed = true;
      }
    });
    if (changed) addChangeLog('Tankgeld', `Aufstockung ${formatMonthLabel(monthKey)} auf ${euro(allocation.topUp)} gesetzt.`, monthKey);
    return changed;
  }

  function showGroceryExpenseEditor(expense = null) {
    const isNew = !expense;
    const item = expense || {
      id: generateId(),
      month: currentMonth,
      date: `${currentMonth}-01`,
      name: '',
      amount: 0,
      note: ''
    };
    const content = document.createElement('div');
    content.className = 'modal-form';

    const row = document.createElement('div');
    row.className = 'row';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = item.date || `${item.month || currentMonth}-01`;
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = item.name || '';
    nameInput.placeholder = 'z. B. Wocheneinkauf oder Drogerie';
    const amountInput = document.createElement('input');
    amountInput.type = 'text';
    amountInput.inputMode = 'decimal';
    amountInput.value = item.amount ? formatNumberInput(item.amount) : '';
    amountInput.placeholder = 'z. B. 68,42';
    row.appendChild(createLabelInput('Datum', dateInput));
    row.appendChild(createLabelInput('Einkauf', nameInput));
    row.appendChild(createLabelInput('Betrag', amountInput));
    content.appendChild(row);

    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.value = item.note || '';
    noteInput.placeholder = 'optional: Markt oder Hinweis';
    content.appendChild(createLabelInput('Notiz', noteInput));

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = 'Der Einkauf wird für die Monatsauswertung gespeichert. Er erzeugt keine zusätzliche Kontobuchung.';
    content.appendChild(hint);

    showModal(isNew ? 'Einkauf erfassen' : 'Einkauf bearbeiten', content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      {
        label: 'Speichern',
        className: 'primary',
        onClick: (close) => {
          const amount = parseMoneyInput(amountInput.value);
          if (!dateInput.value) return alert('Bitte ein Datum eintragen.');
          if (!Number.isFinite(amount) || !(amount > 0)) return alert('Bitte einen Betrag größer als 0 eintragen.');
          const saved = upsertGroceryExpense({
            id: item.id,
            month: getMonthKeyFromDateValue(dateInput.value, currentMonth),
            date: dateInput.value,
            name: nameInput.value.trim() || 'Einkauf',
            amount,
            note: noteInput.value.trim()
          });
          if (!saved) return alert('Der Einkauf konnte nicht gespeichert werden.');
          addChangeLog('Einkaufsgeld', `${isNew ? 'Einkauf erfasst' : 'Einkauf geändert'}: ${saved.name} · ${euro(saved.amount)}.`, saved.month);
          saveState();
          close();
          render();
        }
      }
    ]);
  }

  function renderGroceryTopUpCard(parent) {
    normalizeBudgetTopUpsConfig();
    const card = document.createElement('div');
    card.className = 'card';
    card.appendChild(createUiEl('h3', '', 'Einkaufsgeld auffüllen'));
    card.appendChild(createUiEl('p', 'small muted', 'Im Juni 2026 beginnt das Einkaufsgeld mit 550 €. Ab Juli trägst du den Rest des Vormonats ein. Das Ziel wird aus bis zu 12 bereits vollständig erfassten Monaten berechnet und auf die nächsten 50 € aufgerundet. Die Überweisung markierst du beim persönlichen Posten „Einkaufsgeld“ einfach als bezahlt.'));

    const calc = getGroceryTopUpAllocation(currentMonth);
    const stats = getGroceryAverageStats(currentMonth, 12);
    const config = getBudgetTopUpConfig('groceries');
    const basisText = stats.count
      ? `${stats.count} Monat(e) · Ø ${euro(stats.average)}`
      : 'Startziel 550 €';
    card.appendChild(createSummaryMetrics([
      { label: 'Monatsziel', value: euro(calc.target), kind: calc.target > 0 ? 'success' : 'warning' },
      { label: 'Berechnungsbasis', value: basisText },
      { label: 'Rest vom Vormonat', value: calc.active ? euro(calc.balance) : 'ab Juli 2026' },
      { label: 'Aufstocken', value: calc.active ? euro(calc.topUp) : (currentMonth === config.targetStartMonth ? euro(calc.target) : 'ab Juli 2026'), kind: calc.active || currentMonth === config.targetStartMonth ? 'success' : 'warning' }
    ]));

    const info = document.createElement('div');
    info.className = 'info-box';
    if (calc.active) {
      info.innerHTML = `<strong>Berechnung:</strong> ${euro(calc.target)} Monatsziel − ${euro(calc.balance)} Rest = ${euro(calc.missing)} Bedarf; auf die nächsten 50 € aufgerundet werden <strong>${euro(calc.topUp)}</strong> aufgefüllt.`;
    } else if (currentMonth === config.targetStartMonth) {
      info.innerHTML = '<strong>Startmonat:</strong> Für Juni 2026 gilt das Startziel von <strong>550,00 €</strong>. Den verbleibenden Rest trägst du ab Juli ein.';
    } else if (stats.count) {
      info.innerHTML = `<strong>Vorschau:</strong> Der bisherige Ausgabendurchschnitt beträgt ${euro(stats.average)}; das auf volle 50 € gerundete Ziel wäre <strong>${euro(stats.roundedAverage)}</strong>. Die Aufstockung beginnt ab Juli 2026.`;
    } else {
      info.innerHTML = '<strong>Noch nicht aktiv:</strong> Das Startziel von 550,00 € gilt ab Juni 2026; eine Rest-Aufstockung ist ab Juli möglich.';
    }
    card.appendChild(info);

    if (calc.active) {
      const row = document.createElement('div');
      row.className = 'row';
      const restInput = document.createElement('input');
      restInput.type = 'text';
      restInput.inputMode = 'decimal';
      restInput.placeholder = 'z. B. 43,20';
      restInput.value = calc.balance ? formatNumberInput(calc.balance) : '';
      const noteInput = document.createElement('input');
      noteInput.type = 'text';
      noteInput.value = config.notes[currentMonth] || '';
      noteInput.placeholder = 'z. B. Rest aus dem Vormonat';
      row.appendChild(createLabelInput('Rest Einkaufsgeld', restInput));
      row.appendChild(createLabelInput('Notiz', noteInput));
      card.appendChild(row);

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'success';
      saveBtn.textContent = 'Rest speichern & Aufstockung übernehmen';
      saveBtn.addEventListener('click', () => {
        const rest = parseMoneyInput(restInput.value || 0);
        if (!Number.isFinite(rest) || rest < 0) return alert('Bitte einen gültigen Restbetrag eingeben.');
        setBudgetTopUpBalance('groceries', currentMonth, rest, noteInput.value);
        const savedCalc = getGroceryTopUpAllocation(currentMonth);
        syncGroceryTopUpExpense(currentMonth);
        addChangeLog('Einkaufsgeld', `Rest ${euro(rest)} gespeichert; Aufstockung ${euro(savedCalc.topUp)} übernommen.`, currentMonth);
        saveState();
        render();
      });
      card.appendChild(saveBtn);
    }
    parent.appendChild(card);
  }

  function renderGroceries() {
    if (!grocerySection) return;
    grocerySection.innerHTML = '';
    const expenses = getGroceryExpenses();
    const currentExpenses = expenses.filter((expense) => expense.month === currentMonth);
    const spent = currentExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const calc = getGroceryTopUpAllocation(currentMonth);
    const difference = calc.target - spent;

    const card = document.createElement('div');
    card.className = 'card';
    const header = document.createElement('div');
    header.className = 'row';
    const title = document.createElement('h2');
    title.textContent = 'Einkaufsgeld';
    title.style.flex = '1 1 auto';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'primary';
    addBtn.textContent = '+ Einkauf';
    addBtn.addEventListener('click', () => showGroceryExpenseEditor());
    header.appendChild(title);
    header.appendChild(addBtn);
    card.appendChild(header);
    card.appendChild(createUiEl('p', 'small muted', 'Hier erfasst ihr eure tatsächlichen Einkäufe. Daraus berechnet die App für künftige Monate ein Einkaufsgeld aus den letzten bis zu 12 abgeschlossenen erfassten Monaten und rundet es auf volle 50 € auf.'));
    card.appendChild(createSummaryMetrics([
      { label: `Ziel ${formatMonthLabel(currentMonth)}`, value: euro(calc.target), kind: calc.target > 0 ? 'success' : 'warning' },
      { label: 'Ausgegeben', value: euro(spent), kind: spent > calc.target && calc.target > 0 ? 'danger' : '' },
      { label: difference >= 0 ? 'Noch im Ziel' : 'Über Ziel', value: euro(Math.abs(difference)), kind: difference < 0 ? 'danger' : 'success' },
      { label: 'Erfasste Einkäufe', value: String(currentExpenses.length) }
    ]));

    if (!currentExpenses.length) {
      card.appendChild(createUiEl('p', 'small muted', `Für ${formatMonthLabel(currentMonth)} sind noch keine Einkäufe erfasst. Frühere Monate kannst du ebenfalls auswählen und nachtragen, damit die Berechnung schneller eine 12-Monats-Basis erhält.`));
    } else {
      const table = document.createElement('table');
      table.className = 'list-table';
      table.innerHTML = '<thead><tr><th>Datum</th><th>Einkauf</th><th>Betrag</th><th>Notiz</th><th>Aktion</th></tr></thead>';
      const tbody = document.createElement('tbody');
      currentExpenses.forEach((expense) => {
        const tr = document.createElement('tr');
        const dateTd = document.createElement('td');
        dateTd.textContent = expense.date || '-';
        const nameTd = document.createElement('td');
        nameTd.textContent = expense.name;
        const amountTd = document.createElement('td');
        amountTd.textContent = euro(expense.amount);
        const noteTd = document.createElement('td');
        noteTd.textContent = expense.note || '-';
        const actionTd = document.createElement('td');
        actionTd.appendChild(createActionMenu([
          { label: 'Bearbeiten', className: 'primary', onClick: () => showGroceryExpenseEditor(expense) },
          { label: 'Löschen', className: 'danger', onClick: () => {
            if (confirm(`"${expense.name}" löschen?`)) {
              deleteGroceryExpense(expense.id);
              addChangeLog('Einkaufsgeld', `Einkauf gelöscht: ${expense.name} · ${euro(expense.amount)}.`, expense.month);
              saveState();
              render();
            }
          } }
        ]));
        tr.appendChild(dateTd);
        tr.appendChild(nameTd);
        tr.appendChild(amountTd);
        tr.appendChild(noteTd);
        tr.appendChild(actionTd);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      card.appendChild(table);
    }
    grocerySection.appendChild(card);

    renderGroceryTopUpCard(grocerySection);

    const totals = getGroceryMonthlyTotals().slice(0, 12);
    const history = document.createElement('div');
    history.className = 'card';
    history.appendChild(createUiEl('h3', '', 'Monatsverlauf'));
    history.appendChild(createUiEl('p', 'small muted', 'Das Ziel eines Monats nutzt nur die davor abgeschlossenen, erfassten Monate. So verändert ein noch laufender Einkaufsmonat das aktuelle Budget nicht rückwirkend.'));
    if (!totals.length) {
      history.appendChild(createUiEl('p', 'small muted', 'Noch kein Einkaufsverlauf vorhanden.'));
    } else {
      const table = document.createElement('table');
      table.className = 'list-table';
      table.innerHTML = '<thead><tr><th>Monat</th><th>Einkäufe</th><th>Ausgegeben</th><th>Ziel in diesem Monat</th><th>Abweichung</th></tr></thead>';
      const tbody = document.createElement('tbody');
      totals.forEach((row) => {
        const target = getFoodMoneyPlannedTarget(row.month);
        const delta = target - row.amount;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${formatMonthLabel(row.month)}</td><td>${row.count}</td><td>${euro(row.amount)}</td><td>${euro(target)}</td><td>${delta >= 0 ? euro(delta) + ' übrig' : euro(Math.abs(delta)) + ' darüber'}</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      history.appendChild(table);
    }
    grocerySection.appendChild(history);
  }

  function renderFuelTopUpCard(parent) {
    normalizeBudgetTopUpsConfig();
    const card = document.createElement('div');
    card.className = 'card';
    card.appendChild(createUiEl('h3', '', 'Tankgeld auffüllen'));
    card.appendChild(createUiEl('p', 'small muted', 'Start ab Juli 2026: Du trägst den Rest aus dem Vormonat ein. Die App füllt bis zum berechneten Kraftstoffziel auf und rundet die Aufstockung auf die nächsten 5 € auf.'));

    const calc = getFuelTopUpAllocation(currentMonth);
    card.appendChild(createSummaryMetrics([
      { label: 'Kraftstoff Ziel', value: euro(calc.target), kind: calc.target > 0 ? 'success' : 'warning' },
      { label: 'Rest Tankgeld', value: calc.active ? euro(calc.balance) : 'ab Juli 2026' },
      { label: 'Aufstocken', value: calc.active ? euro(calc.topUp) : 'ab Juli 2026', kind: calc.active ? 'success' : 'warning' }
    ]));

    const info = document.createElement('div');
    info.className = 'info-box';
    if (calc.active) {
      info.innerHTML = `<strong>Berechnung:</strong> ${euro(calc.target)} geplant − ${euro(calc.balance)} Rest = ${euro(calc.missing)} Bedarf; aufgerundet <strong>${euro(calc.topUp)}</strong>.`;
    } else {
      info.innerHTML = '<strong>Noch nicht aktiv:</strong> Die Rest-Aufstockung beginnt ab Juli 2026.';
    }
    card.appendChild(info);

    if (calc.active) {
      const row = document.createElement('div');
      row.className = 'row';
      const restInput = document.createElement('input');
      restInput.type = 'text';
      restInput.inputMode = 'decimal';
      restInput.placeholder = 'z. B. 58,93';
      restInput.value = calc.balance ? formatNumberInput(calc.balance) : '';
      const noteInput = document.createElement('input');
      noteInput.type = 'text';
      noteInput.value = getBudgetTopUpConfig('fuel').notes[currentMonth] || '';
      noteInput.placeholder = 'z. B. Rest aus dem Vormonat';
      row.appendChild(createLabelInput('Rest Tankgeld', restInput));
      row.appendChild(createLabelInput('Notiz', noteInput));
      card.appendChild(row);

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'success';
      saveBtn.textContent = 'Rest speichern & Aufstockung übernehmen';
      saveBtn.addEventListener('click', () => {
        const rest = parseMoneyInput(restInput.value || 0);
        if (!Number.isFinite(rest) || rest < 0) return alert('Bitte einen gültigen Restbetrag eingeben.');
        setBudgetTopUpBalance('fuel', currentMonth, rest, noteInput.value);
        const savedCalc = getFuelTopUpAllocation(currentMonth);
        syncFuelTopUpExpenses(currentMonth);
        addChangeLog('Tankgeld', `Rest ${euro(rest)} gespeichert; Aufstockung ${euro(savedCalc.topUp)} übernommen.`, currentMonth);
        saveState();
        render();
      });
      card.appendChild(saveBtn);
    }
    parent.appendChild(card);
  }


  function renderTankCalc() {
    tankCalcSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('h2');
    title.textContent = 'Tankgeld';
    card.appendChild(title);

    const note = document.createElement('p');
    note.textContent = 'Das Tankgeld ist automatisch mit den persönlichen Ausgaben verknüpft. Änderungen aktualisieren den Tankgeld-Posten direkt. Ist der aktuelle Monat bereits bezahlt, bleibt dieser Betrag fest und die Änderung gilt erst ab dem Folgemonat.';
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
    keyHint.textContent = 'Der API-Key wird automatisch bereinigt: Leerzeichen, unsichtbare Zeichen, Anführungszeichen oder ein mitkopierter Link werden entfernt. Backups enthalten den API-Key, damit das Tankgeld nach Import weiter funktioniert.';
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

    const locWrap = document.createElement('div');
    const locLabel = document.createElement('label');
    locLabel.textContent = 'Standort für Preisabruf';
    const locInput = document.createElement('input');
    locInput.type = 'text';
    locInput.placeholder = 'z. B. Nauen oder Straße, Ort';
    locInput.value = state.tankCalc.locationQuery || '';
    locInput.addEventListener('change', () => {
      state.tankCalc.locationQuery = locInput.value.trim();
      saveState();
    });
    const locButtons = document.createElement('div');
    locButtons.className = 'row';
    const findLocBtn = document.createElement('button');
    findLocBtn.type = 'button';
    findLocBtn.className = 'secondary';
    findLocBtn.textContent = 'Standort suchen';
    findLocBtn.addEventListener('click', async () => {
      try {
        await resolveTankLocationQuery(locInput.value);
        alert('Standort gespeichert: ' + (state.tankCalc.locationName || state.tankCalc.locationQuery));
        render();
      } catch (err) {
        alert(err && err.message ? err.message : 'Standort konnte nicht gespeichert werden.');
      }
    });
    const deviceLocBtn = document.createElement('button');
    deviceLocBtn.type = 'button';
    deviceLocBtn.className = 'secondary';
    deviceLocBtn.textContent = 'Gerätestandort nutzen';
    deviceLocBtn.addEventListener('click', async () => {
      try {
        await useDeviceLocationForTankApi();
        alert('Gerätestandort gespeichert.');
        render();
      } catch (err) {
        alert(err && err.message ? err.message : 'Gerätestandort konnte nicht geladen werden.');
      }
    });
    const clearLocBtn = document.createElement('button');
    clearLocBtn.type = 'button';
    clearLocBtn.className = 'danger';
    clearLocBtn.textContent = 'Standort löschen';
    clearLocBtn.addEventListener('click', () => {
      state.tankCalc.locationQuery = '';
      state.tankCalc.locationLat = '';
      state.tankCalc.locationLng = '';
      state.tankCalc.locationName = '';
      saveState();
      render();
    });
    locButtons.appendChild(findLocBtn);
    locButtons.appendChild(deviceLocBtn);
    locButtons.appendChild(clearLocBtn);
    const locHint = document.createElement('div');
    locHint.className = 'small muted';
    locHint.textContent = state.tankCalc.locationName ? ('Aktiver Standort: ' + state.tankCalc.locationName) : 'Ohne gespeicherten Standort fragt die App den Gerätestandort ab.';
    locWrap.appendChild(locLabel);
    locWrap.appendChild(locInput);
    locWrap.appendChild(locButtons);
    locWrap.appendChild(locHint);

    settingsRow.appendChild(keyWrap);
    settingsRow.appendChild(radWrap);
    settingsRow.appendChild(locWrap);
    card.appendChild(settingsRow);

    const apiStatus = getTankApiStatusInfo();
    const apiStatusBox = document.createElement('div');
    apiStatusBox.className = 'info-box';
    const keyFormatLabel = state.tankCalc.apiKey ? (isTankApiKeyFormatValid(state.tankCalc.apiKey) ? 'Format OK' : 'Format prüfen') : 'kein Key';
    const tankLocationLabel = state.tankCalc.locationName || (state.tankCalc.locationQuery ? state.tankCalc.locationQuery : 'Gerätestandort');
    apiStatusBox.innerHTML = `<strong>Tankerkönig-Status:</strong> ${state.tankCalc.apiKey ? 'API-Key vorhanden' : 'API-Key fehlt'} · ${keyFormatLabel} · Standort: ${tankLocationLabel} · Letzter Abruf: ${apiStatus.lastRequestLabel}<br><span class="muted">${apiStatus.lastStatus ? apiStatus.lastStatus + ': ' : ''}${apiStatus.lastError || 'Noch keine Diagnose durchgeführt.'}</span>`;
    card.appendChild(apiStatusBox);

    const householdTankInfo = document.createElement('div');
    householdTankInfo.className = 'info-box';
    householdTankInfo.innerHTML = '<strong>Planung ab Juni 2026:</strong> Bestätigte Tankbons und Kanisterkäufe bestimmen nach und nach die echte Höhe des gemeinsamen Kraftstofftopfs. Weil Vorratskanister keinem Auto eindeutig gehören, werden Smart und Seat anhand der gefahrenen Kilometer aufgeteilt. Bis 12 echte Monate vorliegen, ergänzt die bisherige Prognose die fehlenden Monate.';
    card.appendChild(householdTankInfo);

    const householdTankStats = getTankHouseholdAverageStats(currentMonth, 12);
    const bennyBudget = calculateTankBudget(getTankCalcData('benny'), 'benny').rounded;
    const madeleineBudget = calculateTankBudget(getTankCalcData('madeleine'), 'madeleine').rounded;
    const bennyShare = getTankForecastShare('benny', currentMonth);
    const madeleineShare = getTankForecastShare('madeleine', currentMonth);
    card.appendChild(createSummaryMetrics([
      { label: 'Monatsbudget gesamt', value: `${euro(householdTankStats.roundedBudget)}`, kind: householdTankStats.roundedBudget > 0 ? 'success' : 'warning' },
      { label: 'Basis', value: householdTankStats.projectedCount > 0 ? `${householdTankStats.realCount} echt + ${householdTankStats.projectedCount} Prognose` : '12 echte Monate' },
      { label: 'Smart-Anteil', value: `${euro(bennyBudget)}`, hint: `${(bennyShare * 100).toFixed(1)} % der Kilometerbasis` },
      { label: 'Seat-Anteil', value: `${euro(madeleineBudget)}`, hint: `${(madeleineShare * 100).toFixed(1)} % der Kilometerbasis` },
      { label: 'API-Key', value: state.tankCalc.apiKey ? 'Gespeichert' : 'Fehlt', kind: state.tankCalc.apiKey ? 'success' : 'warning' }
    ]));

    renderFuelTopUpCard(card);

    const tankSyncInfo = document.createElement('div');
    tankSyncInfo.className = 'info-box';
    tankSyncInfo.innerHTML = '<strong>Automatische Verknüpfung:</strong> Tankgeld wird mit den persönlichen Ausgaben synchronisiert. Bezahlte Monatsbeträge bleiben fest; Änderungen laufen dann ab dem Folgemonat.';
    const syncAllBtn = document.createElement('button');
    syncAllBtn.type = 'button';
    syncAllBtn.className = 'success';
    syncAllBtn.textContent = 'Tankgeld jetzt synchronisieren';
    syncAllBtn.addEventListener('click', () => { syncAllTankgeldExpenses({ silent: false }); saveState(); render(); });
    tankSyncInfo.appendChild(document.createElement('br'));
    tankSyncInfo.appendChild(syncAllBtn);
    card.appendChild(tankSyncInfo);

    renderTankReceiptTracking(card);

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
        syncTankgeldExpense(personKey, { silent: true });
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
        syncTankgeldExpense(personKey, { silent: true });
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
        syncTankgeldExpense(personKey, { silent: true });
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
      avgInput.placeholder = 'z. B. 1.699';
      avgInput.value = cfg.avgPrice || '';
      avgInput.addEventListener('change', () => {
        cfg.avgPrice = avgInput.value;
        syncTankgeldExpense(personKey, { silent: true });
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

      const tankBudget = calculateTankBudget(cfg, personKey);
      sub.appendChild(createSummaryMetrics([
        { label: 'Kilometer / Monat', value: `${Number(cfg.kmPerMonth || 0).toFixed(0)} km` },
        { label: 'Berechnungsbasis', value: tankBudget.source || '—', kind: tankBudget.rounded > 0 ? 'success' : 'warning' },
        { label: 'Preis genutzt', value: tankBudget.priceUsed ? `${tankBudget.priceUsed.toFixed(3)} €/l` : (tankBudget.avgStats && tankBudget.avgStats.count ? 'echter Schnitt' : '—'), kind: tankBudget.rounded > 0 ? 'success' : 'warning' },
        { label: 'Prognose', value: `${euro(tankBudget.rounded)}`, kind: tankBudget.rounded > 0 ? 'success' : 'warning' }
      ]));

      renderTankMonthlyTracking(sub, personKey, labelText);

      const linkedTankPost = getTankExpensePost(personKey);
      const linkInfo = document.createElement('div');
      linkInfo.className = 'small muted';
      if (linkedTankPost) {
        const paidText = isPostPaidForMonth(linkedTankPost, currentMonth) ? 'bezahlt/fest' : 'offen';
        const activeAmount = getEffectiveAmountForMonth(linkedTankPost, currentMonth);
        linkInfo.textContent = `Verknüpfter Ausgabenposten: ${linkedTankPost.name} · ${euro(activeAmount)} · ${paidText}`;
      } else {
        linkInfo.textContent = 'Noch kein Tankgeld-Posten gefunden. Beim Synchronisieren wird er automatisch angelegt.';
      }
      sub.appendChild(linkInfo);

      const buttonRow = document.createElement('div');
      buttonRow.className = 'row';

      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'Preis automatisch laden';
      loadBtn.className = 'primary';
      loadBtn.addEventListener('click', async () => {
        await fetchAutomaticFuelPrice(personKey);
      });

      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Tankgeld synchronisieren';
      applyBtn.className = 'success';
      applyBtn.addEventListener('click', () => {
        upsertTankgeldAsPersonalExpense(personKey);
      });

      buttonRow.appendChild(loadBtn);
      buttonRow.appendChild(applyBtn);
      sub.appendChild(buttonRow);

      card.appendChild(sub);
    });

    renderTankMonthCompletion(card);
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
      paid += getDebtCoveredAmountForMonth(d, monthKey);
    });
    return paid;
  }

  function getDebtSpecialPaymentAmountForMonth(monthKey) {
    if (!isMonthKey(monthKey)) return 0;
    return roundMoney((state.debts || []).reduce((sum, debt) => {
      ensureDebtConfig(debt);
      return sum + (debt.paymentHistory || [])
        .filter((entry) => entry.month === monthKey)
        .filter((entry) => /sonderzahlung|\bextra\b/i.test(String(entry.source || '')))
        .reduce((entrySum, entry) => entrySum + Number(entry.amount || 0), 0);
    }, 0));
  }

  function getDebtPaymentAccountId(debt, options = {}) {
    if (options.accountId && getAccountById(options.accountId)) return options.accountId;
    if (debt && debt.accountId && getAccountById(debt.accountId)) return debt.accountId;
    const linked = debt ? getLinkedPostsForDebt(debt) : [];
    for (const item of linked) {
      const post = item && item.post;
      if (!post) continue;
      ensurePostConfig(post);
      const accountId = inferAccountIdForPost(post);
      if (accountId && getAccountById(accountId)) return accountId;
    }
    const benny = getPersonById('benny');
    const bennyAccount = benny ? getPersonIncomeAccountId(benny) : '';
    if (bennyAccount && getAccountById(bennyAccount)) return bennyAccount;
    const fallback = getDefaultAccountIdForContext('personal', 'benny');
    if (fallback && getAccountById(fallback)) return fallback;
    const checking = (state.accounts || []).find((account) => normalizeAccountType(account.type) === 'checking');
    return checking ? checking.id : '';
  }

  function addDebtPayment(debt, options = {}) {
    ensureDebtConfig(debt);
    const month = isMonthKey(options.month) ? options.month : (isMonthKey(debt.nextDueMonth) ? debt.nextDueMonth : currentMonth);
    const amountRaw = Number(options.amount);
    const amount = Number.isFinite(amountRaw) ? Math.max(0, amountRaw) : Number(getDebtRateForMonth(debt, month || currentMonth) || 0);
    if (!(amount > 0)) return false;
    const markAsMonthly = options.markAsMonthly === true;
    const previousNextDueMonth = debt.nextDueMonth || '';
    const alreadyMarkedMonthly = debt.paidMonths.includes(month);
    const alreadyHasMonthlyHistory = debt.paymentHistory.some((entry) => entry.month === month && entry.markedAsMonthly);
    if (markAsMonthly && (alreadyHasMonthlyHistory || (alreadyMarkedMonthly && options.allowExistingMonthlyStatus !== true))) {
      return false;
    }
    const paymentAmount = options.reducedOpenBalance === false
      ? amount
      : Math.min(amount, Number(debt.amountOpen || 0));
    if (!(paymentAmount > 0)) return false;

    const historyId = generateId();
    let accountTransactionId = '';
    if (ACCOUNTS_ENABLED && options.bookAccountTransaction === true && options.skipAccountTransaction !== true) {
      const accountId = getDebtPaymentAccountId(debt, options);
      if (accountId) {
        debt.accountId = accountId;
        accountTransactionId = applyAccountLedgerTransaction(accountId, {
          month,
          type: 'debt_payment',
          sourceId: getDebtAccountTransactionSource(debt, month, historyId),
          label: `${debt.name || 'Schuld'} ${formatMonthLabel(month)}`,
          amount: -paymentAmount,
          affectsBalance: true
        }) || '';
      }
    }

    debt.paymentHistory.push({
      id: historyId,
      month,
      amount: paymentAmount,
      source: options.source || 'Manuelle Zahlung',
      sourcePostId: typeof options.sourcePostId === 'string' ? options.sourcePostId : '',
      note: options.note || '',
      createdAt: new Date().toISOString(),
      previousNextDueMonth,
      markedAsMonthly: markAsMonthly,
      accountTransactionId,
      reducedOpenBalance: options.reducedOpenBalance !== false
    });

    if (options.reducedOpenBalance !== false) {
      debt.amountOpen = Math.max(0, Number(debt.amountOpen || 0) - paymentAmount);
    }
    if (Number(debt.amountOpen || 0) <= 0) {
      debt.completedMonth = month;
    }

    if (markAsMonthly && !debt.paidMonths.includes(month)) {
      debt.paidMonths.push(month);
    }
    if (markAsMonthly) {
      advanceDebtNextDueMonthAfterPayment(debt, month);
    }
    addChangeLog('Schulden', `${debt.name || 'Schuld'}: ${euro(paymentAmount)} bezahlt`, month);
    return true;
  }

  function resetDebtPaymentForMonth(debt, monthKey, options = {}) {
    ensureDebtConfig(debt);
    const sourcePostId = typeof options.sourcePostId === 'string' ? options.sourcePostId : '';
    const sourceLabel = typeof options.sourceLabel === 'string' ? options.sourceLabel : '';
    const restrictToPost = !!(sourcePostId || sourceLabel);
    const matchesEntry = (entry) => entry.month === monthKey && (!restrictToPost
      || (sourcePostId && entry.sourcePostId === sourcePostId)
      || (!entry.sourcePostId && sourceLabel && entry.source === sourceLabel));
    const entries = debt.paymentHistory.filter(matchesEntry);
    let restoreAmount = 0;
    if (entries.length > 0) {
      entries.forEach((entry) => {
        if (entry.accountTransactionId) removeAccountLedgerTransaction(debt.accountId, entry.accountTransactionId) || removeAccountTransaction(debt.accountId, entry.accountTransactionId);
        removeAccountLedgerTransactionBySource(getDebtAccountTransactionSource(debt, monthKey, entry.id)) || removeAccountTransactionBySource(getDebtAccountTransactionSource(debt, monthKey, entry.id));
      });
      restoreAmount = entries.reduce((sum, entry) => sum + (entry.reducedOpenBalance === false ? 0 : Number(entry.amount || 0)), 0);
      debt.paymentHistory = debt.paymentHistory.filter((entry) => !matchesEntry(entry));
    } else if (!restrictToPost && debt.paidMonths.includes(monthKey)) {
      restoreAmount = Number(getDebtRateForMonth(debt, monthKey) || 0);
    }
    const removesMonthlyStatus = !restrictToPost || entries.some((entry) => entry.markedAsMonthly);
    const otherMonthlyEntryRemains = debt.paymentHistory.some((entry) => entry.month === monthKey && entry.markedAsMonthly);
    if (removesMonthlyStatus && !otherMonthlyEntryRemains) {
      debt.paidMonths = debt.paidMonths.filter((m) => m !== monthKey);
    }
    if (restoreAmount > 0) {
      debt.amountOpen = Number(debt.amountOpen || 0) + restoreAmount;
    }
    if (Number(debt.amountOpen || 0) > 0) {
      delete debt.completedMonth;
    }
    if (removesMonthlyStatus && (!debt.nextDueMonth || monthDiff(monthKey, debt.nextDueMonth) > 0)) {
      debt.nextDueMonth = monthKey;
    }
    if (restoreAmount > 0) addChangeLog('Schulden', `${debt.name || 'Schuld'}: Zahlung ${euro(restoreAmount)} zurückgesetzt`, monthKey);
    return restoreAmount > 0;
  }


  function renderDebtFreeForecastCard(plan, monthKey) {
    const card = document.createElement('div');
    card.className = 'sub-card debt-free-forecast-card';
    const h = document.createElement('h3');
    h.textContent = 'Prognose bei vorgeschlagenem Zahlungsplan';
    card.appendChild(h);

    const rows = Array.isArray(plan && plan.rows) ? plan.rows : [];
    const notPlanned = Array.isArray(plan && plan.noRate) ? plan.noRate : [];
    const scheduledOneTime = Array.isArray(plan && plan.scheduledOneTime) ? plan.scheduledOneTime : [];
    const debtFreeMonth = plan && plan.debtFreeMonth ? plan.debtFreeMonth : '';
    const firstRow = rows[0] || null;
    const monthsToDebtFree = debtFreeMonth ? Math.max(0, monthDiff(monthKey, debtFreeMonth)) + 1 : null;
    const totalOpen = (state.debts || []).reduce((sum, debt) => sum + Math.max(0, Number(debt.amountOpen || 0)), 0);

    const hero = document.createElement('div');
    hero.className = 'debt-free-forecast-hero';
    const main = document.createElement('div');
    main.className = 'debt-free-main';
    const hasUnplanned = notPlanned.length > 0;
    main.innerHTML = `<span>Annahme</span><strong>${debtFreeMonth ? formatMonthLabel(debtFreeMonth) : 'noch nicht berechenbar'}</strong><small>${debtFreeMonth ? `${hasUnplanned ? 'geplante Ratenschulden' : 'schuldenfrei'} nach ca. ${monthsToDebtFree} Monat(en), wenn alle vorgeschlagenen Zahlungen so geleistet werden` : 'Die geplanten Ratenschulden sind noch nicht fertig berechnet. Offene Pläne werden nur als Hinweis geführt.'}</small>`;
    hero.appendChild(main);

    const facts = document.createElement('div');
    facts.className = 'debt-free-facts';
    [
      ['Offen aktuell', euro(totalOpen)],
      ['Plan aktueller Monat', firstRow ? euro(firstRow.total || 0) : '0,00 €'],
      ['Fester Schulden-Pool', firstRow ? euro(firstRow.pool || firstRow.total || 0) : '0,00 €'],
      ['Standardraten im Monat', firstRow ? euro(firstRow.base || 0) : '0,00 €'],
      ['Bereits übernommene Raten', euro(Number(plan.rolloverStart || 0))],
      ['Weitergabe', 'erst ab dem Folgemonat']
    ].forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'debt-free-fact';
      item.appendChild(createUiEl('span', '', label));
      item.appendChild(createUiEl('strong', '', value));
      facts.appendChild(item);
    });
    hero.appendChild(facts);
    card.appendChild(hero);



    if (scheduledOneTime.length) {
      const info = document.createElement('div');
      info.className = 'soft-info debt-forecast-info';
      info.appendChild(createUiEl('strong', '', 'Fest eingeplante Einmalzahlungen'));
      info.appendChild(createUiEl('p', 'small muted', 'Diese Posten sind einmalig fällig und werden in ihrem Fälligkeitsmonat berücksichtigt. Sie blockieren die Prognose der geplanten Ratenschulden nicht.'));
      const list = document.createElement('ul');
      scheduledOneTime
        .sort((a, b) => String(a.scheduledMonth || '').localeCompare(String(b.scheduledMonth || '')) || String(a.name || '').localeCompare(String(b.name || '')))
        .forEach((debt) => {
          const li = document.createElement('li');
          li.textContent = `${debt.name || 'Schuld'} · ${formatMonthLabel(debt.scheduledMonth)} · ${euro(debt.open || 0)}`;
          list.appendChild(li);
        });
      info.appendChild(list);
      card.appendChild(info);
    }

    if (notPlanned.length) {
      const warning = document.createElement('div');
      warning.className = 'soft-warning debt-forecast-warning';
      warning.appendChild(createUiEl('strong', '', 'Hinweis: Noch nicht eingeplante Schuld(en)'));
      warning.appendChild(createUiEl('p', 'small muted', 'Diese Posten haben noch keinen festen Ratenplan bzw. keine Monatsrate. Sie werden als Hinweis gezeigt, blockieren aber die Schuldenfrei-Prognose der bereits geplanten Ratenschulden nicht.'));
      const list = document.createElement('ul');
      notPlanned.forEach((debt) => {
        const li = document.createElement('li');
        li.textContent = `${debt.name || 'Schuld'} · offen ${euro(debt.open || 0)} · ${debt.excludeReason || 'noch nicht eingeplant'}`;
        list.appendChild(li);
      });
      warning.appendChild(list);
      card.appendChild(warning);
    }

    const note = document.createElement('p');
    note.className = 'small muted';
    note.textContent = 'Jede Standardrate bleibt bis einschließlich der Schlusszahlung bei ihrer bisherigen Schuld. Erst ab dem Folgemonat wird sie auf die kleinste passende offene Ratenschuld gelegt. Der gesamte Schulden-Pool bleibt dadurch reserviert; zusätzliche freie Monatsbeträge werden nicht automatisch verwendet. Kreiskasse bleibt als Ziel für zusätzliche Zahlungen ausgeschlossen.';
    card.appendChild(note);
    return card;
  }

  function renderDynamicDebtSpecialPaymentCard(monthKey, plan = null) {
    const suggestion = getDynamicDebtSpecialPaymentSuggestion(monthKey, plan);
    if (!suggestion) return null;

    const card = document.createElement('div');
    card.className = 'sub-card dynamic-debt-extra-card';
    const head = document.createElement('div');
    head.className = 'dynamic-debt-extra-head';
    const titleWrap = document.createElement('div');
    const hasSuggestion = Number(suggestion.amount || 0) > 0;
    titleWrap.appendChild(createUiEl('span', hasSuggestion ? 'pill success' : 'pill', hasSuggestion ? 'Freiwilliger Vorschlag' : 'Aktuell nicht empfohlen'));
    titleWrap.appendChild(createUiEl('h3', '', 'Dynamische Sonderzahlung'));
    titleWrap.appendChild(createUiEl(
      'p',
      'small muted',
      hasSuggestion
        ? 'Dieser Betrag wird jeden Monat neu berechnet und gehört nicht zur festen Rate oder zum festen Schulden-Pool.'
        : 'Die Prüfung läuft automatisch jeden Monat. Aktuell bleibt das Geld im Haushalt, weil der Sicherheitspuffer noch nicht erreicht ist.'
    ));
    head.appendChild(titleWrap);
    head.appendChild(createUiEl('strong', 'dynamic-debt-extra-amount', hasSuggestion ? euro(suggestion.amount) : '–'));
    card.appendChild(head);

    const metrics = hasSuggestion
      ? [
          { label: 'Sicher frei vor Sonderzahlung', value: euro(suggestion.safelyFree), kind: 'success' },
          { label: 'Sicherheitspuffer bleibt', value: euro(suggestion.buffer) },
          { label: 'Vorgeschlagene Schuld', value: suggestion.target.name || 'Schuld' },
          { label: 'Wirkung', value: suggestion.closesTarget ? 'Schuld wäre vollständig bezahlt' : `Rest danach ca. ${euro(Math.max(0, Number(suggestion.target.amountOpen || 0) - suggestion.amount))}` }
        ]
      : [
          { label: 'Sicher frei nach allen Plänen', value: euro(suggestion.safelyFree), kind: suggestion.safelyFree >= 0 ? 'warning' : 'danger' },
          { label: 'Geschützter Puffer', value: euro(suggestion.buffer) },
          { label: 'Vorschlag erscheint ab', value: euro(snowballConfig.extraInvestTrigger) },
          { label: 'Bis dahin fehlen', value: euro(suggestion.neededForSuggestion || 0) }
        ];
    card.appendChild(createSummaryMetrics(metrics));

    const actionRow = document.createElement('div');
    actionRow.className = 'dynamic-debt-extra-actions';
    const info = createUiEl(
      'p',
      'small muted',
      hasSuggestion
        ? `Die App lässt ${euro(suggestion.buffer)} unangetastet. Du kannst den Betrag im nächsten Schritt noch ändern oder ganz darauf verzichten.`
        : `Sobald mindestens ${euro(snowballConfig.extraInvestTrigger)} sicher frei sind, wird nur der Teil oberhalb von ${euro(suggestion.buffer)} als Sonderzahlung vorgeschlagen.`
    );
    actionRow.appendChild(info);
    if (hasSuggestion) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'success';
      button.textContent = 'Sonderzahlung vorbereiten';
      button.addEventListener('click', () => {
        showDebtPaymentEditor(suggestion.target, {
          month: monthKey,
          amount: suggestion.amount,
          mode: 'extra',
          note: `Dynamischer Vorschlag für ${formatMonthLabel(monthKey)}`
        });
      });
      actionRow.appendChild(button);
    }
    card.appendChild(actionRow);
    return card;
  }

  function showDebtBalanceCheckEditor(debt, monthKey = currentMonth) {
    if (!debt) return;
    ensureDebtConfig(debt);
    const targetMonth = isMonthKey(monthKey) ? monthKey : currentMonth;
    const existing = (debt.balanceChecks || []).find((entry) => entry.month === targetMonth) || null;
    const previousAmount = Number(debt.amountOpen || 0);
    const content = document.createElement('div');
    content.className = 'modal-form debt-balance-check-form';

    const intro = document.createElement('div');
    intro.className = 'notice info';
    intro.textContent = `Trage den tatsächlich angezeigten Schuldenstand für ${formatMonthLabel(targetMonth)} ein. Die App übernimmt ihn als neue Restschuld; es wird dabei keine zusätzliche Zahlung gebucht.`;
    content.appendChild(intro);

    content.appendChild(createSummaryMetrics([
      { label: 'Bisher in der App', value: euro(previousAmount) },
      { label: 'Prüfrhythmus', value: getDebtBalanceCheckModeLabel(debt) },
      { label: 'Letzte Abfrage', value: getLatestDebtBalanceCheck(debt, targetMonth)?.month ? formatMonthLabel(getLatestDebtBalanceCheck(debt, targetMonth).month) : 'noch keine' }
    ]));

    const amountInput = createMoneyField(existing ? existing.amount : previousAmount);
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = 'Optional, z. B. Onlineportal oder Brief';
    noteInput.value = existing ? existing.note : '';
    const fields = document.createElement('div');
    fields.className = 'row';
    fields.appendChild(createLabelInput('Aktuell angezeigter Schuldenstand', amountInput));
    fields.appendChild(createLabelInput('Notiz / Quelle', noteInput));
    content.appendChild(fields);

    showModal(`Schuldenstand prüfen · ${debt.name || 'Schuld'}`, content, [
      {
        label: 'Abbrechen',
        className: 'secondary',
        onClick: (close) => close()
      },
      {
        label: 'Stand übernehmen',
        className: 'primary',
        onClick: (close) => {
          const amount = parseMoneyInput(amountInput.value);
          if (!Number.isFinite(amount) || amount < 0) return alert('Bitte einen gültigen Schuldenstand eingeben.');
          const priorEntry = existing || null;
          debt.balanceChecks = (debt.balanceChecks || []).filter((entry) => entry.month !== targetMonth);
          debt.balanceChecks.push({
            id: priorEntry && priorEntry.id ? priorEntry.id : generateId(),
            month: targetMonth,
            amount,
            previousAmount: priorEntry ? Number(priorEntry.previousAmount || previousAmount) : previousAmount,
            note: noteInput.value.trim(),
            createdAt: new Date().toISOString(),
            appliedToOpenBalance: true
          });
          debt.balanceChecks.sort((a, b) => a.month.localeCompare(b.month));
          debt.amountOpen = amount;
          if (amount <= 0) debt.completedMonth = targetMonth;
          else delete debt.completedMonth;
          const difference = amount - previousAmount;
          const differenceText = Math.abs(difference) <= 0.005
            ? 'ohne Abweichung'
            : `${difference > 0 ? '+' : ''}${euro(difference)} Abweichung`;
          addChangeLog('Schulden', `${debt.name || 'Schuld'}: Stand für ${formatMonthLabel(targetMonth)} auf ${euro(amount)} bestätigt (${differenceText})`, targetMonth);
          saveState();
          render();
          close();
        }
      }
    ]);
  }

  function renderDebtBalanceReviewCard(monthKey = currentMonth) {
    const activeDebts = (state.debts || []).filter((debt) => Number(debt && debt.amountOpen || 0) > 0);
    if (!activeDebts.length) return null;
    activeDebts.forEach(ensureDebtConfig);
    const dueDebts = getDueDebtBalanceChecks(monthKey);
    const monthlyDebts = activeDebts.filter((debt) => debt.balanceCheckMode === 'monthly');
    const annualDebts = activeDebts.filter((debt) => debt.balanceCheckMode !== 'monthly');
    const nextCheckMonths = activeDebts
      .map((debt) => getNextDebtBalanceCheckMonth(debt, monthKey))
      .filter(isMonthKey)
      .sort();

    const card = document.createElement('div');
    card.className = 'card debt-balance-review-card';
    const head = document.createElement('div');
    head.className = 'compact-section-head';
    head.appendChild(createUiEl('h3', '', `Schuldenstände · ${formatMonthLabel(monthKey)}`));
    head.appendChild(createUiEl('span', dueDebts.length ? 'pill warning' : 'pill success', dueDebts.length ? `${dueDebts.length} fällig` : 'aktuell'));
    card.appendChild(head);
    card.appendChild(createUiEl('p', 'small muted', 'Einsehbare Schulden fragst du monatlich ab, alle anderen nur alle zwölf Monate. Neue und bisher nicht geprüfte Schulden sind zunächst einmal fällig.'));
    card.appendChild(createSummaryMetrics([
      { label: 'Jetzt fällig', value: String(dueDebts.length), kind: dueDebts.length ? 'warning' : 'success' },
      { label: 'Monatlich', value: String(monthlyDebts.length) },
      { label: 'Jährlich', value: String(annualDebts.length) },
      { label: dueDebts.length ? 'Fällig seit' : 'Nächste Prüfung', value: nextCheckMonths[0] ? formatMonthLabel(nextCheckMonths[0]) : '—' }
    ]));

    if (!dueDebts.length) {
      const done = document.createElement('div');
      done.className = 'notice success';
      done.textContent = 'Für diesen Monat ist keine weitere Schuldenstandsabfrage nötig.';
      card.appendChild(done);
      return card;
    }

    const list = document.createElement('div');
    list.className = 'debt-balance-review-list';
    dueDebts.forEach((debt) => {
      const row = document.createElement('div');
      row.className = 'debt-balance-review-row';
      const info = document.createElement('div');
      info.className = 'debt-balance-review-copy';
      const name = document.createElement('strong');
      name.textContent = debt.name || 'Schuld';
      const latest = getLatestDebtBalanceCheck(debt, monthKey);
      const last = document.createElement('small');
      last.className = 'muted';
      last.textContent = latest
        ? `Zuletzt ${formatMonthLabel(latest.month)} · ${euro(latest.amount)}`
        : `Noch nie geprüft · aktuell geplant ${euro(Number(debt.amountOpen || 0))}`;
      info.appendChild(name);
      info.appendChild(last);

      const modeSelect = document.createElement('select');
      modeSelect.setAttribute('aria-label', `Prüfrhythmus für ${debt.name || 'Schuld'}`);
      [
        ['monthly', 'Monatlich · Stand einsehbar'],
        ['annual', 'Jährlich · nicht laufend einsehbar']
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = debt.balanceCheckMode === value;
        modeSelect.appendChild(option);
      });
      modeSelect.addEventListener('change', () => {
        debt.balanceCheckMode = modeSelect.value === 'monthly' ? 'monthly' : 'annual';
        addChangeLog('Schulden', `${debt.name || 'Schuld'}: Standprüfung auf ${debt.balanceCheckMode === 'monthly' ? 'monatlich' : 'jährlich'} gesetzt`, monthKey);
        saveState();
        render();
      });

      const checkBtn = document.createElement('button');
      checkBtn.type = 'button';
      checkBtn.className = 'primary';
      checkBtn.textContent = 'Stand eintragen';
      checkBtn.addEventListener('click', () => showDebtBalanceCheckEditor(debt, monthKey));

      row.appendChild(info);
      row.appendChild(modeSelect);
      row.appendChild(checkBtn);
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
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
      const plannedAmount = getDebtPlannedAmountForMonth(d, currentMonth);
      const coveredAmount = getDebtCoveredAmountForMonth(d, currentMonth);
      const openMonthAmount = getDebtOpenAmountForMonth(d, currentMonth);
      totalDebtSum += openAmount;
      if (openAmount > 0) activeDebts += 1;

      // Monatsplan = bereits in diesem Monat bezahlte Schulden + weiterhin fällige Schulden.
      // Wichtig: Nach einer Zahlung springt nextDueMonth auf den Folgemonat. Trotzdem darf die
      // bezahlte Mai-Rate nicht aus dem Mai-Plan verschwinden, sonst wird „Noch offen“ zu klein.
      if (plannedAmount > 0 || coveredAmount > 0 || monthlyRate > 0) {
        dueSum += plannedAmount;
        openThisMonth += openMonthAmount;
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
      { label: 'Restschuld gesamt', value: `${euro(totalDebtSum)}`, kind: totalDebtSum > 0 ? 'danger' : 'success' },
      { label: 'Plan diesen Monat', value: `${euro(dueSum)}`, kind: dueSum > 0 ? 'warning' : '' },
      { label: 'Bereits bezahlt', value: `${euro(paidSum)}`, kind: paidSum > 0 ? 'success' : '' },
      { label: 'Noch offen', value: `${euro(openThisMonth)}`, kind: openThisMonth > 0 ? 'danger' : 'success' },
      { label: 'Aktive Schulden', value: String(activeDebts) },
      { label: 'Schuldenfrei grob', value: estimatedDebtFree === '-' ? '-' : formatMonthLabel(estimatedDebtFree) }
    ]));
    const snowball = buildSnowballPlan(currentMonth, 120);
    if (snowball && snowball.rows && snowball.rows.length) {
      card.appendChild(renderDebtFreeForecastCard(snowball, currentMonth));
    }
    const currentSnowballRow = (snowball.rows || []).find((row) => row.month === currentMonth) || (snowball.rows || [])[0] || null;
    const currentDebtPlan = new Map();
    if (currentSnowballRow && Array.isArray(currentSnowballRow.payments)) {
      currentSnowballRow.payments.forEach((payment) => {
        const name = payment.debt || 'Unbekannt';
        if (!currentDebtPlan.has(name)) {
          currentDebtPlan.set(name, { rate: 0, snowball: 0, planned: 0, notes: [] });
        }
        const item = currentDebtPlan.get(name);
        const amount = Number(payment.amount || 0);
        item.planned += amount;
        if (payment.type === 'rate') item.rate += amount;
        else if (payment.type === 'snowball') item.snowball += amount;
        if (payment.note) item.notes.push(payment.note);
      });
    }

    // Bezahlte Schuldzahlungen bleiben für den Monat fest. Der offene Plan wird
    // danach nur noch für offene Schulden gewertet. So wird ein bereits bezahlter
    // Betrag nicht bei späteren Änderungen an Lohn/Kosten/Rücklagen rückwirkend verändert.
    let currentOpenPlannedDebtTotal = 0;
    let currentSnowballTotal = 0;
    (state.debts || []).forEach((d) => {
      ensureDebtConfig(d);
      if (Number(d.amountOpen || 0) <= 0) return;
      if (getDebtCoveredAmountForMonth(d, currentMonth) > 0) return;
      const planItem = currentDebtPlan.get(d.name) || null;
      const dueNowForDebt = isMonthKey(d.nextDueMonth) && monthDiff(d.nextDueMonth, currentMonth) >= 0;
      const fallbackRate = dueNowForDebt ? getDebtOpenAmountForMonth(d, currentMonth) : 0;
      const planned = Number(planItem && planItem.planned || 0) || fallbackRate;
      currentOpenPlannedDebtTotal += planned;
      currentSnowballTotal += Number(planItem && planItem.snowball || 0);
    });
    const currentPlannedDebtTotal = paidSum + currentOpenPlannedDebtTotal;
    if (currentPlannedDebtTotal > 0) {
      dueSum = currentPlannedDebtTotal;
      openThisMonth = currentOpenPlannedDebtTotal;
    }
    if (snowball.rows.length > 0) {
      card.appendChild(createSummaryMetrics([
        { label: 'Fester Schulden-Pool', value: `${euro(currentSnowballRow && (currentSnowballRow.pool || currentSnowballRow.total) || currentPlannedDebtTotal)}` },
        { label: 'Regel', value: 'Standardrate wechselt erst im Folgemonat' },
        { label: 'Plan aktueller Monat', value: `${euro(currentPlannedDebtTotal)}` },
        { label: 'davon übernommene Raten', value: `${euro(currentSnowballTotal)}` },
        { label: 'Ziel', value: 'kleinste passende offene Ratenschuld' },
        { label: 'Schuldenfrei mit Ratenwechsel', value: snowball.debtFreeMonth ? formatMonthLabel(snowball.debtFreeMonth) : 'offen' }
      ]));
    }
    const dynamicExtraCard = renderDynamicDebtSpecialPaymentCard(currentMonth, snowball);
    if (dynamicExtraCard) card.appendChild(dynamicExtraCard);
    card.appendChild(makeSearchFilterBar(debtSearch, debtFilter, (v) => { debtSearch = v; }, (v) => { debtFilter = v; }, [['active','Aktive'],['due','Nur fällig'],['paid','Diesen Monat bezahlt'],['done','Erledigt'],['all','Alle']]));

    let visibleDebts = state.debts.filter((d) => shouldShowDebtInMonth(d, currentMonth));
    visibleDebts = visibleDebts.filter((d) => {
      ensureDebtConfig(d);
      if (!matchesSearchText(d.name, debtSearch)) return false;
      const paidAmount = getDebtCoveredAmountForMonth(d, currentMonth);
      if (debtFilter === 'all') return true;
      if (debtFilter === 'due') return isDebtOpenForMonth(d, currentMonth);
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
      thead.innerHTML = `<tr><th>Name</th><th class="account-only">Konto</th><th>Offen</th><th>Standardrate</th><th>+ übernommene Rate</th><th>Geplant diesen Monat</th><th>Nächste Fälligkeit</th><th>Vorauss. Ende</th><th>Fortschritt</th><th>Status</th><th>Bezahlt?</th><th>Aktion</th></tr>`;
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      visibleDebts.forEach((d) => {
        ensureDebtConfig(d);
        const tr = document.createElement('tr');
        const dueNow = isMonthKey(d.nextDueMonth) && monthDiff(d.nextDueMonth, currentMonth) >= 0;
        const historyPaidAmount = getDebtPaymentAmountForMonth(d, currentMonth);
        const paidAmount = getDebtCoveredAmountForMonth(d, currentMonth);
        const monthOpenAmount = getDebtOpenAmountForMonth(d, currentMonth);
        const paidNow = paidAmount > 0 && monthOpenAmount <= 0.005;
        const canResetDebtPayment = d.paidMonths.includes(currentMonth) || historyPaidAmount > 0;
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
        const planItem = currentDebtPlan.get(d.name) || { rate: 0, snowball: 0, planned: 0 };
        const minRate = Number(getDebtRateForMonth(d, currentMonth) || 0);
        const isFixedPaidThisMonth = paidNow;
        const plannedRate = isFixedPaidThisMonth ? Math.min(minRate, paidAmount) : (Number(planItem.rate || 0) || (dueNow ? Math.min(minRate, Number(d.amountOpen || 0)) : 0));
        const plannedSnowball = isFixedPaidThisMonth ? 0 : Number(planItem.snowball || 0);
        const plannedTotal = isFixedPaidThisMonth ? paidAmount : (Number(planItem.planned || 0) || plannedRate);
        const plannedHtml = plannedTotal > 0
          ? `<strong>${euro(plannedTotal)}</strong><div class="small muted">${isFixedPaidThisMonth ? 'fest bezahlt' : 'Rate ' + euro(plannedRate)}</div>`
          : '-';
        tr.innerHTML = `<td class="debt-name-cell"><strong>${d.name}</strong></td><td class="account-only">${getAccountName(d.accountId)}</td><td>${euro(Number(d.amountOpen || 0))}</td><td>${euro(minRate)}</td><td>${plannedSnowball > 0 ? '<span class="snowball-pill">+' + euro(plannedSnowball) + '</span>' : '-'}</td><td class="${plannedSnowball > 0 ? 'amount-highlight' : ''}">${plannedHtml}</td><td>${d.nextDueMonth || '-'}</td><td>${estimatedEnd || '-'}</td><td>${progressHtml}</td><td>${statusHtml}</td><td></td><td></td>`;

        const payCell = tr.children[10];
        if (Number(d.amountOpen || 0) <= 0) {
          const done = document.createElement('div');
          const completedMonth = getDebtCompletedMonth(d);
          done.innerHTML = `<span class="pill success">Erledigt</span><div class="small muted">${completedMonth ? formatMonthLabel(completedMonth) : ''}</div>`;
          payCell.appendChild(done);
        } else if (paidNow) {
          const done = document.createElement('div');
          done.innerHTML = `<span class="pill success">Bezahlt</span><div class="small muted">${euro(paidAmount)}</div>`;
          payCell.appendChild(done);
        } else if (dueNow && plannedTotal > 0) {
          const btn = document.createElement('button');
          btn.textContent = 'Geplante Zahlung bezahlen';
          btn.className = 'success';
          btn.addEventListener('click', () => {
            markDebtPaid(d, plannedTotal, { rate: plannedRate, snowball: plannedSnowball });
          });
          payCell.appendChild(btn);
        } else {
          payCell.textContent = '-';
        }

        const actionCell = tr.children[11];
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

        const rateBtn = document.createElement('button');
        rateBtn.textContent = 'Rate ändern';
        rateBtn.className = 'secondary';
        rateBtn.addEventListener('click', () => {
          showDebtRateEditor(d);
        });

        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Zahlung zurücksetzen';
        resetBtn.className = 'secondary';
        resetBtn.disabled = !canResetDebtPayment;
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

        const reviewRuleText = getDebtRateChangeRuleText(d);
        const latestBalanceCheck = getLatestDebtBalanceCheck(d, currentMonth);
        const debtDetailsHtml = `<strong>${d.name}</strong><div><span>Zahlungsart:</span> ${typeHtml}</div><div><span>Standprüfung:</span> ${getDebtBalanceCheckModeLabel(d)}</div><div><span>Letzter bestätigter Stand:</span> ${latestBalanceCheck ? `${formatMonthLabel(latestBalanceCheck.month)} · ${euro(latestBalanceCheck.amount)}` : 'noch keiner'}</div>${reviewRuleText ? `<div><span>Regel:</span> ${reviewRuleText}</div>` : ''}<div><span>Ratenverlauf:</span> ${getDebtRateTimelineText(d) ? getDebtRateTimelineText(d) : '-'}</div>${getNextDebtRateChangeText(d) ? `<div class="small muted">${getNextDebtRateChangeText(d)}</div>` : ''}`;
        actionCell.appendChild(createActionMenu([
          { label: 'Bearbeiten', className: 'primary', onClick: () => showDebtEditor(d) },
          { label: 'Rate ändern', className: 'secondary', onClick: () => showDebtRateEditor(d) },
          { label: 'Zahlung eintragen', className: 'success', onClick: () => showDebtPaymentEditor(d) },
          { label: 'Schuldenstand eintragen', className: 'primary', onClick: () => showDebtBalanceCheckEditor(d, currentMonth) },
          { label: 'Zahlung zurücksetzen', className: 'secondary', disabled: !canResetDebtPayment, onClick: () => { if (confirm(`Zahlung für ${formatMonthLabel(currentMonth)} bei "${d.name}" zurücksetzen?`)) { resetDebtPaymentForMonth(d, currentMonth); saveState(); render(); } } },
          { label: 'Löschen', className: 'danger', onClick: () => { if (confirm(`Schuld "${d.name}" löschen?`)) { state.debts = state.debts.filter((x) => x.id !== d.id); saveState(); render(); } } }
        ], 'Aktionen ⋯', debtDetailsHtml));
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      card.appendChild(table);

      const info = document.createElement('p');
      info.className = 'small muted';
      info.innerHTML = `<strong>Monatsplan inklusive fest bezahlter Beträge:</strong> ${euro(dueSum)} · <strong>davon übernommene Standardraten:</strong> ${euro(currentSnowballTotal)} · <strong>Bereits bezahlt:</strong> ${euro(paidSum)} · <strong>Noch zu bezahlen:</strong> ${euro(openThisMonth)}`;
      card.appendChild(info);
    }

    const snowballCard = renderSnowballPlanCard(currentMonth);
    if (snowballCard) card.appendChild(snowballCard);
    const balanceReviewCard = renderDebtBalanceReviewCard(currentMonth);
    if (balanceReviewCard) debtsSection.appendChild(balanceReviewCard);
    debtsSection.appendChild(card);
  }



  function renderGroupedDebtPaymentPlanCard(plan, maxMonths = 12) {
    const box = document.createElement('div');
    box.className = 'sub-card payment-plan-card grouped-payment-plan-card';
    box.appendChild(createUiEl('h4', '', 'Schulden-Zahlungsplan kompakt'));
    box.appendChild(createUiEl('p', 'small muted', 'Eine Tabelle je Monat und Posten: eigentliche Rate, zusätzliche Umlegung aus ausgelaufenen Schulden, dynamische Extra-Zahlung und geplante Gesamtzahlung.'));

    const table = document.createElement('table');
    table.className = 'list-table compact-table grouped-payment-table';
    table.innerHTML = '<thead><tr><th>Monat</th><th>Posten</th><th>Rate</th><th>+ aus Schneeball</th><th>+ extra</th><th>Geplant gesamt</th><th>Rest danach</th><th>Hinweis</th></tr></thead>';
    const tbody = document.createElement('tbody');
    let rendered = 0;

    (plan.rows || []).slice(0, maxMonths).forEach((row) => {
      const grouped = new Map();
      (Array.isArray(row.payments) ? row.payments : []).forEach((payment) => {
        const name = payment.debt || 'Unbekannt';
        if (!grouped.has(name)) {
          grouped.set(name, {
            debt: name,
            regular: 0,
            snowball: 0,
            dynamic: 0,
            planned: 0,
            remainingAfter: Number(payment.remainingAfter || 0),
            completed: false,
            notes: []
          });
        }
        const item = grouped.get(name);
        const amount = Number(payment.amount || 0);
        item.planned += amount;
        if (payment.type === 'rate') item.regular += amount;
        else if (payment.type === 'snowball') item.snowball += amount;
        else if (payment.type === 'dynamic') item.dynamic += amount;
        item.remainingAfter = Number(payment.remainingAfter || item.remainingAfter || 0);
        item.completed = item.completed || !!payment.completed;
        if (payment.note) item.notes.push(payment.note);
      });

      const transferNotes = new Map();
      (Array.isArray(row.freedTransfers) ? row.freedTransfers : []).forEach((entry) => {
        const target = entry.targetDebt || 'keine weitere Schuld / wird frei';
        const txt = `${entry.sourceDebt} läuft aus: ${euro(Number(entry.amount || 0))} ab ${formatMonthLabel(entry.transferMonth)} → ${target}`;
        const key = entry.targetDebt || '__free__';
        if (!transferNotes.has(key)) transferNotes.set(key, []);
        transferNotes.get(key).push(txt);
      });

      const items = Array.from(grouped.values()).sort((a, b) => {
        const extraA = Number(a.snowball || 0) + Number(a.dynamic || 0);
        const extraB = Number(b.snowball || 0) + Number(b.dynamic || 0);
        if (extraB !== extraA) return extraB - extraA;
        return a.debt.localeCompare(b.debt);
      });

      if (items.length === 0 && transferNotes.size === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${formatMonthLabel(row.month)}</td><td>keine Schuldenzahlung</td><td>0,00 €</td><td>-</td><td>-</td><td>0,00 €</td><td>${euro(Number(row.remaining || 0))}</td><td>-</td>`;
        tbody.appendChild(tr);
        rendered += 1;
        return;
      }

      items.forEach((item, index) => {
        const tr = document.createElement('tr');
        const notes = [];
        if (item.completed) notes.push('erledigt / läuft aus');
        if (item.notes.length) notes.push(...Array.from(new Set(item.notes)));
        if (transferNotes.has(item.debt)) notes.push(...transferNotes.get(item.debt));
        const hasExtra = Number(item.snowball || 0) > 0 || Number(item.dynamic || 0) > 0;
        tr.innerHTML = `
          <td>${index === 0 ? formatMonthLabel(row.month) : ''}</td>
          <td><strong>${item.debt}</strong></td>
          <td>${euro(Number(item.regular || 0))}</td>
          <td>${Number(item.snowball || 0) > 0 ? '<span class="snowball-pill">+' + euro(Number(item.snowball || 0)) + '</span>' : '-'}</td>
          <td>${Number(item.dynamic || 0) > 0 ? '<span class="dynamic-pill">+' + euro(Number(item.dynamic || 0)) + '</span>' : '-'}</td>
          <td class="${hasExtra ? 'amount-highlight' : ''}"><strong>${euro(Number(item.planned || 0))}</strong></td>
          <td>${euro(Number(item.remainingAfter || 0))}</td>
          <td>${notes.length ? notes.join('<br>') : '-'}</td>`;
        tbody.appendChild(tr);
        rendered += 1;
      });

      if (transferNotes.has('__free__')) {
        transferNotes.get('__free__').forEach((txt, idx) => {
          const tr = document.createElement('tr');
          tr.className = 'soft-row';
          tr.innerHTML = `<td>${items.length === 0 && idx === 0 ? formatMonthLabel(row.month) : ''}</td><td><strong>frei werdend</strong></td><td>-</td><td>-</td><td>-</td><td>0,00 €</td><td>${euro(Number(row.remaining || 0))}</td><td>${txt}</td>`;
          tbody.appendChild(tr);
          rendered += 1;
        });
      }
    });

    if (!rendered) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="8">Keine geplanten Schuldenzahlungen im sichtbaren Zeitraum.</td>';
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    box.appendChild(table);
    return box;
  }

  function renderSnowballPlanCard(monthKey) {
    const plan = buildSnowballPlan(monthKey, 120);
    const suggestions = getDebtRolloverSuggestionsForMonth(monthKey, plan);
    if (!suggestions.length) return null;

    const card = document.createElement('div');
    card.className = 'sub-card debt-rollover-card';
    const h = document.createElement('h3');
    h.textContent = 'Standardrate wird ab dem Folgemonat frei';
    card.appendChild(h);
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = 'Die Schlussrate bleibt noch vollständig in diesem Monat bei ihrer bisherigen Schuld. Erst im folgenden Monat wird die Standardrate auf eine andere Schuld gelegt. So bleibt dein fester Schulden-Pool erhalten.';
    card.appendChild(p);
    const list = document.createElement('div');
    list.className = 'debt-rollover-list';
    suggestions.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'debt-rollover-row';
      const source = document.createElement('div');
      source.appendChild(createUiEl('span', 'pill success', entry.status === 'completed' ? 'Schlussrate bezahlt' : 'Letzte Rate in diesem Monat'));
      source.appendChild(createUiEl('strong', '', entry.sourceDebt || 'Schuld'));
      source.appendChild(createUiEl('small', 'muted', `Standardrate: ${euro(Number(entry.amount || 0))}`));

      const transfer = document.createElement('div');
      transfer.appendChild(createUiEl('span', 'debt-rollover-arrow', '→'));
      transfer.appendChild(createUiEl('strong', '', `Frei ab ${formatMonthLabel(entry.transferMonth)}`));
      transfer.appendChild(createUiEl(
        'small',
        'muted',
        entry.targetDebt
          ? `Vorschlag: ${euro(Number(entry.amount || 0))} monatlich auf „${entry.targetDebt}“ legen.`
          : 'Keine passende Ratenschuld offen – der Betrag bleibt im Schulden-Pool frei.'
      ));
      row.appendChild(source);
      row.appendChild(transfer);
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  function markDebtPaid(debt, plannedAmount, breakdown = {}) {
    ensureDebtConfig(debt);
    const paidMonth = currentMonth;
    if (!isMonthKey(paidMonth)) {
      alert('Bitte zuerst einen gültigen Monat auswählen.');
      return;
    }
    const minimumRate = Number(getDebtRateForMonth(debt, paidMonth) || getDebtRateForMonth(debt, debt.nextDueMonth || paidMonth) || 0);
    const amount = Number(plannedAmount || 0) > 0 ? Number(plannedAmount || 0) : minimumRate;
    if (!(amount > 0)) {
      alert('Für diese Schuld ist in diesem Monat keine Zahlung geplant.');
      return;
    }
    const sourceParts = ['Schuldenbereich'];
    if (Number(breakdown.rate || 0) > 0) sourceParts.push(`Rate ${euro(Number(breakdown.rate || 0))}`);
    if (Number(breakdown.snowball || 0) > 0) sourceParts.push(`übernommene Standardrate ${euro(Number(breakdown.snowball || 0))}`);
    if (addDebtPayment(debt, {
      month: paidMonth,
      amount,
      source: sourceParts.join(' · '),
      note: 'Geplante Monatszahlung festgeschrieben. Der feste Schulden-Pool bleibt erhalten.',
      markAsMonthly: true
    })) {
      saveState();
      render();
    }
  }

  function showDebtRateEditor(debt) {
    ensureDebtConfig(debt);
    const refs = {};
    const content = document.createElement('div');
    content.className = 'modal-form';

    const info = document.createElement('p');
    info.className = 'small muted';
    const currentRate = getDebtRateForMonth(debt, currentMonth);
    info.innerHTML = `<strong>${debt.name}</strong><br>Aktuelle Rate in ${formatMonthLabel(currentMonth)}: <strong>${euro(currentRate)}</strong>${getNextDebtRateChangeText(debt) ? `<br>${getNextDebtRateChangeText(debt)}` : ''}`;
    content.appendChild(info);

    const row1 = document.createElement('div');
    row1.className = 'row';
    refs.monthInput = document.createElement('input');
    refs.monthInput.type = 'month';
    refs.monthInput.value = getNextAllowedDebtRateChangeMonth(debt, currentMonth);
    refs.amountInput = createMoneyField(currentRate > 0 ? currentRate : '');
    row1.appendChild(createLabelInput('Gültig ab Monat', refs.monthInput));
    row1.appendChild(createLabelInput('Neue Rate', refs.amountInput));
    content.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'row';
    refs.modeSelect = document.createElement('select');
    refs.modeSelect.innerHTML = `
      <option value="from_month">Ab diesem Monat dauerhaft</option>
      <option value="single_month">Nur dieser Monat</option>
    `;
    row2.appendChild(createLabelInput('Gültigkeit', refs.modeSelect));
    content.appendChild(row2);

    const rateRuleText = getDebtRateChangeRuleText(debt);
    if (rateRuleText) {
      const ruleInfo = document.createElement('p');
      ruleInfo.className = 'small warning-text';
      ruleInfo.textContent = rateRuleText + ' Wenn du einen anderen Monat auswählst, wird die Änderung nicht gespeichert; Sonderzahlungen kannst du weiterhin über „Zahlung eintragen“ buchen.';
      content.appendChild(ruleInfo);
    }

    const timeline = document.createElement('p');
    timeline.className = 'small muted';
    timeline.innerHTML = `<strong>Ratenverlauf:</strong> ${getDebtRateTimelineText(debt) || 'keine abweichende Rate hinterlegt'}`;
    content.appendChild(timeline);

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = getDebtAnnualRateRule(debt)
      ? 'Reguläre Ratenänderungen sind bei dieser Schuld nur zum erlaubten Prüfmonat möglich. Freiwillige Sonderzahlungen bitte über „Zahlung eintragen“ buchen.'
      : 'Beispiel: Kreiskasse ab Dezember 2026 auf 185 € setzen → Monat Dezember 2026 wählen, 185,00 € eintragen, „ab diesem Monat dauerhaft“ speichern.';
    content.appendChild(hint);

    showModal('Rate ändern', content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      {
        label: 'Speichern',
        className: 'primary',
        onClick: (close) => {
          const month = refs.monthInput.value;
          const amount = parseMoneyInput(refs.amountInput.value);
          if (!isMonthKey(month)) return alert('Bitte einen gültigen Monat wählen.');
          if (!Number.isFinite(amount) || amount < 0) return alert('Bitte eine gültige Rate eingeben.');
          if (!isDebtRateChangeAllowedInMonth(debt, month)) {
            const allowed = getNextAllowedDebtRateChangeMonth(debt, month);
            refs.monthInput.value = allowed;
            return alert(`${debt.name}: Die Rate darf nur jährlich zum 01.${String(getDebtAnnualRateRule(debt).month).padStart(2, '0')}. angepasst werden. Nächster zulässiger Monat: ${formatMonthLabel(allowed)}.`);
          }
          const oldRate = getDebtRateForMonth(debt, month);
          if (refs.modeSelect.value === 'single_month') {
            if (!setDebtRateOnlyForMonth(debt, month, amount)) return alert('Die Rate konnte für diesen Monat nicht geändert werden.');
            addChangeLog('Schulden', `${debt.name}: Rate nur ${formatMonthLabel(month)} von ${euro(oldRate)} auf ${euro(amount)} geändert`, month);
          } else {
            if (!setDebtRateFromMonth(debt, month, amount)) return alert('Die Rate konnte ab diesem Monat nicht geändert werden.');
            addChangeLog('Schulden', `${debt.name}: Rate ab ${formatMonthLabel(month)} von ${euro(oldRate)} auf ${euro(amount)} geändert`, month);
          }
          if (debt.paymentType === 'open_plan' && amount > 0) debt.paymentType = 'installment';
          saveState();
          render();
          close();
        }
      }
    ]);
  }

  function showDebtPaymentEditor(debt, defaults = {}) {
    ensureDebtConfig(debt);
    const refs = {};
    const content = document.createElement('div');
    content.className = 'modal-form';

    const info = document.createElement('p');
    info.className = 'small muted';
    info.innerHTML = `<strong>${debt.name}</strong> · Offen: ${euro(Number(debt.amountOpen || 0))} · Rate: ${euro(Number(getDebtRateForMonth(debt, currentMonth) || 0))}`;
    content.appendChild(info);

    const row1 = document.createElement('div');
    row1.className = 'row';
    refs.monthInput = document.createElement('input');
    refs.monthInput.type = 'month';
    refs.monthInput.value = isMonthKey(defaults.month)
      ? defaults.month
      : (isMonthKey(debt.nextDueMonth) ? debt.nextDueMonth : currentMonth);
    const defaultRate = Number(getDebtRateForMonth(debt, currentMonth) || 0);
    refs.amountInput = createMoneyField(Number(defaults.amount || 0) > 0 ? Number(defaults.amount) : (defaultRate > 0 ? defaultRate : ''));
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
    if (['regular', 'partial', 'extra'].includes(defaults.mode)) refs.typeSelect.value = defaults.mode;
    refs.noteInput = document.createElement('input');
    refs.noteInput.type = 'text';
    refs.noteInput.placeholder = 'Notiz optional';
    refs.noteInput.value = defaults.note || '';
    row2.appendChild(createLabelInput('Zahlungsart', refs.typeSelect));
    row2.appendChild(createLabelInput('Notiz', refs.noteInput));
    content.appendChild(row2);

    if (defaults.mode === 'extra') {
      const suggestionInfo = document.createElement('div');
      suggestionInfo.className = 'notice success';
      suggestionInfo.textContent = 'Freiwilliger dynamischer Vorschlag: Betrag und Monat sind vorbereitet, werden aber erst mit „Speichern“ als echte Sonderzahlung übernommen.';
      content.appendChild(suggestionInfo);
    }

    if (debt && getDebtRateTimelineText(debt)) {
      const timelineInfo = document.createElement('p');
      timelineInfo.className = 'small muted';
      timelineInfo.innerHTML = `<strong>Aktueller Ratenverlauf:</strong> ${getDebtRateTimelineText(debt)}`;
      content.appendChild(timelineInfo);
    }

    refs.bookAccountCheck = { checked: false };
    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = 'Die Zahlung aktualisiert die Schuld und den Monatsstatus. Es wird keine Kontobuchung erzeugt.';
    content.appendChild(hint);

    showModal('Zahlung eintragen', content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      {
        label: 'Speichern',
        className: 'primary',
        onClick: (close) => {
          const month = refs.monthInput.value;
          const amount = parseMoneyInput(refs.amountInput.value);
          if (!isMonthKey(month)) return alert('Bitte einen gültigen Monat wählen.');
          if (!Number.isFinite(amount) || amount <= 0) return alert('Bitte einen gültigen Betrag eingeben.');
          const mode = refs.typeSelect.value;
          if (mode === 'extra' && !isDebtExtraPaymentAllowed(debt)) {
            return alert(`${debt.name}: Für diese Schuld sind keine freiwilligen Sonderzahlungen erlaubt.`);
          }
          const markAsMonthly = mode === 'regular';
          if (markAsMonthly && !(getDebtRateForMonth(debt, currentMonth) > 0)) return alert('Für eine Regelrate muss zuerst eine Monatsrate hinterlegt sein.');
          if (addDebtPayment(debt, {
            month,
            amount,
            source: mode === 'regular' ? 'Regelrate' : (mode === 'partial' ? 'Teilzahlung' : 'Sonderzahlung'),
            note: refs.noteInput.value.trim(),
            markAsMonthly,
            bookAccountTransaction: ACCOUNTS_ENABLED && refs.bookAccountCheck.checked
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
    refs.openInput = createMoneyField(editDebt ? editDebt.amountOpen : '');
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
    refs.balanceCheckModeSelect = document.createElement('select');
    refs.balanceCheckModeSelect.innerHTML = `
      <option value="monthly">Monatlich · Stand einsehbar</option>
      <option value="annual">Jährlich · Stand nicht laufend einsehbar</option>
    `;
    refs.balanceCheckModeSelect.value = editDebt && editDebt.balanceCheckMode === 'monthly' ? 'monthly' : 'annual';
    typeRow.appendChild(createLabelInput('Schuldenstand prüfen', refs.balanceCheckModeSelect));
    refs.accountSelect = { value: '' };
    if (ACCOUNTS_ENABLED) {
      refs.accountSelect = createAccountSelect(editDebt ? editDebt.accountId : getDefaultAccountIdForContext('personal', 'benny'), { includeNone: true });
      typeRow.appendChild(createLabelInput('Zahlungskonto', refs.accountSelect));
    }
    content.appendChild(typeRow);

    const row2 = document.createElement('div');
    row2.className = 'row';
    refs.rateInput = createMoneyField(editDebt ? editDebt.monthlyRate : '');
    refs.dueInput = document.createElement('input');
    refs.dueInput.type = 'month';
    refs.dueInput.value = editDebt ? editDebt.nextDueMonth : currentMonth;
    row2.appendChild(createLabelInput('Monatsrate', refs.rateInput));
    row2.appendChild(createLabelInput('Nächste Fälligkeit', refs.dueInput));
    content.appendChild(row2);

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = 'Die App fragt einsehbare Schuldenstände monatlich ab, alle anderen nur alle zwölf Monate. Nur laufende Ratenzahlungen gehören zum festen Schulden-Pool; ihre Standardrate wechselt erst nach der Schlussrate im Folgemonat. Bei MKK ist die Rate auf jährliche Anpassung zum 01.05. begrenzt.';
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
          const open = parseMoneyInput(refs.openInput.value);
          let rate = parseMoneyInput(refs.rateInput.value);
          const due = refs.dueInput.value;
          const paymentType = refs.paymentTypeSelect.value;
          const balanceCheckMode = refs.balanceCheckModeSelect.value === 'monthly' ? 'monthly' : 'annual';
          if (!name) return alert('Name darf nicht leer sein.');
          if (!Number.isFinite(open) || open < 0) return alert('Bitte einen gültigen offenen Betrag eingeben.');
          if (!Number.isFinite(rate)) rate = 0;
          if (rate < 0) return alert('Bitte eine gültige Monatsrate eingeben.');
          if (paymentType === 'installment' && open > 0 && !(rate > 0)) return alert('Bei Ratenzahlung muss eine Monatsrate größer 0 € hinterlegt sein.');
          if (paymentType === 'open_plan') rate = 0;
          if (!due || !/^\d{4}-\d{2}$/.test(due)) return alert('Bitte eine gültige Fälligkeit wählen.');
          if (editDebt && getDebtAnnualRateRule(editDebt) && Math.abs(Number(editDebt.monthlyRate || 0) - rate) > 0.01 && !isDebtRateChangeAllowedInMonth(editDebt, currentMonth)) {
            return alert(`${editDebt.name}: Die Monatsrate darf nur zum 01.${String(getDebtAnnualRateRule(editDebt).month).padStart(2, '0')}. geändert werden. Nutze dafür bitte „Rate ändern“ und wähle den Mai des jeweiligen Jahres.`);
          }

          if (editDebt) {
            const wasOpen = Number(editDebt.amountOpen || 0) > 0;
            editDebt.name = name;
            editDebt.amountOpen = open;
            editDebt.monthlyRate = rate;
            editDebt.paymentType = paymentType;
            editDebt.balanceCheckMode = balanceCheckMode;
            editDebt.nextDueMonth = due;
            editDebt.accountId = ACCOUNTS_ENABLED ? (refs.accountSelect.value || '') : '';
            if (open <= 0 && wasOpen) editDebt.completedMonth = currentMonth;
            if (open > 0) delete editDebt.completedMonth;
          } else {
            const newDebt = { id: generateId(), name, amountOpen: open, monthlyRate: rate, paymentType, balanceCheckMode, balanceChecks: [], nextDueMonth: due, paidMonths: [], rateTimeline: [], accountId: ACCOUNTS_ENABLED ? (refs.accountSelect.value || '') : '' };
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
    const adjustedPersons = state.persons.filter((p) => p.netOverrides && p.netOverrides[currentMonth] != null).length;
    card.appendChild(createSummaryMetrics([
      { label: 'Grundlohn gesamt', value: `${euro(totalBaseIncome)}` },
      { label: `Verwendet in ${formatMonthLabel(currentMonth)}`, value: `${euro(totalActiveIncome)}`, kind: 'success' },
      { label: 'Ist-Auszahlungen erfasst', value: String(adjustedPersons), kind: adjustedPersons > 0 ? 'success' : '' },
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
      const sourceKind = p.netOverrides && p.netOverrides[currentMonth] != null ? 'success' : '';
      const activeShift = getPersonShift(p, currentMonth);
      const hasShiftOverride = p.shiftOverrides && p.shiftOverrides[currentMonth] != null;

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
        { label: 'Grundlohn / Basis', value: `${euro(Number(p.net || 0))}` },
        { label: `Verwendet in ${formatMonthLabel(currentMonth)}`, value: `${euro(getPersonNet(p, currentMonth))}`, kind: sourceKind },
        { label: hasShiftOverride ? 'Verschiebung nur Monat' : 'Verschiebung', value: `${euro(activeShift)}`, kind: hasShiftOverride ? 'warning' : '' },
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
        timelineHint.textContent = `Nächster bekannter Planwert: ${euro(nextTimeline.amount)} ab ${formatMonthLabel(nextTimeline.month)}.`;
      } else if (getActiveNetTimelineEntry(p, currentMonth)) {
        timelineHint.textContent = `Ein Planwert ist hinterlegt; die tatsächliche Auszahlung kannst du monatlich im Einkommen-Bereich eintragen.`;
      } else {
        timelineHint.textContent = 'Für zukünftige Monate gilt zunächst der hinterlegte Grundlohn.';
      }
      personCard.appendChild(timelineHint);

      card.appendChild(personCard);
    });
    settingsSection.appendChild(card);
  }

  function normalizeSavingsGoalsConfig() {
    if (!Array.isArray(state.savingsGoals)) state.savingsGoals = [];
    state.savingsGoals = state.savingsGoals
      .filter((goal) => goal && typeof goal === 'object')
      .map((goal) => ({
        id: typeof goal.id === 'string' && goal.id ? goal.id : generateId(),
        name: typeof goal.name === 'string' && goal.name.trim() ? goal.name.trim() : 'Rücklagen-Posten',
        targetAmount: Math.max(0, Number(goal.targetAmount || 0)),
        monthlyAmount: Math.max(0, Number(goal.monthlyAmount || 0)),
        balance: Math.max(0, Number(goal.balance || 0)),
        startMonth: isMonthKey(goal.startMonth) ? goal.startMonth : currentMonth,
        dueMonth: isMonthKey(goal.dueMonth) ? goal.dueMonth : '',
        accountId: ACCOUNTS_ENABLED ? (typeof goal.accountId === 'string' && goal.accountId ? goal.accountId : DEFAULT_SHARED_ACCOUNT_ID) : '',
        isActive: goal.isActive !== false,
        note: typeof goal.note === 'string' ? goal.note : '',
        transactions: Array.isArray(goal.transactions) ? goal.transactions.filter((tx) => tx && typeof tx === 'object').map((tx) => ({
          id: typeof tx.id === 'string' && tx.id ? tx.id : generateId(),
          month: isMonthKey(tx.month) ? tx.month : currentMonth,
          type: tx.type === 'withdraw' ? 'withdraw' : 'deposit',
          amount: Math.max(0, Number(tx.amount || 0)),
          note: typeof tx.note === 'string' ? tx.note : '',
          sourceId: typeof tx.sourceId === 'string' ? tx.sourceId : '',
          sourcePostId: typeof tx.sourcePostId === 'string' ? tx.sourcePostId : '',
          createdAt: typeof tx.createdAt === 'string' ? tx.createdAt : ''
        })) : []
      }));
  }

  function getSavingsGoalsActive(monthKey = currentMonth) {
    normalizeSavingsGoalsConfig();
    return state.savingsGoals.filter((goal) => goal.isActive && isMonthKey(monthKey) && monthDiff(goal.startMonth, monthKey) >= 0);
  }

  function getSavingsGoalsMonthlyPlan(monthKey = currentMonth) {
    return getSavingsGoalsActive(monthKey).reduce((sum, goal) => sum + Number(goal.monthlyAmount || 0), 0);
  }

  function getLinkedSavingsPlanForGoal(goalId, monthKey = currentMonth) {
    if (!goalId || !isMonthKey(monthKey)) return 0;
    return [...(state.commonCosts || []), ...(state.personalCosts || []), ...(state.bufferExpenses || [])]
      .filter((post) => post && post.linkedSavingsGoalId === goalId && isPostActiveInMonth(post, monthKey))
      .reduce((sum, post) => sum + Number(getEffectiveAmountForMonth(post, monthKey) || 0) / Number(post.interval || 1), 0);
  }

  function getLinkedSavingsPlanTotal(monthKey = currentMonth) {
    return (state.savingsGoals || []).reduce((sum, goal) => sum + getLinkedSavingsPlanForGoal(goal.id, monthKey), 0);
  }

  function getSavingsGoalBoundForAccount(accountId) {
    if (!accountId || !Array.isArray(state.savingsGoals)) return 0;
    return state.savingsGoals
      .filter((goal) => goal && goal.accountId === accountId)
      .reduce((sum, goal) => sum + Math.max(0, Number(goal.balance || 0)), 0);
  }

  function getSavingsGoalProgress(goal) {
    const target = Number(goal.targetAmount || 0);
    const balance = Number(goal.balance || 0);
    const missing = Math.max(0, target - balance);
    const pct = target > 0 ? Math.min(100, (balance / target) * 100) : 0;
    return { target, balance, missing, pct };
  }

  function applySavingsGoalTransaction(goal, amount, type = 'deposit', note = '', monthKey = currentMonth) {
    normalizeSavingsGoalsConfig();
    const g = state.savingsGoals.find((item) => item.id === goal.id);
    if (!g) return false;
    const value = Math.max(0, Number(amount || 0));
    if (!(value > 0)) return false;
    const txType = type === 'withdraw' ? 'withdraw' : 'deposit';
    if (txType === 'deposit') g.balance = Number(g.balance || 0) + value;
    else g.balance = Math.max(0, Number(g.balance || 0) - value);
    g.transactions.push({
      id: generateId(),
      month: isMonthKey(monthKey) ? monthKey : currentMonth,
      type: txType,
      amount: value,
      note: note || (txType === 'deposit' ? 'Einzahlung' : 'Entnahme'),
      sourceId: '',
      sourcePostId: '',
      createdAt: new Date().toISOString()
    });
    addChangeLog('Rücklagen', `${g.name}: ${txType === 'deposit' ? 'Einzahlung' : 'Entnahme'} ${euro(value)}.`, monthKey);
    return true;
  }

  function showSavingsGoalEditor(goal) {
    const goalId = goal && goal.id ? goal.id : '';
    normalizeSavingsGoalsConfig();
    const isNew = !goalId;
    const item = !isNew
      ? state.savingsGoals.find((entry) => entry.id === goalId)
      : { id: generateId(), name: '', targetAmount: 0, monthlyAmount: 0, balance: 0, startMonth: currentMonth, dueMonth: '', accountId: DEFAULT_SHARED_ACCOUNT_ID, isActive: true, note: '', transactions: [] };
    if (!item) return;
    const content = document.createElement('div');
    content.className = 'modal-form';
    const row1 = document.createElement('div');
    row1.className = 'row';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = item.name || '';
    nameInput.placeholder = 'z. B. Auto-Reparatur, Urlaub, Laptop';
    const targetInput = document.createElement('input');
    targetInput.type = 'number';
    targetInput.step = '0.01';
    targetInput.min = '0';
    targetInput.value = item.targetAmount ? Number(item.targetAmount).toFixed(2) : '';
    row1.appendChild(createLabelInput('Posten', nameInput));
    row1.appendChild(createLabelInput('Zielbetrag optional', targetInput));
    content.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'row';
    const monthlyInput = document.createElement('input');
    monthlyInput.type = 'number';
    monthlyInput.step = '0.01';
    monthlyInput.min = '0';
    monthlyInput.value = item.monthlyAmount ? Number(item.monthlyAmount).toFixed(2) : '';
    const balanceInput = document.createElement('input');
    balanceInput.type = 'number';
    balanceInput.step = '0.01';
    balanceInput.min = '0';
    balanceInput.value = item.balance ? Number(item.balance).toFixed(2) : '';
    row2.appendChild(createLabelInput('Feste Monatssumme', monthlyInput));
    row2.appendChild(createLabelInput('Aktuell angespart', balanceInput));
    content.appendChild(row2);
    const monthlyHint = document.createElement('p');
    monthlyHint.className = 'small muted';
    monthlyHint.textContent = 'Kommt die monatliche Einzahlung aus einem verknüpften Kostenposten, lasse „Feste Monatssumme“ leer. So wird der Plan nicht doppelt angezeigt.';
    content.appendChild(monthlyHint);

    const row3 = document.createElement('div');
    row3.className = 'row';
    const startInput = document.createElement('input');
    startInput.type = 'month';
    startInput.value = item.startMonth || currentMonth;
    const dueInput = document.createElement('input');
    dueInput.type = 'month';
    dueInput.value = item.dueMonth || '';
    row3.appendChild(createLabelInput('Startmonat', startInput));
    row3.appendChild(createLabelInput('Zielmonat optional', dueInput));
    content.appendChild(row3);

    const row4 = document.createElement('div');
    row4.className = 'row';
    const accountSelect = ACCOUNTS_ENABLED ? createAccountSelect(item.accountId || DEFAULT_SHARED_ACCOUNT_ID, { includeNone: false }) : { value: '' };
    const activeSelect = document.createElement('select');
    activeSelect.innerHTML = '<option value="true">Aktiv</option><option value="false">Pausiert</option>';
    activeSelect.value = item.isActive === false ? 'false' : 'true';
    if (ACCOUNTS_ENABLED) row4.appendChild(createLabelInput('Konto der Rücklage', accountSelect));
    row4.appendChild(createLabelInput('Status', activeSelect));
    content.appendChild(row4);

    const noteInput = document.createElement('textarea');
    noteInput.rows = 2;
    noteInput.value = item.note || '';
    content.appendChild(createLabelInput('Notiz', noteInput));

    showModal(isNew ? 'Rücklagen-Posten hinzufügen' : 'Rücklagen-Posten bearbeiten', content, [
      { label: 'Abbrechen', className: 'secondary' },
      { label: 'Speichern', className: 'primary', onClick: (close) => {
        const name = nameInput.value.trim();
        if (!name) return alert('Bitte einen Namen eintragen.');
        item.name = name;
        item.targetAmount = Math.max(0, Number(targetInput.value || 0));
        item.monthlyAmount = Math.max(0, Number(monthlyInput.value || 0));
        item.balance = Math.max(0, Number(balanceInput.value || 0));
        item.startMonth = isMonthKey(startInput.value) ? startInput.value : currentMonth;
        item.dueMonth = isMonthKey(dueInput.value) ? dueInput.value : '';
        item.accountId = accountSelect.value || '';
        item.isActive = activeSelect.value !== 'false';
        item.note = noteInput.value || '';
        if (isNew) state.savingsGoals.push(item);
        normalizeSavingsGoalsConfig();
        saveState();
        close();
        render();
      } }
    ]);
  }

  function showSavingsGoalTransactionEditor(goal, type = 'deposit') {
    const content = document.createElement('div');
    content.className = 'modal-form';
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.step = '0.01';
    amountInput.min = '0';
    amountInput.value = type === 'deposit' && goal.monthlyAmount ? Number(goal.monthlyAmount).toFixed(2) : '';
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = type === 'deposit' ? 'z. B. feste Monatssumme' : 'z. B. gekauft/bezahlt';
    content.appendChild(createLabelInput(type === 'deposit' ? 'Einzahlung' : 'Entnahme', amountInput));
    content.appendChild(createLabelInput('Notiz', noteInput));
    showModal(`${type === 'deposit' ? 'Einzahlung' : 'Entnahme'} · ${goal.name}`, content, [
      { label: 'Abbrechen', className: 'secondary' },
      { label: type === 'deposit' ? 'Einzahlen' : 'Entnehmen', className: type === 'deposit' ? 'success' : 'danger', onClick: (close) => {
        const amount = Number(amountInput.value || 0);
        if (!(amount > 0)) return alert('Bitte einen Betrag größer als 0 eintragen.');
        if (applySavingsGoalTransaction(goal, amount, type, noteInput.value || '', currentMonth)) {
          saveState();
          close();
          render();
        }
      } }
    ]);
  }

  // Rendert den Bereich „Rücklagen & Sparen“ – nur Verteilung und Transaktionen
  
function renderSavings() {
    normalizeSavingsGoalsConfig();
    savingsSection.innerHTML = '';
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
    addBtn.className = 'primary';
    addBtn.textContent = '+ Rücklagen-Posten';
    addBtn.addEventListener('click', () => showSavingsGoalEditor());
    header.appendChild(monthSelect);
    header.appendChild(addBtn);
    card.appendChild(header);

    const heading = document.createElement('h2');
    heading.textContent = 'Rücklagen & Sparen';
    card.appendChild(heading);

    const intro = document.createElement('p');
    intro.className = 'small muted';
    intro.textContent = 'Du legst einzelne Rücklagen an, z. B. Auto, Urlaub, Laptop oder Kleidung. Sie können direkt mit gemeinsamen, persönlichen oder sonstigen Kostenposten verknüpft werden; bezahlte verknüpfte Posten zahlen einmalig in die passende Rücklage ein. Nur Rücklagen-Posten im Bereich Gemeinsame Kosten zählen in den Anteil gemeinsamer Kosten. Kommt die Monatssumme aus einer Verknüpfung, lasse die feste Monatssumme leer.';
    card.appendChild(intro);

    const activeGoals = getSavingsGoalsActive(currentMonth);
    const totalSaved = (state.savingsGoals || []).reduce((sum, goal) => sum + Number(goal.balance || 0), 0);
    const monthlyPlan = getSavingsGoalsMonthlyPlan(currentMonth);
    const linkedMonthlyPlan = getLinkedSavingsPlanTotal(currentMonth);
    const totalTarget = (state.savingsGoals || []).reduce((sum, goal) => sum + Number(goal.targetAmount || 0), 0);
    const missingTotal = (state.savingsGoals || []).reduce((sum, goal) => sum + getSavingsGoalProgress(goal).missing, 0);
    card.appendChild(createSummaryMetrics([
      { label: 'Aktive Posten', value: String(activeGoals.length), kind: activeGoals.length ? 'success' : 'warning' },
      { label: 'Feste Monatssumme', value: euro(monthlyPlan), kind: monthlyPlan > 0 ? 'success' : '' },
      { label: 'Aus Kosten verknüpft', value: euro(linkedMonthlyPlan), kind: linkedMonthlyPlan > 0 ? 'success' : '' },
      { label: 'Angespart gesamt', value: euro(totalSaved), kind: totalSaved > 0 ? 'success' : '' },
      { label: 'Zielsumme', value: totalTarget > 0 ? euro(totalTarget) : 'ohne feste Ziele' },
      { label: 'Noch offen', value: totalTarget > 0 ? euro(missingTotal) : '—', kind: missingTotal > 0 ? 'warning' : 'success' }
    ]));

    if (!state.savingsGoals.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<strong>Noch keine Rücklagen-Posten.</strong><br>Lege z. B. „Auto“, „Urlaub“, „MacBook“ oder „Kleidung“ an und hinterlege bei Bedarf eine feste Monatssumme.';
      card.appendChild(empty);
      savingsSection.appendChild(card);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'savings-goals-grid';
    state.savingsGoals.forEach((goal) => {
      const progress = getSavingsGoalProgress(goal);
      const linkedMonthly = getLinkedSavingsPlanForGoal(goal.id, currentMonth);
      const box = document.createElement('div');
      box.className = `savings-goal-card ${goal.isActive ? '' : 'paused'}`;
      const top = document.createElement('div');
      top.className = 'savings-goal-head';
      const titleWrap = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = goal.name;
      const meta = document.createElement('div');
      meta.className = 'small muted';
      meta.textContent = `${goal.isActive ? 'Aktiv' : 'Pausiert'} · Start ${formatMonthLabel(goal.startMonth)}${goal.dueMonth ? ' · Zielmonat ' + formatMonthLabel(goal.dueMonth) : ''}`;
      titleWrap.appendChild(title);
      titleWrap.appendChild(meta);
      const chip = document.createElement('span');
      chip.className = `pill ${progress.missing > 0 ? 'warning' : 'success'}`;
      chip.textContent = progress.target > 0 ? `${progress.pct.toFixed(0)} %` : euro(progress.balance);
      top.appendChild(titleWrap);
      top.appendChild(chip);
      box.appendChild(top);

      const bar = document.createElement('div');
      bar.className = 'goal-progress-bar';
      const fill = document.createElement('span');
      fill.style.width = `${progress.target > 0 ? progress.pct : 100}%`;
      bar.appendChild(fill);
      box.appendChild(bar);

      box.appendChild(createSummaryMetrics([
        { label: 'Angespart', value: euro(progress.balance), kind: progress.balance > 0 ? 'success' : '' },
        { label: 'Ziel', value: progress.target > 0 ? euro(progress.target) : 'offen' },
        { label: 'Monatssumme', value: goal.monthlyAmount > 0 ? euro(goal.monthlyAmount) : 'keine feste Summe' },
        { label: 'Verknüpfte Kosten', value: linkedMonthly > 0 ? euro(linkedMonthly) : 'keine' },
        { label: 'Fehlt', value: progress.target > 0 ? euro(progress.missing) : '—', kind: progress.missing > 0 ? 'warning' : 'success' }
      ]));

      if (goal.note) {
        const note = document.createElement('p');
        note.className = 'small muted';
        note.textContent = goal.note;
        box.appendChild(note);
      }

      const actions = document.createElement('div');
      actions.className = 'row savings-goal-actions';
      const depositBtn = document.createElement('button');
      depositBtn.className = 'success';
      depositBtn.textContent = goal.monthlyAmount > 0 ? `Monatssumme ${euro(goal.monthlyAmount)} buchen` : 'Einzahlung buchen';
      depositBtn.addEventListener('click', () => showSavingsGoalTransactionEditor(goal, 'deposit'));
      const withdrawBtn = document.createElement('button');
      withdrawBtn.className = 'danger';
      withdrawBtn.textContent = 'Entnahme';
      withdrawBtn.addEventListener('click', () => showSavingsGoalTransactionEditor(goal, 'withdraw'));
      const editBtn = document.createElement('button');
      editBtn.className = 'secondary';
      editBtn.textContent = 'Bearbeiten';
      editBtn.addEventListener('click', () => showSavingsGoalEditor(goal));
      actions.appendChild(depositBtn);
      actions.appendChild(withdrawBtn);
      actions.appendChild(editBtn);
      box.appendChild(actions);

      if (goal.transactions && goal.transactions.length) {
        const details = document.createElement('details');
        details.className = 'compact-details';
        const summary = document.createElement('summary');
        summary.textContent = 'Buchungen anzeigen';
        details.appendChild(summary);
        const table = document.createElement('table');
        table.className = 'list-table compact-table';
        table.innerHTML = '<thead><tr><th>Monat</th><th>Art</th><th>Betrag</th><th>Notiz</th></tr></thead>';
        const tbody = document.createElement('tbody');
        goal.transactions.slice().sort((a, b) => (b.month || '').localeCompare(a.month || '')).slice(0, 8).forEach((tx) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${formatMonthLabel(tx.month)}</td><td>${tx.type === 'withdraw' ? 'Entnahme' : 'Einzahlung'}</td><td>${euro(tx.amount)}</td><td>${tx.note || '-'}</td>`;
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        details.appendChild(table);
        box.appendChild(details);
      }

      grid.appendChild(box);
    });
    card.appendChild(grid);
    savingsSection.appendChild(card);
  }

  function showPotEditor() {
    const content = document.createElement('div');
    content.className = 'modal-form';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'z. B. Urlaub oder Auto';
    const amountInput = createMoneyField(0);
    content.appendChild(createLabelInput('Name des Topfs', nameInput));
    content.appendChild(createLabelInput('Startbetrag in €', amountInput));
    showModal('Neuen Topf anlegen', content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      {
        label: 'Anlegen',
        className: 'primary',
        onClick: (close) => {
          const name = nameInput.value.trim();
          const initial = parseMoneyInput(amountInput.value);
          if (!name) return alert('Bitte einen Namen für den Topf eingeben.');
          if (!Number.isFinite(initial)) return alert('Bitte einen gültigen Startbetrag eingeben.');
          const pot = { id: generateId(), name, balance: initial, transactions: [] };
          if (!Array.isArray(state.pots)) state.pots = [];
          state.pots.push(pot);
          selectedPotId = pot.id;
          addChangeLog('Töpfe', `${name} mit ${euro(initial)} angelegt`, currentMonth);
          saveState();
          close();
          render();
        }
      }
    ]);
  }

  function showPotTransactionEditor(pot, type) {
    if (!pot) return;
    const isWithdrawal = type === 'withdraw';
    const content = document.createElement('div');
    content.className = 'modal-form';
    const info = document.createElement('p');
    info.className = 'small muted';
    info.textContent = `${pot.name} · aktueller Saldo ${euro(pot.balance)}`;
    content.appendChild(info);
    const amountInput = createMoneyField('');
    const descriptionInput = document.createElement('input');
    descriptionInput.type = 'text';
    descriptionInput.placeholder = isWithdrawal ? 'z. B. Reparatur' : 'z. B. monatliche Rücklage';
    content.appendChild(createLabelInput(isWithdrawal ? 'Ausgabe in €' : 'Einzahlung in €', amountInput));
    content.appendChild(createLabelInput('Beschreibung (optional)', descriptionInput));

    let allowOverdraftCheck = null;
    if (isWithdrawal) {
      const allowOverdraftLabel = document.createElement('label');
      allowOverdraftLabel.className = 'checkbox-row';
      allowOverdraftCheck = document.createElement('input');
      allowOverdraftCheck.type = 'checkbox';
      allowOverdraftLabel.appendChild(allowOverdraftCheck);
      allowOverdraftLabel.appendChild(document.createTextNode(' Überziehung erlauben, falls die Ausgabe größer als der Saldo ist'));
      content.appendChild(allowOverdraftLabel);
    }

    showModal(isWithdrawal ? `Aus ${pot.name} ausgeben` : `In ${pot.name} einzahlen`, content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      {
        label: isWithdrawal ? 'Ausgabe buchen' : 'Einzahlung buchen',
        className: isWithdrawal ? 'danger' : 'success',
        onClick: (close) => {
          const amount = parseMoneyInput(amountInput.value);
          if (!Number.isFinite(amount) || amount <= 0) return alert('Bitte einen positiven Betrag eingeben.');
          if (isWithdrawal && amount > Number(pot.balance || 0) && !allowOverdraftCheck.checked) {
            return alert('Der Betrag ist größer als der Saldo. Aktiviere „Überziehung erlauben“, wenn du trotzdem fortfahren möchtest.');
          }
          const signedAmount = isWithdrawal ? -amount : amount;
          pot.balance = Number(pot.balance || 0) + signedAmount;
          if (!Array.isArray(pot.transactions)) pot.transactions = [];
          pot.transactions.push({
            date: currentMonth,
            type: isWithdrawal ? 'withdraw' : 'deposit',
            amount: signedAmount,
            description: descriptionInput.value.trim()
          });
          addChangeLog('Töpfe', `${pot.name}: ${isWithdrawal ? 'Ausgabe' : 'Einzahlung'} ${euro(amount)} gebucht`, currentMonth);
          saveState();
          close();
          render();
        }
      }
    ]);
  }

  // Rendert den neuen Bereich „Töpfe“ mit allen Rücklagen-Töpfen und Summen
  
function renderPots() {
    potsSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('h2');
    title.textContent = 'Töpfe';
    card.appendChild(title);
    const intro = document.createElement('p');
    intro.textContent = 'Verwalte Rücklagen, Einzahlungen und Ausgaben. Beträge können mit Komma oder Punkt eingegeben werden.';
    card.appendChild(intro);

    const header = document.createElement('div');
    header.className = 'row';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      setCurrentMonth(e.target.value);
      render();
    });

    const potSelect = document.createElement('select');
    potSelect.setAttribute('aria-label', 'Topf auswählen');
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
    addBtn.type = 'button';
    addBtn.textContent = '+ Neuer Topf';
    addBtn.className = 'primary';
    addBtn.addEventListener('click', showPotEditor);

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
      { label: 'Gesamt in Töpfen', value: `${euro(totalManual)}`, kind: totalManual > 0 ? 'success' : '' },
      { label: 'Plan 12 Monate', value: `${euro(totalReservePlan)}` },
      { label: `Einzahlungen ${formatMonthLabel(currentMonth)}`, value: `${euro(monthDeposits)}`, kind: monthDeposits > 0 ? 'success' : '' },
      { label: `Ausgaben ${formatMonthLabel(currentMonth)}`, value: `${euro(monthWithdrawals)}`, kind: monthWithdrawals > 0 ? 'warning' : '' },
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

      tr.innerHTML = `<td>${pot.name}</td><td>${euro(pot.balance)}</td><td>${euro(autoSum)}</td><td></td>`;
      const act = tr.children[3];

      act.appendChild(createActionMenu([
        { label: 'Einzahlen', className: 'success', onClick: () => showPotTransactionEditor(pot, 'deposit') },
        { label: 'Ausgeben', className: 'danger', onClick: () => showPotTransactionEditor(pot, 'withdraw') }
      ]));
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
          dRow.innerHTML = `<td>${m.label}</td><td>${euro(autoVal)}</td><td>${euro(dep)}</td><td>${euro(wit)}</td>`;
          dBody.appendChild(dRow);
        });

        detTable.appendChild(dBody);
        detailCard.appendChild(detTable);

        let sumAuto = 0;
        monthList.forEach((m) => {
          sumAuto += pot.name === 'Sparen' ? getSavingsContribution(m.key) : getReserveContributionForPot(pot.name, m.key);
        });
        const summaryDetail = document.createElement('p');
        summaryDetail.innerHTML = `<strong>Plan-Gesamt für 12 Monate:</strong> ${euro(sumAuto)}`;
        detailCard.appendChild(summaryDetail);
        card.appendChild(detailCard);
      }
    }

    potsSection.appendChild(card);
  }
  // Rendert den Sicherungsbereich

  function openAutomaticBrowserBackupDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (automaticBrowserBackupDbPromise) return automaticBrowserBackupDbPromise;
    automaticBrowserBackupDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(AUTOMATIC_BROWSER_BACKUP_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(AUTOMATIC_BROWSER_BACKUP_STORE_NAME)) {
          db.createObjectStore(AUTOMATIC_BROWSER_BACKUP_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Automatische Sicherungen konnten nicht geöffnet werden.'));
    });
    return automaticBrowserBackupDbPromise;
  }

  async function listAutomaticBrowserBackups() {
    const db = await openAutomaticBrowserBackupDb();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOMATIC_BROWSER_BACKUP_STORE_NAME, 'readonly');
      const request = tx.objectStore(AUTOMATIC_BROWSER_BACKUP_STORE_NAME).getAll();
      request.onsuccess = () => {
        const rows = Array.isArray(request.result) ? request.result : [];
        rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        resolve(rows);
      };
      request.onerror = () => reject(request.error || new Error('Automatische Sicherungen konnten nicht gelesen werden.'));
    });
  }

  async function putAutomaticBrowserBackup(record) {
    const db = await openAutomaticBrowserBackupDb();
    if (!db) throw new Error('Der Browser-Speicher für automatische Sicherungen ist nicht verfügbar.');
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOMATIC_BROWSER_BACKUP_STORE_NAME, 'readwrite');
      tx.objectStore(AUTOMATIC_BROWSER_BACKUP_STORE_NAME).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Automatische Sicherung konnte nicht gespeichert werden.'));
    });

    const all = await listAutomaticBrowserBackups();
    const expired = all.slice(AUTOMATIC_BROWSER_BACKUP_RETENTION);
    if (!expired.length) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOMATIC_BROWSER_BACKUP_STORE_NAME, 'readwrite');
      const store = tx.objectStore(AUTOMATIC_BROWSER_BACKUP_STORE_NAME);
      expired.forEach((entry) => store.delete(entry.id));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Alte automatische Sicherungen konnten nicht aufgeräumt werden.'));
    });
  }

  async function createAutomaticBrowserBackup(options = {}) {
    normalizeAppMeta();
    if (!('indexedDB' in window)) return { ok: false, status: 'unsupported' };
    const previousTimestamp = state.appMeta.lastAutomaticBrowserBackupAt || '';
    const previousDate = previousTimestamp ? new Date(previousTimestamp) : null;
    const previousAge = previousDate && !Number.isNaN(previousDate.getTime())
      ? Date.now() - previousDate.getTime()
      : Number.POSITIVE_INFINITY;
    if (!options.force && previousAge < AUTOMATIC_BROWSER_BACKUP_INTERVAL_MS) {
      return { ok: true, status: 'fresh', timestamp: previousTimestamp, skipped: true };
    }

    const timestamp = new Date().toISOString();
    state.appMeta.lastAutomaticBrowserBackupAt = timestamp;
    const payload = JSON.stringify(state);
    const record = {
      id: options.id || `daily-${timestamp.slice(0, 10)}`,
      createdAt: timestamp,
      month: currentMonth,
      label: options.label || 'Tägliche Sicherung',
      payload
    };
    try {
      await putAutomaticBrowserBackup(record);
      writeStatePayloadToStorage(payload);
      return { ok: true, status: 'saved', timestamp, record };
    } catch (err) {
      state.appMeta.lastAutomaticBrowserBackupAt = previousTimestamp;
      throw err;
    }
  }

  function queueAutomaticBrowserBackup(options = {}) {
    if (!automaticBrowserBackupInitialized || automaticBrowserBackupQueued || !('indexedDB' in window)) return;
    normalizeAppMeta();
    const last = state.appMeta.lastAutomaticBrowserBackupAt ? new Date(state.appMeta.lastAutomaticBrowserBackupAt) : null;
    if (!options.force && last && !Number.isNaN(last.getTime()) && Date.now() - last.getTime() < AUTOMATIC_BROWSER_BACKUP_INTERVAL_MS) return;
    automaticBrowserBackupQueued = true;
    setTimeout(async () => {
      try {
        await createAutomaticBrowserBackup({ force: options.force === true });
        if (currentSection === 'overview' || currentSection === 'monthstart') render();
      } catch (err) {
        console.warn('Automatische Browser-Sicherung konnte nicht aktualisiert werden', err);
      } finally {
        automaticBrowserBackupQueued = false;
      }
    }, 350);
  }

  async function reconcileAutomaticBrowserBackups() {
    if (!('indexedDB' in window)) return false;
    try {
      normalizeAppMeta();
      const backups = await listAutomaticBrowserBackups();
      if (!backups.length) {
        await createAutomaticBrowserBackup({ force: true });
        return true;
      }
      const latestTimestamp = String(backups[0].createdAt || '');
      if (latestTimestamp && state.appMeta.lastAutomaticBrowserBackupAt !== latestTimestamp) {
        state.appMeta.lastAutomaticBrowserBackupAt = latestTimestamp;
        writeStatePayloadToStorage(JSON.stringify(state));
        return true;
      }
      queueAutomaticBrowserBackup();
      return false;
    } catch (err) {
      console.warn('Status der automatischen Browser-Sicherung konnte nicht geprüft werden', err);
      return false;
    }
  }

  const EXTERNAL_BACKUP_DB_NAME = 'haushaltsplanerExternalBackup';
  const EXTERNAL_BACKUP_STORE_NAME = 'handles';
  const EXTERNAL_BACKUP_HANDLE_KEY = 'backupDirectory';
  const EXTERNAL_BACKUP_FILENAME = 'haushaltsplaner-auto-backup.json';
  const EXTERNAL_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  let externalBackupDbPromise = null;
  let cachedExternalBackupDirectoryHandle = null;
  let externalBackupQueued = false;

  function openExternalBackupDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (externalBackupDbPromise) return externalBackupDbPromise;
    externalBackupDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(EXTERNAL_BACKUP_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(EXTERNAL_BACKUP_STORE_NAME)) {
          db.createObjectStore(EXTERNAL_BACKUP_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Sicherungsordner konnte nicht gespeichert werden.'));
    });
    return externalBackupDbPromise;
  }

  async function getExternalBackupDirectoryHandle() {
    const db = await openExternalBackupDb();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(EXTERNAL_BACKUP_STORE_NAME, 'readonly');
      const request = tx.objectStore(EXTERNAL_BACKUP_STORE_NAME).get(EXTERNAL_BACKUP_HANDLE_KEY);
      request.onsuccess = () => {
        cachedExternalBackupDirectoryHandle = request.result || null;
        resolve(cachedExternalBackupDirectoryHandle);
      };
      request.onerror = () => reject(request.error || new Error('Sicherungsordner konnte nicht gelesen werden.'));
    });
  }

  async function storeExternalBackupDirectoryHandle(handle) {
    const db = await openExternalBackupDb();
    if (!db) throw new Error('Dieser Browser kann den ausgewählten Ordner nicht dauerhaft merken.');
    return new Promise((resolve, reject) => {
      const tx = db.transaction(EXTERNAL_BACKUP_STORE_NAME, 'readwrite');
      tx.objectStore(EXTERNAL_BACKUP_STORE_NAME).put(handle, EXTERNAL_BACKUP_HANDLE_KEY);
      tx.oncomplete = () => {
        cachedExternalBackupDirectoryHandle = handle;
        resolve(true);
      };
      tx.onerror = () => reject(tx.error || new Error('Sicherungsordner konnte nicht gespeichert werden.'));
    });
  }

  async function removeExternalBackupDirectoryHandle() {
    const db = await openExternalBackupDb();
    if (!db) return false;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(EXTERNAL_BACKUP_STORE_NAME, 'readwrite');
      tx.objectStore(EXTERNAL_BACKUP_STORE_NAME).delete(EXTERNAL_BACKUP_HANDLE_KEY);
      tx.oncomplete = () => {
        cachedExternalBackupDirectoryHandle = null;
        resolve(true);
      };
      tx.onerror = () => reject(tx.error || new Error('Sicherungsordner konnte nicht getrennt werden.'));
    });
  }

  async function getExternalBackupPermission(handle, requestPermission = false) {
    if (!handle) return 'missing';
    const options = { mode: 'readwrite' };
    if (typeof handle.queryPermission === 'function') {
      const current = await handle.queryPermission(options);
      if (current === 'granted' || !requestPermission) return current;
    }
    if (requestPermission && typeof handle.requestPermission === 'function') {
      return handle.requestPermission(options);
    }
    return 'prompt';
  }

  async function writeExternalBackup(options = {}) {
    normalizeAppMeta();
    const handle = options.handle || cachedExternalBackupDirectoryHandle || await getExternalBackupDirectoryHandle();
    if (!handle) return { ok: false, status: 'missing' };
    const permission = await getExternalBackupPermission(handle, options.requestPermission === true);
    if (permission !== 'granted') return { ok: false, status: permission || 'prompt' };

    const timestamp = new Date().toISOString();
    const { blob } = createBackupFile({ filename: EXTERNAL_BACKUP_FILENAME, externalTimestamp: timestamp });
    const fileHandle = await handle.getFileHandle(EXTERNAL_BACKUP_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    state.appMeta.externalBackupFolderName = String(handle.name || state.appMeta.externalBackupFolderName || 'Sicherungsordner');
    state.appMeta.lastExternalBackupAt = timestamp;
    writeStatePayloadToStorage(JSON.stringify(state));
    return { ok: true, status: 'granted', timestamp, folderName: state.appMeta.externalBackupFolderName };
  }

  function queueAutomaticExternalBackup() {
    if (externalBackupQueued || !state.appMeta || !state.appMeta.externalBackupFolderName) return;
    const last = state.appMeta.lastExternalBackupAt ? new Date(state.appMeta.lastExternalBackupAt) : null;
    if (last && !Number.isNaN(last.getTime()) && Date.now() - last.getTime() < EXTERNAL_BACKUP_INTERVAL_MS) return;
    externalBackupQueued = true;
    setTimeout(async () => {
      try {
        await writeExternalBackup({ requestPermission: false });
      } catch (err) {
        console.warn('Automatische externe Sicherung konnte nicht aktualisiert werden', err);
      } finally {
        externalBackupQueued = false;
      }
    }, 500);
  }

  async function reconcileExternalBackupConnection() {
    try {
      normalizeAppMeta();
      const handle = await getExternalBackupDirectoryHandle();
      let changed = false;
      if (!handle && (state.appMeta.externalBackupFolderName || state.appMeta.lastExternalBackupAt)) {
        state.appMeta.externalBackupFolderName = '';
        state.appMeta.lastExternalBackupAt = '';
        changed = true;
      } else if (handle && state.appMeta.externalBackupFolderName !== String(handle.name || 'Sicherungsordner')) {
        state.appMeta.externalBackupFolderName = String(handle.name || 'Sicherungsordner');
        changed = true;
      }
      if (changed) writeStatePayloadToStorage(JSON.stringify(state));
      if (handle) queueAutomaticExternalBackup();
      return changed;
    } catch (err) {
      console.warn('Status der externen Sicherung konnte nicht geprüft werden', err);
      return false;
    }
  }

  function createBackupFilename() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    return `haushaltsplaner-backup-${yyyy}-${mm}-${dd}-${hh}${mi}.json`;
  }

  function createBackupFile(options = {}) {
    normalizeAppMeta();
    syncAllLinkedDebtRatesFromPosts(currentMonth, 36, { silent: true });
    normalizeAllPersonConfigs();
    normalizeAllPostConfigs();
    normalizeAllDebtConfigs();
    const backupState = JSON.parse(JSON.stringify(state));
    if (!backupState.appMeta || typeof backupState.appMeta !== 'object') backupState.appMeta = {};
    backupState.appMeta.includeApiKeyInBackup = true;
    if (options.externalTimestamp) backupState.appMeta.lastExternalBackupAt = options.externalTimestamp;
    // Der API-Key wird bewusst NICHT entfernt: Benny möchte nur ein Backup, immer mit API-Key.
    const dataStr = JSON.stringify(backupState, null, 2);
    const filename = options.filename || createBackupFilename();
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





  function normalizeTaxRefund(refund) {
    if (!refund || typeof refund !== 'object') return null;
    if (!refund.id) refund.id = generateId();
    const currentYear = new Date().getFullYear();
    const year = Number(refund.year || currentYear);
    refund.year = Number.isFinite(year) ? String(Math.max(2000, Math.min(2100, Math.trunc(year)))) : String(currentYear);
    const amount = parseMoneyInput(refund.amount || 0);
    refund.amount = Number.isFinite(amount) && amount >= 0 ? amount : 0;
    if (typeof refund.receivedDate !== 'string') refund.receivedDate = '';
    if (typeof refund.note !== 'string') refund.note = '';
    if (typeof refund.accountId !== 'string') refund.accountId = '';
    if (typeof refund.transactionId !== 'string') refund.transactionId = '';
    if (!Array.isArray(refund.purchases)) refund.purchases = [];
    refund.purchases = refund.purchases
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        if (!item.id) item.id = generateId();
        if (typeof item.name !== 'string') item.name = '';
        const itemAmount = parseMoneyInput(item.amount || 0);
        item.amount = Number.isFinite(itemAmount) && itemAmount >= 0 ? itemAmount : 0;
        if (typeof item.date !== 'string') item.date = '';
        if (typeof item.note !== 'string') item.note = '';
        if (typeof item.accountId !== 'string') item.accountId = '';
        if (typeof item.transactionId !== 'string') item.transactionId = '';
        return item;
      })
      .sort((a, b) => {
        const aDate = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || '')) ? a.date : '';
        const bDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : '';
        if (aDate && bDate && aDate !== bDate) return bDate.localeCompare(aDate);
        if (aDate !== bDate) return aDate ? -1 : 1;
        return 0;
      });
    return refund;
  }

  function getTaxRefundAccountSourceId(refund) {
    return refund && refund.id ? `taxrefund:${refund.id}` : '';
  }

  function syncTaxRefundAccountBooking(refund) {
    if (!refund || typeof refund !== 'object') return null;
    const sourceId = getTaxRefundAccountSourceId(refund);
    if (!sourceId) return null;
    const amount = Number(refund.amount || 0);
    if (!(amount > 0)) {
      removeAccountTransactionBySource(sourceId);
      refund.transactionId = '';
      return null;
    }
    const shared = getSharedAccount();
    if (!shared) return null;
    refund.accountId = shared.id;
    const txId = upsertAccountTransaction(shared.id, {
      month: getMonthFromDateString(refund.receivedDate),
      date: refund.receivedDate || '',
      type: 'tax_refund',
      sourceId,
      label: `Steuererstattung ${refund.year || ''}`.trim(),
      amount,
      note: 'Nachweis: Die Erstattung liegt auf dem Gemeinschaftskonto; der eingegebene Bankstand bleibt unverändert.'
    });
    refund.transactionId = txId || '';
    return txId;
  }

  function removeTaxRefundAccountBooking(refund) {
    if (!refund || typeof refund !== 'object') return false;
    const sourceId = getTaxRefundAccountSourceId(refund);
    let removed = false;
    if (sourceId) removed = removeAccountTransactionBySource(sourceId) || removed;
    if (refund.transactionId && refund.accountId) removed = removeAccountLedgerTransaction(refund.accountId, refund.transactionId) || removeAccountTransaction(refund.accountId, refund.transactionId) || removed;
    (refund.purchases || []).forEach((purchase) => { removed = removeTaxRefundPurchaseBooking(refund, purchase) || removed; });
    refund.transactionId = '';
    return removed;
  }

  function getTaxRefundPurchaseSourceId(refund, purchase) {
    return refund && refund.id && purchase && purchase.id ? `taxrefund-purchase:${refund.id}:${purchase.id}` : '';
  }

  function getMonthFromDateString(dateValue) {
    const value = String(dateValue || '');
    const match = value.match(/^(\d{4}-\d{2})-\d{2}$/);
    return match && isMonthKey(match[1]) ? match[1] : DEFAULT_TRANSACTION_MONTH;
  }

  function syncTaxRefundPurchaseBooking(refund, purchase) {
    if (!refund || !purchase) return null;
    const sourceId = getTaxRefundPurchaseSourceId(refund, purchase);
    if (!sourceId) return null;
    const amount = Number(purchase.amount || 0);
    if (!(amount > 0)) {
      removeAccountTransactionBySource(sourceId);
      purchase.transactionId = '';
      return null;
    }
    const shared = getSharedAccount();
    if (!shared) return null;
    refund.accountId = shared.id;
    purchase.accountId = shared.id;
    const txId = upsertAccountTransaction(shared.id, {
      month: getMonthFromDateString(purchase.date),
      date: purchase.date || '',
      type: 'tax_refund_purchase',
      sourceId,
      label: `Steuererstattung: ${purchase.name || 'Kauf'}`,
      amount: -amount,
      note: 'Nachweis: Kauf aus gebundener Steuererstattung; der eingegebene Bankstand bleibt unverändert.'
    });
    purchase.transactionId = txId || '';
    return txId;
  }

  function removeTaxRefundPurchaseBooking(refund, purchase) {
    if (!refund || !purchase) return false;
    const sourceId = getTaxRefundPurchaseSourceId(refund, purchase);
    let removed = false;
    if (sourceId) removed = removeAccountTransactionBySource(sourceId) || removed;
    if (purchase.transactionId && purchase.accountId) removed = removeAccountLedgerTransaction(purchase.accountId, purchase.transactionId) || removeAccountTransaction(purchase.accountId, purchase.transactionId) || removed;
    purchase.transactionId = '';
    return removed;
  }

  function syncTaxRefundPurchaseBookings(refund) {
    if (!refund || typeof refund !== 'object') return;
    const currentSources = new Set();
    (refund.purchases || []).forEach((purchase) => {
      const sourceId = getTaxRefundPurchaseSourceId(refund, purchase);
      if (sourceId) currentSources.add(sourceId);
      syncTaxRefundPurchaseBooking(refund, purchase);
    });
    const prefix = refund && refund.id ? `taxrefund-purchase:${refund.id}:` : '';
    if (!prefix) return;
    (state.accounts || []).forEach((account) => {
      (account.transactions || []).slice().forEach((tx) => {
        if (tx && typeof tx.sourceId === 'string' && tx.sourceId.startsWith(prefix) && !currentSources.has(tx.sourceId)) {
          removeAccountLedgerTransaction(account.id, tx.id) || removeAccountTransaction(account.id, tx.id);
        }
      });
    });
  }

  function normalizeAllTaxRefunds() {
    if (!Array.isArray(state.taxRefunds)) state.taxRefunds = [];
    state.taxRefunds = state.taxRefunds.map(normalizeTaxRefund).filter(Boolean);
    state.taxRefunds.sort((a, b) => {
      const yearOrder = String(b.year).localeCompare(String(a.year));
      if (yearOrder) return yearOrder;
      const aDate = /^\d{4}-\d{2}-\d{2}$/.test(String(a.receivedDate || '')) ? a.receivedDate : '';
      const bDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.receivedDate || '')) ? b.receivedDate : '';
      if (aDate && bDate && aDate !== bDate) return bDate.localeCompare(aDate);
      if (aDate !== bDate) return aDate ? -1 : 1;
      return 0;
    });
    state.taxRefunds.forEach((refund) => {
      (refund.purchases || []).forEach((purchase) => {
        if (purchase.transferMeta && purchase.transferMeta.from === 'bufferExpense' && purchase.transferMeta.postId
            && !(state.bufferExpenses || []).some((post) => post && post.id === purchase.transferMeta.postId)) {
          removeAllPostAccountBookings(purchase.transferMeta.postId);
        }
      });
      syncTaxRefundAccountBooking(refund);
      syncTaxRefundPurchaseBookings(refund);
    });
  }

  function getTaxRefundSummary(year) {
    normalizeAllTaxRefunds();
    const refunds = (state.taxRefunds || []).filter((item) => String(item.year) === String(year));
    const received = refunds.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const spent = refunds.reduce((sum, item) => sum + (item.purchases || []).reduce((s, p) => s + Number(p.amount || 0), 0), 0);
    const remaining = received - spent;
    const boundRemaining = refunds.reduce((sum, item) => {
      const used = (item.purchases || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      return sum + Math.max(Number(item.amount || 0) - used, 0);
    }, 0);
    const purchases = refunds.reduce((sum, item) => sum + (item.purchases || []).length, 0);
    return { refunds, received, spent, remaining, boundRemaining, purchases };
  }

  function renderTaxRefundControlCard(summary, year) {
    const card = createUiEl('div', 'card tax-refund-control-card');
    card.appendChild(createUiEl('h3', '', 'Kontrollrechnung Steuererstattung'));
    card.appendChild(createUiEl('p', 'small muted', 'Käufe aus der Steuererstattung mindern nur den gebundenen Rest. Sie werden als Haushaltsnachweis geführt und nicht als Kontobuchung.'));
    const table = document.createElement('table');
    table.className = 'list-table compact-table';
    table.innerHTML = '<thead><tr><th>Erstattung</th><th>Eingang</th><th>Käufe</th><th>Rest</th><th>Gebundener Rest</th><th>Hinweis</th></tr></thead>';
    const tbody = document.createElement('tbody');
    const suspiciousIds = new Set(getTaxRefundSuspiciousEntries(year).map((entry) => entry.refund && entry.refund.id).filter(Boolean));
    if (!summary.refunds.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="6" class="muted">Keine Erstattung für dieses Steuerjahr eingetragen.</td>';
      tbody.appendChild(tr);
    } else {
      summary.refunds.forEach((refund) => {
        const spent = (refund.purchases || []).reduce((sum, purchase) => sum + Number(purchase.amount || 0), 0);
        const remaining = Number(refund.amount || 0) - spent;
        const bound = Math.max(remaining, 0);
        const hint = suspiciousIds.has(refund.id)
          ? 'kleiner Einzelbetrag wirkt doppelt'
          : (remaining < -0.005 ? 'mehr ausgegeben als Eingang' : 'Haushaltsnachweis');
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${refund.receivedDate || 'ohne Datum'}<div class="small muted">${refund.note || `Steuerjahr ${refund.year}`}</div></td><td>${euro(Number(refund.amount || 0))}</td><td>${euro(spent)}</td><td class="${remaining < -0.005 ? 'danger-text' : 'success-text'}">${euro(remaining)}</td><td>${euro(bound)}</td><td>${hint}</td>`;
        tbody.appendChild(tr);
      });
      const total = document.createElement('tr');
      total.innerHTML = `<td><strong>Summe ${year}</strong></td><td><strong>${euro(summary.received)}</strong></td><td><strong>${euro(summary.spent)}</strong></td><td><strong>${euro(summary.remaining)}</strong></td><td><strong>${euro(summary.boundRemaining)}</strong></td><td>${summary.boundRemaining > 0.005 ? 'Rest bleibt gebunden' : 'kein gebundener Rest'}</td>`;
      tbody.appendChild(total);
    }
    table.appendChild(tbody);
    card.appendChild(table);
    return card;
  }

  function showTaxRefundEditor(refund) {
    normalizeAllTaxRefunds();
    const isNew = !refund;
    const item = refund || { id: generateId(), year: String(new Date().getFullYear()), amount: 0, receivedDate: '', note: '', purchases: [] };
    const content = document.createElement('div');
    content.className = 'modal-form';

    const row = document.createElement('div');
    row.className = 'row';
    const yearInput = document.createElement('input');
    yearInput.type = 'number';
    yearInput.step = '1';
    yearInput.value = item.year || String(new Date().getFullYear());
    const amountInput = document.createElement('input');
    amountInput.type = 'text';
    amountInput.inputMode = 'decimal';
    amountInput.value = formatNumberInput(item.amount);
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = item.receivedDate || '';
    row.appendChild(createLabelInput('Jahr', yearInput));
    row.appendChild(createLabelInput('Erhaltene Erstattung', amountInput));
    row.appendChild(createLabelInput('Eingang am', dateInput));
    content.appendChild(row);

    const noteInput = document.createElement('textarea');
    noteInput.rows = 3;
    noteInput.value = item.note || '';
    noteInput.placeholder = 'z. B. Steuer 2025, Rest bleibt gebunden ...';
    content.appendChild(createLabelInput('Notiz', noteInput));

    showModal(isNew ? 'Steuererstattung eintragen' : 'Steuererstattung bearbeiten', content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      {
        label: 'Speichern',
        className: 'primary',
        onClick: (close) => {
          const year = Number(yearInput.value || 0);
          const amount = parseMoneyInput(amountInput.value);
          if (!Number.isFinite(year) || year < 2000 || year > 2100) return alert('Bitte ein gültiges Jahr eingeben.');
          if (!Number.isFinite(amount) || amount < 0) return alert('Bitte einen gültigen Betrag eingeben.');
          item.year = String(Math.trunc(year));
          item.amount = amount;
          item.receivedDate = dateInput.value || '';
          item.note = noteInput.value || '';
          if (isNew) state.taxRefunds.push(item);
          selectedTaxRefundYear = item.year;
          normalizeAllTaxRefunds();
          addChangeLog('Steuererstattung', `${isNew ? 'Erstattung eingetragen' : 'Erstattung geändert'}: ${item.year} / ${euro(amount)}`, currentMonth);
          saveState();
          render();
          close();
        }
      }
    ]);
  }

  function showTaxPurchaseEditor(refund, purchase) {
    normalizeTaxRefund(refund);
    const isNew = !purchase;
    const item = purchase || { id: generateId(), name: '', amount: 0, date: '', note: '' };
    const content = document.createElement('div');
    content.className = 'modal-form';

    const row = document.createElement('div');
    row.className = 'row';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = item.name || '';
    nameInput.placeholder = 'z. B. neue Reifen, Waschmaschine, Schuldenzahlung ...';
    const amountInput = document.createElement('input');
    amountInput.type = 'text';
    amountInput.inputMode = 'decimal';
    amountInput.value = formatNumberInput(item.amount);
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = item.date || '';
    row.appendChild(createLabelInput('Gekauft / bezahlt', nameInput));
    row.appendChild(createLabelInput('Betrag', amountInput));
    row.appendChild(createLabelInput('Datum', dateInput));
    content.appendChild(row);

    const noteInput = document.createElement('textarea');
    noteInput.rows = 3;
    noteInput.value = item.note || '';
    noteInput.placeholder = 'optional: warum gekauft, Rechnung, Hinweis ...';
    content.appendChild(createLabelInput('Notiz', noteInput));

    showModal(isNew ? 'Kauf aus Steuererstattung eintragen' : 'Kauf bearbeiten', content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      {
        label: 'Speichern',
        className: 'primary',
        onClick: (close) => {
          const name = nameInput.value.trim();
          const amount = parseMoneyInput(amountInput.value);
          if (!name) return alert('Bitte eine Bezeichnung eingeben.');
          if (!Number.isFinite(amount) || amount < 0) return alert('Bitte einen gültigen Betrag eingeben.');
          item.name = name;
          item.amount = amount;
          item.date = dateInput.value || '';
          item.note = noteInput.value || '';
          if (isNew) refund.purchases.push(item);
          normalizeAllTaxRefunds();
          addChangeLog('Steuererstattung', `${isNew ? 'Kauf eingetragen' : 'Kauf geändert'}: ${name} / ${euro(amount)} – als Verwendung dokumentiert`, currentMonth);
          saveState();
          render();
          close();
        }
      }
    ]);
  }

  function renderTaxRefund() {
    normalizeAllTaxRefunds();
    taxRefundSection.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'section-heading';
    const title = document.createElement('h2');
    title.textContent = 'Steuererstattung';
    const sub = document.createElement('p');
    sub.textContent = 'Hier trägst du ein, was ihr pro Jahr vom Finanzamt erhalten habt und wofür ihr das Geld verwendet habt.';
    header.appendChild(title);
    header.appendChild(sub);
    taxRefundSection.appendChild(header);

    const years = Array.from(new Set((state.taxRefunds || []).map((r) => String(r.year))));
    if (!years.length) years.push(String(new Date().getFullYear()));
    years.sort((a, b) => b.localeCompare(a));
    if (!years.includes(selectedTaxRefundYear)) selectedTaxRefundYear = years[0];

    const summaryFilter = document.createElement('div');
    summaryFilter.className = 'filter-bar tax-refund-year-filter';
    const yearSelect = document.createElement('select');
    yearSelect.setAttribute('aria-label', 'Steuerjahr für Summen auswählen');
    years.forEach((year) => {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = `Steuerjahr ${year}`;
      if (year === selectedTaxRefundYear) option.selected = true;
      yearSelect.appendChild(option);
    });
    yearSelect.addEventListener('change', () => {
      selectedTaxRefundYear = yearSelect.value;
      render();
    });
    const filterHint = document.createElement('span');
    filterHint.className = 'small muted';
    filterHint.textContent = 'Summen für dieses Steuerjahr anzeigen';
    summaryFilter.appendChild(yearSelect);
    summaryFilter.appendChild(filterHint);
    taxRefundSection.appendChild(summaryFilter);

    const summary = getTaxRefundSummary(selectedTaxRefundYear);
    taxRefundSection.appendChild(createSummaryMetrics([
      { label: `Erhalten ${selectedTaxRefundYear}`, value: euro(summary.received), hint: 'Summe aller eingetragenen Erstattungen' },
      { label: 'Davon gekauft / bezahlt', value: euro(summary.spent), hint: 'Alle eingetragenen Käufe' },
      { label: 'Rest gebunden', value: euro(summary.remaining), kind: summary.remaining < -0.005 ? 'danger' : 'success', hint: 'Erstattung minus Käufe' },
      { label: 'Gebundener Rest', value: euro(summary.boundRemaining), kind: summary.boundRemaining > 0.005 ? 'warning' : 'success', hint: 'Negative Einzelreste werden nicht gegengerechnet' },
      { label: 'Käufe', value: `${summary.purchases}`, hint: `aus ${summary.refunds.length} Erstattung(en)` }
    ]));
    const suspiciousRefunds = getTaxRefundSuspiciousEntries(selectedTaxRefundYear);
    if (suspiciousRefunds.length) {
      const warn = createUiEl('div', 'notice warning tax-refund-warning');
      warn.appendChild(createUiEl('strong', '', 'Steuererstattung prüfen'));
      const list = createUiEl('ul');
      suspiciousRefunds.forEach((entry) => {
        const li = createUiEl('li', '', `${euro(entry.amount)} steht als eigene Erstattung ohne Käufe drin und derselbe Betrag kommt als Kauf „${entry.matchingPurchase.name || 'ohne Namen'}“ vor. Wenn das kein echter zweiter Eingang war, lösche oder bearbeite die kleine Erstattung.`);
        list.appendChild(li);
      });
      warn.appendChild(list);
      taxRefundSection.appendChild(warn);
    }
    taxRefundSection.appendChild(renderTaxRefundControlCard(summary, selectedTaxRefundYear));
    taxRefundSection.appendChild(renderTaxRefundPotCard());

    const actions = document.createElement('div');
    actions.className = 'action-bar';
    const addBtn = document.createElement('button');
    addBtn.className = 'primary';
    addBtn.textContent = '+ Steuererstattung eintragen';
    addBtn.addEventListener('click', () => showTaxRefundEditor(null));
    actions.appendChild(addBtn);
    taxRefundSection.appendChild(actions);

    if (!state.taxRefunds.length) {
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.innerHTML = '<h3>Noch keine Steuererstattung eingetragen</h3><p class="small muted">Sobald ihr eine Erstattung bekommt, kannst du sie hier erfassen und danach die Käufe daraus dokumentieren.</p>';
      taxRefundSection.appendChild(empty);
      return;
    }

    state.taxRefunds.forEach((refund) => {
      normalizeTaxRefund(refund);
      const spent = refund.purchases.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const remaining = Number(refund.amount || 0) - spent;
      const card = document.createElement('div');
      card.className = 'card tax-refund-card';
      const top = document.createElement('div');
      top.className = 'card-header-row';
      const h = document.createElement('h3');
      h.textContent = `Steuererstattung ${refund.year}`;
      const btns = document.createElement('div');
      btns.className = 'button-row';
      const buyBtn = document.createElement('button');
      buyBtn.textContent = '+ Kauf';
      buyBtn.className = 'secondary';
      buyBtn.addEventListener('click', () => showTaxPurchaseEditor(refund, null));
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Bearbeiten';
      editBtn.className = 'secondary';
      editBtn.addEventListener('click', () => showTaxRefundEditor(refund));
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Löschen';
      delBtn.className = 'danger';
      delBtn.addEventListener('click', () => {
        if (confirm('Steuererstattung mit allen Käufen löschen?')) {
          removeTaxRefundAccountBooking(refund);
          state.taxRefunds = state.taxRefunds.filter((x) => x.id !== refund.id);
          addChangeLog('Steuererstattung', `Erstattung ${refund.year} gelöscht`, currentMonth);
          saveState();
          render();
        }
      });
      btns.appendChild(createActionMenu([
        { label: '+ Kauf', className: 'secondary', onClick: () => showTaxPurchaseEditor(refund, null) },
        { label: 'Bearbeiten', className: 'secondary', onClick: () => showTaxRefundEditor(refund) },
        { label: 'Löschen', className: 'danger', onClick: () => { if (confirm('Steuererstattung mit allen Käufen löschen?')) { removeTaxRefundAccountBooking(refund); state.taxRefunds = state.taxRefunds.filter((x) => x.id !== refund.id); addChangeLog('Steuererstattung', `Erstattung ${refund.year} gelöscht`, currentMonth); saveState(); render(); } } }
      ]));
      top.appendChild(h); top.appendChild(btns); card.appendChild(top);
      card.appendChild(createSummaryMetrics([
        { label: 'Erhalten', value: euro(Number(refund.amount || 0)), hint: refund.receivedDate ? `Eingang: ${refund.receivedDate}` : 'Eingang nicht gesetzt' },
        { label: 'Ausgegeben', value: euro(spent), hint: `${refund.purchases.length} Kauf/Käufe · reduzieren nur den gebundenen Rest` },
        { label: 'Rest gebunden', value: euro(remaining), kind: remaining < -0.005 ? 'danger' : 'success' }
      ]));
      if (refund.note) {
        const note = document.createElement('p'); note.className = 'small muted'; note.textContent = refund.note; card.appendChild(note);
      }
      const table = document.createElement('table');
      table.className = 'list-table';
      table.innerHTML = '<thead><tr><th>Datum · neueste zuerst</th><th>Gekauft / bezahlt</th><th>Betrag</th><th>Notiz</th><th>Aktion</th></tr></thead>';
      const tbody = document.createElement('tbody');
      if (!refund.purchases.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="5" class="muted">Noch keine Käufe eingetragen.</td>';
        tbody.appendChild(tr);
      } else {
        refund.purchases.forEach((purchase) => {
          const tr = document.createElement('tr');
          const dateTd = document.createElement('td'); dateTd.textContent = purchase.date || '—';
          const nameTd = document.createElement('td'); nameTd.textContent = purchase.name || '—';
          const amountTd = document.createElement('td'); amountTd.textContent = euro(Number(purchase.amount || 0));
          const noteTd = document.createElement('td'); noteTd.textContent = `${purchase.note || ''}${purchase.transactionId ? (purchase.note ? ' · ' : '') + 'Historiennachweis vorhanden' : ''}`;
          const actionTd = document.createElement('td');
          const editPurchase = document.createElement('button'); editPurchase.className = 'secondary'; editPurchase.textContent = 'Bearbeiten'; editPurchase.addEventListener('click', () => showTaxPurchaseEditor(refund, purchase));
          const deletePurchase = document.createElement('button'); deletePurchase.className = 'danger'; deletePurchase.textContent = 'Löschen'; deletePurchase.addEventListener('click', () => {
            if (confirm('Kauf löschen?')) {
              removeTaxRefundPurchaseBooking(refund, purchase);
              refund.purchases = refund.purchases.filter((x) => x.id !== purchase.id);
              normalizeAllTaxRefunds();
              addChangeLog('Steuererstattung', `Kauf gelöscht: ${purchase.name}`, currentMonth);
              saveState(); render();
            }
          });
          actionTd.appendChild(createActionMenu([
            { label: 'Zu Sonstige Ausgaben verschieben', className: 'primary', onClick: () => showTaxPurchaseToBufferModal(refund, purchase) },
            { label: 'Bearbeiten', className: 'secondary', onClick: () => showTaxPurchaseEditor(refund, purchase) },
            { label: 'Löschen', className: 'danger', onClick: () => { if (confirm('Kauf löschen?')) { removeTaxRefundPurchaseBooking(refund, purchase); refund.purchases = refund.purchases.filter((x) => x.id !== purchase.id); normalizeAllTaxRefunds(); addChangeLog('Steuererstattung', `Kauf gelöscht: ${purchase.name}`, currentMonth); saveState(); render(); } } }
          ]));
          tr.appendChild(dateTd); tr.appendChild(nameTd); tr.appendChild(amountTd); tr.appendChild(noteTd); tr.appendChild(actionTd);
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody); card.appendChild(table); taxRefundSection.appendChild(card);
    });
  }


  function getBrowserStorageInfo() {
    try {
      const testKey = 'budgetStateStorageTest';
      localStorage.setItem(testKey, 'ok');
      localStorage.removeItem(testKey);
      const stable = localStorage.getItem('budgetStateStable');
      const auto = localStorage.getItem('budgetStateAutoBackup');
      const current = localStorage.getItem(CURRENT_VERSION_STORAGE_KEY);
      const last = localStorage.getItem('budgetStateLastSavedAt') || '';
      return { ok: true, stable: !!stable, auto: !!auto, current: !!current, last };
    } catch (err) {
      return { ok: false, stable: false, auto: false, current: false, last: '', error: err && err.message ? err.message : String(err) };
    }
  }

  function renderSave() {
    saveSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';

    const h2 = document.createElement('h2');
    h2.textContent = 'Backup';
    card.appendChild(h2);

    const intro = document.createElement('p');
    intro.textContent = 'Deine Daten werden bei jeder Änderung gespeichert. Zusätzlich legt die App einmal täglich eine unabhängige Sicherung im Browser an. Eine Sicherungsdatei für den PC kannst du jederzeit zusätzlich herunterladen.';
    card.appendChild(intro);

    const storageInfo = getBrowserStorageInfo();
    const storageNotice = document.createElement('div');
    storageNotice.className = storageInfo.ok ? 'notice success' : 'notice danger';
    storageNotice.innerHTML = storageInfo.ok
      ? `<strong>Laufendes Speichern aktiv:</strong> Änderungen werden sofort in diesem Browser gesichert und von neuen Versionen automatisch übernommen.${storageInfo.last ? '<br><span class="small muted">Zuletzt gespeichert: ' + new Date(storageInfo.last).toLocaleString('de-DE') + '</span>' : ''}`
      : `<strong>Browser-Speicher nicht verfügbar:</strong> Der Browser blockiert localStorage. Bitte Sicherung herunterladen und Browser-/Privatmodus prüfen.`;
    card.appendChild(storageNotice);

    normalizeAppMeta();
    state.appMeta.includeApiKeyInBackup = true;

    const apiInfo = document.createElement('div');
    apiInfo.className = 'notice success';
    apiInfo.textContent = 'Vollständige Sicherung: Der Tank-API-Key wird in den automatischen und heruntergeladenen Sicherungen mitgesichert.';
    card.appendChild(apiInfo);

    const automaticCard = createUiEl('div', 'sub-card automatic-browser-backup-card');
    const automaticHead = createUiEl('div', 'compact-section-head');
    automaticHead.appendChild(createUiEl('h3', '', 'Automatische Browser-Sicherung'));
    const automaticSupported = 'indexedDB' in window;
    automaticHead.appendChild(createUiEl('span', automaticSupported ? 'pill success' : 'pill danger', automaticSupported ? 'Aktiv' : 'Nicht verfügbar'));
    automaticCard.appendChild(automaticHead);

    const lastAutomaticDate = state.appMeta.lastAutomaticBrowserBackupAt ? new Date(state.appMeta.lastAutomaticBrowserBackupAt) : null;
    const lastAutomaticValid = lastAutomaticDate && !Number.isNaN(lastAutomaticDate.getTime());
    automaticCard.appendChild(createSummaryMetrics([
      { label: 'Letzte automatische Sicherung', value: lastAutomaticValid ? lastAutomaticDate.toLocaleString('de-DE') : 'wird gerade angelegt', kind: lastAutomaticValid ? 'success' : 'warning' },
      { label: 'Aufbewahrung', value: `Bis zu ${AUTOMATIC_BROWSER_BACKUP_RETENTION} Sicherungen`, hint: 'Ältere Stände werden automatisch aufgeräumt.' },
      { label: 'Speicherort', value: 'Dieser Browser auf diesem PC', hint: 'Funktioniert auch ohne Zugriff auf einen PC-Ordner.' }
    ]));

    const automaticActions = createUiEl('div', 'row automatic-backup-actions');
    const automaticNowButton = document.createElement('button');
    automaticNowButton.type = 'button';
    automaticNowButton.className = 'success';
    automaticNowButton.textContent = 'Jetzt automatisch sichern';
    automaticNowButton.disabled = !automaticSupported;
    automaticNowButton.addEventListener('click', async () => {
      automaticNowButton.disabled = true;
      automaticNowButton.textContent = 'Sicherung läuft …';
      try {
        await createAutomaticBrowserBackup({ force: true });
        render();
      } catch (err) {
        alert('Automatische Sicherung nicht möglich: ' + (err && err.message ? err.message : String(err)));
        automaticNowButton.disabled = false;
        automaticNowButton.textContent = 'Jetzt automatisch sichern';
      }
    });
    automaticActions.appendChild(automaticNowButton);
    automaticCard.appendChild(automaticActions);

    const automaticHistory = document.createElement('details');
    automaticHistory.className = 'automatic-backup-history';
    const automaticHistorySummary = document.createElement('summary');
    automaticHistorySummary.textContent = 'Frühere automatische Sicherung wiederherstellen';
    automaticHistory.appendChild(automaticHistorySummary);
    const automaticHistoryInfo = createUiEl('p', 'small muted', 'Wähle einen Stand aus. Vor der Wiederherstellung sichert die App den jetzigen Stand noch einmal.');
    automaticHistory.appendChild(automaticHistoryInfo);
    const automaticHistoryRow = createUiEl('div', 'row automatic-backup-history-row');
    const automaticHistorySelect = document.createElement('select');
    automaticHistorySelect.setAttribute('aria-label', 'Automatische Sicherung auswählen');
    automaticHistorySelect.disabled = true;
    automaticHistorySelect.appendChild(new Option('Sicherungen werden geladen …', ''));
    automaticHistoryRow.appendChild(automaticHistorySelect);
    const automaticRestoreButton = document.createElement('button');
    automaticRestoreButton.type = 'button';
    automaticRestoreButton.className = 'secondary';
    automaticRestoreButton.textContent = 'Ausgewählten Stand laden';
    automaticRestoreButton.disabled = true;
    automaticHistoryRow.appendChild(automaticRestoreButton);
    automaticHistory.appendChild(automaticHistoryRow);
    automaticCard.appendChild(automaticHistory);
    card.appendChild(automaticCard);

    let automaticBackupRows = [];
    if (automaticSupported) {
      listAutomaticBrowserBackups().then((rows) => {
        if (!automaticHistorySelect.isConnected) return;
        automaticBackupRows = rows;
        automaticHistorySelect.innerHTML = '';
        if (!rows.length) {
          automaticHistorySelect.appendChild(new Option('Noch keine Sicherung vorhanden', ''));
          return;
        }
        rows.forEach((entry) => {
          const created = new Date(entry.createdAt);
          const dateLabel = Number.isNaN(created.getTime()) ? String(entry.createdAt || '') : created.toLocaleString('de-DE');
          automaticHistorySelect.appendChild(new Option(`${entry.label || 'Automatische Sicherung'} · ${dateLabel}`, entry.id));
        });
        automaticHistorySelect.disabled = false;
        automaticRestoreButton.disabled = false;
      }).catch((err) => {
        if (!automaticHistorySelect.isConnected) return;
        automaticHistorySelect.innerHTML = '';
        automaticHistorySelect.appendChild(new Option('Sicherungen konnten nicht geladen werden', ''));
        console.warn('Automatische Sicherungen konnten nicht angezeigt werden', err);
      });
    }

    automaticRestoreButton.addEventListener('click', async () => {
      const selected = automaticBackupRows.find((entry) => entry.id === automaticHistorySelect.value);
      if (!selected || !selected.payload) return;
      const created = new Date(selected.createdAt);
      const dateLabel = Number.isNaN(created.getTime()) ? 'dem ausgewählten Zeitpunkt' : created.toLocaleString('de-DE');
      if (!confirm(`Den Haushaltsplaner auf den Stand vom ${dateLabel} zurücksetzen? Der jetzige Stand wird vorher automatisch gesichert.`)) return;
      automaticRestoreButton.disabled = true;
      automaticRestoreButton.textContent = 'Stand wird geladen …';
      try {
        const safetyTimestamp = new Date().toISOString();
        await createAutomaticBrowserBackup({
          force: true,
          id: `vor-wiederherstellung-${safetyTimestamp}`,
          label: 'Stand vor Wiederherstellung'
        });
        JSON.parse(selected.payload);
        writeStatePayloadToStorage(selected.payload);
        localStorage.setItem('budgetStateLastSavedAt', new Date().toISOString());
        window.location.reload();
      } catch (err) {
        alert('Die automatische Sicherung konnte nicht wiederhergestellt werden: ' + (err && err.message ? err.message : String(err)));
        automaticRestoreButton.disabled = false;
        automaticRestoreButton.textContent = 'Ausgewählten Stand laden';
      }
    });

    const supportsExternalFolderBackup = typeof window.showDirectoryPicker === 'function';
    const externalCard = createUiEl('div', 'sub-card external-backup-card');
    const externalHead = createUiEl('div', 'compact-section-head');
    externalHead.appendChild(createUiEl('h3', '', 'Automatische PC-Sicherung'));
    const externalReady = !!state.appMeta.externalBackupFolderName;
    externalHead.appendChild(createUiEl('span', externalReady ? 'pill success' : 'pill warning', externalReady ? 'Ordner verbunden' : 'Noch einrichten'));
    externalCard.appendChild(externalHead);

    const lastExternalDate = state.appMeta.lastExternalBackupAt ? new Date(state.appMeta.lastExternalBackupAt) : null;
    const lastExternalLabel = lastExternalDate && !Number.isNaN(lastExternalDate.getTime())
      ? lastExternalDate.toLocaleString('de-DE')
      : 'noch keine externe Sicherung';
    externalCard.appendChild(createSummaryMetrics([
      { label: 'Sicherungsordner', value: externalReady ? escapeHtml(state.appMeta.externalBackupFolderName) : 'Nicht ausgewählt', kind: externalReady ? 'success' : 'warning' },
      { label: 'Letzte externe Sicherung', value: lastExternalLabel, kind: lastExternalDate ? 'success' : 'warning' },
      { label: 'Datei', value: EXTERNAL_BACKUP_FILENAME, hint: 'Wird täglich mit dem aktuellen Stand überschrieben.' }
    ]));

    const externalActions = createUiEl('div', 'row external-backup-actions');
    const folderButton = document.createElement('button');
    folderButton.type = 'button';
    folderButton.className = 'primary';
    folderButton.textContent = externalReady ? 'Anderen Sicherungsordner wählen' : 'Sicherungsordner auswählen';
    folderButton.disabled = !supportsExternalFolderBackup;
    folderButton.addEventListener('click', async () => {
      folderButton.disabled = true;
      const originalText = folderButton.textContent;
      folderButton.textContent = 'Ordner wird verbunden …';
      try {
        const handle = await window.showDirectoryPicker({ id: 'haushaltsplaner-backup', mode: 'readwrite' });
        await storeExternalBackupDirectoryHandle(handle);
        state.appMeta.externalBackupFolderName = String(handle.name || 'Sicherungsordner');
        const result = await writeExternalBackup({ handle, requestPermission: true });
        if (!result.ok) throw new Error('Der Ordner wurde nicht für Schreibzugriff freigegeben.');
        addChangeLog('Sichern', `Automatische PC-Sicherung im Ordner „${result.folderName}“ eingerichtet.`, currentMonth);
        saveState();
        render();
      } catch (err) {
        if (String(err && err.name) !== 'AbortError') {
          alert('Der Sicherungsordner konnte nicht verbunden werden: ' + (err && err.message ? err.message : String(err)));
        }
        folderButton.disabled = false;
        folderButton.textContent = originalText;
      }
    });
    externalActions.appendChild(folderButton);

    if (externalReady) {
      const nowButton = document.createElement('button');
      nowButton.type = 'button';
      nowButton.className = 'success';
      nowButton.textContent = 'Jetzt extern sichern';
      nowButton.addEventListener('click', async () => {
        nowButton.disabled = true;
        nowButton.textContent = 'Sicherung läuft …';
        try {
          let handle = cachedExternalBackupDirectoryHandle;
          if (!handle) {
            handle = await window.showDirectoryPicker({ id: 'haushaltsplaner-backup', mode: 'readwrite' });
            await storeExternalBackupDirectoryHandle(handle);
          }
          const result = await writeExternalBackup({ handle, requestPermission: true });
          if (!result.ok) throw new Error('Bitte die Freigabe des Sicherungsordners erneuern.');
          saveState();
          render();
        } catch (err) {
          alert('Externe Sicherung nicht möglich: ' + (err && err.message ? err.message : String(err)));
          nowButton.disabled = false;
          nowButton.textContent = 'Jetzt extern sichern';
        }
      });
      externalActions.appendChild(nowButton);

      const disconnectButton = document.createElement('button');
      disconnectButton.type = 'button';
      disconnectButton.className = 'secondary';
      disconnectButton.textContent = 'Ordner trennen';
      disconnectButton.addEventListener('click', async () => {
        if (!confirm('Automatische PC-Sicherung trennen? Bereits gespeicherte Sicherungsdateien bleiben im Ordner erhalten.')) return;
        try { await removeExternalBackupDirectoryHandle(); } catch (err) {}
        state.appMeta.externalBackupFolderName = '';
        state.appMeta.lastExternalBackupAt = '';
        addChangeLog('Sichern', 'Automatische PC-Sicherung getrennt.', currentMonth);
        saveState();
        render();
      });
      externalActions.appendChild(disconnectButton);
    }
    externalCard.appendChild(externalActions);

    if (supportsExternalFolderBackup) {
      const externalDetails = document.createElement('details');
      externalDetails.className = 'optional-external-backup';
      externalDetails.open = externalReady;
      const externalSummary = document.createElement('summary');
      externalSummary.textContent = externalReady
        ? `Zusätzlicher Sicherungsordner: ${state.appMeta.externalBackupFolderName}`
        : 'Optional: zusätzlichen Sicherungsordner auf dem PC verbinden';
      externalDetails.appendChild(externalSummary);
      externalDetails.appendChild(externalCard);
      card.appendChild(externalDetails);
    } else {
      const folderInfo = createUiEl('div', 'notice info');
      folderInfo.innerHTML = '<strong>Zusätzliche Datei auf dem PC:</strong> Die automatische Browser-Sicherung oben ist aktiv. Für eine weitere Sicherung außerhalb des Browsers kannst du unten jederzeit eine Datei herunterladen.';
      card.appendChild(folderInfo);
    }

    const totalPosts = (state.commonCosts?.length || 0) + (state.personalCosts?.length || 0) + (state.bufferExpenses?.length || 0);
    card.appendChild(createSummaryMetrics([
      { label: 'Personen', value: String(state.persons.length) },
      { label: 'Posten gesamt', value: String(totalPosts) },
      { label: 'Schulden', value: String(state.debts.length) },
      { label: 'Töpfe', value: String(state.pots.length) },
      { label: 'Aktiver Monat', value: formatMonthLabel(currentMonth) },
      { label: 'Zuletzt im Browser gespeichert', value: localStorage.getItem('budgetStateLastSavedAt') ? new Date(localStorage.getItem('budgetStateLastSavedAt')).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-' }
    ]));

    const actionRow = document.createElement('div');
    actionRow.className = 'row';

    let backupDownloadInProgress = false;
    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Sicherung als Datei herunterladen';
    exportBtn.className = 'primary';
    exportBtn.addEventListener('click', () => {
      if (backupDownloadInProgress) return;
      backupDownloadInProgress = true;
      exportBtn.disabled = true;
      const oldText = exportBtn.textContent;
      exportBtn.textContent = 'Sicherung wird erstellt...';
      try {
        state.appMeta.includeApiKeyInBackup = true;
        const { blob, filename } = createBackupFile();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } catch (err) {
        alert('Fehler beim Backup: ' + err.message);
      } finally {
        setTimeout(() => {
          backupDownloadInProgress = false;
          exportBtn.disabled = false;
          exportBtn.textContent = oldText;
        }, 1200);
      }
    });

    actionRow.appendChild(exportBtn);
    card.appendChild(actionRow);

    const restoreCard = document.createElement('div');
    restoreCard.className = 'card';
    const restoreTitle = document.createElement('h3');
    restoreTitle.textContent = 'Backup wiederherstellen';
    restoreCard.appendChild(restoreTitle);

    const restoreInfo = document.createElement('p');
    restoreInfo.textContent = 'Wähle deine JSON-Sicherung aus und starte den Import. Alte, nicht mehr benötigte Versionskopien werden automatisch aufgeräumt; dein bisheriger Stand bleibt zusätzlich als Rückfall-Sicherung erhalten.';
    restoreCard.appendChild(restoreInfo);

    const fileRow = document.createElement('div');
    fileRow.className = 'row';

    const fileWrap = document.createElement('div');
    const restoreLabel = document.createElement('label');
    restoreLabel.textContent = 'Backup-Datei auswählen';
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json,application/json';
    importInput.id = 'backupFileInput';
    restoreLabel.htmlFor = importInput.id;
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
        }, 12000);
      }
    };

    if (pendingBackupImportNotice) {
      const notice = pendingBackupImportNotice;
      pendingBackupImportNotice = null;
      setInlineStatus(notice.message, notice.kind);
    }

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
        let previousStatePayload = '';
        let importStarted = false;
        let importCommitted = false;
        const localAutomaticBackupAt = state.appMeta && typeof state.appMeta.lastAutomaticBrowserBackupAt === 'string'
          ? state.appMeta.lastAutomaticBrowserBackupAt
          : '';
        const resetImportButton = () => {
          importBtn.disabled = false;
          importBtn.textContent = 'Backup jetzt importieren';
        };
        try {
          const rawText = String(ev.target && ev.target.result ? ev.target.result : '').replace(/^\uFEFF/, '').trim();
          if (!rawText) throw new Error('Die Datei ist leer.');
          if (rawText.slice(0, 2) === 'PK') {
            throw new Error('Das ist vermutlich eine ZIP-Datei. Bitte die JSON-Sicherung auswählen, nicht docs.zip.');
          }
          const data = JSON.parse(rawText);
          const importedState = data && data.state && typeof data.state === 'object' ? data.state : data;
          const hasCoreData = importedState && typeof importedState === 'object'
            && Array.isArray(importedState.persons)
            && Array.isArray(importedState.commonCosts)
            && Array.isArray(importedState.personalCosts)
            && Array.isArray(importedState.debts);
          if (!hasCoreData) {
            throw new Error('Ungültiges Datenformat. In der Datei fehlen Personen, gemeinsame Kosten, persönliche Ausgaben oder Schulden.');
          }

          // Wichtig: Import zuerst vollständig übernehmen und dann erst normalisieren.
          // Dadurch werden ältere Sicherungen nicht abgelehnt, nur weil neuere Felder fehlen.
          const safeImportedState = {};
          Object.keys(importedState).forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(defaultState, key)) {
              safeImportedState[key] = importedState[key];
            }
          });
          previousStatePayload = JSON.stringify(state);
          cleanupLegacyStateStorageKeys();
          try {
            localStorage.setItem('budgetStateBeforeImport', previousStatePayload);
            localStorage.setItem('budgetStateBeforeImportAt', new Date().toISOString());
          } catch (recoveryErr) {
            console.warn('Rückfall-Sicherung vor dem Import konnte nicht gespeichert werden', recoveryErr);
          }
          state = Object.assign(JSON.parse(JSON.stringify(defaultState)), safeImportedState);
          importStarted = true;
          sanitizeStateTextValues(state);
          const importedSelectedMonth = state.appMeta && isMonthKey(state.appMeta.selectedMonth) ? state.appMeta.selectedMonth : '';
          const importWarningsInternal = [];
          const runImportStep = (label, fn) => {
            try { fn(); } catch (stepErr) {
              console.warn('Import-Schritt übersprungen:', label, stepErr);
              importWarningsInternal.push(label);
            }
          };

          runImportStep('Grundfelder', () => {
            if (!state.reservesSavedMonths) state.reservesSavedMonths = [];
            if (!state.reserveItemSaved) state.reserveItemSaved = {};
            if (!state.tankCalc) state.tankCalc = JSON.parse(JSON.stringify(defaultState.tankCalc));
            if (!Array.isArray(state.bufferExpenses)) state.bufferExpenses = [];
            if (!Array.isArray(state.taxRefunds)) state.taxRefunds = [];
            if (!Array.isArray(state.groceryExpenses)) state.groceryExpenses = [];
            if (!state.monthlyClosings || typeof state.monthlyClosings !== 'object') state.monthlyClosings = {};
            if (!Array.isArray(state.changeLog)) state.changeLog = [];
            if (!state.appMeta || typeof state.appMeta !== 'object') state.appMeta = JSON.parse(JSON.stringify(defaultState.appMeta));
          });
          runImportStep('Steuererstattung', () => normalizeAllTaxRefunds());
          runImportStep('Einkaufsgeld', () => normalizeGroceryExpenses());
          runImportStep('Tankdaten', () => normalizeTankClosedMonths());
          runImportStep('Aufstockungen', () => normalizeBudgetTopUpsConfig());
          runImportStep('Gemeinschaftskonto', () => normalizeCommonAccountConfig());
          runImportStep('Konten', () => normalizeAccountsConfig());
          runImportStep('Umbuchungen', () => normalizeAccountTransfersConfig());
          runImportStep('Umbuchungsvorlagen', () => normalizeAccountTransferTemplatesConfig());
          runImportStep('Rücklagenziele', () => normalizeSavingsGoalsConfig());
          runImportStep('App-Meta', () => normalizeAppMeta());
          if (localAutomaticBackupAt) state.appMeta.lastAutomaticBrowserBackupAt = localAutomaticBackupAt;
          runImportStep('Kreiskasse Migration', () => migrateKreiskasseToBennyPersonal());
          runImportStep('Kreiskasse Lohnabzug', () => migrateKreiskassePayrollPayment());
          runImportStep('Rücklagen-Sync', () => syncAllReserveSelectionsToPots());
          runImportStep('Personen', () => normalizeAllPersonConfigs());
          runImportStep('Posten', () => normalizeAllPostConfigs());
          runImportStep('Einkaufsgeld-Ziel', () => ensureGroceryMoneyFromJune2026());
          runImportStep('Schulden', () => normalizeAllDebtConfigs());
          runImportStep('Schulden-Verknüpfungen', () => autoLinkMatchingDebtPosts());
          runImportStep('Mai-Nachweise', () => migrateConfirmedMayDebtProofsV206());
          runImportStep('Monatsanteile fixieren', () => migrateCommonContributionPaymentsV221());
          runImportStep('Konten-Migration', () => migrateAccountLedgerV213());

          const targetMonth = importedSelectedMonth || (state.appMeta && isMonthKey(state.appMeta.selectedMonth) ? state.appMeta.selectedMonth : actualMonthKey);
          setCurrentMonth(targetMonth, false);
          if (!state.appMeta || typeof state.appMeta !== 'object') state.appMeta = {};
          state.appMeta.selectedMonth = currentMonth;
          if (!isMonthKey(state.appMeta.lastAutoMonthCheck)) state.appMeta.lastAutoMonthCheck = actualMonthKey;
          monthList = getSelectableMonths(currentMonth);
          runImportStep('Raten-Sync', () => syncAllLinkedDebtRatesFromPosts(currentMonth, 36, { silent: true }));

          const saved = saveState();
          if (!saved) throw new Error('Die Daten konnten nach dem Import nicht gespeichert werden.');
          importCommitted = true;
          // Zusätzlich in die relevanten Versionsschlüssel schreiben, damit ein Reload nicht wieder einen alten Stand nimmt.
          try {
            const payload = JSON.stringify(state);
            writeStatePayloadToStorage(payload);
          } catch (storeErr) {
            console.warn('Zusatzspeicherung nach Import fehlgeschlagen', storeErr);
          }

          let importWarnings = 0;
          try {
            const importCheckItems = getDataCheckItems();
            importWarnings = importCheckItems.filter((item) => item.kind === 'warning' || item.kind === 'danger').length;
          } catch (checkErr) {
            console.warn('Datencheck nach Import übersprungen', checkErr);
            importWarningsInternal.push('Datencheck');
          }
          importInput.value = '';
          selectedFile = null;
          const importedPostCount = (state.commonCosts?.length || 0)
            + (state.personalCosts?.length || 0)
            + (state.bufferExpenses?.length || 0)
            + (state.taxRefunds?.length || 0);
          const extra = importWarningsInternal.length ? ` (${importWarningsInternal.length} technische Normalisierung(en) übersprungen, Daten wurden trotzdem übernommen.)` : '';
          const summary = `${state.persons?.length || 0} Personen, ${importedPostCount} Posten und ${state.debts?.length || 0} Schulden wurden gespeichert.`;
          pendingBackupImportNotice = {
            message: importWarnings > 0
              ? `Import abgeschlossen: ${summary} ${importWarnings} Hinweis(e) im Datencheck gefunden.${extra}`
              : `Import abgeschlossen: ${summary} Die Sicherung bleibt auch nach einem Neuladen erhalten.${extra}`,
            kind: importWarnings > 0 || importWarningsInternal.length ? 'warning' : 'success'
          };
          render();
          return;
        } catch (err) {
          if (importStarted && !importCommitted && previousStatePayload) {
            try {
              state = JSON.parse(previousStatePayload);
              writeStatePayloadToStorage(previousStatePayload);
            } catch (rollbackErr) {
              console.error('Stand vor dem Import konnte nicht vollständig wiederhergestellt werden', rollbackErr);
            }
          }
          console.error('Backup-Import fehlgeschlagen', err);
          setInlineStatus('Fehler beim Import: ' + err.message, 'error');
          resetImportButton();
        }
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
    const wrapper = document.createElement('div');
    wrapper.className = 'month-year-picker';

    const fallbackMonth = dateToMonthKey(new Date());
    const [selectedYear, selectedMonthNo] = String(isMonthKey(currentMonth) ? currentMonth : fallbackMonth).split('-');
    const monthSelect = document.createElement('select');
    monthSelect.className = 'month-year-picker-month';
    monthSelect.setAttribute('aria-label', 'Monat auswählen');

    const yearSelect = document.createElement('select');
    yearSelect.className = 'month-year-picker-year';
    yearSelect.setAttribute('aria-label', 'Jahr auswählen');

    const actualKey = dateToMonthKey(new Date());
    const actualYear = actualKey.slice(0, 4);
    const actualMonthNo = actualKey.slice(5, 7);

    const monthNames = Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      const label = new Date(2000, index, 1).toLocaleDateString('de-DE', { month: 'long' });
      return { month, label: label.charAt(0).toUpperCase() + label.slice(1) };
    });

    monthNames.forEach(({ month, label }) => {
      const opt = document.createElement('option');
      const optionKey = `${selectedYear}-${month}`;
      opt.value = month;
      opt.textContent = selectedYear === actualYear && month === actualMonthNo ? `${label} · aktuell` : label;
      if (optionKey < APP_FIRST_DATA_MONTH) {
        opt.disabled = true;
        opt.textContent = `${label} · vor App-Start`;
      }
      if (month === selectedMonthNo) opt.selected = true;
      monthSelect.appendChild(opt);
    });

    const years = new Set();
    const minYear = Number(APP_FIRST_DATA_MONTH.slice(0, 4));
    const actualYearNumber = Number(actualYear);
    const selectedYearNumber = Number(selectedYear);
    const maxYear = Math.max(
      actualYearNumber + APP_FUTURE_YEAR_RANGE,
      Number.isFinite(selectedYearNumber) ? selectedYearNumber : actualYearNumber
    );

    for (let year = minYear; year <= maxYear; year += 1) {
      years.add(String(year));
    }
    (monthList || []).forEach((m) => {
      if (m && isMonthKey(m.key)) years.add(m.key.slice(0, 4));
    });
    years.add(selectedYear);
    years.add(actualYear);
    Array.from(years).sort().forEach((year) => {
      const opt = document.createElement('option');
      opt.value = year;
      opt.textContent = year === actualYear ? `${year} · aktuell` : year;
      if (year === selectedYear) opt.selected = true;
      yearSelect.appendChild(opt);
    });

    Object.defineProperty(wrapper, 'value', {
      configurable: true,
      get() {
        return `${yearSelect.value}-${monthSelect.value}`;
      }
    });

    const emitCombinedChange = (event) => {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      if (`${yearSelect.value}-${monthSelect.value}` < APP_FIRST_DATA_MONTH) {
        const [minYear, minMonth] = APP_FIRST_DATA_MONTH.split('-');
        yearSelect.value = minYear;
        monthSelect.value = minMonth;
      }
      wrapper.dispatchEvent(new Event('change', { bubbles: true }));
    };
    monthSelect.addEventListener('change', emitCombinedChange);
    yearSelect.addEventListener('change', emitCombinedChange);

    wrapper.appendChild(monthSelect);
    wrapper.appendChild(yearSelect);
    return wrapper;
  }
  function updateMonthListIfNeeded() {
    if (!monthList.find((m) => m.key === currentMonth)) {
      monthList = getSelectableMonths(currentMonth);
    }
  }

  function setCurrentMonth(monthKey, persist = true) {
    if (!isMonthKey(monthKey)) return;
    if (monthKey < APP_FIRST_DATA_MONTH) monthKey = APP_FIRST_DATA_MONTH;
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
    let changed = false;
    if (state.appMeta.lastAutoMonthCheck !== actualMonth) {
      currentMonth = actualMonth;
      monthList = getSelectableMonths(currentMonth);
      state.appMeta.lastAutoMonthCheck = actualMonth;
      state.appMeta.selectedMonth = actualMonth;
      changed = true;
    }
    if (state.appMeta.lastPreparedMonth !== actualMonth) {
      syncFuelTopUpExpenses(actualMonth);
      syncGroceryTopUpExpense(actualMonth);
      syncAllLinkedDebtRatesFromPosts(actualMonth, 36, { silent: true });
      state.appMeta.lastPreparedMonth = actualMonth;
      addChangeLog(
        'Monatsstart',
        `${formatMonthLabel(actualMonth)} automatisch vorbereitet: laufende Kosten, Aufstockungen und verknüpfte Schuldenraten geprüft.`,
        actualMonth
      );
      changed = true;
    }
    if (changed) saveState();
    return changed;
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

  let formFieldSequence = 0;

  function createLabelInput(labelText, inputEl) {
    const wrapper = document.createElement('div');
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    const labelTarget = inputEl && inputEl.matches && inputEl.matches('input, select, textarea, button')
      ? inputEl
      : null;
    if (labelTarget) {
      formFieldSequence += 1;
      if (!labelTarget.id) labelTarget.id = `form-field-${formFieldSequence}`;
      lbl.htmlFor = labelTarget.id;
    }
    wrapper.appendChild(lbl);
    wrapper.appendChild(inputEl);
    return wrapper;
  }

  function showModal(title, contentEl, buttons = []) {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement('div');
    overlay.className = 'app-modal-overlay';
    const panel = document.createElement('div');
    panel.className = 'app-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const header = document.createElement('div');
    header.className = 'app-modal-header';
    const heading = document.createElement('h3');
    const headingId = `modal-title-${generateId()}`;
    heading.id = headingId;
    heading.textContent = title;
    panel.setAttribute('aria-labelledby', headingId);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'secondary app-modal-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Dialog schließen');
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
      if (!overlay.isConnected) return;
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      if (!document.querySelector('.app-modal-overlay')) document.body.classList.remove('modal-open');
      if (previouslyFocused && previouslyFocused.isConnected) {
        setTimeout(() => previouslyFocused.focus(), 0);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(panel.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', onKeyDown);

    const initialFocus = panel.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), .app-modal-body button:not([disabled])')
      || closeBtn;
    setTimeout(() => initialFocus.focus(), 0);
    return { overlay, panel, body, footer, close };
  }

  function showPersonIncomeEditor(person) {
    ensurePersonIncomeConfig(person);
    const refs = {};
    const content = document.createElement('div');
    content.className = 'modal-form';

    const activeNetForMonth = getPersonNet(person, currentMonth);
    const sourceLabel = getPersonNetSourceLabel(person, currentMonth);

    const currentInfo = document.createElement('p');
    currentInfo.className = 'small';
    currentInfo.innerHTML = `<strong>Verwendet in ${formatMonthLabel(currentMonth)}:</strong> ${euro(activeNetForMonth)} <span class="muted">(${sourceLabel})</span>`;
    content.appendChild(currentInfo);

    const identityRow = document.createElement('div');
    identityRow.className = 'row';
    refs.nameInput = document.createElement('input');
    refs.nameInput.type = 'text';
    refs.nameInput.value = person.name || '';
    refs.shiftInput = document.createElement('input');
    refs.shiftInput.type = 'text';
    refs.shiftInput.inputMode = 'decimal';
    refs.shiftInput.value = Number(person.shift || 0);
    identityRow.appendChild(createLabelInput('Name', refs.nameInput));
    identityRow.appendChild(createLabelInput('Normale Verschiebung', refs.shiftInput));
    content.appendChild(identityRow);

    const shiftOverrideRow = document.createElement('div');
    shiftOverrideRow.className = 'row';
    refs.monthShiftInput = document.createElement('input');
    refs.monthShiftInput.type = 'text';
    refs.monthShiftInput.inputMode = 'decimal';
    refs.monthShiftInput.placeholder = 'leer = normale Verschiebung';
    if (person.shiftOverrides && person.shiftOverrides[currentMonth] != null) {
      refs.monthShiftInput.value = formatNumberInput(Number(person.shiftOverrides[currentMonth]));
    }
    shiftOverrideRow.appendChild(createLabelInput(`Verschiebung nur ${formatMonthLabel(currentMonth)}`, refs.monthShiftInput));
    content.appendChild(shiftOverrideRow);

    const incomeRow = document.createElement('div');
    incomeRow.className = 'row';
    refs.newNetInput = document.createElement('input');
    refs.newNetInput.type = 'text';
    refs.newNetInput.inputMode = 'decimal';
    refs.newNetInput.value = activeNetForMonth.toFixed(2);
    refs.modeSelect = document.createElement('select');
    refs.modeSelect.innerHTML = `
      <option value="once">Tatsächliche Auszahlung nur dieser Monat</option>
      <option value="future">Grundlohn / Planwert ab diesem Monat</option>
    `;
    refs.modeSelect.value = 'once';
    incomeRow.appendChild(createLabelInput(`Netto für ${formatMonthLabel(currentMonth)}`, refs.newNetInput));
    incomeRow.appendChild(createLabelInput('Speichern als', refs.modeSelect));
    content.appendChild(incomeRow);

    const standardBox = document.createElement('details');
    standardBox.className = 'details-box';
    const summary = document.createElement('summary');
    summary.textContent = 'Grundlohn / Basiswert anzeigen';
    standardBox.appendChild(summary);
    const baseRow = document.createElement('div');
    baseRow.className = 'row';
    refs.baseNetInput = document.createElement('input');
    refs.baseNetInput.type = 'text';
    refs.baseNetInput.inputMode = 'decimal';
    refs.baseNetInput.value = Number(person.net || 0).toFixed(2);
    baseRow.appendChild(createLabelInput('Grundlohn / Basis-Netto', refs.baseNetInput));
    standardBox.appendChild(baseRow);
    content.appendChild(standardBox);

    const helper = document.createElement('p');
    helper.className = 'small muted';
    helper.textContent = 'Für wechselnde Zuschläge nutze „Tatsächliche Auszahlung nur dieser Monat“. Den Grundlohn / Planwert änderst du nur, wenn sich das bekannte feste Einkommen wirklich ändert. Die normale Verschiebung bleibt eure 250-€-Regel. Für Sondermonate wie Juli kannst du oben eine Verschiebung nur für diesen Monat eintragen, z. B. 0.';
    content.appendChild(helper);

    showModal(`${person.name || 'Person'} bearbeiten`, content, [
      {
        label: 'Ist-Auszahlung dieses Monats löschen',
        className: 'secondary',
        onClick: (close) => {
          clearPersonNetForMonth(person, currentMonth, 'once');
          syncPersonIncomeReceivedAmount(person, currentMonth);
          saveState();
          close();
          render();
        }
      },
      {
        label: 'Planwert ab diesem Monat löschen',
        className: 'secondary',
        onClick: (close) => {
          clearPersonNetForMonth(person, currentMonth, 'future');
          syncPersonIncomeReceivedAmount(person, currentMonth);
          saveState();
          close();
          render();
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
          const shift = parseMoneyInput(refs.shiftInput.value);
          const monthShiftRaw = refs.monthShiftInput.value.trim();
          const monthShift = monthShiftRaw ? parseMoneyInput(monthShiftRaw) : null;
          const baseNet = parseMoneyInput(refs.baseNetInput.value);
          const newNet = parseMoneyInput(refs.newNetInput.value);
          if (!newName) return alert('Name darf nicht leer sein.');
          if (Number.isNaN(shift)) return alert('Bitte eine gültige Verschiebung eingeben.');
          if (Math.abs(shift) > 1000) return alert('Die Verschiebung wirkt unplausibel. Bitte nicht das Netto eintragen, sondern z. B. 250 oder -250.');
          if (monthShiftRaw && (Number.isNaN(monthShift) || Math.abs(monthShift) > 1000)) return alert('Bitte eine gültige Monats-Verschiebung eingeben, z. B. 0, 250 oder -250.');
          if (Number.isNaN(baseNet) || baseNet < 0) return alert('Bitte einen gültigen Grundlohn eingeben.');
          if (Number.isNaN(newNet) || newNet < 0) return alert('Bitte ein gültiges Netto eingeben.');

          person.name = newName;
          person.shift = shift;
          person.net = baseNet;
          if (monthShiftRaw) setPersonShiftForMonth(person, currentMonth, monthShift);
          else clearPersonShiftForMonth(person, currentMonth);

          const mode = refs.modeSelect.value === 'once' ? 'once' : 'future';
          if (!setPersonNetForMonth(person, currentMonth, newNet, mode)) return alert('Das Netto konnte nicht gespeichert werden.');

          addChangeLog('Einkommen', `${person.name}: ${mode === 'once' ? 'tatsächliche Auszahlung für ' + formatMonthLabel(currentMonth) : 'Grundlohn / Planwert ab ' + formatMonthLabel(currentMonth)} auf ${euro(newNet)} gesetzt.`);
          syncPersonIncomeReceivedAmount(person, currentMonth);
          saveState();
          close();
          render();
        }
      }
    ]);
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
  }
  
  // Kleine Versionsanzeige oben aktualisieren. Wenn per Neu-Laden ein Refresh-Parameter gesetzt wurde,
  // wird kurz "Update geladen" gezeigt.
  const versionChip = document.getElementById('versionChip');
  if (versionChip) {
    const params = new URLSearchParams(window.location.search);
    if (params.has('refresh')) {
      versionChip.textContent = VERSION_UPDATE_TEXT;
      setTimeout(() => {
        versionChip.textContent = VERSION_READY_TEXT;
      }, 2500);
    } else {
      versionChip.textContent = VERSION_READY_TEXT;
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
  automaticBrowserBackupInitialized = true;
  Promise.all([
    reconcileAutomaticBrowserBackups(),
    reconcileExternalBackupConnection()
  ]).then(([automaticChanged, externalChanged]) => {
    if ((automaticChanged || externalChanged) && (currentSection === 'save' || currentSection === 'overview' || currentSection === 'monthstart')) render();
  });
})();
