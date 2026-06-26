"""QQ 音乐 QRC 逐字歌词解密器（备用，当前未接入）。

背景
----
- 当前 Web 端的逐字歌词走的是**网易云 yrc**（明文，稳定可用），见 `backend.py` 的
  `_fetch_netease_yrc`。这个模块没有被任何地方 import，只是把已验证可用的 QQ qrc
  解密能力留作备用。
- QQ 的 qrc 用的是 QQ 自家“改坏的 DES”（buggy DES，`sbox4` 有一处重复值），标准 DES
  解不开。本实现忠实移植自 wangqr/QQMusicDES，并用真实加密样本验证过能解出合法的
  `QrcInfos` XML。

为什么没接入
------------
- QQ **公开**接口 `lyric_download.fcg?lrctype=4` 实测只返回**行级** qrc（多首歌均无
  逐字 `(start,dur,0)` 数据）。
- QQ 真正的**逐字** qrc 锁在登录态 App 接口（`u.y.qq.com/cgi-bin/musicu.fcg` 的
  `GetPlayLyricInfo`）里，需要有效的 QQ 登录 cookie/签名才能取到。

如何启用（将来若拿到 QQ 登录 cookie）
------------------------------------
1. 用带 cookie 的请求调 App 接口拿到 base64 的加密 qrc。
2. `qrc_decrypt()` 解密 → `qrc_to_enhanced_lrc()` 转成增强型 LRC。
3. 在 `backend.py` 的 lyric 端点里，对 QQ 源（`info.source` 以 'QQ' 开头）调用本模块，
   逻辑与网易 yrc 分支并列即可。
"""
from __future__ import annotations

import html
import re
import zlib

# ---- QQMusic 三段 8 字节密钥（16 字符密钥的前 8 字节），操作顺序 Ddes -> des -> Ddes ----
_KEY1 = b"!@#)(NHL"
_KEY2 = b"123ZXC!@"
_KEY3 = b"!@#)(*$%"

_M32 = 0xFFFFFFFF

