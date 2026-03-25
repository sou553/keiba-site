(async function () {
  const AC = window.AnalysisCommon;
  const headerEl = document.getElementById('race-header');
  const navEl = document.getElementById('race-nav');
  const summaryRoot = document.getElementById('summary-root');
  const gapRoot = document.getElementById('gap-root');
  const horseListEl = document.getElementById('horse-list');
  const horseMetaEl = document.getElementById('horse-meta');
  const horseSearch = document.getElementById('horse-search');
  const horseSort = document.getElementById('horse-sort');

  const { date, raceId } = AC.getDateAndRaceId();
  let payload = null;
  let horses = [];

  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path} の読込に失敗しました。`);
    return res.json();
  }

  function buildHeader(race) {
    headerEl.innerHTML = `
      <div class="race-row__date">${AC.escapeHtml(date)}</div>
      <h1 class="race-title">${AC.escapeHtml(race.course || '')} ${AC.escapeHtml(race.race_no || '')}R ${AC.escapeHtml(race.race_name || '')}</h1>
      <div class="race-subtitle">${AC.escapeHtml(AC.getRaceLabel(race))}</div>
    `;
    navEl.innerHTML = AC.getNavHtml(date, raceId, 'race');
  }

  function renderSummary(raceSummary) {
    const statusClass = raceSummary.status === '見送り寄り' ? 'status-pill status-pill--skip' : (raceSummary.status === '本命寄り' ? 'status-pill status-pill--solid' : 'status-pill');
    const main = raceSummary.main;
    const line = raceSummary.line || [];
    const popularRows = raceSummary.popularSummary || [];

    summaryRoot.innerHTML = `
      <div class="section-heading">
        <div>
          <h2 class="section-title">予想まとめ</h2>
          <p class="section-note">本命・相手本線・穴候補・危険人気を最初に確認できる形に整理。</p>
        </div>
        <span class="${statusClass}">${AC.escapeHtml(raceSummary.status)}</span>
      </div>

      <div class="summary-grid">
        <div class="summary-main">
          <span class="status-pill status-pill--solid">◎ 本命</span>
          <div class="summary-main__horse">${main ? `${AC.escapeHtml(main.umaban)} ${AC.escapeHtml(main.horse_name)}` : '—'}</div>
          <div class="summary-main__badges">
            <span class="metric-badge metric-badge--blue">AI ${main?.pred_order ?? '—'}</span>
            <span class="metric-badge">人気 ${main?.popularity ?? '—'}</span>
            <span class="metric-badge">単勝 ${AC.odds(main?.tansho_odds)}</span>
            <span class="metric-badge metric-badge--green">勝率 ${AC.pct(main?.p_win)}</span>
            <span class="metric-badge metric-badge--green">複勝率 ${AC.pct(main?.p_top3)}</span>
          </div>
        </div>

        <div class="summary-side">
          <div class="info-card">
            <h3 class="info-card__title">相手本線</h3>
            <div class="info-card__content">
              ${line.length ? `<ul class="plain-list">${line.map((h, idx) => `<li>${idx === 0 ? '○' : '▲'} ${AC.escapeHtml(h.umaban)} ${AC.escapeHtml(h.horse_name)} / AI${h.pred_order ?? '—'} / 複勝率${AC.pct(h.p_top3)}</li>`).join('')}</ul>` : '該当なし'}
            </div>
          </div>
          <div class="info-card">
            <h3 class="info-card__title">穴候補</h3>
            <div class="info-card__content">
              ${raceSummary.hole ? `☆ ${AC.escapeHtml(raceSummary.hole.umaban)} ${AC.escapeHtml(raceSummary.hole.horse_name)}<br>${AC.escapeHtml(raceSummary.holeReason)}` : '該当なし'}
            </div>
          </div>
          <div class="info-card">
            <h3 class="info-card__title">危険人気</h3>
            <div class="info-card__content">
              ${raceSummary.danger ? `! ${AC.escapeHtml(raceSummary.danger.umaban)} ${AC.escapeHtml(raceSummary.danger.horse_name)}<br>${AC.escapeHtml(raceSummary.dangerReason)}` : '該当なし'}
            </div>
          </div>
          <div class="info-card">
            <h3 class="info-card__title">ひとこと</h3>
            <div class="info-card__content">${AC.escapeHtml(raceSummary.comment || '—')}</div>
          </div>
        </div>
      </div>

      <div class="section-heading" style="margin-top:18px; margin-bottom:10px;">
        <div>
          <h3 class="section-title" style="font-size:1.45rem;">人気馬まとめ</h3>
        </div>
      </div>
      <div class="popular-summary">
        ${popularRows.length ? popularRows.map((row) => {
          const cls = row.label === '信頼' ? 'badge-outline badge-outline--trust'
            : row.label === '危険' ? 'badge-outline badge-outline--danger'
            : row.label === 'やや危険' ? 'badge-outline badge-outline--warn'
            : 'badge-outline badge-outline--neutral';
          return `
            <div class="popular-summary__item">
              <div>
                <div class="popular-summary__horse">${row.horse.popularity}人気 ${AC.escapeHtml(row.horse.umaban)} ${AC.escapeHtml(row.horse.horse_name)}</div>
                <div class="popular-summary__meta">${AC.escapeHtml(row.reason)}</div>
              </div>
              <span class="${cls}">${AC.escapeHtml(row.label)}</span>
            </div>
          `;
        }).join('') : '<div class="empty-state">人気馬まとめを表示できません。</div>'}
      </div>

      <div class="section-heading" style="margin-top:18px; margin-bottom:10px;">
        <div>
          <h3 class="section-title" style="font-size:1.45rem;">判定理由</h3>
        </div>
      </div>
      <div class="info-card">
        <div class="info-card__content">
          ${raceSummary.reasons.length ? `<ul class="plain-list">${raceSummary.reasons.map(r => `<li>${AC.escapeHtml(r)}</li>`).join('')}</ul>` : '特記事項なし'}
        </div>
      </div>
    `;
  }

  function renderGapPanels(panels) {
    function renderItems(items, plus) {
      if (!items.length) return '<div class="gap-empty">該当馬なし</div>';
      return items.map((x) => `
        <div class="gap-item">
          <div>
            <div class="gap-item__name">${AC.escapeHtml(x.horse.umaban)} ${AC.escapeHtml(x.horse.horse_name)}</div>
            <div class="gap-item__meta">${AC.escapeHtml(x.meta)}</div>
          </div>
          <div class="gap-item__score ${plus ? 'gap-item__score--plus' : 'gap-item__score--minus'}">${x.score > 0 ? '+' : ''}${x.score}</div>
        </div>
      `).join('');
    }

    gapRoot.innerHTML = `
      <div class="gap-grid">
        <div class="gap-panel">
          <h3 class="gap-panel__title">人気 × AI順位</h3>
          <div class="gap-group">
            <div class="gap-group__title">妙味馬</div>
            ${renderItems(panels.aiValue, true)}
          </div>
          <div class="gap-group">
            <div class="gap-group__title">危険人気馬</div>
            ${renderItems(panels.aiDanger, false)}
          </div>
        </div>
        <div class="gap-panel">
          <h3 class="gap-panel__title">人気 × 適性順位</h3>
          <div class="gap-group">
            <div class="gap-group__title">コース向きで人気薄</div>
            ${renderItems(panels.courseValue, true)}
          </div>
          <div class="gap-group">
            <div class="gap-group__title">人気先行で適性弱い</div>
            ${renderItems(panels.courseDanger, false)}
          </div>
        </div>
      </div>
    `;
  }

  function normalizeHorses(rawHorses) {
    return (rawHorses || []).filter(h => h && h.horse_name).sort(AC.sortByPredThenTop3);
  }

  function getHorseStatusBadge(horse, summary) {
    if (summary.main && String(summary.main.umaban) === String(horse.umaban)) {
      return '<span class="summary-label">本命</span>';
    }
    if (summary.hole && String(summary.hole.umaban) === String(horse.umaban)) {
      return '<span class="summary-label" style="background:#fff5e5;color:#aa7a0f;">穴候補</span>';
    }
    if (summary.danger && String(summary.danger.umaban) === String(horse.umaban)) {
      return '<span class="summary-label summary-label--skip">危険人気</span>';
    }
    const popular = AC.classifyPopularHorseDetailed(horse);
    if (popular.label === '信頼') return '<span class="summary-label" style="background:#edf8f2;color:#0f8a54;">信頼</span>';
    return '';
  }

  function renderHorseCards(list, summary) {
    if (!list.length) {
      horseListEl.innerHTML = '<div class="empty-state">条件に合う馬がいません。</div>';
      return;
    }

    horseListEl.innerHTML = list.map((horse) => `
      <article class="horse-card">
        <div class="horse-card__top">
          <div class="horse-number">${AC.escapeHtml(horse.umaban ?? '—')}</div>
          <div>
            <div class="horse-name">${AC.escapeHtml(horse.horse_name || '')}</div>
            <div class="horse-submeta">${AC.escapeHtml([horse.sex_age, horse.jockey, horse.trainer].filter(Boolean).join(' / ') || '情報なし')}</div>
            <div class="horse-chips">
              ${getHorseStatusBadge(horse, summary)}
              ${horse.style ? `<span class="mini-chip">${AC.escapeHtml(horse.style)}</span>` : ''}
              ${horse.sire ? `<span class="mini-chip">父 ${AC.escapeHtml(horse.sire)}</span>` : ''}
            </div>
          </div>
          <div class="badge-outline badge-outline--neutral">AI ${horse.pred_order ?? '—'}</div>
        </div>
        <div class="horse-grid">
          <div class="horse-stat"><div class="horse-stat__label">人気</div><div class="horse-stat__value">${horse.popularity ?? '—'}</div></div>
          <div class="horse-stat"><div class="horse-stat__label">単勝</div><div class="horse-stat__value">${AC.odds(horse.tansho_odds)}</div></div>
          <div class="horse-stat"><div class="horse-stat__label">勝率</div><div class="horse-stat__value">${AC.pct(horse.p_win)}</div></div>
          <div class="horse-stat"><div class="horse-stat__label">複勝率</div><div class="horse-stat__value">${AC.pct(horse.p_top3)}</div></div>
          <div class="horse-stat"><div class="horse-stat__label">適性順位</div><div class="horse-stat__value">${horse.course_adv_rank ?? '—'}</div></div>
          <div class="horse-stat"><div class="horse-stat__label">馬体重</div><div class="horse-stat__value">${horse.horse_weight ?? '—'}</div></div>
          <div class="horse-stat"><div class="horse-stat__label">増減</div><div class="horse-stat__value">${horse.horse_weight_diff ?? '—'}</div></div>
          <div class="horse-stat"><div class="horse-stat__label">脚質</div><div class="horse-stat__value">${horse.style ?? '—'}</div></div>
        </div>
        <div class="horse-footer">
          <div>${horse.reasons_pos ? `プラス要因: ${AC.escapeHtml(horse.reasons_pos)}` : 'プラス要因: —'}</div>
          <div>${horse.reasons_neg ? `注意点: ${AC.escapeHtml(horse.reasons_neg)}` : '注意点: —'}</div>
        </div>
      </article>
    `).join('');
  }

  function applyFiltersAndRender(summary) {
    const keyword = (horseSearch.value || '').trim().toLowerCase();
    const sortMode = horseSort.value;

    let list = [...horses];

    if (keyword) {
      list = list.filter((horse) => {
        const text = [horse.horse_name, horse.jockey, horse.trainer].filter(Boolean).join(' ').toLowerCase();
        return text.includes(keyword);
      });
    }

    if (sortMode === 'popularity') {
      list.sort((a, b) => (AC.toNum(a.popularity) ?? 999) - (AC.toNum(b.popularity) ?? 999));
    } else if (sortMode === 'odds') {
      list.sort((a, b) => (AC.toNum(a.tansho_odds) ?? 999) - (AC.toNum(b.tansho_odds) ?? 999));
    } else if (sortMode === 'course') {
      list.sort((a, b) => (AC.toNum(a.course_adv_rank) ?? 999) - (AC.toNum(b.course_adv_rank) ?? 999));
    } else if (sortMode === 'number') {
      list.sort((a, b) => (AC.toNum(a.umaban) ?? 999) - (AC.toNum(b.umaban) ?? 999));
    } else {
      list.sort(AC.sortByPredThenTop3);
    }

    horseMetaEl.textContent = `${list.length}頭表示 / AI・人気・適性・勝率をカード型で確認`;
    renderHorseCards(list, summary);
  }

  async function boot() {
    if (!date || !raceId) {
      headerEl.innerHTML = '<div class="empty-state">date と race_id を URL に指定してください。</div>';
      return;
    }

    try {
      payload = await fetchJson(`./data/${date}/race_${raceId}.json`);
      const race = payload.race || {};
      horses = normalizeHorses(payload.horses || []);
      buildHeader(race);
      const summary = AC.buildRaceSummary(horses);
      renderSummary(summary);
      renderGapPanels(AC.buildSimpleGapPanels(horses));
      applyFiltersAndRender(summary);

      horseSearch.addEventListener('input', () => applyFiltersAndRender(summary));
      horseSort.addEventListener('change', () => applyFiltersAndRender(summary));
    } catch (e) {
      headerEl.innerHTML = `<div class="empty-state">${AC.escapeHtml(e.message || 'レース詳細の読み込みに失敗しました。')}</div>`;
    }
  }

  boot();
})();
