# 導入診断 doctor の使い方

godot-mcp-loop **0.11.0** 以降の機能です。古い公開版には含まれません。
プロジェクトのアドオンと同じ版で使用します。版ずれは診断結果として表示し、勝手に修復しません。

## エディターを起動せずに調べる

版を固定したパッケージから実行します：

```sh
npx -y godot-mcp-loop@0.11.0 doctor /ABS/my-game
npx -y godot-mcp-loop@0.11.0 doctor /ABS/my-game --json
npx -y godot-mcp-loop@0.11.0 doctor /ABS/my-game --artwork --json
```

`npx` は事前準備としてパッケージや依存を取得・導入する場合があります。この明示的な準備操作と、
読み取り専用の診断そのものは別です。ビルド済みのソースから実行する場合：

```sh
node /ABS/godot-mcp-loop/server/dist/index.js doctor /ABS/my-game
node /ABS/godot-mcp-loop/server/dist/index.js doctor /ABS/my-game --json
node /ABS/godot-mcp-loop/server/dist/index.js doctor /ABS/my-game --artwork --json
```

空白を含むパスは引用符で囲みます。`doctor --help` で説明を表示できます。
`--fix`、任意の実行手順、サーバー起動用オプションは受け付けません。
これは通常の診断コマンドであり、MCP ツールではありません。MCP サーバーの登録コマンドには指定しません。

ローカル配布物を既存のグローバル導入とは別に使う場合：

```sh
npm install --prefix /ABS/doctor-check --ignore-scripts --no-audit --no-fund /ABS/godot-mcp-loop-0.11.0.tgz
node /ABS/doctor-check/node_modules/godot-mcp-loop/dist/index.js doctor /ABS/my-game --json
```

上の明示的な準備操作はパッケージと依存を導入しますが、doctor 自身は導入・修復しません。
クライアント登録、認証、グローバル設定の変更は不要です。

## 確認するもの

- Node.js 20 以上、対象の `project.godot` と静的な設定形式。
- アドオンの版と実行中のパッケージの版、宣言された入口、`plugin.gd` と
  `runtime/runtime_agent.gd` の存在と安全に検査できること。全アドオンのハッシュ照合やコンパイルではありません。
- `[editor_plugins] enabled=PackedStringArray(...)` に正確なプラグインパスが含まれること。
- 既存の探索処理と、固定引数 `--headless --version` による Godot の版確認。
  報告された 4.7.2 stable のみ検証済み版と区別し、他の版・先行版は未確認とします。
- `--artwork` を付けたときだけ、選択した Python が 3.11 以上で Pillow 13.0.0 を読み込めること。
  付けなければ Python は起動せず、任意項目の未実施を全体の失敗にはしません。

探索対象は、このコマンドを実行した環境の `PATH` / `GODOT_BIN` / `GODOT_LOOP_PYTHON` です。
MCP クライアントの保存済み設定や、すでに起動中の別サーバーの環境は読み取りません。
版の自己申告が一致することは、実行ファイルそのものの真正性を保証しません。

## 結果の読み方

JSON の `schema_version` は 1、`scope` は `static_installation_only` です。
各確認項目は `id`、`status`、`code`、`message` と、必要に応じて `hint` / `required` を持ちます。
自動処理では英文の説明ではなく、固定された `code` で判別してください。
安全に読めない設定では後続の確認を省略するため、項目の数・ID は固定ではありません。

- `ok`：今回要求した静的な確認は成功。接続やゲームの正常動作を保証するものではありません。
- `problem`：少なくとも一つ、具体的な不足や不一致を検出しました。
- `not_checked`：具体的な問題はありませんが、必須の確認に判別不能・未検証の項目が残っています。
- `required: false`：指定されなかった任意項目で、全体判定から除外します。
- `runtime` は必ず `{ "status": "not_checked", "code": "RUNTIME_NOT_CHECKED" }` のままです。

終了値は、静的な `ok` が 0、`problem` または必須の `not_checked` が 1、引数間違いが 2 です。
通常表示には次の手動操作と未確認事項を示します。JSON は標準出力だけに出し、調査した設定本文・生の子プロセス出力・
例外全文は出しません。不明な引数の値も表示しません。

