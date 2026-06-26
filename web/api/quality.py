from __future__ import annotations

"""把各源五花八门的音质信号归一化成统一档位，供前端渲染 无损 / Hi-Res / Atmos 徽章。

判定依据按可靠性从高到低：
1. ext（flac/alac/ape/wav -> 无损）—— 最硬的信号，始终存在；
2. download_url_status['quality'] 质量串（各源词表不同，含中英文关键词）；
3. samplerate / bitrate 数字（多数源未填，能拿到时用于区分 Hi-Res）；
4. 由 file_size_bytes / duration_s 反推的有效码率（兜底）。

诚实性原则：徽章反映「实际下发文件」的格式，而非「源站存在该版本」。
samplerate/位深多数源拿不到，故 Hi-Res 主要靠质量标签判定，不臆造 24bit/96kHz 数字。
"""

from typing import Any

LOSSLESS_EXTS = {"flac", "alac", "ape", "wav", "wv", "aiff", "aif"}

# 统一档位优先级（数值越大越高）
TIER_ORDER = {"standard": 0, "high": 1, "lossless": 2, "hires": 3, "atmos": 4}

TIER_LABEL = {
    "atmos": "Dolby Atmos",
    "hires": "Hi-Res Lossless",
    "lossless": "Lossless",
    "high": "High Quality",
    "standard": "Standard",
}


def _eff_bitrate_kbps(info: Any) -> float:
    """优先用源给的 bitrate；没有则由文件大小/时长反推有效码率(kbps)。"""
    try:
        if info.bitrate and float(info.bitrate) > 0:
            return float(info.bitrate)
    except Exception:
        pass
    try:
        size_bytes = float(info.file_size_bytes)
        dur = float(info.duration_s or 0)
        if size_bytes > 0 and dur > 0:
            return size_bytes * 8 / dur / 1000.0
    except Exception:
        pass
    return 0.0


def _samplerate_hz(info: Any) -> int:
    try:
        sr = int(float(info.samplerate or 0))
        # 有的源用 kHz 表示（如 96），统一换算成 Hz
        return sr * 1000 if 0 < sr < 1000 else sr
    except Exception:
        return 0


def quality_tier(info: Any) -> dict:
    """返回 {tier, label, detail}。detail 是简短的人类可读描述（如 "FLAC" / "320kbps"）。"""
    ext = (info.ext or "").lower().lstrip(".")
    codec = (getattr(info, "codec", None) or "").lower()
    status = getattr(info, "download_url_status", None) or {}
    quality_raw = str(status.get("quality") or "").strip()
    q = quality_raw.lower()
    sr = _samplerate_hz(info)
    bitrate = _eff_bitrate_kbps(info)
    is_lossless_ext = ext in LOSSLESS_EXTS or codec in {"flac", "alac"}

    # ---- 1) 空间音频 / Dolby Atmos：仅个别源（如 QQ 臻品全景声）有信号 ----
    if any(k in quality_raw for k in ("全景声", "全景聲")) or any(
        k in q for k in ("atmos", "spatial", "dolby", "360", "sony 360")
    ):
        tier = "atmos"
    # ---- 2) Hi-Res：质量标签命中 或 无损且采样率>48kHz ----
    elif (
        any(k in quality_raw for k in ("母带", "母帶"))
        or any(k in q for k in ("hires", "hi-res", "hi_res", "master", "mqa", "24bit", "24-bit"))
        or (is_lossless_ext and sr > 48000)
    ):
        tier = "hires"
    # ---- 3) 无损 ----
    elif (
        is_lossless_ext
        or any(k in quality_raw for k in ("无损", "無損", "臻品"))
        or any(k in q for k in ("lossless", "flac", "sq"))
    ):
        tier = "lossless"
    # ---- 4) 高品质 ----
    elif (
        any(k in quality_raw for k in ("高品质", "高品質"))
        or any(k in q for k in ("hq", "320", "high"))
        or bitrate >= 320
    ):
        tier = "high"
    else:
        tier = "standard"

    # ---- detail：尽量给出可读细节，拿不到精确参数时退化为格式名 ----
    bits: list[str] = []
    if ext:
        bits.append(ext.upper())
    if sr >= 1000:
        bits.append(f"{sr // 1000}kHz" if sr % 1000 == 0 else f"{sr / 1000:.1f}kHz")
    if tier in ("high", "standard") and bitrate > 0:
        bits.append(f"{int(round(bitrate))}kbps")
    detail = " · ".join(bits) if bits else (quality_raw or TIER_LABEL[tier])

    return {"tier": tier, "label": TIER_LABEL[tier], "detail": detail}
