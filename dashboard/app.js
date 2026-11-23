'use strict';
/* Token Launch Radar dashboard. All data comes from window.RADAR (data.js, written by
   main.ts from the same board). No network, no fetch. */
const R = window.RADAR;
const rows = R.rows;
const $ = (id) => document.getElementById(id);
const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
const fmtM = (n) => {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  return fmt(n);
};
const pct = (n) => (n === null || n === undefined ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%');
const bandOf = (tvl) => (tvl < 5e7 ? 0 : tvl < 5e8 ? 1 : 2);
let selected = null;

/* ---------- filters ---------- */
const cats = [...new Set(rows.map((r) => r.category || 'Uncategorised'))].sort();
for (const c of cats) $('f-cat').insertAdjacentHTML('beforeend', `<option>${c}</option>`);
const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
for (const c of chains) $('f-chain').insertAdjacentHTML('beforeend', `<option>${c}</option>`);

function visible() {
  const q = $('q').value.trim().toLowerCase();
  const cat = $('f-cat').value;
  const chain = $('f-chain').value;
  const band = $('f-band').value;
  const watch = $('f-watch').checked;
  let out = rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q) || r.chains.join(' ').toLowerCase().includes(q))) return false;
    if (cat && (r.category || 'Uncategorised') !== cat) return false;
    if (chain && !r.chains.includes(chain)) return false;
    if (band !== '' && bandOf(r.tvl_usd) !== Number(band)) return false;
    if (watch && !r.watchlist) return false;
    return true;
  });
  const s = $('sort').value;
  const key = { rank: (r) => r.rank, value: (r) => -r.implied_value_usd, tvl: (r) => -r.tvl_usd, change: (r) => -(r.change_7d ?? -1e9), range: (r) => -r.range_high_usd }[s];
  out = [...out].sort((a, b) => key(a) - key(b));
  return out;
}

function renderBoard() {
  const out = visible();
  $('count').textContent = out.length + ' of ' + rows.length + ' protocols';
  $('rows').innerHTML = out
    .map(
      (r) => `<tr data-slug="${r.slug}" class="${selected === r.slug ? 'sel' : ''}">
      <td>${r.rank}</td>
      <td>${r.watchlist ? '<span class="star">★</span> ' : ''}${r.name}</td>
      <td>${r.category || '—'}</td>
      <td>${fmtM(r.tvl_usd)}</td>
      <td class="${(r.change_7d ?? 0) >= 0 ? 'pos' : 'neg'}">${pct(r.change_7d)}</td>
      <td class="val">${fmtM(r.implied_value_usd)}</td>
      <td class="muted">${fmtM(r.range_low_usd)} – ${fmtM(r.range_high_usd)}</td>
      <td><span class="dot ${r.confidence}"></span>${r.confidence}</td>
      <td class="muted">›</td></tr>`
    )
    .join('');
  for (const tr of document.querySelectorAll('#rows tr')) {
    tr.addEventListener('click', () => select(tr.dataset.slug, true));
  }
}

