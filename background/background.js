/**
 * Anki Card Creator — Background Service Worker
 * AnkiConnect通信、タブキャプチャ、LLM API連携を担当
 */

const ANKI_CONNECT_URL = 'http://localhost:8765';

// --- 現在のカードの状態 ---
let cardState = {
    frontImage: null,
    backImage: null,
    backText: null
};

// --- メッセージハンドラ ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // offscreen用メッセージは無視
    if (message.action === 'cropImage' || message.action === 'captureComplete') {
        return false;
    }

    handleMessage(message, sender)
        .then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
});

async function handleMessage(message, sender) {
    switch (message.action) {
        case 'getDeckNames':
            return await getDeckNames();

        case 'getModelNames':
            return await getModelNames();

        case 'captureTab':
            return await captureTab(sender);

        case 'storeImage':
            return storeImage(message);

        case 'addCard':
            return await addCard(message);

        case 'generateExplanation':
            return await generateExplanation(message);

        case 'getState':
            return { success: true, cardState: cardState };

        case 'getTabId':
            return { success: true, tabId: sender.tab.id };

        default:
            return { success: false, error: `Unknown action: ${message.action}` };
    }
}

// --- AnkiConnect API ---
async function ankiConnectRequest(action, params = {}) {
    const response = await fetch(ANKI_CONNECT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: action,
            version: 6,
            params: params
        })
    });

    if (!response.ok) {
        throw new Error(`AnkiConnect HTTP error: ${response.status}`);
    }

    const result = await response.json();

    if (result.error) {
        throw new Error(`AnkiConnect error: ${result.error}`);
    }

    return result.result;
}

// --- デッキ一覧取得 ---
async function getDeckNames() {
    try {
        const decks = await ankiConnectRequest('deckNames');
        return { success: true, data: decks };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// --- モデル一覧取得 ---
async function getModelNames() {
    try {
        const models = await ankiConnectRequest('modelNames');
        return { success: true, data: models };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// --- タブキャプチャ ---
async function captureTab(sender) {
    try {
        const windowId = sender.tab.windowId;
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        return { success: true, dataUrl: dataUrl };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// --- 画像/テキスト保存 ---
function storeImage(message) {
    const { side, imageData } = message;

    if (side === 'front') {
        cardState.frontImage = imageData;
    } else if (side === 'backText') {
        cardState.backText = imageData; // テキストとして保存
        cardState.backImage = null;
    } else {
        cardState.backImage = imageData;
        cardState.backText = null;
    }

    // バッジ更新
    const hasBack = cardState.backImage || cardState.backText;
    const badgeText = (cardState.frontImage && hasBack) ? 'QA'
        : cardState.frontImage ? 'Q'
            : hasBack ? 'A'
                : '';
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: '#66bb6a' });

    // ポップアップ等に完了を通知
    chrome.runtime.sendMessage({ action: 'captureComplete', side: side }).catch(() => { });

    return { success: true };
}

// ===========================================
// LLM API 連携
// ===========================================

async function generateExplanation(message) {
    const { imageData, provider, apiKey, llmModel, customInstruction } = message;

    if (!apiKey) {
        return { success: false, error: 'APIキーが設定されていません' };
    }

    if (!imageData) {
        return { success: false, error: '問題の画像がありません' };
    }

    const base64 = imageData.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = imageData.match(/^data:(image\/\w+);/)?.[1] || 'image/png';

    // プロンプト構築
    let systemPrompt = 'あなたは学習支援AIです。画像に写っている問題を分析し、わかりやすい解説を作成してください。';
    if (customInstruction) {
        systemPrompt += `\n\nユーザーからの指示: ${customInstruction}`;
    }
    systemPrompt += '\n\nHTMLの記述で簡潔に出力して';

    try {
        let text;
        if (provider === 'gemini') {
            text = await callGemini(apiKey, base64, mimeType, systemPrompt, llmModel || 'gemini-2.5-flash');
        } else if (provider === 'openai') {
            text = await callOpenAI(apiKey, base64, mimeType, systemPrompt, llmModel || 'gpt-4o-mini');
        } else if (provider === 'openrouter') {
            text = await callOpenRouter(apiKey, base64, mimeType, systemPrompt, llmModel || 'deepseek/deepseek-chat');
        } else {
            return { success: false, error: `未対応のAPI: ${provider}` };
        }

        return { success: true, text: text };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// --- Gemini API ---
async function callGemini(apiKey, base64, mimeType, prompt, model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: mimeType,
                            data: base64
                        }
                    }
                ]
            }]
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();

    if (result.candidates && result.candidates[0]?.content?.parts?.[0]?.text) {
        return result.candidates[0].content.parts[0].text;
    }

    throw new Error('Gemini APIから回答を取得できませんでした');
}

// --- OpenAI API ---
async function callOpenAI(apiKey, base64, mimeType, prompt, model) {
    const url = 'https://api.openai.com/v1/chat/completions';
    return await callOpenAICompatible(url, apiKey, base64, mimeType, prompt, model);
}

// --- OpenRouter API (OpenAI Compatible) ---
async function callOpenRouter(apiKey, base64, mimeType, prompt, model) {
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    // OpenRouter requires Referer header for rankings (optional but recommended)
    const headers = {
        'HTTP-Referer': 'https://github.com/showstarkm1129/AnkiProject',
        'X-Title': 'Anki Card Creator'
    };
    return await callOpenAICompatible(url, apiKey, base64, mimeType, prompt, model, headers);
}

// --- Common OpenAI Compatible Handler ---
async function callOpenAICompatible(url, apiKey, base64, mimeType, prompt, model, extraHeaders = {}) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            ...extraHeaders
        },
        body: JSON.stringify({
            model: model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${base64}`
                        }
                    }
                ]
            }],
            max_tokens: 1024
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();

    if (result.choices && result.choices[0]?.message?.content) {
        return result.choices[0].message.content;
    }

    throw new Error('APIから回答を取得できませんでした');
}

// --- Anthropic API ---
async function callAnthropic(apiKey, base64, mimeType, prompt, model) {
    const url = 'https://api.anthropic.com/v1/messages';

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'dangerously-allow-browser': 'true'
        },
        body: JSON.stringify({
            model: model,
            max_tokens: 1024,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mimeType,
                            data: base64
                        }
                    },
                    { type: 'text', text: prompt }
                ]
            }]
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();

    if (result.content && result.content[0]?.text) {
        return result.content[0].text;
    }

    throw new Error('Anthropic APIから回答を取得できませんでした');
}

// --- OpenRouter API ---
async function callOpenRouter(apiKey, base64, mimeType, prompt, model) {
    const url = 'https://openrouter.ai/api/v1/chat/completions';

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            // 'HTTP-Referer': 'https://github.com/your-repo', // Optional
            // 'X-Title': 'Anki Card Creator' // Optional
        },
        body: JSON.stringify({
            model: model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${base64}`
                        }
                    }
                ]
            }]
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();

    if (result.choices && result.choices[0]?.message?.content) {
        return result.choices[0].message.content;
    }

    throw new Error('OpenRouter APIから回答を取得できませんでした');
}

