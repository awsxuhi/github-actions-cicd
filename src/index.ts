import { Construct } from "constructs";
import * as _cdk from "aws-cdk-lib";
import * as _ec2 from "aws-cdk-lib/aws-ec2";
import * as _s3 from "aws-cdk-lib/aws-s3";
import * as _ecr from "aws-cdk-lib/aws-ecr";
import * as _lambda from "aws-cdk-lib/aws-lambda";
import * as _iam from "aws-cdk-lib/aws-iam";
import * as _apigateway from "aws-cdk-lib/aws-apigateway";
import * as _cognito from "aws-cdk-lib/aws-cognito";
import * as _dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as _secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as _ssm from "aws-cdk-lib/aws-ssm";
import * as _logs from "aws-cdk-lib/aws-logs";
import * as path from "path";
import { exportParameter } from "../../common/utils";
import { StackIdSuffix } from "../../common/utils";
import { Layer } from "./layer";
import * as projectConfig from "../../config/project-config.json";

const pythonRuntime = _lambda.Runtime.PYTHON_3_10;
const lambdaArchitecture = _lambda.Architecture.X86_64;
process.env.DOCKER_DEFAULT_PLATFORM = lambdaArchitecture.dockerPlatform;

/***************************************** Construct *******************************************/
export class SharedResourcesConstruct extends Construct {
  public stackIdSuffix: string; // StackID suffix
  public pythonRuntime: _lambda.Runtime = pythonRuntime;
  public lambdaArchitecture: _lambda.Architecture = lambdaArchitecture;
  public defaultEnvironmentVariables: Record<string, string>;
  public vpc: _ec2.Vpc;
  public powerToolsLayer: _lambda.ILayerVersion;
  public commonLayer: _lambda.ILayerVersion;
  public customLayer: _lambda.ILayerVersion;
  public configParameter: _ssm.StringParameter;
  public xOriginVerifySecret: _secretsmanager.Secret;
  public restApi: _apigateway.RestApi;
  public sharedBucket: _s3.Bucket;

  private stackId: string;

  /******************************* Constructor **********************************/

  constructor(scope: Construct, id: string, stackId: string) {
    super(scope, id);

    this.stackId = stackId;
    this.initialize();
  }

  /********************************* Method *************************************/

  private initialize() {
    this.getTheSuffixOfTheStackId();
    this.defineDefaultEnvironmentVariablesForPowerTools();
    this.createVpcAndVpcEndpoints();
    this.createPythonLambdaLayers();
    this.createXOriginVerifySecret();
    this.createRestApi();
    this.createSharedBucket();
    this.outputParams_in_CloudFormation_and_ParameterStore();
  }

  /*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
  private getTheSuffixOfTheStackId() {
    this.stackIdSuffix = StackIdSuffix(this.stackId);
  }

  /*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
  private defineDefaultEnvironmentVariablesForPowerTools() {
    this.defaultEnvironmentVariables = {
      POWERTOOLS_DEV: "true",
      LOG_LEVEL: "INFO",
      POWERTOOLS_LOGGER_LOG_EVENT: "true",
      POWERTOOLS_SERVICE_NAME: "chatbot",
      // POWERTOOLS_LOGGER_SAMPLE_RATE: "0.1",
    };
  }

  /*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
  private createVpcAndVpcEndpoints() {
    if (projectConfig.existingVpcId && typeof projectConfig.existingVpcId === "string" && projectConfig.existingVpcId.length > 0) {
      // Use the existing VPC
      this.vpc = _ec2.Vpc.fromLookup(this, "VPC", {
        vpcId: projectConfig.existingVpcId,
      }) as _ec2.Vpc;
    } else {
      // Create a new VPC
      this.vpc = new _ec2.Vpc(this, projectConfig.projectName + "-VPC", {
        natGateways: 1,
        restrictDefaultSecurityGroup: false, // default: false; Not remove default rules
        subnetConfiguration: [
          {
            name: "public",
            subnetType: _ec2.SubnetType.PUBLIC,
          },
          {
            name: "private",
            subnetType: _ec2.SubnetType.PRIVATE_WITH_EGRESS,
          },
          {
            name: "isolated",
            subnetType: _ec2.SubnetType.PRIVATE_ISOLATED,
          },
        ],
      });
    }

    if (projectConfig.createVpcEndpoints) {
      // Create a VPC endpoint for S3.
      /**
       * S3 gateway endpoints are regional while Interface endpoints can be accessed from different regions. S3 Interface Endpoint provides better performance than S3 Gateway Endpoint because your traffic stays within your VPC and does not have to travel over the internet to reach the S3 service endpoint.
       * Ref: https://rahulrdeo.medium.com/comparing-amazon-s3-access-via-gateway-endpoint-vs-interface-endpoint-making-the-right-choice-79694586075b
       */
      const s3GatewayEndpoint = this.vpc.addGatewayEndpoint("S3GatewayEndpoint", {
        service: _ec2.GatewayVpcEndpointAwsService.S3,
      });

