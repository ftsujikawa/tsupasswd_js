# BridgeHost

`com.tsupasswd.bridge` の Native Messaging ホスト用スキャフォールドです。

## Build

```powershell
dotnet publish .\BridgeHost.csproj -c Release -r win-x64 --self-contained false
```

出力される実行ファイル:

`bin\Release\net8.0-windows\win-x64\publish\tsupasswd-bridge-host.exe`

## Protocol

- 入力: 4 バイト little-endian の長さ + UTF-8 JSON ペイロード
- 出力: 4 バイト little-endian の長さ + UTF-8 JSON ペイロード

## Implement next

- `HandleMessage` を PasskeyManager 側 API を呼び出す実装に置き換える
- リクエストのルーティングを追加する（register, authenticate, status など）
- ファイルログ出力を追加する（stderr または専用ログファイル）

## Implemented message types

- `ping`
- `get_status`
- `set_vault_locked`
- `set_silent_operation`
- `set_vault_unlock_method`
- `launch_app`
- `register_plugin`
- `update_plugin`

## Request examples

```json
{"type":"get_status","requestId":"req-1"}
```

```json
{"type":"set_vault_locked","value":true,"requestId":"req-2"}
```

```json
{"type":"set_silent_operation","value":false,"requestId":"req-3"}
```

```json
{"type":"set_vault_unlock_method","value":1,"requestId":"req-4"}
```

```json
{"type":"launch_app","executablePath":"C:\\Path\\To\\PasskeyManager.exe","arguments":"","requestId":"req-5"}
```

```json
{"type":"register_plugin","executablePath":"C:\\Path\\To\\PasskeyManager.exe","requestId":"req-6"}
```

```json
{"type":"update_plugin","executablePath":"C:\\Path\\To\\PasskeyManager.exe","requestId":"req-7"}
```

`register_plugin` / `update_plugin` は、PasskeyManager を起動して MainPage の
`ensure_plugin_registration` フローをトリガーする実装です。
