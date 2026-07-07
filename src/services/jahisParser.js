// ============================================================
//  JAHIS 電子版お薬手帳データフォーマット 簡易パーサー
//
//  参考: JAHIS「電子版お薬手帳データフォーマット仕様書」
//  実際の仕様はバージョンレコード／医療機関等レコード／医薬品レコード等、
//  レコード種別ごとにカンマ区切り（CSV準拠）の固定項目で構成される。
//  本パーサーは卒業研究のプロトタイプとして、薬局QRコードに含まれる
//  医薬品レコード（レコード種別 "21"：院外処方 医薬品情報 を想定）から
//  薬品名・用量・用法に相当する項目を抽出する簡易実装である。
//  実運用では薬局システムが出力する実データに合わせてレコード種別・
//  カラム位置の調整が必要となる。
// ============================================================

// JAHISデータは "JAHISTCxx" のバージョン識別子から始まり、
// 各レコードは改行(CRLF)区切り、各項目はカンマ区切りというのが基本構造。
// レコード種別コードは仕様書の「３.２.６ 情報グループとレコード情報」を参照。
// 本実装では医薬品情報レコード種別を "21"（院外処方）または "31"（OTC等）と仮定し、
// [レコード種別, 薬品コード種別, 薬品コード, 薬品名称, 用法, 用量, 単位, 日数] の並びを想定する。
const MEDICATION_RECORD_TYPES = ['21', '31'];

function parseJahisQr(rawData) {
  if (typeof rawData !== 'string' || rawData.trim().length === 0) {
    return { success: false, message: 'QRコードのデータが空です。' };
  }

  try {
    const lines = rawData
      .split(/\r\n|\r|\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      return { success: false, message: 'QRコードの内容を読み取れませんでした。' };
    }

    const versionLine = lines[0];
    const isJahisFormat = /^JAHISTC\d{2}/.test(versionLine);

    const medications = [];

    for (const line of lines) {
      const cols = line.split(',').map((c) => c.trim());
      const recordType = cols[0];

      if (MEDICATION_RECORD_TYPES.includes(recordType)) {
        // 想定カラム: [種別, 薬品コード種別, 薬品コード, 薬品名称, 用法, 用量, 単位, 日数]
        const name = cols[3];
        const usage = cols[4];
        const dosage = cols[5];
        const unit = cols[6];
        const days = cols[7];

        if (name) {
          medications.push({
            name,
            dosage: dosage || null,
            unit: unit || null,
            notes: [usage, days ? `${days}日分` : null].filter(Boolean).join(' / ') || null,
          });
        }
      }
    }

    if (medications.length === 0) {
      // JAHIS形式と判定できない、または医薬品レコードが見つからない場合は
      // 簡易フォールバックとしてカンマ区切りの先頭値を薬品名とみなす
      if (!isJahisFormat) {
        return {
          success: false,
          message: 'JAHISフォーマットのQRコードとして認識できませんでした。手動で入力してください。',
        };
      }
      return {
        success: false,
        message: 'QRコードに医薬品情報が含まれていませんでした。手動で入力してください。',
      };
    }

    return { success: true, medications };
  } catch (err) {
    console.error('[jahisParser] 解析エラー:', err);
    return { success: false, message: 'QRコードの解析中にエラーが発生しました。' };
  }
}

module.exports = { parseJahisQr };
