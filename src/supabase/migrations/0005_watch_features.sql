-- ============================================================
--  0005_使う機能の選択（見守る／見守られる）
--  実行場所: Supabase ダッシュボード > SQL Editor
--  （0001 → 0002 → 0003 → 0004 の後に実行してください）
-- ============================================================
--
--  背景:
--    0004 で、すべての利用者が「見守る」「見守られる」の両方を使えるようにした。
--    しかし高齢の利用者にとっては、招待コードの入力や表示の切り替えなど
--    使わない操作が画面にあること自体が、押し間違い・混乱の元になる。
--    そこで、利用者ごとに使う機能を選べるようにする。
--
--      can_watch      … 家族を見守る（招待コードを入力して、家族の服薬を見る）
--      can_be_watched … 家族に見守ってもらう（招待コードを発行して、見てもらう）
--      両方 FALSE     … 自分のお薬の管理だけ
--
--    「自分のお薬の管理」は全員が使う基本機能なので、フラグは持たない。
--
--  このマイグレーションで行うこと:
--    1. profiles に can_watch / can_be_watched を追加する
--       （既存の利用者は、これまでどおり両方使える状態にする）
--    2. 新規登録時に、登録画面で選んだ内容を保存する
--    3. 機能が OFF の人が、見守りを始めたり招待コードを発行したりできないようにする
--    4. 見守りの相手がいるあいだは、その機能を OFF にできないようにする
--       （OFF にしても画面から相手が消えるだけで、見守りが続いてしまうのを防ぐ）
--
--  エラーは ERRCODE 'P0001' で返し、HINT に識別子を入れる。
--  API（src/routes/）は HINT を見て、利用者向けの文言と code を返す。
-- ============================================================


-- ============================================================
-- 1. 列の追加
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_watch      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS can_be_watched BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.profiles.can_watch      IS '家族を見守る機能を使うか';
COMMENT ON COLUMN public.profiles.can_be_watched IS '家族に見守ってもらう機能を使うか';
COMMENT ON COLUMN public.profiles.role           IS
  'patient=本人として登録, caregiver=見守る側として登録。画面の並び順・初期表示だけに使い、使える機能は can_watch / can_be_watched で決める';


-- ============================================================
-- 2. 新規登録時のプロフィール作成（登録画面で選んだ機能を保存）
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, can_watch, can_be_watched)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'patient'),
    COALESCE((NEW.raw_user_meta_data->>'can_watch')::BOOLEAN, TRUE),
    COALESCE((NEW.raw_user_meta_data->>'can_be_watched')::BOOLEAN, TRUE)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 3. 機能が OFF の人の操作を止める
-- ============================================================

-- 見守りを始めるとき（care_group_members への追加）
--   ・見守る人   … can_watch が TRUE であること
--   ・見守られる人 … can_be_watched が TRUE であること
CREATE OR REPLACE FUNCTION public.enforce_watch_features_on_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.user_id AND p.can_watch
  ) THEN
    RAISE EXCEPTION '見守る機能が使えない設定になっています。'
      USING ERRCODE = 'P0001', HINT = 'WATCH_DISABLED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.care_groups g
    JOIN public.profiles p ON p.id = g.patient_id
    WHERE g.id = NEW.group_id AND p.can_be_watched
  ) THEN
    RAISE EXCEPTION 'このご家族は、見守ってもらう機能を使っていません。'
      USING ERRCODE = 'P0001', HINT = 'TARGET_NOT_WATCHABLE';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_watch_features_on_member ON public.care_group_members;
CREATE TRIGGER trg_enforce_watch_features_on_member
  BEFORE INSERT OR UPDATE OF group_id, user_id ON public.care_group_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_watch_features_on_member();

-- 招待コードを発行するとき（care_groups の作成）
CREATE OR REPLACE FUNCTION public.enforce_watch_features_on_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.patient_id AND p.can_be_watched
  ) THEN
    RAISE EXCEPTION '見守ってもらう機能が使えない設定になっています。'
      USING ERRCODE = 'P0001', HINT = 'BE_WATCHED_DISABLED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_watch_features_on_group ON public.care_groups;
CREATE TRIGGER trg_enforce_watch_features_on_group
  BEFORE INSERT OR UPDATE OF patient_id ON public.care_groups
  FOR EACH ROW EXECUTE FUNCTION public.enforce_watch_features_on_group();


-- ============================================================
-- 4. 見守りの相手がいるあいだは、機能を OFF にできない
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_disable_watch_features()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.can_watch AND NOT NEW.can_watch AND EXISTS (
    SELECT 1 FROM public.care_group_members m
    WHERE m.user_id = NEW.id
  ) THEN
    RAISE EXCEPTION '見守っているご家族がいるため、見守る機能をやめられません。'
      USING ERRCODE = 'P0001', HINT = 'STILL_WATCHING';
  END IF;

  IF OLD.can_be_watched AND NOT NEW.can_be_watched AND EXISTS (
    SELECT 1
    FROM public.care_groups g
    JOIN public.care_group_members m ON m.group_id = g.id
    WHERE g.patient_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'あなたを見守っているご家族がいるため、見守ってもらう機能をやめられません。'
      USING ERRCODE = 'P0001', HINT = 'STILL_WATCHED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_disable_watch_features ON public.profiles;
CREATE TRIGGER trg_prevent_disable_watch_features
  BEFORE UPDATE OF can_watch, can_be_watched ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_disable_watch_features();


-- ============================================================
-- 5. 確認用クエリ（実行して結果を目視する）
-- ============================================================
-- (a) 追加した列（既存の利用者は両方 TRUE になっている）
-- SELECT id, name, role, can_watch, can_be_watched FROM public.profiles ORDER BY created_at;
--
-- (b) 追加したトリガー
-- SELECT event_object_table, trigger_name
-- FROM information_schema.triggers
-- WHERE trigger_schema = 'public'
--   AND trigger_name LIKE 'trg_%watch_features%'
-- ORDER BY event_object_table, trigger_name;
