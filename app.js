/* =========================================================
   YAO 加班費計算器 V1.5
   PDF 薪資單精修版

   注意：
   1. 不修改原有 Storage Key
   2. 不修改既有資料結構
   3. 不修改加班費計算邏輯
   4. 本版本主要優化 PDF 排版與視覺
========================================================= */

"use strict";


/* =========================================================
   STORAGE
========================================================= */

const STORAGE_KEY = "YAO_OVERTIME_RECORDS_V1";
const SETTINGS_KEY = "YAO_OVERTIME_SETTINGS_V1";
const MILEAGE_STORAGE_KEY = "YAO_MILEAGE_RECORDS_V1";


/* =========================================================
   DEFAULT SETTINGS
========================================================= */

const DEFAULT_SETTINGS = {
    salary: 40000,
    normalStart: "08:00",
    normalEnd: "17:30",
    overtimeStart: "17:30"
};


/* =========================================================
   BASIC HELPERS
========================================================= */

function $(id) {
    return document.getElementById(id);
}


function loadJSON(key, fallback) {
    try {
        const value = localStorage.getItem(key);

        if (!value) {
            return fallback;
        }

        return JSON.parse(value);

    } catch (error) {

        console.error(
            "讀取資料失敗：",
            key,
            error
        );

        return fallback;
    }
}


function saveJSON(key, value) {

    try {

        localStorage.setItem(
            key,
            JSON.stringify(value)
        );

    } catch (error) {

        console.error(
            "儲存資料失敗：",
            key,
            error
        );

        alert(
            "資料儲存失敗，請確認瀏覽器儲存空間。"
        );
    }
}


function saveData() {

    saveJSON(
        STORAGE_KEY,
        records
    );

    saveJSON(
        SETTINGS_KEY,
        settings
    );

    saveJSON(
        MILEAGE_STORAGE_KEY,
        mileageRecords
    );

    // 雲端同步模組未載入或尚未啟用時，這一行不會做任何事。
    window.YaoCloudSync?.schedulePush();
}


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


function changeMonth(offset) {

    const parts =
        selectedMonth.split("-");

    let year =
        Number(parts[0]);

    let month =
        Number(parts[1]);

    month += offset;

    if (month < 1) {

        month = 12;

        year--;
    }

    if (month > 12) {

        month = 1;

        year++;
    }

    selectedMonth =
        year +
        "-" +
        pad2(month);

    $("monthPicker").value =
        selectedMonth;

    render();
}


/* =========================================================
   OVERTIME CALCULATION
========================================================= */

function calculatePaidHours(
    minutes
) {

    const safeMinutes =
        Math.max(
            0,
            Number(minutes) || 0
        );

    return (
        Math.floor(
            safeMinutes / 30
        ) *
        0.5
    );
}


function calculateRecord(
    record
) {

    const start =
        timeToMinutes(
            record.start
        );

    const end =
        timeToMinutes(
            record.end
        );

    let grossMinutes =
        end - start;

    if (
        grossMinutes < 0
    ) {

        grossMinutes +=
            24 * 60;
    }


    const breakMinutes =
        Math.max(
            0,
            Number(
                record.breakMinutes
            ) || 0
        );


    const actualWorkMinutes =
        Math.max(
            0,
            grossMinutes -
            breakMinutes
        );


    let overtimeMinutes = 0;


    if (
        record.dayType ===
        "weekday"
    ) {

        const overtimeStart =
            timeToMinutes(
                settings.overtimeStart
            );

        let overtimeEnd =
            end;

        if (
            overtimeEnd <
            overtimeStart
        ) {

            overtimeEnd +=
                24 * 60;
        }

        if (
            overtimeEnd >
            overtimeStart
        ) {

            overtimeMinutes =
                overtimeEnd -
                overtimeStart;
        }

    } else {

        overtimeMinutes =
            actualWorkMinutes;
    }


    const paidHours =
        calculatePaidHours(
            overtimeMinutes
        );


    const firstTwoHours =
        Math.min(
            paidHours,
            2
        );


    const thirdToEighth =
        Math.min(
            Math.max(
                paidHours - 2,
                0
            ),
            6
        );


    const ninthToTwelfth =
        Math.min(
            Math.max(
                paidHours - 8,
                0
            ),
            4
        );


    const hourlyRate =
        Number(
            settings.salary || 0
        ) /
        240;


    const payFirst =
        hourlyRate *
        firstTwoHours *
        1.34;


    const paySecond =
        hourlyRate *
        thirdToEighth *
        1.67;


    const payThird =
        hourlyRate *
        ninthToTwelfth *
        2.67;


    const total =
        payFirst +
        paySecond +
        payThird;


    return {

        grossMinutes,

        actualWorkMinutes,

        overtimeMinutes,

        paidHours,

        firstTwoHours,

        thirdToEighth,

        ninthToTwelfth,

        payFirst,

        paySecond,

        payThird,

        total
    };
}


