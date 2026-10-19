import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';

export class AuthStack extends Stack {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.userPool = new UserPool(this, 'AdminUserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
    });

    this.userPoolClient = new UserPoolClient(this, 'AdminUserPoolClient', {
      userPool: this.userPool,
      generateSecret: false,
      authFlows: { userPassword: true },
    });

    new CfnOutput(this, 'AdminUserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'AdminUserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}
