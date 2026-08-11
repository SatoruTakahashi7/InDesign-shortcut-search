# ショートカット検索 JSX版 v1.0.5

`ショートカット検索.jsx`だけで動作する単体版です。

GitHub: [SatoruTakahashi7/InDesign-shortcut-search](https://github.com/SatoruTakahashi7/InDesign-shortcut-search)

## 主な機能

- プリセット／ユーザー`.indk`の検出と任意ファイル読込
- コマンド名・キー・機能エリアの検索
- 対応するInDesignコマンドの実行
- モーダル画面によるショートカット記録
- ショートカットの追加、競合置換、個別削除、保存前の変更取り消し
- プリセットは別名保存、ユーザーセットは上書き
- ウィンドウサイズと「設定済みのみ」の状態を次回起動時に復元

## v1.0.5の主な変更

- 現在のスクリプトパネルを読み込み、後から追加したスクリプトも検索・割り当て対象に追加
- InDesign標準画面に近い「割り当て」「削除」「保存」「変更を取り消す」の操作方式へ変更
- InDesign 2026へ対応

## 注意事項

- 本スクリプトの読み取り結果および使用結果について、正確性・完全性・動作継続性は保証できません。
- 本スクリプトの利用により生じたデータの破損・損失、その他の損害について、制作者は責任を負いません。
- 必ず対象データとショートカットセットのバックアップを作成し、利用者自身の責任で使用してください。
- セット一覧から現在適用中のセットを自動判定する公開APIはないため、対象セットを画面上部で選択してください。
- action-idがセッションごとに変わるスクリプト項目は、安全上「コマンドを実行」の対象外です。ショートカットの表示・編集は可能です。
- `.indk`更新後は`app.applyShortcutSet()`で保存先セットを適用します。
- 構文と書換えロジックは確認済みですが、InDesign上のScriptUI表示、キー記録、保存、再適用は実機確認が必要です。

## Credits

- Planning / testing / direction: GYAHTEI Design Laboratory @gyahtei_satoru
- Development support: Codex

## Repository

[SatoruTakahashi7/InDesign-shortcut-search](https://github.com/SatoruTakahashi7/InDesign-shortcut-search)
