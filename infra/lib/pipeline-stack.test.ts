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

test('creates exactly 10 pipeline/router Lambda functions', () => {
  const template = synthPipeline();
  template.resourceCountIs('AWS::Lambda::Function', 10);
});

test('every Lambda bundles its own dependencies rather than sharing a dependency-free tsc asset', () => {
  const template = synthPipeline();
  const functions = Object.values(template.toJSON().Resources as Record<string, any>).filter(
    (r: any) => r.Type === 'AWS::Lambda::Function',
  );
  expect(functions).toHaveLength(10);

  // NodejsFunction stages one esbuild bundle per entrypoint, so every function must point at
  // its own distinct asset key. The old Code.fromAsset(services/dist) pattern gave all of them
  // the same key — and that asset contained no node_modules at all.
  const assetKeys = functions.map((f: any) => JSON.stringify(f.Properties.Code.S3Key));
  expect(new Set(assetKeys).size).toBe(functions.length);

  // ...and each one is a single-file bundle entered at index.handler, not `<path>.handler`
  // into a multi-file tsc tree.
  for (const f of functions) {
    expect(f.Properties.Handler).toBe('index.handler');
  }
});

test('the webhook route is wired for both POST (deliveries) and GET (Meta verification handshake)', () => {
  const template = synthPipeline();
  for (const httpMethod of ['POST', 'GET']) {
    template.hasResourceProperties('AWS::ApiGateway::Method', { HttpMethod: httpMethod });
  }
});

test('InboundRouterFn receives the Meta app-secret and verify-token env seams', () => {
  const template = synthPipeline();
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: Match.objectLike({
      Variables: Match.objectLike({ META_APP_SECRET: '', META_WEBHOOK_VERIFY_TOKEN: '' }),
    }),
  });
});

test('every Lambda gets the DLQ url so a failed WhatsApp send can actually be parked', () => {
  const template = synthPipeline();
  const functions = Object.values(template.toJSON().Resources as Record<string, any>).filter(
    (r: any) => r.Type === 'AWS::Lambda::Function',
  );
  for (const f of functions) {
    expect(f.Properties.Environment.Variables.WHATSAPP_DLQ_URL).toBeDefined();
  }
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

test('DriverFound Choice routes a null driverId to FlagStuckRequest, otherwise to NotifyDriverAndWait', () => {
  const asl = extractDefinitionString(synthPipeline());
  expect(asl.States.MatchDriver.Next).toBe('DriverFound');
  const choice = asl.States.DriverFound;
  expect(choice.Type).toBe('Choice');
  expect(choice.Choices).toEqual([
    expect.objectContaining({ Variable: '$.driverId', IsNull: true, Next: 'FlagStuckRequest' }),
  ]);
  expect(choice.Default).toBe('NotifyDriverAndWait');
});

test('FridgeFound Choice routes a null fridgeId to FlagStuckRequest, otherwise to StartFridgePhotoWait', () => {
  const asl = extractDefinitionString(synthPipeline());
  expect(asl.States.MatchFridge.Next).toBe('FridgeFound');
  const choice = asl.States.FridgeFound;
  expect(choice.Type).toBe('Choice');
  expect(choice.Choices).toEqual([
    expect.objectContaining({ Variable: '$.fridgeId', IsNull: true, Next: 'FlagStuckRequest' }),
  ]);
  expect(choice.Default).toBe('StartFridgePhotoWait');
});

test('both photo-wait states Catch an exhausted retry into FlagStuckRequest instead of failing', () => {
  const asl = extractDefinitionString(synthPipeline());
  for (const name of ['StartPickupPhotoWait', 'StartFridgePhotoWait']) {
    expect(asl.States[name].Catch).toEqual([
      expect.objectContaining({ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'FlagStuckRequest' }),
    ]);
  }
});

test('FlagStuckRequest is a single shared state invoked with only the requestId', () => {
  const asl = extractDefinitionString(synthPipeline());
  const state = asl.States.FlagStuckRequest;
  expect(state.Type).toBe('Task');
  expect(state.Parameters.Payload).toEqual({ 'requestId.$': '$.requestId' });
  expect(state.Next).toBe('AdminAlertStuck');

  // All four dead ends must converge on this one state, never on a bare Pass.
  const referrers = Object.entries(asl.States as Record<string, any>)
    .filter(([, s]) =>
      s.Next === 'FlagStuckRequest' ||
      (s.Choices ?? []).some((c: any) => c.Next === 'FlagStuckRequest') ||
      s.Default === 'FlagStuckRequest' ||
      (s.Catch ?? []).some((c: any) => c.Next === 'FlagStuckRequest'),
    )
    .map(([name]) => name)
    .sort();
  expect(referrers).toEqual(['DriverFound', 'FridgeFound', 'StartFridgePhotoWait', 'StartPickupPhotoWait']);
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

test('InboundRouterFn is granted social-messaging:SendWhatsAppMessage and bedrock:InvokeModel', () => {
  const template = synthPipeline();
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({ Action: 'social-messaging:SendWhatsAppMessage', Effect: 'Allow' }),
        Match.objectLike({ Action: Match.arrayWith(['bedrock:InvokeModel']), Effect: 'Allow' }),
      ]),
    }),
  });
});
