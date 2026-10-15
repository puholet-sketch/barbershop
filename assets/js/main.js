(() => {
  "use strict";

  const MROT_MSK = 39730;
  const fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  const fmt1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

  const money = (n) => `${fmt.format(Math.round(n))} ₽`;
  const moneyShort = (n) => {
    const a = Math.abs(n);
    if (a >= 1e6) return `${fmt1.format(n / 1e6)} млн ₽`;
    if (a >= 1e3) return `${fmt.format(Math.round(n / 1e3))} тыс ₽`;
    return money(n);
  };

  const state = {
    rent: 200000,
    masters: 6,
    avgTicket: 1600,
    barberPct: 50,
    mrot: MROT_MSK,
    adminSalary: 55000,
    workDays: 26,
    cutsPerDay: 8,
    contribRate: 30,
    consumablesPct: 3,
    utilities: 45000,
    marketing: 60000,
    otherFixed: 35000,
    taxMode: "usn6",
    payModel: "share_includes",
    targetNet: 1000000,
    capex: 5500000,
    months: 24,
    rampMonths: 4,
  };

  const $ = (id) => document.getElementById(id);

  function payrollOfficial(s) {
    return s.masters * s.mrot + s.adminSalary;
  }

  function contributions(s) {
    return payrollOfficial(s) * (s.contribRate / 100);
  }

  function revenueFromCuts(s) {
    return s.masters * s.cutsPerDay * s.workDays * s.avgTicket;
  }

  function costsAtRevenue(s, revenue, load = 1) {
    const barberShare = revenue * (s.barberPct / 100);
    const mastersMrot = s.masters * s.mrot;
    const admin = s.adminSalary;
    const contrib = (mastersMrot + admin) * (s.contribRate / 100);
    const consumables = revenue * (s.consumablesPct / 100);
    const fixedOps =
      s.rent +
      s.utilities * load +
      s.marketing * load +
      s.otherFixed;

    let labor;
    if (s.payModel === "on_top") {
      // МРОТ + взносы + доля 50% отдельно
      labor = barberShare + mastersMrot + admin + contrib;
    } else {
      // Доля 50% — полный заработок барберов; МРОТ внутри доли; салон платит взносы с МРОТ + админ
      labor = barberShare + admin + contrib;
    }

    const beforeTax = revenue - labor - consumables - fixedOps;
    let tax = 0;
    if (s.taxMode === "usn6") {
      tax = revenue * 0.06;
    } else {
      tax = Math.max(0, beforeTax) * 0.15;
    }

    const net = beforeTax - tax;
    return {
      revenue,
      barberShare,
      mastersMrot,
      admin,
      contrib,
      consumables,
      rent: s.rent,
      utilities: s.utilities * load,
      marketing: s.marketing * load,
      otherFixed: s.otherFixed,
      fixedOps,
      labor,
      beforeTax,
      tax,
      net,
      shopKeep: revenue - barberShare,
    };
  }

  function reverseRevenue(s, targetNet) {
    // Итерация: для usn15 налог зависит от прибыли
    let lo = 0;
    let hi = 20_000_000;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const net = costsAtRevenue(s, mid).net;
      if (net < targetNet) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function loadFactor(month, rampMonths) {
    if (rampMonths <= 0) return 1;
    if (month <= 0) return Math.min(1, 0.45);
    return Math.min(1, 0.45 + (0.55 * month) / rampMonths);
  }

  function buildTimeline(s) {
    const full = costsAtRevenue(s, revenueFromCuts(s), 1);
    let cash = -s.capex;
    const rows = [];
    let breakEvenMonth = null;
    let paybackMonth = null;
    let firstPositivePnl = null;

    for (let m = 1; m <= s.months; m++) {
      const load = loadFactor(m, s.rampMonths);
      const rev = revenueFromCuts(s) * load;
      const pnl = costsAtRevenue(s, rev, load);
      cash += pnl.net;
      if (firstPositivePnl === null && pnl.net >= 0) firstPositivePnl = m;
      if (paybackMonth === null && cash >= 0) paybackMonth = m;
      rows.push({
        m,
        load,
        pnl: pnl.net,
        cash,
        revenue: pnl.revenue,
      });
    }

    // операционная безубыточность по полному месяцу
    if (full.net >= 0) breakEvenMonth = firstPositivePnl;

    return { rows, full, breakEvenMonth, paybackMonth, firstPositivePnl };
  }

  function bindSlider(id, key, { money: asMoney = false, suffix = "", digits = 0 } = {}) {
    const el = $(id);
    const out = $(`${id}-val`);
    if (!el) return;
    const render = () => {
      const v = Number(el.value);
      state[key] = v;
      if (out) {
        if (asMoney) out.textContent = money(v);
        else if (suffix) out.textContent = `${digits ? v.toFixed(digits) : fmt.format(v)}${suffix}`;
        else out.textContent = String(v);
      }
    };
    el.addEventListener("input", () => {
      render();
      refresh();
    });
    render();
  }

  function bindSeg(name, key, values) {
    document.querySelectorAll(`[data-seg="${name}"]`).forEach((btn) => {
      btn.addEventListener("click", () => {
        state[key] = btn.dataset.value;
        document.querySelectorAll(`[data-seg="${name}"]`).forEach((b) => {
          b.classList.toggle("is-on", b.dataset.value === state[key]);
        });
        refresh();
      });
    });
    document.querySelectorAll(`[data-seg="${name}"]`).forEach((b) => {
      b.classList.toggle("is-on", b.dataset.value === state[key]);
    });
  }

  function renderReverse() {
    const needR = reverseRevenue(state, state.targetNet);
    const cuts = needR / state.avgTicket;
    const perMaster = cuts / state.masters;
    const perDay = perMaster / state.workDays;
    const base = costsAtRevenue(state, needR);
    const realistic = costsAtRevenue(state, revenueFromCuts(state));

    $("rev-need").textContent = money(needR);
    $("rev-cuts").textContent = fmt.format(Math.ceil(cuts));
    $("rev-per-day").textContent = fmt1.format(perDay);
    $("rev-verdict").innerHTML =
      perDay > 12
        ? `<strong>Нагрузка ~${fmt1.format(perDay)} стрижек/день на мастера</strong> — выше типичного потолка 8–12. Заявленный 1 млн чистыми при аренде 200 тыс. выглядит как маркетинговый ориентир, а не устойчивый P&amp;L.`
        : perDay > 9
          ? `<strong>~${fmt1.format(perDay)} стрижек/день на мастера</strong> — на верхней границе реализма. Нужны высокая загрузка, дорогой микс (борода/комплексы) и жёсткий контроль фиксов.`
          : `<strong>~${fmt1.format(perDay)} стрижек/день на мастера</strong> — достижимо при стабильной записи и среднем чеке ${money(state.avgTicket)}.`;

    const rows = [
      ["Выручка (нужна для цели)", base.revenue, "num"],
      [`Доля барберов (${state.barberPct}%)`, -base.barberShare, "num"],
      ["Остаток салона до фикса", base.shopKeep, "num"],
    ];
    if (state.payModel === "on_top") {
      rows.push(["МРОТ × мастера (официально)", -base.mastersMrot, "num"]);
    } else {
      rows.push([
        `МРОТ × ${state.masters} (официально, внутри доли)`,
        "в составе доли",
        "muted",
      ]);
    }
    rows.push(
      ["Зарплата администратора", -base.admin, "num"],
      [`Взносы с ФОТ (${state.contribRate}%)`, -base.contrib, "num"],
      [`Расходники (${state.consumablesPct}% выручки)`, -base.consumables, "num"],
      ["Аренда", -base.rent, "num"],
      ["Коммуналка / климат", -base.utilities, "num"],
      ["Маркетинг", -base.marketing, "num"],
      ["Прочий фикс (учёт, музыка, охрана…)", -base.otherFixed, "num"],
      [
        state.taxMode === "usn6" ? "УСН 6% с выручки" : "УСН 15% с прибыли",
        -base.tax,
        "num",
      ],
      ["Чистая прибыль владельца (цель)", base.net, "num"]
    );

    $("rev-table").innerHTML = rows
      .map((r, i) => {
        const cls = i === rows.length - 1 ? "total" : "";
        const val =
          r[2] === "muted"
            ? `<td class="num muted">${r[1]}</td>`
            : `<td class="num">${money(r[1])}</td>`;
        return `<tr class="${cls}"><td>${r[0]}</td>${val}</tr>`;
      })
      .join("");

    $("base-rev").textContent = money(realistic.revenue);
    $("base-net").textContent = money(realistic.net);
    $("base-net").className =
      "kpi__value " + (realistic.net >= 0 ? "kpi__value--pos" : "kpi__value--neg");
    $("base-cuts-day").textContent = fmt1.format(state.cutsPerDay);

    const heroNet = $("hero-net");
    const heroNeed = $("hero-need");
    const heroNote = $("hero-note");
    if (heroNet) {
      heroNet.textContent = money(realistic.net);
      heroNet.style.color =
        realistic.net >= state.targetNet
          ? "var(--po-gold)"
          : realistic.net >= 0
            ? "var(--bar-pos)"
            : "var(--bar-neg)";
    }
    if (heroNeed) heroNeed.textContent = money(needR);
    if (heroNote) {
      heroNote.textContent =
        perDay > 12
          ? `К цели нужно ~${fmt1.format(perDay)} стр/день на мастера — выше типичного потолка.`
          : `При ${fmt1.format(state.cutsPerDay)} стр/день модель даёт ${money(realistic.net)} чистыми / мес.`;
    }
  }

  function renderCalc() {
    const tl = buildTimeline(state);
    const full = tl.full;

    $("kpi-rev").textContent = money(full.revenue);
    $("kpi-net").textContent = money(full.net);
    $("kpi-net").className =
      "kpi__value " + (full.net >= state.targetNet ? "kpi__value--gold" : full.net >= 0 ? "kpi__value--pos" : "kpi__value--neg");
    $("kpi-payback").textContent = tl.paybackMonth
      ? `мес. ${tl.paybackMonth}`
      : `> ${state.months} мес.`;
    $("kpi-be").textContent = tl.firstPositivePnl
      ? `мес. ${tl.firstPositivePnl}`
      : "не в горизонте";

    $("pnl-table").innerHTML = [
      ["Выручка", full.revenue],
      [`Доля барберов ${state.barberPct}%`, -full.barberShare],
      ...(state.payModel === "on_top"
        ? [
            ["МРОТ × мастера", -full.mastersMrot],
            ["Администратор", -full.admin],
            [`Взносы ${state.contribRate}%`, -full.contrib],
          ]
        : [
            ["Администратор", -full.admin],
            [`Взносы с ФОТ (МРОТ+админ) ${state.contribRate}%`, -full.contrib],
          ]),
      [`Расходники ${state.consumablesPct}%`, -full.consumables],
      ["Аренда", -full.rent],
      ["Коммуналка", -full.utilities],
      ["Маркетинг", -full.marketing],
      ["Прочий фикс", -full.otherFixed],
      [state.taxMode === "usn6" ? "Налог УСН 6%" : "Налог УСН 15%", -full.tax],
      ["Чистая прибыль", full.net],
    ]
      .map((r, i, arr) => {
        const cls = i === arr.length - 1 ? "total" : "";
        return `<tr class="${cls}"><td>${r[0]}</td><td class="num">${money(r[1])}</td></tr>`;
      })
      .join("");

    const maxAbsCash = Math.max(
      ...tl.rows.map((r) => Math.abs(r.cash)),
      state.capex,
      1
    );

    $("timeline").innerHTML = tl.rows
      .map((r) => {
        const w = Math.min(100, (Math.abs(r.cash) / maxAbsCash) * 100);
        const mark = tl.paybackMonth === r.m ? "is-mark" : "";
        const be = tl.firstPositivePnl === r.m ? "is-be" : "";
        const barCls = r.cash >= 0 ? "pos" : "neg";
        return `<div class="tl-row ${mark} ${be}">
          <div class="tl-row__m">M${r.m}</div>
          <div class="tl-bar" title="Загрузка ${(r.load * 100).toFixed(0)}%"><span class="${barCls}" style="width:${w}%"></span></div>
          <div class="tl-pnl">${moneyShort(r.pnl)}</div>
          <div class="tl-cash">${moneyShort(r.cash)}</div>
        </div>`;
      })
      .join("");

    $("tl-summary").textContent = [
      tl.firstPositivePnl
        ? `Операционный плюс с месяца ${tl.firstPositivePnl}`
        : "Операционный плюс в горизонте не достигнут",
      tl.paybackMonth
        ? `капекс отбит к месяцу ${tl.paybackMonth}`
        : `капекс ${money(state.capex)} за ${state.months} мес. не ото́ит`,
      `рампа загрузки ${state.rampMonths} мес.`,
    ].join(" · ");
  }

  function refresh() {
    renderReverse();
    renderCalc();
  }

  function init() {
    bindSlider("sl-rent", "rent", { money: true });
    bindSlider("sl-masters", "masters", { suffix: "" });
    bindSlider("sl-ticket", "avgTicket", { money: true });
    bindSlider("sl-share", "barberPct", { suffix: "%" });
    bindSlider("sl-admin", "adminSalary", { money: true });
    bindSlider("sl-days", "workDays", { suffix: " дн." });
    bindSlider("sl-cuts", "cutsPerDay", { suffix: " /день", digits: 1 });
    bindSlider("sl-contrib", "contribRate", { suffix: "%" });
    bindSlider("sl-cons", "consumablesPct", { suffix: "%", digits: 1 });
    bindSlider("sl-util", "utilities", { money: true });
    bindSlider("sl-mkt", "marketing", { money: true });
    bindSlider("sl-other", "otherFixed", { money: true });
    bindSlider("sl-target", "targetNet", { money: true });
    bindSlider("sl-capex", "capex", { money: true });
    bindSlider("sl-months", "months", { suffix: " мес." });
    bindSlider("sl-ramp", "rampMonths", { suffix: " мес." });

    // cuts step 0.5
    const cuts = $("sl-cuts");
    if (cuts) {
      cuts.step = "0.5";
      cuts.value = String(state.cutsPerDay);
    }

    bindSeg("tax", "taxMode");
    bindSeg("pay", "payModel");

    $("mrot-note").textContent = money(MROT_MSK);
    refresh();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
