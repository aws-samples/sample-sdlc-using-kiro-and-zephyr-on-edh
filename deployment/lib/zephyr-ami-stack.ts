import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as imagebuilder from 'aws-cdk-lib/aws-imagebuilder';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ZephyrAmiStack
 *
 * Builds a ready-to-use SOCA Target Node AMI containing the full
 * "Embedded Toolchain Layer" described in DESIGN.md §3.4:
 *
 *   - Ubuntu 24.04 LTS arm64  (Graviton-native)
 *   - Zephyr RTOS workspace   (/opt/zephyrproject)
 *   - Zephyr SDK              (/opt/zephyr-sdk)
 *     · arm-zephyr-eabi       → Cases 1, 2, 4 (Cortex-M3, R5, HVAC)
 *     · aarch64-zephyr-elf    → Case 3 (Cortex-A53 / AArch64)
 *   - QEMU (arm + aarch64)
 *   - West CLI, CMake, Ninja, Python venv
 *   - Mosquitto, socat, iproute2   (HVAC Case 4 extras)
 *
 * On `cdk deploy` the Image Builder pipeline is triggered automatically
 * via an AwsCustomResource. The AMI appears in EC2 > AMIs ~45-60 min later.
 *
 * References:
 *   DESIGN.md §3.3.2 and §3.4
 *   PLAN.md — SOCA Software Stack Matrix
 *   https://docs.zephyrproject.org/latest/develop/getting_started/index.html
 */
