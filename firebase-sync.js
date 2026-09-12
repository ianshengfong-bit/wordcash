/*

* YAO 加班費計算器
* Firebase 無帳密雲端同步
*
* 功能：
* 1. Firebase Anonymous Authentication
* 2. Firestore 雲端資料同步
* 3. 使用 24 碼同步碼連接不同裝置
* 4. AES-GCM 加密同步資料
* 5. 電腦與手機即時同步
* 6. 與 app.js 的 YaoCloudDataBridge 相容
*
* 前置條件：
* index.html 必須先載入：
*
* <script src="firebase-config.js"></script>
* <script type="module" src="firebase-sync.js"></script>
* <script src="app.js"></script>

*/

import {
initializeApp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
getAuth,
signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
getFirestore,
doc,
getDoc,
setDoc,
onSnapshot,
serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* =========================================================
CONSTANTS
========================================================= */

const CONNECTION_KEY =
"YAO_CLOUD_CONNECTION_V1";

const CLIENT_KEY =
"YAO_CLOUD_CLIENT_V1";

const COLLECTION =
"yaoSyncSpaces";

const SYNC_CODE_LENGTH = 24;

const encoder =
new TextEncoder();

const decoder =
new TextDecoder();

/* =========================================================
STATE
========================================================= */

let db = null;
let auth = null;

let connection =
readJSON(
CONNECTION_KEY,
null
);

let activeSpace = null;

let unsubscribe =
null;

let modal =
null;

let launcher =
null;

let statusText =
"尚未啟用同步";

let statusState =
"idle";

let syncing =
false;

let pushTimer =
null;

/* =========================================================
LOCAL STORAGE
========================================================= */

function readJSON(
key,
fallback
) {

try {

    const value =
        localStorage.getItem(key);

    if (!value) {

        return fallback;

    }

    return JSON.parse(value);

} catch (error) {

    console.warn(
        "YAO Cloud Sync：讀取 LocalStorage 失敗",
        error
    );

    return fallback;

}

}

function writeJSON(
key,
value
) {

try {

    localStorage.setItem(
        key,
        JSON.stringify(value)
    );

} catch (error) {

    console.warn(
        "YAO Cloud Sync：寫入 LocalStorage 失敗",
        error
    );

}

}

/* =========================================================
APP DATA BRIDGE
========================================================= */

function getBridge() {

return window.YaoCloudDataBridge;

}

/* =========================================================
STATUS
========================================================= */

function setStatus(
text,
state = "idle"
) {

statusText =
    text;

statusState =
    state;

if (launcher) {

    launcher.dataset.state =
        state;

    launcher.title =
        `YAO 雲端同步：${text}`;

}

window.dispatchEvent(
    new CustomEvent(
        "yao-sync-status",
        {
            detail: {
                text,
                state
            }
        }
    )
);

}

/* =========================================================
FIREBASE CONFIG
========================================================= */

function isFirebaseConfigured() {

const config =
    window.YAO_FIREBASE_CONFIG;

return Boolean(
    config &&
    config.apiKey &&
    config.authDomain &&
    config.projectId &&
    config.appId
);

}

/* =========================================================
SYNC CODE
========================================================= */

function normaliseCode(
value
) {

return String(
    value || ""
)
    .toUpperCase()
    .replace(
        /[^A-Z2-9]/g,
        ""
    )
    .replace(
        /[01ILO]/g,
        "");

}

function displayCode(
value
) {

const clean =
    normaliseCode(
        value
    );

const groups =
    clean.match(
        /.{1,4}/g
    );

return groups
    ? groups.join("-")
    : "";

}

function generateSyncCode() {

const alphabet =
    "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const bytes =
    crypto.getRandomValues(
        new Uint8Array(
            SYNC_CODE_LENGTH
        )
    );

let result =
    "";

for (
    let i = 0;
    i < bytes.length;
    i++
) {

    result +=
        alphabet[
            bytes[i] %
            alphabet.length
        ];

}

return result;

}

/* =========================================================
CLIENT ID
========================================================= */

function getClientId() {

let clientId =
    localStorage.getItem(
        CLIENT_KEY
    );

if (!clientId) {

    clientId =
        crypto.randomUUID();

    localStorage.setItem(
        CLIENT_KEY,
        clientId
    );

}

return clientId;

}

/* =========================================================
BASE64
========================================================= */

function bytesToBase64(
bytes
) {

let binary =
    "";

for (
    let i = 0;
    i < bytes.length;
    i++
) {

    binary +=
        String.fromCharCode(
            bytes[i]
        );

}

return btoa(
    binary
);

}

function base64ToBytes(
value
) {

const binary =
    atob(value);

const bytes =
    new Uint8Array(
        binary.length
    );

for (
    let i = 0;
    i < binary.length;
    i++
) {

    bytes[i] =
        binary.charCodeAt(i);

}

return bytes;

}

/* =========================================================
HASH
========================================================= */

async function sha256(
value
) {

const digest =
    await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(value)
    );

return new Uint8Array(
    digest
);

}

