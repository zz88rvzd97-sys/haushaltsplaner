/*
 * Haushaltsplaner Developer Beta 0.62
 *
 * Diese Version startet die automatische Rücklagen‑Verteilung erst ab
 * dem Startmonat der Excel-Vorlage (Mai 2026) und ergänzt eine
 * Bestätigungsfunktion für die Rücklagen. In der Tabelle
 * „Rücklagen & Sparen“ wird neben jedem Monat ein Button zum
 * Markieren angezeigt. Durch Anklicken bestätigst du, dass der
 * Rücklagen‑ und Sparbetrag für diesen Monat tatsächlich
 * zurückgelegt oder angespart wurde. Sobald markiert, erscheint der
 * Monat als „gespart“.
 *
 * Alle Verbesserungen aus Beta 0.34 bleiben erhalten: korrekte
 * Migration älterer States, verbesserte Darstellung in „Töpfe“ und
 * funktionsfähiger Sicherungsbereich.
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
  let saved = localStorage.getItem('budgetStateV062');
    if (!saved) {
      // Fallback-Migration aus älteren Versionen
      const fallback = [
        'budgetStateV061','budgetStateV060','budgetStateV059','budgetStateV058','budgetStateV057','budgetStateV056','budgetStateV055','budgetStateV054','budgetStateV053','budgetStateV052','budgetStateV051','budgetStateV050','budgetStateV049','budgetStateV048','budgetStateV047','budgetStateV046','budgetStateV045','budgetStateV044','budgetStateV043','budgetStateV042','budgetStateV041','budgetStateV040','budgetStateV039','budgetStateV038','budgetStateV037','budgetStateV036','budgetStateV035','budgetStateV034','budgetStateV033','budgetStateV032','budgetStateV031','budgetStateV030','budgetStateV029','budgetStateV028','budgetStateV027','budgetStateV026','budgetStateV025','budgetStateV024','budgetStateV023','budgetStateV022','budgetStateV021','budgetStateV020','budgetStateV019','budgetStateV018','budgetStateV017','budgetStateV016','budgetStateV015'
      ];
      for (const k of fallback) {
        const data = localStorage.getItem(k);
        if (data) {
          saved = data;
          // Bei erfolgreicher Migration unter neuem Key speichern
          localStorage.setItem('budgetStateV062', data);
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
  } catch (err) {
    state = JSON.parse(JSON.stringify(defaultState));
  }

  function saveState() {
    localStorage.setItem('budgetStateV062', JSON.stringify(state));
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
      if (isPostActiveInMonth(c, monthKey)) totalCommonRaw += getCommonMonthlyShare(c);
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
        if (pd) pd.personalDue += pc.amount;
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
  function getPersonNet(person, month) {
    if (person.netOverrides && person.netOverrides[month] != null) {
      return person.netOverrides[month];
    }
    return person.net;
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
  function getCommonMonthlyShare(cost) {
    return cost.amount / cost.interval;
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
        if (pd) pd.personalDue += pc.amount;
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
    addBtn.addEventListener('click', () => {
      showCommonEditor();
    });
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
        const paidNow = c.paidMonths.includes(currentMonth);
        const monthlyShare = getCommonMonthlyShare(c);

        tr.innerHTML = `<td>${c.name}</td>
          <td>${c.amount.toFixed(2)} €</td>
          <td>${c.interval}</td>
          <td>${c.startMonth}</td>
          <td>${c.endMonth || '-'}</td>
          <td>${monthlyShare.toFixed(2)} €</td>
          <td>${dueNow ? 'Ja' : 'Nein'}</td>
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
          amountInput.value = c.amount;
          amountTd.appendChild(amountInput);

          const intervalTd = document.createElement('td');
          const intervalInput = document.createElement('input');
          intervalInput.type = 'number';
          intervalInput.min = '1';
          intervalInput.step = '1';
          intervalInput.value = c.interval;
          intervalTd.appendChild(intervalInput);

          const startTd = document.createElement('td');
          const startInput = document.createElement('input');
          startInput.type = 'month';
          startInput.value = c.startMonth;
          startTd.appendChild(startInput);

          const endTd = document.createElement('td');
          const endInput = document.createElement('input');
          endInput.type = 'month';
          endInput.value = c.endMonth || '';
          endTd.appendChild(endInput);

          const shareTd = document.createElement('td');
          shareTd.textContent = monthlyShare.toFixed(2) + ' €';

          const dueTd = document.createElement('td');
          dueTd.textContent = dueNow ? 'Ja' : 'Nein';

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
            const newInterval = parseInt(intervalInput.value, 10);
            const newStart = startInput.value;
            const newEnd = endInput.value;
            if (!newName) {
              alert('Name darf nicht leer sein.');
              return;
            }
            if (isNaN(newAmount) || newAmount < 0) {
              alert('Betrag muss eine gültige Zahl sein.');
              return;
            }
            if (!newInterval || newInterval < 1) {
              alert('Intervall muss mindestens 1 betragen.');
              return;
            }
            if (!/^\d{4}-\d{2}$/.test(newStart)) {
              alert('Startmonat muss im Format JJJJ-MM vorliegen.');
              return;
            }
            if (newEnd && !/^\d{4}-\d{2}$/.test(newEnd)) {
              alert('Endmonat muss im Format JJJJ-MM vorliegen.');
              return;
            }
            if (newEnd && monthDiff(newStart, newEnd) < 0) {
              alert('Endmonat darf nicht vor dem Startmonat liegen.');
              return;
            }
            c.name = newName;
            c.amount = newAmount;
            c.interval = newInterval;
            c.startMonth = newStart;
            c.endMonth = newEnd || '';
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
          dueSum += c.amount;
          if (c.paidMonths && c.paidMonths.includes(currentMonth)) {
            paidSum += c.amount;
          }
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

  
function showCommonEditor(editCost) {
    const name = prompt('Name des Postens:', editCost ? editCost.name : '');
    if (name == null) return;
    const amountStr = prompt('Betrag (in €):', editCost ? editCost.amount : '');
    let amount;
    if (editCost && (amountStr === '' || amountStr === null)) {
      amount = editCost.amount;
    } else {
      amount = parseFloat(amountStr);
      if (isNaN(amount)) return;
    }
    const intervalStr = prompt('Zahlungsintervall (in Monaten):', editCost ? editCost.interval : '1');
    let interval;
    if (editCost && (intervalStr === '' || intervalStr === null)) {
      interval = editCost.interval;
    } else {
      interval = parseInt(intervalStr, 10);
      if (!interval || interval < 1) return;
    }
    const startStr = prompt('Startmonat (JJJJ-MM):', editCost ? editCost.startMonth : currentMonth);
    const startMonth = editCost && (startStr === '' || startStr === null) ? editCost.startMonth : startStr;
    if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) return;

    const currentEnd = editCost && editCost.endMonth ? editCost.endMonth : '';
    const endStr = prompt('Bis wann läuft der Posten? (JJJJ-MM, leer = unbegrenzt):', currentEnd);
    const endMonth = endStr == null ? currentEnd : endStr.trim();
    if (endMonth && !/^\d{4}-\d{2}$/.test(endMonth)) return;
    if (endMonth && monthDiff(startMonth, endMonth) < 0) {
      alert('Endmonat darf nicht vor dem Startmonat liegen.');
      return;
    }

    if (editCost) {
      editCost.name = name.trim();
      editCost.amount = amount;
      editCost.interval = interval;
      editCost.startMonth = startMonth;
      editCost.endMonth = endMonth;
    } else {
      state.commonCosts.push({
        id: generateId(),
        name: name.trim(),
        amount,
        interval,
        startMonth,
        endMonth,
        paidMonths: []
      });
    }
    saveState();
    render();
  }
  // Rendert die persönlichen Ausgaben pro Person

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
      addBtn.addEventListener('click', () => {
        showPersonalEditor(person.id);
      });

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
        thead.innerHTML = `<tr>
          <th>Name</th><th>Betrag</th><th>Intervall</th><th>Start</th><th>Bis</th><th>Fällig</th><th>Bezahlt?</th><th>Aktion</th>
        </tr>`;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        posts.forEach((pc) => {
          if (!pc.paidMonths) pc.paidMonths = [];
          const tr = document.createElement('tr');
          const dueNow = isDue(pc, currentMonth);
          const paidNow = pc.paidMonths.includes(currentMonth);

          tr.innerHTML = `<td>${pc.name}</td>
            <td>${pc.amount.toFixed(2)} €</td>
            <td>${pc.interval}</td>
            <td>${pc.startMonth}</td>
            <td>${pc.endMonth || '-'}</td>
            <td>${dueNow ? 'Ja' : 'Nein'}</td>
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
            amountInput.value = pc.amount;
            amountTd.appendChild(amountInput);

            const intervalTd = document.createElement('td');
            const intervalInput = document.createElement('input');
            intervalInput.type = 'number';
            intervalInput.min = '1';
            intervalInput.step = '1';
            intervalInput.value = pc.interval;
            intervalTd.appendChild(intervalInput);

            const startTd = document.createElement('td');
            const startInput = document.createElement('input');
            startInput.type = 'month';
            startInput.value = pc.startMonth;
            startTd.appendChild(startInput);

            const endTd = document.createElement('td');
            const endInput = document.createElement('input');
            endInput.type = 'month';
            endInput.value = pc.endMonth || '';
            endTd.appendChild(endInput);

            const dueTd = document.createElement('td');
            dueTd.textContent = dueNow ? 'Ja' : 'Nein';

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
              const newInterval = parseInt(intervalInput.value, 10);
              const newStart = startInput.value;
              const newEnd = endInput.value;
              if (!newName) {
                alert('Name darf nicht leer sein.');
                return;
              }
              if (isNaN(newAmount) || newAmount < 0) {
                alert('Betrag muss eine gültige Zahl sein.');
                return;
              }
              if (!newInterval || newInterval < 1) {
                alert('Intervall muss mindestens 1 betragen.');
                return;
              }
              if (!/^\d{4}-\d{2}$/.test(newStart)) {
                alert('Startmonat muss im Format JJJJ-MM vorliegen.');
                return;
              }
              if (newEnd && !/^\d{4}-\d{2}$/.test(newEnd)) {
                alert('Endmonat muss im Format JJJJ-MM vorliegen.');
                return;
              }
              if (newEnd && monthDiff(newStart, newEnd) < 0) {
                alert('Endmonat darf nicht vor dem Startmonat liegen.');
                return;
              }
              pc.name = newName;
              pc.amount = newAmount;
              pc.interval = newInterval;
              pc.startMonth = newStart;
              pc.endMonth = newEnd || '';
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
            dueSum += pc.amount;
            if (pc.paidMonths.includes(currentMonth)) paidSum += pc.amount;
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
  // Editor für persönliche Ausgaben

  // Editor für persönliche Ausgaben (Prompt-basierend)
  
function showPersonalEditor(personId, editPost) {
    const person = getPersonById(personId);
    const name = prompt(`Name des Postens für ${person.name}:`, editPost ? editPost.name : '');
    if (name == null) return;
    const amountStr = prompt('Betrag (in €):', editPost ? editPost.amount : '');
    let amount;
    if (editPost && (amountStr === '' || amountStr === null)) {
      amount = editPost.amount;
    } else {
      amount = parseFloat(amountStr);
      if (isNaN(amount)) return;
    }
    const intervalStr = prompt('Intervall (in Monaten):', editPost ? editPost.interval : '1');
    let interval;
    if (editPost && (intervalStr === '' || intervalStr === null)) {
      interval = editPost.interval;
    } else {
      interval = parseInt(intervalStr, 10);
      if (!interval || interval < 1) return;
    }
    const startStr = prompt('Startmonat (JJJJ-MM):', editPost ? editPost.startMonth : currentMonth);
    const startMonth = editPost && (startStr === '' || startStr === null) ? editPost.startMonth : startStr;
    if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) return;

    const currentEnd = editPost && editPost.endMonth ? editPost.endMonth : '';
    const endStr = prompt('Bis wann läuft der Posten? (JJJJ-MM, leer = unbegrenzt):', currentEnd);
    const endMonth = endStr == null ? currentEnd : endStr.trim();
    if (endMonth && !/^\d{4}-\d{2}$/.test(endMonth)) return;
    if (endMonth && monthDiff(startMonth, endMonth) < 0) {
      alert('Endmonat darf nicht vor dem Startmonat liegen.');
      return;
    }

    if (editPost) {
      editPost.name = name.trim();
      editPost.amount = amount;
      editPost.interval = interval;
      editPost.startMonth = startMonth;
      editPost.endMonth = endMonth;
    } else {
      state.personalCosts.push({
        id: generateId(),
        personId,
        name: name.trim(),
        amount,
        interval,
        startMonth,
        endMonth,
        paidMonths: []
      });
    }
    saveState();
    render();
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
    return pot;
  }

  function syncReserveItemWithPot(monthKey, itemName, shouldApply) {
    const amount = getReserveItemAmount(monthKey, itemName);
    if (!(amount > 0)) return;
    const pot = ensurePotByName(itemName);
    const itemKey = getReserveItemKey(monthKey, itemName);
    const existingIndex = (pot.transactions || []).findIndex(
      (t) => t && t.source === 'reserve_auto' && t.itemKey === itemKey
    );

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
        pot.balance = Number(pot.balance || 0) + amount;
      }
    } else {
      if (existingIndex >= 0) {
        const existing = pot.transactions[existingIndex];
        pot.balance = Number(pot.balance || 0) - Number(existing.amount || 0);
        pot.transactions.splice(existingIndex, 1);
      }
    }
  }

  function syncAllReserveSelectionsToPots() {
    if (!state.reserveItemSaved) state.reserveItemSaved = {};
    Object.entries(state.reserveItemSaved).forEach(([itemKey, isSaved]) => {
      if (!isSaved) return;
      const parts = itemKey.split('__');
      if (parts.length < 2) return;
      const monthKey = parts[0];
      const itemName = parts.slice(1).join('__');
      syncReserveItemWithPot(monthKey, itemName, true);
    });
  }

  function renderSavings() {
    savingsSection.innerHTML = '';
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
    header.appendChild(monthSelect);
    card.appendChild(header);

    const title = document.createElement('h2');
    title.textContent = 'Rücklagen & Sparen';
    card.appendChild(title);

    if (monthDiff(currentMonth, savingsConfig.startMonth) < 0) {
      const p = document.createElement('p');
      p.textContent = `Die Aufteilung startet erst ab ${savingsConfig.startMonth}.`;
      card.appendChild(p);
      savingsSection.appendChild(card);
      return;
    }

    const items = [
      ['Auto', getReserveContributionForPot('Auto', currentMonth)],
      ['Urlaub', getReserveContributionForPot('Urlaub', currentMonth)],
      ['Anschaffungen (inkl. Wohnen)', getReserveContributionForPot('Anschaffungen (inkl. Wohnen)', currentMonth)],
      ['Kleidung', getReserveContributionForPot('Kleidung', currentMonth)],
      ['Freizeit', getReserveContributionForPot('Freizeit', currentMonth)],
      ['Sparen', getSavingsContribution(currentMonth)]
    ];

    const table = document.createElement('table');
    table.className = 'list-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Topf</th><th>Betrag</th><th>Status</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');

    items.forEach(([itemName, amount]) => {
      const tr = document.createElement('tr');
      const itemKey = getReserveItemKey(currentMonth, itemName);
      const saved = !!state.reserveItemSaved[itemKey];

      tr.innerHTML = `<td>${itemName}</td><td>${Number(amount || 0).toFixed(2)} €</td><td></td>`;
      const statusTd = tr.children[2];

      if (amount > 0) {
        const btn = document.createElement('button');
        if (saved) {
          btn.textContent = itemName === 'Sparen' ? 'Gespart – Rückgängig' : 'Zurückgelegt – Rückgängig';
          btn.className = 'secondary';
        } else {
          btn.textContent = itemName === 'Sparen' ? 'Als gespart markieren' : 'Als zurückgelegt markieren';
          btn.className = 'success';
        }
        btn.addEventListener('click', () => {
          const nextValue = !state.reserveItemSaved[itemKey];
          state.reserveItemSaved[itemKey] = nextValue;
          syncReserveItemWithPot(currentMonth, itemName, nextValue);
          saveState();
          render();
        });
        statusTd.appendChild(btn);
      } else {
        statusTd.textContent = '-';
      }

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    card.appendChild(table);
    savingsSection.appendChild(card);
  }

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
    (state.pots || []).forEach((pot) => {
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
      if (!state.pots) state.pots = [];
      state.pots.push({ id: generateId(), name: trimmed, balance: initial, transactions: [] });
      saveState();
      render();
    });

    header.appendChild(monthSelect);
    header.appendChild(potSelect);
    header.appendChild(addBtn);
    card.appendChild(header);

    if (!state.pots) state.pots = [];
    const table = document.createElement('table');
    table.className = 'list-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Name</th><th>Saldo</th><th>Diesen Monat +</th><th>Diesen Monat -</th><th>Aktion</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    state.pots.forEach((pot) => {
      if (!pot.transactions) pot.transactions = [];
      const monthTransactions = pot.transactions.filter((t) => t.date === currentMonth);
      const deposits = monthTransactions.filter((t) => Number(t.amount) > 0).reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const withdrawals = monthTransactions.filter((t) => Number(t.amount) < 0).reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);

      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${pot.name}</td><td>${Number(pot.balance || 0).toFixed(2)} €</td><td>${deposits.toFixed(2)} €</td><td>${withdrawals.toFixed(2)} €</td><td></td>`;

      const actionTd = tr.children[4];
      const dep = document.createElement('button');
      dep.textContent = 'Einzahlen';
      dep.className = 'success';
      dep.addEventListener('click', () => {
        const amountStr = prompt(`Betrag zum Einzahlen in "${pot.name}":`, '0');
        if (amountStr == null) return;
        const amount = parseFloat(amountStr);
        if (!(amount > 0)) {
          alert('Bitte einen positiven Betrag eingeben.');
          return;
        }
        const desc = prompt('Beschreibung (optional):', 'Einzahlung');
        pot.balance = Number(pot.balance || 0) + amount;
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
        const amount = parseFloat(amountStr);
        if (!(amount > 0)) {
          alert('Bitte einen positiven Betrag eingeben.');
          return;
        }
        const desc = prompt('Beschreibung (optional):', 'Ausgabe');
        pot.balance = Number(pot.balance || 0) - amount;
        pot.transactions.push({ date: currentMonth, type: 'withdraw', amount: -amount, description: desc || '' });
        saveState();
        render();
      });

      actionTd.appendChild(dep);
      actionTd.appendChild(wit);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    card.appendChild(table);

    const total = (state.pots || []).reduce((sum, pot) => sum + Number(pot.balance || 0), 0);
    const totalP = document.createElement('p');
    totalP.innerHTML = `<strong>Gesamtsumme aller Töpfe:</strong> ${total.toFixed(2)} €`;
    card.appendChild(totalP);

    if (selectedPotId) {
      const pot = (state.pots || []).find((p) => p.id === selectedPotId);
      if (pot) {
        const detail = document.createElement('div');
        detail.className = 'card';
        const h3 = document.createElement('h3');
        h3.textContent = `Details für ${pot.name}`;
        detail.appendChild(h3);

        const detTable = document.createElement('table');
        detTable.className = 'list-table';
        const detHead = document.createElement('thead');
        detHead.innerHTML = '<tr><th>Monat</th><th>Einzahlungen</th><th>Auszahlungen</th></tr>';
        detTable.appendChild(detHead);
        const detBody = document.createElement('tbody');

        monthList.forEach((m) => {
          const monthTransactions = (pot.transactions || []).filter((t) => t.date === m.key);
          const dep = monthTransactions.filter((t) => Number(t.amount) > 0).reduce((sum, t) => sum + Number(t.amount || 0), 0);
          const wit = monthTransactions.filter((t) => Number(t.amount) < 0).reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
          const row = document.createElement('tr');
          row.innerHTML = `<td>${m.label}</td><td>${dep.toFixed(2)} €</td><td>${wit.toFixed(2)} €</td>`;
          detBody.appendChild(row);
        });
        detTable.appendChild(detBody);
        detail.appendChild(detTable);
        card.appendChild(detail);
      }
    }

    potsSection.appendChild(card);
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
      versionChip.textContent = 'Update 0.62 geladen';
      setTimeout(() => {
        versionChip.textContent = 'Version 0.62 geladen';
      }, 2500);
    } else {
      versionChip.textContent = 'Version 0.62 geladen';
    }
  }

  // Starte das Rendering
  render();
})();