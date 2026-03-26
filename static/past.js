(function () {
  'use strict';

  const PAGE_DEFAULTS = { race: 'race_detail.html', past: 'past_detail.html', betting: 'betting.html' };
  const state = {
    data: null,
    analysis: null,
    keyword: '',
    limit: 3,
    sameCourse: false,
    sameDistance: false,
    boardOnly: false,
    fastOnly: false,
    frontOnly: false,
    closerOnly: false,
    distanceUpOnly: false,
    distanceDownOnly: false,
    jockeyChangeOnly: false,
    layoffOnly: false,
    sortKey: 'umaban',
    expanded: new Set(),
    visibleRuns: {},
  };

  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  function getRA() {
    return window.RaceAnalysis || window.AC || createFallbackRA();
  }

  function createFallbackRA() {
    const toNum = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(String(v).replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    const fmt = (v, fb = '—') => (v == null || v === '' ? fb : String(v));
    const fmtNum = (v, d = 1, fb = '—') => {
      const n = toNum(v);
      return n == null ? fb : n.toFixed(d).replace(/\.0$/, '');
    };
    const fmtPct = (v, d = 1, fb = '—') => {
      const n = toNum(v);
      return n == null ? fb : `${(n * 100).toFixed(d).replace(/\.0$/, '')}%`;
    };
    const esc = (v) => String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const analyzeRaceHorses = (horses) => ({
      summary: {
        status: '混戦',
        comment: '過去走比較用の簡易表示',
        mainHorse: horses?.[0] || null,
        lineHorses: [],
        holeHorses: [],
        dangerHorses: [],
        popularSummary: [],
      },
      holeCandidates: [],
      dangerPopulars: [],
    });
    return { toNum, fmt, fmtNum, fmtPct, esc, escapeHtml: esc, analyzeRaceHorses };
  }

  function getDataRoot() { return document.body?.dataset?.dataRoot || './data'; }
  function getPage(kind) { return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind]; }

  function getQuery() {
    const p = new URLSearchParams(location.search);
    return { raceId: p.get('race_id'), date: p.get('date') };
  }

  function getJsonPath() {
    const { raceId, date } = getQuery();
    if (!raceId || !date) throw new Error('race_id と date をURLに入れてな。');
    return `${getDataRoot()}/${date}/race_${raceId}.json`;
  }

  function buildUrl(kind) {
    return `${getPage(kind)}?${new URLSearchParams({
      date: state.data?.race_date || getQuery().date || '',
      race_id: state.data?.race?.race_id || getQuery().raceId || '',
    }).toString()}`;
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`);
    return res.json();
  }

  function setStatus(msg, isError = false) {
    const el = qs('#past-status');
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle('is-error', !!isError);
  }

  function raceInfo() { return state.data?.race || {}; }
  function raceDistance() { return parseDistance(raceInfo().distance_m ?? raceInfo().distance); }
  function raceCourse() { return normalizeText(raceInfo().course); }

  function normalizeText(v) {
    return String(v ?? '').replace(/\s+/g, '').trim();
  }

  function parseDistance(v) {
    if (v == null || v === '') return null;
    const direct = getRA().toNum(v);
    if (direct != null) return direct;
    const m = String(v).match(/(\d{3,4})/);
    return m ? Number(m[1]) : null;
  }

  function parseDate(v) {
    if (!v) return null;
    const s = String(v).trim().replace(/\./g, '-').replace(/\//g, '-');
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
      const d = new Date(`${s}T00:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{8}$/.test(s)) {
      const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function diffDays(a, b) {
    if (!(a instanceof Date) || !(b instanceof Date)) return null;
    return Math.round((a.getTime() - b.getTime()) / 86400000);
  }

  function finishNum(v) {
    const n = getRA().toNum(String(v ?? '').replace(/着$/, ''));
    return Number.isFinite(n) ? n : null;
  }

  function meaningfulRuns(h) {
    const arr = Array.isArray(h.past_runs) ? h.past_runs : [];
    const out = arr.filter((run) => run && typeof run === 'object'
      && ['date', 'race_name', 'finish', 'last3f', 'distance_m', 'distance_text'].some((k) => run[k] != null && run[k] !== ''));
    if (out.length) return out;

    const fallback = [];
    for (let i = 1; i <= 20; i += 1) {
      const keys = Object.keys(h || {}).filter((k) => k.startsWith(`prev${i}_`));
      if (!keys.length) continue;
      const run = { n: i };
      keys.forEach((k) => {
        run[k.replace(`prev${i}_`, '')] = h[k];
      });
      if (['date', 'race_name', 'finish', 'last3f', 'distance'].some((key) => run[key] != null && run[key] !== '')) fallback.push(run);
    }
    return fallback;
  }

  function getRunCourse(run) { return normalizeText(run.course || run.course_name || run.jyo || ''); }
  function getRunDistance(run) { return parseDistance(run.distance_m ?? run.distance ?? run.distance_text); }

  function isSameDistance(run) {
    if (run.same_distance != null) return !!run.same_distance;
    const rd = raceDistance();
    const d = getRunDistance(run);
    return rd != null && d != null && rd === d;
  }

  function isSameCourse(run) {
    if (run.same_course != null) return !!run.same_course;
    const rc = raceCourse();
    const c = getRunCourse(run);
    return !!rc && !!c && rc === c;
  }

  function boardCount(runs, limit = state.limit) {
    return runs.slice(0, limit).filter((r) => {
      const n = finishNum(r.finish);
      return n != null && n <= 5;
    }).length;
  }

  function avgFinish(runs, limit = state.limit) {
    const xs = runs.slice(0, limit).map((r) => finishNum(r.finish)).filter((v) => Number.isFinite(v));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }

  function avgLast3f(runs, limit = state.limit) {
    const xs = runs.slice(0, limit).map((r) => getRA().toNum(r.last3f)).filter((v) => Number.isFinite(v));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }

  function detectStyleFromPassing(passing) {
    if (!passing) return '';
    const nums = String(passing).match(/\d+/g);
    if (!nums || !nums.length) return '';
    const first = Number(nums[0]);
    if (first <= 2) return '逃げ先行';
    if (first <= 5) return '先行差し';
    return '差し追込';
  }

  function detectStyle(h, runs) {
    const explicit = h.running_style || h.style || h.pace_style || '';
    if (explicit) return String(explicit);
    const recent = runs.slice(0, 3);
    const heads = recent.map((r) => detectStyleFromPassing(r.passing || r.corner || r.position)).filter(Boolean);
    if (!heads.length) return '—';
    if (heads.filter((v) => v.includes('逃げ') || v.includes('先行')).length >= 2) return '先行型';
    if (heads.filter((v) => v.includes('差し') || v.includes('追込')).length >= 2) return '差し型';
    return heads[0];
  }

  function detectLayoffDays(h, runs) {
    const direct = getRA().toNum(h.rest_days || h.layoff_days || h.days_since_last);
    if (direct != null) return direct;
    const raceDate = parseDate(state.data?.race_date);
    const prevDate = parseDate(runs[0]?.date);
    return diffDays(raceDate, prevDate);
  }

  function layoffText(days) {
    if (days == null) return '—';
    if (days >= 180) return '半年以上';
    if (days >= 120) return '長期休養';
    if (days >= 70) return '約2-4か月';
    if (days >= 35) return '中4-8週';
    if (days >= 14) return '中2-4週';
    return '間隔短め';
  }

  function detectDistanceChangeText(runs) {
    const cur = raceDistance();
    const prev = getRunDistance(runs[0] || {});
    if (cur == null || prev == null) return '—';
    if (cur > prev) return `延長 +${cur - prev}`;
    if (cur < prev) return `短縮 -${prev - cur}`;
    return '同距離';
  }

  function isDistanceUp(runs) {
    const cur = raceDistance();
    const prev = getRunDistance(runs[0] || {});
    return cur != null && prev != null && cur > prev;
  }

  function isDistanceDown(runs) {
    const cur = raceDistance();
    const prev = getRunDistance(runs[0] || {});
    return cur != null && prev != null && cur < prev;
  }

  function bloodText(h) {
    const sire = h.sire || h.father || '';
    const damsire = h.damsire || h.mf || h.mother_father || '';
    const parts = [sire, damsire].filter(Boolean);
    return parts.length ? parts.join(' × ') : '';
  }

  function horseSexAgeText(h) {
    if (h.sex_age != null && h.sex_age !== '') return String(h.sex_age);
    const sex = h.sex || h.sex_text || '';
    const age = h.age || h.horse_age || '';
    if (sex && age !== '') return `${sex}${age}`;
    if (sex) return String(sex);
    if (age !== '') return `${age}歳`;
    return '—';
  }

  function horseWeightText(h) {
    const ra = getRA();
    const weight = h.burden_weight ?? h.weight_carried ?? h.handicap ?? h.kinryo ?? h.assigned_weight ?? h.load_weight;
    const num = ra.toNum(weight);
    if (num != null) return `${ra.fmtNum(num, 1)}kg`;
    if (weight != null && weight !== '') return `${ra.fmt(weight)}kg`;
    return '斤量—';
  }

  function horseJockeyText(h) {
    const jockey = h.jockey ?? h.rider ?? h.jockey_name;
    return jockey != null && jockey !== '' ? String(jockey) : '騎手—';
  }

  function horseSubmetaText(h) {
    return [horseSexAgeText(h), horseWeightText(h), horseJockeyText(h)].join(' / ');
  }

  function jockeyChangeText(h, runs) {
    const now = normalizeText(h.jockey || h.rider || '');
    const prev = normalizeText(runs[0]?.jockey || runs[0]?.rider || '');
    if (!now || !prev) return '—';
    return now === prev ? '継続騎乗' : '騎手替わり';
  }

  function recentFinishSeq(runs) {
    const vals = runs.slice(0, 3).map((r) => finishNum(r.finish)).filter((v) => v != null);
    return vals.length ? vals.join('-') : '—';
  }

  function buildPrev1Brief(run) {
    if (!run) return '前走: データなし';
    const parts = [];
    const place = [run.course || run.course_name, (run.surface || ''), getRunDistance(run) ? `${getRunDistance(run)}m` : ''].filter(Boolean).join('');
    if (place) parts.push(place);
    if (run.going) parts.push(run.going);
    if (finishNum(run.finish) != null) parts.push(`${finishNum(run.finish)}着`);
    if (getRA().toNum(run.popularity) != null) parts.push(`${getRA().toNum(run.popularity)}人気`);
    if (getRA().toNum(run.last3f) != null) parts.push(`上${getRA().fmtNum(run.last3f, 1)}`);
    if (run.passing) parts.push(`通過${run.passing}`);
    return `前走: ${parts.join(' / ') || 'データなし'}`;
  }

  function buildRecent3Brief(runs) {
    const seq = recentFinishSeq(runs);
    const avgF = getRA().fmtNum(avgFinish(runs, 3), 1);
    const board = boardCount(runs, 3);
    const last3f = getRA().fmtNum(avgLast3f(runs, 3), 1);
    return `近3走: ${seq} / 平均${avgF} / 掲示板${board}回 / 上がり平均${last3f}`;
  }

  function detectRunTags(run) {
    const tags = [];
    if (isSameCourse(run)) tags.push({ text: '同コース', cls: 'tag--plus' });
    if (isSameDistance(run)) tags.push({ text: '同距離', cls: 'tag--plus' });

    const finish = finishNum(run.finish);
    if (finish != null && finish <= 3) tags.push({ text: `前${finish}着級`, cls: 'tag--blue' });

    const l3f = getRA().toNum(run.last3f);
    if (l3f != null && l3f <= 35.0) tags.push({ text: '上がり優秀', cls: 'tag--accent' });

    return tags;
  }

  function summarizedHorse(h) {
    const runs = meaningfulRuns(h);
    const layoffDays = detectLayoffDays(h, runs);
    const styleText = detectStyle(h, runs);
    const prevJockey = normalizeText(runs[0]?.jockey || runs[0]?.rider || '');
    const nowJockey = normalizeText(h.jockey || h.rider || '');

    return {
      horse: h,
      runs,
      board3: boardCount(runs, 3),
      avgFinish: avgFinish(runs, 3),
      avgLast3f: avgLast3f(runs, 3),
      sameCourseCount: runs.filter(isSameCourse).length,
      sameDistanceCount: runs.filter(isSameDistance).length,
      prev1Brief: buildPrev1Brief(runs[0]),
      recent3Brief: buildRecent3Brief(runs),
      styleText,
      layoffDays,
      layoffText: layoffText(layoffDays),
      bloodText: bloodText(h),
      submetaText: horseSubmetaText(h),
      distanceChangeText: detectDistanceChangeText(runs),
      jockeyChangeText: jockeyChangeText(h, runs),
      hasDistanceUp: isDistanceUp(runs),
      hasDistanceDown: isDistanceDown(runs),
      isFrontType: /逃げ|先行/.test(styleText),
      isCloserType: /差し|追込/.test(styleText),
      isLayoff: layoffDays != null && layoffDays >= 70,
      jockeyChanged: !!nowJockey && !!prevJockey && nowJockey !== prevJockey,
      totalRuns: runs.length,
    };
  }

  function matchSummary(obj) {
    const h = obj.horse;
    const kw = state.keyword.trim().toLowerCase();
    const name = String(h.horse_name || '').toLowerCase();

    if (kw && !name.includes(kw)) return false;
    if (state.sameCourse && obj.sameCourseCount <= 0) return false;
    if (state.sameDistance && obj.sameDistanceCount <= 0) return false;
    if (state.boardOnly && obj.board3 <= 0) return false;
    if (state.fastOnly && !(obj.avgLast3f != null && obj.avgLast3f <= 36.0)) return false;
    if (state.frontOnly && !obj.isFrontType) return false;
    if (state.closerOnly && !obj.isCloserType) return false;
    if (state.distanceUpOnly && !obj.hasDistanceUp) return false;
    if (state.distanceDownOnly && !obj.hasDistanceDown) return false;
    if (state.jockeyChangeOnly && !obj.jockeyChanged) return false;
    if (state.layoffOnly && !obj.isLayoff) return false;

    return true;
  }

  function compareSummary(a, b) {
    const ra = getRA();

    switch (state.sortKey) {
      case 'prev1_finish':
        return (finishNum(a.runs[0]?.finish) ?? 999) - (finishNum(b.runs[0]?.finish) ?? 999);
      case 'avg_finish':
        return (a.avgFinish ?? 999) - (b.avgFinish ?? 999);
      case 'avg_last3f':
        return (a.avgLast3f ?? 999) - (b.avgLast3f ?? 999);
      case 'same_distance':
        return (b.sameDistanceCount ?? -1) - (a.sameDistanceCount ?? -1);
      case 'same_course':
        return (b.sameCourseCount ?? -1) - (a.sameCourseCount ?? -1);
      case 'popularity':
        return (ra.toNum(a.horse.popularity) ?? 999) - (ra.toNum(b.horse.popularity) ?? 999);
      case 'course_score':
        return (ra.toNum(b.horse.course_score ?? b.horse.course_fit_score) ?? -999)
          - (ra.toNum(a.horse.course_score ?? a.horse.course_fit_score) ?? -999);
      case 'umaban':
      default:
        return (ra.toNum(a.horse.umaban) ?? 999) - (ra.toNum(b.horse.umaban) ?? 999);
    }
  }

  function renderLayout() {
    const root = qs('#past-app');
    if (!root) return;

    root.innerHTML = `
      <section class="past-page">
        <div id="past-status" class="page-status" hidden></div>

        <section id="past-hero" class="sheet race-hero"></section>

        <nav id="past-tabs" class="page-tab-strip"></nav>

        <section id="past-race-overview" class="sheet race-overview"></section>

        <section id="past-summary" class="sheet summary-panel"></section>

        <section class="sheet compare-toolbar">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">比較条件</h2>
              <div class="section-subtitle">絞り込みと並び替えで比較しやすくする。</div>
            </div>
            <div id="limit-row" class="page-tab-strip"></div>
          </div>

          <div class="compare-toolbar__grid compare-toolbar__grid--dense">
            <label class="filter-check"><input id="same-course" type="checkbox"> <span>同コース</span></label>
            <label class="filter-check"><input id="same-distance" type="checkbox"> <span>同距離</span></label>
            <label class="filter-check"><input id="board-only" type="checkbox"> <span>近3走掲示板内</span></label>
            <label class="filter-check"><input id="fast-only" type="checkbox"> <span>上がり優秀</span></label>
            <label class="filter-check"><input id="front-only" type="checkbox"> <span>逃げ先行</span></label>
            <label class="filter-check"><input id="closer-only" type="checkbox"> <span>差し追込</span></label>
            <label class="filter-check"><input id="distance-up-only" type="checkbox"> <span>距離延長</span></label>
            <label class="filter-check"><input id="distance-down-only" type="checkbox"> <span>距離短縮</span></label>
            <label class="filter-check"><input id="jockey-change-only" type="checkbox"> <span>騎手替わり</span></label>
            <label class="filter-check"><input id="layoff-only" type="checkbox"> <span>休み明け</span></label>
            <label class="filter-field compare-toolbar__search compare-toolbar__search--wide">
              <span>馬名検索</span>
              <input id="past-keyword" type="text" placeholder="馬名で検索">
            </label>
          </div>

          <div class="compare-toolbar__sort">
            <button type="button" class="segmented-btn" data-sort="umaban">馬番順</button>
            <button type="button" class="segmented-btn" data-sort="prev1_finish">前走着順</button>
            <button type="button" class="segmented-btn" data-sort="avg_finish">近走着順</button>
            <button type="button" class="segmented-btn" data-sort="avg_last3f">上がり</button>
            <button type="button" class="segmented-btn" data-sort="same_distance">同距離</button>
            <button type="button" class="segmented-btn" data-sort="same_course">同コース</button>
            <button type="button" class="segmented-btn" data-sort="popularity">人気順</button>
          </div>
        </section>

        <section class="sheet">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">過去走比較</h2>
              <div id="past-meta" class="section-subtitle"></div>
            </div>
          </div>

          <div id="past-list" class="past-list"></div>
        </section>

        <section id="past-bottom-panels" class="bottom-panels"></section>
      </section>`;
  }

  function renderHero() {
    const hero = qs('#past-hero');
    const race = raceInfo();
    const ra = getRA();

    hero.innerHTML = `
      <div class="race-hero__inner">
        <div>
          <div class="race-hero__date">${ra.escapeHtml(state.data?.race_date || '')}</div>
          <h1 class="race-hero__title">${ra.escapeHtml(race.course || '')} ${ra.escapeHtml(race.race_no || '')}R ${ra.escapeHtml(race.race_name || '')}</h1>
          <div class="race-hero__meta">${ra.escapeHtml([
            race.surface,
            race.distance ? `${race.distance}m` : (race.distance_m ? `${race.distance_m}m` : ''),
            race.headcount ? `${race.headcount}頭` : '',
            race.going || race.track_condition || '',
          ].filter(Boolean).join(' / '))}</div>
        </div>
        <div class="tag-list">
          <span class="tag tag--blue">過去走比較</span>
          <span class="tag">近走${state.limit}件表示</span>
        </div>
      </div>`;
  }

  function renderTabs() {
    const nav = qs('#past-tabs');
    const ra = getRA();
    nav.innerHTML = `
      <a class="race-tab" href="${ra.escapeHtml(buildUrl('race'))}">出走馬一覧</a>
      <a class="race-tab is-active" href="${ra.escapeHtml(buildUrl('past'))}">過去走比較</a>
      <a class="race-tab" href="${ra.escapeHtml(buildUrl('betting'))}">買い目作成</a>`;
  }

  function popularClass(label) {
    if (label === '信頼') return 'mini-pill mini-pill--trust';
    if (label === '危険') return 'mini-pill mini-pill--danger';
    if (label === 'やや危険') return 'mini-pill mini-pill--warn';
    return 'mini-pill mini-pill--plain';
  }

  function renderSummary() {
    const box = qs('#past-summary');
    const s = state.analysis?.summary || {};
    const ra = getRA();
    const holes = (state.analysis?.holeCandidates || []).slice(0, 3);
    const dangers = (state.analysis?.dangerPopulars || []).slice(0, 3);

    box.innerHTML = `
      <div class="section-title-row">
        <div>
          <h2 class="section-title">予想のまとめ</h2>
          <div class="section-subtitle">AI側の見立てを軽く確認してから、実データ比較に入る。</div>
        </div>
      </div>

      <div class="summary-grid summary-grid--2">
        <section class="summary-card">
          <div class="summary-card__head">
            <span class="badge ${s.status === '本命寄り' ? 'badge--blue' : s.status === '見送り寄り' ? 'badge--red' : 'badge--warn'}">${ra.escapeHtml(s.status || '混戦')}</span>
          </div>
          ${s.mainHorse ? `<div class="summary-main-horse">◎ ${ra.escapeHtml(s.mainHorse.umaban)} ${ra.escapeHtml(s.mainHorse.horse_name)}</div>
          <div class="summary-main-meta">勝率 ${ra.fmtPct(s.mainHorse.p_win)} / 複勝率 ${ra.fmtPct(s.mainHorse.p_top3)} / 単勝 ${ra.fmtNum(s.mainHorse.tansho_odds)} / 人気 ${ra.fmt(s.mainHorse.popularity)}</div>` : ''}
          <div class="summary-comment">${ra.escapeHtml(s.comment || '')}</div>
        </section>

        <section class="summary-card">
          <h3 class="mini-title">人気馬まとめ</h3>
          <div class="popular-summary-list">
            ${(s.popularSummary || []).slice(0, 5).map((p) => `
              <div class="popular-summary-item">
                <div>
                  <strong>${ra.escapeHtml(p.popularity)}人気 ${ra.escapeHtml(p.umaban)} ${ra.escapeHtml(p.horse_name)}</strong>
                  <div class="popular-summary-meta">${ra.escapeHtml(p.comment || '')}</div>
                </div>
                <span class="${popularClass(p.label)}">${ra.escapeHtml(p.label || '妥当')}</span>
              </div>`).join('') || '<div class="section-subtitle">人気上位データなし</div>'}
          </div>
        </section>
      </div>

      <div class="summary-grid summary-grid--2" style="margin-top:12px;">
        <section class="summary-card">
          <h3 class="mini-title">穴候補</h3>
          ${holes.length ? holes.map((h) => `<div class="summary-list-row"><strong>${ra.escapeHtml(h.umaban)} ${ra.escapeHtml(h.horse_name)}</strong><div class="summary-row-meta">${ra.escapeHtml(h._analysis?.hole_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}
        </section>
        <section class="summary-card">
          <h3 class="mini-title">危険人気</h3>
          ${dangers.length ? dangers.map((h) => `<div class="summary-list-row"><strong>${ra.escapeHtml(h.umaban)} ${ra.escapeHtml(h.horse_name)}</strong><div class="summary-row-meta">${ra.escapeHtml(h._analysis?.danger_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}
        </section>
      </div>`;
  }

  function renderRaceOverview(rows) {
    const box = qs('#past-race-overview');
    if (!box) return;

    const stats = {
      lastWin: rows.filter((r) => finishNum(r.runs[0]?.finish) === 1).length,
      sameDistance: rows.filter((r) => r.sameDistanceCount > 0).length,
      sameCourse: rows.filter((r) => r.sameCourseCount > 0).length,
      distanceUp: rows.filter((r) => r.hasDistanceUp).length,
      distanceDown: rows.filter((r) => r.hasDistanceDown).length,
      front: rows.filter((r) => r.isFrontType).length,
      closer: rows.filter((r) => r.isCloserType).length,
      board3: rows.filter((r) => r.board3 > 0).length,
      layoff: rows.filter((r) => r.isLayoff).length,
    };

    box.innerHTML = `
      <div class="section-title-row">
        <div>
          <h2 class="section-title">レース全体サマリー</h2>
          <div class="section-subtitle">比較の起点になる条件一致・近走傾向を先に確認。</div>
        </div>
      </div>

      <div class="overview-grid">
        <div class="overview-card"><span>前走1着馬</span><strong>${stats.lastWin}</strong></div>
        <div class="overview-card"><span>同距離経験</span><strong>${stats.sameDistance}</strong></div>
        <div class="overview-card"><span>同コース経験</span><strong>${stats.sameCourse}</strong></div>
        <div class="overview-card"><span>距離延長</span><strong>${stats.distanceUp}</strong></div>
        <div class="overview-card"><span>距離短縮</span><strong>${stats.distanceDown}</strong></div>
        <div class="overview-card"><span>逃げ先行型</span><strong>${stats.front}</strong></div>
        <div class="overview-card"><span>差し追込型</span><strong>${stats.closer}</strong></div>
        <div class="overview-card"><span>近3走掲示板内</span><strong>${stats.board3}</strong></div>
        <div class="overview-card"><span>休み明け</span><strong>${stats.layoff}</strong></div>
      </div>`;
  }

  function runCard(run) {
    const ra = getRA();
    const finish = finishNum(run.finish);
    const title = [run.course || run.course_name, run.race_name].filter(Boolean).join(' ');
    const line1 = [
      run.surface || '',
      getRunDistance(run) ? `${getRunDistance(run)}m` : (run.distance || ''),
      run.going || run.track_condition || '',
      run.headcount ? `${run.headcount}頭` : '',
    ].filter(Boolean).join(' / ');

    const line2 = [
      `人気 ${ra.fmt(run.popularity)}`,
      `単勝 ${ra.fmtNum(run.win_odds || run.tansho_odds, 1)}`,
      `上がり ${ra.fmtNum(run.last3f, 1)}`,
      run.passing ? `通過 ${run.passing}` : '',
    ].filter(Boolean).join(' / ');

    const line3 = [
      `騎手 ${ra.fmt(run.jockey || run.rider)}`,
      (run.weight_carried || run.handicap || run.kinryo) ? `${ra.fmt(run.weight_carried || run.handicap || run.kinryo)}kg` : '',
      `着差 ${ra.fmt(run.margin)}`,
      `タイム ${ra.fmt(run.time)}`,
      (run.body_weight || run.horse_weight)
        ? `馬体重 ${ra.fmt(run.body_weight || run.horse_weight)}${run.body_weight_diff != null ? `(${ra.fmt(run.body_weight_diff)})` : ''}`
        : '',
    ].filter(Boolean).join(' / ');

    const tags = detectRunTags(run);

    return `
      <article class="netkeiba-run-item">
        <div class="netkeiba-run-item__date">${ra.escapeHtml(run.date || '—')}</div>
        <div class="netkeiba-run-item__main">
          <div class="netkeiba-run-item__race"><strong>${ra.escapeHtml(title || '過去走')}</strong></div>
          <div class="netkeiba-run-item__sub">${ra.escapeHtml(line1 || '条件不明')}</div>
          <div class="netkeiba-run-item__meta">${ra.escapeHtml(line2)}</div>
          <div class="netkeiba-run-item__meta">${ra.escapeHtml(line3)}</div>
          ${tags.length ? `<div class="tag-list" style="margin-top:8px;">${tags.map((t) => `<span class="tag ${t.cls || ''}">${ra.escapeHtml(t.text)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="netkeiba-run-item__result ${finish != null && finish <= 3 ? 'is-good' : ''}">${ra.escapeHtml(ra.fmt(run.finish))}</div>
      </article>`;
  }

  function renderBottomPanels(rows) {
    const box = qs('#past-bottom-panels');
    if (!box) return;

    const ra = getRA();

    const topBy = (label, arr, mapFn) => `
      <section class="sheet bottom-panel">
        <div class="section-title-row">
          <div><h3 class="section-title">${label}</h3></div>
        </div>
        <div class="bottom-panel__list">
          ${arr.length ? arr.slice(0, 5).map(mapFn).join('') : '<div class="section-subtitle">該当馬なし</div>'}
        </div>
      </section>`;

    const sameCourse = rows
      .filter((r) => r.sameCourseCount > 0)
      .sort((a, b) => b.sameCourseCount - a.sameCourseCount || compareSummary(a, b));

    const sameDistance = rows
      .filter((r) => r.sameDistanceCount > 0)
      .sort((a, b) => b.sameDistanceCount - a.sameDistanceCount || compareSummary(a, b));

    const fastFinish = rows
      .filter((r) => r.avgLast3f != null)
      .sort((a, b) => (a.avgLast3f ?? 999) - (b.avgLast3f ?? 999));

    const layoff = rows
      .filter((r) => r.isLayoff)
      .sort((a, b) => (b.layoffDays ?? -1) - (a.layoffDays ?? -1));

    box.innerHTML = [
      topBy('同コース上位', sameCourse, (r) => `<div class="bottom-panel__item"><strong>${ra.escapeHtml(r.horse.umaban)} ${ra.escapeHtml(r.horse.horse_name)}</strong><span>同コース ${ra.escapeHtml(r.sameCourseCount)}走</span></div>`),
      topBy('同距離上位', sameDistance, (r) => `<div class="bottom-panel__item"><strong>${ra.escapeHtml(r.horse.umaban)} ${ra.escapeHtml(r.horse.horse_name)}</strong><span>同距離 ${ra.escapeHtml(r.sameDistanceCount)}走</span></div>`),
      topBy('上がり優秀馬', fastFinish, (r) => `<div class="bottom-panel__item"><strong>${ra.escapeHtml(r.horse.umaban)} ${ra.escapeHtml(r.horse.horse_name)}</strong><span>近3走 上がり平均 ${ra.escapeHtml(ra.fmtNum(r.avgLast3f, 1))}</span></div>`),
      topBy('休み明け注意', layoff, (r) => `<div class="bottom-panel__item"><strong>${ra.escapeHtml(r.horse.umaban)} ${ra.escapeHtml(r.horse.horse_name)}</strong><span>${ra.escapeHtml(r.layoffText)}</span></div>`),
    ].join('');
  }

  function sortLabel(key) {
    const map = {
      umaban: '馬番順',
      prev1_finish: '前走着順',
      avg_finish: '近走着順',
      avg_last3f: '上がり',
      same_distance: '同距離',
      same_course: '同コース',
      popularity: '人気順',
      course_score: '適性順',
    };
    return map[key] || key;
  }

  function renderList() {
    const list = qs('#past-list');
    const meta = qs('#past-meta');
    const allRows = (state.data.horses || []).map(summarizedHorse);
    const rows = allRows.filter(matchSummary).sort(compareSummary);
    const ra = getRA();

    renderRaceOverview(allRows);
    renderBottomPanels(allRows);

    meta.textContent = `${rows.length}頭表示 / 近走${state.limit}件 / 並び替え: ${sortLabel(state.sortKey)}`;

    list.innerHTML = rows.map((obj) => {
      const h = obj.horse;
      const key = String(h.horse_id || h.umaban || h.horse_name);
      const expanded = state.expanded.has(key);
      const visible = state.visibleRuns[key] || state.limit;
      const runs = obj.runs.slice(0, visible);

      const summaryTags = [
        { text: `同距離 ${obj.sameDistanceCount}`, cls: obj.sameDistanceCount > 0 ? 'tag--plus' : '' },
        { text: `同コース ${obj.sameCourseCount}`, cls: obj.sameCourseCount > 0 ? 'tag--plus' : '' },
        obj.styleText && obj.styleText !== '—' ? { text: obj.styleText, cls: '' } : null,
        obj.layoffText && obj.layoffText !== '—' ? { text: obj.layoffText, cls: obj.isLayoff ? 'tag--accent' : '' } : null,
        obj.distanceChangeText && obj.distanceChangeText !== '—'
          ? { text: obj.distanceChangeText, cls: /延長/.test(obj.distanceChangeText) ? 'tag--blue' : (/短縮/.test(obj.distanceChangeText) ? 'tag--warn' : '') }
          : null,
        { text: `全${obj.totalRuns}`, cls: '' },
      ].filter(Boolean).slice(0, 6);

      return `
        <article class="past-horse-card ${expanded ? 'is-open' : ''}">
          <button type="button" class="past-horse-card__summary" data-horse-key="${ra.escapeHtml(key)}">
            <div class="past-horse-card__main">
              <div class="past-horse-card__title-row">
                <div>
                  <div class="past-horse-card__title">${ra.escapeHtml(h.umaban)} ${ra.escapeHtml(h.horse_name)}</div>
                  <div class="past-horse-card__submeta">${ra.escapeHtml(obj.submetaText)}</div>
                  ${obj.bloodText ? `<div class="past-horse-card__blood">${ra.escapeHtml(obj.bloodText)}</div>` : ''}
                </div>
              </div>

              <div class="past-horse-card__brief">
                <div class="past-horse-card__brief-line">${ra.escapeHtml(obj.prev1Brief)}</div>
                <div class="past-horse-card__brief-line">${ra.escapeHtml(obj.recent3Brief)}</div>
                <div class="past-horse-card__brief-line">${ra.escapeHtml(`騎手: ${obj.jockeyChangeText}`)}</div>
              </div>
            </div>

            <div class="tag-list">
              ${summaryTags.map((t) => `<span class="tag ${t.cls || ''}">${ra.escapeHtml(t.text)}</span>`).join('')}
            </div>
          </button>

          <div class="past-horse-card__detail">
            ${runs.length ? runs.map(runCard).join('') : '<div class="section-subtitle">過去走データなし</div>'}
            <div class="horse-run-actions">
              ${obj.totalRuns > visible ? `<button type="button" class="action-link" data-more-runs="${ra.escapeHtml(key)}">さらに${Math.min(5, obj.totalRuns - visible)}件見る</button>` : ''}
              ${visible > state.limit ? `<button type="button" class="action-link" data-reset-runs="${ra.escapeHtml(key)}">${state.limit}件表示に戻す</button>` : ''}
            </div>
          </div>
        </article>`;
    }).join('') || '<div class="sheet empty-state">該当馬なし</div>';

    qsa('[data-horse-key]', list).forEach((btn) => btn.addEventListener('click', () => {
      const key = btn.dataset.horseKey;
      if (state.expanded.has(key)) state.expanded.delete(key);
      else state.expanded.add(key);

      if (!state.visibleRuns[key]) state.visibleRuns[key] = state.limit;
      renderList();
    }));

    qsa('[data-more-runs]', list).forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.moreRuns;
      state.visibleRuns[key] = (state.visibleRuns[key] || state.limit) + 5;
      renderList();
    }));

    qsa('[data-reset-runs]', list).forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.resetRuns;
      state.visibleRuns[key] = state.limit;
      renderList();
    }));
  }

  function bind() {
    const limitRow = qs('#limit-row');
    limitRow.innerHTML = [3, 5].map((n) => `<button type="button" class="segmented-btn${state.limit === n ? ' is-active' : ''}" data-limit="${n}">近${n}走</button>`).join('');

    qsa('[data-limit]', limitRow).forEach((btn) => btn.addEventListener('click', () => {
      state.limit = Number(btn.dataset.limit);
      state.visibleRuns = {};
      bind();
      renderHero();
      renderList();
    }));

    const checkboxMap = [
      ['#same-course', 'sameCourse'],
      ['#same-distance', 'sameDistance'],
      ['#board-only', 'boardOnly'],
      ['#fast-only', 'fastOnly'],
      ['#front-only', 'frontOnly'],
      ['#closer-only', 'closerOnly'],
      ['#distance-up-only', 'distanceUpOnly'],
      ['#distance-down-only', 'distanceDownOnly'],
      ['#jockey-change-only', 'jockeyChangeOnly'],
      ['#layoff-only', 'layoffOnly'],
    ];

    checkboxMap.forEach(([selector, key]) => {
      const el = qs(selector);
      if (!el) return;
      el.checked = !!state[key];
      el.onchange = (e) => {
        state[key] = !!e.target.checked;
        renderList();
      };
    });

    const keyword = qs('#past-keyword');
    keyword.value = state.keyword;
    keyword.oninput = (e) => {
      state.keyword = e.target.value || '';
      renderList();
    };

    qsa('[data-sort]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.sort === state.sortKey);
      btn.onclick = () => {
        state.sortKey = btn.dataset.sort;
        qsa('[data-sort]').forEach((x) => x.classList.toggle('is-active', x === btn));
        renderList();
      };
    });
  }

  async function init() {
    try {
      renderLayout();
      setStatus('過去走データを読み込み中…');

      state.data = await fetchJson(getJsonPath());

      const ra = getRA();
      state.analysis = ra.analyzeRaceHorses
        ? ra.analyzeRaceHorses(state.data.horses || [])
        : createFallbackRA().analyzeRaceHorses(state.data.horses || []);

      renderHero();
      renderTabs();
      //renderSummary();
      bind();
      renderList();

      document.title = `${state.data.race?.course || ''} ${state.data.race?.race_no || ''}R ${state.data.race?.race_name || ''} | 過去走比較`;

      const status = qs('#past-status');
      if (status) status.hidden = true;
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'past.js 初期化に失敗した', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
