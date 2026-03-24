(function () {
  'use strict';

  const PAGE_DEFAULTS = {
    index: 'index.html',
    race: 'race_detail.html',
    past: 'past_detail.html',
    betting: 'betting.html',
  };

  const JRA_PLACE_MAP = {
    '01': '札幌',
    '02': '函館',
    '03': '福島',
    '04': '新潟',
    '05': '東京',
    '06': '中山',
    '07': '中京',
    '08': '京都',
    '09': '阪神',
    '10': '小倉',
  };

  const state = {
    index: null,
    dates: [],
    selectedDate: null,
    races: [],
    filteredRaces: [],
    keyword: '',
    course: '',
    oddsOnly: false,
  };

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toNumber(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function fmt(value, fallback = '—') {
    return value == null || value === '' ? fallback : String(value);
  }

  function fmtNum(value, digits = 1, fallback = '—') {
    const n = toNumber(value);
    return n == null ? fallback : n.toFixed(digits).replace(/\.0$/, '');
  }

  function fmtPct(value, digits = 1, fallback = '—') {
    const n = toNumber(value);
    return n == null ? fallback : `${(n * 100).toFixed(digits)}%`;
  }

  function getDataRoot() {
    return document.body?.dataset?.dataRoot || './data';
  }

  function getPageName(kind) {
    return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind];
  }

  function getRequestedDate() {
    const params = new URLSearchParams(window.location.search);
    return params.get('date') || document.body?.dataset?.raceDate || null;
  }

  function updateUrl(date) {
    const url = new URL(window.location.href);
    if (date) url.searchParams.set('date', date);
    else url.searchParams.delete('date');
    history.replaceState({}, '', url);
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`);
    return res.json();
  }

  function setStatus(message, isError = false) {
    const el = qs('#index-status');
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle('is-error', !!isError);
  }

  function clearStatus() {
    const el = qs('#index-status');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-error');
  }

  function baseLayout() {
    const root = qs('#index-app');
    if (!root) {
      throw new Error('#index-app が見つからへん。index.html に <div id="index-app"></div> を置いてな。');
    }

    root.innerHTML = `
      <section class="index-page">
        <div id="index-status" class="page-status" hidden></div>

        <section class="index-page__hero page-card">
          <div class="index-hero__main">
            <div class="race-title-sub">予想サイトトップ</div>
            <h1 class="race-title-main">予想まとめ</h1>
            <div class="race-title-meta">日付ごとに予想一覧を見て、出走馬一覧・過去走比較・買い目作成へ移動できる。</div>
          </div>
          <div class="index-hero__stats" id="index-hero-stats"></div>
        </section>

        <section class="page-card">
          <div class="section-title-row">
            <h2 class="section-title">開催日</h2>
            <div class="section-subtitle">最新日付を自動選択。切り替えるとその日のレース一覧を更新する。</div>
          </div>
          <div id="date-chip-row" class="date-chip-row"></div>
        </section>

        <section class="page-card">
          <div class="section-title-row">
            <h2 class="section-title">絞り込み</h2>
            <div class="section-subtitle">競馬場やレース名、上位馬名で絞れる。</div>
          </div>
          <div class="control-row">
            <label class="control-grow">
              キーワード
              <input id="filter-keyword" type="text" placeholder="レース名・馬名・競馬場">
            </label>
            <label>
              競馬場
              <select id="filter-course">
                <option value="">すべて</option>
              </select>
            </label>
            <label class="check-label">
              <span>単勝オッズあり</span>
              <input id="filter-odds-only" type="checkbox">
            </label>
            <div class="filter-action-row">
              <button id="filter-reset" type="button">絞り込み解除</button>
            </div>
          </div>
        </section>

        <section class="page-card">
          <div class="section-title-row">
            <h2 class="section-title">レース一覧</h2>
            <div id="race-list-meta" class="section-subtitle"></div>
          </div>
          <div id="race-grid" class="race-grid"></div>
        </section>
      </section>
    `;
  }

  function renderHeroStats() {
    const el = qs('#index-hero-stats');
    if (!el) return;

    const totalDates = state.dates.length;
    const totalRaces = state.dates.reduce((sum, d) => sum + (toNumber(d.race_count) || 0), 0);
    const selectedCount = state.races.length;

    el.innerHTML = [
      { label: '開催日数', value: fmt(totalDates) },
      { label: '総レース数', value: fmt(totalRaces) },
      { label: '選択日レース数', value: fmt(selectedCount) },
    ].map((item) => `
      <div class="hero-stat-card">
        <div class="hero-stat-card__label">${escapeHtml(item.label)}</div>
        <div class="hero-stat-card__value">${escapeHtml(item.value)}</div>
      </div>
    `).join('');
  }

  function renderDates() {
    const row = qs('#date-chip-row');
    if (!row) return;

    row.innerHTML = state.dates.map((item) => {
      const active = item.race_date === state.selectedDate;
      return `
        <button class="date-chip${active ? ' is-active' : ''}" type="button" data-date="${escapeHtml(item.race_date)}">
          <span class="date-chip__date">${escapeHtml(item.race_date)}</span>
          <span class="date-chip__meta">${escapeHtml(fmt(item.race_count))}R</span>
        </button>
      `;
    }).join('');

    row.querySelectorAll('[data-date]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const date = btn.getAttribute('data-date');
        if (!date || date === state.selectedDate) return;
        await loadDate(date);
      });
    });
  }

  function currentDateInfo() {
    return state.dates.find((d) => d.race_date === state.selectedDate) || null;
  }

  function normalizeCourse(race) {
    if (race.course) return String(race.course);
    if (race.course_name) {
      const text = String(race.course_name);
      for (const name of Object.values(JRA_PLACE_MAP)) {
        if (text.includes(name)) return name;
      }
      return text;
    }
    const rid = String(race.race_id || '').replace(/\D/g, '');
    if (rid.length >= 6) return JRA_PLACE_MAP[rid.slice(4, 6)] || '';
    return '';
  }

  function populateCourseFilter() {
    const select = qs('#filter-course');
    if (!select) return;
    const current = select.value;
    const courses = Array.from(new Set(
      state.races.map((r) => normalizeCourse(r)).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'ja'));

    select.innerHTML = ['<option value="">すべて</option>']
      .concat(courses.map((course) => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`))
      .join('');

    if (courses.includes(current)) select.value = current;
    else state.course = '';
  }

  function buildRacePageUrl(kind, race) {
    const params = new URLSearchParams({
      date: state.selectedDate,
      race_id: race.race_id,
    });
    return `${getPageName(kind)}?${params.toString()}`;
  }

  function getTopHorseNames(race) {
    const list = Array.isArray(race.top_ai) ? race.top_ai : [];
    return list.map((h) => h && h.horse_name).filter(Boolean);
  }

  function applyFilters() {
    const keyword = state.keyword.trim().toLowerCase();
    const course = state.course;
    const oddsOnly = state.oddsOnly;

    state.filteredRaces = state.races.filter((race) => {
      const raceCourse = normalizeCourse(race);
      const raceText = [
        race.race_no != null ? `${race.race_no}R` : '',
        race.race_name,
        race.course,
        race.course_name,
        ...getTopHorseNames(race),
      ].join(' ').toLowerCase();

      if (keyword && !raceText.includes(keyword)) return false;
      if (course && raceCourse !== course) return false;
      if (oddsOnly) {
        const hasOdds = (Array.isArray(race.top_ai) ? race.top_ai : []).some((h) => toNumber(h?.tansho_odds) != null);
        if (!hasOdds) return false;
      }
      return true;
    }).sort((a, b) => {
      const an = toNumber(a.race_no);
      const bn = toNumber(b.race_no);
      if (an != null && bn != null && an !== bn) return an - bn;
      return String(a.race_id || '').localeCompare(String(b.race_id || ''));
    });
  }

  function renderRaceCards() {
    applyFilters();

    const meta = qs('#race-list-meta');
    const grid = qs('#race-grid');
    if (!grid) return;

    const info = currentDateInfo();
    if (meta) {
      meta.textContent = `${fmt(state.selectedDate)} / ${fmt(state.filteredRaces.length)}件表示 / 全${fmt(info?.race_count ?? state.races.length)}R`;
    }

    if (!state.filteredRaces.length) {
      grid.innerHTML = '<div class="empty-panel">該当レースがないで。</div>';
      return;
    }

    grid.innerHTML = state.filteredRaces.map((race) => {
      const topAi = Array.isArray(race.top_ai) ? race.top_ai.slice(0, 3) : [];
      const course = normalizeCourse(race);
      const metaBits = [
        race.race_no != null ? `${race.race_no}R` : null,
        course || race.course_name,
        race.surface,
        race.distance ? `${race.distance}m` : null,
        race.going,
        race.headcount ? `${race.headcount}頭` : null,
      ].filter(Boolean);

      const topHtml = topAi.length ? topAi.map((h) => `
        <div class="mini-horse-card">
          <div class="mini-horse-card__rank">AI ${escapeHtml(fmt(h.pred_order))}</div>
          <div class="mini-horse-card__name">${escapeHtml(`${fmt(h.umaban)} ${fmt(h.horse_name)}`)}</div>
          <div class="mini-horse-card__meta">
            <span>勝率 ${escapeHtml(fmtPct(h.p_win))}</span>
            <span>複勝率 ${escapeHtml(fmtPct(h.p_top3))}</span>
            <span>単勝 ${escapeHtml(fmtNum(h.tansho_odds))}</span>
            <span>人気 ${escapeHtml(fmt(h.popularity))}</span>
          </div>
        </div>
      `).join('') : '<div class="empty-text">上位馬情報なし</div>';

      return `
        <article class="race-card">
          <div class="race-card__head">
            <div>
              <div class="race-card__sub">${escapeHtml(state.selectedDate)}</div>
              <h3 class="race-card__title">${escapeHtml([race.race_no != null ? `${race.race_no}R` : '', race.race_name].filter(Boolean).join(' '))}</h3>
              <div class="race-card__meta">${escapeHtml(metaBits.join(' / ') || '条件情報なし')}</div>
            </div>
            <div class="race-card__actions">
              <a class="page-link-btn" href="${escapeHtml(buildRacePageUrl('race', race))}">出走馬一覧</a>
              <a class="page-link-btn" href="${escapeHtml(buildRacePageUrl('past', race))}">過去走比較</a>
              <a class="page-link-btn" href="${escapeHtml(buildRacePageUrl('betting', race))}">買い目作成</a>
            </div>
          </div>

          <div class="tag-list race-card__tags">
            <span class="tag">race_id ${escapeHtml(fmt(race.race_id))}</span>
            ${course ? `<span class="tag">${escapeHtml(course)}</span>` : ''}
            ${race.going ? `<span class="tag">${escapeHtml(String(race.going))}</span>` : ''}
            ${race.surface ? `<span class="tag">${escapeHtml(String(race.surface))}</span>` : ''}
          </div>

          <div class="mini-horse-grid">${topHtml}</div>
        </article>
      `;
    }).join('');
  }

  function bindControls() {
    const keywordInput = qs('#filter-keyword');
    const courseSelect = qs('#filter-course');
    const oddsOnlyInput = qs('#filter-odds-only');
    const resetBtn = qs('#filter-reset');

    keywordInput?.addEventListener('input', () => {
      state.keyword = keywordInput.value || '';
      renderRaceCards();
    });

    courseSelect?.addEventListener('change', () => {
      state.course = courseSelect.value || '';
      renderRaceCards();
    });

    oddsOnlyInput?.addEventListener('change', () => {
      state.oddsOnly = !!oddsOnlyInput.checked;
      renderRaceCards();
    });

    resetBtn?.addEventListener('click', () => {
      state.keyword = '';
      state.course = '';
      state.oddsOnly = false;
      if (keywordInput) keywordInput.value = '';
      if (courseSelect) courseSelect.value = '';
      if (oddsOnlyInput) oddsOnlyInput.checked = false;
      renderRaceCards();
    });
  }

  async function loadIndex() {
    const path = `${getDataRoot()}/index.json`;
    state.index = await fetchJson(path);
    state.dates = Array.isArray(state.index?.dates) ? state.index.dates.slice() : [];
    state.dates.sort((a, b) => String(b.race_date || '').localeCompare(String(a.race_date || '')));

    if (!state.dates.length) {
      throw new Error('index.json に dates が入ってへん。');
    }
  }

  async function loadDate(date) {
    setStatus(`${date} のレース一覧を読み込み中...`);

    const path = `${getDataRoot()}/${date}/races.json`;
    const payload = await fetchJson(path);
    state.selectedDate = date;
    state.races = Array.isArray(payload?.races) ? payload.races.slice() : [];
    updateUrl(date);

    renderHeroStats();
    renderDates();
    populateCourseFilter();
    renderRaceCards();
    clearStatus();
  }

  async function init() {
    baseLayout();
    bindControls();
    setStatus('トップJSONを読み込み中...');

    await loadIndex();
    renderHeroStats();
    renderDates();

    const requested = getRequestedDate();
    const fallback = state.dates[0]?.race_date || null;
    const target = state.dates.some((d) => d.race_date === requested) ? requested : fallback;
    if (!target) throw new Error('表示できる開催日がない。');

    await loadDate(target);
  }

  init().catch((err) => {
    console.error(err);
    setStatus(err?.message || '初期化に失敗したで。', true);
  });
})();
