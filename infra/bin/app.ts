import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new App();
const data = new DataStack(app, 'FoodNgoDataStack');
new PipelineStack(app, 'FoodNgoPipelineStack', { data });
