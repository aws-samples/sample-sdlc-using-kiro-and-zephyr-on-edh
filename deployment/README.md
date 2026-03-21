# Zephyr RTOS AMI Builder — CDK Stack

Builds a ready-to-use **SOCA Target Node AMI** with the full Embedded Toolchain Layer
pre-baked: Zephyr RTOS workspace, SDK (ARM + AArch64), QEMU, West, Mosquitto.

- **Base image:** Ubuntu 24.04 LTS arm64
- **Build instance:** `t4g.xlarge` (Graviton2)
- **Root volume:** 100 GB gp3
- **AMI name:** `soca-zephyr-rtos-arm64-<buildDate>`

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18 | `brew install node` |
| AWS CDK | ≥ 2.178 | included via `npm install` |
| AWS CLI | ≥ 2 | `brew install awscli` |
| AWS credentials | with IAM + ImageBuilder permissions | `aws configure` or SSO |

---

## Deploy

```bash
# 1. Enter the deployment directory
cd embedded-sdlc-using-zephyr-and-kiro-cli/deployment

# 2. Install dependencies (first time only)
npm install

# 3. Bootstrap CDK in your account/region (first time only, per account+region)
npx cdk bootstrap

# 4. Deploy — this provisions all resources AND automatically starts the AMI build
npx cdk deploy

# Use a specific AWS profile:
npx cdk deploy --profile <your-profile>
```

`cdk deploy` completes in **~2-3 minutes**. The AMI build itself runs asynchronously
in EC2 Image Builder and takes **~45-60 minutes**.

---

## Monitor the AMI build

```bash
# Check current build status and AMI ID (once available)
aws imagebuilder list-image-pipeline-images \
  --image-pipeline-arn <PipelineArn from cdk deploy output> \
  --query 'imageSummaryList[0].{State:state.status,AMI:outputResources.amis[0].image}' \
  --output table

# Or watch in the AWS Console:
# EC2 → Image Builder → Image pipelines → ZephyrToolchainPipeline
```

States you'll see: `BUILDING` → `TESTING` → `DISTRIBUTING` → `AVAILABLE`

---

## Use the AMI in SOCA

Once the pipeline shows `AVAILABLE`, grab the AMI ID:

```bash
aws ec2 describe-images \
  --filters "Name=name,Values=soca-zephyr-rtos-arm64-*" \
            "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].{ID:ImageId,Name:Name,Date:CreationDate}' \
  --output table
```

Then register it as a **SOCA Software Stack**:
1. SOCA Admin Portal → **Software Stacks** → **Target Node** → Create
2. AMI ID: `ami-xxxxxxxxxxxxxxxxx` (from above)
3. Name: `Zephyr-RTOS-Dev-arm64`
4. Min Disk: 30 GB (SOCA will add a separate data volume)
5. Profile: attach a profile with `m6g.large` / `t4g.large` instance types
6. User Data: attach the Jinja bootstrap template from `DESIGN.md §3.3.3`

---

## Re-trigger a fresh AMI build

```bash
# Re-deploy (triggers a new build automatically)
npx cdk deploy

# Or trigger manually without re-deploying:
aws imagebuilder start-image-pipeline-execution \
  --image-pipeline-arn <PipelineArn from cdk deploy output>
```

---

## Tear down

```bash
# Removes all Image Builder resources (pipeline, recipe, component, IAM role).
# Does NOT delete AMIs already produced — delete those manually in EC2 > AMIs.
npx cdk destroy
```

---

## What's installed in the AMI

| Tool | Location | Purpose |
|------|----------|---------|
| Zephyr workspace | `/opt/zephyrproject/` | West workspace (zephyr + all HAL modules) |
| Python venv | `/opt/zephyrproject/.venv/` | West + Zephyr Python deps |
| Zephyr SDK | `/opt/zephyr-sdk/` | `arm-zephyr-eabi` + `aarch64-zephyr-elf` toolchains |
| QEMU | system packages | `qemu-system-arm`, `qemu-system-aarch64` |
| Mosquitto | system packages | MQTT broker for HVAC Case 4 |
| socat / iproute2 | system packages | SLIP networking for QEMU |

Covers all four PLAN.md QEMU cases:
- **Case 1/4** `qemu_cortex_m3` — `arm-zephyr-eabi`
- **Case 2** `qemu_cortex_r5` — `arm-zephyr-eabi`
- **Case 3** `qemu_cortex_a53` — `aarch64-zephyr-elf`