/* =========================================================
FIRESTORE SPACE ID
========================================================= */

async function getSpaceId(
code
) {

const digest =
    await sha256(
        `YAO-space-v1:${code}`
    );

return bytesToBase64(
    digest
)
    .replace(
        /\+/g,
        "-"
    )
    .replace(
        /\//g,
        "_"
    )
    .replace(
        /=/g,
        ""
    );

}

/* =========================================================
AES KEY
========================================================= */

async function getEncryptionKey(
code
) {

const keyMaterial =
    await sha256(
        `YAO-data-v1:${code}`
    );

return crypto.subtle.importKey(
    "raw",
    keyMaterial,
    {
        name: "AES-GCM"
    },
    false,
    [
        "encrypt",
        "decrypt"
    ]
);

}

/* =========================================================
ENCRYPT
========================================================= */

async function encryptData(
data,
code
) {

const key =
    await getEncryptionKey(
        code
    );

const iv =
    crypto.getRandomValues(
        new Uint8Array(12)
    );

const plaintext =
    encoder.encode(
        JSON.stringify(data)
    );

const encrypted =
    await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv
        },
        key,
        plaintext
    );

return JSON.stringify(
    {
        v: 1,
        i: bytesToBase64(
            iv
        ),
        c: bytesToBase64(
            new Uint8Array(
                encrypted
            )
        )
    }
);

}

/* =========================================================
DECRYPT
========================================================= */

async function decryptData(
payload,
code
) {

let packed;

try {

    packed =
        JSON.parse(
            payload
        );

} catch {

    throw new Error(
        "同步資料格式錯誤"
    );

}

if (
    !packed ||
    packed.v !== 1 ||
    !packed.i ||
    !packed.c
) {

    throw new Error(
        "同步資料格式不正確"
    );

}

const key =
    await getEncryptionKey(
        code
    );

const decrypted =
    await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: base64ToBytes(
                packed.i
            )
        },
        key,
        base64ToBytes(
            packed.c
        )
    );

return JSON.parse(
    decoder.decode(
        decrypted
    )
);

}

/* =========================================================
DATA CLEANUP
========================================================= */

function cleanData(
data
) {

const source =
    data &&
    typeof data === "object"
        ? data
        : {};

return {

    records:
        Array.isArray(
            source.records
        )
            ? source.records
            : [],

    mileageRecords:
        Array.isArray(
            source.mileageRecords
        )
            ? source.mileageRecords
            : [],

    settings:
        source.settings &&
        typeof source.settings === "object"
            ? source.settings
            : {}

};

}

/* =========================================================
FIREBASE INITIALIZATION
========================================================= */

async function ensureFirebase() {

if (
    !isFirebaseConfigured()
) {

    throw new Error(
        "找不到 Firebase 設定。請確認 firebase-config.js 已正確放在 index.html 同一層。"
    );

}

if (
    db &&
    auth
) {

    return;

}

const app =
    initializeApp(
        window.YAO_FIREBASE_CONFIG
    );

db =
    getFirestore(
        app
    );

auth =
    getAuth(
        app
    );

if (
    !auth.currentUser
) {

    await signInAnonymously(
        auth
    );

}

}

/* =========================================================
FIRESTORE REFERENCE
========================================================= */

