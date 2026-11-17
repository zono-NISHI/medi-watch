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
 * （home.html?take=スケジュールID,スケジュールID…。鳴っていたお薬すべてを、1 回の撮影でまとめて記録する。
 *   Web 版のアラームと同じ入り口）。
 * アラームの「飲みました（映像なしで記録する）」から開かれたときは、ホームで映像なしの記録をする
 * （home.html?record=スケジュールID）。お薬が 2 つ以上のときは、ホームを開くだけにして、
 * アプリの中の「お薬の時間です」の画面で、お薬ごとに選んでもらう。
 */
public class MainActivity extends BridgeActivity {

    /**
     * 「映像なしで記録」の頼みを、押してからこの時間を過ぎていたら実行しない。
     * アプリが一度終了したあとで履歴から開き直すと、Android が前と同じ頼みをもう一度渡してくることがある。
     * そのまま実行すると、別の日に、押していないのに「飲んだ」と記録されてしまうため。
     */
    private static final long RECORD_REQUEST_MAX_AGE_MS = 60 * 1000;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediAlarmPlugin.class);
        super.onCreate(savedInstanceState);
        openFromAlarmIfRequested(getIntent());
    }

    /**
     * アプリが見えるようになったとき。アプリを離れていたあいだに、知らせていたお薬を端末のアラームが
     * 引き継いで鳴らしていれば止め、アプリの画面（「お薬の時間です」）が、また声で知らせる
     */
    @Override
    public void onStart() {
        super.onStart();
        AlarmRinger.onAppShown(this);
    }

    /**
     * アプリが見えなくなったとき（ホームに戻る・ほかのアプリを開く・画面を消す）。
     * アプリの画面で知らせていたお薬が、記録しないまま残っていれば、数秒後に端末のアラームが引き継いで鳴らす
     * （アプリの画面は、裏に回ると声で知らせられないため）。
     * JavaScript ではなくここで行うのは、アプリが裏に回ると、画面の JavaScript のタイマーが止まるため
     */
    @Override
    public void onStop() {
        AlarmRinger.onAppHidden(this);
        super.onStop();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openFromAlarmIfRequested(intent);
    }

    private void openFromAlarmIfRequested(Intent intent) {
        if (intent == null || getBridge() == null) return;
        String takeId = intent.getStringExtra(AlarmRinger.EXTRA_TAKE);
        String recordId = intent.getStringExtra(AlarmRinger.EXTRA_RECORD);
        long recordAt = intent.getLongExtra(AlarmRinger.EXTRA_RECORD_AT, 0);
        boolean choose = intent.getBooleanExtra(AlarmRinger.EXTRA_CHOOSE, false);
        // 画面を回転したときなどに、もう一度開かないようにする
        intent.removeExtra(AlarmRinger.EXTRA_TAKE);
        intent.removeExtra(AlarmRinger.EXTRA_RECORD);
        intent.removeExtra(AlarmRinger.EXTRA_RECORD_AT);
        intent.removeExtra(AlarmRinger.EXTRA_CHOOSE);

        // 古い「映像なしで記録」の頼みは実行しない（RECORD_REQUEST_MAX_AGE_MS を参照）
        long age = System.currentTimeMillis() - recordAt;
        if (recordId != null && (age < 0 || age > RECORD_REQUEST_MAX_AGE_MS)) recordId = null;

        String page;
        if (takeId != null) {
            page = "/home.html?take=" + Uri.encode(takeId);
        } else if (recordId != null) {
            page = "/home.html?record=" + Uri.encode(recordId);
        } else if (choose) {
            page = "/home.html"; // アプリの中の「お薬の時間です」の画面が、お薬ごとのボタンを出す
        } else {
            return;
        }
        // 通知の「カメラを起動する」から来たときも音を止める（鳴っていた予定は、5 分後に鳴らし直す予約として残す）
        AlarmRinger.hold(this);

        String url = getBridge().getLocalUrl() + page;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
    }
}
