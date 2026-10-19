import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AuthStack } from './auth-stack';

test('creates a Cognito user pool and app client', () => {
  const app = new App();
  const stack = new AuthStack(app, 'TestAuthStack');
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Cognito::UserPool', 1);
  template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
});

test('app client allows direct username/password sign-in', () => {
  const app = new App();
  const stack = new AuthStack(app, 'TestAuthStack2');
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
    ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH']),
  });
});
