# BridgeHost

Native Messaging host scaffold for `com.tsupasswd.bridge`.

## Build

```powershell
dotnet publish .\BridgeHost.csproj -c Release -r win-x64 --self-contained false
```

Output executable:

`bin\Release\net8.0-windows\win-x64\publish\tsupasswd-bridge-host.exe`

## Protocol

- Input: 4-byte little-endian length + UTF-8 JSON payload
- Output: 4-byte little-endian length + UTF-8 JSON payload

## Implement next

- Replace `HandleMessage` to call PasskeyManager side APIs
- Add request routing (register, authenticate, status, etc.)
- Add file logging (stderr or dedicated log file)

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
