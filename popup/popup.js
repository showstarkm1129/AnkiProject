/**
 * Anki Card Creator — Popup Script
 * ポップアップUIのロジックを管理する（AI解説モード対応）
 */

// --- State ---
let currentDeck = '';
let currentModel = '';
let frontImages = [];
let backImages = [];
let backTextData = null;
let aiModeEnabled = false;
let collapsedDecks = {};  // { deckFullName: true/false }

// --- DOM Elements ---
const deckSelectDisplay = document.getElementById('deck-select-display');
const deckTreeContainer = document.getElementById('deck-tree-container');
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

const frontTextInput = document.getElementById('front-text-input');
const backTextInput = document.getElementById('back-text-input');

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
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-20241022',
    openrouter: 'deepseek/deepseek-chat'
};

// --- Initialization ---
const urlParams = new URLSearchParams(window.location.search);
const paramTabId = urlParams.get('tabId');
let targetTabId = paramTabId ? parseInt(paramTabId) : null;

document.addEventListener('DOMContentLoaded', init);

// ウィンドウがフォーカスされた時にカード状態を再読み込み
window.addEventListener('focus', loadCardState);

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

    // 2. 保存済み設定を復元 & マイグレーション
    chrome.storage.local.get(null, (result) => {
        const provider = result.apiProvider || 'gemini';
        apiProvider.value = provider;

        // モデル名: プロバイダーごとの保存値があればそれ、なければデフォルト
        // 旧形式 (llmModel) が残っていて、かつプロバイダー別のがない場合は移行
        let currentModel = result[`llmModel_${provider}`];
        if (!currentModel && result.llmModel) {
            // 簡易移行: 現在のプロバイダーに割り当てる
            currentModel = result.llmModel;
            const migrationData = {};
            migrationData[`llmModel_${provider}`] = currentModel;
            chrome.storage.local.set(migrationData);
            chrome.storage.local.remove('llmModel');
        }
        llmModelInput.value = currentModel || DEFAULT_MODELS[provider] || '';

        // APIキーの取得とマイグレーション
        let currentKey = result[`apiKey_${provider}`];
        if (!currentKey && result.apiKey) {
            currentKey = result.apiKey;
            const migrationData = {};
            migrationData[`apiKey_${provider}`] = currentKey;
            chrome.storage.local.set(migrationData);
            chrome.storage.local.remove('apiKey');
        }
        showApiKeyStatus(currentKey);

        if (result.aiMode) {
            aiModeEnabled = true;
            aiModeToggle.checked = true;
            aiSettings.classList.remove('hidden');
            updateAnswerButton();
        }

        if (result.customInstruction) {
            customInstruction.value = result.customInstruction;
        }
    });

    // 3. カード状態を復元
    await loadCardState();

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

    frontTextInput.addEventListener('input', debounce(() => {
        chrome.runtime.sendMessage({ action: 'storeText', side: 'front', text: frontTextInput.value });
        updateSaveButton();
    }, 300));
    backTextInput.addEventListener('input', debounce(() => {
        chrome.runtime.sendMessage({ action: 'storeText', side: 'back', text: backTextInput.value });
        updateSaveButton();
    }, 300));

    // APIキー表示切替
    const btnToggleKey = document.getElementById('btn-toggle-key');
    if (btnToggleKey) {
        btnToggleKey.addEventListener('click', () => {
            const type = apiKeyInput.type === 'password' ? 'text' : 'password';
            apiKeyInput.type = type;
            btnToggleKey.textContent = type === 'password' ? '👁️' : '🔒';
        });
    }

    // Deck Dropdown Toggle
    if (deckSelectDisplay) {
        deckSelectDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            deckTreeContainer.classList.toggle('hidden');
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (deckSelectDisplay && deckTreeContainer &&
            !deckSelectDisplay.contains(e.target) &&
            !deckTreeContainer.contains(e.target)) {
            deckTreeContainer.classList.add('hidden');
        }
    });

    updateSaveButton();
}

