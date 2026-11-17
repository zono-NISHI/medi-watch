package jp.mediwatch.app.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Iterator;
import java.util.List;
import jp.mediwatch.app.MainActivity;
import org.json.JSONObject;

/**
 * 端末の AlarmManager に「次に鳴らす時刻」を 1 つだけ予約する。
 *
 * setAlarmClock() は目覚まし時計と同じ扱いの予約で、省電力モード（Doze）中でも
 * 時刻どおりに動く。鳴ったら AlarmReceiver → onAlarmFired() で鳴らす予定を決め、
 * そのあとで次の時刻を予約し直す。
 */
public final class AlarmScheduler {

    private static final String TAG = "MediAlarm";
    static final String ACTION_FIRE = "jp.mediwatch.app.alarm.FIRE";

    private AlarmScheduler() {}

    /** 保存している予定から、次に鳴らす時刻を計算して予約し直す */
    public static void reschedule(Context context) {
        AlarmStore store = new AlarmStore(context);
        long now = System.currentTimeMillis();
        long next = Long.MAX_VALUE;

        for (AlarmStore.Schedule s : store.schedules()) {
            long at = nextOccurrence(store, s, now);
            if (at > 0 && at < next) next = at;
        }

        JSONObject snoozes = store.snoozes();
        Iterator<String> keys = snoozes.keys();
        while (keys.hasNext()) {
            JSONObject sn = snoozes.optJSONObject(keys.next());
            if (sn == null) continue;
            long at = Math.max(sn.optLong("at"), now + 1000);
            if (at < next) next = at;
        }

        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent fire = firePendingIntent(context);
        if (next == Long.MAX_VALUE) {
            am.cancel(fire);
            store.saveNextAt(0);
            return;
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                // 正確な時刻のアラームを許可されていない場合も、なるべく近い時刻に鳴らす
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, fire);
            } else {
                PendingIntent show = PendingIntent.getActivity(
                    context,
                    1,
                    new Intent(context, MainActivity.class),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(next, show), fire);
            }
            store.saveNextAt(next);
        } catch (SecurityException e) {
            Log.w(TAG, "アラームを予約できませんでした", e);
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, fire);
            store.saveNextAt(next);
        }
    }

    /**
     * 端末の電源を入れたあとに呼ぶ（BootReceiver）。
     *
     * 電源が切れているあいだに服薬時刻を過ぎた予定は、予約が消えているので鳴らない。
     * reschedule() は「今より後」の時刻しか予約しないため、そのままでは今日はもう鳴らず、
     * 利用者は服薬時刻を過ぎたことに気づけない。そこで、服薬時刻から 60 分以内
     * （画面のアラームと同じ範囲）で、まだ記録していない予定を、数秒後に鳴らす。
     *
     * ここで直接鳴らさず「あとで」と同じ仕組みで数秒後に予約するのは、Android 15 以降、
     * 起動時の知らせ（BOOT_COMPLETED）からは音を鳴らすサービスを始められないため
     * （アラームの予約から始めるのは許されている）。
     */
    static void catchUpAfterBoot(Context context) {
        AlarmStore store = new AlarmStore(context);
        long now = System.currentTimeMillis();
        long ringAt = now + AlarmStore.BOOT_CATCH_UP_DELAY_MS;
        JSONObject snoozes = store.snoozes();
        Calendar today = Calendar.getInstance();

        try {
            // 電源が切れているあいだに服薬時刻を過ぎた予定
            for (AlarmStore.Schedule s : store.schedules()) {
                long at = s.occurrenceOn(today);
                if (at < 0) continue;
                long late = now - at;
                if (late < 0 || late > AlarmStore.ALARM_WINDOW_MS) continue;
                if (store.isDoneToday(s.id) || store.lastAlerted(s.id) >= at) continue; // 記録済み・もう鳴らした
                if (s.updatedAt > at) continue; // 時刻を過ぎてから登録・変更した予定は鳴らさない（画面のアラームと同じ）
                store.markAlerted(s.id, at);
                snoozes.put(s.id, new JSONObject().put("at", ringAt).put("origin", at));
            }

            // 鳴っている最中に電源が切れた予定（音も通知も消えているので、もう一度鳴らす）
            for (AlarmStore.Item item : store.ringing()) {
                if (snoozes.has(item.id) || store.findSchedule(item.id) == null || store.isDoneToday(item.id)) continue;
                if (item.origin <= 0 || now - item.origin > AlarmStore.ALARM_WINDOW_MS) continue;
                snoozes.put(item.id, new JSONObject().put("at", ringAt).put("origin", item.origin));
            }
        } catch (org.json.JSONException ignored) {
            // put に失敗することはない（値は数値だけ）
        }

        store.saveRinging(new ArrayList<>()); // 再起動した時点で、鳴っているものは無い
        store.saveSnoozes(snoozes);
        reschedule(context);
    }

    /** 予約していたアラームの時刻になったとき（AlarmReceiver から呼ばれる） */
    static void onAlarmFired(Context context) {
        AlarmStore store = new AlarmStore(context);
        long now = System.currentTimeMillis();
        List<AlarmStore.Item> due = new ArrayList<>();

        // 服薬時刻になった予定（今日まだ記録しておらず、この時刻ではまだ鳴らしていないもの）
        Calendar today = Calendar.getInstance();
        for (AlarmStore.Schedule s : store.schedules()) {
            long at = s.occurrenceOn(today);
            if (at < 0) continue;
            long late = now - at;
            if (late < 0 || late > AlarmStore.LATE_TOLERANCE_MS) continue;
            if (store.isDoneToday(s.id) || store.lastAlerted(s.id) >= at) continue;
            store.markAlerted(s.id, at);
            due.add(new AlarmStore.Item(s.id, at));
        }

        // 「あとで」にしていた予定（記録待ち・アプリを離れたときの引き継ぎも、同じ仕組みで鳴らす）
        int handoffCount = 0;
        JSONObject snoozes = store.snoozes();
        List<String> finished = new ArrayList<>();
        Iterator<String> keys = snoozes.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            JSONObject sn = snoozes.optJSONObject(id);
            if (sn == null || sn.optLong("at") > now + 1000) continue;
            finished.add(id);
            long origin = sn.optLong("origin");
            boolean expired = now - origin > AlarmStore.ALARM_WINDOW_MS;
            if (!expired && !store.isDoneToday(id) && store.findSchedule(id) != null && !containsId(due, id)) {
                due.add(new AlarmStore.Item(id, origin));
                if (sn.optBoolean(AlarmStore.SNOOZE_HANDOFF, false)) handoffCount++;
            }
        }
        for (String id : finished) snoozes.remove(id);
        store.saveSnoozes(snoozes);

        if (!due.isEmpty()) {
            // アプリを離れたときの引き継ぎだけで鳴らすときは、全画面を開かず、音と画面上部の帯で知らせる
            // （服薬時刻・「あとで」の 5 分後のお薬が一緒なら、これまでどおり全画面を開く）
            boolean handoffOnly = handoffCount == due.size();
            boolean idleOrHandoff = store.ringing().isEmpty() || store.isHandoffRinging();
            AlarmRinger.ring(context, due, !handoffOnly);
            // 引き継ぎで鳴らしたアラームは、アプリに戻ったら止める（AlarmRinger.onAppShown）
            store.setHandoffRinging(handoffOnly && idleOrHandoff);
        }
        reschedule(context);
        AlarmRinger.updateSnoozeNotice(context); // 「あとで」の時刻になったお薬の「もう一度お知らせします」を消す
    }

    /** その予定を次に鳴らす時刻（今より後）。無ければ -1 */
    private static long nextOccurrence(AlarmStore store, AlarmStore.Schedule s, long now) {
        Calendar day = Calendar.getInstance();
        for (int i = 0; i <= 7; i++) {
            long at = s.occurrenceOn(day);
            day.add(Calendar.DAY_OF_MONTH, 1);
            if (at <= now) continue;
            if (i == 0 && store.isDoneToday(s.id)) continue; // 時刻より前に飲んだ・スキップした
            if (store.lastAlerted(s.id) >= at) continue;
            return at;
        }
        return -1;
    }

    static boolean containsId(List<AlarmStore.Item> items, String id) {
        for (AlarmStore.Item item : items) {
            if (item.id.equals(id)) return true;
        }
        return false;
    }

    private static PendingIntent firePendingIntent(Context context) {
        Intent intent = new Intent(context, AlarmReceiver.class).setAction(ACTION_FIRE);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
