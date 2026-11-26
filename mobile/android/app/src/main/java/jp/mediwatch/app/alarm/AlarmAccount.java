package jp.mediwatch.app.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 端末のアラームが「誰のアカウントの予定か」を覚え、そのアカウントが削除されたら、アラームを止めて予定を消す。
 *
 * 端末のアラームは、アプリの画面を開かなくても、通信できなくても鳴る（服薬アラームに必要な強み）。
 * その反面、アカウントが削除されても気づけず、消したアカウントのお薬の時間を知らせ続けてしまっていた
 * （開発中に SQL でアカウントを消したとき、触れない場所に置いたスマホで鳴り続けた）。
 *
 * そこで、次の 3 つの機会に削除に気づけるようにしている（どれか 1 つが届かなくても、ほかが拾う）。
 * 1. 鳴らす前（AlarmReceiver）… サーバーに「このアカウントはまだあるか」を確かめる。消し方は問わない
 *    （アプリの「アカウントを削除する」でも、SQL やダッシュボードで直接消しても気づける）
 * 2. アプリを開いたとき（MainActivity.onStart）… 1. と同じ確認
 * 3. アプリの「アカウントを削除する」で消したとき … サーバーから届く知らせ（AccountMessagingService）
 *
 * 止めるのは、サーバーが「削除された」とはっきり答えたときだけ。通信できない・サーバーの障害・
 * ログインの期限切れのときは、いつもどおり鳴らす（電波が無いだけで知らせ損ねると、飲み忘れにつながるため）。
 *
 * 確かめるときは、ログインのトークンではなく、アラーム用の鍵（サーバーの src/lib/alarmKey.js）を使う。
 * ログインが切れていても、アカウントがあるかどうかは確かめられるようにするため。
 * 鍵は、アプリの画面（public/js/alarm.js の NativeAlarm）がログイン中に受け取り、MediAlarmPlugin.setAccount で渡してくる。
 */
public final class AlarmAccount {

    private static final String TAG = "MediAlarm";

    enum Result { ACTIVE, DELETED, UNKNOWN }

    private static final String PREFS = "medi_watch_alarm_account";
    private static final String KEY_KEY = "key";
    private static final String KEY_USER_ID = "user_id";
    private static final String KEY_API_BASE = "api_base";

    /**
     * 鳴らす前に、サーバーの答えを待つ時間。これを過ぎたら答えを待たずに鳴らす（サーバーが眠っていて遅いときなど）。
     * 予約したアラームから音を鳴らすサービスを始められるのは、アラームの時刻から 10 秒ほどのあいだだけなので、それより短くする
     */
    private static final long PRE_RING_WAIT_MS = 4000;
    private static final int CONNECT_TIMEOUT_MS = 10000;
    /** 鳴らし始めたあとも、答えが届くまで待つ（Render のサーバーは、眠っていると起きるまで 1 分近くかかることがある） */
    private static final int READ_TIMEOUT_MS = 60000;
    /** アプリを開いたときの確認の間隔（画面を切り替えるたびに確かめないように） */
    private static final long APP_CHECK_INTERVAL_MS = 60 * 1000;

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static volatile long lastAppCheckAt = -APP_CHECK_INTERVAL_MS;

    private AlarmAccount() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---- 鍵の保存 ----

    /** アプリの画面から、ログイン中の人の鍵を受け取って保存する。https のサーバーにだけ送る */
    static void save(Context context, String key, String userId, String apiBase) {
        if (key == null || key.isEmpty() || userId == null || userId.isEmpty() || apiBase == null || !apiBase.startsWith("https://")) {
            return;
        }
        prefs(context).edit()
            .putString(KEY_KEY, key)
            .putString(KEY_USER_ID, userId)
            .putString(KEY_API_BASE, apiBase.replaceAll("/+$", ""))
            .apply();
    }

    /** 端末のアラームの予定が、誰のアカウントのものか。分からなければ null */
    static String userId(Context context) {
        return prefs(context).getString(KEY_USER_ID, null);
    }

    private static String key(Context context) {
        return prefs(context).getString(KEY_KEY, null);
    }

    // ---- サーバーに確かめる ----

