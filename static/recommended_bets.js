(() => {
  'use strict';

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const app = qs('#recommended-bets-app');
  const statusEl = qs('#recommend-status');

  const state = {
    data: null,
    index: null,
    date: null,
    filters: {
      course: 'all',
      betType: 'all',
      strategy: 'all',
      keyword: '',
    },
  };

  function getBodyData(name, fallback) {
    return document.body?.dataset?.[name] || fallback;
  }

  function normalizeDateParam(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (/^\d{8}$/.test(text)) return text;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replaceAll('-', '');
    return text;
  }

  function displayDate(ymdOrIso) {
    if (!ymdOrIso) return '';
    const text = String(ymdOrIso);
    if (/^\d{8}$/.test(text)) {
      return `${text.slice(0, 4)}/${text.slice(4, 6)}/${text.slice(6, 8)}`;
    }
    return text.replaceAll('-', '/');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function fmt(value, fallback = '-') {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value);
  }

  function fmtYen(value) {
    const n = Number(value || 0);
    return `${n.toLocaleString('ja-JP')}円`;
  }

  function pct(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return `${(n * 100).toFixed(1)}%`;
  }

  function dataRoot() {
    return (getBodyData('dataRoot', './data') || './data').replace(/\/$/, '');
  }

  function buildRaceUrl(race) {
    const racePage = getBodyData('racePage', 'race_detail.html');
    const ymd = normalizeDateParam(race.date || state.data?.date_ymd || state.date);
    return `${racePage}?date=${encodeURIComponent(ymd || '')}&race_id=${encodeURIComponent(race.race_id)}`;
  }

  function buildBettingUrl(race) {
    const bettingPage = getBodyData('bettingPage', 'betting.html');
    const ymd = normalizeDateParam(race.date || state.data?.date_ymd || state.date);
    return `${bettingPage}?date=${encodeURIComponent(ymd || '')}&race_id=${encodeURIComponent(race.race_id)}`;
  }

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('is-error', !!isError);
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`${path} を読み込めませんでした (${res.status})`);
    }
    return res.json();
  }

  async function loadIndex() {
    try {
      const index = await fetchJson(`${dataRoot()}/index.json`);
      state.index = index;
      return index;
    } catch (_) {
      state.index = null;
      return null;
    }
  }

  function pickInitialDate(index) {
    const params = new URLSearchParams(location.search);
    const explicit = normalizeDateParam(params.get('date') || params.get('race_date'));
    if (explicit) return explicit;

    const dates = Array.isArray(index?.dates) ? index.dates : [];
    if (dates.length) {
      const first = dates[0];
      return normalizeDateParam(first.race_date || first.date || first);
    }

    return '20260425';
  }

  async function loadRecommendedBets(dateYmd) {
    const path = `${dataRoot()}/${dateYmd}/recommended_bets.json`;
    return fetchJson(path);
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'ja'));
  }

  function getFilteredRaces() {
    const races = state.data?.races || [];
    const keyword = state.filters.keyword.trim().toLowerCase();

    return races.map((race) => {
      const tickets = (race.tickets || []).filter((ticket) => {
        if (state.filters.betType !== 'all' && ticket.bet_type !== state.filters.betType) return false;
        if (state.filters.strategy !== 'all') {
          const group = ticket.strategy_group || '通常';
          if (group !== state.filters.strategy) return false;
        }
        return true;
      });

      return { ...race, tickets };
    }).filter((race) => {
      if (!race.tickets.length) return false;
      if (state.filters.course !== 'all' && race.course !== state.filters.course) return false;

      if (keyword) {
        const text = [
          race.race_id,
          race.course,
          race.race_no,
          race.title,
          race.surface,
          race.distance_m,
          ...(race.tickets || []).flatMap((ticket) => [
            ticket.bet_type,
            ticket.numbers,
            ticket.strategy_group,
            ticket.strategy_name,
            ticket.reason,
            ticket.A1_name,
          ]),
        ].filter(Boolean).join(' ').toLowerCase();

        if (!text.includes(keyword)) return false;
      }

      return true;
    });
  }

  function renderDateStrip() {
    const dates = Array.isArray(state.index?.dates) ? state.index.dates : [];
    if (!dates.length) return '';

    return `
      <section class="recommend-date-strip" aria-label="開催日">
        ${dates.map((item) => {
          const ymd = normalizeDateParam(item.race_date || item.date || item);
          const count = item.race_count ?? item.count ?? '';
          const active = ymd === state.date ? 'is-active' : '';
          return `
            <a class="recommend-date-pill ${active}" href="./recommended_bets.html?date=${escapeHtml(ymd)}">
              <span>${escapeHtml(displayDate(ymd))}</span>
              ${count !== '' ? `<small>${escapeHtml(count)}R</small>` : ''}
            </a>
          `;
        }).join('')}
      </section>
    `;
  }

  function renderSummary() {
    const summary = state.data?.summary || {};
    const byBet = summary.by_bet_type || {};
    const byCourse = summary.by_course || {};
    const byGroup = summary.by_strategy_group || {};

    return `
      <section class="recommend-summary">
        <div class="recommend-summary__head">
          <div>
            <div class="recommend-kicker">SUMMARY</div>
            <h2>${escapeHtml(displayDate(state.data?.date_ymd || state.date))} 推奨買い目</h2>
          </div>
          <button class="recommend-copy-all" type="button" data-copy-all>全買い目コピー</button>
        </div>

        <div class="recommend-summary-grid">
          <div class="recommend-summary-card">
            <span>対象レース</span>
            <strong>${escapeHtml(summary.race_count ?? 0)}</strong>
          </div>
          <div class="recommend-summary-card">
            <span>買い目数</span>
            <strong>${escapeHtml(summary.ticket_count ?? 0)}</strong>
          </div>
          <div class="recommend-summary-card">
            <span>合計金額</span>
            <strong>${escapeHtml(fmtYen(summary.total_stake_yen ?? 0))}</strong>
          </div>
          <div class="recommend-summary-card">
            <span>生成時刻</span>
            <strong>${escapeHtml(fmt(state.data?.generated_at))}</strong>
          </div>
        </div>

        <div class="recommend-breakdown">
          ${renderMiniBreakdown('券種', byBet)}
          ${renderMiniBreakdown('会場', byCourse)}
          ${renderMiniBreakdown('戦略', byGroup)}
        </div>
      </section>
    `;
  }

  function renderMiniBreakdown(title, values) {
    const entries = Object.entries(values || {});
    if (!entries.length) return '';
    return `
      <div class="recommend-mini">
        <div class="recommend-mini__title">${escapeHtml(title)}</div>
        <div class="recommend-chip-list">
          ${entries.map(([key, value]) => `
            <span class="recommend-chip">${escapeHtml(key)} <b>${escapeHtml(value)}</b></span>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderToolbar() {
    const races = state.data?.races || [];
    const courses = uniqueSorted(races.map((race) => race.course));
    const betTypes = uniqueSorted(races.flatMap((race) => (race.tickets || []).map((ticket) => ticket.bet_type)));
    const groups = uniqueSorted(races.flatMap((race) => (race.tickets || []).map((ticket) => ticket.strategy_group || '通常')));

    return `
      <section class="recommend-toolbar">
        <div class="recommend-field">
          <label>検索</label>
          <input type="search" data-filter-keyword placeholder="race_id / 買い目 / 理由" value="${escapeHtml(state.filters.keyword)}">
        </div>

        <div class="recommend-field">
          <label>会場</label>
          <select data-filter-course>
            <option value="all">すべて</option>
            ${courses.map((course) => `<option value="${escapeHtml(course)}" ${state.filters.course === course ? 'selected' : ''}>${escapeHtml(course)}</option>`).join('')}
          </select>
        </div>

        <div class="recommend-field">
          <label>券種</label>
          <select data-filter-bet-type>
            <option value="all">すべて</option>
            ${betTypes.map((type) => `<option value="${escapeHtml(type)}" ${state.filters.betType === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}
          </select>
        </div>

        <div class="recommend-field">
          <label>戦略</label>
          <select data-filter-strategy>
            <option value="all">すべて</option>
            ${groups.map((group) => `<option value="${escapeHtml(group)}" ${state.filters.strategy === group ? 'selected' : ''}>${escapeHtml(group)}</option>`).join('')}
          </select>
        </div>
      </section>
    `;
  }

  function renderRaceList() {
    const races = getFilteredRaces();

    if (!races.length) {
      return `<section class="recommend-empty">条件に合う推奨買い目がありません。</section>`;
    }

    return `
      <section class="recommend-races">
        ${races.map(renderRaceCard).join('')}
      </section>
    `;
  }

  function renderRaceCard(race) {
    const raceTitle = race.title || `${race.course || ''} ${race.race_no || ''}R`;
    const condition = [
      race.course,
      race.surface && race.distance_m ? `${race.surface}${race.distance_m}m` : null,
      race.track_condition,
      race.field_size ? `${race.field_size}頭` : null,
      race.start_time ? `${race.start_time}発走` : null,
    ].filter(Boolean).join(' / ');

    const grouped = groupTicketsByBetType(race.tickets || []);

    return `
      <article class="recommend-race-card">
        <header class="recommend-race-head">
          <div>
            <div class="recommend-race-title">
              <span class="recommend-race-no">${escapeHtml(race.race_no ? `${race.race_no}R` : '')}</span>
              <strong>${escapeHtml(raceTitle)}</strong>
            </div>
            <div class="recommend-race-meta">${escapeHtml(condition || race.race_id)}</div>
            <div class="recommend-race-id">${escapeHtml(race.race_id)}</div>
          </div>
          <div class="recommend-race-total">
            <span>${escapeHtml(race.tickets.length)}点</span>
            <strong>${escapeHtml(fmtYen(sumStake(race.tickets)))}</strong>
          </div>
        </header>

        <div class="recommend-ticket-groups">
          ${Object.entries(grouped).map(([betType, tickets]) => renderTicketGroup(betType, tickets)).join('')}
        </div>

        <footer class="recommend-race-actions">
          <a href="${escapeHtml(buildRaceUrl(race))}">出走馬一覧</a>
          <a href="${escapeHtml(buildBettingUrl(race))}">買い目作成</a>
          <button type="button" data-copy-race="${escapeHtml(race.race_id)}">このレースをコピー</button>
        </footer>
      </article>
    `;
  }

  function groupTicketsByBetType(tickets) {
    const grouped = {};
    tickets.forEach((ticket) => {
      const key = ticket.bet_type || '不明';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(ticket);
    });
    return grouped;
  }

  function sumStake(tickets) {
    return (tickets || []).reduce((sum, ticket) => sum + Number(ticket.stake_yen || 0), 0);
  }

  function renderTicketGroup(betType, tickets) {
    return `
      <section class="recommend-ticket-group">
        <div class="recommend-ticket-group__head">
          <span class="recommend-bet-badge">${escapeHtml(betType)}</span>
          <span>${escapeHtml(tickets.length)}点 / ${escapeHtml(fmtYen(sumStake(tickets)))}</span>
        </div>
        <div class="recommend-ticket-list">
          ${tickets.map(renderTicketRow).join('')}
        </div>
      </section>
    `;
  }

  function renderTicketRow(ticket) {
    const sub = buildTicketSubText(ticket);
    const reason = ticket.reason ? `<div class="recommend-ticket-reason">${escapeHtml(ticket.reason)}</div>` : '';

    return `
      <div class="recommend-ticket-row">
        <div class="recommend-ticket-main">
          <div class="recommend-ticket-numbers">${escapeHtml(ticket.numbers)}</div>
          <div class="recommend-ticket-sub">${escapeHtml(sub)}</div>
          ${reason}
        </div>
        <div class="recommend-ticket-stake">${escapeHtml(fmtYen(ticket.stake_yen || 0))}</div>
      </div>
    `;
  }

  function buildTicketSubText(ticket) {
    const parts = [];

    if (ticket.strategy_group) parts.push(ticket.strategy_group);
    if (ticket.strategy_name) parts.push(ticket.strategy_name);

    const probs = [];
    const pUmaren = pct(ticket.p_umaren);
    const a1Prob = pct(ticket.A1_prob);
    const partnerProb = pct(ticket.B_partner_prob);
    const top1Top3 = pct(ticket.top1_p_top3);

    if (pUmaren) probs.push(`馬連P ${pUmaren}`);
    if (a1Prob) probs.push(`軸P ${a1Prob}`);
    if (partnerProb) probs.push(`相手P ${partnerProb}`);
    if (top1Top3) probs.push(`軸複 ${top1Top3}`);

    if (ticket.top1_umaban) parts.push(`軸 ${ticket.top1_umaban}`);
    if (ticket.longshot_umaban) parts.push(`穴 ${ticket.longshot_umaban}`);

    if (probs.length) parts.push(probs.join(' / '));

    const sources = Array.isArray(ticket.source_files) ? ticket.source_files.join(', ') : '';
    if (sources) parts.push(`src: ${sources}`);

    return parts.length ? parts.join(' / ') : '通常';
  }

  function buildCopyTextForRace(race) {
    const title = race.title || `${race.course || ''}${race.race_no || ''}R`;
    const lines = [`${race.course || ''} ${race.race_no || ''}R ${title}`.trim()];
    const grouped = groupTicketsByBetType(race.tickets || []);

    Object.entries(grouped).forEach(([betType, tickets]) => {
      lines.push(`【${betType}】`);
      tickets.forEach((ticket) => {
        lines.push(`${ticket.numbers} ${ticket.stake_yen || 0}円`);
      });
    });

    return lines.join('\n');
  }

  function buildCopyTextAll() {
    return getFilteredRaces().map(buildCopyTextForRace).join('\n\n');
  }

  async function copyText(text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus('コピーしました。');
      setTimeout(() => setStatus(''), 1600);
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      setStatus('コピーしました。');
      setTimeout(() => setStatus(''), 1600);
    }
  }

  function bindEvents() {
    qs('[data-filter-keyword]')?.addEventListener('input', (event) => {
      state.filters.keyword = event.target.value || '';
      render();
    });

    qs('[data-filter-course]')?.addEventListener('change', (event) => {
      state.filters.course = event.target.value;
      render();
    });

    qs('[data-filter-bet-type]')?.addEventListener('change', (event) => {
      state.filters.betType = event.target.value;
      render();
    });

    qs('[data-filter-strategy]')?.addEventListener('change', (event) => {
      state.filters.strategy = event.target.value;
      render();
    });

    qs('[data-copy-all]')?.addEventListener('click', () => {
      copyText(buildCopyTextAll());
    });

    qsa('[data-copy-race]').forEach((button) => {
      button.addEventListener('click', () => {
        const raceId = button.dataset.copyRace;
        const race = getFilteredRaces().find((item) => item.race_id === raceId);
        if (race) copyText(buildCopyTextForRace(race));
      });
    });
  }

  function render() {
    if (!state.data) return;

    app.innerHTML = `
      <header class="recommend-hero">
        <div>
          <div class="recommend-kicker">BUYLIST</div>
          <h1>推奨買い目一覧</h1>
          <p>CSVから出力した、その日の買い目をレース別・券種別に確認できます。</p>
        </div>
        <nav class="recommend-hero__nav">
          <a class="recommend-nav-link" href="./index.html">トップ</a>
        </nav>
      </header>

      ${renderDateStrip()}
      ${renderSummary()}
      ${renderToolbar()}
      ${renderRaceList()}

      <section id="recommend-status" class="recommend-status" hidden></section>
    `;

    bindEvents();
  }

  async function init() {
    try {
      setStatus('推奨買い目を読み込み中...');
      const index = await loadIndex();
      state.date = pickInitialDate(index);
      state.data = await loadRecommendedBets(state.date);
      if (state.data?.date_ymd) state.date = state.data.date_ymd;
      render();
    } catch (error) {
      console.error(error);
      if (app) {
        app.innerHTML = `
          <header class="recommend-hero">
            <div>
              <div class="recommend-kicker">BUYLIST</div>
              <h1>推奨買い目一覧</h1>
              <p>CSVから出力した、その日の買い目をレース別・券種別に確認できます。</p>
            </div>
            <nav class="recommend-hero__nav">
              <a class="recommend-nav-link" href="./index.html">トップ</a>
            </nav>
          </header>
          <section id="recommend-status" class="recommend-status is-error">
            ${escapeHtml(error.message || error)}
          </section>
        `;
      }
    }
  }

  init();
})();
