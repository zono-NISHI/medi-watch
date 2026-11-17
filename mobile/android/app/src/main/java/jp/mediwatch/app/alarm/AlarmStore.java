package jp.mediwatch.app.alarm;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * アラームに必要な情報を端末に保存する（SharedPreferences）。
 *
 * アプリ（画面）を開いたときに、Web 側の alarm.js がサーバーから取得した
 * 「服薬スケジュール」と「今日もう記録した予定」を渡してくる。
 * アプリを閉じていても、端末の再起動後でも鳴らせるよう、ここに保存しておく。
 */
final class AlarmStore {

    /** アラームを出し続ける時間（Web 版の alarm.js の ALARM_WINDOW_MIN と同じ 60 分） */
    static final long ALARM_WINDOW_MS = 60L * 60 * 1000;
    /** 「あとで」を押したときに、もう一度鳴らすまでの時間 */
    static final long SNOOZE_MS = 5L * 60 * 1000;
    /**
     * 予約した時刻から、鳴らすのが遅れても鳴らす範囲（端末の処理が遅れた場合など）。
     * 電源が切れていて鳴らせなかった分は、電源を入れたあとに AlarmScheduler.catchUpAfterBoot が鳴らす
     */
    static final long LATE_TOLERANCE_MS = 10L * 60 * 1000;
    /** 電源を入れてから、鳴らせなかったアラームを鳴らすまでの時間（起動直後の処理が落ち着くのを待つ） */
    static final long BOOT_CATCH_UP_DELAY_MS = 5L * 1000;
    /**
     * アプリの画面で知らせているお薬を記録しないままアプリを離れたとき、端末のアラームが引き継いで鳴らすまでの時間。
     * 一瞬アプリが隠れただけ（すぐに戻った）で鳴り出さないように、少し待つ
     */
    static final long HANDOFF_DELAY_MS = 5L * 1000;

    private static final String PREFS = "medi_watch_alarm";
    private static final String KEY_SCHEDULES = "schedules";
    private static final String KEY_DONE_DATE = "done_date";
    private static final String KEY_DONE_IDS = "done_ids";
    private static final String KEY_SNOOZES = "snoozes";
    private static final String KEY_RINGING = "ringing";
    private static final String KEY_ALERTED = "alerted";
    private static final String KEY_NEXT_AT = "next_at";
    private static final String KEY_APP_ALARM = "app_alarm";
    private static final String KEY_HANDOFF_RINGING = "handoff_ringing";

    /** 服薬スケジュール 1 件分 */
    static final class Schedule {
        final String id;
        final int hour;
        final int minute;
        final boolean[] days = new boolean[7]; // 0 = 日曜（JavaScript の getDay() と同じ）
        final String label; // 例: 「ロキソニン 1錠」
        final String name; // 全画面のアラーム用。お薬の名前だけ（例: 「ロキソニン」）
        final String amount; // 全画面のアラーム用。用量だけ（例: 「1錠」。登録されていなければ空）
        final String speech; // 読み上げ用。例: 「ロキソニンを1錠」（用量が無ければ「ロキソニンを」）
        final long updatedAt; // 予定を最後に登録・変更した時刻（ミリ秒）。分からなければ 0

        Schedule(String id, int hour, int minute, String label, String name, String amount, String speech, long updatedAt) {
            this.id = id;
            this.hour = hour;
            this.minute = minute;
            this.label = label;
            this.name = name;
            this.amount = amount;
            this.speech = speech;
            this.updatedAt = updatedAt;
        }

        String timeText() {
            return String.format(Locale.JAPAN, "%02d:%02d", hour, minute);
        }

        /** その日の服薬時刻（ミリ秒）。服薬する曜日でなければ -1 */
        long occurrenceOn(Calendar day) {
            Calendar c = (Calendar) day.clone();
            c.set(Calendar.HOUR_OF_DAY, hour);
            c.set(Calendar.MINUTE, minute);
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
            int dow = c.get(Calendar.DAY_OF_WEEK) - 1; // Calendar は日曜 = 1
            return days[dow] ? c.getTimeInMillis() : -1;
        }
    }

