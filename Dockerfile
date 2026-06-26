# ---------- Stage 1: 构建前端 ----------
FROM node:22-alpine AS frontend-builder

WORKDIR /build/frontend
COPY web/frontend/package.json web/frontend/package-lock.json* ./
RUN npm ci || npm install
COPY web/frontend/ ./
# 构建产物输出到 /build/static（vite.config.ts 中 outDir=../static）
RUN npm run build

# ---------- Stage 2: 运行后端 ----------
FROM python:3.12-slim

# 安装 ffmpeg（HLS 下载/转码需要）与清理 apt 缓存
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖以利用 docker 缓存
COPY requirements.txt ./requirements-root.txt
RUN pip install --no-cache-dir -r requirements-root.txt
COPY web/requirements.txt ./requirements-web.txt
RUN pip install --no-cache-dir -r requirements-web.txt

# 拷贝项目源码（musicdl 包 + web 后端）
COPY musicdl ./musicdl
COPY web/backend.py web/placeholder.html ./web/
COPY web/api ./web/api
COPY web/__init__.py ./web/

# 拷贝前端构建产物
COPY --from=frontend-builder /build/static ./web/static

# 数据持久化目录：歌单等用户数据写到这里（playlists.json）。
# 后端读取 MUSICDL_DATA_DIR；声明为 VOLUME，运行时映射到宿主机本地路径即可持久化、容器重建不丢。
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    MUSICDL_DATA_DIR=/app/data

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "web.backend:app", "--host", "0.0.0.0", "--port", "8000"]
