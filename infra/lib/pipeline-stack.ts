import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { RestApi, LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { Queue } from 'aws-cdk-lib/aws-sqs';
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
    };

    const makeFn = (name: string, entry: string) => {
      const fn = new Function(this, name, {
        runtime: Runtime.NODEJS_20_X,
        handler: `${entry}.handler`,
        code: Code.fromAsset('../services/dist'),
        environment: commonEnv,
        timeout: Duration.seconds(30),
      });
      data.requestsTable.grantReadWriteData(fn);
      data.driversTable.grantReadWriteData(fn);
      data.fridgesTable.grantReadData(fn);
      data.spamLogTable.grantWriteData(fn);
      data.donationHistoryTable.grantWriteData(fn);
      data.processedMessagesTable.grantReadWriteData(fn);
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

    const startPickupWaitStep = new tasks.LambdaInvoke(this, 'StartPickupPhotoWait', {
      lambdaFunction: startPickupWaitFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        requestId: sfn.JsonPath.stringAt('$.requestId'),
        taskToken: sfn.JsonPath.taskToken,
      }),
    }).addRetry({ errors: ['InvalidPhotoError'], maxAttempts: 3 });

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

    const definition = notifyDonorStep
      .next(matchDriverStep)
      .next(notifyDriverAndWaitStep)
      .next(startPickupWaitStep)
      .next(matchFridgeStep)
      .next(startFridgeWaitStep)
      .next(finalizeStep);

    this.stateMachine = new sfn.StateMachine(this, 'PickupStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(6),
    });

    const dlq = new Queue(this, 'WhatsAppSendDlq', { retentionPeriod: Duration.days(14) });
    dlq.grantSendMessages(inboundRouterFn);
    inboundRouterFn.addEnvironment('WHATSAPP_DLQ_URL', dlq.queueUrl);
    this.stateMachine.grantStartExecution(inboundRouterFn);
    this.stateMachine.grantTaskResponse(inboundRouterFn);
    inboundRouterFn.addEnvironment('STATE_MACHINE_ARN', this.stateMachine.stateMachineArn);

    this.webhookApi = new RestApi(this, 'WhatsAppWebhookApi');
    this.webhookApi.root.addResource('webhook').addMethod('POST', new LambdaIntegration(inboundRouterFn));
  }
}
