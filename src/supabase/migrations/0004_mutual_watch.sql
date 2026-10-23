-- ============================================================
--  0004_相互見守り（1つのアカウントで「見守る側」「見守られる側」の両方）
--  実行場所: Supabase ダッシュボード > SQL Editor
--  （0001 → 0002 → 0003 の後に実行してください）
-- ============================================================
--
--  背景:
--    これまでは登録時の役割（patient / caregiver）で画面を分けていたため、
--    1人の利用者が「自分の服薬を見守ってもらう」と「家族を見守る」を
--    同時に行えなかった。テーブル構造とRLSはもともと役割に依存していないため、
--    このマイグレーションでは次の不足分だけを補う。
--
--    1. 1人の利用者が持てる見守りグループ（招待コード）を1つに限定する
--    2. 自分の招待コードで自分のグループに参加できないようにする
--    3. 見守りの解除（本人の退出・見守られる側による解除）を可能にする
--    4. 映像閲覧権限を「見守られる側」だけが変更できるようにする
--    5. 見守り相手の名前を、必要最小限の列だけ取得できるようにする
--       （profiles のRLSは「自分のみ参照」のままにしておく）
--    6. 服薬記録（medication_logs）の参照を、映像権限から切り離す
--       （映像そのものは Storage のポリシーで引き続き権限ありの人だけに限定）
-- ============================================================


-- ============================================================
-- 1. 1人1グループ
-- ============================================================

-- 既に同じ利用者のグループが2つ以上ある場合は、ここで止まる。
-- その場合は次のSQLで重複を確認し、不要なほうを削除してから再実行する。
--   SELECT patient_id, array_agg(id ORDER BY created_at) AS group_ids
--   FROM public.care_groups GROUP BY patient_id HAVING COUNT(*) > 1;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.care_groups
    GROUP BY patient_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '同じ利用者の見守りグループが複数あります。重複を整理してから再実行してください。';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_care_groups_patient
  ON public.care_groups(patient_id);

COMMENT ON TABLE public.care_groups IS
  '見守られる人（patient_id）1人につき1つ。招待コードで家族が参加する単位';


-- ============================================================
-- 2. 自分のグループへの参加を防止（APIでも確認するが、DB側でも止める）
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_self_join()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.care_groups g
    WHERE g.id = NEW.group_id
      AND g.patient_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION '自分自身を見守ることはできません。'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_join ON public.care_group_members;
CREATE TRIGGER trg_prevent_self_join
  BEFORE INSERT OR UPDATE OF group_id, user_id ON public.care_group_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_join();


-- ============================================================
-- 3. 見守りの解除
--    ・見守っている本人（user_id）は自分で退出できる
--    ・見守られている本人（グループの patient_id）は相手を外せる
-- ============================================================
DROP POLICY IF EXISTS "cgm: 本人の退出・見守られる側による解除" ON public.care_group_members;

CREATE POLICY "cgm: 本人の退出・見守られる側による解除"
  ON public.care_group_members FOR DELETE
  USING (
    auth.uid() = user_id
    OR public.is_group_patient(group_id)
  );


-- ============================================================
-- 4. 映像閲覧権限の変更（見守られる側のみ）
--    UPDATE ポリシーで許可すると group_id / user_id まで書き換えられるため、
--    can_view_video だけを変更する関数に限定する。
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_member_video_permission(
  p_member_id UUID,
  p_can_view  BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.care_group_members m
     SET can_view_video = p_can_view
    FROM public.care_groups g
   WHERE m.id         = p_member_id
     AND g.id         = m.group_id
     AND g.patient_id = auth.uid();   -- 自分のグループのメンバーだけ

  RETURN FOUND;  -- 対象が無い（他人のグループ等）ときは FALSE
END;
$$;

COMMENT ON FUNCTION public.set_member_video_permission IS
  '見守られる本人だけが、メンバーごとの映像閲覧権限を切り替えられる';


-- ============================================================
-- 5. 見守り相手の一覧（名前を含む最小限の情報だけ返す）
-- ============================================================

-- 自分を見守っている人の一覧（見守られる側の画面用）
CREATE OR REPLACE FUNCTION public.list_my_watchers()
RETURNS TABLE (
  member_id      UUID,
  user_id        UUID,
  name           TEXT,
  relation       TEXT,
  can_view_video BOOLEAN,
  joined_at      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id, m.user_id, p.name, m.relation, m.can_view_video, m.joined_at
  FROM public.care_groups g
  JOIN public.care_group_members m ON m.group_id = g.id
  JOIN public.profiles p           ON p.id = m.user_id
  WHERE g.patient_id = auth.uid()
  ORDER BY m.joined_at;
$$;

-- 自分が見守っている人の一覧（見守る側の画面・ホームの切り替え用）
CREATE OR REPLACE FUNCTION public.list_my_watching()
RETURNS TABLE (
  member_id      UUID,
  group_id       UUID,
  patient_id     UUID,
  name           TEXT,
  relation       TEXT,
  can_view_video BOOLEAN,
  joined_at      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id, g.id, g.patient_id, p.name, m.relation, m.can_view_video, m.joined_at
  FROM public.care_group_members m
  JOIN public.care_groups g ON g.id = m.group_id
  JOIN public.profiles p    ON p.id = g.patient_id
  WHERE m.user_id = auth.uid()
  ORDER BY m.joined_at;
$$;

REVOKE EXECUTE ON FUNCTION public.set_member_video_permission(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_my_watchers()                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_my_watching()                      FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_member_video_permission(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_watchers()                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_watching()                         TO authenticated;


-- ============================================================
-- 6. 服薬記録の参照を映像権限から切り離す
--    これまで: can_view_video = TRUE のメンバーだけが記録を参照できた
--              （映像を許可していない家族は、服薬済み／飲み忘れも見られなかった）
--    これから: 見守っているメンバーは全員、記録（状態）を参照できる。
--              映像ファイルは storage.objects の "videos: 権限あり参照"
--              （can_view_video_path）で引き続き権限ありの人だけに限定される。
-- ============================================================
DROP POLICY IF EXISTS "logs: 映像権限ありメンバーが参照" ON public.medication_logs;
DROP POLICY IF EXISTS "logs: グループメンバーが参照"     ON public.medication_logs;

CREATE POLICY "logs: グループメンバーが参照"
  ON public.medication_logs FOR SELECT
  USING (public.can_view_patient(patient_id));


-- ============================================================
-- 7. 確認用クエリ（実行して結果を目視する）
-- ============================================================
-- (a) 追加・変更したポリシー
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('care_group_members', 'medication_logs')
-- ORDER BY tablename, policyname;
--
-- (b) 実ユーザーになりきっての確認（'...' に auth.users の id）
-- BEGIN;
-- SET LOCAL ROLE authenticated;
-- SET LOCAL request.jwt.claims = '{"sub":"ここにユーザーUUID","role":"authenticated"}';
-- SELECT * FROM public.list_my_watchers();
-- SELECT * FROM public.list_my_watching();
-- ROLLBACK;
