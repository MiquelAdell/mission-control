#!/bin/bash
# Run once with sudo: sudo bash setup-domain.sh
# Sets up mc.local → localhost:3333 via /etc/hosts + pf port redirect.

set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash $0"
  exit 1
fi

# ── /etc/hosts ────────────────────────────────────────────────────────────────
if grep -q "mc\.local" /etc/hosts; then
  echo "✓ /etc/hosts already has mc.local"
else
  echo "127.0.0.1 mc.local" >> /etc/hosts
  echo "✓ Added mc.local to /etc/hosts"
fi

# ── pf anchor file ────────────────────────────────────────────────────────────
cat > /etc/pf.anchors/mission-control << 'ANCHOR'
rdr pass on lo0 proto tcp from any to any port 80 -> 127.0.0.1 port 3333
ANCHOR
echo "✓ Created /etc/pf.anchors/mission-control"

# ── pf.conf ───────────────────────────────────────────────────────────────────
if grep -q "mission-control" /etc/pf.conf; then
  echo "✓ /etc/pf.conf already has mission-control anchor"
else
  cp /etc/pf.conf "/etc/pf.conf.bak.$(date +%Y%m%d)"
  cat >> /etc/pf.conf << 'PFCONF'

# Mission Control — mc.local → localhost:3333
rdr-anchor "mission-control"
anchor "mission-control"
load anchor "mission-control" from "/etc/pf.anchors/mission-control"
PFCONF
  echo "✓ Patched /etc/pf.conf (backup saved)"
fi

# ── LaunchDaemon to enable pf at every boot ───────────────────────────────────
cat > /Library/LaunchDaemons/com.miqueladell.mc-portforward.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.miqueladell.mc-portforward</string>
  <key>RunAtLoad</key>
  <true/>
  <key>ProgramArguments</key>
  <array>
    <string>/sbin/pfctl</string>
    <string>-f</string>
    <string>/etc/pf.conf</string>
    <string>-e</string>
  </array>
</dict>
</plist>
PLIST
echo "✓ Created LaunchDaemon"

# ── Load the daemon and activate pf now ──────────────────────────────────────
launchctl load /Library/LaunchDaemons/com.miqueladell.mc-portforward.plist 2>/dev/null || true
pfctl -f /etc/pf.conf -e 2>/dev/null || true
echo "✓ pf enabled and rules loaded"

echo ""
echo "Done. Open http://mc.local in your browser."