# Brad Conte DES 的 S 盒；sbox4 第 4 行的 (…,10,10,…) 即 QQ 改坏处（标准 DES 此处为 10,5）
_SBOX = [
    [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
    [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,15,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
    [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
    [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,10,13,8,9,4,5,11,12,7,2,14],
    [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
    [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
    [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
    [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
]


def _bitnum(a, b, c):
    return ((a[(b // 32) * 4 + 3 - (b % 32) // 8] >> (7 - (b % 8))) & 1) << c


def _bitnumintr(a, b, c):
    return ((a >> (31 - b)) & 1) << c


def _bitnumintl(a, b, c):
    return ((a << b) & 0x80000000) >> c


def _sboxbit(a):
    return (a & 0x20) | ((a & 0x1f) >> 1) | ((a & 0x01) << 4)


_IP0 = [(57,31),(49,30),(41,29),(33,28),(25,27),(17,26),(9,25),(1,24),(59,23),(51,22),(43,21),(35,20),(27,19),(19,18),(11,17),(3,16),(61,15),(53,14),(45,13),(37,12),(29,11),(21,10),(13,9),(5,8),(63,7),(55,6),(47,5),(39,4),(31,3),(23,2),(15,1),(7,0)]
_IP1 = [(56,31),(48,30),(40,29),(32,28),(24,27),(16,26),(8,25),(0,24),(58,23),(50,22),(42,21),(34,20),(26,19),(18,18),(10,17),(2,16),(60,15),(52,14),(44,13),(36,12),(28,11),(20,10),(12,9),(4,8),(62,7),(54,6),(46,5),(38,4),(30,3),(22,2),(14,1),(6,0)]
_INVIP = [
    [(1,4,7),(0,4,6),(1,12,5),(0,12,4),(1,20,3),(0,20,2),(1,28,1),(0,28,0)],
    [(1,5,7),(0,5,6),(1,13,5),(0,13,4),(1,21,3),(0,21,2),(1,29,1),(0,29,0)],
    [(1,6,7),(0,6,6),(1,14,5),(0,14,4),(1,22,3),(0,22,2),(1,30,1),(0,30,0)],
    [(1,7,7),(0,7,6),(1,15,5),(0,15,4),(1,23,3),(0,23,2),(1,31,1),(0,31,0)],
    [(1,0,7),(0,0,6),(1,8,5),(0,8,4),(1,16,3),(0,16,2),(1,24,1),(0,24,0)],
    [(1,1,7),(0,1,6),(1,9,5),(0,9,4),(1,17,3),(0,17,2),(1,25,1),(0,25,0)],
    [(1,2,7),(0,2,6),(1,10,5),(0,10,4),(1,18,3),(0,18,2),(1,26,1),(0,26,0)],
    [(1,3,7),(0,3,6),(1,11,5),(0,11,4),(1,19,3),(0,19,2),(1,27,1),(0,27,0)],
]
_PBOX = [15,6,19,20,28,11,27,16,0,14,22,25,4,17,30,9,1,7,23,13,31,26,2,8,18,12,29,5,21,10,3,24]
_KEY_C = [56,48,40,32,24,16,8,0,57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35]
_KEY_D = [62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,60,52,44,36,28,20,12,4,27,19,11,3]
_KEY_COMP = [13,16,10,23,0,4,2,27,14,5,20,9,22,18,11,3,25,7,15,6,26,19,12,1,40,51,30,36,46,54,29,39,50,44,32,47,43,48,38,55,33,52,45,41,49,35,28,31]
_SHIFT = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1]


def _ip(inb):
    s0 = s1 = 0
    for b, c in _IP0:
        s0 |= _bitnum(inb, b, c)
    for b, c in _IP1:
        s1 |= _bitnum(inb, b, c)
    return [s0 & _M32, s1 & _M32]


def _invip(state):
    out = bytearray(8)
    for idx in range(8):
        v = 0
        for si, b, c in _INVIP[idx]:
            v |= _bitnumintr(state[si], b, c)
        out[idx] = v & 0xff
    return out


def _f(state, key):
    t1 = (_bitnumintl(state,31,0)|((state&0xf0000000)>>1)|_bitnumintl(state,4,5)|_bitnumintl(state,3,6)|
          ((state&0x0f000000)>>3)|_bitnumintl(state,8,11)|_bitnumintl(state,7,12)|((state&0x00f00000)>>5)|
          _bitnumintl(state,12,17)|_bitnumintl(state,11,18)|((state&0x000f0000)>>7)|_bitnumintl(state,16,23)) & _M32
    t2 = (_bitnumintl(state,15,0)|((state&0x0000f000)<<15)|_bitnumintl(state,20,5)|_bitnumintl(state,19,6)|
          ((state&0x00000f00)<<13)|_bitnumintl(state,24,11)|_bitnumintl(state,23,12)|((state&0x000000f0)<<11)|
          _bitnumintl(state,28,17)|_bitnumintl(state,27,18)|((state&0x0000000f)<<9)|_bitnumintl(state,0,23)) & _M32
    lrg = [(t1>>24)&0xff,(t1>>16)&0xff,(t1>>8)&0xff,(t2>>24)&0xff,(t2>>16)&0xff,(t2>>8)&0xff]
    for i in range(6):
        lrg[i] ^= key[i]
    st = ((_SBOX[0][_sboxbit(lrg[0]>>2)]<<28)|(_SBOX[1][_sboxbit(((lrg[0]&0x03)<<4)|(lrg[1]>>4))]<<24)|
          (_SBOX[2][_sboxbit(((lrg[1]&0x0f)<<2)|(lrg[2]>>6))]<<20)|(_SBOX[3][_sboxbit(lrg[2]&0x3f)]<<16)|
          (_SBOX[4][_sboxbit(lrg[3]>>2)]<<12)|(_SBOX[5][_sboxbit(((lrg[3]&0x03)<<4)|(lrg[4]>>4))]<<8)|
          (_SBOX[6][_sboxbit(((lrg[4]&0x0f)<<2)|(lrg[5]>>6))]<<4)|_SBOX[7][_sboxbit(lrg[5]&0x3f)]) & _M32
    out = 0
    for c, b in enumerate(_PBOX):
        out |= _bitnumintl(st, b, c)
    return out & _M32


def _key_setup(key, decrypt):
    C = D = 0
    for i in range(28):
        C |= _bitnum(key, _KEY_C[i], 31 - i)
    for i in range(28):
        D |= _bitnum(key, _KEY_D[i], 31 - i)
    sched = [[0] * 6 for _ in range(16)]
    for i in range(16):
        s = _SHIFT[i]
        C = (((C << s) & _M32) | (C >> (28 - s))) & 0xfffffff0
        D = (((D << s) & _M32) | (D >> (28 - s))) & 0xfffffff0
        to = 15 - i if decrypt else i
        for j in range(24):
            sched[to][j // 8] |= _bitnumintr(C, _KEY_COMP[j], 7 - (j % 8))
        for j in range(24, 48):
            sched[to][j // 8] |= _bitnumintr(D, _KEY_COMP[j] - 27, 7 - (j % 8))
    return sched


def _des(buff, key8, decrypt):
    sched = _key_setup(key8, decrypt)
    out = bytearray(len(buff))
    for i in range(0, len(buff), 8):
        state = _ip(buff[i:i + 8])
        for idx in range(15):
            t = state[1]
            state[1] = (_f(state[1], sched[idx]) ^ state[0]) & _M32
            state[0] = t
        state[0] = (_f(state[1], sched[15]) ^ state[0]) & _M32
        out[i:i + 8] = _invip(state)
    return out


def qrc_decrypt(hex_payload: str) -> bytes:
    """十六进制加密 qrc -> 解压后的 qrc XML 字节。"""
    data = bytearray(bytes.fromhex(hex_payload))
    data = _des(data, _KEY1, True)
    data = _des(data, _KEY2, False)
    data = _des(data, _KEY3, True)
    return zlib.decompress(bytes(data))


# ---- qrc XML -> 增强型 LRC（与 backend._yrc_to_enhanced_lrc 输出格式一致）----
_LYRIC_CONTENT = re.compile(r'LyricContent="(.*?)"', re.S)
_QRC_LINE = re.compile(r"\[(\d+),(\d+)\]([^\[]*)")
_QRC_WORD = re.compile(r"\((\d+),(\d+),\d+\)([^()]*)")


def _ms_tag(ms: int, bracket: bool) -> str:
    if ms < 0:
        ms = 0
    body = f"{ms // 60000:02d}:{(ms % 60000) // 1000:02d}.{ms % 1000:03d}"
    return f"[{body}]" if bracket else f"<{body}>"


def qrc_to_enhanced_lrc(qrc_xml: str) -> str:
    """qrc XML -> 增强型 LRC。有逐字 (s,d,0) 则逐字标注；只有行级则退化成普通 LRC 行。"""
    m = _LYRIC_CONTENT.search(qrc_xml)
    if not m:
        return ""
    content = html.unescape(m.group(1))
    out: list[str] = []
    for ls, ld, body in _QRC_LINE.findall(content):
        line_start, line_dur = int(ls), int(ld)
        words = _QRC_WORD.findall(body)
        if words:
            parts = [_ms_tag(line_start, True)]
            for w_start, _w_dur, text in words:
                parts.append(_ms_tag(int(w_start), False))
                parts.append(text)
            parts.append(_ms_tag(line_start + line_dur, False))  # 行尾真实结束时间
            out.append("".join(parts))
        else:
            text = body.strip()
            if text:
                out.append(_ms_tag(line_start, True) + text)
    return "\n".join(out)
