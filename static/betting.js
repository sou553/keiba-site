(function () {
  'use strict';

  const PAGE_DEFAULTS = {
    race: 'race_detail.html',
    past: 'past_detail.html',
    betting: 'betting.html',
  };

  const state = {
    data: null,
    betType: 'umaren',
    betMode: 'nagashi',
    stake: 100,
    main: new Set(),
    sub: new Set(),
    third: new Set(),
  };

  function qs(s, root = document) { return root.querySelector(s); }
  function qsa(s, root = document) { return Array.from(root.querySelectorAll(s)); }
  function escapeHtml(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function fmt(v, fb = '—') { return v == null || v === '' ? fb : String(v); }
  function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  function fmtNum(v, d = 1, fb = '—') { const n = toNum(v); return n == null ? fb : n.toFixed(d).replace(/\.0$/, ''); }
  function fmtPct(v, d = 1, fb = '—') { const n = toNum(v); return n == null ? fb : `${(n * 100).toFixed(d)}%`; }
  function getDataRoot() { return document.body?.dataset?.dataRoot || './data'; }
  function getPageName(kind) { return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind]; }

  function getJsonPath() {
    const params = new URLSearchParams(window.location.search);
    const direct = params.get('json') || document.body?.dataset?.json;
    if (direct) return direct;
    const raceId = params.get('race_id') || params.get('raceId') || document.body?.dataset?.raceId;
    const date = params.get('date') || params.get('raceDate') || document.body?.dataset?.raceDate;
    if (!raceId || !date) throw new Error('race_id と date をURLパラメータに入れてな。例: ?date=20260322&race_id=202606020801');
    return `${getDataRoot()}/${date}/race_${raceId}.json`;
  }

  function buildPageUrl(kind, race) {
    const page = getPageName(kind);
    const params = new URLSearchParams({ date: race.race_date, race_id: race.race_id });
    return `${page}?${params.toString()}`;
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`);
    return res.json();
  }

  function setStatus(message, isError = false) {
    const el = qs('#betting-status');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle('is-error', !!isError);
  }

  function horseKey(h) { return String(h.horse_id ?? h.umaban ?? h.horse_name ?? ''); }
  function horses() { return (state.data?.horses || []).slice().sort((a,b)=>(toNum(a.pred_order) ?? 999) - (toNum(b.pred_order) ?? 999) || (toNum(a.umaban) ?? 999) - (toNum(b.umaban) ?? 999)); }
  function findHorse(id) { return horses().find((h)=>horseKey(h) === id); }
  function selected(kind) { return kind === 'main' ? state.main : kind === 'sub' ? state.sub : state.third; }
  function selectedHorses(kind) { return horses().filter((h)=>selected(kind).has(horseKey(h))); }

  function raceName(data) { return data.race?.race_name || data.horses?.[0]?.title || '買い目作成'; }

  function renderLayout() {
    const root = qs('#betting-app');
    if (!root) throw new Error('#betting-app が見つからへん。betting.html に <div id="betting-app"></div> を置いてな。');
    root.innerHTML = `
      <section class="betting-page">
        <div id="betting-status" class="page-status" hidden></div>
        <section id="betting-hero" class="sheet betting-hero"></section>
        <nav id="betting-tabs" class="page-tab-strip"></nav>
        <section class="sheet betting-reco-panel" id="betting-reco"></section>
        <section class="sheet betting-control-panel">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">買い目設定</h2>
              <div class="section-subtitle">保存せず、この場だけで点数と組み合わせを作る形や。</div>
            </div>
          </div>
          <div class="betting-control-grid">
            <label>1点金額
              <input type="text" id="bet-stake" inputmode="numeric" value="100">
            </label>
            <div>
              <div class="compare-toolbar__meta">券種</div>
              <div class="segmented-row" id="bet-type-row"></div>
            </div>
            <div>
              <div class="compare-toolbar__meta">方式</div>
              <div class="segmented-row" id="bet-mode-row"></div>
            </div>
          </div>
          <div class="quick-pick-row" id="quick-pick-row"></div>
          <div class="betting-panel-note">単勝は主選択、馬連・ワイドは主選択と相手、三連複は主選択・相手・三列目を使うで。</div>
        </section>
        <section class="sheet betting-picker-panel">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">馬選択</h2>
              <div class="section-subtitle">スマホでは、主選択・相手・三列目のボタンを押すだけで作れる。</div>
            </div>
          </div>
          <div class="pick-board" id="pick-board"></div>
        </section>
        <section class="sheet betting-result-panel">
          <div class="ticket-box__head">
            <div>
              <h2 class="section-title" style="margin:0;">買い目プレビュー</h2>
              <div class="section-subtitle">表示だけ。保存はせえへん。</div>
            </div>
            <div class="summary-chip-row" id="bet-summary-chips"></div>
          </div>
          <div class="ticket-list" id="ticket-list"></div>
          <textarea id="ticket-text" class="ticket-textarea" readonly></textarea>
        </section>
        <div class="betting-sticky-bar">
          <div class="betting-sticky-bar__main">
            <div class="compare-toolbar__meta">合計</div>
            <div class="betting-sticky-bar__value" id="sticky-total">0点 / 0円</div>
          </div>
          <button type="button" class="action-link action-link--primary ticket-copy" id="copy-ticket">買い目をコピー</button>
        </div>
      </section>
    `;
  }

  function courseText(data) {
    const race = data.race || {};
    const first = data.horses?.[0] || {};
    const distance = race.distance || first.distance_m || '';
    const surface = race.surface || first.surface || '';
    return [race.course, race.race_no ? `${race.race_no}R` : null, raceName(data), surface, distance ? `${distance}m` : null, race.headcount ? `${race.headcount}頭` : null].filter(Boolean).join(' / ');
  }

  function renderHero(data) {
    const hero = qs('#betting-hero');
    if (!hero) return;
    const top = (data.summary?.top_ai || [])[0] || horses()[0] || {};
    hero.innerHTML = `
      <div class="race-hero__head">
        <div>
          <div class="race-hero__date">${escapeHtml(fmt(data.race_date, ''))}</div>
          <h1 class="race-hero__title">${escapeHtml(courseText(data))}</h1>
          <div class="race-hero__meta">買い目作成ページ</div>
        </div>
        <div class="tag-list">
          <span class="tag tag--blue">保存なし</span>
          <span class="tag">AI1位 ${escapeHtml(fmt(top.umaban))} ${escapeHtml(fmt(top.horse_name))}</span>
        </div>
      </div>
      <div class="info-banner">AI1位 ${escapeHtml(fmt(top.umaban))} ${escapeHtml(fmt(top.horse_name))} を軸候補にして、主選択・相手・三列目を片手操作で組める形にしてあるで。</div>
    `;
    document.title = `${courseText(data)} | 買い目作成`;
  }

  function renderTabs(data) {
    const nav = qs('#betting-tabs');
    if (!nav) return;
    const race = data.race || {};
    race.race_date = data.race_date;
    const items = [
      { kind: 'race', label: '出走馬一覧', active: false },
      { kind: 'past', label: '過去走比較', active: false },
      { kind: 'betting', label: '買い目作成', active: true },
    ];
    nav.innerHTML = items.map((item) => `<a class="race-tab${item.active ? ' is-active' : ''}" href="${escapeHtml(buildPageUrl(item.kind, race))}">${escapeHtml(item.label)}</a>`).join('');
  }

  function divergenceItems() {
    return horses().map((horse) => {
      const pop = toNum(horse.popularity);
      const ai = toNum(horse.pred_order);
      const course = toNum(horse.course_adv_rank || horse.race_rank);
      const aiDelta = pop != null && ai != null ? pop - ai : null;
      const courseDelta = pop != null && course != null ? pop - course : null;
      return { horse, pop, ai, course, aiDelta, courseDelta };
    });
  }

  function recommendations() {
    const hs = horses();
    const top = hs[0] || {};
    const second = hs[1] || {};
    const third = hs[2] || {};
    const deltas = divergenceItems();
    const value = deltas.filter((x) => x.aiDelta != null && x.aiDelta >= 3).sort((a,b)=>(b.aiDelta||-99)-(a.aiDelta||-99))[0];
    const danger = deltas.filter((x) => x.pop != null && x.pop <= 5 && ((x.aiDelta != null && x.aiDelta <= -3) || (x.courseDelta != null && x.courseDelta <= -4))).sort((a,b)=>(a.aiDelta||99)-(b.aiDelta||99))[0];
    const p1 = toNum(top.p_top3) ?? 0;
    const p2 = toNum(second.p_top3) ?? 0;
    let stateText = '混戦';
    let note = '上位の力差は大きくない。相手を広げる方が無難。';
    if (p1 >= 0.7 && p1 - p2 >= 0.15) { stateText = '本命寄り'; note = '総合1位の信頼度が高め。軸流しが組みやすい。'; }
    else if (p1 < 0.5 || p1 - p2 < 0.05) { stateText = '見送り寄り'; note = '1位と2位の差が小さく、軸を決め切りにくい。'; }
    return { top, second, third, value: value?.horse, danger: danger?.horse, stateText, note };
  }

  function horseLine(h) {
    if (!h) return '該当なし';
    return `${fmt(h.umaban)} ${fmt(h.horse_name)}`;
  }

  function renderReco() {
    const box = qs('#betting-reco');
    if (!box) return;
    const reco = recommendations();
    box.innerHTML = `
      <div class="reco-grid">
        <div class="reco-box reco-box--highlight">
          <div class="tag-list" style="margin-bottom:8px;">
            <span class="badge ${reco.stateText === '本命寄り' ? 'badge--blue' : reco.stateText === '見送り寄り' ? 'badge--red' : 'badge--warn'}">${escapeHtml(reco.stateText)}</span>
          </div>
          <h2 class="reco-box__title">予想まとめ</h2>
          <div class="reco-main-name">◎ ${escapeHtml(horseLine(reco.top))}</div>
          <div class="metric-row">
            <span class="badge badge--plain">勝率 ${escapeHtml(fmtPct(reco.top?.p_win))}</span>
            <span class="badge badge--plain">複勝率 ${escapeHtml(fmtPct(reco.top?.p_top3))}</span>
            <span class="badge badge--plain">単勝 ${escapeHtml(fmtNum(reco.top?.tansho_odds, 1))}</span>
            <span class="badge badge--plain">人気 ${escapeHtml(fmt(reco.top?.popularity))}</span>
          </div>
          <div class="reco-box__text" style="margin-top:10px;">${escapeHtml(reco.note)}</div>
        </div>
        <div class="reco-side-stack">
          <div class="reco-box">
            <h3 class="reco-box__title">本線と穴</h3>
            <div class="reco-list">
              <div class="reco-item"><div><strong>○ ${escapeHtml(horseLine(reco.second))}</strong><div class="pick-meta">相手本線</div></div></div>
              <div class="reco-item"><div><strong>▲ ${escapeHtml(horseLine(reco.third))}</strong><div class="pick-meta">上位3頭目</div></div></div>
              <div class="reco-item"><div><strong>☆ ${escapeHtml(horseLine(reco.value))}</strong><div class="pick-meta">人気よりAIが高い妙味馬</div></div></div>
            </div>
          </div>
          <div class="reco-box">
            <h3 class="reco-box__title">危険人気</h3>
            <div class="reco-box__text">${escapeHtml(reco.danger ? `${horseLine(reco.danger)} は人気先行気味。相手までに抑える形が無難。` : '目立つ危険人気は少なめ。')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderControls() {
    const typeRow = qs('#bet-type-row');
    const modeRow = qs('#bet-mode-row');
    const quick = qs('#quick-pick-row');
    if (!typeRow || !modeRow || !quick) return;

    const typeItems = [
      ['tansho', '単勝'], ['umaren', '馬連'], ['wide', 'ワイド'], ['trio', '三連複'],
    ];
    typeRow.innerHTML = typeItems.map(([key, label]) => `<button type="button" class="segmented-btn${state.betType === key ? ' is-active' : ''}" data-bet-type="${key}">${label}</button>`).join('');

    const modeItems = [
      ['box', 'BOX'], ['nagashi', '軸流し'], ['formation', 'フォーメーション'],
    ];
    modeRow.innerHTML = modeItems.map(([key, label]) => `<button type="button" class="segmented-btn${state.betMode === key ? ' is-active' : ''}" data-bet-mode="${key}">${label}</button>`).join('');

    quick.innerHTML = `
      <button type="button" class="quick-pick" id="auto-top3">AI上位3頭を主選択</button>
      <button type="button" class="quick-pick" id="auto-nagashi">AI1位を軸・2〜5位を相手</button>
      <button type="button" class="quick-pick" id="clear-all">選択クリア</button>
    `;

    qs('#bet-stake').value = String(state.stake || 100);
    qsa('[data-bet-type]', typeRow).forEach((btn)=>btn.addEventListener('click', ()=>{ state.betType = btn.dataset.betType; renderControls(); renderPickBoard(); renderTickets(); }));
    qsa('[data-bet-mode]', modeRow).forEach((btn)=>btn.addEventListener('click', ()=>{ state.betMode = btn.dataset.betMode; renderControls(); renderPickBoard(); renderTickets(); }));
    qs('#bet-stake')?.addEventListener('input', (e)=>{ const n = Number(String(e.target.value).replace(/[^\d]/g, '')); state.stake = Number.isFinite(n) && n > 0 ? n : 100; renderTickets(); });
    qs('#auto-top3')?.addEventListener('click', ()=>{
      state.main.clear(); state.sub.clear(); state.third.clear();
      horses().slice(0,3).forEach((h)=>state.main.add(horseKey(h)));
      renderPickBoard(); renderTickets();
    });
    qs('#auto-nagashi')?.addEventListener('click', ()=>{
      state.main.clear(); state.sub.clear(); state.third.clear();
      const hs = horses();
      if (hs[0]) state.main.add(horseKey(hs[0]));
      hs.slice(1,5).forEach((h)=>state.sub.add(horseKey(h)));
      hs.slice(1,6).forEach((h)=>state.third.add(horseKey(h)));
      state.betMode = 'nagashi';
      renderControls(); renderPickBoard(); renderTickets();
    });
    qs('#clear-all')?.addEventListener('click', ()=>{ state.main.clear(); state.sub.clear(); state.third.clear(); renderPickBoard(); renderTickets(); });
  }

  function toggle(kind, id) {
    const set = selected(kind);
    if (set.has(id)) set.delete(id); else set.add(id);
    if (kind === 'main') { state.sub.delete(id); if (state.betType !== 'trio') state.third.delete(id); }
    if (kind === 'sub' && state.betType !== 'trio') state.third.delete(id);
    renderPickBoard(); renderTickets();
  }

  function renderPickBoard() {
    const board = qs('#pick-board');
    if (!board) return;
    const showThird = state.betType === 'trio' && state.betMode !== 'box';
    board.innerHTML = horses().map((horse) => {
      const id = horseKey(horse);
      const mainOn = state.main.has(id);
      const subOn = state.sub.has(id);
      const thirdOn = state.third.has(id);
      const danger = recommendations().danger;
      const value = recommendations().value;
      const tags = [];
      if ((state.data.summary?.top_ai || []).slice(0,5).some((h)=>String(h.umaban) === String(horse.umaban))) tags.push('<span class="tag tag--blue">上位</span>');
      if (danger && String(danger.umaban) === String(horse.umaban)) tags.push('<span class="tag tag--minus">危険人気</span>');
      if (value && String(value.umaban) === String(horse.umaban)) tags.push('<span class="tag tag--plus">妙味</span>');
      return `
        <article class="pick-card${mainOn ? ' is-main' : ''}">
          <div class="pick-head">
            <div>
              <div class="pick-name">${escapeHtml(fmt(horse.umaban))} ${escapeHtml(fmt(horse.horse_name))}</div>
              <div class="pick-meta">AI${escapeHtml(fmt(horse.pred_order))} / 単勝${escapeHtml(fmtNum(horse.tansho_odds, 1))} / 人気${escapeHtml(fmt(horse.popularity))}</div>
            </div>
            <div class="tag-list">${tags.join('')}</div>
          </div>
          <div class="metric-row">
            <span class="badge badge--plain">勝率 ${escapeHtml(fmtPct(horse.p_win))}</span>
            <span class="badge badge--plain">複勝率 ${escapeHtml(fmtPct(horse.p_top3))}</span>
            <span class="badge badge--plain">適性 ${escapeHtml(fmt(horse.course_adv_rank || horse.race_rank))}</span>
          </div>
          <div class="pick-actions">
            <button type="button" class="pick-btn${mainOn ? ' is-selected' : ''}" data-kind="main" data-id="${escapeHtml(id)}">主選択</button>
            <button type="button" class="pick-btn${subOn ? ' is-selected' : ''}" data-kind="sub" data-id="${escapeHtml(id)}">相手</button>
            ${showThird ? `<button type="button" class="pick-btn${thirdOn ? ' is-selected' : ''}" data-kind="third" data-id="${escapeHtml(id)}">三列目</button>` : ''}
          </div>
        </article>
      `;
    }).join('');

    qsa('[data-kind]', board).forEach((btn)=>btn.addEventListener('click', ()=>toggle(btn.dataset.kind, btn.dataset.id)));
  }

  function combinations(list, size) {
    const out = [];
    function rec(start, picked) {
      if (picked.length === size) { out.push(picked.slice()); return; }
      for (let i = start; i < list.length; i += 1) { picked.push(list[i]); rec(i + 1, picked); picked.pop(); }
    }
    rec(0, []);
    return out;
  }

  function sortedPair(a,b) { return [a,b].sort((x,y)=>(toNum(x.umaban)??999)-(toNum(y.umaban)??999)); }
  function sortedTriple(a,b,c) { return [a,b,c].sort((x,y)=>(toNum(x.umaban)??999)-(toNum(y.umaban)??999)); }
  function uniqTickets(tickets) {
    const map = new Map();
    tickets.forEach((t)=>map.set(`${t.type}:${t.horses.map((h)=>h.umaban).join('-')}`, t));
    return Array.from(map.values());
  }

  function buildTickets() {
    const main = selectedHorses('main');
    const sub = selectedHorses('sub');
    const third = selectedHorses('third');
    const tickets = [];

    if (state.betType === 'tansho') {
      main.forEach((h)=>tickets.push({ type: '単勝', horses: [h] }));
      return tickets;
    }

    if (state.betType === 'umaren' || state.betType === 'wide') {
      const label = state.betType === 'umaren' ? '馬連' : 'ワイド';
      if (state.betMode === 'box') combinations(main, 2).forEach((pair)=>tickets.push({ type: label, horses: sortedPair(pair[0], pair[1]) }));
      if (state.betMode === 'nagashi') main.forEach((m)=>sub.filter((s)=>horseKey(s)!==horseKey(m)).forEach((s)=>tickets.push({ type: label, horses: sortedPair(m, s) })));
      if (state.betMode === 'formation') {
        main.forEach((m)=>sub.forEach((s)=>{ if (horseKey(m) !== horseKey(s)) tickets.push({ type: label, horses: sortedPair(m, s) }); }));
      }
      return uniqTickets(tickets);
    }

    if (state.betType === 'trio') {
      if (state.betMode === 'box') combinations(main, 3).forEach((tr)=>tickets.push({ type: '三連複', horses: sortedTriple(tr[0], tr[1], tr[2]) }));
      if (state.betMode === 'nagashi') main.forEach((m)=>combinations(sub.filter((s)=>horseKey(s)!==horseKey(m)), 2).forEach((pair)=>tickets.push({ type: '三連複', horses: sortedTriple(m, pair[0], pair[1]) })));
      if (state.betMode === 'formation') {
        main.forEach((a)=>sub.forEach((b)=>third.forEach((c)=>{
          const ids = [horseKey(a), horseKey(b), horseKey(c)];
          if (new Set(ids).size === 3) tickets.push({ type: '三連複', horses: sortedTriple(a,b,c) });
        })));
      }
      return uniqTickets(tickets);
    }

    return tickets;
  }

  function ticketText(tickets) {
    const lines = tickets.map((t)=>`${t.type} ${t.horses.map((h)=>`${fmt(h.umaban)} ${fmt(h.horse_name)}`).join(' - ')}`);
    return lines.join('\n');
  }

  function renderTickets() {
    const tickets = buildTickets();
    const list = qs('#ticket-list');
    const area = qs('#ticket-text');
    const chips = qs('#bet-summary-chips');
    const sticky = qs('#sticky-total');
    if (!list || !area || !chips || !sticky) return;
    const total = tickets.length * (Number(state.stake) || 0);
    chips.innerHTML = `
      <span class="summary-chip badge badge--blue">${escapeHtml(tickets.length)}点</span>
      <span class="summary-chip badge badge--plain">${escapeHtml(fmt(state.stake))}円/点</span>
      <span class="summary-chip badge badge--warn">${escapeHtml(total.toLocaleString('ja-JP'))}円</span>
    `;
    sticky.textContent = `${tickets.length}点 / ${total.toLocaleString('ja-JP')}円`;

    if (!tickets.length) {
      list.innerHTML = '<div class="empty-panel">まだ買い目ができてへん。主選択や相手を押してみてな。</div>';
      area.value = '';
      return;
    }
    list.innerHTML = tickets.map((ticket) => `
      <article class="ticket-card">
        <div class="ticket-card__type">${escapeHtml(ticket.type)}</div>
        <div class="ticket-card__horses">${escapeHtml(ticket.horses.map((h)=>`${fmt(h.umaban)} ${fmt(h.horse_name)}`).join(' - '))}</div>
        <div class="ticket-card__meta">${escapeHtml(fmt(state.stake))}円 / 点</div>
      </article>
    `).join('');
    area.value = ticketText(tickets);
  }

  function bindCopy() {
    qs('#copy-ticket')?.addEventListener('click', async () => {
      const text = qs('#ticket-text')?.value || '';
      if (!text) { setStatus('コピーできる買い目がまだないで。', true); return; }
      try {
        await navigator.clipboard.writeText(text);
        setStatus('買い目をコピーしたで。');
        setTimeout(() => { const el = qs('#betting-status'); if (el) el.hidden = true; }, 1800);
      } catch (err) {
        console.error(err);
        setStatus('コピーに失敗したで。手動でコピーしてな。', true);
      }
    });
  }

  async function init() {
    try {
      renderLayout();
      setStatus('読み込み中...');
      state.data = await fetchJson(getJsonPath());
      renderHero(state.data);
      renderTabs(state.data);
      renderReco();
      renderControls();
      renderPickBoard();
      renderTickets();
      bindCopy();
      qs('#betting-status').hidden = true;
    } catch (err) {
      console.error(err);
      setStatus(err?.message || '表示に失敗したで。', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
