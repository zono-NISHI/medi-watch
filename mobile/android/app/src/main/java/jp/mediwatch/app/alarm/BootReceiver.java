package jp.mediwatch.app.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 端末の再起動・アプリの更新・時刻の変更のあとに、アラームを予約し直す。
 * （AlarmManager の予約は、端末を再起動すると消えてしまうため）
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        AlarmScheduler.reschedule(context);
    }
}
