(function () {
  const AC0 = window.AC || {};
  const escapeHtml = typeof AC0.escapeHtml === 'function'
    ? AC0.escapeHtml
    : function (v) {
        return String(v ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      };
  const toNum = typeof AC0.toNum === 'function'
    ? AC0.toNum
    : function (v) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
  const formatPct01 = typeof AC0.roundPct01 === 'function'
    ? AC0.roundPct01
    : function (v) {
        const n = toNum(v);
        return n === null ? '—' : `${Math.round(n * 1000) / 10}%`;
      };
  const formatOdds = typeof AC0.formatOdds === 'function'
    ? AC0.formatOdds
    : function (v) {
        const n = toNum(v);
        return n === null ? '—' : String(Math.round(n * 10) / 10);
      };
  const dataRoot = typeof AC0.resolveDataRoot === 'function' ? AC0.resolveDataRoot() : './data';
  const fetchJson = typeof AC0.fetchJson === 'function'
    ? AC0.fetchJson
    : async function (path) {
        const res = await fetch(path, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${path}`);
        return res.json();
      };

  const els = {
    dateTabs: document.getElementById('date-tabs'),
    raceListMeta: document.getElementById('race-list-meta'),
    raceList: document.getElementById('race-list'),
    keyword: document.getElementById('filter-keyword'),
    course: document.getElementById('filter-course'),
    oddsOnly: document.getElementById('filter-odds-only'),
    reset: document.getElementById('filter-reset'),
  };

  let state = {
    index: null,
    currentDate: '',
    currentRaces: [],
  };

  function raceKeyword(r) {
    const top = (r.top_ai || []).map(x => `${x.umaban ?? ''} ${x.horse_name ?? ''}`).join(' ');
    return [r.race_name, r.course, r.course_name, top].filter(Boolean).join(' ');
  }

  function buildDateTabs(indexJson) {
    const dates = indexJson.dates || [];
    els.dateTabs.innerHTML = dates.map((d, idx) => {
      const active = d.race_date === state.currentDate || (!state.currentDate && idx === 0);
      return `<button class="nk-date-chip ${active ? 'is-active' : ''}" data-date="${escapeHtml(d.race_date)}">${escapeHtml(d.race_date)} <span>${escapeHtml(d.race_count)}R</span></button>`;
    }).join('');

    els.dateTabs.querySelectorAll('[data-date]').forEach(btn => {
      btn.addEventListener('click', () => loadDate(btn.dataset.date));
    });
  }

  function renderCourseOptions(races) {
    const uniq = [...new Set(races.map(r => r.course).filter(Boolean))];
    const prev = els.course.value;
    els.course.innerHTML = ['<option value="">すべて</option>']
      .concat(uniq.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`))
      .join('');
    if (uniq.includes(prev)) els.course.value = prev;
  }

  function getFilteredRaces() {
    const q = (els.keyword.value || '').trim().toLowerCase();
    const course = els.course.value || '';
    const oddsOnly = !!els.oddsOnly.checked;

    return state.currentRaces.filter(r => {
      if (course && r.course !== course) return false;
      if (oddsOnly) {
        const hasOdds = (r.top_ai || []).some(h => toNum(h.tansho_odds) !== null);
        if (!hasOdds) return false;
      }
      if (q) {
        const text = raceKeyword(r).toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }

  function renderRaces() {
    const filtered = getFilteredRaces();
    els.raceListMeta.textContent = `${state.currentDate} / ${filtered.length}件表示 / 全${state.currentRaces.length}R`;

    if (!filtered.length) {
      els.raceList.innerHTML = '<div class="nk-empty">該当レースなし</div>';
      return;
    }

    els.raceList.innerHTML = filtered.map(r => {
      const top = (r.top_ai || [])[0] || {};
      const top2 = (r.top_ai || [])[1] || {};
      const cond = [r.course, r.surface, r.distance ? `${r.distance}m` : '', r.headcount ? `${r.headcount}頭` : ''].filter(Boolean).join(' / ');
      return `
        <article class="nk-race-row-card">
          <div class="nk-race-row-main">
            <div class="nk-race-no">${escapeHtml(r.race_no ?? '')}R</div>
            <div class="nk-race-name">${escapeHtml(r.race_name ?? '')}</div>
            <div class="nk-race-cond">${escapeHtml(cond)}</div>
            <div class="nk-race-id-chip">race_id ${escapeHtml(r.race_id ?? '')}</div>
          </div>
          <div class="nk-race-row-ai">
            <div class="nk-mini-title">AI本線</div>
            <div class="nk-ai-main-name">◎ ${escapeHtml(top.umaban ?? '')} ${escapeHtml(top.horse_name ?? '—')}</div>
            <div class="nk-ai-main-meta">勝率 ${formatPct01(top.p_win)} / 複勝率 ${formatPct01(top.p_top3)} / 単勝 ${formatOdds(top.tansho_odds)} / 人気 ${escapeHtml(top.popularity ?? '—')}</div>
            ${top2.horse_name ? `<div class="nk-ai-sub-meta">相手: ${escapeHtml(top2.umaban ?? '')} ${escapeHtml(top2.horse_name ?? '')}</div>` : ''}
          </div>
          <div class="nk-race-row-actions">
            <a class="nk-action-btn is-primary" href="./race_detail.html?date=${encodeURIComponent(state.currentDate)}&race_id=${encodeURIComponent(r.race_id)}">出走馬一覧</a>
            <a class="nk-action-btn" href="./past_detail.html?date=${encodeURIComponent(state.currentDate)}&race_id=${encodeURIComponent(r.race_id)}">過去走比較</a>
            <a class="nk-action-btn" href="./betting.html?date=${encodeURIComponent(state.currentDate)}&race_id=${encodeURIComponent(r.race_id)}">買い目作成</a>
          </div>
        </article>
      `;
    }).join('');
  }

  async function loadDate(date) {
    state.currentDate = date;
    const json = await fetchJson(`${dataRoot}/${date}/races.json`);
    state.currentRaces = json.races || [];
    buildDateTabs(state.index);
    renderCourseOptions(state.currentRaces);
    renderRaces();
  }

  async function init() {
    try {
      state.index = await fetchJson(`${dataRoot}/index.json`);
      const firstDate = state.index?.dates?.[0]?.race_date || '';
      state.currentDate = firstDate;
      buildDateTabs(state.index);
      await loadDate(state.currentDate);

      [els.keyword, els.course, els.oddsOnly].forEach(el => {
        el?.addEventListener('input', renderRaces);
        el?.addEventListener('change', renderRaces);
      });
      els.reset?.addEventListener('click', () => {
        els.keyword.value = '';
        els.course.value = '';
        els.oddsOnly.checked = false;
        renderRaces();
      });
    } catch (err) {
      els.raceList.innerHTML = `<div class="nk-error-box">${escapeHtml(err?.message || String(err))}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
