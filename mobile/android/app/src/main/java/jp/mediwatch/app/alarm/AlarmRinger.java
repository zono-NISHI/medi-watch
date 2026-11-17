package jp.mediwatch.app.alarm;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.util.ArrayList;
import java.util.List;
import jp.mediwatch.app.MainActivity;

/**
 * アラームを鳴らす・止める・「あとで」にする。
 *
 * - 音と振動は、アプリ自身で鳴らす（AlarmSoundService → AlarmSound）。止めるまで繰り返し鳴る。
 *   音のあいまに「お薬の時間です。○○を3錠服用してください。」と読み上げる（文は announcement で作る）。
 *   音の種類は「アラーム」（USAGE_ALARM）なので、着信音量ではなくアラーム音量で鳴る。
 *   （通知の音で鳴らすと、音量を一度 0 にしてから上げても鳴らなくなるため。AlarmSound を参照）
 * - 通知そのものは音を出さない。通知を横に払って消したときは、音を止めて 5 分後にもう一度鳴らす（hold）。
 * - 鳴っているまま全画面を離れたときは、画面上部に帯（AlarmBanner）を重ねて出す。
 *   帯を出しているあいだ、通知は画面上部に出ない版のままにする（帯と通知が重ならないように）。
 *   帯を出せないときだけ、通知を画面上部に出る版に切り替える。
 * - 画面いっぱいの表示（AlarmActivity）は、次の 2 つの方法で出す。
 *   1. 通知の「全画面インテント」… 画面が消えている・ロック中のときに全画面で出る
 *   2. 「他のアプリの上に重ねて表示」の許可があれば、直接 AlarmActivity を開く
 *      … スマホを操作中（別のアプリを使用中）でも全画面で出る
 *      （1 だけだと、操作中は画面上部の小さな通知になってしまうため）
 * - 通知は、全画面が見えているかどうかで出し方を変える。
 *   - 全画面が見えているとき … 画面上部に出ない通知（QUIET_CHANNEL_ID、全画面インテントなし）。
 *     通知欄には残る。全画面の上に上部の通知（ヘッズアップ）が重なって邪魔にならないようにするため。
 *   - それ以外（画面が消えている・ロック中・全画面を開けない・ホームボタンなどで全画面を離れた）
 *     … これまでどおり、重要度「高」＋全画面インテントの通知（CHANNEL_ID）。
 *   全画面を直接開いたつもりでも開けなかったときは、少し待ってから「高」の通知に出し直す。
 */
public final class AlarmRinger {

    private static final String TAG = "MediAlarm";
    static final String CHANNEL_ID = "medication_alarm_v2";
    /** 全画面が見えているあいだに使う、画面上部に出ない（ヘッズアップにならない）通知のチャンネル */
    static final String QUIET_CHANNEL_ID = "medication_alarm_quiet_v1";
    /** 以前の、通知の音で鳴らしていたチャンネル（チャンネルの音の設定は後から変えられないため、作り直した） */
    private static final String OLD_CHANNEL_ID = "medication_alarm_v1";
    static final int NOTIFICATION_ID = 1001;
    /**
     * 通知の出し方を切り替えるときに使う、もう1つの番号。
     * 同じ番号のまま書き換えても、Android は内容が同じなら「新しい知らせ」と見なさず、
     * 画面上部に出してくれない（通知欄の中が変わるだけ）。そのため、切り替えるたびに
     * 1001 と 1002 を入れ替えて新しい通知として出し、古い方は消す。
     */
    static final int NOTIFICATION_ID_ALT = 1002;
    /** いま出している通知の番号 */
    private static volatile int notificationId = NOTIFICATION_ID;
    public static final String EXTRA_TAKE = "jp.mediwatch.app.TAKE_SCHEDULE_ID";
    /** 全画面の「映像なしで「飲んだ」を記録」… 映像なしで記録する予定の id（お薬が 1 つのとき） */
    public static final String EXTRA_RECORD = "jp.mediwatch.app.RECORD_SCHEDULE_ID";
    /** EXTRA_RECORD を付けた時刻。古い頼みを、後からもう一度実行しないために付ける（MainActivity で確かめる） */
    public static final String EXTRA_RECORD_AT = "jp.mediwatch.app.RECORD_REQUESTED_AT";
    /** 全画面の「映像なしで「飲んだ」を記録」… お薬が 2 つ以上のとき。アプリの中の画面で、お薬ごとに選んでもらう */
    public static final String EXTRA_CHOOSE = "jp.mediwatch.app.CHOOSE_IN_APP";
    static final String ACTION_SNOOZE = "jp.mediwatch.app.alarm.SNOOZE";
    /** 通知を横に払って消したとき */
    static final String ACTION_DISMISSED = "jp.mediwatch.app.alarm.DISMISSED";
    /** 全画面を直接開いたあと、本当に開いたかを確かめるまでの時間 */
    private static final long FULL_SCREEN_CHECK_MS = 3000;

