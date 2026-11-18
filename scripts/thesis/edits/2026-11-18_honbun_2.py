# -*- coding: utf-8 -*-
# 卒業論文本文：表３.２（システムの階層構成）のサービス層に、通知の送り先（Web Push／FCM）を書き足した修正内容（記録）
# 元にしたファイル: docs/卒論(参考資料)/最新の卒論、要旨、パワポ/2370354_西薗正彦_卒業論文本文.docx（11月18日版。2026-11-18_honbun.py を適用したもの）
# 使い方: python scripts/thesis/apply_edits.py <元.docx> <このファイル> <出力.docx>
# 理由: 表３.２には外部サービスとして Supabase・Render が載っているが、サーバ（notificationService）が
#       firebase-admin で直接呼び出している FCM が載っていなかったため
# ※ このファイルは「11月18日版 → 11月18日版（その２）」の記録。これより新しい版を直すときは、新しい修正内容ファイルを作る

# 3.3 表３.２
d.table(1, [
    ['フロントエンド', 'public/', 'HTML・CSS・JavaScriptによる画面。共通処理は config.js → api.js → ui.js → alarm.js の順に読み込み、画面に応じて validate.js・push.js・viewTarget.js を加える'],
    ['バックエンドAPI', 'src/routes/', 'auth・careGroups・medications・schedules・logs・push の６つのルートでREST APIを提供'],
    ['サービス層', 'src/services/', 'jahisParser（QR解析）・notificationService（通知送信。ブラウザ宛てはWeb Push、Android版宛てはFCM）・reminderCron（定期処理）'],
    ['共通基盤', 'src/supabase/ src/lib/ src/middleware/', 'Supabase接続クライアント・共通ユーティリティ（日本時間での日付計算など）・認証ミドルウェア'],
    ['Supabase', 'クラウド', 'PostgreSQL（データベース）・Auth（認証・メール確認）・Storage（映像保存）・RLS（行レベルセキュリティ）'],
    ['実行環境（ホスティング）', 'Render（クラウド）', 'Node.jsアプリケーションサーバの稼働環境。GitHubリポジトリと連携し、developブランチへのマージで自動的にデプロイする'],
    ['Android版', 'mobile/', 'Capacitorで public/ の画面を同梱したAndroidアプリ。服薬アラームのみJavaで実装'],
])
