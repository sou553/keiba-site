(() => {
  "use strict";

  const PAGE_DEFAULTS = {
    home: "index.html",
    race: "race_detail.html",
    past: "past_detail.html",
    betting: "betting.html",
    jockeys: "jockeys.html",
  };

  const state = {
    indexData: null,
    dateEntries: [],
    selectedDate: null,
    races: [],
    raceDetails: [],
    rides: [],
    summaries: [],
    filteredSummaries: [],
    openJockeys: new Set(),
    filters: {
      keyword: "",
      course: "",
      onlyPopularRides: false,
      onlySingleDigitOdds: false,
      onlyValueRides: false,
      sortBy: "ride_count",
    },
  };

  function getDataRoot() {
    return document.body?.dataset?.dataRoot || "./data";
  }

  function getPage(kind) {
    return document.body?.dataset?.[`${kind}Page`] || PAGE_DEFAULTS[kind];
  }

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindToolbarEvents();
    setStatus("開催日一覧を読み込み中...");
    try {
      state.indexData = await loadIndex();
      state.dateEntries = normalizeDateEntries(state.indexData);
      if (!state.dateEntries.length) {
        throw new Error("開催日一覧が見つかりません。");
      }
      state.selectedDate = resolveSelectedDate(state.dateEntries);
      renderDateTabs();
      requestAnimationFrame(() => scrollActiveDateTabIntoView("auto"));
      await loadSelectedDate(state.selectedDate);
      renderDateTabs();
      requestAnimationFrame(() => scrollActiveDateTabIntoView("auto"));
    } catch (error) {
      console.error(error);
      setStatus(error.message || "ページの初期化に失敗しました。", "error");
      renderOverview([]);
      renderJockeyList([]);
    }
  }

  function cacheElements() {
    els.dateStrip = document.getElementById("jockey-date-strip");
    els.keyword = document.getElementById("jockey-keyword");
    els.courseFilter = document.getElementById("course-filter");
    els.onlyPopularRides = document.getElementById("only-popular-rides");
    els.onlySingleDigitOdds = document.getElementById("only-single-digit-odds");
    els.onlyValueRides = document.getElementById("only-value-rides");
    els.sortSelect = document.getElementById("sort-select");
    els.overview = document.getElementById("jockey-overview");
    els.status = document.getElementById("status-box");
    els.list = document.getElementById("jockey-summary-list");
  }

  function bindToolbarEvents() {
    els.keyword?.addEventListener("input", debounce((event) => {
      state.filters.keyword = String(event.target.value || "").trim().toLowerCase();
      applyAndRender();
    }, 100));

    els.courseFilter?.addEventListener("change", (event) => {
      state.filters.course = String(event.target.value || "");
      applyAndRender();
    });

    els.onlyPopularRides?.addEventListener("change", (event) => {
      state.filters.onlyPopularRides = !!event.target.checked;
      applyAndRender();
    });

    els.onlySingleDigitOdds?.addEventListener("change", (event) => {
      state.filters.onlySingleDigitOdds = !!event.target.checked;
      applyAndRender();
    });

    els.onlyValueRides?.addEventListener("change", (event) => {
      state.filters.onlyValueRides = !!event.target.checked;
      applyAndRender();
    });

    els.sortSelect?.addEventListener("change", (event) => {
      state.filters.sortBy = String(event.target.value || "ride_count");
      applyAndRender();
    });

    els.dateStrip?.addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-race-date]");
      if (!btn) return;
      const nextDate = String(btn.dataset.raceDate || "");
      if (!nextDate || nextDate === state.selectedDate) return;
      state.selectedDate = nextDate;
      state.openJockeys.clear();
      updateQuery({ date: nextDate });
      renderDateTabs();
      requestAnimationFrame(() => scrollActiveDateTabIntoView("smooth"));
      await loadSelectedDate(nextDate);
      renderDateTabs();
      requestAnimationFrame(() => scrollActiveDateTabIntoView("smooth"));
    });

    els.list?.addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-toggle-jockey]");
      if (!toggle) return;
      const jockey = String(toggle.dataset.toggleJockey || "");
      if (!jockey) return;
      if (state.openJockeys.has(jockey)) {
        state.openJockeys.delete(jockey);
      } else {
        state.openJockeys.add(jockey);
      }
      renderJockeyList(state.filteredSummaries);
    });
  }

  async function loadSelectedDate(raceDate) {
    setStatus("その日のレース一覧を読み込み中...");
    state.races = [];
    state.raceDetails = [];
    state.rides = [];
    state.summaries = [];
    state.filteredSummaries = [];
    renderOverview([]);

    try {
      const races = await loadRaceList(raceDate);
      state.races = normalizeRaceList(races, raceDate);

      if (!state.races.length) {
        setStatus("対象日のレース一覧が空です。");
        populateCourseOptions([]);
        renderOverview([]);
        renderJockeyList([]);
        return;
      }

      setStatus("各レースの騎乗情報を集計中...");
      const details = await loadRaceDetails(raceDate, state.races);
      state.raceDetails = details;

      const rides = buildRidesFromRaceDetails(details);
      state.rides = rides;
      state.summaries = buildJockeySummaries(rides);
      populateCourseOptions(rides);
      applyAndRender();
      setStatus(`${raceDate} の騎手一覧を表示中`);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "開催日の読み込みに失敗しました。", "error");
      populateCourseOptions([]);
      renderOverview([]);
      renderJockeyList([]);
    }
  }

  async function loadIndex() {
    return fetchJson(buildDataUrl("index.json"));
  }

  async function loadRaceList(raceDate) {
    return fetchJson(buildDataUrl(`${raceDate}/races.json`));
  }

  async function loadRaceDetails(raceDate, races) {
    const tasks = races.map(async (race) => {
      const candidates = buildRaceDetailCandidates(raceDate, race);
      let lastError = null;
      for (const url of candidates) {
        try {
          const detail = await fetchJson(url);
          return { raceMeta: race, detail };
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error(`race_${race.race_id}.json の読み込みに失敗しました。`);
    });

    const settled = await Promise.allSettled(tasks);
    const ok = [];
    const failed = [];

    settled.forEach((result) => {
      if (result.status === "fulfilled") ok.push(result.value);
      else failed.push(result.reason);
    });

    if (!ok.length && failed.length) {
      throw failed[0];
    }
    return ok;
  }

  function buildRidesFromRaceDetails(detailEntries) {
    const rides = [];
    detailEntries.forEach(({ raceMeta, detail }) => {
      const race = normalizeRaceMeta({ ...raceMeta, ...(detail || {}) }, state.selectedDate);
      const rawHorses = extractHorseList(detail);
      const rideList = rawHorses.map((horse) => normalizeRide(horse, race));

      fillMissingPopularityFromOdds(rideList);
      fillMissingPredOrderFromScore(rideList);
      fillMissingCourseRankFromScore(rideList);
      annotateRideLabels(rideList);

      rideList.forEach((ride) => rides.push(ride));
    });

    return rides.sort((a, b) => {
      const courseCompare = compareText(a.course, b.course);
      if (courseCompare !== 0) return courseCompare;
      if ((a.race_no ?? 99) !== (b.race_no ?? 99)) return (a.race_no ?? 99) - (b.race_no ?? 99);
      return (a.umaban ?? 99) - (b.umaban ?? 99);
    });
  }

  function buildJockeySummaries(rides) {
    const map = new Map();
    rides.forEach((ride) => {
      const key = ride.jockey || "騎手不明";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ride);
    });

    const summaries = Array.from(map.entries()).map(([jockey, jockeyRides]) => {
      const ridesSorted = [...jockeyRides].sort((a, b) => {
        const courseCompare = compareText(a.course, b.course);
        if (courseCompare !== 0) return courseCompare;
        return (a.race_no ?? 99) - (b.race_no ?? 99);
      });

      const popularCount = ridesSorted.filter((ride) => isFiniteNum(ride.popularity) && ride.popularity <= 3).length;
      const top5PopularCount = ridesSorted.filter((ride) => isFiniteNum(ride.popularity) && ride.popularity <= 5).length;
      const singleDigitCount = ridesSorted.filter((ride) => isFiniteNum(ride.tansho_odds) && ride.tansho_odds < 10).length;
      const valueRideCount = ridesSorted.filter((ride) => ride.value_label || ride.course_gap_type === "value").length;
      const dangerRideCount = ridesSorted.filter((ride) => ride.danger_label || ride.course_gap_type === "danger").length;

      const bestRide = getBestRide(ridesSorted);
      const avgPopularity = average(ridesSorted.map((ride) => ride.popularity));
      const avgOdds = average(ridesSorted.map((ride) => ride.tansho_odds));
      const avgPWin = average(ridesSorted.map((ride) => ride.p_win));
      const avgPTop3 = average(ridesSorted.map((ride) => ride.p_top3));
      const bestTop3 = maxOf(ridesSorted.map((ride) => ride.p_top3));
      const bestPWin = maxOf(ridesSorted.map((ride) => ride.p_win));
      const courses = [...new Set(ridesSorted.map((ride) => ride.course).filter(Boolean))];

      const summary = {
        jockey,
        ride_count: ridesSorted.length,
        rides: ridesSorted,
        popular_count: popularCount,
        top5_popular_count: top5PopularCount,
        single_digit_odds_count: singleDigitCount,
        value_ride_count: valueRideCount,
        danger_ride_count: dangerRideCount,
        avg_popularity: avgPopularity,
        avg_tansho_odds: avgOdds,
        avg_p_win: avgPWin,
        avg_p_top3: avgPTop3,
        best_ride: bestRide,
        best_top3: bestTop3,
        best_pwin: bestPWin,
        courses,
      };

      const dayLabel = classifyJockeyDay(summary);
      summary.summary_label = dayLabel.label;
      summary.summary_label_key = dayLabel.key;
      summary.summary_comment = dayLabel.comment;
      summary.search_blob = `${jockey} ${ridesSorted.map((ride) => `${ride.horse_name} ${ride.course}`).join(" ")}`.toLowerCase();

      return summary;
    });

    return summaries;
  }

  function annotateRideLabels(rides) {
    rides.forEach((ride) => {
      const value = classifyValueRide(ride);
      const danger = classifyDangerRide(ride);
      const popular = classifyPopularRide(ride, danger);
      const courseGap = classifyCourseGapRide(ride);

      ride.value_label = value.label;
      ride.danger_label = danger.label;
      ride.popular_label = popular.label;
      ride.course_gap_label = courseGap.label;
      ride.course_gap_type = courseGap.type;
      ride.main_label = pickMainLabel(ride);
    });
  }

  function classifyJockeyDay(summary) {
    if ((summary.popular_count >= 2 && toNum(summary.best_top3) >= 0.45) || toNum(summary.best_pwin) >= 0.20) {
      return {
        key: "strong",
        label: "勝負気配",
        comment: "人気上位や高確率の騎乗があり、その日の軸候補を含む構成です。",
      };
    }
    if (summary.single_digit_odds_count >= 1 || toNum(summary.avg_p_top3) >= 0.30) {
      return {
        key: "good",
        label: "有力馬あり",
        comment: "上位候補や1桁オッズ帯の騎乗があり、当日の質は高めです。",
      };
    }
    if (summary.value_ride_count >= 2) {
      return {
        key: "value",
        label: "穴注意",
        comment: "人気薄でも妙味がある騎乗が複数あり、相手候補として見やすい構成です。",
      };
    }
    if (summary.ride_count >= 5) {
      return {
        key: "wide",
        label: "手広く騎乗",
        comment: "騎乗数は多く、広く乗っています。上位馬の質は個別確認向きです。",
      };
    }
    return {
      key: "neutral",
      label: "強調材料少なめ",
      comment: "強い材料は多くありませんが、個別では妙味馬が混ざる可能性があります。",
    };
  }

  function applyAndRender() {
    const filtered = state.summaries.filter((summary) => {
      if (state.filters.keyword && !summary.search_blob.includes(state.filters.keyword)) {
        return false;
      }
      if (state.filters.course && !summary.courses.includes(state.filters.course)) {
        return false;
      }
      if (state.filters.onlyPopularRides && summary.popular_count <= 0) {
        return false;
      }
      if (state.filters.onlySingleDigitOdds && summary.single_digit_odds_count <= 0) {
        return false;
      }
      if (state.filters.onlyValueRides && summary.value_ride_count <= 0) {
        return false;
      }
      return true;
    });

    state.filteredSummaries = sortSummaries(filtered, state.filters.sortBy);
    renderOverview(state.filteredSummaries);
    renderJockeyList(state.filteredSummaries);
  }

  function sortSummaries(items, sortBy) {
    const summaries = [...items];
    const getters = {
      ride_count: (item) => item.ride_count,
      best_top3: (item) => toNum(item.best_top3),
      avg_top3: (item) => toNum(item.avg_p_top3),
      popular_count: (item) => item.popular_count,
      single_digit_count: (item) => item.single_digit_odds_count,
    };
    const getter = getters[sortBy] || getters.ride_count;

    summaries.sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      if (isFiniteNum(av) || isFiniteNum(bv)) {
        if ((bv ?? -Infinity) !== (av ?? -Infinity)) return (bv ?? -Infinity) - (av ?? -Infinity);
      }
      if (b.ride_count !== a.ride_count) return b.ride_count - a.ride_count;
      return compareText(a.jockey, b.jockey);
    });
    return summaries;
  }

  function renderDateTabs() {
    if (!els.dateStrip) return;
    els.dateStrip.innerHTML = state.dateEntries.map((entry) => {
      const active = entry.race_date === state.selectedDate ? " is-active" : "";
      const label = escapeHtml(entry.label || entry.race_date);
      return `<button type="button" class="jockey-date-tab${active}" data-race-date="${escapeHtml(entry.race_date)}">${label}</button>`;
    }).join("");
  }


  function scrollActiveDateTabIntoView(behavior = "auto") {
    if (!els.dateStrip) return;
    const active = els.dateStrip.querySelector(".jockey-date-tab.is-active");
    if (!active) return;

    const margin = 12;
    const tabLeft = active.offsetLeft;
    const tabRight = tabLeft + active.offsetWidth;
    const viewLeft = els.dateStrip.scrollLeft;
    const viewRight = viewLeft + els.dateStrip.clientWidth;

    let nextLeft = null;
    if (tabLeft - margin < viewLeft) {
      nextLeft = Math.max(0, tabLeft - margin);
    } else if (tabRight + margin > viewRight) {
      nextLeft = Math.max(0, tabRight - els.dateStrip.clientWidth + margin);
    }

    if (nextLeft !== null) {
      els.dateStrip.scrollTo({ left: nextLeft, behavior });
    }
  }
  function renderOverview(summaries) {
    if (!els.overview) return;
    const rideCount = summaries.reduce((sum, item) => sum + (item.ride_count || 0), 0);
    const popularCount = summaries.reduce((sum, item) => sum + (item.popular_count || 0), 0);
    const valueCount = summaries.reduce((sum, item) => sum + (item.value_ride_count || 0), 0);
    const bestTop3 = maxOf(summaries.map((item) => item.best_top3));

    const cards = [
      { label: "表示中の騎手数", value: summaries.length },
      { label: "表示中の騎乗数", value: rideCount },
      { label: "人気上位騎乗数", value: popularCount },
      { label: "最高複勝率", value: fmtPct(bestTop3) },
    ];

    els.overview.innerHTML = cards.map((card) => `
      <div class="jockey-overview-card">
        <div class="jockey-overview-card__label">${escapeHtml(card.label)}</div>
        <div class="jockey-overview-card__value">${escapeHtml(String(card.value))}</div>
      </div>
    `).join("");
  }

  function renderJockeyList(summaries) {
    if (!els.list) return;
    if (!summaries.length) {
      els.list.innerHTML = `<div class="jockey-empty">条件に合う騎手がいません。</div>`;
      return;
    }

    els.list.innerHTML = summaries.map((summary) => renderJockeyCard(summary)).join("");
  }

  function renderJockeyCard(summary) {
    const isOpen = state.openJockeys.has(summary.jockey);
    const bestRide = summary.best_ride;
    const bestRideText = bestRide
      ? `${escapeHtml(bestRide.course || "-")} ${escapeHtml(String(bestRide.race_no ?? "-"))}R ${escapeHtml(String(bestRide.umaban ?? "-"))} ${escapeHtml(bestRide.horse_name || "-")}（${escapeHtml(formatPopularity(bestRide.popularity))} ${escapeHtml(fmtOdds(bestRide.tansho_odds))}）`
      : "該当なし";

    return `
      <article class="jockey-card" data-jockey="${escapeHtml(summary.jockey)}">
        <button
          type="button"
          class="jockey-card__head"
          data-toggle-jockey="${escapeHtml(summary.jockey)}"
          aria-expanded="${isOpen ? "true" : "false"}"
        >
          <div class="jockey-card__main">
            <div class="jockey-card__name">${escapeHtml(summary.jockey)}</div>
            <div class="jockey-card__meta">
              ${summary.ride_count}鞍 / 人気上位 ${summary.popular_count} / 1桁オッズ ${summary.single_digit_odds_count}
            </div>
            <div class="jockey-card__sub">
              平均複勝率 ${escapeHtml(fmtPct(summary.avg_p_top3))} / 最高 ${escapeHtml(fmtPct(summary.best_top3))}
              ${summary.courses.length ? ` / ${escapeHtml(summary.courses.join("・"))}` : ""}
            </div>
          </div>
          <div class="jockey-card__side">
            <span class="jockey-day-label jockey-day-label--${escapeHtml(summary.summary_label_key)}">
              ${escapeHtml(summary.summary_label)}
            </span>
            <span class="jockey-card__arrow">▾</span>
          </div>
        </button>

        <div class="jockey-card__best">最高評価: ${bestRideText}</div>
        <!-- <div class="jockey-card__comment">${escapeHtml(summary.summary_comment)}</div> -->

        <div class="jockey-card__detail" ${isOpen ? "" : "hidden"}>
          ${renderRideRows(summary.rides)}
        </div>
      </article>
    `;
  }

  function renderRideRows(rides) {
    return `
      <div class="jockey-rides">
        <div class="jockey-rides__head">
          <span>会場</span>
          <span>R</span>
          <span>馬番</span>
          <span>馬名</span>
          <span>人気</span>
          <span>単勝</span>
          <span>AI</span>
          <span>適性</span>
          <span>勝率</span>
          <span>複勝率</span>
          <span>判定</span>
          <span></span>
        </div>
        <div class="jockey-rides__body">
          ${rides.map((ride) => renderRideRow(ride)).join("")}
        </div>
      </div>
    `;
  }

  function renderRideCell(label, value, extraClass = "") {
    return `
      <div class="jockey-ride-cell${extraClass ? ` ${extraClass}` : ""}" data-label="${escapeHtml(label)}">
        <span class="jockey-ride-cell__value">${value}</span>
      </div>
    `;
  }

  function renderRideRow(ride) {
    const label = ride.main_label;
    const labelClass = label.type === "value" ? "ride-pill--value"
      : label.type === "danger" ? "ride-pill--danger"
      : label.type === "popular" ? "ride-pill--popular"
      : label.type === "course" ? "ride-pill--course"
      : "";

    return `
      <article class="jockey-rides__row">
        ${renderRideCell("会場", escapeHtml(ride.course || "-"))}
        ${renderRideCell("R", `${escapeHtml(String(ride.race_no ?? "-"))}R`)}
        ${renderRideCell("馬番", escapeHtml(String(ride.umaban ?? "-")))}
        ${renderRideCell("馬名", `
          <div class="jockey-rides__horse">
            ${escapeHtml(ride.horse_name || "-")}
            <div class="jockey-rides__horse-sub">${escapeHtml(ride.title || "")}</div>
          </div>
        `, "jockey-ride-cell--horse jockey-ride-cell--full")}
        ${renderRideCell("人気", escapeHtml(formatPopularity(ride.popularity)))}
        ${renderRideCell("単勝", escapeHtml(fmtOdds(ride.tansho_odds)))}
        ${renderRideCell("AI", escapeHtml(String(ride.pred_order ?? "-")))}
        ${renderRideCell("適性", escapeHtml(String(ride.course_adv_rank ?? "-")))}
        ${renderRideCell("勝率", escapeHtml(fmtPct(ride.p_win)))}
        ${renderRideCell("複勝率", escapeHtml(fmtPct(ride.p_top3)))}
        ${renderRideCell("判定", `<span class="ride-pill ${labelClass}">${escapeHtml(label.text)}</span>`, "jockey-ride-cell--full jockey-ride-cell--pill")}
        ${renderRideCell("リンク", `<a class="ride-link" href="${escapeHtml(ride.race_url)}">レースへ</a>`, "jockey-ride-cell--full jockey-ride-cell--link")}
      </article>
    `;
  }

  function populateCourseOptions(rides) {
    if (!els.courseFilter) return;
    const current = state.filters.course;
    const courses = [...new Set(rides.map((ride) => ride.course).filter(Boolean))].sort(compareText);
    const options = ['<option value="">全会場</option>']
      .concat(courses.map((course) => `<option value="${escapeHtml(course)}"${course === current ? " selected" : ""}>${escapeHtml(course)}</option>`));
    els.courseFilter.innerHTML = options.join("");
  }

  function resolveSelectedDate(dateEntries) {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("date");
    const found = dateEntries.find((entry) => entry.race_date === requested);
    return (found || dateEntries[0]).race_date;
  }

  function normalizeDateEntries(indexData) {
    const raw = Array.isArray(indexData)
      ? indexData
      : Array.isArray(indexData?.race_dates)
        ? indexData.race_dates
        : Array.isArray(indexData?.dates)
          ? indexData.dates
          : Array.isArray(indexData?.items)
            ? indexData.items
            : [];

    const entries = raw.map((item) => {
      if (typeof item === "string" || typeof item === "number") {
        const raceDate = String(item);
        return {
          race_date: raceDate,
          label: formatDateLabel(raceDate),
        };
      }
      const raceDate = String(item.race_date || item.date || item.id || "");
      return {
        race_date: raceDate,
        label: item.label || item.display || formatDateLabel(raceDate),
        race_count: item.race_count ?? item.count ?? null,
      };
    }).filter((item) => item.race_date);

    entries.sort((a, b) => compareText(b.race_date, a.race_date));
    return entries;
  }

  function normalizeRaceList(raw, fallbackDate) {
    const list = Array.isArray(raw) ? raw
      : Array.isArray(raw?.races) ? raw.races
      : Array.isArray(raw?.items) ? raw.items
      : [];

    return list.map((item) => normalizeRaceMeta(item, fallbackDate)).filter((item) => item.race_id);
  }

  function normalizeRaceMeta(item, fallbackDate) {
    if (typeof item === "string" || typeof item === "number") {
      return {
        race_id: String(item),
        race_date: fallbackDate,
      };
    }
    const raceId = String(item.race_id || item.id || item.raceId || extractRaceId(item.path || item.file || "") || "");
    return {
      race_id: raceId,
      race_date: String(item.race_date || item.date || fallbackDate || ""),
      race_no: toNum(item.race_no ?? item.r ?? item.race_number),
      title: item.title || item.race_name || item.name || "",
      course: item.course || item.place || "",
      surface: item.surface || item.track || "",
      distance_m: toNum(item.distance_m ?? item.distance),
      turn: item.turn || "",
      field_size: toNum(item.field_size ?? item.headcount ?? item.horses_count),
      path: item.path || item.file || "",
    };
  }

  function extractHorseList(detail) {
    if (Array.isArray(detail?.horses)) return detail.horses;
    if (Array.isArray(detail?.entries)) return detail.entries;
    if (Array.isArray(detail?.runners)) return detail.runners;
    if (Array.isArray(detail?.items)) return detail.items;
    return [];
  }

  function normalizeRide(horse, race) {
    const odds = firstNum(
      horse?.tansho_odds,
      horse?.win_odds,
      horse?.odds,
      horse?._norm?.tansho_odds,
      horse?._norm?.win_odds
    );

    const pWin = firstNum(
      horse?.p_win,
      horse?.p1_win,
      horse?.win_prob,
      horse?._norm?.p_win
    );

    const pTop3 = firstNum(
      horse?.p_top3,
      horse?.top3_prob,
      horse?._norm?.p_top3
    );

    const predOrder = firstNum(
      horse?.pred_order,
      horse?.rank,
      horse?._norm?.pred_order,
      horse?.ai_rank
    );

    const courseAdvRank = firstNum(
      horse?.course_adv_rank,
      horse?.course_rank,
      horse?._norm?.course_adv_rank
    );

    const courseAdvScore = firstNum(
      horse?.course_adv_score,
      horse?.course_score,
      horse?._norm?.course_adv_score,
      horse?.score_pt
    );

    const popularity = firstNum(
      horse?.popularity,
      horse?.popular,
      horse?._norm?.popularity
    );

    return {
      race_id: race.race_id,
      race_date: race.race_date,
      course: race.course,
      race_no: race.race_no,
      title: race.title,
      surface: race.surface,
      distance_m: race.distance_m,
      turn: race.turn,
      field_size: race.field_size,

      jockey: String(horse?.jockey || horse?.rider || horse?.jockey_name || "").trim(),
      horse_name: String(horse?.horse_name || horse?.name || "").trim(),
      umaban: toNum(horse?.umaban ?? horse?.horse_no ?? horse?.number),
      waku: toNum(horse?.waku ?? horse?.frame_no ?? horse?.frame),
      sex_age: String(horse?.sex_age || horse?.sexage || "").trim(),
      burden_weight: firstNum(horse?.burden_weight, horse?.斤量, horse?.weight_carried),

      popularity,
      tansho_odds: odds,
      pred_order: predOrder,
      course_adv_rank: courseAdvRank,
      course_adv_score: courseAdvScore,
      p_win: pWin,
      p_top3: pTop3,

      race_url: buildRaceUrl(race.race_date, race.race_id),
    };
  }

  function fillMissingPopularityFromOdds(rides) {
    const candidates = rides.filter((ride) => !isFiniteNum(ride.popularity) && isFiniteNum(ride.tansho_odds) && ride.tansho_odds > 0);
    if (!candidates.length) return;
    const sorted = [...rides]
      .filter((ride) => isFiniteNum(ride.tansho_odds) && ride.tansho_odds > 0)
      .sort((a, b) => a.tansho_odds - b.tansho_odds);

    sorted.forEach((ride, idx) => {
      if (!isFiniteNum(ride.popularity)) {
        ride.popularity = idx + 1;
      }
    });
  }

  function fillMissingPredOrderFromScore(rides) {
    const hasPred = rides.some((ride) => isFiniteNum(ride.pred_order));
    if (hasPred) return;
    const sorted = [...rides].sort((a, b) => (toNum(b.p_win) ?? -Infinity) - (toNum(a.p_win) ?? -Infinity));
    sorted.forEach((ride, idx) => {
      if (!isFiniteNum(ride.pred_order) && isFiniteNum(ride.p_win)) {
        ride.pred_order = idx + 1;
      }
    });
  }

  function fillMissingCourseRankFromScore(rides) {
    const hasRank = rides.some((ride) => isFiniteNum(ride.course_adv_rank));
    if (hasRank) return;
    const sorted = [...rides].sort((a, b) => (toNum(b.course_adv_score) ?? -Infinity) - (toNum(a.course_adv_score) ?? -Infinity));
    sorted.forEach((ride, idx) => {
      if (!isFiniteNum(ride.course_adv_rank) && isFiniteNum(ride.course_adv_score)) {
        ride.course_adv_rank = idx + 1;
      }
    });
  }

  function getBestRide(rides) {
    const sorted = [...rides].sort((a, b) => {
      const top3Diff = (toNum(b.p_top3) ?? -Infinity) - (toNum(a.p_top3) ?? -Infinity);
      if (top3Diff !== 0) return top3Diff;
      const winDiff = (toNum(b.p_win) ?? -Infinity) - (toNum(a.p_win) ?? -Infinity);
      if (winDiff !== 0) return winDiff;
      return (toNum(a.popularity) ?? Infinity) - (toNum(b.popularity) ?? Infinity);
    });
    return sorted[0] || null;
  }

  function classifyValueRide(ride) {
    const popularity = toNum(ride.popularity);
    const predOrder = toNum(ride.pred_order);
    const courseRank = toNum(ride.course_adv_rank);
    const pTop3 = toNum(ride.p_top3);
    const odds = toNum(ride.tansho_odds);

    if (!isFiniteNum(popularity)) return { label: null };

    const aiGap = isFiniteNum(predOrder) ? (popularity - predOrder) : 0;
    const courseGap = isFiniteNum(courseRank) ? (popularity - courseRank) : 0;

    const isValue =
      popularity >= 6 &&
      ((aiGap >= 3) || (courseGap >= 4)) &&
      isFiniteNum(pTop3) && pTop3 >= 0.25 &&
      (!isFiniteNum(odds) || (odds >= 6 && odds <= 40));

    const isStrong =
      popularity >= 8 &&
      ((aiGap >= 4) || (courseGap >= 5)) &&
      isFiniteNum(pTop3) && pTop3 >= 0.30;

    if (isStrong) return { label: "強穴", type: "value" };
    if (isValue) return { label: "穴候補", type: "value" };
    return { label: null };
  }

  function classifyDangerRide(ride) {
    const popularity = toNum(ride.popularity);
    const predOrder = toNum(ride.pred_order);
    const courseRank = toNum(ride.course_adv_rank);
    const pTop3 = toNum(ride.p_top3);
    const pWin = toNum(ride.p_win);

    if (!isFiniteNum(popularity) || popularity > 5) return { label: null };

    const aiGap = isFiniteNum(predOrder) ? (predOrder - popularity) : 0;
    const courseGap = isFiniteNum(courseRank) ? (courseRank - popularity) : 0;

    const isDanger =
      ((aiGap >= 3) || (courseGap >= 4)) &&
      isFiniteNum(pTop3) && pTop3 <= 0.45;

    const isStrong =
      popularity <= 3 &&
      (aiGap >= 4 || courseGap >= 5) &&
      isFiniteNum(pWin) && pWin <= 0.10 &&
      isFiniteNum(pTop3) && pTop3 <= 0.35;

    if (isStrong) return { label: "危険人気", type: "danger" };
    if (isDanger) return { label: "やや危険", type: "danger" };
    return { label: null };
  }

  function classifyPopularRide(ride, danger) {
    const popularity = toNum(ride.popularity);
    const predOrder = toNum(ride.pred_order);
    const courseRank = toNum(ride.course_adv_rank);
    const pTop3 = toNum(ride.p_top3);

    if (!isFiniteNum(popularity) || popularity > 5) return { label: null };

    const reliable =
      isFiniteNum(predOrder) && predOrder <= popularity + 1 &&
      (!isFiniteNum(courseRank) || courseRank <= popularity + 2) &&
      isFiniteNum(pTop3) && pTop3 >= 0.55;

    if (reliable) return { label: "信頼", type: "popular" };
    if (danger.label) return { label: null };
    return { label: "妥当", type: "popular" };
  }

  function classifyCourseGapRide(ride) {
    const popularity = toNum(ride.popularity);
    const courseRank = toNum(ride.course_adv_rank);
    const pTop3 = toNum(ride.p_top3);

    if (!isFiniteNum(popularity) || !isFiniteNum(courseRank)) {
      return { label: null, type: null };
    }

    const gap = popularity - courseRank;
    const reverseGap = courseRank - popularity;

    if (popularity >= 8 && courseRank <= 3 && gap >= 5 && isFiniteNum(pTop3) && pTop3 >= 0.30) {
      return { label: "コース穴", type: "value" };
    }
    if (popularity >= 6 && courseRank <= 4 && gap >= 3 && isFiniteNum(pTop3) && pTop3 >= 0.25) {
      return { label: "コース向き", type: "course" };
    }
    if (popularity <= 3 && reverseGap >= 5 && isFiniteNum(pTop3) && pTop3 <= 0.35) {
      return { label: "適性危険", type: "danger" };
    }
    if (popularity <= 5 && reverseGap >= 4 && isFiniteNum(pTop3) && pTop3 <= 0.45) {
      return { label: "人気先行", type: "danger" };
    }
    return { label: null, type: null };
  }

  function pickMainLabel(ride) {
    if (ride.value_label) return { text: ride.value_label, type: "value" };
    if (ride.danger_label) return { text: ride.danger_label, type: "danger" };
    if (ride.course_gap_label && ride.course_gap_type === "danger") return { text: ride.course_gap_label, type: "danger" };
    if (ride.course_gap_label) return { text: ride.course_gap_label, type: "course" };
    if (ride.popular_label) return { text: ride.popular_label, type: "popular" };
    return { text: "中立", type: "neutral" };
  }

  function buildRaceUrl(raceDate, raceId) {
    const url = new URL(getPage("race"), window.location.href);
    url.searchParams.set("date", raceDate || "");
    url.searchParams.set("race_id", raceId || "");
    return `${url.pathname}${url.search}`;
  }

  function buildRaceDetailCandidates(raceDate, race) {
    const candidates = [];
    if (race.path) {
      candidates.push(new URL(race.path, window.location.href).toString());
    }
    if (race.race_id) {
      candidates.push(buildDataUrl(`${raceDate}/race_${race.race_id}.json`));
    }
    return [...new Set(candidates)];
  }

  function buildDataUrl(path) {
    const base = getDataRoot().replace(/\/$/, "");
    const rel = String(path || "").replace(/^\//, "");
    return new URL(`${base}/${rel}`, window.location.href).toString();
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${url} の読み込みに失敗しました。`);
    }
    return response.json();
  }

  function renderNothing() {
    renderOverview([]);
    renderJockeyList([]);
  }

  function setStatus(message, type = "info") {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.classList.remove("is-info", "is-error");
    els.status.classList.add(type === "error" ? "is-error" : "is-info");
  }

  function updateQuery(next) {
    const url = new URL(window.location.href);
    Object.entries(next || {}).forEach(([key, value]) => {
      if (value == null || value === "") {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, String(value));
      }
    });
    history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function extractRaceId(text) {
    const match = String(text || "").match(/race[_-]?(\d+)/i);
    return match ? match[1] : "";
  }

  function formatDateLabel(raceDate) {
    const s = String(raceDate || "");
    if (!/^\d{8}$/.test(s)) return s;
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    const dt = new Date(y, m - 1, d);
    const wd = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()] || "";
    return `${m}/${d}(${wd})`;
  }

  function formatPopularity(value) {
    return isFiniteNum(value) ? `${round1(value)}人気` : "-";
  }

  function fmtPct(value) {
    const n = toNum(value);
    return isFiniteNum(n) ? `${round1(n * 100)}%` : "-";
  }

  function fmtOdds(value) {
    const n = toNum(value);
    return isFiniteNum(n) ? `${round1(n)}倍` : "-";
  }

  function round1(value) {
    const n = toNum(value);
    return isFiniteNum(n) ? (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "") : "-";
  }

  function firstNum(...values) {
    for (const value of values) {
      const n = toNum(value);
      if (isFiniteNum(n)) return n;
    }
    return null;
  }

  function toNum(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const cleaned = String(value).replace(/[,%倍人気\s]/g, "");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function average(values) {
    const nums = values.map(toNum).filter(isFiniteNum);
    if (!nums.length) return null;
    return nums.reduce((sum, n) => sum + n, 0) / nums.length;
  }

  function maxOf(values) {
    const nums = values.map(toNum).filter(isFiniteNum);
    if (!nums.length) return null;
    return Math.max(...nums);
  }

  function isFiniteNum(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function compareText(a, b) {
    return String(a || "").localeCompare(String(b || ""), "ja");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }
})();
