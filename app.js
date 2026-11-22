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
    const body = el('tbody', {}, rows.map((r) => el('tr', Object.assign({ 'data-debt': String(r.debt) }, r.debt === best ? { class: 'best' } : {}), [
      el('th', { scope: 'row' }, [C.fmtDollars(r.debt) + (r.debt === best ? ' · highest price' : '')]),
      ...cols.map(([label, fn]) => el('td', { 'data-label': label }, [fn(r)])),
    ])));
    table.replaceChildren(head, body);
  }

  // Management's stake, with the two special cases CLAUDE.md asks for.
  function stakeCell(m) {
    if (m.status === 'oversold') {
      return el('td', {}, ['n/a', el('span', { class: 'flag warn' }, ['Warning: the buyback needs more shares than outside investors own, so management would have to sell.'])]);
    }
    if (m.status === 'all') {
      return el('td', {}, [C.fmtPct(1), el('span', { class: 'flag' }, ['No outside shareholders would be left.'])]);
    }
    return el('td', {}, [C.fmtPct(m.stake)]);
  }

  // The side-by-side panel under the CDSS slider.
  function renderCompare(table, r) {
    const a = r.caseMethod;
    const b = r.newPrice;
    const line = (label, fa, fb) => el('tr', {}, [
      el('th', { scope: 'row' }, [label]),
      typeof fa === 'string' ? el('td', {}, [fa]) : fa,
      typeof fb === 'string' ? el('td', {}, [fb]) : fb,
    ]);
    table.replaceChildren(
      el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col' }, ['']),
        el('th', { scope: 'col' }, ['$20 buyback (case)']),
        el('th', { scope: 'col' }, ['New-price buyback']),
      ])]),
      el('tbody', {}, [
        line('Share price', C.fmtCents(a.price), C.fmtCents(b.price)),
        line('Shares repurchased', C.fmtNum(a.repurchased, 2), C.fmtNum(b.repurchased, 2)),
        line('Shares remaining', C.fmtNum(a.remaining, 2), C.fmtNum(b.remaining, 2)),
        line('EPS', C.fmtCents(a.eps), C.fmtCents(b.eps)),
        line('Dividends per share', C.fmtCents(a.dps), C.fmtCents(b.dps)),
        line('TIE', C.fmtMult(r.tie), C.fmtMult(r.tie)),
        line('WACC', C.fmtPct(a.wacc) + ' (book weights)', C.fmtPct(b.wacc) + ' (market weights)'),
        line("Management's share", stakeCell(a.management), stakeCell(b.management)),
      ]),
    );
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
      document.getElementById('firms-note').textContent =
        'Both firms have ' + C.fmtDollars(ex.totalAssets) + ' of assets and a ' + C.fmtPct(T) +
        ' tax rate. Firm L has ' + C.fmtDollars(ex.firmLDebt) + ' of debt at ' + C.fmtPct(ex.interestRate) +
        '. Each column is one kind of year, with its probability.';
      renderStatement(document.getElementById('firm-u'), u);

      // Firm L slider: 0 to slider_max in steps of slider_step, rate held at 12%.
      const lSlider = document.getElementById('firm-l-debt');
      lSlider.max = String(ex.sliderMax);
      lSlider.step = String(ex.sliderStep);
      lSlider.value = String(ex.firmLDebt);
      document.getElementById('firm-l-rate-note').textContent =
        'The interest rate is held at ' + C.fmtPct(ex.interestRate) +
        ' at every amount, so the slider shows what debt does to Firm L\'s return and risk, not how lenders would respond. ' +
        'Case sets it back to the case\'s ' + C.fmtDollars(ex.firmLDebt) + '.';
      const showFirmL = () => {
        const debt = Number(lSlider.value);
        const l = C.exampleFirm(ex.totalAssets, debt, ex.interestRate, T, scenarios);
        document.getElementById('firm-l-debt-out').textContent = C.fmtDollars(debt);
        lSlider.setAttribute('aria-valuetext', C.fmtDollars(debt));
        document.getElementById('firm-l-title').textContent = 'Firm L (' + C.fmtDollars(debt) + ' of debt)';
        renderStatement(document.getElementById('firm-l'), l);
        renderFirmStats(document.getElementById('firm-stats'), u, l);
      };
      lSlider.addEventListener('input', showFirmL);
      document.getElementById('btn-case').addEventListener('click', () => {
        lSlider.value = String(ex.firmLDebt);
        showFirmL();
      });
      showFirmL();

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

      // CDSS slider: one stop per row of the banker's schedule, nothing in between.
      const slider = document.getElementById('cdss-debt');
      const pickNote = document.getElementById('pick-note');
      slider.max = String(rows.length - 1);
      const showCdss = () => {
        const r = rows[Number(slider.value)];
        document.getElementById('cdss-debt-out').textContent = C.fmtDollars(r.debt);
        slider.setAttribute('aria-valuetext', C.fmtDollars(r.debt));
        document.getElementById('cdss-rates').textContent =
          'Banker\'s rates here: r_d = ' + (r.rd === null ? 'n/a (no debt)' : C.fmtPct(r.rd)) + ', r_s = ' + C.fmtPct(r.rs) + '.';
        renderCompare(document.getElementById('cdss-compare'), r);
        document.querySelectorAll('.results tr[data-debt]').forEach((tr) => {
          tr.classList.toggle('selected', Number(tr.dataset.debt) === r.debt);
        });
      };
      const goTo = (what) => {
        const t = C.buttonTarget(rows, what);
        slider.value = String(rows.findIndex((r) => r.debt === t.debt));
        const name = what === 'eps' ? 'Highest EPS' : 'Highest share price';
        pickNote.textContent = t.agree
          ? name + ': ' + C.fmtDollars(t.debt) + ' under both buyback methods.'
          : name + ': ' + C.fmtDollars(t.caseDebt) + ' with the $20 buyback, but ' + C.fmtDollars(t.newDebt) +
            ' with the new-price buyback. The slider shows the case method\'s amount.';
        showCdss();
      };
      slider.addEventListener('input', () => { pickNote.textContent = ''; showCdss(); });
      document.getElementById('btn-best').addEventListener('click', () => goTo('price'));
      document.getElementById('btn-eps').addEventListener('click', () => goTo('eps'));
      showCdss();

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

  // Register the service worker so the app installs and works offline.
  // Relative path, so it works at https://<username>.github.io/<repository>/.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* the app still works without it */ });
    });
  }
})();