    /** いま鳴らしている（または「あとで」にした）予定 1 件分 */
    static final class Item {
        final String id;
        final long origin; // 本来の服薬時刻（ミリ秒）

        Item(String id, long origin) {
            this.id = id;
            this.origin = origin;
        }
    }

    private final SharedPreferences prefs;

    AlarmStore(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---- 服薬スケジュール ----

    void saveSchedules(JSONArray schedules) {
        prefs.edit().putString(KEY_SCHEDULES, schedules.toString()).apply();
    }

    List<Schedule> schedules() {
        List<Schedule> list = new ArrayList<>();
        JSONArray arr = readArray(KEY_SCHEDULES);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            String id = o.optString("id", "");
            String[] hm = o.optString("time", "").split(":");
            if (id.isEmpty() || hm.length < 2) continue;
            try {
                String label = o.optString("label", "お薬");
                // 読み上げ用の文が無い（以前の版の画面が保存した予定）ときは、表示用の名前から作る
                String speech = o.optString("speech", "");
                if (speech.isEmpty()) speech = label + "を";
                // 名前と用量が分かれていない（以前の版の画面が保存した予定）ときは、表示用の名前をそのまま出す
                String name = o.optString("name", "");
                String amount = name.isEmpty() ? "" : o.optString("amount", "");
                if (name.isEmpty()) name = label;
                Schedule s = new Schedule(
                    id,
                    Integer.parseInt(hm[0]),
                    Integer.parseInt(hm[1]),
                    label,
                    name,
                    amount,
                    speech,
                    o.optLong("updatedAt", 0)
                );
                JSONArray days = o.optJSONArray("days");
                if (days == null || days.length() == 0) {
                    for (int d = 0; d < 7; d++) s.days[d] = true;
                } else {
                    for (int d = 0; d < days.length(); d++) {
                        int dow = days.optInt(d, -1);
                        if (dow >= 0 && dow < 7) s.days[dow] = true;
                    }
                }
                list.add(s);
            } catch (NumberFormatException ignored) {
                // 時刻の形式が正しくない予定は使わない
            }
        }
        return list;
    }

    Schedule findSchedule(String id) {
        for (Schedule s : schedules()) {
            if (s.id.equals(id)) return s;
        }
        return null;
    }

    // ---- 今日もう記録した（飲んだ・スキップした）予定 ----

    void saveDone(String date, JSONArray ids) {
        prefs.edit().putString(KEY_DONE_DATE, date).putString(KEY_DONE_IDS, ids.toString()).apply();
    }

    boolean isDoneToday(String scheduleId) {
        if (!today().equals(prefs.getString(KEY_DONE_DATE, ""))) return false;
        JSONArray ids = readArray(KEY_DONE_IDS);
        for (int i = 0; i < ids.length(); i++) {
            if (scheduleId.equals(ids.optString(i))) return true;
        }
        return false;
    }

    // ---- 「あとで」にした予定 ----

    /**
     * 鳴らし直す予約の「記録待ち」の印（true のとき、利用者が「あとで」を選んだのではなく、
     * 「カメラを起動する」を押したあと、記録しないままになったときに備えた予約）
     */
    static final String SNOOZE_HOLD = "hold";
    /**
     * 鳴らし直す予約の「引き継ぎ」の印（true のとき、アプリの画面で知らせていたお薬を記録しないままアプリを離れたので、
     * 端末のアラームが代わりに鳴らすための予約。アプリに戻ったら取り消す。AlarmRinger.onAppHidden を参照）
     */
    static final String SNOOZE_HANDOFF = "handoff";

    /** id → { at: もう一度鳴らす時刻, origin: 本来の服薬時刻, hold: 記録待ちか } */
    JSONObject snoozes() {
        return readObject(KEY_SNOOZES);
    }

