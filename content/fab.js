/**
 * Anki Card Creator — Floating Action Button (FAB)
 * Webページ上にドラッグ可能なボタンを表示し、クイックアクセスメニューを提供する
 */

(() => {
    // 二重注入防止
    if (window.__ankiFabInjected) return;
    window.__ankiFabInjected = true;

    const DRAG_THRESHOLD = 5; // px — これ以上動いたらドラッグ扱い

    let fabHost = null;
    let shadow = null;
    let fab = null;
    let menu = null;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let fabX = 0;
    let fabY = 0;
    let offsetX = 0;
    let offsetY = 0;
    let hasMoved = false;
    let menuOpen = false;
    let myTabId = null;

    // --- 初期化 ---
    function init() {
        // Tab IDを取得
        chrome.runtime.sendMessage({ action: 'getTabId' }, (response) => {
            if (response && response.success) {
                myTabId = response.tabId;
            }
        });

        createFab();
        restorePosition();
        addEventListeners();
    }

    // --- FAB作成 (Shadow DOM) ---
    function createFab() {
        fabHost = document.createElement('div');
        fabHost.id = 'anki-fab-host';
        shadow = fabHost.attachShadow({ mode: 'closed' });

        // CSSを読み込み
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = chrome.runtime.getURL('content/fab.css');
        shadow.appendChild(link);

        // FABボタン
        fab = document.createElement('button');
        fab.className = 'anki-fab';
        fab.title = 'Anki Card Creator';
        fab.innerHTML = `
            <svg class="anki-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3"/>
                <line x1="9" y1="9" x2="15" y2="9"/>
                <line x1="9" y1="13" x2="13" y2="13"/>
            </svg>
        `;

        // ドロップダウンメニュー
        menu = document.createElement('div');
        menu.className = 'anki-fab-menu';
        menu.innerHTML = `
            <button class="anki-fab-menu-item" data-action="front">
                <span class="anki-fab-menu-icon">📷</span>
                問題を追加
            </button>
            <button class="anki-fab-menu-item" data-action="back">
                <span class="anki-fab-menu-icon">📝</span>
                解説を追加
            </button>
            <div class="anki-fab-menu-divider"></div>
            <button class="anki-fab-menu-item" data-action="popup">
                <span class="anki-fab-menu-icon">📂</span>
                ポップアップを開く
            </button>
            <div class="anki-fab-menu-divider"></div>
            <button class="anki-fab-menu-item" data-action="hide">
                <span class="anki-fab-menu-icon">🚫</span>
                非表示にする
            </button>
        `;

        fab.appendChild(menu);
        shadow.appendChild(fab);
        document.body.appendChild(fabHost);
    }

    // --- 位置の復元 ---
    function restorePosition() {
        chrome.storage.local.get('fabPosition', (result) => {
            if (result.fabPosition) {
                fabX = result.fabPosition.x;
                fabY = result.fabPosition.y;
            } else {
                // デフォルト: 右下
                fabX = window.innerWidth - 72;
                fabY = window.innerHeight - 72;
            }
            // 画面外に出ないよう補正
            clampPosition();
            applyPosition();
        });
    }

    // --- 画面内に制限 ---
    function clampPosition() {
        const maxX = window.innerWidth - 56;
        const maxY = window.innerHeight - 56;
        fabX = Math.max(4, Math.min(fabX, maxX));
        fabY = Math.max(4, Math.min(fabY, maxY));
    }

    // --- 位置を適用 ---
    function applyPosition() {
        fabHost.style.cssText = `
            position: fixed;
            left: ${fabX}px;
            top: ${fabY}px;
            z-index: 2147483646;
        `;
    }

    // --- 位置を保存 ---
    function savePosition() {
        chrome.storage.local.set({ fabPosition: { x: fabX, y: fabY } });
    }

    // --- イベントリスナー ---
    function addEventListeners() {
        // ドラッグ開始
        fab.addEventListener('mousedown', onMouseDown);

        // メニュー項目クリック
        menu.addEventListener('click', onMenuClick);

        // 外部クリックでメニューを閉じる
        document.addEventListener('mousedown', onDocumentClick);

        // リサイズ時に位置補正
        window.addEventListener('resize', () => {
            clampPosition();
            applyPosition();
        });

        // キャプチャ時にFABを隠す/表示する
        window.addEventListener('anki-fab-visibility', (e) => {
            fabHost.style.display = e.detail.visible ? '' : 'none';
        });
    }

    // --- ドラッグ ---
    function onMouseDown(e) {
        // メニュー項目のクリックは無視
        if (e.target.closest('.anki-fab-menu-item') || e.target.closest('.anki-fab-menu-divider')) {
            return;
        }

        e.preventDefault();
        isDragging = true;
        hasMoved = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        offsetX = e.clientX - fabX;
        offsetY = e.clientY - fabY;

        fab.classList.add('dragging');

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        if (!isDragging) return;

        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;

        if (!hasMoved && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) {
            return;
        }

        hasMoved = true;

        fabX = e.clientX - offsetX;
        fabY = e.clientY - offsetY;
        clampPosition();
        applyPosition();

        // メニューが開いている場合は閉じる
        if (menuOpen) closeMenu();
    }

    function onMouseUp(e) {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        fab.classList.remove('dragging');
        isDragging = false;

        if (hasMoved) {
            // ドラッグ終了 → 位置保存
            savePosition();
        } else {
            // クリック → メニュー切替
            toggleMenu();
        }
    }

    // --- メニュー ---
    function toggleMenu() {
        if (menuOpen) {
            closeMenu();
        } else {
            openMenu();
        }
    }

    function openMenu() {
        // メニューの展開方向を判定（画面上部近くなら下に展開）
        const fabRect = fab.getBoundingClientRect();
        if (fabRect.top < 200) {
            menu.style.bottom = 'auto';
            menu.style.top = '60px';
        } else {
            menu.style.bottom = '60px';
            menu.style.top = 'auto';
        }

        // 左寄りなら右に展開
        if (fabRect.left < 200) {
            menu.style.right = 'auto';
            menu.style.left = '0';
        } else {
            menu.style.right = '0';
            menu.style.left = 'auto';
        }

        menu.classList.add('open');
        menuOpen = true;
    }

    function closeMenu() {
        menu.classList.remove('open');
        menuOpen = false;
    }

    // --- メニュー項目クリック ---
    function onMenuClick(e) {
        const item = e.target.closest('.anki-fab-menu-item');
        if (!item) return;

        e.stopPropagation();
        const action = item.dataset.action;
        closeMenu();

        switch (action) {
            case 'front':
                startCapture('front');
                break;
            case 'back':
                startCapture('back');
                break;
            case 'popup':
                const width = 380;
                const height = 620;

                // FABの位置（Viewport座標）
                // fabX, fabY はFABの左上座標

                // スクリーン座標の概算
                // window.screenX/Y はウィンドウの左上。
                // ブラウザのUI（タブバー等）の高さを考慮してViewportの開始位置を推定
                const chromeHeight = window.outerHeight - window.innerHeight;
                const screenLeft = window.screenX;
                const screenTop = window.screenY + chromeHeight;

                // 基本: FABの左側に表示、下揃え
                let left = screenLeft + fabX - width - 10;
                let top = screenTop + fabY + 56 - height;

                // 水平位置の調整
                if (fabX < window.innerWidth / 2) {
                    // FABが左側にある場合 → ポップアップを右側に表示
                    left = screenLeft + fabX + 70; // FAB幅(約56) + マージン
                }

                // 垂直位置の調整
                if (fabY < window.innerHeight / 2) {
                    // FABが上側にある場合 → ポップアップを上揃え
                    top = screenTop + fabY;
                }

                // URL構築
                const url = chrome.runtime.getURL(myTabId ? `popup/popup.html?tabId=${myTabId}` : 'popup/popup.html');

                // ウィンドウを開く
                window.open(url, 'AnkiCardCreatorPopup', `width=${width},height=${height},left=${left},top=${top}`);
                break;
            case 'hide':
                fabHost.style.display = 'none';
                break;
        }
    }

    // --- キャプチャ開始 ---
    function startCapture(side) {
        // content.js に選択開始を伝える（同一ページ内なのでカスタムイベント使用）
        window.dispatchEvent(new CustomEvent('anki-start-selection', {
            detail: { side: side }
        }));
    }

    // --- 外部クリックでメニューを閉じる ---
    function onDocumentClick(e) {
        if (!menuOpen) return;
        // FABホスト内のクリックは無視
        if (fabHost.contains(e.target) || e.composedPath().includes(fabHost)) return;
        closeMenu();
    }

    // DOMReady後に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
