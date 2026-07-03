-- ============================================================
--  電子お薬手帳 Webアプリ — Supabase DBマイグレーション
--  実行場所: Supabase ダッシュボード > SQL Editor
-- ============================================================


-- ============================================================
-- 0. 拡張機能の有効化
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()


-- ============================================================
-- 1. PROFILES（ユーザープロフィール）
--    Supabase Auth（auth.users）の拡張テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('patient', 'caregiver')),
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE  public.profiles            IS 'Supabase Auth のユーザーを拡張するプロフィール情報';
COMMENT ON COLUMN public.profiles.role       IS 'patient=患者本人, caregiver=家族・介護者';

-- 新規ユーザー登録時にプロフィール行を自動作成するトリガー
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'patient')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at 自動更新トリガー（profiles 用）
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 2. CARE_GROUPS（ケアグループ）
--    患者 1人 に対して 1つ のグループを作成し、
--    家族・介護者をそこに招待する。
-- ============================================================
CREATE TABLE IF NOT EXISTS public.care_groups (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  invite_code  TEXT        UNIQUE NOT NULL DEFAULT substr(gen_random_uuid()::TEXT, 1, 8),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE  public.care_groups              IS '患者を中心とするケアグループ';
COMMENT ON COLUMN public.care_groups.invite_code  IS '家族招待用の短縮コード（8桁）';

CREATE INDEX IF NOT EXISTS idx_care_groups_patient  ON public.care_groups(patient_id);
CREATE INDEX IF NOT EXISTS idx_care_groups_invite   ON public.care_groups(invite_code);


-- ============================================================
-- 3. CARE_GROUP_MEMBERS（グループメンバー）
--    家族・介護者がケアグループに参加する中間テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS public.care_group_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID        NOT NULL REFERENCES public.care_groups(id)  ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  relation        TEXT,                          -- 例: '長女', '配偶者', 'ヘルパー'
  can_view_video  BOOLEAN     NOT NULL DEFAULT TRUE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, user_id)                     -- 同一グループへの重複参加を防止
);
COMMENT ON TABLE  public.care_group_members                  IS 'ケアグループへの家族・介護者の参加情報';
COMMENT ON COLUMN public.care_group_members.can_view_video   IS '服薬映像の閲覧権限';

CREATE INDEX IF NOT EXISTS idx_cgm_group   ON public.care_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_cgm_user    ON public.care_group_members(user_id);


-- ============================================================
-- 4. MEDICATIONS（薬情報）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.medications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  dosage        TEXT,                             -- 例: '1錠', '1包'
  unit          TEXT,                             -- 例: '錠', '包', 'ml'
  notes         TEXT,
  qr_raw_data   TEXT,                             -- JAHISフォーマットのQRコード生データ
  start_date    DATE,
  end_date      DATE,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE  public.medications             IS '患者が登録した薬の情報';
COMMENT ON COLUMN public.medications.qr_raw_data IS '薬局発行QRコード（JAHISフォーマット）の生データ';

CREATE INDEX IF NOT EXISTS idx_medications_patient ON public.medications(patient_id);

CREATE TRIGGER set_medications_updated_at
  BEFORE UPDATE ON public.medications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 5. MEDICATION_SCHEDULES（服薬スケジュール）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.medication_schedules (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id       UUID        NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  patient_id          UUID        NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  scheduled_time      TIME        NOT NULL,
  days_of_week        INTEGER[]   NOT NULL DEFAULT '{0,1,2,3,4,5,6}',  -- 0=日,1=月,...,6=土
  meal_timing         TEXT        NOT NULL DEFAULT 'after'
                        CHECK (meal_timing IN ('before', 'after', 'between', 'anytime')),
  reminder_minutes    INTEGER     NOT NULL DEFAULT 5,  -- 事前通知（分）
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE  public.medication_schedules                  IS '薬ごとの服薬スケジュール（朝・昼・夜など複数設定可）';
COMMENT ON COLUMN public.medication_schedules.days_of_week     IS '服薬曜日の配列（0=日曜〜6=土曜）';
COMMENT ON COLUMN public.medication_schedules.meal_timing      IS 'before=食前, after=食後, between=食間, anytime=指定なし';
COMMENT ON COLUMN public.medication_schedules.reminder_minutes IS '服薬時刻の何分前に通知するか';

CREATE INDEX IF NOT EXISTS idx_schedules_medication ON public.medication_schedules(medication_id);
CREATE INDEX IF NOT EXISTS idx_schedules_patient    ON public.medication_schedules(patient_id);

CREATE TRIGGER set_schedules_updated_at
  BEFORE UPDATE ON public.medication_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 6. MEDICATION_LOGS（服薬記録）
--    スケジュールに基づいて生成された記録。
--    服薬映像（Supabase Storage）のURLも保持する。
-- ============================================================
CREATE TABLE IF NOT EXISTS public.medication_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   UUID        NOT NULL REFERENCES public.medication_schedules(id) ON DELETE CASCADE,
  patient_id    UUID        NOT NULL REFERENCES public.profiles(id)             ON DELETE CASCADE,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  taken_at      TIMESTAMPTZ,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'taken', 'skipped')),
  video_url     TEXT,      -- Supabase Storage の公開/署名付きURL
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE  public.medication_logs           IS '服薬の実績記録（映像URLを含む）';
COMMENT ON COLUMN public.medication_logs.status    IS 'pending=未服薬, taken=服薬済み, skipped=スキップ';
COMMENT ON COLUMN public.medication_logs.video_url IS 'Supabase Storage に保存した服薬映像のURL';

