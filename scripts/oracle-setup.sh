#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/whatsapp-bot"
SERVICE_FILE="/etc/systemd/system/whatsapp-bot.service"

sudo apt-get update
sudo apt-get install -y curl git ca-certificates

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

sudo apt-get install -y \
  chromium-browser \
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
  xdg-utils

sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"

if [ ! -f "$APP_DIR/package.json" ]; then
  echo "Copy the project into $APP_DIR before rerunning this script."
  exit 1
fi

cd "$APP_DIR"
npm install

sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=WhatsApp Bot
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
Environment=BOT_HEADLESS=true
Environment=CHROME_PATH=/usr/bin/chromium-browser
Environment=WWEBJS_AUTH_PATH=$APP_DIR/.wwebjs_auth
Environment=GROQ_MODEL=llama-3.3-70b-versatile
EnvironmentFile=-$APP_DIR/.env
ExecStart=/usr/bin/node $APP_DIR/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable whatsapp-bot
sudo systemctl restart whatsapp-bot

echo "Setup complete."
echo "Put GROQ_API_KEY in $APP_DIR/.env like this:"
echo "GROQ_API_KEY=your_key_here"
echo "Then run: sudo systemctl restart whatsapp-bot"
