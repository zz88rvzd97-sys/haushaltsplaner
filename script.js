/*
 * Haushaltsplaner Developer Beta 0.29
 *
  * Diese JavaScript-Datei enthält die komplette Logik der Web‑App. Die
 * Applikation speichert alle Daten im LocalStorage, so dass die
 * eingegebenen Posten und Einstellungen auch nach dem Schließen des
 * Browsers bestehen bleiben. Kernfunktionen:
 *
    *  - Übersicht: zeigt pro Person Einkommen, Anteil gemeinsamer Kosten,
    *    persönliche Ausgaben, Schuldenanteil und verfügbaren Rest für den
    *    aktuell ausgewählten Monat.
 *  - Gemeinsame Kosten: Posten mit Betrag, Zahlungsintervall und
 *    Startmonat. Die monatlichen Anteile werden automatisch aus dem
 *    Betrag und dem Intervall berechnet. In Monaten, in denen ein
 *    Posten nicht fällig ist, wird der Haken zur Bestätigung
 *    deaktiviert.
 *  - Persönliche Ausgaben: Posten je Person, die nur in
 *    Fälligkeitsmonaten gerechnet werden. Auch hier kann ein Haken
 *    gesetzt werden, um zu markieren, dass der Posten bereits bezahlt
 *    wurde.
 *  - Schulden: Jede Schuld hat einen offenen Betrag, eine Monatsrate
 *    und eine „nächste Fälligkeit“. Wird eine Schuld im aktuellen
 *    Monat als bezahlt markiert, wird der offene Betrag reduziert
 *    und die Fälligkeit um einen Monat nach vorn geschoben. Der
 *    Benutzer kann so einzeln steuern, wann welche Schuld bedient
 *    wurde, ohne alle Schulden gleichzeitig abzuschließen.
 *  - Regeln & Personen: Namen, Nettogehälter und prozentuale
 *    Verschiebebeträge anpassen. Außerdem können temporäre
 *    Monatsabweichungen des Nettos für den ausgewählten Monat
 *    eingetragen werden.
 */

