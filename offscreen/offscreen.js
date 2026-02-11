/**
 * Anki Card Creator — Offscreen Document Script
 * Canvas を使った画像トリミング処理
 * (Service Worker では Canvas が使えないため、Offscreen Document で処理する)
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // background workerからのメッセージのみ処理
    if (message.action === 'cropImage' && message.target === 'offscreen') {
        cropImage(message.dataUrl, message.rect, message.dpr)
            .then(croppedImage => sendResponse({ croppedImage }))
            .catch(error => sendResponse({ error: error.message }));
        return true; // 非同期レスポンス
    }
});

async function cropImage(dataUrl, rect, dpr) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // DPRを考慮した座標計算
                const sx = rect.left * dpr;
                const sy = rect.top * dpr;
                const sw = rect.width * dpr;
                const sh = rect.height * dpr;

                // 出力サイズはDPR倍の解像度
                canvas.width = sw;
                canvas.height = sh;

                // トリミング
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

                // Base64で返す
                resolve(canvas.toDataURL('image/png'));
            } catch (error) {
                reject(error);
            }
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = dataUrl;
    });
}