/* =========================================================
   MILEAGE
========================================================= */

function calculateMileage(
    record
) {

    const km =
        Math.max(
            0,
            Number(
                record.km || 0
            )
        );


    const rate =
        Math.max(
            0,
            Number(
                record.rate || 0
            )
        );


    const wearRate =
        Math.max(
            0,
            Number(
                record.wearRate || 0
            )
        );


    const fixedWear =
        Math.max(
            0,
            Number(
                record.wear || 0
            )
        );


    let wear = 0;


    if (
        wearRate > 0
    ) {

        wear =
            km *
            wearRate;

    } else {

        wear =
            fixedWear;
    }


    const gross =
        km *
        rate;


    const net =
        Math.max(
            0,
            gross -
            wear
        );


    return {

        km,

        rate,

        wearRate,

        fixedWear,

        wear,

        gross,

        net
    };
}


/* =========================================================
   DAY TYPE
========================================================= */

function getDayTypeText(
    dayType
) {

    if (
        dayType ===
        "weekday"
    ) {
        return "平日";
    }

    if (
        dayType ===
        "rest"
    ) {
        return "休假日";
    }

    if (
        dayType ===
        "holiday"
    ) {
        return "國定／公司假日";
    }

    return "其他";
}


/* =========================================================
   RENDER
========================================================= */

