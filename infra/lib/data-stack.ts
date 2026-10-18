import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';

export class DataStack extends Stack {
  public readonly requestsTable: Table;
  public readonly driversTable: Table;
  public readonly fridgesTable: Table;
  public readonly spamLogTable: Table;
  public readonly donationHistoryTable: Table;
  public readonly processedMessagesTable: Table;
  public readonly photosBucket: Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.requestsTable = new Table(this, 'RequestsTable', {
      tableName: 'Requests',
      partitionKey: { name: 'requestId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.driversTable = new Table(this, 'DriversTable', {
      tableName: 'Drivers',
      partitionKey: { name: 'driverId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.fridgesTable = new Table(this, 'FridgesTable', {
      tableName: 'Fridges',
      partitionKey: { name: 'fridgeId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.spamLogTable = new Table(this, 'SpamLogTable', {
      tableName: 'SpamLog',
      partitionKey: { name: 'msgId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.donationHistoryTable = new Table(this, 'DonationHistoryTable', {
      tableName: 'DonationHistory',
      partitionKey: { name: 'requestId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.donationHistoryTable.addGlobalSecondaryIndex({
      indexName: 'byMonthStatus',
      partitionKey: { name: 'month', type: AttributeType.STRING },
      sortKey: { name: 'status', type: AttributeType.STRING },
    });

    this.processedMessagesTable = new Table(this, 'ProcessedMessagesTable', {
      tableName: 'ProcessedMessages',
      partitionKey: { name: 'messageId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    this.photosBucket = new Bucket(this, 'PhotosBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}
