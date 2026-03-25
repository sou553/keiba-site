
(() => {
  const state = {
    dates: [],
    selectedDate: null,
    races: [],
    filtered: []
  };

  const $ = (sel) => document.querySelector(sel);
  const params = new URLSearchParams(location.search);

  function esc(v){return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
  function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
  function pct(v){ const n=toNum(v); return n===null? "—" : `${Math.round(n*1000)/10}%`; }
  function odds(v){ const n=toNum(v); return n===null? "—" : `${Math.round(n*10)/10}`; }
  function dataRoot(){ return document.body.dataset.dataRoot || "./data"; }

  async function fetchJSON(path){
    const res = await fetch(path, {cache:"no-cache"});
    if(!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
    return await res.json();
  }

  function buildDateTabs(){
    const root = $("#date-tabs");
    root.innerHTML = state.dates.map(d => {
      const active = d.race_date === state.selectedDate ? " is-active" : "";
      return `<a class="nk-tab${active}" href="?date=${encodeURIComponent(d.race_date)}">${esc(d.race_date)} <small style="margin-left:6px;opacity:.8">${esc(d.race_count)}R</small></a>`;
    }).join("");
  }

  function fillCourseFilter(){
    const select = $("#course-filter");
    const current = select.value;
    const courses = [...new Set(state.races.map(r => r.course).filter(Boolean))].sort();
    select.innerHTML = `<option value="">すべて</option>` + courses.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    select.value = current;
  }

  function applyFilter(){
    const q = ($("#search-input").value || "").trim().toLowerCase();
    const course = $("#course-filter").value;
    const oddsOnly = $("#odds-only").checked;

    state.filtered = state.races.filter(r => {
      const hay = [
        r.race_name, r.course, r.course_name,
        ...(r.top_ai || []).map(x => x.horse_name)
      ].join(" ").toLowerCase();

      if (q && !hay.includes(q)) return false;
      if (course && r.course !== course) return false;
      if (oddsOnly) {
        const hasOdds = (r.top_ai || []).some(x => toNum(x.tansho_odds) !== null);
        if (!hasOdds) return false;
      }
      return true;
    });

    renderList();
  }

  function renderList(){
    $("#list-caption").textContent = `${state.selectedDate || "-"} / ${state.filtered.length}件表示 / 全${state.races.length}R`;
    const root = $("#race-list");
    root.innerHTML = state.filtered.map(r => {
      const ai1 = (r.top_ai || [])[0] || null;
      const ai2 = (r.top_ai || [])[1] || null;
      const ai3 = (r.top_ai || [])[2] || null;
      const tags = [r.course, r.surface, r.distance ? `${r.distance}m` : null, r.headcount ? `${r.headcount}頭` : null].filter(Boolean);

      return `
      <article class="nk-card nk-race-row">
        <div class="nk-race-main">
          <div class="nk-race-date">${esc(state.selectedDate)}</div>
          <div class="nk-race-title">${esc(r.race_no ?? "")}R ${esc(r.race_name ?? "")}</div>
          <div class="nk-race-meta">${esc(r.course ?? "-")} / ${esc(r.surface ?? "-")} / ${esc(r.distance ?? "-")}m / ${esc(r.headcount ?? "-")}頭</div>
          <div class="nk-tags">
            <span class="nk-chip">race_id ${esc(r.race_id)}</span>
            ${tags.map(t => `<span class="nk-chip nk-chip--paper">${esc(t)}</span>`).join("")}
          </div>
        </div>

        <div class="nk-race-summary">
          <span class="nk-race-summary-badge">AI本線</span>
          ${ai1 ? `<div class="nk-race-summary-main">◎ ${esc(ai1.umaban)} ${esc(ai1.horse_name)}</div>
          <div class="nk-race-summary-meta">勝率 ${pct(ai1.p_win)} / 複勝率 ${pct(ai1.p_top3)} / 単勝 ${odds(ai1.tansho_odds)} / 人気 ${esc(ai1.popularity ?? "—")}</div>` : `<div class="nk-race-summary-main">上位馬情報なし</div>`}
          ${(ai2 || ai3) ? `<div class="nk-race-summary-meta" style="margin-top:8px">相手: ${[ai2,ai3].filter(Boolean).map(x => `${esc(x.umaban)} ${esc(x.horse_name)}`).join(" / ")}</div>` : ""}
        </div>

        <div class="nk-race-actions">
          <a class="nk-btn nk-btn--primary" href="./race_detail.html?date=${encodeURIComponent(state.selectedDate)}&race_id=${encodeURIComponent(r.race_id)}">出走馬一覧</a>
          <a class="nk-btn" href="./past_detail.html?date=${encodeURIComponent(state.selectedDate)}&race_id=${encodeURIComponent(r.race_id)}">過去走比較</a>
          <a class="nk-btn" href="./betting.html?date=${encodeURIComponent(state.selectedDate)}&race_id=${encodeURIComponent(r.race_id)}">買い目作成</a>
        </div>
      </article>`;
    }).join("");
  }

  async function init(){
    const idx = await fetchJSON(`${dataRoot()}/index.json`);
    state.dates = idx.dates || [];
    state.selectedDate = params.get("date") || state.dates[0]?.race_date || null;
    buildDateTabs();

    if (!state.selectedDate) {
      $("#list-caption").textContent = "日付データがありません";
      return;
    }
    const daily = await fetchJSON(`${dataRoot()}/${state.selectedDate}/races.json`);
    state.races = daily.races || [];
    fillCourseFilter();
    applyFilter();

    $("#search-input").addEventListener("input", applyFilter);
    $("#course-filter").addEventListener("change", applyFilter);
    $("#odds-only").addEventListener("change", applyFilter);
    $("#reset-filter").addEventListener("click", () => {
      $("#search-input").value = "";
      $("#course-filter").value = "";
      $("#odds-only").checked = false;
      applyFilter();
    });
  }

  init().catch(err => {
    console.error(err);
    $("#list-caption").textContent = "読み込みに失敗しました";
  });
})();
