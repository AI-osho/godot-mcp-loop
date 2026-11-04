# 空シーンへの2D/UI一括追加（0.12.0から）

`node_add_tree`は0.12.0から利用可能です。従来のnpm0.11.0には含まれません。サーバーとアドオンは同じ選択済み配布物から揃えます。公開・導入だけでは既存MCP登録や実行中のクライアントは更新されないため、必要な再接続は利用者が明示的に行います。

ノードの構造・初期設定をまとめる機能であり、ゲームのルール、絵、音、完成した画面配置を自動生成するものではありません。制作時間や料金の削減倍率は、比較測定なしに主張しません。

## 基本の流れ

1. `scene_create` で空の作業シーンを作るか、条件に合う既存の空シーンを明示して開きます。
2. `node_add_tree` の `dry_run: true` で全件検査します。
3. 予定一覧を確認し、`dry_run: false` で再検査・適用します。
4. 保存は別の `scene_save` で行います。
5. 必要なスクリプトを既存ツールで取り付け、ゲームを起動して通常入力・画面・ログを確認します。

プレビューは予約ではありません。適用時にも、編集中のルート、保存先、空の状態、履歴を確認し直します。勝手にシーンを開く・切り替える・空にする・保存する機能はありません。

## 入力

必須項目は `schema_version: 1`、`scene: "res://...tscn"`、`nodes` です。`dry_run` はbooleanで、省略時false。未知の項目は捨てずに拒否します。

各ノードは次の項目を持ちます。

- `id`：要求内で一意。`^[a-z][a-z0-9_]{0,31}$` に合う文字列をそのまま使用します。
- `parent_id`：先頭には付けず、2件目以降は必須。先に登場したidのみ参照できます。
- `type`：下記のGodot組み込み型。
- `name`：UTF-8で64バイト以内のリテラル名。日本語・絵文字を使用できます。不正なGodot名、曖昧なパス、制御文字、前後の空白は、勝手に直さず拒否します。
- `properties`：許可された初期値のオブジェクト。省略時は空です。

先頭が新規ツリーの唯一のトップで、Node2DまたはControlに限定します。既存の空シーンルート直下へ追加し、既存ノードの親パスは指定できません。

```json tool=node_add_tree
{
  "schema_version": 1,
  "scene": "res://scenes/new_stage.tscn",
  "dry_run": true,
  "nodes": [
    {"id":"content","type":"Node2D","name":"Content"},
    {"id":"player","parent_id":"content","type":"CharacterBody2D","name":"Player","properties":{"position":[120,160]}},
    {"id":"collision","parent_id":"player","type":"CollisionShape2D","name":"Collision","properties":{"shape":{"new":"RectangleShape2D","properties":{"size":[24,32]}}}},
    {"id":"visual","parent_id":"player","type":"Sprite2D","name":"Visual","properties":{"texture":{"res":"res://assets/hero.png"}}},
    {"id":"camera","parent_id":"player","type":"Camera2D","name":"Camera","properties":{"zoom":[1,1]}}
  ]
}
```

指定した空シーンと、インポート済みのPNGを先に用意してください。この例は入力契約の例であり、ファイルが既に存在するという実行結果ではありません。

## 対象シーンの条件

指定した `scene` が現在編集中である必要があります。保存可能な `.tscn` の保存先を持ち、通常のNode2DまたはControlルートで、スクリプト、既存の子（内部ノードを含む）、継承・インスタンスのルートを持たないことが条件です。ルートの既存プロパティは設定しません。

過去からある空シーンも条件を満たせば使用できます。「今回作成した新規ファイル」であることを履歴認証する機能ではありません。

新規ノードを本編から切り離して準備し、適用直前に同じルートオブジェクト・保存先・空状態・履歴か確認します。検証中に人が行った編集は保全し、勝手に巻き戻しません。

## 対応する19種類

Node、Node2D、CharacterBody2D、StaticBody2D、Area2D、Sprite2D、CollisionShape2D、Camera2D、CanvasLayer、Control、ColorRect、Label、Button、PanelContainer、MarginContainer、VBoxContainer、HBoxContainer、CenterContainer、GridContainer。

詳細なプロパティ名・型・範囲は、同梱の `tree_build_policy.json` がTypeScript/Godot共通の正本です。主な範囲は次の通りです。

- 2Dの位置・回転・拡大率・表示・描画順、該当する当たり判定の層とマスク。
- Sprite2DのPNG、オフセット、中央寄せ、反転、色。CollisionShape2Dの形状・無効化。Camera2Dの有効化・拡大・平滑化。
- CanvasLayerの層・表示。
- Controlのアンカー、オフセット、最小サイズ、サイズフラグ、マウスフィルター、表示。
- Label/Buttonのテキスト、一部の文字サイズ・色・整列・折返し。
- PanelContainerのスタイル、MarginContainerの余白、BoxContainerの間隔、GridContainerの列数・間隔。

`name`、`owner`、`script`、シーン・Resourceのパス、metadata、コロンによる部分参照、任意のノード参照はプロパティ指定できません。

## 値と組み込み素材

