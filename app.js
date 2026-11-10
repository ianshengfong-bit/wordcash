/* =========================================================
   YAO 薪資管家 V3.0

   沿用 V2 的儲存位置與資料格式（出勤、里程、設定），
   舊資料可直接使用。V3 新增的資料都放在 settings 裡，
   所以雲端同步與備份檔不需要更動：

   settings.salaryHistory  調薪前的月薪  [{ until, salary }]
   settings.leaves         請假／未上班  [{ id, date, type, hours, pct, breakFA, note }]
   settings.monthItems     單月補貼／扣款 [{ id, month, kind, name, amount }]
   settings.fixedItems     每月固定項目  [{ id, kind, name, amount }]
   settings.payslips       每月實領      { "YYYY-MM": { income, deduct, received, partial, note } }
   settings.bonuses        獎金／年終    [{ id, date, month, name, amount, note }]
                           date 是入帳日，month 是歸屬月份（統計用）
========================================================= */

"use strict";


/* =========================================================
   STORAGE
========================================================= */

const STORAGE_KEY = "YAO_OVERTIME_RECORDS_V1";
const SETTINGS_KEY = "YAO_OVERTIME_SETTINGS_V1";
const MILEAGE_STORAGE_KEY = "YAO_MILEAGE_RECORDS_V1";
const RECORD_SORT_KEY = "YAO_OVERTIME_RECORD_SORT_V1";
const TAB_KEY = "YAO_UI_TAB_V3";
const THEME_KEY = "YAO_UI_THEME_V3";

const DEFAULT_SETTINGS = {
    salary: 40000,
    normalStart: "08:00",
    normalEnd: "17:30",
    overtimeStart: "17:30",
    earlyOvertime: true,
    otLimit: 46,
    dayDivisor: 30,
    fullAttendance: 0,
    fullAttendanceIncluded: true,
    mileageRate: 6,
    mileageWearRate: 3,
    payNextMonth: true,
    annualDays: 0
};

const LEAVE_TYPES = {
    typhoon: { label: "颱風假", pct: 100, breakFA: false },
    personal: { label: "事假", pct: 100, breakFA: true },
    sick: { label: "病假", pct: 50, breakFA: true },
    absent: { label: "曠職", pct: 100, breakFA: true },
    unpaid: { label: "無薪假／停工", pct: 100, breakFA: false },
    annual: { label: "特休／有薪假", pct: 0, breakFA: false },
    other: { label: "其他", pct: 100, breakFA: false }
};

const SLIP_TEMPLATE = {
    income: [
        { key: "base", name: "基本薪資" },
        { key: "ot", name: "加班費" },
        { key: "allow", name: "獎金／津貼" }
    ],
    deduct: [
        { key: "labor", name: "勞保費" },
        { key: "health", name: "健保費" },
        { key: "dep", name: "眷屬健保" },
        { key: "tax", name: "所得稅" },
        { key: "other", name: "其他扣款" }
    ]
};


/* =========================================================
   BASIC HELPERS
========================================================= */

function $(id) {
    return document.getElementById(id);
}

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function loadJSON(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        console.error("讀取資料失敗：", key, error);
        return fallback;
    }
}

function saveJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error("儲存資料失敗：", key, error);
        alert("資料儲存失敗，請確認瀏覽器儲存空間。");
    }
}

function saveLocal() {
    saveJSON(STORAGE_KEY, records);
    saveJSON(SETTINGS_KEY, settings);
    saveJSON(MILEAGE_STORAGE_KEY, mileageRecords);
}

function saveData() {
    saveLocal();
    // 雲端同步模組未載入或尚未啟用時，這一行不會做任何事。
    window.YaoCloudSync?.schedulePush();
}

function normaliseSettings(source) {
    const s = {
        ...DEFAULT_SETTINGS,
        ...(source && typeof source === "object" ? source : {})
    };

    s.salary = Math.max(0, num(s.salary));
    s.dayDivisor = num(s.dayDivisor) > 0 ? num(s.dayDivisor) : 30;
    s.otLimit = Math.max(0, num(s.otLimit));
    s.fullAttendance = Math.max(0, num(s.fullAttendance));
    s.fullAttendanceIncluded = s.fullAttendanceIncluded !== false;
    s.earlyOvertime = s.earlyOvertime !== false;
    s.payNextMonth = s.payNextMonth !== false;
    s.annualDays = Math.max(0, num(s.annualDays));
    s.mileageRate = Math.max(0, num(s.mileageRate));
    s.mileageWearRate = Math.max(0, num(s.mileageWearRate));

    ["salaryHistory", "leaves", "monthItems", "fixedItems", "bonuses"].forEach(key => {
        s[key] = Array.isArray(s[key]) ? s[key] : [];
    });

    s.payslips =
        s.payslips && typeof s.payslips === "object" && !Array.isArray(s.payslips)
            ? s.payslips
            : {};

    return s;
}


/* =========================================================
   STATE
========================================================= */

let records = loadJSON(STORAGE_KEY, []);
let mileageRecords = loadJSON(MILEAGE_STORAGE_KEY, []);
let settings = normaliseSettings(loadJSON(SETTINGS_KEY, {}));

if (!Array.isArray(records)) records = [];
if (!Array.isArray(mileageRecords)) mileageRecords = [];

let selectedMonth = "";
let selectedYear = new Date().getFullYear();
let recordSortOrder = localStorage.getItem(RECORD_SORT_KEY) || "desc";
let activeTab = localStorage.getItem(TAB_KEY) === "ledger" ? "ledger" : "calc";


function escapeHTML(value) {

    return String(value ?? "")
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


function pad2(value) {

    return String(value)
        .padStart(
            2,
            "0"
        );
}


/* =========================================================
   DATE / TIME
========================================================= */

function getCurrentMonth() {

    const now =
        new Date();

    return (
        now.getFullYear() +
        "-" +
        pad2(
            now.getMonth() + 1
        )
    );
}


function getTodayString() {

    const now =
        new Date();

    return (
        now.getFullYear() +
        "-" +
        pad2(
            now.getMonth() + 1
        ) +
        "-" +
        pad2(
            now.getDate()
        )
    );
}


function formatDate(dateString) {

    if (!dateString) {
        return "";
    }

    const date =
        new Date(
            dateString +
            "T00:00:00"
        );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return dateString;
    }

    const week = [
        "日",
        "一",
        "二",
        "三",
        "四",
        "五",
        "六"
    ];

    return (
        date.getFullYear() +
        "/" +
        pad2(
            date.getMonth() + 1
        ) +
        "/" +
        pad2(
            date.getDate()
        ) +
        "（" +
        week[
            date.getDay()
        ] +
        "）"
    );
}


function formatShortDate(dateString) {

    if (!dateString) {
        return "";
    }

    const date =
        new Date(
            dateString +
            "T00:00:00"
        );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return dateString;
    }

    const week = [
        "日",
        "一",
        "二",
        "三",
        "四",
        "五",
        "六"
    ];

    return (
        pad2(
            date.getMonth() + 1
        ) +
        "/" +
        pad2(
            date.getDate()
        ) +
        "（" +
        week[
            date.getDay()
        ] +
        "）"
    );
}


function formatMonth(month) {

    if (!month) {
        return "";
    }

    const parts =
        month.split("-");

    if (
        parts.length !== 2
    ) {
        return month;
    }

    return (
        parts[0] +
        " 年 " +
        Number(parts[1]) +
        " 月"
    );
}


function timeToMinutes(time) {

    if (!time) {
        return 0;
    }

    const parts =
        String(time).split(":");

    const hour =
        Number(
            parts[0] || 0
        );

    const minute =
        Number(
            parts[1] || 0
        );

    return (
        hour * 60 +
        minute
    );
}


function minutesToText(minutes) {

    const total =
        Math.max(
            0,
            Math.round(
                Number(minutes) || 0
            )
        );

    const hours =
        Math.floor(
            total / 60
        );

    const mins =
        total % 60;

    if (hours === 0) {
        return (
            mins +
            " 分"
        );
    }

    if (mins === 0) {
        return (
            hours +
            " 小時"
        );
    }

    return (
        hours +
        " 小時 " +
        mins +
        " 分"
    );
}


function minutesToHoursText(minutes) {

    const hours =
        Math.max(
            0,
            Number(minutes) || 0
        ) / 60;

    return (
        hours.toFixed(2) +
        " 小時"
    );
}


function money(value) {

    return (
        "$" +
        Math.round(
            Number(value) || 0
        ).toLocaleString(
            "zh-TW"
        )
    );
}


function numberText(
    value,
    digits = 1
) {

    const number =
        Number(value) || 0;

    return number.toLocaleString(
        "zh-TW",
        {
            minimumFractionDigits:
                digits,

            maximumFractionDigits:
                digits
        }
    );
}


/* =========================================================
   MONTH
========================================================= */

function getMonthFromDate(
    dateString
) {

    if (!dateString) {
        return "";
    }

    return String(
        dateString
    ).slice(
        0,
        7
    );
}


function getMonthRecords() {

    return records
        .filter(record => {

            return (
                getMonthFromDate(
                    record.date
                ) ===
                selectedMonth
            );

        })
        .sort((a, b) => {

            return String(
                a.date
            ).localeCompare(
                String(b.date)
            );

        });
}


function getMonthMileageRecords() {

    return mileageRecords
        .filter(record => {

            return (
                getMonthFromDate(
                    record.date
                ) ===
                selectedMonth
            );

        })
        .sort((a, b) => {

            return String(
                a.date
            ).localeCompare(
                String(b.date)
            );

        });
}



/* =========================================================
   月份切換
========================================================= */

function shiftMonth(month, offset) {
    const [y, m] = month.split("-").map(Number);
    const date = new Date(y, m - 1 + offset, 1);
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1);
}

function changeMonth(offset) {
    selectedMonth = shiftMonth(selectedMonth, offset);
    render();
}

function inMonth(list, month) {
    return list.filter(item => getMonthFromDate(item.date) === month);
}

function signedMoney(value) {
    const n = Math.round(num(value));
    return (n < 0 ? "−" : "") + money(Math.abs(n));
}

function hoursText(value) {
    const n = num(value);
    return (Number.isInteger(n) ? String(n) : n.toFixed(1)) + " 小時";
}


/* =========================================================
   月薪與時薪（支援調薪）
========================================================= */

function getSalaryForMonth(month) {
    const past = settings.salaryHistory
        .filter(row => row && row.until && month && row.until >= month)
        .sort((a, b) => a.until.localeCompare(b.until));

    return past.length ? Math.max(0, num(past[0].salary)) : num(settings.salary);
}

function getHourlyRate(month) {
    return getSalaryForMonth(month) / (settings.dayDivisor * 8);
}


/* =========================================================
   加班費計算
========================================================= */

function calculatePaidHours(minutes) {
    return Math.floor(Math.max(0, num(minutes)) / 30) * 0.5;
}

function calculateRecord(record) {
    const start = timeToMinutes(record.start);
    let end = timeToMinutes(record.end);

    // 下班時間早於上班時間，視為跨到隔天。
    if (end < start) end += 24 * 60;

    const grossMinutes = end - start;
    const breakMinutes = Math.max(0, num(record.breakMinutes));
    const actualWorkMinutes = Math.max(0, grossMinutes - breakMinutes);

    let overtimeMinutes = 0;
    let earlyMinutes = 0;
    let earlyPaidHours = 0;
    let paidHours = 0;

    if (record.dayType === "weekday") {
        // 下班後：從「平日加班開始」算到下班。
        const overtimeStart = timeToMinutes(settings.overtimeStart);
        const lateMinutes = Math.max(0, end - Math.max(overtimeStart, start));

        // 上班前：比「正常上班」早到的部分。
        if (settings.earlyOvertime) {
            const normalStart = timeToMinutes(settings.normalStart);
            earlyMinutes = Math.max(0, Math.min(normalStart, end) - start);
        }

        // 早上與晚上各自以 30 分鐘為單位計算，不互相湊數。
        earlyPaidHours = calculatePaidHours(earlyMinutes);
        paidHours = calculatePaidHours(lateMinutes) + earlyPaidHours;
        overtimeMinutes = lateMinutes + earlyMinutes;
    } else {
        overtimeMinutes = actualWorkMinutes;
        paidHours = calculatePaidHours(overtimeMinutes);
    }

    const firstTwoHours = Math.min(paidHours, 2);
    const thirdToEighth = Math.min(Math.max(paidHours - 2, 0), 6);
    const ninthToTwelfth = Math.min(Math.max(paidHours - 8, 0), 4);

    const hourlyRate = getHourlyRate(getMonthFromDate(record.date) || selectedMonth);

    const payFirst = hourlyRate * firstTwoHours * 1.34;
    const paySecond = hourlyRate * thirdToEighth * 1.67;
    const payThird = hourlyRate * ninthToTwelfth * 2.67;

    return {
        grossMinutes,
        actualWorkMinutes,
        overtimeMinutes,
        earlyMinutes,
        earlyPaidHours,
        paidHours,
        firstTwoHours,
        thirdToEighth,
        ninthToTwelfth,
        hourlyRate,
        payFirst,
        paySecond,
        payThird,
        total: payFirst + paySecond + payThird
    };
}

function calculateMileage(record) {
    const km = Math.max(0, num(record.km));
    const rate = Math.max(0, num(record.rate));
    const wearRate = Math.max(0, num(record.wearRate));
    const fixedWear = Math.max(0, num(record.wear));
    const wear = wearRate > 0 ? km * wearRate : fixedWear;
    const gross = km * rate;

    return {
        km,
        rate,
        wearRate,
        fixedWear,
        wear,
        gross,
        net: Math.max(0, gross - wear)
    };
}

function getDayTypeText(dayType) {
    if (dayType === "weekday") return "平日";
    if (dayType === "rest") return "休假日";
    if (dayType === "holiday") return "國定／公司假日";
    return "其他";
}


/* =========================================================
   請假／未上班
========================================================= */

function getLeaveLabel(type) {
    return (LEAVE_TYPES[type] || LEAVE_TYPES.other).label;
}

function calculateLeave(leave) {
    const hours = Math.max(0, num(leave.hours));
    const pct = Math.min(100, Math.max(0, num(leave.pct)));
    const hourlyRate = getHourlyRate(getMonthFromDate(leave.date) || selectedMonth);

    return {
        hours,
        pct,
        hourlyRate,
        deduction: hourlyRate * hours * pct / 100
    };
}


/* =========================================================
   單月試算
========================================================= */

