package jp.mediwatch.app.alarm;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import java.util.Locale;

/**
 * アラームの音と振動を、アプリ自身で鳴らし続ける（止めるまで繰り返す）。
 *
 * 以前は通知の音（FLAG_INSISTENT）で鳴らしていたが、通知の音は
 * 「鳴らし始めた時点で音量が 0 なら鳴らさない」「鳴っているあいだに音量を 0 にすると
 * そこで止まる」という作りのため、音量を 0 にしてから上げても、もう鳴らなかった。
 * MediaPlayer で「アラーム」の音として繰り返し再生しておけば、音量が 0 のあいだも
 * 再生は続いているので、音量を上げるとその場で聞こえるようになる。
 *
 * 音だけでは何のお知らせか分からないので、アラームの音のあいまに
 * 「お薬の時間です。○○を3錠、□□を1包服用してください。」と読み上げる（端末の読み上げ機能 TextToSpeech）。
 * - 鳴り始めて少ししてから 1 回目を読み上げ、そのあとは「アラームの音 → 読み上げ」を止めるまで繰り返す。
 * - 読み上げているあいだは、声が聞き取りやすいようアラームの音を消す（再生は止めずに、音の大きさだけ 0 にする。
 *   再生を止めると、画面が消えているときに端末が眠ってしまい、続きが鳴らなくなるおそれがあるため）。
 * - 読み上げも「アラーム」の音量で鳴る。
 * - 端末に日本語の読み上げが入っていない・使えないときは、これまでどおりアラームの音だけで知らせる。
 *
 * アプリが裏にあっても止まらないよう、AlarmSoundService（フォアグラウンドサービス）から呼ぶ。
 */
final class AlarmSound {

    private static final String TAG = "MediAlarm";
    private static final long[] VIBRATION = { 0, 600, 400, 600, 400, 600, 1500 };
    private static final AudioAttributes ALARM_ATTRIBUTES = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build();

    /** 読み上げも「アラーム」の音量で鳴らす */
    private static final AudioAttributes SPEECH_ATTRIBUTES = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build();
    /** 鳴り始めてから、1 回目の読み上げまでの時間（まずアラームの音で気付いてもらう） */
    private static final long FIRST_SPEECH_DELAY_MS = 3000;
    /** 読み上げが終わってから、次の読み上げまでの時間（このあいだはアラームの音が鳴る） */
    private static final long SPEECH_GAP_MS = 8000;
    /** 読み上げの終わりの知らせが来なかったときに、アラームの音を戻すまでの時間 */
    private static final long SPEECH_WATCHDOG_MS = 40000;
    private static final float SPEECH_RATE = 0.9f; // 少しゆっくり

    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static MediaPlayer player;
    private static Vibrator vibrator;
    private static AudioFocusRequest focusRequest;
    private static TextToSpeech tts;
    private static boolean ttsReady = false;
    private static String announcement = "";
    /** いま読み上げている文の番号（読み上げていなければ null） */
    private static String speakingId = null;
    private static int utteranceCount = 0;
    /** 鳴らし始めるたびに増やす。止めたあとに届いた、前の回の知らせを無視するため */
    private static int generation = 0;

    private AlarmSound() {}

    /**
     * 鳴らし始める（すでに鳴っていれば、読み上げる文だけ新しくする）。
     * text: 読み上げる文（例: 「お薬の時間です。ロキソニンを3錠服用してください。」）
     */
    static synchronized void start(Context context, String text) {
        Context app = context.getApplicationContext();
        announcement = text != null ? text : "";
        if (player == null) {
            requestFocus(app);
            player = createPlayer(app);
        }
        if (vibrator == null) startVibration(app);
        if (tts == null) startSpeech(app);
    }

