(function () {
  'use strict';

  const PAGE_DEFAULTS = { race: 'race_detail.html', past: 'past_detail.html', betting: 'betting.html' };
  const state = { data: null, analysis: null, betType: 'umaren', betMode: 'nagashi', stake: 100, main: new Set(), sub: new Set(), third: new Set() };
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const RA = window.RaceAnalysis;

  function getDataRoot() { return document.body?.dataset?.dataRoot || './data'; }
  function getPage(kind) { return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind]; }
  function getJsonPath() {
    const p = new URLSearchParams(location.search);
    const raceId = p.get('race_id'); const date = p.get('date');
    if (!raceId || !date) throw new Error('race_id と date をURLに入れてな。');
    return `${getDataRoot()}/${date}/race_${raceId}.json`;
  }
  function buildUrl(kind) { const race = state.data?.race || {}; return `${getPage(kind)}?${new URLSearchParams({ date: state.data?.race_date, race_id: race.race_id }).toString()}`; }
  async function fetchJson(path) { const res = await fetch(path, { cache: 'no-store' }); if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`); return res.json(); }
  function setStatus(msg, isError = false) { const el = qs('#betting-status'); if (!el) return; el.hidden = false; el.textContent = msg; el.classList.toggle('is-error', !!isError); }
  function horseKey(h) { return String(h.horse_id || h.umaban || h.horse_name); }
  function horses() { return (state.analysis?.sorted || state.data?.horses || []).slice(); }
  function sel(kind) { return kind === 'main' ? state.main : kind === 'sub' ? state.sub : state.third; }
  function findHorse(id) { return horses().find((h) => horseKey(h) === id); }
  function sortedSelected(kind) { return horses().filter((h) => sel(kind).has(horseKey(h))); }

  function renderLayout() {
    const root = qs('#betting-app');
    root.innerHTML = `
      <section class="betting-page">
        <div id="betting-status" class="page-status" hidden></div>
        <section id="betting-hero" class="sheet race-hero"></section>
        <nav id="betting-tabs" class="page-tab-strip"></nav>
        <section id="betting-summary" class="sheet summary-panel"></section>
        <section class="sheet betting-control-panel">
          <div class="section-title-row"><div><h2 class="section-title">買い目設定</h2><div class="section-subtitle">保存はせず、この場だけで点数と組み合わせを作る形や。</div></div></div>
          <div class="betting-control-grid">
            <label>1点金額<input id="bet-stake" type="text" inputmode="numeric" value="100"></label>
            <div><div class="compare-toolbar__meta">券種</div><div class="segmented-row" id="bet-type-row"></div></div>
            <div><div class="compare-toolbar__meta">方式</div><div class="segmented-row" id="bet-mode-row"></div></div>
          </div>
          <div class="quick-pick-row" id="quick-pick-row"></div>
          <div class="betting-panel-note">単勝は主選択、馬連・ワイドは主選択と相手、三連複は主選択・相手・三列目を使うで。</div>
        </section>
        <section class="sheet betting-picker-panel">
          <div class="section-title-row"><div><h2 class="section-title">馬選択</h2><div class="section-subtitle">主選択・相手・三列目を押して組み合わせる。</div></div></div>
          <div id="pick-board" class="pick-board"></div>
        </section>
        <section class="sheet betting-result-panel">
          <div class="ticket-box__head"><div><h2 class="section-title" style="margin:0;">買い目プレビュー</h2><div class="section-subtitle">表示だけ。保存はしない。</div></div><div class="summary-chip-row" id="bet-summary-chips"></div></div>
          <div id="ticket-list" class="ticket-list"></div>
          <textarea id="ticket-text" class="ticket-textarea" readonly></textarea>
        </section>
        <div class="betting-sticky-bar"><div class="betting-sticky-bar__main"><div class="compare-toolbar__meta">合計</div><div id="sticky-total" class="betting-sticky-bar__value">0点 / 0円</div></div><button id="copy-ticket" type="button" class="action-link action-link--primary ticket-copy">買い目をコピー</button></div>
      </section>`;
  }

  function renderHero() {
    const hero = qs('#betting-hero'); const race = state.data?.race || {}; const s = state.analysis?.summary;
    hero.innerHTML = `
      <div class="race-hero__head"><div><div class="race-hero__date">${RA.esc(state.data?.race_date || '')}</div><h1 class="race-hero__title">${RA.esc(race.course || '')} ${RA.esc(race.race_no || '')}R ${RA.esc(race.race_name || '')}</h1><div class="race-hero__meta">${RA.esc([race.surface, race.distance ? `${race.distance}m` : '', race.headcount ? `${race.headcount}頭` : ''].filter(Boolean).join(' / '))}</div></div><div class="tag-list"><span class="tag tag--blue">買い目作成</span><span class="tag">${RA.esc(s?.status || '混戦')}</span></div></div>
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
    const box = qs('#betting-summary'); const s = state.analysis.summary;
    box.innerHTML = `
      <div class="section-title-row"><div><h2 class="section-title">予想まとめ</h2><div class="section-subtitle">人気判定ロジックをそのまま使って、軸候補・穴・危険人気を先に整理。</div></div></div>
      <div class="summary-grid summary-grid--2">
        <section class="summary-card"><div class="summary-card__head"><span class="badge ${s.status === '本命寄り' ? 'badge--blue' : s.status === '見送り寄り' ? 'badge--red' : 'badge--warn'}">${RA.esc(s.status)}</span></div>
          ${s.mainHorse ? `<div class="summary-main-horse">◎ ${RA.esc(s.mainHorse.umaban)} ${RA.esc(s.mainHorse.horse_name)}</div><div class="summary-main-meta">勝率 ${RA.fmtPct(s.mainHorse.p_win)} / 複勝率 ${RA.fmtPct(s.mainHorse.p_top3)} / 単勝 ${RA.fmtNum(s.mainHorse.tansho_odds)} / 人気 ${RA.fmt(s.mainHorse.popularity)}</div>` : ''}
          <div class="summary-comment">${RA.esc(s.comment || '')}</div>
          ${s.lineHorses?.length ? `<div class="summary-chip-row">${s.lineHorses.map((h, i) => `<span class="mini-pill mini-pill--plain">${i === 0 ? '○' : '▲'} ${RA.esc(h.umaban)} ${RA.esc(h.horse_name)}</span>`).join('')}</div>` : ''}
        </section>
        <section class="summary-card"><h3 class="mini-title">人気馬まとめ</h3>
          ${(s.popularSummary || []).slice(0,5).map((p) => `<div class="popular-summary-item"><div><strong>${RA.esc(p.popularity)}人気 ${RA.esc(p.umaban)} ${RA.esc(p.horse_name)}</strong><div class="popular-summary-meta">${RA.esc(p.comment || '')}</div></div><span class="mini-pill ${popularClass(p.label)}">${RA.esc(p.label || '妥当')}</span></div>`).join('') || '<div class="section-subtitle">人気上位データなし</div>'}
        </section>
      </div>
      <div class="summary-grid summary-grid--2" style="margin-top:12px;">
        <section class="summary-card"><h3 class="mini-title">穴候補</h3>${(s.holeHorses || []).length ? s.holeHorses.map((h) => `<div class="summary-list-row"><strong>${RA.esc(h.umaban)} ${RA.esc(h.horse_name)}</strong><div class="summary-row-meta">${RA.esc(h.hole_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}</section>
        <section class="summary-card"><h3 class="mini-title">危険人気</h3>${(s.dangerHorses || []).length ? s.dangerHorses.map((h) => `<div class="summary-list-row"><strong>${RA.esc(h.umaban)} ${RA.esc(h.horse_name)}</strong><div class="summary-row-meta">${RA.esc(h.danger_reason || '')}</div></div>`).join('') : '<div class="section-subtitle">該当馬なし</div>'}</section>
      </div>`;
  }

  function popularClass(label) { if (label === '信頼') return 'mini-pill--trust'; if (label === '危険') return 'mini-pill--danger'; if (label === 'やや危険') return 'mini-pill--warn'; return 'mini-pill--plain'; }

  function renderControls() {
    const typeRow = qs('#bet-type-row'); const modeRow = qs('#bet-mode-row'); const quick = qs('#quick-pick-row');
    typeRow.innerHTML = [['tansho','単勝'],['umaren','馬連'],['wide','ワイド'],['trio','三連複']].map(([k,l]) => `<button type="button" class="segmented-btn${state.betType === k ? ' is-active' : ''}" data-bet-type="${k}">${l}</button>`).join('');
    modeRow.innerHTML = [['box','BOX'],['nagashi','軸流し'],['formation','フォーメーション']].map(([k,l]) => `<button type="button" class="segmented-btn${state.betMode === k ? ' is-active' : ''}" data-bet-mode="${k}">${l}</button>`).join('');
    qsa('[data-bet-type]', typeRow).forEach((btn) => btn.onclick = () => { state.betType = btn.dataset.betType; renderControls(); renderBoard(); renderTickets(); });
    qsa('[data-bet-mode]', modeRow).forEach((btn) => btn.onclick = () => { state.betMode = btn.dataset.betMode; renderControls(); renderBoard(); renderTickets(); });
    const s = state.analysis.summary; const top = s.mainHorse; const second = s.lineHorses?.[0]; const third = s.lineHorses?.[1]; const hole = s.holeHorses?.[0];
    quick.innerHTML = `
      <button type="button" class="action-link" data-quick="axis-top">AI1位を軸にする</button>
      <button type="button" class="action-link" data-quick="axis-top2">AI上位2頭を主選択</button>
      <button type="button" class="action-link" data-quick="axis-hole">穴候補を相手に入れる</button>
      <button type="button" class="action-link" data-quick="clear">選択解除</button>`;
    qsa('[data-quick]', quick).forEach((btn) => btn.onclick = () => {
      const action = btn.dataset.quick;
      if (action === 'clear') { state.main.clear(); state.sub.clear(); state.third.clear(); renderBoard(); renderTickets(); return; }
      if (action === 'axis-top' && top) { state.main = new Set([horseKey(findHorseByUmaban(top.umaban) || top)]); if (second) state.sub = new Set([horseKey(findHorseByUmaban(second.umaban) || second)]); }
      if (action === 'axis-top2') { state.main = new Set([horseKey(findHorseByUmaban(top?.umaban) || top), horseKey(findHorseByUmaban(second?.umaban) || second)].filter(Boolean)); }
      if (action === 'axis-hole' && hole) { state.sub.add(horseKey(findHorseByUmaban(hole.umaban) || hole)); }
      renderBoard(); renderTickets();
    });
    qs('#bet-stake').value = String(state.stake);
    qs('#bet-stake').onchange = () => { state.stake = Math.max(100, Number(String(qs('#bet-stake').value).replace(/\D/g,'')) || 100); qs('#bet-stake').value = String(state.stake); renderTickets(); };
  }

  function findHorseByUmaban(umaban) { return horses().find((h) => String(h.umaban) === String(umaban)); }

  function toggle(kind, id) {
    const set = sel(kind);
    if (set.has(id)) set.delete(id); else set.add(id);
  }

  function renderBoard() {
    const board = qs('#pick-board');
    const rows = horses();
    board.innerHTML = rows.map((h) => {
      const id = horseKey(h); const main = state.main.has(id); const sub = state.sub.has(id); const third = state.third.has(id);
      const label = h._analysis?.popular_label || '';
      return `
        <div class="pick-card">
          <div class="pick-card__head"><div><strong>${RA.esc(h.umaban)} ${RA.esc(h.horse_name)}</strong><div class="pick-meta">AI${RA.esc(RA.fmt(h.pred_order))} / 人気${RA.esc(RA.fmt(h.popularity))} / 単勝${RA.esc(RA.fmtNum(h.tansho_odds))}</div></div><div class="tag-list">${label ? `<span class="mini-pill ${popularClass(label)}">${RA.esc(label)}</span>` : ''}${h._analysis?.hole_label ? `<span class="mini-pill mini-pill--trust">${RA.esc(h._analysis.hole_label)}</span>` : ''}${h._analysis?.danger_label ? `<span class="mini-pill mini-pill--danger">${RA.esc(h._analysis.danger_label)}</span>` : ''}</div></div>
          <div class="pick-btn-row">
            <button type="button" class="pick-btn${main ? ' is-active' : ''}" data-kind="main" data-id="${RA.esc(id)}">主選択</button>
            <button type="button" class="pick-btn${sub ? ' is-active' : ''}" data-kind="sub" data-id="${RA.esc(id)}">相手</button>
            <button type="button" class="pick-btn${third ? ' is-active' : ''}" data-kind="third" data-id="${RA.esc(id)}">三列目</button>
          </div>
        </div>`;
    }).join('');
    qsa('[data-kind]', board).forEach((btn) => btn.onclick = () => { toggle(btn.dataset.kind, btn.dataset.id); renderBoard(); renderTickets(); });
  }

  function combinations(arr, k) {
    const out = [];
    function rec(start, pick) {
      if (pick.length === k) { out.push(pick.slice()); return; }
      for (let i = start; i < arr.length; i += 1) { pick.push(arr[i]); rec(i + 1, pick); pick.pop(); }
    }
    rec(0, []); return out;
  }
  function uniqSorted(arr) { return [...new Set(arr)].sort((a, b) => (RA.toNum(a) ?? 999) - (RA.toNum(b) ?? 999) || String(a).localeCompare(String(b))); }

  function buildTickets() {
    const main = sortedSelected('main').map((h) => String(h.umaban));
    const sub = sortedSelected('sub').map((h) => String(h.umaban));
    const third = sortedSelected('third').map((h) => String(h.umaban));
    let tickets = [];
    if (state.betType === 'tansho') tickets = main.map((u) => [u]);
    else if (state.betType === 'umaren' || state.betType === 'wide') {
      if (state.betMode === 'box') tickets = combinations(uniqSorted([...main, ...sub, ...third]), 2);
      else tickets = main.flatMap((m) => uniqSorted(sub).filter((s) => s !== m).map((s) => uniqSorted([m, s])));
    } else if (state.betType === 'trio') {
      if (state.betMode === 'box') tickets = combinations(uniqSorted([...main, ...sub, ...third]), 3);
      else if (state.betMode === 'formation') tickets = main.flatMap((m) => uniqSorted(sub).filter((s) => s !== m).flatMap((s) => uniqSorted(third).filter((t) => t !== m && t !== s).map((t) => uniqSorted([m, s, t]))));
      else tickets = main.flatMap((m) => combinations(uniqSorted(sub).filter((s) => s !== m), 2).map((pair) => uniqSorted([m, ...pair])));
    }
    const seen = new Set();
    return tickets.filter((t) => { const key = t.join('-'); if (seen.has(key)) return false; seen.add(key); return true; });
  }

  function renderTickets() {
    const tickets = buildTickets();
    const list = qs('#ticket-list'); const text = qs('#ticket-text'); const chips = qs('#bet-summary-chips'); const sticky = qs('#sticky-total');
    const total = tickets.length * state.stake;
    chips.innerHTML = `<span class="mini-pill mini-pill--plain">${tickets.length}点</span><span class="mini-pill mini-pill--plain">${total.toLocaleString('ja-JP')}円</span><span class="mini-pill mini-pill--plain">${state.betType === 'tansho' ? '単勝' : state.betType === 'umaren' ? '馬連' : state.betType === 'wide' ? 'ワイド' : '三連複'}</span>`;
    sticky.textContent = `${tickets.length}点 / ${total.toLocaleString('ja-JP')}円`;
    list.innerHTML = tickets.length ? tickets.map((t) => `<div class="ticket-item"><span class="ticket-item__bet">${t.join(' - ')}</span><span class="ticket-item__yen">${state.stake}円</span></div>`).join('') : '<div class="section-subtitle">選択を入れるとここに買い目が出る。</div>';
    text.value = tickets.map((t) => `${t.join(' - ')} ${state.stake}円`).join('\n');
  }

  function bindCopy() {
    qs('#copy-ticket').onclick = async () => {
      const text = qs('#ticket-text').value;
      if (!text) return;
      try { await navigator.clipboard.writeText(text); qs('#copy-ticket').textContent = 'コピーした'; setTimeout(() => { qs('#copy-ticket').textContent = '買い目をコピー'; }, 1200); }
      catch (_) { qs('#ticket-text').select(); document.execCommand('copy'); }
    };
  }

  async function init() {
    try {
      renderLayout(); setStatus('買い目ページを読み込み中…');
      state.data = await fetchJson(getJsonPath());
      state.analysis = RA.analyzeRaceHorses(state.data.horses || []);
      const top = state.analysis.summary.mainHorse; const second = state.analysis.summary.lineHorses?.[0]; const third = state.analysis.summary.lineHorses?.[1];
      if (top) state.main.add(horseKey(findHorseByUmaban(top.umaban) || top));
      if (second) state.sub.add(horseKey(findHorseByUmaban(second.umaban) || second));
      if (third) state.third.add(horseKey(findHorseByUmaban(third.umaban) || third));
      renderHero(); renderTabs(); renderSummary(); renderControls(); renderBoard(); renderTickets(); bindCopy();
      document.title = `${state.data.race?.course || ''} ${state.data.race?.race_no || ''}R ${state.data.race?.race_name || ''} | 買い目作成`;
      qs('#betting-status').hidden = true;
    } catch (err) {
      console.error(err); setStatus(err?.message || 'betting.js 初期化に失敗した', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