// ===========================================
// カード追加
// ===========================================

async function addCard(message) {
    const { deckName, modelName, frontImage, backImage, backText } = message;

    const front = frontImage || cardState.frontImage;
    const backImg = backImage || cardState.backImage;
    const backTxt = backText || cardState.backText;

    if (!front) {
        return { success: false, error: '問題の画像がありません' };
    }

    if (!modelName) {
        return { success: false, error: 'ノートタイプが指定されていません' };
    }

    try {
        const timestamp = Date.now();
        const frontFilename = `anki_front_${timestamp}.png`;

        const frontBase64 = front.replace(/^data:image\/\w+;base64,/, '');

        // モデルのフィールド名を取得
        const fieldNames = await ankiConnectRequest('modelFieldNames', { modelName: modelName });
        const frontField = fieldNames[0] || 'Front';
        const backField = fieldNames[1] || 'Back';

        // フィールドを構築
        const fields = {};
        fields[frontField] = '';

        // 裏面: テキスト or 画像 or 空
        if (backTxt) {
            fields[backField] = backTxt;
        } else {
            fields[backField] = '';
        }

        // 画像設定
        const picture = [
            {
                data: frontBase64,
                filename: frontFilename,
                fields: [frontField]
            }
        ];

        // 裏面が画像の場合
        if (backImg && !backTxt) {
            const backFilename = `anki_back_${timestamp}.png`;
            const backBase64 = backImg.replace(/^data:image\/\w+;base64,/, '');
            picture.push({
                data: backBase64,
                filename: backFilename,
                fields: [backField]
            });
        }

        const noteId = await ankiConnectRequest('addNote', {
            note: {
                deckName: deckName,
                modelName: modelName,
                fields: fields,
                options: {
                    allowDuplicate: true
                },
                picture: picture
            }
        });

        // 状態をリセット
        cardState.frontImage = null;
        cardState.backImage = null;
        cardState.backText = null;
        chrome.action.setBadgeText({ text: '' });

        return { success: true, noteId: noteId };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
