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

test('deploys the landing page assets into the bucket', () => {
  const template = synthLanding();
  template.resourceCountIs('Custom::CDKBucketDeployment', 1);
});
