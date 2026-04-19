/*
 * Haushaltsplaner Developer Beta 0.44
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
    reserveItemSaved: {}
  };
  let state;
  try {
  let saved = localStorage.getItem('budgetStateV044');
    if (!saved) {
      // Fallback-Migration aus älteren Versionen
      const fallback = [
        'budgetStateV043','budgetStateV042','budgetStateV041','budgetStateV040','budgetStateV039','budgetStateV038','budgetStateV037','budgetStateV036','budgetStateV035','budgetStateV034','budgetStateV033','budgetStateV032','budgetStateV031','budgetStateV030','budgetStateV029','budgetStateV028','budgetStateV027','budgetStateV026','budgetStateV025','budgetStateV024','budgetStateV023','budgetStateV022','budgetStateV021','budgetStateV020','budgetStateV019','budgetStateV018','budgetStateV017','budgetStateV016','budgetStateV015'
      ];
      for (const k of fallback) {
        const data = localStorage.getItem(k);
        if (data) {
          saved = data;
          // Bei erfolgreicher Migration unter neuem Key speichern
          localStorage.setItem('budgetStateV044', data);
          break;
        }
      }
    }
    state = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(defaultState));
    // Falls das neue Flag für Rücklagen‑Bestätigungen fehlt, initialisiere es
    if (!state.reservesSavedMonths) state.reservesSavedMonths = [];
    if (!state.reserveItemSaved) state.reserveItemSaved = {};
  } catch (err) {
    state = JSON.parse(JSON.stringify(defaultState));
  }
  function saveState() {
    localStorage.setItem('budgetStateV044', JSON.stringify(state));
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
  // ----- Rendering -----
  function render() {
    renderOverview();
    renderCommon();
    renderPersonal();
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
  function renderSave() {
    saveSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const h2 = document.createElement('h2');
    h2.textContent = 'Sichern & Exportieren';
    card.appendChild(h2);
    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Daten exportieren (JSON)';
    exportBtn.className = 'primary';
    exportBtn.addEventListener('click', () => {
      try {
        const dataStr = JSON.stringify(state, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'budget_data.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (err) {
        alert('Fehler beim Export: ' + err.message);
      }
    });
    card.appendChild(exportBtn);
    const importRow = document.createElement('div');
    importRow.className = 'row';
    const importLabel = document.createElement('label');
    importLabel.textContent = 'Daten importieren (JSON):';
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = 'application/json';
    importInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.persons && data.commonCosts && data.personalCosts && data.debts) {
            state = data;
            saveState();
            render();
            alert('Daten erfolgreich importiert.');
          } else {
            alert('Ungültiges Datenformat.');
          }
        } catch (err) {
          alert('Fehler beim Import: ' + err.message);
        }
      };
      reader.readAsText(file);
    });
    importRow.appendChild(importLabel);
    importRow.appendChild(importInput);
    card.appendChild(importRow);
    const p = document.createElement('p');
    p.textContent = 'Hier kannst du deine Daten als JSON-Datei exportieren oder einen zuvor exportierten Stand wieder importieren. Beim Import wird der aktuelle Stand überschrieben.';
    card.appendChild(p);
    saveSection.appendChild(card);
  }
  // Hilfsfunktionen zum Erstellen von Monatsauswahl und Label-Input-Paaren
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
      versionChip.textContent = 'Update 0.43 geladen';
      setTimeout(() => {
        versionChip.textContent = 'Version 0.43 geladen';
      }, 2500);
    } else {
      versionChip.textContent = 'Version 0.43 geladen';
    }
  }

  // Starte das Rendering
  render();
})();