package jp.mediwatch.app.alarm;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.List;

/**
 * 鳴っているあいだに全画面（AlarmActivity）を離れたとき（ホームボタンなど）に、
 * 画面の上部に重ねて出す「お薬の時間です」の帯。
 *
 * 全画面を離れたときは、通知を画面上部に出る版（ヘッズアップ）に切り替えているが、
 * 実際に画面上部へ出すかどうかは Android（と機種ごとの設定）が決める。機種や設定によっては
 * 通知欄に入るだけで、上から下へ払わないと見えない。
 * そこで、「他のアプリの上に重ねて表示」の許可（アラームの設定で求めている）を使って、
 * アプリ自身で帯を出す。通知がどう扱われても、すぐ目に入る。
 *
 * - 帯を押す・「アラームを開く」… 全画面のアラームに戻る
 * - 「あとで（5分後）」        … 全画面の「あとで」と同じ
 * - 全画面に戻った・止めた・記録が済んだら消える。帯の外は、そのまま下の画面を操作できる
 * - ロック中は見えない（ロック画面では、通知と全画面で知らせる）。ロックを解除すると見える
 * - 「他のアプリの上に重ねて表示」が許可されていなければ出さない（通知だけで知らせる）
 */
final class AlarmBanner {

    private static final String TAG = "MediAlarm";
    // 色は全画面のアラーム（AlarmActivity）と合わせる
    private static final int COLOR_INDIGO = Color.parseColor("#2C4A52");
    private static final int COLOR_TERRACOTTA = Color.parseColor("#D97D54");
    private static final int COLOR_PAPER = Color.parseColor("#FBF7F0");

    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static View view;
    private static TextView titleView;
    private static TextView medsView;

    private AlarmBanner() {}

    /** 帯を出す（すでに出ていれば、内容だけ新しくする） */
    static void show(Context context) {
        Context app = context.getApplicationContext();
        handler.post(() -> showNow(app));
    }

    /** 帯が出ていれば、内容を新しくする（一部のお薬を記録したとき） */
    static void refresh(Context context) {
        Context app = context.getApplicationContext();
        handler.post(() -> {
            if (view != null) showNow(app);
        });
    }

    /** 帯を消す */
    static void hide() {
        handler.post(AlarmBanner::hideNow);
    }

    private static void showNow(Context app) {
        AlarmStore store = new AlarmStore(app);
        List<AlarmStore.Item> items = store.ringing();
        if (items.isEmpty() || AlarmActivity.isVisible()) {
            hideNow();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(app)) return;

        if (view == null) {
            WindowManager wm = (WindowManager) app.getSystemService(Context.WINDOW_SERVICE);
            if (wm == null) return;
            View built = build(app);
            try {
                wm.addView(built, layoutParams());
            } catch (RuntimeException e) {
                Log.w(TAG, "画面上部の帯を出せませんでした（通知だけで知らせます）", e);
                titleView = null;
                medsView = null;
                return;
            }
            view = built;
            Log.i(TAG, "画面上部に「お薬の時間です」の帯を出しました");
        }

        AlarmStore.Schedule first = store.findSchedule(items.get(0).id);
        titleView.setText((first != null ? first.timeText() + "　" : "") + "お薬の時間です");
        medsView.setText(AlarmRinger.describe(store, items));
    }

    private static void hideNow() {
        if (view == null) return;
        WindowManager wm = (WindowManager) view.getContext().getSystemService(Context.WINDOW_SERVICE);
        try {
            if (wm != null) wm.removeView(view);
        } catch (RuntimeException ignored) {
            // すでに消えている
        }
        view = null;
        titleView = null;
        medsView = null;
    }

    @SuppressWarnings("deprecation")
    private static WindowManager.LayoutParams layoutParams() {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            // 文字入力などは下の画面に渡す。帯の外に触れたときも、下の画面がそのまま受け取る
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        );
        lp.gravity = Gravity.TOP;
        return lp;
    }

    private static void openFullScreen(Context app) {
        try {
            app.startActivity(new Intent(app, AlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException e) {
            Log.w(TAG, "全画面のアラームを開けませんでした", e);
        }
    }

    // ---- 画面（XML を使わずにコードで組み立てる） ----

    private static View build(Context app) {
        LinearLayout card = new LinearLayout(app);
        card.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(app, 16);
        card.setPadding(pad, pad, pad, pad);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(COLOR_INDIGO);
        bg.setCornerRadius(dp(app, 20));
        card.setBackground(bg);
        card.setOnClickListener(v -> openFullScreen(app));

        titleView = text(app, 24, true);
        card.addView(titleView);
        medsView = text(app, 20, false);
        card.addView(medsView);

        LinearLayout row = new LinearLayout(app);
        row.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        rowParams.topMargin = dp(app, 12);

        Button open = button(app, "アラームを開く", COLOR_TERRACOTTA, Color.WHITE);
        open.setOnClickListener(v -> openFullScreen(app));
        row.addView(open, new LinearLayout.LayoutParams(0, dp(app, 64), 1f));

        Button snooze = button(app, "あとで（5分後）", COLOR_PAPER, COLOR_INDIGO);
        snooze.setOnClickListener(v -> AlarmRinger.snooze(app));
        LinearLayout.LayoutParams snoozeParams = new LinearLayout.LayoutParams(0, dp(app, 64), 1f);
        snoozeParams.leftMargin = dp(app, 12);
        row.addView(snooze, snoozeParams);

        card.addView(row, rowParams);

        // 画面の端から少し離す
        FrameLayout frame = new FrameLayout(app);
        int margin = dp(app, 8);
        frame.setPadding(margin, margin, margin, margin);
        frame.addView(card, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));
        return frame;
    }

    private static TextView text(Context app, int sp, boolean bold) {
        TextView tv = new TextView(app);
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        tv.setGravity(Gravity.CENTER);
        if (bold) tv.setTypeface(Typeface.DEFAULT_BOLD);
        return tv;
    }

    private static Button button(Context app, String label, int background, int textColor) {
        Button b = new Button(app);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(textColor);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(background);
        bg.setCornerRadius(dp(app, 20));
        b.setBackground(bg);
        return b;
    }

    private static int dp(Context app, int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, app.getResources().getDisplayMetrics()));
    }
}
