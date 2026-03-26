(function () {
  'use strict';

  const PAGE_DEFAULTS = { race: 'race_detail.html', past: 'past_detail.html', betting: 'betting.html' };
  const state = { data: null, analysis: null, keyword: '', limit: 3, sameCourse: false, sameDistance: false, boardOnly: false, fastOnly: false, expanded: new Set(), visibleRuns: {} };
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  function getRA() {
    return window.RaceAnalysis || window.AC || createFallbackRA();
  }

  function createFallbackRA() {
    const toNum = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
    const fmt = (v, fb = '—') => (v == null || v === '' ? fb : String(v));
    const fmtNum = (v, d = 1, fb = '—') => { const n = toNum(v); return n == null ? fb : n.toFixed(d).replace(/\.0$/, ''); };
    const fmtPct = (v, d = 1, fb = '—') => { const n = toNum(v); return n == null ? fb : `${(n * 100).toFixed(d).replace(/\.0$/, '')}%`; };
    const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const analyzeRaceHorses = (horses) => ({ summary: { status: '混戦', comment: '過去走比較用の簡易表示', mainHorse: null, lineHorses: [], holeHorses: [], dangerHorses: [], popularSummary: [] } });
    return { toNum, fmt, fmtNum, fmtPct, esc, escapeHtml: esc, analyzeRaceHorses };
  }

  function getDataRoot() { return document.body?.dataset?.dataRoot || './data'; }
  function getPage(kind) { return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind]; }
  function getQuery() { const p = new URLSearchParams(location.search); return { raceId: p.get('race_id'), date: p.get('date') }; }
  function getJsonPath() {
    const { raceId, date } = getQuery();
    if (!raceId || !date) throw new Error('race_id と date をURLに入れてな。');
    return `${getDataRoot()}/${date}/race_${raceId}.json`;
  }
  function buildUrl(kind) {
    return `${getPage(kind)}?${new URLSearchParams({ date: state.data?.race_date || getQuery().date || '', race_id: state.data?.race?.race_id || getQuery().raceId || '' }).toString()}`;
  }
  async function fetchJson(path) { const res = await fetch(path, { cache: 'no-store' }); if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`); return res.json(); }
  function setStatus(msg, isError = false) { const el = qs('#past-status'); if (!el) return; el.hidden = false; el.textContent = msg; el.classList.toggle('is-error', !!isError); }

  function meaningfulRuns(h) {
    const arr = Array.isArray(h.past_runs) ? h.past_runs : [];
    const out = arr.filter((run) => run && typeof run === 'object' && ['date','race_name','finish','last3f','distance_m','distance_text'].some((k) => run[k] != null && run[k] !== ''));
    if (out.length) return out;
    const fallback = [];
    for (let i = 1; i <= 20; i += 1) {
      const keys = Object.keys(h || {}).filter((k) => k.startsWith(`prev${i}_`));
      if (!keys.length) continue;
      const run = { n: i };
      keys.forEach((k) => { run[k.replace(`prev${i}_`, '')] = h[k]; });
      if (['date','race_name','finish','last3f','distance'].some((key) => run[key] != null && run[key] !== '')) fallback.push(run);
    }
    return fallback;
  }

  function isSameDistance(run) { return !!run.same_distance; }
  function isSameCourse(run) { return !!run.same_course; }
  function avgFinish(runs, limit = state.limit) { const xs = runs.slice(0, limit).map((r) => getRA().toNum(r.finish)).filter((v) => Number.isFinite(v)); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
  function avgLast3f(runs, limit = state.limit) { const xs = runs.slice(0, limit).map((r) => getRA().toNum(r.last3f)).filter((v) => Number.isFinite(v)); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
  function boardCount(runs, limit = state.limit) { return runs.slice(0, limit).filter((r) => getRA().toNum(r.finish) !== null && getRA().toNum(r.finish) <= 5).length; }

  function renderLayout() {
    const root = qs('#past-app');
    if (!root) return;
    root.innerHTML = `
      <section class="past-page">
        <div id="past-status" class="page-status" hidden></div>
        <section id="past-hero" class="sheet race-hero"></section>
        <nav id="past-tabs" class="page-tab-strip"></nav>
        <section id="past-summary" class="sheet summary-panel"></section>
        <section class="sheet compare-toolbar">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">比較条件</h2>
              <div class="section-subtitle">近走件数と絞り込みを切り替えて、馬ごとの比較をしやすくした。</div>
            </div>
            <div id="limit-row" class="page-tab-strip"></div>
          </div>
          <div class="compare-toolbar__grid">
            <label class="filter-check"><input id="same-course" type="checkbox"> <span>同コース</span></label>
            <label class="filter-check"><input id="same-distance" type="checkbox"> <span>同距離</span></label>
            <label class="filter-check"><input id="board-only" type="checkbox"> <span>近3走掲示板内</span></label>
            <label class="filter-check"><input id="fast-only" type="checkbox"> <span>上がり優秀</span></label>
            <label class="filter-field compare-toolbar__search"><span>馬名検索</span><input id="past-keyword" type="text" placeholder="馬名で検索"></label>
          </div>
        </section>
        <section class="sheet">
          <div class="section-title-row"><div><h2 class="section-title">過去走比較</h2><div id="past-meta" class="section-subtitle"></div></div></div>
          <div id="past-list" class="past-list"></div>
        </section>
      </section>`;
  }

  function renderHero() {
    const hero = qs('#past-hero'); const race = state.data?.race || {}; const ra = getRA();
    hero.innerHTML = `<div class="race-hero__inner"><div><div class="race-hero__date">${ra.escapeHtml(state.data?.race_date || '')}</div><h1 class="race-hero__title">${ra.escapeHtml(race.course || '')} ${ra.escapeHtml(race.race_no || '')}R ${ra.escapeHtml(race.race_name || '')}</h1><div class="race-hero__meta">${ra.escapeHtml([race.surface, race.distance ? `${race.distance}m` : '', race.headcount ? `${race.headcount}頭` : ''].filter(Boolean).join(' / '))}</div></div><div class="tag-list"><span class="tag tag--blue">過去走比較</span><span class="tag">近走${state.limit}件表示</span></div></div>`;
  }

  function renderTabs() {
    const nav = qs('#past-tabs'); const ra = getRA();
    nav.innerHTML = `<a class="race-tab" href="${ra.escapeHtml(buildUrl('race'))}">出走馬一覧</a><a class="race-tab is-active" href="${ra.escapeHtml(buildUrl('past'))}">過去走比較</a><a class="race-tab" href="${ra.escapeHtml(buildUrl('betting'))}">買い目作成</a>`;
  }

  function popularClass(label) { if (label === '信頼') return 'mini-pill mini-pill--trust'; if (label === '危険') return 'mini-pill mini-pill--danger'; if (label === 'やや危険') return 'mini-pill mini-pill--warn'; return 'mini-pill mini-pill--plain'; }

  function renderSummary() {
    const box = qs('#past-summary'); const s = state.analysis?.summary || {}; const ra = getRA();
    const holes = (state.analysis?.holeCandidates || []).slice(0, 3); const dangers = (state.analysis?.dangerPopulars || []).slice(0, 3);
    box.innerHTML = `
      <div class="section-title-row"><div><h2 class="section-title">予想のまとめ</h2><div class="section-subtitle">過去走比較の前に、今の人気判定と本命方針を確認。</div></div></div>
      <div class="summary-grid summary-grid--2">
        <section class="summary-card"><div class="summary-card__head"><span class="badge ${s.status === '本命寄り' ? 'badge--blue' : s.status === '見送り寄り' ? 'badge--red' : 'badge--warn'}">${ra.escapeHtml(s.status || '混戦')}</span></div>
          ${s.mainHorse ? `<div class="summary-main-horse">◎ ${ra.escapeHtml(s.mainHorse.umaban)} ${ra.escapeHtml(s.mainHorse.horse_name)}</div><div class="summary-main-meta">勝率 ${ra.fmtPct(s.mainHorse.p_win)} / 複勝率 ${ra.fmtPct(s.mainHorse.p_top3)} / 単勝 ${ra.fmtNum(s.mainHorse.tansho_odds)} / 人気 ${ra.fmt(s.mainHorse.popularity)}</div>` : ''}
          <div class="summary-comment">${ra.escapeHtml(s.comment || '')}</div>
        </section>
        <section class="summary-card"><h3 class="mini-title">人気馬まとめ</h3>
          <div class="popular-summary-list">${(s.popularSummary || []).slice(0, 5).map((p) => `<div class="popular-summary-item"><div><strong>${ra.escapeHtml(p.popularity)}人気 ${ra.escapeHtml(p.umaban)} ${ra.escapeHtml(p.horse_name)}</strong><div class="popular-summary-meta">${ra.escapeHtml(p.comment || '')}</div></div><span class="${popularClass(p.label)}">${ra.escapeHtml(p.label || '妥当')}</span></div>`).join('') || '<div class="section-subtitle">人気上位データなし</div>'}</div>
        </section>
      </div>
      <div class="summary-grid summary-grid--2" style="margin-top:12px;">
        <section class="summary-card"><h3 class="mini-title">穴候補</h3>${holes.length ? holes.map((h) => `<div class="summary-list-row"><strong>${ra.escapeHtml(h.umaban)} ${ra.escapeHtml(h.horse_name)}</strong><div class="summary-row-meta">${ra.escapeHtml(h._analysis?.hole_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}</section>
        <section class="summary-card"><h3 class="mini-title">危険人気</h3>${dangers.length ? dangers.map((h) => `<div class="summary-list-row"><strong>${ra.escapeHtml(h.umaban)} ${ra.escapeHtml(h.horse_name)}</strong><div class="summary-row-meta">${ra.escapeHtml(h._analysis?.danger_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}</section>
      </div>`;
  }

  function summarizedHorse(h) {
    const runs = meaningfulRuns(h);
    return { horse: h, runs, board3: boardCount(runs, 3), avgFinish: avgFinish(runs, 3), avgLast3f: avgLast3f(runs, 3), sameCourseCount: runs.filter(isSameCourse).length, sameDistanceCount: runs.filter(isSameDistance).length };
  }

  function matchSummary(obj) {
    const h = obj.horse; const kw = state.keyword.trim().toLowerCase();
    if (kw && !String(h.horse_name || '').toLowerCase().includes(kw)) return false;
    if (state.sameCourse && obj.sameCourseCount <= 0) return false;
    if (state.sameDistance && obj.sameDistanceCount <= 0) return false;
    if (state.boardOnly && obj.board3 <= 0) return false;
    if (state.fastOnly && !(obj.avgLast3f != null && obj.avgLast3f <= 36.0)) return false;
    return true;
  }

  function runCard(run) {
    const ra = getRA();
    const title = [run.course || run.course_name, run.race_name].filter(Boolean).join(' ');
    const line1 = [run.surface || '', run.distance_m ? `${run.distance_m}m` : run.distance || '', run.going].filter(Boolean).join(' / ');
    return `<article class="netkeiba-run-item"><div class="netkeiba-run-item__date">${ra.escapeHtml(run.date || '—')}</div><div class="netkeiba-run-item__main"><div class="netkeiba-run-item__race"><strong>${ra.escapeHtml(title || '過去走')}</strong></div><div class="netkeiba-run-item__sub">${ra.escapeHtml(line1)}</div><div class="netkeiba-run-item__meta">人気 ${ra.escapeHtml(ra.fmt(run.popularity))} / 単勝 ${ra.escapeHtml(ra.fmtNum(run.win_odds || run.tansho_odds, 1))} / 上がり ${ra.escapeHtml(ra.fmtNum(run.last3f, 1))} / 通過 ${ra.escapeHtml(ra.fmt(run.passing))}</div><div class="netkeiba-run-item__meta">騎手 ${ra.escapeHtml(ra.fmt(run.jockey))} / 着差 ${ra.escapeHtml(ra.fmt(run.margin))} / タイム ${ra.escapeHtml(ra.fmt(run.time))}</div></div><div class="netkeiba-run-item__result ${ra.toNum(run.finish) !== null && ra.toNum(run.finish) <= 3 ? 'is-good' : ''}">${ra.escapeHtml(ra.fmt(run.finish))}</div></article>`;
  }

  function renderList() {
    const list = qs('#past-list'); const meta = qs('#past-meta'); const ra = getRA();
    const rows = (state.data.horses || []).map(summarizedHorse).filter(matchSummary).sort((a, b) => (ra.toNum(a.horse.umaban) ?? 999) - (ra.toNum(b.horse.umaban) ?? 999));
    meta.textContent = `${rows.length}頭表示 / 近走${state.limit}件`;
    list.innerHTML = rows.map((obj) => {
      const h = obj.horse; const key = String(h.horse_id || h.umaban || h.horse_name); const expanded = state.expanded.has(key);
      const totalRuns = obj.runs.length; const visible = state.visibleRuns[key] || state.limit; const runs = obj.runs.slice(0, visible);
      const sexAge = h.sex_age || h.sexage || h.seirei || h.sexAge || ([h.sex || h.gender || '', h.age != null && h.age !== '' ? h.age : ''].join('')).trim() || '—';
      const burdenVal = h.burden_weight ?? h.weight_carried ?? h.handicap ?? h.kinryo ?? h.weight;
      const burden = burdenVal != null && burdenVal !== '' ? `${ra.fmt(burdenVal)}kg` : '斤量—';
      const jockey = h.jockey || h.rider || h.jockey_name || '騎手—';
      return `<article class="past-horse-card ${expanded ? 'is-open' : ''}"><button type="button" class="past-horse-card__summary" data-horse-key="${ra.escapeHtml(key)}"><div><div class="past-horse-card__title">${ra.escapeHtml(h.umaban)} ${ra.escapeHtml(h.horse_name)}</div><div class="past-horse-card__submeta">${ra.escapeHtml(`${sexAge} / ${burden} / ${jockey}`)}</div><div class="past-horse-card__meta">近3走 平均着順 ${ra.escapeHtml(ra.fmtNum(obj.avgFinish, 1))} / 掲示板 ${ra.escapeHtml(obj.board3)}回 / 上がり平均 ${ra.escapeHtml(ra.fmtNum(obj.avgLast3f, 1))}</div></div><div class="tag-list"><span class="tag ${obj.sameCourseCount > 0 ? 'tag--plus' : ''}">同コース ${ra.escapeHtml(obj.sameCourseCount)}</span><span class="tag ${obj.sameDistanceCount > 0 ? 'tag--plus' : ''}">同距離 ${ra.escapeHtml(obj.sameDistanceCount)}</span><span class="tag">全${ra.escapeHtml(totalRuns)}</span></div></button><div class="past-horse-card__detail">${runs.length ? runs.map(runCard).join('') : '<div class="section-subtitle">過去走データなし</div>'}<div class="horse-run-actions">${totalRuns > visible ? `<button type="button" class="action-link" data-more-runs="${ra.escapeHtml(key)}">さらに${Math.min(5, totalRuns - visible)}件見る</button>` : ''}${visible > state.limit ? `<button type="button" class="action-link" data-reset-runs="${ra.escapeHtml(key)}">${state.limit}件表示に戻す</button>` : ''}</div></div></article>`;
    }).join('') || '<div class="sheet empty-state">該当馬なし</div>';

    qsa('[data-horse-key]', list).forEach((btn) => btn.addEventListener('click', () => { const key = btn.dataset.horseKey; if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key); if (!state.visibleRuns[key]) state.visibleRuns[key] = state.limit; renderList(); }));
    qsa('[data-more-runs]', list).forEach((btn) => btn.addEventListener('click', (e) => { e.stopPropagation(); const key = btn.dataset.moreRuns; state.visibleRuns[key] = (state.visibleRuns[key] || state.limit) + 5; renderList(); }));
    qsa('[data-reset-runs]', list).forEach((btn) => btn.addEventListener('click', (e) => { e.stopPropagation(); const key = btn.dataset.resetRuns; state.visibleRuns[key] = state.limit; renderList(); }));
  }

  function bind() {
    const limitRow = qs('#limit-row');
    limitRow.innerHTML = [3, 5].map((n) => `<button type="button" class="segmented-btn${state.limit === n ? ' is-active' : ''}" data-limit="${n}">近${n}走</button>`).join('');
    qsa('[data-limit]', limitRow).forEach((btn) => btn.addEventListener('click', () => { state.limit = Number(btn.dataset.limit); state.visibleRuns = {}; bind(); renderHero(); renderList(); }));
    qs('#same-course').checked = state.sameCourse; qs('#same-distance').checked = state.sameDistance; qs('#board-only').checked = state.boardOnly; qs('#fast-only').checked = state.fastOnly;
    qs('#same-course').onchange = (e) => { state.sameCourse = !!e.target.checked; renderList(); };
    qs('#same-distance').onchange = (e) => { state.sameDistance = !!e.target.checked; renderList(); };
    qs('#board-only').onchange = (e) => { state.boardOnly = !!e.target.checked; renderList(); };
    qs('#fast-only').onchange = (e) => { state.fastOnly = !!e.target.checked; renderList(); };
    qs('#past-keyword').value = state.keyword; qs('#past-keyword').oninput = (e) => { state.keyword = e.target.value || ''; renderList(); };
  }

  async function init() {
    try {
      renderLayout(); setStatus('過去走データを読み込み中…');
      state.data = await fetchJson(getJsonPath());
      const ra = getRA();
      state.analysis = ra.analyzeRaceHorses ? ra.analyzeRaceHorses(state.data.horses || []) : createFallbackRA().analyzeRaceHorses(state.data.horses || []);
      renderHero(); renderTabs(); renderSummary(); bind(); renderList();
      document.title = `${state.data.race?.course || ''} ${state.data.race?.race_no || ''}R ${state.data.race?.race_name || ''} | 過去走比較`;
      qs('#past-status').hidden = true;
    } catch (err) {
      console.error(err); setStatus(err?.message || 'past.js 初期化に失敗した', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
