# SSH Client

Windows / macOS / Linux 向けのモダンな SSH / SFTP クライアント。Electron + React + TypeScript 製。

## 主な機能

- **複数セッション管理** — タブで複数の SSH 接続を並列維持
- **統合 SFTP ペイン** — ターミナルの隣でファイル操作 (D&D 再帰アップロード、衝突時に各ファイル個別の上書き / スキップ選択、コンテキストメニューによる削除 / 名前変更 / 移動 / コピー / プロパティ表示)
- **グローバル認証情報 Vault** — マスターパスワード + AES-256-GCM 暗号化、生体認証（Windows Hello / Touch ID）でロック解除可。Linux 環境ではパスフレーズロックのみ。
- **公開鍵認証** — 秘密鍵ファイル + パスフレーズ、Vault エントリ参照可
- **シンタックスハイライト** — Monaco エディタ内蔵 (VS Code と同じエンジン)
- **外部エディタ連携** — リモートファイルを既定アプリで開いて編集 → 保存時に SFTP 自動 put-back
- **日本語対応** — xterm.js + Unicode11 で CJK 幅を正しく描画
- **モダン UI** — Light / Dark / Solarized Dark テーマ、フォント変更可、選択範囲自動コピー、右クリックで貼り付け

## 必要環境

- Windows 10 / 11 (x64)
- macOS 11+ (Apple Silicon / Intel)
- Linux x64
- Node.js 20 以上 (開発時)

## 開発

```bash
git clone https://github.com/m4549071758/ssh-client.git
cd ssh-client
npm install
node node_modules/electron/install.js  # Electron 42+ ではバイナリ取得を手動実行する必要あり
npm run dev
```

> Electron 42 以降、`electron` パッケージは postinstall スクリプトを廃止し、バイナリのダウンロードがオンデマンド方式に変更されました。`npm install` 後に上記の `install.js` を一度実行してください。`node_modules/electron/dist/` が存在しない場合に必要です。

> Electron バイナリのダウンロードでアンチウイルスが展開を妨害することがあります。Windows の場合は `Add-MpPreference -ExclusionPath "$PWD"` (管理者) や手動展開で回避できます。

## ビルド (配布用)

### Windows

```bash
# NSIS インストーラ + Portable
npm run package

# NSIS インストーラのみ (Program Files にインストール)
npm run package:nsis

# Portable 単一 exe
npm run package:portable
```

成果物:
- `SSH Client-Setup-<version>-x64.exe` — インストーラ
- `SSH Client-Portable-<version>.exe` — 単一実行ファイル

> コード署名なしのため SmartScreen 警告が出ます (「詳細情報」→「実行」で起動)。

### macOS

```bash
npm run package:mac
```

成果物:
- `SSH Client-<version>-universal.dmg` — ディスクイメージ
- `SSH Client-<version>-universal.zip` — ZIP アーカイブ

> 未署名のため「開発元未確認」警告が表示されます。Finder 上でアプリを右クリック →「開く」を選択して起動してください。

### Linux

```bash
npm run package:linux
```

成果物:
- `SSH Client-<version>-x64.AppImage` — AppImage
- `SSH Client-<version>-x64.deb` — Debian パッケージ

成果物はすべて `release/` フォルダに出力されます。

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
| 生体認証 | Windows Hello (UserConsentVerifier) / macOS Touch ID (systemPreferences) |

## ライセンス

MIT — [LICENSE](LICENSE) 参照。
