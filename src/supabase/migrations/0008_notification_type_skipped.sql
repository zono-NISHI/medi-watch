-- ============================================================
--  0008_家族へのお知らせに「スキップ」の種類を追加
--  実行場所: Supabase ダッシュボード > SQL Editor
--  （0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 の後に実行してください）
-- ============================================================
--
--  背景:
--    これまで、本人が「今回はスキップする」を押したときも、記録が無いまま30分たったときと
--    同じ「飲み忘れの可能性」（medication_missed）の通知を家族へ送っていた。
--    スキップは本人が選んだことなので、家族には「スキップ」として伝える（medication_skipped）。
--    記録が無いときの通知も、「飲み忘れ」と決めつけない「まだお薬の記録がありません」に変えた
--    （文言はサーバーの src/services/notificationService.js で作るので、ここでは変えない）。
--
--  このマイグレーションで行うこと:
--    notification_logs.type の CHECK 制約に 'medication_skipped' を追加する。
--    （0001 では列に直接 CHECK を書いたため、制約の名前は PostgreSQL が自動で付けている。
--      名前に頼らず、medication_missed を含む CHECK 制約を探して作り直す）
--
--  実行しないままサーバーを更新した場合も、通知そのものは届く。
--  スキップの通知を送ったという記録（notification_logs）だけが残らない。
--  何度実行しても同じ結果になるように書いてある。
-- ============================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.notification_logs'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%medication_missed%'
  LOOP
    EXECUTE format('ALTER TABLE public.notification_logs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_type_check CHECK (type IN (
    'medication_reminder',  -- 服薬リマインド（患者本人宛）
    'medication_taken',     -- 服薬完了通知（家族宛）
    'medication_missed',    -- 記録が無いまま時刻を過ぎたときの通知（家族宛。「まだお薬の記録がありません」）
    'medication_skipped',   -- 本人がスキップしたときの通知（家族宛）
    'video_recorded'        -- 映像記録完了通知（家族宛）
  ));