function render() {

    const monthRecords =
        getMonthRecords();

    const monthMileageRecords =
        getMonthMileageRecords();


    let totalPay = 0;

    let paidHours = 0;

    let actualOvertimeMinutes =
        0;

    let weekdayHours = 0;

    let restHours = 0;

    let holidayHours = 0;

    let overtimeDays = 0;


    monthRecords.forEach(
        record => {

            const result =
                calculateRecord(
                    record
                );


            totalPay +=
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


    let mileageGross = 0;

    let mileageWear = 0;

    let mileageNet = 0;

    let mileageKm = 0;


    monthMileageRecords.forEach(
        record => {

            const result =
                calculateMileage(
                    record
                );


            mileageGross +=
                result.gross;

            mileageWear +=
                result.wear;

            mileageNet +=
                result.net;

            mileageKm +=
                result.km;
        }
    );


    const extraIncome =
        totalPay +
        mileageNet;


    const totalIncome =
        Number(
            settings.salary || 0
        ) +
        extraIncome;


    if (
        $("monthOvertimePay")
    ) {

        $("monthOvertimePay")
            .textContent =
            money(totalPay);
    }


    if (
        $("monthMileageNet")
    ) {

        $("monthMileageNet")
            .textContent =
            money(mileageNet);
    }


    if (
        $("monthExtraIncome")
    ) {

        $("monthExtraIncome")
            .textContent =
            money(extraIncome);
    }


    if (
        $("monthTotalIncome")
    ) {

        $("monthTotalIncome")
            .textContent =
            money(totalIncome);
    }


    if (
        $("monthPaidHours")
    ) {

        $("monthPaidHours")
            .textContent =
            numberText(
                paidHours,
                1
            );
    }


    if (
        $("monthDays")
    ) {

        $("monthDays")
            .textContent =
            overtimeDays;
    }


    if (
        $("mileageKm")
    ) {

        $("mileageKm")
            .textContent =
            numberText(
                mileageKm,
                1
            ) +
            " km";
    }


    if (
        $("recordCount")
    ) {

        $("recordCount")
            .textContent =
            monthRecords.length;
    }


    if (
        $("weekdayHours")
    ) {

        $("weekdayHours")
            .textContent =
            numberText(
                weekdayHours,
                1
            ) +
            " 小時";
    }


    if (
        $("restHours")
    ) {

        $("restHours")
            .textContent =
            numberText(
                restHours,
                1
            ) +
            " 小時";
    }


    if (
        $("holidayHours")
    ) {

        $("holidayHours")
            .textContent =
            numberText(
                holidayHours,
                1
            ) +
            " 小時";
    }


    if (
        $("actualHours")
    ) {

        $("actualHours")
            .textContent =
            minutesToHoursText(
                actualOvertimeMinutes
            );
    }


    if (
        $("mileageGross")
    ) {

        $("mileageGross")
            .textContent =
            money(mileageGross);
    }


    if (
        $("mileageWear")
    ) {

        $("mileageWear")
            .textContent =
            money(mileageWear);
    }


    if (
        $("mileageNet")
    ) {

        $("mileageNet")
            .textContent =
            money(mileageNet);
    }


    if (
        $("monthPicker")
    ) {

        $("monthPicker")
            .value =
            selectedMonth;
    }


    renderRecords();

    renderMileage();
}


/* =========================================================
   RECORD LIST
========================================================= */

function renderRecords() {

    const container =
        $("records");

    const emptyState =
        $("emptyState");


    if (!container) {
        return;
    }


    const monthRecords =
        getMonthRecords();


    container.innerHTML =
        "";


    if (
        emptyState
    ) {

        emptyState.style.display =
            monthRecords.length
                ? "none"
                : "block";
    }


    monthRecords.forEach(
        record => {

            const result =
                calculateRecord(
                    record
                );


            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "record-card";


            card.innerHTML = `

                <div class="record-top">

                    <div>

                        <div class="record-title">
                            ${escapeHTML(
                                formatDate(
                                    record.date
                                )
                            )}
                        </div>

                        <div class="record-subtitle">

                            ${escapeHTML(
                                getDayTypeText(
                                    record.dayType
                                )
                            )}

                            ・

                            ${escapeHTML(
                                record.start || ""
                            )}

                            →

                            ${escapeHTML(
                                record.end || ""
                            )}

                        </div>

                    </div>


                    <div class="record-pay">
                        ${money(
                            result.total
                        )}
                    </div>

                </div>


                <div class="record-metrics">

                    <div class="metric">

                        <span>
                            實際工作
                        </span>

                        <strong>
                            ${minutesToText(
                                result.actualWorkMinutes
                            )}
                        </strong>

                    </div>


                    <div class="metric">

                        <span>
                            實際加班
                        </span>

                        <strong>
                            ${minutesToText(
                                result.overtimeMinutes
                            )}
                        </strong>

                    </div>


                    <div class="metric">

                        <span>
                            公司計薪
                        </span>

                        <strong>
                            ${numberText(
                                result.paidHours,
                                1
                            )} 小時
                        </strong>

                    </div>


                    <div class="metric">

                        <span>
                            1.34 倍
                        </span>

                        <strong>

                            ${numberText(
                                result.firstTwoHours,
                                1
                            )}h /

                            ${money(
                                result.payFirst
                            )}

                        </strong>

                    </div>


                    <div class="metric">

                        <span>
                            1.67 倍
                        </span>

                        <strong>

                            ${numberText(
                                result.thirdToEighth,
                                1
                            )}h /

                            ${money(
                                result.paySecond
                            )}

                        </strong>

                    </div>


                    <div class="metric">

                        <span>
                            2.67 倍
                        </span>

                        <strong>

                            ${numberText(
                                result.ninthToTwelfth,
                                1
                            )}h /

                            ${money(
                                result.payThird
                            )}

                        </strong>

                    </div>

                </div>


                ${
                    record.note
                        ? `
                            <div
                                class="record-subtitle"
                                style="margin-top:10px;"
                            >
                                備註：
                                ${escapeHTML(
                                    record.note
                                )}
                            </div>
                        `
                        : ""
                }


                <div class="record-actions">

                    <button
                        class="secondary"
                        type="button"
                        data-edit-record="${escapeHTML(
                            record.id
                        )}"
                    >
                        編輯
                    </button>


                    <button
                        class="danger"
                        type="button"
                        data-delete-record="${escapeHTML(
                            record.id
                        )}"
                    >
                        刪除
                    </button>

                </div>
            `;


            container.appendChild(
                card
            );
        }
    );


    container
        .querySelectorAll(
            "[data-edit-record]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    openRecord(
                        button.dataset
                            .editRecord
                    );

                }
            );

        });


    container
        .querySelectorAll(
            "[data-delete-record]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    deleteRecord(
                        button.dataset
                            .deleteRecord
                    );

                }
            );

        });
}


/* =========================================================
   MILEAGE LIST
========================================================= */