function computeMonth(month) {
    const monthRecords = inMonth(records, month);
    const monthMileage = inMonth(mileageRecords, month);
    const monthLeaves = inMonth(settings.leaves, month);
    const monthItems = settings.monthItems.filter(item => item.month === month);

    const out = {
        month,
        salary: getSalaryForMonth(month),
        hourlyRate: getHourlyRate(month),
        monthRecords,
        monthMileage,
        monthLeaves,
        monthItems,
        overtimePay: 0,
        paidHours: 0,
        earlyPaidHours: 0,
        actualOvertimeMinutes: 0,
        overtimeDays: 0,
        weekdayHours: 0,
        restHours: 0,
        holidayHours: 0,
        mileageGross: 0,
        mileageWear: 0,
        mileageNet: 0,
        mileageKm: 0,
        leaveDeduct: 0,
        leaveHours: 0,
        faBonus: 0,
        faDeduct: 0,
        faBroken: false,
        fixedIncome: 0,
        fixedDeduct: 0,
        itemIncome: 0,
        itemDeduct: 0
    };

    monthRecords.forEach(record => {
        const r = calculateRecord(record);
        out.overtimePay += r.total;
        out.paidHours += r.paidHours;
        out.earlyPaidHours += r.earlyPaidHours;
        out.actualOvertimeMinutes += r.overtimeMinutes;
        if (r.overtimeMinutes > 0) out.overtimeDays++;
        if (record.dayType === "weekday") out.weekdayHours += r.paidHours;
        else if (record.dayType === "rest") out.restHours += r.paidHours;
        else if (record.dayType === "holiday") out.holidayHours += r.paidHours;
    });

    monthMileage.forEach(record => {
        const r = calculateMileage(record);
        out.mileageGross += r.gross;
        out.mileageWear += r.wear;
        out.mileageNet += r.net;
        out.mileageKm += r.km;
    });

    monthLeaves.forEach(leave => {
        const r = calculateLeave(leave);
        out.leaveDeduct += r.deduction;
        out.leaveHours += r.hours;
        if (leave.breakFA) out.faBroken = true;
    });

    if (settings.fullAttendance > 0) {
        if (settings.fullAttendanceIncluded) {
            if (out.faBroken) out.faDeduct = settings.fullAttendance;
        } else if (!out.faBroken) {
            out.faBonus = settings.fullAttendance;
        }
    }

    settings.fixedItems.forEach(item => {
        if (item.kind === "income") out.fixedIncome += num(item.amount);
        else out.fixedDeduct += num(item.amount);
    });

    monthItems.forEach(item => {
        if (item.kind === "income") out.itemIncome += num(item.amount);
        else out.itemDeduct += num(item.amount);
    });

    out.extraIncome = out.faBonus + out.fixedIncome + out.itemIncome;
    out.attendanceDeduct = out.leaveDeduct + out.faDeduct;
    out.otherDeduct = out.fixedDeduct + out.itemDeduct;
    out.totalDeduct = out.attendanceDeduct + out.otherDeduct;

    // 應發：公司這個月該給的薪資（不含里程）
    out.payGross = out.salary + out.overtimePay + out.extraIncome - out.attendanceDeduct;
    // 薪資入帳：應發再扣掉勞健保等扣款
    out.payNet = out.payGross - out.otherDeduct;
    // 總收入：薪資入帳加上里程淨收入
    out.totalIncome = out.payNet + out.mileageNet;

    out.hasData = Boolean(
        monthRecords.length || monthMileage.length || monthLeaves.length || monthItems.length
    );

    return out;
}

function getPDFAdjustNote() {
    const c = computeMonth(selectedMonth);
    const parts = [];

    if (c.extraIncome) parts.push("補貼／獎金 " + money(c.extraIncome));
    if (c.leaveDeduct) parts.push("請假扣薪 −" + money(c.leaveDeduct));
    if (c.faDeduct) parts.push("全勤獎金扣除 −" + money(c.faDeduct));
    if (c.otherDeduct) parts.push("固定與其他扣款 −" + money(c.otherDeduct));

    return parts.length ? "本月另計入：" + parts.join("、") + "。" : "";
}


/* =========================================================
   畫面：出勤試算
========================================================= */

function render() {
    const c = computeMonth(selectedMonth);

    if ($("monthPicker")) $("monthPicker").value = selectedMonth;

    renderHero(c);
    renderBreakdown(c);
    renderCalendar(c);
    renderHours(c);
    renderRecords();
    renderLeaves(c);
    renderMileage(c);
    updateQuickPreview();
}

function renderAll() {
    render();
    renderLedger();
}

function renderHero(c) {
    const el = $("hero");
    if (!el) return;

    el.innerHTML = `
        <div class="hero-kicker">${escapeHTML(formatMonth(selectedMonth))}　預估總收入</div>
        <div class="hero-total">${signedMoney(c.totalIncome)}</div>
        <div class="hero-sub">
            預估薪資入帳 <strong>${signedMoney(c.payNet)}</strong>
            ・ 計薪 <strong>${numberText(c.paidHours, 1)}</strong> 小時
            ・ 加班 <strong>${c.overtimeDays}</strong> 天
            ・ 時薪 <strong>${money(c.hourlyRate)}</strong>
        </div>
        <div class="hero-chips">
            <div class="chip"><span>底薪</span><strong>${money(c.salary)}</strong></div>
            <div class="chip"><span>加班費</span><strong>${money(c.overtimePay)}</strong></div>
            <div class="chip"><span>補貼／獎金</span><strong>${money(c.extraIncome)}</strong></div>
            <div class="chip ${c.totalDeduct > 0 ? "neg" : ""}"><span>請假與扣款</span><strong>${c.totalDeduct > 0 ? "−" : ""}${money(c.totalDeduct)}</strong></div>
            <div class="chip"><span>里程淨利（現金）</span><strong>${money(c.mileageNet)}</strong></div>
        </div>
    `;
}

function lineHTML(label, amount, options = {}) {
    const cls = ["line"];
    if (options.neg) cls.push("neg");
    if (options.cls) cls.push(options.cls);

    return `
        <div class="${cls.join(" ")}">
            <span>${escapeHTML(label)}${options.small ? `<small>${options.small}</small>` : ""}</span>
            <strong>${options.neg ? "−" : ""}${money(amount)}</strong>
        </div>
    `;
}

function renderBreakdown(c) {
    const el = $("breakdown");
    if (!el) return;

    const rows = [];

    rows.push(lineHTML("底薪", c.salary, {
        small: c.salary !== num(settings.salary) ? "當月月薪（調薪前）" : ""
    }));

    rows.push(lineHTML("加班費", c.overtimePay, {
        small: `${numberText(c.paidHours, 1)} 小時・時薪 ${money(c.hourlyRate)}`
    }));

    if (c.faBonus) rows.push(lineHTML("全勤獎金", c.faBonus));

    settings.fixedItems
        .filter(item => item.kind === "income")
        .forEach(item => rows.push(lineHTML(item.name || "固定津貼", item.amount, { small: "每月固定" })));

    c.monthItems
        .filter(item => item.kind === "income")
        .forEach(item => rows.push(lineHTML(item.name || "補貼", item.amount, { small: itemLinks(item) })));

    if (c.monthLeaves.length) {
        rows.push(lineHTML("請假／未上班扣薪", c.leaveDeduct, {
            neg: c.leaveDeduct > 0,
            small: `${c.monthLeaves.length} 筆・共 ${hoursText(c.leaveHours)}`
        }));
    }

    if (c.faDeduct) rows.push(lineHTML("全勤獎金扣除", c.faDeduct, { neg: true }));

    settings.fixedItems
        .filter(item => item.kind !== "income")
        .forEach(item => rows.push(lineHTML(item.name || "固定扣款", item.amount, { neg: true, small: "每月固定" })));

    c.monthItems
        .filter(item => item.kind !== "income")
        .forEach(item => rows.push(lineHTML(item.name || "扣款", item.amount, { neg: true, small: itemLinks(item) })));

    rows.push(`
        <div class="line total">
            <span>預估薪資入帳</span>
            <strong>${signedMoney(c.payNet)}</strong>
        </div>
    `);

    rows.push(`
        <div class="line muted-total">
            <span>＋ 里程淨利<small>現金，不入薪轉</small></span>
            <strong>${money(c.mileageNet)}</strong>
        </div>
        <div class="line muted-total">
            <span>＝ 預估總收入</span>
            <strong>${signedMoney(c.totalIncome)}</strong>
        </div>
    `);

    el.innerHTML = rows.join("");
}

function itemLinks(item) {
    const id = escapeHTML(item.id);
    return `本月 ・ <button class="link-btn" type="button" data-action="edit-item" data-id="${id}" style="padding:0 2px">編輯</button><button class="link-btn del" type="button" data-action="delete-item" data-id="${id}" style="padding:0 2px">刪除</button>`;
}

function renderCalendar(c) {
    const el = $("calendar");
    if (!el) return;

    const [year, month] = selectedMonth.split("-").map(Number);
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const dayCount = new Date(year, month, 0).getDate();
    const today = getTodayString();
    const cells = [];

    for (let i = 0; i < firstWeekday; i++) {
        cells.push('<div class="cal-day blank"></div>');
    }

    for (let day = 1; day <= dayCount; day++) {
        const date = selectedMonth + "-" + pad2(day);
        const weekday = new Date(year, month - 1, day).getDay();

        const paid = c.monthRecords
            .filter(record => record.date === date)
            .reduce((sum, record) => sum + calculateRecord(record).paidHours, 0);

        const hasRecord = c.monthRecords.some(record => record.date === date);
        const leave = c.monthLeaves.find(item => item.date === date);
        const hasMileage = c.monthMileage.some(record => record.date === date);

        const cls = ["cal-day"];
        if (weekday === 0 || weekday === 6) cls.push("weekend");
        if (date === today) cls.push("today");

        cells.push(`
            <button class="${cls.join(" ")}" type="button" data-action="day" data-date="${date}" aria-label="${escapeHTML(formatDate(date))}">
                <span class="cal-num">${day}</span>
                ${hasRecord ? `<span class="cal-tag ot">${paid > 0 ? numberText(paid, 1) + "h" : "出勤"}</span>` : ""}
                ${leave ? `<span class="cal-tag leave">${escapeHTML(getLeaveLabel(leave.type).slice(0, 2))}</span>` : ""}
                ${hasMileage ? '<span class="cal-dot"></span>' : ""}
            </button>
        `);
    }

    el.innerHTML = cells.join("");
}

function renderHours(c) {
    const stats = $("hourStats");
    const meter = $("otMeter");

    if (stats) {
        stats.innerHTML = `
            <div class="stat accent"><span>公司計薪</span><strong>${numberText(c.paidHours, 1)} 小時</strong><small>${c.overtimeDays} 天加班</small></div>
            <div class="stat"><span>平日加班</span><strong>${numberText(c.weekdayHours, 1)} 小時</strong><small>其中早上 ${numberText(c.earlyPaidHours, 1)} 小時</small></div>
            <div class="stat"><span>休假日</span><strong>${numberText(c.restHours, 1)} 小時</strong><small>國定假日 ${numberText(c.holidayHours, 1)} 小時</small></div>
            <div class="stat"><span>實際加班</span><strong>${minutesToHoursText(c.actualOvertimeMinutes)}</strong><small>未滿 30 分鐘不計薪</small></div>
        `;
    }

    if (meter) {
        const limit = settings.otLimit;

        if (!limit) {
            meter.innerHTML = "";
            return;
        }

        const ratio = c.paidHours / limit;
        const state = ratio > 1 ? "over" : ratio >= 0.85 ? "warn" : "";

        meter.innerHTML = `
            <div class="meter-head">
                <span>本月加班上限提醒（${limit} 小時）</span>
                <span><strong>${numberText(c.paidHours, 1)}</strong> / ${limit}${ratio > 1 ? "　已超過" : ""}</span>
            </div>
            <div class="meter-bar"><i class="${state}" style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></i></div>
        `;
    }
}

function recordItemHTML(record) {
    const r = calculateRecord(record);
    const id = escapeHTML(record.id);

    return `
        <div class="item">
            <div class="item-top">
                <div>
                    <div class="item-title">${escapeHTML(formatDate(record.date))}</div>
                    <div class="item-sub">${escapeHTML(getDayTypeText(record.dayType))} ・ ${escapeHTML(record.start || "")} → ${escapeHTML(record.end || "")}${record.note ? "<br>" + escapeHTML(record.note) : ""}</div>
                </div>
                <div class="item-amt">${money(r.total)}</div>
            </div>
            <div class="detail" hidden>
                <div>實際工作<b>${minutesToText(r.actualWorkMinutes)}</b></div>
                <div>實際加班<b>${minutesToText(r.overtimeMinutes)}</b></div>
                <div>時薪<b>${money(r.hourlyRate)}</b></div>
                <div>1.34 倍<b>${numberText(r.firstTwoHours, 1)}h / ${money(r.payFirst)}</b></div>
                <div>1.67 倍<b>${numberText(r.thirdToEighth, 1)}h / ${money(r.paySecond)}</b></div>
                <div>2.67 倍<b>${numberText(r.ninthToTwelfth, 1)}h / ${money(r.payThird)}</b></div>
            </div>
            <div class="item-foot">
                <div class="tags">
                    <span class="tag gold">計薪 ${numberText(r.paidHours, 1)} 小時</span>
                    ${r.earlyPaidHours > 0 ? `<span class="tag green">早上 ${numberText(r.earlyPaidHours, 1)} 小時</span>` : ""}
                </div>
                <div class="item-btns">
                    <button class="link-btn" type="button" data-action="toggle-detail">詳細</button>
                    <button class="link-btn" type="button" data-action="edit-record" data-id="${id}">編輯</button>
                    <button class="link-btn del" type="button" data-action="delete-record" data-id="${id}">刪除</button>
                </div>
            </div>
        </div>
    `;
}

function leaveItemHTML(leave) {
    const r = calculateLeave(leave);
    const id = escapeHTML(leave.id);

    return `
        <div class="item">
            <div class="item-top">
                <div>
                    <div class="item-title">${escapeHTML(formatDate(leave.date))}</div>
                    <div class="item-sub">${escapeHTML(getLeaveLabel(leave.type))} ・ ${hoursText(r.hours)} ・ 扣薪 ${r.pct}%${leave.note ? "<br>" + escapeHTML(leave.note) : ""}</div>
                </div>
                <div class="item-amt ${r.deduction > 0 ? "neg" : ""}">${r.deduction > 0 ? "−" + money(r.deduction) : (leave.type === "annual" ? "照常給薪" : "不扣薪")}</div>
            </div>
            <div class="item-foot">
                <div class="tags">
                    <span class="tag blue">${escapeHTML(getLeaveLabel(leave.type))}</span>
                    ${leave.breakFA ? '<span class="tag red">扣全勤</span>' : ""}
                </div>
                <div class="item-btns">
                    <button class="link-btn" type="button" data-action="edit-leave" data-id="${id}">編輯</button>
                    <button class="link-btn del" type="button" data-action="delete-leave" data-id="${id}">刪除</button>
                </div>
            </div>
        </div>
    `;
}

function mileageItemHTML(record) {
    const r = calculateMileage(record);
    const id = escapeHTML(record.id);
    const wearText = r.wearRate > 0
        ? `管銷 ${numberText(r.km, 1)} km × ${money(r.wearRate)}`
        : `固定管銷 ${money(r.fixedWear)}`;

    return `
        <div class="item">
            <div class="item-top">
                <div>
                    <div class="item-title">${escapeHTML(formatDate(record.date))}</div>
                    <div class="item-sub">${numberText(r.km, 1)} km × ${money(r.rate)} ＝ 補助 ${money(r.gross)} ・ ${wearText}（−${money(r.wear)}）${record.note ? "<br>" + escapeHTML(record.note) : ""}</div>
                </div>
                <div class="item-amt">${money(r.net)}</div>
            </div>
            <div class="item-foot">
                <div class="tags"><span class="tag green">里程</span></div>
                <div class="item-btns">
                    <button class="link-btn" type="button" data-action="edit-mileage" data-id="${id}">編輯</button>
                    <button class="link-btn del" type="button" data-action="delete-mileage" data-id="${id}">刪除</button>
                </div>
            </div>
        </div>
    `;
}

