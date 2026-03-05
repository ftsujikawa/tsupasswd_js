WebAuthn連携の安定化と対象サイト拡張を中心に改善したリリースです。  
特に、CSP制約下でのフック注入、一覧表示の安定性、認証起動フローの調整を行いました。

## ✨ 主な変更

### 1. WebAuthnフック方式を改善（CSP対策）
- inline script注入を廃止し、外部スクリプト注入へ変更
- 追加ファイル: `page-passkeys-demo-hook.js`
- CSPでフックが無効化される問題を回避

### 2. 対応ドメインを拡張
- `webauthn.io`
- `passkeys.io`
- `passkey.org`

`manifest.json` の `content_scripts.matches` / `web_accessible_resources.matches` を更新し、対象サイトで動作するよう調整。

### 3. パスキー一覧と選択UXを改善
- source表示を統一（`tsupasswd_core` / `windows_hello`）
- 選択時メッセージに `source / rpId / id末尾` を表示
- `passkeys-demo` 向けに username不一致ガードを追加
- `passkeys-demo` の2段階導線（`Use one button sign-in instead` → `Next`）に対応

### 4. 認証起動ロジックを調整
- 一覧選択後の認証起動をサイト特性に合わせて調整
- Shadow DOMを含むボタン探索を強化
- `tsupasswd_core` は WebAuthn ID強制注入対象外として扱う分岐を追加
- WebAuthn challenge不整合の発生を抑える方向で起動方式を見直し

### 5. 一覧取得の安定化
- ネイティブ取得処理にタイムアウトを追加
- 失敗時フォールバック分岐を整理し、「読み込み中」で固まるケースを軽減
- 例外時でもメニュー描画がエラー表示へ遷移するよう改善

## 📝 補足
- WindowsセキュリティのネイティブUI上の表示名はOS/ブラウザ実装依存のため、拡張側から任意表示はできません。
- 拡張メニュー内で source情報を明示し、利用中ソースを判別しやすくしています。