CREATE INDEX IF NOT EXISTS idx_logs_schedule   ON public.medication_logs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_logs_patient    ON public.medication_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_logs_scheduled  ON public.medication_logs(scheduled_at);

CREATE TRIGGER set_logs_updated_at
  BEFORE UPDATE ON public.medication_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 7. PUSH_SUBSCRIPTIONS（Web Push サブスクリプション）
--    Web Push API のエンドポイントと暗号化キーを保存
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint     TEXT        NOT NULL,
  p256dh       TEXT        NOT NULL,
  auth_key     TEXT        NOT NULL,
  device_name  TEXT,                    -- 例: 'iPhoneのSafari', 'Androidのホーム画面'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, endpoint)            -- 同一端末の重複登録を防止
);
COMMENT ON TABLE  public.push_subscriptions         IS 'Web Push API のサブスクリプション情報（端末ごとに1行）';
COMMENT ON COLUMN public.push_subscriptions.p256dh  IS 'ECDH 公開鍵（ブラウザが生成）';
COMMENT ON COLUMN public.push_subscriptions.auth_key IS '認証シークレット（ブラウザが生成）';

CREATE INDEX IF NOT EXISTS idx_push_user ON public.push_subscriptions(user_id);

CREATE TRIGGER set_push_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 8. NOTIFICATION_LOGS（通知送信ログ）
--    どの服薬記録を起因にどのユーザーへ通知を送ったか
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID          REFERENCES public.care_groups(id)     ON DELETE SET NULL,
  log_id           UUID          REFERENCES public.medication_logs(id) ON DELETE SET NULL,
  type             TEXT          NOT NULL
                     CHECK (type IN (
                       'medication_reminder',  -- 服薬リマインド（患者本人宛）
                       'medication_taken',     -- 服薬完了通知（家族宛）
                       'medication_missed',    -- 飲み忘れ通知（家族宛）
                       'video_recorded'        -- 映像記録完了通知（家族宛）
                     )),
  sent_to_user_ids UUID[]        NOT NULL DEFAULT '{}',
  sent_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE  public.notification_logs                  IS 'プッシュ通知の送信ログ';
COMMENT ON COLUMN public.notification_logs.sent_to_user_ids IS '通知を送信したユーザーID一覧';

CREATE INDEX IF NOT EXISTS idx_notif_group  ON public.notification_logs(group_id);
CREATE INDEX IF NOT EXISTS idx_notif_log    ON public.notification_logs(log_id);
CREATE INDEX IF NOT EXISTS idx_notif_sent   ON public.notification_logs(sent_at);


-- ============================================================
-- 9. Row Level Security（RLS）の設定
--    全テーブルに RLS を有効化し、適切なポリシーを付与する
-- ============================================================
ALTER TABLE public.profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_group_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs      ENABLE ROW LEVEL SECURITY;

-- -- profiles: 自分自身のみ参照・更新可能
CREATE POLICY "profiles: 自分のみ参照"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles: 自分のみ更新"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- -- care_groups: 患者本人と、そのグループメンバーが参照可能
CREATE POLICY "care_groups: 患者・メンバーが参照"
  ON public.care_groups FOR SELECT
  USING (
    auth.uid() = patient_id
    OR EXISTS (
      SELECT 1 FROM public.care_group_members
      WHERE group_id = care_groups.id AND user_id = auth.uid()
    )
  );

CREATE POLICY "care_groups: 患者のみ作成"
  ON public.care_groups FOR INSERT
  WITH CHECK (auth.uid() = patient_id);

CREATE POLICY "care_groups: 患者のみ更新"
  ON public.care_groups FOR UPDATE
  USING (auth.uid() = patient_id);

