import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DashboardStack } from './dashboard-stack';

function synthDashboard() {
  const app = new App();
  return Template.fromStack(new DashboardStack(app, 'TestDashboardStack'));
}

test('creates a private S3 bucket and a CloudFront distribution with OAC', () => {
  const template = synthDashboard();
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

test('deploys the built admin-dashboard assets into the bucket', () => {
  const template = synthDashboard();
  template.resourceCountIs('Custom::CDKBucketDeployment', 1);
});

test('redirects every request to the unified landing+login site', () => {
  const template = synthDashboard();
  template.resourceCountIs('AWS::CloudFront::Function', 1);
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      DefaultCacheBehavior: {
        FunctionAssociations: [{ EventType: 'viewer-request' }],
      },
    },
  });
});
