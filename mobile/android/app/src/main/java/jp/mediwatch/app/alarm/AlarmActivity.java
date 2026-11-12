package jp.mediwatch.app.alarm;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.lang.ref.WeakReference;
import java.util.List;

/**
 * 服薬時刻に画面いっぱいに出すアラーム画面。
 * ロック中でも表示し（showWhenLocked）、画面が消えていれば点ける（turnScreenOn）。
 *
 * - 「カメラを起動する」… ロックを解除して、アプリのホームで撮影を始める
 * - 「あとで（5分後）」 … 音を止め、5 分後にもう一度鳴らす
 * 戻るボタンでは閉じない（どちらかのボタンを押してもらうため）。
 */
public class AlarmActivity extends AppCompatActivity {

    // 色は Web 版（public/css/base.css）と合わせる
    private static final int COLOR_INDIGO = Color.parseColor("#2C4A52");
    private static final int COLOR_TERRACOTTA = Color.parseColor("#D97D54");
    private static final int COLOR_PAPER = Color.parseColor("#FBF7F0");

    private static WeakReference<AlarmActivity> current = new WeakReference<>(null);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView timeView;
    private TextView medsView;

    /** 記録が済んだときなどに、開いているアラーム画面を閉じる */
    static void closeIfOpen() {
        AlarmActivity activity = current.get();
        if (activity != null) activity.runOnUiThread(activity::finish);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = new WeakReference<>(this);
        showOverLockScreen();
        setContentView(buildLayout());

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // 何もしない（ボタンで操作してもらう）
            }
        });

        // 出しっぱなしにならないよう、アラームを出す時間（60 分）が過ぎたら閉じる
        handler.postDelayed(this::finish, AlarmStore.ALARM_WINDOW_MS);
    }

    @Override
    protected void onResume() {
        super.onResume();
        AlarmStore store = new AlarmStore(this);
        List<AlarmStore.Item> items = store.ringing();
        if (items.isEmpty()) {
            finish(); // 記録が済んだ・「あとで」にした
            return;
        }
        AlarmStore.Schedule first = store.findSchedule(items.get(0).id);
        timeView.setText(first != null ? first.timeText() : "");
        medsView.setText(AlarmRinger.describe(store, items).replace("、", "\n"));
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private void onCamera() {
        String id = AlarmRinger.firstRingingId(this);
        if (id == null) {
            finish();
            return;
        }
        Intent take = AlarmRinger.takeIntent(this, id);

        // ロック中なら、先に解除してもらってからアプリを開く
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && km != null && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissSucceeded() {
                    openApp(take);
                }

                @Override
                public void onDismissCancelled() {
                    // 解除をやめた場合は、このアラーム画面のまま鳴らし続ける
                }
            });
        } else {
            openApp(take);
        }
    }

    private void openApp(Intent take) {
        AlarmRinger.dismiss(this); // 音を止める
        startActivity(take);
        finish();
    }

    private void onSnooze() {
        AlarmRinger.snooze(this);
        finish();
    }

    // ---- 画面（XML を使わずにコードで組み立てる） ----

    private View buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(COLOR_INDIGO);
        int pad = dp(24);
        root.setPadding(pad, pad, pad, pad);
        // 画面の端（ステータスバー・ナビゲーションバー）に文字やボタンが重ならないようにする
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(pad + bars.left, pad + bars.top, pad + bars.right, pad + bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        timeView = text(56, true);
        root.addView(timeView);

        TextView title = text(34, true);
        title.setText("お薬の時間です");
        root.addView(title);

        medsView = text(26, false);
        LinearLayout.LayoutParams medsParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        medsParams.topMargin = dp(12);
        root.addView(medsView, medsParams);

        // 「カメラを起動する」は、残りの高さをすべて使う大きなボタンにする
        Button camera = button("カメラを起動する", 34, COLOR_TERRACOTTA, Color.WHITE);
        camera.setOnClickListener(v -> onCamera());
        LinearLayout.LayoutParams cameraParams = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        cameraParams.topMargin = dp(24);
        cameraParams.bottomMargin = dp(16);
        camera.setMinHeight(dp(160));
        root.addView(camera, cameraParams);

        Button snooze = button("あとで（5分後にもう一度お知らせ）", 22, COLOR_PAPER, COLOR_INDIGO);
        snooze.setOnClickListener(v -> onSnooze());
        root.addView(snooze, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(72)));

        TextView note = text(17, false);
        note.setText("映像なしで記録するときや、スキップするときは、「カメラを起動する」を押すと出る画面から選べます。");
        LinearLayout.LayoutParams noteParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        noteParams.topMargin = dp(12);
        root.addView(note, noteParams);
        return root;
    }

    private TextView text(int sp, boolean bold) {
        TextView tv = new TextView(this);
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        tv.setGravity(Gravity.CENTER);
        if (bold) tv.setTypeface(Typeface.DEFAULT_BOLD);
        return tv;
    }

    private Button button(String label, int sp, int background, int textColor) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(textColor);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(background);
        bg.setCornerRadius(dp(28));
        b.setBackground(bg);
        return b;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }
}