/* ---------- detail ---------- */
function select(slug, rerender) {
  selected = slug;
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  if (rerender) renderBoard();
  const core = r.tvl_usd >= 5e7 ? '$1,000-$5,000' : '$250-$1,000';
  $('detail').innerHTML = `
    <h2>${r.watchlist ? '<span class="star">★</span> ' : ''}${r.name}</h2>
    <p class="muted">Rank #${r.rank} · ${r.category || 'Uncategorised'} · ${r.chains.join(', ')}${r.watchlist ? ' · on the $50M watchlist' : ''}</p>
    <div class="eq"><b class="val">${fmt(r.implied_value_usd)}</b> implied value<br>
    range ${fmt(r.range_low_usd)} – ${fmt(r.range_high_usd)} (p25/p75 multiple range)</div>
    <h3>How the value is built</h3>
    <table>
      <tr><td>TVL</td><td>${fmt(r.tvl_usd)}</td></tr>
      <tr><td>Category multiple (shrunk, k=5)</td><td>× ${r.multiple.toFixed(3)}</td></tr>
      <tr><td>Growth factor (7d ${pct(r.change_7d)})</td><td>× ${r.growth_factor.toFixed(3)}</td></tr>
      <tr><td>Maturity factor (tracked since ${r.listed_at || 'unknown'})</td><td>× ${r.maturity_factor.toFixed(3)}</td></tr>
      <tr><td>Size factor (TVL band)</td><td>× ${r.size_factor.toFixed(3)}</td></tr>
      <tr><td>Implied value</td><td><b>${fmt(r.implied_value_usd)}</b></td></tr>
    </table>
    <h3>Calibration</h3>
    <table>
      <tr><td>Live comps in category</td><td>${r.comps}</td></tr>
      <tr><td>Comp multiples p25 / p75</td><td>${r.p25_multiple.toFixed(3)} / ${r.p75_multiple.toFixed(3)}</td></tr>
      <tr><td>Calibration confidence</td><td><span class="dot ${r.confidence}"></span>${r.confidence} (comps + spread)</td></tr>
      <tr><td>Category base rate</td><td>${(r.base_rate * 100).toFixed(0)}% of ${r.category || 'this category'} protocols with ≥$5M TVL already record a token (measured base rate, not a launch probability)</td></tr>
    </table>
    <h3>Farm plan — summary</h3>
    <p>Core position ${core}, ${r.farm_steps.length} steps, about 30 minutes a week after a 30-minute setup. First step: ${r.farm_steps[0]}</p>
    <ol class="farm">${r.farm_steps.map((s) => `<li>${s}</li>`).join('')}</ol>`;
}

/* ---------- live view ---------- */
function renderLive() {
  $('live-note').textContent =
    R.live_size + ' protocols already record a token. They are set aside from the board and used only to calibrate category multiples.';
  $('live-rows').innerHTML = R.live
    .map(
      (p) => `<tr><td>${p.name}</td><td>${p.symbol || '—'}</td><td>${p.category || '—'}</td><td>${fmtM(p.tvl_usd)}</td><td>${fmtM(p.mcap_usd)}</td><td>${p.multiple.toFixed(3)}</td></tr>`
    )
    .join('');
}

/* ---------- method view ---------- */
function sandbox() {
  const gw = Number($('sb-growth').value);
  const sp = Number($('sb-size').value);
  $('sb-growth-v').textContent = gw.toFixed(2);
  $('sb-size-v').textContent = sp.toFixed(2);
  const G = R.calibration.global_centre;
  const top = [...rows]
    .map((r) => {
      const mult = r.comps >= 1 ? Math.exp((r.comps * Math.log(r.cat_centre) + 5 * Math.log(G)) / (r.comps + 5)) : G;
      const ch = r.change_7d === null ? 0 : Math.min(100, Math.max(-50, r.change_7d));
      const gf = 1 + (gw * ch) / 100;
      const sf = Math.pow(r.band_raw_ratio, sp);
      return { name: r.name, v: r.tvl_usd * mult * gf * r.maturity_factor * sf };
    })
    .sort((a, b) => b.v - a.v)
    .slice(0, 5);
  $('sb-out').innerHTML = top.map((t, i) => `${i + 1}. ${t.name} — ${fmtM(t.v)}`).join('<br>');
}