    /**
     * 利用者が「あとで」を選んだ予定（id → もう一度鳴らす時刻）。記録待ちの予約は含めない。
     * 画面のアラームが、端末で「あとで」にしたあいだは出さないようにするために渡す
     */
    JSONObject userSnoozes() {
        JSONObject result = new JSONObject();
        JSONObject snoozes = snoozes();
        long now = System.currentTimeMillis();
        Iterator<String> keys = snoozes.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            JSONObject sn = snoozes.optJSONObject(id);
            if (sn == null || sn.optBoolean(SNOOZE_HOLD, false) || sn.optLong("at") <= now) continue;
            try {
                result.put(id, sn.optLong("at"));
            } catch (JSONException ignored) {
                // put に失敗することはない
            }
        }
        return result;
    }

    void saveSnoozes(JSONObject snoozes) {
        prefs.edit().putString(KEY_SNOOZES, snoozes.toString()).apply();
    }

    // ---- いま鳴らしている予定 ----

    List<Item> ringing() {
        return readItems(KEY_RINGING);
    }

    void saveRinging(List<Item> items) {
        saveItems(KEY_RINGING, items);
    }

    // ---- アプリの画面で知らせている（撮影画面で記録しようとしている）予定 ----
    // アプリの画面（public/js/alarm.js の NativeAlarm.setAppAlarm）が伝えてくる。
    // 記録しないままアプリを離れたら、端末のアラームが引き継いで鳴らす（AlarmRinger.onAppHidden）

    List<Item> appAlarm() {
        return readItems(KEY_APP_ALARM);
    }

    void saveAppAlarm(List<Item> items) {
        saveItems(KEY_APP_ALARM, items);
    }

    // ---- いま鳴っているのが「引き継ぎ」で鳴らしたアラームか（アプリに戻ったら止める） ----

    boolean isHandoffRinging() {
        return prefs.getBoolean(KEY_HANDOFF_RINGING, false);
    }

    void setHandoffRinging(boolean value) {
        prefs.edit().putBoolean(KEY_HANDOFF_RINGING, value).apply();
    }

    private List<Item> readItems(String key) {
        List<Item> list = new ArrayList<>();
        JSONArray arr = readArray(key);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && !o.optString("id").isEmpty()) list.add(new Item(o.optString("id"), o.optLong("origin")));
        }
        return list;
    }

    private void saveItems(String key, List<Item> items) {
        JSONArray arr = new JSONArray();
        for (Item item : items) {
            try {
                arr.put(new JSONObject().put("id", item.id).put("origin", item.origin));
            } catch (JSONException ignored) {
                // put に失敗することはない（値は文字列と数値だけ）
            }
        }
        prefs.edit().putString(key, arr.toString()).apply();
    }

    // ---- 同じ服薬時刻で二度鳴らさないための記録（id → 最後に鳴らした服薬時刻） ----

    long lastAlerted(String scheduleId) {
        return readObject(KEY_ALERTED).optLong(scheduleId, 0);
    }

    void markAlerted(String scheduleId, long occurrence) {
        JSONObject alerted = readObject(KEY_ALERTED);
        try {
            alerted.put(scheduleId, occurrence);
        } catch (JSONException ignored) {
            // put に失敗することはない
        }
        prefs.edit().putString(KEY_ALERTED, alerted.toString()).apply();
    }

    // ---- 次に鳴らす予定の時刻（画面の表示用） ----

    void saveNextAt(long at) {
        prefs.edit().putLong(KEY_NEXT_AT, at).apply();
    }

    long nextAt() {
        return prefs.getLong(KEY_NEXT_AT, 0);
    }

    /** 予定に無くなった id の記録を消す（お薬やスケジュールを削除したとき） */
    void forgetRemovedSchedules() {
        Set<String> ids = new HashSet<>();
        for (Schedule s : schedules()) ids.add(s.id);

        JSONObject snoozes = snoozes();
        Iterator<String> keys = snoozes.keys();
        List<String> drop = new ArrayList<>();
        while (keys.hasNext()) {
            String k = keys.next();
            if (!ids.contains(k) || isDoneToday(k)) drop.add(k);
        }
        for (String k : drop) snoozes.remove(k);
        saveSnoozes(snoozes);
    }

    void clearAll() {
        prefs.edit().clear().apply();
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.JAPAN).format(new Date());
    }

    private JSONArray readArray(String key) {
        try {
            return new JSONArray(prefs.getString(key, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private JSONObject readObject(String key) {
        try {
            return new JSONObject(prefs.getString(key, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }
}
