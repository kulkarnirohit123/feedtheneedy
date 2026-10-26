import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { LandingStack } from './landing-stack';

function synthLanding() {
  const app = new App();
  return Template.fromStack(new LandingStack(app, 'TestLandingStack'));
}

test('creates a private S3 bucket and a CloudFront distribution with OAC', () => {
  const template = synthLanding();
  template.resourceCountIs('AWS::S3::Bucket', 1);
  template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
});

test('deploys both the landing page and the admin app (under /admin) into the bucket', () => {
  const template = synthLanding();
  template.resourceCountIs('Custom::CDKBucketDeployment', 2);
  template.hasResourceProperties('Custom::CDKBucketDeployment', {
    DestinationBucketKeyPrefix: 'admin',
  });
});

test('rewrites /login to the admin app at the edge', () => {
  const template = synthLanding();
  template.resourceCountIs('AWS::CloudFront::Function', 1);
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      DefaultCacheBehavior: {
        FunctionAssociations: [{ EventType: 'viewer-request' }],
      },
    },
  });
});
