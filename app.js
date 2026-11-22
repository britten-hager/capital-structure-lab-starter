// app.js: loads the case files from data/ and draws the page.
// All the finance math lives in capstruct.js.
(function () {
  'use strict';
  const C = window.CapStruct;

  const FILES = {
    cdss: 'data/cdss.csv',
    assumptions: 'data/assumptions.csv',
    schedule: 'data/banker_schedule.csv',
    firms: 'data/example_firms.csv',
    scenarios: 'data/ebit_scenarios.csv',
  };

  // ---------- Small page helpers ----------

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach((ch) => node.append(ch));
    return node;
  }

  function showWarning(text) {
    document.getElementById('warnings').append(el('p', { class: 'warning', role: 'alert' }, [text]));
  }

  async function loadCSV(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load ' + path + ' (' + res.status + ').');
    return C.parseCSV(await res.text());
  }

  // ---------- Firm U and Firm L ----------

  // A statement table: one label column, one column per kind of year.
  function renderStatement(table, firm) {
    const head = el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col' }, ['']),
      ...firm.years.map((y) => el('th', { scope: 'col' }, ['p = ' + C.fmtNum(y.probability, 2)])),
    ])]);
    const line = (label, fn, cls) => el('tr', cls ? { class: cls } : {}, [
      el('th', { scope: 'row' }, [label]),
      ...firm.years.map((y) => el('td', {}, [fn(y)])),
    ]);
    const body = el('tbody', {}, [
      line('Assets', () => C.fmtDollars(firm.assets)),
      line('Equity', () => C.fmtDollars(firm.equity)),
      line('Sales', (y) => C.fmtDollars(y.sales)),
      line('Oper. costs', (y) => C.fmtCost(y.operatingCosts)),
      line('EBIT', (y) => C.fmtDollars(y.ebit), 'total'),
      line('Interest', (y) => C.fmtCost(y.interest)),
      line('EBT', (y) => C.fmtDollars(y.ebt)),
      line('Taxes', (y) => C.fmtCost(y.taxes)),
      line('Net income', (y) => C.fmtDollars(y.netIncome), 'total'),
      line('ROE', (y) => C.fmtPct(y.roe)),
      line('TIE', (y) => C.fmtMult(y.tie)),
    ]);
    table.replaceChildren(head, body);
  }

  function renderFirmStats(table, u, l) {
    const head = el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col' }, ['']),
      el('th', { scope: 'col' }, ['Firm U']),
      el('th', { scope: 'col' }, ['Firm L']),
    ])]);
    const line = (label, fn) => el('tr', {}, [
      el('th', { scope: 'row' }, [label]), el('td', {}, [fn(u)]), el('td', {}, [fn(l)]),
    ]);
    table.replaceChildren(head, el('tbody', {}, [
      line('E(ROE)', (f) => C.fmtPct(f.eRoe)),
      line('σ(ROE)', (f) => C.fmtPct(f.sdRoe)),
      line('CV of ROE', (f) => C.fmtNum(f.cvRoe, 2)),
      line('E(TIE)', (f) => C.fmtMult(f.eTie)),
      line('σ(TIE)', (f) => C.fmtMult(f.sdTie)),
      line('CV of TIE', (f) => C.fmtNum(f.cvTie, 2)),
    ]));
  }

  // ---------- CDSS ----------

  // One row per amount of borrowing. Each cell carries a data-label so the
  // row can turn into a card on a phone.
  function renderResults(table, rows, method, waccLabel, best) {
    const cols = [
      ['Shares repurchased', (r) => C.fmtNum(r[method].repurchased, 2)],
      ['Shares remaining', (r) => C.fmtNum(r[method].remaining, 2)],
      ['Net income', (r) => C.fmtDollars(r.netIncome)],
      ['EPS', (r) => C.fmtCents(r[method].eps)],
      ['TIE', (r) => C.fmtMult(r.tie)],
      ['r_s', (r) => C.fmtPct(r.rs)],
      ['Share price', (r) => C.fmtCents(r[method].price)],
      [waccLabel, (r) => C.fmtPct(r[method].wacc)],
    ];
    const head = el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col' }, ['Debt']),
      ...cols.map(([label]) => el('th', { scope: 'col' }, [label])),
    ])]);
    const body = el('tbody', {}, rows.map((r) => el('tr', r.debt === best ? { class: 'best' } : {}, [
      el('th', { scope: 'row' }, [C.fmtDollars(r.debt) + (r.debt === best ? ' · highest price' : '')]),
      ...cols.map(([label, fn]) => el('td', { 'data-label': label }, [fn(r)])),
    ])));
    table.replaceChildren(head, body);
  }

  function renderSummary(list, s) {
    const d = C.fmtDollars;
    const items = [
      'Highest share price: ' + d(s.bestCasePrice) + ' with the case method, ' + d(s.bestNewPrice) + ' with the new-price method.',
      'Lowest WACC: ' + d(s.lowestBookWacc) + ' with book weights, ' + d(s.lowestMarketWacc) + ' with market weights.',
      'Highest EPS: ' + d(s.highestCaseEps) + ' with the case method, ' + d(s.highestNewEps) + ' with the new-price method.',
    ];
    const picks = [s.bestCasePrice, s.bestNewPrice, s.lowestBookWacc, s.lowestMarketWacc];
    if (picks.every((p) => p === picks[0])) {
      items.push('Both price methods and both sets of WACC weights point to the same amount of debt: ' + d(picks[0]) + '.');
    } else {
      items.push('These do not all agree, so the page does not pick one. Compare the tables above.');
    }
    list.replaceChildren(...items.map((t) => el('li', {}, [t])));
  }

  // ---------- Start ----------

  async function start() {
    const status = document.getElementById('status');
    try {
      const [cdssRows, assumpRows, schedRows, firmRows, scenRows] = await Promise.all([
        loadCSV(FILES.cdss), loadCSV(FILES.assumptions), loadCSV(FILES.schedule),
        loadCSV(FILES.firms), loadCSV(FILES.scenarios),
      ]);
      const cdss = C.cdssInputs(cdssRows);
      const T = C.assumptionInputs(assumpRows).taxRate;
      const schedule = C.scheduleInputs(schedRows);
      const ex = C.exampleInputs(firmRows);
      const scenarios = C.scenarioInputs(scenRows);

      // Firm U and Firm L
      const u = C.exampleFirm(ex.totalAssets, 0, ex.interestRate, T, scenarios);
      const l = C.exampleFirm(ex.totalAssets, ex.firmLDebt, ex.interestRate, T, scenarios);
      document.getElementById('firms-note').textContent =
        'Both firms have ' + C.fmtDollars(ex.totalAssets) + ' of assets and a ' + C.fmtPct(T) +
        ' tax rate. Firm L has ' + C.fmtDollars(ex.firmLDebt) + ' of debt at ' + C.fmtPct(ex.interestRate) +
        '. Each column is one kind of year, with its probability.';
      document.getElementById('firm-l-title').textContent = 'Firm L (' + C.fmtDollars(ex.firmLDebt) + ' of debt)';
      renderStatement(document.getElementById('firm-u'), u);
      renderStatement(document.getElementById('firm-l'), l);
      renderFirmStats(document.getElementById('firm-stats'), u, l);

      // CDSS
      const rows = C.cdssTable(cdss, T, schedule);
      const summary = C.cdssSummary(rows);
      document.getElementById('p0').textContent = C.fmtCents(cdss.price);
      document.getElementById('cdss-note').textContent =
        'EBIT = ' + C.fmtDollars(cdss.sales) + ' × (1 − ' + C.fmtPct(cdss.variableCostRate) + ') − ' +
        C.fmtDollars(cdss.fixedCosts) + ' = ' + C.fmtDollars(C.cdssEbit(cdss)) +
        ', the same at every amount of debt. ' + C.fmtNum(cdss.shares, 0) + ' shares before the buyback, ' +
        C.fmtPct(T) + ' tax rate, ' + C.fmtDollars(cdss.totalAssets) +
        ' of total book assets. All earnings are paid out, so dividends per share = EPS and g = 0.';
      renderResults(document.getElementById('case-table'), rows, 'caseMethod', 'WACC (book weights)', summary.bestCasePrice);
      renderResults(document.getElementById('new-table'), rows, 'newPrice', 'WACC (market weights)', summary.bestNewPrice);
      renderSummary(document.getElementById('summary'), summary);

      C.cdssChecks(cdss, rows).filter((c) => !c.ok).forEach((c) => showWarning('Check failed: ' + c.message));

      document.getElementById('firms').hidden = false;
      document.getElementById('cdss').hidden = false;
      status.hidden = true;
    } catch (err) {
      status.textContent = 'The app could not load the case data. ' + err.message +
        (location.protocol === 'file:' ? ' Open it through a web address (GitHub Pages or a local server), not as a file.' : '');
      status.classList.add('warning');
    }
  }

  start();
})();
