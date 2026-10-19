import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack';
import { AuthStack } from './auth-stack';
import { AdminApiStack } from './admin-api-stack';

function synthAdminApi() {
  const app = new App();
  const data = new DataStack(app, 'TestDataStack');
  const auth = new AuthStack(app, 'TestAuthStack');
  return Template.fromStack(new AdminApiStack(app, 'TestAdminApiStack', { data, auth }));
}

test('both routes sit behind the Cognito authorizer', () => {
  const template = synthAdminApi();
  template.resourceCountIs('AWS::ApiGateway::Authorizer', 1);
  for (const httpMethod of ['GET', 'POST']) {
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: httpMethod,
      AuthorizationType: 'COGNITO_USER_POOLS',
    });
  }
});

test('4xx and 5xx gateway responses carry CORS headers so the browser can read a 401', () => {
  const template = synthAdminApi();
  for (const responseType of ['DEFAULT_4XX', 'DEFAULT_5XX']) {
    template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
      ResponseType: responseType,
      ResponseParameters: Match.objectLike({
        'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
      }),
    });
  }
});

test('the override Lambda can read and write Drivers and send WhatsApp messages', () => {
  const template = synthAdminApi();
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({ Action: 'social-messaging:SendWhatsAppMessage', Effect: 'Allow' }),
      ]),
    }),
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: Match.objectLike({ Variables: Match.objectLike({ DRIVERS_TABLE: Match.anyValue() }) }),
  });
});

test('both admin Lambdas are esbuild-bundled single-file assets, not a shared tsc tree', () => {
  const template = synthAdminApi();
  const functions = Object.values(template.toJSON().Resources as Record<string, any>).filter(
    (r: any) => r.Type === 'AWS::Lambda::Function' && r.Properties.Handler === 'index.handler',
  );
  expect(functions).toHaveLength(2);
  const assetKeys = functions.map((f: any) => JSON.stringify(f.Properties.Code.S3Key));
  expect(new Set(assetKeys).size).toBe(2);
});
