import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from './auth-stack';

test('creates a Cognito user pool and app client', () => {
  const app = new App();
  const stack = new AuthStack(app, 'TestAuthStack');
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Cognito::UserPool', 1);
  template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
});
