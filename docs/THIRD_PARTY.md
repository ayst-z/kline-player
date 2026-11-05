# 第三方组件与数据说明

本仓库主体代码以 MIT 协议开源（见 [LICENSE](../LICENSE)），以下内容来自第三方：

| 内容 | 位置 | 许可 / 来源 |
| --- | --- | --- |
| KLineChart v9.8.12 | `vendor/klinecharts.min.js` | Apache License 2.0，见 `vendor/KLineChart-LICENSE.txt` |
| 日线行情数据（9 个片源） | `data/*.js`（`usdjpy` 等） | 由 `tools/build_data.py` 抓取自东方财富公开行情接口，仅作演示 |
| 演示音频 | `audio/demo.mp3`、`data/demo-audio.js` | 本项目代码合成，随仓库以 MIT 分发 |

## 仅借鉴思路、未使用其代码的项目

- **wavesurfer.js**（BSD-3-Clause）：波形条、Regions 区间、Minimap 概览 → 本项目的立体声波形条与 A-B 区间循环。
- **Tone.js Visualizer**（MIT）：Meter / FFT / Waveform 工具的分层思路 → 电平表的平滑包络与峰值保持列。
- **projectM / Milkdrop**（LGPL）：节拍驱动的视觉脉冲 → BPM 节拍网格与播放头拍点闪光。

本项目的界面风格为对公开行情终端视觉的仿制与再设计，与同花顺官方无关，未使用其任何素材或商标。

- three.js r150.1（MIT）—— 3D K 线背景，vendor/three.min.js
