import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

export class AhcTesterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for contest tools (gen, tester)
    const toolsBucket = new s3.Bucket(this, "ToolsBucket", {
      bucketName: `ahc-tester-tools-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Lambda execution role
    const lambdaRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          "LambdaBasicExecution",
          "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });
    toolsBucket.grantReadWrite(lambdaRole);

    // Lambda function
    const fn = new lambda.Function(this, "AhcTesterFunction", {
      functionName: "ahc-tester",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "lambda_handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, ".."), {
        bundling: {
          image: cdk.DockerImage.fromRegistry("dummy"),
          local: {
            tryBundle(outputDir: string) {
              const fs = require("fs");

              // Copy lambda handler
              fs.copyFileSync(
                path.join(__dirname, "../lambda_handler.py"),
                path.join(outputDir, "lambda_handler.py")
              );

              return true;
            },
          },
        },
      }),
      timeout: cdk.Duration.minutes(15),
      memorySize: 3008,
      environment: {
        TOOLS_BUCKET: toolsBucket.bucketName,
      },
      role: lambdaRole,
    });

    // IAM role for pahcer-studio (AssumeRole)
    const invokeRole = new iam.Role(this, "PahcerInvokeRole", {
      roleName: "pahcer-lambda-invoke-role",
      assumedBy: new iam.AccountPrincipal(this.account),
    });

    // Allow invoke role to call Lambda and upload to S3
    fn.grantInvoke(invokeRole);
    toolsBucket.grantReadWrite(invokeRole);

    // Outputs
    new cdk.CfnOutput(this, "FunctionName", {
      value: fn.functionName,
    });
    new cdk.CfnOutput(this, "ToolsBucketName", {
      value: toolsBucket.bucketName,
    });
    new cdk.CfnOutput(this, "InvokeRoleArn", {
      value: invokeRole.roleArn,
    });
  }
}
