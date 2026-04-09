#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AhcTesterStack } from "../lib/ahc-tester-stack";

const app = new cdk.App();
new AhcTesterStack(app, "AhcTesterStack", {
  env: {
    region: process.env.CDK_DEFAULT_REGION || "ap-northeast-1",
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
});
