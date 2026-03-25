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
  const toNum = typeof AC0.toNum === 'function' ? AC0.toNum : (v => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });
  const formatPct01 = typeof AC0.roundPct01 === 'function' ? AC0.roundPct01 : (v => {
    const n = toNum(v);
    return n === null ? '—' : `${Math.round(n * 1000) / 10}%`;
  });
  const formatOdds = typeof AC0.formatOdds === 'function' ? AC0.formatOdds : (v => {
    const n = toNum(v);
    return n === null ? '—' : String(Math.round(n * 10) / 10);
  });
  const readQuery = typeof AC0.readQuery === 'function' ? AC0.readQuery : (() => {
    const p = new URLSearchParams(location.search);
    return { date: p.get('date') || '', race_id: p.get('race_id') || '' };
  });
  const dataRoot = typeof AC0.resolveDataRoot === 'function' ? AC0.resolveDataRoot() : './data';
  const fetchJson = typeof AC0.fetchJson === 'function' ? AC0.fetchJson : async (path) => {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${path}`);
    return res.json();
  };

  function sortByPred(a, b) {
    const ap = toNum(a.pred_order) ?? 999;
    const bp = toNum(b.pred_order) ?? 999;
    if (ap !== bp) return ap - bp;
    return (toNum(b.p_top3) ?? -1) - (toNum(a.p_top3) ?? -1);
  }

  function popularSummary(horses) {
    return [...horses]
      .filter(h => {
        const p = toNum(h.popularity);
        return p !== null && p <= 5;
      })
      .sort((a, b) => (toNum(a.popularity) ?? 999) - (toNum(b.popularity) ?? 999))
      .map(h => {
        const pop = toNum(h.popularity);
        const ai = toNum(h.pred_order);
        const course = toNum(h.course_adv_rank);
        const top3 = toNum(h.p_top3);
        let label = '妥当';
        let reason = [];
        if (ai !== null && pop !== null && ai - pop >= 5) reason.push('AI順位が人気より低い');
        if (course !== null && pop !== null && course - pop >= 5) reason.push('適性順位が人気より低い');
        if (top3 !== null && top3 < 0.2) reason.push('複勝率が低い');
        if (reason.length >= 2 || (top3 !== null && top3 < 0.1)) label = '危険';
        else if (top3 !== null && top3 >= 0.55 && (ai === null || ai <= pop + 1) && (course === null || course <= pop + 2)) label = '信頼';
        else if (reason.length >= 1) label = 'やや危険';
        return { ...h, _popularLabel: label, _popularReason: reason.join('・') };
      });
  }

  function gapPanels(horses) {
    const aiValue = horses.filter(h => {
      const pop = toNum(h.popularity), ai = toNum(h.pred_order);
      return pop !== null && ai !== null && pop >= 6 && pop - ai >= 5 && ai <= 3;
    }).sort((a,b) => ((toNum(b.popularity)-toNum(b.pred_order)) - (toNum(a.popularity)-toNum(a.pred_order)))).slice(0,3);

    const aiDanger = horses.filter(h => {
      const pop = toNum(h.popularity), ai = toNum(h.pred_order);
      return pop !== null && ai !== null && pop <= 5 && ai - pop >= 5;
    }).sort((a,b) => ((toNum(b.pred_order)-toNum(b.popularity)) - (toNum(a.pred_order)-toNum(a.popularity)))).slice(0,3);

    const courseValue = horses.filter(h => {
      const pop = toNum(h.popularity), c = toNum(h.course_adv_rank);
      return pop !== null && c !== null && pop >= 6 && pop - c >= 5 && c <= 3;
    }).sort((a,b) => ((toNum(b.popularity)-toNum(b.course_adv_rank)) - (toNum(a.popularity)-toNum(a.course_adv_rank)))).slice(0,3);

    const courseDanger = horses.filter(h => {
      const pop = toNum(h.popularity), c = toNum(h.course_adv_rank);
      return pop !== null && c !== null && pop <= 5 && c - pop >= 5;
    }).sort((a,b) => ((toNum(b.course_adv_rank)-toNum(b.popularity)) - (toNum(a.course_adv_rank)-toNum(a.popularity)))).slice(0,3);

    return { aiValue, aiDanger, courseValue, courseDanger };
  }

  function summary(horses) {
    const sorted = [...horses].sort(sortByPred);
    const top1 = sorted[0], top2 = sorted[1], top3 = sorted[2];
    const popSummary = popularSummary(horses);
    const status = (toNum(top1?.p_top3) ?? 0) >= 0.65 ? '本命寄り' : ((toNum(top1?.p_top3) ?? 0) < 0.45 ? '見送り寄り' : '混戦');
    return { top1, top2, top3, status, popSummary };
  }

  function labelClass(label) {
    if (label === '信頼') return 'nk-badge-trust';
    if (label === '危険') return 'nk-badge-danger';
    if (label === 'やや危険') return 'nk-badge-warn';
    return 'nk-badge-neutral';
  }

  function renderPrediction(summaryData) {
    const { top1, top2, top3, status, popSummary } = summaryData;
    return `
      <section class="nk-section">
        <div class="nk-grid-2">
          <div class="nk-panel">
            <div class="nk-panel-head"><h2>予想まとめ</h2><span class="nk-badge ${status === '本命寄り' ? 'nk-badge-trust' : status === '見送り寄り' ? 'nk-badge-danger' : 'nk-badge-neutral'}">${escapeHtml(status)}</span></div>
            ${top1 ? `<div class="nk-main-pick-card"><div class="nk-main-mark">◎</div><div><div class="nk-main-name">${escapeHtml(top1.umaban)} ${escapeHtml(top1.horse_name)}</div><div class="nk-main-meta">AI ${escapeHtml(top1.pred_order ?? '—')} / 人気 ${escapeHtml(top1.popularity ?? '—')} / 単勝 ${formatOdds(top1.tansho_odds)} / 勝率 ${formatPct01(top1.p_win)} / 複勝率 ${formatPct01(top1.p_top3)}</div></div></div>` : ''}
            <div class="nk-sub-grid">
              <div class="nk-mini-box"><div class="nk-mini-title">相手本線</div>${[top2, top3].filter(Boolean).map((h, i) => `<div class="nk-mini-row">${i===0?'○':'▲'} ${escapeHtml(h.umaban)} ${escapeHtml(h.horse_name)} <span>AI${escapeHtml(h.pred_order ?? '—')} / 複勝率${formatPct01(h.p_top3)}</span></div>`).join('') || '<div class="nk-empty-inline">該当なし</div>'}</div>
            </div>
          </div>
          <div class="nk-panel">
            <div class="nk-panel-head"><h2>人気馬まとめ</h2></div>
            <div class="nk-list-simple">
              ${popSummary.map(h => `<div class="nk-list-row"><div><strong>${escapeHtml(h.popularity)}人気 ${escapeHtml(h.umaban)} ${escapeHtml(h.horse_name)}</strong><div class="nk-row-meta">AI${escapeHtml(h.pred_order ?? '—')} / 適性${escapeHtml(h.course_adv_rank ?? '—')} / 複勝率${formatPct01(h.p_top3)}${h._popularReason ? ' / ' + escapeHtml(h._popularReason) : ''}</div></div><span class="nk-badge ${labelClass(h._popularLabel)}">${escapeHtml(h._popularLabel)}</span></div>`).join('')}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderGapSection(g) {
    const block = (title, rows, type) => `
      <div class="nk-gap-group">
        <div class="nk-gap-subtitle">${escapeHtml(title)}</div>
        ${rows.length ? rows.map(h => {
          let score = 0;
          let meta = '';
          if (type === 'aiPlus') { score = (toNum(h.popularity) - toNum(h.pred_order)); meta = `人気${h.popularity} / AI${h.pred_order} / 複勝率${formatPct01(h.p_top3)}`; }
          if (type === 'aiMinus') { score = -(toNum(h.pred_order) - toNum(h.popularity)); meta = `人気${h.popularity} / AI${h.pred_order} / 複勝率${formatPct01(h.p_top3)}`; }
          if (type === 'coursePlus') { score = (toNum(h.popularity) - toNum(h.course_adv_rank)); meta = `人気${h.popularity} / 適性${h.course_adv_rank} / 複勝率${formatPct01(h.p_top3)}`; }
          if (type === 'courseMinus') { score = -(toNum(h.course_adv_rank) - toNum(h.popularity)); meta = `人気${h.popularity} / 適性${h.course_adv_rank} / 複勝率${formatPct01(h.p_top3)}`; }
          return `<div class="nk-gap-row"><div><div class="nk-gap-name">${escapeHtml(h.umaban)} ${escapeHtml(h.horse_name)}</div><div class="nk-gap-meta">${escapeHtml(meta)}</div></div><div class="nk-gap-badge ${score > 0 ? 'nk-gap-plus' : 'nk-gap-minus'}">${score > 0 ? '+' : ''}${escapeHtml(score)}</div></div>`;
        }).join('') : '<div class="nk-gap-empty">該当馬なし</div>'}
      </div>`;

    return `
      <section class="nk-section">
        <div class="nk-section-title">人気馬の乖離</div>
        <div class="nk-section-sub">人気と AI / 適性順位のズレを独立表示</div>
        <div class="nk-grid-2">
          <div class="nk-panel">
            <div class="nk-panel-head"><h3>人気 × AI順位</h3></div>
            ${block('妙味馬', g.aiValue, 'aiPlus')}
            ${block('危険人気馬', g.aiDanger, 'aiMinus')}
          </div>
          <div class="nk-panel">
            <div class="nk-panel-head"><h3>人気 × 適性順位</h3></div>
            ${block('コース向きで人気薄', g.courseValue, 'coursePlus')}
            ${block('人気先行で適性弱い', g.courseDanger, 'courseMinus')}
          </div>
        </div>
      </section>
    `;
  }

  function renderHorses(horses) {
    const rows = [...horses].sort((a,b) => (toNum(a.umaban) ?? 999) - (toNum(b.umaban) ?? 999));
    return `
      <section class="nk-section">
        <div class="nk-section-title">出走馬一覧</div>
        <div class="nk-horse-card-list">
          ${rows.map(h => `
            <article class="nk-horse-card">
              <div class="nk-horse-top"><div class="nk-horse-num">${escapeHtml(h.umaban ?? '')}</div><div class="nk-horse-name">${escapeHtml(h.horse_name ?? '')}</div></div>
              <div class="nk-horse-grid">
                <div><span>AI</span><strong>${escapeHtml(h.pred_order ?? '—')}</strong></div>
                <div><span>人気</span><strong>${escapeHtml(h.popularity ?? '—')}</strong></div>
                <div><span>単勝</span><strong>${formatOdds(h.tansho_odds)}</strong></div>
                <div><span>適性</span><strong>${escapeHtml(h.course_adv_rank ?? '—')}</strong></div>
                <div><span>勝率</span><strong>${formatPct01(h.p_win)}</strong></div>
                <div><span>複勝率</span><strong>${formatPct01(h.p_top3)}</strong></div>
              </div>
            </article>
          `).join('')}
        </div>
      </section>
    `;
  }

  async function init() {
    const q = readQuery();
    const app = document.getElementById('race-app');
    if (!q.date || !q.race_id) {
      app.innerHTML = '<div class="nk-error-box">date と race_id が必要です。</div>';
      return;
    }
    try {
      const data = await fetchJson(`${dataRoot}/${q.date}/race_${q.race_id}.json`);
      const race = data.race || {};
      const horses = data.horses || [];
      const s = summary(horses);
      const gaps = gapPanels(horses);
      const cond = [race.course, race.surface, race.distance ? `${race.distance}m` : '', race.headcount ? `${race.headcount}頭` : ''].filter(Boolean).join(' / ');
      app.innerHTML = `
        <section class="nk-section nk-hero-race">
          <div class="nk-breadcrumb">予想整理サイト / 出走馬一覧 / netkeiba寄せ / スマホ重視</div>
          <div class="nk-race-title">${escapeHtml(race.course ?? '')} ${escapeHtml(race.race_no ?? '')}R ${escapeHtml(race.race_name ?? '')}</div>
          <div class="nk-race-cond">${escapeHtml(cond)}</div>
          <div class="nk-page-tabs">
            <a class="nk-action-btn is-primary" href="./race_detail.html?date=${encodeURIComponent(q.date)}&race_id=${encodeURIComponent(q.race_id)}">出走馬一覧</a>
            <a class="nk-action-btn" href="./past_detail.html?date=${encodeURIComponent(q.date)}&race_id=${encodeURIComponent(q.race_id)}">過去走比較</a>
            <a class="nk-action-btn" href="./betting.html?date=${encodeURIComponent(q.date)}&race_id=${encodeURIComponent(q.race_id)}">買い目作成</a>
          </div>
        </section>
        ${renderPrediction(s)}
        ${renderGapSection(gaps)}
        ${renderHorses(horses)}
      `;
    } catch (err) {
      app.innerHTML = `<div class="nk-error-box">${escapeHtml(err?.message || String(err))}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
