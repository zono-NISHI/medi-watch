-- ============================================================
--  0003_RLSの相互再帰（42P17）の解消
--  実行場所: Supabase ダッシュボード > SQL Editor
--  （0001 → 0002 の後に実行してください）
-- ============================================================
--
--  背景:
--    care_groups の SELECT ポリシーが care_group_members を参照し、
--    care_group_members の SELECT ポリシーが care_groups を参照していたため、
--    ポリシー評価が相互再帰して
--      42P17: infinite recursion detected in policy for relation "care_groups"
--    が発生していた。
--
--  方針:
--    判定ロジックを SECURITY DEFINER 関数に切り出す。
--    関数は所有者権限で実行されるため内部のテーブル参照で RLS が
--    再評価されず、再帰が発生しない。
--    公開する情報は「呼び出し元(auth.uid())に権限があるか」という真偽値のみで、
--    他人の行の内容は一切返さないため、権限モデルは 0001 と等価に保たれる。
-- ============================================================


-- ============================================================
-- 1. 権限判定ヘルパー関数
-- ============================================================

-- 呼び出し元が、指定グループのメンバー（家族・介護者）か
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.care_group_members m
    WHERE m.group_id = p_group_id
      AND m.user_id  = auth.uid()
  );
$$;

-- 呼び出し元が、指定グループの患者本人か
CREATE OR REPLACE FUNCTION public.is_group_patient(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.care_groups g
    WHERE g.id         = p_group_id
      AND g.patient_id = auth.uid()
  );
$$;

-- 呼び出し元が、指定患者のデータを閲覧できるか
-- （本人、または同じケアグループに参加している家族・介護者）
CREATE OR REPLACE FUNCTION public.can_view_patient(p_patient_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.uid() = p_patient_id
    OR EXISTS (
      SELECT 1
      FROM public.care_groups g
      JOIN public.care_group_members m ON m.group_id = g.id
      WHERE g.patient_id = p_patient_id
        AND m.user_id    = auth.uid()
    );
$$;

-- 呼び出し元が、指定患者の「服薬映像」を閲覧できるか
-- （本人、または can_view_video = TRUE のメンバー）
CREATE OR REPLACE FUNCTION public.can_view_patient_video(p_patient_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.uid() = p_patient_id
    OR EXISTS (
      SELECT 1
      FROM public.care_groups g
      JOIN public.care_group_members m ON m.group_id = g.id
      WHERE g.patient_id     = p_patient_id
        AND m.user_id        = auth.uid()
        AND m.can_view_video = TRUE
    );
$$;

-- Storage のオブジェクトパス（{patient_id}/{log_id}.mp4）用。
-- 先頭要素が UUID でない場合にキャスト例外で落ちないようガードする。
CREATE OR REPLACE FUNCTION public.can_view_video_path(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_head TEXT := split_part(p_path, '/', 1);
BEGIN
  IF v_head !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN FALSE;
  END IF;
  RETURN public.can_view_patient_video(v_head::UUID);
END;
$$;

-- 実行権限は認証済みユーザーのみに与える（匿名からは呼べないようにする）
REVOKE EXECUTE ON FUNCTION public.is_group_member(UUID)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_group_patient(UUID)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_patient(UUID)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_patient_video(UUID)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_video_path(TEXT)      FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_group_member(UUID)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_patient(UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_patient(UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_patient_video(UUID)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_video_path(TEXT)       TO authenticated;


-- ============================================================
-- 2. ポリシーの張り替え（再帰する2本が本丸）
-- ============================================================

-- ---- care_groups ----
DROP POLICY IF EXISTS "care_groups: 患者・メンバーが参照" ON public.care_groups;

CREATE POLICY "care_groups: 患者・メンバーが参照"
  ON public.care_groups FOR SELECT
  USING (
    auth.uid() = patient_id
    OR public.is_group_member(id)
  );

-- ---- care_group_members ----
DROP POLICY IF EXISTS "cgm: 関係者が参照" ON public.care_group_members;

CREATE POLICY "cgm: 関係者が参照"
  ON public.care_group_members FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_group_patient(group_id)
  );


-- ============================================================
-- 3. 同じ構造を持つ他テーブルのポリシーも関数呼び出しに統一
--    （現時点で再帰していなくても、care_groups を参照する限り
--      同じ問題を踏む可能性があるため予防的に置き換える）
-- ============================================================

-- ---- medications ----
DROP POLICY IF EXISTS "medications: グループメンバーが参照" ON public.medications;

CREATE POLICY "medications: グループメンバーが参照"
  ON public.medications FOR SELECT
  USING (public.can_view_patient(patient_id));

-- ---- medication_schedules ----
DROP POLICY IF EXISTS "schedules: グループメンバーが参照" ON public.medication_schedules;

CREATE POLICY "schedules: グループメンバーが参照"
  ON public.medication_schedules FOR SELECT
  USING (public.can_view_patient(patient_id));

-- ---- medication_logs ----
DROP POLICY IF EXISTS "logs: 映像権限ありメンバーが参照" ON public.medication_logs;

CREATE POLICY "logs: 映像権限ありメンバーが参照"
  ON public.medication_logs FOR SELECT
  USING (public.can_view_patient_video(patient_id));

-- ---- notification_logs ----
DROP POLICY IF EXISTS "notif: 関係者が参照" ON public.notification_logs;

CREATE POLICY "notif: 関係者が参照"
  ON public.notification_logs FOR SELECT
  USING (
    group_id IS NOT NULL
    AND (
      public.is_group_patient(group_id)
      OR public.is_group_member(group_id)
    )
  );

-- ---- storage.objects（服薬映像） ----
DROP POLICY IF EXISTS "videos: 権限あり参照" ON storage.objects;

CREATE POLICY "videos: 権限あり参照"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'medication-videos'
    AND public.can_view_video_path(storage.objects.name)
  );


-- ============================================================
-- 4. 確認用クエリ（実行して結果を目視する）
-- ============================================================

-- (a) 現在のポリシー一覧。qual に care_group 系のテーブル名が
--     直接現れていないことを確認する（関数名になっていればOK）。
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;

-- (b) 実ユーザーになりきっての疎通確認。
--     '...' には auth.users の id を入れる。
-- SET LOCAL ROLE authenticated;
-- SET LOCAL request.jwt.claims = '{"sub":"ここにユーザーUUID","role":"authenticated"}';
-- SELECT * FROM public.care_groups;          -- 42P17 が出なければ解消
-- SELECT * FROM public.care_group_members;
-- RESET ROLE;
