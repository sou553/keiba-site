(function () {
  'use strict';

  const PAGE_DEFAULTS = {
    race: 'race_detail.html',
    past: 'past_detail.html',
    betting: 'betting.html',
  };

  const JRA_PLACE_MAP = {
    '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', '05': '東京',
    '06': '中山', '07': '中京', '08': '京都', '09': '阪神', '10': '小倉',
  };

  const state = {
    data: null,
    keyword: '',
    viewLimit: 3,
    filterSameCourse: false,
    filterSameDistance: false,
    filterBoard: false,
    filterFastLast3f: false,
    sortKey: 'umaban',
    expanded: new Set(),
  };

  function qs(s, root = document) { return root.querySelector(s); }
  function qsa(s, root = document) { return Array.from(root.querySelectorAll(s)); }
  function escapeHtml(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function fmt(v, fb = '—') { return v == null || v === '' ? fb : String(v); }
  function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  function fmtNum(v, d = 1, fb = '—') { const n = toNum(v); return n == null ? fb : n.toFixed(d).replace(/\.0$/, ''); }
  function fmtPct(v, d = 1, fb = '—') { const n = toNum(v); return n == null ? fb : `${(n * 100).toFixed(d)}%`; }
  function getDataRoot() { return document.body?.dataset?.dataRoot || './data'; }
  function getPageName(kind) { return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind]; }

  function getJsonPath() {
    const params = new URLSearchParams(window.location.search);
    const direct = params.get('json') || document.body?.dataset?.json;
    if (direct) return direct;
    const raceId = params.get('race_id') || params.get('raceId') || document.body?.dataset?.raceId;
    const date = params.get('date') || params.get('raceDate') || document.body?.dataset?.raceDate;
    if (!raceId || !date) throw new Error('race_id と date をURLパラメータに入れてな。例: ?date=20260322&race_id=202606020801');
    return `${getDataRoot()}/${date}/race_${raceId}.json`;
  }

  function buildPageUrl(kind, race) {
    const page = getPageName(kind);
    const params = new URLSearchParams({ date: race.race_date, race_id: race.race_id });
    return `${page}?${params.toString()}`;
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`);
    return res.json();
  }

  function setStatus(message, isError = false) {
    const el = qs('#past-status');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle('is-error', !!isError);
  }

  function placeFromRaceId(raceId) {
    const rid = String(raceId ?? '').replace(/\D/g, '');
    if (rid.length < 6) return '';
    return JRA_PLACE_MAP[rid.slice(4, 6)] || '';
  }

  function parseDistanceValue(v) {
    if (v == null || v === '') return null;
    const m = String(v).match(/(\d{3,4})/);
    return m ? Number(m[1]) : null;
  }

  function surfaceOf(v) {
    const s = String(v ?? '');
    if (s.includes('芝')) return '芝';
    if (s.includes('ダ')) return 'ダ';
    if (s.includes('障')) return '障';
    return s || '';
  }

  function raceName(data) {
    const race = data.race || {};
    const firstHorse = data.horses?.[0] || {};
    return race.race_name || firstHorse.title || 'レース詳細';
  }

  function raceDistance(data) {
    const race = data.race || {};
    const firstHorse = data.horses?.[0] || {};
    return race.distance || firstHorse.distance_m || parseDistanceValue(firstHorse.distance) || null;
  }

  function raceSurface(data) {
    const race = data.race || {};
    const firstHorse = data.horses?.[0] || {};
    return race.surface || surfaceOf(firstHorse.surface || firstHorse.distance);
  }

  function currentCourse(data) {
    const race = data.race || {};
    return race.course || placeFromRaceId(race.race_id) || placeFromRaceId(data.horses?.[0]?.race_id);
  }

  function meaningfulPastRuns(horse) {
    const fromArray = Array.isArray(horse.past_runs) ? horse.past_runs : [];
    const valid = fromArray.filter((run) => run && typeof run === 'object' && ['date', 'race_id', 'race_name', 'finish', 'distance', 'last3f'].some((k) => run[k] != null && run[k] !== ''));
    if (valid.length) return valid;
    const buckets = {};
    Object.keys(horse || {}).forEach((col) => {
      const m = /^prev(\d+)_(.+)$/.exec(col);
      if (!m) return;
      const idx = Number(m[1]);
      if (idx > 10) return;
      buckets[idx] ||= { n: idx };
      buckets[idx][m[2]] = horse[col];
    });
    return Object.keys(buckets).map((k) => buckets[k]).filter((run) => ['date', 'race_id', 'race_name', 'finish', 'distance', 'last3f'].some((key) => run[key] != null && run[key] !== '')).sort((a,b)=>a.n-b.n);
  }

  function runCourse(run) {
    return run.course_name || run.course || placeFromRaceId(run.race_id) || '';
  }

  function runDistanceText(run) {
    return run.distance_text || run.distance || [surfaceOf(run.surface || run.distance), parseDistanceValue(run.distance_m || run.distance)].filter(Boolean).join('');
  }

  function sameDistance(run, data) {
    const rd = parseDistanceValue(run.distance_m || run.distance);
    const cd = parseDistanceValue(raceDistance(data));
    return rd != null && cd != null && rd === cd;
  }

  function sameCourse(run, data) {
    const runPlace = runCourse(run);
    const currentPlace = currentCourse(data);
    const rs = surfaceOf(run.surface || run.distance);
    const cs = surfaceOf(raceSurface(data));
    return !!runPlace && !!currentPlace && runPlace === currentPlace && sameDistance(run, data) && (!rs || !cs || rs === cs);
  }

  function avg(values) { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : null; }
  function avgFinish(runs, limit = 3) { return avg(runs.slice(0, limit).map((r)=>toNum(r.finish)).filter((v)=>v != null)); }
  function avgLast3f(runs, limit = 3) { return avg(runs.slice(0, limit).map((r)=>toNum(r.last3f)).filter((v)=>v != null)); }
  function boardCount(runs, limit = 3) { return runs.slice(0, limit).filter((r)=>{ const f = toNum(r.finish); return f != null && f <= 5; }).length; }

  function inferStyle(passing) {
    if (!passing) return '';
    const nums = String(passing).match(/\d+/g);
    if (!nums?.length) return '';
    const first = Number(nums[0]);
    if (first <= 3) return '先行';
    if (first <= 6) return '好位';
    if (first <= 10) return '差し';
    return '追込';
  }

  function styleTrend(runs) {
    const arr = runs.slice(0, 3).map((r)=>inferStyle(r.passing)).filter(Boolean);
    if (!arr.length) return '不明';
    const cnt = {};
    arr.forEach((s)=>cnt[s]=(cnt[s]||0)+1);
    return Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0][0] + '傾向';
  }

  function raceDateObj(v) {
    if (!v) return null;
    const s = String(v).replace(/\./g,'/').replace(/-/g,'/');
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function daysBetween(a, b) {
    if (!a || !b) return null;
    return Math.floor((a.getTime() - b.getTime()) / 86400000);
  }

  function layoffText(data, firstRun) {
    if (!firstRun) return '不明';
    const cur = raceDateObj(data.race_date || data.race?.race_date || data.horses?.[0]?.date);
    const prev = raceDateObj(firstRun.date);
    const days = daysBetween(cur, prev);
    if (days == null) return '不明';
    if (days <= 21) return '中1-3週';
    if (days <= 42) return '中3-6週';
    if (days <= 84) return '2-3か月';
    if (days <= 168) return '3-6か月';
    return '半年以上';
  }

  function distanceChangeText(data, firstRun) {
    if (!firstRun) return '不明';
    const cur = parseDistanceValue(raceDistance(data));
    const prev = parseDistanceValue(firstRun.distance_m || firstRun.distance);
    if (cur == null || prev == null) return '不明';
    const diff = cur - prev;
    if (diff === 0) return '同距離';
    return diff > 0 ? `${diff}m延長` : `${Math.abs(diff)}m短縮`;
  }

  function summarizeHorse(horse, data) {
    const runs = meaningfulPastRuns(horse);
    const sameCourseCount = runs.filter((r)=>sameCourse(r, data)).length;
    const sameDistanceCount = runs.filter((r)=>sameDistance(r, data)).length;
    const board3 = boardCount(runs, 3);
    const avgF = avgFinish(runs, 3);
    const avgL3 = avgLast3f(runs, 3);
    return {
      horse,
      runs,
      sameCourseCount,
      sameDistanceCount,
      board3,
      avgF,
      avgL3,
      style: styleTrend(runs),
      layoff: layoffText(data, runs[0]),
      distanceChange: distanceChangeText(data, runs[0]),
    };
  }

  function allSummaries() {
    return (state.data?.horses || []).map((h)=>summarizeHorse(h, state.data));
  }

  function filteredSummaries() {
    let rows = allSummaries();
    const keyword = state.keyword.trim().toLowerCase();
    if (keyword) {
      rows = rows.filter(({horse, runs}) => {
        const hay = [horse.horse_name, horse.jockey, horse.trainer, currentCourse(state.data), ...runs.map((r)=>r.race_name), ...runs.map((r)=>runCourse(r))].join(' ').toLowerCase();
        return hay.includes(keyword);
      });
    }
    if (state.filterSameCourse) rows = rows.filter((r)=>r.sameCourseCount > 0);
    if (state.filterSameDistance) rows = rows.filter((r)=>r.sameDistanceCount > 0);
    if (state.filterBoard) rows = rows.filter((r)=>r.board3 > 0);
    if (state.filterFastLast3f) rows = rows.filter((r)=>r.avgL3 != null && r.avgL3 <= 37.0);

    const sorters = {
      umaban: (a,b)=>(toNum(a.horse.umaban) ?? 999) - (toNum(b.horse.umaban) ?? 999),
      ai: (a,b)=>(toNum(a.horse.pred_order) ?? 999) - (toNum(b.horse.pred_order) ?? 999),
      course: (a,b)=>b.sameCourseCount - a.sameCourseCount || (toNum(a.horse.pred_order) ?? 999) - (toNum(b.horse.pred_order) ?? 999),
      finish: (a,b)=>(a.avgF ?? 999) - (b.avgF ?? 999),
      last3f: (a,b)=>(a.avgL3 ?? 999) - (b.avgL3 ?? 999),
    };
    rows.sort(sorters[state.sortKey] || sorters.umaban);
    return rows;
  }

  function topCourseRows(rows) { return rows.filter((r)=>r.sameCourseCount > 0).sort((a,b)=>b.sameCourseCount-a.sameCourseCount || (a.avgF ?? 999)-(b.avgF ?? 999)).slice(0,3); }
  function topFastRows(rows) { return rows.filter((r)=>r.avgL3 != null).sort((a,b)=>(a.avgL3 ?? 999)-(b.avgL3 ?? 999)).slice(0,3); }

  function renderLayout() {
    const root = qs('#past-app');
    if (!root) throw new Error('#past-app が見つからへん。past_detail.html に <div id="past-app"></div> を置いてな。');
    root.innerHTML = `
      <section class="past-page">
        <div id="past-status" class="page-status" hidden></div>
        <section id="past-hero" class="sheet past-hero"></section>
        <nav id="past-tabs" class="page-tab-strip"></nav>
        <section class="sheet compare-toolbar">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">比較条件</h2>
              <div class="section-subtitle">近走・同条件・上がりで素早く比較できる形にしとる。</div>
            </div>
          </div>
          <div class="compare-toolbar__row">
            <label>キーワード
              <input type="text" id="past-keyword" placeholder="馬名・騎手・調教師・競馬場">
            </label>
            <label>並び順
              <select id="past-sort">
                <option value="umaban">馬番順</option>
                <option value="ai">AI順</option>
                <option value="course">同コース経験順</option>
                <option value="finish">近3走平均着順</option>
                <option value="last3f">近3走平均上がり</option>
              </select>
            </label>
            <div>
              <div class="filter-chip-row" id="past-limit-row"></div>
            </div>
          </div>
          <div class="filter-chip-row" id="past-filter-row"></div>
          <div class="compare-toolbar__meta" id="past-filter-meta"></div>
        </section>
        <section class="sheet compare-summary-panel" id="past-summary"></section>
        <section class="sheet compare-list-panel">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">馬ごとの比較</h2>
              <div class="section-subtitle">要約だけ先に見て、必要な馬だけ展開できる。</div>
            </div>
          </div>
          <div class="compare-list" id="past-list"></div>
        </section>
      </section>
    `;
  }

  function renderHero(data) {
    const race = data.race || {};
    const hero = qs('#past-hero');
    if (!hero) return;
    const title = [currentCourse(data), race.race_no ? `${race.race_no}R` : null, raceName(data)].filter(Boolean).join(' ');
    const meta = [raceSurface(data), raceDistance(data) ? `${parseDistanceValue(raceDistance(data))}m` : null, race.going || data.horses?.[0]?.track_condition, race.headcount ? `${race.headcount}頭` : null].filter(Boolean).join(' / ');
    const topAi = (data.summary?.top_ai || []).slice(0, 3).map((h)=>`${fmt(h.umaban)} ${fmt(h.horse_name)}`).join(' / ');
    hero.innerHTML = `
      <div class="race-hero__head">
        <div>
          <div class="race-hero__date">${escapeHtml(fmt(data.race_date, ''))}</div>
          <h1 class="race-hero__title">${escapeHtml(title || '過去走比較')}</h1>
          <div class="race-hero__meta">${escapeHtml(meta || '条件情報なし')}</div>
        </div>
        <div class="tag-list">
          <span class="tag tag--blue">過去走比較</span>
          <span class="tag">${escapeHtml(currentCourse(data) || '開催不明')}</span>
        </div>
      </div>
      <div class="info-banner">AI上位: ${escapeHtml(topAi || '上位情報なし')}。近走の着順・同条件経験・上がりを一画面で比べやすくしたで。</div>
    `;
    document.title = `${title} | 過去走比較`;
  }

  function renderTabs(data) {
    const nav = qs('#past-tabs');
    if (!nav) return;
    const race = data.race || {};
    race.race_date = data.race_date;
    const items = [
      { kind: 'race', label: '出走馬一覧', active: false },
      { kind: 'past', label: '過去走比較', active: true },
      { kind: 'betting', label: '買い目作成', active: false },
    ];
    nav.innerHTML = items.map((item) => `<a class="race-tab${item.active ? ' is-active' : ''}" href="${escapeHtml(buildPageUrl(item.kind, race))}">${escapeHtml(item.label)}</a>`).join('');
  }

  function renderToolbarMeta(rows) {
    const el = qs('#past-filter-meta');
    if (!el) return;
    el.textContent = `${rows.length}頭表示 / 全${(state.data?.horses || []).length}頭`;
  }

  function renderControls() {
    const limitRow = qs('#past-limit-row');
    const filterRow = qs('#past-filter-row');
    if (!limitRow || !filterRow) return;

    const limitItems = [
      { value: 3, label: '近3走' },
      { value: 5, label: '近5走' },
    ];
    limitRow.innerHTML = limitItems.map((item) => `<button type="button" class="filter-chip${state.viewLimit === item.value ? ' is-active' : ''}" data-limit="${item.value}">${item.label}</button>`).join('');

    const filters = [
      { key: 'sameCourse', label: '同コース' },
      { key: 'sameDistance', label: '同距離' },
      { key: 'board', label: '近3走掲示板' },
      { key: 'fastLast3f', label: '上がり優秀' },
    ];
    filterRow.innerHTML = filters.map((item) => {
      const on = item.key === 'sameCourse' ? state.filterSameCourse : item.key === 'sameDistance' ? state.filterSameDistance : item.key === 'board' ? state.filterBoard : state.filterFastLast3f;
      return `<button type="button" class="filter-chip${on ? ' is-active' : ''}" data-filter="${item.key}">${item.label}</button>`;
    }).join('') + `<button type="button" class="filter-chip is-ghost" id="past-clear-filter">絞り込み解除</button>`;

    qs('#past-keyword').value = state.keyword;
    qs('#past-sort').value = state.sortKey;

    qsa('[data-limit]', limitRow).forEach((btn)=>btn.addEventListener('click', ()=>{ state.viewLimit = Number(btn.dataset.limit) || 3; renderSummaryAndList(); renderControls(); }));
    qsa('[data-filter]', filterRow).forEach((btn)=>btn.addEventListener('click', ()=>{
      const key = btn.dataset.filter;
      if (key === 'sameCourse') state.filterSameCourse = !state.filterSameCourse;
      if (key === 'sameDistance') state.filterSameDistance = !state.filterSameDistance;
      if (key === 'board') state.filterBoard = !state.filterBoard;
      if (key === 'fastLast3f') state.filterFastLast3f = !state.filterFastLast3f;
      renderSummaryAndList(); renderControls();
    }));
    qs('#past-clear-filter')?.addEventListener('click', ()=>{
      state.keyword = '';
      state.filterSameCourse = false;
      state.filterSameDistance = false;
      state.filterBoard = false;
      state.filterFastLast3f = false;
      state.sortKey = 'umaban';
      renderControls();
      renderSummaryAndList();
    });
    qs('#past-keyword')?.addEventListener('input', (e)=>{ state.keyword = e.target.value || ''; renderSummaryAndList(); renderToolbarMeta(filteredSummaries()); });
    qs('#past-sort')?.addEventListener('change', (e)=>{ state.sortKey = e.target.value || 'umaban'; renderSummaryAndList(); });
  }

  function summaryLine(label, row, extra) {
    if (!row) return `<div class="reason-item"><div><div class="reason-item__text">${label}</div><div class="reason-item__sub">該当なし</div></div></div>`;
    return `
      <div class="insight-item">
        <div>
          <div class="insight-item__name">${escapeHtml(label)} ${escapeHtml(fmt(row.horse.umaban))} ${escapeHtml(fmt(row.horse.horse_name))}</div>
          <div class="insight-item__sub">${escapeHtml(extra)}</div>
        </div>
      </div>
    `;
  }

  function renderSummaryAndList() {
    const rows = filteredSummaries();
    renderToolbarMeta(rows);
    const summary = qs('#past-summary');
    const list = qs('#past-list');
    if (!summary || !list) return;

    const courseRows = topCourseRows(rows);
    const fastRows = topFastRows(rows);
    const noteParts = [
      state.filterSameCourse ? '同コースのみ' : null,
      state.filterSameDistance ? '同距離のみ' : null,
      state.filterBoard ? '近3走掲示板あり' : null,
      state.filterFastLast3f ? '上がり優秀のみ' : null,
    ].filter(Boolean);

    summary.innerHTML = `
      <div class="compare-summary-grid">
        <div class="compare-note-box">
          <h2 class="compare-note-box__title">比較メモ</h2>
          <div class="compare-note-box__text">
            ${escapeHtml(currentCourse(state.data) || '当該コース')} / ${escapeHtml(surfaceOf(raceSurface(state.data)) || '条件')} / ${escapeHtml(fmt(parseDistanceValue(raceDistance(state.data)), '—'))}m を基準に、近${state.viewLimit}走で比較しとる。${noteParts.length ? `現在は ${noteParts.join('・')} で絞り込み中。` : '現在は全体比較。'}
          </div>
          <div class="tag-list" style="margin-top:10px;">
            <span class="tag tag--blue">同コース重視</span>
            <span class="tag">距離替わり: 要確認</span>
            <span class="tag">ローテ: ${escapeHtml(rows[0]?.layoff || '不明')}</span>
          </div>
        </div>
        <div class="compare-side-stack">
          <div class="compare-side-box">
            <h3 class="compare-side-box__title">同コースで気になる馬</h3>
            <div class="insight-list">
              ${courseRows.map((row) => summaryLine('注目', row, `同コース${row.sameCourseCount}回 / 平均着順${row.avgF != null ? row.avgF.toFixed(1) : '—'}`)).join('') || '<div class="compare-side-box__text">該当なし</div>'}
            </div>
          </div>
          <div class="compare-side-box">
            <h3 class="compare-side-box__title">上がり優秀</h3>
            <div class="insight-list">
              ${fastRows.map((row) => summaryLine('上がり', row, `近3走平均上がり${row.avgL3 != null ? row.avgL3.toFixed(1) : '—'} / ${row.style}`)).join('') || '<div class="compare-side-box__text">該当なし</div>'}
            </div>
          </div>
        </div>
      </div>
    `;

    if (!rows.length) {
      list.innerHTML = `<div class="empty-panel">条件に合う馬がおらへん。絞り込みを少し戻してみてな。</div>`;
      return;
    }

    list.innerHTML = rows.map((row) => {
      const horse = row.horse;
      const id = String(horse.horse_id ?? horse.umaban ?? horse.horse_name ?? '');
      const expanded = state.expanded.has(id);
      const recentRuns = row.runs.slice(0, state.viewLimit);
      const topTags = [];
      if (row.sameCourseCount > 0) topTags.push(`<span class="tag tag--blue">同コース${row.sameCourseCount}</span>`);
      if (row.sameDistanceCount > 0) topTags.push(`<span class="tag">同距離${row.sameDistanceCount}</span>`);
      if (row.board3 > 0) topTags.push(`<span class="tag tag--plus">近3走掲示板${row.board3}</span>`);
      if (row.avgL3 != null && row.avgL3 <= 37.0) topTags.push(`<span class="tag tag--plus">上がり優秀</span>`);
      return `
        <article class="card compare-card">
          <div class="compare-card__head">
            <div class="compare-card__horse">
              <div class="horse-no">${escapeHtml(fmt(horse.umaban))}</div>
              <div>
                <h3 class="compare-card__name">${escapeHtml(fmt(horse.horse_name))}</h3>
                <div class="compare-card__sub">AI${escapeHtml(fmt(horse.pred_order))} / 単勝${escapeHtml(fmtNum(horse.tansho_odds, 1))} / 人気${escapeHtml(fmt(horse.popularity))} / ${escapeHtml(fmt(horse.jockey))}</div>
                <div class="tag-list" style="margin-top:8px;">${topTags.join('') || '<span class="tag">比較タグなし</span>'}</div>
              </div>
            </div>
            <div class="compare-kpi-grid">
              <div class="compare-kpi"><div class="compare-kpi__label">近3走平均着順</div><div class="compare-kpi__value">${escapeHtml(row.avgF != null ? row.avgF.toFixed(1) : '—')}</div></div>
              <div class="compare-kpi"><div class="compare-kpi__label">近3走平均上がり</div><div class="compare-kpi__value">${escapeHtml(row.avgL3 != null ? row.avgL3.toFixed(1) : '—')}</div></div>
              <div class="compare-kpi"><div class="compare-kpi__label">脚質傾向</div><div class="compare-kpi__value">${escapeHtml(row.style)}</div></div>
            </div>
            <div class="compare-card__right">
              <span class="badge badge--plain">${escapeHtml(row.distanceChange)}</span>
              <span class="badge badge--plain">${escapeHtml(row.layoff)}</span>
              <button type="button" class="horse-toggle" data-toggle="${escapeHtml(id)}">${expanded ? '閉じる' : '近走を開く'}</button>
            </div>
          </div>
          <div class="compare-card__body" ${expanded ? '' : 'hidden'}>
            <div class="detail-box">
              <h4 class="detail-box__title">比較要約</h4>
              <div class="detail-kv">
                <div class="detail-kv__item"><div class="detail-kv__label">近3走</div><div class="detail-kv__value">${escapeHtml(recentRuns.map((r)=>fmt(r.finish)).join(' → ') || '—')}</div></div>
                <div class="detail-kv__item"><div class="detail-kv__label">同コース / 同距離</div><div class="detail-kv__value">${escapeHtml(`${row.sameCourseCount}回 / ${row.sameDistanceCount}回`)}</div></div>
                <div class="detail-kv__item"><div class="detail-kv__label">前走ひとこと</div><div class="detail-kv__value">${escapeHtml(recentRuns[0] ? `${fmt(recentRuns[0].finish)}着・${fmt(runDistanceText(recentRuns[0]))}・上がり${fmtNum(recentRuns[0].last3f, 1)}` : '前走データなし')}</div></div>
                <div class="detail-kv__item"><div class="detail-kv__label">メモ</div><div class="detail-kv__value">${escapeHtml(row.board3 > 0 ? '近走で掲示板実績あり。' : '近走はやや詰めたい。')}</div></div>
              </div>
            </div>
            <div class="run-card-grid">
              ${recentRuns.length ? recentRuns.map((run) => `
                <section class="run-card">
                  <div class="run-card__head">
                    <div>
                      <h4 class="run-card__title">${escapeHtml(fmt(run.date, '日付不明'))} ${escapeHtml(fmt(run.race_name, '前走'))}</h4>
                      <div class="run-card__meta">${escapeHtml(runCourse(run) || '開催不明')} / ${escapeHtml(runDistanceText(run) || '距離不明')} / ${escapeHtml(fmt(run.going, '馬場不明'))}</div>
                    </div>
                    <div class="tag-list">
                      <span class="badge badge--plain">${escapeHtml(`${fmt(run.finish)}着`)}</span>
                      <span class="badge badge--plain">${escapeHtml(`${fmt(run.popularity)}人気`)}</span>
                    </div>
                  </div>
                  <div class="run-card__stat-row">
                    ${sameCourse(run, state.data) ? '<span class="tag tag--blue">同コース</span>' : ''}
                    ${sameDistance(run, state.data) ? '<span class="tag">同距離</span>' : ''}
                    ${toNum(run.finish) != null && toNum(run.finish) <= 5 ? '<span class="tag tag--plus">掲示板内</span>' : ''}
                  </div>
                  <div class="run-card__table">
                    <div class="run-kv"><div class="run-kv__label">人気 / 単勝</div><div class="run-kv__value">${escapeHtml(`${fmt(run.popularity)}人気 / ${fmtNum(run.win_odds, 1)}`)}</div></div>
                    <div class="run-kv"><div class="run-kv__label">騎手</div><div class="run-kv__value">${escapeHtml(fmt(run.jockey))}</div></div>
                    <div class="run-kv"><div class="run-kv__label">上がり</div><div class="run-kv__value">${escapeHtml(fmtNum(run.last3f, 1))}</div></div>
                    <div class="run-kv"><div class="run-kv__label">通過</div><div class="run-kv__value">${escapeHtml(fmt(run.passing))}</div></div>
                    <div class="run-kv"><div class="run-kv__label">タイム</div><div class="run-kv__value">${escapeHtml(fmt(run.time))}</div></div>
                    <div class="run-kv"><div class="run-kv__label">着差</div><div class="run-kv__value">${escapeHtml(fmtNum(run.margin, 1))}</div></div>
                  </div>
                </section>
              `).join('') : '<div class="empty-panel">過去走データなし</div>'}
            </div>
          </div>
        </article>
      `;
    }).join('');

    qsa('[data-toggle]', list).forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.dataset.toggle;
      if (!id) return;
      if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
      renderSummaryAndList();
    }));
  }

  async function init() {
    try {
      renderLayout();
      setStatus('読み込み中...');
      state.data = await fetchJson(getJsonPath());
      renderHero(state.data);
      renderTabs(state.data);
      renderControls();
      renderSummaryAndList();
      setStatus('');
      qs('#past-status').hidden = true;
    } catch (err) {
      console.error(err);
      setStatus(err?.message || '表示に失敗したで。', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