| 主なコード | 次の手動操作（doctor は実行しません） |
|---|---|
| `PROJECT_NOT_FOUND` / `PROJECT_UNREADABLE` | 安全に読める `project.godot` があるフォルダを指定します。 |
| `ADDON_NOT_INSTALLED` | 既存作業を保全し、同じ版の `install-addon` で導入します。 |
| `ADDON_VERSION_MISMATCH` | サーバーとアドオンの版を揃えます。最初から強制上書きしません。 |
| `ADDON_UNREADABLE` / `ADDON_FILES_MISSING` | 権限・リンク・不足を調べ、保全後に導入し直します。 |
| `ADDON_METADATA_UNREADABLE` / `ADDON_ENTRY_UNVERIFIED` | 重複・独自のアドオン設定を確認します。独自スクリプトは実行しません。 |
| `ADDON_NOT_ENABLED` | プロジェクト設定のプラグイン欄で MCP Loop を有効化します。 |
| `PROJECT_CONFIG_UNSUPPORTED` | 信頼できるエディターで重複や未対応の設定形式を確認・正規化します。 |
| `NODE_UNSUPPORTED` | Node.js 20 以上を使います。 |
| `GODOT_NOT_FOUND` | 信頼できる Godot 実行ファイルを `GODOT_BIN` で選びます。 |
| `GODOT_VERSION_UNVERIFIED` | 検証済みの stable 版を使うか、その版を別途検証します。 |
| `ARTWORK_NOT_REQUESTED` | PNG 制作機能を使わなければ操作不要です。 |
| `PYTHON_UNSUPPORTED` / `PILLOW_VERSION_MISMATCH` / `ARTWORK_PROBE_FAILED` | 信頼できる Python 3.11 以上・Pillow 13.0.0 の環境を用意し、`GODOT_LOOP_PYTHON` で選びます。 |

## 安全性と限界

エディターの起動・終了、資源の読み込み、接続、プロジェクトのコード読み込み・コンパイル、セッション情報や認証情報の収集、
プロジェクトの変更、画像生成・画像サービス呼び出しは行いません。
ただし、選択した Godot の版確認コマンドと、任意指定時の Python/Pillow は実行します。
導入済みの実行ファイルや Python の起動時・追加パッケージは信頼対象です。環境変数は少数の許可項目に限定しますが、
OS の隔離や、子孫プロセス全体の封じ込めを提供するものではありません。

読み取りは有界です（プロジェクト設定は 1 MiB、アドオン設定は 64 KiB）。
選択したルート以下のシンボリックリンクや、複数のハードリンクを持つ末端ファイルは拒否します。
明示的に選択したルートフォルダ自体の別名は許容します。
設定は Object/Resource を評価せず、対応外・曖昧な形式を未確認とします。
構文の空白は ASCII の半角空白・タブ・CR・LF に限定し、引用文字列やコメントの外にある NBSP・全角空白等を
正常なキーや値へ変換しません。この場合は `not_checked` とします。引用内の日本語や空白は値のまま保全します。
ProjectSettings と同様にプロジェクト先頭の BOM 一つは扱えますが、ConfigFile 形式のアドオン設定の先頭 BOM は
未確認とし、版一致を推測で報告しません。
上限は入れ子 64 段、設定文 4096 件、有効プラグイン 1024 件です。
Godot の版確認は合計 5 秒の直接プロセス予算内で最大 4 回、任意の Python 確認は直接プロセスに 5 秒の上限があります。
同じユーザーによる競合したファイル差し替え、不正な実行ファイルやその子孫までの無条件な安全保証ではありません。

静的な合格は、アドオン全体の完全性、資源の読み込み完了、エディター接続、ゲーム動作、画像処理の品質、認証・課金・権利の
確認ではありません。実接続は、エディターとクライアントを起動すると判断した後で `godot_status` 等で別に確かめます。
OS ごとの実行確認範囲はリリース監査と CI を参照してください。全 OS の安全性を保証するものではありません。
