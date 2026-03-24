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
    dates: [],
    selectedDate: null,
    races: [],
    filtered: [],
    keyword: '',
    course: '',
    oddsOnly: false,
    divergenceOnly: false,
  };

  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
    return n === null ? fb : `${(n * 100).toFixed(d)}%`.replace(/\.0%$/, '%');
  };

  function getDataRoot() {
    return document.body?.dataset?.dataRoot || './data';
  }

  function getPage(kind) {
    return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind];
  }

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

  function normalizeCourse(race) {
    if (race.course) return String(race.course);
    const text = String(race.course_name || '');
    for (const name of Object.values(JRA_PLACE_MAP)) {
      if (text.includes(name)) return name;
    }
    const rid = String(race.race_id || '').replace(/\D/g, '');
    if (rid.length >= 6) return JRA_PLACE_MAP[rid.slice(4, 6)] || '';
    return '';
  }

  function raceStateLabel(race) {
    const top = Array.isArray(race.top_ai) ? race.top_ai : [];
    const p1 = toNum(top[0]?.p_win);
    const p2 = toNum(top[1]?.p_win);
    const odds1 = toNum(top[0]?.tansho_odds);

    if (p1 !== null && p2 !== null && p1 - p2 <= 0.035) return ['混戦', 'badge--warn'];
    if (p1 !== null && p1 >= 0.45 && odds1 !== null && odds1 <= 3.5) return ['本命堅め', 'badge--blue'];
    if (p1 !== null && p1 < 0.24) return ['見送り寄り', 'badge--red'];
    return ['標準', 'badge--plain'];
  }

  function quickInsight(race) {
    const top = Array.isArray(race.top_ai) ? race.top_ai : [];
    if (!top.length) return '上位候補情報なし';
    const top1 = top[0];
    const top2 = top[1];
    const p1 = toNum(top1?.p_win);
    const p2 = toNum(top2?.p_win);
    const pop1 = toNum(top1?.popularity);

    if (p1 !== null && p2 !== null && p1 - p2 >= 0.10) {
      return `本命 ${fmt(top1.umaban)} ${fmt(top1.horse_name)} が優勢`;
    }
    if (pop1 !== null && pop1 >= 5) {
      return `AI上位に人気薄気配あり: ${fmt(top1.umaban)} ${fmt(top1.horse_name)}`;
    }
    if (p1 !== null && p2 !== null && p1 - p2 <= 0.035) {
      return '上位拮抗。相手比較を優先';
    }
    return `中心候補: ${fmt(top1.umaban)} ${fmt(top1.horse_name)}`;
  }

  function hasOdds(race) {
    return (Array.isArray(race.top_ai) ? race.top_ai : []).some((h) => toNum(h?.tansho_odds) !== null);
  }

  function hasDivergence(race) {
    const top = Array.isArray(race.top_ai) ? race.top_ai : [];
    return top.some((h) => {
      const po = toNum(h?.popularity);
      const ai = toNum(h?.pred_order);
      return po !== null && ai !== null && Math.abs(po - ai) >= 3;
    });
  }

  function buildPageUrl(kind, race) {
    const params = new URLSearchParams({ date: state.selectedDate, race_id: race.race_id });
    return `${getPage(kind)}?${params.toString()}`;
  }

  function baseLayout() {
    const root = qs('#index-app');
    if (!root) throw new Error('#index-app が見つからへん');
    root.innerHTML = `
      <div class="index-page">
        <div id="index-status" class="page-status" hidden></div>

        <section class="index-hero card">
          <div class="index-hero__text">
            <div class="badge badge--blue">予想まとめ</div>
            <h1>まずトップで触るレースを選ぶ</h1>
            <p>日付ごとの全レースを、上位評価と単勝オッズを中心に縦で見やすく整理。スマホでは上から順に読める形に寄せた。</p>
          </div>
          <div id="hero-stats" class="hero-stats"></div>
        </section>

        <section class="card filter-panel">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">開催日</h2>
              <div class="section-subtitle">新しい日付から順に表示。横スクロール対応。</div>
            </div>
          </div>
          <div id="date-strip" class="date-strip"></div>
        </section>

        <section class="card filter-panel">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">絞り込み</h2>
              <div class="section-subtitle">レース名・馬名・競馬場・単勝あり・人気乖離ありで絞れる。</div>
            </div>
          </div>
          <div class="filter-grid">
            <label>
              キーワード
              <input id="filter-keyword" type="text" placeholder="レース名・馬名・競馬場">
            </label>
            <label>
              競馬場
              <select id="filter-course"><option value="">すべて</option></select>
            </label>
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
      </div>
    `;
  }

  function renderHeroStats() {
    const el = qs('#hero-stats');
    if (!el) return;
    const totalDates = state.dates.length;
    const totalRaces = state.dates.reduce((sum, d) => sum + (toNum(d.race_count) || 0), 0);
    const selectedRaces = state.races.length;
    el.innerHTML = [
      ['開催日数', totalDates],
      ['総レース数', totalRaces],
      ['選択日レース数', selectedRaces],
    ].map(([label, value]) => `
      <div class="hero-stat">
        <div class="hero-stat__label">${esc(label)}</div>
        <div class="hero-stat__value">${esc(fmt(value))}</div>
      </div>
    `).join('');
  }

  function renderDates() {
    const row = qs('#date-strip');
    if (!row) return;
    row.innerHTML = state.dates.map((d) => {
      const active = d.race_date === state.selectedDate;
      return `
        <button class="date-chip${active ? ' is-active' : ''}" type="button" data-date="${esc(d.race_date)}">
          <span>${esc(d.race_date)}</span>
          <span class="date-chip__meta">${esc(fmt(d.race_count))}R</span>
        </button>
      `;
    }).join('');

    qsa('[data-date]', row).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const date = btn.getAttribute('data-date');
        if (!date || date === state.selectedDate) return;
        await loadDate(date);
      });
    });
  }

  function populateCourseOptions() {
    const select = qs('#filter-course');
    if (!select) return;
    const current = state.course;
    const courses = Array.from(new Set(state.races.map(normalizeCourse).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja'));
    select.innerHTML = `<option value="">すべて</option>` + courses.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    select.value = courses.includes(current) ? current : '';
  }

  function applyFilters() {
    const kw = state.keyword.trim().toLowerCase();
    state.filtered = state.races.filter((race) => {
      const hay = [
        race.race_name,
        normalizeCourse(race),
        race.course_name,
        ...(Array.isArray(race.top_ai) ? race.top_ai.map((h) => h?.horse_name).filter(Boolean) : []),
      ].join(' ').toLowerCase();

      if (kw && !hay.includes(kw)) return false;
      if (state.course && normalizeCourse(race) !== state.course) return false;
      if (state.oddsOnly && !hasOdds(race)) return false;
      if (state.divergenceOnly && !hasDivergence(race)) return false;
      return true;
    }).sort((a, b) => {
      const an = toNum(a.race_no);
      const bn = toNum(b.race_no);
      if (an !== null && bn !== null && an !== bn) return an - bn;
      return String(a.race_id || '').localeCompare(String(b.race_id || ''));
    });
  }

  function renderRaceList() {
    applyFilters();
    const meta = qs('#race-meta');
    const list = qs('#race-list');
    if (!list) return;
    if (meta) meta.textContent = `${fmt(state.selectedDate)} / ${fmt(state.filtered.length)}件表示 / 全${fmt(state.races.length)}R`;

    if (!state.filtered.length) {
      list.innerHTML = '<div class="empty-panel">該当レースがないで。</div>';
      return;
    }

    list.innerHTML = state.filtered.map((race) => {
      const [stateText, stateClass] = raceStateLabel(race);
      const course = normalizeCourse(race);
      const top1 = (race.top_ai || [])[0] || {};
      const top2 = (race.top_ai || [])[1] || null;
      const top3 = (race.top_ai || [])[2] || null;
      const metaText = [
        race.race_no != null ? `${race.race_no}R` : null,
        course,
        race.surface,
        race.distance ? `${race.distance}m` : null,
        race.headcount ? `${race.headcount}頭` : null,
      ].filter(Boolean).join(' / ');

      return `
        <article class="race-row sheet">
          <div class="race-row__top">
            <div class="race-row__title-block">
              <div class="race-row__date">${esc(state.selectedDate)}</div>
              <h3 class="race-row__title">${esc(`${fmt(race.race_no)}R ${fmt(race.race_name, '')}`.trim())}</h3>
              <div class="race-row__meta">${esc(metaText || '条件情報なし')}</div>
              <div class="race-row__state">
                <span class="badge ${esc(stateClass)}">${esc(stateText)}</span>
                ${hasOdds(race) ? '<span class="badge badge--plain">単勝オッズあり</span>' : ''}
                ${hasDivergence(race) ? '<span class="badge badge--warn">人気乖離あり</span>' : ''}
              </div>
            </div>
            <div class="race-row__summary">
              <div class="top-pick-box">
                <div class="top-pick-box__label">AI 1位</div>
                <div class="top-pick-box__name">${esc(`${fmt(top1.umaban)} ${fmt(top1.horse_name)}`)}</div>
                <div class="top-pick-box__meta">勝率 ${esc(fmtPct(top1.p_win))} / 複勝率 ${esc(fmtPct(top1.p_top3))} / 単勝 ${esc(fmtNum(top1.tansho_odds))} / 人気 ${esc(fmt(top1.popularity))}</div>
              </div>
              <div class="inline-note">${esc(quickInsight(race))}</div>
              <div class="inline-note">相手候補: ${esc([top2 && `${fmt(top2.umaban)} ${fmt(top2.horse_name)}`, top3 && `${fmt(top3.umaban)} ${fmt(top3.horse_name)}`].filter(Boolean).join(' / ') || '—')}</div>
            </div>
          </div>
          <div class="race-row__actions">
            <a class="action-link action-link--primary" href="${esc(buildPageUrl('race', race))}">出走馬一覧</a>
            <a class="action-link" href="${esc(buildPageUrl('past', race))}">過去走比較</a>
            <a class="action-link" href="${esc(buildPageUrl('betting', race))}">買い目作成</a>
          </div>
        </article>
      `;
    }).join('');
  }

  function bindControls() {
    qs('#filter-keyword')?.addEventListener('input', (e) => {
      state.keyword = e.currentTarget.value || '';
      renderRaceList();
    });
    qs('#filter-course')?.addEventListener('change', (e) => {
      state.course = e.currentTarget.value || '';
      renderRaceList();
    });
    qs('#filter-odds')?.addEventListener('change', (e) => {
      state.oddsOnly = !!e.currentTarget.checked;
      renderRaceList();
    });
    qs('#filter-divergence')?.addEventListener('change', (e) => {
      state.divergenceOnly = !!e.currentTarget.checked;
      renderRaceList();
    });
    qs('#filter-reset')?.addEventListener('click', () => {
      state.keyword = '';
      state.course = '';
      state.oddsOnly = false;
      state.divergenceOnly = false;
      qs('#filter-keyword').value = '';
      qs('#filter-course').value = '';
      qs('#filter-odds').checked = false;
      qs('#filter-divergence').checked = false;
      renderRaceList();
    });
  }

  function updateUrl(date) {
    const u = new URL(window.location.href);
    if (date) u.searchParams.set('date', date);
    else u.searchParams.delete('date');
    history.replaceState({}, '', u.toString());
  }

  function requestedDate() {
    return new URLSearchParams(window.location.search).get('date');
  }

  async function loadIndex() {
    const index = await fetchJson(`${getDataRoot()}/index.json`);
    state.dates = Array.isArray(index?.dates) ? index.dates.slice() : [];
    state.dates.sort((a, b) => String(b.race_date || '').localeCompare(String(a.race_date || '')));
    if (!state.dates.length) throw new Error('index.json に dates が入ってへん。');
  }

  async function loadDate(date) {
    setStatus(`${date} のレース一覧を読み込み中...`);
    const payload = await fetchJson(`${getDataRoot()}/${date}/races.json`);
    state.selectedDate = date;
    state.races = Array.isArray(payload?.races) ? payload.races.slice() : [];
    updateUrl(date);
    renderHeroStats();
    renderDates();
    populateCourseOptions();
    renderRaceList();
    clearStatus();
  }

  async function init() {
    baseLayout();
    bindControls();
    setStatus('トップJSONを読み込み中...');
    await loadIndex();
    const req = requestedDate();
    const target = state.dates.some((d) => d.race_date === req) ? req : state.dates[0].race_date;
    await loadDate(target);
  }

  init().catch((err) => {
    console.error(err);
    setStatus(err?.message || '初期化に失敗したで。', true);
  });
})();