    /** 止める */
    static synchronized void stop(Context context) {
        stopSpeech();
        if (player != null) {
            try {
                player.stop();
            } catch (IllegalStateException ignored) {
                // すでに止まっている
            }
            player.release();
            player = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
        abandonFocus(context.getApplicationContext());
    }

    /** 端末のアラーム音（無ければ着信音・通知音）を、繰り返し再生する */
    private static MediaPlayer createPlayer(Context app) {
        int[] types = { RingtoneManager.TYPE_ALARM, RingtoneManager.TYPE_RINGTONE, RingtoneManager.TYPE_NOTIFICATION };
        for (int type : types) {
            Uri uri = RingtoneManager.getDefaultUri(type);
            if (uri == null) continue;
            MediaPlayer mp = new MediaPlayer();
            try {
                mp.setAudioAttributes(ALARM_ATTRIBUTES); // 「アラーム」の音量で鳴る
                mp.setDataSource(app, uri);
                mp.setLooping(true);
                mp.setWakeMode(app, PowerManager.PARTIAL_WAKE_LOCK); // 画面が消えていても鳴らし続ける
                mp.prepare();
                mp.start();
                return mp;
            } catch (Exception e) {
                Log.w(TAG, "アラームの音を再生できませんでした（別の音を試します）: " + uri, e);
                mp.release();
            }
        }
        Log.w(TAG, "アラームの音を再生できませんでした（振動だけで知らせます）");
        return null;
    }

    // ---- 読み上げ ----

    /** 端末の読み上げ機能の準備を始める（準備ができたら onSpeechReady が呼ばれる） */
    private static void startSpeech(Context app) {
        final int gen = ++generation;
        try {
            tts = new TextToSpeech(app, status -> handler.post(() -> onSpeechReady(gen, status)));
        } catch (RuntimeException e) {
            Log.w(TAG, "読み上げを準備できませんでした（アラームの音だけで知らせます）", e);
            tts = null;
        }
    }

    private static synchronized void onSpeechReady(final int gen, int status) {
        if (gen != generation || tts == null) return; // もう止めた
        if (status != TextToSpeech.SUCCESS) {
            Log.w(TAG, "端末の読み上げ機能を使えませんでした（アラームの音だけで知らせます）");
            return;
        }
        try {
            int lang = tts.setLanguage(Locale.JAPAN);
            if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "端末に日本語の読み上げが入っていません（アラームの音だけで知らせます）");
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
            Log.w(TAG, "読み上げを準備できませんでした（アラームの音だけで知らせます）", e);
            return;
        }
        ttsReady = true;
        handler.postDelayed(() -> speak(gen), FIRST_SPEECH_DELAY_MS);
    }

    /** 1 回読み上げる。読み上げているあいだは、アラームの音を消す */
    private static synchronized void speak(final int gen) {
        if (gen != generation || tts == null || !ttsReady || speakingId != null) return;
        if (announcement.isEmpty()) {
            handler.postDelayed(() -> speak(gen), SPEECH_GAP_MS);
            return;
        }
        final String id = "medi-alarm-" + (++utteranceCount);
        speakingId = id;
        setPlayerVolume(0f);
        int result;
        try {
            result = tts.speak(announcement, TextToSpeech.QUEUE_FLUSH, null, id);
        } catch (RuntimeException e) {
            Log.w(TAG, "読み上げに失敗しました", e);
            result = TextToSpeech.ERROR;
        }
        if (result != TextToSpeech.SUCCESS) {
            onSpeechEnd(gen, id);
            return;
        }
        // 終わりの知らせが来なくても、アラームの音が消えたままにならないようにする
        handler.postDelayed(() -> onSpeechEnd(gen, id), SPEECH_WATCHDOG_MS);
    }

    /** 読み上げが終わった（失敗した）。アラームの音を戻し、少ししてからもう一度読み上げる */
    private static synchronized void onSpeechEnd(final int gen, String utteranceId) {
        if (gen != generation || speakingId == null || !speakingId.equals(utteranceId)) return;
        speakingId = null;
        setPlayerVolume(1f);
        handler.postDelayed(() -> speak(gen), SPEECH_GAP_MS);
    }

    private static void stopSpeech() {
        generation++;
        handler.removeCallbacksAndMessages(null);
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (RuntimeException ignored) {
                // すでに止まっている
            }
            tts = null;
        }
        ttsReady = false;
        speakingId = null;
    }

    private static void setPlayerVolume(float volume) {
        if (player == null) return;
        try {
            player.setVolume(volume, volume);
        } catch (IllegalStateException ignored) {
            // すでに止まっている
        }
    }

    private static void startVibration(Context app) {
        Vibrator v = (Vibrator) app.getSystemService(Context.VIBRATOR_SERVICE);
        if (v == null || !v.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createWaveform(VIBRATION, 0), ALARM_ATTRIBUTES); // 0 = 最初から繰り返す
        } else {
            v.vibrate(VIBRATION, 0, ALARM_ATTRIBUTES);
        }
        vibrator = v;
    }

    /** 音楽などを再生中なら、アラームのあいだ止めてもらう */
    private static void requestFocus(Context app) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(ALARM_ATTRIBUTES)
            .build();
        am.requestAudioFocus(focusRequest);
    }

    private static void abandonFocus(Context app) {
        if (focusRequest == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am != null) am.abandonAudioFocusRequest(focusRequest);
        focusRequest = null;
    }
}
