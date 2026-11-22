// capstruct.js: the finance math for the AGE capital structure app.
// Plain functions only. Nothing here touches the page, so every function
// can be checked with Node, for example:
//   node -e "const c=require('./capstruct.js'); console.log(c.round(14.025,2))"
(function (root) {
  'use strict';

  // ---------- Reading CSV text ----------

  // Turns CSV text into an array of objects keyed by the header row.
  // Handles quoted fields, so a note column can contain commas.
  function parseCSV(text) {
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    const s = String(text).replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    if (rows.length === 0) return [];
    const header = rows[0].map((h) => h.trim());
    return rows.slice(1).map((r) => {
      const obj = {};
      header.forEach((h, j) => { obj[h] = (r[j] === undefined ? '' : r[j]).trim(); });
      return obj;
    });
  }

  // Reads a number from a CSV cell. A blank cell gives null.
  function num(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const x = Number(String(v).replace(/[$,%\s]/g, ''));
    if (!Number.isFinite(x)) throw new Error('Not a number: "' + v + '"');
    return x;
  }

  // ---------- Turning parsed CSV rows into inputs ----------

  // data/cdss.csv has columns section,item,value.
  function cdssInputs(rows) {
    const get = (item) => {
      const r = rows.find((x) => x.item === item);
      if (!r) throw new Error('cdss.csv is missing "' + item + '"');
      return num(r.value);
    };
    return {
      sales: get('sales'),
      variableCostRate: get('variable_cost_rate'),
      fixedCosts: get('fixed_costs'),
      totalAssets: get('total_assets'),
      currentDebt: get('debt'),
      shares: get('shares_outstanding'),
      price: get('share_price'),
      managementShare: get('management_share'),
    };
  }

  // data/assumptions.csv has columns assumption,value,note.
  function assumptionInputs(rows) {
    const r = rows.find((x) => x.assumption === 'tax_rate');
    if (!r) throw new Error('assumptions.csv is missing "tax_rate"');
    return { taxRate: num(r.value) };
  }

  // data/banker_schedule.csv has columns debt,cost_of_debt,cost_of_equity.
  // The $0 row has no cost of debt. Every other row must have one.
  function scheduleInputs(rows) {
    const sched = rows.map((r) => ({
      debt: num(r.debt),
      rd: num(r.cost_of_debt),
      rs: num(r.cost_of_equity),
    }));
    if (sched.length === 0) throw new Error('The banker schedule has no rows.');
    sched.forEach((r) => {
      if (r.debt === null || r.debt < 0) throw new Error('Each row of the banker schedule needs a debt amount of 0 or more.');
      if (r.rs === null || r.rs <= 0) throw new Error('The row for $' + r.debt + ' has no cost of equity.');
      if (r.debt > 0 && r.rd === null) throw new Error('The row for $' + r.debt + ' has no cost of debt.');
    });
    sched.sort((a, b) => a.debt - b.debt);
    if (sched[0].debt !== 0) throw new Error('The banker schedule must start with a $0 row.');
    return sched;
  }

  // data/example_firms.csv has columns item,value,note.
  function exampleInputs(rows) {
    const get = (item) => {
      const r = rows.find((x) => x.item === item);
      if (!r) throw new Error('example_firms.csv is missing "' + item + '"');
      return num(r.value);
    };
    return {
      totalAssets: get('total_assets'),
      firmLDebt: get('firm_l_debt'),
      interestRate: get('interest_rate'),
      sliderMax: get('slider_max'),
      sliderStep: get('slider_step'),
    };
  }

  // data/ebit_scenarios.csv has columns probability,sales,operating_costs.
  function scenarioInputs(rows) {
    const sc = rows.map((r) => ({
      probability: num(r.probability),
      sales: num(r.sales),
      operatingCosts: num(r.operating_costs),
    }));
    const total = sc.reduce((s, r) => s + r.probability, 0);
    if (Math.abs(total - 1) > 1e-9) throw new Error('The EBIT probabilities add up to ' + total + ', not 1.');
    return sc;
  }

  // ---------- Statistics ----------

  // Expected value: the probability-weighted average.
  function expected(values, probs) {
    return values.reduce((s, v, i) => s + probs[i] * v, 0);
  }

  // Standard deviation: square root of the probability-weighted squared deviations.
  function stdDev(values, probs) {
    const m = expected(values, probs);
    return Math.sqrt(values.reduce((s, v, i) => s + probs[i] * (v - m) * (v - m), 0));
  }

  // ---------- Firm U and Firm L (question c) ----------

  // One firm's partial income statements and ratios.
  // debt = 0 gives Firm U. TIE is null when there is no interest.
  function exampleFirm(totalAssets, debt, interestRate, taxRate, scenarios) {
    const equity = totalAssets - debt;
    const interest = interestRate * debt;
    const years = scenarios.map((s) => {
      const ebit = s.sales - s.operatingCosts;
      const ebt = ebit - interest;
      const taxes = taxRate * ebt;
      const netIncome = ebt - taxes;
      return {
        probability: s.probability,
        sales: s.sales,
        operatingCosts: s.operatingCosts,
        ebit, interest, ebt, taxes, netIncome,
        roe: netIncome / equity,
        tie: interest > 0 ? ebit / interest : null,
      };
    });
    const p = years.map((y) => y.probability);
    const roe = years.map((y) => y.roe);
    const eRoe = expected(roe, p);
    const sdRoe = stdDev(roe, p);
    let eTie = null, sdTie = null, cvTie = null;
    if (interest > 0) {
      const tie = years.map((y) => y.tie);
      eTie = expected(tie, p);
      sdTie = stdDev(tie, p);
      cvTie = sdTie / eTie;
    }
    return {
      assets: totalAssets, debt, equity, interestRate, years,
      eRoe, sdRoe, cvRoe: sdRoe / eRoe,
      eTie, sdTie, cvTie,
    };
  }

  // ---------- CDSS at each amount of borrowing (question d) ----------

  // EBIT = sales × (1 − variable cost rate) − fixed costs. Constant at every debt level.
  function cdssEbit(c) {
    return c.sales * (1 - c.variableCostRate) - c.fixedCosts;
  }

  // Management's stake after the buyback (management doesn't sell).
  // Returns { stake, status } where status is 'ok', 'all' (no outsiders left)
  // or 'oversold' (the buyback needs more shares than outsiders own).
  function managementStake(c, repurchased, remaining) {
    const outside = (1 - c.managementShare) * c.shares;
    const tol = 1e-9 * c.shares;
    if (repurchased > outside + tol) return { stake: null, status: 'oversold' };
    if (Math.abs(repurchased - outside) <= tol) return { stake: 1, status: 'all' };
    return { stake: (c.managementShare * c.shares) / remaining, status: 'ok' };
  }

  // One row of results for one amount of borrowing in the banker's schedule.
  function cdssRow(c, taxRate, row) {
    const D = row.debt;
    const rd = row.rd === null ? 0 : row.rd;
    const rs = row.rs;
    const n = c.shares;
    const A = c.totalAssets;
    const T = taxRate;

    const ebit = cdssEbit(c);
    const interest = rd * D;
    const netIncome = (ebit - interest) * (1 - T);
    const tie = interest > 0 ? ebit / interest : null;

    // Case method (d(3) and d(4)): buy back at today's price P0.
    const cRepurchased = D / c.price;
    const cRemaining = n - cRepurchased;
    const cEps = netIncome / cRemaining;
    const cPrice = cEps / rs;
    const waccBook = (D / A) * rd * (1 - T) + ((A - D) / A) * rs;

    // New-price method: buy back at the price after the announcement.
    const S = netIncome / rs;
    const V = S + D;
    const nPrice = V / n;
    const nRepurchased = D / nPrice;
    const nRemaining = n - nRepurchased;
    const nEps = netIncome / nRemaining;
    const waccMarket = (D / V) * rd * (1 - T) + (S / V) * rs;

    return {
      debt: D, rd: row.rd, rs, ebit, interest, netIncome, tie,
      caseMethod: {
        repurchased: cRepurchased, remaining: cRemaining,
        eps: cEps, dps: cEps, price: cPrice, wacc: waccBook,
        management: managementStake(c, cRepurchased, cRemaining),
      },
      newPrice: {
        equityValue: S, firmValue: V,
        repurchased: nRepurchased, remaining: nRemaining,
        eps: nEps, dps: nEps, price: nPrice, wacc: waccMarket,
        management: managementStake(c, nRepurchased, nRemaining),
        // Checks: EPS = r_s × P, and market WACC = EBIT(1 − T) / V.
        epsCheck: rs * nPrice,
        waccCheck: (ebit * (1 - T)) / V,
      },
    };
  }

  function cdssTable(c, taxRate, schedule) {
    return schedule.map((r) => cdssRow(c, taxRate, r));
  }

  // Index of the best row by a key. On an exact tie, the smaller debt wins
  // (rows are sorted by debt, so the first one found wins).
  function bestIndex(rows, key, wantMax) {
    let best = 0;
    for (let i = 1; i < rows.length; i++) {
      const v = key(rows[i]);
      const b = key(rows[best]);
      if (wantMax ? v > b : v < b) best = i;
    }
    return best;
  }

  function cdssSummary(rows) {
    return {
      bestCasePrice: rows[bestIndex(rows, (r) => r.caseMethod.price, true)].debt,
      bestNewPrice: rows[bestIndex(rows, (r) => r.newPrice.price, true)].debt,
      highestCaseEps: rows[bestIndex(rows, (r) => r.caseMethod.eps, true)].debt,
      highestNewEps: rows[bestIndex(rows, (r) => r.newPrice.eps, true)].debt,
      lowestBookWacc: rows[bestIndex(rows, (r) => r.caseMethod.wacc, false)].debt,
      lowestMarketWacc: rows[bestIndex(rows, (r) => r.newPrice.wacc, false)].debt,
    };
  }

  // Checks that should always pass with the case data. Each returns
  // { ok, message } so the page can show a warning instead of hiding a failure.
  function cdssChecks(c, rows) {
    const out = [];
    const zero = rows.find((r) => r.debt === 0);
    const p0 = zero.caseMethod.price;
    out.push({
      ok: Math.abs(p0 - c.price) < 0.005,
      message: 'With no debt, EPS / r_s = ' + p0.toFixed(4) + ', and cdss.csv says the share price is ' + c.price.toFixed(2) + '.',
    });
    rows.forEach((r) => {
      if (Math.abs(r.newPrice.eps - r.newPrice.epsCheck) > 1e-6) {
        out.push({ ok: false, message: 'At $' + r.debt + ', new-price EPS does not equal r_s × P.' });
      }
      if (Math.abs(r.newPrice.wacc - r.newPrice.waccCheck) > 1e-9) {
        out.push({ ok: false, message: 'At $' + r.debt + ', market-weight WACC does not equal EBIT(1 − T) / V.' });
      }
    });
    return out;
  }

  // ---------- Rounding and display ----------

  // Rounds half up on the decimal value. toFixed rounds the binary value, so
  // toFixed(2) shows 14.025 as 14.02; this shows 14.03.
  function round(x, d) {
    const f = Math.pow(10, d);
    return Math.round(Number((x * f).toPrecision(12))) / f;
  }

  function withCommas(x, d) {
    return round(x, d).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  // Dollars to the nearest dollar. Negative amounts show in parentheses.
  function fmtDollars(x) {
    if (x === null || x === undefined) return 'n/a';
    const r = round(Math.abs(x), 0);
    const s = '$' + withCommas(r, 0);
    return x < 0 && r !== 0 ? '(' + s + ')' : s;
  }
  // Costs shown in parentheses, the way the case prints them.
  function fmtCost(x) {
    if (x === null || x === undefined) return 'n/a';
    return '(' + withCommas(Math.abs(x), 0) + ')';
  }
  function fmtCents(x) { return x === null || x === undefined ? 'n/a' : '$' + withCommas(x, 2); }
  function fmtPct(x) { return x === null || x === undefined ? 'n/a' : withCommas(x * 100, 2) + '%'; }
  function fmtMult(x) { return x === null || x === undefined ? 'n/a' : withCommas(x, 2) + '×'; }
  function fmtNum(x, d) { return x === null || x === undefined ? 'n/a' : withCommas(x, d); }

  const api = {
    parseCSV, num,
    cdssInputs, assumptionInputs, scheduleInputs, exampleInputs, scenarioInputs,
    expected, stdDev, exampleFirm,
    cdssEbit, managementStake, cdssRow, cdssTable, cdssSummary, cdssChecks,
    round, fmtDollars, fmtCost, fmtCents, fmtPct, fmtMult, fmtNum,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CapStruct = api;
})(typeof window !== 'undefined' ? window : this);
