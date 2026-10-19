import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack';
import { PipelineStack } from './pipeline-stack';
import { AlarmsStack } from './alarms-stack';

function synthAlarms() {
  const app = new App();
  const data = new DataStack(app, 'TestDataStack');
  const pipeline = new PipelineStack(app, 'TestPipelineStack', { data });
  return Template.fromStack(new AlarmsStack(app, 'TestAlarmsStack', { pipeline }));
}

test('creates an alarm on DLQ depth', () => {
  synthAlarms().resourceCountIs('AWS::CloudWatch::Alarm', 1);
});

test('the alarm has a description and an actual notification action, not just a console row', () => {
  const template = synthAlarms();
  template.resourceCountIs('AWS::SNS::Topic', 1);
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmDescription: Match.stringLikeRegexp('dead-letter queue'),
  });

  const resources = template.toJSON().Resources as Record<string, any>;
  const topicId = Object.keys(resources).find((k) => resources[k].Type === 'AWS::SNS::Topic');
  const alarm = Object.values(resources).find((r: any) => r.Type === 'AWS::CloudWatch::Alarm') as any;
  expect(alarm.Properties.AlarmActions).toEqual([{ Ref: topicId }]);
});