    private static final Handler handler = new Handler(Looper.getMainLooper());
    /** いま出している通知が「画面上部に出ない」版かどうか */
    private static volatile boolean quiet = false;

    private AlarmRinger() {}

    /** 鳴らす（すでに鳴っている予定があれば、まとめて知らせる） */
    static void ring(Context context, List<AlarmStore.Item> due) {
        AlarmStore store = new AlarmStore(context);
        long now = System.currentTimeMillis();

        List<AlarmStore.Item> items = new ArrayList<>();
        for (AlarmStore.Item item : store.ringing()) {
            // 時間が経ちすぎたもの・記録済みのものは除く
            if (now - item.origin <= AlarmStore.ALARM_WINDOW_MS && !store.isDoneToday(item.id) && !AlarmScheduler.containsId(due, item.id)) {
                items.add(item);
            }
        }
        items.addAll(due);
        store.saveRinging(items);
        AlarmAnnouncer.stop(); // 画面のアラームが読み上げていたら止める（ここからは、アラームの音と読み上げで知らせる）

        ensureChannel(context);
        // 全画面をそのまま開ける（または、もう開いている）なら、画面上部に出ない通知にする
        post(context, store, items, canShowFullScreenDirectly(context) || AlarmActivity.isVisible());
        AlarmSoundService.start(context); // 音と振動（止めるまで繰り返す）

        // 操作中でも全画面で出す（「他のアプリの上に重ねて表示」が許可されていれば開ける）
        try {
            Intent show = new Intent(context, AlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(show);
        } catch (RuntimeException e) {
            Log.w(TAG, "全画面のアラームを開けませんでした（通知だけで知らせます）", e);
            setFullScreenVisible(context, false);
            return;
        }

        if (quiet) {
            // 全画面が開かなかった場合（機種の制限など）に、知らせが通知欄だけにならないよう、
            // 少し待っても全画面が見えていなければ、画面上部にも出る通知に出し直す
            Context app = context.getApplicationContext();
            handler.postDelayed(() -> {
                if (!AlarmActivity.isVisible()) setFullScreenVisible(app, false);
            }, FULL_SCREEN_CHECK_MS);
        }
    }

    /**
     * 全画面（AlarmActivity）が見えるようになった・見えなくなったときに呼ぶ。
     * 鳴っているあいだだけ、知らせ方を切り替える。
     * - 見えている … 帯を消し、画面上部に出ない通知にする（出ている上部の通知も引っ込む）
     * - 見えない   … 画面上部に帯を出す（ホームボタンなどで全画面を離れても、払わずに目に入るように）。
     *                帯を出せないときは、代わりに通知を画面上部に出る版にする
     */
    static void setFullScreenVisible(Context context, boolean visible) {
        if (visible) {
            AlarmBanner.hide();
            setQuiet(context, true);
            return;
        }
        // 全画面を離れたときは、画面上部に帯（AlarmBanner）を出し、通知は画面上部に出さない（帯と重ならないように）。
        // 帯を出せないとき（「他のアプリの上に重ねて表示」が許可されていない など）だけ、通知を画面上部に出す
        if (AlarmBanner.canShow(context)) {
            AlarmBanner.show(context);
            setQuiet(context, true);
        } else {
            setQuiet(context, false);
        }
    }

    /** 帯を出そうとして出せなかったとき（AlarmBanner から呼ぶ）。代わりに通知を画面上部に出す */
    static void showHeadsUpInstead(Context context) {
        if (!AlarmActivity.isVisible()) setQuiet(context, false);
    }

    /** 通知を、画面上部に出ない版（true）・出る版（false）に切り替える。鳴っているあいだだけ */
    private static void setQuiet(Context context, boolean newQuiet) {
        if (quiet == newQuiet) return;
        AlarmStore store = new AlarmStore(context);
        List<AlarmStore.Item> items = store.ringing();
        if (items.isEmpty()) return;
        post(context, store, items, newQuiet);
        Log.i(TAG, newQuiet ? "通知を、画面上部に出ない版に切り替えました" : "通知を、画面上部に出る版に切り替えました");
        // 音を鳴らしているサービスの通知を、新しい番号の通知に付け替える（古い通知はそこで消える）
        AlarmSoundService.relink(context);
    }

    /**
     * 通知を出す。出し方（画面上部に出すか）が変わるときは、番号を入れ替えて新しい通知として出し、
     * 古い通知を消す（同じ番号の書き換えでは、画面上部に出ない・引っ込まないため）。
     */
    private static void post(Context context, AlarmStore store, List<AlarmStore.Item> items, boolean newQuiet) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        int oldId = notificationId;
        boolean changed = quiet != newQuiet;
        quiet = newQuiet;
        if (changed) notificationId = otherNotificationId();
        nm.notify(notificationId, buildNotification(context, store, items));
        // 古い通知がサービスに付いているあいだは消せない（無視される）。その場合は、
        // サービスが新しい通知に付け替えたときに消える（AlarmSoundService.onStartCommand）
        if (changed) nm.cancel(oldId);
    }

