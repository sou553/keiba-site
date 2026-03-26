(function () {
  'use strict';

  const PAGE_DEFAULTS = {
    race: 'race_detail.html',
    past: 'past_detail.html',
    betting: 'betting.html',
  };

  const PLACE_MAP = {
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
    race: null,
    horses: [],
    filtered: [],
    sortKey: 'pred_order',
    sortDir: 'asc',
    keyword: '',
    filterMode: 'all',
    oddsOnly: false,
    openCards: new Set(),
    pastVisibleByCard: {},
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

  function toNum(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function round1(v) {
    return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  }

  function round3(v) {
    return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  }

  function clip(v, min = 0, max = 1) {
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
  }

  function fmt(value, fallback = '—') {
    return value === null || value === undefined || value === '' ? fallback : String(value);
  }

  function fmtNum(value, digits = 1, fallback = '—') {
    const n = toNum(value);
    return n === null ? fallback : n.toFixed(digits).replace(/\.0$/, '');
  }

  function fmtPct01(value, digits = 1, fallback = '—') {
    const n = toNum(value);
    return n === null ? fallback : `${(n * 100).toFixed(digits).replace(/\.0$/, '')}%`;
  }

  function fmtOdds(value) {
    return fmtNum(value, 1, '—');
  }

  function avg(arr) {
    const xs = arr.filter((v) => Number.isFinite(v));
    if (!xs.length) return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  function stddev(arr) {
    const xs = arr.filter((v) => Number.isFinite(v));
    if (xs.length <= 1) return 0;
    const m = avg(xs);
    const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
    return Math.sqrt(v);
  }

  function parseDateLoose(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const s = String(value).trim();
    if (!s) return null;
    const normalized = s.replace(/[.]/g, '/').replace(/-/g, '/');
    const parts = normalized.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (parts) {
      const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) {
      const d = new Date(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDateJP(value) {
    const d = parseDateLoose(value);
    if (!d) return fmt(value, '—');
    const m = String(d.getMonth() + 1);
    const day = String(d.getDate());
    return `${m}/${day}`;
  }

  function diffDays(a, b) {
    const da = parseDateLoose(a);
    const db = parseDateLoose(b);
    if (!da || !db) return null;
    return Math.round((da.getTime() - db.getTime()) / 86400000);
  }

  function rankByDescending(items, getter, targetKey) {
    const withValues = items
      .map((item) => ({ item, v: toNum(getter(item)) }))
      .filter((row) => row.v !== null)
      .sort((a, b) => b.v - a.v);
    let lastValue = null;
    let lastRank = 0;
    withValues.forEach((row, idx) => {
      if (lastValue === null || row.v !== lastValue) {
        lastRank = idx + 1;
        lastValue = row.v;
      }
      row.item._derived = row.item._derived || {};
      row.item._derived[targetKey] = lastRank;
    });
  }

  function rankByAscending(items, getter, targetKey) {
    const withValues = items
      .map((item) => ({ item, v: toNum(getter(item)) }))
      .filter((row) => row.v !== null)
      .sort((a, b) => a.v - b.v);
    let lastValue = null;
    let lastRank = 0;
    withValues.forEach((row, idx) => {
      if (lastValue === null || row.v !== lastValue) {
        lastRank = idx + 1;
        lastValue = row.v;
      }
      row.item._derived = row.item._derived || {};
      row.item._derived[targetKey] = lastRank;
    });
  }

  function getDataRoot() {
    return document.body?.dataset?.dataRoot || './data';
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

  function getPageName(kind) {
    return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind];
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
    const el = qs('#race-status');
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle('is-error', !!isError);
  }

  function clearStatus() {
    const el = qs('#race-status');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-error');
  }

  function splitReasons(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v));
    return String(value)
      .split(/[\n、,，;；\/]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function normalizeSurface(surface) {
    const s = String(surface || '').trim();
    if (!s) return null;
    if (s.includes('芝')) return '芝';
    if (s.includes('ダ')) return 'ダ';
    if (s.includes('障')) return '障';
    return s;
  }

  function parseDistanceText(value) {
    if (!value) return { surface: null, distance: null, text: null };
    if (typeof value === 'number') return { surface: null, distance: value, text: String(value) };
    const text = String(value).trim();
    const m = text.match(/(芝|ダ|障|ダート)?\s*(\d{3,4})/);
    return {
      surface: m ? normalizeSurface(m[1]) : null,
      distance: m ? Number(m[2]) : null,
      text,
    };
  }

  function detectPlaceName(value) {
    const s = String(value || '');
    if (!s) return '';
    for (const name of Object.values(PLACE_MAP)) {
      if (s.includes(name)) return name;
    }
    const rid = s.replace(/\D/g, '');
    if (rid.length >= 6) return PLACE_MAP[rid.slice(4, 6)] || '';
    return '';
  }

  function hasMeaningfulRun(run) {
    if (!run || typeof run !== 'object') return false;
    const keys = ['date', 'race_id', 'race_name', 'finish', 'win_odds', 'distance', 'going', 'last3f', 'passing'];
    return keys.some((k) => run[k] !== null && run[k] !== undefined && run[k] !== '');
  }

  function extractPastRunsCompat(horse, maxPrev = 5) {
    const existing = Array.isArray(horse.past_runs) ? horse.past_runs.filter(hasMeaningfulRun) : [];
    if (existing.length) {
      return existing.map((run, idx) => normalizeRun(run, horse, idx + 1));
    }
    const out = [];
    for (let i = 1; i <= maxPrev; i += 1) {
      const keys = Object.keys(horse).filter((key) => key.startsWith(`prev${i}_`));
      if (!keys.length) continue;
      const run = { n: i };
      keys.forEach((key) => {
        run[key.replace(`prev${i}_`, '')] = horse[key];
      });
      if (hasMeaningfulRun(run)) out.push(normalizeRun(run, horse, i));
    }
    return out;
  }

  function normalizeRun(run, horse, idx) {
    const distanceInfo = parseDistanceText(run.distance || run.distance_text || run.distance_m);
    const raceId = String(run.race_id || '');
    const courseName = run.course_name || detectPlaceName(run.course_name || run.meeting || raceId);
    const currentSurface = normalizeSurface(horse.surface);
    const currentDistance = toNum(horse.distance || horse.distance_m);
    const currentCourse = horse.course || detectPlaceName(horse.course_name || horse.race_id);
    const runSurface = normalizeSurface(run.surface || distanceInfo.surface);
    const runDistance = toNum(run.distance_m || distanceInfo.distance);
    const sameDistance = currentDistance !== null && runDistance !== null && currentDistance === runDistance;
    const sameCourse = !!currentCourse && !!courseName && sameDistance && currentCourse === courseName && (!currentSurface || !runSurface || currentSurface === runSurface);

    return {
      n: idx,
      date: run.date || null,
      race_id: raceId || null,
      race_name: run.race_name || null,
      race_no: run.race_no || null,
      course_name: courseName || null,
      weather: run.weather || null,
      field_size: toNum(run.field_size),
      finish: toNum(run.finish),
      popularity: toNum(run.popularity),
      win_odds: toNum(run.win_odds),
      jockey: run.jockey || null,
      burden_weight: toNum(run.burden_weight),
      surface: runSurface,
      distance_m: runDistance,
      distance_text: run.distance_text || distanceInfo.text || (runSurface && runDistance ? `${runSurface}${runDistance}` : null),
      going: run.going || null,
      time: run.time || null,
      margin: run.margin || null,
      passing: run.passing || null,
      pace: run.pace || null,
      last3f: toNum(run.last3f),
      horse_weight: toNum(run.horse_weight),
      horse_weight_diff: toNum(run.horse_weight_diff),
      winner: run.winner || null,
      prize_10k: toNum(run.prize_10k),
      same_course: sameCourse,
      same_distance: sameDistance,
    };
  }

  function guessStyleFromPassing(passing) {
    if (!passing) return null;
    const nums = String(passing).match(/\d+/g);
    if (!nums || !nums.length) return null;
    const first = Number(nums[0]);
    if (!Number.isFinite(first)) return null;
    if (first <= 2) return '逃げ';
    if (first <= 5) return '先行';
    if (first <= 9) return '差し';
    return '追込';
  }

  function findModelYears(horses) {
    const years = new Set();
    horses.forEach((horse) => {
      if (horse.model_scores && typeof horse.model_scores === 'object') {
        Object.keys(horse.model_scores).forEach((year) => years.add(String(year)));
      }
      Object.keys(horse).forEach((key) => {
        const m = key.match(/(2008|2015|2019)/);
        if (m) years.add(m[1]);
      });
    });
    return Array.from(years).sort();
  }

  function getModelScore(horse, year) {
    const ms = horse.model_scores?.[year];
    const direct = toNum(ms?.score);
    if (direct !== null) return direct;
    const keys = [
      `score_${year}`,
      `pred_score_${year}`,
      `prob_${year}`,
      `p_${year}`,
      `softmax_${year}`,
    ];
    for (const k of keys) {
      const n = toNum(horse[k]);
      if (n !== null) return n;
    }
    return null;
  }

  function getModelRank(horse, year) {
    const explicit = toNum(horse.model_scores?.[year]?.rank);
    if (explicit !== null) return explicit;
    const flat = [
      `rank_${year}`,
      `pred_rank_${year}`,
      `ai_rank_${year}`,
      `order_${year}`,
      `_rank_${year}`,
    ];
    for (const k of flat) {
      const n = toNum(horse[k]);
      if (n !== null) return n;
    }
    return toNum(horse._derived?.[`model_rank_${year}`]);
  }

  function getCourseRank(horse) {
    return toNum(horse.course_adv_rank ?? horse.course_rank ?? horse._derived?.course_rank);
  }

  function getCourseScore(horse) {
    return toNum(horse.course_adv_score ?? horse.course_score_pt ?? horse.score_pt ?? horse.course_advantage ?? horse.course_score);
  }

  function getPopularity(horse) {
    return toNum(horse.popularity ?? horse.pop ?? horse.ninki ?? horse._derived?.popularity);
  }

  function getPredOrder(horse) {
    return toNum(horse.pred_order ?? horse.pred_rank ?? horse.ai_rank ?? horse.rank);
  }

  function getPWin(horse) {
    return toNum(horse.p_win ?? horse.p1_win ?? horse.win_prob);
  }

  function getPTop3(horse) {
    return toNum(horse.p_top3 ?? horse.top3_prob);
  }

  function getOdds(horse) {
    return toNum(horse.tansho_odds ?? horse.odds_tan ?? horse.win_odds ?? horse.odds);
  }

  function normalizeHorse(horse) {
    const pastRuns = extractPastRunsCompat(horse, 20);
    const prev1 = pastRuns[0] || null;
    const raceDate = horse.race_date || horse.date || state.data?.race_date || state.data?.race?.date;
    const layoffDays = prev1 ? diffDays(raceDate, prev1.date) : null;
    const styleEst = horse.style_est || horse.style || horse.running_style || guessStyleFromPassing(prev1?.passing) || guessStyleFromPassing(horse.passing);
    const posTags = splitReasons(horse.reasons_pos);
    const negTags = splitReasons(horse.reasons_neg);
    const currentPlace = detectPlaceName(horse.course || horse.course_name || horse.race_id);
    const sameDistanceCount = pastRuns.filter((run) => run.same_distance).length;
    const sameCourseCount = pastRuns.filter((run) => run.same_course).length;
    const samePlaceCount = pastRuns.filter((run) => detectPlaceName(run.course_name || run.race_id) === currentPlace).length;
    const recentTop3Count = pastRuns.filter((run) => {
      const f = toNum(run.finish);
      return f !== null && f <= 3;
    }).length;
    const last3fAvg3 = avg(pastRuns.slice(0, 3).map((run) => toNum(run.last3f)));

    return {
      ...horse,
      past_runs: pastRuns,
      _norm: {
        popularity: getPopularity(horse),
        pred_order: getPredOrder(horse),
        p_win: getPWin(horse),
        p_top3: getPTop3(horse),
        tansho_odds: getOdds(horse),
        course_adv_rank: getCourseRank(horse),
        course_adv_score: getCourseScore(horse),
        style_est: styleEst,
        reasons_pos_list: posTags,
        reasons_neg_list: negTags,
        same_distance_count: sameDistanceCount,
        same_course_count: sameCourseCount,
        same_place_count: samePlaceCount,
        recent_top3_count: recentTop3Count,
        last3f_avg_3: last3fAvg3,
        layoff_days: layoffDays,
      },
    };
  }

  function prepareRaceData(data) {
    const race = {
      ...(data.race || {}),
      race_id: data.race?.race_id || new URLSearchParams(window.location.search).get('race_id') || null,
      race_date: data.race_date || data.race?.race_date || new URLSearchParams(window.location.search).get('date') || null,
    };

    const horses = (Array.isArray(data.horses) ? data.horses : [])
      .filter((h) => h && (h.horse_name || h.name))
      .map(normalizeHorse);

    if (!race.course) race.course = detectPlaceName(race.course_name || race.race_id);
    race.surface = normalizeSurface(race.surface) || normalizeSurface(race.course_name) || race.surface;
    race.distance = toNum(race.distance ?? race.distance_m);
    race.headcount = toNum(race.headcount ?? race.field_size) || horses.length;

    // 人気が欠けていて単勝オッズがあるなら推定人気を付ける
    const oddsAvailable = horses.some((h) => h._norm.tansho_odds !== null);
    if (oddsAvailable && horses.some((h) => h._norm.popularity === null)) {
      rankByAscending(horses, (h) => h._norm.tansho_odds, 'popularity');
      horses.forEach((h) => {
        if (h._norm.popularity === null) h._norm.popularity = toNum(h._derived?.popularity);
      });
    }

    // コース適性順位の補完
    if (horses.some((h) => h._norm.course_adv_rank === null) && horses.some((h) => h._norm.course_adv_score !== null)) {
      rankByDescending(horses, (h) => h._norm.course_adv_score, 'course_rank');
      horses.forEach((h) => {
        if (h._norm.course_adv_rank === null) h._norm.course_adv_rank = toNum(h._derived?.course_rank);
      });
    }

    // モデル順位の補完
    const modelYears = findModelYears(horses);
    modelYears.forEach((year) => {
      const needsRank = horses.some((h) => getModelRank(h, year) === null) && horses.some((h) => getModelScore(h, year) !== null);
      if (needsRank) {
        rankByDescending(horses, (h) => getModelScore(h, year), `model_rank_${year}`);
      }
    });

    return { race, horses, modelYears };
  }

  function calcAgreementScore(horse, modelYears) {
    const ranks = [];
    const pred = horse._norm.pred_order;
    const course = horse._norm.course_adv_rank;
    if (pred !== null) ranks.push(pred);
    if (course !== null) ranks.push(course);
    modelYears.forEach((year) => {
      const r = getModelRank(horse, year);
      if (r !== null) ranks.push(r);
    });
    if (ranks.length <= 1) return 0.5;
    return clip(1 - stddev(ranks) / 5, 0, 1);
  }

  function calcDisagreementScore(horse, modelYears) {
    return clip(1 - calcAgreementScore(horse, modelYears), 0, 1);
  }

  function calcGaps(horse) {
    const popularity = horse._norm.popularity;
    const predOrder = horse._norm.pred_order;
    const courseRank = horse._norm.course_adv_rank;
    return {
      popularity,
      predOrder,
      courseRank,
      gapAi: popularity !== null && predOrder !== null ? popularity - predOrder : null,
      gapCourse: popularity !== null && courseRank !== null ? popularity - courseRank : null,
      overAi: popularity !== null && predOrder !== null ? predOrder - popularity : null,
      overCourse: popularity !== null && courseRank !== null ? courseRank - popularity : null,
    };
  }

  function buildHoleReason(horse) {
    const { gapAi, gapCourse } = calcGaps(horse);
    const parts = [];
    if (gapAi !== null && gapAi >= 3) parts.push(`人気よりAIが${gapAi}段上`);
    if (gapCourse !== null && gapCourse >= 4) parts.push(`人気より適性が${gapCourse}段上`);
    if (horse._norm.p_top3 !== null && horse._norm.p_top3 >= 0.30) parts.push(`複勝率${fmtPct01(horse._norm.p_top3)}`);
    if (horse._norm.tansho_odds !== null && horse._norm.tansho_odds >= 6) parts.push(`単勝${fmtOdds(horse._norm.tansho_odds)}`);
    return parts.join(' / ');
  }

  function buildDangerReason(horse) {
    const { overAi, overCourse } = calcGaps(horse);
    const parts = [];
    if (overAi !== null && overAi >= 3) parts.push(`人気よりAIが${overAi}段下`);
    if (overCourse !== null && overCourse >= 4) parts.push(`人気より適性が${overCourse}段下`);
    if (horse._norm.p_top3 !== null && horse._norm.p_top3 <= 0.45) parts.push(`複勝率${fmtPct01(horse._norm.p_top3)}`);
    return parts.join(' / ');
  }

  function calcHoleScore(horse, modelYears) {
    const { gapAi, gapCourse } = calcGaps(horse);
    const aiGapScore = clip((gapAi ?? 0) / 8, 0, 1);
    const courseGapScore = clip((gapCourse ?? 0) / 8, 0, 1);
    const top3Score = clip(((horse._norm.p_top3 ?? 0) - 0.20) / 0.40, 0, 1);
    const winScore = clip(((horse._norm.p_win ?? 0) - 0.05) / 0.20, 0, 1);
    const agreementScore = calcAgreementScore(horse, modelYears);
    return round3(
      0.35 * aiGapScore +
      0.25 * courseGapScore +
      0.20 * top3Score +
      0.10 * winScore +
      0.10 * agreementScore
    );
  }

  function calcDangerScore(horse, modelYears) {
    const { overAi, overCourse } = calcGaps(horse);
    const overAiScore = clip((overAi ?? 0) / 8, 0, 1);
    const overCourseScore = clip((overCourse ?? 0) / 8, 0, 1);
    const lowTop3Score = clip((0.50 - (horse._norm.p_top3 ?? 0)) / 0.40, 0, 1);
    const lowWinScore = clip((0.18 - (horse._norm.p_win ?? 0)) / 0.18, 0, 1);
    const disagreementScore = calcDisagreementScore(horse, modelYears);
    return round3(
      0.35 * overAiScore +
      0.25 * overCourseScore +
      0.20 * lowTop3Score +
      0.10 * lowWinScore +
      0.10 * disagreementScore
    );
  }

  function classifyHoleCandidate(horse, modelYears) {
    const popularity = horse._norm.popularity;
    const odds = horse._norm.tansho_odds;
    const pTop3 = horse._norm.p_top3;
    const { gapAi, gapCourse } = calcGaps(horse);
    const score = calcHoleScore(horse, modelYears);

    const basicPass =
      popularity !== null &&
      popularity >= 6 &&
      ((gapAi !== null && gapAi >= 3) || (gapCourse !== null && gapCourse >= 4)) &&
      pTop3 !== null && pTop3 >= 0.25;

    const strongPass =
      popularity !== null &&
      popularity >= 8 &&
      gapAi !== null && gapAi >= 4 &&
      pTop3 !== null && pTop3 >= 0.35;

    const oddsPass = odds === null || (odds >= 6 && odds <= 40);

    let label = null;
    if (strongPass && score >= 0.68 && oddsPass) label = '強穴';
    else if (basicPass && score >= 0.55 && oddsPass) label = '穴候補';
    else if (basicPass && score >= 0.45 && oddsPass) label = '軽穴';

    return {
      isHole: !!label,
      label,
      score,
      reason: buildHoleReason(horse),
    };
  }

  function classifyDangerPopular(horse, modelYears) {
    const popularity = horse._norm.popularity;
    const pTop3 = horse._norm.p_top3;
    const pWin = horse._norm.p_win;
    const { overAi, overCourse } = calcGaps(horse);
    const score = calcDangerScore(horse, modelYears);

    const basicPass =
      popularity !== null &&
      popularity <= 5 &&
      ((overAi !== null && overAi >= 3) || (overCourse !== null && overCourse >= 4)) &&
      pTop3 !== null && pTop3 <= 0.45;

    const strongPass =
      popularity !== null &&
      popularity <= 3 &&
      overAi !== null && overAi >= 4 &&
      overCourse !== null && overCourse >= 5 &&
      pWin !== null && pWin <= 0.10 &&
      pTop3 !== null && pTop3 <= 0.35;

    let label = null;
    if (strongPass && score >= 0.65) label = '強危険';
    else if (basicPass && score >= 0.52) label = '危険人気';
    else if (basicPass && score >= 0.42) label = 'やや危険';

    return {
      isDanger: !!label,
      label,
      score,
      reason: buildDangerReason(horse),
    };
  }

  function buildPopularHorseComment(horse, label) {
    const popularity = horse._norm.popularity;
    const predOrder = horse._norm.pred_order;
    const courseRank = horse._norm.course_adv_rank;
    const pTop3 = horse._norm.p_top3;

    const parts = [];
    if (predOrder !== null) parts.push(`AI${predOrder}位`);
    if (courseRank !== null) parts.push(`適性${courseRank}位`);
    if (pTop3 !== null) parts.push(`複勝率${fmtPct01(pTop3)}`);

    if (label === '信頼' || label === '妥当') return parts.join(' / ');

    if (label === 'やや危険') {
      const warns = [];
      if (predOrder !== null && popularity !== null && predOrder - popularity >= 3) warns.push('AI順位やや低め');
      if (courseRank !== null && popularity !== null && courseRank - popularity >= 4) warns.push('適性順位やや低め');
      if (pTop3 !== null && pTop3 < 0.35) warns.push('複勝率低め');
      return warns.length ? `${parts.join(' / ')} / ${warns.join('・')}` : parts.join(' / ');
    }

    if (label === '危険') {
      const warns = [];
      if (predOrder !== null && popularity !== null && predOrder - popularity >= 3) warns.push('AI順位が人気より低い');
      if (courseRank !== null && popularity !== null && courseRank - popularity >= 4) warns.push('適性順位が人気より低い');
      if (pTop3 !== null && pTop3 < 0.35) warns.push('複勝率が低い');
      return warns.length ? `${parts.join(' / ')} / ${warns.join('・')}` : parts.join(' / ');
    }

    return parts.join(' / ');
  }

  function classifyPopularHorse(horse, modelYears) {
    const popularity = horse._norm.popularity;
    const predOrder = horse._norm.pred_order;
    const courseRank = horse._norm.course_adv_rank;
    const pTop3 = horse._norm.p_top3;
    const pWin = horse._norm.p_win;
    const danger = classifyDangerPopular(horse, modelYears);

    if (popularity === null || popularity > 5) {
      return {
        label: null,
        comment: null,
        danger_score: danger.score,
      };
    }

    const aiGap = predOrder !== null ? (predOrder - popularity) : 0;
    const courseGap = courseRank !== null ? (courseRank - popularity) : 0;

    let weakCount = 0;
    if (aiGap >= 3) weakCount += 1;
    if (courseGap >= 4) weakCount += 1;
    if (pTop3 !== null && pTop3 < 0.35) weakCount += 1;
    if (pWin !== null && pWin < 0.08) weakCount += 1;
    if (danger.score >= 0.60) weakCount += 1;

    const isReliable =
      predOrder !== null && predOrder <= popularity + 1 &&
      (courseRank === null || courseRank <= popularity + 2) &&
      pTop3 !== null && pTop3 >= 0.55;

    const isTopPopular = popularity <= 2;

    if (isReliable) {
      return {
        label: '信頼',
        comment: buildPopularHorseComment(horse, '信頼'),
        danger_score: danger.score,
      };
    }

    const isDanger =
      weakCount >= 3 ||
      aiGap >= 4 ||
      courseGap >= 6 ||
      (pTop3 !== null && pTop3 < 0.20);

    if (isDanger) {
      return {
        label: '危険',
        comment: buildPopularHorseComment(horse, '危険'),
        danger_score: danger.score,
      };
    }

    const isSlightDanger =
      weakCount >= 2 ||
      (aiGap >= 3 && courseGap >= 3);

    if (isSlightDanger) {
      const label = isTopPopular ? '妥当' : 'やや危険';
      return {
        label,
        comment: buildPopularHorseComment(horse, label),
        danger_score: danger.score,
      };
    }

    return {
      label: '妥当',
      comment: buildPopularHorseComment(horse, '妥当'),
      danger_score: danger.score,
    };
  }

  function classifyCourseGapHorse(horse) {
    const popularity = horse._norm.popularity;
    const courseRank = horse._norm.course_adv_rank;
    const pTop3 = horse._norm.p_top3;

    if (popularity === null || courseRank === null) {
      return { type: null, label: null, score: null, gap: null, reason: null };
    }

    const gap = popularity - courseRank;
    const reverseGap = courseRank - popularity;

    const isCourseValue =
      popularity >= 6 &&
      courseRank <= 4 &&
      gap >= 3 &&
      pTop3 !== null && pTop3 >= 0.25;

    const isStrongCourseValue =
      popularity >= 8 &&
      courseRank <= 3 &&
      gap >= 5 &&
      pTop3 !== null && pTop3 >= 0.30;

    const isCourseDanger =
      popularity <= 5 &&
      reverseGap >= 4 &&
      pTop3 !== null && pTop3 <= 0.45;

    const isStrongCourseDanger =
      popularity <= 3 &&
      reverseGap >= 5 &&
      pTop3 !== null && pTop3 <= 0.35;

    const reason = `人気${popularity} / 適性${courseRank}${pTop3 !== null ? ` / 複勝率${fmtPct01(pTop3)}` : ''}`;

    if (isStrongCourseValue) {
      return { type: 'value', label: 'コース穴', score: gap, gap, reason };
    }
    if (isCourseValue) {
      return { type: 'value', label: 'コース向き', score: gap, gap, reason };
    }
    if (isStrongCourseDanger) {
      return { type: 'danger', label: '適性危険', score: reverseGap, gap: -reverseGap, reason };
    }
    if (isCourseDanger) {
      return { type: 'danger', label: '人気先行', score: reverseGap, gap: -reverseGap, reason };
    }

    return { type: null, label: null, score: null, gap, reason: `人気${popularity} / 適性${courseRank}` };
  }

  function buildCourseGapLists(rows) {
    const analyzed = rows.map((horse) => ({
      ...horse,
      _courseGap: classifyCourseGapHorse(horse),
    }));

    const valueList = analyzed
      .filter((horse) => horse._courseGap.type === 'value')
      .sort((a, b) => (b._courseGap.score ?? -999) - (a._courseGap.score ?? -999))
      .slice(0, 3);

    const dangerList = analyzed
      .filter((horse) => horse._courseGap.type === 'danger')
      .sort((a, b) => (b._courseGap.score ?? -999) - (a._courseGap.score ?? -999))
      .slice(0, 3);

    return { valueList, dangerList };
  }

  function analyzeRace(prepared) {
    const { race, horses, modelYears } = prepared;
    const rows = horses.map((horse) => {
      const hole = classifyHoleCandidate(horse, modelYears);
      const danger = classifyDangerPopular(horse, modelYears);
      const popular = classifyPopularHorse(horse, modelYears);
      const agreement = calcAgreementScore(horse, modelYears);
      const gaps = calcGaps(horse);
      return {
        ...horse,
        _analysis: {
          hole_score: hole.score,
          hole_label: hole.label,
          hole_reason: hole.reason,
          danger_score: danger.score,
          danger_label: danger.label,
          danger_reason: danger.reason,
          popular_label: popular.label,
          popular_comment: popular.comment,
          agreement_score: round3(agreement),
          disagreement_score: round3(1 - agreement),
          gap_ai: gaps.gapAi,
          gap_course: gaps.gapCourse,
          over_ai: gaps.overAi,
          over_course: gaps.overCourse,
        },
      };
    });

    rows.sort(sortByPredThenTop3);

    const holeCandidates = rows
      .filter((horse) => !!horse._analysis.hole_label)
      .sort((a, b) => (b._analysis.hole_score ?? -99) - (a._analysis.hole_score ?? -99) || sortByPredThenTop3(a, b));

    const dangerPopulars = rows
      .filter((horse) => !!horse._analysis.danger_label)
      .sort((a, b) => (b._analysis.danger_score ?? -99) - (a._analysis.danger_score ?? -99) || ((a._norm.popularity ?? 999) - (b._norm.popularity ?? 999)));

    const popularSummary = rows
      .filter((horse) => horse._norm.popularity !== null && horse._norm.popularity <= 5)
      .sort((a, b) => (a._norm.popularity ?? 999) - (b._norm.popularity ?? 999))
      .map((horse) => ({
        umaban: horse.umaban,
        horse_name: horse.horse_name,
        popularity: horse._norm.popularity,
        pred_order: horse._norm.pred_order,
        course_adv_rank: horse._norm.course_adv_rank,
        p_win: horse._norm.p_win,
        p_top3: horse._norm.p_top3,
        label: horse._analysis.popular_label,
        comment: horse._analysis.popular_comment,
      }));

    const courseGapLists = buildCourseGapLists(rows);
    const summary = buildPredictionSummary(race, rows, holeCandidates, dangerPopulars, popularSummary);
    return { race, horses: rows, modelYears, holeCandidates, dangerPopulars, popularSummary, courseGapLists, summary };
  }

  function buildPredictionSummary(race, rows, holeCandidates, dangerPopulars, popularSummary) {
    const top1 = rows[0] || null;
    const top2 = rows[1] || null;
    const top3 = rows[2] || null;

    const winGap12 = top1 && top2 && top1._norm.p_win !== null && top2._norm.p_win !== null
      ? top1._norm.p_win - top2._norm.p_win
      : null;

    const strongDangerCount = dangerPopulars.filter((horse) => horse._analysis.danger_label === '強危険').length;
    const dangerCount = dangerPopulars.length;
    const dangerousPopularCount = popularSummary.filter((row) => row.label === '危険' || row.label === 'やや危険').length;

    let status = '混戦';
    const reasons = [];

    if (top1 && top1._norm.p_top3 !== null && top1._norm.p_top3 >= 0.70 && winGap12 !== null && winGap12 >= 0.08 && dangerCount <= 1) {
      status = '本命寄り';
      reasons.push('総合1位の信頼度が高い');
      reasons.push('1位と2位の差が比較的大きい');
    } else if (strongDangerCount >= 1 || dangerCount >= 2 || (winGap12 !== null && winGap12 <= 0.03) || (top1 && top1._norm.p_top3 !== null && top1._norm.p_top3 < 0.50)) {
      status = '見送り寄り';
      if (dangerCount >= 2) reasons.push('危険人気が複数いる');
      if (strongDangerCount >= 1) reasons.push('上位人気に強い危険人気がいる');
      if (winGap12 !== null && winGap12 <= 0.03) reasons.push('1位と2位の差が小さい');
      if (top1 && top1._norm.p_top3 !== null && top1._norm.p_top3 < 0.50) reasons.push('本命の複勝率が低め');
    } else {
      status = '混戦';
      reasons.push('上位評価が拮抗している');
      if (dangerousPopularCount >= 1) reasons.push('人気馬に不安要素あり');
    }

    const commentParts = [];
    if (status === '本命寄り' && top1) commentParts.push(`本命は${top1.umaban} ${top1.horse_name}`);
    else if (status === '見送り寄り') commentParts.push('見送り寄り');
    else commentParts.push('上位拮抗');
    if (top2) commentParts.push(`相手本線は${top2.umaban}`);
    if (top3) commentParts.push(`次点${top3.umaban}`);
    if (holeCandidates[0]) commentParts.push(`穴は${holeCandidates[0].umaban}`);
    if (dangerPopulars[0]) commentParts.push(`危険人気は${dangerPopulars[0].umaban}`);

    return {
      status,
      reasons,
      comment: `${commentParts.join('。')}。`,
      mainHorse: top1,
      lineHorses: [top2, top3].filter(Boolean),
      holeHorses: holeCandidates.slice(0, 3),
      dangerHorses: dangerPopulars.slice(0, 3),
      popularSummary,
    };
  }

  function sortByPredThenTop3(a, b) {
    const aPred = a._norm.pred_order ?? 9999;
    const bPred = b._norm.pred_order ?? 9999;
    if (aPred !== bPred) return aPred - bPred;
    const aTop3 = a._norm.p_top3 ?? -9999;
    const bTop3 = b._norm.p_top3 ?? -9999;
    if (aTop3 !== bTop3) return bTop3 - aTop3;
    const aWin = a._norm.p_win ?? -9999;
    const bWin = b._norm.p_win ?? -9999;
    return bWin - aWin;
  }

  function getRaceMetaText(race) {
    const bits = [];
    if (race.surface) bits.push(race.surface);
    if (race.distance) bits.push(`${race.distance}m`);
    if (race.headcount) bits.push(`${race.headcount}頭`);
    if (race.going) bits.push(race.going);
    if (race.weather) bits.push(race.weather);
    return bits.join(' / ');
  }

  function baseLayout() {
    const root = qs('#race-app');
    if (!root) throw new Error('#race-app が見つからへん。race_detail.html に <div id="race-app"></div> を置いてな。');
    root.innerHTML = `
      <section class="race-detail-page">
        <div id="race-status" class="page-status" hidden></div>
        <section class="race-hero card" id="race-hero"></section>
        <section class="summary-panel card" id="prediction-summary"></section>
        <section class="divergence-panel card" id="divergence-panel"></section>
        <section class="skip-panel card" id="skip-panel"></section>
        <section class="filter-toolbar card" id="filter-toolbar"></section>
        <section class="horse-list-panel card">
          <div class="section-title-row">
            <div>
              <h2 class="section-title">出走馬一覧</h2>
              <div class="section-subtitle">人気・単勝・AI順位・適性順位・確率をスマホで見やすく整理</div>
            </div>
            <div class="foot-note" id="horse-list-note"></div>
          </div>
          <div class="horse-list" id="horse-list"></div>
        </section>
      </section>
    `;
  }

  function renderHero(analysis) {
    const hero = qs('#race-hero');
    if (!hero) return;
    const { race, summary } = analysis;
    const title = [race.course, race.race_no ? `${race.race_no}R` : null, race.race_name || race.title].filter(Boolean).join(' ');
    hero.innerHTML = `
      <div class="race-hero__head">
        <div>
          <div class="race-hero__date">${escapeHtml(formatDateJP(race.race_date))}</div>
          <h1 class="race-hero__title">${escapeHtml(title || 'レース詳細')}</h1>
          <div class="race-hero__meta">${escapeHtml(getRaceMetaText(race) || '条件情報なし')}</div>
          <div class="race-hero__note">${escapeHtml(summary.comment || '予想まとめを最上段に表示しています。')}</div>
        </div>
        <a class="action-link" href="./index.html${race.race_date ? `?date=${encodeURIComponent(race.race_date)}` : ''}">一覧へ戻る</a>
      </div>
      <nav class="page-tab-strip">
        <a class="race-tab is-active" href="${escapeHtml(buildPageUrl('race', race))}">予想 / 出馬表</a>
        <a class="race-tab" href="${escapeHtml(buildPageUrl('past', race))}">過去走比較</a>
        <a class="race-tab" href="${escapeHtml(buildPageUrl('betting', race))}">買い目作成</a>
      </nav>
    `;
    document.title = `${title || 'レース詳細'} | 予想整理サイト`;
  }

  function badgeClassByLabel(label) {
    if (label === '信頼') return 'badge badge--green';
    if (label === '危険' || label === '強危険' || label === '危険人気') return 'badge badge--red';
    if (label === 'やや危険') return 'badge badge--warn';
    if (label === '強穴' || label === '穴候補' || label === '軽穴') return 'badge badge--green';
    return 'badge badge--plain';
  }

  function renderPredictionSummary(analysis) {
    const el = qs('#prediction-summary');
    if (!el) return;
    const s = analysis.summary;
    const main = s.mainHorse;
    const lineHorses = s.lineHorses || [];
    const holeHorses = s.holeHorses || [];
    const dangerHorses = s.dangerHorses || [];
    const populars = s.popularSummary || [];

    el.innerHTML = `
      <div class="summary-grid">
        <div class="summary-main">
          <div class="summary-header">
            <div>
              <h2 class="summary-title">予想まとめ</h2>
              <div class="summary-lead">本命・相手本線・穴候補・危険人気を最初に確認できる形に整理</div>
            </div>
            <span class="${escapeHtml(s.status === '本命寄り' ? 'badge badge--green' : s.status === '見送り寄り' ? 'badge badge--red' : 'badge badge--warn')}">${escapeHtml(s.status)}</span>
          </div>

          ${main ? `
            <div class="summary-honmei">
              <div class="summary-honmei__mark">◎</div>
              <div class="summary-honmei__name">${escapeHtml(main.umaban)} ${escapeHtml(main.horse_name)}</div>
              <div class="metric-row">
                <span class="badge badge--blue">AI ${escapeHtml(fmt(main._norm.pred_order))}</span>
                <span class="badge badge--plain">人気 ${escapeHtml(fmt(main._norm.popularity))}</span>
                <span class="badge badge--plain">単勝 ${escapeHtml(fmtOdds(main._norm.tansho_odds))}</span>
                <span class="badge badge--green">勝率 ${escapeHtml(fmtPct01(main._norm.p_win))}</span>
                <span class="badge badge--green">複勝率 ${escapeHtml(fmtPct01(main._norm.p_top3))}</span>
              </div>
            </div>
          ` : '<div class="empty-panel">本命候補データがありません。</div>'}

          <div class="summary-picks">
            <div class="pick-box">
              <div class="pick-box__label">相手本線</div>
              <div class="pick-box__items">
                ${lineHorses.length ? lineHorses.map((horse, idx) => `
                  <div class="pick-line">
                    <span class="pick-line__mark">${idx === 0 ? '○' : '▲'}</span>
                    <div>
                      <div class="pick-line__name">${escapeHtml(horse.umaban)} ${escapeHtml(horse.horse_name)}</div>
                      <div class="pick-line__meta">AI ${escapeHtml(fmt(horse._norm.pred_order))} / 複勝率 ${escapeHtml(fmtPct01(horse._norm.p_top3))}</div>
                    </div>
                  </div>
                `).join('') : '<div class="note-text">相手本線候補はまだ絞れてへん。</div>'}
              </div>
            </div>

            <div class="pick-box">
              <div class="pick-box__label">穴候補</div>
              <div class="pick-box__items">
                ${holeHorses.length ? holeHorses.map((horse) => `
                  <div class="pick-line">
                    <span class="pick-line__mark">☆</span>
                    <div>
                      <div class="pick-line__name">${escapeHtml(horse.umaban)} ${escapeHtml(horse.horse_name)}</div>
                      <div class="pick-line__meta">${escapeHtml(horse._analysis.hole_label)} / ${escapeHtml(horse._analysis.hole_reason || '')}</div>
                    </div>
                  </div>
                `).join('') : '<div class="note-text">穴候補は見つからへんかった。</div>'}
              </div>
            </div>

            <div class="pick-box">
              <div class="pick-box__label">危険人気</div>
              <div class="pick-box__items">
                ${dangerHorses.length ? dangerHorses.map((horse) => `
                  <div class="pick-line">
                    <span class="pick-line__mark">!</span>
                    <div>
                      <div class="pick-line__name">${escapeHtml(horse.umaban)} ${escapeHtml(horse.horse_name)}</div>
                      <div class="pick-line__meta">${escapeHtml(horse._analysis.danger_label)} / ${escapeHtml(horse._analysis.danger_reason || '')}</div>
                    </div>
                  </div>
                `).join('') : '<div class="note-text">危険人気は少なめ。</div>'}
              </div>
            </div>

            <div class="pick-box">
              <div class="pick-box__label">ひとこと</div>
              <div class="pick-box__items">
                <div class="note-text">${escapeHtml(s.comment)}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="summary-side">
          <div class="detail-box">
            <h3 class="detail-box__title">人気馬まとめ</h3>
            <div class="popular-eval-list">
              ${populars.length ? populars.map((row) => `
                <div class="popular-eval-item">
                  <div>
                    <div class="popular-eval-item__name">${escapeHtml(fmt(row.popularity))}人気 ${escapeHtml(row.umaban)} ${escapeHtml(row.horse_name)}</div>
                    <div class="popular-eval-item__sub">${escapeHtml(row.comment || '')}</div>
                  </div>
                  <span class="${escapeHtml(badgeClassByLabel(row.label))}">${escapeHtml(row.label || '—')}</span>
                </div>
              `).join('') : '<div class="note-text">人気データがないため評価できません。</div>'}
            </div>
          </div>

          <div class="detail-box">
            <h3 class="detail-box__title">判定理由</h3>
            <div class="reason-list">
              ${s.reasons.length ? s.reasons.map((reason) => `
                <div class="reason-item">
                  <div>
                    <div class="reason-item__text">${escapeHtml(reason)}</div>
                    <div class="reason-item__sub">現在の人気・AI・適性・確率のバランスから判定</div>
                  </div>
                </div>
              `).join('') : '<div class="note-text">判定理由はまだありません。</div>'}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderDivergence(analysis) {
    const el = qs('#divergence-panel');
    if (!el) return;

    const rows = analysis.horses || [];

    const aiHole = rows
      .filter((horse) => horse._norm.popularity !== null && horse._norm.pred_order !== null)
      .filter((horse) => horse._norm.popularity >= 6 && (horse._norm.popularity - horse._norm.pred_order) >= 5)
      .sort((a, b) => ((b._norm.popularity - b._norm.pred_order) - (a._norm.popularity - a._norm.pred_order)) || sortByPredThenTop3(a, b))
      .slice(0, 3);

    const aiDanger = rows
      .filter((horse) => horse._norm.popularity !== null && horse._norm.pred_order !== null)
      .filter((horse) => horse._norm.popularity <= 5 && (horse._norm.pred_order - horse._norm.popularity) >= 5)
      .sort((a, b) => ((b._norm.pred_order - b._norm.popularity) - (a._norm.pred_order - a._norm.popularity)) || ((a._norm.popularity ?? 999) - (b._norm.popularity ?? 999)))
      .slice(0, 3);

    const courseHole = rows
      .filter((horse) => horse._norm.popularity !== null && horse._norm.course_adv_rank !== null)
      .filter((horse) => horse._norm.popularity >= 6 && (horse._norm.popularity - horse._norm.course_adv_rank) >= 5)
      .sort((a, b) => ((b._norm.popularity - b._norm.course_adv_rank) - (a._norm.popularity - a._norm.course_adv_rank)) || sortByPredThenTop3(a, b))
      .slice(0, 3);

    const courseDanger = rows
      .filter((horse) => horse._norm.popularity !== null && horse._norm.course_adv_rank !== null)
      .filter((horse) => horse._norm.popularity <= 5 && (horse._norm.course_adv_rank - horse._norm.popularity) >= 5)
      .sort((a, b) => ((b._norm.course_adv_rank - b._norm.popularity) - (a._norm.course_adv_rank - a._norm.popularity)) || ((a._norm.popularity ?? 999) - (b._norm.popularity ?? 999)))
      .slice(0, 3);

    function renderAiGroup(title, rows, type) {
      return `
        <div class="divergence-box__group">
          <div class="pick-box__label">${escapeHtml(title)}</div>
          ${rows.length ? rows.map((horse) => {
            const delta = type === 'hole'
              ? (horse._norm.popularity - horse._norm.pred_order)
              : (horse._norm.pred_order - horse._norm.popularity);
            return `
              <div class="divergence-line">
                <div>
                  <div class="divergence-line__name">${escapeHtml(horse.umaban)} ${escapeHtml(horse.horse_name)}</div>
                  <div class="divergence-line__sub">人気 ${escapeHtml(fmt(horse._norm.popularity))} / AI ${escapeHtml(fmt(horse._norm.pred_order))}${horse._norm.p_top3 !== null ? ` / 複勝率 ${escapeHtml(fmtPct01(horse._norm.p_top3))}` : ''}</div>
                </div>
                <span class="${escapeHtml(type === 'hole' ? 'badge badge--green delta-chip' : 'badge badge--red delta-chip')}">${type === 'hole' ? '+' : '-'}${escapeHtml(fmt(delta))}</span>
              </div>
            `;
          }).join('') : '<div class="note-text">該当馬なし</div>'}
        </div>
      `;
    }

    function renderCourseGroup(title, rows, type) {
      return `
        <div class="divergence-box__group">
          <div class="pick-box__label">${escapeHtml(title)}</div>
          ${rows.length ? rows.map((horse) => {
            const delta = type === 'hole'
              ? (horse._norm.popularity - horse._norm.course_adv_rank)
              : (horse._norm.course_adv_rank - horse._norm.popularity);
            return `
              <div class="divergence-line">
                <div>
                  <div class="divergence-line__name">${escapeHtml(horse.umaban)} ${escapeHtml(horse.horse_name)}</div>
                  <div class="divergence-line__sub">人気 ${escapeHtml(fmt(horse._norm.popularity))} / 適性 ${escapeHtml(fmt(horse._norm.course_adv_rank))}${horse._norm.p_top3 !== null ? ` / 複勝率 ${escapeHtml(fmtPct01(horse._norm.p_top3))}` : ''}</div>
                </div>
                <span class="${escapeHtml(type === 'hole' ? 'badge badge--green delta-chip' : 'badge badge--red delta-chip')}">${type === 'hole' ? '+' : '-'}${escapeHtml(fmt(delta))}</span>
              </div>
            `;
          }).join('') : '<div class="note-text">該当馬なし</div>'}
        </div>
      `;
    }

    el.innerHTML = `
      <div class="section-title-row">
        <div>
          <h2 class="section-title">人気馬の乖離</h2>
          <div class="section-subtitle">ここだけはシンプル判定。人気薄は差5以上、人気上位も差5以上だけ表示</div>
        </div>
      </div>
      <div class="divergence-grid">
        <div class="divergence-box">
          <h3 class="divergence-box__title">人気 × AI順位</h3>
          ${renderAiGroup('妙味馬', aiHole, 'hole')}
          ${renderAiGroup('危険人気馬', aiDanger, 'danger')}
        </div>
        <div class="divergence-box">
          <h3 class="divergence-box__title">人気 × 適性順位</h3>
          ${renderCourseGroup('コース向きで人気薄', courseHole, 'hole')}
          ${renderCourseGroup('人気先行で適性弱い', courseDanger, 'danger')}
        </div>
      </div>
    `;
  }

  function renderSkipPanel(analysis) {
    const el = qs('#skip-panel');
    if (!el) return;
    const safe = analysis.summary.status === '本命寄り';
    el.classList.toggle('is-safe', safe);
    el.innerHTML = `
      <div class="skip-panel__head">
        <div>
          <h2 class="skip-panel__title">${safe ? '買い目判断' : '見送り判定'}</h2>
          <div class="skip-panel__text">${escapeHtml(analysis.summary.status === '見送り寄り' ? '買う前に一度立ち止まりたいレース。' : analysis.summary.status === '本命寄り' ? '本命寄りで組み立てやすいレース。' : '上位は拮抗。買うなら点数管理が大事。')}</div>
        </div>
        <span class="${escapeHtml(safe ? 'badge badge--green' : analysis.summary.status === '見送り寄り' ? 'badge badge--red' : 'badge badge--warn')}">${escapeHtml(analysis.summary.status)}</span>
      </div>
      <div class="reason-list">
        ${(analysis.summary.reasons || []).map((reason) => `
          <div class="reason-item">
            <div>
              <div class="reason-item__text">${escapeHtml(reason)}</div>
              <div class="reason-item__sub">予想まとめと人気乖離から判定</div>
            </div>
          </div>
        `).join('') || '<div class="note-text">明確な見送りサインは出ていません。</div>'}
      </div>
    `;
  }

  function defaultSortDirForKey(key) {
    return ['umaban', 'pred_order', 'course_adv_rank', 'popularity', 'tansho_odds'].includes(key) ? 'asc' : 'desc';
  }

  function renderFilters() {
    const el = qs('#filter-toolbar');
    if (!el) return;
    el.innerHTML = `
      <div class="filter-toolbar__row">
        <label>
          キーワード
          <input id="filter-keyword" type="search" placeholder="馬名・騎手・調教師で絞り込み" value="${escapeHtml(state.keyword)}">
        </label>
        <label>
          表示条件
          <select id="filter-mode">
            <option value="all">すべて</option>
            <option value="hole">穴候補のみ</option>
            <option value="danger">危険人気のみ</option>
            <option value="popular">人気上位のみ</option>
            <option value="divergence">人気乖離あり</option>
          </select>
        </label>
        <label>
          単勝オッズあり
          <select id="filter-odds-only">
            <option value="0">条件なし</option>
            <option value="1">オッズありだけ</option>
          </select>
        </label>
        <div class="filter-toolbar__meta" id="filter-meta"></div>
      </div>
      <div class="horse-sort-bar">
        <button type="button" class="sort-chip ${state.sortKey === 'umaban' ? 'is-active' : ''}" data-sort="umaban">馬番</button>
        <button type="button" class="sort-chip ${state.sortKey === 'pred_order' ? 'is-active' : ''}" data-sort="pred_order">AI順</button>
        <button type="button" class="sort-chip ${state.sortKey === 'course_adv_rank' ? 'is-active' : ''}" data-sort="course_adv_rank">適性順</button>
        <button type="button" class="sort-chip ${state.sortKey === 'popularity' ? 'is-active' : ''}" data-sort="popularity">人気順</button>
        <button type="button" class="sort-chip ${state.sortKey === 'tansho_odds' ? 'is-active' : ''}" data-sort="tansho_odds">単勝順</button>
        <button type="button" class="sort-chip ${state.sortKey === 'p_top3' ? 'is-active' : ''}" data-sort="p_top3">複勝率順</button>
        <button type="button" class="sort-chip sort-chip--dir" id="toggle-sort-dir">${state.sortDir === 'asc' ? '昇順' : '降順'}</button>
      </div>
      <div class="filter-toolbar__row">
        <label>
          人気馬まとめ
          <input type="text" value="信頼 / 妥当 / 危険" disabled>
        </label>
        <label>
          予想状態
          <input type="text" value="${escapeHtml(state.data.summary.status)}" disabled>
        </label>
      </div>
    `;

    const modeSelect = qs('#filter-mode');
    if (modeSelect) modeSelect.value = state.filterMode;
    const oddsSelect = qs('#filter-odds-only');
    if (oddsSelect) oddsSelect.value = state.oddsOnly ? '1' : '0';

    qs('#filter-keyword')?.addEventListener('input', (e) => {
      state.keyword = e.target.value || '';
      applyFiltersAndRenderList();
    });
    modeSelect?.addEventListener('change', (e) => {
      state.filterMode = e.target.value || 'all';
      applyFiltersAndRenderList();
    });
    oddsSelect?.addEventListener('change', (e) => {
      state.oddsOnly = e.target.value === '1';
      applyFiltersAndRenderList();
    });
    qsa('[data-sort]', el).forEach((btn) => btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      if (!key) return;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = defaultSortDirForKey(key);
      }
      renderFilters();
      applyFiltersAndRenderList();
    }));
    qs('#toggle-sort-dir', el)?.addEventListener('click', () => {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      renderFilters();
      applyFiltersAndRenderList();
    });
  }

  function horseMatchesFilter(horse) {
    const keyword = state.keyword.trim().toLowerCase();
    if (keyword) {
      const hay = [horse.horse_name, horse.jockey, horse.trainer, horse.owner].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(keyword)) return false;
    }

    if (state.oddsOnly && horse._norm.tansho_odds === null) return false;

    switch (state.filterMode) {
      case 'hole':
        return !!horse._analysis.hole_label;
      case 'danger':
        return !!horse._analysis.danger_label;
      case 'popular':
        return horse._norm.popularity !== null && horse._norm.popularity <= 5;
      case 'divergence':
        return !!horse._analysis.hole_label || !!horse._analysis.danger_label;
      default:
        return true;
    }
  }

  function compareHorses(a, b) {
    const key = state.sortKey;
    let av;
    let bv;
    switch (key) {
      case 'pred_order':
        av = a._norm.pred_order; bv = b._norm.pred_order; return compareNullable(av, bv, state.sortDir === 'asc');
      case 'course_adv_rank':
        av = a._norm.course_adv_rank; bv = b._norm.course_adv_rank; return compareNullable(av, bv, state.sortDir === 'asc');
      case 'popularity':
        av = a._norm.popularity; bv = b._norm.popularity; return compareNullable(av, bv, state.sortDir === 'asc');
      case 'umaban':
        av = toNum(a.umaban); bv = toNum(b.umaban); return compareNullable(av, bv, state.sortDir === 'asc');
      case 'p_win':
        av = a._norm.p_win; bv = b._norm.p_win; return compareNullable(av, bv, state.sortDir !== 'asc');
      case 'p_top3':
        av = a._norm.p_top3; bv = b._norm.p_top3; return compareNullable(av, bv, state.sortDir !== 'asc');
      case 'tansho_odds':
        av = a._norm.tansho_odds; bv = b._norm.tansho_odds; return compareNullable(av, bv, state.sortDir === 'asc');
      case 'hole_score':
        av = a._analysis.hole_score; bv = b._analysis.hole_score; return compareNullable(av, bv, state.sortDir !== 'asc');
      case 'danger_score':
        av = a._analysis.danger_score; bv = b._analysis.danger_score; return compareNullable(av, bv, state.sortDir !== 'asc');
      case 'agreement_score':
        av = a._analysis.agreement_score; bv = b._analysis.agreement_score; return compareNullable(av, bv, state.sortDir !== 'asc');
      default:
        return sortByPredThenTop3(a, b);
    }
  }

  function compareNullable(a, b, asc = true) {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    return asc ? a - b : b - a;
  }

  function applyFiltersAndRenderList() {
    state.filtered = state.data.horses.filter(horseMatchesFilter).sort(compareHorses);
    const meta = qs('#filter-meta');
    if (meta) meta.textContent = `${state.filtered.length} / ${state.data.horses.length}頭表示`;
    const note = qs('#horse-list-note');
    if (note) note.textContent = `${state.data.summary.status} / 危険人気 ${state.data.dangerPopulars.length}頭 / 穴候補 ${state.data.holeCandidates.length}頭`;
    renderHorseList();
  }

  function buildLastRunBrief(horse) {
    const run = horse.past_runs[0];
    if (!run) return '近走データなし';
    const parts = [];
    if (run.finish !== null) parts.push(`前走${run.finish}着`);
    if (run.distance_text) parts.push(run.distance_text);
    if (run.going) parts.push(run.going);
    if (run.popularity !== null) parts.push(`${run.popularity}人気`);
    if (run.last3f !== null) parts.push(`上がり${fmtNum(run.last3f, 1)}`);
    return parts.join(' / ');
  }

  function buildRecentBrief(horse) {
    const recent = horse.past_runs.slice(0, 3);
    if (!recent.length) return '近3走データなし';
    const ranks = recent.map((run) => (run.finish !== null ? run.finish : '—')).join('-');
    const avgFinish = avg(recent.map((run) => toNum(run.finish)));
    const avgLast3f = avg(recent.map((run) => toNum(run.last3f)));
    const parts = [`近3走[${ranks}]`];
    if (avgFinish !== null) parts.push(`平均着順${fmtNum(avgFinish, 1)}`);
    if (avgLast3f !== null) parts.push(`上がり平均${fmtNum(avgLast3f, 1)}`);
    return parts.join(' / ');
  }

  function formatLayoff(days) {
    if (days === null) return '—';
    if (days <= 13) return '連闘・中1週';
    if (days <= 35) return '中2-5週';
    if (days <= 69) return '中6-9週';
    if (days <= 139) return '3-4か月';
    return '5か月以上';
  }


  function formatSexAgeLong(value) {
    const s = String(value || '').trim();
    if (!s) return '—';
    const m = s.match(/^([牡牝セ])\s*(\d+)/);
    if (!m) return s;
    return `${m[1]}${m[2]}歳`;
  }

  function uniqueNonEmpty(list) {
    const out = [];
    (list || []).forEach((item) => {
      const s = String(item || '').trim();
      if (!s || out.includes(s)) return;
      out.push(s);
    });
    return out;
  }

  function buildPositiveMemo(horse) {
    const items = [];
    if (horse._norm.style_est) items.push(`脚質:${horse._norm.style_est}`);
    //if (horse._norm.layoff_days !== null) items.push(`休み明け:${formatLayoff(horse._norm.layoff_days)}`);
    if (horse.sire) items.push(`父血統:${horse.sire}`);
    if (horse._norm.same_course_count > 0) items.push(`同コース経験:${horse._norm.same_course_count}走`);
    if (horse._norm.same_place_count > 0) items.push(`同競馬場経験:${horse._norm.same_place_count}走`);
    if (horse._norm.recent_top3_count > 0) items.push(`近3走掲示板:${horse._norm.recent_top3_count}回`);
    if (horse._analysis?.hole_reason) items.push(horse._analysis.hole_reason);
    return uniqueNonEmpty([...(horse._norm.reasons_pos_list || []), ...items]).join(' / ') || '—';
  }

  function buildNegativeMemo(horse) {
    const items = [];
    const pop = horse._norm.popularity;
    const ai = horse._norm.pred_order;
    const course = horse._norm.course_adv_rank;
    const odds = horse._norm.tansho_odds;
    //if (pop !== null && ai !== null && ai - pop >= 3) items.push(`人気よりAIが${ai - pop}段下`);
    //if (pop !== null && course !== null && course - pop >= 4) items.push(`人気より適性が${course - pop}段下`);
    //if (horse._norm.p_top3 !== null && horse._norm.p_top3 < 0.35) items.push(`複勝率${fmtPct01(horse._norm.p_top3)}と低め`);
    //if (horse._norm.p_win !== null && horse._norm.p_win < 0.08) items.push(`勝率${fmtPct01(horse._norm.p_win)}と低め`);
    if (horse._norm.recent_top3_count === 0 && horse.past_runs.length >= 3) items.push('近3走で掲示板なし');
    //if (odds !== null && odds >= 50) items.push(`単勝${fmtOdds(odds)}で人気薄`);
    if (horse._analysis?.danger_reason) items.push(horse._analysis.danger_reason);
    return uniqueNonEmpty([...(horse._norm.reasons_neg_list || []), ...items]).join(' / ') || '—';
  }

  function renderRunItem(run) {
    const distanceLabel = run.distance_text || [run.surface || '', run.distance_m ? `${run.distance_m}m` : ''].filter(Boolean).join('');
    const raceLabel = [run.course_name || '', run.race_name || ''].filter(Boolean).join(' ');
    return `
      <article class="netkeiba-run-item">
        <div class="netkeiba-run-item__date">${escapeHtml(fmt(run.date))}</div>
        <div class="netkeiba-run-item__main">
          <div class="netkeiba-run-item__race"><strong>${escapeHtml(raceLabel || '過去走')}</strong></div>
          <div class="netkeiba-run-item__sub">${escapeHtml([distanceLabel, run.going, run.weather].filter(Boolean).join(' / '))}</div>
          <div class="netkeiba-run-item__meta">人気 ${escapeHtml(fmt(run.popularity))} / 単勝 ${escapeHtml(fmtNum(run.win_odds, 1))} / 上がり ${escapeHtml(fmtNum(run.last3f, 1))} / 通過 ${escapeHtml(fmt(run.passing))}</div>
          <div class="netkeiba-run-item__meta">騎手 ${escapeHtml(fmt(run.jockey))} / 着差 ${escapeHtml(fmt(run.margin))} / タイム ${escapeHtml(fmt(run.time))}</div>
        </div>
        <div class="netkeiba-run-item__result ${run.finish !== null && run.finish <= 3 ? 'is-good' : ''}">${escapeHtml(fmt(run.finish))}</div>
      </article>`;
  }

  function buildPastRunsBlock(horse, cardId) {
    const total = horse.past_runs.length;
    const current = state.pastVisibleByCard[cardId] || Math.min(5, total || 5);
    const visible = horse.past_runs.slice(0, current);
    const canMore = total > current;
    return `
      <section class="horse-detail-section">
        <div class="horse-detail-section__head">
          <h4 class="detail-box__title">過去走</h4>
          <div class="section-subtitle">新しい順に縦表示 / ${escapeHtml(String(Math.min(current, total)))}件表示${total ? ` / 全${escapeHtml(String(total))}件` : ''}</div>
        </div>
        <div class="horse-run-list">${visible.length ? visible.map(renderRunItem).join('') : '<div class="section-subtitle">過去走データなし</div>'}</div>
        <div class="horse-run-actions">
          ${canMore ? `<button type="button" class="action-link" data-more-runs="${escapeHtml(cardId)}">さらに5件見る</button>` : ''}
          ${current > 5 ? `<button type="button" class="action-link" data-reset-runs="${escapeHtml(cardId)}">5件表示に戻す</button>` : ''}
          <a class="action-link" href="${escapeHtml(buildPageUrl('past', state.data.race))}">過去走比較ページへ</a>
        </div>
      </section>`;
  }

  function renderHorseList() {
    const root = qs('#horse-list');
    if (!root) return;
    if (!state.filtered.length) {
      root.innerHTML = '<div class="empty-panel">条件に合う馬が見つからへんかった。</div>';
      return;
    }

    root.innerHTML = state.filtered.map((horse) => {
      const id = `horse-card-${escapeHtml(String(horse.umaban || horse.horse_name || Math.random()))}`;
      const isOpen = state.openCards.has(id);
      const marks = [];
      if (horse._norm.pred_order === 1) marks.push('<span class="badge badge--blue">本命候補</span>');
      if (horse._analysis.hole_label) marks.push(`<span class="${badgeClassByLabel(horse._analysis.hole_label)}">${escapeHtml(horse._analysis.hole_label)}</span>`);
      if (horse._analysis.danger_label) marks.push(`<span class="${badgeClassByLabel(horse._analysis.danger_label)}">${escapeHtml(horse._analysis.danger_label)}</span>`);
      if (horse._analysis.popular_label) marks.push(`<span class="${badgeClassByLabel(horse._analysis.popular_label)}">${escapeHtml(horse._analysis.popular_label)}</span>`);
      if (horse._norm.style_est) marks.push(`<span class="badge badge--plain">${escapeHtml(horse._norm.style_est)}</span>`);

      return `
        <article class="horse-card sheet" data-card-id="${id}">
          <div class="horse-card__main">
            <div class="horse-card__left">
              <div class="horse-card__head">
                <div class="horse-no">${escapeHtml(fmt(horse.umaban))}</div>
                <div class="horse-name-line">
                  <h3 class="horse-name">${escapeHtml(horse.horse_name)}</h3>
                </div>
              </div>
              <div class="tag-list" style="margin-top:8px;">
                <span class="badge badge--plain">性齢 ${escapeHtml(formatSexAgeLong(horse.sex_age))}</span>
                <span class="badge badge--plain">斤量 ${escapeHtml(fmtNum(horse.burden_weight, 1))}</span>
                <span class="badge badge--plain">騎手 ${escapeHtml(fmt(horse.jockey))}</span>
              </div>
              <div class="tag-list" style="margin-top:10px;">${marks.join('')}</div>
            </div>

            <div class="horse-summary-metrics">
              <div class="metric-box">
                <div class="metric-box__label">人気 (オッズ)</div>
                <div class="metric-box__value">${escapeHtml(fmt(horse._norm.popularity))} (${escapeHtml(fmtOdds(horse._norm.tansho_odds))})</div>
              </div>

              <div class="metric-box">
                <div class="metric-box__label">AI/適正</div>
                <div class="metric-box__value">${escapeHtml(fmt(horse._norm.pred_order))}/${escapeHtml(fmt(horse._norm.course_adv_rank))}</div>
              </div>
            </div>

            <div class="horse-card__aside">
              <button type="button" class="horse-toggle" data-card-id="${id}">${isOpen ? '詳細を閉じる' : '詳細を見る'}</button>
            </div>
          </div>

          <div class="horse-card__details" ${isOpen ? '' : 'hidden'}>
            <div class="horse-detail-grid">
              <div class="detail-box">
                <h4 class="detail-box__title">予想メモ</h4>
                <div class="detail-kv">
                  <div class="detail-kv__item">
                    <div class="detail-kv__label">前走要約</div>
                    <div class="detail-kv__value">${escapeHtml(buildLastRunBrief(horse))}</div>
                  </div>
                  <div class="detail-kv__item">
                    <div class="detail-kv__label">近3走要約</div>
                    <div class="detail-kv__value">${escapeHtml(buildRecentBrief(horse))}</div>
                  </div>
                  <div class="detail-kv__item">
                    <div class="detail-kv__label">プラス要素</div>
                    <div class="detail-kv__value">${escapeHtml(buildPositiveMemo(horse))}</div>
                  </div>
                  <div class="detail-kv__item">
                    <div class="detail-kv__label">マイナス要素</div>
                    <div class="detail-kv__value">${escapeHtml(buildNegativeMemo(horse))}</div>
                  </div>
                  <div class="detail-kv__item">
                    <div class="detail-kv__label">年齢性別 / 脚質</div>
                    <div class="detail-kv__value">${escapeHtml(formatSexAgeLong(horse.sex_age))} / ${escapeHtml(fmt(horse._norm.style_est))}</div>
                  </div>
                  <div class="detail-kv__item">
                    <div class="detail-kv__label">父血統 / 母父血統</div>
                    <div class="detail-kv__value">${escapeHtml(fmt(horse.sire))} / ${escapeHtml(fmt(horse.dam_sire))}</div>
                  </div>
                  <div class="detail-kv__item">
                    <div class="detail-kv__label">同距離 / 同コース / 同競馬場</div>
                    <div class="detail-kv__value">${escapeHtml(fmt(horse._norm.same_distance_count))}走 / ${escapeHtml(fmt(horse._norm.same_course_count))}走 / ${escapeHtml(fmt(horse._norm.same_place_count))}走</div>
                  </div>
                  <div class="detail-kv__item">
                    <div class="detail-kv__label">休み明け / 近3走掲示板</div>
                    <div class="detail-kv__value">${escapeHtml(formatLayoff(horse._norm.layoff_days))} / ${escapeHtml(fmt(horse._norm.recent_top3_count))}回</div>
                  </div>
                </div>
              </div>

              <div class="detail-box">
                <h4 class="detail-box__title">モデル比較</h4>
                <div class="model-rank-list">
                  <div class="model-rank-item">
                    <div>
                      <div class="model-rank-item__name">総合AI</div>
                      <div class="model-rank-item__meta">勝率 ${escapeHtml(fmtPct01(horse._norm.p_win))} / 複勝率 ${escapeHtml(fmtPct01(horse._norm.p_top3))}</div>
                    </div>
                    <div class="model-rank-item__rank">${escapeHtml(fmt(horse._norm.pred_order))}位</div>
                  </div>
                  <div class="model-rank-item">
                    <div>
                      <div class="model-rank-item__name">コース適性</div>
                      <div class="model-rank-item__meta">スコア ${escapeHtml(fmtNum(horse._norm.course_adv_score, 1))}</div>
                    </div>
                    <div class="model-rank-item__rank">${escapeHtml(fmt(horse._norm.course_adv_rank))}位</div>
                  </div>
                  ${state.data.modelYears.map((year) => `
                    <div class="model-rank-item">
                      <div>
                        <div class="model-rank-item__name">${escapeHtml(year)}モデル</div>
                        <div class="model-rank-item__meta">スコア ${escapeHtml(fmtNum(getModelScore(horse, year), 3))}</div>
                      </div>
                      <div class="model-rank-item__rank">${escapeHtml(fmt(getModelRank(horse, year)))}位</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>

            ${buildPastRunsBlock(horse, id)}
          </div>
        </article>
      `;
    }).join('');

    qsa('.horse-toggle', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        const cardId = btn.dataset.cardId;
        if (!cardId) return;
        if (state.openCards.has(cardId)) state.openCards.delete(cardId);
        else {
          state.openCards.add(cardId);
          if (!state.pastVisibleByCard[cardId]) {
            const horse = state.filtered.find((h) => `horse-card-${String(h.umaban || h.horse_name)}` === cardId);
            state.pastVisibleByCard[cardId] = Math.min(5, horse?.past_runs?.length || 5);
          }
        }
        renderHorseList();
      });
    });

    qsa('[data-more-runs]', root).forEach((btn) => btn.addEventListener('click', () => {
      const cardId = btn.dataset.moreRuns;
      const horse = state.filtered.find((h) => `horse-card-${String(h.umaban || h.horse_name)}` === cardId);
      const total = horse?.past_runs?.length || 0;
      state.pastVisibleByCard[cardId] = Math.min((state.pastVisibleByCard[cardId] || 5) + 5, total);
      renderHorseList();
    }));

    qsa('[data-reset-runs]', root).forEach((btn) => btn.addEventListener('click', () => {
      const cardId = btn.dataset.resetRuns;
      state.pastVisibleByCard[cardId] = 5;
      renderHorseList();
    }));
  }

  async function init() {
    baseLayout();
    setStatus('レース情報を読み込み中…');
    try {
      const raw = await fetchJson(getJsonPath());
      const prepared = prepareRaceData(raw);
      state.data = analyzeRace(prepared);
      clearStatus();
      renderHero(state.data);
      renderPredictionSummary(state.data);
      renderDivergence(state.data);
      renderSkipPanel(state.data);
      renderFilters();
      applyFiltersAndRenderList();
    } catch (err) {
      console.error(err);
      setStatus(err?.message || 'race.js の初期化に失敗しました。', true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