(() => {
  // Entferne bestehende Service‑Worker und leere Caches, um alte Versionen
  // aus dem Browser zu entfernen. Diese Bereinigung findet vor der
  // Initialisierung der App statt und verhindert, dass ein veralteter
  // Service‑Worker weiterhin offline Versionen bedient. Sie wirkt nur
  // einmalig beim Laden dieser Version.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => {
        reg.unregister();
      });
    });
  }
  if (window.caches) {
    caches.keys().then((keys) => {
      keys.forEach((key) => caches.delete(key));
    });
  }
  // ---------- Hilfsfunktionen zum Umgang mit Datumsangaben ----------
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
    // Differenz in Monaten von a bis b
    const da = monthKeyToDate(a);
    const db = monthKeyToDate(b);
    return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
  }
  function nextMonth(key) {
    const d = monthKeyToDate(key);
    d.setMonth(d.getMonth() + 1);
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

  // ---------- Datenmodell und Persistenz ----------
  const defaultState = {
    persons: [
      {
        id: 'p1',
        name: 'Benny',
        net: 2300,
        netOverrides: {}, // Monatsbezogene Netto-Abweichungen
        shift: 0 // Verschiebebetrag für die Aufteilung der gemeinsamen Kosten
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
    debts: []
    ,
    // Rücklagen- und Spar-Töpfe. Jeder Topf besitzt eine eindeutige id,
    // einen Namen, einen aktuellen Saldo und eine Liste von Buchungen.
    // Buchungen können Einzahlungen (positiver Betrag) oder Ausgaben
    // (negativer Betrag) sein.
    pots: []
  };
  let state;
  try {
    // Lade eventuell vorhandene Daten aus dem LocalStorage. Für Beta 0.29
    // heisst der Schlüssel "budgetStateV029". Falls dort nichts gespeichert
    // ist, versuchen wir eine Migration aus den Vorgänger‑Versionen
    // (0.28, 0.27, 0.26, 0.25, 0.24, 0.23, 0.22, 0.21, 0.20, 0.19, 0.18, 0.17, 0.16, 0.15).
    let saved = localStorage.getItem('budgetStateV029');
    if (!saved) {
      const fallbackKeys = ['budgetStateV028','budgetStateV027','budgetStateV026','budgetStateV025','budgetStateV024','budgetStateV023','budgetStateV022','budgetStateV021','budgetStateV020','budgetStateV019','budgetStateV018','budgetStateV017','budgetStateV016','budgetStateV015'];
      for (const k of fallbackKeys) {
        const data = localStorage.getItem(k);
        if (data) {
          saved = data;
          // Kopiere die Daten unter den neuen Schlüssel, damit die
          // Migration nur einmal durchgeführt werden muss.
          localStorage.setItem('budgetStateV029', data);
          break;
        }
      }
    }
    state = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(defaultState));
  } catch (e) {
    state = JSON.parse(JSON.stringify(defaultState));
  }
  function saveState() {
    // Speichere den aktuellen Zustand unter dem Beta‑0.29‑Schlüssel. So wird
    // verhindert, dass alte Versionen die neuen Daten überschreiben.
    localStorage.setItem('budgetStateV029', JSON.stringify(state));
  }

  // ---------- Zeitliche Auswahl ----------
  const today = new Date();
  const startMonthKey = dateToMonthKey(today);
  let monthList = getNext12Months(startMonthKey);
  let currentMonth = monthList[0].key;

  // ---------- DOM-Referenzen ----------
  const overviewSection = document.getElementById('overview');
  const commonSection = document.getElementById('common');
  const personalSection = document.getElementById('personal');
  const debtsSection = document.getElementById('debts');
  const settingsSection = document.getElementById('settings');
  const saveSection = document.getElementById('save');
  const savingsSection = document.getElementById('savings');
  const sectionSelect = document.getElementById('sectionSelect');
  // Aktuelle Ansicht (Übersicht, common, personal, debts, settings, save)
  let currentSection = 'overview';
  // Navigation: Drop‑down für Bereiche
  sectionSelect.addEventListener('change', (e) => {
    currentSection = e.target.value;
    // Sichtbarkeit der Abschnitte anpassen
    document.querySelectorAll('.tab-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === currentSection);
    });
    // Render der gewählten Ansicht, falls Daten sich geändert haben
    render();
  });

  // ---------- Hilfsfunktionen zur Datenberechnung ----------
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
   * Berechnet die monatlichen Anteile der gemeinsamen Kosten für jede Person.
   *
   * Für jede Person wird anhand des Nettoeinkommens (inklusive
   * Verschiebebetrag) ein ungerundeter Anteil ermittelt. Dieser wird
   * anschließend **für jede Person unabhängig** auf das nächsthöhere
   * 5‑€‑Intervall aufgerundet.  Dadurch kann die Summe der gerundeten
   * Anteile größer als die tatsächliche Gesamtsumme der gemeinsamen
   * Kosten sein; diese Funktion führt **keine** Korrektur der
   * Differenz durch.  Das Ergebnis ist daher eine Liste von Anteilen,
   * bei denen jeder Anteil aufgerundet ist.  Die Summe der Anteile
   * kann die Gesamtsumme übersteigen – das ist beabsichtigt, da beide
   * Anteile jeweils aufgerundet werden sollen.
   *
   * @param {number} totalMonthly Gesamtsumme der monatlichen Anteile aller gemeinsamen Kosten
   * @param {Array<{person: Object, income: number}>} persons Eine Liste der Personen mit deren Einkommen
   * @returns {Object} Ein Mapping von person.id auf den aufgerundeten Anteil
   */
  function computeRoundedCommonShares(totalMonthly, persons) {
    const result = {};
    if (persons.length === 0) return result;
    // Gesamtnetto berechnen
    let totalIncome = 0;
    persons.forEach((p) => {
      totalIncome += p.income;
    });
    const roundingStep = 5;
    persons.forEach((p) => {
      const ratio = totalIncome ? p.income / totalIncome : 0;
      const base = (ratio * totalMonthly) + (p.person.shift || 0);
      const rounded = Math.ceil(base / roundingStep) * roundingStep;
      result[p.person.id] = rounded;
    });
    return result;
  }
  // ---------- Render-Funktionen ----------
  function render() {
    renderOverview();
    renderCommon();
    renderPersonal();
    renderDebts();
    renderSettings();
    renderSavings();
    renderSave();
    // Aktualisiere die Sichtbarkeit der Abschnitte entsprechend der aktuellen Auswahl
    document.querySelectorAll('.tab-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === currentSection);
    });
  }

  /**
   * Zeigt die Rücklagen- und Spar-Töpfe an und erlaubt das Hinzufügen
   * neuer Töpfe sowie Einzahlungen und Ausgaben. Jeder Topf hat
   * einen Namen, einen aktuellen Saldo und eine Liste von Buchungen.
   */
  function renderSavings() {
    savingsSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    // Auswahl des Monats und Kopfzeile mit Titel und Neu-Button
    const headerRow = document.createElement('div');
    headerRow.className = 'row';
    // Monat auswählen
    const monthLabel = document.createElement('label');
    monthLabel.textContent = 'Monat:';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      currentMonth = e.target.value;
      updateMonthListIfNeeded();
      render();
    });
    headerRow.appendChild(monthLabel);
    headerRow.appendChild(monthSelect);
    card.appendChild(headerRow);
    // Kopfzeile mit Titel und Neu-Button
    const header = document.createElement('div');
    header.className = 'row';
    const title = document.createElement('h2');
    title.textContent = 'Rücklagen & Sparen';
    title.style.flex = '1 1 auto';
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
    header.appendChild(title);
    header.appendChild(addBtn);
    card.appendChild(header);
    // Anzeige der bestehenden Töpfe
    if (!state.pots || state.pots.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Keine Rücklagen-Töpfe definiert.';
      card.appendChild(p);
    } else {
      const table = document.createElement('table');
      table.className = 'list-table';
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr><th>Name</th><th>Saldo</th><th>Aktion</th></tr>`;
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      state.pots.forEach((pot) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${pot.name}</td><td>${pot.balance.toFixed(2)} €</td><td></td>`;
        const actionCell = tr.children[2];
        // Einzahlen-Button
        const depositBtn = document.createElement('button');
        depositBtn.textContent = 'Einzahlen';
        depositBtn.className = 'success';
        depositBtn.addEventListener('click', () => {
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
          // Verwende das aktuell gewählte Monat als Buchungsdatum, damit
          // Einzahlungen dem Monat zugeordnet werden, der im Monatselect
          // gewählt ist. Dadurch verhält sich die App eher wie eine
          // Bankapp, die Buchungen einem Monat zuordnet.
          pot.transactions.push({ date: currentMonth, type: 'deposit', amount, description: desc || '' });
          saveState();
          render();
        });
        // Ausgeben-Button
        const withdrawBtn = document.createElement('button');
        withdrawBtn.textContent = 'Ausgeben';
        withdrawBtn.className = 'danger';
        withdrawBtn.addEventListener('click', () => {
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
          // Verwende das aktuell gewählte Monat als Buchungsdatum, analog zu
          // Einzahlungen.
          pot.transactions.push({ date: currentMonth, type: 'withdraw', amount: -amount, description: desc || '' });
          saveState();
          render();
        });
        actionCell.appendChild(depositBtn);
        actionCell.appendChild(withdrawBtn);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      card.appendChild(table);
      // Monatliche Summe der Einzahlungen/Ausgaben über alle Töpfe
      let monthlyDeposits = 0;
      let monthlyWithdrawals = 0;
      state.pots.forEach((pot) => {
        if (pot.transactions) {
          pot.transactions.forEach((t) => {
            if (t.date === currentMonth) {
              if (t.amount > 0) monthlyDeposits += t.amount;
              if (t.amount < 0) monthlyWithdrawals += Math.abs(t.amount);
            }
          });
        }
      });
      if (monthlyDeposits > 0 || monthlyWithdrawals > 0) {
        const summaryP = document.createElement('p');
        summaryP.innerHTML = `<strong>Dieser Monat:</strong> +${monthlyDeposits.toFixed(2)} € / -${monthlyWithdrawals.toFixed(2)} €`;
        card.appendChild(summaryP);
      }
    }
    savingsSection.appendChild(card);
  }
  // Übersicht
  function renderOverview() {
    overviewSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    // Monat auswählen
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
    // Daten berechnen
    let totalIncome = 0;
    const personsData = state.persons.map((p) => {
      const income = getPersonNet(p, currentMonth);
      totalIncome += income;
      return { person: p, income, commonShare: 0, personalDue: 0, debtShare: 0 };
    });
    // Gesamtsumme der monatlichen gemeinsamen Kosten (ungestuft). Anschließend
    // berechnen wir die gerundeten Anteile und die gerundete Gesamtsumme.
    let totalCommonShareRaw = 0;
    state.commonCosts.forEach((c) => {
      totalCommonShareRaw += getCommonMonthlyShare(c);
    });
    // Erstelle eine Liste der Personen mit ihren Netto-Einkommen für die
    // aktuelle Periode und berechne die gerundeten Anteile. Die Summe
    // dieser Anteile wird als offizielle Gesamtsumme genutzt, damit
    // Anteil + Anteil genau die Gesamtsumme ergibt.
    const personsListForShares = state.persons.map((p) => {
      const income = getPersonNet(p, currentMonth);
      return { person: p, income };
    });
    const shareMappingOverview = computeRoundedCommonShares(totalCommonShareRaw, personsListForShares);
    // Summiere die gerundeten Anteile
    const totalCommonShareRounded = Object.values(shareMappingOverview).reduce((sum, val) => sum + val, 0);
    personsData.forEach((pd) => {
      const shareVal = shareMappingOverview[pd.person.id] !== undefined ? shareMappingOverview[pd.person.id] : 0;
      pd.commonShare = shareVal;
    });
    // Persönliche Ausgaben
    state.personalCosts.forEach((pc) => {
      if (isDue(pc, currentMonth)) {
        const pd = personsData.find((x) => x.person.id === pc.personId);
        if (pd) pd.personalDue += pc.amount;
      }
    });
    // Hinweis: Schuldenanteil wird in dieser Übersicht nicht mehr separat ausgewiesen,
    // da er zu Doppelzählungen führen kann. Die Schuldenverwaltung erfolgt im Bereich
    // "Schulden". Daher setzen wir den Schuldenanteil für alle Personen auf 0.
    personsData.forEach((pd) => {
      pd.debtShare = 0;
    });
    // Tabelle erstellen
    const table = document.createElement('table');
    table.className = 'list-table';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
      <th>Person</th>
      <th>Netto</th>
      <th>Anteil gemeinsamer Kosten</th>
      <th>Persönliche Ausgaben</th>
      <th>Verfügbar</th>
    </tr>`;
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    personsData.forEach((pd) => {
      const available = pd.income - pd.commonShare - pd.personalDue;
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${pd.person.name}</td>
        <td>${pd.income.toFixed(2)} €</td>
        <td>${pd.commonShare.toFixed(2)} €</td>
        <td>${pd.personalDue.toFixed(2)} €</td>
        <td>${available.toFixed(2)} €</td>
      `;
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    const foot = document.createElement('tfoot');
    const totalPersonal = personsData.reduce((sum, pd) => sum + pd.personalDue, 0);
    const totalAvail = personsData.reduce((sum, pd) => sum + (pd.income - pd.commonShare - pd.personalDue), 0);
    const footRow = document.createElement('tr');
    footRow.innerHTML = `
      <td><strong>Summe</strong></td>
      <td>${totalIncome.toFixed(2)} €</td>
      <td>${totalCommonShareRounded.toFixed(2)} €</td>
      <td>${totalPersonal.toFixed(2)} €</td>
      <td>${totalAvail.toFixed(2)} €</td>
    `;
    foot.appendChild(footRow);
    table.appendChild(foot);
    card.appendChild(table);
    overviewSection.appendChild(card);
  }
  // Gemeinsame Kosten
  function renderCommon() {
    commonSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    // Kopf: Monat und „Hinzufügen“
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
    // Tabelle
    if (state.commonCosts.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Keine gemeinsamen Kosten eingetragen.';
      card.appendChild(empty);
    } else {
      const table = document.createElement('table');
      table.className = 'list-table';
      const thead = document.createElement('thead');
      // Spaltenüberschriften inklusive „Bezahlt?“
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
        const isDueNow = isDue(c, currentMonth);
        const monthlyShare = getCommonMonthlyShare(c);
        tr.innerHTML = `
          <td>${c.name}</td>
          <td>${c.amount.toFixed(2)} €</td>
          <td>${c.interval}</td>
          <td>${c.startMonth}</td>
          <td>${monthlyShare.toFixed(2)} €</td>
          <td>${isDueNow ? 'Ja' : 'Nein'}</td>
          <td></td>
          <td></td>
        `;
        // Bezahlt? Checkbox
        const paidCell = tr.children[6];
        const paidNow = c.paidMonths && c.paidMonths.includes(currentMonth);
        if (isDueNow) {
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
            saveState();
            render();
          });
          paidCell.appendChild(cb);
        } else {
          paidCell.textContent = '-';
        }
        // Bearbeiten‑Knopf
        const editBtn = document.createElement('button');
        editBtn.textContent = '✎';
        editBtn.className = 'primary';
        editBtn.addEventListener('click', () => {
          // Wechsle die Zeile in den Bearbeitungsmodus. Dabei werden die ersten vier Spalten
          // (Name, Betrag, Intervall, Start) als Eingabefelder angezeigt. Das Monatsanteil-
          // und Fällig-Feld bleiben unverändert bis zum Speichern; nach dem Speichern
          // wird die gesamte Ansicht neu gerendert.
          // Verhindere mehrfaches Bearbeiten einer bereits editierten Zeile
          if (tr.dataset.editing === 'true') return;
          tr.dataset.editing = 'true';
          // Speichere die aktuelle Zellstruktur, damit ein Abbruch möglich ist
          const originalCells = [...tr.children].map((td) => td.innerHTML);
          tr.dataset.originalCells = JSON.stringify(originalCells);
          // Leere die Zeile
          tr.innerHTML = '';
          // Name
          const nameTd = document.createElement('td');
          const nameInput = document.createElement('input');
          nameInput.type = 'text';
          nameInput.value = c.name;
          nameTd.appendChild(nameInput);
          // Betrag
          const amountTd = document.createElement('td');
          const amountInput = document.createElement('input');
          amountInput.type = 'number';
          amountInput.step = '0.01';
          amountInput.value = c.amount;
          amountTd.appendChild(amountInput);
          // Intervall
          const intervalTd = document.createElement('td');
          const intervalInput = document.createElement('input');
          intervalInput.type = 'number';
          intervalInput.step = '1';
          intervalInput.min = '1';
          intervalInput.value = c.interval;
          intervalTd.appendChild(intervalInput);
          // Startmonat
          const startTd = document.createElement('td');
          const startInput = document.createElement('input');
          // Verwende type="month" für eine komfortable Eingabe, falls unterstützt
          startInput.type = 'month';
          startInput.value = c.startMonth;
          startTd.appendChild(startInput);
          // Monatsanteil (nur Anzeige im Edit-Modus)
          const shareTd = document.createElement('td');
          shareTd.textContent = (getCommonMonthlyShare(c)).toFixed(2) + ' €';
          // Fällig (nur Anzeige)
          const dueTd = document.createElement('td');
          const dueNow = isDue(c, currentMonth);
          dueTd.textContent = dueNow ? 'Ja' : 'Nein';
          // Bezahlt? (nur Anzeige oder Checkbox im Edit-Modus)
          const paidTd = document.createElement('td');
          if (dueNow) {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = c.paidMonths && c.paidMonths.includes(currentMonth);
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
          // Aktion: Speichern und Abbrechen
          const actionTd = document.createElement('td');
          const saveBtn = document.createElement('button');
          saveBtn.textContent = '✔';
          saveBtn.className = 'primary';
          saveBtn.addEventListener('click', () => {
            // Validierung und Speichern der Werte
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
            if (!newStart || !/\d{4}-\d{2}/.test(newStart)) {
              alert('Startmonat muss im Format JJJJ-MM vorliegen.');
              return;
            }
            // Werte übernehmen
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
            // Wiederherstellen der ursprünglichen Zellen
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
          // Neue Zellen zur Zeile hinzufügen
          tr.appendChild(nameTd);
          tr.appendChild(amountTd);
          tr.appendChild(intervalTd);
          tr.appendChild(startTd);
          tr.appendChild(shareTd);
          tr.appendChild(dueTd);
          tr.appendChild(paidTd);
          tr.appendChild(actionTd);
        });
        // Löschen‑Knopf
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
        tr.lastElementChild.appendChild(editBtn);
        tr.lastElementChild.appendChild(delBtn);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      card.appendChild(table);
    }
    // Nach der Tabelle: Gesamt- und Aufschlüsselung anzeigen, falls gemeinsame Kosten vorhanden
    if (state.commonCosts.length > 0) {
      // Gesamtsumme der monatlichen Anteile der gemeinsamen Kosten
      let totalMonthly = 0;
      state.commonCosts.forEach((c) => {
        totalMonthly += getCommonMonthlyShare(c);
      });
      // Gesamtnetto berechnen und Anteile ermitteln. Wir
      // erstellen zunächst eine Liste mit Einkommen pro
      // Person und übergeben diese an computeRoundedCommonShares.
      const personsList = state.persons.map((p) => {
        const income = getPersonNet(p, currentMonth);
        return { person: p, income };
      });
      const shareMapping = computeRoundedCommonShares(totalMonthly, personsList);
      // Erstelle Zusammenfassungskarte
      const summaryCard = document.createElement('div');
      summaryCard.className = 'card';
      const title = document.createElement('h3');
      title.textContent = 'Summe & Aufschlüsselung gemeinsamer Kosten';
      summaryCard.appendChild(title);
      const sumPara = document.createElement('p');
      // Die Gesamtsumme ergibt sich aus der Summe der gerundeten Anteile, damit
      // Person 1 + Person 2 exakt den Gesamtbetrag ergibt. Berechne sie
      // anhand der shareMapping. Wenn shareMapping leer ist, verwende
      // die ungerundete Gesamtsumme.
      const totalRoundedSum = Object.values(shareMapping).reduce((sum, val) => sum + val, 0);
      const displayTotal = totalRoundedSum > 0 ? totalRoundedSum : totalMonthly;
      sumPara.innerHTML = `<strong>Monatliche Gesamtsumme:</strong> ${displayTotal.toFixed(2)} €`;
      summaryCard.appendChild(sumPara);

      // Zeige an, welche gemeinsamen Kosten im aktuellen Monat bereits bezahlt
      // wurden und wie viel noch offen ist. Wir addieren die vollen Beträge
      // der Posten, die in diesem Monat fällig sind.
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
        const paidPara = document.createElement('p');
        paidPara.innerHTML = `<strong>Bereits bezahlt:</strong> ${paidSum.toFixed(2)} € (offen: ${(dueSum - paidSum).toFixed(2)} €)`;
        summaryCard.appendChild(paidPara);
      }
      const distTable = document.createElement('table');
      distTable.className = 'list-table';
      const distHead = document.createElement('thead');
      distHead.innerHTML = '<tr><th>Person</th><th>Beitrag</th></tr>';
      distTable.appendChild(distHead);
      const distBody = document.createElement('tbody');
      state.persons.forEach((person) => {
        const row = document.createElement('tr');
        const shareValue = shareMapping[person.id] !== undefined ? shareMapping[person.id] : 0;
        row.innerHTML = `<td>${person.name}</td><td>${shareValue.toFixed(2)} €</td>`;
        distBody.appendChild(row);
      });
      distTable.appendChild(distBody);
      summaryCard.appendChild(distTable);
      card.appendChild(summaryCard);
    }
    commonSection.appendChild(card);
  }
  // Editor für gemeinsamen Kostenposten
  function showCommonEditor(editCost) {
    const name = prompt('Name des Postens:', editCost ? editCost.name : '');
    if (name == null) return;
    // Betrag kann leer bleiben: dann wird der bestehende Wert übernommen
    const amountStr = prompt('Betrag (in €):', editCost ? editCost.amount : '');
    let amount;
    if (editCost && (amountStr === '' || amountStr === null)) {
      amount = editCost.amount;
    } else {
      amount = parseFloat(amountStr);
      if (isNaN(amount)) return;
    }
    // Intervall kann leer bleiben: dann bleibt der alte Intervall bestehen
    const intervalStr = prompt('Zahlungsintervall (in Monaten):', editCost ? editCost.interval : '1');
    let interval;
    if (editCost && (intervalStr === '' || intervalStr === null)) {
      interval = editCost.interval;
    } else {
      interval = parseInt(intervalStr, 10);
      if (!interval || interval < 1) return;
    }
    // Startmonat kann leer bleiben: dann bleibt der alte Startmonat bestehen
    const startMonthStr = prompt('Startmonat (JJJJ-MM):', editCost ? editCost.startMonth : currentMonth);
    const startMonth = editCost && (startMonthStr === '' || startMonthStr === null) ? editCost.startMonth : startMonthStr;
    if (!startMonth || !/\d{4}-\d{2}/.test(startMonth)) return;
    if (editCost) {
      editCost.name = name;
      editCost.amount = amount;
      editCost.interval = interval;
      editCost.startMonth = startMonth;
    } else {
      // Füge paidMonths als leeres Array hinzu, damit für jeden gemeinsamen
      // Posten festgehalten werden kann, in welchen Monaten er bereits bezahlt wurde
      state.commonCosts.push({
        id: generateId(),
        name,
        amount,
        interval,
        startMonth,
        paidMonths: []
      });
    }
    saveState();
    render();
  }
  // Persönliche Ausgaben
  function renderPersonal() {
    personalSection.innerHTML = '';
    // Füge eine Kopfzeile mit Monatsauswahl hinzu. So kann der Benutzer den
    // Monat innerhalb des Bereichs "Persönliche Ausgaben" wechseln, ähnlich wie
    // in den anderen Abschnitten. Die Auswahl aktualisiert die globale
    // currentMonth-Variable und rendert die Ansicht neu.
    const headerRow = document.createElement('div');
    headerRow.className = 'row';
    const monthSelect = createMonthSelect();
    monthSelect.addEventListener('change', (e) => {
      currentMonth = e.target.value;
      updateMonthListIfNeeded();
      render();
    });
    headerRow.appendChild(monthSelect);
    personalSection.appendChild(headerRow);
    // Für jede Person eine eigene Karte mit den persönlichen Ausgaben
    state.persons.forEach((person) => {
      const card = document.createElement('div');
      card.className = 'card';
      const header = document.createElement('div');
      header.className = 'row';
      const title = document.createElement('h2');
      title.textContent = person.name;
      title.style.flex = '1 1 auto';
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Neuer Posten';
      addBtn.className = 'primary';
      addBtn.addEventListener('click', () => {
        showPersonalEditor(person.id);
      });
      header.appendChild(title);
      header.appendChild(addBtn);
      card.appendChild(header);
      // Filtere die Posten für diese Person
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
          <th>Name</th>
          <th>Betrag</th>
          <th>Intervall</th>
          <th>Start</th>
          <th>Fällig</th>
          <th>Bezahlt?</th>
          <th>Aktion</th>
        </tr>`;
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        posts.forEach((pc) => {
          // Stelle sicher, dass paidMonths vorhanden ist, um Fehler zu vermeiden
          if (!pc.paidMonths) pc.paidMonths = [];
          const tr = document.createElement('tr');
          const dueNow = isDue(pc, currentMonth);
          const paid = pc.paidMonths && pc.paidMonths.includes(currentMonth);
          tr.innerHTML = `
            <td>${pc.name}</td>
            <td>${pc.amount.toFixed(2)} €</td>
            <td>${pc.interval}</td>
            <td>${pc.startMonth}</td>
            <td>${dueNow ? 'Ja' : 'Nein'}</td>
            <td></td>
            <td></td>
          `;
          // Checkbox "Bezahlt?" für fällige Posten
          const cellCheck = tr.children[5];
          if (dueNow) {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = paid;
            cb.addEventListener('change', () => {
              if (!pc.paidMonths) pc.paidMonths = [];
              if (cb.checked) {
                if (!pc.paidMonths.includes(currentMonth)) pc.paidMonths.push(currentMonth);
              } else {
                pc.paidMonths = pc.paidMonths.filter((m) => m !== currentMonth);
              }
              saveState();
              render();
            });
            cellCheck.appendChild(cb);
          } else {
            cellCheck.textContent = '-';
          }
          // Aktionen: Bearbeiten und Löschen
          const actionCell = tr.children[6];
          // Bearbeiten-Button
          const editBtn = document.createElement('button');
          editBtn.textContent = '✎';
          editBtn.className = 'primary';
          editBtn.addEventListener('click', () => {
            // Nicht erneut bearbeiten, falls schon im Edit-Modus
            if (tr.dataset.editing === 'true') return;
            tr.dataset.editing = 'true';
            // Originalzellen speichern
            const originalCells = [...tr.children].map((td) => td.innerHTML);
            tr.dataset.originalCells = JSON.stringify(originalCells);
            // Zeile leeren und Eingabefelder einfügen
            tr.innerHTML = '';
            // Name
            const nameTd = document.createElement('td');
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = pc.name;
            nameTd.appendChild(nameInput);
            // Betrag
            const amountTd = document.createElement('td');
            const amountInput = document.createElement('input');
            amountInput.type = 'number';
            amountInput.step = '0.01';
            amountInput.value = pc.amount;
            amountTd.appendChild(amountInput);
            // Intervall
            const intervalTd = document.createElement('td');
            const intervalInput = document.createElement('input');
            intervalInput.type = 'number';
            intervalInput.step = '1';
            intervalInput.min = '1';
            intervalInput.value = pc.interval;
            intervalTd.appendChild(intervalInput);
            // Startmonat
            const startTd = document.createElement('td');
            const startInput = document.createElement('input');
            startInput.type = 'month';
            startInput.value = pc.startMonth;
            startTd.appendChild(startInput);
            // Fälligkeitsanzeige
            const dueTd = document.createElement('td');
            dueTd.textContent = isDue(pc, currentMonth) ? 'Ja' : 'Nein';
            // Bezahlt? Checkbox
            const paidTd = document.createElement('td');
            const cbEdit = document.createElement('input');
            cbEdit.type = 'checkbox';
            cbEdit.checked = pc.paidMonths && pc.paidMonths.includes(currentMonth);
            cbEdit.addEventListener('change', () => {
              if (!pc.paidMonths) pc.paidMonths = [];
              if (cbEdit.checked) {
                if (!pc.paidMonths.includes(currentMonth)) pc.paidMonths.push(currentMonth);
              } else {
                pc.paidMonths = pc.paidMonths.filter((m) => m !== currentMonth);
              }
            });
            paidTd.appendChild(cbEdit);
            // Aktionen: Speichern und Abbrechen
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
              if (!newStart || !/\d{4}-\d{2}/.test(newStart)) {
                alert('Startmonat muss im Format JJJJ-MM vorliegen.');
                return;
              }
              // Werte übernehmen
              pc.name = newName;
              pc.amount = newAmount;
              pc.interval = newInterval;
              pc.startMonth = newStart;
              // paidMonths bleiben erhalten
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
            // Zeile zusammenstellen
            tr.appendChild(nameTd);
            tr.appendChild(amountTd);
            tr.appendChild(intervalTd);
            tr.appendChild(startTd);
            tr.appendChild(dueTd);
            tr.appendChild(paidTd);
            tr.appendChild(actionTd);
          });
          // Löschen-Button
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
        // Summenzeile für persönliche Ausgaben: Was ist bereits bezahlt und was ist offen im ausgewählten Monat?
        let dueSum = 0;
        let paidSum = 0;
        posts.forEach((pc) => {
          if (isDue(pc, currentMonth)) {
            dueSum += pc.amount;
            if (pc.paidMonths && pc.paidMonths.includes(currentMonth)) {
              paidSum += pc.amount;
            }
          }
        });
        if (dueSum > 0) {
          const summary = document.createElement('p');
          summary.innerHTML = `<strong>Bereits bezahlt:</strong> ${paidSum.toFixed(2)} € (offen: ${(dueSum - paidSum).toFixed(2)} €)`;
          card.appendChild(summary);
        }
      }
      personalSection.appendChild(card);
    });
  }
  // Editor für persönliche Ausgaben
  function showPersonalEditor(personId, editPost) {
    const person = getPersonById(personId);
    const name = prompt(`Name des Postens für ${person.name}:`, editPost ? editPost.name : '');
    if (name == null) return;
    // Betrag bearbeiten: leer lassen übernimmt alten Wert
    const amountStr = prompt('Betrag (in €):', editPost ? editPost.amount : '');
    let amount;
    if (editPost && (amountStr === '' || amountStr === null)) {
      amount = editPost.amount;
    } else {
      amount = parseFloat(amountStr);
      if (isNaN(amount)) return;
    }
    // Intervall bearbeiten: leer lassen übernimmt alten Wert
    const intervalStr = prompt('Intervall (in Monaten):', editPost ? editPost.interval : '1');
    let interval;
    if (editPost && (intervalStr === '' || intervalStr === null)) {
      interval = editPost.interval;
    } else {
      interval = parseInt(intervalStr, 10);
      if (!interval || interval < 1) return;
    }
    // Startmonat bearbeiten: leer lassen übernimmt alten Wert
    const startStr = prompt('Startmonat (JJJJ-MM):', editPost ? editPost.startMonth : currentMonth);
    const startMonth = editPost && (startStr === '' || startStr === null) ? editPost.startMonth : startStr;
    if (!startMonth || !/\d{4}-\d{2}/.test(startMonth)) return;
    if (editPost) {
      editPost.name = name;
      editPost.amount = amount;
      editPost.interval = interval;
      editPost.startMonth = startMonth;
    } else {
      state.personalCosts.push({
        id: generateId(),
        personId,
        name,
        amount,
        interval,
        startMonth,
        paidMonths: []
      });
    }
    saveState();
    render();
  }
  // Schulden
  function renderDebts() {
    debtsSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    // Header mit Monat und Neu-Button
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
    // Tabelle
    if (state.debts.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Keine Schulden eingetragen.';
      card.appendChild(p);
    } else {
      const table = document.createElement('table');
      table.className = 'list-table';
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr>
        <th>Name</th>
        <th>Offen</th>
        <th>Monatsrate</th>
        <th>Nächste Fälligkeit</th>
        <th>Bezahlt?</th>
        <th>Aktion</th>
      </tr>`;
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      state.debts.forEach((d) => {
        const tr = document.createElement('tr');
        const dueNow = d.nextDueMonth === currentMonth;
        tr.innerHTML = `
          <td>${d.name}</td>
          <td>${d.amountOpen.toFixed(2)} €</td>
          <td>${d.monthlyRate.toFixed(2)} €</td>
          <td>${d.nextDueMonth}</td>
          <td></td>
          <td></td>
        `;
        // "Bezahlt?"-Knopf: nur anzeigen, wenn in diesem Monat fällig
        const payCell = tr.children[4];
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
        // Edit- und Löschen‑Buttons in der Aktionsspalte
        const actionCell = tr.children[5];
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
      // Füge eine Zusammenfassung hinzu: wie viel der monatlichen Raten im ausgewählten Monat noch fällig ist und wie viel bereits bezahlt wurde.
      let dueSum = 0;
      let paidSum = 0;
      state.debts.forEach((d) => {
        if (d.nextDueMonth === currentMonth) {
          // In diesem Monat fällig: addiere Monatsrate zum offenen Betrag
          dueSum += d.monthlyRate;
        } else {
          // Wenn die nächste Fälligkeit genau einen Monat nach dem aktuellen Monat liegt, wurde dieser Monat bereits bezahlt
          if (monthDiff(currentMonth, d.nextDueMonth) === 1) {
            paidSum += d.monthlyRate;
          }
        }
      });
      if (dueSum > 0 || paidSum > 0) {
        const summary = document.createElement('p');
        let openAmount = dueSum - paidSum;
        if (openAmount < 0) openAmount = 0;
        summary.innerHTML = `<strong>Bereits bezahlt:</strong> ${paidSum.toFixed(2)} € (offen: ${openAmount.toFixed(2)} €)`;
        card.appendChild(summary);
      }
    }
    debtsSection.appendChild(card);
  }
  function markDebtPaid(debt) {
    // Reduziere offenen Betrag um Monatsrate (niemals negativ)
    debt.amountOpen = Math.max(0, debt.amountOpen - debt.monthlyRate);
    // Setze nächste Fälligkeit auf Folgemonat
    debt.nextDueMonth = nextMonth(debt.nextDueMonth);
    saveState();
    render();
  }
  // Editor für Schulden
  function showDebtEditor(editDebt) {
    const name = prompt('Name der Schuld:', editDebt ? editDebt.name : '');
    if (name == null) return;
    const amountOpenStr = prompt('Offener Betrag (in €):', editDebt ? editDebt.amountOpen : '');
    const amountOpen = parseFloat(amountOpenStr);
    if (isNaN(amountOpen) || amountOpen < 0) return;
    const rateStr = prompt('Monatsrate (in €):', editDebt ? editDebt.monthlyRate : '');
    const rate = parseFloat(rateStr);
    if (isNaN(rate) || rate <= 0) return;
    const dueMonth = prompt('Nächste Fälligkeit (JJJJ-MM):', editDebt ? editDebt.nextDueMonth : currentMonth);
    if (!dueMonth || !/\d{4}-\d{2}/.test(dueMonth)) return;
    if (editDebt) {
      editDebt.name = name;
      editDebt.amountOpen = amountOpen;
      editDebt.monthlyRate = rate;
      editDebt.nextDueMonth = dueMonth;
    } else {
      state.debts.push({
        id: generateId(),
        name,
        amountOpen,
        monthlyRate: rate,
        nextDueMonth: dueMonth
      });
    }
    saveState();
    render();
  }
  // Regeln & Personen
  function renderSettings() {
    settingsSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    // Monat auswählen
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
    // Personenliste
    state.persons.forEach((p) => {
      const personCard = document.createElement('div');
      personCard.className = 'card';
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
      // Monatsbezogene Netto-Abweichung
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
      // Netto-Override zurücksetzen
      const resetBtn = document.createElement('button');
      resetBtn.textContent = 'Monats-Netto zurücksetzen';
      resetBtn.addEventListener('click', () => {
        if (p.netOverrides) delete p.netOverrides[currentMonth];
        saveState();
        render();
      });
      // Layout
      const row = document.createElement('div');
      row.className = 'row';
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

  // Sichern / Export / Import
  function renderSave() {
    saveSection.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const h2 = document.createElement('h2');
    h2.textContent = 'Sichern & Exportieren';
    card.appendChild(h2);
    // Export-Button
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
    // Import-Bereich
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
    // Hinweistext
    const p = document.createElement('p');
    p.textContent = 'Hier kannst du deine Daten als JSON-Datei exportieren oder einen zuvor exportierten Stand wieder importieren. Beim Import wird der aktuelle Stand überschrieben.';
    card.appendChild(p);
    saveSection.appendChild(card);
  }
  // Hilfselemente zum Erstellen von Monatsauswahl und Label-Input-Paaren
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
    const selectedDate = monthKeyToDate(currentMonth);
    const firstDate = monthKeyToDate(monthList[0].key);
    const lastDate = monthKeyToDate(monthList[monthList.length - 1].key);
    if (selectedDate < firstDate || selectedDate > lastDate) {
      monthList = getNext12Months(currentMonth);
    }
  }
  function createLabelInput(labelText, input) {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = labelText;
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return wrapper;
  }
  // ID-Generator
  function generateId() {
    return 'id-' + Math.random().toString(36).substr(2, 9);
  }
  // Initial render
  render();

  // Button zum vollständigen Neuladen der Seite
  const reloadBtn = document.getElementById('reloadButton');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      if (confirm('Möchtest du die App komplett neu laden? Nicht gespeicherte Änderungen gehen verloren.')) {
        // location.reload(true) wird von modernen Browsern ignoriert – wir leeren den Service‑Worker‑Cache
        // durch einfaches Neuladen. Ein harter Reload kann durch "shift+reload" im Browser erfolgen.
        location.reload();
      }
    });
  }
})();