-- -- care_group_members: メンバー・患者が参照、参加は本人が行う
CREATE POLICY "cgm: 関係者が参照"
  ON public.care_group_members FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.care_groups
      WHERE id = care_group_members.group_id AND patient_id = auth.uid()
    )
  );

CREATE POLICY "cgm: 本人が参加"
  ON public.care_group_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- -- medications: 患者と同一グループメンバーが参照
CREATE POLICY "medications: 患者が全操作"
  ON public.medications FOR ALL
  USING (auth.uid() = patient_id);

CREATE POLICY "medications: グループメンバーが参照"
  ON public.medications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.care_groups cg
      JOIN public.care_group_members cgm ON cg.id = cgm.group_id
      WHERE cg.patient_id = medications.patient_id AND cgm.user_id = auth.uid()
    )
  );

-- -- medication_schedules: 患者が全操作、メンバーは参照のみ
CREATE POLICY "schedules: 患者が全操作"
  ON public.medication_schedules FOR ALL
  USING (auth.uid() = patient_id);

CREATE POLICY "schedules: グループメンバーが参照"
  ON public.medication_schedules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.care_groups cg
      JOIN public.care_group_members cgm ON cg.id = cgm.group_id
      WHERE cg.patient_id = medication_schedules.patient_id AND cgm.user_id = auth.uid()
    )
  );

-- -- medication_logs: 患者が全操作、映像権限ありメンバーが参照
CREATE POLICY "logs: 患者が全操作"
  ON public.medication_logs FOR ALL
  USING (auth.uid() = patient_id);

CREATE POLICY "logs: 映像権限ありメンバーが参照"
  ON public.medication_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.care_groups cg
      JOIN public.care_group_members cgm ON cg.id = cgm.group_id
      WHERE cg.patient_id = medication_logs.patient_id
        AND cgm.user_id = auth.uid()
        AND cgm.can_view_video = TRUE
    )
  );

-- -- push_subscriptions: 自分の端末のみ操作可能
CREATE POLICY "push: 自分のみ全操作"
  ON public.push_subscriptions FOR ALL
  USING (auth.uid() = user_id);

-- -- notification_logs: グループ関係者が参照（バックエンドからの書き込みは service_role で行う）
CREATE POLICY "notif: 関係者が参照"
  ON public.notification_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.care_groups cg
      LEFT JOIN public.care_group_members cgm ON cg.id = cgm.group_id
      WHERE cg.id = notification_logs.group_id
        AND (cg.patient_id = auth.uid() OR cgm.user_id = auth.uid())
    )
  );


-- ============================================================
-- 10. Supabase Storage バケット設定（参考）
--     ダッシュボード > Storage から作成するか、
--     下記 SQL を Supabase Storage API 経由で実行してください。
-- ============================================================

-- 服薬映像用バケット（非公開・署名付きURL使用）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medication-videos',
  'medication-videos',
  FALSE,                          -- 非公開（署名付きURLで個別に配信）
  52428800,                       -- 50MB 上限
  ARRAY['video/mp4', 'video/webm', 'video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

-- Storageポリシー: 患者本人がアップロード可能
CREATE POLICY "videos: 患者がアップロード"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'medication-videos'
    -- INSERT時は結合がないので name 単体でも動きますが、明示しておくと安全です
    AND auth.uid()::text = split_part(storage.objects.name, '/', 1)
  );

-- Storageポリシー: 映像権限のあるメンバーと患者本人が参照可能
CREATE POLICY "videos: 権限あり参照"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'medication-videos'
    AND (
      -- ここも明確にテーブル名を指定します
      auth.uid()::text = split_part(storage.objects.name, '/', 1)
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.care_groups cg ON cg.patient_id = p.id
        JOIN public.care_group_members cgm ON cgm.group_id = cg.id
        -- p.name と衝突していたため、storage.objects.name と明示します
        WHERE p.id::text = split_part(storage.objects.name, '/', 1)
          AND cgm.user_id = auth.uid()
          AND cgm.can_view_video = TRUE
      )
    )
  );


-- ============================================================
-- ストレージのアップロードパス規則（実装時の参考）
-- ============================================================
-- 映像ファイルのパス: {patient_id}/{log_id}.mp4
-- 例: a1b2c3d4-xxx/e5f6g7h8-yyy.mp4
--
-- 署名付きURL生成（Node.js / Supabase SDK）:
-- const { data } = await supabase.storage
--   .from('medication-videos')
--   .createSignedUrl(`${patientId}/${logId}.mp4`, 3600); // 1時間有効
-- ============================================================
