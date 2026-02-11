/**
 * Anki Card Creator — Popup Script
 * ポップアップUIのロジックを管理する
 */

// --- State ---
let currentDeck = '';
let frontImageData = null;  // Base64 画像データ
let backImageData = null;

// --- DOM Elements ---
const deckSelect = document.getElementById('deck-select');
const btnQuestion = document.getElementById('btn-question');
const btnAnswer = document.getElementById('btn-answer');
const btnSave = document.getElementById('btn-save');
const previewFront = document.getElementById('preview-front');
const previewBack = document.getElementById('preview-back');
const statusIndicator = document.getElementById('status-indicator');
const statusMessage = document.getElementById('status-message');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', init);

async function init() {
    showStatus('AnkiConnectに接続中...', 'info');

    // 1. AnkiConnectからデッキ一覧を取得
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getDeckNames' });

        if (response.success) {
            statusIndicator.className = 'status-dot connected';
            statusIndicator.title = 'AnkiConnect接続済み';
            populateDeckSelect(response.data);
            enableButtons();
            showStatus('接続完了！デッキを選択してください', 'success');
        } else {
            throw new Error(response.error || 'デッキの取得に失敗しました');
        }
    } catch (error) {
        statusIndicator.className = 'status-dot disconnected';
        statusIndicator.title = 'AnkiConnect未接続';
        showStatus('AnkiConnectに接続できません。Ankiが起動しているか確認してください。', 'error');
        console.error('AnkiConnect error:', error);
    }

    // 2. Background workerからカード状態を復元
    try {
        const stateResponse = await chrome.runtime.sendMessage({ action: 'getState' });
        if (stateResponse.success && stateResponse.cardState) {
            const { frontImage, backImage } = stateResponse.cardState;
            if (frontImage) {
                frontImageData = frontImage;
                updatePreview(previewFront, frontImage);
                btnQuestion.classList.add('captured');
            }
            if (backImage) {
                backImageData = backImage;
                updatePreview(previewBack, backImage);
                btnAnswer.classList.add('captured');
            }
            if (frontImage || backImage) {
                showStatus('前回のキャプチャを復元しました', 'success');
            }
        }
    } catch (e) {
        // 状態がない場合は無視
    }

    // 3. Event listeners
    deckSelect.addEventListener('change', onDeckChange);
    btnQuestion.addEventListener('click', () => startCapture('front'));
    btnAnswer.addEventListener('click', () => startCapture('back'));
    btnSave.addEventListener('click', saveCard);

    updateSaveButton();
}

// --- Deck Selection ---
function populateDeckSelect(decks) {
    deckSelect.innerHTML = '<option value="">デッキを選択...</option>';
    decks.sort().forEach(deck => {
        const option = document.createElement('option');
        option.value = deck;
        option.textContent = deck;
        deckSelect.appendChild(option);
    });

    // 前回選択したデッキを復元
    chrome.storage.local.get('lastDeck', (result) => {
        if (result.lastDeck && decks.includes(result.lastDeck)) {
            deckSelect.value = result.lastDeck;
            currentDeck = result.lastDeck;
            updateSaveButton();
        }
    });
}

function onDeckChange() {
    currentDeck = deckSelect.value;
    if (currentDeck) {
        chrome.storage.local.set({ lastDeck: currentDeck });
        showStatus(`デッキ: ${currentDeck}`, 'success');
    }
    updateSaveButton();
}

// --- Capture ---
async function startCapture(side) {
    if (!currentDeck) {
        showStatus('先にデッキを選択してください', 'error');
        return;
    }

    showStatus(`${side === 'front' ? '問題' : '解説'}の範囲を選択してください...`, 'info');

    // 現在のアクティブタブを取得
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
        showStatus('アクティブなタブがありません', 'error');
        return;
    }

    // Content Scriptを注入して範囲選択を開始
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/content.js']
        });
    } catch (e) {
        // 既に注入済みの場合
        console.log('Content script injection:', e.message);
    }

    // Content Scriptに範囲選択開始を通知
    chrome.tabs.sendMessage(tab.id, {
        action: 'startSelection',
        side: side
    });

    // ポップアップは自動で閉じる（ユーザーがページをクリックするため）
    // 次回ポップアップを開いたときにgetStateで状態を復元する
}

// --- Preview ---
function updatePreview(previewEl, imageData) {
    previewEl.innerHTML = '';
    const img = document.createElement('img');
    img.src = imageData;
    img.alt = 'キャプチャ画像';
    previewEl.appendChild(img);
    previewEl.classList.add('has-image');
}

// --- Save Card ---
async function saveCard() {
    if (!currentDeck || !frontImageData) {
        showStatus('問題の画像が必要です', 'error');
        return;
    }

    showStatus('カードを保存中...', 'info');
    btnSave.disabled = true;

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'addCard',
            deckName: currentDeck,
            frontImage: frontImageData,
            backImage: backImageData
        });

        if (response.success) {
            showStatus('カードを保存しました！ 🎉', 'success');
            resetCard();
        } else {
            throw new Error(response.error || 'カードの追加に失敗しました');
        }
    } catch (error) {
        showStatus(`保存エラー: ${error.message}`, 'error');
        btnSave.disabled = false;
    }
}

// --- Reset ---
function resetCard() {
    frontImageData = null;
    backImageData = null;

    previewFront.innerHTML = '<span class="preview-placeholder">未選択</span>';
    previewFront.classList.remove('has-image');
    previewBack.innerHTML = '<span class="preview-placeholder">未選択</span>';
    previewBack.classList.remove('has-image');

    btnQuestion.classList.remove('captured');
    btnAnswer.classList.remove('captured');

    updateSaveButton();

    // 2秒後にステータスをリセット
    setTimeout(() => {
        showStatus('次のカードを追加できます', 'success');
    }, 2000);
}

// --- UI Helpers ---
function enableButtons() {
    btnQuestion.disabled = false;
    btnAnswer.disabled = false;
}

function updateSaveButton() {
    // 問題（表面）があれば保存可能（解説はオプション）
    btnSave.disabled = !(currentDeck && frontImageData);
}

function showStatus(text, type) {
    statusMessage.textContent = text;
    statusMessage.className = `status-message ${type}`;
}
