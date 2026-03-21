# Zephyr QEMU Emulation Cases on SoCA

> **Guideline:** [DESIGN.md](./DESIGN.md) — AI-Assisted Embedded SDLC on AWS (SoCA Reference Architecture)
>
> **AMI Automation:** [`embedded-sdlc-using-zephyr-and-kiro-cli/deployment/`](./embedded-sdlc-using-zephyr-and-kiro-cli/deployment/README.md) — CDK stack (`ZephyrAmiStack`) — EC2 Image Builder pipeline
>
> **Zephyr QEMU Board References:**
> - [QEMU Emulation for ARM Cortex-M3](https://docs.zephyrproject.org/latest/boards/qemu/cortex_m3/doc/index.html)
> - [QEMU Emulation for ARM Cortex-R5](https://docs.zephyrproject.org/latest/boards/qemu/cortex_r5/doc/index.html)
> - [QEMU Emulation for ARM Cortex-A53](https://docs.zephyrproject.org/latest/boards/qemu/cortex_a53/doc/index.html)

---

## Overview

This document describes concrete implementation plans for four QEMU-based Zephyr development scenarios running on **SOCA Target Nodes** (AWS Graviton EC2 instances). Each case follows the SoCA workflow defined in `DESIGN.md`:

1. Developer requests a SOCA Target Node provisioned from the **`Zephyr-RTOS-Dev-arm64`** software stack
2. The stack AMI is produced by the **`ZephyrAmiStack` CDK pipeline** — Ubuntu 24.04 arm64, full toolchain pre-baked at `/opt/zephyrproject/` and `/opt/zephyr-sdk/`
3. Connects via VSCode Remote-SSH
4. Uses Kiro CLI as AI co-pilot throughout the SDLC
5. Builds, runs, and iterates firmware entirely in QEMU — no physical hardware required

### SOCA Software Stack Matrix

All four cases share a **single AMI** (`soca-zephyr-rtos-arm64-<date>`) produced by the CDK stack. Mosquitto, socat, and iproute2 are pre-installed in every node — no case-specific AMI is needed.

| Case | Board | Architecture | EC2 Type (Graviton) | QEMU Binary | SDK Toolchain |
|------|-------|-------------|---------------------|-------------|---------------|
| 1 | `qemu_cortex_m3` | ARM Cortex-M3 (32-bit) | `t4g.large` | `qemu-system-arm` | `arm-zephyr-eabi` |
| 2 | `qemu_cortex_r5` | ARM Cortex-R5F (32-bit) | `t4g.large` | `qemu-system-arm` | `arm-zephyr-eabi` |
| 3 | `qemu_cortex_a53` | ARM Cortex-A53 (64-bit) | `t4g.xlarge` | `qemu-system-aarch64` (via `qemu-system-misc`) | `aarch64-zephyr-elf` |
| 4 | `qemu_cortex_m3` | ARM Cortex-M3 (32-bit) | `t4g.large` | `qemu-system-arm` | `arm-zephyr-eabi` |

### Toolchain Locations (pre-baked by Image Builder component)

| Path | Contents |
|------|----------|
| `/opt/zephyrproject/` | West workspace — Zephyr RTOS + all HAL modules |
| `/opt/zephyrproject/.venv/` | Python venv — West + Zephyr Python dependencies |
| `/opt/zephyr-sdk/arm-zephyr-eabi/` | ARM cross-compiler (Cases 1, 2, 4) |
| `/opt/zephyr-sdk/aarch64-zephyr-elf/` | AArch64 cross-compiler (Case 3) |
| `/usr/bin/qemu-system-arm` | QEMU for ARM 32-bit targets |
| `/usr/bin/qemu-system-aarch64` | QEMU for AArch64 targets |

### Per-session venv activation (pre-configured in `.bashrc` by User Data)

```bash
source /opt/zephyrproject/.venv/bin/activate
# ZEPHYR_BASE=/opt/zephyrproject/zephyr is also set automatically
```

---

## Case 1: `qemu_cortex_m3` — IoT Sensor Node Firmware (Baseline)

### Board Profile

| Property | Value |
|----------|-------|
| **Board name** | `qemu_cortex_m3` |
| **Emulated platform** | TI LM3S6965 |
| **Architecture** | ARM Cortex-M3 |
| **System clock** | 12 MHz |
| **Serial** | Stellaris UART (UART0) |
| **Interrupt controller** | ARMv7-M NVIC |
| **Timer** | ARMv7-M System Tick |
| **Zephyr status** | Not actively maintained — stable for QEMU use |
| **Docs** | https://docs.zephyrproject.org/latest/boards/qemu/cortex_m3/doc/index.html |

### Goal

Validate the complete SoCA embedded SDLC pipeline on the simplest and fastest-booting QEMU target. Ideal for onboarding, CI/CD smoke tests, and Zephyr kernel feature exploration.

### SOCA Software Stack

- **AMI:** `soca-zephyr-rtos-arm64-<date>` — produced by `ZephyrAmiStack` CDK pipeline
  - Pre-baked: `qemu-system-arm`, `arm-zephyr-eabi` toolchain, West workspace at `/opt/zephyrproject/`
- **User Data:** Standard bootstrap — per-user symlinks, `.bashrc` venv activation, workspace trust
- **Target Node Profile:** `t4g.large` (Graviton2, 2 vCPU / 8 GB), root volume 100 GB gp3

### Step-by-Step Workflow

```
Step 1 · REQUEST TARGET NODE
  ├── Log into SOCA portal
  ├── Select Software Stack: "Zephyr-RTOS-Dev-arm64"
  └── Launch → EC2 Graviton boots, User Data runs bootstrap automatically

Step 2 · CONNECT
  ├── VSCode → Remote-SSH → <EC2_PRIVATE_IP>
  ├── VSCode Server installs Zephyr IDE extension server-side
  └── Open terminal — venv is already active via .bashrc:
        source zephyrproject/.venv/bin/activate
  Clone github guidance repo: git clone https://github.com/aws-samples/sample-sdlc-using-kiro-and-zephyr-on-edh.git
  cd sample-sdlc-using-kiro-and-zephyr-on-edh

Step 3 · AI CO-PILOT ONLINE
  ├── kiro-cli (in terminal or chat panel)
  └── Kiro context: "I am working on qemu_cortex_m3 with Zephyr RTOS
        I want the existing example in ~/zephyrproject/zephyr/samples/net/mqtt_publisher as a fresh
        example in sample-sdlc-using-kiro-and-zephyr-on-edh/src - Copy it over"

Step 4 · BUILD
  ├── cd ~/zephyrproject/zephyr
  ├── west build -p -b qemu_cortex_m3 ~/sample-sdlc-using-kiro-and-zephyr-on-edh/src/mqtt_pub
  ├── [on error] → paste to Kiro CLI → Kiro diagnoses
  └── Expected: Build directory at ~/zephyrproject/build/


Install mosquitto: sudo apt install net-tools

Step 5 · RUN IN QEMU
  ├── west build -t run
  ├── QEMU boots Zephyr, serial output appears in terminal
  └── Expected output:
        *** Booting Zephyr OS build v4.x.x ***
        Hello World! qemu_cortex_m3

Step 7 · SENSOR POLLING SAMPLE
  ├── west build -b qemu_cortex_m3 zephyr/samples/sensor/fxos8700
  │   (or stub sensor via CONFIG_SENSOR_SHELL=y)
  ├── prj.conf: CONFIG_SENSOR=y
  │             CONFIG_SHELL=y
  └── Kiro prompt: "Add a Zephyr sensor stub that returns simulated
        temperature readings every 500ms and prints via printk"

Step 8 · ITERATE
  ├── Edit source in VSCode → west build -t run → observe output
  ├── Kiro assists: Kconfig options, Zephyr API calls, DeviceTree stubs
  └── All changes persisted on EC2 EBS volume

Step 9 · RELEASE
  ├── Snapshot workspace to S3/EFS
  └── Terminate SOCA Target Node (cost control)
```

### Expected Serial Output

```
*** Booting Zephyr OS build v4.x.x-xxx ***
[00:00:00.000] Hello World! qemu_cortex_m3
[00:00:00.500] sensor: temp=22.50 C
[00:00:01.000] sensor: temp=22.51 C
```

### Kiro CLI Prompts & Tips

```
"Set up a Zephyr hello world project for qemu_cortex_m3.
 Workspace is at /opt/zephyrproject/, venv at /opt/zephyrproject/.venv/"
"Why does west build fail with 'DT_N_NODELABEL_uart0_P_STATUS_IDX_0_EXISTS'?"
"Add a CONFIG_SENSOR stub that returns simulated temperature every 500ms"
"Show me how to use Zephyr's printk vs LOG_INF for debug output"
```

---

## Case 2: `qemu_cortex_r5` — Real-Time Safety-Critical Application

### Board Profile

| Property | Value |
|----------|-------|
| **Board name** | `qemu_cortex_r5` |
| **Emulated platform** | Xilinx ZynqMP RPU (Real-time Processing Unit) |
| **Architecture** | ARM Cortex-R5F |
| **Serial** | Xilinx PS UART |
| **Timer** | Xilinx PS Triple-Timer Counter (TTC) @ 1000 Hz |
| **Interrupt controller** | ARM GIC v1 |
| **IPC** | Xilinx IPI (Inter-Processor Interrupt) mailbox |
| **Ethernet** | Xilinx GEM (4 instances) |
| **Zephyr status** | Not actively maintained — stable for QEMU use |
| **Docs** | https://docs.zephyrproject.org/latest/boards/qemu/cortex_r5/doc/index.html |

### Goal

Demonstrate hard real-time scheduling and deterministic interrupt latency on a Cortex-R5 class target. Suitable for motor control, industrial automation, and safety-critical timing validation without physical silicon.

### SOCA Software Stack

- **AMI:** `soca-zephyr-rtos-arm64-<date>` — same AMI as Case 1; `arm-zephyr-eabi` covers Cortex-R5F
- **User Data:** Standard bootstrap
- **Target Node Profile:** `t4g.large` (Graviton2, 2 vCPU / 8 GB), root volume 100 GB gp3

### Step-by-Step Workflow

```
Step 1 · REQUEST TARGET NODE
  └── Same as Case 1 — use "Zephyr-RTOS-Dev-arm64" stack

Step 2–3 · CONNECT + AI CO-PILOT ONLINE
  └── Same as Case 1
      Kiro context: "Working on qemu_cortex_r5, Xilinx ZynqMP RPU emulation.
        Workspace: /opt/zephyrproject/  SDK: /opt/zephyr-sdk/arm-zephyr-eabi/"

Step 4 · CREATE PROJECT — Thread Synchronization
  ├── cd /opt/zephyrproject
  ├── west build -b qemu_cortex_r5 zephyr/samples/synchronization
  └── Build config: Debug

Step 5 · BUILD
  ├── west build -b qemu_cortex_r5 zephyr/samples/synchronization
  └── [on error] → Kiro: "west build fails for qemu_cortex_r5 with..."

Step 6 · RUN — Verify Real-Time Scheduling
  ├── west build -t run
  └── Expected output:
        thread_a: Hello World from cpu 0 on qemu_cortex_r5!
        thread_b: Hello World from cpu 0 on qemu_cortex_r5!
        (alternating at configured priority/delay)

Step 7 · CONFIGURE REAL-TIME PRIORITIES
  ├── prj.conf:
  │     CONFIG_NUM_PREEMPT_PRIORITIES=16
  │     CONFIG_TIMESLICING=y
  │     CONFIG_TIMESLICE_SIZE=1        # 1ms timeslice
  │     CONFIG_TIMESLICE_PRIORITY=0
  ├── Kiro prompt: "Help me configure Zephyr for minimum interrupt latency
  │     on qemu_cortex_r5 with 1ms thread timeslicing"
  └── Rebuild + run → verify tighter alternation in output

Step 8 · IPI INTER-PROCESSOR MESSAGE SAMPLE
  ├── Explore Zephyr IPM API with Xilinx IPI mailbox
  ├── prj.conf: CONFIG_IPM=y
  │             CONFIG_IPM_XLNX_ZYNQMP=y (if available)
  ├── Kiro prompt: "Show me how to use Zephyr's IPM API to send a message
  │     between tasks using the xlnx,zynqmp-ipi-mailbox device"
  └── Run → observe IPC message exchange in serial output

Step 9 · CUSTOM REAL-TIME CONTROL LOOP
  ├── Implement a timer-driven control loop (1kHz tick from TTC timer)
  ├── prj.conf: CONFIG_COUNTER=y
  ├── Kiro writes the counter callback skeleton
  └── Measure loop jitter via Zephyr timing API

Step 10 · RELEASE
  └── Snapshot + terminate (same as Case 1)
```

### Expected Serial Output

```
*** Booting Zephyr OS build v4.x.x ***
thread_a: Hello World from cpu 0 on qemu_cortex_r5!
thread_b: Hello World from cpu 0 on qemu_cortex_r5!
thread_a: Hello World from cpu 0 on qemu_cortex_r5!
thread_b: Hello World from cpu 0 on qemu_cortex_r5!
[control] TTC tick #1000 — loop jitter: 2 us
```

### Kiro CLI Prompts & Tips

```
"Configure Zephyr for hard real-time on qemu_cortex_r5 — minimize latency"
"What is the correct Kconfig for 1ms timeslicing on Cortex-R5?"
"Show a Zephyr k_timer callback that runs at exactly 1kHz"
"How do I measure thread scheduling jitter with Zephyr timing API?"
```

---

## Case 3: `qemu_cortex_a53` — Application Processor with Networking (SMP)

### Board Profile

| Property | Value |
|----------|-------|
| **Board name** | `qemu_cortex_a53` |
| **Architecture** | ARM Cortex-A53 (64-bit, AArch64) |
| **SoC** | qemu_cortex_a53 (generic virt) |
| **Serial** | ARM PL011 UART |
| **Timer** | ARM architected timer (per-core) |
| **Interrupt controller** | ARM GIC-v3 + ITS |
| **Ethernet** | Intel E1000 |
| **Networking** | VirtIO over MMIO (32 instances) |
| **PCIe** | ECAM mode PCIe controller |
| **SMP** | 2 CPU cores |
| **Zephyr status** | Maintained |
| **Docs** | https://docs.zephyrproject.org/latest/boards/qemu/cortex_a53/doc/index.html |

### Goal

Validate network stack features, SMP multi-threading, and richer OS capabilities on a 64-bit application processor target. Suitable for gateway-class firmware, protocol stack integration, and multi-core Zephyr applications.

### SOCA Software Stack

- **AMI:** `soca-zephyr-rtos-arm64-<date>` — same AMI as all cases; `aarch64-zephyr-elf` toolchain is pre-baked at `/opt/zephyr-sdk/aarch64-zephyr-elf/`; `qemu-system-aarch64` installed via `qemu-system-misc`
- **User Data:** Standard bootstrap
- **Target Node Profile:** `t4g.xlarge` (Graviton2, 4 vCPU / 16 GB) — extra memory for 64-bit AArch64 build artefacts

### Step-by-Step Workflow

```
Step 1 · REQUEST TARGET NODE
  └── SOCA Stack: "Zephyr-RTOS-Dev-arm64" — request t4g.xlarge instance type

Step 2–3 · CONNECT + AI CO-PILOT ONLINE
  └── Kiro context: "Working on qemu_cortex_a53 (AArch64, SMP=2 cores).
        aarch64-zephyr-elf at /opt/zephyr-sdk/aarch64-zephyr-elf/"

Step 4 · VERIFY TOOLCHAIN FOR AARCH64
  ├── ls /opt/zephyr-sdk/aarch64-zephyr-elf/bin/
  ├── /opt/zephyr-sdk/aarch64-zephyr-elf/bin/aarch64-zephyr-elf-gcc --version
  └── qemu-system-aarch64 --version

Step 5 · BUILD — Echo Server (Network Stack)
  ├── cd /opt/zephyrproject
  ├── west build -b qemu_cortex_a53 zephyr/samples/net/echo_server
  ├── prj.conf:
  │     CONFIG_NET_L2_ETHERNET=y
  │     CONFIG_NET_TCP=y
  │     CONFIG_NET_UDP=y
  │     CONFIG_NET_IPV4=y
  │     CONFIG_QEMU_ICOUNT=n          # required for net
  └── [on error] → Kiro diagnoses missing CONFIG_ dependencies

Step 6 · CONFIGURE VIRTIO NETWORKING
  ├── Zephyr uses VirtIO MMIO for network in qemu_cortex_a53
  ├── west build -t run passes QEMU args automatically via board config
  ├── Verify: serial output shows "IPv4 address assigned"
  └── Kiro prompt: "How do I configure VirtIO networking for
        qemu_cortex_a53 in Zephyr? What extra QEMU args are needed?"

Step 7 · RUN — Echo Server
  ├── west build -t run
  ├── On host: nc <qemu_ip> 4242 (TCP echo test)
  └── Expected: data sent → echoed back by Zephyr firmware

Step 8 · SMP THREADING SAMPLE
  ├── west build -b qemu_cortex_a53/qemu_cortex_a53/smp \
  │       zephyr/samples/synchronization
  ├── Observe threads running on cpu0 and cpu1 simultaneously
  └── Expected:
        thread_a: Hello World from cpu 0 on qemu_cortex_a53!
        thread_b: Hello World from cpu 1 on qemu_cortex_a53!

Step 9 · ITERATE
  ├── Add TLS to echo server (CONFIG_NET_SOCKETS_TLS=y)
  ├── Add mDNS service discovery
  └── Kiro assists with certificate provisioning in Zephyr flash

Step 10 · RELEASE
  └── Snapshot + terminate
```

### Expected Serial Output

```
*** Booting Zephyr OS build v4.x.x ***
[00:00:00.012] net: IPv4 address: 10.0.2.15
[00:00:00.013] net: subnet mask: 255.255.255.0
[00:00:00.013] net: gateway: 10.0.2.2
[00:00:00.013] echo_server: Waiting for TCP/UDP packets on port 4242
[00:00:02.500] echo_server: Received 12 bytes via TCP, echoing back
```

### Kiro CLI Prompts & Tips

```
"Configure VirtIO networking for qemu_cortex_a53 in Zephyr.
 Toolchain: /opt/zephyr-sdk/aarch64-zephyr-elf/"
"echo_server build fails with 'CONFIG_NET_SOCKETS undefined' — help"
"How do I enable SMP on qemu_cortex_a53 and pin threads to specific CPUs?"
"Add TLS to the Zephyr echo server using mbedTLS"
```

---

## Case 4: `qemu_cortex_m3` — HVAC Intelligent Sensor/Actuator ⭐ IoT Scenario

### Scenario Description

An HVAC embedded node running on **Zephyr RTOS** acts as an intelligent sensor/actuator:
- Reads simulated **temperature and humidity** sensors
- Publishes telemetry via **MQTT** to an edge gateway (`hvac/sensor/+` topics)
- Subscribes to actuator control commands (`hvac/actuator/setpoint`)
- Implements a **PID-style control loop** adjusting a simulated PWM actuator

The MQTT broker (Mosquitto) runs as a **host process on the same EC2 instance** — **pre-installed in the AMI** and started by User Data via `systemctl start mosquitto`. QEMU connects via a **SLIP virtual network interface** — no external infrastructure needed.

### System Architecture on EC2

```
┌─────────────────────────────────────────────────────────────────────┐
│  EC2 TARGET NODE (t4g.large — Graviton2)                            │
│  AMI: soca-zephyr-rtos-arm64-<date>                                 │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  QEMU — qemu-system-arm (qemu_cortex_m3)                     │   │
│  │                                                              │   │
│  │  Zephyr RTOS Firmware                                        │   │
│  │  ┌──────────────────┐  ┌─────────────────────────────────┐   │   │
│  │  │  Sensor Layer    │  │  MQTT Client (Zephyr mqtt lib)  │   │   │
│  │  │  · temp stub     │  │  · Publish: hvac/sensor/temp    │   │   │
│  │  │  · humidity stub │  │  · Publish: hvac/sensor/hum     │   │   │
│  │  └────────┬─────────┘  │  · Subscribe: hvac/act/setpnt   │   │   │
│  │           │            └────────────────┬────────────────┘   │   │
│  │  ┌────────▼─────────────────────────────▼────────────────┐   │   │
│  │  │  Control Loop (k_timer @ 1 Hz)                        │   │   │
│  │  │  · PID: error = setpoint - current_temp               │   │   │
│  │  │  · Output: simulated PWM duty cycle (0–100%)          │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  │                                                              │   │
│  │  Network: CONFIG_NET_SLIP_TAP=y → slip0 (192.168.1.2)        │   │
│  └─────────────────────────── SLIP/TAP ─────────────────────────┘   │
│                       │                                             │
│  ┌────────────────────▼──────────────────────────────────────┐      │
│  │  EC2 Host (pre-configured by User Data)                   │      │
│  │  · slip0 TAP interface (192.168.1.1) — ip tuntap + up     │      │
│  │  · Mosquitto MQTT broker — systemctl start mosquitto      │      │
│  │  · mosquitto_sub -t "hvac/#" -v  (monitoring)             │      │
│  └───────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

### SOCA Software Stack — What's Pre-installed in AMI

Mosquitto, socat, and iproute2 are **part of the base AMI** (installed by `InstallAptDependencies` in the Image Builder component). The User Data bootstrap activates them at node start:

```bash
# These are already in the AMI — User Data just starts/configures them:

# SLIP TAP interface — set up by User Data
ip tuntap add dev slip0 mode tap user {{ SOCA_USER }}
ip addr add 192.168.1.1/24 dev slip0
ip link set slip0 up

# Mosquitto — pre-installed; User Data starts the service
systemctl enable mosquitto
systemctl start mosquitto
```

**No separate `Zephyr-HVAC-Dev` stack is needed.** Use **`Zephyr-RTOS-Dev-arm64`** — the same AMI covers Case 4.

### Step-by-Step Workflow

```
Step 1 · REQUEST TARGET NODE
  ├── SOCA portal → Software Stack: "Zephyr-RTOS-Dev-arm64"
  └── Node boots: TAP interface up, Mosquitto broker running (via User Data)

Step 2 · CONNECT
  ├── VSCode → Remote-SSH → <EC2_PRIVATE_IP>
  └── Verify broker: mosquitto_sub -t "hvac/#" -v &
        (leave running in a split terminal)

Step 3 · AI CO-PILOT ONLINE
  ├── kiro-cli activated
  └── Kiro context prompt:
        "I am building an HVAC sensor/actuator Zephyr firmware for
         qemu_cortex_m3. It must publish temperature and humidity via
         MQTT to a Mosquitto broker at 192.168.1.1:1883 using SLIP
         networking. Workspace: /opt/zephyrproject/
         SDK ARM: /opt/zephyr-sdk/arm-zephyr-eabi/"

Step 4 · CREATE PROJECT — MQTT Publisher
  ├── cp -r /opt/zephyrproject/zephyr/samples/net/mqtt_publisher \
  │         /opt/zephyrproject/hvac
  └── cd /opt/zephyrproject/hvac

Step 5 · CONFIGURE prj.conf
  ├── Create/edit prj.conf:
  │     # Network — SLIP/TAP for QEMU
  │     CONFIG_NET_SLIP_TAP=y
  │     CONFIG_SLIP=y
  │     CONFIG_NET_L2_SLIP=y
  │     CONFIG_NET_IPV4=y
  │     CONFIG_NET_TCP=y
  │     CONFIG_NET_SOCKETS=y
  │     CONFIG_NET_SOCKETS_POSIX_NAMES=y
  │
  │     # MQTT
  │     CONFIG_MQTT_LIB=y
  │     CONFIG_MQTT_KEEPALIVE=60
  │
  │     # Sensor simulation
  │     CONFIG_SENSOR=y
  │     CONFIG_COUNTER=y
  │
  │     # Logging
  │     CONFIG_LOG=y
  │     CONFIG_MQTT_LOG_LEVEL_DBG=y
  │
  └── Kiro prompt: "Verify this prj.conf is correct for MQTT over SLIP
        on qemu_cortex_m3 — any missing CONFIG options?"

Step 6 · IMPLEMENT SENSOR STUBS (Kiro-assisted)
  ├── Kiro prompt:
  │     "Write a Zephyr C module with two functions:
  │      float hvac_read_temperature(void) → returns 20.0 + random jitter
  │      float hvac_read_humidity(void) → returns 50.0 + random jitter
  │      Use Zephyr's sys_rand32_get() for simulation"
  └── Save as src/hvac_sensor.c + include/hvac_sensor.h

Step 7 · IMPLEMENT MQTT PUBLISH/SUBSCRIBE LOOP (Kiro-assisted)
  ├── Kiro prompt:
  │     "Extend the Zephyr MQTT publisher sample to:
  │      1. Connect to broker at 192.168.1.1:1883
  │      2. Publish JSON {temp: X, hum: Y} to hvac/sensor/data every 2s
  │      3. Subscribe to hvac/actuator/setpoint
  │      4. On message received, update a global setpoint variable"
  └── Review and merge Kiro's generated code into src/main.c

Step 8 · IMPLEMENT CONTROL LOOP (Kiro-assisted)
  ├── Kiro prompt:
  │     "Add a Zephyr k_timer callback running at 1Hz that implements
  │      a simple bang-bang controller:
  │      if current_temp < setpoint - 0.5 → actuator_duty = 100%
  │      if current_temp > setpoint + 0.5 → actuator_duty = 0%
  │      else → hold current duty
  │      Log the duty cycle via LOG_INF"
  └── Save as src/hvac_control.c

Step 9 · BUILD
  ├── cd /opt/zephyrproject/hvac
  ├── west build -b qemu_cortex_m3 .
  └── [on error] → Kiro diagnoses (Pattern A + B from DESIGN.md)
        Common: missing CONFIG_NET_SOCKETS_POSIX_NAMES
                missing broker IP in overlay file
                MQTT buffer size too small

Step 10 · RUN — QEMU + MQTT
  ├── Terminal 1: west build -t run
  │     (QEMU starts, SLIP connects to slip0 TAP on host)
  │
  ├── Terminal 2 (split): mosquitto_sub -t "hvac/#" -v
  │
  └── Expected QEMU serial output:
        *** Booting Zephyr OS build v4.x.x ***
        [HVAC] Network interface UP — IP: 192.168.1.2
        [HVAC] Connecting to MQTT broker 192.168.1.1:1883...
        [HVAC] MQTT CONNECTED (session: hvac-node-01)
        [HVAC] Published: hvac/sensor/data → {"temp":22.5,"hum":58.2}
        [HVAC] control: temp=22.5 setpoint=24.0 duty=100%

Step 11 · SEND ACTUATOR COMMAND FROM HOST
  ├── mosquitto_pub -t hvac/actuator/setpoint -m "20.0"
  └── Expected QEMU output:
        [HVAC] Received setpoint=20.0
        [HVAC] control: temp=22.5 setpoint=20.0 duty=0%
        [HVAC] control: temp=22.1 setpoint=20.0 duty=0%
        [HVAC] control: temp=19.9 setpoint=20.0 duty=100%  ← within band

Step 12 · ITERATE
  ├── Add humidity-based ventilation control
  ├── Add MQTT Last Will & Testament for node offline detection
  ├── Add TLS (CONFIG_MQTT_LIB_TLS=y) for secure comms
  ├── Kiro prompt: "Add MQTT LWT so broker publishes
  │     hvac/status/node-01 = 'offline' if node disconnects"
  └── Implement multi-zone support (publish to hvac/zone/1/sensor/data)

Step 13 · RELEASE
  ├── Snapshot workspace to S3/EFS
  └── Terminate SOCA node
```

### Expected Terminal Output (Side-by-Side)

**QEMU Serial (Terminal 1):**
```
*** Booting Zephyr OS build v4.x.x-xxx ***
[00:00:00.100] [HVAC] Network interface UP — IP: 192.168.1.2
[00:00:00.210] [HVAC] Connecting to MQTT broker 192.168.1.1:1883...
[00:00:00.350] [HVAC] MQTT CONNECTED (client: hvac-node-01)
[00:00:02.000] [HVAC] Published: hvac/sensor/data {"temp":22.5,"hum":58.2}
[00:00:02.001] [HVAC] control: temp=22.5 setpoint=24.0 duty=100%
[00:00:04.000] [HVAC] Published: hvac/sensor/data {"temp":22.8,"hum":57.9}
[00:00:05.500] [HVAC] Received setpoint=20.0
[00:00:05.500] [HVAC] control: temp=22.8 setpoint=20.0 duty=0%
```

**Mosquitto Monitor (Terminal 2):**
```
hvac/sensor/data {"temp":22.5,"hum":58.2}
hvac/sensor/data {"temp":22.8,"hum":57.9}
hvac/actuator/setpoint 20.0
hvac/sensor/data {"temp":22.4,"hum":57.8}
```

### Kiro CLI Prompts & Tips

```
# Environment setup
"Configure SLIP networking for MQTT on qemu_cortex_m3 — broker at 192.168.1.1.
 Mosquitto is pre-installed at /usr/sbin/mosquitto (already running)."
"Why does CONFIG_NET_SLIP_TAP require a TAP device on the host?"

# Code generation
"Write a Zephyr sensor stub module returning simulated temp/humidity with noise"
"Extend the MQTT publisher to subscribe to a setpoint topic and store the value"
"Implement a bang-bang HVAC controller as a Zephyr k_timer callback"
"Add MQTT Last Will & Testament to announce node offline status"

# Debugging
"MQTT connect fails with ECONNREFUSED — how do I debug the SLIP interface?
 TAP setup: ip tuntap, ip addr 192.168.1.1/24, ip link set slip0 up"
"Zephyr shows 'no route to host' for 192.168.1.1 — check TAP setup"
"MQTT publish returns -ENOMEM — how do I increase the TX buffer size?"

# Enhancement
"Add TLS to the MQTT connection using Zephyr's mbedTLS integration"
"Implement multi-zone HVAC: each zone publishes to hvac/zone/<N>/sensor/data"
"Add Zephyr shell commands to set/get the actuator duty cycle at runtime"
```

---

## Common Patterns & Troubleshooting

### Runner Selection

```bash
# All 4 cases use the QEMU runner
west build -t run          # preferred — inline QEMU
west flash -r qemu         # explicit runner

# Never needed in SoCA:
west flash -r openocd      # requires physical board
west flash -r stm32cubeprogrammer  # not supported on Linux ARM64
```

### Workspace & Toolchain Quick Reference

```bash
# Venv — activated automatically via .bashrc (User Data pre-configured)
source /opt/zephyrproject/.venv/bin/activate

# West workspace root
cd /opt/zephyrproject

# Verify toolchains (smoke-tested at AMI build time by Image Builder)
west --version
/opt/zephyr-sdk/arm-zephyr-eabi/bin/arm-zephyr-eabi-gcc --version
/opt/zephyr-sdk/aarch64-zephyr-elf/bin/aarch64-zephyr-elf-gcc --version
qemu-system-arm --version
qemu-system-aarch64 --version
mosquitto --help | head -1
```

### Serial Output Capture

```bash
# Redirect QEMU serial to a file for analysis
west build -t run -- -serial file:/tmp/zephyr_serial.log

# Or use PTY (attach with minicom/picocom)
west build -t run -- -serial pty
```

### Kiro AI Integration Patterns (from DESIGN.md)

| Pattern | When to Use | Example |
|---------|-------------|---------|
| **A — Reactive** | Build error / runtime panic | Paste error → Kiro diagnoses root cause |
| **B — Config Patch** | Wrong runner / broken prj.conf | Kiro edits `zephyr-ide.json`, `prj.conf` |
| **C — Shell Exec** | Setup tasks on EC2 | Kiro runs `mosquitto_sub`, `ip addr` commands |
| **D — Domain Knowledge** | Zephyr API questions | Load Steering file with Zephyr MQTT/sensor API context |

### Zephyr SLIP Networking Quick Reference

```bash
# Host setup — handled by User Data at node boot (idempotent):
ip tuntap add dev slip0 mode tap user $USER 2>/dev/null || true
ip addr add 192.168.1.1/24 dev slip0 2>/dev/null || true
ip link set slip0 up

# Verify:
ip addr show slip0
ping 192.168.1.2   # from host → QEMU Zephyr node (once firmware is running)

# QEMU firmware IP (set in overlay or prj.conf):
CONFIG_NET_CONFIG_MY_IPV4_ADDR="192.168.1.2"
CONFIG_NET_CONFIG_PEER_IPV4_ADDR="192.168.1.1"   # broker

# Mosquitto — already started by User Data:
systemctl status mosquitto
mosquitto_sub -t "hvac/#" -v   # monitoring
mosquitto_pub -t hvac/actuator/setpoint -m "22.0"  # send command
```

### AMI Build & SOCA Stack — Operational Checklist

```
Before onboarding developers:

  [ ] Deploy CDK stack:
        cd embedded-sdlc-using-zephyr-and-kiro-cli/deployment
        npm install && npx cdk bootstrap && npx cdk deploy

  [ ] Wait for pipeline (~45-60 min):
        aws imagebuilder list-image-pipeline-images \
          --image-pipeline-arn <PipelineArn from cdk deploy output> \
          --query 'imageSummaryList[0].{State:state.status,AMI:outputResources.amis[0].image}' \
          --output table
        # Wait for State: AVAILABLE

  [ ] Get AMI ID:
        aws ec2 describe-images \
          --filters "Name=name,Values=soca-zephyr-rtos-arm64-*" \
                    "Name=state,Values=available" \
          --query 'sort_by(Images, &CreationDate)[-1].{ID:ImageId,Name:Name}' \
          --output table

  [ ] Register in SOCA Admin Portal:
        Name:     Zephyr-RTOS-Dev-arm64
        AMI ID:   ami-xxxxxxxxxxxxxxxxx
        Min Disk: 30 GB
        Profile:  Graviton (t4g.large / t4g.xlarge / m6g.large)
        User Data: (see DESIGN.md §3.3.4)
```

---

*Last updated: March 2026 | References: [DESIGN.md](./DESIGN.md) · [deployment/README.md](./embedded-sdlc-using-zephyr-and-kiro-cli/deployment/README.md) · [Zephyr QEMU Docs](https://docs.zephyrproject.org/latest/boards/qemu/index.html)*