function getRemoteRef() {

if (!db) {

    throw new Error(
        "Firebase 尚未初始化"
    );

}

if (
    !activeSpace ||
    !activeSpace.id
) {

    throw new Error(
        "目前沒有連接同步空間"
    );

}

return doc(
    db,
    COLLECTION,
    activeSpace.id
);

}

/* =========================================================
SAVE CONNECTION
========================================================= */

function saveConnection(
code,
id
) {

const data = {

    code,
    id,

    connectedAt:
        Date.now()

};

connection =
    data;

activeSpace =
    data;

writeJSON(
    CONNECTION_KEY,
    data
);

}

/* =========================================================
REMOVE CONNECTION
========================================================= */

function removeConnection() {

unsubscribe?.();

unsubscribe =
    null;

activeSpace =
    null;

connection =
    null;

localStorage.removeItem(
    CONNECTION_KEY
);

setStatus(
    "尚未啟用同步",
    "idle"
);

}

/* =========================================================
GET CURRENT APP DATA
========================================================= */

function getCurrentAppData() {

const app =
    getBridge();

if (
    !app ||
    typeof app.getData !== "function"
) {

    return cleanData(
        null
    );

}

return cleanData(
    app.getData()
);

}

/* =========================================================
APPLY REMOTE DATA
========================================================= */

function applyRemoteData(
data
) {

const app =
    getBridge();

if (
    !app ||
    typeof app.setData !== "function"
) {

    throw new Error(
        "找不到 YaoCloudDataBridge.setData"
    );

}

app.setData(
    cleanData(
        data
    )
);

}

/* =========================================================
UPLOAD CURRENT DATA
========================================================= */

async function uploadCurrentData() {

if (
    !activeSpace
) {

    return;

}

if (
    syncing
) {

    return;

}

const app =
    getBridge();

if (
    !app ||
    typeof app.getData !== "function"
) {

    return;

}

syncing =
    true;

setStatus(
    "正在同步…",
    "working"
);

try {

    const data =
        getCurrentAppData();

    const ciphertext =
        await encryptData(
            data,
            activeSpace.code
        );

    await setDoc(
        getRemoteRef(),
        {

            ciphertext,

            schemaVersion:
                1,

            clientId:
                getClientId(),

            clientUpdatedAt:
                Date.now(),

            updatedAt:
                serverTimestamp()

        },
        {
            merge: true
        }
    );

    setStatus(
        "已同步",
        "ready"
    );

} catch (error) {

    console.error(
        "YAO Cloud Sync upload error:",
        error
    );

    setStatus(
        "同步失敗",
        "error"
    );

    throw error;

} finally {

    syncing =
        false;

}

}

/* =========================================================
SCHEDULE PUSH
========================================================= */

function schedulePush() {

if (
    !activeSpace
) {

    return;

}

if (
    pushTimer
) {

    clearTimeout(
        pushTimer
    );

}

pushTimer =
    setTimeout(
        () => {

            pushTimer =
                null;

            uploadCurrentData()
                .catch(
                    () => {}
                );

        },
        350
    );

}

/* =========================================================
RECEIVE SNAPSHOT
========================================================= */

async function processSnapshot(
snapshot
) {

if (
    !snapshot.exists()
) {

    return;

}

const remoteData =
    snapshot.data();

if (
    !remoteData ||
    !remoteData.ciphertext
) {

    return;

}

try {

    const decrypted =
        await decryptData(
            remoteData.ciphertext,
            activeSpace.code
        );

    applyRemoteData(
        decrypted
    );

    setStatus(
        "已同步",
        "ready"
    );

} catch (error) {

    console.error(
        "YAO Cloud Sync decrypt error:",
        error
    );

    setStatus(
        "同步碼錯誤或雲端資料無法讀取",
        "error"
    );

}

}

/* =========================================================
REALTIME LISTENER
========================================================= */

function listenToRemote() {

unsubscribe?.();

unsubscribe =
    null;

if (
    !activeSpace
) {

    return;

}

try {

    const ref =
        getRemoteRef();

    unsubscribe =
        onSnapshot(
            ref,
            snapshot => {

                processSnapshot(
                    snapshot
                );

            },
            error => {

                console.error(
                    "YAO Cloud Sync realtime error:",
                    error
                );

                setStatus(
                    "雲端連線中斷",
                    "error"
                );

            }
        );

} catch (error) {

    console.error(
        "YAO Cloud Sync listener error:",
        error
    );

    setStatus(
        "無法建立同步連線",
        "error"
    );

}

}

