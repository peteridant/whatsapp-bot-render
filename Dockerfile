FROM node:22-bookworm

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV BOT_HEADLESS=true
ENV CHROME_PATH=/usr/bin/chromium
ENV WWEBJS_AUTH_PATH=/app/data/.wwebjs_auth

RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libu2f-udev \
    libvulkan1 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data/.wwebjs_auth

EXPOSE 3000

CMD ["node", "index.js"]