    /** いま出している通知の番号 */
    static int notificationId() {
        return notificationId;
    }

    /** いま使っていない方の通知の番号 */
    static int otherNotificationId() {
        return notificationId == NOTIFICATION_ID ? NOTIFICATION_ID_ALT : NOTIFICATION_ID;
    }

    /** アラームの通知を、どちらの番号のものもすべて消す */
    static void cancelNotifications(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(NOTIFICATION_ID);
        nm.cancel(NOTIFICATION_ID_ALT);
    }

    /**
     * 全画面をこちらから直接開いて、そのまま見てもらえる状態か。
     * 画面が点いていて、ロックが解除されていて、「他のアプリの上に重ねて表示」が許可されているとき。
     * （画面が消えている・ロック中のときは、通知の全画面インテントで全画面になるので、上部の通知は出ない）
     */
    private static boolean canShowFullScreenDirectly(Context context) {
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        boolean screenOn = pm != null && pm.isInteractive();
        boolean unlocked = km != null && !km.isKeyguardLocked();
        boolean overlay = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context);
        return screenOn && unlocked && overlay;
    }

    /** 止める（記録が済んだとき・ログアウトしたときなど。鳴らし直す予約は、呼ぶ側が必要に応じて入れる） */
    public static void dismiss(Context context) {
        handler.removeCallbacksAndMessages(null);
        new AlarmStore(context).saveRinging(new ArrayList<>());
        AlarmSoundService.stop(context);
        cancelNotifications(context);
        AlarmBanner.hide();
        AlarmActivity.closeIfOpen();
    }

    /** 「あとで」… いま鳴っている予定を 5 分後にもう一度鳴らす */
    static void snooze(Context context) {
        AlarmStore store = new AlarmStore(context);
        long at = System.currentTimeMillis() + AlarmStore.SNOOZE_MS;
        org.json.JSONObject snoozes = store.snoozes();
        for (AlarmStore.Item item : store.ringing()) putSnooze(snoozes, item, at, false);
        store.saveSnoozes(snoozes);
        dismiss(context);
        AlarmScheduler.reschedule(context);
    }

    /**
     * 「カメラを起動する」を押したとき（全画面・通知のどちらからでも）と、通知を横に払って消したとき。
     * 音を止めるが、鳴っていた予定は忘れずに「5 分後に鳴らし直す」予約として残す（記録待ち）。
     *
     * 通知を払ったときを「あとで」ではなく記録待ちにするのは、払ったあとでアプリを開いたときに、
     * アプリの画面のアラームで知らせるため（「あとで」にすると、そのあいだは画面のアラームも出さない。
     * 払うのは「あとで」ボタンと違って、片付けただけ・うっかり触れただけのことがある）。
     *
     * 同じ時刻のお薬が 2 つあるとき、カメラで記録するのは 1 つずつなので、ここで全部を「済んだ」扱いにすると、
     * 2 つ目は記録していないのに今日はもう鳴らなくなる。撮影画面を開けなかったときも同じ。
     * 記録が済んだ予定は、画面からの sync で予約から外れる（AlarmStore.forgetRemovedSchedules）ので、
     * 5 分後に鳴るのは、記録しないままになっている予定だけ。
     */
    public static void hold(Context context) {
        AlarmStore store = new AlarmStore(context);
        List<AlarmStore.Item> ringing = store.ringing();
        if (!ringing.isEmpty()) {
            long at = System.currentTimeMillis() + AlarmStore.SNOOZE_MS;
            org.json.JSONObject snoozes = store.snoozes();
            for (AlarmStore.Item item : ringing) putSnooze(snoozes, item, at, true);
            store.saveSnoozes(snoozes);
        }
        dismiss(context);
        AlarmScheduler.reschedule(context);
    }

    /**
     * 鳴らし直す予約を 1 件入れる。
     * hold … true: 記録待ち（「カメラを起動する」のあと。画面のアラームは出してよい）
     *        false: 利用者が「あとで」を選んだ（そのあいだは画面のアラームも出さない）
     */
    private static void putSnooze(org.json.JSONObject snoozes, AlarmStore.Item item, long at, boolean hold) {
        try {
            snoozes.put(
                item.id,
                new org.json.JSONObject().put("at", at).put("origin", item.origin).put(AlarmStore.SNOOZE_HOLD, hold)
            );
        } catch (org.json.JSONException ignored) {
            // put に失敗することはない（値は数値と真偽値だけ）
        }
    }

    /**
     * アプリの画面から、5 分後に鳴らし直す予約を入れる。
     * - hold = false … 「あとで」にする（画面の「あとで」・撮影画面を記録せずに閉じたとき）
     * - hold = true  … 記録待ちにする（撮影画面を開いたとき。撮影の最中に鳴り出さないよう、5 分を数え直す）
     * 「カメラを起動する」を押した時点でアラームは止めてあり、鳴っている予定は残っていないので、
     * どの予定を鳴らし直すかは画面側から受け取る。まだ鳴っている予定があれば、それも一緒に予約する。
     */
    static void snoozeFromApp(Context context, List<AlarmStore.Item> items, boolean hold) {
        AlarmStore store = new AlarmStore(context);
        long now = System.currentTimeMillis();
        long at = now + AlarmStore.SNOOZE_MS;

        List<AlarmStore.Item> targets = new ArrayList<>(store.ringing());
        for (AlarmStore.Item item : items) {
            if (!AlarmScheduler.containsId(targets, item.id)) targets.add(item);
        }

        org.json.JSONObject snoozes = store.snoozes();
        for (AlarmStore.Item item : targets) {
            // 予定に無い・記録済み・服薬時刻から時間が経ちすぎたものは鳴らし直さない
            if (store.findSchedule(item.id) == null || store.isDoneToday(item.id)) continue;
            if (item.origin <= 0 || now - item.origin > AlarmStore.ALARM_WINDOW_MS) continue;
            putSnooze(snoozes, item, at, hold);
        }
        store.saveSnoozes(snoozes);
        dismiss(context);
        AlarmScheduler.reschedule(context);
    }

    /** 記録が済んだ予定を、鳴っている予定から外す。全部済んだら止める */
    static void removeDone(Context context) {
        AlarmStore store = new AlarmStore(context);
        List<AlarmStore.Item> current = store.ringing();
        if (current.isEmpty()) return;
        List<AlarmStore.Item> remaining = new ArrayList<>();
        for (AlarmStore.Item item : current) {
            if (!store.isDoneToday(item.id) && store.findSchedule(item.id) != null) remaining.add(item);
        }
        if (remaining.isEmpty()) {
            dismiss(context);
        } else if (remaining.size() != current.size()) {
            store.saveRinging(remaining);
            // 通知の内容と読み上げる文を、まだ記録していないお薬だけに直す
            // （記録が済んだお薬まで「服用してください」と読み上げ続けないように）
            AlarmSoundService.relink(context);
            AlarmBanner.refresh(context);
        }
    }

    /** 最初に鳴らす予定（カメラで記録するお薬）の id */
    static String firstRingingId(Context context) {
        List<AlarmStore.Item> items = new AlarmStore(context).ringing();
        return items.isEmpty() ? null : items.get(0).id;
    }

    /** 「カメラを起動する」を押したときに開く画面（アプリのホームで撮影を始める） */
    static Intent takeIntent(Context context, String scheduleId) {
        return new Intent(context, MainActivity.class)
            .putExtra(EXTRA_TAKE, scheduleId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    /**
     * 全画面の「映像なしで「飲んだ」を記録」を押したときに開く画面（お薬が 1 つのとき）。
     * アプリのホームが、そのお薬を映像なしで記録する。
     * 全画面のアラームはロック中にも出る画面で、ログインの情報を持たないので、記録そのものはアプリの画面に任せる。
     */
    static Intent recordIntent(Context context, String scheduleId) {
        return new Intent(context, MainActivity.class)
            .putExtra(EXTRA_RECORD, scheduleId)
            .putExtra(EXTRA_RECORD_AT, System.currentTimeMillis())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    /**
     * 全画面の「映像なしで「飲んだ」を記録」を押したときに開く画面（お薬が 2 つ以上のとき）。
     * アプリのホームを開くだけにし、アプリの中の「お薬の時間です」の画面で、飲んだお薬を 1 つずつ選んでもらう
     * （まとめて記録すると、飲んでいないお薬まで「飲んだ」になってしまうため）。
     */
    static Intent chooseIntent(Context context) {
        return new Intent(context, MainActivity.class)
            .putExtra(EXTRA_CHOOSE, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(OLD_CHANNEL_ID) != null) nm.deleteNotificationChannel(OLD_CHANNEL_ID);

        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "お薬の時間のアラーム", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("服薬の時刻に、画面いっぱいにお知らせします（音と振動はアプリが鳴らします）。");
            channel.setSound(null, null); // 音は AlarmSound が鳴らす（通知の音と二重にならないように）
            channel.enableVibration(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(channel);
        }

        if (nm.getNotificationChannel(QUIET_CHANNEL_ID) == null) {
            // 重要度「低」… 通知欄には出るが、画面上部には出ない（全画面の上に重ならない）
            NotificationChannel quietChannel = new NotificationChannel(
                QUIET_CHANNEL_ID,
                "お薬の時間のアラーム（画面表示中）",
                NotificationManager.IMPORTANCE_LOW
            );
            quietChannel.setDescription("アラームの画面を表示しているあいだ、通知欄にだけ出すお知らせです。");
            quietChannel.setSound(null, null);
            quietChannel.enableVibration(false);
            quietChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(quietChannel);
        }
    }

    /** アラームのチャンネルが通知オフにされていないか */
    static boolean channelEnabled(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        ensureChannel(context);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = nm.getNotificationChannel(CHANNEL_ID);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    /** 「お薬の時間です」の本文（例: 「08:00　ロキソニン 1錠、ガスター 1錠」） */
    static String describe(AlarmStore store, List<AlarmStore.Item> items) {
        StringBuilder sb = new StringBuilder();
        for (AlarmStore.Item item : items) {
            AlarmStore.Schedule s = store.findSchedule(item.id);
            if (s == null) continue;
            if (sb.length() > 0) sb.append("、");
            sb.append(s.label);
        }
        return sb.length() > 0 ? sb.toString() : "お薬";
    }

    /** 読み上げる文（例: 「お薬の時間です。ロキソニンを3錠、ガスターを1包服用してください。」） */
    static String announcement(AlarmStore store, List<AlarmStore.Item> items) {
        StringBuilder sb = new StringBuilder();
        for (AlarmStore.Item item : items) {
            AlarmStore.Schedule s = store.findSchedule(item.id);
            if (s == null) continue;
            if (sb.length() > 0) sb.append("、");
            sb.append(s.speech);
        }
        return "お薬の時間です。" + (sb.length() > 0 ? sb.toString() : "お薬を") + "服用してください。";
    }

    static Notification buildNotification(Context context, AlarmStore store, List<AlarmStore.Item> items) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullScreen = PendingIntent.getActivity(
            context,
            10,
            new Intent(context, AlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            flags
        );
        PendingIntent camera = PendingIntent.getActivity(context, 11, takeIntent(context, items.get(0).id), flags);
        PendingIntent snooze = PendingIntent.getBroadcast(
            context,
            12,
            new Intent(context, AlarmReceiver.class).setAction(ACTION_SNOOZE),
            flags
        );

        PendingIntent dismissed = PendingIntent.getBroadcast(
            context,
            13,
            new Intent(context, AlarmReceiver.class).setAction(ACTION_DISMISSED),
            flags
        );

        AlarmStore.Schedule first = store.findSchedule(items.get(0).id);
        String title = (first != null ? first.timeText() + "　" : "") + "お薬の時間です";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, quiet ? QUIET_CHANNEL_ID : CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(describe(store, items) + "を飲みましょう")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(quiet ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // setSilent(true) は付けない。付けると通知が「鳴らさないグループ」の扱いになり、
            // Android が画面上部への表示（ヘッズアップ）と全画面インテントを止めてしまう。
            // 音と振動は、チャンネルの設定（音なし・振動なし）で止めてある（鳴らすのは AlarmSound）
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(AlarmStore.ALARM_WINDOW_MS)
            .setContentIntent(fullScreen)
            // 通知を横に払って消したときは、音を止めて 5 分後にもう一度鳴らす（記録待ち。hold を参照）。
            // そのあいだにアプリを開けば、アプリの画面のアラームが知らせる
            .setDeleteIntent(dismissed)
            .addAction(0, "カメラを起動する", camera)
            .addAction(0, "あとで（5分後）", snooze);
        // 全画面インテントがあると、操作中は画面上部に通知が出るため、全画面が見えているあいだは付けない
        if (!quiet) builder.setFullScreenIntent(fullScreen, true);
        return builder.build();
    }
}