/* =========================================================
CREATE NEW SPACE
========================================================= */

async function createSyncSpace() {

await ensureFirebase();

setStatus(
    "正在建立同步…",
    "working"
);

let code = "";
let id = "";
let exists = true;

let attempts = 0;

while (
    exists &&
    attempts < 5
) {

    attempts++;

    code =
        generateSyncCode();

    id =
        await getSpaceId(
            code
        );

    const ref =
        doc(
            db,
            COLLECTION,
            id
        );

    const snapshot =
        await getDoc(
            ref
        );

    exists =
        snapshot.exists();

}

if (exists) {

    throw new Error(
        "建立同步空間失敗，請再試一次。"
    );

}

saveConnection(
    code,
    id
);

await uploadCurrentData();

listenToRemote();

showCreatedCode(
    code
);

}

/* =========================================================
CONNECT EXISTING SPACE
========================================================= */

async function connectToSpace(
inputCode
) {

await ensureFirebase();

const code =
    normaliseCode(
        inputCode
    );

if (
    code.length !==
    SYNC_CODE_LENGTH
) {

    throw new Error(
        "同步碼格式不正確，請輸入完整的 24 碼同步碼。"
    );

}

setStatus(
    "正在連接雲端…",
    "working"
);

const id =
    await getSpaceId(
        code
    );

activeSpace = {
    code,
    id
};

const snapshot =
    await getDoc(
        getRemoteRef()
    );

if (
    !snapshot.exists()
) {

    activeSpace =
        null;

    throw new Error(
        "找不到這組同步碼，請確認同步碼是否正確。"
    );

}

await processSnapshot(
    snapshot
);

saveConnection(
    code,
    id
);

listenToRemote();

closeModal();

setStatus(
    "已同步",
    "ready"
);

}

/* =========================================================
RESTORE CONNECTION
========================================================= */

async function restoreConnection() {

if (
    !connection ||
    !connection.code ||
    !connection.id
) {

    setStatus(
        "尚未啟用同步",
        "idle"
    );

    return;

}

try {

    await ensureFirebase();

    activeSpace = {

        code:
            normaliseCode(
                connection.code
            ),

        id:
            connection.id

    };

    const expectedId =
        await getSpaceId(
            activeSpace.code
        );

    if (
        expectedId !==
        activeSpace.id
    ) {

        throw new Error(
            "儲存的同步連線資料不正確"
        );

    }

    const snapshot =
        await getDoc(
            getRemoteRef()
        );

    if (
        !snapshot.exists()
    ) {

        throw new Error(
            "雲端同步資料不存在"
        );

    }

    await processSnapshot(
        snapshot
    );

    listenToRemote();

    setStatus(
        "已同步",
        "ready"
    );

} catch (error) {

    console.warn(
        "YAO Cloud Sync restore failed:",
        error
    );

    setStatus(
        "尚未連線",
        "error"
    );

}

}

/* =========================================================
MODAL
========================================================= */

function closeModal() {

if (modal) {

    modal.remove();

}

modal =
    null;

}

/* =========================================================
CREATE MODAL
========================================================= */

function createModal() {

closeModal();

modal =
    document.createElement(
        "div"
    );

modal.className =
    "yao-sync-modal";

modal.addEventListener(
    "click",
    event => {

        if (
            event.target ===
            modal
        ) {

            closeModal();

        }

    }
);

document.body.appendChild(
    modal
);

}

/* =========================================================
CREATED CODE SCREEN
========================================================= */

