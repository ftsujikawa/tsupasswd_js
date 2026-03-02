# tsupasswd_js

Chrome Extension (Manifest V3) scaffold for integrating with PasskeyManager using Native Messaging.

## Files

- `manifest.json`: extension definition
- `background.js`: Native Messaging connection and relay
- `popup.html` / `popup.js`: quick test UI
- `native-host/com.tsupasswd.bridge.json`: native host manifest template

## Load extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `C:\\AppPackages\\tsupasswd_js`

## Register native host (Windows)

Create this registry key (Current User):

`HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.tsupasswd.bridge`

Set default value to:

`C:\\AppPackages\\tsupasswd_js\\native-host\\com.tsupasswd.bridge.json`

## Important

- Replace `allowed_origins` extension ID in `native-host/com.tsupasswd.bridge.json`
- Ensure `path` points to your real bridge executable
- Native host executable must read/write length-prefixed JSON on stdin/stdout

## Bridge host scaffold (created)

`native-host/BridgeHost` に C# の Native Messaging ホスト雛形を作成済みです。

Build:

```powershell
dotnet publish C:\AppPackages\tsupasswd_js\native-host\BridgeHost\BridgeHost.csproj -c Release -r win-x64 --self-contained false
```

Publish output:

`C:\AppPackages\tsupasswd_js\native-host\BridgeHost\bin\Release\net8.0-windows\win-x64\publish\tsupasswd-bridge-host.exe`

## Next step

Implement request routing in `native-host/BridgeHost/Program.cs` to call PasskeyManager APIs.
