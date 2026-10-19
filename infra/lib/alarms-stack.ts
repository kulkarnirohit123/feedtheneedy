import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Alarm, ComparisonOperator } from 'aws-cdk-lib/aws-cloudwatch';
import { PipelineStack } from './pipeline-stack';

interface AlarmsStackProps extends StackProps {
  pipeline: PipelineStack;
}

export class AlarmsStack extends Stack {
  constructor(scope: Construct, id: string, props: AlarmsStackProps) {
    super(scope, id, props);

    new Alarm(this, 'WhatsAppDlqDepthAlarm', {
      metric: props.pipeline.whatsAppDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
  }
}
