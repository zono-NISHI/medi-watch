package jp.mediwatch.app.alarm;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.text.SpannableString;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextClock;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.AccessibilityDelegateCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat;
import java.lang.ref.WeakReference;
import java.util.List;
import jp.mediwatch.app.R;

/**
 * 服薬時刻に画面いっぱいに出すアラーム画面。
 * ロック中でも表示し（showWhenLocked）、画面が消えていれば点ける（turnScreenOn）。
 *
 * - 「カメラを起動する」… ロックを解除して、アプリのホームで撮影を始める
 *                         （お薬が 2 つ以上のときは、鳴っているお薬すべてを 1 回の撮影でまとめて記録する。
 *                          どのお薬を記録するかは、撮影画面のチェックで選ぶ。ボタンにも「2つのお薬をまとめて記録します」と添える。
 *                          以前は、いちばん上のお薬だけを撮影していた。記録しないままになった予定は、5 分後にもう一度鳴らす）
 * - 「飲みました（映像なしで記録する）」… ロックを解除して、アプリのホームで映像なしの記録をする
 *                         （お薬が 2 つ以上のときは、アプリの中の画面で、記録するお薬にチェックを付けてもらう。onNoVideo を参照）
 * - 「あとで（5分後）」 … 音を止め、5 分後にもう一度鳴らす。お薬が 2 つ以上のときは「あとで（2つとも…）」と、
 *                         どれも「あとで」になることをボタンに書き、押したあとは「08:25 に、もう一度お知らせします」と
 *                         お薬の名前を数秒出してから閉じる（どのお薬がいつ知らされるのかを確かめられるように）
 * 戻るボタンでは閉じない（いずれかのボタンを押してもらうため）。
 *
 * 見た目は、アプリの中のアラーム（Web 版。public/js/alarm.js）と同じにする。
 * 紙色の背景・藍色の文字・テラコッタの「カメラを起動する」で、並び順と文字の大きさも合わせる。
 * 端末のアラームのあとに、アプリの中のアラームが続けて出ることがあり（同じ時刻のお薬の 2 つ目など）、
 * 同じ「お薬の時間です」が別のお知らせに見えないようにするため。
 * ボタンの並び（カメラ → 映像なし → あとで）も同じ。ただし、この画面はロック中にも出て、ログインの情報を持たないので、
 * 自分ではサーバーに記録しない。「映像なし」はアプリを開いて記録してもらい、お薬ごとのボタンは置かない。
 * スキップのボタンも置かず（押し間違えると、家族に「飲み忘れの可能性」と知らせが行くため）、
 * 「カメラを起動する」で開く撮影画面から選べることを 1 行で添える。
 *
 * 画面の上から順に、「いまの時刻 08:20」（小さめ）→「08:00 に飲む」「お薬の時間です」（大きく）→ お薬の名前 と並べる。
 * 大きな時刻は「飲む予定の時刻」なので、「あとで」のあとなどは、いまの時刻とずれる。
 * 取り違えないよう、予定の時刻は「08:00 に飲む お薬の時間です」と文の中に入れ、いまの時刻は言葉を添えて別に出す。
 * （以前は「08:00 の」だったが、「の」だけでは何の時刻かが伝わりにくいので、「に飲む」と動作を書く。
 *   「予約された」は、アプリのほかの画面で使っていない言葉で、病院の予約と取り違えやすいので使わない）
 * お薬の名前は、白い地にテラコッタの枠で囲む。見出し（藍色）とお薬の名前（墨色）は、どちらも黒に近い色で、
 * 文字の色だけでは区切りが分からないため（文字を明るい色に変えると、紙色の上で読みにくくなるので、
 * 文字は濃い色のまま、地と枠の色で分ける）。アプリの中のアラームで、お薬ごとの枠に使っているのと同じ色。
 * 「あとで」も、押せる場所が分かるよう枠で囲む。いちばん目立たせたいのは「カメラを起動する」なので、
 * 枠と文字は灰色にして、「映像なし」（藍色の枠）より控えめにする。
 * 以前はいちばん上に揺れるベルの印を置いていたが、その分（約 110dp）だけ「カメラを起動する」が小さくなるので外した
 * （何の知らせかは「お薬の時間です」の文字と、音・読み上げで伝わる。Web 版からも外してある）。
 *
 * 表示中は、画面上部のステータスバー（時計・電池など）を隠し、画面いっぱいを使う。
 * 見えている・見えなくなったことは AlarmRinger に伝え、通知の出し方（画面上部に出すか）を切り替える。
 */