// --- Load Card State ---
async function loadCardState() {
    try {
        const stateResponse = await chrome.runtime.sendMessage({ action: 'getState' });
        if (stateResponse.success && stateResponse.cardState) {
            const { frontImages: fi, backImages: bi, backText, frontText, userBackText } = stateResponse.cardState;

            // 前面画像を復元
            if (fi && fi.length > 0) {
                frontImages = [...fi];
                renderThumbnails(previewFront, frontImages, 'front');
                btnQuestion.classList.add('captured');
            } else {
                frontImages = [];
                previewFront.innerHTML = '<span class="preview-placeholder">未選択</span>';
                previewFront.classList.add('empty');
                btnQuestion.classList.remove('captured');
            }

            // 前面テキストを復元
            if (frontText) {
                frontTextInput.value = frontText;
            } else {
                frontTextInput.value = '';
            }

            // 背面画像・テキストを復元
            if (bi && bi.length > 0) {
                backImages = [...bi];
            } else {
                backImages = [];
            }
            if (backText) {
                backTextData = backText;
            } else {
                backTextData = null;
            }

            renderBackPreview();
            if ((bi && bi.length > 0) || backText) {
                btnAnswer.classList.add('captured');
            } else {
                btnAnswer.classList.remove('captured');
            }

            // 裏面テキスト入力を復元
            if (userBackText) {
                backTextInput.value = userBackText;
            } else {
                backTextInput.value = '';
            }

            if ((fi && fi.length > 0) || (bi && bi.length > 0) || backText || frontText || userBackText) {
                showStatus('前回の内容を復元しました', 'success');
            }

            updateSaveButton();
        }
    } catch (e) {
        console.error('Failed to load card state:', e);
    }
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

    // APIキー表示切替
    const keyName = `apiKey_${provider}`;
    chrome.storage.local.get([keyName], (result) => {
        const key = result[keyName];
        showApiKeyStatus(key);
    });

    // モデル名のプレースホルダーを更新
    llmModelInput.placeholder = DEFAULT_MODELS[provider] || '';

    // モデル名読み込み
    const modelKeyName = `llmModel_${provider}`;
    chrome.storage.local.get([modelKeyName], (result) => {
        const savedModel = result[modelKeyName];
        // 保存値があればそれ、なければデフォルト
        llmModelInput.value = savedModel || DEFAULT_MODELS[provider] || '';
        if (!savedModel) {
            // デフォルト値を保存しておく
            saveLlmModel();
        }
    });
}

function showApiKeyStatus(key) {
    if (key) {
        apiKeyInput.value = key;
        apiStatus.textContent = '✓ APIキー保存済み';
        apiStatus.className = 'api-status saved';
    } else {
        apiKeyInput.value = '';
        apiStatus.textContent = 'APIキー未設定';
        apiStatus.className = 'api-status missing';
    }
}

function updateAnswerButton() {
    if (aiModeEnabled) {
        btnAnswer.innerHTML = '<span class="btn-icon">🤖</span>AI解説を生成';
    } else {
        btnAnswer.innerHTML = '<span class="btn-icon">📝</span>画像をキャプチャ';
    }
}

function saveApiSettings() {
    const provider = apiProvider.value;
    const key = apiKeyInput.value.trim();
    if (!key) {
        apiStatus.textContent = '⚠ APIキーを入力してください';
        apiStatus.className = 'api-status missing';
        return;
    }

    const saveData = {};
    saveData[`apiKey_${provider}`] = key;
    saveData['apiProvider'] = provider;

    chrome.storage.local.set(saveData, () => {
        apiStatus.textContent = '✓ 保存しました';
        apiStatus.className = 'api-status saved';
    });
}

function saveLlmModel() {
    const provider = apiProvider.value;
    const saveData = {};
    saveData[`llmModel_${provider}`] = llmModelInput.value;
    chrome.storage.local.set(saveData);
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

    // update display text (dropdown style)
    if (deckSelectDisplay) {
        deckSelectDisplay.textContent = fullName;
        deckSelectDisplay.classList.add('selected'); // style hint
        // close dropdown
        deckTreeContainer.classList.add('hidden');
    }

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

    let tabId = targetTabId;
    if (!tabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) tabId = tab.id;
    }

    if (!tabId) { showStatus('アクティブなタブがありません', 'error'); return; }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content/content.js']
        });
    } catch (e) { /* already injected */ }

    chrome.tabs.sendMessage(tabId, { action: 'startSelection', side: side });
}