function sortByDate(list, order) {
    return list.slice().sort((a, b) => {
        const result = String(a.date).localeCompare(String(b.date));
        return order === "asc" ? result : -result;
    });
}

function renderRecords() {
    const el = $("records");
    if (!el) return;

    const list = sortByDate(getMonthRecords(), recordSortOrder);

    el.innerHTML = list.length
        ? list.map(recordItemHTML).join("")
        : '<div class="empty">本月尚無出勤紀錄</div>';
}

function annualStats(year) {
    const list = sortByDate(
        settings.leaves.filter(item => item.type === "annual" && String(item.date || "").startsWith(year + "-")),
        "asc"
    );

    const used = list.reduce((sum, item) => sum + Math.max(0, num(item.hours)) / 8, 0);

    return {
        list,
        used,
        total: settings.annualDays,
        left: settings.annualDays - used
    };
}

function daysText(value) {
    const n = Math.round(num(value) * 100) / 100;
    return (Number.isInteger(n) ? String(n) : String(n)) + " 天";
}

function renderAnnual() {
    const el = $("annualSummary");
    if (!el) return;

    const year = selectedMonth.slice(0, 4);
    const a = annualStats(year);
    const today = getTodayString();

    const chips = a.list.map(item => {
        const half = num(item.hours) < 8 ? `（${hoursText(item.hours)}）` : "";
        const future = item.date > today ? " green" : "";
        return `<button class="tag${future}" type="button" data-action="edit-leave" data-id="${escapeHTML(item.id)}" style="border:0;cursor:pointer">${escapeHTML(formatShortDate(item.date))}${half}</button>`;
    }).join("");

    const ratio = a.total > 0 ? Math.min(1, a.used / a.total) : 0;

    el.innerHTML = `
        <div class="annual-head">
            <span>${year} 年特休　已用 <strong>${daysText(a.used)}</strong>${a.total > 0 ? ` ／ 共 ${daysText(a.total)}` : ""}</span>
            <span>${a.total > 0
                ? (a.left >= 0 ? `還剩 <strong>${daysText(a.left)}</strong>` : `<strong style="color:var(--red)">超過 ${daysText(-a.left)}</strong>`)
                : "到「設定」填今年特休天數，就會顯示剩幾天"}</span>
        </div>
        ${a.total > 0 ? `<div class="meter-bar"><i class="${a.left < 0 ? "over" : ""}" style="width:${(ratio * 100).toFixed(1)}%"></i></div>` : ""}
        ${chips ? `<div class="annual-days">${chips}</div>` : ""}
    `;
}

function renderLeaves(c) {
    renderAnnual();

    const el = $("leaves");
    if (!el) return;

    const list = sortByDate(c.monthLeaves, recordSortOrder);

    el.innerHTML = list.length
        ? list.map(leaveItemHTML).join("")
        : '<div class="empty">本月沒有請假或未上班紀錄</div>';
}

function renderMileage(c) {
    const el = $("mileageRecords");
    if (!el) return;

    const list = sortByDate(c.monthMileage, recordSortOrder);

    if ($("mileageSummary")) {
        $("mileageSummary").textContent =
            `${numberText(c.mileageKm, 1)} km ・ 補助 ${money(c.mileageGross)} − 管銷 ${money(c.mileageWear)} ＝ 淨利 ${money(c.mileageNet)}`;
    }

    el.innerHTML = list.length
        ? list.map(mileageItemHTML).join("")
        : '<div class="empty">本月尚無里程紀錄</div>';
}


/* =========================================================
   快速記今天
========================================================= */

function isWeekendDate(dateString) {
    const day = new Date(dateString + "T00:00:00").getDay();
    return day === 0 || day === 6;
}

function updateQuickPreview() {
    const preview = $("quickPreview");
    if (!preview) return;

    const start = $("quickStart")?.value || settings.normalStart;
    const end = $("quickEnd")?.value || "";

    if (isWeekendDate(getTodayString())) {
        preview.innerHTML = "今天是週末，請按「＋ 出勤」填寫實際工作與休息時間，才不會算錯。";
        return;
    }

    if (!end) {
        preview.textContent = "輸入今天的下班時間，就會自動試算。";
        return;
    }

    const r = calculateRecord({
        date: getTodayString(),
        dayType: "weekday",
        start,
        end,
        breakMinutes: 0
    });

    preview.innerHTML =
        `公司計薪 <strong>${numberText(r.paidHours, 1)} 小時</strong>` +
        (r.earlyPaidHours > 0 ? `（早上 ${numberText(r.earlyPaidHours, 1)} 小時）` : "") +
        ` ・ 預估 <strong>${money(r.total)}</strong>`;
}

function saveQuickRecord() {
    const today = getTodayString();
    const start = $("quickStart")?.value || settings.normalStart;
    const end = $("quickEnd")?.value || "";

    if (isWeekendDate(today)) {
        openRecord(null, today);
        if (end) $("end").value = end;
        updateRecordPreview();
        return;
    }

    if (!end) {
        alert("請先輸入今天的下班時間。");
        return;
    }

    const existing = records.find(record => record.date === today && record.dayType === "weekday");

    if (existing) {
        if (!confirm("今天已經有平日出勤紀錄，要用新的時間更新這一筆嗎？")) return;
        existing.start = start;
        existing.end = end;
    } else {
        records.push({
            id: uid(),
            date: today,
            dayType: "weekday",
            start,
            end,
            breakMinutes: 0,
            note: ""
        });
    }

    selectedMonth = getCurrentMonth();
    saveData();
    render();
    $("quickEnd").value = "";
    updateQuickPreview();
    toast("已儲存今天的出勤");
}


/* =========================================================
   彈出視窗共用
========================================================= */

function openModal(id) {
    document.querySelectorAll(".modal.show").forEach(modal => modal.classList.remove("show"));
    $(id)?.classList.add("show");
}

function closeModals() {
    document.querySelectorAll(".modal.show").forEach(modal => modal.classList.remove("show"));
}

let toastTimer = null;

