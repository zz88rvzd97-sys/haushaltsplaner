/*
 * Haushaltsplaner Developer Beta 1.71
 *
 * Diese Version verbessert Optik und Bedienung:
 * Finanz-Ampel als Monatskopf, Schnellaktionen, stärkerer Schulden-Fahrplan,
 * Monatsabschluss als Beleg und eine visuelle Prognose-Zeitleiste.
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
  const APP_FIRST_DATA_MONTH = '2026-04';
  const APP_FUTURE_YEAR_RANGE = 50;
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
        (person.netTimeline || []).forEach((entry) => addKey(entry && entry.month));
      });
      Object.keys(state.monthlyClosings || {}).forEach(addKey);
      Object.keys(state.reserveItemSaved || {}).forEach(addKey);
      (state.reservesSavedMonths || []).forEach(addKey);
      (state.taxRefunds || []).forEach((refund) => {
        addFromDate(refund.receivedDate);
        (refund.purchases || []).forEach((purchase) => addFromDate(purchase.date));
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
    return debt.rateTimeline.map((entry) => `ab ${formatMonthLabel(entry.month)}: ${Number(entry.amount || 0).toFixed(2)} €`).join(' · ');
  }

  function getNextDebtRateChangeText(debt, fromMonth = currentMonth) {
    normalizeDebtRateTimeline(debt);
    const next = debt.rateTimeline.find((entry) => monthDiff(fromMonth, entry.month) > 0);
    if (!next) return '';
    return `Nächste Änderung: ab ${formatMonthLabel(next.month)} → ${Number(next.amount || 0).toFixed(2)} €`;
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
      addChangeLog('Schulden', `${debt.name}: Rate automatisch aus ${post.name || 'verknüpftem Posten'} auf ${targetAmount.toFixed(2)} € ab ${formatMonthLabel(effectiveMonth)} gesetzt`, effectiveMonth);
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
            addChangeLog('Schulden', `${debt.name}: Rate aus verknüpftem Posten ${post.name || ''} auf ${amount.toFixed(2)} € ab ${formatMonthLabel(month)} synchronisiert`, month);
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
      markAsMonthly: true,
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
    commonAccount: {
      currentBalance: 0,
      manualBound: 0,
      note: '',
      contributionsPaid: {},
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
      benny: { kmPerMonth: 0, consumption: 5.5, fuelType: 'diesel', avgPrice: '', autoPrice: '', stationName: '', lastFetch: '', monthlyEntries: [] },
      madeleine: { kmPerMonth: 0, consumption: 7.0, fuelType: 'e5', avgPrice: '', autoPrice: '', stationName: '', lastFetch: '', monthlyEntries: [] }
    },
    budgetTopUps: {
      fuel: { name: 'Kraftstoffkonto', startMonth: '2026-07', balances: {}, notes: {} },
      groceries: { name: 'Einkaufsgeld', startMonth: '2026-07', balances: {}, notes: {}, targetAmount: 550, targetStartMonth: '2026-06' }
    },
    appMeta: { selectedMonth: '', lastAutoMonthCheck: '', includeApiKeyInBackup: true }
  };
  let state;
  try {
  // Ab 1.90 wird nicht mehr blind der erste Speicher-Key geladen.
  // Die App wählt den umfangreichsten gültigen Datensatz, damit ein leerer Stable-Key
  // keine ältere echte Sicherung überschreibt.
  const fallback = [
    'budgetStateStable','budgetStateAutoBackup','budgetStateV193','budgetStateV192','budgetStateV191','budgetStateV190','budgetStateV189','budgetStateV188','budgetStateV187','budgetStateV186','budgetStateV185','budgetStateV184','budgetStateV183','budgetStateV182','budgetStateV181','budgetStateV180','budgetStateV179','budgetStateV178','budgetStateV177','budgetStateV176','budgetStateV175','budgetStateV174','budgetStateV173','budgetStateV172','budgetStateV171','budgetStateV170','budgetStateV169','budgetStateV168','budgetStateV167','budgetStateV166','budgetStateV165','budgetStateV164','budgetStateV163','budgetStateV162','budgetStateV161','budgetStateV160','budgetStateV159','budgetStateV158','budgetStateV156','budgetStateV155','budgetStateV153','budgetStateV152','budgetStateV151','budgetStateV150','budgetStateV149','budgetStateV148','budgetStateV146','budgetStateV145','budgetStateV144','budgetStateV143','budgetStateV142','budgetStateV140','budgetStateV139','budgetStateV136','budgetStateV135'
  ];
  const scoreStatePayload = (obj) => {
    if (!obj || typeof obj !== 'object') return -1;
    return (Array.isArray(obj.commonCosts) ? obj.commonCosts.length * 5 : 0)
      + (Array.isArray(obj.personalCosts) ? obj.personalCosts.length * 5 : 0)
      + (Array.isArray(obj.debts) ? obj.debts.length * 8 : 0)
      + (Array.isArray(obj.accounts) ? obj.accounts.length * 4 : 0)
      + (Array.isArray(obj.taxRefunds) ? obj.taxRefunds.length * 4 : 0)
      + (Array.isArray(obj.changeLog) ? Math.min(obj.changeLog.length, 50) : 0)
      + (obj.appMeta && obj.appMeta.selectedMonth ? 2 : 0);
  };
  let saved = '';
  let bestScore = -1;
  for (const k of fallback) {
    const data = localStorage.getItem(k);
    if (!data) continue;
    try {
      const parsed = JSON.parse(data);
      const score = scoreStatePayload(parsed);
      if (score > bestScore) {
        bestScore = score;
        saved = data;
      }
    } catch (e) {
      console.warn('Ungültiger Speicherstand ignoriert', k, e);
    }
  }
  if (saved) {
    localStorage.setItem('budgetStateStable', saved);
    localStorage.setItem('budgetStateAutoBackup', saved);
    localStorage.setItem('budgetStateV193', saved);
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
      if (typeof state.tankCalc.locationQuery !== 'string') state.tankCalc.locationQuery = '';
      if (typeof state.tankCalc.locationLat !== 'string' && typeof state.tankCalc.locationLat !== 'number') state.tankCalc.locationLat = '';
      if (typeof state.tankCalc.locationLng !== 'string' && typeof state.tankCalc.locationLng !== 'number') state.tankCalc.locationLng = '';
      if (typeof state.tankCalc.locationName !== 'string') state.tankCalc.locationName = '';
      if (typeof state.tankCalc.lastRequestAt !== 'string') state.tankCalc.lastRequestAt = '';
      if (typeof state.tankCalc.lastApiStatus !== 'string') state.tankCalc.lastApiStatus = '';
      if (typeof state.tankCalc.lastApiError !== 'string') state.tankCalc.lastApiError = '';
      if (!Array.isArray(state.tankCalc.receipts)) state.tankCalc.receipts = [];
      if (!state.tankCalc.benny) state.tankCalc.benny = JSON.parse(JSON.stringify(defaultState.tankCalc.benny));
      if (!state.tankCalc.madeleine) state.tankCalc.madeleine = JSON.parse(JSON.stringify(defaultState.tankCalc.madeleine));
      if (!Array.isArray(state.tankCalc.benny.monthlyEntries)) state.tankCalc.benny.monthlyEntries = [];
      if (!Array.isArray(state.tankCalc.madeleine.monthlyEntries)) state.tankCalc.madeleine.monthlyEntries = [];
    }
    if (!Array.isArray(state.bufferExpenses)) state.bufferExpenses = [];
    if (!Array.isArray(state.taxRefunds)) state.taxRefunds = [];
    normalizeAllTaxRefunds();
    normalizeBudgetTopUpsConfig();
    normalizeCommonAccountConfig();
    normalizeAccountsConfig();
    normalizeAccountTransfersConfig();
    normalizeAccountTransferTemplatesConfig();
    if (!state.monthlyClosings || typeof state.monthlyClosings !== 'object') state.monthlyClosings = {};
    if (!Array.isArray(state.changeLog)) state.changeLog = [];
    if (!state.appMeta || typeof state.appMeta !== 'object') state.appMeta = JSON.parse(JSON.stringify(defaultState.appMeta));
    migrateKreiskasseToBennyPersonal();
    if (!state.reserveItemSaved) state.reserveItemSaved = {};
    syncAllReserveSelectionsToPots();
    normalizeAllPersonConfigs();
    normalizeAllPostConfigs();
    ensureGroceryMoneyFromJune2026();
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
      localStorage.setItem('budgetStateStable', payload);
      localStorage.setItem('budgetStateAutoBackup', payload);
      localStorage.setItem('budgetStateV193', payload);
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
    // Ab 1.29 wird nur noch ein Backup erstellt und der Tank-API-Key ist immer enthalten.
    state.appMeta.includeApiKeyInBackup = true;
  }

  function normalizeBudgetTopUpsConfig() {
    if (!state.budgetTopUps || typeof state.budgetTopUps !== 'object') state.budgetTopUps = {};
    const defaults = {
      fuel: { name: 'Kraftstoffkonto', startMonth: '2026-07' },
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
  const DEFAULT_SHARED_ACCOUNT_ID = 'account_shared_main';

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
            month: isMonthKey(tx.month) ? tx.month : startMonthKey,
            date: typeof tx.date === 'string' ? tx.date : '',
            type: typeof tx.type === 'string' ? tx.type : 'manual',
            sourceId: typeof tx.sourceId === 'string' ? tx.sourceId : '',
            label: typeof tx.label === 'string' ? tx.label : 'Buchung',
            amount: Number.isFinite(Number(tx.amount)) ? Number(tx.amount) : 0,
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
    const owner = normalizeAccountOwner(personId);
    const ownedChecking = accounts.find((acc) => normalizeAccountOwner(acc.owner) === owner && normalizeAccountType(acc.type) === 'checking');
    if (ownedChecking) return ownedChecking.id;
    const ownedAny = accounts.find((acc) => normalizeAccountOwner(acc.owner) === owner);
    return ownedAny ? ownedAny.id : '';
  }

  function createAccountSelect(value = '', options = {}) {
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
    if (!post || !refs || !refs.bookingTypeSelect) return true;
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
      const planned = getDebtMonthAmount(debt, monthKey);
      const paid = getDebtPaymentAmountForMonth(debt, monthKey);
      const open = Math.max(planned - paid, 0);
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
        const isBooked = !!findAccountTransactionBySource(sourceId) || !!findAccountTransactionBySource(`${sourceId}:transfer`);
        if (isBooked) return;
        rows.push({ group, name: post.name || 'Posten', amount: Number(getEffectiveAmountForMonth(post, monthKey) || 0), sourceId });
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
    const bound = manualBound + taxRefundBound;
    const open = openRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const paidUnbooked = paidUnbookedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    // Ab 1.93: Bezahlte, aber nicht gebuchte Posten sind nur ein Hinweis.
    // Sie dürfen nicht automatisch vom Kontostand abgezogen werden, wenn der echte Bankstand bereits aktuell ist.
    const after = balance - bound - open;
    return {
      balance,
      bound,
      manualBound,
      taxRefundBound,
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
      { label: 'Kontostand', value: euro(data.balance) },
      { label: 'Gebunden', value: euro(data.bound), kind: data.bound > 0.005 ? 'warning' : '', hint: data.taxRefundBound > 0.005 ? `davon Steuererstattung ${euro(data.taxRefundBound)}` : '' },
      { label: 'Noch offen', value: euro(data.open), kind: data.open > 0.005 ? 'warning' : 'success' },
      { label: 'Hinweis: bezahlt ohne Buchung', value: euro(data.paidUnbooked), kind: data.paidUnbooked > 0.005 ? 'warning' : 'success' },
      { label: data.missing > 0.005 ? 'Fehlt noch' : 'Verfügbar danach', value: euro(data.missing > 0.005 ? data.missing : data.available), kind: data.missing > 0.005 ? 'danger' : 'success' }
    ]));
    if (account.lastReconciledAt) {
      const rec = document.createElement('p');
      rec.className = 'small muted account-reconcile-note';
      const d = new Date(account.lastReconciledAt);
      const when = Number.isNaN(d.getTime()) ? account.lastReconciledAt : d.toLocaleDateString('de-DE');
      rec.textContent = `Zuletzt abgeglichen: ${when}${account.lastReconciledBalance !== null && account.lastReconciledBalance !== undefined ? ' · ' + euro(account.lastReconciledBalance) : ''}`;
      card.appendChild(rec);
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
      summary.textContent = `${data.paidUnbookedRows.length} bezahlte, aber nicht gebuchte Posten anzeigen`;
      warn.appendChild(summary);
      const list = document.createElement('div');
      list.className = 'mini-list';
      data.paidUnbookedRows.forEach((row) => {
        const line = document.createElement('div');
        line.className = 'mini-list-row warning-row';
        line.innerHTML = `<span><strong>${row.name}</strong><small>${row.group} · bezahlt markiert, aber keine Kontobuchung gefunden</small></span><b>${euro(row.amount)}</b>`;
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
    hint.className = 'small muted';
    hint.textContent = 'Alle gemeinsamen Kosten und die Steuererstattung sind fest dem Gemeinschaftskonto zugeordnet. Der noch nicht verwendete Rest der Steuererstattung zählt dort als gebundenes Geld und reduziert den verfügbaren Betrag. Weitere Konten kannst du frei anlegen.';
    card.appendChild(hint);

    normalizeAccountTransfersConfig();
    normalizeAccountTransferTemplatesConfig();
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
      card.appendChild(tplDetails);
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
      card.appendChild(transferDetails);
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
      { label: 'Gebunden', value: euro(totals.bound), kind: totals.bound > 0 ? 'warning' : '' },
      { label: 'Offen zugeordnet', value: euro(totals.open), kind: totals.open > 0 ? 'warning' : 'success' },
      { label: totals.missing > 0.005 ? 'Fehlt gesamt' : 'Verfügbar gesamt', value: euro(totals.missing > 0.005 ? totals.missing : totals.available), kind: totals.missing > 0.005 ? 'danger' : 'success', hint: totals.missing > 0.005 ? 'Bei mindestens einem Konto reicht der aktuelle Stand nicht.' : 'Nach gebundenen Beträgen und offenen Zahlungen.' }
    ]));

    const accountGrid = document.createElement('div');
    accountGrid.className = 'account-grid account-availability-grid';
    accountStats.forEach(({ account }) => accountGrid.appendChild(renderAccountAvailabilityCard(account)));
    card.appendChild(accountGrid);

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
    card.appendChild(table);
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
    amountInput.type = 'number';
    amountInput.step = '0.01';
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
      const amount = Number(amountInput.value || 0);
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
        const amount = Number(amountInput.value || 0);
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
    balanceInput.type = 'number';
    balanceInput.step = '0.01';
    balanceInput.value = Number(item.balance || 0).toFixed(2);
    row2.appendChild(createLabelInput('Besitzer', ownerSelect));
    row2.appendChild(createLabelInput('Aktueller Kontostand', balanceInput));
    content.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'row';
    const boundInput = document.createElement('input');
    boundInput.type = 'number';
    boundInput.step = '0.01';
    boundInput.value = Number(item.bound || 0).toFixed(2);
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
        item.balance = Number(balanceInput.value || 0);
        item.bound = Math.max(0, Number(boundInput.value || 0));
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
    if (!ca.contributionsPaid || typeof ca.contributionsPaid !== 'object' || Array.isArray(ca.contributionsPaid)) ca.contributionsPaid = {};
    Object.keys(ca.contributionsPaid).forEach((month) => {
      if (!isMonthKey(month) || !ca.contributionsPaid[month] || typeof ca.contributionsPaid[month] !== 'object') {
        delete ca.contributionsPaid[month];
      }
    });
    if (!Array.isArray(ca.interestEntries)) ca.interestEntries = [];
    ca.interestEntries = ca.interestEntries
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        id: entry.id || generateId(),
        month: isMonthKey(entry.month) ? entry.month : (isMonthKey(entry.receivedMonth) ? entry.receivedMonth : startMonthKey),
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

  function setCommonAccountContributionPaid(monthKey, personId, paid) {
    if (!isMonthKey(monthKey) || !personId) return;
    const map = getCommonAccountContributionMap(monthKey);
    const nextPaid = paid === true;
    // Ab 1.93: Eingegangen markieren ist nur noch ein Status.
    // Der echte Kontostand enthält den Eingang oft bereits, daher darf hier nicht automatisch gebucht werden.
    map[personId] = nextPaid;
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
    if (options.addToBalance !== false) {
      const shared = getSharedAccount();
      const txId = shared ? upsertAccountTransaction(shared.id, {
        month,
        type: 'interest',
        sourceId: `interest:${item.id}`,
        label: `Zinsen ${formatMonthLabel(month)}`,
        amount
      }) : null;
      item.transactionId = txId || '';
      if (!shared) {
        state.commonAccount.currentBalance = Number(state.commonAccount.currentBalance || 0) + amount;
        syncCommonAccountBalanceToSharedAccount();
      }
    }
    addChangeLog('Gemeinschaftskonto', `Zinsen für ${formatMonthLabel(month)} eingetragen: ${euro(amount)}.`, month);
    return true;
  }

  function deleteCommonAccountInterest(id) {
    normalizeCommonAccountConfig();
    const entry = state.commonAccount.interestEntries.find((item) => item.id === id);
    const before = state.commonAccount.interestEntries.length;
    if (entry) {
      if (entry.transactionId) removeAccountTransactionBySource(`interest:${entry.id}`) || removeAccountTransaction(getSharedAccount() && getSharedAccount().id, entry.transactionId);
      else removeAccountTransactionBySource(`interest:${entry.id}`);
    }
    state.commonAccount.interestEntries = state.commonAccount.interestEntries.filter((entry) => entry.id !== id);
    return state.commonAccount.interestEntries.length !== before;
  }


  function getCommonAccountIntervalReserve(monthKey) {
    // Rücklage, die auf dem Gemeinschaftskonto bleiben sollte, weil ihr monatlich
    // Anteile einzahlt, während einige gemeinsame Kosten nur quartalsweise,
    // halbjährlich oder jährlich abgebucht werden.
    if (!isMonthKey(monthKey)) return { total: 0, rows: [] };
    const rows = [];
    let total = 0;
    (state.commonCosts || []).forEach((item) => {
      ensurePostConfig(item);
      const interval = Number(item.interval || 1);
      if (interval <= 1 || item.oneTime) return;
      if (!isPostActiveInMonth(item, monthKey)) return;
      const dueNow = isDue(item, monthKey);
      const paidNow = isPostPaidForMonth(item, monthKey);
      const amount = Number(getEffectiveAmountForMonth(item, monthKey) || 0);
      const monthlyPart = amount / interval;
      let reserve = 0;
      let monthsBuilt = 0;
      let nextDue = monthKey;

      if (dueNow && !paidNow) {
        // Wenn die Abbuchung im aktuellen Monat noch offen ist, steckt sie bereits
        // in den offenen Abbuchungen und darf nicht nochmal als Rücklage zählen.
        reserve = 0;
        monthsBuilt = 0;
        nextDue = monthKey;
      } else {
        // Suche den letzten Fälligkeitsmonat vor oder im aktuellen Monat.
        let lastDue = item.startMonth;
        while (monthDiff(lastDue, monthKey) < 0) {
          const candidate = addMonths(lastDue, interval);
          if (monthDiff(candidate, monthKey) > 0) break;
          lastDue = candidate;
        }
        nextDue = dueNow ? addMonths(monthKey, interval) : addMonths(lastDue, interval);
        monthsBuilt = Math.max(0, monthDiff(lastDue, monthKey));
        if (dueNow && paidNow) monthsBuilt = 0;
        reserve = Math.min(amount, monthlyPart * monthsBuilt);
      }

      if (reserve > 0.005) {
        total += reserve;
        rows.push({ item, amount, interval, monthlyPart, monthsBuilt, reserve, nextDue });
      }
    });
    return { total, rows };
  }

  function computeCommonAccountDetails(monthKey) {
    normalizeCommonAccountConfig();
    const monthDetails = computeMonthDetails(monthKey);
    const contributionMap = getCommonAccountContributionMap(monthKey);
    const persons = (monthDetails.personsData || []).map((pd) => {
      const amount = Number(pd.commonShare || 0);
      const paid = contributionMap[pd.person.id] === true;
      return { person: pd.person, amount, paid };
    });
    const contributionsTotal = persons.reduce((sum, row) => sum + row.amount, 0);
    const contributionsPaid = persons.reduce((sum, row) => sum + (row.paid ? row.amount : 0), 0);
    const contributionsOpen = Math.max(contributionsTotal - contributionsPaid, 0);
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
    const boundTotal = taxBound + manualBound + intervalReserveTotal;
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

  // ----- Dynamische Schneeball-Regeln -----
  // Zusatztilgung startet erst, wenn nach allen Kosten mindestens 600 € frei sind.
  // Der Betrag oberhalb von 500 € wird nur genutzt, wenn damit eine Schuld vollständig getilgt werden kann.
  // Schneeball-Umlegungen aus auslaufenden Raten bleiben davon getrennt und laufen weiter wie bisher.
  const snowballConfig = {
    shortTermSkipMonths: 6,
    extraInvestTrigger: 600,
    keepFreeBuffer: 500
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

  function euro(value) {
    return `${Number(value || 0).toFixed(2)} €`;
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
          map[debt.nextDueMonth].notes.push(`${debt.name || 'Schuld'}: ${amount.toFixed(2)} € einmalig`);
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
    const free = Number(details.free || 0) + debtAdjustment;
    const distributable = Math.max(free, 0);
    return {
      ...details,
      linkedDebtCosts,
      debtPlanned,
      debtBase: Number(projected.base || 0),
      debtSnowballExtra: Number(projected.snowballExtra || 0),
      debtDynamicExtra: Number(projected.dynamicExtra || 0),
      debtNotes: projected.notes || [],
      free,
      distributable,
      reserves: distributable * savingsConfig.reservesRatio,
      savings: distributable * savingsConfig.savingsRatio
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

    const longRunning = candidates.filter((debt) => !isShortTermSnowballTarget(debt, month, snowballConfig.shortTermSkipMonths));
    if (longRunning.length) return longRunning[0];
    return options.fallbackToShortTerm ? candidates[0] : null;
  }

  function getDynamicSnowballExtraForMonth(monthKey, monthDetailsFn) {
    const resolver = typeof monthDetailsFn === 'function' ? monthDetailsFn : computeMonthDetails;
    const details = resolver(monthKey);
    const free = Number(details && details.free || 0);
    if (free + 0.005 < snowballConfig.extraInvestTrigger) return 0;
    return Math.max(0, free - snowballConfig.keepFreeBuffer);
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

  function getDynamicSnowballExtraForProjectedMonth(monthKey, plannedDebtPayment, monthDetailsFn) {
    const resolver = typeof monthDetailsFn === 'function' ? monthDetailsFn : computeMonthDetails;
    const details = resolver(monthKey);
    const linkedDebtCosts = getLinkedDebtCostTotalForMonth(monthKey);
    // Dynamisch heißt hier: Der Monat wird mit den bis dahin simulierten Restschulden neu bewertet.
    // Statt der starren verknüpften Kostenposten zählt die Zahlung, die der Schneeballplan für genau
    // diesen Monat tatsächlich vorsieht (normale Rate + bereits frei gewordene Umlegung).
    const nonSnowballDebtDue = getNonSnowballDebtPaymentForMonth(monthKey);
    const projectedFreeBeforeDynamic = Number(details && details.free || 0)
      + Number(linkedDebtCosts || 0)
      - Number(plannedDebtPayment || 0)
      - Number(nonSnowballDebtDue || 0);
    if (projectedFreeBeforeDynamic + 0.005 < snowballConfig.extraInvestTrigger) return { amount: 0, projectedFreeBeforeDynamic, nonSnowballDebtDue };
    return {
      amount: Math.max(0, projectedFreeBeforeDynamic - snowballConfig.keepFreeBuffer),
      projectedFreeBeforeDynamic,
      nonSnowballDebtDue
    };
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
    const monthDetailsFn = typeof options.monthDetailsFn === 'function' ? options.monthDetailsFn : computeMonthDetails;
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

      dueDebts.forEach((debt) => {
        const pay = Math.min(debt.open, debt.rate);
        debt.open = Math.max(0, debt.open - pay);
        base += pay;
        if (pay > 0) {
          notes.push(`${debt.name}: ${pay.toFixed(2)} €`);
          payments.push({ type: 'rate', debt: debt.name, amount: pay, originalRate: debt.rate, remainingAfter: Math.max(0, debt.open), completed: debt.open <= 0.005, note: debt.open <= 0.005 ? 'Schlussrate / läuft aus' : 'normale Rate' });
        }
        if (debt.open <= 0.005) {
          debt.open = 0;
          newlyFreed += debt.rate;
          events.push({ month, type: 'completed', sourceDebt: debt.name, amount: debt.rate, targetDebt: '', transferMonth: nextMonth(month), text: `${debt.name} abbezahlt – ab ${formatMonthLabel(nextMonth(month))} gehen ${debt.rate.toFixed(2)} € auf die kleinste offene Schuld.` });
        }
      });

      if (rollover > 0) {
        let extraBudget = rollover;
        while (extraBudget > 0.005) {
          const target = chooseSnowballTarget(active, month, extraBudget, { allowFullPayoff: false, fallbackToShortTerm: false });
          if (!target) {
            notes.push(`${extraBudget.toFixed(2)} € frei werdende Rate geparkt: übrige Ziele sind in ≤ ${snowballConfig.shortTermSkipMonths} Monaten erledigt.`);
            break;
          }
          const pay = Math.min(target.open, extraBudget);
          target.open = Math.max(0, target.open - pay);
          extra += pay;
          extraBudget -= pay;
          notes.push(`${target.name} +${pay.toFixed(2)} € Schneeball`);
          payments.push({ type: 'snowball', debt: target.name, amount: pay, originalRate: target.rate, remainingAfter: Math.max(0, target.open), completed: target.open <= 0.005, note: target.open <= 0.005 ? 'durch Schneeball erledigt' : 'frei gewordene Rate' });
          if (target.open <= 0.005) {
            target.open = 0;
            newlyFreed += target.rate;
            events.push({
              month,
              type: 'completed_by_snowball',
              sourceDebt: target.name,
              amount: target.rate,
              targetDebt: '',
              transferMonth: nextMonth(month),
              text: `${target.name} durch Schneeball abbezahlt – ab ${formatMonthLabel(nextMonth(month))} kommen ${target.rate.toFixed(2)} € zusätzlich dazu.`
            });
          }
        }
      }

      const dynamicInfo = getDynamicSnowballExtraForProjectedMonth(month, base + extra, monthDetailsFn);
      const dynamicExtra = Number(dynamicInfo.amount || 0);
      let dynamicExtraUsed = 0;
      if (dynamicExtra > 0) {
        let extraBudget = dynamicExtra;
        notes.push(`frei nach simulierten Schulden: ${Number(dynamicInfo.projectedFreeBeforeDynamic || 0).toFixed(2)} €`);
        while (extraBudget > 0.005) {
          const target = chooseSnowballTarget(active, month, extraBudget, { allowFullPayoff: true, fullPayoffOnly: true, fallbackToShortTerm: false });
          if (!target) {
            notes.push(`${extraBudget.toFixed(2)} € Zusatz frei, aber keine Schuld kann damit vollständig getilgt werden.`);
            break;
          }
          const pay = target.open;
          target.open = Math.max(0, target.open - pay);
          extra += pay;
          dynamicExtraUsed += pay;
          extraBudget -= pay;
          notes.push(`${target.name} +${pay.toFixed(2)} € dynamisch`);
          payments.push({ type: 'dynamic', debt: target.name, amount: pay, originalRate: target.rate, remainingAfter: Math.max(0, target.open), completed: target.open <= 0.005, note: target.open <= 0.005 ? 'durch Zusatztilgung erledigt' : 'dynamische Zusatztilgung' });
          if (target.open <= 0.005) {
            target.open = 0;
            newlyFreed += target.rate;
            events.push({
              month,
              type: 'completed_by_dynamic_extra',
              sourceDebt: target.name,
              amount: target.rate,
              targetDebt: '',
              transferMonth: nextMonth(month),
              text: `${target.name} durch dynamische Zusatztilgung abbezahlt – ab ${formatMonthLabel(nextMonth(month))} werden ${target.rate.toFixed(2)} € frei.`
            });
          }
        }
      }

      const remaining = active.reduce((sum, debt) => sum + Math.max(0, debt.open), 0);
      const nextTarget = chooseSnowballTarget(active, nextMonth(month), rollover + newlyFreed, { allowFullPayoff: false, fallbackToShortTerm: false });
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
          text: `${entry.sourceDebt} ausgelaufen – ${entry.amount.toFixed(2)} € gehen ab ${formatMonthLabel(entry.transferMonth)} auf ${entry.targetDebt || 'keine weitere Schuld'}.`
        });
      });
      rows.push({ month, base, extra, dynamicExtra: dynamicExtraUsed || 0, total: base + extra, rolloverNext, remaining, targetNext: nextTarget ? nextTarget.name : '', freedTransfers: freedThisMonth, payments: payments.slice(), notes: notes.slice(0, 5).join(' · ') });
      if (remaining <= 0.005) {
        debtFreeMonth = month;
        break;
      }
      rollover += newlyFreed;
      month = nextMonth(month);
    }
    return { rows, events, noRate, scheduledOneTime, debtFreeMonth };
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

  function getMonthStatusText(status, details) {
    if (status.kind === 'danger' && details.free < 0) return 'Sofort prüfen: Der Monat ist rechnerisch im Minus.';
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
      ['Frei', euro(details.free), details.free >= 0 ? 'success' : 'danger'],
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
      const used = Math.min(100, Math.max(4, ((details.totalCommonRounded + details.totalPersonal + details.miscPaid) / max) * 100));
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


  function getMonthKeyFromDateValue(dateValue, fallbackMonth = currentMonth) {
    const match = String(dateValue || '').match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}` : (isMonthKey(fallbackMonth) ? fallbackMonth : dateToMonthKey(new Date()));
  }

  function getTaxRefundOverallSummary() {
    const refunds = Array.isArray(state.taxRefunds) ? state.taxRefunds : [];
    const received = refunds.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const spent = refunds.reduce((sum, item) => sum + (item.purchases || []).reduce((pSum, purchase) => pSum + Number(purchase.amount || 0), 0), 0);
    const entries = refunds.reduce((sum, item) => sum + (item.purchases || []).length, 0);
    return { received, spent, remaining: received - spent, entries, refunds };
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

  function transferTaxPurchaseToBuffer(refund, purchase, targetMonth, markPaid, noteText = '') {
    if (!refund || !purchase || !isMonthKey(targetMonth)) return false;
    if (!confirmClosedMonthChange(targetMonth, 'Die Ausgabe wird in diesen Monat umgebucht.')) return false;
    const amount = Number(purchase.amount || 0);
    const name = purchase.name || 'Umbuchung Steuererstattung';
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
    addChangeLog('Umbuchung', `${post.name}: ${euro(amount)} von Sonstige Ausgaben zur Steuererstattung ${refund.year} verschoben`, targetMonth);
    return true;
  }

  function moveBufferExpenseToMonth(post, targetMonth, carryPaid) {
    if (!post || !isMonthKey(targetMonth)) return false;
    if (!confirmClosedMonthChange(targetMonth, 'Die Ausgabe wird in diesen Monat verschoben.')) return false;
    const oldMonth = post.startMonth || currentMonth;
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
    const dueDebts = (state.debts || []).filter((debt) => Number(debt.amountOpen || 0) > 0 && isMonthKey(debt.nextDueMonth) && monthDiff(debt.nextDueMonth, monthKey) >= 0 && !(debt.paidMonths || []).includes(monthKey));
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
      { label: 'Käufe / Zuordnungen', value: String(summary.entries) }
    ]));
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = 'Wenn du einen Kauf zu Sonstige Ausgaben verschiebst, wird er hier entfernt und der freie Rest der Steuererstattung steigt automatisch wieder.';
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
      ['Verfügbar', now.free - prev.free],
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
      const goodForFree = label === 'Verfügbar' ? diff >= 0 : diff <= 0;
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
    const unpaidDebts = state.debts.filter((d) => Number(d.amountOpen || 0) > 0 && isMonthKey(d.nextDueMonth) && monthDiff(d.nextDueMonth, monthKey) >= 0 && !(Array.isArray(d.paidMonths) ? d.paidMonths : []).includes(monthKey)).length;
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
  // Beim Öffnen immer den echten aktuellen Monat anzeigen.
  // Ältere Monate bleiben über die Monatsauswahl bearbeitbar, werden aber nicht mehr als Startmonat festgehalten.
  let currentMonth = startMonthKey;
  let monthList = getSelectableMonths(currentMonth);
  normalizeSavingsGoalsConfig();
  normalizeAppMeta();
  if (state.appMeta.selectedMonth !== startMonthKey || state.appMeta.lastAutoMonthCheck !== startMonthKey) {
    state.appMeta.selectedMonth = startMonthKey;
    state.appMeta.lastAutoMonthCheck = startMonthKey;
    saveState();
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
  let forecastHorizon = 6;
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
  function parseMoneyInput(value) {
    if (typeof value === 'number') return value;
    const cleaned = String(value ?? '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/€/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
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
      const baseAmount = getPersonBaseNetForMonth(person, month);
      if (Math.abs(baseAmount - numericAmount) < 0.000001) delete person.netOverrides[month];
      else person.netOverrides[month] = numericAmount;
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
    if (person.netOverrides && person.netOverrides[month] != null) return 'nur dieser Monat';
    const activeTimeline = getActiveNetTimelineEntry(person, month);
    if (activeTimeline) {
      return activeTimeline.month === month ? 'dauerhaft ab diesem Monat' : `dauerhaft seit ${formatMonthLabel(activeTimeline.month)}`;
    }
    return 'Standardwert';
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
    const account = getAccountById(accountId);
    if (!account) return null;
    if (!Array.isArray(account.transactions)) account.transactions = [];
    const id = typeof tx.id === 'string' && tx.id ? tx.id : generateId();
    if (findAccountTransaction(account, id)) return id;
    const amount = Number(tx.amount || 0);
    account.transactions.push({
      id,
      month: isMonthKey(tx.month) ? tx.month : startMonthKey,
      date: typeof tx.date === 'string' ? tx.date : new Date().toISOString().slice(0, 10),
      type: typeof tx.type === 'string' ? tx.type : 'manual',
      sourceId: typeof tx.sourceId === 'string' ? tx.sourceId : '',
      label: typeof tx.label === 'string' ? tx.label : 'Buchung',
      amount,
      note: typeof tx.note === 'string' ? tx.note : '',
      createdAt: new Date().toISOString()
    });
    account.balance = Number(account.balance || 0) + amount;
    if (account.id === DEFAULT_SHARED_ACCOUNT_ID) state.commonAccount.currentBalance = Number(account.balance || 0);
    return id;
  }

  function removeAccountTransaction(accountId, txId) {
    const account = getAccountById(accountId);
    if (!account || !Array.isArray(account.transactions) || !txId) return false;
    const idx = account.transactions.findIndex((tx) => tx && tx.id === txId);
    if (idx < 0) return false;
    const tx = account.transactions[idx];
    account.balance = Number(account.balance || 0) - Number(tx.amount || 0);
    account.transactions.splice(idx, 1);
    if (account.id === DEFAULT_SHARED_ACCOUNT_ID) state.commonAccount.currentBalance = Number(account.balance || 0);
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
    return removeAccountTransaction(found.account.id, found.tx.id);
  }

  function upsertAccountTransaction(accountId, tx) {
    if (!accountId || !getAccountById(accountId) || !tx || !tx.sourceId) return null;
    const amount = Number(tx.amount || 0);
    const existing = findAccountTransactionBySource(tx.sourceId);
    if (existing) {
      if (existing.account.id === accountId && Math.abs(Number(existing.tx.amount || 0) - amount) < 0.005) {
        existing.tx.label = tx.label || existing.tx.label;
        existing.tx.month = isMonthKey(tx.month) ? tx.month : existing.tx.month;
        existing.tx.date = tx.date || existing.tx.date;
        existing.tx.type = tx.type || existing.tx.type;
        if (typeof tx.note === 'string') existing.tx.note = tx.note;
        return existing.tx.id;
      }
      removeAccountTransaction(existing.account.id, existing.tx.id);
    }
    return addAccountTransaction(accountId, tx);
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
    if (!post || !isMonthKey(month)) return null;
    ensurePostBookingConfig(post);
    const sourceId = getPostAccountTransactionSource(post, month);
    if (!sourceId) return null;
    const transferSourceId = `${sourceId}:transfer`;
    if (!paid) {
      removeAccountTransactionBySource(sourceId);
      deleteAccountTransferBySource(transferSourceId);
      return null;
    }
    const accountId = inferAccountIdForPost(post);
    if (!accountId) return null;
    post.accountId = accountId;
    const amount = Number(getEffectiveAmountForMonth(post, month) || 0);
    if (!(amount > 0)) return null;
    if (post.bookingType === 'transfer') {
      removeAccountTransactionBySource(sourceId);
      if (!post.transferToAccountId || !getAccountById(post.transferToAccountId)) {
        alert('Für diese Zahlung ist „Umbuchung“ gewählt, aber kein Zielkonto hinterlegt. Bitte Posten bearbeiten und Zielkonto auswählen.');
        return null;
      }
      return addAccountTransfer(accountId, post.transferToAccountId, amount, post.name || 'Umbuchung', month, '', { sourceId: transferSourceId, label: `${post.name || 'Umbuchung'} ${formatMonthLabel(month)}` });
    }
    deleteAccountTransferBySource(transferSourceId);
    return upsertAccountTransaction(accountId, {
      month,
      type: 'expense',
      sourceId,
      label: `${post.name || 'Ausgabe'} ${formatMonthLabel(month)}`,
      amount: -amount
    });
  }


  function isPostBookedForMonth(post, month) {
    if (!post || !isMonthKey(month)) return false;
    const sourceId = getPostAccountTransactionSource(post, month);
    return !!findAccountTransactionBySource(sourceId) || !!findAccountTransactionBySource(`${sourceId}:transfer`);
  }

  function bookPostPaymentForMonth(post, month) {
    ensurePostConfig(post);
    if (!isMonthKey(month)) return false;
    if (!isPostPaidForMonth(post, month)) setPostPaidForMonth(post, month, true);
    const tx = applyPostAccountBooking(post, month, true);
    if (tx) addChangeLog('Konten', `${post.name || 'Posten'} für ${formatMonthLabel(month)} gebucht.`, month);
    return !!tx;
  }

  function unbookPostPaymentForMonth(post, month) {
    if (!post || !isMonthKey(month)) return false;
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
    const details = computeMonthDetails(month);
    const row = (details.personsData || []).find((pd) => pd.person && pd.person.id === personId);
    return row ? Number(row.commonShare || 0) : 0;
  }

  function applyContributionAccountBooking(month, personId, paid) {
    if (!isMonthKey(month) || !personId) return null;
    const sourceId = `contribution:${personId}:${month}`;
    if (!paid) {
      removeAccountTransactionBySource(sourceId);
      return null;
    }
    const shared = getSharedAccount();
    if (!shared) return null;
    const person = getPersonById(personId);
    const amount = getContributionAmountForPerson(month, personId);
    if (!(amount > 0)) return null;
    return upsertAccountTransaction(shared.id, {
      month,
      type: 'contribution',
      sourceId,
      label: `Monatsanteil ${person ? person.name : personId} ${formatMonthLabel(month)}`,
      amount
    });
  }

  function isContributionAccountBooked(month, personId) {
    return !!findAccountTransactionBySource(`contribution:${personId}:${month}`);
  }

  function normalizeAccountTransfersConfig() {
    if (!state) return;
    if (!Array.isArray(state.accountTransfers)) state.accountTransfers = [];
    state.accountTransfers = state.accountTransfers
      .filter((tr) => tr && typeof tr === 'object')
      .map((tr) => ({
        id: typeof tr.id === 'string' && tr.id ? tr.id : generateId(),
        month: isMonthKey(tr.month) ? tr.month : startMonthKey,
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

  function addAccountTransfer(fromAccountId, toAccountId, amount, note = '', month = currentMonth, date = '', options = {}) {
    normalizeAccountTransfersConfig();
    const value = Number(amount || 0);
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId || !(value > 0)) return false;
    const sourceId = typeof options.sourceId === 'string' ? options.sourceId : '';
    if (sourceId && (state.accountTransfers || []).some((tr) => tr.sourceId === sourceId)) return true;
    const id = generateId();
    const safeMonth = isMonthKey(month) ? month : currentMonth;
    const labelBase = options.label || `Umbuchung ${getAccountName(fromAccountId)} → ${getAccountName(toAccountId)}`;
    const outId = upsertAccountTransaction(fromAccountId, { month: safeMonth, date, type: 'transfer_out', sourceId: `transfer:${id}:out`, label: labelBase, amount: -value, note });
    const inId = upsertAccountTransaction(toAccountId, { month: safeMonth, date, type: 'transfer_in', sourceId: `transfer:${id}:in`, label: labelBase, amount: value, note });
    if (!outId || !inId) return false;
    state.accountTransfers.push({ id, month: safeMonth, date: date || new Date().toISOString().slice(0, 10), fromAccountId, toAccountId, amount: value, note, outTransactionId: outId, inTransactionId: inId, sourceId });
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
    removeAccountTransaction(tr.fromAccountId, tr.outTransactionId);
    removeAccountTransaction(tr.toAccountId, tr.inTransactionId);
    state.accountTransfers = state.accountTransfers.filter((item) => item.id !== transferId);
    addChangeLog('Konten', `Umbuchung ${euro(tr.amount)} gelöscht.`, tr.month);
    return true;
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
        dayOfMonth: Number.isFinite(Number(tpl.dayOfMonth)) ? Math.min(31, Math.max(1, Math.round(Number(tpl.dayOfMonth)))) : 1,
        note: typeof tpl.note === 'string' ? tpl.note : '',
        isMonthly: tpl.isMonthly !== false,
        createdAt: typeof tpl.createdAt === 'string' ? tpl.createdAt : ''
      }))
      .filter((tpl) => tpl.fromAccountId && tpl.toAccountId && tpl.fromAccountId !== tpl.toAccountId && tpl.amount > 0);
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
    const after = Number(account.balance || 0) - Number(amount || 0);
    if (after < 0) return `Achtung: ${account.name} wäre danach ${euro(Math.abs(after))} im Minus.`;
    return `${account.name} hätte danach ${euro(after)}.`;
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
    const content = document.createElement('div');
    content.className = 'modal-form';
    const intro = document.createElement('div');
    intro.className = 'notice success';
    intro.innerHTML = `<strong>Kontenabgleich</strong><br>Trage den echten Bank-Kontostand ein. Die App erstellt automatisch eine Ausgleichsbuchung über die Differenz, damit App und Konto wieder übereinstimmen.`;
    content.appendChild(intro);

    const row = document.createElement('div');
    row.className = 'row';
    const appBalance = document.createElement('div');
    appBalance.className = 'metric-card compact-metric';
    appBalance.innerHTML = `<span>App-Kontostand</span><strong>${euro(currentBalance)}</strong>`;
    const realInput = document.createElement('input');
    realInput.type = 'number';
    realInput.step = '0.01';
    realInput.value = currentBalance.toFixed(2);
    row.appendChild(appBalance);
    row.appendChild(createLabelInput('Echter Kontostand laut Bank', realInput));
    content.appendChild(row);

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
      const real = Number(realInput.value || 0);
      const diff = real - currentBalance;
      diffBox.className = `notice ${Math.abs(diff) < 0.005 ? 'success' : (diff > 0 ? 'success' : 'warning')}`;
      diffBox.innerHTML = `<strong>Differenz:</strong> ${euro(diff)}<br><span class="small muted">${Math.abs(diff) < 0.005 ? 'Keine Ausgleichsbuchung nötig.' : (diff > 0 ? 'Die App bucht eine Gutschrift auf das Konto.' : 'Die App bucht eine Abbuchung vom Konto.')}</span>`;
    };
    realInput.addEventListener('input', updateDiff);
    updateDiff();

    showModal(`Kontostand abgleichen · ${account.name}`, content, [
      { label: 'Abbrechen', className: 'secondary' },
      { label: 'Abgleich speichern', className: 'primary', onClick: (close) => {
        const real = Number(realInput.value || 0);
        if (!Number.isFinite(real)) return alert('Bitte einen gültigen Kontostand eintragen.');
        const latest = getAccountById(account.id);
        if (!latest) return alert('Konto wurde nicht gefunden.');
        const current = Number(latest.balance || 0);
        const diff = real - current;
        const now = new Date().toISOString();
        const note = noteInput.value || '';
        if (Math.abs(diff) >= 0.005) {
          addAccountTransaction(latest.id, {
            month: currentMonth,
            date: dateInput.value || new Date().toISOString().slice(0, 10),
            type: 'reconcile',
            sourceId: `reconcile:${latest.id}:${Date.now()}`,
            label: `Kontenabgleich ${formatMonthLabel(currentMonth)}`,
            amount: diff,
            note
          });
          addChangeLog('Konten', `${latest.name}: Kontenabgleich ${euro(diff)} auf echten Stand ${euro(real)}.`, currentMonth);
        } else {
          addChangeLog('Konten', `${latest.name}: Kontostand geprüft, keine Differenz.`, currentMonth);
        }
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

  function setPersonIncomeReceived(person, month, received, accountId) {
    ensurePersonIncomeConfig(person);
    if (!isMonthKey(month)) return false;
    const existing = getPersonIncomeReceivedEntry(person, month);
    if (received) {
      if (existing) return true;
      const targetAccountId = accountId || getPersonIncomeAccountId(person);
      if (!targetAccountId || !getAccountById(targetAccountId)) {
        alert('Bitte zuerst ein Zielkonto für den Lohn auswählen.');
        return false;
      }
      const amount = Number(getPersonNet(person, month) || 0);
      const txId = addAccountTransaction(targetAccountId, {
        month,
        type: 'income',
        sourceId: `income:${person.id}:${month}`,
        label: `Lohn ${person.name || ''} ${formatMonthLabel(month)}`.trim(),
        amount
      });
      if (!txId) return false;
      person.incomeReceived[month] = {
        accountId: targetAccountId,
        amount,
        receivedAt: new Date().toISOString(),
        transactionId: txId
      };
      addChangeLog('Einkommen', `${person.name}: Lohn ${euro(amount)} für ${formatMonthLabel(month)} erhalten und auf ${getAccountName(targetAccountId)} gebucht.`, month);
      return true;
    }
    if (existing) {
      removeAccountTransaction(existing.accountId, existing.transactionId);
      addChangeLog('Einkommen', `${person.name}: Lohn-Eingang für ${formatMonthLabel(month)} rückgängig gemacht.`, month);
      delete person.incomeReceived[month];
    }
    return true;
  }

  function ensurePostConfig(post) {
    ensurePostScheduleConfig(post);
    ensurePostAmountConfig(post);
    ensurePostPaymentConfig(post);
    ensureLinkedDebtField(post);
    ensureAccountLinkField(post);
    ensurePostBookingConfig(post);
  }

  function ensurePostBookingConfig(post) {
    if (!post || typeof post !== 'object') return;
    if (!['expense', 'transfer'].includes(post.bookingType)) post.bookingType = 'expense';
    if (typeof post.transferToAccountId !== 'string') post.transferToAccountId = '';
    if (post.bookingType === 'transfer' && post.transferToAccountId && !getAccountById(post.transferToAccountId)) post.transferToAccountId = '';
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
  function setPostPaidForMonth(post, month, paid) {
    ensurePostConfig(post);
    if (!isMonthKey(month)) return false;
    if (paid) {
      freezePostAmountForMonth(post, month);
      if (!post.paidMonths.includes(month)) post.paidMonths.push(month);
      // Ab 1.93: Der Bezahlt-Haken ist nur Status. Kontobuchungen erfolgen nur über „Bezahlt + buchen“.
    } else {
      post.paidMonths = post.paidMonths.filter((m) => m !== month);
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

  function roundUpToNextFive(value) {
    const num = Number(value || 0);
    if (num <= 0) return 0;
    return Math.ceil(num / 5) * 5;
  }

  function floorToFive(value) {
    const num = Number(value || 0);
    if (num <= 0) return 0;
    return Math.floor(num / 5) * 5;
  }

  function getFoodMoneyPosts() {
    return (state.personalCosts || []).filter((post) => String(post && post.name || '').toLowerCase().includes('einkaufsgeld'));
  }

  function getFoodMoneyPlannedTarget(monthKey = currentMonth) {
    // Zielbetrag bleibt eine feste Plan-Größe und wird nicht durch spätere Aufstockungs-Overrides verfälscht.
    // Ab Juni 2026 gilt das Einkaufsgeld mit 550 €, die Rest-Aufstockung startet weiterhin erst ab Juli 2026.
    const cfg = getBudgetTopUpConfig('groceries');
    if (isMonthKey(monthKey) && cfg && isMonthKey(cfg.targetStartMonth) && monthDiff(cfg.targetStartMonth, monthKey) >= 0) {
      return Math.max(0, Number(cfg.targetAmount || 550));
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
      source = 'Einkaufsgeld-Zielbetrag';
    }
    const balance = active ? getBudgetTopUpBalance(type, monthKey) : 0;
    const missing = Math.max(0, target - balance);
    const topUp = active ? roundUpToNextFive(missing) : target;
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
    const perCar = { bennyKm: 0, madeleineKm: 0, bennyLiters: 0, madeleineLiters: 0 };
    ['benny','madeleine'].forEach((key) => {
      const cfg = getTankCalcData(key);
      const personKm = Number(cfg && cfg.kmPerMonth || 0);
      const consumption = Number(cfg && cfg.consumption || 0);
      const personLiters = (personKm / 100) * consumption;
      km += personKm;
      liters += personLiters;
      perCar[`${key}Km`] = personKm;
      perCar[`${key}Liters`] = personLiters;
    });
    const gross = liters * priceUsed;
    const cashback = Math.max(0, Number(avgCashback || 0));
    return { priceUsed, km, liters, gross, cashback, net: Math.max(0, gross - cashback), ...perCar };
  }

  function getTankHouseholdMonthlyRecord(monthKey) {
    const b = getTankMonthlyRecord('benny', monthKey);
    const m = getTankMonthlyRecord('madeleine', monthKey);
    return {
      month: monthKey,
      km: Number(b.km || 0) + Number(m.km || 0),
      liters: Number(b.liters || 0) + Number(m.liters || 0),
      paid: Number(b.paid || 0) + Number(m.paid || 0),
      cashback: Number(b.cashback || 0) + Number(m.cashback || 0),
      netCost: Number(b.netCost || 0) + Number(m.netCost || 0),
      receiptCount: Number(b.receiptCount || 0) + Number(m.receiptCount || 0),
      bennyNet: Number(b.netCost || 0),
      madeleineNet: Number(m.netCost || 0),
      bennyKm: Number(b.km || 0),
      madeleineKm: Number(m.km || 0)
    };
  }

  function getTankHouseholdRealMonthlyRecords(baseMonth = currentMonth) {
    const months = new Set();
    ['benny','madeleine'].forEach((key) => {
      getTankRealMonthlyRecords(key, baseMonth).forEach((entry) => months.add(entry.month));
    });
    return Array.from(months)
      .sort((a, b) => String(b).localeCompare(String(a)))
      .map((month) => getTankHouseholdMonthlyRecord(month))
      .filter((entry) => Number(entry.netCost || 0) > 0 || Number(entry.km || 0) > 0 || Number(entry.liters || 0) > 0);
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
      acc.bennyNet += Number(entry.bennyNet || 0);
      acc.madeleineNet += Number(entry.madeleineNet || 0);
      acc.bennyKm += Number(entry.bennyKm || 0);
      acc.madeleineKm += Number(entry.madeleineKm || 0);
      return acc;
    }, { km: 0, liters: 0, paid: 0, cashback: 0, net: 0, bennyNet: 0, madeleineNet: 0, bennyKm: 0, madeleineKm: 0 });
    const avgCashbackReal = realCount ? totals.cashback / realCount : 0;
    const projectedCount = Math.max(0, targetMonths - realCount);
    const projectedUnit = getTankHouseholdManualForecastValue(avgCashbackReal);
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
    if (totalKm > 0 && keyKm > 0) return Math.max(0, Math.min(1, keyKm / totalKm));
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

  function calculateTankBudget(cfg, personKey = '') {
    const key = personKey || (cfg === (state.tankCalc && state.tankCalc.madeleine) ? 'madeleine' : 'benny');
    const householdStats = getTankHouseholdAverageStats(currentMonth, 12);
    const share = getTankForecastShare(key, currentMonth);
    if (householdStats && householdStats.basisMonths === 12) {
      const raw = householdStats.avgNet * share;
      return {
        priceUsed: householdStats.projectedUnit && householdStats.projectedUnit.priceUsed ? householdStats.projectedUnit.priceUsed : 0,
        raw,
        rounded: roundUpToNextFive(raw),
        source: householdStats.projectedCount > 0
          ? `Gesamt-12-Monats-Schnitt nach km-Anteil (${householdStats.realCount} echt + ${householdStats.projectedCount} Prognose)`
          : 'Gesamt-12-Monats-Schnitt nach km-Anteil (12 echte Monate)',
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
    const liters = Math.max(0, Number(receipt && receipt.liters || 0));
    const paid = Math.max(0, Number(receipt && receipt.paid || 0));
    const cashback = Math.max(0, Number(receipt && receipt.cashback || 0));
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
        benny: Math.max(0, Number(allocations.benny || receipt && receipt.bennyLiters || 0)),
        madeleine: Math.max(0, Number(allocations.madeleine || receipt && receipt.madeleineLiters || 0))
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

  function getTankReceiptStatsForMonth(personKey, monthKey) {
    const stats = { liters: 0, paid: 0, cashback: 0, netCost: 0, receiptCount: 0 };
    getTankReceipts().filter((r) => r.month === monthKey).forEach((receipt) => {
      const allocatedLiters = Math.max(0, Number(receipt.allocations && receipt.allocations[personKey] || 0));
      if (allocatedLiters <= 0 || receipt.liters <= 0) return;
      const ratio = Math.min(1, allocatedLiters / receipt.liters);
      stats.liters += allocatedLiters;
      stats.paid += receipt.paid * ratio;
      stats.cashback += receipt.cashback * ratio;
      stats.netCost += receipt.netCost * ratio;
      stats.receiptCount += 1;
    });
    return stats;
  }

  function getTankMonthlyRecord(personKey, monthKey) {
    const entry = getTankEntryForMonth(personKey, monthKey) || { month: monthKey };
    const receiptStats = getTankReceiptStatsForMonth(personKey, monthKey);
    const hasReceipts = receiptStats.receiptCount > 0;
    return {
      month: monthKey,
      startKm: Number(entry.startKm || 0),
      endKm: Number(entry.endKm || 0),
      km: Number(entry.km || 0),
      liters: hasReceipts ? receiptStats.liters : Number(entry.liters || 0),
      paid: hasReceipts ? receiptStats.paid : Number(entry.paid || 0),
      cashback: hasReceipts ? receiptStats.cashback : Number(entry.cashback || 0),
      netCost: hasReceipts ? receiptStats.netCost : Number(entry.netCost || 0),
      receiptCount: receiptStats.receiptCount,
      note: entry.note || ''
    };
  }

  function getTankRealMonthlyRecords(personKey, baseMonth = currentMonth) {
    const months = new Set();
    getTankMonthlyEntries(personKey).forEach((entry) => {
      if (monthDiff(entry.month, baseMonth) <= 0) months.add(entry.month);
    });
    getTankReceipts().forEach((receipt) => {
      if (monthDiff(receipt.month, baseMonth) <= 0 && Number(receipt.allocations && receipt.allocations[personKey] || 0) > 0) months.add(receipt.month);
    });
    return Array.from(months)
      .sort((a, b) => String(b).localeCompare(String(a)))
      .map((month) => getTankMonthlyRecord(personKey, month))
      .filter((entry) => Number(entry.netCost || 0) > 0 || Number(entry.km || 0) > 0 || Number(entry.liters || 0) > 0);
  }

  function normalizeTankMonthlyEntry(entry) {
    const startKm = Number(entry && entry.startKm || 0);
    const endKm = Number(entry && entry.endKm || 0);
    const km = Math.max(0, endKm - startKm);
    const liters = Math.max(0, Number(entry && entry.liters || 0));
    const paid = Math.max(0, Number(entry && entry.paid || 0));
    const cashback = Math.max(0, Number(entry && entry.cashback || 0));
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

  function getTankAverageStats(personKey, baseMonth = currentMonth, maxMonths = 12) {
    const targetMonths = Math.max(1, Number(maxMonths || 12));
    const cfg = getTankCalcData(personKey);
    const entries = getTankRealMonthlyRecords(personKey, baseMonth).slice(0, targetMonths);
    const realCount = entries.length;
    const totals = entries.reduce((acc, entry) => {
      acc.km += Number(entry.km || 0);
      acc.liters += Number(entry.liters || 0);
      acc.paid += Number(entry.paid || 0);
      acc.cashback += Number(entry.cashback || 0);
      acc.net += Number(entry.netCost || 0);
      return acc;
    }, { km: 0, liters: 0, paid: 0, cashback: 0, net: 0 });
    const avgCashbackReal = realCount ? totals.cashback / realCount : 0;
    const projectedCount = Math.max(0, targetMonths - realCount);
    const projectedUnit = getTankManualForecastValue(cfg, avgCashbackReal);
    const projectedNetTotal = projectedCount * projectedUnit.net;
    const basisMonths = realCount + projectedCount;
    const combinedNet = totals.net + projectedNetTotal;
    const avgNet = basisMonths ? combinedNet / basisMonths : 0;
    const avgKm = basisMonths ? (totals.km + projectedCount * projectedUnit.km) / basisMonths : 0;
    const avgLiters = basisMonths ? (totals.liters + projectedCount * ((projectedUnit.km / 100) * projectedUnit.consumption)) / basisMonths : 0;
    const realConsumption = totals.km > 0 ? (totals.liters / totals.km) * 100 : 0;
    return {
      count: basisMonths,
      realCount,
      projectedCount,
      basisMonths,
      entries,
      totals,
      projectedUnit,
      projectedNetTotal,
      avgNet,
      avgKm,
      avgLiters,
      realConsumption,
      roundedBudget: roundUpToNextFive(avgNet)
    };
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
        const msg = err && err.message ? err.message : 'Standort konnte nicht geladen werden. Trage alternativ einen Standort im Kraftstoffkonto ein.';
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

  function getTankCalculatedBudget(personKey) {
    const cfg = getTankCalcData(personKey);
    const tankBudget = calculateTankBudget(cfg, personKey);
    const fuelPool = getFuelTopUpAllocation(currentMonth);
    if (fuelPool.active) {
      return Number(fuelPool.allocations && fuelPool.allocations[personKey] || 0);
    }
    return Number(tankBudget.rounded || 0);
  }

  function syncTankgeldExpense(personKey, options = {}) {
    const calculated = getTankCalculatedBudget(personKey);
    const cfg = getTankCalcData(personKey);
    const tankBudgetSource = calculateTankBudget(cfg, personKey);
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
        startMonth: currentMonth,
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
    if (!existing.startMonth || !isMonthKey(existing.startMonth)) existing.startMonth = currentMonth;

    const currentIsPaid = isPostPaidForMonth(existing, currentMonth);
    const targetMonth = currentIsPaid ? nextMonth(currentMonth) : currentMonth;
    setPostAmountForMonth(existing, targetMonth, calculated, 'future');
    if (currentIsPaid) {
      addChangeLog('Tankgeld', `${existing.name}: aktueller Monat ist bezahlt, neuer Betrag ${calculated.toFixed(2)} € gilt ab ${formatMonthLabel(targetMonth)}`, targetMonth);
    } else {
      addChangeLog('Tankgeld', `${existing.name}: automatisch auf ${calculated.toFixed(2)} € aktualisiert`, currentMonth);
    }
    return true;
  }

  function syncAllTankgeldExpenses(options = {}) {
    const okBenny = syncTankgeldExpense('benny', { silent: true });
    const okMadeleine = syncTankgeldExpense('madeleine', { silent: true });
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
    free.textContent = `Frei: ${euro(details.free)}`;
    free.className = details.free < 0 ? 'negative' : 'positive';
    const common = document.createElement('span');
    common.textContent = `Gemeinsam: ${euro(details.totalCommonRounded)}`;
    const personal = document.createElement('span');
    personal.textContent = `Persönlich: ${euro(details.totalPersonal)}`;
    meta.appendChild(free);
    meta.appendChild(common);
    meta.appendChild(personal);

    globalMonthBar.appendChild(labelWrap);
    globalMonthBar.appendChild(controls);
    globalMonthBar.appendChild(meta);
  }

  function render() {
    try { syncCurrentMonthToActualDate(); } catch (error) { console.error('Monatsprüfung fehlgeschlagen', error); }
    try { renderGlobalMonthBar(); } catch (error) { console.error('Monatsleiste fehlgeschlagen', error); }

    if (sectionSelect && sectionSelect.value !== currentSection) {
      sectionSelect.value = currentSection;
    }
    sectionButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === currentSection);
    });
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
      sharedaccount: ['Konten', sharedAccountSection, renderSharedAccount],
      personal: ['Persönliche Ausgaben', personalSection, renderPersonal],
      buffer: ['Sonstige Ausgaben', bufferSection, renderBufferExpenses],
      tankcalc: ['Kraftstoffkonto', tankCalcSection, renderTankCalc],
      debts: ['Schulden', debtsSection, renderDebts],
      settings: ['Regeln & Personen', settingsSection, renderSettings],
      savings: ['Rücklagen & Sparen', savingsSection, renderSavings],
      pots: ['Töpfe', potsSection, renderPots],
      monthclose: ['Monatsabschluss', monthCloseSection, renderMonthClose],
      datacheck: ['Datencheck', dataCheckSection, renderDataCheck],
      forecast: ['Vorschau & Simulation', forecastSection, renderForecast],
      save: ['Sichern', saveSection, renderSave],
      taxrefund: ['Steuererstattung', taxRefundSection, renderTaxRefund]
    };
    const step = renderMap[currentSection] || renderMap.overview;
    runRenderStep(step[0], step[1], step[2]);

    try { enableTableSorting(); } catch (error) { console.error('Tabellensortierung fehlgeschlagen', error); }
    try { prepareResponsiveTables(); } catch (error) { console.error('Responsive Tabellen fehlgeschlagen', error); }
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
      closeActionMenus(menu);
      menu.classList.toggle('open', willOpen);
      toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) positionActionMenuPanel(menu, toggle, panel);
    });
    menu.appendChild(toggle);

    const panel = document.createElement('div');
    panel.className = 'action-menu-panel';
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


  function normalizeDataCheckAreaName(area) {
    const raw = String(area || 'System').trim();
    if (raw === 'Tankgeld') return 'Kraftstoffkonto';
    if (raw === 'Rücklagen') return 'Rücklagen & Sparen';
    if (raw === 'Monat') return 'Monatsauswahl';
    if (raw.startsWith('Persönlich')) return 'Persönliche Ausgaben';
    return raw || 'System';
  }

  function getDataCheckAreaDefinitions() {
    return [
      { key: 'Einkommen', label: 'Einkommen', section: 'income' },
      { key: 'Konten', label: 'Konten', section: 'sharedaccount' },
      { key: 'Gemeinsame Kosten', label: 'Gemeinsame Kosten', section: 'common' },
      { key: 'Persönliche Ausgaben', label: 'Persönliche Ausgaben', section: 'personal' },
      { key: 'Sonstige Ausgaben', label: 'Sonstige Ausgaben', section: 'buffer' },
      { key: 'Schulden', label: 'Schulden', section: 'debts' },
      { key: 'Kraftstoffkonto', label: 'Kraftstoffkonto', section: 'tankcalc' },
      { key: 'Einkaufsgeld', label: 'Einkaufsgeld', section: 'personal' },
      { key: 'Steuererstattung', label: 'Steuererstattung', section: 'taxrefund' },
      { key: 'Rücklagen & Sparen', label: 'Rücklagen & Sparen', section: 'savings' },
      { key: 'Töpfe', label: 'Töpfe', section: 'pots' },
      { key: 'Monatsabschluss', label: 'Monatsabschluss', section: 'monthclose' },
      { key: 'Offene Zahlungen', label: 'Offene Zahlungen', section: 'openpayments' },
      { key: 'Monatsstart', label: 'Monatsstart', section: 'monthstart' },
      { key: 'Monatsauswahl', label: 'Monatsauswahl', section: 'overview' },
      { key: 'System', label: 'System', section: 'save' }
    ];
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
              detail: `${formatMonthLabel(checkMonth)}: Posten ${postAmount.toFixed(2)} € · Schuld ${debtRate.toFixed(2)} €. Über „Daten reparieren“ bzw. Speichern wird die Schuld synchronisiert.`
            });
          }
        });
        if (isDue(post, currentMonth) && linked.nextDueMonth !== currentMonth && !linked.paidMonths.includes(currentMonth) && Number(linked.amountOpen || 0) > 0) {
          items.push({
            kind: 'warning',
            area,
            title: `Fälligkeit weicht ab: ${post.name}`,
            detail: `Posten ist in ${formatMonthLabel(currentMonth)} fällig, die Schuld steht aber auf ${linked.nextDueMonth || 'keinen Monat'}. Beim Bezahlen wird die Zahlung trotzdem übernommen und die nächste Fälligkeit sauber weitergezogen.`
          });
        }
      }
    });

    (state.persons || []).forEach((person) => {
      ensurePersonIncomeConfig(person);
      const activeTimeline = getActiveNetTimelineEntry(person, currentMonth);
      if (activeTimeline && Math.abs(Number(activeTimeline.amount || 0) - Number(person.net || 0)) > 0.01) {
        items.push({
          kind: 'warning',
          area: 'Einkommen',
          title: `${person.name}: Dauerwert überdeckt Standard-Netto`,
          detail: `Aktiv ist ${Number(activeTimeline.amount || 0).toFixed(2)} € seit ${formatMonthLabel(activeTimeline.month)}, Standard ist ${Number(person.net || 0).toFixed(2)} €. Im Einkommen-Bereich kannst du den Standard ab ${formatMonthLabel(currentMonth)} übernehmen.`
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
            detail: `Laut MKK-Ratenplan startet die Forderung mit 3.208,32 €. Bei bisher gespeicherten Zahlungen von ${paidTotal.toFixed(2)} € müsste offen ${expectedOpen.toFixed(2)} € sein; gespeichert sind ${Number(debt.amountOpen || 0).toFixed(2)} €.`
          });
        }
      }
      linkedPosts.forEach(({ post }) => {
        const paidMonths = Array.isArray(post.paidMonths) ? post.paidMonths : [];
        paidMonths.forEach((paidMonth) => {
          if (!isMonthKey(paidMonth)) return;
          if (!isDue(post, paidMonth)) return;
          const hasHistory = (debt.paymentHistory || []).some((entry) => entry && entry.month === paidMonth && Number(entry.amount || 0) > 0);
          if (!hasHistory && Number(debt.amountOpen || 0) > 0) {
            items.push({
              kind: 'warning',
              area: 'Schulden',
              title: `Bezahlter Posten ohne Schuldzahlung: ${debt.name}`,
              detail: `${post.name} ist in ${formatMonthLabel(paidMonth)} als bezahlt markiert, aber in der Schuld gibt es keine passende Zahlungshistorie. Bitte prüfen, damit Restschuld und Nachweis zusammenpassen.`
            });
          }
        });
      });
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
          group,
          name: post.name || 'Posten',
          amount,
          accountId,
          accountName: getAccountName(accountId),
          section: getOpenPaymentSectionForGroup(group),
          note: post.linkedDebtId ? `verknüpft mit ${getLinkedDebtName(post) || 'Schuld'}` : ''
        });
      });
    };

    addPostRows(state.commonCosts, 'Gemeinsame Kosten');
    addPostRows(state.personalCosts, 'Persönliche Ausgaben');
    addPostRows(state.bufferExpenses, 'Sonstige Ausgaben');

    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      if (linkedDebtIds.has(debt.id)) return;
      const planned = Number(getDebtMonthAmount(debt, monthKey) || 0);
      const paid = Number(getDebtPaymentAmountForMonth(debt, monthKey) || 0);
      const open = Math.max(planned - paid, 0);
      if (!(open > 0.005)) return;
      const accountId = debt.accountId || '';
      rows.push({
        id: `debt:${debt.id || generateId()}:${monthKey}`,
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
      const key = row.accountId || '__unassigned__';
      if (!byAccount.has(key)) {
        byAccount.set(key, {
          accountId: row.accountId || '',
          account: row.accountId ? getAccountById(row.accountId) : null,
          name: row.accountId ? getAccountName(row.accountId) : 'Nicht zugeordnet',
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
      .filter((row) => !row.paid && Number(row.amount || 0) > 0.005)
      .map((row) => ({
        personId: row.person.id,
        name: `${row.person.name} Anteil Gemeinschaftskonto`,
        amount: Number(row.amount || 0),
        accountId: DEFAULT_SHARED_ACCOUNT_ID,
        accountName: getAccountName(DEFAULT_SHARED_ACCOUNT_ID)
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
      ? 'Die wichtigsten offenen Posten im ausgewählten Monat, gruppiert nach Konto.'
      : 'Hier siehst du alle offenen Zahlungen im ausgewählten Monat nach Konto gruppiert. So erkennst du sofort, was noch von welchem Konto bezahlt werden muss.';
    card.appendChild(p);

    const accountsMissing = data.groups.filter((group) => group.account && getAccountAvailability(group.account, monthKey).missing > 0).length;
    card.appendChild(createSummaryMetrics([
      { label: 'Offen gesamt', value: euro(data.totalOpen), kind: data.totalOpen > 0 ? 'warning' : 'success' },
      { label: 'Offene Posten', value: String(data.rows.length), hint: data.rows.length === 1 ? '1 Zahlung offen' : `${data.rows.length} Zahlungen offen` },
      { label: 'Konten mit Fehlbetrag', value: String(accountsMissing), kind: accountsMissing > 0 ? 'danger' : 'success' },
      { label: 'Offene Monatsanteile', value: euro(data.totalIncoming), kind: data.totalIncoming > 0 ? 'warning' : 'success' }
    ]));

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
      if (group.account) {
        const availability = getAccountAvailability(group.account, monthKey);
        const chip = createUiEl('span', `status-chip ${availability.missing > 0 ? 'danger' : 'success'}`, availability.missing > 0 ? `fehlt ${euro(availability.missing)}` : `verfügbar ${euro(availability.available)}`);
        header.appendChild(chip);
      } else {
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
      h3.textContent = 'Offene Monatsanteile fürs Gemeinschaftskonto';
      sub.appendChild(h3);
      const table = document.createElement('table');
      table.className = 'list-table compact-table';
      table.innerHTML = '<thead><tr><th>Person</th><th>Zielkonto</th><th>Offener Eingang</th><th></th></tr></thead>';
      const tbody = document.createElement('tbody');
      data.incoming.forEach((row) => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td'); tdName.textContent = row.name;
        const tdAccount = document.createElement('td'); tdAccount.textContent = row.accountName;
        const tdAmount = document.createElement('td'); tdAmount.textContent = euro(row.amount);
        const tdAction = document.createElement('td');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'secondary small-action';
        btn.textContent = 'Konten öffnen';
        btn.addEventListener('click', () => switchSection('sharedaccount'));
        tdAction.appendChild(btn);
        tr.appendChild(tdName); tr.appendChild(tdAccount); tr.appendChild(tdAmount); tr.appendChild(tdAction);
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
      if (Number(row.amount || 0) > 0) {
        add('Gemeinschaftskonto', `${row.person.name} Monatsanteil`, row.paid, row.paid ? `${euro(row.amount)} eingegangen.` : `${euro(row.amount)} noch offen.`, 'sharedaccount');
      }
    });

    const fuel = calculateBudgetTopUp('fuel', monthKey);
    const fuelCfg = getBudgetTopUpConfig('fuel');
    const fuelRestEntered = !fuel.active || Object.prototype.hasOwnProperty.call(fuelCfg.balances || {}, monthKey);
    add('Kraftstoffkonto', 'Rest Kraftstoffkonto eintragen', fuelRestEntered, fuel.active ? `Rest ${euro(fuel.balance)} · Aufstockung ${euro(fuel.topUp)}.` : 'Aufstockung startet erst ab Juli 2026.', 'tankcalc');

    const groceries = calculateBudgetTopUp('groceries', monthKey);
    const groceriesCfg = getBudgetTopUpConfig('groceries');
    const groceriesRestEntered = !groceries.active || Object.prototype.hasOwnProperty.call(groceriesCfg.balances || {}, monthKey);
    add('Einkaufsgeld', 'Rest Einkaufsgeld eintragen', groceriesRestEntered, groceries.active ? `Rest ${euro(groceries.balance)} · Aufstockung ${euro(groceries.topUp)}.` : 'Aufstockung startet erst ab Juli 2026.', 'tankcalc');

    const openPayments = collectOpenPaymentsForMonth(monthKey);
    add('Offene Zahlungen', 'Offene Zahlungen prüfen', openPayments.rows.length === 0, openPayments.rows.length ? `${openPayments.rows.length} offene Zahlung(en) · ${euro(openPayments.totalOpen)}.` : 'Keine offenen Zahlungen gefunden.', 'openpayments', 'Prüfen', openPayments.rows.length > 0);

    const accounts = state.accounts || [];
    if (accounts.length) {
      const reconciledThisMonth = accounts.filter((account) => {
        if (!account.lastReconciledAt) return false;
        const recDate = new Date(account.lastReconciledAt);
        if (Number.isNaN(recDate.getTime())) return false;
        return dateToMonthKey(recDate) === monthKey;
      }).length;
      add('Konten', 'Kontenabgleich prüfen', reconciledThisMonth === accounts.length, `${reconciledThisMonth} von ${accounts.length} Konto/Konten in ${formatMonthLabel(monthKey)} abgeglichen.`, 'sharedaccount', 'Konten öffnen');
    }

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
      alert(changes > 0 ? `${changes} Schuldenrate(n) wurden aus verknüpften Kostenposten synchronisiert.` : 'Keine automatische Schuldenkorrektur nötig. Einkommens-Dauerwerte bitte bewusst im Einkommen-Bereich übernehmen oder ändern.');
      render();
    });
    const repairHint = document.createElement('p');
    repairHint.className = 'small muted';
    repairHint.textContent = 'Synchronisiert verknüpfte Schuldenraten für die nächsten 36 Monate. Einkommens-Dauerwerte werden bewusst nicht automatisch gelöscht, sondern sichtbar angezeigt.';
    repairRow.appendChild(repairBtn);
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
      personsData.map((pd) => ({ person: pd.person, income: pd.income }))
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
    function appendSafe(parent, builder, label) {
      try {
        const node = typeof builder === 'function' ? builder() : builder;
        if (node) parent.appendChild(node);
        return node;
      } catch (err) {
        console.error(`Übersicht: ${label || 'Block'} konnte nicht geladen werden`, err);
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
        console.error(`Übersicht: ${label || 'Block'} konnte nicht geladen werden`, err);
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

    appendSafe(page, () => renderMonthStatusPanel(currentMonth, computeMonthDetails(currentMonth)), 'Monatsstatus');
    appendSafe(page, () => renderMonthStartChecklist(currentMonth, { compact: true }), 'Monatsstart');

    const kpiGrid = div('dash-kpi-grid');
    kpiGrid.appendChild(createKpi({
      label: 'Aktuell verfügbar',
      value: euro(totalAvail),
      hint: miscPaid > 0 ? `vor sonstigen Ausgaben: ${euro(totalAvailBeforeBuffer)}` : 'Monatsrest für Töpfe',
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


  function renderIncome() {
    if (!incomeSection) return;
    incomeSection.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'card income-page-card';

    const header = document.createElement('div');
    header.className = 'section-header';
    const currentLabel = formatMonthLabel(currentMonth);
    header.innerHTML = `<div><h2>Einkommen</h2><p class="muted">Hier pflegst du Standard-Netto, Monatsabweichung und dauerhafte Änderungen ab ${currentLabel}.</p></div>`;
    wrapper.appendChild(header);

    normalizeAllPersonConfigs();
    const totalNet = (state.persons || []).reduce((sum, person) => sum + getPersonNet(person, currentMonth), 0);
    const overrideCount = (state.persons || []).filter((person) => person.netOverrides && person.netOverrides[currentMonth] != null).length;
    wrapper.appendChild(createSummaryMetrics([
      { label: 'Netto gesamt', value: euro(totalNet), hint: currentLabel },
      { label: 'Personen', value: String((state.persons || []).length) },
      { label: 'Monatsabweichungen', value: String(overrideCount) }
    ]));

    wrapper.appendChild(renderIncomeBreakdownCard(getIncomeBreakdownForMonth(currentMonth), {
      monthKey: currentMonth,
      title: 'Aufteilung wie bisher in der Übersicht',
      subtitle: `Netto, gemeinsame Kosten, persönliche Ausgaben und verfügbar für ${currentLabel}`
    }));

    const info = document.createElement('div');
    info.className = 'info-box';
    info.innerHTML = '<strong>So funktioniert es:</strong> Standard-Netto gilt grundsätzlich. Eine Monatsabweichung zählt nur für den aktuell ausgewählten Monat. Dauerhafte Änderungen werden als Verlauf gespeichert und sind sichtbar, damit kein alter Wert heimlich den Standard überdeckt.';
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
      const sourceIsStandard = sourceLabel === 'Standardwert';

      const card = document.createElement('div');
      card.className = 'person-card income-card';

      const head = document.createElement('div');
      head.className = 'person-card-head';
      const left = document.createElement('div');
      left.innerHTML = `<span class="person-avatar">${(person.name || '?').charAt(0).toUpperCase()}</span><h3>${person.name || 'Person'}</h3>`;
      const badge = document.createElement('span');
      badge.className = `badge ${sourceIsStandard ? 'badge-ok' : 'badge-warn'}`;
      badge.textContent = hasOverride ? 'Abweichung aktiv' : (activeTimeline ? 'Dauerwert aktiv' : 'Standard aktiv');
      head.appendChild(left);
      head.appendChild(badge);
      card.appendChild(head);

      const metrics = document.createElement('div');
      metrics.className = 'person-metrics';
      metrics.innerHTML = `
        <div><span>Aktiv in ${currentLabel}</span><strong>${euro(active)}</strong></div>
        <div><span>Standard-Netto</span><strong>${euro(standard)}</strong></div>
        <div><span>Quelle</span><strong>${sourceLabel}</strong></div>
        <div><span>Verschiebung</span><strong>${euro(Number(person.shift || 0))}</strong></div>
      `;
      card.appendChild(metrics);

      if (activeTimeline && Math.abs(Number(activeTimeline.amount || 0) - standard) > 0.01) {
        const warn = document.createElement('div');
        warn.className = 'notice warning';
        warn.innerHTML = `<strong>Achtung:</strong> Ein gespeicherter Dauerwert seit ${formatMonthLabel(activeTimeline.month)} (${euro(activeTimeline.amount)}) überdeckt das Standard-Netto (${euro(standard)}).`;
        card.appendChild(warn);
      } else if (nextTimeline) {
        const hint = document.createElement('p');
        hint.className = 'small muted';
        hint.textContent = `Nächste dauerhafte Änderung: ${euro(nextTimeline.amount)} ab ${formatMonthLabel(nextTimeline.month)}.`;
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
      monthInput.placeholder = 'leer = Standard-Netto';
      monthInput.value = hasOverride ? formatNumberInput(Number(person.netOverrides[currentMonth])) : '';

      form.appendChild(createLabelInput('Standard-Netto', standardInput));
      form.appendChild(createLabelInput(`Abweichendes Netto nur ${currentLabel}`, monthInput));
      const shiftNote = document.createElement('p');
      shiftNote.className = 'small muted';
      shiftNote.textContent = `Ausgleich/Verschiebung: ${euro(Number(person.shift || 0))}. Dieser Wert wird nicht im Einkommen geändert, damit das Netto nicht versehentlich als Ausgleich gespeichert wird.`;
      form.appendChild(shiftNote);

      const incomeAccountRow = document.createElement('div');
      incomeAccountRow.className = 'row income-received-row';
      const incomeAccountSelect = createAccountSelect(getPersonIncomeAccountId(person), { includeNone: true });
      incomeAccountSelect.addEventListener('change', () => {
        setPersonIncomeAccount(person, incomeAccountSelect.value);
        saveState();
      });
      incomeAccountRow.appendChild(createLabelInput('Lohn-Zielkonto', incomeAccountSelect));
      const receivedEntry = getPersonIncomeReceivedEntry(person, currentMonth);
      const receivedBox = document.createElement('div');
      receivedBox.className = receivedEntry ? 'notice success income-received-status' : 'notice income-received-status';
      receivedBox.innerHTML = receivedEntry
        ? `<strong>Erhalten:</strong> ${euro(receivedEntry.amount)} auf ${getAccountName(receivedEntry.accountId)} gebucht.`
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
          alert('Bitte ein gültiges Standard-Netto eingeben.');
          return;
        }

        person.net = standardValue;
        ensurePersonIncomeConfig(person);

        if (monthRaw === '') {
          if (person.netOverrides && person.netOverrides[currentMonth] != null) {
            delete person.netOverrides[currentMonth];
            addChangeLog('Einkommen', `${person.name}: Monatsabweichung für ${currentLabel} gelöscht.`);
          } else {
            addChangeLog('Einkommen', `${person.name}: Standard-Netto auf ${euro(standardValue)} gesetzt.`);
          }
        } else {
          const monthValue = parseMoneyInput(monthRaw);
          if (!Number.isFinite(monthValue) || monthValue < 0) {
            alert('Bitte ein gültiges abweichendes Monats-Netto eingeben.');
            return;
          }
          person.netOverrides[currentMonth] = monthValue;
          addChangeLog('Einkommen', `${person.name}: abweichendes Netto für ${currentLabel} auf ${euro(monthValue)} gesetzt.`);
        }

        saveState();
        render();
      });

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'secondary';
      clearBtn.textContent = 'Monatsabweichung löschen';
      clearBtn.addEventListener('click', () => {
        ensurePersonIncomeConfig(person);
        delete person.netOverrides[currentMonth];
        addChangeLog('Einkommen', `${person.name}: Monatsabweichung für ${currentLabel} gelöscht.`);
        saveState();
        render();
      });

      const applyStandardFutureBtn = document.createElement('button');
      applyStandardFutureBtn.type = 'button';
      applyStandardFutureBtn.className = 'success';
      applyStandardFutureBtn.textContent = `Standard ab ${currentLabel} übernehmen`;
      applyStandardFutureBtn.addEventListener('click', () => {
        const standardValue = parseMoneyInput(standardInput.value);
        if (!Number.isFinite(standardValue) || standardValue < 0) return alert('Bitte ein gültiges Standard-Netto eingeben.');
        person.net = standardValue;
        setPersonNetForMonth(person, currentMonth, standardValue, 'future');
        addChangeLog('Einkommen', `${person.name}: Standard-Netto ${euro(standardValue)} ab ${currentLabel} dauerhaft übernommen.`);
        saveState();
        render();
      });

      const incomeReceivedBtn = document.createElement('button');
      incomeReceivedBtn.type = 'button';
      incomeReceivedBtn.className = receivedEntry ? 'secondary' : 'success';
      incomeReceivedBtn.textContent = receivedEntry ? 'Lohn-Eingang rückgängig' : 'Lohn als erhalten markieren';
      incomeReceivedBtn.addEventListener('click', () => {
        const selectedAccountId = incomeAccountSelect.value || getPersonIncomeAccountId(person);
        if (setPersonIncomeReceived(person, currentMonth, !receivedEntry, selectedAccountId)) {
          saveState();
          render();
        }
      });

      actions.appendChild(saveBtn);
      actions.appendChild(clearBtn);
      actions.appendChild(applyStandardFutureBtn);
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
    p.textContent = 'Die Vorschau zeigt den verfügbaren Monatsrest nach deinen aktuellen Daten. Die Simulation verändert nichts an den echten Daten.';
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
    debtInfo.textContent = 'Vorschau und Simulation berücksichtigen das Auslaufen der Schulden, die 6-Monats-Schutzregel und die dynamische Zusatztilgung. Die freie Summe wird jeden Monat neu mit den dann noch offenen Schulden berechnet; erst ab mindestens 600 € frei wird der Betrag oberhalb von 500 € zusätzlich investiert.';
    card.appendChild(debtInfo);
    card.appendChild(renderForecastTimelineCard(months, hasScenario, projectionMap));

    const table = document.createElement('table');
    table.className = 'list-table';
    table.innerHTML = '<thead><tr><th>Monat</th><th>Netto gesamt</th><th>Gemeinsame Kosten</th><th>Persönliche Ausgaben</th><th>Schulden geplant</th><th>davon Schneeball</th><th>dynamisch extra</th><th>Sonstige bezahlt</th><th>Verfügbar</th><th>Rücklagen 70 %</th><th>Sparen 30 %</th></tr></thead>';
    const tbody = document.createElement('tbody');
    months.forEach(({ key, label }) => {
      const rawDetails = hasScenario ? computeMonthDetailsWithScenario(key) : computeMonthDetails(key);
      const details = applyDebtProjectionToForecastDetails(rawDetails, key, projectionMap);
      const free = details.free;
      const distributable = details.distributable;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${label}</td><td>${details.totalIncome.toFixed(2)} €</td><td>${details.totalCommonRounded.toFixed(2)} €</td><td>${details.totalPersonal.toFixed(2)} €</td><td title="Bisher in Fixkosten verknüpft: ${details.linkedDebtCosts.toFixed(2)} €">${details.debtPlanned.toFixed(2)} €</td><td>${details.debtSnowballExtra.toFixed(2)} €</td><td>${(details.debtDynamicExtra || 0).toFixed(2)} €</td><td>${details.miscPaid.toFixed(2)} €</td><td><span class="pill ${free < 0 ? 'danger' : 'success'}">${free.toFixed(2)} €</span></td><td>${details.reserves.toFixed(2)} €</td><td>${details.savings.toFixed(2)} €</td>`;
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


  function buildMonthCloseSnapshot(monthKey) {
    const projectionMap = buildDebtForecastProjection(monthKey, 1);
    const details = applyDebtProjectionToForecastDetails(computeMonthDetails(monthKey), monthKey, projectionMap);
    const debtPlan = getDebtPlanForMonth(monthKey);
    const accounts = (state.accounts || []).map((account) => {
      const availability = getAccountAvailability(account, monthKey);
      return {
        id: account.id,
        name: account.name || 'Konto',
        type: account.type || '',
        owner: account.owner || '',
        balance: Number(account.balance || 0),
        bound: Number(account.bound || 0),
        open: Number(availability.open || 0),
        available: Number(availability.available || 0),
        missing: Number(availability.missing || 0)
      };
    });
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
      ['Verfügbar', liveDetails.free, closedSnapshot.free]
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

    const projectionMap = buildDebtForecastProjection(currentMonth, 1);
    const liveDetails = applyDebtProjectionToForecastDetails(computeMonthDetails(currentMonth), currentMonth, projectionMap);
    const closed = isMonthClosed(currentMonth);
    const closedSnapshot = closed && state.monthlyClosings ? state.monthlyClosings[currentMonth] : null;
    const details = closedSnapshot ? { ...liveDetails, ...closedSnapshot } : liveDetails;
    card.appendChild(createSummaryMetrics([
      { label: 'Verfügbar am Monatsende', value: `${details.free.toFixed(2)} €`, kind: details.free >= 0 ? 'success' : 'danger' },
      { label: 'In Töpfe verteilbar', value: `${details.distributable.toFixed(2)} €`, kind: details.distributable > 0 ? 'success' : '' },
      { label: 'Rücklagen 70 %', value: `${details.reserves.toFixed(2)} €` },
      { label: 'Sparen 30 %', value: `${details.savings.toFixed(2)} €` },
      { label: 'Schulden geplant', value: `${Number(details.debtPlanned || 0).toFixed(2)} €` },
      { label: 'Sonstige bezahlt', value: `${details.miscPaid.toFixed(2)} €` },
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
    receipt.appendChild(createReceiptRow('Schulden geplant', `− ${euro(details.debtPlanned || 0)}`));
    receipt.appendChild(createReceiptRow('davon Schneeball/Extra', euro((details.debtSnowballExtra || 0) + (details.debtDynamicExtra || 0))));
    receipt.appendChild(createReceiptRow('Sonstige bezahlt', `− ${euro(details.miscPaid)}`));
    receipt.appendChild(createReceiptRow('Verfügbar', euro(details.free), details.free >= 0 ? 'success' : 'danger'));
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
      if (Array.isArray(closedSnapshot.accounts) && closedSnapshot.accounts.length) {
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
    closeBtn.textContent = closed ? 'Monat erneut abschließen' : 'Monat abschließen, Beleg speichern und in Töpfe buchen';
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
    note.textContent = 'Der Monatsabschluss speichert einen Beleg mit Monatszahlen und Kontoständen und bucht die geplanten Rücklagen automatisch in die Töpfe. Wenn du danach alte Werte änderst, zeigt die App Abweichungen zum gespeicherten Abschluss an.';
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
      table.innerHTML = `<thead><tr><th>Name</th><th>Betrag</th><th>Intervall</th><th>Start</th><th>Bis</th><th>Fällig</th><th>Konto</th><th>Status</th><th>Aktion</th></tr></thead>`;
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
          <td>${getAccountName(post.accountId)}</td>
          <td>${statusHtml}</td>
          <td></td>`;
        const actionCell = tr.children[8];

        const paidBtn = document.createElement('button');
        paidBtn.textContent = 'Status bezahlt';
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
          { label: 'Als bezahlt', className: 'success', disabled: !dueNow || paidNow, onClick: () => { setPostPaidForMonth(post, currentMonth, true); saveState(); render(); } },
          { label: 'Bezahlt + buchen', className: 'success', disabled: !dueNow || bookedNow, onClick: () => { bookPostPaymentForMonth(post, currentMonth); saveState(); render(); } },
          { label: 'Buchung entfernen', className: 'secondary', disabled: !bookedNow, onClick: () => { unbookPostPaymentForMonth(post, currentMonth); saveState(); render(); } },
          { label: 'Zahlung zurücksetzen', className: 'secondary', disabled: !paidNow, onClick: () => { setPostPaidForMonth(post, currentMonth, false); saveState(); render(); } },
          { label: 'In anderen Monat verschieben', className: 'secondary', onClick: () => showBufferMoveMonthModal(post) },
          { label: 'Zur Steuererstattung verschieben', className: 'secondary', disabled: !(state.taxRefunds || []).length, onClick: () => showBufferToTaxRefundModal(post) },
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
    intro.textContent = 'Zusätzlich zur allgemeinen Kontenübersicht siehst du hier, was auf dem gemeinsamen Konto aktuell für gemeinsame Kosten, gebundene Steuererstattung, Intervall-Rücklagen und offene Monatsanteile gebraucht wird.';
    card.appendChild(intro);

    card.appendChild(createSummaryMetrics([
      { label: 'Kontostand', value: euro(details.balance) },
      { label: 'Gebunden', value: euro(details.boundTotal), hint: `Steuererstattung ${euro(details.taxBound)} · Intervall ${euro(details.intervalReserveTotal)} · manuell ${euro(details.manualBound)}` },
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
    interestHint.textContent = 'Trage hier die ausgezahlten Zinsen ein, z. B. 1,30 € für den vergangenen Monat. Auf Wunsch wird der Betrag direkt zum Kontostand addiert.';
    interest.appendChild(interestHint);
    const interestRow = document.createElement('div');
    interestRow.className = 'row';
    const interestMonthInput = document.createElement('input');
    interestMonthInput.type = 'month';
    interestMonthInput.value = addMonths(currentMonth, -1);
    const interestAmountInput = document.createElement('input');
    interestAmountInput.type = 'number';
    interestAmountInput.step = '0.01';
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
    interestAddToBalance.checked = true;
    interestCheckLabel.appendChild(interestAddToBalance);
    interestCheckLabel.appendChild(document.createTextNode(' Betrag zum aktuellen Kontostand addieren'));
    interest.appendChild(interestCheckLabel);
    const interestBtn = document.createElement('button');
    interestBtn.className = 'primary';
    interestBtn.textContent = 'Zinsen speichern';
    interestBtn.addEventListener('click', () => {
      const amount = Number(interestAmountInput.value || 0);
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
    balanceInput.type = 'number';
    balanceInput.step = '0.01';
    balanceInput.value = Number(state.commonAccount.currentBalance || 0).toFixed(2);
    const manualInput = document.createElement('input');
    manualInput.type = 'number';
    manualInput.step = '0.01';
    manualInput.value = Number(state.commonAccount.manualBound || 0).toFixed(2);
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
      state.commonAccount.currentBalance = Number(balanceInput.value || 0);
      state.commonAccount.manualBound = Math.max(0, Number(manualInput.value || 0));
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
      tdAmount.textContent = euro(rowData.amount);
      const tdPaid = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = rowData.paid ? 'success' : 'secondary';
      btn.textContent = rowData.paid ? 'Status: eingegangen' : 'Status setzen';
      btn.title = 'Markiert nur den Status. Es wird keine zusätzliche Kontobuchung erstellt.';
      btn.addEventListener('click', () => {
        setCommonAccountContributionPaid(currentMonth, rowData.person.id, !rowData.paid);
        saveState();
        render();
      });
      tdPaid.appendChild(btn);
      const bookingBtn = document.createElement('button');
      bookingBtn.type = 'button';
      const booked = isContributionAccountBooked(currentMonth, rowData.person.id);
      bookingBtn.className = booked ? 'danger small-action' : 'secondary small-action';
      bookingBtn.textContent = booked ? 'Buchung entfernen' : 'extra buchen';
      bookingBtn.title = booked ? 'Entfernt die zusätzliche Kontobuchung für diesen Monatsanteil.' : 'Nur nutzen, wenn der Eingang noch nicht im Kontostand enthalten ist.';
      bookingBtn.addEventListener('click', () => {
        if (booked) {
          applyContributionAccountBooking(currentMonth, rowData.person.id, false);
        } else {
          applyContributionAccountBooking(currentMonth, rowData.person.id, true);
          setCommonAccountContributionPaid(currentMonth, rowData.person.id, true);
        }
        saveState();
        render();
      });
      tdPaid.appendChild(bookingBtn);
      const hint = document.createElement('div');
      hint.className = 'small muted';
      hint.textContent = booked ? 'zusätzliche Kontobuchung aktiv' : 'nur Status, keine doppelte Buchung';
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
    reserveTitle.textContent = 'Rücklage für Intervallzahlungen';
    reserveBox.appendChild(reserveTitle);
    reserveBox.appendChild(createSummaryMetrics([
      { label: 'Soll-Rücklage aktuell', value: euro(details.intervalReserveTotal), kind: details.intervalReserveTotal > 0 ? 'warning' : 'success' },
      { label: 'Gebunden gesamt inkl. Rücklage', value: euro(details.boundTotal), kind: details.boundTotal > 0 ? 'warning' : 'success' }
    ]));
    const reserveHint = document.createElement('p');
    reserveHint.className = 'small muted';
    reserveHint.textContent = 'Hier werden jährliche, halbjährliche und quartalsweise gemeinsame Kosten berücksichtigt. Die App prüft, was sich durch monatliche Anteile rechnerisch bereits auf dem Konto angesammelt haben sollte.';
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
      ? `Aktuell fehlen ${euro(details.missingNow)}, wenn Steuererstattung, manuell gebundene Beträge und Intervall-Rücklagen unangetastet bleiben sollen.`
      : `Aktuell ist das Gemeinschaftskonto ausreichend gedeckt. Überschuss nach gebundenen Beträgen, Intervall-Rücklagen und offenen Abbuchungen: ${euro(details.surplusNow)}.`;
    card.appendChild(note);

    sharedAccountSection.appendChild(card);
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
        <th>Konto</th>
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
          <td>${getAccountName(c.accountId)}</td>
          <td></td>
          <td></td>`;

        const paidCell = tr.children[9];
        if (dueNow) {
          if (!paidNow) {
            const btn = document.createElement('button');
            btn.textContent = 'Status';
            btn.className = 'success';
            btn.addEventListener('click', () => {
              setPostPaidForMonth(c, currentMonth, true);
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
        const bookedNow = isPostBookedForMonth(c, currentMonth);
        actionCell.appendChild(createActionMenu([
          { label: 'Bezahlt + buchen', className: 'success', disabled: !dueNow || bookedNow, onClick: () => { bookPostPaymentForMonth(c, currentMonth); syncDebtPaymentFromPost(c, currentMonth); saveState(); render(); } },
          { label: 'Buchung entfernen', className: 'secondary', disabled: !bookedNow, onClick: () => { unbookPostPaymentForMonth(c, currentMonth); saveState(); render(); } },
          { label: 'Bearbeiten', className: 'primary', onClick: () => showCommonEditor(c) },
          { label: 'Löschen', className: 'danger', onClick: () => { if (confirm(`"${c.name}" löschen?`)) { state.commonCosts = state.commonCosts.filter((x) => x.id !== c.id); saveState(); render(); } } }
        ]));
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
    refs.accountSelect = createAccountSelect(editCost ? editCost.accountId : getDefaultAccountIdForContext('common'), { includeNone: true });
    row4.appendChild(createLabelInput('Schuld verknüpfen', refs.debtSelect));
    row4.appendChild(createLabelInput('Zahlungskonto', refs.accountSelect));
    content.appendChild(row4);
    appendTransferBookingFields(content, refs, editCost);

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
            editCost.accountId = refs.accountSelect.value || '';
            if (!applyTransferBookingFieldsToPost(editCost, refs)) return;
            applyScheduleSettings(editCost, scheduleValidation.value);
            if (mode) {
              setPostAmountForMonth(editCost, currentMonth, amount, mode);
              syncLinkedDebtRateFromPost(editCost, currentMonth, mode);
            } else {
              syncLinkedDebtRateFromPost(editCost, currentMonth, 'future');
            }
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
              amountTimeline: [],
              amountOverrides: {},
              linkedDebtId: refs.debtSelect.value || '',
              accountId: refs.accountSelect.value || '',
              bookingType: refs.bookingTypeSelect && refs.bookingTypeSelect.value === 'transfer' ? 'transfer' : 'expense',
              transferToAccountId: refs.transferToAccountSelect ? (refs.transferToAccountSelect.value || '') : '',
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
    const details = computeMonthDetails(monthKey);
    const row = (details.personsData || []).find((pd) => pd.person && pd.person.id === personId);
    return row ? Number(row.commonShare || 0) : 0;
  }

  function isCommonSharePaidForMonth(personId, monthKey = currentMonth) {
    const map = getCommonAccountContributionMap(monthKey);
    return map[personId] === true;
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
      overallCommonShare += personCommonShare;
      if (isCommonSharePaidForMonth(person.id, currentMonth)) overallCommonSharePaid += personCommonShare;
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
      { label: 'Monatlich geplant', value: `${overallMonthly.toFixed(2)} €` },
      { label: 'Anteil gemeinsame Kosten', value: `${overallCommonShare.toFixed(2)} €`, kind: overallCommonShare > 0 ? 'warning' : '' },
      { label: 'Fällig inkl. Anteil', value: `${overallDueWithCommon.toFixed(2)} €`, kind: overallDueWithCommon > 0 ? 'warning' : '' },
      { label: 'Bereits markiert inkl. Anteil', value: `${overallPaidWithCommon.toFixed(2)} €`, kind: overallPaidWithCommon > 0 ? 'success' : '' },
      { label: 'Noch offen inkl. Anteil', value: `${overallOpenWithCommon.toFixed(2)} €`, kind: overallOpenWithCommon > 0 ? 'danger' : 'success' }
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
      const commonShare = getPersonCommonShareForMonth(person.id, currentMonth);
      const commonSharePaid = isCommonSharePaidForMonth(person.id, currentMonth);
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
      const paidWithCommon = paidSum + (commonSharePaid ? commonShare : 0);
      const openWithCommon = Math.max(dueWithCommon - paidWithCommon, 0);
      card.appendChild(createSummaryMetrics([
        { label: 'Persönlich geplant', value: `${monthlySum.toFixed(2)} €` },
        { label: 'Anteil gemeinsame Kosten', value: `${commonShare.toFixed(2)} €`, kind: commonSharePaid ? 'success' : (commonShare > 0 ? 'warning' : '') , hint: commonSharePaid ? 'Bereits am Gemeinschaftskonto markiert.' : 'Noch als Monatsanteil fürs Gemeinschaftskonto offen.' },
        { label: 'Fällig inkl. Anteil', value: `${dueWithCommon.toFixed(2)} €`, kind: dueWithCommon > 0 ? 'warning' : '' },
        { label: 'Bereits markiert inkl. Anteil', value: `${paidWithCommon.toFixed(2)} €`, kind: paidWithCommon > 0 ? 'success' : '' },
        { label: 'Noch offen inkl. Anteil', value: `${openWithCommon.toFixed(2)} €`, kind: openWithCommon > 0 ? 'danger' : 'success' }
      ]));

      const commonShareInfo = document.createElement('div');
      commonShareInfo.className = commonSharePaid ? 'notice success personal-common-share' : 'notice warning personal-common-share';
      commonShareInfo.innerHTML = `<strong>Anteil gemeinsame Kosten:</strong> ${commonShare.toFixed(2)} € ${commonSharePaid ? 'ist auf dem Gemeinschaftskonto als eingegangen markiert.' : 'ist noch nicht als Eingang auf dem Gemeinschaftskonto markiert.'}`;
      card.appendChild(commonShareInfo);

      if (posts.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'Keine persönlichen Ausgaben eingetragen.';
        card.appendChild(p);
      } else {
        const table = document.createElement('table');
        table.className = 'list-table';
        const thead = document.createElement('thead');
        thead.innerHTML = `<tr><th>Name</th><th>Betrag</th><th>Intervall</th><th>Start</th><th>Bis</th><th>Fällig</th><th>Verknüpfte Schuld</th><th>Konto</th><th>Bezahlt?</th><th>Aktion</th></tr>`;
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
            <td>${getAccountName(pc.accountId)}</td>
            <td></td><td></td>`;

          const paidCell = tr.children[8];
          if (dueNow) {
            if (!paidNow) {
              const btn = document.createElement('button');
              btn.textContent = 'Status';
              btn.className = 'success';
              btn.addEventListener('click', () => {
                setPostPaidForMonth(pc, currentMonth, true);
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

          const actionCell = tr.children[9];
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
            { label: 'Bezahlt + buchen', className: 'success', disabled: !dueNow || bookedNow, onClick: () => { bookPostPaymentForMonth(pc, currentMonth); syncDebtPaymentFromPost(pc, currentMonth); saveState(); render(); } },
            { label: 'Buchung entfernen', className: 'secondary', disabled: !bookedNow, onClick: () => { unbookPostPaymentForMonth(pc, currentMonth); saveState(); render(); } },
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
    refs.accountSelect = createAccountSelect(editPost ? editPost.accountId : getDefaultAccountIdForContext('personal', personId), { includeNone: true });
    row4.appendChild(createLabelInput('Schuld verknüpfen', refs.debtSelect));
    row4.appendChild(createLabelInput('Zahlungskonto', refs.accountSelect));
    content.appendChild(row4);
    appendTransferBookingFields(content, refs, editPost);

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
            editPost.accountId = refs.accountSelect.value || '';
            if (!applyTransferBookingFieldsToPost(editPost, refs)) return;
            applyScheduleSettings(editPost, scheduleValidation.value);
            if (mode) {
              setPostAmountForMonth(editPost, currentMonth, amount, mode);
              syncLinkedDebtRateFromPost(editPost, currentMonth, mode);
            } else {
              syncLinkedDebtRateFromPost(editPost, currentMonth, 'future');
            }
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
              amountTimeline: [],
              amountOverrides: {},
              linkedDebtId: refs.debtSelect.value || '',
              accountId: refs.accountSelect.value || ''
            };
            if (!applyTransferBookingFieldsToPost(newPost, refs)) return;
            state.personalCosts.push(newPost);
            syncLinkedDebtRateFromPost(newPost, startMonth, 'future');
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

    const row4 = document.createElement('div');
    row4.className = 'row';
    refs.accountSelect = createAccountSelect(editPost ? editPost.accountId : getDefaultAccountIdForContext('personal', 'benny'), { includeNone: true });
    row4.appendChild(createLabelInput('Zahlungskonto', refs.accountSelect));
    content.appendChild(row4);
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
            editPost.accountId = refs.accountSelect.value || '';
            if (!applyTransferBookingFieldsToPost(editPost, refs)) return;
            applyScheduleSettings(editPost, scheduleValidation.value);
            if (mode) {
              setPostAmountForMonth(editPost, currentMonth, amount, mode);
              syncLinkedDebtRateFromPost(editPost, currentMonth, mode);
            } else {
              syncLinkedDebtRateFromPost(editPost, currentMonth, 'future');
            }
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
              accountId: refs.accountSelect.value || '',
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
    const entries = getTankMonthlyEntries(personKey);
    const existing = getTankEntryForMonth(personKey, currentMonth) || {};
    const receiptStats = getTankReceiptStatsForMonth(personKey, currentMonth);
    const monthlyRecord = getTankMonthlyRecord(personKey, currentMonth);
    const avg = getTankAverageStats(personKey, currentMonth, 12);

    const tracking = document.createElement('div');
    tracking.className = 'sub-card tank-monthly-tracking';
    tracking.appendChild(createUiEl('h4', '', 'Kilometerstände & Bon-Auswertung'));
    tracking.appendChild(createUiEl('p', 'small muted', 'Kilometerstände bleiben je Auto gespeichert, die Prognose wird aber aus dem Gesamtverbrauch beider Autos gebildet. So ist es egal, ob ihr den Smart oder Seat fahrt. Tankbons werden nach Liter-Anteil verteilt; beide fahren E10, daher gilt derselbe Literpreis.'));

    tracking.appendChild(createSummaryMetrics([
      { label: 'Dieser Monat netto', value: monthlyRecord.netCost ? euro(monthlyRecord.netCost) : '—', kind: monthlyRecord.netCost ? 'success' : 'warning' },
      { label: 'Bons im Monat', value: receiptStats.receiptCount ? String(receiptStats.receiptCount) : '—' },
      { label: 'Ø Kosten/Monat', value: avg.count ? euro(avg.avgNet) : '—', kind: avg.count ? 'success' : 'warning' },
      { label: 'Prognose gerundet', value: avg.count ? euro(avg.roundedBudget) : '—' }
    ]));

    const form = document.createElement('div');
    form.className = 'row tank-entry-form';
    const fields = [
      ['month', 'Monat', 'month', currentMonth],
      ['startKm', 'Start-km', 'number', existing.startKm || ''],
      ['endKm', 'End-km', 'number', existing.endKm || '']
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
      const currentRecord = getTankMonthlyRecord(personKey, inputs.month.value);
      const entry = upsertTankMonthlyEntry(personKey, {
        month: inputs.month.value,
        startKm: inputs.startKm.value,
        endKm: inputs.endKm.value,
        liters: currentRecord.liters,
        paid: currentRecord.paid,
        cashback: currentRecord.cashback,
        note: inputs.note.value
      });
      const stats = getTankAverageStats(personKey, entry.month, 12);
      if (stats.count > 0) {
        const cfg = getTankCalcData(personKey);
        cfg.kmPerMonth = Math.round(stats.avgKm);
        if (stats.realConsumption > 0) cfg.consumption = Number(stats.realConsumption.toFixed(2));
      }
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
          deleteTankMonthlyEntry(personKey, currentMonth);
          syncTankgeldExpense(personKey, { silent: true });
          saveState();
          render();
        }
      });
      btnRow.appendChild(delBtn);
    }
    tracking.appendChild(btnRow);

    const combinedMonths = getTankRealMonthlyRecords(personKey, currentMonth);
    if (combinedMonths.length) {
      const details = document.createElement('details');
      details.className = 'compact-details';
      const summary = document.createElement('summary');
      summary.textContent = `Monatsauswertung anzeigen (${combinedMonths.length})`;
      details.appendChild(summary);
      const table = document.createElement('table');
      table.className = 'list-table compact-table';
      table.innerHTML = '<thead><tr><th>Monat</th><th>km</th><th>Liter</th><th>Bons</th><th>bezahlt</th><th>gespart</th><th>netto</th><th>Verbrauch</th></tr></thead>';
      const tbody = document.createElement('tbody');
      combinedMonths.slice(0, 12).forEach((entry) => {
        const tr = document.createElement('tr');
        const cons = entry.km > 0 && entry.liters > 0 ? `${((entry.liters / entry.km) * 100).toFixed(1)} l/100` : '-';
        tr.innerHTML = `<td>${formatMonthLabel(entry.month)}</td><td>${entry.km.toFixed(0)} km</td><td>${entry.liters.toFixed(2)} l</td><td>${entry.receiptCount || 0}</td><td>${euro(entry.paid)}</td><td>${euro(entry.cashback)}</td><td><strong>${euro(entry.netCost)}</strong></td><td>${cons}</td>`;
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
    box.appendChild(createUiEl('h3', '', 'Tankbons separat erfassen'));
    box.appendChild(createUiEl('p', 'small muted', 'Ein Bon kann auf Smart und Seat verteilt werden. Für die Prognose zählt der gemeinsame E10-Gesamtverbrauch; Cashback/Coupons werden anteilig nach Litern verteilt. Kanister kannst du als Hinweis markieren.'));

    const form = document.createElement('div');
    form.className = 'row tank-receipt-form';
    const fields = [
      ['month', 'Monat', 'month', currentMonth],
      ['date', 'Datum', 'date', currentMonth + '-01'],
      ['liters', 'Liter gesamt', 'number', ''],
      ['paid', 'bezahlt €', 'number', ''],
      ['cashback', 'Cashback/Coupon €', 'number', ''],
      ['benny', 'Liter Smart', 'number', ''],
      ['madeleine', 'Liter Seat', 'number', '']
    ];
    const inputs = {};
    fields.forEach(([key, label, type, value]) => {
      const wrap = document.createElement('div');
      const lab = document.createElement('label');
      lab.textContent = label;
      const input = document.createElement('input');
      input.type = type;
      if (type === 'number') { input.step = '0.01'; input.min = '0'; }
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
    noteInput.placeholder = 'z. B. Berlin, Coupon, Aral, Kanister für Smart';
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
      const liters = Number(inputs.liters.value || 0);
      const smartLiters = Number(inputs.benny.value || 0);
      const seatLiters = Number(inputs.madeleine.value || 0);
      if (!isMonthKey(inputs.month.value)) return alert('Bitte einen gültigen Monat wählen.');
      if (liters <= 0 || Number(inputs.paid.value || 0) <= 0) return alert('Bitte Liter und bezahlten Betrag eintragen.');
      if (smartLiters + seatLiters <= 0) return alert('Bitte Liter auf Smart und/oder Seat verteilen.');
      if (smartLiters + seatLiters > liters + 0.001) return alert('Die verteilten Liter dürfen nicht größer als die Liter gesamt sein.');
      const receipt = upsertTankReceipt({
        month: inputs.month.value,
        date: inputs.date.value,
        liters,
        paid: inputs.paid.value,
        cashback: inputs.cashback.value,
        isCanister: inputs.isCanister.checked,
        allocations: { benny: smartLiters, madeleine: seatLiters },
        note: inputs.note.value
      });
      ['benny','madeleine'].forEach((key) => {
        const stats = getTankAverageStats(key, receipt.month, 12);
        const cfg = getTankCalcData(key);
        if (stats.avgKm) cfg.kmPerMonth = Math.round(stats.avgKm);
        if (stats.realConsumption) cfg.consumption = Number(stats.realConsumption.toFixed(2));
        syncTankgeldExpense(key, { silent: true });
      });
      addChangeLog('Tankgeld', `Tankbon ${formatMonthLabel(receipt.month)} gespeichert · ${receipt.liters.toFixed(2)} l · netto ${receipt.netCost.toFixed(2)} €`, receipt.month);
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
      table.innerHTML = '<thead><tr><th>Datum</th><th>Liter</th><th>bezahlt</th><th>gespart</th><th>€/l netto</th><th>Smart</th><th>Seat</th><th>Hinweis</th><th></th></tr></thead>';
      const tbody = document.createElement('tbody');
      currentReceipts.forEach((receipt) => {
        const tr = document.createElement('tr');
        const netPerLiter = receipt.liters > 0 ? receipt.netCost / receipt.liters : 0;
        const note = `${receipt.isCanister ? 'Kanister' : 'Tankstelle'}${receipt.note ? ' · ' + escapeHtml(receipt.note) : ''}`;
        tr.innerHTML = `<td>${receipt.date || '-'}</td><td>${receipt.liters.toFixed(2)} l</td><td>${euro(receipt.paid)}</td><td>${euro(receipt.cashback)}</td><td>${netPerLiter.toFixed(3)} €/l</td><td>${Number(receipt.allocations.benny || 0).toFixed(2)} l</td><td>${Number(receipt.allocations.madeleine || 0).toFixed(2)} l</td><td>${note}</td>`;
        const td = document.createElement('td');
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'danger compact-action';
        del.textContent = 'löschen';
        del.addEventListener('click', () => {
          if (confirm('Tankbon löschen?')) {
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
    if (changed) addChangeLog('Kraftstoffkonto', `Aufstockung ${formatMonthLabel(monthKey)} auf ${euro(allocation.topUp)} gesetzt.`, monthKey);
    return changed;
  }

  function renderBudgetTopUpCard(parent) {
    normalizeBudgetTopUpsConfig();
    const card = document.createElement('div');
    card.className = 'card';
    card.appendChild(createUiEl('h3', '', 'Kraftstoffkonto & Einkaufsgeld-Aufstockung'));
    card.appendChild(createUiEl('p', 'small muted', 'Start ab Juli 2026: Du trägst den Rest aus dem Vormonat ein. Die App füllt nur bis zum geplanten Monatsziel auf und rundet die Aufstockung immer auf die nächsten 5 € auf. Monate vor Juli bleiben unverändert.'));

    const fuelCalc = getFuelTopUpAllocation(currentMonth);
    const groceriesCalc = getGroceryTopUpAllocation(currentMonth);
    card.appendChild(createSummaryMetrics([
      { label: 'Kraftstoff Ziel', value: euro(fuelCalc.target), kind: fuelCalc.active ? 'success' : 'warning' },
      { label: 'Kraftstoff Rest', value: euro(fuelCalc.balance) },
      { label: 'Kraftstoff aufstocken', value: fuelCalc.active ? euro(fuelCalc.topUp) : 'ab Juli 2026', kind: fuelCalc.active ? 'success' : 'warning' },
      { label: 'Einkaufsgeld Ziel', value: euro(groceriesCalc.target), kind: groceriesCalc.active ? 'success' : 'warning' },
      { label: 'Einkaufsgeld Rest', value: euro(groceriesCalc.balance) },
      { label: 'Einkaufsgeld aufstocken', value: groceriesCalc.active ? euro(groceriesCalc.topUp) : 'ab Juli 2026', kind: groceriesCalc.active ? 'success' : 'warning' }
    ]));

    const row = document.createElement('div');
    row.className = 'row';
    const inputs = {};
    [
      ['fuel', 'Rest Kraftstoffkonto', fuelCalc.balance, 'z. B. 58,93'],
      ['groceries', 'Rest Einkaufsgeld', groceriesCalc.balance, 'z. B. 43,20']
    ].forEach(([type, label, value, placeholder]) => {
      const wrap = document.createElement('div');
      const lab = document.createElement('label');
      lab.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.01';
      input.min = '0';
      input.placeholder = placeholder;
      input.value = value ? Number(value).toFixed(2) : '';
      inputs[type] = input;
      wrap.appendChild(lab);
      wrap.appendChild(input);
      row.appendChild(wrap);
    });
    const noteWrap = document.createElement('div');
    const noteLab = document.createElement('label');
    noteLab.textContent = 'Notiz';
    const note = document.createElement('input');
    note.type = 'text';
    note.value = (getBudgetTopUpConfig('fuel').notes[currentMonth] || getBudgetTopUpConfig('groceries').notes[currentMonth] || '');
    note.placeholder = 'z. B. Rest aus Juni übernommen';
    noteWrap.appendChild(noteLab);
    noteWrap.appendChild(note);
    row.appendChild(noteWrap);
    card.appendChild(row);

    const info = document.createElement('div');
    info.className = 'info-box';
    if (fuelCalc.active) {
      info.innerHTML = `<strong>Berechnung:</strong> Kraftstoff ${euro(fuelCalc.target)} geplant − ${euro(fuelCalc.balance)} Rest = ${euro(fuelCalc.missing)} Bedarf, aufgerundet <strong>${euro(fuelCalc.topUp)}</strong>. Einkaufsgeld ${euro(groceriesCalc.target)} geplant − ${euro(groceriesCalc.balance)} Rest = ${euro(groceriesCalc.missing)} Bedarf, aufgerundet <strong>${euro(groceriesCalc.topUp)}</strong>.`;
    } else {
      info.innerHTML = '<strong>Noch nicht aktiv:</strong> Die Aufstockungslogik startet erst ab Juli 2026, weil davor kein sauberer Anfangsbestand vorhanden ist.';
    }
    card.appendChild(info);

    const btnRow = document.createElement('div');
    btnRow.className = 'row';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'success';
    saveBtn.textContent = 'Rest speichern & Aufstockung übernehmen';
    saveBtn.addEventListener('click', () => {
      setBudgetTopUpBalance('fuel', currentMonth, Number(inputs.fuel.value || 0), note.value);
      setBudgetTopUpBalance('groceries', currentMonth, Number(inputs.groceries.value || 0), note.value);
      syncFuelTopUpExpenses(currentMonth);
      syncGroceryTopUpExpense(currentMonth);
      saveState();
      render();
    });
    btnRow.appendChild(saveBtn);
    card.appendChild(btnRow);
    parent.appendChild(card);
  }


  function renderTankCalc() {
    tankCalcSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('h2');
    title.textContent = 'Kraftstoffkonto';
    card.appendChild(title);

    const note = document.createElement('p');
    note.textContent = 'Das Kraftstoffkonto ist automatisch mit den persönlichen Ausgaben verknüpft. Änderungen aktualisieren den Tankgeld-Posten direkt. Ist der aktuelle Monat bereits bezahlt, bleibt dieser Betrag fest und die Änderung gilt erst ab dem Folgemonat.';
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
    keyHint.textContent = 'Der API-Key wird automatisch bereinigt: Leerzeichen, unsichtbare Zeichen, Anführungszeichen oder ein mitkopierter Link werden entfernt. Backups enthalten den API-Key, damit das Kraftstoffkonto nach Import weiter funktioniert.';
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
    householdTankInfo.innerHTML = '<strong>Neue Logik:</strong> Die Prognose läuft über den gemeinsamen E10-Gesamtverbrauch beider Autos. Einzelne Kilometerstände bleiben zur Verbrauchskontrolle erhalten, aber das Budget wird nicht mehr streng pro Auto berechnet.';
    card.appendChild(householdTankInfo);

    const householdTankStats = getTankHouseholdAverageStats(currentMonth, 12);
    const bennyBudget = calculateTankBudget(getTankCalcData('benny'), 'benny').rounded;
    const madeleineBudget = calculateTankBudget(getTankCalcData('madeleine'), 'madeleine').rounded;
    card.appendChild(createSummaryMetrics([
      { label: 'Monatsbudget gesamt', value: `${householdTankStats.roundedBudget.toFixed(2)} €`, kind: householdTankStats.roundedBudget > 0 ? 'success' : 'warning' },
      { label: 'Basis', value: householdTankStats.projectedCount > 0 ? `${householdTankStats.realCount} echt + ${householdTankStats.projectedCount} Prognose` : '12 echte Monate' },
      { label: 'Benny-Anteil', value: `${bennyBudget.toFixed(2)} €` },
      { label: 'Madeleine-Anteil', value: `${madeleineBudget.toFixed(2)} €` },
      { label: 'API-Key', value: state.tankCalc.apiKey ? 'Gespeichert' : 'Fehlt', kind: state.tankCalc.apiKey ? 'success' : 'warning' }
    ]));

    renderBudgetTopUpCard(card);

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
        { label: 'Prognose', value: `${tankBudget.rounded.toFixed(2)} €`, kind: tankBudget.rounded > 0 ? 'success' : 'warning' }
      ]));

      renderTankMonthlyTracking(sub, personKey, labelText);

      const linkedTankPost = getTankExpensePost(personKey);
      const linkInfo = document.createElement('div');
      linkInfo.className = 'small muted';
      if (linkedTankPost) {
        const paidText = isPostPaidForMonth(linkedTankPost, currentMonth) ? 'bezahlt/fest' : 'offen';
        const activeAmount = getEffectiveAmountForMonth(linkedTankPost, currentMonth);
        linkInfo.textContent = `Verknüpfter Ausgabenposten: ${linkedTankPost.name} · ${activeAmount.toFixed(2)} € · ${paidText}`;
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
    if (markAsMonthly && (debt.paidMonths.includes(month) || debt.paymentHistory.some((entry) => entry.month === month && entry.markedAsMonthly))) {
      return false;
    }
    const paymentAmount = Math.min(amount, Number(debt.amountOpen || 0));
    if (!(paymentAmount > 0)) return false;

    const historyId = generateId();
    let accountTransactionId = '';
    if (options.skipAccountTransaction !== true) {
      const accountId = debt.accountId || getDefaultAccountIdForContext('personal', 'benny');
      if (accountId) {
        debt.accountId = accountId;
        accountTransactionId = upsertAccountTransaction(accountId, {
          month,
          type: 'debt_payment',
          sourceId: getDebtAccountTransactionSource(debt, month, historyId),
          label: `${debt.name || 'Schuld'} ${formatMonthLabel(month)}`,
          amount: -paymentAmount
        }) || '';
      }
    }

    debt.paymentHistory.push({
      id: historyId,
      month,
      amount: paymentAmount,
      source: options.source || 'Manuelle Zahlung',
      note: options.note || '',
      createdAt: new Date().toISOString(),
      previousNextDueMonth,
      markedAsMonthly: markAsMonthly,
      accountTransactionId
    });

    debt.amountOpen = Math.max(0, Number(debt.amountOpen || 0) - paymentAmount);
    if (Number(debt.amountOpen || 0) <= 0) {
      debt.completedMonth = month;
    }

    if (markAsMonthly && !debt.paidMonths.includes(month)) {
      debt.paidMonths.push(month);
    }
    if (markAsMonthly) {
      advanceDebtNextDueMonthAfterPayment(debt, month);
    }
    addChangeLog('Schulden', `${debt.name || 'Schuld'}: ${paymentAmount.toFixed(2)} € bezahlt`, month);
    return true;
  }

  function resetDebtPaymentForMonth(debt, monthKey) {
    ensureDebtConfig(debt);
    const entries = debt.paymentHistory.filter((entry) => entry.month === monthKey);
    let restoreAmount = 0;
    if (entries.length > 0) {
      entries.forEach((entry) => {
        if (entry.accountTransactionId) removeAccountTransaction(debt.accountId, entry.accountTransactionId);
        removeAccountTransactionBySource(getDebtAccountTransactionSource(debt, monthKey, entry.id));
      });
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
    const totalBase = rows.reduce((sum, row) => sum + Number(row.base || 0), 0);
    const totalSnowball = rows.reduce((sum, row) => sum + Math.max(0, Number(row.extra || 0) - Number(row.dynamicExtra || 0)), 0);
    const totalDynamic = rows.reduce((sum, row) => sum + Number(row.dynamicExtra || 0), 0);
    const nextDynamic = rows.find((row) => Number(row.dynamicExtra || 0) > 0);
    const nextCompleted = (plan.events || []).find((event) => String(event.type || '').includes('completed'));

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
      ['davon Extra gesamt', euro(totalDynamic)],
      ['nächste komplette Extra-Tilgung', nextDynamic ? `${formatMonthLabel(nextDynamic.month)} · ${euro(nextDynamic.dynamicExtra || 0)}` : 'keine geplant'],
      ['nächstes Auslaufen', nextCompleted ? `${formatMonthLabel(nextCompleted.month)} · ${nextCompleted.sourceDebt}` : 'noch keines'],
      ['Schneeball-Zusatz gesamt', euro(totalSnowball)]
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
    note.textContent = 'Diese Prognose nutzt den dynamischen Schneeball, die 6-Monats-Regel, deine 500-€-Reserve und Extra-Zahlungen nur dann, wenn dadurch eine Schuld vollständig getilgt werden kann. Kreiskasse bleibt als Extra-Ziel ausgeschlossen.';
    card.appendChild(note);
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
      const paidAmount = getDebtPaymentAmountForMonth(d, currentMonth);
      totalDebtSum += openAmount;
      if (openAmount > 0) activeDebts += 1;

      // Monatsplan = bereits in diesem Monat bezahlte Schulden + weiterhin fällige Schulden.
      // Wichtig: Nach einer Zahlung springt nextDueMonth auf den Folgemonat. Trotzdem darf die
      // bezahlte Mai-Rate nicht aus dem Mai-Plan verschwinden, sonst wird „Noch offen“ zu klein.
      if (isMonthKey(d.nextDueMonth) && monthDiff(d.nextDueMonth, currentMonth) >= 0 && monthlyRate > 0) {
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
          currentDebtPlan.set(name, { rate: 0, snowball: 0, dynamic: 0, planned: 0, notes: [] });
        }
        const item = currentDebtPlan.get(name);
        const amount = Number(payment.amount || 0);
        item.planned += amount;
        if (payment.type === 'rate') item.rate += amount;
        else if (payment.type === 'snowball') item.snowball += amount;
        else if (payment.type === 'dynamic') item.dynamic += amount;
        if (payment.note) item.notes.push(payment.note);
      });
    }

    // Bezahlte Schuldzahlungen bleiben für den Monat fest. Der dynamische Plan wird
    // danach nur noch für offene Schulden gewertet. So wird ein bereits bezahlter
    // Betrag nicht bei späteren Änderungen an Lohn/Kosten/Rücklagen rückwirkend verändert.
    let currentOpenPlannedDebtTotal = 0;
    let currentSnowballTotal = 0;
    let currentDynamicTotal = 0;
    (state.debts || []).forEach((d) => {
      ensureDebtConfig(d);
      if (Number(d.amountOpen || 0) <= 0) return;
      if (getDebtPaymentAmountForMonth(d, currentMonth) > 0) return;
      const planItem = currentDebtPlan.get(d.name) || null;
      const dueNowForDebt = isMonthKey(d.nextDueMonth) && monthDiff(d.nextDueMonth, currentMonth) >= 0;
      const fallbackRate = dueNowForDebt ? Math.min(Number(getDebtRateForMonth(d, currentMonth) || 0), Number(d.amountOpen || 0)) : 0;
      const planned = Number(planItem && planItem.planned || 0) || fallbackRate;
      currentOpenPlannedDebtTotal += planned;
      currentSnowballTotal += Number(planItem && planItem.snowball || 0);
      currentDynamicTotal += Number(planItem && planItem.dynamic || 0);
    });
    const currentPlannedDebtTotal = paidSum + currentOpenPlannedDebtTotal;
    if (currentPlannedDebtTotal > 0) {
      dueSum = currentPlannedDebtTotal;
      openThisMonth = currentOpenPlannedDebtTotal;
    }
    if (snowball.rows.length > 0) {
      card.appendChild(createSummaryMetrics([
        { label: 'Schneeball frei ab', value: snowball.events[0] ? formatMonthLabel(nextMonth(snowball.events[0].month)) : '-' },
        { label: 'Umlage-Regel', value: '6-Monats-Regel + kleinste passende Schuld' },
        { label: 'Plan aktueller Monat', value: `${currentPlannedDebtTotal.toFixed(2)} €` },
        { label: 'davon Schneeball', value: `${currentSnowballTotal.toFixed(2)} €` },
        { label: 'davon extra', value: `${currentDynamicTotal.toFixed(2)} €` },
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
      if (debtFilter === 'due') return Number(d.amountOpen || 0) > 0 && isMonthKey(d.nextDueMonth) && monthDiff(d.nextDueMonth, currentMonth) >= 0 && paidAmount <= 0;
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
      thead.innerHTML = `<tr><th>Name</th><th>Konto</th><th>Offen</th><th>Mindestrate</th><th>+ Schneeball</th><th>+ Extra</th><th>Geplant diesen Monat</th><th>Nächste Fälligkeit</th><th>Vorauss. Ende</th><th>Fortschritt</th><th>Status</th><th>Bezahlt?</th><th>Aktion</th></tr>`;
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      visibleDebts.forEach((d) => {
        ensureDebtConfig(d);
        const tr = document.createElement('tr');
        const dueNow = isMonthKey(d.nextDueMonth) && monthDiff(d.nextDueMonth, currentMonth) >= 0;
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
        const planItem = currentDebtPlan.get(d.name) || { rate: 0, snowball: 0, dynamic: 0, planned: 0 };
        const minRate = Number(getDebtRateForMonth(d, currentMonth) || 0);
        const isFixedPaidThisMonth = paidAmount > 0;
        const plannedRate = isFixedPaidThisMonth ? Math.min(minRate, paidAmount) : (Number(planItem.rate || 0) || (dueNow ? Math.min(minRate, Number(d.amountOpen || 0)) : 0));
        const plannedSnowball = isFixedPaidThisMonth ? 0 : Number(planItem.snowball || 0);
        const plannedDynamic = isFixedPaidThisMonth ? 0 : Number(planItem.dynamic || 0);
        const plannedTotal = isFixedPaidThisMonth ? paidAmount : (Number(planItem.planned || 0) || plannedRate);
        const plannedHtml = plannedTotal > 0
          ? `<strong>${plannedTotal.toFixed(2)} €</strong><div class="small muted">${isFixedPaidThisMonth ? 'fest bezahlt' : 'Rate ' + plannedRate.toFixed(2) + ' €'}</div>`
          : '-';
        tr.innerHTML = `<td class="debt-name-cell"><strong>${d.name}</strong></td><td>${getAccountName(d.accountId)}</td><td>${Number(d.amountOpen || 0).toFixed(2)} €</td><td>${minRate.toFixed(2)} €</td><td>${plannedSnowball > 0 ? '<span class="snowball-pill">+' + plannedSnowball.toFixed(2) + ' €</span>' : '-'}</td><td>${plannedDynamic > 0 ? '<span class="dynamic-pill">+' + plannedDynamic.toFixed(2) + ' €</span>' : '-'}</td><td class="${plannedSnowball > 0 || plannedDynamic > 0 ? 'amount-highlight' : ''}">${plannedHtml}</td><td>${d.nextDueMonth || '-'}</td><td>${estimatedEnd || '-'}</td><td>${progressHtml}</td><td>${statusHtml}</td><td></td><td></td>`;

        const payCell = tr.children[11];
        if (Number(d.amountOpen || 0) <= 0) {
          const done = document.createElement('div');
          const completedMonth = getDebtCompletedMonth(d);
          done.innerHTML = `<span class="pill success">Erledigt</span><div class="small muted">${completedMonth ? formatMonthLabel(completedMonth) : ''}</div>`;
          payCell.appendChild(done);
        } else if (paidNow) {
          const done = document.createElement('div');
          done.innerHTML = `<span class="pill success">Bezahlt</span><div class="small muted">${paidAmount.toFixed(2)} €</div>`;
          payCell.appendChild(done);
        } else if (dueNow && plannedTotal > 0) {
          const btn = document.createElement('button');
          btn.textContent = 'Geplante Zahlung bezahlen';
          btn.className = 'success';
          btn.addEventListener('click', () => {
            markDebtPaid(d, plannedTotal, { rate: plannedRate, snowball: plannedSnowball, dynamic: plannedDynamic });
          });
          payCell.appendChild(btn);
        } else {
          payCell.textContent = '-';
        }

        const actionCell = tr.children[12];
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

        const reviewRuleText = getDebtRateChangeRuleText(d);
        const debtDetailsHtml = `<strong>${d.name}</strong><div><span>Zahlungsart:</span> ${typeHtml}</div>${reviewRuleText ? `<div><span>Regel:</span> ${reviewRuleText}</div>` : ''}<div><span>Ratenverlauf:</span> ${getDebtRateTimelineText(d) ? getDebtRateTimelineText(d) : '-'}</div>${getNextDebtRateChangeText(d) ? `<div class="small muted">${getNextDebtRateChangeText(d)}</div>` : ''}`;
        actionCell.appendChild(createActionMenu([
          { label: 'Bearbeiten', className: 'primary', onClick: () => showDebtEditor(d) },
          { label: 'Rate ändern', className: 'secondary', onClick: () => showDebtRateEditor(d) },
          { label: 'Zahlung eintragen', className: 'success', onClick: () => showDebtPaymentEditor(d) },
          { label: 'Zahlung zurücksetzen', className: 'secondary', disabled: !paidNow && getDebtPaymentAmountForMonth(d, currentMonth) <= 0, onClick: () => { if (confirm(`Zahlung für ${formatMonthLabel(currentMonth)} bei "${d.name}" zurücksetzen?`)) { resetDebtPaymentForMonth(d, currentMonth); saveState(); render(); } } },
          { label: 'Löschen', className: 'danger', onClick: () => { if (confirm(`Schuld "${d.name}" löschen?`)) { state.debts = state.debts.filter((x) => x.id !== d.id); saveState(); render(); } } }
        ], 'Aktionen ⋯', debtDetailsHtml));
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      card.appendChild(table);

      const info = document.createElement('p');
      info.className = 'small muted';
      info.innerHTML = `<strong>Monatsplan inkl. fest bezahlter Beträge + offene Dynamik:</strong> ${dueSum.toFixed(2)} € · <strong>davon Schneeball:</strong> ${currentSnowballTotal.toFixed(2)} € · <strong>davon Extra:</strong> ${currentDynamicTotal.toFixed(2)} € · <strong>Bereits bezahlt:</strong> ${paidSum.toFixed(2)} € · <strong>Noch zu bezahlen:</strong> ${openThisMonth.toFixed(2)} €`;
      card.appendChild(info);
    }

    const snowballCard = renderSnowballPlanCard(currentMonth);
    if (snowballCard) card.appendChild(snowballCard);
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
        const txt = `${entry.sourceDebt} läuft aus: ${Number(entry.amount || 0).toFixed(2)} € ab ${formatMonthLabel(entry.transferMonth)} → ${target}`;
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
        tr.innerHTML = `<td>${formatMonthLabel(row.month)}</td><td>keine Schuldenzahlung</td><td>0,00 €</td><td>-</td><td>-</td><td>0,00 €</td><td>${Number(row.remaining || 0).toFixed(2)} €</td><td>-</td>`;
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
          <td>${Number(item.regular || 0).toFixed(2)} €</td>
          <td>${Number(item.snowball || 0) > 0 ? '<span class="snowball-pill">+' + Number(item.snowball || 0).toFixed(2) + ' €</span>' : '-'}</td>
          <td>${Number(item.dynamic || 0) > 0 ? '<span class="dynamic-pill">+' + Number(item.dynamic || 0).toFixed(2) + ' €</span>' : '-'}</td>
          <td class="${hasExtra ? 'amount-highlight' : ''}"><strong>${Number(item.planned || 0).toFixed(2)} €</strong></td>
          <td>${Number(item.remainingAfter || 0).toFixed(2)} €</td>
          <td>${notes.length ? notes.join('<br>') : '-'}</td>`;
        tbody.appendChild(tr);
        rendered += 1;
      });

      if (transferNotes.has('__free__')) {
        transferNotes.get('__free__').forEach((txt, idx) => {
          const tr = document.createElement('tr');
          tr.className = 'soft-row';
          tr.innerHTML = `<td>${items.length === 0 && idx === 0 ? formatMonthLabel(row.month) : ''}</td><td><strong>frei werdend</strong></td><td>-</td><td>-</td><td>-</td><td>0,00 €</td><td>${Number(row.remaining || 0).toFixed(2)} €</td><td>${txt}</td>`;
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
    const card = document.createElement('div');
    card.className = 'sub-card snowball-card';
    const h = document.createElement('h3');
    h.textContent = 'Schulden-Schneeball';
    card.appendChild(h);
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = 'Berücksichtigt werden nur echte laufende Ratenzahlungen. Die 6-Monats-Regel überspringt Schulden, die ohne Hilfe in den nächsten 6 Folgemonaten sowieso erledigt wären. Zusätzlich wird jeden Monat dynamisch neu gerechnet: erst wenn nach den simulierten Schuldenzahlungen mindestens 600 € frei sind, wird der Betrag oberhalb von 500 € nur dann investiert, wenn damit eine Schuld vollständig getilgt werden kann.';
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

    const activeOpenTotal = (state.debts || []).reduce((sum, debt) => sum + Math.max(0, Number(debt.amountOpen || 0)), 0);
    const firstRow = plan.rows[0] || {};
    const nextEvent = plan.events[0] ? plan.events[0].text : 'Noch keine Rate wird im sichtbaren Zeitraum frei.';
    const summary = document.createElement('div');
    summary.className = 'snowball-hero-grid';
    [
      ['Schuldenfrei voraussichtlich', plan.debtFreeMonth ? formatMonthLabel(plan.debtFreeMonth) : 'nicht im Zeitraum'],
      ['Aktuelle offene Summe', euro(activeOpenTotal)],
      ['Rate im Startmonat', euro(firstRow.total || 0)],
      ['Nächstes Ereignis', nextEvent]
    ].forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'snowball-hero-item';
      item.appendChild(createUiEl('span', '', label));
      item.appendChild(createUiEl('strong', '', value));
      summary.appendChild(item);
    });
    card.appendChild(summary);

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

    const compactNotice = createUiEl('p', 'small muted', 'Für die Übersicht werden hier nur die nächsten 6 Monate angezeigt. Alle Details sind in einer einzigen kompakten Tabelle zusammengeführt. Die Berechnung läuft intern weiter bis schuldenfrei.');
    card.appendChild(compactNotice);
    card.appendChild(renderGroupedDebtPaymentPlanCard(plan, 6));
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
    if (Number(breakdown.rate || 0) > 0) sourceParts.push(`Rate ${Number(breakdown.rate || 0).toFixed(2)} €`);
    if (Number(breakdown.snowball || 0) > 0) sourceParts.push(`Schneeball ${Number(breakdown.snowball || 0).toFixed(2)} €`);
    if (Number(breakdown.dynamic || 0) > 0) sourceParts.push(`Extra ${Number(breakdown.dynamic || 0).toFixed(2)} €`);
    if (addDebtPayment(debt, {
      month: paidMonth,
      amount,
      source: sourceParts.join(' · '),
      note: 'Geplante Monatszahlung festgeschrieben. Offene Schulden bleiben dynamisch.',
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
    info.innerHTML = `<strong>${debt.name}</strong><br>Aktuelle Rate in ${formatMonthLabel(currentMonth)}: <strong>${currentRate.toFixed(2)} €</strong>${getNextDebtRateChangeText(debt) ? `<br>${getNextDebtRateChangeText(debt)}` : ''}`;
    content.appendChild(info);

    const row1 = document.createElement('div');
    row1.className = 'row';
    refs.monthInput = document.createElement('input');
    refs.monthInput.type = 'month';
    refs.monthInput.value = getNextAllowedDebtRateChangeMonth(debt, currentMonth);
    refs.amountInput = document.createElement('input');
    refs.amountInput.type = 'number';
    refs.amountInput.step = '0.01';
    refs.amountInput.value = currentRate > 0 ? currentRate.toFixed(2) : '';
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
          const amount = parseFloat(refs.amountInput.value);
          if (!isMonthKey(month)) return alert('Bitte einen gültigen Monat wählen.');
          if (Number.isNaN(amount) || amount < 0) return alert('Bitte eine gültige Rate eingeben.');
          if (!isDebtRateChangeAllowedInMonth(debt, month)) {
            const allowed = getNextAllowedDebtRateChangeMonth(debt, month);
            refs.monthInput.value = allowed;
            return alert(`${debt.name}: Die Rate darf nur jährlich zum 01.${String(getDebtAnnualRateRule(debt).month).padStart(2, '0')}. angepasst werden. Nächster zulässiger Monat: ${formatMonthLabel(allowed)}.`);
          }
          const oldRate = getDebtRateForMonth(debt, month);
          if (refs.modeSelect.value === 'single_month') {
            if (!setDebtRateOnlyForMonth(debt, month, amount)) return alert('Die Rate konnte für diesen Monat nicht geändert werden.');
            addChangeLog('Schulden', `${debt.name}: Rate nur ${formatMonthLabel(month)} von ${oldRate.toFixed(2)} € auf ${amount.toFixed(2)} € geändert`, month);
          } else {
            if (!setDebtRateFromMonth(debt, month, amount)) return alert('Die Rate konnte ab diesem Monat nicht geändert werden.');
            addChangeLog('Schulden', `${debt.name}: Rate ab ${formatMonthLabel(month)} von ${oldRate.toFixed(2)} € auf ${amount.toFixed(2)} € geändert`, month);
          }
          if (debt.paymentType === 'open_plan' && amount > 0) debt.paymentType = 'installment';
          saveState();
          render();
          close();
        }
      }
    ]);
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


    if (debt && getDebtRateTimelineText(debt)) {
      const timelineInfo = document.createElement('p');
      timelineInfo.className = 'small muted';
      timelineInfo.innerHTML = `<strong>Aktueller Ratenverlauf:</strong> ${getDebtRateTimelineText(debt)}`;
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
    refs.accountSelect = createAccountSelect(editDebt ? editDebt.accountId : getDefaultAccountIdForContext('personal', 'benny'), { includeNone: true });
    typeRow.appendChild(createLabelInput('Zahlungsart', refs.paymentTypeSelect));
    typeRow.appendChild(createLabelInput('Zahlungskonto', refs.accountSelect));
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
    hint.textContent = 'Zahlungsart steuert den Schneeball: Nur Ratenzahlungen zählen mit. Über „Ratenänderung ab Monat“ kannst du spätere Ratenänderungen setzen. Bei MKK ist die Rate auf jährliche Anpassung zum 01.05. begrenzt.';
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
          if (editDebt && getDebtAnnualRateRule(editDebt) && Math.abs(Number(editDebt.monthlyRate || 0) - rate) > 0.01 && !isDebtRateChangeAllowedInMonth(editDebt, currentMonth)) {
            return alert(`${editDebt.name}: Die Monatsrate darf nur zum 01.${String(getDebtAnnualRateRule(editDebt).month).padStart(2, '0')}. geändert werden. Nutze dafür bitte „Rate ändern“ und wähle den Mai des jeweiligen Jahres.`);
          }

          if (editDebt) {
            const wasOpen = Number(editDebt.amountOpen || 0) > 0;
            editDebt.name = name;
            editDebt.amountOpen = open;
            editDebt.monthlyRate = rate;
            editDebt.paymentType = paymentType;
            editDebt.nextDueMonth = due;
            editDebt.accountId = refs.accountSelect.value || '';
            if (open <= 0 && wasOpen) editDebt.completedMonth = currentMonth;
            if (open > 0) delete editDebt.completedMonth;
          } else {
            const newDebt = { id: generateId(), name, amountOpen: open, monthlyRate: rate, paymentType, nextDueMonth: due, paidMonths: [], rateTimeline: [], accountId: refs.accountSelect.value || '' };
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
    const adjustedPersons = state.persons.filter((p) => getPersonNetSourceLabel(p, currentMonth) !== 'Standardwert').length;
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
      const sourceKind = sourceLabel === 'Standardwert' ? 'success' : 'warning';

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
        accountId: typeof goal.accountId === 'string' ? goal.accountId : '',
        isActive: goal.isActive !== false,
        note: typeof goal.note === 'string' ? goal.note : '',
        transactions: Array.isArray(goal.transactions) ? goal.transactions.filter((tx) => tx && typeof tx === 'object').map((tx) => ({
          id: typeof tx.id === 'string' && tx.id ? tx.id : generateId(),
          month: isMonthKey(tx.month) ? tx.month : currentMonth,
          type: tx.type === 'withdraw' ? 'withdraw' : 'deposit',
          amount: Math.max(0, Number(tx.amount || 0)),
          note: typeof tx.note === 'string' ? tx.note : '',
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
      createdAt: new Date().toISOString()
    });
    addChangeLog('Rücklagen', `${g.name}: ${txType === 'deposit' ? 'Einzahlung' : 'Entnahme'} ${euro(value)}.`, monthKey);
    return true;
  }

  function showSavingsGoalEditor(goal) {
    normalizeSavingsGoalsConfig();
    const isNew = !goal;
    const item = goal || { id: generateId(), name: '', targetAmount: 0, monthlyAmount: 0, balance: 0, startMonth: currentMonth, dueMonth: '', accountId: '', isActive: true, note: '', transactions: [] };
    const content = document.createElement('div');
    content.className = 'modal-form';
    const row1 = document.createElement('div');
    row1.className = 'row';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = item.name || '';
    nameInput.placeholder = 'z. B. Auto-Reparatur, Urlaub, MacBook';
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
    const accountSelect = createAccountSelect(item.accountId || '', { includeNone: true });
    const activeSelect = document.createElement('select');
    activeSelect.innerHTML = '<option value="true">Aktiv</option><option value="false">Pausiert</option>';
    activeSelect.value = item.isActive === false ? 'false' : 'true';
    row4.appendChild(createLabelInput('Zielkonto optional', accountSelect));
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
    intro.textContent = 'Neue Logik: Du legst einzelne Posten an, z. B. Auto, Urlaub, MacBook oder Kleidung. Pro Posten kannst du einen Zielbetrag und optional eine feste Monatssumme eintragen. Die alte 70/30-Verteilung wird hier nicht mehr verwendet.';
    card.appendChild(intro);

    const activeGoals = getSavingsGoalsActive(currentMonth);
    const totalSaved = (state.savingsGoals || []).reduce((sum, goal) => sum + Number(goal.balance || 0), 0);
    const monthlyPlan = getSavingsGoalsMonthlyPlan(currentMonth);
    const totalTarget = (state.savingsGoals || []).reduce((sum, goal) => sum + Number(goal.targetAmount || 0), 0);
    const missingTotal = (state.savingsGoals || []).reduce((sum, goal) => sum + getSavingsGoalProgress(goal).missing, 0);
    card.appendChild(createSummaryMetrics([
      { label: 'Aktive Posten', value: String(activeGoals.length), kind: activeGoals.length ? 'success' : 'warning' },
      { label: 'Feste Monatssumme', value: euro(monthlyPlan), kind: monthlyPlan > 0 ? 'success' : '' },
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

      act.appendChild(createActionMenu([
        { label: 'Einzahlen', className: 'success', onClick: () => dep.click() },
        { label: 'Ausgeben', className: 'danger', onClick: () => wit.click() }
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
    syncAllLinkedDebtRatesFromPosts(currentMonth, 36, { silent: true });
    normalizeAllPersonConfigs();
    normalizeAllPostConfigs();
    normalizeAllDebtConfigs();
    const backupState = JSON.parse(JSON.stringify(state));
    if (!backupState.appMeta || typeof backupState.appMeta !== 'object') backupState.appMeta = {};
    backupState.appMeta.includeApiKeyInBackup = true;
    // Der API-Key wird bewusst NICHT entfernt: Benny möchte nur ein Backup, immer mit API-Key.
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





  function normalizeTaxRefund(refund) {
    if (!refund || typeof refund !== 'object') return null;
    if (!refund.id) refund.id = generateId();
    const currentYear = new Date().getFullYear();
    const year = Number(refund.year || currentYear);
    refund.year = Number.isFinite(year) ? String(Math.max(2000, Math.min(2100, Math.trunc(year)))) : String(currentYear);
    const amount = Number(refund.amount || 0);
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
        const itemAmount = Number(item.amount || 0);
        item.amount = Number.isFinite(itemAmount) && itemAmount >= 0 ? itemAmount : 0;
        if (typeof item.date !== 'string') item.date = '';
        if (typeof item.note !== 'string') item.note = '';
        return item;
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
      month: currentMonth,
      date: refund.receivedDate || '',
      type: 'tax_refund',
      sourceId,
      label: `Steuererstattung ${refund.year || ''}`.trim(),
      amount,
      note: 'Betrag aus dem Bereich Steuererstattung automatisch aufs Gemeinschaftskonto gebucht.'
    });
    refund.transactionId = txId || '';
    return txId;
  }

  function removeTaxRefundAccountBooking(refund) {
    if (!refund || typeof refund !== 'object') return false;
    const sourceId = getTaxRefundAccountSourceId(refund);
    let removed = false;
    if (sourceId) removed = removeAccountTransactionBySource(sourceId) || removed;
    if (refund.transactionId && refund.accountId) removed = removeAccountTransaction(refund.accountId, refund.transactionId) || removed;
    refund.transactionId = '';
    return removed;
  }

  function normalizeAllTaxRefunds() {
    if (!Array.isArray(state.taxRefunds)) state.taxRefunds = [];
    state.taxRefunds = state.taxRefunds.map(normalizeTaxRefund).filter(Boolean);
    state.taxRefunds.sort((a, b) => String(b.year).localeCompare(String(a.year)));
    state.taxRefunds.forEach(syncTaxRefundAccountBooking);
  }

  function getTaxRefundSummary(year) {
    normalizeAllTaxRefunds();
    const refunds = (state.taxRefunds || []).filter((item) => String(item.year) === String(year));
    const received = refunds.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const spent = refunds.reduce((sum, item) => sum + (item.purchases || []).reduce((s, p) => s + Number(p.amount || 0), 0), 0);
    return { refunds, received, spent, remaining: received - spent };
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
    amountInput.type = 'number';
    amountInput.step = '0.01';
    amountInput.value = Number(item.amount || 0);
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
    noteInput.placeholder = 'z. B. Steuer 2025, liegt auf dem Gemeinschaftskonto, Rest bleibt gebunden ...';
    content.appendChild(createLabelInput('Notiz', noteInput));

    showModal(isNew ? 'Steuererstattung eintragen' : 'Steuererstattung bearbeiten', content, [
      { label: 'Abbrechen', className: 'secondary', onClick: (close) => close() },
      {
        label: 'Speichern',
        className: 'primary',
        onClick: (close) => {
          const year = Number(yearInput.value || 0);
          const amount = Number(amountInput.value || 0);
          if (!Number.isFinite(year) || year < 2000 || year > 2100) return alert('Bitte ein gültiges Jahr eingeben.');
          if (!Number.isFinite(amount) || amount < 0) return alert('Bitte einen gültigen Betrag eingeben.');
          item.year = String(Math.trunc(year));
          item.amount = amount;
          item.receivedDate = dateInput.value || '';
          item.note = noteInput.value || '';
          if (isNew) state.taxRefunds.push(item);
          normalizeAllTaxRefunds();
          addChangeLog('Steuererstattung', `${isNew ? 'Erstattung eingetragen' : 'Erstattung geändert'}: ${item.year} / ${amount.toFixed(2)} € – auf Gemeinschaftskonto gebucht`, currentMonth);
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
    amountInput.type = 'number';
    amountInput.step = '0.01';
    amountInput.value = Number(item.amount || 0);
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
          const amount = Number(amountInput.value || 0);
          if (!name) return alert('Bitte eine Bezeichnung eingeben.');
          if (!Number.isFinite(amount) || amount < 0) return alert('Bitte einen gültigen Betrag eingeben.');
          item.name = name;
          item.amount = amount;
          item.date = dateInput.value || '';
          item.note = noteInput.value || '';
          if (isNew) refund.purchases.push(item);
          addChangeLog('Steuererstattung', `${isNew ? 'Kauf eingetragen' : 'Kauf geändert'}: ${name} / ${amount.toFixed(2)} €`, currentMonth);
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

    const years = Array.from(new Set([String(new Date().getFullYear()), ...(state.taxRefunds || []).map((r) => String(r.year))])).sort((a, b) => b.localeCompare(a));
    const selectedYear = years[0];
    const summary = getTaxRefundSummary(selectedYear);
    taxRefundSection.appendChild(createSummaryMetrics([
      { label: `Erhalten ${selectedYear}`, value: `${summary.received.toFixed(2)} €`, hint: 'Summe aller eingetragenen Erstattungen' },
      { label: 'Davon gekauft / bezahlt', value: `${summary.spent.toFixed(2)} €`, hint: 'Alle eingetragenen Käufe' },
      { label: 'Rest', value: `${summary.remaining.toFixed(2)} €`, kind: summary.remaining < -0.005 ? 'danger' : 'success', hint: 'Erstattung minus Käufe' },
      { label: 'Einträge', value: `${summary.refunds.length}`, hint: 'Erstattungs-Einträge im Jahr' }
    ]));
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
        { label: 'Erhalten', value: `${Number(refund.amount || 0).toFixed(2)} €`, hint: refund.transactionId ? 'auf Gemeinschaftskonto gebucht' : (refund.receivedDate ? `Eingang: ${refund.receivedDate}` : 'Eingang nicht gesetzt') },
        { label: 'Ausgegeben', value: `${spent.toFixed(2)} €`, hint: `${refund.purchases.length} Kauf/Käufe` },
        { label: 'Rest', value: `${remaining.toFixed(2)} €`, kind: remaining < -0.005 ? 'danger' : 'success' }
      ]));
      if (refund.note) {
        const note = document.createElement('p'); note.className = 'small muted'; note.textContent = refund.note; card.appendChild(note);
      }
      const table = document.createElement('table');
      table.className = 'list-table';
      table.innerHTML = '<thead><tr><th>Datum</th><th>Gekauft / bezahlt</th><th>Betrag</th><th>Notiz</th><th>Aktion</th></tr></thead>';
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
          const amountTd = document.createElement('td'); amountTd.textContent = `${Number(purchase.amount || 0).toFixed(2)} €`;
          const noteTd = document.createElement('td'); noteTd.textContent = purchase.note || '';
          const actionTd = document.createElement('td');
          const editPurchase = document.createElement('button'); editPurchase.className = 'secondary'; editPurchase.textContent = 'Bearbeiten'; editPurchase.addEventListener('click', () => showTaxPurchaseEditor(refund, purchase));
          const deletePurchase = document.createElement('button'); deletePurchase.className = 'danger'; deletePurchase.textContent = 'Löschen'; deletePurchase.addEventListener('click', () => {
            if (confirm('Kauf löschen?')) {
              refund.purchases = refund.purchases.filter((x) => x.id !== purchase.id);
              addChangeLog('Steuererstattung', `Kauf gelöscht: ${purchase.name}`, currentMonth);
              saveState(); render();
            }
          });
          actionTd.appendChild(createActionMenu([
            { label: 'Zu Sonstige Ausgaben verschieben', className: 'primary', onClick: () => showTaxPurchaseToBufferModal(refund, purchase) },
            { label: 'Bearbeiten', className: 'secondary', onClick: () => showTaxPurchaseEditor(refund, purchase) },
            { label: 'Löschen', className: 'danger', onClick: () => { if (confirm('Kauf löschen?')) { refund.purchases = refund.purchases.filter((x) => x.id !== purchase.id); addChangeLog('Steuererstattung', `Kauf gelöscht: ${purchase.name}`, currentMonth); saveState(); render(); } } }
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
      const current = localStorage.getItem('budgetStateV193');
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
    intro.textContent = 'Hier kannst du ein Backup für iCloud Drive oder Dateien erstellen und eine vorhandene Backup-Datei wiederherstellen.';
    card.appendChild(intro);

    const storageInfo = getBrowserStorageInfo();
    const storageNotice = document.createElement('div');
    storageNotice.className = storageInfo.ok ? 'notice success' : 'notice danger';
    storageNotice.innerHTML = storageInfo.ok
      ? `<strong>Browser-Speicher aktiv:</strong> Deine Daten werden dauerhaft unter dem stabilen Speicher "budgetStateStable" gesichert. Neue Versionen übernehmen diese Daten automatisch.${storageInfo.last ? '<br><span class="small muted">Zuletzt gespeichert: ' + new Date(storageInfo.last).toLocaleString('de-DE') + '</span>' : ''}`
      : `<strong>Browser-Speicher nicht verfügbar:</strong> Der Browser blockiert localStorage. Bitte Sicherung herunterladen und Browser-/Privatmodus prüfen.`;
    card.appendChild(storageNotice);

    normalizeAppMeta();
    state.appMeta.includeApiKeyInBackup = true;

    const apiInfo = document.createElement('div');
    apiInfo.className = 'notice success';
    apiInfo.textContent = 'Backup-Einstellung: Es wird genau eine Sicherungsdatei erstellt. Der Tank-API-Key wird immer mitgesichert.';
    card.appendChild(apiInfo);

    const totalPosts = (state.commonCosts?.length || 0) + (state.personalCosts?.length || 0) + (state.bufferExpenses?.length || 0) + (state.taxRefunds?.length || 0);
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

    let backupDownloadInProgress = false;
    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Eine Sicherung mit API-Key herunterladen';
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
    if (!Array.isArray(state.taxRefunds)) state.taxRefunds = [];
    normalizeAllTaxRefunds();
    normalizeBudgetTopUpsConfig();
    normalizeCommonAccountConfig();
    normalizeAccountsConfig();
    normalizeAccountTransfersConfig();
    normalizeAccountTransferTemplatesConfig();
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
            setCurrentMonth(dateToMonthKey(new Date()), false);
            state.appMeta.selectedMonth = currentMonth;
            state.appMeta.lastAutoMonthCheck = currentMonth;
            monthList = getSelectableMonths(currentMonth);
            syncAllLinkedDebtRatesFromPosts(currentMonth, 36, { silent: true });
            saveState();
            const importCheckItems = getDataCheckItems();
            const importWarnings = importCheckItems.filter((item) => item.kind === 'warning' || item.kind === 'danger').length;
            importInput.value = '';
            selectedFile = null;
            setInlineStatus(importWarnings > 0 ? `Import erfolgreich. ${importWarnings} Hinweis(e) im Datencheck gefunden.` : 'Import erfolgreich. Datencheck ohne kritische Warnungen.', importWarnings > 0 ? 'warning' : 'success');
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
    if (state.appMeta.lastAutoMonthCheck !== actualMonth) {
      currentMonth = actualMonth;
      monthList = getSelectableMonths(currentMonth);
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
    const parseEuroInput = (value) => Number(String(value ?? '').trim().replace(/\s+/g, '').replace(',', '.'));
    const refs = {};
    const content = document.createElement('div');
    content.className = 'modal-form';

    const activeNetForMonth = getPersonNet(person, currentMonth);
    const sourceLabel = getPersonNetSourceLabel(person, currentMonth);

    const currentInfo = document.createElement('p');
    currentInfo.className = 'small';
    currentInfo.innerHTML = `<strong>Aktiv in ${formatMonthLabel(currentMonth)}:</strong> ${activeNetForMonth.toFixed(2)} € <span class="muted">(${sourceLabel})</span>`;
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
    identityRow.appendChild(createLabelInput('Verschiebung', refs.shiftInput));
    content.appendChild(identityRow);

    const incomeRow = document.createElement('div');
    incomeRow.className = 'row';
    refs.newNetInput = document.createElement('input');
    refs.newNetInput.type = 'text';
    refs.newNetInput.inputMode = 'decimal';
    refs.newNetInput.value = activeNetForMonth.toFixed(2);
    refs.modeSelect = document.createElement('select');
    refs.modeSelect.innerHTML = `
      <option value="once">Nur dieser Monat</option>
      <option value="future">Ab diesem Monat dauerhaft</option>
    `;
    // Wenn der aktuelle Wert bereits dauerhaft ab diesem Monat kommt, ist „dauerhaft“ als Vorauswahl logischer.
    if (sourceLabel === 'dauerhaft ab diesem Monat' || sourceLabel === 'Standardwert') refs.modeSelect.value = 'future';
    incomeRow.appendChild(createLabelInput(`Neues Netto ab/für ${formatMonthLabel(currentMonth)}`, refs.newNetInput));
    incomeRow.appendChild(createLabelInput('Änderung gilt', refs.modeSelect));
    content.appendChild(incomeRow);

    const standardBox = document.createElement('details');
    standardBox.className = 'details-box';
    const summary = document.createElement('summary');
    summary.textContent = 'Basis-Netto / Standardwert anzeigen';
    standardBox.appendChild(summary);
    const baseRow = document.createElement('div');
    baseRow.className = 'row';
    refs.baseNetInput = document.createElement('input');
    refs.baseNetInput.type = 'text';
    refs.baseNetInput.inputMode = 'decimal';
    refs.baseNetInput.value = Number(person.net || 0).toFixed(2);
    baseRow.appendChild(createLabelInput('Basis-Netto', refs.baseNetInput));
    standardBox.appendChild(baseRow);
    content.appendChild(standardBox);

    const helper = document.createElement('p');
    helper.className = 'small muted';
    helper.textContent = 'Wichtig: Das Feld „Neues Netto“ ist maßgeblich. Der Ausgleich/Verschiebung gehört zur Aufteilungsregel und sollte normalerweise nur 250 oder -250 sein.';
    content.appendChild(helper);

    showModal(`${person.name || 'Person'} bearbeiten`, content, [
      {
        label: 'Nur Monatswert löschen',
        className: 'secondary',
        onClick: (close) => {
          clearPersonNetForMonth(person, currentMonth, 'once');
          saveState();
          close();
          render();
        }
      },
      {
        label: 'Dauerwert ab Monat löschen',
        className: 'secondary',
        onClick: (close) => {
          clearPersonNetForMonth(person, currentMonth, 'future');
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
          const shift = parseEuroInput(refs.shiftInput.value);
          const baseNet = parseEuroInput(refs.baseNetInput.value);
          const newNet = parseEuroInput(refs.newNetInput.value);
          if (!newName) return alert('Name darf nicht leer sein.');
          if (Number.isNaN(shift)) return alert('Bitte eine gültige Verschiebung eingeben.');
          if (Math.abs(shift) > 1000) return alert('Die Verschiebung wirkt unplausibel. Bitte nicht das Netto eintragen, sondern z. B. 250 oder -250.');
          if (Number.isNaN(baseNet) || baseNet < 0) return alert('Bitte ein gültiges Basis-Netto eingeben.');
          if (Number.isNaN(newNet) || newNet < 0) return alert('Bitte ein gültiges Netto eingeben.');

          person.name = newName;
          person.shift = shift;
          person.net = baseNet;

          const mode = refs.modeSelect.value === 'once' ? 'once' : 'future';
          if (!setPersonNetForMonth(person, currentMonth, newNet, mode)) return alert('Das Netto konnte nicht gespeichert werden.');

          addChangeLog('Einkommen', `${person.name}: Netto ${mode === 'once' ? 'für ' + formatMonthLabel(currentMonth) : 'ab ' + formatMonthLabel(currentMonth)} auf ${euro(newNet)} geändert.`);
          saveState();
          close();
          render();
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
      versionChip.textContent = 'Update 1.71 geladen';
      setTimeout(() => {
        versionChip.textContent = 'Version 1.93 geladen';
      }, 2500);
    } else {
      versionChip.textContent = 'Version 1.93 geladen';
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