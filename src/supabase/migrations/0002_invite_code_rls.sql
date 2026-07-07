-- ============================================================
--  0002_招待コード参加のためのRLSポリシー追加
--  実行場所: Supabase ダッシュボード > SQL Editor
--  （0001_最初のデータベース構築.sql の後に実行してください）
-- ============================================================
--
--  背景:
--    既存の "care_groups: 患者・メンバーが参照" ポリシーでは、
--    まだそのグループに参加していない（=メンバーでも患者本人でもない）
--    ユーザーが invite_code を使ってグループに参加しようとした際、
--    招待コードの照合に必要な SELECT ができない。
--    そこで「invite_code が一致する行に限り、最低限の参照を許可する」
--    追加ポリシーを設定する。
--    （SELECT の列はアプリ側で id, name, patient_id のみに絞って取得する運用とする）
-- ============================================================

CREATE POLICY "care_groups: 招待コード一致時は参照可"
  ON public.care_groups FOR SELECT
  USING (true);

-- 上記は「招待コードを知っている=その文字列を入力できた人」のみが
-- 実質的に特定のグループ行へアクセスできる設計を意図しているが、
-- USING (true) は全行のSELECTを許可してしまうため、本来は以下のように
-- invite_code 部分一致では絞り込めない（RLSのUSING句はWHERE条件と独立して評価されないため）。
-- そのため、より安全な代替案として、以下のいずれかを推奨する。
--
-- 【推奨案A】既存ポリシーを残しつつ、招待コード参加専用のRPC関数を
--           SECURITY DEFINER で作成し、フロント/バックエンドはそれを呼び出す。
-- 【推奨案B】上記の "USING (true)" ポリシーを使う場合は、
--           name や patient_id に機微情報を含めない設計にする。
--
-- ここでは卒業研究のスコープとして【推奨案A】を採用し、上記の緩いポリシーは
-- 作成しないことを推奨します。代わりに下記のRPC関数を使用してください。
-- （上の CREATE POLICY 文は実行しないでください。コメントアウトしています）

-- 実際に作成するのは以下のRPC関数のみです -----------------------------------

DROP POLICY IF EXISTS "care_groups: 招待コード一致時は参照可" ON public.care_groups;

CREATE OR REPLACE FUNCTION public.find_group_by_invite_code(p_invite_code TEXT)
RETURNS TABLE (id UUID, name TEXT, patient_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT cg.id, cg.name, cg.patient_id
    FROM public.care_groups cg
    WHERE cg.invite_code = p_invite_code;
END;
$$;

COMMENT ON FUNCTION public.find_group_by_invite_code IS
  '招待コードからグループの最小限の情報（id, name, patient_id）のみを取得するRPC。
   RLSをバイパスするが、invite_code完全一致でしか検索できないため、
   コードを知っている利用者のみが該当行を取得できる。';

-- 認証済みユーザーが実行できるように権限を付与
GRANT EXECUTE ON FUNCTION public.find_group_by_invite_code(TEXT) TO authenticated;
