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
    /** 通知の付け替えだけを頼むとき（60 分で止めるタイマーを延ばさない） */
    private static final String EXTRA_RELINK = "jp.mediwatch.app.alarm.RELINK";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> AlarmRinger.dismiss(this);
    private boolean timeoutPosted = false;

    /** 鳴らし始める（すでに鳴っていれば、通知の内容だけ新しくする） */
    static void start(Context context) {
        start(context, false);
    }

    /**
     * 通知の番号が変わったときに、サービスの通知を新しい番号の通知に付け替える
     * （AlarmRinger.setFullScreenVisible から呼ぶ）
     */
    static void relink(Context context) {
        start(context, true);
    }

    private static void start(Context context, boolean relink) {
        try {
            Intent intent = new Intent(context, AlarmSoundService.class).putExtra(EXTRA_RELINK, relink);
            ContextCompat.startForegroundService(context, intent);
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
        int id = AlarmRinger.notificationId();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(id, notification);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "アラームのサービスをフォアグラウンドにできませんでした", e);
        }
        // 新しい番号の通知に付け替えたので、もう一方の番号の通知（古い出し方のもの）を消す
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(AlarmRinger.otherNotificationId());

        if (items.isEmpty()) {
            // 鳴らす予定が無い（すでに記録した・「あとで」にした）
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        AlarmSound.start(this);
        // 鳴らしっぱなしにならないよう、アラームを出す時間（60 分）が過ぎたら止める。
        // 通知の付け替えだけのときは、すでに数え始めていれば延ばさない
        boolean relink = intent != null && intent.getBooleanExtra(EXTRA_RELINK, false);
        if (!relink || !timeoutPosted) {
            handler.removeCallbacks(timeout);
            handler.postDelayed(timeout, AlarmStore.ALARM_WINDOW_MS);
            timeoutPosted = true;
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(timeout);
        AlarmSound.stop(this);
        if (new AlarmStore(this).ringing().isEmpty()) AlarmRinger.cancelNotifications(this);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
