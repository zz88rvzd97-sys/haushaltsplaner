/* * Haushaltsplaner Version 3.14
 *
 * Die Monatsanteile der gemeinsamen Kosten kÃ¶nnen pro Person und Monat
 * manuell eingetragen werden. Deutsche Komma-BetrÃ¤ge werden unterstÃ¼tzt;
 * ohne manuellen Wert bleibt die automatische Aufteilung aktiv.
 */

(() => {
  // Browserdaten werden beim normalen App-Start NICHT mehr angefasst.
  // Service-Worker/Caches werden nur noch Ã¼ber die bewusste Aktion â€žNeu laden" bereinigt,
  // damit localStorage/Backups beim Versionswechsel zuverlÃ¤ssig erhalten bleiben.
  // ----- Datums-Hilfsfunktionen -----
  const APP_FIRST_DATA_MONTH = '2026-04';
  const APP_FUTURE_YEAR_RANGE = 50;
  const TANK_REAL_DATA_START_MONTH = '2026-06';
  const CARRYOVER_START_MONTH = '2026-08';
  const PRIVATE_HOUSEHOLD_ONLY_START_MONTH = '2026-10';
  const APP_VERSION = '3.14';
  const HOUSEHOLD_PAYMENT_METHOD_LABELS = {
    cash: 'Bar',
    transfer: 'Ãœberweisung',
    direct_debit: 'Lastschrift'
  };

  function normalizeHouseholdPaymentMethod(value) {
    return Object.prototype.hasOwnProperty.call(HOUSEHOLD_PAYMENT_METHOD_LABELS, value) ? value : '';
  }

  function getHouseholdPaymentMethodLabel(value) {
    return HOUSEHOLD_PAYMENT_METHOD_LABELS[normalizeHouseholdPaymentMethod(value)] || 'Nicht angegeben';
  }

  function createHouseholdPaymentMethodSelect(value = '') {
    const select = document.createElement('select');
    select.innerHTML = '<option value="">Nicht angegeben</option><option value="cash">Bar</option><option value="transfer">Ãœberweisung</option><option value="direct_debit">Lastschrift</option>';
    select.value = normalizeHouseholdPaymentMethod(value);
    return select;
  }

  function appendHouseholdPaymentMethodField(parent, refs, item, options = {}) {
    const hasStoredMethod = item && Object.prototype.hasOwnProperty.call(item, 'paymentMethod');
    refs.paymentMethodSelect = createHouseholdPaymentMethodSelect(
      hasStoredMethod ? item.paymentMethod : (options.defaultValue || '')
    );
    parent.appendChild(createLabelInput('Zahlungsweg', refs.paymentMethodSelect));
    return refs.paymentMethodSelect;
  }

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
      (state.smokingExpenses || []).forEach((expense) => {
        addKey(expense && expense.month);
        addFromDate(expense && expense.date);
      });
      ((state.selfEmployment && state.selfEmployment.recurringExpenses) || []).forEach((template) => {
        addKey(template && template.startMonth);
        addKey(template && template.endMonth);
      });
    }

    return Array.from(keys).sort().map((key) => {
      const label = monthKeyToDate(key).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
      return { key, label: key === actualKey ? `${label} Â· aktuell` : label };
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
      .map((entry) => ({
        month: entry.month,
        amount: Math.max(0, Number(entry.amount || 0)),
        pending: entry.pending === true
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const cleaned = [];
    debt.rateTimeline.forEach((entry) => {
      const existing = cleaned.find((item) => item.month === entry.month);
      if (existing) {
        existing.amount = entry.amount;
        existing.pending = entry.pending;
      }
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

  function isDebtRatePendingForMonth(debt, monthKey = currentMonth) {
    if (!debt || !isMonthKey(monthKey)) return false;
    normalizeDebtRateTimeline(debt);
    let pending = false;
    debt.rateTimeline.forEach((entry) => {
      if (monthDiff(entry.month, monthKey) >= 0) pending = entry.pending === true;
    });
    return pending;
  }

  const DEBT_PAYMENT_RULE_MODES = ['flexible', 'regular_or_full', 'regular_only', 'payment_info_missing'];

  function getDebtPaymentRuleOptions() {
    return [
      ['flexible', 'Sonderzahlungen erlaubt'],
      ['regular_or_full', 'Nur normale Rate oder alles'],
      ['regular_only', 'AusschlieÃŸlich normale Rate'],
      ['payment_info_missing', 'Zahlungsweg noch unbekannt']
    ];
  }

  function inferDebtPaymentRuleMode(debt) {
    if (!debt || typeof debt !== 'object') return 'flexible';
    if (DEBT_PAYMENT_RULE_MODES.includes(debt.paymentRuleMode)) return debt.paymentRuleMode;
    const nameKey = normalizeTextKey(debt.name || '');
    const compactNameKey = nameKey.replace(/[^a-z0-9]/g, '');
    const stored = debt.creditorRule && typeof debt.creditorRule === 'object' ? debt.creditorRule : null;
    if (compactNameKey.includes('huk24')) return 'payment_info_missing';
    if ((nameKey.includes('riverty') && (compactNameKey.includes('az1') || compactNameKey.includes('s19')))
      || compactNameKey.includes('cleverfit')) return 'regular_or_full';
    if (nameKey.includes('kreiskasse') || nameKey.includes('opr')) return 'regular_only';
    if (stored) {
      if (stored.type === 'regular_only_payment_info_missing') return 'payment_info_missing';
      if (stored.type === 'regular_or_full_payoff' || stored.extraPaymentMode === 'full_payoff_only') return 'regular_or_full';
      if (stored.type === 'locked_plan_no_extra' || stored.extraPaymentMode === 'none' || stored.allowExtraPayments === false) return 'regular_only';
    }
    return 'flexible';
  }

  function normalizeDebtPaymentRuleMode(debt) {
    if (!debt || typeof debt !== 'object') return 'flexible';
    debt.paymentRuleMode = inferDebtPaymentRuleMode(debt);
    return debt.paymentRuleMode;
  }

  function getDebtCreditorRule(debt) {
    if (!debt || typeof debt !== 'object') return null;
    const mode = inferDebtPaymentRuleMode(debt);
    if (mode === 'regular_or_full') {
      return {
        type: 'regular_or_full_payoff',
        label: 'Nur die vereinbarte Rate oder die vollstÃ¤ndige Gesamtforderung sind mÃ¶glich. Einzelne Sonderzahlungen werden nicht vorgeschlagen.',
        allowExtraPayments: true,
        allowSnowballTarget: true,
        allowDynamicExtra: false,
        extraPaymentMode: 'full_payoff_only'
      };
    }
    if (mode === 'regular_only' || mode === 'payment_info_missing') {
      const missingInfo = mode === 'payment_info_missing';
      return {
        type: missingInfo ? 'regular_only_payment_info_missing' : 'regular_only',
        label: missingInfo
          ? 'Der Zahlungsweg fÃ¼r freiwillige Zahlungen ist noch nicht bekannt. Deshalb wird nur die vereinbarte Rate eingeplant.'
          : 'Es wird ausschlieÃŸlich die vereinbarte Rate eingeplant. Sonderzahlungen und GesamtablÃ¶sung werden nicht vorgeschlagen.',
        allowExtraPayments: false,
        allowSnowballTarget: false,
        allowDynamicExtra: false,
        extraPaymentMode: 'none'
      };
    }
    return {
      type: 'flexible_extra',
      label: 'Sonderzahlungen, RatenerhÃ¶hungen und eine vollstÃ¤ndige AblÃ¶sung dÃ¼rfen vorgeschlagen werden.',
      allowExtraPayments: true,
      allowSnowballTarget: true,
      allowDynamicExtra: true,
      extraPaymentMode: 'flexible'
    };
  }

  function isDebtExtraPaymentAllowed(debt) {
    const rule = getDebtCreditorRule(debt);
    return !(rule && rule.allowExtraPayments === false);
  }

  function isDebtAllowedAsSnowballTarget(debt) {
    const rule = getDebtCreditorRule(debt);
    return !(rule && rule.allowSnowballTarget === false);
  }

  function getDebtExtraPaymentMode(debt) {
    const rule = getDebtCreditorRule(debt);
    if (rule && rule.extraPaymentMode === 'full_payoff_only') return 'full_payoff_only';
    if (rule && (rule.extraPaymentMode === 'none' || rule.allowExtraPayments === false)) return 'none';
    return 'flexible';
  }

  function isDebtFullPayoffOnly(debt) {
    return getDebtExtraPaymentMode(debt) === 'full_payoff_only';
  }

  function canModifyDebtRateForCreditor(debt, monthKey) {
    const rule = getDebtCreditorRule(debt);
    if (!rule) return true;
    const nameKey = normalizeTextKey(debt && debt.name || '');
    if (nameKey.includes('kreiskasse') || nameKey.includes('opr')) {
      // FÃ¼r diese Forderung bleiben automatische RatenerhÃ¶hungen und
      // Kostenposten-Synchronisierung gesperrt. Manuelle Ã„nderungen der
      // vereinbarten Monatsrate laufen separat Ã¼ber â€žRate Ã¤ndernâ€œ.
      return false;
    }
    return true;
  }

  function ensureDebtCreditorRule(debt) {
    if (!debt || typeof debt !== 'object') return null;
    normalizeDebtPaymentRuleMode(debt);
    const rule = getDebtCreditorRule(debt);
    if (rule) {
      debt.creditorRule = {
        type: rule.type,
        label: rule.label,
        allowExtraPayments: rule.allowExtraPayments !== false,
        allowSnowballTarget: rule.allowSnowballTarget !== false,
        allowDynamicExtra: rule.allowDynamicExtra !== false,
        extraPaymentMode: rule.extraPaymentMode || (rule.allowExtraPayments === false ? 'none' : 'flexible')
      };
      return debt.creditorRule;
    }
    return null;
  }

  function setDebtRateFromMonth(debt, month, amount, options = {}) {
    if (!debt || !isMonthKey(month)) return false;
    if (!options.manual && !canModifyDebtRateForCreditor(debt, month)) return false;
    if (!isDebtRateChangeAllowedInMonth(debt, month)) return false;
    const rate = Math.max(0, Number(amount || 0));
    normalizeDebtRateTimeline(debt);
    const existing = debt.rateTimeline.find((entry) => entry.month === month);
    if (existing) {
      existing.amount = rate;
      existing.pending = options.pending === true;
    } else debt.rateTimeline.push({ month, amount: rate, pending: options.pending === true });
    debt.rateTimeline.sort((a, b) => a.month.localeCompare(b.month));
    return true;
  }

  function getDebtRateTimelineText(debt) {
    normalizeDebtRateTimeline(debt);
    if (!debt.rateTimeline.length) return '';
    return debt.rateTimeline.map((entry) => `ab ${formatMonthLabel(entry.month)}: ${euro(Number(entry.amount || 0))}${entry.pending ? ' (beantragt â€“ noch nicht bewilligt)' : ''}`).join(' Â· ');
  }

  function getNextDebtRateChangeText(debt, fromMonth = currentMonth) {
    normalizeDebtRateTimeline(debt);
    const next = debt.rateTimeline.find((entry) => monthDiff(fromMonth, entry.month) > 0);
    if (!next) return '';
    return `NÃ¤chste Ã„nderung: ab ${formatMonthLabel(next.month)} â†’ ${euro(Number(next.amount || 0))}`;
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
        label: stored.label || `Anpassung nur jÃ¤hrlich zum 01.${String(month).padStart(2, '0')}.`
      };
    }
    if (isMkk) {
      return {
        type: 'annual_review',
        month: 5,
        firstAllowedMonth: '2027-05',
        label: 'MKK: Pflicht-Rate 40 â‚¬ ab 01.05.2026; erste RatenprÃ¼fung nach 12 Raten, danach nur jÃ¤hrlich zum 01.05. anpassen. Sonderzahlungen und komplette AblÃ¶sung bleiben jederzeit mÃ¶glich.'
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
    return rule.label || `Rate darf nur jÃ¤hrlich zum 01.${String(rule.month).padStart(2, '0')}. geÃ¤ndert werden.`;
  }

  function setDebtRateOnlyForMonth(debt, month, amount, options = {}) {
    if (!debt || !isMonthKey(month)) return false;
    const restoreMonth = addMonths(month, 1);
    const restoreRate = getDebtRateForMonth(debt, restoreMonth);
    const restorePending = isDebtRatePendingForMonth(debt, restoreMonth);
    setDebtRateFromMonth(debt, month, amount, options);
    setDebtRateFromMonth(debt, restoreMonth, restoreRate, { ...options, pending: restorePending });
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
      addChangeLog('Schulden', `${debt.name}: Rate automatisch aus ${post.name || 'verknÃ¼pftem Posten'} auf ${euro(targetAmount)} ab ${formatMonthLabel(effectiveMonth)} gesetzt`, effectiveMonth);
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
            addChangeLog('Schulden', `${debt.name}: Rate aus verknÃ¼pftem Posten ${post.name || ''} auf ${euro(amount)} ab ${formatMonthLabel(month)} synchronisiert`, month);
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
        paymentMethod: normalizeHouseholdPaymentMethod(entry.paymentMethod),
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
      ? 'Monatlich Â· Stand einsehbar'
      : 'JÃ¤hrlich Â· Stand nicht laufend einsehbar';
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
    // Wenn der verknÃ¼pfte Kostenposten bezahlt wird, ist genau dieser Monatsbetrag maÃŸgeblich.
    // Die Schuld darf nicht bei einer alten Rate hÃ¤ngen bleiben.
    if (debt.paymentType === 'installment') {
      syncLinkedDebtRateFromPost(post, monthKey, 'once', { silent: true });
    }
    return addDebtPayment(debt, {
      month: monthKey,
      amount: postAmount,
      source: `VerknÃ¼pfter Posten: ${post.name || 'Posten'}`,
      sourcePostId: post.id || '',
      paymentMethod: post.paymentMethod,
      markAsMonthly: true,
      skipAccountTransaction: true,
      // Der Kostenposten ist in diesem Ablauf bereits bezahlt markiert.
      // Dadurch darf die Gegenrichtung nicht noch einmal eingreifen.
      skipLinkedPostSync: true
    });
  }

  function syncLinkedPostsFromDebtPayment(debt, options = {}) {
    const month = isMonthKey(options.month) ? options.month : currentMonth;
    const paymentAmount = Math.max(0, Number(options.paymentAmount || 0));
    const shouldCloseMonthlyPost = options.markAsMonthly === true || options.debtCompleted === true;
    if (!debt || !isMonthKey(month) || !(paymentAmount > 0) || !shouldCloseMonthlyPost) return false;

    ensureDebtConfig(debt);
    const linkedItems = getLinkedPostsForDebt(debt)
      .filter((item) => item && item.post && isDue(item.post, month))
      .filter((item) => !isPostPaidForMonth(item.post, month));
    if (!linkedItems.length) return false;

    const contractualRate = Math.max(0, Number(getDebtRateForMonth(debt, month) || 0));
    const requestedLinkedAmount = Number(options.linkedPostAmount);
    const linkedAmount = roundMoney(Math.min(
      paymentAmount,
      Number.isFinite(requestedLinkedAmount) && requestedLinkedAmount > 0
        ? requestedLinkedAmount
        : (contractualRate > 0 ? contractualRate : paymentAmount)
    ));
    if (!(linkedAmount > 0)) return false;

    const weightedItems = linkedItems.map((item, index) => ({
      id: item.post.id || `linked-post-${index}`,
      weight: Math.max(0.01, Number(getEffectiveAmountForMonth(item.post, month) || 0))
    }));
    const allocations = splitExactAmount(linkedAmount, weightedItems);
    let syncedCount = 0;

    linkedItems.forEach((item, index) => {
      const post = item.post;
      ensurePostConfig(post);
      const allocationId = post.id || `linked-post-${index}`;
      const amount = Number(allocations[allocationId] || 0);
      if (!(amount > 0)) return;

      const hadAmountOverride = Object.prototype.hasOwnProperty.call(post.amountOverrides, month);
      const previousAmountOverride = hadAmountOverride ? Number(post.amountOverrides[month]) : null;
      setPostAmountForMonth(post, month, amount, 'once');
      setPostPaidForMonth(post, month, true);
      post.debtPaymentSync[month] = {
        debtId: debt.id || '',
        historyId: options.historyId || '',
        amount,
        hadAmountOverride,
        previousAmountOverride: Number.isFinite(previousAmountOverride) ? previousAmountOverride : null
      };
      syncedCount += 1;
    });

    if (syncedCount > 0) {
      addChangeLog(
        'Schulden',
        `${debt.name || 'Schuld'}: ${syncedCount === 1 ? 'verknÃ¼pften Kostenposten' : `${syncedCount} verknÃ¼pfte Kostenposten`} mit insgesamt ${euro(linkedAmount)} als bezahlt Ã¼bernommen; keine doppelte Monatsausgabe.`,
        month
      );
      return true;
    }
    return false;
  }

  function resetLinkedPostsFromDebtPayment(debt, monthKey, removedEntries = []) {
    if (!debt || !isMonthKey(monthKey)) return false;
    const removedHistoryIds = new Set((removedEntries || []).map((entry) => entry && entry.id).filter(Boolean));
    let resetCount = 0;
    getLinkedPostsForDebt(debt).forEach(({ post }) => {
      if (!post) return;
      ensurePostConfig(post);
      const syncEntry = post.debtPaymentSync[monthKey];
      if (!syncEntry || (syncEntry.debtId && syncEntry.debtId !== debt.id)) return;
      if (syncEntry.historyId && removedHistoryIds.size > 0 && !removedHistoryIds.has(syncEntry.historyId)) return;

      setPostPaidForMonth(post, monthKey, false);
      if (syncEntry.hadAmountOverride && Number.isFinite(Number(syncEntry.previousAmountOverride))) {
        post.amountOverrides[monthKey] = Number(syncEntry.previousAmountOverride);
      } else {
        delete post.amountOverrides[monthKey];
      }
      delete post.debtPaymentSync[monthKey];
      resetCount += 1;
    });
    if (resetCount > 0) {
      addChangeLog('Schulden', `${debt.name || 'Schuld'}: automatisch gesetzten Bezahlt-Status bei den verknÃ¼pften Kosten zurÃ¼ckgesetzt.`, monthKey);
      return true;
    }
    return false;
  }
  function resetDebtPaymentFromPost(post, monthKey) {
    const debt = getLinkedDebtForPost(post);
    if (!debt || !isMonthKey(monthKey)) return false;
    const reset = resetDebtPaymentForMonth(debt, monthKey, {
      sourcePostId: post.id || '',
      sourceLabel: `VerknÃ¼pfter Posten: ${post.name || 'Posten'}`
    });
    if (reset || !debt.paidMonths.includes(monthKey)) return reset;
    const hasOtherMonthlyProof = (debt.paymentHistory || []).some((entry) => entry && entry.month === monthKey && entry.markedAsMonthly)
      || getLinkedPostsForDebt(debt).some(({ post: candidate }) => candidate !== post && isPostPaidForMonth(candidate, monthKey));
    if (hasOtherMonthlyProof) return false;
    debt.paidMonths = debt.paidMonths.filter((month) => month !== monthKey);
    if (!debt.nextDueMonth || monthDiff(monthKey, debt.nextDueMonth) > 0) debt.nextDueMonth = monthKey;
    addChangeLog('Schulden', `${debt.name || 'Schuld'}: Bezahlt-Status ohne Zahlungsnachweis fÃ¼r ${formatMonthLabel(monthKey)} zurÃ¼ckgesetzt; Restschuld unverÃ¤ndert.`, monthKey);
    return true;
  }
  function repairMissingDebtPaymentFromPost(post, monthKey, reduceOpenBalance) {
    const debt = getLinkedDebtForPost(post);
    if (!debt || !isMonthKey(monthKey) || !isPostPaidForMonth(post, monthKey)) return false;
    ensureDebtConfig(debt);
    ensurePostConfig(post);
    const sourceLabel = `VerknÃ¼pfter Posten: ${post.name || 'Posten'}`;
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
      paymentMethod: post.paymentMethod,
      note: reduceOpenBalance === false
        ? 'Nachtrag: Zahlung war im gespeicherten Restschuldstand bereits berÃ¼cksichtigt.'
        : 'Nachtrag aus bereits bezahltem, verknÃ¼pftem Kostenposten.',
      markAsMonthly: true,
      allowExistingMonthlyStatus: true,
      reducedOpenBalance: reduceOpenBalance !== false,
      skipAccountTransaction: true,
      skipLinkedPostSync: true
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
    selfEmployment: {
      businessName: '',
      taxMode: 'small_business',
      entries: [],
      recurringExpenses: []
    },
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
    contracts: [],
    contractSuggestionDismissals: [],
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
      groceries: { name: 'Einkaufsgeld', startMonth: '2026-07', balances: {}, notes: {}, targetAmount: 550, targetStartMonth: '2026-06', targetOverrides: {} },
    },
    appMeta: {
      selectedMonth: '',
      lastAutoMonthCheck: '',
      lastPreparedMonth: '',
      includeApiKeyInBackup: true,
      lastAutomaticBrowserBackupAt: '',
      externalBackupFolderName: '',
      lastExternalBackupAt: '',
      lastBatchPayment: null,
      debtSavingsLedger: []
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
  const AUTOMATIC_FUEL_CARRYOVER_NOTE_PREFIX = 'Automatisch aus Tankmonat ';
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
    monthlyTarget: 800,
    monthlyTargetStartMonth: '2026-10',
    incomeLinkedExtraStartMonth: '2027-01',
    incomeLinkedExtraThreshold: 2300,
    incomeLinkedExtraPersonName: 'Benny'
  };

  function sanitizeStateTextValues(value, seen = new WeakSet()) {
    if (typeof value === 'string') {
      return value
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/</g, 'â€¹')
        .replace(/>/g, 'â€º');
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
          console.warn('Speicher-RÃ¼cksetzung fehlgeschlagen', key, rollbackErr);
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
      + (Array.isArray(obj.contracts) ? obj.contracts.length * 4 : 0)
      + (Array.isArray(obj.accounts) ? obj.accounts.length * 4 : 0)
      + (Array.isArray(obj.taxRefunds) ? obj.taxRefunds.length * 4 : 0)
      + (Array.isArray(obj.groceryExpenses) ? obj.groceryExpenses.length * 2 : 0)
      + (Array.isArray(obj.smokingExpenses) ? obj.smokingExpenses.length * 2 : 0)
      + (obj.selfEmployment && Array.isArray(obj.selfEmployment.entries) ? obj.selfEmployment.entries.length * 3 : 0)
      + (obj.selfEmployment && Array.isArray(obj.selfEmployment.recurringExpenses) ? obj.selfEmployment.recurringExpenses.length * 2 : 0)
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
      console.warn('UngÃ¼ltiger Speicherstand ignoriert', key, e);
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
    removeRetiredSavingsAndSmokingData();
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
    if (!Array.isArray(state.contracts)) state.contracts = [];
    if (!Array.isArray(state.contractSuggestionDismissals)) state.contractSuggestionDismissals = [];
    normalizeSelfEmployment();
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
    normalizeAllPersonConfigs();
    normalizeAllPostConfigs();
    ensureBennyHuk24AdditionalPensionFromOctober2026();
    ensureGroceryMoneyFromJune2026();
    normalizeAllDebtConfigs();
    normalizeContracts();
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
      normalizeContracts();
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
      alert('Die App konnte deine Daten im Browser nicht speichern. Bitte exportiere sofort ein Backup unter â€žSichernâ€œ.');
      return false;
    }
  }

  function removeRetiredSavingsAndSmokingData() {
    // User-managed savings goals and pots are retired. Debt-payoff reserve
    // automation remains in appMeta.debtSavingsLedger and is left untouched.
    state.pots = [];
    state.savingsGoals = [];
    state.reservesSavedMonths = [];
    state.reserveItemSaved = {};
    state.smokingExpenses = [];
    ['commonCosts', 'personalCosts', 'bufferExpenses'].forEach((collection) => {
      if (!Array.isArray(state[collection])) return;
      state[collection] = state[collection].filter((post) => !normalizeTextKey(post && post.name).includes('rauchzeug'));
      state[collection].forEach((post) => {
        if (post && typeof post === 'object') post.linkedSavingsGoalId = '';
      });
    });
    if (state.budgetTopUps && typeof state.budgetTopUps === 'object') delete state.budgetTopUps.smoking;
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
        lastBatchPayment: null,
        debtPlanLastRecalculatedAt: '',
        debtPlanLastRecalculatedMonth: '',
        debtPlanLastRecalculatedDebtId: '',
        debtPlanLastRecalculatedDebtName: '',
        debtPlanLastImpact: null,
        debtAssistantActionStatus: {},
        debtSavingsLedger: []
      };
    }
    if (!isMonthKey(state.appMeta.selectedMonth)) state.appMeta.selectedMonth = '';
    if (!isMonthKey(state.appMeta.lastAutoMonthCheck)) state.appMeta.lastAutoMonthCheck = '';
    if (!isMonthKey(state.appMeta.lastPreparedMonth)) state.appMeta.lastPreparedMonth = '';
    if (typeof state.appMeta.lastAutomaticBrowserBackupAt !== 'string') state.appMeta.lastAutomaticBrowserBackupAt = '';
    if (typeof state.appMeta.externalBackupFolderName !== 'string') state.appMeta.externalBackupFolderName = '';
    if (typeof state.appMeta.lastExternalBackupAt !== 'string') state.appMeta.lastExternalBackupAt = '';
    if (typeof state.appMeta.debtPlanLastRecalculatedAt !== 'string') state.appMeta.debtPlanLastRecalculatedAt = '';
    if (!isMonthKey(state.appMeta.debtPlanLastRecalculatedMonth)) state.appMeta.debtPlanLastRecalculatedMonth = '';
    if (typeof state.appMeta.debtPlanLastRecalculatedDebtId !== 'string') state.appMeta.debtPlanLastRecalculatedDebtId = '';
    if (typeof state.appMeta.debtPlanLastRecalculatedDebtName !== 'string') state.appMeta.debtPlanLastRecalculatedDebtName = '';
    if (!state.appMeta.debtPlanLastImpact || typeof state.appMeta.debtPlanLastImpact !== 'object') state.appMeta.debtPlanLastImpact = null;
    if (!state.appMeta.debtAssistantActionStatus || typeof state.appMeta.debtAssistantActionStatus !== 'object' || Array.isArray(state.appMeta.debtAssistantActionStatus)) {
      state.appMeta.debtAssistantActionStatus = {};
    } else {
      state.appMeta.debtAssistantActionStatus = Object.fromEntries(Object.entries(state.appMeta.debtAssistantActionStatus)
        .filter(([key, value]) => typeof key === 'string' && (value === 'later' || value === 'done')));
    }
    if (!Array.isArray(state.appMeta.debtSavingsLedger)) state.appMeta.debtSavingsLedger = [];
    state.appMeta.debtSavingsLedger = state.appMeta.debtSavingsLedger
      .filter((entry) => entry && typeof entry === 'object' && isMonthKey(entry.month) && ['deposit', 'withdrawal'].includes(entry.type) && Number(entry.amount || 0) > 0)
      .map((entry) => ({
        id: typeof entry.id === 'string' && entry.id ? entry.id : generateId(),
        month: entry.month,
        type: entry.type,
        amount: roundMoney(Math.max(0, Number(entry.amount || 0))),
        actionKey: typeof entry.actionKey === 'string' ? entry.actionKey : '',
        debtId: typeof entry.debtId === 'string' ? entry.debtId : '',
        debtName: typeof entry.debtName === 'string' ? entry.debtName : '',
        note: typeof entry.note === 'string' ? entry.note : '',
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString()
      }));
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
      groceries: { name: 'Einkaufsgeld', startMonth: '2026-07', targetAmount: 500, targetStartMonth: '2026-06' },
    };
    Object.entries(defaults).forEach(([key, cfg]) => {
      const entry = state.budgetTopUps[key] && typeof state.budgetTopUps[key] === 'object' ? state.budgetTopUps[key] : {};
      entry.name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : cfg.name;
      entry.startMonth = isMonthKey(entry.startMonth) ? entry.startMonth : cfg.startMonth;
      if (key === 'groceries') {
        entry.targetAmount = Number.isFinite(Number(entry.targetAmount)) && Number(entry.targetAmount) > 0 ? Number(entry.targetAmount) : Number(cfg.targetAmount || 500);
        entry.targetStartMonth = isMonthKey(entry.targetStartMonth) ? entry.targetStartMonth : (cfg.targetStartMonth || '2026-06');
      }
      if (key === 'groceries') {
        if (!entry.targetOverrides || typeof entry.targetOverrides !== 'object' || Array.isArray(entry.targetOverrides)) entry.targetOverrides = {};
        Object.keys(entry.targetOverrides).forEach((month) => {
          const amount = Number(entry.targetOverrides[month]);
          if (!isMonthKey(month) || !Number.isFinite(amount) || amount < 0) delete entry.targetOverrides[month];
          else entry.targetOverrides[month] = roundMoney(amount);
        });
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

  function getGroceryTargetOverride(monthKey) {
    const cfg = getBudgetTopUpConfig('groceries');
    if (!isMonthKey(monthKey) || !cfg || !cfg.targetOverrides) return null;
    if (!Object.prototype.hasOwnProperty.call(cfg.targetOverrides, monthKey)) return null;
    const amount = Number(cfg.targetOverrides[monthKey]);
    return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
  }

  function setGroceryTargetOverride(monthKey, amount) {
    const cfg = getBudgetTopUpConfig('groceries');
    if (!isMonthKey(monthKey)) return false;
    if (amount == null) {
      delete cfg.targetOverrides[monthKey];
      return true;
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) return false;
    cfg.targetOverrides[monthKey] = roundMoney(numericAmount);
    return true;
  }

  function getSmokingTargetOverride(monthKey) {
    const cfg = getBudgetTopUpConfig('smoking');
    if (!isMonthKey(monthKey) || monthKey >= PRIVATE_HOUSEHOLD_ONLY_START_MONTH || !cfg || !cfg.targetOverrides) return null;
    if (!Object.prototype.hasOwnProperty.call(cfg.targetOverrides, monthKey)) return null;
    const amount = Number(cfg.targetOverrides[monthKey]);
    return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
  }

  function setSmokingTargetOverride(monthKey, amount) {
    const cfg = getBudgetTopUpConfig('smoking');
    if (!isMonthKey(monthKey) || monthKey >= PRIVATE_HOUSEHOLD_ONLY_START_MONTH) return false;
    if (amount == null) {
      delete cfg.targetOverrides[monthKey];
      return true;
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) return false;
    cfg.targetOverrides[monthKey] = roundMoney(numericAmount);
    return true;
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
    return owner || 'â€”';
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
      // Eure Regel: Alle gemeinsamen Kosten laufen Ã¼ber das Gemeinschaftskonto.
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
      opt.textContent = `${acc.name} Â· ${getAccountTypeLabel(acc.type)}`;
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
    hint.textContent = 'Bei â€žUmbuchungâ€œ wird beim Bezahlt-Markieren keine Ausgabe gebucht, sondern Geld vom Zahlungskonto auf das Zielkonto verschoben.';
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
      if (!post.accountId) { alert('FÃ¼r eine Umbuchung muss ein Zahlungskonto/Von-Konto ausgewÃ¤hlt sein.'); return false; }
      if (!post.transferToAccountId) { alert('FÃ¼r eine Umbuchung muss ein Zielkonto ausgewÃ¤hlt sein.'); return false; }
      if (post.accountId === post.transferToAccountId) { alert('Bei einer Umbuchung mÃ¼ssen Zahlungskonto und Zielkonto unterschiedlich sein.'); return false; }
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
    addPostRows(state.personalCosts, 'PersÃ¶nliche Ausgaben');
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
    addPaidPosts(state.personalCosts, 'PersÃ¶nliche Ausgaben');
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
    meta.textContent = `${getAccountTypeLabel(account.type)} Â· ${getAccountOwnerLabel(account.owner)}`;
    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);
    const status = document.createElement('span');
    status.className = `pill ${data.missing > 0.005 ? 'danger' : 'success'}`;
    status.textContent = data.missing > 0.005 ? `Fehlt ${euro(data.missing)}` : `VerfÃ¼gbar ${euro(data.available)}`;
    top.appendChild(titleWrap);
    top.appendChild(status);
    card.appendChild(top);
    card.appendChild(createSummaryMetrics([
      { label: 'Bankstand', value: euro(data.balance) },
      { label: 'Reserviert/offen', value: euro(reserved), kind: reserved > 0.005 ? 'warning' : 'success', hint: `Gebunden ${euro(data.bound)} Â· offen ${euro(data.open)}` },
      { label: data.missing > 0.005 ? 'Fehlt' : 'VerfÃ¼gbar', value: euro(data.missing > 0.005 ? data.missing : data.available), kind: data.missing > 0.005 ? 'danger' : 'success', hint: 'Nach Reservierungen und offenen Zahlungen.' }
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
      rec.textContent = `Zuletzt abgeglichen: ${when}${account.lastReconciledBalance !== null && account.lastReconciledBalance !== undefined ? ' Â· ' + euro(account.lastReconciledBalance) : ''}`;
      card.appendChild(rec);
    }
    const reserveLines = [];
    if (data.manualBound > 0.005) reserveLines.push({ label: 'Manuell gebunden', amount: data.manualBound });
    if (data.taxRefundBound > 0.005) reserveLines.push({ label: 'Steuererstattung gebunden', amount: data.taxRefundBound });
    if (data.intervalReserveBound > 0.005) reserveLines.push({ label: 'Intervall-RÃ¼cklage', amount: data.intervalReserveBound });
    if (data.savingsGoalBound > 0.005) reserveLines.push({ label: 'RÃ¼cklagen-Posten', amount: data.savingsGoalBound });
    if (data.open > 0.005) reserveLines.push({ label: `Offene Zahlungen (${data.rows.length})`, amount: data.open });
    if (data.paidUnbooked > 0.005) reserveLines.push({ label: 'Nur Status, ohne Historie', amount: data.paidUnbooked });
    if (reserveLines.length) {
      const reserveDetails = document.createElement('details');
      reserveDetails.className = 'compact-details account-quick-details';
      const reserveSummary = document.createElement('summary');
      reserveSummary.textContent = 'Reservierung aufschlÃ¼sseln';
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
      ok.textContent = 'Keine offenen oder gebundenen BetrÃ¤ge auf diesem Konto.';
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
      ok.textContent = 'FÃ¼r diesen Monat sind diesem Konto keine offenen Zahlungen zugeordnet.';
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
          : 'Status gesetzt, keine Historienbuchung gewÃ¼nscht';
        line.innerHTML = `<span><strong>${row.name}</strong><small>${row.group} Â· ${note}</small></span><b>${euro(row.amount)}</b>`;
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
    hint.textContent = 'Pflege hier nur echte BankstÃ¤nde. Offene Zahlungen und gebundene BetrÃ¤ge senken nur die VerfÃ¼gbarkeit, nicht automatisch den Bankstand.';
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
    transferHint.textContent = 'Umbuchungen Ã¤ndern immer beide Konten: beim Quellkonto runter, beim Zielkonto rauf. Hier findest du die gespeicherten Vorlagen und den Verlauf.';
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
        run.textContent = 'AusfÃ¼hren';
        run.disabled = done;
        run.addEventListener('click', () => { if (addAccountTransferFromTemplate(tpl.id, currentMonth)) { saveState(); render(); } });
        const del = document.createElement('button');
        del.className = 'danger small-action';
        del.textContent = 'LÃ¶schen';
        del.addEventListener('click', () => { if (confirm('Umbuchungsvorlage lÃ¶schen?') && deleteAccountTransferTemplate(tpl.id)) { saveState(); render(); } });
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
        del.textContent = 'RÃ¼ckgÃ¤ngig';
        del.addEventListener('click', () => { if (confirm('Umbuchung rÃ¼ckgÃ¤ngig machen?')) { deleteAccountTransfer(trf.id); saveState(); render(); } });
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
      { label: 'Reserviert/offen', value: euro(totals.bound + totals.open), kind: (totals.bound + totals.open) > 0 ? 'warning' : 'success', hint: `Gebunden ${euro(totals.bound)} Â· offen ${euro(totals.open)}` },
      { label: totals.missing > 0.005 ? 'Fehlt gesamt' : 'VerfÃ¼gbar gesamt', value: euro(totals.missing > 0.005 ? totals.missing : totals.available), kind: totals.missing > 0.005 ? 'danger' : 'success', hint: totals.missing > 0.005 ? 'Bei mindestens einem Konto reicht der aktuelle Stand nicht.' : 'Nach gebundenen BetrÃ¤gen und offenen Zahlungen.' }
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
    dailyTitle.textContent = 'Tagesgeld-Soll fÃ¼r nicht-monatliche gemeinsame Kosten';
    dailyBox.appendChild(dailyTitle);
    const dailyHint = document.createElement('p');
    dailyHint.className = 'small muted';
    dailyHint.textContent = 'Zeigt, welcher Betrag rechnerisch auf dem Tagesgeldkonto liegen sollte. Bei jeder nicht-monatlichen Zahlung zÃ¤hlt der aktuelle Anspar-Zyklus bis einschlieÃŸlich FÃ¤lligkeitsmonat; der letzte Anteil wird also im FÃ¤lligkeitsmonat mit dem gemeinsamen Monatsanteil eingeplant.';
    dailyBox.appendChild(dailyHint);
    const accountNames = dailyPlan.accounts.length
      ? dailyPlan.accounts.map((account) => account.name || 'Tagesgeld').join(' Â· ')
      : 'Kein Tagesgeldkonto angelegt';
    dailyBox.appendChild(createSummaryMetrics([
      { label: 'Soll auf Tagesgeld', value: euro(dailyPlan.target), kind: dailyPlan.target > 0.005 ? 'warning' : 'success', hint: accountNames },
      { label: 'Ist auf Tagesgeld', value: dailyPlan.accounts.length ? euro(dailyPlan.actualBalance) : 'â€”', kind: dailyPlan.accounts.length ? 'success' : 'warning' },
      { label: dailyPlan.missing > 0.005 ? 'Fehlt auf Tagesgeld' : 'Ãœber Soll', value: euro(dailyPlan.missing > 0.005 ? dailyPlan.missing : dailyPlan.surplus), kind: dailyPlan.missing > 0.005 ? 'danger' : 'success' },
      { label: 'Aktueller Monatsanteil', value: euro(dailyPlan.currentMonthShare), hint: 'Dieser Anteil steckt im Monatsanteil der gemeinsamen Kosten.' }
    ]));
    if (dailyPlan.target > 0.005 && !dailyPlan.accounts.length) {
      const dailyWarning = createUiEl('div', 'notice warning daily-plan-warning');
      dailyWarning.innerHTML = '<strong>Tagesgeldkonto fehlt.</strong><br><span class="small muted">Lege in den Konten ein Konto mit Typ â€žTagesgeldâ€œ an oder markiere ein vorhandenes Konto so. Dann kann die App den Sollstand direkt mit dem echten Tagesgeld-Kontostand vergleichen.</span>';
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
      dailyTable.innerHTML = '<thead><tr><th>Posten</th><th>FÃ¤lligkeit</th><th>Monatsanteil</th><th>Anteile im Soll</th><th>Soll</th><th>Hinweis</th></tr></thead>';
      const dailyBody = document.createElement('tbody');
      dailyPlan.rows.forEach((rowData) => {
        const tr = document.createElement('tr');
        const hintText = rowData.includesDueMonthShare
          ? 'FÃ¤lligkeitsmonat zÃ¤hlt als letzter Anteil'
          : 'angesparter Anteil bis zum ausgewÃ¤hlten Monat';
        tr.innerHTML = `<td>${rowData.item.name}</td><td>${formatMonthLabel(rowData.nextDue)}</td><td>${euro(rowData.monthlyPart)}</td><td>${rowData.monthsBuilt} von ${rowData.interval}</td><td>${euro(rowData.reserve)}</td><td>${hintText}</td>`;
        dailyBody.appendChild(tr);
      });
      dailyTable.appendChild(dailyBody);
      dailyDetails.appendChild(dailyTable);
      dailyBox.appendChild(dailyDetails);
    } else {
      const emptyDaily = document.createElement('p');
      emptyDaily.className = 'small muted';
      emptyDaily.textContent = 'FÃ¼r den ausgewÃ¤hlten Monat gibt es keine aufzubauenden Anteile fÃ¼r nicht-monatliche gemeinsame Kosten.';
      dailyBox.appendChild(emptyDaily);
    }
    dailyWrap.appendChild(dailyBox);
    card.appendChild(dailyWrap);

    if (hasTransferTools) {
      card.appendChild(transferTools);
    }

    const table = document.createElement('table');
    table.className = 'list-table compact-table';
    table.innerHTML = '<thead><tr><th>Konto</th><th>Typ</th><th>Besitzer</th><th>Kontostand</th><th>Gebunden</th><th>Offen</th><th>VerfÃ¼gbar</th><th>Fehlt</th><th>Aktion</th></tr></thead>';
    const body = document.createElement('tbody');
    accountStats.forEach(({ account, data }) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><strong>${account.name}</strong>${account.purpose ? `<div class="small muted">${account.purpose}</div>` : ''}</td><td>${getAccountTypeLabel(account.type)}</td><td>${getAccountOwnerLabel(account.owner)}</td><td>${euro(data.balance)}</td><td>${euro(data.bound)}</td><td>${euro(data.open)}</td><td class="success-text">${euro(data.available)}</td><td class="${data.missing > 0.005 ? 'danger-text' : 'muted'}">${data.missing > 0.005 ? euro(data.missing) : 'â€”'}</td><td></td>`;
      const actionCell = tr.children[8];
      actionCell.appendChild(createActionMenu([
        { label: 'Bearbeiten', className: 'primary', onClick: () => showAccountEditor(account) },
        { label: 'Buchungen anzeigen', className: 'secondary', onClick: () => showAccountTransactions(account) },
        { label: 'Kontostand abgleichen', className: 'secondary', onClick: () => showAccountReconcileEditor(account) },
        { label: 'Offene Posten anzeigen', className: 'secondary', disabled: data.rows.length === 0, onClick: () => showAccountOpenItems(account, data.rows) },
        { label: 'LÃ¶schen', className: 'danger', disabled: account.id === DEFAULT_SHARED_ACCOUNT_ID, onClick: () => deleteAccount(account.id) }
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
      blank.textContent = 'Vorlage auswÃ¤hlen';
      templateSelect.appendChild(blank);
      state.accountTransferTemplates.forEach((tpl) => {
        const opt = document.createElement('option');
        opt.value = tpl.id;
        opt.textContent = `${tpl.name} Â· ${euro(tpl.amount)}`;
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
      warn.textContent = text || 'WÃ¤hle Konto und Betrag, um die Auswirkung zu sehen.';
    };
    [fromSelect, toSelect, amountInput].forEach((el) => el.addEventListener('input', updateTransferWarning));
    [fromSelect, toSelect].forEach((el) => el.addEventListener('change', updateTransferWarning));
    updateTransferWarning();

    showModal('Umbuchung zwischen Konten', content, [
      { label: 'Abbrechen', className: 'secondary' },
      { label: 'Umbuchen', className: 'primary', onClick: (close) => {
        const amount = parseMoneyInput(amountInput.value);
        if (!(amount > 0)) return alert('Bitte einen Betrag grÃ¶ÃŸer als 0 eintragen.');
        if (!fromSelect.value || !toSelect.value || fromSelect.value === toSelect.value) return alert('Bitte zwei unterschiedliche Konten auswÃ¤hlen.');
        if (templateCheck.checked) {
          addAccountTransferTemplate({
            name: noteInput.value || `${getAccountName(fromSelect.value)} â†’ ${getAccountName(toSelect.value)}`,
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
    showModal(`Offene Posten Â· ${account.name}`, content, [{ label: 'SchlieÃŸen', className: 'secondary' }]);
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

    showModal(isNew ? 'Konto hinzufÃ¼gen' : 'Konto bearbeiten', content, [
      { label: 'Abbrechen', className: 'secondary' },
      { label: 'Speichern', className: 'primary', onClick: (close) => {
        const name = nameInput.value.trim();
        if (!name) { alert('Bitte einen Kontonamen eintragen.'); return; }
        item.name = name;
        item.type = item.id === DEFAULT_SHARED_ACCOUNT_ID ? 'shared' : normalizeAccountType(typeSelect.value);
        item.owner = item.id === DEFAULT_SHARED_ACCOUNT_ID ? 'shared' : normalizeAccountOwner(ownerSelect.value);
        const balance = parseMoneyInput(balanceInput.value);
        const bound = parseMoneyInput(boundInput.value);
        if (!Number.isFinite(balance)) { alert('Bitte einen gÃ¼ltigen aktuellen Kontostand eintragen.'); return; }
        if (!Number.isFinite(bound) || bound < 0) { alert('Bitte einen gÃ¼ltigen gebundenen Betrag eintragen.'); return; }
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
    checkList(state.personalCosts, 'PersÃ¶nliche Ausgaben');
    checkList(state.bufferExpenses, 'Sonstige Ausgaben');
    (state.debts || []).forEach((debt) => { if (debt.accountId === accountId) used.push(`Schuld: ${debt.name || 'Schuld'}`); });
    if (used.length && !confirm(`Dieses Konto ist noch ${used.length} Posten zugeordnet. Konto trotzdem lÃ¶schen und Zuordnungen entfernen?`)) return;
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
    const previousPayment = getCommonAccountContributionPayment(monthKey, personId);
    const plannedAmount = getCurrentContributionAmountForPerson(monthKey, personId);
    const previousPaidAmount = map[personId] === true
      ? roundMoney(Number(previousPayment && previousPayment.amount || plannedAmount))
      : 0;
    const nextPaid = paid === true;
    if (nextPaid) {
      lockCommonAccountContributionPayment(monthKey, personId, options.amount, options);
    } else {
      clearCommonAccountContributionPayment(monthKey, personId);
    }
    const nextPayment = nextPaid ? getCommonAccountContributionPayment(monthKey, personId) : null;
    const nextPaidAmount = roundMoney(Number(nextPayment && nextPayment.amount || 0));
    const reachedFullPayment = nextPaidAmount + 0.005 >= plannedAmount
      && previousPaidAmount + 0.005 < plannedAmount;
    if (reachedFullPayment) markSharedLinkedReservePostsPaid(monthKey);
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
      addChangeLog('RÃ¼cklagen', `${changed} gemeinsame RÃ¼cklage(n) fÃ¼r ${formatMonthLabel(monthKey)} automatisch als zurÃ¼ckgelegt markiert.`, monthKey);
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
      note: options.addToBalance === true ? '' : 'Nachweis: Bankstand bleibt unverÃ¤ndert.'
    };
    const txId = shared
      ? (options.addToBalance === true
        ? applyAccountLedgerTransaction(shared.id, Object.assign({}, txPayload, { affectsBalance: true }))
        : upsertAccountTransaction(shared.id, Object.assign({}, txPayload, { affectsBalance: false, balanceMode: 'proof' })))
      : null;
    item.transactionId = txId || '';
    addChangeLog('Gemeinschaftskonto', `Zinsen fÃ¼r ${formatMonthLabel(month)} eingetragen: ${euro(amount)}.`, month);
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
    // RÃ¼cklage, die auf dem Gemeinschaftskonto bleiben sollte, weil ihr monatlich
    // Anteile einzahlt, wÃ¤hrend einige gemeinsame Kosten nur quartalsweise,
    // halbjÃ¤hrlich oder jÃ¤hrlich abgebucht werden.
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
          // Tagesgeld-Soll: Der aktuelle Anspar-Zyklus zÃ¤hlt bis einschlieÃŸlich
          // FÃ¤lligkeitsmonat, damit der letzte Anteil im FÃ¤lligkeitsmonat dabei ist.
          reserve = amount;
          monthsBuilt = interval;
        } else {
          // Gemeinschaftskonto-VerfÃ¼gbarkeit: offene Abbuchungen werden separat
          // gezÃ¤hlt und dÃ¼rfen dort nicht zusÃ¤tzlich als RÃ¼cklage auftauchen.
          reserve = 0;
          monthsBuilt = 0;
        }
      } else {
        // Der Anspar-Zyklus beginnt nach der letzten FÃ¤lligkeit und endet mit
        // der nÃ¤chsten FÃ¤lligkeit. Vor dem Zyklus bleibt der Sollbetrag bei 0.
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

  function ensureBennyHuk24AdditionalPensionFromOctober2026() {
    if (!state || !state.appMeta || !Array.isArray(state.persons) || !Array.isArray(state.personalCosts)) return false;
    if (state.appMeta.bennyHuk24AdditionalPensionV283Done === true) return false;

    const benny = state.persons.find((person) => {
      const idKey = normalizeTextKey(person && person.id).replace(/[^a-z0-9]/g, '');
      const nameKey = normalizeTextKey(person && person.name).replace(/[^a-z0-9]/g, '');
      return idKey === 'benny' || nameKey === 'benny';
    });
    if (!benny) return false;

    const existing = state.personalCosts.find((post) => {
      if (!post || post.personId !== benny.id) return false;
      const nameKey = normalizeTextKey(post.name).replace(/[^a-z0-9]/g, '');
      return nameKey.includes('zusatzrente') && nameKey.includes('huk24');
    });

    let created = false;
    if (!existing) {
      const post = {
        id: 'benny_huk24_zusatzrente_2026_10',
        personId: benny.id,
        name: 'Zusatzrente HUK24',
        amount: 25,
        interval: 1,
        startMonth: '2026-10',
        endMonth: '',
        oneTime: false,
        paidMonths: [],
        accountBalanceDebits: {},
        amountTimeline: [],
        amountOverrides: {},
        linkedDebtId: '',
        linkedSavingsGoalId: '',
        accountId: '',
        paidWithIncome: false,
        incomePaidMonths: []
      };
      ensurePostConfig(post);
      state.personalCosts.push(post);
      addChangeLog('PersÃ¶nliche Ausgaben', 'Benny: Zusatzrente HUK24 mit 25,00 â‚¬ monatlich ab Oktober 2026 angelegt.', '2026-10');
      created = true;
    }

    state.appMeta.bennyHuk24AdditionalPensionV283Done = true;
    return created;
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
              note: 'Aus altem Speicherstand Ã¼bernommen; der Bankstand war bereits angepasst.',
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
   * Berechnet den automatischen RÃ¼cklagenbeitrag fÃ¼r einen bestimmten
   * Topf in einem gegebenen Monat. Vor dem Start der Verteilung
   * (savingsConfig.startMonth) wird 0 zurÃ¼ckgegeben. Die Berechnung
   * basiert auf dem freien Betrag, der Verteilung auf RÃ¼cklagen
   * (reservesRatio) und dem Anteil des jeweiligen Topfs.
   *
   * @param {string} potName Name des RÃ¼cklagen-Topfs
   * @param {string} monthKey Monat im Format JJJJ-MM
   * @returns {number} Automatischer Beitrag fÃ¼r den Topf in diesem Monat
   */
  function getReserveContributionForPot(potName, monthKey) {
    // PrÃ¼fen, ob der Monat vor dem Start der Verteilung liegt. monthDiff(a,b) gibt die Differenz b - a.
    // Ist monthKey < savingsConfig.startMonth, also monthDiff(monthKey, startMonth) negativ, wird 0 zurÃ¼ckgegeben.
    if (monthDiff(savingsConfig.startMonth, monthKey) < 0) {
      return 0;
    }
    const verteilbar = getDistributableAmountFromFree(computeFreeSumForMonth(monthKey));
    const ruecklagen = verteilbar * savingsConfig.reservesRatio;
    const share = savingsConfig.reservePotShares[potName] || 0;
    return roundMoney(ruecklagen * share);
  }

  /**
   * Berechnet den automatischen Sparbetrag (30Â % des verteilbaren
   * Betrags) fÃ¼r einen gegebenen Monat. Vor dem Start der Verteilung
   * wird 0 zurÃ¼ckgegeben.
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
      map[month] = { planned: 0, base: 0, snowballExtra: 0, dynamicExtra: 0, dayMoneyTransfer: 0, creditorPayments: 0, notes: [] };
    });

    const snowball = buildSnowballPlan(startMonth, horizon, { incomeResolver: options.incomeResolver });
    (snowball.rows || []).forEach((row) => {
      if (!map[row.month]) return;
      const fixedPool = Number(row.monthlyTarget || 0) > 0
        ? Number(row.pool || row.monthlyTarget || 0)
        : Number(row.total || 0);
      const dayMoneyTransfer = Number(row.debtSavingsDeposit != null
        ? row.debtSavingsDeposit
        : (Number(row.unallocatedBudget || 0)
          + (row.payoffReserve && !row.payoffReserve.canPayoff ? Number(row.payoffReserve.reserveAdded || 0) : 0)));
      map[row.month].planned += fixedPool;
      map[row.month].base += Number(row.base || 0);
      map[row.month].snowballExtra += Number(row.extra || 0);
      map[row.month].dynamicExtra = (Number(map[row.month].dynamicExtra || 0) + Number(row.dynamicExtra || 0));
      map[row.month].dayMoneyTransfer += dayMoneyTransfer;
      map[row.month].creditorPayments += Math.max(0, fixedPool - dayMoneyTransfer);
      if (row.notes) map[row.month].notes.push(row.notes);
    });

    // Einmalzahlungen und offene PlÃ¤ne gehÃ¶ren nicht in den Schneeball, sollen in der Vorschau
    // aber trotzdem nicht endlos als Fixkosten weiterlaufen. Sie werden im FÃ¤lligkeitsmonat einmalig berÃ¼cksichtigt.
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
    const projected = projectionMap && projectionMap[monthKey] ? projectionMap[monthKey] : { planned: 0, base: 0, snowballExtra: 0, dynamicExtra: 0, dayMoneyTransfer: 0, creditorPayments: 0, notes: [] };
    const debtPlanned = Number(projected.planned || 0);
    const debtAlreadyReserved = Number(details.debtBudgetReserved != null ? details.debtBudgetReserved : linkedDebtCosts);
    const debtAdjustment = debtAlreadyReserved - debtPlanned;
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
      debtDayMoneyTransfer: Number(projected.dayMoneyTransfer || 0),
      debtCreditorPayments: Number(projected.creditorPayments || 0),
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

  function getIncomeLinkedDebtExtraForMonth(monthKey, incomeResolver = null) {
    if (!isMonthKey(monthKey) || monthKey < snowballConfig.incomeLinkedExtraStartMonth) return 0;
    const targetName = String(snowballConfig.incomeLinkedExtraPersonName || 'Benny').trim().toLowerCase();
    const person = (state.persons || []).find((entry) => {
      const name = String(entry && entry.name || '').trim().toLowerCase();
      const id = String(entry && entry.id || '').trim().toLowerCase();
      return name === targetName || id === targetName || name.includes(targetName);
    });
    if (!person) return 0;
    // getPersonNet is the entered planning amount; for Benny it includes
    // the direct Kreiskasse deduction, as requested.
    const income = typeof incomeResolver === 'function'
      ? incomeResolver(person, monthKey)
      : getPersonNet(person, monthKey);
    return roundMoney(Math.max(0, Number(income || 0) - Number(snowballConfig.incomeLinkedExtraThreshold || 0)));
  }

  function getMonthlyDebtBudgetForMonth(monthKey, incomeResolver = null) {
    if (!isMonthKey(monthKey) || monthKey < snowballConfig.monthlyTargetStartMonth) return 0;
    return roundMoney(Math.max(0, Number(snowballConfig.monthlyTarget || 0)
      + getIncomeLinkedDebtExtraForMonth(monthKey, incomeResolver)));
  }

  function getDebtBudgetReservationForMonth(monthKey, options = {}) {
    const linkedDebtCosts = roundMoney(Math.max(0, getLinkedDebtCostTotalForMonth(monthKey)));
    const hasDebtActivity = (state.debts || []).some((debt) => Number(debt && debt.amountOpen || 0) > 0.005
      || getDebtCompletedMonth(debt) === monthKey
      || getDebtCoveredAmountForMonth(debt, monthKey) > 0.005);
    const monthlyTarget = hasDebtActivity ? getMonthlyDebtBudgetForMonth(monthKey, options.incomeResolver) : 0;
    // Vor dem Start des festen 800-Euro-Pools bleibt die bisherige Haushaltsrechnung
    // unverÃ¤ndert. Ab September zÃ¤hlen bereits in den Kosten enthaltene Raten in die
    // 800 Euro hinein; nur die Differenz wird zusÃ¤tzlich vom Monatsrest gebunden.
    const requiredDebtPayments = monthlyTarget > 0
      ? roundMoney(Math.max(0, Number(getDebtPlanForMonth(monthKey).planned || 0)))
      : 0;
    const reservedTotal = monthlyTarget > 0
      ? roundMoney(Math.max(monthlyTarget, linkedDebtCosts, requiredDebtPayments))
      : linkedDebtCosts;
    return {
      monthlyTarget,
      linkedDebtCosts,
      requiredDebtPayments,
      reservedTotal,
      additionalReservation: roundMoney(Math.max(0, reservedTotal - linkedDebtCosts))
    };
  }

  function getFixedDebtBudgetCandidates(debts, options = {}) {
    const skipDebtId = options.skipDebtId || '';
    return (debts || [])
      .filter((debt) => debt && debt.id !== skipDebtId && Number(debt.open || 0) > 0)
      .filter((debt) => debt.paymentType !== 'one_time')
      .filter((debt) => isDebtExtraPaymentAllowed(debt) && isDebtAllowedAsSnowballTarget(debt))
      .sort((a, b) => Number(a.open || 0) - Number(b.open || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'de'));
  }

  function getHoistDebtBudgetCandidate(debts) {
    return (debts || []).find((debt) => {
      const key = normalizeTextKey(debt && debt.name || '');
      return key.includes('hoist') || key.includes('targobank');
    }) || null;
  }

  function findFullPayoffCandidateBeforeSplit(debts, availableBudget, options = {}) {
    const budget = roundMoney(Math.max(0, Number(availableBudget || 0)));
    if (!(budget > 0)) return null;
    const reserveDebtId = options.reserveDebtId || '';
    const reserveAmount = roundMoney(Math.max(0, Number(options.reserveAmount || 0)));
    return getFixedDebtBudgetCandidates(debts).find((debt) => {
      const usableReserve = debt.id === reserveDebtId ? reserveAmount : 0;
      return Number(debt.open || 0) <= budget + usableReserve + 0.005;
    }) || null;
  }

  function chooseSnowballTarget(active, month, extraBudget = 0, options = {}) {
    const allowFullPayoff = options.allowFullPayoff === true;
    const candidates = active
      .filter((debt) => debt.open > 0 && monthDiff(debt.nextDueMonth, month) >= 0 && isDebtAllowedAsSnowballTarget(debt))
      .filter((debt) => !isDebtFullPayoffOnly(debt))
      .sort((a, b) => a.open - b.open || a.name.localeCompare(b.name));
    if (!candidates.length) return null;

    // Dynamischer Zusatzbetrag darf nur eingesetzt werden, wenn damit eine Schuld
    // komplett geschlossen werden kann. Normale Schneeball-Umlegungen laufen weiter separat.
    if (allowFullPayoff && extraBudget > 0) {
      const closable = candidates.find((debt) => debt.open <= extraBudget + 0.005);
      if (closable) return closable;
      if (options.fullPayoffOnly) return null;
    }

    // FÃ¼r die Weitergabe einer ausgelaufenen Standardrate zÃ¤hlt immer die kleinste
    // passende offene Ratenschuld. Eine kurze Restlaufzeit darf den Vorschlag nicht
    // unterdrÃ¼cken oder hinter eine grÃ¶ÃŸere Schuld verschieben.
    if (options.fallbackToShortTerm) return candidates[0];
    const longRunning = candidates.filter((debt) => !isShortTermSnowballTarget(debt, month, snowballConfig.shortTermSkipMonths));
    if (longRunning.length) return longRunning[0];
    return null;
  }

  function getDebtFreedStandardRate(debt, completedMonth) {
    if (!debt || debt.paymentType !== 'installment' || !isMonthKey(completedMonth)) return 0;
    // Eine kleinere Schlussrate darf den festen Schulden-Pool nicht verkleinern.
    // Deshalb bleibt mindestens die vereinbarte Monatsrate erhalten.
    return roundMoney(Math.max(
      0,
      Number(debt.monthlyRate || 0),
      Number(getDebtRateForMonth(debt, completedMonth) || 0)
    ));
  }

  function getAutomaticFullPayoffPlan() {
    // Benny does not build a savings reserve from the freed Pair AZ1 payment.
    // Keep the amount in the regular monthly debt pool so the snowball plan can
    // allocate it to an eligible creditor instead of displaying a Tagesgeld deposit.
    return null;
  }

  function getConfirmedDedicatedDebtReserveBeforeMonth(plan, monthKey) {
    if (!plan || !isMonthKey(plan.firstReserveMonth) || !isMonthKey(monthKey)) return 0;
    const firstMonth = plan.firstReserveMonth < snowballConfig.monthlyTargetStartMonth
      ? snowballConfig.monthlyTargetStartMonth
      : plan.firstReserveMonth;
    let month = firstMonth;
    let confirmed = 0;
    for (let index = 0; index < 120 && month < monthKey; index += 1) {
      const actionKey = getDebtAssistantActionKey(month, plan.targetDebtId, 'reserve', plan.monthlyAmount);
      if (getDebtAssistantActionStatus(actionKey) === 'done') {
        confirmed += Number(plan.monthlyAmount || 0);
      }
      month = nextMonth(month);
    }
    return roundMoney(Math.max(0, confirmed));
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
        rateTimeline: Array.isArray(debt.rateTimeline) ? debt.rateTimeline.map((entry) => ({
          month: entry.month,
          amount: Number(entry.amount || 0),
          pending: entry.pending === true
        })) : [],
        nextDueMonth: isMonthKey(debt.nextDueMonth) ? debt.nextDueMonth : startMonth,
        snowballEligible: isInstallmentDebtForSnowball(debt, startMonth),
        paymentType: debt.paymentType,
        scheduledMonth: isMonthKey(debt.nextDueMonth) ? debt.nextDueMonth : '',
        creditorRule: debt.creditorRule && typeof debt.creditorRule === 'object' ? { ...debt.creditorRule } : null,
        excludeReason: getSnowballExcludeReason(debt, startMonth)
      };
    }).filter((debt) => debt.open > 0);
    // Nicht eingeplante Schulden sind nur echte offene PlÃ¤ne/fehlende Raten.
    // Fest terminierte Einmalzahlungen (z. B. Telekom/Riverty AZ2 im Juni)
    // werden als geplante Einmalzahlung behandelt und dÃ¼rfen die Schuldenfrei-Prognose
    // der Ratenschulden nicht blockieren.
    const noRate = sourceDebts.filter((debt) => debt.excludeReason
      && debt.paymentType !== 'one_time'
      && !getFixedDebtBudgetCandidates([debt]).length);
    const scheduledOneTime = sourceDebts.filter((debt) => debt.paymentType === 'one_time' && debt.open > 0 && isMonthKey(debt.scheduledMonth));
    const active = sourceDebts.filter((debt) => debt.snowballEligible);
    const planDebts = sourceDebts.filter((debt) => debt.paymentType !== 'one_time');
    const rows = [];
    const events = [];
    const automaticPayoffPlan = getAutomaticFullPayoffPlan();
    const payoffPlanActiveAtStart = automaticPayoffPlan
      && monthDiff(automaticPayoffPlan.firstReserveMonth, startMonth) >= 0;
    const dedicatedMonthlyAtStart = payoffPlanActiveAtStart ? Number(automaticPayoffPlan.monthlyAmount || 0) : 0;
    // FrÃ¼here Planmonate werden nicht mehr automatisch als wirklich angespart
    // behandelt. Ab dem Neustart im September zÃ¤hlt nur, was im jeweiligen
    // Monatsassistenten ausdrÃ¼cklich als â€žZurÃ¼ckgelegtâ€œ bestÃ¤tigt wurde.
    let dedicatedReserve = payoffPlanActiveAtStart
      ? getConfirmedDedicatedDebtReserveBeforeMonth(automaticPayoffPlan, startMonth)
      : 0;
    // Allgemeine Tagesgeld-RÃ¼cklage innerhalb des Schulden-Pools. Sie entsteht,
    // wenn ein Teil der 800 Euro wegen Zahlungsregeln noch nicht sinnvoll an
    // einen GlÃ¤ubiger geschickt werden kann, und bleibt in Folgemonaten fÃ¼r
    // eine spÃ¤tere GesamtablÃ¶sung gebunden.
    let debtSavingsReserve = getRecordedDebtSavingsReserveBeforeMonth(startMonth);
    let dedicatedFinished = false;
    const rolloverStart = roundMoney(Math.max(0, getHistoricalDebtRollover(startMonth) - dedicatedMonthlyAtStart));
    let rollover = rolloverStart;
    let month = startMonth;
    let debtFreeMonth = '';

    for (let i = 0; i < maxMonths && planDebts.some((debt) => debt.open > 0); i += 1) {
      let base = 0;
      let extra = 0;
      let budgetExtra = 0;
      let newlyFreed = 0;
      const notes = [];
      const payments = [];
      let payoffReserve = null;
      const debtSavingsReserveBefore = roundMoney(debtSavingsReserve + dedicatedReserve);
      let debtSavingsWithdrawal = 0;
      let generalDebtSavingsWithdrawal = 0;
      let generalDebtSavingsWithdrawalDebtId = '';
      const incomeLinkedExtra = getIncomeLinkedDebtExtraForMonth(month, options.incomeResolver);
      const monthlyTarget = getMonthlyDebtBudgetForMonth(month, options.incomeResolver);
      const alreadyPaid = i === 0 ? roundMoney(getDebtPaidAmountForMonth(month)) : 0;
      active.forEach((debt) => { debt.rate = getDebtRateForMonth(debt, month); });
      // Pflicht-/Normalraten mÃ¼ssen auch fÃ¼r feste RatenplÃ¤ne gezahlt werden.
      // isDebtAllowedAsSnowballTarget() darf hier NICHT filtern, sonst wÃ¼rden z. B.
      // Kreiskasse-PlÃ¤ne ohne Extra-Zahlung nie auslaufen und die Prognose bliebe
      // fÃ¤lschlich bei â€žnoch nicht berechenbarâ€œ hÃ¤ngen. Die Sperre gilt nur fÃ¼r
      // Schneeball-/Extra-Ziele in chooseSnowballTarget().
      const dueDebts = active
        .filter((debt) => debt.open > 0 && monthDiff(debt.nextDueMonth, month) >= 0)
        .sort((a, b) => a.open - b.open || a.name.localeCompare(b.name));
      let dedicatedContribution = automaticPayoffPlan
        && !dedicatedFinished
        && monthDiff(automaticPayoffPlan.firstReserveMonth, month) >= 0
        && active.some((debt) => debt.id === automaticPayoffPlan.targetDebtId && debt.open > 0)
        ? Number(automaticPayoffPlan.monthlyAmount || 0)
        : 0;
      // Der gesamte Schulden-Pool bleibt erhalten: laufende Standardraten plus bereits
      // in frÃ¼heren Monaten frei gewordene Standardraten. Eine kleinere Schlussrate
      // reduziert diesen reservierten Monatsbetrag nicht.
      const legacyDebtPool = roundMoney(
        rollover
        + dedicatedContribution
        + dueDebts.reduce((sum, debt) => sum + Math.max(0, Number(debt.rate || 0)), 0)
        + (i === 0 ? getDebtStandardRatesCompletedInMonth(month) : 0)
      );
      const debtPool = monthlyTarget > 0 ? monthlyTarget : legacyDebtPool;

      dueDebts.forEach((debt) => {
        const pay = Math.min(debt.open, debt.rate);
        debt.open = Math.max(0, debt.open - pay);
        base += pay;
        if (pay > 0) {
          notes.push(`${debt.name}: ${euro(pay)}`);
          payments.push({ type: 'rate', debt: debt.name, amount: pay, originalRate: debt.rate, remainingAfter: Math.max(0, debt.open), completed: debt.open <= 0.005, note: debt.open <= 0.005 ? 'Schlussrate / lÃ¤uft aus' : 'normale Rate' });
        }
        if (debt.open <= 0.005) {
          debt.open = 0;
          newlyFreed += debt.rate;
        }
      });

      // Vor jeder Aufteilung des Zusatzbudgets wird zuerst geprÃ¼ft, ob der
      // gesamte noch verfÃ¼gbare Betrag eine geeignete Schuld komplett schlieÃŸen
      // kann. In diesem Fall hat die KomplettablÃ¶sung Vorrang vor einer neuen
      // RÃ¼cklage oder einer nur teilweisen RatenerhÃ¶hung.
      const fullPayoffBudgetBeforeSplit = monthlyTarget > 0
        ? roundMoney(Math.max(0, monthlyTarget - alreadyPaid - base))
        : 0;
      const fullPayoffCandidateBeforeSplit = monthlyTarget > 0
        ? findFullPayoffCandidateBeforeSplit(planDebts, fullPayoffBudgetBeforeSplit + debtSavingsReserve, {
          reserveDebtId: automaticPayoffPlan ? automaticPayoffPlan.targetDebtId : '',
          reserveAmount: dedicatedReserve
        })
        : null;
      // Das gesamte Zusatzbudget bleibt zusammen, wenn damit bereits eine Schuld
      // vollstÃ¤ndig erledigt werden kann. Es wird kein zusÃ¤tzlicher Betrag fÃ¼r
      // eine RÃ¼cklage reserviert.
      if (fullPayoffCandidateBeforeSplit) dedicatedContribution = 0;
      if (dedicatedContribution > 0 && automaticPayoffPlan) {
        const target = active.find((debt) => debt.id === automaticPayoffPlan.targetDebtId);
        if (target && target.open > 0) {
          const reserveBefore = dedicatedReserve;
          dedicatedReserve = roundMoney(dedicatedReserve + dedicatedContribution);
          // Der Monatsbetrag wird im Haushaltsbudget gebunden, auch wenn der
          // Zahlungsplan noch keine Teil-Sonderzahlung annimmt.
          extra += dedicatedContribution;
          const basePaymentIndex = payments.findIndex((payment) => payment.type === 'rate' && payment.debt === target.name);
          const basePayment = basePaymentIndex >= 0 ? Number(payments[basePaymentIndex].amount || 0) : 0;
          const portalPayoffAmount = roundMoney(target.open + basePayment);
          const canPayoff = dedicatedReserve + 0.005 >= target.open;

          payoffReserve = {
            sourceDebt: automaticPayoffPlan.sourceDebt,
            targetDebt: target.name,
            reserveBefore,
            reserveAdded: dedicatedContribution,
            reserveBalance: dedicatedReserve,
            currentOpenAfterRate: target.open,
            portalPayoffAmount,
            canPayoff,
            leftoverAfterPayoff: 0
          };

          if (canPayoff) {
            const reserveSpent = target.open;
            debtSavingsWithdrawal = roundMoney(debtSavingsWithdrawal + Math.min(reserveBefore, reserveSpent));
            dedicatedReserve = roundMoney(Math.max(0, dedicatedReserve - reserveSpent));
            target.open = 0;
            newlyFreed += Number(target.rate || 0) + dedicatedContribution;
            dedicatedFinished = true;
            payoffReserve.reserveBalance = dedicatedReserve;
            payoffReserve.leftoverAfterPayoff = dedicatedReserve;
            if (dedicatedReserve > 0.005) {
              debtSavingsReserve = roundMoney(debtSavingsReserve + dedicatedReserve);
              dedicatedReserve = 0;
              payoffReserve.reserveBalance = debtSavingsReserve;
              payoffReserve.leftoverAfterPayoff = debtSavingsReserve;
            }
            if (basePaymentIndex >= 0) payments.splice(basePaymentIndex, 1);
            payments.push({
              type: 'full_payoff',
              debt: target.name,
              amount: portalPayoffAmount,
              budgetAmount: roundMoney(basePayment + dedicatedContribution),
              rateAmount: basePayment,
              snowballAmount: dedicatedContribution,
              originalRate: target.rate,
              remainingAfter: 0,
              completed: true,
              note: `Gesamtforderung bezahlen Â· ${euro(reserveBefore)} aus Vormonat zurÃ¼ckgelegt`
            });
            const oldNoteIndex = notes.findIndex((note) => note.startsWith(`${target.name}:`));
            if (oldNoteIndex >= 0) notes.splice(oldNoteIndex, 1);
            notes.push(`${target.name}: Gesamtforderung ${euro(portalPayoffAmount)} bezahlen`);
          } else {
            notes.push(`${euro(dedicatedContribution)} fÃ¼r die GesamtablÃ¶sung von ${target.name} zurÃ¼cklegen`);
          }
        }
      }

      if (rollover > 0 && monthlyTarget <= 0) {
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

      // Ab Oktober 2026 gilt der feste Grundpool von 800 Euro. Ab Januar 2027
      // erhÃ¶ht Bennys Einkommen Ã¼ber 2.300 Euro nur das getrennte Zusatzbudget.
      // Bereits gezahlte BetrÃ¤ge und
      // Pflicht-/Normalraten zÃ¤hlen zuerst. Mit der noch fehlenden Summe wird
      // zuerst eine mÃ¶gliche KomplettablÃ¶sung gesucht; nur der danach Ã¼brige
      // Betrag wird als freiwillige Zusatztilgung verteilt. Die HÃ¶he hÃ¤ngt
      // ausdrÃ¼cklich nicht vom freien Haushaltsbetrag ab.
      let unallocatedBudget = 0;
      if (monthlyTarget > 0) {
        let availableBudget = roundMoney(Math.max(0, monthlyTarget - alreadyPaid - base - extra));
        while (availableBudget > 0.005) {
          const candidates = getFixedDebtBudgetCandidates(planDebts);
          if (!candidates.length) break;
          // Nach jeder vollstÃ¤ndigen AblÃ¶sung erneut prÃ¼fen. So kÃ¶nnen auch
          // mehrere kleine Restschulden im selben Monat nacheinander erledigt
          // werden, bevor eine RÃ¼cklage oder Teil-Sonderzahlung entsteht.
          const fullPayoffCandidate = findFullPayoffCandidateBeforeSplit(
            planDebts,
            availableBudget + debtSavingsReserve,
            {
              reserveDebtId: automaticPayoffPlan ? automaticPayoffPlan.targetDebtId : '',
              reserveAmount: dedicatedReserve
            }
          );
          let target = fullPayoffCandidate || getHoistDebtBudgetCandidate(candidates); if (!target) break;

          const isAutomaticReserveTarget = !!(automaticPayoffPlan && target.id === automaticPayoffPlan.targetDebtId);
          const targetDedicatedReserve = isAutomaticReserveTarget
            ? Math.max(0, Number(dedicatedReserve || 0))
            : 0;
          const targetCanBeClosedWithReserve = Number(target.open || 0) <= availableBudget + debtSavingsReserve + targetDedicatedReserve + 0.005;
          if (isDebtFullPayoffOnly(target) || targetCanBeClosedWithReserve) {
            const dedicatedForTarget = isAutomaticReserveTarget
              ? Math.max(0, Number(dedicatedReserve || 0))
              : 0;
            const reserveForTarget = roundMoney(dedicatedForTarget + debtSavingsReserve);
            const neededFromBudget = roundMoney(Math.max(0, Number(target.open || 0) - reserveForTarget));

            // Reicht das aktuelle Monatsbudget noch nicht fÃ¼r die vollstÃ¤ndige
            // Forderung, wird zunÃ¤chst eine flexible Schuld vorgeschlagen. Die
            // Eine bereits vorgemerkte RÃ¼cklage fÃ¼r den Gesamtausgleich bleibt
            // trotzdem erhalten.
            if (neededFromBudget > availableBudget + 0.005) {
              const flexibleTarget = getHoistDebtBudgetCandidate(candidates);
              if (!flexibleTarget) break;
              target = flexibleTarget;
            } else {
              const basePaymentIndex = payments.findIndex((payment) => payment.type === 'rate' && payment.debt === target.name);
              const basePayment = basePaymentIndex >= 0 ? Number(payments[basePaymentIndex].amount || 0) : 0;
              const payoffAfterRate = Math.max(0, Number(target.open || 0));
              const portalPayoffAmount = roundMoney(payoffAfterRate + basePayment);
              const reserveBefore = isAutomaticReserveTarget && payoffReserve && payoffReserve.targetDebt === target.name
                ? Number(payoffReserve.reserveBefore || 0) + debtSavingsReserve
                : debtSavingsReserve;
              const reserveAddedBeforeBudget = isAutomaticReserveTarget && payoffReserve && payoffReserve.targetDebt === target.name
                ? Number(payoffReserve.reserveAdded || 0)
                : 0;
              const amountFromBudget = roundMoney(Math.min(availableBudget, neededFromBudget));
              let reserveStillNeeded = roundMoney(Math.max(0, payoffAfterRate - amountFromBudget));
              const dedicatedUsed = roundMoney(Math.min(dedicatedForTarget, reserveStillNeeded));
              reserveStillNeeded = roundMoney(Math.max(0, reserveStillNeeded - dedicatedUsed));
              const generalReserveUsed = roundMoney(Math.min(debtSavingsReserve, reserveStillNeeded));
              const priorDedicatedUsed = roundMoney(Math.min(
                isAutomaticReserveTarget && payoffReserve && payoffReserve.targetDebt === target.name ? Number(payoffReserve.reserveBefore || 0) : 0,
                dedicatedUsed
              ));
              debtSavingsWithdrawal = roundMoney(debtSavingsWithdrawal + priorDedicatedUsed + generalReserveUsed);
              generalDebtSavingsWithdrawal = roundMoney(generalDebtSavingsWithdrawal + generalReserveUsed);
              if (generalReserveUsed > 0) generalDebtSavingsWithdrawalDebtId = target.id;
              dedicatedReserve = roundMoney(Math.max(0, dedicatedReserve - dedicatedUsed));
              debtSavingsReserve = roundMoney(Math.max(0, debtSavingsReserve - generalReserveUsed));

              extra = roundMoney(extra + amountFromBudget);
              budgetExtra = roundMoney(budgetExtra + amountFromBudget);
              availableBudget = roundMoney(Math.max(0, availableBudget - amountFromBudget));
              target.open = 0;
              newlyFreed += Number(target.rate || 0);
              if (automaticPayoffPlan && target.id === automaticPayoffPlan.targetDebtId) {
                dedicatedFinished = true;
                if (dedicatedReserve > 0.005) {
                  debtSavingsReserve = roundMoney(debtSavingsReserve + dedicatedReserve);
                  dedicatedReserve = 0;
                }
              }
              if (basePaymentIndex >= 0) payments.splice(basePaymentIndex, 1);
              payments.push({
                type: 'full_payoff',
                debt: target.name,
                amount: portalPayoffAmount,
                budgetAmount: roundMoney(basePayment + reserveAddedBeforeBudget + amountFromBudget),
                rateAmount: basePayment,
                snowballAmount: roundMoney(reserveAddedBeforeBudget + amountFromBudget),
                originalRate: target.rate,
                remainingAfter: 0,
                completed: true,
                note: 'Vorschlag: Gesamtforderung vollstÃ¤ndig bezahlen'
              });
              const completedPayoffReserve = {
                sourceDebt: payoffReserve && payoffReserve.sourceDebt ? payoffReserve.sourceDebt : 'festes Schuldenbudget',
                targetDebt: target.name,
                reserveBefore,
                reserveAdded: roundMoney(reserveAddedBeforeBudget + amountFromBudget),
                reserveBalance: roundMoney(debtSavingsReserve + dedicatedReserve),
                currentOpenAfterRate: payoffAfterRate,
                portalPayoffAmount,
                canPayoff: true,
                leftoverAfterPayoff: roundMoney(debtSavingsReserve + dedicatedReserve)
              };
              if (isAutomaticReserveTarget || !payoffReserve || payoffReserve.canPayoff) payoffReserve = completedPayoffReserve;
              const oldNoteIndex = notes.findIndex((note) => note.startsWith(`${target.name}:`));
              if (oldNoteIndex >= 0) notes.splice(oldNoteIndex, 1);
              notes.push(`${target.name}: Gesamtforderung ${euro(portalPayoffAmount)} vollstÃ¤ndig bezahlen`);
              continue;
            }
          }

          const pay = roundMoney(Math.min(Number(target.open || 0), availableBudget));
          if (!(pay > 0)) break;
          target.open = roundMoney(Math.max(0, Number(target.open || 0) - pay));
          extra = roundMoney(extra + pay);
          budgetExtra = roundMoney(budgetExtra + pay);
          availableBudget = roundMoney(Math.max(0, availableBudget - pay));
          payments.push({
            type: 'budget_extra',
            debt: target.name,
            amount: pay,
            originalRate: Number(target.rate || 0),
            remainingAfter: Math.max(0, Number(target.open || 0)),
            completed: Number(target.open || 0) <= 0.005,
            note: Number(target.open || 0) <= 0.005
              ? 'mit dem Schuldenbudget erledigt'
              : 'Vorschlag aus dem Schuldenbudget'
          });
          notes.push(`${target.name} +${euro(pay)} aus dem Schuldenbudget`);
          if (Number(target.open || 0) <= 0.005) {
            target.open = 0;
            newlyFreed += Number(target.rate || 0);
          }
        }
        unallocatedBudget = roundMoney(Math.max(0, availableBudget));
        if (unallocatedBudget > 0.005) {
          debtSavingsReserve = roundMoney(debtSavingsReserve + unallocatedBudget);
          notes.push(`${euro(unallocatedBudget)} gehen als gebundene Schulden-RÃ¼cklage aufs Tagesgeld.`);
        }
      }

      const dedicatedDeposit = payoffReserve && !payoffReserve.canPayoff
        ? Number(payoffReserve.reserveAdded || 0)
        : 0;
      const debtSavingsDeposit = roundMoney(dedicatedDeposit + unallocatedBudget);
      const debtSavingsReserveBalance = roundMoney(debtSavingsReserve + dedicatedReserve);

      const remaining = planDebts.reduce((sum, debt) => sum + Math.max(0, debt.open), 0);
      const nextTarget = monthlyTarget > 0
        ? (getFixedDebtBudgetCandidates(planDebts)[0] || null)
        : chooseSnowballTarget(active, nextMonth(month), rollover + newlyFreed, { allowFullPayoff: false, fallbackToShortTerm: true });
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
          text: `${entry.sourceDebt} ausgelaufen â€“ ${euro(entry.amount)} gehen ab ${formatMonthLabel(entry.transferMonth)} auf ${entry.targetDebt || 'keine weitere Schuld'}.`
        });
      });
      rows.push({
        month,
        base: roundMoney(base),
        extra: roundMoney(extra),
        budgetExtra: roundMoney(budgetExtra),
        dynamicExtra: incomeLinkedExtra,
        incomeLinkedExtra,
        fixedMonthlyTarget: monthlyTarget > 0 ? roundMoney(Math.max(0, monthlyTarget - incomeLinkedExtra)) : 0,
        alreadyPaid,
        plannedOpen: roundMoney(base + extra),
        total: roundMoney(alreadyPaid + base + extra),
        pool: roundMoney(Math.max(debtPool, alreadyPaid + base + extra)),
        monthlyTarget,
        unallocatedBudget,
        debtSavingsReserveBefore,
        debtSavingsDeposit,
        debtSavingsWithdrawal,
        generalDebtSavingsWithdrawal,
        generalDebtSavingsWithdrawalDebtId,
        debtSavingsReserveBalance,
        rolloverNext,
        remaining,
        targetNext: nextTarget ? nextTarget.name : '',
        freedTransfers: freedThisMonth,
        payments: payments.slice(),
        payoffReserve,
        notes: notes.slice(0, 8).join(' Â· ')
      });
      if (remaining <= 0.005) {
        debtFreeMonth = month;
        break;
      }
      if (monthlyTarget <= 0) rollover += newlyFreed;
      month = nextMonth(month);
    }
    return { rows, events, noRate, scheduledOneTime, debtFreeMonth, rolloverStart, automaticPayoffPlan };
  }

  function getDebtBudgetAllocationSummary(monthKey, plan = null) {
    const reservation = getDebtBudgetReservationForMonth(monthKey);
    const activePlan = plan || buildSnowballPlan(monthKey, 1);
    const row = getDebtPlanRowForMonth(activePlan, monthKey);
    const reservedTotal = roundMoney(Math.max(
      Number(reservation.reservedTotal || 0),
      row ? Number(row.pool || row.total || 0) : 0
    ));
    const dayMoneyTransfer = roundMoney(row
      ? Number(row.debtSavingsDeposit || 0)
      : Math.max(0, reservedTotal - getDebtPaidAmountForMonth(monthKey)));
    return {
      ...reservation,
      reservedTotal,
      row,
      dayMoneyTransfer,
      creditorBudget: roundMoney(Math.max(0, reservedTotal - dayMoneyTransfer)),
      reserveWithdrawal: roundMoney(row ? Number(row.debtSavingsWithdrawal || 0) : 0),
      reserveBalance: roundMoney(row ? Number(row.debtSavingsReserveBalance || 0) : 0)
    };
  }

  function getDebtPlanNextTarget(plan, fromMonth = currentMonth) {
    const rows = ((plan && plan.rows) || []).filter((row) => !isMonthKey(fromMonth) || monthDiff(fromMonth, row.month) >= 0);
    for (const row of rows) {
      const payment = (row.payments || []).find((entry) => entry.type === 'full_payoff' || entry.type === 'budget_extra' || entry.type === 'snowball');
      if (payment && payment.debt) return payment.debt;
      if (row.payoffReserve && row.payoffReserve.targetDebt && Number(row.payoffReserve.reserveAdded || 0) > 0) return row.payoffReserve.targetDebt;
      if (row.targetNext) return row.targetNext;
    }
    return '';
  }

  function createDebtPlanImpact(debt, monthKey, previousPlan, nextPlan, previousAmount, nextAmount) {
    const previousDebtFreeMonth = previousPlan && previousPlan.debtFreeMonth || '';
    const nextDebtFreeMonth = nextPlan && nextPlan.debtFreeMonth || '';
    const monthShift = previousDebtFreeMonth && nextDebtFreeMonth
      ? monthDiff(nextDebtFreeMonth, previousDebtFreeMonth)
      : 0;
    return {
      debtId: debt && debt.id || '',
      debtName: debt && debt.name || 'Schuld',
      month: isMonthKey(monthKey) ? monthKey : currentMonth,
      previousAmount: roundMoney(Number(previousAmount || 0)),
      nextAmount: roundMoney(Number(nextAmount || 0)),
      difference: roundMoney(Number(nextAmount || 0) - Number(previousAmount || 0)),
      previousDebtFreeMonth,
      nextDebtFreeMonth,
      monthShift,
      previousTarget: getDebtPlanNextTarget(previousPlan, currentMonth),
      nextTarget: getDebtPlanNextTarget(nextPlan, currentMonth),
      createdAt: new Date().toISOString()
    };
  }

  function getDebtPlanImpactText(impact) {
    if (!impact || typeof impact !== 'object') return '';
    const parts = [];
    const difference = Number(impact.difference || 0);
    if (Math.abs(difference) <= 0.005) parts.push(`Der Stand von ${impact.debtName || 'der Schuld'} ist unverÃ¤ndert.`);
    else parts.push(`Der Stand von ${impact.debtName || 'der Schuld'} ist um ${euro(Math.abs(difference))} ${difference < 0 ? 'gesunken' : 'gestiegen'}.`);
    const monthShift = Number(impact.monthShift || 0);
    if (impact.previousDebtFreeMonth && impact.nextDebtFreeMonth) {
      if (monthShift > 0) parts.push(`Voraussichtlich ${monthShift} Monat${monthShift === 1 ? '' : 'e'} frÃ¼her schuldenfrei (${formatMonthLabel(impact.nextDebtFreeMonth)} statt ${formatMonthLabel(impact.previousDebtFreeMonth)}).`);
      else if (monthShift < 0) parts.push(`Voraussichtlich ${Math.abs(monthShift)} Monat${Math.abs(monthShift) === 1 ? '' : 'e'} spÃ¤ter schuldenfrei (${formatMonthLabel(impact.nextDebtFreeMonth)} statt ${formatMonthLabel(impact.previousDebtFreeMonth)}).`);
      else parts.push(`Der voraussichtliche Endmonat bleibt ${formatMonthLabel(impact.nextDebtFreeMonth)}.`);
    } else if (impact.nextDebtFreeMonth) {
      parts.push(`Der neue Plan ist bis ${formatMonthLabel(impact.nextDebtFreeMonth)} berechnet.`);
    }
    if (impact.nextTarget && impact.nextTarget !== impact.previousTarget) parts.push(`Neues nÃ¤chstes Ziel fÃ¼r zusÃ¤tzliche Zahlungen: ${impact.nextTarget}.`);
    else if (impact.nextTarget) parts.push(`NÃ¤chstes Ziel fÃ¼r zusÃ¤tzliche Zahlungen bleibt ${impact.nextTarget}.`);
    return parts.join(' ');
  }

  function recalculateDebtPlanningAfterBalanceChange(debt, monthKey = currentMonth, options = {}) {
    if (!debt) return null;
    normalizeAppMeta();
    (state.debts || []).forEach(ensureDebtConfig);
    const plan = buildSnowballPlan(currentMonth, 120);
    state.appMeta.debtPlanLastRecalculatedAt = new Date().toISOString();
    state.appMeta.debtPlanLastRecalculatedMonth = isMonthKey(monthKey) ? monthKey : currentMonth;
    state.appMeta.debtPlanLastRecalculatedDebtId = typeof debt.id === 'string' ? debt.id : '';
    state.appMeta.debtPlanLastRecalculatedDebtName = String(debt.name || 'Schuld');
    state.appMeta.debtPlanLastImpact = options.previousPlan
      ? createDebtPlanImpact(debt, monthKey, options.previousPlan, plan, options.previousAmount, options.nextAmount)
      : null;
    return plan;
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
      .find((payment) => payment.type === 'snowball' || payment.type === 'budget_extra' || payment.type === 'full_payoff');
    const nextPayoffReserve = (nextPlan.rows || [])[0]?.payoffReserve || null;
    const automaticPayoffPlan = nextPlan.automaticPayoffPlan || getAutomaticFullPayoffPlan();

    (state.debts || []).forEach((debt) => {
      ensureDebtConfig(debt);
      if (debt.paymentType !== 'installment') return;
      if (getDebtCompletedMonth(debt) !== monthKey) return;
      if (knownSources.has(debt.name)) return;
      const amount = getDebtFreedStandardRate(debt, monthKey);
      if (!(amount > 0)) return;
      const reserveForPayoff = !!(
        automaticPayoffPlan
        && automaticPayoffPlan.sourceDebtId === debt.id
        && automaticPayoffPlan.targetDebtId
      );
      suggestions.push({
        month: monthKey,
        sourceDebt: debt.name || 'Schuld',
        amount,
        targetDebt: reserveForPayoff
          ? (nextPayoffReserve && nextPayoffReserve.targetDebt || automaticPayoffPlan.targetDebt)
          : (nextSnowballPayment ? nextSnowballPayment.debt : ''),
        transferMonth: nextMonth(monthKey),
        reserveForPayoff,
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
    if (free < 100) return { label: 'Sehr eng', kind: 'danger', text: 'Der freie Rest liegt unter 100 â‚¬.' };
    if (free < 300) return { label: 'Eng', kind: 'warning', text: 'Der freie Rest liegt unter 300 â‚¬.' };
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
      ['3', 'vierteljÃ¤hrlich'],
      ['6', 'halbjÃ¤hrlich'],
      ['12', 'jÃ¤hrlich']
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
    content.appendChild(createUiEl('p', 'small muted', 'FÃ¼r wen mÃ¶chtest du eine persÃ¶nliche Ausgabe eintragen?'));
    const grid = createUiEl('div', 'quick-person-grid');
    content.appendChild(grid);

    const modal = showModal('PersÃ¶nliche Ausgabe hinzufÃ¼gen', content, [
      { label: 'Abbrechen', className: 'secondary' }
    ]);

    people.forEach((person) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'overview-quick-action person-choice';
      btn.appendChild(createUiEl('span', 'quick-action-icon', 'â€¢'));
      const text = createUiEl('span', 'quick-action-text');
      text.appendChild(createUiEl('strong', '', person.name || 'Person'));
      text.appendChild(createUiEl('small', '', 'PersÃ¶nliche Ausgabe anlegen'));
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
        title: 'Lohn prÃ¼fen',
        text: 'Einkommen eintragen oder als erhalten markieren',
        icon: 'â†‘',
        tone: 'primary-action',
        onClick: () => switchSection('income')
      },
      {
        title: 'Gemeinsame Kosten',
        text: 'Fixkosten oder Zahlung anlegen',
        icon: 'â‡„',
        onClick: () => showCommonEditor()
      },
      {
        title: 'PersÃ¶nliche Ausgabe',
        text: 'Benny oder Madeleine auswÃ¤hlen und eintragen',
        icon: 'â™™',
        onClick: () => showPersonalQuickAddModal()
      },
      {
        title: 'Sonstige Ausgabe',
        text: 'Einmalige Ausgabe fÃ¼r den Monat erfassen',
        icon: '+',
        onClick: () => showBufferExpenseEditor()
      },
      {
        title: 'Einkauf eintragen',
        text: 'Ausgabe aus dem Einkaufsgeld erfassen',
        icon: 'â–¤',
        onClick: () => showGroceryExpenseEditor()
      },
      {
        title: 'Vertrag erfassen',
        text: 'Kosten, Laufzeit und KÃ¼ndigungsfrist hinterlegen',
        icon: 'âŒ‘',
        onClick: () => showContractEditor()
      },
      {
        title: 'Tankgeld',
        text: 'Tankbons und Monatswerte prÃ¼fen',
        icon: 'âŒ',
        onClick: () => switchSection('tankcalc')
      },
      {
        title: 'Datencheck',
        text: 'AuffÃ¤lligkeiten und offene Aufgaben prÃ¼fen',
        icon: 'âœ“',
        tone: 'soft-action',
        onClick: () => switchSection('datacheck')
      },
      {
        title: 'Sicherung',
        text: 'Backup erstellen oder Daten importieren',
        icon: 'â†“',
        tone: 'soft-action',
        onClick: () => switchSection('save')
      }
    ].filter(Boolean);
  }

  function showQuickCaptureModal() {
    const content = createUiEl('div', 'quick-capture-modal');
    content.appendChild(createGuidedFormIntro(
      'Schnell erfassen',
      `Direkt fÃ¼r ${formatMonthLabel(currentMonth)}. WÃ¤hle einfach, was du eintragen oder prÃ¼fen mÃ¶chtest.`
    ));
    const grid = createUiEl('div', 'overview-quickstart-actions quick-capture-grid');
    content.appendChild(grid);

    const modal = showModal('Schnell erfassen', content, [
      { label: 'SchlieÃŸen', className: 'secondary' }
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
    copy.appendChild(createUiEl('h3', '', 'Was mÃ¶chtest du eintragen?'));
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
    if (status.kind === 'danger' && details.free < 0) return 'Sofort prÃ¼fen: Der Monat ist rechnerisch im Minus.';
    if (Number(details.miscOpen || 0) > 0) return 'Konservativ gerechnet: offene sonstige Ausgaben sind im freien Betrag schon abgezogen.';
    if (status.kind === 'danger') return 'Sehr wenig Luft. Sonstige Ausgaben und offene Zahlungen prÃ¼fen.';
    if (status.kind === 'warning') return 'Planbar, aber eng. RÃ¼cklagen erst nach Monatsabschluss buchen.';
    return 'Stabiler Monat. Offene Zahlungen kontrollieren und danach abschlieÃŸen.';
  }

  function renderMonthStatusPanel(monthKey, details) {
    const status = getFinanceStatus(details.free);
    const debtPlan = getDebtPlanForMonth(monthKey);
    const warnings = getMonthWarnings(monthKey).filter((item) => item.kind === 'danger' || item.kind === 'warning');
    const closed = isMonthClosed(monthKey);
    const panel = createUiEl('div', `month-status-panel ${status.kind}`);

    const main = createUiEl('div', 'month-status-main');
    const icon = createUiEl('div', 'month-status-icon', status.kind === 'success' ? 'âœ“' : '!');
    main.appendChild(icon);
    const text = createUiEl('div', 'month-status-copy');
    const title = document.createElement('h3');
    title.textContent = `${formatMonthLabel(monthKey)} Â· ${status.label}`;
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
    actions.appendChild(createJumpButton('Sonstige prÃ¼fen', 'buffer'));
    actions.appendChild(createJumpButton('Schuldenplan', 'debts'));
    actions.appendChild(createJumpButton(closed ? 'Abschluss ansehen' : 'Monat abschlieÃŸen', 'monthclose', 'primary compact'));
    panel.appendChild(actions);

    if (warnings.length) {
      const warningLine = createUiEl('div', 'month-status-warningline');
      warningLine.textContent = warnings.slice(0, 2).map((item) => item.text).join(' Â· ');
      panel.appendChild(warningLine);
    }
    return panel;
  }

  function renderForecastTimelineCard(months, hasScenario, projectionMap) {
    const card = createUiEl('div', 'forecast-timeline-card');
    const head = createUiEl('div', 'forecast-timeline-head');
    const title = document.createElement('h3');
    title.textContent = 'Prognose-Zeitstrahl';
    const sub = createUiEl('p', 'small muted', hasScenario ? 'Mit deinen Was-wÃ¤re-wenn-Werten gerechnet.' : 'Auf Basis deiner gespeicherten Daten gerechnet.');
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

  // Hilfsfunktion: berechnet den freien Betrag fÃ¼r ein gegebenes
  // Monatsâ€‘Key fÃ¼r den ausgewÃ¤hlten Monat. Dabei werden die
  // Nettoeinkommen, die gerundeten Anteile der gemeinsamen Kosten
  // und die persÃ¶nlichen Ausgaben berÃ¼cksichtigt. bezahlte sonstige Ausgaben werden abgezogen.
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

  function getCarryoverInForMonth(monthKey) {
    if (!isMonthKey(monthKey) || monthKey <= CARRYOVER_START_MONTH) return 0;
    const previousMonth = addMonths(monthKey, -1);
    if (previousMonth < CARRYOVER_START_MONTH) return 0;
    const closing = state.monthlyClosings && state.monthlyClosings[previousMonth];
    if (!closing || !Number.isFinite(Number(closing.carryoverOut))) return 0;
    if (closing.carryoverToMonth && closing.carryoverToMonth !== monthKey) return 0;
    return roundMoney(Math.max(0, Number(closing.carryoverOut || 0)));
  }

  function getCarryoverStatusForMonth(monthKey) {
    if (!isMonthKey(monthKey)) {
      return { active: false, isStart: false, previousMonth: '', amount: 0, closed: false };
    }
    const previousMonth = addMonths(monthKey, -1);
    const isStart = monthKey === CARRYOVER_START_MONTH;
    if (monthKey < CARRYOVER_START_MONTH) {
      return { active: false, isStart: false, previousMonth, amount: 0, closed: false };
    }
    if (isStart) {
      return { active: true, isStart: true, previousMonth, amount: 0, closed: false };
    }
    const closing = state.monthlyClosings && state.monthlyClosings[previousMonth];
    return {
      active: true,
      isStart: false,
      previousMonth,
      amount: getCarryoverInForMonth(monthKey),
      closed: !!closing,
      closing: closing || null
    };
  }

  function roundMoney(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return 0;
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  function getDistributableAmountFromFree(free) {
    return roundMoney(Math.max(0, Number(free || 0) - Number(savingsConfig.minFree || 0)));
  }

  function getSelfEmploymentRecurringPersonalPostForMonth(template, monthKey) {
    if (!template || !isMonthKey(monthKey)) return null;
    const exact = template.personalCostId
      ? (state.personalCosts || []).find((post) => post && post.id === template.personalCostId)
      : null;
    if (exact && isDue(exact, monthKey)) return exact;
    return (state.personalCosts || []).find((post) => post
      && post.selfEmploymentRecurringTemplateId === template.id
      && isDue(post, monthKey)) || null;
  }

  function getSelfEmploymentBudgetImpactForMonth(monthKey) {
    const empty = {
      income: 0,
      expensePaid: 0,
      expenseOpen: 0,
      expenseAlreadyHousehold: 0,
      adjustment: 0,
      hasActivity: false
    };
    if (!isMonthKey(monthKey) || monthKey >= PRIVATE_HOUSEHOLD_ONLY_START_MONTH) return empty;
    const cfg = normalizeSelfEmployment();
    const monthEntries = cfg.entries.filter((entry) => String(entry.date || '').startsWith(`${monthKey}-`));
    let income = 0;
    let expensePaid = 0;
    let expenseAlreadyHousehold = 0;

    monthEntries.forEach((entry) => {
      const amount = roundMoney(Number(entry.amount || 0));
      // Barzahlungen gehÃ¶ren vollstÃ¤ndig in die EÃœR, verÃ¤ndern aber nicht den
      // verfÃ¼gbaren Betrag auf den Haushaltskonten.
      if (normalizeSelfEmploymentPaymentMethod(entry.paymentMethod) === 'cash') return;
      if (entry.type === 'income') {
        income += amount;
        return;
      }
      expensePaid += amount;
      // Standard fÃ¼r bestehende und neue EÃœR-Ausgaben: Sie wurden bereits unter
      // â€žSonstigeâ€œ oder â€žPersÃ¶nliche Ausgabenâ€œ eingeplant und dÃ¼rfen nicht doppelt zÃ¤hlen.
      if (entry.budgetMode !== 'auto_count') expenseAlreadyHousehold += amount;
    });

    let expenseOpen = 0;
    cfg.recurringExpenses.forEach((template) => {
      if (normalizeSelfEmploymentPaymentMethod(template.paymentMethod) === 'cash') return;
      if (!isSelfEmploymentRecurringDue(template, monthKey)) return;
      if (getSelfEmploymentRecurringBooking(template.id, monthKey)) return;
      if (getSelfEmploymentRecurringPersonalPostForMonth(template, monthKey)) return;
      expenseOpen += Number(template.amount || 0);
    });

    income = roundMoney(income);
    expensePaid = roundMoney(expensePaid);
    expenseOpen = roundMoney(expenseOpen);
    expenseAlreadyHousehold = roundMoney(expenseAlreadyHousehold);
    const adjustment = roundMoney(income - expensePaid - expenseOpen + expenseAlreadyHousehold);
    return {
      income,
      expensePaid,
      expenseOpen,
      expenseAlreadyHousehold,
      adjustment,
      hasActivity: monthEntries.length > 0 || expenseOpen > 0
    };
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
      personsData.map((pd) => ({
        person: pd.person,
        income: getIncomeShareBasis(pd.person, monthKey, pd.income)
      })),
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
      // Sicherheitsnetz: Posten ohne gÃ¼ltige Person werden trotzdem vom freien Betrag abgezogen,
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
    const carryoverIn = roundMoney(getCarryoverInForMonth(monthKey));
    const businessBudget = getSelfEmploymentBudgetImpactForMonth(monthKey);
    const debtBudget = getDebtBudgetReservationForMonth(monthKey, { incomeResolver });
    const freeBeforeDebtBudget = roundMoney(totalIncome + carryoverIn + businessBudget.adjustment - totalCommonRounded - totalPersonal);
    const freeBeforeMisc = roundMoney(freeBeforeDebtBudget - debtBudget.additionalReservation);
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
      carryoverIn,
      businessIncome: businessBudget.income,
      businessExpensePaid: businessBudget.expensePaid,
      businessExpenseOpen: businessBudget.expenseOpen,
      businessExpenseAlreadyHousehold: businessBudget.expenseAlreadyHousehold,
      businessBudgetAdjustment: businessBudget.adjustment,
      businessBudgetHasActivity: businessBudget.hasActivity,
      debtBudgetTarget: Number(debtBudget.monthlyTarget || 0),
      debtBudgetReserved: Number(debtBudget.reservedTotal || 0),
      debtBudgetAlreadyInCosts: Number(debtBudget.linkedDebtCosts || 0),
      debtBudgetAdditionalReservation: Number(debtBudget.additionalReservation || 0),
      freeBeforeDebtBudget,
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
    state.changeLog.unshift({ id: generateId(), type: type || 'Ã„nderung', text: text || '', month: monthKey, createdAt: new Date().toISOString() });
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
    monthSelect.setAttribute('aria-label', 'Monat auswÃ¤hlen');
    const yearSelect = document.createElement('select');
    yearSelect.setAttribute('aria-label', 'Jahr auswÃ¤hlen');
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
    return confirm(`${formatMonthLabel(monthKey)} ist bereits abgeschlossen. ${actionText || 'Ã„nderung'} trotzdem durchfÃ¼hren?`);
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
      opt.textContent = `${refund.year} Â· Rest ${euro(remaining)}`;
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
    if (noteText || purchase.note) post.note = [noteText, purchase.note].filter(Boolean).join(' Â· ');
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
    content.appendChild(createLabelInput('Zielmonat fÃ¼r Sonstige Ausgaben', picker));
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
    content.innerHTML = `<p class="small muted">Verschiebt diese sonstige Ausgabe in einen anderen Monat. Das ist fÃ¼r nachtrÃ¤gliches Hinâ€‘ und Herschieben gedacht.</p>`;
    const picker = createStandaloneMonthPicker(post.startMonth || currentMonth);
    content.appendChild(createLabelInput('Neuer Monat', picker));
    const carry = document.createElement('label');
    carry.className = 'checkbox-row';
    const carryCheck = document.createElement('input');
    carryCheck.type = 'checkbox';
    carryCheck.checked = isPostPaidForMonth(post, currentMonth);
    carry.appendChild(carryCheck);
    carry.appendChild(document.createTextNode(' Bezahlt-Status in den Zielmonat Ã¼bernehmen'));
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
    if (openPersonal.length) add('PersÃ¶nliche Ausgaben', `${openPersonal.length} persÃ¶nliche Zahlung(en) offen`, 'personal');
    if (openBuffer.length) add('Sonstige Ausgaben', `${openBuffer.length} sonstige Ausgabe(n) offen`, 'buffer');
    if (dueDebts.length) add('Schulden', `${dueDebts.length} Schuld-Zahlung(en) fÃ¤llig/offen`, 'debts', 'danger');
    const contractAttention = getContractAttentionItems();
    if (contractAttention.length) {
      const urgentContracts = contractAttention.some((item) => item.kind === 'danger');
      add('VertrÃ¤ge', `${contractAttention.length} Vertrags-Hinweis(e) prÃ¼fen`, 'contracts', urgentContracts ? 'danger' : 'warning');
    }
    if (!isMonthClosed(monthKey)) add('Monatsabschluss', `${formatMonthLabel(monthKey)} ist noch nicht abgeschlossen`, 'monthclose', 'info');
    const dataWarnings = getDataCheckItems().filter((item) => item.kind === 'warning' || item.kind === 'danger').length;
    if (dataWarnings) add('Datencheck', `${dataWarnings} Datenhinweis(e) prÃ¼fen`, 'datacheck', 'warning');
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
      ok.textContent = 'Keine offenen Pflichtpunkte fÃ¼r diesen Monat gefunden.';
      card.appendChild(ok);
      return card;
    }
    const list = document.createElement('div');
    list.className = 'todo-list';
    items.forEach((item) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `todo-row ${item.kind || ''}`.trim();
      row.innerHTML = `<span><strong>${item.area}</strong><small>${item.text}</small></span><b>Ã–ffnen</b>`;
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
      { label: 'KÃ¤ufe / Zuordnungen', value: String(summary.entries) }
    ]));
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = 'KÃ¤ufe aus der Steuererstattung senken nur den gebundenen Rest und bleiben als Haushaltsnachweis sichtbar.';
    card.appendChild(p);
    return card;
  }


  function renderMonthCompareCard(monthKey) {
    const previousMonth = addMonths(monthKey, -1);
    const card = document.createElement('div');
    card.className = 'card compact-card month-compare-card';
    const h = document.createElement('h3');
    h.textContent = 'Was hat sich geÃ¤ndert?';
    card.appendChild(h);
    if (previousMonth < APP_FIRST_DATA_MONTH) {
      const p = document.createElement('p');
      p.className = 'small muted';
      p.textContent = 'FÃ¼r den Vormonat gibt es vor dem App-Start keine Vergleichsdaten.';
      card.appendChild(p);
      return card;
    }
    const prev = computeMonthDetails(previousMonth);
    const now = computeMonthDetails(monthKey);
    const rows = [
      ['Sicher verfÃ¼gbar', now.free - prev.free],
      ['Netto gesamt', now.totalIncome - prev.totalIncome],
      ['Gemeinsame Kosten', now.totalCommonRounded - prev.totalCommonRounded],
      ['PersÃ¶nliche Ausgaben', now.totalPersonal - prev.totalPersonal],
      ['Sonstige bezahlt', now.miscPaid - prev.miscPaid]
    ];
    const table = document.createElement('table');
    table.className = 'list-table compact-table';
    table.innerHTML = '<thead><tr><th>Bereich</th><th>Ã„nderung zum Vormonat</th></tr></thead>';
    const tbody = document.createElement('tbody');
    rows.forEach(([label, diff]) => {
      const tr = document.createElement('tr');
      const sign = diff > 0 ? '+' : '';
      const goodForFree = label === 'Sicher verfÃ¼gbar' ? diff >= 0 : diff <= 0;
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
    const actualMonth = dateToMonthKey(new Date());
    const pastMonth = monthKey < actualMonth;
    const currentMonthPending = monthKey === actualMonth;
    const unpaidCommon = state.commonCosts.filter((item) => isDue(item, monthKey) && !isPostPaidForMonth(item, monthKey)).length;
    const unpaidPersonal = state.personalCosts.filter((item) => isDue(item, monthKey) && !isPostPaidForMonth(item, monthKey)).length;
    const unpaidDebts = state.debts.filter((d) => isDebtOpenForMonth(d, monthKey)).length;
    const openRecurringBusiness = monthKey < PRIVATE_HOUSEHOLD_ONLY_START_MONTH
      ? getSelfEmploymentRecurringExpenses()
        .filter((template) => isSelfEmploymentRecurringDue(template, monthKey) && !getSelfEmploymentRecurringBooking(template.id, monthKey))
        .length
      : 0;
    const miscOpen = getBufferExpenseOpenSumForMonth(monthKey);
    const free = computeFreeSumForMonth(monthKey);
    if (pastMonth && unpaidCommon > 0) warnings.push({ kind: 'warning', text: `${unpaidCommon} gemeinsame Zahlung(en) aus dem Vormonat: Status prÃ¼fen` });
    else if (currentMonthPending && unpaidCommon > 0) warnings.push({ kind: 'info', text: `${unpaidCommon} gemeinsame Zahlung(en) im Monatsverlauf geplant` });
    if (pastMonth && unpaidPersonal > 0) warnings.push({ kind: 'warning', text: `${unpaidPersonal} persÃ¶nliche Zahlung(en) aus dem Vormonat: Status prÃ¼fen` });
    else if (currentMonthPending && unpaidPersonal > 0) warnings.push({ kind: 'info', text: `${unpaidPersonal} persÃ¶nliche Zahlung(en) im Monatsverlauf geplant` });
    if (pastMonth && unpaidDebts > 0) warnings.push({ kind: 'warning', text: `${unpaidDebts} Schuldzahlung(en) aus dem Vormonat: Zahlungsstatus prÃ¼fen` });
    else if (currentMonthPending && unpaidDebts > 0) warnings.push({ kind: 'info', text: `${unpaidDebts} Schuldzahlung(en) im Monatsverlauf geplant` });
    if (openRecurringBusiness > 0 && (pastMonth || currentMonthPending)) warnings.push({ kind: pastMonth ? 'warning' : 'info', text: `${openRecurringBusiness} wiederkehrende Betriebsausgabe(n) ${pastMonth ? 'aus dem Vormonat' : 'im Monatsverlauf'} noch nicht als bezahlt in die EÃœR Ã¼bernommen` });
    if (miscOpen > 0 && (pastMonth || currentMonthPending)) warnings.push({ kind: pastMonth ? 'warning' : 'info', text: `Sonstige Ausgaben ${pastMonth ? 'aus dem Vormonat' : 'im Monatsverlauf'} noch offen: ${euro(miscOpen)}` });
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
  // weil das importierte Sicherungen scheinbar Ã¼berschrieben wirken lassen konnte.
  const startMonthKey = isMonthKey(state.appMeta.selectedMonth) ? state.appMeta.selectedMonth : actualMonthKey;
  let currentMonth = startMonthKey;
  let monthList = getSelectableMonths(currentMonth);
  normalizeSavingsGoalsConfig();
  if (!isMonthKey(state.appMeta.lastAutoMonthCheck)) {
    state.appMeta.lastAutoMonthCheck = actualMonthKey;
  }
  // Bestehende Installationen werden beim Update nicht rÃ¼ckwirkend verÃ¤ndert.
  // Die automatische Vorbereitung beginnt beim nÃ¤chsten echten Monatswechsel.
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
  const selfEmploymentSection = document.getElementById('selfemployment');
  const contractsSection = document.getElementById('contracts');
  const debtsSection = document.getElementById('debts');
  const settingsSection = document.getElementById('settings');
  const monthCloseSection = document.getElementById('monthclose');
  const dataCheckSection = document.getElementById('datacheck');
  const forecastSection = document.getElementById('forecast');
  const saveSection = document.getElementById('save');
  const taxRefundSection = document.getElementById('taxrefund');
  const globalMonthBar = document.getElementById('globalMonthBar');
  const quickCaptureButton = document.getElementById('quickCaptureButton');
  const reloadButton = document.getElementById('reloadButton');
  const sectionButtons = Array.from(document.querySelectorAll('[data-section]'));
  let currentSection = 'overview';

  // ID des aktuell ausgewÃ¤hlten Topfs fÃ¼r die Detailansicht in
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
  let selfEmploymentReportYear = String(currentMonth).slice(0, 4);
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
    head.appendChild(createUiEl('span', 'pill danger', 'PrÃ¼fen'));
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
    openBtn.textContent = 'Datencheck Ã¶ffnen';
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
  function syncSectionNavigation() {
    sectionButtons.forEach((btn) => {
      const active = btn.dataset.section === currentSection;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  }

  function switchSection(section) {
    // Monatsstart ist vollstÃ¤ndig in der Ãœbersicht enthalten; TÃ¶pfe sind mit
    // den RÃ¼cklagen zusammengefÃ¼hrt. Alte interne Links bleiben dadurch gÃ¼ltig.
    const targetSection = section === 'selfemployment'
      ? 'overview'
      : section === 'monthstart'
      ? 'overview'
      : (['pots', 'savings', 'smoking'].includes(section) ? 'overview' : section);
    currentSection = targetSection || 'overview';
    document.querySelectorAll('.tab-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === currentSection);
    });
    syncSectionNavigation();
    render();
    requestAnimationFrame(() => {
      const main = document.querySelector('.app-content main');
      if (main) main.scrollIntoView({ block: 'start', behavior: 'auto' });
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
    if (!confirm('Seite komplett neu laden und Updates holen? Ungespeicherte Ã„nderungen gehen verloren.')) {
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
      console.warn('Cache/ServiceWorker konnten nicht vollstÃ¤ndig gelÃ¶scht werden:', err);
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
    // Ein Ausgleich von mehreren tausend Euro ist bei dieser App unplausibel und erzeugt Anteile Ã¼ber 100 %.
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
      .replace(/â‚¬/g, '');
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
      // Ab diesem Monat dauerhaft: zukÃ¼nftige dauerhafte EintrÃ¤ge ab diesem Monat ersetzen,
      // damit kein Ã¤lterer oder spÃ¤terer Eintrag den neuen Wert wieder Ã¼berdeckt.
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
    if (person.netOverrides && person.netOverrides[month] != null) return 'tatsÃ¤chlich ausgezahlt';
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
        alert('FÃ¼r diese Zahlung ist â€žUmbuchungâ€œ gewÃ¤hlt, aber kein Zielkonto hinterlegt. Bitte Posten bearbeiten und Zielkonto auswÃ¤hlen.');
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
      label: `RÃ¼cklage ${linkedSavingsGoal.name}: ${post.name || 'Einzahlung'} ${formatMonthLabel(month)}`,
      amount: -amount,
      affectsBalance: false,
      balanceMode: 'proof',
      note: 'Nachweis einer RÃ¼cklagen-Zuordnung; der eingegebene Bankstand bleibt unverÃ¤ndert.'
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
    if (tx) addChangeLog('Konten', `${post.name || 'Posten'} fÃ¼r ${formatMonthLabel(month)} gebucht.`, month);
    return !!tx;
  }

  function unbookPostPaymentForMonth(post, month) {
    if (!post || !isMonthKey(month)) return false;
    if (!ACCOUNTS_ENABLED) return false;
    applyPostAccountBooking(post, month, false);
    addChangeLog('Konten', `${post.name || 'Posten'}: Kontobuchung fÃ¼r ${formatMonthLabel(month)} entfernt.`, month);
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
      alert('FÃ¼r diesen Monatsanteil ist kein Lohn-/Quellkonto hinterlegt. Bitte beim Einkommen ein Lohn-Zielkonto auswÃ¤hlen.');
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
    const labelBase = options.label || `Umbuchung ${getAccountName(fromAccountId)} â†’ ${getAccountName(toAccountId)}`;
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
    addChangeLog('Konten', `Umbuchung ${euro(tr.amount)} gelÃ¶scht.`, tr.month);
    return true;
  }

  function addAccountTransferTemplate(data) {
    normalizeAccountTransferTemplatesConfig();
    const tpl = {
      id: generateId(),
      name: data.name || `${getAccountName(data.fromAccountId)} â†’ ${getAccountName(data.toAccountId)}`,
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
    addChangeLog('Konten', `Umbuchungsvorlage angelegt: ${tpl.name} Â· ${euro(tpl.amount)}.`, currentMonth);
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
      addChangeLog('Konten', `Umbuchungsvorlage ausgefÃ¼hrt: ${tpl.name} Â· ${euro(tpl.amount)}.`, monthKey);
    }
    return ok;
  }

  function getTransferAccountWarning(fromAccountId, amount) {
    const account = getAccountById(fromAccountId);
    if (!account) return '';
    if (!(Number(amount || 0) > 0)) return '';
    return `Die Umbuchung verÃ¤ndert ${account.name} und das Zielkonto genau einmal und legt dazu passende VerlaufseintrÃ¤ge an.`;
  }

  function showAccountTransactions(account) {
    const content = document.createElement('div');
    content.className = 'modal-form';
    const rows = (account.transactions || []).slice().sort((a, b) => (b.month || '').localeCompare(a.month || '') || (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'small muted';
      empty.textContent = 'FÃ¼r dieses Konto gibt es noch keine Buchungen.';
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
    showModal(`Buchungen Â· ${account.name}`, content, [{ label: 'SchlieÃŸen', className: 'secondary' }]);
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
      { label: availability.missing > 0.005 ? 'Fehlt' : 'VerfÃ¼gbar', value: euro(availability.missing > 0.005 ? availability.missing : availability.available), kind: availability.missing > 0.005 ? 'danger' : 'success' }
    ]));
    const parts = [
      availability.manualBound > 0.005 ? `manuell gebunden ${euro(availability.manualBound)}` : '',
      availability.taxRefundBound > 0.005 ? `Steuererstattung ${euro(availability.taxRefundBound)}` : '',
      availability.intervalReserveBound > 0.005 ? `Intervall-RÃ¼cklagen ${euro(availability.intervalReserveBound)}` : '',
      availability.savingsGoalBound > 0.005 ? `verknÃ¼pfte RÃ¼cklagen ${euro(availability.savingsGoalBound)}` : ''
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
        diffBox.innerHTML = '<strong>Differenz:</strong> Bitte einen gÃ¼ltigen Kontostand eintragen.';
        return;
      }
      const diff = real - currentBalance;
      const projectedAfter = real - availability.bound - availability.open;
      const projectedText = projectedAfter < -0.005
        ? `Mit diesem Bankstand fehlen nach gebundenen BetrÃ¤gen und offenen Zahlungen ${euro(Math.abs(projectedAfter))}.`
        : `Mit diesem Bankstand wÃ¤ren nach gebundenen BetrÃ¤gen und offenen Zahlungen ${euro(projectedAfter)} verfÃ¼gbar.`;
      diffBox.className = `notice ${Math.abs(diff) < 0.005 ? 'success' : (diff > 0 ? 'success' : 'warning')}`;
      diffBox.innerHTML = `<strong>Differenz:</strong> ${euro(diff)}<br><span class="small muted">${Math.abs(diff) < 0.005 ? 'Keine Ausgleichsbuchung nÃ¶tig.' : (diff > 0 ? 'Die App bucht eine Gutschrift auf das Konto.' : 'Die App bucht eine Abbuchung vom Konto.')} ${projectedText} Nur-Status-Posten werden dabei nicht ein zweites Mal abgezogen.</span>`;
    };
    realInput.addEventListener('input', updateDiff);
    updateDiff();

    showModal(`Kontostand abgleichen Â· ${account.name}`, content, [
      { label: 'Abbrechen', className: 'secondary' },
      { label: 'Abgleich speichern', className: 'primary', onClick: (close) => {
        const real = parseMoneyInput(realInput.value);
        if (!Number.isFinite(real)) return alert('Bitte einen gÃ¼ltigen Kontostand eintragen.');
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
          addChangeLog('Konten', `${currentAccount.name}: Kontostand geprÃ¼ft, keine Differenz.`, currentMonth);
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
        addChangeLog('PersÃ¶nliche Ausgaben', `${post.name || 'Lohnabzug'}: mit Lohn-Eingang automatisch als bezahlt markiert.`, month);
        changes += 1;
        return;
      }
      if (!post.incomePaidMonths.includes(month)) return;
      setPostPaidForMonth(post, month, false);
      resetDebtPaymentFromPost(post, month);
      addChangeLog('PersÃ¶nliche Ausgaben', `${post.name || 'Lohnabzug'}: automatische Markierung mit rÃ¼ckgÃ¤ngig gemachtem Lohn-Eingang zurÃ¼ckgesetzt.`, month);
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
      const amount = getPersonCashPayout(person, month);
      if (!Number.isFinite(amount) || amount < 0) return false;
      const changed = Math.abs(Number(existing.amount || 0) - amount) >= 0.005;
      existing.accountId = '';
      existing.amount = amount;
      existing.transactionId = '';
      existing.balanceApplied = false;
      existing.balanceAppliedAccountId = '';
      existing.balanceAppliedAmount = 0;
      if (changed) addChangeLog('Einkommen', `${person.name}: Lohn fÃ¼r ${formatMonthLabel(month)} auf ${euro(amount)} aktualisiert.`, month);
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
    const amount = getPersonCashPayout(person, month);
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
      const bankNote = existing.balanceApplied === true ? 'Kontostand um die Differenz angepasst.' : 'Kontostand nicht automatisch verÃ¤ndert.';
      addChangeLog('Einkommen', `${person.name}: Lohn fÃ¼r ${formatMonthLabel(month)} auf ${euro(amount)} aktualisiert; ${bankNote}`, month);
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
        const amount = getPersonCashPayout(person, month);
        person.incomeReceived[month] = {
          accountId: '',
          amount,
          receivedAt: new Date().toISOString(),
          transactionId: '',
          balanceApplied: false,
          balanceAppliedAccountId: '',
          balanceAppliedAmount: 0
        };
        addChangeLog('Einkommen', `${person.name}: Lohn ${euro(amount)} fÃ¼r ${formatMonthLabel(month)} erhalten markiert.`, month);
        syncPaymentsPaidWithIncome(person, month, true);
        return true;
      }
      const targetAccountId = accountId || getPersonIncomeAccountId(person);
      if (!targetAccountId || !getAccountById(targetAccountId)) {
        alert('Bitte zuerst ein Zielkonto fÃ¼r den Lohn auswÃ¤hlen.');
        return false;
      }
      const amount = getPersonCashPayout(person, month);
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
      addChangeLog('Einkommen', `${person.name}: Lohn ${euro(amount)} fÃ¼r ${formatMonthLabel(month)} erhalten; ${getAccountName(targetAccountId)} um diesen Eingang erhÃ¶ht.`, month);
      syncPaymentsPaidWithIncome(person, month, true);
      return true;
    }
    if (existing) {
      if (!ACCOUNTS_ENABLED) {
        syncPaymentsPaidWithIncome(person, month, false);
        addChangeLog('Einkommen', `${person.name}: Lohn-Eingang fÃ¼r ${formatMonthLabel(month)} rÃ¼ckgÃ¤ngig gemacht.`, month);
        delete person.incomeReceived[month];
        return true;
      }
      const balanceWasApplied = existing.balanceApplied === true;
      applyPersonIncomeBalance(person, month, false);
      removeAccountTransaction(existing.accountId, existing.transactionId);
      syncPaymentsPaidWithIncome(person, month, false);
      addChangeLog('Einkommen', `${person.name}: Lohn-Eingang fÃ¼r ${formatMonthLabel(month)} rÃ¼ckgÃ¤ngig gemacht${balanceWasApplied ? ' und vom Kontostand entfernt' : ''}.`, month);
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
    if (typeof post.paymentMethod !== 'string') post.paymentMethod = '';
    post.paymentMethod = normalizeHouseholdPaymentMethod(post.paymentMethod);
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
    none.textContent = 'Keine verknÃ¼pfte RÃ¼cklage';
    select.appendChild(none);
    (state.savingsGoals || []).forEach((goal) => {
      const option = document.createElement('option');
      option.value = goal.id;
      option.textContent = `${goal.name}${goal.isActive ? '' : ' Â· pausiert'}`;
      select.appendChild(option);
    });
    select.value = value || '';
    return select;
  }

  function appendSavingsGoalLinkField(content, refs, editPost) {
    refs.savingsGoalSelect = { value: '' };
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
      note: `${post.name || 'Kostenposten'} Â· automatisch zurÃ¼ckgelegt`,
      sourceId,
      sourcePostId: post.id || '',
      createdAt: new Date().toISOString()
    });
    addChangeLog('RÃ¼cklagen', `${goal.name}: ${euro(amount)} aus ${post.name || 'Kostenposten'} zurÃ¼ckgelegt.`, monthKey);
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
    if (!post.debtPaymentSync || typeof post.debtPaymentSync !== 'object' || Array.isArray(post.debtPaymentSync)) {
      post.debtPaymentSync = {};
    }
    Object.keys(post.debtPaymentSync).forEach((month) => {
      const entry = post.debtPaymentSync[month];
      if (!isMonthKey(month) || !entry || typeof entry !== 'object') {
        delete post.debtPaymentSync[month];
        return;
      }
      entry.debtId = typeof entry.debtId === 'string' ? entry.debtId : '';
      entry.historyId = typeof entry.historyId === 'string' ? entry.historyId : '';
      entry.amount = Math.max(0, Number(entry.amount || 0));
      entry.hadAmountOverride = entry.hadAmountOverride === true;
      entry.previousAmountOverride = entry.hadAmountOverride
        && entry.previousAmountOverride !== null
        && Number.isFinite(Number(entry.previousAmountOverride))
        ? Number(entry.previousAmountOverride)
        : null;
    });
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
    // Sobald ein Posten als bezahlt markiert ist, bleibt der Betrag fÃ¼r genau diesen Monat fest.
    // SpÃ¤tere Ã„nderungen laufen dadurch nur Ã¼ber den Raten-/Betragsverlauf fÃ¼r Folgemonate.
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
    if (post.paidWithIncome === true) return false;
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
    const legacyNote = 'Aus altem Speicherstand Ã¼bernommen; der Bankstand war bereits angepasst.';
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
            label: `${post.name || 'Umbuchung'} zurÃ¼ckgesetzt`,
            amount: Number(existing.amount || 0),
            affectsBalance: true
          });
          applyAccountLedgerTransaction(existing.transferToAccountId, {
            month,
            type: 'legacy_reset',
            sourceId: `${resetSource}:in`,
            label: `${post.name || 'Umbuchung'} zurÃ¼ckgesetzt`,
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
            label: `${post.name || 'Ausgabe'} zurÃ¼ckgesetzt`,
            amount: Number(existing.amount || 0),
            affectsBalance: true
          });
        }
      }
      delete post.accountBalanceDebits[month];
      post.sharedBalanceDebitedMonths = post.sharedBalanceDebitedMonths.filter((m) => m !== month);
      addChangeLog('Konten', existing.transferToAccountId
        ? `${post.name || 'Umbuchung'}: Umbuchung ${euro(existing.amount)} von ${getAccountName(existing.accountId)} nach ${getAccountName(existing.transferToAccountId)} zurÃ¼ckgesetzt.`
        : `${post.name || 'Ausgabe'}: Kontoabzug ${euro(existing.amount)} zurÃ¼ckgesetzt.`, month);
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
      ? `${post.name || 'Umbuchung'}: bezahlte Umbuchung um ${euro(Math.abs(delta))} ${delta > 0 ? 'verringert' : 'erhÃ¶ht'}.`
      : `${post.name || 'Ausgabe'}: bezahlten Kontoabzug um ${euro(Math.abs(delta))} ${delta > 0 ? 'verringert' : 'erhÃ¶ht'}.`, month);
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
      // Bezahlte Monate bleiben eingefroren. Die dauerhafte Ã„nderung beginnt dann automatisch im Folgemonat.
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
    container.appendChild(createLabelInput(`GeÃ¤nderten Betrag fÃ¼r ${formatMonthLabel(currentMonth)} anwenden`, select));
  }
  function isMonthKey(value) {
    return /^\d{4}-\d{2}$/.test(String(value || ''));
  }
  function isPostRemovedFromPrivateHousehold(post, month) {
    if (!post || !isMonthKey(month) || month < PRIVATE_HOUSEHOLD_ONLY_START_MONTH) return false;
    const nameKey = normalizeTextKey(post.name);
    const businessPost = !!(post.selfEmploymentRecurringTemplateId
      || post.selfEmploymentEntryId
      || nameKey.startsWith('betrieblich:'));
    if (businessPost) return true;
    if (!nameKey.includes('rauchzeug')) return false;
    const owner = (state.persons || []).find((person) => person && person.id === post.personId);
    return normalizeTextKey(owner && owner.name) === 'benny'
      || String(post.personId || '').toLowerCase() === 'benny';
  }
  function isPostActiveInMonth(post, month) {
    if (!post || !isMonthKey(post.startMonth) || !isMonthKey(month)) return false;
    if (isPostRemovedFromPrivateHousehold(post, month)) return false;
    if (monthDiff(post.startMonth, month) < 0) return false;
    if (post.endMonth && isMonthKey(post.endMonth) && monthDiff(month, post.endMonth) < 0) return false;
    return true;
  }
  function isPostVisibleInMonth(post, month) {
    if (isPostRemovedFromPrivateHousehold(post, month)) return false;
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
   * Jeder Anteil wird unabhÃ¤ngig auf das nÃ¤chsthÃ¶here 5â€‘â‚¬â€‘Intervall
   * aufgerundet. Es erfolgt keine Anpassung der Summe. Die Summe der
   * resultierenden Anteile kann daher grÃ¶ÃŸer sein als die
   * tatsÃ¤chlichen Gesamtkosten.
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
      note: typeof expense.note === 'string' ? expense.note : '',
      paymentMethod: normalizeHouseholdPaymentMethod(expense.paymentMethod)
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

  function getSmokingBudgetPosts() {
    return (state.personalCosts || []).filter((post) => normalizeTextKey(post && post.name).includes('rauchzeug'));
  }

  function getSmokingBudgetBaseTarget(monthKey = currentMonth) {
    if (monthKey >= PRIVATE_HOUSEHOLD_ONLY_START_MONTH) return 0;
    return getSmokingBudgetPosts().reduce((sum, post) => {
      if (!isDue(post, monthKey)) return sum;
      return sum + Number(getEffectiveBaseAmountForMonth(post, monthKey) || 0);
    }, 0);
  }

  function getSmokingBudgetTarget(monthKey = currentMonth) {
    if (monthKey >= PRIVATE_HOUSEHOLD_ONLY_START_MONTH) return 0;
    const manualTarget = getSmokingTargetOverride(monthKey);
    if (manualTarget != null) return manualTarget;
    return getSmokingBudgetPosts().reduce((sum, post) => {
      if (!isDue(post, monthKey)) return sum;
      return sum + Number(getEffectiveAmountForMonth(post, monthKey) || 0);
    }, 0);
  }

  function syncSmokingBudgetTarget(monthKey = currentMonth) {
    if (!isMonthKey(monthKey) || monthKey >= PRIVATE_HOUSEHOLD_ONLY_START_MONTH) return false;
    const posts = getSmokingBudgetPosts().filter((post) => isDue(post, monthKey));
    if (!posts.length) return false;
    const manualTarget = getSmokingTargetOverride(monthKey);
    const target = manualTarget != null ? manualTarget : getSmokingBudgetBaseTarget(monthKey);
    const allocations = splitExactAmount(target, posts.map((post) => ({
      id: post.id,
      weight: Number(getEffectiveBaseAmountForMonth(post, monthKey) || post.amount || 0) || 1
    })));
    let changed = false;
    posts.forEach((post) => {
      if (isPostPaidForMonth(post, monthKey)) return;
      const amount = Number(allocations[post.id] || 0);
      setPostAmountForMonth(post, monthKey, amount, 'once');
      changed = true;
    });
    return changed;
  }

  function normalizeSmokingExpense(expense) {
    if (!expense || typeof expense !== 'object') return null;
    const amount = parseMoneyInput(expense.amount || 0);
    if (!Number.isFinite(amount) || !(amount > 0)) return null;
    const date = typeof expense.date === 'string' ? expense.date : '';
    const month = isMonthKey(expense.month) ? expense.month : getMonthKeyFromDateValue(date, dateToMonthKey(new Date()));
    return {
      id: typeof expense.id === 'string' && expense.id ? expense.id : generateId(),
      month,
      date,
      name: typeof expense.name === 'string' && expense.name.trim() ? expense.name.trim() : 'Rauchzeug',
      amount,
      note: typeof expense.note === 'string' ? expense.note : ''
    };
  }

  function normalizeSmokingExpenses() {
    if (!Array.isArray(state.smokingExpenses)) state.smokingExpenses = [];
    state.smokingExpenses = state.smokingExpenses
      .map(normalizeSmokingExpense)
      .filter(Boolean)
      .sort((a, b) => String(b.date || b.month).localeCompare(String(a.date || a.month)));
  }

  function getSmokingExpenses() {
    normalizeSmokingExpenses();
    return state.smokingExpenses;
  }

  function upsertSmokingExpense(expense) {
    const normalized = normalizeSmokingExpense(expense);
    if (!normalized) return null;
    state.smokingExpenses = getSmokingExpenses().filter((entry) => entry.id !== normalized.id);
    state.smokingExpenses.push(normalized);
    normalizeSmokingExpenses();
    return normalized;
  }

  function deleteSmokingExpense(expenseId) {
    state.smokingExpenses = getSmokingExpenses().filter((entry) => entry.id !== expenseId);
  }

  function getSmokingMonthlyTotals() {
    const totals = new Map();
    getSmokingExpenses().forEach((expense) => {
      const row = totals.get(expense.month) || { month: expense.month, amount: 0, count: 0 };
      row.amount += Number(expense.amount || 0);
      row.count += 1;
      totals.set(expense.month, row);
    });
    return Array.from(totals.values()).sort((a, b) => b.month.localeCompare(a.month));
  }

  function getSelfEmploymentIncomeCategories() {
    return [
      'UmsatzerlÃ¶se',
      'Sonstige betriebliche Einnahmen',
      'Umsatzsteuer-Erstattung',
      'Private Nutzung / Entnahme'
    ];
  }

  function getSelfEmploymentExpenseCategories() {
    return [
      'Wareneinkauf / Material',
      'Fremdleistungen',
      'Raumkosten',
      'Telefon / Internet',
      'BÃ¼robedarf / Software',
      'Porto / Versand',
      'Werbung',
      'Fortbildung',
      'Reisekosten',
      'Fahrtkosten / Kfz',
      'Versicherungen / BeitrÃ¤ge',
      'Rechts- / Steuerberatung',
      'Abschreibung / GWG',
      'Umsatzsteuer-Zahlung',
      'Sonstige Betriebsausgaben'
    ];
  }

  function getSelfEmploymentTaxModeLabel(mode) {
    return mode === 'vat_registered'
      ? 'Umsatzsteuerpflichtig'
      : 'Kleinunternehmer / BetrÃ¤ge ohne Umsatzsteuer-Aufteilung';
  }

  function normalizeSelfEmploymentPaymentMethod(value) {
    return value === 'cash' || value === 'direct_debit' ? value : 'transfer';
  }

  function getSelfEmploymentPaymentMethodLabel(value) {
    const method = normalizeSelfEmploymentPaymentMethod(value);
    return method === 'cash' ? 'Bar' : (method === 'direct_debit' ? 'Lastschrift' : 'Ãœberweisung');
  }

  function normalizeTaskrabbitBreakdown(value, fallbackAmount = 0) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {
      wage: roundMoney(Math.max(0, parseMoneyInput(source.wage || 0) || 0)),
      material: roundMoney(Math.max(0, parseMoneyInput(source.material || 0) || 0)),
      tip: roundMoney(Math.max(0, parseMoneyInput(source.tip || 0) || 0))
    };
    if (!(result.wage + result.material + result.tip > 0) && Number(fallbackAmount || 0) > 0) {
      result.wage = roundMoney(Number(fallbackAmount));
    }
    return result;
  }

  function getTaskrabbitBreakdownTotal(value) {
    const breakdown = normalizeTaskrabbitBreakdown(value);
    return roundMoney(breakdown.wage + breakdown.material + breakdown.tip);
  }

  function getTaskrabbitBreakdownLabel(value) {
    const breakdown = normalizeTaskrabbitBreakdown(value);
    return `Lohn ${euro(breakdown.wage)} Â· Material ${euro(breakdown.material)} Â· Trinkgeld ${euro(breakdown.tip)}`;
  }

  function normalizeSelfEmploymentEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const type = entry.type === 'expense' ? 'expense' : 'income';
    const legacyIncomeText = `${entry.description || ''} ${entry.category || ''}`;
    const legacyTaskrabbitIncome = type === 'income'
      && !Object.prototype.hasOwnProperty.call(entry, 'incomeSource')
      && /task\s*rabb?it|(^|\s)(auftrag|material|trinkgeld)(\s|$)/i.test(legacyIncomeText);
    const incomeSource = type === 'income' && (entry.incomeSource === 'taskrabbit' || legacyTaskrabbitIncome)
      ? 'taskrabbit'
      : 'other';
    const rawAmount = parseMoneyInput(entry.amount || entry.amountGross || 0);
    const legacyTaskrabbitBreakdown = legacyTaskrabbitIncome && !(entry.taskrabbitBreakdown && typeof entry.taskrabbitBreakdown === 'object')
      ? (/trinkgeld/i.test(legacyIncomeText)
        ? { wage: 0, material: 0, tip: rawAmount }
        : /material/i.test(legacyIncomeText)
          ? { wage: 0, material: rawAmount, tip: 0 }
          : { wage: rawAmount, material: 0, tip: 0 })
      : entry.taskrabbitBreakdown;
    const taskrabbitBreakdown = normalizeTaskrabbitBreakdown(legacyTaskrabbitBreakdown, rawAmount);
    const amount = incomeSource === 'taskrabbit' ? getTaskrabbitBreakdownTotal(taskrabbitBreakdown) : rawAmount;
    if (!Number.isFinite(amount) || !(amount > 0)) return null;
    const categories = type === 'expense' ? getSelfEmploymentExpenseCategories() : getSelfEmploymentIncomeCategories();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || ''))
      ? String(entry.date)
      : `${dateToMonthKey(new Date())}-01`;
    const rawVatRate = Number(entry.vatRate || 0);
    const vatRate = [0, 7, 19].includes(rawVatRate) ? rawVatRate : 0;
    return {
      id: typeof entry.id === 'string' && entry.id ? entry.id : generateId(),
      date,
      type,
      description: typeof entry.description === 'string' && entry.description.trim()
        ? entry.description.trim()
        : (type === 'income' ? 'Betriebseinnahme' : 'Betriebsausgabe'),
      category: incomeSource === 'taskrabbit'
        ? 'UmsatzerlÃ¶se'
        : (typeof entry.category === 'string' && entry.category.trim()
          ? entry.category.trim()
          : categories[0]),
      amount: roundMoney(amount),
      vatRate,
      paymentMethod: normalizeSelfEmploymentPaymentMethod(entry.paymentMethod),
      incomeSource,
      taskrabbitBreakdown: incomeSource === 'taskrabbit'
        ? taskrabbitBreakdown
        : { wage: 0, material: 0, tip: 0 },
      documentNumber: typeof entry.documentNumber === 'string' ? entry.documentNumber.trim() : '',
      note: typeof entry.note === 'string' ? entry.note.trim() : '',
      budgetMode: type === 'income'
        ? 'auto_count'
        : (normalizeSelfEmploymentPaymentMethod(entry.paymentMethod) === 'cash'
          ? 'cash_excluded'
          : (entry.budgetMode === 'auto_count' ? 'auto_count' : 'already_counted')),
      recurringTemplateId: typeof entry.recurringTemplateId === 'string' ? entry.recurringTemplateId : '',
      recurringMonth: isMonthKey(entry.recurringMonth) ? entry.recurringMonth : '',
      linkedBufferExpenseId: type === 'expense' && typeof entry.linkedBufferExpenseId === 'string'
        ? entry.linkedBufferExpenseId
        : ''
    };
  }

  function normalizeSelfEmploymentRecurringExpense(template) {
    if (!template || typeof template !== 'object') return null;
    const amount = parseMoneyInput(template.amount || 0);
    if (!Number.isFinite(amount) || !(amount > 0)) return null;
    const startMonth = isMonthKey(template.startMonth) ? template.startMonth : DEFAULT_TRANSACTION_MONTH;
    const endMonth = isMonthKey(template.endMonth) && template.endMonth >= startMonth ? template.endMonth : '';
    const intervalMonths = [1, 3, 12].includes(Number(template.intervalMonths))
      ? Number(template.intervalMonths)
      : 1;
    const rawVatRate = Number(template.vatRate || 0);
    const vatRate = [0, 7, 19].includes(rawVatRate) ? rawVatRate : 0;
    const paymentDay = Math.min(28, Math.max(1, Math.round(Number(template.paymentDay || 1))));
    return {
      id: typeof template.id === 'string' && template.id ? template.id : generateId(),
      name: typeof template.name === 'string' && template.name.trim() ? template.name.trim() : 'Wiederkehrende Betriebsausgabe',
      category: typeof template.category === 'string' && template.category.trim()
        ? template.category.trim()
        : getSelfEmploymentExpenseCategories()[0],
      amount: roundMoney(amount),
      intervalMonths,
      startMonth,
      endMonth,
      paymentDay,
      vatRate,
      paymentMethod: normalizeSelfEmploymentPaymentMethod(template.paymentMethod),
      note: typeof template.note === 'string' ? template.note.trim() : '',
      includeInPersonalBudget: template.includeInPersonalBudget !== false,
      personalCostId: typeof template.personalCostId === 'string' ? template.personalCostId : ''
    };
  }

  function normalizeSelfEmployment() {
    if (!state.selfEmployment || typeof state.selfEmployment !== 'object') {
      state.selfEmployment = JSON.parse(JSON.stringify(defaultState.selfEmployment));
    }
    if (typeof state.selfEmployment.businessName !== 'string') state.selfEmployment.businessName = '';
    if (!['small_business', 'vat_registered'].includes(state.selfEmployment.taxMode)) {
      state.selfEmployment.taxMode = 'small_business';
    }
    if (!Array.isArray(state.selfEmployment.entries)) state.selfEmployment.entries = [];
    state.selfEmployment.entries = state.selfEmployment.entries
      .map(normalizeSelfEmploymentEntry)
      .filter(Boolean)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
    state.selfEmployment.entries.forEach((entry) => {
      if (entry.type !== 'expense') return;
      if (normalizeSelfEmploymentPaymentMethod(entry.paymentMethod) === 'cash') {
        removeSelfEmploymentBufferExpenseLink(entry);
        entry.budgetMode = 'cash_excluded';
        return;
      }
      const linkedPost = getSelfEmploymentLinkedBufferExpense(entry);
      if (linkedPost) {
        entry.linkedBufferExpenseId = linkedPost.id;
        entry.budgetMode = 'already_counted';
      } else if (entry.linkedBufferExpenseId) {
        entry.linkedBufferExpenseId = '';
        entry.budgetMode = 'auto_count';
      }
    });
    if (!Array.isArray(state.selfEmployment.recurringExpenses)) state.selfEmployment.recurringExpenses = [];
    state.selfEmployment.recurringExpenses = state.selfEmployment.recurringExpenses
      .map(normalizeSelfEmploymentRecurringExpense)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
    state.selfEmployment.recurringExpenses.forEach((template) => {
      if (normalizeSelfEmploymentPaymentMethod(template.paymentMethod) !== 'cash') return;
      template.includeInPersonalBudget = false;
      disableSelfEmploymentPersonalBudgetLink(template, true);
    });
    return state.selfEmployment;
  }

  function getSelfEmploymentRecurringExpenses() {
    return normalizeSelfEmployment().recurringExpenses;
  }

  function getSelfEmploymentRecurringIntervalLabel(template) {
    const interval = Number(template && template.intervalMonths || 1);
    if (interval === 3) return 'vierteljÃ¤hrlich';
    if (interval === 12) return 'jÃ¤hrlich';
    return 'monatlich';
  }

  function isSelfEmploymentRecurringDue(template, monthKey) {
    if (!template || !isMonthKey(monthKey) || !isMonthKey(template.startMonth)) return false;
    if (monthKey < template.startMonth || (template.endMonth && monthKey > template.endMonth)) return false;
    const distance = monthDiff(template.startMonth, monthKey);
    return distance >= 0 && distance % Number(template.intervalMonths || 1) === 0;
  }

  function getNextSelfEmploymentRecurringMonth(template, fromMonth = currentMonth) {
    if (!template || !isMonthKey(template.startMonth) || !isMonthKey(fromMonth)) return '';
    const interval = Number(template.intervalMonths || 1);
    const distance = monthDiff(template.startMonth, fromMonth);
    const steps = distance <= 0 ? 0 : Math.ceil(distance / interval);
    const nextDue = addMonths(template.startMonth, steps * interval);
    return template.endMonth && nextDue > template.endMonth ? '' : nextDue;
  }

  function getSelfEmploymentRecurringBooking(templateId, monthKey) {
    return getSelfEmploymentEntries().find((entry) => entry.recurringTemplateId === templateId && entry.recurringMonth === monthKey) || null;
  }

  function getBennyForSelfEmploymentBudget() {
    return (state.persons || []).find((person) => normalizeTextKey(person && person.name) === 'benny')
      || (state.persons || []).find((person) => String(person && person.id || '').toLowerCase() === 'benny')
      || (state.persons || [])[0]
      || null;
  }

  function getSelfEmploymentLinkedPersonalCost(template) {
    if (!template) return null;
    if (template.personalCostId) {
      const exact = (state.personalCosts || []).find((post) => post && post.id === template.personalCostId);
      if (exact) return exact;
    }
    return (state.personalCosts || []).find((post) => post
      && post.selfEmploymentRecurringTemplateId === template.id
      && (!post.endMonth || post.endMonth >= currentMonth)) || null;
  }

  function disableSelfEmploymentPersonalBudgetLink(template, removeEntirely = false) {
    const post = getSelfEmploymentLinkedPersonalCost(template);
    if (!post) {
      template.personalCostId = '';
      return;
    }
    if (removeEntirely) {
      state.personalCosts = state.personalCosts.filter((item) => item.id !== post.id);
      template.personalCostId = '';
      return;
    }
    const previousMonth = addMonths(currentMonth, -1);
    const hasHistory = Array.isArray(post.paidMonths) && post.paidMonths.length > 0;
    if (!hasHistory && post.startMonth >= currentMonth) {
      state.personalCosts = state.personalCosts.filter((item) => item.id !== post.id);
    } else if (!post.endMonth || post.endMonth >= currentMonth) {
      post.endMonth = previousMonth >= post.startMonth ? previousMonth : post.startMonth;
    }
    template.personalCostId = '';
  }

  function syncSelfEmploymentPersonalBudgetLink(template) {
    if (!template) return null;
    if (normalizeSelfEmploymentPaymentMethod(template.paymentMethod) === 'cash') {
      template.includeInPersonalBudget = false;
      disableSelfEmploymentPersonalBudgetLink(template, true);
      return null;
    }
    if (!template.includeInPersonalBudget) {
      disableSelfEmploymentPersonalBudgetLink(template);
      return null;
    }
    const person = getBennyForSelfEmploymentBudget();
    if (!person) return null;
    let post = getSelfEmploymentLinkedPersonalCost(template);
    if (post && post.endMonth && post.endMonth < currentMonth) post = null;
    if (!post) {
      post = {
        id: generateId(),
        personId: person.id,
        name: `Betrieblich: ${template.name}`,
        amount: template.amount,
        interval: template.intervalMonths,
        startMonth: template.startMonth,
        endMonth: template.endMonth,
        oneTime: false,
        paidMonths: [],
        accountBalanceDebits: {},
        amountTimeline: [],
        amountOverrides: {},
        linkedDebtId: '',
        linkedSavingsGoalId: '',
        accountId: '',
        paidWithIncome: false,
        incomePaidMonths: [],
        selfEmploymentRecurringTemplateId: template.id
      };
      state.personalCosts.push(post);
    } else {
      post.personId = person.id;
      post.name = `Betrieblich: ${template.name}`;
      post.amount = template.amount;
      post.interval = template.intervalMonths;
      post.startMonth = template.startMonth;
      post.endMonth = template.endMonth;
      post.oneTime = false;
      post.selfEmploymentRecurringTemplateId = template.id;
      if (Array.isArray(post.amountTimeline)) post.amountTimeline = [];
      if (post.amountOverrides && typeof post.amountOverrides === 'object') post.amountOverrides = {};
    }
    ensurePostConfig(post);
    template.personalCostId = post.id;
    return post;
  }

  function upsertSelfEmploymentRecurringExpense(template) {
    const cfg = normalizeSelfEmployment();
    const previous = cfg.recurringExpenses.find((item) => item.id === template.id) || null;
    const normalized = normalizeSelfEmploymentRecurringExpense(template);
    if (!normalized) return null;
    if (normalizeSelfEmploymentPaymentMethod(normalized.paymentMethod) === 'cash') {
      normalized.includeInPersonalBudget = false;
    }
    if (previous && previous.personalCostId && !normalized.personalCostId) normalized.personalCostId = previous.personalCostId;
    cfg.recurringExpenses = cfg.recurringExpenses.filter((item) => item.id !== normalized.id);
    cfg.recurringExpenses.push(normalized);
    syncSelfEmploymentPersonalBudgetLink(normalized);
    normalizeSelfEmployment();
    return cfg.recurringExpenses.find((item) => item.id === normalized.id) || normalized;
  }

  function deleteSelfEmploymentRecurringExpense(templateId) {
    const cfg = normalizeSelfEmployment();
    const template = cfg.recurringExpenses.find((item) => item.id === templateId);
    if (!template) return false;
    template.includeInPersonalBudget = false;
    disableSelfEmploymentPersonalBudgetLink(template);
    cfg.recurringExpenses = cfg.recurringExpenses.filter((item) => item.id !== templateId);
    return true;
  }

  function bookSelfEmploymentRecurringExpense(template, monthKey) {
    if (!isSelfEmploymentRecurringDue(template, monthKey)) return null;
    const existing = getSelfEmploymentRecurringBooking(template.id, monthKey);
    if (existing) return existing;
    const saved = upsertSelfEmploymentEntry({
      id: generateId(),
      date: `${monthKey}-${String(template.paymentDay || 1).padStart(2, '0')}`,
      type: 'expense',
      description: template.name,
      category: template.category,
      amount: template.amount,
      vatRate: normalizeSelfEmployment().taxMode === 'vat_registered' ? template.vatRate : 0,
      paymentMethod: template.paymentMethod,
      documentNumber: '',
      note: template.note,
      budgetMode: template.includeInPersonalBudget ? 'already_counted' : 'auto_count',
      recurringTemplateId: template.id,
      recurringMonth: monthKey
    });
    const personalPost = getSelfEmploymentLinkedPersonalCost(template);
    if (saved && template.includeInPersonalBudget && personalPost && isDue(personalPost, monthKey)) {
      setPostPaidForMonth(personalPost, monthKey, true);
    }
    return saved;
  }

  function getSelfEmploymentEntries(year = '') {
    const cfg = normalizeSelfEmployment();
    const yearKey = String(year || '');
    return cfg.entries.filter((entry) => !yearKey || entry.date.startsWith(`${yearKey}-`));
  }

  function getSelfEmploymentEntryBreakdown(entry) {
    const cfg = normalizeSelfEmployment();
    const gross = roundMoney(Math.max(0, Number(entry && entry.amount || 0)));
    const vatRate = cfg.taxMode === 'vat_registered' ? Number(entry && entry.vatRate || 0) : 0;
    const net = vatRate > 0 ? roundMoney(gross / (1 + vatRate / 100)) : gross;
    return { gross, net, vat: roundMoney(gross - net), vatRate };
  }

  function getSelfEmploymentReportEntries(year) {
    const entries = getSelfEmploymentEntries(year);
    const taskrabbitEntries = entries.filter((entry) => entry.type === 'income' && entry.incomeSource === 'taskrabbit');
    const reportEntries = entries.filter((entry) => !(entry.type === 'income' && entry.incomeSource === 'taskrabbit'));
    if (!taskrabbitEntries.length) return reportEntries;

    const taskrabbitBreakdown = taskrabbitEntries.reduce((totals, entry) => {
      const breakdown = normalizeTaskrabbitBreakdown(entry.taskrabbitBreakdown, entry.amount);
      totals.wage += breakdown.wage;
      totals.material += breakdown.material;
      totals.tip += breakdown.tip;
      return totals;
    }, { wage: 0, material: 0, tip: 0 });
    Object.keys(taskrabbitBreakdown).forEach((key) => {
      taskrabbitBreakdown[key] = roundMoney(taskrabbitBreakdown[key]);
    });
    const reportBreakdown = taskrabbitEntries.reduce((totals, entry) => {
      const amount = getSelfEmploymentEntryBreakdown(entry);
      totals.gross += amount.gross;
      totals.net += amount.net;
      totals.vat += amount.vat;
      return totals;
    }, { gross: 0, net: 0, vat: 0, vatRate: 0 });
    ['gross', 'net', 'vat'].forEach((key) => {
      reportBreakdown[key] = roundMoney(reportBreakdown[key]);
    });
    const paymentMethods = new Set(taskrabbitEntries.map((entry) => normalizeSelfEmploymentPaymentMethod(entry.paymentMethod)));
    reportEntries.unshift({
      id: `taskrabbit-annual-${year}`,
      date: `${year}-12-31`,
      reportYear: String(year),
      type: 'income',
      category: 'UmsatzerlÃ¶se',
      description: `Taskrabbit-Einnahmen ${year}`,
      documentNumber: `${taskrabbitEntries.length} Auszahlung${taskrabbitEntries.length === 1 ? '' : 'en'}`,
      note: getTaskrabbitBreakdownLabel(taskrabbitBreakdown),
      amount: reportBreakdown.gross,
      vatRate: 0,
      paymentMethod: paymentMethods.size === 1 ? Array.from(paymentMethods)[0] : 'mixed',
      incomeSource: 'taskrabbit',
      taskrabbitBreakdown,
      reportBreakdown,
      isTaskrabbitAnnualBundle: true,
      sourceEntries: taskrabbitEntries
    });
    return reportEntries;
  }

  function getSelfEmploymentReportEntryBreakdown(entry) {
    return entry && entry.reportBreakdown ? entry.reportBreakdown : getSelfEmploymentEntryBreakdown(entry);
  }

  function getSelfEmploymentReportDateLabel(entry) {
    return entry && entry.isTaskrabbitAnnualBundle
      ? `Jahr ${entry.reportYear}`
      : formatSelfEmploymentDate(entry && entry.date);
  }

  function getSelfEmploymentReportPaymentMethodLabel(entry) {
    if (entry && entry.paymentMethod === 'mixed') return 'Gemischt';
    return getSelfEmploymentPaymentMethodLabel(entry && entry.paymentMethod);
  }

  function getSelfEmploymentSummary(year) {
    const entries = getSelfEmploymentEntries(year);
    const summary = {
      entries,
      incomeGross: 0,
      expenseGross: 0,
      incomeNet: 0,
      expenseNet: 0,
      collectedVat: 0,
      inputVat: 0,
      result: 0,
      months: new Map(),
      categories: new Map()
    };
    entries.forEach((entry) => {
      const amount = getSelfEmploymentEntryBreakdown(entry);
      const sign = entry.type === 'income' ? 1 : -1;
      if (entry.type === 'income') {
        summary.incomeGross += amount.gross;
        summary.incomeNet += amount.net;
        summary.collectedVat += amount.vat;
      } else {
        summary.expenseGross += amount.gross;
        summary.expenseNet += amount.net;
        summary.inputVat += amount.vat;
      }
      const month = entry.date.slice(0, 7);
      const monthRow = summary.months.get(month) || { month, income: 0, expense: 0, result: 0 };
      if (entry.type === 'income') monthRow.income += amount.gross;
      else monthRow.expense += amount.gross;
      monthRow.result += sign * amount.gross;
      summary.months.set(month, monthRow);
      const categoryKey = `${entry.type}:${entry.category}`;
      const categoryRow = summary.categories.get(categoryKey) || { type: entry.type, category: entry.category, amount: 0 };
      categoryRow.amount += amount.gross;
      summary.categories.set(categoryKey, categoryRow);
    });
    ['incomeGross', 'expenseGross', 'incomeNet', 'expenseNet', 'collectedVat', 'inputVat'].forEach((key) => {
      summary[key] = roundMoney(summary[key]);
    });
    summary.result = roundMoney(summary.incomeGross - summary.expenseGross);
    summary.months = Array.from(summary.months.values()).sort((a, b) => a.month.localeCompare(b.month));
    summary.categories = Array.from(summary.categories.values()).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'income' ? -1 : 1;
      return b.amount - a.amount || a.category.localeCompare(b.category, 'de');
    });
    summary.reportEntries = getSelfEmploymentReportEntries(year);
    summary.taskrabbitEntries = entries.filter((entry) => entry.type === 'income' && entry.incomeSource === 'taskrabbit');
    return summary;
  }

  function getSelfEmploymentLinkedBufferExpense(entry) {
    if (!entry || !Array.isArray(state.bufferExpenses)) return null;
    if (entry.linkedBufferExpenseId) {
      const exact = state.bufferExpenses.find((post) => post && post.id === entry.linkedBufferExpenseId);
      if (exact) return exact;
    }
    return state.bufferExpenses.find((post) => post && post.selfEmploymentEntryId === entry.id) || null;
  }

  function getSelfEmploymentEntryForBufferExpense(post) {
    if (!post || !post.selfEmploymentEntryId) return null;
    return getSelfEmploymentEntries().find((entry) => entry.id === post.selfEmploymentEntryId) || null;
  }

  function removeSelfEmploymentBufferExpenseLink(entry) {
    if (!entry) return false;
    const linkedPost = getSelfEmploymentLinkedBufferExpense(entry);
    if (linkedPost) state.bufferExpenses = (state.bufferExpenses || []).filter((post) => post.id !== linkedPost.id);
    entry.linkedBufferExpenseId = '';
    return !!linkedPost;
  }

  function syncSelfEmploymentBufferExpense(entry) {
    if (!entry || entry.type !== 'expense') return null;
    if (normalizeSelfEmploymentPaymentMethod(entry.paymentMethod) === 'cash') {
      removeSelfEmploymentBufferExpenseLink(entry);
      entry.budgetMode = 'cash_excluded';
      return null;
    }
    if (!Array.isArray(state.bufferExpenses)) state.bufferExpenses = [];
    const monthKey = String(entry.date || '').slice(0, 7);
    if (!isMonthKey(monthKey)) return null;
    let post = getSelfEmploymentLinkedBufferExpense(entry);
    if (!post) {
      post = {
        id: generateId(),
        name: '',
        amount: 0,
        interval: 1,
        startMonth: monthKey,
        endMonth: monthKey,
        oneTime: true,
        paidMonths: [],
        accountBalanceDebits: {},
        amountTimeline: [],
        amountOverrides: {},
        linkedDebtId: '',
        linkedSavingsGoalId: '',
        accountId: '',
        bookingType: 'expense',
        transferToAccountId: '',
        selfEmploymentEntryId: entry.id
      };
      state.bufferExpenses.push(post);
    }
    post.name = `Betrieblich: ${entry.description}`;
    post.amount = roundMoney(entry.amount);
    post.interval = 1;
    post.startMonth = monthKey;
    post.endMonth = monthKey;
    post.oneTime = true;
    post.paidMonths = [monthKey];
    post.amountTimeline = [];
    post.amountOverrides = {};
    post.linkedDebtId = '';
    post.linkedSavingsGoalId = '';
    post.selfEmploymentEntryId = entry.id;
    post.paymentMethod = normalizeSelfEmploymentPaymentMethod(entry.paymentMethod);
    ensurePostConfig(post);
    entry.linkedBufferExpenseId = post.id;
    entry.budgetMode = 'already_counted';
    return post;
  }

  function detachSelfEmploymentBufferExpense(post) {
    const entry = getSelfEmploymentEntryForBufferExpense(post);
    if (entry) {
      entry.linkedBufferExpenseId = '';
      entry.budgetMode = normalizeSelfEmploymentPaymentMethod(entry.paymentMethod) === 'cash'
        ? 'cash_excluded'
        : 'auto_count';
    }
    state.bufferExpenses = (state.bufferExpenses || []).filter((item) => item.id !== post.id);
    return entry;
  }

  function upsertSelfEmploymentEntry(entry, options = {}) {
    const cfg = normalizeSelfEmployment();
    const previous = cfg.entries.find((item) => item.id === entry.id) || null;
    const normalized = normalizeSelfEmploymentEntry(entry);
    if (!normalized) return null;
    const isCashPayment = normalizeSelfEmploymentPaymentMethod(normalized.paymentMethod) === 'cash';
    const householdMode = isCashPayment
      ? 'cash_excluded'
      : options.householdMode === 'buffer'
      ? 'buffer'
      : options.householdMode === 'auto_count' || (!options.householdMode && entry.budgetMode === 'auto_count')
        ? 'auto_count'
        : 'already_counted';
    if (previous && (normalized.type !== 'expense' || householdMode !== 'buffer')) {
      removeSelfEmploymentBufferExpenseLink(previous);
    }
    normalized.linkedBufferExpenseId = householdMode === 'buffer'
      ? String((previous && previous.linkedBufferExpenseId) || normalized.linkedBufferExpenseId || '')
      : '';
    if (normalized.type === 'expense') {
      normalized.budgetMode = householdMode === 'cash_excluded'
        ? 'cash_excluded'
        : (householdMode === 'auto_count' ? 'auto_count' : 'already_counted');
    }
    else normalized.linkedBufferExpenseId = '';
    cfg.entries = cfg.entries.filter((item) => item.id !== normalized.id);
    cfg.entries.push(normalized);
    if (normalized.type === 'expense' && householdMode === 'buffer') syncSelfEmploymentBufferExpense(normalized);
    normalizeSelfEmployment();
    return cfg.entries.find((item) => item.id === normalized.id) || normalized;
  }

  function deleteSelfEmploymentEntry(entryId) {
    const cfg = normalizeSelfEmployment();
    const entry = cfg.entries.find((item) => item.id === entryId);
    if (entry) removeSelfEmploymentBufferExpenseLink(entry);
    const before = cfg.entries.length;
    cfg.entries = cfg.entries.filter((item) => item.id !== entryId);
    return cfg.entries.length !== before;
  }

  function getSelfEmploymentYears() {
    const years = new Set([String(new Date().getFullYear()), String(currentMonth || '').slice(0, 4)]);
    getSelfEmploymentEntries().forEach((entry) => years.add(entry.date.slice(0, 4)));
    return Array.from(years).filter((year) => /^\d{4}$/.test(year)).sort((a, b) => b.localeCompare(a));
  }

  function csvField(value) {
    const text = String(value == null ? '' : value);
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadTextFile(filename, content, type = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportSelfEmploymentCsv(year) {
    const cfg = normalizeSelfEmployment();
    const rows = [[
      'Datum', 'Art', 'Zahlungsart', 'Kategorie', 'Beschreibung', 'Belegnummer', 'Bruttobetrag',
      'USt-Satz', 'Nettobetrag', 'Umsatzsteuer', 'Notiz'
    ]];
    getSelfEmploymentReportEntries(year).slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((entry) => {
      const amount = getSelfEmploymentReportEntryBreakdown(entry);
      rows.push([
        getSelfEmploymentReportDateLabel(entry),
        entry.type === 'income' ? 'Einnahme' : 'Ausgabe',
        getSelfEmploymentReportPaymentMethodLabel(entry),
        entry.category,
        entry.description,
        entry.documentNumber,
        formatNumberInput(amount.gross),
        cfg.taxMode === 'vat_registered' ? `${amount.vatRate} %` : '0 %',
        formatNumberInput(amount.net),
        formatNumberInput(amount.vat),
        entry.note
      ]);
    });
    const csv = `\uFEFF${rows.map((row) => row.map(csvField).join(';')).join('\r\n')}`;
    downloadTextFile(`euer-buchungen-${year}.csv`, csv, 'text/csv;charset=utf-8');
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
    const manualTarget = getGroceryTargetOverride(monthKey);
    if (manualTarget != null) return manualTarget;
    if (isMonthKey(monthKey) && cfg && isMonthKey(cfg.targetStartMonth) && monthDiff(cfg.targetStartMonth, monthKey) >= 0) {
      return Math.max(0, Number(cfg.targetAmount || 500));
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

  function splitExactAmount(total, weightedItems) {
    const totalCents = Math.max(0, Math.round(Number(total || 0) * 100));
    const items = (weightedItems || []).filter((item) => item && item.id && Number(item.weight || 0) > 0);
    if (!items.length || totalCents <= 0) return {};
    const weightTotal = items.reduce((sum, item) => sum + Number(item.weight || 0), 0);
    const rows = items.map((item) => {
      const rawCents = totalCents * (Number(item.weight || 0) / weightTotal);
      const baseCents = Math.floor(rawCents);
      return { id: item.id, baseCents, remainder: rawCents - baseCents };
    });
    let centsLeft = totalCents - rows.reduce((sum, row) => sum + row.baseCents, 0);
    rows.sort((a, b) => b.remainder - a.remainder);
    let index = 0;
    while (centsLeft > 0 && rows.length) {
      rows[index % rows.length].baseCents += 1;
      centsLeft -= 1;
      index += 1;
    }
    const out = {};
    rows.forEach((row) => { out[row.id] = roundMoney(row.baseCents / 100); });
    return out;
  }

  function getIncomeWeightForPerson(personIdOrName, monthKey = currentMonth) {
    const sought = String(personIdOrName || '').toLowerCase();
    const soughtTankKey = sought.includes('madeleine') ? 'madeleine' : (sought.includes('benny') ? 'benny' : '');
    const person = (state.persons || []).find((entry) => {
      const id = String(entry && entry.id || '').toLowerCase();
      const name = String(entry && entry.name || '').toLowerCase();
      return id === sought || name === sought || (soughtTankKey && getTankCalcPersonKey(name) === soughtTankKey);
    });
    return person ? getIncomeShareBasis(person, monthKey) : 0;
  }

  function getPayrollDeductionForPerson(person, monthKey = currentMonth) {
    if (!person || !person.id || !isMonthKey(monthKey)) return 0;
    const amount = (state.personalCosts || []).reduce((sum, post) => {
      if (!post || post.personId !== person.id || post.paidWithIncome !== true || !isDue(post, monthKey)) return sum;
      return sum + Number(getEffectiveAmountForMonth(post, monthKey) || 0);
    }, 0);
    return roundMoney(Math.max(0, amount));
  }

  function getPersonCashPayout(person, monthKey = currentMonth) {
    if (!person) return 0;
    return roundMoney(Math.max(0, Number(getPersonNet(person, monthKey) || 0) - getPayrollDeductionForPerson(person, monthKey)));
  }

  function getIncomeShareBasis(person, monthKey = currentMonth, enteredIncome) {
    if (!person) return 0;
    const resolvedIncome = Number.isFinite(Number(enteredIncome))
      ? Number(enteredIncome)
      : Number(getPersonNet(person, monthKey) || 0);
    return roundMoney(Math.max(0, resolvedIncome - getPayrollDeductionForPerson(person, monthKey)));
  }

  function ensurePositiveAllocationWeights(items) {
    const rows = (items || []).map((item) => ({ ...item, weight: Math.max(0, Number(item.weight || 0)) }));
    if (rows.some((item) => item.weight > 0)) return rows;
    return rows.map((item) => ({ ...item, weight: 1 }));
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
      const manualTarget = getGroceryTargetOverride(monthKey);
      source = manualTarget != null
        ? `Manuelle Vorgabe fÃ¼r ${formatMonthLabel(monthKey)}`
        : 'Festes Monatsziel';
    }
    const balance = active && type !== 'groceries' ? getBudgetTopUpBalance(type, monthKey) : 0;
    const missing = Math.max(0, target - balance);
    const manualGroceryTarget = type === 'groceries' && getGroceryTargetOverride(monthKey) != null;
    const topUp = active
      ? (type === 'groceries'
        ? (manualGroceryTarget ? roundMoney(target) : roundUpToNextFifty(target))
        : roundUpToNextFive(missing))
      : target;
    return { type, month: monthKey, active, target, balance, missing, topUp, source };
  }

  function getFuelTopUpAllocation(monthKey = currentMonth) {
    const calc = calculateBudgetTopUp('fuel', monthKey);
    const allocations = splitRoundedToFive(calc.topUp, ensurePositiveAllocationWeights([
      { id: 'benny', weight: getIncomeWeightForPerson('benny', monthKey) },
      { id: 'madeleine', weight: getIncomeWeightForPerson('madeleine', monthKey) }
    ]));
    return { ...calc, allocations };
  }

  function getFuelTopUpPaidAmount(monthKey = currentMonth) {
    return roundMoney(['benny', 'madeleine'].reduce((sum, personKey) => {
      const post = getTankExpensePost(personKey);
      if (!post || !isPostPaidForMonth(post, monthKey)) return sum;
      return sum + Number(getEffectiveAmountForMonth(post, monthKey) || 0);
    }, 0));
  }

  function getFuelPoolLiveStatus(monthKey = currentMonth) {
    const calc = getFuelTopUpAllocation(monthKey);
    const receipts = getTankReceiptHouseholdStatsForMonth(monthKey);
    const openingBalance = roundMoney(Number(calc.balance || 0));
    const paidTopUp = getFuelTopUpPaidAmount(monthKey);
    const funded = roundMoney(openingBalance + paidTopUp);
    const spent = roundMoney(Number(receipts.netCost || 0));
    const currentBalance = roundMoney(Math.max(0, funded - spent));
    const shortage = roundMoney(Math.max(0, spent - funded));
    const pendingTopUp = roundMoney(Math.max(0, Number(calc.topUp || 0) - paidTopUp));
    return {
      ...calc,
      receipts,
      openingBalance,
      paidTopUp,
      funded,
      spent,
      currentBalance,
      shortage,
      pendingTopUp
    };
  }

  function syncFuelCarryoverFromMonth(monthKey) {
    if (!isMonthKey(monthKey)) return 0;
    const nextMonthKey = nextMonth(monthKey);
    const live = getFuelPoolLiveStatus(monthKey);
    setBudgetTopUpBalance(
      'fuel',
      nextMonthKey,
      live.currentBalance,
      `${AUTOMATIC_FUEL_CARRYOVER_NOTE_PREFIX}${formatMonthLabel(monthKey)}`
    );
    return live.currentBalance;
  }

  function clearAutomaticFuelCarryoverFromMonth(monthKey) {
    if (!isMonthKey(monthKey)) return false;
    const nextMonthKey = nextMonth(monthKey);
    const cfg = getBudgetTopUpConfig('fuel');
    const note = String(cfg.notes[nextMonthKey] || '');
    if (!note.startsWith(AUTOMATIC_FUEL_CARRYOVER_NOTE_PREFIX)) return false;
    delete cfg.balances[nextMonthKey];
    delete cfg.notes[nextMonthKey];
    return true;
  }

  function getGroceryTopUpAllocation(monthKey = currentMonth) {
    const calc = calculateBudgetTopUp('groceries', monthKey);
    const posts = getFoodMoneyPosts().filter((post) => isPostActiveInMonth(post, monthKey));
    const weightedPosts = ensurePositiveAllocationWeights(posts.map((post) => ({
      id: post.id,
      weight: getIncomeWeightForPerson(post.personId, monthKey)
    })));
    const allocations = splitRoundedToFive(calc.topUp, weightedPosts);
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
    clearAutomaticFuelCarryoverFromMonth(monthKey);
    syncAllTankgeldExpenses({ silent: true, monthKey: nextMonth(monthKey) });
    addChangeLog('Tankgeld', `${formatMonthLabel(monthKey)} nach Ã„nderung wieder zur PrÃ¼fung geÃ¶ffnet.`, monthKey);
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
      .filter((entry) => Number(entry.netCost || 0) > 0);
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
    return { priceUsed: manual.priceUsed, raw: manual.net, rounded: roundUpToNextFive(manual.net), source: 'Kilometer Ã— Verbrauch Ã— Preis', avgStats: { count: 0, realCount: 0, projectedCount: 12, basisMonths: 12, avgNet: manual.net }, share };
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
      paymentMethod: normalizeHouseholdPaymentMethod(receipt && receipt.paymentMethod),
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
    retußž}ëVòµë(š+myÝ½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´Õ¥‘•µÁ½ÍÐµ™½É´œì((€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•Õ¥‘•‘½Éµ%¹ÑÉ¼ (€€€€€•‘¥ÑA½ÍÐ€ü€M½¹ÍÑ¥”ÕÍ…‰”‰•…É‰•¥Ñ•¸œ€è€M½¹ÍÑ¥”ÕÍ…‰”…¹±••¸œ°(€€€€€ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ô¸]¥É¥´Í¥¡•É•¸™É•¥•¸	•ÑÉ…œÙ½ÉÍ½É±¥ ‰•Ëñ­Í¥¡Ñ¥ÐÕ¹‰•¥´	•é…¡±Ðµ5…É­¥•É•¸¹¥¡Ð‘½ÁÁ•±Ð•Í•¹­Ð¹€(€€€€¤¤ì((€€€½¹ÍÐ‰…Í•M•Ñ¥½¸€ôÉ•…Ñ•Õ¥‘•‘½ÉµM•Ñ¥½¸ œÄ¸]…ÌÝÕÉ‘”•Á±…¹Ðüœ°€ñÈÍÁ½¹Ñ…¹”½‘•È•¥¹µ…±¥”ÕÍ…‰•¸É•¥¡Ðµ•¥ÍÐ‘¥•Í”•ÉÍÑ”i•¥±”¸œ¤ì(€€€½¹ÍÐÉ½ÜÄ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÄ¹±…ÍÍ9…µ”€ô€É½ÜÕ¥‘•µÉ½Üœì(€€€É•™Ì¹¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹¹…µ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€É•™Ì¹¹…µ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸-±•¥‘Õ¹œ°•Í¡•¹¬°I•Á…É…ÑÕÈœì(€€€É•™Ì¹¹…µ•%¹ÁÕÐ¹Ù…±Õ”€ô•‘¥ÑA½ÍÐ€ü•‘¥ÑA½ÍÐ¹¹…µ”€è€œœì(€€€É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡•‘¥ÑA½ÍÐ€ü•Ñ™™•Ñ¥Ù•µ½Õ¹Ñ½É5½¹Ñ ¡•‘¥ÑA½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤€è€œœ¤ì(€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9…µ”œ°É•™Ì¹¹…µ•%¹ÁÕÐ¤¤ì(€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•ÑÉ…œ¥¸ƒŠ
°œ°É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€‰…Í•M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡É½ÜÄ¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡‰…Í•M•Ñ¥½¸¤ì(€€€…ÁÁ•¹‘µ½Õ¹Ñ¡…¹•5½‘•¥•±¡½¹Ñ•¹Ð°É•™Ì°•‘¥ÑA½ÍÐ¤ì((€€€½¹ÍÐÍ¡•‘Õ±•M•Ñ¥½¸€ôÉ•…Ñ•Õ¥‘•‘½ÉµM•Ñ¥½¸ œÈ¸i•¥ÑÉ…Õ´œ°€M½¹ÍÑ¥”ÕÍ…‰•¸Í¥¹ÍÑ…¹‘…É‘·“}¥œ•¥¹µ…±¥œ¸ñÈÝ¥•‘•É­•¡É•¹‘”ÕÍ…‰•¸­…¹¹ÍÐ‘ÔƒŠy±…Õ™•¹“Špß‘¡±•¸¸œ¤ì(€€€½¹ÍÐÉ½ÜÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÈ¹±…ÍÍ9…µ”€ô€É½ÜÕ¥‘•µÉ½Üœì(€€€É•™Ì¹ÑåÁ•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€É•™Ì¹ÑåÁ•M•±•Ð¹¥¹¹•É!Q50€ô€œñ½ÁÑ¥½¸Ù…±Õ”ô‰½¹”ˆù¥¹µ…±¥œð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ô‰É•ÕÉÉ¥¹œˆù1…Õ™•¹ð½½ÁÑ¥½¸øœì(€€€É•™Ì¹ÑåÁ•M•±•Ð¹Ù…±Õ”€ô•‘¥ÑA½ÍÐ€ü€¡¥Í=¹•Q¥µ•A½ÍÐ¡•‘¥ÑA½ÍÐ¤€ü€½¹”œ€è€É•ÕÉÉ¥¹œœ¤€è€½¹”œì(€€€É•™Ì¹¥¹Ñ•ÉÙ…±%¹ÁÕÐ€ôÉ•…Ñ•%¹Ñ•ÉÙ…±M•±•Ð¡•‘¥ÑA½ÍÐ€ü•‘¥ÑA½ÍÐ¹¥¹Ñ•ÉÙ…°€è€Ä¤ì(€€€É•™Ì¹ÍÑ…ÉÑ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹ÍÑ…ÉÑ%¹ÁÕÐ¹ÑåÁ”€ô€µ½¹Ñ œì(€€€É•™Ì¹ÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”€ô•‘¥ÑA½ÍÐ€ü•‘¥ÑA½ÍÐ¹ÍÑ…ÉÑ5½¹Ñ €èÕÉÉ•¹Ñ5½¹Ñ ì(€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i…¡±Õ¹Í…ÉÐœ°É•™Ì¹ÑåÁ•M•±•Ð¤¤ì(€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ I¡åÑ¡µÕÌœ°É•™Ì¹¥¹Ñ•ÉÙ…±%¹ÁÕÐ¤¤ì(€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ MÑ…ÉÑµ½¹…Ðœ°É•™Ì¹ÍÑ…ÉÑ%¹ÁÕÐ¤¤ì(€€€Í¡•‘Õ±•M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡É½ÜÈ¤ì((€€€½¹ÍÐÉ½ÜÌ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÌ¹±…ÍÍ9…µ”€ô€É½ÜÕ¥‘•µÉ½Üœì(€€€É•™Ì¹±¥µ¥ÑM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€É•™Ì¹±¥µ¥ÑM•±•Ð¹¥¹¹•É!Q50€ô€œñ½ÁÑ¥½¸Ù…±Õ”ô‰¹½¹”ˆùU¹‰•É•¹éÐð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ô‰Õ¹Ñ¥°ˆù	•™É¥ÍÑ•Ð‰¥Ìð½½ÁÑ¥½¸øœì(€€€É•™Ì¹±¥µ¥ÑM•±•Ð¹Ù…±Õ”€ô•‘¥ÑA½ÍÐ€˜˜€…¥Í=¹•Q¥µ•A½ÍÐ¡•‘¥ÑA½ÍÐ¤€˜˜•‘¥ÑA½ÍÐ¹•¹‘5½¹Ñ €ü€Õ¹Ñ¥°œ€è€¹½¹”œì(€€€É•™Ì¹•¹‘%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹•¹‘%¹ÁÕÐ¹ÑåÁ”€ô€µ½¹Ñ œì(€€€É•™Ì¹•¹‘%¹ÁÕÐ¹Ù…±Õ”€ô•‘¥ÑA½ÍÐ€˜˜€…¥Í=¹•Q¥µ•A½ÍÐ¡•‘¥ÑA½ÍÐ¤€˜˜•‘¥ÑA½ÍÐ¹•¹‘5½¹Ñ €ü•‘¥ÑA½ÍÐ¹•¹‘5½¹Ñ €è€œœì(€€€É½ÜÌ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 1…Õ™é•¥Ðœ°É•™Ì¹±¥µ¥ÑM•±•Ð¤¤ì(€€€É½ÜÌ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	¥Ì5½¹…Ðœ°É•™Ì¹•¹‘%¹ÁÕÐ¤¤ì(€€€Í¡•‘Õ±•M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡É½ÜÌ¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Í¡•‘Õ±•M•Ñ¥½¸¤ì(€€€½¹ÍÐÁ…åµ•¹ÑI½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Á…åµ•¹ÑI½Ü¹±…ÍÍ9…µ”€ô€É½ÜÕ¥‘•µÉ½Üœì(€€€…ÁÁ•¹‘!½ÕÍ•¡½±‘A…åµ•¹Ñ5•Ñ¡½‘¥•±¡Á…åµ•¹ÑI½Ü°É•™Ì°•‘¥ÑA½ÍÐ°ì‘•™…Õ±ÑY…±Õ”è€ÑÉ…¹Í™•Èœô¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Á…åµ•¹ÑI½Ü¤ì((€€€½¹ÍÐ±¥¹­M•Ñ¥½¸€ôÉ•…Ñ•Õ¥‘•‘½ÉµM•Ñ¥½¸ œÌ¸=ÁÑ¥½¹…°Ù•É­»ñÁ™•¸œ°€9ÕÈ»ÙÑ¥œ°Ý•¹¸‘¥•Í”ÕÍ…‰”éÔ•¥¹•ÈM¡Õ±•£ÙÉÐ¸œ¤ì(€€€½¹ÍÐÉ½ÜÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÐ¹±…ÍÍ9…µ”€ô€É½ÜÕ¥‘•µÉ½Üœì(€€€É•™Ì¹…½Õ¹ÑM•±•Ð€ôìÙ…±Õ”è€œœôì(€€€¥˜€¡=U9QM}9	1¤ì(€€€€€É•™Ì¹…½Õ¹ÑM•±•Ð€ôÉ•…Ñ•½Õ¹ÑM•±•Ð¡•‘¥ÑA½ÍÐ€ü•‘¥ÑA½ÍÐ¹…½Õ¹Ñ%€è•Ñ•™…Õ±Ñ½Õ¹Ñ%‘½É½¹Ñ•áÐ Á•ÉÍ½¹…°œ°€‰•¹¹äœ¤°ì¥¹±Õ‘•9½¹”èÑÉÕ”ô¤ì(€€€€€É½ÜÐ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i…¡±Õ¹Í­½¹Ñ¼œ°É•™Ì¹…½Õ¹ÑM•±•Ð¤¤ì(€€€€€±¥¹­M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡É½ÜÐ¤ì(€€€ô(€€€¥˜€¡=U9QM}9	1¤½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡±¥¹­M•Ñ¥½¸¤ì(€€€…ÁÁ•¹‘M…Ù¥¹Í½…±1¥¹­¥•±¡½¹Ñ•¹Ð°É•™Ì°•‘¥ÑA½ÍÐ¤ì(€€€…ÁÁ•¹‘QÉ…¹Í™•É	½½­¥¹¥•±‘Ì¡½¹Ñ•¹Ð°É•™Ì°•‘¥ÑA½ÍÐ¤ì((€€€½¹ÍÐÍå¹M¡•‘Õ±•%¹ÁÕÑÌ€ô€ ¤€ôøÑ½±•A½ÍÑ‘¥ÑM¡•‘Õ±•%¹ÁÕÑÌ (€€€€€É•™Ì¹ÑåÁ•M•±•Ð°(€€€€€É•™Ì¹¥¹Ñ•ÉÙ…±%¹ÁÕÐ°(€€€€€É•™Ì¹±¥µ¥ÑM•±•Ð°(€€€€€É•™Ì¹•¹‘%¹ÁÕÐ°(€€€€€É•™Ì¹ÍÑ…ÉÑ%¹ÁÕÐ(€€€€¤ì(€€€É•™Ì¹ÑåÁ•M•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°Íå¹M¡•‘Õ±•%¹ÁÕÑÌ¤ì(€€€É•™Ì¹±¥µ¥ÑM•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°Íå¹M¡•‘Õ±•%¹ÁÕÑÌ¤ì(€€€É•™Ì¹ÍÑ…ÉÑ%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°Íå¹M¡•‘Õ±•%¹ÁÕÑÌ¤ì(€€€Íå¹M¡•‘Õ±•%¹ÁÕÑÌ ¤ì((€€€Í¡½Ý5½‘…°¡•‘¥ÑA½ÍÐ€ü€M½¹ÍÑ¥”ÕÍ…‰”‰•…É‰•¥Ñ•¸œ€è€9•Õ”Í½¹ÍÑ¥”ÕÍ…‰”œ°½¹Ñ•¹Ð°l(€€€€€ì(€€€€€€€±…‰•°è€‰‰É•¡•¸œ°(€€€€€€€±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤(€€€€€ô°(€€€€€ì(€€€€€€€±…‰•°è•‘¥ÑA½ÍÐ€ü€MÁ•¥¡•É¸œ€è€¹±••¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ¹…µ”€ôÉ•™Ì¹¹…µ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€½¹ÍÐÍÑ…ÉÑ5½¹Ñ €ôÉ•™Ì¹ÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”ì(€€€€€€€€€¥˜€ …¹…µ”¤É•ÑÕÉ¸…±•ÉÐ 9…µ”‘…É˜¹¥¡Ð±••ÈÍ•¥¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸	•ÑÉ…œ•¥¹•‰•¸¸œ¤ì(€€€€€€€€€½¹ÍÐÍ¡•‘Õ±•Y…±¥‘…Ñ¥½¸€ôÙ…±¥‘…Ñ•M¡•‘Õ±•M•ÑÑ¥¹Ì¡ì(€€€€€€€€€€€½¹•Q¥µ”èÉ•™Ì¹ÑåÁ•M•±•Ð¹Ù…±Õ”€ôôô€½¹”œ°(€€€€€€€€€€€¥¹Ñ•ÉÙ…°èÉ•™Ì¹¥¹Ñ•ÉÙ…±%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€ÍÑ…ÉÑ5½¹Ñ °(€€€€€€€€€€€•¹‘5½¹Ñ èÉ•™Ì¹±¥µ¥ÑM•±•Ð¹Ù…±Õ”€ôôô€Õ¹Ñ¥°œ€üÉ•™Ì¹•¹‘%¹ÁÕÐ¹Ù…±Õ”€è€œœ(€€€€€€€€€ô¤ì(€€€€€€€€€¥˜€ …Í¡•‘Õ±•Y…±¥‘…Ñ¥½¸¹½¬¤É•ÑÕÉ¸…±•ÉÐ¡Í¡•‘Õ±•Y…±¥‘…Ñ¥½¸¹µ•ÍÍ…”¤ì((€€€€€€€€€¥˜€¡•‘¥ÑA½ÍÐ¤ì(€€€€€€€€€€€½¹ÍÐÁÉ•Ù¥½ÕÍµ½Õ¹Ð€ô•Ñ™™•Ñ¥Ù•µ½Õ¹Ñ½É5½¹Ñ ¡•‘¥ÑA½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€€€±•Ðµ½‘”€ô¹Õ±°ì(€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡ÁÉ•Ù¥½ÕÍµ½Õ¹Ð€´…µ½Õ¹Ð¤€ø€À¸ÀÀÀÀÀÄ¤ì(€€€€€€€€€€€€€µ½‘”€ô¥Í=¹•Q¥µ•A½ÍÐ¡•‘¥ÑA½ÍÐ¤ñðÍ¡•‘Õ±•Y…±¥‘…Ñ¥½¸¹Ù…±Õ”¹½¹•Q¥µ”(€€€€€€€€€€€€€€€€ü€™ÕÑÕÉ”œ(€€€€€€€€€€€€€€€€èÉ•™Ì¹…µ½Õ¹Ñ¡…¹•5½‘•M•±•Ð¹Ù…±Õ”ì(€€€€€€€€€€€ô(€€€€€€€€€€€•‘¥ÑA½ÍÐ¹¹…µ”€ô¹…µ”ì(€€€€€€€€€€€•‘¥ÑA½ÍÐ¹ÍÑ…ÉÑ5½¹Ñ €ôÍÑ…ÉÑ5½¹Ñ ì(€€€€€€€€€€€•‘¥ÑA½ÍÐ¹Á…åµ•¹Ñ5•Ñ¡½€ô¹½Éµ…±¥é•!½ÕÍ•¡½±‘A…åµ•¹Ñ5•Ñ¡½¡É•™Ì¹Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹Ù…±Õ”¤ì(€€€€€€€€€€€•‘¥ÑA½ÍÐ¹…½Õ¹Ñ%€ô=U9QM}9	1€ü€¡É•™Ì¹…½Õ¹ÑM•±•Ð¹Ù…±Õ”ñð€œœ¤€è€œœì(€€€€€€€€€€€¥˜€ ……ÁÁ±åQÉ…¹Í™•É	½½­¥¹¥•±‘ÍQ½A½ÍÐ¡•‘¥ÑA½ÍÐ°É•™Ì¤¤É•ÑÕÉ¸ì(€€€€€€€€€€€…ÁÁ±åM¡•‘Õ±•M•ÑÑ¥¹Ì¡•‘¥ÑA½ÍÐ°Í¡•‘Õ±•Y…±¥‘…Ñ¥½¸¹Ù…±Õ”¤ì(€€€€€€€€€€€¥˜€¡µ½‘”¤ì(€€€€€€€€€€€€€Í•ÑA½ÍÑµ½Õ¹Ñ½É5½¹Ñ ¡•‘¥ÑA½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ °…µ½Õ¹Ð°µ½‘”¤ì(€€€€€€€€€€€€€Íå¹1¥¹­•‘•‰ÑI…Ñ•É½µA½ÍÐ¡•‘¥ÑA½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ °µ½‘”¤ì(€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€Íå¹1¥¹­•‘•‰ÑI…Ñ•É½µA½ÍÐ¡•‘¥ÑA½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ °€™ÕÑÕÉ”œ¤ì(€€€€€€€€€€€ô(€€€€€€€€€€€¥˜€¡¥ÍA½ÍÑ	½½­•‘½É5½¹Ñ ¡•‘¥ÑA½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤¤…ÁÁ±åA½ÍÑ½Õ¹Ñ	½½­¥¹œ¡•‘¥ÑA½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ °ÑÉÕ”¤ì(€€€€€€€€€€€ÕÁ‘…Ñ•A½ÍÑM…Ù¥¹Í½…±1¥¹¬¡•‘¥ÑA½ÍÐ°É•™Ì¹Í…Ù¥¹Í½…±M•±•Ð¹Ù…±Õ”ñð€œœ°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€€€Íå¹ÁÁ±¥•‘A½ÍÑ½Õ¹Ñ	…±…¹•™Ñ•É‘¥Ð¡•‘¥ÑA½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ °ÁÉ•Ù¥½ÕÍµ½Õ¹Ð¤ì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€½¹ÍÐ¹•Ý	Õ™™•ÉA½ÍÐ€ôì(€€€€€€€€€€€€€¥è•¹•É…Ñ•% ¤°(€€€€€€€€€€€€€¹…µ”°(€€€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€€€¥¹Ñ•ÉÙ…°èÍ¡•‘Õ±•Y…±¥‘…Ñ¥½¸¹Ù…±Õ”¹¥¹Ñ•ÉÙ…°°(€€€€€€€€€€€€€ÍÑ…ÉÑ5½¹Ñ °(€€€€€€€€€€€€€•¹‘5½¹Ñ èÍ¡•‘Õ±•Y…±¥‘…Ñ¥½¸¹Ù…±Õ”¹•¹‘5½¹Ñ °(€€€€€€€€€€€€€½¹•Q¥µ”èÍ¡•‘Õ±•Y…±¥‘…Ñ¥½¸¹Ù…±Õ”¹½¹•Q¥µ”°(€€€€€€€€€€€€€Á…åµ•¹Ñ5•Ñ¡½è¹½Éµ…±¥é•!½ÕÍ•¡½±‘A…åµ•¹Ñ5•Ñ¡½¡É•™Ì¹Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹Ù…±Õ”¤°(€€€€€€€€€€€€€Á…¥‘5½¹Ñ¡Ìèmt°(€€€€€€€€€€€€€…½Õ¹Ñ	…±…¹••‰¥ÑÌèíô°(€€€€€€€€€€€€€±¥¹­•‘M…Ù¥¹Í½…±%èÉ•™Ì¹Í…Ù¥¹Í½…±M•±•Ð¹Ù…±Õ”ñð€œœ°(€€€€€€€€€€€€€…½Õ¹Ñ%è=U9QM}9	1€ü€¡É•™Ì¹…½Õ¹ÑM•±•Ð¹Ù…±Õ”ñð€œœ¤€è€œœ°(€€€€€€€€€€€€€‰½½­¥¹QåÁ”èÉ•™Ì¹‰½½­¥¹QåÁ•M•±•Ð€˜˜É•™Ì¹‰½½­¥¹QåÁ•M•±•Ð¹Ù…±Õ”€ôôô€ÑÉ…¹Í™•Èœ€ü€ÑÉ…¹Í™•Èœ€è€•áÁ•¹Í”œ°(€€€€€€€€€€€€€ÑÉ…¹Í™•ÉQ½½Õ¹Ñ%èÉ•™Ì¹ÑÉ…¹Í™•ÉQ½½Õ¹ÑM•±•Ð€ü€¡É•™Ì¹ÑÉ…¹Í™•ÉQ½½Õ¹ÑM•±•Ð¹Ù…±Õ”ñð€œœ¤€è€œœ(€€€€€€€€€€€ôì(€€€€€€€€€€€¥˜€ ……ÁÁ±åQÉ…¹Í™•É	½½­¥¹¥•±‘ÍQ½A½ÍÐ¡¹•Ý	Õ™™•ÉA½ÍÐ°É•™Ì¤¤É•ÑÕÉ¸ì(€€€€€€€€€€€ÍÑ…Ñ”¹‰Õ™™•ÉáÁ•¹Í•Ì¹ÁÕÍ ¡¹•Ý	Õ™™•ÉA½ÍÐ¤ì(€€€€€€€€€ô(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô(((€™Õ¹Ñ¥½¸É•¹‘•ÉQ…¹­I••¥ÁÑQÉ…­¥¹œ¡…É¤ì(€€€½¹ÍÐÉ••¥ÁÑÌ€ô•ÑQ…¹­I••¥ÁÑÌ ¤ì(€€€½¹ÍÐÕÉÉ•¹ÑI••¥ÁÑÌ€ôÉ••¥ÁÑÌ¹™¥±Ñ•È ¡É••¥ÁÐ¤€ôøÉ••¥ÁÐ¹µ½¹Ñ €ôôôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ‰½à€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€‰½à¹±…ÍÍ9…µ”€ô€…Éœì(€€€‰½à¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€Q…¹­‰½¹ÌÕ¹-…¹¥ÍÑ•È…ˆ)Õ¹¤•É™…ÍÍ•¸œ¤¤ì(€€€‰½à¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€QÉ…”…ÑÕ´Õ¹‰•é…¡±Ñ•¸	•ÑÉ…œ•¥¸¸)•‘•È-…Õ˜ë‘¡±Ð…±ÌÑ…ÑÏ‘¡±¥¡”ÕÍ…‰”‘•Ì•µ•¥¹Í…µ•¸-É…™ÑÍÑ½™™Ù½ÉÉ…ÑÌ°…Õ Ý•¹¸‘•ÈMÁÉ¥Ð•ÉÍÐÍÃ‘Ñ•È…ÕÌ•¥¹•´-…¹¥ÍÑ•È•¹ÕÑéÐÝ¥É¸¥”#Ù¡”‘•ÌQ½Á™Ì™½±Ð‘•¸•¡Ñ•¸/‘Õ™•¸Õ¹‘•ÈY•É‰É…Õ¡ÍÁÉ½¹½Í”ì•ÕÉ”¥¹é…¡±Õ¹•¸Ý•É‘•¸…ÕÑ½µ…Ñ¥Í ¹… ‘•´Ù•É›ñ‰…É•¸¥¹­½µµ•¸¹… 1½¡¹…‰éÕœÙ•ÉÑ•¥±Ð¸œ¤¤ì((€€€½¹ÍÐ™½É´€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€™½É´¹±…ÍÍ9…µ”€ô€É½ÜÑ…¹¬µÉ••¥ÁÐµ™½É´œì(€€€½¹ÍÐ™¥•±‘Ì€ôl(€€€€€lµ½¹Ñ œ°€5½¹…Ðœ°€µ½¹Ñ œ°ÕÉÉ•¹Ñ5½¹Ñ¡t°(€€€€€l‘…Ñ”œ°€…ÑÕ´œ°€‘…Ñ”œ°ÕÉÉ•¹Ñ5½¹Ñ €¬€œ´ÀÄt°(€€€€€lÁ…¥œ°€	•é…¡±ÐƒŠ
°œ°€Ñ•áÐœ°€œt°(€€€€€l…Í¡‰…¬œ°€…Í¡‰…¬½½ÕÁ½¸ƒŠ
°œ°€Ñ•áÐœ°€œt(€€€tì(€€€½¹ÍÐ¥¹ÁÕÑÌ€ôíôì(€€€™¥•±‘Ì¹™½É…  ¡m­•ä°±…‰•°°ÑåÁ”°Ù…±Õ•t¤€ôøì(€€€€€½¹ÍÐÝÉ…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€½¹ÍÐ±…ˆ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€€€±…ˆ¹Ñ•áÑ½¹Ñ•¹Ð€ô±…‰•°ì(€€€€€½¹ÍÐ¥¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€€€¥¹ÁÕÐ¹ÑåÁ”€ôÑåÁ”ì(€€€€€¥˜€¡l±¥Ñ•ÉÌœ°€Á…¥œ°€…Í¡‰…¬t¹¥¹±Õ‘•Ì¡­•ä¤¤¥¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€€€¥¹ÁÕÐ¹Ù…±Õ”€ôÙ…±Õ”ì(€€€€€¥¹ÁÕÑÍm­•åt€ô¥¹ÁÕÐì(€€€€€ÝÉ…À¹…ÁÁ•¹‘¡¥±¡±…ˆ¤ì(€€€€€ÝÉ…À¹…ÁÁ•¹‘¡¥±¡¥¹ÁÕÐ¤ì(€€€€€™½É´¹…ÁÁ•¹‘¡¥±¡ÝÉ…À¤ì(€€€ô¤ì(€€€½¹ÍÐ…¹]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€…¹]É…À¹±…ÍÍ9…µ”€ô€¡•­‰½àµÉ½Üœì(€€€½¹ÍÐ…¹%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€…¹%¹ÁÕÐ¹ÑåÁ”€ô€¡•­‰½àœì(€€€¥¹ÁÕÑÌ¹¥Í…¹¥ÍÑ•È€ô…¹%¹ÁÕÐì(€€€…¹]É…À¹…ÁÁ•¹‘¡¥±¡…¹%¹ÁÕÐ¤ì(€€€…¹]É…À¹…ÁÁ•¹‘¡¥±¡‘½Õµ•¹Ð¹É•…Ñ•Q•áÑ9½‘” œ-…¹¥ÍÑ•È€¼µ¥Ñ•‰É…¡Ðœ¤¤ì(€€€™½É´¹…ÁÁ•¹‘¡¥±¡…¹]É…À¤ì(€€€½¹ÍÐ¹½Ñ•]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹ÍÐ¹½Ñ•1…ˆ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€¹½Ñ•1…ˆ¹Ñ•áÑ½¹Ñ•¹Ð€ô€9½Ñ¥èœì(€€€½¹ÍÐ¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹½Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹½Ñ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸	•É±¥¸°½ÕÁ½¸°É…°½‘•ÈY½ÉÉ…ÑÍ­…¹¥ÍÑ•Èœì(€€€¥¹ÁÕÑÌ¹¹½Ñ”€ô¹½Ñ•%¹ÁÕÐì(€€€¹½Ñ•]É…À¹…ÁÁ•¹‘¡¥±¡¹½Ñ•1…ˆ¤ì(€€€¹½Ñ•]É…À¹…ÁÁ•¹‘¡¥±¡¹½Ñ•%¹ÁÕÐ¤ì(€€€™½É´¹…ÁÁ•¹‘¡¥±¡¹½Ñ•]É…À¤ì(€€€‰½à¹…ÁÁ•¹‘¡¥±¡™½É´¤ì((€€€½¹ÍÐÍ…Ù•	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€Í…Ù•	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€Í…Ù•	Ñ¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€Í…Ù•	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€Q…¹­‰½¸ÍÁ•¥¡•É¸œì(€€€Í…Ù•	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€½¹ÍÐÁ…¥€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡¥¹ÁÕÑÌ¹Á…¥¹Ù…±Õ”ñð€À¤ì(€€€€€½¹ÍÐ…Í¡‰…¬€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡¥¹ÁÕÑÌ¹…Í¡‰…¬¹Ù…±Õ”ñð€À¤ì(€€€€€¥˜€ …¥Í5½¹Ñ¡-•ä¡¥¹ÁÕÑÌ¹µ½¹Ñ ¹Ù…±Õ”¤ñð¥¹ÁÕÑÌ¹µ½¹Ñ ¹Ù…±Õ”€ðQ9-}I1}Q}MQIQ}5=9Q ¤É•ÑÕÉ¸…±•ÉÐ ¡Ñ”Q…¹­‘…Ñ•¸Ý•É‘•¸…ˆ)Õ¹¤€ÈÀÈØ•É™…ÍÍÐ¸œ¤ì(€€€€€¥˜€ „¡Á…¥€ø€À¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸‰•é…¡±Ñ•¸	•ÑÉ…œËÛ}•È…±Ì€À•¥¹ÑÉ…•¸¸œ¤ì(€€€€€É•½Á•¹Q…¹­5½¹Ñ¡™Ñ•É‘¥Ð¡¥¹ÁÕÑÌ¹µ½¹Ñ ¹Ù…±Õ”¤ì(€€€€€½¹ÍÐÉ••¥ÁÐ€ôÕÁÍ•ÉÑQ…¹­I••¥ÁÐ¡ì(€€€€€€€µ½¹Ñ è¥¹ÁÕÑÌ¹µ½¹Ñ ¹Ù…±Õ”°(€€€€€€€‘…Ñ”è¥¹ÁÕÑÌ¹‘…Ñ”¹Ù…±Õ”°(€€€€€€€±¥Ñ•ÉÌè€À°(€€€€€€€Á…¥°(€€€€€€€…Í¡‰…¬°(€€€€€€€¥Í…¹¥ÍÑ•Èè¥¹ÁÕÑÌ¹¥Í…¹¥ÍÑ•È¹¡•­•°(€€€€€€€…±±½…Ñ¥½¹Ìèíô°(€€€€€€€¹½Ñ”è¥¹ÁÕÑÌ¹¹½Ñ”¹Ù…±Õ”(€€€€€ô¤ì(€€€€€…‘‘¡…¹•1½œ Q…¹­•±œ°Q…¹­‰½¸€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡É••¥ÁÐ¹µ½¹Ñ ¥ô•ÍÁ•¥¡•ÉÐƒ
Ü¹•ÑÑ¼€‘í•ÕÉ¼¡É••¥ÁÐ¹¹•Ñ½ÍÐ¥õ€°É••¥ÁÐ¹µ½¹Ñ ¤ì(€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€É•¹‘•È ¤ì(€€€ô¤ì(€€€‰½à¹…ÁÁ•¹‘¡¥±¡Í…Ù•	Ñ¸¤ì((€€€¥˜€¡ÕÉÉ•¹ÑI••¥ÁÑÌ¹±•¹Ñ ¤ì(€€€€€½¹ÍÐ‘•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€€€‘•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€½µÁ…Ðµ‘•Ñ…¥±Ìœì(€€€€€‘•Ñ…¥±Ì¹½Á•¸€ôÑÉÕ”ì(€€€€€½¹ÍÐÍÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€€€ÍÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ôQ…¹­‰½¹Ì€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ô€ ‘íÕÉÉ•¹ÑI••¥ÁÑÌ¹±•¹Ñ¡ô¥€ì(€€€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡ÍÕµµ…Éä¤ì(€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”½µÁ…ÐµÑ…‰±”œì(€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ù…ÑÕ´ð½Ñ øñÑ ù‰•é…¡±Ðð½Ñ øñÑ ù•ÍÁ…ÉÐð½Ñ øñÑ ùÉÐ€¼!¥¹Ý•¥Ìð½Ñ øñÑ øð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€ÕÉÉ•¹ÑI••¥ÁÑÌ¹™½É…  ¡É••¥ÁÐ¤€ôøì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€½¹ÍÐ¹½Ñ”€ô€‘íÉ••¥ÁÐ¹¥Í…¹¥ÍÑ•È€ü€-…¹¥ÍÑ•Èœ€è€Q…¹­ÍÑ•±±”ô‘íÉ••¥ÁÐ¹¹½Ñ”€ü€œƒ
Ü€œ€¬•Í…Á•!Ñµ°¡É••¥ÁÐ¹¹½Ñ”¤€è€œõ€ì(€€€€€€€ÑÈ¹¥¹¹•É!Q50€ô€ñÑø‘íÉ••¥ÁÐ¹‘…Ñ”ñð€œ´ôð½ÑøñÑø‘í•ÕÉ¼¡É••¥ÁÐ¹Á…¥¥ôð½ÑøñÑø‘í•ÕÉ¼¡É••¥ÁÐ¹…Í¡‰…¬¥ôð½ÑøñÑø‘í¹½Ñ•ôð½Ñù€ì(€€€€€€€½¹ÍÐÑ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€½¹ÍÐ‘•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€‘•°¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€€€‘•°¹±…ÍÍ9…µ”€ô€‘…¹•È½µÁ…Ðµ…Ñ¥½¸œì(€€€€€€€‘•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€³ÙÍ¡•¸œì(€€€€€€€‘•°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€€€¥˜€¡½¹™¥É´ Q…¹­‰½¸³ÙÍ¡•¸üœ¤¤ì(€€€€€€€€€€€É•½Á•¹Q…¹­5½¹Ñ¡™Ñ•É‘¥Ð¡É••¥ÁÐ¹µ½¹Ñ ¤ì(€€€€€€€€€€€‘•±•Ñ•Q…¹­I••¥ÁÐ¡É••¥ÁÐ¹¥¤ì(€€€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€ô(€€€€€€€ô¤ì(€€€€€€€Ñ¹…ÁÁ•¹‘¡¥±¡‘•°¤ì(€€€€€€€ÑÈ¹…ÁÁ•¹‘¡¥±¡Ñ¤ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€ô¤ì(€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€€€‰½à¹…ÁÁ•¹‘¡¥±¡‘•Ñ…¥±Ì¤ì(€€€ô(€€€…É¹…ÁÁ•¹‘¡¥±¡‰½à¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉQ…¹­5½¹Ñ¡½µÁ±•Ñ¥½¸¡…É¤ì(€€€½¹ÍÐ‰½à€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€‰½à¹±…ÍÍ9…µ”€ô€…Éœì(€€€‰½à¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€Q…¹­µ½¹…Ð…‰Í¡±¥—}•¸œ¤¤ì(€€€¥˜€¡ÕÉÉ•¹Ñ5½¹Ñ €ðQ9-}I1}Q}MQIQ}5=9Q ¤ì(€€€€€‰½à¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥”•¡Ñ”5½¹…ÑÍ…ÕÍÝ•ÉÑÕ¹œ‰•¥¹¹Ð¥´)Õ¹¤€ÈÀÈØ¸	¥Ì‘…¡¥¸‰±•¥‰Ð•ÕÉ”‘•Éé•¥Ð•¥¹•ÍÑ•±±Ñ”AÉ½¹½Í”‘¥”ÉÕ¹‘±…”¸œ¤¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡‰½à¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍÐÑ½Ñ…°€ô•ÑQ…¹­!½ÕÍ•¡½±‘5½¹Ñ¡±åI•½É¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ±½Í•€ô¥ÍQ…¹­5½¹Ñ¡±½Í•¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì((€€€‰½à¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€]•¹¸‘¥”Q…¹­‰½¹Ì‘•Ì5½¹…ÑÌÙ½±±ÍÓ‘¹‘¥œÍ¥¹°‰•ÍÓ‘Ñ¥ÍÐ‘Ô‘•¸5½¹…Ð¡¥•È¸…¹… ™±¥—}•¸‘¥”Ñ…ÑÏ‘¡±¥¡•¸-É…™ÑÍÑ½™™­½ÍÑ•¸¥¸‘¥”½±•Á±…¹Õ¹œ•¥¸ì•ÕÉ”¥¹é…¡±Õ¹•¸Ý•É‘•¸Ý•¥Ñ•É¡¥¸¹… ‘•´¥¹­½µµ•¸‘•Ì©•Ý•¥±¥•¸5½¹…ÑÌÙ•ÉÑ•¥±Ð¸-¥±½µ•Ñ•ÉÍÓ‘¹‘”Í¥¹‘…›ñÈ¹¥¡Ð»ÙÑ¥œ¸œ¤¤ì(€€€‰½à¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€Q…¹­‰½¹Ì•É™…ÍÍÐœ°Ù…±Õ”èMÑÉ¥¹œ¡Ñ½Ñ…°¹É••¥ÁÑ½Õ¹Ð¤ô°(€€€€€ì±…‰•°è€ÕÍ••‰•¸¹•ÑÑ¼œ°Ù…±Õ”è•ÕÉ¼¡Ñ½Ñ…°¹¹•Ñ½ÍÐ¤°­¥¹èÑ½Ñ…°¹¹•Ñ½ÍÐ€ø€À€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€ì±…‰•°è€MÑ…ÑÕÌœ°Ù…±Õ”è±½Í•€ü€œñÍÁ…¸±…ÍÌô‰Á¥±°ÍÕ•ÍÌˆù	•ÍÓ‘Ñ¥Ðð½ÍÁ…¸øœ€è€œñÍÁ…¸±…ÍÌô‰Á¥±°Ý…É¹¥¹œˆù9½ ½™™•¸ð½ÍÁ…¸øœô(€€€t¤¤ì((€€€½¹ÍÐ…Ñ¥½¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…Ñ¥½¹Ì¹±…ÍÍ9…µ”€ô€É½Üœì(€€€¥˜€ …±½Í•¤ì(€€€€€½¹ÍÐ±½Í•	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€±½Í•	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€±½Í•	Ñ¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€€€±½Í•	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€5½¹…Ð‰•ÍÓ‘Ñ¥•¸€˜½±•Á±…¹Õ¹œ‰•É•¡¹•¸œì(€€€€€±½Í•	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€¥˜€ „¡Ñ½Ñ…°¹É••¥ÁÑ½Õ¹Ð€ø€À¤ñð€„¡Ñ½Ñ…°¹¹•Ñ½ÍÐ€ø€À¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”éÕ•ÉÍÐµ¥¹‘•ÍÑ•¹Ì•¥¹•¸Q…¹­‰½¸µ¥Ð	•ÑÉ…œÍÁ•¥¡•É¸¸œ¤ì(€€€€€€€Í•ÑQ…¹­5½¹Ñ¡±½Í•¡ÕÉÉ•¹Ñ5½¹Ñ °ÑÉÕ”¤ì(€€€€€€€½¹ÍÐ¹•áÑA±…¹5½¹Ñ €ô¹•áÑ5½¹Ñ ¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€½¹ÍÐ…ÉÉ¥•‘Õ•±	…±…¹”€ôÍå¹Õ•±…ÉÉå½Ù•ÉÉ½µ5½¹Ñ ¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€Íå¹±±Q…¹­•±‘áÁ•¹Í•Ì¡ìÍ¥±•¹ÐèÑÉÕ”°µ½¹Ñ¡-•äè¹•áÑA±…¹5½¹Ñ ô¤ì(€€€€€€€½¹ÍÐ¹•áÑMÑ…ÑÌ€ô•ÑQ…¹­!½ÕÍ•¡½±‘Ù•É…•MÑ…ÑÌ¡¹•áÑA±…¹5½¹Ñ °€ÄÈ¤ì(€€€€€€€…‘‘¡…¹•1½œ Q…¹­•±œ°€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ô‰•ÍÓ‘Ñ¥Ðì€‘í•ÕÉ¼¡…ÉÉ¥•‘Õ•±	…±…¹”¥ôI•ÍÐ¥¸€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡¹•áÑA±…¹5½¹Ñ ¥ôƒñ‰•É¹½µµ•¸Õ¹€‘í•ÕÉ¼¡Ñ½Ñ…°¹¹•Ñ½ÍÐ¥ô•¡Ñ”Q…¹­…ÕÍ…‰•¸¥¸‘¥”A±…¹Õ¹œ…Õ™•¹½µµ•¸¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€€€…±•ÉÐ¡Q…¹­µ½¹…Ð‰•ÍÓ‘Ñ¥Ð¸€‘í•ÕÉ¼¡…ÉÉ¥•‘Õ•±	…±…¹”¥ôI•ÍÐÝÕÉ‘•¸…ÕÑ½µ…Ñ¥Í ¥¸€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡¹•áÑA±…¹5½¹Ñ ¥ôƒñ‰•É¹½µµ•¸¸¥”A±…¹Õ¹œÉ•¡¹•Ð¹Õ¸µ¥Ð€‘í¹•áÑMÑ…ÑÌ¹É•…±½Õ¹Ñô•¡Ñ•´5½¹…Ð½5½¹…Ñ•¸Õ¹€‘í¹•áÑMÑ…ÑÌ¹ÁÉ½©•Ñ•‘½Õ¹ÑôAÉ½¹½Í•µ½¹…Ð¼µµ½¹…Ñ•¸¹€¤ì(€€€€€ô¤ì(€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡±½Í•	Ñ¸¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÉ•½Á•¹	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€É•½Á•¹	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€É•½Á•¹	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€€€É•½Á•¹	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€5½¹…ÐéÕÈ	•…É‰•¥ÑÕ¹œÝ¥•‘•ÈƒÙ™™¹•¸œì(€€€€€É•½Á•¹	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€Í•ÑQ…¹­5½¹Ñ¡±½Í•¡ÕÉÉ•¹Ñ5½¹Ñ °™…±Í”¤ì(€€€€€€€±•…ÉÕÑ½µ…Ñ¥Õ•±…ÉÉå½Ù•ÉÉ½µ5½¹Ñ ¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€Íå¹±±Q…¹­•±‘áÁ•¹Í•Ì¡ìÍ¥±•¹ÐèÑÉÕ”°µ½¹Ñ¡-•äè¹•áÑ5½¹Ñ ¡ÕÉÉ•¹Ñ5½¹Ñ ¤ô¤ì(€€€€€€€…‘‘¡…¹•1½œ Q…¹­•±œ°€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ôéÕÈ	•…É‰•¥ÑÕ¹œÝ¥•‘•È—Ù™™¹•Ð¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡É•½Á•¹	Ñ¸¤ì(€€€ô(€€€‰½à¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹Ì¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡‰½à¤ì(€ô(((€™Õ¹Ñ¥½¸Íå¹É½•ÉåQ½ÁUÁáÁ•¹Í”¡µ½¹Ñ¡-•ä€ôÕÉÉ•¹Ñ5½¹Ñ °½ÁÑ¥½¹Ì€ôíô¤ì(€€€½¹ÍÐ…±±½…Ñ¥½¸€ô•ÑÉ½•ÉåQ½ÁUÁ±±½…Ñ¥½¸¡µ½¹Ñ¡-•ä¤ì(€€€¥˜€ ……±±½…Ñ¥½¸¹…Ñ¥Ù”¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐ¡…Í5…¹Õ…±Q…É•Ð€ô•ÑÉ½•ÉåQ…É•Ñ=Ù•ÉÉ¥‘”¡µ½¹Ñ¡-•ä¤€„ô¹Õ±°ì(€€€±•Ð¡…¹•€ô™…±Í”ì(€€€•Ñ½½‘5½¹•åA½ÍÑÌ ¤¹™½É…  ¡Á½ÍÐ¤€ôøì(€€€€€•¹ÍÕÉ•A½ÍÑ½¹™¥œ¡Á½ÍÐ¤ì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡…±±½…Ñ¥½¸¹…±±½…Ñ¥½¹Ì€˜˜…±±½…Ñ¥½¸¹…±±½…Ñ¥½¹ÍmÁ½ÍÐ¹¥‘tñð€À¤ì(€€€€€¥˜€¡¡…Í5…¹Õ…±Q…É•Ð€˜˜¥ÍA½ÍÑA…¥‘½É5½¹Ñ ¡Á½ÍÐ°µ½¹Ñ¡-•ä¤¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐÑ…É•Ñ5½¹Ñ €ô¥ÍA½ÍÑA…¥‘½É5½¹Ñ ¡Á½ÍÐ°µ½¹Ñ¡-•ä¤€ü¹•áÑ5½¹Ñ ¡µ½¹Ñ¡-•ä¤€èµ½¹Ñ¡-•äì(€€€€€Í•ÑA½ÍÑµ½Õ¹Ñ½É5½¹Ñ ¡Á½ÍÐ°Ñ…É•Ñ5½¹Ñ °…µ½Õ¹Ð°¡…Í5…¹Õ…±Q…É•Ð€ü€½¹”œ€è€™ÕÑÕÉ”œ¤ì(€€€€€¡…¹•€ôÑÉÕ”ì(€€€ô¤ì(€€€¥˜€¡¡…¹•€˜˜€…½ÁÑ¥½¹Ì¹Í¥±•¹Ð¤…‘‘¡…¹•1½œ ¥¹­…Õ™Í•±œ°Õ™ÍÑ½­Õ¹œ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡µ½¹Ñ¡-•ä¥ô¹… ¥¹­½µµ•¸¹… 1½¡¹…‰éÕœ…Õ˜€‘í•ÕÉ¼¡…±±½…Ñ¥½¸¹Ñ½ÁUÀ¥ôÙ•ÉÑ•¥±Ð¹€°µ½¹Ñ¡-•ä¤ì(€€€É•ÑÕÉ¸¡…¹•ì(€ô((€™Õ¹Ñ¥½¸Íå¹Õ•±Q½ÁUÁáÁ•¹Í•Ì¡µ½¹Ñ¡-•ä€ôÕÉÉ•¹Ñ5½¹Ñ °½ÁÑ¥½¹Ì€ôíô¤ì(€€€½¹ÍÐ…±±½…Ñ¥½¸€ô•ÑÕ•±Q½ÁUÁ±±½…Ñ¥½¸¡µ½¹Ñ¡-•ä¤ì(€€€¥˜€ ……±±½…Ñ¥½¸¹…Ñ¥Ù”¤É•ÑÕÉ¸™…±Í”ì(€€€±•Ð¡…¹•€ô™…±Í”ì(€€€l‰•¹¹äœ°µ…‘•±•¥¹”t¹™½É…  ¡Á•ÉÍ½¹-•ä¤€ôøì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡…±±½…Ñ¥½¸¹…±±½…Ñ¥½¹Ì€˜˜…±±½…Ñ¥½¸¹…±±½…Ñ¥½¹ÍmÁ•ÉÍ½¹-•åtñð€À¤ì(€€€€€½¹ÍÐÁ½ÍÐ€ô•ÑQ…¹­áÁ•¹Í•A½ÍÐ¡Á•ÉÍ½¹-•ä¤ì(€€€€€¥˜€¡Á½ÍÐ¤ì(€€€€€€€•¹ÍÕÉ•A½ÍÑ½¹™¥œ¡Á½ÍÐ¤ì(€€€€€€€½¹ÍÐÑ…É•Ñ5½¹Ñ €ô¥ÍA½ÍÑA…¥‘½É5½¹Ñ ¡Á½ÍÐ°µ½¹Ñ¡-•ä¤€ü¹•áÑ5½¹Ñ ¡µ½¹Ñ¡-•ä¤€èµ½¹Ñ¡-•äì(€€€€€€€Í•ÑA½ÍÑµ½Õ¹Ñ½É5½¹Ñ ¡Á½ÍÐ°Ñ…É•Ñ5½¹Ñ °…µ½Õ¹Ð°€™ÕÑÕÉ”œ¤ì(€€€€€€€¡…¹•€ôÑÉÕ”ì(€€€€€ô•±Í”ì(€€€€€€€Íå¹Q…¹­•±‘áÁ•¹Í”¡Á•ÉÍ½¹-•ä°ìÍ¥±•¹ÐèÑÉÕ”ô¤ì(€€€€€€€¡…¹•€ôÑÉÕ”ì(€€€€€ô(€€€ô¤ì(€€€¥˜€¡¡…¹•€˜˜€…½ÁÑ¥½¹Ì¹Í¥±•¹Ð¤…‘‘¡…¹•1½œ Q…¹­•±œ°Õ™ÍÑ½­Õ¹œ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡µ½¹Ñ¡-•ä¥ô¹… ¥¹­½µµ•¸¹… 1½¡¹…‰éÕœ…Õ˜€‘í•ÕÉ¼¡…±±½…Ñ¥½¸¹Ñ½ÁUÀ¥ôÙ•ÉÑ•¥±Ð¹€°µ½¹Ñ¡-•ä¤ì(€€€É•ÑÕÉ¸¡…¹•ì(€ô((€™Õ¹Ñ¥½¸Íå¹%¹½µ•	…Í•‘M¡…É•‘Q½ÁUÁÌ¡ÍÑ…ÉÑ5½¹Ñ €ôÕÉÉ•¹Ñ5½¹Ñ °µ½¹Ñ¡½Õ¹Ð€ô€ÄÈ¤ì(€€€¥˜€ …¥Í5½¹Ñ¡-•ä¡ÍÑ…ÉÑ5½¹Ñ ¤¤É•ÑÕÉ¸™…±Í”ì(€€€±•Ð¡…¹•€ô™…±Í”ì(€€€™½È€¡±•Ð¥¹‘•à€ô€Àì¥¹‘•à€ð5…Ñ ¹µ…à Ä°9Õµ‰•È¡µ½¹Ñ¡½Õ¹Ðñð€ÄÈ¤¤ì¥¹‘•à€¬ô€Ä¤ì(€€€€€½¹ÍÐµ½¹Ñ¡-•ä€ô…‘‘5½¹Ñ¡Ì¡ÍÑ…ÉÑ5½¹Ñ °¥¹‘•à¤ì(€€€€€¡…¹•€ôÍå¹Õ•±Q½ÁUÁáÁ•¹Í•Ì¡µ½¹Ñ¡-•ä°ìÍ¥±•¹ÐèÑÉÕ”ô¤ñð¡…¹•ì(€€€€€¡…¹•€ôÍå¹É½•ÉåQ½ÁUÁáÁ•¹Í”¡µ½¹Ñ¡-•ä°ìÍ¥±•¹ÐèÑÉÕ”ô¤ñð¡…¹•ì(€€€ô(€€€É•ÑÕÉ¸¡…¹•ì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝÉ½•ÉåáÁ•¹Í•‘¥Ñ½È¡•áÁ•¹Í”€ô¹Õ±°¤ì(€€€½¹ÍÐ¥Í9•Ü€ô€…•áÁ•¹Í”ì(€€€½¹ÍÐ¥Ñ•´€ô•áÁ•¹Í”ñðì(€€€€€¥è•¹•É…Ñ•% ¤°(€€€€€µ½¹Ñ èÕÉÉ•¹Ñ5½¹Ñ °(€€€€€‘…Ñ”è€‘íÕÉÉ•¹Ñ5½¹Ñ¡ô´ÀÅ€°(€€€€€¹…µ”è€œœ°(€€€€€…µ½Õ¹Ðè€À°(€€€€€¹½Ñ”è€œœ°(€€€ôì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì((€€€½¹ÍÐÉ½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ‘…Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€‘…Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€‘…Ñ”œì(€€€‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹‘…Ñ”ñð€‘í¥Ñ•´¹µ½¹Ñ ñðÕÉÉ•¹Ñ5½¹Ñ¡ô´ÀÅ€ì(€€€½¹ÍÐ¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹…µ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹…µ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹…µ”ñð€œœì(€€€¹…µ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸]½¡•¹•¥¹­…Õ˜½‘•ÈÉ½•É¥”œì(€€€½¹ÍÐ…µ½Õ¹Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹…µ½Õ¹Ð€ü™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡¥Ñ•´¹…µ½Õ¹Ð¤€è€œœì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸€Øà°ÐÈœì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ …ÑÕ´œ°‘…Ñ•%¹ÁÕÐ¤¤ì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ¥¹­…Õ˜œ°¹…µ•%¹ÁÕÐ¤¤ì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•ÑÉ…œœ°…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì((€€€½¹ÍÐ¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹½Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹½Ñ”ñð€œœì(€€€¹½Ñ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€½ÁÑ¥½¹…°è5…É­Ð½‘•È!¥¹Ý•¥Ìœì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥èœ°¹½Ñ•%¹ÁÕÐ¤¤ì((€€€½¹ÍÐ¡¥¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¡¥¹Ð¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€¡¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô€•È¥¹­…Õ˜Ý¥É›ñÈ‘¥”5½¹…ÑÍ…ÕÍÝ•ÉÑÕ¹œ•ÍÁ•¥¡•ÉÐ¸È•Éé•ÕÐ­•¥¹”éÕÏ‘Ñé±¥¡”-½¹Ñ½‰Õ¡Õ¹œ¸œì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¡¥¹Ð¤ì((€€€Í¡½Ý5½‘…°¡¥Í9•Ü€ü€¥¹­…Õ˜•É™…ÍÍ•¸œ€è€¥¹­…Õ˜‰•…É‰•¥Ñ•¸œ°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤ô°(€€€€€ì(€€€€€€€±…‰•°è€MÁ•¥¡•É¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ …‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¸…ÑÕ´•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð€„¡…µ½Õ¹Ð€ø€À¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸	•ÑÉ…œËÛ}•È…±Ì€À•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€€€½¹ÍÐÍ…Ù•€ôÕÁÍ•ÉÑÉ½•ÉåáÁ•¹Í”¡ì(€€€€€€€€€€€¥è¥Ñ•´¹¥°(€€€€€€€€€€€µ½¹Ñ è•Ñ5½¹Ñ¡-•åÉ½µ…Ñ•Y…±Õ”¡‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”°ÕÉÉ•¹Ñ5½¹Ñ ¤°(€€€€€€€€€€€‘…Ñ”è‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€¹…µ”è¹…µ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ñð€¥¹­…Õ˜œ°(€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€¹½Ñ”è¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤(€€€€€€€€€ô¤ì(€€€€€€€€€¥˜€ …Í…Ù•¤É•ÑÕÉ¸…±•ÉÐ •È¥¹­…Õ˜­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤ì(€€€€€€€€€…‘‘¡…¹•1½œ ¥¹­…Õ™Í•±œ°€‘í¥Í9•Ü€ü€¥¹­…Õ˜•É™…ÍÍÐœ€è€¥¹­…Õ˜—‘¹‘•ÉÐôè€‘íÍ…Ù•¹¹…µ•ôƒ
Ü€‘í•ÕÉ¼¡Í…Ù•¹…µ½Õ¹Ð¥ô¹€°Í…Ù•¹µ½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉÉ½•ÉåQ½ÁUÁ…É¡Á…É•¹Ð¤ì(€€€¹½Éµ…±¥é•	Õ‘•ÑQ½ÁUÁÍ½¹™¥œ ¤ì(€€€½¹ÍÐ…±Œ€ô•ÑÉ½•ÉåQ½ÁUÁ±±½…Ñ¥½¸¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ½¹™¥œ€ô•Ñ	Õ‘•ÑQ½ÁUÁ½¹™¥œ É½•É¥•Ìœ¤ì(€€€½¹ÍÐµ…¹Õ…±Q…É•Ð€ô•ÑÉ½•ÉåQ…É•Ñ=Ù•ÉÉ¥‘”¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ…Ñ¥Ù•A½ÍÑÌ€ô•Ñ½½‘5½¹•åA½ÍÑÌ ¤¹™¥±Ñ•È ¡Á½ÍÐ¤€ôø¥ÍA½ÍÑÑ¥Ù•%¹5½¹Ñ ¡Á½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤¤ì(€€€½¹ÍÐÁ…¥‘Q½Ñ…°€ôÉ½Õ¹‘5½¹•ä¡…Ñ¥Ù•A½ÍÑÌ¹É•‘Õ” ¡ÍÕ´°Á½ÍÐ¤€ôøì(€€€€€¥˜€ …¥ÍA½ÍÑA…¥‘½É5½¹Ñ ¡Á½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤¤É•ÑÕÉ¸ÍÕ´ì(€€€€€É•ÑÕÉ¸ÍÕ´€¬9Õµ‰•È¡•Ñ™™•Ñ¥Ù•µ½Õ¹Ñ½É5½¹Ñ ¡Á½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤ñð€À¤ì(€€€ô°€À¤¤ì(€€€½¹ÍÐÁ±…¹¹•‘Q½Ñ…°€ôÉ½Õ¹‘5½¹•ä¡9Õµ‰•È¡…±Œ¹Ñ½ÁUÀñð€À¤¤ì(€€€½¹ÍÐÍÑ¥±±Q½A…ä€ôÉ½Õ¹‘5½¹•ä¡5…Ñ ¹µ…à À°Á±…¹¹•‘Q½Ñ…°€´Á…¥‘Q½Ñ…°¤¤ì(€€€½¹ÍÐÕÉÉ•¹ÑáÁ•¹Í•Ì€ô•ÑÉ½•ÉåáÁ•¹Í•Ì ¤¹™¥±Ñ•È ¡•áÁ•¹Í”¤€ôø•áÁ•¹Í”¹µ½¹Ñ €ôôôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐÍÁ•¹ÑQ½Ñ…°€ôÉ½Õ¹‘5½¹•ä¡ÕÉÉ•¹ÑáÁ•¹Í•Ì¹É•‘Õ” ¡ÍÕ´°•áÁ•¹Í”¤€ôøÍÕ´€¬9Õµ‰•È¡•áÁ•¹Í”¹…µ½Õ¹Ðñð€À¤°€À¤¤ì(€€€½¹ÍÐ…Ù…¥±…‰±•Q½Ñ…°€ôÉ½Õ¹‘5½¹•ä¡Á…¥‘Q½Ñ…°€´ÍÁ•¹ÑQ½Ñ…°¤ì(€€€½¹ÍÐ‰…Í¥ÍQ•áÐ€ôµ…¹Õ…±Q…É•Ð€„ô¹Õ±°(€€€€€€ü5…¹Õ•±°›ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€(€€€€€€è€•ÍÑ•Ì5½¹…ÑÍé¥•°œì(€€€½¹ÍÐ™½É•…ÍÑ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€™½É•…ÍÑ…É¹±…ÍÍ9…µ”€ô€…ÉÑ…¹¬µ™½É•…ÍÐµ…Éœì(€€€™½É•…ÍÑ…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€œÄ¸5½¹…ÑÍÁÉ½¹½Í”œ¤¤ì(€€€™½É•…ÍÑ…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€•ÍÑ•Ì5½¹…ÑÍé¥•°Õ¹•Á±…¹Ñ•È¹Ñ•¥°ÁÉ¼1½¡¹­½¹Ñ¼¸œ¤¤ì(€€€™½É•…ÍÑ…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€5½¹…ÑÍé¥•°œ°Ù…±Õ”è•ÕÉ¼¡…±Œ¹Ñ…É•Ð¤°­¥¹è…±Œ¹Ñ…É•Ð€ø€À€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœ°¡¥¹Ðèµ…¹Õ…±Q…É•Ð€„ô¹Õ±°€ü€µ…¹Õ•±°™•ÍÑ•±•Ðœ€è€™•ÍÑ•ÈA±…¹Ý•ÉÐœô°(€€€€€ì±…‰•°è€¥¹é…¡±Õ¹œ•Á±…¹Ðœ°Ù…±Õ”è…±Œ¹…Ñ¥Ù”€ü•ÕÉ¼¡…±Œ¹Ñ½ÁUÀ¤€è€¡ÕÉÉ•¹Ñ5½¹Ñ €ôôô½¹™¥œ¹Ñ…É•ÑMÑ…ÉÑ5½¹Ñ €ü•ÕÉ¼¡…±Œ¹Ñ…É•Ð¤€è€9½ ¹¥¡Ð…­Ñ¥Øœ¤°­¥¹è…±Œ¹…Ñ¥Ù”ñðÕÉÉ•¹Ñ5½¹Ñ €ôôô½¹™¥œ¹Ñ…É•ÑMÑ…ÉÑ5½¹Ñ €ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€ì±…‰•°è€	•É•¡¹Õ¹Í‰…Í¥Ìœ°Ù…±Õ”è‰…Í¥ÍQ•áÐô(€€€t¤¤ì(€€€½¹ÍÐÉ½•Éå±±½…Ñ¥½¹1…‰•±Ì€ô…Ñ¥Ù•A½ÍÑÌ¹µ…À ¡Á½ÍÐ¤€ôøì(€€€€€€€½¹ÍÐÁ•ÉÍ½¸€ô€¡ÍÑ…Ñ”¹Á•ÉÍ½¹Ìñðmt¤¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹¥€ôôôÁ½ÍÐ¹Á•ÉÍ½¹%¤ì(€€€€€€€É•ÑÕÉ¸€‘íÁ•ÉÍ½¸€üÁ•ÉÍ½¸¹¹…µ”€è€U¹‰•­…¹¹Ðô€‘í•ÕÉ¼¡9Õµ‰•È¡…±Œ¹…±±½…Ñ¥½¹Ì€˜˜…±Œ¹…±±½…Ñ¥½¹ÍmÁ½ÍÐ¹¥‘tñð€À¤¥õ€ì(€€€€€ô¤ì(€€€¥˜€¡É½•Éå±±½…Ñ¥½¹1…‰•±Ì¹±•¹Ñ ¤ì(€€€€€™½É•…ÍÑ…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°¹Ñ•¥±”Ù½´©•Ý•¥±¥•¸1½¡¹­½¹Ñ¼è€‘íÉ½•Éå±±½…Ñ¥½¹1…‰•±Ì¹©½¥¸ œƒ
Ü€œ¥õ€¤¤ì(€€€ô(€€€Á…É•¹Ð¹…ÁÁ•¹‘¡¥±¡™½É•…ÍÑ…É¤ì((€€€½¹ÍÐÁ…¥‘…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Á…¥‘…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€Á…¥‘…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€œÈ¸	¥Í¡•È‰•é…¡±Ðœ¤¤ì(€€€Á…¥‘…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€!¥•Èë‘¡±Ð¹ÕÈ°Ý…Ì‰•¤‘•¸Á•ÉÏÙ¹±¥¡•¸¥¹­…Õ™Í•±µ¹Ñ•¥±•¸…±Ì‰•é…¡±Ðµ…É­¥•ÉÐ¥ÍÐ¸œ¤¤ì(€€€½¹ÍÐÁ…åµ•¹Ñ5•ÑÉ¥Ì€ôÉ•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€	•É•¥ÑÌ•¥¹•é…¡±Ðœ°Ù…±Õ”è…±Œ¹…Ñ¥Ù”€ü•ÕÉ¼¡Á…¥‘Q½Ñ…°¤€è€9½ ¹¥¡Ð…­Ñ¥Øœ°­¥¹èÁ…¥‘Q½Ñ…°€ø€À€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€ì±…‰•°è€9½ •¥¹éÕé…¡±•¸œ°Ù…±Õ”è…±Œ¹…Ñ¥Ù”€ü•ÕÉ¼¡ÍÑ¥±±Q½A…ä¤€è€ŸŠPœ°­¥¹èÍÑ¥±±Q½A…ä€ø€À€ü€Ý…É¹¥¹œœ€è€ÍÕ•ÍÌœô(€€€t¤ì(€€€Á…åµ•¹Ñ5•ÑÉ¥Ì¹±…ÍÍ1¥ÍÐ¹…‘ Ñ…¹¬µ‰…±…¹”µµ•ÑÉ¥Ìœ¤ì(€€€Á…¥‘…É¹…ÁÁ•¹‘¡¥±¡Á…åµ•¹Ñ5•ÑÉ¥Ì¤ì(€€€½¹ÍÐÁ…åµ•¹Ñ•Ñ…¥±Ì€ô…Ñ¥Ù•A½ÍÑÌ¹µ…À ¡Á½ÍÐ¤€ôøì(€€€€€½¹ÍÐÁ•ÉÍ½¸€ô€¡ÍÑ…Ñ”¹Á•ÉÍ½¹Ìñðmt¤¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹¥€ôôôÁ½ÍÐ¹Á•ÉÍ½¹%¤ì(€€€€€½¹ÍÐ±…‰•°€ôÁ•ÉÍ½¸€üÁ•ÉÍ½¸¹¹…µ”€è€U¹‰•­…¹¹Ðœì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡•Ñ™™•Ñ¥Ù•µ½Õ¹Ñ½É5½¹Ñ ¡Á½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤ñð€À¤ì(€€€€€É•ÑÕÉ¸€‘í±…‰•±ôè€‘í•ÕÉ¼¡…µ½Õ¹Ð¥ô€‘í¥ÍA½ÍÑA…¥‘½É5½¹Ñ ¡Á½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤€ü€‰•é…¡±Ðœ€è€½™™•¸õ€ì(€€€ô¤ì(€€€¥˜€¡Á…åµ•¹Ñ•Ñ…¥±Ì¹±•¹Ñ ¤Á…¥‘…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°Á…åµ•¹Ñ•Ñ…¥±Ì¹©½¥¸ œƒ
Ü€œ¤¤¤ì(€€€¥˜€ ……±Œ¹…Ñ¥Ù”¤Á…¥‘…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¥¹™¼µ‰½àœ°¥”Õ™ÍÑ½­Õ¹œ›ñÈ‘¥•Í•¸5½¹…Ð¥ÍÐ¹½ ¹¥¡Ð…­Ñ¥Ø¸…Ì™•ÍÑ”5½¹…ÑÍé¥•°¥±Ð…ˆ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡½¹™¥œ¹Ñ…É•ÑMÑ…ÉÑ5½¹Ñ ¥ô¹€¤¤ì(€€€Á…É•¹Ð¹…ÁÁ•¹‘¡¥±¡Á…¥‘…É¤ì((€€€½¹ÍÐÉ•µ…¥¹¥¹…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É•µ…¥¹¥¹…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€½¹ÍÐ•áÁ•¹Í•!•…‘•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€•áÁ•¹Í•!•…‘•È¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ•áÁ•¹Í•Q¥Ñ±”€ôÉ•…Ñ•U¥°  Ìœ°€œœ°€œÌ¸¥¹¯‘Õ™”Õ¹Ù•É›ñ‰…Èœ¤ì(€€€•áÁ•¹Í•Q¥Ñ±”¹ÍÑå±”¹™±•à€ô€œÄ€Ä…ÕÑ¼œì(€€€½¹ÍÐ…‘‘áÁ•¹Í•	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€…‘‘áÁ•¹Í•	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€…‘‘áÁ•¹Í•	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€…‘‘áÁ•¹Í•	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ¬¥¹­…Õ˜•É™…ÍÍ•¸œì(€€€…‘‘áÁ•¹Í•	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝÉ½•ÉåáÁ•¹Í•‘¥Ñ½È ¤¤ì(€€€•áÁ•¹Í•!•…‘•È¹…ÁÁ•¹‘¡¥±¡•áÁ•¹Í•Q¥Ñ±”¤ì(€€€•áÁ•¹Í•!•…‘•È¹…ÁÁ•¹‘¡¥±¡…‘‘áÁ•¹Í•	Ñ¸¤ì(€€€É•µ…¥¹¥¹…É¹…ÁÁ•¹‘¡¥±¡•áÁ•¹Í•!•…‘•È¤ì(€€€É•µ…¥¹¥¹…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€É™…ÍÍ”¡¥•È©•‘•¸¥¹­…Õ˜¸•È	•ÑÉ…œÝ¥ÉÙ½´‰•É•¥ÑÌ•¥¹•é…¡±Ñ•¸¥¹­…Õ™Í•±…‰•é½•¸ì‘¥”É™…ÍÍÕ¹œ•Éé•ÕÐ­•¥¹”éÝ•¥Ñ”-½¹Ñ½‰Õ¡Õ¹œ¸œ¤¤ì(€€€É•µ…¥¹¥¹…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€¥¹•é…¡±Ðœ°Ù…±Õ”è•ÕÉ¼¡Á…¥‘Q½Ñ…°¤°­¥¹èÁ…¥‘Q½Ñ…°€ø€À€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€ì±…‰•°è€ÕÍ••‰•¸œ°Ù…±Õ”è•ÕÉ¼¡ÍÁ•¹ÑQ½Ñ…°¤°­¥¹èÍÁ•¹ÑQ½Ñ…°€øÁ…¥‘Q½Ñ…°€ü€‘…¹•Èœ€è€œœô°(€€€€€ì±…‰•°è…Ù…¥±…‰±•Q½Ñ…°€øô€À€ü€9½ Ù•É›ñ‰…Èœ€è€Ÿq‰•È‘•´¥¹•é…¡±Ñ•¸œ°Ù…±Õ”è•ÕÉ¼¡5…Ñ ¹…‰Ì¡…Ù…¥±…‰±•Q½Ñ…°¤¤°­¥¹è…Ù…¥±…‰±•Q½Ñ…°€ð€À€ü€‘…¹•Èœ€è€ÍÕ•ÍÌœô°(€€€€€ì±…‰•°è€É™…ÍÍÑ”¥¹¯‘Õ™”œ°Ù…±Õ”èMÑÉ¥¹œ¡ÕÉÉ•¹ÑáÁ•¹Í•Ì¹±•¹Ñ ¤ô(€€€t¤¤ì(€€€¥˜€ …ÕÉÉ•¹ÑáÁ•¹Í•Ì¹±•¹Ñ ¤ì(€€€€€É•µ…¥¹¥¹…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€ñÈ‘¥•Í•¸5½¹…ÐÍ¥¹¹½ ­•¥¹”¥¹¯‘Õ™”•É™…ÍÍÐ¸œ¤¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”œì(€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ù…ÑÕ´ð½Ñ øñÑ ù¥¹­…Õ˜ð½Ñ øñÑ ù	•ÑÉ…œð½Ñ øñÑ ù­Ñ¥½¸ð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€ÕÉÉ•¹ÑáÁ•¹Í•Ì¹Í±¥” ¤¹Í½ÉÐ ¡„°ˆ¤€ôøMÑÉ¥¹œ¡„¹‘…Ñ”ñð€œœ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡ˆ¹‘…Ñ”ñð€œœ¤¤¤¹™½É…  ¡•áÁ•¹Í”¤€ôøì(€€€€€€€½¹ÍÐÉ½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Ñœ°€œœ°•áÁ•¹Í”¹‘…Ñ”€ü™½Éµ…ÑM•±™µÁ±½åµ•¹Ñ…Ñ”¡•áÁ•¹Í”¹‘…Ñ”¤€è™½Éµ…Ñ5½¹Ñ¡1…‰•°¡•áÁ•¹Í”¹µ½¹Ñ ¤¤¤ì(€€€€€€€½¹ÍÐ¹…µ••±°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€¹…µ••±°¹…ÁÁ•¹‘¡¥±¡‘½Õµ•¹Ð¹É•…Ñ•Q•áÑ9½‘”¡•áÁ•¹Í”¹¹…µ”¤¤ì(€€€€€€€¥˜€¡•áÁ•¹Í”¹¹½Ñ”¤¹…µ••±°¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°•áÁ•¹Í”¹¹½Ñ”¤¤ì(€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡¹…µ••±°¤ì(€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Ñœ°€œœ°•ÕÉ¼¡•áÁ•¹Í”¹…µ½Õ¹Ð¤¤¤ì(€€€€€€€½¹ÍÐ…Ñ¥½¹•±°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€½¹ÍÐ•‘¥Ñ	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€•‘¥Ñ	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€€€•‘¥Ñ	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éä½µÁ…Ðœì(€€€€€€€•‘¥Ñ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ¹‘•É¸œì(€€€€€€€•‘¥Ñ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝÉ½•ÉåáÁ•¹Í•‘¥Ñ½È¡•áÁ•¹Í”¤¤ì(€€€€€€€½¹ÍÐ‘•±•Ñ•	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€‘•±•Ñ•	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€€€‘•±•Ñ•	Ñ¸¹±…ÍÍ9…µ”€ô€‘…¹•È½µÁ…Ðœì(€€€€€€€‘•±•Ñ•	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€3ÙÍ¡•¸œì(€€€€€€€‘•±•Ñ•	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€€€¥˜€ …½¹™¥É´¡¥¹­…Õ˜ƒŠx‘í•áÁ•¹Í”¹¹…µ•÷Špƒñ‰•È€‘í•ÕÉ¼¡•áÁ•¹Í”¹…µ½Õ¹Ð¥ô³ÙÍ¡•¸ý€¤¤É•ÑÕÉ¸ì(€€€€€€€€€‘•±•Ñ•É½•ÉåáÁ•¹Í”¡•áÁ•¹Í”¹¥¤ì(€€€€€€€€€…‘‘¡…¹•1½œ ¥¹­…Õ™Í•±œ°¥¹­…Õ˜•³ÙÍ¡Ðè€‘í•áÁ•¹Í”¹¹…µ•ôƒ
Ü€‘í•ÕÉ¼¡•áÁ•¹Í”¹…µ½Õ¹Ð¥ô¹€°•áÁ•¹Í”¹µ½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô¤ì(€€€€€€€…Ñ¥½¹•±°¹…ÁÁ•¹‘¡¥±¡•‘¥Ñ	Ñ¸¤ì(€€€€€€€…Ñ¥½¹•±°¹…ÁÁ•¹‘¡¥±¡‘•±•Ñ•	Ñ¸¤ì(€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹•±°¤ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì(€€€€€ô¤ì(€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€€€É•µ…¥¹¥¹…É¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€ô(€€€Á…É•¹Ð¹…ÁÁ•¹‘¡¥±¡É•µ…¥¹¥¹…É¤ì((€€€½¹ÍÐÑ…É•Ñ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ…É•Ñ…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€Ñ…É•Ñ…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€5½¹…ÑÍé¥•°…¹Á…ÍÍ•¸œ¤¤ì((€€€½¹ÍÐÑ…É•Ñ‘¥Ñ½È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ…É•Ñ‘¥Ñ½È¹±…ÍÍ9…µ”€ô€ÍÕˆµ…ÉÉ½•ÉäµÑ…É•Ðµ•‘¥Ñ½Èœì(€€€Ñ…É•Ñ‘¥Ñ½È¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ðœ°€œœ°€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€¤¤ì(€€€Ñ…É•Ñ‘¥Ñ½È¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥”ƒ¹‘•ÉÕ¹œ¥±Ð¹ÕÈ›ñÈ‘•¸…ÕÍ•ß‘¡±Ñ•¸5½¹…Ð¸ñÈ…¹‘•É”5½¹…Ñ”¥±Ð‘…Ì™•ÍÑ”5½¹…ÑÍé¥•°¸œ¤¤ì(€€€½¹ÍÐÑ…É•ÑI½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ…É•ÑI½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐÑ…É•Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€Ñ…É•Ñ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€Ñ…É•Ñ%¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€Ñ…É•Ñ%¹ÁÕÐ¹Ù…±Õ”€ô™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡…±Œ¹Ñ…É•Ð¤ì(€€€Ñ…É•Ñ%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸€ÔÀÀ°ÀÀœì(€€€Ñ…É•ÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ •ßñ¹Í¡Ñ•Ì5½¹…ÑÍé¥•°œ°Ñ…É•Ñ%¹ÁÕÐ¤¤ì(€€€½¹ÍÐÑ…É•ÑÑ¥½¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ…É•ÑÑ¥½¹Ì¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐÍ…Ù•Q…É•Ñ	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€Í…Ù•Q…É•Ñ	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€Í…Ù•Q…É•Ñ	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€Í…Ù•Q…É•Ñ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€ñÈ‘¥•Í•¸5½¹…Ðƒñ‰•É¹•¡µ•¸œì(€€€Í…Ù•Q…É•Ñ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡Ñ…É•Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¸Ÿñ±Ñ¥•Ì5½¹…ÑÍé¥•°•¥¹•‰•¸¸-½µµ„µ	•ÑË‘”Í¥¹·Ù±¥ ¸œ¤ì(€€€€€¥˜€ …Í•ÑÉ½•ÉåQ…É•Ñ=Ù•ÉÉ¥‘”¡ÕÉÉ•¹Ñ5½¹Ñ °…µ½Õ¹Ð¤¤É•ÑÕÉ¸…±•ÉÐ …Ì5½¹…ÑÍé¥•°­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤ì(€€€€€½¹ÍÐ¡…¹•€ôÍå¹É½•ÉåQ½ÁUÁáÁ•¹Í”¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€…‘‘¡…¹•1½œ ¥¹­…Õ™Í•±œ°5½¹…ÑÍé¥•°€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ôµ…¹Õ•±°…Õ˜€‘í•ÕÉ¼¡…µ½Õ¹Ð¥ô•Í•ÑéÐ‘í¡…¹•€ü€œÕ¹¥¸‘¥”A±…¹Õ¹œƒñ‰•É¹½µµ•¸œ€è€œô¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€É•¹‘•È ¤ì(€€€ô¤ì(€€€Ñ…É•ÑÑ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡Í…Ù•Q…É•Ñ	Ñ¸¤ì(€€€½¹ÍÐ…ÕÑ½µ…Ñ¥	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€…ÕÑ½µ…Ñ¥	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€…ÕÑ½µ…Ñ¥	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€…ÕÑ½µ…Ñ¥	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€•ÍÑ•Ì5½¹…ÑÍé¥•°Ý¥•‘•É¡•ÉÍÑ•±±•¸œì(€€€…ÕÑ½µ…Ñ¥	Ñ¸¹‘¥Í…‰±•€ôµ…¹Õ…±Q…É•Ð€ôô¹Õ±°ì(€€€…ÕÑ½µ…Ñ¥	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€Í•ÑÉ½•ÉåQ…É•Ñ=Ù•ÉÉ¥‘”¡ÕÉÉ•¹Ñ5½¹Ñ °¹Õ±°¤ì(€€€€€½¹ÍÐ…ÕÑ½µ…Ñ¥…±Œ€ô•ÑÉ½•ÉåQ½ÁUÁ±±½…Ñ¥½¸¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€•Ñ½½‘5½¹•åA½ÍÑÌ ¤¹™½É…  ¡Á½ÍÐ¤€ôøì(€€€€€€€¥˜€ …¥ÍA½ÍÑA…¥‘½É5½¹Ñ ¡Á½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤¤Í•ÑA½ÍÑµ½Õ¹Ñ½É5½¹Ñ ¡Á½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ °9Õµ‰•È¡…ÕÑ½µ…Ñ¥…±Œ¹…±±½…Ñ¥½¹Ì€˜˜…ÕÑ½µ…Ñ¥…±Œ¹…±±½…Ñ¥½¹ÍmÁ½ÍÐ¹¥‘tñð€À¤°€½¹”œ¤ì(€€€€€ô¤ì(€€€€€…‘‘¡…¹•1½œ ¥¹­…Õ™Í•±œ°•ÍÑ•Ì5½¹…ÑÍé¥•°›ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ôÝ¥•‘•É¡•É•ÍÑ•±±Ð¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€É•¹‘•È ¤ì(€€€ô¤ì(€€€Ñ…É•ÑÑ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡…ÕÑ½µ…Ñ¥	Ñ¸¤ì(€€€Ñ…É•Ñ‘¥Ñ½È¹…ÁÁ•¹‘¡¥±¡Ñ…É•ÑI½Ü¤ì(€€€Ñ…É•Ñ‘¥Ñ½È¹…ÁÁ•¹‘¡¥±¡Ñ…É•ÑÑ¥½¹Ì¤ì(€€€Ñ…É•Ñ…É¹…ÁÁ•¹‘¡¥±¡Ñ…É•Ñ‘¥Ñ½È¤ì((€€€½¹ÍÐ¥¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¥¹™¼¹±…ÍÍ9…µ”€ô€¥¹™¼µ‰½àœì(€€€¥˜€¡…±Œ¹…Ñ¥Ù”¤ì(€€€€€¥¹™¼¹¥¹¹•É!Q50€ôµ…¹Õ…±Q…É•Ð€„ô¹Õ±°(€€€€€€€€ü€ñÍÑÉ½¹œù5…¹Õ•±±”5½¹…ÑÍÙ½É…‰”èð½ÍÑÉ½¹œøñÈ‘¥•Í•¸5½¹…ÐÝ•É‘•¸€ñÍÑÉ½¹œø‘í•ÕÉ¼¡…±Œ¹Ñ½ÁUÀ¥ôð½ÍÑÉ½¹œø•¥¹•Á±…¹Ð¹€(€€€€€€€€è€ñÍÑÉ½¹œù•ÍÑ•Ì5½¹…ÑÍé¥•°èð½ÍÑÉ½¹œø€‘í•ÕÉ¼¡…±Œ¹Ñ…É•Ð¥ôì•¥¹•Á±…¹ÐÝ•É‘•¸€ñÍÑÉ½¹œø‘í•ÕÉ¼¡…±Œ¹Ñ½ÁUÀ¥ôð½ÍÑÉ½¹œø¸ƒq‰É¥•Ì•±­½µµÐ¥¹ÌMÁ…É±…Ì¹€ì(€€€ô•±Í”¥˜€¡ÕÉÉ•¹Ñ5½¹Ñ €ôôô½¹™¥œ¹Ñ…É•ÑMÑ…ÉÑ5½¹Ñ ¤ì(€€€€€¥¹™¼¹¥¹¹•É!Q50€ô€ñÍÑÉ½¹œùMÑ…ÉÑµ½¹…Ðèð½ÍÑÉ½¹œøñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ô¥±Ð‘…Ì™•ÍÑ”5½¹…ÑÍé¥•°Ù½¸€ñÍÑÉ½¹œø‘í•ÕÉ¼¡…±Œ¹Ñ…É•Ð¥ôð½ÍÑÉ½¹œø¹€ì(€€€ô•±Í”ì(€€€€€¥¹™¼¹¥¹¹•É!Q50€ô€ñÍÑÉ½¹œù9½ ¹¥¡Ð…­Ñ¥Øèð½ÍÑÉ½¹œø…Ì™•ÍÑ”5½¹…ÑÍé¥•°Ù½¸€‘í•ÕÉ¼¡…±Œ¹Ñ…É•Ð¥ô¥±Ð…ˆ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡½¹™¥œ¹Ñ…É•ÑMÑ…ÉÑ5½¹Ñ ¥ô¹€ì(€€€ô(€€€Ñ…É•Ñ…É¹…ÁÁ•¹‘¡¥±¡¥¹™¼¤ì(€€€Á…É•¹Ð¹…ÁÁ•¹‘¡¥±¡Ñ…É•Ñ…É¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉÉ½•É¥•Ì ¤ì(€€€¥˜€ …É½•ÉåM•Ñ¥½¸¤É•ÑÕÉ¸ì(€€€É½•ÉåM•Ñ¥½¸¹¥¹¹•É!Q50€ô€œœì((€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€½¹ÍÐÑ¥Ñ±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Èœ¤ì(€€€Ñ¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ô€¥¹­…Õ™Í•±œì(€€€…É¹…ÁÁ•¹‘¡¥±¡Ñ¥Ñ±”¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥”5½¹…ÑÍ…¹Í¥¡Ðé•¥Ð¥¹é…¡±Õ¹œ°•É™…ÍÍÑ”¥¹¯‘Õ™”Õ¹‘•¸Ù•É‰±•¥‰•¹‘•¸	•ÑÉ…œ¥¸‘¥•Í•ÈI•¥¡•¹™½±”¸œ¤¤ì(€€€É½•ÉåM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡…É¤ì((€€€É•¹‘•ÉÉ½•ÉåQ½ÁUÁ…É¡É½•ÉåM•Ñ¥½¸¤ì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝMµ½­¥¹áÁ•¹Í•‘¥Ñ½È¡•áÁ•¹Í”€ô¹Õ±°¤ì(€€€½¹ÍÐ¥Í9•Ü€ô€…•áÁ•¹Í”ì(€€€½¹ÍÐ¥Ñ•´€ô•áÁ•¹Í”ñðì(€€€€€¥è•¹•É…Ñ•% ¤°(€€€€€µ½¹Ñ èÕÉÉ•¹Ñ5½¹Ñ °(€€€€€‘…Ñ”è€‘íÕÉÉ•¹Ñ5½¹Ñ¡ô´ÀÅ€°(€€€€€¹…µ”è€œœ°(€€€€€…µ½Õ¹Ðè€À°(€€€€€¹½Ñ”è€œœ(€€€ôì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì((€€€½¹ÍÐÉ½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ‘…Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€‘…Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€‘…Ñ”œì(€€€‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹‘…Ñ”ñð€‘í¥Ñ•´¹µ½¹Ñ ñðÕÉÉ•¹Ñ5½¹Ñ¡ô´ÀÅ€ì(€€€½¹ÍÐ¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹…µ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹…µ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹…µ”ñð€œœì(€€€¹…µ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸Q…‰…¬Õ¹#ñ±Í•¸œì(€€€½¹ÍÐ…µ½Õ¹Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹…µ½Õ¹Ð€ü™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡¥Ñ•´¹…µ½Õ¹Ð¤€è€œœì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸€ÄÈ°ÔÀœì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ …ÑÕ´œ°‘…Ñ•%¹ÁÕÐ¤¤ì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ¥¹­…Õ˜œ°¹…µ•%¹ÁÕÐ¤¤ì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•ÑÉ…œœ°…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì((€€€½¹ÍÐ¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹½Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹½Ñ”ñð€œœì(€€€¹½Ñ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€½ÁÑ¥½¹…°è•Í£‘™Ð½‘•È!¥¹Ý•¥Ìœì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥èœ°¹½Ñ•%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° (€€€€€€Àœ°(€€€€€€Íµ…±°µÕÑ•œ°(€€€€€€¥”ÕÍ…‰”Ý¥É¹ÕÈµ¥Ð‘•´‰•É•¥ÑÌ•¥¹•Á±…¹Ñ•¸I…Õ¡é•Õœµ	Õ‘•ÐÙ•É±¥¡•¸Õ¹¹¥¡Ð¹½ •¥¹µ…°Ù½´5½¹…ÑÍÉ•ÍÐ…‰•é½•¸¸œ(€€€€¤¤ì((€€€Í¡½Ý5½‘…°¡¥Í9•Ü€ü€I…Õ¡é•Õœ•É™…ÍÍ•¸œ€è€I…Õ¡é•ÕœµÕÍ…‰”‰•…É‰•¥Ñ•¸œ°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤ô°(€€€€€ì(€€€€€€€±…‰•°è€MÁ•¥¡•É¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ …‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¸…ÑÕ´•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð€„¡…µ½Õ¹Ð€ø€À¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸	•ÑÉ…œËÛ}•È…±Ì€À•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€€€½¹ÍÐÍ…Ù•€ôÕÁÍ•ÉÑMµ½­¥¹áÁ•¹Í”¡ì(€€€€€€€€€€€¥è¥Ñ•´¹¥°(€€€€€€€€€€€µ½¹Ñ è•Ñ5½¹Ñ¡-•åÉ½µ…Ñ•Y…±Õ”¡‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”°ÕÉÉ•¹Ñ5½¹Ñ ¤°(€€€€€€€€€€€‘…Ñ”è‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€¹…µ”è¹…µ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ñð€I…Õ¡é•Õœœ°(€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€¹½Ñ”è¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤(€€€€€€€€€ô¤ì(€€€€€€€€€¥˜€ …Í…Ù•¤É•ÑÕÉ¸…±•ÉÐ ¥”ÕÍ…‰”­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤ì(€€€€€€€€€…‘‘¡…¹•1½œ I…Õ¡é•Õœœ°€‘í¥Í9•Ü€ü€ÕÍ…‰”•É™…ÍÍÐœ€è€ÕÍ…‰”—‘¹‘•ÉÐôè€‘íÍ…Ù•¹¹…µ•ôƒ
Ü€‘í•ÕÉ¼¡Í…Ù•¹…µ½Õ¹Ð¥ô¹€°Í…Ù•¹µ½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉMµ½­¥¹áÁ•¹Í•Ì ¤ì(€€€¥˜€ …Íµ½­¥¹M•Ñ¥½¸¤É•ÑÕÉ¸ì(€€€Íµ½­¥¹M•Ñ¥½¸¹¥¹¹•É!Q50€ô€œœì(€€€½¹ÍÐ•áÁ•¹Í•Ì€ô•ÑMµ½­¥¹áÁ•¹Í•Ì ¤ì(€€€¥˜€¡ÕÉÉ•¹Ñ5½¹Ñ €øôAI%YQ}!=UM!=1}=91e}MQIQ}5=9Q ¤ì(€€€€€½¹ÍÐÉ•Ñ¥É•‘…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€É•Ñ¥É•‘…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€€€É•Ñ¥É•‘…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Èœ°€œœ°€I…Õ¡é•Õœ‰••¹‘•Ðœ¤¤ì(€€€€€É•Ñ¥É•‘…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”ÍÕ•ÍÌœ°€ˆ=­Ñ½‰•È€ÈÀÈØ¥ÍÐ‰•¤	•¹¹ä­•¥¸I…Õ¡é•Õœµ	Õ‘•Ðµ•¡È•¥¹•Á±…¹Ð¸Ëñ¡•É”¥¹ÑË‘”‰±•¥‰•¸¥¸‘•È!¥ÍÑ½É¥”•É¡…±Ñ•¸¸œ¤¤ì(€€€€€Íµ½­¥¹M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡É•Ñ¥É•‘…É¤ì((€€€€€½¹ÍÐÑ½Ñ…±Ì€ô•ÑMµ½­¥¹5½¹Ñ¡±åQ½Ñ…±Ì ¤(€€€€€€€€¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹µ½¹Ñ €ðAI%YQ}!=UM!=1}=91e}MQIQ}5=9Q ¤(€€€€€€€€¹Í±¥” À°€ÄÈ¤ì(€€€€€½¹ÍÐ¡¥ÍÑ½Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€¡¥ÍÑ½Éä¹±…ÍÍ9…µ”€ô€…Éœì(€€€€€¡¥ÍÑ½Éä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€	¥Í¡•É¥•È5½¹…ÑÍÙ•É±…Õ˜œ¤¤ì(€€€€€¥˜€ …Ñ½Ñ…±Ì¹±•¹Ñ ¤ì(€€€€€€€¡¥ÍÑ½Éä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€-•¥¹”™Ëñ¡•É•¸I…Õ¡é•ÕœµÕÍ…‰•¸Ù½É¡…¹‘•¸¸œ¤¤ì(€€€€€ô•±Í”ì(€€€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”œì(€€€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ù5½¹…Ðð½Ñ øñÑ ùÕÍ…‰•¸ð½Ñ øñÑ ùÕÍ••‰•¸ð½Ñ øñÑ ù	Õ‘•Ðð½Ñ øñÑ ù‰Ý•¥¡Õ¹œð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€€€Ñ½Ñ…±Ì¹™½É…  ¡É½Ü¤€ôøì(€€€€€€€€€½¹ÍÐ‰Õ‘•Ð€ô•ÑMµ½­¥¹	Õ‘•ÑQ…É•Ð¡É½Ü¹µ½¹Ñ ¤ì(€€€€€€€€€½¹ÍÐ‘•±Ñ„€ô‰Õ‘•Ð€´É½Ü¹…µ½Õ¹Ðì(€€€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€€€ÑÈ¹¥¹¹•É!Q50€ô€ñÑø‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡É½Ü¹µ½¹Ñ ¥ôð½ÑøñÑø‘íÉ½Ü¹½Õ¹Ñôð½ÑøñÑø‘í•ÕÉ¼¡É½Ü¹…µ½Õ¹Ð¥ôð½ÑøñÑø‘í•ÕÉ¼¡‰Õ‘•Ð¥ôð½ÑøñÑø‘í‘•±Ñ„€øô€À€ü•ÕÉ¼¡‘•±Ñ„¤€¬€œƒñ‰É¥œœ€è•ÕÉ¼¡5…Ñ ¹…‰Ì¡‘•±Ñ„¤¤€¬€œ‘…Ëñ‰•Èôð½Ñù€ì(€€€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€€€ô¤ì(€€€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€€€€€¡¥ÍÑ½Éä¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€€€ô(€€€€€Íµ½­¥¹M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡¡¥ÍÑ½Éä¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€½¹ÍÐÕÉÉ•¹ÑáÁ•¹Í•Ì€ô•áÁ•¹Í•Ì¹™¥±Ñ•È ¡•áÁ•¹Í”¤€ôø•áÁ•¹Í”¹µ½¹Ñ €ôôôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐÍÁ•¹Ð€ôÕÉÉ•¹ÑáÁ•¹Í•Ì¹É•‘Õ” ¡ÍÕ´°•áÁ•¹Í”¤€ôøÍÕ´€¬9Õµ‰•È¡•áÁ•¹Í”¹…µ½Õ¹Ðñð€À¤°€À¤ì(€€€½¹ÍÐÑ…É•Ð€ô•ÑMµ½­¥¹	Õ‘•ÑQ…É•Ð¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐµ…¹Õ…±Q…É•Ð€ô•ÑMµ½­¥¹Q…É•Ñ=Ù•ÉÉ¥‘”¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ¹½Éµ…±Q…É•Ð€ô•ÑMµ½­¥¹	Õ‘•Ñ	…Í•Q…É•Ð¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ‘¥™™•É•¹”€ôÑ…É•Ð€´ÍÁ•¹Ðì((€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€½¹ÍÐ¡•…‘•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•…‘•È¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐÑ¥Ñ±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Èœ¤ì(€€€Ñ¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ô€I…Õ¡é•Õœœì(€€€Ñ¥Ñ±”¹ÍÑå±”¹™±•à€ô€œÄ€Ä…ÕÑ¼œì(€€€½¹ÍÐ…‘‘	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€…‘‘	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€…‘‘	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€…‘‘	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ¬ÕÍ…‰”œì(€€€…‘‘	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝMµ½­¥¹áÁ•¹Í•‘¥Ñ½È ¤¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡Ñ¥Ñ±”¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡…‘‘	Ñ¸¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡¡•…‘•È¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° (€€€€€€Àœ°(€€€€€€Íµ…±°µÕÑ•œ°(€€€€€€!¥•ÈÑË‘ÍÐ‘Ô•¥¸°Ý…Ì‘ÔÑ…ÑÏ‘¡±¥ ›ñÈI…Õ¡é•Õœ…ÕÍ••‰•¸¡…ÍÐ¸…Ì5½¹…ÑÍ‰Õ‘•Ð­½µµÐ¹½Éµ…±•ÉÝ•¥Í”…ÕÌ‘•´Á•ÉÏÙ¹±¥¡•¸A½ÍÑ•¸ƒŠyI…Õ¡é•ÕŸŠp°­…¹¸›ñÈ‘•¸…ÕÍ•ß‘¡±Ñ•¸5½¹…Ð…‰•Èµ…¹Õ•±°—‘¹‘•ÉÐÝ•É‘•¸¸œ(€€€€¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è	Õ‘•Ð€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€°Ù…±Õ”è•ÕÉ¼¡Ñ…É•Ð¤°­¥¹èÑ…É•Ð€ø€À€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœ°¡¥¹Ðèµ…¹Õ…±Q…É•Ð€„ô¹Õ±°€ü€µ…¹Õ•±°™•ÍÑ•±•Ðœ€è¹½Éµ…°€‘í•ÕÉ¼¡¹½Éµ…±Q…É•Ð¥õ€ô°(€€€€€ì±…‰•°è€ÕÍ••‰•¸œ°Ù…±Õ”è•ÕÉ¼¡ÍÁ•¹Ð¤°­¥¹èÍÁ•¹Ð€øÑ…É•Ð€˜˜Ñ…É•Ð€ø€À€ü€‘…¹•Èœ€è€œœô°(€€€€€ì±…‰•°è‘¥™™•É•¹”€øô€À€ü€9½ ƒñ‰É¥œœ€è€Ÿq‰•È	Õ‘•Ðœ°Ù…±Õ”è•ÕÉ¼¡5…Ñ ¹…‰Ì¡‘¥™™•É•¹”¤¤°­¥¹è‘¥™™•É•¹”€ð€À€ü€‘…¹•Èœ€è€ÍÕ•ÍÌœô°(€€€€€ì±…‰•°è€É™…ÍÍÑ”ÕÍ…‰•¸œ°Ù…±Õ”èMÑÉ¥¹œ¡ÕÉÉ•¹ÑáÁ•¹Í•Ì¹±•¹Ñ ¤ô(€€€t¤¤ì((€€€½¹ÍÐÑ…É•Ñ‘¥Ñ½È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ…É•Ñ‘¥Ñ½È¹±…ÍÍ9…µ”€ô€ÍÕˆµ…ÉÍµ½­¥¹œµÑ…É•Ðµ•‘¥Ñ½Èœì(€€€Ñ…É•Ñ‘¥Ñ½È¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ðœ°€œœ°5½¹…ÑÍ‰Õ‘•Ð›ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€¤¤ì(€€€Ñ…É•Ñ‘¥Ñ½È¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°¥”ƒ¹‘•ÉÕ¹œ¥±Ð¹ÕÈ›ñÈ‘¥•Í•¸5½¹…Ð¸…¹… ¥±ÐÝ¥•‘•È‘•È¹½Éµ…±”	•ÑÉ…œÙ½¸€‘í•ÕÉ¼¡¹½Éµ…±Q…É•Ð¥ô¹€¤¤ì(€€€½¹ÍÐÑ…É•ÑI½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ…É•ÑI½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐÑ…É•Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€Ñ…É•Ñ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€Ñ…É•Ñ%¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€Ñ…É•Ñ%¹ÁÕÐ¹Ù…±Õ”€ô™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡Ñ…É•Ð¤ì(€€€Ñ…É•Ñ%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸€ÐÀ°ÀÀœì(€€€Ñ…É•ÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ •ßñ¹Í¡Ñ•Ì5½¹…ÑÍ‰Õ‘•Ðœ°Ñ…É•Ñ%¹ÁÕÐ¤¤ì(€€€½¹ÍÐÑ…É•ÑÑ¥½¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ…É•ÑÑ¥½¹Ì¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐÍ…Ù•Q…É•Ñ	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€Í…Ù•Q…É•Ñ	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€Í…Ù•Q…É•Ñ	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€Í…Ù•Q…É•Ñ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€ñÈ‘¥•Í•¸5½¹…Ðƒñ‰•É¹•¡µ•¸œì(€€€Í…Ù•Q…É•Ñ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡Ñ…É•Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¸Ÿñ±Ñ¥•Ì5½¹…ÑÍ‰Õ‘•Ð•¥¹•‰•¸¸-½µµ„µ	•ÑË‘”Í¥¹·Ù±¥ ¸œ¤ì(€€€€€½¹ÍÐ‘Õ•A½ÍÑÌ€ô•ÑMµ½­¥¹	Õ‘•ÑA½ÍÑÌ ¤¹™¥±Ñ•È ¡Á½ÍÐ¤€ôø¥ÍÕ”¡Á½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤¤ì(€€€€€¥˜€ …‘Õ•A½ÍÑÌ¹±•¹Ñ ¤É•ÑÕÉ¸…±•ÉÐ ñÈ‘¥•Í•¸5½¹…Ð¥ÍÐ­•¥¸Á•ÉÏÙ¹±¥¡•ÈA½ÍÑ•¸ƒŠyI…Õ¡é•ÕŸŠp•¥¹•Á±…¹Ð¸	¥ÑÑ”±•”¥¡¸éÕ•ÉÍÐÕ¹Ñ•ÈƒŠyA•ÉÏÙ¹±¥¡”ÕÍ…‰•»Šp…¸¸œ¤ì(€€€€€¥˜€¡‘Õ•A½ÍÑÌ¹Í½µ” ¡Á½ÍÐ¤€ôø¥ÍA½ÍÑA…¥‘½É5½¹Ñ ¡Á½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤¤¤É•ÑÕÉ¸…±•ÉÐ …ÌI…Õ¡é•Õœµ	Õ‘•Ð¥ÍÐ›ñÈ‘¥•Í•¸5½¹…Ð‰•É•¥ÑÌ…±Ì‰•é…¡±Ðµ…É­¥•ÉÐ¸ƒY™™¹”éÕ•ÉÍÐƒŠyA•ÉÏÙ¹±¥¡”ÕÍ…‰•»ŠpÕ¹•¹Ñ™•É¹”‘½ÉÐ‘¥”	•é…¡±Ðµ5…É­¥•ÉÕ¹œ¸…¹… ­…¹¹ÍÐ‘Ô‘•¸5½¹…ÑÍ‰•ÑÉ…œƒ‘¹‘•É¸¸œ¤ì(€€€€€¥˜€ …Í•ÑMµ½­¥¹Q…É•Ñ=Ù•ÉÉ¥‘”¡ÕÉÉ•¹Ñ5½¹Ñ °…µ½Õ¹Ð¤¤É•ÑÕÉ¸…±•ÉÐ …Ì5½¹…ÑÍ‰Õ‘•Ð­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤ì(€€€€€½¹ÍÐ¡…¹•€ôÍå¹Mµ½­¥¹	Õ‘•ÑQ…É•Ð¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€…‘‘¡…¹•1½œ I…Õ¡é•Õœœ°5½¹…ÑÍ‰Õ‘•Ð€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ôµ…¹Õ•±°…Õ˜€‘í•ÕÉ¼¡…µ½Õ¹Ð¥ô•Í•ÑéÐ‘í¡…¹•€ü€œÕ¹¥¸‘¥”A±…¹Õ¹œƒñ‰•É¹½µµ•¸œ€è€œô¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€É•¹‘•È ¤ì(€€€ô¤ì(€€€Ñ…É•ÑÑ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡Í…Ù•Q…É•Ñ	Ñ¸¤ì(€€€½¹ÍÐ¹½Éµ…±	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€¹½Éµ…±	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€¹½Éµ…±	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€¹½Éµ…±	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€]¥•‘•È¹½Éµ…±•¸	•ÑÉ…œÙ•ÉÝ•¹‘•¸œì(€€€¹½Éµ…±	Ñ¸¹‘¥Í…‰±•€ôµ…¹Õ…±Q…É•Ð€ôô¹Õ±°ì(€€€¹½Éµ…±	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€Í•ÑMµ½­¥¹Q…É•Ñ=Ù•ÉÉ¥‘”¡ÕÉÉ•¹Ñ5½¹Ñ °¹Õ±°¤ì(€€€€€Íå¹Mµ½­¥¹	Õ‘•ÑQ…É•Ð¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€…‘‘¡…¹•1½œ I…Õ¡é•Õœœ°5½¹…ÑÍ‰Õ‘•Ð€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ôÝ¥•‘•È…Õ˜‘•¸¹½Éµ…±•¸	•ÑÉ…œ€‘í•ÕÉ¼¡¹½Éµ…±Q…É•Ð¥ô•ÍÑ•±±Ð¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€É•¹‘•È ¤ì(€€€ô¤ì(€€€Ñ…É•ÑÑ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡¹½Éµ…±	Ñ¸¤ì(€€€Ñ…É•Ñ‘¥Ñ½È¹…ÁÁ•¹‘¡¥±¡Ñ…É•ÑI½Ü¤ì(€€€Ñ…É•Ñ‘¥Ñ½È¹…ÁÁ•¹‘¡¥±¡Ñ…É•ÑÑ¥½¹Ì¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡Ñ…É•Ñ‘¥Ñ½È¤ì((€€€¥˜€ „¡Ñ…É•Ð€ø€À¤¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”Ý…É¹¥¹œœ°€ñÈ‘¥•Í•¸5½¹…Ð¥ÍÐ­•¥¸Á•ÉÏÙ¹±¥¡•ÈA½ÍÑ•¸ƒŠyI…Õ¡é•ÕŸŠp•¥¹•Á±…¹Ð¸ÕÍ…‰•¸­…¹¹ÍÐ‘ÔÑÉ½Ñé‘•´•É™…ÍÍ•¸¸œ¤¤ì(€€€ô((€€€¥˜€ …ÕÉÉ•¹ÑáÁ•¹Í•Ì¹±•¹Ñ ¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ôÍ¥¹¹½ ­•¥¹”I…Õ¡é•ÕœµÕÍ…‰•¸•É™…ÍÍÐ¹€¤¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”œì(€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ù…ÑÕ´ð½Ñ øñÑ ù¥¹­…Õ˜ð½Ñ øñÑ ù	•ÑÉ…œð½Ñ øñÑ ù9½Ñ¥èð½Ñ øñÑ ù­Ñ¥½¸ð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€ÕÉÉ•¹ÑáÁ•¹Í•Ì¹™½É…  ¡•áÁ•¹Í”¤€ôøì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€½¹ÍÐ‘…Ñ•Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€‘…Ñ•Q¹Ñ•áÑ½¹Ñ•¹Ð€ô•áÁ•¹Í”¹‘…Ñ”ñð€œ´œì(€€€€€€€½¹ÍÐ¹…µ•Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€¹…µ•Q¹Ñ•áÑ½¹Ñ•¹Ð€ô•áÁ•¹Í”¹¹…µ”ì(€€€€€€€½¹ÍÐ…µ½Õ¹ÑQ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€…µ½Õ¹ÑQ¹Ñ•áÑ½¹Ñ•¹Ð€ô•ÕÉ¼¡•áÁ•¹Í”¹…µ½Õ¹Ð¤ì(€€€€€€€½¹ÍÐ¹½Ñ•Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€¹½Ñ•Q¹Ñ•áÑ½¹Ñ•¹Ð€ô•áÁ•¹Í”¹¹½Ñ”ñð€œ´œì(€€€€€€€½¹ÍÐ…Ñ¥½¹Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€…Ñ¥½¹Q¹…ÁÁ•¹‘¡¥±¡É•…Ñ•Ñ¥½¹5•¹Ô¡l(€€€€€€€€€ì±…‰•°è€	•…É‰•¥Ñ•¸œ°±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½ÝMµ½­¥¹áÁ•¹Í•‘¥Ñ½È¡•áÁ•¹Í”¤ô°(€€€€€€€€€ì±…‰•°è€3ÙÍ¡•¸œ°±…ÍÍ9…µ”è€‘…¹•Èœ°½¹±¥¬è€ ¤€ôøì(€€€€€€€€€€€¥˜€¡½¹™¥É´¡€ˆ‘í•áÁ•¹Í”¹¹…µ•ôˆ³ÙÍ¡•¸ý€¤¤ì(€€€€€€€€€€€€€‘•±•Ñ•Mµ½­¥¹áÁ•¹Í”¡•áÁ•¹Í”¹¥¤ì(€€€€€€€€€€€€€…‘‘¡…¹•1½œ I…Õ¡é•Õœœ°ÕÍ…‰”•³ÙÍ¡Ðè€‘í•áÁ•¹Í”¹¹…µ•ôƒ
Ü€‘í•ÕÉ¼¡•áÁ•¹Í”¹…µ½Õ¹Ð¥ô¹€°•áÁ•¹Í”¹µ½¹Ñ ¤ì(€€€€€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€ô(€€€€€€€€€ôô(€€€€€€€t¤¤ì(€€€€€€€ÑÈ¹…ÁÁ•¹‘¡¥±¡‘…Ñ•Q¤ì(€€€€€€€ÑÈ¹…ÁÁ•¹‘¡¥±¡¹…µ•Q¤ì(€€€€€€€ÑÈ¹…ÁÁ•¹‘¡¥±¡…µ½Õ¹ÑQ¤ì(€€€€€€€ÑÈ¹…ÁÁ•¹‘¡¥±¡¹½Ñ•Q¤ì(€€€€€€€ÑÈ¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹Q¤ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€ô¤ì(€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€ô(€€€Íµ½­¥¹M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡…É¤ì((€€€½¹ÍÐÑ½Ñ…±Ì€ô•ÑMµ½­¥¹5½¹Ñ¡±åQ½Ñ…±Ì ¤¹Í±¥” À°€ÄÈ¤ì(€€€½¹ÍÐ¡¥ÍÑ½Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡¥ÍÑ½Éä¹±…ÍÍ9…µ”€ô€…Éœì(€€€¡¥ÍÑ½Éä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€5½¹…ÑÍÙ•É±…Õ˜œ¤¤ì(€€€¡¥ÍÑ½Éä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€M¼Í¥•¡ÍÐ‘Ô°½ˆ‘…Ì•¥¹•Á±…¹Ñ”I…Õ¡é•Õœµ	Õ‘•Ð¥¸‘•¸•¥¹é•±¹•¸5½¹…Ñ•¸…ÕÍ•É•¥¡Ð¡…Ð¸œ¤¤ì(€€€¥˜€ …Ñ½Ñ…±Ì¹±•¹Ñ ¤ì(€€€€€¡¥ÍÑ½Éä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€9½ ­•¥¸Y•É±…Õ˜Ù½É¡…¹‘•¸¸œ¤¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”œì(€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ù5½¹…Ðð½Ñ øñÑ ùÕÍ…‰•¸ð½Ñ øñÑ ùÕÍ••‰•¸ð½Ñ øñÑ ù	Õ‘•Ðð½Ñ øñÑ ù‰Ý•¥¡Õ¹œð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€Ñ½Ñ…±Ì¹™½É…  ¡É½Ü¤€ôøì(€€€€€€€½¹ÍÐ‰Õ‘•Ð€ô•ÑMµ½­¥¹	Õ‘•ÑQ…É•Ð¡É½Ü¹µ½¹Ñ ¤ì(€€€€€€€½¹ÍÐ‘•±Ñ„€ô‰Õ‘•Ð€´É½Ü¹…µ½Õ¹Ðì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€ÑÈ¹¥¹¹•É!Q50€ô€ñÑø‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡É½Ü¹µ½¹Ñ ¥ôð½ÑøñÑø‘íÉ½Ü¹½Õ¹Ñôð½ÑøñÑø‘í•ÕÉ¼¡É½Ü¹…µ½Õ¹Ð¥ôð½ÑøñÑø‘í•ÕÉ¼¡‰Õ‘•Ð¥ôð½ÑøñÑø‘í‘•±Ñ„€øô€À€ü•ÕÉ¼¡‘•±Ñ„¤€¬€œƒñ‰É¥œœ€è•ÕÉ¼¡5…Ñ ¹…‰Ì¡‘•±Ñ„¤¤€¬€œ‘…Ëñ‰•Èôð½Ñù€ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€ô¤ì(€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€€€¡¥ÍÑ½Éä¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€ô(€€€Íµ½­¥¹M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡¡¥ÍÑ½Éä¤ì(€ô((€™Õ¹Ñ¥½¸™½Éµ…ÑM•±™µÁ±½åµ•¹Ñ…Ñ”¡‘…Ñ•Y…±Õ”¤ì(€€€½¹ÍÐÁ…ÉÑÌ€ôMÑÉ¥¹œ¡‘…Ñ•Y…±Õ”ñð€œœ¤¹ÍÁ±¥Ð œ´œ¤ì(€€€É•ÑÕÉ¸Á…ÉÑÌ¹±•¹Ñ €ôôô€Ì€ü€‘íÁ…ÉÑÍlÉuô¸‘íÁ…ÉÑÍlÅuô¸‘íÁ…ÉÑÍlÁuõ€€èMÑÉ¥¹œ¡‘…Ñ•Y…±Õ”ñð€œ´œ¤ì(€ô((€™Õ¹Ñ¥½¸•Ñ•™…Õ±ÑM•±™µÁ±½åµ•¹Ñ…Ñ” ¤ì(€€€½¹ÍÐ¹½Ü€ô¹•Ü…Ñ” ¤ì(€€€½¹ÍÐ±½…±Q½‘…ä€ô€‘í¹½Ü¹•ÑÕ±±e•…È ¥ô´‘íMÑÉ¥¹œ¡¹½Ü¹•Ñ5½¹Ñ  ¤€¬€Ä¤¹Á…‘MÑ…ÉÐ È°€œÀœ¥ô´‘íMÑÉ¥¹œ¡¹½Ü¹•Ñ…Ñ” ¤¤¹Á…‘MÑ…ÉÐ È°€œÀœ¥õ€ì(€€€É•ÑÕÉ¸±½…±Q½‘…ä¹ÍÑ…ÉÑÍ]¥Ñ ¡€‘íÕÉÉ•¹Ñ5½¹Ñ¡ôµ€¤€ü±½…±Q½‘…ä€è€‘íÕÉÉ•¹Ñ5½¹Ñ¡ô´ÀÅ€ì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝM•±™µÁ±½åµ•¹Ñ¹ÑÉå‘¥Ñ½È¡•¹ÑÉä€ô¹Õ±°°É•ÅÕ•ÍÑ•‘QåÁ”€ô€¥¹½µ”œ¤ì(€€€½¹ÍÐ™œ€ô¹½Éµ…±¥é•M•±™µÁ±½åµ•¹Ð ¤ì(€€€½¹ÍÐ¥Í9•Ü€ô€…•¹ÑÉäì(€€€½¹ÍÐ¥Ñ•´€ô•¹ÑÉäñðì(€€€€€¥è•¹•É…Ñ•% ¤°(€€€€€‘…Ñ”è•Ñ•™…Õ±ÑM•±™µÁ±½åµ•¹Ñ…Ñ” ¤°(€€€€€ÑåÁ”èÉ•ÅÕ•ÍÑ•‘QåÁ”€ôôô€•áÁ•¹Í”œ€ü€•áÁ•¹Í”œ€è€¥¹½µ”œ°(€€€€€‘•ÍÉ¥ÁÑ¥½¸è€œœ°(€€€€€…Ñ•½Éäè€œœ°(€€€€€…µ½Õ¹Ðè€À°(€€€€€Ù…ÑI…Ñ”è€À°(€€€€€Á…åµ•¹Ñ5•Ñ¡½è€ÑÉ…¹Í™•Èœ°(€€€€€¥¹½µ•M½ÕÉ”èÉ•ÅÕ•ÍÑ•‘QåÁ”€ôôô€¥¹½µ”œ€ü€Ñ…Í­É…‰‰¥Ðœ€è€½Ñ¡•Èœ°(€€€€€Ñ…Í­É…‰‰¥Ñ	É•…­‘½Ý¸èìÝ…”è€À°µ…Ñ•É¥…°è€À°Ñ¥Àè€Àô°(€€€€€‘½Õµ•¹Ñ9Õµ‰•Èè€œœ°(€€€€€¹½Ñ”è€œœ°(€€€€€‰Õ‘•Ñ5½‘”èÉ•ÅÕ•ÍÑ•‘QåÁ”€ôôô€•áÁ•¹Í”œ€ü€…±É•…‘å}½Õ¹Ñ•œ€è€…ÕÑ½}½Õ¹Ðœ°(€€€€€±¥¹­•‘	Õ™™•ÉáÁ•¹Í•%è€œœ(€€€ôì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´Í•±˜µ•µÁ±½åµ•¹Ðµ™½É´œì((€€€½¹ÍÐ™¥ÉÍÑI½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€™¥ÉÍÑI½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ‘…Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€‘…Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€‘…Ñ”œì(€€€‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹‘…Ñ”ñð•Ñ•™…Õ±ÑM•±™µÁ±½åµ•¹Ñ…Ñ” ¤ì(€€€½¹ÍÐÑåÁ•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€ÑåÁ•M•±•Ð¹¥¹¹•É!Q50€ô€œñ½ÁÑ¥½¸Ù…±Õ”ô‰¥¹½µ”ˆù¥¹¹…¡µ”ð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ô‰•áÁ•¹Í”ˆùÕÍ…‰”ð½½ÁÑ¥½¸øœì(€€€ÑåÁ•M•±•Ð¹Ù…±Õ”€ô¥Ñ•´¹ÑåÁ”€ôôô€•áÁ•¹Í”œ€ü€•áÁ•¹Í”œ€è€¥¹½µ”œì(€€€½¹ÍÐ…µ½Õ¹Ñ%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡¥Ñ•´¹…µ½Õ¹Ðñð€œœ¤ì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸€ÄÈÔ°ÀÀœì(€€€™¥ÉÍÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i…¡±Õ¹Í‘…ÑÕ´œ°‘…Ñ•%¹ÁÕÐ¤¤ì(€€€™¥ÉÍÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ÉÐœ°ÑåÁ•M•±•Ð¤¤ì(€€€™¥ÉÍÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•é…¡±Ñ•È	•ÑÉ…œœ°…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡™¥ÉÍÑI½Ü¤ì((€€€½¹ÍÐ¥¹½µ•M½ÕÉ•I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¥¹½µ•M½ÕÉ•I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ¥¹½µ•M½ÕÉ•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€¥¹½µ•M½ÕÉ•M•±•Ð¹¥¹¹•É!Q50€ôl(€€€€€€œñ½ÁÑ¥½¸Ù…±Õ”ô‰Ñ…Í­É…‰‰¥ÐˆùQ…Í­É…‰‰¥ÐƒŠL…´)…¡É•Í•¹‘”‹ñ¹‘•±¸ð½½ÁÑ¥½¸øœ°(€€€€€€œñ½ÁÑ¥½¸Ù…±Õ”ô‰½Ñ¡•Èˆù¹‘•É”¥¹¹…¡µ”ƒŠL•¥¹é•±¸…Õ™›ñ¡É•¸ð½½ÁÑ¥½¸øœ(€€€t¹©½¥¸ œœ¤ì(€€€¥¹½µ•M½ÕÉ•M•±•Ð¹Ù…±Õ”€ô¥Ñ•´¹¥¹½µ•M½ÕÉ”€ôôô€Ñ…Í­É…‰‰¥Ðœñð€¡¥Í9•Ü€˜˜É•ÅÕ•ÍÑ•‘QåÁ”€ôôô€¥¹½µ”œ¤(€€€€€€ü€Ñ…Í­É…‰‰¥Ðœ(€€€€€€è€½Ñ¡•Èœì(€€€¥¹½µ•M½ÕÉ•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ¥¹¹…¡µ•¹ÅÕ•±±”œ°¥¹½µ•M½ÕÉ•M•±•Ð¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¥¹½µ•M½ÕÉ•I½Ü¤ì((€€€½¹ÍÐÑ…Í­É…‰‰¥Ñ	½à€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ…Í­É…‰‰¥Ñ	½à¹±…ÍÍ9…µ”€ô€‘•Ñ…¥±Ìµ‰½àœì(€€€Ñ…Í­É…‰‰¥Ñ	½à¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€Q…Í­É…‰‰¥ÐµÕÍé…¡±Õ¹œ…Õ™Ñ•¥±•¸œ¤¤ì(€€€Ñ…Í­É…‰‰¥Ñ	½à¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€QÉ…”‘¥”‘É•¤	•ÍÑ…¹‘Ñ•¥±”‘•È•µ•¥¹Í…µ•¸ÕÍé…¡±Õ¹œ•¥¸¸•È‰•é…¡±Ñ”•Í…µÑ‰•ÑÉ…œÝ¥É…ÕÑ½µ…Ñ¥Í ‰•É•¡¹•Ð¸œ¤¤ì(€€€½¹ÍÐÑ…Í­É…‰‰¥ÑI½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ…Í­É…‰‰¥ÑI½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ¥¹¥Ñ¥…±Q…Í­É…‰‰¥Ñ	É•…­‘½Ý¸€ô¹½Éµ…±¥é•Q…Í­É…‰‰¥Ñ	É•…­‘½Ý¸ (€€€€€¥Ñ•´¹Ñ…Í­É…‰‰¥Ñ	É•…­‘½Ý¸°(€€€€€¥Ñ•´¹¥¹½µ•M½ÕÉ”€ôôô€Ñ…Í­É…‰‰¥Ðœ€ü¥Ñ•´¹…µ½Õ¹Ð€è€À(€€€€¤ì(€€€½¹ÍÐÑ…Í­É…‰‰¥Ñ]…•%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡¥¹¥Ñ¥…±Q…Í­É…‰‰¥Ñ	É•…­‘½Ý¸¹Ý…”ñð€œœ¤ì(€€€½¹ÍÐÑ…Í­É…‰‰¥Ñ5…Ñ•É¥…±%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡¥¹¥Ñ¥…±Q…Í­É…‰‰¥Ñ	É•…­‘½Ý¸¹µ…Ñ•É¥…°ñð€œœ¤ì(€€€½¹ÍÐÑ…Í­É…‰‰¥ÑQ¥Á%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡¥¹¥Ñ¥…±Q…Í­É…‰‰¥Ñ	É•…­‘½Ý¸¹Ñ¥Àñð€œœ¤ì(€€€Ñ…Í­É…‰‰¥Ñ]…•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€œÀ°ÀÀœì(€€€Ñ…Í­É…‰‰¥Ñ5…Ñ•É¥…±%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€œÀ°ÀÀœì(€€€Ñ…Í­É…‰‰¥ÑQ¥Á%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€œÀ°ÀÀœì(€€€Ñ…Í­É…‰‰¥ÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 1½¡¸œ°Ñ…Í­É…‰‰¥Ñ]…•%¹ÁÕÐ¤¤ì(€€€Ñ…Í­É…‰‰¥ÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 5…Ñ•É¥…°œ°Ñ…Í­É…‰‰¥Ñ5…Ñ•É¥…±%¹ÁÕÐ¤¤ì(€€€Ñ…Í­É…‰‰¥ÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ QÉ¥¹­•±œ°Ñ…Í­É…‰‰¥ÑQ¥Á%¹ÁÕÐ¤¤ì(€€€Ñ…Í­É…‰‰¥Ñ	½à¹…ÁÁ•¹‘¡¥±¡Ñ…Í­É…‰‰¥ÑI½Ü¤ì(€€€½¹ÍÐÑ…Í­É…‰‰¥ÑQ½Ñ…°€ôÉ•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”ÍÕ•ÍÌœ°€•Í…µÑ…ÕÍé…¡±Õ¹œè€À°ÀÀƒŠ
°œ¤ì(€€€Ñ…Í­É…‰‰¥Ñ	½à¹…ÁÁ•¹‘¡¥±¡Ñ…Í­É…‰‰¥ÑQ½Ñ…°¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Ñ…Í­É…‰‰¥Ñ	½à¤ì((€€€½¹ÍÐÍ•½¹‘I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Í•½¹‘I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹‘•ÍÉ¥ÁÑ¥½¸ñð€œœì(€€€‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸I•¡¹Õ¹œ-Õ¹‘”7ñ±±•Èœì(€€€½¹ÍÐ…Ñ•½ÉåM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€½¹ÍÐÙ…ÑM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€Ù…ÑM•±•Ð¹¥¹¹•É!Q50€ô€œñ½ÁÑ¥½¸Ù…±Õ”ôˆÀˆøÀ€”ð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ôˆÜˆøÜ€”ð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ôˆÄäˆøÄä€”ð½½ÁÑ¥½¸øœì(€€€Ù…ÑM•±•Ð¹Ù…±Õ”€ôMÑÉ¥¹œ¡9Õµ‰•È¡¥Ñ•´¹Ù…ÑI…Ñ”ñð€À¤¤ì(€€€Í•½¹‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•Í¡É•¥‰Õ¹œœ°‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ¤¤ì(€€€Í•½¹‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ qHµ-…Ñ•½É¥”œ°…Ñ•½ÉåM•±•Ð¤¤ì(€€€Í•½¹‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ UµÍ…ÑéÍÑ•Õ•È¥´	•ÑÉ…œœ°Ù…ÑM•±•Ð¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Í•½¹‘I½Ü¤ì((€€€½¹ÍÐÑ¡¥É‘I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ¡¥É‘I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐÁ…åµ•¹Ñ5•Ñ¡½‘M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹¥¹¹•É!Q50€ô€œñ½ÁÑ¥½¸Ù…±Õ”ô‰ÑÉ…¹Í™•Èˆûq‰•ÉÝ•¥ÍÕ¹œð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ô‰…Í ˆù	…Èð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ô‰‘¥É•Ñ}‘•‰¥Ðˆù1…ÍÑÍ¡É¥™Ðð½½ÁÑ¥½¸øœì(€€€Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹Ù…±Õ”€ô¹½Éµ…±¥é•M•±™µÁ±½åµ•¹ÑA…åµ•¹Ñ5•Ñ¡½¡¥Ñ•´¹Á…åµ•¹Ñ5•Ñ¡½¤ì(€€€½¹ÍÐ‘½Õµ•¹Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€‘½Õµ•¹Ñ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€‘½Õµ•¹Ñ%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹‘½Õµ•¹Ñ9Õµ‰•Èñð€œœì(€€€‘½Õµ•¹Ñ%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€½ÁÑ¥½¹…°°è¸¸I´ÈÀÈØ´ÀÄÐœì(€€€½¹ÍÐ¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹½Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹½Ñ”ñð€œœì(€€€¹½Ñ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€½ÁÑ¥½¹…°œì(€€€Ñ¡¥É‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•é…¡±ÐÁ•Èœ°Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¤¤ì(€€€Ñ¡¥É‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•±•œ´€¼I•¡¹Õ¹Í¹Õµµ•Èœ°‘½Õµ•¹Ñ%¹ÁÕÐ¤¤ì(€€€Ñ¡¥É‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥èœ°¹½Ñ•%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Ñ¡¥É‘I½Ü¤ì((€€€½¹ÍÐ¡½ÕÍ•¡½±‘5½‘•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€¡½ÕÍ•¡½±‘5½‘•M•±•Ð¹¥¹¹•É!Q50€ôl(€€€€€€œñ½ÁÑ¥½¸Ù…±Õ”ô‰‰Õ™™•ÈˆùÕÑ½µ…Ñ¥Í Õ¹Ñ•ÈƒŠyM½¹ÍÑ¥”ÕÍ…‰•»Špƒñ‰•É¹•¡µ•¸ð½½ÁÑ¥½¸øœ°(€€€€€€œñ½ÁÑ¥½¸Ù…±Õ”ô‰…±É•…‘å}½Õ¹Ñ•ˆù	•É•¥ÑÌÕ¹Ñ•ÈƒŠyM½¹ÍÑ¥—Šp½‘•ÈƒŠyA•ÉÏÙ¹±¥£Šp•¥¹•ÑÉ…•¸ð½½ÁÑ¥½¸øœ°(€€€€€€œñ½ÁÑ¥½¸Ù…±Õ”ô‰…ÕÑ½}½Õ¹Ðˆù9ÕÈ¡¥•È¥´•Í…µÑ•¸Ù•É›ñ‰…É•¸	•ÑÉ…œ…‰é¥•¡•¸ð½½ÁÑ¥½¸øœ(€€€t¹©½¥¸ œœ¤ì(€€€½¹ÍÐ±¥¹­•‘	Õ™™•ÉáÁ•¹Í”€ô•ÑM•±™µÁ±½åµ•¹Ñ1¥¹­•‘	Õ™™•ÉáÁ•¹Í”¡¥Ñ•´¤ì(€€€¡½ÕÍ•¡½±‘5½‘•M•±•Ð¹Ù…±Õ”€ô±¥¹­•‘	Õ™™•ÉáÁ•¹Í”(€€€€€€ü€‰Õ™™•Èœ(€€€€€€è€¡¥Í9•Ü€˜˜¥Ñ•´¹ÑåÁ”€ôôô€•áÁ•¹Í”œ€ü€‰Õ™™•Èœ€è€¡¥Ñ•´¹‰Õ‘•Ñ5½‘”€ôôô€…ÕÑ½}½Õ¹Ðœ€ü€…ÕÑ½}½Õ¹Ðœ€è€…±É•…‘å}½Õ¹Ñ•œ¤¤ì(€€€½¹ÍÐ¡½ÕÍ•¡½±‘	Õ‘•Ñ¥•±€ôÉ•…Ñ•1…‰•±%¹ÁÕÐ %´!…ÕÍ¡…±ÑÍÁ±…¸‰•Ëñ­Í¥¡Ñ¥•¸œ°¡½ÕÍ•¡½±‘5½‘•M•±•Ð¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¡½ÕÍ•¡½±‘	Õ‘•Ñ¥•±¤ì(€€€½¹ÍÐ¡½ÕÍ•¡½±‘	Õ‘•Ñ!¥¹Ð€ôÉ•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€	•¤‘•È…ÕÑ½µ…Ñ¥Í¡•¸ƒq‰•É¹…¡µ”•ÉÍ¡•¥¹Ð‘¥”‰•é…¡±Ñ”ÕÍ…‰”Í½™½ÉÐÕ¹Ñ•ÈƒŠyM½¹ÍÑ¥”ÕÍ…‰•»Šp¸M¥”Ý¥ÉÑÉ½Ñé‘•´¹ÕÈ•¥¹µ…°Ù½´Ù•É›ñ‰…É•¸	•ÑÉ…œ…‰•é½•¸¸œ¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¡½ÕÍ•¡½±‘	Õ‘•Ñ!¥¹Ð¤ì(€€€½¹ÍÐÕÁ‘…Ñ•	Õ‘•Ñ5½‘•Y¥Í¥‰¥±¥Ñä€ô€ ¤€ôøì(€€€€€½¹ÍÐ¥ÍáÁ•¹Í”€ôÑåÁ•M•±•Ð¹Ù…±Õ”€ôôô€•áÁ•¹Í”œì(€€€€€½¹ÍÐ¥Í…Í €ôÁ…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹Ù…±Õ”€ôôô€…Í œì(€€€€€¡½ÕÍ•¡½±‘	Õ‘•Ñ¥•±¹¡¥‘‘•¸€ô€…¥ÍáÁ•¹Í”ñð¥Í…Í ì(€€€€€¡½ÕÍ•¡½±‘	Õ‘•Ñ!¥¹Ð¹¡¥‘‘•¸€ô€…¥ÍáÁ•¹Í”ì(€€€€€¡½ÕÍ•¡½±‘	Õ‘•Ñ!¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô¥Í…Í (€€€€€€€€ü€	…È‰•é…¡±Ðè¥”ÕÍ…‰”‰±•¥‰Ð¥¸‘•ÈqH°Ù•Ë‘¹‘•ÉÐ‘•¸•Í…µÑ•¸Ù•É›ñ‰…É•¸	•ÑÉ…œ…‰•È¹¥¡Ð¸œ(€€€€€€€€è€	•¤‘•È…ÕÑ½µ…Ñ¥Í¡•¸ƒq‰•É¹…¡µ”•ÉÍ¡•¥¹Ð‘¥”‰•é…¡±Ñ”ÕÍ…‰”Í½™½ÉÐÕ¹Ñ•ÈƒŠyM½¹ÍÑ¥”ÕÍ…‰•»Šp¸M¥”Ý¥ÉÑÉ½Ñé‘•´¹ÕÈ•¥¹µ…°Ù½´Ù•É›ñ‰…É•¸	•ÑÉ…œ…‰•é½•¸¸œì(€€€ôì((€€€½¹ÍÐÕÁ‘…Ñ•…Ñ•½É¥•Ì€ô€ ¤€ôøì(€€€€€½¹ÍÐ…Ñ•½É¥•Ì€ôÑåÁ•M•±•Ð¹Ù…±Õ”€ôôô€•áÁ•¹Í”œ(€€€€€€€€ü•ÑM•±™µÁ±½åµ•¹ÑáÁ•¹Í•…Ñ•½É¥•Ì ¤(€€€€€€€€è•ÑM•±™µÁ±½åµ•¹Ñ%¹½µ•…Ñ•½É¥•Ì ¤ì(€€€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ô…Ñ•½ÉåM•±•Ð¹Ù…±Õ”ñð¥Ñ•´¹…Ñ•½Éäñð…Ñ•½É¥•ÍlÁtì(€€€€€…Ñ•½ÉåM•±•Ð¹¥¹¹•É!Q50€ô€œœì(€€€€€…Ñ•½É¥•Ì¹™½É…  ¡…Ñ•½Éä¤€ôøì(€€€€€€€½¹ÍÐ½ÁÑ¥½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€€€½ÁÑ¥½¸¹Ù…±Õ”€ô…Ñ•½Éäì(€€€€€€€½ÁÑ¥½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô…Ñ•½Éäì(€€€€€€€…Ñ•½ÉåM•±•Ð¹…ÁÁ•¹‘¡¥±¡½ÁÑ¥½¸¤ì(€€€€€ô¤ì(€€€€€¥˜€¡ÁÉ•Ù¥½ÕÌ€˜˜€……Ñ•½É¥•Ì¹¥¹±Õ‘•Ì¡ÁÉ•Ù¥½ÕÌ¤¤ì(€€€€€€€½¹ÍÐÕÍÑ½´€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€€€ÕÍÑ½´¹Ù…±Õ”€ôÁÉ•Ù¥½ÕÌì(€€€€€€€ÕÍÑ½´¹Ñ•áÑ½¹Ñ•¹Ð€ôÁÉ•Ù¥½ÕÌì(€€€€€€€…Ñ•½ÉåM•±•Ð¹…ÁÁ•¹‘¡¥±¡ÕÍÑ½´¤ì(€€€€€ô(€€€€€…Ñ•½ÉåM•±•Ð¹Ù…±Õ”€ôÁÉ•Ù¥½ÕÌì(€€€€€¥˜€ ……Ñ•½ÉåM•±•Ð¹Ù…±Õ”¤…Ñ•½ÉåM•±•Ð¹Ù…±Õ”€ô…Ñ•½É¥•ÍlÁtì(€€€ôì(€€€½¹ÍÐ•Ñ¹Ñ•É•‘Q…Í­É…‰‰¥Ñ	É•…­‘½Ý¸€ô€ ¤€ôø¹½Éµ…±¥é•Q…Í­É…‰‰¥Ñ	É•…­‘½Ý¸¡ì(€€€€€Ý…”èÑ…Í­É…‰‰¥Ñ]…•%¹ÁÕÐ¹Ù…±Õ”°(€€€€€µ…Ñ•É¥…°èÑ…Í­É…‰‰¥Ñ5…Ñ•É¥…±%¹ÁÕÐ¹Ù…±Õ”°(€€€€€Ñ¥ÀèÑ…Í­É…‰‰¥ÑQ¥Á%¹ÁÕÐ¹Ù…±Õ”(€€€ô¤ì(€€€½¹ÍÐÕÁ‘…Ñ•Q…Í­É…‰‰¥ÑQ½Ñ…°€ô€ ¤€ôøì(€€€€€½¹ÍÐÑ½Ñ…°€ô•ÑQ…Í­É…‰‰¥Ñ	É•…­‘½Ý¹Q½Ñ…°¡•Ñ¹Ñ•É•‘Q…Í­É…‰‰¥Ñ	É•…­‘½Ý¸ ¤¤ì(€€€€€…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”€ôÑ½Ñ…°€ø€À€ü™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡Ñ½Ñ…°¤€è€œœì(€€€€€Ñ…Í­É…‰‰¥ÑQ½Ñ…°¹Ñ•áÑ½¹Ñ•¹Ð€ô•Í…µÑ…ÕÍé…¡±Õ¹œè€‘í•ÕÉ¼¡Ñ½Ñ…°¥õ€ì(€€€ôì(€€€½¹ÍÐÕÁ‘…Ñ•%¹½µ•M½ÕÉ•Y¥Í¥‰¥±¥Ñä€ô€ ¤€ôøì(€€€€€½¹ÍÐ¥Í%¹½µ”€ôÑåÁ•M•±•Ð¹Ù…±Õ”€ôôô€¥¹½µ”œì(€€€€€½¹ÍÐ¥ÍQ…Í­É…‰‰¥Ð€ô¥Í%¹½µ”€˜˜¥¹½µ•M½ÕÉ•M•±•Ð¹Ù…±Õ”€ôôô€Ñ…Í­É…‰‰¥Ðœì(€€€€€¥¹½µ•M½ÕÉ•I½Ü¹¡¥‘‘•¸€ô€…¥Í%¹½µ”ì(€€€€€Ñ…Í­É…‰‰¥Ñ	½à¹¡¥‘‘•¸€ô€…¥ÍQ…Í­É…‰‰¥Ðì(€€€€€…µ½Õ¹Ñ%¹ÁÕÐ¹É•…‘=¹±ä€ô¥ÍQ…Í­É…‰‰¥Ðì(€€€€€…Ñ•½ÉåM•±•Ð¹‘¥Í…‰±•€ô¥ÍQ…Í­É…‰‰¥Ðì(€€€€€¥˜€¡¥ÍQ…Í­É…‰‰¥Ð¤ì(€€€€€€€½¹ÍÐÕÉÉ•¹Ñ	É•…­‘½Ý¸€ô•Ñ¹Ñ•É•‘Q…Í­É…‰‰¥Ñ	É•…­‘½Ý¸ ¤ì(€€€€€€€¥˜€ „¡•ÑQ…Í­É…‰‰¥Ñ	É•…­‘½Ý¹Q½Ñ…°¡ÕÉÉ•¹Ñ	É•…­‘½Ý¸¤€ø€À¤¤ì(€€€€€€€€€½¹ÍÐ•á¥ÍÑ¥¹µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€¡9Õµ‰•È¹¥Í¥¹¥Ñ”¡•á¥ÍÑ¥¹µ½Õ¹Ð¤€˜˜•á¥ÍÑ¥¹µ½Õ¹Ð€ø€À¤ì(€€€€€€€€€€€Ñ…Í­É…‰‰¥Ñ]…•%¹ÁÕÐ¹Ù…±Õ”€ô™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡•á¥ÍÑ¥¹µ½Õ¹Ð¤ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€€€…Ñ•½ÉåM•±•Ð¹Ù…±Õ”€ô€UµÍ…Ñé•É³ÙÍ”œì(€€€€€€€¥˜€ …‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤¤‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ¹Ù…±Õ”€ô€Q…Í­É…‰‰¥ÐµÕÍé…¡±Õ¹œœì(€€€€€€€ÕÁ‘…Ñ•Q…Í­É…‰‰¥ÑQ½Ñ…° ¤ì(€€€€€ô(€€€ôì(€€€±•ÐÁÉ•Ù¥½ÕÍ¹ÑÉåQåÁ”€ôÑåÁ•M•±•Ð¹Ù…±Õ”ì(€€€ÑåÁ•M•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€¥˜€¡ÁÉ•Ù¥½ÕÍ¹ÑÉåQåÁ”€ôôô€¥¹½µ”œ€˜˜ÑåÁ•M•±•Ð¹Ù…±Õ”€ôôô€•áÁ•¹Í”œ¤¡½ÕÍ•¡½±‘5½‘•M•±•Ð¹Ù…±Õ”€ô€‰Õ™™•Èœì(€€€€€ÁÉ•Ù¥½ÕÍ¹ÑÉåQåÁ”€ôÑåÁ•M•±•Ð¹Ù…±Õ”ì(€€€€€ÕÁ‘…Ñ•…Ñ•½É¥•Ì ¤ì(€€€€€ÕÁ‘…Ñ•	Õ‘•Ñ5½‘•Y¥Í¥‰¥±¥Ñä ¤ì(€€€€€ÕÁ‘…Ñ•%¹½µ•M½ÕÉ•Y¥Í¥‰¥±¥Ñä ¤ì(€€€ô¤ì(€€€Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°ÕÁ‘…Ñ•	Õ‘•Ñ5½‘•Y¥Í¥‰¥±¥Ñä¤ì(€€€¥¹½µ•M½ÕÉ•M•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°ÕÁ‘…Ñ•%¹½µ•M½ÕÉ•Y¥Í¥‰¥±¥Ñä¤ì(€€€mÑ…Í­É…‰‰¥Ñ]…•%¹ÁÕÐ°Ñ…Í­É…‰‰¥Ñ5…Ñ•É¥…±%¹ÁÕÐ°Ñ…Í­É…‰‰¥ÑQ¥Á%¹ÁÕÑt¹™½É…  ¡¥¹ÁÕÐ¤€ôøì(€€€€€¥¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¥¹ÁÕÐœ°ÕÁ‘…Ñ•Q…Í­É…‰‰¥ÑQ½Ñ…°¤ì(€€€€€¥¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°ÕÁ‘…Ñ•Q…Í­É…‰‰¥ÑQ½Ñ…°¤ì(€€€ô¤ì(€€€ÕÁ‘…Ñ•…Ñ•½É¥•Ì ¤ì(€€€ÕÁ‘…Ñ•	Õ‘•Ñ5½‘•Y¥Í¥‰¥±¥Ñä ¤ì(€€€ÕÁ‘…Ñ•%¹½µ•M½ÕÉ•Y¥Í¥‰¥±¥Ñä ¤ì((€€€¥˜€¡™œ¹Ñ…á5½‘”€„ôô€Ù…Ñ}É•¥ÍÑ•É•œ¤ì(€€€€€Ù…ÑM•±•Ð¹Ù…±Õ”€ô€œÀœì(€€€€€Ù…ÑM•±•Ð¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”¥¹™¼œ°€-±•¥¹Õ¹Ñ•É¹•¡µ•Èµ5½‘ÕÌè•È‰•é…¡±Ñ”•Í…µÑ‰•ÑÉ…œÝ¥É½¡¹”UµÍ…ÑéÍÑ•Õ•ÈµÕ™Ñ•¥±Õ¹œ•É™…ÍÍÐ¸œ¤¤ì(€€€ô•±Í”ì(€€€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€	¥ÑÑ”‘•¸MÑ•Õ•ÉÍ…Ñèß‘¡±•¸°‘•È¥´‰•é…¡±Ñ•¸•Í…µÑ‰•ÑÉ…œ•¹Ñ¡…±Ñ•¸¥ÍÐ¸i…¡±Õ¹•¸…¸‘…Ì¥¹…¹é…µÐÝ•É‘•¸µ¥Ð€À€”•É™…ÍÍÐ¸œ¤¤ì(€€€ô(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€ñÈ‘¥”qHë‘¡±ÐÉÕ¹‘Ï‘Ñé±¥ ‘…Ìi…¡±Õ¹Í‘…ÑÕ´¸Q…Í­É…‰‰¥ÐµÕÍé…¡±Õ¹•¸Ý¥É­•¸Í½™½ÉÐ…Õ˜‘•¸Ù•É›ñ‰…É•¸	•ÑÉ…œ°Ý•É‘•¸¥¸‘•ÈqHµ1¥ÍÑ”°MXÕ¹A…‰•È•ÉÍÐ…±Ì)…¡É•ÍÍÕµµ”µ¥Ð‘•ÈÕ™Ñ•¥±Õ¹œ¥¸1½¡¸°5…Ñ•É¥…°Õ¹QÉ¥¹­•±•é•¥Ð¸	…Éé…¡±Õ¹•¸Ù•Ë‘¹‘•É¸‘•¸Ù•É›ñ‰…É•¸	•ÑÉ…œ¹¥¡Ð¸œ¤¤ì((€€€Í¡½Ý5½‘…°¡¥Í9•Ü€ü€	•ÑÉ¥•‰ÍÙ½É…¹œ•É™…ÍÍ•¸œ€è€	•ÑÉ¥•‰ÍÙ½É…¹œ‰•…É‰•¥Ñ•¸œ°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤ô°(€€€€€ì(€€€€€€€±…‰•°è€MÁ•¥¡•É¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ¥ÍQ…Í­É…‰‰¥Ð€ôÑåÁ•M•±•Ð¹Ù…±Õ”€ôôô€¥¹½µ”œ€˜˜¥¹½µ•M½ÕÉ•M•±•Ð¹Ù…±Õ”€ôôô€Ñ…Í­É…‰‰¥Ðœì(€€€€€€€€€½¹ÍÐÑ…Í­É…‰‰¥Ñ	É•…­‘½Ý¸€ô•Ñ¹Ñ•É•‘Q…Í­É…‰‰¥Ñ	É•…­‘½Ý¸ ¤ì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ô¥ÍQ…Í­É…‰‰¥Ð(€€€€€€€€€€€€ü•ÑQ…Í­É…‰‰¥Ñ	É•…­‘½Ý¹Q½Ñ…°¡Ñ…Í­É…‰‰¥Ñ	É•…­‘½Ý¸¤(€€€€€€€€€€€€èÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ „½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¸Ÿñ±Ñ¥•Ìi…¡±Õ¹Í‘…ÑÕ´•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð€„¡…µ½Õ¹Ð€ø€À¤¤ì(€€€€€€€€€€€É•ÑÕÉ¸…±•ÉÐ¡¥ÍQ…Í­É…‰‰¥Ð(€€€€€€€€€€€€€€ü€	¥ÑÑ”µ¥¹‘•ÍÑ•¹Ì•¥¹•¸	•ÑÉ…œ‰•¤1½¡¸°5…Ñ•É¥…°½‘•ÈQÉ¥¹­•±•¥¹ÑÉ…•¸¸œ(€€€€€€€€€€€€€€è€	¥ÑÑ”•¥¹•¸	•ÑÉ…œËÛ}•È…±Ì€À•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€€€ô(€€€€€€€€€½¹ÍÐ‘•ÍÉ¥ÁÑ¥½¸€ô‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ñð€¡¥ÍQ…Í­É…‰‰¥Ð€ü€Q…Í­É…‰‰¥ÐµÕÍé…¡±Õ¹œœ€è€œœ¤ì(€€€€€€€€€¥˜€ …‘•ÍÉ¥ÁÑ¥½¸¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹”­ÕÉé”	•Í¡É•¥‰Õ¹œ•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€€€½¹ÍÐÍ…Ù•€ôÕÁÍ•ÉÑM•±™µÁ±½åµ•¹Ñ¹ÑÉä¡ì(€€€€€€€€€€€¥è¥Ñ•´¹¥°(€€€€€€€€€€€‘…Ñ”è‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€ÑåÁ”èÑåÁ•M•±•Ð¹Ù…±Õ”°(€€€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸°(€€€€€€€€€€€…Ñ•½Éäè…Ñ•½ÉåM•±•Ð¹Ù…±Õ”°(€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€Ù…ÑI…Ñ”è™œ¹Ñ…á5½‘”€ôôô€Ù…Ñ}É•¥ÍÑ•É•œ€ü9Õµ‰•È¡Ù…ÑM•±•Ð¹Ù…±Õ”ñð€À¤€è€À°(€€€€€€€€€€€Á…åµ•¹Ñ5•Ñ¡½èÁ…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹Ù…±Õ”°(€€€€€€€€€€€¥¹½µ•M½ÕÉ”è¥ÍQ…Í­É…‰‰¥Ð€ü€Ñ…Í­É…‰‰¥Ðœ€è€½Ñ¡•Èœ°(€€€€€€€€€€€Ñ…Í­É…‰‰¥Ñ	É•…­‘½Ý¸°(€€€€€€€€€€€‘½Õµ•¹Ñ9Õµ‰•Èè‘½Õµ•¹Ñ%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€¹½Ñ”è¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€‰Õ‘•Ñ5½‘”èÑåÁ•M•±•Ð¹Ù…±Õ”€ôôô€•áÁ•¹Í”œ€˜˜¡½ÕÍ•¡½±‘5½‘•M•±•Ð¹Ù…±Õ”€ôôô€…ÕÑ½}½Õ¹Ðœ€ü€…ÕÑ½}½Õ¹Ðœ€è€…±É•…‘å}½Õ¹Ñ•œ°(€€€€€€€€€€€É•ÕÉÉ¥¹Q•µÁ±…Ñ•%è¥Ñ•´¹É•ÕÉÉ¥¹Q•µÁ±…Ñ•%ñð€œœ°(€€€€€€€€€€€É•ÕÉÉ¥¹5½¹Ñ è¥Ñ•´¹É•ÕÉÉ¥¹5½¹Ñ ñð€œœ°(€€€€€€€€€€€±¥¹­•‘	Õ™™•ÉáÁ•¹Í•%è¥Ñ•´¹±¥¹­•‘	Õ™™•ÉáÁ•¹Í•%ñð€œœ(€€€€€€€€€ô°ì(€€€€€€€€€€€¡½ÕÍ•¡½±‘5½‘”èÑåÁ•M•±•Ð¹Ù…±Õ”€ôôô€•áÁ•¹Í”œ€ü¡½ÕÍ•¡½±‘5½‘•M•±•Ð¹Ù…±Õ”€è€…±É•…‘å}½Õ¹Ñ•œ(€€€€€€€€€ô¤ì(€€€€€€€€€¥˜€ …Í…Ù•¤É•ÑÕÉ¸…±•ÉÐ •È	•ÑÉ¥•‰ÍÙ½É…¹œ­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤ì(€€€€€€€€€Í•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…È€ôÍ…Ù•¹‘…Ñ”¹Í±¥” À°€Ð¤ì(€€€€€€€€€…‘‘¡…¹•1½œ (€€€€€€€€€€€€M•±‰ÍÓ‘¹‘¥­•¥Ðœ°(€€€€€€€€€€€€‘íÍ…Ù•¹ÑåÁ”€ôôô€¥¹½µ”œ€ü€¥¹¹…¡µ”œ€è€ÕÍ…‰”ô€‘í¥Í9•Ü€ü€•É™…ÍÍÐœ€è€—‘¹‘•ÉÐôè€‘íÍ…Ù•¹‘•ÍÉ¥ÁÑ¥½¹ôƒ
Ü€‘í•ÕÉ¼¡Í…Ù•¹…µ½Õ¹Ð¥ô¹€°(€€€€€€€€€€€Í…Ù•¹‘…Ñ”¹Í±¥” À°€Ü¤(€€€€€€€€€€¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹áÁ•¹Í•‘¥Ñ½È¡Ñ•µÁ±…Ñ”€ô¹Õ±°¤ì(€€€½¹ÍÐ™œ€ô¹½Éµ…±¥é•M•±™µÁ±½åµ•¹Ð ¤ì(€€€½¹ÍÐ¥Í9•Ü€ô€…Ñ•µÁ±…Ñ”ì(€€€½¹ÍÐ¥Ñ•´€ôÑ•µÁ±…Ñ”ñðì(€€€€€¥è•¹•É…Ñ•% ¤°(€€€€€¹…µ”è€œœ°(€€€€€…Ñ•½Éäè•ÑM•±™µÁ±½åµ•¹ÑáÁ•¹Í•…Ñ•½É¥•Ì ¥lÁt°(€€€€€…µ½Õ¹Ðè€À°(€€€€€¥¹Ñ•ÉÙ…±5½¹Ñ¡Ìè€Ä°(€€€€€ÍÑ…ÉÑ5½¹Ñ èÕÉÉ•¹Ñ5½¹Ñ °(€€€€€•¹‘5½¹Ñ è€œœ°(€€€€€Á…åµ•¹Ñ…äè€Ä°(€€€€€Ù…ÑI…Ñ”è€À°(€€€€€Á…åµ•¹Ñ5•Ñ¡½è€ÑÉ…¹Í™•Èœ°(€€€€€¹½Ñ”è€œœ°(€€€€€¥¹±Õ‘•%¹A•ÉÍ½¹…±	Õ‘•ÐèÑÉÕ”°(€€€€€Á•ÉÍ½¹…±½ÍÑ%è€œœ(€€€ôì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´Í•±˜µ•µÁ±½åµ•¹Ðµ™½É´œì((€€€½¹ÍÐ™¥ÉÍÑI½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€™¥ÉÍÑI½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹…µ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹…µ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹…µ”ñð€œœì(€€€¹…µ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸	Õ¡¡…±ÑÕ¹ÍÍ½™ÑÝ…É”œì(€€€½¹ÍÐ…µ½Õ¹Ñ%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡¥Ñ•´¹…µ½Õ¹Ðñð€œœ¤ì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸€Ää°äÀœì(€€€½¹ÍÐ…Ñ•½ÉåM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€•ÑM•±™µÁ±½åµ•¹ÑáÁ•¹Í•…Ñ•½É¥•Ì ¤¹™½É…  ¡…Ñ•½Éä¤€ôøì(€€€€€½¹ÍÐ½ÁÑ¥½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€½ÁÑ¥½¸¹Ù…±Õ”€ô…Ñ•½Éäì(€€€€€½ÁÑ¥½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô…Ñ•½Éäì(€€€€€…Ñ•½ÉåM•±•Ð¹…ÁÁ•¹‘¡¥±¡½ÁÑ¥½¸¤ì(€€€ô¤ì(€€€¥˜€¡¥Ñ•´¹…Ñ•½Éä€˜˜€…•ÑM•±™µÁ±½åµ•¹ÑáÁ•¹Í•…Ñ•½É¥•Ì ¤¹¥¹±Õ‘•Ì¡¥Ñ•´¹…Ñ•½Éä¤¤ì(€€€€€½¹ÍÐÕÍÑ½´€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€ÕÍÑ½´¹Ù…±Õ”€ô¥Ñ•´¹…Ñ•½Éäì(€€€€€ÕÍÑ½´¹Ñ•áÑ½¹Ñ•¹Ð€ô¥Ñ•´¹…Ñ•½Éäì(€€€€€…Ñ•½ÉåM•±•Ð¹…ÁÁ•¹‘¡¥±¡ÕÍÑ½´¤ì(€€€ô(€€€…Ñ•½ÉåM•±•Ð¹Ù…±Õ”€ô¥Ñ•´¹…Ñ•½Éäñð•ÑM•±™µÁ±½åµ•¹ÑáÁ•¹Í•…Ñ•½É¥•Ì ¥lÁtì(€€€™¥ÉÍÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ÕÍ…‰”œ°¹…µ•%¹ÁÕÐ¤¤ì(€€€™¥ÉÍÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•é…¡±Ñ•È	•ÑÉ…œœ°…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€™¥ÉÍÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ qHµ-…Ñ•½É¥”œ°…Ñ•½ÉåM•±•Ð¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡™¥ÉÍÑI½Ü¤ì((€€€½¹ÍÐÍ•½¹‘I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Í•½¹‘I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ¥¹Ñ•ÉÙ…±M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€¥¹Ñ•ÉÙ…±M•±•Ð¹¥¹¹•É!Q50€ô€œñ½ÁÑ¥½¸Ù…±Õ”ôˆÄˆù5½¹…Ñ±¥ ð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ôˆÌˆùY¥•ÉÑ•±«‘¡É±¥ ð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ôˆÄÈˆù+‘¡É±¥ ð½½ÁÑ¥½¸øœì(€€€¥¹Ñ•ÉÙ…±M•±•Ð¹Ù…±Õ”€ôMÑÉ¥¹œ¡9Õµ‰•È¡¥Ñ•´¹¥¹Ñ•ÉÙ…±5½¹Ñ¡Ìñð€Ä¤¤ì(€€€½¹ÍÐÍÑ…ÉÑ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€ÍÑ…ÉÑ%¹ÁÕÐ¹ÑåÁ”€ô€µ½¹Ñ œì(€€€ÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹ÍÑ…ÉÑ5½¹Ñ ñðÕÉÉ•¹Ñ5½¹Ñ ì(€€€½¹ÍÐ•¹‘%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€•¹‘%¹ÁÕÐ¹ÑåÁ”€ô€µ½¹Ñ œì(€€€•¹‘%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹•¹‘5½¹Ñ ñð€œœì(€€€Í•½¹‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ I¡åÑ¡µÕÌœ°¥¹Ñ•ÉÙ…±M•±•Ð¤¤ì(€€€Í•½¹‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ÉÍÑµ…±Ì›‘±±¥œœ°ÍÑ…ÉÑ%¹ÁÕÐ¤¤ì(€€€Í•½¹‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ¹‘•Ð¥´5½¹…Ð€¡½ÁÑ¥½¹…°¤œ°•¹‘%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Í•½¹‘I½Ü¤ì((€€€½¹ÍÐÑ¡¥É‘I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ¡¥É‘I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ‘…å%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€‘…å%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€‘…å%¹ÁÕÐ¹µ¥¸€ô€œÄœì(€€€‘…å%¹ÁÕÐ¹µ…à€ô€œÈàœì(€€€‘…å%¹ÁÕÐ¹ÍÑ•À€ô€œÄœì(€€€‘…å%¹ÁÕÐ¹Ù…±Õ”€ôMÑÉ¥¹œ¡9Õµ‰•È¡¥Ñ•´¹Á…åµ•¹Ñ…äñð€Ä¤¤ì(€€€½¹ÍÐÙ…ÑM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€Ù…ÑM•±•Ð¹¥¹¹•É!Q50€ô€œñ½ÁÑ¥½¸Ù…±Õ”ôˆÀˆøÀ€”ð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ôˆÜˆøÜ€”ð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ôˆÄäˆøÄä€”ð½½ÁÑ¥½¸øœì(€€€Ù…ÑM•±•Ð¹Ù…±Õ”€ôMÑÉ¥¹œ¡9Õµ‰•È¡¥Ñ•´¹Ù…ÑI…Ñ”ñð€À¤¤ì(€€€½¹ÍÐÁ…åµ•¹Ñ5•Ñ¡½‘M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹¥¹¹•É!Q50€ô€œñ½ÁÑ¥½¸Ù…±Õ”ô‰ÑÉ…¹Í™•Èˆûq‰•ÉÝ•¥ÍÕ¹œð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ô‰…Í ˆù	…Èð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ô‰‘¥É•Ñ}‘•‰¥Ðˆù1…ÍÑÍ¡É¥™Ðð½½ÁÑ¥½¸øœì(€€€Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹Ù…±Õ”€ô¹½Éµ…±¥é•M•±™µÁ±½åµ•¹ÑA…åµ•¹Ñ5•Ñ¡½¡¥Ñ•´¹Á…åµ•¹Ñ5•Ñ¡½¤ì(€€€½¹ÍÐ¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹½Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹½Ñ”ñð€œœì(€€€¹½Ñ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€½ÁÑ¥½¹…°œì(€€€Ñ¡¥É‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i…¡±Õ¹ÍÑ…œ€ ÇŠLÈà¤œ°‘…å%¹ÁÕÐ¤¤ì(€€€Ñ¡¥É‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•é…¡±ÐÁ•Èœ°Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¤¤ì(€€€Ñ¡¥É‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ UµÍ…ÑéÍÑ•Õ•È¥´	•ÑÉ…œœ°Ù…ÑM•±•Ð¤¤ì(€€€Ñ¡¥É‘I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥èœ°¹½Ñ•%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Ñ¡¥É‘I½Ü¤ì((€€€½¹ÍÐÁ•ÉÍ½¹…±1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€Á•ÉÍ½¹…±1…‰•°¹±…ÍÍ9…µ”€ô€¡•¬µ±¥¹”É•ÕÉÉ¥¹œµÁ•ÉÍ½¹…°µ¡•¬œì(€€€½¹ÍÐÁ•ÉÍ½¹…±¡•¬€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€Á•ÉÍ½¹…±¡•¬¹ÑåÁ”€ô€¡•­‰½àœì(€€€Á•ÉÍ½¹…±¡•¬¹¡•­•€ô¥Ñ•´¹¥¹±Õ‘•%¹A•ÉÍ½¹…±	Õ‘•Ð€„ôô™…±Í”ì(€€€Á•ÉÍ½¹…±1…‰•°¹…ÁÁ•¹‘¡¥±¡Á•ÉÍ½¹…±¡•¬¤ì(€€€Á•ÉÍ½¹…±1…‰•°¹…ÁÁ•¹‘¡¥±¡‘½Õµ•¹Ð¹É•…Ñ•Q•áÑ9½‘” œ	•¤	•¹¹äÕ¹Ñ•ÈƒŠyA•ÉÏÙ¹±¥¡”ÕÍ…‰•»Šp…¹é•¥•¸œ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Á•ÉÍ½¹…±1…‰•°¤ì(€€€½¹ÍÐÁ•ÉÍ½¹…±	Õ‘•Ñ!¥¹Ð€ôÉ•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€•È•Í…µÑ”Ù•É›ñ‰…É”	•ÑÉ…œÝ¥É¥µµ•È¹ÕÈ•¥¹µ…°‰•±…ÍÑ•Ð¸•ÈM¡…±Ñ•È‰•ÍÑ¥µµÐ¹ÕÈ°½ˆ‘¥”ÕÍ…‰”éÕÏ‘Ñé±¥ ¥¸	•¹¹åÌÁ•ÉÏÙ¹±¥¡•È1¥ÍÑ”Í¥¡Ñ‰…È¥ÍÐ¸œ¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Á•ÉÍ½¹…±	Õ‘•Ñ!¥¹Ð¤ì(€€€½¹ÍÐÕÁ‘…Ñ•I•ÕÉÉ¥¹A…åµ•¹Ñ5•Ñ¡½€ô€ ¤€ôøì(€€€€€½¹ÍÐ¥Í…Í €ôÁ…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹Ù…±Õ”€ôôô€…Í œì(€€€€€¥˜€¡¥Í…Í ¤Á•ÉÍ½¹…±¡•¬¹¡•­•€ô™…±Í”ì(€€€€€Á•ÉÍ½¹…±¡•¬¹‘¥Í…‰±•€ô¥Í…Í ì(€€€€€Á•ÉÍ½¹…±1…‰•°¹¡¥‘‘•¸€ô¥Í…Í ì(€€€€€Á•ÉÍ½¹…±	Õ‘•Ñ!¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô¥Í…Í (€€€€€€€€ü€	…È‰•é…¡±Ðè¥”ÕÍ…‰”Ý¥É¹ÕÈ›ñÈ‘¥”qHÙ½É•µ•É­ÐÕ¹Ù•Ë‘¹‘•ÉÐ‘•¸Ù•É›ñ‰…É•¸	•ÑÉ…œ¹¥¡Ð¸œ(€€€€€€€€è€•È•Í…µÑ”Ù•É›ñ‰…É”	•ÑÉ…œÝ¥É¥µµ•È¹ÕÈ•¥¹µ…°‰•±…ÍÑ•Ð¸•ÈM¡…±Ñ•È‰•ÍÑ¥µµÐ¹ÕÈ°½ˆ‘¥”ÕÍ…‰”éÕÏ‘Ñé±¥ ¥¸	•¹¹åÌÁ•ÉÏÙ¹±¥¡•È1¥ÍÑ”Í¥¡Ñ‰…È¥ÍÐ¸œì(€€€ôì(€€€Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°ÕÁ‘…Ñ•I•ÕÉÉ¥¹A…åµ•¹Ñ5•Ñ¡½¤ì(€€€ÕÁ‘…Ñ•I•ÕÉÉ¥¹A…åµ•¹Ñ5•Ñ¡½ ¤ì((€€€¥˜€¡™œ¹Ñ…á5½‘”€„ôô€Ù…Ñ}É•¥ÍÑ•É•œ¤ì(€€€€€Ù…ÑM•±•Ð¹Ù…±Õ”€ô€œÀœì(€€€€€Ù…ÑM•±•Ð¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€ô(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”¥¹™¼œ°€¥”ÁÀé•¥Ð‘¥”ÕÍ…‰”¥´›‘±±¥•¸5½¹…Ð…ÕÑ½µ…Ñ¥Í …¸¸%¸‘¥”qH­½µµÐÍ¥”•ÉÍÐ°Ý•¹¸‘ÔƒŠy±Ì‰•é…¡±Ðƒñ‰•É¹•¡µ•»Šp…¹­±¥­ÍÐ¸œ¤¤ì((€€€Í¡½Ý5½‘…°¡¥Í9•Ü€ü€]¥•‘•É­•¡É•¹‘”	•ÑÉ¥•‰Í…ÕÍ…‰”…¹±••¸œ€è€]¥•‘•É­•¡É•¹‘”	•ÑÉ¥•‰Í…ÕÍ…‰”‰•…É‰•¥Ñ•¸œ°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤ô°(€€€€€ì(€€€€€€€±…‰•°è€MÁ•¥¡•É¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ¹…µ”€ô¹…µ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€½¹ÍÐÁ…åµ•¹Ñ…ä€ô5…Ñ ¹É½Õ¹¡9Õµ‰•È¡‘…å%¹ÁÕÐ¹Ù…±Õ”ñð€À¤¤ì(€€€€€€€€€¥˜€ …¹…µ”¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹”­ÕÉé”	•é•¥¡¹Õ¹œ•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð€„¡…µ½Õ¹Ð€ø€À¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸	•ÑÉ…œËÛ}•È…±Ì€À•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€€€¥˜€ …¥Í5½¹Ñ¡-•ä¡ÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸MÑ…ÉÑµ½¹…Ðß‘¡±•¸¸œ¤ì(€€€€€€€€€¥˜€¡•¹‘%¹ÁÕÐ¹Ù…±Õ”€˜˜€ …¥Í5½¹Ñ¡-•ä¡•¹‘%¹ÁÕÐ¹Ù…±Õ”¤ñð•¹‘%¹ÁÕÐ¹Ù…±Õ”€ðÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”¤¤É•ÑÕÉ¸…±•ÉÐ •È¹‘µ½¹…Ð‘…É˜¹¥¡ÐÙ½È‘•´MÑ…ÉÑµ½¹…Ð±¥••¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡Á…åµ•¹Ñ…ä¤ñðÁ…åµ•¹Ñ…ä€ð€ÄñðÁ…åµ•¹Ñ…ä€ø€Èà¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸i…¡±Õ¹ÍÑ…œéÝ¥Í¡•¸€ÄÕ¹€Èà•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€€€½¹ÍÐÍ…Ù•€ôÕÁÍ•ÉÑM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹áÁ•¹Í”¡ì(€€€€€€€€€€€¥è¥Ñ•´¹¥°(€€€€€€€€€€€¹…µ”°(€€€€€€€€€€€…Ñ•½Éäè…Ñ•½ÉåM•±•Ð¹Ù…±Õ”°(€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€¥¹Ñ•ÉÙ…±5½¹Ñ¡Ìè9Õµ‰•È¡¥¹Ñ•ÉÙ…±M•±•Ð¹Ù…±Õ”ñð€Ä¤°(€€€€€€€€€€€ÍÑ…ÉÑ5½¹Ñ èÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€•¹‘5½¹Ñ è•¹‘%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€Á…åµ•¹Ñ…ä°(€€€€€€€€€€€Ù…ÑI…Ñ”è™œ¹Ñ…á5½‘”€ôôô€Ù…Ñ}É•¥ÍÑ•É•œ€ü9Õµ‰•È¡Ù…ÑM•±•Ð¹Ù…±Õ”ñð€À¤€è€À°(€€€€€€€€€€€Á…åµ•¹Ñ5•Ñ¡½èÁ…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹Ù…±Õ”°(€€€€€€€€€€€¹½Ñ”è¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€¥¹±Õ‘•%¹A•ÉÍ½¹…±	Õ‘•ÐèÁ…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹Ù…±Õ”€ôôô€…Í œ€ü™…±Í”€èÁ•ÉÍ½¹…±¡•¬¹¡•­•°(€€€€€€€€€€€Á•ÉÍ½¹…±½ÍÑ%è¥Ñ•´¹Á•ÉÍ½¹…±½ÍÑ%ñð€œœ(€€€€€€€€€ô¤ì(€€€€€€€€€¥˜€ …Í…Ù•¤É•ÑÕÉ¸…±•ÉÐ ¥”Ý¥•‘•É­•¡É•¹‘”ÕÍ…‰”­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤ì(€€€€€€€€€…‘‘¡…¹•1½œ M•±‰ÍÓ‘¹‘¥­•¥Ðœ°]¥•‘•É­•¡É•¹‘”ÕÍ…‰”€‘í¥Í9•Ü€ü€…¹•±•Ðœ€è€—‘¹‘•ÉÐôè€‘íÍ…Ù•¹¹…µ•ôƒ
Ü€‘í•ÕÉ¼¡Í…Ù•¹…µ½Õ¹Ð¥ô€‘í•ÑM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹%¹Ñ•ÉÙ…±1…‰•°¡Í…Ù•¥ô¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹áÁ•¹Í•Ì¡Á…É•¹Ð¤ì(€€€½¹ÍÐÑ•µÁ±…Ñ•Ì€ô•ÑM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹áÁ•¹Í•Ì ¤ì(€€€½¹ÍÐ‘Õ”€ôÑ•µÁ±…Ñ•Ì¹™¥±Ñ•È ¡Ñ•µÁ±…Ñ”¤€ôø¥ÍM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹Õ”¡Ñ•µÁ±…Ñ”°ÕÉÉ•¹Ñ5½¹Ñ ¤¤ì(€€€½¹ÍÐ½Á•¹Õ”€ô‘Õ”¹™¥±Ñ•È ¡Ñ•µÁ±…Ñ”¤€ôø€…•ÑM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹	½½­¥¹œ¡Ñ•µÁ±…Ñ”¹¥°ÕÉÉ•¹Ñ5½¹Ñ ¤¤ì(€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€…ÉÍ•±˜µ•µÁ±½åµ•¹ÐµÉ•ÕÉÉ¥¹œµ…Éœì(€€€½¹ÍÐ¡•…‘•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•…‘•È¹±…ÍÍ9…µ”€ô€Í•±˜µ•µÁ±½åµ•¹Ðµ¡•…œì(€€€½¹ÍÐ½Áä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½Áä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€]¥•‘•É­•¡É•¹‘”	•ÑÉ¥•‰Í…ÕÍ…‰•¸œ¤¤ì(€€€½Áä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°‘±±¥”-½ÍÑ•¸›ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ôÝ•É‘•¸Ù½É‰•É•¥Ñ•ÐÕ¹•ÉÍÐ¹… ‘•¥¹•È	•ÍÓ‘Ñ¥Õ¹œ•‰Õ¡Ð¹€¤¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡½Áä¤ì(€€€½¹ÍÐ…‘‘	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€…‘‘	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€…‘‘	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€…‘‘	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ¬]¥•‘•É­•¡É•¹‘”ÕÍ…‰”œì(€€€…‘‘	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹áÁ•¹Í•‘¥Ñ½È ¤¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡…‘‘	ÕÑÑ½¸¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡¡•…‘•È¤ì((€€€¥˜€ …Ñ•µÁ±…Ñ•Ì¹±•¹Ñ ¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”¥¹™¼œ°€1•”É••±·“}¥”-½ÍÑ•¸•¥¹µ…°…¸ƒŠLéÕ´	•¥ÍÁ¥•°M½™ÑÝ…É”°Y•ÉÍ¥¡•ÉÕ¹œ½‘•ÈA±…ÑÑ™½Éµ•‹ñ¡É•¸¸¥”ÁÀ•É¥¹¹•ÉÐ‘¥ ‘…¹¸…ÕÑ½µ…Ñ¥Í ¥´É¥¡Ñ¥•¸5½¹…Ð¸œ¤¤ì(€€€€€Á…É•¹Ð¹…ÁÁ•¹‘¡¥±¡…É¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è‘±±¥œ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€°Ù…±Õ”è•ÕÉ¼¡‘Õ”¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬9Õµ‰•È¡¥Ñ•´¹…µ½Õ¹Ðñð€À¤°€À¤¤°­¥¹è‘Õ”¹±•¹Ñ €ü€Ý…É¹¥¹œœ€è€ÍÕ•ÍÌœô°(€€€€€ì±…‰•°è€9½ éÔ‰•ÍÓ‘Ñ¥•¸œ°Ù…±Õ”èMÑÉ¥¹œ¡½Á•¹Õ”¹±•¹Ñ ¤°­¥¹è½Á•¹Õ”¹±•¹Ñ €ü€‘…¹•Èœ€è€ÍÕ•ÍÌœô°(€€€€€ì±…‰•°è€­Ñ¥Ù”Y½É±…•¸œ°Ù…±Õ”èMÑÉ¥¹œ¡Ñ•µÁ±…Ñ•Ì¹±•¹Ñ ¤ô(€€€t¤¤ì((€€€¥˜€ …‘Õ”¹±•¹Ñ ¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”ÍÕ•ÍÌœ°ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ô¥ÍÐ­•¥¹”Ý¥•‘•É­•¡É•¹‘”	•ÑÉ¥•‰Í…ÕÍ…‰”›‘±±¥œ¹€¤¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”½µÁ…ÐµÑ…‰±”É•ÕÉÉ¥¹œµ•áÁ•¹Í”µÑ…‰±”œì(€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ùÕÍ…‰”ð½Ñ øñÑ ù	•ÑÉ…œð½Ñ øñÑ ùI¡åÑ¡µÕÌð½Ñ øñÑ ùMÑ…ÑÕÌð½Ñ øñÑ ù­Ñ¥½¸ð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€‘Õ”¹™½É…  ¡Ñ•µÁ±…Ñ”¤€ôøì(€€€€€€€½¹ÍÐ‰½½­¥¹œ€ô•ÑM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹	½½­¥¹œ¡Ñ•µÁ±…Ñ”¹¥°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€½¹ÍÐ¹…µ•Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€¹…µ•Q¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°Ñ•µÁ±…Ñ”¹¹…µ”¤¤ì(€€€€€€€½¹ÍÐÉ•ÕÉÉ¥¹	Õ‘•Ñ1…‰•°€ô¹½Éµ…±¥é•M•±™µÁ±½åµ•¹ÑA…åµ•¹Ñ5•Ñ¡½¡Ñ•µÁ±…Ñ”¹Á…åµ•¹Ñ5•Ñ¡½¤€ôôô€…Í œ(€€€€€€€€€€ü€9ÕÈ¥¸‘•ÈqHì½¡¹”ƒ¹‘•ÉÕ¹œ‘•ÌÙ•É›ñ‰…É•¸	•ÑÉ…Ìœ(€€€€€€€€€€è€¡Ñ•µÁ±…Ñ”¹¥¹±Õ‘•%¹A•ÉÍ½¹…±	Õ‘•Ð€ü€Õ ‰•¤	•¹¹äÁ•ÉÏÙ¹±¥ •¥¹•Á±…¹Ðœ€è€ÕÌ	•ÑÉ¥•‰ÍÁÕ™™•È‰•é…¡±Ðœ¤ì(€€€€€€€¹…µ•Q¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Íµ…±°µÕÑ•œ°€‘íÉ•ÕÉÉ¥¹	Õ‘•Ñ1…‰•±ôƒ
Ü€‘í•ÑM•±™µÁ±½åµ•¹ÑA…åµ•¹Ñ5•Ñ¡½‘1…‰•°¡Ñ•µÁ±…Ñ”¹Á…åµ•¹Ñ5•Ñ¡½¥õ€¤¤ì(€€€€€€€½¹ÍÐ…µ½Õ¹ÑQ€ôÉ•…Ñ•U¥° Ñœ°€œœ°•ÕÉ¼¡Ñ•µÁ±…Ñ”¹…µ½Õ¹Ð¤¤ì(€€€€€€€½¹ÍÐ¥¹Ñ•ÉÙ…±Q€ôÉ•…Ñ•U¥° Ñœ°€œœ°•ÑM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹%¹Ñ•ÉÙ…±1…‰•°¡Ñ•µÁ±…Ñ”¤¤ì(€€€€€€€½¹ÍÐÍÑ…ÑÕÍQ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€ÍÑ…ÑÕÍQ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°‰½½­¥¹œ€ü€Á¥±°ÍÕ•ÍÌœ€è€Á¥±°Ý…É¹¥¹œœ°‰½½­¥¹œ€ü€Ÿq‰•É¹½µµ•¸œ€è€=™™•¸œ¤¤ì(€€€€€€€½¹ÍÐ…Ñ¥½¹Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€¥˜€¡‰½½­¥¹œ¤ì(€€€€€€€€€½¹ÍÐ•‘¥Ñ	½½­¥¹œ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€€€•‘¥Ñ	½½­¥¹œ¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€€€€€•‘¥Ñ	½½­¥¹œ¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€€€€€€€•‘¥Ñ	½½­¥¹œ¹Ñ•áÑ½¹Ñ•¹Ð€ô€	Õ¡Õ¹œ‰•…É‰•¥Ñ•¸œì(€€€€€€€€€•‘¥Ñ	½½­¥¹œ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝM•±™µÁ±½åµ•¹Ñ¹ÑÉå‘¥Ñ½È¡‰½½­¥¹œ¤¤ì(€€€€€€€€€…Ñ¥½¹Q¹…ÁÁ•¹‘¡¥±¡•‘¥Ñ	½½­¥¹œ¤ì(€€€€€€€ô•±Í”ì(€€€€€€€€€½¹ÍÐ‰½½­	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€€€‰½½­	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€€€€€‰½½­	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€€€€€€€‰½½­	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€±Ì‰•é…¡±Ðƒñ‰•É¹•¡µ•¸œì(€€€€€€€€€‰½½­	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€€€€€½¹ÍÐÍ…Ù•€ô‰½½­M•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹áÁ•¹Í”¡Ñ•µÁ±…Ñ”°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€€€¥˜€ …Í…Ù•¤É•ÑÕÉ¸…±•ÉÐ ¥”ÕÍ…‰”­½¹¹Ñ”¹¥¡Ðƒñ‰•É¹½µµ•¸Ý•É‘•¸¸œ¤ì(€€€€€€€€€€€Í•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…È€ôÕÉÉ•¹Ñ5½¹Ñ ¹Í±¥” À°€Ð¤ì(€€€€€€€€€€€…‘‘¡…¹•1½œ M•±‰ÍÓ‘¹‘¥­•¥Ðœ°]¥•‘•É­•¡É•¹‘”ÕÍ…‰”‰•é…¡±Ðƒñ‰•É¹½µµ•¸è€‘íÑ•µÁ±…Ñ”¹¹…µ•ôƒ
Ü€‘í•ÕÉ¼¡Ñ•µÁ±…Ñ”¹…µ½Õ¹Ð¥ô¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€ô¤ì(€€€€€€€€€…Ñ¥½¹Q¹…ÁÁ•¹‘¡¥±¡‰½½­	ÕÑÑ½¸¤ì(€€€€€€€ô(€€€€€€€m¹…µ•Q°…µ½Õ¹ÑQ°¥¹Ñ•ÉÙ…±Q°ÍÑ…ÑÕÍQ°…Ñ¥½¹Q‘t¹™½É…  ¡Ñ¤€ôøÑÈ¹…ÁÁ•¹‘¡¥±¡Ñ¤¤ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€ô¤ì(€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€ô((€€€¥˜€¡½Á•¹Õ”¹±•¹Ñ €ø€Ä¤ì(€€€€€½¹ÍÐ…±±	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€…±±	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€…±±	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌÉ•ÕÉÉ¥¹œµ‰½½¬µ…±°œì(€€€€€…±±	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô±±”€‘í½Á•¹Õ”¹±•¹Ñ¡ô›‘±±¥•¸…±Ì‰•é…¡±Ðƒñ‰•É¹•¡µ•¹€ì(€€€€€…±±	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€±•Ð‰½½­•€ô€Àì(€€€€€€€½Á•¹Õ”¹™½É…  ¡Ñ•µÁ±…Ñ”¤€ôøì(€€€€€€€€€¥˜€¡‰½½­M•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹áÁ•¹Í”¡Ñ•µÁ±…Ñ”°ÕÉÉ•¹Ñ5½¹Ñ ¤¤‰½½­•€¬ô€Äì(€€€€€€€ô¤ì(€€€€€€€¥˜€ …‰½½­•¤É•ÑÕÉ¸…±•ÉÐ Ì­½¹¹Ñ”­•¥¹”ÕÍ…‰”ƒñ‰•É¹½µµ•¸Ý•É‘•¸¸œ¤ì(€€€€€€€Í•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…È€ôÕÉÉ•¹Ñ5½¹Ñ ¹Í±¥” À°€Ð¤ì(€€€€€€€…‘‘¡…¹•1½œ M•±‰ÍÓ‘¹‘¥­•¥Ðœ°€‘í‰½½­•‘ôÝ¥•‘•É­•¡É•¹‘”	•ÑÉ¥•‰Í…ÕÍ…‰•¸…±Ì‰•é…¡±Ðƒñ‰•É¹½µµ•¸¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡…±±	ÕÑÑ½¸¤ì(€€€ô((€€€½¹ÍÐ‘•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€‘•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€‘•Ñ…¥±Ìµ‰½àÉ•ÕÉÉ¥¹œµÑ•µÁ±…Ñ”µ‘•Ñ…¥±Ìœì(€€€½¹ÍÐ‘•Ñ…¥±ÍMÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€‘•Ñ…¥±ÍMÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ôY½É±…•¸Ù•ÉÝ…±Ñ•¸€ ‘íÑ•µÁ±…Ñ•Ì¹±•¹Ñ¡ô¥€ì(€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡‘•Ñ…¥±ÍMÕµµ…Éä¤ì(€€€½¹ÍÐÑ•µÁ±…Ñ•Q…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€Ñ•µÁ±…Ñ•Q…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”½µÁ…ÐµÑ…‰±”œì(€€€Ñ•µÁ±…Ñ•Q…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ùY½É±…”ð½Ñ øñÑ ùI¡åÑ¡µÕÌð½Ñ øñÑ ù;‘¡ÍÑ”‘±±¥­•¥Ðð½Ñ øñÑ ùAÉ¥Ù…Ð•¥¹•Á±…¹Ðð½Ñ øñÑ ù­Ñ¥½¸ð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€½¹ÍÐÑ•µÁ±…Ñ•	½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€Ñ•µÁ±…Ñ•Ì¹™½É…  ¡Ñ•µÁ±…Ñ”¤€ôøì(€€€€€½¹ÍÐ¹•áÑÕ”€ô•Ñ9•áÑM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹5½¹Ñ ¡Ñ•µÁ±…Ñ”°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€½¹ÍÐ¹…µ•Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€¹…µ•Q¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°Ñ•µÁ±…Ñ”¹¹…µ”¤¤ì(€€€€€¹…µ•Q¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Íµ…±°µÕÑ•œ°€‘í•ÕÉ¼¡Ñ•µÁ±…Ñ”¹…µ½Õ¹Ð¥ôƒ
Ü€‘íÑ•µÁ±…Ñ”¹…Ñ•½Éåôƒ
Ü€‘í•ÑM•±™µÁ±½åµ•¹ÑA…åµ•¹Ñ5•Ñ¡½‘1…‰•°¡Ñ•µÁ±…Ñ”¹Á…åµ•¹Ñ5•Ñ¡½¥õ€¤¤ì(€€€€€½¹ÍÐ¥¹Ñ•ÉÙ…±Q€ôÉ•…Ñ•U¥° Ñœ°€œœ°•ÑM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹%¹Ñ•ÉÙ…±1…‰•°¡Ñ•µÁ±…Ñ”¤¤ì(€€€€€½¹ÍÐ¹•áÑQ€ôÉ•…Ñ•U¥° Ñœ°€œœ°¹•áÑÕ”€ü™½Éµ…Ñ5½¹Ñ¡1…‰•°¡¹•áÑÕ”¤€è€	••¹‘•Ðœ¤ì(€€€€€½¹ÍÐÁ•ÉÍ½¹…±Q€ôÉ•…Ñ•U¥° Ñœ°€œœ°Ñ•µÁ±…Ñ”¹¥¹±Õ‘•%¹A•ÉÍ½¹…±	Õ‘•Ð€ü€	•¹¹äœ€è€9•¥¸œ¤ì(€€€€€½¹ÍÐ…Ñ¥½¹Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€…Ñ¥½¹Q¹…ÁÁ•¹‘¡¥±¡É•…Ñ•Ñ¥½¹5•¹Ô¡l(€€€€€€€ì±…‰•°è€	•…É‰•¥Ñ•¸œ°±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½ÝM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹áÁ•¹Í•‘¥Ñ½È¡Ñ•µÁ±…Ñ”¤ô°(€€€€€€€ì±…‰•°è€Y½É±…”³ÙÍ¡•¸œ°±…ÍÍ9…µ”è€‘…¹•Èœ°½¹±¥¬è€ ¤€ôøì(€€€€€€€€€¥˜€ …½¹™¥É´¡Y½É±…”ƒŠx‘íÑ•µÁ±…Ñ”¹¹…µ•÷Šp³ÙÍ¡•¸ü	•É•¥ÑÌƒñ‰•É¹½µµ•¹”qHµ	Õ¡Õ¹•¸‰±•¥‰•¸•É¡…±Ñ•¸¹€¤¤É•ÑÕÉ¸ì(€€€€€€€€€¥˜€¡‘•±•Ñ•M•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹áÁ•¹Í”¡Ñ•µÁ±…Ñ”¹¥¤¤ì(€€€€€€€€€€€…‘‘¡…¹•1½œ M•±‰ÍÓ‘¹‘¥­•¥Ðœ°Y½É±…”•³ÙÍ¡Ðè€‘íÑ•µÁ±…Ñ”¹¹…µ•ô¸	•É•¥ÑÌ•‰Õ¡Ñ”ÕÍ…‰•¸‰±•¥‰•¸•É¡…±Ñ•¸¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€ô(€€€€€€€ôô(€€€€€t¤¤ì(€€€€€m¹…µ•Q°¥¹Ñ•ÉÙ…±Q°¹•áÑQ°Á•ÉÍ½¹…±Q°…Ñ¥½¹Q‘t¹™½É…  ¡Ñ¤€ôøÑÈ¹…ÁÁ•¹‘¡¥±¡Ñ¤¤ì(€€€€€Ñ•µÁ±…Ñ•	½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€ô¤ì(€€€Ñ•µÁ±…Ñ•Q…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ•µÁ±…Ñ•	½‘ä¤ì(€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡Ñ•µÁ±…Ñ•Q…‰±”¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡‘•Ñ…¥±Ì¤ì(€€€Á…É•¹Ð¹…ÁÁ•¹‘¡¥±¡…É¤ì(€ô((€™Õ¹Ñ¥½¸‰Õ¥±‘M•±™µÁ±½åµ•¹ÑI•Á½ÉÑ!Ñµ°¡å•…È°ÍÕµµ…Éä¤ì(€€€½¹ÍÐ™œ€ô¹½Éµ…±¥é•M•±™µÁ±½åµ•¹Ð ¤ì(€€€½¹ÍÐ‰ÕÍ¥¹•ÍÍ9…µ”€ô•Í…Á•!Ñµ°¡™œ¹‰ÕÍ¥¹•ÍÍ9…µ”ñð€M•±‰ÍÓ‘¹‘¥­•¥Ðœ¤ì(€€€½¹ÍÐ…Ñ•½ÉåI½ÝÌ€ôÍÕµµ…Éä¹…Ñ•½É¥•Ì¹±•¹Ñ (€€€€€€üÍÕµµ…Éä¹…Ñ•½É¥•Ì¹µ…À ¡É½Ü¤€ôø€ñÑÈøñÑø‘íÉ½Ü¹ÑåÁ”€ôôô€¥¹½µ”œ€ü€¥¹¹…¡µ”œ€è€ÕÍ…‰”ôð½ÑøñÑø‘í•Í…Á•!Ñµ°¡É½Ü¹…Ñ•½Éä¥ôð½ÑøñÑ±…ÍÌô‰¹Õ´ˆø‘í•ÕÉ¼¡É½Ü¹…µ½Õ¹Ð¥ôð½Ñøð½ÑÈù€¤¹©½¥¸ œœ¤(€€€€€€è€œñÑÈøñÑ½±ÍÁ…¸ôˆÌˆù-•¥¹”	Õ¡Õ¹•¸Ù½É¡…¹‘•¸¸ð½Ñøð½ÑÈøœì(€€€½¹ÍÐµ½¹Ñ¡I½ÝÌ€ôÍÕµµ…Éä¹µ½¹Ñ¡Ì¹±•¹Ñ (€€€€€€üÍÕµµ…Éä¹µ½¹Ñ¡Ì¹µ…À ¡É½Ü¤€ôø€ñÑÈøñÑø‘í•Í…Á•!Ñµ°¡™½Éµ…Ñ5½¹Ñ¡1…‰•°¡É½Ü¹µ½¹Ñ ¤¥ôð½ÑøñÑ±…ÍÌô‰¹Õ´ˆø‘í•ÕÉ¼¡É½Ü¹¥¹½µ”¥ôð½ÑøñÑ±…ÍÌô‰¹Õ´ˆø‘í•ÕÉ¼¡É½Ü¹•áÁ•¹Í”¥ôð½ÑøñÑ±…ÍÌô‰¹Õ´ˆø‘í•ÕÉ¼¡É½Ü¹É•ÍÕ±Ð¥ôð½Ñøð½ÑÈù€¤¹©½¥¸ œœ¤(€€€€€€è€œñÑÈøñÑ½±ÍÁ…¸ôˆÐˆù-•¥¹”	Õ¡Õ¹•¸Ù½É¡…¹‘•¸¸ð½Ñøð½ÑÈøœì(€€€½¹ÍÐ•¹ÑÉåI½ÝÌ€ôÍÕµµ…Éä¹É•Á½ÉÑ¹ÑÉ¥•Ì¹Í±¥” ¤¹Í½ÉÐ ¡„°ˆ¤€ôø„¹‘…Ñ”¹±½…±•½µÁ…É”¡ˆ¹‘…Ñ”¤¤¹µ…À ¡•¹ÑÉä¤€ôøì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ô•ÑM•±™µÁ±½åµ•¹ÑI•Á½ÉÑ¹ÑÉå	É•…­‘½Ý¸¡•¹ÑÉä¤ì(€€€€€É•ÑÕÉ¸€ñÑÈøñÑø‘í•Í…Á•!Ñµ°¡•ÑM•±™µÁ±½åµ•¹ÑI•Á½ÉÑ…Ñ•1…‰•°¡•¹ÑÉä¤¥ôð½ÑøñÑø‘í•¹ÑÉä¹ÑåÁ”€ôôô€¥¹½µ”œ€ü€¥¹¹…¡µ”œ€è€ÕÍ…‰”ôð½ÑøñÑø‘í•Í…Á•!Ñµ°¡•ÑM•±™µÁ±½åµ•¹ÑI•Á½ÉÑA…åµ•¹Ñ5•Ñ¡½‘1…‰•°¡•¹ÑÉä¤¥ôð½ÑøñÑø‘í•Í…Á•!Ñµ°¡•¹ÑÉä¹…Ñ•½Éä¥ôð½ÑøñÑø‘í•Í…Á•!Ñµ°¡•¹ÑÉä¹‘•ÍÉ¥ÁÑ¥½¸¥ôð½ÑøñÑø‘í•Í…Á•!Ñµ°¡•¹ÑÉä¹‘½Õµ•¹Ñ9Õµ‰•Èñð€œ´œ¥ôð½ÑøñÑ±…ÍÌô‰¹Õ´ˆø‘í•ÕÉ¼¡…µ½Õ¹Ð¹É½ÍÌ¥ôð½ÑøñÑø‘í•Í…Á•!Ñµ°¡•¹ÑÉä¹¹½Ñ”ñð€œœ¥ôð½Ñøð½ÑÈù€ì(€€€ô¤¹©½¥¸ œœ¤ñð€œñÑÈøñÑ½±ÍÁ…¸ôˆàˆù-•¥¹”	Õ¡Õ¹•¸Ù½É¡…¹‘•¸¸ð½Ñøð½ÑÈøœì(€€€½¹ÍÐÙ…Ñ	±½¬€ô™œ¹Ñ…á5½‘”€ôôô€Ù…Ñ}É•¥ÍÑ•É•œ(€€€€€€ü€ñÍ•Ñ¥½¸øñ ÈùUµÍ…ÑéÍÑ•Õ•ÈµÕ™Ñ•¥±Õ¹œð½ Èøñ‘¥Ø±…ÍÌô‰µ•ÑÉ¥Ìˆøñ‘¥ØøñÍÁ…¸ù9•ÑÑ¼µ¥¹¹…¡µ•¸ð½ÍÁ…¸øñÍÑÉ½¹œø‘í•ÕÉ¼¡ÍÕµµ…Éä¹¥¹½µ•9•Ð¥ôð½ÍÑÉ½¹œøð½‘¥Øøñ‘¥ØøñÍÁ…¸ùY•É•¥¹¹…¡µÑ”UµÍ…ÑéÍÑ•Õ•Èð½ÍÁ…¸øñÍÑÉ½¹œø‘í•ÕÉ¼¡ÍÕµµ…Éä¹½±±•Ñ•‘Y…Ð¥ôð½ÍÑÉ½¹œøð½‘¥Øøñ‘¥ØøñÍÁ…¸ù9•ÑÑ¼µÕÍ…‰•¸ð½ÍÁ…¸øñÍÑÉ½¹œø‘í•ÕÉ¼¡ÍÕµµ…Éä¹•áÁ•¹Í•9•Ð¥ôð½ÍÑÉ½¹œøð½‘¥Øøñ‘¥ØøñÍÁ…¸ù¹Ñ¡…±Ñ•¹”Y½ÉÍÑ•Õ•Èð½ÍÁ…¸øñÍÑÉ½¹œø‘í•ÕÉ¼¡ÍÕµµ…Éä¹¥¹ÁÕÑY…Ð¥ôð½ÍÑÉ½¹œøð½‘¥Øøð½‘¥Øøð½Í•Ñ¥½¸ù€(€€€€€€è€œœì(€€€É•ÑÕÉ¸€ð…‘½ÑåÁ”¡Ñµ°øñ¡Ñµ°±…¹œô‰‘”ˆøñ¡•…øñµ•Ñ„¡…ÉÍ•Ðô‰ÕÑ˜´àˆøñÑ¥Ñ±”ùqH€‘íå•…Éôƒ
Ü€‘í‰ÕÍ¥¹•ÍÍ9…µ•ôð½Ñ¥Ñ±”øñÍÑå±”ø(€€€€€‰½‘åí™½¹Ðµ™…µ¥±äèµ…ÁÁ±”µÍåÍÑ•´±	±¥¹­5…MåÍÑ•µ½¹Ð°‰M•½”U$ˆ±Í…¹ÌµÍ•É¥˜í½±½ÈèŒÄÜÈÌÅíµ…É¥¸èÌÉÁàí±¥¹”µ¡•¥¡ÐèÄ¸ÌÕõ Åíµ…É¥¸èÀ€À€ÑÁáõ Éíµ…É¥¸èÈáÁà€À€áÁàí™½¹ÐµÍ¥é”èÄáÁáô¹µÕÑ•‘í½±½ÈèŒÕ˜Ù˜ØÙô¹µ•ÑÉ¥Íí‘¥ÍÁ±…äéÉ¥íÉ¥µÑ•µÁ±…Ñ”µ½±Õµ¹ÌéÉ•Á•…Ð Ì°Å™È¤í…ÀèÄÁÁàíµ…É¥¸èÄáÁà€Áô¹µ•ÑÉ¥Ì‘¥Ùí‰½É‘•ÈèÅÁàÍ½±¥€™‘…Ìí‰½É‘•ÈµÉ…‘¥ÕÌèÄÁÁàíÁ…‘‘¥¹œèÄÉÁáô¹µ•ÑÉ¥ÌÍÁ…¹í‘¥ÍÁ±…äé‰±½¬í½±½ÈèŒÕ˜Ù˜ØØí™½¹ÐµÍ¥é”èÄÉÁáô¹µ•ÑÉ¥ÌÍÑÉ½¹í‘¥ÍÁ±…äé‰±½¬í™½¹ÐµÍ¥é”èÈÁÁàíµ…É¥¸µÑ½ÀèÑÁáõÑ…‰±•í‰½É‘•Èµ½±±…ÁÍ”é½±±…ÁÍ”íÝ¥‘Ñ èÄÀÀ”í™½¹ÐµÍ¥é”èÄÉÁáõÑ ±Ñ‘í‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€‘”Ñ‘˜íÑ•áÐµ…±¥¸é±•™ÐíÁ…‘‘¥¹œèÝÁà€ÙÁàíÙ•ÉÑ¥…°µ…±¥¸éÑ½ÁõÑ¡í‰…­É½Õ¹è••˜Õ˜Áô¹¹ÕµíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Áô¹™½½Ñíµ…É¥¸µÑ½ÀèÈáÁàí™½¹ÐµÍ¥é”èÄÅÁàí½±½ÈèŒÕ˜Ù˜ØÙõµ•‘¥„ÁÉ¥¹Ñí‰½‘åíµ…É¥¸èÄÉµµô¹¹¼µÁÉ¥¹Ñí‘¥ÍÁ±…äé¹½¹•õô(€€€€ð½ÍÑå±”øð½¡•…øñ‰½‘äøñ Äù¥¹¹…¡µ•»ñ‰•ÉÍ¡ÕÍÍÉ•¡¹Õ¹œ€‘íå•…Éôð½ ÄøñÀøñÍÑÉ½¹œø‘í‰ÕÍ¥¹•ÍÍ9…µ•ôð½ÍÑÉ½¹œøñ‰ÈøñÍÁ…¸±…ÍÌô‰µÕÑ•ˆø‘í•Í…Á•!Ñµ°¡•ÑM•±™µÁ±½åµ•¹ÑQ…á5½‘•1…‰•°¡™œ¹Ñ…á5½‘”¤¥ôð½ÍÁ…¸øð½Àø(€€€€€€ñ‘¥Ø±…ÍÌô‰µ•ÑÉ¥Ìˆøñ‘¥ØøñÍÁ…¸ù	•ÑÉ¥•‰Í•¥¹¹…¡µ•¸ð½ÍÁ…¸øñÍÑÉ½¹œø‘í•ÕÉ¼¡ÍÕµµ…Éä¹¥¹½µ•É½ÍÌ¥ôð½ÍÑÉ½¹œøð½‘¥Øøñ‘¥ØøñÍÁ…¸ù	•ÑÉ¥•‰Í…ÕÍ…‰•¸ð½ÍÁ…¸øñÍÑÉ½¹œø‘í•ÕÉ¼¡ÍÕµµ…Éä¹•áÁ•¹Í•É½ÍÌ¥ôð½ÍÑÉ½¹œøð½‘¥Øøñ‘¥ØøñÍÁ…¸ø‘íÍÕµµ…Éä¹É•ÍÕ±Ð€øô€À€ü€Ÿq‰•ÉÍ¡ÕÍÌœ€è€Y•É±ÕÍÐôð½ÍÁ…¸øñÍÑÉ½¹œø‘í•ÕÉ¼¡5…Ñ ¹…‰Ì¡ÍÕµµ…Éä¹É•ÍÕ±Ð¤¥ôð½ÍÑÉ½¹œøð½‘¥Øøð½‘¥Øø(€€€€€€‘íÙ…Ñ	±½­ôñÍ•Ñ¥½¸øñ Èù5½¹…ÑÏñ‰•ÉÍ¥¡Ðð½ ÈøñÑ…‰±”øñÑ¡•…øñÑÈøñÑ ù5½¹…Ðð½Ñ øñÑ ±…ÍÌô‰¹Õ´ˆù¥¹¹…¡µ•¸ð½Ñ øñÑ ±…ÍÌô‰¹Õ´ˆùÕÍ…‰•¸ð½Ñ øñÑ ±…ÍÌô‰¹Õ´ˆùÉ•‰¹¥Ìð½Ñ øð½ÑÈøð½Ñ¡•…øñÑ‰½‘äø‘íµ½¹Ñ¡I½ÝÍôð½Ñ‰½‘äøð½Ñ…‰±”øð½Í•Ñ¥½¸ø(€€€€€€ñÍ•Ñ¥½¸øñ ÈùMÕµµ•¸¹… qHµ-…Ñ•½É¥”ð½ ÈøñÑ…‰±”øñÑ¡•…øñÑÈøñÑ ùÉÐð½Ñ øñÑ ù-…Ñ•½É¥”ð½Ñ øñÑ ±…ÍÌô‰¹Õ´ˆùMÕµµ”ð½Ñ øð½ÑÈøð½Ñ¡•…øñÑ‰½‘äø‘í…Ñ•½ÉåI½ÝÍôð½Ñ‰½‘äøð½Ñ…‰±”øð½Í•Ñ¥½¸ø(€€€€€€ñÍ•Ñ¥½¸øñ Èù	Õ¡Õ¹Í±¥ÍÑ”ð½ ÈøñÑ…‰±”øñÑ¡•…øñÑÈøñÑ ù…ÑÕ´ð½Ñ øñÑ ùÉÐð½Ñ øñÑ ùi…¡±Õ¹Í…ÉÐð½Ñ øñÑ ù-…Ñ•½É¥”ð½Ñ øñÑ ù	•Í¡É•¥‰Õ¹œð½Ñ øñÑ ù	•±•œð½Ñ øñÑ ±…ÍÌô‰¹Õ´ˆù	•ÑÉ…œð½Ñ øñÑ ù9½Ñ¥èð½Ñ øð½ÑÈøð½Ñ¡•…øñÑ‰½‘äø‘í•¹ÑÉåI½ÝÍôð½Ñ‰½‘äøð½Ñ…‰±”øð½Í•Ñ¥½¸ø(€€€€€€ñÀ±…ÍÌô‰™½½ÐˆùÉ‰•¥ÑÏñ‰•ÉÍ¥¡Ð…ÕÌ‘•´!…ÕÍ¡…±ÑÍÁ±…¹•È¸M¥”•ÉÍ•ÑéÐÝ•‘•È‘¥”…µÑ±¥¡”¹±…”qH¹½ •¥¹”ÍÑ•Õ•É±¥¡”AËñ™Õ¹œ¸ñÈ‰Í¡É•¥‰Õ¹•¸°•µ¥Í¡Ñ”9ÕÑéÕ¹œÕ¹M½¹‘•É›‘±±”‰¥ÑÑ”‘¥”ÍÑ•Õ•É±¥¡”	•¡…¹‘±Õ¹œÁËñ™•¸¸ð½Àø(€€€€€€ñÍÉ¥ÁÐùÝ¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±½…œ° ¤ôùÍ•ÑQ¥µ•½ÕÐ  ¤ôùÝ¥¹‘½Ü¹ÁÉ¥¹Ð ¤°ÄÔÀ¤¤ìñp½ÍÉ¥ÁÐøð½‰½‘äøð½¡Ñµ°ù€ì(€ô((€™Õ¹Ñ¥½¸ÁÉ¥¹ÑM•±™µÁ±½åµ•¹ÑI•Á½ÉÐ¡å•…È°ÍÕµµ…Éä¤ì(€€€½¹ÍÐÉ•Á½ÉÑ]¥¹‘½Ü€ôÝ¥¹‘½Ü¹½Á•¸ œœ°€}‰±…¹¬œ¤ì(€€€¥˜€ …É•Á½ÉÑ]¥¹‘½Ü¤É•ÑÕÉ¸…±•ÉÐ •ÈqHµ	•É¥¡Ð­½¹¹Ñ”¹¥¡Ð—Ù™™¹•ÐÝ•É‘•¸¸	¥ÑÑ”A½ÀµÕÁÌ›ñÈ‘¥•Í”M•¥Ñ”•É±…Õ‰•¸¸œ¤ì(€€€É•Á½ÉÑ]¥¹‘½Ü¹‘½Õµ•¹Ð¹½Á•¸ ¤ì(€€€É•Á½ÉÑ]¥¹‘½Ü¹‘½Õµ•¹Ð¹ÝÉ¥Ñ”¡‰Õ¥±‘M•±™µÁ±½åµ•¹ÑI•Á½ÉÑ!Ñµ°¡å•…È°ÍÕµµ…Éä¤¤ì(€€€É•Á½ÉÑ]¥¹‘½Ü¹‘½Õµ•¹Ð¹±½Í” ¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉM•±™µÁ±½åµ•¹ÑM•ÑÑ¥¹Ì¡Á…É•¹Ð¤ì(€€€½¹ÍÐ™œ€ô¹½Éµ…±¥é•M•±™µÁ±½åµ•¹Ð ¤ì(€€€½¹ÍÐ‘•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€‘•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€‘•Ñ…¥±Ìµ‰½àÍ•±˜µ•µÁ±½åµ•¹ÐµÍ•ÑÑ¥¹Ìœì(€€€½¹ÍÐÍÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€ÍÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ô€	•ÑÉ¥•ˆ€˜UµÍ…ÑéÍÑ•Õ•È•¥¹ÍÑ•±±•¸œì(€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡ÍÕµµ…Éä¤ì(€€€½¹ÍÐÉ½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹…µ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹…µ•%¹ÁÕÐ¹Ù…±Õ”€ô™œ¹‰ÕÍ¥¹•ÍÍ9…µ”ñð€œœì(€€€¹…µ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸	•¹¹ä5ÕÍÑ•É‰•ÑÉ¥•ˆœì(€€€½¹ÍÐÑ…áM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€Ñ…áM•±•Ð¹¥¹¹•É!Q50€ô€œñ½ÁÑ¥½¸Ù…±Õ”ô‰Íµ…±±}‰ÕÍ¥¹•ÍÌˆù-±•¥¹Õ¹Ñ•É¹•¡µ•È€¼­•¥¹”UMÐµÕ™Ñ•¥±Õ¹œð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ô‰Ù…Ñ}É•¥ÍÑ•É•ˆùUµÍ…ÑéÍÑ•Õ•ÉÁ™±¥¡Ñ¥œð½½ÁÑ¥½¸øœì(€€€Ñ…áM•±•Ð¹Ù…±Õ”€ô™œ¹Ñ…á5½‘”ì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9…µ”‘•ÈM•±‰ÍÓ‘¹‘¥­•¥Ðœ°¹…µ•%¹ÁÕÐ¤¤ì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ UµÍ…ÑéÍÑ•Õ•Èµ5½‘ÕÌœ°Ñ…áM•±•Ð¤¤ì(€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì(€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥”¥¹ÍÑ•±±Õ¹œÍÑ•Õ•ÉÐ¹ÕÈ‘¥”Õ™Ñ•¥±Õ¹œ¥¸9•ÑÑ¼Õ¹UµÍ…ÑéÍÑ•Õ•È¸	•É•¥ÑÌ•ÍÁ•¥¡•ÉÑ”i…¡±Õ¹•¸‰±•¥‰•¸•É¡…±Ñ•¸¸œ¤¤ì(€€€½¹ÍÐÍ…Ù•	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€Í…Ù•	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€Í…Ù•	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€Í…Ù•	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€¥¹ÍÑ•±±Õ¹œÍÁ•¥¡•É¸œì(€€€Í…Ù•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€™œ¹‰ÕÍ¥¹•ÍÍ9…µ”€ô¹…µ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€™œ¹Ñ…á5½‘”€ôÑ…áM•±•Ð¹Ù…±Õ”€ôôô€Ù…Ñ}É•¥ÍÑ•É•œ€ü€Ù…Ñ}É•¥ÍÑ•É•œ€è€Íµ…±±}‰ÕÍ¥¹•ÍÌœì(€€€€€…‘‘¡…¹•1½œ M•±‰ÍÓ‘¹‘¥­•¥Ðœ°	•ÑÉ¥•‰Í•¥¹ÍÑ•±±Õ¹œ•ÍÁ•¥¡•ÉÐè€‘í™œ¹‰ÕÍ¥¹•ÍÍ9…µ”ñð€½¡¹”9…µ•¸ôƒ
Ü€‘í•ÑM•±™µÁ±½åµ•¹ÑQ…á5½‘•1…‰•°¡™œ¹Ñ…á5½‘”¥ô¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€É•¹‘•È ¤ì(€€€ô¤ì(€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡Í…Ù•	ÕÑÑ½¸¤ì(€€€Á…É•¹Ð¹…ÁÁ•¹‘¡¥±¡‘•Ñ…¥±Ì¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉM•±™µÁ±½åµ•¹Ð ¤ì(€€€¥˜€ …Í•±™µÁ±½åµ•¹ÑM•Ñ¥½¸¤É•ÑÕÉ¸ì(€€€Í•±™µÁ±½åµ•¹ÑM•Ñ¥½¸¹¥¹¹•É!Q50€ô€œœì(€€€½¹ÍÐ™œ€ô¹½Éµ…±¥é•M•±™µÁ±½åµ•¹Ð ¤ì(€€€½¹ÍÐå•…ÉÌ€ô•ÑM•±™µÁ±½åµ•¹Ñe•…ÉÌ ¤ì(€€€¥˜€ …å•…ÉÌ¹¥¹±Õ‘•Ì¡Í•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…È¤¤Í•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…È€ôå•…ÉÍlÁtì(€€€½¹ÍÐÍÕµµ…Éä€ô•ÑM•±™µÁ±½åµ•¹ÑMÕµµ…Éä¡Í•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…È¤ì((€€€½¹ÍÐ¡•É¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•É¼¹±…ÍÍ9…µ”€ô€…ÉÍ•±˜µ•µÁ±½åµ•¹Ðµ¡•É¼œì(€€€½¹ÍÐ¡•…€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•…¹±…ÍÍ9…µ”€ô€Í•±˜µ•µÁ±½åµ•¹Ðµ¡•…œì(€€€½¹ÍÐ½Áä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½Áä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°€•å•‰É½Üœ°€qHÕ¹!…ÕÍ¡…±ÑÍ‰•ÑÉ…œœ¤¤ì(€€€½Áä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Èœ°€œœ°™œ¹‰ÕÍ¥¹•ÍÍ9…µ”ñð€M•±‰ÍÓ‘¹‘¥­•¥Ð€˜qHœ¤¤ì(€€€½Áä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€i…¡±Õ¹•¸¹… ¥¡É•´Ñ…ÑÏ‘¡±¥¡•¸i…¡±Õ¹Í‘…ÑÕ´•É™…ÍÍ•¸¸ƒq‰•ÉÝ•¥ÍÕ¹•¸Ù•Ë‘¹‘•É¸…ÕÑ½µ…Ñ¥Í ‘•¸•Í…µÑ•¸Ù•É›ñ‰…É•¸	•ÑÉ…œ¸	…È‰•é…¡±Ñ”¥¹¹…¡µ•¸Õ¹ÕÍ…‰•¸‰±•¥‰•¸¹ÕÈ¥¸‘•ÈqH¸œ¤¤ì(€€€¡•…¹…ÁÁ•¹‘¡¥±¡½Áä¤ì(€€€½¹ÍÐ…Ñ¥½¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…Ñ¥½¹Ì¹±…ÍÍ9…µ”€ô€Í•±˜µ•µÁ±½åµ•¹Ðµ…Ñ¥½¹Ìœì(€€€½¹ÍÐ¥¹½µ•	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€¥¹½µ•	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€¥¹½µ•	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€¥¹½µ•	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ¬¥¹¹…¡µ”œì(€€€¥¹½µ•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝM•±™µÁ±½åµ•¹Ñ¹ÑÉå‘¥Ñ½È¡¹Õ±°°€¥¹½µ”œ¤¤ì(€€€½¹ÍÐ•áÁ•¹Í•	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€•áÁ•¹Í•	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€•áÁ•¹Í•	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€•áÁ•¹Í•	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ¬ÕÍ…‰”œì(€€€•áÁ•¹Í•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝM•±™µÁ±½åµ•¹Ñ¹ÑÉå‘¥Ñ½È¡¹Õ±°°€•áÁ•¹Í”œ¤¤ì(€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡¥¹½µ•	ÕÑÑ½¸¤ì(€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡•áÁ•¹Í•	ÕÑÑ½¸¤ì(€€€¡•…¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹Ì¤ì(€€€¡•É¼¹…ÁÁ•¹‘¡¥±¡¡•…¤ì((€€€½¹ÍÐÑ½½±‰…È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ½½±‰…È¹±…ÍÍ9…µ”€ô€Í•±˜µ•µÁ±½åµ•¹ÐµÑ½½±‰…Èœì(€€€½¹ÍÐå•…ÉM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€å•…ÉÌ¹™½É…  ¡å•…È¤€ôøì(€€€€€½¹ÍÐ½ÁÑ¥½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€½ÁÑ¥½¸¹Ù…±Õ”€ôå•…Èì(€€€€€½ÁÑ¥½¸¹Ñ•áÑ½¹Ñ•¹Ð€ôqH€‘íå•…Éõ€ì(€€€€€å•…ÉM•±•Ð¹…ÁÁ•¹‘¡¥±¡½ÁÑ¥½¸¤ì(€€€ô¤ì(€€€å•…ÉM•±•Ð¹Ù…±Õ”€ôÍ•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…Èì(€€€å•…ÉM•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€Í•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…È€ôå•…ÉM•±•Ð¹Ù…±Õ”ì(€€€€€É•¹‘•È ¤ì(€€€ô¤ì(€€€Ñ½½±‰…È¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ÕÍÝ•ÉÑÕ¹Í©…¡Èœ°å•…ÉM•±•Ð¤¤ì(€€€½¹ÍÐÍÙ	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€ÍÙ	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€ÍÙ	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€ÍÙ	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€MX¡•ÉÕ¹Ñ•É±…‘•¸œì(€€€ÍÙ	ÕÑÑ½¸¹‘¥Í…‰±•€ô€…ÍÕµµ…Éä¹•¹ÑÉ¥•Ì¹±•¹Ñ ì(€€€ÍÙ	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôø•áÁ½ÉÑM•±™µÁ±½åµ•¹ÑÍØ¡Í•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…È¤¤ì(€€€½¹ÍÐÁÉ¥¹Ñ	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€ÁÉ¥¹Ñ	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€ÁÉ¥¹Ñ	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€ÁÉ¥¹Ñ	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€qH‘ÉÕ­•¸€¼…±ÌAœì(€€€ÁÉ¥¹Ñ	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÁÉ¥¹ÑM•±™µÁ±½åµ•¹ÑI•Á½ÉÐ¡Í•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…È°ÍÕµµ…Éä¤¤ì(€€€Ñ½½±‰…È¹…ÁÁ•¹‘¡¥±¡ÍÙ	ÕÑÑ½¸¤ì(€€€Ñ½½±‰…È¹…ÁÁ•¹‘¡¥±¡ÁÉ¥¹Ñ	ÕÑÑ½¸¤ì(€€€¡•É¼¹…ÁÁ•¹‘¡¥±¡Ñ½½±‰…È¤ì((€€€¡•É¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è	•ÑÉ¥•‰Í•¥¹¹…¡µ•¸€‘íÍ•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…Éõ€°Ù…±Õ”è•ÕÉ¼¡ÍÕµµ…Éä¹¥¹½µ•É½ÍÌ¤°­¥¹èÍÕµµ…Éä¹¥¹½µ•É½ÍÌ€ø€À€ü€ÍÕ•ÍÌœ€è€œœô°(€€€€€ì±…‰•°è€	•ÑÉ¥•‰Í…ÕÍ…‰•¸œ°Ù…±Õ”è•ÕÉ¼¡ÍÕµµ…Éä¹•áÁ•¹Í•É½ÍÌ¤°­¥¹èÍÕµµ…Éä¹•áÁ•¹Í•É½ÍÌ€ø€À€ü€Ý…É¹¥¹œœ€è€œœô°(€€€€€ì±…‰•°èÍÕµµ…Éä¹É•ÍÕ±Ð€øô€À€ü€Ÿq‰•ÉÍ¡ÕÍÌœ€è€Y•É±ÕÍÐœ°Ù…±Õ”è•ÕÉ¼¡5…Ñ ¹…‰Ì¡ÍÕµµ…Éä¹É•ÍÕ±Ð¤¤°­¥¹èÍÕµµ…Éä¹É•ÍÕ±Ð€øô€À€ü€ÍÕ•ÍÌœ€è€‘…¹•Èœô°(€€€€€ì±…‰•°è€É™…ÍÍÑ”Y½ÉŸ‘¹”œ°Ù…±Õ”èMÑÉ¥¹œ¡ÍÕµµ…Éä¹•¹ÑÉ¥•Ì¹±•¹Ñ ¤ô(€€€t¤¤ì(€€€½¹ÍÐÍ•±•Ñ•‘5½¹Ñ¡	ÕÍ¥¹•ÍÌ€ô•ÑM•±™µÁ±½åµ•¹Ñ	Õ‘•Ñ%µÁ…Ñ½É5½¹Ñ ¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ¥µÁ…ÑAÉ•™¥à€ôÍ•±•Ñ•‘5½¹Ñ¡	ÕÍ¥¹•ÍÌ¹…‘©ÕÍÑµ•¹Ð€ø€À€ü€œ¬œ€èÍ•±•Ñ•‘5½¹Ñ¡	ÕÍ¥¹•ÍÌ¹…‘©ÕÍÑµ•¹Ð€ð€À€ü€ŸŠ"Hœ€è€œœì(€€€¡•É¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° (€€€€€€‘¥Øœ°(€€€€€Í•±•Ñ•‘5½¹Ñ¡	ÕÍ¥¹•ÍÌ¹…‘©ÕÍÑµ•¹Ð€ð€À€ü€¹½Ñ¥”Ý…É¹¥¹œœ€è€¹½Ñ¥”ÍÕ•ÍÌœ°(€€€€€%´•Í…µÑ•¸Ù•É›ñ‰…É•¸	•ÑÉ…œ›ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ô‰•É•¥ÑÌ•¹Ñ¡…±Ñ•¸è€‘í¥µÁ…ÑAÉ•™¥áô‘í•ÕÉ¼¡5…Ñ ¹…‰Ì¡Í•±•Ñ•‘5½¹Ñ¡	ÕÍ¥¹•ÍÌ¹…‘©ÕÍÑµ•¹Ð¤¥ô¸	…Éé…¡±Õ¹•¸Ý•É‘•¸¡¥•È¹¥¡Ð•¥¹•É•¡¹•Ðì‰•É•¥ÑÌ¥´!…ÕÍ¡…±Ð•¹Ñ¡…±Ñ•¹”ÕÍ…‰•¸Ý•É‘•¸¹¥¡Ð‘½ÁÁ•±Ð…‰•é½•¸¹€(€€€€¤¤ì(€€€¥˜€¡™œ¹Ñ…á5½‘”€ôôô€Ù…Ñ}É•¥ÍÑ•É•œ¤ì(€€€€€¡•É¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€€€ì±…‰•°è€9•ÑÑ¼µ¥¹¹…¡µ•¸œ°Ù…±Õ”è•ÕÉ¼¡ÍÕµµ…Éä¹¥¹½µ•9•Ð¤ô°(€€€€€€€ì±…‰•°è€Y•É•¥¹¹…¡µÑ”UµÍ…ÑéÍÑ•Õ•Èœ°Ù…±Õ”è•ÕÉ¼¡ÍÕµµ…Éä¹½±±•Ñ•‘Y…Ð¤°­¥¹è€Ý…É¹¥¹œœô°(€€€€€€€ì±…‰•°è€9•ÑÑ¼µÕÍ…‰•¸œ°Ù…±Õ”è•ÕÉ¼¡ÍÕµµ…Éä¹•áÁ•¹Í•9•Ð¤ô°(€€€€€€€ì±…‰•°è€¹Ñ¡…±Ñ•¹”Y½ÉÍÑ•Õ•Èœ°Ù…±Õ”è•ÕÉ¼¡ÍÕµµ…Éä¹¥¹ÁÕÑY…Ð¤°­¥¹è€ÍÕ•ÍÌœô(€€€€€t¤¤ì(€€€ô(€€€¡•É¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”¥¹™¼œ°€¥”ÕÍÝ•ÉÑÕ¹œ¥ÍÐ•¥¹”Ù½É‰•É•¥Ñ•¹‘”É‰•¥ÑÏñ‰•ÉÍ¥¡Ð¸‰Í¡É•¥‰Õ¹•¸°•µ¥Í¡Ð•¹ÕÑéÑ”-½ÍÑ•¸Õ¹ÍÑ•Õ•É±¥¡”M½¹‘•É›‘±±”·ñÍÍ•¸Ù½È‘•È‰…‰”•ÁËñ™ÐÝ•É‘•¸¸œ¤¤ì(€€€Í•±™µÁ±½åµ•¹ÑM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡¡•É¼¤ì((€€€É•¹‘•ÉM•±™µÁ±½åµ•¹ÑM•ÑÑ¥¹Ì¡Í•±™µÁ±½åµ•¹ÑM•Ñ¥½¸¤ì(€€€É•¹‘•ÉM•±™µÁ±½åµ•¹ÑI•ÕÉÉ¥¹áÁ•¹Í•Ì¡Í•±™µÁ±½åµ•¹ÑM•Ñ¥½¸¤ì((€€€½¹ÍÐµ½¹Ñ¡Í…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€µ½¹Ñ¡Í…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€µ½¹Ñ¡Í…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°5½¹…ÑÏñ‰•ÉÍ¥¡Ð€‘íÍ•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…Éõ€¤¤ì(€€€¥˜€ …ÍÕµµ…Éä¹µ½¹Ñ¡Ì¹±•¹Ñ ¤ì(€€€€€µ½¹Ñ¡Í…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€9½ ­•¥¹”‰•ÑÉ¥•‰±¥¡•¸¥¹¹…¡µ•¸½‘•ÈÕÍ…‰•¸¥¸‘¥•Í•´)…¡È•É™…ÍÍÐ¸œ¤¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”½µÁ…ÐµÑ…‰±”œì(€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ù5½¹…Ðð½Ñ øñÑ ù¥¹¹…¡µ•¸ð½Ñ øñÑ ùÕÍ…‰•¸ð½Ñ øñÑ ùÉ•‰¹¥Ìð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€ÍÕµµ…Éä¹µ½¹Ñ¡Ì¹™½É…  ¡µ½¹Ñ ¤€ôøì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€½¹ÍÐÙ…±Õ•Ì€ôm™½Éµ…Ñ5½¹Ñ¡1…‰•°¡µ½¹Ñ ¹µ½¹Ñ ¤°•ÕÉ¼¡µ½¹Ñ ¹¥¹½µ”¤°•ÕÉ¼¡µ½¹Ñ ¹•áÁ•¹Í”¤°•ÕÉ¼¡µ½¹Ñ ¹É•ÍÕ±Ð¥tì(€€€€€€€Ù…±Õ•Ì¹™½É…  ¡Ù…±Õ”°¥¹‘•à¤€ôøì(€€€€€€€€€½¹ÍÐÑ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€€€Ñ¹Ñ•áÑ½¹Ñ•¹Ð€ôÙ…±Õ”ì(€€€€€€€€€¥˜€¡¥¹‘•à€ôôô€Ì¤Ñ¹±…ÍÍ9…µ”€ôµ½¹Ñ ¹É•ÍÕ±Ð€ð€À€ü€‘…¹•ÈµÑ•áÐœ€è€ÍÕ•ÍÌµÑ•áÐœì(€€€€€€€€€ÑÈ¹…ÁÁ•¹‘¡¥±¡Ñ¤ì(€€€€€€€ô¤ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€ô¤ì(€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€€€µ½¹Ñ¡Í…É¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€ô(€€€Í•±™µÁ±½åµ•¹ÑM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡µ½¹Ñ¡Í…É¤ì((€€€½¹ÍÐ…Ñ•½É¥•Í…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…Ñ•½É¥•Í…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€…Ñ•½É¥•Í…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€MÕµµ•¸¹… qHµ-…Ñ•½É¥”œ¤¤ì(€€€¥˜€ …ÍÕµµ…Éä¹…Ñ•½É¥•Ì¹±•¹Ñ ¤ì(€€€€€…Ñ•½É¥•Í…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥”-…Ñ•½É¥•¸Ý•É‘•¸…ÕÑ½µ…Ñ¥Í …ÕÌ‘•¥¹•¸	Õ¡Õ¹•¸éÕÍ…µµ•¹•ÍÑ•±±Ð¸œ¤¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”½µÁ…ÐµÑ…‰±”œì(€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ùÉÐð½Ñ øñÑ ù-…Ñ•½É¥”ð½Ñ øñÑ ùMÕµµ”ð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€ÍÕµµ…Éä¹…Ñ•½É¥•Ì¹™½É…  ¡…Ñ•½Éä¤€ôøì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€m…Ñ•½Éä¹ÑåÁ”€ôôô€¥¹½µ”œ€ü€¥¹¹…¡µ”œ€è€ÕÍ…‰”œ°…Ñ•½Éä¹…Ñ•½Éä°•ÕÉ¼¡…Ñ•½Éä¹…µ½Õ¹Ð¥t¹™½É…  ¡Ù…±Õ”¤€ôøì(€€€€€€€€€½¹ÍÐÑ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€€€Ñ¹Ñ•áÑ½¹Ñ•¹Ð€ôÙ…±Õ”ì(€€€€€€€€€ÑÈ¹…ÁÁ•¹‘¡¥±¡Ñ¤ì(€€€€€€€ô¤ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€ô¤ì(€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€€€…Ñ•½É¥•Í…É¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€ô(€€€Í•±™µÁ±½åµ•¹ÑM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡…Ñ•½É¥•Í…É¤ì((€€€½¹ÍÐ•¹ÑÉ¥•Í…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€•¹ÑÉ¥•Í…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€•¹ÑÉ¥•Í…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°qHµ	Õ¡Õ¹Í±¥ÍÑ”€‘íÍ•±™µÁ±½åµ•¹ÑI•Á½ÉÑe•…Éõ€¤¤ì(€€€•¹ÑÉ¥•Í…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€Q…Í­É…‰‰¥ÐµÕÍé…¡±Õ¹•¸Ý•É‘•¸¡¥•È…±Ì•¥¹”)…¡É•ÍÍÕµµ”µ¥ÐÕ™Ñ•¥±Õ¹œ•é•¥Ð¸¥”•¥¹é•±¹•¸ÕÍé…¡±Õ¹•¸‰±•¥‰•¸‘…ÉÕ¹Ñ•È…±Ì¥¹Ñ•É¹•È9…¡Ý•¥Ì‰•…É‰•¥Ñ‰…È¸œ¤¤ì(€€€¥˜€ …ÍÕµµ…Éä¹•¹ÑÉ¥•Ì¹±•¹Ñ ¤ì(€€€€€•¹ÑÉ¥•Í…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€9½ ­•¥¹”	Õ¡Õ¹•¸Ù½É¡…¹‘•¸¸9ÕÑé”½‰•¸ƒŠx¬¥¹¹…¡µ—Šp½‘•ÈƒŠx¬ÕÍ…‰—Šp¸œ¤¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”Í•±˜µ•µÁ±½åµ•¹ÐµÑ…‰±”œì(€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ù…ÑÕ´ð½Ñ øñÑ ùÉÐð½Ñ øñÑ ùi…¡±Õ¹Í…ÉÐð½Ñ øñÑ ù-…Ñ•½É¥”€¼	•Í¡É•¥‰Õ¹œð½Ñ øñÑ ù	•±•œð½Ñ øñÑ ù	•ÑÉ…œð½Ñ øñÑ ùUMÐð½Ñ øñÑ ù­Ñ¥½¸ð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€ÍÕµµ…Éä¹É•Á½ÉÑ¹ÑÉ¥•Ì¹™½É…  ¡•¹ÑÉä¤€ôøì(€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ô•ÑM•±™µÁ±½åµ•¹ÑI•Á½ÉÑ¹ÑÉå	É•…­‘½Ý¸¡•¹ÑÉä¤ì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€½¹ÍÐ‘…Ñ•Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€‘…Ñ•Q¹Ñ•áÑ½¹Ñ•¹Ð€ô•ÑM•±™µÁ±½åµ•¹ÑI•Á½ÉÑ…Ñ•1…‰•°¡•¹ÑÉä¤ì(€€€€€€€½¹ÍÐÑåÁ•Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€½¹ÍÐÑåÁ•A¥±°€ôÉ•…Ñ•U¥° ÍÁ…¸œ°•¹ÑÉä¹ÑåÁ”€ôôô€¥¹½µ”œ€ü€Á¥±°ÍÕ•ÍÌœ€è€Á¥±°Ý…É¹¥¹œœ°•¹ÑÉä¹ÑåÁ”€ôôô€¥¹½µ”œ€ü€¥¹¹…¡µ”œ€è€ÕÍ…‰”œ¤ì(€€€€€€€ÑåÁ•Q¹…ÁÁ•¹‘¡¥±¡ÑåÁ•A¥±°¤ì(€€€€€€€½¹ÍÐÁ…åµ•¹ÑQ€ôÉ•…Ñ•U¥° Ñœ°€œœ°•ÑM•±™µÁ±½åµ•¹ÑI•Á½ÉÑA…åµ•¹Ñ5•Ñ¡½‘1…‰•°¡•¹ÑÉä¤¤ì(€€€€€€€½¹ÍÐ‘•ÍQ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€‘•ÍQ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°•¹ÑÉä¹…Ñ•½Éä¤¤ì(€€€€€€€‘•ÍQ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Íµ…±°œ°•¹ÑÉä¹‘•ÍÉ¥ÁÑ¥½¸¤¤ì(€€€€€€€¥˜€¡•¹ÑÉä¹¥ÍQ…Í­É…‰‰¥Ñ¹¹Õ…±	Õ¹‘±”¤ì(€€€€€€€€€‘•ÍQ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Íµ…±°µÕÑ•œ°•ÑQ…Í­É…‰‰¥Ñ	É•…­‘½Ý¹1…‰•°¡•¹ÑÉä¹Ñ…Í­É…‰‰¥Ñ	É•…­‘½Ý¸¤¤¤ì(€€€€€€€ô•±Í”¥˜€¡¹½Éµ…±¥é•M•±™µÁ±½åµ•¹ÑA…åµ•¹Ñ5•Ñ¡½¡•¹ÑÉä¹Á…åµ•¹Ñ5•Ñ¡½¤€ôôô€…Í œ¤ì(€€€€€€€€€‘•ÍQ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Íµ…±°µÕÑ•œ°€9ÕÈ¥¸‘•ÈqHì	…Éé…¡±Õ¹œƒ‘¹‘•ÉÐ‘•¸Ù•É›ñ‰…É•¸	•ÑÉ…œ¹¥¡Ðœ¤¤ì(€€€€€€€ô•±Í”¥˜€¡•¹ÑÉä¹ÑåÁ”€ôôô€¥¹½µ”œ¤ì(€€€€€€€€€‘•ÍQ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Íµ…±°µÕÑ•œ°€]¥É‘•´•Í…µÑ•¸Ù•É›ñ‰…É•¸	•ÑÉ…œéÕ•É•¡¹•Ðœ¤¤ì(€€€€€€€ô•±Í”ì(€€€€€€€€€‘•ÍQ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° (€€€€€€€€€€€€‘¥Øœ°(€€€€€€€€€€€€Íµ…±°µÕÑ•œ°(€€€€€€€€€€€•ÑM•±™µÁ±½åµ•¹Ñ1¥¹­•‘	Õ™™•ÉáÁ•¹Í”¡•¹ÑÉä¤(€€€€€€€€€€€€€€ü€ÕÑ½µ…Ñ¥Í Õ¹Ñ•ÈƒŠyM½¹ÍÑ¥”ÕÍ…‰•»Špƒñ‰•É¹½µµ•¸œ(€€€€€€€€€€€€€€è•¹ÑÉä¹‰Õ‘•Ñ5½‘”€ôôô€…ÕÑ½}½Õ¹Ðœ(€€€€€€€€€€€€€€ü€]¥É¥´•Í…µÑ•¸Ù•É›ñ‰…É•¸	•ÑÉ…œ…‰•é½•¸œ(€€€€€€€€€€€€€€è€%´!…ÕÍ¡…±Ð‰•É•¥ÑÌ‰•Ëñ­Í¥¡Ñ¥Ðœ(€€€€€€€€€€¤¤ì(€€€€€€€ô(€€€€€€€¥˜€¡•¹ÑÉä¹¹½Ñ”€˜˜€…•¹ÑÉä¹¥ÍQ…Í­É…‰‰¥Ñ¹¹Õ…±	Õ¹‘±”¤‘•ÍQ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Íµ…±°µÕÑ•œ°•¹ÑÉä¹¹½Ñ”¤¤ì(€€€€€€€½¹ÍÐ‘½Õµ•¹ÑQ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€‘½Õµ•¹ÑQ¹Ñ•áÑ½¹Ñ•¹Ð€ô•¹ÑÉä¹‘½Õµ•¹Ñ9Õµ‰•Èñð€œ´œì(€€€€€€€½¹ÍÐ…µ½Õ¹ÑQ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€…µ½Õ¹ÑQ¹Ñ•áÑ½¹Ñ•¹Ð€ô•ÕÉ¼¡…µ½Õ¹Ð¹É½ÍÌ¤ì(€€€€€€€…µ½Õ¹ÑQ¹±…ÍÍ9…µ”€ô•¹ÑÉä¹ÑåÁ”€ôôô€¥¹½µ”œ€ü€ÍÕ•ÍÌµÑ•áÐœ€è€œœì(€€€€€€€½¹ÍÐÙ…ÑQ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€Ù…ÑQ¹Ñ•áÑ½¹Ñ•¹Ð€ô™œ¹Ñ…á5½‘”€ôôô€Ù…Ñ}É•¥ÍÑ•É•œ€ü€‘í…µ½Õ¹Ð¹Ù…ÑI…Ñ•ô€”ƒ
Ü€‘í•ÕÉ¼¡…µ½Õ¹Ð¹Ù…Ð¥õ€€è€œ´œì(€€€€€€€½¹ÍÐ…Ñ¥½¹Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€¥˜€¡•¹ÑÉä¹¥ÍQ…Í­É…‰‰¥Ñ¹¹Õ…±	Õ¹‘±”¤ì(€€€€€€€€€…Ñ¥½¹Q¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°€Íµ…±°µÕÑ•œ°€…ÕÑ½µ…Ñ¥Í œ¤¤ì(€€€€€€€ô•±Í”ì(€€€€€€€€€…Ñ¥½¹Q¹…ÁÁ•¹‘¡¥±¡É•…Ñ•Ñ¥½¹5•¹Ô¡l(€€€€€€€€€€€ì±…‰•°è€	•…É‰•¥Ñ•¸œ°±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½ÝM•±™µÁ±½åµ•¹Ñ¹ÑÉå‘¥Ñ½È¡•¹ÑÉä¤ô°(€€€€€€€€€€€ì±…‰•°è€3ÙÍ¡•¸œ°±…ÍÍ9…µ”è€‘…¹•Èœ°½¹±¥¬è€ ¤€ôøì(€€€€€€€€€€€€€¥˜€ …½¹™¥É´¡ƒŠx‘í•¹ÑÉä¹‘•ÍÉ¥ÁÑ¥½¹÷ŠpÝ¥É­±¥ ³ÙÍ¡•¸ý€¤¤É•ÑÕÉ¸ì(€€€€€€€€€€€€€¥˜€¡‘•±•Ñ•M•±™µÁ±½åµ•¹Ñ¹ÑÉä¡•¹ÑÉä¹¥¤¤ì(€€€€€€€€€€€€€€€…‘‘¡…¹•1½œ M•±‰ÍÓ‘¹‘¥­•¥Ðœ°	Õ¡Õ¹œ•³ÙÍ¡Ðè€‘í•¹ÑÉä¹‘•ÍÉ¥ÁÑ¥½¹ôƒ
Ü€‘í•ÕÉ¼¡•¹ÑÉä¹…µ½Õ¹Ð¥ô¹€°•¹ÑÉä¹‘…Ñ”¹Í±¥” À°€Ü¤¤ì(€€€€€€€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€€€ô(€€€€€€€€€€€ôô(€€€€€€€€€t¤¤ì(€€€€€€€ô(€€€€€€€m‘…Ñ•Q°ÑåÁ•Q°Á…åµ•¹ÑQ°‘•ÍQ°‘½Õµ•¹ÑQ°…µ½Õ¹ÑQ°Ù…ÑQ°…Ñ¥½¹Q‘t¹™½É…  ¡Ñ¤€ôøÑÈ¹…ÁÁ•¹‘¡¥±¡Ñ¤¤ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€ô¤ì(€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€€€•¹ÑÉ¥•Í…É¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì((€€€€€¥˜€¡ÍÕµµ…Éä¹Ñ…Í­É…‰‰¥Ñ¹ÑÉ¥•Ì¹±•¹Ñ ¤ì(€€€€€€€½¹ÍÐÑ…Í­É…‰‰¥Ñ•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€€€€€Ñ…Í­É…‰‰¥Ñ•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€‘•Ñ…¥±Ìµ‰½àœì(€€€€€€€½¹ÍÐÑ…Í­É…‰‰¥ÑMÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€€€€€Ñ…Í­É…‰‰¥ÑMÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ôQ…Í­É…‰‰¥Ðµ¥¹é•±…ÕÍé…¡±Õ¹•¸‰•…É‰•¥Ñ•¸€ ‘íÍÕµµ…Éä¹Ñ…Í­É…‰‰¥Ñ¹ÑÉ¥•Ì¹±•¹Ñ¡ô¥€ì(€€€€€€€Ñ…Í­É…‰‰¥Ñ•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡Ñ…Í­É…‰‰¥ÑMÕµµ…Éä¤ì(€€€€€€€Ñ…Í­É…‰‰¥Ñ•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥•Í”¥¹é•±…Õ™é•¥¡¹Õ¹•¸‘¥•¹•¸‘•È-½¹ÑÉ½±±”Õ¹Ý•É‘•¸¥¸‘•ÈqHµ1¥ÍÑ”°MXÕ¹A¹¥¡ÐéÕÏ‘Ñé±¥ …Õ™•›ñ¡ÉÐ¸œ¤¤ì(€€€€€€€½¹ÍÐ‘•Ñ…¥±Q…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€€€‘•Ñ…¥±Q…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”½µÁ…ÐµÑ…‰±”œì(€€€€€€€‘•Ñ…¥±Q…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ù…ÑÕ´ð½Ñ øñÑ ùÕ™Ñ•¥±Õ¹œð½Ñ øñÑ ùi…¡±Õ¹Í…ÉÐð½Ñ øñÑ ù•Í…µÐð½Ñ øñÑ ù­Ñ¥½¸ð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€€€½¹ÍÐ‘•Ñ…¥±	½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€€€ÍÕµµ…Éä¹Ñ…Í­É…‰‰¥Ñ¹ÑÉ¥•Ì¹™½É…  ¡Ñ…Í­É…‰‰¥Ñ¹ÑÉä¤€ôøì(€€€€€€€€€½¹ÍÐ‘•Ñ…¥±I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€€€½¹ÍÐ‘…Ñ•Q€ôÉ•…Ñ•U¥° Ñœ°€œœ°™½Éµ…ÑM•±™µÁ±½åµ•¹Ñ…Ñ”¡Ñ…Í­É…‰‰¥Ñ¹ÑÉä¹‘…Ñ”¤¤ì(€€€€€€€€€½¹ÍÐÍÁ±¥ÑQ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€€€ÍÁ±¥ÑQ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°Ñ…Í­É…‰‰¥Ñ¹ÑÉä¹‘•ÍÉ¥ÁÑ¥½¸¤¤ì(€€€€€€€€€ÍÁ±¥ÑQ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Íµ…±°µÕÑ•œ°•ÑQ…Í­É…‰‰¥Ñ	É•…­‘½Ý¹1…‰•°¡Ñ…Í­É…‰‰¥Ñ¹ÑÉä¹Ñ…Í­É…‰‰¥Ñ	É•…­‘½Ý¸¤¤¤ì(€€€€€€€€€½¹ÍÐÁ…åµ•¹ÑQ€ôÉ•…Ñ•U¥° Ñœ°€œœ°•ÑM•±™µÁ±½åµ•¹ÑA…åµ•¹Ñ5•Ñ¡½‘1…‰•°¡Ñ…Í­É…‰‰¥Ñ¹ÑÉä¹Á…åµ•¹Ñ5•Ñ¡½¤¤ì(€€€€€€€€€½¹ÍÐ…µ½Õ¹ÑQ€ôÉ•…Ñ•U¥° Ñœ°€ÍÕ•ÍÌµÑ•áÐœ°•ÕÉ¼¡Ñ…Í­É…‰‰¥Ñ¹ÑÉä¹…µ½Õ¹Ð¤¤ì(€€€€€€€€€½¹ÍÐ…Ñ¥½¹Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€€€…Ñ¥½¹Q¹…ÁÁ•¹‘¡¥±¡É•…Ñ•Ñ¥½¹5•¹Ô¡l(€€€€€€€€€€€ì±…‰•°è€	•…É‰•¥Ñ•¸œ°±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½ÝM•±™µÁ±½åµ•¹Ñ¹ÑÉå‘¥Ñ½È¡Ñ…Í­É…‰‰¥Ñ¹ÑÉä¤ô°(€€€€€€€€€€€ì±…‰•°è€3ÙÍ¡•¸œ°±…ÍÍ9…µ”è€‘…¹•Èœ°½¹±¥¬è€ ¤€ôøì(€€€€€€€€€€€€€¥˜€ …½¹™¥É´¡ƒŠx‘íÑ…Í­É…‰‰¥Ñ¹ÑÉä¹‘•ÍÉ¥ÁÑ¥½¹÷ŠpÝ¥É­±¥ ³ÙÍ¡•¸ý€¤¤É•ÑÕÉ¸ì(€€€€€€€€€€€€€¥˜€¡‘•±•Ñ•M•±™µÁ±½åµ•¹Ñ¹ÑÉä¡Ñ…Í­É…‰‰¥Ñ¹ÑÉä¹¥¤¤ì(€€€€€€€€€€€€€€€…‘‘¡…¹•1½œ M•±‰ÍÓ‘¹‘¥­•¥Ðœ°Q…Í­É…‰‰¥ÐµÕÍé…¡±Õ¹œ•³ÙÍ¡Ðè€‘íÑ…Í­É…‰‰¥Ñ¹ÑÉä¹‘•ÍÉ¥ÁÑ¥½¹ôƒ
Ü€‘í•ÕÉ¼¡Ñ…Í­É…‰‰¥Ñ¹ÑÉä¹…µ½Õ¹Ð¥ô¹€°Ñ…Í­É…‰‰¥Ñ¹ÑÉä¹‘…Ñ”¹Í±¥” À°€Ü¤¤ì(€€€€€€€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€€€ô(€€€€€€€€€€€ôô(€€€€€€€€€t¤¤ì(€€€€€€€€€m‘…Ñ•Q°ÍÁ±¥ÑQ°Á…åµ•¹ÑQ°…µ½Õ¹ÑQ°…Ñ¥½¹Q‘t¹™½É…  ¡Ñ¤€ôø‘•Ñ…¥±I½Ü¹…ÁÁ•¹‘¡¥±¡Ñ¤¤ì(€€€€€€€€€‘•Ñ…¥±	½‘ä¹…ÁÁ•¹‘¡¥±¡‘•Ñ…¥±I½Ü¤ì(€€€€€€€ô¤ì(€€€€€€€‘•Ñ…¥±Q…‰±”¹…ÁÁ•¹‘¡¥±¡‘•Ñ…¥±	½‘ä¤ì(€€€€€€€Ñ…Í­É…‰‰¥Ñ•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡‘•Ñ…¥±Q…‰±”¤ì(€€€€€€€•¹ÑÉ¥•Í…É¹…ÁÁ•¹‘¡¥±¡Ñ…Í­É…‰‰¥Ñ•Ñ…¥±Ì¤ì(€€€€€ô(€€€ô(€€€Í•±™µÁ±½åµ•¹ÑM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡•¹ÑÉ¥•Í…É¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉÕ•±Q½ÁUÁ…É¡Á…É•¹Ð¤ì(€€€¹½Éµ…±¥é•	Õ‘•ÑQ½ÁUÁÍ½¹™¥œ ¤ì(€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€œÈ¸	¥Í¡•È‰•é…¡±Ðœ¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥”I•ÍÑµ•¹”•É¥‰ÐÍ¥ …ÕÌ‘•´ƒñ‰•É¹½µµ•¹•¸I•ÍÐ‘•ÌY½Éµ½¹…ÑÌÁ±ÕÌ‘•¸‰•é…¡±Ñ•¸¥¹é…¡±Õ¹•¸µ¥¹ÕÌ‘•¸•É™…ÍÍÑ•¸Q…¹­…ÕÍ…‰•¸¸œ¤¤ì((€€€½¹ÍÐ…±Œ€ô•ÑÕ•±Q½ÁUÁ±±½…Ñ¥½¸¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ±¥Ù”€ô•ÑÕ•±A½½±1¥Ù•MÑ…ÑÕÌ¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ‰…±…¹•5•ÑÉ¥Ì€ôÉ•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€¥¹•é…¡±Ðœ°Ù…±Õ”è…±Œ¹…Ñ¥Ù”€ü•ÕÉ¼¡±¥Ù”¹Á…¥‘Q½ÁUÀ¤€è€…ˆ)Õ±¤€ÈÀÈØœ°­¥¹è±¥Ù”¹Á…¥‘Q½ÁUÀ€ø€À€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€ì±…‰•°è€ñÈQ…¹­•¸…ÕÍ••‰•¸œ°Ù…±Õ”è…±Œ¹…Ñ¥Ù”€ü•ÕÉ¼¡±¥Ù”¹ÍÁ•¹Ð¤€è€…ˆ)Õ±¤€ÈÀÈØœô(€€€t¤ì(€€€‰…±…¹•5•ÑÉ¥Ì¹±…ÍÍ1¥ÍÐ¹…‘ Ñ…¹¬µ‰…±…¹”µµ•ÑÉ¥Ìœ¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡‰…±…¹•5•ÑÉ¥Ì¤ì((€€€½¹ÍÐÉ•µ…¥¹¥¹œ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É•µ…¥¹¥¹œ¹±…ÍÍ9…µ”€ô€Ñ…¹¬µÉ•µ…¥¹¥¹œµ‰…±…¹”œì(€€€É•µ…¥¹¥¹œ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Ñ…¹¬µÉ•µ…¥¹¥¹œµ±…‰•°œ°€œÌ¸9½ ¥´Q…¹­Ñ½Á˜œ¤¤ì(€€€É•µ…¥¹¥¹œ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Ñ…¹¬µÉ•µ…¥¹¥¹œµ…µ½Õ¹Ðœ°…±Œ¹…Ñ¥Ù”€ü•ÕÉ¼¡±¥Ù”¹ÕÉÉ•¹Ñ	…±…¹”¤€è€…ˆ)Õ±¤€ÈÀÈØœ¤¤ì(€€€É•µ…¥¹¥¹œ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Íµ…±°µÕÑ•œ°€Y•É›ñ‰…È›ñÈÝ•¥Ñ•É•ÌQ…¹­•¸ìI•ÍÐÙ½´Y½Éµ½¹…Ð¥ÍÐ•¥¹•É•¡¹•Ð¸œ¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•µ…¥¹¥¹œ¤ì((€€€½¹ÍÐ¥¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¥¹™¼¹±…ÍÍ9…µ”€ô€¥¹™¼µ‰½àœì(€€€¥˜€¡…±Œ¹…Ñ¥Ù”¤ì(€€€€€¥¹™¼¹¥¹¹•É!Q50€ô€ñÍÑÉ½¹œùY•É›ñ‰…Èèð½ÍÑÉ½¹œø€‘í•ÕÉ¼¡±¥Ù”¹½Á•¹¥¹	…±…¹”¥ôI•ÍÐÙ½´Y½Éµ½¹…Ð€¬€‘í•ÕÉ¼¡±¥Ù”¹Á…¥‘Q½ÁUÀ¥ô•¥¹•é…¡±ÐƒŠ"H€‘í•ÕÉ¼¡±¥Ù”¹ÍÁ•¹Ð¥ô…ÕÍ••‰•¸€ô€ñÍÑÉ½¹œø‘í•ÕÉ¼¡±¥Ù”¹ÕÉÉ•¹Ñ	…±…¹”¥ô¹½ ¥´Q…¹­Ñ½Á˜ð½ÍÑÉ½¹œø¸‘í±¥Ù”¹Í¡½ÉÑ…”€ø€À€ü€Ì™•¡±•¸…­ÑÕ•±°€‘í•ÕÉ¼¡±¥Ù”¹Í¡½ÉÑ…”¥ô¹€€è€œô‘í±¥Ù”¹Á•¹‘¥¹Q½ÁUÀ€ø€À€ü€ñ‰ÈøñÍÁ…¸±…ÍÌô‰µÕÑ•ˆùY½¸‘•È•Á±…¹Ñ•¸Õ™ÍÑ½­Õ¹œÍ¥¹¹½ €‘í•ÕÉ¼¡±¥Ù”¹Á•¹‘¥¹Q½ÁUÀ¥ô½™™•¸¸ð½ÍÁ…¸ù€€è€œõ€ì(€€€ô•±Í”ì(€€€€€¥¹™¼¹¥¹¹•É!Q50€ô€œñÍÑÉ½¹œù9½ ¹¥¡Ð…­Ñ¥Øèð½ÍÑÉ½¹œø¥”I•ÍÐµÕ™ÍÑ½­Õ¹œ‰•¥¹¹Ð…ˆ)Õ±¤€ÈÀÈØ¸œì(€€€ô(€€€…É¹…ÁÁ•¹‘¡¥±¡¥¹™¼¤ì((€€€¥˜€¡…±Œ¹…Ñ¥Ù”¤ì(€€€€€½¹ÍÐÉ½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€É½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€€€½¹ÍÐÉ•ÍÑ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€€€É•ÍÑ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€€€É•ÍÑ%¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€€€É•ÍÑ%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸€Ôà°äÌœì(€€€€€É•ÍÑ%¹ÁÕÐ¹Ù…±Õ”€ô…±Œ¹‰…±…¹”€ü™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡…±Œ¹‰…±…¹”¤€è€œœì(€€€€€½¹ÍÐ¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€€€¹½Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€€€¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô•Ñ	Õ‘•ÑQ½ÁUÁ½¹™¥œ ™Õ•°œ¤¹¹½Ñ•ÍmÕÉÉ•¹Ñ5½¹Ñ¡tñð€œœì(€€€€€¹½Ñ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸I•ÍÐ…ÕÌ‘•´Y½Éµ½¹…Ðœì(€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ I•ÍÐ…ÕÌ‘•´Y½Éµ½¹…Ðœ°É•ÍÑ%¹ÁÕÐ¤¤ì(€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥èœ°¹½Ñ•%¹ÁÕÐ¤¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì((€€€€€½¹ÍÐÍ…Ù•	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€Í…Ù•	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€Í…Ù•	Ñ¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€€€Í…Ù•	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€I•ÍÐÍÁ•¥¡•É¸€˜Õ™ÍÑ½­Õ¹œƒñ‰•É¹•¡µ•¸œì(€€€€€Í…Ù•	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€½¹ÍÐÉ•ÍÐ€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡É•ÍÑ%¹ÁÕÐ¹Ù…±Õ”ñð€À¤ì(€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡É•ÍÐ¤ñðÉ•ÍÐ€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸I•ÍÑ‰•ÑÉ…œ•¥¹•‰•¸¸œ¤ì(€€€€€€€Í•Ñ	Õ‘•ÑQ½ÁUÁ	…±…¹” ™Õ•°œ°ÕÉÉ•¹Ñ5½¹Ñ °É•ÍÐ°¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€½¹ÍÐÍ…Ù•‘…±Œ€ô•ÑÕ•±Q½ÁUÁ±±½…Ñ¥½¸¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€Íå¹Õ•±Q½ÁUÁáÁ•¹Í•Ì¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€…‘‘¡…¹•1½œ Q…¹­•±œ°I•ÍÐ€‘í•ÕÉ¼¡É•ÍÐ¥ô•ÍÁ•¥¡•ÉÐìÕ™ÍÑ½­Õ¹œ€‘í•ÕÉ¼¡Í…Ù•‘…±Œ¹Ñ½ÁUÀ¥ôƒñ‰•É¹½µµ•¸¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡Í…Ù•	Ñ¸¤ì(€€€ô(€€€Á…É•¹Ð¹…ÁÁ•¹‘¡¥±¡…É¤ì(€ô(((€™Õ¹Ñ¥½¸É•¹‘•ÉQ…¹­…±Œ ¤ì(€€€Ñ…¹­…±M•Ñ¥½¸¹¥¹¹•É!Q50€ô€œœì(€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€…Éœì((€€€½¹ÍÐÑ¥Ñ±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Èœ¤ì(€€€Ñ¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ô€Q…¹­•±œì(€€€…É¹…ÁÁ•¹‘¡¥±¡Ñ¥Ñ±”¤ì((€€€½¹ÍÐ¹½Ñ”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¹½Ñ”¹Ñ•áÑ½¹Ñ•¹Ð€ô€•È•µ•¥¹Í…µ”Q…¹­Ñ½Á˜¥ÍÐµ¥Ð•ÕÉ•¸Á•ÉÏÙ¹±¥¡•¸Q…¹­•±µA½ÍÑ•¸Ù•É­»ñÁ™Ð¸)•‘”A•ÉÍ½¸‰•é…¡±Ð¥¡É•¸¹… ‘•´Ù•É›ñ‰…É•¸¥¹­½µµ•¸€¡¹… ‘¥É•­Ñ•´1½¡¹…‰éÕœ¤‰•É•¡¹•Ñ•¸¹Ñ•¥°Ù½´•¥•¹•¸1½¡¹­½¹Ñ¼¸%ÍÐ‘•È…­ÑÕ•±±”5½¹…Ð‰•É•¥ÑÌ‰•é…¡±Ð°‰±•¥‰Ð‘¥•Í•È	•ÑÉ…œ™•ÍÐìƒ¹‘•ÉÕ¹•¸•±Ñ•¸…ˆ‘•´½±•µ½¹…Ð¸œì(€€€…É¹…ÁÁ•¹‘¡¥±¡¹½Ñ”¤ì((€€€½¹ÍÐ¡½ÕÍ•¡½±‘Q…¹­MÑ…ÑÌ€ô•ÑQ…¹­!½ÕÍ•¡½±‘Ù•É…•MÑ…ÑÌ¡ÕÉÉ•¹Ñ5½¹Ñ °€ÄÈ¤ì(€€€½¹ÍÐ™Õ•±±±½…Ñ¥½¸€ô•ÑÕ•±Q½ÁUÁ±±½…Ñ¥½¸¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ‰•¹¹å	Õ‘•Ð€ô9Õµ‰•È¡™Õ•±±±½…Ñ¥½¸¹…±±½…Ñ¥½¹Ì€˜˜™Õ•±±±½…Ñ¥½¸¹…±±½…Ñ¥½¹Ì¹‰•¹¹äñð€À¤ì(€€€½¹ÍÐµ…‘•±•¥¹•	Õ‘•Ð€ô9Õµ‰•È¡™Õ•±±±½…Ñ¥½¸¹…±±½…Ñ¥½¹Ì€˜˜™Õ•±±±½…Ñ¥½¸¹…±±½…Ñ¥½¹Ì¹µ…‘•±•¥¹”ñð€À¤ì(€€€½¹ÍÐ‰•¹¹å%¹½µ”€ô•Ñ%¹½µ•]•¥¡Ñ½ÉA•ÉÍ½¸ ‰•¹¹äœ°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐµ…‘•±•¥¹•%¹½µ”€ô•Ñ%¹½µ•]•¥¡Ñ½ÉA•ÉÍ½¸ µ…‘•±•¥¹”œ°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ½µ‰¥¹•‘%¹½µ”€ô‰•¹¹å%¹½µ”€¬µ…‘•±•¥¹•%¹½µ”ì(€€€½¹ÍÐ‰•¹¹åM¡…É”€ô½µ‰¥¹•‘%¹½µ”€ø€À€ü‰•¹¹å%¹½µ”€¼½µ‰¥¹•‘%¹½µ”€è€À¸Ôì(€€€½¹ÍÐµ…‘•±•¥¹•M¡…É”€ô½µ‰¥¹•‘%¹½µ”€ø€À€üµ…‘•±•¥¹•%¹½µ”€¼½µ‰¥¹•‘%¹½µ”€è€À¸Ôì(€€€½¹ÍÐ™½É•…ÍÑ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€™½É•…ÍÑ…É¹±…ÍÍ9…µ”€ô€…ÉÑ…¹¬µ™½É•…ÍÐµ…Éœì(€€€™½É•…ÍÑ…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€œÄ¸5½¹…ÑÍÁÉ½¹½Í”œ¤¤ì(€€€™½É•…ÍÑ…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€•Í£‘ÑéÑ•È	•‘…É˜Õ¹‘¥”•Á±…¹Ñ”Õ™Ñ•¥±Õ¹œ¹… ¥¹­½µµ•¸¸œ¤¤ì(€€€™½É•…ÍÑ…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€•Í£‘ÑéÑ•È5½¹…ÑÍ‰•‘…É˜œ°Ù…±Õ”è•ÕÉ¼¡¡½ÕÍ•¡½±‘Q…¹­MÑ…ÑÌ¹É½Õ¹‘•‘	Õ‘•Ð¤°­¥¹è¡½ÕÍ•¡½±‘Q…¹­MÑ…ÑÌ¹É½Õ¹‘•‘	Õ‘•Ð€ø€À€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€ì±…‰•°è€	•¹¹åÌ•Á±…¹Ñ•È¹Ñ•¥°œ°Ù…±Õ”è•ÕÉ¼¡‰•¹¹å	Õ‘•Ð¤°¡¥¹Ðè€‘ì¡‰•¹¹åM¡…É”€¨€ÄÀÀ¤¹Ñ½¥á• Ä¥ô€•€ô°(€€€€€ì±…‰•°è€5…‘•±•¥¹•Ì•Á±…¹Ñ•È¹Ñ•¥°œ°Ù…±Õ”è•ÕÉ¼¡µ…‘•±•¥¹•	Õ‘•Ð¤°¡¥¹Ðè€‘ì¡µ…‘•±•¥¹•M¡…É”€¨€ÄÀÀ¤¹Ñ½¥á• Ä¥ô€•€ô(€€€t¤¤ì(€€€™½É•…ÍÑ…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€Íµ…±°µÕÑ•œ°¡½ÕÍ•¡½±‘Q…¹­MÑ…ÑÌ¹ÁÉ½©•Ñ•‘½Õ¹Ð€ø€À€üÉÕ¹‘±…”è€‘í¡½ÕÍ•¡½±‘Q…¹­MÑ…ÑÌ¹É•…±½Õ¹Ñô•¡Ñ”5½¹…Ñ”Õ¹€‘í¡½ÕÍ•¡½±‘Q…¹­MÑ…ÑÌ¹ÁÉ½©•Ñ•‘½Õ¹ÑôAÉ½¹½Í•µ½¹…Ñ”¹€€è€ÉÕ¹‘±…”è€ÄÈ•¡Ñ”5½¹…Ñ”¸œ¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡™½É•…ÍÑ…É¤ì((€€€½¹ÍÐÍ•ÑÑ¥¹ÍI½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Í•ÑÑ¥¹ÍI½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐÍ•ÑÑ¥¹Í•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€Í•ÑÑ¥¹Í•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€‘•Ñ…¥±Ìµ‰½àÑ…¹¬µÍ•ÑÑ¥¹Ìµ‘•Ñ…¥±Ìœì(€€€½¹ÍÐÍ•ÑÑ¥¹ÍMÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€Í•ÑÑ¥¹ÍMÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ô€Q…¹­‰•É•¡¹Õ¹œ°AÉ•¥Í”Õ¹¥¹ÍÑ•±±Õ¹•¸œì(€€€Í•ÑÑ¥¹Í•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡Í•ÑÑ¥¹ÍMÕµµ…Éä¤ì((€€€½¹ÍÐ­•å]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹ÍÐ­•å1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€­•å1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€Q…¹­•É¯Ù¹¥œµA$µ-•äœì(€€€½¹ÍÐ­•å%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€­•å%¹ÁÕÐ¹ÑåÁ”€ô€Á…ÍÍÝ½Éœì(€€€­•å%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€A$µ-•ä•¥¹•‰•¸œì(€€€­•å%¹ÁÕÐ¹Ù…±Õ”€ôÍÑ…Ñ”¹Ñ…¹­…±Œ¹…Á¥-•äñð€œœì(€€€½¹ÍÐÁ•ÉÍ¥ÍÑÁ¥-•ä€ô€ ¤€ôøì(€€€€€ÍÑ…Ñ”¹Ñ…¹­…±Œ¹…Á¥-•ä€ô•áÑÉ…ÑQ…¹­Á¥-•ä¡­•å%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€­•å%¹ÁÕÐ¹Ù…±Õ”€ôÍÑ…Ñ”¹Ñ…¹­…±Œ¹…Á¥-•äì(€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€ôì(€€€­•å%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¥¹ÁÕÐœ°Á•ÉÍ¥ÍÑÁ¥-•ä¤ì(€€€­•å%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°Á•ÉÍ¥ÍÑÁ¥-•ä¤ì(€€€½¹ÍÐ­•å	ÕÑÑ½¹I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€­•å	ÕÑÑ½¹I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐÍ¡½Ý-•å	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€Í¡½Ý-•å	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€Í¡½Ý-•å	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€Í¡½Ý-•å	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€…¹é•¥•¸œì(€€€Í¡½Ý-•å	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€­•å%¹ÁÕÐ¹ÑåÁ”€ô­•å%¹ÁÕÐ¹ÑåÁ”€ôôô€Á…ÍÍÝ½Éœ€ü€Ñ•áÐœ€è€Á…ÍÍÝ½Éœì(€€€€€Í¡½Ý-•å	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô­•å%¹ÁÕÐ¹ÑåÁ”€ôôô€Á…ÍÍÝ½Éœ€ü€…¹é•¥•¸œ€è€Ù•É‰•É•¸œì(€€€ô¤ì(€€€½¹ÍÐ±•…É-•å	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€±•…É-•å	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€±•…É-•å	Ñ¸¹±…ÍÍ9…µ”€ô€‘…¹•Èœì(€€€±•…É-•å	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€³ÙÍ¡•¸œì(€€€±•…É-•å	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€¥˜€¡½¹™¥É´ A$µ-•äÝ¥É­±¥ ³ÙÍ¡•¸üœ¤¤ì(€€€€€€€ÍÑ…Ñ”¹Ñ…¹­…±Œ¹…Á¥-•ä€ô€œœì(€€€€€€€­•å%¹ÁÕÐ¹Ù…±Õ”€ô€œœì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô(€€€ô¤ì(€€€­•å	ÕÑÑ½¹I½Ü¹…ÁÁ•¹‘¡¥±¡Í¡½Ý-•å	Ñ¸¤ì(€€€½¹ÍÐÑ•ÍÑ-•å	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€Ñ•ÍÑ-•å	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€Ñ•ÍÑ-•å	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€Ñ•ÍÑ-•å	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€A$µ-•äÑ•ÍÑ•¸œì(€€€Ñ•ÍÑ-•å	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€Á•ÉÍ¥ÍÑÁ¥-•ä ¤ì(€€€€€…Ý…¥ÐÑ•ÍÑQ…¹­Á¥-•ä ¤ì(€€€ô¤ì(€€€­•å	ÕÑÑ½¹I½Ü¹…ÁÁ•¹‘¡¥±¡Ñ•ÍÑ-•å	Ñ¸¤ì(€€€­•å	ÕÑÑ½¹I½Ü¹…ÁÁ•¹‘¡¥±¡±•…É-•å	Ñ¸¤ì(€€€½¹ÍÐ­•å!¥¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€­•å!¥¹Ð¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€­•å!¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô€•ÈA$µ-•äÝ¥É…ÕÑ½µ…Ñ¥Í ‰•É•¥¹¥Ðè1••Éé•¥¡•¸°Õ¹Í¥¡Ñ‰…É”i•¥¡•¸°¹›ñ¡ÉÕ¹Íé•¥¡•¸½‘•È•¥¸µ¥Ñ­½Á¥•ÉÑ•È1¥¹¬Ý•É‘•¸•¹Ñ™•É¹Ð¸	…­ÕÁÌ•¹Ñ¡…±Ñ•¸‘•¸A$µ-•ä°‘…µ¥Ð‘…ÌQ…¹­•±¹… %µÁ½ÉÐÝ•¥Ñ•È™Õ¹­Ñ¥½¹¥•ÉÐ¸œì(€€€­•å]É…À¹…ÁÁ•¹‘¡¥±¡­•å1…‰•°¤ì(€€€­•å]É…À¹…ÁÁ•¹‘¡¥±¡­•å%¹ÁÕÐ¤ì(€€€­•å]É…À¹…ÁÁ•¹‘¡¥±¡­•å	ÕÑÑ½¹I½Ü¤ì(€€€­•å]É…À¹…ÁÁ•¹‘¡¥±¡­•å!¥¹Ð¤ì((€€€½¹ÍÐÉ…‘]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹ÍÐÉ…‘1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€É…‘1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€MÕ¡É…‘¥ÕÌ¥¸­´œì(€€€½¹ÍÐÉ…‘%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É…‘%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€É…‘%¹ÁÕÐ¹ÍÑ•À€ô€œÄœì(€€€É…‘%¹ÁÕÐ¹µ¥¸€ô€œÄœì(€€€É…‘%¹ÁÕÐ¹Ù…±Õ”€ôÍÑ…Ñ”¹Ñ…¹­…±Œ¹É…‘¥ÕÍ-´ñð€Ôì(€€€É…‘%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€ÍÑ…Ñ”¹Ñ…¹­…±Œ¹É…‘¥ÕÍ-´€ô9Õµ‰•È¡É…‘%¹ÁÕÐ¹Ù…±Õ”ñð€Ô¤ì(€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€ô¤ì(€€€É…‘]É…À¹…ÁÁ•¹‘¡¥±¡É…‘1…‰•°¤ì(€€€É…‘]É…À¹…ÁÁ•¹‘¡¥±¡É…‘%¹ÁÕÐ¤ì((€€€½¹ÍÐ±½]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹ÍÐ±½1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€±½1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€MÑ…¹‘½ÉÐ›ñÈAÉ•¥Í…‰ÉÕ˜œì(€€€½¹ÍÐ±½%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€±½%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€±½%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸9…Õ•¸½‘•ÈMÑÉ‡}”°=ÉÐœì(€€€±½%¹ÁÕÐ¹Ù…±Õ”€ôÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹EÕ•Éäñð€œœì(€€€±½%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€ÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹EÕ•Éä€ô±½%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€ô¤ì(€€€½¹ÍÐ±½	ÕÑÑ½¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€±½	ÕÑÑ½¹Ì¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ™¥¹‘1½	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€™¥¹‘1½	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€™¥¹‘1½	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€™¥¹‘1½	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€MÑ…¹‘½ÉÐÍÕ¡•¸œì(€€€™¥¹‘1½	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€ÑÉäì(€€€€€€€…Ý…¥ÐÉ•Í½±Ù•Q…¹­1½…Ñ¥½¹EÕ•Éä¡±½%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€…±•ÉÐ MÑ…¹‘½ÉÐ•ÍÁ•¥¡•ÉÐè€œ€¬€¡ÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹9…µ”ñðÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹EÕ•Éä¤¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€€€…±•ÉÐ¡•ÉÈ€˜˜•ÉÈ¹µ•ÍÍ…”€ü•ÉÈ¹µ•ÍÍ…”€è€MÑ…¹‘½ÉÐ­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤ì(€€€€€ô(€€€ô¤ì(€€€½¹ÍÐ‘•Ù¥•1½	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€‘•Ù¥•1½	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€‘•Ù¥•1½	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€‘•Ù¥•1½	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€•Ë‘Ñ•ÍÑ…¹‘½ÉÐ¹ÕÑé•¸œì(€€€‘•Ù¥•1½	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€ÑÉäì(€€€€€€€…Ý…¥ÐÕÍ••Ù¥•1½…Ñ¥½¹½ÉQ…¹­Á¤ ¤ì(€€€€€€€…±•ÉÐ •Ë‘Ñ•ÍÑ…¹‘½ÉÐ•ÍÁ•¥¡•ÉÐ¸œ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€€€…±•ÉÐ¡•ÉÈ€˜˜•ÉÈ¹µ•ÍÍ…”€ü•ÉÈ¹µ•ÍÍ…”€è€•Ë‘Ñ•ÍÑ…¹‘½ÉÐ­½¹¹Ñ”¹¥¡Ð•±…‘•¸Ý•É‘•¸¸œ¤ì(€€€€€ô(€€€ô¤ì(€€€½¹ÍÐ±•…É1½	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€±•…É1½	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€±•…É1½	Ñ¸¹±…ÍÍ9…µ”€ô€‘…¹•Èœì(€€€±•…É1½	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€MÑ…¹‘½ÉÐ³ÙÍ¡•¸œì(€€€±•…É1½	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€ÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹EÕ•Éä€ô€œœì(€€€€€ÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹1…Ð€ô€œœì(€€€€€ÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹1¹œ€ô€œœì(€€€€€ÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹9…µ”€ô€œœì(€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€É•¹‘•È ¤ì(€€€ô¤ì(€€€±½	ÕÑÑ½¹Ì¹…ÁÁ•¹‘¡¥±¡™¥¹‘1½	Ñ¸¤ì(€€€±½	ÕÑÑ½¹Ì¹…ÁÁ•¹‘¡¥±¡‘•Ù¥•1½	Ñ¸¤ì(€€€±½	ÕÑÑ½¹Ì¹…ÁÁ•¹‘¡¥±¡±•…É1½	Ñ¸¤ì(€€€½¹ÍÐ±½!¥¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€±½!¥¹Ð¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€±½!¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ôÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹9…µ”€ü€ ­Ñ¥Ù•ÈMÑ…¹‘½ÉÐè€œ€¬ÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹9…µ”¤€è€=¡¹”•ÍÁ•¥¡•ÉÑ•¸MÑ…¹‘½ÉÐ™É…Ð‘¥”ÁÀ‘•¸•Ë‘Ñ•ÍÑ…¹‘½ÉÐ…ˆ¸œì(€€€±½]É…À¹…ÁÁ•¹‘¡¥±¡±½1…‰•°¤ì(€€€±½]É…À¹…ÁÁ•¹‘¡¥±¡±½%¹ÁÕÐ¤ì(€€€±½]É…À¹…ÁÁ•¹‘¡¥±¡±½	ÕÑÑ½¹Ì¤ì(€€€±½]É…À¹…ÁÁ•¹‘¡¥±¡±½!¥¹Ð¤ì((€€€Í•ÑÑ¥¹ÍI½Ü¹…ÁÁ•¹‘¡¥±¡­•å]É…À¤ì(€€€Í•ÑÑ¥¹ÍI½Ü¹…ÁÁ•¹‘¡¥±¡É…‘]É…À¤ì(€€€Í•ÑÑ¥¹ÍI½Ü¹…ÁÁ•¹‘¡¥±¡±½]É…À¤ì(€€€Í•ÑÑ¥¹Í•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡Í•ÑÑ¥¹ÍI½Ü¤ì((€€€½¹ÍÐ…Á¥MÑ…ÑÕÌ€ô•ÑQ…¹­Á¥MÑ…ÑÕÍ%¹™¼ ¤ì(€€€½¹ÍÐ…Á¥MÑ…ÑÕÍ	½à€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…Á¥MÑ…ÑÕÍ	½à¹±…ÍÍ9…µ”€ô€¥¹™¼µ‰½àœì(€€€½¹ÍÐ­•å½Éµ…Ñ1…‰•°€ôÍÑ…Ñ”¹Ñ…¹­…±Œ¹…Á¥-•ä€ü€¡¥ÍQ…¹­Á¥-•å½Éµ…ÑY…±¥¡ÍÑ…Ñ”¹Ñ…¹­…±Œ¹…Á¥-•ä¤€ü€½Éµ…Ð=,œ€è€½Éµ…ÐÁËñ™•¸œ¤€è€­•¥¸-•äœì(€€€½¹ÍÐÑ…¹­1½…Ñ¥½¹1…‰•°€ôÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹9…µ”ñð€¡ÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹EÕ•Éä€üÍÑ…Ñ”¹Ñ…¹­…±Œ¹±½…Ñ¥½¹EÕ•Éä€è€•Ë‘Ñ•ÍÑ…¹‘½ÉÐœ¤ì(€€€…Á¥MÑ…ÑÕÍ	½à¹¥¹¹•É!Q50€ô€ñÍÑÉ½¹œùQ…¹­•É¯Ù¹¥œµMÑ…ÑÕÌèð½ÍÑÉ½¹œø€‘íÍÑ…Ñ”¹Ñ…¹­…±Œ¹…Á¥-•ä€ü€A$µ-•äÙ½É¡…¹‘•¸œ€è€A$µ-•ä™•¡±Ðôƒ
Ü€‘í­•å½Éµ…Ñ1…‰•±ôƒ
ÜMÑ…¹‘½ÉÐè€‘íÑ…¹­1½…Ñ¥½¹1…‰•±ôƒ
Ü1•ÑéÑ•È‰ÉÕ˜è€‘í…Á¥MÑ…ÑÕÌ¹±…ÍÑI•ÅÕ•ÍÑ1…‰•±ôñ‰ÈøñÍÁ…¸±…ÍÌô‰µÕÑ•ˆø‘í…Á¥MÑ…ÑÕÌ¹±…ÍÑMÑ…ÑÕÌ€ü…Á¥MÑ…ÑÕÌ¹±…ÍÑMÑ…ÑÕÌ€¬€œè€œ€è€œô‘í…Á¥MÑ…ÑÕÌ¹±…ÍÑÉÉ½Èñð€9½ ­•¥¹”¥…¹½Í”‘ÕÉ¡•›ñ¡ÉÐ¸ôð½ÍÁ…¸ù€ì(€€€Í•ÑÑ¥¹Í•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡…Á¥MÑ…ÑÕÍ	½à¤ì((€€€½¹ÍÐ¡½ÕÍ•¡½±‘Q…¹­%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡½ÕÍ•¡½±‘Q…¹­%¹™¼¹±…ÍÍ9…µ”€ô€¥¹™¼µ‰½àœì(€€€¡½ÕÍ•¡½±‘Q…¹­%¹™¼¹¥¹¹•É!Q50€ô€œñÍÑÉ½¹œùA±…¹Õ¹œ…ˆ)Õ¹¤€ÈÀÈØèð½ÍÑÉ½¹œø	•ÍÓ‘Ñ¥Ñ”Q…¹­‰½¹ÌÕ¹-…¹¥ÍÑ•É¯‘Õ™”‰•ÍÑ¥µµ•¸¹… Õ¹¹… ‘¥”•¡Ñ”#Ù¡”‘•Ì•µ•¥¹Í…µ•¸-É…™ÑÍÑ½™™Ñ½Á™Ì¸-¥±½µ•Ñ•È°Y•É‰É…Õ Õ¹AÉ•¥Ì‰•ÍÑ¥µµ•¸‘¥”AÉ½¹½Í”ì…Õ˜•Õ Ù•ÉÑ•¥±ÐÝ¥É‘•ÈQ½Á˜…ÕÑ½µ…Ñ¥Í ¹… ‘•´Ù•É›ñ‰…É•¸¥¹­½µµ•¸¹… 1½¡¹…‰éÕœ¸	¥Ì€ÄÈ•¡Ñ”5½¹…Ñ”Ù½É±¥••¸°•ÉŸ‘¹éÐ‘¥”‰¥Í¡•É¥”AÉ½¹½Í”‘¥”™•¡±•¹‘•¸5½¹…Ñ”¸œì(€€€Í•ÑÑ¥¹Í•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡¡½ÕÍ•¡½±‘Q…¹­%¹™¼¤ì((€€€É•¹‘•ÉÕ•±Q½ÁUÁ…É¡…É¤ì((€€€½¹ÍÐÑ…¹­Må¹%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ…¹­Må¹%¹™¼¹±…ÍÍ9…µ”€ô€¥¹™¼µ‰½àœì(€€€Ñ…¹­Må¹%¹™¼¹¥¹¹•É!Q50€ô€œñÍÑÉ½¹œùÕÑ½µ…Ñ¥Í¡”Y•É­»ñÁ™Õ¹œèð½ÍÑÉ½¹œø•È•µ•¥¹Í…µ”Q…¹­Ñ½Á˜Ý¥É¹… ‘•´Ù•É›ñ‰…É•¸¥¹­½µµ•¸¹… 1½¡¹…‰éÕœÙ•ÉÑ•¥±ÐÕ¹µ¥Ð‘•¸©•Ý•¥±¥•¸¥¹é…¡±Õ¹•¸Íå¹¡É½¹¥Í¥•ÉÐ¸	•é…¡±Ñ”5½¹…ÑÍ‰•ÑË‘”‰±•¥‰•¸™•ÍÐìƒ¹‘•ÉÕ¹•¸±…Õ™•¸‘…¹¸…ˆ‘•´½±•µ½¹…Ð¸œì(€€€½¹ÍÐÍå¹±±	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€Íå¹±±	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€Íå¹±±	Ñ¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€Íå¹±±	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€Q…¹­•±©•ÑéÐÍå¹¡É½¹¥Í¥•É•¸œì(€€€Íå¹±±	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøìÍå¹±±Q…¹­•±‘áÁ•¹Í•Ì¡ìÍ¥±•¹Ðè™…±Í”ô¤ìÍ…Ù•MÑ…Ñ” ¤ìÉ•¹‘•È ¤ìô¤ì(€€€Ñ…¹­Må¹%¹™¼¹…ÁÁ•¹‘¡¥±¡‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰Èœ¤¤ì(€€€Ñ…¹­Må¹%¹™¼¹…ÁÁ•¹‘¡¥±¡Íå¹±±	Ñ¸¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡Ñ…¹­Må¹%¹™¼¤ì((€€€É•¹‘•ÉQ…¹­I••¥ÁÑQÉ…­¥¹œ¡…É¤ì((€€€½¹ÍÐÁ•ÉÍ½¹•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€Á•ÉÍ½¹•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€‘•Ñ…¥±Ìµ‰½àÑ…¹¬µÍ•ÑÑ¥¹Ìµ‘•Ñ…¥±Ìœì(€€€½¹ÍÐÁ•ÉÍ½¹MÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€Á•ÉÍ½¹MÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ô€…¡ÉÁÉ½™¥±”Õ¹AÉ•¥Í…¹¹…¡µ•¸œì(€€€Á•ÉÍ½¹•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡Á•ÉÍ½¹MÕµµ…Éä¤ì((€€€½¹ÍÐÁ•ÉÍ½¹½¹™¥Ì€ôl(€€€€€l‰•¹¹äœ°€	•¹¹ät°(€€€€€lµ…‘•±•¥¹”œ°€5…‘•±•¥¹”t(€€€tì((€€€Á•ÉÍ½¹½¹™¥Ì¹™½É…  ¡mÁ•ÉÍ½¹-•ä°±…‰•±Q•áÑt¤€ôøì(€€€€€½¹ÍÐ™œ€ô•ÑQ…¹­…±…Ñ„¡Á•ÉÍ½¹-•ä¤ì(€€€€€½¹ÍÐÍÕˆ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€ÍÕˆ¹±…ÍÍ9…µ”€ô€…Éœì((€€€€€½¹ÍÐÍÕ‰Q¥Ñ±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Ìœ¤ì(€€€€€ÍÕ‰Q¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ô±…‰•±Q•áÐì(€€€€€ÍÕˆ¹…ÁÁ•¹‘¡¥±¡ÍÕ‰Q¥Ñ±”¤ì((€€€€€½¹ÍÐÉ½ÜÄ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€É½ÜÄ¹±…ÍÍ9…µ”€ô€É½Üœì((€€€€€½¹ÍÐ­µ]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€½¹ÍÐ­µ1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€€€­µ1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€-¥±½µ•Ñ•ÈÁÉ¼5½¹…Ðœì(€€€€€½¹ÍÐ­µ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€€€­µ%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€€€­µ%¹ÁÕÐ¹ÍÑ•À€ô€œÄœì(€€€€€­µ%¹ÁÕÐ¹Ù…±Õ”€ô™œ¹­µA•É5½¹Ñ ñð€œœì(€€€€€­µ%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€€€™œ¹­µA•É5½¹Ñ €ô9Õµ‰•È¡­µ%¹ÁÕÐ¹Ù…±Õ”ñð€À¤ì(€€€€€€€Íå¹Q…¹­•±‘áÁ•¹Í”¡Á•ÉÍ½¹-•ä°ìÍ¥±•¹ÐèÑÉÕ”ô¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€­µ]É…À¹…ÁÁ•¹‘¡¥±¡­µ1…‰•°¤ì(€€€€€­µ]É…À¹…ÁÁ•¹‘¡¥±¡­µ%¹ÁÕÐ¤ì((€€€€€½¹ÍÐ½¹Í]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€½¹ÍÐ½¹Í1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€€€½¹Í1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€Y•É‰É…Õ €¡°¼ÄÀÀ­´¤œì(€€€€€½¹ÍÐ½¹Í%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€€€½¹Í%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€€€½¹Í%¹ÁÕÐ¹ÍÑ•À€ô€œÀ¸Äœì(€€€€€½¹Í%¹ÁÕÐ¹Ù…±Õ”€ô™œ¹½¹ÍÕµÁÑ¥½¸ñð€œœì(€€€€€½¹Í%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€€€™œ¹½¹ÍÕµÁÑ¥½¸€ô9Õµ‰•È¡½¹Í%¹ÁÕÐ¹Ù…±Õ”ñð€À¤ì(€€€€€€€Íå¹Q…¹­•±‘áÁ•¹Í”¡Á•ÉÍ½¹-•ä°ìÍ¥±•¹ÐèÑÉÕ”ô¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€½¹Í]É…À¹…ÁÁ•¹‘¡¥±¡½¹Í1…‰•°¤ì(€€€€€½¹Í]É…À¹…ÁÁ•¹‘¡¥±¡½¹Í%¹ÁÕÐ¤ì((€€€€€½¹ÍÐ™Õ•±]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€½¹ÍÐ™Õ•±1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€€€™Õ•±1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€-É…™ÑÍÑ½™˜œì(€€€€€½¹ÍÐ™Õ•±M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€€€ml‘¥•Í•°œ°¥•Í•°t°l”Ôœ°MÕÁ•ÈÔt°l”ÄÀœ°MÕÁ•ÈÄÀut¹™½É…  ¡mÙ…°°ÑáÑt¤€ôøì(€€€€€€€½¹ÍÐ½ÁÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€€€½ÁÐ¹Ù…±Õ”€ôÙ…°ì(€€€€€€€½ÁÐ¹Ñ•áÑ½¹Ñ•¹Ð€ôÑáÐì(€€€€€€€¥˜€ ¡™œ¹™Õ•±QåÁ”ñð€‘¥•Í•°œ¤€ôôôÙ…°¤½ÁÐ¹Í•±•Ñ•€ôÑÉÕ”ì(€€€€€€€™Õ•±M•±•Ð¹…ÁÁ•¹‘¡¥±¡½ÁÐ¤ì(€€€€€ô¤ì(€€€€€™Õ•±M•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€€€™œ¹™Õ•±QåÁ”€ô™Õ•±M•±•Ð¹Ù…±Õ”ì(€€€€€€€Íå¹Q…¹­•±‘áÁ•¹Í”¡Á•ÉÍ½¹-•ä°ìÍ¥±•¹ÐèÑÉÕ”ô¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€™Õ•±]É…À¹…ÁÁ•¹‘¡¥±¡™Õ•±1…‰•°¤ì(€€€€€™Õ•±]É…À¹…ÁÁ•¹‘¡¥±¡™Õ•±M•±•Ð¤ì((€€€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡­µ]É…À¤ì(€€€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡½¹Í]É…À¤ì(€€€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡™Õ•±]É…À¤ì(€€€€€ÍÕˆ¹…ÁÁ•¹‘¡¥±¡É½ÜÄ¤ì((€€€€€½¹ÍÐÉ½ÜÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€É½ÜÈ¹±…ÍÍ9…µ”€ô€É½Üœì((€€€€€½¹ÍÐ…Ù]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€½¹ÍÐ…Ù1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€€€…Ù1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ`AÉ•¥Ì€ÌÀQ…”€£Š
°½°¤œì(€€€€€½¹ÍÐ…Ù%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€€€…Ù%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€€€…Ù%¹ÁÕÐ¹ÍÑ•À€ô€œÀ¸ÀÀÄœì(€€€€€…Ù%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸€Ä¸Øääœì(€€€€€…Ù%¹ÁÕÐ¹Ù…±Õ”€ô™œ¹…ÙAÉ¥”ñð€œœì(€€€€€…Ù%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€€€™œ¹…ÙAÉ¥”€ô…Ù%¹ÁÕÐ¹Ù…±Õ”ì(€€€€€€€Íå¹Q…¹­•±‘áÁ•¹Í”¡Á•ÉÍ½¹-•ä°ìÍ¥±•¹ÐèÑÉÕ”ô¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€…Ù]É…À¹…ÁÁ•¹‘¡¥±¡…Ù1…‰•°¤ì(€€€€€…Ù]É…À¹…ÁÁ•¹‘¡¥±¡…Ù%¹ÁÕÐ¤ì((€€€€€½¹ÍÐ…ÕÑ½]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€½¹ÍÐ…ÕÑ½1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€€€…ÕÑ½1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€ÕÑ½µ…Ñ¥Í •±…‘•¹•ÈAÉ•¥Ìœì(€€€€€½¹ÍÐ…ÕÑ½%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€€€…ÕÑ½%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€€€…ÕÑ½%¹ÁÕÐ¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€…ÕÑ½%¹ÁÕÐ¹Ù…±Õ”€ô™œ¹…ÕÑ½AÉ¥”€ü€‘í™œ¹…ÕÑ½AÉ¥•ôƒŠ
°½±€€è€œœì(€€€€€…ÕÑ½]É…À¹…ÁÁ•¹‘¡¥±¡…ÕÑ½1…‰•°¤ì(€€€€€…ÕÑ½]É…À¹…ÁÁ•¹‘¡¥±¡…ÕÑ½%¹ÁÕÐ¤ì((€€€€€½¹ÍÐÍÑ…Ñ¥½¹]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€½¹ÍÐÍÑ…Ñ¥½¹1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€€€ÍÑ…Ñ¥½¹1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€AÉ•¥ÍÅÕ•±±”œì(€€€€€½¹ÍÐÍÑ…Ñ¥½¹%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€€€ÍÑ…Ñ¥½¹%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€€€ÍÑ…Ñ¥½¹%¹ÁÕÐ¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€ÍÑ…Ñ¥½¹%¹ÁÕÐ¹Ù…±Õ”€ô™œ¹ÍÑ…Ñ¥½¹9…µ”€ü€‘í™œ¹ÍÑ…Ñ¥½¹9…µ•ô‘í™œ¹±…ÍÑ•Ñ €ü€œƒ
Ü€œ€¬™œ¹±…ÍÑ•Ñ €è€œõ€€è€œœì(€€€€€ÍÑ…Ñ¥½¹]É…À¹…ÁÁ•¹‘¡¥±¡ÍÑ…Ñ¥½¹1…‰•°¤ì(€€€€€ÍÑ…Ñ¥½¹]É…À¹…ÁÁ•¹‘¡¥±¡ÍÑ…Ñ¥½¹%¹ÁÕÐ¤ì((€€€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡…Ù]É…À¤ì(€€€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡…ÕÑ½]É…À¤ì(€€€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡ÍÑ…Ñ¥½¹]É…À¤ì(€€€€€ÍÕˆ¹…ÁÁ•¹‘¡¥±¡É½ÜÈ¤ì((€€€€€½¹ÍÐÑ…¹­	Õ‘•Ð€ô…±Õ±…Ñ•Q…¹­	Õ‘•Ð¡™œ°Á•ÉÍ½¹-•ä¤ì(€€€€€½¹ÍÐ…±±½…Ñ•‘Q…¹­	Õ‘•Ð€ô9Õµ‰•È¡•ÑÕ•±Q½ÁUÁ±±½…Ñ¥½¸¡ÕÉÉ•¹Ñ5½¹Ñ ¤¹…±±½…Ñ¥½¹Ìü¹mÁ•ÉÍ½¹-•åtñð€À¤ì(€€€€€ÍÕˆ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€€€ì±…‰•°è€-¥±½µ•Ñ•È€¼5½¹…Ðœ°Ù…±Õ”è€‘í9Õµ‰•È¡™œ¹­µA•É5½¹Ñ ñð€À¤¹Ñ½¥á• À¥ô­µ€ô°(€€€€€€€ì±…‰•°è€	•É•¡¹Õ¹Í‰…Í¥Ìœ°Ù…±Õ”è€•µ•¥¹Í…µ•ÈQ…¹­Ñ½Á˜ƒ
Ü¹… 1½¡¹…‰éÕœÙ•ÉÑ•¥±Ðœ°­¥¹è…±±½…Ñ•‘Q…¹­	Õ‘•Ð€ø€À€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€€€ì±…‰•°è€AÉ•¥Ì•¹ÕÑéÐœ°Ù…±Õ”èÑ…¹­	Õ‘•Ð¹ÁÉ¥•UÍ•€ü€‘íÑ…¹­	Õ‘•Ð¹ÁÉ¥•UÍ•¹Ñ½¥á• Ì¥ôƒŠ
°½±€€è€¡Ñ…¹­	Õ‘•Ð¹…ÙMÑ…ÑÌ€˜˜Ñ…¹­	Õ‘•Ð¹…ÙMÑ…ÑÌ¹½Õ¹Ð€ü€•¡Ñ•ÈM¡¹¥ÑÐœ€è€ŸŠPœ¤°­¥¹è…±±½…Ñ•‘Q…¹­	Õ‘•Ð€ø€À€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€€€ì±…‰•°è€•¥¹”¥¹é…¡±Õ¹œœ°Ù…±Õ”è€‘í•ÕÉ¼¡…±±½…Ñ•‘Q…¹­	Õ‘•Ð¥õ€°­¥¹è…±±½…Ñ•‘Q…¹­	Õ‘•Ð€ø€À€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô(€€€€€t¤¤ì((€€€€€½¹ÍÐ±¥¹­•‘Q…¹­A½ÍÐ€ô•ÑQ…¹­áÁ•¹Í•A½ÍÐ¡Á•ÉÍ½¹-•ä¤ì(€€€€€½¹ÍÐ±¥¹­%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€±¥¹­%¹™¼¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€€€¥˜€¡±¥¹­•‘Q…¹­A½ÍÐ¤ì(€€€€€€€½¹ÍÐÁ…¥‘Q•áÐ€ô¥ÍA½ÍÑA…¥‘½É5½¹Ñ ¡±¥¹­•‘Q…¹­A½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤€ü€‰•é…¡±Ð½™•ÍÐœ€è€½™™•¸œì(€€€€€€€½¹ÍÐ…Ñ¥Ù•µ½Õ¹Ð€ô•Ñ™™•Ñ¥Ù•µ½Õ¹Ñ½É5½¹Ñ ¡±¥¹­•‘Q…¹­A½ÍÐ°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€±¥¹­%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ôY•É­»ñÁ™Ñ•ÈÕÍ…‰•¹Á½ÍÑ•¸è€‘í±¥¹­•‘Q…¹­A½ÍÐ¹¹…µ•ôƒ
Ü€‘í•ÕÉ¼¡…Ñ¥Ù•µ½Õ¹Ð¥ôƒ
Ü€‘íÁ…¥‘Q•áÑõ€ì(€€€€€ô•±Í”ì(€€€€€€€±¥¹­%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ô€9½ ­•¥¸Q…¹­•±µA½ÍÑ•¸•™Õ¹‘•¸¸	•¥´Må¹¡É½¹¥Í¥•É•¸Ý¥É•È…ÕÑ½µ…Ñ¥Í …¹•±•Ð¸œì(€€€€€ô(€€€€€ÍÕˆ¹…ÁÁ•¹‘¡¥±¡±¥¹­%¹™¼¤ì((€€€€€½¹ÍÐ‰ÕÑÑ½¹I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€‰ÕÑÑ½¹I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì((€€€€€½¹ÍÐ±½…‘	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€±½…‘	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€AÉ•¥Ì…ÕÑ½µ…Ñ¥Í ±…‘•¸œì(€€€€€±½…‘	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€€€±½…‘	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€€€…Ý…¥Ð™•Ñ¡ÕÑ½µ…Ñ¥Õ•±AÉ¥”¡Á•ÉÍ½¹-•ä¤ì(€€€€€ô¤ì((€€€€€½¹ÍÐ…ÁÁ±å	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€…ÁÁ±å	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€Q…¹­•±Íå¹¡É½¹¥Í¥•É•¸œì(€€€€€…ÁÁ±å	Ñ¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€€€…ÁÁ±å	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€ÕÁÍ•ÉÑQ…¹­•±‘ÍA•ÉÍ½¹…±áÁ•¹Í”¡Á•ÉÍ½¹-•ä¤ì(€€€€€ô¤ì((€€€€€‰ÕÑÑ½¹I½Ü¹…ÁÁ•¹‘¡¥±¡±½…‘	Ñ¸¤ì(€€€€€‰ÕÑÑ½¹I½Ü¹…ÁÁ•¹‘¡¥±¡…ÁÁ±å	Ñ¸¤ì(€€€€€ÍÕˆ¹…ÁÁ•¹‘¡¥±¡‰ÕÑÑ½¹I½Ü¤ì((€€€€€Á•ÉÍ½¹•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡ÍÕˆ¤ì(€€€ô¤ì((€€€Í•ÑÑ¥¹Í•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡Á•ÉÍ½¹•Ñ…¥±Ì¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡Í•ÑÑ¥¹Í•Ñ…¥±Ì¤ì(€€€É•¹‘•ÉQ…¹­5½¹Ñ¡½µÁ±•Ñ¥½¸¡…É¤ì(€€€Ñ…¹­…±M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡…É¤ì(€ô((€™Õ¹Ñ¥½¸•Ñ•‰ÑA…åµ•¹Ñµ½Õ¹Ñ½É5½¹Ñ ¡‘•‰Ð°µ½¹Ñ¡-•ä¤ì(€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡‘•‰Ð¤ì(€€€½¹ÍÐ¡¥ÍÑ½Éåµ½Õ¹Ð€ô‘•‰Ð¹Á…åµ•¹Ñ!¥ÍÑ½Éä(€€€€€€¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä¹µ½¹Ñ €ôôôµ½¹Ñ¡-•ä¤(€€€€€€¹É•‘Õ” ¡ÍÕ´°•¹ÑÉä¤€ôøÍÕ´€¬9Õµ‰•È¡•¹ÑÉä¹…µ½Õ¹Ðñð€À¤°€À¤ì(€€€¥˜€¡¡¥ÍÑ½Éåµ½Õ¹Ð€ø€À¤É•ÑÕÉ¸¡¥ÍÑ½Éåµ½Õ¹Ðì(€€€É•ÑÕÉ¸‘•‰Ð¹Á…¥‘5½¹Ñ¡Ì¹¥¹±Õ‘•Ì¡µ½¹Ñ¡-•ä¤€ü9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°µ½¹Ñ¡-•ä¤ñð€À¤€è€Àì(€ô((€™Õ¹Ñ¥½¸•Ñ•‰ÑA…¥‘µ½Õ¹Ñ½É5½¹Ñ ¡µ½¹Ñ¡-•ä¤ì(€€€±•ÐÁ…¥€ô€Àì(€€€ÍÑ…Ñ”¹‘•‰ÑÌ¹™½É…  ¡¤€ôøì(€€€€€Á…¥€¬ô•Ñ•‰Ñ½Ù•É•‘µ½Õ¹Ñ½É5½¹Ñ ¡°µ½¹Ñ¡-•ä¤ì(€€€ô¤ì(€€€É•ÑÕÉ¸Á…¥ì(€ô((€™Õ¹Ñ¥½¸•Ñ•‰ÑA…åµ•¹Ñ½Õ¹Ñ%¡‘•‰Ð°½ÁÑ¥½¹Ì€ôíô¤ì(€€€¥˜€¡½ÁÑ¥½¹Ì¹…½Õ¹Ñ%€˜˜•Ñ½Õ¹Ñ	å%¡½ÁÑ¥½¹Ì¹…½Õ¹Ñ%¤¤É•ÑÕÉ¸½ÁÑ¥½¹Ì¹…½Õ¹Ñ%ì(€€€¥˜€¡‘•‰Ð€˜˜‘•‰Ð¹…½Õ¹Ñ%€˜˜•Ñ½Õ¹Ñ	å%¡‘•‰Ð¹…½Õ¹Ñ%¤¤É•ÑÕÉ¸‘•‰Ð¹…½Õ¹Ñ%ì(€€€½¹ÍÐ±¥¹­•€ô‘•‰Ð€ü•Ñ1¥¹­•‘A½ÍÑÍ½É•‰Ð¡‘•‰Ð¤€èmtì(€€€™½È€¡½¹ÍÐ¥Ñ•´½˜±¥¹­•¤ì(€€€€€½¹ÍÐÁ½ÍÐ€ô¥Ñ•´€˜˜¥Ñ•´¹Á½ÍÐì(€€€€€¥˜€ …Á½ÍÐ¤½¹Ñ¥¹Õ”ì(€€€€€•¹ÍÕÉ•A½ÍÑ½¹™¥œ¡Á½ÍÐ¤ì(€€€€€½¹ÍÐ…½Õ¹Ñ%€ô¥¹™•É½Õ¹Ñ%‘½ÉA½ÍÐ¡Á½ÍÐ¤ì(€€€€€¥˜€¡…½Õ¹Ñ%€˜˜•Ñ½Õ¹Ñ	å%¡…½Õ¹Ñ%¤¤É•ÑÕÉ¸…½Õ¹Ñ%ì(€€€ô(€€€½¹ÍÐ‰•¹¹ä€ô•ÑA•ÉÍ½¹	å% ‰•¹¹äœ¤ì(€€€½¹ÍÐ‰•¹¹å½Õ¹Ð€ô‰•¹¹ä€ü•ÑA•ÉÍ½¹%¹½µ•½Õ¹Ñ%¡‰•¹¹ä¤€è€œœì(€€€¥˜€¡‰•¹¹å½Õ¹Ð€˜˜•Ñ½Õ¹Ñ	å%¡‰•¹¹å½Õ¹Ð¤¤É•ÑÕÉ¸‰•¹¹å½Õ¹Ðì(€€€½¹ÍÐ™…±±‰…¬€ô•Ñ•™…Õ±Ñ½Õ¹Ñ%‘½É½¹Ñ•áÐ Á•ÉÍ½¹…°œ°€‰•¹¹äœ¤ì(€€€¥˜€¡™…±±‰…¬€˜˜•Ñ½Õ¹Ñ	å%¡™…±±‰…¬¤¤É•ÑÕÉ¸™…±±‰…¬ì(€€€½¹ÍÐ¡•­¥¹œ€ô€¡ÍÑ…Ñ”¹…½Õ¹ÑÌñðmt¤¹™¥¹ ¡…½Õ¹Ð¤€ôø¹½Éµ…±¥é•½Õ¹ÑQåÁ”¡…½Õ¹Ð¹ÑåÁ”¤€ôôô€¡•­¥¹œœ¤ì(€€€É•ÑÕÉ¸¡•­¥¹œ€ü¡•­¥¹œ¹¥€è€œœì(€ô((€™Õ¹Ñ¥½¸…‘‘•‰ÑA…åµ•¹Ð¡‘•‰Ð°½ÁÑ¥½¹Ì€ôíô¤ì(€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡‘•‰Ð¤ì(€€€½¹ÍÐµ½¹Ñ €ô¥Í5½¹Ñ¡-•ä¡½ÁÑ¥½¹Ì¹µ½¹Ñ ¤€ü½ÁÑ¥½¹Ì¹µ½¹Ñ €è€¡¥Í5½¹Ñ¡-•ä¡‘•‰Ð¹¹•áÑÕ•5½¹Ñ ¤€ü‘•‰Ð¹¹•áÑÕ•5½¹Ñ €èÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ…µ½Õ¹ÑI…Ü€ô9Õµ‰•È¡½ÁÑ¥½¹Ì¹…µ½Õ¹Ð¤ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹ÑI…Ü¤€ü5…Ñ ¹µ…à À°…µ½Õ¹ÑI…Ü¤€è9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°µ½¹Ñ ñðÕÉÉ•¹Ñ5½¹Ñ ¤ñð€À¤ì(€€€¥˜€ „¡…µ½Õ¹Ð€ø€À¤¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐµ…É­Í5½¹Ñ¡±ä€ô½ÁÑ¥½¹Ì¹µ…É­Í5½¹Ñ¡±ä€ôôôÑÉÕ”ì(€€€½¹ÍÐÁÉ•Ù¥½ÕÍ9•áÑÕ•5½¹Ñ €ô‘•‰Ð¹¹•áÑÕ•5½¹Ñ ñð€œœì(€€€½¹ÍÐ…±É•…‘å5…É­•‘5½¹Ñ¡±ä€ô‘•‰Ð¹Á…¥‘5½¹Ñ¡Ì¹¥¹±Õ‘•Ì¡µ½¹Ñ ¤ì(€€€½¹ÍÐ…±É•…‘å!…Í5½¹Ñ¡±å!¥ÍÑ½Éä€ô‘•‰Ð¹Á…åµ•¹Ñ!¥ÍÑ½Éä¹Í½µ” ¡•¹ÑÉä¤€ôø•¹ÑÉä¹µ½¹Ñ €ôôôµ½¹Ñ €˜˜•¹ÑÉä¹µ…É­•‘Í5½¹Ñ¡±ä¤ì(€€€¥˜€¡µ…É­Í5½¹Ñ¡±ä€˜˜€¡…±É•…‘å!…Í5½¹Ñ¡±å!¥ÍÑ½Éäñð€¡…±É•…‘å5…É­•‘5½¹Ñ¡±ä€˜˜½ÁÑ¥½¹Ì¹…±±½Ýá¥ÍÑ¥¹5½¹Ñ¡±åMÑ…ÑÕÌ€„ôôÑÉÕ”¤¤¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô(€€€½¹ÍÐÁ…åµ•¹Ñµ½Õ¹Ð€ô½ÁÑ¥½¹Ì¹É•‘Õ•‘=Á•¹	…±…¹”€ôôô™…±Í”(€€€€€€ü…µ½Õ¹Ð(€€€€€€è5…Ñ ¹µ¥¸¡…µ½Õ¹Ð°9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤¤ì(€€€¥˜€ „¡Á…åµ•¹Ñµ½Õ¹Ð€ø€À¤¤É•ÑÕÉ¸™…±Í”ì((€€€½¹ÍÐ¡¥ÍÑ½Éå%€ô•¹•É…Ñ•% ¤ì(€€€±•Ð…½Õ¹ÑQÉ…¹Í…Ñ¥½¹%€ô€œœì(€€€¥˜€¡=U9QM}9	1€˜˜½ÁÑ¥½¹Ì¹‰½½­½Õ¹ÑQÉ…¹Í…Ñ¥½¸€ôôôÑÉÕ”€˜˜½ÁÑ¥½¹Ì¹Í­¥Á½Õ¹ÑQÉ…¹Í…Ñ¥½¸€„ôôÑÉÕ”¤ì(€€€€€½¹ÍÐ…½Õ¹Ñ%€ô•Ñ•‰ÑA…åµ•¹Ñ½Õ¹Ñ%¡‘•‰Ð°½ÁÑ¥½¹Ì¤ì(€€€€€¥˜€¡…½Õ¹Ñ%¤ì(€€€€€€€‘•‰Ð¹…½Õ¹Ñ%€ô…½Õ¹Ñ%ì(€€€€€€€…½Õ¹ÑQÉ…¹Í…Ñ¥½¹%€ô…ÁÁ±å½Õ¹Ñ1•‘•ÉQÉ…¹Í…Ñ¥½¸¡…½Õ¹Ñ%°ì(€€€€€€€€€µ½¹Ñ °(€€€€€€€€€ÑåÁ”è€‘•‰Ñ}Á…åµ•¹Ðœ°(€€€€€€€€€Í½ÕÉ•%è•Ñ•‰Ñ½Õ¹ÑQÉ…¹Í…Ñ¥½¹M½ÕÉ”¡‘•‰Ð°µ½¹Ñ °¡¥ÍÑ½Éå%¤°(€€€€€€€€€±…‰•°è€‘í‘•‰Ð¹¹…µ”ñð€M¡Õ±ô€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡µ½¹Ñ ¥õ€°(€€€€€€€€€…µ½Õ¹Ðè€µÁ…åµ•¹Ñµ½Õ¹Ð°(€€€€€€€€€…™™•ÑÍ	…±…¹”èÑÉÕ”(€€€€€€€ô¤ñð€œœì(€€€€€ô(€€€ô((€€€‘•‰Ð¹Á…åµ•¹Ñ!¥ÍÑ½Éä¹ÁÕÍ ¡ì(€€€€€¥è¡¥ÍÑ½Éå%°(€€€€€µ½¹Ñ °(€€€€€…µ½Õ¹ÐèÁ…åµ•¹Ñµ½Õ¹Ð°(€€€€€Á…åµ•¹Ñ5•Ñ¡½è¹½Éµ…±¥é•!½ÕÍ•¡½±‘A…åµ•¹Ñ5•Ñ¡½¡½ÁÑ¥½¹Ì¹Á…åµ•¹Ñ5•Ñ¡½¤°(€€€€€Í½ÕÉ”è½ÁÑ¥½¹Ì¹Í½ÕÉ”ñð€5…¹Õ•±±”i…¡±Õ¹œœ°(€€€€€Í½ÕÉ•A½ÍÑ%èÑåÁ•½˜½ÁÑ¥½¹Ì¹Í½ÕÉ•A½ÍÑ%€ôôô€ÍÑÉ¥¹œœ€ü½ÁÑ¥½¹Ì¹Í½ÕÉ•A½ÍÑ%€è€œœ°(€€€€€¹½Ñ”è½ÁÑ¥½¹Ì¹¹½Ñ”ñð€œœ°(€€€€€É•…Ñ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€ÁÉ•Ù¥½ÕÍ9•áÑÕ•5½¹Ñ °(€€€€€µ…É­•‘Í5½¹Ñ¡±äèµ…É­Í5½¹Ñ¡±ä°(€€€€€…½Õ¹ÑQÉ…¹Í…Ñ¥½¹%°(€€€€€É•‘Õ•‘=Á•¹	…±…¹”è½ÁÑ¥½¹Ì¹É•‘Õ•‘=Á•¹	…±…¹”€„ôô™…±Í”(€€€ô¤ì((€€€¥˜€¡½ÁÑ¥½¹Ì¹É•‘Õ•‘=Á•¹	…±…¹”€„ôô™…±Í”¤ì(€€€€€‘•‰Ð¹…µ½Õ¹Ñ=Á•¸€ô5…Ñ ¹µ…à À°9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤€´Á…åµ•¹Ñµ½Õ¹Ð¤ì(€€€ô(€€€¥˜€¡9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ðô€À¤ì(€€€€€‘•‰Ð¹½µÁ±•Ñ•‘5½¹Ñ €ôµ½¹Ñ ì(€€€ô((€€€¥˜€¡µ…É­Í5½¹Ñ¡±ä€˜˜€…‘•‰Ð¹Á…¥‘5½¹Ñ¡Ì¹¥¹±Õ‘•Ì¡µ½¹Ñ ¤¤ì(€€€€€‘•‰Ð¹Á…¥‘5½¹Ñ¡Ì¹ÁÕÍ ¡µ½¹Ñ ¤ì(€€€ô(€€€¥˜€¡µ…É­Í5½¹Ñ¡±ä¤ì(€€€€€…‘Ù…¹••‰Ñ9•áÑÕ•5½¹Ñ¡™Ñ•ÉA…åµ•¹Ð¡‘•‰Ð°µ½¹Ñ ¤ì(€€€ô(€€€¥˜€¡½ÁÑ¥½¹Ì¹Í­¥Á1¥¹­•‘A½ÍÑMå¹Œ€„ôôÑÉÕ”¤ì(€€€€€Íå¹1¥¹­•‘A½ÍÑÍÉ½µ•‰ÑA…åµ•¹Ð¡‘•‰Ð°ì(€€€€€€€µ½¹Ñ °(€€€€€€€Á…åµ•¹Ñµ½Õ¹Ð°(€€€€€€€±¥¹­•‘A½ÍÑµ½Õ¹Ðè½ÁÑ¥½¹Ì¹±¥¹­•‘A½ÍÑµ½Õ¹Ð°(€€€€€€€¡¥ÍÑ½Éå%°(€€€€€€€µ…É­Í5½¹Ñ¡±ä°(€€€€€€€‘•‰Ñ½µÁ±•Ñ•è9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ðô€À(€€€€€ô¤ì(€€€ô(€€€…‘‘¡…¹•1½œ M¡Õ±‘•¸œ°€‘í‘•‰Ð¹¹…µ”ñð€M¡Õ±ôè€‘í•ÕÉ¼¡Á…åµ•¹Ñµ½Õ¹Ð¥ô‰•é…¡±Ñ€°µ½¹Ñ ¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô((€™Õ¹Ñ¥½¸É•Í•Ñ•‰ÑA…åµ•¹Ñ½É5½¹Ñ ¡‘•‰Ð°µ½¹Ñ¡-•ä°½ÁÑ¥½¹Ì€ôíô¤ì(€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡‘•‰Ð¤ì(€€€½¹ÍÐÍ½ÕÉ•A½ÍÑ%€ôÑåÁ•½˜½ÁÑ¥½¹Ì¹Í½ÕÉ•A½ÍÑ%€ôôô€ÍÑÉ¥¹œœ€ü½ÁÑ¥½¹Ì¹Í½ÕÉ•A½ÍÑ%€è€œœì(€€€½¹ÍÐÍ½ÕÉ•1…‰•°€ôÑåÁ•½˜½ÁÑ¥½¹Ì¹Í½ÕÉ•1…‰•°€ôôô€ÍÑÉ¥¹œœ€ü½ÁÑ¥½¹Ì¹Í½ÕÉ•1…‰•°€è€œœì(€€€½¹ÍÐÉ•ÍÑÉ¥ÑQ½A½ÍÐ€ô€„„¡Í½ÕÉ•A½ÍÑ%ñðÍ½ÕÉ•1…‰•°¤ì(€€€½¹ÍÐµ…Ñ¡•Í¹ÑÉä€ô€¡•¹ÑÉä¤€ôø•¹ÑÉä¹µ½¹Ñ €ôôôµ½¹Ñ¡-•ä€˜˜€ …É•ÍÑÉ¥ÑQ½A½ÍÐ(€€€€€ñð€¡Í½ÕÉ•A½ÍÑ%€˜˜•¹ÑÉä¹Í½ÕÉ•A½ÍÑ%€ôôôÍ½ÕÉ•A½ÍÑ%¤(€€€€€ñð€ …•¹ÑÉä¹Í½ÕÉ•A½ÍÑ%€˜˜Í½ÕÉ•1…‰•°€˜˜•¹ÑÉä¹Í½ÕÉ”€ôôôÍ½ÕÉ•1…‰•°¤¤ì(€€€½¹ÍÐ•¹ÑÉ¥•Ì€ô‘•‰Ð¹Á…åµ•¹Ñ!¥ÍÑ½Éä¹™¥±Ñ•È¡µ…Ñ¡•Í¹ÑÉä¤ì(€€€±•ÐÉ•ÍÑ½É•µ½Õ¹Ð€ô€Àì(€€€¥˜€¡•¹ÑÉ¥•Ì¹±•¹Ñ €ø€À¤ì(€€€€€•¹ÑÉ¥•Ì¹™½É…  ¡•¹ÑÉä¤€ôøì(€€€€€€€¥˜€¡•¹ÑÉä¹…½Õ¹ÑQÉ…¹Í…Ñ¥½¹%¤É•µ½Ù•½Õ¹Ñ1•‘•ÉQÉ…¹Í…Ñ¥½¸¡‘•‰Ð¹…½Õ¹Ñ%°•¹ÑÉä¹…½Õ¹ÑQÉ…¹Í…Ñ¥½¹%¤ñðÉ•µ½Ù•½Õ¹ÑQÉ…¹Í…Ñ¥½¸¡‘•‰Ð¹…½Õ¹Ñ%°•¹ÑÉä¹…½Õ¹ÑQÉ…¹Í…Ñ¥½¹%¤ì(€€€€€€€É•µ½Ù•½Õ¹Ñ1•‘•ÉQÉ…¹Í…Ñ¥½¹	åM½ÕÉ”¡•Ñ•‰Ñ½Õ¹ÑQÉ…¹Í…Ñ¥½¹M½ÕÉ”¡‘•‰Ð°µ½¹Ñ¡-•ä°•¹ÑÉä¹¥¤¤ñðÉ•µ½Ù•½Õ¹ÑQÉ…¹Í…Ñ¥½¹	åM½ÕÉ”¡•Ñ•‰Ñ½Õ¹ÑQÉ…¹Í…Ñ¥½¹M½ÕÉ”¡‘•‰Ð°µ½¹Ñ¡-•ä°•¹ÑÉä¹¥¤¤ì(€€€€€ô¤ì(€€€€€É•ÍÑ½É•µ½Õ¹Ð€ô•¹ÑÉ¥•Ì¹É•‘Õ” ¡ÍÕ´°•¹ÑÉä¤€ôøÍÕ´€¬€¡•¹ÑÉä¹É•‘Õ•‘=Á•¹	…±…¹”€ôôô™…±Í”€ü€À€è9Õµ‰•È¡•¹ÑÉä¹…µ½Õ¹Ðñð€À¤¤°€À¤ì(€€€€€‘•‰Ð¹Á…åµ•¹Ñ!¥ÍÑ½Éä€ô‘•‰Ð¹Á…åµ•¹Ñ!¥ÍÑ½Éä¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø€…µ…Ñ¡•Í¹ÑÉä¡•¹ÑÉä¤¤ì(€€€€€É•Í•Ñ1¥¹­•‘A½ÍÑÍÉ½µ•‰ÑA…åµ•¹Ð¡‘•‰Ð°µ½¹Ñ¡-•ä°•¹ÑÉ¥•Ì¤ì(€€€ô•±Í”¥˜€ …É•ÍÑÉ¥ÑQ½A½ÍÐ€˜˜‘•‰Ð¹Á…¥‘5½¹Ñ¡Ì¹¥¹±Õ‘•Ì¡µ½¹Ñ¡-•ä¤¤ì(€€€€€É•ÍÑ½É•µ½Õ¹Ð€ô9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°µ½¹Ñ¡-•ä¤ñð€À¤ì(€€€€€É•Í•Ñ1¥¹­•‘A½ÍÑÍÉ½µ•‰ÑA…åµ•¹Ð¡‘•‰Ð°µ½¹Ñ¡-•ä¤ì(€€€ô(€€€½¹ÍÐÉ•µ½Ù•Í5½¹Ñ¡±åMÑ…ÑÕÌ€ô€…É•ÍÑÉ¥ÑQ½A½ÍÐñð•¹ÑÉ¥•Ì¹Í½µ” ¡•¹ÑÉä¤€ôø•¹ÑÉä¹µ…É­•‘Í5½¹Ñ¡±ä¤ì(€€€½¹ÍÐ½Ñ¡•É5½¹Ñ¡±å¹ÑÉåI•µ…¥¹Ì€ô‘•‰Ð¹Á…åµ•¹Ñ!¥ÍÑ½Éä¹Í½µ” ¡•¹ÑÉä¤€ôø•¹ÑÉä¹µ½¹Ñ €ôôôµ½¹Ñ¡-•ä€˜˜•¹ÑÉä¹µ…É­•‘Í5½¹Ñ¡±ä¤ì(€€€¥˜€¡É•µ½Ù•Í5½¹Ñ¡±åMÑ…ÑÕÌ€˜˜€…½Ñ¡•É5½¹Ñ¡±å¹ÑÉåI•µ…¥¹Ì¤ì(€€€€€‘•‰Ð¹Á…¥‘5½¹Ñ¡Ì€ô‘•‰Ð¹Á…¥‘5½¹Ñ¡Ì¹™¥±Ñ•È ¡´¤€ôø´€„ôôµ½¹Ñ¡-•ä¤ì(€€€ô(€€€¥˜€¡É•ÍÑ½É•µ½Õ¹Ð€ø€À¤ì(€€€€€‘•‰Ð¹…µ½Õ¹Ñ=Á•¸€ô9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤€¬É•ÍÑ½É•µ½Õ¹Ðì(€€€ô(€€€¥˜€¡9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ø€À¤ì(€€€€€‘•±•Ñ”‘•‰Ð¹½µÁ±•Ñ•‘5½¹Ñ ì(€€€ô(€€€¥˜€¡É•µ½Ù•Í5½¹Ñ¡±åMÑ…ÑÕÌ€˜˜€ …‘•‰Ð¹¹•áÑÕ•5½¹Ñ ñðµ½¹Ñ¡¥™˜¡µ½¹Ñ¡-•ä°‘•‰Ð¹¹•áÑÕ•5½¹Ñ ¤€ø€À¤¤ì(€€€€€‘•‰Ð¹¹•áÑÕ•5½¹Ñ €ôµ½¹Ñ¡-•äì(€€€ô(€€€¥˜€¡É•ÍÑ½É•µ½Õ¹Ð€ø€À¤…‘‘¡…¹•1½œ M¡Õ±‘•¸œ°€‘í‘•‰Ð¹¹…µ”ñð€M¡Õ±ôèi…¡±Õ¹œ€‘í•ÕÉ¼¡É•ÍÑ½É•µ½Õ¹Ð¥ôéÕËñ­•Í•ÑéÑ€°µ½¹Ñ¡-•ä¤ì(€€€É•ÑÕÉ¸É•ÍÑ½É•µ½Õ¹Ð€ø€Àì(€ô((€™Õ¹Ñ¥½¸•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹-•ä¡µ½¹Ñ¡-•ä°‘•‰Ñ%°ÑåÁ”°…µ½Õ¹Ð¤ì(€€€É•ÑÕÉ¸mµ½¹Ñ¡-•ä°‘•‰Ñ%ñð€½¡¹”µ¥œ°ÑåÁ”ñð€é…¡±Õ¹œœ°É½Õ¹‘5½¹•ä¡9Õµ‰•È¡…µ½Õ¹Ðñð€À¤¤¹Ñ½¥á• È¥t¹©½¥¸ ðœ¤ì(€ô((€™Õ¹Ñ¥½¸•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä¤ì(€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€É•ÑÕÉ¸ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÍm…Ñ¥½¹-•åtñð€œœì(€ô((€™Õ¹Ñ¥½¸Í•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä°ÍÑ…ÑÕÌ¤ì(€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€¥˜€¡ÍÑ…ÑÕÌ€ôôô€±…Ñ•ÈœñðÍÑ…ÑÕÌ€ôôô€‘½¹”œ¤ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÍm…Ñ¥½¹-•åt€ôÍÑ…ÑÕÌì(€€€•±Í”‘•±•Ñ”ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÍm…Ñ¥½¹-•åtì(€ô((€™Õ¹Ñ¥½¸•ÑI•½É‘•‘•‰ÑM…Ù¥¹ÍI•Í•ÉÙ•	•™½É•5½¹Ñ ¡µ½¹Ñ¡-•ä¤ì(€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€¥˜€ …¥Í5½¹Ñ¡-•ä¡µ½¹Ñ¡-•ä¤¤É•ÑÕÉ¸€Àì(€€€½¹ÍÐ‰…±…¹”€ôÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑM…Ù¥¹Í1•‘•È¹É•‘Õ” ¡ÍÕ´°•¹ÑÉä¤€ôøì(€€€€€¥˜€ …•¹ÑÉäñð€…¥Í5½¹Ñ¡-•ä¡•¹ÑÉä¹µ½¹Ñ ¤ñð•¹ÑÉä¹µ½¹Ñ €øµ½¹Ñ¡-•ä¤É•ÑÕÉ¸ÍÕ´ì(€€€€€€¼¼•È™•ÍÑ”M¡Õ±‘•¹Á±…¸ÍÑ…ÉÑ•Ð¥´=­Ñ½‰•È€ÈÀÈØ¹•Ô¸9ÕÈÑ…ÑÏ‘¡±¥ (€€€€€€¼¼‰•ÍÓ‘Ñ¥Ñ”Kñ­±…•¸…ˆ‘¥•Í•´5½¹…Ð•£ÙÉ•¸éÔÍ•¥¹•´MÑ…ÉÑ‰•ÍÑ…¹¸(€€€€€¥˜€¡•¹ÑÉä¹µ½¹Ñ €ðÍ¹½Ý‰…±±½¹™¥œ¹µ½¹Ñ¡±åQ…É•ÑMÑ…ÉÑ5½¹Ñ ¤É•ÑÕÉ¸ÍÕ´ì(€€€€€€¼¼¥¹é…¡±Õ¹•¸‘•Ì±…Õ™•¹‘•¸A±…¹µ½¹…ÑÌ•¹ÑÍÑ•¡•¸•ÉÍÐ…ÕÌ‘•ÍÍ•¸I•ÍÐ¸(€€€€€€¼¼	•É•¥ÑÌ‘½­Õµ•¹Ñ¥•ÉÑ”¹Ñ¹…¡µ•¸·ñÍÍ•¸‘…••¸Í½™½ÉÐ‰•Ëñ­Í¥¡Ñ¥Ð(€€€€€€¼¼Ý•É‘•¸°‘…µ¥Ð‘¥•Í•±‰”Kñ­±…”¹¥¡Ð•¥¸éÝ•¥Ñ•Ì5…°Ù½É•Í¡±…•¸Ý¥É¸(€€€€€¥˜€¡•¹ÑÉä¹µ½¹Ñ €ôôôµ½¹Ñ¡-•ä€˜˜•¹ÑÉä¹ÑåÁ”€„ôô€Ý¥Ñ¡‘É…Ý…°œ¤É•ÑÕÉ¸ÍÕ´ì(€€€€€É•ÑÕÉ¸ÍÕ´€¬€¡•¹ÑÉä¹ÑåÁ”€ôôô€‘•Á½Í¥Ðœ€ü9Õµ‰•È¡•¹ÑÉä¹…µ½Õ¹Ðñð€À¤€è€µ9Õµ‰•È¡•¹ÑÉä¹…µ½Õ¹Ðñð€À¤¤ì(€€€ô°€À¤ì(€€€É•ÑÕÉ¸É½Õ¹‘5½¹•ä¡5…Ñ ¹µ…à À°‰…±…¹”¤¤ì(€ô((€™Õ¹Ñ¥½¸Í•ÑI•½É‘•‘•‰ÑM…Ù¥¹Í•Á½Í¥Ð¡…Ñ¥½¹-•ä°µ½¹Ñ¡-•ä°…µ½Õ¹Ð°•¹…‰±•¤ì(€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€½¹ÍÐ­•ä€ôMÑÉ¥¹œ¡…Ñ¥½¹-•äñð€œœ¤ì(€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑM…Ù¥¹Í1•‘•È€ôÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑM…Ù¥¹Í1•‘•È¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø€„¡•¹ÑÉä¹ÑåÁ”€ôôô€‘•Á½Í¥Ðœ€˜˜•¹ÑÉä¹…Ñ¥½¹-•ä€ôôô­•ä¤¤ì(€€€¥˜€ …•¹…‰±•¤É•ÑÕÉ¸ì(€€€½¹ÍÐÍ…™•µ½Õ¹Ð€ôÉ½Õ¹‘5½¹•ä¡5…Ñ ¹µ…à À°9Õµ‰•È¡…µ½Õ¹Ðñð€À¤¤¤ì(€€€¥˜€ „¡Í…™•µ½Õ¹Ð€ø€À¤ñð€…¥Í5½¹Ñ¡-•ä¡µ½¹Ñ¡-•ä¤¤É•ÑÕÉ¸ì(€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑM…Ù¥¹Í1•‘•È¹ÁÕÍ ¡ì(€€€€€¥è•¹•É…Ñ•% ¤°(€€€€€µ½¹Ñ èµ½¹Ñ¡-•ä°(€€€€€ÑåÁ”è€‘•Á½Í¥Ðœ°(€€€€€…µ½Õ¹ÐèÍ…™•µ½Õ¹Ð°(€€€€€…Ñ¥½¹-•äè­•ä°(€€€€€‘•‰Ñ%è€œœ°(€€€€€‘•‰Ñ9…µ”è€M¡Õ±‘•¸µKñ­±…”Q…•Í•±œ°(€€€€€¹½Ñ”è€9¥¡Ð•¥¹Í•Ñé‰…É•ÈQ•¥°‘•Ì™•ÍÑ•¸M¡Õ±‘•¸µA½½±Ìœ°(€€€€€É•…Ñ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤(€€€ô¤ì(€ô((€™Õ¹Ñ¥½¸É•½É‘•‰ÑM…Ù¥¹Í]¥Ñ¡‘É…Ý…°¡…Ñ¥½¹-•ä°µ½¹Ñ¡-•ä°…µ½Õ¹Ð°‘•‰Ð¤ì(€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€½¹ÍÐ­•ä€ôMÑÉ¥¹œ¡…Ñ¥½¹-•äñð€œœ¤ì(€€€¥˜€¡­•ä€˜˜ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑM…Ù¥¹Í1•‘•È¹Í½µ” ¡•¹ÑÉä¤€ôø•¹ÑÉä¹ÑåÁ”€ôôô€Ý¥Ñ¡‘É…Ý…°œ€˜˜•¹ÑÉä¹…Ñ¥½¹-•ä€ôôô­•ä¤¤É•ÑÕÉ¸ì(€€€½¹ÍÐ…Ù…¥±…‰±”€ô•ÑI•½É‘•‘•‰ÑM…Ù¥¹ÍI•Í•ÉÙ•	•™½É•5½¹Ñ ¡µ½¹Ñ¡-•ä¤ì(€€€½¹ÍÐÍ…™•µ½Õ¹Ð€ôÉ½Õ¹‘5½¹•ä¡5…Ñ ¹µ¥¸¡…Ù…¥±…‰±”°5…Ñ ¹µ…à À°9Õµ‰•È¡…µ½Õ¹Ðñð€À¤¤¤¤ì(€€€¥˜€ „¡Í…™•µ½Õ¹Ð€ø€À¤ñð€…¥Í5½¹Ñ¡-•ä¡µ½¹Ñ¡-•ä¤¤É•ÑÕÉ¸ì(€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑM…Ù¥¹Í1•‘•È¹ÁÕÍ ¡ì(€€€€€¥è•¹•É…Ñ•% ¤°(€€€€€µ½¹Ñ èµ½¹Ñ¡-•ä°(€€€€€ÑåÁ”è€Ý¥Ñ¡‘É…Ý…°œ°(€€€€€…µ½Õ¹ÐèÍ…™•µ½Õ¹Ð°(€€€€€…Ñ¥½¹-•äè­•ä°(€€€€€‘•‰Ñ%è‘•‰Ð€˜˜‘•‰Ð¹¥ñð€œœ°(€€€€€‘•‰Ñ9…µ”è‘•‰Ð€˜˜‘•‰Ð¹¹…µ”ñð€M¡Õ±œ°(€€€€€¹½Ñ”è€M¡Õ±‘•¸µKñ­±…”›ñÈ•¥¹”Q¥±Õ¹œ•¥¹•Í•ÑéÐœ°(€€€€€É•…Ñ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤(€€€ô¤ì(€ô((€™Õ¹Ñ¥½¸•Ñ•‰ÑA±…¹I½Ý½É5½¹Ñ ¡Á±…¸°µ½¹Ñ¡-•ä¤ì(€€€É•ÑÕÉ¸€ ¡Á±…¸€˜˜Á±…¸¹É½ÝÌ¤ñðmt¤¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹µ½¹Ñ €ôôôµ½¹Ñ¡-•ä¤ñð¹Õ±°ì(€ô((€™Õ¹Ñ¥½¸É•…Ñ••‰Ñ•Ñ…¥±Ì¡ÍÕµµ…ÉåQ•áÐ°½¹Ñ•¹Ð°½Á•¸€ô™…±Í”¤ì(€€€½¹ÍÐ‘•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€‘•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€½µÁ…Ðµ‘•Ñ…¥±Ì‘•‰Ðµ‘•Ñ…¥±Ìœì(€€€‘•Ñ…¥±Ì¹½Á•¸€ô€„…½Á•¸ì(€€€½¹ÍÐÍÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€ÍÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ôÍÕµµ…ÉåQ•áÐì(€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡ÍÕµµ…Éä¤ì(€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡½¹Ñ•¹Ð¤ì(€€€É•ÑÕÉ¸‘•Ñ…¥±Ìì(€ô((€™Õ¹Ñ¥½¸É•¹‘•É•‰Ñ5½¹Ñ¡±åÍÍ¥ÍÑ…¹Ñ…É¡µ½¹Ñ¡-•ä°Á±…¸€ô¹Õ±°¤ì(€€€¥˜€ …¥Í5½¹Ñ¡-•ä¡µ½¹Ñ¡-•ä¤¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐ…Ñ¥Ù•A±…¸€ôÁ±…¸ñð‰Õ¥±‘M¹½Ý‰…±±A±…¸¡µ½¹Ñ¡-•ä°€ÄÈÀ¤ì(€€€½¹ÍÐÉ½Ü€ô•Ñ•‰ÑA±…¹I½Ý½É5½¹Ñ ¡…Ñ¥Ù•A±…¸°µ½¹Ñ¡-•ä¤ì(€€€¥˜€ …É½Ü¤É•ÑÕÉ¸¹Õ±°ì((€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€ÍÕˆµ…É‘•‰Ðµµ½¹Ñ µ…ÍÍ¥ÍÑ…¹Ðµ…Éœì(€€€½¹ÍÐ¡•…€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•…¹±…ÍÍ9…µ”€ô€½µÁ…ÐµÍ•Ñ¥½¸µ¡•…œì(€€€¡•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°M¡Õ±‘•¸µ5½¹…ÑÍ…ÍÍ¥ÍÑ•¹Ðƒ
Ü€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡µ½¹Ñ¡-•ä¥õ€¤¤ì(€€€½¹ÍÐ½Á•¹µ½Õ¹Ð€ôÉ½Õ¹‘5½¹•ä¡5…Ñ ¹µ…à À°9Õµ‰•È¡É½Ü¹µ½¹Ñ¡±åQ…É•ÐñðÉ½Ü¹Á½½°ñð€À¤€´9Õµ‰•È¡É½Ü¹…±É•…‘åA…¥ñð€À¤¤¤ì(€€€¡•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°½Á•¹µ½Õ¹Ð€ø€À¸ÀÀÔ€ü€Á¥±°Ý…É¹¥¹œœ€è€Á¥±°ÍÕ•ÍÌœ°½Á•¹µ½Õ¹Ð€ø€À¸ÀÀÔ€ü€‘í•ÕÉ¼¡½Á•¹µ½Õ¹Ð¥ôéÔ‰•…É‰•¥Ñ•¹€€è€5½¹…Ð•É±•‘¥Ðœ¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡¡•…¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€•ÈÉÕ¹‘Á½½°‰•ÑË‘Ð€àÀÀƒŠ
°¸ˆ)…¹Õ…È€ÈÀÈÜ­½µµÐ‰•¤	•¹¹ä¥¹­½µµ•¸ƒñ‰•È€È¸ÌÀÀƒŠ
°…±ÌÍ•Á…É…Ñ•ÌM½¹‘•ÉÑ¥±Õ¹Í‰Õ‘•Ð¡¥¹éÔ¸ÉÍÐÁËñ™Ð‘¥”ÁÀ°½ˆ•¥¹”••¥¹•Ñ”M¡Õ±Ù½±±ÍÓ‘¹‘¥œ…‰³ÙÍ‰…È¥ÍÐìÝ•¹¸¹¥¡Ð°•¡Ð‘¥”éÕÏ‘Ñé±¥¡”Q¥±Õ¹œ…¸!½¥ÍÐ¥¹…¹”€¡Q…É½‰…¹¬¤¸Y•É•¥¹‰…ÉÑ”5½¹…ÑÍÉ…Ñ•¸‰±•¥‰•¸Õ¹Ù•Ë‘¹‘•ÉÐ¸œ¤¤ì(€€€¥˜€¡µ½¹Ñ¡-•ä€ôôôÍ¹½Ý‰…±±½¹™¥œ¹µ½¹Ñ¡±åQ…É•ÑMÑ…ÉÑ5½¹Ñ ¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”¥¹™¼œ°€9•ÕÍÑ…ÉÐ‘•ÌM¡Õ±‘•¹Á±…¹Ìè•Á±…¹Ñ”°…‰•È¹¥¡ÐÝ¥É­±¥ éÕËñ­•±•Ñ”	•ÑË‘”…ÕÌM•ÁÑ•µ‰•ÈÝ•É‘•¸¹¥¡Ðƒñ‰•É¹½µµ•¸¸ˆ=­Ñ½‰•Èë‘¡±Ð•¥¹”M¡Õ±‘•¸µKñ­±…”•ÉÍÐ¹… ‘•¥¹•È	•ÍÓ‘Ñ¥Õ¹œƒŠyiÕËñ­•±•ÓŠp¸œ¤¤ì(€€€ô(€€€½¹ÍÐ‘•‰ÑM…Ù¥¹Í•Á½Í¥Ð€ôÉ½Õ¹‘5½¹•ä¡9Õµ‰•È¡É½Ü¹‘•‰ÑM…Ù¥¹Í•Á½Í¥Ðñð€À¤¤ì(€€€½¹ÍÐÉ•µ…¥¹¥¹Q¡¥Í5½¹Ñ €ôÉ½Õ¹‘5½¹•ä¡5…Ñ ¹µ…à À°9Õµ‰•È¡É½Ü¹µ½¹Ñ¡±åQ…É•ÐñðÉ½Ü¹Á½½°ñð€À¤€´9Õµ‰•È¡É½Ü¹…±É•…‘åA…¥ñð€À¤¤¤ì(€€€½¹ÍÐµ½¹Ñ¡±å5•ÑÉ¥Ì€ôl(€€€€€ì±…‰•°è€5½¹…ÑÍé¥•°œ°Ù…±Õ”è•ÕÉ¼¡É½Ü¹µ½¹Ñ¡±åQ…É•ÐñðÉ½Ü¹Á½½°ñð€À¤°­¥¹è€ÍÕ•ÍÌœô°(€€€€€ì±…‰•°è€	•É•¥ÑÌ‰•é…¡±Ðœ°Ù…±Õ”è•ÕÉ¼¡É½Ü¹…±É•…‘åA…¥ñð€À¤°­¥¹è9Õµ‰•È¡É½Ü¹…±É•…‘åA…¥ñð€À¤€ø€À€ü€ÍÕ•ÍÌœ€è€œœô°(€€€€€ì±…‰•°è€9½ ½™™•¸œ°Ù…±Õ”è•ÕÉ¼¡É•µ…¥¹¥¹Q¡¥Í5½¹Ñ ¤°­¥¹èÉ•µ…¥¹¥¹Q¡¥Í5½¹Ñ €ø€À¸ÀÀÔ€ü€Ý…É¹¥¹œœ€è€ÍÕ•ÍÌœô(€€€tì(€€€¥˜€¡µ½¹Ñ¡-•ä€øôÍ¹½Ý‰…±±½¹™¥œ¹¥¹½µ•1¥¹­•‘áÑÉ…MÑ…ÉÑ5½¹Ñ €˜˜9Õµ‰•È¡É½Ü¹µ½¹Ñ¡±åQ…É•Ðñð€À¤€ø€À¤ì(€€€€€µ½¹Ñ¡±å5•ÑÉ¥Ì¹ÍÁ±¥” Ä°€À°ì(€€€€€€€±…‰•°è€iÕÍ…Ñè…ÕÌ	•¹¹åÌ¥¹­½µµ•¸œ°(€€€€€€€Ù…±Õ”è•ÕÉ¼¡É½Ü¹¥¹½µ•1¥¹­•‘áÑÉ„ñð€À¤°(€€€€€€€¡¥¹Ðè9ÕÈ‘•ÈQ•¥°ƒñ‰•È€‘í•ÕÉ¼¡Í¹½Ý‰…±±½¹™¥œ¹¥¹½µ•1¥¹­•‘áÑÉ…Q¡É•Í¡½±¥ôìéÕÏ‘Ñé±¥ éÕ´€àÀÀ·Š
°µÉÕ¹‘Á½½°¹€(€€€€€ô¤ì(€€€ô(€€€¥˜€¡‘•‰ÑM…Ù¥¹Í•Á½Í¥Ð€ø€À¸ÀÀÔ¤ì(€€€€€µ½¹Ñ¡±å5•ÑÉ¥Ì¹ÁÕÍ ¡ì±…‰•°è€…Ù½¸éÕËñ­±••¸œ°Ù…±Õ”è•ÕÉ¼¡‘•‰ÑM…Ù¥¹Í•Á½Í¥Ð¤°­¥¹è€Ý…É¹¥¹œœ°¡¥¹Ðè€	±•¥‰Ð›ñÈM¡Õ±‘•¸•‰Õ¹‘•¸¸œô¤ì(€€€ô(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡µ½¹Ñ¡±å5•ÑÉ¥Ì¤¤ì((€€€½¹ÍÐÉ½ÕÁ•€ô¹•Ü5…À ¤ì(€€€€¡É½Ü¹Á…åµ•¹ÑÌñðmt¤¹™½É…  ¡Á…åµ•¹Ð¤€ôøì(€€€€€½¹ÍÐ¹…µ”€ôÁ…åµ•¹Ð¹‘•‰Ðñð€M¡Õ±œì(€€€€€½¹ÍÐ‘•‰Ð€ô€¡ÍÑ…Ñ”¹‘•‰ÑÌñðmt¤¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä€˜˜•¹ÑÉä¹¹…µ”€ôôô¹…µ”¤ñð¹Õ±°ì(€€€€€½¹ÍÐ­•ä€ô‘•‰Ð€˜˜‘•‰Ð¹¥€ü‘•‰Ð¹¥€è¹…µ”ì(€€€€€¥˜€ …É½ÕÁ•¹¡…Ì¡­•ä¤¤É½ÕÁ•¹Í•Ð¡­•ä°ì‘•‰Ð°¹…µ”°É…Ñ”è€À°•áÑÉ„è€À°™Õ±±A…å½™˜è€À°¹½Ñ•Ìèmtô¤ì(€€€€€½¹ÍÐ¥Ñ•´€ôÉ½ÕÁ•¹•Ð¡­•ä¤ì(€€€€€¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€É…Ñ”œ¤¥Ñ•´¹É…Ñ”€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤ì(€€€€€¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€Í¹½Ý‰…±°œñðÁ…åµ•¹Ð¹ÑåÁ”€ôôô€‰Õ‘•Ñ}•áÑÉ„œ¤¥Ñ•´¹•áÑÉ„€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤ì(€€€€€¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€™Õ±±}Á…å½™˜œ¤ì(€€€€€€€¥Ñ•´¹™Õ±±A…å½™˜€ô9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤ì(€€€€€€€¥Ñ•´¹É…Ñ”€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹É…Ñ•µ½Õ¹Ðñð€À¤ì(€€€€€€€¥Ñ•´¹•áÑÉ„€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹Í¹½Ý‰…±±µ½Õ¹Ðñð€À¤ì(€€€€€ô(€€€€€¥˜€¡Á…åµ•¹Ð¹¹½Ñ”¤¥Ñ•´¹¹½Ñ•Ì¹ÁÕÍ ¡Á…åµ•¹Ð¹¹½Ñ”¤ì(€€€ô¤ì((€€€€¡ÍÑ…Ñ”¹‘•‰ÑÌñðmt¤¹™½É…  ¡‘•‰Ð¤€ôøì(€€€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡‘•‰Ð¤ì(€€€€€¥˜€¡‘•‰Ð¹Á…åµ•¹ÑQåÁ”€„ôô€½¹•}Ñ¥µ”œñð9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ðô€Àñð‘•‰Ð¹¹•áÑÕ•5½¹Ñ €„ôôµ½¹Ñ¡-•ä¤É•ÑÕÉ¸ì(€€€€€¥˜€¡ÉÉ…ä¹™É½´¡É½ÕÁ•¹Ù…±Õ•Ì ¤¤¹Í½µ” ¡¥Ñ•´¤€ôø¥Ñ•´¹‘•‰Ð€˜˜¥Ñ•´¹‘•‰Ð¹¥€ôôô‘•‰Ð¹¥¤¤É•ÑÕÉ¸ì(€€€€€É½ÕÁ•¹Í•Ð¡‘•‰Ð¹¥°ì‘•‰Ð°¹…µ”è‘•‰Ð¹¹…µ”ñð€¥¹µ…±é…¡±Õ¹œœ°É…Ñ”è9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤°•áÑÉ„è€À°™Õ±±A…å½™˜è€À°¹½Ñ•Ìèl•¥¹µ…±¥œ›‘±±¥œtô¤ì(€€€ô¤ì((€€€½¹ÍÐ±¥ÍÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€±¥ÍÐ¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•Üµ±¥ÍÐœì(€€€ÉÉ…ä¹™É½´¡É½ÕÁ•¹Ù…±Õ•Ì ¤¤¹™½É…  ¡¥Ñ•´¤€ôøì(€€€€€¥˜€ …¥Ñ•´¹‘•‰Ð¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐÑ½Ñ…°€ôÉ½Õ¹‘5½¹•ä¡¥Ñ•´¹™Õ±±A…å½™˜€ø€À€ü¥Ñ•´¹™Õ±±A…å½™˜€è¥Ñ•´¹É…Ñ”€¬¥Ñ•´¹•áÑÉ„¤ì(€€€€€¥˜€ „¡Ñ½Ñ…°€ø€À¤¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ…Ñ¥½¹QåÁ”€ô¥Ñ•´¹™Õ±±A…å½™˜€ø€À€ü€™Õ±±}Á…å½™˜œ€è€¡¥Ñ•´¹•áÑÉ„€ø€À€ü€Á±…¹¹•‘}Á…åµ•¹Ðœ€è€É•Õ±…É}Á…åµ•¹Ðœ¤ì(€€€€€½¹ÍÐ…Ñ¥½¹-•ä€ô•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹-•ä¡µ½¹Ñ¡-•ä°¥Ñ•´¹‘•‰Ð¹¥°…Ñ¥½¹QåÁ”°Ñ½Ñ…°¤ì(€€€€€½¹ÍÐÍÑ…ÑÕÌ€ô•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä¤ì(€€€€€½¹ÍÐ…Ñ¥½¹I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€…Ñ¥½¹I½Ü¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•ÜµÉ½Üœì(€€€€€½¹ÍÐ¥¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€¥¹™¼¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•Üµ½Áäœì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°€‘í¥Ñ•´¹¹…µ•ôƒ
Ü€‘í•ÕÉ¼¡Ñ½Ñ…°¥õ€¤¤ì(€€€€€½¹ÍÐÁ…ÉÑÌ€ômtì(€€€€€¥˜€¡¥Ñ•´¹™Õ±±A…å½™˜€ø€À¤Á…ÉÑÌ¹ÁÕÍ  Ù½±±ÍÓ‘¹‘¥”•Í…µÑé…¡±Õ¹œœ¤ì(€€€€€•±Í”ì(€€€€€€€¥˜€¡¥Ñ•´¹É…Ñ”€ø€À¤Á…ÉÑÌ¹ÁÕÍ ¡I…Ñ”€‘í•ÕÉ¼¡¥Ñ•´¹É…Ñ”¥õ€¤ì(€€€€€€€¥˜€¡¥Ñ•´¹•áÑÉ„€ø€À¤Á…ÉÑÌ¹ÁÕÍ ¡éÕÏ‘Ñé±¥ €‘í•ÕÉ¼¡¥Ñ•´¹•áÑÉ„¥õ€¤ì(€€€€€ô(€€€€€¥˜€¡¥Í•‰ÑI…Ñ•A•¹‘¥¹½É5½¹Ñ ¡¥Ñ•´¹‘•‰Ð°µ½¹Ñ¡-•ä¤¤Á…ÉÑÌ¹ÁÕÍ  ‰•…¹ÑÉ…ÐƒŠL¹½ ¹¥¡Ð‰•Ý¥±±¥Ðœ¤ì(€€€€€¥˜€¡¥Ñ•´¹¹½Ñ•Ì¹±•¹Ñ ¤Á…ÉÑÌ¹ÁÕÍ ¡¥Ñ•´¹¹½Ñ•ÍlÁt¤ì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°Á…ÉÑÌ¹©½¥¸ œƒ
Ü€œ¤¤¤ì((€€€€€½¹ÍÐ…Ñ¥½¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€…Ñ¥½¹Ì¹±…ÍÍ9…µ”€ô€É½Üœì(€€€€€¥˜€¡ÍÑ…ÑÕÌ€ôôô€±…Ñ•Èœ¤…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°€Á¥±°Ý…É¹¥¹œœ°€›ñÈÍÃ‘Ñ•Èµ…É­¥•ÉÐœ¤¤ì(€€€€€½¹ÍÐ±…Ñ•É	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€±…Ñ•É	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€±…Ñ•É	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€€€±…Ñ•É	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ôÍÑ…ÑÕÌ€ôôô€±…Ñ•Èœ€ü€]¥•‘•È•¥¹Á±…¹•¸œ€è€MÃ‘Ñ•Èœì(€€€€€±…Ñ•É	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€Í•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä°ÍÑ…ÑÕÌ€ôôô€±…Ñ•Èœ€ü€œœ€è€±…Ñ•Èœ¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€½¹ÍÐÁ…¥‘	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€Á…¥‘	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€Á…¥‘	Ñ¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€€€Á…¥‘	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô¥Ñ•´¹™Õ±±A…å½™˜€ø€À€ü€•Í…µÑé…¡±Õ¹œ•¥¹ÑÉ…•¸œ€è€	•é…¡±Ð•¥¹ÑÉ…•¸œì(€€€€€Á…¥‘	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€¥˜€¡¥Ñ•´¹™Õ±±A…å½™˜€ø€À¤ì(€€€€€€€€€Í¡½Ý•‰ÑA…åµ•¹Ñ‘¥Ñ½È¡¥Ñ•´¹‘•‰Ð°ì(€€€€€€€€€€€µ½¹Ñ èµ½¹Ñ¡-•ä°(€€€€€€€€€€€…µ½Õ¹ÐèÑ½Ñ…°°(€€€€€€€€€€€µ½‘”è€•áÑÉ„œ°(€€€€€€€€€€€¹½Ñ”è€•Í…µÑé…¡±Õ¹œ…ÕÌ‘•´M¡Õ±‘•¸µ5½¹…ÑÍ…ÍÍ¥ÍÑ•¹Ñ•¸œ°(€€€€€€€€€€€‘•‰ÑI•Í•ÉÙ•]¥Ñ¡‘É…Ý…±µ½Õ¹Ðè¥Ñ•´¹‘•‰Ð¹¥€ôôôÉ½Ü¹•¹•É…±•‰ÑM…Ù¥¹Í]¥Ñ¡‘É…Ý…±•‰Ñ%(€€€€€€€€€€€€€€ü9Õµ‰•È¡É½Ü¹•¹•É…±•‰ÑM…Ù¥¹Í]¥Ñ¡‘É…Ý…°ñð€À¤(€€€€€€€€€€€€€€è€À°(€€€€€€€€€€€‘•‰ÑI•Í•ÉÙ•]¥Ñ¡‘É…Ý…±Ñ¥½¹-•äè€‘í…Ñ¥½¹-•åõñÉ•Í•ÉÙ”µÝ¥Ñ¡‘É…Ý…±€°(€€€€€€€€€€€‘•‰ÑI•Í•ÉÙ•I•µ…¥¹‘•Éµ½Õ¹ÐèÉ½Ü¹Á…å½™™I•Í•ÉÙ”€˜˜É½Ü¹Á…å½™™I•Í•ÉÙ”¹Ñ…É•Ñ•‰Ð€ôôô¥Ñ•´¹¹…µ”(€€€€€€€€€€€€€€ü9Õµ‰•È¡É½Ü¹Á…å½™™I•Í•ÉÙ”¹±•™Ñ½Ù•É™Ñ•ÉA…å½™˜ñð€À¤(€€€€€€€€€€€€€€è€À°(€€€€€€€€€€€‘•‰ÑI•Í•ÉÙ•I•µ…¥¹‘•ÉÑ¥½¹-•äè€‘í…Ñ¥½¹-•åõñÉ•Í•ÉÙ”µÉ•µ…¥¹‘•É€°(€€€€€€€€€€€Á…åµ•¹Ñ5•Ñ¡½è¥Ñ•´¹‘•‰Ð¹Á…åµ•¹Ñ5•Ñ¡½ñð€œœ°(€€€€€€€€€€€…™Ñ•ÉM…Ù”è€ ¤€ôøÍ•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä°€‘½¹”œ¤(€€€€€€€€€ô¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€½¹ÍÐµ½¹Ñ¡±å±É•…‘åA…¥€ô€¡¥Ñ•´¹‘•‰Ð¹Á…¥‘5½¹Ñ¡Ìñðmt¤¹¥¹±Õ‘•Ì¡µ½¹Ñ¡-•ä¤(€€€€€€€€€ñð€¡¥Ñ•´¹‘•‰Ð¹Á…åµ•¹Ñ!¥ÍÑ½Éäñðmt¤¹Í½µ” ¡•¹ÑÉä¤€ôø•¹ÑÉä¹µ½¹Ñ €ôôôµ½¹Ñ¡-•ä€˜˜•¹ÑÉä¹µ…É­•‘Í5½¹Ñ¡±ä¤ì(€€€€€€€½¹ÍÐµ…É­Í5½¹Ñ¡±ä€ô¥Ñ•´¹É…Ñ”€ø€À€˜˜€…µ½¹Ñ¡±å±É•…‘åA…¥ì(€€€€€€€Í¡½Ý•‰ÑA…åµ•¹Ñ‘¥Ñ½È¡¥Ñ•´¹‘•‰Ð°ì(€€€€€€€€€µ½¹Ñ èµ½¹Ñ¡-•ä°(€€€€€€€€€…µ½Õ¹ÐèÑ½Ñ…°°(€€€€€€€€€µ½‘”èµ…É­Í5½¹Ñ¡±ä€ü€É•Õ±…Èœ€è€•áÑÉ„œ°(€€€€€€€€€¹½Ñ”è¥Ñ•´¹•áÑÉ„€ø€À€üI…Ñ”€‘í•ÕÉ¼¡¥Ñ•´¹É…Ñ”¥ôƒ
ÜéÕÏ‘Ñé±¥ €‘í•ÕÉ¼¡¥Ñ•´¹•áÑÉ„¥õ€€è€Y•É•¥¹‰…ÉÑ”5½¹…ÑÍé…¡±Õ¹œœ°(€€€€€€€€€Í½ÕÉ”è€M¡Õ±‘•¸µ5½¹…ÑÍ…ÍÍ¥ÍÑ•¹Ðœ°(€€€€€€€€€Á…åµ•¹Ñ5•Ñ¡½è¥Ñ•´¹‘•‰Ð¹Á…åµ•¹Ñ5•Ñ¡½ñð€œœ°(€€€€€€€€€…±±½ÝU¹É•ÍÑÉ¥Ñ•‘A…åµ•¹ÐèÑÉÕ”°(€€€€€€€€€…™Ñ•ÉM…Ù”è€ ¤€ôøÍ•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä°€‘½¹”œ¤(€€€€€€€ô¤ì(€€€€€ô¤ì(€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡±…Ñ•É	Ñ¸¤ì(€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡Á…¥‘	Ñ¸¤ì(€€€€€…Ñ¥½¹I½Ü¹…ÁÁ•¹‘¡¥±¡¥¹™¼¤ì(€€€€€…Ñ¥½¹I½Ü¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹Ì¤ì(€€€€€±¥ÍÐ¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹I½Ü¤ì(€€€ô¤ì((€€€¥˜€¡É½Ü¹Á…å½™™I•Í•ÉÙ”€˜˜€…É½Ü¹Á…å½™™I•Í•ÉÙ”¹…¹A…å½™˜€˜˜9Õµ‰•È¡É½Ü¹Á…å½™™I•Í•ÉÙ”¹É•Í•ÉÙ•‘‘•ñð€À¤€ø€À¤ì(€€€€€½¹ÍÐÉ•Í•ÉÙ”€ôÉ½Ü¹Á…å½™™I•Í•ÉÙ”ì(€€€€€½¹ÍÐÑ…É•Ñ•‰Ð€ô€¡ÍÑ…Ñ”¹‘•‰ÑÌñðmt¤¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä€˜˜•¹ÑÉä¹¹…µ”€ôôôÉ•Í•ÉÙ”¹Ñ…É•Ñ•‰Ð¤ñð¹Õ±°ì(€€€€€½¹ÍÐÉ•Í•ÉÙ•µ½Õ¹Ð€ôÉ½Õ¹‘5½¹•ä¡9Õµ‰•È¡É•Í•ÉÙ”¹É•Í•ÉÙ•‘‘•ñð€À¤¤ì(€€€€€½¹ÍÐ…Ñ¥½¹-•ä€ô•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹-•ä¡µ½¹Ñ¡-•ä°Ñ…É•Ñ•‰Ð€˜˜Ñ…É•Ñ•‰Ð¹¥°€É•Í•ÉÙ”œ°É•Í•ÉÙ•µ½Õ¹Ð¤ì(€€€€€½¹ÍÐÍÑ…ÑÕÌ€ô•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä¤ì(€€€€€½¹ÍÐ…Ñ¥½¹I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€…Ñ¥½¹I½Ü¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•ÜµÉ½Üœì(€€€€€½¹ÍÐ¥¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€¥¹™¼¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•Üµ½Áäœì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°€‘í•ÕÉ¼¡É•Í•ÉÙ•µ½Õ¹Ð¥ô…Õ™ÌQ…•Í•±ƒ
Ü›ñÈ€‘íÉ•Í•ÉÙ”¹Ñ…É•Ñ•‰Ñõ€¤¤ì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°€‘íÉ•Í•ÉÙ”¹Í½ÕÉ••‰Ðñð€É•¤•Ý½É‘•¹”I…Ñ”ô‰±•¥‰Ð›ñÈ‘¥”ÍÃ‘Ñ•É”•Í…µÑé…¡±Õ¹œ•‰Õ¹‘•¸ƒ
Ü‘…¹… éÕËñ­•±•Ð€‘í•ÕÉ¼¡É•Í•ÉÙ”¹É•Í•ÉÙ•	…±…¹”ñð€À¥õ€¤¤ì(€€€€€½¹ÍÐ…Ñ¥½¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€…Ñ¥½¹Ì¹±…ÍÍ9…µ”€ô€É½Üœì(€€€€€¥˜€¡ÍÑ…ÑÕÌ¤…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°ÍÑ…ÑÕÌ€ôôô€‘½¹”œ€ü€Á¥±°ÍÕ•ÍÌœ€è€Á¥±°Ý…É¹¥¹œœ°ÍÑ…ÑÕÌ€ôôô€‘½¹”œ€ü€éÕËñ­•±•Ðœ€è€›ñÈÍÃ‘Ñ•Èµ…É­¥•ÉÐœ¤¤ì(€€€€€½¹ÍÐ‘½¹•	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€‘½¹•	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€‘½¹•	Ñ¸¹±…ÍÍ9…µ”€ôÍÑ…ÑÕÌ€ôôô€‘½¹”œ€ü€Í•½¹‘…Éäœ€è€ÍÕ•ÍÌœì(€€€€€‘½¹•	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ôÍÑ…ÑÕÌ€ôôô€‘½¹”œ€ü€]¥•‘•ÈƒÙ™™¹•¸œ€è€iÕËñ­•±•Ðœì(€€€€€‘½¹•	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€Í•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä°ÍÑ…ÑÕÌ€ôôô€‘½¹”œ€ü€œœ€è€‘½¹”œ¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€½¹ÍÐ±…Ñ•É	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€±…Ñ•É	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€±…Ñ•É	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€€€±…Ñ•É	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ôÍÑ…ÑÕÌ€ôôô€±…Ñ•Èœ€ü€]¥•‘•È•¥¹Á±…¹•¸œ€è€MÃ‘Ñ•Èœì(€€€€€±…Ñ•É	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€Í•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä°ÍÑ…ÑÕÌ€ôôô€±…Ñ•Èœ€ü€œœ€è€±…Ñ•Èœ¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡±…Ñ•É	Ñ¸¤ì(€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡‘½¹•	Ñ¸¤ì(€€€€€…Ñ¥½¹I½Ü¹…ÁÁ•¹‘¡¥±¡¥¹™¼¤ì(€€€€€…Ñ¥½¹I½Ü¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹Ì¤ì(€€€€€±¥ÍÐ¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹I½Ü¤ì(€€€ô((€€€¥˜€¡9Õµ‰•È¡É½Ü¹Õ¹…±±½…Ñ•‘	Õ‘•Ðñð€À¤€ø€À¸ÀÀÔ¤ì(€€€€€½¹ÍÐÉ•Í•ÉÙ•µ½Õ¹Ð€ôÉ½Õ¹‘5½¹•ä¡9Õµ‰•È¡É½Ü¹Õ¹…±±½…Ñ•‘	Õ‘•Ðñð€À¤¤ì(€€€€€½¹ÍÐ…Ñ¥½¹-•ä€ô•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹-•ä¡µ½¹Ñ¡-•ä°€‘•‰Ðµ‘…äµµ½¹•äœ°€‘•‰Ñ}É•Í•ÉÙ”œ°É•Í•ÉÙ•µ½Õ¹Ð¤ì(€€€€€½¹ÍÐÍÑ…ÑÕÌ€ô•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä¤ì(€€€€€½¹ÍÐ…Ñ¥½¹I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€…Ñ¥½¹I½Ü¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•ÜµÉ½Üœì(€€€€€½¹ÍÐ¥¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€¥¹™¼¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•Üµ½Áäœì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°€‘í•ÕÉ¼¡É•Í•ÉÙ•µ½Õ¹Ð¥ô…±ÌM¡Õ±‘•¸µKñ­±…”…Õ™ÌQ…•Í•±‘€¤¤ì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°€•È	•ÑÉ…œ¥ÍÐ¹¥¡Ð™É•¤Ù•É›ñ‰…ÈÕ¹‰±•¥‰Ð›ñÈ•¥¹”ÍÃ‘Ñ•É”Í¥¹¹Ù½±±”M¡Õ±‘•¹Ñ¥±Õ¹œÙ½É•µ•É­Ð¸œ¤¤ì(€€€€€½¹ÍÐ…Ñ¥½¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€…Ñ¥½¹Ì¹±…ÍÍ9…µ”€ô€É½Üœì(€€€€€¥˜€¡ÍÑ…ÑÕÌ¤…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°ÍÑ…ÑÕÌ€ôôô€‘½¹”œ€ü€Á¥±°ÍÕ•ÍÌœ€è€Á¥±°Ý…É¹¥¹œœ°ÍÑ…ÑÕÌ€ôôô€‘½¹”œ€ü€éÕËñ­•±•Ðœ€è€›ñÈÍÃ‘Ñ•Èµ…É­¥•ÉÐœ¤¤ì(€€€€€½¹ÍÐ±…Ñ•É	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€±…Ñ•É	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€±…Ñ•É	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€€€±…Ñ•É	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ôÍÑ…ÑÕÌ€ôôô€±…Ñ•Èœ€ü€]¥•‘•È•¥¹Á±…¹•¸œ€è€MÃ‘Ñ•Èœì(€€€€€±…Ñ•É	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€½¹ÍÐ¹•áÑMÑ…ÑÕÌ€ôÍÑ…ÑÕÌ€ôôô€±…Ñ•Èœ€ü€œœ€è€±…Ñ•Èœì(€€€€€€€Í•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä°¹•áÑMÑ…ÑÕÌ¤ì(€€€€€€€Í•ÑI•½É‘•‘•‰ÑM…Ù¥¹Í•Á½Í¥Ð¡…Ñ¥½¹-•ä°µ½¹Ñ¡-•ä°É•Í•ÉÙ•µ½Õ¹Ð°™…±Í”¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€½¹ÍÐ‘½¹•	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€‘½¹•	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€‘½¹•	Ñ¸¹±…ÍÍ9…µ”€ôÍÑ…ÑÕÌ€ôôô€‘½¹”œ€ü€Í•½¹‘…Éäœ€è€ÍÕ•ÍÌœì(€€€€€‘½¹•	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ôÍÑ…ÑÕÌ€ôôô€‘½¹”œ€ü€]¥•‘•ÈƒÙ™™¹•¸œ€è€iÕËñ­•±•Ðœì(€€€€€‘½¹•	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€½¹ÍÐ¹•áÑMÑ…ÑÕÌ€ôÍÑ…ÑÕÌ€ôôô€‘½¹”œ€ü€œœ€è€‘½¹”œì(€€€€€€€Í•Ñ•‰ÑÍÍ¥ÍÑ…¹ÑÑ¥½¹MÑ…ÑÕÌ¡…Ñ¥½¹-•ä°¹•áÑMÑ…ÑÕÌ¤ì(€€€€€€€Í•ÑI•½É‘•‘•‰ÑM…Ù¥¹Í•Á½Í¥Ð¡…Ñ¥½¹-•ä°µ½¹Ñ¡-•ä°É•Í•ÉÙ•µ½Õ¹Ð°¹•áÑMÑ…ÑÕÌ€ôôô€‘½¹”œ¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡±…Ñ•É	Ñ¸¤ì(€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡‘½¹•	Ñ¸¤ì(€€€€€…Ñ¥½¹I½Ü¹…ÁÁ•¹‘¡¥±¡¥¹™¼¤ì(€€€€€…Ñ¥½¹I½Ü¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹Ì¤ì(€€€€€±¥ÍÐ¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹I½Ü¤ì(€€€ô((€€€¥˜€ …±¥ÍÐ¹¡¥±‘É•¸¹±•¹Ñ ¤±¥ÍÐ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”ÍÕ•ÍÌœ°€ñÈ‘¥•Í•¸5½¹…Ð¥ÍÐ­•¥¹”Ý•¥Ñ•É”M¡Õ±‘•¹é…¡±Õ¹œ½™™•¸¸œ¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡±¥ÍÐ¤ì(€€€¥˜€¡9Õµ‰•È¡É½Ü¹‘•‰ÑM…Ù¥¹Í]¥Ñ¡‘É…Ý…°ñð€À¤€ø€À¸ÀÀÔ¤…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”ÍÕ•ÍÌœ°€‘í•ÕÉ¼¡É½Ü¹‘•‰ÑM…Ù¥¹Í]¥Ñ¡‘É…Ý…°¥ô…ÕÌ‘•È‰¥Í¡•É¥•¸M¡Õ±‘•¸µKñ­±…”Ý•É‘•¸‘¥•Í•¸5½¹…ÐÝ¥•‘•È›ñÈ•¥¹”M¡Õ±•¥¹•Í•ÑéÐ¹€¤¤ì(€€€É•ÑÕÉ¸…Éì(€ô((€™Õ¹Ñ¥½¸•Ñ•‰Ñ±…É¥™¥…Ñ¥½¹%Ñ•µÌ¡µ½¹Ñ¡-•ä°Á±…¸€ô¹Õ±°¤ì(€€€½¹ÍÐ¥Ñ•µÌ€ômtì(€€€½¹ÍÐ…Ñ¥Ù••‰ÑÌ€ô€¡ÍÑ…Ñ”¹‘•‰ÑÌñðmt¤¹™¥±Ñ•È ¡‘•‰Ð¤€ôø9Õµ‰•È¡‘•‰Ð€˜˜‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ø€À¤ì(€€€…Ñ¥Ù••‰ÑÌ¹™½É…  ¡‘•‰Ð¤€ôøì(€€€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡‘•‰Ð¤ì(€€€€€½¹ÍÐµ½‘”€ô¥¹™•É•‰ÑA…åµ•¹ÑIÕ±•5½‘”¡‘•‰Ð¤ì(€€€€€¥˜€¡µ½‘”€ôôô€Á…åµ•¹Ñ}¥¹™½}µ¥ÍÍ¥¹œœ¤ì(€€€€€€€¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€€€€€€€­•äèÁ…åµ•¹Ðµ¥¹™¼´‘í‘•‰Ð¹¥‘õ€°(€€€€€€€€€Ñ¥Ñ±”è€‘í‘•‰Ð¹¹…µ•ôèi…¡±Õ¹ÍÝ•œ™•¡±Ñ€°(€€€€€€€€€‘•Ñ…¥°è€	¥Ì‘Ô‘•¸i…¡±Õ¹ÍÝ•œ­•¹¹ÍÐÕ¹‘¥”I••°ƒ‘¹‘•ÉÍÐ°‰±•¥‰Ð‘¥•Í”M¡Õ±…ÕÑ½µ…Ñ¥Í …ÕÌ…±±•¸iÕÍ…ÑéÙ½ÉÍ¡³‘•¸¡•É…ÕÌ¸œ°(€€€€€€€€€…Ñ¥½¹1…‰•°è€i…¡±Õ¹ÍÉ••°‰•…É‰•¥Ñ•¸œ°(€€€€€€€€€…Ñ¥½¸è€ ¤€ôøÍ¡½Ý•‰Ñ‘¥Ñ½È¡‘•‰Ð¤(€€€€€€€ô¤ì(€€€€€ô(€€€€€¥˜€¡‘•‰Ð¹Á…åµ•¹ÑQåÁ”€ôôô€½Á•¹}Á±…¸œñð€¡‘•‰Ð¹Á…åµ•¹ÑQåÁ”€ôôô€¥¹ÍÑ…±±µ•¹Ðœ€˜˜€„¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°µ½¹Ñ¡-•ä¤€ø€À¤¤¤ì(€€€€€€€¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€€€€€€€­•äèÉ…Ñ”´‘í‘•‰Ð¹¥‘õ€°(€€€€€€€€€Ñ¥Ñ±”è€‘í‘•‰Ð¹¹…µ•ôè5½¹…ÑÍÉ…Ñ”™•¡±Ñ€°(€€€€€€€€€‘•Ñ…¥°è€=¡¹”Ù•É•¥¹‰…ÉÑ”I…Ñ”­…¹¸‘¥•Í”M¡Õ±¹¥¡ÐéÕÙ•É³‘ÍÍ¥œ¥¸‘•¸5½¹…ÑÍÁ±…¸…Õ™•¹½µµ•¸Ý•É‘•¸¸œ°(€€€€€€€€€…Ñ¥½¹1…‰•°è€M¡Õ±‰•…É‰•¥Ñ•¸œ°(€€€€€€€€€…Ñ¥½¸è€ ¤€ôøÍ¡½Ý•‰Ñ‘¥Ñ½È¡‘•‰Ð¤(€€€€€€€ô¤ì(€€€€€ô(€€€ô¤ì((€€€½¹ÍÐ…Ñ¥Ù•A±…¸€ôÁ±…¸ñð‰Õ¥±‘M¹½Ý‰…±±A±…¸¡µ½¹Ñ¡-•ä°€ÄÈÀ¤ì(€€€½¹ÍÐÉ½Ü€ô•Ñ•‰ÑA±…¹I½Ý½É5½¹Ñ ¡…Ñ¥Ù•A±…¸°µ½¹Ñ¡-•ä¤ì(€€€½¹ÍÐÁ…å½™™9…µ•Ì€ô¹•ÜM•Ð ¤ì(€€€€ ¡É½Ü€˜˜É½Ü¹Á…åµ•¹ÑÌ¤ñðmt¤¹™½É…  ¡Á…åµ•¹Ð¤€ôøì(€€€€€¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€™Õ±±}Á…å½™˜œ€˜˜Á…åµ•¹Ð¹‘•‰Ð¤Á…å½™™9…µ•Ì¹…‘¡Á…åµ•¹Ð¹‘•‰Ð¤ì(€€€ô¤ì(€€€¥˜€¡É½Ü€˜˜É½Ü¹Á…å½™™I•Í•ÉÙ”€˜˜É½Ü¹Á…å½™™I•Í•ÉÙ”¹…¹A…å½™˜€˜˜É½Ü¹Á…å½™™I•Í•ÉÙ”¹Ñ…É•Ñ•‰Ð¤Á…å½™™9…µ•Ì¹…‘¡É½Ü¹Á…å½™™I•Í•ÉÙ”¹Ñ…É•Ñ•‰Ð¤ì(€€€Á…å½™™9…µ•Ì¹™½É…  ¡¹…µ”¤€ôøì(€€€€€½¹ÍÐ‘•‰Ð€ô…Ñ¥Ù••‰ÑÌ¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹¹…µ”€ôôô¹…µ”¤ì(€€€€€¥˜€ …‘•‰Ð¤É•ÑÕÉ¸ì(€€€€€¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€€€€€­•äèÁ…å½™˜´‘í‘•‰Ð¹¥‘õ€°(€€€€€€€Ñ¥Ñ±”è€‘í¹…µ•ôè•Í…µÑ‰•ÑÉ…œÁËñ™•¹€°(€€€€€€€‘•Ñ…¥°è€Y½È‘•ÈÙ½É•Í¡±…•¹•¸•Í…µÑ…‰³ÙÍÕ¹œ‰¥ÑÑ”‘•¸Ñ…•Í…­ÑÕ•±±•¸‰³ÙÍ•‰•ÑÉ…œ‰•¥´¹‰¥•Ñ•È­½¹ÑÉ½±±¥•É•¸¸œ°(€€€€€€€…Ñ¥½¹1…‰•°è€•Í…µÑé…¡±Õ¹œÙ½É‰•É•¥Ñ•¸œ°(€€€€€€€…Ñ¥½¸è€ ¤€ôøÍ¡½Ý•‰ÑA…åµ•¹Ñ‘¥Ñ½È¡‘•‰Ð°ìµ½¹Ñ èµ½¹Ñ¡-•ä°…µ½Õ¹Ðè9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤°µ½‘”è€•áÑÉ„œ°¹½Ñ”è€•Í…µÑ…‰³ÙÍÕ¹œ¹… AËñ™Õ¹œ‰•¥´¹‰¥•Ñ•Èœô¤(€€€€€ô¤ì(€€€ô¤ì(€€€É•ÑÕÉ¸¥Ñ•µÌì(€ô((€™Õ¹Ñ¥½¸É•¹‘•É•‰Ñ±…É¥™¥…Ñ¥½¹…É¡µ½¹Ñ¡-•ä°Á±…¸€ô¹Õ±°¤ì(€€€½¹ÍÐ¥Ñ•µÌ€ô•Ñ•‰Ñ±…É¥™¥…Ñ¥½¹%Ñ•µÌ¡µ½¹Ñ¡-•ä°Á±…¸¤ì(€€€¥˜€ …¥Ñ•µÌ¹±•¹Ñ ¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÕÉ•¹Ñ%Ñ•µÌ€ô¥Ñ•µÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹­•ä¹ÍÑ…ÉÑÍ]¥Ñ  Á…åµ•¹Ðµ¥¹™¼´œ¤ñð¥Ñ•´¹­•ä¹ÍÑ…ÉÑÍ]¥Ñ  É…Ñ”´œ¤¤ì(€€€½¹ÍÐ‘•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€‘•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€‘•‰Ðµ±…É¥™¥…Ñ¥½¸µ…Éœì(€€€½¹ÍÐ±¥ÍÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€±¥ÍÐ¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•Üµ±¥ÍÐœì(€€€¥Ñ•µÌ¹™½É…  ¡¥Ñ•´¤€ôøì(€€€€€½¹ÍÐÉ½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€É½Ü¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•ÜµÉ½Üœì(€€€€€½¹ÍÐ¥¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€¥¹™¼¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•Üµ½Áäœì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°¥Ñ•´¹Ñ¥Ñ±”¤¤ì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°¥Ñ•´¹‘•Ñ…¥°¤¤ì(€€€€€½¹ÍÐ‰ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€‰ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€‰ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€€€‰ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô¥Ñ•´¹…Ñ¥½¹1…‰•°ì(€€€€€‰ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°¥Ñ•´¹…Ñ¥½¸¤ì(€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡¥¹™¼¤ì(€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡‰ÕÑÑ½¸¤ì(€€€€€±¥ÍÐ¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì(€€€ô¤ì(€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥•Í”AÕ¹­Ñ”‰•ÑÉ•™™•¸‘•¸i…¡±Õ¹ÍÁ±…¸½‘•È•¥¹•¸·Ù±¥¡•¸iÕÍ…Ñé‰•ÑÉ…œ¸Y•É•¥¹‰…ÉÑ”I…Ñ•¸‰±•¥‰•¸•¥¹•Á±…¹Ð¸œ¤¤ì(€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡±¥ÍÐ¤ì(€€€É•ÑÕÉ¸É•…Ñ••‰Ñ•Ñ…¥±Ì¡i…¡±Õ¹ÍÁ±…¸­³‘É•¸ƒ
Ü€‘í¥Ñ•µÌ¹±•¹Ñ¡õ€°‘•Ñ…¥±Ì°ÕÉ•¹Ñ%Ñ•µÌ¹±•¹Ñ €ø€À¤ì(€ô(((€™Õ¹Ñ¥½¸É•¹‘•É•‰ÑÉ••½É•…ÍÑ…É¡Á±…¸°µ½¹Ñ¡-•ä¤ì(€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€ÍÕˆµ…É‘•‰Ðµ™É•”µ™½É•…ÍÐµ…Éœì(€€€½¹ÍÐ €ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Ìœ¤ì(€€€ ¹Ñ•áÑ½¹Ñ•¹Ð€ô€AÉ½¹½Í”‰•¤Ù½É•Í¡±…•¹•´i…¡±Õ¹ÍÁ±…¸œì(€€€…É¹…ÁÁ•¹‘¡¥±¡ ¤ì((€€€½¹ÍÐÉ½ÝÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡Á±…¸€˜˜Á±…¸¹É½ÝÌ¤€üÁ±…¸¹É½ÝÌ€èmtì(€€€½¹ÍÐ¹½ÑA±…¹¹•€ôÉÉ…ä¹¥ÍÉÉ…ä¡Á±…¸€˜˜Á±…¸¹¹½I…Ñ”¤€üÁ±…¸¹¹½I…Ñ”€èmtì(€€€½¹ÍÐÍ¡•‘Õ±•‘=¹•Q¥µ”€ôÉÉ…ä¹¥ÍÉÉ…ä¡Á±…¸€˜˜Á±…¸¹Í¡•‘Õ±•‘=¹•Q¥µ”¤€üÁ±…¸¹Í¡•‘Õ±•‘=¹•Q¥µ”€èmtì(€€€½¹ÍÐ‘•‰ÑÉ••5½¹Ñ €ôÁ±…¸€˜˜Á±…¸¹‘•‰ÑÉ••5½¹Ñ €üÁ±…¸¹‘•‰ÑÉ••5½¹Ñ €è€œœì(€€€½¹ÍÐ™¥ÉÍÑI½Ü€ôÉ½ÝÍlÁtñð¹Õ±°ì(€€€½¹ÍÐ™¥ÉÍÑ	Õ‘•ÑI½Ü€ôÉ½ÝÌ¹™¥¹ ¡É½Ü¤€ôø9Õµ‰•È¡É½Ü¹µ½¹Ñ¡±åQ…É•Ðñð€À¤€ø€À¤ñð¹Õ±°ì(€€€½¹ÍÐµ½¹Ñ¡ÍQ½•‰ÑÉ•”€ô‘•‰ÑÉ••5½¹Ñ €ü5…Ñ ¹µ…à À°µ½¹Ñ¡¥™˜¡µ½¹Ñ¡-•ä°‘•‰ÑÉ••5½¹Ñ ¤¤€¬€Ä€è¹Õ±°ì(€€€½¹ÍÐÑ½Ñ…±=Á•¸€ô€¡ÍÑ…Ñ”¹‘•‰ÑÌñðmt¤¹É•‘Õ” ¡ÍÕ´°‘•‰Ð¤€ôøÍÕ´€¬5…Ñ ¹µ…à À°9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤¤°€À¤ì((€€€½¹ÍÐ¡•É¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•É¼¹±…ÍÍ9…µ”€ô€‘•‰Ðµ™É•”µ™½É•…ÍÐµ¡•É¼œì(€€€½¹ÍÐµ…¥¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€µ…¥¸¹±…ÍÍ9…µ”€ô€‘•‰Ðµ™É•”µµ…¥¸œì(€€€½¹ÍÐ¡…ÍU¹Á±…¹¹•€ô¹½ÑA±…¹¹•¹±•¹Ñ €ø€Àì(€€€µ…¥¸¹¥¹¹•É!Q50€ô€ñÍÁ…¸ù¹¹…¡µ”ð½ÍÁ…¸øñÍÑÉ½¹œø‘í‘•‰ÑÉ••5½¹Ñ €ü™½Éµ…Ñ5½¹Ñ¡1…‰•°¡‘•‰ÑÉ••5½¹Ñ ¤€è€¹½ ¹¥¡Ð‰•É•¡•¹‰…Èôð½ÍÑÉ½¹œøñÍµ…±°ø‘í‘•‰ÑÉ••5½¹Ñ €ü€‘í¡…ÍU¹Á±…¹¹•€ü€•Á±…¹Ñ”I…Ñ•¹Í¡Õ±‘•¸œ€è€Í¡Õ±‘•¹™É•¤ô¹… „¸€‘íµ½¹Ñ¡ÍQ½•‰ÑÉ••ô5½¹…Ð¡•¸¤°Ý•¹¸…±±”Ù½É•Í¡±…•¹•¸i…¡±Õ¹•¸Í¼•±•¥ÍÑ•ÐÝ•É‘•¹€€è€¥”•Á±…¹Ñ•¸I…Ñ•¹Í¡Õ±‘•¸Í¥¹¹½ ¹¥¡Ð™•ÉÑ¥œ‰•É•¡¹•Ð¸=™™•¹”A³‘¹”Ý•É‘•¸¹ÕÈ…±Ì!¥¹Ý•¥Ì•›ñ¡ÉÐ¸ôð½Íµ…±°ù€ì(€€€¡•É¼¹…ÁÁ•¹‘¡¥±¡µ…¥¸¤ì((€€€½¹ÍÐ™…ÑÌ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€™…ÑÌ¹±…ÍÍ9…µ”€ô€‘•‰Ðµ™É•”µ™…ÑÌœì(€€€l(€€€€€l=™™•¸…­ÑÕ•±°œ°•ÕÉ¼¡Ñ½Ñ…±=Á•¸¥t°(€€€€€lM¡Õ±‘•¸µA½½°…­ÑÕ•±±•È5½¹…Ðœ°™¥ÉÍÑI½Ü€ü•ÕÉ¼¡™¥ÉÍÑI½Ü¹Á½½°ñð™¥ÉÍÑI½Ü¹Ñ½Ñ…°ñð€À¤€è€œÀ°ÀÀƒŠ
°t°(€€€€€lM¡Õ±‘•¹‰Õ‘•Ð¥´•ÉÍÑ•¸i¥•±µ½¹…Ðœ°™¥ÉÍÑ	Õ‘•ÑI½Ü€ü•ÕÉ¼¡™¥ÉÍÑ	Õ‘•ÑI½Ü¹µ½¹Ñ¡±åQ…É•Ðñð€À¤€è•ÕÉ¼¡Í¹½Ý‰…±±½¹™¥œ¹µ½¹Ñ¡±åQ…É•Ð¥t°(€€€€€l…Ù½¸¥¹­½µµ•¹ÍéÕÍ…Ñèœ°™¥ÉÍÑ	Õ‘•ÑI½Ü€ü•ÕÉ¼¡™¥ÉÍÑ	Õ‘•ÑI½Ü¹¥¹½µ•1¥¹­•‘áÑÉ„ñð€À¤€è€œÀ°ÀÀƒŠ
°t°(€€€€€l9½ •Á±…¹Ñ”MÑ…¹‘…É‘É…Ñ•¸œ°™¥ÉÍÑI½Ü€ü•ÕÉ¼¡™¥ÉÍÑI½Ü¹‰…Í”ñð€À¤€è€œÀ°ÀÀƒŠ
°t°(€€€€€liÕÍ…Ñè¥´•ÉÍÑ•¸i¥•±µ½¹…Ðœ°™¥ÉÍÑ	Õ‘•ÑI½Ü€ü•ÕÉ¼¡™¥ÉÍÑ	Õ‘•ÑI½Ü¹•áÑÉ„ñð€À¤€è€œÀ°ÀÀƒŠ
°t°(€€€€€l9•Õ‰•É•¡¹Õ¹œœ°€©•‘•¸5½¹…Ð…ÕÑ½µ…Ñ¥Í t(€€€t¹™½É…  ¡m±…‰•°°Ù…±Õ•t¤€ôøì(€€€€€½¹ÍÐ¥Ñ•´€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€¥Ñ•´¹±…ÍÍ9…µ”€ô€‘•‰Ðµ™É•”µ™…Ðœì(€€€€€¥Ñ•´¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°€œœ°±…‰•°¤¤ì(€€€€€¥Ñ•´¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°Ù…±Õ”¤¤ì(€€€€€™…ÑÌ¹…ÁÁ•¹‘¡¥±¡¥Ñ•´¤ì(€€€ô¤ì(€€€¡•É¼¹…ÁÁ•¹‘¡¥±¡™…ÑÌ¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡¡•É¼¤ì((((€€€¥˜€¡Í¡•‘Õ±•‘=¹•Q¥µ”¹±•¹Ñ ¤ì(€€€€€½¹ÍÐ¥¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€¥¹™¼¹±…ÍÍ9…µ”€ô€Í½™Ðµ¥¹™¼‘•‰Ðµ™½É•…ÍÐµ¥¹™¼œì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°€•ÍÐ•¥¹•Á±…¹Ñ”¥¹µ…±é…¡±Õ¹•¸œ¤¤ì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥•Í”A½ÍÑ•¸Í¥¹•¥¹µ…±¥œ›‘±±¥œÕ¹Ý•É‘•¸¥¸¥¡É•´‘±±¥­•¥ÑÍµ½¹…Ð‰•Ëñ­Í¥¡Ñ¥Ð¸M¥”‰±½­¥•É•¸‘¥”AÉ½¹½Í”‘•È•Á±…¹Ñ•¸I…Ñ•¹Í¡Õ±‘•¸¹¥¡Ð¸œ¤¤ì(€€€€€½¹ÍÐ±¥ÍÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Õ°œ¤ì(€€€€€Í¡•‘Õ±•‘=¹•Q¥µ”(€€€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôøMÑÉ¥¹œ¡„¹Í¡•‘Õ±•‘5½¹Ñ ñð€œœ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡ˆ¹Í¡•‘Õ±•‘5½¹Ñ ñð€œœ¤¤ñðMÑÉ¥¹œ¡„¹¹…µ”ñð€œœ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡ˆ¹¹…µ”ñð€œœ¤¤¤(€€€€€€€€¹™½É…  ¡‘•‰Ð¤€ôøì(€€€€€€€€€½¹ÍÐ±¤€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±¤œ¤ì(€€€€€€€€€±¤¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘í‘•‰Ð¹¹…µ”ñð€M¡Õ±ôƒ
Ü€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡‘•‰Ð¹Í¡•‘Õ±•‘5½¹Ñ ¥ôƒ
Ü€‘í•ÕÉ¼¡‘•‰Ð¹½Á•¸ñð€À¥õ€ì(€€€€€€€€€±¥ÍÐ¹…ÁÁ•¹‘¡¥±¡±¤¤ì(€€€€€€€ô¤ì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡±¥ÍÐ¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡¥¹™¼¤ì(€€€ô((€€€¥˜€¡¹½ÑA±…¹¹•¹±•¹Ñ ¤ì(€€€€€½¹ÍÐÝ…É¹¥¹œ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€Ý…É¹¥¹œ¹±…ÍÍ9…µ”€ô€Í½™ÐµÝ…É¹¥¹œ‘•‰Ðµ™½É•…ÍÐµÝ…É¹¥¹œœì(€€€€€Ý…É¹¥¹œ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°€!¥¹Ý•¥Ìè9½ ¹¥¡Ð•¥¹•Á±…¹Ñ”M¡Õ±¡•¸¤œ¤¤ì(€€€€€Ý…É¹¥¹œ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥•Í”A½ÍÑ•¸¡…‰•¸¹½ ­•¥¹•¸™•ÍÑ•¸I…Ñ•¹Á±…¸‰éÜ¸­•¥¹”5½¹…ÑÍÉ…Ñ”¸M¥”Ý•É‘•¸…±Ì!¥¹Ý•¥Ì•é•¥Ð°‰±½­¥•É•¸…‰•È‘¥”M¡Õ±‘•¹™É•¤µAÉ½¹½Í”‘•È‰•É•¥ÑÌ•Á±…¹Ñ•¸I…Ñ•¹Í¡Õ±‘•¸¹¥¡Ð¸œ¤¤ì(€€€€€½¹ÍÐ±¥ÍÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Õ°œ¤ì(€€€€€¹½ÑA±…¹¹•¹™½É…  ¡‘•‰Ð¤€ôøì(€€€€€€€½¹ÍÐ±¤€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±¤œ¤ì(€€€€€€€±¤¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘í‘•‰Ð¹¹…µ”ñð€M¡Õ±ôƒ
Ü½™™•¸€‘í•ÕÉ¼¡‘•‰Ð¹½Á•¸ñð€À¥ôƒ
Ü€‘í‘•‰Ð¹•á±Õ‘•I•…Í½¸ñð€¹½ ¹¥¡Ð•¥¹•Á±…¹Ðõ€ì(€€€€€€€±¥ÍÐ¹…ÁÁ•¹‘¡¥±¡±¤¤ì(€€€€€ô¤ì(€€€€€Ý…É¹¥¹œ¹…ÁÁ•¹‘¡¥±¡±¥ÍÐ¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡Ý…É¹¥¹œ¤ì(€€€ô((€€€½¹ÍÐ¹½Ñ”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¹½Ñ”¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€¹½Ñ”¹Ñ•áÑ½¹Ñ•¹Ð€ô€ˆ=­Ñ½‰•È€ÈÀÈØ‰¥¹‘•Ð‘¥”ÁÀ©•‘•¸5½¹…Ð‘•¸€àÀÀ·Š
°µÉÕ¹‘Á½½°¸ˆ)…¹Õ…È€ÈÀÈÜ­½µµÐ	•¹¹åÌ¥¹­½µµ•¸ƒñ‰•È€È¸ÌÀÀƒŠ
°éÕÏ‘Ñé±¥ ‘…éÔì‘•È‘¥É•­Ñ”-É•¥Í­…ÍÍ•¸µ1½¡¹…‰éÕœ¥ÍÐ‘…É¥¸•¹Ñ¡…±Ñ•¸¸9… MÑ…¹‘…É‘É…Ñ•¸ÁËñ™ÐÍ¥”·Ù±¥¡”-½µÁ±•ÑÑ…‰³ÙÍÕ¹•¸¸]•¹¸­•¥¹”Á…ÍÍ•¹‘”M¡Õ±­½µÁ±•ÑÐ•Ñ¥±ÐÝ•É‘•¸­…¹¸°•¡Ð‘¥”éÕÏ‘Ñé±¥¡”i…¡±Õ¹œ…¸!½¥ÍÐ¥¹…¹”€¡Q…É½‰…¹¬¤¸Y•É•¥¹‰…ÉÑ”I…Ñ•¸‰±•¥‰•¸Õ¹Ù•Ë‘¹‘•ÉÐ¸œì(€€€…É¹…ÁÁ•¹‘¡¥±¡¹½Ñ”¤ì(€€€É•ÑÕÉ¸…Éì(€ô((€™Õ¹Ñ¥½¸É•¹‘•É5½¹Ñ¡±å•‰Ñ	Õ‘•ÑMÕ•ÍÑ¥½¹…É¡µ½¹Ñ¡-•ä°Á±…¸€ô¹Õ±°¤ì(€€€½¹ÍÐÑ…É•Ñ5½¹Ñ €ôµ½¹Ñ¡-•ä€ðÍ¹½Ý‰…±±½¹™¥œ¹µ½¹Ñ¡±åQ…É•ÑMÑ…ÉÑ5½¹Ñ (€€€€€€üÍ¹½Ý‰…±±½¹™¥œ¹µ½¹Ñ¡±åQ…É•ÑMÑ…ÉÑ5½¹Ñ (€€€€€€èµ½¹Ñ¡-•äì(€€€½¹ÍÐ…Ñ¥Ù•A±…¸€ôÁ±…¸ñð‰Õ¥±‘M¹½Ý‰…±±A±…¸¡µ½¹Ñ¡-•ä°€ÄÈÀ¤ì(€€€½¹ÍÐÉ½Ü€ô€¡…Ñ¥Ù•A±…¸¹É½ÝÌñðmt¤¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹µ½¹Ñ €ôôôÑ…É•Ñ5½¹Ñ €˜˜9Õµ‰•È¡•¹ÑÉä¹µ½¹Ñ¡±åQ…É•Ðñð€À¤€ø€À¤ì(€€€¥˜€ …É½Ü¤É•ÑÕÉ¸¹Õ±°ì((€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€ÍÕˆµ…É‘å¹…µ¥Œµ‘•‰Ðµ•áÑÉ„µ…Éœì(€€€½¹ÍÐ¡•…€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•…¹±…ÍÍ9…µ”€ô€‘å¹…µ¥Œµ‘•‰Ðµ•áÑÉ„µ¡•…œì(€€€½¹ÍÐÑ¥Ñ±•]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Ñ¥Ñ±•]É…À¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°€Á¥±°ÍÕ•ÍÌœ°MÑ…ÉÐ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡Í¹½Ý‰…±±½¹™¥œ¹µ½¹Ñ¡±åQ…É•ÑMÑ…ÉÑ5½¹Ñ ¥õ€¤¤ì(€€€Ñ¥Ñ±•]É…À¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°I…Ñ•¹Ù½ÉÍ¡±…œ›ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡Ñ…É•Ñ5½¹Ñ ¥õ€¤¤ì(€€€Ñ¥Ñ±•]É…À¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥”ÁÀÉ•¡¹•Ð©•‘•¸5½¹…Ð¹•Ô¸9… ‘•¸Õ¹Ù•Ë‘¹‘•ÉÑ•¸MÑ…¹‘…É‘É…Ñ•¸ÁËñ™ÐÍ¥”éÕ•ÉÍÐ°½ˆ•¥¹”••¥¹•Ñ”M¡Õ±Ù½±±ÍÓ‘¹‘¥œ…‰³ÙÍ‰…È¥ÍÐ¸]•¹¸¹¥¡Ð°•¡Ð‘¥”éÕÏ‘Ñé±¥¡”Q¥±Õ¹œ…¸!½¥ÍÐ¥¹…¹”€¡Q…É½‰…¹¬¤¸•È€àÀÀ·Š
°µÉÕ¹‘Á½½°‰±•¥‰Ð‰•ÍÑ•¡•¸ì	•¹¹åÌ¥¹­½µµ•¸ƒñ‰•È€È¸ÌÀÀƒŠ
°­½µµÐ…ˆ)…¹Õ…È€ÈÀÈÜéÕÏ‘Ñé±¥ ¡¥¹éÔ¸Y•É•¥¹‰…ÉÑ”5½¹…ÑÍÉ…Ñ•¸‰±•¥‰•¸Õ¹Ù•Ë‘¹‘•ÉÐ¸œ¤¤ì(€€€½¹ÍÐÉ•…±Õ±…Ñ¥½¹5½¹Ñ €ôÍÑ…Ñ”¹…ÁÁ5•Ñ„€˜˜ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑA±…¹1…ÍÑI•…±Õ±…Ñ•‘5½¹Ñ ì(€€€½¹ÍÐÉ•…±Õ±…Ñ¥½¹•‰Ñ9…µ”€ôÍÑ…Ñ”¹…ÁÁ5•Ñ„€˜˜ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑA±…¹1…ÍÑI•…±Õ±…Ñ•‘•‰Ñ9…µ”ì(€€€¥˜€¡¥Í5½¹Ñ¡-•ä¡É•…±Õ±…Ñ¥½¹5½¹Ñ ¤€˜˜É•…±Õ±…Ñ¥½¹•‰Ñ9…µ”¤ì(€€€€€Ñ¥Ñ±•]É…À¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°ÍÕ•ÍÌµÑ•áÐœ°9•Ô‰•É•¡¹•Ð¹… ‘•´…­ÑÕ…±¥Í¥•ÉÑ•¸M¡Õ±‘•¹ÍÑ…¹Ù½¸€‘íÉ•…±Õ±…Ñ¥½¹•‰Ñ9…µ•ô€ ‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡É•…±Õ±…Ñ¥½¹5½¹Ñ ¥ô¤¹€¤¤ì(€€€ô(€€€¡•…¹…ÁÁ•¹‘¡¥±¡Ñ¥Ñ±•]É…À¤ì(€€€¡•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€‘å¹…µ¥Œµ‘•‰Ðµ•áÑÉ„µ…µ½Õ¹Ðœ°•ÕÉ¼¡É½Ü¹µ½¹Ñ¡±åQ…É•Ð¤¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡¡•…¤ì(€€€½¹ÍÐ¥µÁ…ÑQ•áÐ€ô•Ñ•‰ÑA±…¹%µÁ…ÑQ•áÐ¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„€˜˜ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹‘•‰ÑA±…¹1…ÍÑ%µÁ…Ð¤ì(€€€¥˜€¡¥µÁ…ÑQ•áÐ¤…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”¥¹™¼œ°¥µÁ…ÑQ•áÐ¤¤ì((€€€½¹ÍÐ‘…å5½¹•åQÉ…¹Í™•È€ôÉ½Õ¹‘5½¹•ä¡9Õµ‰•È¡É½Ü¹‘•‰ÑM…Ù¥¹Í•Á½Í¥Ðñð€À¤¤ì(€€€½¹ÍÐÑ½Ñ…±I•Í•ÉÙ•€ôÉ½Õ¹‘5½¹•ä¡5…Ñ ¹µ…à¡9Õµ‰•È¡É½Ü¹Á½½°ñð€À¤°9Õµ‰•È¡É½Ü¹Ñ½Ñ…°ñð€À¤¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€œàÀÀ·Š
°µÉÕ¹‘Á½½°œ°Ù…±Õ”è•ÕÉ¼¡É½Ü¹™¥á•‘5½¹Ñ¡±åQ…É•Ð€„ô¹Õ±°€üÉ½Ü¹™¥á•‘5½¹Ñ¡±åQ…É•Ð€èÉ½Ü¹µ½¹Ñ¡±åQ…É•Ð¤°­¥¹è€ÍÕ•ÍÌœô°(€€€€€ì±…‰•°è€iÕÍ…Ñè…ÕÌ	•¹¹åÌ¥¹­½µµ•¸œ°Ù…±Õ”è•ÕÉ¼¡É½Ü¹¥¹½µ•1¥¹­•‘áÑÉ„ñð€À¤°¡¥¹Ðè¥¹•ÑÉ…•¹•Ì¥¹­½µµ•¸ƒñ‰•È€‘í•ÕÉ¼¡Í¹½Ý‰…±±½¹™¥œ¹¥¹½µ•1¥¹­•‘áÑÉ…Q¡É•Í¡½±¥ôì•ÑÉ•¹¹ÐÙ½¸MÑ…¹‘…É‘É…Ñ•¸¹€ô°(€€€€€ì±…‰•°è€M¡Õ±‘•¹‰Õ‘•Ð•Í…µÐœ°Ù…±Õ”è•ÕÉ¼¡É½Ü¹µ½¹Ñ¡±åQ…É•Ð¤°­¥¹è€ÍÕ•ÍÌœô°(€€€€€ì±…‰•°è€MÑ…¹‘…É‘É…Ñ•¸•Á±…¹Ðœ°Ù…±Õ”è•ÕÉ¼¡É½Ü¹‰…Í”ñð€À¤ô°(€€€€€ì±…‰•°è€iÕÏ‘Ñé±¥ Ù½É•Í¡±…•¸œ°Ù…±Õ”è•ÕÉ¼¡É½Ü¹•áÑÉ„ñð€À¤°­¥¹è9Õµ‰•È¡É½Ü¹•áÑÉ„ñð€À¤€ø€À€ü€Ý…É¹¥¹œœ€è€œœô°(€€€€€ì±…‰•°èÑ…É•Ñ5½¹Ñ €ôôôµ½¹Ñ¡-•ä€ü€	•É•¥ÑÌ‰•é…¡±Ðœ€è€MÑ…ÉÐœ°Ù…±Õ”èÑ…É•Ñ5½¹Ñ €ôôôµ½¹Ñ¡-•ä€ü•ÕÉ¼¡É½Ü¹…±É•…‘åA…¥ñð€À¤€è™½Éµ…Ñ5½¹Ñ¡1…‰•°¡Ñ…É•Ñ5½¹Ñ ¤ô°(€€€€€ì±…‰•°è€•Í…µÐ•‰Õ¹‘•¸œ°Ù…±Õ”è•ÕÉ¼¡Ñ½Ñ…±I•Í•ÉÙ•¤°­¥¹èÑ½Ñ…±I•Í•ÉÙ•€¬€À¸ÀÀÔ€øô9Õµ‰•È¡É½Ü¹µ½¹Ñ¡±åQ…É•Ðñð€À¤€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€ì±…‰•°è€…Ù½¸…Õ™ÌQ…•Í•±œ°Ù…±Õ”è•ÕÉ¼¡‘…å5½¹•åQÉ…¹Í™•È¤°­¥¹è‘…å5½¹•åQÉ…¹Í™•È€ø€À€ü€Ý…É¹¥¹œœ€è€ÍÕ•ÍÌœ°¡¥¹Ðè€	±•¥‰Ð›ñÈM¡Õ±‘•¸É•Í•ÉÙ¥•ÉÐ¸œô(€€€t¤¤ì((€€€½¹ÍÐÉ½ÕÁ•€ô¹•Ü5…À ¤ì(€€€€¡É½Ü¹Á…åµ•¹ÑÌñðmt¤¹™½É…  ¡Á…åµ•¹Ð¤€ôøì(€€€€€½¹ÍÐ¹…µ”€ôÁ…åµ•¹Ð¹‘•‰Ðñð€M¡Õ±œì(€€€€€¥˜€ …É½ÕÁ•¹¡…Ì¡¹…µ”¤¤É½ÕÁ•¹Í•Ð¡¹…µ”°ì¹…µ”°É…Ñ”è€À°•áÑÉ„è€À°™Õ±±A…å½™˜è€À°½µÁ±•Ñ•è™…±Í”°¹½Ñ•Ìèmtô¤ì(€€€€€½¹ÍÐ¥Ñ•´€ôÉ½ÕÁ•¹•Ð¡¹…µ”¤ì(€€€€€¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€É…Ñ”œ¤¥Ñ•´¹É…Ñ”€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤ì(€€€€€¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€‰Õ‘•Ñ}•áÑÉ„œñðÁ…åµ•¹Ð¹ÑåÁ”€ôôô€Í¹½Ý‰…±°œ¤¥Ñ•´¹•áÑÉ„€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤ì(€€€€€¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€™Õ±±}Á…å½™˜œ¤ì(€€€€€€€¥Ñ•´¹™Õ±±A…å½™˜€ô9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤ì(€€€€€€€¥Ñ•´¹É…Ñ”€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹É…Ñ•µ½Õ¹Ðñð€À¤ì(€€€€€€€¥Ñ•´¹•áÑÉ„€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹Í¹½Ý‰…±±µ½Õ¹Ðñð€À¤ì(€€€€€ô(€€€€€¥Ñ•´¹½µÁ±•Ñ•€ô¥Ñ•´¹½µÁ±•Ñ•ñð€„…Á…åµ•¹Ð¹½µÁ±•Ñ•ì(€€€€€¥˜€¡Á…åµ•¹Ð¹¹½Ñ”¤¥Ñ•´¹¹½Ñ•Ì¹ÁÕÍ ¡Á…åµ•¹Ð¹¹½Ñ”¤ì(€€€ô¤ì((€€€½¹ÍÐÍÕ•ÍÑ¥½¹Ì€ôÉÉ…ä¹™É½´¡É½ÕÁ•¹Ù…±Õ•Ì ¤¤¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹•áÑÉ„€ø€À¸ÀÀÔñð¥Ñ•´¹™Õ±±A…å½™˜€ø€À¸ÀÀÔ¤ì(€€€¥˜€¡É½Ü¹Á…å½™™I•Í•ÉÙ”€˜˜€…É½Ü¹Á…å½™™I•Í•ÉÙ”¹…¹A…å½™˜€˜˜9Õµ‰•È¡É½Ü¹Á…å½™™I•Í•ÉÙ”¹É•Í•ÉÙ•‘‘•ñð€À¤€ø€À¤ì(€€€€€ÍÕ•ÍÑ¥½¹Ì¹ÁÕÍ ¡ì(€€€€€€€¹…µ”èÉ½Ü¹Á…å½™™I•Í•ÉÙ”¹Ñ…É•Ñ•‰Ð°(€€€€€€€É…Ñ”è€À°(€€€€€€€•áÑÉ„è9Õµ‰•È¡É½Ü¹Á…å½™™I•Í•ÉÙ”¹É•Í•ÉÙ•‘‘•ñð€À¤°(€€€€€€€™Õ±±A…å½™˜è€À°(€€€€€€€½µÁ±•Ñ•è™…±Í”°(€€€€€€€É•Í•ÉÙ•=¹±äèÑÉÕ”°(€€€€€€€¹½Ñ•Ìèl›ñÈ‘¥”ÍÃ‘Ñ•É”•Í…µÑ™½É‘•ÉÕ¹œéÕËñ­±••¸t(€€€€€ô¤ì(€€€ô(€€€¥˜€¡9Õµ‰•È¡É½Ü¹Õ¹…±±½…Ñ•‘	Õ‘•Ðñð€À¤€ø€À¸ÀÀÔ¤ì(€€€€€ÍÕ•ÍÑ¥½¹Ì¹ÁÕÍ ¡ì(€€€€€€€¹…µ”è€M¡Õ±‘•¸µKñ­±…”Q…•Í•±œ°(€€€€€€€É…Ñ”è€À°(€€€€€€€•áÑÉ„è9Õµ‰•È¡É½Ü¹Õ¹…±±½…Ñ•‘	Õ‘•Ðñð€À¤°(€€€€€€€™Õ±±A…å½™˜è€À°(€€€€€€€½µÁ±•Ñ•è™…±Í”°(€€€€€€€É•Í•ÉÙ•=¹±äèÑÉÕ”°(€€€€€€€•¹•É…±•‰ÑI•Í•ÉÙ”èÑÉÕ”°(€€€€€€€¹½Ñ•Ìèl‰±•¥‰Ð›ñÈÍÃ‘Ñ•É”M¡Õ±‘•¹Ñ¥±Õ¹œ•‰Õ¹‘•¸t(€€€€€ô¤ì(€€€ô((€€€¥˜€¡ÍÕ•ÍÑ¥½¹Ì¹±•¹Ñ ¤ì(€€€€€½¹ÍÐ±¥ÍÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€±¥ÍÐ¹±…ÍÍ9…µ”€ô€‘•‰ÐµÉ½±±½Ù•Èµ±¥ÍÐœì(€€€€€ÍÕ•ÍÑ¥½¹Ì¹™½É…  ¡¥Ñ•´¤€ôøì(€€€€€€€½¹ÍÐ‘•‰Ð€ô¥Ñ•´¹•¹•É…±•‰ÑI•Í•ÉÙ”€ü¹Õ±°€è€ ¡ÍÑ…Ñ”¹‘•‰ÑÌñðmt¤¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä€˜˜•¹ÑÉä¹¹…µ”€ôôô¥Ñ•´¹¹…µ”¤ñð¹Õ±°¤ì(€€€€€€€½¹ÍÐÕÉÉ•¹ÑI…Ñ”€ô‘•‰Ð€ü9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°Ñ…É•Ñ5½¹Ñ ¤ñð€À¤€è9Õµ‰•È¡¥Ñ•´¹É…Ñ”ñð€À¤ì(€€€€€€€½¹ÍÐ…¹I…¥Í•I…Ñ”€ô€„„¡‘•‰Ð(€€€€€€€€€€˜˜‘•‰Ð¹Á…åµ•¹ÑQåÁ”€ôôô€¥¹ÍÑ…±±µ•¹Ðœ(€€€€€€€€€€˜˜€…¥Ñ•´¹½µÁ±•Ñ•(€€€€€€€€€€˜˜€…¥Í•‰ÑÕ±±A…å½™™=¹±ä¡‘•‰Ð¤(€€€€€€€€€€˜˜…¹5½‘¥™å•‰ÑI…Ñ•½ÉÉ•‘¥Ñ½È¡‘•‰Ð°Ñ…É•Ñ5½¹Ñ ¤(€€€€€€€€€€˜˜¥Í•‰ÑI…Ñ•¡…¹•±±½Ý•‘%¹5½¹Ñ ¡‘•‰Ð°Ñ…É•Ñ5½¹Ñ ¤¤ì(€€€€€€€±•ÐÉ•½µµ•¹‘…Ñ¥½¸€ô€œœì(€€€€€€€¥˜€¡¥Ñ•´¹™Õ±±A…å½™˜€ø€À¤ì(€€€€€€€€€É•½µµ•¹‘…Ñ¥½¸€ô•Í…µÑ™½É‘•ÉÕ¹œÙ½¸Ù½É…ÕÍÍ¥¡Ñ±¥ €‘í•ÕÉ¼¡¥Ñ•´¹™Õ±±A…å½™˜¥ôÙ½±±ÍÓ‘¹‘¥œ‰•é…¡±•¸¹€ì(€€€€€€€ô•±Í”¥˜€¡¥Ñ•´¹•¹•É…±•‰ÑI•Í•ÉÙ”¤ì(€€€€€€€€€É•½µµ•¹‘…Ñ¥½¸€ô€‘í•ÕÉ¼¡¥Ñ•´¹•áÑÉ„¥ô…Õ™ÌQ…•Í•±±••¸Õ¹…ÕÍÍ¡±¥—}±¥ ›ñÈÍÃ‘Ñ•É”M¡Õ±‘•¹é…¡±Õ¹•¸•‰Õ¹‘•¸±…ÍÍ•¸¹€ì(€€€€€€€ô•±Í”¥˜€¡¥Ñ•´¹É•Í•ÉÙ•=¹±ä¤ì(€€€€€€€€€É•½µµ•¹‘…Ñ¥½¸€ô€‘í•ÕÉ¼¡¥Ñ•´¹•áÑÉ„¥ô›ñÈ‘¥”ÍÃ‘Ñ•É”•Í…µÑé…¡±Õ¹œéÕËñ­±••¸ì­•¥¹”Õ¹éÕ³‘ÍÍ¥”Q•¥±é…¡±Õ¹œÍ•¹‘•¸¹€ì(€€€€€€€ô•±Í”¥˜€¡¥Ñ•´¹½µÁ±•Ñ•¤ì(€€€€€€€€€É•½µµ•¹‘…Ñ¥½¸€ô¥¹µ…±¥œ€‘í•ÕÉ¼¡¥Ñ•´¹•áÑÉ„¥ôéÕÏ‘Ñé±¥ é…¡±•¸ƒŠL‘…µ¥Ðß‘É”‘¥•Í”M¡Õ±•É±•‘¥Ð¹€ì(€€€€€€€ô•±Í”¥˜€¡…¹I…¥Í•I…Ñ”¤ì(€€€€€€€€€É•½µµ•¹‘…Ñ¥½¸€ôI…Ñ”›ñÈ‘¥•Í•¸A±…¹µ½¹…ÐÙ½¸€‘í•ÕÉ¼¡ÕÉÉ•¹ÑI…Ñ”¥ô…Õ˜€‘í•ÕÉ¼¡ÕÉÉ•¹ÑI…Ñ”€¬¥Ñ•´¹•áÑÉ„¥ô•É£Ù¡•¸¹€ì(€€€€€€€ô•±Í”¥˜€¡ÕÉÉ•¹ÑI…Ñ”€ø€À¤ì(€€€€€€€€€É•½µµ•¹‘…Ñ¥½¸€ôY•É•¥¹‰…ÉÑ”I…Ñ”Ù½¸€‘í•ÕÉ¼¡ÕÉÉ•¹ÑI…Ñ”¥ô‰•¥‰•¡…±Ñ•¸Õ¹€‘í•ÕÉ¼¡¥Ñ•´¹•áÑÉ„¥ô™É•¥Ý¥±±¥œéÕÏ‘Ñé±¥ é…¡±•¸¹€ì(€€€€€€€ô•±Í”ì(€€€€€€€€€É•½µµ•¹‘…Ñ¥½¸€ôÉ•¥Ý¥±±¥”i…¡±Õ¹œÙ½¸€‘í•ÕÉ¼¡¥Ñ•´¹•áÑÉ„¥ô•¥¹Á±…¹•¸¹€ì(€€€€€€€ô((€€€€€€€½¹ÍÐÍÕ•ÍÑ¥½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€€€ÍÕ•ÍÑ¥½¸¹±…ÍÍ9…µ”€ô€‘•‰ÐµÉ½±±½Ù•ÈµÉ½Üœì(€€€€€€€½¹ÍÐ¹…µ•	±½¬€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€€€¹…µ•	±½¬¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°¥Ñ•´¹½µÁ±•Ñ•ñð¥Ñ•´¹™Õ±±A…å½™˜€ø€À€ü€Á¥±°ÍÕ•ÍÌœ€è€Á¥±°Ý…É¹¥¹œœ°¥Ñ•´¹™Õ±±A…å½™˜€ø€À€ü€•Í…µÑ…‰³ÙÍÕ¹œœ€è€¡¥Ñ•´¹½µÁ±•Ñ•€ü€ß‘É”•É±•‘¥Ðœ€è€Y½ÉÍ¡±…œœ¤¤¤ì(€€€€€€€¹…µ•	±½¬¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°¥Ñ•´¹¹…µ”¤¤ì(€€€€€€€¹…µ•	±½¬¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°ÕÉÉ•¹ÑI…Ñ”€ø€À€ü	¥Í¡•É¥”I…Ñ”è€‘í•ÕÉ¼¡ÕÉÉ•¹ÑI…Ñ”¥õ€€è€9½ ­•¥¹”™•ÍÑ”5½¹…ÑÍÉ…Ñ”œ¤¤ì(€€€€€€€½¹ÍÐÉ•½µµ•¹‘…Ñ¥½¹	±½¬€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€€€É•½µµ•¹‘…Ñ¥½¹	±½¬¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°É•½µµ•¹‘…Ñ¥½¸¤¤ì(€€€€€€€É•½µµ•¹‘…Ñ¥½¹	±½¬¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°€9ÕÈ…±ÌY½ÉÍ¡±…œƒŠL•¥¹”‰•ÍÑ•¡•¹‘”Y•É•¥¹‰…ÉÕ¹œÝ¥É¹¥¡Ð…ÕÑ½µ…Ñ¥Í —‘¹‘•ÉÐ¸œ¤¤ì(€€€€€€€ÍÕ•ÍÑ¥½¸¹…ÁÁ•¹‘¡¥±¡¹…µ•	±½¬¤ì(€€€€€€€ÍÕ•ÍÑ¥½¸¹…ÁÁ•¹‘¡¥±¡É•½µµ•¹‘…Ñ¥½¹	±½¬¤ì(€€€€€€€±¥ÍÐ¹…ÁÁ•¹‘¡¥±¡ÍÕ•ÍÑ¥½¸¤ì(€€€€€ô¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡±¥ÍÐ¤ì(€€€ô•±Í”ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”ÍÕ•ÍÌœ°9Õµ‰•È¡É½Ü¹Ñ½Ñ…°ñð€À¤€øô9Õµ‰•È¡É½Ü¹µ½¹Ñ¡±åQ…É•Ðñð€À¤(€€€€€€€€ü€¥”‰•ÍÑ•¡•¹‘•¸i…¡±Õ¹•¸•ÉÉ•¥¡•¸‘…Ì5½¹…ÑÍé¥•°‰•É•¥ÑÌì•¥¹”I…Ñ•¹•É£Ù¡Õ¹œ¥ÍÐ¹¥¡Ð»ÙÑ¥œ¸œ(€€€€€€€€è€­ÑÕ•±°­…¹¸­•¥¹”éÕÏ‘Ñé±¥¡”I…Ñ”Ù½É•Í¡±…•¸Ý•É‘•¸¸i…¡±Õ¹ÍÉ••±¸Õ¹I•ÍÑÍ¡Õ±‘•¸Ý•É‘•¸Ý•¥Ñ•É¡¥¸‰•…¡Ñ•Ð¸œ¤¤ì(€€€ô((€€€¥˜€¡‘…å5½¹•åQÉ…¹Í™•È€ø€À¸ÀÀÔ¤…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°Ý…É¹¥¹œµÑ•áÐœ°€‘í•ÕÉ¼¡‘…å5½¹•åQÉ…¹Í™•È¥ôÝ•É‘•¸¹¥¡Ð™É•¤èM¥”•£ÙÉ•¸Ý•¥Ñ•ÈéÕ´M¡Õ±‘•¸µA½½°Õ¹Ý•É‘•¸‰•¤‘•È»‘¡ÍÑ•¸Í¥¹¹Ù½±±•¸•Í…µÑ…‰³ÙÍÕ¹œ•É¹•ÕÐ‰•Ëñ­Í¥¡Ñ¥Ð¹€¤¤ì(€€€É•ÑÕÉ¸…Éì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉÕ±±A…å½™™I•Í•ÉÙ•…É¡µ½¹Ñ¡-•ä°Á±…¸¤ì(€€€½¹ÍÐÉ½Ü€ô€¡Á±…¸€˜˜ÉÉ…ä¹¥ÍÉÉ…ä¡Á±…¸¹É½ÝÌ¤€üÁ±…¸¹É½ÝÌ€èmt¤(€€€€€€¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹µ½¹Ñ €ôôôµ½¹Ñ¡-•ä€˜˜•¹ÑÉä¹Á…å½™™I•Í•ÉÙ”¤ì(€€€¥˜€ …É½Üñð€…É½Ü¹Á…å½™™I•Í•ÉÙ”¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÉ•Í•ÉÙ”€ôÉ½Ü¹Á…å½™™I•Í•ÉÙ”ì(€€€½¹ÍÐÑ…É•Ð€ô€¡ÍÑ…Ñ”¹‘•‰ÑÌñðmt¤¹™¥¹ ¡‘•‰Ð¤€ôø‘•‰Ð€˜˜‘•‰Ð¹¹…µ”€ôôôÉ•Í•ÉÙ”¹Ñ…É•Ñ•‰Ð¤ì(€€€¥˜€ …Ñ…É•Ðñð€„¡9Õµ‰•È¡Ñ…É•Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ø€À¤¤É•ÑÕÉ¸¹Õ±°ì((€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€ÍÕˆµ…É‘•‰ÐµÉ½±±½Ù•Èµ…Éœì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°É•Í•ÉÙ”¹…¹A…å½™˜€ü€Á¥±°ÍÕ•ÍÌœ€è€Á¥±°Ý…É¹¥¹œœ°É•Í•ÉÙ”¹…¹A…å½™˜€ü€•Í…µÑ…‰³ÙÍÕ¹œ·Ù±¥ œ€è€ñÈ•Í…µÑ…‰³ÙÍÕ¹œéÕËñ­±••¸œ¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€‘íÉ•Í•ÉÙ”¹Ñ…É•Ñ•‰Ñôè¹ÕÈI…Ñ”½‘•È•Í…µÑ™½É‘•ÉÕ¹€¤¤ì((€€€½¹ÍÐ™ÕÑÕÉ•A…å½™˜€ô€¡Á±…¸¹É½ÝÌñðmt¤¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹Á…å½™™I•Í•ÉÙ”€˜˜•¹ÑÉä¹Á…å½™™I•Í•ÉÙ”¹…¹A…å½™˜¤ì(€€€½¹ÍÐÑ•áÐ€ôÉ•Í•ÉÙ”¹…¹A…å½™˜(€€€€€€ü€¥”Kñ­±…”…ÕÌ‘•´Y½Éµ½¹…ÐÕ¹‘•È…­ÑÕ•±±”M¡Õ±‘•¸µA½½°É•¥¡•¸©•ÑéÐ¸	•¥´¹‰¥•Ñ•È‰¥ÑÑ”‘¥”Ù½±±ÍÓ‘¹‘¥”•Í…µÑ™½É‘•ÉÕ¹œß‘¡±•¸Õ¹‘•¸‘½ÉÐ…­ÑÕ•±°…¹•é•¥Ñ•¸	•ÑÉ…œÁËñ™•¸¸œ(€€€€€€è€‘í•ÕÉ¼¡É•Í•ÉÙ”¹É•Í•ÉÙ•‘‘•¥ô…ÕÌ‘•È™É•¤•Ý½É‘•¹•¸I…Ñ”Ù½¸€‘íÉ•Í•ÉÙ”¹Í½ÕÉ••‰ÑôÝ•É‘•¸¥¸€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡µ½¹Ñ¡-•ä¥ô¹¥¡Ð…±ÌQ•¥±é…¡±Õ¹œ…¸€‘íÉ•Í•ÉÙ”¹Ñ…É•Ñ•‰Ñô•Í¡¥­Ð°Í½¹‘•É¸…±Ì•‰Õ¹‘•¹”M¡Õ±‘•¸µKñ­±…”…Õ™ÌQ…•Í•±•±•Ð¸‘í™ÕÑÕÉ•A…å½™˜€ü€Y½É…ÕÍÍ¥¡Ñ±¥ É•¥¡Ð•Ì¥¸€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡™ÕÑÕÉ•A…å½™˜¹µ½¹Ñ ¥ô¹€€è€œõ€ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°Ñ•áÐ¤¤ì((€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡É•Í•ÉÙ”¹…¹A…å½™˜(€€€€€€ül(€€€€€€€€€ì±…‰•°è€ÕÌY½Éµ½¹…Ñ•¸éÕËñ­•±•Ðœ°Ù…±Õ”è•ÕÉ¼¡É•Í•ÉÙ”¹É•Í•ÉÙ•	•™½É”¤°­¥¹èÉ•Í•ÉÙ”¹É•Í•ÉÙ•	•™½É”€ø€À€ü€ÍÕ•ÍÌœ€è€œœô°(€€€€€€€€€ì±…‰•°è€¥•Í•¸5½¹…Ð…ÕÌM¡Õ±‘•¹‰Õ‘•Ðœ°Ù…±Õ”è•ÕÉ¼¡É•Í•ÉÙ”¹É•Í•ÉÙ•‘‘•¤°­¥¹è€ÍÕ•ÍÌœô°(€€€€€€€€€ì±…‰•°è€•Í…µÑ™½É‘•ÉÕ¹œ±…ÕÐA±…¸œ°Ù…±Õ”è•ÕÉ¼¡É•Í•ÉÙ”¹Á½ÉÑ…±A…å½™™µ½Õ¹Ð¤°­¥¹è€Ý…É¹¥¹œœô°(€€€€€€€€€ì±…‰•°è€I•ÍÐ¥´M¡Õ±‘•¸µA½½°‘…¹… œ°Ù…±Õ”è•ÕÉ¼¡É•Í•ÉÙ”¹±•™Ñ½Ù•É™Ñ•ÉA…å½™˜ñð€À¤ô(€€€€€€€t(€€€€€€èl(€€€€€€€€€ì±…‰•°è€¥•Í•¸5½¹…Ð…Õ™ÌQ…•Í•±œ°Ù…±Õ”è•ÕÉ¼¡É•Í•ÉÙ”¹É•Í•ÉÙ•‘‘•¤°­¥¹è€Ý…É¹¥¹œœô°(€€€€€€€€€ì±…‰•°è€…¹… …¹•ÍÁ…ÉÐœ°Ù…±Õ”è•ÕÉ¼¡É•Í•ÉÙ”¹É•Í•ÉÙ•	…±…¹”¤°­¥¹èÉ•Í•ÉÙ”¹É•Í•ÉÙ•	…±…¹”€ø€À€ü€ÍÕ•ÍÌœ€è€œœô°(€€€€€€€€€ì±…‰•°è€I•ÍÐ¹… ¹½Éµ…±•ÈI…Ñ”œ°Ù…±Õ”è•ÕÉ¼¡É•Í•ÉÙ”¹ÕÉÉ•¹Ñ=Á•¹™Ñ•ÉI…Ñ”¤ô°(€€€€€€€€€ì±…‰•°è€Y½É…ÕÍÍ¥¡Ñ±¥¡”•Í…µÑ…‰³ÙÍÕ¹œœ°Ù…±Õ”è™ÕÑÕÉ•A…å½™˜€ü™½Éµ…Ñ5½¹Ñ¡1…‰•°¡™ÕÑÕÉ•A…å½™˜¹µ½¹Ñ ¤€è€¹½ ½™™•¸œô(€€€€€€€t¤¤ì((€€€¥˜€¡É•Í•ÉÙ”¹…¹A…å½™˜¤ì(€€€€€½¹ÍÐ…Ñ¥½¹I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€…Ñ¥½¹I½Ü¹±…ÍÍ9…µ”€ô€‘å¹…µ¥Œµ‘•‰Ðµ•áÑÉ„µ…Ñ¥½¹Ìœì(€€€€€…Ñ¥½¹I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€•È	•ÑÉ…œÝ¥É•ÉÍÐ¹… ‘•¥¹•ÈÑ…ÑÏ‘¡±¥¡•¸i…¡±Õ¹œ…±Ì‰•é…¡±Ð•ÍÁ•¥¡•ÉÐ¸œ¤¤ì(€€€€€½¹ÍÐ‰ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€‰ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€‰ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€€€‰ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€•Í…µÑ™½É‘•ÉÕ¹œ•¥¹ÑÉ…•¸œì(€€€€€‰ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€Í¡½Ý•‰ÑA…åµ•¹Ñ‘¥Ñ½È¡Ñ…É•Ð°ì(€€€€€€€€€µ½¹Ñ èµ½¹Ñ¡-•ä°(€€€€€€€€€…µ½Õ¹ÐèÉ•Í•ÉÙ”¹Á½ÉÑ…±A…å½™™µ½Õ¹Ð°(€€€€€€€€€µ½‘”è€•áÑÉ„œ°(€€€€€€€€€¹½Ñ”è•Í…µÑ…‰³ÙÍÕ¹œµ¥ÐéÕËñ­•±•Ñ•ÈI…Ñ”…ÕÌ€‘íÉ•Í•ÉÙ”¹Í½ÕÉ••‰Ñõ€°(€€€€€€€€€‘•‰ÑI•Í•ÉÙ•]¥Ñ¡‘É…Ý…±µ½Õ¹Ðè9Õµ‰•È¡É½Ü¹•¹•É…±•‰ÑM…Ù¥¹Í]¥Ñ¡‘É…Ý…°ñð€À¤°(€€€€€€€€€‘•‰ÑI•Í•ÉÙ•]¥Ñ¡‘É…Ý…±Ñ¥½¹-•äè€‘íµ½¹Ñ¡-•åõð‘íÑ…É•Ð¹¥‘õñ™Õ±°µÁ…å½™™ñÉ•Í•ÉÙ”µÝ¥Ñ¡‘É…Ý…±€°(€€€€€€€€€‘•‰ÑI•Í•ÉÙ•I•µ…¥¹‘•Éµ½Õ¹Ðè9Õµ‰•È¡É•Í•ÉÙ”¹±•™Ñ½Ù•É™Ñ•ÉA…å½™˜ñð€À¤°(€€€€€€€€€‘•‰ÑI•Í•ÉÙ•I•µ…¥¹‘•ÉÑ¥½¹-•äè€‘íµ½¹Ñ¡-•åõð‘íÑ…É•Ð¹¥‘õñ™Õ±°µÁ…å½™™ñÉ•Í•ÉÙ”µÉ•µ…¥¹‘•É€(€€€€€€€ô¤ì(€€€€€ô¤ì(€€€€€…Ñ¥½¹I½Ü¹…ÁÁ•¹‘¡¥±¡‰ÕÑÑ½¸¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹I½Ü¤ì(€€€ô(€€€É•ÑÕÉ¸…Éì(€ô((€™Õ¹Ñ¥½¸Í¡½Ý•‰Ñ	…±…¹•¡•­‘¥Ñ½È¡‘•‰Ð°µ½¹Ñ¡-•ä€ôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€¥˜€ …‘•‰Ð¤É•ÑÕÉ¸ì(€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡‘•‰Ð¤ì(€€€½¹ÍÐÑ…É•Ñ5½¹Ñ €ô¥Í5½¹Ñ¡-•ä¡µ½¹Ñ¡-•ä¤€üµ½¹Ñ¡-•ä€èÕÉÉ•¹Ñ5½¹Ñ ì(€€€½¹ÍÐ•á¥ÍÑ¥¹œ€ô€¡‘•‰Ð¹‰…±…¹•¡•­Ìñðmt¤¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹µ½¹Ñ €ôôôÑ…É•Ñ5½¹Ñ ¤ñð¹Õ±°ì(€€€½¹ÍÐÁÉ•Ù¥½ÕÍµ½Õ¹Ð€ô9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤ì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´‘•‰Ðµ‰…±…¹”µ¡•¬µ™½É´œì((€€€½¹ÍÐ¥¹ÑÉ¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¥¹ÑÉ¼¹±…ÍÍ9…µ”€ô€¹½Ñ¥”¥¹™¼œì(€€€¥¹ÑÉ¼¹Ñ•áÑ½¹Ñ•¹Ð€ôQÉ…”‘•¸Ñ…ÑÏ‘¡±¥ …¹•é•¥Ñ•¸M¡Õ±‘•¹ÍÑ…¹›ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡Ñ…É•Ñ5½¹Ñ ¥ô•¥¸¸¥”ÁÀƒñ‰•É¹¥µµÐ¥¡¸…±Ì¹•Õ”I•ÍÑÍ¡Õ±ì•ÌÝ¥É‘…‰•¤­•¥¹”éÕÏ‘Ñé±¥¡”i…¡±Õ¹œ•‰Õ¡Ð¹€ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¥¹ÑÉ¼¤ì((€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€	¥Í¡•È¥¸‘•ÈÁÀœ°Ù…±Õ”è•ÕÉ¼¡ÁÉ•Ù¥½ÕÍµ½Õ¹Ð¤ô°(€€€€€ì±…‰•°è€AËñ™É¡åÑ¡µÕÌœ°Ù…±Õ”è•Ñ•‰Ñ	…±…¹•¡•­5½‘•1…‰•°¡‘•‰Ð¤ô°(€€€€€ì±…‰•°è€1•ÑéÑ”‰™É…”œ°Ù…±Õ”è•Ñ1…Ñ•ÍÑ•‰Ñ	…±…¹•¡•¬¡‘•‰Ð°Ñ…É•Ñ5½¹Ñ ¤ü¹µ½¹Ñ €ü™½Éµ…Ñ5½¹Ñ¡1…‰•°¡•Ñ1…Ñ•ÍÑ•‰Ñ	…±…¹•¡•¬¡‘•‰Ð°Ñ…É•Ñ5½¹Ñ ¤¹µ½¹Ñ ¤€è€¹½ ­•¥¹”œô(€€€t¤¤ì((€€€½¹ÍÐ…µ½Õ¹Ñ%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡•á¥ÍÑ¥¹œ€ü•á¥ÍÑ¥¹œ¹…µ½Õ¹Ð€èÁÉ•Ù¥½ÕÍµ½Õ¹Ð¤ì(€€€½¹ÍÐ¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹½Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹½Ñ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€=ÁÑ¥½¹…°°è¸¸=¹±¥¹•Á½ÉÑ…°½‘•È	É¥•˜œì(€€€¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô•á¥ÍÑ¥¹œ€ü•á¥ÍÑ¥¹œ¹¹½Ñ”€è€œœì(€€€½¹ÍÐ™¥•±‘Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€™¥•±‘Ì¹±…ÍÍ9…µ”€ô€É½Üœì(€€€™¥•±‘Ì¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ­ÑÕ•±°…¹•é•¥Ñ•ÈM¡Õ±‘•¹ÍÑ…¹œ°…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€™¥•±‘Ì¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥è€¼EÕ•±±”œ°¹½Ñ•%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡™¥•±‘Ì¤ì((€€€Í¡½Ý5½‘…°¡M¡Õ±‘•¹ÍÑ…¹ÁËñ™•¸ƒ
Ü€‘í‘•‰Ð¹¹…µ”ñð€M¡Õ±õ€°½¹Ñ•¹Ð°l(€€€€€ì(€€€€€€€±…‰•°è€‰‰É•¡•¸œ°(€€€€€€€±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤(€€€€€ô°(€€€€€ì(€€€€€€€±…‰•°è€MÑ…¹ƒñ‰•É¹•¡µ•¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸M¡Õ±‘•¹ÍÑ…¹•¥¹•‰•¸¸œ¤ì(€€€€€€€€€½¹ÍÐÁÉ•Ù¥½ÕÍA±…¸€ô‰Õ¥±‘M¹½Ý‰…±±A±…¸¡ÕÉÉ•¹Ñ5½¹Ñ °€ÄÈÀ¤ì(€€€€€€€€€½¹ÍÐÁÉ¥½É¹ÑÉä€ô•á¥ÍÑ¥¹œñð¹Õ±°ì(€€€€€€€€€‘•‰Ð¹‰…±…¹•¡•­Ì€ô€¡‘•‰Ð¹‰…±…¹•¡•­Ìñðmt¤¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä¹µ½¹Ñ €„ôôÑ…É•Ñ5½¹Ñ ¤ì(€€€€€€€€€‘•‰Ð¹‰…±…¹•¡•­Ì¹ÁÕÍ ¡ì(€€€€€€€€€€€¥èÁÉ¥½É¹ÑÉä€˜˜ÁÉ¥½É¹ÑÉä¹¥€üÁÉ¥½É¹ÑÉä¹¥€è•¹•É…Ñ•% ¤°(€€€€€€€€€€€µ½¹Ñ èÑ…É•Ñ5½¹Ñ °(€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€ÁÉ•Ù¥½ÕÍµ½Õ¹ÐèÁÉ¥½É¹ÑÉä€ü9Õµ‰•È¡ÁÉ¥½É¹ÑÉä¹ÁÉ•Ù¥½ÕÍµ½Õ¹ÐñðÁÉ•Ù¥½ÕÍµ½Õ¹Ð¤€èÁÉ•Ù¥½ÕÍµ½Õ¹Ð°(€€€€€€€€€€€¹½Ñ”è¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤°(€€€€€€€€€€€É•…Ñ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€€€€€€€…ÁÁ±¥•‘Q½=Á•¹	…±…¹”èÑÉÕ”(€€€€€€€€€ô¤ì(€€€€€€€€€‘•‰Ð¹‰…±…¹•¡•­Ì¹Í½ÉÐ ¡„°ˆ¤€ôø„¹µ½¹Ñ ¹±½…±•½µÁ…É”¡ˆ¹µ½¹Ñ ¤¤ì(€€€€€€€€€‘•‰Ð¹…µ½Õ¹Ñ=Á•¸€ô…µ½Õ¹Ðì(€€€€€€€€€¥˜€¡…µ½Õ¹Ð€ðô€À¤‘•‰Ð¹½µÁ±•Ñ•‘5½¹Ñ €ôÑ…É•Ñ5½¹Ñ ì(€€€€€€€€€•±Í”‘•±•Ñ”‘•‰Ð¹½µÁ±•Ñ•‘5½¹Ñ ì(€€€€€€€€€½¹ÍÐ‘¥™™•É•¹”€ô…µ½Õ¹Ð€´ÁÉ•Ù¥½ÕÍµ½Õ¹Ðì(€€€€€€€€€½¹ÍÐ‘¥™™•É•¹•Q•áÐ€ô5…Ñ ¹…‰Ì¡‘¥™™•É•¹”¤€ðô€À¸ÀÀÔ(€€€€€€€€€€€€ü€½¡¹”‰Ý•¥¡Õ¹œœ(€€€€€€€€€€€€è€‘í‘¥™™•É•¹”€ø€À€ü€œ¬œ€è€œô‘í•ÕÉ¼¡‘¥™™•É•¹”¥ô‰Ý•¥¡Õ¹€ì(€€€€€€€€€…‘‘¡…¹•1½œ M¡Õ±‘•¸œ°€‘í‘•‰Ð¹¹…µ”ñð€M¡Õ±ôèMÑ…¹›ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡Ñ…É•Ñ5½¹Ñ ¥ô…Õ˜€‘í•ÕÉ¼¡…µ½Õ¹Ð¥ô‰•ÍÓ‘Ñ¥Ð€ ‘í‘¥™™•É•¹•Q•áÑô¥€°Ñ…É•Ñ5½¹Ñ ¤ì(€€€€€€€€€É•…±Õ±…Ñ••‰ÑA±…¹¹¥¹™Ñ•É	…±…¹•¡…¹”¡‘•‰Ð°Ñ…É•Ñ5½¹Ñ °ì(€€€€€€€€€€€ÁÉ•Ù¥½ÕÍA±…¸°(€€€€€€€€€€€ÁÉ•Ù¥½ÕÍµ½Õ¹Ð°(€€€€€€€€€€€¹•áÑµ½Õ¹Ðè…µ½Õ¹Ð(€€€€€€€€€ô¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•É•‰Ñ	…±…¹•I•Ù¥•Ý…É¡µ½¹Ñ¡-•ä€ôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ…Ñ¥Ù••‰ÑÌ€ô€¡ÍÑ…Ñ”¹‘•‰ÑÌñðmt¤¹™¥±Ñ•È ¡‘•‰Ð¤€ôø9Õµ‰•È¡‘•‰Ð€˜˜‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ø€À¤ì(€€€¥˜€ ……Ñ¥Ù••‰ÑÌ¹±•¹Ñ ¤É•ÑÕÉ¸¹Õ±°ì(€€€…Ñ¥Ù••‰ÑÌ¹™½É… ¡•¹ÍÕÉ••‰Ñ½¹™¥œ¤ì(€€€½¹ÍÐ‘Õ••‰ÑÌ€ô•ÑÕ••‰Ñ	…±…¹•¡•­Ì¡µ½¹Ñ¡-•ä¤ì(€€€½¹ÍÐµ½¹Ñ¡±åÕ”€ô‘Õ••‰ÑÌ¹™¥±Ñ•È ¡‘•‰Ð¤€ôø‘•‰Ð¹‰…±…¹•¡•­5½‘”€ôôô€µ½¹Ñ¡±äœ¤ì(€€€½¹ÍÐ…¹¹Õ…±Õ”€ô‘Õ••‰ÑÌ¹™¥±Ñ•È ¡‘•‰Ð¤€ôø‘•‰Ð¹‰…±…¹•¡•­5½‘”€„ôô€µ½¹Ñ¡±äœ¤ì((€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€ÍÕˆµ…É‘•‰Ðµ‰…±…¹”µÉ•Ù¥•Üµ…Éœì(€€€½¹ÍÐ¡•…€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•…¹±…ÍÍ9…µ”€ô€½µÁ…ÐµÍ•Ñ¥½¸µ¡•…œì(€€€¡•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€M¡Õ±‘•¹ÍÓ‘¹‘”ÁËñ™•¸œ¤¤ì(€€€¡•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°µ½¹Ñ¡±åÕ”¹±•¹Ñ €ü€Á¥±°Ý…É¹¥¹œœ€è€¡…¹¹Õ…±Õ”¹±•¹Ñ €ü€Á¥±°œ€è€Á¥±°ÍÕ•ÍÌœ¤°µ½¹Ñ¡±åÕ”¹±•¹Ñ €ü€‘íµ½¹Ñ¡±åÕ”¹±•¹Ñ¡ôµ½¹…Ñ±¥ ›‘±±¥€€è€¡…¹¹Õ…±Õ”¹±•¹Ñ €ü€«‘¡É±¥¡”AËñ™Õ¹œœ€è€…­ÑÕ•±°œ¤¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡¡•…¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€5½¹…Ñ±¥¡”‰™É…•¸ÍÑ•¡•¸‘¥É•­Ð¡¥•È¸+‘¡É±¥¡”AËñ™Õ¹•¸Í¥¹•ÑÉ•¹¹Ð‘…ÉÕ¹Ñ•È¸œ¤¤ì((€€€¥˜€¡µ½¹Ñ¡±åÕ”¹±•¹Ñ ¤ì(€€€€€½¹ÍÐµ½¹Ñ¡±å1¥ÍÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€µ½¹Ñ¡±å1¥ÍÐ¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•Üµ±¥ÍÐœì(€€€€€µ½¹Ñ¡±åÕ”¹™½É…  ¡‘•‰Ð¤€ôøµ½¹Ñ¡±å1¥ÍÐ¹…ÁÁ•¹‘¡¥±¡É•…Ñ••‰Ñ	…±…¹•I•Ù¥•ÝI½Ü¡‘•‰Ð°µ½¹Ñ¡-•ä¤¤¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡µ½¹Ñ¡±å1¥ÍÐ¤ì(€€€ô•±Í”¥˜€ ……¹¹Õ…±Õ”¹±•¹Ñ ¤ì(€€€€€½¹ÍÐ‘½¹”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€‘½¹”¹±…ÍÍ9…µ”€ô€¹½Ñ¥”ÍÕ•ÍÌœì(€€€€€‘½¹”¹Ñ•áÑ½¹Ñ•¹Ð€ô€ñÈ‘¥•Í•¸5½¹…Ð¥ÍÐ­•¥¹”Ý•¥Ñ•É”M¡Õ±‘•¹ÍÑ…¹‘Í…‰™É…”»ÙÑ¥œ¸œì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡‘½¹”¤ì(€€€ô((€€€¥˜€¡…¹¹Õ…±Õ”¹±•¹Ñ ¤ì(€€€€€½¹ÍÐ…¹¹Õ…±1¥ÍÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€…¹¹Õ…±1¥ÍÐ¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•Üµ±¥ÍÐœì(€€€€€…¹¹Õ…±Õ”¹™½É…  ¡‘•‰Ð¤€ôø…¹¹Õ…±1¥ÍÐ¹…ÁÁ•¹‘¡¥±¡É•…Ñ••‰Ñ	…±…¹•I•Ù¥•ÝI½Ü¡‘•‰Ð°µ½¹Ñ¡-•ä¤¤¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ••‰Ñ•Ñ…¥±Ì¡+‘¡É±¥¡”MÑ…¹‘ÁËñ™Õ¹•¸ƒ
Ü€‘í…¹¹Õ…±Õ”¹±•¹Ñ¡õ€°…¹¹Õ…±1¥ÍÐ¤¤ì(€€€ô(€€€É•ÑÕÉ¸…Éì(€ô((€™Õ¹Ñ¥½¸É•…Ñ••‰Ñ	…±…¹•I•Ù¥•ÝI½Ü¡‘•‰Ð°µ½¹Ñ¡-•ä¤ì(€€€€€½¹ÍÐÉ½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€É½Ü¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•ÜµÉ½Üœì(€€€€€½¹ÍÐ¥¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€¥¹™¼¹±…ÍÍ9…µ”€ô€‘•‰Ðµ‰…±…¹”µÉ•Ù¥•Üµ½Áäœì(€€€€€½¹ÍÐ¹…µ”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÑÉ½¹œœ¤ì(€€€€€¹…µ”¹Ñ•áÑ½¹Ñ•¹Ð€ô‘•‰Ð¹¹…µ”ñð€M¡Õ±œì(€€€€€½¹ÍÐ±…Ñ•ÍÐ€ô•Ñ1…Ñ•ÍÑ•‰Ñ	…±…¹•¡•¬¡‘•‰Ð°µ½¹Ñ¡-•ä¤ì(€€€€€½¹ÍÐ±…ÍÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Íµ…±°œ¤ì(€€€€€±…ÍÐ¹±…ÍÍ9…µ”€ô€µÕÑ•œì(€€€€€±…ÍÐ¹Ñ•áÑ½¹Ñ•¹Ð€ô±…Ñ•ÍÐ(€€€€€€€€üiÕ±•ÑéÐ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡±…Ñ•ÍÐ¹µ½¹Ñ ¥ôƒ
Ü€‘í•ÕÉ¼¡±…Ñ•ÍÐ¹…µ½Õ¹Ð¥õ€(€€€€€€€€è9½ ¹¥”•ÁËñ™Ðƒ
Ü…­ÑÕ•±°•Á±…¹Ð€‘í•ÕÉ¼¡9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤¥õ€ì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡¹…µ”¤ì(€€€€€¥¹™¼¹…ÁÁ•¹‘¡¥±¡±…ÍÐ¤ì((€€€€€½¹ÍÐµ½‘•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€€€µ½‘•M•±•Ð¹Í•ÑÑÑÉ¥‰ÕÑ” …É¥„µ±…‰•°œ°AËñ™É¡åÑ¡µÕÌ›ñÈ€‘í‘•‰Ð¹¹…µ”ñð€M¡Õ±õ€¤ì(€€€€€l(€€€€€€€lµ½¹Ñ¡±äœ°€5½¹…Ñ±¥ ƒ
ÜMÑ…¹•¥¹Í•¡‰…Èt°(€€€€€€€l…¹¹Õ…°œ°€+‘¡É±¥ ƒ
Ü¹¥¡Ð±…Õ™•¹•¥¹Í•¡‰…Èt(€€€€€t¹™½É…  ¡mÙ…±Õ”°±…‰•±t¤€ôøì(€€€€€€€½¹ÍÐ½ÁÑ¥½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€€€½ÁÑ¥½¸¹Ù…±Õ”€ôÙ…±Õ”ì(€€€€€€€½ÁÑ¥½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô±…‰•°ì(€€€€€€€½ÁÑ¥½¸¹Í•±•Ñ•€ô‘•‰Ð¹‰…±…¹•¡•­5½‘”€ôôôÙ…±Õ”ì(€€€€€€€µ½‘•M•±•Ð¹…ÁÁ•¹‘¡¥±¡½ÁÑ¥½¸¤ì(€€€€€ô¤ì(€€€€€µ½‘•M•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€€€‘•‰Ð¹‰…±…¹•¡•­5½‘”€ôµ½‘•M•±•Ð¹Ù…±Õ”€ôôô€µ½¹Ñ¡±äœ€ü€µ½¹Ñ¡±äœ€è€…¹¹Õ…°œì(€€€€€€€…‘‘¡…¹•1½œ M¡Õ±‘•¸œ°€‘í‘•‰Ð¹¹…µ”ñð€M¡Õ±ôèMÑ…¹‘ÁËñ™Õ¹œ…Õ˜€‘í‘•‰Ð¹‰…±…¹•¡•­5½‘”€ôôô€µ½¹Ñ¡±äœ€ü€µ½¹…Ñ±¥ œ€è€«‘¡É±¥ ô•Í•ÑéÑ€°µ½¹Ñ¡-•ä¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì((€€€€€½¹ÍÐ¡•­	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€¡•­	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€¡•­	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€€€¡•­	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€MÑ…¹•¥¹ÑÉ…•¸œì(€€€€€¡•­	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½Ý•‰Ñ	…±…¹•¡•­‘¥Ñ½È¡‘•‰Ð°µ½¹Ñ¡-•ä¤¤ì((€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡¥¹™¼¤ì(€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡µ½‘•M•±•Ð¤ì(€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡¡•­	Ñ¸¤ì(€€€€€É•ÑÕÉ¸É½Üì(€ô((€™Õ¹Ñ¥½¸É•¹‘•É•‰ÑÌ ¤ì(€€€‘•‰ÑÍM•Ñ¥½¸¹¥¹¹•É!Q50€ô€œœì(€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€½¹ÍÐ¡•…‘•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•…‘•È¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ…‘‘	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€…‘‘	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ¬9•Õ”M¡Õ±œì(€€€…‘‘	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€…‘‘	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€Í¡½Ý•‰Ñ‘¥Ñ½È ¤ì(€€€ô¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Èœ°€œœ°€M¡Õ±‘•¸œ¤¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°€Á¥±°œ°™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¤¤¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡…‘‘	Ñ¸¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡¡•…‘•È¤ì((€€€±•ÐÑ½Ñ…±•‰ÑMÕ´€ô€Àì(€€€±•Ð…Ñ¥Ù••‰ÑÌ€ô€Àì(€€€ÍÑ…Ñ”¹‘•‰ÑÌ¹™½É…  ¡¤€ôøì(€€€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡¤ì(€€€€€½¹ÍÐ½Á•¹µ½Õ¹Ð€ô9Õµ‰•È¡¹…µ½Õ¹Ñ=Á•¸ñð€À¤ì(€€€€€Ñ½Ñ…±•‰ÑMÕ´€¬ô½Á•¹µ½Õ¹Ðì(€€€€€¥˜€¡½Á•¹µ½Õ¹Ð€ø€À¤…Ñ¥Ù••‰ÑÌ€¬ô€Äì(€€€ô¤ì(€€€½¹ÍÐ•ÍÑ¥µ…Ñ•‘•‰ÑÉ•”€ôÍÑ…Ñ”¹‘•‰ÑÌ(€€€€€€¹™¥±Ñ•È ¡¤€ôø9Õµ‰•È¡¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ø€À€˜˜¹Á…åµ•¹ÑQåÁ”€ôôô€¥¹ÍÑ…±±µ•¹Ðœ€˜˜•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡°ÕÉÉ•¹Ñ5½¹Ñ ¤€ø€À¤(€€€€€€¹µ…À ¡¤€ôø•ÍÑ¥µ…Ñ••‰Ñ¹‘5½¹Ñ ¡¤¤(€€€€€€¹™¥±Ñ•È¡	½½±•…¸¤(€€€€€€¹Í½ÉÐ ¤(€€€€€€¹Á½À ¤ñð€œ´œì(€€€½¹ÍÐÍ¹½Ý‰…±°€ô‰Õ¥±‘M¹½Ý‰…±±A±…¸¡ÕÉÉ•¹Ñ5½¹Ñ °€ÄÈÀ¤ì(€€€½¹ÍÐÕÉÉ•¹ÑM¹½Ý‰…±±I½Ü€ô€¡Í¹½Ý‰…±°¹É½ÝÌñðmt¤¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹µ½¹Ñ €ôôôÕÉÉ•¹Ñ5½¹Ñ ¤ñð€¡Í¹½Ý‰…±°¹É½ÝÌñðmt¥lÁtñð¹Õ±°ì(€€€½¹ÍÐÕÉÉ•¹Ñ•‰ÑA±…¸€ô¹•Ü5…À ¤ì(€€€¥˜€¡ÕÉÉ•¹ÑM¹½Ý‰…±±I½Ü€˜˜ÉÉ…ä¹¥ÍÉÉ…ä¡ÕÉÉ•¹ÑM¹½Ý‰…±±I½Ü¹Á…åµ•¹ÑÌ¤¤ì(€€€€€ÕÉÉ•¹ÑM¹½Ý‰…±±I½Ü¹Á…åµ•¹ÑÌ¹™½É…  ¡Á…åµ•¹Ð¤€ôøì(€€€€€€€½¹ÍÐ¹…µ”€ôÁ…åµ•¹Ð¹‘•‰Ðñð€U¹‰•­…¹¹Ðœì(€€€€€€€¥˜€ …ÕÉÉ•¹Ñ•‰ÑA±…¸¹¡…Ì¡¹…µ”¤¤ì(€€€€€€€€€ÕÉÉ•¹Ñ•‰ÑA±…¸¹Í•Ð¡¹…µ”°ìÉ…Ñ”è€À°Í¹½Ý‰…±°è€À°Á±…¹¹•è€À°‰Õ‘•Ðè€À°™Õ±±A…å½™˜è™…±Í”°¹½Ñ•Ìèmtô¤ì(€€€€€€€ô(€€€€€€€½¹ÍÐ¥Ñ•´€ôÕÉÉ•¹Ñ•‰ÑA±…¸¹•Ð¡¹…µ”¤ì(€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤ì(€€€€€€€½¹ÍÐ‰Õ‘•Ñµ½Õ¹Ð€ô9Õµ‰•È¡Á…åµ•¹Ð¹‰Õ‘•Ñµ½Õ¹Ð€„ô¹Õ±°€üÁ…åµ•¹Ð¹‰Õ‘•Ñµ½Õ¹Ð€è…µ½Õ¹Ð¤ì(€€€€€€€¥Ñ•´¹Á±…¹¹•€¬ô…µ½Õ¹Ðì(€€€€€€€¥Ñ•´¹‰Õ‘•Ð€¬ô‰Õ‘•Ñµ½Õ¹Ðì(€€€€€€€¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€É…Ñ”œ¤¥Ñ•´¹É…Ñ”€¬ô…µ½Õ¹Ðì(€€€€€€€•±Í”¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€Í¹½Ý‰…±°œñðÁ…åµ•¹Ð¹ÑåÁ”€ôôô€‰Õ‘•Ñ}•áÑÉ„œ¤¥Ñ•´¹Í¹½Ý‰…±°€¬ô…µ½Õ¹Ðì(€€€€€€€•±Í”¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€™Õ±±}Á…å½™˜œ¤ì(€€€€€€€€€¥Ñ•´¹É…Ñ”€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹É…Ñ•µ½Õ¹Ðñð€À¤ì(€€€€€€€€€¥Ñ•´¹Í¹½Ý‰…±°€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹Í¹½Ý‰…±±µ½Õ¹Ðñð€À¤ì(€€€€€€€€€¥Ñ•´¹™Õ±±A…å½™˜€ôÑÉÕ”ì(€€€€€€€ô(€€€€€€€¥˜€¡Á…åµ•¹Ð¹¹½Ñ”¤¥Ñ•´¹¹½Ñ•Ì¹ÁÕÍ ¡Á…åµ•¹Ð¹¹½Ñ”¤ì(€€€€€ô¤ì(€€€ô((€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€I•ÍÑÍ¡Õ±•Í…µÐœ°Ù…±Õ”è•ÕÉ¼¡Ñ½Ñ…±•‰ÑMÕ´¤°­¥¹èÑ½Ñ…±•‰ÑMÕ´€ø€À€ü€‘…¹•Èœ€è€ÍÕ•ÍÌœô°(€€€€€ì±…‰•°è€­Ñ¥Ù”M¡Õ±‘•¸œ°Ù…±Õ”èMÑÉ¥¹œ¡…Ñ¥Ù••‰ÑÌ¤ô°(€€€€€ì±…‰•°è€M¡Õ±‘•¹™É•¤¹… Y½ÉÍ¡±…œœ°Ù…±Õ”èÍ¹½Ý‰…±°¹‘•‰ÑÉ••5½¹Ñ €ü™½Éµ…Ñ5½¹Ñ¡1…‰•°¡Í¹½Ý‰…±°¹‘•‰ÑÉ••5½¹Ñ ¤€è€¡•ÍÑ¥µ…Ñ•‘•‰ÑÉ•”€ôôô€œ´œ€ü€œ´œ€è™½Éµ…Ñ5½¹Ñ¡1…‰•°¡•ÍÑ¥µ…Ñ•‘•‰ÑÉ•”¤¤ô(€€€t¤¤ì(€€€½¹ÍÐ‘•‰Ñ	Õ‘•ÑI½Ü€ô€¡Í¹½Ý‰…±°¹É½ÝÌñðmt¤¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹µ½¹Ñ €ôôôÕÉÉ•¹Ñ5½¹Ñ €˜˜9Õµ‰•È¡É½Ü¹µ½¹Ñ¡±åQ…É•Ðñð€À¤€ø€À¤ì(€€€¥˜€¡‘•‰Ñ	Õ‘•ÑI½Ü¤ì(€€€€€½¹ÍÐ‰Õ‘•ÑMÕµµ…Éä€ôÉ•…Ñ•U¥° ‘¥Øœ°€ÍÕˆµ…É‘•‰Ðµ‰Õ‘•ÐµÅÕ¥¬µÍÕµµ…Éäœ¤ì(€€€€€½¹ÍÐ™¥á•‘•‰ÑA½½°€ô9Õµ‰•È¡‘•‰Ñ	Õ‘•ÑI½Ü¹™¥á•‘5½¹Ñ¡±åQ…É•Ð€„ô¹Õ±°€ü‘•‰Ñ	Õ‘•ÑI½Ü¹™¥á•‘5½¹Ñ¡±åQ…É•Ð€è‘•‰Ñ	Õ‘•ÑI½Ü¹µ½¹Ñ¡±åQ…É•Ðñð€À¤ì(€€€€€½¹ÍÐÍÑ…¹‘…É‘I…Ñ•=Ù•É…”€ôÉ½Õ¹‘5½¹•ä¡5…Ñ ¹µ…à À°9Õµ‰•È¡‘•‰Ñ	Õ‘•ÑI½Ü¹‰…Í”ñð€À¤€´™¥á•‘•‰ÑA½½°¤¤ì(€€€€€‰Õ‘•ÑMÕµµ…Éä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°M¡Õ±‘•¹‰Õ‘•Ðƒ
Ü€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€¤¤ì(€€€€€‰Õ‘•ÑMÕµµ…Éä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€€€ì±…‰•°è€œàÀÀ·Š
°µÉÕ¹‘Á½½°œ°Ù…±Õ”è•ÕÉ¼¡‘•‰Ñ	Õ‘•ÑI½Ü¹™¥á•‘5½¹Ñ¡±åQ…É•Ð€„ô¹Õ±°€ü‘•‰Ñ	Õ‘•ÑI½Ü¹™¥á•‘5½¹Ñ¡±åQ…É•Ð€è‘•‰Ñ	Õ‘•ÑI½Ü¹µ½¹Ñ¡±åQ…É•Ð¤°­¥¹è€ÍÕ•ÍÌœô°(€€€€€€€ì±…‰•°è€iÕÍ…Ñè…ÕÌ¥¹­½µµ•¸œ°Ù…±Õ”è•ÕÉ¼¡‘•‰Ñ	Õ‘•ÑI½Ü¹¥¹½µ•1¥¹­•‘áÑÉ„ñð€À¤ô°(€€€€€€€ì±…‰•°è€MÑ…¹‘…É‘É…Ñ•¸•Á±…¹Ðœ°Ù…±Õ”è•ÕÉ¼¡‘•‰Ñ	Õ‘•ÑI½Ü¹‰…Í”ñð€À¤ô°(€€€€€€€ì±…‰•°è€M½¹‘•ÉÑ¥±Õ¹œÙ½É•Í¡±…•¸œ°Ù…±Õ”è•ÕÉ¼¡‘•‰Ñ	Õ‘•ÑI½Ü¹•áÑÉ„ñð€À¤°­¥¹è9Õµ‰•È¡‘•‰Ñ	Õ‘•ÑI½Ü¹•áÑÉ„ñð€À¤€ø€À€ü€Ý…É¹¥¹œœ€è€œœô°(€€€€€€€ì±…‰•°è€9½ ¹¥¡ÐÙ•ÉÁ±…¹Ðœ°Ù…±Õ”è•ÕÉ¼¡‘•‰Ñ	Õ‘•ÑI½Ü¹Õ¹…±±½…Ñ•‘	Õ‘•Ðñð€À¤ô(€€€€€t¤¤ì(€€€€€‰Õ‘•ÑMÕµµ…Éä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°Íµ…±°€‘íÍÑ…¹‘…É‘I…Ñ•=Ù•É…”€ø€À¸ÀÀÔ€ü€‘•‰Ðµ‰Õ‘•Ðµ½Ù•ÉÉÕ¸œ€è€µÕÑ•õ€°ÍÑ…¹‘…É‘I…Ñ•=Ù•É…”€ø€À¸ÀÀÔ(€€€€€€€€ü¥”™•ÍÐ•¥¹•Á±…¹Ñ•¸MÑ…¹‘…É‘É…Ñ•¸±¥••¸€‘í•ÕÉ¼¡ÍÑ…¹‘…É‘I…Ñ•=Ù•É…”¥ôƒñ‰•È‘•´€àÀÀ·Š
°µÉÕ¹‘Á½½°¸•Í¡…±ˆ¥ÍÐ¥´ÉÕ¹‘Á½½°¹¥¡ÑÌéÕÏ‘Ñé±¥ Ù•É›ñ‰…Èì‘¥”ÁÀ£‘±Ð™•ÍÑ”I…Ñ•¸Õ¹M½¹‘•ÉÑ¥±Õ¹œ•ÑÉ•¹¹Ð¹€(€€€€€€€€è€•ÈY½ÉÍ¡±…œ£‘±Ð™•ÍÑ”I…Ñ•¸•ÑÉ•¹¹ÐÙ½¸M½¹‘•ÉÑ¥±Õ¹•¸¸ƒŠy9½ ¹¥¡ÐÙ•ÉÁ±…¹ÓŠp¥ÍÐ•¥¸I•¡•¹É•ÍÐ¥´M¡Õ±‘•¹Á½½°°­•¥¸-½¹Ñ½ÍÑ…¹¸œ¤¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡‰Õ‘•ÑMÕµµ…Éä¤ì(€€€ô(€€€½¹ÍÐ±…É¥™¥…Ñ¥½¹…É€ôÉ•¹‘•É•‰Ñ±…É¥™¥…Ñ¥½¹…É¡ÕÉÉ•¹Ñ5½¹Ñ °Í¹½Ý‰…±°¤ì(€€€¥˜€¡±…É¥™¥…Ñ¥½¹…É¤…É¹…ÁÁ•¹‘¡¥±¡±…É¥™¥…Ñ¥½¹…É¤ì(€€€½¹ÍÐµ½¹Ñ¡±åÍÍ¥ÍÑ…¹Ñ…É€ôÉ•¹‘•É•‰Ñ5½¹Ñ¡±åÍÍ¥ÍÑ…¹Ñ…É¡ÕÉÉ•¹Ñ5½¹Ñ °Í¹½Ý‰…±°¤ì(€€€¥˜€¡µ½¹Ñ¡±åÍÍ¥ÍÑ…¹Ñ…É¤…É¹…ÁÁ•¹‘¡¥±¡µ½¹Ñ¡±åÍÍ¥ÍÑ…¹Ñ…É¤ì(€€€½¹ÍÐ™¥á•‘	Õ‘•ÑMÕ•ÍÑ¥½¹…É€ôÉ•¹‘•É5½¹Ñ¡±å•‰Ñ	Õ‘•ÑMÕ•ÍÑ¥½¹…É¡ÕÉÉ•¹Ñ5½¹Ñ °Í¹½Ý‰…±°¤ì(€€€¥˜€¡™¥á•‘	Õ‘•ÑMÕ•ÍÑ¥½¹…É¤ì(€€€€€½¹ÍÐÑ…É•Ñ5½¹Ñ €ôÕÉÉ•¹Ñ5½¹Ñ €ðÍ¹½Ý‰…±±½¹™¥œ¹µ½¹Ñ¡±åQ…É•ÑMÑ…ÉÑ5½¹Ñ (€€€€€€€€üÍ¹½Ý‰…±±½¹™¥œ¹µ½¹Ñ¡±åQ…É•ÑMÑ…ÉÑ5½¹Ñ (€€€€€€€€èÕÉÉ•¹Ñ5½¹Ñ ì(€€€€€½¹ÍÐÍÕ•ÍÑ¥½¹I½Ü€ô€¡Í¹½Ý‰…±°¹É½ÝÌñðmt¤¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹µ½¹Ñ €ôôôÑ…É•Ñ5½¹Ñ €˜˜9Õµ‰•È¡É½Ü¹µ½¹Ñ¡±åQ…É•Ðñð€À¤€ø€À¤ì(€€€€€½¹ÍÐÍÕ•ÍÑ¥½¹MÕµµ…Éä€ôiÕÍ…ÑéÑ¥±Õ¹ÍÙ½ÉÍ¡³‘”ƒ
Ü€‘í•ÕÉ¼¡ÍÕ•ÍÑ¥½¹I½Ü€üÍÕ•ÍÑ¥½¹I½Ü¹•áÑÉ„ñð€À€è€À¥õ€ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ••‰Ñ•Ñ…¥±Ì¡ÍÕ•ÍÑ¥½¹MÕµµ…Éä°™¥á•‘	Õ‘•ÑMÕ•ÍÑ¥½¹…É¤¤ì(€€€ô(€€€½¹ÍÐ™½É•…ÍÑ•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€™½É•…ÍÑ•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€‘•‰Ðµ™½É•…ÍÐµ‘•Ñ…¥±Ìµ½¹Ñ•¹Ðœì(€€€¥˜€¡Í¹½Ý‰…±°€˜˜Í¹½Ý‰…±°¹É½ÝÌ€˜˜Í¹½Ý‰…±°¹É½ÝÌ¹±•¹Ñ ¤ì(€€€€€™½É•…ÍÑ•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡É•¹‘•É•‰ÑÉ••½É•…ÍÑ…É¡Í¹½Ý‰…±°°ÕÉÉ•¹Ñ5½¹Ñ ¤¤ì(€€€ô(€€€½¹ÍÐ™Õ±±A…å½™™I•Í•ÉÙ•…É€ôÕÉÉ•¹Ñ5½¹Ñ €ðÍ¹½Ý‰…±±½¹™¥œ¹µ½¹Ñ¡±åQ…É•ÑMÑ…ÉÑ5½¹Ñ (€€€€€€üÉ•¹‘•ÉÕ±±A…å½™™I•Í•ÉÙ•…É¡ÕÉÉ•¹Ñ5½¹Ñ °Í¹½Ý‰…±°¤(€€€€€€è¹Õ±°ì(€€€¥˜€¡™Õ±±A…å½™™I•Í•ÉÙ•…É¤™½É•…ÍÑ•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡™Õ±±A…å½™™I•Í•ÉÙ•…É¤ì(€€€½¹ÍÐÍ¹½Ý‰…±±…É€ôÉ•¹‘•ÉM¹½Ý‰…±±A±…¹…É¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€¥˜€¡Í¹½Ý‰…±±…É¤™½É•…ÍÑ•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡Í¹½Ý‰…±±…É¤ì(€€€¥˜€¡™½É•…ÍÑ•Ñ…¥±Ì¹¡¥±‘É•¸¹±•¹Ñ ¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ••‰Ñ•Ñ…¥±Ì AÉ½¹½Í”Õ¹Q¥±Õ¹ÍÝ•œœ°™½É•…ÍÑ•Ñ…¥±Ì¤¤ì(€€€ô((€€€±•ÐÙ¥Í¥‰±••‰ÑÌ€ôÍÑ…Ñ”¹‘•‰ÑÌ¹™¥±Ñ•È ¡¤€ôøÍ¡½Õ±‘M¡½Ý•‰Ñ%¹5½¹Ñ ¡°ÕÉÉ•¹Ñ5½¹Ñ ¤¤ì(€€€Ù¥Í¥‰±••‰ÑÌ€ôÙ¥Í¥‰±••‰ÑÌ¹™¥±Ñ•È ¡¤€ôøì(€€€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡¤ì(€€€€€¥˜€ …µ…Ñ¡•ÍM•…É¡Q•áÐ¡¹¹…µ”°‘•‰ÑM•…É ¤¤É•ÑÕÉ¸™…±Í”ì(€€€€€½¹ÍÐÁ…¥‘µ½Õ¹Ð€ô•Ñ•‰Ñ½Ù•É•‘µ½Õ¹Ñ½É5½¹Ñ ¡°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€¥˜€¡‘•‰Ñ¥±Ñ•È€ôôô€…±°œ¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€¥˜€¡‘•‰Ñ¥±Ñ•È€ôôô€‘Õ”œ¤É•ÑÕÉ¸¥Í•‰Ñ=Á•¹½É5½¹Ñ ¡°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€¥˜€¡‘•‰Ñ¥±Ñ•È€ôôô€Á…¥œ¤É•ÑÕÉ¸Á…¥‘µ½Õ¹Ð€ø€Àñð¹Á…¥‘5½¹Ñ¡Ì¹¥¹±Õ‘•Ì¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€¥˜€¡‘•‰Ñ¥±Ñ•È€ôôô€‘½¹”œ¤É•ÑÕÉ¸9Õµ‰•È¡¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ðô€Àì(€€€€€É•ÑÕÉ¸9Õµ‰•È¡¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ø€ÀñðÁ…¥‘µ½Õ¹Ð€ø€Àì(€€€ô¤ì((€€€½¹ÍÐ‘•‰Ñ1¥ÍÑ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€‘•‰Ñ1¥ÍÑ½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€‘•‰Ðµ±¥ÍÐµ‘•Ñ…¥±Ìµ½¹Ñ•¹Ðœì(€€€‘•‰Ñ1¥ÍÑ½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡µ…­•M•…É¡¥±Ñ•É	…È¡‘•‰ÑM•…É °‘•‰Ñ¥±Ñ•È°€¡Ø¤€ôøì‘•‰ÑM•…É €ôØìô°€¡Ø¤€ôøì‘•‰Ñ¥±Ñ•È€ôØìô°ml…Ñ¥Ù”œ°1…Õ™•¹‘”t±l‘Õ”œ°9ÕÈ›‘±±¥œt±lÁ…¥œ°¥•Í•¸5½¹…Ð‰•é…¡±Ðt±l‘½¹”œ°É±•‘¥Ñ”t±l…±°œ°±±”ut¤¤ì(€€€‘•‰Ñ1¥ÍÑ½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥”MÑ…¹‘…É‘…¹Í¥¡Ðé•¥Ð¹ÕÈ±…Õ™•¹‘”M¡Õ±‘•¸¸É±•‘¥Ñ”‰±•¥‰•¸ƒñ‰•ÈƒŠyÉ±•‘¥Ñ—Šp½‘•ÈƒŠy±±—Šp…Õ™™¥¹‘‰…È¸œ¤¤ì((€€€¥˜€¡Ù¥Í¥‰±••‰ÑÌ¹±•¹Ñ €ôôô€À¤ì(€€€€€½¹ÍÐÀ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€€€À¹Ñ•áÑ½¹Ñ•¹Ð€ôÍÑ…Ñ”¹‘•‰ÑÌ¹±•¹Ñ €ôôô€À(€€€€€€€€ü€-•¥¹”M¡Õ±‘•¸•¥¹•ÑÉ…•¸¸œ(€€€€€€€€è€-•¥¹”…­Ñ¥Ù•¸½‘•È¥¸‘¥•Í•´5½¹…Ð…‰•Í¡±½ÍÍ•¹•¸M¡Õ±‘•¸Í¥¡Ñ‰…È¸œì(€€€€€‘•‰Ñ1¥ÍÑ½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡À¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”œì(€€€€€½¹ÍÐÑ¡•…€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ¡•…œ¤ì(€€€€€Ñ¡•…¹¥¹¹•É!Q50€ô€ñÑÈøñÑ ù9…µ”ð½Ñ øñÑ ±…ÍÌô‰…½Õ¹Ðµ½¹±äˆù-½¹Ñ¼ð½Ñ øñÑ ù=™™•¸ð½Ñ øñÑ ùMÑ…¹‘…É‘É…Ñ”ð½Ñ øñÑ ø¬Y½ÉÍ¡±…œð½Ñ øñÑ ù•Á±…¹Ð‘¥•Í•¸5½¹…Ðð½Ñ øñÑ ù;‘¡ÍÑ”‘±±¥­•¥Ðð½Ñ øñÑ ùY½É…ÕÍÌ¸¹‘”ð½Ñ øñÑ ù½ÉÑÍ¡É¥ÑÐð½Ñ øñÑ ùMÑ…ÑÕÌð½Ñ øñÑ ù	•é…¡±Ðüð½Ñ øñÑ ù­Ñ¥½¸ð½Ñ øð½ÑÈù€ì(€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ¡•…¤ì((€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€Ù¥Í¥‰±••‰ÑÌ¹™½É…  ¡¤€ôøì(€€€€€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡¤ì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€½¹ÍÐ‘Õ•9½Ü€ô¥Í5½¹Ñ¡-•ä¡¹¹•áÑÕ•5½¹Ñ ¤€˜˜µ½¹Ñ¡¥™˜¡¹¹•áÑÕ•5½¹Ñ °ÕÉÉ•¹Ñ5½¹Ñ ¤€øô€Àì(€€€€€€€½¹ÍÐ¡¥ÍÑ½ÉåA…¥‘µ½Õ¹Ð€ô•Ñ•‰ÑA…åµ•¹Ñµ½Õ¹Ñ½É5½¹Ñ ¡°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€½¹ÍÐÁ…¥‘µ½Õ¹Ð€ô•Ñ•‰Ñ½Ù•É•‘µ½Õ¹Ñ½É5½¹Ñ ¡°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€½¹ÍÐµ½¹Ñ¡=Á•¹µ½Õ¹Ð€ô•Ñ•‰Ñ=Á•¹µ½Õ¹Ñ½É5½¹Ñ ¡°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€½¹ÍÐÁ…¥‘9½Ü€ôÁ…¥‘µ½Õ¹Ð€ø€À€˜˜µ½¹Ñ¡=Á•¹µ½Õ¹Ð€ðô€À¸ÀÀÔì(€€€€€€€½¹ÍÐ…¹I•Í•Ñ•‰ÑA…åµ•¹Ð€ô¹Á…¥‘5½¹Ñ¡Ì¹¥¹±Õ‘•Ì¡ÕÉÉ•¹Ñ5½¹Ñ ¤ñð¡¥ÍÑ½ÉåA…¥‘µ½Õ¹Ð€ø€Àì(€€€€€€€½¹ÍÐ•ÍÑ¥µ…Ñ•‘¹€ô•ÍÑ¥µ…Ñ••‰Ñ¹‘5½¹Ñ ¡¤ì(€€€€€€€½¹ÍÐ…ÑÕ…±5½¹Ñ €ô‘…Ñ•Q½5½¹Ñ¡-•ä¡¹•Ü…Ñ” ¤¤ì(€€€€€€€½¹ÍÐÁ…¥‘Q½Ñ…°€ô€¡¹Á…åµ•¹Ñ!¥ÍÑ½Éäñðmt¤¹É•‘Õ” ¡ÍÕ´°•¹ÑÉä¤€ôøÍÕ´€¬9Õµ‰•È¡•¹ÑÉä¹…µ½Õ¹Ðñð€À¤°€À¤ì(€€€€€€€½¹ÍÐÁÉ½É•ÍÍ	…Í”€ô9Õµ‰•È¡¹…µ½Õ¹Ñ=Á•¸ñð€À¤€¬Á…¥‘Q½Ñ…°ì(€€€€€€€½¹ÍÐÁÉ½É•ÍÌ€ôÁÉ½É•ÍÍ	…Í”€ø€À€ü5…Ñ ¹µ¥¸ ÄÀÀ°5…Ñ ¹É½Õ¹ ¡Á…¥‘Q½Ñ…°€¼ÁÉ½É•ÍÍ	…Í”¤€¨€ÄÀÀ¤¤€è€ÄÀÀì(€€€€€€€½¹ÍÐÁÉ½É•ÍÍ!Ñµ°€ô€ñ‘¥Ø±…ÍÌô‰‘•‰ÐµÁÉ½É•ÍÌˆøñ‘¥ØÍÑå±”ô‰Ý¥‘Ñ è‘íÁÉ½É•ÍÍô”ˆøð½‘¥Øøð½‘¥Øøñ‘¥Ø±…ÍÌô‰Íµ…±°µÕÑ•ˆø‘íÁÉ½É•ÍÍô€”ð½‘¥Øù€ì(€€€€€€€±•ÐÍÑ…ÑÕÍ!Ñµ°€ô€œñÍÁ…¸±…ÍÌô‰Á¥±°ˆùA±…¸ð½ÍÁ…¸øœì(€€€€€€€¥˜€¡9Õµ‰•È¡¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ðô€À¤ÍÑ…ÑÕÍ!Ñµ°€ô€œñÍÁ…¸±…ÍÌô‰Á¥±°ÍÕ•ÍÌˆùÉ±•‘¥Ðð½ÍÁ…¸øœì(€€€€€€€•±Í”¥˜€¡¹Á…åµ•¹ÑQåÁ”€ôôô€½Á•¹}Á±…¸œ¤ÍÑ…ÑÕÍ!Ñµ°€ô€œñÍÁ…¸±…ÍÌô‰Á¥±°Ý…É¹¥¹œˆùI…Ñ•¹Á±…¸½™™•¸ð½ÍÁ…¸øœì(€€€€€€€•±Í”¥˜€¡¹Á…åµ•¹ÑQåÁ”€ôôô€½¹•}Ñ¥µ”œ€˜˜‘Õ•9½Ü¤ÍÑ…ÑÕÍ!Ñµ°€ôÕÉÉ•¹Ñ5½¹Ñ €ð…ÑÕ…±5½¹Ñ (€€€€€€€€€€ü€œñÍÁ…¸±…ÍÌô‰Á¥±°Ý…É¹¥¹œˆù5½¹…ÐÙ½É‰•¤ƒ
ÜÁËñ™•¸ð½ÍÁ…¸øœ(€€€€€€€€€€è€¡ÕÉÉ•¹Ñ5½¹Ñ €ôôô…ÑÕ…±5½¹Ñ €ü€œñÍÁ…¸±…ÍÌô‰Á¥±°ˆù¥•Í•¸5½¹…Ð•Á±…¹Ðð½ÍÁ…¸øœ€è€œñÍÁ…¸±…ÍÌô‰Á¥±°ˆù9½ ¹¥¡Ð›‘±±¥œð½ÍÁ…¸øœ¤ì(€€€€€€€•±Í”¥˜€¡¹Á…åµ•¹ÑQåÁ”€ôôô€½¹•}Ñ¥µ”œ¤ÍÑ…ÑÕÍ!Ñµ°€ô€œñÍÁ…¸±…ÍÌô‰Á¥±°ˆù¥¹µ…±é…¡±Õ¹œð½ÍÁ…¸øœì(€€€€€€€•±Í”¥˜€¡Á…¥‘9½Ü¤ÍÑ…ÑÕÍ!Ñµ°€ô€œñÍÁ…¸±…ÍÌô‰Á¥±°ÍÕ•ÍÌˆù5½¹…Ð‰•é…¡±Ðð½ÍÁ…¸øœì(€€€€€€€•±Í”¥˜€¡‘Õ•9½Ü¤ÍÑ…ÑÕÍ!Ñµ°€ôÕÉÉ•¹Ñ5½¹Ñ €ð…ÑÕ…±5½¹Ñ (€€€€€€€€€€ü€œñÍÁ…¸±…ÍÌô‰Á¥±°Ý…É¹¥¹œˆù5½¹…ÐÙ½É‰•¤ƒ
ÜÁËñ™•¸ð½ÍÁ…¸øœ(€€€€€€€€€€è€¡ÕÉÉ•¹Ñ5½¹Ñ €ôôô…ÑÕ…±5½¹Ñ €ü€œñÍÁ…¸±…ÍÌô‰Á¥±°ˆù¥•Í•¸5½¹…Ð•Á±…¹Ðð½ÍÁ…¸øœ€è€œñÍÁ…¸±…ÍÌô‰Á¥±°ˆù9½ ¹¥¡Ð›‘±±¥œð½ÍÁ…¸øœ¤ì(€€€€€€€•±Í”¥˜€¡µ½¹Ñ¡¥™˜¡ÕÉÉ•¹Ñ5½¹Ñ °¹¹•áÑÕ•5½¹Ñ ¤€ø€À¤ÍÑ…ÑÕÍ!Ñµ°€ô€œñÍÁ…¸±…ÍÌô‰Á¥±°ˆùMÃ‘Ñ•Èð½ÍÁ…¸øœì((€€€€€€€½¹ÍÐÑåÁ•±…ÍÌ€ô¹Á…åµ•¹ÑQåÁ”€ôôô€¥¹ÍÑ…±±µ•¹Ðœ€ü€ÍÕ•ÍÌœ€è€¡¹Á…åµ•¹ÑQåÁ”€ôôô€½¹•}Ñ¥µ”œ€ü€œœ€è€Ý…É¹¥¹œœ¤ì(€€€€€€€½¹ÍÐÑåÁ•!Ñµ°€ô€ñÍÁ…¸±…ÍÌô‰Á¥±°€‘íÑåÁ•±…ÍÍôˆø‘í•Ñ•‰ÑA…åµ•¹ÑQåÁ•1…‰•°¡¹Á…åµ•¹ÑQåÁ”¥ôð½ÍÁ…¸ù€ì(€€€€€€€½¹ÍÐÁ±…¹%Ñ•´€ôÕÉÉ•¹Ñ•‰ÑA±…¸¹•Ð¡¹¹…µ”¤ñðìÉ…Ñ”è€À°Í¹½Ý‰…±°è€À°Á±…¹¹•è€À°™Õ±±A…å½™˜è™…±Í”ôì(€€€€€€€½¹ÍÐµ¥¹I…Ñ”€ô9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡°ÕÉÉ•¹Ñ5½¹Ñ ¤ñð€À¤ì(€€€€€€€½¹ÍÐ¥Í¥á•‘A…¥‘Q¡¥Í5½¹Ñ €ôÁ…¥‘9½Üì(€€€€€€€½¹ÍÐÁ±…¹¹•‘I…Ñ”€ô¥Í¥á•‘A…¥‘Q¡¥Í5½¹Ñ €ü5…Ñ ¹µ¥¸¡µ¥¹I…Ñ”°Á…¥‘µ½Õ¹Ð¤€è€¡9Õµ‰•È¡Á±…¹%Ñ•´¹É…Ñ”ñð€À¤ñð€¡‘Õ•9½Ü€ü5…Ñ ¹µ¥¸¡µ¥¹I…Ñ”°9Õµ‰•È¡¹…µ½Õ¹Ñ=Á•¸ñð€À¤¤€è€À¤¤ì(€€€€€€€½¹ÍÐÁ±…¹¹•‘M¹½Ý‰…±°€ô9Õµ‰•È¡Á±…¹%Ñ•´¹Í¹½Ý‰…±°ñð€À¤ì(€€€€€€€½¹ÍÐ½Á•¹A±…¹¹•‘A…åµ•¹Ð€ô9Õµ‰•È¡Á±…¹%Ñ•´¹Á±…¹¹•ñð€À¤ñð€ …¥Í¥á•‘A…¥‘Q¡¥Í5½¹Ñ €üÁ±…¹¹•‘I…Ñ”€è€À¤ì(€€€€€€€½¹ÍÐÁ±…¹¹•‘Q½Ñ…°€ô¥Í¥á•‘A…¥‘Q¡¥Í5½¹Ñ €üÁ…¥‘µ½Õ¹Ð€¬½Á•¹A±…¹¹•‘A…åµ•¹Ð€è½Á•¹A±…¹¹•‘A…åµ•¹Ðì(€€€€€€€½¹ÍÐÁ•¹‘¥¹I…Ñ•Q•áÐ€ô¥Í•‰ÑI…Ñ•A•¹‘¥¹½É5½¹Ñ ¡°ÕÉÉ•¹Ñ5½¹Ñ ¤€ü€œƒ
Ü‰•…¹ÑÉ…Ð°¹¥¡Ð‰•Ý¥±±¥Ðœ€è€œœì(€€€€€€€½¹ÍÐÁ±…¹¹•‘!Ñµ°€ôÁ±…¹¹•‘Q½Ñ…°€ø€À(€€€€€€€€€€ü€ñÍÑÉ½¹œø‘í•ÕÉ¼¡Á±…¹¹•‘Q½Ñ…°¥ôð½ÍÑÉ½¹œøñ‘¥Ø±…ÍÌô‰Íµ…±°µÕÑ•ˆø‘í¥Í¥á•‘A…¥‘Q¡¥Í5½¹Ñ €ü€¡½Á•¹A±…¹¹•‘A…åµ•¹Ð€ø€À€ü€‘í•ÕÉ¼¡Á…¥‘µ½Õ¹Ð¥ô‰•é…¡±Ðƒ
Ü€‘í•ÕÉ¼¡½Á•¹A±…¹¹•‘A…åµ•¹Ð¥ôÙ½É•Í¡±…•¹€€è€™•ÍÐ‰•é…¡±Ðœ¤€è€¡Á±…¹%Ñ•´¹™Õ±±A…å½™˜€ü€Ù½É•Í¡±…•¹”•Í…µÑ…‰³ÙÍÕ¹œœ€è€I…Ñ”€œ€¬•ÕÉ¼¡Á±…¹¹•‘I…Ñ”¤€¬Á•¹‘¥¹I…Ñ•Q•áÐ¥ôð½‘¥Øù€(€€€€€€€€€€è€œ´œì(€€€€€€€ÑÈ¹¥¹¹•É!Q50€ô€ñÑ±…ÍÌô‰‘•‰Ðµ¹…µ”µ•±°ˆøñÍÑÉ½¹œø‘í¹¹…µ•ôð½ÍÑÉ½¹œøð½ÑøñÑ±…ÍÌô‰…½Õ¹Ðµ½¹±äˆø‘í•Ñ½Õ¹Ñ9…µ”¡¹…½Õ¹Ñ%¥ôð½ÑøñÑø‘í•ÕÉ¼¡9Õµ‰•È¡¹…µ½Õ¹Ñ=Á•¸ñð€À¤¥ôð½ÑøñÑø‘í•ÕÉ¼¡µ¥¹I…Ñ”¥ôð½ÑøñÑø‘íÁ±…¹¹•‘M¹½Ý‰…±°€ø€À€ü€œñÍÁ…¸±…ÍÌô‰Í¹½Ý‰…±°µÁ¥±°ˆø¬œ€¬•ÕÉ¼¡Á±…¹¹•‘M¹½Ý‰…±°¤€¬€œð½ÍÁ…¸øœ€è€œ´ôð½ÑøñÑ±…ÍÌôˆ‘íÁ±…¹¹•‘M¹½Ý‰…±°€ø€À€ü€…µ½Õ¹Ðµ¡¥¡±¥¡Ðœ€è€œôˆø‘íÁ±…¹¹•‘!Ñµ±ôð½ÑøñÑø‘í¹¹•áÑÕ•5½¹Ñ ñð€œ´ôð½ÑøñÑø‘í•ÍÑ¥µ…Ñ•‘¹ñð€œ´ôð½ÑøñÑø‘íÁÉ½É•ÍÍ!Ñµ±ôð½ÑøñÑø‘íÍÑ…ÑÕÍ!Ñµ±ôð½ÑøñÑøð½ÑøñÑøð½Ñù€ì((€€€€€€€½¹ÍÐÁ…å•±°€ôÑÈ¹¡¥±‘É•¹lÄÁtì(€€€€€€€¥˜€¡9Õµ‰•È¡¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ðô€À¤ì(€€€€€€€€€½¹ÍÐ‘½¹”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€€€€€½¹ÍÐ½µÁ±•Ñ•‘5½¹Ñ €ô•Ñ•‰Ñ½µÁ±•Ñ•‘5½¹Ñ ¡¤ì(€€€€€€€€€‘½¹”¹¥¹¹•É!Q50€ô€ñÍÁ…¸±…ÍÌô‰Á¥±°ÍÕ•ÍÌˆùÉ±•‘¥Ðð½ÍÁ…¸øñ‘¥Ø±…ÍÌô‰Íµ…±°µÕÑ•ˆø‘í½µÁ±•Ñ•‘5½¹Ñ €ü™½Éµ…Ñ5½¹Ñ¡1…‰•°¡½µÁ±•Ñ•‘5½¹Ñ ¤€è€œôð½‘¥Øù€ì(€€€€€€€€€Á…å•±°¹…ÁÁ•¹‘¡¥±¡‘½¹”¤ì(€€€€€€€ô•±Í”¥˜€¡Á…¥‘9½Ü€˜˜½Á•¹A±…¹¹•‘A…åµ•¹Ð€ø€À¤ì(€€€€€€€€€½¹ÍÐ‰Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€€€‰Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ôÁ±…¹%Ñ•´¹™Õ±±A…å½™˜€ü€•Í…µÑ…‰³ÙÍÕ¹œ•¥¹ÑÉ…•¸œ€è€iÕÏ‘Ñé±¥¡”i…¡±Õ¹œ•¥¹ÑÉ…•¸œì(€€€€€€€€€‰Ñ¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€€€€€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€€€€€Í¡½Ý•‰ÑA…åµ•¹Ñ‘¥Ñ½È¡°ì(€€€€€€€€€€€€€µ½¹Ñ èÕÉÉ•¹Ñ5½¹Ñ °(€€€€€€€€€€€€€…µ½Õ¹Ðè½Á•¹A±…¹¹•‘A…åµ•¹Ð°(€€€€€€€€€€€€€µ½‘”è€•áÑÉ„œ°(€€€€€€€€€€€€€¹½Ñ”è€Y½ÉÍ¡±…œ…ÕÌ‘•´™•ÍÑ•¸€àÀÀ·Š
°µM¡Õ±‘•¹‰Õ‘•Ðœ(€€€€€€€€€€€ô¤ì(€€€€€€€€€ô¤ì(€€€€€€€€€Á…å•±°¹…ÁÁ•¹‘¡¥±¡‰Ñ¸¤ì(€€€€€€€ô•±Í”¥˜€¡Á…¥‘9½Ü¤ì(€€€€€€€€€½¹ÍÐ‘½¹”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€€€€€‘½¹”¹¥¹¹•É!Q50€ô€ñÍÁ…¸±…ÍÌô‰Á¥±°ÍÕ•ÍÌˆù	•é…¡±Ðð½ÍÁ…¸øñ‘¥Ø±…ÍÌô‰Íµ…±°µÕÑ•ˆø‘í•ÕÉ¼¡Á…¥‘µ½Õ¹Ð¥ôð½‘¥Øù€ì(€€€€€€€€€Á…å•±°¹…ÁÁ•¹‘¡¥±¡‘½¹”¤ì(€€€€€€€ô•±Í”¥˜€ ¡‘Õ•9½Üñð½Á•¹A±…¹¹•‘A…åµ•¹Ð€ø€À¤€˜˜½Á•¹A±…¹¹•‘A…åµ•¹Ð€ø€À¤ì(€€€€€€€€€½¹ÍÐ‰Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€€€‰Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ôÁ±…¹%Ñ•´¹™Õ±±A…å½™˜€ü€•Í…µÑ…‰³ÙÍÕ¹œ•¥¹ÑÉ…•¸œ€è€•Á±…¹Ñ”i…¡±Õ¹œ‰•é…¡±•¸œì(€€€€€€€€€‰Ñ¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€€€€€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€€€€€¥˜€¡Á±…¹%Ñ•´¹™Õ±±A…å½™˜¤ì(€€€€€€€€€€€€€Í¡½Ý•‰ÑA…åµ•¹Ñ‘¥Ñ½È¡°ì(€€€€€€€€€€€€€€€µ½¹Ñ èÕÉÉ•¹Ñ5½¹Ñ °(€€€€€€€€€€€€€€€…µ½Õ¹Ðè½Á•¹A±…¹¹•‘A…åµ•¹Ð°(€€€€€€€€€€€€€€€µ½‘”è€•áÑÉ„œ°(€€€€€€€€€€€€€€€¹½Ñ”è€•Í…µÑ…‰³ÙÍÕ¹œ…ÕÌ‘•´™•ÍÑ•¸€àÀÀ·Š
°µM¡Õ±‘•¹‰Õ‘•Ðœ(€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€µ…É­•‰ÑA…¥¡°½Á•¹A±…¹¹•‘A…åµ•¹Ð°ìÉ…Ñ”èÁ±…¹¹•‘I…Ñ”°Í¹½Ý‰…±°èÁ±…¹¹•‘M¹½Ý‰…±°ô¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô¤ì(€€€€€€€€€Á…å•±°¹…ÁÁ•¹‘¡¥±¡‰Ñ¸¤ì(€€€€€€€ô•±Í”ì(€€€€€€€€€Á…å•±°¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ´œì(€€€€€€€ô((€€€€€€€½¹ÍÐ…Ñ¥½¹•±°€ôÑÈ¹¡¥±‘É•¹lÄÅtì(€€€€€€€½¹ÍÐ•‘¥Ñ	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€•‘¥Ñ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€	•…É‰•¥Ñ•¸œì(€€€€€€€•‘¥Ñ	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€€€€€•‘¥Ñ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€€€Í¡½Ý•‰Ñ‘¥Ñ½È¡¤ì(€€€€€€€ô¤ì((€€€€€€€½¹ÍÐÁ…å	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€Á…å	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€i…¡±Õ¹œ•¥¹ÑÉ…•¸œì(€€€€€€€Á…å	Ñ¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€€€€€Á…å	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€€€Í¡½Ý•‰ÑA…åµ•¹Ñ‘¥Ñ½È¡¤ì(€€€€€€€ô¤ì((€€€€€€€½¹ÍÐÉ…Ñ•	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€É…Ñ•	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€I…Ñ”ƒ‘¹‘•É¸œì(€€€€€€€É…Ñ•	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€€€€€É…Ñ•	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€€€Í¡½Ý•‰ÑI…Ñ•‘¥Ñ½È¡¤ì(€€€€€€€ô¤ì((€€€€€€€½¹ÍÐÉ•Í•Ñ	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€É•Í•Ñ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€i…¡±Õ¹œéÕËñ­Í•Ñé•¸œì(€€€€€€€É•Í•Ñ	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€€€€€É•Í•Ñ	Ñ¸¹‘¥Í…‰±•€ô€……¹I•Í•Ñ•‰ÑA…åµ•¹Ðì(€€€€€€€É•Í•Ñ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€€€¥˜€¡½¹™¥É´¡i…¡±Õ¹œ›ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ô‰•¤€ˆ‘í¹¹…µ•ôˆéÕËñ­Í•Ñé•¸ý€¤¤ì(€€€€€€€€€€€É•Í•Ñ•‰ÑA…åµ•¹Ñ½É5½¹Ñ ¡°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€ô(€€€€€€€ô¤ì((€€€€€€€½¹ÍÐ‘•±	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€‘•±	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€3ÙÍ¡•¸œì(€€€€€€€‘•±	Ñ¸¹±…ÍÍ9…µ”€ô€‘…¹•Èœì(€€€€€€€‘•±	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€€€¥˜€¡½¹™¥É´¡M¡Õ±€ˆ‘í¹¹…µ•ôˆ³ÙÍ¡•¸ý€¤¤ì(€€€€€€€€€€€ÍÑ…Ñ”¹‘•‰ÑÌ€ôÍÑ…Ñ”¹‘•‰ÑÌ¹™¥±Ñ•È ¡à¤€ôøà¹¥€„ôô¹¥¤ì(€€€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€ô(€€€€€€€ô¤ì((€€€€€€€½¹ÍÐÉ•Ù¥•ÝIÕ±•Q•áÐ€ô•Ñ•‰ÑI…Ñ•¡…¹•IÕ±•Q•áÐ¡¤ì(€€€€€€€½¹ÍÐÉ•‘¥Ñ½ÉIÕ±•Q•áÐ€ô•Ñ•‰ÑÉ•‘¥Ñ½ÉIÕ±”¡¤ü¹±…‰•°ñð€œœì(€€€€€€€½¹ÍÐ±…Ñ•ÍÑ	…±…¹•¡•¬€ô•Ñ1…Ñ•ÍÑ•‰Ñ	…±…¹•¡•¬¡°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€½¹ÍÐ±…Ñ•ÍÑA…åµ•¹Ð€ô€¡¹Á…åµ•¹Ñ!¥ÍÑ½Éäñðmt¤¹Í±¥” ¤¹Í½ÉÐ ¡„°ˆ¤€ôøMÑÉ¥¹œ¡ˆ¹µ½¹Ñ ñð€œœ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡„¹µ½¹Ñ ñð€œœ¤¤ñðMÑÉ¥¹œ¡ˆ¹É•…Ñ•‘Ðñð€œœ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡„¹É•…Ñ•‘Ðñð€œœ¤¤¥lÁtì(€€€€€€€½¹ÍÐ‘•‰Ñ•Ñ…¥±Í!Ñµ°€ô€ñÍÑÉ½¹œø‘í¹¹…µ•ôð½ÍÑÉ½¹œøñ‘¥ØøñÍÁ…¸ùM¡Õ±‘…ÉÐèð½ÍÁ…¸ø€‘íÑåÁ•!Ñµ±ôð½‘¥Øøñ‘¥ØøñÍÁ…¸ù1•ÑéÑ•Èi…¡±Õ¹ÍÝ•œèð½ÍÁ…¸ø€‘í±…Ñ•ÍÑA…åµ•¹Ð€ü€‘í•Ñ!½ÕÍ•¡½±‘A…åµ•¹Ñ5•Ñ¡½‘1…‰•°¡±…Ñ•ÍÑA…åµ•¹Ð¹Á…åµ•¹Ñ5•Ñ¡½¥ôƒ
Ü€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡±…Ñ•ÍÑA…åµ•¹Ð¹µ½¹Ñ ¥õ€€è€¹½ ­•¥¹•È•É™…ÍÍÐôð½‘¥Øøñ‘¥ØøñÍÁ…¸ùMÑ…¹‘ÁËñ™Õ¹œèð½ÍÁ…¸ø€‘í•Ñ•‰Ñ	…±…¹•¡•­5½‘•1…‰•°¡¥ôð½‘¥Øøñ‘¥ØøñÍÁ…¸ù1•ÑéÑ•È‰•ÍÓ‘Ñ¥Ñ•ÈMÑ…¹èð½ÍÁ…¸ø€‘í±…Ñ•ÍÑ	…±…¹•¡•¬€ü€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡±…Ñ•ÍÑ	…±…¹•¡•¬¹µ½¹Ñ ¥ôƒ
Ü€‘í•ÕÉ¼¡±…Ñ•ÍÑ	…±…¹•¡•¬¹…µ½Õ¹Ð¥õ€€è€¹½ ­•¥¹•Èôð½‘¥Øø‘íÉ•Ù¥•ÝIÕ±•Q•áÐ€ü€ñ‘¥ØøñÍÁ…¸ùI…Ñ•¹É••°èð½ÍÁ…¸ø€‘íÉ•Ù¥•ÝIÕ±•Q•áÑôð½‘¥Øù€€è€œô‘íÉ•‘¥Ñ½ÉIÕ±•Q•áÐ€ü€ñ‘¥ØøñÍÁ…¸ùi…¡±Õ¹ÍÉ••°èð½ÍÁ…¸ø€‘íÉ•‘¥Ñ½ÉIÕ±•Q•áÑôð½‘¥Øù€€è€œôñ‘¥ØøñÍÁ…¸ùI…Ñ•¹Ù•É±…Õ˜èð½ÍÁ…¸ø€‘í•Ñ•‰ÑI…Ñ•Q¥µ•±¥¹•Q•áÐ¡¤€ü•Ñ•‰ÑI…Ñ•Q¥µ•±¥¹•Q•áÐ¡¤€è€œ´ôð½‘¥Øø‘í•Ñ9•áÑ•‰ÑI…Ñ•¡…¹•Q•áÐ¡¤€ü€ñ‘¥Ø±…ÍÌô‰Íµ…±°µÕÑ•ˆø‘í•Ñ9•áÑ•‰ÑI…Ñ•¡…¹•Q•áÐ¡¥ôð½‘¥Øù€€è€œõ€ì(€€€€€€€…Ñ¥½¹•±°¹…ÁÁ•¹‘¡¥±¡É•…Ñ•Ñ¥½¹5•¹Ô¡l(€€€€€€€€€ì±…‰•°è€	•…É‰•¥Ñ•¸œ°±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½Ý•‰Ñ‘¥Ñ½È¡¤ô°(€€€€€€€€€ì±…‰•°è€I…Ñ”ƒ‘¹‘•É¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½Ý•‰ÑI…Ñ•‘¥Ñ½È¡¤ô°(€€€€€€€€€ì±…‰•°è€i…¡±Õ¹œ•¥¹ÑÉ…•¸œ°±…ÍÍ9…µ”è€ÍÕ•ÍÌœ°½¹±¥¬è€ ¤€ôøÍ¡½Ý•‰ÑA…åµ•¹Ñ‘¥Ñ½È¡¤ô°(€€€€€€€€€ì±…‰•°è€M¡Õ±‘•¹ÍÑ…¹•¥¹ÑÉ…•¸œ°±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½Ý•‰Ñ	…±…¹•¡•­‘¥Ñ½È¡°ÕÉÉ•¹Ñ5½¹Ñ ¤ô°(€€€€€€€€€ì±…‰•°è€i…¡±Õ¹œéÕËñ­Í•Ñé•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°‘¥Í…‰±•è€……¹I•Í•Ñ•‰ÑA…åµ•¹Ð°½¹±¥¬è€ ¤€ôøì¥˜€¡½¹™¥É´¡i…¡±Õ¹œ›ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ô‰•¤€ˆ‘í¹¹…µ•ôˆéÕËñ­Í•Ñé•¸ý€¤¤ìÉ•Í•Ñ•‰ÑA…åµ•¹Ñ½É5½¹Ñ ¡°ÕÉÉ•¹Ñ5½¹Ñ ¤ìÍ…Ù•MÑ…Ñ” ¤ìÉ•¹‘•È ¤ìôôô°(€€€€€€€€€ì±…‰•°è€3ÙÍ¡•¸œ°±…ÍÍ9…µ”è€‘…¹•Èœ°½¹±¥¬è€ ¤€ôøì¥˜€¡½¹™¥É´¡M¡Õ±€ˆ‘í¹¹…µ•ôˆ³ÙÍ¡•¸ý€¤¤ìÍÑ…Ñ”¹‘•‰ÑÌ€ôÍÑ…Ñ”¹‘•‰ÑÌ¹™¥±Ñ•È ¡à¤€ôøà¹¥€„ôô¹¥¤ìÍ…Ù•MÑ…Ñ” ¤ìÉ•¹‘•È ¤ìôôô(€€€€€€€t°€­Ñ¥½¹•¸ƒŠ.¼œ°‘•‰Ñ•Ñ…¥±Í!Ñµ°¤¤ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€ô¤ì((€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€€€‘•‰Ñ1¥ÍÑ½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€ô((€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ••‰Ñ•Ñ…¥±Ì¡M¡Õ±‘•¹±¥ÍÑ”Õ¹Y•É±…Õ˜ƒ
Ü€‘íÙ¥Í¥‰±••‰ÑÌ¹±•¹Ñ¡õ€°‘•‰Ñ1¥ÍÑ½¹Ñ•¹Ð¤¤ì(€€€½¹ÍÐ‰…±…¹•I•Ù¥•Ý…É€ôÉ•¹‘•É•‰Ñ	…±…¹•I•Ù¥•Ý…É¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€¥˜€¡‰…±…¹•I•Ù¥•Ý…É¤ì(€€€€€½¹ÍÐ¡•­Ì€ô•ÑÕ••‰Ñ	…±…¹•¡•­Ì¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€½¹ÍÐµ½¹Ñ¡±å¡•­Ì€ô¡•­Ì¹™¥±Ñ•È ¡‘•‰Ð¤€ôø‘•‰Ð¹‰…±…¹•¡•­5½‘”€ôôô€µ½¹Ñ¡±äœ¤¹±•¹Ñ ì(€€€€€½¹ÍÐ…¹¹Õ…±¡•­Ì€ô¡•­Ì¹±•¹Ñ €´µ½¹Ñ¡±å¡•­Ìì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ••‰Ñ•Ñ…¥±Ì (€€€€€€€M¡Õ±‘•¹ÍÓ‘¹‘”ƒ
Ü€‘íµ½¹Ñ¡±å¡•­Íôµ½¹…Ñ±¥ ƒ
Ü€‘í…¹¹Õ…±¡•­Íô«‘¡É±¥¡€°(€€€€€€€‰…±…¹•I•Ù¥•Ý…É°(€€€€€€€µ½¹Ñ¡±å¡•­Ì€ø€À(€€€€€€¤¤ì(€€€ô(€€€‘•‰ÑÍM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡…É¤ì(€ô((((€™Õ¹Ñ¥½¸É•¹‘•ÉÉ½ÕÁ•‘•‰ÑA…åµ•¹ÑA±…¹…É¡Á±…¸°µ…á5½¹Ñ¡Ì€ô€ÄÈ¤ì(€€€½¹ÍÐ‰½à€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€‰½à¹±…ÍÍ9…µ”€ô€ÍÕˆµ…ÉÁ…åµ•¹ÐµÁ±…¸µ…ÉÉ½ÕÁ•µÁ…åµ•¹ÐµÁ±…¸µ…Éœì(€€€‰½à¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ðœ°€œœ°€M¡Õ±‘•¸µi…¡±Õ¹ÍÁ±…¸­½µÁ…­Ðœ¤¤ì(€€€‰½à¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥¹”Q…‰•±±”©”5½¹…ÐÕ¹A½ÍÑ•¸è•¥•¹Ñ±¥¡”I…Ñ”°éÕÏ‘Ñé±¥¡•ÈY½ÉÍ¡±…œ…ÕÌ‘•´™•ÍÑ•¸5½¹…ÑÍé¥•°Õ¹•Á±…¹Ñ”•Í…µÑé…¡±Õ¹œ¸œ¤¤ì((€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”½µÁ…ÐµÑ…‰±”É½ÕÁ•µÁ…åµ•¹ÐµÑ…‰±”œì(€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ù5½¹…Ðð½Ñ øñÑ ùA½ÍÑ•¸ð½Ñ øñÑ ùI…Ñ”ð½Ñ øñÑ ø¬…ÕÌ5½¹…ÑÍé¥•°ð½Ñ øñÑ ø¬Í½¹ÍÑ¥”áÑÉ…Ìð½Ñ øñÑ ù•Á±…¹Ð•Í…µÐð½Ñ øñÑ ùI•ÍÐ‘…¹… ð½Ñ øñÑ ù!¥¹Ý•¥Ìð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€±•ÐÉ•¹‘•É•€ô€Àì((€€€€¡Á±…¸¹É½ÝÌñðmt¤¹Í±¥” À°µ…á5½¹Ñ¡Ì¤¹™½É…  ¡É½Ü¤€ôøì(€€€€€½¹ÍÐÉ½ÕÁ•€ô¹•Ü5…À ¤ì(€€€€€€¡ÉÉ…ä¹¥ÍÉÉ…ä¡É½Ü¹Á…åµ•¹ÑÌ¤€üÉ½Ü¹Á…åµ•¹ÑÌ€èmt¤¹™½É…  ¡Á…åµ•¹Ð¤€ôøì(€€€€€€€½¹ÍÐ¹…µ”€ôÁ…åµ•¹Ð¹‘•‰Ðñð€U¹‰•­…¹¹Ðœì(€€€€€€€¥˜€ …É½ÕÁ•¹¡…Ì¡¹…µ”¤¤ì(€€€€€€€€€É½ÕÁ•¹Í•Ð¡¹…µ”°ì(€€€€€€€€€€€‘•‰Ðè¹…µ”°(€€€€€€€€€€€É•Õ±…Èè€À°(€€€€€€€€€€€Í¹½Ý‰…±°è€À°(€€€€€€€€€€€‘å¹…µ¥Œè€À°(€€€€€€€€€€€Á±…¹¹•è€À°(€€€€€€€€€€€É•µ…¥¹¥¹™Ñ•Èè9Õµ‰•È¡Á…åµ•¹Ð¹É•µ…¥¹¥¹™Ñ•Èñð€À¤°(€€€€€€€€€€€½µÁ±•Ñ•è™…±Í”°(€€€€€€€€€€€¹½Ñ•Ìèmt(€€€€€€€€€ô¤ì(€€€€€€€ô(€€€€€€€½¹ÍÐ¥Ñ•´€ôÉ½ÕÁ•¹•Ð¡¹…µ”¤ì(€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤ì(€€€€€€€¥Ñ•´¹Á±…¹¹•€¬ô…µ½Õ¹Ðì(€€€€€€€¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€É…Ñ”œ¤¥Ñ•´¹É•Õ±…È€¬ô…µ½Õ¹Ðì(€€€€€€€•±Í”¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€Í¹½Ý‰…±°œñðÁ…åµ•¹Ð¹ÑåÁ”€ôôô€‰Õ‘•Ñ}•áÑÉ„œ¤¥Ñ•´¹Í¹½Ý‰…±°€¬ô…µ½Õ¹Ðì(€€€€€€€•±Í”¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€‘å¹…µ¥Œœ¤¥Ñ•´¹‘å¹…µ¥Œ€¬ô…µ½Õ¹Ðì(€€€€€€€•±Í”¥˜€¡Á…åµ•¹Ð¹ÑåÁ”€ôôô€™Õ±±}Á…å½™˜œ¤ì(€€€€€€€€€¥Ñ•´¹É•Õ±…È€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹É…Ñ•µ½Õ¹Ðñð€À¤ì(€€€€€€€€€¥Ñ•´¹Í¹½Ý‰…±°€¬ô9Õµ‰•È¡Á…åµ•¹Ð¹Í¹½Ý‰…±±µ½Õ¹Ðñð€À¤ì(€€€€€€€ô(€€€€€€€¥Ñ•´¹É•µ…¥¹¥¹™Ñ•È€ô9Õµ‰•È¡Á…åµ•¹Ð¹É•µ…¥¹¥¹™Ñ•Èñð¥Ñ•´¹É•µ…¥¹¥¹™Ñ•Èñð€À¤ì(€€€€€€€¥Ñ•´¹½µÁ±•Ñ•€ô¥Ñ•´¹½µÁ±•Ñ•ñð€„…Á…åµ•¹Ð¹½µÁ±•Ñ•ì(€€€€€€€¥˜€¡Á…åµ•¹Ð¹¹½Ñ”¤¥Ñ•´¹¹½Ñ•Ì¹ÁÕÍ ¡Á…åµ•¹Ð¹¹½Ñ”¤ì(€€€€€ô¤ì((€€€€€½¹ÍÐÑÉ…¹Í™•É9½Ñ•Ì€ô¹•Ü5…À ¤ì(€€€€€€¡ÉÉ…ä¹¥ÍÉÉ…ä¡É½Ü¹™É••‘QÉ…¹Í™•ÉÌ¤€üÉ½Ü¹™É••‘QÉ…¹Í™•ÉÌ€èmt¤¹™½É…  ¡•¹ÑÉä¤€ôøì(€€€€€€€½¹ÍÐÑ…É•Ð€ô•¹ÑÉä¹Ñ…É•Ñ•‰Ðñð€­•¥¹”Ý•¥Ñ•É”M¡Õ±€¼Ý¥É™É•¤œì(€€€€€€€½¹ÍÐÑáÐ€ô€‘í•¹ÑÉä¹Í½ÕÉ••‰Ñô³‘Õ™Ð…ÕÌè€‘í•ÕÉ¼¡9Õµ‰•È¡•¹ÑÉä¹…µ½Õ¹Ðñð€À¤¥ô…ˆ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡•¹ÑÉä¹ÑÉ…¹Í™•É5½¹Ñ ¥ôƒŠH€‘íÑ…É•Ñõ€ì(€€€€€€€½¹ÍÐ­•ä€ô•¹ÑÉä¹Ñ…É•Ñ•‰Ðñð€}}™É••}|œì(€€€€€€€¥˜€ …ÑÉ…¹Í™•É9½Ñ•Ì¹¡…Ì¡­•ä¤¤ÑÉ…¹Í™•É9½Ñ•Ì¹Í•Ð¡­•ä°mt¤ì(€€€€€€€ÑÉ…¹Í™•É9½Ñ•Ì¹•Ð¡­•ä¤¹ÁÕÍ ¡ÑáÐ¤ì(€€€€€ô¤ì((€€€€€½¹ÍÐ¥Ñ•µÌ€ôÉÉ…ä¹™É½´¡É½ÕÁ•¹Ù…±Õ•Ì ¤¤¹Í½ÉÐ ¡„°ˆ¤€ôøì(€€€€€€€½¹ÍÐ•áÑÉ…€ô9Õµ‰•È¡„¹Í¹½Ý‰…±°ñð€À¤€¬9Õµ‰•È¡„¹‘å¹…µ¥Œñð€À¤ì(€€€€€€€½¹ÍÐ•áÑÉ…€ô9Õµ‰•È¡ˆ¹Í¹½Ý‰…±°ñð€À¤€¬9Õµ‰•È¡ˆ¹‘å¹…µ¥Œñð€À¤ì(€€€€€€€¥˜€¡•áÑÉ…€„ôô•áÑÉ…¤É•ÑÕÉ¸•áÑÉ…€´•áÑÉ…ì(€€€€€€€É•ÑÕÉ¸„¹‘•‰Ð¹±½…±•½µÁ…É”¡ˆ¹‘•‰Ð¤ì(€€€€€ô¤ì((€€€€€¥˜€¡¥Ñ•µÌ¹±•¹Ñ €ôôô€À€˜˜ÑÉ…¹Í™•É9½Ñ•Ì¹Í¥é”€ôôô€À¤ì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€ÑÈ¹¥¹¹•É!Q50€ô€ñÑø‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡É½Ü¹µ½¹Ñ ¥ôð½ÑøñÑù­•¥¹”M¡Õ±‘•¹é…¡±Õ¹œð½ÑøñÑøÀ°ÀÀƒŠ
°ð½ÑøñÑø´ð½ÑøñÑø´ð½ÑøñÑøÀ°ÀÀƒŠ
°ð½ÑøñÑø‘í•ÕÉ¼¡9Õµ‰•È¡É½Ü¹É•µ…¥¹¥¹œñð€À¤¥ôð½ÑøñÑø´ð½Ñù€ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€€€É•¹‘•É•€¬ô€Äì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô((€€€€€¥Ñ•µÌ¹™½É…  ¡¥Ñ•´°¥¹‘•à¤€ôøì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€½¹ÍÐ¹½Ñ•Ì€ômtì(€€€€€€€¥˜€¡¥Ñ•´¹½µÁ±•Ñ•¤¹½Ñ•Ì¹ÁÕÍ  •É±•‘¥Ð€¼³‘Õ™Ð…ÕÌœ¤ì(€€€€€€€¥˜€¡¥Ñ•´¹¹½Ñ•Ì¹±•¹Ñ ¤¹½Ñ•Ì¹ÁÕÍ  ¸¸¹ÉÉ…ä¹™É½´¡¹•ÜM•Ð¡¥Ñ•´¹¹½Ñ•Ì¤¤¤ì(€€€€€€€¥˜€¡ÑÉ…¹Í™•É9½Ñ•Ì¹¡…Ì¡¥Ñ•´¹‘•‰Ð¤¤¹½Ñ•Ì¹ÁÕÍ  ¸¸¹ÑÉ…¹Í™•É9½Ñ•Ì¹•Ð¡¥Ñ•´¹‘•‰Ð¤¤ì(€€€€€€€½¹ÍÐ¡…ÍáÑÉ„€ô9Õµ‰•È¡¥Ñ•´¹Í¹½Ý‰…±°ñð€À¤€ø€Àñð9Õµ‰•È¡¥Ñ•´¹‘å¹…µ¥Œñð€À¤€ø€Àì(€€€€€€€ÑÈ¹¥¹¹•É!Q50€ô€(€€€€€€€€€€ñÑø‘í¥¹‘•à€ôôô€À€ü™½Éµ…Ñ5½¹Ñ¡1…‰•°¡É½Ü¹µ½¹Ñ ¤€è€œôð½Ñø(€€€€€€€€€€ñÑøñÍÑÉ½¹œø‘í¥Ñ•´¹‘•‰Ñôð½ÍÑÉ½¹œøð½Ñø(€€€€€€€€€€ñÑø‘í•ÕÉ¼¡9Õµ‰•È¡¥Ñ•´¹É•Õ±…Èñð€À¤¥ôð½Ñø(€€€€€€€€€€ñÑø‘í9Õµ‰•È¡¥Ñ•´¹Í¹½Ý‰…±°ñð€À¤€ø€À€ü€œñÍÁ…¸±…ÍÌô‰Í¹½Ý‰…±°µÁ¥±°ˆø¬œ€¬•ÕÉ¼¡9Õµ‰•È¡¥Ñ•´¹Í¹½Ý‰…±°ñð€À¤¤€¬€œð½ÍÁ…¸øœ€è€œ´ôð½Ñø(€€€€€€€€€€ñÑø‘í9Õµ‰•È¡¥Ñ•´¹‘å¹…µ¥Œñð€À¤€ø€À€ü€œñÍÁ…¸±…ÍÌô‰‘å¹…µ¥ŒµÁ¥±°ˆø¬œ€¬•ÕÉ¼¡9Õµ‰•È¡¥Ñ•´¹‘å¹…µ¥Œñð€À¤¤€¬€œð½ÍÁ…¸øœ€è€œ´ôð½Ñø(€€€€€€€€€€ñÑ±…ÍÌôˆ‘í¡…ÍáÑÉ„€ü€…µ½Õ¹Ðµ¡¥¡±¥¡Ðœ€è€œôˆøñÍÑÉ½¹œø‘í•ÕÉ¼¡9Õµ‰•È¡¥Ñ•´¹Á±…¹¹•ñð€À¤¥ôð½ÍÑÉ½¹œøð½Ñø(€€€€€€€€€€ñÑø‘í•ÕÉ¼¡9Õµ‰•È¡¥Ñ•´¹É•µ…¥¹¥¹™Ñ•Èñð€À¤¥ôð½Ñø(€€€€€€€€€€ñÑø‘í¹½Ñ•Ì¹±•¹Ñ €ü¹½Ñ•Ì¹©½¥¸ œñ‰Èøœ¤€è€œ´ôð½Ñù€ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€€€É•¹‘•É•€¬ô€Äì(€€€€€ô¤ì((€€€€€¥˜€¡É½Ü¹Á…å½™™I•Í•ÉÙ”€˜˜€…É½Ü¹Á…å½™™I•Í•ÉÙ”¹…¹A…å½™˜€˜˜9Õµ‰•È¡É½Ü¹Á…å½™™I•Í•ÉÙ”¹É•Í•ÉÙ•‘‘•ñð€À¤€ø€À¤ì(€€€€€€€½¹ÍÐÉ•Í•ÉÙ”€ôÉ½Ü¹Á…å½™™I•Í•ÉÙ”ì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€ÑÈ¹±…ÍÍ9…µ”€ô€Í½™ÐµÉ½Üœì(€€€€€€€ÑÈ¹¥¹¹•É!Q50€ô€(€€€€€€€€€€ñÑø‘í¥Ñ•µÌ¹±•¹Ñ €ôôô€À€ü™½Éµ…Ñ5½¹Ñ¡1…‰•°¡É½Ü¹µ½¹Ñ ¤€è€œôð½Ñø(€€€€€€€€€€ñÑøñÍÑÉ½¹œø‘íÉ•Í•ÉÙ”¹Ñ…É•Ñ•‰Ñôƒ
ÜKñ­±…”ð½ÍÑÉ½¹œøð½Ñø(€€€€€€€€€€ñÑø´ð½Ñø(€€€€€€€€€€ñÑøñÍÁ…¸±…ÍÌô‰Í¹½Ý‰…±°µÁ¥±°ˆø¬‘í•ÕÉ¼¡9Õµ‰•È¡É•Í•ÉÙ”¹É•Í•ÉÙ•‘‘•ñð€À¤¥ôð½ÍÁ…¸øð½Ñø(€€€€€€€€€€ñÑø´ð½Ñø(€€€€€€€€€€ñÑøñÍÑÉ½¹œø‘í•ÕÉ¼¡9Õµ‰•È¡É•Í•ÉÙ”¹É•Í•ÉÙ•‘‘•ñð€À¤¥ôð½ÍÑÉ½¹œøð½Ñø(€€€€€€€€€€ñÑø‘í•ÕÉ¼¡9Õµ‰•È¡É•Í•ÉÙ”¹ÕÉÉ•¹Ñ=Á•¹™Ñ•ÉI…Ñ”ñð€À¤¥ôð½Ñø(€€€€€€€€€€ñÑùñÈÍÃ‘Ñ•É”•Í…µÑ™½É‘•ÉÕ¹œéÕËñ­•±•Ðƒ
Ü…¹•ÍÁ…ÉÐ€‘í•ÕÉ¼¡9Õµ‰•È¡É•Í•ÉÙ”¹É•Í•ÉÙ•	…±…¹”ñð€À¤¥ôð½Ñù€ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€€€É•¹‘•É•€¬ô€Äì(€€€€€ô((€€€€€¥˜€¡ÑÉ…¹Í™•É9½Ñ•Ì¹¡…Ì }}™É••}|œ¤¤ì(€€€€€€€ÑÉ…¹Í™•É9½Ñ•Ì¹•Ð }}™É••}|œ¤¹™½É…  ¡ÑáÐ°¥‘à¤€ôøì(€€€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€€€ÑÈ¹±…ÍÍ9…µ”€ô€Í½™ÐµÉ½Üœì(€€€€€€€€€ÑÈ¹¥¹¹•É!Q50€ô€ñÑø‘í¥Ñ•µÌ¹±•¹Ñ €ôôô€À€˜˜¥‘à€ôôô€À€ü™½Éµ…Ñ5½¹Ñ¡1…‰•°¡É½Ü¹µ½¹Ñ ¤€è€œôð½ÑøñÑøñÍÑÉ½¹œù™É•¤Ý•É‘•¹ð½ÍÑÉ½¹œøð½ÑøñÑø´ð½ÑøñÑø´ð½ÑøñÑø´ð½ÑøñÑøÀ°ÀÀƒŠ
°ð½ÑøñÑø‘í•ÕÉ¼¡9Õµ‰•È¡É½Ü¹É•µ…¥¹¥¹œñð€À¤¥ôð½ÑøñÑø‘íÑáÑôð½Ñù€ì(€€€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€€€€€É•¹‘•É•€¬ô€Äì(€€€€€€€ô¤ì(€€€€€ô(€€€ô¤ì((€€€¥˜€ …É•¹‘•É•¤ì(€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€ÑÈ¹¥¹¹•É!Q50€ô€œñÑ½±ÍÁ…¸ôˆàˆù-•¥¹”•Á±…¹Ñ•¸M¡Õ±‘•¹é…¡±Õ¹•¸¥´Í¥¡Ñ‰…É•¸i•¥ÑÉ…Õ´¸ð½Ñøœì(€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€ô(€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€‰½à¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€É•ÑÕÉ¸‰½àì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉM¹½Ý‰…±±A±…¹…É¡µ½¹Ñ¡-•ä¤ì(€€€½¹ÍÐÁ±…¸€ô‰Õ¥±‘M¹½Ý‰…±±A±…¸¡µ½¹Ñ¡-•ä°€ÄÈÀ¤ì(€€€½¹ÍÐÍÕ•ÍÑ¥½¹Ì€ô•Ñ•‰ÑI½±±½Ù•ÉMÕ•ÍÑ¥½¹Í½É5½¹Ñ ¡µ½¹Ñ¡-•ä°Á±…¸¤ì(€€€¥˜€ …ÍÕ•ÍÑ¥½¹Ì¹±•¹Ñ ¤É•ÑÕÉ¸¹Õ±°ì((€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€ÍÕˆµ…É‘•‰ÐµÉ½±±½Ù•Èµ…Éœì(€€€½¹ÍÐ €ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Ìœ¤ì(€€€ ¹Ñ•áÑ½¹Ñ•¹Ð€ô€ÕÍ±…Õ™•¹‘”I…Ñ”‰±•¥‰Ð¥´M¡Õ±‘•¹‰Õ‘•Ðœì(€€€…É¹…ÁÁ•¹‘¡¥±¡ ¤ì(€€€½¹ÍÐÀ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€À¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€À¹Ñ•áÑ½¹Ñ•¹Ð€ô€¥”M¡±ÕÍÍÉ…Ñ”‰±•¥‰Ð¹½ Ù½±±ÍÓ‘¹‘¥œ¥¸¥¡É•´±•ÑéÑ•¸5½¹…Ð¸ˆ‘•´½±•µ½¹…ÐÝ¥É‘•È	•ÑÉ…œ¥¹¹•É¡…±ˆ‘•Ì™•ÍÑ•¸€àÀÀ·Š
°µ5½¹…ÑÍé¥•±Ì›ñÈ‘¥”»‘¡ÍÑ”••¥¹•Ñ”M¡Õ±Ù½É•Í¡±…•¸¸œì(€€€…É¹…ÁÁ•¹‘¡¥±¡À¤ì(€€€½¹ÍÐ±¥ÍÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€±¥ÍÐ¹±…ÍÍ9…µ”€ô€‘•‰ÐµÉ½±±½Ù•Èµ±¥ÍÐœì(€€€ÍÕ•ÍÑ¥½¹Ì¹™½É…  ¡•¹ÑÉä¤€ôøì(€€€€€½¹ÍÐÉ½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€É½Ü¹±…ÍÍ9…µ”€ô€‘•‰ÐµÉ½±±½Ù•ÈµÉ½Üœì(€€€€€½¹ÍÐÍ½ÕÉ”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€Í½ÕÉ”¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°€Á¥±°ÍÕ•ÍÌœ°•¹ÑÉä¹ÍÑ…ÑÕÌ€ôôô€½µÁ±•Ñ•œ€ü€M¡±ÕÍÍÉ…Ñ”‰•é…¡±Ðœ€è€1•ÑéÑ”I…Ñ”¥¸‘¥•Í•´5½¹…Ðœ¤¤ì(€€€€€Í½ÕÉ”¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°•¹ÑÉä¹Í½ÕÉ••‰Ðñð€M¡Õ±œ¤¤ì(€€€€€Í½ÕÉ”¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°MÑ…¹‘…É‘É…Ñ”è€‘í•ÕÉ¼¡9Õµ‰•È¡•¹ÑÉä¹…µ½Õ¹Ðñð€À¤¥õ€¤¤ì((€€€€€½¹ÍÐÑÉ…¹Í™•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€ÑÉ…¹Í™•È¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°€‘•‰ÐµÉ½±±½Ù•Èµ…ÉÉ½Üœ°€ŸŠHœ¤¤ì(€€€€€ÑÉ…¹Í™•È¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°É•¤…ˆ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡•¹ÑÉä¹ÑÉ…¹Í™•É5½¹Ñ ¥õ€¤¤ì(€€€€€ÑÉ…¹Í™•È¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° (€€€€€€€€Íµ…±°œ°(€€€€€€€€µÕÑ•œ°(€€€€€€€•¹ÑÉä¹Ñ…É•Ñ•‰Ð(€€€€€€€€€€ü€¡•¹ÑÉä¹É•Í•ÉÙ•½ÉA…å½™˜(€€€€€€€€€€€€€€üA±…¸è€‘í•ÕÉ¼¡9Õµ‰•È¡•¹ÑÉä¹…µ½Õ¹Ðñð€À¤¥ôµ½¹…Ñ±¥ ›ñÈƒŠx‘í•¹ÑÉä¹Ñ…É•Ñ•‰Ñ÷ŠpéÕËñ­±••¸¸M½‰…±Kñ­±…”Á±ÕÌI••±É…Ñ”É•¥¡•¸°‘¥”•Í…µÑ™½É‘•ÉÕ¹œ‰•é…¡±•¸¹€(€€€€€€€€€€€€€€èY½ÉÍ¡±…œè€‘í•ÕÉ¼¡9Õµ‰•È¡•¹ÑÉä¹…µ½Õ¹Ðñð€À¤¥ôµ½¹…Ñ±¥ …Õ˜ƒŠx‘í•¹ÑÉä¹Ñ…É•Ñ•‰Ñ÷Šp±••¸¹€¤(€€€€€€€€€€è€-•¥¹”Á…ÍÍ•¹‘”I…Ñ•¹Í¡Õ±½™™•¸ƒŠL‘•È	•ÑÉ…œ‰±•¥‰Ð¥´M¡Õ±‘•¸µA½½°™É•¤¸œ(€€€€€€¤¤ì(€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡Í½ÕÉ”¤ì(€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡ÑÉ…¹Í™•È¤ì(€€€€€±¥ÍÐ¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì(€€€ô¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡±¥ÍÐ¤ì(€€€É•ÑÕÉ¸…Éì(€ô((€™Õ¹Ñ¥½¸µ…É­•‰ÑA…¥¡‘•‰Ð°Á±…¹¹•‘µ½Õ¹Ð°‰É•…­‘½Ý¸€ôíô¤ì(€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡‘•‰Ð¤ì(€€€½¹ÍÐÁ…¥‘5½¹Ñ €ôÕÉÉ•¹Ñ5½¹Ñ ì(€€€¥˜€ …¥Í5½¹Ñ¡-•ä¡Á…¥‘5½¹Ñ ¤¤ì(€€€€€…±•ÉÐ 	¥ÑÑ”éÕ•ÉÍÐ•¥¹•¸Ÿñ±Ñ¥•¸5½¹…Ð…ÕÍß‘¡±•¸¸œ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€½¹ÍÐµ¥¹¥µÕµI…Ñ”€ô9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°Á…¥‘5½¹Ñ ¤ñð•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°‘•‰Ð¹¹•áÑÕ•5½¹Ñ ñðÁ…¥‘5½¹Ñ ¤ñð€À¤ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡Á±…¹¹•‘µ½Õ¹Ðñð€À¤€ø€À€ü9Õµ‰•È¡Á±…¹¹•‘µ½Õ¹Ðñð€À¤€èµ¥¹¥µÕµI…Ñ”ì(€€€¥˜€ „¡…µ½Õ¹Ð€ø€À¤¤ì(€€€€€…±•ÉÐ ñÈ‘¥•Í”M¡Õ±¥ÍÐ¥¸‘¥•Í•´5½¹…Ð­•¥¹”i…¡±Õ¹œ•Á±…¹Ð¸œ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€½¹ÍÐÍ½ÕÉ•A…ÉÑÌ€ôlM¡Õ±‘•¹‰•É•¥ tì(€€€¥˜€¡9Õµ‰•È¡‰É•…­‘½Ý¸¹É…Ñ”ñð€À¤€ø€À¤Í½ÕÉ•A…ÉÑÌ¹ÁÕÍ ¡I…Ñ”€‘í•ÕÉ¼¡9Õµ‰•È¡‰É•…­‘½Ý¸¹É…Ñ”ñð€À¤¥õ€¤ì(€€€¥˜€¡9Õµ‰•È¡‰É•…­‘½Ý¸¹Í¹½Ý‰…±°ñð€À¤€ø€À¤Í½ÕÉ•A…ÉÑÌ¹ÁÕÍ ¡éÕÏ‘Ñé±¥¡•ÈY½ÉÍ¡±…œ€‘í•ÕÉ¼¡9Õµ‰•È¡‰É•…­‘½Ý¸¹Í¹½Ý‰…±°ñð€À¤¥õ€¤ì(€€€Í¡½Ý•‰ÑA…åµ•¹Ñ‘¥Ñ½È¡‘•‰Ð°ì(€€€€€µ½¹Ñ èÁ…¥‘5½¹Ñ °(€€€€€…µ½Õ¹Ð°(€€€€€µ½‘”è€É•Õ±…Èœ°(€€€€€Í½ÕÉ”èÍ½ÕÉ•A…ÉÑÌ¹©½¥¸ œƒ
Ü€œ¤°(€€€€€¹½Ñ”è€‘íÍ½ÕÉ•A…ÉÑÌ¹©½¥¸ œƒ
Ü€œ¥ôƒ
Ü…ÕÌ‘•´™•ÍÑ•¸M¡Õ±‘•¹‰Õ‘•Ñ€°(€€€€€Á…åµ•¹Ñ5•Ñ¡½è‘•‰Ð¹Á…åµ•¹Ñ5•Ñ¡½ñð€œœ°(€€€€€…™Ñ•ÉM…Ù”è€ ¤€ôøÍ…Ù•MÑ…Ñ” ¤(€€€ô¤ì(€ô((€™Õ¹Ñ¥½¸Í¡½Ý•‰ÑI…Ñ•‘¥Ñ½È¡‘•‰Ð¤ì(€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡‘•‰Ð¤ì(€€€½¹ÍÐÉ•™Ì€ôíôì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì((€€€½¹ÍÐ¥¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¥¹™¼¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€½¹ÍÐÕÉÉ•¹ÑI…Ñ”€ô•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€¥¹™¼¹¥¹¹•É!Q50€ô€ñÍÑÉ½¹œø‘í‘•‰Ð¹¹…µ•ôð½ÍÑÉ½¹œøñ‰Èù­ÑÕ•±±”I…Ñ”¥¸€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ôè€ñÍÑÉ½¹œø‘í•ÕÉ¼¡ÕÉÉ•¹ÑI…Ñ”¥ôð½ÍÑÉ½¹œø‘í•Ñ9•áÑ•‰ÑI…Ñ•¡…¹•Q•áÐ¡‘•‰Ð¤€ü€ñ‰Èø‘í•Ñ9•áÑ•‰ÑI…Ñ•¡…¹•Q•áÐ¡‘•‰Ð¥õ€€è€œõ€ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¥¹™¼¤ì((€€€½¹ÍÐÉ½ÜÄ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÄ¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹ÑåÁ”€ô€µ½¹Ñ œì(€€€É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹Ù…±Õ”€ô•Ñ9•áÑ±±½Ý•‘•‰ÑI…Ñ•¡…¹•5½¹Ñ ¡‘•‰Ð°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡ÕÉÉ•¹ÑI…Ñ”€ø€À€üÕÉÉ•¹ÑI…Ñ”€è€œœ¤ì(€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ñ±Ñ¥œ…ˆ5½¹…Ðœ°É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¤¤ì(€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9•Õ”I…Ñ”œ°É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½ÜÄ¤ì((€€€½¹ÍÐÉ½ÜÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÈ¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹µ½‘•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€É•™Ì¹µ½‘•M•±•Ð¹¥¹¹•É!Q50€ô€(€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰™É½µ}µ½¹Ñ ˆùˆ‘¥•Í•´5½¹…Ð‘…Õ•É¡…™Ðð½½ÁÑ¥½¸ø(€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰Í¥¹±•}µ½¹Ñ ˆù9ÕÈ‘¥•Í•È5½¹…Ðð½½ÁÑ¥½¸ø(€€€€ì(€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ñ±Ñ¥­•¥Ðœ°É•™Ì¹µ½‘•M•±•Ð¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½ÜÈ¤ì((€€€É•™Ì¹Á•¹‘¥¹¡•¬€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹Á•¹‘¥¹¡•¬¹ÑåÁ”€ô€¡•­‰½àœì(€€€É•™Ì¹Á•¹‘¥¹¡•¬¹¡•­•€ô¥Í•‰ÑI…Ñ•A•¹‘¥¹½É5½¹Ñ ¡‘•‰Ð°É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€É•™Ì¹Á•¹‘¥¹¡•¬¹¡•­•€ô¥Í•‰ÑI…Ñ•A•¹‘¥¹½É5½¹Ñ ¡‘•‰Ð°É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€ô¤ì(€€€½¹ÍÐÁ•¹‘¥¹1…‰•°€ôÉ•…Ñ•U¥° ±…‰•°œ°€¡•¬µ±¥¹”œ¤ì(€€€Á•¹‘¥¹1…‰•°¹…ÁÁ•¹‘¡¥±¡É•™Ì¹Á•¹‘¥¹¡•¬¤ì(€€€Á•¹‘¥¹1…‰•°¹…ÁÁ•¹‘¡¥±¡‘½Õµ•¹Ð¹É•…Ñ•Q•áÑ9½‘” 	•…¹ÑÉ…ÐƒŠL¹½ ¹¥¡Ð‰•Ý¥±±¥Ðœ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Á•¹‘¥¹1…‰•°¤ì((€€€½¹ÍÐÉ…Ñ•IÕ±•Q•áÐ€ô•Ñ•‰ÑI…Ñ•¡…¹•IÕ±•Q•áÐ¡‘•‰Ð¤ì(€€€¥˜€¡É…Ñ•IÕ±•Q•áÐ¤ì(€€€€€½¹ÍÐÉÕ±•%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€€€ÉÕ±•%¹™¼¹±…ÍÍ9…µ”€ô€Íµ…±°Ý…É¹¥¹œµÑ•áÐœì(€€€€€ÉÕ±•%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ôÉ…Ñ•IÕ±•Q•áÐ€¬€œ]•¹¸‘Ô•¥¹•¸…¹‘•É•¸5½¹…Ð…ÕÍß‘¡±ÍÐ°Ý¥É‘¥”ƒ¹‘•ÉÕ¹œ¹¥¡Ð•ÍÁ•¥¡•ÉÐìM½¹‘•Éé…¡±Õ¹•¸­…¹¹ÍÐ‘ÔÝ•¥Ñ•É¡¥¸ƒñ‰•ÈƒŠyi…¡±Õ¹œ•¥¹ÑÉ…•»Šp‰Õ¡•¸¸œì(€€€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡ÉÕ±•%¹™¼¤ì(€€€ô((€€€½¹ÍÐÑ¥µ•±¥¹”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€Ñ¥µ•±¥¹”¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€Ñ¥µ•±¥¹”¹¥¹¹•É!Q50€ô€ñÍÑÉ½¹œùI…Ñ•¹Ù•É±…Õ˜èð½ÍÑÉ½¹œø€‘í•Ñ•‰ÑI…Ñ•Q¥µ•±¥¹•Q•áÐ¡‘•‰Ð¤ñð€­•¥¹”…‰Ý•¥¡•¹‘”I…Ñ”¡¥¹Ñ•É±•Ðõ€ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Ñ¥µ•±¥¹”¤ì((€€€½¹ÍÐ¡¥¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¡¥¹Ð¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€¡¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô•Ñ•‰Ñ¹¹Õ…±I…Ñ•IÕ±”¡‘•‰Ð¤(€€€€€€ü€I•Õ³‘É”I…Ñ•»‘¹‘•ÉÕ¹•¸Í¥¹‰•¤‘¥•Í•ÈM¡Õ±¹ÕÈéÕ´•É±…Õ‰Ñ•¸AËñ™µ½¹…Ð·Ù±¥ ¸É•¥Ý¥±±¥”M½¹‘•Éé…¡±Õ¹•¸‰¥ÑÑ”ƒñ‰•ÈƒŠyi…¡±Õ¹œ•¥¹ÑÉ…•»Šp‰Õ¡•¸¸œ(€€€€€€è€¡•Ñ•‰ÑáÑÉ…A…åµ•¹Ñ5½‘”¡‘•‰Ð¤€ôôô€¹½¹”œ(€€€€€€€€ü€¥”¹•Õ”I…Ñ”Ý¥É¥´5½¹…ÑÍÁ±…¸‰•Ëñ­Í¥¡Ñ¥Ð¸5…É­¥•É”Í¥”…±Ì‰•…¹ÑÉ…Ð°Í½±…¹”‘¥”	•Ý¥±±¥Õ¹œ¹½ …ÕÍÍÑ•¡Ð¸M½¹‘•ÉÑ¥±Õ¹•¸‰±•¥‰•¸…ÕÍ•Í¡±½ÍÍ•¸¸œ(€€€€€€€€è€¥”¹•Õ”I…Ñ”Ý¥É¥´5½¹…ÑÍÁ±…¸…ˆ‘•´•ß‘¡±Ñ•¸5½¹…Ð‰•Ëñ­Í¥¡Ñ¥Ð¸5…É­¥•É”Í¥”…±Ì‰•…¹ÑÉ…Ð°Í½±…¹”‘¥”	•Ý¥±±¥Õ¹œ¹½ …ÕÍÍÑ•¡Ð¸œ¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¡¥¹Ð¤ì((€€€Í¡½Ý5½‘…° I…Ñ”ƒ‘¹‘•É¸œ°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤ô°(€€€€€ì(€€€€€€€±…‰•°è€MÁ•¥¡•É¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐµ½¹Ñ €ôÉ•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹Ù…±Õ”ì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ …¥Í5½¹Ñ¡-•ä¡µ½¹Ñ ¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸5½¹…Ðß‘¡±•¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹”Ÿñ±Ñ¥”I…Ñ”•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥˜€ …¥Í•‰ÑI…Ñ•¡…¹•±±½Ý•‘%¹5½¹Ñ ¡‘•‰Ð°µ½¹Ñ ¤¤ì(€€€€€€€€€€€½¹ÍÐ…±±½Ý•€ô•Ñ9•áÑ±±½Ý•‘•‰ÑI…Ñ•¡…¹•5½¹Ñ ¡‘•‰Ð°µ½¹Ñ ¤ì(€€€€€€€€€€€É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹Ù…±Õ”€ô…±±½Ý•ì(€€€€€€€€€€€É•ÑÕÉ¸…±•ÉÐ¡€‘í‘•‰Ð¹¹…µ•ôè¥”I…Ñ”‘…É˜¹ÕÈ«‘¡É±¥ éÕ´€ÀÄ¸‘íMÑÉ¥¹œ¡•Ñ•‰Ñ¹¹Õ…±I…Ñ•IÕ±”¡‘•‰Ð¤¹µ½¹Ñ ¤¹Á…‘MÑ…ÉÐ È°€œÀœ¥ô¸…¹•Á…ÍÍÐÝ•É‘•¸¸;‘¡ÍÑ•ÈéÕ³‘ÍÍ¥•È5½¹…Ðè€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡…±±½Ý•¥ô¹€¤ì(€€€€€€€€€ô(€€€€€€€€€½¹ÍÐ½±‘I…Ñ”€ô•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°µ½¹Ñ ¤ì(€€€€€€€€€½¹ÍÐÉ…Ñ•=ÁÑ¥½¹Ì€ôìµ…¹Õ…°èÑÉÕ”°Á•¹‘¥¹œèÉ•™Ì¹Á•¹‘¥¹¡•¬¹¡•­•ôì(€€€€€€€€€½¹ÍÐÁ•¹‘¥¹1½œ€ôÉ•™Ì¹Á•¹‘¥¹¡•¬¹¡•­•€ü€œ€¡‰•…¹ÑÉ…ÐƒŠL¹½ ¹¥¡Ð‰•Ý¥±±¥Ð¤œ€è€œœì(€€€€€€€€€¥˜€¡É•™Ì¹µ½‘•M•±•Ð¹Ù…±Õ”€ôôô€Í¥¹±•}µ½¹Ñ œ¤ì(€€€€€€€€€€€¥˜€ …Í•Ñ•‰ÑI…Ñ•=¹±å½É5½¹Ñ ¡‘•‰Ð°µ½¹Ñ °…µ½Õ¹Ð°É…Ñ•=ÁÑ¥½¹Ì¤¤É•ÑÕÉ¸…±•ÉÐ ¥”I…Ñ”­½¹¹Ñ”›ñÈ‘¥•Í•¸5½¹…Ð¹¥¡Ð—‘¹‘•ÉÐÝ•É‘•¸¸œ¤ì(€€€€€€€€€€€…‘‘¡…¹•1½œ M¡Õ±‘•¸œ°€‘í‘•‰Ð¹¹…µ•ôèI…Ñ”¹ÕÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡µ½¹Ñ ¥ôÙ½¸€‘í•ÕÉ¼¡½±‘I…Ñ”¥ô…Õ˜€‘í•ÕÉ¼¡…µ½Õ¹Ð¥ô—‘¹‘•ÉÐ‘íÁ•¹‘¥¹1½õ€°µ½¹Ñ ¤ì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€¥˜€ …Í•Ñ•‰ÑI…Ñ•É½µ5½¹Ñ ¡‘•‰Ð°µ½¹Ñ °…µ½Õ¹Ð°É…Ñ•=ÁÑ¥½¹Ì¤¤É•ÑÕÉ¸…±•ÉÐ ¥”I…Ñ”­½¹¹Ñ”…ˆ‘¥•Í•´5½¹…Ð¹¥¡Ð—‘¹‘•ÉÐÝ•É‘•¸¸œ¤ì(€€€€€€€€€€€…‘‘¡…¹•1½œ M¡Õ±‘•¸œ°€‘í‘•‰Ð¹¹…µ•ôèI…Ñ”…ˆ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡µ½¹Ñ ¥ôÙ½¸€‘í•ÕÉ¼¡½±‘I…Ñ”¥ô…Õ˜€‘í•ÕÉ¼¡…µ½Õ¹Ð¥ô—‘¹‘•ÉÐ‘íÁ•¹‘¥¹1½õ€°µ½¹Ñ ¤ì(€€€€€€€€€ô(€€€€€€€€€¥˜€¡‘•‰Ð¹Á…åµ•¹ÑQåÁ”€ôôô€½Á•¹}Á±…¸œ€˜˜…µ½Õ¹Ð€ø€À¤‘•‰Ð¹Á…åµ•¹ÑQåÁ”€ô€¥¹ÍÑ…±±µ•¹Ðœì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸Í¡½Ý•‰ÑA…åµ•¹Ñ‘¥Ñ½È¡‘•‰Ð°‘•™…Õ±ÑÌ€ôíô¤ì(€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡‘•‰Ð¤ì(€€€½¹ÍÐÉ•™Ì€ôíôì(€€€½¹ÍÐÁ…åµ•¹Ñ5½‘”€ô•Ñ•‰ÑáÑÉ…A…åµ•¹Ñ5½‘”¡‘•‰Ð¤ì(€€€½¹ÍÐ™Õ±±A…å½™™=¹±ä€ôÁ…åµ•¹Ñ5½‘”€ôôô€™Õ±±}Á…å½™™}½¹±äœì(€€€½¹ÍÐÉ•Õ±…É=¹±ä€ôÁ…åµ•¹Ñ5½‘”€ôôô€¹½¹”œ€˜˜‘•™…Õ±ÑÌ¹…±±½ÝU¹É•ÍÑÉ¥Ñ•‘A…åµ•¹Ð€„ôôÑÉÕ”ì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì((€€€½¹ÍÐ¥¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¥¹™¼¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€¥¹™¼¹¥¹¹•É!Q50€ô€ñÍÑÉ½¹œø‘í‘•‰Ð¹¹…µ•ôð½ÍÑÉ½¹œøƒ
Ü=™™•¸è€‘í•ÕÉ¼¡9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤¥ôƒ
ÜI…Ñ”è€‘í•ÕÉ¼¡9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°ÕÉÉ•¹Ñ5½¹Ñ ¤ñð€À¤¥õ€ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¥¹™¼¤ì((€€€½¹ÍÐÉ½ÜÄ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÄ¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹ÑåÁ”€ô€µ½¹Ñ œì(€€€É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹Ù…±Õ”€ô¥Í5½¹Ñ¡-•ä¡‘•™…Õ±ÑÌ¹µ½¹Ñ ¤(€€€€€€ü‘•™…Õ±ÑÌ¹µ½¹Ñ (€€€€€€è€¡¥Í5½¹Ñ¡-•ä¡‘•‰Ð¹¹•áÑÕ•5½¹Ñ ¤€ü‘•‰Ð¹¹•áÑÕ•5½¹Ñ €èÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ‘•™…Õ±ÑI…Ñ”€ô9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°ÕÉÉ•¹Ñ5½¹Ñ ¤ñð€À¤ì(€€€½¹ÍÐÉ•ÅÕ•ÍÑ•‘µ½Õ¹Ð€ô9Õµ‰•È¡‘•™…Õ±ÑÌ¹…µ½Õ¹Ðñð€À¤€ø€À€ü9Õµ‰•È¡‘•™…Õ±ÑÌ¹…µ½Õ¹Ð¤€è€Àì(€€€É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡É•ÅÕ•ÍÑ•‘µ½Õ¹Ð€ø€À€üÉ•ÅÕ•ÍÑ•‘µ½Õ¹Ð€è€¡‘•™…Õ±ÑI…Ñ”€ø€À€ü‘•™…Õ±ÑI…Ñ”€è€œœ¤¤ì(€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i…¡±Õ¹Íµ½¹…Ðœ°É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¤¤ì(€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•ÑÉ…œœ°É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½ÜÄ¤ì((€€€½¹ÍÐÉ½ÜÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÈ¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹ÑåÁ•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€É•™Ì¹ÑåÁ•M•±•Ð¹¥¹¹•É!Q50€ô™Õ±±A…å½™™=¹±ä(€€€€€€ü€(€€€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰É•Õ±…ÈˆùY•É•¥¹‰…ÉÑ”I…Ñ”‰•é…¡±•¸ð½½ÁÑ¥½¸ø(€€€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰•áÑÉ„ˆù•Í…µÑ”½É‘•ÉÕ¹œÙ½±±ÍÓ‘¹‘¥œ‰•é…¡±•¸ð½½ÁÑ¥½¸ø(€€€€€€(€€€€€€è€¡É•Õ±…É=¹±ä(€€€€€€€€ü€œñ½ÁÑ¥½¸Ù…±Õ”ô‰É•Õ±…ÈˆùY•É•¥¹‰…ÉÑ”I…Ñ”‰•é…¡±•¸ð½½ÁÑ¥½¸øœ(€€€€€€€€è€(€€€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰É•Õ±…ÈˆùI••±É…Ñ”…±Ì‰•é…¡±Ðµ…É­¥•É•¸ð½½ÁÑ¥½¸ø(€€€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰Á…ÉÑ¥…°ˆùQ•¥±é…¡±Õ¹œ½¡¹”5½¹…ÑÍ…‰Í¡±ÕÍÌð½½ÁÑ¥½¸ø(€€€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰•áÑÉ„ˆùM½¹‘•Éé…¡±Õ¹œ½¡¹”5½¹…ÑÍ…‰Í¡±ÕÍÌð½½ÁÑ¥½¸ø(€€€€€€¤ì(€€€½¹ÍÐ…±±½Ý•‘A…åµ•¹Ñ5½‘•Ì€ô™Õ±±A…å½™™=¹±ä€ülÉ•Õ±…Èœ°€•áÑÉ„t€è€¡É•Õ±…É=¹±ä€ülÉ•Õ±…Èt€èlÉ•Õ±…Èœ°€Á…ÉÑ¥…°œ°€•áÑÉ„t¤ì(€€€¥˜€¡…±±½Ý•‘A…åµ•¹Ñ5½‘•Ì¹¥¹±Õ‘•Ì¡‘•™…Õ±ÑÌ¹µ½‘”¤¤É•™Ì¹ÑåÁ•M•±•Ð¹Ù…±Õ”€ô‘•™…Õ±ÑÌ¹µ½‘”ì(€€€É•™Ì¹¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹¹½Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€É•™Ì¹¹½Ñ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€9½Ñ¥è½ÁÑ¥½¹…°œì(€€€É•™Ì¹¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô‘•™…Õ±ÑÌ¹¹½Ñ”ñð€œœì(€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ M¡Õ±‘é…¡±Õ¹œœ°É•™Ì¹ÑåÁ•M•±•Ð¤¤ì(€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥èœ°É•™Ì¹¹½Ñ•%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½ÜÈ¤ì((€€€½¹ÍÐÁ…åµ•¹ÑI½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Á…åµ•¹ÑI½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€…ÁÁ•¹‘!½ÕÍ•¡½±‘A…åµ•¹Ñ5•Ñ¡½‘¥•±¡Á…åµ•¹ÑI½Ü°É•™Ì°‘•™…Õ±ÑÌ°ì‘•™…Õ±ÑY…±Õ”è€ÑÉ…¹Í™•Èœô¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Á…åµ•¹ÑI½Ü¤ì((€€€¥˜€¡™Õ±±A…å½™™=¹±ä¤ì(€€€€€½¹ÍÐÉ•‘¥Ñ½É%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€É•‘¥Ñ½É%¹™¼¹±…ÍÍ9…µ”€ô€¹½Ñ¥”¥¹™¼œì(€€€€€É•‘¥Ñ½É%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ô€	•¤‘¥•Í•´i…¡±Õ¹ÍÁ±…¸Í¥¹¹ÕÈ‘¥”Ù•É•¥¹‰…ÉÑ”I…Ñ”½‘•È‘¥”Ù½±±ÍÓ‘¹‘¥”•Í…µÑ™½É‘•ÉÕ¹œ·Ù±¥ ¸¥¹é•±¹”M½¹‘•Éé…¡±Õ¹•¸Ý•É‘•¸‘•Í¡…±ˆ¹¥¡Ð…¹•‰½Ñ•¸¸œì(€€€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•‘¥Ñ½É%¹™¼¤ì(€€€€€½¹ÍÐÍå¹Õ±±A…å½™™µ½Õ¹Ð€ô€ ¤€ôøì(€€€€€€€½¹ÍÐÑ½Ñ…°€ô5…Ñ ¹µ…à À°9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤¤ì(€€€€€€€½¹ÍÐÉ…Ñ”€ô5…Ñ ¹µ¥¸¡Ñ½Ñ…°°5…Ñ ¹µ…à À°9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹Ù…±Õ”ñðÕÉÉ•¹Ñ5½¹Ñ ¤ñð‘•™…Õ±ÑI…Ñ”¤¤¤ì(€€€€€€€É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”€ô™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡É•™Ì¹ÑåÁ•M•±•Ð¹Ù…±Õ”€ôôô€•áÑÉ„œ€üÑ½Ñ…°€èÉ…Ñ”¤ì(€€€€€€€É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ¹É•…‘=¹±ä€ôÑÉÕ”ì(€€€€€ôì(€€€€€É•™Ì¹ÑåÁ•M•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°Íå¹Õ±±A…å½™™µ½Õ¹Ð¤ì(€€€€€É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°Íå¹Õ±±A…å½™™µ½Õ¹Ð¤ì(€€€€€Íå¹Õ±±A…å½™™µ½Õ¹Ð ¤ì(€€€ô•±Í”¥˜€¡É•Õ±…É=¹±ä¤ì(€€€€€½¹ÍÐÉ•‘¥Ñ½É%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€É•‘¥Ñ½É%¹™¼¹±…ÍÍ9…µ”€ô€¹½Ñ¥”¥¹™¼œì(€€€€€É•‘¥Ñ½É%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ô¥¹™•É•‰ÑA…åµ•¹ÑIÕ±•5½‘”¡‘•‰Ð¤€ôôô€Á…åµ•¹Ñ}¥¹™½}µ¥ÍÍ¥¹œœ(€€€€€€€€ü€ñÈ‘¥•Í”M¡Õ±¥ÍÐ­•¥¸i…¡±Õ¹ÍÝ•œ›ñÈ™É•¥Ý¥±±¥”i…¡±Õ¹•¸¡¥¹Ñ•É±•Ð¸•Í¡…±ˆ­…¹¸¡¥•È¹ÕÈ‘¥”Ù•É•¥¹‰…ÉÑ”I…Ñ”•¥¹•ÑÉ…•¸Ý•É‘•¸¸œ(€€€€€€€€è€ñÈ‘¥•Í”M¡Õ±¥ÍÐ…ÕÍÍ¡±¥—}±¥ ‘¥”Ù•É•¥¹‰…ÉÑ”I…Ñ”•É±…Õ‰Ð¸Q•¥°´Õ¹M½¹‘•Éé…¡±Õ¹•¸Ý•É‘•¸‘•Í¡…±ˆ¹¥¡Ð…¹•‰½Ñ•¸¸œì(€€€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•‘¥Ñ½É%¹™¼¤ì(€€€€€½¹ÍÐÍå¹I•Õ±…ÉA…åµ•¹Ñµ½Õ¹Ð€ô€ ¤€ôøì(€€€€€€€½¹ÍÐÑ½Ñ…°€ô5…Ñ ¹µ…à À°9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤¤ì(€€€€€€€½¹ÍÐÉ…Ñ”€ô5…Ñ ¹µ¥¸¡Ñ½Ñ…°°5…Ñ ¹µ…à À°9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹Ù…±Õ”ñðÕÉÉ•¹Ñ5½¹Ñ ¤ñð‘•™…Õ±ÑI…Ñ”¤¤¤ì(€€€€€€€É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”€ô™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡É…Ñ”¤ì(€€€€€€€É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ¹É•…‘=¹±ä€ôÑÉÕ”ì(€€€€€ôì(€€€€€É•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°Íå¹I•Õ±…ÉA…åµ•¹Ñµ½Õ¹Ð¤ì(€€€€€Íå¹I•Õ±…ÉA…åµ•¹Ñµ½Õ¹Ð ¤ì(€€€ô((€€€¥˜€¡‘•™…Õ±ÑÌ¹µ½‘”€ôôô€•áÑÉ„œ€˜˜€…É•Õ±…É=¹±ä¤ì(€€€€€½¹ÍÐÍÕ•ÍÑ¥½¹%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€ÍÕ•ÍÑ¥½¹%¹™¼¹±…ÍÍ9…µ”€ô€¹½Ñ¥”ÍÕ•ÍÌœì(€€€€€ÍÕ•ÍÑ¥½¹%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ô™Õ±±A…å½™™=¹±ä(€€€€€€€€ü€¥”Ù½±±ÍÓ‘¹‘¥”‰³ÙÍÕ¹œ¥ÍÐÙ½É‰•É•¥Ñ•Ð¸	¥ÑÑ”‘•¸…­ÑÕ•±±•¸•Í…µÑ‰•ÑÉ…œ‰•¥´¹‰¥•Ñ•ÈÁËñ™•¸ì•ÉÍÐµ¥ÐƒŠyMÁ•¥¡•É»ŠpÝ¥É‘¥”M¡Õ±…±Ì‰•é…¡±Ðƒñ‰•É¹½µµ•¸¸œ(€€€€€€€€è€É•¥Ý¥±±¥•È‘å¹…µ¥Í¡•ÈY½ÉÍ¡±…œè	•ÑÉ…œÕ¹5½¹…ÐÍ¥¹Ù½É‰•É•¥Ñ•Ð°Ý•É‘•¸…‰•È•ÉÍÐµ¥ÐƒŠyMÁ•¥¡•É»Šp…±Ì•¡Ñ”M½¹‘•Éé…¡±Õ¹œƒñ‰•É¹½µµ•¸¸œì(€€€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡ÍÕ•ÍÑ¥½¹%¹™¼¤ì(€€€ô((€€€¥˜€¡‘•‰Ð€˜˜•Ñ•‰ÑI…Ñ•Q¥µ•±¥¹•Q•áÐ¡‘•‰Ð¤¤ì(€€€€€½¹ÍÐÑ¥µ•±¥¹•%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€€€Ñ¥µ•±¥¹•%¹™¼¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€€€Ñ¥µ•±¥¹•%¹™¼¹¥¹¹•É!Q50€ô€ñÍÑÉ½¹œù­ÑÕ•±±•ÈI…Ñ•¹Ù•É±…Õ˜èð½ÍÑÉ½¹œø€‘í•Ñ•‰ÑI…Ñ•Q¥µ•±¥¹•Q•áÐ¡‘•‰Ð¥õ€ì(€€€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Ñ¥µ•±¥¹•%¹™¼¤ì(€€€ô((€€€É•™Ì¹‰½½­½Õ¹Ñ¡•¬€ôì¡•­•è™…±Í”ôì(€€€½¹ÍÐ¡¥¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¡¥¹Ð¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€¡¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô€	•¤•¥¹•ÈI••±É…Ñ”Ý¥É‘•ÈÙ•É­»ñÁ™Ñ”-½ÍÑ•¹Á½ÍÑ•¸…ÕÑ½µ…Ñ¥Í µ¥Ð‘•´I…Ñ•¹‰•ÑÉ…œ…±Ì‰•é…¡±Ðµ…É­¥•ÉÐ¸M½¹‘•Éé…¡±Õ¹•¸‰±•¥‰•¸…ÕÍÍ¡±¥—}±¥ ¥´M¡Õ±‘•¹Á±…¸¸¥”5½¹…ÑÍ…ÕÍ…‰”Ý¥É‘…‘ÕÉ ¹¥¡Ð‘½ÁÁ•±Ð…‰•é½•¸¸œì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¡¥¹Ð¤ì((€€€Í¡½Ý5½‘…° i…¡±Õ¹œ•¥¹ÑÉ…•¸œ°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤ô°(€€€€€ì(€€€€€€€±…‰•°è€MÁ•¥¡•É¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐµ½¹Ñ €ôÉ•™Ì¹µ½¹Ñ¡%¹ÁÕÐ¹Ù…±Õ”ì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡É•™Ì¹…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ …¥Í5½¹Ñ¡-•ä¡µ½¹Ñ ¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸5½¹…Ðß‘¡±•¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ðô€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸	•ÑÉ…œ•¥¹•‰•¸¸œ¤ì(€€€€€€€€€½¹ÍÐµ½‘”€ôÉ•™Ì¹ÑåÁ•M•±•Ð¹Ù…±Õ”ì(€€€€€€€€€¥˜€ ¡µ½‘”€ôôô€Á…ÉÑ¥…°œñðµ½‘”€ôôô€•áÑÉ„œ¤€˜˜€…¥Í•‰ÑáÑÉ…A…åµ•¹Ñ±±½Ý•¡‘•‰Ð¤€˜˜‘•™…Õ±ÑÌ¹…±±½ÝU¹É•ÍÑÉ¥Ñ•‘A…åµ•¹Ð€„ôôÑÉÕ”¤ì(€€€€€€€€€€€É•ÑÕÉ¸…±•ÉÐ¡€‘í‘•‰Ð¹¹…µ•ôèñÈ‘¥•Í”M¡Õ±Í¥¹­•¥¹”™É•¥Ý¥±±¥•¸M½¹‘•Éé…¡±Õ¹•¸•É±…Õ‰Ð¹€¤ì(€€€€€€€€€ô(€€€€€€€€€¥˜€¡™Õ±±A…å½™™=¹±ä¤ì(€€€€€€€€€€€½¹ÍÐ½Á•¸€ô9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤ì(€€€€€€€€€€€½¹ÍÐ½¹ÑÉ…ÑÕ…±I…Ñ”€ô5…Ñ ¹µ¥¸¡½Á•¸°9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°µ½¹Ñ ¤ñð‘•™…Õ±ÑI…Ñ”ñð€À¤¤ì(€€€€€€€€€€€¥˜€¡µ½‘”€ôôô€É•Õ±…Èœ€˜˜5…Ñ ¹…‰Ì¡…µ½Õ¹Ð€´½¹ÑÉ…ÑÕ…±I…Ñ”¤€ø€À¸ÀÄ¤ì(€€€€€€€€€€€€€É•ÑÕÉ¸…±•ÉÐ¡€‘í‘•‰Ð¹¹…µ•ôè	¥ÑÑ”‘¥”Ù•É•¥¹‰…ÉÑ”I…Ñ”Ù½¸€‘í•ÕÉ¼¡½¹ÑÉ…ÑÕ…±I…Ñ”¥ôÙ•ÉÝ•¹‘•¸¹€¤ì(€€€€€€€€€€€ô(€€€€€€€€€€€¥˜€¡µ½‘”€ôôô€•áÑÉ„œ€˜˜5…Ñ ¹…‰Ì¡…µ½Õ¹Ð€´½Á•¸¤€ø€À¸ÀÄ¤ì(€€€€€€€€€€€€€É•ÑÕÉ¸…±•ÉÐ¡€‘í‘•‰Ð¹¹…µ•ôè¥¹”éÕÏ‘Ñé±¥¡”i…¡±Õ¹œ¥ÍÐ¹ÕÈ…±ÌÙ½±±ÍÓ‘¹‘¥”•Í…µÑ™½É‘•ÉÕ¹œÙ½¸€‘í•ÕÉ¼¡½Á•¸¥ô·Ù±¥ ¹€¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô•±Í”¥˜€¡É•Õ±…É=¹±ä¤ì(€€€€€€€€€€€½¹ÍÐ½Á•¸€ô9Õµ‰•È¡‘•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤ì(€€€€€€€€€€€½¹ÍÐ½¹ÑÉ…ÑÕ…±I…Ñ”€ô5…Ñ ¹µ¥¸¡½Á•¸°9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°µ½¹Ñ ¤ñð‘•™…Õ±ÑI…Ñ”ñð€À¤¤ì(€€€€€€€€€€€¥˜€¡µ½‘”€„ôô€É•Õ±…Èœñð5…Ñ ¹…‰Ì¡…µ½Õ¹Ð€´½¹ÑÉ…ÑÕ…±I…Ñ”¤€ø€À¸ÀÄ¤ì(€€€€€€€€€€€€€É•ÑÕÉ¸…±•ÉÐ¡€‘í‘•‰Ð¹¹…µ•ôè	¥ÑÑ”¹ÕÈ‘¥”Ù•É•¥¹‰…ÉÑ”I…Ñ”Ù½¸€‘í•ÕÉ¼¡½¹ÑÉ…ÑÕ…±I…Ñ”¥ôÙ•ÉÝ•¹‘•¸¹€¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€€€½¹ÍÐµ…É­Í5½¹Ñ¡±ä€ôµ½‘”€ôôô€É•Õ±…Èœì(€€€€€€€€€¥˜€¡µ…É­Í5½¹Ñ¡±ä€˜˜€„¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°ÕÉÉ•¹Ñ5½¹Ñ ¤€ø€À¤¤É•ÑÕÉ¸…±•ÉÐ ñÈ•¥¹”I••±É…Ñ”µÕÍÌéÕ•ÉÍÐ•¥¹”5½¹…ÑÍÉ…Ñ”¡¥¹Ñ•É±•ÐÍ•¥¸¸œ¤ì(€€€€€€€€€¥˜€¡…‘‘•‰ÑA…åµ•¹Ð¡‘•‰Ð°ì(€€€€€€€€€€€µ½¹Ñ °(€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€Í½ÕÉ”è‘•™…Õ±ÑÌ¹Í½ÕÉ”ñð€¡µ½‘”€ôôô€É•Õ±…Èœ€ü€I••±É…Ñ”œ€è€¡µ½‘”€ôôô€Á…ÉÑ¥…°œ€ü€Q•¥±é…¡±Õ¹œœ€è€¡™Õ±±A…å½™™=¹±ä€ü€•Í…µÑ…‰³ÙÍÕ¹œœ€è€M½¹‘•Éé…¡±Õ¹œœ¤¤¤°(€€€€€€€€€€€¹½Ñ”èÉ•™Ì¹¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤°(€€€€€€€€€€€Á…åµ•¹Ñ5•Ñ¡½è¹½Éµ…±¥é•!½ÕÍ•¡½±‘A…åµ•¹Ñ5•Ñ¡½¡É•™Ì¹Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹Ù…±Õ”¤°(€€€€€€€€€€€µ…É­Í5½¹Ñ¡±ä°(€€€€€€€€€€€±¥¹­•‘A½ÍÑµ½Õ¹Ðèµ…É­Í5½¹Ñ¡±ä(€€€€€€€€€€€€€€ü5…Ñ ¹µ¥¸¡…µ½Õ¹Ð°9Õµ‰•È¡•Ñ•‰ÑI…Ñ•½É5½¹Ñ ¡‘•‰Ð°µ½¹Ñ ¤ñð‘•™…Õ±ÑI…Ñ”ñð…µ½Õ¹Ð¤¤(€€€€€€€€€€€€€€èÕ¹‘•™¥¹•°(€€€€€€€€€€€‰½½­½Õ¹ÑQÉ…¹Í…Ñ¥½¸è=U9QM}9	1€˜˜É•™Ì¹‰½½­½Õ¹Ñ¡•¬¹¡•­•(€€€€€€€€€ô¤¤ì(€€€€€€€€€€€¥˜€¡9Õµ‰•È¡‘•™…Õ±ÑÌ¹‘•‰ÑI•Í•ÉÙ•]¥Ñ¡‘É…Ý…±µ½Õ¹Ðñð€À¤€ø€À¤ì(€€€€€€€€€€€€€É•½É‘•‰ÑM…Ù¥¹Í]¥Ñ¡‘É…Ý…° (€€€€€€€€€€€€€€€‘•™…Õ±ÑÌ¹‘•‰ÑI•Í•ÉÙ•]¥Ñ¡‘É…Ý…±Ñ¥½¹-•äñð€‘íµ½¹Ñ¡õð‘í‘•‰Ð¹¥‘õñÉ•Í•ÉÙ”µÝ¥Ñ¡‘É…Ý…±€°(€€€€€€€€€€€€€€€µ½¹Ñ °(€€€€€€€€€€€€€€€9Õµ‰•È¡‘•™…Õ±ÑÌ¹‘•‰ÑI•Í•ÉÙ•]¥Ñ¡‘É…Ý…±µ½Õ¹Ðñð€À¤°(€€€€€€€€€€€€€€€‘•‰Ð(€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€ô(€€€€€€€€€€€¥˜€¡9Õµ‰•È¡‘•™…Õ±ÑÌ¹‘•‰ÑI•Í•ÉÙ•I•µ…¥¹‘•Éµ½Õ¹Ðñð€À¤€ø€À¤ì(€€€€€€€€€€€€€Í•ÑI•½É‘•‘•‰ÑM…Ù¥¹Í•Á½Í¥Ð (€€€€€€€€€€€€€€€‘•™…Õ±ÑÌ¹‘•‰ÑI•Í•ÉÙ•I•µ…¥¹‘•ÉÑ¥½¹-•äñð€‘íµ½¹Ñ¡õð‘í‘•‰Ð¹¥‘õñÉ•Í•ÉÙ”µÉ•µ…¥¹‘•É€°(€€€€€€€€€€€€€€€µ½¹Ñ °(€€€€€€€€€€€€€€€9Õµ‰•È¡‘•™…Õ±ÑÌ¹‘•‰ÑI•Í•ÉÙ•I•µ…¥¹‘•Éµ½Õ¹Ðñð€À¤°(€€€€€€€€€€€€€€€ÑÉÕ”(€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€ô(€€€€€€€€€€€¥˜€¡ÑåÁ•½˜‘•™…Õ±ÑÌ¹…™Ñ•ÉM…Ù”€ôôô€™Õ¹Ñ¥½¸œ¤‘•™…Õ±ÑÌ¹…™Ñ•ÉM…Ù” ¤ì(€€€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€±½Í” ¤ì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€…±•ÉÐ ¥”i…¡±Õ¹œ­½¹¹Ñ”¹¥¡Ð•¥¹•ÑÉ…•¸Ý•É‘•¸¸œ¤ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸Í¡½Ý•‰Ñ‘¥Ñ½È¡•‘¥Ñ•‰Ð¤ì(€€€½¹ÍÐÉ•™Ì€ôíôì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì((€€€½¹ÍÐÉ½ÜÄ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÄ¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹¹…µ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¥˜€¡•‘¥Ñ•‰Ð¤•¹ÍÕÉ••‰Ñ½¹™¥œ¡•‘¥Ñ•‰Ð¤ì(€€€É•™Ì¹¹…µ•%¹ÁÕÐ¹Ù…±Õ”€ô•‘¥Ñ•‰Ð€ü•‘¥Ñ•‰Ð¹¹…µ”€è€œœì(€€€É•™Ì¹½Á•¹%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡•‘¥Ñ•‰Ð€ü•‘¥Ñ•‰Ð¹…µ½Õ¹Ñ=Á•¸€è€œœ¤ì(€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9…µ”‘•ÈM¡Õ±œ°É•™Ì¹¹…µ•%¹ÁÕÐ¤¤ì(€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ =™™•¹•È	•ÑÉ…œœ°É•™Ì¹½Á•¹%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½ÜÄ¤ì((€€€½¹ÍÐÑåÁ•I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€ÑåÁ•I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹Á…åµ•¹ÑQåÁ•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€É•™Ì¹Á…åµ•¹ÑQåÁ•M•±•Ð¹¥¹¹•É!Q50€ô€(€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰¥¹ÍÑ…±±µ•¹ÐˆùI…Ñ•¹é…¡±Õ¹œð½½ÁÑ¥½¸ø(€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰½¹•}Ñ¥µ”ˆù¥¹µ…±é…¡±Õ¹œð½½ÁÑ¥½¸ø(€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰½Á•¹}Á±…¸ˆùI…Ñ•¹Á±…¸½™™•¸ð½½ÁÑ¥½¸ø(€€€€ì(€€€É•™Ì¹Á…åµ•¹ÑQåÁ•M•±•Ð¹Ù…±Õ”€ô•‘¥Ñ•‰Ð€ü€¡•‘¥Ñ•‰Ð¹Á…åµ•¹ÑQåÁ”ñð¥¹™•É•‰ÑA…åµ•¹ÑQåÁ”¡•‘¥Ñ•‰Ð¤¤€è€¥¹ÍÑ…±±µ•¹Ðœì(€€€ÑåÁ•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i…¡±Õ¹Í…ÉÐœ°É•™Ì¹Á…åµ•¹ÑQåÁ•M•±•Ð¤¤ì(€€€É•™Ì¹‰…±…¹•¡•­5½‘•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€É•™Ì¹‰…±…¹•¡•­5½‘•M•±•Ð¹¥¹¹•É!Q50€ô€(€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰µ½¹Ñ¡±äˆù5½¹…Ñ±¥ ƒ
ÜMÑ…¹•¥¹Í•¡‰…Èð½½ÁÑ¥½¸ø(€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰…¹¹Õ…°ˆù+‘¡É±¥ ƒ
ÜMÑ…¹¹¥¡Ð±…Õ™•¹•¥¹Í•¡‰…Èð½½ÁÑ¥½¸ø(€€€€ì(€€€É•™Ì¹‰…±…¹•¡•­5½‘•M•±•Ð¹Ù…±Õ”€ô•‘¥Ñ•‰Ð€˜˜•‘¥Ñ•‰Ð¹‰…±…¹•¡•­5½‘”€ôôô€µ½¹Ñ¡±äœ€ü€µ½¹Ñ¡±äœ€è€…¹¹Õ…°œì(€€€ÑåÁ•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ M¡Õ±‘•¹ÍÑ…¹ÁËñ™•¸œ°É•™Ì¹‰…±…¹•¡•­5½‘•M•±•Ð¤¤ì(€€€É•™Ì¹…½Õ¹ÑM•±•Ð€ôìÙ…±Õ”è€œœôì(€€€¥˜€¡=U9QM}9	1¤ì(€€€€€É•™Ì¹…½Õ¹ÑM•±•Ð€ôÉ•…Ñ•½Õ¹ÑM•±•Ð¡•‘¥Ñ•‰Ð€ü•‘¥Ñ•‰Ð¹…½Õ¹Ñ%€è•Ñ•™…Õ±Ñ½Õ¹Ñ%‘½É½¹Ñ•áÐ Á•ÉÍ½¹…°œ°€‰•¹¹äœ¤°ì¥¹±Õ‘•9½¹”èÑÉÕ”ô¤ì(€€€€€ÑåÁ•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i…¡±Õ¹Í­½¹Ñ¼œ°É•™Ì¹…½Õ¹ÑM•±•Ð¤¤ì(€€€ô(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡ÑåÁ•I½Ü¤ì((€€€½¹ÍÐÁ…åµ•¹ÑIÕ±•I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Á…åµ•¹ÑIÕ±•I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹Á…åµ•¹ÑIÕ±•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€•Ñ•‰ÑA…åµ•¹ÑIÕ±•=ÁÑ¥½¹Ì ¤¹™½É…  ¡mÙ…±Õ”°±…‰•±t¤€ôøì(€€€€€½¹ÍÐ½ÁÑ¥½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€½ÁÑ¥½¸¹Ù…±Õ”€ôÙ…±Õ”ì(€€€€€½ÁÑ¥½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô±…‰•°ì(€€€€€É•™Ì¹Á…åµ•¹ÑIÕ±•M•±•Ð¹…ÁÁ•¹‘¡¥±¡½ÁÑ¥½¸¤ì(€€€ô¤ì(€€€É•™Ì¹Á…åµ•¹ÑIÕ±•M•±•Ð¹Ù…±Õ”€ô•‘¥Ñ•‰Ð€ü¥¹™•É•‰ÑA…åµ•¹ÑIÕ±•5½‘”¡•‘¥Ñ•‰Ð¤€è€™±•á¥‰±”œì(€€€Á…åµ•¹ÑIÕ±•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i…¡±Õ¹Í·Ù±¥¡­•¥Ðœ°É•™Ì¹Á…åµ•¹ÑIÕ±•M•±•Ð¤¤ì(€€€Á…åµ•¹ÑIÕ±•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥•Í”ÕÍÝ…¡°ÍÑ•Õ•ÉÐ…ÕÑ½µ…Ñ¥Í °½ˆ‘¥”M¡Õ±›ñÈM½¹‘•Éé…¡±Õ¹•¸°•Í…µÑ…‰³ÙÍÕ¹œÕ¹‘…ÌéÕÏ‘Ñé±¥¡”€àÀÀ·Š
°µ	Õ‘•ÐÙ•ÉÝ•¹‘•ÐÝ•É‘•¸‘…É˜¸œ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Á…åµ•¹ÑIÕ±•I½Ü¤ì((€€€½¹ÍÐÉ½ÜÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÈ¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹É…Ñ•%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡•‘¥Ñ•‰Ð€ü•‘¥Ñ•‰Ð¹µ½¹Ñ¡±åI…Ñ”€è€œœ¤ì(€€€É•™Ì¹‘Õ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹‘Õ•%¹ÁÕÐ¹ÑåÁ”€ô€µ½¹Ñ œì(€€€É•™Ì¹‘Õ•%¹ÁÕÐ¹Ù…±Õ”€ô•‘¥Ñ•‰Ð€ü•‘¥Ñ•‰Ð¹¹•áÑÕ•5½¹Ñ €èÕÉÉ•¹Ñ5½¹Ñ ì(€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 5½¹…ÑÍÉ…Ñ”œ°É•™Ì¹É…Ñ•%¹ÁÕÐ¤¤ì(€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ;‘¡ÍÑ”‘±±¥­•¥Ðœ°É•™Ì¹‘Õ•%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½ÜÈ¤ì((€€€½¹ÍÐ¡¥¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¡¥¹Ð¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€¡¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô€¥”ÁÀ™É…Ð•¥¹Í•¡‰…É”M¡Õ±‘•¹ÍÓ‘¹‘”µ½¹…Ñ±¥ …ˆ°…±±”…¹‘•É•¸¹ÕÈ…±±”éßÙ±˜5½¹…Ñ”¸ˆ=­Ñ½‰•È€ÈÀÈØÝ•É‘•¸¥¹Í•Í…µÐ€àÀÀƒŠ
°µ½¹…Ñ±¥ •¥¹•Á±…¹Ðì‘¥”•ß‘¡±Ñ”i…¡±Õ¹Í·Ù±¥¡­•¥Ð•¹ÑÍ¡•¥‘•Ð…ÕÑ½µ…Ñ¥Í °Ý•±¡”M¡Õ±éÕÏ‘Ñé±¥¡”	•ÑË‘”•É¡…±Ñ•¸‘…É˜¸œì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¡¥¹Ð¤ì((€€€Í¡½Ý5½‘…°¡•‘¥Ñ•‰Ð€ü€M¡Õ±‰•…É‰•¥Ñ•¸œ€è€9•Õ”M¡Õ±…¹±••¸œ°½¹Ñ•¹Ð°l(€€€€€ì(€€€€€€€±…‰•°è€‰‰É•¡•¸œ°(€€€€€€€±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤(€€€€€ô°(€€€€€ì(€€€€€€€±…‰•°è•‘¥Ñ•‰Ð€ü€MÁ•¥¡•É¸œ€è€¹±••¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ¹…µ”€ôÉ•™Ì¹¹…µ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€€€€€½¹ÍÐ½Á•¸€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡É•™Ì¹½Á•¹%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€±•ÐÉ…Ñ”€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡É•™Ì¹É…Ñ•%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€½¹ÍÐ‘Õ”€ôÉ•™Ì¹‘Õ•%¹ÁÕÐ¹Ù…±Õ”ì(€€€€€€€€€½¹ÍÐÁ…åµ•¹ÑQåÁ”€ôÉ•™Ì¹Á…åµ•¹ÑQåÁ•M•±•Ð¹Ù…±Õ”ì(€€€€€€€€€½¹ÍÐÁ…åµ•¹ÑIÕ±•5½‘”€ô	Q}Ae59Q}IU1}5=L¹¥¹±Õ‘•Ì¡É•™Ì¹Á…åµ•¹ÑIÕ±•M•±•Ð¹Ù…±Õ”¤€üÉ•™Ì¹Á…åµ•¹ÑIÕ±•M•±•Ð¹Ù…±Õ”€è€™±•á¥‰±”œì(€€€€€€€€€½¹ÍÐ‰…±…¹•¡•­5½‘”€ôÉ•™Ì¹‰…±…¹•¡•­5½‘•M•±•Ð¹Ù…±Õ”€ôôô€µ½¹Ñ¡±äœ€ü€µ½¹Ñ¡±äœ€è€…¹¹Õ…°œì(€€€€€€€€€¥˜€ …¹…µ”¤É•ÑÕÉ¸…±•ÉÐ 9…µ”‘…É˜¹¥¡Ð±••ÈÍ•¥¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡½Á•¸¤ñð½Á•¸€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸½™™•¹•¸	•ÑÉ…œ•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡É…Ñ”¤¤É…Ñ”€ô€Àì(€€€€€€€€€¥˜€¡É…Ñ”€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹”Ÿñ±Ñ¥”5½¹…ÑÍÉ…Ñ”•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥˜€¡Á…åµ•¹ÑQåÁ”€ôôô€¥¹ÍÑ…±±µ•¹Ðœ€˜˜½Á•¸€ø€À€˜˜€„¡É…Ñ”€ø€À¤¤É•ÑÕÉ¸…±•ÉÐ 	•¤I…Ñ•¹é…¡±Õ¹œµÕÍÌ•¥¹”5½¹…ÑÍÉ…Ñ”ËÛ}•È€ÀƒŠ
°¡¥¹Ñ•É±•ÐÍ•¥¸¸œ¤ì(€€€€€€€€€¥˜€¡Á…åµ•¹ÑQåÁ”€ôôô€½Á•¹}Á±…¸œ¤É…Ñ”€ô€Àì(€€€€€€€€€¥˜€ …‘Õ”ñð€„½yq‘ìÑôµq‘ìÉô¼¹Ñ•ÍÐ¡‘Õ”¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹”Ÿñ±Ñ¥”‘±±¥­•¥Ðß‘¡±•¸¸œ¤ì(€€€€€€€€€¥˜€¡•‘¥Ñ•‰Ð€˜˜•Ñ•‰Ñ¹¹Õ…±I…Ñ•IÕ±”¡•‘¥Ñ•‰Ð¤€˜˜5…Ñ ¹…‰Ì¡9Õµ‰•È¡•‘¥Ñ•‰Ð¹µ½¹Ñ¡±åI…Ñ”ñð€À¤€´É…Ñ”¤€ø€À¸ÀÄ€˜˜€…¥Í•‰ÑI…Ñ•¡…¹•±±½Ý•‘%¹5½¹Ñ ¡•‘¥Ñ•‰Ð°ÕÉÉ•¹Ñ5½¹Ñ ¤¤ì(€€€€€€€€€€€É•ÑÕÉ¸…±•ÉÐ¡€‘í•‘¥Ñ•‰Ð¹¹…µ•ôè¥”5½¹…ÑÍÉ…Ñ”‘…É˜¹ÕÈéÕ´€ÀÄ¸‘íMÑÉ¥¹œ¡•Ñ•‰Ñ¹¹Õ…±I…Ñ•IÕ±”¡•‘¥Ñ•‰Ð¤¹µ½¹Ñ ¤¹Á…‘MÑ…ÉÐ È°€œÀœ¥ô¸—‘¹‘•ÉÐÝ•É‘•¸¸9ÕÑé”‘…›ñÈ‰¥ÑÑ”ƒŠyI…Ñ”ƒ‘¹‘•É»ŠpÕ¹ß‘¡±”‘•¸5…¤‘•Ì©•Ý•¥±¥•¸)…¡É•Ì¹€¤ì(€€€€€€€€€ô((€€€€€€€€€¥˜€¡•‘¥Ñ•‰Ð¤ì(€€€€€€€€€€€½¹ÍÐÝ…Í=Á•¸€ô9Õµ‰•È¡•‘¥Ñ•‰Ð¹…µ½Õ¹Ñ=Á•¸ñð€À¤€ø€Àì(€€€€€€€€€€€•‘¥Ñ•‰Ð¹¹…µ”€ô¹…µ”ì(€€€€€€€€€€€•‘¥Ñ•‰Ð¹…µ½Õ¹Ñ=Á•¸€ô½Á•¸ì(€€€€€€€€€€€•‘¥Ñ•‰Ð¹µ½¹Ñ¡±åI…Ñ”€ôÉ…Ñ”ì(€€€€€€€€€€€•‘¥Ñ•‰Ð¹Á…åµ•¹ÑQåÁ”€ôÁ…åµ•¹ÑQåÁ”ì(€€€€€€€€€€€•‘¥Ñ•‰Ð¹Á…åµ•¹ÑIÕ±•5½‘”€ôÁ…åµ•¹ÑIÕ±•5½‘”ì(€€€€€€€€€€€•‘¥Ñ•‰Ð¹‰…±…¹•¡•­5½‘”€ô‰…±…¹•¡•­5½‘”ì(€€€€€€€€€€€•‘¥Ñ•‰Ð¹¹•áÑÕ•5½¹Ñ €ô‘Õ”ì(€€€€€€€€€€€•‘¥Ñ•‰Ð¹…½Õ¹Ñ%€ô=U9QM}9	1€ü€¡É•™Ì¹…½Õ¹ÑM•±•Ð¹Ù…±Õ”ñð€œœ¤€è€œœì(€€€€€€€€€€€¥˜€¡½Á•¸€ðô€À€˜˜Ý…Í=Á•¸¤•‘¥Ñ•‰Ð¹½µÁ±•Ñ•‘5½¹Ñ €ôÕÉÉ•¹Ñ5½¹Ñ ì(€€€€€€€€€€€¥˜€¡½Á•¸€ø€À¤‘•±•Ñ”•‘¥Ñ•‰Ð¹½µÁ±•Ñ•‘5½¹Ñ ì(€€€€€€€€€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡•‘¥Ñ•‰Ð¤ì(€€€€€€€€€€€É•…±Õ±…Ñ••‰ÑA±…¹¹¥¹™Ñ•É	…±…¹•¡…¹”¡•‘¥Ñ•‰Ð°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€½¹ÍÐ¹•Ý•‰Ð€ôì¥è•¹•É…Ñ•% ¤°¹…µ”°…µ½Õ¹Ñ=Á•¸è½Á•¸°µ½¹Ñ¡±åI…Ñ”èÉ…Ñ”°Á…åµ•¹ÑQåÁ”°Á…åµ•¹ÑIÕ±•5½‘”°‰…±…¹•¡•­5½‘”°‰…±…¹•¡•­Ìèmt°¹•áÑÕ•5½¹Ñ è‘Õ”°Á…¥‘5½¹Ñ¡Ìèmt°É…Ñ•Q¥µ•±¥¹”èmt°…½Õ¹Ñ%è=U9QM}9	1€ü€¡É•™Ì¹…½Õ¹ÑM•±•Ð¹Ù…±Õ”ñð€œœ¤€è€œœôì(€€€€€€€€€€€¥˜€¡½Á•¸€ðô€À¤¹•Ý•‰Ð¹½µÁ±•Ñ•‘5½¹Ñ €ôÕÉÉ•¹Ñ5½¹Ñ ì(€€€€€€€€€€€ÍÑ…Ñ”¹‘•‰ÑÌ¹ÁÕÍ ¡¹•Ý•‰Ð¤ì(€€€€€€€€€€€•¹ÍÕÉ••‰Ñ½¹™¥œ¡¹•Ý•‰Ð¤ì(€€€€€€€€€€€É•…±Õ±…Ñ••‰ÑA±…¹¹¥¹™Ñ•É	…±…¹•¡…¹”¡¹•Ý•‰Ð°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€ô(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô(€™Õ¹Ñ¥½¸¥Í½¹ÑÉ…Ñ…Ñ•-•ä¡Ù…±Õ”¤ì(€€€½¹ÍÐµ…Ñ €ôMÑÉ¥¹œ¡Ù…±Õ”ñð€œœ¤¹µ…Ñ  ½x¡q‘ìÑô¤´¡q‘ìÉô¤´¡q‘ìÉô¤¼¤ì(€€€¥˜€ …µ…Ñ ¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐ‘…Ñ”€ô¹•Ü…Ñ”¡9Õµ‰•È¡µ…Ñ¡lÅt¤°9Õµ‰•È¡µ…Ñ¡lÉt¤€´€Ä°9Õµ‰•È¡µ…Ñ¡lÍt¤°€ÄÈ°€À°€À°€À¤ì(€€€É•ÑÕÉ¸‘…Ñ”¹•ÑÕ±±e•…È ¤€ôôô9Õµ‰•È¡µ…Ñ¡lÅt¤(€€€€€€˜˜‘…Ñ”¹•Ñ5½¹Ñ  ¤€ôôô9Õµ‰•È¡µ…Ñ¡lÉt¤€´€Ä(€€€€€€˜˜‘…Ñ”¹•Ñ…Ñ” ¤€ôôô9Õµ‰•È¡µ…Ñ¡lÍt¤ì(€ô((€™Õ¹Ñ¥½¸½¹ÑÉ…Ñ…Ñ•Q½-•ä¡‘…Ñ”¤ì(€€€¥˜€ „¡‘…Ñ”¥¹ÍÑ…¹•½˜…Ñ”¤ñð9Õµ‰•È¹¥Í9…8¡‘…Ñ”¹•ÑQ¥µ” ¤¤¤É•ÑÕÉ¸€œœì(€€€½¹ÍÐå•…È€ô‘…Ñ”¹•ÑÕ±±e•…È ¤ì(€€€½¹ÍÐµ½¹Ñ €ôMÑÉ¥¹œ¡‘…Ñ”¹•Ñ5½¹Ñ  ¤€¬€Ä¤¹Á…‘MÑ…ÉÐ È°€œÀœ¤ì(€€€½¹ÍÐ‘…ä€ôMÑÉ¥¹œ¡‘…Ñ”¹•Ñ…Ñ” ¤¤¹Á…‘MÑ…ÉÐ È°€œÀœ¤ì(€€€É•ÑÕÉ¸€‘íå•…Éô´‘íµ½¹Ñ¡ô´‘í‘…åõ€ì(€ô((€™Õ¹Ñ¥½¸½¹ÑÉ…Ñ-•åQ½…Ñ”¡Ù…±Õ”¤ì(€€€¥˜€ …¥Í½¹ÑÉ…Ñ…Ñ•-•ä¡Ù…±Õ”¤¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐmå•…È°µ½¹Ñ °‘…åt€ôMÑÉ¥¹œ¡Ù…±Õ”¤¹ÍÁ±¥Ð œ´œ¤¹µ…À¡9Õµ‰•È¤ì(€€€É•ÑÕÉ¸¹•Ü…Ñ”¡å•…È°µ½¹Ñ €´€Ä°‘…ä°€ÄÈ°€À°€À°€À¤ì(€ô((€™Õ¹Ñ¥½¸…‘‘½¹ÑÉ…Ñ…±•¹‘…É5½¹Ñ¡Ì¡‘…Ñ”°µ½¹Ñ¡Ì¤ì(€€€¥˜€ „¡‘…Ñ”¥¹ÍÑ…¹•½˜…Ñ”¤ñð9Õµ‰•È¹¥Í9…8¡‘…Ñ”¹•ÑQ¥µ” ¤¤¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐ‘…ä€ô‘…Ñ”¹•Ñ…Ñ” ¤ì(€€€½¹ÍÐÑ…É•Ð€ô¹•Ü…Ñ”¡‘…Ñ”¹•ÑÕ±±e•…È ¤°‘…Ñ”¹•Ñ5½¹Ñ  ¤€¬9Õµ‰•È¡µ½¹Ñ¡Ìñð€À¤°€Ä°€ÄÈ°€À°€À°€À¤ì(€€€½¹ÍÐ±…ÍÑ…ä€ô¹•Ü…Ñ”¡Ñ…É•Ð¹•ÑÕ±±e•…È ¤°Ñ…É•Ð¹•Ñ5½¹Ñ  ¤€¬€Ä°€À°€ÄÈ°€À°€À°€À¤¹•Ñ…Ñ” ¤ì(€€€Ñ…É•Ð¹Í•Ñ…Ñ”¡5…Ñ ¹µ¥¸¡‘…ä°±…ÍÑ…ä¤¤ì(€€€É•ÑÕÉ¸Ñ…É•Ðì(€ô((€™Õ¹Ñ¥½¸™½Éµ…Ñ½¹ÑÉ…Ñ…Ñ”¡Ù…±Õ”¤ì(€€€½¹ÍÐ‘…Ñ”€ôÑåÁ•½˜Ù…±Õ”€ôôô€ÍÑÉ¥¹œœ€ü½¹ÑÉ…Ñ-•åQ½…Ñ”¡Ù…±Õ”¤€èÙ…±Õ”ì(€€€É•ÑÕÉ¸‘…Ñ”€˜˜€…9Õµ‰•È¹¥Í9…8¡‘…Ñ”¹•ÑQ¥µ” ¤¤€ü‘…Ñ”¹Ñ½1½…±•…Ñ•MÑÉ¥¹œ ‘”µœ¤€è€™•¡±Ðœì(€ô((€™Õ¹Ñ¥½¸•Ñ½¹ÑÉ…Ñ…Ñ•½É¥•Ì ¤ì(€€€É•ÑÕÉ¸lMÑÉ½´œ°€…Ì€¼!•¥éÕ¹œœ°€%¹Ñ•É¹•Ðœ°€5½‰¥±™Õ¹¬œ°€Y•ÉÍ¥¡•ÉÕ¹œœ°€‰¼œ°€5¥Ñ±¥•‘Í¡…™Ðœ°€1•…Í¥¹œ€¼¥¹…¹é¥•ÉÕ¹œœ°€M½¹ÍÑ¥•Ìtì(€ô((€™Õ¹Ñ¥½¸¹½Éµ…±¥é•½¹ÑÉ…ÑM½ÕÉ•QåÁ”¡Ù…±Õ”¤ì(€€€É•ÑÕÉ¸Ù…±Õ”€ôôô€½µµ½¸œñðÙ…±Õ”€ôôô€Á•ÉÍ½¹…°œ€üÙ…±Õ”€è€œœì(€ô((€™Õ¹Ñ¥½¸¹½Éµ…±¥é•½¹ÑÉ…Ñ5…Ñ¡-•ä¡Ù…±Õ”¤ì(€€€É•ÑÕÉ¸MÑÉ¥¹œ¡Ù…±Õ”ñð€œœ¤(€€€€€€¹Ñ½1½…±•1½Ý•É…Í” ‘”µœ¤(€€€€€€¹¹½Éµ…±¥é” 9œ¤(€€€€€€¹É•Á±…” ½mqÔÀÌÀÀµqÔÀÌÙ™t½œ°€œœ¤(€€€€€€¹É•Á±…” ½my„µèÀ´åt¬½œ°€œ€œ¤(€€€€€€¹ÑÉ¥´ ¤ì(€ô((€™Õ¹Ñ¥½¸¹½Éµ…±¥é•½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì ¤ì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì¤¤ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì€ômtì(€€€ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì€ôÉÉ…ä¹™É½´¡¹•ÜM•Ð¡ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì(€€€€€€¹µ…À ¡­•ä¤€ôøMÑÉ¥¹œ¡­•äñð€œœ¤¹ÑÉ¥´ ¤¤(€€€€€€¹™¥±Ñ•È¡	½½±•…¸¤¤¤ì(€ô((€™Õ¹Ñ¥½¸•Ñ½¹ÑÉ…ÑM½ÕÉ•A½ÍÐ¡½¹ÑÉ…Ð¤ì(€€€¥˜€ …½¹ÑÉ…Ðñð€…½¹ÑÉ…Ð¹Í½ÕÉ•A½ÍÑ%¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÍ½ÕÉ•QåÁ”€ô¹½Éµ…±¥é•½¹ÑÉ…ÑM½ÕÉ•QåÁ”¡½¹ÑÉ…Ð¹Í½ÕÉ•QåÁ”¤ì(€€€½¹ÍÐ±¥ÍÐ€ôÍ½ÕÉ•QåÁ”€ôôô€½µµ½¸œ(€€€€€€üÍÑ…Ñ”¹½µµ½¹½ÍÑÌ(€€€€€€èÍ½ÕÉ•QåÁ”€ôôô€Á•ÉÍ½¹…°œ(€€€€€€€€üÍÑ…Ñ”¹Á•ÉÍ½¹…±½ÍÑÌ(€€€€€€€€è¹Õ±°ì(€€€É•ÑÕÉ¸ÉÉ…ä¹¥ÍÉÉ…ä¡±¥ÍÐ¤€ü±¥ÍÐ¹™¥¹ ¡Á½ÍÐ¤€ôøÁ½ÍÐ€˜˜MÑÉ¥¹œ¡Á½ÍÐ¹¥ñð€œœ¤€ôôôMÑÉ¥¹œ¡½¹ÑÉ…Ð¹Í½ÕÉ•A½ÍÑ%¤¤ñð¹Õ±°€è¹Õ±°ì(€ô((€™Õ¹Ñ¥½¸•Ñ½¹ÑÉ…ÑM½ÕÉ•I•™•É•¹•5½¹Ñ ¡Á½ÍÐ¤ì(€€€½¹ÍÐ…ÑÕ…±5½¹Ñ €ô‘…Ñ•Q½5½¹Ñ¡-•ä¡¹•Ü…Ñ” ¤¤ì(€€€¥˜€¡¥ÍA½ÍÑÑ¥Ù•%¹5½¹Ñ ¡Á½ÍÐ°…ÑÕ…±5½¹Ñ ¤¤É•ÑÕÉ¸…ÑÕ…±5½¹Ñ ì(€€€¥˜€¡¥Í5½¹Ñ¡-•ä¡Á½ÍÐ€˜˜Á½ÍÐ¹•¹‘5½¹Ñ ¤¤É•ÑÕÉ¸Á½ÍÐ¹•¹‘5½¹Ñ ì(€€€¥˜€¡¥Í5½¹Ñ¡-•ä¡Á½ÍÐ€˜˜Á½ÍÐ¹ÍÑ…ÉÑ5½¹Ñ ¤¤É•ÑÕÉ¸Á½ÍÐ¹ÍÑ…ÉÑ5½¹Ñ ì(€€€É•ÑÕÉ¸…ÑÕ…±5½¹Ñ ì(€ô((€™Õ¹Ñ¥½¸Íå¹½¹ÑÉ…ÑÉ½µM½ÕÉ”¡½¹ÑÉ…Ð¤ì(€€€½¹ÍÐÁ½ÍÐ€ô•Ñ½¹ÑÉ…ÑM½ÕÉ•A½ÍÐ¡½¹ÑÉ…Ð¤ì(€€€¥˜€ …Á½ÍÐ¤É•ÑÕÉ¸½¹ÑÉ…Ðì(€€€•¹ÍÕÉ•A½ÍÑ½¹™¥œ¡Á½ÍÐ¤ì(€€€½¹ÍÐÍ½ÕÉ•5½¹Ñ €ô•Ñ½¹ÑÉ…ÑM½ÕÉ•I•™•É•¹•5½¹Ñ ¡Á½ÍÐ¤ì(€€€½¹ÑÉ…Ð¹…µ½Õ¹Ð€ôÉ½Õ¹‘5½¹•ä¡5…Ñ ¹µ…à À°9Õµ‰•È¡•Ñ™™•Ñ¥Ù•µ½Õ¹Ñ½É5½¹Ñ ¡Á½ÍÐ°Í½ÕÉ•5½¹Ñ ¤ñð€À¤¤¤ì(€€€½¹ÑÉ…Ð¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ì€ô5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹¡9Õµ‰•È¡Á½ÍÐ¹¥¹Ñ•ÉÙ…°ñð€Ä¤¤¤ì(€€€¥˜€ …½¹ÑÉ…Ð¹¹…µ”¤½¹ÑÉ…Ð¹¹…µ”€ôMÑÉ¥¹œ¡Á½ÍÐ¹¹…µ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€€€É•ÑÕÉ¸½¹ÑÉ…Ðì(€ô((€™Õ¹Ñ¥½¸•Ñ½¹ÑÉ…ÑM½ÕÉ•1…‰•°¡Í½ÕÉ•QåÁ”°Á½ÍÐ¤ì(€€€¥˜€¡Í½ÕÉ•QåÁ”€ôôô€½µµ½¸œ¤É•ÑÕÉ¸€•µ•¥¹Í…µ”-½ÍÑ•¸œì(€€€½¹ÍÐÁ•ÉÍ½¸€ôÁ½ÍÐ€˜˜Á½ÍÐ¹Á•ÉÍ½¹%€ü•ÑA•ÉÍ½¹	å%¡Á½ÍÐ¹Á•ÉÍ½¹%¤€è¹Õ±°ì(€€€É•ÑÕÉ¸Á•ÉÍ½¸€üA•ÉÏÙ¹±¥¡”ÕÍ…‰•¸ƒ
Ü€‘íÁ•ÉÍ½¸¹¹…µ•õ€€è€A•ÉÏÙ¹±¥¡”ÕÍ…‰•¸œì(€ô((€™Õ¹Ñ¥½¸•Ñ½¹ÑÉ…ÑMÕ•ÍÑ¥½¹-•ä¡Í½ÕÉ•QåÁ”°Á½ÍÐ¤ì(€€€½¹ÍÐÍÑ…‰±•%€ôMÑÉ¥¹œ¡Á½ÍÐ€˜˜Á½ÍÐ¹¥ñð€œœ¤¹ÑÉ¥´ ¤ì(€€€¥˜€¡ÍÑ…‰±•%¤É•ÑÕÉ¸€‘íÍ½ÕÉ•QåÁ•ôè‘íÍÑ…‰±•%‘õ€ì(€€€É•ÑÕÉ¸€‘íÍ½ÕÉ•QåÁ•ôè‘íMÑÉ¥¹œ¡Á½ÍÐ€˜˜Á½ÍÐ¹Á•ÉÍ½¹%ñð€œœ¥ôè‘í¹½Éµ…±¥é•½¹ÑÉ…Ñ5…Ñ¡-•ä¡Á½ÍÐ€˜˜Á½ÍÐ¹¹…µ”¥ôè‘íMÑÉ¥¹œ¡Á½ÍÐ€˜˜Á½ÍÐ¹ÍÑ…ÉÑ5½¹Ñ ñð€œœ¥õ€ì(€ô((€™Õ¹Ñ¥½¸¥¹™•É½¹ÑÉ…Ñ…Ñ•½Éä¡¹…µ”¤ì(€€€½¹ÍÐ­•ä€ô¹½Éµ…±¥é•½¹ÑÉ…Ñ5…Ñ¡-•ä¡¹…µ”¤ì(€€€¥˜€ ½ÍÑÉ½µñ•¹•É¥”¼¹Ñ•ÍÐ¡­•ä¤¤É•ÑÕÉ¸€MÑÉ½´œì(€€€¥˜€ ½…Íñ¡•¥éÕ¹ñÝ…•Éµ•ñ™•É¹Ý…•Éµ”¼¹Ñ•ÍÐ¡­•ä¤¤É•ÑÕÉ¸€…Ì€¼!•¥éÕ¹œœì(€€€¥˜€ ½¥¹Ñ•É¹•Ññ™•ÍÑ¹•Ñéñ‘Í±ñ­…‰•°¼¹Ñ•ÍÐ¡­•ä¤¤É•ÑÕÉ¸€%¹Ñ•É¹•Ðœì(€€€¥˜€ ½µ½‰¥±™Õ¹­ñ¡…¹‘åñÍµ…ÉÑÁ¡½¹”¼¹Ñ•ÍÐ¡­•ä¤¤É•ÑÕÉ¸€5½‰¥±™Õ¹¬œì(€€€¥˜€ ½Ù•ÉÍ¥¡•ÉÕ¹ñ¡…™ÑÁ™±¥¡Ññ¡…ÕÍÉ…ÑñÉ•¡ÑÍÍ¡ÕÑéñé…¡¹éÕÍ…Ñéñ¡Õ¬¼¹Ñ•ÍÐ¡­•ä¤¤É•ÑÕÉ¸€Y•ÉÍ¥¡•ÉÕ¹œœì(€€€¥˜€ ½™¥Ñ¹•ÍÍñÙ•É•¥¹ñÁ…ÉÑ•¥ñ•Ý•É­Í¡…™Ññµ¥Ñ±¥•‘ñ‰•¥ÑÉ…ñÙ•È‘¥ñ…™¼¹Ñ•ÍÐ¡­•ä¤¤É•ÑÕÉ¸€5¥Ñ±¥•‘Í¡…™Ðœì(€€€¥˜€ ½±•…Í¥¹ñ™¥¹…¹é¥•ÉÕ¹œ¼¹Ñ•ÍÐ¡­•ä¤¤É•ÑÕÉ¸€1•…Í¥¹œ€¼¥¹…¹é¥•ÉÕ¹œœì(€€€¥˜€ ½ÁÉ¥µ•ñÍ­åñÍÑÉ•…µñ¹•Ñ™±¥áñÍÁ½Ñ¥™åñ…ÁÁ±•ñ¡…ÑÁÑñ…‰¼¼¹Ñ•ÍÐ¡­•ä¤¤É•ÑÕÉ¸€‰¼œì(€€€É•ÑÕÉ¸€M½¹ÍÑ¥•Ìœì(€ô((€™Õ¹Ñ¥½¸¥Í1¥­•±å½¹ÑÉ…ÑA½ÍÐ¡Á½ÍÐ¤ì(€€€¥˜€ …Á½ÍÐñðÑåÁ•½˜Á½ÍÐ€„ôô€½‰©•Ðœ¤É•ÑÕÉ¸™…±Í”ì(€€€•¹ÍÕÉ•A½ÍÑ½¹™¥œ¡Á½ÍÐ¤ì(€€€¥˜€¡Á½ÍÐ¹½¹•Q¥µ”€ôôôÑÉÕ”ñðÁ½ÍÐ¹±¥¹­•‘•‰Ñ%ñð•Ñ1¥¹­•‘•‰Ñ½ÉA½ÍÐ¡Á½ÍÐ¤¤É•ÑÕÉ¸™…±Í”ì(€€€¥˜€¡Á½ÍÐ¹±¥¹­•‘M…Ù¥¹Í½…±%ñð•Ñ1¥¹­•‘M…Ù¥¹Í½…°¡Á½ÍÐ¤¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐ…ÑÕ…±5½¹Ñ €ô‘…Ñ•Q½5½¹Ñ¡-•ä¡¹•Ü…Ñ” ¤¤ì(€€€¥˜€ …¥ÍA½ÍÑÑ¥Ù•%¹5½¹Ñ ¡Á½ÍÐ°…ÑÕ…±5½¹Ñ ¤¤É•ÑÕÉ¸™…±Í”ì(€€€¥˜€ „¡9Õµ‰•È¡•Ñ™™•Ñ¥Ù•µ½Õ¹Ñ½É5½¹Ñ ¡Á½ÍÐ°…ÑÕ…±5½¹Ñ ¤¤€ø€À¤¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐ¹…µ•-•ä€ô¹½Éµ…±¥é•½¹ÑÉ…Ñ5…Ñ¡-•ä¡Á½ÍÐ¹¹…µ”¤ì(€€€¥˜€ …¹…µ•-•ä¤É•ÑÕÉ¸™…±Í”ì(€€€É•ÑÕÉ¸€„¼¡yð€¤¡•¥¹­…Õ™Í•±‘ñÑ…¹­•±‘ñÉ…Õ¡é•Õñ™É¥Í•ÕÉñÑ…Í¡•¹•±‘ñ¡…ÕÍ¡…±ÑÍ•±‘ñ±•‰•¹Íµ¥ÑÑ•±ñ­É…™ÑÍÑ½™™ñ‰•¹é¥¹ñ‘¥•Í•±ñÉÕ­±…•ñÉÕ•­±…•ñÍÁ…É•¹ñÍÁ…É‰•ÑÉ…ñÍ½¹‘•É…ÕÍ…‰”¤ ð¤¼¹Ñ•ÍÐ¡¹…µ•-•ä¤ì(€ô((€™Õ¹Ñ¥½¸•Ñ½¹ÑÉ…ÑMÕ•ÍÑ¥½¹Ì¡½ÁÑ¥½¹Ì€ôíô¤ì(€€€¹½Éµ…±¥é•½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì ¤ì(€€€½¹ÍÐ¥¹±Õ‘•¥Íµ¥ÍÍ•€ô½ÁÑ¥½¹Ì¹¥¹±Õ‘•¥Íµ¥ÍÍ•€ôôôÑÉÕ”ì(€€€½¹ÍÐ±¥¹­•‘-•åÌ€ô¹•ÜM•Ð¡ÍÑ…Ñ”¹½¹ÑÉ…ÑÌ(€€€€€€¹™¥±Ñ•È ¡½¹ÑÉ…Ð¤€ôø½¹ÑÉ…Ð¹Í½ÕÉ•A½ÍÑ%€˜˜¹½Éµ…±¥é•½¹ÑÉ…ÑM½ÕÉ•QåÁ”¡½¹ÑÉ…Ð¹Í½ÕÉ•QåÁ”¤¤(€€€€€€¹µ…À ¡½¹ÑÉ…Ð¤€ôø€‘í½¹ÑÉ…Ð¹Í½ÕÉ•QåÁ•ôè‘í½¹ÑÉ…Ð¹Í½ÕÉ•A½ÍÑ%‘õ€¤¤ì(€€€½¹ÍÐ•á¥ÍÑ¥¹9…µ•Ì€ô¹•ÜM•Ð¡ÍÑ…Ñ”¹½¹ÑÉ…ÑÌ(€€€€€€¹™¥±Ñ•È ¡½¹ÑÉ…Ð¤€ôø€…½¹ÑÉ…Ð¹Í½ÕÉ•A½ÍÑ%¤(€€€€€€¹µ…À ¡½¹ÑÉ…Ð¤€ôø¹½Éµ…±¥é•½¹ÑÉ…Ñ5…Ñ¡-•ä¡½¹ÑÉ…Ð¹¹…µ”¤¤(€€€€€€¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€€€½¹ÍÐ‘¥Íµ¥ÍÍ•€ô¹•ÜM•Ð¡ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì¤ì(€€€½¹ÍÐÍ••¸€ô¹•ÜM•Ð ¤ì(€€€½¹ÍÐÍÕ•ÍÑ¥½¹Ì€ômtì(€€€½¹ÍÐ…‘‘MÕ•ÍÑ¥½¸€ô€¡Í½ÕÉ•QåÁ”°Á½ÍÐ¤€ôøì(€€€€€¥˜€ …¥Í1¥­•±å½¹ÑÉ…ÑA½ÍÐ¡Á½ÍÐ¤¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ­•ä€ô•Ñ½¹ÑÉ…ÑMÕ•ÍÑ¥½¹-•ä¡Í½ÕÉ•QåÁ”°Á½ÍÐ¤ì(€€€€€¥˜€¡±¥¹­•‘-•åÌ¹¡…Ì¡­•ä¤ñð€ …¥¹±Õ‘•¥Íµ¥ÍÍ•€˜˜‘¥Íµ¥ÍÍ•¹¡…Ì¡­•ä¤¤¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ¹…µ•-•ä€ô¹½Éµ…±¥é•½¹ÑÉ…Ñ5…Ñ¡-•ä¡Á½ÍÐ¹¹…µ”¤ì(€€€€€½¹ÍÐÁ•ÉÍ½¹-•ä€ôÍ½ÕÉ•QåÁ”€ôôô€Á•ÉÍ½¹…°œ€üMÑÉ¥¹œ¡Á½ÍÐ¹Á•ÉÍ½¹%ñð€œœ¤€è€œœì(€€€€€½¹ÍÐ‘ÕÁ±¥…Ñ•-•ä€ô€‘íÍ½ÕÉ•QåÁ•ôè‘íÁ•ÉÍ½¹-•åôè‘í¹…µ•-•åõ€ì(€€€€€¥˜€¡Í••¸¹¡…Ì¡‘ÕÁ±¥…Ñ•-•ä¤ñð•á¥ÍÑ¥¹9…µ•Ì¹¡…Ì¡¹…µ•-•ä¤¤É•ÑÕÉ¸ì(€€€€€Í••¸¹…‘¡‘ÕÁ±¥…Ñ•-•ä¤ì(€€€€€½¹ÍÐÉ•™•É•¹•5½¹Ñ €ô•Ñ½¹ÑÉ…ÑM½ÕÉ•I•™•É•¹•5½¹Ñ ¡Á½ÍÐ¤ì(€€€€€ÍÕ•ÍÑ¥½¹Ì¹ÁÕÍ ¡ì(€€€€€€€­•ä°(€€€€€€€Í½ÕÉ•QåÁ”°(€€€€€€€Í½ÕÉ•A½ÍÑ%èMÑÉ¥¹œ¡Á½ÍÐ¹¥ñð€œœ¤°(€€€€€€€Á½ÍÐ°(€€€€€€€¹…µ”èMÑÉ¥¹œ¡Á½ÍÐ¹¹…µ”ñð€œœ¤¹ÑÉ¥´ ¤°(€€€€€€€…Ñ•½Éäè¥¹™•É½¹ÑÉ…Ñ…Ñ•½Éä¡Á½ÍÐ¹¹…µ”¤°(€€€€€€€…µ½Õ¹ÐèÉ½Õ¹‘5½¹•ä¡9Õµ‰•È¡•Ñ™™•Ñ¥Ù•µ½Õ¹Ñ½É5½¹Ñ ¡Á½ÍÐ°É•™•É•¹•5½¹Ñ ¤ñð€À¤¤°(€€€€€€€‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ìè5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹¡9Õµ‰•È¡Á½ÍÐ¹¥¹Ñ•ÉÙ…°ñð€Ä¤¤¤°(€€€€€€€ÍÑ…ÉÑ…Ñ”è¥Í5½¹Ñ¡-•ä¡Á½ÍÐ¹ÍÑ…ÉÑ5½¹Ñ ¤€ü€‘íÁ½ÍÐ¹ÍÑ…ÉÑ5½¹Ñ¡ô´ÀÅ€€è€œœ°(€€€€€€€Í½ÕÉ•1…‰•°è•Ñ½¹ÑÉ…ÑM½ÕÉ•1…‰•°¡Í½ÕÉ•QåÁ”°Á½ÍÐ¤°(€€€€€€€‘¥Íµ¥ÍÍ•è‘¥Íµ¥ÍÍ•¹¡…Ì¡­•ä¤(€€€€€ô¤ì(€€€ôì(€€€€¡ÍÑ…Ñ”¹½µµ½¹½ÍÑÌñðmt¤¹™½É…  ¡Á½ÍÐ¤€ôø…‘‘MÕ•ÍÑ¥½¸ ½µµ½¸œ°Á½ÍÐ¤¤ì(€€€€¡ÍÑ…Ñ”¹Á•ÉÍ½¹…±½ÍÑÌñðmt¤¹™½É…  ¡Á½ÍÐ¤€ôø…‘‘MÕ•ÍÑ¥½¸ Á•ÉÍ½¹…°œ°Á½ÍÐ¤¤ì(€€€É•ÑÕÉ¸ÍÕ•ÍÑ¥½¹Ì¹Í½ÉÐ ¡„°ˆ¤€ôø„¹Í½ÕÉ•1…‰•°¹±½…±•½µÁ…É”¡ˆ¹Í½ÕÉ•1…‰•°°€‘”œ¤ñð„¹¹…µ”¹±½…±•½µÁ…É”¡ˆ¹¹…µ”°€‘”œ¤¤ì(€ô((€™Õ¹Ñ¥½¸‘¥Íµ¥ÍÍ½¹ÑÉ…ÑMÕ•ÍÑ¥½¸¡ÍÕ•ÍÑ¥½¸¤ì(€€€¥˜€ …ÍÕ•ÍÑ¥½¸ñð€…ÍÕ•ÍÑ¥½¸¹­•ä¤É•ÑÕÉ¸ì(€€€¹½Éµ…±¥é•½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì ¤ì(€€€¥˜€ …ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì¹¥¹±Õ‘•Ì¡ÍÕ•ÍÑ¥½¸¹­•ä¤¤ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì¹ÁÕÍ ¡ÍÕ•ÍÑ¥½¸¹­•ä¤ì(€€€…‘‘¡…¹•1½œ Y•ÉÑË‘”œ°€‘íÍÕ•ÍÑ¥½¸¹¹…µ”ñð€-½ÍÑ•¹Á½ÍÑ•¸ô…±ÌƒŠy-•¥¸Y•ÉÑÉ…ŸŠpµ…É­¥•ÉÐ¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€Í…Ù•MÑ…Ñ” ¤ì(€€€É•¹‘•È ¤ì(€ô((€™Õ¹Ñ¥½¸É•ÍÑ½É•¥Íµ¥ÍÍ•‘½¹ÑÉ…ÑMÕ•ÍÑ¥½¹Ì ¤ì(€€€¹½Éµ…±¥é•½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì ¤ì(€€€¥˜€ …ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì¹±•¹Ñ ¤É•ÑÕÉ¸ì(€€€ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì€ômtì(€€€…‘‘¡…¹•1½œ Y•ÉÑË‘”œ°€ÕÍ•‰±•¹‘•Ñ”Y•ÉÑÉ…ÍÙ½ÉÍ¡³‘”Ý¥•‘•È•¥¹•‰±•¹‘•Ð¸œ°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€Í…Ù•MÑ…Ñ” ¤ì(€€€É•¹‘•È ¤ì(€ô((€™Õ¹Ñ¥½¸¹½Éµ…±¥é•½¹ÑÉ…Ð¡½¹ÑÉ…Ð¤ì(€€€½¹ÍÐ¥Ñ•´€ô½¹ÑÉ…Ð€˜˜ÑåÁ•½˜½¹ÑÉ…Ð€ôôô€½‰©•Ðœ€ü½¹ÑÉ…Ð€èíôì(€€€½¹ÍÐ¹Õµ‰•É=È€ô€¡Ù…±Õ”°™…±±‰…¬°µ¥¸€ô€À°µ…à€ô€ØÀÀ¤€ôøì(€€€€€½¹ÍÐÁ…ÉÍ•€ô9Õµ‰•È¡Ù…±Õ”¤ì(€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡Á…ÉÍ•¤¤É•ÑÕÉ¸™…±±‰…¬ì(€€€€€É•ÑÕÉ¸5…Ñ ¹µ¥¸¡µ…à°5…Ñ ¹µ…à¡µ¥¸°Á…ÉÍ•¤¤ì(€€€ôì(€€€½¹ÍÐ…Ñ•½É¥•Ì€ô•Ñ½¹ÑÉ…Ñ…Ñ•½É¥•Ì ¤ì(€€€¥Ñ•´¹¥€ôMÑÉ¥¹œ¡¥Ñ•´¹¥ñð•¹•É…Ñ•% ¤¤ì(€€€¥Ñ•´¹¹…µ”€ôMÑÉ¥¹œ¡¥Ñ•´¹¹…µ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€€€¥Ñ•´¹ÁÉ½Ù¥‘•È€ôMÑÉ¥¹œ¡¥Ñ•´¹ÁÉ½Ù¥‘•Èñð€œœ¤¹ÑÉ¥´ ¤ì(€€€¥Ñ•´¹…Ñ•½Éä€ô…Ñ•½É¥•Ì¹¥¹±Õ‘•Ì¡¥Ñ•´¹…Ñ•½Éä¤€ü¥Ñ•´¹…Ñ•½Éä€è€M½¹ÍÑ¥•Ìœì(€€€¥Ñ•´¹…µ½Õ¹Ð€ôÉ½Õ¹‘5½¹•ä¡¹Õµ‰•É=È¡¥Ñ•´¹…µ½Õ¹Ð°€À°€À°€ÄÀÀÀÀÀÀ¤¤ì(€€€¥Ñ•´¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ì€ô5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹¡¹Õµ‰•É=È¡¥Ñ•´¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ì°€Ä°€Ä°€ÄÈÀ¤¤¤ì(€€€¥Ñ•´¹ÍÑ…ÉÑ…Ñ”€ô¥Í½¹ÑÉ…Ñ…Ñ•-•ä¡¥Ñ•´¹ÍÑ…ÉÑ…Ñ”¤€ü¥Ñ•´¹ÍÑ…ÉÑ…Ñ”€è€œœì(€€€¥Ñ•´¹µ¥¹¥µÕµQ•Éµ5½¹Ñ¡Ì€ô5…Ñ ¹É½Õ¹¡¹Õµ‰•É=È¡¥Ñ•´¹µ¥¹¥µÕµQ•Éµ5½¹Ñ¡Ì°€ÄÈ°€À°€ØÀÀ¤¤ì(€€€¥Ñ•´¹¹½Ñ¥•A•É¥½‘Y…±Õ”€ô5…Ñ ¹É½Õ¹¡¹Õµ‰•É=È¡¥Ñ•´¹¹½Ñ¥•A•É¥½‘Y…±Õ”€„ô¹Õ±°€ü¥Ñ•´¹¹½Ñ¥•A•É¥½‘Y…±Õ”€è¥Ñ•´¹¹½Ñ¥•A•É¥½‘5½¹Ñ¡Ì°€Ä°€À°€ÄÈÀ¤¤ì(€€€¥Ñ•´¹¹½Ñ¥•A•É¥½‘U¹¥Ð€ôl‘…åÌœ°€Ý••­Ìœ°€µ½¹Ñ¡Ìt¹¥¹±Õ‘•Ì¡¥Ñ•´¹¹½Ñ¥•A•É¥½‘U¹¥Ð¤€ü¥Ñ•´¹¹½Ñ¥•A•É¥½‘U¹¥Ð€è€µ½¹Ñ¡Ìœì(€€€¥Ñ•´¹É•¹•Ý…±5½¹Ñ¡Ì€ô5…Ñ ¹É½Õ¹¡¹Õµ‰•É=È¡¥Ñ•´¹É•¹•Ý…±5½¹Ñ¡Ì°€ÄÈ°€À°€ÄÈÀ¤¤ì(€€€¥Ñ•´¹±…ÍÑI•Ù¥•Ý•‘…Ñ”€ô¥Í½¹ÑÉ…Ñ…Ñ•-•ä¡¥Ñ•´¹±…ÍÑI•Ù¥•Ý•‘…Ñ”¤€ü¥Ñ•´¹±…ÍÑI•Ù¥•Ý•‘…Ñ”€è€œœì(€€€¥Ñ•´¹É•Ù¥•Ý%¹Ñ•ÉÙ…±5½¹Ñ¡Ì€ô5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹¡¹Õµ‰•É=È¡¥Ñ•´¹É•Ù¥•Ý%¹Ñ•ÉÙ…±5½¹Ñ¡Ì°€ÄÈ°€Ä°€ÄÈÀ¤¤¤ì(€€€¥Ñ•´¹¹½Ñ•Ì€ôMÑÉ¥¹œ¡¥Ñ•´¹¹½Ñ•Ìñð€œœ¤¹ÑÉ¥´ ¤ì(€€€¥Ñ•´¹…Ñ¥Ù”€ô¥Ñ•´¹…Ñ¥Ù”€„ôô™…±Í”ì(€€€¥Ñ•´¹Í½ÕÉ•QåÁ”€ô¹½Éµ…±¥é•½¹ÑÉ…ÑM½ÕÉ•QåÁ”¡¥Ñ•´¹Í½ÕÉ•QåÁ”¤ì(€€€¥Ñ•´¹Í½ÕÉ•A½ÍÑ%€ô¥Ñ•´¹Í½ÕÉ•QåÁ”€üMÑÉ¥¹œ¡¥Ñ•´¹Í½ÕÉ•A½ÍÑ%ñð€œœ¤¹ÑÉ¥´ ¤€è€œœì(€€€¥Ñ•´¹ÍÑ…ÉÑ…Ñ•ÍÑ¥µ…Ñ•€ô¥Ñ•´¹ÍÑ…ÉÑ…Ñ•ÍÑ¥µ…Ñ•€ôôôÑÉÕ”ì(€€€É•ÑÕÉ¸¥Ñ•´ì(€ô((€™Õ¹Ñ¥½¸¹½Éµ…±¥é•½¹ÑÉ…ÑÌ ¤ì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹½¹ÑÉ…ÑÌ¤¤ÍÑ…Ñ”¹½¹ÑÉ…ÑÌ€ômtì(€€€¹½Éµ…±¥é•½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì ¤ì(€€€ÍÑ…Ñ”¹½¹ÑÉ…ÑÌ€ôÍÑ…Ñ”¹½¹ÑÉ…ÑÌ(€€€€€€¹™¥±Ñ•È ¡½¹ÑÉ…Ð¤€ôø½¹ÑÉ…Ð€˜˜ÑåÁ•½˜½¹ÑÉ…Ð€ôôô€½‰©•Ðœ¤(€€€€€€¹µ…À ¡½¹ÑÉ…Ð¤€ôøÍå¹½¹ÑÉ…ÑÉ½µM½ÕÉ”¡¹½Éµ…±¥é•½¹ÑÉ…Ð¡½¹ÑÉ…Ð¤¤¤ì(€ô((€™Õ¹Ñ¥½¸•Ñ½¹ÑÉ…Ñ5½¹Ñ¡±å½ÍÐ¡½¹ÑÉ…Ð¤ì(€€€½¹ÍÐ¥¹Ñ•ÉÙ…°€ô5…Ñ ¹µ…à Ä°9Õµ‰•È¡½¹ÑÉ…Ð€˜˜½¹ÑÉ…Ð¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ìñð€Ä¤¤ì(€€€É•ÑÕÉ¸É½Õ¹‘5½¹•ä¡9Õµ‰•È¡½¹ÑÉ…Ð€˜˜½¹ÑÉ…Ð¹…µ½Õ¹Ðñð€À¤€¼¥¹Ñ•ÉÙ…°¤ì(€ô((€™Õ¹Ñ¥½¸•Ñ½¹ÑÉ…Ñ¹¹Õ…±½ÍÐ¡½¹ÑÉ…Ð¤ì(€€€É•ÑÕÉ¸É½Õ¹‘5½¹•ä¡•Ñ½¹ÑÉ…Ñ5½¹Ñ¡±å½ÍÐ¡½¹ÑÉ…Ð¤€¨€ÄÈ¤ì(€ô((€™Õ¹Ñ¥½¸ÍÕ‰ÑÉ…Ñ½¹ÑÉ…Ñ9½Ñ¥•A•É¥½¡‘…Ñ”°½¹ÑÉ…Ð¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô¹•Ü…Ñ”¡‘…Ñ”¹•ÑQ¥µ” ¤¤ì(€€€½¹ÍÐÙ…±Õ”€ô5…Ñ ¹µ…à À°9Õµ‰•È¡½¹ÑÉ…Ð¹¹½Ñ¥•A•É¥½‘Y…±Õ”ñð€À¤¤ì(€€€¥˜€¡½¹ÑÉ…Ð¹¹½Ñ¥•A•É¥½‘U¹¥Ð€ôôô€‘…åÌœ¤É•ÍÕ±Ð¹Í•Ñ…Ñ”¡É•ÍÕ±Ð¹•Ñ…Ñ” ¤€´Ù…±Õ”¤ì(€€€•±Í”¥˜€¡½¹ÑÉ…Ð¹¹½Ñ¥•A•É¥½‘U¹¥Ð€ôôô€Ý••­Ìœ¤É•ÍÕ±Ð¹Í•Ñ…Ñ”¡É•ÍÕ±Ð¹•Ñ…Ñ” ¤€´Ù…±Õ”€¨€Ü¤ì(€€€•±Í”É•ÑÕÉ¸…‘‘½¹ÑÉ…Ñ…±•¹‘…É5½¹Ñ¡Ì¡É•ÍÕ±Ð°€µÙ…±Õ”¤ì(€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€ô((€™Õ¹Ñ¥½¸•Ñ½¹ÑÉ…ÑM¡•‘Õ±”¡½¹ÑÉ…Ð°É•™•É•¹•…Ñ”€ô¹•Ü…Ñ” ¤¤ì(€€€¹½Éµ…±¥é•½¹ÑÉ…Ð¡½¹ÑÉ…Ð¤ì(€€€½¹ÍÐÑ½‘…ä€ô¹•Ü…Ñ”¡É•™•É•¹•…Ñ”¹•ÑÕ±±e•…È ¤°É•™•É•¹•…Ñ”¹•Ñ5½¹Ñ  ¤°É•™•É•¹•…Ñ”¹•Ñ…Ñ” ¤°€ÄÈ°€À°€À°€À¤ì(€€€½¹ÍÐÍÑ…ÉÐ€ô½¹ÑÉ…Ñ-•åQ½…Ñ”¡½¹ÑÉ…Ð¹ÍÑ…ÉÑ…Ñ”¤ì(€€€½¹ÍÐµ½¹Ñ¡±å½ÍÐ€ô•Ñ½¹ÑÉ…Ñ5½¹Ñ¡±å½ÍÐ¡½¹ÑÉ…Ð¤ì(€€€½¹ÍÐ…¹¹Õ…±½ÍÐ€ô•Ñ½¹ÑÉ…Ñ¹¹Õ…±½ÍÐ¡½¹ÑÉ…Ð¤ì(€€€¥˜€ …ÍÑ…ÉÐ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€Ù…±¥è™…±Í”°(€€€€€€€µ½¹Ñ¡±å½ÍÐ°(€€€€€€€…¹¹Õ…±½ÍÐ°(€€€€€€€­¥¹è½¹ÑÉ…Ð¹…Ñ¥Ù”€ü€Ý…É¹¥¹œœ€è€œœ°(€€€€€€€ÍÑ…ÑÕÌè½¹ÑÉ…Ð¹…Ñ¥Ù”€ü€MÑ…ÉÑ‘…ÑÕ´™•¡±Ðœ€è€%¹…­Ñ¥Øœ°(€€€€€€€É•Ù¥•ÝÕ”è™…±Í”°(€€€€€€€‘…åÍU¹Ñ¥±…¹•±±…Ñ¥½¸è¹Õ±°°(€€€€€€€…¹•±±…Ñ¥½¹•…‘±¥¹”è¹Õ±°°(€€€€€€€½¹ÑÉ…Ñ¹è¹Õ±°°(€€€€€€€¹•áÑI•Ù¥•Üè¹Õ±°(€€€€€ôì(€€€ô((€€€±•Ð½¹ÑÉ…Ñ¹€ô…‘‘½¹ÑÉ…Ñ…±•¹‘…É5½¹Ñ¡Ì¡ÍÑ…ÉÐ°½¹ÑÉ…Ð¹µ¥¹¥µÕµQ•Éµ5½¹Ñ¡Ì¤ì(€€€±•Ð…¹•±±…Ñ¥½¹•…‘±¥¹”€ôÍÕ‰ÑÉ…Ñ½¹ÑÉ…Ñ9½Ñ¥•A•É¥½¡½¹ÑÉ…Ñ¹°½¹ÑÉ…Ð¤ì(€€€±•ÐÕ…É€ô€Àì(€€€Ý¡¥±”€¡½¹ÑÉ…Ð¹É•¹•Ý…±5½¹Ñ¡Ì€ø€À€˜˜…¹•±±…Ñ¥½¹•…‘±¥¹”€ðÑ½‘…ä€˜˜Õ…É€ð€ÈÐÀ¤ì(€€€€€½¹ÑÉ…Ñ¹€ô…‘‘½¹ÑÉ…Ñ…±•¹‘…É5½¹Ñ¡Ì¡½¹ÑÉ…Ñ¹°½¹ÑÉ…Ð¹É•¹•Ý…±5½¹Ñ¡Ì¤ì(€€€€€…¹•±±…Ñ¥½¹•…‘±¥¹”€ôÍÕ‰ÑÉ…Ñ½¹ÑÉ…Ñ9½Ñ¥•A•É¥½¡½¹ÑÉ…Ñ¹°½¹ÑÉ…Ð¤ì(€€€€€Õ…É€¬ô€Äì(€€€ô((€€€½¹ÍÐÉ•Ù¥•Ý	…Í”€ô½¹ÑÉ…Ñ-•åQ½…Ñ”¡½¹ÑÉ…Ð¹±…ÍÑI•Ù¥•Ý•‘…Ñ”¤ñðÍÑ…ÉÐì(€€€½¹ÍÐ¹•áÑI•Ù¥•Ü€ô…‘‘½¹ÑÉ…Ñ…±•¹‘…É5½¹Ñ¡Ì¡É•Ù¥•Ý	…Í”°½¹ÑÉ…Ð¹É•Ù¥•Ý%¹Ñ•ÉÙ…±5½¹Ñ¡Ì¤ì(€€€½¹ÍÐÉ•Ù¥•ÝÕ”€ô½¹ÑÉ…Ð¹…Ñ¥Ù”€˜˜¹•áÑI•Ù¥•Ü€ðôÑ½‘…äì(€€€½¹ÍÐ‘…åÍU¹Ñ¥±…¹•±±…Ñ¥½¸€ô5…Ñ ¹•¥° ¡…¹•±±…Ñ¥½¹•…‘±¥¹”¹•ÑQ¥µ” ¤€´Ñ½‘…ä¹•ÑQ¥µ” ¤¤€¼€àØÐÀÀÀÀÀ¤ì(€€€±•Ð­¥¹€ô€ÍÕ•ÍÌœì(€€€±•ÐÍÑ…ÑÕÌ€ô€%¸=É‘¹Õ¹œœì(€€€¥˜€ …½¹ÑÉ…Ð¹…Ñ¥Ù”¤ì(€€€€€­¥¹€ô€œœì(€€€€€ÍÑ…ÑÕÌ€ô€%¹…­Ñ¥Øœì(€€€ô•±Í”¥˜€¡½¹ÑÉ…Ð¹É•¹•Ý…±5½¹Ñ¡Ì€ôôô€À€˜˜‘…åÍU¹Ñ¥±…¹•±±…Ñ¥½¸€ð€À¤ì(€€€€€­¥¹€ô€‘…¹•Èœì(€€€€€ÍÑ…ÑÕÌ€ô€É¥ÍÐ…‰•±…Õ™•¸œì(€€€ô•±Í”¥˜€¡‘…åÍU¹Ñ¥±…¹•±±…Ñ¥½¸€ðô€ÌÀ¤ì(€€€€€­¥¹€ô€‘…¹•Èœì(€€€€€ÍÑ…ÑÕÌ€ô€/ñ¹‘¥Õ¹œ‰…±•¹ÑÍ¡•¥‘•¸œì(€€€ô•±Í”¥˜€¡É•Ù¥•ÝÕ”ñð‘…åÍU¹Ñ¥±…¹•±±…Ñ¥½¸€ðô€äÀ¤ì(€€€€€­¥¹€ô€Ý…É¹¥¹œœì(€€€€€ÍÑ…ÑÕÌ€ôÉ•Ù¥•ÝÕ”€ü€AËñ™Õ¹œ›‘±±¥œœ€è€É¥ÍÐÙ½Éµ•É­•¸œì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€Ù…±¥èÑÉÕ”°(€€€€€µ½¹Ñ¡±å½ÍÐ°(€€€€€…¹¹Õ…±½ÍÐ°(€€€€€­¥¹°(€€€€€ÍÑ…ÑÕÌ°(€€€€€É•Ù¥•ÝÕ”°(€€€€€‘…åÍU¹Ñ¥±…¹•±±…Ñ¥½¸°(€€€€€…¹•±±…Ñ¥½¹•…‘±¥¹”°(€€€€€½¹ÑÉ…Ñ¹°(€€€€€¹•áÑI•Ù¥•Ü(€€€ôì(€ô((€™Õ¹Ñ¥½¸•Ñ½¹ÑÉ…ÑÑÑ•¹Ñ¥½¹%Ñ•µÌ¡É•™•É•¹•…Ñ”€ô¹•Ü…Ñ” ¤¤ì(€€€¹½Éµ…±¥é•½¹ÑÉ…ÑÌ ¤ì(€€€½¹ÍÐ¥Ñ•µÌ€ômtì(€€€ÍÑ…Ñ”¹½¹ÑÉ…ÑÌ¹™¥±Ñ•È ¡½¹ÑÉ…Ð¤€ôø½¹ÑÉ…Ð¹…Ñ¥Ù”€„ôô™…±Í”¤¹™½É…  ¡½¹ÑÉ…Ð¤€ôøì(€€€€€½¹ÍÐÍ¡•‘Õ±”€ô•Ñ½¹ÑÉ…ÑM¡•‘Õ±”¡½¹ÑÉ…Ð°É•™•É•¹•…Ñ”¤ì(€€€€€¥˜€ …Í¡•‘Õ±”¹Ù…±¥¤ì(€€€€€€€¥Ñ•µÌ¹ÁÕÍ ¡ì½¹ÑÉ…Ð°­¥¹è€Ý…É¹¥¹œœ°ÑåÁ”è€µ¥ÍÍ¥¹œµ‘…Ñ”œ°Ñ¥Ñ±”è€‘í½¹ÑÉ…Ð¹¹…µ”ñð€Y•ÉÑÉ…œôèMÑ…ÉÑ‘…ÑÕ´™•¡±Ñ€°‘•Ñ…¥°è€=¡¹”Y•ÉÑÉ…Í‰•¥¹¸¯Ù¹¹•¸/ñ¹‘¥Õ¹œÕ¹»‘¡ÍÑ”AËñ™Õ¹œ¹¥¡Ð‰•É•¡¹•ÐÝ•É‘•¸¸œô¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€¥˜€¡Í¡•‘Õ±”¹‘…åÍU¹Ñ¥±…¹•±±…Ñ¥½¸€ðô€ÌÀ¤ì(€€€€€€€½¹ÍÐÁ…ÍÐ€ôÍ¡•‘Õ±”¹‘…åÍU¹Ñ¥±…¹•±±…Ñ¥½¸€ð€Àì(€€€€€€€¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€€€€€€€½¹ÑÉ…Ð°(€€€€€€€€€­¥¹è€‘…¹•Èœ°(€€€€€€€€€ÑåÁ”è€…¹•±±…Ñ¥½¸œ°(€€€€€€€€€Ñ¥Ñ±”è€‘í½¹ÑÉ…Ð¹¹…µ”ñð€Y•ÉÑÉ…œôè€‘íÁ…ÍÐ€ü€/ñ¹‘¥Õ¹Í™É¥ÍÐƒñ‰•ÉÍ¡É¥ÑÑ•¸œ€è€/ñ¹‘¥Õ¹œ‰…±•¹ÑÍ¡•¥‘•¸õ€°(€€€€€€€€€‘•Ñ…¥°èY½É…ÕÍÍ¥¡Ñ±¥¡”É¥ÍÐ€‘í™½Éµ…Ñ½¹ÑÉ…Ñ…Ñ”¡Í¡•‘Õ±”¹…¹•±±…Ñ¥½¹•…‘±¥¹”¥ôƒ
ÜY•ÉÑÉ…Í•¹‘”€‘í™½Éµ…Ñ½¹ÑÉ…Ñ…Ñ”¡Í¡•‘Õ±”¹½¹ÑÉ…Ñ¹¥ô¹€(€€€€€€€ô¤ì(€€€€€ô•±Í”¥˜€¡Í¡•‘Õ±”¹‘…åÍU¹Ñ¥±…¹•±±…Ñ¥½¸€ðô€äÀ¤ì(€€€€€€€¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€€€€€€€½¹ÑÉ…Ð°(€€€€€€€€€­¥¹è€Ý…É¹¥¹œœ°(€€€€€€€€€ÑåÁ”è€…¹•±±…Ñ¥½¸œ°(€€€€€€€€€Ñ¥Ñ±”è€‘í½¹ÑÉ…Ð¹¹…µ”ñð€Y•ÉÑÉ…œôè/ñ¹‘¥Õ¹Í™É¥ÍÐÙ½Éµ•É­•¹€°(€€€€€€€€€‘•Ñ…¥°è9½ €‘íÍ¡•‘Õ±”¹‘…åÍU¹Ñ¥±…¹•±±…Ñ¥½¹ôQ…”‰¥Ì€‘í™½Éµ…Ñ½¹ÑÉ…Ñ…Ñ”¡Í¡•‘Õ±”¹…¹•±±…Ñ¥½¹•…‘±¥¹”¥ô¹€(€€€€€€€ô¤ì(€€€€€ô(€€€€€¥˜€¡Í¡•‘Õ±”¹É•Ù¥•ÝÕ”¤ì(€€€€€€€¥Ñ•µÌ¹ÁÕÍ ¡ì(€€€€€€€€€½¹ÑÉ…Ð°(€€€€€€€€€­¥¹è€Ý…É¹¥¹œœ°(€€€€€€€€€ÑåÁ”è€É•Ù¥•Üœ°(€€€€€€€€€Ñ¥Ñ±”è€‘í½¹ÑÉ…Ð¹¹…µ”ñð€Y•ÉÑÉ…œôèY•ÉÑÉ…ÍÁËñ™Õ¹œ›‘±±¥€°(€€€€€€€€€‘•Ñ…¥°è•Á±…¹ÐÍ•¥Ð€‘í™½Éµ…Ñ½¹ÑÉ…Ñ…Ñ”¡Í¡•‘Õ±”¹¹•áÑI•Ù¥•Ü¥ô¸AÉ•¥ÌÕ¹	•‘…É˜­ÕÉèÁËñ™•¸¹€(€€€€€€€ô¤ì(€€€€€ô(€€€ô¤ì(€€€½¹ÍÐÉ…¹¬€ôì‘…¹•Èè€À°Ý…É¹¥¹œè€Ä°¥¹™¼è€Èôì(€€€É•ÑÕÉ¸¥Ñ•µÌ¹Í½ÉÐ ¡„°ˆ¤€ôø€¡É…¹­m„¹­¥¹‘t€üü€ä¤€´€¡É…¹­mˆ¹­¥¹‘t€üü€ä¤ñðMÑÉ¥¹œ¡„¹Ñ¥Ñ±”¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡ˆ¹Ñ¥Ñ±”¤°€‘”œ¤¤ì(€ô((€™Õ¹Ñ¥½¸µ…É­½¹ÑÉ…ÑI•Ù¥•Ý•¡½¹ÑÉ…Ð¤ì(€€€¥˜€ …½¹ÑÉ…Ð¤É•ÑÕÉ¸ì(€€€½¹ÑÉ…Ð¹±…ÍÑI•Ù¥•Ý•‘…Ñ”€ô½¹ÑÉ…Ñ…Ñ•Q½-•ä¡¹•Ü…Ñ” ¤¤ì(€€€…‘‘¡…¹•1½œ Y•ÉÑË‘”œ°€‘í½¹ÑÉ…Ð¹¹…µ”ñð€Y•ÉÑÉ…œô…±Ì•ÁËñ™Ðµ…É­¥•ÉÐ¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€Í…Ù•MÑ…Ñ” ¤ì(€€€É•¹‘•È ¤ì(€ô((€™Õ¹Ñ¥½¸Í¡½Ý½¹ÑÉ…Ñ‘¥Ñ½È¡½¹ÑÉ…Ð€ô¹Õ±°°ÁÉ•Í•Ð€ô¹Õ±°¤ì(€€€½¹ÍÐ•‘¥Ñ¥¹œ€ô€„…½¹ÑÉ…Ðì(€€€½¹ÍÐÍ½ÕÉ”€ô¹½Éµ…±¥é•½¹ÑÉ…Ð¡½¹ÑÉ…Ð€üì€¸¸¹½¹ÑÉ…Ðô€è€¡ÁÉ•Í•Ð€üì€¸¸¹ÁÉ•Í•Ðô€èì(€€€€€…Ñ•½Éäè€M½¹ÍÑ¥•Ìœ°(€€€€€…µ½Õ¹Ðè€À°(€€€€€‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ìè€Ä°(€€€€€ÍÑ…ÉÑ…Ñ”è€œœ°(€€€€€µ¥¹¥µÕµQ•Éµ5½¹Ñ¡Ìè€ÄÈ°(€€€€€¹½Ñ¥•A•É¥½‘Y…±Õ”è€Ä°(€€€€€¹½Ñ¥•A•É¥½‘U¹¥Ðè€µ½¹Ñ¡Ìœ°(€€€€€É•¹•Ý…±5½¹Ñ¡Ìè€ÄÈ°(€€€€€±…ÍÑI•Ù¥•Ý•‘…Ñ”è½¹ÑÉ…Ñ…Ñ•Q½-•ä¡¹•Ü…Ñ” ¤¤°(€€€€€É•Ù¥•Ý%¹Ñ•ÉÙ…±5½¹Ñ¡Ìè€ÄÈ°(€€€€€…Ñ¥Ù”èÑÉÕ”(€€€ô¤¤ì(€€€½¹ÍÐ±¥¹­•‘M½ÕÉ•A½ÍÐ€ô•Ñ½¹ÑÉ…ÑM½ÕÉ•A½ÍÐ¡Í½ÕÉ”¤ì(€€€½¹ÍÐ½¹Ñ•¹Ð€ôÉ•…Ñ•U¥° ‘¥Øœ°€µ½‘…°µ™½É´½¹ÑÉ…Ðµ•‘¥Ñ½Èµ™½É´œ¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•Õ¥‘•‘½Éµ%¹ÑÉ¼ (€€€€€•‘¥Ñ¥¹œ€ü€Y•ÉÑÉ…œ‰•…É‰•¥Ñ•¸œ€è€¡±¥¹­•‘M½ÕÉ•A½ÍÐ€ü€É­…¹¹Ñ•¸Y•ÉÑÉ…œÁËñ™•¸œ€è€Y•ÉÑÉ…œ•É™…ÍÍ•¸œ¤°(€€€€€±¥¹­•‘M½ÕÉ•A½ÍÐ(€€€€€€€€ü€9…µ”°	•ÑÉ…œÕ¹i…¡±Õ¹ÍÝ•¥Í”ÝÕÉ‘•¸…ÕÌ‘•¥¹•¸±…Õ™•¹‘•¸-½ÍÑ•¸ƒñ‰•É¹½µµ•¸¸ÉŸ‘¹é”½‘•ÈÁËñ™”©•ÑéÐ‘¥”Y•ÉÑÉ…Í‘…Ñ•¸¸œ(€€€€€€€€è€QÉ…”¹ÕÈ‘¥”¹…‰•¸•¥¸°‘¥”‘Ô­•¹¹ÍÐ¸•ÈY•ÉÑÉ…Í‰•¥¹¸Ý¥É›ñÈ‘¥”…ÕÑ½µ…Ñ¥Í¡”É¥ÍÑ‰•É•¡¹Õ¹œ‰•»ÙÑ¥Ð¸œ(€€€€¤¤ì(€€€¥˜€¡±¥¹­•‘M½ÕÉ•A½ÍÐ¤ì(€€€€€½¹ÍÐÍ½ÕÉ•9½Ñ¥”€ôÉ•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”¥¹™¼½¹ÑÉ…ÐµÍ½ÕÉ”µ¹½Ñ¥”œ¤ì(€€€€€Í½ÕÉ•9½Ñ¥”¹¥¹¹•É!Q50€ô€ñÍÑÉ½¹œùÕÑ½µ…Ñ¥Í Ù•É­»ñÁ™Ðèð½ÍÑÉ½¹œø€‘í•Í…Á•!Ñµ°¡•Ñ½¹ÑÉ…ÑM½ÕÉ•1…‰•°¡Í½ÕÉ”¹Í½ÕÉ•QåÁ”°±¥¹­•‘M½ÕÉ•A½ÍÐ¤¥ô¸	•ÑÉ…œÕ¹i…¡±Õ¹ÍÝ•¥Í”‰±•¥‰•¸µ¥Ð‘¥•Í•´-½ÍÑ•¹Á½ÍÑ•¸Íå¹¡É½¸¹€ì(€€€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Í½ÕÉ•9½Ñ¥”¤ì(€€€ô((€€€½¹ÍÐ¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹…µ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹…µ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸%¹Ñ•É¹•ÐéÕ¡…ÕÍ”œì(€€€¹…µ•%¹ÁÕÐ¹Ù…±Õ”€ôÍ½ÕÉ”¹¹…µ”ì(€€€½¹ÍÐÁÉ½Ù¥‘•É%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€ÁÉ½Ù¥‘•É%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€ÁÉ½Ù¥‘•É%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸Q•±•­½´œì(€€€ÁÉ½Ù¥‘•É%¹ÁÕÐ¹Ù…±Õ”€ôÍ½ÕÉ”¹ÁÉ½Ù¥‘•Èì(€€€½¹ÍÐ¥‘•¹Ñ¥ÑåI½Ü€ôÉ•…Ñ•U¥° ‘¥Øœ°€É½Üœ¤ì(€€€¥‘•¹Ñ¥ÑåI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ Y•ÉÑÉ…Í¹…µ”œ°¹…µ•%¹ÁÕÐ¤¤ì(€€€¥‘•¹Ñ¥ÑåI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ¹‰¥•Ñ•Èœ°ÁÉ½Ù¥‘•É%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¥‘•¹Ñ¥ÑåI½Ü¤ì((€€€½¹ÍÐ…Ñ•½ÉåM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€•Ñ½¹ÑÉ…Ñ…Ñ•½É¥•Ì ¤¹™½É…  ¡…Ñ•½Éä¤€ôø…Ñ•½ÉåM•±•Ð¹…ÁÁ•¹‘¡¥±¡¹•Ü=ÁÑ¥½¸¡…Ñ•½Éä°…Ñ•½Éä¤¤¤ì(€€€…Ñ•½ÉåM•±•Ð¹Ù…±Õ”€ôÍ½ÕÉ”¹…Ñ•½Éäì(€€€½¹ÍÐ…µ½Õ¹Ñ%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•±¡Í½ÕÉ”¹…µ½Õ¹Ð¤ì(€€€½¹ÍÐ‰¥±±¥¹M•±•Ð€ôÉ•…Ñ•%¹Ñ•ÉÙ…±M•±•Ð¡Í½ÕÉ”¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ì¤ì(€€€¥˜€¡±¥¹­•‘M½ÕÉ•A½ÍÐ¤ì(€€€€€…µ½Õ¹Ñ%¹ÁÕÐ¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€‰¥±±¥¹M•±•Ð¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€ô(€€€½¹ÍÐ½ÍÑI½Ü€ôÉ•…Ñ•U¥° ‘¥Øœ°€É½Ü½¹ÑÉ…Ðµ½ÍÐµ™¥•±‘Ìœ¤ì(€€€½ÍÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ -…Ñ•½É¥”œ°…Ñ•½ÉåM•±•Ð¤¤ì(€€€½ÍÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•ÑÉ…œ¥¸ƒŠ
°œ°…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€½ÍÑI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i…¡±Õ¹ÍÝ•¥Í”œ°‰¥±±¥¹M•±•Ð¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡½ÍÑI½Ü¤ì((€€€½¹ÍÐÍÑ…ÉÑ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€ÍÑ…ÉÑ%¹ÁÕÐ¹ÑåÁ”€ô€‘…Ñ”œì(€€€ÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”€ôÍ½ÕÉ”¹ÍÑ…ÉÑ…Ñ”ì(€€€½¹ÍÐÑ•Éµ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€Ñ•Éµ%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€Ñ•Éµ%¹ÁÕÐ¹µ¥¸€ô€œÀœì(€€€Ñ•Éµ%¹ÁÕÐ¹µ…à€ô€œØÀÀœì(€€€Ñ•Éµ%¹ÁÕÐ¹ÍÑ•À€ô€œÄœì(€€€Ñ•Éµ%¹ÁÕÐ¹Ù…±Õ”€ôMÑÉ¥¹œ¡Í½ÕÉ”¹µ¥¹¥µÕµQ•Éµ5½¹Ñ¡Ì¤ì(€€€½¹ÍÐ‘ÕÉ…Ñ¥½¹I½Ü€ôÉ•…Ñ•U¥° ‘¥Øœ°€É½Üœ¤ì(€€€‘ÕÉ…Ñ¥½¹I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ Y•ÉÑÉ…Í‰•¥¹¸œ°ÍÑ…ÉÑ%¹ÁÕÐ¤¤ì(€€€‘ÕÉ…Ñ¥½¹I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 5¥¹‘•ÍÑ±…Õ™é•¥Ð¥¸5½¹…Ñ•¸œ°Ñ•Éµ%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡‘ÕÉ…Ñ¥½¹I½Ü¤ì(€€€¥˜€¡Í½ÕÉ”¹ÍÑ…ÉÑ…Ñ•ÍÑ¥µ…Ñ•¤ì(€€€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•½¹ÑÉ…Ðµ•ÍÑ¥µ…Ñ•µ‘…Ñ”µ¹½Ñ”œ°€•È€Ä¸Q…œ‘•ÌMÑ…ÉÑµ½¹…ÑÌÝÕÉ‘”Ù½É³‘Õ™¥œ•¥¹•Í•ÑéÐ¸	¥ÑÑ”‘…Ì•¹…Õ”Y•ÉÑÉ…Í‘…ÑÕ´ÁËñ™•¸Õ¹‰•¤	•‘…É˜ƒ‘¹‘•É¸¸œ¤¤ì(€€€ô((€€€½¹ÍÐ¹½Ñ¥•Y…±Õ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹½Ñ¥•Y…±Õ•%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€¹½Ñ¥•Y…±Õ•%¹ÁÕÐ¹µ¥¸€ô€œÀœì(€€€¹½Ñ¥•Y…±Õ•%¹ÁÕÐ¹µ…à€ô€œÄÈÀœì(€€€¹½Ñ¥•Y…±Õ•%¹ÁÕÐ¹ÍÑ•À€ô€œÄœì(€€€¹½Ñ¥•Y…±Õ•%¹ÁÕÐ¹Ù…±Õ”€ôMÑÉ¥¹œ¡Í½ÕÉ”¹¹½Ñ¥•A•É¥½‘Y…±Õ”¤ì(€€€½¹ÍÐ¹½Ñ¥•U¹¥ÑM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€mlµ½¹Ñ¡Ìœ°€5½¹…Ñ”t°lÝ••­Ìœ°€]½¡•¸t°l‘…åÌœ°€Q…”ut¹™½É…  ¡mÙ…±Õ”°±…‰•±t¤€ôø¹½Ñ¥•U¹¥ÑM•±•Ð¹…ÁÁ•¹‘¡¥±¡¹•Ü=ÁÑ¥½¸¡±…‰•°°Ù…±Õ”¤¤¤ì(€€€¹½Ñ¥•U¹¥ÑM•±•Ð¹Ù…±Õ”€ôÍ½ÕÉ”¹¹½Ñ¥•A•É¥½‘U¹¥Ðì(€€€½¹ÍÐÉ•¹•Ý…±%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•¹•Ý…±%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€É•¹•Ý…±%¹ÁÕÐ¹µ¥¸€ô€œÀœì(€€€É•¹•Ý…±%¹ÁÕÐ¹µ…à€ô€œÄÈÀœì(€€€É•¹•Ý…±%¹ÁÕÐ¹ÍÑ•À€ô€œÄœì(€€€É•¹•Ý…±%¹ÁÕÐ¹Ù…±Õ”€ôMÑÉ¥¹œ¡Í½ÕÉ”¹É•¹•Ý…±5½¹Ñ¡Ì¤ì(€€€½¹ÍÐ¹½Ñ¥•I½Ü€ôÉ•…Ñ•U¥° ‘¥Øœ°€É½Ü½¹ÑÉ…Ðµ¹½Ñ¥”µ™¥•±‘Ìœ¤ì(€€€¹½Ñ¥•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ /ñ¹‘¥Õ¹Í™É¥ÍÐœ°¹½Ñ¥•Y…±Õ•%¹ÁÕÐ¤¤ì(€€€¹½Ñ¥•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ¥¹¡•¥Ðœ°¹½Ñ¥•U¹¥ÑM•±•Ð¤¤ì(€€€¹½Ñ¥•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ Y•É³‘¹•ÉÕ¹œ¥¸5½¹…Ñ•¸€ À€ô­•¥¹”¤œ°É•¹•Ý…±%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¹½Ñ¥•I½Ü¤ì((€€€½¹ÍÐÉ•Ù¥•Ý•‘%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•Ù¥•Ý•‘%¹ÁÕÐ¹ÑåÁ”€ô€‘…Ñ”œì(€€€É•Ù¥•Ý•‘%¹ÁÕÐ¹Ù…±Õ”€ôÍ½ÕÉ”¹±…ÍÑI•Ù¥•Ý•‘…Ñ”ì(€€€½¹ÍÐÉ•Ù¥•Ý%¹Ñ•ÉÙ…±%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•Ù¥•Ý%¹Ñ•ÉÙ…±%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€É•Ù¥•Ý%¹Ñ•ÉÙ…±%¹ÁÕÐ¹µ¥¸€ô€œÄœì(€€€É•Ù¥•Ý%¹Ñ•ÉÙ…±%¹ÁÕÐ¹µ…à€ô€œÄÈÀœì(€€€É•Ù¥•Ý%¹Ñ•ÉÙ…±%¹ÁÕÐ¹ÍÑ•À€ô€œÄœì(€€€É•Ù¥•Ý%¹Ñ•ÉÙ…±%¹ÁÕÐ¹Ù…±Õ”€ôMÑÉ¥¹œ¡Í½ÕÉ”¹É•Ù¥•Ý%¹Ñ•ÉÙ…±5½¹Ñ¡Ì¤ì(€€€½¹ÍÐÉ•Ù¥•ÝI½Ü€ôÉ•…Ñ•U¥° ‘¥Øœ°€É½Üœ¤ì(€€€É•Ù¥•ÝI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ iÕ±•ÑéÐ•ÁËñ™Ðœ°É•Ù¥•Ý•‘%¹ÁÕÐ¤¤ì(€€€É•Ù¥•ÝI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ É¹•ÕÐÁËñ™•¸¹… 5½¹…Ñ•¸œ°É•Ù¥•Ý%¹Ñ•ÉÙ…±%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•Ù¥•ÝI½Ü¤ì((€€€½¹ÍÐ¹½Ñ•Í%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ•áÑ…É•„œ¤ì(€€€¹½Ñ•Í%¹ÁÕÐ¹É½ÝÌ€ô€Ìì(€€€¹½Ñ•Í%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€=ÁÑ¥½¹…°èQ…É¥˜°-Õ¹‘•¹¹Õµµ•È°	•Í½¹‘•É¡•¥Ñ•¸ƒŠ˜œì(€€€¹½Ñ•Í%¹ÁÕÐ¹Ù…±Õ”€ôÍ½ÕÉ”¹¹½Ñ•Ìì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥èœ°¹½Ñ•Í%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€¥”‰•É•¡¹•Ñ•¸Q•Éµ¥¹”Í¥¹•¥¹”A±…¹Õ¹Í¡¥±™”¸5‡}•‰±¥ ‰±•¥‰•¸‘¥”É¥ÍÑ•¸¥´Ñ…ÑÏ‘¡±¥¡•¸Y•ÉÑÉ…œ¸œ¤¤ì((€€€Í¡½Ý5½‘…°¡•‘¥Ñ¥¹œ€ü€Y•ÉÑÉ…œ‰•…É‰•¥Ñ•¸œ€è€9•Õ•¸Y•ÉÑÉ…œ•É™…ÍÍ•¸œ°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœô°(€€€€€ì(€€€€€€€±…‰•°è€MÁ•¥¡•É¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ¹…µ”€ôMÑÉ¥¹œ¡¹…µ•%¹ÁÕÐ¹Ù…±Õ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ …¹…µ”¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸9…µ•¸›ñÈ‘•¸Y•ÉÑÉ…œ•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸	•ÑÉ…œ•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥˜€¡ÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”€˜˜€…¥Í½¹ÑÉ…Ñ…Ñ•-•ä¡ÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¸Ÿñ±Ñ¥•ÌMÑ…ÉÑ‘…ÑÕ´•¥¹•‰•¸¸œ¤ì((€€€€€€€€€½¹ÍÐÍ…Ù•‘½¹ÑÉ…Ð€ô¹½Éµ…±¥é•½¹ÑÉ…Ð¡ì(€€€€€€€€€€€€¸¸¹Í½ÕÉ”°(€€€€€€€€€€€¥è•‘¥Ñ¥¹œ€ü½¹ÑÉ…Ð¹¥€è•¹•É…Ñ•% ¤°(€€€€€€€€€€€¹…µ”°(€€€€€€€€€€€ÁÉ½Ù¥‘•ÈèÁÉ½Ù¥‘•É%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€…Ñ•½Éäè…Ñ•½ÉåM•±•Ð¹Ù…±Õ”°(€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ìè9Õµ‰•È¡‰¥±±¥¹M•±•Ð¹Ù…±Õ”ñð€Ä¤°(€€€€€€€€€€€ÍÑ…ÉÑ…Ñ”èÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€µ¥¹¥µÕµQ•Éµ5½¹Ñ¡Ìè9Õµ‰•È¡Ñ•Éµ%¹ÁÕÐ¹Ù…±Õ”ñð€À¤°(€€€€€€€€€€€¹½Ñ¥•A•É¥½‘Y…±Õ”è9Õµ‰•È¡¹½Ñ¥•Y…±Õ•%¹ÁÕÐ¹Ù…±Õ”ñð€À¤°(€€€€€€€€€€€¹½Ñ¥•A•É¥½‘U¹¥Ðè¹½Ñ¥•U¹¥ÑM•±•Ð¹Ù…±Õ”°(€€€€€€€€€€€É•¹•Ý…±5½¹Ñ¡Ìè9Õµ‰•È¡É•¹•Ý…±%¹ÁÕÐ¹Ù…±Õ”ñð€À¤°(€€€€€€€€€€€±…ÍÑI•Ù¥•Ý•‘…Ñ”èÉ•Ù¥•Ý•‘%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€É•Ù¥•Ý%¹Ñ•ÉÙ…±5½¹Ñ¡Ìè9Õµ‰•È¡É•Ù¥•Ý%¹Ñ•ÉÙ…±%¹ÁÕÐ¹Ù…±Õ”ñð€ÄÈ¤°(€€€€€€€€€€€¹½Ñ•Ìè¹½Ñ•Í%¹ÁÕÐ¹Ù…±Õ”°(€€€€€€€€€€€…Ñ¥Ù”è•‘¥Ñ¥¹œ€ü½¹ÑÉ…Ð¹…Ñ¥Ù”€„ôô™…±Í”€èÑÉÕ”°(€€€€€€€€€€€ÍÑ…ÉÑ…Ñ•ÍÑ¥µ…Ñ•è™…±Í”(€€€€€€€€€ô¤ì(€€€€€€€€€¥˜€¡•‘¥Ñ¥¹œ¤=‰©•Ð¹…ÍÍ¥¸¡½¹ÑÉ…Ð°Í…Ù•‘½¹ÑÉ…Ð¤ì(€€€€€€€€€•±Í”ì(€€€€€€€€€€€ÍÑ…Ñ”¹½¹ÑÉ…ÑÌ¹ÁÕÍ ¡Í…Ù•‘½¹ÑÉ…Ð¤ì(€€€€€€€€€€€¥˜€¡Í…Ù•‘½¹ÑÉ…Ð¹Í½ÕÉ•A½ÍÑ%¤ì(€€€€€€€€€€€€€½¹ÍÐÍÕ•ÍÑ¥½¹-•ä€ô€‘íÍ…Ù•‘½¹ÑÉ…Ð¹Í½ÕÉ•QåÁ•ôè‘íÍ…Ù•‘½¹ÑÉ…Ð¹Í½ÕÉ•A½ÍÑ%‘õ€ì(€€€€€€€€€€€€€ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì€ô€¡ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ìñðmt¤¹™¥±Ñ•È ¡­•ä¤€ôø­•ä€„ôôÍÕ•ÍÑ¥½¹-•ä¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€€€…‘‘¡…¹•1½œ Y•ÉÑË‘”œ°€‘íÍ…Ù•‘½¹ÑÉ…Ð¹¹…µ•ô€‘í•‘¥Ñ¥¹œ€ü€…­ÑÕ…±¥Í¥•ÉÐœ€è€…¹•±•Ðô¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•É½¹ÑÉ…ÑÌ ¤ì(€€€¥˜€ …½¹ÑÉ…ÑÍM•Ñ¥½¸¤É•ÑÕÉ¸ì(€€€¹½Éµ…±¥é•½¹ÑÉ…ÑÌ ¤ì(€€€½¹ÑÉ…ÑÍM•Ñ¥½¸¹¥¹¹•É!Q50€ô€œœì(€€€½¹ÍÐÁ…”€ôÉ•…Ñ•U¥° ‘¥Øœ°€‘…Í¡‰½…ÉµÁ…”½¹ÑÉ…ÑÌµÁ…”œ¤ì(€€€½¹ÍÐ¡•…‘•È€ôÉ•…Ñ•U¥° ‘¥Øœ°€‘…Í¡‰½…Éµ¡•…‘•È½¹ÑÉ…ÑÌµ¡•…‘•Èœ¤ì(€€€½¹ÍÐÑ¥Ñ±•]É…À€ôÉ•…Ñ•U¥° ‘¥Øœ°€‘…Í¡‰½…ÉµÑ¥Ñ±”µÝÉ…Àœ¤ì(€€€Ñ¥Ñ±•]É…À¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Èœ°€œœ°€Y•ÉÑË‘”œ¤¤ì(€€€Ñ¥Ñ±•]É…À¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€œœ°€-½ÍÑ•¸ÁËñ™•¸°/ñ¹‘¥Õ¹Í™É¥ÍÑ•¸¥´	±¥¬‰•¡…±Ñ•¸Õ¹É•¡Ñé•¥Ñ¥œÙ•É±•¥¡•¸¸œ¤¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡Ñ¥Ñ±•]É…À¤ì(€€€½¹ÍÐ…‘‘	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€…‘‘	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€…‘‘	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€…‘‘	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€Y•ÉÑÉ…œ•É™…ÍÍ•¸œì(€€€…‘‘	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½Ý½¹ÑÉ…Ñ‘¥Ñ½È ¤¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡…‘‘	ÕÑÑ½¸¤ì(€€€Á…”¹…ÁÁ•¹‘¡¥±¡¡•…‘•È¤ì((€€€½¹ÍÐ…Ñ¥Ù•½¹ÑÉ…ÑÌ€ôÍÑ…Ñ”¹½¹ÑÉ…ÑÌ¹™¥±Ñ•È ¡½¹ÑÉ…Ð¤€ôø½¹ÑÉ…Ð¹…Ñ¥Ù”€„ôô™…±Í”¤ì(€€€½¹ÍÐ…±±MÕ•ÍÑ¥½¹Ì€ô•Ñ½¹ÑÉ…ÑMÕ•ÍÑ¥½¹Ì¡ì¥¹±Õ‘•¥Íµ¥ÍÍ•èÑÉÕ”ô¤ì(€€€½¹ÍÐÍÕ•ÍÑ¥½¹Ì€ô…±±MÕ•ÍÑ¥½¹Ì¹™¥±Ñ•È ¡ÍÕ•ÍÑ¥½¸¤€ôø€…ÍÕ•ÍÑ¥½¸¹‘¥Íµ¥ÍÍ•¤ì(€€€½¹ÍÐ‘¥Íµ¥ÍÍ•‘MÕ•ÍÑ¥½¹½Õ¹Ð€ô…±±MÕ•ÍÑ¥½¹Ì¹™¥±Ñ•È ¡ÍÕ•ÍÑ¥½¸¤€ôøÍÕ•ÍÑ¥½¸¹‘¥Íµ¥ÍÍ•¤¹±•¹Ñ ì(€€€½¹ÍÐµ½¹Ñ¡±åQ½Ñ…°€ô…Ñ¥Ù•½¹ÑÉ…ÑÌ¹É•‘Õ” ¡ÍÕ´°½¹ÑÉ…Ð¤€ôøÍÕ´€¬•Ñ½¹ÑÉ…Ñ5½¹Ñ¡±å½ÍÐ¡½¹ÑÉ…Ð¤°€À¤ì(€€€½¹ÍÐ…¹¹Õ…±Q½Ñ…°€ô…Ñ¥Ù•½¹ÑÉ…ÑÌ¹É•‘Õ” ¡ÍÕ´°½¹ÑÉ…Ð¤€ôøÍÕ´€¬•Ñ½¹ÑÉ…Ñ¹¹Õ…±½ÍÐ¡½¹ÑÉ…Ð¤°€À¤ì(€€€½¹ÍÐ…ÑÑ•¹Ñ¥½¸€ô•Ñ½¹ÑÉ…ÑÑÑ•¹Ñ¥½¹%Ñ•µÌ ¤ì(€€€½¹ÍÐÍ¡•‘Õ±•Ì€ô…Ñ¥Ù•½¹ÑÉ…ÑÌ(€€€€€€¹µ…À ¡½¹ÑÉ…Ð¤€ôø€¡ì½¹ÑÉ…Ð°Í¡•‘Õ±”è•Ñ½¹ÑÉ…ÑM¡•‘Õ±”¡½¹ÑÉ…Ð¤ô¤¤(€€€€€€¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä¹Í¡•‘Õ±”¹Ù…±¥€˜˜•¹ÑÉä¹Í¡•‘Õ±”¹…¹•±±…Ñ¥½¹•…‘±¥¹”¤(€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø„¹Í¡•‘Õ±”¹…¹•±±…Ñ¥½¹•…‘±¥¹”€´ˆ¹Í¡•‘Õ±”¹…¹•±±…Ñ¥½¹•…‘±¥¹”¤ì(€€€½¹ÍÐ¹•áÑ•…‘±¥¹”€ôÍ¡•‘Õ±•ÍlÁtì((€€€Á…”¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€­Ñ¥Ù”Y•ÉÑË‘”œ°Ù…±Õ”èMÑÉ¥¹œ¡…Ñ¥Ù•½¹ÑÉ…ÑÌ¹±•¹Ñ ¤ô°(€€€€€ì±…‰•°è€-½ÍÑ•¸ÁÉ¼5½¹…Ðœ°Ù…±Õ”è•ÕÉ¼¡µ½¹Ñ¡±åQ½Ñ…°¤°¡¥¹Ðè€9ÕÈY•É±•¥¡ÍÝ•ÉÐ°­•¥¸éÕÏ‘Ñé±¥¡•È‰éÕœ¸œô°(€€€€€ì±…‰•°è€-½ÍÑ•¸ÁÉ¼)…¡Èœ°Ù…±Õ”è•ÕÉ¼¡…¹¹Õ…±Q½Ñ…°¤ô°(€€€€€ì±…‰•°è€É­…¹¹Ñ”Y½ÉÍ¡³‘”œ°Ù…±Õ”èMÑÉ¥¹œ¡ÍÕ•ÍÑ¥½¹Ì¹±•¹Ñ ¤°­¥¹èÍÕ•ÍÑ¥½¹Ì¹±•¹Ñ €ü€¥¹™¼œ€è€ÍÕ•ÍÌœô°(€€€€€ì±…‰•°è€)•ÑéÐÁËñ™•¸œ°Ù…±Õ”èMÑÉ¥¹œ¡…ÑÑ•¹Ñ¥½¸¹±•¹Ñ ¤°­¥¹è…ÑÑ•¹Ñ¥½¸¹Í½µ” ¡¥Ñ•´¤€ôø¥Ñ•´¹­¥¹€ôôô€‘…¹•Èœ¤€ü€‘…¹•Èœ€è€¡…ÑÑ•¹Ñ¥½¸¹±•¹Ñ €ü€Ý…É¹¥¹œœ€è€ÍÕ•ÍÌœ¤ô°(€€€€€ì±…‰•°è€;‘¡ÍÑ”/ñ¹‘¥Õ¹Í™É¥ÍÐœ°Ù…±Õ”è¹•áÑ•…‘±¥¹”€ü™½Éµ…Ñ½¹ÑÉ…Ñ…Ñ”¡¹•áÑ•…‘±¥¹”¹Í¡•‘Õ±”¹…¹•±±…Ñ¥½¹•…‘±¥¹”¤€è€œ´œô(€€€t¤¤ì((€€€½¹ÍÐ‰Õ‘•Ñ9½Ñ¥”€ôÉ•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”¥¹™¼½¹ÑÉ…Ðµ‰Õ‘•Ðµ¹½Ñ¥”œ¤ì(€€€‰Õ‘•Ñ9½Ñ¥”¹¥¹¹•É!Q50€ô€œñÍÑÉ½¹œù-•¥¹”½ÁÁ•±ë‘¡±Õ¹œèð½ÍÑÉ½¹œø¥”Y•ÉÑÉ…Í­½ÍÑ•¸‘¥•¹•¸¡¥•È¹ÕÈéÕÈƒq‰•ÉÍ¥¡Ð¸Y½´Ù•É›ñ‰…É•¸	•ÑÉ…œÝ•É‘•¸Ý•¥Ñ•É¡¥¸…ÕÍÍ¡±¥—}±¥ ‘¥”A½ÍÑ•¸Õ¹Ñ•ÈƒŠy•µ•¥¹Í…µ”-½ÍÑ•»Šp½‘•ÈƒŠyA•ÉÏÙ¹±¥¡”ÕÍ…‰•»Šp…‰•é½•¸¸œì(€€€Á…”¹…ÁÁ•¹‘¡¥±¡‰Õ‘•Ñ9½Ñ¥”¤ì((€€€¥˜€¡ÍÕ•ÍÑ¥½¹Ì¹±•¹Ñ ñð‘¥Íµ¥ÍÍ•‘MÕ•ÍÑ¥½¹½Õ¹Ð¤ì(€€€€€½¹ÍÐÍÕ•ÍÑ¥½¹…É€ôÉ•…Ñ•U¥° ‘¥Øœ°€…É½µÁ…Ðµ…É½¹ÑÉ…ÐµÍÕ•ÍÑ¥½¹Ìµ…Éœ¤ì(€€€€€½¹ÍÐÍÕ•ÍÑ¥½¹!•…€ôÉ•…Ñ•U¥° ‘¥Øœ°€½µÁ…ÐµÍ•Ñ¥½¸µ¡•…½¹ÑÉ…ÐµÍÕ•ÍÑ¥½¸µ¡•…œ¤ì(€€€€€½¹ÍÐÍÕ•ÍÑ¥½¹Q¥Ñ±”€ôÉ•…Ñ•U¥° ‘¥Øœ°€½¹ÑÉ…ÐµÍÕ•ÍÑ¥½¸µÑ¥Ñ±”œ¤ì(€€€€€ÍÕ•ÍÑ¥½¹Q¥Ñ±”¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€ÕÌ±…Õ™•¹‘•¸-½ÍÑ•¸•É­…¹¹Ðœ¤¤ì(€€€€€ÍÕ•ÍÑ¥½¹Q¥Ñ±”¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€I••±·“}¥”-½ÍÑ•¸Ý•É‘•¸Ù½É•Í¡±…•¸¸Y•É­»ñÁ™Ñ”M¡Õ±‘•¸°Kñ­±…•¸Õ¹ÑåÁ¥Í¡”	Õ‘•ÑÓÙÁ™”Í¥¹‰•É•¥ÑÌ…ÕÍ•™¥±Ñ•ÉÐ¸œ¤¤ì(€€€€€ÍÕ•ÍÑ¥½¹!•…¹…ÁÁ•¹‘¡¥±¡ÍÕ•ÍÑ¥½¹Q¥Ñ±”¤ì(€€€€€ÍÕ•ÍÑ¥½¹!•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°ÍÕ•ÍÑ¥½¹Ì¹±•¹Ñ €ü€Á¥±°¥¹™¼œ€è€Á¥±°ÍÕ•ÍÌœ°€‘íÍÕ•ÍÑ¥½¹Ì¹±•¹Ñ¡ô½™™•¹€¤¤ì(€€€€€ÍÕ•ÍÑ¥½¹…É¹…ÁÁ•¹‘¡¥±¡ÍÕ•ÍÑ¥½¹!•…¤ì((€€€€€¥˜€¡ÍÕ•ÍÑ¥½¹Ì¹±•¹Ñ ¤ì(€€€€€€€½¹ÍÐÍÕ•ÍÑ¥½¹1¥ÍÐ€ôÉ•…Ñ•U¥° ‘¥Øœ°€½¹ÑÉ…ÐµÍÕ•ÍÑ¥½¸µ±¥ÍÐœ¤ì(€€€€€€€ÍÕ•ÍÑ¥½¹Ì¹™½É…  ¡ÍÕ•ÍÑ¥½¸¤€ôøì(€€€€€€€€€½¹ÍÐÉ½Ü€ôÉ•…Ñ•U¥° ‘¥Øœ°€½¹ÑÉ…ÐµÍÕ•ÍÑ¥½¸µÉ½Üœ¤ì(€€€€€€€€€½¹ÍÐ½Áä€ôÉ•…Ñ•U¥° ‘¥Øœ°€½¹ÑÉ…ÐµÍÕ•ÍÑ¥½¸µ½Áäœ¤ì(€€€€€€€€€½Áä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°ÍÕ•ÍÑ¥½¸¹¹…µ”¤¤ì(€€€€€€€€€½¹ÍÐ¥¹Ñ•ÉÙ…±Q•áÐ€ôÍÕ•ÍÑ¥½¸¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ì€ôôô€Ä(€€€€€€€€€€€€ü€µ½¹…Ñ±¥ œ(€€€€€€€€€€€€èÍÕ•ÍÑ¥½¸¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ì€ôôô€ÄÈ(€€€€€€€€€€€€€€ü€«‘¡É±¥ œ(€€€€€€€€€€€€€€è…±±”€‘íÍÕ•ÍÑ¥½¸¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Íô5½¹…Ñ•€ì(€€€€€€€€€½Áä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°€‘íÍÕ•ÍÑ¥½¸¹Í½ÕÉ•1…‰•±ôƒ
Ü€‘í•ÕÉ¼¡ÍÕ•ÍÑ¥½¸¹…µ½Õ¹Ð¥ô€‘í¥¹Ñ•ÉÙ…±Q•áÑôƒ
Ü€‘íÍÕ•ÍÑ¥½¸¹…Ñ•½Éåõ€¤¤ì(€€€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡½Áä¤ì(€€€€€€€€€½¹ÍÐ…Ñ¥½¹Ì€ôÉ•…Ñ•U¥° ‘¥Øœ°€½¹ÑÉ…ÐµÍÕ•ÍÑ¥½¸µ…Ñ¥½¹Ìœ¤ì(€€€€€€€€€½¹ÍÐ…•ÁÑ	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€€€…•ÁÑ	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€€€€€…•ÁÑ	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éä½µÁ…Ðœì(€€€€€€€€€…•ÁÑ	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€AËñ™•¸€˜ƒñ‰•É¹•¡µ•¸œì(€€€€€€€€€…•ÁÑ	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½Ý½¹ÑÉ…Ñ‘¥Ñ½È¡¹Õ±°°ì(€€€€€€€€€€€¹…µ”èÍÕ•ÍÑ¥½¸¹¹…µ”°(€€€€€€€€€€€ÁÉ½Ù¥‘•Èè€œœ°(€€€€€€€€€€€…Ñ•½ÉäèÍÕ•ÍÑ¥½¸¹…Ñ•½Éä°(€€€€€€€€€€€…µ½Õ¹ÐèÍÕ•ÍÑ¥½¸¹…µ½Õ¹Ð°(€€€€€€€€€€€‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡ÌèÍÕ•ÍÑ¥½¸¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ì°(€€€€€€€€€€€ÍÑ…ÉÑ…Ñ”èÍÕ•ÍÑ¥½¸¹ÍÑ…ÉÑ…Ñ”°(€€€€€€€€€€€ÍÑ…ÉÑ…Ñ•ÍÑ¥µ…Ñ•è€„…ÍÕ•ÍÑ¥½¸¹ÍÑ…ÉÑ…Ñ”°(€€€€€€€€€€€µ¥¹¥µÕµQ•Éµ5½¹Ñ¡Ìè€ÄÈ°(€€€€€€€€€€€¹½Ñ¥•A•É¥½‘Y…±Õ”è€Ä°(€€€€€€€€€€€¹½Ñ¥•A•É¥½‘U¹¥Ðè€µ½¹Ñ¡Ìœ°(€€€€€€€€€€€É•¹•Ý…±5½¹Ñ¡Ìè€ÄÈ°(€€€€€€€€€€€±…ÍÑI•Ù¥•Ý•‘…Ñ”è½¹ÑÉ…Ñ…Ñ•Q½-•ä¡¹•Ü…Ñ” ¤¤°(€€€€€€€€€€€É•Ù¥•Ý%¹Ñ•ÉÙ…±5½¹Ñ¡Ìè€ÄÈ°(€€€€€€€€€€€¹½Ñ•Ìè€œœ°(€€€€€€€€€€€…Ñ¥Ù”èÑÉÕ”°(€€€€€€€€€€€Í½ÕÉ•QåÁ”èÍÕ•ÍÑ¥½¸¹Í½ÕÉ•QåÁ”°(€€€€€€€€€€€Í½ÕÉ•A½ÍÑ%èÍÕ•ÍÑ¥½¸¹Í½ÕÉ•A½ÍÑ%(€€€€€€€€€ô¤¤ì(€€€€€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡…•ÁÑ	ÕÑÑ½¸¤ì(€€€€€€€€€½¹ÍÐ‘¥Íµ¥ÍÍ	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€€€‘¥Íµ¥ÍÍ	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€€€€€‘¥Íµ¥ÍÍ	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éä½µÁ…Ðœì(€€€€€€€€€‘¥Íµ¥ÍÍ	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€-•¥¸Y•ÉÑÉ…œœì(€€€€€€€€€‘¥Íµ¥ÍÍ	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôø‘¥Íµ¥ÍÍ½¹ÑÉ…ÑMÕ•ÍÑ¥½¸¡ÍÕ•ÍÑ¥½¸¤¤ì(€€€€€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡‘¥Íµ¥ÍÍ	ÕÑÑ½¸¤ì(€€€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹Ì¤ì(€€€€€€€€€ÍÕ•ÍÑ¥½¹1¥ÍÐ¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì(€€€€€€€ô¤ì(€€€€€€€ÍÕ•ÍÑ¥½¹…É¹…ÁÁ•¹‘¡¥±¡ÍÕ•ÍÑ¥½¹1¥ÍÐ¤ì(€€€€€ô•±Í”ì(€€€€€€€ÍÕ•ÍÑ¥½¹…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€µÕÑ•½¹ÑÉ…ÐµÍÕ•ÍÑ¥½¹Ìµ•µÁÑäœ°€±±”•É­…¹¹Ñ•¸-½ÍÑ•¸ÝÕÉ‘•¸‰•É•¥ÑÌéÕ•½É‘¹•Ð½‘•È…±ÌƒŠy-•¥¸Y•ÉÑÉ…ŸŠpµ…É­¥•ÉÐ¸œ¤¤ì(€€€€€ô((€€€€€¥˜€¡‘¥Íµ¥ÍÍ•‘MÕ•ÍÑ¥½¹½Õ¹Ð¤ì(€€€€€€€½¹ÍÐÉ•ÍÑ½É•I½Ü€ôÉ•…Ñ•U¥° ‘¥Øœ°€½¹ÑÉ…ÐµÍÕ•ÍÑ¥½¸µÉ•ÍÑ½É”œ¤ì(€€€€€€€É•ÍÑ½É•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°€‘í‘¥Íµ¥ÍÍ•‘MÕ•ÍÑ¥½¹½Õ¹ÑôY½ÉÍ¡±…œ½Y½ÉÍ¡³‘”…±ÌƒŠy-•¥¸Y•ÉÑÉ…ŸŠp…ÕÍ•‰±•¹‘•Ð¹€¤¤ì(€€€€€€€½¹ÍÐÉ•ÍÑ½É•	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€É•ÍÑ½É•	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€€€É•ÍÑ½É•	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éä½µÁ…Ðœì(€€€€€€€É•ÍÑ½É•	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€]¥•‘•È…¹é•¥•¸œì(€€€€€€€É•ÍÑ½É•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°É•ÍÑ½É•¥Íµ¥ÍÍ•‘½¹ÑÉ…ÑMÕ•ÍÑ¥½¹Ì¤ì(€€€€€€€É•ÍÑ½É•I½Ü¹…ÁÁ•¹‘¡¥±¡É•ÍÑ½É•	ÕÑÑ½¸¤ì(€€€€€€€ÍÕ•ÍÑ¥½¹…É¹…ÁÁ•¹‘¡¥±¡É•ÍÑ½É•I½Ü¤ì(€€€€€ô(€€€€€Á…”¹…ÁÁ•¹‘¡¥±¡ÍÕ•ÍÑ¥½¹…É¤ì(€€€ô((€€€¥˜€¡…ÑÑ•¹Ñ¥½¸¹±•¹Ñ ¤ì(€€€€€½¹ÍÐ…±•ÉÑ…É€ôÉ•…Ñ•U¥° ‘¥Øœ°€…É½µÁ…Ðµ…É½¹ÑÉ…Ðµ…ÑÑ•¹Ñ¥½¸µ…Éœ¤ì(€€€€€½¹ÍÐ…±•ÉÑ!•…€ôÉ•…Ñ•U¥° ‘¥Øœ°€½µÁ…ÐµÍ•Ñ¥½¸µ¡•…œ¤ì(€€€€€…±•ÉÑ!•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€)•ÑéÐÁËñ™•¸œ¤¤ì(€€€€€…±•ÉÑ!•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°…ÑÑ•¹Ñ¥½¸¹Í½µ” ¡¥Ñ•´¤€ôø¥Ñ•´¹­¥¹€ôôô€‘…¹•Èœ¤€ü€Á¥±°‘…¹•Èœ€è€Á¥±°Ý…É¹¥¹œœ°€‘í…ÑÑ•¹Ñ¥½¸¹±•¹Ñ¡ô!¥¹Ý•¥Ì¡”¥€¤¤ì(€€€€€…±•ÉÑ…É¹…ÁÁ•¹‘¡¥±¡…±•ÉÑ!•…¤ì(€€€€€½¹ÍÐ…±•ÉÑ1¥ÍÐ€ôÉ•…Ñ•U¥° ‘¥Øœ°€½¹ÑÉ…Ðµ…ÑÑ•¹Ñ¥½¸µ±¥ÍÐœ¤ì(€€€€€…ÑÑ•¹Ñ¥½¸¹™½É…  ¡¥Ñ•´¤€ôøì(€€€€€€€½¹ÍÐÉ½Ü€ôÉ•…Ñ•U¥° ‘¥Øœ°½¹ÑÉ…Ðµ…ÑÑ•¹Ñ¥½¸µÉ½Ü€‘í¥Ñ•´¹­¥¹‘õ€¤ì(€€€€€€€½¹ÍÐ½Áä€ôÉ•…Ñ•U¥° ‘¥Øœ°€½¹ÑÉ…Ðµ…ÑÑ•¹Ñ¥½¸µ½Áäœ¤ì(€€€€€€€½Áä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°¥Ñ•´¹Ñ¥Ñ±”¤¤ì(€€€€€€€½Áä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°¥Ñ•´¹‘•Ñ…¥°¤¤ì(€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡½Áä¤ì(€€€€€€€½¹ÍÐ…Ñ¥½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€€€…Ñ¥½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€€€…Ñ¥½¸¹±…ÍÍ9…µ”€ô¥Ñ•´¹ÑåÁ”€ôôô€É•Ù¥•Üœ€ü€ÍÕ•ÍÌ½µÁ…Ðœ€è€Í•½¹‘…Éä½µÁ…Ðœì(€€€€€€€…Ñ¥½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô¥Ñ•´¹ÑåÁ”€ôôô€É•Ù¥•Üœ€ü€!•ÕÑ”•ÁËñ™Ðœ€è€	•…É‰•¥Ñ•¸œì(€€€€€€€…Ñ¥½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôø¥Ñ•´¹ÑåÁ”€ôôô€É•Ù¥•Üœ€üµ…É­½¹ÑÉ…ÑI•Ù¥•Ý•¡¥Ñ•´¹½¹ÑÉ…Ð¤€èÍ¡½Ý½¹ÑÉ…Ñ‘¥Ñ½È¡¥Ñ•´¹½¹ÑÉ…Ð¤¤ì(€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¸¤ì(€€€€€€€…±•ÉÑ1¥ÍÐ¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì(€€€€€ô¤ì(€€€€€…±•ÉÑ…É¹…ÁÁ•¹‘¡¥±¡…±•ÉÑ1¥ÍÐ¤ì(€€€€€Á…”¹…ÁÁ•¹‘¡¥±¡…±•ÉÑ…É¤ì(€€€ô((€€€½¹ÍÐ±¥ÍÑ…É€ôÉ•…Ñ•U¥° ‘¥Øœ°€…É½¹ÑÉ…ÑÌµ±¥ÍÐµ…Éœ¤ì(€€€½¹ÍÐ±¥ÍÑ!•…€ôÉ•…Ñ•U¥° ‘¥Øœ°€½µÁ…ÐµÍ•Ñ¥½¸µ¡•…œ¤ì(€€€±¥ÍÑ!•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€Y•ÉÑÉ…Ïñ‰•ÉÍ¥¡Ðœ¤¤ì(€€€±¥ÍÑ!•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°€Á¥±°œ°€‘íÍÑ…Ñ”¹½¹ÑÉ…ÑÌ¹±•¹Ñ¡ô•ÍÁ•¥¡•ÉÑ€¤¤ì(€€€±¥ÍÑ…É¹…ÁÁ•¹‘¡¥±¡±¥ÍÑ!•…¤ì((€€€¥˜€ …ÍÑ…Ñ”¹½¹ÑÉ…ÑÌ¹±•¹Ñ ¤ì(€€€€€½¹ÍÐ•µÁÑä€ôÉ•…Ñ•U¥° ‘¥Øœ°€•µÁÑäµÍÑ…Ñ”œ°€9½ ­•¥¹”Y•ÉÑË‘”•É™…ÍÍÐ¸	•¥¹¹”éÕ´	•¥ÍÁ¥•°µ¥ÐMÑÉ½´°%¹Ñ•É¹•Ð½‘•ÈY•ÉÍ¥¡•ÉÕ¹•¸¸œ¤ì(€€€€€½¹ÍÐ•µÁÑå	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€•µÁÑå	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€•µÁÑå	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éä½µÁ…Ðœì(€€€€€•µÁÑå	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€ÉÍÑ•¸Y•ÉÑÉ…œ•É™…ÍÍ•¸œì(€€€€€•µÁÑå	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½Ý½¹ÑÉ…Ñ‘¥Ñ½È ¤¤ì(€€€€€•µÁÑä¹…ÁÁ•¹‘¡¥±¡•µÁÑå	ÕÑÑ½¸¤ì(€€€€€±¥ÍÑ…É¹…ÁÁ•¹‘¡¥±¡•µÁÑä¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”½¹ÑÉ…ÐµÑ…‰±”œì(€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ùY•ÉÑÉ…œð½Ñ øñÑ ù-…Ñ•½É¥”ð½Ñ øñÑ ùi…¡±Õ¹œð½Ñ øñÑ ù5½¹…ÑÍÝ•ÉÐð½Ñ øñÑ ù/ñ¹‘¥Õ¹Í™É¥ÍÐð½Ñ øñÑ ùY•ÉÑÉ…Í•¹‘”ð½Ñ øñÑ ù;‘¡ÍÑ”AËñ™Õ¹œð½Ñ øñÑ ùMÑ…ÑÕÌð½Ñ øñÑ ù­Ñ¥½¸ð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€½¹ÍÐ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€ÍÑ…Ñ”¹½¹ÑÉ…ÑÌ(€€€€€€€€¹Í±¥” ¤(€€€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø9Õµ‰•È¡ˆ¹…Ñ¥Ù”€„ôô™…±Í”¤€´9Õµ‰•È¡„¹…Ñ¥Ù”€„ôô™…±Í”¤ñðMÑÉ¥¹œ¡„¹¹…µ”¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡ˆ¹¹…µ”¤°€‘”œ¤¤(€€€€€€€€¹™½É…  ¡½¹ÑÉ…Ð¤€ôøì(€€€€€€€€€½¹ÍÐÍ¡•‘Õ±”€ô•Ñ½¹ÑÉ…ÑM¡•‘Õ±”¡½¹ÑÉ…Ð¤ì(€€€€€€€€€½¹ÍÐÉ½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì((€€€€€€€€€½¹ÍÐ¹…µ••±°€ôÉ•…Ñ•U¥° Ñœ°€½¹ÑÉ…Ðµ¹…µ”µ•±°œ¤ì(€€€€€€€€€¹…µ••±°¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°½¹ÑÉ…Ð¹¹…µ”ñð€Y•ÉÑÉ…œœ¤¤ì(€€€€€€€€€¥˜€¡½¹ÑÉ…Ð¹ÁÉ½Ù¥‘•È¤¹…µ••±°¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•œ°½¹ÑÉ…Ð¹ÁÉ½Ù¥‘•È¤¤ì(€€€€€€€€€½¹ÍÐÍ½ÕÉ•A½ÍÐ€ô•Ñ½¹ÑÉ…ÑM½ÕÉ•A½ÍÐ¡½¹ÑÉ…Ð¤ì(€€€€€€€€€¥˜€¡Í½ÕÉ•A½ÍÐ¤¹…µ••±°¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€½¹ÑÉ…ÐµÍ½ÕÉ”µ±…‰•°œ°ÕÑ½µ…Ñ¥Í …ÕÌ€‘í•Ñ½¹ÑÉ…ÑM½ÕÉ•1…‰•°¡½¹ÑÉ…Ð¹Í½ÕÉ•QåÁ”°Í½ÕÉ•A½ÍÐ¥õ€¤¤ì(€€€€€€€€€•±Í”¥˜€¡½¹ÑÉ…Ð¹Í½ÕÉ•A½ÍÑ%¤¹…µ••±°¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€½¹ÑÉ…ÐµÍ½ÕÉ”µ±…‰•°µ¥ÍÍ¥¹œœ°€Y•É­»ñÁ™Ñ•È-½ÍÑ•¹Á½ÍÑ•¸™•¡±Ðœ¤¤ì(€€€€€€€€€¥˜€¡½¹ÑÉ…Ð¹¹½Ñ•Ì¤¹…µ••±°¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Íµ…±°œ°€µÕÑ•½¹ÑÉ…Ðµ¹½Ñ”œ°½¹ÑÉ…Ð¹¹½Ñ•Ì¤¤ì(€€€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡¹…µ••±°¤ì(€€€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Ñœ°€œœ°½¹ÑÉ…Ð¹…Ñ•½Éä¤¤ì(€€€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Ñœ°€œœ°€‘í•ÕÉ¼¡½¹ÑÉ…Ð¹…µ½Õ¹Ð¥ôƒ
Ü€‘í½¹ÑÉ…Ð¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ì€ôôô€Ä€ü€µ½¹…Ñ±¥ œ€è½¹ÑÉ…Ð¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Ì€ôôô€ÄÈ€ü€«‘¡É±¥ œ€è…±±”€‘í½¹ÑÉ…Ð¹‰¥±±¥¹%¹Ñ•ÉÙ…±5½¹Ñ¡Íô5½¹…Ñ•õ€¤¤ì(€€€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Ñœ°€œœ°•ÕÉ¼¡Í¡•‘Õ±”¹µ½¹Ñ¡±å½ÍÐ¤¤¤ì(€€€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Ñœ°€œœ°Í¡•‘Õ±”¹Ù…±¥€ü™½Éµ…Ñ½¹ÑÉ…Ñ…Ñ”¡Í¡•‘Õ±”¹…¹•±±…Ñ¥½¹•…‘±¥¹”¤€è€MÑ…ÉÑ‘…ÑÕ´™•¡±Ðœ¤¤ì(€€€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Ñœ°€œœ°Í¡•‘Õ±”¹Ù…±¥€ü™½Éµ…Ñ½¹ÑÉ…Ñ…Ñ”¡Í¡•‘Õ±”¹½¹ÑÉ…Ñ¹¤€è€œ´œ¤¤ì(€€€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Ñœ°€œœ°Í¡•‘Õ±”¹¹•áÑI•Ù¥•Ü€ü™½Éµ…Ñ½¹ÑÉ…Ñ…Ñ”¡Í¡•‘Õ±”¹¹•áÑI•Ù¥•Ü¤€è€œ´œ¤¤ì(€€€€€€€€€½¹ÍÐÍÑ…ÑÕÍ•±°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€€€ÍÑ…ÑÕÍ•±°¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°Á¥±°€‘íÍ¡•‘Õ±”¹­¥¹ñð€œõ€¹ÑÉ¥´ ¤°Í¡•‘Õ±”¹ÍÑ…ÑÕÌ¤¤ì(€€€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡ÍÑ…ÑÕÍ•±°¤ì((€€€€€€€€€½¹ÍÐ…Ñ¥½¹•±°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€€€…Ñ¥½¹•±°¹…ÁÁ•¹‘¡¥±¡É•…Ñ•Ñ¥½¹5•¹Ô¡l(€€€€€€€€€€€ì±…‰•°è€	•…É‰•¥Ñ•¸œ°±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½Ý½¹ÑÉ…Ñ‘¥Ñ½È¡½¹ÑÉ…Ð¤ô°(€€€€€€€€€€€½¹ÑÉ…Ð¹…Ñ¥Ù”€„ôô™…±Í”€üì±…‰•°è€!•ÕÑ”•ÁËñ™Ðœ°±…ÍÍ9…µ”è€ÍÕ•ÍÌœ°½¹±¥¬è€ ¤€ôøµ…É­½¹ÑÉ…ÑI•Ù¥•Ý•¡½¹ÑÉ…Ð¤ô€è¹Õ±°°(€€€€€€€€€€€ì±…‰•°è½¹ÑÉ…Ð¹…Ñ¥Ù”€ôôô™…±Í”€ü€­Ñ¥Ù¥•É•¸œ€è€•…­Ñ¥Ù¥•É•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€ ¤€ôøì½¹ÑÉ…Ð¹…Ñ¥Ù”€ô½¹ÑÉ…Ð¹…Ñ¥Ù”€ôôô™…±Í”ì…‘‘¡…¹•1½œ Y•ÉÑË‘”œ°€‘í½¹ÑÉ…Ð¹¹…µ”ñð€Y•ÉÑÉ…œô€‘í½¹ÑÉ…Ð¹…Ñ¥Ù”€ü€…­Ñ¥Ù¥•ÉÐœ€è€‘•…­Ñ¥Ù¥•ÉÐô¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ìÍ…Ù•MÑ…Ñ” ¤ìÉ•¹‘•È ¤ìôô°(€€€€€€€€€€€ì±…‰•°è€3ÙÍ¡•¸œ°±…ÍÍ9…µ”è€‘…¹•Èœ°½¹±¥¬è€ ¤€ôøì¥˜€¡½¹™¥É´¡Y•ÉÑÉ…œƒŠx‘í½¹ÑÉ…Ð¹¹…µ”ñð€Y•ÉÑÉ…œ÷Šp³ÙÍ¡•¸ý€¤¤ìÍÑ…Ñ”¹½¹ÑÉ…ÑÌ€ôÍÑ…Ñ”¹½¹ÑÉ…ÑÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹¥€„ôô½¹ÑÉ…Ð¹¥¤ì…‘‘¡…¹•1½œ Y•ÉÑË‘”œ°€‘í½¹ÑÉ…Ð¹¹…µ”ñð€Y•ÉÑÉ…œô•³ÙÍ¡Ð¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ìÍ…Ù•MÑ…Ñ” ¤ìÉ•¹‘•È ¤ìôôô(€€€€€€€€€t¤¤ì(€€€€€€€€€É½Ü¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹•±°¤ì(€€€€€€€€€‰½‘ä¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì(€€€€€€€ô¤ì(€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡‰½‘ä¤ì(€€€€€±¥ÍÑ…É¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€ô(€€€Á…”¹…ÁÁ•¹‘¡¥±¡±¥ÍÑ…É¤ì(€€€½¹ÑÉ…ÑÍM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡Á…”¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉM•ÑÑ¥¹Ì ¤ì(€€€Í•ÑÑ¥¹ÍM•Ñ¥½¸¹¥¹¹•É!Q50€ô€œœì(€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€½¹ÍÐµ½¹Ñ¡I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€µ½¹Ñ¡I½Ü¹±…ÍÍ9…µ”€ô€½µÁ…ÐµÍ•Ñ¥½¸µ¡•…œì(€€€µ½¹Ñ¡I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Èœ°€œœ°€I••±¸€˜A•ÉÍ½¹•¸œ¤¤ì(€€€µ½¹Ñ¡I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°€Á¥±°œ°™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¤¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡µ½¹Ñ¡I½Ü¤ì((€€€½¹ÍÐ¡¥¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¡¥¹Ð¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€¡¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô€	•…É‰•¥Ñ•¸ƒÙ™™¹•Ð©•ÑéÐ•¥¹”­½µÁ…­Ñ”5…Í­”¸M¼‰±•¥‰Ð‘•È	•É•¥ Í¡±…¹­•È°Õ¹5½¹…ÑÍ…¹Á…ÍÍÕ¹•¸Í¥¹ÑÉ½Ñé‘•´Í¡¹•±°•ÉÉ•¥¡‰…È¸œì(€€€…É¹…ÁÁ•¹‘¡¥±¡¡¥¹Ð¤ì((€€€½¹ÍÐÑ½Ñ…±	…Í•%¹½µ”€ôÍÑ…Ñ”¹Á•ÉÍ½¹Ì¹É•‘Õ” ¡ÍÕ´°À¤€ôøÍÕ´€¬9Õµ‰•È¡À¹¹•Ðñð€À¤°€À¤ì(€€€½¹ÍÐÑ½Ñ…±Ñ¥Ù•%¹½µ”€ôÍÑ…Ñ”¹Á•ÉÍ½¹Ì¹É•‘Õ” ¡ÍÕ´°À¤€ôøÍÕ´€¬•ÑA•ÉÍ½¹9•Ð¡À°ÕÉÉ•¹Ñ5½¹Ñ ¤°€À¤ì(€€€½¹ÍÐ…‘©ÕÍÑ•‘A•ÉÍ½¹Ì€ôÍÑ…Ñ”¹Á•ÉÍ½¹Ì¹™¥±Ñ•È ¡À¤€ôøÀ¹¹•Ñ=Ù•ÉÉ¥‘•Ì€˜˜À¹¹•Ñ=Ù•ÉÉ¥‘•ÍmÕÉÉ•¹Ñ5½¹Ñ¡t€„ô¹Õ±°¤¹±•¹Ñ ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€ÉÕ¹‘±½¡¸•Í…µÐœ°Ù…±Õ”è€‘í•ÕÉ¼¡Ñ½Ñ…±	…Í•%¹½µ”¥õ€ô°(€€€€€ì±…‰•°èY•ÉÝ•¹‘•Ð¥¸€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€°Ù…±Õ”è€‘í•ÕÉ¼¡Ñ½Ñ…±Ñ¥Ù•%¹½µ”¥õ€°­¥¹è€ÍÕ•ÍÌœô°(€€€€€ì±…‰•°è€%ÍÐµÕÍé…¡±Õ¹•¸•É™…ÍÍÐœ°Ù…±Õ”èMÑÉ¥¹œ¡…‘©ÕÍÑ•‘A•ÉÍ½¹Ì¤°­¥¹è…‘©ÕÍÑ•‘A•ÉÍ½¹Ì€ø€À€ü€ÍÕ•ÍÌœ€è€œœô°(€€€€€ì±…‰•°è€A•ÉÍ½¹•¸•Í…µÐœ°Ù…±Õ”èMÑÉ¥¹œ¡ÍÑ…Ñ”¹Á•ÉÍ½¹Ì¹±•¹Ñ ¤ô(€€€t¤¤ì((€€€ÍÑ…Ñ”¹Á•ÉÍ½¹Ì¹™½É…  ¡À¤€ôøì(€€€€€•¹ÍÕÉ•A•ÉÍ½¹%¹½µ•½¹™¥œ¡À¤ì(€€€€€½¹ÍÐÁ•ÉÍ½¹…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€Á•ÉÍ½¹…É¹±…ÍÍ9…µ”€ô€…Éœì((€€€€€½¹ÍÐ¡•…‘I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€¡•…‘I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€€€½¹ÍÐÑ¥Ñ±•]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€½¹ÍÐÑ¥Ñ±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Ìœ¤ì(€€€€€Ñ¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ôÀ¹¹…µ”ì(€€€€€Ñ¥Ñ±•]É…À¹…ÁÁ•¹‘¡¥±¡Ñ¥Ñ±”¤ì((€€€€€½¹ÍÐÍ½ÕÉ•1…‰•°€ô•ÑA•ÉÍ½¹9•ÑM½ÕÉ•1…‰•°¡À°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€½¹ÍÐÍ½ÕÉ•-¥¹€ôÀ¹¹•Ñ=Ù•ÉÉ¥‘•Ì€˜˜À¹¹•Ñ=Ù•ÉÉ¥‘•ÍmÕÉÉ•¹Ñ5½¹Ñ¡t€„ô¹Õ±°€ü€ÍÕ•ÍÌœ€è€œœì(€€€€€½¹ÍÐ…Ñ¥Ù•M¡¥™Ð€ô•ÑA•ÉÍ½¹M¡¥™Ð¡À°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€½¹ÍÐ¡…ÍM¡¥™Ñ=Ù•ÉÉ¥‘”€ôÀ¹Í¡¥™Ñ=Ù•ÉÉ¥‘•Ì€˜˜À¹Í¡¥™Ñ=Ù•ÉÉ¥‘•ÍmÕÉÉ•¹Ñ5½¹Ñ¡t€„ô¹Õ±°ì((€€€€€½¹ÍÐÍ¡¥™Ñ%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€€€Í¡¥™Ñ%¹™¼¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€€€Í¡¥™Ñ%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ô€]¥¡Ñ¥”]•ÉÑ”Í¥¹‘¥É•­Ð…±Ì-…¡•±¸Í¥¡Ñ‰…È¸•Ñ…¥±ÌÕ¹ƒ¹‘•ÉÕ¹•¸ƒÙ™™¹•ÍÐ‘ÔÝ•¥Ñ•Èƒñ‰•ÈƒŠy	•…É‰•¥Ñ•»Šp¸€œì(€€€€€Ñ¥Ñ±•]É…À¹…ÁÁ•¹‘¡¥±¡Í¡¥™Ñ%¹™¼¤ì((€€€€€½¹ÍÐ‰Ñ¹]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€½¹ÍÐ•‘¥Ñ	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€•‘¥Ñ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€	•…É‰•¥Ñ•¸œì(€€€€€•‘¥Ñ	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€€€•‘¥Ñ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝA•ÉÍ½¹%¹½µ•‘¥Ñ½È¡À¤¤ì(€€€€€‰Ñ¹]É…À¹…ÁÁ•¹‘¡¥±¡•‘¥Ñ	Ñ¸¤ì((€€€€€¡•…‘I½Ü¹…ÁÁ•¹‘¡¥±¡Ñ¥Ñ±•]É…À¤ì(€€€€€¡•…‘I½Ü¹…ÁÁ•¹‘¡¥±¡‰Ñ¹]É…À¤ì(€€€€€Á•ÉÍ½¹…É¹…ÁÁ•¹‘¡¥±¡¡•…‘I½Ü¤ì((€€€€€Á•ÉÍ½¹…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€€€ì±…‰•°è€ÉÕ¹‘±½¡¸€¼	…Í¥Ìœ°Ù…±Õ”è€‘í•ÕÉ¼¡9Õµ‰•È¡À¹¹•Ðñð€À¤¥õ€ô°(€€€€€€€ì±…‰•°èY•ÉÝ•¹‘•Ð¥¸€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€°Ù…±Õ”è€‘í•ÕÉ¼¡•ÑA•ÉÍ½¹9•Ð¡À°ÕÉÉ•¹Ñ5½¹Ñ ¤¥õ€°­¥¹èÍ½ÕÉ•-¥¹ô°(€€€€€€€ì±…‰•°è¡…ÍM¡¥™Ñ=Ù•ÉÉ¥‘”€ü€Y•ÉÍ¡¥•‰Õ¹œ¹ÕÈ5½¹…Ðœ€è€Y•ÉÍ¡¥•‰Õ¹œœ°Ù…±Õ”è€‘í•ÕÉ¼¡…Ñ¥Ù•M¡¥™Ð¥õ€°­¥¹è¡…ÍM¡¥™Ñ=Ù•ÉÉ¥‘”€ü€Ý…É¹¥¹œœ€è€œœô°(€€€€€€€ì±…‰•°è€EÕ•±±”œ°Ù…±Õ”èÍ½ÕÉ•1…‰•°°­¥¹èÍ½ÕÉ•-¥¹ô(€€€€€t¤¤ì((€€€€€½¹ÍÐ¹•áÑQ¥µ•±¥¹”€ôÉÉ…ä¹¥ÍÉÉ…ä¡À¹¹•ÑQ¥µ•±¥¹”¤(€€€€€€€€üÀ¹¹•ÑQ¥µ•±¥¹”(€€€€€€€€€€€€¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä€˜˜µ½¹Ñ¡¥™˜¡ÕÉÉ•¹Ñ5½¹Ñ °•¹ÑÉä¹µ½¹Ñ ¤€øô€À¤(€€€€€€€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôøµ½¹Ñ¡¥™˜¡ÕÉÉ•¹Ñ5½¹Ñ °„¹µ½¹Ñ ¤€´µ½¹Ñ¡¥™˜¡ÕÉÉ•¹Ñ5½¹Ñ °ˆ¹µ½¹Ñ ¤¥lÁt(€€€€€€€€è¹Õ±°ì((€€€€€½¹ÍÐÑ¥µ•±¥¹•!¥¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€€€Ñ¥µ•±¥¹•!¥¹Ð¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€€€¥˜€¡¹•áÑQ¥µ•±¥¹”€˜˜¹•áÑQ¥µ•±¥¹”¹µ½¹Ñ €„ôôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€Ñ¥µ•±¥¹•!¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô;‘¡ÍÑ•È‰•­…¹¹Ñ•ÈA±…¹Ý•ÉÐè€‘í•ÕÉ¼¡¹•áÑQ¥µ•±¥¹”¹…µ½Õ¹Ð¥ô…ˆ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡¹•áÑQ¥µ•±¥¹”¹µ½¹Ñ ¥ô¹€ì(€€€€€ô•±Í”¥˜€¡•ÑÑ¥Ù•9•ÑQ¥µ•±¥¹•¹ÑÉä¡À°ÕÉÉ•¹Ñ5½¹Ñ ¤¤ì(€€€€€€€Ñ¥µ•±¥¹•!¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô¥¸A±…¹Ý•ÉÐ¥ÍÐ¡¥¹Ñ•É±•Ðì‘¥”Ñ…ÑÏ‘¡±¥¡”ÕÍé…¡±Õ¹œ­…¹¹ÍÐ‘Ôµ½¹…Ñ±¥ ¥´¥¹­½µµ•¸µ	•É•¥ •¥¹ÑÉ…•¸¹€ì(€€€€€ô•±Í”ì(€€€€€€€Ñ¥µ•±¥¹•!¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô€ñÈéÕ¯ñ¹™Ñ¥”5½¹…Ñ”¥±ÐéÕ»‘¡ÍÐ‘•È¡¥¹Ñ•É±•Ñ”ÉÕ¹‘±½¡¸¸œì(€€€€€ô(€€€€€Á•ÉÍ½¹…É¹…ÁÁ•¹‘¡¥±¡Ñ¥µ•±¥¹•!¥¹Ð¤ì((€€€€€…É¹…ÁÁ•¹‘¡¥±¡Á•ÉÍ½¹…É¤ì(€€€ô¤ì(€€€Í•ÑÑ¥¹ÍM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡…É¤ì(€ô((€™Õ¹Ñ¥½¸¹½Éµ…±¥é•M…Ù¥¹Í½…±Í½¹™¥œ ¤ì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì¤¤ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì€ômtì(€€€ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì€ôÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì(€€€€€€¹™¥±Ñ•È ¡½…°¤€ôø½…°€˜˜ÑåÁ•½˜½…°€ôôô€½‰©•Ðœ¤(€€€€€€¹µ…À ¡½…°¤€ôø€¡ì(€€€€€€€¥èÑåÁ•½˜½…°¹¥€ôôô€ÍÑÉ¥¹œœ€˜˜½…°¹¥€ü½…°¹¥€è•¹•É…Ñ•% ¤°(€€€€€€€¹…µ”èÑåÁ•½˜½…°¹¹…µ”€ôôô€ÍÑÉ¥¹œœ€˜˜½…°¹¹…µ”¹ÑÉ¥´ ¤€ü½…°¹¹…µ”¹ÑÉ¥´ ¤€è€Kñ­±…•¸µA½ÍÑ•¸œ°(€€€€€€€Ñ…É•Ñµ½Õ¹Ðè5…Ñ ¹µ…à À°9Õµ‰•È¡½…°¹Ñ…É•Ñµ½Õ¹Ðñð€À¤¤°(€€€€€€€µ½¹Ñ¡±åµ½Õ¹Ðè5…Ñ ¹µ…à À°9Õµ‰•È¡½…°¹µ½¹Ñ¡±åµ½Õ¹Ðñð€À¤¤°(€€€€€€€‰…±…¹”è5…Ñ ¹µ…à À°9Õµ‰•È¡½…°¹‰…±…¹”ñð€À¤¤°(€€€€€€€ÍÑ…ÉÑ5½¹Ñ è¥Í5½¹Ñ¡-•ä¡½…°¹ÍÑ…ÉÑ5½¹Ñ ¤€ü½…°¹ÍÑ…ÉÑ5½¹Ñ €èÕÉÉ•¹Ñ5½¹Ñ °(€€€€€€€‘Õ•5½¹Ñ è¥Í5½¹Ñ¡-•ä¡½…°¹‘Õ•5½¹Ñ ¤€ü½…°¹‘Õ•5½¹Ñ €è€œœ°(€€€€€€€…½Õ¹Ñ%è=U9QM}9	1€ü€¡ÑåÁ•½˜½…°¹…½Õ¹Ñ%€ôôô€ÍÑÉ¥¹œœ€˜˜½…°¹…½Õ¹Ñ%€ü½…°¹…½Õ¹Ñ%€èU1Q}M!I}=U9Q}%¤€è€œœ°(€€€€€€€¥ÍÑ¥Ù”è½…°¹¥ÍÑ¥Ù”€„ôô™…±Í”°(€€€€€€€¹½Ñ”èÑåÁ•½˜½…°¹¹½Ñ”€ôôô€ÍÑÉ¥¹œœ€ü½…°¹¹½Ñ”€è€œœ°(€€€€€€€ÑÉ…¹Í…Ñ¥½¹ÌèÉÉ…ä¹¥ÍÉÉ…ä¡½…°¹ÑÉ…¹Í…Ñ¥½¹Ì¤€ü½…°¹ÑÉ…¹Í…Ñ¥½¹Ì¹™¥±Ñ•È ¡Ñà¤€ôøÑà€˜˜ÑåÁ•½˜Ñà€ôôô€½‰©•Ðœ¤¹µ…À ¡Ñà¤€ôø€¡ì(€€€€€€€€€¥èÑåÁ•½˜Ñà¹¥€ôôô€ÍÑÉ¥¹œœ€˜˜Ñà¹¥€üÑà¹¥€è•¹•É…Ñ•% ¤°(€€€€€€€€€µ½¹Ñ è¥Í5½¹Ñ¡-•ä¡Ñà¹µ½¹Ñ ¤€üÑà¹µ½¹Ñ €èÕÉÉ•¹Ñ5½¹Ñ °(€€€€€€€€€ÑåÁ”èÑà¹ÑåÁ”€ôôô€Ý¥Ñ¡‘É…Üœ€ü€Ý¥Ñ¡‘É…Üœ€è€‘•Á½Í¥Ðœ°(€€€€€€€€€…µ½Õ¹Ðè5…Ñ ¹µ…à À°9Õµ‰•È¡Ñà¹…µ½Õ¹Ðñð€À¤¤°(€€€€€€€€€¹½Ñ”èÑåÁ•½˜Ñà¹¹½Ñ”€ôôô€ÍÑÉ¥¹œœ€üÑà¹¹½Ñ”€è€œœ°(€€€€€€€€€Í½ÕÉ•%èÑåÁ•½˜Ñà¹Í½ÕÉ•%€ôôô€ÍÑÉ¥¹œœ€üÑà¹Í½ÕÉ•%€è€œœ°(€€€€€€€€€Í½ÕÉ•A½ÍÑ%èÑåÁ•½˜Ñà¹Í½ÕÉ•A½ÍÑ%€ôôô€ÍÑÉ¥¹œœ€üÑà¹Í½ÕÉ•A½ÍÑ%€è€œœ°(€€€€€€€€€É•…Ñ•‘ÐèÑåÁ•½˜Ñà¹É•…Ñ•‘Ð€ôôô€ÍÑÉ¥¹œœ€üÑà¹É•…Ñ•‘Ð€è€œœ(€€€€€€€ô¤¤€èmt(€€€€€ô¤¤ì(€ô((€™Õ¹Ñ¥½¸•ÑM…Ù¥¹Í½…±ÍÑ¥Ù”¡µ½¹Ñ¡-•ä€ôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€¹½Éµ…±¥é•M…Ù¥¹Í½…±Í½¹™¥œ ¤ì(€€€É•ÑÕÉ¸ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì¹™¥±Ñ•È ¡½…°¤€ôø½…°¹¥ÍÑ¥Ù”€˜˜¥Í5½¹Ñ¡-•ä¡µ½¹Ñ¡-•ä¤€˜˜µ½¹Ñ¡¥™˜¡½…°¹ÍÑ…ÉÑ5½¹Ñ °µ½¹Ñ¡-•ä¤€øô€À¤ì(€ô((€™Õ¹Ñ¥½¸•ÑM…Ù¥¹Í½…±Í5½¹Ñ¡±åA±…¸¡µ½¹Ñ¡-•ä€ôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€É•ÑÕÉ¸•ÑM…Ù¥¹Í½…±ÍÑ¥Ù”¡µ½¹Ñ¡-•ä¤¹É•‘Õ” ¡ÍÕ´°½…°¤€ôøÍÕ´€¬9Õµ‰•È¡½…°¹µ½¹Ñ¡±åµ½Õ¹Ðñð€À¤°€À¤ì(€ô((€™Õ¹Ñ¥½¸•Ñ1¥¹­•‘M…Ù¥¹ÍA±…¹½É½…°¡½…±%°µ½¹Ñ¡-•ä€ôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€¥˜€ …½…±%ñð€…¥Í5½¹Ñ¡-•ä¡µ½¹Ñ¡-•ä¤¤É•ÑÕÉ¸€Àì(€€€É•ÑÕÉ¸l¸¸¸¡ÍÑ…Ñ”¹½µµ½¹½ÍÑÌñðmt¤°€¸¸¸¡ÍÑ…Ñ”¹Á•ÉÍ½¹…±½ÍÑÌñðmt¤°€¸¸¸¡ÍÑ…Ñ”¹‰Õ™™•ÉáÁ•¹Í•Ìñðmt¥t(€€€€€€¹™¥±Ñ•È ¡Á½ÍÐ¤€ôøÁ½ÍÐ€˜˜Á½ÍÐ¹±¥¹­•‘M…Ù¥¹Í½…±%€ôôô½…±%€˜˜¥ÍA½ÍÑÑ¥Ù•%¹5½¹Ñ ¡Á½ÍÐ°µ½¹Ñ¡-•ä¤¤(€€€€€€¹É•‘Õ” ¡ÍÕ´°Á½ÍÐ¤€ôøÍÕ´€¬9Õµ‰•È¡•Ñ™™•Ñ¥Ù•µ½Õ¹Ñ½É5½¹Ñ ¡Á½ÍÐ°µ½¹Ñ¡-•ä¤ñð€À¤€¼9Õµ‰•È¡Á½ÍÐ¹¥¹Ñ•ÉÙ…°ñð€Ä¤°€À¤ì(€ô((€™Õ¹Ñ¥½¸•Ñ1¥¹­•‘M…Ù¥¹ÍA±…¹Q½Ñ…°¡µ½¹Ñ¡-•ä€ôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€É•ÑÕÉ¸€¡ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ìñðmt¤¹É•‘Õ” ¡ÍÕ´°½…°¤€ôøÍÕ´€¬•Ñ1¥¹­•‘M…Ù¥¹ÍA±…¹½É½…°¡½…°¹¥°µ½¹Ñ¡-•ä¤°€À¤ì(€ô((€™Õ¹Ñ¥½¸•ÑM…Ù¥¹Í½…±	½Õ¹‘½É½Õ¹Ð¡…½Õ¹Ñ%¤ì(€€€¥˜€ ……½Õ¹Ñ%ñð€…ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì¤¤É•ÑÕÉ¸€Àì(€€€É•ÑÕÉ¸ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì(€€€€€€¹™¥±Ñ•È ¡½…°¤€ôø½…°€˜˜½…°¹…½Õ¹Ñ%€ôôô…½Õ¹Ñ%¤(€€€€€€¹É•‘Õ” ¡ÍÕ´°½…°¤€ôøÍÕ´€¬5…Ñ ¹µ…à À°9Õµ‰•È¡½…°¹‰…±…¹”ñð€À¤¤°€À¤ì(€ô((€™Õ¹Ñ¥½¸•ÑM…Ù¥¹Í½…±AÉ½É•ÍÌ¡½…°¤ì(€€€½¹ÍÐÑ…É•Ð€ô9Õµ‰•È¡½…°¹Ñ…É•Ñµ½Õ¹Ðñð€À¤ì(€€€½¹ÍÐ‰…±…¹”€ô9Õµ‰•È¡½…°¹‰…±…¹”ñð€À¤ì(€€€½¹ÍÐµ¥ÍÍ¥¹œ€ô5…Ñ ¹µ…à À°Ñ…É•Ð€´‰…±…¹”¤ì(€€€½¹ÍÐÁÐ€ôÑ…É•Ð€ø€À€ü5…Ñ ¹µ¥¸ ÄÀÀ°€¡‰…±…¹”€¼Ñ…É•Ð¤€¨€ÄÀÀ¤€è€Àì(€€€É•ÑÕÉ¸ìÑ…É•Ð°‰…±…¹”°µ¥ÍÍ¥¹œ°ÁÐôì(€ô((€™Õ¹Ñ¥½¸…ÁÁ±åM…Ù¥¹Í½…±QÉ…¹Í…Ñ¥½¸¡½…°°…µ½Õ¹Ð°ÑåÁ”€ô€‘•Á½Í¥Ðœ°¹½Ñ”€ô€œœ°µ½¹Ñ¡-•ä€ôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€¹½Éµ…±¥é•M…Ù¥¹Í½…±Í½¹™¥œ ¤ì(€€€½¹ÍÐœ€ôÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì¹™¥¹ ¡¥Ñ•´¤€ôø¥Ñ•´¹¥€ôôô½…°¹¥¤ì(€€€¥˜€ …œ¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐÙ…±Õ”€ô5…Ñ ¹µ…à À°9Õµ‰•È¡…µ½Õ¹Ðñð€À¤¤ì(€€€¥˜€ „¡Ù…±Õ”€ø€À¤¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐÑáQåÁ”€ôÑåÁ”€ôôô€Ý¥Ñ¡‘É…Üœ€ü€Ý¥Ñ¡‘É…Üœ€è€‘•Á½Í¥Ðœì(€€€¥˜€¡ÑáQåÁ”€ôôô€‘•Á½Í¥Ðœ¤œ¹‰…±…¹”€ô9Õµ‰•È¡œ¹‰…±…¹”ñð€À¤€¬Ù…±Õ”ì(€€€•±Í”œ¹‰…±…¹”€ô5…Ñ ¹µ…à À°9Õµ‰•È¡œ¹‰…±…¹”ñð€À¤€´Ù…±Õ”¤ì(€€€œ¹ÑÉ…¹Í…Ñ¥½¹Ì¹ÁÕÍ ¡ì(€€€€€¥è•¹•É…Ñ•% ¤°(€€€€€µ½¹Ñ è¥Í5½¹Ñ¡-•ä¡µ½¹Ñ¡-•ä¤€üµ½¹Ñ¡-•ä€èÕÉÉ•¹Ñ5½¹Ñ °(€€€€€ÑåÁ”èÑáQåÁ”°(€€€€€…µ½Õ¹ÐèÙ…±Õ”°(€€€€€¹½Ñ”è¹½Ñ”ñð€¡ÑáQåÁ”€ôôô€‘•Á½Í¥Ðœ€ü€¥¹é…¡±Õ¹œœ€è€¹Ñ¹…¡µ”œ¤°(€€€€€Í½ÕÉ•%è€œœ°(€€€€€Í½ÕÉ•A½ÍÑ%è€œœ°(€€€€€É•…Ñ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤(€€€ô¤ì(€€€…‘‘¡…¹•1½œ Kñ­±…•¸œ°€‘íœ¹¹…µ•ôè€‘íÑáQåÁ”€ôôô€‘•Á½Í¥Ðœ€ü€¥¹é…¡±Õ¹œœ€è€¹Ñ¹…¡µ”ô€‘í•ÕÉ¼¡Ù…±Õ”¥ô¹€°µ½¹Ñ¡-•ä¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝM…Ù¥¹Í½…±‘¥Ñ½È¡½…°¤ì(€€€½¹ÍÐ½…±%€ô½…°€˜˜½…°¹¥€ü½…°¹¥€è€œœì(€€€¹½Éµ…±¥é•M…Ù¥¹Í½…±Í½¹™¥œ ¤ì(€€€½¹ÍÐ¥Í9•Ü€ô€…½…±%ì(€€€½¹ÍÐ¥Ñ•´€ô€…¥Í9•Ü(€€€€€€üÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹¥€ôôô½…±%¤(€€€€€€èì¥è•¹•É…Ñ•% ¤°¹…µ”è€œœ°Ñ…É•Ñµ½Õ¹Ðè€À°µ½¹Ñ¡±åµ½Õ¹Ðè€À°‰…±…¹”è€À°ÍÑ…ÉÑ5½¹Ñ èÕÉÉ•¹Ñ5½¹Ñ °‘Õ•5½¹Ñ è€œœ°…½Õ¹Ñ%èU1Q}M!I}=U9Q}%°¥ÍÑ¥Ù”èÑÉÕ”°¹½Ñ”è€œœ°ÑÉ…¹Í…Ñ¥½¹Ìèmtôì(€€€¥˜€ …¥Ñ•´¤É•ÑÕÉ¸ì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì(€€€½¹ÍÐÉ½ÜÄ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÄ¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹…µ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹…µ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹…µ”ñð€œœì(€€€¹…µ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸ÕÑ¼µI•Á…É…ÑÕÈ°UÉ±…Õˆ°1…ÁÑ½Àœì(€€€½¹ÍÐÑ…É•Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€Ñ…É•Ñ%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€Ñ…É•Ñ%¹ÁÕÐ¹ÍÑ•À€ô€œÀ¸ÀÄœì(€€€Ñ…É•Ñ%¹ÁÕÐ¹µ¥¸€ô€œÀœì(€€€Ñ…É•Ñ%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹Ñ…É•Ñµ½Õ¹Ð€ü9Õµ‰•È¡¥Ñ•´¹Ñ…É•Ñµ½Õ¹Ð¤¹Ñ½¥á• È¤€è€œœì(€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ A½ÍÑ•¸œ°¹…µ•%¹ÁÕÐ¤¤ì(€€€É½ÜÄ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i¥•±‰•ÑÉ…œ½ÁÑ¥½¹…°œ°Ñ…É•Ñ%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½ÜÄ¤ì((€€€½¹ÍÐÉ½ÜÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÈ¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐµ½¹Ñ¡±å%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€µ½¹Ñ¡±å%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€µ½¹Ñ¡±å%¹ÁÕÐ¹ÍÑ•À€ô€œÀ¸ÀÄœì(€€€µ½¹Ñ¡±å%¹ÁÕÐ¹µ¥¸€ô€œÀœì(€€€µ½¹Ñ¡±å%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹µ½¹Ñ¡±åµ½Õ¹Ð€ü9Õµ‰•È¡¥Ñ•´¹µ½¹Ñ¡±åµ½Õ¹Ð¤¹Ñ½¥á• È¤€è€œœì(€€€½¹ÍÐ‰…±…¹•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€‰…±…¹•%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€‰…±…¹•%¹ÁÕÐ¹ÍÑ•À€ô€œÀ¸ÀÄœì(€€€‰…±…¹•%¹ÁÕÐ¹µ¥¸€ô€œÀœì(€€€‰…±…¹•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹‰…±…¹”€ü9Õµ‰•È¡¥Ñ•´¹‰…±…¹”¤¹Ñ½¥á• È¤€è€œœì(€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ •ÍÑ”5½¹…ÑÍÍÕµµ”œ°µ½¹Ñ¡±å%¹ÁÕÐ¤¤ì(€€€É½ÜÈ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ­ÑÕ•±°…¹•ÍÁ…ÉÐœ°‰…±…¹•%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½ÜÈ¤ì(€€€½¹ÍÐµ½¹Ñ¡±å!¥¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€µ½¹Ñ¡±å!¥¹Ð¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€µ½¹Ñ¡±å!¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô€-½µµÐ‘¥”µ½¹…Ñ±¥¡”¥¹é…¡±Õ¹œ…ÕÌ•¥¹•´Ù•É­»ñÁ™Ñ•¸-½ÍÑ•¹Á½ÍÑ•¸°±…ÍÍ”ƒŠy•ÍÑ”5½¹…ÑÍÍÕµµ—Šp±••È¸M¼Ý¥É‘•ÈA±…¸¹¥¡Ð‘½ÁÁ•±Ð…¹•é•¥Ð¸œì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡µ½¹Ñ¡±å!¥¹Ð¤ì((€€€½¹ÍÐÉ½ÜÌ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÌ¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐÍÑ…ÉÑ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€ÍÑ…ÉÑ%¹ÁÕÐ¹ÑåÁ”€ô€µ½¹Ñ œì(€€€ÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹ÍÑ…ÉÑ5½¹Ñ ñðÕÉÉ•¹Ñ5½¹Ñ ì(€€€½¹ÍÐ‘Õ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€‘Õ•%¹ÁÕÐ¹ÑåÁ”€ô€µ½¹Ñ œì(€€€‘Õ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹‘Õ•5½¹Ñ ñð€œœì(€€€É½ÜÌ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ MÑ…ÉÑµ½¹…Ðœ°ÍÑ…ÉÑ%¹ÁÕÐ¤¤ì(€€€É½ÜÌ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i¥•±µ½¹…Ð½ÁÑ¥½¹…°œ°‘Õ•%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½ÜÌ¤ì((€€€½¹ÍÐÉ½ÜÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½ÜÐ¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ…½Õ¹ÑM•±•Ð€ô=U9QM}9	1€üÉ•…Ñ•½Õ¹ÑM•±•Ð¡¥Ñ•´¹…½Õ¹Ñ%ñðU1Q}M!I}=U9Q}%°ì¥¹±Õ‘•9½¹”è™…±Í”ô¤€èìÙ…±Õ”è€œœôì(€€€½¹ÍÐ…Ñ¥Ù•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€…Ñ¥Ù•M•±•Ð¹¥¹¹•É!Q50€ô€œñ½ÁÑ¥½¸Ù…±Õ”ô‰ÑÉÕ”ˆù­Ñ¥Øð½½ÁÑ¥½¸øñ½ÁÑ¥½¸Ù…±Õ”ô‰™…±Í”ˆùA…ÕÍ¥•ÉÐð½½ÁÑ¥½¸øœì(€€€…Ñ¥Ù•M•±•Ð¹Ù…±Õ”€ô¥Ñ•´¹¥ÍÑ¥Ù”€ôôô™…±Í”€ü€™…±Í”œ€è€ÑÉÕ”œì(€€€¥˜€¡=U9QM}9	1¤É½ÜÐ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ -½¹Ñ¼‘•ÈKñ­±…”œ°…½Õ¹ÑM•±•Ð¤¤ì(€€€É½ÜÐ¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ MÑ…ÑÕÌœ°…Ñ¥Ù•M•±•Ð¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½ÜÐ¤ì((€€€½¹ÍÐ¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ•áÑ…É•„œ¤ì(€€€¹½Ñ•%¹ÁÕÐ¹É½ÝÌ€ô€Èì(€€€¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹½Ñ”ñð€œœì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥èœ°¹½Ñ•%¹ÁÕÐ¤¤ì((€€€Í¡½Ý5½‘…°¡¥Í9•Ü€ü€Kñ­±…•¸µA½ÍÑ•¸¡¥¹éÕ›ñ•¸œ€è€Kñ­±…•¸µA½ÍÑ•¸‰•…É‰•¥Ñ•¸œ°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœô°(€€€€€ì±…‰•°è€MÁ•¥¡•É¸œ°±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€½¹ÍÐ¹…µ”€ô¹…µ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€€€¥˜€ …¹…µ”¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸9…µ•¸•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€¥Ñ•´¹¹…µ”€ô¹…µ”ì(€€€€€€€¥Ñ•´¹Ñ…É•Ñµ½Õ¹Ð€ô5…Ñ ¹µ…à À°9Õµ‰•È¡Ñ…É•Ñ%¹ÁÕÐ¹Ù…±Õ”ñð€À¤¤ì(€€€€€€€¥Ñ•´¹µ½¹Ñ¡±åµ½Õ¹Ð€ô5…Ñ ¹µ…à À°9Õµ‰•È¡µ½¹Ñ¡±å%¹ÁÕÐ¹Ù…±Õ”ñð€À¤¤ì(€€€€€€€¥Ñ•´¹‰…±…¹”€ô5…Ñ ¹µ…à À°9Õµ‰•È¡‰…±…¹•%¹ÁÕÐ¹Ù…±Õ”ñð€À¤¤ì(€€€€€€€¥Ñ•´¹ÍÑ…ÉÑ5½¹Ñ €ô¥Í5½¹Ñ¡-•ä¡ÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”¤€üÍÑ…ÉÑ%¹ÁÕÐ¹Ù…±Õ”€èÕÉÉ•¹Ñ5½¹Ñ ì(€€€€€€€¥Ñ•´¹‘Õ•5½¹Ñ €ô¥Í5½¹Ñ¡-•ä¡‘Õ•%¹ÁÕÐ¹Ù…±Õ”¤€ü‘Õ•%¹ÁÕÐ¹Ù…±Õ”€è€œœì(€€€€€€€¥Ñ•´¹…½Õ¹Ñ%€ô…½Õ¹ÑM•±•Ð¹Ù…±Õ”ñð€œœì(€€€€€€€¥Ñ•´¹¥ÍÑ¥Ù”€ô…Ñ¥Ù•M•±•Ð¹Ù…±Õ”€„ôô€™…±Í”œì(€€€€€€€¥Ñ•´¹¹½Ñ”€ô¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”ñð€œœì(€€€€€€€¥˜€¡¥Í9•Ü¤ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì¹ÁÕÍ ¡¥Ñ•´¤ì(€€€€€€€¹½Éµ…±¥é•M…Ù¥¹Í½…±Í½¹™¥œ ¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€±½Í” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ôô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝM…Ù¥¹Í½…±QÉ…¹Í…Ñ¥½¹‘¥Ñ½È¡½…°°ÑåÁ”€ô€‘•Á½Í¥Ðœ¤ì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì(€€€½¹ÍÐ…µ½Õ¹Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹ÍÑ•À€ô€œÀ¸ÀÄœì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹µ¥¸€ô€œÀœì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”€ôÑåÁ”€ôôô€‘•Á½Í¥Ðœ€˜˜½…°¹µ½¹Ñ¡±åµ½Õ¹Ð€ü9Õµ‰•È¡½…°¹µ½¹Ñ¡±åµ½Õ¹Ð¤¹Ñ½¥á• È¤€è€œœì(€€€½¹ÍÐ¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹½Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹½Ñ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ôÑåÁ”€ôôô€‘•Á½Í¥Ðœ€ü€è¸¸™•ÍÑ”5½¹…ÑÍÍÕµµ”œ€è€è¸¸•­…Õ™Ð½‰•é…¡±Ðœì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ¡ÑåÁ”€ôôô€‘•Á½Í¥Ðœ€ü€¥¹é…¡±Õ¹œœ€è€¹Ñ¹…¡µ”œ°…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥èœ°¹½Ñ•%¹ÁÕÐ¤¤ì(€€€Í¡½Ý5½‘…°¡€‘íÑåÁ”€ôôô€‘•Á½Í¥Ðœ€ü€¥¹é…¡±Õ¹œœ€è€¹Ñ¹…¡µ”ôƒ
Ü€‘í½…°¹¹…µ•õ€°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœô°(€€€€€ì±…‰•°èÑåÁ”€ôôô€‘•Á½Í¥Ðœ€ü€¥¹é…¡±•¸œ€è€¹Ñ¹•¡µ•¸œ°±…ÍÍ9…µ”èÑåÁ”€ôôô€‘•Á½Í¥Ðœ€ü€ÍÕ•ÍÌœ€è€‘…¹•Èœ°½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”ñð€À¤ì(€€€€€€€¥˜€ „¡…µ½Õ¹Ð€ø€À¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸	•ÑÉ…œËÛ}•È…±Ì€À•¥¹ÑÉ…•¸¸œ¤ì(€€€€€€€¥˜€¡…ÁÁ±åM…Ù¥¹Í½…±QÉ…¹Í…Ñ¥½¸¡½…°°…µ½Õ¹Ð°ÑåÁ”°¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”ñð€œœ°ÕÉÉ•¹Ñ5½¹Ñ ¤¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ôô(€€€t¤ì(€ô((€€¼¼I•¹‘•ÉÐKñ­±…•¹Á±…¹Õ¹œÕ¹SÙÁ™”•µ•¥¹Í…´¥¸•¥¹•´	•É•¥ ¸(€€)™Õ¹Ñ¥½¸É•¹‘•ÉM…Ù¥¹Ì ¤ì(€€€¹½Éµ…±¥é•M…Ù¥¹Í½…±Í½¹™¥œ ¤ì(€€€Í…Ù¥¹ÍM•Ñ¥½¸¹¥¹¹•É!Q50€ô€œœì(€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€…Éœì((€€€½¹ÍÐ¡•…‘•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•…‘•È¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐÁ…•Q¥Ñ±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Èœ¤ì(€€€Á…•Q¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ô€Kñ­±…•¸€˜SÙÁ™”œì(€€€Á…•Q¥Ñ±”¹ÍÑå±”¹™±•à€ô€œÄ€Ä…ÕÑ¼œì(€€€½¹ÍÐ…‘‘	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€…‘‘	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€…‘‘	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ¬Kñ­±…•¸µA½ÍÑ•¸œì(€€€…‘‘	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝM…Ù¥¹Í½…±‘¥Ñ½È ¤¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡Á…•Q¥Ñ±”¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°€Á¥±°œ°™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¤¤¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡…‘‘	Ñ¸¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡¡•…‘•È¤ì((€€€½¹ÍÐ¡•…‘¥¹œ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Ìœ¤ì(€€€¡•…‘¥¹œ¹Ñ•áÑ½¹Ñ•¹Ð€ô€Kñ­±…•¸Á±…¹•¸œì(€€€…É¹…ÁÁ•¹‘¡¥±¡¡•…‘¥¹œ¤ì((€€€½¹ÍÐ¥¹ÑÉ¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¥¹ÑÉ¼¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€¥¹ÑÉ¼¹Ñ•áÑ½¹Ñ•¹Ð€ô€=‰•¸Á±…¹ÍÐ‘ÔKñ­±…•¸Ý¥”ÕÑ¼°UÉ±…Õˆ½‘•È-±•¥‘Õ¹œ¸…ÉÕ¹Ñ•ÈÙ•ÉÝ…±Ñ•ÍÐ‘Ô‘¥”Ù½É¡…¹‘•¹•¸SÙÁ™”Õ¹¥¡É”¥¸´½‘•ÈÕÍé…¡±Õ¹•¸¸Y•É­»ñÁ™Ñ”-½ÍÑ•¸é…¡±•¸‰•¥´	•é…¡±Ðµ5…É­¥•É•¸•¹…Ô•¥¹µ…°¥¸‘¥”Á…ÍÍ•¹‘”Kñ­±…”•¥¸¸œì(€€€…É¹…ÁÁ•¹‘¡¥±¡¥¹ÑÉ¼¤ì((€€€½¹ÍÐ…Ñ¥Ù•½…±Ì€ô•ÑM…Ù¥¹Í½…±ÍÑ¥Ù”¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐÑ½Ñ…±M…Ù•€ô€¡ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ìñðmt¤¹É•‘Õ” ¡ÍÕ´°½…°¤€ôøÍÕ´€¬9Õµ‰•È¡½…°¹‰…±…¹”ñð€À¤°€À¤ì(€€€½¹ÍÐµ½¹Ñ¡±åA±…¸€ô•ÑM…Ù¥¹Í½…±Í5½¹Ñ¡±åA±…¸¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐ±¥¹­•‘5½¹Ñ¡±åA±…¸€ô•Ñ1¥¹­•‘M…Ù¥¹ÍA±…¹Q½Ñ…°¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐÑ½Ñ…±Q…É•Ð€ô€¡ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ìñðmt¤¹É•‘Õ” ¡ÍÕ´°½…°¤€ôøÍÕ´€¬9Õµ‰•È¡½…°¹Ñ…É•Ñµ½Õ¹Ðñð€À¤°€À¤ì(€€€½¹ÍÐµ¥ÍÍ¥¹Q½Ñ…°€ô€¡ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ìñðmt¤¹É•‘Õ” ¡ÍÕ´°½…°¤€ôøÍÕ´€¬•ÑM…Ù¥¹Í½…±AÉ½É•ÍÌ¡½…°¤¹µ¥ÍÍ¥¹œ°€À¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€­Ñ¥Ù”A½ÍÑ•¸œ°Ù…±Õ”èMÑÉ¥¹œ¡…Ñ¥Ù•½…±Ì¹±•¹Ñ ¤°­¥¹è…Ñ¥Ù•½…±Ì¹±•¹Ñ €ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€ì±…‰•°è€•ÍÑ”5½¹…ÑÍÍÕµµ”œ°Ù…±Õ”è•ÕÉ¼¡µ½¹Ñ¡±åA±…¸¤°­¥¹èµ½¹Ñ¡±åA±…¸€ø€À€ü€ÍÕ•ÍÌœ€è€œœô°(€€€€€ì±…‰•°è€ÕÌ-½ÍÑ•¸Ù•É­»ñÁ™Ðœ°Ù…±Õ”è•ÕÉ¼¡±¥¹­•‘5½¹Ñ¡±åA±…¸¤°­¥¹è±¥¹­•‘5½¹Ñ¡±åA±…¸€ø€À€ü€ÍÕ•ÍÌœ€è€œœô°(€€€€€ì±…‰•°è€¹•ÍÁ…ÉÐ•Í…µÐœ°Ù…±Õ”è•ÕÉ¼¡Ñ½Ñ…±M…Ù•¤°­¥¹èÑ½Ñ…±M…Ù•€ø€À€ü€ÍÕ•ÍÌœ€è€œœô°(€€€€€ì±…‰•°è€i¥•±ÍÕµµ”œ°Ù…±Õ”èÑ½Ñ…±Q…É•Ð€ø€À€ü•ÕÉ¼¡Ñ½Ñ…±Q…É•Ð¤€è€½¡¹”™•ÍÑ”i¥•±”œô°(€€€€€ì±…‰•°è€9½ ½™™•¸œ°Ù…±Õ”èÑ½Ñ…±Q…É•Ð€ø€À€ü•ÕÉ¼¡µ¥ÍÍ¥¹Q½Ñ…°¤€è€ŸŠPœ°­¥¹èµ¥ÍÍ¥¹Q½Ñ…°€ø€À€ü€Ý…É¹¥¹œœ€è€ÍÕ•ÍÌœô(€€€t¤¤ì((€€€¥˜€ …ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì¹±•¹Ñ ¤ì(€€€€€½¹ÍÐ•µÁÑä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€•µÁÑä¹±…ÍÍ9…µ”€ô€•µÁÑäµÍÑ…Ñ”œì(€€€€€•µÁÑä¹¥¹¹•É!Q50€ô€œñÍÑÉ½¹œù9½ ­•¥¹”Kñ­±…•¸µA½ÍÑ•¸¸ð½ÍÑÉ½¹œøñ‰Èù1•”è¸¸ƒŠyÕÑ¿Šp°ƒŠyUÉ±…Õ‹Šp°ƒŠy5…	½½¯Šp½‘•ÈƒŠy-±•¥‘Õ¹ŸŠp…¸Õ¹¡¥¹Ñ•É±•”‰•¤	•‘…É˜•¥¹”™•ÍÑ”5½¹…ÑÍÍÕµµ”¸œì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡•µÁÑä¤ì(€€€€€Í…Ù¥¹ÍM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡…É¤ì(€€€€€Í…Ù¥¹ÍM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡É•…Ñ•A½ÑÍ…É ¤¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍÐÉ¥€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É¥¹±…ÍÍ9…µ”€ô€Í…Ù¥¹Ìµ½…±ÌµÉ¥œì(€€€ÍÑ…Ñ”¹Í…Ù¥¹Í½…±Ì¹™½É…  ¡½…°¤€ôøì(€€€€€½¹ÍÐÁÉ½É•ÍÌ€ô•ÑM…Ù¥¹Í½…±AÉ½É•ÍÌ¡½…°¤ì(€€€€€½¹ÍÐ±¥¹­•‘5½¹Ñ¡±ä€ô•Ñ1¥¹­•‘M…Ù¥¹ÍA±…¹½É½…°¡½…°¹¥°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€½¹ÍÐ‰½à€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€‰½à¹±…ÍÍ9…µ”€ôÍ…Ù¥¹Ìµ½…°µ…É€‘í½…°¹¥ÍÑ¥Ù”€ü€œœ€è€Á…ÕÍ•õ€ì(€€€€€½¹ÍÐÑ½À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€Ñ½À¹±…ÍÍ9…µ”€ô€Í…Ù¥¹Ìµ½…°µ¡•…œì(€€€€€½¹ÍÐÑ¥Ñ±•]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€½¹ÍÐÑ¥Ñ±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Ìœ¤ì(€€€€€Ñ¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ô½…°¹¹…µ”ì(€€€€€½¹ÍÐµ•Ñ„€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€µ•Ñ„¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€€€µ•Ñ„¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘í½…°¹¥ÍÑ¥Ù”€ü€­Ñ¥Øœ€è€A…ÕÍ¥•ÉÐôƒ
ÜMÑ…ÉÐ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡½…°¹ÍÑ…ÉÑ5½¹Ñ ¥ô‘í½…°¹‘Õ•5½¹Ñ €ü€œƒ
Üi¥•±µ½¹…Ð€œ€¬™½Éµ…Ñ5½¹Ñ¡1…‰•°¡½…°¹‘Õ•5½¹Ñ ¤€è€œõ€ì(€€€€€Ñ¥Ñ±•]É…À¹…ÁÁ•¹‘¡¥±¡Ñ¥Ñ±”¤ì(€€€€€Ñ¥Ñ±•]É…À¹…ÁÁ•¹‘¡¥±¡µ•Ñ„¤ì(€€€€€½¹ÍÐ¡¥À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì(€€€€€¡¥À¹±…ÍÍ9…µ”€ôÁ¥±°€‘íÁÉ½É•ÍÌ¹µ¥ÍÍ¥¹œ€ø€À€ü€Ý…É¹¥¹œœ€è€ÍÕ•ÍÌõ€ì(€€€€€¡¥À¹Ñ•áÑ½¹Ñ•¹Ð€ôÁÉ½É•ÍÌ¹Ñ…É•Ð€ø€À€ü€‘íÁÉ½É•ÍÌ¹ÁÐ¹Ñ½¥á• À¥ô€•€€è•ÕÉ¼¡ÁÉ½É•ÍÌ¹‰…±…¹”¤ì(€€€€€Ñ½À¹…ÁÁ•¹‘¡¥±¡Ñ¥Ñ±•]É…À¤ì(€€€€€Ñ½À¹…ÁÁ•¹‘¡¥±¡¡¥À¤ì(€€€€€‰½à¹…ÁÁ•¹‘¡¥±¡Ñ½À¤ì((€€€€€½¹ÍÐ‰…È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€‰…È¹±…ÍÍ9…µ”€ô€½…°µÁÉ½É•ÍÌµ‰…Èœì(€€€€€½¹ÍÐ™¥±°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì(€€€€€™¥±°¹ÍÑå±”¹Ý¥‘Ñ €ô€‘íÁÉ½É•ÍÌ¹Ñ…É•Ð€ø€À€üÁÉ½É•ÍÌ¹ÁÐ€è€ÄÀÁô•€ì(€€€€€‰…È¹…ÁÁ•¹‘¡¥±¡™¥±°¤ì(€€€€€‰½à¹…ÁÁ•¹‘¡¥±¡‰…È¤ì((€€€€€‰½à¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€€€ì±…‰•°è€¹•ÍÁ…ÉÐœ°Ù…±Õ”è•ÕÉ¼¡ÁÉ½É•ÍÌ¹‰…±…¹”¤°­¥¹èÁÉ½É•ÍÌ¹‰…±…¹”€ø€À€ü€ÍÕ•ÍÌœ€è€œœô°(€€€€€€€ì±…‰•°è€i¥•°œ°Ù…±Õ”èÁÉ½É•ÍÌ¹Ñ…É•Ð€ø€À€ü•ÕÉ¼¡ÁÉ½É•ÍÌ¹Ñ…É•Ð¤€è€½™™•¸œô°(€€€€€€€ì±…‰•°è€5½¹…ÑÍÍÕµµ”œ°Ù…±Õ”è½…°¹µ½¹Ñ¡±åµ½Õ¹Ð€ø€À€ü•ÕÉ¼¡½…°¹µ½¹Ñ¡±åµ½Õ¹Ð¤€è€­•¥¹”™•ÍÑ”MÕµµ”œô°(€€€€€€€ì±…‰•°è€Y•É­»ñÁ™Ñ”-½ÍÑ•¸œ°Ù…±Õ”è±¥¹­•‘5½¹Ñ¡±ä€ø€À€ü•ÕÉ¼¡±¥¹­•‘5½¹Ñ¡±ä¤€è€­•¥¹”œô°(€€€€€€€ì±…‰•°è€•¡±Ðœ°Ù…±Õ”èÁÉ½É•ÍÌ¹Ñ…É•Ð€ø€À€ü•ÕÉ¼¡ÁÉ½É•ÍÌ¹µ¥ÍÍ¥¹œ¤€è€ŸŠPœ°­¥¹èÁÉ½É•ÍÌ¹µ¥ÍÍ¥¹œ€ø€À€ü€Ý…É¹¥¹œœ€è€ÍÕ•ÍÌœô(€€€€€t¤¤ì((€€€€€¥˜€¡½…°¹¹½Ñ”¤ì(€€€€€€€½¹ÍÐ¹½Ñ”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€€€€€¹½Ñ”¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€€€€€¹½Ñ”¹Ñ•áÑ½¹Ñ•¹Ð€ô½…°¹¹½Ñ”ì(€€€€€€€‰½à¹…ÁÁ•¹‘¡¥±¡¹½Ñ”¤ì(€€€€€ô((€€€€€½¹ÍÐ…Ñ¥½¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€…Ñ¥½¹Ì¹±…ÍÍ9…µ”€ô€É½ÜÍ…Ù¥¹Ìµ½…°µ…Ñ¥½¹Ìœì(€€€€€½¹ÍÐ‘•Á½Í¥Ñ	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€‘•Á½Í¥Ñ	Ñ¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€€€‘•Á½Í¥Ñ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô½…°¹µ½¹Ñ¡±åµ½Õ¹Ð€ø€À€ü5½¹…ÑÍÍÕµµ”€‘í•ÕÉ¼¡½…°¹µ½¹Ñ¡±åµ½Õ¹Ð¥ô‰Õ¡•¹€€è€¥¹é…¡±Õ¹œ‰Õ¡•¸œì(€€€€€‘•Á½Í¥Ñ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝM…Ù¥¹Í½…±QÉ…¹Í…Ñ¥½¹‘¥Ñ½È¡½…°°€‘•Á½Í¥Ðœ¤¤ì(€€€€€½¹ÍÐÝ¥Ñ¡‘É…Ý	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€Ý¥Ñ¡‘É…Ý	Ñ¸¹±…ÍÍ9…µ”€ô€‘…¹•Èœì(€€€€€Ý¥Ñ¡‘É…Ý	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€¹Ñ¹…¡µ”œì(€€€€€Ý¥Ñ¡‘É…Ý	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝM…Ù¥¹Í½…±QÉ…¹Í…Ñ¥½¹‘¥Ñ½È¡½…°°€Ý¥Ñ¡‘É…Üœ¤¤ì(€€€€€½¹ÍÐ•‘¥Ñ	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€•‘¥Ñ	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€€€•‘¥Ñ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€	•…É‰•¥Ñ•¸œì(€€€€€•‘¥Ñ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝM…Ù¥¹Í½…±‘¥Ñ½È¡½…°¤¤ì(€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡‘•Á½Í¥Ñ	Ñ¸¤ì(€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡Ý¥Ñ¡‘É…Ý	Ñ¸¤ì(€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡•‘¥Ñ	Ñ¸¤ì(€€€€€‰½à¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹Ì¤ì((€€€€€¥˜€¡½…°¹ÑÉ…¹Í…Ñ¥½¹Ì€˜˜½…°¹ÑÉ…¹Í…Ñ¥½¹Ì¹±•¹Ñ ¤ì(€€€€€€€½¹ÍÐ‘•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€€€€€‘•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€½µÁ…Ðµ‘•Ñ…¥±Ìœì(€€€€€€€½¹ÍÐÍÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€€€€€ÍÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ô€	Õ¡Õ¹•¸…¹é•¥•¸œì(€€€€€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡ÍÕµµ…Éä¤ì(€€€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”½µÁ…ÐµÑ…‰±”œì(€€€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ù5½¹…Ðð½Ñ øñÑ ùÉÐð½Ñ øñÑ ù	•ÑÉ…œð½Ñ øñÑ ù9½Ñ¥èð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€€€½…°¹ÑÉ…¹Í…Ñ¥½¹Ì¹Í±¥” ¤¹Í½ÉÐ ¡„°ˆ¤€ôø€¡ˆ¹µ½¹Ñ ñð€œœ¤¹±½…±•½µÁ…É”¡„¹µ½¹Ñ ñð€œœ¤¤¹Í±¥” À°€à¤¹™½É…  ¡Ñà¤€ôøì(€€€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€€€ÑÈ¹¥¹¹•É!Q50€ô€ñÑø‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡Ñà¹µ½¹Ñ ¥ôð½ÑøñÑø‘íÑà¹ÑåÁ”€ôôô€Ý¥Ñ¡‘É…Üœ€ü€¹Ñ¹…¡µ”œ€è€¥¹é…¡±Õ¹œôð½ÑøñÑø‘í•ÕÉ¼¡Ñà¹…µ½Õ¹Ð¥ôð½ÑøñÑø‘íÑà¹¹½Ñ”ñð€œ´ôð½Ñù€ì(€€€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€€€ô¤ì(€€€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€€€€€‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€€€€€‰½à¹…ÁÁ•¹‘¡¥±¡‘•Ñ…¥±Ì¤ì(€€€€€ô((€€€€€É¥¹…ÁÁ•¹‘¡¥±¡‰½à¤ì(€€€ô¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É¥¤ì(€€€Í…Ù¥¹ÍM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡…É¤ì(€€€Í…Ù¥¹ÍM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡É•…Ñ•A½ÑÍ…É ¤¤ì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝA½Ñ‘¥Ñ½È ¤ì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì(€€€½¹ÍÐ¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹…µ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹…µ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸UÉ±…Õˆ½‘•ÈÕÑ¼œì(€€€½¹ÍÐ…µ½Õ¹Ñ%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•± À¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9…µ”‘•ÌQ½Á™Ìœ°¹…µ•%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ MÑ…ÉÑ‰•ÑÉ…œ¥¸ƒŠ
°œ°…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€Í¡½Ý5½‘…° 9•Õ•¸Q½Á˜…¹±••¸œ°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤ô°(€€€€€ì(€€€€€€€±…‰•°è€¹±••¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ¹…µ”€ô¹…µ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€€€€€½¹ÍÐ¥¹¥Ñ¥…°€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ …¹…µ”¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸9…µ•¸›ñÈ‘•¸Q½Á˜•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡¥¹¥Ñ¥…°¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸MÑ…ÉÑ‰•ÑÉ…œ•¥¹•‰•¸¸œ¤ì(€€€€€€€€€½¹ÍÐÁ½Ð€ôì¥è•¹•É…Ñ•% ¤°¹…µ”°‰…±…¹”è¥¹¥Ñ¥…°°ÑÉ…¹Í…Ñ¥½¹Ìèmtôì(€€€€€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹Á½ÑÌ¤¤ÍÑ…Ñ”¹Á½ÑÌ€ômtì(€€€€€€€€€ÍÑ…Ñ”¹Á½ÑÌ¹ÁÕÍ ¡Á½Ð¤ì(€€€€€€€€€Í•±•Ñ•‘A½Ñ%€ôÁ½Ð¹¥ì(€€€€€€€€€…‘‘¡…¹•1½œ SÙÁ™”œ°€‘í¹…µ•ôµ¥Ð€‘í•ÕÉ¼¡¥¹¥Ñ¥…°¥ô…¹•±•Ñ€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝA½ÑQÉ…¹Í…Ñ¥½¹‘¥Ñ½È¡Á½Ð°ÑåÁ”¤ì(€€€¥˜€ …Á½Ð¤É•ÑÕÉ¸ì(€€€½¹ÍÐ¥Í]¥Ñ¡‘É…Ý…°€ôÑåÁ”€ôôô€Ý¥Ñ¡‘É…Üœì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì(€€€½¹ÍÐ¥¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¥¹™¼¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€¥¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘íÁ½Ð¹¹…µ•ôƒ
Ü…­ÑÕ•±±•ÈM…±‘¼€‘í•ÕÉ¼¡Á½Ð¹‰…±…¹”¥õ€ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¥¹™¼¤ì(€€€½¹ÍÐ…µ½Õ¹Ñ%¹ÁÕÐ€ôÉ•…Ñ•5½¹•å¥•± œœ¤ì(€€€½¹ÍÐ‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ¹Á±…•¡½±‘•È€ô¥Í]¥Ñ¡‘É…Ý…°€ü€è¸¸I•Á…É…ÑÕÈœ€è€è¸¸µ½¹…Ñ±¥¡”Kñ­±…”œì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ¡¥Í]¥Ñ¡‘É…Ý…°€ü€ÕÍ…‰”¥¸ƒŠ
°œ€è€¥¹é…¡±Õ¹œ¥¸ƒŠ
°œ°…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•Í¡É•¥‰Õ¹œ€¡½ÁÑ¥½¹…°¤œ°‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ¤¤ì((€€€±•Ð…±±½Ý=Ù•É‘É…™Ñ¡•¬€ô¹Õ±°ì(€€€¥˜€¡¥Í]¥Ñ¡‘É…Ý…°¤ì(€€€€€½¹ÍÐ…±±½Ý=Ù•É‘É…™Ñ1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€€€…±±½Ý=Ù•É‘É…™Ñ1…‰•°¹±…ÍÍ9…µ”€ô€¡•­‰½àµÉ½Üœì(€€€€€…±±½Ý=Ù•É‘É…™Ñ¡•¬€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€€€…±±½Ý=Ù•É‘É…™Ñ¡•¬¹ÑåÁ”€ô€¡•­‰½àœì(€€€€€…±±½Ý=Ù•É‘É…™Ñ1…‰•°¹…ÁÁ•¹‘¡¥±¡…±±½Ý=Ù•É‘É…™Ñ¡•¬¤ì(€€€€€…±±½Ý=Ù•É‘É…™Ñ1…‰•°¹…ÁÁ•¹‘¡¥±¡‘½Õµ•¹Ð¹É•…Ñ•Q•áÑ9½‘” œƒq‰•Éé¥•¡Õ¹œ•É±…Õ‰•¸°™…±±Ì‘¥”ÕÍ…‰”ËÛ}•È…±Ì‘•ÈM…±‘¼¥ÍÐœ¤¤ì(€€€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡…±±½Ý=Ù•É‘É…™Ñ1…‰•°¤ì(€€€ô((€€€Í¡½Ý5½‘…°¡¥Í]¥Ñ¡‘É…Ý…°€üÕÌ€‘íÁ½Ð¹¹…µ•ô…ÕÍ•‰•¹€€è%¸€‘íÁ½Ð¹¹…µ•ô•¥¹é…¡±•¹€°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤ô°(€€€€€ì(€€€€€€€±…‰•°è¥Í]¥Ñ¡‘É…Ý…°€ü€ÕÍ…‰”‰Õ¡•¸œ€è€¥¹é…¡±Õ¹œ‰Õ¡•¸œ°(€€€€€€€±…ÍÍ9…µ”è¥Í]¥Ñ¡‘É…Ý…°€ü€‘…¹•Èœ€è€ÍÕ•ÍÌœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ðô€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Á½Í¥Ñ¥Ù•¸	•ÑÉ…œ•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥˜€¡¥Í]¥Ñ¡‘É…Ý…°€˜˜…µ½Õ¹Ð€ø9Õµ‰•È¡Á½Ð¹‰…±…¹”ñð€À¤€˜˜€……±±½Ý=Ù•É‘É…™Ñ¡•¬¹¡•­•¤ì(€€€€€€€€€€€É•ÑÕÉ¸…±•ÉÐ •È	•ÑÉ…œ¥ÍÐËÛ}•È…±Ì‘•ÈM…±‘¼¸­Ñ¥Ù¥•É”ƒŠ{q‰•Éé¥•¡Õ¹œ•É±…Õ‰•»Šp°Ý•¹¸‘ÔÑÉ½Ñé‘•´™½ÉÑ™…¡É•¸·Ù¡Ñ•ÍÐ¸œ¤ì(€€€€€€€€€ô(€€€€€€€€€½¹ÍÐÍ¥¹•‘µ½Õ¹Ð€ô¥Í]¥Ñ¡‘É…Ý…°€ü€µ…µ½Õ¹Ð€è…µ½Õ¹Ðì(€€€€€€€€€Á½Ð¹‰…±…¹”€ô9Õµ‰•È¡Á½Ð¹‰…±…¹”ñð€À¤€¬Í¥¹•‘µ½Õ¹Ðì(€€€€€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡Á½Ð¹ÑÉ…¹Í…Ñ¥½¹Ì¤¤Á½Ð¹ÑÉ…¹Í…Ñ¥½¹Ì€ômtì(€€€€€€€€€Á½Ð¹ÑÉ…¹Í…Ñ¥½¹Ì¹ÁÕÍ ¡ì(€€€€€€€€€€€‘…Ñ”èÕÉÉ•¹Ñ5½¹Ñ °(€€€€€€€€€€€ÑåÁ”è¥Í]¥Ñ¡‘É…Ý…°€ü€Ý¥Ñ¡‘É…Üœ€è€‘•Á½Í¥Ðœ°(€€€€€€€€€€€…µ½Õ¹ÐèÍ¥¹•‘µ½Õ¹Ð°(€€€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è‘•ÍÉ¥ÁÑ¥½¹%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤(€€€€€€€€€ô¤ì(€€€€€€€€€…‘‘¡…¹•1½œ SÙÁ™”œ°€‘íÁ½Ð¹¹…µ•ôè€‘í¥Í]¥Ñ¡‘É…Ý…°€ü€ÕÍ…‰”œ€è€¥¹é…¡±Õ¹œô€‘í•ÕÉ¼¡…µ½Õ¹Ð¥ô•‰Õ¡Ñ€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€€¼¼ÉÍÑ•±±Ð‘¥”Q½Á˜µY•ÉÝ…±ÑÕ¹œ¸M¥”Ý¥É¥´•µ•¥¹Í…µ•¸Kñ­±…•¸µ	•É•¥ (€€¼¼•¥¹•‰•ÑÑ•Ðì‘¥”…±Ñ”¥¹é•±Í•¥Ñ”‰±•¥‰Ð¹ÕÈ…±ÌÍ¥¡•É”Kñ­™…±±É½ÕÑ”¸(€€)™Õ¹Ñ¥½¸É•…Ñ•A½ÑÍ…É ¤ì(€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€…Éœì((€€€½¹ÍÐÑ¥Ñ±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Ìœ¤ì(€€€Ñ¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ô€SÙÁ™”Ù•ÉÝ…±Ñ•¸œì(€€€…É¹…ÁÁ•¹‘¡¥±¡Ñ¥Ñ±”¤ì(€€€½¹ÍÐ¥¹ÑÉ¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¥¹ÑÉ¼¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€¥¹ÑÉ¼¹Ñ•áÑ½¹Ñ•¹Ð€ô€!¥•ÈÍ¥•¡ÍÐ‘Ô‘¥”Ù½É¡…¹‘•¹•¸ÕÑ¡…‰•¸Õ¹‰Õ¡ÍÐ¥¹é…¡±Õ¹•¸½‘•ÈÕÍ…‰•¸¸	•ÑË‘”¯Ù¹¹•¸µ¥Ð-½µµ„½‘•ÈAÕ¹­Ð•¥¹••‰•¸Ý•É‘•¸¸œì(€€€…É¹…ÁÁ•¹‘¡¥±¡¥¹ÑÉ¼¤ì((€€€½¹ÍÐ¡•…‘•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•…‘•È¹±…ÍÍ9…µ”€ô€É½Üœì((€€€½¹ÍÐÁ½ÑM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€Á½ÑM•±•Ð¹Í•ÑÑÑÉ¥‰ÕÑ” …É¥„µ±…‰•°œ°€Q½Á˜…ÕÍß‘¡±•¸œ¤ì(€€€½¹ÍÐ…±±=ÁÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€…±±=ÁÐ¹Ù…±Õ”€ô€œœì(€€€…±±=ÁÐ¹Ñ•áÑ½¹Ñ•¹Ð€ô€±±”SÙÁ™”œì(€€€Á½ÑM•±•Ð¹…ÁÁ•¹‘¡¥±¡…±±=ÁÐ¤ì(€€€¥˜€ …ÍÑ…Ñ”¹Á½ÑÌ¤ÍÑ…Ñ”¹Á½ÑÌ€ômtì(€€€ÍÑ…Ñ”¹Á½ÑÌ¹™½É…  ¡Á½Ð¤€ôøì(€€€€€½¹ÍÐ½ÁÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€½ÁÐ¹Ù…±Õ”€ôÁ½Ð¹¥ì(€€€€€½ÁÐ¹Ñ•áÑ½¹Ñ•¹Ð€ôÁ½Ð¹¹…µ”ì(€€€€€¥˜€¡Á½Ð¹¥€ôôôÍ•±•Ñ•‘A½Ñ%¤½ÁÐ¹Í•±•Ñ•€ôÑÉÕ”ì(€€€€€Á½ÑM•±•Ð¹…ÁÁ•¹‘¡¥±¡½ÁÐ¤ì(€€€ô¤ì(€€€Á½ÑM•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€¡”¤€ôøì(€€€€€Í•±•Ñ•‘A½Ñ%€ô”¹Ñ…É•Ð¹Ù…±Õ”ñð€œœì(€€€€€É•¹‘•È ¤ì(€€€ô¤ì((€€€½¹ÍÐ…‘‘	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€…‘‘	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€…‘‘	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ¬9•Õ•ÈQ½Á˜œì(€€€…‘‘	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€…‘‘	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°Í¡½ÝA½Ñ‘¥Ñ½È¤ì((€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡Á½ÑM•±•Ð¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡…‘‘	Ñ¸¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡¡•…‘•È¤ì((€€€±•ÐÑ½Ñ…±5…¹Õ…°€ô€Àì(€€€±•ÐÑ½Ñ…±I•Í•ÉÙ•A±…¸€ô€Àì(€€€±•Ðµ½¹Ñ¡•Á½Í¥ÑÌ€ô€Àì(€€€±•Ðµ½¹Ñ¡]¥Ñ¡‘É…Ý…±Ì€ô€Àì(€€€ÍÑ…Ñ”¹Á½ÑÌ¹™½É…  ¡À¤€ôøì(€€€€€Ñ½Ñ…±5…¹Õ…°€¬ô9Õµ‰•È¡À¹‰…±…¹”ñð€À¤ì(€€€€€µ½¹Ñ¡1¥ÍÐ¹™½É…  ¡´¤€ôøì(€€€€€€€Ñ½Ñ…±I•Í•ÉÙ•A±…¸€¬ôÀ¹¹…µ”€ôôô€MÁ…É•¸œ€ü•ÑM…Ù¥¹Í½¹ÑÉ¥‰ÕÑ¥½¸¡´¹­•ä¤€è•ÑI•Í•ÉÙ•½¹ÑÉ¥‰ÕÑ¥½¹½ÉA½Ð¡À¹¹…µ”°´¹­•ä¤ì(€€€€€ô¤ì(€€€€€€¡À¹ÑÉ…¹Í…Ñ¥½¹Ìñðmt¤¹™½É…  ¡Ð¤€ôøì(€€€€€€€¥˜€¡Ð¹‘…Ñ”€ôôôÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€¥˜€¡9Õµ‰•È¡Ð¹…µ½Õ¹Ðñð€À¤€øô€À¤µ½¹Ñ¡•Á½Í¥ÑÌ€¬ô9Õµ‰•È¡Ð¹…µ½Õ¹Ðñð€À¤ì(€€€€€€€€€¥˜€¡9Õµ‰•È¡Ð¹…µ½Õ¹Ðñð€À¤€ð€À¤µ½¹Ñ¡]¥Ñ¡‘É…Ý…±Ì€¬ô5…Ñ ¹…‰Ì¡9Õµ‰•È¡Ð¹…µ½Õ¹Ðñð€À¤¤ì(€€€€€€€ô(€€€€€ô¤ì(€€€ô¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€•Í…µÐ¥¸SÙÁ™•¸œ°Ù…±Õ”è€‘í•ÕÉ¼¡Ñ½Ñ…±5…¹Õ…°¥õ€°­¥¹èÑ½Ñ…±5…¹Õ…°€ø€À€ü€ÍÕ•ÍÌœ€è€œœô°(€€€€€ì±…‰•°è€A±…¸€ÄÈ5½¹…Ñ”œ°Ù…±Õ”è€‘í•ÕÉ¼¡Ñ½Ñ…±I•Í•ÉÙ•A±…¸¥õ€ô°(€€€€€ì±…‰•°è¥¹é…¡±Õ¹•¸€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€°Ù…±Õ”è€‘í•ÕÉ¼¡µ½¹Ñ¡•Á½Í¥ÑÌ¥õ€°­¥¹èµ½¹Ñ¡•Á½Í¥ÑÌ€ø€À€ü€ÍÕ•ÍÌœ€è€œœô°(€€€€€ì±…‰•°èÕÍ…‰•¸€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€°Ù…±Õ”è€‘í•ÕÉ¼¡µ½¹Ñ¡]¥Ñ¡‘É…Ý…±Ì¥õ€°­¥¹èµ½¹Ñ¡]¥Ñ¡‘É…Ý…±Ì€ø€À€ü€Ý…É¹¥¹œœ€è€œœô°(€€€€€ì±…‰•°è€¹é…¡°SÙÁ™”œ°Ù…±Õ”èMÑÉ¥¹œ¡ÍÑ…Ñ”¹Á½ÑÌ¹±•¹Ñ ¤ô(€€€t¤¤ì(((€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”œì(€€€½¹ÍÐÑ¡•…€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ¡•…œ¤ì(€€€Ñ¡•…¹¥¹¹•É!Q50€ô€œñÑÈøñÑ ù9…µ”ð½Ñ øñÑ ùM…±‘¼ð½Ñ øñÑ ùA±…¸€ ÄÈ5½¹…Ñ”¤ð½Ñ øñÑ ù­Ñ¥½¸ð½Ñ øð½ÑÈøœì(€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ¡•…¤ì(€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì((€€€ÍÑ…Ñ”¹Á½ÑÌ¹™½É…  ¡Á½Ð¤€ôøì(€€€€€¥˜€ …Á½Ð¹ÑÉ…¹Í…Ñ¥½¹Ì¤Á½Ð¹ÑÉ…¹Í…Ñ¥½¹Ì€ômtì(€€€€€¥˜€¡ÑåÁ•½˜Á½Ð¹‰…±…¹”€„ôô€¹Õµ‰•Èœ¤Á½Ð¹‰…±…¹”€ô9Õµ‰•È¡Á½Ð¹‰…±…¹”ñð€À¤ì(€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€±•Ð…ÕÑ½MÕ´€ô€Àì(€€€€€µ½¹Ñ¡1¥ÍÐ¹™½É…  ¡´¤€ôøì(€€€€€€€…ÕÑ½MÕ´€¬ôÁ½Ð¹¹…µ”€ôôô€MÁ…É•¸œ€ü•ÑM…Ù¥¹Í½¹ÑÉ¥‰ÕÑ¥½¸¡´¹­•ä¤€è•ÑI•Í•ÉÙ•½¹ÑÉ¥‰ÕÑ¥½¹½ÉA½Ð¡Á½Ð¹¹…µ”°´¹­•ä¤ì(€€€€€ô¤ì((€€€€€ÑÈ¹¥¹¹•É!Q50€ô€ñÑø‘íÁ½Ð¹¹…µ•ôð½ÑøñÑø‘í•ÕÉ¼¡Á½Ð¹‰…±…¹”¥ôð½ÑøñÑø‘í•ÕÉ¼¡…ÕÑ½MÕ´¥ôð½ÑøñÑøð½Ñù€ì(€€€€€½¹ÍÐ…Ð€ôÑÈ¹¡¥±‘É•¹lÍtì((€€€€€…Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•Ñ¥½¹5•¹Ô¡l(€€€€€€€ì±…‰•°è€¥¹é…¡±•¸œ°±…ÍÍ9…µ”è€ÍÕ•ÍÌœ°½¹±¥¬è€ ¤€ôøÍ¡½ÝA½ÑQÉ…¹Í…Ñ¥½¹‘¥Ñ½È¡Á½Ð°€‘•Á½Í¥Ðœ¤ô°(€€€€€€€ì±…‰•°è€ÕÍ•‰•¸œ°±…ÍÍ9…µ”è€‘…¹•Èœ°½¹±¥¬è€ ¤€ôøÍ¡½ÝA½ÑQÉ…¹Í…Ñ¥½¹‘¥Ñ½È¡Á½Ð°€Ý¥Ñ¡‘É…Üœ¤ô(€€€€€t¤¤ì(€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€ô¤ì((€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì((€€€¥˜€¡Í•±•Ñ•‘A½Ñ%¤ì(€€€€€½¹ÍÐÁ½Ð€ôÍÑ…Ñ”¹Á½ÑÌ¹™¥¹ ¡À¤€ôøÀ¹¥€ôôôÍ•±•Ñ•‘A½Ñ%¤ì(€€€€€¥˜€¡Á½Ð¤ì(€€€€€€€½¹ÍÐ‘•Ñ…¥±…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€€€‘•Ñ…¥±…É¹±…ÍÍ9…µ”€ô€…Éœì(€€€€€€€½¹ÍÐ‘•Ñ…¥±Q¥Ñ±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Ìœ¤ì(€€€€€€€‘•Ñ…¥±Q¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ô•Ñ…¥±Ì›ñÈ€‘íÁ½Ð¹¹…µ•õ€ì(€€€€€€€‘•Ñ…¥±…É¹…ÁÁ•¹‘¡¥±¡‘•Ñ…¥±Q¥Ñ±”¤ì((€€€€€€€½¹ÍÐ‘•ÑQ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€€€‘•ÑQ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”œì(€€€€€€€½¹ÍÐ‘!•…€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ¡•…œ¤ì(€€€€€€€‘!•…¹¥¹¹•É!Q50€ô€œñÑÈøñÑ ù5½¹…Ðð½Ñ øñÑ ùA±…¸ð½Ñ øñÑ ù¥¹é…¡±Õ¹•¸ð½Ñ øñÑ ùÕÍé…¡±Õ¹•¸ð½Ñ øð½ÑÈøœì(€€€€€€€‘•ÑQ…‰±”¹…ÁÁ•¹‘¡¥±¡‘!•…¤ì(€€€€€€€½¹ÍÐ‘	½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì((€€€€€€€µ½¹Ñ¡1¥ÍÐ¹™½É…  ¡´¤€ôøì(€€€€€€€€€½¹ÍÐ…ÕÑ½Y…°€ôÁ½Ð¹¹…µ”€ôôô€MÁ…É•¸œ€ü•ÑM…Ù¥¹Í½¹ÑÉ¥‰ÕÑ¥½¸¡´¹­•ä¤€è•ÑI•Í•ÉÙ•½¹ÑÉ¥‰ÕÑ¥½¹½ÉA½Ð¡Á½Ð¹¹…µ”°´¹­•ä¤ì(€€€€€€€€€±•Ð‘•À€ô€Àì(€€€€€€€€€±•ÐÝ¥Ð€ô€Àì(€€€€€€€€€€¡Á½Ð¹ÑÉ…¹Í…Ñ¥½¹Ìñðmt¤¹™½É…  ¡Ð¤€ôøì(€€€€€€€€€€€¥˜€¡Ð¹‘…Ñ”€ôôô´¹­•ä¤ì(€€€€€€€€€€€€€¥˜€¡9Õµ‰•È¡Ð¹…µ½Õ¹Ð¤€øô€À¤‘•À€¬ô9Õµ‰•È¡Ð¹…µ½Õ¹Ðñð€À¤ì(€€€€€€€€€€€€€¥˜€¡9Õµ‰•È¡Ð¹…µ½Õ¹Ð¤€ð€À¤Ý¥Ð€¬ô5…Ñ ¹…‰Ì¡9Õµ‰•È¡Ð¹…µ½Õ¹Ðñð€À¤¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô¤ì(€€€€€€€€€½¹ÍÐ‘I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€€€‘I½Ü¹¥¹¹•É!Q50€ô€ñÑø‘í´¹±…‰•±ôð½ÑøñÑø‘í•ÕÉ¼¡…ÕÑ½Y…°¥ôð½ÑøñÑø‘í•ÕÉ¼¡‘•À¥ôð½ÑøñÑø‘í•ÕÉ¼¡Ý¥Ð¥ôð½Ñù€ì(€€€€€€€€€‘	½‘ä¹…ÁÁ•¹‘¡¥±¡‘I½Ü¤ì(€€€€€€€ô¤ì((€€€€€€€‘•ÑQ…‰±”¹…ÁÁ•¹‘¡¥±¡‘	½‘ä¤ì(€€€€€€€‘•Ñ…¥±…É¹…ÁÁ•¹‘¡¥±¡‘•ÑQ…‰±”¤ì((€€€€€€€±•ÐÍÕµÕÑ¼€ô€Àì(€€€€€€€µ½¹Ñ¡1¥ÍÐ¹™½É…  ¡´¤€ôøì(€€€€€€€€€ÍÕµÕÑ¼€¬ôÁ½Ð¹¹…µ”€ôôô€MÁ…É•¸œ€ü•ÑM…Ù¥¹Í½¹ÑÉ¥‰ÕÑ¥½¸¡´¹­•ä¤€è•ÑI•Í•ÉÙ•½¹ÑÉ¥‰ÕÑ¥½¹½ÉA½Ð¡Á½Ð¹¹…µ”°´¹­•ä¤ì(€€€€€€€ô¤ì(€€€€€€€½¹ÍÐÍÕµµ…Éå•Ñ…¥°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€€€€€ÍÕµµ…Éå•Ñ…¥°¹¥¹¹•É!Q50€ô€ñÍÑÉ½¹œùA±…¸µ•Í…µÐ›ñÈ€ÄÈ5½¹…Ñ”èð½ÍÑÉ½¹œø€‘í•ÕÉ¼¡ÍÕµÕÑ¼¥õ€ì(€€€€€€€‘•Ñ…¥±…É¹…ÁÁ•¹‘¡¥±¡ÍÕµµ…Éå•Ñ…¥°¤ì(€€€€€€€…É¹…ÁÁ•¹‘¡¥±¡‘•Ñ…¥±…É¤ì(€€€€€ô(€€€ô((€€€É•ÑÕÉ¸…Éì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉA½ÑÌ ¤ì(€€€Á½ÑÍM•Ñ¥½¸¹¥¹¹•É!Q50€ô€œœì(€€€Á½ÑÍM•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡É•…Ñ•A½ÑÍ…É ¤¤ì(€ô(€€¼¼I•¹‘•ÉÐ‘•¸M¥¡•ÉÕ¹Í‰•É•¥ ((€™Õ¹Ñ¥½¸½Á•¹ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁˆ ¤ì(€€€¥˜€ „ ¥¹‘•á•‘œ¥¸Ý¥¹‘½Ü¤¤É•ÑÕÉ¸AÉ½µ¥Í”¹É•Í½±Ù”¡¹Õ±°¤ì(€€€¥˜€¡…ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁ‰AÉ½µ¥Í”¤É•ÑÕÉ¸…ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁ‰AÉ½µ¥Í”ì(€€€…ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁ‰AÉ½µ¥Í”€ô¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”°É•©•Ð¤€ôøì(€€€€€½¹ÍÐÉ•ÅÕ•ÍÐ€ô¥¹‘•á•‘¹½Á•¸¡UQ=5Q%}	I=]MI}	-UA}	}95°€Ä¤ì(€€€€€É•ÅÕ•ÍÐ¹½¹ÕÁÉ…‘•¹••‘•€ô€ ¤€ôøì(€€€€€€€½¹ÍÐ‘ˆ€ôÉ•ÅÕ•ÍÐ¹É•ÍÕ±Ðì(€€€€€€€¥˜€ …‘ˆ¹½‰©•ÑMÑ½É•9…µ•Ì¹½¹Ñ…¥¹Ì¡UQ=5Q%}	I=]MI}	-UA}MQ=I}95¤¤ì(€€€€€€€€€‘ˆ¹É•…Ñ•=‰©•ÑMÑ½É”¡UQ=5Q%}	I=]MI}	-UA}MQ=I}95°ì­•åA…Ñ è€¥œô¤ì(€€€€€€€ô(€€€€€ôì(€€€€€É•ÅÕ•ÍÐ¹½¹ÍÕ•ÍÌ€ô€ ¤€ôøÉ•Í½±Ù”¡É•ÅÕ•ÍÐ¹É•ÍÕ±Ð¤ì(€€€€€É•ÅÕ•ÍÐ¹½¹•ÉÉ½È€ô€ ¤€ôøÉ•©•Ð¡É•ÅÕ•ÍÐ¹•ÉÉ½Èñð¹•ÜÉÉ½È ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹•¸­½¹¹Ñ•¸¹¥¡Ð—Ù™™¹•ÐÝ•É‘•¸¸œ¤¤ì(€€€ô¤ì(€€€É•ÑÕÉ¸…ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁ‰AÉ½µ¥Í”ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸±¥ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÌ ¤ì(€€€½¹ÍÐ‘ˆ€ô…Ý…¥Ð½Á•¹ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁˆ ¤ì(€€€¥˜€ …‘ˆ¤É•ÑÕÉ¸mtì(€€€É•ÑÕÉ¸¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”°É•©•Ð¤€ôøì(€€€€€½¹ÍÐÑà€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡UQ=5Q%}	I=]MI}	-UA}MQ=I}95°€É•…‘½¹±äœ¤ì(€€€€€½¹ÍÐÉ•ÅÕ•ÍÐ€ôÑà¹½‰©•ÑMÑ½É”¡UQ=5Q%}	I=]MI}	-UA}MQ=I}95¤¹•Ñ±° ¤ì(€€€€€É•ÅÕ•ÍÐ¹½¹ÍÕ•ÍÌ€ô€ ¤€ôøì(€€€€€€€½¹ÍÐÉ½ÝÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡É•ÅÕ•ÍÐ¹É•ÍÕ±Ð¤€üÉ•ÅÕ•ÍÐ¹É•ÍÕ±Ð€èmtì(€€€€€€€É½ÝÌ¹Í½ÉÐ ¡„°ˆ¤€ôøMÑÉ¥¹œ¡ˆ¹É•…Ñ•‘Ðñð€œœ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡„¹É•…Ñ•‘Ðñð€œœ¤¤¤ì(€€€€€€€É•Í½±Ù”¡É½ÝÌ¤ì(€€€€€ôì(€€€€€É•ÅÕ•ÍÐ¹½¹•ÉÉ½È€ô€ ¤€ôøÉ•©•Ð¡É•ÅÕ•ÍÐ¹•ÉÉ½Èñð¹•ÜÉÉ½È ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹•¸­½¹¹Ñ•¸¹¥¡Ð•±•Í•¸Ý•É‘•¸¸œ¤¤ì(€€€ô¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸ÁÕÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÀ¡É•½É¤ì(€€€½¹ÍÐ‘ˆ€ô…Ý…¥Ð½Á•¹ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁˆ ¤ì(€€€¥˜€ …‘ˆ¤Ñ¡É½Ü¹•ÜÉÉ½È •È	É½ÝÍ•ÈµMÁ•¥¡•È›ñÈ…ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹•¸¥ÍÐ¹¥¡ÐÙ•É›ñ‰…È¸œ¤ì(€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”°É•©•Ð¤€ôøì(€€€€€½¹ÍÐÑà€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡UQ=5Q%}	I=]MI}	-UA}MQ=I}95°€É•…‘ÝÉ¥Ñ”œ¤ì(€€€€€Ñà¹½‰©•ÑMÑ½É”¡UQ=5Q%}	I=]MI}	-UA}MQ=I}95¤¹ÁÕÐ¡É•½É¤ì(€€€€€Ñà¹½¹½µÁ±•Ñ”€ô€ ¤€ôøÉ•Í½±Ù”¡ÑÉÕ”¤ì(€€€€€Ñà¹½¹•ÉÉ½È€ô€ ¤€ôøÉ•©•Ð¡Ñà¹•ÉÉ½Èñð¹•ÜÉÉ½È ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹œ­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤¤ì(€€€ô¤ì((€€€½¹ÍÐ…±°€ô…Ý…¥Ð±¥ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÌ ¤ì(€€€½¹ÍÐ•áÁ¥É•€ô…±°¹Í±¥”¡UQ=5Q%}	I=]MI}	-UA}IQ9Q%=8¤ì(€€€¥˜€ …•áÁ¥É•¹±•¹Ñ ¤É•ÑÕÉ¸ì(€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”°É•©•Ð¤€ôøì(€€€€€½¹ÍÐÑà€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡UQ=5Q%}	I=]MI}	-UA}MQ=I}95°€É•…‘ÝÉ¥Ñ”œ¤ì(€€€€€½¹ÍÐÍÑ½É”€ôÑà¹½‰©•ÑMÑ½É”¡UQ=5Q%}	I=]MI}	-UA}MQ=I}95¤ì(€€€€€•áÁ¥É•¹™½É…  ¡•¹ÑÉä¤€ôøÍÑ½É”¹‘•±•Ñ”¡•¹ÑÉä¹¥¤¤ì(€€€€€Ñà¹½¹½µÁ±•Ñ”€ô€ ¤€ôøÉ•Í½±Ù”¡ÑÉÕ”¤ì(€€€€€Ñà¹½¹•ÉÉ½È€ô€ ¤€ôøÉ•©•Ð¡Ñà¹•ÉÉ½Èñð¹•ÜÉÉ½È ±Ñ”…ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹•¸­½¹¹Ñ•¸¹¥¡Ð…Õ™•Ë‘ÕµÐÝ•É‘•¸¸œ¤¤ì(€€€ô¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸É•…Ñ•ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÀ¡½ÁÑ¥½¹Ì€ôíô¤ì(€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€¥˜€ „ ¥¹‘•á•‘œ¥¸Ý¥¹‘½Ü¤¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ…ÑÕÌè€Õ¹ÍÕÁÁ½ÉÑ•œôì(€€€½¹ÍÐÁÉ•Ù¥½ÕÍQ¥µ•ÍÑ…µÀ€ôÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐñð€œœì(€€€½¹ÍÐÁÉ•Ù¥½ÕÍ…Ñ”€ôÁÉ•Ù¥½ÕÍQ¥µ•ÍÑ…µÀ€ü¹•Ü…Ñ”¡ÁÉ•Ù¥½ÕÍQ¥µ•ÍÑ…µÀ¤€è¹Õ±°ì(€€€½¹ÍÐÁÉ•Ù¥½ÕÍ”€ôÁÉ•Ù¥½ÕÍ…Ñ”€˜˜€…9Õµ‰•È¹¥Í9…8¡ÁÉ•Ù¥½ÕÍ…Ñ”¹•ÑQ¥µ” ¤¤(€€€€€€ü…Ñ”¹¹½Ü ¤€´ÁÉ•Ù¥½ÕÍ…Ñ”¹•ÑQ¥µ” ¤(€€€€€€è9Õµ‰•È¹A=M%Q%Y}%9%9%Qdì(€€€¥˜€ …½ÁÑ¥½¹Ì¹™½É”€˜˜ÁÉ•Ù¥½ÕÍ”€ðUQ=5Q%}	I=]MI}	-UA}%9QIY1}5L¤ì(€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°ÍÑ…ÑÕÌè€™É•Í œ°Ñ¥µ•ÍÑ…µÀèÁÉ•Ù¥½ÕÍQ¥µ•ÍÑ…µÀ°Í­¥ÁÁ•èÑÉÕ”ôì(€€€ô((€€€½¹ÍÐÑ¥µ•ÍÑ…µÀ€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐ€ôÑ¥µ•ÍÑ…µÀì(€€€½¹ÍÐÁ…å±½…€ô)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¤ì(€€€½¹ÍÐÉ•½É€ôì(€€€€€¥è½ÁÑ¥½¹Ì¹¥ñð‘…¥±ä´‘íÑ¥µ•ÍÑ…µÀ¹Í±¥” À°€ÄÀ¥õ€°(€€€€€É•…Ñ•‘ÐèÑ¥µ•ÍÑ…µÀ°(€€€€€µ½¹Ñ èÕÉÉ•¹Ñ5½¹Ñ °(€€€€€±…‰•°è½ÁÑ¥½¹Ì¹±…‰•°ñð€S‘±¥¡”M¥¡•ÉÕ¹œœ°(€€€€€Á…å±½…(€€€ôì(€€€ÑÉäì(€€€€€…Ý…¥ÐÁÕÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÀ¡É•½É¤ì(€€€€€ÝÉ¥Ñ•MÑ…Ñ•A…å±½…‘Q½MÑ½É…”¡Á…å±½…¤ì(€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°ÍÑ…ÑÕÌè€Í…Ù•œ°Ñ¥µ•ÍÑ…µÀ°É•½Éôì(€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐ€ôÁÉ•Ù¥½ÕÍQ¥µ•ÍÑ…µÀì(€€€€€Ñ¡É½Ü•ÉÈì(€€€ô(€ô((€™Õ¹Ñ¥½¸ÅÕ•Õ•ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÀ¡½ÁÑ¥½¹Ì€ôíô¤ì(€€€¥˜€ ……ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁ%¹¥Ñ¥…±¥é•ñð…ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁEÕ•Õ•ñð€„ ¥¹‘•á•‘œ¥¸Ý¥¹‘½Ü¤¤É•ÑÕÉ¸ì(€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€½¹ÍÐ±…ÍÐ€ôÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐ€ü¹•Ü…Ñ”¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐ¤€è¹Õ±°ì(€€€¥˜€ …½ÁÑ¥½¹Ì¹™½É”€˜˜±…ÍÐ€˜˜€…9Õµ‰•È¹¥Í9…8¡±…ÍÐ¹•ÑQ¥µ” ¤¤€˜˜…Ñ”¹¹½Ü ¤€´±…ÍÐ¹•ÑQ¥µ” ¤€ðUQ=5Q%}	I=]MI}	-UA}%9QIY1}5L¤É•ÑÕÉ¸ì(€€€…ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁEÕ•Õ•€ôÑÉÕ”ì(€€€Í•ÑQ¥µ•½ÕÐ¡…Íå¹Œ€ ¤€ôøì(€€€€€ÑÉäì(€€€€€€€…Ý…¥ÐÉ•…Ñ•ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÀ¡ì™½É”è½ÁÑ¥½¹Ì¹™½É”€ôôôÑÉÕ”ô¤ì(€€€€€€€¥˜€¡ÕÉÉ•¹ÑM•Ñ¥½¸€ôôô€½Ù•ÉÙ¥•ÜœñðÕÉÉ•¹ÑM•Ñ¥½¸€ôôô€µ½¹Ñ¡ÍÑ…ÉÐœ¤É•¹‘•È ¤ì(€€€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€€€½¹Í½±”¹Ý…É¸ ÕÑ½µ…Ñ¥Í¡”	É½ÝÍ•ÈµM¥¡•ÉÕ¹œ­½¹¹Ñ”¹¥¡Ð…­ÑÕ…±¥Í¥•ÉÐÝ•É‘•¸œ°•ÉÈ¤ì(€€€€€ô™¥¹…±±äì(€€€€€€€…ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁEÕ•Õ•€ô™…±Í”ì(€€€€€ô(€€€ô°€ÌÔÀ¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸É•½¹¥±•ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÌ ¤ì(€€€¥˜€ „ ¥¹‘•á•‘œ¥¸Ý¥¹‘½Ü¤¤É•ÑÕÉ¸™…±Í”ì(€€€ÑÉäì(€€€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€€€½¹ÍÐ‰…­ÕÁÌ€ô…Ý…¥Ð±¥ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÌ ¤ì(€€€€€¥˜€ …‰…­ÕÁÌ¹±•¹Ñ ¤ì(€€€€€€€…Ý…¥ÐÉ•…Ñ•ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÀ¡ì™½É”èÑÉÕ”ô¤ì(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€€€ô(€€€€€½¹ÍÐ±…Ñ•ÍÑQ¥µ•ÍÑ…µÀ€ôMÑÉ¥¹œ¡‰…­ÕÁÍlÁt¹É•…Ñ•‘Ðñð€œœ¤ì(€€€€€¥˜€¡±…Ñ•ÍÑQ¥µ•ÍÑ…µÀ€˜˜ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐ€„ôô±…Ñ•ÍÑQ¥µ•ÍÑ…µÀ¤ì(€€€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐ€ô±…Ñ•ÍÑQ¥µ•ÍÑ…µÀì(€€€€€€€ÝÉ¥Ñ•MÑ…Ñ•A…å±½…‘Q½MÑ½É…”¡)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¤¤ì(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€€€ô(€€€€€ÅÕ•Õ•ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÀ ¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€½¹Í½±”¹Ý…É¸ MÑ…ÑÕÌ‘•È…ÕÑ½µ…Ñ¥Í¡•¸	É½ÝÍ•ÈµM¥¡•ÉÕ¹œ­½¹¹Ñ”¹¥¡Ð•ÁËñ™ÐÝ•É‘•¸œ°•ÉÈ¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô(€ô((€½¹ÍÐaQI91}	-UA}	}95€ô€¡…ÕÍ¡…±ÑÍÁ±…¹•ÉáÑ•É¹…±	…­ÕÀœì(€½¹ÍÐaQI91}	-UA}MQ=I}95€ô€¡…¹‘±•Ìœì(€½¹ÍÐaQI91}	-UA}!91}-d€ô€‰…­ÕÁ¥É•Ñ½Éäœì(€½¹ÍÐaQI91}	-UA}%195€ô€¡…ÕÍ¡…±ÑÍÁ±…¹•Èµ…ÕÑ¼µ‰…­ÕÀ¹©Í½¸œì(€½¹ÍÐaQI91}	-UA}%9QIY1}5L€ô€ÈÐ€¨€ØÀ€¨€ØÀ€¨€ÄÀÀÀì(€±•Ð•áÑ•É¹…±	…­ÕÁ‰AÉ½µ¥Í”€ô¹Õ±°ì(€±•Ð…¡•‘áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±”€ô¹Õ±°ì(€±•Ð•áÑ•É¹…±	…­ÕÁEÕ•Õ•€ô™…±Í”ì((€™Õ¹Ñ¥½¸½Á•¹áÑ•É¹…±	…­ÕÁˆ ¤ì(€€€¥˜€ „ ¥¹‘•á•‘œ¥¸Ý¥¹‘½Ü¤¤É•ÑÕÉ¸AÉ½µ¥Í”¹É•Í½±Ù”¡¹Õ±°¤ì(€€€¥˜€¡•áÑ•É¹…±	…­ÕÁ‰AÉ½µ¥Í”¤É•ÑÕÉ¸•áÑ•É¹…±	…­ÕÁ‰AÉ½µ¥Í”ì(€€€•áÑ•É¹…±	…­ÕÁ‰AÉ½µ¥Í”€ô¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”°É•©•Ð¤€ôøì(€€€€€½¹ÍÐÉ•ÅÕ•ÍÐ€ô¥¹‘•á•‘¹½Á•¸¡aQI91}	-UA}	}95°€Ä¤ì(€€€€€É•ÅÕ•ÍÐ¹½¹ÕÁÉ…‘•¹••‘•€ô€ ¤€ôøì(€€€€€€€½¹ÍÐ‘ˆ€ôÉ•ÅÕ•ÍÐ¹É•ÍÕ±Ðì(€€€€€€€¥˜€ …‘ˆ¹½‰©•ÑMÑ½É•9…µ•Ì¹½¹Ñ…¥¹Ì¡aQI91}	-UA}MQ=I}95¤¤ì(€€€€€€€€€‘ˆ¹É•…Ñ•=‰©•ÑMÑ½É”¡aQI91}	-UA}MQ=I}95¤ì(€€€€€€€ô(€€€€€ôì(€€€€€É•ÅÕ•ÍÐ¹½¹ÍÕ•ÍÌ€ô€ ¤€ôøÉ•Í½±Ù”¡É•ÅÕ•ÍÐ¹É•ÍÕ±Ð¤ì(€€€€€É•ÅÕ•ÍÐ¹½¹•ÉÉ½È€ô€ ¤€ôøÉ•©•Ð¡É•ÅÕ•ÍÐ¹•ÉÉ½Èñð¹•ÜÉÉ½È M¥¡•ÉÕ¹Í½É‘¹•È­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤¤ì(€€€ô¤ì(€€€É•ÑÕÉ¸•áÑ•É¹…±	…­ÕÁ‰AÉ½µ¥Í”ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸•ÑáÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±” ¤ì(€€€½¹ÍÐ‘ˆ€ô…Ý…¥Ð½Á•¹áÑ•É¹…±	…­ÕÁˆ ¤ì(€€€¥˜€ …‘ˆ¤É•ÑÕÉ¸¹Õ±°ì(€€€É•ÑÕÉ¸¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”°É•©•Ð¤€ôøì(€€€€€½¹ÍÐÑà€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡aQI91}	-UA}MQ=I}95°€É•…‘½¹±äœ¤ì(€€€€€½¹ÍÐÉ•ÅÕ•ÍÐ€ôÑà¹½‰©•ÑMÑ½É”¡aQI91}	-UA}MQ=I}95¤¹•Ð¡aQI91}	-UA}!91}-d¤ì(€€€€€É•ÅÕ•ÍÐ¹½¹ÍÕ•ÍÌ€ô€ ¤€ôøì(€€€€€€€…¡•‘áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±”€ôÉ•ÅÕ•ÍÐ¹É•ÍÕ±Ðñð¹Õ±°ì(€€€€€€€É•Í½±Ù”¡…¡•‘áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±”¤ì(€€€€€ôì(€€€€€É•ÅÕ•ÍÐ¹½¹•ÉÉ½È€ô€ ¤€ôøÉ•©•Ð¡É•ÅÕ•ÍÐ¹•ÉÉ½Èñð¹•ÜÉÉ½È M¥¡•ÉÕ¹Í½É‘¹•È­½¹¹Ñ”¹¥¡Ð•±•Í•¸Ý•É‘•¸¸œ¤¤ì(€€€ô¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸ÍÑ½É•áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±”¡¡…¹‘±”¤ì(€€€½¹ÍÐ‘ˆ€ô…Ý…¥Ð½Á•¹áÑ•É¹…±	…­ÕÁˆ ¤ì(€€€¥˜€ …‘ˆ¤Ñ¡É½Ü¹•ÜÉÉ½È ¥•Í•È	É½ÝÍ•È­…¹¸‘•¸…ÕÍ•ß‘¡±Ñ•¸=É‘¹•È¹¥¡Ð‘…Õ•É¡…™Ðµ•É­•¸¸œ¤ì(€€€É•ÑÕÉ¸¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”°É•©•Ð¤€ôøì(€€€€€½¹ÍÐÑà€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡aQI91}	-UA}MQ=I}95°€É•…‘ÝÉ¥Ñ”œ¤ì(€€€€€Ñà¹½‰©•ÑMÑ½É”¡aQI91}	-UA}MQ=I}95¤¹ÁÕÐ¡¡…¹‘±”°aQI91}	-UA}!91}-d¤ì(€€€€€Ñà¹½¹½µÁ±•Ñ”€ô€ ¤€ôøì(€€€€€€€…¡•‘áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±”€ô¡…¹‘±”ì(€€€€€€€É•Í½±Ù”¡ÑÉÕ”¤ì(€€€€€ôì(€€€€€Ñà¹½¹•ÉÉ½È€ô€ ¤€ôøÉ•©•Ð¡Ñà¹•ÉÉ½Èñð¹•ÜÉÉ½È M¥¡•ÉÕ¹Í½É‘¹•È­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤¤ì(€€€ô¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸É•µ½Ù•áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±” ¤ì(€€€½¹ÍÐ‘ˆ€ô…Ý…¥Ð½Á•¹áÑ•É¹…±	…­ÕÁˆ ¤ì(€€€¥˜€ …‘ˆ¤É•ÑÕÉ¸™…±Í”ì(€€€É•ÑÕÉ¸¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”°É•©•Ð¤€ôøì(€€€€€½¹ÍÐÑà€ô‘ˆ¹ÑÉ…¹Í…Ñ¥½¸¡aQI91}	-UA}MQ=I}95°€É•…‘ÝÉ¥Ñ”œ¤ì(€€€€€Ñà¹½‰©•ÑMÑ½É”¡aQI91}	-UA}MQ=I}95¤¹‘•±•Ñ”¡aQI91}	-UA}!91}-d¤ì(€€€€€Ñà¹½¹½µÁ±•Ñ”€ô€ ¤€ôøì(€€€€€€€…¡•‘áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±”€ô¹Õ±°ì(€€€€€€€É•Í½±Ù”¡ÑÉÕ”¤ì(€€€€€ôì(€€€€€Ñà¹½¹•ÉÉ½È€ô€ ¤€ôøÉ•©•Ð¡Ñà¹•ÉÉ½Èñð¹•ÜÉÉ½È M¥¡•ÉÕ¹Í½É‘¹•È­½¹¹Ñ”¹¥¡Ð•ÑÉ•¹¹ÐÝ•É‘•¸¸œ¤¤ì(€€€ô¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸•ÑáÑ•É¹…±	…­ÕÁA•Éµ¥ÍÍ¥½¸¡¡…¹‘±”°É•ÅÕ•ÍÑA•Éµ¥ÍÍ¥½¸€ô™…±Í”¤ì(€€€¥˜€ …¡…¹‘±”¤É•ÑÕÉ¸€µ¥ÍÍ¥¹œœì(€€€½¹ÍÐ½ÁÑ¥½¹Ì€ôìµ½‘”è€É•…‘ÝÉ¥Ñ”œôì(€€€¥˜€¡ÑåÁ•½˜¡…¹‘±”¹ÅÕ•ÉåA•Éµ¥ÍÍ¥½¸€ôôô€™Õ¹Ñ¥½¸œ¤ì(€€€€€½¹ÍÐÕÉÉ•¹Ð€ô…Ý…¥Ð¡…¹‘±”¹ÅÕ•ÉåA•Éµ¥ÍÍ¥½¸¡½ÁÑ¥½¹Ì¤ì(€€€€€¥˜€¡ÕÉÉ•¹Ð€ôôô€É…¹Ñ•œñð€…É•ÅÕ•ÍÑA•Éµ¥ÍÍ¥½¸¤É•ÑÕÉ¸ÕÉÉ•¹Ðì(€€€ô(€€€¥˜€¡É•ÅÕ•ÍÑA•Éµ¥ÍÍ¥½¸€˜˜ÑåÁ•½˜¡…¹‘±”¹É•ÅÕ•ÍÑA•Éµ¥ÍÍ¥½¸€ôôô€™Õ¹Ñ¥½¸œ¤ì(€€€€€É•ÑÕÉ¸¡…¹‘±”¹É•ÅÕ•ÍÑA•Éµ¥ÍÍ¥½¸¡½ÁÑ¥½¹Ì¤ì(€€€ô(€€€É•ÑÕÉ¸€ÁÉ½µÁÐœì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸ÝÉ¥Ñ•áÑ•É¹…±	…­ÕÀ¡½ÁÑ¥½¹Ì€ôíô¤ì(€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€½¹ÍÐ¡…¹‘±”€ô½ÁÑ¥½¹Ì¹¡…¹‘±”ñð…¡•‘áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±”ñð…Ý…¥Ð•ÑáÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±” ¤ì(€€€¥˜€ …¡…¹‘±”¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ…ÑÕÌè€µ¥ÍÍ¥¹œœôì(€€€½¹ÍÐÁ•Éµ¥ÍÍ¥½¸€ô…Ý…¥Ð•ÑáÑ•É¹…±	…­ÕÁA•Éµ¥ÍÍ¥½¸¡¡…¹‘±”°½ÁÑ¥½¹Ì¹É•ÅÕ•ÍÑA•Éµ¥ÍÍ¥½¸€ôôôÑÉÕ”¤ì(€€€¥˜€¡Á•Éµ¥ÍÍ¥½¸€„ôô€É…¹Ñ•œ¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ…ÑÕÌèÁ•Éµ¥ÍÍ¥½¸ñð€ÁÉ½µÁÐœôì((€€€½¹ÍÐÑ¥µ•ÍÑ…µÀ€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€€€½¹ÍÐì‰±½ˆô€ôÉ•…Ñ•	…­ÕÁ¥±”¡ì™¥±•¹…µ”èaQI91}	-UA}%195°•áÑ•É¹…±Q¥µ•ÍÑ…µÀèÑ¥µ•ÍÑ…µÀô¤ì(€€€½¹ÍÐ™¥±•!…¹‘±”€ô…Ý…¥Ð¡…¹‘±”¹•Ñ¥±•!…¹‘±”¡aQI91}	-UA}%195°ìÉ•…Ñ”èÑÉÕ”ô¤ì(€€€½¹ÍÐÝÉ¥Ñ…‰±”€ô…Ý…¥Ð™¥±•!…¹‘±”¹É•…Ñ•]É¥Ñ…‰±” ¤ì(€€€…Ý…¥ÐÝÉ¥Ñ…‰±”¹ÝÉ¥Ñ”¡‰±½ˆ¤ì(€€€…Ý…¥ÐÝÉ¥Ñ…‰±”¹±½Í” ¤ì((€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”€ôMÑÉ¥¹œ¡¡…¹‘±”¹¹…µ”ñðÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”ñð€M¥¡•ÉÕ¹Í½É‘¹•Èœ¤ì(€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑáÑ•É¹…±	…­ÕÁÐ€ôÑ¥µ•ÍÑ…µÀì(€€€ÝÉ¥Ñ•MÑ…Ñ•A…å±½…‘Q½MÑ½É…”¡)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¤¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°ÍÑ…ÑÕÌè€É…¹Ñ•œ°Ñ¥µ•ÍÑ…µÀ°™½±‘•É9…µ”èÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”ôì(€ô((€™Õ¹Ñ¥½¸ÅÕ•Õ•ÕÑ½µ…Ñ¥áÑ•É¹…±	…­ÕÀ ¤ì(€€€¥˜€¡•áÑ•É¹…±	…­ÕÁEÕ•Õ•ñð€…ÍÑ…Ñ”¹…ÁÁ5•Ñ„ñð€…ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”¤É•ÑÕÉ¸ì(€€€½¹ÍÐ±…ÍÐ€ôÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑáÑ•É¹…±	…­ÕÁÐ€ü¹•Ü…Ñ”¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑáÑ•É¹…±	…­ÕÁÐ¤€è¹Õ±°ì(€€€¥˜€¡±…ÍÐ€˜˜€…9Õµ‰•È¹¥Í9…8¡±…ÍÐ¹•ÑQ¥µ” ¤¤€˜˜…Ñ”¹¹½Ü ¤€´±…ÍÐ¹•ÑQ¥µ” ¤€ðaQI91}	-UA}%9QIY1}5L¤É•ÑÕÉ¸ì(€€€•áÑ•É¹…±	…­ÕÁEÕ•Õ•€ôÑÉÕ”ì(€€€Í•ÑQ¥µ•½ÕÐ¡…Íå¹Œ€ ¤€ôøì(€€€€€ÑÉäì(€€€€€€€…Ý…¥ÐÝÉ¥Ñ•áÑ•É¹…±	…­ÕÀ¡ìÉ•ÅÕ•ÍÑA•Éµ¥ÍÍ¥½¸è™…±Í”ô¤ì(€€€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€€€½¹Í½±”¹Ý…É¸ ÕÑ½µ…Ñ¥Í¡”•áÑ•É¹”M¥¡•ÉÕ¹œ­½¹¹Ñ”¹¥¡Ð…­ÑÕ…±¥Í¥•ÉÐÝ•É‘•¸œ°•ÉÈ¤ì(€€€€€ô™¥¹…±±äì(€€€€€€€•áÑ•É¹…±	…­ÕÁEÕ•Õ•€ô™…±Í”ì(€€€€€ô(€€€ô°€ÔÀÀ¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸É•½¹¥±•áÑ•É¹…±	…­ÕÁ½¹¹•Ñ¥½¸ ¤ì(€€€ÑÉäì(€€€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€€€½¹ÍÐ¡…¹‘±”€ô…Ý…¥Ð•ÑáÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±” ¤ì(€€€€€±•Ð¡…¹•€ô™…±Í”ì(€€€€€¥˜€ …¡…¹‘±”€˜˜€¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”ñðÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑáÑ•É¹…±	…­ÕÁÐ¤¤ì(€€€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”€ô€œœì(€€€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑáÑ•É¹…±	…­ÕÁÐ€ô€œœì(€€€€€€€¡…¹•€ôÑÉÕ”ì(€€€€€ô•±Í”¥˜€¡¡…¹‘±”€˜˜ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”€„ôôMÑÉ¥¹œ¡¡…¹‘±”¹¹…µ”ñð€M¥¡•ÉÕ¹Í½É‘¹•Èœ¤¤ì(€€€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”€ôMÑÉ¥¹œ¡¡…¹‘±”¹¹…µ”ñð€M¥¡•ÉÕ¹Í½É‘¹•Èœ¤ì(€€€€€€€¡…¹•€ôÑÉÕ”ì(€€€€€ô(€€€€€¥˜€¡¡…¹•¤ÝÉ¥Ñ•MÑ…Ñ•A…å±½…‘Q½MÑ½É…”¡)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¤¤ì(€€€€€¥˜€¡¡…¹‘±”¤ÅÕ•Õ•ÕÑ½µ…Ñ¥áÑ•É¹…±	…­ÕÀ ¤ì(€€€€€É•ÑÕÉ¸¡…¹•ì(€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€½¹Í½±”¹Ý…É¸ MÑ…ÑÕÌ‘•È•áÑ•É¹•¸M¥¡•ÉÕ¹œ­½¹¹Ñ”¹¥¡Ð•ÁËñ™ÐÝ•É‘•¸œ°•ÉÈ¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô(€ô((€™Õ¹Ñ¥½¸É•…Ñ•	…­ÕÁ¥±•¹…µ” ¤ì(€€€½¹ÍÐ¹½Ü€ô¹•Ü…Ñ” ¤ì(€€€½¹ÍÐåååä€ô¹½Ü¹•ÑÕ±±e•…È ¤ì(€€€½¹ÍÐµ´€ôMÑÉ¥¹œ¡¹½Ü¹•Ñ5½¹Ñ  ¤€¬€Ä¤¹Á…‘MÑ…ÉÐ È°€œÀœ¤ì(€€€½¹ÍÐ‘€ôMÑÉ¥¹œ¡¹½Ü¹•Ñ…Ñ” ¤¤¹Á…‘MÑ…ÉÐ È°€œÀœ¤ì(€€€½¹ÍÐ¡ €ôMÑÉ¥¹œ¡¹½Ü¹•Ñ!½ÕÉÌ ¤¤¹Á…‘MÑ…ÉÐ È°€œÀœ¤ì(€€€½¹ÍÐµ¤€ôMÑÉ¥¹œ¡¹½Ü¹•Ñ5¥¹ÕÑ•Ì ¤¤¹Á…‘MÑ…ÉÐ È°€œÀœ¤ì(€€€É•ÑÕÉ¸¡…ÕÍ¡…±ÑÍÁ±…¹•Èµ‰…­ÕÀ´‘íååååô´‘íµµô´‘í‘‘ô´‘í¡¡ô‘íµ¥ô¹©Í½¹€ì(€ô((€™Õ¹Ñ¥½¸É•…Ñ•	…­ÕÁ¥±”¡½ÁÑ¥½¹Ì€ôíô¤ì(€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€¹½Éµ…±¥é•M•±™µÁ±½åµ•¹Ð ¤ì(€€€Íå¹±±1¥¹­•‘•‰ÑI…Ñ•ÍÉ½µA½ÍÑÌ¡ÕÉÉ•¹Ñ5½¹Ñ °€ÌØ°ìÍ¥±•¹ÐèÑÉÕ”ô¤ì(€€€¹½Éµ…±¥é•±±A•ÉÍ½¹½¹™¥Ì ¤ì(€€€¹½Éµ…±¥é•±±A½ÍÑ½¹™¥Ì ¤ì(€€€¹½Éµ…±¥é•±±•‰Ñ½¹™¥Ì ¤ì(€€€½¹ÍÐ‰…­ÕÁMÑ…Ñ”€ô)M=8¹Á…ÉÍ”¡)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¤¤ì(€€€¥˜€ …‰…­ÕÁMÑ…Ñ”¹…ÁÁ5•Ñ„ñðÑåÁ•½˜‰…­ÕÁMÑ…Ñ”¹…ÁÁ5•Ñ„€„ôô€½‰©•Ðœ¤‰…­ÕÁMÑ…Ñ”¹…ÁÁ5•Ñ„€ôíôì(€€€‰…­ÕÁMÑ…Ñ”¹…ÁÁ5•Ñ„¹¥¹±Õ‘•Á¥-•å%¹	…­ÕÀ€ôÑÉÕ”ì(€€€¥˜€¡½ÁÑ¥½¹Ì¹•áÑ•É¹…±Q¥µ•ÍÑ…µÀ¤‰…­ÕÁMÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑáÑ•É¹…±	…­ÕÁÐ€ô½ÁÑ¥½¹Ì¹•áÑ•É¹…±Q¥µ•ÍÑ…µÀì(€€€€¼¼•ÈA$µ-•äÝ¥É‰•ÝÕÍÍÐ9%!P•¹Ñ™•É¹Ðè	•¹¹ä·Ù¡Ñ”¹ÕÈ•¥¸	…­ÕÀ°¥µµ•Èµ¥ÐA$µ-•ä¸(€€€½¹ÍÐ‘…Ñ…MÑÈ€ô)M=8¹ÍÑÉ¥¹¥™ä¡‰…­ÕÁMÑ…Ñ”°¹Õ±°°€È¤ì(€€€½¹ÍÐ™¥±•¹…µ”€ô½ÁÑ¥½¹Ì¹™¥±•¹…µ”ñðÉ•…Ñ•	…­ÕÁ¥±•¹…µ” ¤ì(€€€½¹ÍÐ‰±½ˆ€ô¹•Ü	±½ˆ¡m‘…Ñ…MÑÉt°ìÑåÁ”è€…ÁÁ±¥…Ñ¥½¸½©Í½¸œô¤ì(€€€½¹ÍÐ™¥±”€ô¹•Ü¥±”¡m‰±½‰t°™¥±•¹…µ”°ìÑåÁ”è€…ÁÁ±¥…Ñ¥½¸½©Í½¸œô¤ì(€€€É•ÑÕÉ¸ì‰±½ˆ°™¥±”°™¥±•¹…µ”ôì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸Í…Ù•	…­ÕÁY¥…M¡…É•M¡••Ð ¤ì(€€€½¹ÍÐì‰±½ˆ°™¥±”°™¥±•¹…µ”ô€ôÉ•…Ñ•	…­ÕÁ¥±” ¤ì(€€€¥˜€¡¹…Ù¥…Ñ½È¹Í¡…É”€˜˜¹…Ù¥…Ñ½È¹…¹M¡…É”€˜˜¹…Ù¥…Ñ½È¹…¹M¡…É”¡ì™¥±•Ìèm™¥±•tô¤¤ì(€€€€€ÑÉäì(€€€€€€€…Ý…¥Ð¹…Ù¥…Ñ½È¹Í¡…É”¡ì(€€€€€€€€€™¥±•Ìèm™¥±•t°(€€€€€€€€€Ñ¥Ñ±”è€!…ÕÍ¡…±ÑÍÁ±…¹•È	…­ÕÀœ°(€€€€€€€€€Ñ•áÐè€	…­ÕÀ›ñÈ¥±½ÕÉ¥Ù”½‘•È…Ñ•¥•¸Í¥¡•É¸œ(€€€€€€€ô¤ì(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€€€¥˜€¡MÑÉ¥¹œ¡•ÉÈ€˜˜•ÉÈ¹¹…µ”¤€ôôô€‰½ÉÑÉÉ½Èœ¤É•ÑÕÉ¸™…±Í”ì(€€€€€ô(€€€ô(€€€½¹ÍÐÕÉ°€ôUI0¹É•…Ñ•=‰©•ÑUI0¡‰±½ˆ¤ì(€€€½¹ÍÐ±¥¹¬€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð „œ¤ì(€€€±¥¹¬¹¡É•˜€ôÕÉ°ì(€€€±¥¹¬¹‘½Ý¹±½…€ô™¥±•¹…µ”ì(€€€‘½Õµ•¹Ð¹‰½‘ä¹…ÁÁ•¹‘¡¥±¡±¥¹¬¤ì(€€€±¥¹¬¹±¥¬ ¤ì(€€€‘½Õµ•¹Ð¹‰½‘ä¹É•µ½Ù•¡¥±¡±¥¹¬¤ì(€€€UI0¹É•Ù½­•=‰©•ÑUI0¡ÕÉ°¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô((((((€™Õ¹Ñ¥½¸¹½Éµ…±¥é•Q…áI•™Õ¹¡É•™Õ¹¤ì(€€€¥˜€ …É•™Õ¹ñðÑåÁ•½˜É•™Õ¹€„ôô€½‰©•Ðœ¤É•ÑÕÉ¸¹Õ±°ì(€€€¥˜€ …É•™Õ¹¹¥¤É•™Õ¹¹¥€ô•¹•É…Ñ•% ¤ì(€€€½¹ÍÐÕÉÉ•¹Ñe•…È€ô¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤ì(€€€½¹ÍÐå•…È€ô9Õµ‰•È¡É•™Õ¹¹å•…ÈñðÕÉÉ•¹Ñe•…È¤ì(€€€É•™Õ¹¹å•…È€ô9Õµ‰•È¹¥Í¥¹¥Ñ”¡å•…È¤€üMÑÉ¥¹œ¡5…Ñ ¹µ…à ÈÀÀÀ°5…Ñ ¹µ¥¸ ÈÄÀÀ°5…Ñ ¹ÑÉÕ¹Œ¡å•…È¤¤¤¤€èMÑÉ¥¹œ¡ÕÉÉ•¹Ñe•…È¤ì(€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡É•™Õ¹¹…µ½Õ¹Ðñð€À¤ì(€€€É•™Õ¹¹…µ½Õ¹Ð€ô9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤€˜˜…µ½Õ¹Ð€øô€À€ü…µ½Õ¹Ð€è€Àì(€€€¥˜€¡ÑåÁ•½˜É•™Õ¹¹É••¥Ù•‘…Ñ”€„ôô€ÍÑÉ¥¹œœ¤É•™Õ¹¹É••¥Ù•‘…Ñ”€ô€œœì(€€€¥˜€¡ÑåÁ•½˜É•™Õ¹¹¹½Ñ”€„ôô€ÍÑÉ¥¹œœ¤É•™Õ¹¹¹½Ñ”€ô€œœì(€€€¥˜€¡ÑåÁ•½˜É•™Õ¹¹…½Õ¹Ñ%€„ôô€ÍÑÉ¥¹œœ¤É•™Õ¹¹…½Õ¹Ñ%€ô€œœì(€€€¥˜€¡ÑåÁ•½˜É•™Õ¹¹ÑÉ…¹Í…Ñ¥½¹%€„ôô€ÍÑÉ¥¹œœ¤É•™Õ¹¹ÑÉ…¹Í…Ñ¥½¹%€ô€œœì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡É•™Õ¹¹ÁÕÉ¡…Í•Ì¤¤É•™Õ¹¹ÁÕÉ¡…Í•Ì€ômtì(€€€É•™Õ¹¹ÁÕÉ¡…Í•Ì€ôÉ•™Õ¹¹ÁÕÉ¡…Í•Ì(€€€€€€¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´€˜˜ÑåÁ•½˜¥Ñ•´€ôôô€½‰©•Ðœ¤(€€€€€€¹µ…À ¡¥Ñ•´¤€ôøì(€€€€€€€¥˜€ …¥Ñ•´¹¥¤¥Ñ•´¹¥€ô•¹•É…Ñ•% ¤ì(€€€€€€€¥˜€¡ÑåÁ•½˜¥Ñ•´¹¹…µ”€„ôô€ÍÑÉ¥¹œœ¤¥Ñ•´¹¹…µ”€ô€œœì(€€€€€€€½¹ÍÐ¥Ñ•µµ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡¥Ñ•´¹…µ½Õ¹Ðñð€À¤ì(€€€€€€€¥Ñ•´¹…µ½Õ¹Ð€ô9Õµ‰•È¹¥Í¥¹¥Ñ”¡¥Ñ•µµ½Õ¹Ð¤€˜˜¥Ñ•µµ½Õ¹Ð€øô€À€ü¥Ñ•µµ½Õ¹Ð€è€Àì(€€€€€€€¥˜€¡ÑåÁ•½˜¥Ñ•´¹‘…Ñ”€„ôô€ÍÑÉ¥¹œœ¤¥Ñ•´¹‘…Ñ”€ô€œœì(€€€€€€€¥˜€¡ÑåÁ•½˜¥Ñ•´¹¹½Ñ”€„ôô€ÍÑÉ¥¹œœ¤¥Ñ•´¹¹½Ñ”€ô€œœì(€€€€€€€¥Ñ•´¹Á…åµ•¹Ñ5•Ñ¡½€ô¹½Éµ…±¥é•!½ÕÍ•¡½±‘A…åµ•¹Ñ5•Ñ¡½¡¥Ñ•´¹Á…åµ•¹Ñ5•Ñ¡½¤ì(€€€€€€€¥˜€¡ÑåÁ•½˜¥Ñ•´¹…½Õ¹Ñ%€„ôô€ÍÑÉ¥¹œœ¤¥Ñ•´¹…½Õ¹Ñ%€ô€œœì(€€€€€€€¥˜€¡ÑåÁ•½˜¥Ñ•´¹ÑÉ…¹Í…Ñ¥½¹%€„ôô€ÍÑÉ¥¹œœ¤¥Ñ•´¹ÑÉ…¹Í…Ñ¥½¹%€ô€œœì(€€€€€€€É•ÑÕÉ¸¥Ñ•´ì(€€€€€ô¤(€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôøì(€€€€€€€½¹ÍÐ……Ñ”€ô€½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡MÑÉ¥¹œ¡„¹‘…Ñ”ñð€œœ¤¤€ü„¹‘…Ñ”€è€œœì(€€€€€€€½¹ÍÐ‰…Ñ”€ô€½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡MÑÉ¥¹œ¡ˆ¹‘…Ñ”ñð€œœ¤¤€üˆ¹‘…Ñ”€è€œœì(€€€€€€€¥˜€¡……Ñ”€˜˜‰…Ñ”€˜˜……Ñ”€„ôô‰…Ñ”¤É•ÑÕÉ¸‰…Ñ”¹±½…±•½µÁ…É”¡……Ñ”¤ì(€€€€€€€¥˜€¡……Ñ”€„ôô‰…Ñ”¤É•ÑÕÉ¸……Ñ”€ü€´Ä€è€Äì(€€€€€€€É•ÑÕÉ¸€Àì(€€€€€ô¤ì(€€€É•ÑÕÉ¸É•™Õ¹ì(€ô((€™Õ¹Ñ¥½¸•ÑQ…áI•™Õ¹‘½Õ¹ÑM½ÕÉ•%¡É•™Õ¹¤ì(€€€É•ÑÕÉ¸É•™Õ¹€˜˜É•™Õ¹¹¥€üÑ…áÉ•™Õ¹è‘íÉ•™Õ¹¹¥‘õ€€è€œœì(€ô((€™Õ¹Ñ¥½¸Íå¹Q…áI•™Õ¹‘½Õ¹Ñ	½½­¥¹œ¡É•™Õ¹¤ì(€€€¥˜€ …É•™Õ¹ñðÑåÁ•½˜É•™Õ¹€„ôô€½‰©•Ðœ¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÍ½ÕÉ•%€ô•ÑQ…áI•™Õ¹‘½Õ¹ÑM½ÕÉ•%¡É•™Õ¹¤ì(€€€¥˜€ …Í½ÕÉ•%¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡É•™Õ¹¹…µ½Õ¹Ðñð€À¤ì(€€€¥˜€ „¡…µ½Õ¹Ð€ø€À¤¤ì(€€€€€É•µ½Ù•½Õ¹ÑQÉ…¹Í…Ñ¥½¹	åM½ÕÉ”¡Í½ÕÉ•%¤ì(€€€€€É•™Õ¹¹ÑÉ…¹Í…Ñ¥½¹%€ô€œœì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô(€€€½¹ÍÐÍ¡…É•€ô•ÑM¡…É•‘½Õ¹Ð ¤ì(€€€¥˜€ …Í¡…É•¤É•ÑÕÉ¸¹Õ±°ì(€€€É•™Õ¹¹…½Õ¹Ñ%€ôÍ¡…É•¹¥ì(€€€½¹ÍÐÑá%€ôÕÁÍ•ÉÑ½Õ¹ÑQÉ…¹Í…Ñ¥½¸¡Í¡…É•¹¥°ì(€€€€€µ½¹Ñ è•Ñ5½¹Ñ¡É½µ…Ñ•MÑÉ¥¹œ¡É•™Õ¹¹É••¥Ù•‘…Ñ”¤°(€€€€€‘…Ñ”èÉ•™Õ¹¹É••¥Ù•‘…Ñ”ñð€œœ°(€€€€€ÑåÁ”è€Ñ…á}É•™Õ¹œ°(€€€€€Í½ÕÉ•%°(€€€€€±…‰•°èMÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œ€‘íÉ•™Õ¹¹å•…Èñð€œõ€¹ÑÉ¥´ ¤°(€€€€€…µ½Õ¹Ð°(€€€€€¹½Ñ”è€9…¡Ý•¥Ìè¥”ÉÍÑ…ÑÑÕ¹œ±¥•Ð…Õ˜‘•´•µ•¥¹Í¡…™ÑÍ­½¹Ñ¼ì‘•È•¥¹••‰•¹”	…¹­ÍÑ…¹‰±•¥‰ÐÕ¹Ù•Ë‘¹‘•ÉÐ¸œ(€€€ô¤ì(€€€É•™Õ¹¹ÑÉ…¹Í…Ñ¥½¹%€ôÑá%ñð€œœì(€€€É•ÑÕÉ¸Ñá%ì(€ô((€™Õ¹Ñ¥½¸É•µ½Ù•Q…áI•™Õ¹‘½Õ¹Ñ	½½­¥¹œ¡É•™Õ¹¤ì(€€€¥˜€ …É•™Õ¹ñðÑåÁ•½˜É•™Õ¹€„ôô€½‰©•Ðœ¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐÍ½ÕÉ•%€ô•ÑQ…áI•™Õ¹‘½Õ¹ÑM½ÕÉ•%¡É•™Õ¹¤ì(€€€±•ÐÉ•µ½Ù•€ô™…±Í”ì(€€€¥˜€¡Í½ÕÉ•%¤É•µ½Ù•€ôÉ•µ½Ù•½Õ¹ÑQÉ…¹Í…Ñ¥½¹	åM½ÕÉ”¡Í½ÕÉ•%¤ñðÉ•µ½Ù•ì(€€€¥˜€¡É•™Õ¹¹ÑÉ…¹Í…Ñ¥½¹%€˜˜É•™Õ¹¹…½Õ¹Ñ%¤É•µ½Ù•€ôÉ•µ½Ù•½Õ¹Ñ1•‘•ÉQÉ…¹Í…Ñ¥½¸¡É•™Õ¹¹…½Õ¹Ñ%°É•™Õ¹¹ÑÉ…¹Í…Ñ¥½¹%¤ñðÉ•µ½Ù•½Õ¹ÑQÉ…¹Í…Ñ¥½¸¡É•™Õ¹¹…½Õ¹Ñ%°É•™Õ¹¹ÑÉ…¹Í…Ñ¥½¹%¤ñðÉ•µ½Ù•ì(€€€€¡É•™Õ¹¹ÁÕÉ¡…Í•Ìñðmt¤¹™½É…  ¡ÁÕÉ¡…Í”¤€ôøìÉ•µ½Ù•€ôÉ•µ½Ù•Q…áI•™Õ¹‘AÕÉ¡…Í•	½½­¥¹œ¡É•™Õ¹°ÁÕÉ¡…Í”¤ñðÉ•µ½Ù•ìô¤ì(€€€É•™Õ¹¹ÑÉ…¹Í…Ñ¥½¹%€ô€œœì(€€€É•ÑÕÉ¸É•µ½Ù•ì(€ô((€™Õ¹Ñ¥½¸•ÑQ…áI•™Õ¹‘AÕÉ¡…Í•M½ÕÉ•%¡É•™Õ¹°ÁÕÉ¡…Í”¤ì(€€€É•ÑÕÉ¸É•™Õ¹€˜˜É•™Õ¹¹¥€˜˜ÁÕÉ¡…Í”€˜˜ÁÕÉ¡…Í”¹¥€üÑ…áÉ•™Õ¹µÁÕÉ¡…Í”è‘íÉ•™Õ¹¹¥‘ôè‘íÁÕÉ¡…Í”¹¥‘õ€€è€œœì(€ô((€™Õ¹Ñ¥½¸•Ñ5½¹Ñ¡É½µ…Ñ•MÑÉ¥¹œ¡‘…Ñ•Y…±Õ”¤ì(€€€½¹ÍÐÙ…±Õ”€ôMÑÉ¥¹œ¡‘…Ñ•Y…±Õ”ñð€œœ¤ì(€€€½¹ÍÐµ…Ñ €ôÙ…±Õ”¹µ…Ñ  ½x¡q‘ìÑôµq‘ìÉô¤µq‘ìÉô¼¤ì(€€€É•ÑÕÉ¸µ…Ñ €˜˜¥Í5½¹Ñ¡-•ä¡µ…Ñ¡lÅt¤€üµ…Ñ¡lÅt€èU1Q}QI9MQ%=9}5=9Q ì(€ô((€™Õ¹Ñ¥½¸Íå¹Q…áI•™Õ¹‘AÕÉ¡…Í•	½½­¥¹œ¡É•™Õ¹°ÁÕÉ¡…Í”¤ì(€€€¥˜€ …É•™Õ¹ñð€…ÁÕÉ¡…Í”¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÍ½ÕÉ•%€ô•ÑQ…áI•™Õ¹‘AÕÉ¡…Í•M½ÕÉ•%¡É•™Õ¹°ÁÕÉ¡…Í”¤ì(€€€¥˜€ …Í½ÕÉ•%¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡ÁÕÉ¡…Í”¹…µ½Õ¹Ðñð€À¤ì(€€€¥˜€ „¡…µ½Õ¹Ð€ø€À¤¤ì(€€€€€É•µ½Ù•½Õ¹ÑQÉ…¹Í…Ñ¥½¹	åM½ÕÉ”¡Í½ÕÉ•%¤ì(€€€€€ÁÕÉ¡…Í”¹ÑÉ…¹Í…Ñ¥½¹%€ô€œœì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô(€€€½¹ÍÐÍ¡…É•€ô•ÑM¡…É•‘½Õ¹Ð ¤ì(€€€¥˜€ …Í¡…É•¤É•ÑÕÉ¸¹Õ±°ì(€€€É•™Õ¹¹…½Õ¹Ñ%€ôÍ¡…É•¹¥ì(€€€ÁÕÉ¡…Í”¹…½Õ¹Ñ%€ôÍ¡…É•¹¥ì(€€€½¹ÍÐÑá%€ôÕÁÍ•ÉÑ½Õ¹ÑQÉ…¹Í…Ñ¥½¸¡Í¡…É•¹¥°ì(€€€€€µ½¹Ñ è•Ñ5½¹Ñ¡É½µ…Ñ•MÑÉ¥¹œ¡ÁÕÉ¡…Í”¹‘…Ñ”¤°(€€€€€‘…Ñ”èÁÕÉ¡…Í”¹‘…Ñ”ñð€œœ°(€€€€€ÑåÁ”è€Ñ…á}É•™Õ¹‘}ÁÕÉ¡…Í”œ°(€€€€€Í½ÕÉ•%°(€€€€€±…‰•°èMÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œè€‘íÁÕÉ¡…Í”¹¹…µ”ñð€-…Õ˜õ€°(€€€€€…µ½Õ¹Ðè€µ…µ½Õ¹Ð°(€€€€€¹½Ñ”è€9…¡Ý•¥Ìè-…Õ˜…ÕÌ•‰Õ¹‘•¹•ÈMÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œì‘•È•¥¹••‰•¹”	…¹­ÍÑ…¹‰±•¥‰ÐÕ¹Ù•Ë‘¹‘•ÉÐ¸œ(€€€ô¤ì(€€€ÁÕÉ¡…Í”¹ÑÉ…¹Í…Ñ¥½¹%€ôÑá%ñð€œœì(€€€É•ÑÕÉ¸Ñá%ì(€ô((€™Õ¹Ñ¥½¸É•µ½Ù•Q…áI•™Õ¹‘AÕÉ¡…Í•	½½­¥¹œ¡É•™Õ¹°ÁÕÉ¡…Í”¤ì(€€€¥˜€ …É•™Õ¹ñð€…ÁÕÉ¡…Í”¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐÍ½ÕÉ•%€ô•ÑQ…áI•™Õ¹‘AÕÉ¡…Í•M½ÕÉ•%¡É•™Õ¹°ÁÕÉ¡…Í”¤ì(€€€±•ÐÉ•µ½Ù•€ô™…±Í”ì(€€€¥˜€¡Í½ÕÉ•%¤É•µ½Ù•€ôÉ•µ½Ù•½Õ¹ÑQÉ…¹Í…Ñ¥½¹	åM½ÕÉ”¡Í½ÕÉ•%¤ñðÉ•µ½Ù•ì(€€€¥˜€¡ÁÕÉ¡…Í”¹ÑÉ…¹Í…Ñ¥½¹%€˜˜ÁÕÉ¡…Í”¹…½Õ¹Ñ%¤É•µ½Ù•€ôÉ•µ½Ù•½Õ¹Ñ1•‘•ÉQÉ…¹Í…Ñ¥½¸¡ÁÕÉ¡…Í”¹…½Õ¹Ñ%°ÁÕÉ¡…Í”¹ÑÉ…¹Í…Ñ¥½¹%¤ñðÉ•µ½Ù•½Õ¹ÑQÉ…¹Í…Ñ¥½¸¡ÁÕÉ¡…Í”¹…½Õ¹Ñ%°ÁÕÉ¡…Í”¹ÑÉ…¹Í…Ñ¥½¹%¤ñðÉ•µ½Ù•ì(€€€ÁÕÉ¡…Í”¹ÑÉ…¹Í…Ñ¥½¹%€ô€œœì(€€€É•ÑÕÉ¸É•µ½Ù•ì(€ô((€™Õ¹Ñ¥½¸Íå¹Q…áI•™Õ¹‘AÕÉ¡…Í•	½½­¥¹Ì¡É•™Õ¹¤ì(€€€¥˜€ …É•™Õ¹ñðÑåÁ•½˜É•™Õ¹€„ôô€½‰©•Ðœ¤É•ÑÕÉ¸ì(€€€½¹ÍÐÕÉÉ•¹ÑM½ÕÉ•Ì€ô¹•ÜM•Ð ¤ì(€€€€¡É•™Õ¹¹ÁÕÉ¡…Í•Ìñðmt¤¹™½É…  ¡ÁÕÉ¡…Í”¤€ôøì(€€€€€½¹ÍÐÍ½ÕÉ•%€ô•ÑQ…áI•™Õ¹‘AÕÉ¡…Í•M½ÕÉ•%¡É•™Õ¹°ÁÕÉ¡…Í”¤ì(€€€€€¥˜€¡Í½ÕÉ•%¤ÕÉÉ•¹ÑM½ÕÉ•Ì¹…‘¡Í½ÕÉ•%¤ì(€€€€€Íå¹Q…áI•™Õ¹‘AÕÉ¡…Í•	½½­¥¹œ¡É•™Õ¹°ÁÕÉ¡…Í”¤ì(€€€ô¤ì(€€€½¹ÍÐÁÉ•™¥à€ôÉ•™Õ¹€˜˜É•™Õ¹¹¥€üÑ…áÉ•™Õ¹µÁÕÉ¡…Í”è‘íÉ•™Õ¹¹¥‘ôé€€è€œœì(€€€¥˜€ …ÁÉ•™¥à¤É•ÑÕÉ¸ì(€€€€¡ÍÑ…Ñ”¹…½Õ¹ÑÌñðmt¤¹™½É…  ¡…½Õ¹Ð¤€ôøì(€€€€€€¡…½Õ¹Ð¹ÑÉ…¹Í…Ñ¥½¹Ìñðmt¤¹Í±¥” ¤¹™½É…  ¡Ñà¤€ôøì(€€€€€€€¥˜€¡Ñà€˜˜ÑåÁ•½˜Ñà¹Í½ÕÉ•%€ôôô€ÍÑÉ¥¹œœ€˜˜Ñà¹Í½ÕÉ•%¹ÍÑ…ÉÑÍ]¥Ñ ¡ÁÉ•™¥à¤€˜˜€…ÕÉÉ•¹ÑM½ÕÉ•Ì¹¡…Ì¡Ñà¹Í½ÕÉ•%¤¤ì(€€€€€€€€€É•µ½Ù•½Õ¹Ñ1•‘•ÉQÉ…¹Í…Ñ¥½¸¡…½Õ¹Ð¹¥°Ñà¹¥¤ñðÉ•µ½Ù•½Õ¹ÑQÉ…¹Í…Ñ¥½¸¡…½Õ¹Ð¹¥°Ñà¹¥¤ì(€€€€€€€ô(€€€€€ô¤ì(€€€ô¤ì(€ô((€™Õ¹Ñ¥½¸¹½Éµ…±¥é•±±Q…áI•™Õ¹‘Ì ¤ì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì¤¤ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì€ômtì(€€€ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì€ôÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì¹µ…À¡¹½Éµ…±¥é•Q…áI•™Õ¹¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì¹Í½ÉÐ ¡„°ˆ¤€ôøì(€€€€€½¹ÍÐå•…É=É‘•È€ôMÑÉ¥¹œ¡ˆ¹å•…È¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡„¹å•…È¤¤ì(€€€€€¥˜€¡å•…É=É‘•È¤É•ÑÕÉ¸å•…É=É‘•Èì(€€€€€½¹ÍÐ……Ñ”€ô€½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡MÑÉ¥¹œ¡„¹É••¥Ù•‘…Ñ”ñð€œœ¤¤€ü„¹É••¥Ù•‘…Ñ”€è€œœì(€€€€€½¹ÍÐ‰…Ñ”€ô€½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡MÑÉ¥¹œ¡ˆ¹É••¥Ù•‘…Ñ”ñð€œœ¤¤€üˆ¹É••¥Ù•‘…Ñ”€è€œœì(€€€€€¥˜€¡……Ñ”€˜˜‰…Ñ”€˜˜……Ñ”€„ôô‰…Ñ”¤É•ÑÕÉ¸‰…Ñ”¹±½…±•½µÁ…É”¡……Ñ”¤ì(€€€€€¥˜€¡……Ñ”€„ôô‰…Ñ”¤É•ÑÕÉ¸……Ñ”€ü€´Ä€è€Äì(€€€€€É•ÑÕÉ¸€Àì(€€€ô¤ì(€€€ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì¹™½É…  ¡É•™Õ¹¤€ôøì(€€€€€€¡É•™Õ¹¹ÁÕÉ¡…Í•Ìñðmt¤¹™½É…  ¡ÁÕÉ¡…Í”¤€ôøì(€€€€€€€¥˜€¡ÁÕÉ¡…Í”¹ÑÉ…¹Í™•É5•Ñ„€˜˜ÁÕÉ¡…Í”¹ÑÉ…¹Í™•É5•Ñ„¹™É½´€ôôô€‰Õ™™•ÉáÁ•¹Í”œ€˜˜ÁÕÉ¡…Í”¹ÑÉ…¹Í™•É5•Ñ„¹Á½ÍÑ%(€€€€€€€€€€€€˜˜€„¡ÍÑ…Ñ”¹‰Õ™™•ÉáÁ•¹Í•Ìñðmt¤¹Í½µ” ¡Á½ÍÐ¤€ôøÁ½ÍÐ€˜˜Á½ÍÐ¹¥€ôôôÁÕÉ¡…Í”¹ÑÉ…¹Í™•É5•Ñ„¹Á½ÍÑ%¤¤ì(€€€€€€€€€É•µ½Ù•±±A½ÍÑ½Õ¹Ñ	½½­¥¹Ì¡ÁÕÉ¡…Í”¹ÑÉ…¹Í™•É5•Ñ„¹Á½ÍÑ%¤ì(€€€€€€€ô(€€€€€ô¤ì(€€€€€Íå¹Q…áI•™Õ¹‘½Õ¹Ñ	½½­¥¹œ¡É•™Õ¹¤ì(€€€€€Íå¹Q…áI•™Õ¹‘AÕÉ¡…Í•	½½­¥¹Ì¡É•™Õ¹¤ì(€€€ô¤ì(€ô((€™Õ¹Ñ¥½¸•ÑQ…áI•™Õ¹‘MÕµµ…Éä¡å•…È¤ì(€€€¹½Éµ…±¥é•±±Q…áI•™Õ¹‘Ì ¤ì(€€€½¹ÍÐÉ•™Õ¹‘Ì€ô€¡ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ìñðmt¤¹™¥±Ñ•È ¡¥Ñ•´¤€ôøMÑÉ¥¹œ¡¥Ñ•´¹å•…È¤€ôôôMÑÉ¥¹œ¡å•…È¤¤ì(€€€½¹ÍÐÉ••¥Ù•€ôÉ•™Õ¹‘Ì¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬9Õµ‰•È¡¥Ñ•´¹…µ½Õ¹Ðñð€À¤°€À¤ì(€€€½¹ÍÐÍÁ•¹Ð€ôÉ•™Õ¹‘Ì¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬€¡¥Ñ•´¹ÁÕÉ¡…Í•Ìñðmt¤¹É•‘Õ” ¡Ì°À¤€ôøÌ€¬9Õµ‰•È¡À¹…µ½Õ¹Ðñð€À¤°€À¤°€À¤ì(€€€½¹ÍÐÉ•µ…¥¹¥¹œ€ôÉ••¥Ù•€´ÍÁ•¹Ðì(€€€½¹ÍÐ‰½Õ¹‘I•µ…¥¹¥¹œ€ôÉ•™Õ¹‘Ì¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøì(€€€€€½¹ÍÐÕÍ•€ô€¡¥Ñ•´¹ÁÕÉ¡…Í•Ìñðmt¤¹É•‘Õ” ¡Ì°À¤€ôøÌ€¬9Õµ‰•È¡À¹…µ½Õ¹Ðñð€À¤°€À¤ì(€€€€€É•ÑÕÉ¸ÍÕ´€¬5…Ñ ¹µ…à¡9Õµ‰•È¡¥Ñ•´¹…µ½Õ¹Ðñð€À¤€´ÕÍ•°€À¤ì(€€€ô°€À¤ì(€€€½¹ÍÐÁÕÉ¡…Í•Ì€ôÉ•™Õ¹‘Ì¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬€¡¥Ñ•´¹ÁÕÉ¡…Í•Ìñðmt¤¹±•¹Ñ °€À¤ì(€€€É•ÑÕÉ¸ìÉ•™Õ¹‘Ì°É••¥Ù•°ÍÁ•¹Ð°É•µ…¥¹¥¹œ°‰½Õ¹‘I•µ…¥¹¥¹œ°ÁÕÉ¡…Í•Ìôì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉQ…áI•™Õ¹‘½¹ÑÉ½±…É¡ÍÕµµ…Éä°å•…È¤ì(€€€½¹ÍÐ…É€ôÉ•…Ñ•U¥° ‘¥Øœ°€…ÉÑ…àµÉ•™Õ¹µ½¹ÑÉ½°µ…Éœ¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€-½¹ÑÉ½±±É•¡¹Õ¹œMÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œœ¤¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€/‘Õ™”…ÕÌ‘•ÈMÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œµ¥¹‘•É¸¹ÕÈ‘•¸•‰Õ¹‘•¹•¸I•ÍÐ¸M¥”Ý•É‘•¸…±Ì!…ÕÍ¡…±ÑÍ¹…¡Ý•¥Ì•›ñ¡ÉÐÕ¹¹¥¡Ð…±Ì-½¹Ñ½‰Õ¡Õ¹œ¸œ¤¤ì(€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”½µÁ…ÐµÑ…‰±”œì(€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ùÉÍÑ…ÑÑÕ¹œð½Ñ øñÑ ù¥¹…¹œð½Ñ øñÑ ù/‘Õ™”ð½Ñ øñÑ ùI•ÍÐð½Ñ øñÑ ù•‰Õ¹‘•¹•ÈI•ÍÐð½Ñ øñÑ ù!¥¹Ý•¥Ìð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€½¹ÍÐÍÕÍÁ¥¥½ÕÍ%‘Ì€ô¹•ÜM•Ð¡•ÑQ…áI•™Õ¹‘MÕÍÁ¥¥½ÕÍ¹ÑÉ¥•Ì¡å•…È¤¹µ…À ¡•¹ÑÉä¤€ôø•¹ÑÉä¹É•™Õ¹€˜˜•¹ÑÉä¹É•™Õ¹¹¥¤¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€€€¥˜€ …ÍÕµµ…Éä¹É•™Õ¹‘Ì¹±•¹Ñ ¤ì(€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€ÑÈ¹¥¹¹•É!Q50€ô€œñÑ½±ÍÁ…¸ôˆØˆ±…ÍÌô‰µÕÑ•ˆù-•¥¹”ÉÍÑ…ÑÑÕ¹œ›ñÈ‘¥•Í•ÌMÑ•Õ•É©…¡È•¥¹•ÑÉ…•¸¸ð½Ñøœì(€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€ô•±Í”ì(€€€€€ÍÕµµ…Éä¹É•™Õ¹‘Ì¹™½É…  ¡É•™Õ¹¤€ôøì(€€€€€€€½¹ÍÐÍÁ•¹Ð€ô€¡É•™Õ¹¹ÁÕÉ¡…Í•Ìñðmt¤¹É•‘Õ” ¡ÍÕ´°ÁÕÉ¡…Í”¤€ôøÍÕ´€¬9Õµ‰•È¡ÁÕÉ¡…Í”¹…µ½Õ¹Ðñð€À¤°€À¤ì(€€€€€€€½¹ÍÐÉ•µ…¥¹¥¹œ€ô9Õµ‰•È¡É•™Õ¹¹…µ½Õ¹Ðñð€À¤€´ÍÁ•¹Ðì(€€€€€€€½¹ÍÐ‰½Õ¹€ô5…Ñ ¹µ…à¡É•µ…¥¹¥¹œ°€À¤ì(€€€€€€€½¹ÍÐ¡¥¹Ð€ôÍÕÍÁ¥¥½ÕÍ%‘Ì¹¡…Ì¡É•™Õ¹¹¥¤(€€€€€€€€€€ü€­±•¥¹•È¥¹é•±‰•ÑÉ…œÝ¥É­Ð‘½ÁÁ•±Ðœ(€€€€€€€€€€è€¡É•µ…¥¹¥¹œ€ð€´À¸ÀÀÔ€ü€µ•¡È…ÕÍ••‰•¸…±Ì¥¹…¹œœ€è€!…ÕÍ¡…±ÑÍ¹…¡Ý•¥Ìœ¤ì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€ÑÈ¹¥¹¹•É!Q50€ô€ñÑø‘íÉ•™Õ¹¹É••¥Ù•‘…Ñ”ñð€½¡¹”…ÑÕ´ôñ‘¥Ø±…ÍÌô‰Íµ…±°µÕÑ•ˆø‘íÉ•™Õ¹¹¹½Ñ”ñðMÑ•Õ•É©…¡È€‘íÉ•™Õ¹¹å•…Éõôð½‘¥Øøð½ÑøñÑø‘í•ÕÉ¼¡9Õµ‰•È¡É•™Õ¹¹…µ½Õ¹Ðñð€À¤¥ôð½ÑøñÑø‘í•ÕÉ¼¡ÍÁ•¹Ð¥ôð½ÑøñÑ±…ÍÌôˆ‘íÉ•µ…¥¹¥¹œ€ð€´À¸ÀÀÔ€ü€‘…¹•ÈµÑ•áÐœ€è€ÍÕ•ÍÌµÑ•áÐôˆø‘í•ÕÉ¼¡É•µ…¥¹¥¹œ¥ôð½ÑøñÑø‘í•ÕÉ¼¡‰½Õ¹¥ôð½ÑøñÑø‘í¡¥¹Ñôð½Ñù€ì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€ô¤ì(€€€€€½¹ÍÐÑ½Ñ…°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€Ñ½Ñ…°¹¥¹¹•É!Q50€ô€ñÑøñÍÑÉ½¹œùMÕµµ”€‘íå•…Éôð½ÍÑÉ½¹œøð½ÑøñÑøñÍÑÉ½¹œø‘í•ÕÉ¼¡ÍÕµµ…Éä¹É••¥Ù•¥ôð½ÍÑÉ½¹œøð½ÑøñÑøñÍÑÉ½¹œø‘í•ÕÉ¼¡ÍÕµµ…Éä¹ÍÁ•¹Ð¥ôð½ÍÑÉ½¹œøð½ÑøñÑøñÍÑÉ½¹œø‘í•ÕÉ¼¡ÍÕµµ…Éä¹É•µ…¥¹¥¹œ¥ôð½ÍÑÉ½¹œøð½ÑøñÑøñÍÑÉ½¹œø‘í•ÕÉ¼¡ÍÕµµ…Éä¹‰½Õ¹‘I•µ…¥¹¥¹œ¥ôð½ÍÑÉ½¹œøð½ÑøñÑø‘íÍÕµµ…Éä¹‰½Õ¹‘I•µ…¥¹¥¹œ€ø€À¸ÀÀÔ€ü€I•ÍÐ‰±•¥‰Ð•‰Õ¹‘•¸œ€è€­•¥¸•‰Õ¹‘•¹•ÈI•ÍÐôð½Ñù€ì(€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡Ñ½Ñ…°¤ì(€€€ô(€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ì(€€€É•ÑÕÉ¸…Éì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝQ…áI•™Õ¹‘‘¥Ñ½È¡É•™Õ¹¤ì(€€€¹½Éµ…±¥é•±±Q…áI•™Õ¹‘Ì ¤ì(€€€½¹ÍÐ¥Í9•Ü€ô€…É•™Õ¹ì(€€€½¹ÍÐ¥Ñ•´€ôÉ•™Õ¹ñðì¥è•¹•É…Ñ•% ¤°å•…ÈèMÑÉ¥¹œ¡¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤¤°…µ½Õ¹Ðè€À°É••¥Ù•‘…Ñ”è€œœ°¹½Ñ”è€œœ°ÁÕÉ¡…Í•Ìèmtôì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì((€€€½¹ÍÐÉ½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐå•…É%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€å•…É%¹ÁÕÐ¹ÑåÁ”€ô€¹Õµ‰•Èœì(€€€å•…É%¹ÁÕÐ¹ÍÑ•À€ô€œÄœì(€€€å•…É%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹å•…ÈñðMÑÉ¥¹œ¡¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤¤ì(€€€½¹ÍÐ…µ½Õ¹Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”€ô™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡¥Ñ•´¹…µ½Õ¹Ð¤ì(€€€½¹ÍÐ‘…Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€‘…Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€‘…Ñ”œì(€€€‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹É••¥Ù•‘…Ñ”ñð€œœì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ )…¡Èœ°å•…É%¹ÁÕÐ¤¤ì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ É¡…±Ñ•¹”ÉÍÑ…ÑÑÕ¹œœ°…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ¥¹…¹œ…´œ°‘…Ñ•%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì((€€€½¹ÍÐ¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ•áÑ…É•„œ¤ì(€€€¹½Ñ•%¹ÁÕÐ¹É½ÝÌ€ô€Ìì(€€€¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹½Ñ”ñð€œœì(€€€¹½Ñ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸MÑ•Õ•È€ÈÀÈÔ°I•ÍÐ‰±•¥‰Ð•‰Õ¹‘•¸€¸¸¸œì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥èœ°¹½Ñ•%¹ÁÕÐ¤¤ì((€€€Í¡½Ý5½‘…°¡¥Í9•Ü€ü€MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œ•¥¹ÑÉ…•¸œ€è€MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œ‰•…É‰•¥Ñ•¸œ°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤ô°(€€€€€ì(€€€€€€€±…‰•°è€MÁ•¥¡•É¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐå•…È€ô9Õµ‰•È¡å•…É%¹ÁÕÐ¹Ù…±Õ”ñð€À¤ì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡å•…È¤ñðå•…È€ð€ÈÀÀÀñðå•…È€ø€ÈÄÀÀ¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¸Ÿñ±Ñ¥•Ì)…¡È•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸	•ÑÉ…œ•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥Ñ•´¹å•…È€ôMÑÉ¥¹œ¡5…Ñ ¹ÑÉÕ¹Œ¡å•…È¤¤ì(€€€€€€€€€¥Ñ•´¹…µ½Õ¹Ð€ô…µ½Õ¹Ðì(€€€€€€€€€¥Ñ•´¹É••¥Ù•‘…Ñ”€ô‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”ñð€œœì(€€€€€€€€€¥Ñ•´¹¹½Ñ”€ô¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”ñð€œœì(€€€€€€€€€¥˜€¡¥Í9•Ü¤ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì¹ÁÕÍ ¡¥Ñ•´¤ì(€€€€€€€€€Í•±•Ñ•‘Q…áI•™Õ¹‘e•…È€ô¥Ñ•´¹å•…Èì(€€€€€€€€€¹½Éµ…±¥é•±±Q…áI•™Õ¹‘Ì ¤ì(€€€€€€€€€…‘‘¡…¹•1½œ MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œœ°€‘í¥Í9•Ü€ü€ÉÍÑ…ÑÑÕ¹œ•¥¹•ÑÉ…•¸œ€è€ÉÍÑ…ÑÑÕ¹œ—‘¹‘•ÉÐôè€‘í¥Ñ•´¹å•…Éô€¼€‘í•ÕÉ¼¡…µ½Õ¹Ð¥õ€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝQ…áAÕÉ¡…Í•‘¥Ñ½È¡É•™Õ¹°ÁÕÉ¡…Í”¤ì(€€€¹½Éµ…±¥é•Q…áI•™Õ¹¡É•™Õ¹¤ì(€€€½¹ÍÐ¥Í9•Ü€ô€…ÁÕÉ¡…Í”ì(€€€½¹ÍÐ¥Ñ•´€ôÁÕÉ¡…Í”ñðì¥è•¹•É…Ñ•% ¤°¹…µ”è€œœ°…µ½Õ¹Ðè€À°‘…Ñ”è€œœ°¹½Ñ”è€œœôì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì((€€€½¹ÍÐÉ½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€½¹ÍÐ¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¹…µ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€¹…µ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹…µ”ñð€œœì(€€€¹…µ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€è¸¸¹•Õ”I•¥™•¸°]…Í¡µ…Í¡¥¹”°M¡Õ±‘•¹é…¡±Õ¹œ€¸¸¸œì(€€€½¹ÍÐ…µ½Õ¹Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”€ô™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡¥Ñ•´¹…µ½Õ¹Ð¤ì(€€€½¹ÍÐ‘…Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€‘…Ñ•%¹ÁÕÐ¹ÑåÁ”€ô€‘…Ñ”œì(€€€‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹‘…Ñ”ñð€œœì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ •­…Õ™Ð€¼‰•é…¡±Ðœ°¹…µ•%¹ÁÕÐ¤¤ì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 	•ÑÉ…œœ°…µ½Õ¹Ñ%¹ÁÕÐ¤¤ì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ …ÑÕ´œ°‘…Ñ•%¹ÁÕÐ¤¤ì(€€€½¹ÍÐÁ…åµ•¹Ñ5•Ñ¡½‘M•±•Ð€ôÉ•…Ñ•!½ÕÍ•¡½±‘A…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¡¥Í9•Ü€ü€ÑÉ…¹Í™•Èœ€è€¡¥Ñ•´¹Á…åµ•¹Ñ5•Ñ¡½ñð€œœ¤¤ì(€€€É½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ i…¡±Õ¹ÍÝ•œœ°Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É½Ü¤ì((€€€½¹ÍÐ¹½Ñ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ•áÑ…É•„œ¤ì(€€€¹½Ñ•%¹ÁÕÐ¹É½ÝÌ€ô€Ìì(€€€¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”€ô¥Ñ•´¹¹½Ñ”ñð€œœì(€€€¹½Ñ•%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€½ÁÑ¥½¹…°èÝ…ÉÕ´•­…Õ™Ð°I•¡¹Õ¹œ°!¥¹Ý•¥Ì€¸¸¸œì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Ñ¥èœ°¹½Ñ•%¹ÁÕÐ¤¤ì((€€€Í¡½Ý5½‘…°¡¥Í9•Ü€ü€-…Õ˜…ÕÌMÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œ•¥¹ÑÉ…•¸œ€è€-…Õ˜‰•…É‰•¥Ñ•¸œ°½¹Ñ•¹Ð°l(€€€€€ì±…‰•°è€‰‰É•¡•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤ô°(€€€€€ì(€€€€€€€±…‰•°è€MÁ•¥¡•É¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ¹…µ”€ô¹…µ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡…µ½Õ¹Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ …¹…µ”¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹”	•é•¥¡¹Õ¹œ•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸	•ÑÉ…œ•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥Ñ•´¹¹…µ”€ô¹…µ”ì(€€€€€€€€€¥Ñ•´¹…µ½Õ¹Ð€ô…µ½Õ¹Ðì(€€€€€€€€€¥Ñ•´¹‘…Ñ”€ô‘…Ñ•%¹ÁÕÐ¹Ù…±Õ”ñð€œœì(€€€€€€€€€¥Ñ•´¹¹½Ñ”€ô¹½Ñ•%¹ÁÕÐ¹Ù…±Õ”ñð€œœì(€€€€€€€€€¥Ñ•´¹Á…åµ•¹Ñ5•Ñ¡½€ô¹½Éµ…±¥é•!½ÕÍ•¡½±‘A…åµ•¹Ñ5•Ñ¡½¡Á…åµ•¹Ñ5•Ñ¡½‘M•±•Ð¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€¡¥Í9•Ü¤É•™Õ¹¹ÁÕÉ¡…Í•Ì¹ÁÕÍ ¡¥Ñ•´¤ì(€€€€€€€€€¹½Éµ…±¥é•±±Q…áI•™Õ¹‘Ì ¤ì(€€€€€€€€€…‘‘¡…¹•1½œ MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œœ°€‘í¥Í9•Ü€ü€-…Õ˜•¥¹•ÑÉ…•¸œ€è€-…Õ˜—‘¹‘•ÉÐôè€‘í¹…µ•ô€¼€‘í•ÕÉ¼¡…µ½Õ¹Ð¥ôƒŠL…±ÌY•ÉÝ•¹‘Õ¹œ‘½­Õµ•¹Ñ¥•ÉÑ€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉQ…áI•™Õ¹ ¤ì(€€€¹½Éµ…±¥é•±±Q…áI•™Õ¹‘Ì ¤ì(€€€Ñ…áI•™Õ¹‘M•Ñ¥½¸¹¥¹¹•É!Q50€ô€œœì(€€€½¹ÍÐ¡•…‘•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•…‘•È¹±…ÍÍ9…µ”€ô€Í•Ñ¥½¸µ¡•…‘¥¹œœì(€€€½¹ÍÐÑ¥Ñ±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Èœ¤ì(€€€Ñ¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ô€MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œœì(€€€½¹ÍÐÍÕˆ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€ÍÕˆ¹Ñ•áÑ½¹Ñ•¹Ð€ô€!¥•ÈÑË‘ÍÐ‘Ô•¥¸°Ý…Ì¥¡ÈÁÉ¼)…¡ÈÙ½´¥¹…¹é…µÐ•É¡…±Ñ•¸¡…‰ÐÕ¹Ý½›ñÈ¥¡È‘…Ì•±Ù•ÉÝ•¹‘•Ð¡…‰Ð¸œì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡Ñ¥Ñ±”¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡ÍÕˆ¤ì(€€€Ñ…áI•™Õ¹‘M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡¡•…‘•È¤ì((€€€½¹ÍÐå•…ÉÌ€ôÉÉ…ä¹™É½´¡¹•ÜM•Ð ¡ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ìñðmt¤¹µ…À ¡È¤€ôøMÑÉ¥¹œ¡È¹å•…È¤¤¤¤ì(€€€¥˜€ …å•…ÉÌ¹±•¹Ñ ¤å•…ÉÌ¹ÁÕÍ ¡MÑÉ¥¹œ¡¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤¤¤ì(€€€å•…ÉÌ¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹±½…±•½µÁ…É”¡„¤¤ì(€€€¥˜€ …å•…ÉÌ¹¥¹±Õ‘•Ì¡Í•±•Ñ•‘Q…áI•™Õ¹‘e•…È¤¤Í•±•Ñ•‘Q…áI•™Õ¹‘e•…È€ôå•…ÉÍlÁtì((€€€½¹ÍÐÍÕµµ…Éå¥±Ñ•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€ÍÕµµ…Éå¥±Ñ•È¹±…ÍÍ9…µ”€ô€™¥±Ñ•Èµ‰…ÈÑ…àµÉ•™Õ¹µå•…Èµ™¥±Ñ•Èœì(€€€½¹ÍÐå•…ÉM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€å•…ÉM•±•Ð¹Í•ÑÑÑÉ¥‰ÕÑ” …É¥„µ±…‰•°œ°€MÑ•Õ•É©…¡È›ñÈMÕµµ•¸…ÕÍß‘¡±•¸œ¤ì(€€€å•…ÉÌ¹™½É…  ¡å•…È¤€ôøì(€€€€€½¹ÍÐ½ÁÑ¥½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€½ÁÑ¥½¸¹Ù…±Õ”€ôå•…Èì(€€€€€½ÁÑ¥½¸¹Ñ•áÑ½¹Ñ•¹Ð€ôMÑ•Õ•É©…¡È€‘íå•…Éõ€ì(€€€€€¥˜€¡å•…È€ôôôÍ•±•Ñ•‘Q…áI•™Õ¹‘e•…È¤½ÁÑ¥½¸¹Í•±•Ñ•€ôÑÉÕ”ì(€€€€€å•…ÉM•±•Ð¹…ÁÁ•¹‘¡¥±¡½ÁÑ¥½¸¤ì(€€€ô¤ì(€€€å•…ÉM•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€Í•±•Ñ•‘Q…áI•™Õ¹‘e•…È€ôå•…ÉM•±•Ð¹Ù…±Õ”ì(€€€€€É•¹‘•È ¤ì(€€€ô¤ì(€€€½¹ÍÐ™¥±Ñ•É!¥¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÁ…¸œ¤ì(€€€™¥±Ñ•É!¥¹Ð¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€™¥±Ñ•É!¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô€MÕµµ•¸›ñÈ‘¥•Í•ÌMÑ•Õ•É©…¡È…¹é•¥•¸œì(€€€ÍÕµµ…Éå¥±Ñ•È¹…ÁÁ•¹‘¡¥±¡å•…ÉM•±•Ð¤ì(€€€ÍÕµµ…Éå¥±Ñ•È¹…ÁÁ•¹‘¡¥±¡™¥±Ñ•É!¥¹Ð¤ì(€€€Ñ…áI•™Õ¹‘M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡ÍÕµµ…Éå¥±Ñ•È¤ì((€€€½¹ÍÐÍÕµµ…Éä€ô•ÑQ…áI•™Õ¹‘MÕµµ…Éä¡Í•±•Ñ•‘Q…áI•™Õ¹‘e•…È¤ì(€€€Ñ…áI•™Õ¹‘M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°èÉ¡…±Ñ•¸€‘íÍ•±•Ñ•‘Q…áI•™Õ¹‘e•…Éõ€°Ù…±Õ”è•ÕÉ¼¡ÍÕµµ…Éä¹É••¥Ù•¤°¡¥¹Ðè€MÕµµ”…±±•È•¥¹•ÑÉ…•¹•¸ÉÍÑ…ÑÑÕ¹•¸œô°(€€€€€ì±…‰•°è€…Ù½¸•­…Õ™Ð€¼‰•é…¡±Ðœ°Ù…±Õ”è•ÕÉ¼¡ÍÕµµ…Éä¹ÍÁ•¹Ð¤°¡¥¹Ðè€±±”•¥¹•ÑÉ…•¹•¸/‘Õ™”œô°(€€€€€ì±…‰•°è€I•ÍÐ•‰Õ¹‘•¸œ°Ù…±Õ”è•ÕÉ¼¡ÍÕµµ…Éä¹É•µ…¥¹¥¹œ¤°­¥¹èÍÕµµ…Éä¹É•µ…¥¹¥¹œ€ð€´À¸ÀÀÔ€ü€‘…¹•Èœ€è€ÍÕ•ÍÌœ°¡¥¹Ðè€ÉÍÑ…ÑÑÕ¹œµ¥¹ÕÌ/‘Õ™”œô°(€€€€€ì±…‰•°è€•‰Õ¹‘•¹•ÈI•ÍÐœ°Ù…±Õ”è•ÕÉ¼¡ÍÕµµ…Éä¹‰½Õ¹‘I•µ…¥¹¥¹œ¤°­¥¹èÍÕµµ…Éä¹‰½Õ¹‘I•µ…¥¹¥¹œ€ø€À¸ÀÀÔ€ü€Ý…É¹¥¹œœ€è€ÍÕ•ÍÌœ°¡¥¹Ðè€9•…Ñ¥Ù”¥¹é•±É•ÍÑ”Ý•É‘•¸¹¥¡Ð••¹•É•¡¹•Ðœô°(€€€€€ì±…‰•°è€/‘Õ™”œ°Ù…±Õ”è€‘íÍÕµµ…Éä¹ÁÕÉ¡…Í•Íõ€°¡¥¹Ðè…ÕÌ€‘íÍÕµµ…Éä¹É•™Õ¹‘Ì¹±•¹Ñ¡ôÉÍÑ…ÑÑÕ¹œ¡•¸¥€ô(€€€t¤¤ì(€€€½¹ÍÐÍÕÍÁ¥¥½ÕÍI•™Õ¹‘Ì€ô•ÑQ…áI•™Õ¹‘MÕÍÁ¥¥½ÕÍ¹ÑÉ¥•Ì¡Í•±•Ñ•‘Q…áI•™Õ¹‘e•…È¤ì(€€€¥˜€¡ÍÕÍÁ¥¥½ÕÍI•™Õ¹‘Ì¹±•¹Ñ ¤ì(€€€€€½¹ÍÐÝ…É¸€ôÉ•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”Ý…É¹¥¹œÑ…àµÉ•™Õ¹µÝ…É¹¥¹œœ¤ì(€€€€€Ý…É¸¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÑÉ½¹œœ°€œœ°€MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œÁËñ™•¸œ¤¤ì(€€€€€½¹ÍÐ±¥ÍÐ€ôÉ•…Ñ•U¥° Õ°œ¤ì(€€€€€ÍÕÍÁ¥¥½ÕÍI•™Õ¹‘Ì¹™½É…  ¡•¹ÑÉä¤€ôøì(€€€€€€€½¹ÍÐ±¤€ôÉ•…Ñ•U¥° ±¤œ°€œœ°€‘í•ÕÉ¼¡•¹ÑÉä¹…µ½Õ¹Ð¥ôÍÑ•¡Ð…±Ì•¥•¹”ÉÍÑ…ÑÑÕ¹œ½¡¹”/‘Õ™”‘É¥¸Õ¹‘•ÉÍ•±‰”	•ÑÉ…œ­½µµÐ…±Ì-…Õ˜ƒŠx‘í•¹ÑÉä¹µ…Ñ¡¥¹AÕÉ¡…Í”¹¹…µ”ñð€½¡¹”9…µ•¸÷ŠpÙ½È¸]•¹¸‘…Ì­•¥¸•¡Ñ•ÈéÝ•¥Ñ•È¥¹…¹œÝ…È°³ÙÍ¡”½‘•È‰•…É‰•¥Ñ”‘¥”­±•¥¹”ÉÍÑ…ÑÑÕ¹œ¹€¤ì(€€€€€€€±¥ÍÐ¹…ÁÁ•¹‘¡¥±¡±¤¤ì(€€€€€ô¤ì(€€€€€Ý…É¸¹…ÁÁ•¹‘¡¥±¡±¥ÍÐ¤ì(€€€€€Ñ…áI•™Õ¹‘M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡Ý…É¸¤ì(€€€ô(€€€Ñ…áI•™Õ¹‘M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡É•¹‘•ÉQ…áI•™Õ¹‘½¹ÑÉ½±…É¡ÍÕµµ…Éä°Í•±•Ñ•‘Q…áI•™Õ¹‘e•…È¤¤ì(€€€Ñ…áI•™Õ¹‘M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡É•¹‘•ÉQ…áI•™Õ¹‘A½Ñ…É ¤¤ì((€€€½¹ÍÐ…Ñ¥½¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…Ñ¥½¹Ì¹±…ÍÍ9…µ”€ô€…Ñ¥½¸µ‰…Èœì(€€€½¹ÍÐ…‘‘	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€…‘‘	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€…‘‘	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ¬MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œ•¥¹ÑÉ…•¸œì(€€€…‘‘	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝQ…áI•™Õ¹‘‘¥Ñ½È¡¹Õ±°¤¤ì(€€€…Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡…‘‘	Ñ¸¤ì(€€€Ñ…áI•™Õ¹‘M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹Ì¤ì((€€€¥˜€ …ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì¹±•¹Ñ ¤ì(€€€€€½¹ÍÐ•µÁÑä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€•µÁÑä¹±…ÍÍ9…µ”€ô€…Éœì(€€€€€•µÁÑä¹¥¹¹•É!Q50€ô€œñ Ìù9½ ­•¥¹”MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œ•¥¹•ÑÉ…•¸ð½ ÌøñÀ±…ÍÌô‰Íµ…±°µÕÑ•ˆùM½‰…±¥¡È•¥¹”ÉÍÑ…ÑÑÕ¹œ‰•­½µµÐ°­…¹¹ÍÐ‘ÔÍ¥”¡¥•È•É™…ÍÍ•¸Õ¹‘…¹… ‘¥”/‘Õ™”‘…É…ÕÌ‘½­Õµ•¹Ñ¥•É•¸¸ð½Àøœì(€€€€€Ñ…áI•™Õ¹‘M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡•µÁÑä¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì¹™½É…  ¡É•™Õ¹¤€ôøì(€€€€€¹½Éµ…±¥é•Q…áI•™Õ¹¡É•™Õ¹¤ì(€€€€€½¹ÍÐÍÁ•¹Ð€ôÉ•™Õ¹¹ÁÕÉ¡…Í•Ì¹É•‘Õ” ¡ÍÕ´°À¤€ôøÍÕ´€¬9Õµ‰•È¡À¹…µ½Õ¹Ðñð€À¤°€À¤ì(€€€€€½¹ÍÐÉ•µ…¥¹¥¹œ€ô9Õµ‰•È¡É•™Õ¹¹…µ½Õ¹Ðñð€À¤€´ÍÁ•¹Ðì(€€€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€…É¹±…ÍÍ9…µ”€ô€…ÉÑ…àµÉ•™Õ¹µ…Éœì(€€€€€½¹ÍÐÑ½À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€Ñ½À¹±…ÍÍ9…µ”€ô€…Éµ¡•…‘•ÈµÉ½Üœì(€€€€€½¹ÍÐ €ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Ìœ¤ì(€€€€€ ¹Ñ•áÑ½¹Ñ•¹Ð€ôMÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œ€‘íÉ•™Õ¹¹å•…Éõ€ì(€€€€€½¹ÍÐ‰Ñ¹Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€‰Ñ¹Ì¹±…ÍÍ9…µ”€ô€‰ÕÑÑ½¸µÉ½Üœì(€€€€€½¹ÍÐ‰Õå	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€‰Õå	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€œ¬-…Õ˜œì(€€€€€‰Õå	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€€€‰Õå	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝQ…áAÕÉ¡…Í•‘¥Ñ½È¡É•™Õ¹°¹Õ±°¤¤ì(€€€€€½¹ÍÐ•‘¥Ñ	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€•‘¥Ñ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€	•…É‰•¥Ñ•¸œì(€€€€€•‘¥Ñ	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€€€•‘¥Ñ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝQ…áI•™Õ¹‘‘¥Ñ½È¡É•™Õ¹¤¤ì(€€€€€½¹ÍÐ‘•±	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€‘•±	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€3ÙÍ¡•¸œì(€€€€€‘•±	Ñ¸¹±…ÍÍ9…µ”€ô€‘…¹•Èœì(€€€€€‘•±	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€¥˜€¡½¹™¥É´ MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œµ¥Ð…±±•¸/‘Õ™•¸³ÙÍ¡•¸üœ¤¤ì(€€€€€€€€€É•µ½Ù•Q…áI•™Õ¹‘½Õ¹Ñ	½½­¥¹œ¡É•™Õ¹¤ì(€€€€€€€€€ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì€ôÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì¹™¥±Ñ•È ¡à¤€ôøà¹¥€„ôôÉ•™Õ¹¹¥¤ì(€€€€€€€€€…‘‘¡…¹•1½œ MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œœ°ÉÍÑ…ÑÑÕ¹œ€‘íÉ•™Õ¹¹å•…Éô•³ÙÍ¡Ñ€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô¤ì(€€€€€‰Ñ¹Ì¹…ÁÁ•¹‘¡¥±¡É•…Ñ•Ñ¥½¹5•¹Ô¡l(€€€€€€€ì±…‰•°è€œ¬-…Õ˜œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½ÝQ…áAÕÉ¡…Í•‘¥Ñ½È¡É•™Õ¹°¹Õ±°¤ô°(€€€€€€€ì±…‰•°è€	•…É‰•¥Ñ•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½ÝQ…áI•™Õ¹‘‘¥Ñ½È¡É•™Õ¹¤ô°(€€€€€€€ì±…‰•°è€3ÙÍ¡•¸œ°±…ÍÍ9…µ”è€‘…¹•Èœ°½¹±¥¬è€ ¤€ôøì¥˜€¡½¹™¥É´ MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œµ¥Ð…±±•¸/‘Õ™•¸³ÙÍ¡•¸üœ¤¤ìÉ•µ½Ù•Q…áI•™Õ¹‘½Õ¹Ñ	½½­¥¹œ¡É•™Õ¹¤ìÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì€ôÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì¹™¥±Ñ•È ¡à¤€ôøà¹¥€„ôôÉ•™Õ¹¹¥¤ì…‘‘¡…¹•1½œ MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œœ°ÉÍÑ…ÑÑÕ¹œ€‘íÉ•™Õ¹¹å•…Éô•³ÙÍ¡Ñ€°ÕÉÉ•¹Ñ5½¹Ñ ¤ìÍ…Ù•MÑ…Ñ” ¤ìÉ•¹‘•È ¤ìôôô(€€€€€t¤¤ì(€€€€€Ñ½À¹…ÁÁ•¹‘¡¥±¡ ¤ìÑ½À¹…ÁÁ•¹‘¡¥±¡‰Ñ¹Ì¤ì…É¹…ÁÁ•¹‘¡¥±¡Ñ½À¤ì(€€€€€…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€€€ì±…‰•°è€É¡…±Ñ•¸œ°Ù…±Õ”è•ÕÉ¼¡9Õµ‰•È¡É•™Õ¹¹…µ½Õ¹Ðñð€À¤¤°¡¥¹ÐèÉ•™Õ¹¹É••¥Ù•‘…Ñ”€ü¥¹…¹œè€‘íÉ•™Õ¹¹É••¥Ù•‘…Ñ•õ€€è€¥¹…¹œ¹¥¡Ð•Í•ÑéÐœô°(€€€€€€€ì±…‰•°è€ÕÍ••‰•¸œ°Ù…±Õ”è•ÕÉ¼¡ÍÁ•¹Ð¤°¡¥¹Ðè€‘íÉ•™Õ¹¹ÁÕÉ¡…Í•Ì¹±•¹Ñ¡ô-…Õ˜½/‘Õ™”ƒ
ÜÉ•‘Õé¥•É•¸¹ÕÈ‘•¸•‰Õ¹‘•¹•¸I•ÍÑ€ô°(€€€€€€€ì±…‰•°è€I•ÍÐ•‰Õ¹‘•¸œ°Ù…±Õ”è•ÕÉ¼¡É•µ…¥¹¥¹œ¤°­¥¹èÉ•µ…¥¹¥¹œ€ð€´À¸ÀÀÔ€ü€‘…¹•Èœ€è€ÍÕ•ÍÌœô(€€€€€t¤¤ì(€€€€€¥˜€¡É•™Õ¹¹¹½Ñ”¤ì(€€€€€€€½¹ÍÐ¹½Ñ”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì¹½Ñ”¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì¹½Ñ”¹Ñ•áÑ½¹Ñ•¹Ð€ôÉ•™Õ¹¹¹½Ñ”ì…É¹…ÁÁ•¹‘¡¥±¡¹½Ñ”¤ì(€€€€€ô(€€€€€½¹ÍÐÑ…‰±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ…‰±”œ¤ì(€€€€€Ñ…‰±”¹±…ÍÍ9…µ”€ô€±¥ÍÐµÑ…‰±”œì(€€€€€Ñ…‰±”¹¥¹¹•É!Q50€ô€œñÑ¡•…øñÑÈøñÑ ù…ÑÕ´ƒ
Ü¹•Õ•ÍÑ”éÕ•ÉÍÐð½Ñ øñÑ ù•­…Õ™Ð€¼‰•é…¡±Ðð½Ñ øñÑ ù	•ÑÉ…œð½Ñ øñÑ ùi…¡±Õ¹ÍÝ•œð½Ñ øñÑ ù9½Ñ¥èð½Ñ øñÑ ù­Ñ¥½¸ð½Ñ øð½ÑÈøð½Ñ¡•…øœì(€€€€€½¹ÍÐÑ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñ‰½‘äœ¤ì(€€€€€¥˜€ …É•™Õ¹¹ÁÕÉ¡…Í•Ì¹±•¹Ñ ¤ì(€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€ÑÈ¹¥¹¹•É!Q50€ô€œñÑ½±ÍÁ…¸ôˆØˆ±…ÍÌô‰µÕÑ•ˆù9½ ­•¥¹”/‘Õ™”•¥¹•ÑÉ…•¸¸ð½Ñøœì(€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€ô•±Í”ì(€€€€€€€É•™Õ¹¹ÁÕÉ¡…Í•Ì¹™½É…  ¡ÁÕÉ¡…Í”¤€ôøì(€€€€€€€€€½¹ÍÐÑÈ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÑÈœ¤ì(€€€€€€€€€½¹ÍÐ‘…Ñ•Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì‘…Ñ•Q¹Ñ•áÑ½¹Ñ•¹Ð€ôÁÕÉ¡…Í”¹‘…Ñ”ñð€ŸŠPœì(€€€€€€€€€½¹ÍÐ¹…µ•Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì¹…µ•Q¹Ñ•áÑ½¹Ñ•¹Ð€ôÁÕÉ¡…Í”¹¹…µ”ñð€ŸŠPœì(€€€€€€€€€½¹ÍÐ…µ½Õ¹ÑQ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì…µ½Õ¹ÑQ¹Ñ•áÑ½¹Ñ•¹Ð€ô•ÕÉ¼¡9Õµ‰•È¡ÁÕÉ¡…Í”¹…µ½Õ¹Ðñð€À¤¤ì(€€€€€€€€€½¹ÍÐÁ…åµ•¹ÑQ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ìÁ…åµ•¹ÑQ¹Ñ•áÑ½¹Ñ•¹Ð€ô•Ñ!½ÕÍ•¡½±‘A…åµ•¹Ñ5•Ñ¡½‘1…‰•°¡ÁÕÉ¡…Í”¹Á…åµ•¹Ñ5•Ñ¡½¤ì(€€€€€€€€€½¹ÍÐ¹½Ñ•Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì¹½Ñ•Q¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘íÁÕÉ¡…Í”¹¹½Ñ”ñð€œô‘íÁÕÉ¡…Í”¹ÑÉ…¹Í…Ñ¥½¹%€ü€¡ÁÕÉ¡…Í”¹¹½Ñ”€ü€œƒ
Ü€œ€è€œœ¤€¬€!¥ÍÑ½É¥•¹¹…¡Ý•¥ÌÙ½É¡…¹‘•¸œ€è€œõ€ì(€€€€€€€€€½¹ÍÐ…Ñ¥½¹Q€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Ñœ¤ì(€€€€€€€€€½¹ÍÐ•‘¥ÑAÕÉ¡…Í”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì•‘¥ÑAÕÉ¡…Í”¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì•‘¥ÑAÕÉ¡…Í”¹Ñ•áÑ½¹Ñ•¹Ð€ô€	•…É‰•¥Ñ•¸œì•‘¥ÑAÕÉ¡…Í”¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝQ…áAÕÉ¡…Í•‘¥Ñ½È¡É•™Õ¹°ÁÕÉ¡…Í”¤¤ì(€€€€€€€€€½¹ÍÐ‘•±•Ñ•AÕÉ¡…Í”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì‘•±•Ñ•AÕÉ¡…Í”¹±…ÍÍ9…µ”€ô€‘…¹•Èœì‘•±•Ñ•AÕÉ¡…Í”¹Ñ•áÑ½¹Ñ•¹Ð€ô€3ÙÍ¡•¸œì‘•±•Ñ•AÕÉ¡…Í”¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€€€€€¥˜€¡½¹™¥É´ -…Õ˜³ÙÍ¡•¸üœ¤¤ì(€€€€€€€€€€€€€É•µ½Ù•Q…áI•™Õ¹‘AÕÉ¡…Í•	½½­¥¹œ¡É•™Õ¹°ÁÕÉ¡…Í”¤ì(€€€€€€€€€€€€€É•™Õ¹¹ÁÕÉ¡…Í•Ì€ôÉ•™Õ¹¹ÁÕÉ¡…Í•Ì¹™¥±Ñ•È ¡à¤€ôøà¹¥€„ôôÁÕÉ¡…Í”¹¥¤ì(€€€€€€€€€€€€€¹½Éµ…±¥é•±±Q…áI•™Õ¹‘Ì ¤ì(€€€€€€€€€€€€€…‘‘¡…¹•1½œ MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œœ°-…Õ˜•³ÙÍ¡Ðè€‘íÁÕÉ¡…Í”¹¹…µ•õ€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ìÉ•¹‘•È ¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô¤ì(€€€€€€€€€…Ñ¥½¹Q¹…ÁÁ•¹‘¡¥±¡É•…Ñ•Ñ¥½¹5•¹Ô¡l(€€€€€€€€€€€ì±…‰•°è€iÔM½¹ÍÑ¥”ÕÍ…‰•¸Ù•ÉÍ¡¥•‰•¸œ°±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½ÝQ…áAÕÉ¡…Í•Q½	Õ™™•É5½‘…°¡É•™Õ¹°ÁÕÉ¡…Í”¤ô°(€€€€€€€€€€€ì±…‰•°è€	•…É‰•¥Ñ•¸œ°±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°½¹±¥¬è€ ¤€ôøÍ¡½ÝQ…áAÕÉ¡…Í•‘¥Ñ½È¡É•™Õ¹°ÁÕÉ¡…Í”¤ô°(€€€€€€€€€€€ì±…‰•°è€3ÙÍ¡•¸œ°±…ÍÍ9…µ”è€‘…¹•Èœ°½¹±¥¬è€ ¤€ôøì¥˜€¡½¹™¥É´ -…Õ˜³ÙÍ¡•¸üœ¤¤ìÉ•µ½Ù•Q…áI•™Õ¹‘AÕÉ¡…Í•	½½­¥¹œ¡É•™Õ¹°ÁÕÉ¡…Í”¤ìÉ•™Õ¹¹ÁÕÉ¡…Í•Ì€ôÉ•™Õ¹¹ÁÕÉ¡…Í•Ì¹™¥±Ñ•È ¡à¤€ôøà¹¥€„ôôÁÕÉ¡…Í”¹¥¤ì¹½Éµ…±¥é•±±Q…áI•™Õ¹‘Ì ¤ì…‘‘¡…¹•1½œ MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œœ°-…Õ˜•³ÙÍ¡Ðè€‘íÁÕÉ¡…Í”¹¹…µ•õ€°ÕÉÉ•¹Ñ5½¹Ñ ¤ìÍ…Ù•MÑ…Ñ” ¤ìÉ•¹‘•È ¤ìôôô(€€€€€€€€€t¤¤ì(€€€€€€€€€ÑÈ¹…ÁÁ•¹‘¡¥±¡‘…Ñ•Q¤ìÑÈ¹…ÁÁ•¹‘¡¥±¡¹…µ•Q¤ìÑÈ¹…ÁÁ•¹‘¡¥±¡…µ½Õ¹ÑQ¤ìÑÈ¹…ÁÁ•¹‘¡¥±¡Á…åµ•¹ÑQ¤ìÑÈ¹…ÁÁ•¹‘¡¥±¡¹½Ñ•Q¤ìÑÈ¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹Q¤ì(€€€€€€€€€Ñ‰½‘ä¹…ÁÁ•¹‘¡¥±¡ÑÈ¤ì(€€€€€€€ô¤ì(€€€€€ô(€€€€€Ñ…‰±”¹…ÁÁ•¹‘¡¥±¡Ñ‰½‘ä¤ì…É¹…ÁÁ•¹‘¡¥±¡Ñ…‰±”¤ìÑ…áI•™Õ¹‘M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡…É¤ì(€€€ô¤ì(€ô(((€™Õ¹Ñ¥½¸•Ñ	É½ÝÍ•ÉMÑ½É…•%¹™¼ ¤ì(€€€ÑÉäì(€€€€€½¹ÍÐÑ•ÍÑ-•ä€ô€‰Õ‘•ÑMÑ…Ñ•MÑ½É…•Q•ÍÐœì(€€€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´¡Ñ•ÍÑ-•ä°€½¬œ¤ì(€€€€€±½…±MÑ½É…”¹É•µ½Ù•%Ñ•´¡Ñ•ÍÑ-•ä¤ì(€€€€€½¹ÍÐÍÑ…‰±”€ô±½…±MÑ½É…”¹•Ñ%Ñ•´ ‰Õ‘•ÑMÑ…Ñ•MÑ…‰±”œ¤ì(€€€€€½¹ÍÐ…ÕÑ¼€ô±½…±MÑ½É…”¹•Ñ%Ñ•´ ‰Õ‘•ÑMÑ…Ñ•ÕÑ½	…­ÕÀœ¤ì(€€€€€½¹ÍÐÕÉÉ•¹Ð€ô±½…±MÑ½É…”¹•Ñ%Ñ•´¡UII9Q}YIM%=9}MQ=I}-d¤ì(€€€€€½¹ÍÐ±…ÍÐ€ô±½…±MÑ½É…”¹•Ñ%Ñ•´ ‰Õ‘•ÑMÑ…Ñ•1…ÍÑM…Ù•‘Ðœ¤ñð€œœì(€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°ÍÑ…‰±”è€„…ÍÑ…‰±”°…ÕÑ¼è€„……ÕÑ¼°ÕÉÉ•¹Ðè€„…ÕÉÉ•¹Ð°±…ÍÐôì(€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ…‰±”è™…±Í”°…ÕÑ¼è™…±Í”°ÕÉÉ•¹Ðè™…±Í”°±…ÍÐè€œœ°•ÉÉ½Èè•ÉÈ€˜˜•ÉÈ¹µ•ÍÍ…”€ü•ÉÈ¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÈ¤ôì(€€€ô(€ô((€™Õ¹Ñ¥½¸É•¹‘•ÉM…Ù” ¤ì(€€€Í…Ù•M•Ñ¥½¸¹¥¹¹•É!Q50€ô€œœì(€€€½¹ÍÐ…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…É¹±…ÍÍ9…µ”€ô€…Éœì((€€€½¹ÍÐ È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Èœ¤ì(€€€ È¹Ñ•áÑ½¹Ñ•¹Ð€ô€M¥¡•É¸€˜]¥•‘•É¡•ÉÍÑ•±±•¸œì(€€€…É¹…ÁÁ•¹‘¡¥±¡ È¤ì((€€€½¹ÍÐ¥¹ÑÉ¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¥¹ÑÉ¼¹Ñ•áÑ½¹Ñ•¹Ð€ô€•¥¹”ƒ¹‘•ÉÕ¹•¸Ý•É‘•¸…ÕÑ½µ…Ñ¥Í ¥¸‘¥•Í•´	É½ÝÍ•È•ÍÁ•¥¡•ÉÐ¸1…‘”É••±·“}¥œ•¥¹”M¥¡•ÉÕ¹Í‘…Ñ•¤…Õ˜‘•¸A¡•ÉÕ¹Ñ•Èì‘¥•Í•±‰”…Ñ•¤­…¹¹ÍÐ‘Ô¡¥•ÈÍÃ‘Ñ•ÈÝ¥•‘•È•¥¹ÍÁ¥•±•¸¸œì(€€€…É¹…ÁÁ•¹‘¡¥±¡¥¹ÑÉ¼¤ì((€€€½¹ÍÐ…‘Ù…¹•‘•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€…‘Ù…¹•‘•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€½µÁ…Ðµ‘•Ñ…¥±Ì‰…­ÕÀµ…‘Ù…¹•µ‘•Ñ…¥±Ìœì(€€€½¹ÍÐ…‘Ù…¹•‘MÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€…‘Ù…¹•‘MÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ô€ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹•¸Õ¹ƒ‘±Ñ•É”MÓ‘¹‘”œì(€€€…‘Ù…¹•‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡…‘Ù…¹•‘MÕµµ…Éä¤ì(€€€½¹ÍÐ…‘Ù…¹•‘	½‘ä€ôÉ•…Ñ•U¥° ‘¥Øœ°€‰…­ÕÀµ…‘Ù…¹•µ‰½‘äœ¤ì(€€€…‘Ù…¹•‘•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡…‘Ù…¹•‘	½‘ä¤ì((€€€½¹ÍÐÍÑ½É…•%¹™¼€ô•Ñ	É½ÝÍ•ÉMÑ½É…•%¹™¼ ¤ì(€€€½¹ÍÐÍÑ½É…•9½Ñ¥”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€ÍÑ½É…•9½Ñ¥”¹±…ÍÍ9…µ”€ôÍÑ½É…•%¹™¼¹½¬€ü€¹½Ñ¥”ÍÕ•ÍÌœ€è€¹½Ñ¥”‘…¹•Èœì(€€€ÍÑ½É…•9½Ñ¥”¹¥¹¹•É!Q50€ôÍÑ½É…•%¹™¼¹½¬(€€€€€€ü€ñÍÑÉ½¹œù1…Õ™•¹‘•ÌMÁ•¥¡•É¸…­Ñ¥Øèð½ÍÑÉ½¹œøƒ¹‘•ÉÕ¹•¸Ý•É‘•¸Í½™½ÉÐ¥¸‘¥•Í•´	É½ÝÍ•È•Í¥¡•ÉÐÕ¹Ù½¸¹•Õ•¸Y•ÉÍ¥½¹•¸…ÕÑ½µ…Ñ¥Í ƒñ‰•É¹½µµ•¸¸‘íÍÑ½É…•%¹™¼¹±…ÍÐ€ü€œñ‰ÈøñÍÁ…¸±…ÍÌô‰Íµ…±°µÕÑ•ˆùiÕ±•ÑéÐ•ÍÁ•¥¡•ÉÐè€œ€¬¹•Ü…Ñ”¡ÍÑ½É…•%¹™¼¹±…ÍÐ¤¹Ñ½1½…±•MÑÉ¥¹œ ‘”µœ¤€¬€œð½ÍÁ…¸øœ€è€œõ€(€€€€€€è€ñÍÑÉ½¹œù	É½ÝÍ•ÈµMÁ•¥¡•È¹¥¡ÐÙ•É›ñ‰…Èèð½ÍÑÉ½¹œø•È	É½ÝÍ•È‰±½­¥•ÉÐ±½…±MÑ½É…”¸	¥ÑÑ”M¥¡•ÉÕ¹œ¡•ÉÕ¹Ñ•É±…‘•¸Õ¹	É½ÝÍ•È´½AÉ¥Ù…Ñµ½‘ÕÌÁËñ™•¸¹€ì(€€€…É¹…ÁÁ•¹‘¡¥±¡ÍÑ½É…•9½Ñ¥”¤ì((€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹¥¹±Õ‘•Á¥-•å%¹	…­ÕÀ€ôÑÉÕ”ì((€€€½¹ÍÐ…Á¥%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…Á¥%¹™¼¹±…ÍÍ9…µ”€ô€¹½Ñ¥”ÍÕ•ÍÌœì(€€€…Á¥%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ô€Y½±±ÍÓ‘¹‘¥”M¥¡•ÉÕ¹œè•ÈQ…¹¬µA$µ-•äÝ¥É¥¸‘•¸…ÕÑ½µ…Ñ¥Í¡•¸Õ¹¡•ÉÕ¹Ñ•É•±…‘•¹•¸M¥¡•ÉÕ¹•¸µ¥Ñ•Í¥¡•ÉÐ¸œì(€€€…‘Ù…¹•‘	½‘ä¹…ÁÁ•¹‘¡¥±¡…Á¥%¹™¼¤ì((€€€½¹ÍÐ…ÕÑ½µ…Ñ¥…É€ôÉ•…Ñ•U¥° ‘¥Øœ°€ÍÕˆµ…É…ÕÑ½µ…Ñ¥Œµ‰É½ÝÍ•Èµ‰…­ÕÀµ…Éœ¤ì(€€€½¹ÍÐ…ÕÑ½µ…Ñ¥!•…€ôÉ•…Ñ•U¥° ‘¥Øœ°€½µÁ…ÐµÍ•Ñ¥½¸µ¡•…œ¤ì(€€€…ÕÑ½µ…Ñ¥!•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€ÕÑ½µ…Ñ¥Í¡”	É½ÝÍ•ÈµM¥¡•ÉÕ¹œœ¤¤ì(€€€½¹ÍÐ…ÕÑ½µ…Ñ¥MÕÁÁ½ÉÑ•€ô€¥¹‘•á•‘œ¥¸Ý¥¹‘½Üì(€€€…ÕÑ½µ…Ñ¥!•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°…ÕÑ½µ…Ñ¥MÕÁÁ½ÉÑ•€ü€Á¥±°ÍÕ•ÍÌœ€è€Á¥±°‘…¹•Èœ°…ÕÑ½µ…Ñ¥MÕÁÁ½ÉÑ•€ü€­Ñ¥Øœ€è€9¥¡ÐÙ•É›ñ‰…Èœ¤¤ì(€€€…ÕÑ½µ…Ñ¥…É¹…ÁÁ•¹‘¡¥±¡…ÕÑ½µ…Ñ¥!•…¤ì((€€€½¹ÍÐ±…ÍÑÕÑ½µ…Ñ¥…Ñ”€ôÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐ€ü¹•Ü…Ñ”¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐ¤€è¹Õ±°ì(€€€½¹ÍÐ±…ÍÑÕÑ½µ…Ñ¥Y…±¥€ô±…ÍÑÕÑ½µ…Ñ¥…Ñ”€˜˜€…9Õµ‰•È¹¥Í9…8¡±…ÍÑÕÑ½µ…Ñ¥…Ñ”¹•ÑQ¥µ” ¤¤ì(€€€…ÕÑ½µ…Ñ¥…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€1•ÑéÑ”…ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹œœ°Ù…±Õ”è±…ÍÑÕÑ½µ…Ñ¥Y…±¥€ü±…ÍÑÕÑ½µ…Ñ¥…Ñ”¹Ñ½1½…±•MÑÉ¥¹œ ‘”µœ¤€è€Ý¥É•É…‘”…¹•±•Ðœ°­¥¹è±…ÍÑÕÑ½µ…Ñ¥Y…±¥€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€ì±…‰•°è€Õ™‰•Ý…¡ÉÕ¹œœ°Ù…±Õ”è	¥ÌéÔ€‘íUQ=5Q%}	I=]MI}	-UA}IQ9Q%=9ôM¥¡•ÉÕ¹•¹€°¡¥¹Ðè€Ÿ±Ñ•É”MÓ‘¹‘”Ý•É‘•¸…ÕÑ½µ…Ñ¥Í …Õ™•Ë‘ÕµÐ¸œô°(€€€€€ì±…‰•°è€MÁ•¥¡•É½ÉÐœ°Ù…±Õ”è€¥•Í•È	É½ÝÍ•È…Õ˜‘¥•Í•´Aœ°¡¥¹Ðè€Õ¹­Ñ¥½¹¥•ÉÐ…Õ ½¡¹”iÕÉ¥™˜…Õ˜•¥¹•¸Aµ=É‘¹•È¸œô(€€€t¤¤ì((€€€½¹ÍÐ…ÕÑ½µ…Ñ¥Ñ¥½¹Ì€ôÉ•…Ñ•U¥° ‘¥Øœ°€É½Ü…ÕÑ½µ…Ñ¥Œµ‰…­ÕÀµ…Ñ¥½¹Ìœ¤ì(€€€½¹ÍÐ…ÕÑ½µ…Ñ¥9½Ý	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€…ÕÑ½µ…Ñ¥9½Ý	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€…ÕÑ½µ…Ñ¥9½Ý	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€…ÕÑ½µ…Ñ¥9½Ý	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€)•ÑéÐ…ÕÑ½µ…Ñ¥Í Í¥¡•É¸œì(€€€…ÕÑ½µ…Ñ¥9½Ý	ÕÑÑ½¸¹‘¥Í…‰±•€ô€……ÕÑ½µ…Ñ¥MÕÁÁ½ÉÑ•ì(€€€…ÕÑ½µ…Ñ¥9½Ý	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€…ÕÑ½µ…Ñ¥9½Ý	ÕÑÑ½¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€…ÕÑ½µ…Ñ¥9½Ý	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€M¥¡•ÉÕ¹œ³‘Õ™ÐƒŠ˜œì(€€€€€ÑÉäì(€€€€€€€…Ý…¥ÐÉ•…Ñ•ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÀ¡ì™½É”èÑÉÕ”ô¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€€€…±•ÉÐ ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹œ¹¥¡Ð·Ù±¥ è€œ€¬€¡•ÉÈ€˜˜•ÉÈ¹µ•ÍÍ…”€ü•ÉÈ¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÈ¤¤¤ì(€€€€€€€…ÕÑ½µ…Ñ¥9½Ý	ÕÑÑ½¸¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€€€…ÕÑ½µ…Ñ¥9½Ý	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€)•ÑéÐ…ÕÑ½µ…Ñ¥Í Í¥¡•É¸œì(€€€€€ô(€€€ô¤ì(€€€…ÕÑ½µ…Ñ¥Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡…ÕÑ½µ…Ñ¥9½Ý	ÕÑÑ½¸¤ì(€€€…ÕÑ½µ…Ñ¥…É¹…ÁÁ•¹‘¡¥±¡…ÕÑ½µ…Ñ¥Ñ¥½¹Ì¤ì((€€€½¹ÍÐ…ÕÑ½µ…Ñ¥!¥ÍÑ½Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½Éä¹±…ÍÍ9…µ”€ô€…ÕÑ½µ…Ñ¥Œµ‰…­ÕÀµ¡¥ÍÑ½Éäœì(€€€½¹ÍÐ…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåMÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåMÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ëñ¡•É”…ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹œÝ¥•‘•É¡•ÉÍÑ•±±•¸œì(€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½Éä¹…ÁÁ•¹‘¡¥±¡…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåMÕµµ…Éä¤ì(€€€½¹ÍÐ…ÕÑ½µ…Ñ¥!¥ÍÑ½Éå%¹™¼€ôÉ•…Ñ•U¥° Àœ°€Íµ…±°µÕÑ•œ°€_‘¡±”•¥¹•¸MÑ…¹…ÕÌ¸Y½È‘•È]¥•‘•É¡•ÉÍÑ•±±Õ¹œÍ¥¡•ÉÐ‘¥”ÁÀ‘•¸©•Ñé¥•¸MÑ…¹¹½ •¥¹µ…°¸œ¤ì(€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½Éä¹…ÁÁ•¹‘¡¥±¡…ÕÑ½µ…Ñ¥!¥ÍÑ½Éå%¹™¼¤ì(€€€½¹ÍÐ…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåI½Ü€ôÉ•…Ñ•U¥° ‘¥Øœ°€É½Ü…ÕÑ½µ…Ñ¥Œµ‰…­ÕÀµ¡¥ÍÑ½ÉäµÉ½Üœ¤ì(€€€½¹ÍÐ…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹Í•ÑÑÑÉ¥‰ÕÑ” …É¥„µ±…‰•°œ°€ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹œ…ÕÍß‘¡±•¸œ¤ì(€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹…ÁÁ•¹‘¡¥±¡¹•Ü=ÁÑ¥½¸ M¥¡•ÉÕ¹•¸Ý•É‘•¸•±…‘•¸ƒŠ˜œ°€œœ¤¤ì(€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåI½Ü¹…ÁÁ•¹‘¡¥±¡…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¤ì(€€€½¹ÍÐ…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€ÕÍ•ß‘¡±Ñ•¸MÑ…¹±…‘•¸œì(€€€…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåI½Ü¹…ÁÁ•¹‘¡¥±¡…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸¤ì(€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½Éä¹…ÁÁ•¹‘¡¥±¡…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåI½Ü¤ì(€€€…ÕÑ½µ…Ñ¥…É¹…ÁÁ•¹‘¡¥±¡…ÕÑ½µ…Ñ¥!¥ÍÑ½Éä¤ì(€€€…‘Ù…¹•‘	½‘ä¹…ÁÁ•¹‘¡¥±¡…ÕÑ½µ…Ñ¥…É¤ì((€€€±•Ð…ÕÑ½µ…Ñ¥	…­ÕÁI½ÝÌ€ômtì(€€€¥˜€¡…ÕÑ½µ…Ñ¥MÕÁÁ½ÉÑ•¤ì(€€€€€±¥ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÌ ¤¹Ñ¡•¸ ¡É½ÝÌ¤€ôøì(€€€€€€€¥˜€ ……ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹¥Í½¹¹•Ñ•¤É•ÑÕÉ¸ì(€€€€€€€…ÕÑ½µ…Ñ¥	…­ÕÁI½ÝÌ€ôÉ½ÝÌì(€€€€€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹¥¹¹•É!Q50€ô€œœì(€€€€€€€¥˜€ …É½ÝÌ¹±•¹Ñ ¤ì(€€€€€€€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹…ÁÁ•¹‘¡¥±¡¹•Ü=ÁÑ¥½¸ 9½ ­•¥¹”M¥¡•ÉÕ¹œÙ½É¡…¹‘•¸œ°€œœ¤¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€É½ÝÌ¹™½É…  ¡•¹ÑÉä¤€ôøì(€€€€€€€€€½¹ÍÐÉ•…Ñ•€ô¹•Ü…Ñ”¡•¹ÑÉä¹É•…Ñ•‘Ð¤ì(€€€€€€€€€½¹ÍÐ‘…Ñ•1…‰•°€ô9Õµ‰•È¹¥Í9…8¡É•…Ñ•¹•ÑQ¥µ” ¤¤€üMÑÉ¥¹œ¡•¹ÑÉä¹É•…Ñ•‘Ðñð€œœ¤€èÉ•…Ñ•¹Ñ½1½…±•MÑÉ¥¹œ ‘”µœ¤ì(€€€€€€€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹…ÁÁ•¹‘¡¥±¡¹•Ü=ÁÑ¥½¸¡€‘í•¹ÑÉä¹±…‰•°ñð€ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹œôƒ
Ü€‘í‘…Ñ•1…‰•±õ€°•¹ÑÉä¹¥¤¤ì(€€€€€€€ô¤ì(€€€€€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€€€…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€ô¤¹…Ñ  ¡•ÉÈ¤€ôøì(€€€€€€€¥˜€ ……ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹¥Í½¹¹•Ñ•¤É•ÑÕÉ¸ì(€€€€€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹¥¹¹•É!Q50€ô€œœì(€€€€€€€…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹…ÁÁ•¹‘¡¥±¡¹•Ü=ÁÑ¥½¸ M¥¡•ÉÕ¹•¸­½¹¹Ñ•¸¹¥¡Ð•±…‘•¸Ý•É‘•¸œ°€œœ¤¤ì(€€€€€€€½¹Í½±”¹Ý…É¸ ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹•¸­½¹¹Ñ•¸¹¥¡Ð…¹•é•¥ÐÝ•É‘•¸œ°•ÉÈ¤ì(€€€€€ô¤ì(€€€ô((€€€…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€½¹ÍÐÍ•±•Ñ•€ô…ÕÑ½µ…Ñ¥	…­ÕÁI½ÝÌ¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹¥€ôôô…ÕÑ½µ…Ñ¥!¥ÍÑ½ÉåM•±•Ð¹Ù…±Õ”¤ì(€€€€€¥˜€ …Í•±•Ñ•ñð€…Í•±•Ñ•¹Á…å±½…¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐÉ•…Ñ•€ô¹•Ü…Ñ”¡Í•±•Ñ•¹É•…Ñ•‘Ð¤ì(€€€€€½¹ÍÐ‘…Ñ•1…‰•°€ô9Õµ‰•È¹¥Í9…8¡É•…Ñ•¹•ÑQ¥µ” ¤¤€ü€‘•´…ÕÍ•ß‘¡±Ñ•¸i•¥ÑÁÕ¹­Ðœ€èÉ•…Ñ•¹Ñ½1½…±•MÑÉ¥¹œ ‘”µœ¤ì(€€€€€¥˜€ …½¹™¥É´¡•¸!…ÕÍ¡…±ÑÍÁ±…¹•È…Õ˜‘•¸MÑ…¹Ù½´€‘í‘…Ñ•1…‰•±ôéÕËñ­Í•Ñé•¸ü•È©•Ñé¥”MÑ…¹Ý¥ÉÙ½É¡•È…ÕÑ½µ…Ñ¥Í •Í¥¡•ÉÐ¹€¤¤É•ÑÕÉ¸ì(€€€€€…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€MÑ…¹Ý¥É•±…‘•¸ƒŠ˜œì(€€€€€ÑÉäì(€€€€€€€½¹ÍÐÍ…™•ÑåQ¥µ•ÍÑ…µÀ€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€€€€€€€…Ý…¥ÐÉ•…Ñ•ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÀ¡ì(€€€€€€€€€™½É”èÑÉÕ”°(€€€€€€€€€¥èÙ½ÈµÝ¥•‘•É¡•ÉÍÑ•±±Õ¹œ´‘íÍ…™•ÑåQ¥µ•ÍÑ…µÁõ€°(€€€€€€€€€±…‰•°è€MÑ…¹Ù½È]¥•‘•É¡•ÉÍÑ•±±Õ¹œœ(€€€€€€€ô¤ì(€€€€€€€)M=8¹Á…ÉÍ”¡Í•±•Ñ•¹Á…å±½…¤ì(€€€€€€€ÝÉ¥Ñ•MÑ…Ñ•A…å±½…‘Q½MÑ½É…”¡Í•±•Ñ•¹Á…å±½…¤ì(€€€€€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ ‰Õ‘•ÑMÑ…Ñ•1…ÍÑM…Ù•‘Ðœ°¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¤ì(€€€€€€€Ý¥¹‘½Ü¹±½…Ñ¥½¸¹É•±½… ¤ì(€€€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€€€…±•ÉÐ ¥”…ÕÑ½µ…Ñ¥Í¡”M¥¡•ÉÕ¹œ­½¹¹Ñ”¹¥¡ÐÝ¥•‘•É¡•É•ÍÑ•±±ÐÝ•É‘•¸è€œ€¬€¡•ÉÈ€˜˜•ÉÈ¹µ•ÍÍ…”€ü•ÉÈ¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÈ¤¤¤ì(€€€€€€€…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€€€…ÕÑ½µ…Ñ¥I•ÍÑ½É•	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€ÕÍ•ß‘¡±Ñ•¸MÑ…¹±…‘•¸œì(€€€€€ô(€€€ô¤ì((€€€½¹ÍÐÍÕÁÁ½ÉÑÍáÑ•É¹…±½±‘•É	…­ÕÀ€ôÑåÁ•½˜Ý¥¹‘½Ü¹Í¡½Ý¥É•Ñ½ÉåA¥­•È€ôôô€™Õ¹Ñ¥½¸œì(€€€½¹ÍÐ•áÑ•É¹…±…É€ôÉ•…Ñ•U¥° ‘¥Øœ°€ÍÕˆµ…É•áÑ•É¹…°µ‰…­ÕÀµ…Éœ¤ì(€€€½¹ÍÐ•áÑ•É¹…±!•…€ôÉ•…Ñ•U¥° ‘¥Øœ°€½µÁ…ÐµÍ•Ñ¥½¸µ¡•…œ¤ì(€€€•áÑ•É¹…±!•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥°  Ìœ°€œœ°€ÕÑ½µ…Ñ¥Í¡”AµM¥¡•ÉÕ¹œœ¤¤ì(€€€½¹ÍÐ•áÑ•É¹…±I•…‘ä€ô€„…ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”ì(€€€•áÑ•É¹…±!•…¹…ÁÁ•¹‘¡¥±¡É•…Ñ•U¥° ÍÁ…¸œ°•áÑ•É¹…±I•…‘ä€ü€Á¥±°ÍÕ•ÍÌœ€è€Á¥±°Ý…É¹¥¹œœ°•áÑ•É¹…±I•…‘ä€ü€=É‘¹•ÈÙ•É‰Õ¹‘•¸œ€è€9½ •¥¹É¥¡Ñ•¸œ¤¤ì(€€€•áÑ•É¹…±…É¹…ÁÁ•¹‘¡¥±¡•áÑ•É¹…±!•…¤ì((€€€½¹ÍÐ±…ÍÑáÑ•É¹…±…Ñ”€ôÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑáÑ•É¹…±	…­ÕÁÐ€ü¹•Ü…Ñ”¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑáÑ•É¹…±	…­ÕÁÐ¤€è¹Õ±°ì(€€€½¹ÍÐ±…ÍÑáÑ•É¹…±1…‰•°€ô±…ÍÑáÑ•É¹…±…Ñ”€˜˜€…9Õµ‰•È¹¥Í9…8¡±…ÍÑáÑ•É¹…±…Ñ”¹•ÑQ¥µ” ¤¤(€€€€€€ü±…ÍÑáÑ•É¹…±…Ñ”¹Ñ½1½…±•MÑÉ¥¹œ ‘”µœ¤(€€€€€€è€¹½ ­•¥¹”•áÑ•É¹”M¥¡•ÉÕ¹œœì(€€€•áÑ•É¹…±…É¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€M¥¡•ÉÕ¹Í½É‘¹•Èœ°Ù…±Õ”è•áÑ•É¹…±I•…‘ä€ü•Í…Á•!Ñµ°¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”¤€è€9¥¡Ð…ÕÍ•ß‘¡±Ðœ°­¥¹è•áÑ•É¹…±I•…‘ä€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€ì±…‰•°è€1•ÑéÑ”•áÑ•É¹”M¥¡•ÉÕ¹œœ°Ù…±Õ”è±…ÍÑáÑ•É¹…±1…‰•°°­¥¹è±…ÍÑáÑ•É¹…±…Ñ”€ü€ÍÕ•ÍÌœ€è€Ý…É¹¥¹œœô°(€€€€€ì±…‰•°è€…Ñ•¤œ°Ù…±Õ”èaQI91}	-UA}%195°¡¥¹Ðè€]¥ÉÓ‘±¥ µ¥Ð‘•´…­ÑÕ•±±•¸MÑ…¹ƒñ‰•ÉÍ¡É¥•‰•¸¸œô(€€€t¤¤ì((€€€½¹ÍÐ•áÑ•É¹…±Ñ¥½¹Ì€ôÉ•…Ñ•U¥° ‘¥Øœ°€É½Ü•áÑ•É¹…°µ‰…­ÕÀµ…Ñ¥½¹Ìœ¤ì(€€€½¹ÍÐ™½±‘•É	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€™½±‘•É	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€™½±‘•É	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€™½±‘•É	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô•áÑ•É¹…±I•…‘ä€ü€¹‘•É•¸M¥¡•ÉÕ¹Í½É‘¹•Èß‘¡±•¸œ€è€M¥¡•ÉÕ¹Í½É‘¹•È…ÕÍß‘¡±•¸œì(€€€™½±‘•É	ÕÑÑ½¸¹‘¥Í…‰±•€ô€…ÍÕÁÁ½ÉÑÍáÑ•É¹…±½±‘•É	…­ÕÀì(€€€™½±‘•É	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€™½±‘•É	ÕÑÑ½¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€½¹ÍÐ½É¥¥¹…±Q•áÐ€ô™½±‘•É	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ðì(€€€€€™½±‘•É	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€=É‘¹•ÈÝ¥ÉÙ•É‰Õ¹‘•¸ƒŠ˜œì(€€€€€ÑÉäì(€€€€€€€½¹ÍÐ¡…¹‘±”€ô…Ý…¥ÐÝ¥¹‘½Ü¹Í¡½Ý¥É•Ñ½ÉåA¥­•È¡ì¥è€¡…ÕÍ¡…±ÑÍÁ±…¹•Èµ‰…­ÕÀœ°µ½‘”è€É•…‘ÝÉ¥Ñ”œô¤ì(€€€€€€€…Ý…¥ÐÍÑ½É•áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±”¡¡…¹‘±”¤ì(€€€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”€ôMÑÉ¥¹œ¡¡…¹‘±”¹¹…µ”ñð€M¥¡•ÉÕ¹Í½É‘¹•Èœ¤ì(€€€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÝÉ¥Ñ•áÑ•É¹…±	…­ÕÀ¡ì¡…¹‘±”°É•ÅÕ•ÍÑA•Éµ¥ÍÍ¥½¸èÑÉÕ”ô¤ì(€€€€€€€¥˜€ …É•ÍÕ±Ð¹½¬¤Ñ¡É½Ü¹•ÜÉÉ½È •È=É‘¹•ÈÝÕÉ‘”¹¥¡Ð›ñÈM¡É•¥‰éÕÉ¥™˜™É•¥••‰•¸¸œ¤ì(€€€€€€€…‘‘¡…¹•1½œ M¥¡•É¸œ°ÕÑ½µ…Ñ¥Í¡”AµM¥¡•ÉÕ¹œ¥´=É‘¹•ÈƒŠx‘íÉ•ÍÕ±Ð¹™½±‘•É9…µ•÷Šp•¥¹•É¥¡Ñ•Ð¹€°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€€€¥˜€¡MÑÉ¥¹œ¡•ÉÈ€˜˜•ÉÈ¹¹…µ”¤€„ôô€‰½ÉÑÉÉ½Èœ¤ì(€€€€€€€€€…±•ÉÐ •ÈM¥¡•ÉÕ¹Í½É‘¹•È­½¹¹Ñ”¹¥¡ÐÙ•É‰Õ¹‘•¸Ý•É‘•¸è€œ€¬€¡•ÉÈ€˜˜•ÉÈ¹µ•ÍÍ…”€ü•ÉÈ¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÈ¤¤¤ì(€€€€€€€ô(€€€€€€€™½±‘•É	ÕÑÑ½¸¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€€€™½±‘•É	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô½É¥¥¹…±Q•áÐì(€€€€€ô(€€€ô¤ì(€€€•áÑ•É¹…±Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡™½±‘•É	ÕÑÑ½¸¤ì((€€€¥˜€¡•áÑ•É¹…±I•…‘ä¤ì(€€€€€½¹ÍÐ¹½Ý	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€¹½Ý	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€¹½Ý	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€ÍÕ•ÍÌœì(€€€€€¹½Ý	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€)•ÑéÐ•áÑ•É¸Í¥¡•É¸œì(€€€€€¹½Ý	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€€€¹½Ý	ÕÑÑ½¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€€€¹½Ý	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€M¥¡•ÉÕ¹œ³‘Õ™ÐƒŠ˜œì(€€€€€€€ÑÉäì(€€€€€€€€€±•Ð¡…¹‘±”€ô…¡•‘áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±”ì(€€€€€€€€€¥˜€ …¡…¹‘±”¤ì(€€€€€€€€€€€¡…¹‘±”€ô…Ý…¥ÐÝ¥¹‘½Ü¹Í¡½Ý¥É•Ñ½ÉåA¥­•È¡ì¥è€¡…ÕÍ¡…±ÑÍÁ±…¹•Èµ‰…­ÕÀœ°µ½‘”è€É•…‘ÝÉ¥Ñ”œô¤ì(€€€€€€€€€€€…Ý…¥ÐÍÑ½É•áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±”¡¡…¹‘±”¤ì(€€€€€€€€€ô(€€€€€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÝÉ¥Ñ•áÑ•É¹…±	…­ÕÀ¡ì¡…¹‘±”°É•ÅÕ•ÍÑA•Éµ¥ÍÍ¥½¸èÑÉÕ”ô¤ì(€€€€€€€€€¥˜€ …É•ÍÕ±Ð¹½¬¤Ñ¡É½Ü¹•ÜÉÉ½È 	¥ÑÑ”‘¥”É•¥…‰”‘•ÌM¥¡•ÉÕ¹Í½É‘¹•ÉÌ•É¹•Õ•É¸¸œ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€€€€€…±•ÉÐ áÑ•É¹”M¥¡•ÉÕ¹œ¹¥¡Ð·Ù±¥ è€œ€¬€¡•ÉÈ€˜˜•ÉÈ¹µ•ÍÍ…”€ü•ÉÈ¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÈ¤¤¤ì(€€€€€€€€€¹½Ý	ÕÑÑ½¸¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€€€€€¹½Ý	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€)•ÑéÐ•áÑ•É¸Í¥¡•É¸œì(€€€€€€€ô(€€€€€ô¤ì(€€€€€•áÑ•É¹…±Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡¹½Ý	ÕÑÑ½¸¤ì((€€€€€½¹ÍÐ‘¥Í½¹¹•Ñ	ÕÑÑ½¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€‘¥Í½¹¹•Ñ	ÕÑÑ½¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€‘¥Í½¹¹•Ñ	ÕÑÑ½¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éäœì(€€€€€‘¥Í½¹¹•Ñ	ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€=É‘¹•ÈÑÉ•¹¹•¸œì(€€€€€‘¥Í½¹¹•Ñ	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…Íå¹Œ€ ¤€ôøì(€€€€€€€¥˜€ …½¹™¥É´ ÕÑ½µ…Ñ¥Í¡”AµM¥¡•ÉÕ¹œÑÉ•¹¹•¸ü	•É•¥ÑÌ•ÍÁ•¥¡•ÉÑ”M¥¡•ÉÕ¹Í‘…Ñ•¥•¸‰±•¥‰•¸¥´=É‘¹•È•É¡…±Ñ•¸¸œ¤¤É•ÑÕÉ¸ì(€€€€€€€ÑÉäì…Ý…¥ÐÉ•µ½Ù•áÑ•É¹…±	…­ÕÁ¥É•Ñ½Éå!…¹‘±” ¤ìô…Ñ €¡•ÉÈ¤íô(€€€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ”€ô€œœì(€€€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑáÑ•É¹…±	…­ÕÁÐ€ô€œœì(€€€€€€€…‘‘¡…¹•1½œ M¥¡•É¸œ°€ÕÑ½µ…Ñ¥Í¡”AµM¥¡•ÉÕ¹œ•ÑÉ•¹¹Ð¸œ°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€É•¹‘•È ¤ì(€€€€€ô¤ì(€€€€€•áÑ•É¹…±Ñ¥½¹Ì¹…ÁÁ•¹‘¡¥±¡‘¥Í½¹¹•Ñ	ÕÑÑ½¸¤ì(€€€ô(€€€•áÑ•É¹…±…É¹…ÁÁ•¹‘¡¥±¡•áÑ•É¹…±Ñ¥½¹Ì¤ì((€€€¥˜€¡ÍÕÁÁ½ÉÑÍáÑ•É¹…±½±‘•É	…­ÕÀ¤ì(€€€€€½¹ÍÐ•áÑ•É¹…±•Ñ…¥±Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€€€•áÑ•É¹…±•Ñ…¥±Ì¹±…ÍÍ9…µ”€ô€½ÁÑ¥½¹…°µ•áÑ•É¹…°µ‰…­ÕÀœì(€€€€€•áÑ•É¹…±•Ñ…¥±Ì¹½Á•¸€ô•áÑ•É¹…±I•…‘äì(€€€€€½¹ÍÐ•áÑ•É¹…±MÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€€€•áÑ•É¹…±MÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ô•áÑ•É¹…±I•…‘ä(€€€€€€€€üiÕÏ‘Ñé±¥¡•ÈM¥¡•ÉÕ¹Í½É‘¹•Èè€‘íÍÑ…Ñ”¹…ÁÁ5•Ñ„¹•áÑ•É¹…±	…­ÕÁ½±‘•É9…µ•õ€(€€€€€€€€è€=ÁÑ¥½¹…°èéÕÏ‘Ñé±¥¡•¸M¥¡•ÉÕ¹Í½É‘¹•È…Õ˜‘•´AÙ•É‰¥¹‘•¸œì(€€€€€•áÑ•É¹…±•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡•áÑ•É¹…±MÕµµ…Éä¤ì(€€€€€•áÑ•É¹…±•Ñ…¥±Ì¹…ÁÁ•¹‘¡¥±¡•áÑ•É¹…±…É¤ì(€€€€€…‘Ù…¹•‘	½‘ä¹…ÁÁ•¹‘¡¥±¡•áÑ•É¹…±•Ñ…¥±Ì¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐ™½±‘•É%¹™¼€ôÉ•…Ñ•U¥° ‘¥Øœ°€¹½Ñ¥”¥¹™¼œ¤ì(€€€€€™½±‘•É%¹™¼¹¥¹¹•É!Q50€ô€œñÍÑÉ½¹œùiÕÏ‘Ñé±¥¡”…Ñ•¤…Õ˜‘•´Aèð½ÍÑÉ½¹œø¥”…ÕÑ½µ…Ñ¥Í¡”	É½ÝÍ•ÈµM¥¡•ÉÕ¹œ½‰•¸¥ÍÐ…­Ñ¥Ø¸ñÈ•¥¹”Ý•¥Ñ•É”M¥¡•ÉÕ¹œ…×}•É¡…±ˆ‘•Ì	É½ÝÍ•ÉÌ­…¹¹ÍÐ‘ÔÕ¹Ñ•¸©•‘•Éé•¥Ð•¥¹”…Ñ•¤¡•ÉÕ¹Ñ•É±…‘•¸¸œì(€€€€€…‘Ù…¹•‘	½‘ä¹…ÁÁ•¹‘¡¥±¡™½±‘•É%¹™¼¤ì(€€€ô((€€€½¹ÍÐÑ½Ñ…±A½ÍÑÌ€ô€¡ÍÑ…Ñ”¹½µµ½¹½ÍÑÌü¹±•¹Ñ ñð€À¤€¬€¡ÍÑ…Ñ”¹Á•ÉÍ½¹…±½ÍÑÌü¹±•¹Ñ ñð€À¤€¬€¡ÍÑ…Ñ”¹‰Õ™™•ÉáÁ•¹Í•Ìü¹±•¹Ñ ñð€À¤ì(€€€…‘Ù…¹•‘	½‘ä¹…ÁÁ•¹‘¡¥±¡É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡l(€€€€€ì±…‰•°è€A•ÉÍ½¹•¸œ°Ù…±Õ”èMÑÉ¥¹œ¡ÍÑ…Ñ”¹Á•ÉÍ½¹Ì¹±•¹Ñ ¤ô°(€€€€€ì±…‰•°è€A½ÍÑ•¸•Í…µÐœ°Ù…±Õ”èMÑÉ¥¹œ¡Ñ½Ñ…±A½ÍÑÌ¤ô°(€€€€€ì±…‰•°è€M¡Õ±‘•¸œ°Ù…±Õ”èMÑÉ¥¹œ¡ÍÑ…Ñ”¹‘•‰ÑÌ¹±•¹Ñ ¤ô°(€€€€€ì±…‰•°è€Y•ÉÑË‘”œ°Ù…±Õ”èMÑÉ¥¹œ ¡ÍÑ…Ñ”¹½¹ÑÉ…ÑÌñðmt¤¹±•¹Ñ ¤ô°(€€€€€ì±…‰•°è€­Ñ¥Ù•È5½¹…Ðœ°Ù…±Õ”è™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¤ô°(€€€€€ì±…‰•°è€iÕ±•ÑéÐ¥´	É½ÝÍ•È•ÍÁ•¥¡•ÉÐœ°Ù…±Õ”è±½…±MÑ½É…”¹•Ñ%Ñ•´ ‰Õ‘•ÑMÑ…Ñ•1…ÍÑM…Ù•‘Ðœ¤€ü¹•Ü…Ñ”¡±½…±MÑ½É…”¹•Ñ%Ñ•´ ‰Õ‘•ÑMÑ…Ñ•1…ÍÑM…Ù•‘Ðœ¤¤¹Ñ½1½…±•MÑÉ¥¹œ ‘”µœ°ì‘…äè€œÈµ‘¥¥Ðœ°µ½¹Ñ è€œÈµ‘¥¥Ðœ°¡½ÕÈè€œÈµ‘¥¥Ðœ°µ¥¹ÕÑ”è€œÈµ‘¥¥Ðœô¤€è€œ´œô(€€€t¤¤ì((€€€½¹ÍÐ…Ñ¥½¹I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€…Ñ¥½¹I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì((€€€±•Ð‰…­ÕÁ½Ý¹±½…‘%¹AÉ½É•ÍÌ€ô™…±Í”ì(€€€½¹ÍÐ•áÁ½ÉÑ	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€•áÁ½ÉÑ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€M¥¡•ÉÕ¹œ¡•ÉÕ¹Ñ•É±…‘•¸œì(€€€•áÁ½ÉÑ	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€•áÁ½ÉÑ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€¥˜€¡‰…­ÕÁ½Ý¹±½…‘%¹AÉ½É•ÍÌ¤É•ÑÕÉ¸ì(€€€€€‰…­ÕÁ½Ý¹±½…‘%¹AÉ½É•ÍÌ€ôÑÉÕ”ì(€€€€€•áÁ½ÉÑ	Ñ¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€½¹ÍÐ½±‘Q•áÐ€ô•áÁ½ÉÑ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ðì(€€€€€•áÁ½ÉÑ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€M¥¡•ÉÕ¹œÝ¥É•ÉÍÑ•±±Ð¸¸¸œì(€€€€€ÑÉäì(€€€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹¥¹±Õ‘•Á¥-•å%¹	…­ÕÀ€ôÑÉÕ”ì(€€€€€€€½¹ÍÐì‰±½ˆ°™¥±•¹…µ”ô€ôÉ•…Ñ•	…­ÕÁ¥±” ¤ì(€€€€€€€½¹ÍÐÕÉ°€ôUI0¹É•…Ñ•=‰©•ÑUI0¡‰±½ˆ¤ì(€€€€€€€½¹ÍÐ±¥¹¬€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð „œ¤ì(€€€€€€€±¥¹¬¹¡É•˜€ôÕÉ°ì(€€€€€€€±¥¹¬¹‘½Ý¹±½…€ô™¥±•¹…µ”ì(€€€€€€€‘½Õµ•¹Ð¹‰½‘ä¹…ÁÁ•¹‘¡¥±¡±¥¹¬¤ì(€€€€€€€±¥¹¬¹±¥¬ ¤ì(€€€€€€€‘½Õµ•¹Ð¹‰½‘ä¹É•µ½Ù•¡¥±¡±¥¹¬¤ì(€€€€€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøUI0¹É•Ù½­•=‰©•ÑUI0¡ÕÉ°¤°€ÄÔÀÀ¤ì(€€€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€€€…±•ÉÐ •¡±•È‰•¥´	…­ÕÀè€œ€¬•ÉÈ¹µ•ÍÍ…”¤ì(€€€€€ô™¥¹…±±äì(€€€€€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€€€€€‰…­ÕÁ½Ý¹±½…‘%¹AÉ½É•ÍÌ€ô™…±Í”ì(€€€€€€€€€•áÁ½ÉÑ	Ñ¸¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€€€€€•áÁ½ÉÑ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô½±‘Q•áÐì(€€€€€€€ô°€ÄÈÀÀ¤ì(€€€€€ô(€€€ô¤ì((€€€…Ñ¥½¹I½Ü¹…ÁÁ•¹‘¡¥±¡•áÁ½ÉÑ	Ñ¸¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡…Ñ¥½¹I½Ü¤ì((€€€½¹ÍÐÉ•ÍÑ½É•…É€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€É•ÍÑ½É•…É¹±…ÍÍ9…µ”€ô€ÍÕˆµ…É‰…­ÕÀµÉ•ÍÑ½É”µ…Éœì(€€€½¹ÍÐÉ•ÍÑ½É•Q¥Ñ±”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Ìœ¤ì(€€€É•ÍÑ½É•Q¥Ñ±”¹Ñ•áÑ½¹Ñ•¹Ð€ô€M¥¡•ÉÕ¹œ•¥¹ÍÁ¥•±•¸œì(€€€É•ÍÑ½É•…É¹…ÁÁ•¹‘¡¥±¡É•ÍÑ½É•Q¥Ñ±”¤ì((€€€½¹ÍÐÉ•ÍÑ½É•%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€É•ÍÑ½É•%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ô€_‘¡±”•¥¹”éÕÙ½È¡•ÉÕ¹Ñ•É•±…‘•¹”)M=8µM¥¡•ÉÕ¹œ…ÕÌ¸•¥¸©•Ñé¥•ÈMÑ…¹‰±•¥‰Ð…ÕÑ½µ…Ñ¥Í …±ÌKñ­™…±°µM¥¡•ÉÕ¹œ•É¡…±Ñ•¸¸œì(€€€É•ÍÑ½É•…É¹…ÁÁ•¹‘¡¥±¡É•ÍÑ½É•%¹™¼¤ì((€€€½¹ÍÐ™¥±•I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€™¥±•I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì((€€€½¹ÍÐ™¥±•]É…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹ÍÐÉ•ÍÑ½É•1…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€É•ÍÑ½É•1…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô€	…­ÕÀµ…Ñ•¤…ÕÍß‘¡±•¸œì(€€€½¹ÍÐ¥µÁ½ÉÑ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€¥µÁ½ÉÑ%¹ÁÕÐ¹ÑåÁ”€ô€™¥±”œì(€€€¥µÁ½ÉÑ%¹ÁÕÐ¹…•ÁÐ€ô€œ¹©Í½¸±…ÁÁ±¥…Ñ¥½¸½©Í½¸œì(€€€¥µÁ½ÉÑ%¹ÁÕÐ¹¥€ô€‰…­ÕÁ¥±•%¹ÁÕÐœì(€€€É•ÍÑ½É•1…‰•°¹¡Ñµ±½È€ô¥µÁ½ÉÑ%¹ÁÕÐ¹¥ì(€€€™¥±•]É…À¹…ÁÁ•¹‘¡¥±¡É•ÍÑ½É•1…‰•°¤ì(€€€™¥±•]É…À¹…ÁÁ•¹‘¡¥±¡¥µÁ½ÉÑ%¹ÁÕÐ¤ì(€€€™¥±•I½Ü¹…ÁÁ•¹‘¡¥±¡™¥±•]É…À¤ì(€€€É•ÍÑ½É•…É¹…ÁÁ•¹‘¡¥±¡™¥±•I½Ü¤ì((€€€½¹ÍÐÍ•±•Ñ•‘%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€Í•±•Ñ•‘%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ô€9½ ­•¥¹”…Ñ•¤…ÕÍ•ß‘¡±Ð¸œì(€€€É•ÍÑ½É•…É¹…ÁÁ•¹‘¡¥±¡Í•±•Ñ•‘%¹™¼¤ì((€€€½¹ÍÐÍÑ…ÑÕÍ	½à€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€ÍÑ…ÑÕÍ	½à¹±…ÍÍ9…µ”€ô€¥¹±¥¹”µÍÑ…ÑÕÌœì(€€€ÍÑ…ÑÕÍ	½à¹¡¥‘‘•¸€ôÑÉÕ”ì(€€€É•ÍÑ½É•…É¹…ÁÁ•¹‘¡¥±¡ÍÑ…ÑÕÍ	½à¤ì((€€€±•ÐÍÑ…ÑÕÍQ¥µ•½ÕÐ€ô¹Õ±°ì(€€€½¹ÍÐÍ•Ñ%¹±¥¹•MÑ…ÑÕÌ€ô€¡µ•ÍÍ…”°­¥¹€ô€ÍÕ•ÍÌœ¤€ôøì(€€€€€¥˜€¡ÍÑ…ÑÕÍQ¥µ•½ÕÐ¤ì(€€€€€€€±•…ÉQ¥µ•½ÕÐ¡ÍÑ…ÑÕÍQ¥µ•½ÕÐ¤ì(€€€€€€€ÍÑ…ÑÕÍQ¥µ•½ÕÐ€ô¹Õ±°ì(€€€€€ô(€€€€€ÍÑ…ÑÕÍ	½à¹¡¥‘‘•¸€ô™…±Í”ì(€€€€€ÍÑ…ÑÕÍ	½à¹±…ÍÍ9…µ”€ô¥¹±¥¹”µÍÑ…ÑÕÌ€‘í­¥¹‘õ€ì(€€€€€ÍÑ…ÑÕÍ	½à¹Ñ•áÑ½¹Ñ•¹Ð€ôµ•ÍÍ…”ì(€€€€€¥˜€¡­¥¹€ôôô€ÍÕ•ÍÌœ¤ì(€€€€€€€ÍÑ…ÑÕÍQ¥µ•½ÕÐ€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€€€€€ÍÑ…ÑÕÍ	½à¹¡¥‘‘•¸€ôÑÉÕ”ì(€€€€€€€€€ÍÑ…ÑÕÍ	½à¹Ñ•áÑ½¹Ñ•¹Ð€ô€œœì(€€€€€€€ô°€ÄÈÀÀÀ¤ì(€€€€€ô(€€€ôì((€€€¥˜€¡Á•¹‘¥¹	…­ÕÁ%µÁ½ÉÑ9½Ñ¥”¤ì(€€€€€½¹ÍÐ¹½Ñ¥”€ôÁ•¹‘¥¹	…­ÕÁ%µÁ½ÉÑ9½Ñ¥”ì(€€€€€Á•¹‘¥¹	…­ÕÁ%µÁ½ÉÑ9½Ñ¥”€ô¹Õ±°ì(€€€€€Í•Ñ%¹±¥¹•MÑ…ÑÕÌ¡¹½Ñ¥”¹µ•ÍÍ…”°¹½Ñ¥”¹­¥¹¤ì(€€€ô((€€€½¹ÍÐ¥µÁ½ÉÑ	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€¥µÁ½ÉÑ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€M¥¡•ÉÕ¹œ•¥¹ÍÁ¥•±•¸œì(€€€¥µÁ½ÉÑ	Ñ¸¹±…ÍÍ9…µ”€ô€ÁÉ¥µ…Éäœì(€€€¥µÁ½ÉÑ	Ñ¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€É•ÍÑ½É•…É¹…ÁÁ•¹‘¡¥±¡¥µÁ½ÉÑ	Ñ¸¤ì((€€€±•ÐÍ•±•Ñ•‘¥±”€ô¹Õ±°ì((€€€¥µÁ½ÉÑ%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€¡”¤€ôøì(€€€€€Í•±•Ñ•‘¥±”€ô”¹Ñ…É•Ð¹™¥±•Ì€˜˜”¹Ñ…É•Ð¹™¥±•ÍlÁt€ü”¹Ñ…É•Ð¹™¥±•ÍlÁt€è¹Õ±°ì(€€€€€ÍÑ…ÑÕÍ	½à¹¡¥‘‘•¸€ôÑÉÕ”ì(€€€€€¥˜€¡Í•±•Ñ•‘¥±”¤ì(€€€€€€€Í•±•Ñ•‘%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ôÕÍ•ß‘¡±Ðè€‘íÍ•±•Ñ•‘¥±”¹¹…µ•õ€ì(€€€€€€€¥µÁ½ÉÑ	Ñ¸¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€ô•±Í”ì(€€€€€€€Í•±•Ñ•‘%¹™¼¹Ñ•áÑ½¹Ñ•¹Ð€ô€9½ ­•¥¹”…Ñ•¤…ÕÍ•ß‘¡±Ð¸œì(€€€€€€€¥µÁ½ÉÑ	Ñ¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€ô(€€€ô¤ì((€€€¥µÁ½ÉÑ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€¥˜€ …Í•±•Ñ•‘¥±”¤ì(€€€€€€€Í•Ñ%¹±¥¹•MÑ…ÑÕÌ 	¥ÑÑ”éÕ•ÉÍÐ•¥¹”	…­ÕÀµ…Ñ•¤…ÕÍß‘¡±•¸¸œ°€•ÉÉ½Èœ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€¥µÁ½ÉÑ	Ñ¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€¥µÁ½ÉÑ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€%µÁ½ÉÐ³‘Õ™Ð€¸¸¸œì(€€€€€½¹ÍÐÉ•…‘•È€ô¹•Ü¥±•I•…‘•È ¤ì(€€€€€É•…‘•È¹½¹±½…€ô€¡•Ø¤€ôøì(€€€€€€€±•ÐÁÉ•Ù¥½ÕÍMÑ…Ñ•A…å±½…€ô€œœì(€€€€€€€±•Ð¥µÁ½ÉÑMÑ…ÉÑ•€ô™…±Í”ì(€€€€€€€±•Ð¥µÁ½ÉÑ½µµ¥ÑÑ•€ô™…±Í”ì(€€€€€€€½¹ÍÐ±½…±ÕÑ½µ…Ñ¥	…­ÕÁÐ€ôÍÑ…Ñ”¹…ÁÁ5•Ñ„€˜˜ÑåÁ•½˜ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐ€ôôô€ÍÑÉ¥¹œœ(€€€€€€€€€€üÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐ(€€€€€€€€€€è€œœì(€€€€€€€½¹ÍÐÉ•Í•Ñ%µÁ½ÉÑ	ÕÑÑ½¸€ô€ ¤€ôøì(€€€€€€€€€¥µÁ½ÉÑ	Ñ¸¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€€€€€¥µÁ½ÉÑ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€M¥¡•ÉÕ¹œ•¥¹ÍÁ¥•±•¸œì(€€€€€€€ôì(€€€€€€€ÑÉäì(€€€€€€€€€½¹ÍÐÉ…ÝQ•áÐ€ôMÑÉ¥¹œ¡•Ø¹Ñ…É•Ð€˜˜•Ø¹Ñ…É•Ð¹É•ÍÕ±Ð€ü•Ø¹Ñ…É•Ð¹É•ÍÕ±Ð€è€œœ¤¹É•Á±…” ½yqÕ¼°€œœ¤¹ÑÉ¥´ ¤ì(€€€€€€€€€¥˜€ …É…ÝQ•áÐ¤Ñ¡É½Ü¹•ÜÉÉ½È ¥”…Ñ•¤¥ÍÐ±••È¸œ¤ì(€€€€€€€€€¥˜€¡É…ÝQ•áÐ¹Í±¥” À°€È¤€ôôô€A,œ¤ì(€€€€€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È …Ì¥ÍÐÙ•ÉµÕÑ±¥ •¥¹”i%@µ…Ñ•¤¸	¥ÑÑ”‘¥”)M=8µM¥¡•ÉÕ¹œ…ÕÍß‘¡±•¸°¹¥¡Ð‘½Ì¹é¥À¸œ¤ì(€€€€€€€€€ô(€€€€€€€€€½¹ÍÐ‘…Ñ„€ô)M=8¹Á…ÉÍ”¡É…ÝQ•áÐ¤ì(€€€€€€€€€½¹ÍÐ¥µÁ½ÉÑ•‘MÑ…Ñ”€ô‘…Ñ„€˜˜‘…Ñ„¹ÍÑ…Ñ”€˜˜ÑåÁ•½˜‘…Ñ„¹ÍÑ…Ñ”€ôôô€½‰©•Ðœ€ü‘…Ñ„¹ÍÑ…Ñ”€è‘…Ñ„ì(€€€€€€€€€½¹ÍÐ¡…Í½É•…Ñ„€ô¥µÁ½ÉÑ•‘MÑ…Ñ”€˜˜ÑåÁ•½˜¥µÁ½ÉÑ•‘MÑ…Ñ”€ôôô€½‰©•Ðœ(€€€€€€€€€€€€˜˜ÉÉ…ä¹¥ÍÉÉ…ä¡¥µÁ½ÉÑ•‘MÑ…Ñ”¹Á•ÉÍ½¹Ì¤(€€€€€€€€€€€€˜˜ÉÉ…ä¹¥ÍÉÉ…ä¡¥µÁ½ÉÑ•‘MÑ…Ñ”¹½µµ½¹½ÍÑÌ¤(€€€€€€€€€€€€˜˜ÉÉ…ä¹¥ÍÉÉ…ä¡¥µÁ½ÉÑ•‘MÑ…Ñ”¹Á•ÉÍ½¹…±½ÍÑÌ¤(€€€€€€€€€€€€˜˜ÉÉ…ä¹¥ÍÉÉ…ä¡¥µÁ½ÉÑ•‘MÑ…Ñ”¹‘•‰ÑÌ¤ì(€€€€€€€€€¥˜€ …¡…Í½É•…Ñ„¤ì(€€€€€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È U¹Ÿñ±Ñ¥•Ì…Ñ•¹™½Éµ…Ð¸%¸‘•È…Ñ•¤™•¡±•¸A•ÉÍ½¹•¸°•µ•¥¹Í…µ”-½ÍÑ•¸°Á•ÉÏÙ¹±¥¡”ÕÍ…‰•¸½‘•ÈM¡Õ±‘•¸¸œ¤ì(€€€€€€€€€ô((€€€€€€€€€€¼¼]¥¡Ñ¥œè%µÁ½ÉÐéÕ•ÉÍÐÙ½±±ÍÓ‘¹‘¥œƒñ‰•É¹•¡µ•¸Õ¹‘…¹¸•ÉÍÐ¹½Éµ…±¥Í¥•É•¸¸(€€€€€€€€€€¼¼…‘ÕÉ Ý•É‘•¸ƒ‘±Ñ•É”M¥¡•ÉÕ¹•¸¹¥¡Ð…‰•±•¡¹Ð°¹ÕÈÝ•¥°¹•Õ•É”•±‘•È™•¡±•¸¸(€€€€€€€€€½¹ÍÐÍ…™•%µÁ½ÉÑ•‘MÑ…Ñ”€ôíôì(€€€€€€€€€=‰©•Ð¹­•åÌ¡¥µÁ½ÉÑ•‘MÑ…Ñ”¤¹™½É…  ¡­•ä¤€ôøì(€€€€€€€€€€€¥˜€¡=‰©•Ð¹ÁÉ½Ñ½ÑåÁ”¹¡…Í=Ý¹AÉ½Á•ÉÑä¹…±°¡‘•™…Õ±ÑMÑ…Ñ”°­•ä¤¤ì(€€€€€€€€€€€€€Í…™•%µÁ½ÉÑ•‘MÑ…Ñ•m­•åt€ô¥µÁ½ÉÑ•‘MÑ…Ñ•m­•åtì(€€€€€€€€€€€ô(€€€€€€€€€ô¤ì(€€€€€€€€€ÁÉ•Ù¥½ÕÍMÑ…Ñ•A…å±½…€ô)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¤ì(€€€€€€€€€±•…¹ÕÁ1•…åMÑ…Ñ•MÑ½É…•-•åÌ ¤ì(€€€€€€€€€ÑÉäì(€€€€€€€€€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ ‰Õ‘•ÑMÑ…Ñ•	•™½É•%µÁ½ÉÐœ°ÁÉ•Ù¥½ÕÍMÑ…Ñ•A…å±½…¤ì(€€€€€€€€€€€±½…±MÑ½É…”¹Í•Ñ%Ñ•´ ‰Õ‘•ÑMÑ…Ñ•	•™½É•%µÁ½ÉÑÐœ°¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¤ì(€€€€€€€€€ô…Ñ €¡É•½Ù•ÉåÉÈ¤ì(€€€€€€€€€€€½¹Í½±”¹Ý…É¸ Kñ­™…±°µM¥¡•ÉÕ¹œÙ½È‘•´%µÁ½ÉÐ­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸œ°É•½Ù•ÉåÉÈ¤ì(€€€€€€€€€ô(€€€€€€€€€ÍÑ…Ñ”€ô=‰©•Ð¹…ÍÍ¥¸¡)M=8¹Á…ÉÍ”¡)M=8¹ÍÑÉ¥¹¥™ä¡‘•™…Õ±ÑMÑ…Ñ”¤¤°Í…™•%µÁ½ÉÑ•‘MÑ…Ñ”¤ì(€€€€€€€€€¥µÁ½ÉÑMÑ…ÉÑ•€ôÑÉÕ”ì(€€€€€€€€€Í…¹¥Ñ¥é•MÑ…Ñ•Q•áÑY…±Õ•Ì¡ÍÑ…Ñ”¤ì(€€€€€€€€€½¹ÍÐ¥µÁ½ÉÑ•‘M•±•Ñ•‘5½¹Ñ €ôÍÑ…Ñ”¹…ÁÁ5•Ñ„€˜˜¥Í5½¹Ñ¡-•ä¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹Í•±•Ñ•‘5½¹Ñ ¤€üÍÑ…Ñ”¹…ÁÁ5•Ñ„¹Í•±•Ñ•‘5½¹Ñ €è€œœì(€€€€€€€€€½¹ÍÐ¥µÁ½ÉÑ]…É¹¥¹Í%¹Ñ•É¹…°€ômtì(€€€€€€€€€½¹ÍÐÉÕ¹%µÁ½ÉÑMÑ•À€ô€¡±…‰•°°™¸¤€ôøì(€€€€€€€€€€€ÑÉäì™¸ ¤ìô…Ñ €¡ÍÑ•ÁÉÈ¤ì(€€€€€€€€€€€€€½¹Í½±”¹Ý…É¸ %µÁ½ÉÐµM¡É¥ÑÐƒñ‰•ÉÍÁÉÕ¹•¸èœ°±…‰•°°ÍÑ•ÁÉÈ¤ì(€€€€€€€€€€€€€¥µÁ½ÉÑ]…É¹¥¹Í%¹Ñ•É¹…°¹ÁÕÍ ¡±…‰•°¤ì(€€€€€€€€€€€ô(€€€€€€€€€ôì((€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À ÉÕ¹‘™•±‘•Èœ°€ ¤€ôøì(€€€€€€€€€€€¥˜€ …ÍÑ…Ñ”¹É•Í•ÉÙ•ÍM…Ù•‘5½¹Ñ¡Ì¤ÍÑ…Ñ”¹É•Í•ÉÙ•ÍM…Ù•‘5½¹Ñ¡Ì€ômtì(€€€€€€€€€€€¥˜€ …ÍÑ…Ñ”¹É•Í•ÉÙ•%Ñ•µM…Ù•¤ÍÑ…Ñ”¹É•Í•ÉÙ•%Ñ•µM…Ù•€ôíôì(€€€€€€€€€€€¥˜€ …ÍÑ…Ñ”¹Ñ…¹­…±Œ¤ÍÑ…Ñ”¹Ñ…¹­…±Œ€ô)M=8¹Á…ÉÍ”¡)M=8¹ÍÑÉ¥¹¥™ä¡‘•™…Õ±ÑMÑ…Ñ”¹Ñ…¹­…±Œ¤¤ì(€€€€€€€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹‰Õ™™•ÉáÁ•¹Í•Ì¤¤ÍÑ…Ñ”¹‰Õ™™•ÉáÁ•¹Í•Ì€ômtì(€€€€€€€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì¤¤ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ì€ômtì(€€€€€€€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹É½•ÉåáÁ•¹Í•Ì¤¤ÍÑ…Ñ”¹É½•ÉåáÁ•¹Í•Ì€ômtì(€€€€€€€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹Íµ½­¥¹áÁ•¹Í•Ì¤¤ÍÑ…Ñ”¹Íµ½­¥¹áÁ•¹Í•Ì€ômtì(€€€€€€€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹½¹ÑÉ…ÑÌ¤¤ÍÑ…Ñ”¹½¹ÑÉ…ÑÌ€ômtì(€€€€€€€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì¤¤ÍÑ…Ñ”¹½¹ÑÉ…ÑMÕ•ÍÑ¥½¹¥Íµ¥ÍÍ…±Ì€ômtì(€€€€€€€€€€€¥˜€ …ÍÑ…Ñ”¹Í•±™µÁ±½åµ•¹ÐñðÑåÁ•½˜ÍÑ…Ñ”¹Í•±™µÁ±½åµ•¹Ð€„ôô€½‰©•Ðœ¤ÍÑ…Ñ”¹Í•±™µÁ±½åµ•¹Ð€ô)M=8¹Á…ÉÍ”¡)M=8¹ÍÑÉ¥¹¥™ä¡‘•™…Õ±ÑMÑ…Ñ”¹Í•±™µÁ±½åµ•¹Ð¤¤ì(€€€€€€€€€€€¥˜€ …ÍÑ…Ñ”¹µ½¹Ñ¡±å±½Í¥¹ÌñðÑåÁ•½˜ÍÑ…Ñ”¹µ½¹Ñ¡±å±½Í¥¹Ì€„ôô€½‰©•Ðœ¤ÍÑ…Ñ”¹µ½¹Ñ¡±å±½Í¥¹Ì€ôíôì(€€€€€€€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”¹¡…¹•1½œ¤¤ÍÑ…Ñ”¹¡…¹•1½œ€ômtì(€€€€€€€€€€€¥˜€ …ÍÑ…Ñ”¹…ÁÁ5•Ñ„ñðÑåÁ•½˜ÍÑ…Ñ”¹…ÁÁ5•Ñ„€„ôô€½‰©•Ðœ¤ÍÑ…Ñ”¹…ÁÁ5•Ñ„€ô)M=8¹Á…ÉÍ”¡)M=8¹ÍÑÉ¥¹¥™ä¡‘•™…Õ±ÑMÑ…Ñ”¹…ÁÁ5•Ñ„¤¤ì(€€€€€€€€€ô¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À MÑ•Õ•É•ÉÍÑ…ÑÑÕ¹œœ°€ ¤€ôø¹½Éµ…±¥é•±±Q…áI•™Õ¹‘Ì ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À ¥¹­…Õ™Í•±œ°€ ¤€ôø¹½Éµ…±¥é•É½•ÉåáÁ•¹Í•Ì ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À M•±‰ÍÓ‘¹‘¥­•¥Ðœ°€ ¤€ôø¹½Éµ…±¥é•M•±™µÁ±½åµ•¹Ð ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À Q…¹­‘…Ñ•¸œ°€ ¤€ôø¹½Éµ…±¥é•Q…¹­±½Í•‘5½¹Ñ¡Ì ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À Õ™ÍÑ½­Õ¹•¸œ°€ ¤€ôø¹½Éµ…±¥é•	Õ‘•ÑQ½ÁUÁÍ½¹™¥œ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À •µ•¥¹Í¡…™ÑÍ­½¹Ñ¼œ°€ ¤€ôø¹½Éµ…±¥é•½µµ½¹½Õ¹Ñ½¹™¥œ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À -½¹Ñ•¸œ°€ ¤€ôø¹½Éµ…±¥é•½Õ¹ÑÍ½¹™¥œ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À Uµ‰Õ¡Õ¹•¸œ°€ ¤€ôø¹½Éµ…±¥é•½Õ¹ÑQÉ…¹Í™•ÉÍ½¹™¥œ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À Uµ‰Õ¡Õ¹ÍÙ½É±…•¸œ°€ ¤€ôø¹½Éµ…±¥é•½Õ¹ÑQÉ…¹Í™•ÉQ•µÁ±…Ñ•Í½¹™¥œ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À Kñ­±…•¹é¥•±”œ°€ ¤€ôø¹½Éµ…±¥é•M…Ù¥¹Í½…±Í½¹™¥œ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À ¹Ñ™•É¹Ñ”Kñ­±…•¸Õ¹I…Õ¡é•Õœœ°€ ¤€ôøÉ•µ½Ù•I•Ñ¥É•‘M…Ù¥¹Í¹‘Mµ½­¥¹…Ñ„ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À ÁÀµ5•Ñ„œ°€ ¤€ôø¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤¤ì(€€€€€€€€€¥˜€¡±½…±ÕÑ½µ…Ñ¥	…­ÕÁÐ¤ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÐ€ô±½…±ÕÑ½µ…Ñ¥	…­ÕÁÐì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À -É•¥Í­…ÍÍ”5¥É…Ñ¥½¸œ°€ ¤€ôøµ¥É…Ñ•-É•¥Í­…ÍÍ•Q½	•¹¹åA•ÉÍ½¹…° ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À -É•¥Í­…ÍÍ”1½¡¹…‰éÕœœ°€ ¤€ôøµ¥É…Ñ•-É•¥Í­…ÍÍ•A…åÉ½±±A…åµ•¹Ð ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À A•ÉÍ½¹•¸œ°€ ¤€ôø¹½Éµ…±¥é•±±A•ÉÍ½¹½¹™¥Ì ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À A½ÍÑ•¸œ°€ ¤€ôø¹½Éµ…±¥é•±±A½ÍÑ½¹™¥Ì ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À iÕÍ…ÑéÉ•¹Ñ”!U,ÈÐœ°€ ¤€ôø•¹ÍÕÉ•	•¹¹å!Õ¬ÈÑ‘‘¥Ñ¥½¹…±A•¹Í¥½¹É½µ=Ñ½‰•ÈÈÀÈØ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À ¥¹­…Õ™Í•±µi¥•°œ°€ ¤€ôø•¹ÍÕÉ•É½•Éå5½¹•åÉ½µ)Õ¹”ÈÀÈØ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À M¡Õ±‘•¸œ°€ ¤€ôø¹½Éµ…±¥é•±±•‰Ñ½¹™¥Ì ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À Y•ÉÑË‘”œ°€ ¤€ôø¹½Éµ…±¥é•½¹ÑÉ…ÑÌ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À M¡Õ±‘•¸µY•É­»ñÁ™Õ¹•¸œ°€ ¤€ôø…ÕÑ½1¥¹­5…Ñ¡¥¹•‰ÑA½ÍÑÌ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À 5…¤µ9…¡Ý•¥Í”œ°€ ¤€ôøµ¥É…Ñ•½¹™¥Éµ•‘5…å•‰ÑAÉ½½™ÍXÈÀØ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À 5½¹…ÑÍ…¹Ñ•¥±”™¥á¥•É•¸œ°€ ¤€ôøµ¥É…Ñ•½µµ½¹½¹ÑÉ¥‰ÕÑ¥½¹A…åµ•¹ÑÍXÈÈÄ ¤¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À -½¹Ñ•¸µ5¥É…Ñ¥½¸œ°€ ¤€ôøµ¥É…Ñ•½Õ¹Ñ1•‘•ÉXÈÄÌ ¤¤ì((€€€€€€€€€½¹ÍÐÑ…É•Ñ5½¹Ñ €ô¥µÁ½ÉÑ•‘M•±•Ñ•‘5½¹Ñ ñð€¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„€˜˜¥Í5½¹Ñ¡-•ä¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹Í•±•Ñ•‘5½¹Ñ ¤€üÍÑ…Ñ”¹…ÁÁ5•Ñ„¹Í•±•Ñ•‘5½¹Ñ €è…ÑÕ…±5½¹Ñ¡-•ä¤ì(€€€€€€€€€Í•ÑÕÉÉ•¹Ñ5½¹Ñ ¡Ñ…É•Ñ5½¹Ñ °™…±Í”¤ì(€€€€€€€€€¥˜€ …ÍÑ…Ñ”¹…ÁÁ5•Ñ„ñðÑåÁ•½˜ÍÑ…Ñ”¹…ÁÁ5•Ñ„€„ôô€½‰©•Ðœ¤ÍÑ…Ñ”¹…ÁÁ5•Ñ„€ôíôì(€€€€€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹Í•±•Ñ•‘5½¹Ñ €ôÕÉÉ•¹Ñ5½¹Ñ ì(€€€€€€€€€¥˜€ …¥Í5½¹Ñ¡-•ä¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½5½¹Ñ¡¡•¬¤¤ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½5½¹Ñ¡¡•¬€ô…ÑÕ…±5½¹Ñ¡-•äì(€€€€€€€€€µ½¹Ñ¡1¥ÍÐ€ô•ÑM•±•Ñ…‰±•5½¹Ñ¡Ì¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€ÉÕ¹%µÁ½ÉÑMÑ•À I…Ñ•¸µMå¹Œœ°€ ¤€ôøÍå¹±±1¥¹­•‘•‰ÑI…Ñ•ÍÉ½µA½ÍÑÌ¡ÕÉÉ•¹Ñ5½¹Ñ °€ÌØ°ìÍ¥±•¹ÐèÑÉÕ”ô¤¤ì((€€€€€€€€€½¹ÍÐÍ…Ù•€ôÍ…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€¥˜€ …Í…Ù•¤Ñ¡É½Ü¹•ÜÉÉ½È ¥”…Ñ•¸­½¹¹Ñ•¸¹… ‘•´%µÁ½ÉÐ¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤ì(€€€€€€€€€¥µÁ½ÉÑ½µµ¥ÑÑ•€ôÑÉÕ”ì(€€€€€€€€€€¼¼iÕÏ‘Ñé±¥ ¥¸‘¥”É•±•Ù…¹Ñ•¸Y•ÉÍ¥½¹ÍÍ¡³ñÍÍ•°Í¡É•¥‰•¸°‘…µ¥Ð•¥¸I•±½…¹¥¡ÐÝ¥•‘•È•¥¹•¸…±Ñ•¸MÑ…¹¹¥µµÐ¸(€€€€€€€€€ÑÉäì(€€€€€€€€€€€½¹ÍÐÁ…å±½…€ô)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¤ì(€€€€€€€€€€€ÝÉ¥Ñ•MÑ…Ñ•A…å±½…‘Q½MÑ½É…”¡Á…å±½…¤ì(€€€€€€€€€ô…Ñ €¡ÍÑ½É•ÉÈ¤ì(€€€€€€€€€€€½¹Í½±”¹Ý…É¸ iÕÍ…ÑéÍÁ•¥¡•ÉÕ¹œ¹… %µÁ½ÉÐ™•¡±•Í¡±…•¸œ°ÍÑ½É•ÉÈ¤ì(€€€€€€€€€ô((€€€€€€€€€±•Ð¥µÁ½ÉÑ]…É¹¥¹Ì€ô€Àì(€€€€€€€€€ÑÉäì(€€€€€€€€€€€½¹ÍÐ¥µÁ½ÉÑ¡•­%Ñ•µÌ€ô•Ñ…Ñ…¡•­%Ñ•µÌ ¤ì(€€€€€€€€€€€¥µÁ½ÉÑ]…É¹¥¹Ì€ô¥µÁ½ÉÑ¡•­%Ñ•µÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹­¥¹€ôôô€Ý…É¹¥¹œœñð¥Ñ•´¹­¥¹€ôôô€‘…¹•Èœ¤¹±•¹Ñ ì(€€€€€€€€€ô…Ñ €¡¡•­ÉÈ¤ì(€€€€€€€€€€€½¹Í½±”¹Ý…É¸ …Ñ•¹¡•¬¹… %µÁ½ÉÐƒñ‰•ÉÍÁÉÕ¹•¸œ°¡•­ÉÈ¤ì(€€€€€€€€€€€¥µÁ½ÉÑ]…É¹¥¹Í%¹Ñ•É¹…°¹ÁÕÍ  …Ñ•¹¡•¬œ¤ì(€€€€€€€€€ô(€€€€€€€€€¥µÁ½ÉÑ%¹ÁÕÐ¹Ù…±Õ”€ô€œœì(€€€€€€€€€Í•±•Ñ•‘¥±”€ô¹Õ±°ì(€€€€€€€€€½¹ÍÐ¥µÁ½ÉÑ•‘A½ÍÑ½Õ¹Ð€ô€¡ÍÑ…Ñ”¹½µµ½¹½ÍÑÌü¹±•¹Ñ ñð€À¤(€€€€€€€€€€€€¬€¡ÍÑ…Ñ”¹Á•ÉÍ½¹…±½ÍÑÌü¹±•¹Ñ ñð€À¤(€€€€€€€€€€€€¬€¡ÍÑ…Ñ”¹‰Õ™™•ÉáÁ•¹Í•Ìü¹±•¹Ñ ñð€À¤(€€€€€€€€€€€€¬€¡ÍÑ…Ñ”¹Ñ…áI•™Õ¹‘Ìü¹±•¹Ñ ñð€À¤ì(€€€€€€€€€½¹ÍÐ•áÑÉ„€ô¥µÁ½ÉÑ]…É¹¥¹Í%¹Ñ•É¹…°¹±•¹Ñ €ü€€ ‘í¥µÁ½ÉÑ]…É¹¥¹Í%¹Ñ•É¹…°¹±•¹Ñ¡ôÑ•¡¹¥Í¡”9½Éµ…±¥Í¥•ÉÕ¹œ¡•¸¤ƒñ‰•ÉÍÁÉÕ¹•¸°…Ñ•¸ÝÕÉ‘•¸ÑÉ½Ñé‘•´ƒñ‰•É¹½µµ•¸¸¥€€è€œœì(€€€€€€€€€½¹ÍÐÍÕµµ…Éä€ô€‘íÍÑ…Ñ”¹Á•ÉÍ½¹Ìü¹±•¹Ñ ñð€ÁôA•ÉÍ½¹•¸°€‘í¥µÁ½ÉÑ•‘A½ÍÑ½Õ¹ÑôA½ÍÑ•¸Õ¹€‘íÍÑ…Ñ”¹‘•‰ÑÌü¹±•¹Ñ ñð€ÁôM¡Õ±‘•¸ÝÕÉ‘•¸•ÍÁ•¥¡•ÉÐ¹€ì(€€€€€€€€€Á•¹‘¥¹	…­ÕÁ%µÁ½ÉÑ9½Ñ¥”€ôì(€€€€€€€€€€€µ•ÍÍ…”è¥µÁ½ÉÑ]…É¹¥¹Ì€ø€À(€€€€€€€€€€€€€€ü%µÁ½ÉÐ…‰•Í¡±½ÍÍ•¸è€‘íÍÕµµ…Éåô€‘í¥µÁ½ÉÑ]…É¹¥¹Íô!¥¹Ý•¥Ì¡”¤¥´…Ñ•¹¡•¬•™Õ¹‘•¸¸‘í•áÑÉ…õ€(€€€€€€€€€€€€€€è%µÁ½ÉÐ…‰•Í¡±½ÍÍ•¸è€‘íÍÕµµ…Éåô¥”M¥¡•ÉÕ¹œ‰±•¥‰Ð…Õ ¹… •¥¹•´9•Õ±…‘•¸•É¡…±Ñ•¸¸‘í•áÑÉ…õ€°(€€€€€€€€€€€­¥¹è¥µÁ½ÉÑ]…É¹¥¹Ì€ø€Àñð¥µÁ½ÉÑ]…É¹¥¹Í%¹Ñ•É¹…°¹±•¹Ñ €ü€Ý…É¹¥¹œœ€è€ÍÕ•ÍÌœ(€€€€€€€€€ôì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€€€€€¥˜€¡¥µÁ½ÉÑMÑ…ÉÑ•€˜˜€…¥µÁ½ÉÑ½µµ¥ÑÑ•€˜˜ÁÉ•Ù¥½ÕÍMÑ…Ñ•A…å±½…¤ì(€€€€€€€€€€€ÑÉäì(€€€€€€€€€€€€€ÍÑ…Ñ”€ô)M=8¹Á…ÉÍ”¡ÁÉ•Ù¥½ÕÍMÑ…Ñ•A…å±½…¤ì(€€€€€€€€€€€€€ÝÉ¥Ñ•MÑ…Ñ•A…å±½…‘Q½MÑ½É…”¡ÁÉ•Ù¥½ÕÍMÑ…Ñ•A…å±½…¤ì(€€€€€€€€€€€ô…Ñ €¡É½±±‰…­ÉÈ¤ì(€€€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È MÑ…¹Ù½È‘•´%µÁ½ÉÐ­½¹¹Ñ”¹¥¡ÐÙ½±±ÍÓ‘¹‘¥œÝ¥•‘•É¡•É•ÍÑ•±±ÐÝ•É‘•¸œ°É½±±‰…­ÉÈ¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€€€½¹Í½±”¹•ÉÉ½È 	…­ÕÀµ%µÁ½ÉÐ™•¡±•Í¡±…•¸œ°•ÉÈ¤ì(€€€€€€€€€Í•Ñ%¹±¥¹•MÑ…ÑÕÌ •¡±•È‰•¥´%µÁ½ÉÐè€œ€¬•ÉÈ¹µ•ÍÍ…”°€•ÉÉ½Èœ¤ì(€€€€€€€€€É•Í•Ñ%µÁ½ÉÑ	ÕÑÑ½¸ ¤ì(€€€€€€€ô(€€€€€ôì(€€€€€É•…‘•È¹½¹•ÉÉ½È€ô€ ¤€ôøì(€€€€€€€Í•Ñ%¹±¥¹•MÑ…ÑÕÌ ¥”…Ñ•¤­½¹¹Ñ”¹¥¡Ð•±•Í•¸Ý•É‘•¸¸œ°€•ÉÉ½Èœ¤ì(€€€€€€€¥µÁ½ÉÑ	Ñ¸¹‘¥Í…‰±•€ô™…±Í”ì(€€€€€€€¥µÁ½ÉÑ	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€M¥¡•ÉÕ¹œ•¥¹ÍÁ¥•±•¸œì(€€€€€ôì(€€€€€É•…‘•È¹É•…‘ÍQ•áÐ¡Í•±•Ñ•‘¥±”¤ì(€€€ô¤ì((€€€…É¹…ÁÁ•¹‘¡¥±¡É•ÍÑ½É•…É¤ì(€€€…É¹…ÁÁ•¹‘¡¥±¡…‘Ù…¹•‘•Ñ…¥±Ì¤ì(€€€Í…Ù•M•Ñ¥½¸¹…ÁÁ•¹‘¡¥±¡…É¤ì(€ô((€€¼¼!¥±™Í™Õ¹­Ñ¥½¹•¸éÕ´ÉÍÑ•±±•¸Ù½¸5½¹…ÑÍ…ÕÍÝ…¡°Õ¹1…‰•°µ%¹ÁÕÐµA……É•¸((€™Õ¹Ñ¥½¸Á…ÉÍ•M½ÉÑ…‰±•Y…±Õ”¡É…Ü¤ì(€€€½¹ÍÐÑ•áÐ€ô€¡É…Üñð€œœ¤¹É•Á±…” ¿
€½œ°€œ€œ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …Ñ•áÐñðÑ•áÐ€ôôô€œ´œ¤É•ÑÕÉ¸ìÑåÁ”è€Ñ•áÐœ°Ù…±Õ”è€œœôì(€€€¥˜€ ½yq‘ìÑôµq‘ìÉô¼¹Ñ•ÍÐ¡Ñ•áÐ¤¤É•ÑÕÉ¸ìÑåÁ”è€‘…Ñ”œ°Ù…±Õ”èÑ•áÐôì(€€€½¹ÍÐ¹½Éµ…±¥é•€ôÑ•áÐ(€€€€€€¹É•Á±…” ¿Š
°½œ°€œœ¤(€€€€€€¹É•Á±…” ½qÌ½œ°€œœ¤(€€€€€€¹É•Á±…” ½p¸½œ°€œœ¤(€€€€€€¹É•Á±…” ¼°½œ°€œ¸œ¤ì(€€€¥˜€ ½x´ýq¬ üép¹q¬¤ü¼¹Ñ•ÍÐ¡¹½Éµ…±¥é•¤¤ì(€€€€€É•ÑÕÉ¸ìÑåÁ”è€¹Õµ‰•Èœ°Ù…±Õ”èÁ…ÉÍ•±½…Ð¡¹½Éµ…±¥é•¤ôì(€€€ô(€€€É•ÑÕÉ¸ìÑåÁ”è€Ñ•áÐœ°Ù…±Õ”èÑ•áÐ¹Ñ½1½Ý•É…Í” ¤ôì(€ô((€™Õ¹Ñ¥½¸½µÁ…É•M½ÉÑ…‰±•Y…±Õ•Ì¡„°ˆ°‘¥É•Ñ¥½¸¤ì(€€€½¹ÍÐ‘¥È€ô‘¥É•Ñ¥½¸€ôôô€‘•ÍŒœ€ü€´Ä€è€Äì(€€€¥˜€¡„¹ÑåÁ”€ôôô€¹Õµ‰•Èœ€˜˜ˆ¹ÑåÁ”€ôôô€¹Õµ‰•Èœ¤ì(€€€€€É•ÑÕÉ¸€¡„¹Ù…±Õ”€´ˆ¹Ù…±Õ”¤€¨‘¥Èì(€€€ô(€€€¥˜€¡„¹ÑåÁ”€ôôô€‘…Ñ”œ€˜˜ˆ¹ÑåÁ”€ôôô€‘…Ñ”œ¤ì(€€€€€É•ÑÕÉ¸„¹Ù…±Õ”¹±½…±•½µÁ…É”¡ˆ¹Ù…±Õ”¤€¨‘¥Èì(€€€ô(€€€É•ÑÕÉ¸MÑÉ¥¹œ¡„¹Ù…±Õ”¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡ˆ¹Ù…±Õ”¤°€‘”œ¤€¨‘¥Èì(€ô((€™Õ¹Ñ¥½¸•¹…‰±•Q…‰±•M½ÉÑ¥¹œ ¤ì(€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° œ¹±¥ÍÐµÑ…‰±”œ¤¹™½É…  ¡Ñ…‰±”¤€ôøì(€€€€€½¹ÍÐÑ¡•…€ôÑ…‰±”¹ÅÕ•ÉåM•±•Ñ½È Ñ¡•…œ¤ì(€€€€€½¹ÍÐÑ‰½‘ä€ôÑ…‰±”¹ÅÕ•ÉåM•±•Ñ½È Ñ‰½‘äœ¤ì(€€€€€¥˜€ …Ñ¡•…ñð€…Ñ‰½‘ä¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ¡•…‘•ÉÌ€ôÉÉ…ä¹™É½´¡Ñ¡•…¹ÅÕ•ÉåM•±•Ñ½É±° Ñ œ¤¤ì(€€€€€¡•…‘•ÉÌ¹™½É…  ¡Ñ °¥¹‘•à¤€ôøì(€€€€€€€½¹ÍÐ±…‰•°€ô€¡Ñ ¹Ñ•áÑ½¹Ñ•¹Ðñð€œœ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤ì(€€€€€€€¥˜€¡l…­Ñ¥½¸œ°€‰•é…¡±Ðüœ°€ÍÑ…ÑÕÌt¹¥¹±Õ‘•Ì¡±…‰•°¤¤ì(€€€€€€€€€Ñ ¹ÍÑå±”¹ÕÉÍ½È€ô€‘•™…Õ±Ðœì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€Ñ ¹ÍÑå±”¹ÕÉÍ½È€ô€Á½¥¹Ñ•Èœì(€€€€€€€Ñ ¹Ñ¥Ñ±”€ô€iÕ´M½ÉÑ¥•É•¸…¹Ñ¥ÁÁ•¸œì(€€€€€€€Ñ ¹½¹±¥¬€ô€ ¤€ôøì(€€€€€€€€€½¹ÍÐÕÉÉ•¹Ñ%¹‘•à€ô9Õµ‰•È¡Ñ…‰±”¹‘…Ñ…Í•Ð¹Í½ÉÑ%¹‘•àñð€´Ä¤ì(€€€€€€€€€½¹ÍÐÕÉÉ•¹Ñ¥È€ôÑ…‰±”¹‘…Ñ…Í•Ð¹Í½ÉÑ¥Èñð€…ÍŒœì(€€€€€€€€€½¹ÍÐ¹•áÑ¥È€ôÕÉÉ•¹Ñ%¹‘•à€ôôô¥¹‘•à€˜˜ÕÉÉ•¹Ñ¥È€ôôô€…ÍŒœ€ü€‘•ÍŒœ€è€…ÍŒœì(€€€€€€€€€½¹ÍÐÉ½ÝÌ€ôÉÉ…ä¹™É½´¡Ñ‰½‘ä¹ÅÕ•ÉåM•±•Ñ½É±° ÑÈœ¤¤ì(€€€€€€€€€É½ÝÌ¹Í½ÉÐ ¡É½Ý°É½Ý¤€ôøì(€€€€€€€€€€€½¹ÍÐ…Q•áÐ€ôÉ½Ý¹¡¥±‘É•¹m¥¹‘•át€üÉ½Ý¹¡¥±‘É•¹m¥¹‘•át¹¥¹¹•ÉQ•áÐ€è€œœì(€€€€€€€€€€€½¹ÍÐ‰Q•áÐ€ôÉ½Ý¹¡¥±‘É•¹m¥¹‘•át€üÉ½Ý¹¡¥±‘É•¹m¥¹‘•át¹¥¹¹•ÉQ•áÐ€è€œœì(€€€€€€€€€€€É•ÑÕÉ¸½µÁ…É•M½ÉÑ…‰±•Y…±Õ•Ì¡Á…ÉÍ•M½ÉÑ…‰±•Y…±Õ”¡…Q•áÐ¤°Á…ÉÍ•M½ÉÑ…‰±•Y…±Õ”¡‰Q•áÐ¤°¹•áÑ¥È¤ì(€€€€€€€€€ô¤ì(€€€€€€€€€É½ÝÌ¹™½É…  ¡É½Ü¤€ôøÑ‰½‘ä¹…ÁÁ•¹‘¡¥±¡É½Ü¤¤ì(€€€€€€€€€Ñ…‰±”¹‘…Ñ…Í•Ð¹Í½ÉÑ%¹‘•à€ôMÑÉ¥¹œ¡¥¹‘•à¤ì(€€€€€€€€€Ñ…‰±”¹‘…Ñ…Í•Ð¹Í½ÉÑ¥È€ô¹•áÑ¥Èì(€€€€€€€€€¡•…‘•ÉÌ¹™½É…  ¡¡•…‘•È°¤¤€ôøì(€€€€€€€€€€€½¹ÍÐ‰…Í”€ô€¡¡•…‘•È¹‘…Ñ…Í•Ð¹‰…Í•1…‰•°ñð¡•…‘•È¹Ñ•áÑ½¹Ñ•¹Ðñð€œœ¤¹É•Á±…” ½qÍoŠGŠMt¼°€œœ¤ì(€€€€€€€€€€€¡•…‘•È¹‘…Ñ…Í•Ð¹‰…Í•1…‰•°€ô‰…Í”ì(€€€€€€€€€€€¥˜€¡¤€ôôô¥¹‘•à¤ì(€€€€€€€€€€€€€¡•…‘•È¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘í‰…Í•ô€‘í¹•áÑ¥È€ôôô€…ÍŒœ€ü€ŸŠDœ€è€ŸŠLõ€ì(€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€¡•…‘•È¹Ñ•áÑ½¹Ñ•¹Ð€ô‰…Í”ì(€€€€€€€€€€€ô(€€€€€€€€€ô¤ì(€€€€€€€ôì(€€€€€ô¤ì(€€€ô¤ì(€ô((€™Õ¹Ñ¥½¸É•…Ñ•5½¹Ñ¡M•±•Ð ¤ì(€€€½¹ÍÐÝÉ…ÁÁ•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€ÝÉ…ÁÁ•È¹±…ÍÍ9…µ”€ô€µ½¹Ñ µå•…ÈµÁ¥­•Èœì((€€€½¹ÍÐ™…±±‰…­5½¹Ñ €ô‘…Ñ•Q½5½¹Ñ¡-•ä¡¹•Ü…Ñ” ¤¤ì(€€€½¹ÍÐmÍ•±•Ñ•‘e•…È°Í•±•Ñ•‘5½¹Ñ¡9½t€ôMÑÉ¥¹œ¡¥Í5½¹Ñ¡-•ä¡ÕÉÉ•¹Ñ5½¹Ñ ¤€üÕÉÉ•¹Ñ5½¹Ñ €è™…±±‰…­5½¹Ñ ¤¹ÍÁ±¥Ð œ´œ¤ì(€€€½¹ÍÐµ½¹Ñ¡M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€µ½¹Ñ¡M•±•Ð¹±…ÍÍ9…µ”€ô€µ½¹Ñ µå•…ÈµÁ¥­•Èµµ½¹Ñ œì(€€€µ½¹Ñ¡M•±•Ð¹Í•ÑÑÑÉ¥‰ÕÑ” …É¥„µ±…‰•°œ°€5½¹…Ð…ÕÍß‘¡±•¸œ¤ì((€€€½¹ÍÐå•…ÉM•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€å•…ÉM•±•Ð¹±…ÍÍ9…µ”€ô€µ½¹Ñ µå•…ÈµÁ¥­•Èµå•…Èœì(€€€å•…ÉM•±•Ð¹Í•ÑÑÑÉ¥‰ÕÑ” …É¥„µ±…‰•°œ°€)…¡È…ÕÍß‘¡±•¸œ¤ì((€€€½¹ÍÐ…ÑÕ…±-•ä€ô‘…Ñ•Q½5½¹Ñ¡-•ä¡¹•Ü…Ñ” ¤¤ì(€€€½¹ÍÐ…ÑÕ…±e•…È€ô…ÑÕ…±-•ä¹Í±¥” À°€Ð¤ì(€€€½¹ÍÐ…ÑÕ…±5½¹Ñ¡9¼€ô…ÑÕ…±-•ä¹Í±¥” Ô°€Ü¤ì((€€€½¹ÍÐµ½¹Ñ¡9…µ•Ì€ôÉÉ…ä¹™É½´¡ì±•¹Ñ è€ÄÈô°€¡|°¥¹‘•à¤€ôøì(€€€€€½¹ÍÐµ½¹Ñ €ôMÑÉ¥¹œ¡¥¹‘•à€¬€Ä¤¹Á…‘MÑ…ÉÐ È°€œÀœ¤ì(€€€€€½¹ÍÐ±…‰•°€ô¹•Ü…Ñ” ÈÀÀÀ°¥¹‘•à°€Ä¤¹Ñ½1½…±•…Ñ•MÑÉ¥¹œ ‘”µœ°ìµ½¹Ñ è€±½¹œœô¤ì(€€€€€É•ÑÕÉ¸ìµ½¹Ñ °±…‰•°è±…‰•°¹¡…ÉÐ À¤¹Ñ½UÁÁ•É…Í” ¤€¬±…‰•°¹Í±¥” Ä¤ôì(€€€ô¤ì((€€€µ½¹Ñ¡9…µ•Ì¹™½É…  ¡ìµ½¹Ñ °±…‰•°ô¤€ôøì(€€€€€½¹ÍÐ½ÁÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€½¹ÍÐ½ÁÑ¥½¹-•ä€ô€‘íÍ•±•Ñ•‘e•…Éô´‘íµ½¹Ñ¡õ€ì(€€€€€½ÁÐ¹Ù…±Õ”€ôµ½¹Ñ ì(€€€€€½ÁÐ¹Ñ•áÑ½¹Ñ•¹Ð€ô±…‰•°ì(€€€€€¥˜€¡½ÁÑ¥½¹-•ä€ðAA}%IMQ}Q}5=9Q ¤ì(€€€€€€€½ÁÐ¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€€€€€½ÁÐ¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘í±…‰•±ôƒ
ÜÙ½ÈÁÀµMÑ…ÉÑ€ì(€€€€€ô(€€€€€¥˜€¡µ½¹Ñ €ôôôÍ•±•Ñ•‘5½¹Ñ¡9¼¤½ÁÐ¹Í•±•Ñ•€ôÑÉÕ”ì(€€€€€µ½¹Ñ¡M•±•Ð¹…ÁÁ•¹‘¡¥±¡½ÁÐ¤ì(€€€ô¤ì((€€€½¹ÍÐå•…ÉÌ€ô¹•ÜM•Ð ¤ì(€€€½¹ÍÐµ¥¹e•…È€ô9Õµ‰•È¡AA}%IMQ}Q}5=9Q ¹Í±¥” À°€Ð¤¤ì(€€€½¹ÍÐ…ÑÕ…±e•…É9Õµ‰•È€ô9Õµ‰•È¡…ÑÕ…±e•…È¤ì(€€€½¹ÍÐÍ•±•Ñ•‘e•…É9Õµ‰•È€ô9Õµ‰•È¡Í•±•Ñ•‘e•…È¤ì(€€€½¹ÍÐµ…áe•…È€ô5…Ñ ¹µ…à (€€€€€…ÑÕ…±e•…É9Õµ‰•È€¬AA}UQUI}eI}I9°(€€€€€9Õµ‰•È¹¥Í¥¹¥Ñ”¡Í•±•Ñ•‘e•…É9Õµ‰•È¤€üÍ•±•Ñ•‘e•…É9Õµ‰•È€è…ÑÕ…±e•…É9Õµ‰•È(€€€€¤ì((€€€™½È€¡±•Ðå•…È€ôµ¥¹e•…Èìå•…È€ðôµ…áe•…Èìå•…È€¬ô€Ä¤ì(€€€€€å•…ÉÌ¹…‘¡MÑÉ¥¹œ¡å•…È¤¤ì(€€€ô(€€€€¡µ½¹Ñ¡1¥ÍÐñðmt¤¹™½É…  ¡´¤€ôøì(€€€€€¥˜€¡´€˜˜¥Í5½¹Ñ¡-•ä¡´¹­•ä¤¤å•…ÉÌ¹…‘¡´¹­•ä¹Í±¥” À°€Ð¤¤ì(€€€ô¤ì(€€€å•…ÉÌ¹…‘¡Í•±•Ñ•‘e•…È¤ì(€€€å•…ÉÌ¹…‘¡…ÑÕ…±e•…È¤ì(€€€ÉÉ…ä¹™É½´¡å•…ÉÌ¤¹Í½ÉÐ ¤¹™½É…  ¡å•…È¤€ôøì(€€€€€½¹ÍÐ½ÁÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ½ÁÑ¥½¸œ¤ì(€€€€€½ÁÐ¹Ù…±Õ”€ôå•…Èì(€€€€€½ÁÐ¹Ñ•áÑ½¹Ñ•¹Ð€ôå•…Èì(€€€€€¥˜€¡å•…È€ôôôÍ•±•Ñ•‘e•…È¤½ÁÐ¹Í•±•Ñ•€ôÑÉÕ”ì(€€€€€å•…ÉM•±•Ð¹…ÁÁ•¹‘¡¥±¡½ÁÐ¤ì(€€€ô¤ì((€€€=‰©•Ð¹‘•™¥¹•AÉ½Á•ÉÑä¡ÝÉ…ÁÁ•È°€Ù…±Õ”œ°ì(€€€€€½¹™¥ÕÉ…‰±”èÑÉÕ”°(€€€€€•Ð ¤ì(€€€€€€€É•ÑÕÉ¸€‘íå•…ÉM•±•Ð¹Ù…±Õ•ô´‘íµ½¹Ñ¡M•±•Ð¹Ù…±Õ•õ€ì(€€€€€ô(€€€ô¤ì((€€€½¹ÍÐ•µ¥Ñ½µ‰¥¹•‘¡…¹”€ô€¡•Ù•¹Ð¤€ôøì(€€€€€¥˜€¡•Ù•¹Ð€˜˜ÑåÁ•½˜•Ù•¹Ð¹ÍÑ½ÁAÉ½Á……Ñ¥½¸€ôôô€™Õ¹Ñ¥½¸œ¤•Ù•¹Ð¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€¥˜€¡€‘íå•…ÉM•±•Ð¹Ù…±Õ•ô´‘íµ½¹Ñ¡M•±•Ð¹Ù…±Õ•õ€€ðAA}%IMQ}Q}5=9Q ¤ì(€€€€€€€½¹ÍÐmµ¥¹e•…È°µ¥¹5½¹Ñ¡t€ôAA}%IMQ}Q}5=9Q ¹ÍÁ±¥Ð œ´œ¤ì(€€€€€€€å•…ÉM•±•Ð¹Ù…±Õ”€ôµ¥¹e•…Èì(€€€€€€€µ½¹Ñ¡M•±•Ð¹Ù…±Õ”€ôµ¥¹5½¹Ñ ì(€€€€€ô(€€€€€ÝÉ…ÁÁ•È¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ¡…¹”œ°ì‰Õ‰‰±•ÌèÑÉÕ”ô¤¤ì(€€€ôì(€€€µ½¹Ñ¡M•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°•µ¥Ñ½µ‰¥¹•‘¡…¹”¤ì(€€€å•…ÉM•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°•µ¥Ñ½µ‰¥¹•‘¡…¹”¤ì((€€€ÝÉ…ÁÁ•È¹…ÁÁ•¹‘¡¥±¡µ½¹Ñ¡M•±•Ð¤ì(€€€ÝÉ…ÁÁ•È¹…ÁÁ•¹‘¡¥±¡å•…ÉM•±•Ð¤ì(€€€É•ÑÕÉ¸ÝÉ…ÁÁ•Èì(€ô(€™Õ¹Ñ¥½¸ÕÁ‘…Ñ•5½¹Ñ¡1¥ÍÑ%™9••‘• ¤ì(€€€¥˜€ …µ½¹Ñ¡1¥ÍÐ¹™¥¹ ¡´¤€ôø´¹­•ä€ôôôÕÉÉ•¹Ñ5½¹Ñ ¤¤ì(€€€€€µ½¹Ñ¡1¥ÍÐ€ô•ÑM•±•Ñ…‰±•5½¹Ñ¡Ì¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€ô(€ô((€™Õ¹Ñ¥½¸Í•ÑÕÉÉ•¹Ñ5½¹Ñ ¡µ½¹Ñ¡-•ä°Á•ÉÍ¥ÍÐ€ôÑÉÕ”¤ì(€€€¥˜€ …¥Í5½¹Ñ¡-•ä¡µ½¹Ñ¡-•ä¤¤É•ÑÕÉ¸ì(€€€¥˜€¡µ½¹Ñ¡-•ä€ðAA}%IMQ}Q}5=9Q ¤µ½¹Ñ¡-•ä€ôAA}%IMQ}Q}5=9Q ì(€€€ÕÉÉ•¹Ñ5½¹Ñ €ôµ½¹Ñ¡-•äì(€€€ÕÁ‘…Ñ•5½¹Ñ¡1¥ÍÑ%™9••‘• ¤ì(€€€¥˜€¡Á•ÉÍ¥ÍÐ¤ì(€€€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹Í•±•Ñ•‘5½¹Ñ €ôµ½¹Ñ¡-•äì(€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€ô(€ô((€™Õ¹Ñ¥½¸Íå¹ÕÉÉ•¹Ñ5½¹Ñ¡Q½ÑÕ…±…Ñ” ¤ì(€€€½¹ÍÐ…ÑÕ…±5½¹Ñ €ô‘…Ñ•Q½5½¹Ñ¡-•ä¡¹•Ü…Ñ” ¤¤ì(€€€¹½Éµ…±¥é•ÁÁ5•Ñ„ ¤ì(€€€±•Ð¡…¹•€ô™…±Í”ì(€€€¥˜€¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½5½¹Ñ¡¡•¬€„ôô…ÑÕ…±5½¹Ñ ¤ì(€€€€€ÕÉÉ•¹Ñ5½¹Ñ €ô…ÑÕ…±5½¹Ñ ì(€€€€€µ½¹Ñ¡1¥ÍÐ€ô•ÑM•±•Ñ…‰±•5½¹Ñ¡Ì¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑÕÑ½5½¹Ñ¡¡•¬€ô…ÑÕ…±5½¹Ñ ì(€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹Í•±•Ñ•‘5½¹Ñ €ô…ÑÕ…±5½¹Ñ ì(€€€€€¡…¹•€ôÑÉÕ”ì(€€€ô(€€€¥˜€¡ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑAÉ•Á…É•‘5½¹Ñ €„ôô…ÑÕ…±5½¹Ñ ¤ì(€€€€€Íå¹Õ•±Q½ÁUÁáÁ•¹Í•Ì¡…ÑÕ…±5½¹Ñ ¤ì(€€€€€Íå¹É½•ÉåQ½ÁUÁáÁ•¹Í”¡…ÑÕ…±5½¹Ñ ¤ì(€€€€€Íå¹±±1¥¹­•‘•‰ÑI…Ñ•ÍÉ½µA½ÍÑÌ¡…ÑÕ…±5½¹Ñ °€ÌØ°ìÍ¥±•¹ÐèÑÉÕ”ô¤ì(€€€€€ÍÑ…Ñ”¹…ÁÁ5•Ñ„¹±…ÍÑAÉ•Á…É•‘5½¹Ñ €ô…ÑÕ…±5½¹Ñ ì(€€€€€…‘‘¡…¹•1½œ (€€€€€€€€5½¹…ÑÍÍÑ…ÉÐœ°(€€€€€€€€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡…ÑÕ…±5½¹Ñ ¥ô…ÕÑ½µ…Ñ¥Í Ù½É‰•É•¥Ñ•Ðè±…Õ™•¹‘”-½ÍÑ•¸°Õ™ÍÑ½­Õ¹•¸Õ¹Ù•É­»ñÁ™Ñ”M¡Õ±‘•¹É…Ñ•¸•ÁËñ™Ð¹€°(€€€€€€€…ÑÕ…±5½¹Ñ (€€€€€€¤ì(€€€€€¡…¹•€ôÑÉÕ”ì(€€€ô(€€€¥˜€¡¡…¹•¤Í…Ù•MÑ…Ñ” ¤ì(€€€É•ÑÕÉ¸¡…¹•ì(€ô((€™Õ¹Ñ¥½¸É•…Ñ•MÕµµ…Éå5•ÑÉ¥Ì¡¥Ñ•µÌ¤ì(€€€½¹ÍÐÝÉ…À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€ÝÉ…À¹±…ÍÍ9…µ”€ô€ÍÕµµ…Éäµµ•ÑÉ¥Ìœì(€€€¥Ñ•µÌ¹™½É…  ¡¥Ñ•´¤€ôøì(€€€€€½¹ÍÐ‰½à€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€‰½à¹±…ÍÍ9…µ”€ôÍÕµµ…Éäµµ•ÑÉ¥Œ€‘í¥Ñ•´¹­¥¹ñð€œõ€¹ÑÉ¥´ ¤ì(€€€€€½¹ÍÐ±…‰•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€±…‰•°¹±…ÍÍ9…µ”€ô€ÍÕµµ…Éäµµ•ÑÉ¥Œµ±…‰•°œì(€€€€€±…‰•°¹Ñ•áÑ½¹Ñ•¹Ð€ô¥Ñ•´¹±…‰•°ì(€€€€€½¹ÍÐÙ…±Õ”€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€Ù…±Õ”¹±…ÍÍ9…µ”€ô€ÍÕµµ…Éäµµ•ÑÉ¥ŒµÙ…±Õ”œì(€€€€€Ù…±Õ”¹¥¹¹•É!Q50€ô¥Ñ•´¹Ù…±Õ”ì(€€€€€‰½à¹…ÁÁ•¹‘¡¥±¡±…‰•°¤ì(€€€€€‰½à¹…ÁÁ•¹‘¡¥±¡Ù…±Õ”¤ì(€€€€€¥˜€¡¥Ñ•´¹¡¥¹Ð¤ì(€€€€€€€½¹ÍÐ¡¥¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€€€¡¥¹Ð¹±…ÍÍ9…µ”€ô€ÍÕµµ…Éäµµ•ÑÉ¥Œµ¡¥¹Ðœì(€€€€€€€¡¥¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô¥Ñ•´¹¡¥¹Ðì(€€€€€€€‰½à¹…ÁÁ•¹‘¡¥±¡¡¥¹Ð¤ì(€€€€€ô(€€€€€ÝÉ…À¹…ÁÁ•¹‘¡¥±¡‰½à¤ì(€€€ô¤ì(€€€É•ÑÕÉ¸ÝÉ…Àì(€ô((€±•Ð™½Éµ¥•±‘M•ÅÕ•¹”€ô€Àì((€™Õ¹Ñ¥½¸É•…Ñ•1…‰•±%¹ÁÕÐ¡±…‰•±Q•áÐ°¥¹ÁÕÑ°¤ì(€€€½¹ÍÐÝÉ…ÁÁ•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹ÍÐ±‰°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±…‰•°œ¤ì(€€€±‰°¹Ñ•áÑ½¹Ñ•¹Ð€ô±…‰•±Q•áÐì(€€€½¹ÍÐ±…‰•±Q…É•Ð€ô¥¹ÁÕÑ°€˜˜¥¹ÁÕÑ°¹µ…Ñ¡•Ì€˜˜¥¹ÁÕÑ°¹µ…Ñ¡•Ì ¥¹ÁÕÐ°Í•±•Ð°Ñ•áÑ…É•„°‰ÕÑÑ½¸œ¤(€€€€€€ü¥¹ÁÕÑ°(€€€€€€è¹Õ±°ì(€€€¥˜€¡±…‰•±Q…É•Ð¤ì(€€€€€™½Éµ¥•±‘M•ÅÕ•¹”€¬ô€Äì(€€€€€¥˜€ …±…‰•±Q…É•Ð¹¥¤±…‰•±Q…É•Ð¹¥€ô™½É´µ™¥•±´‘í™½Éµ¥•±‘M•ÅÕ•¹•õ€ì(€€€€€±‰°¹¡Ñµ±½È€ô±…‰•±Q…É•Ð¹¥ì(€€€ô(€€€ÝÉ…ÁÁ•È¹…ÁÁ•¹‘¡¥±¡±‰°¤ì(€€€ÝÉ…ÁÁ•È¹…ÁÁ•¹‘¡¥±¡¥¹ÁÕÑ°¤ì(€€€É•ÑÕÉ¸ÝÉ…ÁÁ•Èì(€ô((€™Õ¹Ñ¥½¸Í¡½Ý5½‘…°¡Ñ¥Ñ±”°½¹Ñ•¹Ñ°°‰ÕÑÑ½¹Ì€ômt¤ì(€€€½¹ÍÐÁÉ•Ù¥½ÕÍ±å½ÕÍ•€ô‘½Õµ•¹Ð¹…Ñ¥Ù•±•µ•¹Ð¥¹ÍÑ…¹•½˜!Q51±•µ•¹Ð€ü‘½Õµ•¹Ð¹…Ñ¥Ù•±•µ•¹Ð€è¹Õ±°ì(€€€½¹ÍÐ½Ù•É±…ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½Ù•É±…ä¹±…ÍÍ9…µ”€ô€…ÁÀµµ½‘…°µ½Ù•É±…äœì(€€€½¹ÍÐÁ…¹•°€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Á…¹•°¹±…ÍÍ9…µ”€ô€…ÁÀµµ½‘…°œì(€€€Á…¹•°¹Í•ÑÑÑÉ¥‰ÕÑ” É½±”œ°€‘¥…±½œœ¤ì(€€€Á…¹•°¹Í•ÑÑÑÉ¥‰ÕÑ” …É¥„µµ½‘…°œ°€ÑÉÕ”œ¤ì(€€€½¹ÍÐ¡•…‘•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¡•…‘•È¹±…ÍÍ9…µ”€ô€…ÁÀµµ½‘…°µ¡•…‘•Èœì(€€€½¹ÍÐ¡•…‘¥¹œ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð  Ìœ¤ì(€€€½¹ÍÐ¡•…‘¥¹%€ôµ½‘…°µÑ¥Ñ±”´‘í•¹•É…Ñ•% ¥õ€ì(€€€¡•…‘¥¹œ¹¥€ô¡•…‘¥¹%ì(€€€¡•…‘¥¹œ¹Ñ•áÑ½¹Ñ•¹Ð€ôÑ¥Ñ±”ì(€€€Á…¹•°¹Í•ÑÑÑÉ¥‰ÕÑ” …É¥„µ±…‰•±±•‘‰äœ°¡•…‘¥¹%¤ì(€€€½¹ÍÐ±½Í•	Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€±½Í•	Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€±½Í•	Ñ¸¹±…ÍÍ9…µ”€ô€Í•½¹‘…Éä…ÁÀµµ½‘…°µ±½Í”œì(€€€±½Í•	Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô€Ÿ\œì(€€€±½Í•	Ñ¸¹Í•ÑÑÑÉ¥‰ÕÑ” …É¥„µ±…‰•°œ°€¥…±½œÍ¡±¥—}•¸œ¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡¡•…‘¥¹œ¤ì(€€€¡•…‘•È¹…ÁÁ•¹‘¡¥±¡±½Í•	Ñ¸¤ì((€€€½¹ÍÐ‰½‘ä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€‰½‘ä¹±…ÍÍ9…µ”€ô€…ÁÀµµ½‘…°µ‰½‘äœì(€€€¥˜€¡½¹Ñ•¹Ñ°¤‰½‘ä¹…ÁÁ•¹‘¡¥±¡½¹Ñ•¹Ñ°¤ì((€€€½¹ÍÐ™½½Ñ•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€™½½Ñ•È¹±…ÍÍ9…µ”€ô€…ÁÀµµ½‘…°µ™½½Ñ•Èœì((€€€Á…¹•°¹…ÁÁ•¹‘¡¥±¡¡•…‘•È¤ì(€€€Á…¹•°¹…ÁÁ•¹‘¡¥±¡‰½‘ä¤ì(€€€Á…¹•°¹…ÁÁ•¹‘¡¥±¡™½½Ñ•È¤ì(€€€½Ù•É±…ä¹…ÁÁ•¹‘¡¥±¡Á…¹•°¤ì((€€€½¹ÍÐ±½Í”€ô€ ¤€ôøì(€€€€€¥˜€ …½Ù•É±…ä¹¥Í½¹¹•Ñ•¤É•ÑÕÉ¸ì(€€€€€‘½Õµ•¹Ð¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È ­•å‘½Ý¸œ°½¹-•å½Ý¸¤ì(€€€€€½Ù•É±…ä¹É•µ½Ù” ¤ì(€€€€€¥˜€ …‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È œ¹…ÁÀµµ½‘…°µ½Ù•É±…äœ¤¤‘½Õµ•¹Ð¹‰½‘ä¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” µ½‘…°µ½Á•¸œ¤ì(€€€€€¥˜€¡ÁÉ•Ù¥½ÕÍ±å½ÕÍ•€˜˜ÁÉ•Ù¥½ÕÍ±å½ÕÍ•¹¥Í½¹¹•Ñ•¤ì(€€€€€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøÁÉ•Ù¥½ÕÍ±å½ÕÍ•¹™½ÕÌ ¤°€À¤ì(€€€€€ô(€€€ôì(€€€½¹ÍÐ½¹-•å½Ý¸€ô€¡•Ù•¹Ð¤€ôøì(€€€€€¥˜€¡•Ù•¹Ð¹­•ä€ôôô€Í…Á”œ¤ì(€€€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€€€±½Í” ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€¥˜€¡•Ù•¹Ð¹­•ä€„ôô€Q…ˆœ¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ™½ÕÍ…‰±”€ôÉÉ…ä¹™É½´¡Á…¹•°¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€€€‰ÕÑÑ½¸é¹½Ð¡m‘¥Í…‰±•‘t¤°¥¹ÁÕÐé¹½Ð¡m‘¥Í…‰±•‘t¤°Í•±•Ðé¹½Ð¡m‘¥Í…‰±•‘t¤°Ñ•áÑ…É•„é¹½Ð¡m‘¥Í…‰±•‘t¤°…m¡É•™t°mÑ…‰¥¹‘•áté¹½Ð¡mÑ…‰¥¹‘•àôˆ´Ä‰t¤œ(€€€€€€¤¤¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø€…•±•µ•¹Ð¹¡¥‘‘•¸€˜˜•±•µ•¹Ð¹•ÑÑÑÉ¥‰ÕÑ” …É¥„µ¡¥‘‘•¸œ¤€„ôô€ÑÉÕ”œ¤ì(€€€€€¥˜€ …™½ÕÍ…‰±”¹±•¹Ñ ¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ™¥ÉÍÐ€ô™½ÕÍ…‰±•lÁtì(€€€€€½¹ÍÐ±…ÍÐ€ô™½ÕÍ…‰±•m™½ÕÍ…‰±”¹±•¹Ñ €´€Åtì(€€€€€¥˜€¡•Ù•¹Ð¹Í¡¥™Ñ-•ä€˜˜‘½Õµ•¹Ð¹…Ñ¥Ù•±•µ•¹Ð€ôôô™¥ÉÍÐ¤ì(€€€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€€€±…ÍÐ¹™½ÕÌ ¤ì(€€€€€ô•±Í”¥˜€ …•Ù•¹Ð¹Í¡¥™Ñ-•ä€˜˜‘½Õµ•¹Ð¹…Ñ¥Ù•±•µ•¹Ð€ôôô±…ÍÐ¤ì(€€€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€€€™¥ÉÍÐ¹™½ÕÌ ¤ì(€€€€€ô(€€€ôì((€€€±½Í•	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°±½Í”¤ì(€€€½Ù•É±…ä¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€¡•Ù•¹Ð¤€ôøì(€€€€€¥˜€¡•Ù•¹Ð¹Ñ…É•Ð€ôôô½Ù•É±…ä¤±½Í” ¤ì(€€€ô¤ì((€€€‰ÕÑÑ½¹Ì¹™½É…  ¡½¹™¥œ¤€ôøì(€€€€€½¹ÍÐ‰Ñ¸€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰ÕÑÑ½¸œ¤ì(€€€€€‰Ñ¸¹ÑåÁ”€ô€‰ÕÑÑ½¸œì(€€€€€‰Ñ¸¹Ñ•áÑ½¹Ñ•¹Ð€ô½¹™¥œ¹±…‰•°ì(€€€€€‰Ñ¸¹±…ÍÍ9…µ”€ô½¹™¥œ¹±…ÍÍ9…µ”ñð€Í•½¹‘…Éäœì(€€€€€‰Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì(€€€€€€€¥˜€¡ÑåÁ•½˜½¹™¥œ¹½¹±¥¬€ôôô€™Õ¹Ñ¥½¸œ¤½¹™¥œ¹½¹±¥¬¡±½Í”¤ì(€€€€€€€•±Í”±½Í” ¤ì(€€€€€ô¤ì(€€€€€™½½Ñ•È¹…ÁÁ•¹‘¡¥±¡‰Ñ¸¤ì(€€€ô¤ì((€€€‘½Õµ•¹Ð¹‰½‘ä¹…ÁÁ•¹‘¡¥±¡½Ù•É±…ä¤ì(€€€‘½Õµ•¹Ð¹‰½‘ä¹±…ÍÍ1¥ÍÐ¹…‘ µ½‘…°µ½Á•¸œ¤ì(€€€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ­•å‘½Ý¸œ°½¹-•å½Ý¸¤ì((€€€½¹ÍÐ¥¹¥Ñ¥…±½ÕÌ€ôÁ…¹•°¹ÅÕ•ÉåM•±•Ñ½È ¥¹ÁÕÐé¹½Ð¡m‘¥Í…‰±•‘t¤°Í•±•Ðé¹½Ð¡m‘¥Í…‰±•‘t¤°Ñ•áÑ…É•„é¹½Ð¡m‘¥Í…‰±•‘t¤°€¹…ÁÀµµ½‘…°µ‰½‘ä‰ÕÑÑ½¸é¹½Ð¡m‘¥Í…‰±•‘t¤œ¤(€€€€€ñð±½Í•	Ñ¸ì(€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôø¥¹¥Ñ¥…±½ÕÌ¹™½ÕÌ ¤°€À¤ì(€€€É•ÑÕÉ¸ì½Ù•É±…ä°Á…¹•°°‰½‘ä°™½½Ñ•È°±½Í”ôì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝA•ÉÍ½¹%¹½µ•‘¥Ñ½È¡Á•ÉÍ½¸¤ì(€€€•¹ÍÕÉ•A•ÉÍ½¹%¹½µ•½¹™¥œ¡Á•ÉÍ½¸¤ì(€€€½¹ÍÐÉ•™Ì€ôíôì(€€€½¹ÍÐ½¹Ñ•¹Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€½¹Ñ•¹Ð¹±…ÍÍ9…µ”€ô€µ½‘…°µ™½É´œì((€€€½¹ÍÐ…Ñ¥Ù•9•Ñ½É5½¹Ñ €ô•ÑA•ÉÍ½¹9•Ð¡Á•ÉÍ½¸°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐÁ…åÉ½±±•‘ÕÑ¥½¸€ô•ÑA…åÉ½±±•‘ÕÑ¥½¹½ÉA•ÉÍ½¸¡Á•ÉÍ½¸°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€½¹ÍÐÍ½ÕÉ•1…‰•°€ô•ÑA•ÉÍ½¹9•ÑM½ÕÉ•1…‰•°¡Á•ÉÍ½¸°ÕÉÉ•¹Ñ5½¹Ñ ¤ì((€€€½¹ÍÐÕÉÉ•¹Ñ%¹™¼€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€ÕÉÉ•¹Ñ%¹™¼¹±…ÍÍ9…µ”€ô€Íµ…±°œì(€€€ÕÉÉ•¹Ñ%¹™¼¹¥¹¹•É!Q50€ô€ñÍÑÉ½¹œùY•ÉÝ•¹‘•Ð¥¸€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥ôèð½ÍÑÉ½¹œø€‘í•ÕÉ¼¡…Ñ¥Ù•9•Ñ½É5½¹Ñ ¥ô€ñÍÁ…¸±…ÍÌô‰µÕÑ•ˆø ‘íÍ½ÕÉ•1…‰•±ô¤ð½ÍÁ…¸ù€ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡ÕÉÉ•¹Ñ%¹™¼¤ì((€€€½¹ÍÐ¥‘•¹Ñ¥ÑåI½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¥‘•¹Ñ¥ÑåI½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹¹…µ•%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹¹…µ•%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€É•™Ì¹¹…µ•%¹ÁÕÐ¹Ù…±Õ”€ôÁ•ÉÍ½¸¹¹…µ”ñð€œœì(€€€É•™Ì¹Í¡¥™Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹Í¡¥™Ñ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€É•™Ì¹Í¡¥™Ñ%¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€É•™Ì¹Í¡¥™Ñ%¹ÁÕÐ¹Ù…±Õ”€ô9Õµ‰•È¡Á•ÉÍ½¸¹Í¡¥™Ðñð€À¤ì(€€€¥‘•¹Ñ¥ÑåI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9…µ”œ°É•™Ì¹¹…µ•%¹ÁÕÐ¤¤ì(€€€¥‘•¹Ñ¥ÑåI½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ 9½Éµ…±”Y•ÉÍ¡¥•‰Õ¹œœ°É•™Ì¹Í¡¥™Ñ%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¥‘•¹Ñ¥ÑåI½Ü¤ì((€€€½¹ÍÐÍ¡¥™Ñ=Ù•ÉÉ¥‘•I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€Í¡¥™Ñ=Ù•ÉÉ¥‘•I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹µ½¹Ñ¡M¡¥™Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹µ½¹Ñ¡M¡¥™Ñ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€É•™Ì¹µ½¹Ñ¡M¡¥™Ñ%¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€É•™Ì¹µ½¹Ñ¡M¡¥™Ñ%¹ÁÕÐ¹Á±…•¡½±‘•È€ô€±••È€ô¹½Éµ…±”Y•ÉÍ¡¥•‰Õ¹œœì(€€€¥˜€¡Á•ÉÍ½¸¹Í¡¥™Ñ=Ù•ÉÉ¥‘•Ì€˜˜Á•ÉÍ½¸¹Í¡¥™Ñ=Ù•ÉÉ¥‘•ÍmÕÉÉ•¹Ñ5½¹Ñ¡t€„ô¹Õ±°¤ì(€€€€€É•™Ì¹µ½¹Ñ¡M¡¥™Ñ%¹ÁÕÐ¹Ù…±Õ”€ô™½Éµ…Ñ9Õµ‰•É%¹ÁÕÐ¡9Õµ‰•È¡Á•ÉÍ½¸¹Í¡¥™Ñ=Ù•ÉÉ¥‘•ÍmÕÉÉ•¹Ñ5½¹Ñ¡t¤¤ì(€€€ô(€€€Í¡¥™Ñ=Ù•ÉÉ¥‘•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ¡Y•ÉÍ¡¥•‰Õ¹œ¹ÕÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€°É•™Ì¹µ½¹Ñ¡M¡¥™Ñ%¹ÁÕÐ¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Í¡¥™Ñ=Ù•ÉÉ¥‘•I½Ü¤ì((€€€½¹ÍÐ¥¹½µ•I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€¥¹½µ•I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹¹•Ý9•Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹¹•Ý9•Ñ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€É•™Ì¹¹•Ý9•Ñ%¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€É•™Ì¹¹•Ý9•Ñ%¹ÁÕÐ¹Ù…±Õ”€ô5…Ñ ¹µ…à À°…Ñ¥Ù•9•Ñ½É5½¹Ñ €´Á…åÉ½±±•‘ÕÑ¥½¸¤¹Ñ½¥á• È¤ì(€€€É•™Ì¹µ½‘•M•±•Ð€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Í•±•Ðœ¤ì(€€€É•™Ì¹µ½‘•M•±•Ð¹¥¹¹•É!Q50€ô€(€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰½¹”ˆùQ…ÑÏ‘¡±¥¡”ÕÍé…¡±Õ¹œ¹ÕÈ‘¥•Í•È5½¹…Ðð½½ÁÑ¥½¸ø(€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ô‰™ÕÑÕÉ”ˆùÉÕ¹‘±½¡¸€¼A±…¹Ý•ÉÐ…ˆ‘¥•Í•´5½¹…Ðð½½ÁÑ¥½¸ø(€€€€ì(€€€É•™Ì¹µ½‘•M•±•Ð¹Ù…±Õ”€ô€½¹”œì(€€€¥¹½µ•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ¡	•ÑÉ…œ›ñÈ€‘í™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¥õ€°É•™Ì¹¹•Ý9•Ñ%¹ÁÕÐ¤¤ì(€€€¥¹½µ•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ MÁ•¥¡•É¸…±Ìœ°É•™Ì¹µ½‘•M•±•Ð¤¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¥¹½µ•I½Ü¤ì(€€€±•Ð¥¹½µ•¹ÑÉå5½‘”€ô€½¹”œì(€€€É•™Ì¹µ½‘•M•±•Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€ ¤€ôøì(€€€€€½¹ÍÐ¹•áÑ5½‘”€ôÉ•™Ì¹µ½‘•M•±•Ð¹Ù…±Õ”€ôôô€½¹”œ€ü€½¹”œ€è€™ÕÑÕÉ”œì(€€€€€¥˜€¡Á…åÉ½±±•‘ÕÑ¥½¸€ø€À€˜˜¹•áÑ5½‘”€„ôô¥¹½µ•¹ÑÉå5½‘”¤ì(€€€€€€€½¹ÍÐ•¹Ñ•É•€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡É•™Ì¹¹•Ý9•Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€¥˜€¡9Õµ‰•È¹¥Í¥¹¥Ñ”¡•¹Ñ•É•¤¤ì(€€€€€€€€€½¹ÍÐ…‘©ÕÍÑ•€ô¹•áÑ5½‘”€ôôô€™ÕÑÕÉ”œ€ü•¹Ñ•É•€¬Á…åÉ½±±•‘ÕÑ¥½¸€è•¹Ñ•É•€´Á…åÉ½±±•‘ÕÑ¥½¸ì(€€€€€€€€€É•™Ì¹¹•Ý9•Ñ%¹ÁÕÐ¹Ù…±Õ”€ô5…Ñ ¹µ…à À°…‘©ÕÍÑ•¤¹Ñ½¥á• È¤ì(€€€€€€€ô(€€€€€ô(€€€€€¥¹½µ•¹ÑÉå5½‘”€ô¹•áÑ5½‘”ì(€€€ô¤ì(€€€½¹ÍÐÁ…åÉ½±±!•±À€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€Á…åÉ½±±!•±À¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€Á…åÉ½±±!•±À¹Ñ•áÑ½¹Ñ•¹Ð€ôÁ…åÉ½±±•‘ÕÑ¥½¸€ø€À(€€€€€€ü	•¤Ñ…ÑÏ‘¡±¥¡•ÈÕÍé…¡±Õ¹œ¥‰ÍÐ‘Ô‘•¸-½¹Ñ½•¥¹…¹œ•¥¸ì‘¥”‰ÑÉ•ÑÕ¹œÙ½¸€‘í•ÕÉ¼¡Á…åÉ½±±•‘ÕÑ¥½¸¥ôÝ¥É…ÕÑ½µ…Ñ¥Í •ÉŸ‘¹éÐ¸	•¤•¥¹•´‘…Õ•É¡…™Ñ•¸A±…¹Ý•ÉÐÝ¥É‘…ÌÙ½±±ÍÓ‘¹‘¥”9•ÑÑ¼•¥¹Í¡±¥—}±¥ ‰ÑÉ•ÑÕ¹œ•ÍÁ•¥¡•ÉÐ¹€(€€€€€€è€	•¤•¥¹•ÈÑ…ÑÏ‘¡±¥¡•¸ÕÍé…¡±Õ¹œ¥‰ÍÐ‘Ô‘•¸	•ÑÉ…œ•¥¸°‘•È…Õ˜‘•´-½¹Ñ¼…¹•­½µµ•¸¥ÍÐ¸œì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡Á…åÉ½±±!•±À¤ì((€€€½¹ÍÐÍÑ…¹‘…É‘	½à€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘•Ñ…¥±Ìœ¤ì(€€€ÍÑ…¹‘…É‘	½à¹±…ÍÍ9…µ”€ô€‘•Ñ…¥±Ìµ‰½àœì(€€€½¹ÍÐÍÕµµ…Éä€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ÍÕµµ…Éäœ¤ì(€€€ÍÕµµ…Éä¹Ñ•áÑ½¹Ñ•¹Ð€ô€ÉÕ¹‘±½¡¸€¼	…Í¥ÍÝ•ÉÐ…¹é•¥•¸œì(€€€ÍÑ…¹‘…É‘	½à¹…ÁÁ•¹‘¡¥±¡ÍÕµµ…Éä¤ì(€€€½¹ÍÐ‰…Í•I½Ü€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€‰…Í•I½Ü¹±…ÍÍ9…µ”€ô€É½Üœì(€€€É•™Ì¹‰…Í•9•Ñ%¹ÁÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥¹ÁÕÐœ¤ì(€€€É•™Ì¹‰…Í•9•Ñ%¹ÁÕÐ¹ÑåÁ”€ô€Ñ•áÐœì(€€€É•™Ì¹‰…Í•9•Ñ%¹ÁÕÐ¹¥¹ÁÕÑ5½‘”€ô€‘•¥µ…°œì(€€€É•™Ì¹‰…Í•9•Ñ%¹ÁÕÐ¹Ù…±Õ”€ô9Õµ‰•È¡Á•ÉÍ½¸¹¹•Ðñð€À¤¹Ñ½¥á• È¤ì(€€€‰…Í•I½Ü¹…ÁÁ•¹‘¡¥±¡É•…Ñ•1…‰•±%¹ÁÕÐ ÉÕ¹‘±½¡¸€¼	…Í¥Ìµ9•ÑÑ¼œ°É•™Ì¹‰…Í•9•Ñ%¹ÁÕÐ¤¤ì(€€€ÍÑ…¹‘…É‘	½à¹…ÁÁ•¹‘¡¥±¡‰…Í•I½Ü¤ì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡ÍÑ…¹‘…É‘	½à¤ì((€€€½¹ÍÐ¡•±Á•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð Àœ¤ì(€€€¡•±Á•È¹±…ÍÍ9…µ”€ô€Íµ…±°µÕÑ•œì(€€€¡•±Á•È¹Ñ•áÑ½¹Ñ•¹Ð€ô€ñÈÝ•¡Í•±¹‘”iÕÍ¡³‘”¹ÕÑé”ƒŠyQ…ÑÏ‘¡±¥¡”ÕÍé…¡±Õ¹œ¹ÕÈ‘¥•Í•È5½¹…ÓŠp¸•¸ÉÕ¹‘±½¡¸€¼A±…¹Ý•ÉÐƒ‘¹‘•ÉÍÐ‘Ô¹ÕÈ°Ý•¹¸Í¥ ‘…Ì‰•­…¹¹Ñ”™•ÍÑ”¥¹­½µµ•¸Ý¥É­±¥ ƒ‘¹‘•ÉÐ¸¥”¹½Éµ…±”Y•ÉÍ¡¥•‰Õ¹œ‰±•¥‰Ð•ÕÉ”€ÈÔÀ·Š
°µI••°¸ñÈM½¹‘•Éµ½¹…Ñ”Ý¥”)Õ±¤­…¹¹ÍÐ‘Ô½‰•¸•¥¹”Y•ÉÍ¡¥•‰Õ¹œ¹ÕÈ›ñÈ‘¥•Í•¸5½¹…Ð•¥¹ÑÉ…•¸°è¸¸€À¸œì(€€€½¹Ñ•¹Ð¹…ÁÁ•¹‘¡¥±¡¡•±Á•È¤ì((€€€Í¡½Ý5½‘…°¡€‘íÁ•ÉÍ½¸¹¹…µ”ñð€A•ÉÍ½¸ô‰•…É‰•¥Ñ•¹€°½¹Ñ•¹Ð°l(€€€€€ì(€€€€€€€±…‰•°è€%ÍÐµÕÍé…¡±Õ¹œ‘¥•Í•Ì5½¹…ÑÌ³ÙÍ¡•¸œ°(€€€€€€€±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€±•…ÉA•ÉÍ½¹9•Ñ½É5½¹Ñ ¡Á•ÉÍ½¸°ÕÉÉ•¹Ñ5½¹Ñ °€½¹”œ¤ì(€€€€€€€€€Íå¹A•ÉÍ½¹%¹½µ•I••¥Ù•‘µ½Õ¹Ð¡Á•ÉÍ½¸°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Íå¹%¹½µ•	…Í•‘M¡…É•‘Q½ÁUÁÌ¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô°(€€€€€ì(€€€€€€€±…‰•°è€A±…¹Ý•ÉÐ…ˆ‘¥•Í•´5½¹…Ð³ÙÍ¡•¸œ°(€€€€€€€±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€±•…ÉA•ÉÍ½¹9•Ñ½É5½¹Ñ ¡Á•ÉÍ½¸°ÕÉÉ•¹Ñ5½¹Ñ °€™ÕÑÕÉ”œ¤ì(€€€€€€€€€Íå¹A•ÉÍ½¹%¹½µ•I••¥Ù•‘µ½Õ¹Ð¡Á•ÉÍ½¸°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Íå¹%¹½µ•	…Í•‘M¡…É•‘Q½ÁUÁÌ¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô°(€€€€€ì(€€€€€€€±…‰•°è€‰‰É•¡•¸œ°(€€€€€€€±…ÍÍ9…µ”è€Í•½¹‘…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôø±½Í” ¤(€€€€€ô°(€€€€€ì(€€€€€€€±…‰•°è€MÁ•¥¡•É¸œ°(€€€€€€€±…ÍÍ9…µ”è€ÁÉ¥µ…Éäœ°(€€€€€€€½¹±¥¬è€¡±½Í”¤€ôøì(€€€€€€€€€½¹ÍÐ¹•Ý9…µ”€ôÉ•™Ì¹¹…µ•%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€€€€€½¹ÍÐÍ¡¥™Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡É•™Ì¹Í¡¥™Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€½¹ÍÐµ½¹Ñ¡M¡¥™ÑI…Ü€ôÉ•™Ì¹µ½¹Ñ¡M¡¥™Ñ%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì(€€€€€€€€€½¹ÍÐµ½¹Ñ¡M¡¥™Ð€ôµ½¹Ñ¡M¡¥™ÑI…Ü€üÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡µ½¹Ñ¡M¡¥™ÑI…Ü¤€è¹Õ±°ì(€€€€€€€€€½¹ÍÐ‰…Í•9•Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡É•™Ì¹‰…Í•9•Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€½¹ÍÐ¹•Ý9•Ð€ôÁ…ÉÍ•5½¹•å%¹ÁÕÐ¡É•™Ì¹¹•Ý9•Ñ%¹ÁÕÐ¹Ù…±Õ”¤ì(€€€€€€€€€¥˜€ …¹•Ý9…µ”¤É•ÑÕÉ¸…±•ÉÐ 9…µ”‘…É˜¹¥¡Ð±••ÈÍ•¥¸¸œ¤ì(€€€€€€€€€¥˜€¡9Õµ‰•È¹¥Í9…8¡Í¡¥™Ð¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹”Ÿñ±Ñ¥”Y•ÉÍ¡¥•‰Õ¹œ•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡Í¡¥™Ð¤€ø€ÄÀÀÀ¤É•ÑÕÉ¸…±•ÉÐ ¥”Y•ÉÍ¡¥•‰Õ¹œÝ¥É­ÐÕ¹Á±…ÕÍ¥‰•°¸	¥ÑÑ”¹¥¡Ð‘…Ì9•ÑÑ¼•¥¹ÑÉ…•¸°Í½¹‘•É¸è¸¸€ÈÔÀ½‘•È€´ÈÔÀ¸œ¤ì(€€€€€€€€€¥˜€¡µ½¹Ñ¡M¡¥™ÑI…Ü€˜˜€¡9Õµ‰•È¹¥Í9…8¡µ½¹Ñ¡M¡¥™Ð¤ñð5…Ñ ¹…‰Ì¡µ½¹Ñ¡M¡¥™Ð¤€ø€ÄÀÀÀ¤¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹”Ÿñ±Ñ¥”5½¹…ÑÌµY•ÉÍ¡¥•‰Õ¹œ•¥¹•‰•¸°è¸¸€À°€ÈÔÀ½‘•È€´ÈÔÀ¸œ¤ì(€€€€€€€€€¥˜€¡9Õµ‰•È¹¥Í9…8¡‰…Í•9•Ð¤ñð‰…Í•9•Ð€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¹•¸Ÿñ±Ñ¥•¸ÉÕ¹‘±½¡¸•¥¹•‰•¸¸œ¤ì(€€€€€€€€€¥˜€¡9Õµ‰•È¹¥Í9…8¡¹•Ý9•Ð¤ñð¹•Ý9•Ð€ð€À¤É•ÑÕÉ¸…±•ÉÐ 	¥ÑÑ”•¥¸Ÿñ±Ñ¥•Ì9•ÑÑ¼•¥¹•‰•¸¸œ¤ì((€€€€€€€€€Á•ÉÍ½¸¹¹…µ”€ô¹•Ý9…µ”ì(€€€€€€€€€Á•ÉÍ½¸¹Í¡¥™Ð€ôÍ¡¥™Ðì(€€€€€€€€€Á•ÉÍ½¸¹¹•Ð€ô‰…Í•9•Ðì(€€€€€€€€€¥˜€¡µ½¹Ñ¡M¡¥™ÑI…Ü¤Í•ÑA•ÉÍ½¹M¡¥™Ñ½É5½¹Ñ ¡Á•ÉÍ½¸°ÕÉÉ•¹Ñ5½¹Ñ °µ½¹Ñ¡M¡¥™Ð¤ì(€€€€€€€€€•±Í”±•…ÉA•ÉÍ½¹M¡¥™Ñ½É5½¹Ñ ¡Á•ÉÍ½¸°ÕÉÉ•¹Ñ5½¹Ñ ¤ì((€€€€€€€€€½¹ÍÐµ½‘”€ôÉ•™Ì¹µ½‘•M•±•Ð¹Ù…±Õ”€ôôô€½¹”œ€ü€½¹”œ€è€™ÕÑÕÉ”œì(€€€€€€€€€½¹ÍÐÍÑ½É•‘9•Ð€ôµ½‘”€ôôô€½¹”œ€üÉ½Õ¹‘5½¹•ä¡¹•Ý9•Ð€¬Á…åÉ½±±•‘ÕÑ¥½¸¤€è¹•Ý9•Ðì(€€€€€€€€€¥˜€ …Í•ÑA•ÉÍ½¹9•Ñ½É5½¹Ñ ¡Á•ÉÍ½¸°ÕÉÉ•¹Ñ5½¹Ñ °ÍÑ½É•‘9•Ð°µ½‘”¤¤É•ÑÕÉ¸…±•ÉÐ …Ì9•ÑÑ¼­½¹¹Ñ”¹¥¡Ð•ÍÁ•¥¡•ÉÐÝ•É‘•¸¸œ¤ì((€€€€€€€€€…‘‘¡…¹•1½œ ¥¹­½µµ•¸œ°€‘íÁ•ÉÍ½¸¹¹…µ•ôè€‘íµ½‘”€ôôô€½¹”œ€ü€ÕÍé…¡±Õ¹œ›ñÈ€œ€¬™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¤€¬€œ…Õ˜€œ€¬•ÕÉ¼¡¹•Ý9•Ð¤€¬€¡Á…åÉ½±±•‘ÕÑ¥½¸€ø€À€ü€•Í•ÑéÐì‰ÑÉ•ÑÕ¹œ€‘í•ÕÉ¼¡Á…åÉ½±±•‘ÕÑ¥½¸¥ô•ÉŸ‘¹éÐ€¡A±…¸µ9•ÑÑ¼€‘í•ÕÉ¼¡ÍÑ½É•‘9•Ð¥ô¤¹€€è€œ•Í•ÑéÐ¸œ¤€è€ÉÕ¹‘±½¡¸€¼A±…¹Ý•ÉÐ…ˆ€œ€¬™½Éµ…Ñ5½¹Ñ¡1…‰•°¡ÕÉÉ•¹Ñ5½¹Ñ ¤€¬€œ…Õ˜€œ€¬•ÕÉ¼¡¹•Ý9•Ð¤€¬€œ•Í•ÑéÐ¸õ€¤ì(€€€€€€€€€Íå¹A•ÉÍ½¹%¹½µ•I••¥Ù•‘µ½Õ¹Ð¡Á•ÉÍ½¸°ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Íå¹%¹½µ•	…Í•‘M¡…É•‘Q½ÁUÁÌ¡ÕÉÉ•¹Ñ5½¹Ñ ¤ì(€€€€€€€€€Í…Ù•MÑ…Ñ” ¤ì(€€€€€€€€€±½Í” ¤ì(€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€ô(€€€€€ô(€€€t¤ì(€ô((€™Õ¹Ñ¥½¸•¹•É…Ñ•% ¤ì(€€€¥˜€¡ÑåÁ•½˜ÉåÁÑ¼€„ôô€Õ¹‘•™¥¹•œ€˜˜ÑåÁ•½˜ÉåÁÑ¼¹É…¹‘½µUU%€ôôô€™Õ¹Ñ¥½¸œ¤ì(€€€€€É•ÑÕÉ¸ÉåÁÑ¼¹É…¹‘½µUU% ¤ì(€€€ô(€€€É•ÑÕÉ¸€‘í…Ñ”¹¹½Ü ¤¹Ñ½MÑÉ¥¹œ ÌØ¥ô´‘í5…Ñ ¹É…¹‘½´ ¤¹Ñ½MÑÉ¥¹œ ÌØ¤¹ÍÕ‰ÍÑÉ¥¹œ È°€ÄÀ¥õ€ì(€ô(€€(€€¼¼-±•¥¹”Y•ÉÍ¥½¹Í…¹é•¥”½‰•¸…­ÑÕ…±¥Í¥•É•¸¸]•¹¸Á•È9•Ôµ1…‘•¸•¥¸I•™É•Í µA…É…µ•Ñ•È•Í•ÑéÐÝÕÉ‘”°(€€¼¼Ý¥É­ÕÉè€‰UÁ‘…Ñ”•±…‘•¸ˆ•é•¥Ð¸(€½¹ÍÐÙ•ÉÍ¥½¹¡¥À€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% Ù•ÉÍ¥½¹¡¥Àœ¤ì(€¥˜€¡Ù•ÉÍ¥½¹¡¥À¤ì(€€€½¹ÍÐÁ…É…µÌ€ô¹•ÜUI1M•…É¡A…É…µÌ¡Ý¥¹‘½Ü¹±½…Ñ¥½¸¹Í•…É ¤ì(€€€¥˜€¡Á…É…µÌ¹¡…Ì É•™É•Í œ¤¤ì(€€€€€Ù•ÉÍ¥½¹¡¥À¹Ñ•áÑ½¹Ñ•¹Ð€ôYIM%=9}UAQ}QaPì(€€€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€€€Ù•ÉÍ¥½¹¡¥À¹Ñ•áÑ½¹Ñ•¹Ð€ôYIM%=9}Ie}QaPì(€€€€€ô°€ÈÔÀÀ¤ì(€€€ô•±Í”ì(€€€€€Ù•ÉÍ¥½¹¡¥À¹Ñ•áÑ½¹Ñ•¹Ð€ôYIM%=9}Ie}QaPì(€€€ô(€ô(((€€¼¼iÕÏ‘Ñé±¥¡•ÈM¡ÕÑè…Õ˜5…Œ½M…™…É¤½¥A¡½¹”è]•¹¸‘•È	É½ÝÍ•ÈQ…‰Ì•¥¹™É¥•ÉÐ°(€€¼¼‘¥”ÁÀµ¥¹¥µ¥•ÉÐ½‘•È‘¥”M•¥Ñ”¹•Ô³‘‘Ð°Ý¥É‘•È…­ÑÕ•±±”iÕÍÑ…¹Ù½É¡•È(€€¼¼¹½ •¥¹µ…°¥¸µ•¡É•É•¸±½­…±•¸MÁ•¥¡•ÈµM¡³ñÍÍ•±¸•Í¥¡•ÉÐ¸(€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰•™½É•Õ¹±½…œ°€ ¤€ôøÍ…Ù•MÑ…Ñ” ¤¤ì(€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Ù¥Í¥‰¥±¥Ñå¡…¹”œ°€ ¤€ôøì(€€€¥˜€¡‘½Õµ•¹Ð¹Ù¥Í¥‰¥±¥ÑåMÑ…Ñ”€ôôô€¡¥‘‘•¸œ¤Í…Ù•MÑ…Ñ” ¤ì(€ô¤ì(€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Á…•¡¥‘”œ°€ ¤€ôøÍ…Ù•MÑ…Ñ” ¤¤ì((€ÕÁ‘…Ñ•M…Ù•MÑ…ÑÕÌ ¤ì(€€¼¼MÑ…ÉÑ”‘…ÌI•¹‘•É¥¹œ(€É•¹‘•È ¤ì(€…ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁ%¹¥Ñ¥…±¥é•€ôÑÉÕ”ì(€AÉ½µ¥Í”¹…±°¡l(€€€É•½¹¥±•ÕÑ½µ…Ñ¥	É½ÝÍ•É	…­ÕÁÌ ¤°(€€€É•½¹¥±•áÑ•É¹…±	…­ÕÁ½¹¹•Ñ¥½¸ ¤(€t¤¹Ñ¡•¸ ¡m…ÕÑ½µ…Ñ¥¡…¹•°•áÑ•É¹…±¡…¹•‘t¤€ôøì(€€€¥˜€ ¡…ÕÑ½µ…Ñ¥¡…¹•ñð•áÑ•É¹…±¡…¹•¤€˜˜€¡ÕÉÉ•¹ÑM•Ñ¥½¸€ôôô€Í…Ù”œñðÕÉÉ•¹ÑM•Ñ¥½¸€ôôô€½Ù•ÉÙ¥•ÜœñðÕÉÉ•¹ÑM•Ñ¥½¸€ôôô€µ½¹Ñ¡ÍÑ…ÉÐœ¤¤É•¹‘•È ¤ì(€ô¤ì)ô¤ ¤ì(