function renderMileage() {

    const container =
        $("mileageRecords");

    const emptyState =
        $("emptyMileageState");


    if (!container) {
        return;
    }


    const monthRecords =
        getMonthMileageRecords();


    container.innerHTML =
        "";


    if (
        emptyState
    ) {

        emptyState.style.display =
            monthRecords.length
                ? "none"
                : "block";
    }


    monthRecords.forEach(
        record => {

            const result =
                calculateMileage(
                    record
                );


            const wearText =
                result.wearRate > 0
                    ? (
                        result.km +
                        " km × " +
                        result.wearRate +
                        " / km"
                    )
                    : (
                        "固定損耗 " +
                        money(
                            result.fixedWear
                        )
                    );


            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "mileage-card";


            card.innerHTML = `

                <div class="mileage-top">

                    <div>

                        <div class="mileage-title">

                            ${escapeHTML(
                                formatDate(
                                    record.date
                                )
                            )}

                        </div>


                        <div class="mileage-detail">

                            ${numberText(
                                result.km,
                                1
                            )}

                            km

                            ×

                            ${money(
                                result.rate
                            )}

                            / km

                        </div>

                    </div>


                    <div class="mileage-net">

                        ${money(
                            result.net
                        )}

                    </div>

                </div>


                <div class="mileage-detail">

                    補助：
                    ${money(
                        result.gross
                    )}

                    <br>

                    損耗：
                    ${money(
                        result.wear
                    )}

                    <br>

                    損耗方式：
                    ${escapeHTML(
                        wearText
                    )}

                    <br>

                    實際收入：
                    ${money(
                        result.net
                    )}

                    ${
                        record.note
                            ? `
                                <br>
                                備註：
                                ${escapeHTML(
                                    record.note
                                )}
                            `
                            : ""
                    }

                </div>


                <div class="record-actions">

                    <button
                        class="secondary"
                        type="button"
                        data-edit-mileage="${escapeHTML(
                            record.id
                        )}"
                    >
                        編輯
                    </button>


                    <button
                        class="danger"
                        type="button"
                        data-delete-mileage="${escapeHTML(
                            record.id
                        )}"
                    >
                        刪除
                    </button>

                </div>
            `;


            container.appendChild(
                card
            );

        }
    );


    container
        .querySelectorAll(
            "[data-edit-mileage]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    openMileage(
                        button.dataset
                            .editMileage
                    );

                }
            );

        });


    container
        .querySelectorAll(
            "[data-delete-mileage]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    deleteMileage(
                        button.dataset
                            .deleteMileage
                    );

                }
            );

        });
}


/* =========================================================
   RECORD MODAL
========================================================= */

function openRecord(
    id = null
) {

    const modal =
        $("recordModal");


    if (!modal) {
        return;
    }


    const form =
        $("recordForm");


    if (form) {
        form.reset();
    }


    $("recordId").value =
        "";


    if (id) {

        const record =
            records.find(
                item =>
                    String(item.id) ===
                    String(id)
            );


        if (!record) {
            return;
        }


        $("recordModalTitle")
            .textContent =
            "編輯出勤";


        $("recordId").value =
            record.id;


        $("date").value =
            record.date || "";


        $("dayType").value =
            record.dayType ||
            "weekday";


        $("start").value =
            record.start ||
            settings.normalStart;


        $("end").value =
            record.end ||
            settings.normalEnd;


        $("breakMinutes").value =
            record.breakMinutes ??
            0;


        $("note").value =
            record.note || "";

    } else {

        $("recordModalTitle")
            .textContent =
            "新增出勤";


        $("recordId").value =
            "";


        $("date").value =
            selectedMonth ===
            getCurrentMonth()
                ? getTodayString()
                : selectedMonth +
                  "-01";


        $("dayType").value =
            "weekday";


        $("start").value =
            settings.normalStart;


        $("end").value =
            settings.normalEnd;


        $("breakMinutes").value =
            0;


        $("note").value =
            "";
    }


    updateRecordPreview();

    modal.classList.add(
        "show"
    );
}


function closeRecordModal() {

    const modal =
        $("recordModal");

    if (modal) {

        modal.classList.remove(
            "show"
        );
    }
}


function updateRecordPreview() {

    const preview =
        $("preview");


    if (!preview) {
        return;
    }


    const record = {

        date:
            $("date")?.value ||
            "",

        dayType:
            $("dayType")?.value ||
            "weekday",

        start:
            $("start")?.value ||
            "",

        end:
            $("end")?.value ||
            "",

        breakMinutes:
            Number(
                $("breakMinutes")
                    ?.value || 0
            )
    };


    if (
        !record.start ||
        !record.end
    ) {

        preview.innerHTML =
            "請輸入上下班時間。";

        return;
    }


    const result =
        calculateRecord(
            record
        );


    preview.innerHTML = `

        實際工作：

        <strong>
            ${minutesToText(
                result.actualWorkMinutes
            )}
        </strong>

        <br>

        實際加班：

        <strong>
            ${minutesToText(
                result.overtimeMinutes
            )}
        </strong>

        <br>

        公司計薪：

        <strong>
            ${numberText(
                result.paidHours,
                1
            )} 小時
        </strong>

        <br>

        預估加班費：

        <strong>
            ${money(
                result.total
            )}
        </strong>
    `;
}


