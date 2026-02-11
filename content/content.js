/**
 * Anki Card Creator — Content Script
 * Webページ上で範囲選択オーバーレイとトリミング処理を提供する
 */

(() => {
    // 既存のオーバーレイを必ず削除（連打対策）
    function removeExistingOverlay() {
        const existingOverlay = document.getElementById('anki-capture-overlay');
        const existingBox = document.getElementById('anki-selection-box');
        const existingLabel = document.getElementById('anki-instruction-label');
        if (existingOverlay) existingOverlay.remove();
        if (existingBox) existingBox.remove();
        if (existingLabel) existingLabel.remove();
    }

    // 二重リスナー防止
    if (window.__ankiCardCreatorInjected) {
        return;
    }
    window.__ankiCardCreatorInjected = true;

    let isSelecting = false;
    let currentSide = null;
    let startX = 0;
    let startY = 0;
    let overlay = null;
    let selectionBox = null;
    let instructionLabel = null;

    // --- メッセージ受信 ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'startSelection') {
            currentSide = message.side;
            cleanup();
            beginSelection();
            sendResponse({ status: 'ok' });
        }
        return true;
    });

    // --- 範囲選択の開始 ---
    function beginSelection() {
        removeExistingOverlay();

        overlay = document.createElement('div');
        overlay.id = 'anki-capture-overlay';
        overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.3);
      cursor: crosshair;
      z-index: 2147483647;
      user-select: none;
    `;

        selectionBox = document.createElement('div');
        selectionBox.id = 'anki-selection-box';
        selectionBox.style.cssText = `
      position: fixed;
      border: 2px solid #7c4dff;
      background: rgba(124, 77, 255, 0.1);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4);
      display: none;
      z-index: 2147483647;
      pointer-events: none;
    `;

        instructionLabel = document.createElement('div');
        instructionLabel.id = 'anki-instruction-label';
        const sideText = currentSide === 'front' ? '問題（表面）' : '解説（裏面）';
        instructionLabel.textContent = `📷 ${sideText}の範囲をドラッグで選択 ｜ Escでキャンセル`;
        instructionLabel.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #1a237e, #7c4dff);
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-family: 'Segoe UI', 'Meiryo', sans-serif;
      font-weight: 500;
      z-index: 2147483647;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      pointer-events: none;
      white-space: nowrap;
    `;

        document.body.appendChild(overlay);
        document.body.appendChild(selectionBox);
        document.body.appendChild(instructionLabel);

        overlay.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        isSelecting = true;
    }

    // --- マウス操作 ---
    function onMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();

        startX = e.clientX;
        startY = e.clientY;

        selectionBox.style.display = 'block';
        selectionBox.style.left = startX + 'px';
        selectionBox.style.top = startY + 'px';
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        e.preventDefault();
        const currentX = e.clientX;
        const currentY = e.clientY;
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);

        selectionBox.style.left = left + 'px';
        selectionBox.style.top = top + 'px';
        selectionBox.style.width = width + 'px';
        selectionBox.style.height = height + 'px';
    }

    function onMouseUp(e) {
        e.preventDefault();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        const currentX = e.clientX;
        const currentY = e.clientY;

        const rect = {
            left: Math.min(startX, currentX),
            top: Math.min(startY, currentY),
            width: Math.abs(currentX - startX),
            height: Math.abs(currentY - startY)
        };

        if (rect.width < 10 || rect.height < 10) {
            cleanup();
            return;
        }

        captureRegion(rect);
    }

    // --- キャプチャ + トリミング処理 ---
    async function captureRegion(rect) {
        // オーバーレイを非表示にする
        overlay.style.display = 'none';
        selectionBox.style.display = 'none';
        instructionLabel.style.display = 'none';

        // オーバーレイが消えるのを待つ
        await new Promise(resolve => setTimeout(resolve, 150));

        const side = currentSide;

        try {
            // Step 1: Background Workerにフルスクリーンキャプチャを依頼
            const response = await chrome.runtime.sendMessage({
                action: 'captureTab'
            });

            if (!response.success) {
                console.error('Capture failed:', response.error);
                cleanup();
                return;
            }

            // Step 2: Content Script側でCanvasを使ってトリミング
            const dpr = window.devicePixelRatio || 1;
            const croppedDataUrl = await cropWithCanvas(response.dataUrl, rect, dpr);

            // Step 3: トリミング済み画像をBackground Workerに保存
            await chrome.runtime.sendMessage({
                action: 'storeImage',
                side: side,
                imageData: croppedDataUrl
            });

        } catch (error) {
            console.error('Capture error:', error);
        }

        cleanup();
    }

    // --- Canvasでトリミング ---
    function cropWithCanvas(dataUrl, rect, dpr) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    // DPR考慮した座標
                    const sx = Math.round(rect.left * dpr);
                    const sy = Math.round(rect.top * dpr);
                    const sw = Math.round(rect.width * dpr);
                    const sh = Math.round(rect.height * dpr);

                    canvas.width = sw;
                    canvas.height = sh;

                    // トリミングして描画
                    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

                    resolve(canvas.toDataURL('image/png'));
                } catch (error) {
                    reject(error);
                }
            };
            img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
            img.src = dataUrl;
        });
    }

    // --- キーボード操作 ---
    function onKeyDown(e) {
        if (e.key === 'Escape') {
            cleanup();
        }
    }

    // --- クリーンアップ ---
    function cleanup() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('keydown', onKeyDown);

        if (overlay) { overlay.remove(); overlay = null; }
        if (selectionBox) { selectionBox.remove(); selectionBox = null; }
        if (instructionLabel) { instructionLabel.remove(); instructionLabel = null; }

        isSelecting = false;
    }
})();
