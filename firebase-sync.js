+/*
 * YAO 加班費計算器：無帳密雲端同步
 *
 * 載入前，頁面必須先設定 window.YAO_FIREBASE_CONFIG，並提供
 * window.YaoCloudDataBridge.getData() / setData(data)。
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
    getFirestore,
    doc,
    getDoc,
    onSnapshot,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const CONNECTION_KEY = "YAO_CLOUD_CONNECTION_V1";
const CLIENT_KEY = "YAO_CLOUD_CLIENT_V1";
const COLLECTION = "yaoSyncSpaces";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let db;
let auth;
let connection = readJSON(CONNECTION_KEY, null);
let unsubscribe = null;
let modal;
let statusEl;
let activeSpace = null;
let syncing = false;

function readJSON(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
}

function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function bridge() {
    return window.YaoCloudDataBridge;
}

function setStatus(text, state = "idle") {
    if (statusEl) {
        statusEl.textContent = text;
        statusEl.dataset.state = state;
    }

    window.dispatchEvent(
        new CustomEvent("yao-sync-status", { detail: { text, state } })
    );
}

function configured() {
    const config = window.YAO_FIREBASE_CONFIG;
    return Boolean(config && config.apiKey && config.projectId && config.appId);
}

function normaliseCode(value) {
    return String(value || "")
        .toUpperCase()
        .replace(/[^A-Z2-9]/g, "")
        .replace(/[01ILO]/g, "");
}

function displayCode(value) {
    return normaliseCode(value).match(/.{1,4}/g)?.join("-") || "";
}

function generateCode() {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const values = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(values, value => alphabet[value % alphabet.length]).join("");
}

function getClientId() {
    let clientId = localStorage.getItem(CLIENT_KEY);
    if (!clientId) {
        clientId = crypto.randomUUID();
        localStorage.setItem(CLIENT_KEY, clientId);
    }
    return clientId;
}

function toBase64(bytes) {
    let result = "";
    bytes.forEach(byte => {
        result += String.fromCharCode(byte);
    });
    return btoa(result);
}

function fromBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function sha256(value) {
    return new Uint8Array(
        await crypto.subtle.digest("SHA-256", encoder.encode(value))
    );
}

async function spaceIdFor(code) {
    const digest = await sha256(`YAO-space-v1:${code}`);
    return toBase64(digest)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

async function encryptionKeyFor(code) {
    const material = await crypto.subtle.importKey(
        "raw",
        await sha256(`YAO-data-v1:${code}`),
        "AES-GCM",
        false,
        ["encrypt", "decrypt"]
    );
    return material;
}

async function encrypt(data, code) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await encryptionKeyFor(code);
    const plain = encoder.encode(JSON.stringify(data));
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain)
    );

    return JSON.stringify({ v: 1, i: toBase64(iv), c: toBase64(ciphertext) });
}

async function decrypt(payload, code) {
    const packed = JSON.parse(payload);
    if (packed.v !== 1 || !packed.i || !packed.c) {
        throw new Error("同步資料格式不正確");
    }

    const key = await encryptionKeyFor(code);
    const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(packed.i) },
        key,
        fromBase64(packed.c)
    );
    return JSON.parse(decoder.decode(plain));
}

function cleanData(data) {
    return {
        records: Array.isArray(data?.records) ? data.records : [],
        mileageRecords: Array.isArray(data?.mileageRecords)
            ? data.mileageRecords
            : [],
        settings: data?.settings && typeof data.settings === "object"
            ? data.settings
            : {}
    };
}

async function ensureFirebase() {
    if (!configured()) {
        throw new Error("尚未設定 Firebase");
    }

    if (!db) {
        const app = initializeApp(window.YAO_FIREBASE_CONFIG);
        db = getFirestore(app);
        auth = getAuth(app);
        await signInAnonymously(auth);
    }
}

function remoteRef() {
    return doc(db, COLLECTION, activeSpace.id);
}

function saveConnection(code, id) {
    connection = { code, id, connectedAt: Date.now() };
    writeJSON(CONNECTION_KEY, connection);
    activeSpace = connection;
}

async function uploadCurrentData() {
    if (!activeSpace || !bridge()?.getData) {
        return;
    }

    syncing = true;
    setStatus("正在同步…", "working");

    try {
        const ciphertext = await encrypt(cleanData(bridge().getData()), activeSpace.code);
        await setDoc(remoteRef(), {
            ciphertext,
            schemaVersion: 1,
            clientId: getClientId(),
            clientUpdatedAt: Date.now(),
            updatedAt: serverTimestamp()
        });
        setStatus("已同步", "ready");
    } catch (error) {
        console.error("YAO 同步失敗：", error);
        setStatus("同步失敗", "error");
        throw error;
    } finally {
        syncing = false;
    }
}

async function useRemoteData(snapshot) {
    if (!snapshot.exists() || !snapshot.data().ciphertext || !bridge()?.setData) {
        return;
    }

    try {
        const incoming = cleanData(
            await decrypt(snapshot.data().ciphertext, activeSpace.code)
        );
        bridge().setData(incoming);
        setStatus("已同步", "ready");
    } catch (error) {
        console.error("YAO 同步資料無法讀取：", error);
        setStatus("同步碼不正確或資料無法讀取", "error");
    }
}

function listenToRemote() {
    if (unsubscribe) {
        unsubscribe();
    }

    unsubscribe = onSnapshot(
        remoteRef(),
        snapshot => useRemoteData(snapshot),
        error => {
            console.error("YAO 即時同步中斷：", error);
            setStatus("目前無法連線", "error");
        }
    );
}

async function createSpace() {
    await ensureFirebase();
    const code = generateCode();
    const id = await spaceIdFor(code);

    activeSpace = { code, id };
    const snapshot = await getDoc(remoteRef());
    if (snapshot.exists()) {
        return createSpace();
    }

    saveConnection(code, id);
    await uploadCurrentData();
    listenToRemote();
    showCodeScreen(code, true);
}

async function connectSpace(code) {
    await ensureFirebase();
    const normalised = normaliseCode(code);
    if (normalised.length < 20) {
        throw new Error("請輸入完整的同步碼");
    }

    const id = await spaceIdFor(normalised);
    activeSpace = { code: normalised, id };
    const snapshot = await getDoc(remoteRef());
    if (!snapshot.exists()) {
        activeSpace = null;
        throw new Error("找不到這組同步碼的資料。請確認輸入無誤。 ");
    }

    await useRemoteData(snapshot);
    saveConnection(normalised, id);
    listenToRemote();
    closeModal();
}

async function restoreConnection() {
    if (!connection) {
        setStatus("尚未啟用同步", "idle");
        return;
    }

    try {
        await ensureFirebase();
        activeSpace = connection;
        const snapshot = await getDoc(remoteRef());
        if (!snapshot.exists()) {
            throw new Error("雲端資料不存在");
        }
        await useRemoteData(snapshot);
        listenToRemote();
    } catch (error) {
        console.error("YAO 同步連線失敗：", error);
        setStatus("目前無法連線", "error");
    }
}

function schedulePush() {
    if (!activeSpace || syncing) {
        return;
    }
    window.clearTimeout(schedulePush.timer);
    schedulePush.timer = window.setTimeout(() => {
        uploadCurrentData().catch(() => {});
    }, 350);
}

function closeModal() {
    modal?.remove();
    modal = null;
}

function showCodeScreen(code, created) {
    modal.innerHTML = `
        <div class="yao-sync-card" role="dialog" aria-modal="true" aria-label="YAO 同步碼">
            <button class="yao-sync-close" type="button" aria-label="關閉">×</button>
            <div class="yao-sync-icon">☁️</div>
            <h2>${created ? "同步已啟用" : "你的同步碼"}</h2>
            <p>把這組碼留好；手機第一次開啟時輸入它，就會看到同一份資料。</p>
            <output class="yao-sync-code">${displayCode(code)}</output>
            <button class="yao-sync-primary" type="button" data-copy>複製同步碼</button>
            <p class="yao-sync-note">這組碼也用來加密資料。不要傳給其他人。</p>
        </div>`;
    modal.querySelector(".yao-sync-close").onclick = closeModal;
    modal.querySelector("[data-copy]").onclick = async event => {
        await navigator.clipboard.writeText(displayCode(code));
        event.currentTarget.textContent = "已複製";
    };
}

function showMainScreen() {
    if (!configured()) {
        modal.innerHTML = `
            <div class="yao-sync-card" role="dialog" aria-modal="true" aria-label="設定同步">
                <button class="yao-sync-close" type="button" aria-label="關閉">×</button>
                <div class="yao-sync-icon">⚙️</div>
                <h2>還差雲端設定</h2>
                <p>請先把 Firebase Web App 的設定貼進 <code>index.html</code>。完成後，這裡就能建立同步碼。</p>
            </div>`;
        modal.querySelector(".yao-sync-close").onclick = closeModal;
        return;
    }

    if (connection) {
        modal.innerHTML = `
            <div class="yao-sync-card" role="dialog" aria-modal="true" aria-label="同步設定">
                <button class="yao-sync-close" type="button" aria-label="關閉">×</button>
                <div class="yao-sync-icon">☁️</div>
                <h2>這台裝置已連接</h2>
                <p>電腦與手機的新增、修改、刪除會自動同步。</p>
                <button class="yao-sync-primary" type="button" data-show-code>顯示同步碼</button>
                <button class="yao-sync-text" type="button" data-disconnect>停止在這台裝置同步</button>
            </div>`;
        modal.querySelector(".yao-sync-close").onclick = closeModal;
        modal.querySelector("[data-show-code]").onclick = () => showCodeScreen(connection.code, false);
        modal.querySelector("[data-disconnect]").onclick = () => {
            if (!confirm("只會中斷這台裝置；雲端資料不會刪除。")) return;
            unsubscribe?.();
            unsubscribe = null;
            activeSpace = null;
            connection = null;
            localStorage.removeItem(CONNECTION_KEY);
            setStatus("尚未啟用同步", "idle");
            closeModal();
        };
        return;
    }

    modal.innerHTML = `
        <div class="yao-sync-card" role="dialog" aria-modal="true" aria-label="設定同步">
            <button class="yao-sync-close" type="button" aria-label="關閉">×</button>
            <div class="yao-sync-icon">☁️</div>
            <h2>在手機與電腦間同步</h2>
            <p>不用帳號、密碼或登入。第一次只要使用同一組同步碼。</p>
            <button class="yao-sync-primary" type="button" data-create>在這台建立同步碼</button>
            <div class="yao-sync-divider">或</div>
            <label class="yao-sync-label" for="yaoSyncCode">輸入另一台裝置的同步碼</label>
            <input id="yaoSyncCode" class="yao-sync-input" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX">
            <button class="yao-sync-secondary" type="button" data-connect>連接既有資料</button>
            <p class="yao-sync-note">連接後，這台的資料會以雲端資料為準。</p>
        </div>`;

    modal.querySelector(".yao-sync-close").onclick = closeModal;
    modal.querySelector("[data-create]").onclick = async event => {
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = "正在建立…";
        try {
            await createSpace();
        } catch (error) {
            alert(`建立同步失敗：${error.message}`);
            event.currentTarget.disabled = false;
            event.currentTarget.textContent = "在這台建立同步碼";
        }
    };
    modal.querySelector("[data-connect]").onclick = async event => {
        const input = modal.querySelector("#yaoSyncCode");
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = "正在連接…";
        try {
            await connectSpace(input.value);
        } catch (error) {
            alert(`無法連接：${error.message}`);
            event.currentTarget.disabled = false;
            event.currentTarget.textContent = "連接既有資料";
        }
    };
}

function openSettings() {
    closeModal();
    modal = document.createElement("div");
    modal.className = "yao-sync-modal";
    document.body.appendChild(modal);
    showMainScreen();
}

function mount() {
    const style = document.createElement("style");
    style.textContent = `
        .yao-sync-launcher{position:fixed;right:18px;bottom:18px;z-index:900;border:0;border-radius:999px;background:#111827;color:#fff;padding:11px 15px;box-shadow:0 8px 24px rgba(17,24,39,.24);font:inherit;font-size:13px}.yao-sync-launcher[data-state="ready"]{background:#155e75}.yao-sync-modal{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:18px;background:rgba(17,24,39,.56)}.yao-sync-card{position:relative;width:min(420px,100%);padding:28px;border-radius:22px;background:#fff;color:#111827;box-shadow:0 24px 80px rgba(0,0,0,.28);text-align:center}.yao-sync-card h2{margin:8px 0 10px;font-size:21px}.yao-sync-card p{margin:0 0 20px;color:#6b7280;line-height:1.65;font-size:14px}.yao-sync-icon{font-size:31px}.yao-sync-close{position:absolute;right:13px;top:13px;border:0;border-radius:9px;background:#f3f4f6;font-size:23px;line-height:1;width:34px;height:34px}.yao-sync-primary,.yao-sync-secondary{width:100%;border:0;border-radius:11px;padding:12px 14px;font:inherit;font-weight:700}.yao-sync-primary{background:#111827;color:#fff}.yao-sync-secondary{background:#e5e7eb;color:#111827;margin-top:9px}.yao-sync-text{border:0;background:none;color:#6b7280;margin-top:15px;font:inherit;font-size:13px}.yao-sync-divider{margin:18px 0;color:#9ca3af;font-size:13px}.yao-sync-label{display:block;text-align:left;margin-bottom:7px;color:#4b5563;font-size:13px;font-weight:700}.yao-sync-input{width:100%;border:1px solid #d1d5db;border-radius:11px;padding:12px;font:inherit;letter-spacing:.04em}.yao-sync-code{display:block;margin:16px 0;border-radius:12px;padding:14px 10px;background:#f3f4f6;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;letter-spacing:.08em;font-size:17px}.yao-sync-note{margin:13px 0 0!important;font-size:12px!important;color:#9ca3af!important}.yao-sync-card code{font-size:.9em}@media(max-width:620px){.yao-sync-launcher{right:12px;bottom:12px}.yao-sync-card{padding:25px 20px}}
    `;
    document.head.appendChild(style);

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "yao-sync-launcher";
    launcher.textContent = "☁️ 同步";
    launcher.onclick = openSettings;
    document.body.appendChild(launcher);
    statusEl = launcher;
    setStatus(connection ? "連線中…" : "尚未啟用同步", connection ? "working" : "idle");
    restoreConnection();
}

window.YaoCloudSync = { openSettings, schedulePush };

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
    mount();
}