function showCreatedCode(
code
) {

createModal();

modal.innerHTML = `

    <div
        class="yao-sync-card"
        role="dialog"
        aria-modal="true"
        aria-label="YAO 同步碼"
    >

        <button
            type="button"
            class="yao-sync-close"
            data-close
            aria-label="關閉"
        >
            ×
        </button>

        <div class="yao-sync-icon">
            ☁️
        </div>

        <h2>
            同步已啟用
        </h2>

        <p>
            這是你的 YAO 同步碼。
            手機第一次使用時輸入這組碼，
            就可以看到同一份資料。
        </p>

        <div class="yao-sync-code">
            ${displayCode(code)}
        </div>

        <button
            type="button"
            class="yao-sync-primary"
            data-copy
        >
            複製同步碼
        </button>

        <p class="yao-sync-note">
            請把同步碼保存好。同步碼也是資料加密金鑰的一部分。
        </p>

    </div>
`;

modal.querySelector(
    "[data-close]"
).onclick =
    closeModal;

modal.querySelector(
    "[data-copy]"
).onclick =
    async event => {

        try {

            await navigator.clipboard.writeText(
                displayCode(code)
            );

            event.currentTarget.textContent =
                "已複製";

        } catch {

            alert(
                `同步碼：${displayCode(code)}`
            );

        }

    };

}

/* =========================================================
MAIN SETTINGS SCREEN
========================================================= */

function showSettings() {

createModal();

if (
    !isFirebaseConfigured()
) {

    modal.innerHTML = `

        <div
            class="yao-sync-card"
            role="dialog"
            aria-modal="true"
            aria-label="YAO 同步設定"
        >

            <button
                type="button"
                class="yao-sync-close"
                data-close
                aria-label="關閉"
            >
                ×
            </button>

            <div class="yao-sync-icon">
                ⚙️
            </div>

            <h2>
                Firebase 尚未設定
            </h2>

            <p>
                找不到 firebase-config.js。
                請確認它和 index.html 放在同一層，
                而且 index.html 已正確載入它。
            </p>

        </div>
    `;

    modal.querySelector(
        "[data-close]"
    ).onclick =
        closeModal;

    return;

}


if (
    connection
) {

    modal.innerHTML = `

        <div
            class="yao-sync-card"
            role="dialog"
            aria-modal="true"
            aria-label="YAO 同步設定"
        >

            <button
                type="button"
                class="yao-sync-close"
                data-close
                aria-label="關閉"
            >
                ×
            </button>

            <div class="yao-sync-icon">
                ☁️
            </div>

            <h2>
                已連接雲端
            </h2>

            <p>
                這台裝置正在使用 YAO 雲端同步。
                新增、修改、刪除資料會自動同步。
            </p>

            <button
                type="button"
                class="yao-sync-primary"
                data-show-code
            >
                查看同步碼
            </button>

            <button
                type="button"
                class="yao-sync-text"
                data-disconnect
            >
                中斷這台裝置的同步
            </button>

        </div>
    `;

    modal.querySelector(
        "[data-close]"
    ).onclick =
        closeModal;

    modal.querySelector(
        "[data-show-code]"
    ).onclick =
        () => {

            showCreatedCode(
                connection.code
            );

        };

    modal.querySelector(
        "[data-disconnect]"
    ).onclick =
        () => {

            const confirmed =
                confirm(
                    "只會中斷這台裝置，不會刪除雲端資料。確定嗎？"
                );

            if (!confirmed) {

                return;

            }

            removeConnection();

            closeModal();

        };

    return;

}


modal.innerHTML = `

    <div
        class="yao-sync-card"
        role="dialog"
        aria-modal="true"
        aria-label="YAO 同步設定"
    >

        <button
            type="button"
            class="yao-sync-close"
            data-close
            aria-label="關閉"
        >
            ×
        </button>

        <div class="yao-sync-icon">
            ☁️
        </div>

        <h2>
            電腦與手機同步
        </h2>

        <p>
            不用 Email、密碼，也不用額外建立帳號。
            第一次只要建立同步碼，其他裝置輸入同一組碼即可。
        </p>

        <button
            type="button"
            class="yao-sync-primary"
            data-create
        >
            在這台建立同步碼
        </button>

        <div class="yao-sync-divider">
            或
        </div>

        <label
            class="yao-sync-label"
            for="yaoSyncCode"
        >
            輸入既有同步碼
        </label>

        <input
            id="yaoSyncCode"
            class="yao-sync-input"
            type="text"
            inputmode="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            maxlength="29"
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        >

        <button
            type="button"
            class="yao-sync-secondary"
            data-connect
        >
            連接既有資料
        </button>

        <p class="yao-sync-note">
            連接後，這台裝置會以雲端資料為準。
        </p>

    </div>
`;


modal.querySelector(
    "[data-close]"
).onclick =
    closeModal;


modal.querySelector(
    "[data-create]"
).onclick =
    async event => {

        const button =
            event.currentTarget;

        button.disabled =
            true;

        button.textContent =
            "正在建立…";

        try {

            await createSyncSpace();

        } catch (error) {

            console.error(
                error
            );

            alert(
                `建立同步失敗：${error.message}`
            );

            button.disabled =
                false;

            button.textContent =
                "在這台建立同步碼";

        }

    };


modal.querySelector(
    "[data-connect]"
).onclick =
    async event => {

        const input =
            modal.querySelector(
                "#yaoSyncCode"
            );

        const button =
            event.currentTarget;

        const code =
            normaliseCode(
                input.value
            );

        if (
            code.length !==
            SYNC_CODE_LENGTH
        ) {

            alert(
                "請輸入完整的 24 碼同步碼。"
            );

            input.focus();

            return;

        }

        button.disabled =
            true;

        button.textContent =
            "正在連接…";

        try {

            await connectToSpace(
                code
            );

        } catch (error) {

            console.error(
                error
            );

            alert(
                `連接失敗：${error.message}`
            );

            button.disabled =
                false;

            button.textContent =
                "連接既有資料";

        }

    };


const input =
    modal.querySelector(
        "#yaoSyncCode"
    );

input.addEventListener(
    "input",
    () => {

        const normalised =
            normaliseCode(
                input.value
            );

        input.value =
            displayCode(
                normalised
            );

    }
);

}