function saveRecord(
    event
) {

    event.preventDefault();


    const id =
        $("recordId")
            .value
            .trim();


    const date =
        $("date").value;


    const dayType =
        $("dayType").value;


    const start =
        $("start").value;


    const end =
        $("end").value;


    const breakMinutes =
        Math.max(
            0,
            Number(
                $("breakMinutes")
                    .value || 0
            )
        );


    const note =
        $("note")
            .value
            .trim();


    if (
        !date ||
        !start ||
        !end
    ) {

        alert(
            "請填寫日期、開始時間與結束時間。"
        );

        return;
    }


    const data = {

        id:
            id ||
            (
                Date.now()
                    .toString() +
                Math.random()
                    .toString(36)
                    .slice(2)
            ),

        date,

        dayType,

        start,

        end,

        breakMinutes,

        note
    };


    if (id) {

        const index =
            records.findIndex(
                record =>
                    String(record.id) ===
                    String(id)
            );


        if (
            index !== -1
        ) {

            records[index] = {

                ...records[index],

                ...data
            };
        }

    } else {

        records.push(
            data
        );
    }


    saveData();

    closeRecordModal();

    render();
}


/* =========================================================
   DELETE RECORD
========================================================= */

function deleteRecord(
    id
) {

    const record =
        records.find(
            item =>
                String(item.id) ===
                String(id)
        );


    if (!record) {
        return;
    }


    const confirmed =
        confirm(
            "確定要刪除這筆出勤紀錄嗎？"
        );


    if (!confirmed) {
        return;
    }


    records =
        records.filter(
            item =>
                String(item.id) !==
                String(id)
        );


    saveData();

    render();
}


/* =========================================================
   MILEAGE MODAL
========================================================= */

function openMileage(
    id = null
) {

    const modal =
        $("mileageModal");


    if (!modal) {
        return;
    }


    const form =
        $("mileageForm");


    if (form) {
        form.reset();
    }


    $("mileageId").value =
        "";


    if (id) {

        const record =
            mileageRecords.find(
                item =>
                    String(item.id) ===
                    String(id)
            );


        if (!record) {
            return;
        }


        $("mileageModalTitle")
            .textContent =
            "編輯里程";


        $("mileageId").value =
            record.id;


        $("mileageDate").value =
            record.date || "";


        $("mileageKmInput").value =
            record.km ?? 0;


        $("mileageRate").value =
            record.rate ?? 6;


        $("mileageWearRate").value =
            record.wearRate
                ? record.wearRate
                : "";


        $("mileageWearInput").value =
            record.wear ?? 0;


        $("mileageNote").value =
            record.note || "";

    } else {

        $("mileageModalTitle")
            .textContent =
            "新增里程";


        $("mileageId").value =
            "";


        $("mileageDate").value =
            selectedMonth ===
            getCurrentMonth()
                ? getTodayString()
                : selectedMonth +
                  "-01";


        $("mileageKmInput").value =
            "";


        $("mileageRate").value =
            6;


        $("mileageWearRate").value =
            "";


        $("mileageWearInput").value =
            0;


        $("mileageNote").value =
            "";
    }


    updateMileagePreview();

    modal.classList.add(
        "show"
    );
}


function closeMileageModal() {

    const modal =
        $("mileageModal");


    if (modal) {

        modal.classList.remove(
            "show"
        );
    }
}


function updateMileagePreview() {

    const preview =
        $("mileagePreview");


    if (!preview) {
        return;
    }


    const km =
        Number(
            $("mileageKmInput")
                ?.value || 0
        );


    const rate =
        Number(
            $("mileageRate")
                ?.value || 0
        );


    const wearRate =
        Number(
            $("mileageWearRate")
                ?.value || 0
        );


    const wear =
        Number(
            $("mileageWearInput")
                ?.value || 0
        );


    const result =
        calculateMileage({

            km,

            rate,

            wearRate,

            wear
        });


    const wearText =
        wearRate > 0
            ? (
                km +
                " km × " +
                wearRate +
                " / km"
            )
            : (
                "固定損耗 " +
                money(wear)
            );


    preview.innerHTML = `

        補助：

        <strong>
            ${money(
                result.gross
            )}
        </strong>

        <br>

        損耗：

        <strong>
            ${money(
                result.wear
            )}
        </strong>

        <br>

        損耗方式：

        ${escapeHTML(
            wearText
        )}

        <br>

        實際收入：

        <strong>
            ${money(
                result.net
            )}
        </strong>
    `;
}


