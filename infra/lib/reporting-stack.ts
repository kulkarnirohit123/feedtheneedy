import * as path from 'path';
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { DataStack } from './data-stack';

interface ReportingStackProps extends StackProps {
  data: DataStack;
}

export class ReportingStack extends Stack {
  constructor(scope: Construct, id: string, props: ReportingStackProps) {
    super(scope, id, props);
    const { data } = props;

    const reportFn = new Function(this, 'MonthlyReportFn', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'reporting/monthlyReport.handler',
      code: Code.fromAsset(path.join(__dirname, '..', '..', 'services', 'dist')),
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