// --- AI Explanation ---
async function generateAiExplanation() {
    if (frontImages.length === 0 && !frontTextInput.value.trim()) {
        showStatus('先に問題を入力またはキャプチャしてください', 'error');
        return;
    }
    if (!frontImages[0]) {
        showStatus('AI解説には問題の画像が必要です', 'error');
        return;
    }


    const tempSettings = await chrome.storage.local.get(['apiProvider', 'llmModel']);
    const provider = tempSettings.apiProvider || 'gemini';
    const keyName = `apiKey_${provider}`;

    const settings = await chrome.storage.local.get([keyName]);
    const apiKey = settings[keyName];

    if (!apiKey) {
        showStatus('APIキーを設定してください', 'error');
        return;
    }

    showStatus('AI解説を生成中...', 'info');
    btnAnswer.disabled = true;

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'generateExplanation',
            imageData: frontImages[0],
            provider: provider,
            apiKey: apiKey,
            llmModel: tempSettings.llmModel || DEFAULT_MODELS[provider],
            customInstruction: customInstruction.value || ''
        });

        if (response.success) {
            backTextData = response.text;
            renderBackPreview();
            btnAnswer.classList.add('captured');

            await chrome.runtime.sendMessage({
                action: 'storeImage',
                side: 'backText',
                imageData: response.text
            });

            showStatus('AI解説を生成しました', 'success');
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
function renderThumbnails(previewEl, images, side) {
    previewEl.innerHTML = '';
    previewEl.classList.remove('has-text', 'has-image');

    if (images.length === 0) {
        previewEl.innerHTML = '<span class="preview-placeholder">未選択</span>';
        previewEl.classList.add('empty');
        if (side === 'front') {
            btnClearFront.classList.add('hidden');
            document.getElementById('front-count').classList.add('hidden');
        }
        if (side === 'back') {
            btnClearBack.classList.add('hidden');
            document.getElementById('back-count').classList.add('hidden');
        }
        return;
    }
    previewEl.classList.add('has-image');
    previewEl.classList.remove('empty');

    images.forEach((imgData, index) => {
        const item = document.createElement('div');
        item.className = 'thumbnail-item';

        const img = document.createElement('img');
        img.src = imgData;
        img.alt = `キャプチャ ${index + 1}`;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'thumbnail-remove';
        removeBtn.textContent = '✕';
        removeBtn.title = '削除';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeImageAt(side, index);
        });

        item.appendChild(img);
        item.appendChild(removeBtn);
        previewEl.appendChild(item);
    });

    if (side === 'front') {
        btnClearFront.classList.remove('hidden');
        const countEl = document.getElementById('front-count');
        countEl.textContent = `(${images.length})`;
        countEl.classList.remove('hidden');
    }
    if (side === 'back') {
        btnClearBack.classList.remove('hidden');
        const countEl = document.getElementById('back-count');
        countEl.textContent = `(${images.length})`;
        countEl.classList.remove('hidden');
    }
}

function renderBackPreview() {
    previewBack.innerHTML = '';
    previewBack.classList.remove('has-image', 'has-text', 'empty');

    if (!backTextData && backImages.length === 0) {
        previewBack.innerHTML = '<span class="preview-placeholder">未選択</span>';
        previewBack.classList.add('empty');
        btnClearBack.classList.add('hidden');
        document.getElementById('back-count').classList.add('hidden');
        return;
    }

    // テキスト表示
    if (backTextData) {
        const textDiv = document.createElement('div');
        textDiv.className = 'preview-text';
        textDiv.textContent = backTextData;
        previewBack.appendChild(textDiv);
        previewBack.classList.add('has-text');
    }

    // サムネイル表示
    if (backImages.length > 0) {
        const strip = document.createElement('div');
        strip.className = 'thumbnail-inner-strip';
        backImages.forEach((imgData, index) => {
            const item = document.createElement('div');
            item.className = 'thumbnail-item';

            const img = document.createElement('img');
            img.src = imgData;
            img.alt = `キャプチャ ${index + 1}`;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'thumbnail-remove';
            removeBtn.textContent = '✕';
            removeBtn.title = '削除';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeImageAt('back', index);
            });

            item.appendChild(img);
            item.appendChild(removeBtn);
            strip.appendChild(item);
        });
        previewBack.appendChild(strip);
        previewBack.classList.add('has-image');
    }

    btnClearBack.classList.remove('hidden');
    const countEl = document.getElementById('back-count');
    const totalItems = (backTextData ? 1 : 0) + backImages.length;
    countEl.textContent = `(${totalItems})`;
    countEl.classList.remove('hidden');
}

