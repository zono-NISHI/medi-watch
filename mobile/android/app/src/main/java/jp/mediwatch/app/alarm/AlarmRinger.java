package jp.mediwatch.app.alarm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.util.ArrayList;
import java.util.List;
import jp.mediwatch.app.MainActivity;

/**
 * アラームを鳴らす・止める・「あとで」にする。
 *
 * - 音は通知で鳴らす。FLAG_INSISTENT を付けると、通知を消すまで音が繰り返し鳴り続ける。
 *   音の種類は「アラーム」（USAGE_ALARM）なので、着信音量ではなくアラーム音量で鳴る。
 * - 画面いっぱいの表示（AlarmActivity）は、次の 2 つの方法で出す。
 *   1. 通知の「全画面インテント」… 画面が消えている・ロック中のときに全画面で出る
 *   2. 「他のアプリの上に重ねて表示」の許可があれば、直接 AlarmActivity を開く
 *      … スマホを操作中（別のアプリを使用中）でも全画面で出る
 *      （1 だけだと、操作中は画面上部の小さな通知になってしまうため）
 */
public final class AlarmRinger {

    private static final String TAG = "MediAlarm";
    static final String CHANNEL_ID = "medication_alarm_v1";
    static final int NOTIFICATION_ID = 1001;
    public static final String EXTRA_TAKE = "jp.mediwatch.app.TAKE_SCHEDULE_ID";
    static final String ACTION_SNOOZE = "jp.mediwatch.app.alarm.SNOOZE";

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

        ensureChannel(context);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION_ID, buildNotification(context, store, items));

        // 操作中でも全画面で出す（「他のアプリの上に重ねて表示」が許可されていれば開ける）
        try {
            Intent show = new Intent(context, AlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(show);
        } catch (RuntimeException e) {
            Log.w(TAG, "全画面のアラームを開けませんでした（通知だけで知らせます）", e);
        }
    }

    /** 止める（カメラを起動したとき・記録が済んだとき） */
    public static void dismiss(Context context) {
        new AlarmStore(context).saveRinging(new ArrayList<>());
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(NOTIFICATION_ID);
        AlarmActivity.closeIfOpen();
    }

    /** 「あとで」… いま鳴っている予定を 5 分後にもう一度鳴らす */
    static void snooze(Context context) {
        AlarmStore store = new AlarmStore(context);
        long at = System.currentTimeMillis() + AlarmStore.SNOOZE_MS;
        org.json.JSONObject snoozes = store.snoozes();
        for (AlarmStore.Item item : store.ringing()) {
            try {
                snoozes.put(item.id, new org.json.JSONObject().put("at", at).put("origin", item.origin));
            } catch (org.json.JSONException ignored) {
                // put に失敗することはない
            }
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

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "お薬の時間のアラーム", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("服薬の時刻に、音を繰り返し鳴らしてお知らせします。");
        channel.setSound(
            alarmSound(),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        );
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 600, 400, 600, 400, 600 });
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(channel);
    }

    /** アラームのチャンネルが通知オフにされていないか */
    static boolean channelEnabled(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        ensureChannel(context);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = nm.getNotificationChannel(CHANNEL_ID);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private static Uri alarmSound() {
        Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        return uri != null ? uri : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
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

    private static Notification buildNotification(Context context, AlarmStore store, List<AlarmStore.Item> items) {
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

        AlarmStore.Schedule first = store.findSchedule(items.get(0).id);
        String title = (first != null ? first.timeText() + "　" : "") + "お薬の時間です";

        Notification n = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(describe(store, items) + "を飲みましょう")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSound(alarmSound(), android.media.AudioManager.STREAM_ALARM)
            .setVibrate(new long[] { 0, 600, 400, 600, 400, 600 })
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(AlarmStore.ALARM_WINDOW_MS)
            .setContentIntent(fullScreen)
            .setFullScreenIntent(fullScreen, true)
            .addAction(0, "カメラを起動する", camera)
            .addAction(0, "あとで（5分後）", snooze)
            .build();
        n.flags |= Notification.FLAG_INSISTENT; // 消すまで音を繰り返す
        return n;
    }
}