public class AlarmActivity extends AppCompatActivity {

    // 色は Web 版（public/css/base.css の :root）と合わせる
    private static final int COLOR_PAPER = Color.parseColor("#FBF7F0"); // 背景（紙の色）
    private static final int COLOR_INK = Color.parseColor("#33312E"); // お薬の名前
    private static final int COLOR_INK_SOFT = Color.parseColor("#6B6660"); // いまの時刻・用量・案内文・「あとで」の枠と文字
    private static final int COLOR_INDIGO = Color.parseColor("#2C4A52"); // 「飲みました（映像なしで記録する）」の枠と文字
    private static final int COLOR_INDIGO_DEEP = Color.parseColor("#1D3338"); // 予定の時刻・「お薬の時間です」
    private static final int COLOR_TERRACOTTA = Color.parseColor("#D97D54"); // 「カメラを起動する」・お薬の名前の枠
    private static final int COLOR_TERRACOTTA_DEEP = Color.parseColor("#B8623E"); // 「カメラを起動する」を押しているあいだ
    private static final int COLOR_PRESSED_TINT = Color.argb(15, 44, 74, 82); // 枠だけのボタンを押しているあいだ（藍色の 6%）
    /** 見出しの書体（Web 版は Noto Serif JP。端末に入っている明朝体で出す） */
    private static final Typeface SERIF_BOLD = Typeface.create(Typeface.SERIF, Typeface.BOLD);
    /** 部品どうしの間隔（Web 版の --space-2 = 14px） */
    private static final int GAP = 14;

    private static WeakReference<AlarmActivity> current = new WeakReference<>(null);
    /** この画面がいま見えているか（onStart 〜 onStop のあいだ） */
    private static volatile boolean visible = false;

    static boolean isVisible() {
        return visible;
    }

    /** 「あとで」を押したあとの確認（「08:25 に、もう一度お知らせします」）を出しておく時間 */
    private static final long SNOOZE_CONFIRM_MS = 4000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView timeView;
    private TextView medsView;
    private TextView cameraSubView;
    private Button snoozeButton;
    /** 「あとで」の確認を出しているあいだ true（このあいだは、アラームが止まっても閉じない） */
    private boolean confirming = false;

