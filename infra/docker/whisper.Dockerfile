# syntax=docker/dockerfile:1
# whisper.cpp server for speech to text (PLAN.md 5.11), built for any x86-64 CPU with AVX2.
# The official image (ghcr.io/ggml-org/whisper.cpp) is compiled with -march=native on a CI runner
# that has AVX512 and crashes with SIGILL on CPUs without it (seen on the i5-10500T, 15.10.2026).
#   docker build -f infra/docker/whisper.Dockerfile -t whiteboard-whisper .
ARG WHISPER_VERSION=v1.9.5

FROM debian:trixie-slim AS build
ARG WHISPER_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates libgomp1 \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${WHISPER_VERSION}" https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
# Explicit instruction sets instead of the build machine's: AVX2 level (Haswell, 2013) and newer.
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_BMI2=ON \
    -DGGML_AVX512=OFF -DGGML_AVX_VNNI=OFF -DGGML_AMX_TILE=OFF -DGGML_AMX_INT8=OFF -DGGML_AMX_BF16=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
  && cmake --build build --target whisper-server -j"$(nproc)" \
  && strip build/bin/whisper-server

FROM debian:trixie-slim
LABEL org.opencontainers.image.source="https://github.com/Iroxx1/whiteboard" \
      org.opencontainers.image.description="whisper.cpp server (AVX2, no AVX512) for the whiteboard"
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates libgomp1 tini \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
EXPOSE 8080
# Arguments (model, language, threads) come from docker-compose.yml.
ENTRYPOINT ["tini", "--", "whisper-server"]
