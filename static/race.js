(function () {
  'use strict';

  const PAGE_DEFAULTS = {
    race: 'race_detail.html',
    past: 'past_detail.html',
    betting: 'betting.html',
  };

  const state = {
    data: null,
    horses: [],
    filtered: [],
    sortKey: 'pred_order',
    sortDir: 'asc',
    keyword: '',
    oddsOnly: false,
  };

  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const toNum = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const fmt = (v, fb = '—') => (v === null || v === undefined || v === '' ? fb : String(v));
  const fmtNum = (v, d = 1, fb = '—') => {
    const n = toNum(v);
    return n === null ? fb : n.toFixed(d).replace(/\.0$/, '');
  };
  const fmtPct = (v, d = 1, fb = '—') => {
    const n = toNum(v);
    return n === null ? fb : `${(n * 100).toFixed(d)}%`.replace(/\.0%$/, '%');
  };

  function getDataRoot() {
    return document.body?.dataset?.dataRoot || './data';
  }

  function getPage(kind) {
    return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind];
  }

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
    const params = new URLSearchParams({ date: race.race_date, race_id: race.race_id });
    return `${getPage(kind)}?${params.toString()}`;
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`JSON取得失敗: ${res.status} ${path}`);
    return res.json();
  }

  function setStatus(msg, isError = false) {
    const el = qs('#race-status');
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle('is-error', !!isError);
  }

  function clearStatus() {
    const el = qs('#race-status');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-error');
  }

  function splitTags(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    return String(value)
      .split(/[\n、,\/|;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function getModelRank(horse, year) {
    return toNum(horse?.model_scores?.[year]?.rank);
  }

  function computeModelAgreement(horse, sortedHorses) {
    const years = ['2008', '2015', '2019'];
    let top1Count = 0;
    let top3Count = 0;

    years.forEach((year) => {
      const ranked = sortedHorses
        .map((h) => ({ horse: h, rank: getModelRank(h, year) }))
        .filter((x) => x.rank !== null)
        .sort((a, b) => a.rank - b.rank);

      if (!ranked.length) return;
      if (ranked[0].horse === horse) top1Count += 1;
      if (ranked.slice(0, 3).some((x) => x.horse === horse)) top3Count += 1;
    });

    return { top1Count, top3Count, total: years.length };
  }

  function aiPopGap(horse) {
    const pop = toNum(horse.popularity);
    const ai = toNum(horse.pred_order);
    if (pop === null || ai === null) return null;
    return pop - ai;
  }

  function fitPopGap(horse) {
    const pop = toNum(horse.popularity);
    const fit = toNum(horse.course_adv_rank);
    if (pop === null || fit === null) return null;
    return pop - fit;
  }

  function divergenceAbs(horse) {
    const a = aiPopGap(horse);
    const b = fitPopGap(horse);
    return Math.max(Math.abs(a || 0), Math.abs(b || 0));
  }

  function isDangerPopular(horse) {
    const pop = toNum(horse.popularity);
    const ai = toNum(horse.pred_order);
    const fit = toNum(horse.course_adv_rank);
    if (pop === null) return false;
    return pop <= 5 && ((ai !== null && ai - pop >= 3) || (fit !== null && fit - pop >= 4));
  }

  function isValueHorse(horse) {
    const pop = toNum(horse.popularity);
    const ai = toNum(horse.pred_order);
    const fit = toNum(horse.course_adv_rank);
    if (pop === null) return false;
    return pop >= 6 && ((ai !== null && pop - ai >= 3) || (fit !== null && pop - fit >= 4));
  }

  function stateLabel(honmei, second, sortedHorses) {
    const p1 = toNum(honmei?.p_win);
    const p2 = toNum(second?.p_win);
    const agreement = honmei ? computeModelAgreement(honmei, sortedHorses) : { top1Count: 0, total: 3 };
    if (p1 !== null && p2 !== null && p1 - p2 <= 0.035) return ['混戦', 'badge--warn'];
    if (p1 !== null && p1 >= 0.42 && agreement.top1Count >= 2) return ['本命寄り', 'badge--blue'];
    if (p1 !== null && p1 < 0.24) return ['見送り', 'badge--red'];
    return ['標準', 'badge--plain'];
  }

  function popularEval(horse) {
    const pop = toNum(horse.popularity);
    const ai = toNum(horse.pred_order);
    const fit = toNum(horse.course_adv_rank);
    if (pop === null) return '—';
    if ((ai !== null && ai - pop >= 4) || (fit !== null && fit - pop >= 5)) return '危険';
    if ((ai !== null && pop - ai >= 3) || (fit !== null && pop - fit >= 4)) return '信頼';
    if ((ai !== null && ai - pop >= 2) || (fit !== null && fit - pop >= 3)) return 'やや危険';
    return '妥当';
  }

  function normalizedHorses(data) {
    return (Array.isArray(data.horses) ? data.horses : []).map((horse) => ({
      ...horse,
      reasons_pos_list: splitTags(horse.reasons_pos || horse.reasons_pos_list).slice(0, 6),
      reasons_neg_list: splitTags(horse.reasons_neg || horse.reasons_neg_list).slice(0, 5),
      past_runs: (Array.isArray(horse.past_runs) ? horse.past_runs : []).filter((run) => {
        return run && Object.keys(run).some((k) => k !== 'n' && run[k] !== null && run[k] !== '');
      }),
    }));
  }

  function getSortedByAi(horses) {
    return horses.slice().sort((a, b) => {
      const ar = toNum(a.pred_order);
      const br = toNum(b.pred_order);
      if (ar !== null && br !== null && ar !== br) return ar - br;
      const ap = toNum(a.p_top3);
      const bp = toNum(b.p_top3);
      if (ap !== null && bp !== null && ap !== bp) return bp - ap;
      return String(a.horse_name || '').localeCompare(String(b.horse_name || ''), 'ja');
    });
  }

  function buildSummary(horses, race) {
    const sorted = getSortedByAi(horses);
    const honmei = sorted[0] || null;
    const second = sorted[1] || null;
    const third = sorted[2] || null;
    const fourth = sorted[3] || null;
    const valueHorses = horses.filter(isValueHorse).sort((a, b) => divergenceAbs(b) - divergenceAbs(a)).slice(0, 2);
    const dangerHorses = horses.filter(isDangerPopular).sort((a, b) => divergenceAbs(b) - divergenceAbs(a)).slice(0, 2);
    const popularTop = horses.slice().filter((h) => toNum(h.popularity) !== null).sort((a, b) => toNum(a.popularity) - toNum(b.popularity)).slice(0, 5);
    const agreement = honmei ? computeModelAgreement(honmei, sorted) : { top1Count: 0, total: 3 };
    const [stateText, stateClass] = stateLabel(honmei, second, sorted);

    const reasons = [];
    if (honmei) {
      const p1 = toNum(honmei.p_win);
      const p2 = toNum(second?.p_win);
      if (p1 !== null && p2 !== null) {
        if (p1 - p2 <= 0.035) reasons.push('1位と2位の勝率差が小さい');
        else if (p1 - p2 >= 0.10) reasons.push('本命の勝率優位がはっきり');
      }
      if (agreement.top1Count >= 2) reasons.push('複数モデルが本命を支持');
      else reasons.push('モデルの評価が割れ気味');
    }
    if (dangerHorses.length) reasons.push(`危険人気候補あり: ${dangerHorses.map((h) => `${fmt(h.umaban)} ${fmt(h.horse_name)}`).join(' / ')}`);

    let comment = '上位評価から素直に組みたいレース。';
    if (stateText === '混戦') comment = '上位拮抗。人気と適性のズレを見て相手を絞りたい。';
    if (stateText === '見送り') comment = '本命の信頼が弱く、無理に触らん方がええ。';
    if (dangerHorses.length && valueHorses.length) comment = `人気先行は ${dangerHorses[0].horse_name}。妙味なら ${valueHorses[0].horse_name}。`;

    return {
      sorted,
      honmei,
      second,
      third,
      fourth,
      valueHorses,
      dangerHorses,
      popularTop,
      agreement,
      stateText,
      stateClass,
      reasons,
      comment,
      headcount: toNum(race.headcount) || horses.length,
    };
  }

  function baseLayout() {
    const root = qs('#race-app');
    if (!root) throw new Error('#race-app が見つからへん。race_detail.html に <div id="race-app"></div> を置いてな。');
    root.innerHTML = `
      <div class="race-detail-page">
        <div id="race-status" class="page-status" hidden></div>
        <section id="race-hero" class="race-hero card"></section>
        <section id="summary-panel" class="summary-panel card"></section>
        <section id="divergence-panel" class="divergence-panel card"></section>
        <section id="skip-panel" class="skip-panel card"></section>
        <section id="filter-toolbar" class="filter-toolbar card"></section>
        <section class="horse-list-panel card">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">出馬表</h2>
              <div class="section-subtitle">スマホではカード表示。タップで詳細を展開。</div>
            </div>
            <div id="horse-list-meta" class="section-subtitle"></div>
          </div>
          <div id="horse-list" class="horse-list"></div>
        </section>
        <div class="foot-note">必要項目: <code>pred_order</code> / <code>p_win</code> / <code>p_top3</code> / <code>popularity</code> / <code>tansho_odds</code> / <code>course_adv_rank</code> / <code>model_scores</code>。</div>
      </div>
    `;
  }

  function renderHero(data, summary) {
    const race = data.race || {};
    const el = qs('#race-hero');
    if (!el) return;
    const meta = [race.surface, race.distance ? `${race.distance}m` : null, race.going, race.headcount ? `${race.headcount}頭` : null, race.weather].filter(Boolean).join(' / ');
    el.innerHTML = `
      <div class="race-hero__head">
        <div>
          <div class="race-hero__date">${esc(data.race_date || '')}</div>
          <h1 class="race-hero__title">${esc([fmt(race.course, ''), race.race_no != null ? `${race.race_no}R` : '', fmt(race.race_name, '')].filter(Boolean).join(' '))}</h1>
          <div class="race-hero__meta">${esc(meta || '条件情報なし')}</div>
          <div class="race-hero__note">${esc(summary.comment)}</div>
        </div>
        <div class="tag-list">
          <span class="badge ${esc(summary.stateClass)}">${esc(summary.stateText)}</span>
          <span class="badge badge--plain">頭数 ${esc(fmt(summary.headcount))}</span>
          <span class="badge badge--plain">単勝 ${data.summary?.odds_available ? 'あり' : 'なし'}</span>
        </div>
      </div>
      <nav class="page-tab-strip">
        <a class="race-tab is-active" href="${esc(buildPageUrl('race', { race_date: data.race_date, race_id: race.race_id }))}">出走馬一覧</a>
        <a class="race-tab" href="${esc(buildPageUrl('past', { race_date: data.race_date, race_id: race.race_id }))}">過去走比較</a>
        <a class="race-tab" href="${esc(buildPageUrl('betting', { race_date: data.race_date, race_id: race.race_id }))}">買い目作成</a>
      </nav>
    `;
    document.title = `${fmt(race.course, '')} ${fmt(race.race_no, '')}R ${fmt(race.race_name, '')} | 出走馬一覧`;
  }

  function pickLine(mark, horse) {
    if (!horse) return '<div class="note-text">該当なし</div>';
    return `
      <div class="pick-line">
        <span class="pick-line__mark">${esc(mark)}</span>
        <div>
          <div class="pick-line__name">${esc(`${fmt(horse.umaban)} ${fmt(horse.horse_name)}`)}</div>
          <div class="pick-line__meta">勝率 ${esc(fmtPct(horse.p_win))} / 複勝率 ${esc(fmtPct(horse.p_top3))} / 単勝 ${esc(fmtNum(horse.tansho_odds))} / 人気 ${esc(fmt(horse.popularity))}</div>
        </div>
      </div>
    `;
  }

  function renderSummaryPanel(summary) {
    const el = qs('#summary-panel');
    if (!el) return;
    const evalHtml = summary.popularTop.map((horse) => {
      const ev = popularEval(horse);
      const cls = ev.includes('危険') ? 'badge--red' : ev === '信頼' ? 'badge--green' : 'badge--plain';
      return `
        <div class="popular-eval-item">
          <div>
            <div class="popular-eval-item__name">${esc(`${fmt(horse.popularity)}人気 ${fmt(horse.umaban)} ${fmt(horse.horse_name)}`)}</div>
            <div class="popular-eval-item__sub">AI ${esc(fmt(horse.pred_order))} / 適性 ${esc(fmt(horse.course_adv_rank))} / 単勝 ${esc(fmtNum(horse.tansho_odds))}</div>
          </div>
          <span class="badge ${cls}">${esc(ev)}</span>
        </div>
      `;
    }).join('') || '<div class="note-text">人気情報なし</div>';

    el.innerHTML = `
      <div class="summary-grid">
        <div class="summary-main">
          <div class="summary-header">
            <div>
              <h2 class="summary-title">予想まとめ</h2>
              <div class="summary-lead">最初にここだけ見ればええ形に整理。</div>
            </div>
            <span class="badge ${esc(summary.stateClass)}">${esc(summary.stateText)}</span>
          </div>

          <section class="summary-honmei">
            <div class="tag-list"><span class="summary-honmei__mark">◎</span></div>
            <div class="summary-honmei__name">${esc(summary.honmei ? `${fmt(summary.honmei.umaban)} ${fmt(summary.honmei.horse_name)}` : '本命候補なし')}</div>
            <div class="metric-row">
              <span class="badge badge--blue">勝率 ${esc(fmtPct(summary.honmei?.p_win))}</span>
              <span class="badge badge--blue">複勝率 ${esc(fmtPct(summary.honmei?.p_top3))}</span>
              <span class="badge badge--plain">単勝 ${esc(fmtNum(summary.honmei?.tansho_odds))}</span>
              <span class="badge badge--plain">人気 ${esc(fmt(summary.honmei?.popularity))}</span>
            </div>
            <div class="note-text">${esc(summary.comment)}</div>
          </section>

          <div class="summary-picks">
            <section class="pick-box">
              <div class="pick-box__label">相手本線</div>
              <div class="pick-box__items">
                ${pickLine('○', summary.second)}
                ${pickLine('▲', summary.third)}
              </div>
            </section>
            <section class="pick-box">
              <div class="pick-box__label">穴候補 / 危険人気</div>
              <div class="pick-box__items">
                ${pickLine('☆', summary.valueHorses[0] || summary.fourth)}
                ${pickLine('消', summary.dangerHorses[0])}
              </div>
            </section>
          </div>
        </div>

        <aside class="summary-side">
          <section class="pick-box">
            <div class="pick-box__label">人気馬まとめ</div>
            <div class="popular-eval-list">${evalHtml}</div>
          </section>
          <section class="pick-box">
            <div class="pick-box__label">見送り・判断材料</div>
            <div class="reason-list">
              ${summary.reasons.map((reason) => `
                <div class="reason-item">
                  <div>
                    <div class="reason-item__text">${esc(reason)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </section>
        </aside>
      </div>
    `;
  }

  function divergenceLine(horse, label, delta, tone) {
    const cls = tone === 'positive' ? 'badge--green' : 'badge--red';
    return `
      <div class="divergence-line">
        <div>
          <div class="divergence-line__name">${esc(`${fmt(horse.umaban)} ${fmt(horse.horse_name)}`)}</div>
          <div class="divergence-line__sub">${esc(label)}</div>
        </div>
        <span class="badge ${cls} delta-chip">${delta > 0 ? '+' : ''}${esc(fmt(delta))}</span>
      </div>
    `;
  }

  function renderDivergencePanel(horses) {
    const el = qs('#divergence-panel');
    if (!el) return;

    const aiPlus = horses.filter((h) => aiPopGap(h) !== null && aiPopGap(h) >= 3).sort((a, b) => aiPopGap(b) - aiPopGap(a)).slice(0, 3);
    const aiMinus = horses.filter((h) => aiPopGap(h) !== null && aiPopGap(h) <= -2).sort((a, b) => aiPopGap(a) - aiPopGap(b)).slice(0, 3);
    const fitPlus = horses.filter((h) => fitPopGap(h) !== null && fitPopGap(h) >= 4).sort((a, b) => fitPopGap(b) - fitPopGap(a)).slice(0, 3);
    const fitMinus = horses.filter((h) => fitPopGap(h) !== null && fitPopGap(h) <= -3).sort((a, b) => fitPopGap(a) - fitPopGap(b)).slice(0, 3);

    const block = (title, plusList, minusList, type) => `
      <section class="divergence-box">
        <h3 class="divergence-box__title">${esc(title)}</h3>
        <div class="divergence-box__group">
          ${plusList.length ? plusList.map((horse) => divergenceLine(horse, `人気 ${fmt(horse.popularity)} / ${type} ${type === 'AI順位' ? fmt(horse.pred_order) : fmt(horse.course_adv_rank)}`, type === 'AI順位' ? aiPopGap(horse) : fitPopGap(horse), 'positive')).join('') : '<div class="note-text">妙味候補なし</div>'}
        </div>
        <div class="divergence-box__group">
          ${minusList.length ? minusList.map((horse) => divergenceLine(horse, `人気 ${fmt(horse.popularity)} / ${type} ${type === 'AI順位' ? fmt(horse.pred_order) : fmt(horse.course_adv_rank)}`, type === 'AI順位' ? aiPopGap(horse) : fitPopGap(horse), 'negative')).join('') : '<div class="note-text">危険人気候補なし</div>'}
        </div>
      </section>
    `;

    el.innerHTML = `
      <div class="section-title-row">
        <div>
          <h2 class="section-title">人気馬の乖離</h2>
          <div class="section-subtitle">人気とAI、人気と適性順位のズレを分けて表示。</div>
        </div>
      </div>
      <div class="divergence-grid">
        ${block('人気とAI順位の乖離', aiPlus, aiMinus, 'AI順位')}
        ${block('人気と適性順位の乖離', fitPlus, fitMinus, '適性順位')}
      </div>
    `;
  }

  function renderSkipPanel(summary) {
    const el = qs('#skip-panel');
    if (!el) return;
    const skipLike = summary.stateText === '見送り' || summary.stateText === '混戦';
    el.classList.toggle('is-safe', !skipLike);
    const title = skipLike ? '見送り判定' : '推奨寄り';
    const badgeText = skipLike ? '見送り' : '触れる';
    const badgeClass = skipLike ? 'badge--red' : 'badge--green';
    const items = skipLike
      ? summary.reasons.slice(0, 3)
      : [
          '本命の勝率と複数モデル支持がある',
          '人気とAIのズレを相手選びに使いやすい',
          summary.dangerHorses.length ? `危険人気は ${summary.dangerHorses.map((h) => h.horse_name).join(' / ')}` : '大きな危険人気は少なめ',
        ];

    el.innerHTML = `
      <div class="skip-panel__head">
        <h2 class="skip-panel__title">${esc(title)}</h2>
        <span class="badge ${badgeClass}">${esc(badgeText)}</span>
      </div>
      <div class="skip-panel__text">推奨状態: <strong>${esc(summary.stateText)}</strong></div>
      <div class="insight-list">
        ${items.map((x) => `<div class="insight-item"><div class="insight-item__name">・${esc(x)}</div></div>`).join('')}
      </div>
    `;
  }

  function renderFilterToolbar() {
    const el = qs('#filter-toolbar');
    if (!el) return;
    el.innerHTML = `
      <div class="section-title-row">
        <div>
          <h2 class="section-title">出馬表フィルタ</h2>
          <div class="section-subtitle">キーワード・並び替え・単勝ありだけで絞る。</div>
        </div>
      </div>
      <div class="filter-toolbar__row">
        <label>
          キーワード
          <input id="race-keyword" type="text" placeholder="馬名 / 騎手 / 血統 / 理由タグ">
        </label>
        <label>
          並び替え
          <select id="race-sort-key">
            <option value="pred_order">AI順位</option>
            <option value="popularity">人気</option>
            <option value="tansho_odds">単勝</option>
            <option value="p_win">勝率</option>
            <option value="p_top3">複勝率</option>
            <option value="course_adv_rank">適性順位</option>
            <option value="divergence">人気乖離</option>
            <option value="umaban">馬番</option>
          </select>
        </label>
        <label>
          順序
          <select id="race-sort-dir">
            <option value="asc">昇順</option>
            <option value="desc">降順</option>
          </select>
        </label>
        <label class="check-pill"><input id="race-odds-only" type="checkbox"> 単勝ありだけ</label>
      </div>
      <div class="filter-toolbar__meta">人気馬の乖離を見るなら AI順位 / 人気 / 適性順位 の順で見ると分かりやすい。</div>
    `;

    qs('#race-keyword')?.addEventListener('input', (e) => {
      state.keyword = e.currentTarget.value || '';
      renderHorseList();
    });
    qs('#race-sort-key')?.addEventListener('change', (e) => {
      state.sortKey = e.currentTarget.value || 'pred_order';
      renderHorseList();
    });
    qs('#race-sort-dir')?.addEventListener('change', (e) => {
      state.sortDir = e.currentTarget.value || 'asc';
      renderHorseList();
    });
    qs('#race-odds-only')?.addEventListener('change', (e) => {
      state.oddsOnly = !!e.currentTarget.checked;
      renderHorseList();
    });
  }

  function matchesHorse(horse) {
    if (state.oddsOnly && toNum(horse.tansho_odds) === null) return false;
    if (!state.keyword) return true;
    const hay = [
      horse.horse_name,
      horse.jockey,
      horse.trainer,
      horse.sire,
      horse.dam_sire,
      ...(horse.reasons_pos_list || []),
      ...(horse.reasons_neg_list || []),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(state.keyword.trim().toLowerCase());
  }

  function compareHorses(a, b) {
    const dir = state.sortDir === 'desc' ? -1 : 1;
    let av;
    let bv;
    if (state.sortKey === 'divergence') {
      av = divergenceAbs(a);
      bv = divergenceAbs(b);
    } else {
      av = a[state.sortKey];
      bv = b[state.sortKey];
    }
    const an = toNum(av);
    const bn = toNum(bv);
    if (an !== null && bn !== null && an !== bn) return (an - bn) * dir;
    return String(a.horse_name || '').localeCompare(String(b.horse_name || ''), 'ja') * dir;
  }

  function modelRankHtml(horse) {
    const entries = ['2008', '2015', '2019'].map((year) => ({
      year,
      rank: getModelRank(horse, year),
      score: toNum(horse?.model_scores?.[year]?.score),
    }));
    return entries.map((item) => `
      <div class="model-rank-item">
        <div>
          <div class="model-rank-item__name">${esc(item.year)}</div>
          <div class="model-rank-item__meta">score ${esc(fmtNum(item.score, 3))}</div>
        </div>
        <div class="model-rank-item__rank">${esc(fmt(item.rank))}位</div>
      </div>
    `).join('');
  }

  function pastSummary(horse) {
    const run = horse.past_runs?.[0];
    if (!run) return '近走データなし';
    const bits = [run.finish != null ? `${run.finish}着` : null, run.distance_text || (run.distance ? `${run.distance}` : null), run.going, run.popularity != null ? `${run.popularity}人気` : null, run.last3f != null ? `上がり${fmtNum(run.last3f)}` : null].filter(Boolean);
    return bits.join(' / ');
  }

  function horseCardHtml(horse) {
    const aiGap = aiPopGap(horse);
    const fitGap = fitPopGap(horse);
    const detailId = `detail-${horse.umaban || horse.horse_name}`;
    const danger = isDangerPopular(horse);
    const value = isValueHorse(horse);

    return `
      <article class="horse-card sheet" id="horse-${encodeURIComponent(horse.umaban || horse.horse_name || '')}">
        <div class="horse-card__main">
          <div class="horse-card__left">
            <div class="horse-card__head">
              <div class="horse-no">${esc(fmt(horse.umaban))}</div>
              <div class="horse-name-line">
                <h3 class="horse-name">${esc(fmt(horse.horse_name))}</h3>
                <div class="horse-sub">${esc([fmt(horse.sex_age), horse.burden_weight != null ? `${fmtNum(horse.burden_weight)}kg` : null, fmt(horse.jockey, '')].filter(Boolean).join(' / '))}</div>
                <div class="horse-blood">${esc([horse.sire, horse.dam_sire].filter(Boolean).join(' × ') || '血統情報なし')}</div>
              </div>
            </div>
            <div class="tag-list" style="margin-top:10px;">
              ${danger ? '<span class="tag tag--minus">危険人気</span>' : ''}
              ${value ? '<span class="tag tag--plus">妙味候補</span>' : ''}
              ${horse.style ? `<span class="tag tag--blue">脚質 ${esc(fmt(horse.style))}</span>` : ''}
              ${horse.reasons_pos_list.slice(0, 2).map((t) => `<span class="tag tag--plus">${esc(t)}</span>`).join('')}
              ${horse.reasons_neg_list.slice(0, 1).map((t) => `<span class="tag tag--minus">${esc(t)}</span>`).join('')}
            </div>
          </div>

          <div class="horse-summary-metrics">
            <div class="metric-box">
              <div class="metric-box__label">人気 / 単勝</div>
              <div class="metric-box__value">${esc(fmt(horse.popularity))}</div>
              <div class="metric-box__sub">単勝 ${esc(fmtNum(horse.tansho_odds))}</div>
            </div>
            <div class="metric-box">
              <div class="metric-box__label">AI / 適性</div>
              <div class="metric-box__value">${esc(fmt(horse.pred_order))} / ${esc(fmt(horse.course_adv_rank))}</div>
              <div class="metric-box__sub">乖離 AI ${aiGap === null ? '—' : (aiGap > 0 ? '+' : '') + fmt(aiGap)} / 適性 ${fitGap === null ? '—' : (fitGap > 0 ? '+' : '') + fmt(fitGap)}</div>
            </div>
            <div class="metric-box">
              <div class="metric-box__label">勝率 / 複勝率</div>
              <div class="metric-box__value">${esc(fmtPct(horse.p_win))}</div>
              <div class="metric-box__sub">複勝率 ${esc(fmtPct(horse.p_top3))}</div>
            </div>
          </div>

          <div class="horse-card__aside">
            <button type="button" class="horse-toggle" data-target="${esc(detailId)}">詳細を開く</button>
            <a class="btn-link" href="${esc(buildPageUrl('past', { race_date: state.data.race_date, race_id: state.data.race.race_id }))}#horse-${encodeURIComponent(horse.umaban || horse.horse_name || '')}">過去走比較へ</a>
          </div>
        </div>

        <div id="${esc(detailId)}" class="horse-card__details" hidden>
          <div class="horse-detail-grid">
            <section class="detail-box">
              <h4 class="detail-box__title">予想要約</h4>
              <div class="detail-kv">
                <div class="detail-kv__item"><div class="detail-kv__label">前走要約</div><div class="detail-kv__value">${esc(pastSummary(horse))}</div></div>
                <div class="detail-kv__item"><div class="detail-kv__label">脚質</div><div class="detail-kv__value">${esc(fmt(horse.style))}</div></div>
                <div class="detail-kv__item"><div class="detail-kv__label">AI乖離</div><div class="detail-kv__value">${aiGap === null ? '—' : `${aiGap > 0 ? '+' : ''}${fmt(aiGap)}`}</div></div>
                <div class="detail-kv__item"><div class="detail-kv__label">適性乖離</div><div class="detail-kv__value">${fitGap === null ? '—' : `${fitGap > 0 ? '+' : ''}${fmt(fitGap)}`}</div></div>
                <div class="detail-kv__item"><div class="detail-kv__label">プラス材料</div><div class="detail-kv__value">${esc(horse.reasons_pos_list.join(' / ') || '—')}</div></div>
                <div class="detail-kv__item"><div class="detail-kv__label">不安材料</div><div class="detail-kv__value">${esc(horse.reasons_neg_list.join(' / ') || '—')}</div></div>
              </div>
            </section>

            <section class="detail-box">
              <h4 class="detail-box__title">モデル順位</h4>
              <div class="model-rank-list">${modelRankHtml(horse)}</div>
            </section>
          </div>
        </div>
      </article>
    `;
  }

  function bindHorseToggles() {
    qsa('.horse-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-target');
        const detail = id ? qs(`#${CSS.escape(id)}`) : null;
        if (!detail) return;
        const open = detail.hidden;
        detail.hidden = !open;
        btn.textContent = open ? '詳細を閉じる' : '詳細を開く';
      });
    });
  }

  function renderHorseList() {
    const list = qs('#horse-list');
    const meta = qs('#horse-list-meta');
    if (!list) return;
    state.filtered = state.horses.filter(matchesHorse).sort(compareHorses);
    if (meta) meta.textContent = `${fmt(state.filtered.length)}頭表示 / 全${fmt(state.horses.length)}頭`;

    if (!state.filtered.length) {
      list.innerHTML = '<div class="empty-panel">該当馬なし</div>';
      return;
    }

    list.innerHTML = state.filtered.map(horseCardHtml).join('');
    bindHorseToggles();
  }

  async function init() {
    try {
      baseLayout();
      setStatus('レースJSONを読み込み中...');
      const data = await fetchJson(getJsonPath());
      state.data = data;
      state.horses = normalizedHorses(data);
      const summary = buildSummary(state.horses, data.race || {});
      clearStatus();
      renderHero(data, summary);
      renderSummaryPanel(summary);
      renderDivergencePanel(state.horses);
      renderSkipPanel(summary);
      renderFilterToolbar();
      renderHorseList();
    } catch (err) {
      console.error(err);
      try { baseLayout(); } catch (_) {}
      setStatus(err?.message || '表示に失敗したで。', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
