import * as path from 'path';
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  RestApi,
  LambdaIntegration,
  CognitoUserPoolsAuthorizer,
  AuthorizationType,
  Cors,
  ResponseType,
} from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { DataStack } from './data-stack';
import { AuthStack } from './auth-stack';
import { SERVICES_DIR, nodejsBundling } from './lambda-bundling';

interface AdminApiStackProps extends StackProps {
  data: DataStack;
  auth: AuthStack;
}

export class AdminApiStack extends Stack {
  public readonly api: RestApi;

  constructor(scope: Construct, id: string, props: AdminApiStackProps) {
    super(scope, id, props);
    const { data, auth } = props;

    // NodejsFunction (esbuild) rather than Code.fromAsset(services/dist) — see
    // lambda-bundling.ts: the tsc output ships no node_modules, so the AWS SDK clients these
    // handlers import had to be present in the managed runtime, which AWS doesn't guarantee.
    const listFn = new NodejsFunction(this, 'ListRequestsFn', {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(SERVICES_DIR, 'admin-api', 'listRequests.ts'),
      handler: 'handler',
      bundling: nodejsBundling(),
      environment: { REQUESTS_TABLE: data.requestsTable.tableName },
      timeout: Duration.seconds(10),
    });
    data.requestsTable.grantReadData(listFn);

    const overrideFn = new NodejsFunction(this, 'OverrideAssignFn', {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(SERVICES_DIR, 'admin-api', 'overrideAssign.ts'),
      handler: 'handler',
      bundling: nodejsBundling(),
      environment: {
        REQUESTS_TABLE: data.requestsTable.tableName,
        DRIVERS_TABLE: data.driversTable.tableName,
        WHATSAPP_ORIGINATION_PHONE_NUMBER_ID:
          this.node.tryGetContext('whatsappOriginationPhoneNumberId') ?? '',
      },
      timeout: Duration.seconds(10),
    });
    data.requestsTable.grantReadWriteData(overrideFn);
    // An override now actually dispatches: it flips both drivers' busy/available status and
    // WhatsApps the newly assigned driver, so it needs the Drivers table and send permission.
    data.driversTable.grantReadWriteData(overrideFn);
    overrideFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['social-messaging:SendWhatsAppMessage'],
      resources: ['*'],
    }));

    this.api = new RestApi(this, 'AdminApi', {
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowHeaders: Cors.DEFAULT_HEADERS,
      },
    });

    // API Gateway's own error responses (notably the Cognito authorizer's 401 on an expired ID
    // token) are NOT produced by the Lambda, so they carry none of the handlers' CORS headers.
    // Without these, the browser blocks the response before the dashboard can read res.status,
    // turning a recoverable "session expired" into an opaque TypeError.
    this.api.addGatewayResponse('Default4xx', {
      type: ResponseType.DEFAULT_4XX,
      responseHeaders: { 'Access-Control-Allow-Origin': "'*'" },
    });
    this.api.addGatewayResponse('Default5xx', {
      type: ResponseType.DEFAULT_5XX,
      responseHeaders: { 'Access-Control-Allow-Origin': "'*'" },
    });

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