    /** 記録が済んだときなどに、開いているアラーム画面を閉じる（「あとで」の確認を出しているあいだは、確認のあとで閉じる） */
    static void closeIfOpen() {
        AlarmActivity activity = current.get();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                if (!activity.confirming) activity.finish();
            });
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = new WeakReference<>(this);
        showOverLockScreen();
        // この画面で音量ボタンを押したら、着信音量ではなく、アラームの音量を変える
        // （アラームの音は「アラーム」の音量で鳴っているため）
        setVolumeControlStream(AudioManager.STREAM_ALARM);
        setContentView(buildLayout());
        useLightSystemBars();
        hideStatusBar();

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
    protected void onStart() {
        super.onStart();
        visible = true;
        // 全画面が見えているあいだは、画面上部に通知を出さない（出ていれば引っ込める）
        AlarmRinger.setFullScreenVisible(this, true);
    }

    @Override
    protected void onStop() {
        visible = false;
        // ホームボタンなどで、鳴っているまま全画面を離れたときは、画面上部にも通知を出して気付けるようにする。
        // 画面を消しただけのとき（点けるとこの画面に戻る）と、ボタンを押して閉じるときは、切り替えない。
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (!isFinishing() && pm != null && pm.isInteractive()) {
            AlarmRinger.setFullScreenVisible(this, false);
        }
        super.onStop();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // ステータスバーを引き出したあとなどに、また隠す
        if (hasFocus) hideStatusBar();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (confirming) return; // 「あとで」の確認を出している（まもなく閉じる）
        AlarmStore store = new AlarmStore(this);
        List<AlarmStore.Item> items = store.ringing();
        if (items.isEmpty()) {
            finish(); // 記録が済んだ・「あとで」にした
            return;
        }
        // 大きな時刻は、いちばん新しい服薬時刻（前の時刻から残っているお薬には、一覧の中でその時刻を添える）
        AlarmStore.Schedule latest = AlarmRinger.latestSchedule(store, items);
        timeView.setText(latest != null ? scheduledTimeText(latest.timeText()) : "");
        medsView.setText(medsText(store, items));
        // お薬が 2 つ以上のときは、カメラでまとめて記録すること・「あとで」がどれにも効くことをボタンに書く
        boolean multi = items.size() > 1;
        cameraSubView.setVisibility(multi ? View.VISIBLE : View.GONE);
        cameraSubView.setText(items.size() + "つのお薬をまとめて記録します");
        snoozeButton.setText(AlarmRinger.snoozeLabel(items.size(), true));
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

    /**
     * 背景が明るい紙色なので、下のナビゲーションバー（戻る・ホーム）と、一時的に出るステータスバーの
     * 地の色を紙色にし、印を濃い色にする（白い印のままだと、紙色の上で見えなくなるため）。
     * 印を濃い色にできるのは Android 8.0 以上。それより前は、これまでどおり黒いバーに白い印のままにする。
     */
    @SuppressWarnings("deprecation") // Android 15 以上では、バーの色は指定しなくても画面の背景が透けて見える
    private void useLightSystemBars() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        getWindow().setStatusBarColor(COLOR_PAPER);
        getWindow().setNavigationBarColor(COLOR_PAPER);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
    }

    /**
     * 画面上部のステータスバー（時計・電池など）を隠す。上から下へ払うと一時的に出る。
     * 下のナビゲーションバー（戻る・ホーム）は、操作に迷わないよう隠さない。
     */
    private void hideStatusBar() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.statusBars());
    }

    /** 鳴っているお薬すべてを、アプリの撮影画面で 1 回の撮影でまとめて記録する（記録するお薬は、撮影画面のチェックで選ぶ） */
    private void onCamera() {
        List<String> ids = AlarmRinger.ringingIds(this);
        if (ids.isEmpty()) {
            finish();
            return;
        }
        afterUnlock(() -> openApp(AlarmRinger.takeIntent(this, ids)));
    }

    /**
     * 「飲みました（映像なしで記録する）」… ロックを解除して、アプリのホームで記録する。
     * この画面はログインの情報を持たないので、記録はアプリの画面（public/js/pages/home.js）に任せる。
     * - お薬が 1 つ   … そのお薬を、映像なしで記録する
     * - お薬が 2 つ以上 … アプリを開き、アプリの中の「お薬の時間です」の画面で、飲んだお薬にチェックを付けて記録してもらう
     */
    private void onNoVideo() {
        List<AlarmStore.Item> ringing = new AlarmStore(this).ringing();
        if (ringing.isEmpty()) {
            finish();
            return;
        }
        String id = ringing.size() == 1 ? ringing.get(0).id : null;
        // 開く画面は、ロックを解除したあとで作る（記録を頼んだ時刻を入れるため。AlarmRinger.EXTRA_RECORD_AT）
        afterUnlock(() -> openApp(id != null ? AlarmRinger.recordIntent(this, id) : AlarmRinger.chooseIntent(this)));
    }

    /** ロック中なら、先に解除してもらってから続ける。解除をやめた場合は、このアラーム画面のまま鳴らし続ける */
    private void afterUnlock(Runnable next) {
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && km != null && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissSucceeded() {
                    next.run();
                }

                @Override
                public void onDismissCancelled() {
                    // 何もしない
                }
            });
        } else {
            next.run();
        }
    }

    private void openApp(Intent app) {
        // 音を止める。鳴っていた予定は、記録しないままになったときに備えて 5 分後に鳴らし直す予約にする
        AlarmRinger.hold(this);
        startActivity(app);
        finish();
    }

    /**
     * 「あとで」… 画面に出ているお薬すべてを 5 分後にもう一度鳴らす。
     * すぐには閉じず、「08:25 に、もう一度お知らせします」とお薬の名前を数秒出してから閉じる
     * （以前はすぐ閉じたので、どのお薬が「あとで」になったのか分からなかった）
     */
    private void onSnooze() {
        AlarmStore store = new AlarmStore(this);
        CharSequence meds = medsText(store, store.ringing());
        confirming = true; // アラームを止めたときに、この画面を閉じないようにする（closeIfOpen）
        long at = AlarmRinger.snooze(this);
        showSnoozeConfirmation(at, meds);
    }

    /** 「あとで」を押したあとの確認。画面のどこか・「閉じる」を押すか、数秒たつと閉じる */
    private void showSnoozeConfirmation(long at, CharSequence meds) {
        handler.removeCallbacksAndMessages(null);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(COLOR_PAPER);
        int pad = dp(24);
        root.setPadding(pad, pad, pad, pad);
        // アラームの画面と同じく、ナビゲーションバー・カメラの切り欠きに文字やボタンが重ならないようにする
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(pad + bars.left, pad + bars.top, pad + bars.right, pad + bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        root.setOnClickListener(v -> finish());

        TextView title = text(30, COLOR_INDIGO_DEEP, SERIF_BOLD);
        String time = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.JAPAN).format(new java.util.Date(at));
        title.setText(time + " に\nもう一度お知らせします");
        root.addView(title, below(0));

        TextView medsCopy = text(24, COLOR_INK, Typeface.DEFAULT_BOLD);
        GradientDrawable frame = rounded(Color.WHITE, dp(20));
        frame.setStroke(dp(2), COLOR_INK_SOFT);
        medsCopy.setBackground(frame);
        medsCopy.setPadding(dp(20), dp(GAP), dp(20), dp(GAP));
        medsCopy.setText(meds);
        root.addView(medsCopy, below(GAP * 2));

        TextView note = text(19, COLOR_INK_SOFT, Typeface.DEFAULT);
        note.setText("上のお薬を、5分後にもう一度お知らせします。");
        root.addView(note, below(GAP));

        Button close = new Button(this);
        close.setText("閉じる");
        close.setAllCaps(false);
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 21);
        close.setTypeface(Typeface.DEFAULT_BOLD);
        close.setTextColor(COLOR_INDIGO);
        close.setBackground(outlined(COLOR_INDIGO));
        close.setStateListAnimator(null);
        close.setMinHeight(dp(64));
        close.setOnClickListener(v -> finish());
        root.addView(close, below(GAP * 2));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(COLOR_PAPER);
        scroll.addView(root, new ScrollView.LayoutParams(ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);
        handler.postDelayed(this::finish, SNOOZE_CONFIRM_MS);
    }

    // ---- 画面（XML を使わずにコードで組み立てる） ----
    // 並び・色・文字の大きさは、Web 版のアラーム（public/js/alarm.js の buildDialog と、public/css/base.css の .alarm-*）に合わせる。
    // 文字の大きさ（sp）と余白（dp）は、Web 版の px の値をそのまま使う

    private View buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(COLOR_PAPER);
        int padX = dp(20);
        int padY = dp(28);
        root.setPadding(padX, padY, padX, padY);
        // 画面の端（ナビゲーションバー・カメラの切り欠き）に文字やボタンが重ならないようにする
        // （ステータスバーは隠しているので、その分の余白は 0 になる）
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(padX + bars.left, padY + bars.top, padX + bars.right, padY + bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        // いまの時刻（ステータスバーを隠していて端末の時計が見えないので、ここに出す）。
        // TextClock は、分が変わるたびに自分で表示を更新する。端末の設定が 12 時間制でも、予定の時刻と同じ 24 時間制で出す
        TextClock nowView = new TextClock(this);
        nowView.setFormat12Hour("'いまの時刻' HH:mm");
        nowView.setFormat24Hour("'いまの時刻' HH:mm");
        nowView.setTextColor(COLOR_INK_SOFT);
        nowView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        nowView.setTypeface(Typeface.DEFAULT_BOLD);
        nowView.setGravity(Gravity.CENTER);
        root.addView(nowView, below(0)); // いちばん上の部品なので、上のあいだは空けない

        // 飲む予定の時刻（「08:00 に飲む」）。下の「お薬の時間です」と続けて読める
        timeView = text(48, COLOR_INDIGO_DEEP, SERIF_BOLD);
        root.addView(timeView, below(GAP));

        TextView title = text(30, COLOR_INDIGO_DEEP, SERIF_BOLD);
        title.setText("お薬の時間です");
        root.addView(title, below(GAP));

        // お薬の名前は、白い地にテラコッタの枠で囲み、上の見出しと見分けられるようにする
        // （Web 版の .alarm-meds li。文字の色は、読みやすい濃い色のままにする）
        medsView = text(24, COLOR_INK, Typeface.DEFAULT_BOLD);
        GradientDrawable medsFrame = rounded(Color.WHITE, dp(20));
        medsFrame.setStroke(dp(2), COLOR_TERRACOTTA);
        medsView.setBackground(medsFrame);
        medsView.setPadding(dp(20), dp(GAP), dp(20), dp(GAP));
        root.addView(medsView, below(GAP));

        // 「カメラを起動する」は、残りの高さをすべて使う大きなボタンにする（印の下に文字）
        LinearLayout.LayoutParams cameraParams = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        cameraParams.topMargin = dp(GAP * 2);
        root.addView(cameraButton(), cameraParams);

        // 「飲みました（映像なしで記録する）」は、Web 版と同じく、藍色の枠だけのボタンにする（.btn-outline）
        Button noVideo = new Button(this);
        noVideo.setText("飲みました（映像なしで記録する）");
        noVideo.setAllCaps(false);
        noVideo.setTextSize(TypedValue.COMPLEX_UNIT_SP, 21);
        noVideo.setTypeface(Typeface.DEFAULT_BOLD);
        noVideo.setTextColor(COLOR_INDIGO);
        noVideo.setBackground(outlined(COLOR_INDIGO));
        noVideo.setStateListAnimator(null); // ボタンの影を出さない
        noVideo.setMinHeight(dp(64));
        noVideo.setPadding(dp(12), dp(12), dp(12), dp(12));
        noVideo.setOnClickListener(v -> onNoVideo());
        root.addView(noVideo, below(GAP));

        // スキップのボタンは、この画面には置かない（1 回押しただけで、家族に「飲み忘れの可能性」と知らせが行くため）。
        // どこで選べるかだけを、短く添える
        TextView note = text(19, COLOR_INK_SOFT, Typeface.DEFAULT);
        note.setText("飲まないときは、「カメラを起動する」の先で選べます。");
        root.addView(note, below(GAP));

        // 「あとで」は、Web 版と同じく、灰色の枠で囲んだ控えめなボタンにする（.alarm-dialog .btn-ghost）。
        // 枠が無いと、押せる場所だと分かりにくいため。「映像なし」（藍色の枠）より目立たない色にする
        // 文は onResume で、お薬の数に合わせる（2 つ以上なら「あとで（2つとも5分後にもう一度お知らせ）」）
        Button snooze = new Button(this);
        snoozeButton = snooze;
        snooze.setText(AlarmRinger.snoozeLabel(1, true));
        snooze.setAllCaps(false);
        snooze.setTextSize(TypedValue.COMPLEX_UNIT_SP, 21);
        snooze.setTypeface(Typeface.DEFAULT_BOLD);
        snooze.setTextColor(COLOR_INK_SOFT);
        snooze.setBackground(outlined(COLOR_INK_SOFT));
        snooze.setStateListAnimator(null); // ボタンの影を出さない
        snooze.setMinHeight(dp(72));
        snooze.setPadding(dp(16), dp(12), dp(16), dp(12));
        snooze.setOnClickListener(v -> onSnooze());
        root.addView(snooze, below(GAP));

        // 小さい画面・文字を大きくする設定・お薬が多いときに、収まらない分は縦に動かして見られるようにする。
        // 収まるときは、画面の高さいっぱいに広げ、余った高さを「カメラを起動する」が使う
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(COLOR_PAPER);
        scroll.addView(root, new ScrollView.LayoutParams(ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    /** 「カメラを起動する」ボタン（テラコッタの地に、カメラの印と文字を縦に並べる） */
    private View cameraButton() {
        LinearLayout camera = new LinearLayout(this);
        camera.setOrientation(LinearLayout.VERTICAL);
        camera.setGravity(Gravity.CENTER);
        camera.setMinimumHeight(dp(140));
        camera.setBackground(pressable(COLOR_TERRACOTTA, COLOR_TERRACOTTA_DEEP, dp(28)));
        camera.setElevation(dp(6));
        camera.setClickable(true);
        camera.setFocusable(true);
        camera.setContentDescription("カメラを起動する");
        camera.setOnClickListener(v -> onCamera());
        // 画面の読み上げ（TalkBack）に、ボタンとして伝える
        ViewCompat.setAccessibilityDelegate(camera, new AccessibilityDelegateCompat() {
            @Override
            public void onInitializeAccessibilityNodeInfo(View host, AccessibilityNodeInfoCompat info) {
                super.onInitializeAccessibilityNodeInfo(host, info);
                info.setClassName(Button.class.getName());
            }
        });

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_alarm_camera);
        camera.addView(icon, new LinearLayout.LayoutParams(dp(48), dp(48)));

        TextView label = text(30, Color.WHITE, Typeface.DEFAULT_BOLD);
        label.setText("カメラを起動する");
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        labelParams.topMargin = dp(8);
        camera.addView(label, labelParams);

        // お薬が 2 つ以上のときだけ出す「2つのお薬をまとめて記録します」（onResume で文と表示を決める）
        cameraSubView = text(19, Color.WHITE, Typeface.DEFAULT_BOLD);
        cameraSubView.setVisibility(View.GONE);
        LinearLayout.LayoutParams subParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        subParams.topMargin = dp(4);
        camera.addView(cameraSubView, subParams);
        return camera;
    }

    /** 「08:00 に飲む」… 時刻は大きく、「に飲む」は半分の大きさにする */
    private CharSequence scheduledTimeText(String time) {
        SpannableString s = new SpannableString(time + " に飲む");
        s.setSpan(new RelativeSizeSpan(0.5f), time.length(), s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return s;
    }

    /**
     * お薬の一覧（1 行に 1 つ）。名前は大きく、用量は少し小さく薄い色で添える（例: 「ロキソニン 1錠」）。
     * 前の時刻から残っているお薬には、その時刻を添える（例: 「07:30 アムロジン 1錠」）
     */
    private CharSequence medsText(AlarmStore store, List<AlarmStore.Item> items) {
        long latest = AlarmRinger.latestOrigin(items);
        SpannableStringBuilder sb = new SpannableStringBuilder();
        for (AlarmStore.Item item : items) {
            AlarmStore.Schedule s = store.findSchedule(item.id);
            if (s == null) continue;
            if (sb.length() > 0) sb.append("\n");
            if (AlarmRinger.isEarlier(item, latest)) {
                int from = sb.length();
                sb.append(s.timeText()).append(" ");
                sb.setSpan(new ForegroundColorSpan(COLOR_INDIGO_DEEP), from, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            sb.append(s.name);
            if (!s.amount.isEmpty()) {
                int from = sb.length();
                sb.append(" ").append(s.amount);
                sb.setSpan(new RelativeSizeSpan(19f / 24f), from, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                sb.setSpan(new ForegroundColorSpan(COLOR_INK_SOFT), from, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
        }
        return sb.length() > 0 ? sb : "お薬";
    }

    // ---- 小物 ----

    /** 上の部品とのあいだを空けて並べる（横幅いっぱい・高さは中身に合わせる） */
    private LinearLayout.LayoutParams below(int gapDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        lp.topMargin = dp(gapDp);
        return lp;
    }

    private TextView text(int sp, int color, Typeface typeface) {
        TextView tv = new TextView(this);
        tv.setTextColor(color);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        tv.setGravity(Gravity.CENTER);
        tv.setTypeface(typeface);
        return tv;
    }

    /** 角を丸めた地の色。押しているあいだは pressed の色になる */
    private Drawable pressable(int normal, int pressed, int radius) {
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] { android.R.attr.state_pressed }, rounded(pressed, radius));
        states.addState(new int[] {}, rounded(normal, radius));
        return states;
    }

    /** 枠だけのボタンの地（Web 版の .btn-outline）。stroke は枠の色。押しているあいだは、中に薄く色が付く */
    private Drawable outlined(int stroke) {
        StateListDrawable states = new StateListDrawable();
        for (int pressed = 1; pressed >= 0; pressed--) {
            GradientDrawable bg = rounded(pressed == 1 ? COLOR_PRESSED_TINT : Color.TRANSPARENT, dp(12));
            bg.setStroke(dp(2), stroke);
            states.addState(pressed == 1 ? new int[] { android.R.attr.state_pressed } : new int[] {}, bg);
        }
        return states;
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(radius);
        return bg;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }
}
