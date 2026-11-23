// Token Launch Radar — model radar-3.
//
// Implied value for a protocol that records no token:
//   implied = TVL x category multiple x growth factor x maturity factor x size factor
//
// - Category multiple: geometric mean of mcap/TVL over live (token-bearing) protocols in the
//   same category, shrunk toward the global geometric-mean centre in log space with k = 5.
//   Multiples are winsorised to [0.01, 10]. Shrinkage applies whenever a category has at
//   least one live comp (a single comp is pulled strongly toward the centre, which is the
//   honest treatment for thin categories); only a category with no live comps at all falls
//   back to the global centre. The p25/p75 range uses the category's own quartiles when it
//   has at least 3 comps, and the global quartiles (rescaled) otherwise.
// - Growth factor: the 7-day TVL change (percent) clamped to [-50, +100], applied linearly
//   with weight 0.35: factor = 1 + 0.35 * clamped / 100.
// - Maturity factor: days since the protocol was first tracked, mapped 0.70 -> 1.00 and
//   saturating at two years. Unknown listing date scores as youngest (0.70).
// - Size factor: TVL-band geometric-mean multiple divided by the global centre, raised to
//   the power 0.75. Bands: < $50M, $50M-$500M, > $500M. On this snapshot the raw band ratios
//   are about x1.76 / x0.69 / x0.17 against a global centre of about 0.230x.
//
// The board is every protocol that records no token (mcap, gecko_id and symbol all null),
// minus wrapped / staked / bridge / exchange products and versioned re-deployments.
// The program also backtests itself on every run: live protocols are split by a slug hash,
// one half calibrates and the other half is predicted and scored honestly.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  [key: string]: unknown;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: string;
  rows: Record<string, unknown>[];
  live: Record<string, unknown>[];
  early_size: number;
  live_size: number;
  calibration: Record<string, unknown>;
  backtest: Record<string, unknown>;
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot is missing protocols or watchlist');
  }
  return raw;
}

const WINSOR_LO = 0.01;
const WINSOR_HI = 10;
const SHRINK_K = 5;
const MIN_COMPS = 3;
const GROWTH_WEIGHT = 0.35;
const SIZE_POWER = 0.75;

function winsor(x: number): number {
  return Math.min(WINSOR_HI, Math.max(WINSOR_LO, x));
}

function geomean(values: number[]): number {
  let s = 0;
  for (const v of values) s += Math.log(v);
  return Math.exp(s / values.length);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

export interface Calibration {
  global_centre: number;
  global_p25: number;
  global_p75: number;
  categories: Map<string, { n: number; centre: number; p25: number; p75: number; shrunk: number }>;
  bands: { label: string; lo: number; hi: number; raw_ratio: number; factor: number }[];
}

function bandIndex(tvl: number): number {
  if (tvl < 50_000_000) return 0;
  if (tvl < 500_000_000) return 1;
  return 2;
}

const BAND_DEFS = [
  { label: 'Under $50M', lo: 0, hi: 50_000_000 },
  { label: '$50M-$500M', lo: 50_000_000, hi: 500_000_000 },
  { label: 'Over $500M', lo: 500_000_000, hi: Number.POSITIVE_INFINITY },
];

export function calibrate(live: Protocol[]): Calibration {
  const multiples = live.map((p) => winsor(p.mcap_usd! / p.tvl_usd));
  const globalCentre = geomean(multiples);
  const sorted = [...multiples].sort((a, b) => a - b);
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(winsor(p.mcap_usd! / p.tvl_usd));
    byCategory.set(key, list);
  }
  const categories = new Map<string, { n: number; centre: number; p25: number; p75: number; shrunk: number }>();
  for (const [key, list] of byCategory) {
    const s = [...list].sort((a, b) => a - b);
    const centre = geomean(list);
    const shrunk = Math.exp((list.length * Math.log(centre) + SHRINK_K * Math.log(globalCentre)) / (list.length + SHRINK_K));
    categories.set(key, { n: list.length, centre, p25: quantile(s, 0.25), p75: quantile(s, 0.75), shrunk });
  }
  const bands = BAND_DEFS.map((def) => {
    const inBand = live.filter((p) => p.tvl_usd >= def.lo && p.tvl_usd < def.hi);
    const raw = inBand.length > 0 ? geomean(inBand.map((p) => winsor(p.mcap_usd! / p.tvl_usd))) / globalCentre : 1;
    return { label: def.label, lo: def.lo, hi: def.hi === Number.POSITIVE_INFINITY ? 0 : def.hi, raw_ratio: raw, factor: Math.pow(raw, SIZE_POWER) };
  });
  return { global_centre: globalCentre, global_p25: quantile(sorted, 0.25), global_p75: quantile(sorted, 0.75), categories, bands };
}

