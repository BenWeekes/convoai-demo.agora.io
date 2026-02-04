# Conversational AI Demos Landing Page

Landing page for https://convoai-demo.agora.io

## Deployment

**Landing page HTML:**
- Source: `/home/ubuntu/web/index.html`
- Deploy to: `/var/www/landing/index.html`

**Assets (images, SVGs):**
- Source: `/home/ubuntu/web/assets/`
- Deploy to: `/home/ubuntu/agent-samples/assets/` (served via nginx at `/assets/`)

Note: Assets are NOT served from `/var/www/landing/assets/`. The nginx config aliases `/assets/` to `/home/ubuntu/agent-samples/assets/`.

## Quick Deploy

```bash
# Deploy landing page
sudo cp /home/ubuntu/web/index.html /var/www/landing/index.html

# Deploy assets
cp /home/ubuntu/web/assets/* /home/ubuntu/agent-samples/assets/
```
