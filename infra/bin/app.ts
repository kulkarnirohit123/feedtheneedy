import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { AlarmsStack } from '../lib/alarms-stack';

const app = new App();
const data = new DataStack(app, 'FoodNgoDataStack');
const pipeline = new PipelineStack(app, 'FoodNgoPipelineStack', { data });
new AlarmsStack(app, 'FoodNgoAlarmsStack', { pipeline });
