import * as path from 'path';
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { RestApi, LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { DataStack } from './data-stack';

interface PipelineStackProps extends StackProps {
  data: DataStack;
}

export class PipelineStack extends Stack {
  public readonly webhookApi: RestApi;
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    const { data } = props;

    const commonEnv = {
      REQUESTS_TABLE: data.requestsTable.tableName,
      DRIVERS_TABLE: data.driversTable.tableName,
      FRIDGES_TABLE: data.fridgesTable.tableName,
      SPAM_LOG_TABLE: data.spamLogTable.tableName,
      DONATION_HISTORY_TABLE: data.donationHistoryTable.tableName,
      PROCESSED_MESSAGES_TABLE: data.processedMessagesTable.tableName,
      // No WhatsApp phone-number-id ARN exists at this stack's synth time (it's provisioned
      // manually post-deploy per Task 22's README) — default to '' so the Lambda code has a
      // defined env-var seam to read from once that value is set via CDK context or console.
      WHATSAPP_ORIGINATION_PHONE_NUMBER_ID: this.node.tryGetContext('whatsappOriginationPhoneNumberId') ?? '',
    };

    const makeFn = (name: string, entry: string) => {
      const fn = new Function(this, name, {
        runtime: Runtime.NODEJS_20_X,
        handler: `${entry}.handler`,
        // Resolved relative to this file's compiled location, not process.cwd(), so `cdk synth`
        // and `jest` both resolve the same directory regardless of which directory they're invoked from.
        code: Code.fromAsset(path.join(__dirname, '..', '..', 'services', 'dist')),
        environment: commonEnv,
        timeout: Duration.seconds(30),
      });
      data.requestsTable.grantReadWriteData(fn);
      data.driversTable.grantReadWriteData(fn);
      data.fridgesTable.grantReadData(fn);
      data.spamLogTable.grantWriteData(fn);
      data.donationHistoryTable.grantWriteData(fn);
      data.processedMessagesTable.grantReadWriteData(fn);
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
    const inboundRouterFn = makeFn('InboundRouterFn', 'inbound-router/handler');

    // Only InboundRouterFn classifies inbound text, so only it needs Bedrock Agent access.
    // No specific agent ARN exists at this stack's synth time (the Agent itself isn't
    // provisioned by this CDK app — see Task 22's README for the manual post-deploy step),
    // so this is scoped to '*'.
    inboundRouterFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeAgent'],
      resources: ['*'],
    }));
    inboundRouterFn.addEnvironment('CLASSIFIER_AGENT_ID', this.node.tryGetContext('classifierAgentId') ?? '');
    inboundRouterFn.addEnvironment('CLASSIFIER_AGENT_ALIAS_ID', this.node.tryGetContext('classifierAgentAliasId') ?? '');

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
      comment: 'Two reassign attempts failed — request left PENDING_REVIEW for manual admin resolution',
    });

    // MatchDriver returns driverId: null when no driver is available (e.g. the pool is
    // exhausted mid-reassign-loop). Without this check, NotifyDriverAndWait's getDriverById(null)
    // throws, which isn't caught by the States.Timeout-only Catch below, hard-failing the
    // execution instead of reaching the admin-alert path.
    const driverFoundCheck = new sfn.Choice(this, 'DriverFound')
      .when(sfn.Condition.isNull('$.driverId'), adminAlertStep)
      .otherwise(notifyDriverAndWaitStep);

    const startPickupWaitStep = new tasks.LambdaInvoke(this, 'StartPickupPhotoWait', {
      lambdaFunction: startPickupWaitFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        requestId: sfn.JsonPath.stringAt('$.requestId'),
        taskToken: sfn.JsonPath.taskToken,
      }),
    }).addRetry({ errors: ['InvalidPhotoError'], maxAttempts: 3 });

    // A DECLINE reply must be routed into the same reassign loop a timeout uses — reassignDriver's
    // handler only needs {requestId} and already frees the driver / tracks triedDriverIds /
    // increments reassignCount, so a decline and a timeout are handled identically.
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
    }).addRetry({ errors: ['InvalidPhotoError'], maxAttempts: 3 });

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
    matchFridgeStep.next(startFridgeWaitStep);
    startFridgeWaitStep.next(finalizeStep);

    const definition = sfn.Chain.start(notifyDonorStep);

    this.stateMachine = new sfn.StateMachine(this, 'PickupStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(6),
    });

    const dlq = new Queue(this, 'WhatsAppSendDlq', { retentionPeriod: Duration.days(14) });
    dlq.grantSendMessages(inboundRouterFn);
    inboundRouterFn.addEnvironment('WHATSAPP_DLQ_URL', dlq.queueUrl);
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
    this.webhookApi.root.addResource('webhook').addMethod('POST', new LambdaIntegration(inboundRouterFn));
  }
}
