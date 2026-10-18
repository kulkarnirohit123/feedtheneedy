import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack';
import { PipelineStack } from './pipeline-stack';

test('creates a Step Functions state machine, a REST API, and an SQS DLQ', () => {
  const app = new App();
  const data = new DataStack(app, 'TestDataStack');
  const stack = new PipelineStack(app, 'TestPipelineStack', { data });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
  template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  template.resourceCountIs('AWS::SQS::Queue', 1);
});
