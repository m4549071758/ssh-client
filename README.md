# SSH Client

Windows 向けのモダンな SSH / SFTP クライアント。Electron + React + TypeScript 製。

## 主な機能

- **複数セッション管理** — タブで複数の SSH 接続を並列維持
- **統合 SFTP ペイン** — ターミナルの隣でファイル操作 (D&D 再帰アップロード、衝突時に各ファイル個別の上書き / スキップ選択、コンテキストメニューによる削除 / 名前変更 / 移動 / コピー / プロパティ表示)
- **グローバル認証情報 Vault** — マスターパスワード + AES-256-GCM 暗号化、Windows Hello (PIN / 指紋 / 顔) でロック解除可
- **公開鍵認証** — 秘密鍵ファイル + パスフレーズ、Vault エントリ参照可
- **シンタックスハイライト** — Monaco エディタ内蔵 (VS Code と同じエンジン)
- **外部エディタ連携** — リモートファイルを Windows 既定アプリで開いて編集 → 保存時に SFTP 自動 put-back
- **日本語対応** — xterm.js + Unicode11 で CJK 幅を正しく描画
- **モダン UI** — Light / Dark / Solarized Dark テーマ、フォント変更可、選択範囲自動コピー、右クリックで貼り付け

## 必要環境

- Windows 10 / 11 (x64)
- Node.js 20 以上 (開発時)

## 開発

```powershell
git clone https://github.com/m4549071758/ssh-client.git
cd ssh-client
npm install
npm run dev
```

> Electron バイナリのダウンロードでアンチウイルスが展開を妨害することがあります。`Add-MpPreference -ExclusionPath "$PWD"` (管理者) や手動展開で回避できます。

## ビルド (配布用)

```powershell
# 両方
npm run package

# NSIS インストーラのみ (Program Files にインストール)
npm run package:nsis

# Portable 単一 exe (約 150MB)
npm run package:portable
```

成果物は `release/` フォルダに出力されます:
- `SSH Client-Setup-<version>-x64.exe` — インストーラ
- `SSH Client-Portable-<version>.exe` — 単一実行ファイル

> コード署名なしのため SmartScreen 警告が出ます (「詳細情報」→「実行」で起動)。

## 技術スタック

| 役割 | ライブラリ |
|---|---|
| デスクトップ | electron, electron-vite, electron-builder |
| UI | React 18, TypeScript, Tailwind CSS, Radix UI |
| ターミナル | xterm.js + addon-fit / unicode11 / web-links / search |
| SSH / SFTP | ssh2 (Node ネイティブ) |
| エディタ | @monaco-editor/react + monaco-editor |
| 状態管理 | zustand |
| 認証情報暗号化 | Node 標準 `crypto` (scrypt + AES-256-GCM) |
| Windows Hello | UserConsentVerifier (PowerShell ブリッジ) |

## ライセンス

MIT — [LICENSE](LICENSE) 参照。
