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

export class DashboardStack extends Stack {
  public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const siteBucket = new Bucket(this, 'DashboardSiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // This standalone distribution predates the unified landing+/login site (FoodNgoLandingStack)
    // and showed the sign-in form directly at the root — surprising for anyone who'd never seen
    // the landing page. Rather than delete it out from under whoever still has this link
    // bookmarked, every request now redirects to the unified site instead.
    const redirectToUnifiedSite = new CloudFrontFunction(this, 'RedirectToUnifiedSiteFn', {
      code: FunctionCode.fromInline(`
        function handler(event) {
          return {
            statusCode: 302,
            statusDescription: 'Found',
            headers: { location: { value: 'https://d2lf7juzgv2zoo.cloudfront.net' } },
          };
        }
      `),
    });

    const distribution = new Distribution(this, 'DashboardDistribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{ function: redirectToUnifiedSite, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    new BucketDeployment(this, 'DashboardDeployment', {
      sources: [Source.asset(path.join(__dirname, '..', '..', 'admin-dashboard', 'dist'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    this.distributionDomainName = distribution.distributionDomainName;

    new CfnOutput(this, 'DashboardUrl', { value: `https://${distribution.distributionDomainName}` });
  }
}
