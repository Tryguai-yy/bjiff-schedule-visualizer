const data = window.BJIFF_DATA;

const state = {
  query: "",
  unit: "全部",
  date: "全部",
  sort: "近期优先",
  focus: "全部",
};

const expandedCards = new Set();

const generatedAt = document.querySelector("#generatedAt");
const heroStats = document.querySelector("#heroStats");
const heroPills = document.querySelector("#heroPills");
const spotlightStack = document.querySelector("#spotlightStack");
const insightStrip = document.querySelector("#insightStrip");
const featuredGrid = document.querySelector("#featuredGrid");
const dateChips = document.querySelector("#dateChips");
const unitChips = document.querySelector("#unitChips");
const sortChips = document.querySelector("#sortChips");
const focusChips = document.querySelector("#focusChips");
const cardGrid = document.querySelector("#cardGrid");
const resultsTitle = document.querySelector("#resultsTitle");
const resultsSummary = document.querySelector("#resultsSummary");
const activeFilterStrip = document.querySelector("#activeFilterStrip");
const searchInput = document.querySelector("#searchInput");
const template = document.querySelector("#filmCardTemplate");

const sortModes = ["近期优先", "热度优先", "片长优先", "票价优先"];
const focusModes = ["全部", "主创映后", "沉浸循环"];
const posterCache = new Map();
const posterRequestCache = new Map();

const posterObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) {
              return;
            }

            loadPoster(entry.target);
            posterObserver.unobserve(entry.target);
          });
        },
        { rootMargin: "220px 0px" },
      )
    : null;

function formatGeneratedAt() {
  const date = new Date(data.generatedAt);
  if (Number.isNaN(date.getTime())) {
    generatedAt.textContent = "";
    return;
  }

  generatedAt.textContent = `更新于 ${date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function renderChips(container, values, activeValue, onClick) {
  container.innerHTML = "";
  values.forEach((value) => {
    const config = typeof value === "string" ? { value } : value;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip${config.value === activeValue ? " active" : ""}`;
    if (config.title) {
      button.title = config.title;
    }

    const label = document.createElement("span");
    label.className = "chip-label";
    label.textContent = config.label || config.value;
    button.appendChild(label);

    if (typeof config.count === "number") {
      const count = document.createElement("span");
      count.className = "chip-count";
      count.textContent = `${config.count}`;
      button.appendChild(count);
    }

    button.addEventListener("click", () => onClick(config.value));
    container.appendChild(button);
  });
}

function createStatCards() {
  const cards = [
    ["项目", `${data.stats.filmCount}`, `其中 ${data.stats.doubanMatchedFilmCount || 0} 个已补豆瓣资料`],
    ["电影放映", `${data.stats.screeningCount}`, "常规电影真实场次，不把循环体验堆进去"],
    ["主创映后", `${data.stats.creatorEventFilmCount}`, "含映后交流或主创出席的项目数量"],
    ["沉浸项目", `${data.stats.immersiveFilmCount}`, `覆盖 ${data.stats.immersiveDayCount} 天循环体验`],
  ];

  heroStats.innerHTML = cards
    .map(
      ([label, value, note]) => `
        <div class="stat-card">
          <strong class="stat-value">${value}</strong>
          <span class="stat-label">${label}</span>
          <span class="stat-note">${note}</span>
        </div>
      `,
    )
    .join("");
}

function renderHeroPills() {
  heroPills.innerHTML = [
    `${data.festival.dateRange}`,
    `${data.stats.doubanMatchedFilmCount || 0} 个项目已补豆瓣封面 / 简介 / 评分`,
    `${data.stats.creatorEventFilmCount} 个项目带主创映后`,
    "支持日期 / 单元 / 看点 / 关键词筛选",
  ]
    .map((text) => `<span class="hero-pill">${text}</span>`)
    .join("");
}

function normalizeText(value) {
  return (value || "").toString().trim().toLowerCase();
}

