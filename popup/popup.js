/**
 * Anki Card Creator — Popup Script
 * ポップアップUIのロジックを管理する（AI解説モード対応）
 */

// --- State ---
let currentDeck = '';
let currentModel = '';
let frontImageData = null;
let backImageData = null;
let backTextData = null;
let aiModeEnabled = false;
let collapsedDecks = {};  // { deckFullName: true/false }

// --- DOM Elements ---
const deckTree = document.getElementById('deck-tree');
const modelSelect = document.getElementById('model-select');
const btnQuestion = document.getElementById('btn-question');
const btnAnswer = document.getElementById('btn-answer');
const btnSave = document.getElementById('btn-save');
const previewFront = document.getElementById('preview-front');
const previewBack = document.getElementById('preview-back');
const statusIndicator = document.getElementById('status-indicator');
const statusMessage = document.getElementById('status-message');
const btnClearFront = document.getElementById('btn-clear-front');
const btnClearBack = document.getElementById('btn-clear-back');

// AI Settings
const aiModeToggle = document.getElementById('ai-mode-toggle');
const aiSettings = document.getElementById('ai-settings');
const apiProvider = document.getElementById('api-provider');
const llmModelInput = document.getElementById('llm-model');
const apiKeyInput = document.getElementById('api-key');
const btnSaveApi = document.getElementById('btn-save-api');
const apiStatus = document.getElementById('api-status');
const customInstruction = document.getElementById('custom-instruction');

