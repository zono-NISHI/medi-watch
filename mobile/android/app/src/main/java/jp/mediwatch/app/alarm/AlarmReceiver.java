package jp.mediwatch.app.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 予約した時刻になったとき（FIRE）と、通知の「あとで」を押したとき（SNOOZE）に呼ばれる。
 * アプリの外からは呼べない（AndroidManifest.xml で exported="false"）。
 */
public class AlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (AlarmScheduler.ACTION_FIRE.equals(action)) {
            AlarmScheduler.onAlarmFired(context);
        } else if (AlarmRinger.ACTION_SNOOZE.equals(action)) {
            AlarmRinger.snooze(context);
        }
    }
}
