import { Construct } from "constructs";
import { join } from "path";
import * as _cdk from "aws-cdk-lib";
import * as _ec2 from "aws-cdk-lib/aws-ec2";
import * as _dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as _iam from "aws-cdk-lib/aws-iam";
import * as _lambda from "aws-cdk-lib/aws-lambda";
import * as _lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as _sns from "aws-cdk-lib/aws-sns";
import * as _sqs from "aws-cdk-lib/aws-sqs";
import * as _secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as _subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as _logs from "aws-cdk-lib/aws-logs";
import { exportParameter } from "../../../common/utils";
import { MyRoles } from "../../02-auth/roles";
import { SharedResourcesConstruct } from "../../01-shared-resources";
import * as projectConfig from "../../../config/project-config.json";

export interface QaRequestHandlerToSnsTopicConstructProps {
  sharedResources: SharedResourcesConstruct; // add api resources to its RestApi Gateway
  messagesTopic: _sns.Topic; // connect the SQS to the topic
  opensearchEndpoint: string;
  opensearchMasterUserSecret: _secretsmanager.ISecret;
}

/******************************* RestApiGatewayConstruct *********************************/

export class QaRequestHandlerToSnsTopicConstruct extends Construct {
  private incomingMessagesQueue: _sqs.Queue;

  /******************************* Constructor **********************************/
  constructor(scope: Construct, id: string, props: QaRequestHandlerToSnsTopicConstructProps) {
    super(scope, id);

    const myRoles = MyRoles.getInstance(this);

    // Step 1: Create requestHandler which is handling question-answering
    const functionName = "question-answering";
    const functionNameWithProjectNameAsPrefix = `${projectConfig.projectName}-${functionName}`;

    const requestHandler = new _lambda.Function(this, functionNameWithProjectNameAsPrefix, {
      functionName: functionNameWithProjectNameAsPrefix,
      role: myRoles.lambdaRoleA,
      vpc: props.sharedResources.vpc,
      code: _lambda.Code.fromAsset(join(__dirname, "lambda", functionName)),
      handler: "index.lambda_handler",
      runtime: props.sharedResources.pythonRuntime,
      architecture: props.sharedResources.lambdaArchitecture,
      tracing: _lambda.Tracing.ACTIVE,
      timeout: _cdk.Duration.minutes(15),
      memorySize: 1024,
      logRetention: _logs.RetentionDays.ONE_WEEK,
      layers: [props.sharedResources.powerToolsLayer, props.sharedResources.commonLayer, props.sharedResources.customLayer],
      environment: {
        ...props.sharedResources.defaultEnvironmentVariables,
        OPEN_SEARCH_ENDPOINT: props.opensearchEndpoint,
        OPENSEARCH_SECRET_ID: props.opensearchMasterUserSecret.secretName, // = projectConfig.opensearchSecretName
        OPENSEARCH_SECRET_ARN: props.opensearchMasterUserSecret.secretArn,
        OPENAI_SECRET_ID: projectConfig.openaiSecretName,
        OPENAI_API_KEY_KEY: projectConfig.openaiApiKey_Key,
        OPENAI_API_BASE_KEY: projectConfig.openaiApiBase_Key,
        SESSIONS_TABLE_NAME: `${projectConfig.projectName}-qa-${projectConfig.sessionIdTableNameSuffix}`,
        MESSAGES_TOPIC_ARN: props.messagesTopic.topicArn,
        S3_SHARED_BUCKET: props.sharedResources.sharedBucket.bucketName,
      },
    });

    // Step 2: Create IncomingMessageQueue
    const deadLetterQueue = new _sqs.Queue(this, projectConfig.projectName + "IncomingMessagesDLQ" + "-qa", {
      // fifo: true,
      visibilityTimeout: _cdk.Duration.seconds(900 * 6),
    });
    const queue = new _sqs.Queue(this, projectConfig.projectName + "IncomingMessagesQueue" + "-qa", {
      // fifo: true,
      // https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#events-sqs-queueconfig
      visibilityTimeout: _cdk.Duration.seconds(900 * 6),
      removalPolicy: _cdk.RemovalPolicy.DESTROY,
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 3,
      },
    });
    /* grant eventbridge permissions to send messages to the queue */
    queue.addToResourcePolicy(
      new _iam.PolicyStatement({
        actions: ["sqs:SendMessage"],
        resources: [queue.queueArn],
        principals: [new _iam.ServicePrincipal("events.amazonaws.com"), new _iam.ServicePrincipal("sqs.amazonaws.com")],
      })
    );

    requestHandler.addEventSource(new _lambdaEventSources.SqsEventSource(queue));

    /* Route all incoming messages to the incoming queue */
    props.messagesTopic.addSubscription(
      new _subscriptions.SqsSubscription(queue, {
        filterPolicyWithMessageBody: {
          direction: _sns.FilterOrPolicy.filter(
            _sns.SubscriptionFilter.stringFilter({
              allowlist: ["IN"],
            })
          ),
          usecase: _sns.FilterOrPolicy.filter(
            _sns.SubscriptionFilter.stringFilter({
              allowlist: ["qa"],
            })
          ),
        },
      })
    );

    this.incomingMessagesQueue = queue;

    exportParameter(this, "Usecase-qa-incoming-queue", this.incomingMessagesQueue.queueName, "Receive incoming messages from SNS Topic");
  }
}
