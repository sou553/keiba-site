# 見た目改善版 変更点

目的:
既存機能を壊さず、CSS中心でサイト全体の見た目を改善した版です。
JavaScriptの処理ロジック、データ読込、URLパラメータ、JSON構造は変更していません。

## 置き換え対象

以下を docs/ 配下へそのまま上書きしてください。

- index.html
- race_detail.html
- past_detail.html
- betting.html
- jockeys.html
- recommended_bets.html
- course_site_data_corner_style_pedigree.json
- static/style.css
- static/recommended_bets.css
- static/analysis_common.js
- static/index.js
- static/race.js
- static/past.js
- static/betting.js
- static/jockeys.js
- static/recommended_bets.js

## 主な変更点

### 1. 既存機能は維持
- JSファイルの中身は変更していません。
- データ読込パス、race_id/date のURL仕様、各ページのアプリIDは維持しています。
- 既存の出走馬一覧、過去走比較、買い目作成、騎手一覧、推奨買い目の処理はそのままです。

### 2. style.css に見た目改善パッチを追加
- 既存CSSの末尾に `Visual polish patch 2026-05` を追加しました。
- 既存CSSを削除せず、後勝ちの上書きで見た目だけ整えています。
- ページごとのHTML構造に依存しすぎないよう、既存クラスへ広めに適用しています。

### 3. 全体のトーンを統一
- 背景を薄いベージュ系に統一。
- カード、パネル、表、ボタン、タグの質感を統一。
- 影を弱め、紙面風の表示に調整。
- 角丸を少し抑えて、情報量を落とさず見やすくしました。

### 4. ヘッダーの見た目を改善
- `site-header` を sticky 化。
- 透明感のある背景と下線を追加。
- ブランドアイコン、サイトタイトル、サブタイトルの余白を整理。
- スマホでは横幅が崩れにくいように調整。

### 5. トップページの一覧性を改善
- レースカード・レース行の背景、見出し帯、ボタンを整理。
- 大きすぎる余白を少し詰め、スマホで1画面に入る情報量を増やしました。
- 既存のフィルタ・リンク・表示内容は変更していません。

### 6. レース詳細の見やすさを改善
- 予想まとめ、人気乖離、出走馬一覧、詳細カードのカード感を統一。
- 表のヘッダーを見やすいベージュ帯に変更。
- 馬名、タグ、危険/穴/信頼ラベルの視認性を上げました。

### 7. 過去走比較・買い目・騎手一覧にも反映
- `past.js`、`betting.js`、`jockeys.js` の処理は変更せず、共通CSSで見た目を改善。
- 過去走カード、買い目カード、騎手カードの背景・ボーダー・余白を統一。

### 8. 推奨買い目ページの見た目を調整
- `recommended_bets.css` の内容は維持。
- `style.css` 側から全体トーンに合うように上書き調整。
- 推奨買い目ページ単体の機能やJSは変更していません。

### 9. スマホ表示の改善
- 760px以下、480px以下のメディアクエリを追加。
- ヘッダー、タブ、ボタン、カード、表の余白を調整。
- 横見切れを減らすため、主要コンテナに `min-width: 0` を追加。
- 横長表は既存通り横スクロール可能なまま、見た目だけ整えています。

## 修正した箇所

### 修正あり
- `static/style.css`
  - 末尾に見た目改善用CSSを追加。

### 内容は同梱のみで変更なし
- `index.html`
- `race_detail.html`
- `past_detail.html`
- `betting.html`
- `jockeys.html`
- `recommended_bets.html`
- `static/analysis_common.js`
- `static/index.js`
- `static/race.js`
- `static/past.js`
- `static/betting.js`
- `static/jockeys.js`
- `static/recommended_bets.js`
- `static/recommended_bets.css`

## 反映手順

1. zipを解凍
2. 中の `docs/` 配下を、現在のGitHub Pages用 `docs/` に上書き
3. ブラウザで `Ctrl + F5` で強制再読み込み
4. スマホ表示も確認

## 注意

- 今回は「既存機能を壊さない」ことを優先したため、JSのDOM構造や判定ロジックは変更していません。
- 表示順やHTML生成内容そのものを変える改修は次段階で行う方が安全です。
