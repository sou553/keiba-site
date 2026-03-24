(function () {
  'use strict';

  const PAGE_DEFAULTS = {
    race: 'race_detail.html',
    past: 'past_detail.html',
    betting: 'betting.html',
  };

  const JRA_PLACE_MAP = {
    '01': '札幌',
    '02': '函館',
    '03': '福島',
    '04': '新潟',
    '05': '東京',
    '06': '中山',
    '07': '中京',
    '08': '京都',
    '09': '阪神',
    '10': '小倉',
  };

  const state = {
    data: null,
    keyword: '',
    filterBoard3: false,
    filterSameDistance: false,
    filterSameCourse: false,
    sortKey: 'umaban',
  };

  function qs(selector, root = document) {
    return root.querySelector(selector);
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
    const el = qs('#past-status');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle('is-error', !!isError);
  }

  function clearStatus() {
    const el = qs('#past-status');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-error');
  }

  function parseDistanceValue(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return value;
    const m = String(value).match(/(\d{3,4})/);
    return m ? Number(m[1]) : null;
  }

  function parseSurfaceText(value) {
    if (!value) return '';
    const s = String(value);
    if (s.includes('芝')) return '芝';
    if (s.includes('ダ')) return 'ダ';
    if (s.includes('障')) return '障';
    return s;
  }

  function normalizeDate(value) {
    if (!value) return null;
    const s = String(value).replace(/\./g, '/').replace(/-/g, '/');
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function daysBetween(a, b) {
    if (!a || !b) return null;
    const ms = a.getTime() - b.getTime();
    return Math.floor(ms / 86400000);
  }

  function placeFromRaceId(raceId) {
    const rid = String(raceId ?? '').replace(/\D/g, '');
    if (rid.length < 6) return '';
    return JRA_PLACE_MAP[rid.slice(4, 6)] || '';
  }

  function currentCourseLabel(race) {
    return race.course || placeFromRaceId(race.race_id) || '';
  }

  function meaningfulPastRuns(horse) {
    const runs = Array.isArray(horse.past_runs) ? horse.past_runs : [];
    return runs.filter((run) => {
      if (!run || typeof run !== 'object') return false;
      return ['date', 'race_id', 'race_name', 'finish', 'distance', 'last3f', 'jockey'].some((k) => run[k] != null && run[k] !== '');
    });
  }

  function getRunCourseName(run) {
    return run.course_name || run.course || placeFromRaceId(run.race_id) || '';
  }

  function getRunDistanceText(run) {
    return run.distance_text || run.distance || [parseSurfaceText(run.surface), parseDistanceValue(run.distance_m || run.distance)].filter(Boolean).join('');
  }

  function sameDistance(run, race) {
    const rd = parseDistanceValue(run.distance_m || run.distance);
    const cd = parseDistanceValue(race.distance);
    return rd != null && cd != null && rd === cd;
  }

  function sameCourse(run, race) {
    const runPlace = getRunCourseName(run);
    const currentPlace = currentCourseLabel(race);
    const runSurface = parseSurfaceText(run.surface || run.distance);
    const currentSurface = parseSurfaceText(race.surface);
    return !!runPlace && !!currentPlace && runPlace === currentPlace && sameDistance(run, race) && (!runSurface || !currentSurface || runSurface === currentSurface);
  }

  function boardCount(runs, limit = 3) {
    return runs.slice(0, limit).filter((run) => {
      const finish = toNumber(run.finish);
      return finish != null && finish <= 5;
    }).length;
  }

  function avgFinish(runs, limit = 3) {
    const nums = runs.slice(0, limit).map((run) => toNumber(run.finish)).filter((v) => v != null);
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function avgLast3f(runs, limit = 3) {
    const nums = runs.slice(0, limit).map((run) => toNumber(run.last3f)).filter((v) => v != null);
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function inferStyleFromPassing(passing) {
    if (!passing) return '';
    const nums = String(passing).match(/\d+/g);
    if (!nums || !nums.length) return '';
    const first = Number(nums[0]);
    if (first <= 3) return '先行';
    if (first <= 6) return '好位';
    if (first <= 10) return '差し';
    return '追込';
  }

  function styleTrendText(runs) {
    const styles = runs.slice(0, 3).map((run) => inferStyleFromPassing(run.passing)).filter(Boolean);
    if (!styles.length) return '不明';
    const counts = styles.reduce((acc, style) => {
      acc[style] = (acc[style] || 0) + 1;
      return acc;
    }, {});
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || styles[0];
    return `${best}傾向`;
  }

  function layoffText(raceDate, prevDate) {
    const days = daysBetween(normalizeDate(raceDate), normalizeDate(prevDate));
    if (days == null) return '不明';
    if (days <= 21) return '中1-3週';
    if (days <= 42) return '中3-6週';
    if (days <= 84) return '2-3か月';
    if (days <= 168) return '3-6か月';
    return '半年以上';
  }

  function distanceChangeText(race, prev1) {
    if (!prev1) return '不明';
    const current = parseDistanceValue(race.distance);
    const prev = parseDistanceValue(prev1.distance_m || prev1.distance);
    if (current == null || prev == null) return '不明';
    const diff = current - prev;
    if (diff === 0) return '同距離';
    return diff > 0 ? `${diff}m延長` : `${Math.abs(diff)}m短縮`;
  }

  function prev1Brief(run) {
    if (!run) return '前走データなし';
    const items = [
      run.finish != null ? `${fmt(run.finish)}着` : null,
      getRunDistanceText(run),
      run.going,
      run.popularity != null ? `${fmt(run.popularity)}人気` : null,
      run.last3f != null ? `上がり${fmtNum(run.last3f, 1)}` : null,
    ].filter(Boolean);
    return items.join(' / ') || '前走データなし';
  }

  function recent3Brief(runs) {
    const recent = runs.slice(0, 3);
    if (!recent.length) return '近3走データなし';
    const finishes = recent.map((run) => fmt(run.finish)).join('-');
    const avg = avgFinish(recent, 3);
    return `近3走[${finishes}] 平均着順${avg != null ? avg.toFixed(1) : '—'}`;
  }

  function sameDistanceText(runs, race) {
    return `同距離 ${runs.filter((run) => sameDistance(run, race)).length}走`;
  }

  function sameCourseText(runs, race) {
    return `同コース ${runs.filter((run) => sameCourse(run, race)).length}走`;
  }

  function jockeyChangeText(horse, prev1) {
    if (!prev1 || !horse.jockey || !prev1.jockey) return '不明';
    return horse.jockey === prev1.jockey ? '継続騎乗' : `騎手替わり(${fmt(prev1.jockey)}→${fmt(horse.jockey)})`;
  }

  function weightChangeText(horse) {
    const diff = toNumber(horse.horse_weight_diff);
    if (diff == null) return '不明';
    return diff > 0 ? `+${diff}kg` : `${diff}kg`;
  }

  function reasonsList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value !== 'string') return [];
    return value.split(/[|、,／/]/).map((x) => x.trim()).filter(Boolean);
  }

  function enrichHorse(horse, race) {
    const runs = meaningfulPastRuns(horse);
    const prev1 = runs[0] || null;
    const sameDistanceCount = runs.filter((run) => sameDistance(run, race)).length;
    const sameCourseCount = runs.filter((run) => sameCourse(run, race)).length;
    const board3 = boardCount(runs, 3);
    const finishAvg3 = avgFinish(runs, 3);
    const last3fAvg3 = avgLast3f(runs, 3);

    return {
      ...horse,
      _pastRuns: runs,
      _prev1Brief: prev1Brief(prev1),
      _recent3Brief: recent3Brief(runs),
      _sameDistanceText: sameDistanceText(runs, race),
      _sameCourseText: sameCourseText(runs, race),
      _sameDistanceCount: sameDistanceCount,
      _sameCourseCount: sameCourseCount,
      _layoffText: layoffText(race.race_date, prev1?.date),
      _styleTrendText: styleTrendText(runs),
      _distanceChangeText: distanceChangeText(race, prev1),
      _jockeyChangeText: jockeyChangeText(horse, prev1),
      _weightChangeText: weightChangeText(horse),
      _recentTop5Count: board3,
      _finishAvg3: finishAvg3,
      _last3fAvg3: last3fAvg3,
      _reasonsPosList: reasonsList(horse.reasons_pos),
      _reasonsNegList: reasonsList(horse.reasons_neg),
    };
  }

  function createLayout() {
    const root = qs('#past-app');
    if (!root) throw new Error('#past-app が見つからへん。past_detail.html に <div id="past-app"></div> を置いてな。');

    root.innerHTML = `
      <section class="past-page">
        <div id="past-status" class="page-status" hidden></div>
        <header id="past-header" class="past-page__header"></header>
        <nav id="past-tabs" class="race-page__tabs"></nav>
        <section id="past-race-summary" class="past-page__summary"></section>
        <section id="past-controls" class="past-page__controls"></section>
        <section class="past-page__table-wrap">
          <table class="past-table">
            <thead>
              <tr>
                <th>馬番</th>
                <th>馬名</th>
                <th>前走要約</th>
                <th>近3走要約</th>
                <th>条件一致</th>
                <th>休み明け</th>
                <th>脚質傾向</th>
                <th>材料</th>
              </tr>
            </thead>
            <tbody id="past-table-body"></tbody>
          </table>
        </section>
        <section id="past-bottom-panels" class="bottom-panels"></section>
      </section>
    `;
  }

  function renderHeader(data) {
    const race = data.race || {};
    const header = qs('#past-header');
    if (!header) return;
    const titleBits = [race.course, race.race_no != null ? `${race.race_no}R` : null, race.race_name].filter(Boolean);
    const metaBits = [race.course_name, race.distance ? `${race.distance}m` : null, race.surface, race.going, race.headcount ? `${race.headcount}頭` : null].filter(Boolean);

    header.innerHTML = `
      <div class="race-title-sub">${escapeHtml(data.race_date || '')}</div>
      <h1 class="race-title-main">${escapeHtml(titleBits.join(' '))}</h1>
      <div class="race-title-meta">${escapeHtml(metaBits.join(' / ') || '条件情報なし')}</div>
    `;
    document.title = `${titleBits.join(' ')} | 過去走比較`;
  }

  function renderTabs(data) {
    const nav = qs('#past-tabs');
    if (!nav) return;
    const race = data.race || {};
    race.race_date = data.race_date;
    const items = [
      { kind: 'race', label: '出走馬一覧', active: false },
      { kind: 'past', label: '過去走比較', active: true },
      { kind: 'betting', label: '買い目作成', active: false },
    ];
    nav.innerHTML = items.map((item) => `
      <a class="race-tab${item.active ? ' is-active' : ''}" href="${escapeHtml(buildPageUrl(item.kind, race))}">${escapeHtml(item.label)}</a>
    `).join('');
  }

  function renderRaceSummary(enriched) {
    const el = qs('#past-race-summary');
    if (!el) return;

    const withSameCourse = enriched.filter((h) => h._sameCourseCount > 0).length;
    const withSameDistance = enriched.filter((h) => h._sameDistanceCount > 0).length;
    const board3 = enriched.filter((h) => h._recentTop5Count >= 1).length;
    const frontType = enriched.filter((h) => /先行|好位/.test(h._styleTrendText)).length;

    el.innerHTML = `
      <div class="summary-chip-row">
        <span class="summary-chip">同コース経験 ${withSameCourse}頭</span>
        <span class="summary-chip">同距離経験 ${withSameDistance}頭</span>
        <span class="summary-chip">近3走掲示板内 ${board3}頭</span>
        <span class="summary-chip">先行寄り ${frontType}頭</span>
      </div>
    `;
  }

  function renderControls() {
    const el = qs('#past-controls');
    if (!el) return;
    el.innerHTML = `
      <div class="control-row">
        <label>検索 <input type="text" id="past-keyword" placeholder="馬名 / 騎手 / 血統"></label>
        <label>並び替え
          <select id="past-sort-key">
            <option value="umaban">馬番</option>
            <option value="same_course">同コース数</option>
            <option value="same_distance">同距離数</option>
            <option value="recent_top5">近3走掲示板内</option>
            <option value="last3f_avg">近3走上がり平均</option>
            <option value="finish_avg">近3走平均着順</option>
          </select>
        </label>
        <label><input type="checkbox" id="past-filter-board3"> 近3走掲示板内あり</label>
        <label><input type="checkbox" id="past-filter-same-distance"> 同距離経験あり</label>
        <label><input type="checkbox" id="past-filter-same-course"> 同コース経験あり</label>
      </div>
    `;

    qs('#past-keyword')?.addEventListener('input', (e) => {
      state.keyword = e.target.value.trim().toLowerCase();
      renderTable();
      renderBottomPanels();
    });
    qs('#past-sort-key')?.addEventListener('change', (e) => {
      state.sortKey = e.target.value;
      renderTable();
      renderBottomPanels();
    });
    qs('#past-filter-board3')?.addEventListener('change', (e) => {
      state.filterBoard3 = e.target.checked;
      renderTable();
      renderBottomPanels();
    });
    qs('#past-filter-same-distance')?.addEventListener('change', (e) => {
      state.filterSameDistance = e.target.checked;
      renderTable();
      renderBottomPanels();
    });
    qs('#past-filter-same-course')?.addEventListener('change', (e) => {
      state.filterSameCourse = e.target.checked;
      renderTable();
      renderBottomPanels();
    });
  }

  function horseMatches(horse) {
    if (state.filterBoard3 && horse._recentTop5Count < 1) return false;
    if (state.filterSameDistance && horse._sameDistanceCount < 1) return false;
    if (state.filterSameCourse && horse._sameCourseCount < 1) return false;
    if (!state.keyword) return true;

    const hay = [
      horse.horse_name,
      horse.jockey,
      horse.trainer,
      horse.sire,
      horse.dam_sire,
      horse._prev1Brief,
      horse._recent3Brief,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(state.keyword);
  }

  function compareHorse(a, b) {
    switch (state.sortKey) {
      case 'same_course':
        return b._sameCourseCount - a._sameCourseCount || (toNumber(a.umaban) || 999) - (toNumber(b.umaban) || 999);
      case 'same_distance':
        return b._sameDistanceCount - a._sameDistanceCount || (toNumber(a.umaban) || 999) - (toNumber(b.umaban) || 999);
      case 'recent_top5':
        return b._recentTop5Count - a._recentTop5Count || (toNumber(a.umaban) || 999) - (toNumber(b.umaban) || 999);
      case 'last3f_avg': {
        const av = a._last3fAvg3 ?? 999;
        const bv = b._last3fAvg3 ?? 999;
        return av - bv || (toNumber(a.umaban) || 999) - (toNumber(b.umaban) || 999);
      }
      case 'finish_avg': {
        const av = a._finishAvg3 ?? 999;
        const bv = b._finishAvg3 ?? 999;
        return av - bv || (toNumber(a.umaban) || 999) - (toNumber(b.umaban) || 999);
      }
      case 'umaban':
      default:
        return (toNumber(a.umaban) || 999) - (toNumber(b.umaban) || 999);
    }
  }

  function tagsHtml(horse) {
    const tags = [
      ...horse._reasonsPosList.slice(0, 3).map((x) => ({ text: x, cls: 'tag--plus' })),
      ...horse._reasonsNegList.slice(0, 2).map((x) => ({ text: x, cls: 'tag--minus' })),
    ];
    return tags.map((tag) => `<span class="tag ${tag.cls}">${escapeHtml(tag.text)}</span>`).join('');
  }

  function runCardHtml(run, race) {
    return `
      <article class="past-run-card">
        <header class="past-run-card__head">
          <div class="past-run-card__date">${escapeHtml(fmt(run.date))}</div>
          <div class="past-run-card__course">${escapeHtml([getRunCourseName(run), run.race_no != null ? `${fmt(run.race_no)}R` : null].filter(Boolean).join(' '))}</div>
          <div class="past-run-card__name">${escapeHtml(fmt(run.race_name))}</div>
        </header>
        <div class="past-run-card__main">
          <div class="past-run-card__result">
            <span class="result-rank">${escapeHtml(fmt(run.finish))}着</span>
            <span class="result-pop">${escapeHtml(fmt(run.popularity))}人気</span>
            <span class="result-odds">${escapeHtml(fmtNum(run.win_odds, 1))}</span>
          </div>
          <dl class="past-run-card__spec">
            <div><dt>条件</dt><dd>${escapeHtml([getRunDistanceText(run), fmt(run.going)].filter(Boolean).join(' / '))}</dd></div>
            <div><dt>頭数</dt><dd>${escapeHtml(run.field_size != null ? `${fmt(run.field_size)}頭` : '—')}</dd></div>
            <div><dt>騎手</dt><dd>${escapeHtml([fmt(run.jockey), run.burden_weight != null ? fmtNum(run.burden_weight, 1) : null].filter(Boolean).join(' / '))}</dd></div>
            <div><dt>時計</dt><dd>${escapeHtml(fmt(run.time))}</dd></div>
            <div><dt>着差</dt><dd>${escapeHtml(fmt(run.margin))}</dd></div>
            <div><dt>通過</dt><dd>${escapeHtml(fmt(run.passing))}</dd></div>
            <div><dt>上がり</dt><dd>${escapeHtml(fmtNum(run.last3f, 1))}</dd></div>
            <div><dt>馬体重</dt><dd>${escapeHtml(run.horse_weight != null ? `${fmt(run.horse_weight)}(${fmt(run.horse_weight_diff)})` : '—')}</dd></div>
            <div><dt>ペース</dt><dd>${escapeHtml(fmt(run.pace))}</dd></div>
          </dl>
          <div class="past-run-card__flags">
            ${sameCourse(run, race) ? '<span class="tag tag--info">同コース</span>' : ''}
            ${sameDistance(run, race) ? '<span class="tag tag--match">同距離</span>' : ''}
          </div>
        </div>
      </article>
    `;
  }

  function rowHtml(horse, race) {
    const anchorId = `horse-${horse.umaban ?? horse.horse_name ?? Math.random()}`;
    const detailHidden = horse._pastRuns.length ? '' : ' hidden';

    return `
      <tr id="${escapeHtml(anchorId)}" class="horse-summary-row" data-detail-id="detail-${escapeHtml(anchorId)}">
        <td>${fmt(horse.umaban)}</td>
        <td>
          <button type="button" class="horse-toggle-link" data-detail-id="detail-${escapeHtml(anchorId)}">${escapeHtml(fmt(horse.horse_name))}</button>
          <div class="horse-blood-mini">${escapeHtml([horse.sire, horse.dam_sire].filter(Boolean).join(' × '))}</div>
        </td>
        <td>${escapeHtml(horse._prev1Brief)}</td>
        <td>${escapeHtml(horse._recent3Brief)}</td>
        <td>
          <span>${escapeHtml(horse._sameDistanceText)}</span><br>
          <span>${escapeHtml(horse._sameCourseText)}</span><br>
          <span>${escapeHtml(horse._distanceChangeText)}</span>
        </td>
        <td>
          <span>${escapeHtml(horse._layoffText)}</span><br>
          <span class="horse-mini-meta">${escapeHtml(horse._jockeyChangeText)}</span><br>
          <span class="horse-mini-meta">${escapeHtml(horse._weightChangeText)}</span>
        </td>
        <td>${escapeHtml(horse._styleTrendText)}</td>
        <td><div class="tag-list">${tagsHtml(horse)}</div></td>
      </tr>
      <tr id="detail-${escapeHtml(anchorId)}" class="horse-detail-row" hidden${detailHidden}>
        <td colspan="8">
          <div class="past-run-grid">
            ${horse._pastRuns.map((run) => runCardHtml(run, race)).join('') || '<div class="empty-text">過去走データなし</div>'}
          </div>
        </td>
      </tr>
    `;
  }

  function renderTable() {
    const tbody = qs('#past-table-body');
    if (!tbody || !state.data) return;
    const race = state.data.race || {};
    const enriched = (state.data.horses || []).map((horse) => enrichHorse(horse, race));
    const filtered = enriched.filter(horseMatches).sort(compareHorse);
    state._filtered = filtered;

    tbody.innerHTML = filtered.map((horse) => rowHtml(horse, race)).join('') || '<tr><td colspan="8" class="empty-text">該当馬なし</td></tr>';

    tbody.querySelectorAll('.horse-toggle-link').forEach((button) => {
      button.addEventListener('click', () => {
        const detailId = button.dataset.detailId;
        const detailRow = detailId ? qs(`#${CSS.escape(detailId)}`) : null;
        if (!detailRow) return;
        detailRow.hidden = !detailRow.hidden;
      });
    });

    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const summaryRow = qs(`#${CSS.escape(hash)}`);
      const detailRow = qs(`#detail-${CSS.escape(hash)}`);
      if (summaryRow) summaryRow.scrollIntoView({ block: 'center' });
      if (detailRow) detailRow.hidden = false;
    }
  }

  function renderBottomPanels() {
    const root = qs('#past-bottom-panels');
    if (!root) return;
    const horses = Array.isArray(state._filtered) ? state._filtered : [];

    const sameCourseTop = horses.filter((h) => h._sameCourseCount > 0).sort((a, b) => b._sameCourseCount - a._sameCourseCount).slice(0, 5);
    const last3fTop = horses.filter((h) => h._last3fAvg3 != null).sort((a, b) => a._last3fAvg3 - b._last3fAvg3).slice(0, 5);
    const frontTop = horses.filter((h) => /先行|好位/.test(h._styleTrendText)).slice(0, 5);
    const layoffWarn = horses.filter((h) => /3-6か月|半年以上/.test(h._layoffText)).slice(0, 5);

    const listHtml = (items, formatter) => items.length
      ? `<ul>${items.map((item) => `<li>${formatter(item)}</li>`).join('')}</ul>`
      : '<div class="empty-text">該当なし</div>';

    root.innerHTML = `
      <div class="bottom-panel">
        <h3>同コース上位</h3>
        ${listHtml(sameCourseTop, (h) => `${escapeHtml(fmt(h.umaban))} ${escapeHtml(fmt(h.horse_name))} / ${escapeHtml(h._sameCourseText)}`)}
      </div>
      <div class="bottom-panel">
        <h3>上がり優秀馬</h3>
        ${listHtml(last3fTop, (h) => `${escapeHtml(fmt(h.umaban))} ${escapeHtml(fmt(h.horse_name))} / 平均${escapeHtml(fmtNum(h._last3fAvg3, 1))}`)}
      </div>
      <div class="bottom-panel">
        <h3>先行安定馬</h3>
        ${listHtml(frontTop, (h) => `${escapeHtml(fmt(h.umaban))} ${escapeHtml(fmt(h.horse_name))} / ${escapeHtml(h._styleTrendText)}`)}
      </div>
      <div class="bottom-panel">
        <h3>休み明け注意馬</h3>
        ${listHtml(layoffWarn, (h) => `${escapeHtml(fmt(h.umaban))} ${escapeHtml(fmt(h.horse_name))} / ${escapeHtml(h._layoffText)}`)}
      </div>
    `;
  }

  async function init() {
    try {
      createLayout();
      setStatus('読み込み中...');
      const data = await fetchJson(getJsonPath());
      state.data = data;
      clearStatus();
      renderHeader(data);
      renderTabs(data);
      renderRaceSummary((data.horses || []).map((horse) => enrichHorse(horse, data.race || {})));
      renderControls();
      renderTable();
      renderBottomPanels();
    } catch (error) {
      console.error(error);
      try {
        createLayout();
      } catch (_) {
        // noop
      }
      setStatus(error.message || '表示に失敗したで', true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
