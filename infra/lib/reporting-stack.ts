import * as path from 'path';
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { DataStack } from './data-stack';
import { SERVICES_DIR, nodejsBundling } from './lambda-bundling';

interface ReportingStackProps extends StackProps {
  data: DataStack;
}

export class ReportingStack extends Stack {
  constructor(scope: Construct, id: string, props: ReportingStackProps) {
    super(scope, id, props);
    const { data } = props;

    // NodejsFunction (esbuild) rather than Code.fromAsset(services/dist) — see
    // lambda-bundling.ts for why the AWS SDK is bundled into the asset.
    const reportFn = new NodejsFunction(this, 'MonthlyReportFn', {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(SERVICES_DIR, 'reporting', 'monthlyReport.ts'),
      handler: 'handler',
      bundling: nodejsBundling(),
      environment: {
        DONATION_HISTORY_TABLE: data.donationHistoryTable.tableName,
        REPORTS_BUCKET: data.photosBucket.bucketName,
      },
      timeout: Duration.minutes(5),
    });
    data.donationHistoryTable.grantReadData(reportFn);
    data.photosBucket.grantWrite(reportFn);

    new Rule(this, 'MonthlyReportSchedule', {
      schedule: Schedule.cron({ minute: '0', hour: '2', day: '1' }),
      targets: [new LambdaFunction(reportFn)],
    });
  }
}
