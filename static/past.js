(function () {
  'use strict';

  const PAGE_DEFAULTS = { race: 'race_detail.html', past: 'past_detail.html', betting: 'betting.html' };
  const state = { data: null, analysis: null, ra: null, keyword: '', limit: 3, sameCourse: false, sameDistance: false, boardOnly: false, fastOnly: false, expanded: new Set() };
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const RA = window.RaceAnalysis || window.AC || null;

  function getDataRoot() { return document.body?.dataset?.dataRoot || './data'; }
  function getPage(kind) { return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind]; }
  function getJsonPath() {
    const p = new URLSearchParams(location.search);
    const raceId = p.get('race_id'); const date = p.get('date');
    if (!raceId || !date) throw new Error('race_id と date をURLに入れてな。');
    return `${getDataRoot()}/${date}/race_${raceId}.json`;
  }
  function buildUrl(kind) {
    const race = state.data?.race || {};
    return `${getPage(kind)}?${new URLSearchParams({ date: state.data?.race_date, race_id: race.race_id }).toString()}`;
  }
  async function fetchJson(path) { const res = await fetch(path, { cache: 'no-store' }); if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`); return res.json(); }
  function setStatus(msg, isError = false) { const el = qs('#past-status'); if (!el) return; el.hidden = false; el.textContent = msg; el.classList.toggle('is-error', !!isError); }

  function meaningfulRuns(h) {
    const arr = Array.isArray(h.past_runs) ? h.past_runs : [];
    const valid = arr.filter((r) => r && ['date','race_id','race_name','finish','distance','last3f'].some((k) => r[k] != null && r[k] !== ''));
    if (valid.length) return valid;
    const buckets = {};
    Object.keys(h || {}).forEach((col) => {
      const m = /^prev(\d+)_(.+)$/.exec(col); if (!m) return;
      const idx = Number(m[1]); if (idx > 10) return;
      buckets[idx] ||= { n: idx }; buckets[idx][m[2]] = h[col];
    });
    return Object.keys(buckets).map((k) => buckets[k]).filter((r) => ['date','race_id','race_name','finish','distance','last3f'].some((key) => r[key] != null && r[key] !== '')).sort((a,b)=>a.n-b.n);
  }
  function parseDistance(v) { const m = String(v ?? '').match(/(\d{3,4})/); return m ? Number(m[1]) : null; }
  function surface(v) { const s = String(v ?? ''); if (s.includes('芝')) return '芝'; if (s.includes('ダ')) return 'ダ'; if (s.includes('障')) return '障'; return ''; }
  function currentCourse() { return state.data?.race?.course || ''; }
  function currentDistance() { return parseDistance(state.data?.race?.distance); }
  function currentSurface() { return surface(state.data?.race?.surface); }
  function runCourse(run) { return run.course || run.course_name || ''; }
  function isSameDistance(run) { const d = parseDistance(run.distance_m || run.distance); return d != null && currentDistance() != null && d === currentDistance(); }
  function isSameCourse(run) {
    const rp = runCourse(run); const cp = currentCourse(); const rs = surface(run.surface || run.distance); const cs = currentSurface();
    return !!rp && !!cp && rp === cp && isSameDistance(run) && (!rs || !cs || rs === cs);
  }
  function boardCount(runs, limit = 3) { return runs.slice(0, limit).filter((r) => { const f = (state.ra || RA).toNum(r.finish); return f != null && f <= 5; }).length; }
  function avg(arr) { const xs = arr.filter((v) => Number.isFinite(v)); return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; }
  function avgFinish(runs, limit = 3) { return avg(runs.slice(0, limit).map((r) => (state.ra || RA).toNum(r.finish)).filter((v) => v != null)); }
  function avgLast3f(runs, limit = 3) { return avg(runs.slice(0, limit).map((r) => (state.ra || RA).toNum(r.last3f)).filter((v) => v != null)); }

  function renderLayout() {
    const root = qs('#past-app');
    root.innerHTML = `
      <section class="past-page">
        <div id="past-status" class="page-status" hidden></div>
        <section id="past-hero" class="sheet race-hero"></section>
        <nav id="past-tabs" class="page-tab-strip"></nav>
        <section id="past-summary" class="sheet summary-panel"></section>
        <section class="sheet compare-toolbar">
          <div class="section-title-row"><div><h2 class="section-title">比較条件</h2><div class="section-subtitle">近走数と絞り込みを切り替えて、馬ごとの比較をしやすくした。</div></div></div>
          <div class="compare-toolbar__row">
            <div class="segmented-row" id="limit-row"></div>
            <label class="check-pill"><input id="same-course" type="checkbox"> 同コース</label>
            <label class="check-pill"><input id="same-distance" type="checkbox"> 同距離</label>
            <label class="check-pill"><input id="board-only" type="checkbox"> 近3走掲示板内</label>
            <label class="check-pill"><input id="fast-only" type="checkbox"> 上がり優秀</label>
          </div>
          <div class="compare-toolbar__row"><input id="past-keyword" type="text" placeholder="馬名で検索"></div>
        </section>
        <section class="sheet"><div class="section-title-row"><div><h2 class="section-title">過去走比較</h2><div id="past-meta" class="section-subtitle"></div></div></div><div id="past-list" class="past-list"></div></section>
      </section>`;
  }

  function renderHero() {
    const hero = qs('#past-hero'); const race = state.data?.race || {};
    hero.innerHTML = `
      <div class="race-hero__head"><div><div class="race-hero__date">${(state.ra || RA).esc(state.data?.race_date || '')}</div><h1 class="race-hero__title">${(state.ra || RA).esc(race.course || '')} ${(state.ra || RA).esc(race.race_no || '')}R ${(state.ra || RA).esc(race.race_name || '')}</h1><div class="race-hero__meta">${(state.ra || RA).esc([race.surface, race.distance ? `${race.distance}m` : '', race.headcount ? `${race.headcount}頭` : ''].filter(Boolean).join(' / '))}</div></div><div class="tag-list"><span class="tag tag--blue">過去走比較</span><span class="tag">近走${state.limit}件表示</span></div></div>`;
  }

  function renderTabs() {
    const nav = qs('#past-tabs');
    nav.innerHTML = `
      <a class="race-tab" href="${(state.ra || RA).esc(buildUrl('race'))}">出走馬一覧</a>
      <a class="race-tab is-active" href="${(state.ra || RA).esc(buildUrl('past'))}">過去走比較</a>
      <a class="race-tab" href="${(state.ra || RA).esc(buildUrl('betting'))}">買い目作成</a>`;
  }

  function renderSummary() {
    const box = qs('#past-summary'); const s = state.analysis.summary;
    const holes = s.holeHorses || []; const dangers = s.dangerHorses || [];
    box.innerHTML = `
      <div class="section-title-row"><div><h2 class="section-title">予想のまとめ</h2><div class="section-subtitle">過去走比較の前に、今の人気判定と本命方針を確認。</div></div></div>
      <div class="summary-grid summary-grid--2">
        <section class="summary-card"><div class="summary-card__head"><span class="badge ${s.status === '本命寄り' ? 'badge--blue' : s.status === '見送り寄り' ? 'badge--red' : 'badge--warn'}">${(state.ra || RA).esc(s.status)}</span></div>
          ${s.mainHorse ? `<div class="summary-main-horse">◎ ${(state.ra || RA).esc(s.mainHorse.umaban)} ${(state.ra || RA).esc(s.mainHorse.horse_name)}</div><div class="summary-main-meta">勝率 ${(state.ra || RA).fmtPct(s.mainHorse.p_win)} / 複勝率 ${(state.ra || RA).fmtPct(s.mainHorse.p_top3)} / 単勝 ${(state.ra || RA).fmtNum(s.mainHorse.tansho_odds)} / 人気 ${(state.ra || RA).fmt(s.mainHorse.popularity)}</div>` : ''}
          <div class="summary-comment">${(state.ra || RA).esc(s.comment || '')}</div>
        </section>
        <section class="summary-card"><h3 class="mini-title">人気馬まとめ</h3>
          <div class="popular-summary-list">
            ${(s.popularSummary || []).slice(0, 5).map((p) => `<div class="popular-summary-item"><div><strong>${(state.ra || RA).esc(p.popularity)}人気 ${(state.ra || RA).esc(p.umaban)} ${(state.ra || RA).esc(p.horse_name)}</strong><div class="popular-summary-meta">${(state.ra || RA).esc(p.comment || '')}</div></div><span class="mini-pill ${popularClass(p.label)}">${(state.ra || RA).esc(p.label || '妥当')}</span></div>`).join('') || '<div class="section-subtitle">人気上位データなし</div>'}
        </section>
      </div>
      <div class="summary-grid summary-grid--2" style="margin-top:12px;">
        <section class="summary-card"><h3 class="mini-title">穴候補</h3>${holes.length ? holes.map((h) => `<div class="summary-list-row"><strong>${(state.ra || RA).esc(h.umaban)} ${(state.ra || RA).esc(h.horse_name)}</strong><div class="summary-row-meta">${(state.ra || RA).esc(h.hole_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}</section>
        <section class="summary-card"><h3 class="mini-title">危険人気</h3>${dangers.length ? dangers.map((h) => `<div class="summary-list-row"><strong>${(state.ra || RA).esc(h.umaban)} ${(state.ra || RA).esc(h.horse_name)}</strong><div class="summary-row-meta">${(state.ra || RA).esc(h.danger_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}</section>
      </div>`;
  }

  function popularClass(label) { if (label === '信頼') return 'mini-pill--trust'; if (label === '危険') return 'mini-pill--danger'; if (label === 'やや危険') return 'mini-pill--warn'; return 'mini-pill--plain'; }

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
    return `<div class="past-run-card"><div class="past-run-card__head"><strong>${(state.ra || RA).esc(run.date || '—')} ${(state.ra || RA).esc(run.race_name || '')}</strong><span class="tag">${(state.ra || RA).esc(run.finish != null ? `${run.finish}着` : '着順不明')}</span></div><div class="past-run-card__meta">${(state.ra || RA).esc([run.course || run.course_name, run.surface || '', run.distance_m || run.distance, run.going].filter(Boolean).join(' / '))}</div><div class="past-run-card__meta">人気 ${(state.ra || RA).esc((state.ra || RA).fmt(run.popularity))} / 単勝 ${(state.ra || RA).esc((state.ra || RA).fmtNum(run.win_odds || run.tansho_odds, 1))} / 上がり ${(state.ra || RA).esc((state.ra || RA).fmtNum(run.last3f, 1))} / 通過 ${(state.ra || RA).esc((state.ra || RA).fmt(run.passing))}</div></div>`;
  }

  function renderList() {
    const list = qs('#past-list'); const meta = qs('#past-meta');
    const rows = (state.data.horses || []).map(summarizedHorse).filter(matchSummary).sort((a, b) => ((state.ra || RA).toNum(a.horse.umaban) ?? 999) - ((state.ra || RA).toNum(b.horse.umaban) ?? 999));
    meta.textContent = `${rows.length}頭表示 / 近走${state.limit}件`;
    list.innerHTML = rows.map((obj) => {
      const h = obj.horse; const key = String(h.horse_id || h.umaban || h.horse_name); const expanded = state.expanded.has(key);
      const runs = obj.runs.slice(0, state.limit);
      return `
        <article class="past-horse-card ${expanded ? 'is-open' : ''}">
          <button type="button" class="past-horse-card__summary" data-horse-key="${(state.ra || RA).esc(key)}">
            <div><div class="past-horse-card__title">${(state.ra || RA).esc(h.umaban)} ${(state.ra || RA).esc(h.horse_name)}</div><div class="past-horse-card__meta">近${state.limit}走 平均着順 ${(state.ra || RA).esc((state.ra || RA).fmtNum(obj.avgFinish, 1))} / 掲示板 ${(state.ra || RA).esc(obj.board3)}回 / 上がり平均 ${(state.ra || RA).esc((state.ra || RA).fmtNum(obj.avgLast3f, 1))}</div></div>
            <div class="tag-list"><span class="tag ${obj.sameCourseCount > 0 ? 'tag--plus' : ''}">同コース ${(state.ra || RA).esc(obj.sameCourseCount)}</span><span class="tag ${obj.sameDistanceCount > 0 ? 'tag--plus' : ''}">同距離 ${(state.ra || RA).esc(obj.sameDistanceCount)}</span></div>
          </button>
          <div class="past-horse-card__detail">${runs.length ? runs.map(runCard).join('') : '<div class="section-subtitle">過去走データなし</div>'}</div>
        </article>`;
    }).join('') || '<div class="sheet empty-state">該当馬なし</div>';
    qsa('[data-horse-key]', list).forEach((btn) => btn.addEventListener('click', () => { const key = btn.dataset.horseKey; if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key); renderList(); }));
  }

  function bind() {
    const limitRow = qs('#limit-row');
    limitRow.innerHTML = [3,5].map((n) => `<button type="button" class="segmented-btn${state.limit === n ? ' is-active' : ''}" data-limit="${n}">近${n}走</button>`).join('');
    qsa('[data-limit]', limitRow).forEach((btn) => btn.addEventListener('click', () => { state.limit = Number(btn.dataset.limit); bind(); renderHero(); renderList(); }));
    qs('#same-course').checked = state.sameCourse; qs('#same-distance').checked = state.sameDistance; qs('#board-only').checked = state.boardOnly; qs('#fast-only').checked = state.fastOnly;
    qs('#same-course').onchange = (e) => { state.sameCourse = !!e.target.checked; renderList(); };
    qs('#same-distance').onchange = (e) => { state.sameDistance = !!e.target.checked; renderList(); };
    qs('#board-only').onchange = (e) => { state.boardOnly = !!e.target.checked; renderList(); };
    qs('#fast-only').onchange = (e) => { state.fastOnly = !!e.target.checked; renderList(); };
    qs('#past-keyword').value = state.keyword; qs('#past-keyword').oninput = (e) => { state.keyword = e.target.value || ''; renderList(); };
  }

  function createFallbackRA() {
    const toNum = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
    const fmt = (v, fb = '—') => (v == null || v === '' ? fb : String(v));
    const fmtNum = (v, d = 1, fb = '—') => { const n = toNum(v); return n == null ? fb : n.toFixed(d).replace(/\.0$/, ''); };
    const fmtPct = (v, d = 1, fb = '—') => { const n = toNum(v); return n == null ? fb : `${(n * 100).toFixed(d).replace(/\.0$/, '')}%`; };
    const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const analyzeRaceHorses = (horses) => ({ summary: { status: '混戦', comment: '過去走比較用の簡易表示', mainHorse: null, lineHorses: [], holeHorses: [], dangerHorses: [], popularSummary: [] } });
    return { toNum, fmt, fmtNum, fmtPct, esc, analyzeRaceHorses };
  }

  async function init() {
    try {
      renderLayout(); setStatus('過去走データを読み込み中…');
      state.data = await fetchJson(getJsonPath());
      state.ra = RA || createFallbackRA();
      state.analysis = state.ra.analyzeRaceHorses(state.data.horses || []);
      renderHero(); renderTabs(); renderSummary(); bind(); renderList();
      document.title = `${state.data.race?.course || ''} ${state.data.race?.race_no || ''}R ${state.data.race?.race_name || ''} | 過去走比較`;
      qs('#past-status').hidden = true;
    } catch (err) {
      console.error(err); setStatus(err?.message || 'past.js 初期化に失敗した', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
