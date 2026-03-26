(function () {
  'use strict';

  const PAGE_DEFAULTS = { race: 'race_detail.html', past: 'past_detail.html', betting: 'betting.html' };
  const state = {
    data: null,
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
    const esc = (v) => String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    return { toNum, fmt, fmtNum, escapeHtml: esc };
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

  function normalizeText(v) {
    return String(v ?? '').replace(/\s+/g, '').trim();
  }

  function normalizeName(v) {
    return String(v ?? '')
      .replace(/[\s　]+/g, '')
      .replace(/[・･]/g, '')
      .replace(/\(.*?\)|（.*?）/g, '')
      .replace(/騎手/g, '')
      .trim();
  }

  function samePersonName(a, b) {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return null;
    return na === nb || na.includes(nb) || nb.includes(na);
  }

  function parseDateLoose(value) {
    if (!value) return null;
    const s = String(value).trim().replace(/[.]/g, '/').replace(/-/g, '/');
    const m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const c = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (c) {
      const d = new Date(Number(c[1]), Number(c[2]) - 1, Number(c[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function diffDays(a, b) {
    const da = parseDateLoose(a);
    const db = parseDateLoose(b);
    if (!da || !db) return null;
    return Math.round((da.getTime() - db.getTime()) / 86400000);
  }

  function raceInfo() { return state.data?.race || {}; }
  function raceDistance() { return parseDistance(raceInfo().distance_m ?? raceInfo().distance); }
  function raceCourse() { return normalizeText(raceInfo().course); }
  function raceDate() { return state.data?.race_date || raceInfo().race_date || raceInfo().date || getQuery().date; }

  function parseDistance(v) {
    if (v == null || v === '') return null;
    const direct = getRA().toNum(v);
    if (direct != null) return direct;
    const m = String(v).match(/(\d{3,4})/);
    return m ? Number(m[1]) : null;
  }

  function finishNum(v) {
    const n = getRA().toNum(String(v ?? '').replace(/着$/, ''));
    return Number.isFinite(n) ? n : null;
  }

  function splitReasons(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v));
    return String(value).split(/[\n、,，;；\/]+/).map((s) => s.trim()).filter(Boolean);
  }

  function avg(values) {
    const xs = values.filter((v) => Number.isFinite(v));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }

  function meaningfulRuns(h) {
    const arr = Array.isArray(h.past_runs) ? h.past_runs : [];
    const out = arr.filter((run) => run && typeof run === 'object' && ['date', 'race_name', 'finish', 'last3f', 'distance_m', 'distance_text'].some((k) => run[k] != null && run[k] !== ''));
    if (out.length) return out.map(normalizeRun);

    const fallback = [];
    for (let i = 1; i <= 20; i += 1) {
      const keys = Object.keys(h || {}).filter((k) => k.startsWith(`prev${i}_`));
      if (!keys.length) continue;
      const run = { n: i };
      keys.forEach((k) => { run[k.replace(`prev${i}_`, '')] = h[k]; });
      if (['date', 'race_name', 'finish', 'last3f', 'distance'].some((key) => run[key] != null && run[key] !== '')) fallback.push(normalizeRun(run));
    }
    return fallback;
  }

  function normalizeRun(run) {
    return {
      ...run,
      jockey: run.jockey || run.rider || run.jockey_name || '',
      distance_m: parseDistance(run.distance_m ?? run.distance ?? run.distance_text),
    };
  }

  function getRunCourse(run) {
    return normalizeText(run.course || run.course_name || run.jyo || '');
  }

  function isSameDistance(run) {
    if (run.same_distance != null) return !!run.same_distance;
    const rd = raceDistance();
    const d = parseDistance(run.distance_m ?? run.distance ?? run.distance_text);
    return rd != null && d != null && rd === d;
  }

  function isSameCourse(run) {
    if (run.same_course != null) return !!run.same_course;
    const rc = raceCourse();
    const c = getRunCourse(run);
    return !!rc && !!c && rc === c;
  }

  function avgFinish(runs, limit = state.limit) {
    return avg(runs.slice(0, limit).map((r) => finishNum(r.finish)));
  }

  function avgLast3f(runs, limit = state.limit) {
    return avg(runs.slice(0, limit).map((r) => getRA().toNum(r.last3f)));
  }

  function boardCount(runs, limit = state.limit) {
    return runs.slice(0, limit).filter((r) => {
      const n = finishNum(r.finish);
      return n != null && n <= 5;
    }).length;
  }

  function recentTop3Count(runs, limit = 3) {
    return runs.slice(0, limit).filter((r) => {
      const n = finishNum(r.finish);
      return n != null && n <= 3;
    }).length;
  }

  function detectStyleFromPassing(passing) {
    if (!passing) return null;
    const nums = String(passing).match(/\d+/g);
    if (!nums || !nums.length) return null;
    const first = Number(nums[0]);
    if (first <= 2) return '逃げ';
    if (first <= 5) return '先行';
    if (first <= 9) return '差し';
    return '追込';
  }

  function detectStyle(h, runs) {
    return h.running_style || h.style || h.pace_style || detectStyleFromPassing(runs[0]?.passing) || '—';
  }

  function layoffText(days) {
    if (days == null) return '—';
    if (days <= 13) return '連闘・中1週';
    if (days <= 35) return '中2-5週';
    if (days <= 69) return '中6-9週';
    if (days <= 139) return '3-4か月';
    return '5か月以上';
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


  function isDistanceUp(run) {
    const rd = raceDistance();
    const d = parseDistance(run?.distance_m ?? run?.distance ?? run?.distance_text);
    return rd != null && d != null && rd > d;
  }

  function isDistanceDown(run) {
    const rd = raceDistance();
    const d = parseDistance(run?.distance_m ?? run?.distance ?? run?.distance_text);
    return rd != null && d != null && rd < d;
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
    };
    return map[key] || key;
  }

  function buildPrev1Brief(run) {
    const ra = getRA();
    if (!run) return '前走: データなし';
    const bits = [];
    const d = parseDistance(run.distance_m ?? run.distance ?? run.distance_text);
    if (d != null) bits.push(`${d}m`);
    if (run.going) bits.push(run.going);
    const f = finishNum(run.finish);
    if (f != null) bits.push(`${f}着`);
    if (ra.toNum(run.popularity) != null) bits.push(`${ra.toNum(run.popularity)}人気`);
    if (ra.toNum(run.last3f) != null) bits.push(`上がり${ra.fmtNum(run.last3f, 1)}`);
    if (run.passing) bits.push(`通過${run.passing}`);
    return `前走: ${bits.join(' / ') || 'データなし'}`;
  }

  function buildRecent3Brief(runs) {
    const ra = getRA();
    if (!runs.length) return '近3走: データなし';
    const seq = runs.slice(0, 3).map((r) => finishNum(r.finish) ?? '—').join('-');
    const af = ra.fmtNum(avgFinish(runs, 3), 1);
    const al = ra.fmtNum(avgLast3f(runs, 3), 1);
    return `近3走: ${seq} / 平均${af} / 掲示板${boardCount(runs, 3)}回 / 上がり平均${al}`;
  }

  function bloodText(h) {
    const sire = h.sire || h.father || '';
    const damsire = h.dam_sire || h.damsire || h.mother_father || h.mf || '';
    const parts = [sire, damsire].filter(Boolean);
    return parts.length ? parts.join(' / ') : '—';
  }

  function buildPositiveMemo(h, obj) {
    const items = [];
    if (obj.styleText && obj.styleText !== '—') items.push(`脚質:${obj.styleText}`);
    if (obj.sameDistanceCount > 0) items.push(`同距離:${obj.sameDistanceCount}走`);
    if (obj.sameCourseCount > 0) items.push(`同コース:${obj.sameCourseCount}走`);
    if (obj.recentTop3 > 0) items.push(`近3走掲示板:${obj.recentTop3}回`);
    if (h.sire) items.push(`父血統:${h.sire}`);
    if (obj.prevFinish != null && obj.prevFinish <= 3) items.push(`前走${obj.prevFinish}着`);
    return Array.from(new Set([...splitReasons(h.reasons_pos || h.plus_reasons || h.memo_pos), ...items])).filter(Boolean).join(' / ') || '—';
  }

  function buildNegativeMemo(h, obj) {
    const items = [];
    if (obj.recentTop3 === 0 && obj.runs.length >= 3) items.push('近3走で掲示板なし');
    if (obj.jockeyChangeText === '騎手替わり') items.push('騎手替わり');
    if (obj.layoffDays != null && obj.layoffDays >= 70) items.push(`休み明け:${obj.layoffText}`);
    return Array.from(new Set([...splitReasons(h.reasons_neg || h.minus_reasons || h.memo_neg), ...items])).filter(Boolean).join(' / ') || '—';
  }

  function jockeyChangeText(h, runs) {
    const now = h.jockey || h.rider || h.jockey_name || '';
    const prevRun = runs[0] || null;
    const prev = prevRun?.jockey || prevRun?.rider || prevRun?.jockey_name || '';
    const same = samePersonName(now, prev);
    if (same === null) return '—';
    return same ? '継続騎乗' : '騎手替わり';
  }

  function detectRunTags(run) {
    const tags = [];
    if (isSameCourse(run)) tags.push({ text: '同コース', cls: 'tag--plus' });
    if (isSameDistance(run)) tags.push({ text: '同距離', cls: 'tag--plus' });
    const finish = finishNum(run.finish);
    if (finish != null && finish <= 3) tags.push({ text: `前${finish}着`, cls: 'tag--blue' });
    const l3f = getRA().toNum(run.last3f);
    if (l3f != null && l3f <= 35.0) tags.push({ text: '上がり優秀', cls: 'tag--accent' });
    return tags;
  }

  function summarizedHorse(h) {
    const runs = meaningfulRuns(h);
    const layoffDays = diffDays(raceDate(), runs[0]?.date);
    const prevFinish = finishNum(runs[0]?.finish);
    const styleText = detectStyle(h, runs);
    const obj = {
      horse: h,
      runs,
      board3: boardCount(runs, 3),
      avgFinish: avgFinish(runs, 3),
      avgLast3f: avgLast3f(runs, 3),
      recentTop3: recentTop3Count(runs, 3),
      sameCourseCount: runs.filter(isSameCourse).length,
      sameDistanceCount: runs.filter(isSameDistance).length,
      prev1Brief: buildPrev1Brief(runs[0]),
      recent3Brief: buildRecent3Brief(runs),
      submetaText: horseSubmetaText(h),
      styleText,
      layoffDays,
      layoffText: layoffText(layoffDays),
      jockeyChangeText: jockeyChangeText(h, runs),
      bloodText: bloodText(h),
      prevFinish,
      hasDistanceUp: isDistanceUp(runs[0]),
      hasDistanceDown: isDistanceDown(runs[0]),
      isFrontType: /逃げ|先行/.test(styleText),
      isCloserType: /差し|追込/.test(styleText),
      jockeyChanged: jockeyChangeText(h, runs) === '騎手替わり',
      isLayoff: layoffDays != null && layoffDays >= 70,
      totalRuns: runs.length,
    };
    obj.positiveMemo = buildPositiveMemo(h, obj);
    obj.negativeMemo = buildNegativeMemo(h, obj);
    return obj;
  }

  function matchSummary(obj) {
    const h = obj.horse;
    const kw = state.keyword.trim().toLowerCase();
    if (kw && !String(h.horse_name || '').toLowerCase().includes(kw)) return false;
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

  function compareRows(a, b) {
    const ra = getRA();
    switch (state.sortKey) {
      case 'prev1_finish':
        return (a.prevFinish ?? 999) - (b.prevFinish ?? 999);
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
        <section class="sheet compare-toolbar">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">比較条件</h2>
              <div class="section-subtitle">近走件数と絞り込みを切り替えて、馬ごとの比較をしやすくした。</div>
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
            <label class="filter-field compare-toolbar__search compare-toolbar__search--wide"><span>馬名検索</span><input id="past-keyword" type="text" placeholder="馬名で検索"></label>
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
      </section>`;
  }

  function renderHero() {
    const hero = qs('#past-hero');
    const race = state.data?.race || {};
    const ra = getRA();
    hero.innerHTML = `<div class="race-hero__inner"><div><div class="race-hero__date">${ra.escapeHtml(state.data?.race_date || '')}</div><h1 class="race-hero__title">${ra.escapeHtml(race.course || '')} ${ra.escapeHtml(race.race_no || '')}R ${ra.escapeHtml(race.race_name || '')}</h1><div class="race-hero__meta">${ra.escapeHtml([race.surface, race.distance ? `${race.distance}m` : '', race.headcount ? `${race.headcount}頭` : ''].filter(Boolean).join(' / '))}</div></div><div class="tag-list"><span class="tag tag--blue">過去走比較</span><span class="tag">近走${state.limit}件表示</span></div></div>`;
  }

  function renderTabs() {
    const nav = qs('#past-tabs');
    const ra = getRA();
    nav.innerHTML = `<a class="race-tab" href="${ra.escapeHtml(buildUrl('race'))}">出走馬一覧</a><a class="race-tab is-active" href="${ra.escapeHtml(buildUrl('past'))}">過去走比較</a><a class="race-tab" href="${ra.escapeHtml(buildUrl('betting'))}">買い目作成</a>`;
  }

  function runCard(run) {
    const ra = getRA();
    const title = [run.course || run.course_name, run.race_name].filter(Boolean).join(' ');
    const line1 = [run.surface || '', run.distance_m ? `${run.distance_m}m` : run.distance || '', run.going].filter(Boolean).join(' / ');
    const tags = detectRunTags(run);
    return `<article class="netkeiba-run-item"><div class="netkeiba-run-item__date">${ra.escapeHtml(run.date || '—')}</div><div class="netkeiba-run-item__main"><div class="netkeiba-run-item__race"><strong>${ra.escapeHtml(title || '過去走')}</strong></div><div class="netkeiba-run-item__sub">${ra.escapeHtml(line1)}</div><div class="netkeiba-run-item__meta">人気 ${ra.escapeHtml(ra.fmt(run.popularity))} / 単勝 ${ra.escapeHtml(ra.fmtNum(run.win_odds || run.tansho_odds, 1))} / 上がり ${ra.escapeHtml(ra.fmtNum(run.last3f, 1))} / 通過 ${ra.escapeHtml(ra.fmt(run.passing))}</div><div class="netkeiba-run-item__meta">騎手 ${ra.escapeHtml(ra.fmt(run.jockey))} / 着差 ${ra.escapeHtml(ra.fmt(run.margin))} / タイム ${ra.escapeHtml(ra.fmt(run.time))}</div>${tags.length ? `<div class="tag-list" style="margin-top:8px;">${tags.map((t) => `<span class="tag ${t.cls || ''}">${ra.escapeHtml(t.text)}</span>`).join('')}</div>` : ''}</div><div class="netkeiba-run-item__result ${finishNum(run.finish) != null && finishNum(run.finish) <= 3 ? 'is-good' : ''}">${ra.escapeHtml(ra.fmt(run.finish))}</div></article>`;
  }

  function renderMemo(obj) {
    const ra = getRA();
    return `<section class="past-memo-grid"><div class="detail-box"><h4 class="detail-box__title">予想メモ</h4><div class="detail-kv"><div class="detail-kv__item"><div class="detail-kv__label">前走要約</div><div class="detail-kv__value">${ra.escapeHtml(obj.prev1Brief.replace(/^前走:\s*/, ''))}</div></div><div class="detail-kv__item"><div class="detail-kv__label">近3走要約</div><div class="detail-kv__value">${ra.escapeHtml(obj.recent3Brief.replace(/^近3走:\s*/, ''))}</div></div><div class="detail-kv__item"><div class="detail-kv__label">プラス要素</div><div class="detail-kv__value">${ra.escapeHtml(obj.positiveMemo)}</div></div><div class="detail-kv__item"><div class="detail-kv__label">マイナス要素</div><div class="detail-kv__value">${ra.escapeHtml(obj.negativeMemo)}</div></div><div class="detail-kv__item"><div class="detail-kv__label">年齢性別 / 脚質</div><div class="detail-kv__value">${ra.escapeHtml(horseSexAgeText(obj.horse))} / ${ra.escapeHtml(obj.styleText)}</div></div><div class="detail-kv__item"><div class="detail-kv__label">騎手 / 乗り替わり</div><div class="detail-kv__value">${ra.escapeHtml(horseJockeyText(obj.horse))} / ${ra.escapeHtml(obj.jockeyChangeText)}</div></div><div class="detail-kv__item"><div class="detail-kv__label">父血統 / 母父血統</div><div class="detail-kv__value">${ra.escapeHtml(obj.bloodText)}</div></div><div class="detail-kv__item"><div class="detail-kv__label">同距離 / 同コース / 休み明け</div><div class="detail-kv__value">${ra.escapeHtml(obj.sameDistanceCount)}走 / ${ra.escapeHtml(obj.sameCourseCount)}走 / ${ra.escapeHtml(obj.layoffText)}</div></div></div></div></section>`;
  }

  function renderList() {
    const list = qs('#past-list');
    const meta = qs('#past-meta');
    const ra = getRA();
    const rows = (state.data.horses || []).map(summarizedHorse).filter(matchSummary).sort(compareRows);
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
        obj.totalRuns ? { text: `全${obj.totalRuns}` } : null,
      ].filter(Boolean);
      return `<article class="past-horse-card ${expanded ? 'is-open' : ''}"><button type="button" class="past-horse-card__summary" data-horse-key="${ra.escapeHtml(key)}"><div class="past-horse-card__main"><div class="past-horse-card__title-row"><div><div class="past-horse-card__title">${ra.escapeHtml(h.umaban)} ${ra.escapeHtml(h.horse_name)}</div><div class="past-horse-card__submeta">${ra.escapeHtml(obj.submetaText)}</div></div></div><div class="past-horse-card__brief"><div class="past-horse-card__brief-line">${ra.escapeHtml(obj.prev1Brief)}</div><div class="past-horse-card__brief-line">${ra.escapeHtml(obj.recent3Brief)}</div></div></div><div class="tag-list">${summaryTags.map((t) => `<span class="tag ${t.cls || ''}">${ra.escapeHtml(t.text)}</span>`).join('')}</div></button><div class="past-horse-card__detail">${renderMemo(obj)}${runs.length ? runs.map(runCard).join('') : '<div class="section-subtitle">過去走データなし</div>'}<div class="horse-run-actions">${obj.totalRuns > visible ? `<button type="button" class="action-link" data-more-runs="${ra.escapeHtml(key)}">さらに${Math.min(5, obj.totalRuns - visible)}件見る</button>` : ''}${visible > state.limit ? `<button type="button" class="action-link" data-reset-runs="${ra.escapeHtml(key)}">${state.limit}件表示に戻す</button>` : ''}</div></div></article>`;
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

    qs('#past-keyword').value = state.keyword;
    qs('#past-keyword').oninput = (e) => { state.keyword = e.target.value || ''; renderList(); };

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
      renderHero();
      renderTabs();
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
