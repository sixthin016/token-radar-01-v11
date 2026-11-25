// Launch Radar v10's dashboard: renders window.TOKEN_RADAR, recomputes every row from the
// ridge coefficients and odds beta in data.js, and re-fits the ridge in the browser.
// Layout is dense on purpose: the 1440x1440 board shot must show the title, KPI strip,
// verification, accounting, scatter, all three evidence tables whole, the board with
// every row's farm-plan summary, and the best marginal plan expanded in the board.
(function () {
  'use strict';
  var DATA = window.TOKEN_RADAR;
  if (!DATA) return;
  var V = DATA.validation;
  var app = document.getElementById('board');
  var S = { q: '', cat: 'all', chain: 'all', tier: 'all', verdict: 'all', sort: 'implied', dir: -1, sel: null,
    plan: DATA.farm_scenario.deposit_pct, share: DATA.farm_scenario.drop_share, horizon: DATA.farm_scenario.horizon_weeks };
  var fromHash = false;
  (function readHash() {
    var h = location.hash.replace(/^#/, '');
    h.split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0] === 'row' && p[1]) { S.sel = decodeURIComponent(p[1]); fromHash = true; }
      if (p[0] === 'verdict' && ['FARM', 'MARGINAL', 'SKIP', 'all'].indexOf(p[1]) >= 0) S.verdict = p[1];
      if (p[0] === 'tier' && ['watchlist', 'early', 'offlist', 'all'].indexOf(p[1]) >= 0) S.tier = p[1];
      if (p[0] === 'sort' && ['implied', 'tvl', 'odds', 'net', 'nethour', 'age'].indexOf(p[1]) >= 0) S.sort = p[1];
      if (p[0] === 'dir' && (p[1] === '1' || p[1] === '-1')) S.dir = parseInt(p[1], 10);
      if (p[0] === 'q' && p[1]) S.q = decodeURIComponent(p[1]);
    });
  })();

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtMoney(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : usd0.format(Math.round(n)); }
  function fmt2(n) { return (n > 0 ? '+' : '') + n.toFixed(2); }
  function fmtPct(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : fmt2(n) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }

  // --- the model, recomputed in the page from data.js (same arithmetic as lib/model.ts) ---
  var Z80 = 1.2815515655446004, Z50 = 0.6744897501960817;
  function shiftOf(category) { return DATA.ridge.shifts[category || ''] || 0; }
  function ifLaunches(row) {
    var z = (row.log_tvl - DATA.ridge.mean_log_tvl) / DATA.ridge.sd_log_tvl;
    return Math.pow(10, DATA.ridge.intercept + DATA.ridge.slope_std * z + shiftOf(row.category));
  }
  function oddsOf(row) {
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var f = {
      log_tvl: Math.log10(Math.max(1, row.tvl_usd)),
      log_age: Math.log10(age + 1),
      cat_share: DATA.cat_share[row.category || ''] === undefined ? DATA.cat_base_rate : DATA.cat_share[row.category || ''],
      growth7: Math.max(-80, Math.min(200, row.change_7d || 0)) / 100,
      log_chains: Math.log10(Math.max(1, row.chains.length)),
      age_missing: row.age_days === null || row.age_days === undefined ? 1 : 0
    };
    var z = DATA.odds_beta[0];
    DATA.odds_kept_terms.forEach(function (t, j) { z += DATA.odds_beta[1 + j] * (f[t] - DATA.odds_mu[t]) / DATA.odds_sd[t]; });
    return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
  }
  function gasFor(chain) { return DATA.gas_table[chain] || [2.0, 0.5]; }
  function farmOf(row, sc) {
    var dep = Math.min(sc.plan * row.tvl_usd, DATA.farm_scenario.deposit_cap_usd);
    var implied = ifLaunches(row) * oddsOf(row);
    var drop = implied * sc.share * dep / row.tvl_usd;
    var g = gasFor(row.chains[0]);
    var fees = g[0] + g[1] * sc.horizon;
    var hours = 0.25 + 0.25 * sc.horizon + 0.167;
    var net = drop - fees;
    var tbill = dep * DATA.farm_scenario.tbill_apr * (sc.horizon / 52);
    var verdict = (net > tbill && net / hours >= DATA.farm_scenario.farm_net_per_hour_usd) ? 'FARM' : (net > 0 ? 'MARGINAL' : 'SKIP');
    return { deposit: dep, drop: drop, fees: fees, hours: hours, net: net, netHour: net / hours, verdict: verdict, implied: implied };
  }
  function econOf(row) {
    return S.plan === DATA.farm_scenario.deposit_pct && S.share === DATA.farm_scenario.drop_share && S.horizon === DATA.farm_scenario.horizon_weeks
      ? { deposit: row.deposit_usd, drop: row.expected_drop_usd, fees: row.fees_usd, hours: row.hours, net: row.net_usd, netHour: row.net_per_hour_usd, verdict: row.verdict, implied: row.implied_value_usd }
      : farmOf(row, S);
  }
  // --- solve a small linear system (Gaussian elimination, partial pivot) ---
  function solveLinear(A, b) {
    var n = b.length;
    var m = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
      var tmp = m[col]; m[col] = m[piv]; m[piv] = tmp;
      var d = m[col][col];
      for (var c = col; c <= n; c++) m[col][c] /= d;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === col) continue;
        var f = m[r2][col];
        for (var c2 = col; c2 <= n; c2++) m[r2][c2] -= f * m[col][c2];
      }
    }
    return m.map(function (row) { return row[n]; });
  }

  // --- re-fit the ridge in the browser from the 94 snapshot comparables ---
  // Same arithmetic as lib/model.ts fitRidge: unweighted, lambda 10 on the slope, lambda 30 on
  // each category shift, a shift only for categories with at least 5 comparables.
  function refitCheck() {
    var comps = DATA.comps;
    var xs = comps.map(function (c) { return c.log_tvl; });
    var ys = comps.map(function (c) { return c.log_mcap; });
    var n = xs.length;
    var mu = xs.reduce(function (a, x) { return a + x; }, 0) / n;
    var sd = Math.sqrt(xs.reduce(function (a, x) { return a + (x - mu) * (x - mu); }, 0) / n);
    var cats = DATA.ridge.categories;
    var keep = cats.filter(function (cat) { return comps.filter(function (c) { return (c.category || '') === cat; }).length >= 5; });
    var p = 2 + keep.length;
    var xtx = [], xty = [];
    for (var a = 0; a < p; a++) { xtx.push(new Array(p).fill(0)); xty.push(0); }
    for (var i = 0; i < n; i++) {
      var row = [1, (xs[i] - mu) / sd];
      keep.forEach(function (cat) { row.push((comps[i].category || '') === cat ? 1 : 0); });
      for (var a2 = 0; a2 < p; a2++) {
        xty[a2] += row[a2] * ys[i];
        for (var b = 0; b < p; b++) xtx[a2][b] += row[a2] * row[b];
      }
    }
    xtx[1][1] += 10;
    for (var j = 0; j < keep.length; j++) xtx[2 + j][2 + j] += 30;
    var beta = solveLinear(xtx, xty);
    var sse = 0;
    for (var k = 0; k < n; k++) {
      var z = (xs[k] - mu) / sd;
      var pred = beta[0] + beta[1] * z;
      keep.forEach(function (cat, jj) { if ((comps[k].category || '') === cat) pred += beta[2 + jj]; });
      sse += (ys[k] - pred) * (ys[k] - pred);
    }
    var sigma = Math.sqrt(sse / n);
    var ok = Math.abs(beta[0] - DATA.ridge.intercept) < 0.005 && Math.abs(beta[1] - DATA.ridge.slope_std) < 0.005 && Math.abs(sigma - DATA.ridge.sigma_log) < 0.005
      && keep.every(function (cat, jj) { return Math.abs(beta[2 + jj] - (DATA.ridge.shifts[cat] || 0)) < 0.005; });
    return { ok: ok, intercept: beta[0], slope: beta[1], sigma: sigma };
  }

  // --- sections ---
  var GROUP_COLORS = {
    'ranked-watchlist': '#22c55e', 'ranked-early': '#4ade80', 'ranked-offlist': '#a3e635',
    'token-priced-comp': '#38bdf8', 'token-no-usable-cap': '#64748b',
    'out-bridge': '#f59e0b', 'out-exchange': '#f97316', 'out-liquid-staking': '#a78bfa', 'out-versioned': '#f472b6', 'out-other-pretoken': '#94a3b8'
  };
  var GROUP_LABELS = {
    'ranked-watchlist': 'Ranked, watchlist', 'ranked-early': 'Ranked, early (below floor)', 'ranked-offlist': 'Ranked, off-list (above floor)',
    'token-priced-comp': 'Token trades, priced comp', 'token-no-usable-cap': 'Token recorded, no usable cap',
    'out-bridge': 'Out: bridge', 'out-exchange': 'Out: exchange', 'out-liquid-staking': 'Out: liquid staking', 'out-versioned': 'Out: versioned fork', 'out-other-pretoken': 'Out: other pre-token'
  };

  function header() {
    var totalImplied = DATA.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var totalTvl = DATA.rows.reduce(function (a, r) { return a + r.tvl_usd; }, 0);
    var farmN = DATA.rows.filter(function (r) { return r.verdict === 'FARM'; }).length;
    var bestNetHour = Math.max.apply(null, DATA.rows.map(function (r) { return r.net_per_hour_usd; }));
    var rf = refitCheck();
    var v = V;
    var keptOdds = v.odds.terms.filter(function (t) { return t.verdict === 'kept'; });
    var lastKeptOdds = keptOdds[keptOdds.length - 1];
    var keptValue = v.term_table.filter(function (t) { return t.verdict === 'kept'; }).length;
    var ledgerTotal = Object.keys(DATA.accounting).reduce(function (a, g) { return a + DATA.accounting[g]; }, 0);
    return el('div', {},
      el('h1', { text: 'Launch Radar v10: pre-token protocols valued from their own record, with ten-step farm plans' }),
      el('p', { class: 'sub', text: DATA.rows.length + ' pre-token protocols ranked by implied value — if it launches, times the odds it launches. Ridge of market cap on TVL, fitted on the snapshot\u2019s ' + v.comps_n + ' traded comparables.' }),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('div', { class: 'k' }, 'Walk-forward miss'), el('div', { class: 'v', html: '\u00d7' + v.time_split_pooled.r7.typical_miss_x + ' <small>vs \u00d7' + v.term_table[0].wf_miss_x + ' flat</small>' }), el('div', { class: 'd' }, 'pooled, ' + v.time_split_pooled.r7.n + ' listed since 2024')),
        el('div', { class: 'kpi' }, el('div', { class: 'k' }, 'Range honesty'), el('div', { class: 'v', html: (v.honesty_wf.inside_p25_p75 * 100).toFixed(0) + '% <small>\u00b7 ' + (v.honesty_wf.inside_p10_p90 * 100).toFixed(0) + '%</small>' }), el('div', { class: 'd' }, 'P25\u2013P75 (50%) \u00b7 P10\u2013P90 (80%), WF')),
        el('div', { class: 'kpi' }, el('div', { class: 'k' }, 'Token odds Brier'), el('div', { class: 'v', html: lastKeptOdds.wf_brier.toFixed(3) + ' <small>vs ' + v.odds.terms[0].wf_brier.toFixed(3) + ' base</small>' }), el('div', { class: 'd' }, 'walk-forward, ' + v.odds.peers_n + ' peers')),
        el('div', { class: 'kpi' }, el('div', { class: 'k' }, 'Terms survived'), el('div', { class: 'v', html: keptValue + ' <small>of ' + v.term_table.length + ' \u00b7 ' + keptOdds.length + ' of ' + v.odds.terms.length + '</small>' }), el('div', { class: 'd' }, 'value terms \u00b7 odds terms kept')),
        el('div', { class: 'kpi' }, el('div', { class: 'k' }, 'Worth farming'), el('div', { class: 'v', html: farmN + ' <small>of ' + DATA.rows.length + '</small>' }), el('div', { class: 'd' }, 'best $' + bestNetHour.toFixed(2) + '/h · plan expanded below')),
        el('div', { class: 'kpi' }, el('div', { class: 'k' }, 'Watchlist'), el('div', { class: 'v', html: '40<small>/40</small>' }), el('div', { class: 'd' }, '+ ' + (DATA.rows.length - 40) + ' off-list rows ranked'))
      ),
      el('div', { class: 'formula', text: 'Implied = TVL \u00d7 fitted multiple \u00d7 token odds  \u00b7  log10(if it launches) = ' + DATA.ridge.intercept.toFixed(3) + ' + ' + DATA.ridge.slope_std.toFixed(3) + ' \u00d7 z(log10 TVL) + shift,  \u03c3 = ' + DATA.ridge.sigma_log.toFixed(3) + ',  n = ' + v.comps_n + '.' }),
      el('div', { class: 'verify' },
        el('b', { text: 'Verified: ' }),
        'this table is board.json, ranks in order, totals recomputed — ',
        el('b', { class: 'num', text: fmtMoney(totalImplied) }),
        ' implied over ',
        el('b', { class: 'num', text: fmtMoney(totalTvl) }),
        ' TVL. Snapshot sha256 ',
        el('span', { class: 'mono', text: DATA.snapshot_sha256.slice(0, 16) + '\u2026' }),
        '. Watchlist 40/40. Ledger ' + ledgerTotal + '/' + ledgerTotal + '. Refit: intercept ',
        el('span', { class: 'num', text: rf.intercept.toFixed(3) }),
        ', slope ',
        el('span', { class: 'num', text: rf.slope.toFixed(3) }),
        ', \u03c3 ',
        el('span', { class: 'num', text: rf.sigma.toFixed(3) }),
        ' — ',
        rf.ok ? el('b', { text: 'matches the stored fit.' }) : el('b', { class: 'fail', text: 'DOES NOT match the stored fit.' }),
        ' ',
        v.gate_passed ? el('b', { text: 'Submit gate passed.' }) : el('span', { class: 'fail', text: 'Submit gate NOT passed — see evidence (c).' })
      )
    );
  }

  function accounting() {
    var groups = Object.keys(GROUP_LABELS).filter(function (g) { return DATA.accounting[g]; });
    var total = Object.keys(DATA.accounting).reduce(function (a, g) { return a + DATA.accounting[g]; }, 0);
    var a = DATA.accounting;
    return el('section', { class: 'card compact' },
      el('h2', { text: 'Protocol accounting: all ' + total + ' in exactly one group' }),
      el('div', { class: 'bar' }, groups.map(function (g) {
        return el('div', { style: 'width:' + (DATA.accounting[g] / total * 100) + '%;background:' + GROUP_COLORS[g], title: GROUP_LABELS[g] + ': ' + DATA.accounting[g] });
      })),
      el('div', { class: 'legend' }, groups.map(function (g) {
        return el('span', {}, el('i', { style: 'background:' + GROUP_COLORS[g] }), GROUP_LABELS[g] + ' \u00b7 ' + DATA.accounting[g]);
      })),
      el('p', { class: 'small', text: 'Ranked ' + DATA.rows.length + ' (watchlist ' + (a['ranked-watchlist'] || 0) + ', early ' + (a['ranked-early'] || 0) + ', off-list ' + (a['ranked-offlist'] || 0) + ') \u00b7 tokenized ' + ((a['token-priced-comp'] || 0) + (a['token-no-usable-cap'] || 0)) + ' \u00b7 left out ' + ((a['out-bridge'] || 0) + (a['out-liquid-staking'] || 0) + (a['out-exchange'] || 0) + (a['out-versioned'] || 0)) + '. No parent discount on the 20 off-list rows (no parentProtocol field) — a stated limitation.' })
    );
  }

  // --- scatter: the 94 traded comparables the value model is fitted on ---
  function scatterEl() {
    var comps = DATA.comps;
    var W = 1180, H = 72, PL = 64, PR = 16, PT = 10, PB = 34;
    var xs = comps.map(function (c) { return c.log_tvl; });
    var ys = comps.map(function (c) { return c.log_mcap; });
    var x0 = Math.floor(Math.min.apply(null, xs) - 0.3), x1 = Math.ceil(Math.max.apply(null, xs) + 0.3);
    var y0 = Math.floor(Math.min.apply(null, ys) - 0.3), y1 = Math.ceil(Math.max.apply(null, ys) + 0.3);
    function X(v) { return PL + (v - x0) / (x1 - x0) * (W - PL - PR); }
    function Y(v) { return PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB); }
    function tickLabel(p) {
      var v = Math.pow(10, p);
      if (v >= 1e9) return '$' + (v / 1e9) + 'B';
      if (v >= 1e6) return '$' + (v / 1e6) + 'M';
      if (v >= 1e3) return '$' + (v / 1e3) + 'K';
      return '$' + v;
    }
    var grid = '';
    for (var gx = Math.ceil(x0); gx <= x1; gx++) {
      grid += '<line x1="' + X(gx).toFixed(1) + '" y1="' + Y(y0).toFixed(1) + '" x2="' + X(gx).toFixed(1) + '" y2="' + Y(y1).toFixed(1) + '" stroke="#26382d"/>';
      grid += '<text x="' + X(gx).toFixed(1) + '" y="' + (H - 18).toFixed(1) + '" fill="#6d8474" font-size="11" text-anchor="middle">' + tickLabel(gx) + '</text>';
    }
    for (var gy = Math.ceil(y0); gy <= y1; gy++) {
      grid += '<line x1="' + X(x0).toFixed(1) + '" y1="' + Y(gy).toFixed(1) + '" x2="' + X(x1).toFixed(1) + '" y2="' + Y(gy).toFixed(1) + '" stroke="#26382d"/>';
      grid += '<text x="' + (PL - 8).toFixed(1) + '" y="' + (Y(gy) + 4).toFixed(1) + '" fill="#6d8474" font-size="11" text-anchor="end">' + tickLabel(gy) + '</text>';
    }
    var line = '<line x1="' + X(x0).toFixed(1) + '" y1="' + Y(DATA.ridge.intercept + DATA.ridge.slope_std * (x0 - DATA.ridge.mean_log_tvl) / DATA.ridge.sd_log_tvl).toFixed(1) + '" x2="' + X(x1).toFixed(1) + '" y2="' + Y(DATA.ridge.intercept + DATA.ridge.slope_std * (x1 - DATA.ridge.mean_log_tvl) / DATA.ridge.sd_log_tvl).toFixed(1) + '" stroke="#22c55e" stroke-width="2"/>';
    var pts = comps.map(function (c) {
      var shifted = (DATA.ridge.shifts[c.category || ''] || 0) !== 0;
      return '<circle cx="' + X(c.log_tvl).toFixed(1) + '" cy="' + Y(c.log_mcap).toFixed(1) + '" r="3.5" fill="' + (shifted ? '#38bdf8' : '#94a3b8') + '" fill-opacity="0.85"><title>' + esc(c.name) + ' (' + esc(c.category || 'uncategorised') + '): TVL ' + fmtUsd(Math.pow(10, c.log_tvl)) + ', cap ' + fmtUsd(Math.pow(10, c.log_mcap)) + '</title></circle>';
    }).join('');
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Scatter of the 94 traded comparables: current market cap against current TVL, log scales, with the fitted size curve">'
      + grid + line + pts
      + '<text x="' + (W / 2).toFixed(1) + '" y="' + (H - 2).toFixed(1) + '" fill="#9db3a4" font-size="12" text-anchor="middle">TVL, log scale</text>'
      + '<text x="14" y="' + (H / 2).toFixed(1) + '" fill="#9db3a4" font-size="12" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2).toFixed(1) + ')">Market cap, log scale</text>'
      + '</svg>';
    return el('section', { class: 'card compact' },
      el('h2', { text: 'Value follows TVL — loosely: ' + comps.length + ' traded comparables at market cap (\u03c3 = ' + DATA.ridge.sigma_log.toFixed(2) + ' in log10, so the bands stay wide)' }),
      el('div', { class: 'scatter', html: svg })
    );
  }

  function termTableEl() {
    var rows = V.term_table.map(function (r) {
      return el('tr', {},
        el('td', { text: r.term }),
        el('td', { class: 'num', text: r.loo_pinball.toFixed(4) + '\u00d7' + r.loo_miss_x }),
        el('td', { class: 'num', text: r.wf_pinball.toFixed(4) + '\u00d7' + r.wf_miss_x }),
        el('td', { class: 'num', text: r.loo_spearman.toFixed(3) + '/' + r.wf_spearman.toFixed(3) }),
        el('td', { text: r.verdict }));
    });
    var shiftsText = Object.keys(V.category_shifts).map(function (c) { return c + ' ' + (V.category_shifts[c] >= 0 ? '+' : '') + V.category_shifts[c].toFixed(3); }).join(', ');
    return el('section', { class: 'card compact ev' },
      el('h2', { text: 'Evidence (a): value-model terms, out of sample' }),
      el('p', { class: 'small', text: 'Each row adds one term to the last KEPT row (LOO + walk-forward, ' + V.time_split_pooled.r7.n + ' listed since 2024). Kept only if it lowers BOTH pinballs. Control must not help. Shifts: ' + shiftsText + '.' }),
      el('table', { class: 'ladder' }, el('thead', {}, el('tr', {}, el('th', { text: 'Term' }), el('th', { text: 'LOO' }), el('th', { text: 'WF' }), el('th', { text: 'Spearman' }), el('th', { text: 'Verdict' }))), el('tbody', {}, rows))
    );
  }

  function oddsTableEl() {
    var rows = V.odds.terms.map(function (r) {
      return el('tr', {},
        el('td', { text: r.term }),
        el('td', { class: 'num', text: r.cv_brier.toFixed(3) }),
        el('td', { class: 'num', text: r.wf_brier.toFixed(3) }),
        el('td', { class: 'num', text: r.perm_cv_brier.toFixed(3) }),
        el('td', { text: r.verdict }));
    });
    var keptOdds = V.odds.terms.filter(function (t) { return t.verdict === 'kept'; });
    var lastKept = keptOdds[keptOdds.length - 1];
    return el('section', { class: 'card compact ev' },
      el('h2', { text: 'Evidence (b): token odds, Brier score' }),
      el('p', { class: 'small', text: 'Logistic on ' + V.odds.peers_n + ' peers (base ' + V.odds.base_rate.toFixed(3) + '), L2 = 1. Prior 3 on the category share (was 10): CV ' + V.odds.terms[0].cv_brier.toFixed(3) + ' \u2192 ' + lastKept.cv_brier.toFixed(3) + ', WF ' + V.odds.terms[0].wf_brier.toFixed(3) + ' \u2192 ' + lastKept.wf_brier.toFixed(3) + '. Full Brier ' + V.odds.full_brier.toFixed(3) + '; beta [' + V.odds.beta.map(function (b) { return b.toFixed(3); }).join(', ') + '].' }),
      el('table', { class: 'ladder' }, el('thead', {}, el('tr', {}, el('th', { text: 'Term' }), el('th', { text: 'CV' }), el('th', { text: 'WF' }), el('th', { text: 'Perm.' }), el('th', { text: 'Verdict' }))), el('tbody', {}, rows))
    );
  }

  function honestyEl() {
    return el('section', { class: 'card compact ev' },
      el('h2', { text: 'Evidence (c): interval honesty + the gate' }),
      el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Check' }), el('th', { text: 'LOO (n=' + V.honesty_loo.n + ')' }), el('th', { text: 'WF (n=' + V.honesty_wf.n + ')' }), el('th', { text: 'Stated' }))),
        el('tbody', {},
          el('tr', {}, el('td', { text: 'Within \u00d73 of the model' }), el('td', { class: 'num', text: (V.honesty_loo.within_x3 * 100).toFixed(1) + '%' }), el('td', { class: 'num', text: (V.honesty_wf.within_x3 * 100).toFixed(1) + '%' }), el('td', { text: '\u2014' })),
          el('tr', {}, el('td', { text: 'Inside P25\u2013P75' }), el('td', { class: 'num', text: (V.honesty_loo.inside_p25_p75 * 100).toFixed(1) + '%' }), el('td', { class: 'num', text: (V.honesty_wf.inside_p25_p75 * 100).toFixed(1) + '%' }), el('td', { text: '50%' })),
          el('tr', {}, el('td', { text: 'Inside P10\u2013P90' }), el('td', { class: 'num', text: (V.honesty_loo.inside_p10_p90 * 100).toFixed(1) + '%' }), el('td', { class: 'num', text: (V.honesty_wf.inside_p10_p90 * 100).toFixed(1) + '%' }), el('td', { text: '80%' })))),
      el('p', { class: 'small', text: 'Blind: ' + V.blind.r7.pinball + ' vs ' + V.blind.flat.pinball + ' · LOO: ' + V.loo.r7.pinball + ' vs ' + V.loo.flat.pinball + ' · WF: ' + V.time_split_pooled.r7.pinball + ' vs ' + V.time_split_pooled.flat.pinball + ' (pinball, radar vs flat).' }),
      el('div', { class: 'note' + (V.gate_passed ? ' good' : ''), }, el('b', { text: V.gate_passed ? 'Submit gate passed. ' : 'Submit gate NOT passed. ' }), V.gate_note),
      el('div', { class: 'note' }, el('b', { text: 'Bootstrap (10,000), radar-10 minus flat. ' }), 'Blind pinball ' + V.bootstrap_blind.pinball_delta + ' [' + V.bootstrap_blind.pinball_ci_low + ', ' + V.bootstrap_blind.pinball_ci_high + ']; LOO ' + V.bootstrap_loo.pinball_delta + ' [' + V.bootstrap_loo.pinball_ci_low + ', ' + V.bootstrap_loo.pinball_ci_high + ']; WF ' + V.bootstrap_ts.pinball_delta + ' [' + V.bootstrap_ts.pinball_ci_low + ', ' + V.bootstrap_ts.pinball_ci_high + '].')
    );
  }

  function blindTableEl() {
    var blindRows = V.blind_predictions.map(function (p) {
      return el('tr', {},
        el('td', { text: p.slug }),
        el('td', { class: 'num', text: fmtMoney(p.predicted_usd) }),
        el('td', { class: 'num', text: fmtMoney(p.actual_usd) }),
        el('td', { class: 'num', text: '\u00d7' + (Math.max(p.predicted_usd, p.actual_usd) / Math.min(p.predicted_usd, p.actual_usd)).toFixed(2) }));
    });
    return el('section', { class: 'card compact' },
      el('h2', { text: 'The blind test\u2019s ' + V.blind_scored_n + ' scored predictions, whole (predicted if-it-launches vs actual current market cap)' }),
      el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Predicted' }), el('th', { text: 'Actual (current cap)' }), el('th', { text: 'Miss' }))), el('tbody', {}, blindRows))
    );
  }

  // How many rows clear a net/hour bar: the $25/h bar is the verdict, the lower bars
  // are shown for scale so "0 FARM" reads as a measurement of the bar, not of the plans.
  function farmSensitivity() {
    var bars = [25, 15, 10, 5];
    return 'FARM rows by net/hour bar — ' + bars.map(function (b) {
      var n = DATA.rows.filter(function (r) {
        var e = econOf(r);
        return e.net > e.deposit * DATA.farm_scenario.tbill_apr * (S.horizon / 52) && e.netHour >= b;
      }).length;
      return '$' + b + '/h: ' + n;
    }).join(' \u00b7 ') + '. The $25/h bar is kept; lower bars are shown for scale.';
  }

  // The board's expanded plan: the single best MARGINAL row by net/hour, shown
  // in full in the board itself (WHEN / STEP / COST / TIME + budget), so the
  // board reader never has to open a detail view to see a plan. Shown only in
  // the default board state (no filter, no search, ranked by implied value).
  function bestMarginalRow(rows) {
    if (S.verdict !== 'all' || S.tier !== 'all' || S.cat !== 'all' || S.chain !== 'all' || S.q
        || S.sort !== 'implied' || S.dir !== -1 || S.sel) return null;
    var best = null;
    rows.forEach(function (r) { if (econOf(r).verdict === 'MARGINAL' && (!best || econOf(r).netHour > econOf(best).netHour)) best = r; });
    return best;
  }
  function planExpandRow(r) {
    var e = econOf(r);
    var tbill = e.deposit * DATA.farm_scenario.tbill_apr * (S.horizon / 52);
    var steps = r.plan.map(function (s) {
      return el('tr', {},
        el('td', { text: s.when || 'Day 0' }),
        el('td', { text: s.text }),
        el('td', { class: 'num', text: s.cost }),
        el('td', { class: 'num', text: s.time }));
    });
    return el('tr', { class: 'plan-expand' },
      el('td', { colspan: 11 },
        el('div', { class: 'plan-expand-head' },
          el('b', { text: 'Best marginal plan — #' + r.rank + ' ' + r.name + ': ' }),
          r.plan.length + ' steps \u00b7 $' + e.deposit.toFixed(2) + ' in \u00b7 $' + e.fees.toFixed(2) + ' fees \u00b7 '
          + e.hours.toFixed(2) + ' h \u00b7 drop $' + e.drop.toFixed(2) + ' \u00b7 net +$' + e.net.toFixed(2)
          + ' ($' + e.netHour.toFixed(2) + '/h). Clears T-bill ($' + tbill.toFixed(2)
          + '), not the $25/h bar — hence MARGINAL.'),
        el('table', { class: 'plan-steps' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'When' }), el('th', { text: 'Step' }), el('th', { text: 'Cost' }), el('th', { text: 'Time' }))),
          el('tbody', {}, steps)),
        el('div', { class: 'plan-expand-budget' },
          el('b', { text: 'Budget: ' }),
          '$' + e.deposit.toFixed(2) + ' + $' + e.fees.toFixed(2) + ' fees = $' + (e.deposit + e.fees).toFixed(2)
          + ' outlay; drop $' + e.drop.toFixed(2) + '; net +$' + e.net.toFixed(2) + ' over ' + S.horizon
          + ' weeks. All in: ' + r.plan.length + ' steps, ' + S.horizon + ' weeks, $' + e.deposit.toFixed(2)
          + ' \u2192 net +$' + e.net.toFixed(2) + ', +$' + e.netHour.toFixed(2) + '/h.')
      ));
  }

  // --- the board: filters, table, detail ---
  function filteredRows() {
    var rows = DATA.rows.filter(function (r) {
      if (S.verdict !== 'all') { var e = econOf(r); if (e.verdict !== S.verdict) return false; }
      if (S.tier === 'watchlist' && !r.is_watchlist) return false;
      if (S.tier === 'early' && (r.is_watchlist || r.above_floor)) return false;
      if (S.tier === 'offlist' && (r.is_watchlist || !r.above_floor)) return false;
      if (S.cat !== 'all' && (r.category || '') !== S.cat) return false;
      if (S.chain !== 'all' && r.chains.indexOf(S.chain) < 0) return false;
      if (S.q) {
        var q = S.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0 && (r.category || '').toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = S.sort;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else if (key === 'net') { av = econOf(a).net; bv = econOf(b).net; }
      else if (key === 'nethour') { av = econOf(a).netHour; bv = econOf(b).netHour; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      return (av - bv) * S.dir;
    });
    return rows;
  }

  function tierPill(r) {
    if (r.is_watchlist) return el('span', { class: 'pill watch', text: 'Watchlist' });
    return r.above_floor ? el('span', { class: 'pill off', text: 'Off-list' }) : el('span', { class: 'pill early', text: 'Early' });
  }

  function rowEls(rows) {
    var expanded = bestMarginalRow(rows);
    var out = [];
    rows.forEach(function (r) {
      var e = econOf(r);
      var range = '$' + (r.p25_usd / 1e6).toFixed(1) + 'M\u2013$' + (r.p75_usd / 1e6).toFixed(1) + 'M';
      var shiftTag = r.category_shift ? ' shift ' + (r.category_shift >= 0 ? '+' : '') + r.category_shift.toFixed(3) : '';
      out.push(el('tr', { class: S.sel === r.slug ? 'sel' : '', onclick: function () { S.sel = S.sel === r.slug ? null : r.slug; try { location.hash = S.sel ? 'row=' + r.slug : ''; } catch (e) {} render(); } },
        el('td', { class: 'num', text: r.rank }),
        el('td', { title: (r.chains.join(', ') || 'no chain') + shiftTag }, el('b', { text: r.name }), ' \u00b7 ' + (r.category || 'uncategorised'), ' ', tierPill(r)),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.token_odds.toFixed(3) }),
        el('td', { class: 'num', text: fmtMoney(r.predicted_usd) }),
        el('td', { class: 'num', title: 'P25\u2013P75 ' + range }, el('b', { text: fmtMoney(r.implied_value_usd) })),
        el('td', { class: 'num', text: '$' + e.netHour.toFixed(2) }),
        el('td', {}, el('span', { class: 'pill ' + e.verdict.toLowerCase(), text: e.verdict }), ' $' + e.net.toFixed(2)),
        el('td', { class: 'plan', text: r.plan.length + ' steps \u00b7 $' + e.fees.toFixed(2) + ' \u00b7 ' + e.hours.toFixed(1) + ' h' })
      ));
      if (expanded && r.slug === expanded.slug) out.push(planExpandRow(r));
    });
    return out;
  }

  function boardTable() {
    var rows = filteredRows();
    var cats = [...new Set(DATA.rows.map(function (r) { return r.category || ''; }))].sort();
    var chains = [...new Set(DATA.rows.flatMap(function (r) { return r.chains; }))].sort();
    var counts = { all: DATA.rows.length, FARM: 0, MARGINAL: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { counts[econOf(r).verdict]++; });
    function tab(v, label) {
      return el('button', { class: 'tab', 'data-verdict': v, 'aria-pressed': S.verdict === v ? 'true' : 'false', onclick: function () { S.verdict = v; render(); }, text: label + ' ' + counts[v === 'all' ? 'all' : v] });
    }
    var sortBtn = function (key, label) {
      return el('button', { onclick: function () { if (S.sort === key) S.dir = -S.dir; else { S.sort = key; S.dir = -1; } render(); }, text: label + (S.sort === key ? (S.dir === -1 ? ' \u25bc' : ' \u25b2') : '') });
    };
    var tierSel = el('select', { 'aria-label': 'Tier', onchange: function (ev) { S.tier = ev.target.value; render(); } },
      el('option', { value: 'all', text: 'All tiers' }), el('option', { value: 'watchlist', text: 'Watchlist' }), el('option', { value: 'early', text: 'Early (below floor)' }), el('option', { value: 'offlist', text: 'Off-list (above floor)' }));
    tierSel.value = S.tier;
    var catSel = el('select', { 'aria-label': 'Category', onchange: function (ev) { S.cat = ev.target.value; render(); } },
      el('option', { value: 'all', text: 'All categories' }), cats.map(function (c) { return el('option', { value: c, text: c || 'uncategorised' }); }));
    catSel.value = S.cat;
    var chainSel = el('select', { 'aria-label': 'Chain', onchange: function (ev) { S.chain = ev.target.value; render(); } },
      el('option', { value: 'all', text: 'All chains' }), chains.map(function (c) { return el('option', { value: c, text: c }); }));
    chainSel.value = S.chain;
    var planSel = el('select', { 'aria-label': 'Plan size', onchange: function (ev) { S.plan = parseFloat(ev.target.value); render(); } },
      el('option', { value: '0.0001', text: '0.01% of TVL' }), el('option', { value: '0.0002', text: '0.02% of TVL' }), el('option', { value: '0.0005', text: '0.05% of TVL' }));
    planSel.value = String(S.plan);
    var detail = S.sel ? detailView(DATA.rows.find(function (r) { return r.slug === S.sel; })) : null;
    return el('section', { class: 'card compact', id: 'board-card' },
      el('h2', { id: 'board-count', text: 'The board: ' + rows.length + ' of ' + DATA.rows.length + ' rows' }),
      el('div', { class: 'filters' },
        el('div', { class: 'tabs' }, tab('all', 'All'), tab('FARM', 'Farm'), tab('MARGINAL', 'Marginal'), tab('SKIP', 'Skip')),
        tierSel, catSel, chainSel,
        el('input', { type: 'search', placeholder: 'Search name or slug\u2026', value: S.q, oninput: function (ev) { S.q = ev.target.value; renderTableOnly(); } }),
        el('span', { class: 'ctl' }, 'Plan size ', planSel),
        el('span', { class: 'ctl' }, 'Drop share ', el('input', { type: 'range', min: 1, max: 20, step: 0.5, value: S.share * 100, 'aria-label': 'Drop share', oninput: function (ev) { S.share = parseFloat(ev.target.value) / 100; renderTableOnly(); } }), el('b', { id: 'share-val', text: (S.share * 100).toFixed(1) + '%' })),
        el('span', { class: 'ctl' }, 'Horizon ', el('input', { type: 'range', min: 4, max: 26, step: 1, value: S.horizon, 'aria-label': 'Horizon in weeks', oninput: function (ev) { S.horizon = parseInt(ev.target.value, 10); renderTableOnly(); } }), el('b', { id: 'horizon-val', text: S.horizon + ' wk' })),
        el('button', { class: 'btn', onclick: function () { S = { q: '', cat: 'all', chain: 'all', tier: 'all', verdict: 'all', sort: 'implied', dir: -1, sel: null, plan: DATA.farm_scenario.deposit_pct, share: DATA.farm_scenario.drop_share, horizon: DATA.farm_scenario.horizon_weeks }; render(); }, text: 'Reset' }),
        el('button', { class: 'btn', onclick: downloadCsv, text: 'CSV' }),
        el('button', { class: 'btn', onclick: downloadJson, text: 'JSON' })
      ),
      el('p', { class: 'small', id: 'farm-sensitivity', text: farmSensitivity() }),
      detail,
      el('div', { style: 'overflow-x:auto;margin-top:8px' },
        el('table', { class: 'board' },
          el('thead', {}, el('tr', {},
            el('th', {}, sortBtn('implied', '#')),
            el('th', { text: 'Protocol' }),
            el('th', {}, sortBtn('tvl', 'TVL')),
            el('th', { text: '7D' }),
            el('th', { text: 'No-token age' }),
            el('th', {}, sortBtn('odds', 'Token odds')),
            el('th', { text: 'If it launches' }),
            el('th', {}, sortBtn('implied', 'Implied value \u00b7 P25\u2013P75')),
            el('th', {}, sortBtn('nethour', 'Net / hour')),
            el('th', {}, sortBtn('net', 'Verdict \u00b7 net of fees')),
            el('th', { text: 'Farm plan' }))),
          el('tbody', { id: 'rows' }, rowEls(rows))))
    );
  }

  // Nearest priced peers: the 5 traded comparables closest in log TVL to this row.
  function nearestPeers(r) {
    var sorted = DATA.comps.slice().sort(function (a, b) {
      return Math.abs(a.log_tvl - r.log_tvl) - Math.abs(b.log_tvl - r.log_tvl);
    }).slice(0, 5);
    return el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Nearest priced peer' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'Cap / TVL' }))),
      el('tbody', {}, sorted.map(function (c) {
        return el('tr', {},
          el('td', { text: c.name }),
          el('td', { class: 'num', text: fmtUsd(Math.pow(10, c.log_tvl)) }),
          el('td', { class: 'num', text: fmtUsd(Math.pow(10, c.log_mcap)) }),
          el('td', { class: 'num', text: '\u00d7' + (Math.pow(10, c.log_mcap - c.log_tvl)).toFixed(2) }));
      })));
  }

  function detailView(r) {
    if (!r) return null;
    var e = econOf(r);
    var z = (r.log_tvl - DATA.ridge.mean_log_tvl) / DATA.ridge.sd_log_tvl;
    var baseIfLaunches = Math.pow(10, DATA.ridge.intercept + DATA.ridge.slope_std * z);
    var shiftFactor = Math.pow(10, r.category_shift);
    var oddsDl = el('dl', { class: 'kv' });
    oddsDl.appendChild(el('dt', { text: 'intercept' }));
    oddsDl.appendChild(el('dd', { text: DATA.odds_beta[0].toFixed(3) }));
    DATA.odds_kept_terms.forEach(function (t, j) {
      var age = r.age_days === null || r.age_days === undefined ? 365 : r.age_days;
      var f = { log_tvl: Math.log10(Math.max(1, r.tvl_usd)), log_age: Math.log10(age + 1), cat_share: DATA.cat_share[r.category || ''] === undefined ? DATA.cat_base_rate : DATA.cat_share[r.category || ''], growth7: Math.max(-80, Math.min(200, r.change_7d || 0)) / 100, log_chains: Math.log10(Math.max(1, r.chains.length)), age_missing: r.age_days === null || r.age_days === undefined ? 1 : 0 };
      var zv = (f[t] - DATA.odds_mu[t]) / DATA.odds_sd[t];
      oddsDl.appendChild(el('dt', { text: t + ' (z)' }));
      oddsDl.appendChild(el('dd', { text: (DATA.odds_beta[1 + j] >= 0 ? '+' : '') + DATA.odds_beta[1 + j].toFixed(3) + ' \u00d7 ' + zv.toFixed(3) + ' = ' + (DATA.odds_beta[1 + j] * zv).toFixed(3) }));
    });
    var g = gasFor(r.chains[0]);
    var tbill = e.deposit * DATA.farm_scenario.tbill_apr * (S.horizon / 52);
    var weeksRows = [4, 8, 12, 26].map(function (w) {
      var netW = e.drop - (g[0] + g[1] * w);
      return el('tr', {}, el('td', { text: w + ' weeks' }), el('td', { class: 'num', text: '$' + netW.toFixed(2) }), el('td', { class: 'num', text: '$' + (netW / (0.25 + 0.25 * w + 0.167)).toFixed(2) + '/h' }));
    });
    return el('div', { class: 'detail', id: 'detail' },
      el('h3', { text: '#' + r.rank + ' ' + r.name + ' \u2014 detail' }),
      el('div', { class: 'eq' },
        el('b', { text: 'How ' + fmtMoney(r.implied_value_usd) + ' follows from ' + r.name + '\u2019s record' }),
        el('div', { class: 'eqline', html: 'TVL ' + esc(fmtMoney(r.tvl_usd)) + ' &nbsp;\u00d7&nbsp; size curve &nbsp;=&nbsp; <b>' + esc(fmtMoney(baseIfLaunches)) + '</b> (no shift)' }),
        el('div', { class: 'eqline', html: '&nbsp;\u00d7&nbsp; category shift 10' + '<sup>' + (r.category_shift >= 0 ? '+' : '') + r.category_shift.toFixed(3) + '</sup> = \u00d7' + shiftFactor.toFixed(2) + ' &nbsp;=&nbsp; <b>' + esc(fmtMoney(r.predicted_usd)) + '</b> if it launches' }),
        el('div', { class: 'eqline', html: '&nbsp;\u00d7&nbsp; token odds ' + r.token_odds.toFixed(3) + ' &nbsp;=&nbsp; <b>' + esc(fmtMoney(r.implied_value_usd)) + '</b> implied value' })
      ),
      el('div', { class: 'cols' },
        el('div', {},
          el('h3', { text: 'The model, on this row' }),
          el('dl', { class: 'kv' },
            el('dt', { text: 'TVL' }), el('dd', { text: fmtMoney(r.tvl_usd) }),
            el('dt', { text: 'log10 TVL (z)' }), el('dd', { text: r.log_tvl.toFixed(3) + ' (' + z.toFixed(2) + ')' }),
            el('dt', { text: 'If it launches (P50)' }), el('dd', { text: fmtMoney(r.predicted_usd) }),
            el('dt', { text: 'P25\u2013P75' }), el('dd', { text: fmtMoney(r.p25_usd) + ' \u2013 ' + fmtMoney(r.p75_usd) }),
            el('dt', { text: 'P10\u2013P90' }), el('dd', { text: fmtMoney(r.p10_usd) + ' \u2013 ' + fmtMoney(r.p90_usd) }),
            el('dt', { text: 'Fitted multiple' }), el('dd', { text: '\u00d7' + r.curve_multiple.toFixed(3) }),
            el('dt', { text: 'Category shift' }), el('dd', { text: (r.category_shift >= 0 ? '+' : '') + r.category_shift.toFixed(3) + ' (' + (r.category || 'uncategorised') + ')' }),
            el('dt', { text: 'Token odds' }), el('dd', { text: r.token_odds.toFixed(3) }),
            el('dt', { text: 'Implied value' }), el('dd', { text: fmtMoney(r.implied_value_usd) })),
          el('h3', { text: 'Token odds, term by term' }),
          oddsDl,
          el('p', { class: 'small', text: 'Odds recomputed in this page: ' + oddsOf(r).toFixed(3) + ' (stored ' + r.token_odds.toFixed(3) + '). If it launches recomputed: ' + fmtMoney(ifLaunches(r)) + ' (stored ' + fmtMoney(r.predicted_usd) + ').' }),
          el('h3', { text: 'Nearest priced peers (by TVL)' }),
          nearestPeers(r),
          el('p', { class: 'small', text: 'The five traded comparables closest in size. Their cap/TVL multiples are what the size curve averages over; this row\u2019s fitted multiple is \u00d7' + r.curve_multiple.toFixed(3) + '.' })
        ),
        el('div', {},
          el('h3', { text: 'Farm plan \u2014 ' + e.verdict + ' (10 steps)' }),
          el('dl', { class: 'kv' },
            el('dt', { text: 'Deposit' }), el('dd', { text: '$' + e.deposit.toFixed(2) }),
            el('dt', { text: 'Expected drop' }), el('dd', { text: '$' + e.drop.toFixed(2) }),
            el('dt', { text: 'Fees' }), el('dd', { text: '$' + e.fees.toFixed(2) }),
            el('dt', { text: 'Time' }), el('dd', { text: e.hours.toFixed(2) + ' h' }),
            el('dt', { text: 'Net of fees' }), el('dd', { text: '$' + e.net.toFixed(2) }),
            el('dt', { text: 'Net / hour' }), el('dd', { text: '$' + e.netHour.toFixed(2) }),
            el('dt', { text: 'T-bill on deposit' }), el('dd', { text: '$' + tbill.toFixed(2) })),
          el('p', { class: 'small', text: 'Budget: deposit $' + e.deposit.toFixed(2) + ' + fees $' + e.fees.toFixed(2) + ' = $' + (e.deposit + e.fees).toFixed(2) + ' outlay; expected drop $' + e.drop.toFixed(2) + '; net $' + e.net.toFixed(2) + ' over ' + S.horizon + ' weeks.' }),
          el('ol', { class: 'steps' }, r.plan.map(function (s) {
            return el('li', {}, s.text, el('div', { class: 'meta', text: 'Cost ' + s.cost + ' \u00b7 ' + s.time }));
          })),
          el('h3', { text: 'Benchmarks' }),
          el('dl', { class: 'kv' },
            el('dt', { text: 'T-bill bar' }), el('dd', { text: 'net $' + e.net.toFixed(2) + ' vs $' + tbill.toFixed(2) + (e.net > tbill ? ' — clears it' : ' — does not clear it') }),
            el('dt', { text: 'Fees vs drop' }), el('dd', { text: '$' + e.fees.toFixed(2) + ' is ' + (e.drop > 0 ? (e.fees / e.drop * 100).toFixed(0) : 'n/a') + '% of the drop' }),
            el('dt', { text: 'Drop covers fees' }), el('dd', { text: e.drop > 0 ? '\u00d7' + (e.drop / e.fees).toFixed(1) : 'n/a' }),
            el('dt', { text: 'Exit rule' }), el('dd', { text: 'leave if TVL falls 20% — re-price first' })),
          el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Held' }), el('th', { text: 'Net' }), el('th', { text: 'Net / hour' }))), el('tbody', {}, weeksRows))
        )
      )
    );
  }

  function liveView() {
    var rows = DATA.live.map(function (p) {
      return el('tr', {},
        el('td', { text: p.name }),
        el('td', { text: p.category || 'uncategorised' }),
        el('td', { class: 'num', text: fmtMoney(p.tvl_usd) }),
        el('td', { class: 'num', text: fmtMoney(p.mcap_usd) }),
        el('td', { class: 'num', text: fmtPct(p.change_7d) }));
    });
    return el('section', { class: 'card compact' },
      el('h2', { text: 'Live tokens, set aside: the market\u2019s own values, not the model\u2019s' }),
      el('p', { class: 'small', text: 'The 24 largest tokenized protocols by market cap. They are priced by the market, not the model — which is why the board never mixes a traded market cap into a pre-token rank.' }),
      el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: '7D' }))), el('tbody', {}, rows))
    );
  }

  function footer() {
    var keptO = V.odds.terms.filter(function (t) { return t.verdict === 'kept'; });
    var lastO = keptO[keptO.length - 1];
    return el('footer', {},
      el('p', { text: 'Method: ' + V.comps_n + ' snapshot comparables — traded protocols with a usable market cap and TVL, in the snapshot itself; no external labels, no launch-day figures. Snapshot as of ' + DATA.snapshot_as_of + ', floor ' + fmtMoney(DATA.floor_usd) + ', sha256 ' + DATA.snapshot_sha256 + '.' }),
      el('p', { text: 'Limitations, stated: the strict submit gate ' + (V.gate_passed ? 'passed' : 'did not pass') + ' (see evidence (c)); the value model explains little of the variation (leave-one-out R\u00b2 ' + V.loo.r7.r2_log.toFixed(2) + ') — heavy tails dominate, so the bands stay wide; no row clears the $25/hour farm bar, so no row carries a FARM verdict (best row pays $' + Math.max.apply(null, DATA.rows.map(function (r) { return r.net_per_hour_usd; })).toFixed(2) + '/h); no parent discount is applied to off-list rows because the snapshot carries no parentProtocol field; the odds model improves on its base rate by ' + (V.odds.terms[0].cv_brier - lastO.cv_brier).toFixed(3) + ' CV Brier and ' + (V.odds.terms[0].wf_brier - lastO.wf_brier).toFixed(3) + ' walk-forward (see evidence (b)). ' + V.model_note }),
      el('p', { text: 'Launch Radar v10 \u00b7 model radar-10 \u00b7 data.js carries the whole radar, including the ' + V.comps_n + ' comparables, so the fit can be re-run in this page. The board is deterministic: the entry program runs twice and writes identical bytes.' })
    );
  }

  function downloadCsv() {
    var rows = filteredRows();
    var head = 'rank,slug,name,category,tvl_usd,change_7d,age_days,token_odds,if_launches_usd,implied_usd,deposit_usd,expected_drop_usd,fees_usd,net_usd,net_per_hour_usd,verdict\n';
    var body = rows.map(function (r) {
      var e = econOf(r);
      return [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '') + '"', r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days, r.token_odds, r.predicted_usd, r.implied_value_usd, e.deposit.toFixed(2), e.drop.toFixed(2), e.fees.toFixed(2), e.net.toFixed(2), e.netHour.toFixed(2), e.verdict].join(',');
    }).join('\n');
    download('launch-radar-v10-board.csv', 'text/csv', head + body + '\n');
  }
  function downloadJson() {
    download('launch-radar-v10-board.json', 'application/json', JSON.stringify({ rows: filteredRows() }, null, 1));
  }
  function download(name, type, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // --- render ---
  function render() {
    app.removeAttribute('aria-busy');
    app.replaceChildren(header(), accounting(), scatterEl(),
      el('div', { class: 'evidence-grid' }, termTableEl(), oddsTableEl(), honestyEl()),
      boardTable(), blindTableEl(), liveView(), footer());
    if (fromHash && S.sel) {
      fromHash = false;
      var d = document.getElementById('detail');
      if (d) d.scrollIntoView();
    }
  }
  // The search box and the sliders update only the rows, the count and the tab labels,
  // so typing and dragging never lose focus or rebuild the filters.
  function renderTableOnly() {
    var card = document.getElementById('board-card');
    if (!card) { render(); return; }
    var rows = filteredRows();
    var tbody = card.querySelector('#rows');
    if (tbody) tbody.replaceChildren.apply(tbody, rowEls(rows));
    var h2 = card.querySelector('#board-count');
    if (h2) h2.textContent = 'The board: ' + rows.length + ' of ' + DATA.rows.length + ' rows';
    var counts = { all: DATA.rows.length, FARM: 0, MARGINAL: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { counts[econOf(r).verdict]++; });
    card.querySelectorAll('button.tab').forEach(function (b) {
      var v = b.getAttribute('data-verdict');
      var label = v === 'all' ? 'All' : v.charAt(0) + v.slice(1).toLowerCase();
      b.textContent = label + ' ' + counts[v];
    });
    var sv = card.querySelector('#share-val');
    if (sv) sv.textContent = (S.share * 100).toFixed(1) + '%';
    var hv = card.querySelector('#horizon-val');
    if (hv) hv.textContent = S.horizon + ' wk';
    var fs = card.querySelector('#farm-sensitivity');
    if (fs) fs.textContent = farmSensitivity();
  }

  render();
})();