async function removeImageAt(side, index) {
    if (side === 'front') {
        frontImages.splice(index, 1);
        renderThumbnails(previewFront, frontImages, 'front');
        if (frontImages.length === 0) btnQuestion.classList.remove('captured');
    } else if (side === 'back') {
        backImages.splice(index, 1);
        renderBackPreview();
        if (backImages.length === 0 && !backTextData) btnAnswer.classList.remove('captured');
    }

    await chrome.runtime.sendMessage({
        action: 'removeImage',
        side: side,
        index: index
    });

    updateSaveButton();
    showStatus('画像を削除しました', 'info');
}

// --- Save Card ---
async function saveCard() {
    const frontTextVal = frontTextInput.value.trim();
    const backTextVal = backTextInput.value.trim();
    const hasFront = !!(frontImages.length > 0 || frontTextVal);

    if (!currentDeck || !currentModel || !hasFront) {
        showStatus('デッキ、ノートタイプ、問題の入力（または画像）が必要です', 'error');
        return;
    }

    showStatus('カードを保存中...', 'info');
    btnSave.disabled = true;

    // 裏面: テキスト入力値があればそれを優先、AI生成テキストはフォールバック
    const resolvedBackText = backTextVal || backTextData || null;

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'addCard',
            deckName: currentDeck,
            modelName: currentModel,
            frontImages: frontImages,
            frontText: frontTextVal || null,
            backImages: backImages,
            backText: resolvedBackText
        });

        if (response.success) {
            showStatus('カードを保存しました', 'success');
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
    frontImages = [];
    renderThumbnails(previewFront, frontImages, 'front');
    frontTextInput.value = '';
    btnQuestion.classList.remove('captured');
    chrome.runtime.sendMessage({ action: 'storeImage', side: 'front', imageData: null });
    chrome.runtime.sendMessage({ action: 'storeText', side: 'front', text: '' });
    updateSaveButton();
    showStatus('問題をクリアしました', 'info');
}

function clearBack() {
    backImages = [];
    backTextData = null;
    renderBackPreview();
    backTextInput.value = '';
    btnAnswer.classList.remove('captured');
    chrome.runtime.sendMessage({ action: 'storeImage', side: 'back', imageData: null });
    chrome.runtime.sendMessage({ action: 'storeImage', side: 'backText', imageData: null });
    chrome.runtime.sendMessage({ action: 'storeText', side: 'back', text: '' });
    updateSaveButton();
    showStatus('解説をクリアしました', 'info');
}

// --- Reset ---
function resetCard() {
    frontImages = [];
    backImages = [];
    backTextData = null;

    renderThumbnails(previewFront, frontImages, 'front');
    renderBackPreview();

    frontTextInput.value = '';
    backTextInput.value = '';

    btnQuestion.classList.remove('captured');
    btnAnswer.classList.remove('captured');
    updateSaveButton();

    // バックグラウンドの状態もリセット
    chrome.runtime.sendMessage({ action: 'storeText', side: 'front', text: '' });
    chrome.runtime.sendMessage({ action: 'storeText', side: 'back', text: '' });

    updateSaveButton();
    setTimeout(() => showStatus('次のカードを追加できます', 'success'), 2000);
}

// --- UI Helpers ---
function enableButtons() {
    btnQuestion.disabled = false;
    btnAnswer.disabled = false;
}

function updateSaveButton() {
    const hasFront = !!(frontImages.length > 0 || (frontTextInput && frontTextInput.value.trim()));
    btnSave.disabled = !(currentDeck && currentModel && hasFront);
}

function showStatus(text, type) {
    statusMessage.textContent = text;
    statusMessage.className = `status-message ${type}`;
}

function debounce(fn, ms) {
    let id;
    return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}
