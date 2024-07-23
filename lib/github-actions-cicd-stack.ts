import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as dotenv from "dotenv";

export class GithubActionsCicdStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Load the environment .env file.
    dotenv.config();

    // Create a table to store some data.
    const table = new dynamodb.Table(this, "GithubActionsCicd_VisitorTimeTable", {
      partitionKey: {
        name: "key",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const lambdaFunction = new lambda.Function(this, "GithubActionsCicd_LambdaFunction", {
      runtime: lambda.Runtime.PYTHON_3_11,
      code: lambda.Code.fromAsset("lambda"),
      handler: "main.handler",
      environment: {
        VERSION: process.env.VERSION || "0.0",
        COMMIT_HASH: process.env.COMMIT_HASH || "unknown",
        TABLE_NAME: table.tableName,
      },
    });

    table.grantReadWriteData(lambdaFunction);

    const api = new apigateway.RestApi(this, "GithubActionsCicd_Api", {
      restApiName: "GithubActionsCicd_Api",
      deployOptions: { stageName: "api" },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
      },
      binaryMediaTypes: ["image/*", "audio/*", "video/*", "application/pdf", "application/msword", "application/vnd.*", "multipart/form-data"],
    });

    // Create a root resource and add a GET method that triggers the Lambda function
    const rootResource = api.root;
    rootResource.addMethod("GET", new apigateway.LambdaIntegration(lambdaFunction));

    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
    });

    // Output the full API URL including the stage
    new cdk.CfnOutput(this, "ApiUrl_ToTriggerLambda", {
      value: `${api.url}api/`, // Ensure this matches your stage name
    });
  }
}
