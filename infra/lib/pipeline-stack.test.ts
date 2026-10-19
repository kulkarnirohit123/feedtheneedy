import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack';
import { PipelineStack } from './pipeline-stack';

function synthPipeline() {
  const app = new App();
  const data = new DataStack(app, 'TestDataStack');
  const stack = new PipelineStack(app, 'TestPipelineStack', { data });
  return Template.fromStack(stack);
}

function extractDefinitionString(template: Template): any {
  const json = template.toJSON();
  const resources = json.Resources as Record<string, any>;
  const sm = Object.values(resources).find((r: any) => r.Type === 'AWS::StepFunctions::StateMachine') as any;
  const defn = sm.Properties.DefinitionString;
  const parts: string[] = defn['Fn::Join'][1];
  const joined = parts.map((p) => (typeof p === 'string' ? p : 'REF')).join('');
  return JSON.parse(joined);
}

test('creates a Step Functions state machine, a REST API, and an SQS DLQ', () => {
  const template = synthPipeline();

  template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
  template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  template.resourceCountIs('AWS::SQS::Queue', 1);
});

test('creates exactly 9 pipeline/router Lambda functions', () => {
  const template = synthPipeline();
  template.resourceCountIs('AWS::Lambda::Function', 9);
});

test('NotifyDriverAndWait catches States.Timeout with resultPath $.error into ReassignDriver', () => {
  const asl = extractDefinitionString(synthPipeline());
  const state = asl.States.NotifyDriverAndWait;
  expect(state.Catch).toEqual([
    expect.objectContaining({
      ErrorEquals: ['States.Timeout'],
      ResultPath: '$.error',
      Next: 'ReassignDriver',
    }),
  ]);
});

test('both photo-wait states retry InvalidPhotoError up to 3 times', () => {
  const asl = extractDefinitionString(synthPipeline());
  for (const name of ['StartPickupPhotoWait', 'StartFridgePhotoWait']) {
    const retriers = asl.States[name].Retry;
    const invalidPhotoRetrier = retriers.find((r: any) => r.ErrorEquals.includes('InvalidPhotoError'));
    expect(invalidPhotoRetrier).toEqual(
      expect.objectContaining({ ErrorEquals: ['InvalidPhotoError'], MaxAttempts: 3 }),
    );
  }
});

test('DriverFound Choice routes a null driverId to AdminAlertStuck, otherwise to NotifyDriverAndWait', () => {
  const asl = extractDefinitionString(synthPipeline());
  expect(asl.States.MatchDriver.Next).toBe('DriverFound');
  const choice = asl.States.DriverFound;
  expect(choice.Type).toBe('Choice');
  expect(choice.Choices).toEqual([
    expect.objectContaining({ Variable: '$.driverId', IsNull: true, Next: 'AdminAlertStuck' }),
  ]);
  expect(choice.Default).toBe('NotifyDriverAndWait');
});

test('DriverAccepted Choice routes a DECLINE reply to ReassignDriver, otherwise to StartPickupPhotoWait', () => {
  const asl = extractDefinitionString(synthPipeline());
  expect(asl.States.NotifyDriverAndWait.Next).toBe('DriverAccepted');
  const choice = asl.States.DriverAccepted;
  expect(choice.Type).toBe('Choice');
  expect(choice.Choices).toEqual([
    expect.objectContaining({ Variable: '$.reply', StringEquals: 'DECLINE', Next: 'ReassignDriver' }),
  ]);
  expect(choice.Default).toBe('StartPickupPhotoWait');
});

test('InboundRouterFn is granted both StartExecution and the SendTask* trio on the state machine', () => {
  const template = synthPipeline();
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({ Action: 'states:StartExecution', Effect: 'Allow' }),
        Match.objectLike({
          Action: Match.arrayWith(['states:SendTaskSuccess', 'states:SendTaskFailure', 'states:SendTaskHeartbeat']),
          Effect: 'Allow',
        }),
      ]),
    }),
  });
});

test('InboundRouterFn is granted social-messaging:SendWhatsAppMessage and bedrock:InvokeAgent', () => {
  const template = synthPipeline();
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({ Action: 'social-messaging:SendWhatsAppMessage', Effect: 'Allow' }),
        Match.objectLike({ Action: 'bedrock:InvokeAgent', Effect: 'Allow' }),
      ]),
    }),
  });
});