      const s3vpcEndpoint = this.vpc.addInterfaceEndpoint("S3InterfaceEndpoint", {
        service: _ec2.InterfaceVpcEndpointAwsService.S3,
        privateDnsEnabled: true,
        open: true,
      });

      s3vpcEndpoint.node.addDependency(s3GatewayEndpoint);

      // Create a VPC endpoint for DynamoDB.
      this.vpc.addGatewayEndpoint("DynamoDBEndpoint", {
        service: _ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      });

      // Create VPC Endpoint for Secrets Manager
      this.vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
        service: _ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        open: true,
      });

      // Create VPC Endpoint for SageMaker Runtime
      this.vpc.addInterfaceEndpoint("SageMakerRuntimeEndpoint", {
        service: _ec2.InterfaceVpcEndpointAwsService.SAGEMAKER_RUNTIME,
        open: true,
      });
    }
  }

  /*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
  private createPythonLambdaLayers() {
    // The 1st Layer: Powertools Layer (use Arn)
    // Ref: Powertools for AWS Lambda(Python) https://docs.powertools.aws.dev/lambda/python/latest/
    const powerToolsLayerVersion = "51";
    const powerToolsArn =
      lambdaArchitecture === _lambda.Architecture.X86_64
        ? `arn:${_cdk.Aws.PARTITION}:lambda:${_cdk.Aws.REGION}:017000801446:layer:AWSLambdaPowertoolsPythonV2:${powerToolsLayerVersion}`
        : `arn:${_cdk.Aws.PARTITION}:lambda:${_cdk.Aws.REGION}:017000801446:layer:AWSLambdaPowertoolsPythonV2-Arm64:${powerToolsLayerVersion}`;
    this.powerToolsLayer = _lambda.LayerVersion.fromLayerVersionArn(this, "PowertoolsLayer", powerToolsArn);

    // The 2nd Layer: Common Layer (3rd party)
    // Option 1: execute `cd common && pip install -r requirements.txt --target ./layer/python` before runing cdk deploy. However, error `[ERROR] Runtime.ImportModuleError: Unable to import module 'index': Error importing numpy: you should not try to import numpy from its source directory` will be encountered.
    // this.commonLayer = new _lambda.LayerVersion(this, "CommonLayer", {
    //   code: _lambda.Code.fromAsset(path.join(__dirname, "./python-lambda-layers/common/layer")),
    //   compatibleRuntimes: [pythonRuntime],
    //   compatibleArchitectures: [lambdaArchitecture],
    //   removalPolicy: _cdk.RemovalPolicy.DESTROY,
    // });

    // Option 2: Build on S3
    const commonLayerInstance = new Layer(this, "CommonLayer", {
      runtime: pythonRuntime,
      architecture: lambdaArchitecture,
      path: path.join(__dirname, "./python-lambda-layers/common"),
    });
    this.commonLayer = commonLayerInstance.layer;

    // The 3rd Layer: Custom Layer (inhouse-built)
    this.customLayer = new _lambda.LayerVersion(this, "CustomLayer", {
      code: _lambda.Code.fromAsset(path.join(__dirname, "./python-lambda-layers/custom")),
      compatibleRuntimes: [pythonRuntime],
      compatibleArchitectures: [lambdaArchitecture],
      removalPolicy: _cdk.RemovalPolicy.DESTROY,
    });
  }

  /*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
  private createXOriginVerifySecret() {
    /**
     * You can use Cognito User Pools as an authorizer for Amazon API Gateway to implement a feature similar to
     * X-Origin-Verify. However, CloudFront itself does not directly handle JWT tokens for authentication. Instead,
     * you need to configure CloudFront to forward requests to a backend service, such as API Gateway, which can be
     * set up with a Cognito User Pool as the authorizer to handle JWTs. By default, CloudFront does not forward the
     * Authorization header because this would cause each request with a different Authorization header to bypass the
     * cache, reducing cache efficiency. Using a custom header can maintain a high cache hit rate while still
     * providing a method to verify the origin of requests.
     */
    const theSecretName = projectConfig.projectName + "-X-Origin-Passcode";
    this.xOriginVerifySecret = new _secretsmanager.Secret(this, "X-Origin-Passcode", {
      secretName: theSecretName,
      description: "Use fixed master user's password from env file for OpenSearch domain",
      generateSecretString: {
        excludePunctuation: true, // .,;:?!'"()[]{}—_-/\|~*#%&<>=$^` are excluded
        generateStringKey: "headerValue",
        secretStringTemplate: "{}",
      },
      removalPolicy: _cdk.RemovalPolicy.DESTROY,
    });
  }

  /*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
  private createRestApi() {
    const restApiNameValue = projectConfig.projectName + "-RestApi";
    this.restApi = new _apigateway.RestApi(this, restApiNameValue, {
      restApiName: restApiNameValue,
      deployOptions: {
        stageName: "api",
        loggingLevel: _apigateway.MethodLoggingLevel.INFO, // default: Off
        tracingEnabled: true, // default: false
        metricsEnabled: true, // default: false
        throttlingRateLimit: 2500, // default: No additional restriction.
      }, // Change the stageName from `prod` to `api`.
      /*
       * 1. Setting binaryMediaTypes will lead to CORS 500 error on OPTIONS Preflight request. Since we only use the api to transfer json object.
       * We don't need to set binaryMediaTypes: [image/*, application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document]
       * 2. defaultCorsPreflightOptions: Adds a CORS preflight OPTIONS method to this resource and all CHILD resources. (optionsWithCors is not necessary now)
       * You don't need to set allowMethods or allowHeaders. Their default values are what we expect.
       * allowMethods: default: Cors.ALL_METHODS
       * allowHeaders: default: Cors.DEFAULT_HEADERS
       * After testing with a piece of code I wrote, I found that the Cors.DEFAULT_HEADERS (without details in the documentation) actually includes the following headers:
       * [
       *  'Content-Type',
       *  'X-Amz-Date',
       *  'Authorization',
       *  'X-Api-Key',
       *  'X-Amz-Security-Token',
       *  'X-Amz-User-Agent'
       * ]
       * The conclusion is you don't need to specify the `allowHeaders:` here.
       */
      defaultCorsPreflightOptions: {
        allowOrigins: _apigateway.Cors.ALL_ORIGINS,
        maxAge: _cdk.Duration.minutes(10), // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age default: 5s
      },
      binaryMediaTypes: ["image/*", "audio/*", "video/*", "application/pdf", "application/msword", "application/vnd.*", "multipart/form-data"],
    });
  }

  /*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
  private createSharedBucket() {
    // For files upload before conducting analysis
    const bucketName = `${projectConfig.projectName}-${this.stackIdSuffix}-shared-bucket`;
    this.sharedBucket = new _s3.Bucket(this, `${projectConfig.projectName}-shared-bucket`, {
      bucketName: bucketName,
      blockPublicAccess: _s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: _cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      transferAcceleration: true,
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [_s3.HttpMethods.PUT, _s3.HttpMethods.POST, _s3.HttpMethods.GET, _s3.HttpMethods.HEAD],
          allowedOrigins: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
    });
  }

  /*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
  private outputParams_in_CloudFormation_and_ParameterStore() {
    exportParameter(this, "VpcId", this.vpc.vpcId);
    exportParameter(this, "RestApiName", this.restApi.restApiName);
    exportParameter(this, "RestApiRootUrl", this.restApi.url);
    if (this.restApi.domainName?.domainName) {
      exportParameter(this, "RestApiDomainName", this.restApi.domainName.domainName);
    }
  }
}