function saveMileage(
    event
) {

    event.preventDefault();


    const id =
        $("mileageId")
            .value
            .trim();


    const date =
        $("mileageDate")
            .value;


    const km =
        Math.max(
            0,
            Number(
                $("mileageKmInput")
                    .value || 0
            )
        );


    const rate =
        Math.max(
            0,
            Number(
                $("mileageRate")
                    .value || 0
            )
        );


    const wearRate =
        Math.max(
            0,
            Number(
                $("mileageWearRate")
                    .value || 0
            )
        );


    const wear =
        Math.max(
            0,
            Number(
                $("mileageWearInput")
                    .value || 0
            )
        );


    const note =
        $("mileageNote")
            .value
            .trim();


    if (!date) {

        alert(
            "請選擇日期。"
        );

        return;
    }


    const data = {

        id:
            id ||
            (
                Date.now()
                    .toString() +
                Math.random()
                    .toString(36)
                    .slice(2)
            ),

        date,

        km,

        rate,

        wearRate,

        wear,

        note
    };


    if (id) {

        const index =
            mileageRecords.findIndex(
                record =>
                    String(record.id) ===
                    String(id)
            );


        if (
            index !== -1
        ) {

            mileageRecords[index] = {

                ...mileageRecords[index],

                ...data
            };
        }

    } else {

        mileageRecords.push(
            data
        );
    }


    saveData();

    closeMileageModal();

    render();
}


/* =========================================================
   DELETE MILEAGE
========================================================= */

function deleteMileage(
    id
) {

    const record =
        mileageRecords.find(
            item =>
                String(item.id) ===
                String(id)
        );


    if (!record) {
        return;
    }


    const confirmed =
        confirm(
            "確定要刪除這筆里程紀錄嗎？"
        );


    if (!confirmed) {
        return;
    }


    mileageRecords =
        mileageRecords.filter(
            item =>
                String(item.id) !==
                String(id)
        );


    saveData();

    render();
}


/* =========================================================
   SETTINGS
========================================================= */

function openSettings() {

    const modal =
        $("settingsModal");


    if (!modal) {
        return;
    }


    $("salary").value =
        settings.salary;


    $("normalStart").value =
        settings.normalStart;


    $("normalEnd").value =
        settings.normalEnd;


    $("overtimeStart").value =
        settings.overtimeStart;


    modal.classList.add(
        "show"
    );
}


function closeSettingsModal() {

    const modal =
        $("settingsModal");


    if (modal) {

        modal.classList.remove(
            "show"
        );
    }
}


function saveSettings(
    event
) {

    event.preventDefault();


    const salary =
        Math.max(
            0,
            Number(
                $("salary")
                    .value || 0
            )
        );


    const normalStart =
        $("normalStart")
            .value ||
        "08:00";


    const normalEnd =
        $("normalEnd")
            .value ||
        "17:30";


    const overtimeStart =
        $("overtimeStart")
            .value ||
        "17:30";


    settings = {

        ...settings,

        salary,

        normalStart,

        normalEnd,

        overtimeStart
    };


    saveData();

    closeSettingsModal();

    render();
}


/* =========================================================
   CLEAR DATA
========================================================= */

function clearCurrentMonth() {

    const confirmed =
        confirm(
            "確定要清除目前月份的所有出勤與里程紀錄嗎？"
        );


    if (!confirmed) {
        return;
    }


    records =
        records.filter(
            record =>
                getMonthFromDate(
                    record.date
                ) !==
                selectedMonth
        );


    mileageRecords =
        mileageRecords.filter(
            record =>
                getMonthFromDate(
                    record.date
                ) !==
                selectedMonth
        );


    saveData();

    render();
}


function clearAllRecords() {

    const confirmed =
        confirm(
            "確定要清除全部出勤與里程資料嗎？此操作無法復原。"
        );


    if (!confirmed) {
        return;
    }


    const secondConfirm =
        confirm(
            "再次確認：真的要刪除全部資料嗎？"
        );


    if (!secondConfirm) {
        return;
    }


    records = [];

    mileageRecords = [];


    saveData();

    render();
}


/* =========================================================
   JSON EXPORT
========================================================= */

function exportData() {

    const data = {

        version:
            "YAO_OVERTIME_V1.4",

        exportedAt:
            new Date()
                .toISOString(),

        records,

        mileageRecords,

        settings
    };


    const blob =
        new Blob(
            [
                JSON.stringify(
                    data,
                    null,
                    2
                )
            ],
            {
                type:
                    "application/json;charset=utf-8"
            }
        );


    const url =
        URL.createObjectURL(
            blob
        );


    const link =
        document.createElement(
            "a"
        );


    link.href =
        url;


    link.download =
        "YAO_加班費資料_" +
        selectedMonth +
        ".json";


    document.body.appendChild(
        link
    );


    link.click();

    link.remove();


    setTimeout(
        () => {

            URL.revokeObjectURL(
                url
            );

        },
        1000
    );
}


/* =========================================================
   JSON IMPORT
========================================================= */

