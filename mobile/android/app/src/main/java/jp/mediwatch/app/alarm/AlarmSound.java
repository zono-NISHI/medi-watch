package jp.mediwatch.app.alarm;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

/**
 * アラームの音と振動を、アプリ自身で鳴らし続ける（止めるまで繰り返す）。
 *
 * 以前は通知の音（FLAG_INSISTENT）で鳴らしていたが、通知の音は
 * 「鳴らし始めた時点で音量が 0 なら鳴らさない」「鳴っているあいだに音量を 0 にすると
 * そこで止まる」という作りのため、音量を 0 にしてから上げても、もう鳴らなかった。
 * MediaPlayer で「アラーム」の音として繰り返し再生しておけば、音量が 0 のあいだも
 * 再生は続いているので、音量を上げるとその場で聞こえるようになる。
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

    private static MediaPlayer player;
    private static Vibrator vibrator;
    private static AudioFocusRequest focusRequest;

    private AlarmSound() {}

    /** 鳴らし始める（すでに鳴っていれば何もしない） */
    static synchronized void start(Context context) {
        Context app = context.getApplicationContext();
        if (player == null) {
            requestFocus(app);
            player = createPlayer(app);
        }
        if (vibrator == null) startVibration(app);
    }

    /** 止める */
    static synchronized void stop(Context context) {
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
