import * as path from 'path';
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RestApi, LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { DataStack } from './data-stack';
import { SERVICES_DIR, nodejsBundling } from './lambda-bundling';

interface PipelineStackProps extends StackProps {
  data: DataStack;
}

export class PipelineStack extends Stack {
  public readonly webhookApi: RestApi;
  public readonly stateMachine: sfn.StateMachine;
  public readonly whatsAppDlq: Queue;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    const { data } = props;

    // Created up front so every Lambda that can send a WhatsApp message gets the queue URL —
    // shared/whatsapp.ts parks failed sends here, and the CloudWatch alarm watches its depth.
    this.whatsAppDlq = new Queue(this, 'WhatsAppSendDlq', { retentionPeriod: Duration.days(14) });

    const commonEnv = {
      REQUESTS_TABLE: data.requestsTable.tableName,
      DRIVERS_TABLE: data.driversTable.tableName,
      FRIDGES_TABLE: data.fridgesTable.tableName,
      SPAM_LOG_TABLE: data.spamLogTable.tableName,
      DONATION_HISTORY_TABLE: data.donationHistoryTable.tableName,
      PROCESSED_MESSAGES_TABLE: data.processedMessagesTable.tableName,
      WHATSAPP_DLQ_URL: this.whatsAppDlq.queueUrl,
      PHOTOS_BUCKET: data.photosBucket.bucketName,
      // Meta Graph API access token, used to download the actual bytes behind an inbound
      // `media:<id>` so the pickup/fridge photo can be archived in S3. Same post-deploy
      // context seam as the other Meta credentials.
      META_ACCESS_TOKEN: this.node.tryGetContext('metaAccessToken') ?? '',
      // No WhatsApp phone-number-id ARN exists at this stack's synth time (it's provisioned
      // manually post-deploy per Task 22's README) — default to '' so the Lambda code has a
      // defined env-var seam to read from once that value is set via CDK context or console.
      WHATSAPP_ORIGINATION_PHONE_NUMBER_ID: this.node.tryGetContext('whatsappOriginationPhoneNumberId') ?? '',
    };

