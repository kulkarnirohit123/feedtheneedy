import * as path from 'path';
import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import {
  Distribution,
  ViewerProtocolPolicy,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';

export class LandingStack extends Stack {
  public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const siteBucket = new Bucket(this, 'LandingSiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Gives the admin app a clean, memorable entry point (/login) instead of making people
    // know or bookmark the internal /admin/index.html asset path. Runs at the edge, before S3
    // is ever asked for anything, so it adds no latency to the common case (every other path
    // passes through unchanged).
    const loginRedirect = new CloudFrontFunction(this, 'LoginRouteFn', {
      code: FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          if (request.uri === '/login' || request.uri === '/login/') {
            request.uri = '/admin/index.html';
          }
          return request;
        }
      `),
    });

    const distribution = new Distribution(this, 'LandingDistribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{ function: loginRedirect, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
      defaultRootObject: 'index.html',
    });

    new BucketDeployment(this, 'LandingDeployment', {
      sources: [Source.asset(path.join(__dirname, '..', '..', 'landing'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // The admin app lives under /admin/ on the same site — one URL, landing by default, with
    // a login link into the dashboard, rather than two separate CloudFront domains to confuse
    // people about which one they're on. It has no client-side routes beyond its own
    // index.html (Login/Dashboard toggle is component state, not a URL), so no SPA fallback
    // rewrite is needed — only /admin/index.html itself has to resolve.
    new BucketDeployment(this, 'AdminAppDeployment', {
      sources: [Source.asset(path.join(__dirname, '..', '..', 'admin-dashboard', 'dist'))],
      destinationBucket: siteBucket,
      destinationKeyPrefix: 'admin',
      distribution,
      distributionPaths: ['/*'],
    });

    this.distributionDomainName = distribution.distributionDomainName;

    new CfnOutput(this, 'LandingUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'AdminUrl', { value: `https://${distribution.distributionDomainName}/login` });
  }
}
