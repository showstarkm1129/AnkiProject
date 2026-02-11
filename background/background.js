/**
 * Anki Card Creator — Background Service Worker
 * AnkiConnect通信、タブキャプチャ、画像トリミングを担当
 */

const ANKI_CONNECT_URL = 'http://localhost:8765';

// --- 現在のカードの状態 ---
let cardState = {
    frontImage: null,
    backImage: null
};

// --- メッセージハンドラ ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // offscreen document や popup からのメッセージを区別
    // captureComplete / cropImage はoffscreen用なのでここでは無視
    if (message.action === 'cropImage' || message.action === 'captureComplete') {
        return false;
    }

    handleMessage(message, sender)
        .then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 非同期レスポンスを使用
});

async function handleMessage(message, sender) {
    switch (message.action) {
        case 'getDeckNames':
            return await getDeckNames();

        case 'captureTab':
            return await captureAndCrop(message, sender);

        case 'addCard':
            return await addCard(message);

        case 'getState':
            return { success: true, cardState: cardState };

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

// --- タブキャプチャ + トリミング ---
async function captureAndCrop(message, sender) {
    const { rect, side, devicePixelRatio } = message;

    try {
        // 現在のタブをキャプチャ
        const tabId = sender.tab.id;
        const windowId = sender.tab.windowId;

        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
            format: 'png'
        });

        // OffscreenDocumentでトリミング
        const croppedImage = await cropImage(dataUrl, rect, devicePixelRatio);

        // 状態を保存（ポップアップが閉じていても残る）
        if (side === 'front') {
            cardState.frontImage = croppedImage;
        } else {
            cardState.backImage = croppedImage;
        }

        // バッジで通知（ポップアップが閉じていても見える）
        const badge = side === 'front' ? 'Q' : 'A';
        const existing = cardState.frontImage && cardState.backImage ? 'QA' : badge;
        chrome.action.setBadgeText({ text: existing });
        chrome.action.setBadgeBackgroundColor({ color: '#66bb6a' });

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// --- 画像トリミング ---
async function cropImage(dataUrl, rect, dpr) {
    try {
        // Offscreen documentが存在するか確認
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });

        if (existingContexts.length === 0) {
            await chrome.offscreen.createDocument({
                url: 'offscreen/offscreen.html',
                reasons: ['CANVAS'],
                justification: 'Crop captured tab image'
            });
        }

        // offscreen documentにメッセージを送る
        const response = await chrome.runtime.sendMessage({
            action: 'cropImage',
            target: 'offscreen',
            dataUrl: dataUrl,
            rect: rect,
            dpr: dpr
        });

        return response.croppedImage;
    } catch (error) {
        console.error('Offscreen crop failed, using fallback:', error);
        // フォールバック: トリミングなしで画像を返す
        return dataUrl;
    }
}

// --- カード追加 ---
async function addCard(message) {
    const { deckName, frontImage, backImage } = message;

    // メッセージから来た画像を優先、なければcardStateから
    const front = frontImage || cardState.frontImage;
    const back = backImage || cardState.backImage;

    if (!front) {
        return { success: false, error: '問題の画像がありません' };
    }

    try {
        // ファイル名を生成
        const timestamp = Date.now();
        const frontFilename = `anki_front_${timestamp}.png`;
        const backFilename = back ? `anki_back_${timestamp}.png` : null;

        // Base64データを抽出（data:image/png;base64,... → base64のみ）
        const frontBase64 = front.replace(/^data:image\/\w+;base64,/, '');
        const backBase64 = back ? back.replace(/^data:image\/\w+;base64,/, '') : null;

        // カードのフィールドと画像を設定
        const fields = {
            Front: `<img src="${frontFilename}">`,
            Back: back ? `<img src="${backFilename}">` : ''
        };

        const picture = [
            {
                data: frontBase64,
                filename: frontFilename,
                fields: ['Front']
            }
        ];

        if (back && backBase64) {
            picture.push({
                data: backBase64,
                filename: backFilename,
                fields: ['Back']
            });
        }

        // AnkiConnectでカード追加
        const noteId = await ankiConnectRequest('addNote', {
            note: {
                deckName: deckName,
                modelName: 'Basic',
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
        chrome.action.setBadgeText({ text: '' });

        return { success: true, noteId: noteId };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
