/**
 * Anki Card Creator — Content Script
 * Webページ上で範囲選択オーバーレイを提供する
 */

(() => {
    // 二重読み込み防止
    if (window.__ankiCardCreatorInjected) return;
    window.__ankiCardCreatorInjected = true;

    let isSelecting = false;
    let currentSide = null; // 'front' or 'back'
    let startX = 0;
    let startY = 0;
    let overlay = null;
    let selectionBox = null;
    let instructionLabel = null;

    // --- メッセージ受信 ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'startSelection') {
            currentSide = message.side;
            beginSelection();
            sendResponse({ status: 'ok' });
        }
        return true;
    });

    // --- 範囲選択の開始 ---
    function beginSelection() {
        // オーバーレイを作成
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

        // 選択矩形
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

        // 操作説明ラベル
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

        // イベントリスナー
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

        // 最小サイズチェック
        if (rect.width < 10 || rect.height < 10) {
            cleanup();
            return;
        }

        // オーバーレイを一時非表示にしてキャプチャ
        captureRegion(rect);
    }

    // --- キャプチャ処理 ---
    async function captureRegion(rect) {
        // オーバーレイを非表示
        overlay.style.display = 'none';
        selectionBox.style.display = 'none';
        instructionLabel.style.display = 'none';

        // 少し待ってからキャプチャ（オーバーレイが消えるのを待つ）
        await new Promise(resolve => setTimeout(resolve, 100));

        // Background Workerにキャプチャを依頼
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'captureTab',
                rect: rect,
                side: currentSide,
                devicePixelRatio: window.devicePixelRatio || 1
            });

            if (response.success) {
                // ポップアップに結果を通知（ポップアップが開いていない場合もある）
                // Background workerが処理する
            } else {
                console.error('Capture failed:', response.error);
            }
        } catch (error) {
            console.error('Capture error:', error);
        }

        cleanup();
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

        if (overlay) {
            overlay.remove();
            overlay = null;
        }
        if (selectionBox) {
            selectionBox.remove();
            selectionBox = null;
        }
        if (instructionLabel) {
            instructionLabel.remove();
            instructionLabel = null;
        }

        isSelecting = false;
        currentSide = null;

        // 再度注入できるようにフラグをリセット
        window.__ankiCardCreatorInjected = false;
    }
})();