/* =========================================================
SYNC BUTTON CSS
========================================================= */

function injectStyles() {

if (
    document.getElementById(
        "yao-sync-styles"
    )
) {

    return;

}

const style =
    document.createElement(
        "style"
    );

style.id =
    "yao-sync-styles";

style.textContent = `

    .yao-sync-launcher {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 900;

        border: 0;
        border-radius: 999px;

        padding:
            11px 15px;

        background:
            #111827;

        color:
            #ffffff;

        box-shadow:
            0 8px 24px
            rgba(17, 24, 39, .24);

        font:
            inherit;

        font-size:
            13px;

        font-weight:
            700;

        cursor:
            pointer;

        transition:
            transform .15s ease,
            box-shadow .15s ease,
            background .15s ease;

        -webkit-tap-highlight-color:
            transparent;
    }


    .yao-sync-launcher:hover {
        transform:
            translateY(-1px);

        box-shadow:
            0 10px 28px
            rgba(17, 24, 39, .28);
    }


    .yao-sync-launcher[data-state="ready"] {
        background:
            #155e75;
    }


    .yao-sync-launcher[data-state="working"] {
        opacity:
            .85;
    }


    .yao-sync-launcher[data-state="error"] {
        background:
            #7f1d1d;
    }


    .yao-sync-modal {
        position:
            fixed;

        inset:
            0;

        z-index:
            2000;

        display:
            grid;

        place-items:
            center;

        padding:
            18px;

        background:
            rgba(17, 24, 39, .56);

        box-sizing:
            border-box;
    }


    .yao-sync-modal *,
    .yao-sync-modal *::before,
    .yao-sync-modal *::after {
        box-sizing:
            border-box;
    }


    .yao-sync-card {
        position:
            relative;

        width:
            min(420px, 100%);

        max-height:
            calc(100vh - 36px);

        overflow:
            auto;

        padding:
            28px;

        border-radius:
            22px;

        background:
            #ffffff;

        color:
            #111827;

        box-shadow:
            0 24px 80px
            rgba(0, 0, 0, .28);

        text-align:
            center;
    }


    .yao-sync-card h2 {
        margin:
            8px 0 10px;

        font-size:
            21px;

        line-height:
            1.35;
    }


    .yao-sync-card p {
        margin:
            0 0 20px;

        color:
            #6b7280;

        font-size:
            14px;

        line-height:
            1.65;
    }


    .yao-sync-icon {
        font-size:
            31px;

        line-height:
            1;
    }


    .yao-sync-close {
        position:
            absolute;

        top:
            13px;

        right:
            13px;

        width:
            34px;

        height:
            34px;

        border:
            0;

        border-radius:
            9px;

        background:
            #f3f4f6;

        color:
            #111827;

        font-size:
            23px;

        line-height:
            1;

        cursor:
            pointer;
    }


    .yao-sync-primary,
    .yao-sync-secondary {
        width:
            100%;

        border:
            0;

        border-radius:
            11px;

        padding:
            12px 14px;

        font:
            inherit;

        font-weight:
            700;

        cursor:
            pointer;
    }


    .yao-sync-primary {
        background:
            #111827;

        color:
            #ffffff;
    }


    .yao-sync-primary:disabled,
    .yao-sync-secondary:disabled {
        opacity:
            .55;

        cursor:
            wait;
    }


    .yao-sync-secondary {
        margin-top:
            9px;

        background:
            #e5e7eb;

        color:
            #111827;
    }


    .yao-sync-text {
        border:
            0;

        background:
            transparent;

        color:
            #6b7280;

        margin-top:
            15px;

        padding:
            6px;

        font:
            inherit;

        font-size:
            13px;

        cursor:
            pointer;
    }


    .yao-sync-divider {
        margin:
            18px 0;

        color:
            #9ca3af;

        font-size:
            13px;
    }


    .yao-sync-label {
        display:
            block;

        margin-bottom:
            7px;

        color:
            #4b5563;

        font-size:
            13px;

        font-weight:
            700;

        text-align:
            left;
    }


    .yao-sync-input {
        width:
            100%;

        border:
            1px solid
            #d1d5db;

        border-radius:
            11px;

        padding:
            12px;

        background:
            #ffffff;

        color:
            #111827;

        font:
            inherit;

        letter-spacing:
            .06em;

        outline:
            none;
    }


    .yao-sync-input:focus {
        border-color:
            #6b7280;

        box-shadow:
            0 0 0 3px
            rgba(107, 114, 128, .14);
    }


    .yao-sync-code {
        display:
            block;

        margin:
            16px 0;

        padding:
            14px 10px;

        border-radius:
            12px;

        background:
            #f3f4f6;

        color:
            #111827;

        font-family:
            ui-monospace,
            SFMono-Regular,
            Menlo,
            Monaco,
            Consolas,
            monospace;

        font-size:
            17px;

        font-weight:
            800;

        letter-spacing:
            .08em;

        word-break:
            break-word;
    }


    .yao-sync-note {
        margin:
            13px 0 0 !important;

        color:
            #9ca3af !important;

        font-size:
            12px !important;

        line-height:
            1.55 !important;
    }


    @media (
        max-width: 620px
    ) {

        .yao-sync-launcher {
            right:
                12px;

            bottom:
                12px;
        }


        .yao-sync-card {
            padding:
                25px 20px;
        }

    }

`;

document.head.appendChild(
    style
);

}