数値は有限で、整数・列挙値は整数、booleanはbooleanに限定します。従来ツールと違い、`"120"` や `"[10,20]"` を数値・ベクトルへ自動変換しません。Vector2は数値2要素、色は `#RRGGBB` / `#RRGGBBAA` または0〜1の数値3/4要素です。文字列はそのまま保持します。NULと不正なサロゲート列は対象外です。

新規組み込み素材は次に限定します。

- RectangleShape2D：`size`
- CircleShape2D：`radius`
- CapsuleShape2D：`radius`、`height`。省略されたネイティブ既定値を含め、高さは直径以上。
- StyleBoxFlat：限定した背景色・枠色・枠幅・角半径・内側余白。

形式は `{"new":"RectangleShape2D","properties":{"size":[24,32]}}` です。同じ指定を繰り返しても、それぞれ独立して生成します。共有idや循環参照は指定できません。

外部参照は `{"res":"res://assets/image.png"}` のTexture2Dのみです。Script、Shader、シーン、`.tres`、`.res` は参照できません。画像と付随メタデータのパス・リンク、PNGヘッダー・IHDRの形式とCRC・寸法、現在の元画像チェックサム、ネイティブの読み込み先を確認してから読みます。古い・不足したインポートを待機・自動修復しません。

ネイティブのチェックサムメタデータは、画像から導いた内部パスだけを読みます。任意の `.godot` パスを呼び出し側へ開放しません。同一ユーザーによる悪意あるキャッシュの同時改変や、第三者インポーターをOSサンドボックス化する保証ではありません。

## 1要求の上限

- 64ノード、深さ8（新規トップを1として数える）。
- 1ノード32項目、組み込み素材の項目も含め計512項目。
- 組み込み素材64個、入れ子の上限4。初版の素材項目自体は数値・色・ベクトル等のみです。
- 通常配列64要素、文字列2048バイト、名前64バイト、パス1024バイト。
- 要求と成功応答は、それぞれUTF-8で128 KiB。
- PNGは異なるパス16件、各8 MiB、各辺4096以下、全画像の合計16,000,000ピクセル以下。

ノードの実体化・画像読み込み・結果返却の前に上限を検査します。Godot全体のメモリー、他のプラグイン、長期間の履歴の累積を制限するものではなく、人の履歴や古いログを自動消去しません。

## 結果と失敗時の判断

成功JSONには `schema_version`、`scene`、`dry_run`、`applied`、`disk_saved`、`planned_count`、`created_count`、`undo_action` と、`planned_nodes` または `created_nodes` が入ります。各行はid・型・シーン相対パスを持ち、宣言件数と全行を要求に照合してから成功を返します。

- プレビュー：`applied=false`、`created_count=0`、`undo_action=null`。
- 追加確認済み：`applied=true`、実作成数、確認済みのMCP履歴名。
- `disk_saved`：常にfalse。追加できたことと保存できたことは別です。

ツール内で扱う失敗は `isError: true`、有界なテキストと `structuredContent` で返します。適用前の既知の拒否は `applied=false` / `created_count=0`。送信後の不明な結果では両方をnullにします。`error` には固定のcode・説明・次の操作が入り、利用可能な場合は許可されたフィールド位置を付けます。下位の生メッセージや入力本文を丸ごと転記しません。

SDKの入力スキーマで拒否された場合は、ツール処理が始まる前の標準MCP引数エラーになることがあります。

主なcode：TREE_POLICY_INVALID、INVALID_TREE_PLAN、SCENE_TARGET_MISMATCH、SCENE_NOT_EMPTY、UNSUPPORTED_NODE_TYPE、UNSUPPORTED_PROPERTY、RESOURCE_NOT_READY、PATH_FORBIDDEN、TREE_BUILD_VALIDATION_FAILED、TREE_BUILD_STATE_UNCERTAIN、BUSY、TIMEOUT、DISCONNECTED。

通信切断・タイムアウト・適用確認不能の後は、`scene_tree` とGodotの履歴を確認してください。自動再送や、不明な操作の自動取り消しは行いません。

## 取り消し・保存・画面配置

直後であれば、一つの `edit_undo` で新規ツリー全体を外せます。深い階層もすべて編集中ルートをownerとし、ネイティブのやり直しでも再設定します。後から人が編集すればMCP取り消しを拒否します。後続のスクリプトやファイル編集は別の操作です。新しい公開redoツールは追加しません。

空ファイルの作成、一括追加、保存は別工程です。取り消しても先に作成した空の `.tscn` は削除しません。保存後に取り消した場合も、ディスク反映には改めて保存が必要です。複数ファイルの完全な取引や、クラッシュ時の完全復元は保証しません。

切り離した状態で読み戻し、不正な値の検出可能な補正を拒否します。テーマ・折返し・形状をテキストより先に設定しますが、Containerやテーマはシーン接続後に配置を確定する場合があります。プレビューだけで画面の見切れ・重なりの合格とはせず、`game_ui_audit`・実画像・通常入力で別に確認してください。

初期のネイティブ開発確認はmacOS / Godot4.7.2です。別のOSは候補版の検証記録を確認し、macOSの結果だけでLinuxやWindowsを検証済みとしないでください。
