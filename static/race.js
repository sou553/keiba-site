(function () {
  'use strict';

  const PAGE_DEFAULTS = {
    race: 'race_detail.html',
    past: 'past_detail.html',
    betting: 'betting.html',
    home: 'index.html',
  };

  const state = {
    raw: null,
    data: null,
    filtered: [],
    sortKey: 'pred_order',
    sortDir: 'asc',
    keyword: '',
    onlyOdds: false,
    onlyDanger: false,
    onlyHole: false,
    openCards: new Set(),
    pastVisibleByCard: {},
  };

  const PLACE_MAP = {
    '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', '05': '東京',
    '06': '中山', '07': '中京', '08': '京都', '09': '阪神', '10': '小倉',
  };

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getRA() {
    return window.RaceAnalysis || window.AC || fallbackRA();
  }

  function fallbackRA() {
    const toNum = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const fmt = (v, fb = '—') => (v === null || v === undefined || v === '' ? fb : String(v));
    const fmtNum = (v, d = 1, fb = '—') => {
      const n = toNum(v);
      return n === null ? fb : n.toFixed(d).replace(/\.0$/, '');
    };
    const fmtPct = (v, d = 1, fb = '—') => {
      const n = toNum(v);
      return n === null ? fb : `${(n * 100).toFixed(d).replace(/\.0$/, '')}%`;
    };
    const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const analyzeRaceHorses = (horses) => ({
      horses: horses || [], sorted: horses || [], holeCandidates: [], dangerPopulars: [], popularSummary: [], courseValueList: [], courseDangerList: [],
      summary: { status: '混戦', reasons: [], comment: '簡易表示', mainHorse: null, lineHorses: [], holeHorses: [], dangerHorses: [], popularSummary: [] }
    });
    return { toNum, fmt, fmtNum, fmtPct, escapeHtml: esc, esc, analyzeRaceHorses };
  }

  function raToNum(v) { return getRA().toNum(v); }
  function fmt(v, fb = '—') { return getRA().fmt(v, fb); }
  function fmtNum(v, d = 1, fb = '—') { return getRA().fmtNum(v, d, fb); }
  function fmtPct01(v, d = 1, fb = '—') { return getRA().fmtPct(v, d, fb); }
  function escapeHtml(v) { return (getRA().escapeHtml || getRA().esc)(v); }
  function formatRank(v) { const n = raToNum(v); return n === null ? '—' : `${fmt(n)}位`; }

  function avg(arr) {
    const xs = arr.filter((v) => Number.isFinite(v));
    if (!xs.length) return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  function compareNullable(a, b, asc = true) {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    return asc ? a - b : b - a;
  }

  function getDataRoot() {
    return document.body?.dataset?.dataRoot || './data';
  }

  function getPage(kind) {
    return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind];
  }

  function getQuery() {
    const params = new URLSearchParams(location.search);
    return {
      raceId: params.get('race_id'),
      date: params.get('date'),
    };
  }

  function getJsonPath() {
    const { raceId, date } = getQuery();
    if (!raceId || !date) throw new Error('race_id と date を URL に入れてな。');
    return `${getDataRoot()}/${date}/race_${raceId}.json`;
  }

  function buildPageUrl(kind, race) {
    const params = new URLSearchParams({ date: state.data?.race_date || getQuery().date || '', race_id: race?.race_id || getQuery().raceId || '' });
    return `${getPage(kind)}?${params.toString()}`;
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`);
    return res.json();
  }

  function setStatus(msg, isError = false) {
    const root = qs('#race-status');
    if (!root) return;
    root.hidden = false;
    root.textContent = msg;
    root.classList.toggle('is-error', !!isError);
  }

  function clearStatus() {
    const root = qs('#race-status');
    if (!root) return;
    root.hidden = true;
    root.textContent = '';
    root.classList.remove('is-error');
  }

  function parseDistanceText(v) {
    const s = String(v || '').trim();
    if (!s) return { text: null, surface: null, distance: null };
    const m = s.match(/([芝ダ障])\s*([0-9]{3,4})/);
    return { text: s, surface: m ? m[1] : null, distance: m ? raToNum(m[2]) : null };
  }

  function normalizeSurface(v) {
    const s = String(v || '').trim();
    if (!s) return null;
    if (s.includes('ダ')) return 'ダート';
    if (s.includes('芝')) return '芝';
    if (s.includes('障')) return '障害';
    return s;
  }

  function detectPlaceName(v) {
    const s = String(v || '');
    if (!s) return '';
    for (const name of Object.values(PLACE_MAP)) {
      if (s.includes(name)) return name;
    }
    const rid = s.replace(/\D/g, '');
    if (rid.length >= 6) return PLACE_MAP[rid.slice(4, 6)] || '';
    return '';
  }

  function hasMeaningfulRun(run) {
    if (!run || typeof run !== 'object') return false;
    const keys = ['date', 'race_id', 'race_name', 'finish', 'win_odds', 'distance', 'going', 'last3f', 'passing'];
    return keys.some((k) => run[k] !== null && run[k] !== undefined && run[k] !== '');
  }

  function extractPastRunsCompat(horse, maxPrev = 20) {
    const existing = Array.isArray(horse.past_runs) ? horse.past_runs.filter(hasMeaningfulRun) : [];
    if (existing.length) return existing.map((run, idx) => normalizeRun(run, horse, idx + 1));

    const out = [];
    for (let i = 1; i <= maxPrev; i += 1) {
      const keys = Object.keys(horse).filter((key) => key.startsWith(`prev${i}_`));
      if (!keys.length) continue;
      const run = { n: i };
      keys.forEach((key) => { run[key.replace(`prev${i}_`, '')] = horse[key]; });
      if (hasMeaningfulRun(run)) out.push(normalizeRun(run, horse, i));
    }
    return out;
  }

  function normalizeRun(run, horse, idx) {
    const distanceInfo = parseDistanceText(run.distance || run.distance_text || run.distance_m);
    const raceId = String(run.race_id || '');
    const courseName = run.course_name || detectPlaceName(run.course_name || run.meeting || raceId);
    const currentSurface = normalizeSurface(horse.surface);
    const currentDistance = raToNum(horse.distance || horse.distance_m);
    const currentCourse = horse.course || detectPlaceName(horse.course_name || horse.race_id);
    const runSurface = normalizeSurface(run.surface || distanceInfo.surface);
    const runDistance = raToNum(run.distance_m || distanceInfo.distance);
    const sameDistance = currentDistance !== null && runDistance !== null && currentDistance === runDistance;
    const sameVenue = !!currentCourse && !!courseName && currentCourse === courseName;
    const sameCourse = !!currentCourse && !!courseName && sameDistance && currentCourse === courseName && (!currentSurface || !runSurface || currentSurface === runSurface);

    return {
      n: idx,
      date: run.date || null,
      race_id: raceId || null,
      race_name: run.race_name || null,
      race_no: run.race_no || null,
      course_name: courseName || null,
      weather: run.weather || null,
      field_size: raToNum(run.field_size),
      finish: raToNum(run.finish),
      popularity: raToNum(run.popularity),
      win_odds: raToNum(run.win_odds ?? run.tansho_odds),
      jockey: run.jockey || null,
      burden_weight: raToNum(run.burden_weight),
      surface: runSurface,
      distance_m: runDistance,
      distance_text: run.distance_text || distanceInfo.text || (runSurface && runDistance ? `${runSurface}${runDistance}` : null),
      going: run.going || null,
      same_venue: sameVenue,
      time: run.time || null,
      margin: run.margin || null,
      passing: run.passing || null,
      pace: run.pace || null,
      last3f: raToNum(run.last3f),
      horse_weight: run.horse_weight || null,
      horse_weight_diff: run.horse_weight_diff || null,
      same_distance: sameDistance,
      same_course: sameCourse,
    };
  }

  function normalizeReasonList(v) {
    if (Array.isArray(v)) return v.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
    if (typeof v !== 'string') return [];
    return v.split(/[|、,\n]/).map((s) => s.trim()).filter(Boolean);
  }


  function filterRaceDetailReasonTags(list) {
    return (list || []).filter((tag) => tag && !/^休み明け[:：]/.test(String(tag).trim()));
  }

  function calcRecentMetric(runs, predicate) {
    if (!runs.length) return 0;
    return runs.filter(predicate).length;
  }

  function prepareHorse(horse) {
    const runs = extractPastRunsCompat(horse, 20);
    const prev1 = runs[0] || null;
    const pWin = raToNum(horse.p_win);
    const pTop3 = raToNum(horse.p_top3);
    const predOrder = raToNum(horse.pred_order);
    const courseAdvRank = raToNum(horse.course_adv_rank);
    const popularity = raToNum(horse.popularity);
    const tanshoOdds = raToNum(horse.tansho_odds);
    const courseAdvScore = raToNum(horse.course_adv_score);
    const sameDistanceCount = calcRecentMetric(runs, (run) => run.same_distance);
    const sameCourseCount = calcRecentMetric(runs, (run) => run.same_course);
    const sameVenueCount = calcRecentMetric(runs, (run) => run.same_venue);
    const recentTop3Count = calcRecentMetric(runs.slice(0, 3), (run) => run.finish !== null && run.finish <= 3);
    const recentBoardCount = calcRecentMetric(runs.slice(0, 3), (run) => run.finish !== null && run.finish <= 5);
    const recentAvgFinish = avg(runs.slice(0, 3).map((run) => raToNum(run.finish)));
    const recentAvgLast3f = avg(runs.slice(0, 3).map((run) => raToNum(run.last3f)));

    const lastRaceDate = prev1?.date ? new Date(prev1.date) : null;
    const raceDate = state.raw?.race_date ? new Date(`${state.raw.race_date.slice(0,4)}-${state.raw.race_date.slice(4,6)}-${state.raw.race_date.slice(6,8)}`) : null;
    const layoffDays = lastRaceDate && raceDate && !Number.isNaN(lastRaceDate.valueOf()) && !Number.isNaN(raceDate.valueOf()) ? Math.floor((raceDate - lastRaceDate) / 86400000) : null;

    return {
      ...horse,
      past_runs: runs,
      _norm: {
        p_win: pWin,
        p_top3: pTop3,
        pred_order: predOrder,
        course_adv_rank: courseAdvRank,
        popularity,
        tansho_odds: tanshoOdds,
        course_adv_score: courseAdvScore,
        same_distance_count: sameDistanceCount,
        same_course_count: sameCourseCount,
        same_venue_count: sameVenueCount,
        recent_top3_count: recentTop3Count,
        recent_board_count: recentBoardCount,
        recent_avg_finish: recentAvgFinish,
        recent_avg_last3f: recentAvgLast3f,
        layoff_days: layoffDays,
        reasons_pos_list: normalizeReasonList(horse.reasons_pos),
        reasons_pos_display: filterRaceDetailReasonTags(normalizeReasonList(horse.reasons_pos)),
        reasons_neg_list: normalizeReasonList(horse.reasons_neg),
        style_est: horse.style || horse.style_est || null,
        memo_year_sex: extractTaggedValue(normalizeReasonList(horse.reasons_pos), [/^(?:年齢性別|性齢)[:：](.+)$/]) || formatSexAgeForMemo(horse.sex_age),
        memo_same_course: extractTaggedValue(normalizeReasonList(horse.reasons_pos), [/^同コース経験[:：](.+)$/]) || formatExperienceCount(sameCourseCount),
        memo_same_venue: extractTaggedValue(normalizeReasonList(horse.reasons_pos), [/^同競馬場経験[:：](.+)$/]) || formatExperienceCount(sameVenueCount),
      },
    };
  }

  function getModelRank(horse, year) {
    return horse.model_scores?.[year]?.rank ?? horse[`rank_${year}`] ?? horse[`pred_rank_${year}`] ?? horse[`ai_rank_${year}`] ?? null;
  }
  function getModelScore(horse, year) {
    return horse.model_scores?.[year]?.score ?? horse[`_pwin_softmax_${year}`] ?? horse[`pwin_softmax_${year}`] ?? horse[`score_${year}`] ?? horse[`_score_${year}`] ?? null;
  }

  function detectModelYears(horses, rawYears) {
    const base = Array.isArray(rawYears) && rawYears.length ? rawYears.map(String) : [];
    ['2008', '2015', '2019'].forEach((year) => {
      if (base.includes(year)) return;
      if (horses.some((h) => getModelRank(h, year) !== null || getModelScore(h, year) !== null)) base.push(year);
    });
    return base;
  }

  function ensureModelRanks(horses, years) {
    (years || []).forEach((year) => {
      const scored = horses
        .map((horse, idx) => ({ horse, idx, score: raToNum(getModelScore(horse, year)), rank: raToNum(getModelRank(horse, year)) }))
        .filter((item) => item.score !== null || item.rank !== null);
      if (!scored.length) return;

      scored.forEach((item) => {
        item.horse.model_scores = item.horse.model_scores || {};
        item.horse.model_scores[year] = item.horse.model_scores[year] || {};
        if (item.score !== null && item.horse.model_scores[year].score == null) item.horse.model_scores[year].score = item.score;
        if (item.rank !== null && item.horse.model_scores[year].rank == null) item.horse.model_scores[year].rank = item.rank;
      });

      const needFill = scored.some((item) => item.rank === null);
      if (!needFill) return;

      const ranked = scored
        .filter((item) => item.score !== null)
        .sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

      let displayRank = 0;
      let lastScore = null;
      ranked.forEach((item, pos) => {
        if (lastScore === null || item.score !== lastScore) displayRank = pos + 1;
        item.horse.model_scores[year].rank = displayRank;
        lastScore = item.score;
      });
    });
  }

  function prepareRaceData(raw) {
    const race = raw.race || {};
    const horses = (raw.horses || []).map(prepareHorse);
    const modelYears = detectModelYears(horses, raw.modelYears);
    ensureModelRanks(horses, modelYears);
    return {
      race_date: raw.race_date,
      race,
      horses,
      summary: raw.summary || {},
      modelYears,
    };
  }

  function analyzeRace(prepared) {
    const analysis = getRA().analyzeRaceHorses(prepared.horses || []);
    return {
      ...prepared,
      ...analysis,
      horses: analysis.horses || prepared.horses,
    };
  }

  function baseLayout() {
    const root = qs('#race-app');
    if (!root) return;
    root.innerHTML = `
      <div class="race-page page-race">
        <div id="race-status" class="page-status" hidden></div>
        <section id="race-hero" class="sheet race-hero"></section>
        <section id="prediction-summary" class="sheet summary-panel"></section>
        <section id="divergence-panel" class="sheet divergence-panel"></section>
        <section id="skip-panel" class="sheet skip-panel"></section>
        <section class="sheet horse-list-section">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">出走馬一覧</h2>
              <div class="section-subtitle">人気・単勝・AI順位・適性順位・確率を表っぽく一覧比較。行を開くと予想メモと過去走を縦に確認。</div>
            </div>
            <div id="horse-list-note" class="section-subtitle"></div>
          </div>
          <div id="filter-bar" class="race-filter-bar"></div>
          <div id="filter-meta" class="section-subtitle" style="margin:0 0 10px;"></div>
          <div id="horse-list" class="horse-table-wrap"></div>
        </section>
      </div>`;
  }

  function renderHero(data) {
    const hero = qs('#race-hero');
    if (!hero) return;
    const race = data.race || {};
    const title = [race.course || '', race.race_no ? `${race.race_no}R` : '', race.race_name || ''].filter(Boolean).join(' ');
    hero.innerHTML = `
      <div class="race-hero__inner">
        <div>
          <div class="race-hero__date">${escapeHtml(data.race_date || '')}</div>
          <h1 class="race-hero__title">${escapeHtml(title || 'レース詳細')}</h1>
          <div class="race-hero__meta">${escapeHtml([
            race.surface || '',
            race.distance ? `${race.distance}m` : '',
            race.headcount ? `${race.headcount}頭` : '',
          ].filter(Boolean).join(' / '))}</div>
        </div>
        <nav class="page-tab-strip race-hero__tabs">
          <a class="race-tab is-active" href="${escapeHtml(buildPageUrl('race', race))}">出走馬一覧</a>
          <a class="race-tab" href="${escapeHtml(buildPageUrl('past', race))}">過去走比較</a>
          <a class="race-tab" href="${escapeHtml(buildPageUrl('betting', race))}">買い目作成</a>
        </nav>
      </div>`;
    document.title = `${title || 'レース詳細'} | 予想整理サイト`;
  }

  function badgeClassByLabel(label) {
    if (!label) return 'badge badge--plain';
    if (label.includes('穴')) return 'badge badge--green';
    if (label.includes('危険')) return 'badge badge--red';
    if (label === '信頼') return 'badge badge--green';
    if (label === '妥当') return 'badge badge--plain';
    if (label === 'やや危険') return 'badge badge--warn';
    if (label.includes('本命')) return 'badge badge--blue';
    return 'badge badge--plain';
  }

  function popularLabelClass(label) {
    if (label === '信頼') return 'mini-pill mini-pill--trust';
    if (label === '危険') return 'mini-pill mini-pill--danger';
    if (label === 'やや危険') return 'mini-pill mini-pill--warn';
    return 'mini-pill mini-pill--plain';
  }

  function renderPredictionSummary(data) {
    const root = qs('#prediction-summary');
    if (!root) return;
    const s = data.summary || {};
    const main = s.mainHorse;
    const lines = s.lineHorses || [];
    const holes = (data.holeCandidates || []).slice(0, 3);
    const dangers = (data.dangerPopulars || []).slice(0, 3);
    const populars = s.popularSummary || [];
    root.innerHTML = `
      <div class="section-title-row">
        <div>
          <h2 class="section-title">予想まとめ</h2>
          <div class="section-subtitle">本命・相手本線・穴候補・危険な人気馬を先に確認。</div>
        </div>
        <span class="badge ${s.status === '本命寄り' ? 'badge--blue' : s.status === '見送り寄り' ? 'badge--red' : 'badge--warn'}">${escapeHtml(s.status || '混戦')}</span>
      </div>
      <div class="summary-grid summary-grid--2">
        <section class="summary-card summary-card--main">
          ${main ? `
            <div class="summary-main-mark">◎</div>
            <div class="summary-main-horse">${escapeHtml(main.umaban)} ${escapeHtml(main.horse_name)}</div>
            <div class="summary-main-metrics">
              <span class="badge badge--blue">AI ${escapeHtml(fmt(main.pred_order))}</span>
              <span class="badge badge--plain">人気 ${escapeHtml(fmt(main.popularity))}</span>
              <span class="badge badge--plain">単勝 ${escapeHtml(fmtNum(main.tansho_odds, 1))}</span>
              <span class="badge badge--green">勝率 ${escapeHtml(fmtPct01(main.p_win))}</span>
              <span class="badge badge--green">複勝率 ${escapeHtml(fmtPct01(main.p_top3))}</span>
            </div>` : '<div class="section-subtitle">本命データなし</div>'}
          <div class="summary-comment">${escapeHtml(s.comment || '')}</div>
          <div class="summary-split-grid">
            <div class="summary-mini-panel"><h3 class="mini-title">相手本線</h3>${lines.length ? lines.map((h, i) => `<div class="summary-list-row"><strong>${i === 0 ? '○' : '▲'} ${escapeHtml(h.umaban)} ${escapeHtml(h.horse_name)}</strong><div class="summary-row-meta">AI${escapeHtml(fmt(h.pred_order))} / 複勝率${escapeHtml(fmtPct01(h.p_top3))}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}</div>
            <div class="summary-mini-panel"><h3 class="mini-title">危険な人気馬</h3>${dangers.length ? dangers.map((h) => `<div class="summary-list-row"><strong>${escapeHtml(h.umaban)} ${escapeHtml(h.horse_name)}</strong><div class="summary-row-meta">${escapeHtml(h._analysis?.danger_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}</div>
          </div>
        </section>
        <section class="summary-card">
          <h3 class="mini-title">人気馬まとめ</h3>
          <div class="popular-summary-list">
            ${populars.length ? populars.map((p) => `<div class="popular-summary-item"><div><strong>${escapeHtml(fmt(p.popularity))}人気 ${escapeHtml(p.umaban)} ${escapeHtml(p.horse_name)}</strong><div class="popular-summary-meta">${escapeHtml(p.comment || '')}</div></div><span class="${popularLabelClass(p.label)}">${escapeHtml(p.label || '妥当')}</span></div>`).join('') : '<div class="section-subtitle">人気上位データなし</div>'}
          </div>
          <div class="summary-mini-panel" style="margin-top:14px;"><h3 class="mini-title">穴候補</h3>${holes.length ? holes.map((h) => `<div class="summary-list-row"><strong>${escapeHtml(h.umaban)} ${escapeHtml(h.horse_name)}</strong><div class="summary-row-meta">${escapeHtml(h._analysis?.hole_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}</div>
          <div class="summary-mini-panel" style="margin-top:14px;"><h3 class="mini-title">判定理由</h3>${(s.reasons || []).length ? `<ul class="summary-reason-list">${s.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : '<div class="section-subtitle">補足なし</div>'}</div>
        </section>
      </div>`;
  }

  function renderDivergence(data) {
    const root = qs('#divergence-panel');
    if (!root) return;
    const aiValue = (data.holeCandidates || []).filter((h) => (h.popularity ?? 999) >= 6 && (h.popularity - h.pred_order) >= 5 && (h.pred_order ?? 999) <= 3).slice(0, 3);
    const aiDanger = (data.dangerPopulars || []).filter((h) => (h.popularity ?? 999) <= 5 && ((h.pred_order ?? 0) - (h.popularity ?? 0)) >= 5).slice(0, 3);
    const courseValue = (data.courseValueList || []).filter((h) => (h.popularity ?? 999) >= 6 && (h.popularity - h.course_adv_rank) >= 5 && (h.course_adv_rank ?? 999) <= 3).slice(0, 3);
    const courseDanger = (data.courseDangerList || []).filter((h) => (h.popularity ?? 999) <= 5 && ((h.course_adv_rank ?? 0) - (h.popularity ?? 0)) >= 5).slice(0, 3);
    root.innerHTML = `
      <div class="section-title-row"><div><h2 class="section-title">人気馬の乖離</h2><div class="section-subtitle">人気と AI / 適性順位のズレを独立表示。</div></div></div>
      <div class="divergence-grid">
        ${renderGapBox('人気 × AI順位', '妙味馬', aiValue, '危険人気馬', aiDanger, 'pred_order')}
        ${renderGapBox('人気 × 適性順位', 'コース向きで人気薄', courseValue, '人気先行で適性弱い', courseDanger, 'course_adv_rank')}
      </div>`;
  }

  function renderGapBox(title, positiveTitle, positiveItems, negativeTitle, negativeItems, compareKey) {
    const renderItem = (h, sign) => {
      const gap = compareKey === 'pred_order' ? ((h.popularity ?? 0) - (h.pred_order ?? 0)) : ((h.popularity ?? 0) - (h.course_adv_rank ?? 0));
      const rankVal = compareKey === 'pred_order' ? h.pred_order : h.course_adv_rank;
      return `<div class="gap-item"><div><div class="gap-item__name">${escapeHtml(h.umaban)} ${escapeHtml(h.horse_name)}</div><div class="gap-item__meta">人気${escapeHtml(fmt(h.popularity))} / ${compareKey === 'pred_order' ? `AI${escapeHtml(fmt(rankVal))}` : `適性${escapeHtml(fmt(rankVal))}`} / 複勝率${escapeHtml(fmtPct01(h.p_top3))}</div></div><span class="gap-pill ${sign > 0 ? 'gap-pill--plus' : 'gap-pill--minus'}">${sign > 0 ? '+' : ''}${escapeHtml(fmt(gap))}</span></div>`;
    };
    return `
      <section class="gap-box">
        <h3 class="mini-title">${escapeHtml(title)}</h3>
        <div class="gap-group"><div class="gap-group__title">${escapeHtml(positiveTitle)}</div>${positiveItems.length ? positiveItems.map((h) => renderItem(h, +1)).join('') : '<div class="section-subtitle">該当馬なし</div>'}</div>
        <div class="gap-group"><div class="gap-group__title">${escapeHtml(negativeTitle)}</div>${negativeItems.length ? negativeItems.map((h) => renderItem(h, -1)).join('') : '<div class="section-subtitle">該当馬なし</div>'}</div>
      </section>`;
  }

  function renderSkipPanel(data) {
    const root = qs('#skip-panel');
    if (!root) return;
    const s = data.summary || {};
    root.innerHTML = `
      <div class="section-title-row"><div><h2 class="section-title">見送り判定</h2><div class="section-subtitle">人気・AI・適性・確率のバランスから判定。</div></div><span class="badge ${s.status === '見送り寄り' ? 'badge--red' : s.status === '本命寄り' ? 'badge--blue' : 'badge--warn'}">${escapeHtml(s.status || '混戦')}</span></div>
      <div class="skip-reason-list">${(s.reasons || []).length ? (s.reasons || []).map((r) => `<div class="skip-reason-item">${escapeHtml(r)}</div>`).join('') : '<div class="section-subtitle">大きな見送り理由なし</div>'}</div>`;
  }

  function renderFilters() {
    const root = qs('#filter-bar');
    if (!root) return;
    root.innerHTML = `
      <div class="race-filter-grid">
        <label class="filter-field"><span>キーワード</span><input id="horse-filter-keyword" type="text" placeholder="馬名・騎手・父名"></label>
        <label class="filter-check"><input id="horse-filter-odds" type="checkbox"> <span>単勝オッズあり</span></label>
        <label class="filter-check"><input id="horse-filter-danger" type="checkbox"> <span>危険人気だけ</span></label>
        <label class="filter-check"><input id="horse-filter-hole" type="checkbox"> <span>穴候補だけ</span></label>
      </div>
      <div class="horse-sort-bar">
        <button type="button" class="sort-chip ${state.sortKey === 'umaban' ? 'is-active' : ''}" data-sort="umaban">馬番</button>
        <button type="button" class="sort-chip ${state.sortKey === 'pred_order' ? 'is-active' : ''}" data-sort="pred_order">AI順</button>
        <button type="button" class="sort-chip ${state.sortKey === 'course_adv_rank' ? 'is-active' : ''}" data-sort="course_adv_rank">適性順</button>
        <button type="button" class="sort-chip ${state.sortKey === 'popularity' ? 'is-active' : ''}" data-sort="popularity">人気順</button>
        <button type="button" class="sort-chip ${state.sortKey === 'tansho_odds' ? 'is-active' : ''}" data-sort="tansho_odds">単勝順</button>
        <button type="button" class="sort-chip ${state.sortKey === 'p_top3' ? 'is-active' : ''}" data-sort="p_top3">複勝率順</button>
      </div>`;

    qs('#horse-filter-keyword', root).value = state.keyword;
    qs('#horse-filter-odds', root).checked = state.onlyOdds;
    qs('#horse-filter-danger', root).checked = state.onlyDanger;
    qs('#horse-filter-hole', root).checked = state.onlyHole;

    qs('#horse-filter-keyword', root).addEventListener('input', (e) => { state.keyword = e.target.value || ''; applyFiltersAndRenderList(); });
    qs('#horse-filter-odds', root).addEventListener('change', (e) => { state.onlyOdds = !!e.target.checked; applyFiltersAndRenderList(); });
    qs('#horse-filter-danger', root).addEventListener('change', (e) => { state.onlyDanger = !!e.target.checked; applyFiltersAndRenderList(); });
    qs('#horse-filter-hole', root).addEventListener('change', (e) => { state.onlyHole = !!e.target.checked; applyFiltersAndRenderList(); });
    qsa('[data-sort]', root).forEach((btn) => btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      if (!key) return;
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = key === 'tansho_odds' || key === 'popularity' || key === 'umaban' ? 'asc' : 'asc'; }
      renderFilters();
      applyFiltersAndRenderList();
    }));
  }

  function horseMatchesFilter(horse) {
    const kw = state.keyword.trim().toLowerCase();
    if (kw) {
      const hay = [horse.horse_name, horse.jockey, horse.sire, horse.dam_sire].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    if (state.onlyOdds && horse._norm.tansho_odds === null) return false;
    if (state.onlyDanger && !horse._analysis.danger_label) return false;
    if (state.onlyHole && !horse._analysis.hole_label) return false;
    return true;
  }

  function compareHorses(a, b) {
    let av; let bv;
    switch (state.sortKey) {
      case 'pred_order': av = a._norm.pred_order; bv = b._norm.pred_order; return compareNullable(av, bv, state.sortDir === 'asc');
      case 'course_adv_rank': av = a._norm.course_adv_rank; bv = b._norm.course_adv_rank; return compareNullable(av, bv, state.sortDir === 'asc');
      case 'popularity': av = a._norm.popularity; bv = b._norm.popularity; return compareNullable(av, bv, state.sortDir === 'asc');
      case 'umaban': av = raToNum(a.umaban); bv = raToNum(b.umaban); return compareNullable(av, bv, state.sortDir === 'asc');
      case 'p_win': av = a._norm.p_win; bv = b._norm.p_win; return compareNullable(av, bv, state.sortDir !== 'asc');
      case 'p_top3': av = a._norm.p_top3; bv = b._norm.p_top3; return compareNullable(av, bv, state.sortDir !== 'asc');
      case 'tansho_odds': av = a._norm.tansho_odds; bv = b._norm.tansho_odds; return compareNullable(av, bv, state.sortDir === 'asc');
      default: return compareNullable(a._norm.pred_order, b._norm.pred_order, true) || compareNullable(a._norm.p_top3, b._norm.p_top3, false);
    }
  }

  function applyFiltersAndRenderList() {
    state.filtered = state.data.horses.filter(horseMatchesFilter).sort(compareHorses);
    const meta = qs('#filter-meta');
    if (meta) meta.textContent = `${state.filtered.length} / ${state.data.horses.length}頭表示`;
    const note = qs('#horse-list-note');
    if (note) note.textContent = `${state.data.summary.status || '混戦'} / 危険人気 ${state.data.dangerPopulars.length}頭 / 穴候補 ${state.data.holeCandidates.length}頭`;
    renderHorseList();
  }

  function buildLastRunBrief(horse) {
    const run = horse.past_runs[0];
    if (!run) return '近走データなし';
    const parts = [];
    if (run.finish !== null) parts.push(`前走${run.finish}着`);
    if (run.distance_text) parts.push(run.distance_text);
    if (run.going) parts.push(run.going);
    if (run.popularity !== null) parts.push(`${run.popularity}人気`);
    if (run.last3f !== null) parts.push(`上がり${fmtNum(run.last3f, 1)}`);
    return parts.join(' / ');
  }

  function buildRecentBrief(horse) {
    const recent = horse.past_runs.slice(0, 3);
    if (!recent.length) return '近3走データなし';
    const ranks = recent.map((run) => (run.finish !== null ? run.finish : '—')).join('-');
    const avgFinish = avg(recent.map((run) => raToNum(run.finish)));
    const avgLast3f = avg(recent.map((run) => raToNum(run.last3f)));
    const parts = [`近3走[${ranks}]`];
    if (avgFinish !== null) parts.push(`平均着順${fmtNum(avgFinish, 1)}`);
    if (avgLast3f !== null) parts.push(`上がり平均${fmtNum(avgLast3f, 1)}`);
    return parts.join(' / ');
  }

  function formatLayoff(days) {
    if (days === null) return '—';
    if (days <= 13) return '中1-2週';
    if (days <= 35) return '中2-5週';
    if (days <= 69) return '中6-9週';
    if (days <= 139) return '3-4か月';
    return '5か月以上';
  }

  function buildHorseMarks(horse) {
    const marks = [];
    if (horse._norm.pred_order === 1) marks.push('<span class="badge badge--blue">本命候補</span>');
    if (horse._analysis.popular_label) marks.push(`<span class="${badgeClassByLabel(horse._analysis.popular_label)}">${escapeHtml(horse._analysis.popular_label)}</span>`);
    if (horse._analysis.hole_label) marks.push(`<span class="${badgeClassByLabel(horse._analysis.hole_label)}">${escapeHtml(horse._analysis.hole_label)}</span>`);
    if (horse._analysis.danger_label) marks.push(`<span class="${badgeClassByLabel(horse._analysis.danger_label)}">${escapeHtml(horse._analysis.danger_label)}</span>`);
    if (horse._norm.style_est) marks.push(`<span class="badge badge--plain">${escapeHtml(horse._norm.style_est)}</span>`);
    return marks.join('');
  }

  function renderRunItem(run) {
    const distanceLabel = run.distance_text || [run.surface || '', run.distance_m ? `${run.distance_m}m` : ''].filter(Boolean).join('');
    const raceLabel = [run.course_name || '', run.race_name || ''].filter(Boolean).join(' ');
    return `
      <article class="netkeiba-run-item">
        <div class="netkeiba-run-item__date">${escapeHtml(fmt(run.date))}</div>
        <div class="netkeiba-run-item__main">
          <div class="netkeiba-run-item__race"><strong>${escapeHtml(raceLabel || '過去走')}</strong></div>
          <div class="netkeiba-run-item__sub">${escapeHtml([distanceLabel, run.going, run.weather].filter(Boolean).join(' / '))}</div>
          <div class="netkeiba-run-item__meta">人気 ${escapeHtml(fmt(run.popularity))} / 単勝 ${escapeHtml(fmtNum(run.win_odds, 1))} / 上がり ${escapeHtml(fmtNum(run.last3f, 1))} / 通過 ${escapeHtml(fmt(run.passing))}</div>
          <div class="netkeiba-run-item__meta">騎手 ${escapeHtml(fmt(run.jockey))} / 着差 ${escapeHtml(fmt(run.margin))} / タイム ${escapeHtml(fmt(run.time))}</div>
        </div>
        <div class="netkeiba-run-item__result ${run.finish !== null && run.finish <= 3 ? 'is-good' : ''}">${escapeHtml(fmt(run.finish))}</div>
      </article>`;
  }

  function buildPastRunsBlock(horse, cardId) {
    const total = horse.past_runs.length;
    const current = state.pastVisibleByCard[cardId] || Math.min(5, total || 5);
    const visible = horse.past_runs.slice(0, current);
    const canMore = total > current;
    return `
      <section class="horse-detail-section">
        <div class="horse-detail-section__head">
          <h4 class="detail-box__title">過去走</h4>
          <div class="section-subtitle">新しい順に縦表示 / ${escapeHtml(String(Math.min(current, total)))}件表示${total ? ` / 全${escapeHtml(String(total))}件` : ''}</div>
        </div>
        <div class="horse-run-list">${visible.length ? visible.map(renderRunItem).join('') : '<div class="section-subtitle">過去走データなし</div>'}</div>
        <div class="horse-run-actions">
          ${canMore ? `<button type="button" class="action-link" data-more-runs="${escapeHtml(cardId)}">さらに5件見る</button>` : ''}
          ${current > 5 ? `<button type="button" class="action-link" data-reset-runs="${escapeHtml(cardId)}">5件表示に戻す</button>` : ''}
          <a class="action-link" href="${escapeHtml(buildPageUrl('past', state.data.race))}">過去走比較ページへ</a>
        </div>
      </section>`;
  }

  function renderHorseList() {
    const root = qs('#horse-list');
    if (!root) return;
    if (!state.filtered.length) {
      root.innerHTML = '<div class="empty-panel">条件に合う馬が見つからへんかった。</div>';
      return;
    }

    const head = `
      <div class="horse-table-head">
        <div>馬番 / 馬名</div>
        <div>性齢</div>
        <div>騎手</div>
        <div>人気</div>
        <div>単勝</div>
        <div>AI</div>
        <div>適性</div>
        <div>勝率</div>
        <div>複勝率</div>
        <div>近走</div>
        <div>詳細</div>
      </div>`;

    root.innerHTML = `${head}<div class="horse-table-body">${state.filtered.map((horse) => {
      const cardId = `horse-${escapeHtml(String(horse.horse_id || horse.umaban || horse.horse_name))}`;
      const isOpen = state.openCards.has(cardId);
      const rowClass = [horse._analysis.danger_label ? 'is-danger' : '', horse._analysis.hole_label ? 'is-hole' : ''].filter(Boolean).join(' ');
      const tags = `${buildHorseMarks(horse)}${(horse._norm.reasons_pos_display || []).slice(0, 3).map((tag) => `<span class="tag tag--plus">${escapeHtml(tag)}</span>`).join('')}`;
      return `
        <div class="horse-table-row ${rowClass}" data-card-id="${cardId}">
          <div class="cell cell--name"><span class="horse-no-inline">${escapeHtml(fmt(horse.umaban))}</span><div><div class="horse-name-inline">${escapeHtml(horse.horse_name)}</div><div class="cell-note">${tags}</div></div></div>
          <div class="cell">${escapeHtml(fmt(horse.sex_age))}</div>
          <div class="cell">${escapeHtml(fmt(horse.jockey))}</div>
          <div class="cell cell--num">${escapeHtml(fmt(horse._norm.popularity))}</div>
          <div class="cell cell--num ${horse._norm.tansho_odds !== null && horse._norm.tansho_odds < 10 ? 'text-odds-hot' : ''}">${escapeHtml(fmtNum(horse._norm.tansho_odds, 1))}</div>
          <div class="cell cell--num">${escapeHtml(fmt(horse._norm.pred_order))}</div>
          <div class="cell cell--num">${escapeHtml(fmt(horse._norm.course_adv_rank))}</div>
          <div class="cell cell--num">${escapeHtml(fmtPct01(horse._norm.p_win))}</div>
          <div class="cell cell--num">${escapeHtml(fmtPct01(horse._norm.p_top3))}</div>
          <div class="cell"><div class="cell-note">${escapeHtml(buildRecentBrief(horse))}</div></div>
          <div class="cell cell--action"><button type="button" class="horse-toggle table-toggle" data-card-id="${cardId}">${isOpen ? '詳細を閉じる' : '詳細を見る'}</button></div>
        </div>
        <div class="horse-detail-row" ${isOpen ? '' : 'hidden'} data-detail-for="${cardId}">
          <div class="horse-detail-row__inner">
            <div class="horse-detail-grid horse-detail-grid--top">
              <div class="detail-box">
                <h4 class="detail-box__title">予想メモ</h4>
                <div class="detail-kv compact-kv">
                  <div class="detail-kv__item"><div class="detail-kv__label">前走要約</div><div class="detail-kv__value">${escapeHtml(buildLastRunBrief(horse))}</div></div>
                  <div class="detail-kv__item"><div class="detail-kv__label">近3走要約</div><div class="detail-kv__value">${escapeHtml(buildRecentBrief(horse))}</div></div>
                  <div class="detail-kv__item"><div class="detail-kv__label">危険人気理由</div><div class="detail-kv__value">${escapeHtml(horse._analysis.danger_reason || '—')}</div></div>
                  <div class="detail-kv__item"><div class="detail-kv__label">穴候補理由</div><div class="detail-kv__value">${escapeHtml(horse._analysis.hole_reason || '—')}</div></div>
                  <div class="detail-kv__item"><div class="detail-kv__label">年齢性別</div><div class="detail-kv__value">${escapeHtml(fmt(horse._norm.memo_year_sex))}</div></div>
                  <div class="detail-kv__item"><div class="detail-kv__label">同コース経験</div><div class="detail-kv__value">${escapeHtml(fmt(horse._norm.memo_same_course))}</div></div>
                  <div class="detail-kv__item"><div class="detail-kv__label">同競馬場経験</div><div class="detail-kv__value">${escapeHtml(fmt(horse._norm.memo_same_venue))}</div></div>
                  <div class="detail-kv__item"><div class="detail-kv__label">同距離 / 近3走掲示板</div><div class="detail-kv__value">${escapeHtml(fmt(horse._norm.same_distance_count))}走 / ${escapeHtml(fmt(horse._norm.recent_board_count))}回</div></div>
                </div>
              </div>
              <div class="detail-box">
                <h4 class="detail-box__title">モデル比較</h4>
                <div class="model-rank-list compact-model-list">
                  <div class="model-rank-item"><div><div class="model-rank-item__name">総合AI</div><div class="model-rank-item__meta">勝率 ${escapeHtml(fmtPct01(horse._norm.p_win))} / 複勝率 ${escapeHtml(fmtPct01(horse._norm.p_top3))}</div></div><div class="model-rank-item__rank">${escapeHtml(formatRank(horse._norm.pred_order))}</div></div>
                  <div class="model-rank-item"><div><div class="model-rank-item__name">コース適性</div><div class="model-rank-item__meta">スコア ${escapeHtml(fmtNum(horse._norm.course_adv_score, 1))}</div></div><div class="model-rank-item__rank">${escapeHtml(formatRank(horse._norm.course_adv_rank))}</div></div>
                  ${state.data.modelYears.map((year) => `<div class="model-rank-item"><div><div class="model-rank-item__name">${escapeHtml(year)}モデル</div><div class="model-rank-item__meta">スコア ${escapeHtml(fmtNum(getModelScore(horse, year), 3))}</div></div><div class="model-rank-item__rank">${escapeHtml(formatRank(getModelRank(horse, year)))}</div></div>`).join('')}
                </div>
              </div>
            </div>
            ${buildPastRunsBlock(horse, cardId)}
          </div>
        </div>`;
    }).join('')}</div>`;

    qsa('.horse-toggle', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        const cardId = btn.dataset.cardId;
        if (!cardId) return;
        if (state.openCards.has(cardId)) state.openCards.delete(cardId);
        else {
          state.openCards.add(cardId);
          if (!state.pastVisibleByCard[cardId]) {
            const horse = state.filtered.find((h) => `horse-${String(h.horse_id || h.umaban || h.horse_name)}` === cardId);
            state.pastVisibleByCard[cardId] = Math.min(5, horse?.past_runs?.length || 5);
          }
        }
        renderHorseList();
      });
    });
    qsa('[data-more-runs]', root).forEach((btn) => btn.addEventListener('click', () => {
      const cardId = btn.dataset.moreRuns;
      const horse = state.filtered.find((h) => `horse-${String(h.horse_id || h.umaban || h.horse_name)}` === cardId);
      const total = horse?.past_runs?.length || 0;
      state.pastVisibleByCard[cardId] = Math.min((state.pastVisibleByCard[cardId] || 5) + 5, total);
      renderHorseList();
    }));
    qsa('[data-reset-runs]', root).forEach((btn) => btn.addEventListener('click', () => {
      const cardId = btn.dataset.resetRuns;
      state.pastVisibleByCard[cardId] = 5;
      renderHorseList();
    }));
  }

  async function init() {
    baseLayout();
    setStatus('レース情報を読み込み中…');
    try {
      state.raw = await fetchJson(getJsonPath());
      const prepared = prepareRaceData(state.raw);
      state.data = analyzeRace(prepared);
      clearStatus();
      renderHero(state.data);
      renderPredictionSummary(state.data);
      renderDivergence(state.data);
      renderSkipPanel(state.data);
      renderFilters();
      applyFiltersAndRenderList();
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'race.js の初期化に失敗しました。', true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
