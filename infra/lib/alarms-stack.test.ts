import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack';
import { PipelineStack } from './pipeline-stack';
import { AlarmsStack } from './alarms-stack';

test('creates an alarm on DLQ depth', () => {
  const app = new App();
  const data = new DataStack(app, 'TestDataStack');
  const pipeline = new PipelineStack(app, 'TestPipelineStack', { data });
  const stack = new AlarmsStack(app, 'TestAlarmsStack', { pipeline });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::CloudWatch::Alarm', 1);
});
