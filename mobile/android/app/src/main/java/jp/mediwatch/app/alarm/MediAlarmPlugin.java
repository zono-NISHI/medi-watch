package jp.mediwatch.app.alarm;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
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
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * Web の画面（public/js/alarm.js の NativeAlarm）から呼ぶ、ネイティブのアラームの窓口。
 *
 * JavaScript からは window.Capacitor.nativePromise('MediAlarm', メソッド名, 引数) で呼び出す。
 * - sync(...)                       … 予定と「今日もう記録した予定」を渡し、アラームを予約し直す
 * - snooze({ items, hold })         … 画面から、5 分後にもう一度鳴らす予約を入れる（items は { id, origin: 本来の服薬時刻 }）。
 *                                     hold = false は「あとで」、true は記録待ち（撮影画面を開いたとき）
 * - getStatus() などの戻り値の snoozed … 端末のアラームで「あとで」にした予定（id → もう一度鳴らす時刻）
 * - announce({ text })              … 画面のアラームの文を 1 回読み上げる（端末のアラームが鳴っているあいだは読み上げない）。
 *                                     音量ボタンで「アラーム」の音量を変えられるようにする
 * - stopAnnounce()                  … その読み上げを止め、音量ボタンをいつもの音量に戻す
 * - clear()                         … ログアウト時に、予約と保存した予定をすべて消す
 * - getStatus()                     … アラームに必要な許可がそろっているか。
 *                                     changeable には、利用者が端末の設定画面で変えられる許可かどうかを入れる
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
    public void snooze(PluginCall call) {
        JSArray arr = call.getArray("items", new JSArray());
        List<AlarmStore.Item> items = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            String id = o.optString("id", "");
            if (!id.isEmpty()) items.add(new AlarmStore.Item(id, o.optLong("origin")));
        }
        AlarmRinger.snoozeFromApp(getContext(), items, Boolean.TRUE.equals(call.getBoolean("hold", false)));
        call.resolve(status());
    }

    @PluginMethod
    public void announce(PluginCall call) {
        AlarmAnnouncer.speak(getContext(), call.getString("text", ""));
        // 声は「アラーム」の音量で鳴るので、画面のアラームが読み上げているあいだは、
        // 音量ボタンで「アラーム」の音量を変えられるようにする（そのままだと「メディア」の音量が変わり、声の大きさは変わらない）
        setVolumeKeys(AudioManager.STREAM_ALARM);
        call.resolve();
    }

    @PluginMethod
    public void stopAnnounce(PluginCall call) {
        AlarmAnnouncer.stop();
        setVolumeKeys(AudioManager.USE_DEFAULT_STREAM_TYPE); // 音量ボタンを、いつもの音量（記録の映像の再生など）に戻す
        call.resolve();
    }

    /**
     * アプリの画面で音量ボタンを押したときに変わる音量を切り替える。
     * 端末のアラームの画面（AlarmActivity）は、自分で「アラーム」の音量にしている。
     */
    private void setVolumeKeys(int streamType) {
        Activity activity = getActivity();
        if (activity == null) return;
        activity.runOnUiThread(() -> activity.setVolumeControlStream(streamType));
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context context = getContext();
        AlarmAnnouncer.stop();
        setVolumeKeys(AudioManager.USE_DEFAULT_STREAM_TYPE);
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

        // 利用者が端末の設定画面で変えられる許可か（false なら、マイページに「設定を変える」を出さない）
        // - 全画面での通知: Android 14 から設定画面で変えられる（13 以前はいつも許可されている）
        // - ほかのアプリの上に重ねて表示: Android 6 から設定画面で変えられる
        // - アラームとリマインダー: 設定画面のスイッチ（SCHEDULE_EXACT_ALARM）を使うのは Android 12（31・32）だけ。
        //   Android 13 以降は、インストールした時点で受け取る USE_EXACT_ALARM でアラームを鳴らすため、
        //   設定画面のスイッチはオフのまま変えられない表示になるが、アラームは鳴る（マニフェストを参照）
        JSObject changeable = new JSObject();
        changeable.put("notifications", true);
        changeable.put("fullScreen", Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE);
        changeable.put("overlay", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M);
        changeable.put("exactAlarm", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU);
        s.put("changeable", changeable);

        AlarmStore store = new AlarmStore(context);
        s.put("nextAlarmAt", store.nextAt()); // 予約が無ければ 0
        // 端末のアラームで「あとで」にした予定（id → もう一度鳴らす時刻）。そのあいだは画面のアラームも出さない
        s.put("snoozed", store.userSnoozes());
        return s;
    }
}
