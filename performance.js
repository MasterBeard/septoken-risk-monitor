export const CUTOFFS = Object.freeze([70, 75, 80, 85]);
const PATHS = ['fused', 'continuous', 'discrete'];

export const performanceCopy = {
  zh: {
    eyebrow: '历史回顾', title: '三路径表现', event: '下一交易日跌超 1% 命中率',
    cutoff: '风险分数阈值（0–100）', option: value => `风险分数 ${value} 分及以上`,
    help: '同一阈值、同一批可核验记录；不同路径入选的信号数可能不同。',
    paths: { fused: '融合路径', continuous: '连续路径', discrete: '离散路径' },
    hits: '命中数', signals: '信号样本数', rate: '跌超 1% 命中率',
    baseline: '验证期事件基准', observed: '历史命中率', line: '基准线',
    noSamples: '暂无符合阈值的样本', waiting: '三路径统计暂不可用，等待数据更新。',
    summary: (evaluated, unique, start, end) => `统计区间：${start} 至 ${end} · ${unique} 条独立记录，${evaluated} 条可核验。`,
    baselineCount: (start, end, hits, samples) => `${start}–${end} 验证期 · ${hits} / ${samples} 个样本跌超 1%`,
    comparison: '时期与市场构成不同，基准仅供参考。',
    note: '命中率 = 达到所选风险阈值的信号中，下一交易所交易日收盘跌超 1% 的数量 ÷ 信号数。按市场和输入交易日保留最后一次记录，排除未收盘、缺失次日收盘和日历无法核验的样本。这是历史回顾，并非严格事前业绩；风险分数不是下跌概率。',
    periodEmpty: '尚无可核验区间', scale: '统一刻度：0–100%',
    announcement: (cutoff, values) => `阈值 ≥${cutoff}：${values.join('；')}`,
  },
  en: {
    eyebrow: 'HISTORICAL REVIEW', title: 'Three-path performance', event: 'Next-session >1% decline hit rate',
    cutoff: 'Risk-score cutoff (0–100)', option: value => `Risk score ${value} or above`,
    help: 'One cutoff and one evaluable cohort. Each path may select a different number of signals.',
    paths: { fused: 'Fusion', continuous: 'Continuous', discrete: 'Discrete' },
    hits: 'Hits', signals: 'Signal samples', rate: '>1% decline hit rate',
    baseline: 'Validation event baseline', observed: 'Historical hit rate', line: 'Baseline',
    noSamples: 'No signals at this cutoff', waiting: 'Three-path statistics are not available yet. Awaiting a data update.',
    summary: (evaluated, unique, start, end) => `Period: ${start} to ${end} · ${evaluated} evaluable observations from ${unique} unique records.`,
    baselineCount: (start, end, hits, samples) => `${start}–${end} validation period · ${hits} / ${samples} observations fell by more than 1%`,
    comparison: 'Different periods and market mixes limit comparability.',
    note: 'Hit rate = signals at the selected risk cutoff whose next exchange-session close fell by more than 1%, divided by selected signals. The last record per market/input session is retained. Unclosed sessions, missing next-session closes and unverified calendars are excluded. This is retrospective, not strictly prospective performance. Risk scores are not probabilities.',
    periodEmpty: 'No evaluable period yet', scale: 'Shared scale: 0–100%',
    announcement: (cutoff, values) => `Cutoff ≥${cutoff}: ${values.join('; ')}`,
  },
};

const isCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000;
const isRate = value => Number.isFinite(value) && value >= 0 && value <= 1;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const equalRate = (rate, hits, samples) => samples === 0 ? rate === null : isRate(rate) && Math.abs(rate - hits / samples) < 1e-9;

