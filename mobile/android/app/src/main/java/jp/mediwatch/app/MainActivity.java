package jp.mediwatch.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import jp.mediwatch.app.alarm.AlarmRinger;
import jp.mediwatch.app.alarm.MediAlarmPlugin;

/**
 * アプリ本体の画面。public/ の Web 画面を WebView で表示する（Capacitor）。
 * アラームの「カメラを起動する」から開かれたときは、ホームで撮影を始める
 * （home.html?take=スケジュールID。Web 版のアラームと同じ入り口）。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediAlarmPlugin.class);
        super.onCreate(savedInstanceState);
        openTakeIfRequested(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openTakeIfRequested(intent);
    }

    private void openTakeIfRequested(Intent intent) {
        String scheduleId = intent != null ? intent.getStringExtra(AlarmRinger.EXTRA_TAKE) : null;
        if (scheduleId == null || getBridge() == null) return;
        intent.removeExtra(AlarmRinger.EXTRA_TAKE); // 画面を回転したときなどに、もう一度開かないようにする
        // 通知の「カメラを起動する」から来たときも音を止める（鳴っていた予定は、5 分後に鳴らし直す予約として残す）
        AlarmRinger.holdForCamera(this);

        String url = getBridge().getLocalUrl() + "/home.html?take=" + Uri.encode(scheduleId);
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
    }
}
