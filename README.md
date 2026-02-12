# Anki Card Creator — Chrome拡張機能

Webブラウザ上の範囲を選択して、Ankiカードを素早く作成するChrome拡張機能です。

## 機能

- 📷 Webページの任意の範囲をドラッグ選択して画像としてキャプチャ
- 🃏 キャプチャした画像をAnkiカードの問題面・解説面に設定
- 📦 AnkiConnect経由で指定デッキに即座にカードを追加
- 💾 前回使用したデッキを記憶

## セットアップ

### 1. AnkiConnectのインストール

1. Ankiを開く
2. ツール → アドオン → 新規アドオンを取得
3. コード `2055492159` を入力してインストール
4. Ankiを再起動

### 2. Chrome拡張機能の読み込み(未公開版の場合)

1. Chromeで `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このプロジェクトのフォルダ (`AnkiProject`) を選択
5. ツールバーに拡張機能のアイコンが表示される

## 使い方

1. **Ankiを起動** しておく（AnkiConnectがバックグラウンドで動作）
2. 拡張アイコンをクリック → **デッキを選択**
3. **「問題を追加」** をクリック → ページ上でドラッグして範囲選択
4. 拡張アイコンを再度クリック → **「解説を追加」** → 同様に範囲選択
5. **「カードを保存」** をクリック → Ankiにカードが追加される
6. 次のカード作成へ！

AnkiConnectが正しく動作しているか確認するために、ポート番号`8765`を確認してください。(Webブラウザで`localhost:8765`と検索)
`{"apiVersion": "AnkiConnect v.6"}`が表示されれば成功です。

### オプション:AI解説機能について

- 問題文をキャプチャ後、AIにキャプチャした画像を読み込ませ、解説文を出力させることができます。

**お手持ちのAPIキーを適応する必要があります。**

以下にGeminiでのセットアップ例を記載します。
1. **Google Ai Studio** にログインします。https://aistudio.google.com/?project=gen-lang-client-0947852434　//後でURL短くする
2. **Get API Key** にアクセスする。
3. 適当なプロジェクトを作成し、APIキーを発行する。(Ankiなど識別できるようにしておくことを推奨)
4. 不規則な文字列で構成された「キー」をコピーし、本ツールの「APIキー」を入力する部分にペーストします。
5. キー貼り付け後、モデルを選択します。ここで、個人利用であれば無料のモデルがオススメです。(記入時点では`gemini-2.5-flash`ですが、随時更新されるため逐次確認してください)
  
解説がない場合等にご活用ください。

## プロジェクト構成

```
AnkiProject/
├── manifest.json          # 拡張機能設定
├── popup/                 # ツールバーポップアップ
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/               # ページ注入スクリプト
│   └── content.js
├── background/            # バックグラウンド処理
│   └── background.js
├── offscreen/             # 画像トリミング処理
│   ├── offscreen.html
│   └── offscreen.js
└── icons/                 # アイコン
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 技術スタック

- Chrome Extension Manifest V3
- AnkiConnect REST API
- Vanilla JavaScript

## Contribute

- showstarkm1129 < 1%
- Claude Opus 4.6 > 99%
