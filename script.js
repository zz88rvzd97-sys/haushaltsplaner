/*
 * Haushaltsplaner Developer Beta 0.60
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
  let saved = localStorage.getItem('budgetStateV060');
    if (!saved) {
      // Fallback-Migration aus älteren Versionen
      const fallback = [
        'budgetStateV059','budgetStateV058','budgetStateV057','budgetStateV056','budgetStateV055','budgetStateV054','budgetStateV053','budgetStateV052','budgetStateV051','budgetStateV050','budgetStateV049','budgetStateV048','budgetStateV047','budgetStateV046','budgetStateV045','budgetStateV044','budgetStateV043','budgetStateV042','budgetStateV041','budgetStateV040','budgetStateV039','budgetStateV038','budgetStateV037','budgetStateV036','budgetStateV035','budgetStateV034','budgetStateV033','budgetStateV032','budgetStateV031','budgetStateV030','budgetStateV029','budgetStateV028','budgetStateV027','budgetStateV026','budgetStateV025','budgetStateV024','budgetStateV023','budgetStateV022','budgetStateV021','budgetStateV020','budgetStateV019','budgetStateV018','budgetStateV017','budgetStateV016','budgetStateV015'
      ];
      for (const k of fallback) {
        const data = localStorage.getItem(k);
        if (data) {
          saved = data;
          // Bei erfolgreicher Migration unter neuem Key speichern
          localStorage.setItem('budgetStateV060', data);
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
  } catch (err) {
    state = JSON.parse(JSON.stringify(defaultState));
  }

  function saveState() {
    localStorage.setItem('budgetStateV060', JSON.stringify(state));
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
      totalCommonRaw += getCommonMonthlyShare(c);
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
  function isDue(post, month) {
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
      totalCommonRaw += getCommonMonthlyShare(c);
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
    // Kopfzeile: Monat auswählen und neuen Posten hinzufügen
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
        <th>Monatsanteil</th>
        <th>Fällig</th>
        <th>Bezahlt?</th>
        <th>Aktion</th>
      </tr>`;
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      state.commonCosts.forEach((c) => {
        const tr = document.createElement('tr');
        const dueNow = isDue(c, currentMonth);
        const monthlyShare = getCommonMonthlyShare(c);
        tr.innerHTML = `<td>${c.name}</td>
          <td>${c.amount.toFixed(2)} €</td>
          <td>${c.interval}</td>
          <td>${c.startMonth}</td>
          <td>${monthlyShare.toFixed(2)} €</td>
          <td>${dueNow ? 'Ja' : 'Nein'}</td>
          <td></td>
          <td></td>`;
        // Bezahlt-Spalte: Markieren-Knopf oder bereits bezahlt
        const paidCell = tr.children[6];
        const paidNow = c.paidMonths && c.paidMonths.includes(currentMonth);
        if (dueNow) {
          if (!paidNow) {
            const btn = document.createElement('button');
            btn.textContent = 'Markieren';
            btn.className = 'success';
            btn.addEventListener('click', () => {
              if (!c.paidMonths) c.paidMonths = [];
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
        // Aktionsspalte: Bearbeiten und Löschen
        const actionCell = tr.children[7];
        const editBtn = document.createElement('button');
        editBtn.textContent = '✎';
        editBtn.className = 'primary';
        editBtn.addEventListener('click', () => {
          // Wenn bereits im Bearbeitungsmodus, nichts tun
          if (tr.dataset.editing === 'true') return;
          tr.dataset.editing = 'true';
          const originalCells = [...tr.children].map((td) => td.innerHTML);
          tr.dataset.originalCells = JSON.stringify(originalCells);
          tr.innerHTML = '';
          // Eingabefelder
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
            if (!/\d{4}-\d{2}/.test(newStart)) {
              alert('Startmonat muss im Format JJJJ-MM vorliegen.');
              return;
            }
            c.name = newName;
            c.amount = newAmount;
            c.interval = newInterval;
            c.startMonth = newStart;
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
      // Summe & Aufschlüsselung
      let totalMonthly = 0;
      state.commonCosts.forEach((c) => {
        totalMonthly += getCommonMonthlyShare(c);
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
      // Bereits bezahlt / offen
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
        payInfo.innerHTML = `<strong>Bereits bezahlt:</strong> ${paidSum.toFixed(2)} € (offen: ${(dueSum - paidSum).toFixed(2)} €)`;
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
    if (!startMonth || !/\d{4}-\d{2}/.test(startMonth)) return;
    if (editCost) {
      editCost.name = name.trim();
      editCost.amount = amount;
      editCost.interval = interval;
      editCost.startMonth = startMonth;
    } else {
      state.commonCosts.push({
        id: generateId(),
        name: name.trim(),
        amount,
        interval,
        startMonth,
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
          <th>Name</th><th>Betrag</th><th>Intervall</th><th>Start</th><th>Fällig</th><th>Bezahlt?</th><th>Aktion</th>
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
            <td>${dueNow ? 'Ja' : 'Nein'}</td>
            <td></td><td></td>`;
          // Bezahlt-Spalte als Knopf
          const paidCell = tr.children[5];
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
          // Aktionszelle: bearbeiten / löschen
          const actionCell = tr.children[5];
          const editBtn = document.createElement('button');
          editBtn.textContent = '✎';
          editBtn.className = 'primary';
          editBtn.addEventListener('click', () => {
            if (tr.dataset.editing === 'true') return;
            tr.dataset.editing = 'true';
            const originalCells = [...tr.children].map((td) => td.innerHTML);
            tr.dataset.originalCells = JSON.stringify(originalCells);
            tr.innerHTML = '';
            // Eingabefelder
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
            const dueTd = document.createElement('td');
            dueTd.textContent = dueNow ? 'Ja' : 'Nein';
            const paidTd = document.createElement('td');
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
            const actionTd = document.createElement('td');
            const saveBtn = document.createElement('button');
            saveBtn.textContent = '✔';
            saveBtn.className = 'primary';
            saveBtn.addEventListener('click', () => {
              const newName = nameInput.value.trim();
              const newAmount = parseFloat(amountInput.value);
              const newInterval = parseInt(intervalInput.value, 10);
              const newStart = startInput.value;
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
              if (!/\d{4}-\d{2}/.test(newStart)) {
                alert('Startmonat muss im Format JJJJ-MM vorliegen.');
                return;
              }
              pc.name = newName;
              pc.amount = newAmount;
              pc.interval = newInterval;
              pc.startMonth = newStart;
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
        // Summenzeile: bereits bezahlt/offen
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
          info.innerHTML = `<strong>Bereits bezahlt:</strong> ${paidSum.toFixed(2)} € (offen: ${(dueSum - paidSum).toFixed(2)} €)`;
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
    if (!startMonth || !/\d{4}-\d{2}/.test(startMonth)) return;
    if (editPost) {
      editPost.name = name.trim();
      editPost.amount = amount;
      editPost.interval = interval;
      editPost.startMonth = startMonth;
    } else {
      state.personalCosts.push({
        id: generateId(),
        personId,
        name: name.trim(),
        amount,
        interval,
        startMonth,
        paidMonths: []
      });
    }
    saveState();
    render();
  }

  function estimateDebtEndMonth(debt) {
    if (!debt || !debt.nextDueMonth) return '-';
    const rate = Number(debt.monthlyRate || 0);
    const balance = Number(debt.amountOpen || 0);
    if (rate <= 0 || balance <= 0) {
      return balance <= 0 ? 'erledigt' : 'offen';
    }
    const monthsNeeded = Math.ceil(balance / rate);
    return addMonths(debt.nextDueMonth, Math.max(monthsNeeded - 1, 0));
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
    state.persons.forEach((p) => {
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
      const overrideInput = document.createElement('input');
      overrideInput.type = 'number';
      overrideInput.step = '0.01';
      overrideInput.placeholder = `Netto im ${currentMonth}`;
      overrideInput.value = p.netOverrides && p.netOverrides[currentMonth] != null ? p.netOverrides[currentMonth] : '';
      overrideInput.addEventListener('change', () => {
        const v = parseFloat(overrideInput.value);
        if (overrideInput.value === '') {
          delete p.netOverrides[currentMonth];
        } else if (!isNaN(v)) {
          if (!p.netOverrides) p.netOverrides = {};
          p.netOverrides[currentMonth] = v;
        }
        saveState();
        render();
      });
      const resetBtn = document.createElement('button');
      resetBtn.textContent = 'Monats-Netto zurücksetzen';
      resetBtn.addEventListener('click', () => {
        if (p.netOverrides) delete p.netOverrides[currentMonth];
        saveState();
        render();
      });
      const col1 = document.createElement('div');
      col1.appendChild(createLabelInput('Name', nameInput));
      const col2 = document.createElement('div');
      col2.appendChild(createLabelInput('Netto (Basis)', netInput));
      const col3 = document.createElement('div');
      col3.appendChild(createLabelInput('Verschiebung', shiftInput));
      const col4 = document.createElement('div');
      col4.appendChild(createLabelInput(`Netto im ${monthSelect.value} (optional)`, overrideInput));
      const col5 = document.createElement('div');
      col5.appendChild(resetBtn);
      row.appendChild(col1);
      row.appendChild(col2);
      row.appendChild(col3);
      row.appendChild(col4);
      row.appendChild(col5);
      personCard.appendChild(row);
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
      let statusCellHtml = '-';
      if (!beforeStart) {
        const done = !!state.reserveItemSaved[currentMonth][item.key];
        if (done) {
          statusCellHtml = `<button class="primary" disabled>${item.doneLabel}</button>`;
        } else {
          statusCellHtml = `<button class="primary" data-key="${item.key}">Markieren</button>`;
        }
      }
      row.innerHTML = `<td>${item.label}</td><td>${item.amount.toFixed(2)} €</td><td>${statusCellHtml}</td>`;
      const btn = row.querySelector('button[data-key]');
      if (btn) {
        btn.addEventListener('click', (ev) => {
          const key = ev.target.getAttribute('data-key');
          if (!state.reserveItemSaved[currentMonth]) state.reserveItemSaved[currentMonth] = {};
          state.reserveItemSaved[currentMonth][key] = true;
          saveState();
          render();
        });
      }
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    card.appendChild(table);

    const note = document.createElement('p');
    note.textContent = 'Die Gesamtsumme und Verwaltung der Rücklagen findest du im Menü "Töpfe".';
    card.appendChild(note);
    savingsSection.appendChild(card);
  }

  // Rendert den neuen Bereich „Töpfe“ mit allen Rücklagen-Töpfen und Summen
  function renderPots() {
    potsSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    // Kopfzeile mit Monat und Neu-Button
    const header = document.createElement('div');
    header.className = 'row';
    // Monat auswählen
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      currentMonth = e.target.value;
      updateMonthListIfNeeded();
      render();
    });
    // Pot-Auswahl
    const potSelect = document.createElement('select');
    // Option für Gesamt / keine Details
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'Alle Töpfe';
    potSelect.appendChild(allOpt);
    state.pots.forEach((pot) => {
      const opt = document.createElement('option');
      opt.value = pot.id;
      opt.textContent = pot.name;
      if (pot.id === selectedPotId) opt.selected = true;
      potSelect.appendChild(opt);
    });
    // Option für das Sparen-Depot (nur Anzeige)
    const savingsOpt = document.createElement('option');
    savingsOpt.value = 'savings';
    savingsOpt.textContent = 'Sparen';
    if (selectedPotId === 'savings') savingsOpt.selected = true;
    potSelect.appendChild(savingsOpt);
    potSelect.addEventListener('change', (e) => {
      selectedPotId = e.target.value || '';
      render();
    });
    // Neuer Topf
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
    // Liste der Töpfe mit manuellen Salden und automatischen Beiträgen
    const table = document.createElement('table');
    table.className = 'list-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Name</th><th>Saldo</th><th>Plan (12 Monate)</th><th>Aktion</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    // Falls keine Töpfe vorhanden sind, soll trotzdem die Plan-Zeile für die Rücklagen angezeigt werden
    if (!state.pots) state.pots = [];
    state.pots.forEach((pot) => {
      const tr = document.createElement('tr');
      // Summe der automatischen Beiträge für diesen Topf in den nächsten 12 Monaten
      let autoSum = 0;
      monthList.forEach((m) => {
        autoSum += getReserveContributionForPot(pot.name, m.key);
      });
      tr.innerHTML = `<td>${pot.name}</td><td>${pot.balance.toFixed(2)} €</td><td>${autoSum.toFixed(2)} €</td><td></td>`;
      const act = tr.children[3];
      // Einzahlen
      const dep = document.createElement('button');
      dep.textContent = 'Einzahlen';
      dep.className = 'success';
      dep.addEventListener('click', () => {
        const amountStr = prompt(`Betrag zum Einzahlen in "${pot.name}":`, '0');
        if (amountStr == null) return;
        let amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
          alert('Bitte einen positiven Betrag eingeben.');
          return;
        }
        const desc = prompt('Beschreibung (optional):', 'Einzahlung');
        pot.balance += amount;
        if (!pot.transactions) pot.transactions = [];
        pot.transactions.push({ date: currentMonth, type: 'deposit', amount: amount, description: desc || '' });
        saveState();
        render();
      });
      // Ausgeben
      const wit = document.createElement('button');
      wit.textContent = 'Ausgeben';
      wit.className = 'danger';
      wit.addEventListener('click', () => {
        const amountStr = prompt(`Betrag zum Ausgeben aus "${pot.name}":`, '0');
        if (amountStr == null) return;
        let amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
          alert('Bitte einen positiven Betrag eingeben.');
          return;
        }
        if (amount > pot.balance) {
          if (!confirm('Der Betrag ist größer als der Saldo. Trotzdem fortfahren?')) {
            return;
          }
        }
        const desc = prompt('Beschreibung (optional):', 'Ausgabe');
        pot.balance -= amount;
        if (!pot.transactions) pot.transactions = [];
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
    // Automatische Zeile für die Spar-Komponente (30 % des verteilbaren Betrags)
    // Diese Zeile dient nur zur Anzeige und besitzt keine manuellen Aktionen.
    const savingsTable = document.createElement('table');
    savingsTable.className = 'list-table';
    const sHead = document.createElement('thead');
    sHead.innerHTML = '<tr><th>Depot</th><th>Plan (12 Monate)</th></tr>';
    savingsTable.appendChild(sHead);
    const sBody = document.createElement('tbody');
    let savingsSum = 0;
    monthList.forEach((m) => {
      savingsSum += getSavingsContribution(m.key);
    });
    const sRow = document.createElement('tr');
    sRow.innerHTML = `<td>Sparen</td><td>${savingsSum.toFixed(2)} €</td>`;
    sBody.appendChild(sRow);
    savingsTable.appendChild(sBody);
    card.appendChild(savingsTable);
    // Gesamtsummen unter den Tabellen anzeigen
    let totalManual = 0;
    let totalAuto = 0;
    state.pots.forEach((p) => {
      totalManual += p.balance;
      monthList.forEach((m) => {
        totalAuto += getReserveContributionForPot(p.name, m.key);
      });
    });
    const totalsP = document.createElement('p');
    totalsP.innerHTML = `<strong>Gesamtsumme manuell:</strong> ${totalManual.toFixed(2)} € &nbsp; | &nbsp; <strong>Gesamt Rücklagen‑Plan:</strong> ${totalAuto.toFixed(2)} € &nbsp; | &nbsp; <strong>Sparen‑Plan:</strong> ${savingsSum.toFixed(2)} €`;
    card.appendChild(totalsP);
    // Detailansicht für ausgewählten Topf oder das Sparen
    if (selectedPotId) {
      let pot;
      let isSavingsPot = false;
      if (selectedPotId === 'savings') {
        isSavingsPot = true;
      } else {
        pot = state.pots.find((p) => p.id === selectedPotId);
        if (!pot) {
          // Fallback: falls der pot inzwischen entfernt wurde
          selectedPotId = '';
        }
      }
      if (isSavingsPot || pot) {
        const detailCard = document.createElement('div');
        detailCard.className = 'card';
        const detailTitle = document.createElement('h3');
        detailTitle.textContent = isSavingsPot ? 'Details für Sparen' : `Details für ${pot.name}`;
        detailCard.appendChild(detailTitle);
        const detTable = document.createElement('table');
        detTable.className = 'list-table';
        const dHead = document.createElement('thead');
        dHead.innerHTML = '<tr><th>Monat</th><th>Plan</th><th>Einzahlungen</th><th>Auszahlungen</th></tr>';
        detTable.appendChild(dHead);
        const dBody = document.createElement('tbody');
        monthList.forEach((m) => {
          let autoVal;
          if (isSavingsPot) {
            autoVal = getSavingsContribution(m.key);
          } else {
            autoVal = getReserveContributionForPot(pot.name, m.key);
          }
          let dep = 0;
          let wit = 0;
          if (!isSavingsPot) {
            (pot.transactions || []).forEach((t) => {
              if (t.date === m.key) {
                if (t.amount >= 0) dep += t.amount;
                if (t.amount < 0) wit += Math.abs(t.amount);
              }
            });
          }
          const dRow = document.createElement('tr');
          dRow.innerHTML = `<td>${m.label}</td><td>${autoVal.toFixed(2)} €</td><td>${dep.toFixed(2)} €</td><td>${wit.toFixed(2)} €</td>`;
          dBody.appendChild(dRow);
        });
        detTable.appendChild(dBody);
        detailCard.appendChild(detTable);
        // Summe für Details
        let sumAuto = 0;
        monthList.forEach((m) => {
          sumAuto += isSavingsPot ? getSavingsContribution(m.key) : getReserveContributionForPot(pot.name, m.key);
        });
        const summaryDetail = document.createElement('p');
        summaryDetail.innerHTML = `<strong>Plan-Gesamt für 12 Monate:</strong> ${sumAuto.toFixed(2)} €`;
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
      versionChip.textContent = 'Update 0.60 geladen';
      setTimeout(() => {
        versionChip.textContent = 'Version 0.60 geladen';
      }, 2500);
    } else {
      versionChip.textContent = 'Version 0.60 geladen';
    }
  }

  // Starte das Rendering
  render();
})();