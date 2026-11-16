package jp.mediwatch.app.alarm;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.util.List;

/**
 * アラームが鳴っているあいだだけ動くフォアグラウンドサービス。
 *
 * 音（AlarmSound）はアプリの中で鳴らすので、アプリが裏に回っても Android に
 * 止められないよう、鳴っているあいだはフォアグラウンドサービスにしておく。
 * サービスの通知は、アラームの通知（「お薬の時間です」）をそのまま使う。
 */
public class AlarmSoundService extends Service {

    private static final String TAG = "MediAlarm";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> AlarmRinger.dismiss(this);

    /** 鳴らし始める（すでに鳴っていれば、通知の内容だけ新しくする） */
    static void start(Context context) {
        try {
            ContextCompat.startForegroundService(context, new Intent(context, AlarmSoundService.class));
        } catch (RuntimeException e) {
            // 裏からサービスを始められない場合も、音だけは鳴らす
            Log.w(TAG, "アラームのサービスを開始できませんでした（音だけ鳴らします）", e);
            AlarmSound.start(context);
        }
    }

    /** 止める */
    static void stop(Context context) {
        context.stopService(new Intent(context, AlarmSoundService.class));
        AlarmSound.stop(context);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        AlarmStore store = new AlarmStore(this);
        List<AlarmStore.Item> items = store.ringing();

        // startForegroundService() で始めたら、必ず startForeground() を呼ぶ決まりがある
        Notification notification = items.isEmpty()
            ? new NotificationCompat.Builder(this, AlarmRinger.CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("お薬の時間です")
                .build()
            : AlarmRinger.buildNotification(this, store, items);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(AlarmRinger.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(AlarmRinger.NOTIFICATION_ID, notification);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "アラームのサービスをフォアグラウンドにできませんでした", e);
        }

        if (items.isEmpty()) {
            // 鳴らす予定が無い（すでに記録した・「あとで」にした）
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        AlarmSound.start(this);
        // 鳴らしっぱなしにならないよう、アラームを出す時間（60 分）が過ぎたら止める
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, AlarmStore.ALARM_WINDOW_MS);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(timeout);
        AlarmSound.stop(this);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (new AlarmStore(this).ringing().isEmpty()) nm.cancel(AlarmRinger.NOTIFICATION_ID);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
