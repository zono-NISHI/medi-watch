package jp.mediwatch.app.alarm;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Web の画面（public/js/alarm.js の NativeAlarm）から呼ぶ、ネイティブのアラームの窓口。
 *
 * JavaScript からは window.Capacitor.nativePromise('MediAlarm', メソッド名, 引数) で呼び出す。
 * - sync(...)                       … 予定と「今日もう記録した予定」を渡し、アラームを予約し直す
 * - clear()                         … ログアウト時に、予約と保存した予定をすべて消す
 * - getStatus()                     … アラームに必要な許可がそろっているか
 * - requestNotificationPermission() … 通知の許可を求める（Android 13 以降）
 * - openSettings({ target })        … 許可を変える設定画面を開く
 */
@CapacitorPlugin(
    name = "MediAlarm",
    permissions = { @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }) }
)
public class MediAlarmPlugin extends Plugin {

    @PluginMethod
    public void sync(PluginCall call) {
        JSArray schedules = call.getArray("schedules", new JSArray());
        JSArray doneIds = call.getArray("doneIds", new JSArray());
        String date = call.getString("date", AlarmStore.today());

        Context context = getContext();
        AlarmStore store = new AlarmStore(context);
        store.saveSchedules(schedules);
        store.saveDone(date, doneIds);
        store.forgetRemovedSchedules();
        AlarmRinger.removeDone(context); // アプリで記録した予定のアラームを止める
        AlarmScheduler.reschedule(context);
        call.resolve(status());
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context context = getContext();
        AlarmRinger.dismiss(context);
        new AlarmStore(context).clearAll();
        AlarmScheduler.reschedule(context); // 予定が空なので、予約が取り消される
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(status());
            return;
        }
        requestPermissionForAlias("notifications", call, "onNotificationPermission");
    }

    @PermissionCallback
    private void onNotificationPermission(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String target = call.getString("target", "app");
        Context context = getContext();
        Uri pkg = Uri.parse("package:" + context.getPackageName());
        Intent intent;

        if ("notifications".equals(target) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        } else if ("fullScreen".equals(target) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg);
        } else if ("overlay".equals(target) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg);
        } else if ("exactAlarm".equals(target) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg);
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg);
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
        } catch (ActivityNotFoundException e) {
            // 機種によって専用の設定画面が無い場合は、アプリ情報の画面を開く
            context.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    /** アラームに必要な許可の状態（true = そろっている） */
    private JSObject status() {
        Context context = getContext();
        JSObject s = new JSObject();

        s.put("notifications", NotificationManagerCompat.from(context).areNotificationsEnabled() && AlarmRinger.channelEnabled(context));

        boolean fullScreen = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            fullScreen = nm.canUseFullScreenIntent();
        }
        s.put("fullScreen", fullScreen);

        s.put("overlay", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context));

        boolean exact = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            exact = am.canScheduleExactAlarms();
        }
        s.put("exactAlarm", exact);

        s.put("nextAlarmAt", new AlarmStore(context).nextAt()); // 予約が無ければ 0
        return s;
    }
}