function formatUnitLabel(value) {
  return value.replaceAll("“", "").replaceAll("”", "").replace("无界∞沉浸单元 · ", "无界∞ ");
}

function truncateText(text, maxLength = 42) {
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function getDoubanInfo(film) {
  return film.douban || null;
}

function formatRatingCount(value) {
  const num = Number(value || 0);
  if (!num) {
    return "";
  }
  if (num >= 10000) {
    return `${(num / 10000).toFixed(1)}万`;
  }
  return `${num}`;
}

function getSynopsis(film, maxLength = 92) {
  const douban = getDoubanInfo(film);
  if (douban?.summary) {
    return truncateText(douban.summary, maxLength);
  }
  return truncateText(createCuratorCopy(film), maxLength);
}

function normalizeActivity(text) {
  return (text || "").replace(/^映后[:：]?/, "映后 ").replace(/\s+/g, " ").trim();
}

function hasCreatorEvent(film) {
  return Boolean(film.hasCreatorEvent);
}

function filmMatchesQuery(film, query) {
  if (!query) {
    return true;
  }

  const haystack = [
    film.title,
    film.englishTitle,
    film.unit,
    film.languages,
    film.scheduleSummary,
    ...film.venues,
    ...film.notes,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function filmMatchesDate(film, date) {
  if (date === "全部") {
    return true;
  }

  return film.screenings.some((screening) => screening.dateLabel === date);
}

function filmMatchesFocus(film, focus = state.focus) {
  if (focus === "全部") {
    return true;
  }

  if (focus === "主创映后") {
    return hasCreatorEvent(film);
  }

  if (focus === "沉浸循环") {
    return film.isImmersive;
  }

  return true;
}

function getVisibleScreenings(film) {
  return film.screenings.filter((screening) =>
    state.date === "全部" ? true : screening.dateLabel === state.date,
  );
}

function getVisibleScheduleDays(film) {
  return film.scheduleByDate.filter((day) => (state.date === "全部" ? true : day.dateLabel === state.date));
}

function getNextScreening(film) {
  const visible = getVisibleScreenings(film);
  return visible[0] || film.screenings[0];
}

function getNextCreatorScreening(film) {
  return getVisibleScreenings(film).find((screening) => screening.activity) || null;
}

function getVenueSummary(film) {
  if (film.venues.length > 1) {
    return `${film.venues.length} 家影院 / 场地`;
  }
  return film.venues[0] || "待定";
}

function getMatchingFilms(overrides = {}) {
  const criteria = { ...state, ...overrides };
  const query = normalizeText(criteria.query);
  return data.films.filter((film) => {
    const unitMatches = criteria.unit === "全部" || film.unit === criteria.unit;
    return (
      unitMatches &&
      filmMatchesDate(film, criteria.date) &&
      filmMatchesQuery(film, query) &&
      filmMatchesFocus(film, criteria.focus)
    );
  });
}

function createCuratorCopy(film) {
  const unitName = film.unit.replace("无界∞沉浸单元 · ", "");

  if (film.isImmersive) {
    return `${unitName} · ${film.scheduleSummary}`;
  }

  if (hasCreatorEvent(film)) {
    return `${unitName} · ${film.creatorEventCount} 场主创映后`;
  }

  if (film.dayCount > 1) {
    return `${unitName} · ${film.dayCount} 天内放映 ${film.screeningCount} 场`;
  }

  return `${unitName} · ${getVenueSummary(film)}`;
}

function buildCompactNotes(film) {
  const douban = getDoubanInfo(film);
  if (film.isImmersive) {
    return [
      film.scheduleSummary,
      truncateText(film.languages || "中国传媒大学 · 无界∞沉浸单元", 34),
    ];
  }

  if (hasCreatorEvent(film)) {
    const nextCreator = getNextCreatorScreening(film);
    return [
      `含 ${film.creatorEventCount} 场主创映后`,
      nextCreator ? `${nextCreator.dateLabel} ${nextCreator.timeLabel} ${normalizeActivity(nextCreator.activity)}` : "",
    ].filter(Boolean);
  }

  if (douban?.rating) {
    return [
      `豆瓣 ${douban.rating}${douban.ratingCount ? ` · ${formatRatingCount(douban.ratingCount)} 人评价` : ""}`,
      douban.summary ? truncateText(douban.summary, 38) : film.scheduleSummary,
    ];
  }

  return [film.scheduleSummary];
}

function scoreFilm(film) {
  if (film.isImmersive) {
    return 14 + film.dayCount * 2 + (film.averageDailySlots || 0);
  }

  const unitBoost =
    (film.unit.includes("主竞赛") && 36) ||
    (film.unit.includes("大师回顾") && 30) ||
    (film.unit.includes("修复") && 26) ||
    (film.unit.includes("午夜场") && 22) ||
    (film.unit.includes("首映") && 18) ||
    12;

  const creatorBoost = hasCreatorEvent(film) ? 16 : 0;
  return unitBoost + creatorBoost + Math.min(film.screeningCount, 4) * 6 + Math.max(0, 150 - (film.runtime || 100)) / 12;
}

function sortFilms(films) {
  const copy = [...films];

  if (state.sort === "热度优先") {
    return copy.sort((a, b) => scoreFilm(b) - scoreFilm(a));
  }

  if (state.sort === "片长优先") {
    return copy.sort((a, b) => (b.runtime || 0) - (a.runtime || 0));
  }

  if (state.sort === "票价优先") {
    return copy.sort((a, b) => (b.price || 0) - (a.price || 0));
  }

  const sorted = copy.sort((a, b) => {
    const aNext = getNextScreening(a)?.start || "";
    const bNext = getNextScreening(b)?.start || "";
    return aNext.localeCompare(bNext);
  });

  const shouldPreferStandard =
    state.unit === "全部" &&
    state.date === "全部" &&
    !state.query &&
    state.focus !== "沉浸循环";

  if (!shouldPreferStandard) {
    return sorted;
  }

  return [...sorted.filter((film) => !film.isImmersive), ...sorted.filter((film) => film.isImmersive)];
}

function getFilteredFilms() {
  return sortFilms(getMatchingFilms());
}

function pickCuratedFilms(films, count) {
  const sorted = [...films].sort((a, b) => scoreFilm(b) - scoreFilm(a));
  const onlyImmersiveView = state.unit.includes("无界∞沉浸单元") || state.focus === "沉浸循环";
  const maxImmersive = onlyImmersiveView ? count : 1;
  const picks = [];
  let immersiveUsed = 0;

  for (const film of sorted) {
    if (film.isImmersive && immersiveUsed >= maxImmersive) {
      continue;
    }

    picks.push(film);
    if (film.isImmersive) {
      immersiveUsed += 1;
    }

    if (picks.length === count) {
      break;
    }
  }

  return picks;
}

function getTopUnits() {
  const counts = new Map();
  data.films.forEach((film) => {
    counts.set(film.unit, (counts.get(film.unit) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
}

function renderInsightStrip() {
  const units = getTopUnits();
  const earliestDate = data.dates[0];
  const latestDate = data.dates[data.dates.length - 1];

  const cards = [
    {
      label: "Hot Unit",
      title: units[0] ? `${units[0][0]}` : "全部单元",
      copy: units[0] ? `包含 ${units[0][1]} 个项目，是本届最密集的展映单元。` : "",
    },
    {
      label: "Douban Sync",
      title: `${data.stats.doubanMatchedFilmCount || 0} 个项目`,
      copy: "封面、评分和简介优先用豆瓣资料补齐，卡片不再只是排片信息。",
    },
    {
      label: "Creator Q&A",
      title: `${data.stats.creatorEventFilmCount} 个项目`,
      copy: "现在可以直接按“主创映后”筛出带交流环节的片，不用自己逐个翻场次。",
    },
    {
      label: "Immersive",
      title: `${earliestDate} - ${latestDate}`,
      copy: `沉浸单元按 ${data.stats.immersiveDayCount} 天循环展示，电影放映从 ${earliestDate} 排到 ${latestDate}。`,
    },
  ];

  insightStrip.innerHTML = cards
    .map(
      (card) => `
        <article class="insight-card">
          <p class="section-label">${card.label}</p>
          <strong>${card.title}</strong>
          <p>${card.copy}</p>
        </article>
      `,
    )
    .join("");
}

function formatMetaPills(film) {
  const pills = [];

  if (!film.isImmersive && film.year) {
    pills.push(`${film.year}`);
  }

  if (film.runtime) {
    pills.push(`${film.runtime} 分钟`);
  }

  if (film.price) {
    pills.push(`¥${film.price}`);
  }

  if (film.isImmersive) {
    pills.push(`${film.dayCount} 天循环`);
    if (film.averageDailySlots) {
      pills.push(`日均 ${film.averageDailySlots} 时段`);
    }
    pills.push("中国传媒大学");
  } else if (film.screeningCount) {
    pills.push(`${film.screeningCount} 场`);
    if (film.venues.length) {
      pills.push(`${film.venues.length} 家影院`);
    }
  }

  if (hasCreatorEvent(film)) {
    pills.push(`映后 ${film.creatorEventCount} 场`);
  }

  if (film.douban?.rating) {
    pills.push(`豆瓣 ${film.douban.rating}`);
    if (film.douban.ratingCount) {
      pills.push(`${formatRatingCount(film.douban.ratingCount)} 人评价`);
    }
  }

  return pills;
}

function buildScreeningRows(screenings) {
  return screenings
    .map(
      (screening) => `
        <div class="screening-item${screening.activity ? " screening-highlight" : ""}">
          <div class="screening-time">
            <span class="screening-date">${screening.dateLabel}</span>${screening.timeLabel}
          </div>
          <div>
            <div class="screening-place">${screening.cinema || "待定"}${screening.hall ? ` · ${screening.hall}` : ""}</div>
            ${screening.activity ? `<div class="screening-extra screening-status">${normalizeActivity(screening.activity)}</div>` : ""}
          </div>
        </div>
      `,
    )
    .join("");
}

function buildStandardScreenings(film, expanded) {
  const visibleScreenings = getVisibleScreenings(film);
  const limit = expanded ? visibleScreenings.length : 2;
  const screeningsToRender = visibleScreenings.slice(0, limit);
  const restCount = Math.max(0, visibleScreenings.length - screeningsToRender.length);
  const toggleText = expanded ? "收起场次" : `展开全部 ${visibleScreenings.length} 场`;

  return `
    ${buildScreeningRows(screeningsToRender)}
    ${
      visibleScreenings.length > 2
        ? `<button class="screening-toggle" type="button" data-film-id="${film.id}">${restCount && !expanded ? `${toggleText}` : "收起场次"}</button>`
        : ""
    }
  `;
}

function buildImmersiveScreenings(film, expanded) {
  const visibleDays = getVisibleScheduleDays(film);
  const dayLimit = expanded || state.date !== "全部" ? visibleDays.length : 2;
  const daysToRender = visibleDays.slice(0, dayLimit).map((day) => {
    const previewTimes = expanded || state.date !== "全部" ? day.times : day.times.slice(0, 5);
    const moreTimes = day.count - previewTimes.length;

    return `
      <div class="screening-item">
        <div class="screening-time">
          <span class="screening-date">${day.dateLabel}</span>
        </div>
        <div>
          <div class="screening-place">${previewTimes.join(" / ")}${moreTimes > 0 ? ` / +${moreTimes}` : ""}</div>
          <div class="screening-extra">中国传媒大学 · 无界∞沉浸单元</div>
        </div>
      </div>
    `;
  });

  const canExpand = state.date === "全部" && visibleDays.length > 2;

  return `
    ${daysToRender.join("")}
    ${
      canExpand
        ? `<button class="screening-toggle" type="button" data-film-id="${film.id}">${expanded ? "收起循环日程" : `展开全部 ${visibleDays.length} 天`}</button>`
        : ""
    }
  `;
}

function buildScreenings(film) {
  const expanded = expandedCards.has(film.id);
  return film.isImmersive ? buildImmersiveScreenings(film, expanded) : buildStandardScreenings(film, expanded);
}

function createPosterDataset(element, film, variant = "default") {
  element.dataset.posterKey = `${variant}|${film.title}|${film.englishTitle}|${film.year || ""}`;
  element.dataset.posterDirect = film.douban?.poster || "";
  element.dataset.posterCandidates = JSON.stringify(
    [
      film.englishTitle,
      `${film.englishTitle} ${film.year || ""}`,
      film.title,
      `${film.title} ${film.year || ""}`,
    ].filter(Boolean),
  );
}

function observePoster(element) {
  if (posterObserver) {
    posterObserver.observe(element);
  } else {
    loadPoster(element);
  }
}

function buildFlagRow(film) {
  const flags = [];
  if (hasCreatorEvent(film)) {
    flags.push('<span class="status-badge creator">主创映后</span>');
  }
  if (film.isImmersive) {
    flags.push('<span class="status-badge immersive">沉浸循环</span>');
  }
  return flags.join("");
}

function renderSpotlight(films) {
  const picks = pickCuratedFilms(films, 2);
  spotlightStack.innerHTML = "";

  picks.forEach((film) => {
    const next = getNextScreening(film);
    const flagRow = buildFlagRow(film);
    const douban = getDoubanInfo(film);
    const card = document.createElement("article");
    card.className = "spotlight-card";
    card.innerHTML = `
      <div class="spotlight-poster">
        <div class="spotlight-fallback">${film.title}</div>
        <img alt="${film.title}" hidden loading="lazy" />
      </div>
      <div class="spotlight-content">
        ${flagRow ? `<div class="status-row">${flagRow}</div>` : ""}
        <p class="section-label">${film.unit}</p>
        <h3 class="spotlight-title">${film.title}</h3>
        <p class="spotlight-copy">${getSynopsis(film, 56)}</p>
        <p class="spotlight-meta">${next ? `${next.dateLabel} ${next.timeLabel} · ${getVenueSummary(film)}` : "等待排片"}${douban?.rating ? ` · 豆瓣 ${douban.rating}${douban.ratingCount ? ` / ${formatRatingCount(douban.ratingCount)}` : ""}` : ""}</p>
      </div>
    `;

    const poster = card.querySelector(".spotlight-poster");
    createPosterDataset(poster, film, "spotlight");
    observePoster(poster);
    spotlightStack.appendChild(card);
  });
}

function renderFeaturedGrid(films) {
  const picks = pickCuratedFilms(films, 3);
  featuredGrid.innerHTML = "";

  picks.forEach((film) => {
    const next = getNextScreening(film);
    const flagRow = buildFlagRow(film);
    const douban = getDoubanInfo(film);
    const card = document.createElement("article");
    card.className = "featured-card";
    card.innerHTML = `
      <div class="featured-fallback"></div>
      <img alt="${film.title}" hidden loading="lazy" />
      <div class="featured-overlay">
        ${flagRow ? `<div class="status-row">${flagRow}</div>` : ""}
        <p class="section-label">${film.unit}</p>
        <h3 class="featured-title">${film.title}</h3>
        <p class="featured-copy">${getSynopsis(film, 84)}</p>
        <div class="featured-meta">
          <span>${film.runtime ? `${film.runtime} 分钟` : "时长待定"}</span>
          <span>${film.price ? `¥${film.price}` : "票价待定"}</span>
          ${douban?.rating ? `<span>豆瓣 ${douban.rating}</span>` : ""}
          ${douban?.ratingCount ? `<span>${formatRatingCount(douban.ratingCount)} 人评价</span>` : ""}
          <span>${film.isImmersive ? `${film.dayCount} 天循环` : next ? `${next.dateLabel} ${next.timeLabel}` : "排片待定"}</span>
        </div>
      </div>
    `;

    createPosterDataset(card, film, "featured");
    observePoster(card);
    featuredGrid.appendChild(card);
  });
}

function updateResultsMeta(films) {
  const standardFilms = films.filter((film) => !film.isImmersive);
  const immersiveFilms = films.filter((film) => film.isImmersive);
  const creatorFilms = films.filter((film) => hasCreatorEvent(film));
  const doubanFilms = films.filter((film) => film.douban);
  const standardSessions = standardFilms.reduce((sum, film) => sum + getVisibleScreenings(film).length, 0);

  resultsTitle.textContent =
    state.unit === "全部" ? "完整片单" : state.unit.replace("无界∞沉浸单元 · ", "");

  const filters = [
    state.date !== "全部" ? `日期 ${state.date}` : "",
    state.unit !== "全部" ? `单元 ${state.unit}` : "",
    state.focus !== "全部" ? `看点 ${state.focus}` : "",
    state.query ? `关键词 “${state.query}”` : "",
    `排序 ${state.sort}`,
  ].filter(Boolean);

  const summaryBits = [`当前筛出 ${films.length} 个项目`];
  if (standardFilms.length) {
    summaryBits.push(`${standardSessions} 场电影放映`);
  }
  if (creatorFilms.length) {
    summaryBits.push(`${creatorFilms.length} 个带主创映后`);
  }
  if (immersiveFilms.length) {
    summaryBits.push(`${immersiveFilms.length} 个沉浸循环项目`);
  }
  if (doubanFilms.length) {
    summaryBits.push(`${doubanFilms.length} 个带豆瓣资料`);
  }

  resultsSummary.textContent = `${summaryBits.join("，")}。${filters.join(" · ")}。`;
  renderActiveFilterStrip(films, doubanFilms.length);
}

function renderActiveFilterStrip(films, doubanCount) {
  const entries = [];
  if (state.date !== "全部") {
    entries.push(`日期 ${state.date}`);
  }
  if (state.unit !== "全部") {
    entries.push(`单元 ${formatUnitLabel(state.unit)}`);
  }
  if (state.focus !== "全部") {
    entries.push(`看点 ${state.focus}`);
  }
  if (state.query) {
    entries.push(`关键词 ${state.query}`);
  }

  entries.push(`排序 ${state.sort}`);
  entries.push(`${films.length} 个项目`);
  if (doubanCount) {
    entries.push(`${doubanCount} 个带豆瓣资料`);
  }

  activeFilterStrip.innerHTML = entries.map((item) => `<span class="active-filter-chip">${item}</span>`).join("");
}

function renderFilms() {
  const films = getFilteredFilms();
  updateResultsMeta(films);
  renderSpotlight(films.length ? films : data.films);
  renderFeaturedGrid(films.length ? films : data.films);
  cardGrid.innerHTML = "";

  if (!films.length) {
    featuredGrid.innerHTML = "";
    cardGrid.innerHTML = '<div class="empty-state">没有匹配结果，换个关键词、日期、看点或单元试试。</div>';
    return;
  }

  films.forEach((film, index) => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".film-card");
    const posterSlot = fragment.querySelector(".poster-slot");
    const posterTitle = fragment.querySelector(".poster-title");
    const posterEnglish = fragment.querySelector(".poster-english");
    const posterUnit = fragment.querySelector(".poster-unit");
    const unitTag = fragment.querySelector(".unit-tag");
    const filmTitle = fragment.querySelector(".film-title");
    const filmSubtitle = fragment.querySelector(".film-subtitle");
    const filmSynopsis = fragment.querySelector(".film-synopsis");
    const nextSession = fragment.querySelector(".next-session");
    const metaRow = fragment.querySelector(".meta-row");
    const notes = fragment.querySelector(".notes");
    const ratingBadge = fragment.querySelector(".rating-badge");
    const creatorBadge = fragment.querySelector(".creator-badge");
    const immersiveBadge = fragment.querySelector(".immersive-badge");
    const screeningList = fragment.querySelector(".screening-list");
    const next = getNextScreening(film);
    const nextCreator = getNextCreatorScreening(film);
    const douban = getDoubanInfo(film);

    card.style.animationDelay = `${Math.min(index * 20, 220)}ms`;
    card.dataset.filmId = film.id;
    posterTitle.textContent = film.title;
    posterEnglish.textContent = truncateText(film.englishTitle, 42);
    posterUnit.textContent = film.unit.split("·")[0];

    unitTag.textContent = film.unit;
    filmTitle.textContent = film.title;
    filmSubtitle.textContent = truncateText(
      [douban?.originalTitle || film.englishTitle, film.languages].filter(Boolean).join(" / "),
      60,
    );
    filmSynopsis.textContent = getSynopsis(film, 110);

    if (film.isImmersive) {
      immersiveBadge.hidden = false;
    }

    if (douban?.rating) {
      ratingBadge.hidden = false;
      ratingBadge.textContent = `豆瓣 ${douban.rating}`;
      ratingBadge.title = douban.ratingCount ? `${formatRatingCount(douban.ratingCount)} 人评价` : "";
    }

    if (hasCreatorEvent(film)) {
      creatorBadge.hidden = false;
    }

    nextSession.innerHTML = next
      ? `
          <span class="next-badge">${film.isImmersive ? "Loop Schedule" : next.activity ? "Next Screening · 映后" : "Next Screening"}</span>
          <strong>${next.dateLabel} ${next.timeLabel}</strong>
          <span>${film.isImmersive ? "中国传媒大学 · 无界∞沉浸单元" : `${next.cinema || "待定"}${next.hall ? ` · ${next.hall}` : ""}`}</span>
          ${
            !film.isImmersive && nextCreator
              ? `<span class="next-substatus">${nextCreator.dateLabel} ${nextCreator.timeLabel} ${normalizeActivity(nextCreator.activity)}</span>`
              : ""
          }
        `
      : `
          <span class="next-badge">Schedule</span>
          <strong>排片待定</strong>
          <span>该影片暂未解析到场次信息</span>
        `;

    metaRow.innerHTML = formatMetaPills(film)
      .map((text) => `<span class="pill">${text}</span>`)
      .join("");

    notes.innerHTML = buildCompactNotes(film)
      .filter(Boolean)
      .slice(0, 1)
      .map((text, idx) => `<span class="pill${idx === 1 ? " important" : ""}">${text}</span>`)
      .join("");

    screeningList.innerHTML = buildScreenings(film);

    createPosterDataset(posterSlot, film, "card");
    observePoster(posterSlot);
    cardGrid.appendChild(fragment);
  });
}

function renderControls() {
  renderChips(
    dateChips,
    ["全部", ...data.dates].map((value) => ({
      value,
      count: getMatchingFilms({ date: value }).length,
    })),
    state.date,
    (value) => {
      state.date = value;
      expandedCards.clear();
      renderControlsAndFilms();
    },
  );

  renderChips(
    unitChips,
    ["全部", ...data.units].map((value) => ({
      value,
      label: value === "全部" ? value : formatUnitLabel(value),
      title: value === "全部" ? "" : value,
      count: getMatchingFilms({ unit: value }).length,
    })),
    state.unit,
    (value) => {
      state.unit = value;
      expandedCards.clear();
      renderControlsAndFilms();
    },
  );

  renderChips(sortChips, sortModes, state.sort, (value) => {
    state.sort = value;
    renderControlsAndFilms();
  });

  renderChips(
    focusChips,
    focusModes.map((value) => ({
      value,
      count: getMatchingFilms({ focus: value }).length,
    })),
    state.focus,
    (value) => {
      state.focus = value;
      expandedCards.clear();
      renderControlsAndFilms();
    },
  );
}

function renderControlsAndFilms() {
  renderControls();
  renderFilms();
}

function initSearch() {
  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    expandedCards.clear();
    renderControlsAndFilms();
  });
}

function init() {
  formatGeneratedAt();
  createStatCards();
  renderHeroPills();
  renderInsightStrip();
  renderControls();
  renderFilms();
  initInteractions();
  initSearch();
}

async function loadPoster(slot) {
  const key = slot.dataset.posterKey;
  if (!key) {
    return;
  }

  const directPoster = slot.dataset.posterDirect;
  if (directPoster) {
    applyPoster(slot, directPoster);
    posterCache.set(key, directPoster);
    return;
  }

  if (posterCache.has(key)) {
    applyPoster(slot, posterCache.get(key));
    return;
  }

  if (!posterRequestCache.has(key)) {
    const candidates = JSON.parse(slot.dataset.posterCandidates || "[]");
    posterRequestCache.set(key, findPoster(candidates));
  }

  const posterUrl = await posterRequestCache.get(key);
  posterCache.set(key, posterUrl || "");
  applyPoster(slot, posterUrl || "");
}

async function findPoster(candidates) {
  for (const candidate of candidates) {
    const wikiPoster = await fetchWikipediaPoster(candidate);
    if (wikiPoster) {
      return wikiPoster;
    }

    const wikidataPoster = await fetchWikidataPoster(candidate);
    if (wikidataPoster) {
      return wikidataPoster;
    }
  }

  return "";
}

function applyPoster(slot, posterUrl) {
  if (!posterUrl) {
    return;
  }

  const image = slot.querySelector("img");
  const fallback = slot.querySelector(".poster-fallback, .spotlight-fallback, .featured-fallback");
  if (!image) {
    return;
  }

  image.src = posterUrl;
  image.hidden = false;
  image.addEventListener(
    "load",
    () => {
      if (fallback) {
        fallback.hidden = true;
      }
    },
    { once: true },
  );
  image.addEventListener(
    "error",
    () => {
      image.hidden = true;
      if (fallback) {
        fallback.hidden = false;
      }
    },
    { once: true },
  );
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3200);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchWikipediaPoster(candidate) {
  const slug = encodeURIComponent(candidate.replace(/\s+/g, "_"));
  const json = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`);
  return json?.thumbnail?.source || json?.originalimage?.source || "";
}

async function fetchWikidataPoster(candidate) {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: candidate,
    language: "en",
    format: "json",
    origin: "*",
    limit: "4",
  });

  const searchJson = await fetchJson(`https://www.wikidata.org/w/api.php?${params.toString()}`);
  const ids = (searchJson?.search || []).map((item) => item.id).filter(Boolean);

  for (const id of ids) {
    const entityJson = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`);
    const imageName = entityJson?.entities?.[id]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;

    if (imageName) {
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageName)}?width=800`;
    }
  }

  return "";
}

function initInteractions() {
  cardGrid.addEventListener("click", (event) => {
    const toggle = event.target.closest(".screening-toggle");
    if (!toggle) {
      return;
    }

    const { filmId } = toggle.dataset;
    if (!filmId) {
      return;
    }

    if (expandedCards.has(filmId)) {
      expandedCards.delete(filmId);
    } else {
      expandedCards.add(filmId);
    }

    renderFilms();
  });
}

init();
