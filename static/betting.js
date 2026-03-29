(function () {
  'use strict';

  const PAGE_DEFAULTS = { race: 'race_detail.html', past: 'past_detail.html', betting: 'betting.html' };
  const state = { data: null, analysis: null, recommendation: null };
  const qs = (s, r = document) => r.querySelector(s);
  const RA = window.RaceAnalysis;

  function getDataRoot() { return document.body?.dataset?.dataRoot || './data'; }
  function getPage(kind) { return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind]; }
  function getJsonPath() {
    const p = new URLSearchParams(location.search);
    const raceId = p.get('race_id'); const date = p.get('date');
    if (!raceId || !date) throw new Error('race_id と date をURLに入れてください。');
    return `${getDataRoot()}/${date}/race_${raceId}.json`;
  }
  function buildUrl(kind) {
    const race = state.data?.race || {};
    return `${getPage(kind)}?${new URLSearchParams({ date: state.data?.race_date, race_id: race.race_id }).toString()}`;
  }
  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`);
    return res.json();
  }
  function setStatus(msg, isError = false) {
    const el = qs('#betting-status');
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle('is-error', !!isError);
  }
  function horses() { return (state.analysis?.sorted || state.data?.horses || []).slice(); }
  function findHorseByUmaban(umaban) { return horses().find((h) => String(h.umaban) === String(umaban)); }

  function popularClass(label) {
    if (label === '信頼') return 'mini-pill--trust';
    if (label === '危険') return 'mini-pill--danger';
    if (label === 'やや危険') return 'mini-pill--warn';
    return 'mini-pill--plain';
  }

  function isCsvTicket(ticket) {
    const source = String(ticket?.source || '').toLowerCase();
    if (source.split('+').includes('csv')) return true;
    return Array.isArray(ticket?.tags) && ticket.tags.some((tag) => String(tag).toUpperCase() === 'CSV');
  }

  function renderLayout() {
    const root = qs('#betting-app');
    root.innerHTML = `
      <section class="betting-page">
        <div id="betting-status" class="page-status" hidden></div>
        <section id="betting-hero" class="sheet race-hero"></section>
        <nav id="betting-tabs" class="page-tab-strip"></nav>
        <section id="betting-summary" class="sheet summary-panel"></section>

        <section class="sheet betting-reco-panel">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">推奨買い目</h2>
              <div class="section-subtitle">CSV推奨があるレースでも自動生成を併記。単勝・馬連・三連複を表示。</div>
            </div>
            <div class="summary-chip-row" id="bet-reco-chips"></div>
          </div>
          <div class="reco-grid">
            <section class="reco-box reco-box--highlight">
              <h3 class="reco-box__title">単勝</h3>
              <div id="reco-tansho" class="reco-list"></div>
            </section>
            <section class="reco-box">
              <h3 class="reco-box__title">馬連</h3>
              <div id="reco-umaren" class="reco-list"></div>
            </section>
          </div>
          <div style="margin-top:12px;">
            <section class="reco-box">
              <h3 class="reco-box__title">三連複</h3>
              <div id="reco-trio" class="reco-list"></div>
            </section>
          </div>
        </section>

        <section class="sheet betting-result-panel">
          <div class="ticket-box__head">
            <div>
              <h2 class="section-title" style="margin:0;">買い目テキスト</h2>
              <div class="section-subtitle">コピー用の一覧です。</div>
            </div>
            <div class="summary-chip-row" id="bet-summary-chips"></div>
          </div>
          <div id="ticket-list" class="ticket-list"></div>
          <textarea id="ticket-text" class="ticket-textarea" readonly></textarea>
        </section>

        <div class="betting-sticky-bar">
          <div class="betting-sticky-bar__main">
            <div class="compare-toolbar__meta">合計</div>
            <div id="sticky-total" class="betting-sticky-bar__value">0点 / 0円</div>
          </div>
          <button id="copy-ticket" type="button" class="action-link action-link--primary ticket-copy">買い目をコピー</button>
        </div>
      </section>`;
  }

  function renderHero() {
    const hero = qs('#betting-hero');
    const race = state.data?.race || {};
    const s = state.analysis?.summary;
    hero.innerHTML = `
      <div class="race-hero__head">
        <div>
          <div class="race-hero__date">${RA.esc(state.data?.race_date || '')}</div>
          <h1 class="race-hero__title">${RA.esc(race.course || '')} ${RA.esc(race.race_no || '')}R ${RA.esc(race.race_name || race.title || '')}</h1>
          <div class="race-hero__meta">${RA.esc([race.surface, race.distance ? `${race.distance}m` : '', race.headcount ? `${race.headcount}頭` : ''].filter(Boolean).join(' / '))}</div>
        </div>
        <div class="tag-list">
          <span class="tag tag--blue">推奨買い目</span>
          <span class="tag">${RA.esc(s?.status || '混戦')}</span>
        </div>
      </div>
      <div class="info-banner">${RA.esc(s?.comment || '')}</div>`;
  }

  function renderTabs() {
    const nav = qs('#betting-tabs');
    nav.innerHTML = `
      <a class="race-tab" href="${RA.esc(buildUrl('race'))}">出走馬一覧</a>
      <a class="race-tab" href="${RA.esc(buildUrl('past'))}">過去走比較</a>
      <a class="race-tab is-active" href="${RA.esc(buildUrl('betting'))}">買い目作成</a>`;
  }

  function renderSummary() {
    const box = qs('#betting-summary');
    const s = state.analysis.summary;
    box.innerHTML = `
      <div class="section-title-row"><div><h2 class="section-title">予想まとめ</h2><div class="section-subtitle">人気判定ロジックをそのまま使って、軸候補・穴・危険人気を先に整理。</div></div></div>
      <div class="summary-grid summary-grid--2">
        <section class="summary-card">
          <div class="summary-card__head"><span class="badge ${s.status === '本命寄り' ? 'badge--blue' : s.status === '見送り寄り' ? 'badge--red' : 'badge--warn'}">${RA.esc(s.status)}</span></div>
          ${s.mainHorse ? `<div class="summary-main-horse">◎ ${RA.esc(s.mainHorse.umaban)} ${RA.esc(s.mainHorse.horse_name)}</div><div class="summary-main-meta">勝率 ${RA.fmtPct(s.mainHorse.p_win)} / 複勝率 ${RA.fmtPct(s.mainHorse.p_top3)} / 単勝 ${RA.fmtNum(s.mainHorse.tansho_odds)} / 人気 ${RA.fmt(s.mainHorse.popularity)}</div>` : ''}
          <div class="summary-comment">${RA.esc(s.comment || '')}</div>
          ${s.lineHorses?.length ? `<div class="summary-chip-row">${s.lineHorses.map((h, i) => `<span class="mini-pill mini-pill--plain">${i === 0 ? '○' : '▲'} ${RA.esc(h.umaban)} ${RA.esc(h.horse_name)}</span>`).join('')}</div>` : ''}
        </section>
        <section class="summary-card">
          <h3 class="mini-title">人気馬まとめ</h3>
          ${(s.popularSummary || []).slice(0, 5).map((p) => `<div class="popular-summary-item"><div><strong>${RA.esc(p.popularity)}人気 ${RA.esc(p.umaban)} ${RA.esc(p.horse_name)}</strong><div class="popular-summary-meta">${RA.esc(p.comment || '')}</div></div><span class="mini-pill ${popularClass(p.label)}">${RA.esc(p.label || '妥当')}</span></div>`).join('') || '<div class="section-subtitle">人気上位データなし</div>'}
        </section>
      </div>
      <div class="summary-grid summary-grid--2" style="margin-top:12px;">
        <section class="summary-card"><h3 class="mini-title">穴候補</h3>${(s.holeHorses || []).length ? s.holeHorses.map((h) => `<div class="summary-list-row"><strong>${RA.esc(h.umaban)} ${RA.esc(h.horse_name)}</strong><div class="summary-row-meta">${RA.esc(h.hole_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}</section>
        <section class="summary-card"><h3 class="mini-title">危険人気</h3>${(s.dangerHorses || []).length ? s.dangerHorses.map((h) => `<div class="summary-list-row"><strong>${RA.esc(h.umaban)} ${RA.esc(h.horse_name)}</strong><div class="summary-row-meta">${RA.esc(h.danger_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}</section>
      </div>`;
  }

  function normalizeTickets(list, betType) {
    return (list || []).map((row) => {
      const horses = Array.isArray(row.horses)
        ? row.horses.map((v) => Number(v)).filter((v) => Number.isFinite(v))
        : String(row.numbers || '').split('-').map((v) => Number(v)).filter((v) => Number.isFinite(v));
      const numbers = row.numbers || horses.join('-');
      const horseNames = Array.isArray(row.horse_names) && row.horse_names.length
        ? row.horse_names
        : horses.map((u) => findHorseByUmaban(u)?.horse_name || `${u}番`);
      return {
        bet_type: row.bet_type || betType,
        numbers,
        horses,
        horse_names: horseNames,
        stake_yen: Number(row.stake_yen || 100) || 100,
        score: typeof row.score === 'number' ? row.score : Number(row.score || NaN),
        source: row.source || 'json',
        reason: row.reason || '',
        tags: Array.isArray(row.tags) ? row.tags : [],
      };
    });
  }

  function hitSort(a, b) {
    const aTop = Number(a?.p_top3 || -1), bTop = Number(b?.p_top3 || -1);
    if (bTop !== aTop) return bTop - aTop;
    const aWin = Number(a?.p_win || -1), bWin = Number(b?.p_win || -1);
    if (bWin !== aWin) return bWin - aWin;
    return Number(a?.pred_order || 999) - Number(b?.pred_order || 999);
  }

  function buildAutoFallback() {
    const sorted = horses().sort(hitSort);
    const top2 = sorted.slice(0, Math.min(2, sorted.length));
    const top4 = sorted.slice(0, Math.min(4, sorted.length));
    const top5 = sorted.slice(0, Math.min(5, sorted.length));

    const tansho = top2.map((h, idx) => ({
      bet_type: '単勝',
      numbers: String(h.umaban),
      horses: [Number(h.umaban)],
      horse_names: [h.horse_name],
      stake_yen: 100,
      score: Number(h.p_win || NaN),
      source: 'auto',
      reason: `的中率寄り / 上位${idx + 1}位候補 / 勝率 ${RA.fmtPct(h.p_win)} / 複勝率 ${RA.fmtPct(h.p_top3)}`,
      tags: ['自動', '上位候補'],
    }));

    const umaren = [];
    for (let i = 0; i < top4.length; i += 1) {
      for (let j = i + 1; j < top4.length; j += 1) {
        const a = top4[i], b = top4[j];
        const nums = [Number(a.umaban), Number(b.umaban)].sort((x, y) => x - y);
        umaren.push({
          bet_type: '馬連',
          numbers: nums.join('-'),
          horses: nums,
          horse_names: [a.horse_name, b.horse_name],
          stake_yen: 100,
          score: Number((a.p_top3 || 0) * (b.p_top3 || 0)),
          source: 'auto',
          reason: `的中率寄り / 上位${top4.length}頭BOX`,
          tags: ['自動', `${top4.length}頭BOX`],
        });
      }
    }

    const trio = [];
    for (let i = 0; i < top5.length; i += 1) {
      for (let j = i + 1; j < top5.length; j += 1) {
        for (let k = j + 1; k < top5.length; k += 1) {
          const a = top5[i], b = top5[j], c = top5[k];
          const nums = [Number(a.umaban), Number(b.umaban), Number(c.umaban)].sort((x, y) => x - y);
          trio.push({
            bet_type: '三連複',
            numbers: nums.join('-'),
            horses: nums,
            horse_names: [a.horse_name, b.horse_name, c.horse_name],
            stake_yen: 100,
            score: Number((a.p_top3 || 0) * (b.p_top3 || 0) * (c.p_top3 || 0)),
            source: 'auto',
            reason: `的中率寄り / 上位${top5.length}頭BOX`,
            tags: ['自動', `${top5.length}頭BOX`],
          });
        }
      }
    }
    return {
      source: 'auto',
      strategy: 'hit_rate_first',
      notes: ['JSON内推奨なし', '単勝2点 / 馬連4頭BOX / 三連複5頭BOX'],
      tickets: { tansho, umaren, trio },
    };
  }

  function mergeTicketLists(...lists) {
    const map = new Map();
    lists.flat().forEach((row) => {
      if (!row || !row.numbers) return;
      const key = row.numbers;
      if (!map.has(key)) {
        map.set(key, { ...row, tags: Array.isArray(row.tags) ? [...row.tags] : [] });
        return;
      }
      const cur = map.get(key);
      cur.tags = Array.from(new Set([...(cur.tags || []), ...(row.tags || [])]));
      cur.source = cur.source === row.source ? cur.source : `${cur.source}+${row.source}`;
      if (!Number.isFinite(cur.score) && Number.isFinite(row.score)) cur.score = row.score;
      if (!cur.reason && row.reason) cur.reason = row.reason;
    });
    return Array.from(map.values()).sort((a, b) => {
      const aScore = Number.isFinite(a.score) ? a.score : -999;
      const bScore = Number.isFinite(b.score) ? b.score : -999;
      return bScore - aScore || String(a.numbers).localeCompare(String(b.numbers), 'ja');
    });
  }

  function resolveRecommendation() {
    const base = state.data?.betting_recommendation;
    const auto = buildAutoFallback();
    if (!base || !base.tickets) return auto;

    const baseTansho = normalizeTickets(base.tickets.tansho, '単勝');
    const baseUmaren = normalizeTickets(base.tickets.umaren, '馬連');
    const baseTrio = normalizeTickets(base.tickets.trio, '三連複');

    return {
      source: base.source || 'json',
      strategy: base.strategy || 'hit_rate_first',
      notes: Array.isArray(base.notes) ? base.notes : [],
      tickets: {
        tansho: mergeTicketLists(baseTansho, auto.tickets.tansho),
        umaren: mergeTicketLists(baseUmaren, auto.tickets.umaren),
        trio: mergeTicketLists(baseTrio, auto.tickets.trio),
      },
    };
  }

  function renderRecoList(target, tickets) {
    const el = qs(target);
    if (!tickets.length) {
      el.innerHTML = '<div class="section-subtitle">該当なし</div>';
      return;
    }

    const sorted = [...tickets].sort((a, b) => {
      const aCsv = isCsvTicket(a) ? 1 : 0;
      const bCsv = isCsvTicket(b) ? 1 : 0;
      if (bCsv !== aCsv) return bCsv - aCsv;

      const aScore = Number.isFinite(a.score) ? a.score : -999;
      const bScore = Number.isFinite(b.score) ? b.score : -999;
      return bScore - aScore;
    });

    el.innerHTML = sorted.map((t) => {
      const csv = isCsvTicket(t);
      const typeLabel = (t.tags || []).join(' / ') || t.source || '';
      return `
        <div class="ticket-card ${csv ? 'ticket-card--csv' : ''}">
          <div class="ticket-card__head">
            <div class="ticket-card__type">${RA.esc(typeLabel)}</div>
            ${csv ? '<span class="mini-pill mini-pill--csv">CSV推奨</span>' : ''}
          </div>
          <div class="ticket-card__horses">${RA.esc(t.numbers)}${t.horse_names?.length ? ` / ${RA.esc(t.horse_names.join(' - '))}` : ''}</div>
          <div class="ticket-card__meta">
            ${csv ? 'CSV推奨を含む / ' : ''}
            ${RA.esc(t.reason || '')}
            ${Number.isFinite(t.score) ? ` / score ${RA.fmtNum(t.score)}` : ''}
            / ${RA.esc(String(t.stake_yen))}円
          </div>
        </div>
      `;
    }).join('');
  }

  function renderRecommendations() {
    const rec = state.recommendation;
    renderRecoList('#reco-tansho', rec.tickets.tansho || []);
    renderRecoList('#reco-umaren', rec.tickets.umaren || []);
    renderRecoList('#reco-trio', rec.tickets.trio || []);

    const allTickets = [
      ...(rec.tickets.tansho || []),
      ...(rec.tickets.umaren || []),
      ...(rec.tickets.trio || []),
    ];
    const csvCount = allTickets.filter(isCsvTicket).length;
    const total = allTickets.reduce((sum, t) => sum + (Number(t.stake_yen || 0) || 0), 0);
    qs('#bet-reco-chips').innerHTML = [
      `<span class="mini-pill mini-pill--plain">${RA.esc(rec.source || 'auto')}</span>`,
      `<span class="mini-pill mini-pill--plain">${RA.esc(rec.strategy || 'hit_rate_first')}</span>`,
      csvCount ? `<span class="mini-pill mini-pill--csv">CSV推奨 ${csvCount}点</span>` : '',
      `<span class="mini-pill mini-pill--plain">${allTickets.length}点</span>`,
      `<span class="mini-pill mini-pill--plain">${total.toLocaleString('ja-JP')}円</span>`
    ].filter(Boolean).join('');

    qs('#bet-summary-chips').innerHTML = (rec.notes || []).map((n) => `<span class="mini-pill mini-pill--plain">${RA.esc(n)}</span>`).join('');

    qs('#ticket-list').innerHTML = allTickets.length
      ? allTickets.map((t) => `<div class="ticket-item"><span class="ticket-item__bet">${RA.esc(t.bet_type)} ${RA.esc(t.numbers)}</span><span class="ticket-item__yen">${RA.esc(String(t.stake_yen))}円</span></div>`).join('')
      : '<div class="section-subtitle">表示できる買い目がありません。</div>';

    qs('#ticket-text').value = allTickets.map((t) => `${t.bet_type} ${t.numbers} ${t.stake_yen}円`).join('\n');
    qs('#sticky-total').textContent = `${allTickets.length}点 / ${total.toLocaleString('ja-JP')}円`;
  }

  function bindCopy() {
    qs('#copy-ticket').onclick = async () => {
      const text = qs('#ticket-text').value;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        qs('#copy-ticket').textContent = 'コピーした';
        setTimeout(() => { qs('#copy-ticket').textContent = '買い目をコピー'; }, 1200);
      } catch (_) {
        qs('#ticket-text').select();
        document.execCommand('copy');
      }
    };
  }

  async function init() {
    try {
      renderLayout();
      setStatus('買い目ページを読み込み中…');
      state.data = await fetchJson(getJsonPath());
      state.analysis = RA.analyzeRaceHorses(state.data.horses || []);
      state.recommendation = resolveRecommendation();

      renderHero();
      renderTabs();
      //renderSummary();
      renderRecommendations();
      bindCopy();

      document.title = `${state.data.race?.course || ''} ${state.data.race?.race_no || ''}R ${state.data.race?.race_name || state.data.race?.title || ''} | 推奨買い目`;
      qs('#betting-status').hidden = true;
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'betting.js 初期化に失敗しました', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
