#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ZephyrAmiStack } from '../lib/zephyr-ami-stack';

const app = new cdk.App();

new ZephyrAmiStack(app, 'ZephyrAmiStack', {
  /**
   * Deploy to the account/region from your current AWS CLI profile.
   * Override by setting CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION env vars,
   * or by passing --profile to cdk deploy.
   */
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description:
    'Zephyr RTOS SOCA Target Node AMI Builder — Ubuntu 24.04 arm64 / Graviton. ' +
    'EC2 Image Builder pipeline auto-triggered on cdk deploy. ' +
    'See DESIGN.md §3.3 and PLAN.md for context.',
  tags: {
    Project: 'soca-zephyr',
    ManagedBy: 'cdk',
  },
});
