#!/bin/sh
# Install the udev rule so the GameCube adapter is accessible without root.
RULE="/usr/lib/Stick Coach/51-gcadapter.rules"
if [ -f "$RULE" ]; then
  cp "$RULE" /etc/udev/rules.d/51-gcadapter.rules
  udevadm control --reload-rules 2>/dev/null || true
  udevadm trigger --subsystem-match=usb --attr-match=idVendor=057e 2>/dev/null || true
fi
exit 0