    const makeFn = (name: string, entry: string) => {
      // NodejsFunction (esbuild) rather than Code.fromAsset(services/dist): the tsc output has
      // no node_modules, so every `require("@aws-sdk/...")` had to be satisfied by whatever the
      // managed runtime happens to ship. AWS does not guarantee client-socialmessaging or
      // client-bedrock-runtime are present, so a cold start could fail outright with
      // Runtime.ImportModuleError. See lambda-bundling.ts for why the SDK is bundled, not
      // externalised.
      const fn = new NodejsFunction(this, name, {
        runtime: Runtime.NODEJS_20_X,
        entry: path.join(SERVICES_DIR, `${entry}.ts`),
        handler: 'handler',
        bundling: nodejsBundling(),
        environment: commonEnv,
        timeout: Duration.seconds(30),
      });
      data.requestsTable.grantReadWriteData(fn);
      data.driversTable.grantReadWriteData(fn);
      data.fridgesTable.grantReadData(fn);
      data.spamLogTable.grantWriteData(fn);
      data.donationHistoryTable.grantWriteData(fn);
      data.processedMessagesTable.grantReadWriteData(fn);
      this.whatsAppDlq.grantSendMessages(fn);
      // Needed by the two photo handlers (which actually run inside InboundRouterFn, since
      // driverHandler.ts calls handleResult directly) to archive a WhatsApp image.
      data.photosBucket.grantPut(fn);
      // Every pipeline Lambda may send a WhatsApp message (donor/driver notifications);
      // service prefix confirmed as "social-messaging" (not "socialmessaging") against AWS's
      // service-authorization reference. No phone-number-id ARN is known at synth time (it's
      // created manually post-deploy), so this is scoped to '*' for now.
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['social-messaging:SendWhatsAppMessage'],
        resources: ['*'],
      }));
      return fn;
    };

    const notifyDonorFn = makeFn('NotifyDonorFn', 'pipeline/notifyDonor');
    const matchDriverFn = makeFn('MatchDriverFn', 'pipeline/matchDriver');
    const notifyDriverAndWaitFn = makeFn('NotifyDriverAndWaitFn', 'pipeline/notifyDriverAndWait');
    const reassignDriverFn = makeFn('ReassignDriverFn', 'pipeline/reassignDriver');
    const startPickupWaitFn = makeFn('StartPickupWaitFn', 'pipeline/handlePickupPhoto');
    const matchFridgeFn = makeFn('MatchFridgeFn', 'pipeline/matchFridge');
    const startFridgeWaitFn = makeFn('StartFridgeWaitFn', 'pipeline/handleFridgePhoto');
    const finalizeRequestFn = makeFn('FinalizeRequestFn', 'pipeline/finalizeRequest');
    const flagStuckRequestFn = makeFn('FlagStuckRequestFn', 'pipeline/flagStuckRequest');
    const inboundRouterFn = makeFn('InboundRouterFn', 'inbound-router/handler');

    // Only InboundRouterFn classifies inbound text, so only it needs Bedrock model access.
    // Classic Bedrock Agents is in maintenance mode for new accounts (CreateAgent blocked), so
    // classification is a direct InvokeModel call against a Claude Haiku inference profile
    // rather than an orchestrated Agent. Scoped to '*' since the inference profile ARN varies
    // by region/account and isn't known at this stack's synth time.
    inboundRouterFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:GetInferenceProfile'],
      resources: ['*'],
    }));
    inboundRouterFn.addEnvironment('CLASSIFIER_MODEL_ID', this.node.tryGetContext('classifierModelId') ?? '');
    // Meta app credentials: the App Secret signs every inbound webhook (X-Hub-Signature-256),
    // the verify token answers Meta's GET registration handshake. Both live in the Meta app
    // console, not in this CDK app, so they use the same empty-string context seam as the
    // Bedrock agent ids. The handler fails closed while they are unset.
    inboundRouterFn.addEnvironment('META_APP_SECRET', this.node.tryGetContext('metaAppSecret') ?? '');
    inboundRouterFn.addEnvironment(
      'META_WEBHOOK_VERIFY_TOKEN',
      this.node.tryGetContext('metaWebhookVerifyToken') ?? '',
    );

    const notifyDonorStep = new tasks.LambdaInvoke(this, 'NotifyDonor', {
      lambdaFunction: notifyDonorFn,
      outputPath: '$.Payload',
    });

    const matchDriverStep = new tasks.LambdaInvoke(this, 'MatchDriver', {
      lambdaFunction: matchDriverFn,
      outputPath: '$.Payload',
    });

    const notifyDriverAndWaitStep = new tasks.LambdaInvoke(this, 'NotifyDriverAndWait', {
      lambdaFunction: notifyDriverAndWaitFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        requestId: sfn.JsonPath.stringAt('$.requestId'),
        driverId: sfn.JsonPath.stringAt('$.driverId'),
        taskToken: sfn.JsonPath.taskToken,
      }),
      timeout: Duration.minutes(60),
    });

    const reassignStep = new tasks.LambdaInvoke(this, 'ReassignDriver', {
      lambdaFunction: reassignDriverFn,
      outputPath: '$.Payload',
    });

    const adminAlertStep = new sfn.Pass(this, 'AdminAlertStuck', {
      comment: 'Request left PENDING_REVIEW for manual admin resolution',
    });

    // The single terminal "this can no longer progress" step, shared by every dead end:
    // photo-retry exhaustion, no driver available, and no fridge matched. Takes only
    // {requestId} precisely so all of them can reuse it. Unlike ReassignDriver it never
    // re-enters matching, so it cannot loop when the driver pool is empty from the start.
    const flagStuckStep = new tasks.LambdaInvoke(this, 'FlagStuckRequest', {
      lambdaFunction: flagStuckRequestFn,
      payload: sfn.TaskInput.fromObject({ requestId: sfn.JsonPath.stringAt('$.requestId') }),
      outputPath: '$.Payload',
    }).next(adminAlertStep);

    // MatchDriver returns driverId: null when no driver is available (pool exhausted
    // mid-reassign-loop, or the request has no donor geo to match against). Without this check,
    // NotifyDriverAndWait's getDriverById(null) throws, which isn't caught by the
    // States.Timeout-only Catch below, hard-failing the execution.
    const driverFoundCheck = new sfn.Choice(this, 'DriverFound')
      .when(sfn.Condition.isNull('$.driverId'), flagStuckStep)
      .otherwise(notifyDriverAndWaitStep);

    // Retry gives the driver 3 chances to send a usable photo; the Catch is what stops an
    // exhausted retry from failing the execution outright and leaving the request mid-flow
    // with a stale task token and its driver pinned `busy` forever.
    const startPickupWaitStep = new tasks.LambdaInvoke(this, 'StartPickupPhotoWait', {
      lambdaFunction: startPickupWaitFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        requestId: sfn.JsonPath.stringAt('$.requestId'),
        taskToken: sfn.JsonPath.taskToken,
      }),
    })
      .addRetry({ errors: ['InvalidPhotoError'], maxAttempts: 3 })
      .addCatch(flagStuckStep, { errors: ['States.ALL'], resultPath: '$.error' });

    // A DECLINE reply must be routed into the same reassign loop a timeout uses — reassignDriver's
    // handler only needs {requestId} and already frees the driver / tracks triedDriverIds /
    // increments reassignCount, so a decline and a timeout are handled identically.
    // driverHandler.ts normalises every non-ACCEPT reply to the literal 'DECLINE' this matches.
    const driverAcceptedCheck = new sfn.Choice(this, 'DriverAccepted')
      .when(sfn.Condition.stringEquals('$.reply', 'DECLINE'), reassignStep)
      .otherwise(startPickupWaitStep);

    const matchFridgeStep = new tasks.LambdaInvoke(this, 'MatchFridge', {
      lambdaFunction: matchFridgeFn,
      outputPath: '$.Payload',
    });

    const startFridgeWaitStep = new tasks.LambdaInvoke(this, 'StartFridgePhotoWait', {
      lambdaFunction: startFridgeWaitFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        requestId: sfn.JsonPath.stringAt('$.requestId'),
        taskToken: sfn.JsonPath.taskToken,
      }),
    })
      .addRetry({ errors: ['InvalidPhotoError'], maxAttempts: 3 })
      .addCatch(flagStuckStep, { errors: ['States.ALL'], resultPath: '$.error' });

    // Mirrors DriverFound: a null fridgeId previously fell straight through to
    // StartFridgePhotoWait, which then waited indefinitely for a photo of a drop-off at a
    // fridge that was never matched.
    const fridgeFoundCheck = new sfn.Choice(this, 'FridgeFound')
      .when(sfn.Condition.isNull('$.fridgeId'), flagStuckStep)
      .otherwise(startFridgeWaitStep);

    const finalizeStep = new tasks.LambdaInvoke(this, 'FinalizeRequest', {
      lambdaFunction: finalizeRequestFn,
      outputPath: '$.Payload',
    });

    const reassignLoop = reassignStep.next(
      new sfn.Choice(this, 'ReassignOrAlert')
        .when(sfn.Condition.booleanEquals('$.shouldAlertAdmin', true), adminAlertStep)
        .otherwise(matchDriverStep),
    );

    notifyDriverAndWaitStep.addCatch(reassignLoop, { errors: ['States.Timeout'], resultPath: '$.error' });

    // matchDriverStep is reached both from NotifyDonor's initial transition and from the
    // reassign loop's `.otherwise(matchDriverStep)` re-entry above — it's the same state object
    // either way, so a single `.next()` call wires both paths through DriverFound.
    notifyDonorStep.next(matchDriverStep);
    matchDriverStep.next(driverFoundCheck);
    notifyDriverAndWaitStep.next(driverAcceptedCheck);
    startPickupWaitStep.next(matchFridgeStep);
    matchFridgeStep.next(fridgeFoundCheck);
    startFridgeWaitStep.next(finalizeStep);

    const definition = sfn.Chain.start(notifyDonorStep);

    this.stateMachine = new sfn.StateMachine(this, 'PickupStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(6),
    });

    this.stateMachine.grantStartExecution(inboundRouterFn);
    this.stateMachine.grantTaskResponse(inboundRouterFn);
    // Belt-and-suspenders: AWS's service-authorization reference for Step Functions shows
    // SendTaskSuccess/SendTaskFailure/SendTaskHeartbeat have no supported resource type
    // (confirmed against the programmatic service-reference JSON — "Resources": null for all
    // three), meaning a statement scoped to the state machine ARN matches nothing. CDK's
    // grantTaskResponse() above does scope to the state machine ARN, so it's likely a no-op;
    // this explicit '*' statement is what actually grants the permission. Kept both rather than
    // replacing grantTaskResponse, in case CDK or AWS loosens this restriction later.
    inboundRouterFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:SendTaskSuccess', 'states:SendTaskFailure', 'states:SendTaskHeartbeat'],
      resources: ['*'],
    }));
    inboundRouterFn.addEnvironment('STATE_MACHINE_ARN', this.stateMachine.stateMachineArn);

    this.webhookApi = new RestApi(this, 'WhatsAppWebhookApi');
    const webhook = this.webhookApi.root.addResource('webhook');
    const routerIntegration = new LambdaIntegration(inboundRouterFn);
    webhook.addMethod('POST', routerIntegration);
    // Meta GETs this same URL once during webhook registration with
    // ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…, and expects the challenge echoed.
    webhook.addMethod('GET', routerIntegration);
  }
}
