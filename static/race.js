
(() => {
  const params = new URLSearchParams(location.search);
  const raceDate = params.get("date");
  const raceId = params.get("race_id");
  const dataRoot = document.body.dataset.dataRoot || "./data";

  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const pct = (v) => { const n=toNum(v); return n===null ? "—" : `${Math.round(n*1000)/10}%`; };
  const odds = (v) => { const n=toNum(v); return n===null ? "—" : `${Math.round(n*10)/10}`; };
  const fmtRank = (v) => { const n=toNum(v); return n===null ? "—" : `${n}位`; };
  const clip = (v,min=0,max=1) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
  const avg = (arr) => { const xs = arr.filter(Number.isFinite); return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; };
  const std = (arr) => { const xs = arr.filter(Number.isFinite); if(xs.length <= 1) return 0; const m=avg(xs); return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/xs.length); };

  function sortByPred(a,b){
    const ap = toNum(a.pred_order) ?? 999;
    const bp = toNum(b.pred_order) ?? 999;
    if(ap !== bp) return ap-bp;
    return (toNum(b.p_top3) ?? -1) - (toNum(a.p_top3) ?? -1);
  }

  function modelRankArray(h){
    const ranks = [];
    if(h.model_scores && typeof h.model_scores === 'object'){
      Object.values(h.model_scores).forEach(m => {
        const r = toNum(m?.rank);
        if(r !== null) ranks.push(r);
      });
    }
    const p = toNum(h.pred_order);
    if(p !== null) ranks.push(p);
    return [...new Set(ranks)];
  }
  function agreementScore(h){
    const rs = modelRankArray(h);
    if(rs.length <= 1) return 0.5;
    return clip(1 - std(rs)/5, 0, 1);
  }
  function dangerScore(h){
    const pop = toNum(h.popularity);
    const pred = toNum(h.pred_order);
    const course = toNum(h.course_adv_rank);
    const pTop3 = toNum(h.p_top3);
    const pWin = toNum(h.p_win);
    const overAi = (pred !== null && pop !== null) ? pred - pop : 0;
    const overCourse = (course !== null && pop !== null) ? course - pop : 0;
    return (
      0.35 * clip(overAi/8,0,1) +
      0.25 * clip(overCourse/8,0,1) +
      0.20 * clip((0.50 - (pTop3 ?? 0))/0.40,0,1) +
      0.10 * clip((0.18 - (pWin ?? 0))/0.18,0,1) +
      0.10 * clip(std(modelRankArray(h))/5,0,1)
    );
  }

  function classifyPopularHorse(h){
    const pop = toNum(h.popularity);
    const pred = toNum(h.pred_order);
    const course = toNum(h.course_adv_rank);
    const pTop3 = toNum(h.p_top3);
    const pWin = toNum(h.p_win);
    if(pop === null || pop > 5) return {label:null, comment:null};

    const aiGap = (pred !== null) ? pred - pop : 0;
    const courseGap = (course !== null) ? course - pop : 0;
    let weakCount = 0;
    if(aiGap >= 3) weakCount += 1;
    if(courseGap >= 4) weakCount += 1;
    if(pTop3 !== null && pTop3 < 0.35) weakCount += 1;
    if(pWin !== null && pWin < 0.08) weakCount += 1;
    if(dangerScore(h) >= 0.60) weakCount += 1;

    const reliable = pred !== null && pred <= pop + 1 && (course === null || course <= pop + 2) && pTop3 !== null && pTop3 >= 0.55;
    const topPop = pop <= 2;
    if(reliable) return {label:"信頼", comment:`AI${pred ?? "—"}位 / 適性${course ?? "—"}位 / 複勝率${pct(pTop3)}`};

    const isDanger = weakCount >= 3 || aiGap >= 4 || courseGap >= 6 || (pTop3 !== null && pTop3 < 0.20);
    if(isDanger){
      return {label:"危険", comment:`AI${pred ?? "—"}位 / 適性${course ?? "—"}位 / 複勝率${pct(pTop3)}`};
    }
    const slight = weakCount >= 2 || (aiGap >= 3 && courseGap >= 3);
    if(slight){
      const label = topPop ? "妥当" : "やや危険";
      return {label, comment:`AI${pred ?? "—"}位 / 適性${course ?? "—"}位 / 複勝率${pct(pTop3)}`};
    }
    return {label:"妥当", comment:`AI${pred ?? "—"}位 / 適性${course ?? "—"}位 / 複勝率${pct(pTop3)}`};
  }

  function classifyHole(h){
    const pop = toNum(h.popularity);
    const pred = toNum(h.pred_order);
    const course = toNum(h.course_adv_rank);
    const pTop3 = toNum(h.p_top3);
    const pWin = toNum(h.p_win);
    const gapAi = (pop !== null && pred !== null) ? pop - pred : null;
    const gapCourse = (pop !== null && course !== null) ? pop - course : null;
    const score =
      0.35 * clip(((gapAi ?? 0)/8),0,1) +
      0.25 * clip(((gapCourse ?? 0)/8),0,1) +
      0.20 * clip((((pTop3 ?? 0)-0.20)/0.40),0,1) +
      0.10 * clip((((pWin ?? 0)-0.05)/0.20),0,1) +
      0.10 * agreementScore(h);
    const ok = pop !== null && pop >= 6 && (((gapAi ?? 0) >= 3) || ((gapCourse ?? 0) >= 4)) && (pTop3 ?? 0) >= 0.25;
    if(!ok) return {label:null, score};
    if(pop >= 8 && (gapAi ?? 0) >= 4 && (pTop3 ?? 0) >= 0.35 && score >= 0.68) return {label:"強穴", score};
    if(score >= 0.55) return {label:"穴候補", score};
    if(score >= 0.45) return {label:"軽穴", score};
    return {label:null, score};
  }

  function classifyDanger(h){
    const pop = toNum(h.popularity);
    const pred = toNum(h.pred_order);
    const course = toNum(h.course_adv_rank);
    const pTop3 = toNum(h.p_top3);
    const pWin = toNum(h.p_win);
    const overAi = (pred !== null && pop !== null) ? pred - pop : null;
    const overCourse = (course !== null && pop !== null) ? course - pop : null;
    const score = dangerScore(h);
    const ok = pop !== null && pop <= 5 && (((overAi ?? 0) >= 3) || ((overCourse ?? 0) >= 4)) && (pTop3 ?? 1) <= 0.45;
    if(!ok) return {label:null, score};
    if(pop <= 3 && (overAi ?? 0) >= 4 && (overCourse ?? 0) >= 5 && (pWin ?? 1) <= 0.10 && (pTop3 ?? 1) <= 0.35 && score >= 0.65) return {label:"強危険", score};
    if(score >= 0.52) return {label:"危険人気", score};
    if(score >= 0.42) return {label:"やや危険", score};
    return {label:null, score};
  }

  // 乖離パネルはシンプル版
  function simpleAiGap(h){
    const pop = toNum(h.popularity), pred = toNum(h.pred_order);
    if(pop === null || pred === null) return null;
    const gap = pop - pred;
    if(pop >= 6 && gap >= 5 && pred <= 3) return {type:"value", score:gap, reason:`人気${pop} / AI${pred} / 複勝率${pct(h.p_top3)}`};
    if(pop <= 5 && -gap >= 5) return {type:"danger", score:gap, reason:`人気${pop} / AI${pred} / 複勝率${pct(h.p_top3)}`};
    return null;
  }

  function simpleCourseGap(h){
    const pop = toNum(h.popularity), course = toNum(h.course_adv_rank);
    if(pop === null || course === null) return null;
    const gap = pop - course;
    if(pop >= 6 && gap >= 5 && course <= 3) return {type:"value", score:gap, reason:`人気${pop} / 適性${course} / 複勝率${pct(h.p_top3)}`};
    if(pop <= 5 && -gap >= 5) return {type:"danger", score:gap, reason:`人気${pop} / 適性${course} / 複勝率${pct(h.p_top3)}`};
    return null;
  }

  function pillClass(label){
    if(label === "信頼") return "trust";
    if(label === "危険") return "danger";
    if(label === "やや危険") return "warn";
    return "neutral";
  }

  function statusText(rows, dangerRows){
    const top1 = rows[0], top2 = rows[1];
    const p1 = toNum(top1?.p_win), p2 = toNum(top2?.p_win), t1 = toNum(top1?.p_top3);
    const gap = (p1 !== null && p2 !== null) ? p1-p2 : null;
    const strongDanger = dangerRows.filter(h => h._danger?.label === "強危険").length;
    if(top1 && t1 !== null && t1 >= 0.70 && gap !== null && gap >= 0.08 && dangerRows.length <= 1){
      return {status:"本命寄り", reasons:["総合1位の信頼度が高い","1位と2位の差が比較的大きい"]};
    }
    if(strongDanger >= 1 || dangerRows.length >= 2 || (gap !== null && gap <= 0.03) || (t1 !== null && t1 < 0.50)){
      const rs = [];
      if(dangerRows.length >= 2) rs.push("上位人気に強い危険人気がいる");
      if(gap !== null && gap <= 0.03) rs.push("1位と2位の差が小さい");
      if(t1 !== null && t1 < 0.50) rs.push("本命の複勝率が低め");
      return {status:"見送り寄り", reasons:rs.length ? rs : ["上位評価が割れている"]};
    }
    return {status:"混戦", reasons:["上位評価が拮抗している"]};
  }

  function renderHead(data){
    const race = data.race || {};
    $("#race-head").innerHTML = `
      <div class="nk-race-date">${esc(data.race_date ?? raceDate ?? "")}</div>
      <div class="nk-race-title">${esc(race.race_no ?? "")}R ${esc(race.race_name ?? "")}</div>
      <div class="nk-race-meta">${esc(race.course ?? "-")} / ${esc(race.surface ?? "-")} / ${esc(race.distance ?? "-")}m / ${esc(race.headcount ?? "-")}頭</div>
      <div class="nk-tags" style="margin-top:10px">
        <span class="nk-chip">race_id ${esc(race.race_id ?? raceId ?? "")}</span>
      </div>
    `;
    $("#tab-race").href = `./race_detail.html?date=${encodeURIComponent(data.race_date || raceDate)}&race_id=${encodeURIComponent(race.race_id || raceId)}`;
    $("#tab-past").href = `./past_detail.html?date=${encodeURIComponent(data.race_date || raceDate)}&race_id=${encodeURIComponent(race.race_id || raceId)}`;
    $("#tab-betting").href = `./betting.html?date=${encodeURIComponent(data.race_date || raceDate)}&race_id=${encodeURIComponent(race.race_id || raceId)}`;
  }

  function renderSummary(rows, statusObj, holes, dangers){
    const top1 = rows[0], top2 = rows[1], top3 = rows[2];
    $("#summary-panel").innerHTML = top1 ? `
      <div class="nk-main-head">
        <div>
          <div class="nk-section-title">予想まとめ</div>
          <div class="nk-section-sub">本命・相手本線・穴候補・危険人気を最初に確認できる形に整理</div>
        </div>
        <span class="nk-status status-${esc(statusObj.status)}">${esc(statusObj.status)}</span>
      </div>
      <div class="nk-main-name">◎ ${esc(top1.umaban)} ${esc(top1.horse_name)}</div>
      <div class="nk-badges">
        <span class="nk-badge nk-badge--blue">AI ${esc(top1.pred_order ?? "—")}</span>
        <span class="nk-badge">${esc(top1.popularity ?? "—")}人気</span>
        <span class="nk-badge">単勝 ${odds(top1.tansho_odds)}</span>
        <span class="nk-badge nk-badge--green">勝率 ${pct(top1.p_win)}</span>
        <span class="nk-badge nk-badge--green">複勝率 ${pct(top1.p_top3)}</span>
      </div>
    ` : `データなし`;

    $("#line-panel").innerHTML = [top2, top3].filter(Boolean).map((h, i) => `
      <div class="nk-list-row">
        <div class="nk-list-main">
          <div class="nk-list-name">${i===0 ? "○" : "▲"} ${esc(h.umaban)} ${esc(h.horse_name)}</div>
          <div class="nk-list-meta">AI${esc(h.pred_order ?? "—")} / 複勝率${pct(h.p_top3)}</div>
        </div>
      </div>
    `).join("") || `<div class="nk-muted">該当馬なし</div>`;

    $("#hole-panel").innerHTML = holes.slice(0,3).map(h => `
      <div class="nk-list-row">
        <div class="nk-list-main">
          <div class="nk-list-name">☆ ${esc(h.umaban)} ${esc(h.horse_name)}</div>
          <div class="nk-list-meta">${esc(h._hole.label)} / AI${esc(h.pred_order ?? "—")} / 複勝率${pct(h.p_top3)} / 単勝${odds(h.tansho_odds)}</div>
        </div>
      </div>
    `).join("") || `<div class="nk-muted">該当馬なし</div>`;

    $("#danger-panel").innerHTML = dangers.slice(0,3).map(h => `
      <div class="nk-list-row">
        <div class="nk-list-main">
          <div class="nk-list-name">! ${esc(h.umaban)} ${esc(h.horse_name)}</div>
          <div class="nk-list-meta">${esc(h._danger.label)} / 人気${esc(h.popularity ?? "—")} / AI${esc(h.pred_order ?? "—")} / 適性${esc(h.course_adv_rank ?? "—")} / 複勝率${pct(h.p_top3)}</div>
        </div>
      </div>
    `).join("") || `<div class="nk-muted">該当馬なし</div>`;

    $("#reason-panel").innerHTML = `
      <div class="nk-note-item">
        <div class="nk-note-title">ひとこと</div>
        <div class="nk-note-sub">${esc(commentText(top1, top2, holes, dangers, statusObj.status))}</div>
      </div>
      ${statusObj.reasons.map(r => `
        <div class="nk-note-item">
          <div class="nk-note-title">${esc(r)}</div>
          <div class="nk-note-sub">現在の人気・AI・適性・確率のバランスから判定</div>
        </div>
      `).join("")}
    `;
  }

  function commentText(top1, top2, holes, dangers, status){
    const parts = [];
    if(status === "見送り寄り") parts.push("見送り寄り");
    else if(top1) parts.push(`本命は${top1.umaban}`);
    if(top2) parts.push(`相手本線は${top2.umaban}`);
    if(holes[0]) parts.push(`穴は${holes[0].umaban}`);
    if(dangers[0]) parts.push(`危険人気は${dangers[0].umaban}`);
    return parts.join("。") + "。";
  }

  function renderPopularSummary(populars){
    $("#popular-summary").innerHTML = populars.map(h => `
      <div class="nk-list-row">
        <div class="nk-list-main">
          <div class="nk-list-name">${esc(h.popularity)}人気 ${esc(h.umaban)} ${esc(h.horse_name)}</div>
          <div class="nk-list-meta">${esc(h._popular.comment || "")}</div>
        </div>
        <span class="nk-side-pill ${pillClass(h._popular.label)}">${esc(h._popular.label || "妥当")}</span>
      </div>
    `).join("") || `<div class="nk-muted">該当馬なし</div>`;
  }

  function renderGaps(rows){
    const aiValues = rows.map(h => ({...h, _gap:simpleAiGap(h)})).filter(h => h._gap?.type === "value").sort((a,b)=>b._gap.score-a._gap.score).slice(0,3);
    const aiDangers = rows.map(h => ({...h, _gap:simpleAiGap(h)})).filter(h => h._gap?.type === "danger").sort((a,b)=>a._gap.score-b._gap.score).slice(0,3);
    const courseValues = rows.map(h => ({...h, _gap:simpleCourseGap(h)})).filter(h => h._gap?.type === "value").sort((a,b)=>b._gap.score-a._gap.score).slice(0,3);
    const courseDangers = rows.map(h => ({...h, _gap:simpleCourseGap(h)})).filter(h => h._gap?.type === "danger").sort((a,b)=>a._gap.score-b._gap.score).slice(0,3);

    $("#gap-panels").innerHTML = `
      <div class="nk-gap-panel">
        <div class="nk-gap-title">人気 × AI順位</div>
        <div class="nk-gap-subtitle">妙味馬（人気6以下・差5以上・AI3位以内）</div>
        ${aiValues.length ? aiValues.map(h => gapRow(h)).join("") : `<div class="nk-gap-empty">該当馬なし</div>`}
        <div class="nk-gap-subtitle">危険人気馬（人気5以内・差5以上）</div>
        ${aiDangers.length ? aiDangers.map(h => gapRow(h)).join("") : `<div class="nk-gap-empty">該当馬なし</div>`}
      </div>
      <div class="nk-gap-panel">
        <div class="nk-gap-title">人気 × 適性順位</div>
        <div class="nk-gap-subtitle">コース向きで人気薄（人気6以下・差5以上・適性3位以内）</div>
        ${courseValues.length ? courseValues.map(h => gapRow(h)).join("") : `<div class="nk-gap-empty">該当馬なし</div>`}
        <div class="nk-gap-subtitle">人気先行で適性弱い（人気5以内・差5以上）</div>
        ${courseDangers.length ? courseDangers.map(h => gapRow(h)).join("") : `<div class="nk-gap-empty">該当馬なし</div>`}
      </div>
    `;
  }

  function gapRow(h){
    return `
      <div class="nk-gap-row">
        <div>
          <div class="nk-gap-name">${esc(h.umaban)} ${esc(h.horse_name)}</div>
          <div class="nk-gap-meta">${esc(h._gap.reason)}</div>
        </div>
        <span class="nk-gap-score ${h._gap.score >= 0 ? "plus" : "minus"}">${h._gap.score >= 0 ? "+" : ""}${esc(h._gap.score)}</span>
      </div>
    `;
  }

  function renderHorseList(rows){
    $("#horse-list").innerHTML = rows.map(h => `
      <article class="nk-horse-card">
        <div class="nk-horse-top">
          <div>
            <div class="nk-horse-name">${esc(h.umaban)} ${esc(h.horse_name)}</div>
            <div class="nk-horse-sub">${esc(h.sex_age ?? "—")} / ${esc(h.jockey ?? "—")} / ${esc(h.trainer ?? "—")}</div>
          </div>
          <span class="nk-side-pill ${pillClass(h._popular.label || "妥当")}">${esc(h._popular.label || "妥当")}</span>
        </div>
        <div class="nk-horse-metrics">
          <span class="nk-badge nk-badge--blue">AI ${esc(h.pred_order ?? "—")}</span>
          <span class="nk-badge">適性 ${esc(h.course_adv_rank ?? "—")}</span>
          <span class="nk-badge">人気 ${esc(h.popularity ?? "—")}</span>
          <span class="nk-badge">単勝 ${odds(h.tansho_odds)}</span>
          <span class="nk-badge nk-badge--green">勝率 ${pct(h.p_win)}</span>
          <span class="nk-badge nk-badge--green">複勝率 ${pct(h.p_top3)}</span>
        </div>
        <div class="nk-horse-note">
          ${h._hole.label ? `穴評価: ${esc(h._hole.label)}。 ` : ""}
          ${h._danger.label ? `危険評価: ${esc(h._danger.label)}。 ` : ""}
          ${esc(h._popular.comment || "")}
        </div>
      </article>
    `).join("");
  }

  async function init(){
    if(!raceDate || !raceId){
      $("#race-head").textContent = "date / race_id が必要です";
      return;
    }
    const res = await fetch(`${dataRoot}/${raceDate}/race_${raceId}.json`, {cache:"no-cache"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const rows = (data.horses || []).filter(h => h && h.horse_name).map(h => ({
      ...h,
      _hole: classifyHole(h),
      _danger: classifyDanger(h),
      _popular: classifyPopularHorse(h)
    })).sort(sortByPred);

    renderHead(data);

    const populars = rows.filter(h => {
      const p = toNum(h.popularity);
      return p !== null && p <= 5;
    }).sort((a,b)=>(toNum(a.popularity)??999)-(toNum(b.popularity)??999));

    const holes = rows.filter(h => !!h._hole.label).sort((a,b)=>(b._hole.score??-1)-(a._hole.score??-1));
    const dangers = rows.filter(h => !!h._danger.label).sort((a,b)=>(b._danger.score??-1)-(a._danger.score??-1));
    const statusObj = statusText(rows, dangers);

    renderSummary(rows, statusObj, holes, dangers);
    renderPopularSummary(populars);
    renderGaps(rows);
    renderHorseList(rows);
  }

  init().catch(err => {
    console.error(err);
    $("#race-head").textContent = "読み込みに失敗しました";
  });
})();
