package jp.mediwatch.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import jp.mediwatch.app.alarm.AlarmAccount;
import jp.mediwatch.app.alarm.AlarmRinger;
import jp.mediwatch.app.alarm.MediAlarmPlugin;

/**
 * アプリ本体の画面。public/ の Web 画面を WebView で表示する（Capacitor）。
 * アラームの「カメラを起動する」「カメラで記録する」から開かれたときは、ホームでそのお薬の撮影を始める
 * （home.html?take=スケジュールID。Web 版のアラームと同じ入り口）。
 * アラームの「飲みました（映像なしで記録する）」から開かれたときは、ホームでそのお薬の映像なしの記録をする
 * （home.html?record=スケジュールID）。撮影・記録はお薬 1 つずつで、残りのお薬はアプリの中のアラームが続けて知らせる。
 * 確認メールのボタンから開いたブラウザの画面の「アプリで確認を完了する」から開かれたときは、
 * アプリのメール確認画面で確認を済ませる（openVerifyEmailIfRequested）。
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
        // アカウントが削除されていたら、端末のアラームを止めて予定を消す（裏で確かめる。AlarmAccount）
        AlarmAccount.checkOnAppShown(this);
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

    /** 確認メールのボタンの token_hash として受け付ける形（サーバーの TOKEN_HASH_PATTERN と同じ） */
    private static final java.util.regex.Pattern TOKEN_HASH_PATTERN =
            java.util.regex.Pattern.compile("^[A-Za-z0-9_-]{16,256}$");

    /**
     * 確認メールのボタンから開いたブラウザの画面で「アプリで確認を完了する」を押したとき
     * （mediwatch://verify-email?token_hash=…）。アプリのメール確認画面を、そのボタンの情報つきで開き直す
     * （verify-email.html?token_hash=…&from=app-link。画面がそのまま確認を済ませ、ホームへ進む）。
     * 「メールをご確認ください」の画面のまま待っていたアプリが、そのまま先へ進めるようにするため。
     *
     * @return メール確認の頼みだったら true
     */
    private boolean openVerifyEmailIfRequested(Intent intent) {
        Uri data = intent.getData();
        if (data == null || !"mediwatch".equals(data.getScheme()) || !"verify-email".equals(data.getHost())) {
            return false;
        }
        // 画面を回転したとき・履歴から開き直したときに、もう一度開かないようにする
        intent.setData(null);

        String tokenHash = data.getQueryParameter("token_hash");
        String page = (tokenHash != null && TOKEN_HASH_PATTERN.matcher(tokenHash).matches())
                ? "/verify-email.html?token_hash=" + Uri.encode(tokenHash) + "&from=app-link"
                : "/verify-email.html"; // 形が正しくなければ、確認コードを入力する画面を出す

        String url = getBridge().getLocalUrl() + page;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
        return true;
    }

    private void openFromAlarmIfRequested(Intent intent) {
        if (intent == null || getBridge() == null) return;
        if (openVerifyEmailIfRequested(intent)) return;
        String takeId = intent.getStringExtra(AlarmRinger.EXTRA_TAKE);
        String recordId = intent.getStringExtra(AlarmRinger.EXTRA_RECORD);
        long recordAt = intent.getLongExtra(AlarmRinger.EXTRA_RECORD_AT, 0);
        // 画面を回転したときなどに、もう一度開かないようにする
        intent.removeExtra(AlarmRinger.EXTRA_TAKE);
        intent.removeExtra(AlarmRinger.EXTRA_RECORD);
        intent.removeExtra(AlarmRinger.EXTRA_RECORD_AT);

        // 古い「映像なしで記録」の頼みは実行しない（RECORD_REQUEST_MAX_AGE_MS を参照）
        long age = System.currentTimeMillis() - recordAt;
        if (recordId != null && (age < 0 || age > RECORD_REQUEST_MAX_AGE_MS)) recordId = null;

        String page;
        if (takeId != null) {
            page = "/home.html?take=" + Uri.encode(takeId);
        } else if (recordId != null) {
            page = "/home.html?record=" + Uri.encode(recordId);
        } else {
            return;
        }
        // 通知の「カメラを起動する」から来たときも音を止める（鳴っていた予定は、5 分後に鳴らし直す予約として残す）
        AlarmRinger.hold(this);

        String url = getBridge().getLocalUrl() + page;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
    }
}
