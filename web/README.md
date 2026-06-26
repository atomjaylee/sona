# musicdl web

为 musicdl 增加的 Web 前端（Spotify 风格界面），支持多源并行检索、试听播放、歌词显示、一键浏览器下载与歌单 URL 解析。

## 技术栈

- 后端：FastAPI + uvicorn + sse-starlette（复用 `musicdl` 库）
- 前端：React 19 + Vite 7 + TypeScript（构建产物输出到 `web/static`，由 FastAPI 同源托管）

## 目录结构

```
web/
├── backend.py          # FastAPI 主服务
├── api/
│   ├── models.py       # Pydantic 模型
│   └── session.py      # MusicClient 单例（分页并行检索）+ 检索结果缓存
├── static/             # 前端构建产物（npm run build 生成）
├── frontend/           # React 源码
└── requirements.txt    # 后端依赖
```

## 快速开始

### 1. 安装依赖

```bash
pip install -r web/requirements.txt        # 后端
cd web/frontend && npm install             # 前端（开发时需要）
```

### 2. 生产模式（一键启动）

```bash
cd web/frontend && npm run build           # 构建到 web/static
cd ../..
python -m uvicorn web.backend:app --port 8000
# 浏览器访问 http://localhost:8000
```

或直接：

```bash
python -m web.backend
```

### 3. 开发模式（热更新）

```bash
# 终端 1：后端
python -m uvicorn web.backend:app --port 8000 --reload

# 终端 2：前端（Vite dev，自动代理 /api 到 8000）
cd web/frontend && npm run dev
# 访问 http://localhost:5173
```

## 功能

| 功能 | 说明 |
|------|------|
| 关键词搜索 | 默认 5 个国内源并发检索（咪咕/网易云/QQ/酷我/千千），每源内部按分页多线程并行解析直链，SSE 流式返回（快源先显示） |
| 在线试听 | 后端代理播放流（解决防盗链/跨域），`<audio>` 播放 |
| 播放列表 | 队列管理，上一首/下一首，循环 |
| 歌词 | 自动获取并按 LRC 时间戳滚动高亮 |
| 下载 | 点击 ⬇ 后端以 `attachment` 代理音频，浏览器原生下载（不落服务端磁盘） |
| 歌单解析 | 粘贴歌单 URL，批量列出并下载 |

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sources` | 可用/已启用音乐源 |
| GET | `/api/search?keyword=` | 多源并发搜索 |
| POST | `/api/playlist` | 解析歌单 URL |
| GET | `/api/lyric/{song_id}` | 获取歌词 |
| GET | `/api/search/stream?keyword=` | 多源并发搜索（SSE 流式，快源先返回） |
| GET | `/api/stream/{song_id}` | 播放流代理 |
| GET | `/api/download/{song_id}` | 以 attachment 代理音频，触发浏览器原生下载 |

## 说明与限制

- **可播放/可下载性**：仅 `download_url` 为 HTTP 直链的源可在浏览器播放与下载（默认 5 个国内源多为可播放）。HLS/加密对象类源前端会标记为不可用（按钮置灰）。
- **检索提速**：每个源把 `search_size_per_source` 拆成更小的 `search_size_per_page` 分页，每个分页在独立线程里解析直链/校验/取歌词，从而把「单页内逐首串行」变成「多页并行」；参数见 `web/api/session.py`。同关键词 5 分钟内命中内存缓存秒回。
- **下载方式**：浏览器原生下载，后端仅做流式代理（`Content-Disposition: attachment`，含 UTF-8 文件名），不在服务端落盘。
- **防盗链**：播放与下载均会携带 `SongInfo.default_download_headers/cookies`。个别源链接可能因时效/防盗链返回空响应或 403，属源站限制。
- **歌词**：优先用搜索返回的 `lyric`，缺失时尝试补充获取。
- **数据缓存**：搜索结果按 `source:identifier` 缓存在内存，用于后续播放/下载；服务重启后需重新搜索。

> 项目许可证为 PolyForm-Noncommercial，仅用于个人已订阅内容备份或学术研究。