function importData(
    event
) {

    const file =
        event.target.files?.[0];


    if (!file) {
        return;
    }


    const reader =
        new FileReader();


    reader.onload =
        function () {

            try {

                const data =
                    JSON.parse(
                        reader.result
                    );


                if (
                    !data ||
                    typeof data !==
                        "object"
                ) {

                    throw new Error(
                        "資料格式錯誤"
                    );
                }


                const confirmed =
                    confirm(
                        "匯入資料會覆蓋目前資料，確定要繼續嗎？"
                    );


                if (!confirmed) {
                    return;
                }


                if (
                    Array.isArray(
                        data.records
                    )
                ) {

                    records =
                        data.records;
                }


                if (
                    Array.isArray(
                        data.mileageRecords
                    )
                ) {

                    mileageRecords =
                        data.mileageRecords;
                }


                if (
                    data.settings &&
                    typeof data.settings ===
                        "object"
                ) {

                    settings = {

                        ...DEFAULT_SETTINGS,

                        ...data.settings
                    };
                }


                saveData();

                render();


                alert(
                    "資料匯入完成。"
                );


            } catch (error) {

                console.error(
                    "匯入失敗：",
                    error
                );


                alert(
                    "匯入失敗，請確認 JSON 檔案是否正確。"
                );


            } finally {

                event.target.value =
                    "";
            }

        };


    reader.readAsText(
        file,
        "utf-8"
    );
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


    const extraIncome =
        overtimePay +
        mileageNet;


    const totalIncome =
        Number(
            settings.salary || 0
        ) +
        extraIncome;


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
            YAO｜加班與額外收入薪資明細
        </div>


        <div class="header-subtitle">
            Overtime & Additional Income Statement
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
                    ${pdfMoney(
                        settings.salary
                    )}
                </div>

            </div>


            <div class="summary-card">

                <div class="label">
                    本月加班費
                </div>

                <div class="value">
                    ${pdfMoney(
                        totals.overtimePay
                    )}
                </div>

            </div>


            <div class="summary-card">

                <div class="label">
                    里程補助
                </div>

                <div class="value">
                    ${pdfMoney(
                        totals.mileageGross
                    )}
                </div>

            </div>


            <div class="summary-card">

                <div class="label">
                    車輛損耗
                </div>

                <div class="value">
                    - ${pdfMoney(
                        totals.mileageWear
                    )}
                </div>

            </div>


            <div class="summary-card">

                <div class="label">
                    里程淨收入
                </div>

                <div class="value">
                    ${pdfMoney(
                        totals.mileageNet
                    )}
                </div>

            </div>


            <div class="summary-card">

                <div class="label">
                    本月額外收入
                </div>

                <div class="value">
                    ${pdfMoney(
                        totals.extraIncome
                    )}
                </div>

            </div>


            <!-- 最重要 -->
            <div class="summary-card highlight">

                <div class="label">
                    預估總收入
                </div>


                <div class="value">
                    ${pdfMoney(
                        totals.totalIncome
                    )}
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
                        Number(
                            settings.salary || 0
                        ) / 240
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
                        損耗方式
                    </th>

                    <th>
                        補助
                    </th>

                    <th>
                        損耗
                    </th>

                    <th>
                        淨收入
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


    <!-- =================================================
         本月結算
    ================================================= -->

    <section class="section">

        <h2 class="section-title">
            本月結算
        </h2>


        <div class="settlement">


            <div class="settlement-title">
                本月額外收入組成
            </div>


            <div class="settlement-row">

                <span class="settlement-label">
                    基本月薪
                </span>

                <span class="settlement-value">

                    ${pdfMoney(
                        settings.salary
                    )}

                </span>

            </div>


            <div class="settlement-row">

                <span class="settlement-label">
                    ${overtimeLabel}
                    加班費
                </span>

                <span class="settlement-value">

                    ${pdfMoney(
                        totals.overtimePay
                    )}

                </span>

            </div>


            <div class="settlement-row">

                <span class="settlement-label">
                    ${mileageLabel}
                    里程淨收入
                </span>

                <span class="settlement-value">

                    ${pdfMoney(
                        totals.mileageNet
                    )}

                </span>

            </div>


            <div class="settlement-row">

                <span class="settlement-label">
                    本月額外收入
                </span>

                <span class="settlement-value">

                    ${pdfMoney(
                        totals.extraIncome
                    )}

                </span>

            </div>


            <div class="settlement-final">

                <div class="label">
                    預估總收入
                </div>

                <div class="value">

                    ${pdfMoney(
                        totals.totalIncome
                    )}

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
                        settings.salary
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

        </div>

    </section>


    <!-- =================================================
         FOOTER
    ================================================= -->

    <div class="footer">

        <span>
            YAO 加班費計算器
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

function bindEvents() {

    $("settingsBtn")
        ?.addEventListener(
            "click",
            openSettings
        );


    $("closeSettingsModal")
        ?.addEventListener(
            "click",
            closeSettingsModal
        );


    $("cancelSettingsBtn")
        ?.addEventListener(
            "click",
            closeSettingsModal
        );


    $("settingsForm")
        ?.addEventListener(
            "submit",
            saveSettings
        );


    $("addRecordBtn")
        ?.addEventListener(
            "click",
            () => openRecord()
        );


    $("closeRecordModal")
        ?.addEventListener(
            "click",
            closeRecordModal
        );


    $("cancelRecordBtn")
        ?.addEventListener(
            "click",
            closeRecordModal
        );


    $("recordForm")
        ?.addEventListener(
            "submit",
            saveRecord
        );


    $("date")
        ?.addEventListener(
            "change",
            updateRecordPreview
        );


    $("dayType")
        ?.addEventListener(
            "change",
            updateRecordPreview
        );


    $("start")
        ?.addEventListener(
            "input",
            updateRecordPreview
        );


    $("end")
        ?.addEventListener(
            "input",
            updateRecordPreview
        );


    $("breakMinutes")
        ?.addEventListener(
            "input",
            updateRecordPreview
        );


    $("addMileageBtn")
        ?.addEventListener(
            "click",
            () => openMileage()
        );


    $("closeMileageModal")
        ?.addEventListener(
            "click",
            closeMileageModal
        );


    $("cancelMileageBtn")
        ?.addEventListener(
            "click",
            closeMileageModal
        );


    $("mileageForm")
        ?.addEventListener(
            "submit",
            saveMileage
        );


    $("mileageKmInput")
        ?.addEventListener(
            "input",
            updateMileagePreview
        );


    $("mileageRate")
        ?.addEventListener(
            "input",
            updateMileagePreview
        );


    $("mileageWearRate")
        ?.addEventListener(
            "input",
            updateMileagePreview
        );


    $("mileageWearInput")
        ?.addEventListener(
            "input",
            updateMileagePreview
        );


    $("prevMonth")
        ?.addEventListener(
            "click",
            () => changeMonth(-1)
        );


    $("nextMonth")
        ?.addEventListener(
            "click",
            () => changeMonth(1)
        );


    $("monthPicker")
        ?.addEventListener(
            "change",
            event => {

                if (
                    event.target.value
                ) {

                    selectedMonth =
                        event.target.value;

                    render();
                }

            }
        );


    $("exportBtn")
        ?.addEventListener(
            "click",
            exportData
        );


    $("importBtn")
        ?.addEventListener(
            "click",
            () => {

                $("importFile")
                    ?.click();

            }
        );


    $("importFile")
        ?.addEventListener(
            "change",
            importData
        );


    $("clearMonthBtn")
        ?.addEventListener(
            "click",
            clearCurrentMonth
        );


    $("clearAllRecordsBtn")
        ?.addEventListener(
            "click",
            clearAllRecords
        );


    $("exportPdfBtn")
        ?.addEventListener(
            "click",
            exportSalaryPDF
        );


    $("recordModal")
        ?.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    $("recordModal")
                ) {

                    closeRecordModal();
                }

            }
        );


    $("mileageModal")
        ?.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    $("mileageModal")
                ) {

                    closeMileageModal();
                }

            }
        );


    $("settingsModal")
        ?.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    $("settingsModal")
                ) {

                    closeSettingsModal();
                }

            }
        );
}