// A missing or inconsistent report must not turn into three invented zero rates.
export function comparisonModel(payload, cutoff) {
  if (!CUTOFFS.includes(cutoff)) return null;
  const report = payload?.monitoring_performance?.path_comparison;
  if (!report || report.schema_version !== 1 || report.source_run_id !== payload.run_id ||
      report.event !== 'next_session_return_lt_minus_0_01' || report.is_prospective !== false ||
      report.method !== 'latest_per_input_session_next_exchange_close' ||
      !isCount(report.unique_predictions) || !isCount(report.evaluable_predictions) ||
      report.evaluable_predictions > report.unique_predictions) return null;
  const exclusions = report.excluded_counts;
  if (!exclusions || typeof exclusions !== 'object' || Array.isArray(exclusions) ||
      Object.keys(exclusions).length > 16 || !Object.values(exclusions).every(isCount) ||
      Object.values(exclusions).reduce((a, b) => a + b, 0) + report.evaluable_predictions !== report.unique_predictions) return null;
  const start = report.evaluation_start_date, end = report.evaluation_end_date;
  if (report.evaluable_predictions ? !(validDate(start) && validDate(end) && start <= end) : start !== null || end !== null) return null;
  const b = report.baseline;
  if (!b || !isCount(b.hits) || !isCount(b.samples) || b.samples === 0 || b.hits > b.samples ||
      !equalRate(b.rate, b.hits, b.samples) || !validDate(b.period_start) || !validDate(b.period_end) || b.period_start > b.period_end) return null;
  if (!Array.isArray(report.paths) || report.paths.length !== 3 || new Set(report.paths.map(path => path.id)).size !== 3) return null;
  const rows = [];
  for (const id of PATHS) {
    const path = report.paths.find(path => path.id === id);
    if (!path || !Array.isArray(path.thresholds) || path.thresholds.length !== CUTOFFS.length) return null;
    for (const [index, row] of path.thresholds.entries()) {
      if (row.threshold !== CUTOFFS[index] / 100 || !isCount(row.signal_count) || !isCount(row.hit_count) ||
          row.hit_count > row.signal_count || row.signal_count > report.evaluable_predictions ||
          !equalRate(row.hit_rate, row.hit_count, row.signal_count)) return null;
    }
    rows.push({ id, ...path.thresholds[CUTOFFS.indexOf(cutoff)] });
  }
  return { cutoff, rows, baseline: b, start, end, evaluated: report.evaluable_predictions, unique: report.unique_predictions };
}

export function rateLabel(value, language = 'zh') {
  return value === null ? '—' : new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en', {
    style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

export function comparisonCards(model, language = 'zh') {
  const copy = performanceCopy[language] ?? performanceCopy.zh;
  const integer = new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en');
  return model.rows.map(row => `<article class="path-performance" data-path="${row.id}">
    <h3>${copy.paths[row.id]}</h3>
    <p class="path-rate"><strong>${rateLabel(row.hit_rate, language)}</strong><span>${row.hit_rate === null ? copy.noSamples : copy.rate}</span></p>
    <div class="path-track" aria-hidden="true"><i style="width:${(row.hit_rate ?? 0) * 100}%"></i><b style="left:${model.baseline.rate * 100}%"></b></div>
    <dl class="path-counts"><div><dt>${copy.hits}</dt><dd>${integer.format(row.hit_count)}</dd></div><div><dt>${copy.signals}</dt><dd>${integer.format(row.signal_count)}</dd></div></dl>
  </article>`).join('');
}

export function renderPerformance(payload, language, cutoff) {
  const copy = performanceCopy[language] ?? performanceCopy.zh;
  const model = comparisonModel(payload, cutoff);
  const text = (id, value) => { document.getElementById(id).textContent = value; };
  text('performance-eyebrow', copy.eyebrow);
  text('performance-title', copy.title);
  text('performance-event', copy.event);
  text('performance-cutoff-label', copy.cutoff);
  text('performance-filter-help', copy.help);
  text('downside-baseline-label', copy.baseline);
  text('performance-baseline-note', copy.comparison);
  text('performance-observed-label', copy.observed);
  text('performance-baseline-legend', copy.line);
  text('performance-scale', copy.scale);
  text('performance-note', copy.note);
  document.getElementById('performance-cutoff').disabled = !model;
  for (const radio of document.querySelectorAll('input[name="performance-cutoff"]')) {
    radio.checked = Number(radio.value) === cutoff;
    radio.setAttribute('aria-label', copy.option(Number(radio.value)));
  }
  const charts = document.getElementById('performance-charts');
  if (!model) {
    text('performance-summary', copy.waiting);
    text('downside-baseline', '—'); text('downside-baseline-count', '—');
    charts.replaceChildren();
    const empty = document.createElement('p'); empty.className = 'performance-empty'; empty.textContent = copy.waiting; charts.append(empty);
    text('performance-status', copy.waiting);
    return;
  }
  const number = value => new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en').format(value);
  text('performance-summary', model.start ? copy.summary(number(model.evaluated), number(model.unique), model.start, model.end) : copy.periodEmpty);
  text('downside-baseline', rateLabel(model.baseline.rate, language));
  text('downside-baseline-count', copy.baselineCount(model.baseline.period_start.slice(0, 4), model.baseline.period_end.slice(0, 4), number(model.baseline.hits), number(model.baseline.samples)));
  charts.innerHTML = comparisonCards(model, language);
  text('performance-status', copy.announcement(cutoff, model.rows.map(row => `${copy.paths[row.id]} ${row.hit_rate === null ? copy.noSamples : rateLabel(row.hit_rate, language)}`)));
}