function renderMethod() {
  const bt = R.backtest;
  const cal = R.calibration;
  $('method-body').innerHTML = `
    <h2>Method — model radar-3</h2>
    <p>Every protocol in the snapshot that records no token (mcap, gecko id and symbol all null) is scored,
    excluding wrapped / staked / bridge / exchange products and versioned re-deployments: ${R.early_size} protocols.
    Protocols that already record a token (${R.live_size}) are never ranked; they calibrate the model.</p>
    <div class="card"><h3>The equation</h3>
      <p><code>implied = TVL × category multiple × growth × maturity × size</code></p>
      <p><b>Category multiple</b> — geometric mean of mcap/TVL among live protocols in the same category,
      winsorised to [0.01, 10] and shrunk toward the global centre (${cal.global_centre.toFixed(3)}×) in log space with k = ${cal.shrink_k}.
      Shrinkage applies with even one comp, so thin categories are pulled hard toward the centre; a category with no live comps uses the global centre.
      Each row also carries the category's p25/p75 multiples as its range.</p>
      <p><b>Growth</b> — the 7-day TVL change, clamped to [-50%, +100%], applied with weight ${cal.growth_weight}: factor = 1 + ${cal.growth_weight} × change.</p>
      <p><b>Maturity</b> — 0.70 for a brand-new listing, rising linearly to 1.00 after two years tracked without a token.</p>
      <p><b>Size</b> — market caps grow slower than TVL, so each TVL band's geometric-mean multiple is divided by the global centre
      and applied at power ${cal.size_power}: ${cal.bands.map((b) => `${b.label} raw ×${b.raw_ratio.toFixed(2)} → factor ×${b.factor.toFixed(2)}`).join(' · ')}.</p>
    </div>
    <div class="card"><h3>Measured accuracy — the program backtests itself on every run</h3>
      <p>The ${R.live_size} live protocols are split by slug hash: ${bt.calibration_size} calibrate, ${bt.validation_size} are hidden and predicted.</p>
      <div class="grid">
        <div><div class="big">×${bt.median_error_factor.toFixed(1)}</div><div class="muted">median error vs actual market cap</div></div>
        <div><div class="big">${bt.within_2x_pct.toFixed(0)}%</div><div class="muted">of predictions within 2× of actual</div></div>
        <div><div class="big">${bt.spearman.toFixed(2)}</div><div class="muted">Spearman rank correlation</div></div>
        <div><div class="big">×${bt.bias_factor.toFixed(2)}</div><div class="muted">bias (1.00 = unbiased)</div></div>
      </div>
      <p class="muted">These are the program's own measured numbers on this snapshot, printed honestly: the model ranks usefully and prices roughly — treat implied values as orders of magnitude, not quotes.</p>
    </div>
    <div class="card"><h3>Sandbox — re-price the board</h3>
      <p>Move the two weights and the top of the board is recomputed with the same formula the program uses.
      At the defaults (growth ${cal.growth_weight}, size power ${cal.size_power}) the sandbox reproduces board.json exactly.</p>
      <label>Growth weight <b id="sb-growth-v">${cal.growth_weight}</b><input type="range" id="sb-growth" min="0" max="1" step="0.05" value="${cal.growth_weight}"></label>
      <label>Size power <b id="sb-size-v">${cal.size_power}</b><input type="range" id="sb-size" min="0" max="1.5" step="0.05" value="${cal.size_power}"></label>
      <div id="sb-out" class="eq"></div>
    </div>
    <div class="card"><h3>What this is not</h3>
      <p>No launch-probability score is shown: the snapshot contains no launch outcomes to fit or validate one against, so any such number would be invented.
      The category base rate on each detail view is a measured share, labelled as such.</p>
    </div>`;
  $('sb-growth').addEventListener('input', sandbox);
  $('sb-size').addEventListener('input', sandbox);
  sandbox();
}

/* ---------- wiring ---------- */
for (const id of ['q', 'f-cat', 'f-chain', 'f-band', 'f-watch', 'sort']) {
  $(id).addEventListener('input', renderBoard);
  $(id).addEventListener('change', renderBoard);
}
for (const btn of document.querySelectorAll('button.nav')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('button.nav')) b.classList.toggle('active', b === btn);
    for (const v of ['board', 'live', 'method']) $('view-' + v).hidden = v !== btn.dataset.view;
  });
}
/* Deep links for captures and sharing: #cat=Lending, #watch=1, #slug=gauntlet */
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('cat') && cats.includes(hash.get('cat'))) $('f-cat').value = hash.get('cat');
if (hash.get('watch') === '1') $('f-watch').checked = true;
$('asof').textContent = R.as_of;
$('subtitle').textContent = `Pre-token protocols ranked by implied value · model radar-3 · ${rows.length} protocols · snapshot ${R.as_of}`;
renderBoard();
renderLive();
renderMethod();
const startSlug = hash.get('slug') && rows.some((r) => r.slug === hash.get('slug')) ? hash.get('slug') : rows[0] && rows[0].slug;
if (startSlug) select(startSlug, false);