// --- デフォルトモデル名 ---
const DEFAULT_MODELS = {
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini'
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', init);

async function init() {
    showStatus('AnkiConnectに接続中...', 'info');

    // 1. AnkiConnect接続
    try {
        const [deckResponse, modelResponse] = await Promise.all([
            chrome.runtime.sendMessage({ action: 'getDeckNames' }),
            chrome.runtime.sendMessage({ action: 'getModelNames' })
        ]);

        if (deckResponse.success && modelResponse.success) {
            statusIndicator.className = 'status-dot connected';
            statusIndicator.title = 'AnkiConnect接続済み';
            populateDeckTree(deckResponse.data);
            populateModelSelect(modelResponse.data);
            enableButtons();
            showStatus('接続完了！', 'success');
        } else {
            throw new Error(deckResponse.error || modelResponse.error || '接続失敗');
        }
    } catch (error) {
        statusIndicator.className = 'status-dot disconnected';
        showStatus('AnkiConnectに接続できません。Ankiを起動してください。', 'error');
    }

    // 2. 保存済み設定を復元
    chrome.storage.local.get(
        ['apiProvider', 'apiKey', 'llmModel', 'aiMode', 'customInstruction'],
        (result) => {
            if (result.apiProvider) apiProvider.value = result.apiProvider;

            // モデル名: 保存済みがあればそれ、なければデフォルト
            const provider = result.apiProvider || 'gemini';
            llmModelInput.value = result.llmModel || DEFAULT_MODELS[provider] || '';

            if (result.apiKey) {
                apiKeyInput.value = result.apiKey;
                apiStatus.textContent = '✓ APIキー保存済み';
                apiStatus.className = 'api-status saved';
            } else {
                apiStatus.textContent = 'APIキー未設定';
                apiStatus.className = 'api-status missing';
            }

            if (result.aiMode) {
                aiModeEnabled = true;
                aiModeToggle.checked = true;
                aiSettings.classList.remove('hidden');
                updateAnswerButton();
            }

            if (result.customInstruction) {
                customInstruction.value = result.customInstruction;
            }
        }
    );

    // 3. カード状態を復元
    try {
        const stateResponse = await chrome.runtime.sendMessage({ action: 'getState' });
        if (stateResponse.success && stateResponse.cardState) {
            const { frontImage, backImage, backText } = stateResponse.cardState;
            if (frontImage) {
                frontImageData = frontImage;
                updatePreviewImage(previewFront, frontImage);
                btnQuestion.classList.add('captured');
            }
            if (backImage) {
                backImageData = backImage;
                updatePreviewImage(previewBack, backImage);
                btnAnswer.classList.add('captured');
            }
            if (backText) {
                backTextData = backText;
                updatePreviewText(previewBack, backText);
                btnAnswer.classList.add('captured');
            }
            if (frontImage || backImage || backText) {
                showStatus('前回のキャプチャを復元しました', 'success');
            }
        }
    } catch (e) { /* ignore */ }

    // 4. Event listeners
    modelSelect.addEventListener('change', onModelChange);
    btnQuestion.addEventListener('click', () => startCapture('front'));
    btnAnswer.addEventListener('click', () => startCapture('back'));
    btnSave.addEventListener('click', saveCard);

    aiModeToggle.addEventListener('change', onAiModeChange);
    apiProvider.addEventListener('change', onProviderChange);
    btnSaveApi.addEventListener('click', saveApiSettings);
    llmModelInput.addEventListener('change', saveLlmModel);
    customInstruction.addEventListener('input', debounce(saveCustomInstruction, 500));
    btnClearFront.addEventListener('click', clearFront);
    btnClearBack.addEventListener('click', clearBack);

    updateSaveButton();
}

// --- AI Mode ---
function onAiModeChange() {
    aiModeEnabled = aiModeToggle.checked;
    chrome.storage.local.set({ aiMode: aiModeEnabled });

    if (aiModeEnabled) {
        aiSettings.classList.remove('hidden');
    } else {
        aiSettings.classList.add('hidden');
    }
    updateAnswerButton();
}

function onProviderChange() {
    const provider = apiProvider.value;
    chrome.storage.local.set({ apiProvider: provider });

    // モデル名のプレースホルダーを更新
    llmModelInput.placeholder = DEFAULT_MODELS[provider] || '';

    // モデル名がデフォルトのままだったら新プロバイダーのデフォルトに切替
    const currentVal = llmModelInput.value;
    const isDefault = !currentVal || Object.values(DEFAULT_MODELS).includes(currentVal);
    if (isDefault) {
        llmModelInput.value = DEFAULT_MODELS[provider] || '';
        chrome.storage.local.set({ llmModel: llmModelInput.value });
    }
}

function updateAnswerButton() {
    if (aiModeEnabled) {
        btnAnswer.innerHTML = '<span class="btn-icon">🤖</span>AI解説を生成';
    } else {
        btnAnswer.innerHTML = '<span class="btn-icon">📝</span>解説を追加';
    }
}

function saveApiSettings() {
    const key = apiKeyInput.value.trim();
    if (!key) {
        apiStatus.textContent = '⚠ APIキーを入力してください';
        apiStatus.className = 'api-status missing';
        return;
    }
    chrome.storage.local.set({
        apiProvider: apiProvider.value,
        apiKey: key
    }, () => {
        apiStatus.textContent = '✓ 保存しました';
        apiStatus.className = 'api-status saved';
    });
}

function saveLlmModel() {
    chrome.storage.local.set({ llmModel: llmModelInput.value });
}

function saveCustomInstruction() {
    chrome.storage.local.set({ customInstruction: customInstruction.value });
}

// --- Deck Tree ---

/**
 * フラットなデッキ名リスト ("A::B::C") をツリー構造に変換
 */
function buildDeckTree(deckNames) {
    const root = { children: {} };
    deckNames.sort().forEach(fullName => {
        const parts = fullName.split('::');
        let node = root;
        parts.forEach((part, i) => {
            if (!node.children[part]) {
                node.children[part] = {
                    name: part,
                    fullName: parts.slice(0, i + 1).join('::'),
                    children: {}
                };
            }
            node = node.children[part];
        });
    });
    return root;
}

/**
 * ツリー構造をDOMに描画
 */
function populateDeckTree(deckNames) {
    deckTree.innerHTML = '';

    if (!deckNames || deckNames.length === 0) {
        deckTree.innerHTML = '<div class="deck-tree-loading">デッキがありません</div>';
        return;
    }

    // 保存済みの開閉状態を復元してから描画
    chrome.storage.local.get(['lastDeck', 'collapsedDecks'], (result) => {
        if (result.collapsedDecks) {
            collapsedDecks = result.collapsedDecks;
        }

        const tree = buildDeckTree(deckNames);
        const fragment = document.createDocumentFragment();

        Object.values(tree.children).forEach(child => {
            renderDeckNode(child, fragment, 0);
        });

        deckTree.innerHTML = '';
        deckTree.appendChild(fragment);

        // 最後に選択したデッキを復元
        if (result.lastDeck && deckNames.includes(result.lastDeck)) {
            selectDeck(result.lastDeck, false);
            // 親デッキを自動展開
            expandParents(result.lastDeck);
        }
    });
}

/**
 * 選択中デッキの親を自動展開
 */
function expandParents(fullName) {
    const parts = fullName.split('::');
    for (let i = 1; i < parts.length; i++) {
        const parentName = parts.slice(0, i).join('::');
        const childContainer = deckTree.querySelector(`[data-deck-children="${CSS.escape(parentName)}"]`);
        if (childContainer && childContainer.classList.contains('collapsed')) {
            childContainer.classList.remove('collapsed');
            // トグルアイコンも更新
            const toggle = deckTree.querySelector(`[data-deck-toggle="${CSS.escape(parentName)}"]`);
            if (toggle) toggle.textContent = '−';
            collapsedDecks[parentName] = false;
        }
    }
    chrome.storage.local.set({ collapsedDecks });
}

/**
 * 再帰的にデッキノードをDOMに描画
 */
function renderDeckNode(node, container, depth) {
    const hasChildren = Object.keys(node.children).length > 0;
    // デフォルトは折りたたみ。明示的に false の場合のみ展開
    const isCollapsed = collapsedDecks[node.fullName] !== false;

    // 行
    const row = document.createElement('div');
    row.className = 'deck-row';
    row.dataset.deck = node.fullName;
    row.style.paddingLeft = (8 + depth * 16) + 'px';

    // トグルボタン
    const toggle = document.createElement('span');
    toggle.className = 'deck-toggle ' + (hasChildren ? 'has-children' : 'no-children');
    if (hasChildren) {
        toggle.textContent = isCollapsed ? '+' : '−';
        toggle.dataset.deckToggle = node.fullName;
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDeck(node.fullName);
        });
    }
    row.appendChild(toggle);

    // デッキ名
    const nameEl = document.createElement('span');
    nameEl.className = 'deck-name';
    nameEl.textContent = node.name;
    row.appendChild(nameEl);

    // 行クリックでデッキ選択
    row.addEventListener('click', () => {
        selectDeck(node.fullName, true);
    });

    container.appendChild(row);

    // 子デッキコンテナ
    if (hasChildren) {
        const childContainer = document.createElement('div');
        childContainer.className = 'deck-children' + (isCollapsed ? ' collapsed' : '');
        childContainer.dataset.deckChildren = node.fullName;

        Object.values(node.children).forEach(child => {
            renderDeckNode(child, childContainer, depth + 1);
        });

        container.appendChild(childContainer);
    }
}