function toast(message) {
    const el = $("toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

function defaultDate() {
    return selectedMonth === getCurrentMonth() ? getTodayString() : selectedMonth + "-01";
}


/* =========================================================
   出勤
========================================================= */

function applyDayTypeDefault() {
    // 新增時依日期自動帶入：週末預設休假日並扣 60 分鐘休息。
    if ($("recordId").value || !$("date").value) return;

    const weekend = isWeekendDate($("date").value);
    $("dayType").value = weekend ? "rest" : "weekday";
    $("breakMinutes").value = weekend ? 60 : 0;
}

function openRecord(id = null, date = null) {
    $("recordForm").reset();
    $("recordId").value = "";

    const record = id ? records.find(item => String(item.id) === String(id)) : null;

    if (id && !record) return;

    if (record) {
        $("recordModalTitle").textContent = "編輯出勤";
        $("recordId").value = record.id;
        $("date").value = record.date || "";
        $("dayType").value = record.dayType || "weekday";
        $("start").value = record.start || settings.normalStart;
        $("end").value = record.end || settings.normalEnd;
        $("breakMinutes").value = record.breakMinutes ?? 0;
        $("note").value = record.note || "";
    } else {
        $("recordModalTitle").textContent = "新增出勤";
        $("date").value = date || defaultDate();
        $("start").value = settings.normalStart;
        $("end").value = settings.normalEnd;
        applyDayTypeDefault();
    }

    updateRecordPreview();
    openModal("recordModal");
}

function updateRecordPreview() {
    const preview = $("preview");
    if (!preview) return;

    const record = {
        date: $("date").value,
        dayType: $("dayType").value || "weekday",
        start: $("start").value,
        end: $("end").value,
        breakMinutes: num($("breakMinutes").value)
    };

    if (!record.start || !record.end) {
        preview.innerHTML = "請輸入上下班時間。";
        return;
    }

    const r = calculateRecord(record);

    preview.innerHTML = `
        實際工作 <strong>${minutesToText(r.actualWorkMinutes)}</strong>
        ・ 實際加班 <strong>${minutesToText(r.overtimeMinutes)}</strong><br>
        公司計薪 <strong>${numberText(r.paidHours, 1)} 小時</strong>
        ${r.earlyPaidHours > 0 ? `（含早上 ${numberText(r.earlyPaidHours, 1)} 小時）` : ""}
        ・ 預估加班費 <strong>${money(r.total)}</strong>
    `;
}

function saveRecord(event) {
    event.preventDefault();

    const id = $("recordId").value.trim();

    const data = {
        id: id || uid(),
        date: $("date").value,
        dayType: $("dayType").value,
        start: $("start").value,
        end: $("end").value,
        breakMinutes: Math.max(0, num($("breakMinutes").value)),
        note: $("note").value.trim()
    };

    if (!data.date || !data.start || !data.end) {
        alert("請填寫日期、上班時間與下班時間。");
        return;
    }

    const index = records.findIndex(record => String(record.id) === String(id));

    if (id && index !== -1) records[index] = { ...records[index], ...data };
    else records.push(data);

    selectedMonth = getMonthFromDate(data.date) || selectedMonth;
    saveData();
    closeModals();
    render();
    toast("出勤已儲存");
}

function deleteRecord(id) {
    if (!confirm("確定要刪除這筆出勤紀錄嗎？")) return;

    records = records.filter(item => String(item.id) !== String(id));
    saveData();
    closeModals();
    render();
}


/* =========================================================
   請假／未上班
========================================================= */

function fillLeaveTypes() {
    const select = $("leaveType");
    if (!select || select.options.length) return;

    select.innerHTML = Object.entries(LEAVE_TYPES)
        .map(([key, type]) => `<option value="${key}">${escapeHTML(type.label)}</option>`)
        .join("");
}

function applyLeaveTypeDefault() {
    const type = LEAVE_TYPES[$("leaveType").value] || LEAVE_TYPES.other;
    $("leavePct").value = type.pct;
    $("leaveBreakFA").checked = type.breakFA;
    updateLeavePreview();
}

function openLeave(id = null, date = null, type = "typhoon") {
    fillLeaveTypes();
    $("leaveForm").reset();
    $("leaveId").value = "";

    const leave = id ? settings.leaves.find(item => String(item.id) === String(id)) : null;

    if (id && !leave) return;

    if (leave) {
        $("leaveModalTitle").textContent = "編輯請假／未上班";
        $("leaveId").value = leave.id;
        $("leaveDate").value = leave.date || "";
        $("leaveType").value = LEAVE_TYPES[leave.type] ? leave.type : "other";
        $("leaveHours").value = leave.hours ?? 8;
        $("leavePct").value = leave.pct ?? 100;
        $("leaveBreakFA").checked = Boolean(leave.breakFA);
        $("leaveNote").value = leave.note || "";
    } else {
        $("leaveModalTitle").textContent = type === "annual" ? "請特休" : "請假／未上班";
        $("leaveDate").value = date || defaultDate();
        $("leaveType").value = LEAVE_TYPES[type] ? type : "typhoon";
        $("leaveHours").value = 8;
        applyLeaveTypeDefault();
    }

    // 連續日期只在新增時提供。
    $("leaveEndDate").value = "";
    $("leaveEndField").hidden = Boolean(leave);
    $("leaveDateLabel").textContent = leave ? "日期" : "日期（連續請假填第一天）";

    updateLeavePreview();
    openModal("leaveModal");
}

// 把開始～結束日期展開成工作天清單（略過週六、週日）。
function leaveDatesFromForm() {
    const start = $("leaveDate").value;
    const end = $("leaveEndField").hidden ? "" : $("leaveEndDate").value;

    if (!start) return [];
    if (!end || end <= start) return [start];

    const dates = [];
    const cursor = new Date(start + "T00:00:00");
    const last = new Date(end + "T00:00:00");

    while (cursor <= last && dates.length < 62) {
        const day = cursor.getDay();

        if (day !== 0 && day !== 6) {
            dates.push(
                cursor.getFullYear() + "-" + pad2(cursor.getMonth() + 1) + "-" + pad2(cursor.getDate())
            );
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    return dates;
}

function updateLeavePreview() {
    const preview = $("leavePreview");
    if (!preview) return;

    const date = $("leaveDate").value;
    const dates = leaveDatesFromForm();
    const isAnnual = $("leaveType").value === "annual";
    const r = calculateLeave({
        date,
        hours: $("leaveHours").value,
        pct: $("leavePct").value
    });

    const lines = [];

    if (dates.length > 1) {
        lines.push(`共 <strong>${dates.length}</strong> 個工作天（${escapeHTML(formatShortDate(dates[0]))} ～ ${escapeHTML(formatShortDate(dates[dates.length - 1]))}，已略過週末）`);
    }

    lines.push(
        r.deduction > 0
            ? `${dates.length > 1 ? "每天" : ""}扣薪 <strong class="bad">−${money(r.deduction)}</strong>（時薪 ${money(r.hourlyRate)} × ${hoursText(r.hours)} × ${r.pct}%）` +
              (dates.length > 1 ? `，合計 <strong class="bad">−${money(r.deduction * dates.length)}</strong>` : "")
            : (isAnnual ? "特休照常給薪，不扣薪、不扣全勤。" : "這筆不扣薪，只留下紀錄。")
    );

    if (isAnnual) {
        const year = (date || getTodayString()).slice(0, 4);
        const a = annualStats(year);
        const editing = settings.leaves.find(item => String(item.id) === $("leaveId").value);
        const before = editing && editing.type === "annual" ? num(editing.hours) / 8 : 0;
        const after = a.used - before + (r.hours / 8) * Math.max(1, dates.length);

        if (a.total > 0) {
            const left = a.total - after;
            lines.push(
                left >= 0
                    ? `請完後 ${year} 年特休剩 <strong>${daysText(left)}</strong>（共 ${daysText(a.total)}）`
                    : `<span class="bad">請完後會超過特休天數 ${daysText(-left)}</span>（共 ${daysText(a.total)}）`
            );
        }
    }

    if ($("leaveBreakFA").checked) {
        lines.push(
            settings.fullAttendance > 0
                ? `當月沒有全勤，全勤獎金 <strong class="bad">${money(settings.fullAttendance)}</strong> 不發。`
                : "已勾選扣全勤；目前設定的全勤獎金是 0，可到「設定」填入金額。"
        );
    }

    preview.innerHTML = lines.join("<br>");
}

function saveLeave(event) {
    event.preventDefault();

    const id = $("leaveId").value.trim();

    const data = {
        id: id || uid(),
        date: $("leaveDate").value,
        type: $("leaveType").value,
        hours: Math.max(0, num($("leaveHours").value)),
        pct: Math.min(100, Math.max(0, num($("leavePct").value))),
        breakFA: $("leaveBreakFA").checked,
        note: $("leaveNote").value.trim()
    };

    if (!data.date) {
        alert("請填寫日期。");
        return;
    }

    const index = settings.leaves.findIndex(item => String(item.id) === String(id));
    let message = "已儲存";

    if (id && index !== -1) {
        settings.leaves[index] = data;
    } else {
        // 連續請假：每個工作天各記一筆；同一天同類型已有紀錄就略過。
        const dates = leaveDatesFromForm();
        let added = 0;

        dates.forEach(date => {
            if (settings.leaves.some(item => item.date === date && item.type === data.type)) return;
            settings.leaves.push({ ...data, id: uid(), date });
            added++;
        });

        if (!added) {
            alert("這些日期已經有同類型的紀錄了。");
            return;
        }

        if (dates.length > 1) message = `已新增 ${added} 天${getLeaveLabel(data.type)}`;
    }

    selectedMonth = getMonthFromDate(data.date) || selectedMonth;
    saveData();
    closeModals();
    render();
    toast(message);
}

function deleteLeave(id) {
    if (!confirm("確定要刪除這筆請假／未上班紀錄嗎？")) return;

    settings.leaves = settings.leaves.filter(item => String(item.id) !== String(id));
    saveData();
    closeModals();
    render();
}


/* =========================================================
   里程
========================================================= */

function openMileage(id = null, date = null) {
    $("mileageForm").reset();
    $("mileageId").value = "";

    const record = id ? mileageRecords.find(item => String(item.id) === String(id)) : null;

    if (id && !record) return;

    if (record) {
        $("mileageModalTitle").textContent = "編輯里程";
        $("mileageId").value = record.id;
        $("mileageDate").value = record.date || "";
        $("mileageKmInput").value = record.km ?? "";
        $("mileageRate").value = record.rate ?? 6;
        $("mileageWearRate").value = num(record.wearRate) > 0 ? record.wearRate : "";
        $("mileageWearInput").value = record.wear ?? 0;
        $("mileageNote").value = record.note || "";
    } else {
        $("mileageModalTitle").textContent = "新增里程";
        $("mileageDate").value = date || defaultDate();
        // 新增時帶入設定裡的每公里補助與管銷。
        $("mileageRate").value = settings.mileageRate;
        $("mileageWearRate").value = settings.mileageWearRate > 0 ? settings.mileageWearRate : "";
        $("mileageWearInput").value = 0;
    }

    updateMileagePreview();
    openModal("mileageModal");
}

function readMileageForm() {
    return {
        date: $("mileageDate").value,
        km: Math.max(0, num($("mileageKmInput").value)),
        rate: Math.max(0, num($("mileageRate").value)),
        wearRate: Math.max(0, num($("mileageWearRate").value)),
        wear: Math.max(0, num($("mileageWearInput").value)),
        note: $("mileageNote").value.trim()
    };
}

function updateMileagePreview() {
    const preview = $("mileagePreview");
    if (!preview) return;

    const r = calculateMileage(readMileageForm());

    preview.innerHTML = `
        補助 <strong>${money(r.gross)}</strong>
        − 管銷 <strong>${money(r.wear)}</strong>
        ＝ 淨利 <strong>${money(r.net)}</strong>（現金，計入總收入）
    `;
}

function saveMileage(event) {
    event.preventDefault();

    const id = $("mileageId").value.trim();
    const data = { id: id || uid(), ...readMileageForm() };

    if (!data.date || data.km <= 0) {
        alert("請填寫日期與公里數。");
        return;
    }

    const index = mileageRecords.findIndex(item => String(item.id) === String(id));

    if (id && index !== -1) mileageRecords[index] = { ...mileageRecords[index], ...data };
    else mileageRecords.push(data);

    selectedMonth = getMonthFromDate(data.date) || selectedMonth;
    saveData();
    closeModals();
    render();
    toast("里程已儲存");
}

function deleteMileage(id) {
    if (!confirm("確定要刪除這筆里程紀錄嗎？")) return;

    mileageRecords = mileageRecords.filter(item => String(item.id) !== String(id));
    saveData();
    closeModals();
    render();
}


/* =========================================================
   單月補貼／扣款
========================================================= */

function openItem(id = null) {
    $("itemForm").reset();
    $("itemId").value = "";

    const item = id ? settings.monthItems.find(row => String(row.id) === String(id)) : null;

    if (id && !item) return;

    if (item) {
        $("itemId").value = item.id;
        $("itemKind").value = item.kind === "income" ? "income" : "deduct";
        $("itemMonth").value = item.month;
        $("itemName").value = item.name || "";
        $("itemAmount").value = item.amount ?? "";
    } else {
        $("itemKind").value = "income";
        $("itemMonth").value = selectedMonth;
    }

    openModal("itemModal");
}

function saveItem(event) {
    event.preventDefault();

    const id = $("itemId").value.trim();

    const data = {
        id: id || uid(),
        kind: $("itemKind").value === "income" ? "income" : "deduct",
        month: $("itemMonth").value,
        name: $("itemName").value.trim(),
        amount: Math.max(0, num($("itemAmount").value))
    };

    if (!data.month || !data.name) {
        alert("請填寫月份與名稱。");
        return;
    }

    const index = settings.monthItems.findIndex(row => String(row.id) === String(id));

    if (id && index !== -1) settings.monthItems[index] = data;
    else settings.monthItems.push(data);

    selectedMonth = data.month;
    saveData();
    closeModals();
    render();
    toast("已儲存");
}

function deleteItem(id) {
    if (!confirm("確定要刪除這個項目嗎？")) return;

    settings.monthItems = settings.monthItems.filter(row => String(row.id) !== String(id));
    saveData();
    render();
}


/* =========================================================
   單日檢視
========================================================= */

function openDay(date) {
    const dayRecords = records.filter(item => item.date === date);
    const dayLeaves = settings.leaves.filter(item => item.date === date);
    const dayMileage = mileageRecords.filter(item => item.date === date);

    const html =
        dayRecords.map(recordItemHTML).join("") +
        dayLeaves.map(leaveItemHTML).join("") +
        dayMileage.map(mileageItemHTML).join("");

    $("dayModalTitle").textContent = formatDate(date);
    $("dayItems").innerHTML = html || '<div class="empty">這一天還沒有紀錄</div>';

    $("dayFoot").innerHTML = `
        <button class="btn primary" type="button" data-action="add-record" data-date="${date}">＋ 出勤</button>
        <button class="btn" type="button" data-action="add-annual" data-date="${date}">＋ 特休</button>
        <button class="btn" type="button" data-action="add-leave" data-date="${date}">＋ 請假／未上班</button>
        <button class="btn" type="button" data-action="add-mileage" data-date="${date}">＋ 里程</button>
    `;

    openModal("dayModal");
}


/* =========================================================
   設定
========================================================= */

function historyRowHTML(row = {}) {
    return `
        <div class="row-item" data-row="history">
            <input type="month" class="h-until" value="${escapeHTML(row.until || "")}" aria-label="到哪個月為止">
            <input type="number" class="amt h-salary" min="0" step="1" inputmode="numeric" placeholder="當時月薪" value="${escapeHTML(row.salary ?? "")}" aria-label="當時月薪">
            <button class="row-del" type="button" data-action="row-del" aria-label="刪除這一列">✕</button>
        </div>
    `;
}

function fixedRowHTML(row = {}) {
    const kind = row.kind === "income" ? "income" : "deduct";

    return `
        <div class="row-item three" data-row="fixed" data-id="${escapeHTML(row.id || "")}">
            <select class="f-kind" aria-label="類型">
                <option value="deduct" ${kind === "deduct" ? "selected" : ""}>扣款 −</option>
                <option value="income" ${kind === "income" ? "selected" : ""}>收入 ＋</option>
            </select>
            <input type="text" class="f-name" placeholder="名稱，例如：健保費" value="${escapeHTML(row.name || "")}" aria-label="名稱">
            <input type="number" class="amt f-amount" min="0" step="1" inputmode="numeric" placeholder="金額" value="${escapeHTML(row.amount ?? "")}" aria-label="金額">
            <button class="row-del" type="button" data-action="row-del" aria-label="刪除這一列">✕</button>
        </div>
    `;
}

function updateSalaryHint() {
    const salary = Math.max(0, num($("salary").value));
    const divisor = num($("dayDivisor").value) > 0 ? num($("dayDivisor").value) : 30;
    const hourly = salary / (divisor * 8);

    $("salaryHint").textContent =
        `時薪 ${money(hourly)}・日薪 ${money(salary / divisor)}・加班第 1–2 小時每小時 ${money(hourly * 1.34)}`;

    const rate = Math.max(0, num($("setMileageRate").value));
    const wear = Math.max(0, num($("setMileageWear").value));

    $("mileageHint").textContent =
        `每公里淨利 ${money(Math.max(0, rate - wear))}（補助 ${money(rate)} − 管銷 ${money(wear)}）。新增里程時自動帶入；里程是現金，不算進薪轉，但會計入總收入。`;
}

function openSettings() {
    $("salary").value = settings.salary;
    $("normalStart").value = settings.normalStart;
    $("normalEnd").value = settings.normalEnd;
    $("overtimeStart").value = settings.overtimeStart;
    $("otLimit").value = settings.otLimit;
    $("earlyOvertime").checked = settings.earlyOvertime;
    $("fullAttendance").value = settings.fullAttendance;
    $("fullAttendanceIncluded").checked = settings.fullAttendanceIncluded;
    $("dayDivisor").value = settings.dayDivisor;
    $("annualDays").value = settings.annualDays || "";
    $("setMileageRate").value = settings.mileageRate;
    $("setMileageWear").value = settings.mileageWearRate;
    $("themeSelect").value = getTheme();
    $("payNextMonth").checked = settings.payNextMonth;

    $("salaryHistoryRows").innerHTML = settings.salaryHistory.map(historyRowHTML).join("");
    $("fixedRows").innerHTML = settings.fixedItems.map(fixedRowHTML).join("");

    updateSalaryHint();
    openModal("settingsModal");
}

function saveSettings(event) {
    event.preventDefault();

    const salaryHistory = [...$("salaryHistoryRows").querySelectorAll('[data-row="history"]')]
        .map(row => ({
            until: row.querySelector(".h-until").value,
            salary: Math.max(0, num(row.querySelector(".h-salary").value))
        }))
        .filter(row => row.until && row.salary > 0)
        .sort((a, b) => a.until.localeCompare(b.until));

    const fixedItems = [...$("fixedRows").querySelectorAll('[data-row="fixed"]')]
        .map(row => ({
            id: row.dataset.id || uid(),
            kind: row.querySelector(".f-kind").value === "income" ? "income" : "deduct",
            name: row.querySelector(".f-name").value.trim(),
            amount: Math.max(0, num(row.querySelector(".f-amount").value))
        }))
        .filter(row => row.name || row.amount > 0);

    settings = normaliseSettings({
        ...settings,
        salary: Math.max(0, num($("salary").value)),
        normalStart: $("normalStart").value || "08:00",
        normalEnd: $("normalEnd").value || "17:30",
        overtimeStart: $("overtimeStart").value || "17:30",
        otLimit: Math.max(0, num($("otLimit").value)),
        earlyOvertime: $("earlyOvertime").checked,
        fullAttendance: Math.max(0, num($("fullAttendance").value)),
        fullAttendanceIncluded: $("fullAttendanceIncluded").checked,
        dayDivisor: num($("dayDivisor").value) > 0 ? num($("dayDivisor").value) : 30,
        payNextMonth: $("payNextMonth").checked,
        annualDays: Math.max(0, num($("annualDays").value)),
        mileageRate: Math.max(0, num($("setMileageRate").value)),
        mileageWearRate: Math.max(0, num($("setMileageWear").value)),
        salaryHistory,
        fixedItems
    });

    setTheme($("themeSelect").value);

    saveData();
    closeModals();
    resetQuickStart();
    renderAll();
    toast("設定已儲存");
}

function getTheme() {
    const theme = localStorage.getItem(THEME_KEY);
    return theme === "dark" || theme === "auto" ? theme : "light";
}

function setTheme(theme) {
    const value = theme === "dark" || theme === "auto" ? theme : "light";
    localStorage.setItem(THEME_KEY, value);
    document.documentElement.dataset.theme = value;
}

function resetQuickStart() {
    if ($("quickStart")) $("quickStart").value = settings.normalStart;
}


/* =========================================================
   收入帳本：計算
========================================================= */

// 獎金歸屬月份：有指定就用指定的，舊資料沒有就用入帳日的月份。
function getBonusMonth(bonus) {
    return bonus.month || getMonthFromDate(bonus.date) || "";
}

// 依入帳日推算預設的歸屬月份（次月發薪就往前推一個月）。
function defaultBonusMonth(date) {
    const month = getMonthFromDate(date);
    if (!month) return "";
    return settings.payNextMonth ? shiftMonth(month, -1) : month;
}

function sumRows(rows) {
    return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + num(row.amount), 0);
}

function sumKey(rows, key) {
    return (Array.isArray(rows) ? rows : [])
        .filter(row => row.key === key)
        .reduce((sum, row) => sum + num(row.amount), 0);
}

function hasValue(value) {
    return value !== null && value !== undefined && value !== "";
}

function slipTotals(slip) {
    const income = sumRows(slip.income);
    const deduct = sumRows(slip.deduct);
    const base = sumKey(slip.income, "base");
    const ot = sumKey(slip.income, "ot");

    return {
        income,
        deduct,
        base,
        ot,
        other: income - base - ot,
        net: hasValue(slip.received) ? num(slip.received) : income - deduct
    };
}

function yearStats(year) {
    const months = [];

    for (let m = 1; m <= 12; m++) {
        const month = year + "-" + pad2(m);
        const slip = settings.payslips[month] || null;
        const bonus = settings.bonuses
            .filter(item => getBonusMonth(item) === month)
            .reduce((sum, item) => sum + num(item.amount), 0);

        const calc = computeMonth(month);

        months.push({
            month,
            index: m,
            slip,
            totals: slip ? slipTotals(slip) : null,
            bonus,
            calc,
            // 里程是現金：補助扣掉管銷後的淨利，不在薪資單上。
            mileage: calc.mileageNet
        });
    }

    const filled = months.filter(item => item.slip);
    const full = filled.filter(item => !item.slip.partial);
    const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);

    const netTotal = sum(filled, item => item.totals.net);
    const incomeTotal = sum(filled, item => item.totals.income);
    const deductTotal = sum(filled, item => item.totals.deduct);
    const otTotal = sum(filled, item => item.totals.ot);
    const bonusTotal = sum(months, item => item.bonus);
    const bonusCount = settings.bonuses.filter(item => getBonusMonth(item).startsWith(year + "-")).length;

    const mileageTotal = sum(months, item => item.mileage);
    const mileageGross = sum(months, item => item.calc.mileageGross);
    const mileageWear = sum(months, item => item.calc.mileageWear);

    const avgNet = full.length ? sum(full, item => item.totals.net) / full.length : 0;

    // 推估全年：用最近三個整月的平均，補上還沒填的月份。
    const recent = full.slice(-3);
    const recentAvg = recent.length ? sum(recent, item => item.totals.net) / recent.length : 0;
    const lastIndex = filled.length ? filled[filled.length - 1].index : 0;
    const isCurrentYear = year === new Date().getFullYear();
    const remaining = isCurrentYear && filled.length ? 12 - lastIndex : 0;

    const best = filled.reduce(
        (top, item) => (!top || item.totals.net > top.totals.net ? item : top),
        null
    );

    return {
        months,
        filled,
        full,
        netTotal,
        incomeTotal,
        deductTotal,
        otTotal,
        bonusTotal,
        bonusCount,
        avgNet,
        mileageTotal,
        mileageGross,
        mileageWear,
        yearTotal: netTotal + bonusTotal + mileageTotal,
        remaining,
        projection: netTotal + bonusTotal + mileageTotal + recentAvg * remaining,
        best
    };
}


/* =========================================================
   收入帳本：畫面
========================================================= */

function shortMoney(value) {
    const n = Math.round(num(value));
    return Math.abs(n) >= 10000 ? (n / 10000).toFixed(1) + "萬" : n.toLocaleString("zh-TW");
}

function renderLedger() {
    const s = yearStats(selectedYear);

    if ($("yearLabel")) {
        $("yearLabel").innerHTML = `${selectedYear}<small>民國 ${selectedYear - 1911} 年</small>`;
    }

    renderKpis(s);
    renderChart(s);
    renderLedgerTable(s);
    renderBonuses();
}

function renderKpis(s) {
    const el = $("kpis");
    if (!el) return;

    const count = s.filled.length;
    const otShare = s.incomeTotal > 0 ? Math.round(s.otTotal / s.incomeTotal * 100) : 0;

    el.innerHTML = `
        <div class="kpi lead">
            <span>年度總收入</span>
            <strong>${signedMoney(s.yearTotal)}</strong>
            <small>薪轉 ${money(s.netTotal)} ＋ 獎金 ${money(s.bonusTotal)} ＋ 里程現金 ${money(s.mileageTotal)}</small>
        </div>
        <div class="kpi">
            <span>月平均實領（薪轉）</span>
            <strong>${money(s.avgNet)}</strong>
            <small>${s.full.length} 個整月平均，不含獎金與里程</small>
        </div>
        <div class="kpi">
            <span>${s.remaining > 0 ? "預估全年收入" : "年度應發總額"}</span>
            <strong>${money(s.remaining > 0 ? s.projection : s.incomeTotal)}</strong>
            <small>${s.remaining > 0 ? `剩 ${s.remaining} 個月以近期平均推估` : `已填 ${count} 個月`}</small>
        </div>
        <div class="kpi">
            <span>里程淨利（現金）</span>
            <strong>${money(s.mileageTotal)}</strong>
            <small>補助 ${money(s.mileageGross)} − 管銷 ${money(s.mileageWear)}</small>
        </div>
        <div class="kpi">
            <span>加班費合計</span>
            <strong>${money(s.otTotal)}</strong>
            <small>占應發 ${otShare}%</small>
        </div>
        <div class="kpi">
            <span>扣款合計</span>
            <strong>${money(s.deductTotal)}</strong>
            <small>平均每月 ${money(count ? s.deductTotal / count : 0)}</small>
        </div>
        <div class="kpi">
            <span>獎金／年終</span>
            <strong>${money(s.bonusTotal)}</strong>
            <small>${s.bonusCount} 筆</small>
        </div>
        <div class="kpi">
            <span>最高月份</span>
            <strong>${s.best ? money(s.best.totals.net) : "—"}</strong>
            <small>${s.best ? s.best.index + " 月" : "尚未填寫"}</small>
        </div>
    `;
}

function renderChart(s) {
    const chart = $("chart");
    const axis = $("chartX");
    if (!chart || !axis) return;

    const heights = s.months.map(item => (item.totals ? Math.max(0, item.totals.income) : 0) + item.bonus + item.mileage);
    const max = Math.max(1, ...heights);

    chart.innerHTML = s.months.map((item, i) => {
        const t = item.totals;
        const total = heights[i];

        if (!total) {
            return `
                <button class="bar-col" type="button" data-action="edit-slip" data-month="${item.month}" title="${item.index} 月：尚未填寫">
                    <span class="bar-stub"></span>
                </button>
            `;
        }

        const segs = [
            [t ? t.base : 0, "var(--c-base)"],
            [t ? t.ot : 0, "var(--c-ot)"],
            [t ? Math.max(0, t.other) : 0, "var(--c-other)"],
            [item.bonus, "var(--c-bonus)"],
            [item.mileage, "var(--c-mileage)"]
        ].filter(seg => seg[0] > 0);

        const net = (t ? t.net : 0) + item.bonus + item.mileage;
        const tip = `${item.index} 月：總收入 ${money(net)}` +
            (t ? `（薪轉 ${money(t.net)}：應發 ${money(t.income)}、扣款 ${money(t.deduct)}）` : "") +
            (item.bonus ? `、獎金 ${money(item.bonus)}` : "") +
            (item.mileage ? `、里程現金 ${money(item.mileage)}` : "");

        return `
            <button class="bar-col" type="button" data-action="edit-slip" data-month="${item.month}" title="${escapeHTML(tip)}">
                <span class="bar-val">${shortMoney(net)}</span>
                <span class="bar" style="height:calc((100% - 20px) * ${(total / max).toFixed(4)})">
                    ${segs.map(seg => `<i style="flex:${Math.round(seg[0])} 1 0;background:${seg[1]}"></i>`).join("")}
                </span>
            </button>
        `;
    }).join("");

    axis.innerHTML = s.months.map(item => `<span>${item.index}月</span>`).join("");
}

function renderLedgerTable(s) {
    const el = $("ledgerTable");
    if (!el) return;

    const rows = s.months.map(item => {
        const calc = item.calc;
        const estimate = calc.hasData ? calc.payNet : null;
        const cash = item.mileage > 0 ? money(item.mileage) : "—";

        if (!item.slip) {
            return `
                <tr class="blank">
                    <td>${item.index} 月</td>
                    <td class="col-hide">—</td>
                    <td class="col-hide">—</td>
                    <td>—</td>
                    <td class="cash">${cash}</td>
                    <td>${item.mileage > 0 ? money(item.mileage) : "—"}</td>
                    <td class="col-hide">${estimate === null ? "—" : money(estimate)}</td>
                    <td class="col-hide">—</td>
                    <td><button class="btn sm" type="button" data-action="edit-slip" data-month="${item.month}">填寫</button></td>
                </tr>
            `;
        }

        const t = item.totals;
        const diff = estimate === null ? null : t.net - estimate;
        const memo = [item.slip.partial ? "未滿整月" : "", item.slip.note || ""].filter(Boolean).join("・");

        return `
            <tr>
                <td>${item.index} 月${memo ? `<span class="memo">${escapeHTML(memo)}</span>` : ""}</td>
                <td class="col-hide">${money(t.income)}</td>
                <td class="col-hide ${t.deduct > 0 ? "neg" : ""}">${t.deduct > 0 ? "−" + money(t.deduct) : "$0"}</td>
                <td>${signedMoney(t.net)}</td>
                <td class="cash">${cash}</td>
                <td class="net">${signedMoney(t.net + item.mileage)}</td>
                <td class="col-hide">${estimate === null ? "—" : money(estimate)}</td>
                <td class="col-hide ${diff === null || Math.round(diff) === 0 ? "" : diff > 0 ? "pos" : "neg"}">${diff === null ? "—" : (diff > 0 ? "+" : "") + signedMoney(diff)}</td>
                <td><button class="btn sm" type="button" data-action="edit-slip" data-month="${item.month}">編輯</button></td>
            </tr>
        `;
    });

    el.innerHTML = `
        <thead>
            <tr>
                <th>月份</th>
                <th class="col-hide">應發</th>
                <th class="col-hide">扣款</th>
                <th>實領（薪轉）</th>
                <th>里程（現金）</th>
                <th>合計</th>
                <th class="col-hide">試算</th>
                <th class="col-hide">差額</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            ${rows.join("")}
            <tr class="sum">
                <td>全年合計</td>
                <td class="col-hide">${money(s.incomeTotal)}</td>
                <td class="col-hide ${s.deductTotal > 0 ? "neg" : ""}">${s.deductTotal > 0 ? "−" : ""}${money(s.deductTotal)}</td>
                <td>${signedMoney(s.netTotal)}</td>
                <td class="cash">${money(s.mileageTotal)}</td>
                <td class="net">${signedMoney(s.netTotal + s.mileageTotal)}</td>
                <td class="col-hide"></td>
                <td class="col-hide"></td>
                <td></td>
            </tr>
        </tbody>
    `;
}

function renderBonuses() {
    const el = $("bonuses");
    if (!el) return;

    const list = sortByDate(
        settings.bonuses.filter(item => getBonusMonth(item).startsWith(selectedYear + "-")),
        "desc"
    );

    el.innerHTML = list.length
        ? list.map(item => `
            <div class="item">
                <div class="item-top">
                    <div>
                        <div class="item-title">${escapeHTML(item.name || "獎金")}</div>
                        <div class="item-sub">${escapeHTML(formatDate(item.date))} 入帳${item.note ? "<br>" + escapeHTML(item.note) : ""}</div>
                    </div>
                    <div class="item-amt">${money(item.amount)}</div>
                </div>
                <div class="item-foot">
                    <div class="tags">
                        <span class="tag gold">獎金</span>
                        <span class="tag green">算在 ${escapeHTML(formatMonth(getBonusMonth(item)))}</span>
                    </div>
                    <div class="item-btns">
                        <button class="link-btn" type="button" data-action="edit-bonus" data-id="${escapeHTML(item.id)}">編輯</button>
                        <button class="link-btn del" type="button" data-action="delete-bonus" data-id="${escapeHTML(item.id)}">刪除</button>
                    </div>
                </div>
            </div>
        `).join("")
        : `<div class="empty">${selectedYear} 年還沒有獎金或年終紀錄</div>`;
}


/* =========================================================
   月薪單（每月實領）
========================================================= */

let slipOriginalMonth = "";

function slipRowHTML(row = {}) {
    return `
        <div class="row-item" data-row="slip" data-key="${escapeHTML(row.key || "")}">
            <input type="text" class="s-name" placeholder="項目名稱" value="${escapeHTML(row.name || "")}" aria-label="項目名稱">
            <input type="number" class="amt s-amount" step="1" inputmode="numeric" placeholder="0" value="${escapeHTML(hasValue(row.amount) && num(row.amount) !== 0 ? row.amount : "")}" aria-label="金額">
            <button class="row-del" type="button" data-action="row-del" aria-label="刪除這一列">✕</button>
        </div>
    `;
}

function readSlipRows(containerId) {
    return [...$(containerId).querySelectorAll('[data-row="slip"]')]
        .map(row => {
            const item = {
                name: row.querySelector(".s-name").value.trim(),
                amount: num(row.querySelector(".s-amount").value)
            };
            if (row.dataset.key) item.key = row.dataset.key;
            return item;
        })
        .filter(item => item.name || item.amount);
}

function newSlipTemplate(month) {
    // 沿用最近一次填過的項目；扣款金額（勞健保、眷屬）直接帶入。
    const months = Object.keys(settings.payslips).sort();
    const previous = months.filter(key => key < month).pop() || months.pop();

    if (!previous) {
        return {
            income: SLIP_TEMPLATE.income.map(row => ({ ...row, amount: "" })),
            deduct: SLIP_TEMPLATE.deduct.map(row => ({ ...row, amount: "" }))
        };
    }

    const source = settings.payslips[previous];

    return {
        income: (source.income || []).map(row => ({
            ...row,
            amount: row.key === "base" ? row.amount : ""
        })),
        deduct: (source.deduct || []).map(row => ({ ...row }))
    };
}

function loadSlipIntoForm(month) {
    const existing = settings.payslips[month];
    const slip = existing || newSlipTemplate(month);

    const withTemplate = (rows, template) => {
        const list = (rows || []).map(row => ({ ...row }));
        template.forEach(item => {
            if (!list.some(row => row.key === item.key)) list.push({ ...item, amount: "" });
        });
        return list;
    };

    $("slipModalTitle").textContent = (existing ? "編輯 " : "填寫 ") + formatMonth(month) + " 月薪";
    $("slipIncome").innerHTML = withTemplate(slip.income, SLIP_TEMPLATE.income).map(slipRowHTML).join("");
    $("slipDeduct").innerHTML = withTemplate(slip.deduct, SLIP_TEMPLATE.deduct).map(slipRowHTML).join("");
    $("slipReceived").value = existing && hasValue(existing.received) ? existing.received : "";
    $("slipPartial").checked = Boolean(existing && existing.partial);
    $("slipNote").value = existing ? existing.note || "" : "";
    $("slipDeleteBtn").hidden = !existing;

    updateSlipSummary();
}

function openSlip(month = null) {
    const target = month || (
        selectedYear === new Date().getFullYear()
            ? getCurrentMonth()
            : selectedYear + "-01"
    );

    slipOriginalMonth = settings.payslips[target] ? target : "";
    $("slipMonth").value = target;
    loadSlipIntoForm(target);
    openModal("slipModal");
}

function updateSlipSummary() {
    const income = sumRows(readSlipRows("slipIncome"));
    const deduct = sumRows(readSlipRows("slipDeduct"));
    const received = $("slipReceived").value;

    $("slipSumIncome").textContent = money(income);
    $("slipSumDeduct").textContent = (deduct > 0 ? "−" : "") + money(deduct);
    $("slipSumNet").textContent = signedMoney(hasValue(received) ? num(received) : income - deduct);
}

function setSlipRow(containerId, match, name, amount, key = "") {
    const rows = [...$(containerId).querySelectorAll('[data-row="slip"]')];
    let row = rows.find(match);

    if (!row) {
        if (!amount) return;
        $(containerId).insertAdjacentHTML("beforeend", slipRowHTML({ key, name, amount }));
        return;
    }

    row.querySelector(".s-amount").value = amount ? Math.round(amount) : "";
}

function fillSlipFromCalc() {
    const month = $("slipMonth").value;

    if (!month) {
        alert("請先選擇薪資月份。");
        return;
    }

    const c = computeMonth(month);
    const byKey = key => row => row.dataset.key === key;
    const byName = name => row => row.querySelector(".s-name").value.trim() === name;

    setSlipRow("slipIncome", byKey("base"), "基本薪資", c.salary + c.faBonus - c.attendanceDeduct, "base");
    setSlipRow("slipIncome", byKey("ot"), "加班費", c.overtimePay, "ot");

    settings.fixedItems.forEach(item => {
        if (!item.name) return;
        setSlipRow(item.kind === "income" ? "slipIncome" : "slipDeduct", byName(item.name), item.name, num(item.amount));
    });

    c.monthItems.forEach(item => {
        if (!item.name) return;
        setSlipRow(item.kind === "income" ? "slipIncome" : "slipDeduct", byName(item.name), item.name, num(item.amount));
    });

    updateSlipSummary();
    toast("已帶入 " + formatMonth(month) + " 的試算金額");
}

function saveSlip(event) {
    event.preventDefault();

    const month = $("slipMonth").value;

    if (!month) {
        alert("請選擇薪資月份。");
        return;
    }

    if (month !== slipOriginalMonth && settings.payslips[month]) {
        if (!confirm(formatMonth(month) + " 已經有紀錄，要覆蓋嗎？")) return;
    }

    const received = $("slipReceived").value;

    const slip = {
        income: readSlipRows("slipIncome"),
        deduct: readSlipRows("slipDeduct"),
        received: hasValue(received) ? num(received) : null,
        partial: $("slipPartial").checked,
        note: $("slipNote").value.trim()
    };

    if (slipOriginalMonth && slipOriginalMonth !== month) {
        delete settings.payslips[slipOriginalMonth];
    }

    settings.payslips[month] = slip;
    selectedYear = Number(month.slice(0, 4)) || selectedYear;

    saveData();
    closeModals();
    renderLedger();
    toast(formatMonth(month) + " 已儲存");
}

function deleteSlip() {
    if (!slipOriginalMonth) return;
    if (!confirm("確定要刪除 " + formatMonth(slipOriginalMonth) + " 的月薪紀錄嗎？")) return;

    delete settings.payslips[slipOriginalMonth];
    saveData();
    closeModals();
    renderLedger();
}


/* =========================================================
   獎金／年終
========================================================= */

let bonusMonthTouched = false;

function updateBonusMonthHint() {
    const date = $("bonusDate").value;
    const month = $("bonusMonth").value;

    // 還沒手動改過歸屬月份時，跟著入帳日自動帶入。
    if (!bonusMonthTouched && date) {
        $("bonusMonth").value = defaultBonusMonth(date);
    }

    const current = $("bonusMonth").value || month;

    $("bonusMonthHint").textContent = current
        ? `這筆會統計在 ${formatMonth(current)}（圖表與年度都依這個月份），入帳日只是紀錄。`
        : "入帳日只是紀錄；統計依「算在哪個月」。";
}

function openBonus(id = null) {
    $("bonusForm").reset();
    $("bonusId").value = "";
    bonusMonthTouched = false;

    const bonus = id ? settings.bonuses.find(item => String(item.id) === String(id)) : null;

    if (id && !bonus) return;

    if (bonus) {
        $("bonusModalTitle").textContent = "編輯獎金";
        $("bonusId").value = bonus.id;
        $("bonusDate").value = bonus.date || "";
        $("bonusMonth").value = getBonusMonth(bonus);
        bonusMonthTouched = true;
        $("bonusName").value = bonus.name || "";
        $("bonusAmount").value = bonus.amount ?? "";
        $("bonusNote").value = bonus.note || "";
    } else {
        $("bonusModalTitle").textContent = "新增獎金／年終";
        $("bonusDate").value =
            selectedYear === new Date().getFullYear() ? getTodayString() : selectedYear + "-01-01";
    }

    updateBonusMonthHint();
    openModal("bonusModal");
}

function saveBonus(event) {
    event.preventDefault();

    const id = $("bonusId").value.trim();

    const data = {
        id: id || uid(),
        date: $("bonusDate").value,
        month: $("bonusMonth").value || getMonthFromDate($("bonusDate").value),
        name: $("bonusName").value.trim(),
        amount: Math.max(0, num($("bonusAmount").value)),
        note: $("bonusNote").value.trim()
    };

    if (!data.date || !data.name) {
        alert("請填寫日期與名稱。");
        return;
    }

    const index = settings.bonuses.findIndex(item => String(item.id) === String(id));

    if (id && index !== -1) settings.bonuses[index] = data;
    else settings.bonuses.push(data);

    selectedYear = Number(data.month.slice(0, 4)) || selectedYear;
    saveData();
    closeModals();
    renderLedger();
    toast("獎金已儲存，算在 " + formatMonth(data.month));
}

function deleteBonus(id) {
    if (!confirm("確定要刪除這筆獎金紀錄嗎？")) return;

    settings.bonuses = settings.bonuses.filter(item => String(item.id) !== String(id));
    saveData();
    renderLedger();
}


/* =========================================================
   清除／匯出／匯入
========================================================= */

function clearCurrentMonth() {
    if (!confirm(`確定要清除 ${formatMonth(selectedMonth)} 的出勤、請假、里程與單月補貼／扣款嗎？\n（收入帳本不受影響）`)) return;

    records = records.filter(item => getMonthFromDate(item.date) !== selectedMonth);
    mileageRecords = mileageRecords.filter(item => getMonthFromDate(item.date) !== selectedMonth);
    settings.leaves = settings.leaves.filter(item => getMonthFromDate(item.date) !== selectedMonth);
    settings.monthItems = settings.monthItems.filter(item => item.month !== selectedMonth);

    saveData();
    renderAll();
}

function clearAllRecords() {
    if (!confirm("確定要清除全部月份的出勤、請假、里程與單月補貼／扣款嗎？此操作無法復原。\n（設定與收入帳本會保留）")) return;
    if (!confirm("再次確認：真的要刪除全部出勤資料嗎？")) return;

    records = [];
    mileageRecords = [];
    settings.leaves = [];
    settings.monthItems = [];

    saveData();
    renderAll();
}

function exportData() {
    const data = {
        version: "YAO_OVERTIME_V3.0",
        exportedAt: new Date().toISOString(),
        records,
        mileageRecords,
        settings
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "YAO_薪資備份_" + getTodayString() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function () {
        try {
            const data = JSON.parse(reader.result);

            if (!data || typeof data !== "object") throw new Error("資料格式錯誤");

            // 只含收入帳本的檔案：合併進現有資料，不動出勤。
            if (data.ledgerOnly) {
                const slips = data.payslips && typeof data.payslips === "object" ? data.payslips : {};
                const bonuses = Array.isArray(data.bonuses) ? data.bonuses : [];
                const count = Object.keys(slips).length;

                if (!confirm(`要匯入 ${count} 個月的月薪紀錄與 ${bonuses.length} 筆獎金嗎？同月份會被檔案內容取代。`)) return;

                settings.payslips = { ...settings.payslips, ...slips };

                bonuses.forEach(bonus => {
                    if (!settings.bonuses.some(item => String(item.id) === String(bonus.id))) {
                        settings.bonuses.push(bonus);
                    }
                });

                const firstMonth = Object.keys(slips).sort()[0];
                if (firstMonth) selectedYear = Number(firstMonth.slice(0, 4)) || selectedYear;

                saveData();
                renderAll();
                switchTab("ledger");
                toast("收入帳本匯入完成");
                return;
            }

            if (!confirm("匯入會覆蓋目前的出勤、里程與設定，確定要繼續嗎？")) return;

            if (Array.isArray(data.records)) records = data.records;
            if (Array.isArray(data.mileageRecords)) mileageRecords = data.mileageRecords;

            if (data.settings && typeof data.settings === "object") {
                // 舊版備份沒有 V3 的欄位，保留目前已填的請假與收入帳本。
                settings = normaliseSettings({ ...settings, ...data.settings });
            }

            saveData();
            resetQuickStart();
            renderAll();
            toast("資料匯入完成");

        } catch (error) {
            console.error("匯入失敗：", error);
            alert("匯入失敗，請確認 JSON 檔案是否正確。");
        } finally {
            event.target.value = "";
        }
    };

    reader.readAsText(file, "utf-8");
}


/* =========================================================
   分頁
========================================================= */

function switchTab(tab) {
    activeTab = tab === "ledger" ? "ledger" : "calc";
    localStorage.setItem(TAB_KEY, activeTab);

    $("tab-calc").hidden = activeTab !== "calc";
    $("tab-ledger").hidden = activeTab !== "ledger";

    document.querySelectorAll(".tab").forEach(button => {
        button.classList.toggle("active", button.dataset.tab === activeTab);
    });

    if (activeTab === "ledger") renderLedger();
    else render();

    window.scrollTo({ top: 0 });
}
/* =========================================================
   PDF HELPERS
========================================================= */

function pdfMoney(
    value
) {

    return money(value);
}


function pdfHours(
    value
) {

    return (
        Number(value || 0)
            .toFixed(1) +
        " h"
    );
}


/* =========================================================
   PDF MULTIPLIER SUMMARY
========================================================= */

function getPDFMultiplierSummary(
    monthRecords
) {

    const summary = {

        "1.34": {

            hours: 0,

            pay: 0,

            dates: []
        },

        "1.67": {

            hours: 0,

            pay: 0,

            dates: []
        },

        "2.67": {

            hours: 0,

            pay: 0,

            dates: []
        }
    };


    monthRecords.forEach(
        record => {

            const result =
                calculateRecord(
                    record
                );


            if (
                result.firstTwoHours >
                0
            ) {

                summary["1.34"].hours +=
                    result.firstTwoHours;


                summary["1.34"].pay +=
                    result.payFirst;


                summary["1.34"].dates.push(
                    formatShortDate(
                        record.date
                    ) +
                    " " +
                    pdfHours(
                        result.firstTwoHours
                    )
                );
            }


            if (
                result.thirdToEighth >
                0
            ) {

                summary["1.67"].hours +=
                    result.thirdToEighth;


                summary["1.67"].pay +=
                    result.paySecond;


                summary["1.67"].dates.push(
                    formatShortDate(
                        record.date
                    ) +
                    " " +
                    pdfHours(
                        result.thirdToEighth
                    )
                );
            }


            if (
                result.ninthToTwelfth >
                0
            ) {

                summary["2.67"].hours +=
                    result.ninthToTwelfth;


                summary["2.67"].pay +=
                    result.payThird;


                summary["2.67"].dates.push(
                    formatShortDate(
                        record.date
                    ) +
                    " " +
                    pdfHours(
                        result.ninthToTwelfth
                    )
                );
            }

        }
    );


    return summary;
}


/* =========================================================
   PDF TOTALS
========================================================= */

function getPDFTotals() {

    const monthRecords =
        getMonthRecords();


    const monthMileageRecords =
        getMonthMileageRecords();


    let overtimePay = 0;

    let paidHours = 0;

    let actualOvertimeMinutes =
        0;

    let overtimeDays = 0;


    let mileageGross = 0;

    let mileageWear = 0;

    let mileageNet = 0;

    let mileageKm = 0;


    let weekdayHours = 0;

    let restHours = 0;

    let holidayHours = 0;


    monthRecords.forEach(
        record => {

            const result =
                calculateRecord(
                    record
                );


            overtimePay +=
                result.total;


            paidHours +=
                result.paidHours;


            actualOvertimeMinutes +=
                result.overtimeMinutes;


            if (
                result.overtimeMinutes >
                0
            ) {

                overtimeDays++;
            }


            if (
                record.dayType ===
                "weekday"
            ) {

                weekdayHours +=
                    result.paidHours;

            } else if (
                record.dayType ===
                "rest"
            ) {

                restHours +=
                    result.paidHours;

            } else if (
                record.dayType ===
                "holiday"
            ) {

                holidayHours +=
                    result.paidHours;
            }

        }
    );


    monthMileageRecords.forEach(
        record => {

            const result =
                calculateMileage(
                    record
                );


            mileageKm +=
                result.km;


            mileageGross +=
                result.gross;


            mileageWear +=
                result.wear;


            mileageNet +=
                result.net;

        }
    );


    const monthCalc =
        computeMonth(selectedMonth);

    // V3：總收入含請假扣薪、全勤、補貼與固定扣款。
    const extraIncome =
        monthCalc.totalIncome -
        monthCalc.salary;


    const totalIncome =
        monthCalc.totalIncome;


    return {

        overtimePay,

        paidHours,

        actualOvertimeMinutes,

        overtimeDays,

        mileageKm,

        mileageGross,

        mileageWear,

        mileageNet,

        extraIncome,

        totalIncome,

        weekdayHours,

        restHours,

        holidayHours
    };
}


/* =========================================================
   PDF HTML
   V1.5 排版精修
========================================================= */

function buildSalaryPDF() {

    const monthRecords =
        getMonthRecords();


    const monthMileageRecords =
        getMonthMileageRecords();


    const totals =
        getPDFTotals();


    const multiplierSummary =
        getPDFMultiplierSummary(
            monthRecords
        );


    /* V3：請假、補貼、扣款與里程現金 */
    const calc =
        computeMonth(selectedMonth);

    const settlementRow = (label, amount, negative = false) => `
            <div class="settlement-row">
                <span class="settlement-label">
                    ${escapeHTML(label)}
                </span>
                <span class="settlement-value">
                    ${negative ? "- " : ""}${pdfMoney(amount)}
                </span>
            </div>
        `;

    const incomeRows = [
        calc.faBonus ? settlementRow("全勤獎金", calc.faBonus) : "",
        ...settings.fixedItems
            .filter(item => item.kind === "income")
            .map(item => settlementRow((item.name || "固定津貼") + "（每月固定）", item.amount)),
        ...calc.monthItems
            .filter(item => item.kind === "income")
            .map(item => settlementRow(item.name || "補貼", item.amount))
    ].join("");

    const deductRows = [
        calc.leaveDeduct ? settlementRow("請假／未上班扣薪", calc.leaveDeduct, true) : "",
        calc.faDeduct ? settlementRow("全勤獎金扣除", calc.faDeduct, true) : "",
        ...settings.fixedItems
            .filter(item => item.kind !== "income")
            .map(item => settlementRow((item.name || "固定扣款") + "（每月固定）", item.amount, true)),
        ...calc.monthItems
            .filter(item => item.kind !== "income")
            .map(item => settlementRow(item.name || "扣款", item.amount, true))
    ].join("");

    const leaveRows = calc.monthLeaves
        .slice()
        .sort((x, y) => String(x.date).localeCompare(String(y.date)))
        .map(leave => {
            const result = calculateLeave(leave);

            return `
                <tr>
                    <td class="date-cell">
                        ${escapeHTML(formatShortDate(leave.date))}
                    </td>
                    <td>
                        ${escapeHTML(getLeaveLabel(leave.type))}
                    </td>
                    <td>
                        ${escapeHTML(leave.note || "—")}
                    </td>
                    <td>
                        ${pdfHours(result.hours)}
                    </td>
                    <td>
                        ${result.pct}%${leave.breakFA ? "・扣全勤" : ""}
                    </td>
                    <td class="money ${result.deduction > 0 ? "negative" : ""}">
                        ${result.deduction > 0 ? "- " + pdfMoney(result.deduction) : "照常給薪"}
                    </td>
                </tr>
            `;
        })
        .join("");

    const leaveSection = calc.monthLeaves.length ? `
    <section class="section">

        <h2 class="section-title">
            請假／未上班明細
        </h2>

        <table class="daily-table">
            <thead>
                <tr>
                    <th>日期</th>
                    <th>類型</th>
                    <th>備註</th>
                    <th>時數</th>
                    <th>扣薪比例</th>
                    <th>扣薪</th>
                </tr>
            </thead>
            <tbody>
                ${leaveRows}
                <tr class="total-row">
                    <td colspan="3">本月合計</td>
                    <td>${pdfHours(calc.leaveHours)}</td>
                    <td>—</td>
                    <td class="money">${calc.leaveDeduct > 0 ? "- " + pdfMoney(calc.leaveDeduct) : pdfMoney(0)}</td>
                </tr>
            </tbody>
        </table>

        <div class="note">
            扣薪＝時薪 × 時數 × 扣薪比例；特休照常給薪。
        </div>

    </section>
    ` : "";

    const generatedAt =
        new Date();


    const generatedText =
        generatedAt.getFullYear() +
        "/" +
        pad2(
            generatedAt.getMonth() + 1
        ) +
        "/" +
        pad2(
            generatedAt.getDate()
        ) +
        " " +
        pad2(
            generatedAt.getHours()
        ) +
        ":" +
        pad2(
            generatedAt.getMinutes()
        );


    /* =====================================================
       每日加班明細
       V1.5：簡化欄位
    ===================================================== */

    const recordRows =
        monthRecords
            .map(
                record => {

                    const result =
                        calculateRecord(
                            record
                        );


                    return `

                        <tr>

                            <td class="date-cell">
                                ${escapeHTML(
                                    formatShortDate(
                                        record.date
                                    )
                                )}
                            </td>


                            <td>
                                ${escapeHTML(
                                    getDayTypeText(
                                        record.dayType
                                    )
                                )}
                            </td>


                            <td class="time-cell">

                                ${escapeHTML(
                                    record.start ||
                                    ""
                                )}

                                <span class="arrow">
                                    →
                                </span>

                                ${escapeHTML(
                                    record.end ||
                                    ""
                                )}

                            </td>


                            <td>
                                ${minutesToText(
                                    result.overtimeMinutes
                                )}
                            </td>


                            <td>
                                ${pdfHours(
                                    result.paidHours
                                )}
                            </td>


                            <td class="money">
                                ${pdfMoney(
                                    result.total
                                )}
                            </td>

                        </tr>

                    `;
                }
            )
            .join("");


    /* =====================================================
       里程明細
    ===================================================== */

    const mileageRows =
        monthMileageRecords
            .map(
                record => {

                    const result =
                        calculateMileage(
                            record
                        );


                    const wearMethod =
                        result.wearRate > 0
                            ? (
                                numberText(
                                    result.wearRate,
                                    1
                                ) +
                                " / km"
                            )
                            : "固定";


                    return `

                        <tr>

                            <td class="date-cell">

                                ${escapeHTML(
                                    formatShortDate(
                                        record.date
                                    )
                                )}

                            </td>


                            <td>

                                ${numberText(
                                    result.km,
                                    1
                                )}

                                km

                            </td>


                            <td>

                                ${pdfMoney(
                                    result.rate
                                )}

                                / km

                            </td>


                            <td>

                                ${escapeHTML(
                                    wearMethod
                                )}

                            </td>


                            <td class="money">

                                ${pdfMoney(
                                    result.gross
                                )}

                            </td>


                            <td class="money negative">

                                - ${pdfMoney(
                                    result.wear
                                )}

                            </td>


                            <td class="money positive">

                                ${pdfMoney(
                                    result.net
                                )}

                            </td>

                        </tr>

                    `;
                }
            )
            .join("");


    /* =====================================================
       倍率區塊
    ===================================================== */

    const multiplierCards = [

        {
            key: "1.34",

            title: "1.34×",

            subtitle:
                "前 2 小時"
        },

        {
            key: "1.67",

            title: "1.67×",

            subtitle:
                "第 3～8 小時"
        },

        {
            key: "2.67",

            title: "2.67×",

            subtitle:
                "第 9 小時以上"
        }

    ]
        .map(
            item => {

                const data =
                    multiplierSummary[
                        item.key
                    ];


                return `

                    <div class="multiplier-card">

                        <div class="multiplier-top">

                            <div>

                                <div class="multiplier-title">

                                    ${item.title}

                                </div>

                                <div class="multiplier-subtitle">

                                    ${item.subtitle}

                                </div>

                            </div>


                            <div class="multiplier-hours">

                                ${pdfHours(
                                    data.hours
                                )}

                            </div>

                        </div>


                        <div class="multiplier-pay">

                            ${pdfMoney(
                                data.pay
                            )}

                        </div>

                    </div>

                `;
            }
        )
        .join("");


    /* =====================================================
       空資料
    ===================================================== */

    const emptyRecordText =
        monthRecords.length
            ? ""
            : `

                <tr>

                    <td
                        colspan="6"
                        class="empty"
                    >
                        本月沒有加班紀錄
                    </td>

                </tr>

            `;


    const emptyMileageText =
        monthMileageRecords.length
            ? ""
            : `

                <tr>

                    <td
                        colspan="7"
                        class="empty"
                    >
                        本月沒有里程紀錄
                    </td>

                </tr>

            `;


    /* =====================================================
       本月結算文字
    ===================================================== */

    const overtimeLabel =
        totals.overtimePay > 0
            ? "＋"
            : "";


    const mileageLabel =
        totals.mileageNet > 0
            ? "＋"
            : "";


    return `

<!doctype html>

<html lang="zh-Hant">

<head>

<meta charset="UTF-8">


<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>


<title>
    YAO 薪資明細
</title>


<style>

/* =====================================================
   PAGE
===================================================== */

@page {

    size: A4 portrait;

    margin: 12mm;
}


* {

    box-sizing: border-box;
}


html,
body {

    margin: 0;

    padding: 0;
}


body {

    font-family:
        "Noto Sans TC",
        "Microsoft JhengHei",
        "PingFang TC",
        sans-serif;

    color: #172033;

    background: #ffffff;

    font-size: 10px;

    line-height: 1.55;

    -webkit-print-color-adjust:
        exact;

    print-color-adjust:
        exact;
}


.page {

    width: 100%;
}


/* =====================================================
   HEADER
===================================================== */

.header {

    position: relative;

    background:
        linear-gradient(
            135deg,
            #172033 0%,
            #24364f 100%
        );

    color: #ffffff;

    padding: 20px 22px;

    border-radius: 12px;

    margin-bottom: 16px;

    overflow: hidden;
}


.header::after {

    content: "";

    position: absolute;

    width: 110px;

    height: 110px;

    right: -35px;

    top: -45px;

    border-radius: 50%;

    background:
        rgba(
            126,
            180,
            220,
            0.13
        );
}


.header-title {

    position: relative;

    z-index: 1;

    font-size: 21px;

    font-weight: 800;

    letter-spacing: .4px;
}


.header-subtitle {

    position: relative;

    z-index: 1;

    margin-top: 4px;

    color: #cbd5e1;

    font-size: 9px;

    letter-spacing: .2px;
}


.header-info {

    position: relative;

    z-index: 1;

    display: flex;

    justify-content:
        space-between;

    align-items: flex-end;

    gap: 20px;

    margin-top: 15px;
}


.header-month {

    font-size: 14px;

    font-weight: 800;
}


.generated {

    color: #cbd5e1;

    font-size: 9px;

    text-align: right;
}


/* =====================================================
   SECTION
===================================================== */

.section {

    margin-bottom: 17px;

    break-inside: avoid;

    page-break-inside: avoid;
}


.section-title {

    position: relative;

    font-size: 13px;

    font-weight: 800;

    margin: 0 0 9px;

    padding-left: 9px;

    color: #172033;
}


.section-title::before {

    content: "";

    position: absolute;

    left: 0;

    top: 3px;

    width: 4px;

    height: 14px;

    border-radius: 3px;

    background: #5b8db8;
}


/* =====================================================
   SUMMARY
===================================================== */

.summary-grid {

    display: grid;

    grid-template-columns:
        repeat(3, 1fr);

    gap: 8px;
}


.summary-card {

    border:
        1px solid #dfe5ec;

    border-radius: 9px;

    padding: 10px 11px;

    background: #f8fafc;

    min-height: 58px;
}


.summary-card .label {

    color: #687386;

    font-size: 8.5px;

    margin-bottom: 3px;
}


.summary-card .value {

    color: #172033;

    font-size: 14px;

    font-weight: 800;

    line-height: 1.25;
}


.summary-card.highlight {

    grid-column:
        span 3;

    background:
        linear-gradient(
            135deg,
            #172033,
            #2d4968
        );

    border-color:
        #172033;

    padding: 14px 16px;

    min-height: 74px;

    display: flex;

    justify-content:
        space-between;

    align-items: center;
}


.summary-card.highlight .label {

    color: #cbd5e1;

    font-size: 10px;

    margin: 0;
}


.summary-card.highlight .value {

    color: #ffffff;

    font-size: 25px;

    font-weight: 900;

    letter-spacing: .2px;
}


/* =====================================================
   INFO GRID
===================================================== */

.info-grid {

    display: grid;

    grid-template-columns:
        repeat(4, 1fr);

    gap: 7px;
}


.info-box {

    border:
        1px solid #dfe5ec;

    border-radius: 8px;

    padding: 8px 9px;

    background: #ffffff;
}


.info-box span {

    display: block;

    color: #7a8494;

    font-size: 8px;
}


.info-box strong {

    display: block;

    margin-top: 2px;

    color: #26364b;

    font-size: 11px;
}


/* =====================================================
   MULTIPLIER
===================================================== */

.multiplier-grid {

    display: grid;

    grid-template-columns:
        repeat(3, 1fr);

    gap: 8px;
}


.multiplier-card {

    border:
        1px solid #dbe4ed;

    border-radius: 9px;

    padding: 10px 11px;

    background: #f8fafc;
}


.multiplier-top {

    display: flex;

    align-items:
        flex-start;

    justify-content:
        space-between;

    gap: 8px;
}


.multiplier-title {

    color: #2d5d86;

    font-size: 15px;

    font-weight: 900;
}


.multiplier-subtitle {

    margin-top: 1px;

    color: #7a8494;

    font-size: 8px;
}


.multiplier-hours {

    color: #4b6178;

    font-size: 9px;

    font-weight: 700;

    white-space: nowrap;
}


.multiplier-pay {

    margin-top: 7px;

    padding-top: 6px;

    border-top:
        1px solid #e3e9ef;

    color: #172033;

    font-size: 14px;

    font-weight: 900;

    text-align: right;
}


/* =====================================================
   TABLE
===================================================== */

table {

    width: 100%;

    border-collapse:
        separate;

    border-spacing: 0;

    table-layout: fixed;

    overflow: hidden;

    border:
        1px solid #dfe5ec;

    border-radius: 8px;
}


thead {

    display:
        table-header-group;
}


th {

    background: #eef3f7;

    color: #415066;

    font-weight: 800;

    font-size: 8px;

    text-align: left;

    padding: 7px 6px;

    border-bottom:
        1px solid #dfe5ec;
}


td {

    padding: 7px 6px;

    border-bottom:
        1px solid #e8edf2;

    vertical-align: middle;

    font-size: 8.5px;

    color: #334155;
}


tbody tr:last-child td {

    border-bottom: none;
}


tr {

    break-inside: avoid;

    page-break-inside: avoid;
}


.date-cell {

    white-space: nowrap;

    font-weight: 700;

    color: #34495e;
}


.time-cell {

    white-space: nowrap;
}


.arrow {

    color: #8da0b3;

    padding: 0 2px;
}


.money {

    text-align: right;

    white-space: nowrap;

    font-weight: 800;
}


.positive {

    color: #2d6b55;
}


.negative {

    color: #8a5660;
}


.empty {

    text-align: center;

    color: #9ca3af;

    padding: 17px;
}


/* =====================================================
   DAILY TABLE COLUMN WIDTH
===================================================== */

.daily-table th:nth-child(1),
.daily-table td:nth-child(1) {

    width: 15%;
}


.daily-table th:nth-child(2),
.daily-table td:nth-child(2) {

    width: 16%;
}


.daily-table th:nth-child(3),
.daily-table td:nth-child(3) {

    width: 20%;
}


.daily-table th:nth-child(4),
.daily-table td:nth-child(4) {

    width: 16%;
}


.daily-table th:nth-child(5),
.daily-table td:nth-child(5) {

    width: 16%;
}


.daily-table th:nth-child(6),
.daily-table td:nth-child(6) {

    width: 17%;
}


/* =====================================================
   MILEAGE TABLE
===================================================== */

.mileage-table th:nth-child(1),
.mileage-table td:nth-child(1) {

    width: 15%;
}


.mileage-table th:nth-child(2),
.mileage-table td:nth-child(2) {

    width: 12%;
}


.mileage-table th:nth-child(3),
.mileage-table td:nth-child(3) {

    width: 14%;
}


.mileage-table th:nth-child(4),
.mileage-table td:nth-child(4) {

    width: 16%;
}


.mileage-table th:nth-child(5),
.mileage-table td:nth-child(5) {

    width: 14%;
}


.mileage-table th:nth-child(6),
.mileage-table td:nth-child(6) {

    width: 14%;
}


.mileage-table th:nth-child(7),
.mileage-table td:nth-child(7) {

    width: 15%;
}


/* =====================================================
   TOTAL ROW
===================================================== */

.total-row td {

    background: #f5f8fb;

    color: #26364b;

    font-weight: 800;

    border-bottom: none;
}


.total-row .money {

    color: #1f4f77;

    font-size: 9px;
}


/* =====================================================
   MONTHLY SETTLEMENT
===================================================== */

.settlement {

    border-radius: 11px;

    border:
        1px solid #d8e3ec;

    background: #f7fafc;

    padding: 14px 15px;
}


.settlement-title {

    color: #172033;

    font-size: 12px;

    font-weight: 900;

    margin-bottom: 9px;
}


.settlement-row {

    display: flex;

    justify-content:
        space-between;

    align-items: center;

    gap: 20px;

    padding: 5px 0;

    border-bottom:
        1px solid #e5ebf0;
}


.settlement-row:last-child {

    border-bottom: none;

    padding-bottom: 0;
}


.settlement-label {

    color: #687386;

    font-size: 9px;
}


.settlement-value {

    color: #26364b;

    font-size: 10px;

    font-weight: 800;

    white-space: nowrap;
}


.settlement-final {

    margin-top: 9px;

    padding-top: 10px;

    border-top:
        1px solid #cad7e2;

    display: flex;

    justify-content:
        space-between;

    align-items: center;

    gap: 20px;
}


.settlement-final .label {

    color: #2d5d86;

    font-size: 10px;

    font-weight: 900;
}


.settlement-final .value {

    color: #172033;

    font-size: 18px;

    font-weight: 900;

    white-space: nowrap;
}


/* =====================================================
   NOTE
===================================================== */

.note {

    color: #7a8494;

    font-size: 8px;

    margin-top: 7px;

    line-height: 1.6;
}


/* =====================================================
   FOOTER
===================================================== */

.footer {

    margin-top: 20px;

    padding-top: 9px;

    border-top:
        1px solid #e2e7ec;

    color: #9aa4b2;

    font-size: 7.5px;

    display: flex;

    justify-content:
        space-between;

    gap: 10px;
}


/* =====================================================
   PRINT
===================================================== */

@media print {

    body {

        background: #ffffff;

        -webkit-print-color-adjust:
            exact;

        print-color-adjust:
            exact;
    }


    .section {

        break-inside:
            avoid;

        page-break-inside:
            avoid;
    }


    .summary-card.highlight {

        break-inside:
            avoid;

        page-break-inside:
            avoid;
    }


    .multiplier-grid {

        break-inside:
            avoid;

        page-break-inside:
            avoid;
    }


    .settlement {

        break-inside:
            avoid;

        page-break-inside:
            avoid;
    }

}

</style>

</head>


<body>

<div class="page">


    <!-- =================================================
         HEADER
    ================================================= -->

    <div class="header">

        <div class="header-title">
            YAO｜薪資與加班明細
        </div>


        <div class="header-subtitle">
            Salary & Overtime Statement
        </div>


        <div class="header-info">

            <div>

                <div class="header-month">

                    薪資月份：
                    ${escapeHTML(
                        formatMonth(
                            selectedMonth
                        )
                    )}

                </div>

            </div>


            <div class="generated">

                製表時間：
                ${escapeHTML(
                    generatedText
                )}

            </div>

        </div>

    </div>


    <!-- =================================================
         薪資總覽
    ================================================= -->

    <section class="section">

        <h2 class="section-title">
            薪資總覽
        </h2>

        <div class="summary-grid">

            <div class="summary-card">
                <div class="label">
                    基本月薪
                </div>
                <div class="value">
                    ${pdfMoney(calc.salary)}
                </div>
            </div>

            <div class="summary-card">
                <div class="label">
                    本月加班費
                </div>
                <div class="value">
                    ${pdfMoney(calc.overtimePay)}
                </div>
            </div>

            <div class="summary-card">
                <div class="label">
                    補貼／獎金
                </div>
                <div class="value">
                    ${pdfMoney(calc.extraIncome)}
                </div>
            </div>

            <div class="summary-card">
                <div class="label">
                    請假與扣款
                </div>
                <div class="value">
                    ${calc.totalDeduct > 0 ? "- " : ""}${pdfMoney(calc.totalDeduct)}
                </div>
            </div>

            <div class="summary-card">
                <div class="label">
                    預估薪資入帳
                </div>
                <div class="value">
                    ${pdfMoney(calc.payNet)}
                </div>
            </div>

            <div class="summary-card">
                <div class="label">
                    里程淨利（現金）
                </div>
                <div class="value">
                    ${pdfMoney(calc.mileageNet)}
                </div>
            </div>

            <div class="summary-card highlight">
                <div class="label">
                    預估總收入
                </div>
                <div class="value">
                    ${pdfMoney(calc.totalIncome)}
                </div>
            </div>

        </div>

    </section>


    <!-- =================================================
         本月加班統計
    ================================================= -->

    <section class="section">

        <h2 class="section-title">
            本月加班統計
        </h2>


        <div class="info-grid">


            <div class="info-box">

                <span>
                    實際加班
                </span>

                <strong>
                    ${minutesToText(
                        totals.actualOvertimeMinutes
                    )}
                </strong>

            </div>


            <div class="info-box">

                <span>
                    公司計薪
                </span>

                <strong>
                    ${pdfHours(
                        totals.paidHours
                    )}
                </strong>

            </div>


            <div class="info-box">

                <span>
                    加班天數
                </span>

                <strong>
                    ${totals.overtimeDays}
                    天
                </strong>

            </div>


            <div class="info-box">

                <span>
                    時薪基準
                </span>

                <strong>
                    ${pdfMoney(
                        getHourlyRate(selectedMonth)
                    )}
                </strong>

            </div>

        </div>


        <div
            class="info-grid"
            style="margin-top:7px;"
        >


            <div class="info-box">

                <span>
                    平日
                </span>

                <strong>
                    ${pdfHours(
                        totals.weekdayHours
                    )}
                </strong>

            </div>


            <div class="info-box">

                <span>
                    休假日
                </span>

                <strong>
                    ${pdfHours(
                        totals.restHours
                    )}
                </strong>

            </div>


            <div class="info-box">

                <span>
                    國定／公司假日
                </span>

                <strong>
                    ${pdfHours(
                        totals.holidayHours
                    )}
                </strong>

            </div>


            <div class="info-box">

                <span>
                    里程
                </span>

                <strong>
                    ${numberText(
                        totals.mileageKm,
                        1
                    )}
                    km
                </strong>

            </div>


        </div>

    </section>


    <!-- =================================================
         倍率統計
    ================================================= -->

    <section class="section">

        <h2 class="section-title">
            加班倍率統計
        </h2>


        <div class="multiplier-grid">

            ${multiplierCards}

        </div>

    </section>


    <!-- =================================================
         每日加班明細
    ================================================= -->

    <section class="section">

        <h2 class="section-title">
            每日加班明細
        </h2>


        <table class="daily-table">

            <thead>

                <tr>

                    <th>
                        日期
                    </th>

                    <th>
                        類型
                    </th>

                    <th>
                        時間
                    </th>

                    <th>
                        實際加班
                    </th>

                    <th>
                        公司計薪
                    </th>

                    <th>
                        加班費
                    </th>

                </tr>

            </thead>


            <tbody>

                ${emptyRecordText}


                ${recordRows}


                ${
                    monthRecords.length
                        ? `

                            <tr class="total-row">

                                <td colspan="3">
                                    本月合計
                                </td>

                                <td>
                                    ${minutesToText(
                                        totals.actualOvertimeMinutes
                                    )}
                                </td>

                                <td>
                                    ${pdfHours(
                                        totals.paidHours
                                    )}
                                </td>

                                <td class="money">

                                    ${pdfMoney(
                                        totals.overtimePay
                                    )}

                                </td>

                            </tr>

                        `
                        : ""
                }

            </tbody>

        </table>


        <div class="note">

            每日獨立計薪；公司計薪時數以每 30 分鐘為 0.5 小時計算，
            未滿 30 分鐘部分不計薪。

        </div>

    </section>


    <!-- =================================================
         里程補助明細
    ================================================= -->

    <section class="section">

        <h2 class="section-title">
            里程補助明細
        </h2>


        <table class="mileage-table">

            <thead>

                <tr>

                    <th>
                        日期
                    </th>

                    <th>
                        公里
                    </th>

                    <th>
                        補助率
                    </th>

                    <th>
                        管銷方式
                    </th>

                    <th>
                        補助
                    </th>

                    <th>
                        管銷
                    </th>

                    <th>
                        淨利
                    </th>

                </tr>

            </thead>


            <tbody>

                ${emptyMileageText}


                ${mileageRows}


                ${
                    monthMileageRecords.length
                        ? `

                            <tr class="total-row">

                                <td>
                                    合計
                                </td>

                                <td>

                                    ${numberText(
                                        totals.mileageKm,
                                        1
                                    )}
                                    km

                                </td>

                                <td>
                                    —
                                </td>

                                <td>
                                    —
                                </td>

                                <td class="money">

                                    ${pdfMoney(
                                        totals.mileageGross
                                    )}

                                </td>

                                <td class="money">

                                    - ${pdfMoney(
                                        totals.mileageWear
                                    )}

                                </td>

                                <td class="money">

                                    ${pdfMoney(
                                        totals.mileageNet
                                    )}

                                </td>

                            </tr>

                        `
                        : ""
                }

            </tbody>

        </table>

    </section>


    ${leaveSection}

    <!-- =================================================
         本月結算
    ================================================= -->

    <section class="section">

        <h2 class="section-title">
            本月結算
        </h2>

        <div class="settlement">

            <div class="settlement-title">
                本月收入組成
            </div>

            ${settlementRow("基本月薪", calc.salary)}
            ${settlementRow(overtimeLabel + " 加班費", calc.overtimePay)}
            ${incomeRows}
            ${deductRows}
            ${settlementRow("預估薪資入帳（薪轉）", calc.payNet)}
            ${settlementRow(mileageLabel + " 里程淨利（現金，不入薪轉）", calc.mileageNet)}

            <div class="settlement-final">
                <div class="label">
                    預估總收入
                </div>
                <div class="value">
                    ${pdfMoney(calc.totalIncome)}
                </div>
            </div>

        </div>

    </section>


    <!-- =================================================
         計算設定
    ================================================= -->

    <section class="section">

        <h2 class="section-title">
            計算設定
        </h2>


        <div class="info-grid">


            <div class="info-box">

                <span>
                    月薪
                </span>

                <strong>

                    ${pdfMoney(
                        getSalaryForMonth(selectedMonth)
                    )}

                </strong>

            </div>


            <div class="info-box">

                <span>
                    正常上班
                </span>

                <strong>

                    ${escapeHTML(
                        settings.normalStart
                    )}

                </strong>

            </div>


            <div class="info-box">

                <span>
                    正常下班
                </span>

                <strong>

                    ${escapeHTML(
                        settings.normalEnd
                    )}

                </strong>

            </div>


            <div class="info-box">

                <span>
                    平日加班開始
                </span>

                <strong>

                    ${escapeHTML(
                        settings.overtimeStart
                    )}

                </strong>

            </div>


        </div>


        <div class="note">

            計薪規則：每 30 分鐘為 0.5 小時，
            未滿 30 分鐘部分不計薪。
            加班倍率依 1.34 倍、1.67 倍及 2.67 倍分段計算。
            平日加班依設定的平日加班開始時間計算；
            休假日及國定／公司假日依實際工作時間扣除休息時間後計算。
                    請假扣薪依時薪 × 時數 × 扣薪比例計算。里程補助為現金，扣除管銷後的淨利計入總收入，不列入薪轉。

        </div>

    </section>


    <!-- =================================================
         FOOTER
    ================================================= -->

    <div class="footer">

        <span>
            YAO 薪資管家
        </span>


        <span>
            列印時請選擇「另存為 PDF」
        </span>

    </div>


</div>

</body>

</html>

    `;
}


/* =========================================================
   EXPORT PDF
========================================================= */

function exportSalaryPDF() {

    const printWindow =
        window.open(
            "",
            "_blank"
        );


    if (!printWindow) {

        alert(
            "瀏覽器阻擋了列印視窗，請允許此網站開啟新視窗後再試一次。"
        );

        return;
    }


    const html =
        buildSalaryPDF();


    printWindow.document.open();


    printWindow.document.write(
        html
    );


    printWindow.document.close();


    printWindow.focus();


    setTimeout(
        () => {

            try {

                printWindow.print();

            } catch (error) {

                console.error(
                    "PDF 列印失敗：",
                    error
                );

            }

        },
        500
    );
}




/* =========================================================
   EVENT BINDING
========================================================= */

const ACTIONS = {
    "tab": el => switchTab(el.dataset.tab),
    "settings": () => openSettings(),
    "close": () => closeModals(),

    "month-prev": () => changeMonth(-1),
    "month-next": () => changeMonth(1),
    "month-today": () => { selectedMonth = getCurrentMonth(); render(); },
    "year-prev": () => { selectedYear--; renderLedger(); },
    "year-next": () => { selectedYear++; renderLedger(); },

    "day": el => openDay(el.dataset.date),
    "quick-save": () => saveQuickRecord(),
    "quick-leave": () => openLeave(null, getTodayString()),

    "add-record": el => openRecord(null, el.dataset.date || null),
    "edit-record": el => openRecord(el.dataset.id),
    "delete-record": el => deleteRecord(el.dataset.id),
    "toggle-detail": el => {
        const detail = el.closest(".item")?.querySelector(".detail");
        if (!detail) return;
        detail.hidden = !detail.hidden;
        el.textContent = detail.hidden ? "詳細" : "收合";
    },

    "add-leave": el => openLeave(null, el.dataset.date || null),
    "add-annual": el => openLeave(null, el.dataset.date || null, "annual"),
    "edit-leave": el => openLeave(el.dataset.id),
    "delete-leave": el => deleteLeave(el.dataset.id),
    "leave-hours": el => { $("leaveHours").value = el.dataset.hours; updateLeavePreview(); },

    "add-mileage": el => openMileage(null, el.dataset.date || null),
    "edit-mileage": el => openMileage(el.dataset.id),
    "delete-mileage": el => deleteMileage(el.dataset.id),

    "add-item": () => openItem(),
    "edit-item": el => openItem(el.dataset.id),
    "delete-item": el => deleteItem(el.dataset.id),

    "add-slip": () => openSlip(),
    "edit-slip": el => openSlip(el.dataset.month),
    "slip-fill": () => fillSlipFromCalc(),
    "slip-delete": () => deleteSlip(),
    "slip-add-row": el => {
        const container = $(el.dataset.side === "deduct" ? "slipDeduct" : "slipIncome");
        container.insertAdjacentHTML("beforeend", slipRowHTML());
        container.lastElementChild.querySelector(".s-name").focus();
    },

    "add-bonus": () => openBonus(),
    "edit-bonus": el => openBonus(el.dataset.id),
    "delete-bonus": el => deleteBonus(el.dataset.id),

    "set-add-history": () => $("salaryHistoryRows").insertAdjacentHTML("beforeend", historyRowHTML()),
    "set-add-fixed": () => $("fixedRows").insertAdjacentHTML("beforeend", fixedRowHTML()),
    "row-del": el => {
        const inSlip = Boolean(el.closest("#slipForm"));
        el.closest(".row-item")?.remove();
        if (inSlip) updateSlipSummary();
    },

    "export-pdf": () => exportSalaryPDF(),
    "export": () => exportData(),
    "import": () => $("importFile").click(),
    "clear-month": () => clearCurrentMonth(),
    "clear-all": () => clearAllRecords()
};

function bindEvents() {
    document.addEventListener("click", event => {
        const target = event.target.closest("[data-action]");

        if (target) {
            const handler = ACTIONS[target.dataset.action];
            if (handler) handler(target, event);
            return;
        }

        // 點視窗外的暗色區域關閉。
        if (event.target.classList?.contains("modal")) closeModals();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeModals();
    });

    $("recordForm").addEventListener("submit", saveRecord);
    $("leaveForm").addEventListener("submit", saveLeave);
    $("mileageForm").addEventListener("submit", saveMileage);
    $("itemForm").addEventListener("submit", saveItem);
    $("slipForm").addEventListener("submit", saveSlip);
    $("bonusForm").addEventListener("submit", saveBonus);
    $("settingsForm").addEventListener("submit", saveSettings);

    $("recordForm").addEventListener("input", updateRecordPreview);
    $("date").addEventListener("change", () => { applyDayTypeDefault(); updateRecordPreview(); });
    $("leaveForm").addEventListener("input", updateLeavePreview);
    $("leaveType").addEventListener("change", applyLeaveTypeDefault);
    $("mileageForm").addEventListener("input", updateMileagePreview);
    $("slipForm").addEventListener("input", updateSlipSummary);
    $("bonusDate").addEventListener("change", updateBonusMonthHint);
    $("bonusMonth").addEventListener("change", () => { bonusMonthTouched = true; updateBonusMonthHint(); });
    $("settingsForm").addEventListener("input", updateSalaryHint);

    $("slipMonth").addEventListener("change", () => {
        // 新增時換月份，就改載入那個月（已填過的月份會直接帶出來）。
        const month = $("slipMonth").value;
        if (!month || slipOriginalMonth) return;
        if (settings.payslips[month]) slipOriginalMonth = month;
        loadSlipIntoForm(month);
    });

    $("monthPicker").addEventListener("change", event => {
        selectedMonth = event.target.value || getCurrentMonth();
        render();
    });

    $("recordSort").addEventListener("change", event => {
        recordSortOrder = event.target.value === "asc" ? "asc" : "desc";
        localStorage.setItem(RECORD_SORT_KEY, recordSortOrder);
        render();
    });

    $("quickStart").addEventListener("input", updateQuickPreview);
    $("quickEnd").addEventListener("input", updateQuickPreview);
    $("importFile").addEventListener("change", importData);
}


/* =========================================================
   CLOUD SYNC BRIDGE
========================================================= */

window.YaoCloudDataBridge = {

    getData() {
        return { records, settings, mileageRecords };
    },

    setData(data) {
        records = Array.isArray(data.records) ? data.records : [];
        mileageRecords = Array.isArray(data.mileageRecords) ? data.mileageRecords : [];

        if (data.settings && typeof data.settings === "object") {
            settings = normaliseSettings(data.settings);
        }

        // 雲端資料收到後保留在此裝置作為本機備份。
        // 不能呼叫 saveData()，否則會造成無限回傳同步。
        saveLocal();
        renderAll();
    }
};


/* =========================================================
   START
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    selectedMonth = getCurrentMonth();

    bindEvents();

    $("recordSort").value = recordSortOrder;
    resetQuickStart();
    switchTab(activeTab);
});
