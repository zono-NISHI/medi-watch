// ============================================================
//  JAHIS 電子版お薬手帳データフォーマット 簡易パーサー
//
//  参考: JAHIS「電子版お薬手帳データフォーマット仕様書」
//  データは "JAHISTCxx" のバージョン行から始まり、各レコードは改行区切り、
//  各項目はカンマ区切り。先頭の項目がレコード番号（レコードの種類）を表す。
//
//  本パーサーは薬局・医院の明細書に印刷された「電子お薬手帳 QRデータ」の実データ
//  （JAHISTC06）で確認した次の3種類のレコードから、薬の情報を取り出す。
//    201 薬品レコード    : 201, RP番号, 薬品名称, 用量, 単位名, 薬品コード種別, 薬品コード, 作成者
//    301 用法レコード    : 301, RP番号, 用法名称, 調剤数量, 調剤単位, 剤形コード, 用法コード種別, 用法コード, 作成者
//    311 用法補足レコード: 311, RP番号, 用法補足情報, 作成者
//  RP番号は「同じ飲み方をする薬のまとまり」の番号。1つの RP に薬が複数あることがあるため、
//  用法・補足は RP番号ごとに集めてから、同じ RP の薬それぞれに付ける。
//  患者・医療機関・医師などのレコード（1, 5, 11, 15, 51, 55 など）は個人情報のため読まない。
// ============================================================

const RECORD_DRUG = '201';
const RECORD_USAGE = '301';
const RECORD_USAGE_NOTE = '311';

// 調剤数量を「◯日分」「◯回分」のように表示する単位。
// 塗り薬などの「1調剤」は利用者にとって意味が分かりにくいので、メモには入れない。
const DAYS_UNITS = ['日分', '回分'];

// 全角の英数字・記号を半角にそろえる（例:「１０ｍｇ」→「10mg」、単位「ｇ」→「g」）。
// 単位のプルダウン（g・mL など）と一致させるためと、文字を読みやすくするため。
function normalize(text) {
  return (text || '').normalize('NFKC').trim();
}

// 用法名称を、薬の専門用語を知らない人にも分かる書き方にそろえる。
//  - 「分1」「分3」などの薬局の略語（1日の量を何回に分けて飲むか）→「1日1回」「1日3回」
//      例:「分1(朝食後服用)」→「1日1回(朝食後服用)」
//  - 回数の幅は「少ない〜多い」の順にそろえる（処方では「2回〜1回」と書かれることがある）
//      例:「1日2回~1回」→「1日1〜2回」
//  - 波線は、全角→半角の変換で「~」になったものを読みやすい「〜」に戻す
function humanizeUsage(usage) {
  return usage
    .replace(/(^|[\s(])分(\d+)/g, '$11日$2回')
    .replace(/(\d+)回\s*[~〜]\s*(\d+)回/g, (_, a, b) => {
      const [min, max] = [Number(a), Number(b)].sort((x, y) => x - y);
      return `${min}〜${max}回`;
    })
    .replace(/~/g, '〜');
}

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

    const isJahisFormat = /^JAHISTC\d{2}/.test(lines[0]);
    if (!isJahisFormat) {
      return {
        success: false,
        message: 'お薬手帳用のQRコードとして認識できませんでした。手動で入力してください。',
      };
    }

    const drugs = []; // { rp, name, dosage, unit }
    const usageByRp = new Map(); // RP番号 → ['分1(朝食後服用)', '24日分', ...]

    const addUsage = (rp, text) => {
      if (!text) return;
      if (!usageByRp.has(rp)) usageByRp.set(rp, []);
      usageByRp.get(rp).push(text);
    };

    for (const line of lines) {
      const cols = line.split(',').map((c) => normalize(c));
      const [recordType, rp] = cols;

      if (recordType === RECORD_DRUG) {
        const [, , name, dosage, unit] = cols;
        if (name) drugs.push({ rp, name, dosage: dosage || null, unit: unit || null });
      } else if (recordType === RECORD_USAGE) {
        const [, , usage, quantity, quantityUnit] = cols;
        if (usage) addUsage(rp, humanizeUsage(usage));
        if (quantity && DAYS_UNITS.includes(quantityUnit)) addUsage(rp, `${quantity}${quantityUnit}`);
      } else if (recordType === RECORD_USAGE_NOTE) {
        addUsage(rp, cols[2]);
      }
    }

    if (drugs.length === 0) {
      return {
        success: false,
        message: 'QRコードに医薬品情報が含まれていませんでした。手動で入力してください。',
      };
    }

    const medications = drugs.map((d) => ({
      name: d.name,
      dosage: d.dosage,
      unit: d.unit,
      notes: (usageByRp.get(d.rp) || []).join(' / ') || null,
    }));

    return { success: true, medications };
  } catch (err) {
    console.error('[jahisParser] 解析エラー:', err);
    return { success: false, message: 'QRコードの解析中にエラーが発生しました。' };
  }
}

module.exports = { parseJahisQr };
