import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack';
import { ReportingStack } from './reporting-stack';

test('creates a monthly EventBridge rule targeting the report Lambda', () => {
  const app = new App();
  const data = new DataStack(app, 'TestDataStack');
  const stack = new ReportingStack(app, 'TestReportingStack', { data });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Events::Rule', 1);
  template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(0 2 1 * ? *)' });
});
