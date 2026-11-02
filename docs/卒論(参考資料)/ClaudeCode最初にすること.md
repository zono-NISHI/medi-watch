# Claude Code 最初にすること（Windows / VS Code）

VS Code のターミナルで `claude` と打って「用語 'claude' は、コマンドレット…として認識されません」と出たら、Claude Code がまだインストールされていない（または PATH が通っていない）状態です。以下の手順で使えるようにします。

---

## 1. Git for Windows を入れる（未インストールの場合）

Windows で Claude Code を動かすときは Git for Windows を入れておくことが強く推奨されています。

```powershell
winget install Git.Git
```

---

## 2. Claude Code 本体をインストール

VS Code のターミナル（PowerShell）で、次のどちらかを実行します。

**公式インストーラー（推奨）**

```powershell
irm https://claude.ai/install.ps1 | iex
```

Node.js・npm・PATH の手動設定は不要で、自動アップデートも付いています。

**winget を使う場合**

```powershell
winget install Anthropic.ClaudeCode
```

> ⚠ `irm ... | iex` は PowerShell 専用のコマンドです。コマンドプロンプト（CMD）では動きません。

---

## 3. ターミナルを開き直す（重要）

インストール直後のターミナルは、まだ新しい PATH を読み込んでいません。

1. VS Code のターミナルをゴミ箱アイコンで閉じ、新しく開き直す
2. それでもダメなら VS Code 自体を再起動する

開き直したら次を実行します。

```powershell
claude --version
cd C:\Users\nomik\dev\medi-watch
claude
```

初回起動時はブラウザでログイン画面が開きます。
ログインには Claude の有料プラン（Pro / Max など）または API アカウントが必要です。

---

## 4. それでも「認識されません」と出る場合

インストーラーは通常 `C:\Users\nomik\.local\bin\claude.exe` に本体を置きます。
このフォルダが PATH に入っていない可能性があるので、次を実行してからターミナルを開き直してください。

```powershell
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:USERPROFILE\.local\bin", "User")
```

---

## おまけ：VS Code 拡張機能

VS Code の拡張機能マーケットプレイスで「**Claude Code**」（発行元：Anthropic）を検索してインストールすると、エディタ画面からも Claude Code を使えるようになります。

---

## 参考リンク

- 公式セットアップ手順: https://docs.claude.com/en/docs/claude-code/setup
- Native installer guide: https://claudefa.st/blog/guide/native-installer
- Install Claude Code on Windows: https://claw.aguidetocloud.com/anthropic/claude-code/install-windows/
