-- ============================================================
--  0006_招待コードの作り直し
--  実行場所: Supabase ダッシュボード > SQL Editor
--  （0001 → 0002 → 0003 → 0004 → 0005 の後に実行してください）
-- ============================================================
--
--  背景:
--    これまで招待コードは、グループを作ったとき（初めて発行したとき）に
--    1度だけ決まり、その後は変わらなかった。
--    そのため、見守られる人が「見守りを外す」を押しても、外された人は
--    以前に教わった同じコードを入力すれば、また見守りを始められてしまう。
--    また、コードを伝える相手を間違えたときに、コードを無効にする手段がなかった。
--
--  このマイグレーションで行うこと:
--    1. 招待コードを作る関数 generate_invite_code() を用意する
--       ・暗号学的に安全な乱数（gen_random_uuid() の乱数部分）から作る
--       ・高齢の利用者が書き写しやすいよう、見間違えやすい文字
--         （0/O、1/I/L）を除いた英大文字と数字の8文字にする
--       ・ほかのグループと重ならない値になるまで作り直す
--    2. 新しく作るグループの招待コードの既定値を、この関数にする
--    3. 招待コードの照合で大文字・小文字を区別しない
--       （入力時に小文字で打っても通るようにする。既存の小文字のコードもそのまま使える）
--    4. 本人が自分の招待コードを作り直す RPC regenerate_my_invite_code() を追加する
--    5. 見守られる本人が「見守りを外す」を行ったとき、招待コードを自動で作り直す
--       （見守っている人が自分で「見守りをやめる」を行ったときは作り直さない）
--
--  すでに見守っている人の見守りは、コードを作り直しても続く
--  （見守りは care_group_members の group_id で結び付いており、コードには依存しない）。
-- ============================================================


-- ============================================================
-- 1. 招待コードを作る関数
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER  -- 重複の確認で、他人のグループも見る必要があるため
SET search_path = public, pg_temp
AS $$
DECLARE
  -- 見間違えやすい 0 O 1 I L を除いた 31 文字
  alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  -- gen_random_uuid()（v4）のうち、版・種別の固定ビットを含まない位置のバイト
  positions CONSTANT INT[] := ARRAY[0, 1, 2, 3, 4, 5, 9, 10];
  raw  BYTEA;
  code TEXT;
  i    INT;
BEGIN
  LOOP
    raw  := uuid_send(gen_random_uuid());
    code := '';
    FOREACH i IN ARRAY positions LOOP
      code := code || substr(alphabet, (get_byte(raw, i) % length(alphabet)) + 1, 1);
    END LOOP;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.care_groups g WHERE upper(g.invite_code) = code
    );
  END LOOP;
  RETURN code;
END;
$$;

COMMENT ON FUNCTION public.generate_invite_code IS
  '招待コード（見間違えやすい文字を除いた英大文字・数字8文字）をランダムに作る。既存のコードと重ならない値を返す';

-- 列の既定値（下記 2.）は、グループを作る利用者の権限で評価されるため、
-- authenticated には実行権限が必要。未ログインの anon からは外しておく。
REVOKE ALL ON FUNCTION public.generate_invite_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_invite_code() TO authenticated;


-- ============================================================
-- 2. 新しいグループの招待コードの既定値
-- ============================================================
ALTER TABLE public.care_groups
  ALTER COLUMN invite_code SET DEFAULT public.generate_invite_code();

COMMENT ON COLUMN public.care_groups.invite_code IS
  '家族招待用のコード（8桁）。見守りを外したときや、本人の操作で作り直される';


-- ============================================================
-- 3. 大文字・小文字を区別せずに照合する
-- ============================================================
-- 大文字・小文字の違いだけのコードが2つできないようにする
-- （既存のコードはすべて小文字の16進数なので、この索引は問題なく作れる）
CREATE UNIQUE INDEX IF NOT EXISTS uq_care_groups_invite_code_upper
  ON public.care_groups (upper(invite_code));

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
    WHERE upper(cg.invite_code) = upper(p_invite_code);
END;
$$;

COMMENT ON FUNCTION public.find_group_by_invite_code IS
  '招待コードからグループの最小限の情報（id, name, patient_id）のみを取得するRPC。
   RLSをバイパスするが、invite_code完全一致（大文字・小文字は区別しない）でしか検索できないため、
   コードを知っている利用者のみが該当行を取得できる。';


-- ============================================================
-- 4. 本人が自分の招待コードを作り直す
-- ============================================================
CREATE OR REPLACE FUNCTION public.regenerate_my_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_code TEXT;
BEGIN
  UPDATE public.care_groups
     SET invite_code = public.generate_invite_code()
   WHERE patient_id = auth.uid()
  RETURNING invite_code INTO new_code;

  RETURN new_code;  -- まだ招待コードを発行していない人は NULL
END;
$$;

COMMENT ON FUNCTION public.regenerate_my_invite_code IS
  'ログイン中の本人の招待コードを新しいランダムな値に作り直し、そのコードを返す（未発行なら NULL）';

GRANT EXECUTE ON FUNCTION public.regenerate_my_invite_code() TO authenticated;


-- ============================================================
-- 5. 見守られる本人が見守りを外したら、招待コードを作り直す
-- ============================================================
CREATE OR REPLACE FUNCTION public.regenerate_invite_code_on_remove()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 消したのが見守られる本人のときだけ（見守る人が自分でやめたときは対象外）
  UPDATE public.care_groups g
     SET invite_code = public.generate_invite_code()
   WHERE g.id = OLD.group_id
     AND g.patient_id = auth.uid()
     AND OLD.user_id <> auth.uid();
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_regenerate_invite_code_on_remove ON public.care_group_members;
CREATE TRIGGER trg_regenerate_invite_code_on_remove
  AFTER DELETE ON public.care_group_members
  FOR EACH ROW EXECUTE FUNCTION public.regenerate_invite_code_on_remove();


-- ============================================================
-- 6. 確認用クエリ（実行して結果を目視する）
-- ============================================================
-- (a) 作られるコードの例（実行するたびに違う値になる）
-- SELECT public.generate_invite_code() FROM generate_series(1, 5);
--
-- (b) 招待コードの既定値が関数になっている
-- SELECT column_default FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'care_groups' AND column_name = 'invite_code';
--
-- (c) 追加したトリガー
-- SELECT event_object_table, trigger_name FROM information_schema.triggers
--  WHERE trigger_name = 'trg_regenerate_invite_code_on_remove';
