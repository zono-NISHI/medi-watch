# -*- coding: utf-8 -*-
# 卒業論文要旨：「2. 開発環境」に、Android版の通知に使う Firebase Cloud Messaging を書き足した修正内容（記録）
# 元にしたファイル: docs/卒論(参考資料)/最新の卒論、要旨、パワポ/2370354_西薗正彦_卒業論文要旨.docx（11月18日版。2026-11-18_youshi.py を適用したもの）
# 使い方: python scripts/thesis/apply_edits.py <元.docx> <このファイル> <出力.docx>
# 理由: 開発環境には外部サービスとして Supabase・Brevo・Render が載っているが、サーバ（notificationService）が
#       firebase-admin で直接呼び出している FCM が載っていなかった（本文の表３.３には載っている）
# ※ このファイルは「11月18日版 → 11月18日版（その２）」の記録。これより新しい版を直すときは、新しい修正内容ファイルを作る

d.after('メール送信：Brevo（Supabase AuthのSMTPとして利用）',
        'メール送信：Brevo（Supabase AuthのSMTPとして利用）',
        ['通知配信：Firebase Cloud Messaging（Android版への通知）'])
