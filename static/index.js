(async function () {
  const AC = window.AnalysisCommon || {};

  const dateTabsEl = document.getElementById('date-tabs');
  const keywordInput = document.getElementById('keyword-input');
  const placeSelect = document.getElementById('place-select');
  const oddsOnlyCheck = document.getElementById('odds-only-check');
  const clearBtn = document.getElementById('clear-filter-btn');
  const raceListEl = document.getElementById('race-list');
  const listMetaEl = document.getElementById('list-meta');

  let indexJson = null;
  let currentDate = '';
  let races = [];

  function renderEmpty(message) {
    raceListEl.innerHTML = `<div class="empty-state">${AC.escapeHtml ? AC.escapeHtml(message) : message}</div>`;
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path} の読込に失敗`);
    return res.json();
  }

  function getCurrentQueryDate() {
    const p = new URLSearchParams(location.search);
    return p.get('date') || '';
  }

  function setQueryDate(date) {
    const p = new URLSearchParams(location.search);
    p.set('date', date);
    history.replaceState({}, '', `${location.pathname}?${p.toString()}`);
  }

  function renderDateTabs() {
    dateTabsEl.innerHTML = (indexJson?.dates || []).map((d, idx) => {
      const active = d.race_date === currentDate || (!currentDate && idx === 0);
      return `<button class="date-tab ${active ? 'is-active' : ''}" data-date="${d.race_date}" type="button">${d.race_date} <span style="opacity:.75">${d.race_count}R</span></button>`;
    }).join('');

    dateTabsEl.querySelectorAll('.date-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentDate = btn.dataset.date || '';
        setQueryDate(currentDate);
        loadDate(currentDate);
        renderDateTabs();
      });
    });
  }

  function populatePlaceOptions() {
    const places = [...new Set((races || []).map(r => r.course).filter(Boolean))].sort();
    const current = placeSelect.value;
    placeSelect.innerHTML = `<option value="">すべて</option>` + places.map(p => `<option value="${AC.escapeHtml(p)}">${AC.escapeHtml(p)}</option>`).join('');
    placeSelect.value = places.includes(current) ? current : '';
  }

  function buildSummaryLabel(race) {
    const top = race.top_ai && race.top_ai[0] ? race.top_ai[0] : null;
    if (!top) return '情報不足';
    const pTop3 = AC.toNum(top.p_top3) ?? 0;
    const pWin = AC.toNum(top.p_win) ?? 0;
    if (pTop3 >= 0.7 && pWin >= 0.22) return '本命寄り';
    if (pTop3 < 0.5) return '見送り寄り';
    return '混戦';
  }

  function getAiSummary(race) {
    const top = race.top_ai && race.top_ai[0] ? race.top_ai[0] : null;
    if (!top) return null;
    const second = race.top_ai && race.top_ai[1] ? race.top_ai[1] : null;
    const line = [];
    if (second) line.push(`${second.umaban} ${second.horse_name}`);
    if (race.top_ai[2]) line.push(`${race.top_ai[2].umaban} ${race.top_ai[2].horse_name}`);
    return {
      label: buildSummaryLabel(race),
      main: `${top.umaban} ${top.horse_name}`,
      meta: `勝率 ${AC.pct(top.p_win)} / 複勝率 ${AC.pct(top.p_top3)} / 単勝 ${AC.odds(top.tansho_odds)} / 人気 ${top.popularity ?? '—'}`,
      note: line.length ? `相手: ${line.join(' / ')}` : ''
    };
  }

  function filterRaces() {
    const kw = keywordInput.value.trim().toLowerCase();
    const place = placeSelect.value;
    const oddsOnly = oddsOnlyCheck.checked;

    return races.filter((race) => {
      if (place && race.course !== place) return false;
      if (oddsOnly) {
        const hasOdds = (race.top_ai || []).some(h => AC.toNum(h.tansho_odds) !== null);
        if (!hasOdds) return false;
      }
      if (!kw) return true;
      const text = [
        race.race_name,
        race.course,
        race.course_name,
        ...(race.top_ai || []).map(h => h.horse_name)
      ].filter(Boolean).join(' ').toLowerCase();
      return text.includes(kw);
    });
  }

  function renderRaceList() {
    const filtered = filterRaces();
    listMetaEl.textContent = `${currentDate} / ${filtered.length}件表示 / 全${races.length}R`;

    if (!filtered.length) {
      renderEmpty('条件に合うレースがありません。');
      return;
    }

    raceListEl.innerHTML = filtered.map((race) => {
      const sum = getAiSummary(race);
      const summaryLabelClass = sum?.label === '見送り寄り' ? 'summary-label summary-label--skip' : 'summary-label';
      return `
        <article class="race-row">
          <div class="race-row__left">
            <div class="race-row__date">${AC.escapeHtml(currentDate)}</div>
            <div class="race-row__title">${AC.escapeHtml(race.race_no ?? '')}R ${AC.escapeHtml(race.race_name || '')}</div>
            <div class="race-row__meta">${AC.escapeHtml([race.course, race.surface, race.distance ? `${race.distance}m` : null, race.headcount ? `${race.headcount}頭` : null].filter(Boolean).join(' / '))}</div>
            <div class="race-tag-list" style="margin-top:10px;">
              <span class="race-tag">race_id ${AC.escapeHtml(race.race_id || '')}</span>
            </div>
          </div>
          <div class="race-row__center">
            <div class="race-row__summary">
              ${sum ? `
                <div class="${summaryLabelClass}">${AC.escapeHtml(sum.label)}</div>
                <div class="summary-name">◎ ${AC.escapeHtml(sum.main)}</div>
                <div class="summary-meta">${AC.escapeHtml(sum.meta)}</div>
                ${sum.note ? `<div class="summary-note">${AC.escapeHtml(sum.note)}</div>` : ''}
              ` : '<div class="empty-state">AI要約なし</div>'}
            </div>
          </div>
          <div class="race-row__right">
            <a class="btn btn--primary" href="./race_detail.html?date=${encodeURIComponent(currentDate)}&race_id=${encodeURIComponent(race.race_id)}">出走馬一覧</a>
            <a class="btn" href="./past_detail.html?date=${encodeURIComponent(currentDate)}&race_id=${encodeURIComponent(race.race_id)}">過去走比較</a>
            <a class="btn" href="./betting.html?date=${encodeURIComponent(currentDate)}&race_id=${encodeURIComponent(race.race_id)}">買い目作成</a>
          </div>
        </article>
      `;
    }).join('');
  }

  async function loadDate(date) {
    raceListEl.innerHTML = `<div class="empty-state">読み込み中...</div>`;
    try {
      const json = await fetchJson(`./data/${date}/races.json`);
      races = json.races || [];
      populatePlaceOptions();
      renderRaceList();
    } catch (e) {
      renderEmpty(e.message || 'レース一覧の読み込みに失敗しました。');
    }
  }

  async function boot() {
    try {
      indexJson = await fetchJson('./data/index.json');
    } catch (e) {
      renderEmpty('data/index.json の読み込みに失敗しました。');
      return;
    }

    currentDate = getCurrentQueryDate() || indexJson?.dates?.[0]?.race_date || '';
    renderDateTabs();
    await loadDate(currentDate);

    keywordInput.addEventListener('input', renderRaceList);
    placeSelect.addEventListener('change', renderRaceList);
    oddsOnlyCheck.addEventListener('change', renderRaceList);
    clearBtn.addEventListener('click', () => {
      keywordInput.value = '';
      placeSelect.value = '';
      oddsOnlyCheck.checked = false;
      renderRaceList();
    });
  }

  boot();
})();
