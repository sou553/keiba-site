(function (global) {
  function toNum(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function round1(v) {
    return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  }

  function pct(v) {
    const n = toNum(v);
    return n === null ? "—" : `${round1(n * 100)}%`;
  }

  function odds(v) {
    const n = toNum(v);
    return n === null ? "—" : `${round1(n)}`;
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', '&quot;')
      .replaceAll("'", "&#39;");
  }

  function qs() {
    return new URLSearchParams(location.search);
  }

  function getDateAndRaceId() {
    const p = qs();
    return {
      date: p.get("date") || "",
      raceId: p.get("race_id") || ""
    };
  }

  function sortByPredThenTop3(a, b) {
    const ap = toNum(a.pred_order) ?? 999;
    const bp = toNum(b.pred_order) ?? 999;
    if (ap !== bp) return ap - bp;
    const at = toNum(a.p_top3) ?? -1;
    const bt = toNum(b.p_top3) ?? -1;
    if (at !== bt) return bt - at;
    const aw = toNum(a.p_win) ?? -1;
    const bw = toNum(b.p_win) ?? -1;
    return bw - aw;
  }

  function getRaceLabel(race) {
    return [race.course, race.surface, race.distance ? `${race.distance}m` : null, race.headcount ? `${race.headcount}頭` : null]
      .filter(Boolean)
      .join(" / ");
  }

  function getNavHtml(date, raceId, active) {
    const tabs = [
      { key: "race", label: "出走馬一覧", href: `./race_detail.html?date=${encodeURIComponent(date)}&race_id=${encodeURIComponent(raceId)}` },
      { key: "past", label: "過去走比較", href: `./past_detail.html?date=${encodeURIComponent(date)}&race_id=${encodeURIComponent(raceId)}` },
      { key: "bet", label: "買い目作成", href: `./betting.html?date=${encodeURIComponent(date)}&race_id=${encodeURIComponent(raceId)}` }
    ];
    return tabs.map(t => `<a class="page-tab ${t.key === active ? 'is-active' : ''}" href="${t.href}">${escapeHtml(t.label)}</a>`).join("");
  }

  function classifyPopularHorseDetailed(horse) {
    const popularity = toNum(horse.popularity);
    const predOrder = toNum(horse.pred_order);
    const courseRank = toNum(horse.course_adv_rank);
    const pTop3 = toNum(horse.p_top3);
    const pWin = toNum(horse.p_win);

    if (popularity === null || popularity > 5) {
      return { label: null, reason: "" };
    }

    const aiGap = predOrder !== null ? predOrder - popularity : 0;
    const courseGap = courseRank !== null ? courseRank - popularity : 0;
    let weak = 0;
    if (aiGap >= 3) weak += 1;
    if (courseGap >= 4) weak += 1;
    if (pTop3 !== null && pTop3 < 0.35) weak += 1;
    if (pWin !== null && pWin < 0.08) weak += 1;

    const reliable =
      predOrder !== null && predOrder <= popularity + 1 &&
      (courseRank === null || courseRank <= popularity + 2) &&
      pTop3 !== null && pTop3 >= 0.55;

    let label = "妥当";
    if (reliable) label = "信頼";
    else if (weak >= 3 || aiGap >= 4 || courseGap >= 6 || (pTop3 !== null && pTop3 < 0.20)) label = "危険";
    else if (weak >= 2 || (aiGap >= 3 && courseGap >= 3)) label = popularity <= 2 ? "妥当" : "やや危険";

    const reasons = [];
    if (predOrder !== null) reasons.push(`AI${predOrder}位`);
    if (courseRank !== null) reasons.push(`適性${courseRank}位`);
    if (pTop3 !== null) reasons.push(`複勝率${pct(pTop3)}`);
    return { label, reason: reasons.join(" / ") };
  }

  function classifySummaryHole(horse) {
    const popularity = toNum(horse.popularity);
    const predOrder = toNum(horse.pred_order);
    const courseRank = toNum(horse.course_adv_rank);
    const pTop3 = toNum(horse.p_top3);
    const pWin = toNum(horse.p_win);
    const gapAi = popularity !== null && predOrder !== null ? popularity - predOrder : null;
    const gapCourse = popularity !== null && courseRank !== null ? popularity - courseRank : null;
    const ok = popularity !== null && popularity >= 6 && ((gapAi !== null && gapAi >= 3) || (gapCourse !== null && gapCourse >= 4)) && pTop3 !== null && pTop3 >= 0.25;
    if (!ok) return null;
    const score = (gapAi ?? 0) * 0.6 + (gapCourse ?? 0) * 0.4 + (pTop3 ?? 0) * 10 + (pWin ?? 0) * 5;
    return { score, reason: `軽穴 / 人気よりAIか適性が上 / 複勝率${pct(pTop3)} / 単勝${odds(horse.tansho_odds)}` };
  }

  function classifySummaryDanger(horse) {
    const popularity = toNum(horse.popularity);
    const predOrder = toNum(horse.pred_order);
    const courseRank = toNum(horse.course_adv_rank);
    const pTop3 = toNum(horse.p_top3);
    const overAi = popularity !== null && predOrder !== null ? predOrder - popularity : null;
    const overCourse = popularity !== null && courseRank !== null ? courseRank - popularity : null;
    const ok = popularity !== null && popularity <= 5 && ((overAi !== null && overAi >= 3) || (overCourse !== null && overCourse >= 4)) && pTop3 !== null && pTop3 <= 0.45;
    if (!ok) return null;
    const score = (overAi ?? 0) * 0.6 + (overCourse ?? 0) * 0.4 + ((0.5 - (pTop3 ?? 0)) * 10);
    return { score, reason: `人気よりAIか適性が下 / 複勝率${pct(pTop3)}` };
  }

  function buildSimpleGapPanels(horses) {
    const aiValue = [];
    const aiDanger = [];
    const courseValue = [];
    const courseDanger = [];

    horses.forEach((horse) => {
      const popularity = toNum(horse.popularity);
      const predOrder = toNum(horse.pred_order);
      const courseRank = toNum(horse.course_adv_rank);
      if (popularity === null) return;

      if (predOrder !== null) {
        const gap = popularity - predOrder;
        if (popularity >= 6 && gap >= 5 && predOrder <= 3) {
          aiValue.push({ horse, score: gap, meta: `人気${popularity} / AI${predOrder} / 複勝率${pct(horse.p_top3)}` });
        }
        const dangerGap = predOrder - popularity;
        if (popularity <= 5 && dangerGap >= 5) {
          aiDanger.push({ horse, score: -dangerGap, meta: `人気${popularity} / AI${predOrder} / 複勝率${pct(horse.p_top3)}` });
        }
      }

      if (courseRank !== null) {
        const gap = popularity - courseRank;
        if (popularity >= 6 && gap >= 5 && courseRank <= 3) {
          courseValue.push({ horse, score: gap, meta: `人気${popularity} / 適性${courseRank} / 複勝率${pct(horse.p_top3)}` });
        }
        const dangerGap = courseRank - popularity;
        if (popularity <= 5 && dangerGap >= 5) {
          courseDanger.push({ horse, score: -dangerGap, meta: `人気${popularity} / 適性${courseRank} / 複勝率${pct(horse.p_top3)}` });
        }
      }
    });

    aiValue.sort((a, b) => b.score - a.score);
    aiDanger.sort((a, b) => a.score - b.score);
    courseValue.sort((a, b) => b.score - a.score);
    courseDanger.sort((a, b) => a.score - b.score);

    return {
      aiValue: aiValue.slice(0, 3),
      aiDanger: aiDanger.slice(0, 3),
      courseValue: courseValue.slice(0, 3),
      courseDanger: courseDanger.slice(0, 3)
    };
  }

  function buildRaceSummary(horses) {
    const sorted = [...horses].sort(sortByPredThenTop3);
    const main = sorted[0] || null;
    const line = sorted.slice(1, 3);
    const holeCandidates = horses
      .map(h => ({ horse: h, result: classifySummaryHole(h) }))
      .filter(x => x.result)
      .sort((a, b) => b.result.score - a.result.score);
    const dangerCandidates = horses
      .map(h => ({ horse: h, result: classifySummaryDanger(h) }))
      .filter(x => x.result)
      .sort((a, b) => b.result.score - a.result.score);
    const popularSummary = horses
      .filter(h => toNum(h.popularity) !== null && toNum(h.popularity) <= 5)
      .sort((a, b) => (toNum(a.popularity) ?? 99) - (toNum(b.popularity) ?? 99))
      .map(h => ({ horse: h, ...classifyPopularHorseDetailed(h) }));

    const p1 = toNum(main?.p_top3) ?? 0;
    const w1 = toNum(main?.p_win) ?? 0;
    const w2 = toNum(sorted[1]?.p_win) ?? 0;
    let status = "混戦";
    const reasons = [];
    if (p1 >= 0.70 && w1 - w2 >= 0.08 && dangerCandidates.length <= 1) {
      status = "本命寄り";
      reasons.push("総合1位の信頼度が高い");
      reasons.push("1位と2位の差が比較的大きい");
    } else if (dangerCandidates.length >= 2 || p1 < 0.50 || (w1 - w2) <= 0.03) {
      status = "見送り寄り";
      if (dangerCandidates.length >= 2) reasons.push("上位人気に強い危険人気がいる");
      if ((w1 - w2) <= 0.03) reasons.push("1位と2位の差が小さい");
      if (p1 < 0.50) reasons.push("本命の複勝率が低い");
    } else {
      reasons.push("上位評価が拮抗している");
    }

    const lineNames = line.map(x => `${x.umaban} ${x.horse_name}`).join("、");
    const comment = main
      ? `${status}。本命は${main.umaban} ${main.horse_name}${lineNames ? `。相手本線は${lineNames}` : ""}${holeCandidates[0] ? `。穴は${holeCandidates[0].horse.umaban}` : ""}${dangerCandidates[0] ? `。危険人気は${dangerCandidates[0].horse.umaban}` : ""}。`
      : "";

    return {
      status,
      reasons,
      main,
      line,
      hole: holeCandidates[0]?.horse || null,
      holeReason: holeCandidates[0]?.result.reason || "",
      danger: dangerCandidates[0]?.horse || null,
      dangerReason: dangerCandidates[0]?.result.reason || "",
      popularSummary,
      comment
    };
  }

  global.AnalysisCommon = {
    toNum,
    pct,
    odds,
    escapeHtml,
    qs,
    getDateAndRaceId,
    getRaceLabel,
    getNavHtml,
    sortByPredThenTop3,
    classifyPopularHorseDetailed,
    buildSimpleGapPanels,
    buildRaceSummary
  };
})(window);
