#!/bin/bash
# Sets up SLIP networking for QEMU mqtt_pub sample
# Usage: sudo ./setup-net.sh

NET_TOOLS=/opt/zephyrproject/tools/net-tools

if [ ! -x "$NET_TOOLS/tunslip6" ]; then
    echo "Building tunslip6..."
    sudo make -C "$NET_TOOLS" tunslip6 || { echo "Failed to build tunslip6"; exit 1; }
fi

cleanup() {
    echo "Cleaning up..."
    kill $SOCAT_PID $NETSETUP_PID $TUNSLIP_PID 2>/dev/null
    exit 0
}
trap cleanup INT TERM

sudo $NET_TOOLS/loop-socat.sh &
SOCAT_PID=$!

sleep 1

sudo $NET_TOOLS/net-setup.sh &
NETSETUP_PID=$!

sleep 1

sudo $NET_TOOLS/tunslip6 -t zeth -T -s /tmp/slip.dev 192.0.2.1/24 &
TUNSLIP_PID=$!

echo "Network ready. Press CTRL+C to stop."
wait
