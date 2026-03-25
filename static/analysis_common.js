(function (global) {
  'use strict';

  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function clip(v, min = 0, max = 1) {
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
  }

  function round1(v) { return Number.isFinite(v) ? Math.round(v * 10) / 10 : null; }
  function round3(v) { return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null; }
  function fmt(v, fb = '—') { return v == null || v === '' ? fb : String(v); }
  function fmtNum(v, d = 1, fb = '—') {
    const n = toNum(v); return n == null ? fb : n.toFixed(d).replace(/\.0$/, '');
  }
  function fmtPct(v, d = 1, fb = '—') {
    const n = toNum(v); return n == null ? fb : `${(n * 100).toFixed(d).replace(/\.0$/, '')}%`;
  }
  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

  function sortByPredThenTop3(a, b) {
    const aPred = toNum(a.pred_order) ?? 9999;
    const bPred = toNum(b.pred_order) ?? 9999;
    if (aPred !== bPred) return aPred - bPred;
    const aTop3 = toNum(a.p_top3) ?? -9999;
    const bTop3 = toNum(b.p_top3) ?? -9999;
    if (aTop3 !== bTop3) return bTop3 - aTop3;
    const aWin = toNum(a.p_win) ?? -9999;
    const bWin = toNum(b.p_win) ?? -9999;
    return bWin - aWin;
  }

  function extractModelRanks(horse) {
    const ranks = [];
    if (horse && horse.model_scores && typeof horse.model_scores === 'object') {
      Object.values(horse.model_scores).forEach((m) => {
        if (!m || typeof m !== 'object') return;
        const r = toNum(m.rank);
        if (r !== null) ranks.push(r);
      });
    }
    ['rank_2008','pred_rank_2008','ai_rank_2008','rank_2015','pred_rank_2015','ai_rank_2015','rank_2019','pred_rank_2019','ai_rank_2019','course_adv_rank','course_rank','pred_order']
      .forEach((k) => { const r = toNum(horse?.[k]); if (r !== null) ranks.push(r); });
    return ranks.filter((v, i, arr) => arr.indexOf(v) === i);
  }

  function calcAgreementScore(horse) {
    const ranks = extractModelRanks(horse);
    if (ranks.length <= 1) return 0.5;
    return clip(1 - stddev(ranks) / 5, 0, 1);
  }

  function calcDisagreementScore(horse) {
    return clip(1 - calcAgreementScore(horse), 0, 1);
  }

  function calcGaps(horse) {
    const popularity = toNum(horse.popularity);
    const predOrder = toNum(horse.pred_order);
    const courseRank = toNum(horse.course_adv_rank);
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

  function calcHoleScore(horse) {
    const { gapAi, gapCourse } = calcGaps(horse);
    const pTop3 = toNum(horse.p_top3);
    const pWin = toNum(horse.p_win);
    const score =
      0.35 * clip((gapAi ?? 0) / 8, 0, 1) +
      0.25 * clip((gapCourse ?? 0) / 8, 0, 1) +
      0.20 * clip(((pTop3 ?? 0) - 0.20) / 0.40, 0, 1) +
      0.10 * clip(((pWin ?? 0) - 0.05) / 0.20, 0, 1) +
      0.10 * calcAgreementScore(horse);
    return round3(score);
  }

  function buildHoleReason(horse) {
    const { gapAi, gapCourse } = calcGaps(horse);
    const parts = [];
    if (gapAi !== null && gapAi >= 3) parts.push(`人気よりAIが${gapAi}段上`);
    if (gapCourse !== null && gapCourse >= 4) parts.push(`人気より適性が${gapCourse}段上`);
    const pTop3 = toNum(horse.p_top3);
    if (pTop3 !== null && pTop3 >= 0.30) parts.push(`複勝率${fmtPct(pTop3)}`);
    const odds = toNum(horse.tansho_odds);
    if (odds !== null && odds >= 6) parts.push(`単勝${fmtNum(odds)}`);
    return parts.join(' / ');
  }

  function classifyHoleCandidate(horse) {
    const popularity = toNum(horse.popularity);
    const pTop3 = toNum(horse.p_top3);
    const odds = toNum(horse.tansho_odds);
    const { gapAi, gapCourse } = calcGaps(horse);
    const score = calcHoleScore(horse);
    const basicPass = popularity !== null && popularity >= 6 && ((gapAi !== null && gapAi >= 3) || (gapCourse !== null && gapCourse >= 4)) && pTop3 !== null && pTop3 >= 0.25;
    const strongPass = popularity !== null && popularity >= 8 && gapAi !== null && gapAi >= 4 && pTop3 !== null && pTop3 >= 0.35;
    const oddsPass = odds === null || (odds >= 6 && odds <= 40);
    let label = null;
    if (strongPass && score >= 0.68 && oddsPass) label = '強穴';
    else if (basicPass && score >= 0.55 && oddsPass) label = '穴候補';
    else if (basicPass && score >= 0.45 && oddsPass) label = '軽穴';
    return { isHole: !!label, label, score, reason: buildHoleReason(horse) };
  }

  function calcDangerScore(horse) {
    const { overAi, overCourse } = calcGaps(horse);
    const pTop3 = toNum(horse.p_top3);
    const pWin = toNum(horse.p_win);
    const score =
      0.35 * clip((overAi ?? 0) / 8, 0, 1) +
      0.25 * clip((overCourse ?? 0) / 8, 0, 1) +
      0.20 * clip((0.50 - (pTop3 ?? 0)) / 0.40, 0, 1) +
      0.10 * clip((0.18 - (pWin ?? 0)) / 0.18, 0, 1) +
      0.10 * calcDisagreementScore(horse);
    return round3(score);
  }

  function buildDangerReason(horse) {
    const { overAi, overCourse } = calcGaps(horse);
    const parts = [];
    if (overAi !== null && overAi >= 3) parts.push(`人気よりAIが${overAi}段下`);
    if (overCourse !== null && overCourse >= 4) parts.push(`人気より適性が${overCourse}段下`);
    const pTop3 = toNum(horse.p_top3);
    if (pTop3 !== null && pTop3 <= 0.45) parts.push(`複勝率${fmtPct(pTop3)}`);
    return parts.join(' / ');
  }

  function classifyDangerPopular(horse) {
    const popularity = toNum(horse.popularity);
    const pTop3 = toNum(horse.p_top3);
    const pWin = toNum(horse.p_win);
    const { overAi, overCourse } = calcGaps(horse);
    const score = calcDangerScore(horse);
    const basicPass = popularity !== null && popularity <= 5 && ((overAi !== null && overAi >= 3) || (overCourse !== null && overCourse >= 4)) && pTop3 !== null && pTop3 <= 0.45;
    const strongPass = popularity !== null && popularity <= 3 && overAi !== null && overAi >= 4 && overCourse !== null && overCourse >= 5 && pWin !== null && pWin <= 0.10 && pTop3 !== null && pTop3 <= 0.35;
    let label = null;
    if (strongPass && score >= 0.65) label = '強危険';
    else if (basicPass && score >= 0.52) label = '危険人気';
    else if (basicPass && score >= 0.42) label = 'やや危険';
    return { isDanger: !!label, label, score, reason: buildDangerReason(horse) };
  }

  function buildPopularHorseComment(horse, label) {
    const popularity = toNum(horse.popularity);
    const predOrder = toNum(horse.pred_order);
    const courseRank = toNum(horse.course_adv_rank);
    const pTop3 = toNum(horse.p_top3);
    const parts = [];
    if (predOrder !== null) parts.push(`AI${predOrder}位`);
    if (courseRank !== null) parts.push(`適性${courseRank}位`);
    if (pTop3 !== null) parts.push(`複勝率${fmtPct(pTop3)}`);
    if (label === 'やや危険' || label === '危険') {
      const warns = [];
      if (predOrder !== null && popularity !== null && predOrder - popularity >= 3) warns.push(label === '危険' ? 'AI順位が人気より低い' : 'AI順位やや低め');
      if (courseRank !== null && popularity !== null && courseRank - popularity >= 4) warns.push(label === '危険' ? '適性順位が人気より低い' : '適性順位やや低め');
      if (pTop3 !== null && pTop3 < 0.35) warns.push(label === '危険' ? '複勝率が低い' : '複勝率低め');
      return warns.length ? `${parts.join(' / ')} / ${warns.join('・')}` : parts.join(' / ');
    }
    return parts.join(' / ');
  }

  function classifyPopularHorse(horse) {
    const popularity = toNum(horse.popularity);
    const predOrder = toNum(horse.pred_order);
    const courseRank = toNum(horse.course_adv_rank);
    const pTop3 = toNum(horse.p_top3);
    const pWin = toNum(horse.p_win);
    const danger = classifyDangerPopular(horse);
    if (popularity === null || popularity > 5) return { label: null, comment: null, danger_score: danger.score };
    const aiGap = predOrder !== null ? predOrder - popularity : 0;
    const courseGap = courseRank !== null ? courseRank - popularity : 0;
    let weakCount = 0;
    if (aiGap >= 3) weakCount += 1;
    if (courseGap >= 4) weakCount += 1;
    if (pTop3 !== null && pTop3 < 0.35) weakCount += 1;
    if (pWin !== null && pWin < 0.08) weakCount += 1;
    if (danger.score >= 0.60) weakCount += 1;
    const isReliable = predOrder !== null && predOrder <= popularity + 1 && (courseRank === null || courseRank <= popularity + 2) && pTop3 !== null && pTop3 >= 0.55;
    const isTopPopular = popularity <= 2;
    if (isReliable) return { label: '信頼', comment: buildPopularHorseComment(horse, '信頼'), danger_score: danger.score };
    const isDanger = weakCount >= 3 || aiGap >= 4 || courseGap >= 6 || (pTop3 !== null && pTop3 < 0.20);
    if (isDanger) return { label: '危険', comment: buildPopularHorseComment(horse, '危険'), danger_score: danger.score };
    const isSlightDanger = weakCount >= 2 || (aiGap >= 3 && courseGap >= 3);
    if (isSlightDanger) {
      const label = isTopPopular ? '妥当' : 'やや危険';
      return { label, comment: buildPopularHorseComment(horse, label), danger_score: danger.score };
    }
    return { label: '妥当', comment: buildPopularHorseComment(horse, '妥当'), danger_score: danger.score };
  }

  function classifyCourseGapHorse(horse) {
    const popularity = toNum(horse.popularity);
    const courseRank = toNum(horse.course_adv_rank);
    const pTop3 = toNum(horse.p_top3);
    if (popularity === null || courseRank === null) return { type: null, label: null, score: null, gap: null, reason: null };
    const gap = popularity - courseRank;
    const reverseGap = courseRank - popularity;
    const isCourseValue = popularity >= 6 && courseRank <= 4 && gap >= 3 && pTop3 !== null && pTop3 >= 0.25;
    const isStrongCourseValue = popularity >= 8 && courseRank <= 3 && gap >= 5 && pTop3 !== null && pTop3 >= 0.30;
    const isCourseDanger = popularity <= 5 && reverseGap >= 4 && pTop3 !== null && pTop3 <= 0.45;
    const isStrongCourseDanger = popularity <= 3 && reverseGap >= 5 && pTop3 !== null && pTop3 <= 0.35;
    if (isStrongCourseValue) return { type: 'value', label: 'コース穴', score: gap, gap, reason: `人気${popularity} / 適性${courseRank} / 複勝率${fmtPct(pTop3)}` };
    if (isCourseValue) return { type: 'value', label: 'コース向き', score: gap, gap, reason: `人気${popularity} / 適性${courseRank} / 複勝率${fmtPct(pTop3)}` };
    if (isStrongCourseDanger) return { type: 'danger', label: '適性危険', score: reverseGap, gap: -reverseGap, reason: `人気${popularity} / 適性${courseRank} / 複勝率${fmtPct(pTop3)}` };
    if (isCourseDanger) return { type: 'danger', label: '人気先行', score: reverseGap, gap: -reverseGap, reason: `人気${popularity} / 適性${courseRank} / 複勝率${fmtPct(pTop3)}` };
    return { type: null, label: null, score: null, gap, reason: `人気${popularity} / 適性${courseRank}` };
  }

  function analyzeHorse(horse) {
    const hole = classifyHoleCandidate(horse);
    const danger = classifyDangerPopular(horse);
    const popular = classifyPopularHorse(horse);
    const courseGap = classifyCourseGapHorse(horse);
    return {
      ...horse,
      _analysis: {
        hole_label: hole.label,
        hole_score: hole.score,
        hole_reason: hole.reason,
        danger_label: danger.label,
        danger_score: danger.score,
        danger_reason: danger.reason,
        popular_label: popular.label,
        popular_comment: popular.comment,
        course_gap_label: courseGap.label,
        course_gap_type: courseGap.type,
        course_gap_score: courseGap.score,
        course_gap_reason: courseGap.reason,
      }
    };
  }

  function pickHorseDigest(h) {
    return {
      umaban: h.umaban,
      horse_name: h.horse_name,
      pred_order: toNum(h.pred_order),
      popularity: toNum(h.popularity),
      course_adv_rank: toNum(h.course_adv_rank),
      tansho_odds: toNum(h.tansho_odds),
      p_win: toNum(h.p_win),
      p_top3: toNum(h.p_top3),
      hole_label: h._analysis?.hole_label || null,
      danger_label: h._analysis?.danger_label || null,
      hole_reason: h._analysis?.hole_reason || null,
      danger_reason: h._analysis?.danger_reason || null,
      popular_label: h._analysis?.popular_label || null,
      popular_comment: h._analysis?.popular_comment || null,
    };
  }

  function buildSummary(sorted, holeCandidates, dangerPopulars, popularSummary, courseValueList, courseDangerList) {
    const top1 = sorted[0] || null;
    const top2 = sorted[1] || null;
    const top3 = sorted[2] || null;
    const p1win = toNum(top1?.p_win);
    const p2win = toNum(top2?.p_win);
    const p1top3 = toNum(top1?.p_top3);
    const winGap12 = p1win !== null && p2win !== null ? p1win - p2win : null;
    const dangerCount = dangerPopulars.length;
    const strongDangerCount = dangerPopulars.filter((h) => h._analysis?.danger_label === '強危険').length;
    let status = '混戦';
    const reasons = [];
    if (top1 && p1top3 !== null && p1top3 >= 0.70 && winGap12 !== null && winGap12 >= 0.08 && dangerCount <= 1) {
      status = '本命寄り';
      reasons.push('総合1位の信頼度が高い');
      reasons.push('1位と2位の差が比較的大きい');
    } else if (strongDangerCount >= 1 || dangerCount >= 2 || (winGap12 !== null && winGap12 <= 0.03) || (p1top3 !== null && p1top3 < 0.50)) {
      status = '見送り寄り';
      if (dangerCount >= 2) reasons.push('危険人気が複数いる');
      if (strongDangerCount >= 1) reasons.push('上位人気に強い危険人気がいる');
      if (winGap12 !== null && winGap12 <= 0.03) reasons.push('1位と2位の差が小さい');
      if (p1top3 !== null && p1top3 < 0.50) reasons.push('本命の複勝率が低め');
    } else {
      status = '混戦';
      reasons.push('上位評価が拮抗している');
    }
    const pieces = [];
    if (status === '本命寄り' && top1) pieces.push(`本命は${top1.umaban} ${top1.horse_name}`);
    else if (status === '見送り寄り') pieces.push('見送り寄り');
    else pieces.push('上位拮抗');
    if (top2) pieces.push(`相手本線は${top2.umaban}`);
    if (top3) pieces.push(`次点${top3.umaban}`);
    if (holeCandidates[0]) pieces.push(`穴は${holeCandidates[0].umaban}`);
    if (dangerPopulars[0]) pieces.push(`危険人気は${dangerPopulars[0].umaban}`);
    return {
      status,
      reasons,
      comment: `${pieces.join('。')}。`,
      mainHorse: top1 ? pickHorseDigest(top1) : null,
      lineHorses: [top2, top3].filter(Boolean).map(pickHorseDigest),
      holeHorses: holeCandidates.slice(0, 3).map(pickHorseDigest),
      dangerHorses: dangerPopulars.slice(0, 3).map(pickHorseDigest),
      popularSummary,
      courseValueList: courseValueList.slice(0, 3).map(pickHorseDigest),
      courseDangerList: courseDangerList.slice(0, 3).map(pickHorseDigest),
    };
  }

  function analyzeRaceHorses(horses) {
    const rows = (horses || []).filter((h) => h && h.horse_name).map(analyzeHorse);
    const sorted = [...rows].sort(sortByPredThenTop3);
    const holeCandidates = rows.filter((h) => h._analysis.hole_label).sort((a, b) => (b._analysis.hole_score ?? -999) - (a._analysis.hole_score ?? -999) || sortByPredThenTop3(a, b));
    const dangerPopulars = rows.filter((h) => h._analysis.danger_label).sort((a, b) => (b._analysis.danger_score ?? -999) - (a._analysis.danger_score ?? -999) || (toNum(a.popularity) ?? 999) - (toNum(b.popularity) ?? 999));
    const popularSummary = rows.filter((h) => { const p = toNum(h.popularity); return p !== null && p <= 5; }).sort((a, b) => (toNum(a.popularity) ?? 999) - (toNum(b.popularity) ?? 999)).map((h) => ({
      umaban: h.umaban,
      horse_name: h.horse_name,
      popularity: toNum(h.popularity),
      pred_order: toNum(h.pred_order),
      course_adv_rank: toNum(h.course_adv_rank),
      p_win: toNum(h.p_win),
      p_top3: toNum(h.p_top3),
      label: h._analysis.popular_label,
      comment: h._analysis.popular_comment,
    }));
    const courseValueList = rows.filter((h) => h._analysis.course_gap_type === 'value').sort((a, b) => (b._analysis.course_gap_score ?? -999) - (a._analysis.course_gap_score ?? -999));
    const courseDangerList = rows.filter((h) => h._analysis.course_gap_type === 'danger').sort((a, b) => (b._analysis.course_gap_score ?? -999) - (a._analysis.course_gap_score ?? -999));
    return {
      horses: rows,
      sorted,
      holeCandidates,
      dangerPopulars,
      popularSummary,
      courseValueList,
      courseDangerList,
      summary: buildSummary(sorted, holeCandidates, dangerPopulars, popularSummary, courseValueList, courseDangerList),
    };
  }

  global.RaceAnalysis = {
    toNum, clip, fmt, fmtNum, fmtPct, esc, round1, round3,
    classifyHoleCandidate, classifyDangerPopular, classifyPopularHorse, classifyCourseGapHorse,
    analyzeRaceHorses,
  };
})(window);
