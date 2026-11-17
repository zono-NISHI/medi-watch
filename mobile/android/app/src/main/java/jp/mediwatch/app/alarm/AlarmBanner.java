package jp.mediwatch.app.alarm;

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
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
import androidx.core.content.ContextCompat;
import java.util.List;

/**
 * 鳴っているあいだに全画面（AlarmActivity）を離れたとき（ホームボタンなど）に、
 * 画面の上部に重ねて出す「お薬の時間です」の帯。
 *
 * 通知を画面上部に出る版（ヘッズアップ）にしても、実際に画面上部へ出すかどうかは
 * Android（と機種ごとの設定）が決める。機種や設定によっては通知欄に入るだけで、上から下へ払わないと見えない。
 * そこで、「他のアプリの上に重ねて表示」の許可（アラームの設定で求めている）を使って、
 * アプリ自身で帯を出す。通知がどう扱われても、すぐ目に入る。
 * 帯を出しているあいだ、通知は画面上部に出ない版のままにする（帯と通知が重なって、どちらを押すか迷わないように）。
 * 帯を出せなかったときだけ、代わりに通知を画面上部に出す（AlarmRinger.showHeadsUpInstead）。
 *
 * - 帯を押す・「アラームを開く」… 全画面のアラームに戻る
 * - 「あとで（5分後）」        … 全画面の「あとで」と同じ
 * - 全画面に戻った・止めた・記録が済んだら消える。帯の外は、そのまま下の画面を操作できる
 * - 帯を出しているあいだに画面を消して点け直すと、全画面のアラームを出し直す（帯はロック画面では見えないため）
 * - 「他のアプリの上に重ねて表示」が許可されていなければ出さない（通知を画面上部に出して知らせる）
 */
final class AlarmBanner {

    private static final String TAG = "MediAlarm";
    // 色は Web 版（public/css/base.css）の藍色・テラコッタ・紙色を使う。
    // 全画面のアラーム（AlarmActivity）は紙色の背景だが、帯はほかのアプリの画面の上に重ねて出すので、
    // どんな画面の上でも見分けられるよう、濃い藍色の地のままにする
    private static final int COLOR_INDIGO = Color.parseColor("#2C4A52");
    private static final int COLOR_TERRACOTTA = Color.parseColor("#D97D54");
    private static final int COLOR_PAPER = Color.parseColor("#FBF7F0");

    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static View view;
    private static TextView titleView;
    private static TextView medsView;
    private static BroadcastReceiver screenOnReceiver;

    private AlarmBanner() {}

    /**
     * いま帯を出せるか。「他のアプリの上に重ねて表示」が許可されていて、画面が点いていて、ロックが解除されているとき。
     * （ロック中は帯が見えないので、通知と全画面で知らせる）
     */
    static boolean canShow(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) return false;
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        return pm != null && pm.isInteractive() && km != null && !km.isKeyguardLocked();
    }

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(app)) {
            AlarmRinger.showHeadsUpInstead(app);
            return;
        }

        if (view == null) {
            WindowManager wm = (WindowManager) app.getSystemService(Context.WINDOW_SERVICE);
            View built = build(app);
            try {
                if (wm == null) throw new IllegalStateException("WindowManager がありません");
                wm.addView(built, layoutParams());
            } catch (RuntimeException e) {
                Log.w(TAG, "画面上部の帯を出せませんでした（代わりに通知を画面上部に出します）", e);
                titleView = null;
                medsView = null;
                AlarmRinger.showHeadsUpInstead(app);
                return;
            }
            view = built;
            registerScreenOn(app);
            Log.i(TAG, "画面上部に「お薬の時間です」の帯を出しました");
        }

        AlarmStore.Schedule first = store.findSchedule(items.get(0).id);
        titleView.setText((first != null ? first.timeText() + "　" : "") + "お薬の時間です");
        medsView.setText(AlarmRinger.describe(store, items));
    }

    /**
     * 帯を出しているあいだに画面を消して点け直したら、全画面のアラームを出し直す。
     * 帯はロック画面では見えず、通知も画面上部に出ない版にしているため、何もしないと
     * 点け直したときに、鳴っているのに何のお知らせか分かりにくい。
     * （画面を消したときではなく、点いたときに開く。消した直後に開くと、画面がすぐ点いてしまうため）
     */
    private static void registerScreenOn(Context app) {
        if (screenOnReceiver != null) return;
        screenOnReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                if (new AlarmStore(app).ringing().isEmpty() || AlarmActivity.isVisible()) return;
                openFullScreen(app);
            }
        };
        try {
            ContextCompat.registerReceiver(
                app,
                screenOnReceiver,
                new IntentFilter(Intent.ACTION_SCREEN_ON),
                ContextCompat.RECEIVER_NOT_EXPORTED
            );
        } catch (RuntimeException e) {
            Log.w(TAG, "画面が点いたことを受け取れませんでした", e);
            screenOnReceiver = null;
        }
    }

    private static void unregisterScreenOn() {
        if (screenOnReceiver == null || view == null) return;
        try {
            view.getContext().getApplicationContext().unregisterReceiver(screenOnReceiver);
        } catch (RuntimeException ignored) {
            // すでに外れている
        }
        screenOnReceiver = null;
    }

    private static void hideNow() {
        if (view == null) return;
        unregisterScreenOn();
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
