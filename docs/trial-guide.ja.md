# 試用ガイド（private 検証用）

v0.2.0 を実際の AI クライアントから試すための手順です。所要時間は 30〜60 分ほどです。
気づいた点は GitHub の Issue（テンプレート「試用フィードバック」）に記録してください。

## 0. 準備

- Godot 4.7（`godot --version` で確認）
- Node.js 20 以上
- MCP クライアント（Claude Code 推奨。Cursor / Claude Desktop / Codex / Hermes でも可）

```bash
gh repo clone AI-osho/godot-mcp-loop
cd godot-mcp-loop/server && npm ci && npm run build
```

## 1. デモプロジェクトで接続確認（5 分）

1. Godot で `godot-mcp-loop/project.godot` を開く（MCP Loop プラグインは有効化済み）。
2. クライアントに登録（例: Claude Code）:
   ```bash
   claude mcp add godot-loop -- node "$PWD/dist/index.js" --project "$(cd .. && pwd)"
   ```
3. AI に「godot_status を呼んで」と依頼 → `connected: true` と Godot のバージョンが返れば OK。

- [ ] 接続できた

## 2. シナリオテスト（5 分）

AI に次のように依頼します。

- 「`res://examples/platformer/scenarios/move_right.yaml` を scenario_run で実行して結果を教えて」 → PASSED になるはず
- 「`intentional_failure.yaml` も実行して、なぜ失敗したか説明して」 → 3 ステップ目で FAILED、実測値付き

- [ ] PASSED / FAILED のレポートが分かりやすい
- [ ] ゲームウィンドウが開いた場合、スクリーンショットが会話に表示された

## 3. 検証ループ（15 分）— 本命

AI に依頼:「プレイヤーに二段ジャンプを追加して。実装したら実際にゲームを動かして、二段目のジャンプで
さらに高く上がることを game_wait_for か scenario で確認して」

観察ポイント:

- [ ] `script_write` の前に差分を見せる／コンパイルエラーを自分で直す
- [ ] `game_run` → `game_input` → `game_query` / `game_wait_for` で自分の実装を確かめた
- [ ] うまくいかないとき `logs_read` や `screenshot` を使って原因を探した
- [ ] 最後に `edit_undo` で元に戻せる（試しに「今の変更を全部取り消して」と依頼）

## 4. 自分のプロジェクトで（15 分）

1. `addons/mcp_loop` を自分のプロジェクトの `addons/` にコピーし、プロジェクト設定 › プラグインで有効化
2. クライアント登録の `--project` を自分のプロジェクトに変更（または別名で追加）
3. AI に「このプロジェクトのシーン構成を説明して」→「◯◯を少し変更して動作確認して」と依頼

- [ ] 既存プロジェクトでも接続・編集・実行できた
- [ ] 想定外のファイル変更がなかった（`git status` で確認）
- [ ] オートロード `MCPLoopRuntime` が追加されたことを確認（プラグイン無効化で消えます）

## 5. 気になったら試してほしいこと（任意）

- エディタを再起動しても、AI 側はそのまま使い続けられるか（自動再接続）
- ゲームでスクリプトエラーを起こしたとき、AI がエラーに気づけるか
- 長い入力シーケンス（数秒の移動など）で問題がないか

## フィードバックに書いてほしいこと

- OS / Godot バージョン / 使用クライアント
- 依頼した内容と、AI がどのツールをどう使ったか
- 期待と違った点（エラーメッセージ、遅さ、分かりにくいツール説明など）
- 可能なら `logs_read source=editor` の出力
