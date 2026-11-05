FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates poppler-utils poppler-data mupdf-tools tesseract-ocr tesseract-ocr-chi-sim curl && rm -rf /var/lib/apt/lists/* && groupadd -g 10001 qingliu && useradd -u 10001 -g qingliu -M qingliu
ARG TARGETARCH
WORKDIR /app
COPY bin/qingliu-${TARGETARCH} /app/qingliu
COPY frontend/dist /app/frontend/dist
COPY fonts /app/fonts
ENV DATA_DIR=/data STATIC_DIR=/app/frontend/dist PDF_FONT=/app/fonts/NotoSansSC.ttf LISTEN_ADDR=0.0.0.0:8787 GOMEMLIMIT=512MiB GOMAXPROCS=2
RUN mkdir /data && chown qingliu:qingliu /data
USER 10001:10001
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://127.0.0.1:8787/health || exit 1
ENTRYPOINT ["/app/qingliu"]