/**
 * デッキの開閉を切り替え
 */
function toggleDeck(fullName) {
    const childContainer = deckTree.querySelector(`[data-deck-children="${CSS.escape(fullName)}"]`);
    const toggle = deckTree.querySelector(`[data-deck-toggle="${CSS.escape(fullName)}"]`);
    if (!childContainer) return;

    const isCollapsed = childContainer.classList.contains('collapsed');

    if (isCollapsed) {
        // 展開
        childContainer.classList.remove('collapsed');
        if (toggle) toggle.textContent = '−';
        collapsedDecks[fullName] = false;
    } else {
        // 折りたたみ
        childContainer.classList.add('collapsed');
        if (toggle) toggle.textContent = '+';
        collapsedDecks[fullName] = true;
    }

    chrome.storage.local.set({ collapsedDecks });
}

/**
 * デッキを選択
 */
function selectDeck(fullName, save) {
    // 前の選択を解除
    const prev = deckTree.querySelector('.deck-row.selected');
    if (prev) prev.classList.remove('selected');

    // 新しい選択をハイライト
    const row = deckTree.querySelector(`[data-deck="${CSS.escape(fullName)}"]`);
    if (row) row.classList.add('selected');

    currentDeck = fullName;
    if (save) chrome.storage.local.set({ lastDeck: currentDeck });
    updateSaveButton();
}

// --- Model Selection ---
function populateModelSelect(models) {
    modelSelect.innerHTML = '<option value="">ノートタイプを選択...</option>';
    models.sort().forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
    });
    chrome.storage.local.get('lastModel', (result) => {
        if (result.lastModel && models.includes(result.lastModel)) {
            modelSelect.value = result.lastModel;
            currentModel = result.lastModel;
        }
        updateSaveButton();
    });
}

function onModelChange() {
    currentModel = modelSelect.value;
    if (currentModel) chrome.storage.local.set({ lastModel: currentModel });
    updateSaveButton();
}

// --- Capture ---
async function startCapture(side) {
    if (!currentDeck) { showStatus('先にデッキを選択してください', 'error'); return; }
    if (!currentModel) { showStatus('先にノートタイプを選択してください', 'error'); return; }

    // AIモードで「解説」ボタンを押した場合
    if (side === 'back' && aiModeEnabled) {
        await generateAiExplanation();
        return;
    }

    showStatus(`${side === 'front' ? '問題' : '解説'}の範囲を選択してください...`, 'info');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showStatus('アクティブなタブがありません', 'error'); return; }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/content.js']
        });
    } catch (e) { /* already injected */ }

    chrome.tabs.sendMessage(tab.id, { action: 'startSelection', side: side });
}

