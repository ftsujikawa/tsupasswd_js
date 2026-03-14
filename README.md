# tsupasswd_js

Native Messaging を使って PasskeyManager と連携するための Chrome 拡張（Manifest V3）スキャフォールドです。

現在は以下の 2 系統の Native Host を併用します。

- `com.tsupasswd.bridge`: 既存の passkey bridge host
- `dev.happyfactory.tsupasswd_core`: PasskeyManager 本体の Vault host

## Files

- `manifest.json`: 拡張機能の定義
- `background.js`: Native Messaging 接続とリレー
- `popup.html` / `popup.js`: passkey 一覧 + Vault login 管理 UI
- `native-host/com.tsupasswd.bridge.json`: ネイティブホストのマニフェストテンプレート
- `native-host/dev.happyfactory.tsupasswd_core.json`: Vault host のマニフェストテンプレート
- `install-native-host.ps1`: AppData 配置 + レジストリ登録スクリプト（Windows）

## Load extension

1. `chrome://extensions` を開く
2. **デベロッパーモード**を有効化する
3. **パッケージ化されていない拡張機能を読み込む** をクリックする
4. `C:\AppPackages\tsupasswd_js` を選択する

## Register native host (Windows)

PowerShell で次を実行します（現在のユーザー）:

```powershell
powershell -ExecutionPolicy Bypass -File C:\AppPackages\tsupasswd_js\install-native-host.ps1
```

このスクリプトは以下を実行します:

- bridge host 実行ファイル一式を `%LOCALAPPDATA%\tsupasswd\bridge-host` にコピー
- `%LOCALAPPDATA%\tsupasswd\com.tsupasswd.bridge.json` を生成
- `%LOCALAPPDATA%\tsupasswd\dev.happyfactory.tsupasswd_core.json` を生成
- `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.tsupasswd.bridge` を登録
- `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\dev.happyfactory.tsupasswd_core` を登録

## Important

- `native-host/com.tsupasswd.bridge.json` 内の `allowed_origins` の拡張機能 ID を置き換える
- `path` が実際のブリッジ実行ファイルを指すようにする
- `native-host/dev.happyfactory.tsupasswd_core.json` の `path` が `tsupasswd_core.exe` を指すようにする
- ネイティブホスト実行ファイルは stdin/stdout で「長さプレフィックス付き JSON」を read/write できる必要がある
- パスキー一覧に表示されるのは `tsupasswd_core` と `Windows Hello` から取得できた項目のみ
- `Google パスワード マネージャー` に保存されたパスキーは、この拡張の一覧には含まれない

## Popup でできること

- passkey bridge host への接続確認
- passkey 一覧の表示
- Vault host への接続確認
- Vault login の status / list / save / update / delete / resync

## Bridge host scaffold (created)

`native-host/BridgeHost` に C# の Native Messaging ホスト雛形を作成済みです。

ビルド:

```powershell
dotnet publish C:\AppPackages\tsupasswd_js\native-host\BridgeHost\BridgeHost.csproj -c Release -r win-x64 --self-contained false
```

発行（publish）出力:

`C:\AppPackages\tsupasswd_js\native-host\BridgeHost\bin\Release\net8.0-windows\win-x64\publish\tsupasswd-bridge-host.exe`

## Next step

PasskeyManager の API を呼び出すために、`native-host/BridgeHost/Program.cs` にリクエストルーティングを実装します。

## 変更履歴（2026-03-05）

コミット: `950fca9`
メッセージ: `Fix WebAuthn flow handling across demo and test sites`

### 1) WebAuthnフック方式を改善（CSP対策）

- inline script 注入を廃止し、外部スクリプト注入へ変更
- 追加ファイル: `page-passkeys-demo-hook.js`
- 目的: CSPによりフックが無効化される問題を回避

### 2) 対応ドメインを拡張

- `webauthn.io`
- `passkeys.io`
- `passkey.org`
- `passkeys-demo.appspot.com`
- `manifest.json` の `content_scripts.matches` / `web_accessible_resources.matches` を調整

### 3) パスキー一覧と選択動作の改善

- source表示を統一（`tsupasswd_core` / `windows_hello`）
- 選択時メッセージに `source / rpId / id末尾` を表示
- `passkeys-demo` では username 不一致時のガードを追加
- `passkeys-demo` のボタン導線（`Use one button sign-in instead` → `Next`）対応を追加

### 4) 認証起動ロジックの調整

- 一覧選択後の認証起動をサイト別に調整
- Shadow DOMを含むボタン探索を強化
- `webauthn.io` 系は challenge 不整合が起きにくいよう起動方式を調整
- `tsupasswd_core` は WebAuthn ID強制注入対象外として扱う分岐を追加

### 5) 一覧取得の安定化

- ネイティブ取得処理にタイムアウトを追加
- 失敗時のフォールバック分岐を見直し、「読み込み中」で固まるケースを軽減
- 例外時でもメニュー描画がエラー表示へ遷移するよう改善
