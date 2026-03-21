# AI-Assisted Embedded SDLC on AWS — SoCA Reference Architecture

> **Inspired by:** ["IoT Development with Kiro: Part 1 — STM32 on Zephyr"](https://dev.to/aws-builders/iot-development-with-kiro-part-1-stm32-on-zephyr-1jg9) by Akira Tateishi (AWS Community Builders, Feb 2026)

## 1. Overview & Motivation

Generative AI has dramatically accelerated web and cloud software development, yet hardware-close embedded/IoT development remains largely untouched by this revolution. The primary barriers are:

- **Toolchain complexity** — cross-compilers, RTOSes, SDKs, flash runners, debug probes
- **Architecture sensitivity** — binaries and tools are CPU-arch specific (x86_64 vs ARM64)
- **Physical hardware dependency** — development traditionally requires a physical board on a developer's desk
- **AI knowledge gap** — most AI coding assistants lack embedded/IoT domain knowledge out of the box

This reference architecture, **SoCA (Scale-Out Computing + AI for Embedded SDLC)**, addresses all four barriers:

1. **Virtualize the embedded target** — run MCU firmware on QEMU hosted on AWS EC2, managed by SOCA
2. **Standardize the toolchain** — pre-bake Zephyr SDK into SOCA Target Node AMIs via EC2 Image Builder (CDK-automated)
3. **AI co-pilot via Kiro CLI** — reactive error analysis, agentic shell execution, config auto-patching
4. **Elastic on-demand dev nodes** — SOCA spins up/down EC2 target nodes per developer request

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                     DEVELOPER WORKSTATION                            │
│                                                                      │
│   ┌─────────────────────┐     ┌──────────────────────────────────┐   │
│   │   VSCode            │     │        Kiro CLI                  │   │
│   │   (Remote-SSH ext.) │◄────►  (AI Co-Pilot / kiro-cli)        │   │
│   └──────────┬──────────┘     └──────────────────────────────────┘   │
│              │  SSH / VSCode Remote Development                      │
└──────────────┼───────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   AWS — SOCA CLUSTER                                 │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │              SOCA TARGET NODE (EC2 Instance)                 │   │
│   │              arm64 / Graviton — Ubuntu 24.04 LTS             │   │
│   │                                                              │   │
│   │  ┌─────────────────────────────────────────────────────────┐ │   │
│   │  │  Embedded Toolchain Layer  (pre-baked via Image Builder)│ │   │
│   │  │                                                         │ │   │
│   │  │  /opt/zephyrproject/   — West workspace + HAL modules   │ │   │
│   │  │  /opt/zephyrproject/.venv/   — West + Python deps       │ │   │
│   │  │  /opt/zephyr-sdk/            — SDK toolchains           │ │   │
│   │  │    arm-zephyr-eabi/          — Cortex-M3, R5, HVAC      │ │   │
│   │  │    aarch64-zephyr-elf/       — Cortex-A53 (AArch64)     │ │   │
│   │  │                                                         │ │   │
│   │  │  ┌──────────────┐  ┌───────────────┐  ┌─────────────┐   │ │   │
│   │  │  │ Zephyr RTOS  │  │  Zephyr IDE   │  │  West CLI   │   │ │   │
│   │  │  │ SDK + HALs   │  │  VSCode Ext.  │  │  (west)     │   │ │   │
│   │  │  └──────────────┘  └───────────────┘  └─────────────┘   │ │   │
│   │  │                                                         │ │   │
│   │  │  ┌──────────────────────────────────────────────────┐   │ │   │
│   │  │  │  Virtualized MCU Target                          │   │ │   │
│   │  │  │                                                  │   │ │   │
│   │  │  │   QEMU (qemu-system-arm / qemu-system-aarch64)   │   │ │   │
│   │  │  │   west build -t run  /  west flash -r qemu       │   │ │   │
│   │  │  │   Serial output via QEMU stdio / PTY pipe        │   │ │   │
│   │  │  └──────────────────────────────────────────────────┘   │ │   │
│   │  │                                                         │ │   │
│   │  │  ┌──────────────────────────────────────────────────┐   │ │   │
│   │  │  │  (Future) Real HW Passthrough                    │   │ │   │
│   │  │  │  OpenOCD over IP / USB-over-IP to HW Lab         │   │ │   │
│   │  │  └──────────────────────────────────────────────────┘   │ │   │
│   │  └─────────────────────────────────────────────────────────┘ │   │
│   └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   SOCA Management Plane:  Admin Portal · Software Stacks · Profiles  │
└──────────────────────────────────────────────────────────────────────┘
               ▲
               │  AMI produced by Image Builder pipeline
┌──────────────────────────────────────────────────────────────────────┐
│            AMI AUTOMATION  (CDK Stack — ZephyrAmiStack)              │
│                                                                      │
│  deployment/                                                         │
│  ├── bin/app.ts                — CDK app entry point                 │
│  ├── lib/zephyr-ami-stack.ts   — Image Builder pipeline definition   │
│  └── assets/                                                         │
│      └── zephyr-toolchain-component.yaml  — apt + west + SDK bake   │
│                                                                      │
│  npx cdk deploy  →  Image Builder pipeline starts automatically      │
│                      AMI ready in ~45-60 min                         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Descriptions

### 3.1 Developer Workstation Layer

| Component | Role |
|-----------|------|
| **VSCode** | Primary IDE, connects to SOCA target node via Remote-SSH extension |
| **Kiro CLI** (`kiro-cli`) | AI coding assistant — runs locally, interacts with remote workspace |
| **Remote-SSH Extension** | Tunnels VSCode UI to the remote EC2 node; full extension support server-side |

**Key principle:** The developer's local machine needs only VSCode and Kiro CLI installed. No Zephyr SDK, no cross-compiler, no QEMU — all toolchain resides on the SOCA node.

> **Note on Kiro IDE vs Kiro CLI:** Kiro IDE (full GUI) currently ships as x64-only. On ARM64 Linux environments, fall back to **VSCode + Kiro CLI** — both support ARM64 natively and Kiro CLI provides equivalent AI co-pilot capabilities.

---

### 3.2 AI Coding Assistant Layer (Kiro CLI)

Kiro CLI operates as an AI co-pilot within the VSCode terminal and chat interface. Four integration patterns are identified:

| Pattern | Description | Example from article |
|---------|-------------|----------------------|
| **A — Reactive Troubleshooting** | Developer pastes error message; Kiro identifies root causes and proposes fix commands | `west: command not found` → venv bootstrap instructions |
| **B — Config Auto-Patch** | Kiro directly modifies project config files to persist fixes | Patched `.vscode/zephyr-ide.json`: `openocd-stm32` → `openocd` |
| **C — Agentic Shell Execution** | Kiro runs shell commands directly on the remote node (with user approval) | `west flash -r openocd` executed by Kiro |
| **D — Domain Knowledge Injection** | Kiro **Steering** files, **Specs**, and **Skills** provide embedded/IoT domain context | (future — see §10) |

**Human-in-the-loop principle:** Kiro requests explicit approval before executing shell commands or modifying files. This is especially important in cloud environments where actions may have cost or availability implications.

---

### 3.3 SOCA Target Node Layer

SOCA (Scale-Out Computing on AWS) manages EC2 instances as on-demand **Target Nodes** — provisioned from curated **Software Stacks** (AMI + User Data + Profile). The AMI is produced by a **CDK-automated EC2 Image Builder pipeline** (§3.3.2).

#### 3.3.1 Software Stack Components

| Component | Purpose |
|-----------|---------|
| **AMI** | Pre-baked Ubuntu 24.04 arm64 image — Zephyr workspace, SDK, West, QEMU, Mosquitto |
| **User Data Template** | Jinja-based bootstrap script run at instance start; personalizes workspace per user |
| **Target Node Profile** | Defines allowed EC2 instance types, max storage, approved subnets |
| **Connection String** | SSH endpoint template shown to developer after node is ready |

#### 3.3.2 AMI Automation — CDK Stack (`ZephyrAmiStack`)

The AMI is **not built manually** — it is produced by an **EC2 Image Builder pipeline** defined in the CDK stack at `embedded-sdlc-using-zephyr-and-kiro-cli/deployment/`.

```
deployment/
├── bin/app.ts                          CDK app entry point (ZephyrAmiStack)
├── lib/zephyr-ami-stack.ts             Stack definition
└── assets/
    └── zephyr-toolchain-component.yaml EC2 Image Builder component (build steps)
```

**Stack resources provisioned by `cdk deploy`:**

| Resource | Details |
|----------|---------|
| IAM Role | `EC2InstanceProfileForImageBuilder` + `AmazonSSMManagedInstanceCore` |
| Image Builder Component | `ZephyrToolchainComponent` v1.0.0 — executes toolchain install steps |
| Image Recipe | `ZephyrToolchainRecipe` — Ubuntu 24.04 arm64 base + update-linux + toolchain component |
| Infrastructure Config | Build instance: `t4g.xlarge` (Graviton2), terminates on failure |
| Distribution Config | Home region + `eu-west-1` + `us-west-2` (overridable via CDK context) |
| Image Pipeline | `ZephyrToolchainPipeline` — triggered automatically on every `cdk deploy` |
| Custom Resource | `PipelineTrigger` — calls `startImagePipelineExecution` on CREATE and UPDATE |

**AMI properties:**

| Property | Value |
|----------|-------|
| Base OS | Ubuntu 24.04 LTS arm64 (Canonical SSM parameter — latest at build time) |
| Build instance | `t4g.xlarge` (Graviton2, 4 vCPU / 16 GB RAM) |
| Root volume | 100 GB gp3 |
| AMI name | `soca-zephyr-rtos-arm64-<buildDate>` |
| Build time | ~45–60 minutes |
| Architecture | `arm64` (Graviton-native — no emulation overhead) |

**Deploy commands:**

```bash
cd embedded-sdlc-using-zephyr-and-kiro-cli/deployment
npm install
npx cdk bootstrap   # first time per account+region
npx cdk deploy      # provisions resources AND triggers AMI build automatically
```

`cdk deploy` completes in ~2–3 minutes. The AMI build runs asynchronously.

**Monitor build status:**
```bash
# Output by cdk deploy as CheckBuildStatusCommand
aws imagebuilder list-image-pipeline-images \
  --image-pipeline-arn <PipelineArn> \
  --query 'imageSummaryList[0].{State:state.status,AMI:outputResources.amis[0].image}' \
  --output table
```
States: `BUILDING` → `TESTING` → `DISTRIBUTING` → `AVAILABLE`

**Distribute to additional regions** (via CDK context):
```bash
npx cdk deploy --context additionalRegions='["ap-northeast-1","eu-central-1"]'
```

**Re-trigger a fresh AMI build:**
```bash
npx cdk deploy   # always re-triggers via the Custom Resource timestamp pattern

# Or trigger without re-deploying:
aws imagebuilder start-image-pipeline-execution --image-pipeline-arn <PipelineArn>
```

**Tear down** (removes Image Builder resources; produced AMIs are NOT deleted):
```bash
npx cdk destroy
```

#### 3.3.3 Toolchain Component — What Gets Installed

The Image Builder component (`assets/zephyr-toolchain-component.yaml`) executes these steps on the build instance:

| Step | What Happens |
|------|-------------|
| `InstallAptDependencies` | `apt-get install` — CMake, Ninja, GPerf, DTC, Python3, QEMU, Mosquitto, socat, iproute2. **Note:** `gcc-multilib`/`g++-multilib` intentionally omitted — not available on AArch64. |
| `VerifyMinimumVersions` | Sanity-check: CMake ≥ 3.20.5, Python ≥ 3.12, dtc ≥ 1.4.6 |
| `CreateVenvAndInstallWest` | Python venv at `/opt/zephyrproject/.venv/`; installs `west` |
| `WestInit` | `west init /opt/zephyrproject` — downloads Zephyr manifest |
| `WestUpdate` | `west update` — downloads all HAL modules, MCUboot, CMSIS (~2 GB) |
| `ZephyrExport` | `west zephyr-export` — registers Zephyr CMake package |
| `InstallPythonDependencies` | `west packages pip --install` — official method for Zephyr Python deps |
| `InstallZephyrSDK` | `west sdk install --install-dir /opt/zephyr-sdk -t arm-zephyr-eabi -t aarch64-zephyr-elf` |
| `SetPermissionsAndSmokeTest` | `chmod -R 755` on toolchain dirs; smoke-tests all key binaries |

**Installed toolchain locations:**

| Tool | Location | Covers |
|------|----------|--------|
| Zephyr workspace | `/opt/zephyrproject/` | West workspace (zephyr + all HAL modules) |
| Python venv | `/opt/zephyrproject/.venv/` | West + Zephyr Python deps |
| Zephyr SDK — ARM | `/opt/zephyr-sdk/arm-zephyr-eabi/` | Cases 1, 2, 4 (Cortex-M3, R5, HVAC) |
| Zephyr SDK — AArch64 | `/opt/zephyr-sdk/aarch64-zephyr-elf/` | Case 3 (Cortex-A53 / AArch64) |
| QEMU | system (`/usr/bin/`) | `qemu-system-arm`, `qemu-system-aarch64` (via `qemu-system-misc`) |
| Mosquitto | system | MQTT broker (HVAC Case 4; available in all nodes) |
| socat / iproute2 | system | SLIP networking for QEMU MQTT case |

**Single AMI covers all four PLAN.md QEMU cases** — no separate AMI per case required.

#### 3.3.4 User Data Template (Jinja)

The User Data **only** handles per-user workspace personalisation (run at node boot). The full toolchain is already present from the AMI.

```bash
#!/bin/bash
# SOCA User Data Template — Zephyr Workspace Bootstrap
# Available variables: {{ SOCA_USER }}, {{ SOCA_NODE_INSTANCE_ARCH }}

ZEPHYR_WORKSPACE="/home/{{ SOCA_USER }}/zephyr"
OPT_WORKSPACE="/opt/zephyrproject"
VENV="${OPT_WORKSPACE}/.venv"

# 1. Create per-user symlink / working copy so each developer has their own project space
mkdir -p "${ZEPHYR_WORKSPACE}"
ln -sfn "${OPT_WORKSPACE}/zephyr"   "${ZEPHYR_WORKSPACE}/zephyr"
ln -sfn "${OPT_WORKSPACE}/.venv"    "${ZEPHYR_WORKSPACE}/.venv"

# 2. Add venv activation to user's shell profile
echo "source ${VENV}/bin/activate" >> /home/{{ SOCA_USER }}/.bashrc
echo "export ZEPHYR_BASE=${OPT_WORKSPACE}/zephyr" >> /home/{{ SOCA_USER }}/.bashrc

# 3. Pre-trust workspace for VSCode Remote (avoids trust dialog blocking IDE tasks)
mkdir -p "/home/{{ SOCA_USER }}/.config/Code/User"
cat > "/home/{{ SOCA_USER }}/.config/Code/User/globalStorage_workspaceTrust.json" << 'EOF'
{"machineTrustedFolders": ["/home/{{ SOCA_USER }}/zephyr", "/opt/zephyrproject"]}
EOF

# 4. HVAC/SLIP networking — TAP interface for QEMU MQTT (Case 4)
ip tuntap add dev slip0 mode tap user {{ SOCA_USER }} 2>/dev/null || true
ip addr add 192.168.1.1/24 dev slip0 2>/dev/null || true
ip link set slip0 up 2>/dev/null || true

# 5. Start Mosquitto broker (pre-installed in AMI)
systemctl enable mosquitto
systemctl start mosquitto

chown -R {{ SOCA_USER }}:{{ SOCA_USER }} "${ZEPHYR_WORKSPACE}"
```

#### 3.3.5 Connection String Template

```html
<strong>SSH:</strong> ssh {{ SOCA_USER }}@{{ SOCA_NODE_INSTANCE_PRIVATE_IP }}<br>
<strong>Instance:</strong> {{ SOCA_NODE_INSTANCE_ID }} ({{ SOCA_NODE_INSTANCE_TYPE }} / {{ SOCA_NODE_INSTANCE_ARCH }})<br>
<strong>VSCode Remote:</strong> Open VSCode → Remote-SSH → {{ SOCA_NODE_INSTANCE_PRIVATE_IP }}<br>
<strong>Toolchain:</strong> source /opt/zephyrproject/.venv/bin/activate
```

---

### 3.4 Embedded Toolchain Layer (on EC2)

| Tool | Role |
|------|------|
| **Zephyr RTOS** | Real-time OS framework for embedded targets |
| **West** | Zephyr's meta-tool: workspace init, build, flash, debug, SDK install |
| **Zephyr SDK** | Cross-compiler toolchains (`arm-zephyr-eabi-gcc`, `aarch64-zephyr-elf-gcc`) |
| **Zephyr IDE VSCode Extension** | GUI over West: workspace mgmt, build configs, runner configs |
| **CMake + Ninja** | Build system |
| **QEMU** | MCU emulator — `qemu-system-arm` (M3/R5) + `qemu-system-aarch64` (A53) |
| **Mosquitto** | MQTT broker — pre-installed for HVAC IoT scenario (Case 4) |
| **socat / iproute2** | SLIP/TAP virtual networking for QEMU MQTT connectivity |
| **OpenOCD** | On-chip debugger — for real hardware (future) |

All tools installed at **AMI build time** by the `ZephyrToolchainComponent`. SDK installation uses the modern `west sdk install` command (not the legacy `setup.sh` script).

---

### 3.5 Virtualized MCU Target (QEMU)

Instead of a physical development board, firmware runs inside **QEMU** on the EC2 node:

| Physical Article Setup | SoCA Virtualized Setup |
|------------------------|------------------------|
| STM32 Nucleo-L433RC-P (real board) | `qemu_cortex_m3` or `qemu_cortex_a53` (QEMU) |
| USB cable + debug probe | No hardware required |
| `west flash -r openocd` (OpenOCD to board) | `west build -t run` (QEMU inline) |
| Serial via ST-Link VCP | Serial via QEMU stdio / PTY |
| `openocd-stm32` runner issue | No runner compatibility issues |

```bash
# Activate toolchain venv first
source /opt/zephyrproject/.venv/bin/activate

# Build and run in QEMU (no physical board needed)
cd /opt/zephyrproject
west build -b qemu_cortex_m3 zephyr/samples/hello_world
west build -t run

# Or explicitly with runner
west flash -r qemu
```

QEMU output (e.g. `printk` / serial) appears directly in the terminal — no serial monitor tool needed.

---

## 4. SOCA Software Stack Registration

### Obtain the AMI ID

After `cdk deploy` and pipeline completion (~45–60 min):

```bash
aws ec2 describe-images \
  --filters "Name=name,Values=soca-zephyr-rtos-arm64-*" \
            "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].{ID:ImageId,Name:Name,Date:CreationDate}' \
  --output table
```

### Register in SOCA Admin Portal

1. **Register Software Stack** — `Admin > Software Stacks > Target Node`:
   - **AMI ID:** `ami-xxxxxxxxxxxxxxxxx` (from above)
   - **Name:** `Zephyr-RTOS-Dev-arm64`
   - **Min Disk:** 30 GB (SOCA adds a separate data volume; AMI root is 100 GB gp3)
   - **Profile:** attach a profile with Graviton instance types (e.g. `m6g.large`, `t4g.large`, `t4g.xlarge`)
   - **User Data:** attach the Jinja bootstrap template from §3.3.4
   - **Connection String:** §3.3.5 template

> **Single stack covers all four QEMU cases** — the AMI pre-bakes both `arm-zephyr-eabi` (Cases 1, 2, 4) and `aarch64-zephyr-elf` (Case 3) toolchains.

### SOCA Variables Available in User Data

| Variable | Value |
|----------|-------|
| `{{ SOCA_USER }}` | Requesting user's username |
| `{{ SOCA_USER_PUBLIC_KEYS }}` | User's SSH public keys |
| `{{ SOCA_NODE_INSTANCE_ARCH }}` | `aarch64` (Graviton) |
| `{{ SOCA_NODE_INSTANCE_TYPE }}` | e.g. `t4g.large` |
| `{{ AWS_REGION }}` | e.g. `eu-central-1` |

---

## 5. Embedded SDLC Workflow (AI-Assisted)

```
Phase 1: REQUEST
  Developer logs into SOCA portal
  → Requests "Zephyr-RTOS-Dev-arm64" Target Node
  → SOCA provisions Graviton EC2, runs User Data bootstrap
  → Node ready: connection string displayed

Phase 2: CONNECT
  Developer opens VSCode
  → Remote-SSH to EC2 node IP
  → VSCode Server installs server-side extensions (Zephyr IDE, etc.)
  → Kiro CLI activated in integrated terminal

Phase 3: WORKSPACE READY (pre-baked in AMI, personalised by User Data)
  ✓ Python venv: /opt/zephyrproject/.venv/ (activate via .bashrc)
  ✓ West installed and on PATH in venv
  ✓ Zephyr workspace: /opt/zephyrproject/
  ✓ Zephyr SDK: /opt/zephyrproject/.venv/ → west sdk install
  ✓ QEMU (arm + aarch64) available system-wide
  ✓ Mosquitto broker running (systemd service)
  ✓ SLIP/TAP interface configured (for MQTT Case 4)
  ✓ VS Code workspace trusted
  → Zephyr IDE Extension: verify status (Host Tools: Installed, SDK: Installed)

Phase 4: AI CO-PILOT ONLINE
  Developer opens Kiro CLI chat
  → Optional: load Steering file with embedded domain context
  → Kiro ready for reactive troubleshooting and agentic execution

Phase 5: PROJECT CREATION
  Zephyr IDE → PROJECTS → Create from Template
  → Select sample (e.g. Blinky, Hello World)
  → Board: qemu_cortex_m3 (or target-specific board)
  → Build config: Debug

Phase 6: BUILD
  source /opt/zephyrproject/.venv/bin/activate
  cd /opt/zephyrproject
  west build -b qemu_cortex_m3 zephyr/samples/hello_world
  → If errors: paste to Kiro → AI diagnoses and fixes

Phase 7: FLASH / RUN (QEMU)
  west build -t run   (or: west flash -r qemu)
  → Firmware executes in QEMU on EC2 Graviton node
  → Serial output in terminal
  → If runner issues: Kiro recommends correct runner, patches zephyr-ide.json

Phase 8: ITERATE
  Edit source → Build → Run → Observe output
  → Kiro assists with code, Zephyr APIs, Kconfig, DeviceTree
  → All changes persist on EC2 EBS volume

Phase 9: RELEASE
  SOCA node terminated (cost control)
  → Workspace backed up to S3 / EFS (SOCA shared storage)
  → AMI snapshot already available for reproducibility (Image Builder)
```

---

## 6. AI Integration Patterns (Detail)

### Pattern A — Reactive Troubleshooting

```
Developer encounters error
        │
        ▼
Copy error message → Kiro CLI chat
        │
        ▼
Kiro analyzes: identifies root causes, numbered list
        │
        ▼
Kiro proposes fix commands / config changes
        │
        ▼
Developer reviews → approves → Kiro executes (Pattern C)
        │
        ▼
Problem resolved, fix documented in chat history
```

**Real example from article:**
```
Input:  "west: command not found" + workspace trust error
Output: Two distinct root causes identified in ~7s
        1. VS Code workspace trust → manual trust instructions
        2. venv not created before west was called → venv bootstrap commands
```

### Pattern B — Config Auto-Patch

Kiro reads project config files, proposes targeted diffs, and writes changes with user approval. This ensures fixes are **persistent** across sessions (not just one-shot terminal commands).

```bash
# Example: Kiro patches .vscode/zephyr-ide.json
# Before: "runner": "openocd-stm32"  (unsupported on this board)
# After:  "runner": "openocd"        (standard, supported)
```

### Pattern C — Agentic Shell Execution

Kiro can execute shell commands directly on the remote node. Each execution requires explicit user approval (`y/n/t` — trust for session).

```
Kiro: I will run the following command:
      west build --build-dir ~/build/qemu_cortex_m3 -t run
      Purpose: Flash firmware to QEMU emulator
      Allow this action? [y/n/t]: t
```

### Pattern D — Domain Knowledge Injection (Steering / Specs / Skills)

Kiro's behavior can be augmented with hardware/embedded domain knowledge via:

| Mechanism | Use Case |
|-----------|----------|
| **Steering files** (`.kiro/steering/`) | Always-on context: board pinouts, HAL APIs, project conventions |
| **Specs** | Task-scoped requirements: "implement UART driver for STM32L4" |
| **Skills** | Reusable procedures: "flash to QEMU", "add Zephyr Kconfig option" |
| **Powers** | Custom tool integrations: OpenOCD wrapper, west build hooks |

---

## 7. Fallback & Decision Patterns

### 7.1 IDE vs CLI Fallback

```
Target IDE: Kiro IDE (full GUI)
      │
      ▼ Supported? (x86_64 Linux / macOS / Windows x64)
     YES → Use Kiro IDE
      │
      NO (e.g. ARM64 Linux — Graviton SOCA nodes)
      ▼
Fallback: VSCode + Kiro CLI
      │ Both support ARM64 Linux natively
      ▼
Seamless migration path → Kiro IDE when ARM64 support added
```

### 7.2 EC2 Architecture — Graviton-Native

The `ZephyrAmiStack` produces an **arm64 AMI** built on a Graviton2 (`t4g.xlarge`) instance. SOCA Target Nodes should use Graviton instance types for best performance:

```
Recommended Graviton instance types for SOCA Profile:
  t4g.large    — 2 vCPU /  8 GB  — Cases 1, 2, 4 (Cortex-M3 / R5 / HVAC)
  t4g.xlarge   — 4 vCPU / 16 GB  — Case 3 (Cortex-A53 / AArch64 / SMP)
  m6g.large    — 2 vCPU /  8 GB  — standard dev workload
  m6g.xlarge   — 4 vCPU / 16 GB  — heavier build workloads

QEMU on Graviton:
  qemu-system-arm     → native ARM instruction execution (low overhead)
  qemu-system-aarch64 → native AArch64 execution (zero emulation penalty)
```

> x86_64 instances can also use this AMI but would require a different base image.
> The CDK stack targets arm64 exclusively.

### 7.3 Flash Runner Selection

```
west flash -r <runner>
      │
      ├── Physical board present? → openocd / jlink / stm32cubeprogrammer
      │         (future: USB-over-IP or OpenOCD-over-network to HW lab)
      │
      └── QEMU (default in SoCA — all four PLAN.md cases)
            ├── west build -t run      (inline, simplest)
            ├── west flash -r qemu     (explicit runner)
            └── Board must support QEMU: qemu_cortex_m3, qemu_cortex_r5,
                qemu_cortex_a53, qemu_riscv32, qemu_x86, etc.
```

### 7.4 Workspace Trust (Pre-resolved by User Data)

The original article encountered:
```
Cannot launch a terminal process in an untrusted workspace
```
In SoCA, this is **pre-resolved** in the User Data bootstrap by writing both `/home/{{ SOCA_USER }}/zephyr` and `/opt/zephyrproject` into VSCode's global trust config before the developer first connects.

---

## 8. Key Design Principles

| Principle | Description |
|-----------|-------------|
| **Cloud-native embedded** | No local toolchain required; SOCA node is the complete dev environment |
| **AMI-as-code** | Toolchain pre-bake is fully automated via CDK + EC2 Image Builder — reproducible, version-controlled |
| **AI as co-pilot, not autopilot** | Kiro proposes and executes; human confirms — especially for file writes and shell commands |
| **Persistent fixes** | AI patches config files (not just one-shot terminal commands) ensuring reproducibility |
| **SOCA elasticity** | Nodes spin up/down on demand; pay only for active development time |
| **Graviton-native** | arm64 AMI runs QEMU with native ARM execution — no emulation overhead on Graviton |
| **Single AMI, all cases** | One `Zephyr-RTOS-Dev-arm64` stack covers all four QEMU cases (both SDK toolchains pre-baked) |
| **Progressive enhancement** | Start with vanilla Kiro CLI; add Steering/Specs/Skills iteratively |
| **Fail gracefully** | IDE→CLI fallback, runner fallback, manual override always possible |

---

## 9. Known Constraints

| Constraint | Impact | Mitigation |
|------------|--------|------------|
| QEMU ≠ real silicon | Peripheral fidelity limited (no real ADC, SPI, I2C devices) | Use for firmware logic validation; real HW lab for peripheral testing |
| AMI build time ~45–60 min | Not instant — plan AMI builds ahead of developer onboarding | `cdk deploy` triggers build automatically; `cdk destroy` does NOT delete produced AMIs |
| AMI root volume 100 GB gp3 | Per-node EBS cost | SOCA can add smaller data volumes separately; root covers full toolchain |
| `gcc-multilib`/`g++-multilib` absent | Cannot build 32-bit x86 host tools on arm64 | Not needed for Zephyr cross-compilation; Zephyr SDK provides all needed compilers |
| Kiro CLI needs internet | EC2 node must reach Kiro service endpoint | Ensure outbound HTTPS in Security Group; consider VPC endpoint if required |
| ARM64 Kiro IDE not yet supported | Full IDE unavailable on Graviton nodes | VSCode + Kiro CLI is the supported fallback (feature-equivalent for AI assistance) |
| QEMU boot time | Some QEMU board targets are slow to start | Use `qemu_cortex_m3` / `qemu_cortex_r5` (fast boot); avoid full SoC emulation |
| Image Builder distribution | Default: home region + `eu-west-1` + `us-west-2` | Override via `--context additionalRegions='[...]'` at `cdk deploy` time |

---

## 10. Future Work

| Item | Description |
|------|-------------|
| **Kiro domain knowledge** | Zephyr-specific Steering files: DeviceTree bindings, Kconfig reference, HAL APIs, board definitions |
| **Real HW lab passthrough** | OpenOCD server on dedicated HW lab instance; EC2 dev nodes connect over TCP |
| **USB-over-IP** | Physical debug probes (J-Link, ST-Link) shared via `usbip` to multiple dev nodes |
| **CI/CD integration** | SOCA job scheduler triggers automated `west build` + QEMU test run on PRs |
| **Multi-target Software Stacks** | Separate SOCA stacks per MCU family (STM32, nRF52, ESP32) with pre-baked HALs |
| **Kiro IDE ARM64 support** | Migrate from VSCode+Kiro CLI to full Kiro IDE when ARM64 Linux support is released |
| **Serial console UI** | Integrate QEMU serial output into VSCode terminal panel via Zephyr IDE Extension |
| **Automated workspace snapshots** | SOCA lifecycle hook to snapshot West workspace to S3 on node termination |
| **AMI versioning** | Tag Image Builder outputs with Zephyr SDK version; SOCA stack per SDK version |

---

*Last updated: March 2026 | References: [PLAN.md](./PLAN.md) · [deployment/README.md](./embedded-sdlc-using-zephyr-and-kiro-cli/deployment/README.md) · [Zephyr Getting Started](https://docs.zephyrproject.org/latest/develop/getting_started/index.html)*
