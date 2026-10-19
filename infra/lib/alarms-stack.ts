import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { PipelineStack } from './pipeline-stack';

interface AlarmsStackProps extends StackProps {
  pipeline: PipelineStack;
}

export class AlarmsStack extends Stack {
  public readonly alertTopic: Topic;

  constructor(scope: Construct, id: string, props: AlarmsStackProps) {
    super(scope, id, props);

    // The alarm previously had no action at all, so it could only ever be *observed* in the
    // console — it notified no one. This topic is the action target; subscribing an email or
    // SMS endpoint to it is a post-deploy step (deliberately not wired here, since no
    // destination address belongs in source).
    this.alertTopic = new Topic(this, 'OpsAlertTopic', {
      displayName: 'Food NGO pickup platform operational alerts',
    });

    const alarm = new Alarm(this, 'WhatsAppDlqDepthAlarm', {
      metric: props.pipeline.whatsAppDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription:
        'At least one WhatsApp message failed to send and was parked on the dead-letter queue. ' +
        'A donor or driver did not receive a notification — inspect the queue, then redrive or ' +
        'contact them manually.',
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    alarm.addAlarmAction(new SnsAction(this.alertTopic));
  }
}
