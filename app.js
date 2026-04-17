(() => {
  // === Peak hours config ===
  // Canonical: Mon–Fri 5AM–11AM PT (America/Los_Angeles)
  // UTC equivalent varies: 13:00–19:00 UTC in PST, 12:00–18:00 UTC in PDT
  const PT_PEAK_START = 5;
  const PT_PEAK_END = 11;
  const DAY_MS = 86400000;

  function getPTUTCOffset(date) {
    const ptHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        hour12: false,
      }).format(date),
      10
    );
    let offset = date.getUTCHours() - ptHour;
    if (offset < 0) offset += 24;
    if (offset > 12) offset -= 24;
    return offset; // 8 = PST, 7 = PDT
  }

  function peakUTCForDay(utcDayStartMs) {
    const offset = getPTUTCOffset(new Date(utcDayStartMs + 12 * 3600000));
    return { start: PT_PEAK_START + offset, end: PT_PEAK_END + offset };
  }

  // === Theme ===
  const themeBtn = document.getElementById("themeToggle");
  const body = document.body;

  function applyTheme(theme) {
    body.setAttribute("data-theme", theme);
    themeBtn.innerHTML =
      theme === "dark"
        ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }

  function osTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "anthropic";
  }

  // null = follow OS, 'dark'/'anthropic' = manual override
  let userPref = localStorage.getItem("claude-promo-theme");
  applyTheme(userPref || osTheme());

  // Follow OS changes when no manual override
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (!userPref) applyTheme(osTheme());
    });

  themeBtn.addEventListener("click", () => {
    const next =
      body.getAttribute("data-theme") === "dark" ? "anthropic" : "dark";
    // If clicking back to what OS would give, clear override
    if (next === osTheme()) {
      userPref = null;
      localStorage.removeItem("claude-promo-theme");
    } else {
      userPref = next;
      localStorage.setItem("claude-promo-theme", next);
    }
    applyTheme(next);
  });

  // === Weekday helpers ===
  // Returns the PEAK_START_UTC timestamp of the first weekday at or after fromDate.
  function nextWeekdayPeakStart(fromDate) {
    for (let ahead = 0; ahead <= 7; ahead++) {
      const c = new Date(
        Date.UTC(
          fromDate.getUTCFullYear(),
          fromDate.getUTCMonth(),
          fromDate.getUTCDate() + ahead,
        ),
      );
      if (c.getUTCDay() >= 1 && c.getUTCDay() <= 5) {
        const dayStart = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate());
        return dayStart + peakUTCForDay(dayStart).start * 3600000;
      }
    }
  }

  // Returns the PT_PEAK_END timestamp of the most recent weekday strictly before fromDate.
  function prevWeekdayPeakEnd(fromDate) {
    for (let behind = 1; behind <= 7; behind++) {
      const c = new Date(
        Date.UTC(
          fromDate.getUTCFullYear(),
          fromDate.getUTCMonth(),
          fromDate.getUTCDate() - behind,
        ),
      );
      if (c.getUTCDay() >= 1 && c.getUTCDay() <= 5) {
        const dayStart = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate());
        return dayStart + peakUTCForDay(dayStart).end * 3600000;
      }
    }
  }

  // === Status logic ===
  function getPeakStatus(now) {
    const utcDay = now.getUTCDay(); // 0=Sun, 6=Sat
    const utcHour = now.getUTCHours();
    const { start, end } = peakUTCForDay(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    if (utcDay >= 1 && utcDay <= 5 && utcHour >= start && utcHour < end)
      return "PEAK";
    return "OFF_PEAK";
  }

  // === Next transition time ===
  function getNextTransition(now, status) {
    const d = new Date(now);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const { start, end } = peakUTCForDay(dayStart);
    if (status === "PEAK") {
      return {
        time: dayStart + end * 3600000,
        label: "Off-peak in",
      };
    }
    // OFF_PEAK: next peak start — use today if weekday before peak, otherwise next weekday
    const utcDay = d.getUTCDay();
    const utcHour = d.getUTCHours();
    const fromDay =
      utcDay >= 1 && utcDay <= 5 && utcHour < start
        ? d
        : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
    return { time: nextWeekdayPeakStart(fromDay), label: "Peak starts in" };
  }

  // === Current session boundaries for progress bar ===
  function getSessionBounds(now, status) {
    const d = new Date(now);
    const yy = d.getUTCFullYear(),
      mo = d.getUTCMonth(),
      dd = d.getUTCDate();
    const utcDay = d.getUTCDay(),
      utcHour = d.getUTCHours();
    const nextDay = new Date(Date.UTC(yy, mo, dd + 1));

    const todayStart = Date.UTC(yy, mo, dd);
    const { start: peakS, end: peakE } = peakUTCForDay(todayStart);

    if (status === "PEAK") {
      return {
        start: todayStart + peakS * 3600000,
        end: todayStart + peakE * 3600000,
      };
    }

    if (utcDay >= 1 && utcDay <= 5) {
      if (utcHour < peakS) {
        // Before today's peak: last weekday's peak end → today's peak start
        return {
          start: prevWeekdayPeakEnd(d),
          end: todayStart + peakS * 3600000,
        };
      } else {
        // After today's peak: today's peak end → next weekday's peak start
        return {
          start: todayStart + peakE * 3600000,
          end: nextWeekdayPeakStart(nextDay),
        };
      }
    }

    // Weekend: last Friday's peak end → next Monday's peak start
    return {
      start: prevWeekdayPeakEnd(d),
      end: nextWeekdayPeakStart(nextDay),
    };
  }

  // === Format duration ===
  function formatDuration(ms) {
    if (ms <= 0) return "0:00:00";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  // === Format time in local tz ===
  function formatLocalTime(hour, minute) {
    const d = new Date();
    d.setUTCHours(hour, minute || 0, 0, 0);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  // === Get timezone name ===
  function getTimezoneName() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return tz === "Europe/Kiev" ? "Europe/Kyiv" : tz;
    } catch {
      return "Local";
    }
  }

  // === Weekly timeline helpers ===
  // Compute segments for a local day (local 00:00–24:00).
  // Returns array of { type: 'peak'|'offpeak', startMs, endMs } relative to local midnight.
  function getLocalDaySegments(localMidnightTs) {
    const raw = [];
    let cursor = localMidnightTs;
    const end = localMidnightTs + DAY_MS;

    while (cursor < end) {
      const d = new Date(cursor);
      const utcDay = d.getUTCDay();
      const isWknd = utcDay === 0 || utcDay === 6;

      let type, segEnd;
      if (isWknd) {
        type = "offpeak";
        const nextUtcMid = Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate() + 1,
        );
        segEnd = Math.min(nextUtcMid, end);
      } else {
        const utcDayStart = Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate(),
        );
        const { start: ps, end: pe } = peakUTCForDay(utcDayStart);
        const peakStart = utcDayStart + ps * 3600000;
        const peakEnd = utcDayStart + pe * 3600000;
        const nextUtcMid = utcDayStart + DAY_MS;

        if (cursor < peakStart) {
          type = "offpeak";
          segEnd = Math.min(peakStart, end);
        } else if (cursor < peakEnd) {
          type = "peak";
          segEnd = Math.min(peakEnd, end);
        } else {
          type = "offpeak";
          segEnd = Math.min(nextUtcMid, end);
        }
      }

      raw.push({
        type,
        startMs: cursor - localMidnightTs,
        endMs: segEnd - localMidnightTs,
      });
      cursor = segEnd;
    }

    // Merge adjacent segments of same type
    const merged = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      const last = merged[merged.length - 1];
      if (raw[i].type === last.type) {
        last.endMs = raw[i].endMs;
      } else {
        merged.push(raw[i]);
      }
    }
    return merged;
  }

  // === Format ms offset within a day as HH:MM ===
  function formatMsAsTime(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  function buildScaleRow() {
    const scaleRow = document.createElement("div");
    scaleRow.className = "wt-scale";
    const scaleGutter = document.createElement("div");
    scaleGutter.className = "wt-scale-gutter";
    scaleRow.appendChild(scaleGutter);
    const scaleTrack = document.createElement("div");
    scaleTrack.className = "wt-scale-track";
    for (const h of [0, 6, 12, 18, 24]) {
      const tick = document.createElement("span");
      tick.className = "wt-tick";
      tick.style.left = (h / 24) * 100 + "%";
      tick.textContent = String(h).padStart(2, "0") + ":00";
      scaleTrack.appendChild(tick);
    }
    scaleRow.appendChild(scaleTrack);
    return scaleRow;
  }

  function makeSegmentEl(s, dayStartTs, nowTs, prevSegs, nextSegs) {
    const seg = document.createElement("div");
    seg.className = `wt-seg wt-seg-${s.type}`;
    seg.style.flex = (s.endMs - s.startMs).toString();

    // Resolve true start/end for segments split at midnight
    let trueStart = formatMsAsTime(s.startMs);
    let trueEnd = formatMsAsTime(s.endMs);
    if (s.startMs === 0 && s.endMs < DAY_MS && prevSegs.length > 0) {
      const last = prevSegs[prevSegs.length - 1];
      if (last.type === s.type && last.endMs === DAY_MS) {
        trueStart = formatMsAsTime(last.startMs);
      }
    }
    if (s.endMs === DAY_MS && s.startMs > 0 && nextSegs.length > 0) {
      const first = nextSegs[0];
      if (first.type === s.type && first.startMs === 0) {
        trueEnd = formatMsAsTime(first.endMs);
      }
    }

    seg.dataset.tooltip = `${s.type === "peak" ? "Peak" : "Off-peak"}: ${trueStart}–${trueEnd}`;
    const segStartTs = dayStartTs + s.startMs;
    const segEndTs = dayStartTs + s.endMs;
    if (nowTs >= segEndTs) seg.classList.add("past");
    else if (nowTs >= segStartTs && nowTs < segEndTs)
      seg.classList.add("current");
    return seg;
  }

  function buildWeeklyTimeline() {
    const container = document.getElementById("wtDays");
    container.innerHTML = "";
    const now = new Date();
    const nowTs = now.getTime();

    container.appendChild(buildScaleRow());

    // Find local Monday of this week
    const localDay = now.getDay();
    const daysFromMon = localDay === 0 ? 6 : localDay - 1;
    const monLocal = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysFromMon,
    );
    const dayLabels = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

    // Pre-compute segments for boundary days (day before first & day after last)
    const allSegs = [];
    for (let i = -1; i <= 7; i++) {
      const d = new Date(
        monLocal.getFullYear(),
        monLocal.getMonth(),
        monLocal.getDate() + i,
      );
      allSegs.push(getLocalDaySegments(d.getTime()));
    }
    // allSegs index: day i => allSegs[i + 1]

    for (let i = 0; i < 7; i++) {
      const dayLocal = new Date(
        monLocal.getFullYear(),
        monLocal.getMonth(),
        monLocal.getDate() + i,
      );
      const dayStartTs = dayLocal.getTime();
      const isToday = nowTs >= dayStartTs && nowTs < dayStartTs + DAY_MS;

      const row = document.createElement("div");
      row.className = "wt-row" + (isToday ? " is-today" : "");

      const label = document.createElement("div");
      label.className = "wt-day-label";
      label.textContent = dayLabels[i];
      row.appendChild(label);

      const barWrap = document.createElement("div");
      barWrap.className = "wt-bar-wrap";

      for (const s of allSegs[i + 1]) {
        barWrap.appendChild(
          makeSegmentEl(s, dayStartTs, nowTs, allSegs[i], allSegs[i + 2]),
        );
      }

      if (isToday) {
        const pct = ((nowTs - dayStartTs) / DAY_MS) * 100;
        const nowLine = document.createElement("div");
        nowLine.className = "wt-now";
        nowLine.style.left = pct + "%";
        barWrap.appendChild(nowLine);
      }

      row.appendChild(barWrap);
      container.appendChild(row);
    }
  }

  // === Notifications ===
  const notifBtn = document.getElementById("notifToggle");
  const notifBanner = document.getElementById("notifBanner");
  const notifBannerBtn = document.getElementById("notifBannerBtn");
  const notifBannerClose = document.getElementById("notifBannerClose");
  let notifEnabled = localStorage.getItem("claude-promo-notif") === "on";
  let notifDismissed =
    localStorage.getItem("claude-promo-notif-dismissed") === "1";
  let prevStatus = null;

  function updateNotifUI() {
    notifBtn.innerHTML = notifEnabled
      ? '<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    notifBtn.classList.toggle("active", notifEnabled);
    notifBtn.title = notifEnabled ? "Notifications on" : "Notifications off";
    // Show banner if notifications not enabled, not dismissed, and API available
    const showBanner =
      !notifEnabled &&
      !notifDismissed &&
      "Notification" in window &&
      Notification.permission !== "denied";
    notifBanner.style.display = showBanner ? "" : "none";
  }
  updateNotifUI();

  async function enableNotifications() {
    if (!("Notification" in window)) return false;
    const perm =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (perm !== "granted") return false;
    notifEnabled = true;
    localStorage.setItem("claude-promo-notif", "on");
    updateNotifUI();
    return true;
  }

  function disableNotifications() {
    notifEnabled = false;
    localStorage.removeItem("claude-promo-notif");
    updateNotifUI();
  }

  notifBtn.addEventListener("click", async () => {
    if (!notifEnabled) {
      await enableNotifications();
    } else {
      disableNotifications();
    }
  });

  notifBannerBtn.addEventListener("click", async () => {
    if (await enableNotifications()) {
      notifDismissed = true;
      localStorage.setItem("claude-promo-notif-dismissed", "1");
    }
  });

  notifBannerClose.addEventListener("click", () => {
    notifDismissed = true;
    localStorage.setItem("claude-promo-notif-dismissed", "1");
    updateNotifUI();
  });

  const NOTIF_MESSAGES = {
    PEAK: {
      title: "Peak Hours Started",
      body: "Session limits are now active.",
    },
    OFF_PEAK: {
      title: "Off-Peak Started",
      body: "Enjoy unrestricted usage.",
    },
  };

  function sendStatusNotification(status) {
    if (!notifEnabled || Notification.permission !== "granted") return;
    const msg = NOTIF_MESSAGES[status];
    if (!msg) return;
    new Notification(msg.title, { body: msg.body, icon: "favicon.svg" });
  }

  // === Main update ===
  const answerEl = document.getElementById("answer");
  const subtitleEl = document.getElementById("subtitle");
  const countdownEl = document.getElementById("countdown");
  const countdownLabelEl = document.getElementById("countdown-label");
  const progressBar = document.getElementById("progressBar");
  const tzInfoEl = document.getElementById("tzInfo");

  function update() {
    const now = new Date();
    const status = getPeakStatus(now);

    // Notify on status transition
    if (prevStatus !== null && status !== prevStatus) {
      sendStatusNotification(status);
    }
    prevStatus = status;

    // Timezone info
    const tz = getTimezoneName();
    const nowDayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const { start: dispS, end: dispE } = peakUTCForDay(nowDayStart);
    const peakLocal = `${formatLocalTime(dispS)}–${formatLocalTime(dispE)}`;
    tzInfoEl.textContent = `${tz} · peak hours ${peakLocal}`;

    // Answer
    answerEl.className = "";
    switch (status) {
      case "PEAK":
        answerEl.textContent = "PEAK";
        answerEl.className = "yes";
        subtitleEl.textContent = "Session limits apply";
        break;
      case "OFF_PEAK":
        answerEl.textContent = "OFF-PEAK";
        answerEl.className = "no";
        subtitleEl.textContent = "Unrestricted usage";
        break;
    }

    // Countdown
    const transition = getNextTransition(now, status);
    if (transition) {
      const remaining = transition.time - now.getTime();
      countdownEl.textContent = formatDuration(remaining);
      countdownLabelEl.textContent = transition.label;
    } else {
      countdownEl.textContent = "";
      countdownLabelEl.textContent = "";
    }

    // Progress bar
    const bounds = getSessionBounds(now, status);
    if (bounds) {
      const elapsed = now.getTime() - bounds.start;
      const total = bounds.end - bounds.start;
      const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
      progressBar.style.width = pct + "%";
      progressBar.style.background =
        status === "PEAK" ? "var(--no-color)" : "var(--bar-fill)";
    } else {
      progressBar.style.width = "0%";
    }
  }

  // Tooltip
  const tooltip = document.createElement("div");
  tooltip.className = "wt-tooltip";
  document.body.appendChild(tooltip);

  const wtContainer = document.getElementById("wtDays");
  wtContainer.addEventListener(
    "mouseenter",
    (e) => {
      const seg = e.target.closest(".wt-seg");
      if (!seg || !seg.dataset.tooltip) return;
      tooltip.textContent = seg.dataset.tooltip;
      tooltip.classList.add("visible");
    },
    true,
  );
  wtContainer.addEventListener(
    "mousemove",
    (e) => {
      tooltip.style.left = e.clientX + 10 + "px";
      tooltip.style.top = e.clientY - 32 + "px";
    },
    true,
  );
  wtContainer.addEventListener(
    "mouseleave",
    (e) => {
      const seg = e.target.closest(".wt-seg");
      if (!seg) return;
      tooltip.classList.remove("visible");
    },
    true,
  );

  // === Service status from status.claude.com ===
  const STATUS_COMPONENTS = ["claude.ai", "Claude API", "Claude Code"];
  const STATUS_LABELS = {
    operational: "Operational",
    degraded_performance: "Degraded",
    partial_outage: "Partial outage",
    major_outage: "Major outage",
    under_maintenance: "Maintenance",
  };

  async function fetchStatus() {
    const card = document.getElementById("statusCard");
    const container = document.getElementById("statusRows");
    try {
      const res = await fetch(
        "https://status.claude.com/api/v2/summary.json",
      );
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();

      const components = data.components.filter((c) =>
        STATUS_COMPONENTS.some((name) => c.name.includes(name)),
      );

      let html = "";
      for (const comp of components) {
        const label = STATUS_LABELS[comp.status] || comp.status;
        const displayName =
          STATUS_COMPONENTS.find((n) => comp.name.includes(n)) || comp.name;
        html += `<div class="status-row">
    <span class="status-dot ${comp.status}"></span>
    <span class="status-name">${displayName}</span>
    <span class="status-label">${label}</span>
  </div>`;
      }

      // Active incidents
      const incidents = (data.incidents || []).filter(
        (inc) => inc.status !== "resolved",
      );
      for (const inc of incidents.slice(0, 2)) {
        html += `<div class="status-incident">${inc.name}</div>`;
      }

      container.innerHTML = html;
      card.style.display = "";
    } catch {
      card.style.display = "none";
    }
  }

  // Init
  buildWeeklyTimeline();
  update();
  fetchStatus();
  setInterval(() => {
    update();
    buildWeeklyTimeline();
  }, 1000);
  // Refresh service status every 5 minutes
  setInterval(fetchStatus, 300000);
})();
