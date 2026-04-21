/*
 * Haushaltsplaner Developer Beta 0.68
 *
 * Diese Version ergänzt monatliche Einkommensanpassungen pro Person.
 * Das Netto kann im gewählten Monat jetzt entweder nur einmalig oder
 * ab diesem Monat dauerhaft geändert und bei Bedarf gezielt
 * zurückgesetzt werden. Die bisherigen Monatsänderungen für Posten
 * bleiben vollständig erhalten.
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
      benny: { kmPerMonth: 0, consumption: 5.5, fuelType: 'diesel', avgPrice: '', autoPrice: '', stationName: '', lastFetch: '' },
      madeleine: { kmPerMonth: 0, consumption: 7.0, fuelType: 'e5', avgPrice: '', autoPrice: '', stationName: '', lastFetch: '' }
    }
  };
  let state;
  try {
  let saved = localStorage.getItem('budgetStateV068');
    if (!saved) {
      // Fallback-Migration aus älteren Versionen
      const fallback = [
        'budgetStateV067','budgetStateV066','budgetStateV065','budgetStateV064','budgetStateV063','budgetStateV062','budgetStateV061','budgetStateV060','budgetStateV059','budgetStateV058','budgetStateV057','budgetStateV056','budgetStateV055','budgetStateV054','budgetStateV053','budgetStateV052','budgetStateV051','budgetStateV050','budgetStateV049','budgetStateV048','budgetStateV047','budgetStateV046','budgetStateV045','budgetStateV044','budgetStateV043','budgetStateV042','budgetStateV041','budgetStateV040','budgetStateV039','budgetStateV038','budgetStateV037','budgetStateV036','budgetStateV035','budgetStateV034','budgetStateV033','budgetStateV032','budgetStateV031','budgetStateV030','budgetStateV029','budgetStateV028','budgetStateV027','budgetStateV026','budgetStateV025','budgetStateV024','budgetStateV023','budgetStateV022','budgetStateV021','budgetStateV020','budgetStateV019','budgetStateV018','budgetStateV017','budgetStateV016','budgetStateV015'
      ];
      for (const k of fallback) {
        const data = localStorage.getItem(k);
        if (data) {
          saved = data;
          // Bei erfolgreicher Migration unter neuem Key speichern
          localStorage.setItem('budgetStateV068', data);
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
      if (!state.tankCalc.radiusKm) state.tankCalc.radiusKm = 5;
      if (!state.tankCalc.benny) state.tankCalc.benny = JSON.parse(JSON.stringify(defaultState.tankCalc.benny));
      if (!state.tankCalc.madeleine) state.tankCalc.madeleine = JSON.parse(JSON.stringify(defaultState.tankCalc.madeleine));
    }
    migrateKreiskasseToBennyPersonal();
    if (!state.reserveItemSaved) state.reserveItemSaved = {};
    syncAllReserveSelectionsToPots();
    normalizeAllPersonConfigs();
    normalizeAllPostConfigs();
  } catch (err) {
    state = JSON.parse(JSON.stringify(defaultState));
  }

  function saveState() {
    localStorage.setItem('budgetStateV068', JSON.stringify(state));
  }

  function normalizeAllPostConfigs() {
    if (Array.isArray(state.commonCosts)) state.commonCosts.forEach(ensurePostConfig);
    if (Array.isArray(state.personalCosts)) state.personalCosts.forEach(ensurePostConfig);
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
  // Ab einem Mindestpuffer von minFree wird der freie Betrag im
  // Verhältnis von reservesRatio (Rücklagen) und savingsRatio (Sparen)
  // verteilt. Die Rücklagen verteilen sich entsprechend der
  // reservePotShares auf verschiedene Töpfe.
  const savingsConfig = {
    // Ab welchem freien Betrag eine Verteilung erfolgt.
    minFree: 150,
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
    if (monthDiff(monthKey, savingsConfig.startMonth) < 0) {
      return 0;
    }
    const free = computeFreeSumForMonth(monthKey);
    const verteilbar = Math.max(free - savingsConfig.minFree, 0);
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
    if (monthDiff(monthKey, savingsConfig.startMonth) < 0) {
      return 0;
    }
    const free = computeFreeSumForMonth(monthKey);
    const verteilbar = Math.max(free - savingsConfig.minFree, 0);
    return verteilbar * savingsConfig.savingsRatio;
  }

  function formatMonthLabel(monthKey) {
    return monthKeyToDate(monthKey).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  }

  function estimateDebtPaidOffMonth(debt) {
    const rate = Number(debt.monthlyRate || 0);
    const open = Number(debt.amountOpen || 0);
    if (!rate || rate <= 0 || open <= 0 || !debt.nextDueMonth) return '';
    const payments = Math.ceil(open / rate);
    const start = monthKeyToDate(debt.nextDueMonth);
    start.setMonth(start.getMonth() + Math.max(payments - 1, 0));
    return dateToMonthKey(start);
  }

  function estimateDebtEndMonth(debt) {
    return estimateDebtPaidOffMonth(debt);
  }

  // Hilfsfunktion: berechnet den freien Betrag für ein gegebenes
  // Monats‑Key. Dabei werden die Nettoeinkommen, die gerundeten
  // Anteile der gemeinsamen Kosten und die persönlichen Ausgaben
  // berücksichtigt. Das Ergebnis ist der Betrag, der nach Abzug der
  // gemeinsamen Kosten und der persönlichen Ausgaben zur freien
  // Verfügung steht.
  function computeFreeSumForMonth(monthKey) {
    // Daten pro Person erfassen
    const personsData = state.persons.map((p) => ({
      person: p,
      income: getPersonNet(p, monthKey),
      personalDue: 0
    }));
    // Gesamtsumme der monatlichen Anteile der gemeinsamen Kosten
    let totalCommonRaw = 0;
    state.commonCosts.forEach((c) => {
      if (isPostActiveInMonth(c, monthKey)) totalCommonRaw += getCommonMonthlyShare(c, monthKey);
    });
    // Gerundete Anteile für jede Person berechnen
    const shareMap = computeRoundedCommonShares(
      totalCommonRaw,
      state.persons.map((p) => ({ person: p, income: getPersonNet(p, monthKey) }))
    );
    // Persönliche Ausgaben pro Person summieren
    state.personalCosts.forEach((pc) => {
      if (pc.personId && isDue(pc, monthKey)) {
        const pd = personsData.find((x) => x.person.id === pc.personId);
        if (pd) pd.personalDue += getEffectiveAmountForMonth(pc, currentMonth);
      }
    });
    // Freier Betrag über alle Personen aufsummieren
    let free = 0;
    personsData.forEach((pd) => {
      const share = shareMap[pd.person.id] || 0;
      free += (pd.income - share - pd.personalDue);
    });
    return free;
  }
  // ----- Zeitliche Auswahl -----
  const today = new Date();
  const startMonthKey = dateToMonthKey(today);
  let monthList = getNext12Months(startMonthKey);
  let currentMonth = monthList[0].key;
  // ----- DOM-Referenzen -----
  const overviewSection = document.getElementById('overview');
  const commonSection = document.getElementById('common');
  const personalSection = document.getElementById('personal');
  const tankCalcSection = document.getElementById('tankcalc');
  const debtsSection = document.getElementById('debts');
  const settingsSection = document.getElementById('settings');
  const savingsSection = document.getElementById('savings');
  const potsSection = document.getElementById('pots');
  const saveSection = document.getElementById('save');
  const sectionSelect = document.getElementById('sectionSelect');
  const reloadButton = document.getElementById('reloadButton');
  let currentSection = 'overview';

  // ID des aktuell ausgewählten Topfs für die Detailansicht in
  // renderPots. Ein leerer String bedeutet, dass keine Detailansicht
  // angezeigt wird.
  let selectedPotId = '';
  // Navigation: Bereiche wechseln
  sectionSelect.addEventListener('change', (e) => {
    currentSection = e.target.value;
    document.querySelectorAll('.tab-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === currentSection);
    });
    render();
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
  function ensurePostConfig(post) {
    ensurePostScheduleConfig(post);
    ensurePostAmountConfig(post);
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

  async function fetchAutomaticFuelPrice(personKey) {
    const cfg = getTankCalcData(personKey);
    const apiKey = String(state.tankCalc.apiKey || '').trim();
    if (!apiKey) {
      alert('Bitte zuerst einen Tankerkönig-API-Key eintragen.');
      return;
    }
    if (!navigator.geolocation) {
      alert('Standort wird auf diesem Gerät nicht unterstützt.');
      return;
    }

    let position;
    try {
      position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
      });
    } catch (err) {
      alert('Standort konnte nicht geladen werden.');
      return;
    }

    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const rad = Number(state.tankCalc.radiusKm || 5);
    const fuelType = cfg.fuelType || 'diesel';

    const url = new URL('https://creativecommons.tankerkoenig.de/json/list.php');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lng', String(lng));
    url.searchParams.set('rad', String(rad));
    url.searchParams.set('sort', 'price');
    url.searchParams.set('type', fuelType);
    url.searchParams.set('apikey', apiKey);

    try {
      const response = await fetch(url.toString());
      const data = await response.json();
      if (!data.ok || !Array.isArray(data.stations) || data.stations.length === 0) {
        alert('Es konnten keine Kraftstoffpreise geladen werden.');
        return;
      }
      const station = data.stations[0];
      const price = Number(station.price ?? station[fuelType]);
      if (!price || Number.isNaN(price)) {
        alert('Es konnte kein Preis aus der Datenquelle gelesen werden.');
        return;
      }
      cfg.autoPrice = price.toFixed(3);
      if (!cfg.avgPrice) cfg.avgPrice = price.toFixed(3);
      cfg.stationName = station.name || station.brand || '';
      cfg.lastFetch = new Date().toLocaleString('de-DE');
      saveState();
      render();
    } catch (err) {
      alert('Preisabruf fehlgeschlagen.');
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
  function render() {
    renderOverview();
    renderCommon();
    renderPersonal();
    renderTankCalc();
    renderDebts();
    renderSettings();
    renderSavings();
    renderPots();
    renderSave();
    // Reiter-Auswahl mit dem tatsächlich geöffneten Bereich synchron halten
    if (sectionSelect.value !== currentSection) {
      sectionSelect.value = currentSection;
    }
    // Sichtbarkeit der Abschnitte neu setzen
    document.querySelectorAll('.tab-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === currentSection);
    });
    enableTableSorting();
  }
  // Rendert die Übersicht
  function renderOverview() {
    overviewSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const monthRow = document.createElement('div');
    monthRow.className = 'row';
    const monthLabel = document.createElement('label');
    monthLabel.textContent = 'Monat:';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      currentMonth = e.target.value;
      updateMonthListIfNeeded();
      render();
    });
    monthRow.appendChild(monthLabel);
    monthRow.appendChild(monthSelect);
    card.appendChild(monthRow);
    // Einkommen und Anteile berechnen
    let totalIncome = 0;
    const personsData = state.persons.map((p) => {
      const income = getPersonNet(p, currentMonth);
      totalIncome += income;
      return { person: p, income, commonShare: 0, personalDue: 0 };
    });
    // Summe der Rohanteile der gemeinsamen Kosten
    let totalCommonRaw = 0;
    state.commonCosts.forEach((c) => {
      if (isPostActiveInMonth(c, currentMonth)) totalCommonRaw += getCommonMonthlyShare(c);
    });
    const shareMap = computeRoundedCommonShares(
      totalCommonRaw,
      state.persons.map((p) => ({ person: p, income: getPersonNet(p, currentMonth) }))
    );
    personsData.forEach((pd) => {
      pd.commonShare = shareMap[pd.person.id] || 0;
    });
    // Persönliche Ausgaben berechnen
    state.personalCosts.forEach((pc) => {
      if (isDue(pc, currentMonth)) {
        const pd = personsData.find((x) => x.person.id === pc.personId);
        if (pd) pd.personalDue += getEffectiveAmountForMonth(pc, currentMonth);
      }
    });
    // Tabelle
    const table = document.createElement('table');
    table.className = 'list-table';
    const head = document.createElement('thead');
    head.innerHTML = `<tr>
      <th>Person</th>
      <th>Netto</th>
      <th>Anteil gemeinsamer Kosten</th>
      <th>Persönliche Ausgaben</th>
      <th>Verfügbar</th>
    </tr>`;
    table.appendChild(head);
    const body = document.createElement('tbody');
    personsData.forEach((pd) => {
      const available = pd.income - pd.commonShare - pd.personalDue;
      const row = document.createElement('tr');
      row.innerHTML = `<td>${pd.person.name}</td>
        <td>${pd.income.toFixed(2)} €</td>
        <td>${pd.commonShare.toFixed(2)} €</td>
        <td>${pd.personalDue.toFixed(2)} €</td>
        <td>${available.toFixed(2)} €</td>`;
      body.appendChild(row);
    });
    table.appendChild(body);
    const foot = document.createElement('tfoot');
    const totalCommonRounded = Object.values(shareMap).reduce((sum, val) => sum + val, 0);
    const totalPersonal = personsData.reduce((sum, pd) => sum + pd.personalDue, 0);
    const totalAvail = personsData.reduce((sum, pd) => sum + (pd.income - pd.commonShare - pd.personalDue), 0);
    const footRow = document.createElement('tr');
    footRow.innerHTML = `<td><strong>Summe</strong></td>
      <td>${totalIncome.toFixed(2)} €</td>
      <td>${totalCommonRounded.toFixed(2)} €</td>
      <td>${totalPersonal.toFixed(2)} €</td>
      <td>${totalAvail.toFixed(2)} €</td>`;
    foot.appendChild(footRow);
    table.appendChild(foot);
    card.appendChild(table);
    overviewSection.appendChild(card);
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
      currentMonth = e.target.value;
      updateMonthListIfNeeded();
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
        <th>Bezahlt?</th>
        <th>Aktion</th>
      </tr>`;
      table.appendChild(thead);
      const tbody = document.createElement('tbody');

      state.commonCosts.forEach((c) => {
        if (!c.paidMonths) c.paidMonths = [];
        const tr = document.createElement('tr');
        const dueNow = isDue(c, currentMonth);
        const currentAmount = getEffectiveAmountForMonth(c, currentMonth);
        const monthlyShare = getCommonMonthlyShare(c, currentMonth);
        const paidNow = c.paidMonths.includes(currentMonth);
        tr.innerHTML = `<td>${c.name}</td>
          <td>${currentAmount.toFixed(2)} €</td>
          <td>${getDisplayInterval(c)}</td>
          <td>${c.startMonth}</td>
          <td>${getDisplayEndMonth(c)}</td>
          <td>${monthlyShare.toFixed(2)} €</td>
          <td>${getDueBadgeHtml(dueNow)}</td>
          <td></td>
          <td></td>`;

        const paidCell = tr.children[7];
        if (dueNow) {
          if (!paidNow) {
            const btn = document.createElement('button');
            btn.textContent = 'Markieren';
            btn.className = 'success';
            btn.addEventListener('click', () => {
              if (!c.paidMonths.includes(currentMonth)) c.paidMonths.push(currentMonth);
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
        editBtn.textContent = '✎';
        editBtn.className = 'primary';
        editBtn.addEventListener('click', () => {
          if (tr.dataset.editing === 'true') return;
          tr.dataset.editing = 'true';
          const originalCells = [...tr.children].map((td) => td.innerHTML);
          tr.dataset.originalCells = JSON.stringify(originalCells);
          tr.innerHTML = '';

          const nameTd = document.createElement('td');
          const nameInput = document.createElement('input');
          nameInput.type = 'text';
          nameInput.value = c.name;
          nameTd.appendChild(nameInput);

          const amountTd = document.createElement('td');
          const amountInput = document.createElement('input');
          amountInput.type = 'number';
          amountInput.step = '0.01';
          amountInput.value = getEffectiveAmountForMonth(c, currentMonth);
          amountTd.appendChild(amountInput);

          const intervalTd = document.createElement('td');
          const typeSelect = document.createElement('select');
          typeSelect.innerHTML = '<option value="once">Einmalig</option><option value="recurring">Laufend</option>';
          typeSelect.value = isOneTimePost(c) ? 'once' : 'recurring';
          const intervalInput = document.createElement('input');
          intervalInput.type = 'number';
          intervalInput.min = '1';
          intervalInput.step = '1';
          intervalInput.value = c.interval;
          intervalTd.appendChild(typeSelect);
          intervalTd.appendChild(intervalInput);

          const startTd = document.createElement('td');
          const startInput = document.createElement('input');
          startInput.type = 'month';
          startInput.value = c.startMonth;
          startTd.appendChild(startInput);

          const endTd = document.createElement('td');
          const limitSelect = document.createElement('select');
          limitSelect.innerHTML = '<option value="none">Unbegrenzt</option><option value="until">Befristet bis</option>';
          limitSelect.value = !isOneTimePost(c) && c.endMonth ? 'until' : 'none';
          const endInput = document.createElement('input');
          endInput.type = 'month';
          endInput.value = !isOneTimePost(c) && c.endMonth ? c.endMonth : '';
          endTd.appendChild(limitSelect);
          endTd.appendChild(endInput);

          const shareTd = document.createElement('td');
          shareTd.textContent = monthlyShare.toFixed(2) + ' €';

          const dueTd = document.createElement('td');
          dueTd.innerHTML = getDueBadgeHtml(dueNow);

          const syncScheduleInputs = () => togglePostEditScheduleInputs(typeSelect, intervalInput, limitSelect, endInput, startInput);
          typeSelect.addEventListener('change', syncScheduleInputs);
          limitSelect.addEventListener('change', syncScheduleInputs);
          startInput.addEventListener('change', syncScheduleInputs);
          syncScheduleInputs();

          const paidTd = document.createElement('td');
          if (dueNow) {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = paidNow;
            cb.addEventListener('change', () => {
              if (!c.paidMonths) c.paidMonths = [];
              if (cb.checked) {
                if (!c.paidMonths.includes(currentMonth)) c.paidMonths.push(currentMonth);
              } else {
                c.paidMonths = c.paidMonths.filter((m) => m !== currentMonth);
              }
            });
            paidTd.appendChild(cb);
          } else {
            paidTd.textContent = '-';
          }

          const actionTd = document.createElement('td');
          const saveBtn = document.createElement('button');
          saveBtn.textContent = '✔';
          saveBtn.className = 'primary';
          saveBtn.addEventListener('click', () => {
            const newName = nameInput.value.trim();
            const newAmount = parseFloat(amountInput.value);
            const newStart = startInput.value;
            if (!newName) return alert('Name darf nicht leer sein.');
            if (isNaN(newAmount) || newAmount < 0) return alert('Betrag muss eine gültige Zahl sein.');
            const scheduleValidation = validateScheduleSettings({
              oneTime: typeSelect.value === 'once',
              interval: intervalInput.value,
              startMonth: newStart,
              endMonth: limitSelect.value === 'until' ? endInput.value : ''
            });
            if (!scheduleValidation.ok) return alert(scheduleValidation.message);
            const previousAmount = getEffectiveAmountForMonth(c, currentMonth);
            let mode = null;
            if (Math.abs(previousAmount - newAmount) > 0.000001) {
              mode = isOneTimePost(c) || scheduleValidation.value.oneTime ? 'future' : askAmountChangeMode(currentMonth);
              if (!mode) return;
            }
            c.name = newName;
            c.startMonth = newStart;
            applyScheduleSettings(c, scheduleValidation.value);
            if (mode) setPostAmountForMonth(c, currentMonth, newAmount, mode);
            saveState();
            render();
          });
          const cancelBtn = document.createElement('button');
          cancelBtn.textContent = '↺';
          cancelBtn.className = 'secondary';
          cancelBtn.addEventListener('click', () => {
            const cells = JSON.parse(tr.dataset.originalCells);
            tr.innerHTML = '';
            cells.forEach((html) => {
              const td = document.createElement('td');
              td.innerHTML = html;
              tr.appendChild(td);
            });
            delete tr.dataset.editing;
            delete tr.dataset.originalCells;
          });
          actionTd.appendChild(saveBtn);
          actionTd.appendChild(cancelBtn);

          tr.appendChild(nameTd);
          tr.appendChild(amountTd);
          tr.appendChild(intervalTd);
          tr.appendChild(startTd);
          tr.appendChild(endTd);
          tr.appendChild(shareTd);
          tr.appendChild(dueTd);
          tr.appendChild(paidTd);
          tr.appendChild(actionTd);
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = '✕';
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

      let totalMonthly = 0;
      state.commonCosts.forEach((c) => {
        if (isPostActiveInMonth(c, currentMonth)) totalMonthly += getCommonMonthlyShare(c);
      });
      const shareMapping = computeRoundedCommonShares(
        totalMonthly,
        state.persons.map((p) => ({ person: p, income: getPersonNet(p, currentMonth) }))
      );
      const summaryCard = document.createElement('div');
      summaryCard.className = 'card';
      const title = document.createElement('h3');
      title.textContent = 'Summe & Aufschlüsselung gemeinsamer Kosten';
      summaryCard.appendChild(title);
      const roundedSum = Object.values(shareMapping).reduce((sum, val) => sum + val, 0);
      const totalLabel = document.createElement('p');
      totalLabel.innerHTML = `<strong>Monatliche Gesamtsumme:</strong> ${roundedSum.toFixed(2)} €`;
      summaryCard.appendChild(totalLabel);

      let dueSum = 0;
      let paidSum = 0;
      state.commonCosts.forEach((c) => {
        if (isDue(c, currentMonth)) {
          dueSum += getEffectiveAmountForMonth(c, currentMonth);
          if (c.paidMonths && c.paidMonths.includes(currentMonth)) paidSum += getEffectiveAmountForMonth(c, currentMonth);
        }
      });
      if (dueSum > 0) {
        const payInfo = document.createElement('p');
        payInfo.innerHTML = `<strong>Bereits bezahlt:</strong> ${paidSum.toFixed(2)} € (offen: ${(dueSum - paidSum).toFixed(2)} €)`;
        summaryCard.appendChild(payInfo);
      }

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
      summaryCard.appendChild(distTable);
      card.appendChild(summaryCard);
    }

    commonSection.appendChild(card);
  }
  // Editor für gemeinsamen Kostenposten (Prompt-basierter Editor bleibt bestehen)
  
function showCommonEditor(editCost) {
    const name = prompt('Name des Postens:', editCost ? editCost.name : '');
    if (name == null) return;
    const amountStr = prompt('Betrag (in €):', editCost ? getEffectiveAmountForMonth(editCost, currentMonth) : '');
    let amount;
    if (editCost && (amountStr === '' || amountStr === null)) amount = getEffectiveAmountForMonth(editCost, currentMonth);
    else {
      amount = parseFloat(amountStr);
      if (isNaN(amount)) return;
    }
    const startStr = prompt('Startmonat (JJJJ-MM):', editCost ? editCost.startMonth : currentMonth);
    const startMonth = editCost && (startStr === '' || startStr === null) ? editCost.startMonth : startStr;
    if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) return;

    const type = promptForPostType(editCost);
    if (!type) return;

    let scheduleValidation;
    if (type === 'once') {
      scheduleValidation = validateScheduleSettings({
        oneTime: true,
        interval: 1,
        startMonth,
        endMonth: startMonth
      });
    } else {
      const intervalStr = prompt('Zahlungsintervall (in Monaten):', editCost ? editCost.interval : '1');
      const interval = editCost && (intervalStr === '' || intervalStr === null) ? editCost.interval : parseInt(intervalStr, 10);
      const limited = promptForPostLimit(editCost);
      if (limited == null) return;
      let endMonth = '';
      if (limited) {
        const currentEnd = editCost && !isOneTimePost(editCost) && editCost.endMonth ? editCost.endMonth : '';
        const endStr = prompt('Bis wann läuft der Posten? (JJJJ-MM):', currentEnd);
        if (endStr == null) return;
        endMonth = endStr.trim();
      }
      scheduleValidation = validateScheduleSettings({
        oneTime: false,
        interval,
        startMonth,
        endMonth
      });
    }
    if (!scheduleValidation.ok) {
      alert(scheduleValidation.message);
      return;
    }

    if (editCost) {
      const previousAmount = getEffectiveAmountForMonth(editCost, currentMonth);
      let mode = null;
      if (Math.abs(previousAmount - amount) > 0.000001) {
        mode = isOneTimePost(editCost) || scheduleValidation.value.oneTime ? 'future' : askAmountChangeMode(currentMonth);
        if (!mode) return;
      }
      editCost.name = name.trim();
      editCost.startMonth = startMonth;
      applyScheduleSettings(editCost, scheduleValidation.value);
      if (mode) setPostAmountForMonth(editCost, currentMonth, amount, mode);
    } else {
      state.commonCosts.push({
        id: generateId(),
        name: name.trim(),
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
  }
  // Rendert die persönlichen Ausgaben pro Person
  
function renderPersonal() {
    personalSection.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'row';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      currentMonth = e.target.value;
      updateMonthListIfNeeded();
      render();
    });
    header.appendChild(monthSelect);
    personalSection.appendChild(header);

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

      const posts = state.personalCosts.filter((pc) => pc.personId === person.id);
      if (posts.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'Keine persönlichen Ausgaben eingetragen.';
        card.appendChild(p);
      } else {
        const table = document.createElement('table');
        table.className = 'list-table';
        const thead = document.createElement('thead');
        thead.innerHTML = `<tr><th>Name</th><th>Betrag</th><th>Intervall</th><th>Start</th><th>Bis</th><th>Fällig</th><th>Bezahlt?</th><th>Aktion</th></tr>`;
        table.appendChild(thead);
        const tbody = document.createElement('tbody');

        posts.forEach((pc) => {
          if (!pc.paidMonths) pc.paidMonths = [];
          const tr = document.createElement('tr');
          const dueNow = isDue(pc, currentMonth);
          const paidNow = pc.paidMonths.includes(currentMonth);
          const currentAmount = getEffectiveAmountForMonth(pc, currentMonth);
          tr.innerHTML = `<td>${pc.name}</td>
            <td>${currentAmount.toFixed(2)} €</td>
            <td>${getDisplayInterval(pc)}</td>
            <td>${pc.startMonth}</td>
            <td>${getDisplayEndMonth(pc)}</td>
            <td>${getDueBadgeHtml(dueNow)}</td>
            <td></td><td></td>`;

          const paidCell = tr.children[6];
          if (dueNow) {
            if (!paidNow) {
              const btn = document.createElement('button');
              btn.textContent = 'Markieren';
              btn.className = 'success';
              btn.addEventListener('click', () => {
                if (!pc.paidMonths.includes(currentMonth)) pc.paidMonths.push(currentMonth);
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

          const actionCell = tr.children[7];
          const editBtn = document.createElement('button');
          editBtn.textContent = '✎';
          editBtn.className = 'primary';
          editBtn.addEventListener('click', () => {
            if (tr.dataset.editing === 'true') return;
            tr.dataset.editing = 'true';
            const originalCells = [...tr.children].map((td) => td.innerHTML);
            tr.dataset.originalCells = JSON.stringify(originalCells);
            tr.innerHTML = '';

            const nameTd = document.createElement('td');
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = pc.name;
            nameTd.appendChild(nameInput);

            const amountTd = document.createElement('td');
            const amountInput = document.createElement('input');
            amountInput.type = 'number';
            amountInput.step = '0.01';
            amountInput.value = getEffectiveAmountForMonth(pc, currentMonth);
            amountTd.appendChild(amountInput);

            const intervalTd = document.createElement('td');
            const typeSelect = document.createElement('select');
            typeSelect.innerHTML = '<option value="once">Einmalig</option><option value="recurring">Laufend</option>';
            typeSelect.value = isOneTimePost(pc) ? 'once' : 'recurring';
            const intervalInput = document.createElement('input');
            intervalInput.type = 'number';
            intervalInput.min = '1';
            intervalInput.step = '1';
            intervalInput.value = pc.interval;
            intervalTd.appendChild(typeSelect);
            intervalTd.appendChild(intervalInput);

            const startTd = document.createElement('td');
            const startInput = document.createElement('input');
            startInput.type = 'month';
            startInput.value = pc.startMonth;
            startTd.appendChild(startInput);

            const endTd = document.createElement('td');
            const limitSelect = document.createElement('select');
            limitSelect.innerHTML = '<option value="none">Unbegrenzt</option><option value="until">Befristet bis</option>';
            limitSelect.value = !isOneTimePost(pc) && pc.endMonth ? 'until' : 'none';
            const endInput = document.createElement('input');
            endInput.type = 'month';
            endInput.value = !isOneTimePost(pc) && pc.endMonth ? pc.endMonth : '';
            endTd.appendChild(limitSelect);
            endTd.appendChild(endInput);

            const dueTd = document.createElement('td');
            dueTd.innerHTML = getDueBadgeHtml(dueNow);

            const syncScheduleInputs = () => togglePostEditScheduleInputs(typeSelect, intervalInput, limitSelect, endInput, startInput);
            typeSelect.addEventListener('change', syncScheduleInputs);
            limitSelect.addEventListener('change', syncScheduleInputs);
            startInput.addEventListener('change', syncScheduleInputs);
            syncScheduleInputs();

            const paidTd = document.createElement('td');
            if (dueNow) {
              const cb = document.createElement('input');
              cb.type = 'checkbox';
              cb.checked = paidNow;
              cb.addEventListener('change', () => {
                if (cb.checked) {
                  if (!pc.paidMonths.includes(currentMonth)) pc.paidMonths.push(currentMonth);
                } else {
                  pc.paidMonths = pc.paidMonths.filter((m) => m !== currentMonth);
                }
              });
              paidTd.appendChild(cb);
            } else {
              paidTd.textContent = '-';
            }

            const actionTd = document.createElement('td');
            const saveBtn = document.createElement('button');
            saveBtn.textContent = '✔';
            saveBtn.className = 'primary';
            saveBtn.addEventListener('click', () => {
              const newName = nameInput.value.trim();
              const newAmount = parseFloat(amountInput.value);
              const newStart = startInput.value;
              if (!newName) return alert('Name darf nicht leer sein.');
              if (isNaN(newAmount) || newAmount < 0) return alert('Betrag muss eine gültige Zahl sein.');
              const scheduleValidation = validateScheduleSettings({
                oneTime: typeSelect.value === 'once',
                interval: intervalInput.value,
                startMonth: newStart,
                endMonth: limitSelect.value === 'until' ? endInput.value : ''
              });
              if (!scheduleValidation.ok) return alert(scheduleValidation.message);
              const previousAmount = getEffectiveAmountForMonth(pc, currentMonth);
              let mode = null;
              if (Math.abs(previousAmount - newAmount) > 0.000001) {
                mode = isOneTimePost(pc) || scheduleValidation.value.oneTime ? 'future' : askAmountChangeMode(currentMonth);
                if (!mode) return;
              }
              pc.name = newName;
              pc.startMonth = newStart;
              applyScheduleSettings(pc, scheduleValidation.value);
              if (mode) setPostAmountForMonth(pc, currentMonth, newAmount, mode);
              saveState();
              render();
            });
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '↺';
            cancelBtn.className = 'secondary';
            cancelBtn.addEventListener('click', () => {
              const cells = JSON.parse(tr.dataset.originalCells);
              tr.innerHTML = '';
              cells.forEach((html) => {
                const td = document.createElement('td');
                td.innerHTML = html;
                tr.appendChild(td);
              });
              delete tr.dataset.editing;
              delete tr.dataset.originalCells;
            });

            actionTd.appendChild(saveBtn);
            actionTd.appendChild(cancelBtn);
            tr.appendChild(nameTd);
            tr.appendChild(amountTd);
            tr.appendChild(intervalTd);
            tr.appendChild(startTd);
            tr.appendChild(endTd);
            tr.appendChild(dueTd);
            tr.appendChild(paidTd);
            tr.appendChild(actionTd);
          });

          const delBtn = document.createElement('button');
          delBtn.textContent = '✕';
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

        let dueSum = 0;
        let paidSum = 0;
        posts.forEach((pc) => {
          if (isDue(pc, currentMonth)) {
            dueSum += getEffectiveAmountForMonth(pc, currentMonth);
            if (pc.paidMonths.includes(currentMonth)) paidSum += getEffectiveAmountForMonth(pc, currentMonth);
          }
        });
        if (dueSum > 0) {
          const info = document.createElement('p');
          info.innerHTML = `<strong>Bereits bezahlt:</strong> ${paidSum.toFixed(2)} € (offen: ${(dueSum - paidSum).toFixed(2)} €)`;
          card.appendChild(info);
        }
      }
      personalSection.appendChild(card);
    });
  }
  // Editor für persönliche Ausgaben (Prompt-basierend)
  
function showPersonalEditor(personId, editPost) {
    const person = getPersonById(personId);
    const name = prompt(`Name des Postens für ${person.name}:`, editPost ? editPost.name : '');
    if (name == null) return;
    const amountStr = prompt('Betrag (in €):', editPost ? getEffectiveAmountForMonth(editPost, currentMonth) : '');
    let amount;
    if (editPost && (amountStr === '' || amountStr === null)) amount = getEffectiveAmountForMonth(editPost, currentMonth);
    else {
      amount = parseFloat(amountStr);
      if (isNaN(amount)) return;
    }
    const startStr = prompt('Startmonat (JJJJ-MM):', editPost ? editPost.startMonth : currentMonth);
    const startMonth = editPost && (startStr === '' || startStr === null) ? editPost.startMonth : startStr;
    if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) return;

    const type = promptForPostType(editPost);
    if (!type) return;

    let scheduleValidation;
    if (type === 'once') {
      scheduleValidation = validateScheduleSettings({
        oneTime: true,
        interval: 1,
        startMonth,
        endMonth: startMonth
      });
    } else {
      const intervalStr = prompt('Intervall (in Monaten):', editPost ? editPost.interval : '1');
      const interval = editPost && (intervalStr === '' || intervalStr === null) ? editPost.interval : parseInt(intervalStr, 10);
      const limited = promptForPostLimit(editPost);
      if (limited == null) return;
      let endMonth = '';
      if (limited) {
        const currentEnd = editPost && !isOneTimePost(editPost) && editPost.endMonth ? editPost.endMonth : '';
        const endStr = prompt('Bis wann läuft der Posten? (JJJJ-MM):', currentEnd);
        if (endStr == null) return;
        endMonth = endStr.trim();
      }
      scheduleValidation = validateScheduleSettings({
        oneTime: false,
        interval,
        startMonth,
        endMonth
      });
    }
    if (!scheduleValidation.ok) {
      alert(scheduleValidation.message);
      return;
    }

    if (editPost) {
      const previousAmount = getEffectiveAmountForMonth(editPost, currentMonth);
      let mode = null;
      if (Math.abs(previousAmount - amount) > 0.000001) {
        mode = isOneTimePost(editPost) || scheduleValidation.value.oneTime ? 'future' : askAmountChangeMode(currentMonth);
        if (!mode) return;
      }
      editPost.name = name.trim();
      editPost.startMonth = startMonth;
      applyScheduleSettings(editPost, scheduleValidation.value);
      if (mode) setPostAmountForMonth(editPost, currentMonth, amount, mode);
    } else {
      state.personalCosts.push({
        id: generateId(),
        personId,
        name: name.trim(),
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
  }

  // Rendert den Bereich „Schulden"


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
    keyInput.type = 'text';
    keyInput.placeholder = 'API-Key eingeben';
    keyInput.value = state.tankCalc.apiKey || '';
    keyInput.addEventListener('change', () => {
      state.tankCalc.apiKey = keyInput.value.trim();
      saveState();
    });
    keyWrap.appendChild(keyLabel);
    keyWrap.appendChild(keyInput);

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

      const result = document.createElement('p');
      const priceUsed = Number(cfg.avgPrice || cfg.autoPrice || 0);
      const raw = (Number(cfg.kmPerMonth || 0) / 100) * Number(cfg.consumption || 0) * priceUsed;
      const rounded = roundUpToNextTen(raw);
      result.innerHTML = `<strong>Ergebnis:</strong> ${rounded.toFixed(2)} €`;
      sub.appendChild(result);

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

  function renderDebts() {
    debtsSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const header = document.createElement('div');
    header.className = 'row';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      currentMonth = e.target.value;
      updateMonthListIfNeeded();
      render();
    });
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Neue Schuld';
    addBtn.className = 'primary';
    addBtn.addEventListener('click', () => {
      showDebtEditor();
    });
    header.appendChild(monthSelect);
    header.appendChild(addBtn);
    card.appendChild(header);

    if (state.debts.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Keine Schulden eingetragen.';
      card.appendChild(p);
    } else {
      const table = document.createElement('table');
      table.className = 'list-table';
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr><th>Name</th><th>Offen</th><th>Monatsrate</th><th>Nächste Fälligkeit</th><th>Vorauss. Ende</th><th>Bezahlt?</th><th>Aktion</th></tr>`;
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      state.debts.forEach((d) => {
        const tr = document.createElement('tr');
        const dueNow = d.nextDueMonth === currentMonth;
        const estimatedEnd = estimateDebtEndMonth(d);

        tr.innerHTML = `<td>${d.name}</td><td>${d.amountOpen.toFixed(2)} €</td><td>${d.monthlyRate.toFixed(2)} €</td><td>${d.nextDueMonth}</td><td>${estimatedEnd}</td><td></td><td></td>`;

        const payCell = tr.children[5];
        if (dueNow) {
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

        const actionCell = tr.children[6];
        const editBtn = document.createElement('button');
        editBtn.textContent = '✎';
        editBtn.className = 'primary';
        editBtn.addEventListener('click', () => {
          showDebtEditor(d);
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = '✕';
        delBtn.className = 'danger';
        delBtn.addEventListener('click', () => {
          if (confirm(`Schuld "${d.name}" löschen?`)) {
            state.debts = state.debts.filter((x) => x.id !== d.id);
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

      let dueSum = 0;
      let paidSum = 0;
      let totalDebtSum = 0;

      state.debts.forEach((d) => {
        totalDebtSum += Number(d.amountOpen || 0);
        if (d.nextDueMonth === currentMonth) {
          dueSum += Number(d.monthlyRate || 0);
        } else if (monthDiff(currentMonth, d.nextDueMonth) === 1) {
          paidSum += Number(d.monthlyRate || 0);
        }
      });

      const info = document.createElement('p');
      const openThisMonth = Math.max(dueSum - paidSum, 0);
      info.innerHTML = `<strong>Gesamtsumme aller Schulden:</strong> ${totalDebtSum.toFixed(2)} € · <strong>In diesem Monat bereits bezahlt:</strong> ${paidSum.toFixed(2)} € · <strong>Noch zu bezahlen:</strong> ${openThisMonth.toFixed(2)} €`;
      card.appendChild(info);
    }

    debtsSection.appendChild(card);
  }

  function markDebtPaid(debt) {
    debt.amountOpen = Math.max(0, debt.amountOpen - debt.monthlyRate);
    debt.nextDueMonth = nextMonth(debt.nextDueMonth);
    saveState();
    render();
  }
  function showDebtEditor(editDebt) {
    const name = prompt('Name der Schuld:', editDebt ? editDebt.name : '');
    if (name == null) return;
    const openStr = prompt('Offener Betrag (in €):', editDebt ? editDebt.amountOpen : '');
    const open = parseFloat(openStr);
    if (isNaN(open) || open < 0) return;
    const rateStr = prompt('Monatsrate (in €):', editDebt ? editDebt.monthlyRate : '');
    const rate = parseFloat(rateStr);
    if (isNaN(rate) || rate <= 0) return;
    const due = prompt('Nächste Fälligkeit (JJJJ-MM):', editDebt ? editDebt.nextDueMonth : currentMonth);
    if (!due || !/\d{4}-\d{2}/.test(due)) return;
    if (editDebt) {
      editDebt.name = name.trim();
      editDebt.amountOpen = open;
      editDebt.monthlyRate = rate;
      editDebt.nextDueMonth = due;
    } else {
      state.debts.push({ id: generateId(), name: name.trim(), amountOpen: open, monthlyRate: rate, nextDueMonth: due });
    }
    saveState();
    render();
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
      currentMonth = e.target.value;
      updateMonthListIfNeeded();
      render();
    });
    monthRow.appendChild(monthLabel);
    monthRow.appendChild(monthSelect);
    card.appendChild(monthRow);

    const hint = document.createElement('p');
    hint.className = 'small muted';
    hint.textContent = 'Hier kannst du das Standard-Netto pflegen und für den gewählten Monat Zuschläge oder Abzüge entweder nur einmalig oder ab diesem Monat dauerhaft speichern.';
    card.appendChild(hint);

    state.persons.forEach((p) => {
      ensurePersonIncomeConfig(p);
      const personCard = document.createElement('div');
      personCard.className = 'card';

      const row = document.createElement('div');
      row.className = 'row';
      const nameInput = document.createElement('input');
      nameInput.value = p.name;
      nameInput.addEventListener('change', () => {
        p.name = nameInput.value || p.name;
        saveState();
        render();
      });
      const netInput = document.createElement('input');
      netInput.type = 'number';
      netInput.step = '0.01';
      netInput.value = p.net;
      netInput.addEventListener('change', () => {
        const v = parseFloat(netInput.value);
        if (!isNaN(v) && v >= 0) {
          p.net = v;
          saveState();
          render();
        }
      });
      const shiftInput = document.createElement('input');
      shiftInput.type = 'number';
      shiftInput.step = '0.01';
      shiftInput.value = p.shift;
      shiftInput.addEventListener('change', () => {
        p.shift = parseFloat(shiftInput.value) || 0;
        saveState();
        render();
      });
      row.appendChild(createLabelInput('Name', nameInput));
      row.appendChild(createLabelInput('Netto (Basis)', netInput));
      row.appendChild(createLabelInput('Verschiebung', shiftInput));
      personCard.appendChild(row);

      const activeInfo = document.createElement('p');
      activeInfo.className = 'small';
      const hasMonthOverride = p.netOverrides && p.netOverrides[currentMonth] != null;
      const hasFutureEntry = Array.isArray(p.netTimeline) && p.netTimeline.some((entry) => entry && entry.month === currentMonth);
      let sourceText = 'Standardwert';
      if (hasMonthOverride) sourceText = 'nur dieser Monat';
      else if (hasFutureEntry) sourceText = 'dauerhaft ab diesem Monat';
      activeInfo.innerHTML = `<strong>Aktives Netto in ${formatMonthLabel(currentMonth)}:</strong> ${getPersonNet(p, currentMonth).toFixed(2)} € <span class="muted">(${sourceText})</span>`;
      personCard.appendChild(activeInfo);

      const adjustRow = document.createElement('div');
      adjustRow.className = 'row';
      const monthNetInput = document.createElement('input');
      monthNetInput.type = 'number';
      monthNetInput.step = '0.01';
      monthNetInput.value = getPersonNet(p, currentMonth);
      monthNetInput.placeholder = `Netto in ${formatMonthLabel(currentMonth)}`;

      const modeSelect = document.createElement('select');
      modeSelect.innerHTML = `
        <option value="once">Nur dieser Monat</option>
        <option value="future">Ab diesem Monat dauerhaft</option>
      `;

      const saveMonthBtn = document.createElement('button');
      saveMonthBtn.textContent = 'Änderung speichern';
      saveMonthBtn.addEventListener('click', () => {
        const v = parseFloat(monthNetInput.value);
        if (Number.isNaN(v) || v < 0) {
          alert('Bitte ein gültiges Netto eingeben.');
          return;
        }
        if (!setPersonNetForMonth(p, currentMonth, v, modeSelect.value)) return;
        saveState();
        render();
      });

      const resetMonthBtn = document.createElement('button');
      resetMonthBtn.textContent = 'Nur Monatswert löschen';
      resetMonthBtn.addEventListener('click', () => {
        clearPersonNetForMonth(p, currentMonth, 'once');
        saveState();
        render();
      });

      const resetFutureBtn = document.createElement('button');
      resetFutureBtn.textContent = 'Dauerwert ab Monat löschen';
      resetFutureBtn.addEventListener('click', () => {
        clearPersonNetForMonth(p, currentMonth, 'future');
        saveState();
        render();
      });

      adjustRow.appendChild(createLabelInput(`Netto in ${monthSelect.value}`, monthNetInput));
      adjustRow.appendChild(createLabelInput('Änderung gilt', modeSelect));
      const buttonWrap = document.createElement('div');
      buttonWrap.appendChild(saveMonthBtn);
      adjustRow.appendChild(buttonWrap);
      const resetMonthWrap = document.createElement('div');
      resetMonthWrap.appendChild(resetMonthBtn);
      adjustRow.appendChild(resetMonthWrap);
      const resetFutureWrap = document.createElement('div');
      resetFutureWrap.appendChild(resetFutureBtn);
      adjustRow.appendChild(resetFutureWrap);
      personCard.appendChild(adjustRow);

      const timelineHint = document.createElement('p');
      timelineHint.className = 'small muted';
      const nextTimeline = Array.isArray(p.netTimeline)
        ? p.netTimeline.filter((entry) => entry && monthDiff(currentMonth, entry.month) >= 0).sort((a, b) => monthDiff(currentMonth, a.month) - monthDiff(currentMonth, b.month))[0]
        : null;
      if (nextTimeline && nextTimeline.month !== currentMonth) {
        timelineHint.textContent = `Nächste dauerhafte Änderung: ${nextTimeline.amount.toFixed(2)} € ab ${formatMonthLabel(nextTimeline.month)}.`;
      } else if (hasFutureEntry) {
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
      currentMonth = e.target.value;
      updateMonthListIfNeeded();
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

    const beforeStart = monthDiff(currentMonth, savingsConfig.startMonth) < 0;
    const free = computeFreeSumForMonth(currentMonth);
    const verteilbar = beforeStart ? 0 : Math.max(free - savingsConfig.minFree, 0);
    const ruecklagen = beforeStart ? 0 : verteilbar * savingsConfig.reservesRatio;
    const sparen = beforeStart ? 0 : verteilbar * savingsConfig.savingsRatio;

    const info = document.createElement('p');
    if (beforeStart) {
      info.innerHTML = `Die Verteilung startet erst ab <strong>${formatMonthLabel(savingsConfig.startMonth)}</strong>.`;
    } else {
      info.innerHTML = `<strong>Freier Betrag:</strong> ${free.toFixed(2)} € · <strong>Mindestpuffer:</strong> ${savingsConfig.minFree.toFixed(2)} € · <strong>Verteilbar:</strong> ${verteilbar.toFixed(2)} €`;
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
    note.textContent = 'Markierte Rücklagen und Sparbeträge werden automatisch bei den Töpfen mitgeführt und können dort wiedergefunden werden.';
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
      currentMonth = e.target.value;
      updateMonthListIfNeeded();
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

    let totalManual = 0;
    let totalReservePlan = 0;
    state.pots.forEach((p) => {
      totalManual += Number(p.balance || 0);
      monthList.forEach((m) => {
        totalReservePlan += p.name === 'Sparen' ? getSavingsContribution(m.key) : getReserveContributionForPot(p.name, m.key);
      });
    });
    const totalsP = document.createElement('p');
    totalsP.innerHTML = `<strong>Gesamtsumme aller Töpfe:</strong> ${totalManual.toFixed(2)} € · <strong>Plan für 12 Monate:</strong> ${totalReservePlan.toFixed(2)} €`;
    card.appendChild(totalsP);

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
    const dataStr = JSON.stringify(state, null, 2);
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
            migrateKreiskasseToBennyPersonal();
            syncAllReserveSelectionsToPots();
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
    // Wenn currentMonth nicht mehr in der Liste ist, erstelle neue Liste
    if (!monthList.find((m) => m.key === currentMonth)) {
      monthList = getNext12Months(currentMonth);
    }
  }
  function createLabelInput(labelText, inputEl) {
    const wrapper = document.createElement('div');
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    wrapper.appendChild(lbl);
    wrapper.appendChild(inputEl);
    return wrapper;
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
      versionChip.textContent = 'Update 0.68 geladen';
      setTimeout(() => {
        versionChip.textContent = 'Version 0.68 geladen';
      }, 2500);
    } else {
      versionChip.textContent = 'Version 0.68 geladen';
    }
  }

  // Starte das Rendering
  render();
})();