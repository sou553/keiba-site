(function () {
  'use strict';

  const PAGE_DEFAULTS = { race: 'race_detail.html', past: 'past_detail.html', betting: 'betting.html', jockeys: 'jockeys.html' };
  const state = { dates: [], selectedDate: null, races: [], details: new Map(), keyword: '', course: '', oddsOnly: false, divergenceOnly: false };
  const qs = (s, r = document) => r.querySelector(s);
  const RA = window.RaceAnalysis;

  function getDataRoot() { return document.body?.dataset?.dataRoot || './data'; }
  function getPage(kind) { return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind]; }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`);
    return res.json();
  }

  function setStatus(msg, isError = false) {
    const el = qs('#index-status');
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle('is-error', !!isError);
  }

  function clearStatus() {
    const el = qs('#index-status');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-error');
  }

  function buildUrl(kind, raceId, date) {
    return `${getPage(kind)}?${new URLSearchParams({ date, race_id: raceId }).toString()}`;
  }

  function buildJockeysUrl(date) {
    return `${getPage('jockeys')}?${new URLSearchParams({ date }).toString()}`;
  }

  function normalizeDateKey(value) {
    return Number(String(value || '').replace(/\D/g, '')) || 0;
  }

  function sortDatesDesc(list) {
    return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
      const diff = normalizeDateKey(b?.race_date) - normalizeDateKey(a?.race_date);
      if (diff !== 0) return diff;
      return (Number(b?.race_count) || 0) - (Number(a?.race_count) || 0);
    });
  }

  function scrollActiveDateChipIntoView(behavior = 'auto') {
    const wrap = qs('#date-strip');
    const active = qs('#date-strip .date-chip.is-active');
    if (!wrap || !active) return;

    const margin = 12;
    const chipLeft = active.offsetLeft;
    const chipRight = chipLeft + active.offsetWidth;
    const viewLeft = wrap.scrollLeft;
    const viewRight = viewLeft + wrap.clientWidth;

    let nextLeft = null;

    if (chipLeft - margin < viewLeft) {
      nextLeft = Math.max(0, chipLeft - margin);
    } else if (chipRight + margin > viewRight) {
      nextLeft = Math.max(0, chipRight - wrap.clientWidth + margin);
    }

    if (nextLeft !== null) {
      wrap.scrollTo({
        left: nextLeft,
        behavior
      });
    }
  }

  function layout() {
    const root = qs('#index-app');
    if (!root) return;

    root.innerHTML = `
      <div class="index-page">
        <div id="index-status" class="page-status" hidden></div>
        <section class="index-hero card">
          <div class="index-hero__text">
            <div class="badge badge--blue">予想まとめ</div>
            <h1>予想トップ</h1>
            <p>出走馬一覧・過去走比較・買い目作成</p>
          </div>
          <div id="hero-stats" class="hero-stats"></div>
        </section>

        <section class="card filter-panel">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">開催日</h2>
              <!--<div class="section-subtitle">横スクロール対応。新しい日付から順に表示。</div>-->
            </div>
          </div>
          <div id="date-strip" class="date-strip"></div>
        </section>

        <section class="card filter-panel">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">絞り込み</h2>
              <div class="section-subtitle">競馬場、キーワード、単勝あり、人気乖離ありで絞れる。</div>
            </div>
          </div>
          <div class="filter-grid">
            <label>キーワード<input id="filter-keyword" type="text" placeholder="レース名・馬名・競馬場"></label>
            <label>競馬場<select id="filter-course"><option value="">すべて</option></select></label>
            <label class="check-pill"><input id="filter-odds" type="checkbox"> 単勝オッズあり</label>
            <label class="check-pill"><input id="filter-divergence" type="checkbox"> 人気乖離あり</label>
          </div>
          <div style="margin-top:12px; display:flex; justify-content:flex-end;">
            <button id="filter-reset" type="button">絞り込み解除</button>
          </div>
        </section>

        <section class="card race-list-panel">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">レース一覧</h2>
              <div id="race-meta" class="section-subtitle"></div>
            </div>
          </div>
          <div id="race-list" class="race-list"></div>
        </section>
      </div>`;
  }

  function renderHeroStats() {
    const el = qs('#hero-stats');
    if (!el) return;

    const totalDates = state.dates.length;
    const totalRaces = state.races.length;
    const analyzed = Array.from(state.details.values()).length;

    el.innerHTML = [
      ['開催日数', totalDates],
      ['選択日レース数', totalRaces],
      ['詳細読込', analyzed]
    ].map(([label, value]) => `
      <div class="hero-stat">
        <div class="hero-stat__label">${RA.esc(label)}</div>
        <div class="hero-stat__value">${RA.esc(value)}</div>
      </div>
    `).join('');
  }

  function renderDates() {
    const wrap = qs('#date-strip');
    if (!wrap) return;

    wrap.innerHTML = state.dates.map((d) => `
      <button
        type="button"
        class="date-chip${state.selectedDate === d.race_date ? ' is-active' : ''}"
        data-date="${RA.esc(d.race_date)}"
      >
        ${RA.esc(d.race_date)}
        <span class="date-chip__meta">${RA.esc(d.race_count)}R</span>
      </button>
    `).join('');

    wrap.querySelectorAll('[data-date]').forEach((btn) => btn.addEventListener('click', async () => {
      state.selectedDate = btn.dataset.date;

      renderDates();
      requestAnimationFrame(() => scrollActiveDateChipIntoView('smooth'));

      await loadRaces(state.selectedDate);

      renderDates();
      requestAnimationFrame(() => scrollActiveDateChipIntoView('smooth'));
    }));
  }

  function courseOptions(races) {
    return [...new Set((races || []).map((r) => r.course || '').filter(Boolean))].sort();
  }

  function raceHasOdds(data) {
    return (data?.horses || []).some((h) => RA.toNum(h.tansho_odds) !== null);
  }

  function raceHasDivergence(data) {
    const a = data?._analysis;
    return !!(a && (
      a.holeCandidates.length ||
      a.dangerPopulars.length ||
      a.courseValueList.length ||
      a.courseDangerList.length
    ));
  }

  function raceMatch(detail) {
    const race = detail.race || {};

    if (state.course && String(race.course || '') !== state.course) return false;
    if (state.oddsOnly && !raceHasOdds(detail)) return false;
    if (state.divergenceOnly && !raceHasDivergence(detail)) return false;

    const kw = state.keyword.trim().toLowerCase();
    if (!kw) return true;

    const hay = [
      race.race_name,
      race.course,
      ...(detail.horses || []).slice(0, 6).map((h) => h.horse_name)
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return hay.includes(kw);
  }

  function predictionBlock(detail) {
    const s = detail._analysis?.summary;
    if (!s) return '';

    const main = s.mainHorse;
    const hole = s.holeHorses?.[0] || null;
    const danger = s.dangerHorses?.[0] || null;
    const lines = s.lineHorses?.slice(0, 2) || [];

    return `
      <div class="race-row__summary">
        <div class="top-pick-box ${topPickBoxClass(s.status)}">
          <div class="top-pick-box__label">${RA.esc(s.status || '予想まとめ')}</div>
          ${main ? `<div class="top-pick-box__name">◎ ${RA.esc(main.umaban)} ${RA.esc(main.horse_name)}</div>` : ''}
          <div class="top-pick-box__meta">
            ${main
              ? `勝率 ${RA.fmtPct(main.p_win)} / 複勝率 ${RA.fmtPct(main.p_top3)} / 単勝 ${RA.fmtNum(main.tansho_odds)} / 人気 ${RA.fmt(main.popularity)}`
              : '上位評価を読み込み中'}
          </div>
          ${lines.length ? `<div class="inline-note" style="margin-top:6px;">相手: ${lines.map((h) => `${RA.esc(h.umaban)} ${RA.esc(h.horse_name)}`).join(' / ')}</div>` : ''}
        </div>
        <div class="race-row__state">
          <span class="badge ${s.status === '本命寄り' ? 'badge--blue' : s.status === '見送り寄り' ? 'badge--red' : 'badge--warn'}">${RA.esc(s.status || '混戦')}</span>
          ${hole ? `<span class="tag tag--plus">穴 ${RA.esc(hole.umaban)} ${RA.esc(hole.horse_name)}</span>` : ''}
          ${danger ? `<span class="tag tag--minus">危険 ${RA.esc(danger.umaban)} ${RA.esc(danger.horse_name)}</span>` : ''}
          ${(s.popularSummary || []).slice(0, 2).map((p) => `
            <span class="mini-pill ${popularClass(p.label)}">
              ${RA.esc(p.popularity)}人気 ${RA.esc(p.umaban)} ${RA.esc(p.label || '妥当')}
            </span>
          `).join('')}
        </div>
      </div>`;
  }

  function topPickBoxClass(status) {
    if (status === '本命寄り') return 'top-pick-box--honmei';
    if (status === '見送り寄り') return 'top-pick-box--miokuri';
    return 'top-pick-box--konsen';
  }

  function popularClass(label) {
    if (label === '信頼') return 'mini-pill--trust';
    if (label === '危険') return 'mini-pill--danger';
    if (label === 'やや危険') return 'mini-pill--warn';
    return 'mini-pill--plain';
  }

  function renderRaceList() {
    const list = qs('#race-list');
    const meta = qs('#race-meta');
    if (!list) return;

    const details = Array.from(state.details.values()).filter(raceMatch);
    if (meta) {
      meta.textContent = `${state.selectedDate || '—'} / ${details.length}件表示 / 全${state.races.length}R`;
    }

    if (!details.length) {
      list.innerHTML = '<div class="sheet empty-state">該当レースなし</div>';
      return;
    }

    list.innerHTML = details.map((detail) => {
      const race = detail.race || {};
      const courseLine = [
        race.race_no ? `${race.race_no}R` : '',
        race.course,
        race.surface,
        race.distance ? `${race.distance}m` : '',
        race.headcount ? `${race.headcount}頭` : ''
      ].filter(Boolean).join(' / ');

      return `
        <article class="sheet race-row">
          <div class="race-row__top">
            <div class="race-row__title-block">
              <div class="race-row__date">${RA.esc(detail.race_date || '')}</div>
              <h3 class="race-row__title">${RA.esc(race.race_no ? `${race.race_no}R ` : '')}${RA.esc(race.race_name || '')}</h3>
              <div class="race-row__meta">${RA.esc(courseLine)}</div>
              <div class="race-row__state">
                <span class="tag tag--blue">race_id ${RA.esc(race.race_id || '')}</span>
              </div>
            </div>
            ${predictionBlock(detail)}
          </div>
          <div class="race-row__actions">
            <a class="action-link action-link--primary" href="${RA.esc(buildUrl('race', race.race_id, detail.race_date))}">出走馬一覧</a>
            <a class="action-link" href="${RA.esc(buildUrl('past', race.race_id, detail.race_date))}">過去走比較</a>
            <a class="action-link" href="${RA.esc(buildUrl('betting', race.race_id, detail.race_date))}">買い目作成</a>
          </div>
        </article>`;
    }).join('');
  }

  function bindFilters() {
    qs('#filter-keyword')?.addEventListener('input', (e) => {
      state.keyword = e.target.value || '';
      renderRaceList();
    });

    qs('#filter-course')?.addEventListener('change', (e) => {
      state.course = e.target.value || '';
      renderRaceList();
    });

    qs('#filter-odds')?.addEventListener('change', (e) => {
      state.oddsOnly = !!e.target.checked;
      renderRaceList();
    });

    qs('#filter-divergence')?.addEventListener('change', (e) => {
      state.divergenceOnly = !!e.target.checked;
      renderRaceList();
    });

    qs('#filter-reset')?.addEventListener('click', () => {
      state.keyword = '';
      state.course = '';
      state.oddsOnly = false;
      state.divergenceOnly = false;

      const keyword = qs('#filter-keyword');
      const course = qs('#filter-course');
      const odds = qs('#filter-odds');
      const divergence = qs('#filter-divergence');

      if (keyword) keyword.value = '';
      if (course) course.value = '';
      if (odds) odds.checked = false;
      if (divergence) divergence.checked = false;

      renderRaceList();
    });
  }

  async function loadRaces(date) {
    setStatus('開催日のレース一覧を読み込み中…');

    const data = await fetchJson(`${getDataRoot()}/${date}/races.json`);
    state.races = data.races || [];

    const select = qs('#filter-course');
    if (select) {
      select.innerHTML = `<option value="">すべて</option>${
        courseOptions(state.races).map((c) => `<option value="${RA.esc(c)}">${RA.esc(c)}</option>`).join('')
      }`;
    }

    state.details = new Map();
    renderHeroStats();
    renderRaceList();
    clearStatus();

    await loadRaceDetails(date);
  }

  async function loadRaceDetails(date) {
    setStatus('各レースの人気判定と予想まとめを計算中…');

    const tasks = state.races.map(async (race) => {
      const path = `${getDataRoot()}/${race.detail_path || `${date}/race_${race.race_id}.json`}`;
      const detail = await fetchJson(path);
      detail._analysis = RA.analyzeRaceHorses(detail.horses || []);
      return detail;
    });

    const results = await Promise.all(tasks);
    results.forEach((detail) => state.details.set(detail.race?.race_id || detail.race_id, detail));

    renderHeroStats();
    renderRaceList();
    clearStatus();
  }

  async function init() {
    try {
      layout();
      bindFilters();

      setStatus('開催日一覧を読み込み中…');
      const idx = await fetchJson(`${getDataRoot()}/index.json`);

      state.dates = sortDatesDesc(idx.dates || []);
      state.selectedDate = new URLSearchParams(location.search).get('date') || state.dates[0]?.race_date || null;

      renderDates();
      renderHeroStats();

      if (!state.selectedDate) {
        throw new Error('開催日データが見つからへん');
      }

      await loadRaces(state.selectedDate);

      renderDates();
      requestAnimationFrame(() => scrollActiveDateChipIntoView('auto'));
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'index.js 初期化に失敗した', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();