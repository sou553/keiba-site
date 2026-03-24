(function () {
  'use strict';

  const PAGE_DEFAULTS = {
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
    data: null,
    filtered: [],
    sortKey: 'pred_order',
    sortDir: 'asc',
    keyword: '',
    showOddsOnly: false,
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

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
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

  function parseDistanceText(value) {
    if (!value) return { surface: null, distance: null, text: null };
    if (typeof value === 'number') return { surface: null, distance: value, text: String(value) };
    const text = String(value).trim();
    const m = text.match(/(芝|ダ|障|ダート|芝・ダート|ダート・芝)?\s*(\d{3,4})/);
    return {
      surface: m ? m[1] : null,
      distance: m ? Number(m[2]) : null,
      text,
    };
  }

  function detectPlaceName(raceLike) {
    if (!raceLike) return '';
    if (raceLike.course) return String(raceLike.course);
    if (raceLike.course_name) {
      const text = String(raceLike.course_name);
      for (const name of Object.values(JRA_PLACE_MAP)) {
        if (text.includes(name)) return name;
      }
    }
    const rid = String(raceLike.race_id ?? '').replace(/\D/g, '');
    if (rid.length >= 6) {
      return JRA_PLACE_MAP[rid.slice(4, 6)] || '';
    }
    return '';
  }

  function getDataRoot() {
    return document.body?.dataset?.dataRoot || './data';
  }

  function getPageName(kind) {
    return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind];
  }

  function getJsonPath() {
    const params = new URLSearchParams(window.location.search);
    const direct = params.get('json') || document.body?.dataset?.json;
    if (direct) return direct;

    const raceId = params.get('race_id') || params.get('raceId') || document.body?.dataset?.raceId;
    const date = params.get('date') || params.get('raceDate') || document.body?.dataset?.raceDate;
    if (!raceId || !date) {
      throw new Error('race_id と date をURLパラメータに入れてな。例: ?date=20260322&race_id=202606020801');
    }
    return `${getDataRoot()}/${date}/race_${raceId}.json`;
  }

  function buildPageUrl(kind, race) {
    const page = getPageName(kind);
    const params = new URLSearchParams({
      date: race.race_date,
      race_id: race.race_id,
    });
    return `${page}?${params.toString()}`;
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`);
    return res.json();
  }

  function setStatus(message, isError = false) {
    const el = qs('#race-status');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle('is-error', !!isError);
  }

  function clearStatus() {
    const el = qs('#race-status');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-error');
  }

  function baseLayout() {
    const root = qs('#race-app');
    if (!root) {
      throw new Error('#race-app が見つからへん。race_detail.html に <div id="race-app"></div> を置いてな。');
    }

    root.innerHTML = `
      <section class="race-page">
        <div id="race-status" class="page-status" hidden></div>
        <header class="race-page__header" id="race-header"></header>
        <nav class="race-page__tabs" id="race-tabs"></nav>
        <section class="race-page__summary" id="race-summary"></section>
        <section class="race-page__controls" id="race-controls"></section>
        <section class="race-page__table-wrap">
          <table class="race-table">
            <thead>
              <tr>
                <th data-sort="umaban">馬番</th>
                <th data-sort="horse_name">馬名</th>
                <th data-sort="sex_age">性齢</th>
                <th data-sort="jockey">騎手</th>
                <th data-sort="trainer">調教師</th>
                <th data-sort="popularity">人気</th>
                <th data-sort="tansho_odds">単勝</th>
                <th data-sort="pred_order">AI順位</th>
                <th data-sort="p_win">勝率</th>
                <th data-sort="p_top3">複勝率</th>
                <th data-sort="course_adv_rank">適性順位</th>
                <th data-sort="score_gap_abs">乖離</th>
              </tr>
            </thead>
            <tbody id="horse-table-body"></tbody>
          </table>
        </section>
      </section>
    `;
  }

  function renderHeader(data) {
    const race = data.race || {};
    const header = qs('#race-header');
    if (!header) return;

    const titleBits = [
      race.course,
      race.race_no != null ? `${race.race_no}R` : null,
      race.race_name,
    ].filter(Boolean);

    const metaBits = [
      race.course_name,
      race.surface,
      race.distance ? `${race.distance}m` : null,
      race.going,
      race.headcount ? `${race.headcount}頭` : null,
      race.weather,
    ].filter(Boolean);

    header.innerHTML = `
      <div class="race-title-block">
        <div class="race-title-sub">${escapeHtml(data.race_date || '')}</div>
        <h1 class="race-title-main">${escapeHtml(titleBits.join(' '))}</h1>
        <div class="race-title-meta">${escapeHtml(metaBits.join(' / ') || '条件情報なし')}</div>
      </div>
    `;
    document.title = `${titleBits.join(' ')} | 出走馬一覧`;
  }

  function renderTabs(data) {
    const nav = qs('#race-tabs');
    if (!nav) return;
    const race = data.race || {};
    race.race_date = data.race_date;

    const items = [
      { kind: 'race', label: '出走馬一覧', active: true },
      { kind: 'past', label: '過去走比較', active: false },
      { kind: 'betting', label: '買い目作成', active: false },
    ];

    nav.innerHTML = items.map((item) => `
      <a class="race-tab${item.active ? ' is-active' : ''}" href="${escapeHtml(buildPageUrl(item.kind, race))}">${escapeHtml(item.label)}</a>
    `).join('');
  }

  function renderSummary(data) {
    const el = qs('#race-summary');
    if (!el) return;
    const summary = data.summary || {};
    const topAi = Array.isArray(summary.top_ai) ? summary.top_ai : [];

    const chips = [
      `頭数 ${fmt(summary.horse_count)}`,
      `過去走あり ${fmt(summary.past_available_count)}`,
      `単勝オッズ ${summary.odds_available ? 'あり' : 'なし'}`,
    ];

    const topHtml = topAi.map((h) => `
      <div class="top-ai-card">
        <div class="top-ai-card__rank">AI ${fmt(h.pred_order)}</div>
        <div class="top-ai-card__name">${escapeHtml(`${fmt(h.umaban)} ${fmt(h.horse_name)}`)}</div>
        <div class="top-ai-card__meta">
          <span>勝率 ${fmtPct(h.p_win)}</span>
          <span>複勝率 ${fmtPct(h.p_top3)}</span>
          <span>単勝 ${fmtNum(h.tansho_odds)}</span>
          <span>人気 ${fmt(h.popularity)}</span>
        </div>
      </div>
    `).join('');

    el.innerHTML = `
      <div class="summary-chip-row">${chips.map((x) => `<span class="summary-chip">${escapeHtml(x)}</span>`).join('')}</div>
      <div class="top-ai-grid">${topHtml || '<div class="empty-text">上位予想なし</div>'}</div>
    `;
  }

  function renderControls() {
    const el = qs('#race-controls');
    if (!el) return;
    el.innerHTML = `
      <div class="control-row">
        <label>検索 <input type="text" id="race-keyword" placeholder="馬名 / 騎手 / 調教師"></label>
        <label>並び替え
          <select id="race-sort-key">
            <option value="pred_order">AI順位</option>
            <option value="umaban">馬番</option>
            <option value="popularity">人気</option>
            <option value="tansho_odds">単勝オッズ</option>
            <option value="p_win">勝率</option>
            <option value="p_top3">複勝率</option>
            <option value="course_adv_rank">適性順位</option>
            <option value="score_gap_abs">AI-適性乖離</option>
          </select>
        </label>
        <label>順序
          <select id="race-sort-dir">
            <option value="asc">昇順</option>
            <option value="desc">降順</option>
          </select>
        </label>
        <label><input type="checkbox" id="race-odds-only"> 単勝ありだけ</label>
      </div>
    `;

    const keyword = qs('#race-keyword');
    const sortKey = qs('#race-sort-key');
    const sortDir = qs('#race-sort-dir');
    const oddsOnly = qs('#race-odds-only');

    if (keyword) keyword.addEventListener('input', () => {
      state.keyword = keyword.value.trim().toLowerCase();
      updateTable();
    });

    if (sortKey) sortKey.addEventListener('change', () => {
      state.sortKey = sortKey.value;
      updateTable();
    });

    if (sortDir) sortDir.addEventListener('change', () => {
      state.sortDir = sortDir.value;
      updateTable();
    });

    if (oddsOnly) oddsOnly.addEventListener('change', () => {
      state.showOddsOnly = oddsOnly.checked;
      updateTable();
    });

    document.querySelectorAll('.race-table th[data-sort]').forEach((th) => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (!key) return;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          if (sortDir) sortDir.value = state.sortDir;
        } else {
          state.sortKey = key;
          if (sortKey) sortKey.value = key;
        }
        updateTable();
      });
    });
  }

  function getGap(horse) {
    const ai = toNumber(horse.pred_order);
    const fit = toNumber(horse.course_adv_rank);
    if (ai == null || fit == null) return { diff: null, abs: null };
    return { diff: fit - ai, abs: Math.abs(fit - ai) };
  }

  function horseMatches(horse) {
    if (state.showOddsOnly && toNumber(horse.tansho_odds) == null) return false;
    if (!state.keyword) return true;

    const hay = [horse.horse_name, horse.jockey, horse.trainer, horse.sire, horse.dam_sire]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(state.keyword);
  }

  function compareHorses(a, b) {
    const key = state.sortKey;
    const dir = state.sortDir === 'desc' ? -1 : 1;

    const aValue = key === 'score_gap_abs' ? getGap(a).abs : a[key];
    const bValue = key === 'score_gap_abs' ? getGap(b).abs : b[key];

    const na = toNumber(aValue);
    const nb = toNumber(bValue);
    if (na != null && nb != null) return (na - nb) * dir;

    const sa = String(aValue ?? '');
    const sb = String(bValue ?? '');
    return sa.localeCompare(sb, 'ja') * dir;
  }

  function rowHtml(horse) {
    const gap = getGap(horse);
    const gapText = gap.diff == null ? '—' : `${gap.diff > 0 ? '+' : ''}${gap.diff}`;

    const horseLink = buildPageUrl('past', {
      race_date: state.data.race_date,
      race_id: state.data.race.race_id,
    });

    return `
      <tr>
        <td>${fmt(horse.umaban)}</td>
        <td>
          <a class="horse-link" href="${escapeHtml(horseLink)}#horse-${encodeURIComponent(horse.umaban ?? horse.horse_name ?? '')}">${escapeHtml(fmt(horse.horse_name))}</a>
          <div class="horse-mini-meta">${escapeHtml([horse.sire, horse.dam_sire].filter(Boolean).join(' × ') || '')}</div>
        </td>
        <td>${escapeHtml([fmt(horse.sex_age), horse.burden_weight != null ? `${fmtNum(horse.burden_weight)}kg` : null].filter(Boolean).join(' / '))}</td>
        <td>${escapeHtml(fmt(horse.jockey))}</td>
        <td>${escapeHtml(fmt(horse.trainer))}</td>
        <td>${fmt(horse.popularity)}</td>
        <td class="num">${fmtNum(horse.tansho_odds)}</td>
        <td class="num">${fmt(horse.pred_order)}</td>
        <td class="num">${fmtPct(horse.p_win)}</td>
        <td class="num">${fmtPct(horse.p_top3)}</td>
        <td class="num">${fmt(horse.course_adv_rank)}</td>
        <td>
          <div>${gapText}</div>
          <div class="horse-mini-meta">AI ${fmt(horse.pred_order)} / 適性 ${fmt(horse.course_adv_rank)}</div>
        </td>
      </tr>
    `;
  }

  function updateTable() {
    const tbody = qs('#horse-table-body');
    if (!tbody || !state.data) return;

    const horses = Array.isArray(state.data.horses) ? state.data.horses.slice() : [];
    const filtered = horses.filter(horseMatches).sort(compareHorses);
    state.filtered = filtered;

    tbody.innerHTML = filtered.map(rowHtml).join('') || `
      <tr><td colspan="12" class="empty-text">該当馬なし</td></tr>
    `;
  }

  async function init() {
    try {
      baseLayout();
      setStatus('読み込み中...');
      const data = await fetchJson(getJsonPath());
      state.data = data;
      clearStatus();
      renderHeader(data);
      renderTabs(data);
      renderSummary(data);
      renderControls();
      updateTable();
    } catch (error) {
      console.error(error);
      try {
        baseLayout();
      } catch (_) {
        // noop
      }
      setStatus(error.message || '表示に失敗したで', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
