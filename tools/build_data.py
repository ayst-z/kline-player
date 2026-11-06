# -*- coding: utf-8 -*-
"""Build compact JS data modules from Eastmoney daily kline JSON."""
import json, os, math, datetime, hashlib

RAW = os.environ.get("KLINE_RAW_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "_raw")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

DATASETS = [
    # id, raw file, name, code, market, digits, description, start date
    ("usdjpy", "usdjpy", "美元/日元", "USDJPY", "外汇", 3,
     "美元兑日元，全球最流动的货币对。这里装着日元三十年的避险、干预与套息交易。", "1995-04-17"),
    ("eurchf", "eurchf", "欧元/瑞郎", "EURCHF", "外汇", 4,
     "欧元兑瑞郎。2015 年 1 月 15 日，瑞士央行一句话，让全世界见识了什么叫黑天鹅。", "2011-08-09"),
    ("gbpjpy", "gbpjpy", "英镑/日元", "GBPJPY", "外汇", 3,
     "英镑兑日元，外号“妖镑”。波动是它的本能，套息交易者的天堂与地狱。", "2007-07-16"),
    ("usdchf", "usdchf", "美元/瑞郎", "USDCHF", "外汇", 4,
     "美元兑瑞郎。避险之王与美元的对决，2015 年同样留下了一根史诗级长针。", "2011-08-08"),
    ("sh", "sh", "上证指数", "000001", "指数", 2,
     "上证指数。从 100 点到 6124 点，再到 3000 点保卫战，一代人的记忆都在这里。", "2005-05-30"),
    ("hs300", "hs300", "沪深300", "000300", "指数", 2,
     "沪深 300。A 股核心资产的集体体温计，2007 与 2015 两轮牛熊都写在这条线上。", "2007-09-03"),
    ("n225", "n225", "日经225", "N225", "指数", 2,
     "日经 225。泡沫顶峰 38957 点，失落的三十年，以及 2024 年那场套息交易崩盘。", "1989-12-01"),
    ("ndx", "ndx", "纳指100", "NDX", "指数", 2,
     "纳斯达克 100。互联网泡沫、金融危机、AI 浪潮，一次次把人类想象力写进 K 线。", "2000-03-01"),
    ("hsi", "hsi", "恒生指数", "HSI", "指数", 2,
     "恒生指数。亚洲金融风暴、港股直通车、互联网监管，东方之珠的起伏都在这里。", "1997-07-02"),
]

CHAPTERS = {
    "usdjpy": [
        ("1995-04-19", "日元战后最强", "美元兑日元跌到 79.70，日元升值到战后最高区间。出口企业哀嚎，央行开始紧张。"),
        ("1998-08-11", "亚洲金融危机·美元荒", "避险资金疯抢美元，USD/JPY 冲到 147.63，亚洲货币一片狼藉。"),
        ("1998-10-07", "LTCM 余震", "对冲基金巨头崩塌，日元单日暴涨 6.72%，美元兑日元从 130 砸到 118.85。"),
        ("2008-12-17", "金融危机·日元回家", "全球去杠杆，套息盘平仓，USD/JPY 跌到 87.11。"),
        ("2011-03-17", "3·11 大地震", "地震与核事故引发避险，日元一度冲到 76.25，G7 联合干预。"),
        ("2011-10-31", "历史大底 75.56", "日元站上战后最强，USD/JPY 创下 75.56 的历史低点。"),
        ("2015-06-05", "安倍经济学·125", "QQE 放水，日元贬值，USD/JPY 回到 125.85，创 13 年新高。"),
        ("2016-06-24", "英国脱欧", "公投结果出炉，日元避险飙升，USD/JPY 从 106.82 砸到 98.99。"),
        ("2022-09-22", "央行出手干预", "日本 24 年来首次卖出美元干预，USD/JPY 从 145.89 瞬间砸到 140.36。"),
        ("2022-10-21", "151.94 顶部", "又一次干预，USD/JPY 冲高 151.94 后跳水，单日回落至 147.64。"),
        ("2024-07-03", "161.95 历史新高", "美日利差拉到极致，USD/JPY 突破 161.95。"),
        ("2024-08-05", "套息交易崩盘", "日经熔断，全球风险资产暴跌，USD/JPY 从 146.65 砸到 141.70。"),
        ("2026-07-23", "163.99 新王", "美元再度走强，USD/JPY 创下 163.99 的新高。"),
    ],
    "eurchf": [
        ("2011-08-11", "瑞郎避险潮", "欧债危机升级，瑞士央行加码宽松，EUR/CHF 单日反弹 5.34%。"),
        ("2011-09-06", "1.20 铁底", "瑞士央行直接设定欧元兑瑞郎下限 1.20，汇价单日狂拉 8.75%。"),
        ("2015-01-15", "黑天鹅脱钩", "瑞士央行突然放弃 1.20 下限，EUR/CHF 单日暴跌 14.44%，最低见 0.9197。"),
        ("2015-01-16", "余震", "流动性真空，汇价一度下探 0.9708，无数杠杆账户一夜归零。"),
        ("2018-04-20", "重回 1.20", "上限解除三年后，EUR/CHF 重新摸到 1.20。"),
        ("2022-06-01", "平价时代", "欧美加息赛跑，EUR/CHF 跌向平价，收在 1.0261。"),
        ("2026-03-09", "0.8981 新低", "瑞郎再度走强，EUR/CHF 创下 0.8981 的历史新低。"),
    ],
    "gbpjpy": [
        ("1990-08-23", "286.10 泡沫顶", "日本泡沫经济最后的狂欢，英镑兑日元冲到 286.10。"),
        ("1995-04-19", "日元冲击", "日元战后最强，GBP/JPY 被砸到 129.32。"),
        ("1998-10-07", "LTCM 余震", "全球去杠杆，GBP/JPY 单日 -5.06%，套息盘互相踩踏。"),
        ("2007-07-20", "信贷繁荣顶", "全球信贷泡沫顶峰，GBP/JPY 摸到 251.14。"),
        ("2008-12-30", "金融危机底", "雷曼之后，GBP/JPY 跌到 129.81。"),
        ("2011-09-22", "116.86 历史大底", "欧债危机 + 日元避险，GBP/JPY 创下 116.86 的历史低点。"),
        ("2015-06-24", "安倍 QQE", "日元贬值，GBP/JPY 回到 195.88。"),
        ("2016-06-24", "英国脱欧", "公投结果出炉，GBP/JPY 单日 -11.59%，最低见 133.26。"),
        ("2024-07-11", "208.12 高点", "套息交易拥挤到极致，GBP/JPY 创下 208.12。"),
        ("2024-08-05", "套息崩盘", "日元暴力升值，GBP/JPY 砸到 180.11。"),
    ],
    "usdchf": [
        ("2000-10-26", "1.83 高点", "美元强势周期顶峰，USD/CHF 摸到 1.83。"),
        ("2011-08-09", "0.70 瑞郎风暴", "欧债危机全面爆发，瑞郎被疯抢，USD/CHF 跌到 0.70。"),
        ("2011-09-06", "SNB 上限", "瑞士央行设定 EUR/CHF 下限，USD/CHF 单日 +9.53%。"),
        ("2015-01-15", "瑞郎脱钩", "瑞士央行放弃上限，USD/CHF 单日 -13.16%，最低见 0.7426。"),
        ("2022-10-21", "美元顶 1.0148", "美联储暴力加息，USD/CHF 一度回到平价上方。"),
        ("2026-01-27", "0.7605 新低", "美元走弱 + 瑞郎避险，USD/CHF 创下 0.7605 的新低。"),
    ],
    "sh": [
        ("1990-12-19", "100 点开市", "上交所开业，上证指数从 96.05 点起步。"),
        ("1992-05-21", "取消涨跌停", "价格限制放开，上证指数单日暴涨 105.27%。"),
        ("1994-07-29", "325 点大底", "三大救市政策前夜，指数跌到 325.89 点。"),
        ("2001-06-14", "2245 点", "国有股减持前夜，上证指数摸到 2245.43 点。"),
        ("2005-06-06", "998 点", "股权分置改革前夜，指数跌破千点，最低 998.23。"),
        ("2007-10-16", "6124 点", "全民炒股，上证指数创下 6124.04 的历史最高。"),
        ("2008-10-28", "1664 点", "金融危机，指数从 6124 跌到 1664.93。"),
        ("2015-06-12", "5178 点", "杠杆牛市顶峰，上证指数摸到 5178.19。"),
        ("2016-01-27", "熔断底 2638", "熔断机制上线又下线，指数最低见 2638.30。"),
        ("2019-01-04", "2440 点", "贸易摩擦与去杠杆之后，指数在 2440.91 见底。"),
        ("2021-02-18", "3731 点", "核心资产抱团顶峰，上证指数摸到 3731.69。"),
        ("2024-02-05", "2635 点", "小微盘流动性危机，指数最低见 2635.09。"),
        ("2024-09-24", "政策底", "一揽子政策落地，指数单日 +4.15%，收在 2863.13。"),
        ("2024-10-08", "3674 高开", "节后开盘涨停，指数最高 3674.40，随后回落。"),
        ("2026-05-14", "4258 新高位", "新一轮行情，上证指数摸到 4258.86。"),
    ],
    "hs300": [
        ("2005-01-04", "1000 点发布", "沪深 300 以 1000 点为基准发布，首日收在 982.79。"),
        ("2007-10-17", "5891 点", "大牛市顶峰，沪深 300 摸到 5891.72。"),
        ("2008-11-04", "1606 点", "金融危机底部，沪深 300 跌到 1606.73。"),
        ("2015-06-09", "5380 点", "杠杆牛市，沪深 300 摸到 5380.43。"),
        ("2021-02-18", "5930 点历史高", "核心资产泡沫，沪深 300 创下 5930.91 的历史最高。"),
        ("2024-02-02", "3108 点", "流动性危机，沪深 300 最低见 3108.35。"),
        ("2024-10-08", "4450 高开", "政策组合拳后，沪深 300 最高 4450.37。"),
    ],
    "n225": [
        ("1987-10-20", "黑色星期一", "全球股灾，日经 225 单日 -14.90%。"),
        ("1989-12-29", "38957 泡沫顶", "日本泡沫经济顶峰，日经 225 收在 38915.87，盘中最高 38957.44。"),
        ("1990-10-02", "单日 -13.24%", "泡沫开始破裂，日经 225 单日暴跌 13.24%。"),
        ("2003-04-28", "7603 点底", "失去的十年之后，日经 225 跌到 7603.76。"),
        ("2008-10-28", "6994 点底", "金融危机，日经 225 最低见 6994.90。"),
        ("2011-03-15", "地震 -10.55%", "东日本大地震，日经 225 单日 -10.55%。"),
        ("2024-08-05", "套息崩盘 -12.40%", "日元套息交易崩盘，日经 225 单日 -12.40%。"),
        ("2026-06-22", "72831 新高", "AI 与弱日元共振，日经 225 创下 72831.73 的新高。"),
    ],
    "ndx": [
        ("1991-08-12", "510 点起点", "纳指 100 从 510 点附近开始这段旅程。"),
        ("2000-03-24", "互联网泡沫顶", "纳指 100 摸到 5078.86，泡沫即将破裂。"),
        ("2002-10-10", "泡沫破裂底", "互联网泡沫出清，纳指 100 最低见 1108.49。"),
        ("2008-11-21", "金融危机底", "全球金融海啸，纳指 100 最低见 1295.48。"),
        ("2020-03-23", "疫情底", "新冠熔断，纳指 100 最低见 6631.42。"),
        ("2022-10-13", "加息底", "美联储暴力加息，纳指 100 最低见 10088.83。"),
        ("2026-10-06", "27722 新高", "AI 浪潮继续，纳指 100 创下 27722.75 的新高。"),
    ],
    "hsi": [
        ("1997-08-07", "16820 回归牛", "香港回归行情，恒指最高见 16820.31。"),
        ("1998-08-13", "6544 亚洲危机", "亚洲金融风暴，恒指最低见 6544.79。"),
        ("2007-10-30", "31958 港股直通车", "港股直通车预期，恒指最高见 31958.41。"),
        ("2008-10-27", "10676 金融海啸", "雷曼之后，恒指最低见 10676.29。"),
        ("2018-01-29", "33484 历史高", "恒指创下 33484.08 的历史最高。"),
        ("2020-03-19", "21139 疫情底", "全球疫情熔断，恒指最低见 21139.26。"),
        ("2022-10-31", "14597 底", "互联网监管与地产危机，恒指最低见 14597.31。"),
        ("2024-01-22", "14794 底", "恒指再度探底 14794.16。"),
        ("2026-01-29", "28056 新高", "港股修复，恒指最高见 28056.10。"),
    ],
}

# Data quirks to clean: EURCHF 2024-01-01 holiday glitch (+5.29% then -4.87%).
DROP = {("eurchf", "2024-01-01")}


def load_raw(raw_name):
    d = json.load(open(os.path.join(RAW, raw_name + ".json"), encoding="utf-8"))["data"]
    rows = []
    for k in d["klines"]:
        p = k.split(",")
        date = p[0]
        o, c, h, l, v = float(p[1]), float(p[2]), float(p[3]), float(p[4]), float(p[5])
        rows.append([date, o, h, l, c, v])
    return rows


def proxy_volume(date, o, h, l, c, i):
    rng = (h - l) / max(c, 1e-9)
    body = abs(c - o) / max(h - l, 1e-9)
    hsh = int(hashlib.md5(date.encode()).hexdigest()[:6], 16) / 0xFFFFFF
    v = rng * 1e8 * (0.55 + 0.45 * body) * (0.75 + 0.5 * hsh)
    return round(v)


def find_index(rows, date):
    tgt = datetime.date.fromisoformat(date)
    best = min(range(len(rows)), key=lambda i: abs(datetime.date.fromisoformat(rows[i][0]) - tgt))
    return best


def main():
    os.makedirs(OUT, exist_ok=True)
    library = []
    for ds in DATASETS:
        id_, raw_name, name, code, market, digits, desc, start_date = ds
        rows = load_raw(raw_name)
        rows = [r for r in rows if (id_, r[0]) not in DROP]
        has_vol = any(r[5] > 0 for r in rows)
        candles = []
        for i, (date, o, h, l, c, v) in enumerate(rows):
            if not has_vol or v <= 0:
                v = proxy_volume(date, o, h, l, c, i)
            candles.append([date, round(o, digits + 1), round(h, digits + 1),
                            round(l, digits + 1), round(c, digits + 1), int(v)])

        highs = [c[2] for c in candles]
        lows = [c[3] for c in candles]
        hi = max(candles, key=lambda r: r[2])
        lo = min(candles, key=lambda r: r[3])
        best = max(((candles[i][4] / candles[i - 1][4] - 1, candles[i][0]) for i in range(1, len(candles))))
        worst = min(((candles[i][4] / candles[i - 1][4] - 1, candles[i][0]) for i in range(1, len(candles))))
        peak = candles[0]
        mdd = (0, candles[0][0], candles[0][0])
        for r in candles:
            if r[4] > peak[4]:
                peak = r
            dd = r[4] / peak[4] - 1
            if dd < mdd[0]:
                mdd = (dd, peak[0], r[0])

        chapters = []
        for date, title, text in CHAPTERS.get(id_, []):
            idx = find_index(candles, date)
            c = candles[idx]
            prev = candles[max(0, idx - 1)]
            move = (c[4] / prev[4] - 1) if prev[4] else 0
            chapters.append({
                "date": date, "title": title, "desc": text, "price": c[4],
                "move": round(move * 100, 2),
            })

        start_idx = find_index(candles, start_date)
        meta = {
            "id": id_, "name": name, "code": code, "market": market,
            "digits": digits, "desc": desc, "startDate": candles[start_idx][0],
            "startIndex": start_idx, "count": len(candles),
            "first": candles[0][0], "last": candles[-1][0],
            "lastClose": candles[-1][4],
            "prevClose": candles[-2][4],
            "high": hi[2], "highDate": hi[0],
            "low": lo[3], "lowDate": lo[0],
            "bestDay": {"date": best[1], "pct": round(best[0] * 100, 2)},
            "worstDay": {"date": worst[1], "pct": round(worst[0] * 100, 2)},
            "maxDD": {"pct": round(mdd[0] * 100, 2), "from": mdd[1], "to": mdd[2]},
            "volProxy": not has_vol,
            "volNote": "无集中成交量，量柱按振幅估算" if not has_vol else "成交量",
            "chapters": chapters,
        }
        library.append(meta)

        payload = json.dumps({"id": id_, "candles": candles}, ensure_ascii=False,
                             separators=(",", ":"))
        with open(os.path.join(OUT, id_ + ".js"), "w", encoding="utf-8") as f:
            f.write("(window.KLINE_DATA=window.KLINE_DATA||{})[%s]=%s;\n" % (
                json.dumps(id_), payload))

        print(f"{id_:7s} {name:8s} candles={len(candles):5d} start={candles[0][0]} end={candles[-1][0]} "
              f"hi={hi[2]}@{hi[0]} lo={lo[3]}@{lo[0]} mdd={meta['maxDD']['pct']}% vol={'real' if has_vol else 'proxy'}")

    library.sort(key=lambda m: (0 if m["market"] == "外汇" else 1, DATASETS.index(next(d for d in DATASETS if d[0] == m["id"]))))
    with open(os.path.join(OUT, "library.js"), "w", encoding="utf-8") as f:
        f.write("window.KLINE_LIBRARY=" + json.dumps(library, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("library written:", len(library))


if __name__ == "__main__":
    main()
