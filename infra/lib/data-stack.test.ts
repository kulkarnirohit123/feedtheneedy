import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack';

test('creates all five DynamoDB tables and the photo bucket', () => {
  const app = new App();
  const stack = new DataStack(app, 'TestDataStack');
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::DynamoDB::Table', 6);
  template.resourceCountIs('AWS::S3::Bucket', 1);
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    KeySchema: [{ AttributeName: 'requestId', KeyType: 'HASH' }],
  });
});
