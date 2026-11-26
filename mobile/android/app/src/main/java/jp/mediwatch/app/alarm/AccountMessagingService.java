package jp.mediwatch.app.alarm;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Firebase Cloud Messaging の知らせを受け取る。
 *
 * ふだんの知らせ（ご家族のお知らせ）は、これまでどおり Capacitor のプッシュ通知のプラグイン
 * （親クラスの MessagingService）に渡し、アプリの画面（public/js/push.js）が扱う。
 *
 * 「アカウントを削除した」という知らせ（type = account_deleted。画面には何も出さないデータメッセージ）だけは、
 * ここで受け取って、端末のアラームを止め、保存した予定を消す（AlarmAccount）。
 * この知らせは、アプリを閉じていても届く（アプリを「強制停止」したときは届かないが、
 * その場合も、鳴らす前の確認で削除に気づく）。
 *
 * AndroidManifest.xml で、プラグインの MessagingService の代わりにこのクラスを登録している。
 */
public class AccountMessagingService extends MessagingService {

    static final String TYPE_ACCOUNT_DELETED = "account_deleted";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (TYPE_ACCOUNT_DELETED.equals(data.get("type"))) {
            AlarmAccount.onAccountDeletedMessage(this, data.get("userId"));
            return; // 画面には出さない知らせなので、プラグインには渡さない
        }
        super.onMessageReceived(remoteMessage);
    }
}