function growthFactor(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  const clamped = Math.min(100, Math.max(-50, change7d));
  return 1 + (GROWTH_WEIGHT * clamped) / 100;
}

function maturityFactor(listedAt: string | null, asOf: string): number {
  if (!listedAt) return 0.7;
  const days = Math.floor((Date.parse(asOf) - Date.parse(listedAt)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return 0.7;
  return 0.7 + 0.3 * Math.min(days / 730, 1);
}

export interface Scored {
  multiple: number;
  low_multiple: number;
  high_multiple: number;
  growth: number;
  maturity: number;
  size: number;
  comps: number;
  p25: number;
  p75: number;
}

export function scoreProtocol(p: Protocol, cal: Calibration, asOf: string): Scored {
  const cat = cal.categories.get(p.category ?? 'Uncategorised');
  const comps = cat ? cat.n : 0;
  const multiple = cat ? cat.shrunk : cal.global_centre;
  const growth = growthFactor(p.change_7d);
  const maturity = maturityFactor(p.listed_at, asOf);
  const size = cal.bands[bandIndex(p.tvl_usd)]!.factor;
  // Range: with at least MIN_COMPS comps, scale the category's own quartiles by the shrink
  // ratio; with fewer, rescale the global quartiles to this row's multiple.
  let p25: number;
  let p75: number;
  let low: number;
  let high: number;
  if (cat && comps >= MIN_COMPS) {
    p25 = cat.p25;
    p75 = cat.p75;
    low = p25 * (multiple / cat.centre);
    high = p75 * (multiple / cat.centre);
  } else {
    p25 = cal.global_p25;
    p75 = cal.global_p75;
    low = p25 * (multiple / cal.global_centre);
    high = p75 * (multiple / cal.global_centre);
  }
  return {
    multiple,
    low_multiple: Math.min(multiple, low),
    high_multiple: Math.max(multiple, high),
    growth,
    maturity,
    size,
    comps,
    p25,
    p75,
  };
}

function confidence(comps: number, p25: number, p75: number): string {
  const spread = p25 > 0 ? p75 / p25 : Number.POSITIVE_INFINITY;
  if (comps >= 10 && spread < 5) return 'High';
  if (comps >= 4 && spread < 20) return 'Med';
  return 'Low';
}

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function isTokenless(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isExcluded(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return true;
  if (/\s(v\d+(\.\d+)?|\d+\.\d+)$/i.test(p.name)) return true;
  return false;
}

export function isLive(p: Protocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

function farmSteps(p: Protocol): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const cat = p.category ?? 'DeFi';
  const core = p.tvl_usd >= 50_000_000 ? '$1,000-$5,000' : '$250-$1,000';
  return [
    `Create a fresh wallet for ${p.name} and fund it on ${chain} with ${core} plus about $30 of gas money; setup takes 20-30 minutes and costs only network fees.`,
    `Make a first real deposit or trade inside ${p.name} (${cat}) so the wallet records genuine usage, not a single test click; allow 15 minutes and expect $1-$10 in fees.`,
    `Repeat a small ${cat} action weekly for 6-8 weeks - deposit, borrow, swap or vote as the product allows - keeping each session under 10 minutes and fees under $5.`,
    `Hold a steady core position of ${core} in ${p.name} instead of churning it; snapshots usually reward duration and balance, and holding costs nothing but opportunity cost.`,
    `Join the official ${p.name} community channels and complete any public quests or testnet tasks; budget 30 minutes a week and never pay for boosts or points.`,
    `Track the position monthly: record balance, fees paid and any points shown, and stop adding funds if TVL or the team goes quiet for two straight months.`,
    `If a token launches, claim only through the official ${p.name} site linked from its verified channels, and sell or stake in tranches rather than all at once.`,
  ];
}

function slugHash(slug: string): number {
  // FNV-1a 32-bit: deterministic across runs and platforms.
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]): number[] => {
    const order = v.map((_, i) => i).sort((a, b) => v[a]! - v[b]!);
    const r = new Array<number>(v.length);
    order.forEach((idx, pos) => {
      r[idx] = pos;
    });
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

export interface Backtest {
  calibration_size: number;
  validation_size: number;
  median_error_factor: number;
  within_2x_pct: number;
  spearman: number;
  bias_factor: number;
}

export function runBacktest(snapshot: Snapshot): Backtest {
  const live = snapshot.protocols.filter(isLive);
  const calSet = live.filter((p) => slugHash(p.slug) % 2 === 0);
  const valSet = live.filter((p) => slugHash(p.slug) % 2 === 1);
  const cal = calibrate(calSet);
  const errors: number[] = [];
  const preds: number[] = [];
  const acts: number[] = [];
  for (const p of valSet) {
    const s = scoreProtocol(p, cal, snapshot.as_of);
    const predicted = p.tvl_usd * s.multiple * s.growth * s.maturity * s.size;
    errors.push(Math.log10(predicted / p.mcap_usd!));
    preds.push(predicted);
    acts.push(p.mcap_usd!);
  }
  const absSorted = errors.map(Math.abs).sort((a, b) => a - b);
  const medianAbs = absSorted.length % 2 === 1 ? absSorted[(absSorted.length - 1) / 2]! : (absSorted[absSorted.length / 2 - 1]! + absSorted[absSorted.length / 2]!) / 2;
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  return {
    calibration_size: calSet.length,
    validation_size: valSet.length,
    median_error_factor: Math.pow(10, medianAbs),
    within_2x_pct: (errors.filter((e) => Math.abs(e) <= Math.log10(2)).length / errors.length) * 100,
    spearman: spearman(preds, acts),
    bias_factor: Math.pow(10, mean),
  };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const live = snapshot.protocols.filter(isLive);
  const cal = calibrate(live);
  const backtest = runBacktest(snapshot);
  const watch = new Set(snapshot.watchlist);

  const categoryBaseRate = (category: string | null): number => {
    const inCat = snapshot.protocols.filter((p) => (p.category ?? 'Uncategorised') === (category ?? 'Uncategorised') && p.tvl_usd >= 5_000_000);
    if (inCat.length === 0) return 0;
    return inCat.filter((p) => p.mcap_usd !== null || p.symbol !== null).length / inCat.length;
  };

  const candidates = snapshot.protocols.filter((p) => isTokenless(p) && !isExcluded(p));
  const detailed = candidates.map((p) => {
    const s = scoreProtocol(p, cal, snapshot.as_of);
    const implied = Math.max(1, Math.round(p.tvl_usd * s.multiple * s.growth * s.maturity * s.size));
    const low = Math.max(1, Math.round(p.tvl_usd * s.low_multiple * s.growth * s.maturity * s.size));
    const high = Math.max(implied, Math.round(p.tvl_usd * s.high_multiple * s.growth * s.maturity * s.size));
    return { p, s, implied, low, high };
  });
  detailed.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));

  const board: BoardRow[] = detailed.map((d, i) => ({
    slug: d.p.slug,
    name: d.p.name,
    rank: i + 1,
    implied_value_usd: d.implied,
    farm_steps: farmSteps(d.p),
  }));

  const rows: Record<string, unknown>[] = detailed.map((d, i) => ({
    slug: d.p.slug,
    name: d.p.name,
    rank: i + 1,
    category: d.p.category,
    chains: d.p.chains,
    tvl_usd: d.p.tvl_usd,
    change_7d: d.p.change_7d,
    listed_at: d.p.listed_at,
    implied_value_usd: d.implied,
    range_low_usd: Math.min(d.low, d.implied),
    range_high_usd: d.high,
    multiple: d.s.multiple,
    growth_factor: d.s.growth,
    maturity_factor: d.s.maturity,
    size_factor: d.s.size,
    comps: d.s.comps,
    p25_multiple: d.s.p25,
    p75_multiple: d.s.p75,
    cat_centre: cal.categories.get(d.p.category ?? 'Uncategorised')?.centre ?? cal.global_centre,
    band_raw_ratio: cal.bands[d.p.tvl_usd < 50_000_000 ? 0 : d.p.tvl_usd < 500_000_000 ? 1 : 2]!.raw_ratio,
    confidence: confidence(d.s.comps, d.s.p25, d.s.p75),
    base_rate: categoryBaseRate(d.p.category),
    watchlist: watch.has(d.p.slug),
    farm_steps: farmSteps(d.p),
  }));

  const liveRows: Record<string, unknown>[] = live
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple: p.mcap_usd! / p.tvl_usd,
      symbol: p.symbol,
    }))
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: 'radar-3',
    rows,
    live: liveRows,
    early_size: rows.length,
    live_size: liveRows.length,
    calibration: {
      global_centre: cal.global_centre,
      global_p25: cal.global_p25,
      global_p75: cal.global_p75,
      bands: cal.bands.map((b) => ({ label: b.label, raw_ratio: b.raw_ratio, factor: b.factor })),
      shrink_k: SHRINK_K,
      size_power: SIZE_POWER,
      growth_weight: GROWTH_WEIGHT,
    },
    backtest: { ...backtest },
  };
  return { board, radar };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!slugs.has(r.slug)) return `invented slug ${r.slug}`;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug missing: ${slug}`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `ranks are not 1..N at ${i}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return 'implied value rises with rank';
    const steps = byRank[i]!.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${byRank[i]!.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${byRank[i]!.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(byRank[i]!.implied_value_usd) || byRank[i]!.implied_value_usd <= 0) return `${byRank[i]!.slug} has implied value ${byRank[i]!.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