export class ZephyrAmiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── 1. IAM Role for the Image Builder EC2 build instance ────────────────
    const imageBuilderRole = new iam.Role(this, 'ImageBuilderRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        // Required: lets the build instance pull from S3, publish logs, etc.
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'EC2InstanceProfileForImageBuilder',
        ),
        // Required: SSM agent (Image Builder communicates via SSM)
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonSSMManagedInstanceCore',
        ),
      ],
      description:
        'EC2 Image Builder build instance role - Zephyr RTOS AMI (arm64/Graviton)',
    });

    const instanceProfile = new iam.CfnInstanceProfile(
      this,
      'ImageBuilderInstanceProfile',
      {
        roles: [imageBuilderRole.roleName],
        instanceProfileName: 'ZephyrImageBuilderInstanceProfile',
      },
    );

    // ─── 2. Image Builder Component — Zephyr Toolchain ───────────────────────
    // Read the YAML component document from assets/ at CDK synth time.
    const componentData = fs.readFileSync(
      path.join(__dirname, '..', 'assets', 'zephyr-toolchain-component.yaml'),
      'utf8',
    );

    const toolchainComponent = new imagebuilder.CfnComponent(
      this,
      'ZephyrToolchainComponent',
      {
        name: 'ZephyrToolchain',
        version: '1.0.0',
        platform: 'Linux',
        description:
          'Full Zephyr RTOS Embedded Toolchain Layer - Ubuntu 24.04 arm64',
        data: componentData,
      },
    );

    // ─── 3. Image Recipe ─────────────────────────────────────────────────────
    // Base image: Ubuntu 24.04 LTS arm64 via Canonical SSM parameter.
    // The SSM parameter resolves at deploy time to the latest AMI ID.
    const recipe = new imagebuilder.CfnImageRecipe(this, 'ZephyrImageRecipe', {
      name: 'ZephyrToolchainRecipe',
      version: '1.0.0',
      // Canonical's SSM path for Ubuntu 24.04 arm64 hvm/ebs-gp3
      parentImage: `arn:aws:imagebuilder:${this.region}:aws:image/ubuntu-server-24-lts-arm64/x.x.x`,
      components: [
        // AWS-managed: runs apt-get update/upgrade before our component
        {
          componentArn: `arn:aws:imagebuilder:${this.region}:aws:component/update-linux/x.x.x`,
        },
        {
          componentArn: toolchainComponent.attrArn,
        },
      ],
      blockDeviceMappings: [
        {
          deviceName: '/dev/sda1',
          ebs: {
            volumeSize: 100, // 100 GB — accommodates Zephyr workspace + SDK + build artefacts
            volumeType: 'gp3',
            deleteOnTermination: true,
          },
        },
      ],
      description:
        'Zephyr RTOS dev AMI - Ubuntu 24.04 arm64 (Graviton). ' +
        'Pre-baked: Zephyr SDK, West, QEMU, Mosquitto. ' +
        'Ready for SOCA Target Node registration.',
    });

    recipe.addDependency(toolchainComponent);

    // ─── 4. Infrastructure Configuration ─────────────────────────────────────
    // t4g.xlarge: Graviton2 arm64, 4 vCPU / 16 GB RAM.
    // Needed RAM for `west update` (~2 GB modules) and SDK extraction.
    const infraConfig = new imagebuilder.CfnInfrastructureConfiguration(
      this,
      'ZephyrInfraConfig',
      {
        name: 'ZephyrInfraConfig',
        instanceTypes: ['t4g.xlarge'],
        instanceProfileName: instanceProfile.ref,
        terminateInstanceOnFailure: true,
        description:
          'Graviton2 (arm64) build instance for Zephyr RTOS AMI baking',
      },
    );

    infraConfig.addDependency(instanceProfile);

    // ─── 5. Distribution Configuration ───────────────────────────────────────
    // Distributes the AMI to the home region plus two additional regions.
    // Override via CDK context at deploy time:
    //   cdk deploy --context additionalRegions='["ap-northeast-1","eu-central-1"]'
    const additionalRegions: string[] =
      this.node.tryGetContext('additionalRegions') ?? ['eu-west-1', 'us-west-2'];

    const allRegions = [this.region, ...additionalRegions.slice(0, 2)];

    const distributions = allRegions.map((region) => ({
      region,
      amiDistributionConfiguration: {
        // {{imagebuilder:buildDate}} is resolved by Image Builder at build time
        name: 'soca-zephyr-rtos-arm64-{{imagebuilder:buildDate}}',
        description:
          'Zephyr RTOS dev AMI - Ubuntu 24.04 arm64 (Graviton). ' +
          'Embedded Toolchain Layer per DESIGN.md. Section 3.4.',
        amiTags: {
          Project: 'soca-zephyr',
          ManagedBy: 'cdk',
          OS: 'ubuntu-24.04',
          Architecture: 'arm64',
          ZephyrSDK: 'latest',
        },
      },
    }));

    const distConfig = new imagebuilder.CfnDistributionConfiguration(
      this,
      'ZephyrDistributionConfig',
      {
        name: 'ZephyrDistributionConfig',
        distributions,
        description: `Distributes Zephyr RTOS AMI to: ${allRegions.join(', ')}`,
      },
    );

    // ─── 6. Image Pipeline ────────────────────────────────────────────────────
    // No schedule — triggered on every `cdk deploy` via the Custom Resource below.
    const pipeline = new imagebuilder.CfnImagePipeline(
      this,
      'ZephyrToolchainPipeline',
      {
        name: 'ZephyrToolchainPipeline',
        imageRecipeArn: recipe.attrArn,
        infrastructureConfigurationArn: infraConfig.attrArn,
        distributionConfigurationArn: distConfig.attrArn,
        status: 'ENABLED',
        description:
          'Builds the Zephyr RTOS SOCA Target Node AMI (Ubuntu 24.04 arm64 / Graviton). ' +
          'Auto-triggered on cdk deploy.',
        enhancedImageMetadataEnabled: true,
        imageTestsConfiguration: {
          imageTestsEnabled: false, // no extra test suite needed; smoke test is in the component
        },
      },
    );

    pipeline.addDependency(recipe);
    pipeline.addDependency(infraConfig);
    pipeline.addDependency(distConfig);

    // ─── 7. Auto-trigger: start pipeline on every cdk deploy ─────────────────
    // AwsCustomResource uses a CDK-managed singleton Lambda — zero Lambda code needed.
    // On CREATE and UPDATE it calls imagebuilder:StartImagePipelineExecution.
    // The pipeline build runs asynchronously (~45-60 min); cdk deploy completes immediately.
    const pipelineTrigger = new AwsCustomResource(this, 'PipelineTrigger', {
      resourceType: 'Custom::ImageBuilderPipelineTrigger',
      onCreate: {
        service: 'ImageBuilder',
        action: 'startImagePipelineExecution',
        parameters: {
          imagePipelineArn: pipeline.attrArn,
        },
        // Use timestamp so CDK sees a change on every deploy → re-triggers
        physicalResourceId: PhysicalResourceId.of(
          `ZephyrPipelineTrigger-${Date.now()}`,
        ),
      },
      onUpdate: {
        service: 'ImageBuilder',
        action: 'startImagePipelineExecution',
        parameters: {
          imagePipelineArn: pipeline.attrArn,
        },
        physicalResourceId: PhysicalResourceId.of(
          `ZephyrPipelineTrigger-${Date.now()}`,
        ),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      installLatestAwsSdk: false,
    });

    // Trigger only after the pipeline itself is fully provisioned
    pipelineTrigger.node.addDependency(pipeline);

    // ─── 8. Stack Outputs ─────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'PipelineArn', {
      value: pipeline.attrArn,
      description: 'EC2 Image Builder pipeline ARN - Zephyr RTOS arm64 AMI',
      exportName: 'ZephyrToolchainPipelineArn',
    });

    new cdk.CfnOutput(this, 'CheckBuildStatusCommand', {
      value: `aws imagebuilder list-image-pipeline-images --image-pipeline-arn ${pipeline.attrArn} --query 'imageSummaryList[0].{State:state.status,AMI:outputResources.amis[0].image}' --output table`,
      description:
        'Run this command to check the current build status and resulting AMI ID',
    });

    new cdk.CfnOutput(this, 'ManualRetriggerCommand', {
      value: `aws imagebuilder start-image-pipeline-execution --image-pipeline-arn ${pipeline.attrArn}`,
      description: 'Run this command to manually re-trigger the AMI build',
    });
  }
}
