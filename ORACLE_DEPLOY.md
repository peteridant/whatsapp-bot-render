# Oracle Cloud Free VM Deployment

This is the best free option for running this bot 24/7.

## What you need

- An Oracle Cloud account
- One Ubuntu VM from the Always Free tier
- Your project copied to the VM

Official references:

- Oracle Cloud Free Tier: https://www.oracle.com/cloud/free/
- Oracle Free Tier docs: https://docs.oracle.com/iaas/Content/FreeTier/freetier.htm

## 1. Create the VM

Create an Ubuntu instance in Oracle Cloud Always Free.

Recommended:

- Ubuntu 22.04 or 24.04
- Public IP enabled
- SSH key configured

## 2. SSH into the VM

Example:

```bash
ssh ubuntu@YOUR_SERVER_IP
```

## 3. Copy the project to the VM

You can use GitHub or `scp`.

Example with `scp` from your PC:

```bash
scp -r "whatsapp bot" ubuntu@YOUR_SERVER_IP:/home/ubuntu/
```

Then on the VM:

```bash
sudo mkdir -p /opt/whatsapp-bot
sudo cp -r /home/ubuntu/"whatsapp bot"/. /opt/whatsapp-bot/
sudo chown -R ubuntu:ubuntu /opt/whatsapp-bot
cd /opt/whatsapp-bot
```

## 4. Run the setup script

```bash
chmod +x scripts/oracle-setup.sh
./scripts/oracle-setup.sh
```

## 5. Add your Groq key

Create `/opt/whatsapp-bot/.env`

```bash
nano /opt/whatsapp-bot/.env
```

Add:

```env
GROQ_API_KEY=your_groq_key_here
```

Save, then restart:

```bash
sudo systemctl restart whatsapp-bot
```

## 6. Watch logs and scan QR

```bash
sudo journalctl -u whatsapp-bot -f
```

The first time, wait for the QR and scan it with WhatsApp.

## 7. Check status

```bash
sudo systemctl status whatsapp-bot
```

## Notes

- The WhatsApp session is stored on the VM in `.wwebjs_auth`
- If you destroy the VM or delete that folder, you will scan again
- This is still based on `whatsapp-web.js`, not the official WhatsApp Cloud API