// --- AI Explanation ---
async function generateAiExplanation() {
    if (!frontImageData) {
        showStatus('先に問題をキャプチャしてください', 'error');
        return;
    }

    const settings = await chrome.storage.local.get(['apiProvider', 'apiKey', 'llmModel']);
    if (!settings.apiKey) {
        showStatus('⚙️ APIキーを設定してください', 'error');
        return;
    }

    showStatus('🤖 AI解説を生成中...', 'info');
    btnAnswer.disabled = true;

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'generateExplanation',
            imageData: frontImageData,
            provider: settings.apiProvider || 'gemini',
            apiKey: settings.apiKey,
            llmModel: settings.llmModel || DEFAULT_MODELS[settings.apiProvider || 'gemini'],
            customInstruction: customInstruction.value || ''
        });

        if (response.success) {
            backTextData = response.text;
            backImageData = null;
            updatePreviewText(previewBack, response.text);
            btnAnswer.classList.add('captured');

            await chrome.runtime.sendMessage({
                action: 'storeImage',
                side: 'backText',
                imageData: response.text
            });

            showStatus('✨ AI解説を生成しました！', 'success');
        } else {
            throw new Error(response.error);
        }
    } catch (error) {
        showStatus(`AI エラー: ${error.message}`, 'error');
    }

    btnAnswer.disabled = false;
    updateSaveButton();
}

// --- Preview ---
function updatePreviewImage(previewEl, imageData) {
    previewEl.innerHTML = '';
    previewEl.classList.remove('has-text');
    const img = document.createElement('img');
    img.src = imageData;
    img.alt = 'キャプチャ画像';
    previewEl.appendChild(img);
    previewEl.classList.add('has-image');
    // クリアボタンを表示
    if (previewEl.id === 'preview-front') btnClearFront.classList.remove('hidden');
    if (previewEl.id === 'preview-back') btnClearBack.classList.remove('hidden');
}

function updatePreviewText(previewEl, text) {
    previewEl.innerHTML = '';
    previewEl.classList.remove('has-image');
    const p = document.createElement('div');
    p.className = 'preview-text';
    p.textContent = text;
    previewEl.appendChild(p);
    previewEl.classList.add('has-text');
    if (previewEl.id === 'preview-back') btnClearBack.classList.remove('hidden');
}

// --- Save Card ---
async function saveCard() {
    if (!currentDeck || !currentModel || !frontImageData) {
        showStatus('デッキ、ノートタイプ、問題の画像が必要です', 'error');
        return;
    }

    showStatus('カードを保存中...', 'info');
    btnSave.disabled = true;

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'addCard',
            deckName: currentDeck,
            modelName: currentModel,
            frontImage: frontImageData,
            backImage: backImageData,
            backText: backTextData
        });

        if (response.success) {
            showStatus('カードを保存しました！ 🎉', 'success');
            resetCard();
        } else {
            throw new Error(response.error);
        }
    } catch (error) {
        showStatus(`保存エラー: ${error.message}`, 'error');
        btnSave.disabled = false;
    }
}

// --- Clear ---
function clearFront() {
    frontImageData = null;
    previewFront.innerHTML = '<span class="preview-placeholder">未選択</span>';
    previewFront.classList.remove('has-image');
    btnQuestion.classList.remove('captured');
    btnClearFront.classList.add('hidden');
    chrome.runtime.sendMessage({ action: 'storeImage', side: 'front', imageData: null });
    updateSaveButton();
    showStatus('問題をクリアしました', 'info');
}

function clearBack() {
    backImageData = null;
    backTextData = null;
    previewBack.innerHTML = '<span class="preview-placeholder">未選択</span>';
    previewBack.classList.remove('has-image');
    previewBack.classList.remove('has-text');
    btnAnswer.classList.remove('captured');
    btnClearBack.classList.add('hidden');
    chrome.runtime.sendMessage({ action: 'storeImage', side: 'back', imageData: null });
    chrome.runtime.sendMessage({ action: 'storeImage', side: 'backText', imageData: null });
    updateSaveButton();
    showStatus('解説をクリアしました', 'info');
}

// --- Reset ---
function resetCard() {
    frontImageData = null;
    backImageData = null;
    backTextData = null;

    previewFront.innerHTML = '<span class="preview-placeholder">未選択</span>';
    previewFront.classList.remove('has-image');
    previewBack.innerHTML = '<span class="preview-placeholder">未選択</span>';
    previewBack.classList.remove('has-image');
    previewBack.classList.remove('has-text');

    btnQuestion.classList.remove('captured');
    btnAnswer.classList.remove('captured');
    btnClearFront.classList.add('hidden');
    btnClearBack.classList.add('hidden');
    updateSaveButton();

    setTimeout(() => showStatus('次のカードを追加できます', 'success'), 2000);
}

// --- UI Helpers ---
function enableButtons() {
    btnQuestion.disabled = false;
    btnAnswer.disabled = false;
}

function updateSaveButton() {
    btnSave.disabled = !(currentDeck && currentModel && frontImageData);
}

function showStatus(text, type) {
    statusMessage.textContent = text;
    statusMessage.className = `status-message ${type}`;
}

function debounce(fn, ms) {
    let id;
    return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}
