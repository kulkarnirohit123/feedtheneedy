import * as path from 'path';
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { RestApi, LambdaIntegration, CognitoUserPoolsAuthorizer, AuthorizationType } from 'aws-cdk-lib/aws-apigateway';
import { DataStack } from './data-stack';
import { AuthStack } from './auth-stack';

interface AdminApiStackProps extends StackProps {
  data: DataStack;
  auth: AuthStack;
}

export class AdminApiStack extends Stack {
  public readonly api: RestApi;

  constructor(scope: Construct, id: string, props: AdminApiStackProps) {
    super(scope, id, props);
    const { data, auth } = props;

    const listFn = new Function(this, 'ListRequestsFn', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'admin-api/listRequests.handler',
      // Resolved relative to this file's compiled location, not process.cwd(), so `cdk synth`
      // and `jest` both resolve the same directory regardless of which directory they're invoked
      // from (matches the fix already applied to pipeline-stack.ts in Task 16).
      code: Code.fromAsset(path.join(__dirname, '..', '..', 'services', 'dist')),
      environment: { REQUESTS_TABLE: data.requestsTable.tableName },
      timeout: Duration.seconds(10),
    });
    data.requestsTable.grantReadData(listFn);

    const overrideFn = new Function(this, 'OverrideAssignFn', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'admin-api/overrideAssign.handler',
      code: Code.fromAsset(path.join(__dirname, '..', '..', 'services', 'dist')),
      environment: { REQUESTS_TABLE: data.requestsTable.tableName },
      timeout: Duration.seconds(10),
    });
    data.requestsTable.grantReadWriteData(overrideFn);

    this.api = new RestApi(this, 'AdminApi');
    const authorizer = new CognitoUserPoolsAuthorizer(this, 'AdminAuthorizer', {
      cognitoUserPools: [auth.userPool],
    });

    const requests = this.api.root.addResource('requests');
    requests.addMethod('GET', new LambdaIntegration(listFn), {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
    });
    requests.addResource('assign').addMethod('POST', new LambdaIntegration(overrideFn), {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
    });
  }
}
