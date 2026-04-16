# embedded-sdlc-using-zephyr-and-kiro-cli

AI-assisted embedded software development on AWS using **Zephyr RTOS**, **Kiro CLI**, and **EDH ([Engineering Development Hub](https://awslabs.github.io/engineering-development-hub-documentation/))**. Firmware runs on QEMU-emulated MCU targets (Cortex-M3, R5, A53) on Graviton EC2 nodes — no physical hardware required.


---

## What's in this repo

```
sample-sdlc-using-kiro-and-zephyr-on-edh/
└── deployment/                   CDK stack — automates EDH Target Node AMI builds
    ├── bin/app.ts                 CDK app entry point (ZephyrAmiStack)
    ├── lib/zephyr-ami-stack.ts    EC2 Image Builder pipeline definition
    ├── assets/
    │   └── zephyr-toolchain-component.yaml   Image Builder component — installs the full
    │                                          Embedded Toolchain Layer on Ubuntu 24.04 arm64:
    │                                          apt deps · west init/update · Zephyr SDK
    │                                          (arm-zephyr-eabi + aarch64-zephyr-elf) · QEMU
    │                                          Mosquitto · socat · iproute2
    ├── cdk.json
    ├── package.json
    ├── tsconfig.json
    └── README.md                  Deploy instructions
```

## What the CDK stack does

`npx cdk deploy` provisions an **EC2 Image Builder pipeline** (`ZephyrToolchainPipeline`) and auto-triggers a build. After ~45–60 minutes the pipeline produces a ready-to-use EDH Target Node AMI:

| Property | Value |
|----------|-------|
| AMI name | `soca-zephyr-rtos-arm64-<buildDate>` |
| Base OS | Ubuntu 24.04 LTS arm64 |
| Build instance | `t4g.xlarge` (Graviton2) |
| Root volume | 100 GB gp3 |
| Toolchain | `/opt/zephyrproject/` + `/opt/zephyr-sdk/` |
| Distribution | Home region + `eu-west-1` + `us-west-2` (overridable) |

The single AMI covers all four QEMU development cases defined in `PLAN.md` — both `arm-zephyr-eabi` (Cortex-M3/R5/HVAC) and `aarch64-zephyr-elf` (Cortex-A53) toolchains are pre-baked.

## Quick start

```bash
cd deployment
npm install
npx cdk bootstrap   # first time per account+region
npx cdk deploy      # provisions Image Builder pipeline and triggers AMI build
```

See [`deployment/README.md`](./deployment/README.md) for monitoring, re-triggering, and EDH registration steps.