/* =========================================================
MOUNT BUTTON
========================================================= */

function mount() {

if (
    !document.body
) {

    return;

}

injectStyles();

if (
    document.querySelector(
        ".yao-sync-launcher"
    )
) {

    launcher =
        document.querySelector(
            ".yao-sync-launcher"
        );

    setStatus(
        connection
            ? "連線中…"
            : "尚未啟用同步",
        connection
            ? "working"
            : "idle"
    );

    restoreConnection();

    return;

}

launcher =
    document.createElement(
        "button"
    );

launcher.type =
    "button";

launcher.className =
    "yao-sync-launcher";

launcher.textContent =
    "☁️ 同步";

launcher.setAttribute(
    "aria-label",
    "YAO 雲端同步"
);

launcher.onclick =
    showSettings;

document.body.appendChild(
    launcher
);

setStatus(
    connection
        ? "連線中…"
        : "尚未啟用同步",
    connection
        ? "working"
        : "idle"
);

restoreConnection();

}

/* =========================================================
PUBLIC API
========================================================= */

window.YaoCloudSync = {

openSettings:
    showSettings,

schedulePush,

getStatus() {

    return {

        text:
            statusText,

        state:
            statusState,

        connected:
            Boolean(
                activeSpace
            )

    };

}

};

/* =========================================================
START
========================================================= */

if (
document.readyState ===
"loading"
) {

document.addEventListener(
    "DOMContentLoaded",
    mount,
    {
        once: true
    }
);

} else {

mount();

}