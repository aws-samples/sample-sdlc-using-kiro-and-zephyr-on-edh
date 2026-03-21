---
marp: true
theme: default
paginate: true
style: |
  section {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 22px;
  }
  section.title {
    background: #1a2a3a;
    color: #ffffff;
    text-align: center;
    justify-content: center;
  }
  section.title h1 {
    font-size: 40px;
    color: #ff9900;
  }
  section.title h2 {
    font-size: 24px;
    color: #cccccc;
  }
  section.section-header {
    background: #232f3e;
    color: #ff9900;
    justify-content: center;
    text-align: center;
  }
  section.section-header h1 {
    font-size: 44px;
    color: #ff9900;
  }
  h1 { color: #232f3e; border-bottom: 3px solid #ff9900; padding-bottom: 8px; }
  h2 { color: #232f3e; }
  table { width: 100%; font-size: 18px; }
  th { background: #232f3e; color: #ff9900; }
  code { background: #f4f4f4; font-size: 16px; }
  pre { background: #1e1e1e; color: #d4d4d4; font-size: 14px; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  strong { color: #232f3e; }
---

<!-- _class: title -->

# AI-Assisted Embedded SDLC on AWS

## SoCA Reference Architecture
### Kiro CLI + Zephyr RTOS + QEMU on AWS Graviton

---

# The Problem: Embedded Development Lags Behind

**Generative AI has accelerated web & cloud development — but NOT embedded/IoT.**

| Barrier | Description |
|---------|-------------|
| 🔧 **Toolchain Complexity** | Cross-compilers, RTOSes, SDKs, flash runners, debug probes |
| 🏗️ **Architecture Sensitivity** | Binaries are CPU-arch specific (x86_64 vs ARM64) |
| 🔌 **Physical Hardware Dependency** | Traditionally requires a board on every developer's desk |
| 🤖 **AI Knowledge Gap** | Most AI assistants lack embedded/IoT domain knowledge |

> *Inspired by: ["IoT Development with Kiro: Part 1 — STM32 on Zephyr"](https://dev.to/aws-builders/iot-development-with-kiro-part-1-stm32-on-zephyr-1jg9) — Akira Tateishi, Feb 2026*

---

# The Solution: SoCA for Embedded SDLC

**SoCA** (Scale-Out Computing + AI) addresses all four barriers:

1. **Virtualize the embedded target** — run MCU firmware on QEMU on AWS EC2, managed by SOCA

2. **Standardize the toolchain** — pre-bake Zephyr SDK into SOCA Target Node AMIs via EC2 Image Builder (CDK-automated)

3. **Agentic AI via Kiro CLI** — reactive error analysis, agentic shell execution, config auto-patching

4. **Elastic on-demand dev nodes** — SOCA spins up/down EC2 Graviton nodes per developer request

---

<!-- _class: section-header -->

# Architecture Overview

---

# High-Level Architecture

```
┌─────────────────────────────────────────────┐
│         DEVELOPER WORKSTATION               │
│  VSCode (Remote-SSH) ◄──► Kiro CLI          │
│                  │ SSH                      │
└──────────────────┼──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│         AWS — SOCA CLUSTER                  │
│  ┌───────────────────────────────────────┐  │
│  │  SOCA TARGET NODE (EC2 Graviton arm64)│  │
│  │  ┌───────────────────────────────┐    │  │
│  │  │ Embedded Toolchain (AMI)      │    │  │
│  │  │  Zephyr SDK · West · QEMU     │    │  │
│  │  │  ┌─────────────────────────┐  │    │  │
│  │  │  │ Virtualized MCU (QEMU)  │  │    │  │
│  │  │  │ qemu-system-arm/aarch64 │  │    │  │
│  │  │  └─────────────────────────┘  │    │  │
│  │  └───────────────────────────────┘    │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
         ▲ AMI from CDK + EC2 Image Builder
```

---

# Key Components

| Layer | Component | Role |
|-------|-----------|------|
| **Workstation** | VSCode + Remote-SSH | Primary IDE, tunnels to EC2 |
| **Workstation** | Kiro CLI | Agentic AI — runs locally |
| **SOCA Node** | Zephyr RTOS + West | RTOS framework + meta-build tool |
| **SOCA Node** | Zephyr SDK | Cross-compilers: ARM & AArch64 |
| **SOCA Node** | QEMU | MCU emulator — no physical board needed |
| **SOCA Node** | Mosquitto | MQTT broker (pre-installed) |
| **AMI Pipeline** | CDK `ZephyrAmiStack` | Automates Image Builder pipeline |
| **AMI Pipeline** | EC2 Image Builder | Bakes toolchain into Ubuntu 24.04 arm64 AMI |

> **Key principle:** Developer's local machine needs **only VSCode and Kiro CLI** — no toolchain!

---

<!-- _class: section-header -->

# AMI Automation

### CDK + EC2 Image Builder

---

# ZephyrAmiStack — Project Layout

**One `cdk deploy` provisions everything AND triggers the AMI build.**

```
deployment/
├── bin/app.ts                           CDK app entry point (ZephyrAmiStack)
├── lib/zephyr-ami-stack.ts              Stack definition — all IB resources
└── assets/
    └── zephyr-toolchain-component.yaml  Image Builder component (build steps)
```

```bash
cd deployment
npm install
npx cdk bootstrap      # first time per account+region
npx cdk deploy         # provisions all resources + triggers AMI build
```

> `cdk deploy` completes in **~2–3 minutes**. The AMI build runs **asynchronously** (~45–60 min).

---

# ZephyrAmiStack — Provisioned Resources

| Resource | Details |
|----------|---------|
| **IAM Role** | `EC2InstanceProfileForImageBuilder` + `AmazonSSMManagedInstanceCore` |
| **IB Component** | `ZephyrToolchainComponent` v1.0.0 — executes all toolchain install steps |
| **Image Recipe** | `ZephyrToolchainRecipe` — Ubuntu 24.04 arm64 base + update-linux + component |
| **Infrastructure Config** | Build instance: `t4g.xlarge` (Graviton2) — terminates on failure |
| **Distribution Config** | Home region + `eu-west-1` + `us-west-2` (overridable via CDK context) |
| **Image Pipeline** | `ZephyrToolchainPipeline` — triggered on every `cdk deploy` |
| **Custom Resource** | `PipelineTrigger` — calls `startImagePipelineExecution` on CREATE & UPDATE |

**AMI properties:**

| Property | Value |
|----------|-------|
| Base OS | Ubuntu 24.04 LTS arm64 (Canonical SSM parameter — latest at build time) |
| AMI Name | `soca-zephyr-rtos-arm64-<buildDate>` |
| Root Volume | 100 GB gp3 |
| Architecture | `arm64` (Graviton-native — no emulation overhead) |

---

# ZephyrAmiStack — Operations

**Monitor build status** (output by `cdk deploy` as `CheckBuildStatusCommand`):
```bash
aws imagebuilder list-image-pipeline-images \
  --image-pipeline-arn <PipelineArn> \
  --query 'imageSummaryList[0].{State:state.status,AMI:outputResources.amis[0].image}' \
  --output table
# States: BUILDING → TESTING → DISTRIBUTING → AVAILABLE
```

**Get produced AMI ID:**
```bash
aws ec2 describe-images \
  --filters "Name=name,Values=soca-zephyr-rtos-arm64-*" \
            "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].{ID:ImageId,Name:Name,Date:CreationDate}' \
  --output table
```

**Distribute to additional regions:**
```bash
npx cdk deploy --context additionalRegions='["ap-northeast-1","eu-central-1"]'
```

**Tear down** *(produced AMIs are NOT deleted):*
```bash
npx cdk destroy   # removes Image Builder resources only
```

---

# What Gets Installed in the AMI

| Step | What Happens |
|------|-------------|
| `InstallAptDependencies` | CMake, Ninja, GPerf, DTC, Python3, QEMU, Mosquitto, socat, iproute2 |
| `VerifyMinimumVersions` | CMake ≥ 3.20.5, Python ≥ 3.12, dtc ≥ 1.4.6 |
| `CreateVenvAndInstallWest` | Python venv at `/opt/zephyrproject/.venv/` |
| `WestInit + WestUpdate` | Downloads Zephyr workspace + all HAL modules (~2 GB) |
| `InstallZephyrSDK` | `arm-zephyr-eabi` + `aarch64-zephyr-elf` toolchains |
| `SetPermissionsAndSmokeTest` | `chmod -R 755`; smoke-tests all key binaries |

**Toolchain locations:**

| Tool | Path |
|------|------|
| Zephyr workspace | `/opt/zephyrproject/` |
| Python venv | `/opt/zephyrproject/.venv/` |
| SDK ARM | `/opt/zephyr-sdk/arm-zephyr-eabi/` |
| SDK AArch64 | `/opt/zephyr-sdk/aarch64-zephyr-elf/` |

---

<!-- _class: section-header -->

# Agentic AI: Kiro CLI

### Four Integration Patterns

---

# Kiro CLI — AI Integration Patterns

| Pattern | Description | Example |
|---------|-------------|---------|
| **A — Reactive Troubleshooting** | Paste error → Kiro diagnoses root causes | `west: command not found` → venv bootstrap |
| **B — Config Auto-Patch** | Kiro modifies config files to persist fixes | `openocd-stm32` → `openocd` in `zephyr-ide.json` |
| **C — Agentic Shell Execution** | Kiro runs commands on remote node (with approval) | `west flash -r qemu` executed by Kiro |
| **D — Domain Knowledge Injection** | Steering files, Specs, Skills provide embedded context | Zephyr DeviceTree bindings, Kconfig reference |

> **Human-in-the-loop principle:** Kiro requests explicit approval before executing shell commands or modifying files.

```
Kiro: I will run the following command:
      west build --build-dir ~/build/qemu_cortex_m3 -t run
      Allow this action? [y/n/t]: t
```

---

<!-- _class: section-header -->

# Case 1: `qemu_cortex_m3`

### IoT Sensor Node Firmware (MQTT over SLIP)

---

# Case 1 — Board Profile

**Goal:** Validate the complete SoCA embedded SDLC pipeline on the simplest, fastest-booting QEMU target. Ideal for onboarding, CI/CD smoke tests, and Zephyr kernel exploration.

| Property | Value |
|----------|-------|
| **Board name** | `qemu_cortex_m3` |
| **Emulated platform** | TI LM3S6965 |
| **Architecture** | ARM Cortex-M3 |
| **System clock** | 12 MHz |
| **Serial** | Stellaris UART (UART0) |
| **QEMU Binary** | `qemu-system-arm` |
| **SDK Toolchain** | `arm-zephyr-eabi` |
| **EC2 Instance** | `t4g.large` (Graviton2, 2 vCPU / 8 GB) |

> SOCA Software Stack: **`Zephyr-RTOS-Dev-arm64`** — same single AMI as all cases

---

# Case 1 — Key Config (`prj.conf`)

```ini
# Network — SLIP/TAP for QEMU
CONFIG_NET_SLIP_TAP=y
CONFIG_SLIP=y
CONFIG_NET_IPV4=y
CONFIG_NET_TCP=y
CONFIG_NET_SOCKETS=y
CONFIG_NET_SOCKETS_POSIX_NAMES=y

# MQTT
CONFIG_MQTT_LIB=y
CONFIG_MQTT_KEEPALIVE=60

# IP addresses
CONFIG_NET_CONFIG_MY_IPV4_ADDR="192.0.2.1"   # QEMU guest
CONFIG_NET_CONFIG_PEER_IPV4_ADDR="192.0.2.2"  # Host broker (zeth)

# Disable conflicting built-in NIC
CONFIG_ETH_STELLARIS=n
```

> These settings wire the QEMU firmware's network stack to the host via a **SLIP/TAP virtual interface**.

---

# Case 1 — Step-by-Step Workflow (1/2)

**Step 1 · Request Target Node**
- SOCA portal → Software Stack: `Zephyr-RTOS-Dev-arm64` → Launch
- EC2 Graviton boots, User Data runs bootstrap (venv, TAP, Mosquitto)

**Step 2 · Connect & Clone**
```bash
# VSCode → Remote-SSH → <EC2_PRIVATE_IP>
git clone https://github.com/aws-samples/sample-sdlc-using-kiro-and-zephyr-on-edh.git
```
- venv already active via `.bashrc` — `west` on PATH immediately

**Step 3 · Agentic AI Online**
- Start `kiro` in terminal — use throughout for errors and code generation

**Step 4 · Build**
```bash
cd ~/zephyrproject/zephyr
west build -p -b qemu_cortex_m3 \
    ~/sample-sdlc-using-kiro-and-zephyr-on-edh/cases/mqtt_pub
```
> On error → paste to Kiro → AI diagnoses root cause in seconds (Pattern A)

---

# Case 1 — Step-by-Step Workflow (2/2)

**Step 5 · Set Up SLIP Networking** *(keep running in a second terminal)*
```bash
cd cases/mqtt_pub && ./setup-net.sh
# → builds tunslip6, brings up zeth TAP (192.0.2.2/24)
```
Verify: `ip addr show zeth` → `inet 192.0.2.2/24`

**Step 6 · Configure Mosquitto** *(one-time)*
```bash
sudo tee /etc/mosquitto/conf.d/local.conf << 'EOF'
listener 1883 0.0.0.0
allow_anonymous true
EOF
sudo systemctl restart mosquitto
```

**Step 7 · Run in QEMU**
```bash
sudo chmod 777 /tmp/slip.sock
west build -t run
```

**Step 8 · Verify MQTT Messages** *(third terminal)*
```bash
mosquitto_sub -t sensors
# → DOORS:OPEN_QoS0   DOORS:OPEN_QoS1   DOORS:OPEN_QoS2
```

---

# Case 1 — Expected Serial Output

```
*** Booting Zephyr OS build v4.3.x ***
[00:00:00.000,000] <inf> net_config: IPv4 address: 192.0.2.1
[00:00:00.000,000] <inf> net_mqtt_publisher_sample: attempting to connect:
[00:00:00.350,000] <inf> net_mqtt_publisher_sample: CONNECTED
[00:00:00.350,000] <inf> net_mqtt_publisher_sample: mqtt_publish: topic=sensors QoS=0
[00:00:00.352,000] <inf> net_mqtt_publisher_sample: PUBACK packet id: 1
[00:00:05.000,000] <inf> net_mqtt_publisher_sample: mqtt_publish: topic=sensors QoS=1
[00:00:05.002,000] <inf> net_mqtt_publisher_sample: PUBACK packet id: 2
```

**Mosquitto subscriber output:**
```
sensors DOORS:OPEN_QoS0
sensors DOORS:OPEN_QoS1
sensors DOORS:OPEN_QoS2
```

> All MQTT QoS levels (0, 1, 2) are exercised in this sample.

---

# Case 1 — Kiro AI Assistance in Action

**Real example from the source article:**

```
Input:  "west: command not found" + workspace trust error

Output: Two distinct root causes identified in ~7 seconds:
        1. VS Code workspace trust → manual trust instructions
        2. venv not created before west was called → venv bootstrap
```

**Useful Kiro prompts for Case 1:**
```
"west build fails with 'No Qemu ethernet driver configured' on qemu_cortex_m3"

"mqtt_connect returns -116 — how do I debug SLIP networking on QEMU?"

"How do I change the MQTT topic and payload in the mqtt_publisher sample?"

"Add a Zephyr sensor stub that publishes simulated temperature via MQTT"
```

> Pattern B: Kiro auto-patches `zephyr-ide.json` runner from `openocd-stm32` → `openocd`

---

# Case 1 — Iterate & Release

**Step 9 · Iterate**
- Edit `cases/mqtt_pub/src/main.c` or `prj.conf` in VSCode
- Rebuild: `west build -b qemu_cortex_m3 .../cases/mqtt_pub`
- Re-run: `west build -t run`
- Kiro assists with: Kconfig options, Zephyr API, topic/payload customization

**Extensions to try with Kiro:**
- Add a sensor stub publishing simulated temperature
- Implement MQTT retain flag for last-known sensor state
- Add TLS (`CONFIG_MQTT_LIB_TLS=y`) for secure comms
- Add MQTT Last Will & Testament for offline detection

**Step 10 · Release**
```bash
# Snapshot workspace → terminate node
aws s3 sync ~/zephyrproject s3://my-bucket/zephyr-workspace/
# → Terminate SOCA Target Node in portal
```

---

# Case 1 — Kiro Refactor: Uni → Bi-Directional MQTT

**One Kiro prompt turns a pure publisher into a command-controllable device.**

> *"Analyze `cases/mqtt_pub` and refactor towards bi-directional MQTT — subscribe to `cmd/output`; if `"json"` is received, republish the payload as JSON."*

**Kiro's analysis (17 s):**

| Finding | Detail |
|---------|--------|
| ❌ No `MQTT_EVT_PUBLISH` handler | `mqtt_evt_handler` only handles TX events (PUBACK, PUBREC…) |
| ❌ No subscription logic | No `mqtt_subscribe()` call anywhere |
| ✅ Minimal-change surface | 3 targeted edits — no architectural rewiring needed |

**Three targeted changes proposed:**

```
config.h  → #define CMD_TOPIC_OUTPUT  "cmd/output"        (new control topic)
main.c    → subscribe() helper        after publish()
main.c    → MQTT_EVT_PUBLISH case     reads cmd, re-publishes as JSON
main.c    → call subscribe()          right after try_to_connect()
```

---

# Case 1 — Bi-Directional MQTT: Key Code Additions

<div class="columns">

<div>

**`subscribe()` helper**
```c
static int subscribe(struct mqtt_client *client)
{
  struct mqtt_topic topics[] = {{
    .topic = { .utf8 = CMD_TOPIC_OUTPUT,
               .size = strlen(CMD_TOPIC_OUTPUT) },
    .qos  = MQTT_QOS_1_AT_LEAST_ONCE,
  }};
  const struct mqtt_subscription_list sub = {
    .list       = topics,
    .list_count = ARRAY_SIZE(topics),
    .message_id = sys_rand16_get(),
  };
  LOG_INF("Subscribing to %s", CMD_TOPIC_OUTPUT);
  return mqtt_subscribe(client, &sub);
}
```

</div>

<div>

**`MQTT_EVT_PUBLISH` handler (new case)**
```c
case MQTT_EVT_PUBLISH: {
  /* read incoming payload */
  mqtt_read_publish_payload(client, buf, len);
  /* QoS 1 ACK */
  if (qos == MQTT_QOS_1_AT_LEAST_ONCE)
    mqtt_publish_qos1_ack(client, &ack);

  /* "json" cmd → re-publish as JSON */
  if (strncmp(buf, "json", 4) == 0) {
    snprintk(json_payload, sizeof(json_payload),
      "{\"output\":\"%s\"}",
      get_mqtt_payload(MQTT_QOS_0_AT_MOST_ONCE));
    /* publish to sensors/json */
    mqtt_publish(client, &resp);
  }
  break;
}
```

</div>

</div>

---

# Case 1 — Bi-Directional MQTT: Flow & Verification

**End-to-end data flow after refactor:**

```
mosquitto_pub -t cmd/output -m "json"
        │
        ▼
  broker (Mosquitto on EC2)
        │  PUBLISH → cmd/output
        ▼
  QEMU firmware  ←── MQTT_EVT_PUBLISH fires
        │  reads "json" payload
        │  calls get_mqtt_payload()
        │  snprintk → {"output":"DOORS:OPEN_QoS0"}
        │  PUBLISH → sensors/json
        ▼
  broker
        │
        ▼
mosquitto_sub -t sensors/json
# ← {"output":"DOORS:OPEN_QoS0"}
```

**Verify in two terminals:**
```bash
# Terminal A — subscribe to JSON output
mosquitto_sub -t sensors/json

# Terminal B — send control command
mosquitto_pub -t cmd/output -m "json"
# → Terminal A shows: {"output":"DOORS:OPEN_QoS0"}
```

> Credits to Kiro: **0.19 tokens · 17 s** — full analysis + patch proposal for bi-directional MQTT

---

<!-- _class: section-header -->

# Developer Workflow

### End-to-End SDLC

---

# AI-Assisted Embedded SDLC — 9 Phases

| Phase | Action |
|-------|--------|
| **1 · Request** | Log into SOCA portal → request `Zephyr-RTOS-Dev-arm64` node |
| **2 · Connect** | VSCode Remote-SSH → EC2 node IP |
| **3 · Workspace Ready** | Toolchain pre-baked in AMI; venv activated via `.bashrc` |
| **4 · Agentic AI** | `kiro` in terminal → load Steering file with embedded context |
| **5 · Create Project** | Zephyr IDE → Create from Template → select board |
| **6 · Build** | `west build -b qemu_cortex_m3 ...` → paste errors to Kiro |
| **7 · Flash / Run** | `west build -t run` → firmware runs in QEMU on EC2 |
| **8 · Iterate** | Edit → Build → Run → Kiro assists with APIs, Kconfig, DeviceTree |
| **9 · Release** | Terminate node (cost control) → workspace backed up to S3/EFS |

---

# Physical vs SoCA Virtualized Setup

| Aspect | Physical Article Setup | SoCA Virtualized |
|--------|----------------------|------------------|
| Target Board | STM32 Nucleo-L433RC-P (real) | `qemu_cortex_m3` (QEMU) |
| Connection | USB cable + debug probe | No hardware required |
| Flash | `west flash -r openocd` | `west build -t run` |
| Serial Output | Serial via ST-Link VCP | QEMU stdio / PTY |
| Runner Issues | `openocd-stm32` compat. issues | No runner issues |
| Location | Developer's desk | AWS Graviton EC2 |
| Cost Model | CapEx (hardware) | Pay per active dev time |

---

<!-- _class: section-header -->

# Design Principles & Constraints

---

# Key Design Principles

| Principle | Description |
|-----------|-------------|
| ☁️ **Cloud-native embedded** | No local toolchain — SOCA node is the complete dev environment |
| 🏗️ **AMI-as-code** | Toolchain automation via CDK + Image Builder — reproducible, version-controlled |
| 🤝 **AI as agentic assistant** | Kiro proposes and executes; human confirms — always |
| 💾 **Persistent fixes** | AI patches config files (not just one-shot terminal commands) |
| ⚡ **SOCA elasticity** | Nodes spin up/down on demand — pay only for active dev time |
| 🦾 **Graviton-native** | arm64 AMI runs QEMU with native ARM execution — zero emulation overhead |
| 🎯 **Single AMI, all cases** | One `Zephyr-RTOS-Dev-arm64` stack covers all four QEMU cases |
| 📈 **Progressive enhancement** | Start with Kiro CLI; add Steering/Specs/Skills iteratively |
| 🔄 **Fail gracefully** | IDE→CLI fallback, runner fallback, manual override always possible |

---

# Known Constraints

| Constraint | Impact | Mitigation |
|------------|--------|------------|
| QEMU ≠ real silicon | Peripheral fidelity limited | Use for logic validation; real HW lab for peripherals |
| AMI build ~45–60 min | Not instant | `cdk deploy` auto-triggers; plan ahead |
| Kiro IDE ARM64 not supported | Full IDE unavailable on Graviton | VSCode + Kiro CLI is feature-equivalent fallback |
| `gcc-multilib` absent on arm64 | No 32-bit x86 host tools | Not needed; Zephyr SDK provides all cross-compilers |
| Kiro CLI needs internet | EC2 must reach Kiro endpoint | Ensure outbound HTTPS in Security Group |

---

<!-- _class: section-header -->

# Future Work

---

# Roadmap

| Item | Description |
|------|-------------|
| 🧠 **Kiro Domain Knowledge** | Zephyr Steering files: DeviceTree, Kconfig, HAL APIs, board definitions |
| 🔌 **Real HW Lab Passthrough** | OpenOCD server on HW lab instance; dev nodes connect over TCP |
| 🔗 **USB-over-IP** | Physical debug probes (J-Link, ST-Link) shared via `usbip` |
| 🔁 **CI/CD Integration** | SOCA job scheduler triggers `west build` + QEMU test on PRs |
| 📦 **Multi-target Stacks** | Separate stacks per MCU family (STM32, nRF52, ESP32) with pre-baked HALs |
| 🖥️ **Kiro IDE ARM64** | Migrate from VSCode+Kiro CLI to full Kiro IDE when ARM64 Linux supported |
| 📟 **Serial Console UI** | QEMU serial output in VSCode terminal panel via Zephyr IDE Extension |
| 💾 **Workspace Snapshots** | SOCA lifecycle hook to snapshot West workspace to S3 on termination |
| 🏷️ **AMI Versioning** | Tag Image Builder outputs with Zephyr SDK version |

---

<!-- _class: title -->

# Get Started

## `npx cdk deploy` → AMI ready in ~45–60 min

```bash
cd deployment
npm install
npx cdk bootstrap   # first time
npx cdk deploy      # triggers AMI build automatically
```

### References
- [DESIGN.md](./DESIGN.md) — Full architecture documentation
- [GUIDANCE.md](./GUIDANCE.md) — QEMU case implementation guides
- [Zephyr Getting Started](https://docs.zephyrproject.org/latest/develop/getting_started/index.html)
- [SoCA on AWS](https://aws.amazon.com/hpc/soca/)
