FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended \
      texlive-pictures texlive-science lmodern make ghostscript poppler-utils \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
