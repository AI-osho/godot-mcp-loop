# はじめに

[English](getting-started.md) · [作品と操作](samples.ja.md) · [構成と仕組み](architecture.ja.md)

ゲームを試すだけなら、まず単体で遊べます。AIから編集・試験するときだけMCPを追加します。
遊ぶためにアドオン、クライアント登録、画像生成サービスを設定する必要はありません。

## 配布状態

| 配布物 | MCPツール | サンプルの範囲 |
|---|---|---|
| 現行npm **0.12.0** | **49** | 紹介6作品と内部の互換・試験用シーン |
| 従来npm **0.11.0** | **48** | 配布名marble-3d。node_add_treeは含まない |

原画・素材制作ツールは**0.10.0**から公開済みです。静的診断doctorは**0.11.0**からのCLIであり、MCPツールの追加ではありません。
同じ版表示だけではソース版と公開パッケージの中身の一致を証明できず、ソースの存在は公開承認とも別です。
サーバーはNode.js20以降、Godot4.7を検証対象とし4.7.2で確認しています。任意のPython/Pillowは遊ぶためには不要です。

## 1. 作品を選んでコピー・起動

blocks / shooter / action / rpg / marble-3d / tower-defenseから選び、新しい空きフォルダーへコピーします。例：

```sh
npx -y godot-mcp-loop@0.12.0 sample shooter ./my-shooter
godot --headless --path ./my-shooter --import
godot --path ./my-shooter
```

CLIは中身のあるフォルダーを拒否します。初回importで素材とクラスキャッシュを準備します。
プロジェクトマネージャーからproject.godotを開き、import完了後にF5で起動してもかまいません。
[作品ごとの操作・再挑戦](samples.ja.md)。遊ぶためのアドオン・MCP登録・画像生成サービスは不要です。

`npx -y godot-mcp-loop@0.12.0 sample`は内部platformerを含む実配布名を表示します。作品紹介は6本で、内部シーンは別扱いです。
ソースから使う場合はserver/でnpm ciとnpm run buildを行い、server/dist/index.jsの絶対パスを指定します。
導入・接続もそのビルドを使い、版表示が同じという理由で公開パッケージへ置き換えないでください。

## 2. AI編集は別途、有効にする

ここからは対象プロジェクトを変更します。作業を保全し、導入を承認してから実行してください。

```sh
npx -y godot-mcp-loop@0.12.0 install-addon ./my-shooter
```

サーバーとアドオンは同じ選択済み配布物から揃え、インストーラーが示す実行ファイルで
[クライアント登録](clients.md)を別途承認・実施します。ソース版はそのビルドのinstall-addonと接続先を使います。
--forceは既存内容の置換なので通常の修復手順にはしません。開いていたエディタは再読込します。
導入やビルドだけで、接続中のサーバーが自動再起動されるわけではありません。

## 3. 状態を観察し、既存の検査を再生する

最初はgodot_statusで、選択中のプロジェクトを確認します。
以下は単体shooterを対象にしたMCP呼び出しで、シェルのコマンドではありません。

```text
game_run {"scene":"res://examples/shooter/shooter.tscn"}
game_input {"steps":[{"action":"shooter_start","hold_ms":80}]}
game_query {"node":".","properties":["state","score","lives","wave"]}
logs_read {"source":"game","min_level":"error"}
scenario_run {"path":"res://examples/shooter/scenarios/4_boss_clear.yaml","save_to":"res://qa/evidence/first-check"}
```

取得値は実際のルートスクリプトにあるプロパティです。ボスのシナリオは条件を固定して再起動する試験であり、
通常操作で全編を完走した証拠とは扱いません。返却された判定と保存レポートを確認し、本文だけで成功を決めません。
編集ではscene_treeを確認し、対応する小変更を事前確認してから適用し、保存は明示的に行います。
別のゲームにノード名や画面座標をそのまま流用しないでください。

## 4. エディタを起動せず、MCP設定を診断する

コピーの親フォルダーから次を実行できます。

```sh
npx -y godot-mcp-loop@0.12.0 doctor ./my-shooter --json
```

ソース導入には、同じローカルCLIのdoctorを使います。静的な設定と信頼する実行ファイルを調べますが、接続・起動・導入・修復はしません。
遊ぶだけのプロジェクトにアドオンがなくても問題ありません。静的okは実行時の接続成功ではなく、runtimeはnot_checkedです。
[診断コード](doctor.md)。npxによるパッケージ準備時のダウンロードは、診断処理とは別です。

## 検証と信頼の前提

制御用フックより先に通常の操作・再挑戦を確認します。headless成功は見た目の評価ではなく、画像は音や遊び心地を証明しません。
状態、エンジンのエラー、画面、PCM、人の承認を分けます。プロジェクトやプラグインはOS利用者の権限で動き、OS隔離ではありません。
[安全性](security.md) · [シナリオ](scenarios.md) · [変更点と正本](sample-upgrades.ja.md)。
