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

        // 「あとで」にしていた予定
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
            }
        }
        for (String id : finished) snoozes.remove(id);
        store.saveSnoozes(snoozes);

        if (!due.isEmpty()) AlarmRinger.ring(context, due);
        reschedule(context);
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
