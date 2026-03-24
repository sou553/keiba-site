(function () {
  'use strict';

  const PAGE_DEFAULTS = {
    race: 'race_detail.html',
    past: 'past_detail.html',
    betting: 'betting.html',
  };

  const state = {
    data: null,
    main: new Set(),
    sub: new Set(),
    third: new Set(),
  };

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmt(value, fallback = '—') {
    return value == null || value === '' ? fallback : String(value);
  }

  function toNumber(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
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
    const el = qs('#betting-status');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle('is-error', !!isError);
  }

  function clearStatus() {
    const el = qs('#betting-status');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-error');
  }

  function horseId(horse) {
    return String(horse.horse_id ?? horse.umaban ?? horse.horse_name ?? '');
  }

  function selectedSet(kind) {
    if (kind === 'main') return state.main;
    if (kind === 'sub') return state.sub;
    return state.third;
  }

  function getSelectedHorses(kind) {
    const set = selectedSet(kind);
    return (state.data?.horses || []).filter((horse) => set.has(horseId(horse)));
  }

  function uniqueSortedPair(a, b) {
    return [a, b].sort((x, y) => (x.umaban ?? 999) - (y.umaban ?? 999));
  }

  function uniqueSortedTriple(a, b, c) {
    return [a, b, c].sort((x, y) => (x.umaban ?? 999) - (y.umaban ?? 999));
  }

  function combinations(list, size) {
    const out = [];
    function rec(start, picked) {
      if (picked.length === size) {
        out.push(picked.slice());
        return;
      }
      for (let i = start; i < list.length; i += 1) {
        picked.push(list[i]);
        rec(i + 1, picked);
        picked.pop();
      }
    }
    rec(0, []);
    return out;
  }

  function ticketKey(ticket) {
    return `${ticket.type}:${ticket.horses.map((h) => h.umaban).join('-')}`;
  }

  function dedupeTickets(tickets) {
    const map = new Map();
    tickets.forEach((ticket) => map.set(ticketKey(ticket), ticket));
    return Array.from(map.values());
  }

  function renderLayout() {
    const root = qs('#betting-app');
    if (!root) throw new Error('#betting-app が見つからへん。betting.html に <div id="betting-app"></div> を置いてな。');

    root.innerHTML = `
      <section class="betting-page">
        <div id="betting-status" class="page-status" hidden></div>
        <header id="betting-header" class="betting-page__header"></header>
        <nav id="betting-tabs" class="race-page__tabs"></nav>

        <section class="betting-page__controls" id="betting-controls">
          <div class="control-row">
            <label>券種
              <select id="bet-type">
                <option value="tansho">単勝</option>
                <option value="umaren">馬連</option>
                <option value="wide">ワイド</option>
                <option value="trio">三連複</option>
              </select>
            </label>
            <label>方式
              <select id="bet-mode">
                <option value="box">BOX</option>
                <option value="nagashi">軸流し</option>
                <option value="formation">フォーメーション</option>
              </select>
            </label>
            <label>1点金額 <input type="number" id="bet-stake" min="1" step="100" value="100"></label>
            <button type="button" id="apply-ai-top3">AI上位3頭を主選択</button>
            <button type="button" id="clear-selection">選択クリア</button>
          </div>
          <div class="help-text">
            保存はせえへん。ページ上だけで買い目を作る形やで。
          </div>
        </section>

        <section class="betting-page__picker">
          <div class="picker-column">
            <h3>主選択</h3>
            <div id="picker-main" class="picker-grid"></div>
          </div>
          <div class="picker-column" id="picker-sub-wrap">
            <h3>相手</h3>
            <div id="picker-sub" class="picker-grid"></div>
          </div>
          <div class="picker-column" id="picker-third-wrap">
            <h3>三列目</h3>
            <div id="picker-third" class="picker-grid"></div>
          </div>
        </section>

        <section class="betting-page__result">
          <div id="bet-summary" class="summary-chip-row"></div>
          <div class="ticket-actions">
            <button type="button" id="copy-ticket-text">買い目をコピー</button>
          </div>
          <div id="ticket-list" class="ticket-list"></div>
          <textarea id="ticket-text" rows="10" readonly style="width:100%;"></textarea>
        </section>
      </section>
    `;
  }

  function renderHeader(data) {
    const race = data.race || {};
    const header = qs('#betting-header');
    if (!header) return;
    const titleBits = [race.course, race.race_no != null ? `${race.race_no}R` : null, race.race_name].filter(Boolean);
    const metaBits = [race.course_name, race.distance ? `${race.distance}m` : null, race.surface, race.going, race.headcount ? `${race.headcount}頭` : null].filter(Boolean);

    header.innerHTML = `
      <div class="race-title-sub">${escapeHtml(data.race_date || '')}</div>
      <h1 class="race-title-main">${escapeHtml(titleBits.join(' '))}</h1>
      <div class="race-title-meta">${escapeHtml(metaBits.join(' / ') || '条件情報なし')}</div>
    `;
    document.title = `${titleBits.join(' ')} | 買い目作成`;
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
    nav.innerHTML = items.map((item) => `
      <a class="race-tab${item.active ? ' is-active' : ''}" href="${escapeHtml(buildPageUrl(item.kind, race))}">${escapeHtml(item.label)}</a>
    `).join('');
  }

  function horseChipHtml(horse, kind) {
    const id = horseId(horse);
    const selected = selectedSet(kind).has(id);
    return `
      <button type="button" class="picker-chip${selected ? ' is-selected' : ''}" data-kind="${kind}" data-horse-id="${escapeHtml(id)}">
        <span class="picker-chip__head">${escapeHtml(`${fmt(horse.umaban)} ${fmt(horse.horse_name)}`)}</span>
        <span class="picker-chip__meta">AI${escapeHtml(fmt(horse.pred_order))} / 単勝${escapeHtml(fmtNum(horse.tansho_odds, 1))} / 人気${escapeHtml(fmt(horse.popularity))}</span>
        <span class="picker-chip__meta">勝率${escapeHtml(fmtPct(horse.p_win))} / 複勝率${escapeHtml(fmtPct(horse.p_top3))}</span>
      </button>
    `;
  }

  function renderPickers() {
    const horses = (state.data?.horses || []).slice().sort((a, b) => (a.pred_order ?? 999) - (b.pred_order ?? 999) || (a.umaban ?? 999) - (b.umaban ?? 999));
    ['main', 'sub', 'third'].forEach((kind) => {
      const root = qs(`#picker-${kind}`);
      if (!root) return;
      root.innerHTML = horses.map((horse) => horseChipHtml(horse, kind)).join('');
    });

    qsa('.picker-chip').forEach((button) => {
      button.addEventListener('click', () => {
        const kind = button.dataset.kind;
        const id = button.dataset.horseId;
        if (!kind || !id) return;
        const set = selectedSet(kind);
        if (set.has(id)) {
          set.delete(id);
        } else {
          set.add(id);
        }
        renderPickers();
        renderTickets();
      });
    });
  }

  function selectedMode() {
    return qs('#bet-mode')?.value || 'box';
  }

  function selectedType() {
    return qs('#bet-type')?.value || 'tansho';
  }

  function currentStake() {
    const value = Number(qs('#bet-stake')?.value || 100);
    return Number.isFinite(value) && value > 0 ? value : 100;
  }

  function updatePickerVisibility() {
    const type = selectedType();
    const mode = selectedMode();
    const subWrap = qs('#picker-sub-wrap');
    const thirdWrap = qs('#picker-third-wrap');

    if (subWrap) subWrap.hidden = type === 'tansho';
    if (thirdWrap) thirdWrap.hidden = !(type === 'trio' && mode === 'formation');

    if (type === 'tansho' && mode !== 'box') {
      qs('#bet-mode').value = 'box';
    }
  }

  function buildSingleTickets(main) {
    return main.map((horse) => ({ type: '単勝', horses: [horse] }));
  }

  function buildPairTickets(main, sub, mode, label) {
    const tickets = [];
    if (mode === 'box') {
      combinations(main, 2).forEach((pair) => tickets.push({ type: label, horses: uniqueSortedPair(pair[0], pair[1]) }));
      return tickets;
    }
    if (mode === 'nagashi') {
      main.forEach((axis) => {
        sub.forEach((other) => {
          if (horseId(axis) === horseId(other)) return;
          tickets.push({ type: label, horses: uniqueSortedPair(axis, other) });
        });
      });
      return dedupeTickets(tickets);
    }
    main.forEach((a) => {
      sub.forEach((b) => {
        if (horseId(a) === horseId(b)) return;
        tickets.push({ type: label, horses: uniqueSortedPair(a, b) });
      });
    });
    return dedupeTickets(tickets);
  }

  function buildTrioTickets(main, sub, third, mode) {
    const tickets = [];
    if (mode === 'box') {
      combinations(main, 3).forEach((triple) => tickets.push({ type: '三連複', horses: uniqueSortedTriple(triple[0], triple[1], triple[2]) }));
      return tickets;
    }
    if (mode === 'nagashi') {
      main.forEach((axis) => {
        const others = sub.filter((horse) => horseId(horse) !== horseId(axis));
        combinations(others, 2).forEach((pair) => {
          tickets.push({ type: '三連複', horses: uniqueSortedTriple(axis, pair[0], pair[1]) });
        });
      });
      return dedupeTickets(tickets);
    }
    main.forEach((a) => {
      sub.forEach((b) => {
        third.forEach((c) => {
          const ids = new Set([horseId(a), horseId(b), horseId(c)]);
          if (ids.size !== 3) return;
          tickets.push({ type: '三連複', horses: uniqueSortedTriple(a, b, c) });
        });
      });
    });
    return dedupeTickets(tickets);
  }

  function buildTickets() {
    const type = selectedType();
    const mode = selectedMode();
    const main = getSelectedHorses('main');
    const sub = getSelectedHorses('sub');
    const third = getSelectedHorses('third');

    if (type === 'tansho') return buildSingleTickets(main);
    if (type === 'umaren') return buildPairTickets(main, sub, mode, '馬連');
    if (type === 'wide') return buildPairTickets(main, sub, mode, 'ワイド');
    return buildTrioTickets(main, sub, third, mode);
  }

  function ticketLabel(ticket) {
    return `${ticket.type} ${ticket.horses.map((horse) => `${fmt(horse.umaban)} ${fmt(horse.horse_name)}`).join(' - ')}`;
  }

  function renderTickets() {
    updatePickerVisibility();
    const tickets = buildTickets();
    const stake = currentStake();
    const total = tickets.length * stake;

    const summary = qs('#bet-summary');
    if (summary) {
      summary.innerHTML = `
        <span class="summary-chip">券種 ${escapeHtml(selectedType())}</span>
        <span class="summary-chip">方式 ${escapeHtml(selectedMode())}</span>
        <span class="summary-chip">点数 ${tickets.length}</span>
        <span class="summary-chip">合計 ${total.toLocaleString('ja-JP')}円</span>
      `;
    }

    const list = qs('#ticket-list');
    if (list) {
      list.innerHTML = tickets.length
        ? tickets.map((ticket, idx) => `
            <div class="ticket-card">
              <div class="ticket-card__index">${idx + 1}</div>
              <div class="ticket-card__body">
                <div class="ticket-card__title">${escapeHtml(ticket.type)}</div>
                <div class="ticket-card__horses">${escapeHtml(ticket.horses.map((horse) => `${fmt(horse.umaban)} ${fmt(horse.horse_name)}`).join(' - '))}</div>
                <div class="ticket-card__meta">${stake.toLocaleString('ja-JP')}円</div>
              </div>
            </div>
          `).join('')
        : '<div class="empty-text">条件に合う買い目がまだないで。</div>';
    }

    const text = tickets.length
      ? tickets.map((ticket) => `${ticket.type},${ticket.horses.map((horse) => horse.umaban).join('-')},${stake}`).join('\n')
      : '';
    const textarea = qs('#ticket-text');
    if (textarea) textarea.value = text;
  }

  function bindControls() {
    qs('#bet-type')?.addEventListener('change', () => {
      if (selectedType() === 'tansho') {
        qs('#bet-mode').value = 'box';
      }
      renderTickets();
    });
    qs('#bet-mode')?.addEventListener('change', renderTickets);
    qs('#bet-stake')?.addEventListener('input', renderTickets);

    qs('#apply-ai-top3')?.addEventListener('click', () => {
      state.main.clear();
      state.sub.clear();
      state.third.clear();
      const sorted = (state.data?.horses || []).slice().sort((a, b) => (a.pred_order ?? 999) - (b.pred_order ?? 999));
      sorted.slice(0, 3).forEach((horse) => state.main.add(horseId(horse)));
      sorted.slice(0, 6).forEach((horse) => state.sub.add(horseId(horse)));
      sorted.slice(0, 8).forEach((horse) => state.third.add(horseId(horse)));
      renderPickers();
      renderTickets();
    });

    qs('#clear-selection')?.addEventListener('click', () => {
      state.main.clear();
      state.sub.clear();
      state.third.clear();
      renderPickers();
      renderTickets();
    });

    qs('#copy-ticket-text')?.addEventListener('click', async () => {
      const text = qs('#ticket-text')?.value || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setStatus('買い目をコピーしたで。');
        setTimeout(clearStatus, 1200);
      } catch (error) {
        console.error(error);
        setStatus('コピーに失敗したで', true);
      }
    });
  }

  async function init() {
    try {
      renderLayout();
      setStatus('読み込み中...');
      const data = await fetchJson(getJsonPath());
      state.data = data;
      clearStatus();
      renderHeader(data);
      renderTabs(data);
      renderPickers();
      bindControls();
      renderTickets();
    } catch (error) {
      console.error(error);
      try {
        renderLayout();
      } catch (_) {
        // noop
      }
      setStatus(error.message || '表示に失敗したで', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