/* =========================================================
   DATA INIT
========================================================= */

let records =
    loadJSON(
        STORAGE_KEY,
        []
    );


let mileageRecords =
    loadJSON(
        MILEAGE_STORAGE_KEY,
        []
    );


let settings = {

    ...DEFAULT_SETTINGS,

    ...loadJSON(
        SETTINGS_KEY,
        {}
    )
};


let selectedMonth =
    getCurrentMonth();


/* =========================================================
   CLOUD SYNC BRIDGE
========================================================= */

window.YaoCloudDataBridge = {

    getData() {

        return {
            records,
            settings,
            mileageRecords
        };
    },

    setData(data) {

        records =
            Array.isArray(
                data.records
            )
                ? data.records
                : [];


        mileageRecords =
            Array.isArray(
                data.mileageRecords
            )
                ? data.mileageRecords
                : [];


        settings =
            data.settings &&
            typeof data.settings === "object"
                ? {
                    ...DEFAULT_SETTINGS,
                    ...data.settings
                }
                : settings;


        /*
           雲端資料收到後，同步保留在此裝置作為本機備份。
           不能呼叫 saveData()，否則會造成無限回傳同步。
        */

        saveJSON(
            STORAGE_KEY,
            records
        );

        saveJSON(
            SETTINGS_KEY,
            settings
        );

        saveJSON(
            MILEAGE_STORAGE_KEY,
            mileageRecords
        );


        render();
    }
};


/* =========================================================
   START
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        bindEvents();


        if (
            $("monthPicker")
        ) {

            $("monthPicker")
                .value =
                selectedMonth;
        }


        render();

    }
);
