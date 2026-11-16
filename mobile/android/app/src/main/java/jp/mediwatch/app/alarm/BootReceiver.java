package jp.mediwatch.app.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 端末の再起動・アプリの更新・時刻の変更のあとに、アラームを予約し直す。
 * （AlarmManager の予約は、端末を再起動すると消えてしまうため）
 *
 * 電源を入れたとき（BOOT_COMPLETED）は、電源が切れているあいだに服薬時刻を過ぎて
 * 鳴らせなかった予定も鳴らす（AlarmScheduler.catchUpAfterBoot）。
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
            AlarmScheduler.catchUpAfterBoot(context);
        } else {
            AlarmScheduler.reschedule(context);
        }
    }
}
