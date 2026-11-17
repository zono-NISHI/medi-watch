package jp.mediwatch.app.alarm;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import java.util.Locale;

/**
 * アプリの画面（public/js/alarm.js の「お薬の時間です」の画面）から頼まれた文を、1 回だけ読み上げる。
 *
 * 端末のアラーム（AlarmSound）が鳴っていないあいだに、画面のアラームが声で知らせるために使う。
 * 例: 同じ時刻のお薬が 2 つあり、1 つ目を記録したあと、残りのお薬を画面が案内するとき
 *     （「お薬の時間です。□□を1包服用してください。」と、残りのお薬だけを読み上げる）。
 * アプリの画面（WebView）は読み上げの機能を持たないので、端末の読み上げ機能（TextToSpeech）を使う。
 *
 * - 端末のアラームが鳴っているあいだは読み上げない（アラームの音・読み上げと重なるため）。
 *   アラームが鳴り始めたら、読み上げている途中でも止める（AlarmRinger.ring から stop を呼ぶ）。
 * - アラームの音や振動は出さない（画面を操作している最中なので、声だけで知らせる）。
 * - 声は、アラームの読み上げと同じく「アラーム」の音量で鳴る。
 *   読み上げているあいだは、アプリの画面でも、音量ボタンで「アラーム」の音量を変えられるようにする（MediAlarmPlugin.announce）。
 * - 端末に日本語の読み上げが入っていない・使えないときは、何もしない（画面の表示だけで知らせる）。
 * - 読み上げ機能は、最後に読み上げてから 1 分使わなければ手放す。
 */
final class AlarmAnnouncer {

    private static final String TAG = "MediAlarm";
    /** 最後に読み上げを頼まれてから、読み上げ機能を手放すまでの時間 */
    private static final long RELEASE_AFTER_MS = 60L * 1000;
    private static final float SPEECH_RATE = 0.9f; // 少しゆっくり（アラームの読み上げと同じ）
    private static final AudioAttributes SPEECH_ATTRIBUTES = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build();

    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static final Runnable RELEASE = AlarmAnnouncer::release;
    private static TextToSpeech tts;
    private static boolean ready = false;
    /** 読み上げ機能の準備ができたら読み上げる文 */
    private static String pending = null;
    /** いま読み上げている文の番号（読み上げていなければ null） */
    private static String speakingId = null;
    private static int utteranceCount = 0;
    /** 読み上げ機能を作り直すたびに増やす。手放したあとに届いた、前の回の知らせを無視するため */
    private static int generation = 0;
    private static AudioManager audioManager;
    private static AudioFocusRequest focusRequest;

    private AlarmAnnouncer() {}

    /** 読み上げる（読み上げている途中なら、新しい文に切り替える） */
    static void speak(Context context, String text) {
        if (text == null || text.trim().isEmpty()) return;
        Context app = context.getApplicationContext();
        // 読み上げ機能は、どこから呼ばれても同じスレッド（メイン）で扱う
        handler.post(() -> {
            if (alarmRinging(app)) return;
            handler.removeCallbacks(RELEASE);
            handler.postDelayed(RELEASE, RELEASE_AFTER_MS);
            if (tts != null && ready) {
                speakNow(app, text);
                return;
            }
            pending = text;
            if (tts == null) init(app);
        });
    }

    /** 読み上げを止める（画面のアラームを閉じたとき・端末のアラームが鳴り始めたとき） */
    static void stop() {
        handler.post(() -> {
            pending = null;
            speakingId = null;
            if (tts != null && ready) {
                try {
                    tts.stop();
                } catch (RuntimeException ignored) {
                    // すでに止まっている
                }
            }
            abandonFocus();
        });
    }

    private static boolean alarmRinging(Context app) {
        return !new AlarmStore(app).ringing().isEmpty();
    }

    private static void init(Context app) {
        final int gen = ++generation;
        ready = false;
        try {
            tts = new TextToSpeech(app, status -> handler.post(() -> onReady(app, gen, status)));
        } catch (RuntimeException e) {
            Log.w(TAG, "読み上げを準備できませんでした（画面の表示だけで知らせます）", e);
            tts = null;
            pending = null;
        }
    }

    private static void onReady(Context app, final int gen, int status) {
        if (gen != generation || tts == null) return; // もう手放した
        if (status != TextToSpeech.SUCCESS) {
            Log.w(TAG, "端末の読み上げ機能を使えませんでした（画面の表示だけで知らせます）");
            release();
            return;
        }
        try {
            int lang = tts.setLanguage(Locale.JAPAN);
            if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "端末に日本語の読み上げが入っていません（画面の表示だけで知らせます）");
                release();
                return;
            }
            tts.setAudioAttributes(SPEECH_ATTRIBUTES);
            tts.setSpeechRate(SPEECH_RATE);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {}

                @Override
                public void onDone(String utteranceId) {
                    handler.post(() -> onSpeechEnd(gen, utteranceId));
                }

                @Override
                public void onError(String utteranceId) {
                    handler.post(() -> onSpeechEnd(gen, utteranceId));
                }
            });
        } catch (RuntimeException e) {
            Log.w(TAG, "読み上げを準備できませんでした（画面の表示だけで知らせます）", e);
            release();
            return;
        }
        ready = true;
        String text = pending;
        pending = null;
        if (text != null) speakNow(app, text);
    }

    private static void speakNow(Context app, String text) {
        if (alarmRinging(app)) return; // 準備しているあいだに、端末のアラームが鳴り始めた
        requestFocus(app);
        final String id = "medi-announce-" + (++utteranceCount);
        speakingId = id;
        int result;
        try {
            result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
        } catch (RuntimeException e) {
            Log.w(TAG, "読み上げに失敗しました", e);
            result = TextToSpeech.ERROR;
        }
        if (result != TextToSpeech.SUCCESS) {
            speakingId = null;
            abandonFocus();
        }
    }

    /** 読み上げが終わった（失敗した）。小さくしてもらっていた音楽などを元に戻す */
    private static void onSpeechEnd(int gen, String utteranceId) {
        if (gen != generation || speakingId == null || !speakingId.equals(utteranceId)) return;
        speakingId = null;
        abandonFocus();
    }

    /** 読み上げ機能を手放す */
    private static void release() {
        generation++;
        handler.removeCallbacks(RELEASE);
        pending = null;
        speakingId = null;
        ready = false;
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (RuntimeException ignored) {
                // すでに止まっている
            }
            tts = null;
        }
        abandonFocus();
    }

    /** 音楽などを再生中なら、読み上げているあいだ小さくしてもらう */
    private static void requestFocus(Context app) {
        if (focusRequest != null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        audioManager = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) return;
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(SPEECH_ATTRIBUTES)
            .build();
        audioManager.requestAudioFocus(focusRequest);
    }

    private static void abandonFocus() {
        if (focusRequest == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (audioManager != null) audioManager.abandonAudioFocusRequest(focusRequest);
        focusRequest = null;
    }
}
