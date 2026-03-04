# tsupasswd_js

Native Messaging を使って PasskeyManager と連携するための Chrome 拡張（Manifest V3）スキャフォールドです。

## Files

- `manifest.json`: 拡張機能の定義
- `background.js`: Native Messaging 接続とリレー
- `popup.html` / `popup.js`: 簡易テスト UI
- `native-host/com.tsupasswd.bridge.json`: ネイティブホストのマニフェストテンプレート
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
- `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.tsupasswd.bridge` を登録

## Important

- `native-host/com.tsupasswd.bridge.json` 内の `allowed_origins` の拡張機能 ID を置き換える
- `path` が実際のブリッジ実行ファイルを指すようにする
- ネイティブホスト実行ファイルは stdin/stdout で「長さプレフィックス付き JSON」を read/write できる必要がある

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