    /** サーバーに、このアカウントがまだあるかを確かめる。通信するので、画面の処理の流れ（メインスレッド）からは呼ばない */
    static Result check(Context context) {
        SharedPreferences p = prefs(context);
        String key = p.getString(KEY_KEY, null);
        String apiBase = p.getString(KEY_API_BASE, null);
        if (key == null || apiBase == null) return Result.UNKNOWN;

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(apiBase + "/auth/alarm-status").openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] body = new JSONObject().put("key", key).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body);
            }
            int status = conn.getResponseCode();
            if (status == 200) return Result.ACTIVE;
            if (status == 410) {
                // 410 を返すほかの仕組み（中継のサーバーなど）と取り違えないよう、中身の code まで確かめる
                String code = new JSONObject(readAll(conn.getErrorStream())).optString("code");
                if ("ACCOUNT_DELETED".equals(code)) return Result.DELETED;
            }
            Log.w(TAG, "アカウントの確認：サーバーの答えが " + status + " のため、いつもどおり鳴らします");
            return Result.UNKNOWN;
        } catch (IOException | JSONException | RuntimeException e) {
            Log.w(TAG, "アカウントの確認：サーバーに確かめられなかったため、いつもどおり鳴らします", e);
            return Result.UNKNOWN;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "{}";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }

    // ---- 止めて消す ----

    /**
     * アラームを止め、予約・保存した予定・鍵をすべて消す（ログアウトしたとき・アカウントが削除されたとき）。
     */
    static void forget(Context context) {
        AlarmAnnouncer.stop();
        AlarmRinger.dismiss(context);
        new AlarmStore(context).clearAll();
        AlarmScheduler.reschedule(context); // 予定が空なので、予約が取り消される
        AlarmRinger.updateSnoozeNotice(context); // 「あとで」の通知も消す
        prefs(context).edit().clear().apply();
    }

    /**
     * 確かめたときの鍵が、今も保存されている鍵と同じときだけ消す。
     * 確かめているあいだに、別のアカウントでログインし直していた場合に、新しいアカウントの予定を消さないため
     */
    private static void forgetIfStill(Context context, String checkedKey) {
        if (checkedKey != null && checkedKey.equals(key(context))) {
            Log.i(TAG, "アカウントが削除されていたため、この端末のアラームを止めて、予定を消しました");
            forget(context);
        }
    }

    // ---- 1. 鳴らす前 ----

    /**
     * 予約したアラームの時刻になったとき（AlarmReceiver）。サーバーに確かめてから鳴らす。
     * - 「削除された」… 鳴らさずに、予定を消す
     * - 「ある」「確かめられない」… 鳴らす
     * - PRE_RING_WAIT_MS を過ぎても答えが無い … 答えを待たずに鳴らし、あとで「削除された」と分かったら、その時点で止める
     * 鍵が無い（新しい版のアプリの画面を、まだ一度も開いていない）ときは、これまでどおりすぐ鳴らす。
     */
    static void ringUnlessDeleted(Context context, Runnable ring, BroadcastReceiver.PendingResult pending) {
        Context app = context.getApplicationContext();
        String checkedKey = key(app);
        if (checkedKey == null) {
            ring.run();
            pending.finish();
            return;
        }

        AtomicBoolean decided = new AtomicBoolean(false);
        Runnable ringNow = () -> {
            if (decided.compareAndSet(false, true)) {
                ring.run();
                pending.finish();
            }
        };
        main.postDelayed(ringNow, PRE_RING_WAIT_MS);

        new Thread(() -> {
            Result result = check(app);
            main.post(() -> {
                if (result != Result.DELETED) {
                    ringNow.run(); // まだ鳴らしていなければ、ここで鳴らす
                    return;
                }
                main.removeCallbacks(ringNow);
                boolean notRungYet = decided.compareAndSet(false, true);
                forgetIfStill(app, checkedKey); // 鳴り始めていれば、ここで止まる
                if (notRungYet) pending.finish();
            });
        }, "MediAlarmAccountCheck").start();
    }

    // ---- 2. アプリを開いたとき ----

    /** アプリが見えるようになったとき（MainActivity.onStart）。裏で確かめ、削除されていたら止めて消す */
    public static void checkOnAppShown(Context context) {
        Context app = context.getApplicationContext();
        String checkedKey = key(app);
        long now = SystemClock.elapsedRealtime();
        if (checkedKey == null || now - lastAppCheckAt < APP_CHECK_INTERVAL_MS) return;
        lastAppCheckAt = now;
        new Thread(() -> {
            if (check(app) == Result.DELETED) main.post(() -> forgetIfStill(app, checkedKey));
        }, "MediAlarmAccountCheck").start();
    }

    // ---- 3. サーバーからの知らせ ----

    /**
     * アプリの「アカウントを削除する」で消したとき、サーバーから届く知らせ（AccountMessagingService）。
     * 端末のアラームの予定が、消したアカウントのもの（または、誰のものか分からない）ときだけ消す。
     * 知らせは、この端末を通知の宛先として登録したアカウントにだけ送られる。
     */
    static void onAccountDeletedMessage(Context context, String deletedUserId) {
        Context app = context.getApplicationContext();
        main.post(() -> {
            String owner = userId(app);
            if (owner != null && !owner.equals(deletedUserId)) return; // 別のアカウントでログインし直している
            Log.i(TAG, "アカウントの削除の知らせが届いたため、この端末のアラームを止めて、予定を消しました");
            forget(app);
        });
    }
}
